// 川: OSM の水面（route.structures の橋と s が重なる water 面）の形に沿った溝。
// 線路の下は terrain.ts の橋の溝（まっすぐ）を残し、線路から離れた所は水面の多角形の岸からの距離で深さを決める。
// 多角形の内側だけを掘る（岸から内側へ BANK_W [m] かけて RIVER_DEPTH まで）。岸の外は地面のまま。
// データの範囲（線路の両側 320m）で切れた辺は川の続きとして外側へ延ばす。
import type { OsmData } from './osm-town';

/** 溝の最大深さ [m]（橋の下の溝と同じ） */
export const RIVER_DEPTH = 6;
/** 水面の標高 [m]（橋の下の水面と同じ） */
export const RIVER_WATER = -3.6;
/** 岸から内側へ、最大深さに達するまでの距離 [m]（広い川）。水際は深さ 3.6m の点なので岸から内側に約 0.57 倍。細い川は川幅に合わせて狭める */
export const BANK_W = 10;
/** 切り口の辺を外側へ延ばす距離 [m]（データの帯の端から） */
const EXTEND = 300;

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export interface RiverField {
  /** 川として扱う water 面の目印（osm-town の池の貼り付けから除く）。`面の頂点数:最初の s:最初の lat` */
  keys: Set<string>;
  /** OSM の水面だけによる溝の深さ [m]（岸の外は 0） */
  depth(s: number, lat: number): number;
  /** 水面の縁（隣り合う面は1つにつないだ縁）からの符号付き距離 [m]（内側が正、外側が負）。近くに川が無ければ -Infinity */
  dist(s: number, lat: number): number;
  /** 川がある s の範囲（細かい格子で地面を作る範囲） */
  spans: [number, number][];
  /** 川がある lat の範囲（延ばした後） */
  lat: [number, number];
}

export const areaKey = (pts: number[]) => `${pts.length}:${pts[0]}:${pts[1]}`;

interface Ring { pts: number[]; s0: number; s1: number; l0: number; l1: number }

/** 符号付き距離の格子の間隔 [m] と、川の範囲の外側に持つ余白 [m] */
const CELL = 1.5, PAD = 40;

/** 川1本分（s が重なる面の集まり）の符号付き距離の格子。隣り合う面（大津川のように2つに分かれた面）も1つの水面として扱える */
interface Cluster { x0: number; y0: number; w: number; h: number; d: Float32Array; m: Float32Array }

/** 川の幅の見積り（その点の周り 12m の最大の内側距離）に使う半径 [セル] */
const WIDTH_R = Math.ceil(12 / CELL);

/** 1次元の距離変換（Felzenszwalb）。f = 0 の点までの距離の2乗 */
function dt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let sx = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (sx <= z[k]) { k--; sx = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = sx; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
/** zero が 1 のセルまでの距離（セル単位）の2乗。zero が 1 のセルが無ければ Infinity */
function edt(zero: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e12, g = new Float64Array(w * h), n = Math.max(w, h);
  const f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w * h; i++) g[i] = zero[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; dt1d(f, h, o, v, z); for (let y = 0; y < h; y++) g[y * w + x] = o[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; dt1d(f, w, o, v, z); for (let x = 0; x < w; x++) g[y * w + x] = o[x]; }
  for (let i = 0; i < w * h; i++) if (g[i] >= INF / 2) g[i] = Infinity;
  return g;
}

function rasterize(rings: Ring[]): Cluster {
  const s0 = Math.min(...rings.map(r => r.s0)) - PAD, s1 = Math.max(...rings.map(r => r.s1)) + PAD;
  const l0 = Math.min(...rings.map(r => r.l0)) - PAD, l1 = Math.max(...rings.map(r => r.l1)) + PAD;
  const w = Math.ceil((s1 - s0) / CELL), h = Math.ceil((l1 - l0) / CELL), inside = new Uint8Array(w * h);
  for (const r of rings) {
    const n = r.pts.length / 2;
    for (let j = 0; j < h; j++) {
      const y = l0 + (j + .5) * CELL, xs: number[] = [];
      if (y < r.l0 || y > r.l1) continue;
      for (let a = 0, b = n - 1; a < n; b = a, a++) {
        const xa = r.pts[a * 2], ya = r.pts[a * 2 + 1], xb = r.pts[b * 2], yb = r.pts[b * 2 + 1];
        if ((ya > y) !== (yb > y)) xs.push(xa + (xb - xa) * (y - ya) / (yb - ya));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - s0) / CELL - .5)), i1 = Math.min(w, Math.ceil((xs[k + 1] - s0) / CELL - .5));
        for (let i = i0; i < i1; i++) inside[j * w + i] = 1;
      }
    }
  }
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) outside[i] = inside[i] ? 0 : 1;
  const toOut = edt(outside, w, h), toIn = edt(inside, w, h), d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = (inside[i] ? Math.sqrt(toOut[i]) - .5 : -(Math.sqrt(toIn[i]) - .5)) * CELL;
  // 周り 12m（正方形の窓）の最大の内側距離。細い川では岸の斜面を狭めて、水面が残るようにする
  const tmp = new Float32Array(w * h), m = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let mx = 0; for (let k = Math.max(0, i - WIDTH_R); k <= Math.min(w - 1, i + WIDTH_R); k++) mx = Math.max(mx, d[j * w + k]);
    tmp[j * w + i] = mx;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let mx = 0; for (let k = Math.max(0, j - WIDTH_R); k <= Math.min(h - 1, j + WIDTH_R); k++) mx = Math.max(mx, tmp[k * w + i]);
    m[j * w + i] = mx;
  }
  return { x0: s0, y0: l0, w, h, d, m };
}

