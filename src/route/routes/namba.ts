// 南海本線: 堺〜難波（駅名の表示は「なんば」）の実在の駅名・駅間距離・配線を参考にした線（9駅・9.8km、終点の難波は頭端式）。公式の再現ではない概形。
// 堺 → 難波（上り）の1方向だけ。描画が多いので他の区間とは通しにしない独立のコース。
// 駅間は営業キロ（難波起点: 堺 9.8 / 七道 8.2 / 住ノ江 6.7 / 住吉大社 5.7 / 粉浜 5.1 / 岸里玉出 3.9 / 天下茶屋 3.0 / 新今宮 1.4 / 難波 0.0）を 100m 単位で。
// 曲線・高架・橋・車庫・高野線の合流の位置は OpenStreetMap の線路形状（2026-10 調査）を、駅間ごとに営業キロへ伸縮して写した概形。
// 配線の参考: 配線略図.net 南海本線 figures/011_01.svg（難波〜岸里玉出）・011_02.svg（粉浜〜堺）。詳細は docs/spec-sakai-namba.md。
//
// 横位置（左が負。route.tracks の 0 = 上り本線、4 = 下り本線）。配線略図.net の図と OSM、ユーザーの指摘（2026-10-07）による:
//   堺: 上りは外側の4番線が本線（直進、優等）、内側の3番線が分岐側（普通、45km/h）。route/sakai-layout.ts
//   七道: 島式1面2線。ホームの幅（線間 9.4m）のまま大和川を上下別々の単線橋で渡り、住ノ江の手前で複々線になる
//   住ノ江〜岸里玉出: 方向別の複々線。西から 上り急行線 0（堺から直進）・上り緩行線 9.4・下り急行線 13.4・下り緩行線 22.8（東端）。
//     上りは 普通 = 内側の緩行線（住ノ江・住吉大社・粉浜は3番線）・優等 = 外側の急行線、下りは 優等 = 内側の急行線・普通 = 外側の緩行線。
//     島式ホームは各方向の急行線と緩行線の間。住ノ江の西（左）に住ノ江検車区
//   岸里玉出: 島式ホームは上りの緩行線と下りの線の間（優等は外側の急行線を通過）。上りは駅を過ぎてから緩行線が急行線へ合流（なんば側まで複々線）、
//     下りは駅の堺側で外側の緩行線が分かれる。左端に汐見橋線の行き止まりの線と片面ホーム（2000系が停車）
//   岸里玉出〜なんば: 本線（0・4）の右に高野線（上り 9・下り 13）が並ぶ。天下茶屋・新今宮は 片面（上り本線）・島式（下り本線と高野線上り）・片面（高野線下り）。
//     萩ノ茶屋・今宮戎は高野線だけの島式ホーム（本線は通過、ホームなし）。新今宮は JR の上を越えるため高い
//   なんば: 頭端式 9面8線。左から 9番線（8番線併用。特急ラピートβ）・7番線（普通）・6番線（急行・空港急行）・5番線（特急サザン）・4〜1番線（高野線）
import type { ExtraTrack, LatProfile, Route, ServiceSpec, Sign, Station } from '../types';
import { airportService, customPlatformSide, profileLat, setDestinations } from '../service';
import { mirrorProfile, reverseRoute, totalLength } from '../reverse';
import { stopScenes, type StopScene } from '../oncoming-stops';
import { SAKAI_LAT, sakaiLayout } from '../sakai-layout';
import { NB, NB_UP } from './namba-timetable';
import { setLocalPatterns } from '../day-patterns';

/** 停止位置（6両基準。ホームは stopS − 180 〜 + 40） */
const STOPS = [180, 1780, 3280, 4280, 4880, 6080, 6980, 8580, 9980];
const names = [
  ['堺', 'さかい'], ['七道', 'しちどう'], ['住ノ江', 'すみのえ'], ['住吉大社', 'すみよしたいしゃ'], ['粉浜', 'こはま'],
  ['岸里玉出', 'きしのさとたまで'], ['天下茶屋', 'てんがちゃや'], ['新今宮', 'しんいまみや'], ['なんば', 'なんば'],
];
const LAST = names.length - 1;
/** 難波の車止め（線路の終端） */
export const NAMBA_END = 10032;
/** 難波の停止位置（6・8両の先頭。自列車の停止位置目標）。留置・高野線の電車も車止め側の端をここにそろえる */
export const NAMBA_STOP = STOPS[STOPS.length - 1];

