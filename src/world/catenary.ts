// 架線設備（シンプルカテナリ）: 吊架線・トロリー線・ハンガー、ジグザグ偏位、可動ブラケット・碍子、門形ビーム、
// トンネル内の天井吊り金具、引留め（重錘）、き電線・架空地線。区間で架線柱の種類を変える
//   駅構内（2面4線）: H鋼柱＋トラスビーム / 駅（1面）: H鋼柱＋H形ビーム / 市街地: 鋼管柱＋Vトラスビーム（駅近くは H鋼柱＋可動ブラケット）
//   高架: 地覆上の鋼管柱＋ビーム / 橋梁: H鋼柱＋トラスビーム / 郊外: コンクリート柱＋可動ブラケット / 古い区間: 組合柱＋ラチスビーム / 終端の外れ: 木柱
// 300m チャンクごとに「構造物 1 メッシュ＋電線 1 LineSegments」へ結合し、距離カリングする
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { bayZone, customPlatformEdges, islandOffset, islandShape, islandZones, loopShape, profileLat, trackLines, trackSpan, type TrackLine } from '../route/service';
import { basePart, ChunkedBatch, P, type BasePart, type GeoBatch } from './batch';
import { cullByDistance } from './cull';
import { getTerrain, hash, TUNNEL_CENTER, TUNNEL_HALF, TUNNEL_WALL_H } from './terrain';
import { loopTracks } from './track-mesh';
import { coastalThirdTracks } from './coastal-stations';
import { hagoromoDeckEdge } from './hagoromo-branch';

const RAIL = .38;           // レール面（線路基準の高さ）
const CW = RAIL + 5.34;     // トロリー線の高さ（パンタグラフ上昇時の舟の上面にほぼ接する）
const SYS = 1.1;            // 吊架線〜トロリー線の間隔（明り区間）
const SYS_T = .55;          // トンネル内（コンパクト）
const CHUNK = 300;
const CULL = 950;

type Kind = 'tunnel' | 'loop' | 'station' | 'viaduct' | 'bridge' | 'lattice' | 'pipe' | 'hbeam' | 'concrete' | 'wood';
type PoleStyle = 'concrete' | 'pipe' | 'h' | 'lattice' | 'wood';
type BeamStyle = 'truss' | 'pipe' | 'h' | 'lattice';

interface Support { s: number; i: number; kind: Kind; stg: number; mw: number; pl: number; pr: number }
interface Off { dl: number; dy: number }
interface Run {
  /** 線路中心の横位置（偏位を含まない） */
  lat(s: number): number;
  /** 引留め付近の逃がし（横・上） */
  off(s: number): Off;
  s0: number; s1: number;
  /** 両端の引留め（柱の側: -1 = 左, 1 = 右） */
  anchors: { at: 's0' | 's1'; side: number }[];
}
interface WirePt { lat: number; cy: number; my: number; c: number }

const COL = {
  concrete: 0xbdbbb3, found: 0x9b988f, pipe: 0x9ba3a9, h: 0x7f8a91, lattice: 0x77807b, wood: 0x5c4632,
  fit: 0xa7adb2, dark: 0x4a4f54, ins: 0x6e3b26, insT: 0xd9d5cc, weight: 0x8d8a83,
};

// 部品形状
const TAPER = basePart(new THREE.CylinderGeometry(.36, .5, 1, 8));
const CYL8 = basePart(new THREE.CylinderGeometry(.5, .5, 1, 8));
const DISC = basePart(new THREE.CylinderGeometry(.5, .5, 1, 7));

const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _sc = new THREE.Vector3();

/** a → b の棒（単位形状を Y 方向に伸ばす）。座標は支持点ローカル（x = 横位置・y = 線路基準高さ・z = 後方） */
function rod(b: GeoBatch, part: BasePart, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, col: number, dz = w): void {
  _a.set(ax, ay, az); _d.set(bx - ax, by - ay, bz - az);
  const len = _d.length(); if (len < 1e-4) return;
  _q.setFromUnitVectors(Y, _d.multiplyScalar(1 / len));
  _m.compose(_b.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _sc.set(w, len, dz));
  b.add('st', part, _m, col);
}
const box = (b: GeoBatch, x: number, y: number, z: number, w: number, h: number, d: number, col: number) => {
  _m.compose(_b.set(x, y, z), _q.identity(), _sc.set(w, h, d)); b.add('st', P.box, _m, col);
};

/** 碍子（円板を連ねたもの）。中心と向き */
function insulator(b: GeoBatch, x: number, y: number, z: number, dx: number, dy: number, dz: number, n = 3, col = COL.ins): void {
  const l = Math.hypot(dx, dy, dz) || 1, ux = dx / l, uy = dy / l, uz = dz / l, sp = .075;
  rod(b, CYL8, x - ux * sp * n * .6, y - uy * sp * n * .6, z - uz * sp * n * .6, x + ux * sp * n * .6, y + uy * sp * n * .6, z + uz * sp * n * .6, .045, COL.dark);
  for (let k = 0; k < n; k++) {
    const t = (k - (n - 1) / 2) * sp, cx = x + ux * t, cy = y + uy * t, cz = z + uz * t;
    rod(b, DISC, cx - ux * .015, cy - uy * .015, cz - uz * .015, cx + ux * .015, cy + uy * .015, cz + uz * .015, .2, col);
  }
}

