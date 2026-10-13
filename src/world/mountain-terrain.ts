// 山岳線（route.theme = 'mountain'）の地形: 谷川に沿って山腹を登る線路。
// 断面は「谷川（riverLat）を底にした V 字の谷」に線路の平場（施工基面）を刻んだ形。山側は切土（急な法面）、谷側は盛土。
// 橋梁で谷川を渡ると川は反対側へ移る。トンネルの上は尾根、坑口の前後は切通し。起点付近は平地の町、終点は谷底の駅。
// 描画: 線路沿いの帯（細かい格子、±250m）＋ワールド座標の粗い格子（遠景の山腹）＋谷川の水面
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Route, Station } from '../route/types';
import type { Track } from '../route/track';
import { islandZone, loopZone } from '../route/service';
import { cullByDistance } from './cull';
import { gridAlong, hash, type Terrain } from './terrain';

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/** 1 次元の値ノイズ（-1..1） */
const vnoise = (x: number, seed: number) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hash(i, seed) * (1 - u) + hash(i + 1, seed) * u) * 2 - 1;
};
/** 2 次元の値ノイズ（-1..1） */
const vnoise2 = (x: number, y: number, seed: number) => {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i + seed * 13.1, j), b = hash(i + 1 + seed * 13.1, j), c = hash(i + seed * 13.1, j + 1), d = hash(i + 1 + seed * 13.1, j + 1);
  return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) * 2 - 1;
};

/** 地表の種類（頂点色用） */
export const enum Tag { Forest, Shelf, Cut, Fill, RiverBed, Field, Rock, Hill }

/** 駅の構内（平場）の形。side = 駅舎を置く側（-1 左 / +1 右） */
export interface StationYard {
  index: number;
  /** town = 平地の町の駅（起点）、loop = 交換駅、halt = 棒線駅、terminal = 山奥の頭端駅 */
  kind: 'town' | 'loop' | 'halt' | 'terminal';
  side: -1 | 1;
  /** 平場の左右の広さ [m]（線路中心から） */
  left: number; right: number;
  /** 平場の範囲（前後のすり付けを除く） */
  from: number; to: number;
  /** 交換駅・頭端駅の線路の開き（島式ホームの両側の線路の横位置 ±spread） */
  spread: number;
  /** 頭端駅: 線路の終わる側（+1 = s の大きい側） */
  endDir: 1 | -1;
  /** 構内の線路の最も外側の横位置 [m]（副線を含む） */
  outer: number;
}

export interface MountainTerrain extends Terrain {
  theme: 'mountain';
  /** 谷川の中心の横位置（谷側 = 符号） */
  riverLat(s: number): number;
  /** 谷川の水面の標高 */
  riverY(s: number): number;
  /** 谷川の半幅 [m] */
  riverHalf(s: number): number;
  /** 谷側の向き（+1 右 / -1 左） */
  valleySide(s: number): number;
  /** トンネルの尾根を除いた地表 */
  baseY(s: number, lat: number): number;
  /** 地表と種類 */
  sample(s: number, lat: number, out?: { tag: Tag }, withHill?: boolean): number;
  /** 平地（川沿いの町・平野）らしさ 0..1 */
  flat(s: number): number;
  /** 橋梁らしさ 0..1（谷の上） */
  bridgeW(s: number): number;
  /** 線路脇の平場の広さ [m]（side = -1 左 / +1 右） */
  shelf(s: number, side: number): number;
  /** 景観の向きをそろえる座標（上りでも下りと同じ地形になるよう、登る向きを基準にした s）と横位置の符号 */
  canon(s: number): number;
  latSign: number;
  yards: StationYard[];
  /** 線路沿いの帯のメッシュ（buildMountainTerrain が入れる）。inside = トンネルの区間。トンネルの覆工はこれと一体で距離カリングする */
  bands: { a: number; b: number; inside: boolean; mesh: THREE.Mesh }[];
}

export const isMountain = (T: Terrain): T is MountainTerrain => (T as MountainTerrain).theme === 'mountain';

/** 谷側（+1 右 / -1 左）: 橋梁の中央を過ぎるごとに反転。上りでも物理的に同じ側になるよう、登る向きの起点で右とする */
function valleySideFn(route: Route, track: Track): (s: number) => number {
  const spans = (route.structures ?? []).filter(s => s.kind === 'bridge' || s.kind === 'viaduct');
  const climbing = track.trackAt(route.extent.to).y >= track.trackAt(route.extent.from).y;
  const s0 = climbing ? 1 : (spans.length % 2 ? 1 : -1);
  return (s: number) => {
    let side = s0;
    for (const b of spans) if (s > (b.from + b.to) / 2) side = -side;
    return side;
  };
}

