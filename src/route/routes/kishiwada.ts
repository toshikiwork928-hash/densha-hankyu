// 南海本線: 泉大津〜岸和田の実在の駅名・駅間距離・配線を参考にした複線（5駅・5.6km）。公式の再現ではない概形。
// 下り（泉大津 → 岸和田、和歌山方面）を基準データとし、上りは reverseRoute で作る。
// 駅間は営業キロ（泉大津 20.4 → 忠岡 22.3 → 春木 23.7 → 和泉大宮 25.0 → 岸和田 26.0km）。
// 曲線・踏切・橋・高架の範囲は OpenStreetMap の線路形状から読んだ位置を、駅間ごとに営業キロへ伸縮して写した概形（2026-10 調査）。
// 配線の参考: 配線略図.net 南海本線 figures/011_04.svg（泉大津・忠岡・春木・和泉大宮）・011_05.svg（岸和田）。
//   泉大津・岸和田 = 島式2面4線（外側に待避線）、忠岡・春木・和泉大宮 = 相対式2面2線。
import type { Route, Sign, Station, StationLoop } from '../types';
import { reverseRoute } from '../reverse';
import { airportService, loopZone, setDestinations } from '../service';
import { stopScenes, type StopScene } from '../oncoming-stops';
import { KT, KT_UP } from './kishiwada-timetable';
import { NAMBA_WAITS, setLocalPatterns, within } from '../day-patterns';

/** 泉大津の待避線は堺〜泉大津（shiokaze.ts）と同じ形 */
const LOOP: StationLoop = { lat: -9.2, turnoutLength: 90, turnoutLimitKmh: 45 };
const DISTANCES = [0, 1900, 3300, 4600, 5600];
const names = [
  ['泉大津', 'いずみおおつ'], ['忠岡', 'ただおか'], ['春木', 'はるき'], ['和泉大宮', 'いずみおおみや'], ['岸和田', 'きしわだ'],
];
const LAST = names.length - 1;
const stations: Station[] = names.map(([name, kana], i) => {
  const stopS = 180 + DISTANCES[i];
  const loop = i === 0 || i === LAST;
  return {
    name, kana, stopS, platform: { from: stopS - 180, to: stopS + 40, side: 'L' },
    scheduledArrival: i * 100, dwell: i && i < LAST ? 25 : undefined, stopMarkerCars: 6,
    // 泉大津・岸和田は高架、忠岡・春木・和泉大宮は地上
    elevated: loop,
    layout: loop ? 'loop' : 'relative',
    ...(loop ? { loop: { ...LOOP } } : {}),
    // 下りの普通は終着の岸和田で待避線（1番線）へ入線する。番線は概形（実際の番線割当ては未確認）
    ...(i === 0 ? { loopTrack: '1番線' } : i === LAST ? { loopTrack: '1番線', indoor: true } : {}),
  };
});

const approachSigns = (stopS: number): Sign[] => [
  ...[500, 300, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - 20, cars: 4 },
  { kind: 'stopMarker', s: stopS, cars: 6 },
  { kind: 'stopMarker', s: stopS, cars: 8 },
];

/** 対向（上り）列車の停車シーン（下りの駅 index）。春木は空港急行停車駅 */
const STOP_SCENES: StopScene[] = [
  { station: 1, kind: 'commuter-new', cars: 4, kmh: 74 },
  { station: 2, kind: 'commuter-old', cars: 8, kmh: 80, label: '空港急行' },
  { station: 3, kind: 'commuter-old', cars: 6, kmh: 74, label: '普通' },
];

/** 踏切（地上区間のみ。OSM の踏切位置を写し、ホーム端に近いものは端の先へ寄せた） */
const crossings = [
  { id: 'otsugawa-south', s: 1265, roadWidth: 6 },
  { id: 'tadaoka-north', s: 1700, roadWidth: 8 },
  { id: 'tadaoka', s: 2150, roadWidth: 6 },
  { id: 'tadaoka-south', s: 2520, roadWidth: 6 },
  { id: 'haruki', s: 3545, roadWidth: 7 },
  { id: 'haruki-south-1', s: 3940, roadWidth: 6 },
  { id: 'haruki-south-2', s: 4090, roadWidth: 6 },
  { id: 'omiya-north', s: 4340, roadWidth: 6 },
  { id: 'omiya', s: 4845, roadWidth: 8 },
];

