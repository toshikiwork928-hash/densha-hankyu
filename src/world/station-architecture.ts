import type { Station, Route } from '../route/types';
import { customPlatformEdges, trackLines, trackSpan } from '../route/service';
import { GeoBatch, M, P } from './batch';

export type CanopyProfile = {
  kind: 'platform-wall' | 'canopy';
  Yroof: number;
  roofRatio: number;
  supportSpacing: number;
  roofColor: number;
  wallColor: number;
  supportColor?: number;
  roofShape?: 'gable' | 'butterfly';
  braces?: boolean;
};
export type PlatformWallProfile = CanopyProfile & { kind: 'platform-wall' };

export type HallProfile = {
  kind: 'hall';
  roofColor: number;
  wallColor: number;
  roofOpening?: number;
  roofOpeningOffsets?: number[];
  /** 'split-roof': 線路とホームの上を複数に分けた屋根で覆い、外周は腰壁と帯窓だけで上を開ける（泉佐野）。未指定は外周壁のある山形の大屋根 */
  style?: 'split-roof';
};

export type StationArchitectureProfile = CanopyProfile | HallProfile;

const HALLS: Record<string, HallProfile> = {
  '新今宮': { kind: 'hall', roofColor: 0x59646e, wallColor: 0x7b858c },
  '天下茶屋': { kind: 'hall', roofColor: 0x79838a, wallColor: 0xd2d0c8, roofOpening: 3.5, roofOpeningOffsets: [-5.2, 5.2] },
  // 泉佐野: 白い丸柱と鉄骨の分割屋根、縁に透光帯、外側の線路の脇は白〜薄灰色のパネル壁と帯窓で上は開く（docs/izumisano-station-reference.md 4・6章）
  '泉佐野': { kind: 'hall', style: 'split-roof', roofColor: 0xa9b1b5, wallColor: 0xe9e8e2 },
};

const PLATFORM_WALLS: Record<string, PlatformWallProfile> = {
  '羽衣': { kind: 'platform-wall', Yroof: 4.35, roofRatio: .78, supportSpacing: 10, roofColor: 0x68747d, wallColor: 0x8d969b },
  '石津川': { kind: 'platform-wall', Yroof: 4.35, roofRatio: .72, supportSpacing: 10, roofColor: 0x68747d, wallColor: 0x8d969b },
  '松ノ浜': { kind: 'platform-wall', Yroof: 4.35, roofRatio: .86, supportSpacing: 10, roofColor: 0x68747d, wallColor: 0xe3dfd2, supportColor: 0x9c6847 },
  '北助松': { kind: 'platform-wall', Yroof: 4.35, roofRatio: .78, supportSpacing: 8, roofColor: 0x68747d, wallColor: 0xe2e0d8, supportColor: 0xd6d4c9, braces: true },
  '忠岡': { kind: 'platform-wall', Yroof: 4.35, roofRatio: .72, supportSpacing: 8, roofColor: 0x6c706b, wallColor: 0xe1dfd5, supportColor: 0xc8c6b8, braces: true },
  '和泉大宮': { kind: 'platform-wall', Yroof: 4.35, roofRatio: .72, supportSpacing: 8, roofColor: 0x78766d, wallColor: 0xe4dfd2, supportColor: 0xd7d0bc, braces: true },
};