// ---- 線路の横位置 ----
/** 複々線の駅（住ノ江・住吉大社・粉浜） */
const QUAD_STATIONS = [2, 3, 4];
const plat = (i: number) => ({ from: STOPS[i] - 180, to: STOPS[i] + 40 });
/** ホーム区間の前後 len m で off だけ横へ開く折れ線の点 */
const bow = (i: number, base: number, off: number, len = 100): LatProfile => {
  const p = plat(i);
  return [[p.from - len, base], [p.from, base + off], [p.to, base + off], [p.to + len, base]];
};
/** 複々線の横位置: 上り緩行線・下り急行線・下り緩行線（上り急行線は 0）。西から 上り急行・上り緩行・下り急行・下り緩行 */
export const QUAD = { upLocal: 9.4, downExpress: 13.4, downLocal: 22.8 } as const;
const SAKAI = sakaiLayout(plat(0).from);
/** 七道〜住ノ江: 七道の島式ホームの手前で下り線が外へ開き（線間 9.4m）、そのまま大和川を別々の単線橋で渡って、住ノ江の手前で複々線へ */
const SHICHIDO_DOWN: LatProfile = [[plat(1).from - 100, 4], [plat(1).from, QUAD.upLocal]];
/** 上り本線（複々線では上り急行線。堺からなんばの手前まで直進） */
const UP: LatProfile = [[-1000, 0], [9600, 0], [9760, -6], [11000, -6]]; // 難波 7番線
/** 下り本線（複々線では内側の下り急行線） */
const DOWN_HEAD: LatProfile = [[-1000, 4], ...SAKAI.down, ...SHICHIDO_DOWN, [2780, QUAD.upLocal], [2900, QUAD.downExpress]];
const DOWN_TAIL: LatProfile = [
  // 岸里玉出: 島式ホームの分だけ外へ（下り緩行線はここへ合流）、駅の先で戻る（右に高野線が来る）
  [5780, QUAD.downExpress], [5880, 19.4], [6200, 19.4], [6340, 4],
  [9480, 4], [9560, 6], [11000, 6], // 難波 6番線
];
const DOWN: LatProfile = [...DOWN_HEAD, ...DOWN_TAIL];
/** 下り緩行線（東端。住ノ江の堺側で急行線から分かれ、岸里玉出の堺側で合流） */
const DOWN_LOCAL: LatProfile = [[2980, QUAD.downExpress], [3080, QUAD.downLocal], [5760, QUAD.downLocal], [5880, 19.4]];
/** 下りの普通の走行線（対向列車用。route.trackProfiles の '30'） */
const DOWN_LOCAL_PATH: LatProfile = [...DOWN_HEAD, ...DOWN_LOCAL.slice(1), ...DOWN_TAIL.slice(2)];
/** 高野線（上り・下り）。岸里玉出の先で右から合流し、天下茶屋・新今宮で島式ホームの分だけ右へ、萩ノ茶屋・今宮戎で下り線が右へ開く */
const KOYA_UP: LatProfile = [
  [5850, 118], [6700, 9], ...bow(6, 9, 5.4), ...bow(7, 9, 5.4), [9400, 9], [9640, 30],
];
/** 高野線だけの駅（萩ノ茶屋・今宮戎）のホーム区間 */
export const KOYA_STATIONS = [
  { name: '萩ノ茶屋', kana: 'はぎのちゃや', from: 7930, to: 8110 },
  { name: '今宮戎', kana: 'いまみやえびす', from: 8930, to: 9110 },
];
const KOYA_DOWN: LatProfile = [
  [5850, 122], [6700, 13], ...bow(6, 13, 5.4),
  [KOYA_STATIONS[0].from - 90, 13], [KOYA_STATIONS[0].from, 18.4], [KOYA_STATIONS[0].to, 18.4], [KOYA_STATIONS[0].to + 90, 13],
  ...bow(7, 13, 5.4),
  [KOYA_STATIONS[1].from - 90, 13], [KOYA_STATIONS[1].from, 18.4], [KOYA_STATIONS[1].to, 18.4], [KOYA_STATIONS[1].to + 90, 13],
  [9360, 13], [9600, 54],
];