/** 架線柱。x = 横位置、y0 = 根元、y1 = 頂部 */
function pole(b: GeoBatch, style: PoleStyle, x: number, y0: number, y1: number, deck: boolean): void {
  switch (style) {
    case 'concrete':
      rod(b, TAPER, x, y0, 0, x, y1, 0, .42, COL.concrete);
      box(b, x, y1 + .03, 0, .3, .06, .3, COL.found);
      break;
    case 'pipe':
      rod(b, CYL8, x, y0, 0, x, y1, 0, .32, COL.pipe);
      box(b, x, y1 + .02, 0, .36, .04, .36, COL.pipe);
      break;
    case 'h':
      box(b, x, (y0 + y1) / 2, 0, .04, y1 - y0, .3, COL.h);
      for (const z of [-.15, .15]) box(b, x, (y0 + y1) / 2, z, .32, y1 - y0, .03, COL.h);
      box(b, x, y1 + .02, 0, .36, .04, .36, COL.h);
      break;
    case 'lattice': {
      const w = .2, n = Math.max(2, Math.round((y1 - y0) / .55)), dh = (y1 - y0) / n;
      for (const cx of [-w, w]) for (const cz of [-w, w]) rod(b, P.box, x + cx, y0, cz, x + cx, y1, cz, .07, COL.lattice);
      for (let k = 0; k < n; k++) {
        const ya = y0 + k * dh, yb = ya + dh, f = k % 2 ? 1 : -1;
        for (const cz of [-w, w]) rod(b, P.box, x - w * f, ya, cz, x + w * f, yb, cz, .035, COL.lattice);
        for (const cx of [-w, w]) rod(b, P.box, x + cx, ya, -w * f, x + cx, yb, w * f, .035, COL.lattice);
      }
      box(b, x, y1 + .03, 0, .5, .06, .5, COL.lattice);
      break;
    }
    case 'wood':
      rod(b, CYL8, x, y0, 0, x, y1, 0, .3, COL.wood);
      break;
  }
  if (style === 'wood') return;
  // 根元: 高架・橋梁はベースプレート、地上は基礎
  if (deck) box(b, x, y0 + .03, 0, .62, .06, .62, COL.found);
  else box(b, x, y0 + .12, 0, .7, .5, .7, COL.found);
}

/** 門形ビーム（xL..xR、下面 y0、高さ dep） */
function beam(b: GeoBatch, style: BeamStyle, xL: number, xR: number, y0: number, dep: number): void {
  const col = style === 'lattice' ? COL.lattice : style === 'h' ? COL.h : COL.pipe;
  if (style === 'h') {
    box(b, (xL + xR) / 2, y0 + dep / 2, 0, xR - xL, dep, .03, col);
    for (const y of [y0 + .015, y0 + dep - .015]) box(b, (xL + xR) / 2, y, 0, xR - xL, .03, .26, col);
    return;
  }
  if (style === 'pipe') {
    // V トラス: 上弦 2 本＋下弦 1 本の鋼管
    const yt = y0 + dep;
    for (const z of [-.28, .28]) rod(b, CYL8, xL, yt, z, xR, yt, z, .11, col);
    rod(b, CYL8, xL, y0, 0, xR, y0, 0, .12, col);
    const n = Math.max(2, Math.round((xR - xL) / 1.4));
    for (let k = 0; k <= n; k++) {
      const x = xL + (xR - xL) * k / n, xn = xL + (xR - xL) * Math.min(n, k + .5) / n;
      for (const z of [-.28, .28]) rod(b, P.box, x, y0, 0, xn, yt, z, .04, col);
    }
    return;
  }
  // 四角断面のトラス（駅構内・橋梁）/ ラチス（古い区間）
  const zz = style === 'lattice' ? .25 : .32, yt = y0 + dep, ch = style === 'lattice' ? .06 : .09;
  for (const y of [y0, yt]) for (const z of [-zz, zz]) rod(b, P.box, xL, y, z, xR, y, z, ch, col);
  const n = Math.max(2, Math.round((xR - xL) / (style === 'lattice' ? .7 : 1.1)));
  for (let k = 0; k < n; k++) {
    const xa = xL + (xR - xL) * k / n, xb = xL + (xR - xL) * (k + 1) / n, f = k % 2 ? 1 : 0;
    for (const z of [-zz, zz]) rod(b, P.box, xa, f ? y0 : yt, z, xb, f ? yt : y0, z, ch * .55, col);
    if (k % 2 === 0) for (const y of [y0, yt]) rod(b, P.box, xa, y, -zz, xa, y, zz, ch * .55, col);
  }
  for (const y of [y0, yt]) rod(b, P.box, xR, y, -zz, xR, y, zz, ch * .55, col);
}

/** 可動ブラケット（柱 px から線路側へ）。wires = この線路に掛かる電線 */
function bracket(b: GeoBatch, px: number, wires: WirePt[], col: number): void {
  const c = wires[0].c, d = Math.sign(c - px) || 1;
  const my = Math.max(...wires.map(w => w.my)), cy = Math.min(...wires.map(w => w.cy));
  const far = d > 0 ? Math.max(...wires.map(w => w.lat)) : Math.min(...wires.map(w => w.lat));
  const xp = px + d * .2, xt = far + d * .3, yT = my + .12;
  const yTie = my + .6, yMain = cy - .25;
  // 上部の水平パイプ・下部の主パイプ（傾斜）と柱側の碍子
  rod(b, CYL8, xp, yTie, 0, xt, yT, 0, .055, col);
  rod(b, CYL8, xp, yMain, 0, xt, yT, 0, .07, col);
  box(b, xp - d * .06, yTie, 0, .16, .2, .2, COL.dark);
  box(b, xp - d * .06, yMain, 0, .16, .2, .2, COL.dark);
  const tieAt = (x: number) => yTie + (yT - yTie) * (x - xp) / (xt - xp);
  const mainAt = (x: number) => yMain + (yT - yMain) * (x - xp) / (xt - xp);
  insulator(b, xp + d * .35, tieAt(xp + d * .35), 0, xt - xp, yT - yTie, 0, 3);
  insulator(b, xp + d * .35, mainAt(xp + d * .35), 0, xt - xp, yT - yMain, 0, 4);
  // 吊架線の受け（主パイプから吊る）
  for (const w of wires) {
    const ym = mainAt(w.lat);
    if (ym > w.my + .02) rod(b, P.box, w.lat, ym, 0, w.lat, w.my, 0, .035, COL.dark);
    box(b, w.lat, w.my, 0, .07, .07, .22, COL.dark);
  }
  // 振止め: 主パイプから下ろした支持パイプ → トロリー線
  const xr = c - d * 1.05, yr = mainAt(xr), yb = CW + .3;
  if (yr > yb) rod(b, CYL8, xr, yr, 0, xr, yb, 0, .05, col);
  for (const w of wires) {
    rod(b, CYL8, xr, yb, 0, w.lat, w.cy + .05, 0, .035, COL.dark);
    box(b, w.lat, w.cy + .04, 0, .05, .06, .12, COL.dark);
  }
}

