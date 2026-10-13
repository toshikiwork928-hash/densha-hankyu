// 開発時 ?inspect=1 のみ。走行処理を止めて実際のワールドを駅・構造物ごとに確認する。
import type { GameContext } from '../core/context';

export function attachSceneInspector(ctx: GameContext): () => void {
  let overview = false;
  const style = document.createElement('style');
  style.textContent = '#overlay,#hud,.look-switch{display:none!important}.scene-inspector{position:fixed;top:8px;left:8px;z-index:200;background:#14202be8;color:white;padding:10px;border-radius:8px;font:14px sans-serif}.scene-inspector select,.scene-inspector button{margin:4px;padding:6px}';
  document.head.append(style);
  const panel = document.createElement('div'); panel.className = 'scene-inspector';
  const select = document.createElement('select'); select.setAttribute('aria-label', '景観確認地点');
  const points = [
    ...ctx.route.stations.map(st => ({ label: st.name + '駅', s: st.stopS - 20 })),
    ...(ctx.route.coastalLandmarks ?? []).map(l => ({ label: l.label ?? l.kind, s: l.s - 40 })),
  ];
  for (const [i, p] of points.entries()) { const o = document.createElement('option'); o.value = String(i); o.textContent = p.label; select.append(o); }
  const position = document.createElement('input'); position.type = 'number'; position.step = '1';
  position.setAttribute('aria-label', '確認位置メートル'); position.style.width = '90px';
  const moveTo = (s: number) => {
    if (!Number.isFinite(s)) return;
    ctx.state.state = 'title'; ctx.state.train.s = Math.max(ctx.route.extent.from, Math.min(ctx.route.extent.to, s)); ctx.state.train.v = 0;
    ctx.state.train.notch = 0;
    position.value = String(Math.round(ctx.state.train.s));
    ctx.events.emit('cameraMode', { mode: ctx.cameraMode });
  };
  const move = () => moveTo(points[Number(select.value)].s);
  select.onchange = move;
  const jump = document.createElement('button'); jump.textContent = '位置へ移動';
  jump.onclick = () => moveTo(Number(position.value));
  const view = document.createElement('button'); view.textContent = '視点切替';
  view.onclick = () => ctx.actions.cycleCamera();
  const cab = document.createElement('button'); cab.textContent = '運転台';
  cab.onclick = () => { overview = false; wide.setAttribute('aria-pressed', 'false'); ctx.cameraMode = 'cab'; ctx.events.emit('cameraMode', { mode: 'cab' }); };
  const wide = document.createElement('button'); wide.textContent = '景観俯瞰';
  wide.onclick = () => { overview = !overview; wide.setAttribute('aria-pressed', String(overview)); };
  panel.append('景観確認 ', select, position, jump, cab, view, wide); document.body.append(panel);
  ctx.cameraMode = 'outside'; move();
  return () => {
    // コンソールから任意の視点: __inspectCam = { s, lat, y, ls, llat, ly }（線路基準の位置と注視点）
    const cam = (window as any).__inspectCam;
    if (cam) { ctx.camera.position.copy(ctx.track.at(cam.s, cam.lat, cam.y)); ctx.camera.lookAt(ctx.track.at(cam.ls, cam.llat, cam.ly)); return; }
    if (!overview) return;
    const s = ctx.state.train.s, side = ctx.route.id.endsWith('-up') ? 1 : -1;
    ctx.camera.position.copy(ctx.track.at(s - 110, side * 85, 65));
    ctx.camera.lookAt(ctx.track.at(s - 45, side * 8, 0));
  };
}
