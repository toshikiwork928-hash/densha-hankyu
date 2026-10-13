// 南海本線 泉佐野〜みさき公園の独立コース（10駅・17.9km）。景観の作り込みとダイヤ再現の前の「走れる」版。
// 線形・勾配は src/data/geometry/south.json（OSM の中心線と国土地理院の標高から scripts/route-geometry.ts が作った下書き）を切り出す。
// 営業キロは南海の公式値（泉佐野起点: 羽倉崎2.1、吉見ノ里3.4、岡田浦4.8、樽井6.6、尾崎9.1、鳥取ノ荘10.6、箱作12.6、淡輪16.2、みさき公園17.9）。
// 駅は既存の駅形で近似（尾崎の2面4線・みさき公園の島式2面は未再現）。泉佐野は岸和田〜泉佐野コースと同じ島式3面4線・駅舎。羽倉崎は2面3線（custom）。
// 泉佐野の南の空港線の分岐・JR 関西空港線の橋・羽倉崎検車区は描画専用（route/routes/izumisano-airport.ts、hagurazaki-depot.ts と world/ の同名モジュール）。
// 種別は普通と特急サザンだけ（日中の実際の運転）。対向列車・踏切・OSM の街並みは未作成。docs/spec-south-courses.md
import type { ExtraTrack, LatProfile, Route, Segment, ServiceSpec, Sign, SpeedLimit, Station, StationLoop, TimeOfDay } from '../types';
import { setLocalPatterns } from '../day-patterns';
import { mirrorProfile, reverseRoute } from '../reverse';
import { loopZone, setDestinations } from '../service';
import SOUTH from '../../data/geometry/south.json';
import { buildTrack } from '../track';
import { IZUMISANO_PLATFORMS } from './izumisano';
import { SM, SM_UP } from './izumisano-misaki-timetable';
import { addMisakiPark, setMisakiParkUp } from './misaki-park';
import { AD_LAT, AIR_S0, AIR_S1, AU_LAT, airportGeometry, airportReserved } from './izumisano-airport';
import { HAGURAZAKI_LEAD, HAGURAZAKI_RESERVED } from './hagurazaki-depot';
import { IZUMISANO_MISAKI_CROSSINGS } from './south-crossings';

/** 座標: ゲームの s = 営業キロの s（泉佐野 0）+ START。泉佐野の停止位置が 180（ホームは 0〜220） */
const START = 180;
const names: [string, string][] = [
  ['泉佐野', 'いずみさの'], ['羽倉崎', 'はぐらざき'], ['吉見ノ里', 'よしみのさと'], ['岡田浦', 'おかだうら'], ['樽井', 'たるい'],
  ['尾崎', 'おざき'], ['鳥取ノ荘', 'とっとりのしょう'], ['箱作', 'はこつくり'], ['淡輪', 'たんのわ'], ['みさき公園', 'みさきこうえん'],
];
const KM = [0, 2100, 3400, 4800, 6600, 9100, 10600, 12600, 16200, 17900];
const LAST = names.length - 1;
/** 路線データの終端（みさき公園の停止位置の先 400m） */
const END = START + KM[LAST] + 400;

/** 線形の切り出し: 営業キロ [from, to] の直線・円弧（円弧は途中で切れたら角度を按分）。前に prepend [m] の直線を足す */
function sliceSegments(from: number, to: number, prepend: number): Segment[] {
  const out: Segment[] = prepend > 0 ? [{ type: 'straight', length: prepend }] : [];
  let acc = 0;
  for (const g of SOUTH.segments as Segment[]) {
    const len = g.type === 'straight' ? g.length : g.radius * g.angle;
    const a = Math.max(acc, from), b = Math.min(acc + len, to);
    acc += len;
    if (b <= a) continue;
    const f = (b - a) / len;
    out.push(g.type === 'straight' ? { type: 'straight', length: b - a } : { ...g, angle: g.angle * f });
  }
  return out;
}
const segments = sliceSegments(0, END - START, START);

/** 曲線の速度制限（ゲーム用）。半径 R の円弧は 3.8√R km/h（5km/h刻みに切り下げ）。線区最高速度（普通 90）に満たないものだけ置く。
 *  south.json の円弧は実際の曲線ではない（概形）ので、実際の制限速度とは一致しない（みさき公園〜和歌山港コースと同じ式） */
