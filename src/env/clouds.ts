// 積雲のスプライト（4 種）を CPU で手続き生成した RGBA テクスチャ。スカイドームのシェーダが参照して描く（描画コール・三角形の追加なし）。
// 底が平らで頭がもくもくした側面形。ブロブ（球）の積み上げ＋ドメインワープのノイズで縁をちぎり、球面法線で陰影を持たせる。
//   R = 濃度(アルファ) / G = 法線 y / B = 法線 x（0..1 に符号化）/ A = 厚み
// 太陽の向き・時間帯の色はシェーダ側で法線から計算するので、焼き込み陰影は無い（時間帯に追従）。
import * as THREE from 'three';

export const CUMULUS_SW = 384; // 1 スプライトの幅 [texel]（高さは半分）
const SH = CUMULUS_SW / 2;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, seed: number, oct = 3): number {
  let s = 0, a = .5, t = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x, y, seed + o * 17); t += a; x = x * 2.03 + 5.1; y = y * 2.03 + 1.7; a *= .5; }
  return s / t;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

interface Blob { x: number; y: number; r: number }
interface Kind { n: number; span: [number, number]; r: [number, number]; tops: number; tower: number; seed: number }
// 座標系: X ∈ [0,2], Y ∈ [0,1]（スプライトは 2:1）、底は Y = BASE
const BASE = .12;
const KINDS: Kind[] = [
  { n: 8, span: [.3, 1.7], r: [.10, .19], tops: 12, tower: 0, seed: 3 },    // 扁平な積雲
  { n: 9, span: [.35, 1.65], r: [.13, .27], tops: 20, tower: .2, seed: 7 },  // 並の積雲
  { n: 6, span: [.55, 1.45], r: [.16, .30], tops: 24, tower: 1, seed: 19 },  // 雄大積雲（塔状）
  { n: 11, span: [.2, 1.8], r: [.10, .23], tops: 22, tower: .35, seed: 31 }, // 群れ
];

function makeBlobs(k: Kind): Blob[] {
  const rand = rng(k.seed * 9973 + 5);
  const blobs: Blob[] = [];
  const mid = (k.span[0] + k.span[1]) / 2, half = (k.span[1] - k.span[0]) / 2;
  for (let i = 0; i < k.n; i++) {
    const x = k.span[0] + (i + rand() * .8) / k.n * (k.span[1] - k.span[0]);
    const env = Math.max(0, 1 - Math.pow(Math.abs(x - mid) / half, 2));
    const r = (k.r[0] + (k.r[1] - k.r[0]) * env) * (.75 + .5 * rand());
    blobs.push({ x, y: BASE + r * (.45 + .3 * rand()), r });
  }
  for (let i = 0; i < k.tops; i++) {
    // 背の高いものを親に選びやすく
    let best = blobs[0], bw = -1;
    for (let t = 0; t < 3; t++) { const c = blobs[Math.floor(rand() * blobs.length)]; const w = (c.y + c.r) * (.6 + rand()); if (w > bw) { bw = w; best = c; } }
    const th = Math.PI * (k.tower > .5 ? .34 + .32 * rand() : .14 + .72 * rand());
    let r = best.r * (.3 + .38 * rand());
    const dist = best.r * (.82 + .1 * rand());
    let x = best.x + Math.cos(th) * dist, y = best.y + Math.sin(th) * dist;
    if (y + r > .965) r = Math.max(.04, .965 - y);
    if (x - r < .03 || x + r > 1.97) continue;
    blobs.push({ x, y, r });
  }
  return blobs;
}

export interface CumulusAtlas {
  texture: THREE.DataTexture;
  /** 生成を時間予算 [ms] だけ進める（起動時のカクつきを避けるためフレームに分割）。完了済みなら true */
  step(budgetMs: number): boolean;
  readonly done: boolean;
}