/** 難波の番線の横位置（左から 9(8)・7・6・5・4・3・2・1番線） */
export const NAMBA_TRACKS = { 9: -18, 7: -6, 6: 6, 5: 18, 4: 30, 3: 42, 2: 54, 1: 66 } as const;
/** 汐見橋線の行き止まりの線（岸里玉出の左端、上り急行線の左） */
const SHIOMI: LatProfile = [[5965, -4.5], [6080, -4.5], [6420, -120]];

const xt = (id: string, lat: LatProfile, from: number, to: number, opt: Partial<ExtraTrack> = {}): ExtraTrack => ({ id, lat, from, to, ...opt });
const extraTracks: ExtraTrack[] = [
  ...SAKAI.extraTracks,
  xt('up-local', [[3060, QUAD.upLocal]], 3060, 6140),                     // 上り緩行線
  xt('x-suminoe', [[2940, 0], [3060, QUAD.upLocal]], 2940, 3060),         // 住ノ江の堺側: 上り本線 → 上り緩行線
  xt('x-kishinosato', [[6140, QUAD.upLocal], [6260, 0]], 6140, 6260),     // 岸里玉出のなんば側: 上り緩行線 → 上り本線
  xt('down-local', DOWN_LOCAL, 2980, 5880),
  // 合流までの高架は上下線を1枚の床版で受ける（上り線の床版を下り線側へ広げる）。架線柱は外側
  xt('koya-up', KOYA_UP, 5850, NAMBA_END, { bumpers: [NAMBA_END], deckSpan: [-2.7, 6.7], poleOffset: -2.7 }),
  xt('koya-down', KOYA_DOWN, 5850, NAMBA_END, { bumpers: [NAMBA_END], ownDeck: false, poleOffset: 2.7 }),
  xt('namba-3', [[9400, 9], [9680, NAMBA_TRACKS[3]]], 9400, NAMBA_END, { bumpers: [NAMBA_END] }),
  xt('namba-1', [[9360, 13], [9660, NAMBA_TRACKS[1]]], 9360, NAMBA_END, { bumpers: [NAMBA_END] }),
  xt('namba-9', [[9520, 0], [9700, NAMBA_TRACKS[9]]], 9520, NAMBA_END, { bumpers: [NAMBA_END] }),
  xt('namba-5', [[9560, 0], [9740, NAMBA_TRACKS[5]]], 9560, NAMBA_END, { bumpers: [NAMBA_END] }),
  xt('x-namba-6', [[9600, 0], [9720, NAMBA_TRACKS[6]]], 9600, 9720),
  // 構内の手前の渡り線（上り本線 → 下り本線。なんばの 9・7・5番線から発車する下り列車が使う）
  xt('x-namba-main', [[9380, 4], [9460, 0]], 9380, 9460),
  xt('shiomibashi', SHIOMI, 5965, 6420, { bumpers: [5965] }),
  // 住ノ江検車区への入出庫線（車庫の線路は world/suminoe-depot.ts）
  xt('depot-lead', [[3440, -16], [3560, 0]], 3440, 3560),
];

