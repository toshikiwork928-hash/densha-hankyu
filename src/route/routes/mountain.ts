// 高野線（橋本〜極楽橋、一部の駅を省略した山岳線）: 橋本 → 九度山 → 高野下（交換駅）→ 紀伊神谷 → 極楽橋（頭端式。ケーブルカー乗換）約8.6km
// 実在の山岳線（大河の谷の町から 50‰ 級の急勾配・R100 級の急曲線・トンネルと橋梁の連続で山奥の谷間の終点へ上る単線）の特徴を参考にした路線（高野線の区間を参考にした概形で、地形・勾配は創作）。
//   橋本: 平地の地上駅。島式1面2線＋副線（右側の行き止まり線と片面ホーム）の2面3線。発車後すぐ単線になる
//   橋本 → 九度山: 川沿いの平地（最高 70km/h）、大河を長い橋梁で渡る。勾配は緩い
//   九度山から先は山岳区間（50km/h、曲線 35〜45km/h、最急 50‰）。トンネル・橋梁が連続
//   高野下: 交換駅（単線が両開き分岐器で左右へ分かれ、間に島式ホーム。分岐器 35km/h）。自列車（左）は対向列車（右）の到着を待って発車
//   九度山・紀伊神谷: 棒線駅（単線に片面ホーム）
//   極楽橋: 谷間の頭端式。島式1面2線、ホームの先で車止め（分岐器 30km/h）
// 運行は各停のみ（2300系 18m 車、2両 / 2+2 の4両）。上りは下りのデータを反転（reverseRoute）
import type { MeetSpec, Route, Segment, Sign, SpeedLimit, Station, StationIsland } from '../types';
import { reverseRoute, singleTrackSignals } from '../reverse';
import { MT, MT_UP } from './mountain-timetable';

/** 停止位置目標の基準（4両 = 72m。2両は 18m 手前） */
const BASE_CARS = 4, CAR = 18;
/** 距離標と 2両・4両の停止位置目標 */
const approachSigns = (stopS: number): Sign[] => [
  ...[300, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - (BASE_CARS - 2) * CAR / 2, cars: 2 },
  { kind: 'stopMarker', s: stopS, cars: 4 },
];

/** 交換駅: 線路が左右へ 4.2m ずつ開き（線間 8.4m）、幅 5.0m の島式ホーム。両開き分岐器 50m・制限 35km/h */
const PASSING: StationIsland = { spread: 4.2, length: 50, turnoutLimitKmh: 35 };

/** 線形（[直線長] または [半径, 角度 rad, 向き]）。曲線制限は半径から自動で付ける */
type Piece = number | [number, number, 'L' | 'R'];
const PIECES: Piece[] = [
  // 川沿いの平地（橋本 0〜250 は駅構内）
  300, [400, .35, 'L'], 360,
  450, // 大河の橋梁 820〜1230
  [300, .5, 'R'], 500, [250, .6, 'L'], 550, // 九度山 2380〜2470
  // 山岳区間 1（〜高野下）
  [160, .9, 'R'], 180, [120, 1.1, 'L'], 150, [200, .8, 'R'], 250, [100, 1.3, 'L'], 200, [150, 1.0, 'R'], 250, [250, .5, 'L'],
  650, // 高野下（交換駅 4600〜4930）
  // 山岳区間 2（〜紀伊神谷）
  [100, 1.4, 'R'], 170, [130, 1.2, 'L'], 220, [180, .9, 'R'], 160, [110, 1.2, 'L'], 180, [200, .6, 'R'],
  420, // 紀伊神谷 6760〜6850
  // 山岳区間 3（〜極楽橋）
  [100, 1.5, 'L'], 140, [120, 1.3, 'R'], 200, [160, 1.0, 'L'], 160, [140, .8, 'R'],
  600, // 極楽橋 8480〜8570（車止め 8582）
];
const segments: Segment[] = PIECES.map(p => typeof p === 'number' ? { type: 'straight', length: p } : { type: 'arc', radius: p[0], angle: p[1], turn: p[2] });

/** 半径 → 曲線制限 [km/h]（カント・緩和曲線の短い山岳線の値） */
const curveKmh = (R: number): number => R <= 115 ? 35 : R <= 145 ? 40 : R <= 185 ? 45 : R <= 220 ? 50 : R <= 270 ? 55 : R <= 330 ? 60 : 65;

const TRAIN_LEN = BASE_CARS * CAR;
const LINE_LIMIT = 70;
/** 山岳区間（九度山の先から終点まで）の区間制限 */
const MOUNTAIN_FROM = 2600, MOUNTAIN_KMH = 50;
const EXTENT_TO = 8582;

