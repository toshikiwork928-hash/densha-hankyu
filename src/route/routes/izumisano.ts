// 南海本線 岸和田〜泉佐野の独立コース（7駅・8.0km）。
// 営業キロは南海公式路線図（2025-04-01）を基準に、岸和田26.0km、蛸地蔵26.9km、
// 貝塚28.6km、二色浜30.4km、鶴原31.3km、井原里32.4km、泉佐野34.0kmを採用。
// 配線は配線略図.net 南海本線図05〜06、泉佐野駅の南海公式構内図を参照した概形。
// 線形・高架区間はOSM中心線をゲームの営業キロに合わせた概形。道路交点は踏切の候補。
import type { ExtraTrack, LatProfile, Route, Sign, Station, StationLoop } from '../types';
import { mirrorProfile, reverseRoute } from '../reverse';
import { airportService, loopZone, setDestinations } from '../service';
import { stopScenes, type StopScene } from '../oncoming-stops';
import { IT, IT_UP } from './izumisano-timetable';
import { NAMBA_WAITS, setLocalPatterns, within } from '../day-patterns';

const LOOP: StationLoop = { lat: -9.2, turnoutLength: 90, turnoutLimitKmh: 45 };
const DISTANCES = [0, 900, 2600, 4400, 5300, 6400, 8000];
const names = [
  ['岸和田', 'きしわだ'], ['蛸地蔵', 'たこじぞう'], ['貝塚', 'かいづか'], ['二色浜', 'にしきのはま'],
  ['鶴原', 'つるはら'], ['井原里', 'いはらのさと'], ['泉佐野', 'いずみさの'],
];
const LAST = names.length - 1;
// 泉佐野は南海公式構内図・配線略図の島式3面4線を、既存のcustomPlatforms/extraTracksで表現する。
// 線路は上（下りの進行方向左・山側）から 外側下り線(T1)・下り本線(T2)・上り本線(T3)・外側上り線(T4)。
// 島式ホームは線路の間: P1=T1〜T2（1・2番）、P2=T2〜T3（3・4番）、P3=T3〜T4（5・6番）。
// T2・T3 は両側にホームがあり両側のドアを開けられる。横位置・分岐器長は写真・図面からの実測ではなくゲーム用の概形:
// 線路間隔 9.2m、島式の幅 5.8m（線路中心からホーム端 1.7m）。実寸は不明。
// 空港線は外側下り線(T1)の泉佐野南端から分かれて本線2本をまたぎ、上りは外側上り線(T4)へ入る。
// 南へ続く本線は T2・T3 の2本で、T1・T4 は泉佐野構内の待避・空港線専用として扱う（コースは泉佐野で終わるので南の分岐は描かない）。
export const IZUMISANO_PLATFORMS: NonNullable<Station['customPlatforms']> = [
  { kind: 'island', lat: -4.6, width: 5.8 },
  { kind: 'island', lat: 4.6, width: 5.8 },
  { kind: 'island', lat: 13.8, width: 5.8 },
];
/** 上り本線(T3)。route.tracks の対向線(4)が駅の手前から 9.2 へ開く */
const MAIN_UP: LatProfile = [[7700, 4], [7950, 9.2], [8600, 9.2]];
/** 外側下り線(T1)。下り本線(0)から分かれる */
const OUTER_DOWN: LatProfile = [[7700, 0], [7950, -9.2], [8600, -9.2]];
/** 外側上り線(T4)。上り本線(4)の位置から分かれ、上り本線(T3)の外側へ入る */
const OUTER_UP: LatProfile = [[7650, 4], [7950, 18.4], [8600, 18.4]];
const IZUMISANO_EXTRA: ExtraTrack[] = [
  { id: 'izumisano-t1', lat: OUTER_DOWN, from: 7700, to: 8600, ownDeck: false },
  { id: 'izumisano-t4', lat: OUTER_UP, from: 7650, to: 8600, ownDeck: false },
];
const stations: Station[] = names.map(([name, kana], i) => {
  const stopS = 180 + DISTANCES[i];
  const loop = i === 0 || i === 2;
  return {
    name, kana, stopS, platform: { from: stopS - 180, to: stopS + 40, side: 'L' },
    scheduledArrival: i * 100, dwell: i && i < LAST ? 25 : undefined, stopMarkerCars: 6,
    elevated: i === 0 || i === LAST, layout: i === LAST ? 'custom' : loop ? 'loop' : 'relative',
    ...(i === LAST ? { customPlatforms: IZUMISANO_PLATFORMS, mainTrack: '2番線' } : {}),
    ...(loop ? { loop: { ...LOOP } } : {}),
    ...(i === 0 ? { loopTrack: '1番線', indoor: true } : i === 2 ? { loopTrack: '1番線' } : {}),
  };
});
const approachSigns = (stopS: number): Sign[] => [
  ...[500, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - 20, cars: 4 }, { kind: 'stopMarker', s: stopS, cars: 6 }, { kind: 'stopMarker', s: stopS, cars: 8 },
];
const STOP_SCENES: StopScene[] = [
  { station: 2, kind: 'commuter-old', cars: 6, kmh: 78, label: '急行' },
  { station: 5, kind: 'commuter-new', cars: 4, kmh: 74 },
];
const crossings = [
  { id: 'takojizo-south', s: 1347, roadWidth: 4 },
  { id: 'kaizuka-north', s: 2031, roadWidth: 7 },
  { id: 'kaizuka-residential', s: 2226, roadWidth: 5 },
  { id: 'kaizuka-approach', s: 2349, roadWidth: 5 },
  { id: 'kaizuka-south', s: 3142, roadWidth: 7 },
  { id: 'nishikinohama-south', s: 4740, roadWidth: 5 },
  { id: 'tsuruhara-south', s: 5563, roadWidth: 5 },
  { id: 'iharanosato-north', s: 5763, roadWidth: 5 },
  { id: 'iharanosato-residential', s: 6051, roadWidth: 4 },
  { id: 'iharanosato-approach', s: 6192, roadWidth: 5 },
  { id: 'izumisano-north', s: 6992, roadWidth: 7 },
];
const signals: { id: string; s: number }[] = [];
for (let i = 0; i < stations.length; i++) {
  const sta = stations[i], z = loopZone(sta);
  if (i > 0) signals.push({ id: `entry-${i}`, s: z ? z.inFrom - 60 : sta.platform.from - 150 });
  if (i < LAST) signals.push({ id: `departure-${i}`, s: z ? sta.stopS + 65 : sta.stopS + 65 });
  const next = stations[i + 1];
  if (next) {
    const from = z ? z.outTo + 60 : sta.platform.to + 160, nz = loopZone(next), to = nz ? nz.inFrom - 100 : next.platform.from - 200;
    for (let k = 1; k <= Math.floor((to - from) / 600); k++) signals.push({ id: `block-${i}-${k}`, s: Math.round(from + (to - from) * k / (Math.floor((to - from) / 600) + 1)) });
  }
}
signals.sort((a, b) => a.s - b.s);