/** 駅の構内の形を決める（mountain-stations.ts と共有） */
export function stationYards(route: Route, track: Track): StationYard[] {
  const n = route.stations.length, valley = valleySideFn(route, track);
  const inCity = (s: number) => route.scenery.cityZones.some(z => s > z.from && s < z.to);
  return route.stations.map((st: Station, index): StationYard => {
    const lz = loopZone(st), iz = islandZone(st);
    const from = Math.min(st.platform.from, lz?.inFrom ?? Infinity, iz?.inFrom ?? Infinity);
    const to = Math.max(st.platform.to, lz?.outTo ?? -Infinity, iz?.outTo ?? -Infinity);
    const sc = (st.platform.from + st.platform.to) / 2, mtn = -valley(sc) as -1 | 1;
    const spread = st.island?.spread ?? 0, endDir: 1 | -1 = index === 0 ? -1 : 1;
    const outer = Math.max(spread, Math.abs(st.island?.bay?.lat ?? 0), Math.abs(st.loop?.lat ?? 0));
    if (st.headEnd) {
      const wide = spread + 4.6;
      return { index, kind: 'terminal', side: mtn, left: mtn < 0 ? spread + 30 : wide + 4, right: mtn > 0 ? spread + 30 : wide + 4,
        from: endDir > 0 ? from : st.platform.from - 90, to: endDir > 0 ? st.platform.to + 90 : to, spread, endDir, outer };
    }
    if ((index === 0 || index === n - 1) && inCity(sc)) {
      const bay = Math.abs(st.island?.bay?.lat ?? 0);
      return { index, kind: 'town', side: (st.island?.bay ? -Math.sign(st.island.bay.lat) : st.platform.side === 'R' ? 1 : -1) as -1 | 1,
        left: Math.max(spread, bay) + 30, right: Math.max(spread, bay) + 30, from: from - 30, to: to + 30, spread, endDir, outer };
    }
    if (st.island || st.loop) {
      const w = st.island ? spread + 4.6 : Math.abs(st.loop!.lat) + 4.6;
      const ls = st.loop ? Math.sign(st.loop.lat) as -1 | 1 : mtn;
      const bld = w + 15;
      return { index, kind: 'loop', side: ls, left: ls < 0 ? bld : (st.loop ? 5.5 : w), right: ls > 0 ? bld : (st.loop ? 5.5 : w), from, to, spread, endDir, outer };
    }
    const side = st.platform.side === 'R' ? 1 : -1;
    return { index, kind: 'halt', side, left: side < 0 ? 13 : 5, right: side > 0 ? 13 : 5, from: from - 10, to: to + 10, spread, endDir, outer };
  });
}

/** 線路沿いの帯の距離カリング [m] */
export const BAND_CULL = 2600;
const SHELF = 4.6;   // 平場の半幅（線路中心から）
const STEP = 4;      // パラメータ表の刻み [m]

