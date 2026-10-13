// 速度計（canvas 描画）
/** max = 目盛の最大、line = 線区（種別）最高速度の目印 */
export function drawMeter(g: CanvasRenderingContext2D, vk: number, limit: number, MAX = 120, line?: number): void {
  const W = 460, cx = W / 2, cy = W / 2, r = 200;
  const ang = (v: number) => (135 + v / MAX * 270) * Math.PI / 180;
  g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(14,18,26,.85)'; g.beginPath(); g.arc(cx, cy, 222, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 3; g.stroke();
  g.lineWidth = 12; g.strokeStyle = 'rgba(255,70,70,.75)'; g.beginPath(); g.arc(cx, cy, r - 8, ang(limit), ang(MAX)); g.stroke();
  if (line != null && line < MAX) { // 種別の最高速度（黄色の目印）
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,200,40,.95)'; g.beginPath(); g.arc(cx, cy, r - 8, ang(line) - .025, ang(line) + .025); g.stroke();
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let v = 0; v <= MAX; v += 5) {
    const a = ang(v), big = v % 10 === 0, r1 = big ? r - 26 : r - 16;
    g.strokeStyle = '#dfe6ee'; g.lineWidth = big ? 4 : 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); g.stroke();
    if (v % 20 === 0) { g.fillStyle = '#eef2f7'; g.font = '700 26px system-ui'; g.fillText(String(v), cx + Math.cos(a) * (r - 52), cy + Math.sin(a) * (r - 52)); }
  }
  g.fillStyle = '#9aa6b6'; g.font = '600 20px system-ui'; g.fillText('km/h', cx, cy + 62);
  g.fillStyle = vk > limit + .5 ? '#ff6a5a' : '#ffffff'; g.font = '800 54px ui-monospace,Consolas,monospace'; g.fillText(String(Math.floor(vk)), cx, cy + 112);
  const a = ang(Math.min(MAX + 3, vk));
  g.strokeStyle = '#ffb02e'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - Math.cos(a) * 24, cy - Math.sin(a) * 24); g.lineTo(cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30)); g.stroke();
  g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(cx, cy, 13, 0, 7); g.fill();
}
