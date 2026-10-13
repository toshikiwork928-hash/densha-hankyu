// 南海本線: 泉大津〜堺の実在の駅名・駅間距離・配線を参考にした海沿いの複線（10駅・10.6km）。公式の再現ではない概形。
// 駅間は南海 HANDBOOK 2025 営業キロ程表を使用。曲線の向きと大きさは地図の駅位置から読んだ概形、勾配・高架高さ・構造物の距離はゲーム向け概形。
// https://www.nankai.co.jp/lib/company/handbook/pdf/handbook2025.pdf （営業キロ程表）
// 配線の参考: 配線略図.net 南海本線（堺 / 湊〜羽衣 / 高石〜泉大津）。詳細は docs/shiokaze-reference.md。
import type { Route, Sign, Station, StationLoop } from '../types';
import { reverseRoute } from '../reverse';
import { airportService, islandZone, loopZone, setDestinations } from '../service';
import { stopScenes, type StopScene } from '../oncoming-stops';
import { SAKAI_LAT, sakaiLayout } from '../sakai-layout';
import { NAMBA_WAITS, WAKAYAMA_WAITS, setLocalPatterns, within } from '../day-patterns';
import { TT, TT_UP } from './shiokaze-timetable';

const LOOP: StationLoop = { lat: -9.2, turnoutLength: 90, turnoutLimitKmh: 45 };
/** 浜寺公園の堺方面待避線: 本線の隣（4m）、ホームは待避線の外側 */
const PARK_LOOP: StationLoop = { lat: -4, turnoutLength: 90, turnoutLimitKmh: 45, outside: true };
const DISTANCES = [0, 900, 1900, 3100, 4800, 5600, 6600, 7700, 9200, 10600];
const names = [
  ['泉大津', 'いずみおおつ'], ['松ノ浜', 'まつのはま'], ['北助松', 'きたすけまつ'],
  ['高石', 'たかいし'], ['羽衣', 'はごろも'], ['浜寺公園', 'はまでらこうえん'],
  ['諏訪ノ森', 'すわのもり'], ['石津川', 'いしづがわ'], ['湊', 'みなと'], ['堺', 'さかい'],
];
/** 諏訪ノ森は上下のホームが踏切を挟んで前後にずれる（対向線側が堺方面へ OPP_SHIFT）。自線側ホームは本来の位置から半分手前へ寄せる */
const OPP_SHIFT = 260;
const SUWA = 6;
/** 堺（上りの終着）: 外側の4番線が本線（優等、直進）、内側の3番線が分岐側（普通、45km/h）。route/sakai-layout.ts */
const SAKAI = sakaiLayout(180 + DISTANCES[9] - 180);
const stations: Station[] = names.map(([name, kana], i) => {
  const stopS = 180 + DISTANCES[i] - (i === SUWA ? OPP_SHIFT / 2 : 0);
  return {
    name, kana, stopS, platform: { from: stopS - 180, to: stopS + 40, side: 'L' },
    scheduledArrival: i * 100, dwell: i && i < 9 ? 25 : undefined, stopMarkerCars: 6,
    elevated: ![2, 5, 6].includes(i),
    layout: [0, 3].includes(i) ? 'loop' : i === 9 ? 'custom' : i === 4 ? 'hagoromo' : i === 5 ? 'hamadera' : 'relative',
    ...([0, 3].includes(i) ? { loop: { ...LOOP } } : {}),
    ...(i === 9 ? { customPlatforms: SAKAI.platforms } : {}),
    // 堺（上り）は下り側の1・2番線と同じ並び: 普通は本線側の3番線、急行・特急は外側の4番線（左右対称の2面4線ではない）
    ...(i === 0 ? { loopTrack: '1番線' } : {}),
    ...(i === 5 ? { loop: { ...PARK_LOOP } } : {}),
    // 湊は島式1面2線（高架）。線路は駅の前後でホームの両側へ開く。
    ...(i === 8 ? { island: { spread: 3.2, length: 100 } } : {}),
    ...(i === SUWA ? { platformOpp: OPP_SHIFT } : {}),
  };
});