export function makeMountainTerrain(route: Route, track: Track): MountainTerrain {
  const structs = route.structures ?? [];
  const tunnels = structs.filter(s => s.kind === 'tunnel');
  const spans = structs.filter(s => s.kind === 'bridge' || s.kind === 'viaduct');
  const yards = stationYards(route, track);
  const trackY = (s: number) => track.trackAt(s).y;
  const valley = valleySideFn(route, track);
  // 上りは下りと同じ地形（ノイズ）になるよう、登る向きの座標でノイズを引く
  const climbing = trackY(route.extent.to) >= trackY(route.extent.from);
  const canon = (s: number) => climbing ? s : track.length - s, latSign = climbing ? 1 : -1;
  const A0 = route.extent.from - 3000, A1 = route.extent.to + 3000, N = Math.ceil((A1 - A0) / STEP) + 1;
  let yMin = Infinity;
  for (let s = route.extent.from; s <= route.extent.to; s += 20) yMin = Math.min(yMin, trackY(s));
  const zones = route.scenery.cityZones;

  // ---- s 方向のパラメータ表 ----
  const rArr = new Float32Array(N), depArr = new Float32Array(N), wl = new Float32Array(N), wr = new Float32Array(N);
  const bw = new Float32Array(N), fl = new Float32Array(N), amp = new Float32Array(N), half = new Float32Array(N), tk = new Float32Array(N);
  const bridgeW = (s: number) => {
    let w = 0;
    for (const b of spans) if (s > b.from - 25 && s < b.to + 25) w = Math.max(w, smooth(1 - Math.max(b.from - s, s - b.to, 0) / 25));
    return w;
  };
  const tunnelNear = (s: number, m: number) => {
    let w = 0;
    for (const t of tunnels) w = Math.max(w, smooth(1 - Math.max(t.from - s, s - t.to, 0) / m));
    return w;
  };
  const terms = yards.filter(y => y.kind === 'terminal');
  for (let k = 0; k < N; k++) {
    const s = A0 + k * STEP, cs = canon(s), side = valley(s);
    // 平地: 町（cityZones）と、路線で最も低い川沿いの区間
    let f = smooth(1 - (trackY(Math.max(route.extent.from, Math.min(route.extent.to, s))) - yMin - 5) / 14);
    for (const z of zones) f = Math.max(f, smooth(1 - Math.max(z.from - s, s - z.to, 0) / 450));
    let R = 46 + 22 * vnoise(cs / 520, 3) + 8 * vnoise(cs / 170, 4);
    R += (96 - R) * tunnelNear(s, 160);
    R += (175 + 40 * vnoise(cs / 400, 6) - R) * f;
    // 橋梁: 川は線路の下を斜めに横切る（橋の前後 70m で反対側へ）。長い橋は川幅も広い
    let cross = 1, wide = 0;
    for (const b of spans) {
      const c = (b.from + b.to) / 2, h = (b.to - b.from) / 2 + 70;
      if (Math.abs(s - c) < h) { cross = Math.min(cross, Math.abs(s - c) / h); wide = Math.max(wide, (b.to - b.from) * .42 * smooth(1 - (Math.abs(s - c) - (b.to - b.from) / 2) / 80)); }
    }
    let r = side * R * cross;
    // 駅の構内（平場）
    let L = SHELF, Rr = SHELF, trk = SHELF + 1;
    for (const y of yards) {
      const w = smooth(1 - Math.max(y.from - s, s - y.to, 0) / 45);
      if (w <= 0) continue;
      if (w > .3) trk = Math.max(trk, y.outer + 4.6);
      L = Math.max(L, SHELF + (y.left - SHELF) * w); Rr = Math.max(Rr, SHELF + (y.right - SHELF) * w);
      const need = (side > 0 ? y.right : y.left) + 22; // 川は構内の外
      if (cross >= 1 && Math.abs(r) < need) r = side * (Math.abs(r) + (need - Math.abs(r)) * w);
    }
    // 頭端駅: 谷底（川は構内のすぐ脇、浅い）
    let tw = 0;
    for (const y of terms) tw = Math.max(tw, smooth(1 - Math.max(y.from - 150 - s, s - y.to - 150, 0) / 220));
    rArr[k] = r; wl[k] = L; wr[k] = Rr; fl[k] = f; tk[k] = trk;
    // 川の深さ（線路から）: 谷の斜面（勾配 ~0.9）に合わせる。橋梁の下は谷が深い
    let dep = Math.max(3, (Math.abs(r) - 10) * (.86 + .14 * vnoise(cs / 300, 7)));
    for (const b of spans) {
      const c = (b.from + b.to) / 2, hl = (b.to - b.from) / 2;
      const hb = Math.min(40, 16 + (b.to - b.from) * .12);
      dep = Math.max(dep, hb * smooth(1 - Math.max(Math.abs(s - c) - hl * .6, 0) / (hl * .9 + 40)));
    }
    dep += (Math.min(dep, 7) - dep) * tw;
    dep += (6.5 - dep) * f;
    depArr[k] = dep;
    half[k] = Math.max(9 + 21 * f, wide);
    bw[k] = bridgeW(s);
    amp[k] = 250 + 90 * vnoise(cs / 700, 9);
  }
  // 横位置・深さを平滑化（折れを消す）
  const blur = (a: Float32Array, rad: number) => {
    const out = new Float32Array(a.length);
    let acc = 0;
    const w = 2 * rad + 1;
    for (let i = -rad; i <= rad; i++) acc += a[Math.max(0, Math.min(N - 1, i))];
    for (let k = 0; k < N; k++) {
      out[k] = acc / w;
      acc += a[Math.min(N - 1, k + rad + 1)] - a[Math.max(0, k - rad)];
    }
    return out;
  };
  const rS = blur(blur(rArr, 8), 8), depS = blur(blur(depArr, 6), 6), wlS = blur(wl, 4), wrS = blur(wr, 4), halfS = blur(half, 6), flS = blur(fl, 6);
  const lerpTab = (a: Float32Array, s: number) => {
    const x = (s - A0) / STEP, i = Math.max(0, Math.min(N - 2, Math.floor(x))), u = Math.min(1, Math.max(0, x - i));
    return a[i] + (a[i + 1] - a[i]) * u;
  };
  const riverLat = (s: number) => lerpTab(rS, s);

  /** 自然の斜面（谷川からの V 字）＋ひだ */
  const natural = (s: number, x: number, y0: number, r: number, out?: { tag: Tag }): number => {
    const d = Math.abs(x - r), base = y0 - lerpTab(depS, s), hw = lerpTab(halfS, s);
    if (d < hw) { if (out) out.tag = Tag.RiverBed; return base - .9; }
    if (d < hw + 5) { if (out) out.tag = Tag.RiverBed; return base - .9 + 1.5 * smooth((d - hw) / 5); }
    const A = lerpTab(amp, s), dd = d - hw - 5, cs = canon(s), cx = x * latSign;
    let h = base + .6 + A * (1 - Math.exp(-dd / 270));
    // 尾根と沢のひだ（線路から離れるほど大きく）
    const far = smooth((Math.abs(x) - 22) / 140) * smooth(dd / 30);
    h += far * (26 * vnoise2(cs / 160, cx / 95, 1) + 9 * vnoise2(cs / 55, cx / 40, 2));
    if (out) out.tag = Tag.Forest;
    return h;
  };

  /** トンネル上の尾根。坑口の外へも 60m かけて下がる（線路際 ±16m を除く。坑口の面壁の範囲）。
   *  outside = トンネル外側の帯用（トンネル内でも線路際を除く。坑口の行で面壁の下端になる） */
  const hill = (s: number, x: number, y0: number, r: number, outside = false): number => {
    for (const t of tunnels) {
      if (s < t.from - 60 || s > t.to + 60) continue;
      const dist = s < t.from ? t.from - s : s > t.to ? s - t.to : 0;
      const th = smooth(Math.min(s - t.from, t.to - s) / 130);
      const H = 15 + (36 + (t.to - t.from) * .04) * th;
      const vs = Math.sign(r) || 1, ax = x * vs; // 谷側が正
      let f: number;
      if (ax <= 10) f = ax < -12 ? Math.max(0, .5 + .5 * Math.cos(Math.min(1, (-ax - 12) / 330) * Math.PI)) : 1;
      else { const lim = Math.max(28, Math.abs(r) - 16); f = ax > lim ? 0 : .5 + .5 * Math.cos((ax - 10) / (lim - 10) * Math.PI); }
      if (dist > 0 || outside) f *= smooth((Math.abs(x) - 8) / 9) * smooth(1 - dist / 60);
      if (f <= 0) return -Infinity;
      return y0 + H * f + 4 * vnoise2(canon(s) / 40, x * latSign / 30, 5) * f;
    }
    return -Infinity;
  };

  /** 断面（線路の平場・切土・盛土・切通しを含む。尾根は含まない） */
  const base = (s: number, x: number, out?: { tag: Tag }): number => {
    const y0 = trackY(s), r = riverLat(s), nat = natural(s, x, y0, r, out);
    const b = lerpTab(bw, s), f = lerpTab(flS, s);
    const side = Math.sign(r) || 1;
    const W = x < 0 ? lerpTab(wlS, s) : lerpTab(wrS, s), dx = Math.abs(x) - W;
    let t: number, tag = out?.tag ?? Tag.Forest;
    if (dx <= 0) { t = y0 - .05; tag = Math.abs(x) < lerpTab(tk, s) ? Tag.Shelf : Tag.Fill; } // 構内の線路の外は草地
    else if (Math.sign(x) === side) {
      // 谷側: 盛土（1:0.75）で自然の斜面へ
      const fill = y0 - .05 - 1.35 * dx;
      t = Math.min(y0 - .05, Math.max(nat, fill));
      if (t > nat + .3) tag = Tag.Fill;
    } else {
      // 山側: 切土（1:0.6）。自然の斜面がそれより低ければ自然の斜面
      const cut = y0 - .05 + 1.7 * dx;
      t = Math.max(y0 - .05, Math.min(nat, cut));
      if (t < nat - .3 && t - y0 < 9) tag = Tag.Cut; else if (t < nat - .3) tag = Tag.Fill;
    }
    // 坑口の前後: 切通し（谷側も法面が立つ）
    let ac = 0;
    for (const tn of tunnels) {
      const dist = s < tn.from ? tn.from - s : s > tn.to ? s - tn.to : -1;
      if (dist >= 0 && dist < 90) ac = Math.max(ac, smooth(1 - dist / 90));
    }
    ac *= 1 - f;
    if (ac > 0 && dx > 0 && Math.sign(x) === side) {
      // 法面は 10m 程度まで。その先は自然の斜面へ戻す
      const cut = y0 - .05 + Math.min(1.7 * dx, 10), w = ac * (1 - smooth((dx - 12) / 20));
      if (cut > t) { t += (cut - t) * w; if (w > .5) tag = cut - y0 < 7 ? Tag.Cut : Tag.Fill; }
    }
    // 橋梁: 谷そのもの
    if (b > 0) { t = t + (nat - t) * b; if (b > .5) tag = out?.tag ?? Tag.Forest; }
    // 平地（町・川沿い）: 平ら（川筋だけ低い）。遠くは山
    if (f > 0) {
      const ax = Math.abs(x), m = f * (1 - smooth((ax - 330) / 320)) * (1 - b);
      if (m > 0) {
        const d = Math.abs(x - r), hw = lerpTab(halfS, s), riv = lerpTab(depS, s) * (1 - smooth((d - hw) / 8));
        const flatY = dx <= 0 ? y0 - .05 : y0 - .12 - riv;
        t = t + (flatY - t) * m;
        if (m > .5) tag = d < hw + 2 ? Tag.RiverBed : dx <= 0 ? Tag.Shelf : Tag.Field;
      }
    }
    if (out) out.tag = tag;
    return t;
  };

  /** withHill = false はトンネル外側の帯（坑口の線路際に尾根を含めない） */
  const sample = (s: number, x: number, out?: { tag: Tag }, withHill = true): number => {
    const b = base(s, x, out);
    const h = hill(s, x, trackY(s), riverLat(s), !withHill);
    if (h > b) { if (out) out.tag = Tag.Hill; return h; }
    return b;
  };

  const crossings = route.crossings ?? [];
  const self: MountainTerrain = {
    theme: 'mountain',
    yards, canon, latSign, bands: [],
    trackY,
    groundY: (s) => {
      if (lerpTab(bw, s) > 0) return base(s, 0);
      return trackY(s) - .05;
    },
    terrainY: sample,
    baseY: (s, x) => base(s, x),
    sample,
    riverLat,
    riverY: (s) => trackY(s) - lerpTab(depS, s) - .15,
    riverHalf: (s) => lerpTab(halfS, s),
    valleySide: (s) => Math.sign(riverLat(s)) || 1,
    flat: (s) => lerpTab(flS, s),
    bridgeW: (s) => lerpTab(bw, s),
    shelf: (s, side) => side < 0 ? lerpTab(wlS, s) : lerpTab(wrS, s),
    structureAt: (s, m = 0) => structs.find(t => s >= t.from - m && s <= t.to + m),
    riverAt: () => null,
    // 谷川は mountain-terrain 自身が持つ。OSM の川の溝（terrain.ts）は使わない
    dryY: (s) => self.groundY(s),
    riverDepth: () => 0,
    reliefY: () => 0,
    riverNear: () => false,
    low: (s, m = .3) => self.groundY(s) < -m,
    riverAreaKeys: new Set<string>(),
    riverSpans: () => [],
    riverLatRange: () => null,
    isCity: (s) => route.scenery.cityZones.some(z => s > z.from && s < z.to),
    nearCrossing: (s, m = 4) => crossings.some(c => Math.abs(s - c.s) < (c.roadWidth ?? 6) / 2 + m),
    nearStation: (s, m = 0) => route.stations.some(st => {
      const z = loopZone(st), iz = islandZone(st);
      return s > Math.min(st.platform.from, z?.inFrom ?? Infinity, iz?.inFrom ?? Infinity) - m && s < Math.max(st.platform.to, z?.outTo ?? -Infinity, iz?.outTo ?? -Infinity) + m;
    }),
    curvature: (s) => (track.trackAt(s + 2).phi - track.trackAt(s - 2).phi) / 4,
  };
  return self;
}

