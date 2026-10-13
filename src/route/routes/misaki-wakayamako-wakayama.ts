// 南海本線 みさき公園〜和歌山港（misaki-wakayamako）の和歌山側の景観・配線: 紀ノ川橋梁、紀ノ川駅の加太線の分岐、和歌山市駅、和歌山港線の単線。
// 座標は下り（みさき公園 → 和歌山港）のもの。上りは reverseRoute が写す。描画は world/wakayamashi.ts・structures.ts・coastal-landmarks.ts ほか。
// 出典: docs/south-scenery-research-2.md（WebSearch/WebFetch の調査。画像は読めていない）。寸法のうち出典に無いものは「不明（ゲーム用の概形）」。
//
// 横位置（左が負。route.tracks の 0 = 自線（下り線）、4 = 対向線）
//   紀ノ川橋梁: 上り線・下り線は別々の単線橋（橋長 約 628m）。北（紀ノ川駅側）から桁橋16連（約 22m）、赤い曲弦トラス3連（約 62m）、桁橋3連。
//     下り線（1922年、上流側＝進行方向の左）はワーレン型、上り線（1903年、下流側＝右）はプラット型。橋脚は明治側（上り線）が煉瓦積み。
//     水面からの高さ・線路の中心間隔は不明（ゲーム用: 中心間隔 9m、橋の下の地面を 4m 下げる）。
//   紀ノ川駅: 相対式2面2線。ホームの難波寄りの端のすぐ先で、加太線が下り線・上り線の両方から右へ平面で分かれる（複線で並走し、約 300m 先で1本に合流）。確かめた内容は下の「紀ノ川駅の加太線の分岐」。
//   和歌山市駅: 地上・2面5線。左から JR | 3番線（加太線・行き止まり）| 島式ホーム | 4番線（自列車・下り）| 5番線（上り）| 島式ホーム | 6・7番線 | 車庫。
//     3番線: 加太線（行き止まり）。4・5番線: 本線と和歌山港線。6番線: 本線（なんば方面）。7番線: 和歌山港線。6・7番線は同じ線を中ほどで分け、間に車止め。
//     和歌山港へ通じるのは 4・5・7番線（駅の先で1本に集まって単線）。左右の並びと各線の長さは不明（ゲーム用の概形）。
//   和歌山港線: 実際は単線。route.tracks は2本のままで、4（対向線）を 0（自線）に重ね、重なる範囲は描かない（hiddenTracks）。
import type { ExtraTrack, LatProfile, Route } from '../types';

// ---- 紀ノ川橋梁（south.json の橋: 営業キロ 28593〜29243 = 10873〜11523） ----
export const KB = { from: 10873, to: 11523 } as const;
/** 桁橋の1連 22.1m（70フィート）、トラスの1連 62.1m（200フィート）。桁橋16連 + トラス3連 + 桁橋3連 = 606.2m。橋の範囲 650m との差は両端の取り付けに割る */
const G = 22.1, TRUSS = 62.1;
const A0 = KB.from + (KB.to - KB.from - (19 * G + 3 * TRUSS)) / 2;
const r1 = (x: number) => Math.round(x * 10) / 10;
/** 橋脚（22径間 = 21本。出典に本数の記載は無く、径間数からの推測） */
export const KB_PIERS: number[] = [
  ...Array.from({ length: 16 }, (_, k) => A0 + (k + 1) * G),
  ...[1, 2, 3].map(j => A0 + 16 * G + j * TRUSS),
  ...[1, 2].map(k => A0 + 16 * G + 3 * TRUSS + k * G),
].map(r1);
/** トラス3連の中心 */
export const KB_TRUSS_CENTERS: number[] = [0, 1, 2].map(j => r1(A0 + 16 * G + (j + .5) * TRUSS));
/** 2本の橋の中心間隔 [m]（不明。ゲーム用） */
const KB_GAP = 9;
const KB_TRUSS_COLOR = 0xa8392c;