/** 出発・場内信号と駅間の閉そく信号。ホーム端のすぐ先に踏切がある駅（忠岡・春木・和泉大宮）は出発信号を踏切の手前へ。閉そく信号は踏切の前後 25m を避ける */
const signals: { id: string; s: number }[] = [];
const nearCrossing = (s: number) => crossings.find(c => Math.abs(s - c.s) < 25);
for (let i = 0; i < stations.length; i++) {
  const sta = stations[i], z = loopZone(sta);
  if (i > 0) signals.push({ id: `entry-${i}`, s: z ? z.inFrom - 60 : sta.platform.from - 150 });
  if (i < LAST) {
    const c = crossings.find(q => q.s > sta.platform.to && q.s < sta.stopS + 95);
    signals.push({ id: `departure-${i}`, s: z ? sta.stopS + 65 : c ? Math.min(sta.stopS + 65, c.s - 20) : sta.stopS + 65 });
  }
  const next = stations[i + 1];
  if (next) {
    const from = z ? z.outTo + 60 : sta.platform.to + 160;
    const nz = loopZone(next), to = nz ? nz.inFrom - 100 : next.platform.from - 200;
    const count = Math.floor((to - from) / 600);
    for (let k = 1; k <= count; k++) {
      let s = Math.round(from + (to - from) * k / (count + 1));
      const c = nearCrossing(s);
      if (c) s = c.s - 30;
      signals.push({ id: `block-${i}-${k}`, s });
    }
  }
}
signals.sort((a, b) => a.s - b.s);