export const izumisano: Route = {
  id: 'izumisano', lineId: 'shiokaze', theme: 'coast', name: '南海本線 岸和田 → 泉佐野',
  lineLimit: 90, startS: 180, startClock: 10 * 3600, trainLength: 120, seaSide: 1,
  segments: [
    { type: 'straight', length: 1250 }, { type: 'arc', radius: 300 / (.28449), angle: .28449, turn: 'L' },
    { type: 'straight', length: 1480 }, { type: 'arc', radius: 120 / (.05934), angle: .05934, turn: 'L' },
    { type: 'straight', length: 1600 }, { type: 'arc', radius: 120 / (.06109), angle: .06109, turn: 'R' },
    { type: 'straight', length: 2080 }, { type: 'arc', radius: 200 / (.1885), angle: .1885, turn: 'R' },
    { type: 'straight', length: 1650 },
  ],
  elevation0: 9, gradients: [{ from: 500, to: 860, permil: -25 }, { from: 7160, to: 7520, permil: 25 }],
  limits: [{ from: 1250, to: 1670, kmh: 85, label: '曲線制限' }, { from: 6950, to: 7270, kmh: 85, label: '曲線制限' }],
  stations,
  services: [
    { id: 'local', name: '普通', cars: 4, units: [4], kind: 'commuter-new', kindOptions: ['commuter-new', 'commuter-old', 'commuter-1000'], formationOptions: [[4], [4, 2], [6]], lineLimit: 90, useLoop: true, stops: [0, 1, 2, 3, 4, 5, 6], timetable: IT.local },
    { id: 'express', name: '急行', cars: 6, units: [4, 2], kind: 'commuter-old', kindOptions: ['commuter-old', 'commuter-new', 'commuter-1000', 'commuter-9000'], formationOptions: [[4, 2], [4, 4], [6]], lineLimit: 110, stops: [0, 2, 6], timetable: IT.express },
    airportService([0, 2, 6], IT.airport),
    { id: 'southern', name: '特急サザン', cars: 8, units: [4, 4], kind: 'southern-10000', unitKinds: ['southern-10000', 'commuter-old'], lineLimit: 110, stops: [0, 6], timetable: IT.southern },
    { id: 'limited', name: '特急ラピートβ', cars: 6, units: [6], kind: 'limited', lineLimit: 110, stops: [0, 6], timetable: IT.limited },
  ],
  precedingHeadway: { express: 240, airport: 240, limited: 330, southern: 330 },
  prevName: '和泉大宮', nextName: '羽倉崎', signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
  extent: { from: -400, to: 8600 }, tracks: [0, 4], trackProfiles: { 4: MAIN_UP },
  deckJoin: [{ from: 7650, to: 8600 }],
  scenery: { cityZones: [{ from: -Infinity, to: 650 }, { from: 1150, to: Infinity }] },
  oncoming: stopScenes(stations, STOP_SCENES), signals, crossings,
  // 橋2か所は OSM の水面が線路を横切る所（汎用の桁橋。川の名前（1700 の方）・橋の構造・高さ・長さは不明）。
  // 範囲は OSM の水面が線路上で占める s（1697〜1717、5062〜5080）に前後 20m 強を足した
  structures: [{ kind: 'viaduct', from: -400, to: 860 }, { kind: 'bridge', from: 1675, to: 1740 }, { kind: 'bridge', from: 5040, to: 5100 }, { kind: 'viaduct', from: 7160, to: 8600 }],
  extraTracks: IZUMISANO_EXTRA,
  terminalApproach: false,
};
// 下りの走行線と番線（ゲーム用の割り当て。出典で種別ごとの番線は確定できない）。
// 空港線系統（空港急行・ラピートβ）は外側下り線(T1)・1番。普通は現行どおり外側下り線(T1)・1番（待避設定は無いまま）。
// 急行・サザンは下り本線(T2)の2番（乗降側＝P1側）。T1 は P1 の右側、T2 は P1 の左側にホームがある。
for (const v of izumisano.services!) {
  const outer = v.id === 'local' || v.id === 'airport' || v.id === 'limited';
  v.lane = outer ? OUTER_DOWN : [[0, 0]];
  v.trackNames = { 6: outer ? '1番線' : '2番線' };
  v.platformSides = { 6: outer ? 'R' : 'L' };
  if (outer) v.laneLimits = [{ from: 7700, to: 8000, kmh: 45, label: '泉佐野分岐器' }];
  // 空港系統は普通と同じ外側下り線に入る。旧配線では普通と別の線（空港下り線）だったので、先行の普通は従来どおり別の番線として扱う
  if (v.id === 'airport' || v.id === 'limited') v.precedingLocalApart = true;
}
setDestinations(izumisano.services!, 'wakayama');