// ---- 紀ノ川駅の加太線の分岐（紀ノ川駅は営業キロ 9700〜9920 がホーム） ----
// 確かめた配線（2026-10-10。配線略図.net 南海本線 figures/011_08.svg・加太線 figures/010_01.svg、Wikipedia「紀ノ川駅」「南海加太線」、OSM の線路）:
//   - 分岐はホームの難波寄りの端のすぐ先（ホーム端から 10m 弱）。平面分岐で、下り線・上り線の両方から加太線へつながる。
//   - 加太線へ出る線路は 2本（下り線から1本、上り線から1本）。下り線からの線は上り線を平面で横切る。
//     OSM では2本が 4m ほど離れて並走する複線で、約 300m 先（梶取信号所の手前）で1本に合流する（Wikipedia「紀ノ川駅合流部分だけはごくわずかに複線」）。
//   - 合流後は単線で南西（進行方向「和歌山市」向きの右・川の北岸の側）へ離れていく。
//   - 紀ノ川〜和歌山市は本線と同じ線路（Wikipedia 紀ノ川駅「和歌山市〜紀ノ川間は両線の列車が同じ線路を走る」）。別の線路は無い。
// 不明: 分岐器の番数・渡り線の細かい位置・信号の位置。横位置は OSM の線路の中心線（国土数値情報由来の粗い形）から読んだ値で、
//   ゲームの線形（south.json の下書き）とずれるので概形。
/** ホームの難波寄りの端からの距離 d [m] と、本線の中心線から右（南西）への横位置 [m]（OSM の加太線の複線の1本。2本はこの値で 4m 離れている） */
const KADA_R: [number, number][] = [
  [6, 0], [50, 3.1], [78, 6.7], [98, 8.9], [119, 13.4], [146, 21.5], [173, 32.7], [201, 48.4], [228, 64.5], [251, 84.6], [273, 106], [295, 134],
  [311, 155.5], [363, 224.5],
];
/** 分岐のはじまり（ホーム端からの距離。実際は 10m 弱だが、上りの紀ノ川の出発信号（停止位置の 65m 先 = ホーム端の手前 25m）に分岐を重ねないため 32m にした。
 *  KADA_R の形はその分だけ難波側へずらして使う）。複線が1本に合流する位置、ゲームで描く先端（ここに車止め。実際は先へ続く。ゲーム用の打ち切り） */