function curveLimits(): SpeedLimit[] {
  const out: SpeedLimit[] = [];
  let s = 0;
  for (const g of segments) {
    const len = g.type === 'straight' ? g.length : g.radius * g.angle;
    if (g.type === 'arc') {
      const kmh = Math.floor(3.8 * Math.sqrt(g.radius) / 5) * 5;
      if (kmh < 90) out.push({ from: Math.round(s), to: Math.round(s + len) + 120, kmh, label: '曲線制限' });
    }
    s += len;
  }
  return out;
}

// 泉佐野駅: 島式3面4線（岸和田〜泉佐野コースと同じ。横位置はゲーム用の概形）。コースは泉佐野から南へ出る。
// 構内は外側下り線(T1 -9.2)・下り本線(T2 0)・上り本線(T3 9.2)・外側上り線(T4 18.4)が平行で、ホームの先で T1 と T4 が本線へ合流する（南の分岐は 300〜550m）。
// 空港線は描かない（泉佐野以南に空港線の分岐は無く、このコースの種別は空港系統を含まない）。
const MAIN_UP: LatProfile = [[-400, 9.2], [300, 9.2], [550, 4]];
const OUTER_DOWN: LatProfile = [[-400, -9.2], [300, -9.2], [550, 0]];
const OUTER_UP: LatProfile = [[-400, 18.4], [300, 18.4], [550, 4]];
// 南海空港線の分岐（泉佐野の約260m南西。描画専用）: 外側下り線(T1)の外（左）・外側上り線(T4)の外（右）へ6m振れて平行になる所までを本線の床版の延長（追加の線路）で描き、
// その先の高架（下り線は35‰で上って本線を乗り越える）と JR 関西空港線の橋は world/izumisano-airport.ts。空港線の列車は作らない。平面形は route/routes/izumisano-airport.ts
const AIRPORT_EXTRA: ExtraTrack[] = [
  { id: 'airport-down', lat: [[AIR_S0, -9.2], [AIR_S0 + 100, AD_LAT], [AIR_S1, AD_LAT]], from: AIR_S0, to: AIR_S1, ownDeck: false },
  { id: 'airport-up', lat: [[AIR_S0, 18.4], [AIR_S0 + 100, AU_LAT], [AIR_S1, AU_LAT]], from: AIR_S0, to: AIR_S1, ownDeck: false },
];
const EXTRA: ExtraTrack[] = [
  { id: 'izumisano-t1', lat: OUTER_DOWN, from: -400, to: 550, ownDeck: false },
  { id: 'izumisano-t4', lat: OUTER_UP, from: -400, to: 550, ownDeck: false },
  ...AIRPORT_EXTRA,
  HAGURAZAKI_LEAD,
];

// 羽倉崎駅: 2面3線（島式の1・2番と単式の3番。駅舎は3番線側、連絡地下道）。1番線は左端の線（T1 -9.2）で羽倉崎検車区の引上げ線へつながる。
// 本線2線は島式ホームの右の下り本線(0)と単式ホームの前の上り本線(4)。ゲームの自列車（下り）は下り本線の島式ホーム側（ドア左）に停まる。番線の割り当ては不明のためゲーム用
const HAGURAZAKI_PLATFORMS: NonNullable<Station['customPlatforms']> = [
  { kind: 'island', lat: -4.6, width: 5.8 },
  { kind: 'side', lat: 4, side: 'R', width: 5 },
];
const HAGURAZAKI = 1;
/** 樽井: 2面3線（下りの単式ホームと、上りの島式ホーム。Wikipedia「樽井駅」・配線略図.net 011_06）。上りホームの2番線が上り本線、3番線が折り返し・待避の線。
 *  下りホームの駅舎は和歌山市寄り、ホーム間は跨線橋。なんば寄りに下り線から上り線への渡り線（折り返しの普通が使う）、3番線の和歌山市寄りは非電化の引込線 */