/** 優等列車の走行線: 堺の4番線から外側の急行線を直進し、なんばは種別の番線へ */
const lane = (tail: LatProfile): LatProfile => [[-1000, 0], ...tail];
const LANE = {
  express: lane([[9600, 0], [9720, NAMBA_TRACKS[6]]]),
  southern: lane([[9560, 0], [9740, NAMBA_TRACKS[5]]]),
  limited: lane([[9520, 0], [9700, NAMBA_TRACKS[9]]]),
  /** 普通: 堺の3番線から出て、住ノ江〜岸里玉出は内側の緩行線、なんばは7番線 */
  local: [
    [-1000, SAKAI.up3[1][1]], ...SAKAI.up3.slice(1),
    [2940, 0], [3060, QUAD.upLocal], [6140, QUAD.upLocal], [6260, 0], [9600, 0], [9760, NAMBA_TRACKS[7]],
  ] as LatProfile,
};
/** 普通の分岐器の制限（堺の3番線・住ノ江の堺側・岸里玉出のなんば側） */
const LOCAL_LIMITS = [
  SAKAI.localLimit(-400, SAKAI.up3[3][0]),
  { from: 2930, to: 3060, kmh: 60, label: '分岐器制限' },
  { from: 6140, to: 6260, kmh: 60, label: '分岐器制限' },
];

// ---- 駅 ----
const quadPlatforms = (): Station['customPlatforms'] => [
  { kind: 'island', lat: QUAD.upLocal / 2, width: 6 },                         // 上り急行線（0）と上り緩行線（9.4）の間
  { kind: 'island', lat: (QUAD.downExpress + QUAD.downLocal) / 2, width: 6 },  // 下り急行線（13.4）と下り緩行線（22.8）の間
];
/** 天下茶屋・新今宮: 上り本線の左に片面、下り本線と高野線上りの間に島式、高野線下りの右に片面 */
const koyaPlatforms = (): Station['customPlatforms'] => [
  { kind: 'side', lat: 0, side: 'L' },
  { kind: 'island', lat: 9.2, width: 7 },
  { kind: 'side', lat: 18.4, side: 'R' },
];
/** 難波（専用モジュール world/namba-terminal.ts が描く）: 番線の間すべてにホーム（9面8線） */
const nambaPlatforms = (): Station['customPlatforms'] => {
  const xs = [-18, -6, 6, 18, 30, 42, 54, 66];
  return [
    { kind: 'side', lat: -18, side: 'L', width: 6, external: true },
    ...xs.slice(1).map((x): NonNullable<Station['customPlatforms']>[number] => ({ kind: 'island', lat: x - 6, width: 8.6, external: true })),
    { kind: 'side', lat: 66, side: 'R', width: 6, external: true },
  ];
};

const stations: Station[] = names.map(([name, kana], i): Station => {
  const stopS = STOPS[i], base = {
    name, kana, stopS, platform: { ...plat(i), side: 'L' as 'L' | 'R' },
    scheduledArrival: i * 100, dwell: i && i < LAST ? 25 : undefined, stopMarkerCars: 6, elevated: true,
  };
  // ホームの側（platform.side）は普通のもの。優等列車は ServiceSpec.platformSides
  if (i === 0) return { ...base, layout: 'custom', customPlatforms: SAKAI.platforms };
  if (i === 1) return { ...base, layout: 'custom', platform: { ...base.platform, side: 'R' }, customPlatforms: [{ kind: 'island', lat: QUAD.upLocal / 2, width: 6 }] };
  if (QUAD_STATIONS.includes(i)) return { ...base, layout: 'custom', customPlatforms: quadPlatforms() };
  if (i === 5) return {
    ...base, layout: 'custom', platform: { ...base.platform, side: 'R' },
    customPlatforms: [
      { kind: 'island', lat: (QUAD.upLocal + 19.4) / 2, width: 19.4 - QUAD.upLocal - 3.4 },
      // 汐見橋線の片面ホーム（行き止まりの線の左）
      { kind: 'side', lat: -4.5, side: 'L', width: 4, from: 5975, to: 6075 },
    ],
  };
  if (i === 6 || i === 7) return { ...base, layout: 'custom', customPlatforms: koyaPlatforms() };
  return { ...base, layout: 'custom', headEnd: true, mainTrack: '7番線', customPlatforms: nambaPlatforms() };
});

const approachSigns = (stopS: number): Sign[] => [
  ...[500, 300, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - 20, cars: 4 },
  { kind: 'stopMarker', s: stopS, cars: 6 },
  { kind: 'stopMarker', s: stopS, cars: 8 },
];

