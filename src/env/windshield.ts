// 前面ガラスの雨粒・雪片（2D キャンバスのオーバーレイ）とワイパー
import './env.css';

export interface Windshield {
  /** wet: 雨 0..1, flakes: 雪 0..1, speed: 列車速度 [m/s], visible: 運転台視点か */
  update(dt: number, wet: number, flakes: number, speed: number, visible: boolean, light?: number): void;
  setMaxDrops(n: number): void;
  setScale(s: number): void;
  toggleWiper(): boolean;
  setWiper(on: boolean): void;
  readonly wiperOn: boolean;
}

interface Drop { x: number; y: number; r: number; life: number; snow: boolean; vy: number }

// ワイパー（正規化座標。y は画面高さ基準）
const PIVOT_X = .3, PIVOT_Y = 1.04, REST = -1.45, SWEEP = 1.05, PERIOD = 1.5;

function dropSprite(snow: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  if (snow) {
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.5, 'rgba(240,244,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  // 水滴: 縁は暗く、中は明るく、左上にハイライト
  let gr = g.createRadialGradient(32, 36, 6, 32, 32, 30);
  gr.addColorStop(0, 'rgba(220,230,240,.10)'); gr.addColorStop(.75, 'rgba(160,175,190,.22)'); gr.addColorStop(.92, 'rgba(20,28,36,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  gr = g.createRadialGradient(24, 22, 0, 24, 22, 9);
  gr.addColorStop(0, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(10, 8, 30, 30);
  return c;
}

export function createWindshield(): Windshield {
  const cv = document.createElement('canvas');
  cv.id = 'env-windshield';
  const main = document.getElementById('c');
  if (main) main.insertAdjacentElement('afterend', cv); else document.body.prepend(cv);
  const g = cv.getContext('2d')!;
  const rainImg = dropSprite(false), snowImg = dropSprite(true);
  let drops: Drop[] = [], maxDrops = 140, scale = 1, W = 0, H = 0;
  let wiperOn = false, phase = 0, angle = REST, spawnAcc = 0, dirty = true;

  const resize = () => {
    W = Math.max(1, Math.round(innerWidth * scale)); H = Math.max(1, Math.round(innerHeight * scale));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; drops = []; }
    dirty = true;
  };
  addEventListener('resize', resize); resize();

  function draw(showWiper: boolean) {
    g.clearRect(0, 0, W, H);
    for (const d of drops) {
      const a = Math.min(1, d.life * 2);
      g.globalAlpha = a;
      const r = d.r * H;
      g.drawImage(d.snow ? snowImg : rainImg, d.x * W - r, d.y * H - r, r * 2, r * 2 * (d.snow ? 1 : 1.08));
    }
    g.globalAlpha = 1;
    if (!showWiper) return;
    const px = PIVOT_X * W, py = PIVOT_Y * H, len = .95 * H;
    const tx = px + Math.sin(angle) * len, ty = py - Math.cos(angle) * len;
    g.lineCap = 'round';
    g.strokeStyle = '#111317'; g.lineWidth = Math.max(3, H * .012);
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + (tx - px) * .55, py + (ty - py) * .55); g.stroke();
    // ブレード
    g.strokeStyle = '#08090b'; g.lineWidth = Math.max(5, H * .022);
    g.beginPath(); g.moveTo(px + (tx - px) * .12, py + (ty - py) * .12); g.lineTo(tx, ty); g.stroke();
    g.strokeStyle = 'rgba(120,130,140,.5)'; g.lineWidth = Math.max(1, H * .003);
    g.beginPath(); g.moveTo(px + (tx - px) * .12, py + (ty - py) * .12); g.lineTo(tx, ty); g.stroke();
  }

  return {
    get wiperOn() { return wiperOn; },
    setMaxDrops(n) { maxDrops = n; if (drops.length > n) drops.length = n; },
    setScale(s) { if (s !== scale) { scale = s; resize(); } },
    toggleWiper() { wiperOn = !wiperOn; return wiperOn; },
    setWiper(on) { wiperOn = on; },
    update(dt, wet, flakes, speed, visible, light = 1) {
      cv.style.display = visible ? '' : 'none';
      cv.style.opacity = String(.4 + .6 * light);
      if (!visible) return;
      // ワイパー角度（往復）。停止指示後は休止位置まで戻る
      const prev = angle;
      if (wiperOn || angle > REST + .01) {
        phase += dt / PERIOD;
        if (!wiperOn && phase % 1 < .02) phase = 0;
        angle = REST + (SWEEP - REST) * (.5 - .5 * Math.cos(phase * Math.PI * 2));
        if (!wiperOn && angle <= REST + .01) { angle = REST; phase = 0; }
      }
      const amt = Math.max(wet, flakes);
      // 新しい粒
      spawnAcc += dt * (wet * 45 + flakes * 25) * (1 + Math.min(speed, 30) / 30);
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        if (drops.length >= maxDrops) drops.shift();
        const snow = flakes > wet ? true : Math.random() < flakes / Math.max(.01, wet + flakes);
        drops.push({ x: Math.random(), y: Math.random() * .85, r: (snow ? .006 : .004) + Math.random() * (snow ? .01 : .011), life: 1, snow, vy: 0 });
      }
      // 走行風で上・外側へ流れる。雪は徐々に融ける
      const wind = Math.max(0, speed - 8) * .012;
      for (const d of drops) {
        if (d.snow) d.life -= dt * .12;
        else if (wind > 0) { d.vy = -wind * (d.r * 120); d.y += d.vy * dt; d.x += (d.x - .5) * wind * dt * 2; }
        else if (d.r > .011) d.y += dt * .01; // 大粒は垂れる
        if (amt < .01) d.life -= dt * .15; // 天候回復後は乾く
      }
      // ワイパーの通過範囲を拭き取る
      const lo = Math.min(prev, angle), hi = Math.max(prev, angle);
      const asp = W / H;
      if (hi - lo > 1e-4) {
        drops = drops.filter(d => {
          const dx = (d.x - PIVOT_X) * asp, dy = PIVOT_Y - d.y;
          const a = Math.atan2(dx, dy), dist = Math.hypot(dx, dy);
          return !(dist < .95 && dist > .1 && a >= lo - .02 && a <= hi + .02);
        });
      }
      drops = drops.filter(d => d.life > 0 && d.y > -.05 && d.x > -.05 && d.x < 1.05 && d.y < 1.05);
      const showWiper = wiperOn || angle > REST + .01 || amt > .01;
      if (drops.length || showWiper || dirty) { draw(showWiper); dirty = drops.length > 0 || showWiper; }
    },
  };
}
