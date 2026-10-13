// エントリポイント: 各モジュールを組み立てて描画ループを回すだけ
import './ui/styles.css';
import * as THREE from 'three';
import { MAX_DT } from './core/config';
import type { GameContext } from './core/context';
import { $ } from './core/dom';
import { EventBus } from './core/events';
import { createRng } from './core/rng';
import { buildTrack } from './route/track';
import { createTrainEnv } from './sim/train';
import { createState } from './game/state';
import { loadSelection } from './game/ranking';
import { createGame } from './game/loop';
import { createRenderCore } from './render/renderer';
import { installRenderRecovery } from './render/recovery';
import { attachLookSwitch, preloadLook } from './render/look-switch';
import { createCabCamera } from './render/camera';
import { createEnvironment } from './env/environment';
import { attachEnvSystem } from './env';
import { buildWorld } from './world';
import { releaseOsmData } from './world/osm-town';
import { loadCourseData } from './ui/course-loading';
import { attachSfx } from './audio/sfx';
import { attachHud } from './ui/hud';
import { attachOverlay } from './ui/overlay';
import { lineOfRoute, resolveRoute } from './ui/lines';
import { attachKeyboard } from './input/keyboard';
import { attachTouch } from './input/touch';
import { attachMouse } from './input/mouse';
import { attachGamepad } from './input/gamepad';

const renderCanvas = $<HTMLCanvasElement>('c');
const recovery = installRenderRecovery(renderCanvas);
const saved = loadSelection();
const inspectionRoute = import.meta.env.DEV && new URLSearchParams(location.search).has('inspect')
  ? new URLSearchParams(location.search).get('route') : null;
const route = resolveRoute(inspectionRoute ?? saved?.routeId);
document.title = `${lineOfRoute(route.id).name} 運転シミュレーター`;
preloadLook(); // 最初がイラストなら加工コードの取得だけ先に始める（待たない）
await loadCourseData(route); // 選んだコースの沿線データ（区間ごとの別ファイル）。準備できてから世界を作る
const { renderer, scene, camera } = createRenderCore(renderCanvas);
renderer.debug.onShaderError = () => recovery.fail('描画プログラムをGPUで実行できなかった。');
const env = createEnvironment(scene);

const ctx: GameContext = {
  route,
  track: buildTrack(route),
  events: new EventBus(),
  state: createState(route, saved),
  trainEnv: createTrainEnv(),
  scene, camera, renderer, env,
  rng: createRng(12345),
  assetsReady: false,
  envState: { timeOfDay: 'noon', weather: 'clear', intensity: 0 },
  light: { night: 0, tunnel: 0 },
  cameraMode: 'cab',
  actions: undefined as unknown as GameContext['actions'], // createGame で設定
};
ctx.state.sel.routeId = route.id; // 選択の保存（路線ごと）に使う

const world = buildWorld(ctx);
releaseOsmData(); // 生成済みの景観は残る。読込済みの元データだけ手放す
const game = createGame(ctx);
const cab = createCabCamera(ctx);
attachEnvSystem(ctx); // [B] 空・時間帯・天候・影・夜間照明
attachLookSwitch(ctx); // 標準 / イラストの切替。イラスト専用の処理は選んだ時だけ有効にする
attachSfx(ctx.events, ctx);
attachHud(ctx);
attachOverlay(ctx);
attachKeyboard(ctx.actions);
attachTouch(ctx.actions);
attachMouse(ctx.actions);
attachGamepad(ctx); // [A]

world.loadAssets()
  .catch((e: unknown) => { console.error(e); return -1; })
  .then(failed => { ctx.assetsReady = true; ctx.events.emit('assetsReady', { failed: Math.max(0, failed) }); });

const clock = new THREE.Clock();
/** 描画系の時刻 [s]。一時停止中は進めない（踏切の点滅・揺れ・雲なども止める） */
let viewTime = 0;
let inspectScene: (() => void) | undefined;
function step(dt: number, time: number) {
  game.update(dt);
  ctx.events.emit('frame', { dt, time, state: ctx.state.state });
  env.update(dt, time);
  cab.update(time);
  inspectScene?.();
  renderer.render(scene, camera);
}
function loop() {
  if (recovery.failed) return;
  const real = Math.min(MAX_DT, clock.getDelta());
  const dt = ctx.state.paused ? 0 : real;
  viewTime += dt;
  try {
    step(dt, viewTime);
    if (!renderer.getContext().isContextLost()) recovery.healthyFrame();
  } catch (error) { console.error(error); recovery.fail('描画処理でエラーが発生した。'); return; }
  requestAnimationFrame(loop);
}
loop();

// デバッグ用（開発時のみ）
if (import.meta.env.DEV) {
  if (new URLSearchParams(location.search).has('render-test')) {
    const button = document.createElement('button'); button.textContent = 'GPU接続消失を模擬';
    button.style.cssText = 'position:fixed;top:0;right:0;z-index:9999';
    button.onclick = () => renderer.forceContextLoss(); document.body.append(button);
  }
  (window as any).__densha = ctx;
  // 描画せずにゲーム時間を進める（QA 用）
  let simT = 0;
  (window as any).__advance = (sec: number, dt = 1 / 30, hook?: () => boolean | void) => {
    for (let k = 0; k < sec / dt; k++) {
      if (hook?.()) return;
      simT += dt; game.update(dt); ctx.events.emit('frame', { dt, time: simT, state: ctx.state.state });
    }
  };
  void import('./debug/autodrive').then(m => m.attachAutodrive(ctx, (window as any).__advance));
  if (new URLSearchParams(location.search).has('inspect')) {
    void import('./debug/scene-inspector').then(m => { inspectScene = m.attachSceneInspector(ctx); });
  }
}