/** 対向（下り）列車の停車シーン。七道・天下茶屋（急行停車）・新今宮 */
const STOP_SCENES: StopScene[] = [
  { station: 1, kind: 'commuter-new', cars: 4, kmh: 74 },
  { station: 3, kind: 'commuter-old', cars: 6, kmh: 74, label: '普通' },
  { station: 6, kind: 'southern-10000', cars: 8, kmh: 70, label: '特急' },  // 特急も天下茶屋に停車
  { station: 7, kind: 'commuter-new', cars: 8, kmh: 60, label: '空港急行' },
];

/** 出発・場内信号と駅間の閉そく信号（分岐器・S字の区間を避ける） */
const signals: { id: string; s: number }[] = [];
for (let i = 0; i < stations.length; i++) {
  const sta = stations[i];
  if (i > 0) signals.push({ id: `entry-${i}`, s: i === 2 ? 2700 : i === LAST ? 9300 : i === 5 ? 5650 : sta.platform.from - 150 });
  if (i < LAST) signals.push({ id: `departure-${i}`, s: i === 0 ? 450 : sta.stopS + 65 });
  const next = stations[i + 1];
  if (next) {
    const from = (i === 0 ? 450 : sta.stopS + 65) + 200, to = (i + 1 === 2 ? 2700 : i + 1 === LAST ? 9300 : i + 1 === 5 ? 5650 : next.platform.from - 150) - 150;
    const count = Math.floor((to - from) / 550);
    for (let k = 1; k <= count; k++) signals.push({ id: `block-${i}-${k}`, s: Math.round(from + (to - from) * k / (count + 1)) });
  }
}
signals.sort((a, b) => a.s - b.s);

const ALL = stations.map((_, i) => i), FAST = [0, 6, 7, LAST];
/** 優等列車: 堺は4番線（右に島式ホーム）、なんばは種別の番線 */
const fast = (track: string, side: 'L' | 'R') => ({ platformSides: { 0: 'R', [LAST]: side } as Record<number, 'L' | 'R'>, trackNames: { 0: '4番線', [LAST]: track } });
const services: ServiceSpec[] = [
  {
    id: 'local', name: '普通', cars: 4, units: [4], kind: 'commuter-new',
    kindOptions: ['commuter-new', 'commuter-old', 'commuter-1000'], formationOptions: [[4], [4, 2], [6]],
    lineLimit: 90, stops: ALL, timetable: NB.local, lane: LANE.local, laneLimits: LOCAL_LIMITS,
    // 堺・住ノ江・住吉大社・粉浜は3番線（内側の緩行線）
    trackNames: { 0: '3番線', 2: '3番線', 3: '3番線', 4: '3番線' },
  },
  {
    id: 'express', name: '急行', cars: 6, units: [4, 2], kind: 'commuter-old',
    kindOptions: ['commuter-old', 'commuter-new', 'commuter-1000', 'commuter-9000'], formationOptions: [[4, 2], [4, 4], [4, 2, 2], [6]],
    lineLimit: 110, stops: FAST, timetable: NB.express, lane: LANE.express, ...fast('6番線', 'R'),
  },
  { ...airportService(FAST, NB.airport), lane: LANE.express, ...fast('6番線', 'R') },
  {
    id: 'southern', name: '特急サザン', cars: 8, units: [4, 4], kind: 'commuter-old', unitKinds: ['commuter-old', 'southern-10000'],
    lineLimit: 110, stops: FAST, timetable: NB.southern, lane: LANE.southern, ...fast('5番線', 'R'),
  },
  {
    id: 'limited', name: '特急ラピートβ', cars: 6, units: [6], kind: 'limited', lineLimit: 110, stops: FAST, timetable: NB.limited,
    lane: LANE.limited, ...fast('9番線', 'L'),
  },
];