const TARUI = 4;
const TARUI_PLATFORMS: NonNullable<Station['customPlatforms']> = [
  { kind: 'side', lat: 0, side: 'L', width: 5 },
  { kind: 'island', lat: 8.6, width: 5.8, stairs: false },
];
const TARUI_STOP = START + KM[TARUI];
/** 箱作: 相対式2面2線。なんば寄りに渡り線と、上り線側の短い留置線（両端に車止め。配線略図.net 011_07） */
const HAKOTSUKURI = 7;
const HAKO_P = START + KM[HAKOTSUKURI] - 180;
/** 駅の構造（駅舎の位置・ホーム間の連絡。出典: 各駅の Wikipedia「駅構造」。2026-10-10） */
const STRUCTURES: Record<string, Station['structure']> = {
  吉見ノ里: { building: 'up', end: 'wakayama', link: 'crossing' },
  岡田浦: { building: 'up', end: 'ends', link: 'underpass' },
  樽井: { building: 'down', end: 'wakayama', link: 'footbridge' },
  鳥取ノ荘: { building: 'both' },
  箱作: { building: 'both', link: 'none' },
  淡輪: { building: 'up', end: 'center', link: 'underpass', style: 'wood-western' },
};
/** 樽井・箱作の追加の線路（描画・景観用。自列車は本線を走る） */
const STATION_EXTRA: ExtraTrack[] = [
  // 樽井: 3番線（上りホームの島式の外側。上り本線から分かれ、ホームの先の非電化の引込線で終わる）と、なんば寄りの下り線 → 上り線の渡り線
  { id: 'tarui-t3', lat: [[TARUI_STOP - 290, 4], [TARUI_STOP - 190, 13.2], [TARUI_STOP + 110, 13.2]], from: TARUI_STOP - 290, to: TARUI_STOP + 110, bumpers: [TARUI_STOP + 110], ownDeck: false },
  { id: 'tarui-cross', lat: [[TARUI_STOP - 350, 0], [TARUI_STOP - 280, 4]], from: TARUI_STOP - 350, to: TARUI_STOP - 280, ownDeck: false },
  // 箱作: 渡り線と、上り線の脇の短い留置線（両端が車止め）
  { id: 'hakotsukuri-cross', lat: [[HAKO_P - 160, 0], [HAKO_P - 110, 4]], from: HAKO_P - 160, to: HAKO_P - 110, ownDeck: false },
  { id: 'hakotsukuri-conn', lat: [[HAKO_P - 112, 4], [HAKO_P - 84, 8.5]], from: HAKO_P - 112, to: HAKO_P - 84, ownDeck: false },
  { id: 'hakotsukuri-stub', lat: [[HAKO_P - 120, 8.5], [HAKO_P - 30, 8.5]], from: HAKO_P - 120, to: HAKO_P - 30, bumpers: [HAKO_P - 120, HAKO_P - 30], ownDeck: false },
];
/** 尾崎: 橋上駅舎の地上駅、島式2面4線（内側の2・3番線が本線、外側の1・4番線が待避線。Wikipedia）。待避線の形は岸和田〜泉佐野の貝塚と同じ（横位置・分岐器長はゲーム用の概形） */
const OZAKI = 5;
const OZAKI_LOOP: StationLoop = { lat: -9.2, turnoutLength: 90, turnoutLimitKmh: 45 };

const stations: Station[] = names.map(([name, kana], i) => {
  const stopS = START + KM[i];
  return {
    name, kana, stopS, platform: { from: stopS - 180, to: stopS + 40, side: 'L' },
    scheduledArrival: i * 100, dwell: i && i < LAST ? 25 : undefined, stopMarkerCars: 6,
    elevated: i === 0, layout: i === 0 || i === HAGURAZAKI || i === TARUI ? 'custom' : i === OZAKI ? 'loop' : 'relative',
    ...(STRUCTURES[name] ? { structure: STRUCTURES[name] } : {}),
    ...(i === TARUI ? { customPlatforms: TARUI_PLATFORMS } : {}),
    ...(i === 0 ? { customPlatforms: IZUMISANO_PLATFORMS, mainTrack: '2番線' } : {}),
    ...(i === HAGURAZAKI ? { customPlatforms: HAGURAZAKI_PLATFORMS } : {}),
    ...(i === OZAKI ? { loop: { ...OZAKI_LOOP }, loopTrack: '1番線' } : {}),
  };
});
const approachSigns = (stopS: number): Sign[] => [
  ...[500, 300, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - 20, cars: 4 }, { kind: 'stopMarker', s: stopS, cars: 6 }, { kind: 'stopMarker', s: stopS, cars: 8 },
];
// 踏切（OSM の位置。scripts/build-crossings.ts が作る）
const crossings = IZUMISANO_MISAKI_CROSSINGS;
const nearCrossing = (s: number) => crossings.find(c => Math.abs(s - c.s) < 25);
// 信号は岸和田〜泉佐野コースと同じ作り方（相対式の駅: 場内信号と出発信号、駅間は約600mごとの閉そく）。踏切の上には置かない
const signals: { id: string; s: number }[] = [];
for (let i = 0; i < stations.length; i++) {
  const sta = stations[i], z = loopZone(sta);
  if (i > 0) signals.push({ id: `entry-${i}`, s: z ? z.inFrom - 60 : sta.platform.from - 150 });
  if (i < LAST) {
    const c = crossings.find(q => q.s > sta.platform.to && q.s < sta.stopS + 95);
    signals.push({ id: `departure-${i}`, s: z ? sta.stopS + 65 : c ? Math.min(sta.stopS + 65, c.s - 20) : sta.stopS + 65 });
  }
  const next = stations[i + 1];
  if (next) {
    const from = z ? z.outTo + 60 : sta.platform.to + 160, nz = loopZone(next), to = nz ? nz.inFrom - 100 : next.platform.from - 200;
    const n = Math.floor((to - from) / 600);
    for (let k = 1; k <= n; k++) {
      let s = Math.round(from + (to - from) * k / (n + 1));
      const c = nearCrossing(s);
      if (c) s = c.s - 30;
      signals.push({ id: `block-${i}-${k}`, s });
    }
  }
}
signals.sort((a, b) => a.s - b.s);