/** ビーム・天井からの吊り下げ金具（ytop = 取付け高さ、side = 吊りパイプを寄せる側） */
function drop(b: GeoBatch, ytop: number, wires: WirePt[], side: number, col: number, insCol: number): void {
  const c = wires[0].c, xd = c + side * .85;
  const my = Math.max(...wires.map(w => w.my));
  const yb = CW + .3;
  rod(b, CYL8, xd, ytop, 0, xd, yb, 0, .08, col);
  box(b, xd, ytop - .05, 0, .2, .1, .2, COL.dark);
  // 吊架線の受け: 水平の短いパイプ＋碍子
  const far = side < 0 ? Math.max(...wires.map(w => w.lat)) : Math.min(...wires.map(w => w.lat));
  const xe = far - side * .25, yh = my + .14;
  rod(b, CYL8, xd, yh, 0, xe, yh, 0, .05, col);
  insulator(b, xd - side * .3, yh, 0, 1, 0, 0, 3, insCol);
  for (const w of wires) {
    if (yh > w.my + .02) rod(b, P.box, w.lat, yh, 0, w.lat, w.my, 0, .035, COL.dark);
    box(b, w.lat, w.my, 0, .07, .07, .22, COL.dark);
    rod(b, CYL8, xd, yb, 0, w.lat, w.cy + .05, 0, .035, COL.dark);
    box(b, w.lat, w.cy + .04, 0, .05, .06, .12, COL.dark);
  }
  insulator(b, xd, yb + .25, 0, 0, 1, 0, 2, insCol);
}

/** トンネル断面の天井高さ（線路基準） */
const ceilingY = (lat: number) => TUNNEL_WALL_H + Math.sqrt(Math.max(0, TUNNEL_HALF ** 2 - (lat - TUNNEL_CENTER) ** 2));