// ---- 描画 ----

/** 頂点色 */
const COL: Record<Tag, number[]> = {
  [Tag.Forest]: [0x2d4a2e, 0x34522f, 0x3d5d34, 0x4a6838, 0x2a4430],
  [Tag.Shelf]: [0x8a8270, 0x7f7a68],
  [Tag.Cut]: [0x8e8b7e, 0x9a9584, 0x7d7a6c, 0x6f7a5a],
  [Tag.Fill]: [0x6a7e4a, 0x758552],
  [Tag.RiverBed]: [0xa8a496, 0x9c988a, 0xb4b0a2],
  [Tag.Field]: [0x7fa05a, 0x86a660, 0x76984f],
  [Tag.Rock]: [0x6f6a60],
  [Tag.Hill]: [0x2f4c30, 0x38562f, 0x44633a],
};

function colorOf(tag: Tag, s: number, x: number, y: number, y0: number, out: THREE.Color): void {
  const pal = COL[tag], h = hash(Math.floor(s / 37) + Math.floor(x / 29) * 7.3, tag);
  out.setHex(pal[Math.floor(h * pal.length) % pal.length]);
  if (tag === Tag.Forest || tag === Tag.Hill) {
    // 広葉樹の明るい斑・高い所は少し青く
    const patch = vnoise2(s / 120, x / 90, 8);
    if (patch > .35) out.lerp(new THREE.Color(0x5d7a40), (patch - .35) * 1.2);
    out.lerp(new THREE.Color(0x5f7480), smooth((y - y0 - 120) / 400) * .35);
    out.multiplyScalar(.9 + hash(Math.floor(s / 9), Math.floor(x / 9)) * .2);
  } else out.multiplyScalar(.92 + hash(Math.floor(s / 11), Math.floor(x / 7)) * .16);
}