const approachSigns = (stopS: number): Sign[] => [
  ...[500, 300, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - 20, cars: 4 },
  { kind: 'stopMarker', s: stopS, cars: 6 },
  { kind: 'stopMarker', s: stopS, cars: 8 },
];
const STOP_SCENES: StopScene[] = [
  { station: 1, kind: 'commuter-new', cars: 4, kmh: 74 },
  { station: 3, kind: 'commuter-new', cars: 4, kmh: 74, loop: true },
  { station: 3, kind: 'limited', cars: 6, kmh: 90, follow: true, through: true },
  { station: 4, kind: 'commuter-old', cars: 6, kmh: 74 },
  // 7100系の既定の種別表示は「急行」なので、急行が停まらない駅（諏訪ノ森・湊）では普通と明示する
  { station: 6, kind: 'commuter-old', cars: 6, kmh: 74, label: '普通' },
  { station: 7, kind: 'commuter-new', cars: 4, kmh: 74 },
  { station: 8, kind: 'commuter-old', cars: 6, kmh: 74, label: '普通' },
];

/** 出発・場内信号と駅間の閉そく信号。駅の分岐器・島式駅の S字区間から離して配置。 */
const signals: { id: string; s: number }[] = [];
for (let i = 0; i < stations.length; i++) {
  const sta = stations[i], z = loopZone(sta), iz = islandZone(sta);
  if (i > 0) signals.push({ id: `entry-${i}`, s: z ? z.inFrom - 60 : iz ? iz.inFrom - 50 : sta.platform.from - 150 });
  // 諏訪ノ森は踏切の手前（ホーム端と踏切の間）に出発信号を置く
  if (i < 9) signals.push({ id: `departure-${i}`, s: iz ? iz.outTo + 70 : sta.stopS + (sta.platformOpp ? 45 : 65) });
  const next = stations[i + 1];
  if (next) {
    const from = z ? z.outTo + 60 : iz ? iz.outTo + 150 : sta.platform.to + 160;
    const nz = loopZone(next), niz = islandZone(next), to = nz ? nz.inFrom - 100 : niz ? niz.inFrom - 120 : next.platform.from - 200;
    const count = Math.floor((to - from) / 600);
    for (let k = 1; k <= count; k++) signals.push({ id: `block-${i}-${k}`, s: Math.round(from + (to - from) * k / (count + 1)) });
  }
}
signals.sort((a, b) => a.s - b.s);

/** 諏訪ノ森の対向線側ホームは踏切の先にずれるので、そこに停車する対向列車の停止位置・出現位置も同じだけずらす。 */
const shiftOpp = (list: ReturnType<typeof stopScenes>, station: number, d: number) => list.map(o => o.stop?.station === station
  ? { ...o, spawnAt: o.spawnAt + d, startS: o.startS + d, stop: { ...o.stop, headS: o.stop.headS + d } } : o);