const CANOPIES: Record<string, CanopyProfile> = {
  '岸里玉出': { kind: 'canopy', Yroof: 4.35, roofRatio: .8, supportSpacing: 10, roofColor: 0x79817d, wallColor: 0xdad9cf, supportColor: 0xdad9cf, roofShape: 'gable', braces: true },
  '住吉大社': { kind: 'canopy', Yroof: 4.35, roofRatio: .75, supportSpacing: 10, roofColor: 0x656b66, wallColor: 0xcccccc, supportColor: 0xac4633 },
  '泉大津': { kind: 'canopy', Yroof: 4.35, roofRatio: .85, supportSpacing: 10, roofColor: 0x5c7a8e, wallColor: 0xcccccc, supportColor: 0x6c91ad, braces: true },
  '高石': { kind: 'canopy', Yroof: 4.35, roofRatio: .85, supportSpacing: 10, roofColor: 0x798183, wallColor: 0xcccccc, supportColor: 0xb6b6aa, roofShape: 'butterfly' },
  '春木': { kind: 'canopy', Yroof: 4.35, roofRatio: .72, supportSpacing: 8, roofColor: 0x737970, wallColor: 0xcccccc, supportColor: 0xa6b2a0, braces: true },
  '橋本': { kind: 'canopy', Yroof: 4.35, roofRatio: .75, supportSpacing: 8, roofColor: 0x77786d, wallColor: 0xcccccc, supportColor: 0xd6d1c4, roofShape: 'gable', braces: true },
  '九度山': { kind: 'canopy', Yroof: 4.35, roofRatio: .4, supportSpacing: 8, roofColor: 0x77786d, wallColor: 0xcccccc, supportColor: 0xd6d1c4, braces: true },
  '高野下': { kind: 'canopy', Yroof: 4.35, roofRatio: .4, supportSpacing: 8, roofColor: 0x77786d, wallColor: 0xcccccc, supportColor: 0x9d8673, roofShape: 'gable', braces: true },
  '極楽橋': { kind: 'canopy', Yroof: 4.35, roofRatio: .85, supportSpacing: 8, roofColor: 0x77786d, wallColor: 0xcccccc, supportColor: 0x63503d, roofShape: 'gable', braces: true },
};

export function architectureOf(name: string): StationArchitectureProfile | undefined {
  return HALLS[name] ?? PLATFORM_WALLS[name] ?? CANOPIES[name];
}

/** 写真で確認した切妻・V字上屋。線路上へ広げず既存ホームの屋根幅を使う。 */
export function addCanopyRoof(b: GeoBatch, x: number, width: number, len: number, profile: CanopyProfile): void {
  const rise = profile.roofShape === 'gable' ? .55 : -.55;
  for (const sign of [-1, 1]) {
    const half = width / 2, angle = Math.atan2(-sign * rise, half);
    const w = Math.hypot(half, rise);
    const y = profile.Yroof + (profile.roofShape === 'butterfly' ? .55 : 0) + rise / 2;
    b.add('body', P.box, M(x + sign * width / 4, y, 0, 0, w, .14, len, 0, angle), profile.roofColor);
    b.add('body', P.box, M(x + sign * width / 4, y - .13, 0, 0, w, .08, len, 0, angle), 0xdcdcd8);
  }
}

export function addCanopyBraces(b: GeoBatch, x: number, width: number, len: number, profile: CanopyProfile): void {
  if (!profile.braces) return;
  for (let z = -len / 2 + 4; z <= len / 2 - 4; z += profile.supportSpacing) for (const sign of [-1, 1]) {
    const dx = sign * Math.min(width / 3, 1.35), dy = .8;
    b.add('body', P.box, M(x + dx / 2, profile.Yroof - .85, z, 0, Math.hypot(dx, dy), .12, .12, 0, Math.atan2(dy, dx)), profile.supportColor ?? profile.roofColor);
  }
}

export interface HallBounds {
  from: number; to: number; left: number; right: number;
  /** custom 駅の島式ホーム（横位置と幅） */
  islands: { lat: number; width: number }[];
  /** 駅中心での線路の横位置（昇順） */
  tracks: number[];
}

export function hallBounds(route: Route, sta: Station): HallBounds {
  const sc = (sta.platform.from + sta.platform.to) / 2;
  const span = trackSpan(route, sc);
  const platform = customPlatformEdges(route, sc, 0);
  const left = Math.min(span[0] - 4.2, (platform?.[0] ?? Infinity) - .25);
  const right = Math.max(span[1] + 4.2, (platform?.[1] ?? -Infinity) + .25);
  const from = Math.min(sta.platform.from, ...(sta.customPlatforms ?? []).map(p => p.from ?? sta.platform.from)) - 10;
  const to = Math.max(sta.platform.to, ...(sta.customPlatforms ?? []).map(p => p.to ?? sta.platform.to)) + 10;
  const islands = (sta.customPlatforms ?? []).flatMap(p => p.kind === 'island' ? [{ lat: p.lat, width: p.width }] : []);
  const tracks = trackLines(route).filter(l => sc >= l.from && sc <= l.to).map(l => l.lat(sc)).sort((a, c) => a - c);
  return { from, to, left, right, islands, tracks };
}