// 勾配: 泉佐野の高架（営業キロ 0〜1781）を最後の360mで地面へ下ろし（-25‰、9m）、その先は国土地理院の標高からの下書き
const VIADUCT_END = START + 1781;
const gradients = [
  { from: VIADUCT_END - 360, to: VIADUCT_END, permil: -25 },
  ...(SOUTH.gradients as { from: number; to: number; permil: number }[])
    .filter(g => g.from + START >= VIADUCT_END && g.to + START <= END)
    .map(g => ({ from: g.from + START, to: g.to + START, permil: g.permil })),
];

// 景観を置かない範囲: 空港線の高架の下・JR の橋の帯（道路は残す）と、羽倉崎検車区の構内。空港線・JR の平面形は線形（segments）から数値で求める
const AIRPORT = airportGeometry(buildTrack({ segments, gradients, elevation0: 9, limits: [], stations: [] } as unknown as Route));
const reserved = [...airportReserved(AIRPORT), ...HAGURAZAKI_RESERVED];

const services: ServiceSpec[] = [
  { id: 'local', name: '普通', cars: 4, units: [4], kind: 'commuter-new', kindOptions: ['commuter-new', 'commuter-old', 'commuter-1000'], formationOptions: [[4], [4, 2], [6]], lineLimit: 90, useLoop: true, stops: names.map((_, i) => i), timetable: SM.local },
  // 急行（ラッシュ時の運転。泉佐野以南の停車駅は泉佐野、尾崎、みさき公園、和歌山大学前、和歌山市で、サザンと同じ。docs/south-timetable-research.md 3章）
  { id: 'express', name: '急行', cars: 6, units: [4, 2], kind: 'commuter-old', kindOptions: ['commuter-old', 'commuter-new', 'commuter-1000', 'commuter-9000'], formationOptions: [[4, 2], [4, 4], [6]], lineLimit: 110, stops: [0, 5, 9], timetable: SM.express },
  { id: 'southern', name: '特急サザン', cars: 8, units: [4, 4], kind: 'southern-10000', unitKinds: ['southern-10000', 'commuter-old'], lineLimit: 110, stops: [0, 5, 9], timetable: SM.southern },
];

