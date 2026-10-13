// 3D 運転台（運転台視点のときのみ表示）: 卓・窓柱・天井・ワンハンドルマスコン・速度計/圧力計・戸閉灯・行路表
// 列車の先頭位置に固定（カメラの揺れで相対的に揺れる）。ワイパーの動きは環境担当のオーバーレイ
import * as THREE from 'three';
import { FONT, NOTCH_EB } from '../core/config';
import type { GameContext } from '../core/context';
import { GeoBatch, M, P, onLight } from './batch';
import { placeCar } from './emu';

function dialTex(max: number, step: number, label: string, red?: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0f12'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
  g.strokeStyle = '#8a9096'; g.lineWidth = 6; g.beginPath(); g.arc(128, 128, 122, 0, 7); g.stroke();
  g.fillStyle = '#e8edf2'; g.strokeStyle = '#e8edf2'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let v = 0; v <= max; v += step / 2) {
    const a = (-135 + 270 * v / max - 90) * Math.PI / 180, major = v % step === 0;
    if (red != null && v >= red) g.strokeStyle = '#ff5a3a';
    g.lineWidth = major ? 5 : 2;
    g.beginPath(); g.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.lineTo(128 + Math.cos(a) * (major ? 92 : 102), 128 + Math.sin(a) * (major ? 92 : 102)); g.stroke();
    if (major) { g.font = `700 22px ${FONT}`; g.fillText(String(v), 128 + Math.cos(a) * 72, 128 + Math.sin(a) * 72); }
  }
  g.font = `600 18px ${FONT}`; g.fillStyle = '#9aa6b2'; g.fillText(label, 128, 178);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function cardTex(ctx: GameContext): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1e6'; g.fillRect(0, 0, 256, 360);
  g.fillStyle = '#222'; g.font = `800 22px ${FONT}`; g.fillText('行路表', 12, 30);
  g.font = `500 17px ${FONT}`;
  const st = ctx.route.stations.slice(0, 9);
  st.forEach((s, i) => {
    const t = ctx.route.startClock + s.scheduledArrival, hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
    g.fillStyle = s.pass ? '#888' : '#222';
    g.fillText(s.name, 12, 66 + i * 32);
    g.fillText(s.pass ? 'レ' : `${hh}:${String(mm).padStart(2, '0')}${ss ? `'${Math.floor(ss / 15) * 15}` : ''}`, 160, 66 + i * 32);
    g.fillStyle = '#bbb'; g.fillRect(12, 74 + i * 32, 232, 1);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createCab(ctx: GameContext): void {
  const { scene, track, events } = ctx;
  const root = new THREE.Group(); root.name = 'cab3d'; scene.add(root);
  const b = new GeoBatch();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: number, rx = 0, rz = 0, ry = 0) => b.add('body', P.box, M(x, y, z, ry, w, h, d, rx, rz), col);
  const DESK = 0x5d6866, DARK = 0x353b40, FRAME = 0x3b4146;
  // 運転台卓（手前から前方へ）
  box(-.35, 2.42, -.85, 2.3, .14, .7, DESK, .12);
  box(-.35, 2.0, -1.2, 2.5, .8, .1, DARK);
  box(-.35, 2.5, -1.16, 2.5, .05, .18, 0x5a6462);
  // 計器盤（運転士の正面、やや奥）
  box(-.56, 2.52, -1.05, 1.15, .2, .16, 0x48514f, -.38);
  // 窓柱・天井・側壁
  box(-1.45, 2.95, -1.12, .2, 1.4, .14, FRAME, 0, -.06);
  box(.17, 2.95, -1.2, .08, 1.4, .08, FRAME);
  box(1.4, 2.95, -1.12, .2, 1.4, .14, FRAME, 0, .06);
  box(0, 3.86, -1.0, 3.2, .36, .5, FRAME);
  box(0, 3.95, -.3, 3.2, .1, 1.6, 0xbfc3c4);
  box(-1.52, 2.6, -.4, .08, 1.7, 1.4, 0x9aa09c);
  box(-1.52, 2.95, -.55, .05, .9, .9, 0x1c2228); // 側窓（暗）
  box(-.8, 3.62, -1.0, 1.0, .12, .12, 0x30383e); // 巻き上げた日よけ
  // ワイパー基部（動作は環境側）
  box(-.45, 2.47, -1.24, .07, .07, .05, 0x111111);
  // 戸閉灯・表示灯の台
  box(.05, 2.56, -1.08, .32, .12, .1, DARK, -.38);
  b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, root);

  // 計器（速度計・ブレーキシリンダ圧力計）
  const gaugeMats: THREE.MeshLambertMaterial[] = [];
  const needles: Record<string, THREE.Object3D> = {};
  const panel = new THREE.Group(); panel.position.set(-.56, 2.53, -.965); panel.rotation.x = -.38; root.add(panel);
  const gauge = (key: string, x: number, r: number, tex: THREE.Texture) => {
    const m = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: .25 });
    gaugeMats.push(m);
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 32), m); face.position.set(x, 0, 0); panel.add(face);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * .07, 6, 32), new THREE.MeshLambertMaterial({ color: 0x8a9096 })); ring.position.set(x, 0, .004); panel.add(ring);
    const ng = new THREE.BoxGeometry(r * .05, r * .85, .004); ng.translate(0, r * .42, 0);
    const nd = new THREE.Mesh(ng, new THREE.MeshBasicMaterial({ color: 0xff7a30 })); nd.position.set(x, 0, .008); panel.add(nd);
    needles[key] = nd;
  };
  gauge('v', 0, .085, dialTex(120, 20, 'km/h', 100));
  gauge('bc', -.26, .06, dialTex(600, 100, 'BC kPa'));
  gauge('mr', .24, .06, dialTex(1000, 200, 'MR kPa'));
  // 戸閉灯
  const doorMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a });
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(.018, 16), doorMat);
  lamp.position.set(.05, 2.575, -1.025); lamp.rotation.x = -.38; root.add(lamp);
  // 行路表
  const card = new THREE.Mesh(new THREE.PlaneGeometry(.2, .28), new THREE.MeshLambertMaterial({ map: cardTex(ctx), emissive: 0xffffff, emissiveIntensity: .1 }));
  card.position.set(.45, 2.56, -.95); card.rotation.x = -1.05; root.add(card);
  const redrawCard = () => { // 種別・時間帯で時刻・通過駅が変わる
    const m = card.material as THREE.MeshLambertMaterial;
    m.map?.dispose(); m.map = cardTex(ctx); m.needsUpdate = true;
  };
  events.on('serviceChange', redrawCard);
  events.on('reset', redrawCard);
  gaugeMats.push(card.material as THREE.MeshLambertMaterial);

  // ワンハンドルマスコン（手前に引くと力行、奥へ押すとブレーキ）
  const lever = new THREE.Group(); lever.position.set(-1.0, 2.5, -.78); root.add(lever);
  {
    const lb = new GeoBatch();
    lb.add('l', P.box, M(0, .13, 0, 0, .035, .26, .035), 0x8a8f94);
    lb.add('l', P.cyl, M(0, .27, 0, 0, .045, .26, .045, 0, Math.PI / 2), 0x111111);
    lb.build({ l: new THREE.MeshLambertMaterial({ vertexColors: true }) }, lever);
    const base = new GeoBatch();
    base.add('l', P.box, M(-1.0, 2.49, -.78, 0, .2, .06, .36), 0x2a2e33);
    base.add('l', P.box, M(-1.0, 2.53, -.78, 0, .05, .02, .32), 0x0d0d0d); // 溝
    base.build({ l: new THREE.MeshLambertMaterial({ vertexColors: true }) }, root);
  }
  let leverT = 0, leverA = 0;
  const setNotch = (n: number) => { leverT = n === NOTCH_EB ? -1.0 : n > 0 ? n * .11 : n * .095; };
  setNotch(ctx.state.train.notch);
  events.on('notch', e => setNotch(e.notch));
  events.on('reset', () => setNotch(ctx.state.train.notch));
  events.on('doorOpen', () => doorMat.color.setHex(0x3a2a1a));
  events.on('doorsClosed', () => doorMat.color.setHex(0xff9a2a)); // 閉まり切ってから戸閉灯
  events.on('reset', () => doorMat.color.setHex(0xff9a2a));
  onLight(ctx, (n, t) => { const f = Math.max(n, t); for (const m of gaugeMats) m.emissiveIntensity = .25 + f * .55; });

  for (const o of [root]) o.traverse(x => { x.userData.noShadow = true; });
  const frame = document.getElementById('cabframe');
  if (frame) frame.style.display = 'none'; // CSS の簡易枠は 3D 運転台で置き換え

  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  let bc = 0;
  events.on('frame', ({ dt, time }) => {
    root.visible = ctx.cameraMode === 'cab';
    if (!root.visible) return;
    // 縦長画面では HTML の速度計と重なるので 3D 計器は隠す（卓のみ表示）
    panel.visible = ctx.camera.aspect >= 1;
    const { s, v, notch } = ctx.state.train;
    pa.copy(track.pathAt(s + 4, 0, 0)); pb.copy(track.pathAt(s - 4, 0, 0)); // 待避線では横にずれる
    placeCar(root, pa, pb);
    root.position.copy(track.pathAt(s, 0, 0));
    leverA += (leverT - leverA) * Math.min(1, dt * 14);
    lever.rotation.x = leverA;
    const kmh = v * 3.6;
    needles.v.rotation.z = (135 - 270 * Math.min(1.05, kmh / 120)) * Math.PI / 180;
    const bcT = notch < 0 ? (notch === NOTCH_EB ? 480 : -notch * 45) : 0;
    bc += (bcT - bc) * Math.min(1, dt * 1.6);
    needles.bc.rotation.z = (135 - 270 * bc / 600) * Math.PI / 180;
    needles.mr.rotation.z = (135 - 270 * (780 + Math.sin(time * .3) * 25) / 1000) * Math.PI / 180;
  });
}
