// 桜ヶ丘 → みなと川（約2.4km）。直線 → 右カーブ → 直線
import type { Route, Sign } from '../types';

const STOP_S = 2600;

const approachSigns = (stopS: number): Sign[] => [
  ...[500, 300, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS, cars: 6 },
];

export const sakuragaoka: Route = {
  id: 'sakuragaoka',
  name: '桜ヶ丘 → みなと川',
  lineLimit: 90,
  startS: 190,
  startClock: 10 * 3600,
  trainLength: 100,
  segments: [
    { type: 'straight', length: 1100 },
    { type: 'arc', radius: 700, angle: 0.5, turn: 'R' },
    { type: 'straight', length: 3000 },
  ],
  gradients: [],
  limits: [{ from: 1100, to: 1650, kmh: 65, label: '曲線制限' }],
  stations: [
    { name: '桜ヶ丘', stopS: 190, platform: { from: 20, to: 200, side: 'L' }, scheduledArrival: 0 },
    { name: 'みなと川', stopS: STOP_S, platform: { from: 2420, to: 2620, side: 'L' }, scheduledArrival: 155, stopMarkerCars: 6 },
  ],
  prevName: '山手台',
  nextName: '海浜公園',
  signs: [
    { kind: 'limit', s: 1100, kmh: 65 },
    { kind: 'limitEnd', s: 1650 },
    { kind: 'limit', s: 190 + 40, kmh: 90, size: 0.9 },
    ...approachSigns(STOP_S),
  ],
  extent: { from: -400, to: 3200 },
  tracks: [0, 4],
  scenery: { cityZones: [{ from: -Infinity, to: 480 }, { from: 2150, to: Infinity }], endBlockS: 3260 },
  oncoming: [{ spawnAt: 420, startS: 1750, cars: 6, carLen: 20, gap: 0.8, kmh: 78, lat: 4 }],
};