/** groundDy = 地面から線路面までの高さの符号反転（地面の高さ − 線路の高さ、負）。split-roof の駅舎が使う */
export function addHallArchitecture(b: GeoBatch, bounds: HallBounds, profile: HallProfile, groundDy = 0): void {
  if (profile.style === 'split-roof') { addSplitRoofHall(b, bounds, profile, groundDy); return; }
  const len = bounds.to - bounds.from, z = (bounds.from + bounds.to) / 2;
  const width = bounds.right - bounds.left;
  const roofY = 9.8;
  const mid = (bounds.left + bounds.right) / 2, rise = 1.6;
  const opening = profile.roofOpening ?? 0;
  const gaps = opening ? (profile.roofOpeningOffsets ?? [0]).map(x => [mid + x - opening / 2, mid + x + opening / 2]) : [];
  const cuts = [...new Set([bounds.left, mid, bounds.right, ...gaps.flat().filter(x => x > bounds.left && x < bounds.right)])].sort((a, c) => a - c);
  const roofAt = (x: number) => roofY + rise * (1 - Math.abs(x - mid) / (width / 2));
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], c = cuts[i], x = (a + c) / 2;
    if (gaps.some(([lo, hi]) => x > lo && x < hi)) continue;
    const slope = Math.atan2(roofAt(c) - roofAt(a), c - a);
    const w = Math.hypot(c - a, roofAt(c) - roofAt(a));
    b.add('body', P.box, M(x, roofAt(x), z, 0, w, .18, len, 0, slope), profile.roofColor);
    b.add('body', P.box, M(x, roofAt(x) - .16, z, 0, w, .08, len, 0, slope), 0xe3e2dc);
  }
  for (const x of [bounds.left, bounds.right]) {
    b.add('body', P.box, M(x, 1.925, z, 0, .18, 1.65, len), profile.wallColor);
    b.add('body', P.box, M(x, 6.55, z, 0, .18, 6.3, len), profile.wallColor);
    for (let zz = bounds.from + 4; zz <= bounds.to - 4; zz += 10) {
      b.add('body', P.box, M(x, 5.5, zz, 0, .24, 8.8, .24), profile.roofColor);
    }
  }
  // 線路上の柱を避け、両外周の柱から三角形の鉄骨を渡す。
  for (let zz = bounds.from + 4; zz <= bounds.to - 4; zz += 10) {
    b.add('body', P.box, M(mid, 9.4, zz, 0, width, .18, .18), 0xbfc3c3);
    for (const x of [bounds.left, bounds.right]) {
      const dx = mid - x, dy = rise;
      b.add('body', P.box, M((mid + x) / 2, 9.55 + dy / 2, zz, 0, Math.hypot(dx, dy), .16, .16, 0, Math.atan2(dy, dx)), 0xbfc3c3);
    }
    b.add('body', P.box, M(mid, 10.3, zz, 0, .14, 1.8, .14), 0xbfc3c3);
  }
  for (const zz of [bounds.from + 1, bounds.to - 1]) b.add('body', P.box, M((bounds.left + bounds.right) / 2, roofY, zz, 0, width, .18, .18), profile.roofColor);
}

export function addPlatformWall(b: GeoBatch, x: number, len: number, profile: CanopyProfile): void {
  // 腰壁と屋根に接続する上部パネルの間は帯窓の開口。窓帯を箱で埋めない。
  b.add('body', P.box, M(x, 1.65, 0, 0, .12, 1.1, len), profile.wallColor);
  b.add('body', P.box, M(x, (3.4 + profile.Yroof) / 2, 0, 0, .12, profile.Yroof - 3.4, len), profile.wallColor);
  for (let z = -len / 2 + 4; z <= len / 2 - 4; z += profile.supportSpacing) {
    b.add('body', P.box, M(x, 2.75, z, 0, .2, 3.25, .2), profile.wallColor);
  }
}