export const shiokaze: Route = {
  id: 'shiokaze', lineId: 'shiokaze', theme: 'coast', name: '南海本線 泉大津 → 堺',
  lineLimit: 90, startS: 180, startClock: 10 * 3600, trainLength: 120,
  // 地図の駅位置から読んだ曲がり: 泉大津〜高石は北東へほぼ直線（松ノ浜〜北助松で少し左へ）、高石〜羽衣で左へ約20°、羽衣〜浜寺公園でさらに左へ約14°、
  // 浜寺公園〜湊は直線的で、諏訪ノ森を出たところで右へ曲がり（石津川橋梁へ上る）、石津川〜湊は直線、堺へ向けて少しずつ右へ寄る。
  segments: [
    { type: 'straight', length: 1200 },
    { type: 'arc', radius: 1700, angle: .176, turn: 'L' },     // 松ノ浜〜北助松（1200〜1499m）
    { type: 'straight', length: 2280.8 },
    { type: 'arc', radius: 1430, angle: .35, turn: 'L' },      // 高石〜羽衣（3781〜4281m）
    { type: 'straight', length: 819.5 },
    { type: 'arc', radius: 1300, angle: .245, turn: 'L' },     // 羽衣を出て高架を下りながら（5100〜5418m）
    { type: 'straight', length: 1611.5 },
    { type: 'arc', radius: 1200, angle: .14, turn: 'R' },      // 諏訪ノ森を出てすぐのカーブ兼上り坂（7030〜7198m）
    { type: 'straight', length: 2702 },                         // 石津川橋梁・石津川・湊は直線
    { type: 'arc', radius: 1800, angle: .09, turn: 'R' },      // 湊〜堺（9900〜10062m）
    { type: 'straight', length: 1138 },
  ],
  // 高架/地上の指定を再現。基準地盤は0m、高架は9m。各駅ホームと分岐器は水平。
  // 羽衣を出てすぐ高架を下り（5030m〜）、諏訪ノ森を出て上り坂（7000〜7360m）で石津川橋梁へ。
  elevation0: 9,
  gradients: [
    { from: 1250, to: 1610, permil: -25 },   // 松ノ浜（高架）から北助松（地上）へ下る
    { from: 2570, to: 2930, permil: 25 },    // 北助松（地上）から高石（高架）へ上る。高石の分岐器（下り3000m〜、上りは出口側が下りの2940mまで）は水平
    { from: 5030, to: 5390, permil: -25 },
    { from: 7000, to: 7360, permil: 25 },
  ],
  limits: [
    { from: 1190, to: 1620, kmh: 90, label: '沿岸曲線' },
    { from: 3770, to: 4401, kmh: 85, label: '曲線制限' },
    { from: 5090, to: 5539, kmh: 80, label: '曲線制限' },
    { from: 7020, to: 7318, kmh: 80, label: '曲線制限' },
  ],
  stations,
  services: [
    {
      id: 'local', name: '普通', cars: 4, units: [4], kind: 'commuter-new',
      kindOptions: ['commuter-new', 'commuter-old', 'commuter-1000'], formationOptions: [[4], [4, 2], [6]],
      lineLimit: 90, useLoop: true, stops: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], timetable: TT.local,
      waits: [{ station: 3, passedBy: 'limited' }, { station: 5, passedBy: 'express' }, { station: 5, passedBy: 'airport' }],
      // 堺は内側の3番線へ（分岐器制限 45km/h）
      lane: [[-1000, 0], ...SAKAI.up3], laneLimits: [SAKAI.localLimit(SAKAI.up3[0][0] - 10, SAKAI.pt)],
      platformSides: { 9: 'L' }, trackNames: { 9: '3番線' },
    },
    {
      id: 'express', name: '急行', cars: 6, units: [4, 2], kind: 'commuter-old',
      kindOptions: ['commuter-old', 'commuter-new', 'commuter-1000', 'commuter-9000'], formationOptions: [[4, 2], [4, 4], [4, 2, 2], [6]],
      lineLimit: 110, stops: [0, 4, 9], timetable: TT.express, platformSides: { 9: 'R' }, trackNames: { 9: '4番線' },
    },
    { ...airportService([0, 4, 9], TT.airport), platformSides: { 9: 'R' }, trackNames: { 9: '4番線' } },
    { id: 'limited', name: '特急ラピートβ', cars: 6, units: [6], kind: 'limited', lineLimit: 110, stops: [0, 9], timetable: TT.limited, platformSides: { 9: 'R' }, trackNames: { 9: '4番線' } },
  ],
  // 堺: 下り本線が外へずれて上りの3番線の場所を空ける。3番線・1番線は追加の線路
  trackProfiles: { 4: [[-1000, 4], ...SAKAI.down] },
  extraTracks: SAKAI.extraTracks,
  prevName: '忠岡', nextName: '七道',
  signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
  extent: { from: -400, to: 11200 }, tracks: [0, 4],
  scenery: { cityZones: [
    { from: -Infinity, to: 5300 }, { from: 6500, to: Infinity },
  ] },
  oncoming: shiftOpp([...stopScenes(stations, STOP_SCENES)], SUWA, OPP_SHIFT), signals,
  // 地上駅の周辺だけ踏切。高架区間に踏切を作らない。諏訪ノ森は上下ホームの間の踏切。
  crossings: [
    { id: 'north-matsubara-south', s: 1840, roadWidth: 6 },
    { id: 'north-matsubara-north', s: 2250, roadWidth: 6 },
    { id: 'park-south', s: 6040, roadWidth: 7 },
    { id: 'suwanomori', s: 6710, roadWidth: 6 },
  ],
  structures: [
    { kind: 'viaduct', from: -400, to: 1610 },
    { kind: 'viaduct', from: 2570, to: 5395 },
    { kind: 'viaduct', from: 7010, to: 7255 },
    { kind: 'bridge', from: 7255, to: 7360 },   // 石津川。OSM の水面が本線を横切る 7275〜7340m に合わせる
    { kind: 'viaduct', from: 7360, to: 11200 },
  ],
  // 区間内での概形配置。実測距離/橋長ではない。羽衣の南側へ高師浜線の高架分岐を描く。
  coastalLandmarks: [
    { kind: 'road-overpass', s: 1720, length: 155, side: -1, label: '湾岸バイパス' },
    { kind: 'road-overpass', s: 2440, length: 155, side: 1, label: '臨海連絡道路' },
    { kind: 'tram-overpass', s: 6310, length: 864, label: '阪堺電軌' },
    { kind: 'steel-bridge', s: 7307, length: 90, label: '石津川橋梁' },
    // 羽衣の3番線（高師浜線）。s = 島式ホームの泉大津側の端。3線並行のまま約300m高架を進み、のち海側（西）へ離れる（配線略図 011_03）。
    { kind: 'branch', s: stations[4].platform.from, length: 760, side: -1, direction: -1, label: '高師浜線' },
    // 泉大津駅前の2棟並びのタワーマンション（泉大津〜岸和田 kishiwada.ts と同じ物理位置）。駅中心（110m）から岸和田側（s の負の向き）へ約 135m、内陸（右）。direction = 岸和田側の向き
    { kind: 'twin-tower', s: 110 - 135, side: 1, direction: -1, label: '泉大津駅前タワー' },
  ],
  // 終着の低速進入 ATS（game/terminal-ats.ts）は無効。普通は堺3番線・泉大津1番線（待避線側）へ入線し、分岐器制限 45km/h で速度を落とす。
  terminalApproach: false,
};