export function buildCatenary(ctx: GameContext): void {
  const { route, track, scene } = ctx, T = getTerrain(ctx);
  const L0 = Math.min(...route.tracks), L1 = Math.max(...route.tracks), MID = (L0 + L1) / 2;
  const S0 = route.extent.from, S1 = route.extent.to;
  const loops = loopTracks(ctx);
  const thirds = route.stations.flatMap(st => coastalThirdTracks(route, st));
  // 待避線駅の区間（lat = 外側の線路の振れ）と、島式1面2線駅の S字区間（各線が spread だけ外へ開く）。柱・ビームは外側の線路の外に立てる
  const zones: { inFrom: number; outTo: number; lat: number }[] = [
    ...new Map(loops.map(o => [o.z.index, o.z])).values(),
    ...islandZones(route).map(z => ({ inFrom: z.inFrom, outTo: z.outTo, lat: -z.spread })),
  ];
  const structs = route.structures ?? [];
  // 単線の駅の右の線・副線（本線は route.tracks の 0）
  const extraLines = route.singleTrack ? trackLines(route).filter(l => l.kind !== 'main') : [];
  const allLines = trackLines(route);
  const railEdges = (s: number): [number, number] => {
    const centers = [
      ...allLines.filter(l => s >= l.from - 12 && s <= l.to + 12).map(l => l.lat(Math.max(l.from, Math.min(l.to, s)))),
      ...loops.map(l => l.lat(s)),
      ...thirds.filter(l => s >= l.from && s <= l.to).map(l => l.lat(s)),
    ];
    return [Math.min(L0, ...centers), Math.max(L1, ...centers)];
  };
  /** 複々線・追加の線路のある複線（route.trackProfiles / extraTracks） */
  const multi = !route.singleTrack && !!(route.trackProfiles || route.extraTracks?.length);
  const bays = route.stations.flatMap(st => { const b = bayZone(st); return b ? [{ from: b.from, to: b.to, platFrom: st.platform.from, platTo: st.platform.to, width: st.island!.bay!.platformWidth }] : []; });

  // ---------- 支持点の位置（踏切・信号・標識・駅舎・構造物の端を避ける） ----------
  const avoid = (s: number): boolean => {
    for (const c of route.crossings ?? []) if (Math.abs(s - c.s) < (c.roadWidth ?? 6) / 2 + 4.5) return true;
    for (const g of route.signals ?? []) if (Math.abs(s - g.s) < 4) return true;
    for (const g of route.signs) if (Math.abs(s - g.s) < 2.5) return true;
    for (const L of route.limits) if (Math.abs(s - L.from) < 2.5 || Math.abs(s - L.to) < 2.5) return true;
    for (const st of route.stations) if (Math.abs(s - (st.platform.from + st.platform.to) / 2) < 15.5) return true; // 駅舎
    for (const st of structs) if (Math.abs(s - st.from) < (st.kind === 'tunnel' ? 7 : 5) || Math.abs(s - st.to) < (st.kind === 'tunnel' ? 7 : 5)) return true;
    return false;
  };
  const adjust = (s: number) => {
    for (let d = 0; d <= 16; d += 2) for (const e of d ? [-d, d] : [0]) if (!avoid(s + e)) return s + e;
    return s;
  };
  const sList: number[] = [];
  for (let s = adjust(S0 + 8); s < S1 - 4;) {
    sList.push(s);
    const k = Math.max(Math.abs(T.curvature(s + 10)), Math.abs(T.curvature(s + 35)));
    s = adjust(s + (k > 1 / 1500 ? 38 : 50));
  }

  // ---------- 区間ごとの種類 ----------
  const lastSta = route.stations[route.stations.length - 1];
  const woodFrom = Math.max(lastSta.platform.to, ...zones.map(z => z.outTo)) + 120;
  const kindAt = (s: number): Kind => {
    const st = T.structureAt(s, 0);
    if (st?.kind === 'tunnel') return 'tunnel';
    if (zones.some(z => s >= z.inFrom - 12 && s <= z.outTo + 12)) return 'loop';
    if (s >= woodFrom) return 'wood';
    if (st?.kind === 'viaduct') return 'viaduct';
    if (st?.kind === 'bridge') return 'bridge';
    if (route.stations.some(x => !x.loop && !x.island && s > x.platform.from - 10 && s < x.platform.to + 10)) return 'station';
    if (T.isCity(s)) return T.nearStation(s, 280) ? 'hbeam' : 'pipe';
    // 古い区間（約 1.2km 単位でまれに）は組合柱
    if (hash(Math.floor(s / 1200), 23) < .25) return 'lattice';
    return 'concrete';
  };
  const sups: Support[] = sList.map((s, i) => {
    const kind = kindAt(s), k = T.curvature(s);
    // 偏位: 直線は交互 ±0.22m、曲線は外側へ 0.2m（径間中央は弦の分だけ内側へ寄る）
    const stg = Math.abs(k) > 1 / 2500 ? -Math.sign(k) * .2 : (i % 2 ? .22 : -.22);
    let pl = L0 - 3.3, pr = L1 + 3.3;
    if (kind === 'viaduct' || kind === 'bridge') {
      // 高架駅はホームの外縁に立てる
      const el = route.stations.some(q => q.elevated && s > q.platform.from - 10 && s < q.platform.to + 10);
      const edge = route.theme === 'coast' ? (el ? 6.8 : 2.9) : (el ? 6.9 : 3.15);
      pl = L0 - edge; pr = L1 + edge;
    }
    if (kind === 'loop') {
      if (route.theme === 'coast') {
        // 分岐器で絞る床版に合わせ、実際の待避線中心から外側へ立てる。
        const positions = loops.map(o => o.lat(s));
        // 島式1面2線駅: 線路が駅の前後でホームの両側へ開く分
        for (const z of islandZones(route)) if (s > z.inFrom && s < z.outTo) { const k = z.spread * islandShape(z, s); positions.push(L0 - k, L1 + k); }
        pl = Math.min(L0, ...positions) - 2.9; pr = Math.max(L1, ...positions) + 2.9;
      } else {
        const z = zones.find(q => s >= q.inFrom - 12 && s <= q.outTo + 12)!;
        pl = L0 + z.lat - 3.3; pr = L1 - z.lat + 3.3;
      }
    }
    if (kind === 'station') {
      // 相対式ホーム（両側）の外
      pl = L0 - 7.4; pr = L1 + 7.4;
    }
    // 羽衣の島式ホーム側: 床版の外縁（ホーム・3番線の外）に立てる
    if (kind === 'station' || kind === 'viaduct' || kind === 'bridge') {
      const hg = hagoromoDeckEdge(route, s);
      if (hg) { if (hg.side < 0) pl = Math.min(pl, hg.lat + .5); else pr = Math.max(pr, hg.lat - .5); }
    }
    for (const t of thirds) if (s >= t.from && s <= t.to) {
      // 外側へは副線の外のホーム・柵（reach）の外、内側は 2.9m
      const left = t.outer < t.main ? t.reach : 2.9, right = t.outer < t.main ? 2.9 : t.reach;
      pl = Math.min(pl, t.lat(s) - left); pr = Math.max(pr, t.lat(s) + right);
    }
    if (route.singleTrack && kind !== 'station') {
      // 単線: 駅の右の線・副線（とその片面ホーム）の外側に立てる
      for (const l of extraLines) if (s >= l.from - 12 && s <= l.to + 12) {
        const lat = l.lat(Math.min(l.to, Math.max(l.from, s)));
        let edge = 3.3;
        const bz = l.kind === 'bay' ? bays.find(b => s >= b.from && s <= b.to) : undefined;
        if (bz && s >= bz.platFrom - 5 && s <= bz.platTo + 5) edge = 1.7 + bz.width + .6;
        if (lat > 0) pr = Math.max(pr, lat + edge); else pl = Math.min(pl, lat - edge);
      }
    }
    if (route.singleTrack) {
      const [left, right] = railEdges(s);
      pl = Math.min(pl, left - 3.3); pr = Math.max(pr, right + 3.3);
    }
    if (multi && kind !== 'tunnel') {
      // 複々線・頭端駅の番線: 並ぶ線路全体の外。custom 駅は片面ホームの外縁（島式ホームだけの側は線路の外 2.9m）
      const [a, c] = trackSpan(route, s), pe = customPlatformEdges(route, s, 10);
      if (pe || kind === 'station') {
        pl = Math.min(a - 2.9, pe && pe[0] < a ? pe[0] - .25 : Infinity);
        pr = Math.max(c + 2.9, pe && pe[1] > c ? pe[1] + .25 : -Infinity);
      } else { pl = Math.min(pl, a - 2.9); pr = Math.max(pr, c + 2.9); }
    }
    return { s, i, kind, stg, mw: CW + (kind === 'tunnel' ? SYS_T : SYS), pl, pr };
  });
  const supIdx = (s: number) => sups.findIndex(p => p.s >= s);

  // ---------- 電線の系統（本線・待避線、オーバーラップと引留め） ----------
  const runs: Run[] = [];
  const zero: Off = { dl: 0, dy: 0 };
  const OVERLAPS = [2050, 6650, 9000].filter(o => o > S0 + 200 && o < S1 - 200);
  for (const c of route.tracks) {
    const side = c < MID ? -1 : 1;
    const cuts = OVERLAPS.map(o => supIdx(o)).filter(k => k > 1 && k < sups.length - 2);
    let start = 0, prevCut = -1;
    for (let j = 0; j <= cuts.length; j++) {
      const k = cuts[j];
      const endIdx = j < cuts.length ? k + 1 : sups.length - 1;
      const a = sups[start].s, bS = sups[endIdx].s;
      // 終端側: 最終径間で逃がす / 始端側: 最初の径間で逃がす
      const endA = j < cuts.length ? sups[k].s : Infinity, endB = bS;
      const begA = prevCut >= 0 ? sups[prevCut].s : -Infinity, begB = prevCut >= 0 ? sups[prevCut + 1].s : -Infinity;
      runs.push({
        lat: (s) => c + islandOffset(route, c, s), s0: a, s1: bS,
        off: (s) => {
          if (s > endA) { const u = (s - endA) / (endB - endA); return { dl: side * .38 * u, dy: .3 * u }; }
          if (s < begB) { const u = (begB - s) / (begB - begA); return { dl: -side * .38 * u, dy: .3 * u }; }
          return zero;
        },
        anchors: [{ at: 's0', side }, { at: 's1', side }],
      });
      if (j < cuts.length) { start = k; prevCut = k; }
    }
  }
  for (const o of loops) {
    const dir = Math.sign(o.off), z = o.z;
    const a = sups[Math.max(0, supIdx(z.inFrom - 20) - 1)].s, bS = sups[Math.min(sups.length - 1, supIdx(z.outTo + 20))].s;
    const sh = (s: number) => loopShape(z, s);
    runs.push({
      // 分岐器の手前は本線の架線の 0.45m 外側を並走（交差部は少し高く）
      lat: (s) => o.lat(s) + dir * .45 * (1 - sh(s)),
      off: (s) => ({ dl: 0, dy: .22 * (1 - Math.min(1, sh(s) * 2)) }),
      s0: a, s1: bS, anchors: [{ at: 's0', side: dir }, { at: 's1', side: dir }],
    });
  }

  // 羽衣の3番線（並行区間）: 本線と同じ吊架線・トロリー線。車止め側の端だけ引留め、離れていく側は支線（coastal-landmarks.ts）の架線へ続く。
  for (const t of thirds) if (t.wire) {
    const dir = Math.sign(t.outer - t.main), i0 = supIdx(t.from), i1 = supIdx(t.to);
    const a = i0 < 0 ? 0 : i0, b = i1 < 0 ? sups.length - 1 : i1 - 1;
    if (b <= a) continue;
    runs.push({ lat: () => t.outer, off: () => zero, s0: sups[a].s, s1: sups[b].s, anchors: [{ at: t.wire.bumperAtFrom ? 's0' : 's1', side: dir }] });
  }

  // 単線の駅の右の線・副線: 分かれる手前は本線の架線の 0.45m 外側を並走（交差部は少し高く）
  for (const l of extraLines) {
    const i0 = supIdx(l.from), i1 = supIdx(l.to);
    const a = i0 < 0 ? -1 : i0, b = i1 < 0 ? sups.length - 1 : i1 - 1;
    if (a < 0 || b <= a) continue;
    const dir = l.lat((l.from + l.to) / 2) > 0 ? 1 : -1;
    const near = (s: number) => Math.max(0, 1 - Math.abs(l.lat(s) - islandOffset(route, 0, s, l.kind === 'passing' ? -1 : (dir as -1 | 1))) / 3);
    runs.push({
      lat: (s) => l.lat(s) + dir * .45 * near(s),
      off: (s) => ({ dl: 0, dy: .22 * near(s) }),
      s0: sups[a].s, s1: sups[b].s, anchors: [{ at: 's0', side: dir }, { at: 's1', side: dir }],
    });
  }

  // 追加の線路（複々線・番線・渡り線）: 並ぶ線路の範囲内（trackSpan）の区間だけ本線の柱から吊る。離れていく区間は buildBranchWires
  const branchParts: { l: TrackLine; s0: number; s1: number; pole?: number }[] = [];
  if (multi) for (const x of route.extraTracks ?? []) {
    if (x.noWire) continue;
    const l: TrackLine = { kind: 'extra', from: x.from, to: x.to, lat: s => profileLat(x.lat, s), bumpers: x.bumpers ?? [] };
    const same = (o: TrackLine) => o.kind === 'extra' && o.from === x.from && o.to === x.to && [x.from, (x.from + x.to) / 2, x.to].every(q => Math.abs(o.lat(q) - l.lat(q)) < 1e-6);
    const inside = (s: number) => { const [a, c] = trackSpan(route, s), v = l.lat(s); return v >= a - .01 && v <= c + .01; };
    let a0: number | null = null;
    const parts: [number, number, boolean][] = [];
    for (let s = l.from; s <= l.to + .01; s += 2) {
      const q = Math.min(s, l.to), inn = inside(q);
      if (a0 == null) { a0 = q; parts.push([q, q, inn]); continue; }
      const last = parts[parts.length - 1];
      if (last[2] === inn) last[1] = q; else parts.push([q, q, inn]);
    }
    const others = allLines.filter(o => !same(o));
    const nearOther = (s: number) => { let d = Infinity; for (const o of others) if (s >= o.from && s <= o.to) d = Math.min(d, Math.abs(o.lat(s) - l.lat(s))); return d; };
    for (const [p0, p1, inn] of parts) {
      if (p1 - p0 < 8) continue;
      if (!inn) { branchParts.push({ l, s0: p0, s1: p1, pole: x.poleOffset }); continue; }
      const i0 = supIdx(p0), i1 = supIdx(p1);
      const a = i0 < 0 ? -1 : i0, b = i1 < 0 ? sups.length - 1 : Math.max(a, i1 - 1);
      if (a < 0 || b <= a) continue;
      const mid = l.lat((p0 + p1) / 2), [sa, sc] = trackSpan(route, (p0 + p1) / 2), dir = mid - sa < sc - mid ? -1 : 1;
      const near = (s: number) => Math.max(0, 1 - nearOther(s) / 3);
      runs.push({
        lat: (s) => l.lat(s) + dir * .45 * near(s),
        off: (s) => ({ dl: 0, dy: .22 * near(s) }),
        s0: sups[a].s, s1: sups[b].s,
        anchors: [...(nearOther(sups[a].s) < 6 ? [] : [{ at: 's0' as const, side: dir }]), ...(nearOther(sups[b].s) < 6 ? [] : [{ at: 's1' as const, side: dir }])],
      });
    }
  }

  // 支持点での電線の位置
  const wireAt = (r: Run, sp: Support): WirePt => {
    const o = r.off(sp.s);
    return { lat: r.lat(sp.s) + sp.stg + o.dl, cy: CW + o.dy, my: sp.mw + o.dy, c: r.lat(sp.s) };
  };

  // ---------- 生成 ----------
  const chunks = new ChunkedBatch(CHUNK);
  const lines = new Map<number, number[]>();
  const L = (s: number) => { const k = Math.floor(s / CHUNK); let a = lines.get(k); if (!a) lines.set(k, a = []); return a; };
  const seg = (arr: number[], p: THREE.Vector3, q: THREE.Vector3) => arr.push(p.x, p.y, p.z, q.x, q.y, q.z);
  const frame = (s: number) => {
    const t = track.trackAt(s);
    return new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t.phi, 0)), new THREE.Vector3(1, 1, 1));
  };
  const world = (F: THREE.Matrix4, x: number, y: number, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(F);

  /** 柱の根元（線路基準）。高架・橋梁は床版、築堤は法面に埋める */
  const baseY = (s: number, lat: number, deck: boolean) => {
    if (deck) return 0;
    const y = T.trackY(s), g = T.groundY(s), dh = Math.max(0, y - g);
    if (dh < .08) return g - y - .05;
    const edge = lat < MID ? L0 - 2.5 : L1 + 2.5, dist = Math.abs(lat - edge);
    const surf = y - .02 - (dh + .03) * Math.min(1, dist / (1.6 * dh + .5));
    return surf - y - .25;
  };
  const styleOf = (k: Kind): PoleStyle =>
    k === 'concrete' ? 'concrete' : k === 'lattice' ? 'lattice' : k === 'wood' ? 'wood' : k === 'pipe' || k === 'viaduct' ? 'pipe' : 'h';

  const feeders: Record<'L' | 'R' | 'G', (THREE.Vector3 | null)[]> = { L: [], R: [], G: [] };

  for (const sp of sups) {
    const b = chunks.at(sp.s), F = frame(sp.s);
    b.parent = F;
    const present = runs.filter(r => sp.s >= r.s0 - .01 && sp.s <= r.s1 + .01).map(r => wireAt(r, sp)).sort((p, q) => p.lat - q.lat);
    // 近い電線（オーバーラップ・分岐器の並走）をまとめる
    const groups: WirePt[][] = [];
    for (const w of present) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(w.c - g[0].c) < 1.3) g.push(w); else groups.push([w]);
    }
    const under = T.structureAt(sp.s, 0);
    const deck = under?.kind === 'viaduct' || under?.kind === 'bridge';
    if (sp.kind === 'tunnel') {
      // 天井から吊る剛な金具（碍子は白）
      for (const g of groups) {
        const side = g[0].c < MID ? -1 : 1, xd = g[0].c + side * .85;
        drop(b, ceilingY(xd) - .03, g, side, COL.fit, COL.insT);
      }
      // き電線・架空地線は側壁の腕金に
      const wl = L0 - 2.6, wr = L1 + 2.6, yf = 4.6;
      for (const [x, d] of [[wl, -1], [wr, 1]] as const) {
        box(b, x + d * .15, yf - .1, 0, .3, .06, .1, COL.fit);
        insulator(b, x, yf - .05, 0, 0, 1, 0, 2, COL.insT);
      }
      feeders.L.push(world(F, wl, yf + .08)); feeders.R.push(world(F, wr, yf + .08)); feeders.G.push(world(F, wl - .1, 3.7));
      box(b, wl - .14, 3.7, 0, .12, .05, .05, COL.fit);
      continue;
    }
    const style = styleOf(sp.kind);
    const yl = baseY(sp.s, sp.pl, deck), yr = baseY(sp.s, sp.pr, deck);
    const portal = sp.kind === 'loop' || sp.kind === 'station' || sp.kind === 'pipe' || sp.kind === 'viaduct' || sp.kind === 'bridge' || sp.kind === 'lattice';
    const maxMy = Math.max(sp.mw, ...present.map(w => w.my));
    let topL: number, topR: number;
    if (portal) {
      const bs: BeamStyle = sp.kind === 'loop' || sp.kind === 'bridge' ? 'truss' : sp.kind === 'station' ? 'h' : sp.kind === 'lattice' ? 'lattice' : 'pipe';
      const dep = bs === 'truss' ? .8 : bs === 'h' ? .36 : bs === 'lattice' ? .6 : .55;
      const y0 = maxMy + .75;
      topL = topR = y0 + dep + .1;
      pole(b, style, sp.pl, yl, topL, deck); pole(b, style, sp.pr, yr, topR, deck);
      beam(b, bs, sp.pl, sp.pr, y0, dep);
      // 柱とビームの接合部
      for (const x of [sp.pl, sp.pr]) box(b, x, y0 + dep / 2, 0, .45, dep + .1, .45, style === 'lattice' ? COL.lattice : COL.h);
      for (const g of groups) drop(b, y0, g, g[0].c < MID ? -1 : 1, COL.fit, COL.ins);
    } else {
      // 片側の柱ごとに可動ブラケット（左柱 = 左側の線路群、右柱 = 右側）
      topL = topR = maxMy + .95;
      pole(b, style, sp.pl, yl, topL, deck); pole(b, style, sp.pr, yr, topR, deck);
      const bcol = style === 'wood' ? COL.dark : COL.fit;
      for (const g of groups) bracket(b, g[0].c < MID ? sp.pl : sp.pr, g, bcol);
      if (style === 'wood') for (const x of [sp.pl, sp.pr]) box(b, x, topL - .35, 0, .14, .14, 1.3, COL.wood); // 腕木
    }
    // き電線（柱頂の碍子）・架空地線（左柱の外側の腕）
    for (const [x, top] of [[sp.pl, topL], [sp.pr, topR]] as const) insulator(b, x, top + .2, 0, 0, 1, 0, 3);
    feeders.L.push(world(F, sp.pl, topL + .36)); feeders.R.push(world(F, sp.pr, topR + .36));
    const gx = sp.pl - .55;
    rod(b, P.box, sp.pl, topL - .45, 0, gx, topL - .45, 0, .06, COL.dark);
    feeders.G.push(world(F, gx, topL - .43));
  }

  // 電線（吊架線・トロリー線・ハンガー）
  for (const r of runs) {
    const nodes = sups.filter(p => p.s >= r.s0 - .01 && p.s <= r.s1 + .01);
    for (let j = 0; j + 1 < nodes.length; j++) {
      const A = nodes[j], B = nodes[j + 1], span = B.s - A.s, n = Math.max(2, Math.round(span / 5));
      const arr = L(A.s), tun = A.kind === 'tunnel' || B.kind === 'tunnel', sag = (tun ? .07 : .16) * (span / 50) ** 2;
      let pc: THREE.Vector3 | null = null, pm: THREE.Vector3 | null = null;
      for (let k = 0; k <= n; k++) {
        const u = k / n, s = A.s + span * u, o = r.off(s);
        const chord = T.curvature(s) * u * (1 - u) * span * span / 2; // 弦（曲線の内側へ寄る）
        const lat = r.lat(s) + A.stg + (B.stg - A.stg) * u + chord + o.dl;
        const c = track.at(s, lat, CW + o.dy), m = track.at(s, lat, A.mw + (B.mw - A.mw) * u + o.dy - sag * 4 * u * (1 - u));
        if (pc && pm) { seg(arr, pc, c); seg(arr, pm, m); }
        if (k > 0 && k < n) seg(arr, m, c);
        pc = c; pm = m;
      }
    }
  }

  // き電線・架空地線（柱間に弛度を付けた線）
  for (const key of ['L', 'R', 'G'] as const) {
    const pts = feeders[key];
    for (let j = 0; j + 1 < pts.length; j++) {
      const a = pts[j], c = pts[j + 1];
      if (!a || !c) continue;
      const arr = L(sups[j].s), A = sups[j], B = sups[j + 1];
      // 坑口をまたぐ径間は坑口で側壁の高さへ下ろす（面壁を貫かないように）
      const inA = A.kind === 'tunnel', inB = B.kind === 'tunnel';
      const st = inA !== inB ? structs.find(q => q.kind === 'tunnel' && (inA ? Math.abs(q.to - A.s) < 60 : Math.abs(q.from - B.s) < 60)) : undefined;
      const mids: THREE.Vector3[] = [];
      if (st) {
        const ps = inA ? st.to + 1.5 : st.from - 1.5, F = frame(ps);
        const x = key === 'R' ? L1 + 2.6 : key === 'L' ? L0 - 2.6 : L0 - 2.7;
        mids.push(world(F, x, key === 'G' ? 3.7 : 4.68));
      }
      const chain = [a, ...mids, c];
      for (let h = 0; h + 1 < chain.length; h++) {
        const p0 = chain[h], p1 = chain[h + 1], sag = .35 * (p0.distanceTo(p1) / 50) ** 2, N = 6;
        let prev = p0;
        for (let k = 1; k <= N; k++) {
          const u = k / N, p = p0.clone().lerp(p1, u); p.y -= sag * 4 * u * (1 - u);
          seg(arr, prev, p); prev = p;
        }
      }
    }
  }

  // 引留め（重錘式の自動張力調整装置）
  for (const r of runs) for (const an of r.anchors) {
    const sp = sups.find(p => Math.abs(p.s - (an.at === 's0' ? r.s0 : r.s1)) < .01);
    if (!sp || sp.kind === 'tunnel') continue;
    const away = an.at === 's0' ? -1 : 1;
    let s = sp.s + away * 14;
    for (let k = 0; k < 4 && avoid(s); k++) s += away * 4;
    if (T.structureAt(s, 2)?.kind === 'tunnel') continue;
    const kind = kindAt(s), under = T.structureAt(s, 0), deck = under?.kind === 'viaduct' || under?.kind === 'bridge';
    const [left, right] = railEdges(s);
    const el = route.stations.some(q => q.elevated && !q.loop && s >= q.platform.from - 10 && s <= q.platform.to + 10);
    const edge = el ? 6.8 : route.theme === 'coast' && deck ? 2.9 : 3.3;
    // 引留め柱も本線だけでなく待避線・副線・第3線の外へ置く。
    const x = an.side < 0 ? left - edge : right + edge, d = -an.side;
    const b = chunks.at(s), F = frame(s); b.parent = F;
    const style = styleOf(kind === 'loop' || kind === 'station' ? 'hbeam' : kind), y0 = baseY(s, x, deck), top = sp.mw + .7;
    pole(b, style, x, y0, top, deck);
    // 滑車と重錘（柱の外側）
    const xw = x - d * .38;
    for (const yy of [sp.mw, CW + .1]) {
      rod(b, P.box, x, yy, 0, x + d * .45, yy, 0, .07, COL.dark);
      insulator(b, x + d * .8, yy, 0, 0, 0, 1, 3);
    }
    rod(b, CYL8, xw - .03, sp.mw + .25, 0, xw + .03, sp.mw + .25, 0, .42, COL.dark, .42);
    const n = 9;
    for (let k = 0; k < n; k++) box(b, xw, 1.4 + y0 + k * .15, 0, .34, .12, .34, COL.weight);
    rod(b, P.box, xw, 1.3 + y0, 0, xw, sp.mw + .1, 0, .025, COL.dark);
    const arr = L(s);
    // 電線の終端 → 引留め点（碍子）
    const rw = r.off(sp.s), lat = r.lat(sp.s) + sp.stg + rw.dl;
    const endC = track.at(sp.s, lat, CW + rw.dy), endM = track.at(sp.s, lat, sp.mw + rw.dy);
    const pC = world(F, x + d * 1.0, CW + .1, 0), pM = world(F, x + d * 1.0, sp.mw, 0);
    seg(arr, endC, pC); seg(arr, endM, pM);
    seg(arr, world(F, xw, sp.mw + .46), world(F, xw, 1.3 + y0 + n * .15));
    // 支線（柱頂 → 地面）
    seg(arr, world(F, x, top - .1), world(F, x - d * .4, y0 + .1, -away * 7));
    box(b, x - d * .4, y0 + .1, -away * 7, .5, .3, .5, COL.found);
  }

  // 離れていく追加の線路（高野線の合流・汐見橋線・入出庫線）: 線路の外側に鋼管柱と腕金、電線
  for (const bp of branchParts) {
    const { l } = bp, side = l.lat((bp.s0 + bp.s1) / 2) < 0 ? -1 : 1, po = bp.pole ?? side * 2.7;
    let pc: THREE.Vector3 | null = null, pm: THREE.Vector3 | null = null;
    for (let s = bp.s0 + 6; s < bp.s1 - 2; s += 40) {
      const lat = l.lat(s), x = lat + po, F = frame(s), b = chunks.at(s); b.parent = F;
      const under = T.structureAt(s, 0), deck = under?.kind === 'viaduct' || under?.kind === 'bridge';
      const y0 = deck ? 0 : T.groundY(s) - T.trackY(s), top = CW + SYS + .9;
      pole(b, 'pipe', x, y0, top, deck);
      const g: WirePt[] = [{ lat, cy: CW, my: CW + SYS, c: lat }];
      bracket(b, x, g, COL.fit);
      const c = track.at(s, lat, CW), m = track.at(s, lat, CW + SYS);
      const arr = L(s);
      if (pc && pm) { seg(arr, pc, c); seg(arr, pm, m); const mid = pc.clone().lerp(c, .5); seg(arr, mid, pm.clone().lerp(m, .5).setY(pm.y / 2 + m.y / 2 - .15)); }
      pc = c; pm = m;
    }
  }

  // ---------- メッシュ化・カリング ----------
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x24272a, fog: true });
  const meshes: THREE.Mesh[] = [];
  const groups = new Map<string, THREE.Group>();
  for (const g of chunks.build({ st: mat }, scene)) { g.name = 'catenary-' + g.name; groups.set(g.name, g); }
  for (const [k, arr] of lines) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const ls = new THREE.LineSegments(geo, lineMat); ls.name = 'catenary-wire';
    let g = groups.get('catenary-chunk' + k);
    if (!g) { g = new THREE.Group(); g.name = 'catenary-chunk' + k; scene.add(g); groups.set(g.name, g); }
    g.add(ls);
  }
  for (const g of groups.values()) {
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.userData.castOverride = false; meshes.push(o as THREE.Mesh); } });
    cullByDistance(ctx, g, CULL);
  }
  // 影: 高画質（影マップ 2048 以上）のときだけ架線柱も影を落とす
  // （影の再タグ付けで上書きされても毎フレーム戻す。対象はチャンク数ぶんのみ）
  ctx.events.on('frame', () => {
    const h = ctx.renderer.shadowMap.enabled && ctx.env.sun.shadow.mapSize.x >= 2048;
    for (const m of meshes) if (m.castShadow !== h) { m.castShadow = h; m.receiveShadow = true; }
  });
}