// ---------- 泉佐野: 分割屋根の駅舎 ----------
// 寸法（屋根高・柱間隔・壁高・屋根の分割位置・駅舎の大きさ）は写真からの実測値ではなく、ゲーム用の近似。
// 写真から読み取ったのは、白い丸柱と鉄骨（V字・K字の斜材）の屋根、縁の透光帯、屋根と屋根の間の空、
// 外側の線路の脇の白〜薄灰色のパネル壁とその上の帯窓、壁の上が開いていること。乱数は使わない。
const SPLIT = {
  /** 屋根の上面の高さ（線路面基準） */
  roofY: 9.4, roofT: .22,
  /** 柱間隔 [m]（柱列に沿う方向） */
  frame: 12,
  /** ホーム面の高さと、島式ホームの柱列の中心からの距離（階段口の幅 ±1.3m の外側） */
  platformY: 1.1, columnDx: 1.6,
  /** 屋根の間の隙間（空が見える）の幅と、縁の透光帯の幅 */
  slit: 2.0, edge: .9,
  /** 外周のパネル壁の高さ、帯窓の上端（その上は開く） */
  panelTop: 3.2, windowTop: 4.6,
  white: 0xf1f1ec, glass: 0x5f7a88, daylight: 0xcfe3ea, steel: 0xe6e8e4,
};

function addSplitRoofHall(b: GeoBatch, bounds: HallBounds, profile: HallProfile, dy: number): void {
  const { from, to, left, right, islands, tracks } = bounds;
  const len = to - from, zc = (from + to) / 2, C = SPLIT;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: number, rz = 0) => b.add('body', P.box, M(x, y, z, 0, w, h, d, 0, rz), col);
  const zs: number[] = [];
  for (let z = from + C.frame / 2; z <= to - C.frame / 2 + .01; z += C.frame) zs.push(z);

  // 屋根: 両側にホームのある線路（本線）の真上に隙間を空け、外周・隙間の縁に透光帯を置く
  const sides = (t: number) => islands.filter(p => Math.abs(Math.abs(p.lat - t) - (p.width / 2 + 1.7)) < .3).length;
  const slits = tracks.filter(t => sides(t) === 2 && t > left + 3 && t < right - 3);
  const cuts: number[] = [left];
  for (const t of slits) cuts.push(t - C.slit / 2, t + C.slit / 2);
  cuts.push(right);
  for (let i = 0; i < cuts.length; i += 2) {
    const a = cuts[i], c = cuts[i + 1], w = c - a, x = (a + c) / 2;
    box(x, C.roofY, zc, w, C.roofT, len, profile.roofColor);
    box(x, C.roofY - .16, zc, w - .1, .08, len - .1, 0xe3e2dc);
    // 縁の透光帯（スラブより少し厚く、上面が少し高い）。長辺の両縁と、列車の出入りする短辺の縁
    for (const ex of [a + C.edge / 2 - .005, c - C.edge / 2 + .005]) box(ex, C.roofY + .01, zc, C.edge, C.roofT + .02, len + .01, C.daylight);
    for (const ez of [from + C.edge / 2, to - C.edge / 2]) box(x, C.roofY + .01, ez, w + .01, C.roofT + .02, C.edge, C.daylight);
  }

  // ホーム上の柱列: 階段口の両脇に白い丸柱を対で立て、梁（鉄骨）と斜材（V字・K字）で屋根を支える。柱はホームの上だけで、線路の上には立てない
  const top = C.roofY - C.roofT / 2 - .1;
  for (const p of islands) for (const z of zs) {
    for (const sx of [-1, 1]) {
      const cx = p.lat + sx * C.columnDx;
      b.add('body', P.cyl, M(cx, (C.platformY + top) / 2, z, 0, .36, top - C.platformY, .36), C.white);
      // 柱頭から梁の端へ斜めに上がる斜材（外へ開く）
      const dx = sx * 1.5, dyb = 2.3;
      box(cx + dx / 2, top - dyb / 2 - .1, z, Math.hypot(dx, dyb), .13, .13, C.steel, Math.atan2(dyb, dx));
    }
    // 梁: 屋根の下面に沿って対の柱を渡し、屋根の張り出しの下まで伸ばす
    box(p.lat, top + .05, z, C.columnDx * 2 + 3.6, .3, .18, C.steel);
  }
  // 柱列どうしを結ぶ縦通しの梁
  for (const p of islands) for (const sx of [-1, 1]) box(p.lat + sx * C.columnDx, top + .05, zc, .16, .3, len - C.edge * 2, C.steel);

  // 外周: 低いパネル壁（白〜薄灰色）と帯窓。その上は柱と斜材だけで開く
  const wallH = C.panelTop - .1;
  for (const [x, sx] of [[left, 1], [right, -1]] as const) {
    box(x, .1 + wallH / 2, zc, .16, wallH, len, profile.wallColor);
    box(x, (C.panelTop + C.windowTop) / 2, zc, .1, C.windowTop - C.panelTop, len, C.glass);
    box(x, C.panelTop, zc, .22, .1, len, C.white);
    box(x, C.windowTop, zc, .22, .1, len, C.white);
    for (let z = from + 3; z <= to - 2.9; z += 4) {
      box(x + sx * .06, .1 + wallH / 2, z, .05, wallH, .08, 0xcdcdc6); // パネルの目地（線路側の面）
      box(x, (C.panelTop + C.windowTop) / 2, z, .14, C.windowTop - C.panelTop, .1, C.white); // 窓の方立
    }
    // 壁の上は開く: 壁の上端から屋根の縁までを細い柱と斜材で支えるだけにする
    for (const z of zs) {
      const hh = C.roofY - C.roofT / 2 - C.windowTop;
      box(x, C.windowTop + hh / 2, z, .22, hh, .22, C.white);
      const dx = sx * 3, dyb = 3.2;
      box(x + dx / 2, C.roofY - C.roofT / 2 - dyb / 2 - .1, z, Math.hypot(dx, dyb), .13, .13, C.steel, Math.atan2(dyb, dx));
    }
  }

  // 蛍光灯の吊りレール: 夜の照明（env/night-lights.ts）の発光体は島式ホームの中央、高さ 4.1m に並ぶので、屋根から吊って支える
  const railLen = len * .6 + 4;
  for (const p of islands) {
    box(p.lat, 4.22, zc, .14, .08, railLen, 0x8a9096);
    for (const z of zs) if (z + C.frame / 2 < zc + railLen / 2 - 1 && z > zc - railLen / 2) box(p.lat, (4.26 + top) / 2, z + C.frame / 2, .05, top - 4.26, .05, 0x8a9096); // 吊り棒（柱と柱の間）
  }

  addSplitRoofStationBuildings(b, bounds, dy);
}