const KADA_D0 = 32, KADA_SHIFT = KADA_D0 - KADA_R[0][0], KADA_MERGE = 311 + KADA_SHIFT, KADA_END = 345 + KADA_SHIFT;
/** 単調な3次補間（Fritsch–Carlson） */
function pchip(pts: [number, number][]): (x: number) => number {
  const n = pts.length, h: number[] = [], del: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h.push(pts[i + 1][0] - pts[i][0]); del.push((pts[i + 1][1] - pts[i][1]) / h[i]); }
  m[0] = del[0]; m[n - 1] = del[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = del[i - 1] * del[i] <= 0 ? 0 : 2 / (1 / del[i - 1] + 1 / del[i]);
  return x => {
    let i = 0;
    while (i < n - 2 && x > pts[i + 1][0]) i++;
    const t = (x - pts[i][0]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
/** 加太線の分岐の線路（上り線からの 'kada'、下り線からの 'kada-b'）と、景観を置かない範囲。platformFrom = 紀ノ川のホームの難波寄りの端 s。
 *  s は難波寄りほど小さい（下りの座標）。lat は 0 = 下り線、4 = 上り線で、加太線は右（lat 大）へ離れる */
function kadaBranch(platformFrom: number): { extra: ExtraTrack[]; reserved: NonNullable<Route['reserved']> } {
  const R = pchip(KADA_R), smooth = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const latB = (d: number) => 4 + R(Math.min(d, KADA_END) - KADA_SHIFT);
  /** 下り線から出る線は上り線の 4m 左（下り線側）を平行に走り、合流点の手前で上り線から出る線に寄る */
  const latA = (d: number) => latB(d) - 4 * (1 - smooth((d - (KADA_MERGE - 26)) / 26));
  const ds: number[] = [];
  for (let d = KADA_D0; d < KADA_END; d += 2) ds.push(d); // 余弦の S字でつなぐ点の間隔（細かくして波打たせない）
  ds.push(KADA_MERGE, KADA_END);
  ds.sort((p, q) => p - q);
  const profile = (f: (d: number) => number, dMax: number): LatProfile =>
    ds.filter(d => d <= dMax).reverse().map(d => [r1(platformFrom - d), r1(f(d))] as [number, number]);
  const b = profile(latB, KADA_END), a = profile(latA, KADA_MERGE);
  const sOf = (d: number) => r1(platformFrom - d);
  const extra: ExtraTrack[] = [
    { id: 'kada', lat: b, from: sOf(KADA_END), to: sOf(KADA_D0), bumpers: [sOf(KADA_END)] },
    // 2本の間に架線柱を立てない（下り線からの線の柱は左＝本線側へ）
    { id: 'kada-b', lat: a, from: sOf(KADA_MERGE), to: sOf(KADA_D0), poleOffset: -2.7 },
  ];
  // 景観を置かない範囲（建物・木・駐車場。OSM の道路は残す）: 線路の両側 14m
  const reserved: NonNullable<Route['reserved']> = [];
  for (let d = KADA_END; d > KADA_D0 - 1; d -= 15) {
    const d1 = Math.max(KADA_D0 - 1, d - 15), l0 = Math.min(latA(Math.min(d, KADA_MERGE)), latA(Math.min(d1, KADA_MERGE))), l1 = Math.max(latB(d), latB(d1));
    reserved.push({ from: Math.floor(platformFrom - d), to: Math.ceil(platformFrom - d1), lat0: Math.max(6, Math.floor(l0 - 14)), lat1: Math.ceil(l1 + 14), keepRoads: true });
  }
  return { extra, reserved };
}

// ---- 和歌山市駅（営業キロ 12480 が停止位置。ホームは 12300〜12520） ----
export const WK = {
  /** 3番線（加太線）・島式ホーム1・4番線（自列車）・5番線・島式ホーム2・6/7番線の横位置 */
  lat3: -10.4, latP1: -5.2, lat4: 0, lat5: 4, latP2: 9.2, lat67: 14.4, platW: 7,
  /** 3番線の分岐 12165〜12290、車止め */
  s3: [12165, 12290] as const, bump3: 12535,
  /** 6番線の分岐、車止め（ホームの中ほど）。7番線は車止めの先から始まり、駅の先で 5番線へ合流 */
  s6: [12165, 12290] as const, bump6: 12408, bump7: 12416, merge7: [12600, 12730] as const,
  /** 車庫（6番線の北側）: 引上げ線 D1 は 6番線の分岐点から右へ。D2〜D5 は D1 から分かれる。lat は留置線の横位置、bumper は車止め */
  depot: { lead: [12165, 12330] as const, d1: 20, bump: 12600 },
  /** 和歌山港線の単線: 5番線が 4番線へ合流する範囲（12740〜12870）と、再び分かれる範囲（14790〜14950） */
  single: { merge: [12740, 12870] as const, split: [14790, 14950] as const },
  /** JR 和歌山市駅（1面1線）の線路の横位置とホームの中心（簡易） */
  jr: 11990, jrLat: -17.8, jrPlat: -22.5, jrBump: 12535,
};

/** 5番線（上り線）の横位置: 橋の前後で右へ開き、和歌山市の先で自線へ合流して和歌山港の手前まで重なる */
const UP_PROFILE: LatProfile = [
  [10560, 4], [10790, 4 + (KB_GAP - 4)], [11590, KB_GAP], [11800, 4],
  [WK.single.merge[0], 4], [WK.single.merge[1], 0],
  [WK.single.split[0], 0], [WK.single.split[1], 4],
];

const xt = (id: string, lat: LatProfile, from: number, to: number, opt: Partial<ExtraTrack> = {}): ExtraTrack => ({ id, lat, from, to, ...opt });
const EXTRA: ExtraTrack[] = [
  // 和歌山市駅: 3番線（加太線。自線の分岐から左へ）、6番線（上り線の分岐から右へ。ホームの中ほどで車止め）、7番線（車止めの先から駅の先で 5番線へ）
  xt('wk-3', [[WK.s3[0], 0], [WK.s3[1], WK.lat3]], WK.s3[0], WK.bump3, { bumpers: [WK.bump3] }),
  xt('wk-6', [[WK.s6[0], 4], [WK.s6[1], WK.lat67]], WK.s6[0], WK.bump6, { bumpers: [WK.bump6] }),
  xt('wk-7', [[WK.bump7, WK.lat67], [WK.merge7[0], WK.lat67], [WK.merge7[1], 4]], WK.bump7, WK.merge7[1] + 10, { bumpers: [WK.bump7] }),
  // 車庫の引上げ線（6番線と同じ点から右へ。車庫の留置線は world/wakayamashi.ts）
  xt('wk-depot-lead', [[WK.depot.lead[0], 4], [WK.depot.lead[1], WK.depot.d1]], WK.depot.lead[0], WK.depot.lead[1]),
];

/** 景観（建物・道路・木）を置かない範囲。和歌山市駅の構内・車庫・JR・駅前、JR の取り付き（加太線の分岐は kadaBranch） */
const RESERVED: NonNullable<Route['reserved']> = [
  { from: 11640, to: 11990, lat0: -66, lat1: -8 },
  { from: 11990, to: 12720, lat0: -80, lat1: 64 },
];

/** 下り（みさき公園 → 和歌山港）の路線データへ、和歌山側の景観・配線を足す。reverseRoute より前に呼ぶ */
export function applyWakayama(r: Route): void {
  r.coastalScenery = false; // 目印（鋼橋）を使うが、遠景は内陸のまま
  r.bridgeStyle = { color: 0x585d62 };
  r.trackProfiles = { ...r.trackProfiles, 4: UP_PROFILE };
  r.hiddenTracks = [{ track: 4, from: WK.single.merge[1], to: WK.single.split[0] }];
  // 紀ノ川駅のホームの難波寄りの端から分かれる加太線（複線で並走して1本に合流）
  const kinokawa = r.stations.find(s => s.name === '紀ノ川')!, kada = kadaBranch(kinokawa.platform.from);
  r.extraTracks = [...(r.extraTracks ?? []), ...kada.extra, ...EXTRA];
  r.reserved = [...(r.reserved ?? []), ...kada.reserved, ...RESERVED];
  // 紀ノ川橋梁: 上り線・下り線が別々の単線橋。橋脚は上り線（明治）が煉瓦積み、下り線（大正）はコンクリート。橋の下の地面を 4m 下げる
  r.structures = (r.structures ?? []).map(st => st.kind === 'bridge' && st.from === KB.from
    ? { ...st, split: true, drop: 4, piers: KB_PIERS, pierStyle: ['concrete', 'brick'] } : st);
  // トラス3連（左 = 下り線のワーレン、右 = 上り線のプラット。赤）
  r.coastalLandmarks = [...(r.coastalLandmarks ?? []), ...KB_TRUSS_CENTERS.map((s, i) => ({
    kind: 'steel-bridge' as const, s, length: TRUSS, color: KB_TRUSS_COLOR, trussStyles: ['warren', 'pratt'] as ('pratt' | 'warren')[], label: `紀ノ川橋梁 トラス${i + 1}`,
  }))];
  // 和歌山市駅: 独自配置（島式ホーム2面。ホーム・駅舎は world/wakayamashi.ts が描く）
  const w = r.stations.find(s => s.name === '和歌山市')!;
  w.layout = 'custom';
  w.customPlatforms = [
    { kind: 'island', lat: WK.latP1, width: WK.platW, external: true },
    { kind: 'island', lat: WK.latP2, width: WK.platW, external: true },
  ];
  // 下りの自列車は 4番線
  const i = r.stations.indexOf(w);
  for (const v of r.services ?? []) v.trackNames = { ...v.trackNames, [i]: '4番線' };
}

/** 上り（和歌山港 → みさき公園）: 自列車は 5番線（下りの座標の上り線を鏡像にした自線） */
export function applyWakayamaUp(r: Route): void {
  const i = r.stations.findIndex(s => s.name === '和歌山市');
  for (const v of r.services ?? []) v.trackNames = { ...v.trackNames, [i]: '5番線' };
}