/** 格子の双一次補間。格子の外は -Infinity（近くに川が無い） */
function sample(c: Cluster, s: number, lat: number, f: Float32Array = c.d): number {
  const x = (s - c.x0) / CELL - .5, y = (lat - c.y0) / CELL - .5;
  if (x < 0 || y < 0 || x >= c.w - 1 || y >= c.h - 1) return -Infinity;
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * c.w + i;
  const a = f[k], b = f[k + 1], cc = f[k + c.w], d = f[k + c.w + 1];
  if (!Number.isFinite(a + b + cc + d)) return Math.min(a, b, cc, d);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
}

/** データの帯の端で切れた辺を、外側へ延ばした多角形にする */
function extendClipped(pts: number[], lmin: number, lmax: number): number[] {
  const n = pts.length / 2, eps = .6;
  const S = (i: number) => pts[((i % n + n) % n) * 2], L = (i: number) => pts[((i % n + n) % n) * 2 + 1];
  const edge = (i: number) => L(i) <= lmin + eps || L(i) >= lmax - eps;
  let base = -1;
  for (let i = 0; i < n; i++) if (!edge(i)) { base = i; break; }
  if (base < 0 || !Array.from({ length: n }, (_, i) => edge(i)).some(Boolean)) return pts;
  /** 縁の点 i から、輪を dir（-1 = 手前、+1 = 先）へ 40m 以上たどった点との差で川の向きを見る。外側へ傾きすぎない向きに丸める */
  const extend = (i: number, dir: 1 | -1): [number, number] => {
    let j = i, run = 0;
    for (let k = 0; k < n && run < 40; k++) {
      const nj = j + dir;
      if (edge(nj)) break;
      run += Math.hypot(S(nj) - S(j), L(nj) - L(j));
      j = nj;
    }
    const top = L(i) > (lmin + lmax) / 2, target = top ? lmax + EXTEND : lmin - EXTEND;
    let dl = L(i) - L(j), ds = S(i) - S(j);
    if (j === i || dl * (target - L(i)) <= 0 || Math.abs(dl) < .2 * Math.hypot(ds, dl)) { ds = 0; dl = target - L(i); }
    const slope = Math.max(-.4, Math.min(.4, ds / dl));
    return [S(i) + slope * (target - L(i)), target];
  };
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = base + k;
    if (!edge(i)) { out.push(S(i), L(i)); continue; }
    if (k > 0 && edge(i - 1)) continue;
    let e = i; while (edge(e + 1) && e + 1 < base + n) e++;
    out.push(...extend(i, -1), ...extend(e, 1));
  }
  return out;
}

/**
 * 橋（bridges）と s が重なる OSM の水面から川の溝を作る。該当する水面が無ければ null。
 * data は走るコースの座標へ写したもの（osmFor）
 */
export function makeRiverField(data: OsmData | null, bridges: { from: number; to: number }[]): RiverField | null {
  if (!data || !bridges.length) return null;
  let lmin = Infinity, lmax = -Infinity;
  for (const a of data.areas) { const p = a[1] as number[]; for (let i = 1; i < p.length; i += 2) { lmin = Math.min(lmin, p[i]); lmax = Math.max(lmax, p[i]); } }
  const rings: Ring[] = [], keys = new Set<string>();
  for (const a of data.areas) {
    if (a[0] !== 'water') continue;
    const p = a[1] as number[];
    let s0 = Infinity, s1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { s0 = Math.min(s0, p[i]); s1 = Math.max(s1, p[i]); }
    if (!bridges.some(b => s1 > b.from - 60 && s0 < b.to + 60)) continue;
    const q = extendClipped(p, lmin, lmax);
    const r: Ring = { pts: q, s0: Infinity, s1: -Infinity, l0: Infinity, l1: -Infinity };
    for (let i = 0; i < q.length; i += 2) { r.s0 = Math.min(r.s0, q[i]); r.s1 = Math.max(r.s1, q[i]); r.l0 = Math.min(r.l0, q[i + 1]); r.l1 = Math.max(r.l1, q[i + 1]); }
    rings.push(r); keys.add(areaKey(p));
  }
  if (!rings.length) return null;
  // s が重なる面を1本の川にまとめて格子にする
  const groups: Ring[][] = [], spans: [number, number][] = [];
  for (const r of [...rings].sort((a, b) => a.s0 - b.s0)) {
    const last = spans[spans.length - 1];
    if (last && r.s0 - 30 <= last[1]) { last[1] = Math.max(last[1], r.s1 + 30); groups[groups.length - 1].push(r); }
    else { spans.push([r.s0 - 30, r.s1 + 30]); groups.push([r]); }
  }
  const clusters = groups.map(rasterize);
  const dist = (s: number, lat: number): number => {
    for (const c of clusters) { const d = sample(c, s, lat); if (d > -Infinity) return d; }
    return -Infinity;
  };
  const depth = (s: number, lat: number): number => {
    for (const c of clusters) {
      const d = sample(c, s, lat);
      if (d === -Infinity) continue;
      if (d <= 0) return 0;
      // 岸の斜面の幅: 川幅の半分の 0.8 倍（広い川は BANK_W）。細い川でも水面（深さ 3.6m）が残る
      return RIVER_DEPTH * smooth(d / Math.min(BANK_W, Math.max(1.5, sample(c, s, lat, c.m) * .8)));
    }
    return 0;
  };
  return {
    keys, dist, spans,
    lat: [Math.min(...rings.map(r => r.l0)), Math.max(...rings.map(r => r.l1))],
    depth,
  };
}