export function createCumulusAtlas(): CumulusAtlas {
  const AW = CUMULUS_SW * 2, AH = SH * 2;
  const data = new Uint8Array(AW * AH * 4);
  const tex = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  const sets = KINDS.map(makeBlobs);
  let si = 0, row = 0, done = false;

  function genRow(si: number, j: number) {
    const k = KINDS[si], blobs = sets[si], ox = (si % 2) * CUMULUS_SW, oy = Math.floor(si / 2) * SH, sd = k.seed * 131;
    for (let i = 0; i < CUMULUS_SW; i++) {
      const X0 = (i + .5) / CUMULUS_SW * 2, Y0 = (j + .5) / SH;
      const idx = ((oy + j) * AW + ox + i) * 4;
      // どのブロブからも十分遠い（ワープの最大ずれより外）なら空
      let near = false;
      for (const b of blobs) { const dx = X0 - b.x, dy = Y0 - b.y; if (dx * dx + dy * dy < (b.r + .17) * (b.r + .17)) { near = true; break; } }
      if (!near) { data[idx + 1] = 128; data[idx + 2] = 128; continue; }
      // ドメインワープ（大きなうねり + 細かいほつれ）
      const X = X0 + .10 * (fbm(X0 * 4, Y0 * 4, sd) - .5) + .035 * (fbm(X0 * 13, Y0 * 13, sd + 50) - .5);
      const Y = Y0 + .10 * (fbm(X0 * 4 + 9, Y0 * 4, sd + 20) - .5) + .035 * (fbm(X0 * 13, Y0 * 13 + 7, sd + 70) - .5);
      // 球面法線を厚み(hz)の重みで混ぜる（max だと球の境目に硬い折れ目が出る）
      let m = -1, hzMax = 0, nx = 0, ny = 0, nz = 0, wSum = 0;
      for (const b of blobs) {
        const dx = X - b.x, dy = Y - b.y, d2 = dx * dx + dy * dy;
        if (d2 >= b.r * b.r) continue;
        const d = Math.sqrt(d2), cov = 1 - d / b.r, hz = Math.sqrt(b.r * b.r - d2);
        if (cov > m) m = cov;
        if (hz > hzMax) hzMax = hz;
        const w = Math.pow(hz, 2.2);
        nx += w * dx / b.r; ny += w * dy / b.r; nz += w * hz / b.r; wSum += w;
      }
      if (wSum > 0) { nx /= wSum; ny /= wSum; nz /= wSum; }
      if (m <= -1) { data[idx] = 0; data[idx + 1] = 128; data[idx + 2] = 128; data[idx + 3] = 0; continue; }
      // 縁のほつれ
      const edge = m + .13 * (fbm(X0 * 8, Y0 * 8, sd + 90) - .5);
      let a = smooth(0, .17, edge);
      // 平らな底（少しだけ揺らす）
      const yb = BASE + .018 * (vnoise(X0 * 9, 0, sd + 3) - .5) * 2;
      a *= smooth(yb - .012, yb + .03, Y0);
      // 細かい凹凸（法線を揺らす）
      nx += (fbm(X0 * 14, Y0 * 14, sd + 11) - .5) * .9 + (vnoise(X0 * 38, Y0 * 38, sd + 5) - .5) * .35; ny += (fbm(X0 * 14 + 3, Y0 * 14, sd + 13) - .5) * .9 + (vnoise(X0 * 38 + 4, Y0 * 38, sd + 6) - .5) * .35; nz += .15;
      // 底面は下向きの法線へ寄せる
      const wb = (1 - smooth(0, .12, Y0 - yb)) * .9;
      nx *= 1 - wb; ny = ny * (1 - wb) - wb; nz = nz * (1 - wb) + wb * .25;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl;
      const thick = Math.min(1, hzMax / .24);
      data[idx] = Math.round(a * 255);
      data[idx + 1] = Math.round((ny * .5 + .5) * 255);
      data[idx + 2] = Math.round((nx * .5 + .5) * 255);
      data[idx + 3] = Math.round(thick * 255);
    }
  }

  return {
    texture: tex,
    get done() { return done; },
    step(budgetMs) {
      if (done) return true;
      const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) {
        genRow(si, row);
        if (++row >= SH) { row = 0; if (++si >= KINDS.length) { done = true; tex.needsUpdate = true; return true; } }
      }
      return false;
    },
  };
}