export const kishiwada: Route = {
  id: 'kishiwada', lineId: 'shiokaze', theme: 'coast', name: '南海本線 泉大津 → 岸和田',
  lineLimit: 90, startS: 180, startClock: 10 * 3600, trainLength: 120,
  // 下りは南西へ進み、海（大阪湾）は右側
  seaSide: 1,
  // OSM の線路形状: 泉大津を出て約 400〜800m で左へ約34°（高架を下りながら大津川へ）、忠岡〜春木で右へ約15°、
  // 和泉大宮〜岸和田の高架で右へ約20°（岸和田の分岐器に掛からないよう手前へ寄せた）、岸和田の先でさらに右へ。他は直線
  segments: [
    { type: 'straight', length: 515 },
    { type: 'arc', radius: 680, angle: .597, turn: 'L' },      // 泉大津の南（515〜921m）
    { type: 'straight', length: 1802 },
    { type: 'arc', radius: 1015, angle: .26, turn: 'R' },      // 忠岡〜春木（2723〜2987m）
    { type: 'straight', length: 2250 },
    { type: 'arc', radius: 560, angle: .358, turn: 'R' },      // 和泉大宮〜岸和田の高架（5237〜5437m）
    { type: 'straight', length: 562.6 },
    { type: 'arc', radius: 950, angle: .21, turn: 'R' },       // 岸和田の先（6000〜6200m）
    { type: 'straight', length: 300 },
  ],
  // 泉大津（高架 9m）を出て大津川の手前で地上へ、和泉大宮を出て岸和田（高架）へ上る。各駅ホームと分岐器は水平
  elevation0: 9,
  gradients: [
    { from: 700, to: 1060, permil: -25 },
    { from: 4900, to: 5260, permil: 25 },
  ],
  limits: [
    { from: 505, to: 1041, kmh: 85, label: '曲線制限' },
    { from: 2713, to: 3107, kmh: 100, label: '曲線制限' },
    { from: 5227, to: 5558, kmh: 75, label: '曲線制限' },
  ],
  stations,
  services: [
    {
      id: 'local', name: '普通', cars: 4, units: [4], kind: 'commuter-new',
      kindOptions: ['commuter-new', 'commuter-old', 'commuter-1000'], formationOptions: [[4], [4, 2], [6]],
      lineLimit: 90, useLoop: true, stops: [0, 1, 2, 3, 4], timetable: KT.local,
    },
    {
      id: 'express', name: '急行', cars: 6, units: [4, 2], kind: 'commuter-old',
      kindOptions: ['commuter-old', 'commuter-new', 'commuter-1000', 'commuter-9000'], formationOptions: [[4, 2], [4, 4], [4, 2, 2], [6]],
      lineLimit: 110, stops: [0, 4], timetable: KT.express,
    },
    airportService([0, 2, 4], KT.airport),
    {
      id: 'southern', name: '特急サザン', cars: 8, units: [4, 4], kind: 'southern-10000', unitKinds: ['southern-10000', 'commuter-old'],
      lineLimit: 110, stops: [0, 4], timetable: KT.southern,
    },
    { id: 'limited', name: '特急ラピートβ', cars: 6, units: [6], kind: 'limited', lineLimit: 110, stops: [0, 4], timetable: KT.limited },
  ],
  // 途中に待避駅が無いので、先行の普通は優等列車に追いつかれない間隔で先に出す
  precedingHeadway: { express: 240, airport: 240, limited: 330, southern: 330 },
  prevName: '松ノ浜', nextName: '蛸地蔵',
  signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
  extent: { from: -400, to: 6400 }, tracks: [0, 4],
  // 大津川の河川敷は町並みを置かない
  scenery: { cityZones: [{ from: -Infinity, to: 1060 }, { from: 1340, to: Infinity }] },
  oncoming: [
    ...stopScenes(stations, STOP_SCENES),
  ],
  signals,
  crossings,
  structures: [
    { kind: 'viaduct', from: -400, to: 1060 },
    { kind: 'bridge', from: 1150, to: 1245 },   // 大津川
    { kind: 'bridge', from: 3690, to: 3725 },   // 春木川
    { kind: 'viaduct', from: 4890, to: 6400 },
  ],
  coastalLandmarks: [
    // 忠岡〜春木で府道が線路の上を越える
    { kind: 'road-overpass', s: 2737, length: 100, side: 1, label: '府道跨線橋' },
    // 泉大津駅前の2棟並びのタワーマンション（1995年竣工・36階）。駅中心から岸和田側へ約 135m、内陸（下りの左）に 70m・140m。
    // 堺〜泉大津（shiokaze.ts）にも同じ物理位置で置く（world/izumiotsu-towers.ts の共通関数）
    { kind: 'twin-tower', s: 110 + 135, side: -1, direction: 1, label: '泉大津駅前タワー' },
  ],
  // 終着の低速進入 ATS は無効（南海本線と同じ）。普通は岸和田1番線（待避線側）へ分岐器制限 45km/h で入線する
  terminalApproach: false,
};

setDestinations(kishiwada.services!, 'wakayama');

export const kishiwadaUp: Route = reverseRoute(kishiwada, {
  id: 'kishiwada-up', name: '南海本線 岸和田 → 泉大津', timetable: KT_UP,
  oncomingStops: STOP_SCENES, signs: approachSigns,
});
// 上り: 泉大津の普通は上りの待避線（4番線）へ入線。行先は難波。サザンは先頭が 7100系（難波側）
kishiwadaUp.stations[LAST].loopTrack = '4番線';
kishiwadaUp.stations[0].loopTrack = '4番線';
for (const v of kishiwadaUp.services!) {
  if (v.id === 'southern') { v.kind = 'commuter-old'; v.unitKinds = ['commuter-old', 'southern-10000']; }
}
setDestinations(kishiwadaUp.services!, 'namba');

// 時間帯ごとの普通の待避（route/day-patterns.ts）。岸和田 → 泉大津は泉大津が終着（到着前の放送で案内）
setLocalPatterns(kishiwadaUp, { waits: within(kishiwadaUp, NAMBA_WAITS) });
