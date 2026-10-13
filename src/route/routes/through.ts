// 南海本線 堺〜岸和田の通しコース（14駅・16.2km）。堺〜泉大津（shiokaze.ts）と泉大津〜岸和田（kishiwada.ts）を泉大津でつないで作る（route/concat.ts）。
// 特急・特急サザンは堺 → 岸和田をノンストップ。普通は高石で特急・サザン、浜寺公園で急行を待避する（区間データと同じ）。
// 内部 ID: 'nankai-through' = 岸和田 → 堺（堺〜泉大津の部分が shiokaze と同じ向き）、'nankai-through-up' = 堺 → 岸和田（同じ部分が shiokaze-up と同じ向き）。
// 景観の一部（羽衣・浜寺公園の駅、跨線橋の斜交）は route.id の '-up' で堺〜泉大津の向きを判定しているため、その規則に合わせた。
import { concatRoutes } from '../concat';
import { airportService, setDestinations } from '../service';
import type { ServiceSpec, Sign } from '../types';
import { shiokaze, shiokazeUp } from './shiokaze';
import { kishiwada, kishiwadaUp } from './kishiwada';
import { NT, NT_UP } from './through-timetable';
import { NAMBA_WAITS, WAKAYAMA_WAITS, setLocalPatterns, within } from '../day-patterns';

const approachSigns = (stopS: number): Sign[] => [
  ...[500, 300, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - 20, cars: 4 },
  { kind: 'stopMarker', s: stopS, cars: 6 },
  { kind: 'stopMarker', s: stopS, cars: 8 },
];
const ALL = Array.from({ length: 14 }, (_, i) => i);
const at = (route: typeof shiokaze, name: string) => route.stations.findIndex(s => s.name === name);

// 堺 → 岸和田（下り）: 堺0 … 泉大津9 忠岡10 春木11 和泉大宮12 岸和田13。駅 index は駅名で引く
const dnIdx = (name: string) => name === '岸和田' ? 13 : name === '春木' ? 11 : at(shiokazeUp, name);
const dnServices: ServiceSpec[] = [
  {
    id: 'local', name: '普通', cars: 4, units: [4], kind: 'commuter-new',
    kindOptions: ['commuter-new', 'commuter-old', 'commuter-1000'], formationOptions: [[4], [4, 2], [6]],
    lineLimit: 90, useLoop: true, stops: ALL, timetable: NT.local,
    // 1駅に複数の待避を並べたときは、普通（自列車）は先頭の種別を待つ。優等列車側は自分の種別の行を使う
    waits: [
      { station: dnIdx('浜寺公園'), passedBy: 'express' }, { station: dnIdx('浜寺公園'), passedBy: 'airport' },
      { station: dnIdx('高石'), passedBy: 'limited' }, { station: dnIdx('高石'), passedBy: 'southern' },
    ],
  },
  {
    id: 'express', name: '急行', cars: 6, units: [4, 2], kind: 'commuter-old',
    kindOptions: ['commuter-old', 'commuter-new', 'commuter-1000', 'commuter-9000'], formationOptions: [[4, 2], [4, 4], [4, 2, 2], [6]],
    lineLimit: 110, stops: [0, dnIdx('羽衣'), dnIdx('泉大津'), 13], timetable: NT.express,
  },
  airportService([0, dnIdx('羽衣'), dnIdx('泉大津'), dnIdx('春木'), 13], NT.airport),
  {
    id: 'southern', name: '特急サザン', cars: 8, units: [4, 4], kind: 'southern-10000', unitKinds: ['southern-10000', 'commuter-old'],
    lineLimit: 110, stops: [0, 13], timetable: NT.southern,
  },
  { id: 'limited', name: '特急ラピートβ', cars: 6, units: [6], kind: 'limited', lineLimit: 110, stops: [0, 13], timetable: NT.limited },
];
setDestinations(dnServices, 'wakayama');

/** 堺 → 岸和田（下り） */
export const throughUp = concatRoutes(shiokazeUp, kishiwada, {
  id: 'nankai-through-up', name: '南海本線 堺 → 岸和田', services: dnServices, signs: approachSigns,
});

// 岸和田 → 堺（上り）: 岸和田0 和泉大宮1 春木2 忠岡3 泉大津4、以降は shiokaze の index + 4
const upIdx = (name: string) => name === '春木' ? 2 : at(shiokaze, name) + 4;
const dn = (id: ServiceSpec['id']) => dnServices.find(v => v.id === id)!;
const upServices: ServiceSpec[] = [
  {
    ...dn('local'), timetable: NT_UP.local,
    waits: [
      { station: upIdx('高石'), passedBy: 'limited' }, { station: upIdx('高石'), passedBy: 'southern' },
      { station: upIdx('浜寺公園'), passedBy: 'express' }, { station: upIdx('浜寺公園'), passedBy: 'airport' },
    ],
  },
  { ...dn('express'), stops: [0, upIdx('泉大津'), upIdx('羽衣'), 13], timetable: NT_UP.express },
  { ...dn('airport'), stops: [0, upIdx('春木'), upIdx('泉大津'), upIdx('羽衣'), 13], timetable: NT_UP.airport },
  { ...dn('southern'), kind: 'commuter-old', unitKinds: ['commuter-old', 'southern-10000'], timetable: NT_UP.southern },
  { ...dn('limited'), timetable: NT_UP.limited },
];
setDestinations(upServices, 'namba');

/** 岸和田 → 堺（上り） */
export const through = concatRoutes(kishiwadaUp, shiokaze, {
  id: 'nankai-through', name: '南海本線 岸和田 → 堺', services: upServices, signs: approachSigns,
});

// 時間帯ごとの普通の待避（route/day-patterns.ts）
setLocalPatterns(throughUp, { waits: within(throughUp, WAKAYAMA_WAITS) });
setLocalPatterns(through, { waits: within(through, NAMBA_WAITS) });