// 浜寺公園の泉大津方面（対向側）は本線と副線（外側 9.2m）の島式ホーム。対向の普通は副線に停車して、後ろから来る急行を本線で通過させる（通過待ち）。
// 副線の分岐器は上りの待避線（LOOP）の鏡像: 下りの座標で ホームの泉大津側端 −160m 〜 堺側端 +100m。下り専用（上りは stopScenes の鏡像を使わない）
{
  const park = stations[5], zone = { inFrom: park.platform.from - 160, inTo: park.platform.from - 70, outFrom: park.platform.to + 10, outTo: park.platform.to + 100, lat: LOOP.lat, limit: LOOP.turnoutLimitKmh };
  shiokaze.oncoming.push(...stopScenes(stations, [
    { station: 5, kind: 'commuter-new', cars: 4, kmh: 74, loop: true, zone },
    { station: 5, kind: 'commuter-old', cars: 6, kmh: 90, label: '急行', follow: true, through: true },
  ]));
}

setDestinations(shiokaze.services!, 'namba');

export const shiokazeUp: Route = reverseRoute(shiokaze, {
  id: 'shiokaze-up', name: '南海本線 堺 → 泉大津', timetable: TT_UP,
  oncomingStops: STOP_SCENES, signs: approachSigns,
});

// 堺（下りの始発）は通常の並び（普通 = 外側の1番線、優等 = 本線の2番線）
// 堺（下りの始発）: 普通は外側の1番線（分岐器制限 45km/h）、優等は内側の2番線（本線）。横位置は上りの鏡像（2番線 = −9.4、1番線 = −18.8）
{
  const L = 11200, m = (q: number) => L - q, d1 = 4 - SAKAI_LAT.down1, d2 = 4 - SAKAI_LAT.down2;
  for (const v of shiokazeUp.services!) {
    if (v.id === 'local') {
      // 下りはホームの泉大津側（s の増える向き）の分岐器で本線へ
      v.lane = [[-1000, d1], [m(SAKAI.pf - 20), d1], [m(SAKAI.pf - 130), d2], [m(SAKAI.pf - 150), d2], [m(SAKAI.pf - 260), 0]];
      v.laneLimits = [SAKAI.localLimit(-400, m(SAKAI.pf - 130))];
      v.platformSides = { 0: 'R' }; v.trackNames = { 0: '1番線' };
    } else { v.platformSides = { 0: 'L' }; v.trackNames = { 0: '2番線' }; }
  }
}