export const izumisanoMisaki: Route = {
  id: 'izumisano-misaki', lineId: 'shiokaze', theme: 'coast', name: '南海本線 泉佐野 → みさき公園',
  lineLimit: 90, startS: START, startClock: 10 * 3600, trainLength: 120, seaSide: 1,
  segments, elevation0: 9, gradients,
  limits: curveLimits(),
  stations, services,
  prevName: '井原里', nextName: '孝子', signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
  extent: { from: -400, to: END }, tracks: [0, 4], trackProfiles: { 4: MAIN_UP },
  deckJoin: [{ from: -400, to: 600 }],
  scenery: { cityZones: [{ from: -Infinity, to: START + 11500 }, { from: START + 15500, to: Infinity }] },
  // 対向列車は実ダイヤの時刻付き共通運行（data/oncoming-timetable.json、world/oncoming-timetable.ts）。停車シーンの設定は持たない。
  // 泉佐野の南の合流部（s 300〜550）で本線の列車を同じ線と判定する（counterSameTrack）
  oncoming: [], counterSameTrack: true, signals, crossings,
  structures: [{ kind: 'viaduct', from: -400, to: VIADUCT_END }],
  extraTracks: [...EXTRA, ...STATION_EXTRA],
  // 周囲の山（国土地理院の標高。south.json の relief。営業キロ + START が s）
  relief: { s0: START, step: SOUTH.relief.step, lats: SOUTH.relief.lats, rows: SOUTH.relief.rows.slice(0, Math.ceil((END - START) / SOUTH.relief.step) + 3) }, reserved,
  terminalApproach: false,
};
// 下りの走行線と番線（ゲーム用の割り当て。泉佐野の割り当てと同じ）: 普通は外側下り線(T1)の1番（ドア右）、サザンは下り本線(T2)の2番（ドア左）。
for (const v of izumisanoMisaki.services!) {
  const outer = v.id === 'local';
  v.lane = outer ? OUTER_DOWN : [[0, 0]];
  v.trackNames = { 0: outer ? '1番線' : '2番線' };
  v.platformSides = { 0: outer ? 'R' : 'L' };
  if (outer) v.laneLimits = [{ from: 300, to: 580, kmh: 45, label: '泉佐野分岐器' }];
}
setDestinations(izumisanoMisaki.services!, 'wakayama');
// 普通は和歌山市行（実際の南海本線は羽倉崎止まりだけでなく和歌山市まで行く。ユーザー指示 2026-10-10）。対向・追い抜きの普通も同じ
const SOUTH_LOCAL_DEST: [string, string] = ['和歌山市', 'わかやまし'];
for (const v of izumisanoMisaki.services!) if (v.id === 'local') { v.destination = SOUTH_LOCAL_DEST[0]; v.destinationKana = SOUTH_LOCAL_DEST[1]; }
izumisanoMisaki.wakayamaDest = { local: SOUTH_LOCAL_DEST };
// みさき公園（終着）: 盛土上の島式2面5線（custom 駅）。下りは普通が1番線(T1)、サザンが2番線(T2)。多奈川線(5番線・T5)と分岐も描く。定義は misaki-park.ts（みさき公園〜和歌山港と共通）
addMisakiPark(izumisanoMisaki, LAST, true);

export const izumisanoMisakiUp: Route = reverseRoute(izumisanoMisaki, { id: 'izumisano-misaki-up', name: '南海本線 みさき公園 → 泉佐野', timetable: SM_UP, signs: approachSigns });
// 上りの走行線と番線: 普通・サザンとも上り本線(T3)の5番（ドア左）に着く
for (const v of izumisanoMisakiUp.services!) {
  if (v.id === 'southern') { v.kind = 'commuter-old'; v.unitKinds = ['commuter-old', 'southern-10000']; }
  v.lane = mirrorProfile(izumisanoMisaki, MAIN_UP);
  v.trackNames = { [LAST]: '5番線' };
  v.platformSides = { [LAST]: 'L' };
}
setDestinations(izumisanoMisakiUp.services!, 'namba');
// 尾崎（上り）の待避線は外側の4番線
izumisanoMisakiUp.stations[LAST - OZAKI].loopTrack = '4番線';
// みさき公園（上りの始発）: 上り本線(T3)の3番線から発車する（普通・サザンとも）
setMisakiParkUp(izumisanoMisakiUp, 0);

// 尾崎の緩急接続（平日の実ダイヤ。docs/south-timetable-research.md 5章）: 普通が尾崎の待避線に入り、本線に停車する優等列車が先に発車してから発車する。
// 優等列車は尾崎に停車するので通過待ちでなく待ち合わせ。下りは朝・夜が急行、日中・夕がサザン。上りは朝が急行、日中・夜がサザン（夕は普通のうち待つのが3割弱なので入れない）。
// 既存コース（泉大津〜岸和田・岸和田〜泉佐野など）の待避・待ち合わせとは別（このコースだけ）
const OZAKI_WAITS_DOWN: Partial<Record<TimeOfDay, ['尾崎', 'express' | 'southern'][]>> = {
  morning: [['尾崎', 'express']], noon: [['尾崎', 'southern']], evening: [['尾崎', 'southern']], night: [['尾崎', 'express']],
};
const OZAKI_WAITS_UP: Partial<Record<TimeOfDay, ['尾崎', 'express' | 'southern'][]>> = {
  morning: [['尾崎', 'express']], noon: [['尾崎', 'southern']], night: [['尾崎', 'southern']],
};
setLocalPatterns(izumisanoMisaki, { waits: OZAKI_WAITS_DOWN });
setLocalPatterns(izumisanoMisakiUp, { waits: OZAKI_WAITS_UP });