export const izumisanoUp: Route = reverseRoute(izumisano, { id: 'izumisano-up', name: '南海本線 泉佐野 → 岸和田', timetable: IT_UP, oncomingStops: STOP_SCENES, signs: approachSigns });
izumisanoUp.stations[LAST].loopTrack = '4番線'; izumisanoUp.stations[4].loopTrack = '4番線';
for (const v of izumisanoUp.services!) if (v.id === 'southern') { v.kind = 'commuter-old'; v.unitKinds = ['commuter-old', 'southern-10000']; }
// 上りの走行線と番線。空港線系統は外側上り線(T4)・6番（P3の右側）、本線系統は上り本線(T3)・5番（P3の左側）。
for (const v of izumisanoUp.services!) {
  const airport = v.id === 'airport' || v.id === 'limited';
  v.lane = mirrorProfile(izumisano, airport ? OUTER_UP : MAIN_UP);
  v.trackNames = { 0: airport ? '6番線' : '5番線' };
  v.platformSides = { 0: airport ? 'R' : 'L' };
  if (airport) {
    const L = izumisanoUp.segments.reduce((s, g) => s + (g.type === 'straight' ? g.length : g.radius * g.angle), 0);
    v.laneLimits = [{ from: L - 8000, to: L - 7650, kmh: 45, label: '泉佐野分岐器' }];
  }
}
setDestinations(izumisanoUp.services!, 'namba');
setLocalPatterns(izumisanoUp, { waits: within(izumisanoUp, NAMBA_WAITS) });