/** 東西の出入口と改札階（中2階）の駅舎。高架の両脇に貼り付く低い建物（階段・改札の内部は作らない） */
function addSplitRoofStationBuildings(b: GeoBatch, bounds: HallBounds, dy: number): void {
  const { tracks } = bounds, zc = (bounds.from + bounds.to) / 2;
  if (!tracks.length || dy > -3) return; // 地上駅など、高架の脇に駅舎を置けないときは作らない
  const height = Math.max(3, Math.min(7.4, -dy - 1.6)); // 床版の下に収める
  const depth = 8, length = 40;
  for (const [edge, sx] of [[tracks[0] - 3.5, -1], [tracks[tracks.length - 1] + 3.5, 1]] as const) {
    const x = edge + sx * depth / 2, outer = edge + sx * depth;
    b.add('body', P.boxB, M(x, dy, zc, 0, depth, height, length), 0xe2ded4);
    // 改札階の帯窓（高架の脇の中2階）
    b.add('body', P.box, M(outer + -sx * .02, dy + height * .62, zc, 0, .05, 1.5, length - 4), 0x4a6070);
    // 出入口と庇
    b.add('body', P.box, M(outer + -sx * .02, dy + 1.7, zc, 0, .06, 3.2, 9), 0x2b343d);
    b.add('body', P.box, M(outer + sx * 1.1, dy + 3.5, zc, 0, 2.4, .16, 11), 0x8a9096);
    for (const dz of [-4.8, 4.8]) b.add('body', P.box, M(outer + sx * 2.0, dy + 1.75, zc + dz, 0, .16, 3.5, .16), 0xb9bdc0);
    // 屋根の張り出し
    b.add('body', P.box, M(x, dy + height + .2, zc, 0, depth + .4, .4, length + .4), 0x6b7680);
  }
}