const limits: SpeedLimit[] = (() => {
  const out: SpeedLimit[] = [{ from: MOUNTAIN_FROM, to: EXTENT_TO + 1000, kmh: MOUNTAIN_KMH, label: '山岳区間' }];
  let s = 0;
  for (const g of segments) {
    const len = g.type === 'straight' ? g.length : g.radius * g.angle;
    if (g.type === 'arc') {
      const kmh = curveKmh(g.radius), sectional = s >= MOUNTAIN_FROM ? MOUNTAIN_KMH : LINE_LIMIT;
      if (kmh < sectional) out.push({ from: Math.round(s), to: Math.round(s + len) + TRAIN_LEN, kmh, label: '曲線制限' });
    }
    s += len;
  }
  return out.sort((a, b) => a.from - b.from);
})();

const stations: Station[] = [
  {
    name: '橋本', kana: 'はしもと', stopS: 125, platform: { from: 40, to: 130, side: 'R' }, scheduledArrival: 0,
    island: { ...PASSING, bay: { lat: 8.4, bumper: 'behind', platformWidth: 4 } },
  },
  { name: '九度山', kana: 'くどやま', stopS: 2465, platform: { from: 2380, to: 2470, side: 'L' }, scheduledArrival: 0 },
  { name: '高野下', kana: 'こうやした', stopS: 4805, platform: { from: 4720, to: 4810, side: 'R' }, scheduledArrival: 0, island: PASSING },
  { name: '紀伊神谷', kana: 'きいかみや', stopS: 6845, platform: { from: 6760, to: 6850, side: 'R' }, scheduledArrival: 0 },
  {
    name: '極楽橋', kana: 'ごくらくばし', stopS: 8565, platform: { from: 8480, to: 8570, side: 'R' }, scheduledArrival: 0,
    island: { ...PASSING, turnoutLimitKmh: 30 }, headEnd: true,
  },
];

/** 交換駅（高野下）で行き違う対向の各停（上りでは駅 index を反転） */
const MEETS: MeetSpec[] = [{ station: 2, kind: 'commuter-2300', cars: 2, kmh: 35, label: '各停' }];

const crossings = [
  { id: 'x600', s: 600, roadWidth: 6 },
  { id: 'x2200', s: 2200, roadWidth: 5 },
  { id: 'x6620', s: 6620, roadWidth: 4 },
];

export const mountain: Route = {
  id: 'mountain',
  name: '高野線 橋本 → 極楽橋',
  lineId: 'mountain',
  theme: 'mountain',
  singleTrack: true,
  lineLimit: LINE_LIMIT,
  startS: 125,
  startClock: 10 * 3600,
  trainLength: TRAIN_LEN,
  stopBaseCars: BASE_CARS,
  segments,
  // 標高（s=0 が 0m）: 川沿いは緩い上り、九度山の先から 40〜50‰ で上る。駅は水平（極楽橋のみ 5‰）。終点で約 +244m
  gradients: [
    { from: 1300, to: 2250, permil: 10 },
    { from: 2600, to: 3300, permil: 40 },
    { from: 3300, to: 3500, permil: 25 },
    { from: 3500, to: 4500, permil: 50 },
    { from: 5000, to: 6650, permil: 50 },
    { from: 6950, to: 8300, permil: 50 },
    { from: 8300, to: 8600, permil: 5 },
  ],
  limits,
  stations,
  services: [
    {
      id: 'local', name: '各停', cars: 2, units: [2], kind: 'commuter-2300', formationOptions: [[2], [2, 2]], lineLimit: LINE_LIMIT,
      stops: [0, 1, 2, 3, 4],
      timetable: MT.local,
    },
  ],
  prevName: '林間田園都市',
  nextName: '',
  signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
  extent: { from: -400, to: EXTENT_TO },
  tracks: [0],
  scenery: { cityZones: [{ from: -Infinity, to: 700 }, { from: 2150, to: 2650 }] },
  oncoming: [],
  meets: MEETS,
  signals: singleTrackSignals(stations, crossings),
  crossings,
  // 大河の橋梁、山岳区間のトンネル 7本・橋梁 6本
  structures: [
    { kind: 'bridge', from: 820, to: 1230 },
    { kind: 'tunnel', from: 2700, to: 2900 },
    { kind: 'bridge', from: 3080, to: 3180 },
    { kind: 'tunnel', from: 3560, to: 3900 },
    { kind: 'bridge', from: 4120, to: 4230 },
    { kind: 'tunnel', from: 4350, to: 4520 },
    { kind: 'tunnel', from: 5150, to: 5420 },
    { kind: 'bridge', from: 5600, to: 5700 },
    { kind: 'tunnel', from: 5900, to: 6250 },
    { kind: 'bridge', from: 6400, to: 6480 },
    { kind: 'tunnel', from: 6990, to: 7400 },
    { kind: 'bridge', from: 7480, to: 7560 },
    { kind: 'tunnel', from: 7700, to: 8150 },
    { kind: 'bridge', from: 8200, to: 8300 },
  ],
};

/** 上り（極楽橋 → 橋本）。下りのデータを反転して作る（交換駅の左側通行・頭端駅・副線の左右も反転） */
export const mountainUp: Route = reverseRoute(mountain, { id: 'mountain-up', name: '高野線 極楽橋 → 橋本', timetable: MT_UP, signs: approachSigns });