export const namba: Route = {
  id: 'namba', lineId: 'shiokaze', theme: 'coast', urban: true, name: '南海本線 堺 → 難波',
  lineLimit: 90, startS: 180, startClock: 10 * 3600, trainLength: 120,
  // 北へ向かい、海（大阪湾）は左側（遠いので urban の遠景では描かない）
  seaSide: -1,
  // OSM の線路形状: 堺〜七道は北東へ直線、七道を出て左へ約28°（大和川へ）、住ノ江の手前で右へ約8°、住ノ江を出て左へ約12°、
  // その先は難波の手前まで北北東へ直線、難波の手前で左へ約43°（頭端式のホームは直線）
  segments: [
    { type: 'straight', length: 1830 },
    { type: 'arc', radius: 664, angle: .497, turn: 'L' },   // 七道の北（1830〜2160m）
    { type: 'straight', length: 440 },
    { type: 'arc', radius: 2500, angle: .14, turn: 'R' },   // 住ノ江の手前（2600〜2950m）
    { type: 'straight', length: 730 },
    { type: 'arc', radius: 1050, angle: .218, turn: 'L' },  // 住ノ江の先（3680〜3909m）
    { type: 'straight', length: 5511 },
    { type: 'arc', radius: 375, angle: .75, turn: 'L' },    // 難波の手前（9420〜9701m）
    { type: 'straight', length: 500 },
  ],
  // 高架 9m。新今宮は JR の上を越えるので 15m（ホームの手前で上り、今宮戎の先で 12m へ下りて難波へ）
  elevation0: 9,
  gradients: [
    { from: 8160, to: 8400, permil: 25 },
    { from: 9200, to: 9320, permil: -25 },
  ],
  limits: [
    { from: 1820, to: 2280, kmh: 80, label: '曲線制限' },
    { from: 3670, to: 4030, kmh: 95, label: '曲線制限' },
    { from: 9400, to: 10200, kmh: 45, label: '構内制限' },
  ],
  stations,
  services,
  // 待避駅が無いので、先行の普通は優等列車に追いつかれない間隔で先に出す
  precedingHeadway: { express: 560, airport: 560, limited: 600, southern: 600 },
  prevName: '湊', nextName: '',
  signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
  extent: { from: -400, to: NAMBA_END }, tracks: [0, 4],
  // '30' は対向の普通の走行線（複々線は下り緩行線）
  trackProfiles: { 0: UP, 4: DOWN, 30: DOWN_LOCAL_PATH },
  oncomingLocal: { stations: QUAD_STATIONS, lat: 30 },
  extraTracks,
  // なんばの構内（扇状に開く番線）は一続きの床版
  deckJoin: [{ from: 3380, to: 3570 }, { from: 9300, to: NAMBA_END + 10 }],
  // 大和川の河川敷は町並みを置かない。車庫・七道の商業施設・難波の駅ビルの敷地は各モジュールの範囲
  scenery: { cityZones: [{ from: -Infinity, to: 2140 }, { from: 2400, to: Infinity }] },
  reserved: [
    { from: 3040, to: 3700, lat0: -120, lat1: -9 },   // 住ノ江検車区
    { from: 1380, to: 1900, lat0: -190, lat1: -14 },  // 七道駅西側の大型商業施設
    { from: 9740, to: 10400, lat0: -60, lat1: 95 },   // 難波の駅ビル・大屋根（手前の線路の広がりは osm-town.ts が線路から離す）
    { from: 4170, to: 4247, lat0: 232, lat1: 356 },   // 住吉大社の本宮・玉垣・角鳥居（world/sumiyoshi-taisha.ts）
    { from: 9555, to: 9865, lat0: -200, lat1: -42 },  // なんばパークス（西側。world/namba-terminal.ts）
    { from: 8440, to: 8640, lat0: -400, lat1: 400 },  // 新今宮の JR 高架
    { from: 8508, to: 8552, lat0: -30, lat1: 40, noPiers: true }, // JR の真上は橋脚なし
  ],
  oncoming: [
    // 天下茶屋に停まる特急サザン（10000系 + 7100系）
    // 複々線の駅（住吉大社）の普通は外側の下り緩行線（'30'）に停まる
    ...stopScenes(stations, STOP_SCENES).map(o => o.kind === 'southern-10000' ? { ...o, unitKinds: ['southern-10000', 'commuter-old'] as ServiceSpec['kind'][], units: [4, 4], dest: '和歌山港' }
      : o.stop && QUAD_STATIONS.includes(o.stop.station) ? { ...o, lat: 30 } : o),
    // 複々線の下り急行線を走り抜ける特急（住ノ江〜粉浜。停車駅の無い区間）
    { spawnAt: 2300, startS: 5300, cars: 6, carLen: 20, gap: .8, kmh: 95, lat: 4, kind: 'limited', label: '特急', dest: '関西空港' },
  ],
  signals,
  structures: [
    { kind: 'viaduct', from: -400, to: 1830 },
    { kind: 'viaduct', from: 1830, to: 2155, open: true },  // 七道を出て大和川まで: 壁のない高架
    { kind: 'bridge', from: 2155, to: 2375, split: true },  // 大和川橋梁（上下線が別々の単線橋。桁・トラス・桁）
    { kind: 'viaduct', from: 2375, to: 2675, open: true },  // 渡り切って約300mも壁のない高架
    { kind: 'viaduct', from: 2675, to: NAMBA_END + 10 },
  ],
  // 大和川橋梁は緑の鋼橋（前後は下路プレートガーダー、中央が鋼トラス）
  bridgeStyle: { color: 0x4f8a5a, throughGirder: true },
  coastalLandmarks: [
    // 大和川橋梁の中央の鋼トラス（前後は鋼桁）
    { kind: 'steel-bridge', s: 2265, length: 80, label: '大和川橋梁' },
  ],
  // なんば（頭端式）の手前だけ終着の低速進入 ATS（残り1500mで予告、1000mから段階的に速度照査。game/terminal-ats.ts）
  terminalApproach: true,
};