/** 地面（線路沿いの帯・遠景の格子）・谷川の水面を生成 */
export function buildMountainTerrain(ctx: GameContext, T: MountainTerrain): void {
  const { track, route, scene } = ctx;
  const S0 = route.extent.from - 700, S1 = route.extent.to + 700;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = 'ground';
  attachSnow(ctx, mat);
  const tagOut = { tag: Tag.Forest };

  // 線路沿いの帯: 横位置の列（線路際・川筋は細かく）
  const half = [0, 2.5, 4.6, 6, 8, 10.5, 13, 16, 20, 24, 28, 33, 38, 43, 48, 54, 60, 66, 72, 79, 86, 94, 103, 113, 125, 140, 160, 185, 215, 250];
  const LAT = [...half.slice(1).map(v => -v).reverse(), ...half];
  const COVER = 250;
  const tunnels = (route.structures ?? []).filter(s => s.kind === 'tunnel').sort((a, b) => a.from - b.from);
  // 区間を切る: トンネルの内外で別メッシュ（坑口の面壁で段差をふさぐ）
  const cuts: { a: number; b: number; inside: boolean }[] = [];
  let a = S0;
  for (const t of tunnels) {
    if (t.to < S0 || t.from > S1) continue;
    if (t.from > a) cuts.push({ a, b: t.from, inside: false });
    cuts.push({ a: Math.max(a, t.from), b: Math.min(S1, t.to), inside: true });
    a = t.to;
  }
  if (a < S1) cuts.push({ a, b: S1, inside: false });
  const CH = 800;
  for (const cut of cuts) {
    for (let s = cut.a; s < cut.b - .5; s += CH) {
      const e = Math.min(cut.b, s + CH);
      let tags: Tag[] = [], ys: number[] = [];
      const cols = (q: number): [number, number][] => {
        const k = T.curvature(q), R = Math.abs(k) > 1e-5 ? 1 / Math.abs(k) : 1e9;
        tags = []; ys = [];
        return LAT.map(l => {
          const inside = (k > 0 && l > 0) || (k < 0 && l < 0);
          const ll = inside ? Math.sign(l) * Math.min(Math.abs(l), R * .85) : l;
          // トンネル外の帯は尾根を含めない（境界の行で坑口の面壁と合わせる）
          const y = T.sample(q, ll, tagOut, cut.inside);
          tags.push(tagOut.tag); ys.push(y);
          return [ll, y];
        });
      };
      // gridAlong は行ごとに cols → color の順で呼ぶ
      const m = gridAlong(track, s, e, 8, cols, mat, (q, j, out) => {
        const y0 = T.trackY(q);
        colorOf(tags[j] ?? Tag.Forest, q, LAT[j], ys[j] ?? y0, y0, out);
      });
      m.name = 'ground'; m.receiveShadow = true; scene.add(m);
      cullByDistance(ctx, m, BAND_CULL); // 霧の先（晴天で約 2.6km）は見えない
      T.bands.push({ a: s, b: e, inside: cut.inside, mesh: m });
    }
  }

  // 遠景の格子（ワールド座標）。帯の範囲は下げて帯に任せる
  buildFarGrid(ctx, T, mat, COVER, S0, S1);

  // 谷川の水面
  const water = new THREE.MeshPhongMaterial({ color: 0x4d7f7a, shininess: 80, specular: 0x8aa0a8, transparent: true, opacity: .9 });
  water.name = 'river';
  for (let s = S0; s < S1; s += 1000) {
    const e = Math.min(S1, s + 1000);
    const wm = gridAlong(track, s, e, 8, (q) => {
      const r = T.riverLat(q), y = T.riverY(q), w = T.riverHalf(q) + 2.5;
      return [[r - w, y], [r, y], [r + w, y]];
    }, water);
    wm.name = 'river'; wm.userData.noShadow = true; scene.add(wm);
    cullByDistance(ctx, wm, 2200);
  }
  // 遠方の地面（帯・格子の外の穴埋め）
  let minY = Infinity;
  for (let s = S0; s <= S1; s += 200) minY = Math.min(minY, T.trackY(s));
  const mid = track.at((S0 + S1) / 2, 0, 0);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshLambertMaterial({ color: 0x3e5a3c }));
  far.rotation.x = -Math.PI / 2; far.position.set(mid.x, minY - 300, mid.z); far.name = 'ground-far'; scene.add(far);
}