// 諏訪ノ森: reverseRoute が写した下りの自線側ホームは、上りでは対向線側のホーム。自線側（泉大津方面）ホームは対向線側より OPP_SHIFT だけ手前にある。
{
  const suwa = shiokazeUp.stations[9 - SUWA], old = suwa.stopS;
  suwa.platform = { ...suwa.platform, from: suwa.platform.from - OPP_SHIFT, to: suwa.platform.to - OPP_SHIFT };
  suwa.stopS -= OPP_SHIFT;
  const dep = shiokazeUp.signals!.find(g => g.s === old + 60);
  if (dep) dep.s = suwa.stopS + 45;
}

// 下りは浜寺公園の本線隣の待避線で優等列車の通過を待つ。上りは泉大津方面の副線（島式の外側線）。両方向とも高石では特急を待つ。
// 上りの浜寺公園は reverseRoute が下りの待避線（堺方面）の設定を写すので、泉大津方面側の副線へ入れ替える。
const park = shiokazeUp.stations.findIndex(s => s.name === '浜寺公園');
const bay = shiokazeUp.stations.findIndex(s => s.name === '高石');
shiokazeUp.stations[park].loop = { ...LOOP };
shiokazeUp.services!.find(s => s.id === 'local')!.waits = [
  { station: park, passedBy: 'express' }, { station: park, passedBy: 'airport' }, { station: bay, passedBy: 'limited' },
];
setDestinations(shiokazeUp.services!, 'wakayama');
// 逆転後に追加した分岐器より手前へ場内信号を移す。
const parkZone = loopZone(shiokazeUp.stations[park])!;
shiokazeUp.signals = shiokazeUp.signals!.filter(s => s.s < parkZone.inFrom - 110 || s.s > parkZone.inTo);
shiokazeUp.signals.push({ id: `entry-${park}`, s: parkZone.inFrom - 110 });
shiokazeUp.signals!.sort((a, b) => a.s - b.s);
// 上りの浜寺公園には堺方面の副線（ホームは外側）があり、そこに停まる対向列車は置かない。ラッシュ用の自動追加を避けるため、出現しない印の編成を置く。
const parkOppPf = shiokazeUp.stations[park].platform;
const parkOppZone = { inFrom: parkOppPf.from - 160, inTo: parkOppPf.from - 70, outFrom: parkOppPf.to + 10, outTo: parkOppPf.to + 100, lat: -4, limit: 45 };
shiokazeUp.oncoming.push({ spawnAt: 1e9, startS: 0, cars: 4, carLen: 20, gap: .8, kmh: 74, lat: 4, kind: 'commuter-new', stop: { station: park, headS: 0, loop: true, zone: parkOppZone } });

// 時間帯ごとの普通の待避（route/day-patterns.ts）。堺〜泉大津では泉大津が終着（待ち合わせは到着前の放送で案内）
setLocalPatterns(shiokaze, { waits: within(shiokaze, NAMBA_WAITS) });
setLocalPatterns(shiokazeUp, { waits: within(shiokazeUp, WAKAYAMA_WAITS) });
