// 環境システムの組み立て: 時間帯・天候・画質の設定を見た目（空・光・霧・降水・影・夜間照明）へ反映
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { EnvState } from '../core/events';
import { computeLook, copyLook, createLook, lerpLook } from './look';
import { createNightLights } from './night-lights';
import { createPrecip } from './precip';
import {
  QUALITY_LABEL, QUALITY_SPEC, TIMES, TIME_LABEL, WEATHERS, WEATHER_LABEL,
  adhesionFor, loadSettings, saveSettings, type EnvSettings,
} from './settings';
import { createShadows } from './shadows';
import { createSkyDome } from './sky';
import { buildEnvPanel, refreshEnvPanels, type EnvPanelApi } from './title-ui';
import { createWindshield } from './windshield';
import { qualitySpec } from './settings';
import { beginQualityChange } from '../render/recovery';
import { seaSideOf } from '../route/service';

export interface EnvSystem {
  get(): EnvSettings;
  set(p: Partial<EnvSettings>): void;
}

const TUNNEL_FOG = new THREE.Color(0x0b0c0e);

export function attachEnvSystem(ctx: GameContext): EnvSystem {
  const { scene, renderer, camera, events, env, track } = ctx;
  let settings = loadSettings();

  // 既存の背景色は霧色と共有。スカイドームが上に描かれる
  const branchSide = seaSideOf(ctx.route);
  const coastalEast = ctx.route.coastalLandmarks?.length ? new THREE.Vector2(-branchSide, 0) : undefined;
  const sky = createSkyDome(scene, QUALITY_SPEC[settings.quality].cloudOctaves, ctx.route.theme, coastalEast); // 沿岸は東の低丘だけ、山岳線は従来の稜線
  const precip = createPrecip(scene);
  const shield = createWindshield();
  const lights = createNightLights(ctx);
  const shadows = createShadows(renderer, scene, env.sun);

  // 積雪（地面の上に重ねる半透明面。カメラ追従）
  const snowMat = new THREE.MeshLambertMaterial({
    color: 0xf4f7fb, transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const snowPlane = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), snowMat);
  snowPlane.rotation.x = -Math.PI / 2; snowPlane.position.y = .01; snowPlane.visible = false;
  snowPlane.name = 'env-snow-ground'; snowPlane.renderOrder = 1; snowPlane.castShadow = false; snowPlane.receiveShadow = true;
  snowPlane.userData.noShadow = true;
  scene.add(snowPlane);

  const target = createLook(), cur = createLook();
  let rainAmt = 0, snowAmt = 0, tunnelTarget = 0, tunnel = 0;
  const pickAmounts = () => ({
    rain: settings.weather === 'rain' ? .3 + .7 * settings.intensity : 0,
    snow: settings.weather === 'snow' ? .3 + .7 * settings.intensity : 0,
  });

  function applyQuality() {
    const q = qualitySpec(settings.quality);
    renderer.setPixelRatio(Math.min(q.pixelRatio, devicePixelRatio || 1));
    renderer.setSize(innerWidth, innerHeight, false);
    shadows.configure(q.shadows, q.shadowSize, q.castBudget);
    precip.configure(q.rain, q.snow);
    sky.setOctaves(q.cloudOctaves);
    shield.setMaxDrops(q.drops);
    shield.setScale(settings.quality === 'low' ? .5 : settings.quality === 'mid' ? .75 : 1);
  }

  const envOf = (s: EnvSettings): EnvState => ({ timeOfDay: s.timeOfDay, weather: s.weather, intensity: s.intensity });
  let applying = false;
  function apply(p: Partial<EnvSettings>, opts: { instant?: boolean; emit?: boolean } = {}) {
    const prev = settings;
    settings = { ...settings, ...p };
    saveSettings(settings);
    if (settings.quality !== prev.quality) { beginQualityChange(); applyQuality(); }
    ctx.envState = envOf(settings);
    ctx.trainEnv.adhesion = adhesionFor(settings.weather, settings.intensity);
    computeLook(ctx.envState, target);
    if (opts.instant) {
      copyLook(cur, target);
      const a = pickAmounts(); rainAmt = a.rain; snowAmt = a.snow;
    }
    // 雨・雪になったらワイパー自動作動
    if (settings.weather !== prev.weather && (settings.weather === 'rain' || settings.weather === 'snow')) shield.setWiper(true);
    refreshEnvPanels();
    const changed = prev.timeOfDay !== settings.timeOfDay || prev.weather !== settings.weather || prev.intensity !== settings.intensity;
    if ((opts.emit ?? true) && (changed || opts.instant)) {
      applying = true;
      try { events.emit('envChange', ctx.envState); } finally { applying = false; }
    }
  }

  function random() {
    const w = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
    apply({
      timeOfDay: TIMES[Math.floor(Math.random() * TIMES.length)], weather: w,
      intensity: Math.round((.3 + Math.random() * .7) * 20) / 20,
    });
  }

  const api: EnvPanelApi = { get: () => settings, set: p => apply(p), random };

  // ---- 初期化 ----
  applyQuality();
  apply({}, { instant: true, emit: false });
  if (settings.weather === 'rain' || settings.weather === 'snow') shield.setWiper(true);
  // 全モジュールの購読登録後に初回通知
  setTimeout(() => events.emit('envChange', ctx.envState), 0);
  shadows.tagScene();

  // ---- イベント ----
  // 他モジュールが envChange を出した場合も追従（ミッション指定など）
  events.on('envChange', e => {
    if (applying) return;
    if (e.timeOfDay !== settings.timeOfDay || e.weather !== settings.weather || e.intensity !== settings.intensity)
      apply({ timeOfDay: e.timeOfDay, weather: e.weather, intensity: e.intensity }, { emit: false });
  });
  events.on('start', () => {
    events.emit('envChange', ctx.envState);
    if (settings.weather === 'rain' || settings.weather === 'snow') shield.setWiper(true);
  });
  events.on('reset', () => { tunnelTarget = 0; });
  events.on('tunnel', ({ inside }) => { tunnelTarget = inside ? 1 : 0; });
  events.on('assetsReady', () => { shadows.tagScene(); setTimeout(() => shadows.tagScene(), 1500); });

  // タイトル画面への設定パネル追加
  let titleSeen = false;
  events.on('titleRender', ({ container }) => {
    titleSeen = true;
    if (!container.querySelector('.env-panel')) container.appendChild(buildEnvPanel(api));
  });
  // titleRender 未実装時の代替: タイトルの出発ボタンの前へ差し込む
  function fallbackPanel() {
    if (titleSeen || ctx.state.state !== 'title') return;
    const go = document.querySelector('#card #go');
    if (go && !document.querySelector('.env-panel')) go.insertAdjacentElement('beforebegin', buildEnvPanel(api));
  }
  const fallbackSoon = () => setTimeout(fallbackPanel, 0);
  fallbackSoon();
  events.on('assetsReady', fallbackSoon);
  events.on('stateChange', fallbackSoon);

  // ---- キー操作（Shift+T 時間帯 / Shift+Y 天候 / X ワイパー） ----
  let toastEl: HTMLDivElement | null = null, toastTimer = 0;
  function toast(text: string) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'env-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 1400);
  }
  const envText = () => `${TIME_LABEL[settings.timeOfDay]}・${WEATHER_LABEL[settings.weather]}`;
  addEventListener('keydown', e => {
    const t = e.target as HTMLElement | null;
    if (e.repeat || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return;
    if (e.shiftKey && e.code === 'KeyT') {
      apply({ timeOfDay: TIMES[(TIMES.indexOf(settings.timeOfDay) + 1) % TIMES.length] }); toast(envText());
    } else if (e.shiftKey && e.code === 'KeyY') {
      apply({ weather: WEATHERS[(WEATHERS.indexOf(settings.weather) + 1) % WEATHERS.length] }); toast(envText());
    } else if (e.shiftKey && e.code === 'KeyQ') {
      apply({ quality: ['low', 'mid', 'high'][(['low', 'mid', 'high'].indexOf(settings.quality) + 1) % 3] as EnvSettings['quality'] });
      toast(`画質: ${QUALITY_LABEL[settings.quality]}`);
    } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyX') {
      toast(`ワイパー ${shield.toggleWiper() ? 'ON' : 'OFF'}`);
    }
  });

  // ---- 毎フレーム ----
  const focus = new THREE.Vector3(), trainVel = new THREE.Vector3(), fogCol = new THREE.Color();
  let tagTimer = 0, fbTimer = 0;
  const hasIndoor = ctx.route.stations.some(st => st.indoor);
  events.on('frame', ({ dt, time }) => {
    const k = 1 - Math.exp(-dt * 1.6);
    lerpLook(cur, target, k);
    const a = pickAmounts();
    rainAmt += (a.rain - rainAmt) * k; snowAmt += (a.snow - snowAmt) * k;
    tunnel += (tunnelTarget - tunnel) * (1 - Math.exp(-dt * 2.5));
    const tb = tunnel, out = 1 - tb;
    ctx.light.night = cur.night; ctx.light.tunnel = tb;

    // 光源
    env.sun.color.copy(cur.sunColor); env.sun.intensity = cur.sunInt * out;
    env.hemi.color.copy(cur.hemiSky); env.hemi.groundColor.copy(cur.hemiGround);
    env.hemi.intensity = cur.hemiInt * (1 - .8 * tb);
    // 霧・背景
    fogCol.copy(cur.horizon).lerp(TUNNEL_FOG, tb);
    env.fog.color.copy(fogCol); env.sky.copy(fogCol);
    env.fog.near = THREE.MathUtils.lerp(cur.fogNear, 2, tb);
    env.fog.far = THREE.MathUtils.lerp(cur.fogFar, 180, tb);
    renderer.toneMappingExposure = cur.exposure * (1 + .25 * tb);
    sky.apply(cur, fogCol, time, tb);

    const tr = ctx.state.train, tp = track.trackAt(tr.s);
    focus.copy(track.at(tr.s + 35, 0, 0));
    shadows.update(focus, cur.sunDir);
    lights.update(hasIndoor ? Math.max(cur.lamps, tb) : cur.lamps, Math.max(cur.headlight, tb)); // 屋内式の駅の中はホーム照明を点ける

    // 降水（トンネル内は止める）
    trainVel.set(tp.rz, 0, -tp.rx).multiplyScalar(tr.v);
    const light = THREE.MathUtils.clamp((cur.sunInt * .45 + cur.hemiInt * .6) / 1.4, .12, 1) * (1 - .7 * tb);
    precip.update(dt, camera.position, trainVel, rainAmt * out, snowAmt * out, light, renderer.getPixelRatio());
    shield.update(dt, rainAmt * out, snowAmt * out, tr.v, ctx.cameraMode === 'cab', light);

    // 積雪面
    snowPlane.visible = cur.snow > .02 && ctx.route.theme !== 'mountain'; // 山岳線は地形の上向きの面を白く（world/mountain-terrain.ts）
    if (snowPlane.visible) {
      snowMat.opacity = Math.min(.92, cur.snow * .95);
      snowPlane.position.x = Math.round(camera.position.x / 50) * 50; snowPlane.position.z = Math.round(camera.position.z / 50) * 50;
    }

    // 後から追加された物体の影設定・タイトル代替パネル
    if ((tagTimer += dt) > 2) { tagTimer = 0; shadows.tagScene(); }
    if ((fbTimer += dt) > .5) { fbTimer = 0; fallbackPanel(); }
  });

  return { get: () => settings, set: p => apply(p) };
}