/** 遠景の格子: 各頂点に最も近い線路位置から断面を求める（離れた2区間の間は高さを混ぜる） */
function buildFarGrid(ctx: GameContext, T: MountainTerrain, mat: THREE.Material, cover: number, S0: number, S1: number): void {
  const { track, scene } = ctx;
  // 線路の標本（10m）とビン
  const pts: { s: number; x: number; z: number; rx: number; rz: number }[] = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let s = S0; s <= S1; s += 10) {
    const t = track.trackAt(s);
    pts.push({ s, x: t.x, z: t.z, rx: t.rx, rz: t.rz });
    x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z);
  }
  const PAD = 2600, G = 45;
  x0 -= PAD; x1 += PAD; z0 -= PAD; z1 += PAD;
  const BIN = 400, bnx = Math.ceil((x1 - x0) / BIN) + 1, bins = new Map<number, number[]>();
  pts.forEach((p, i) => { const k = Math.floor((p.x - x0) / BIN) + Math.floor((p.z - z0) / BIN) * bnx; (bins.get(k) ?? bins.set(k, []).get(k)!).push(i); });
  const near = (x: number, z: number, exclude?: number): { i: number; d: number } => {
    const bx = Math.floor((x - x0) / BIN), bz = Math.floor((z - z0) / BIN);
    let best = -1, bd = Infinity;
    for (let rad = 0; rad < 12 && (best < 0 || rad * BIN - BIN < Math.sqrt(bd)); rad++) {
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
        const list = bins.get(bx + dx + (bz + dz) * bnx);
        if (!list) continue;
        for (const i of list) {
          if (exclude != null && Math.abs(pts[i].s - pts[exclude].s) < 600) continue;
          const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return { i: best, d: Math.sqrt(bd) };
  };
  const local = (i: number, x: number, z: number) => {
    const p = pts[i], dx = x - p.x, dz = z - p.z;
    // 進行方向 = (sin φ, -cos φ) = (rz, -rx)
    const a = dx * p.rz - dz * p.rx;
    let s = p.s + Math.max(-6, Math.min(6, a));
    if (i === 0 && a < 0) s = p.s + a;
    if (i === pts.length - 1 && a > 0) s = p.s + a;
    return { s, lat: dx * p.rx + dz * p.rz };
  };
  // トンネルの近く: 格子（45m・対角 64m）の三角形が覆工の内側を横切らないよう、覆工から格子 1 対角以内の頂点は
  // 近くの線路より下げる（尾根は帯が描く。急曲線の内側で帯が狭く粗い格子が尾根の高さのまま残ると、坑内に斜面が突き出る）
  const tps: { x: number; z: number; y: number }[] = [];
  for (const t of ctx.route.structures ?? []) {
    if (t.kind !== 'tunnel') continue;
    for (let s = t.from - 10; s <= t.to + 10; s += 5) { const p = track.trackAt(s); tps.push({ x: p.x, z: p.z, y: p.y }); }
  }
  const TCLR = 78; // 覆工の半幅 7m ＋ 格子の対角 64m ＋ 余裕
  const tunnelCap = (x: number, z: number): number => {
    let cap = Infinity, dmin = Infinity, ymin = Infinity;
    for (const p of tps) {
      const dx = p.x - x, dz = p.z - z;
      if (Math.abs(dx) > TCLR + 60 || Math.abs(dz) > TCLR + 60) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < dmin) dmin = d;
      if (d < TCLR) ymin = Math.min(ymin, p.y);
    }
    if (dmin < TCLR) cap = ymin - 2;
    else if (dmin < TCLR + 60) { // 外側はなだらかに戻す（谷・尾根に穴が見えないよう）
      for (const p of tps) if (Math.hypot(p.x - x, p.z - z) < TCLR + 60) ymin = Math.min(ymin, p.y);
      cap = ymin - 2 + (dmin - TCLR) * 1.2;
    }
    return cap;
  };
  const tag = { tag: Tag.Forest };
  const heightAt = (x: number, z: number, col: THREE.Color): number => {
    const n1 = near(x, z);
    const a = local(n1.i, x, z);
    let h = T.sample(a.s, a.lat, tag);
    colorOf(tag.tag === Tag.Hill ? Tag.Forest : tag.tag, a.s, a.lat, h, T.trackY(a.s), col);
    if (tag.tag === Tag.Forest || tag.tag === Tag.Hill) col.multiplyScalar(.74); // 遠景の山林（樹冠の陰で暗い）
    const n2 = near(x, z, n1.i);
    if (n2.i >= 0 && n2.d < n1.d + 380) {
      const b = local(n2.i, x, z), h2 = T.sample(b.s, b.lat, tag);
      const w = .5 + .5 * smooth((n2.d - n1.d) / 380);
      h = h * w + h2 * (1 - w);
    }
    // 帯の範囲は帯が描くので沈める
    const k = T.curvature(a.s), inner = Math.sign(a.lat) === Math.sign(k) && Math.abs(k) > 1e-5;
    const cov = inner ? Math.min(cover, .85 / Math.abs(k)) - 30 : cover - 30;
    // 線路際（切土・平場）は粗い格子が帯の上に出ないよう大きく、帯の縁の近くは段差が見えないよう少しだけ
    if (Math.abs(a.lat) < cov && a.s > S0 + 20 && a.s < S1 - 20) h -= 3 + 42 * smooth((cov - 70 - Math.abs(a.lat)) / 50);
    else h -= .8;
    return Math.min(h, tunnelCap(x, z));
  };
  const TILE = 44; // 1 タイル = 44×44 セル（約 2km 四方。描画コールを抑える）
  const nx = Math.ceil((x1 - x0) / G), nz = Math.ceil((z1 - z0) / G);
  const col = new THREE.Color();
  for (let tz = 0; tz < nz; tz += TILE) for (let tx = 0; tx < nx; tx += TILE) {
    const cx = Math.min(TILE, nx - tx), cz = Math.min(TILE, nz - tz);
    const pos: number[] = [], cl: number[] = [], idx: number[] = [];
    for (let j = 0; j <= cz; j++) for (let i = 0; i <= cx; i++) {
      const x = x0 + (tx + i) * G, z = z0 + (tz + j) * G;
      const y = heightAt(x, z, col);
      pos.push(x, y, z); cl.push(col.r, col.g, col.b);
    }
    const w = cx + 1;
    for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) {
      const p = j * w + i;
      idx.push(p, p + w, p + 1, p + 1, p + w, p + w + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.name = 'ground-grid'; m.receiveShadow = true; m.userData.noShadow = true;
    scene.add(m); cullByDistance(ctx, m, 2600);
  }
}

/** 積雪: 上を向いた面ほど白く（南海本線の平面の積雪の代わり） */
function attachSnow(ctx: GameContext, mat: THREE.MeshLambertMaterial): void {
  const u = { value: 0 };
  const before = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    before.call(mat, sh, r);
    sh.uniforms.uSnowAmt = u;
    sh.vertexShader = 'varying float vUpN;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUpN = normalize(mat3(modelMatrix) * objectNormal).y;');
    sh.fragmentShader = 'uniform float uSnowAmt;\nvarying float vUpN;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95), uSnowAmt * smoothstep(0.55, 0.85, vUpN));');
  };
  mat.customProgramCacheKey = () => 'mountain-ground-snow';
  let cur = 0;
  ctx.events.on('frame', ({ dt }) => {
    const tgt = ctx.envState.weather === 'snow' ? .55 + .4 * ctx.envState.intensity : 0;
    cur += (tgt - cur) * Math.min(1, dt * .5);
    u.value = cur;
  });
}