setDestinations(namba.services!, 'namba');

// ---- なんば → 堺（下り）。上りのデータを reverseRoute で反転し、種別ごとの進路を下り向きに写す ----
// 下りの進路（上りの座標で表した物理的な横位置）: なんばの番線 → 構内手前の渡り線で下り本線へ → 複々線は 普通 = 内側の緩行線・優等 = 外側の急行線
// → 堺は 普通 = 外側の1番線（45km/h）・優等 = 内側の2番線（本線）。普通の待避は無し
const DEP: Record<9 | 7 | 5, LatProfile> = {
  9: [[9380, 4], [9460, 0], [9520, 0], [9700, NAMBA_TRACKS[9]], [11000, NAMBA_TRACKS[9]]],
  7: [[9380, 4], [9460, 0], [9600, 0], [9760, NAMBA_TRACKS[7]], [11000, NAMBA_TRACKS[7]]],
  5: [[9380, 4], [9460, 0], [9560, 0], [9740, NAMBA_TRACKS[5]], [11000, NAMBA_TRACKS[5]]],
};
const before = (p: LatProfile, s0: number) => p.filter(([q]) => q < s0);
const PHYS_DOWN = {
  local: [
    [-1000, SAKAI_LAT.down1], [SAKAI.pt + 20, SAKAI_LAT.down1], [SAKAI.pt + 130, SAKAI_LAT.down2], [SAKAI.pt + 150, SAKAI_LAT.down2], [SAKAI.pt + 260, 4],
    ...DOWN_LOCAL_PATH.filter(([q]) => q > SAKAI.pt + 260 && q < 9380), ...DEP[7],
  ] as LatProfile,
  express: DOWN,
  southern: [...before(DOWN, 9380), ...DEP[5]],
  limited: [...before(DOWN, 9380), ...DEP[9]],
};
const L_NAMBA = totalLength(namba), mS = (q: number) => L_NAMBA - q;
/** 下りの普通の分岐器（岸里玉出の堺側で外側の緩行線へ、住ノ江の堺側で本線へ）の制限 */
const DOWN_LOCAL_LIMITS = [
  { from: mS(5880), to: mS(5760), kmh: 60, label: '分岐器制限' },
  { from: mS(3080), to: mS(2980), kmh: 60, label: '分岐器制限' },
];
/** 下りの停車シーン（上りの駅 index）: 七道（普通）・天下茶屋（急行）・新今宮（空港急行）。上りの対向列車は上り本線（外側の急行線）に停まる */
const STOP_SCENES_UP: StopScene[] = [
  { station: 1, kind: 'commuter-1000', cars: 6, kmh: 74, label: '普通' },
  { station: 6, kind: 'commuter-old', cars: 6, kmh: 70, label: '急行' },
  { station: 7, kind: 'commuter-new', cars: 8, kmh: 60, label: '空港急行' },
];

export const nambaUp: Route = reverseRoute(namba, {
  id: 'namba-up', name: '南海本線 難波 → 堺', timetable: NB_UP,
  oncomingStops: STOP_SCENES_UP, signs: approachSigns,
});
{
  const r = nambaUp, n = r.stations.length;
  r.terminalApproach = false; // 堺は途中駅（終着の低速進入 ATS は無効）
  delete r.precedingHeadway; // 普通の待避なし。先行の普通は従来の時隔
  r.precedingHeadway = { express: 560, airport: 560, limited: 600, southern: 600 };
  // 上りの '30'（下り急行線）を通る対向列車は写さない。複々線の上り急行線（外側）を走り抜ける特急を足す
  r.oncoming = r.oncoming.filter(o => o.lat === 4 && !!o.stop);
  // 対向（上り）の普通は複々線の駅と岸里玉出（5）で上り緩行線に停まる（'30' = 上りの普通の進路を下りの座標へ写したもの）。上り急行線にはホームが無い
  r.trackProfiles = { ...r.trackProfiles, 30: mirrorProfile(namba, LANE.local) };
  r.oncomingLocal = { stations: [...QUAD_STATIONS, 5].map(i => n - 1 - i), lat: 30 };
  r.oncoming.push({ spawnAt: mS(6200), startS: mS(2500), cars: 6, carLen: 20, gap: .8, kmh: 95, lat: 4, kind: 'limited', label: '特急', dest: 'なんば' });
  for (const v of r.services!) {
    const phys = v.id === 'local' ? PHYS_DOWN.local : v.id === 'southern' ? PHYS_DOWN.southern : v.id === 'limited' ? PHYS_DOWN.limited : PHYS_DOWN.express;
    v.lane = mirrorProfile(namba, phys);
    v.laneLimits = v.id === 'local' ? [...DOWN_LOCAL_LIMITS, { from: mS(SAKAI.pt + 140), to: mS(-400), kmh: 45, label: '分岐器制限' }] : [];
    // ドアの側は進路の横位置で駅のホームから決める
    const sides: Record<number, 'L' | 'R'> = {};
    r.stations.forEach((sta, i) => { const side = customPlatformSide(sta, profileLat(v.lane!, sta.stopS)); if (side) sides[i] = side; });
    v.platformSides = sides;
    v.trackNames = {
      0: v.id === 'local' ? '7番線' : v.id === 'southern' ? '5番線' : v.id === 'limited' ? '9番線' : '6番線',
      [n - 1]: v.id === 'local' ? '1番線' : '2番線',
    };
    if (v.id === 'southern') { v.kind = 'southern-10000'; v.unitKinds = ['southern-10000', 'commuter-old']; }
  }
  // 駅の既定のドアの側は普通のもの
  const local = r.services!.find(v => v.id === 'local')!;
  r.stations.forEach((sta, i) => { if (local.platformSides![i]) sta.platform.side = local.platformSides![i]; });
  setDestinations(r.services!, 'wakayama');
}

// 時間帯ごとの普通（route/day-patterns.ts）: 複々線の走行中の追い越し、下りは朝に堺1番線で急行を待ち合わせ（終着。到着前の放送で案内）
setLocalPatterns(namba, { passes: { morning: [['粉浜', '岸里玉出', 'express']], evening: [['岸里玉出', '岸里玉出', 'express']] } });
// 下りは粉浜〜住吉大社で抜く（岸里玉出の前後は下りが1線だけで、岸里玉出から発車した普通に後続の優等列車が追いつくため）
setLocalPatterns(nambaUp, { waits: { morning: [['堺', 'express']] }, passes: { morning: [['粉浜', '住吉大社', 'express']], evening: [['粉浜', '住吉大社', 'express']] } });
