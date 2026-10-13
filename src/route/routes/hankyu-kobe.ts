// 阪急神戸線（大阪梅田〜神戸三宮 32.3km）を西宮北口で分けた2コース。
//   コース1 hankyu-kobe-east: 大阪梅田 → 西宮北口（8駅・15.6km）
//   コース2 hankyu-kobe-west: 西宮北口 → 神戸三宮（9駅・16.7km）
// 営業キロは Wikipedia「阪急神戸本線」。線形・勾配・橋・高架は hankyu-kobe-geometry.ts（OSM と国土地理院の標高から作った下書き。実測ではない）。
// 駅の高架・地上の別とホームの形式は Wikipedia の各駅の記事「駅構造」（2026-10-13 閲覧）。配線略図との照合と、頭端式・2面3線・3面4線などの細部は未実施（概形で近似）。
// 時刻表は駅間距離からの概算（仮値）。種別は普通だけ（停車駅の照合前のため）。
import type { ExtraTrack, Route, Sign, SpeedLimit, Station, StationIsland, StationLoop } from '../types';
import { reverseRoute } from '../reverse';
import { islandZone, loopZone } from '../service';
import { HK_EAST, HK_WEST, type HankyuSection } from './hankyu-kobe-geometry';

/** 駅の仮の形。island = 島式1面2線、relative = 相対式2面2線、loop = 島式2面4線（待避線つき） */
type Kind = 'island' | 'relative' | 'loop' | 'loop-outside';
/** 島式: 線路が左右へ 3.2m ずつ開く。S字は 120m（60m では線路と架線がくねって見えた。ユーザー指摘 2026-10-13） */
const ISLAND: StationIsland = { spread: 3.2, length: 120 };
const LOOP: StationLoop = { lat: -4.6, turnoutLength: 60, turnoutLimitKmh: 45 };
/** [駅名, かな, 形, 高架] 。loop-outside = 相対式ホームの内側に通過線（六甲。待避線の外側にホーム） */
// 配線は配線略図.net 阪急神戸線 figures/011_01・010_02〜010_04（2026-10-13 閲覧）。図の上が下り線（進行方向の左）。
// 大阪梅田: 高架・頭端式10面9線（神戸線は3線・ホーム4面）→ 島式で近似。中津: 高架・島式（神戸線1・2号線）。十三: 地上・4面6線。神戸線は下りが外側の単式、上りが宝塚線と共用の島式 → 相対式で表す。
// 神崎川: 地上（堤防・盛土上）・相対式。園田: 高架・島式2面4線（外側が待避線）＋臨時ホーム。塚口: 地上・2面3線（伊丹線）→ 相対式で近似。
// 武庫之荘: 地上・相対式。西宮北口: 地上（橋上駅舎）・4面4線（島式2面。1・4号線が待避線）。夙川: 地上・相対式（甲陽線は別ホーム）。
// 芦屋川・岡本・御影: 地上・相対式。六甲: 地上・相対式2面4線（ホームは待避線、中央の2線は通過線）。王子公園: 高架・相対式。春日野道: 高架・島式。神戸三宮: 高架・2面3線（下り線と上り線の間に島式、上り線の外に島式と3線目）→ 島式で近似
type Sta = [string, string, Kind, boolean];
const EAST: Sta[] = [
  ['大阪梅田', 'おおさかうめだ', 'island', true], ['中津', 'なかつ', 'island', true], ['十三', 'じゅうそう', 'relative', false], ['神崎川', 'かんざきがわ', 'relative', false],
  ['園田', 'そのだ', 'loop', true], ['塚口', 'つかぐち', 'relative', false], ['武庫之荘', 'むこのそう', 'relative', false], ['西宮北口', 'にしのみやきたぐち', 'loop', false],
];
const WEST: Sta[] = [
  ['西宮北口', 'にしのみやきたぐち', 'loop', false], ['夙川', 'しゅくがわ', 'relative', false], ['芦屋川', 'あしやがわ', 'relative', false], ['岡本', 'おかもと', 'relative', false],
  ['御影', 'みかげ', 'relative', false], ['六甲', 'ろっこう', 'loop-outside', false], ['王子公園', 'おうじこうえん', 'relative', true], ['春日野道', 'かすがのみち', 'island', true], ['神戸三宮', 'こうべさんのみや', 'island', true],
];
const TRAIN_LEN = 8 * 19;
const LINE_LIMIT = 115;

const approachSigns = (stopS: number): Sign[] => [
  ...[500, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS, cars: 8 },
];
/** 時刻表（仮値）: 駅間の走行 = 距離 / 平均 70km/h + 40 秒、途中駅の停車 25 秒。stops = 停止位置の並び */
function roughTimetable(stops: number[]): Record<number, { arr: number; dep?: number }> {
  const out: Record<number, { arr: number; dep?: number }> = { 0: { arr: 0, dep: 0 } };
  let t = 0;
  for (let i = 1; i < stops.length; i++) {
    t += Math.round(Math.abs(stops[i] - stops[i - 1]) / (70 / 3.6) + 40);
    out[i] = i === stops.length - 1 ? { arr: t } : { arr: t, dep: t + 25 };
    t += 25;
  }
  return out;
}
const curveKmh = (R: number) => Math.floor(3.8 * Math.sqrt(R) / 5) * 5;

/** OSM の橋（bridge タグ）を橋梁と高架橋に分ける。大きな川を含む橋は全体を橋梁（川底を下げる）。
 *  ほかは、名前のある川（river）が横切る所の前後 25m を橋梁、残りを高架橋にする。川の無い橋は高架橋 */
const BIG = /^(淀川|神崎川|猪名川|旧猪名川|藻川|武庫川)$/;
function structuresOf(sec: HankyuSection) {
  const out: { kind: 'bridge' | 'viaduct'; from: number; to: number; drop?: number }[] = [];
  for (const x of sec.structures.filter(q => q.kind === 'bridge')) {
    const from = Math.round(x.from), to = Math.round(x.to);
    const rs = sec.rivers.filter(r => r.s >= from - 10 && r.s <= to + 10);
    if (rs.some(r => BIG.test(r.name))) { out.push({ kind: 'bridge', from, to, drop: 6 }); continue; }
    const named = rs.filter(r => r.type === 'river');
    if (!named.length) { out.push({ kind: 'viaduct', from, to }); continue; }
    let cur = from;
    for (const r of named) {
      const a = Math.max(from, r.s - 25), b = Math.min(to, r.s + 25);
      if (a - cur > 30) out.push({ kind: 'viaduct', from: cur, to: a });
      out.push({ kind: 'bridge', from: a, to: b });
      cur = b;
    }
    if (to - cur > 30) out.push({ kind: 'viaduct', from: cur, to });
  }
  return out;
}

function build(id: string, name: string, sec: HankyuSection, list: Sta[], headStart: boolean, extra: { viaducts?: [number, number][]; limits?: SpeedLimit[]; extraTracks?: ExtraTrack[] } = {}): Route {
  const added = (extra.viaducts ?? []).map(([from, to]) => ({ kind: 'viaduct' as const, from, to }));
  // 足した高架橋の中にある OSM の高架橋は除く（二重に描かない）
  const structures = [...structuresOf(sec).filter(x => !(x.kind === 'viaduct' && added.some(v => x.from >= v.from && x.to <= v.to))), ...added].sort((a, b) => a.from - b.from);
  const LAST = list.length - 1;
  const tt = roughTimetable(list.map(([nm]) => sec.pre + sec.distances[nm]));
  const stations: Station[] = list.map(([nm, kana, kind, elev], i) => {
    const stopS = sec.pre + sec.distances[nm];
    return {
      name: nm, kana, stopS, platform: { from: stopS - 175, to: stopS + 15, side: 'L' as const },
      scheduledArrival: tt[i].arr, dwell: i && i < LAST ? 25 : undefined, stopMarkerCars: 8,
      ...(elev ? { elevated: true } : {}),
      ...(kind === 'island' ? { island: { ...ISLAND } } : kind === 'loop' ? { loop: { ...LOOP } } : kind === 'loop-outside' ? { loop: { ...LOOP, outside: true } } : { layout: 'relative' as const }),
      ...(i === 0 && headStart ? { headEnd: true } : {}),
    };
  });
  const limits: SpeedLimit[] = [];
  {
    let s = 0;
    for (const g of sec.segments) {
      const len = g.type === 'straight' ? g.length : g.radius * g.angle;
      if (g.type === 'arc' && curveKmh(g.radius) < LINE_LIMIT) limits.push({ from: Math.round(s), to: Math.round(s + len) + TRAIN_LEN, kmh: Math.max(45, curveKmh(g.radius)), label: '曲線制限' });
      s += len;
    }
  }
  limits.push(...(extra.limits ?? []));
  const signals: { id: string; s: number }[] = [];
  for (let i = 0; i < stations.length; i++) {
    const sta = stations[i], z = loopZone(sta), iz = islandZone(sta);
    if (i > 0) signals.push({ id: `entry-${i}`, s: iz ? iz.inFrom - 60 : z ? z.inFrom - 60 : sta.platform.from - 150 });
    if (i < LAST) signals.push({ id: `departure-${i}`, s: sta.stopS + 65 });
    const next = stations[i + 1];
    if (next) {
      const from = z ? z.outTo + 60 : sta.platform.to + 160, nz = loopZone(next), niz = islandZone(next);
      const to = niz ? niz.inFrom - 200 : nz ? nz.inFrom - 100 : next.platform.from - 200;
      const n = Math.floor((to - from) / 600);
      for (let k = 1; k <= n; k++) signals.push({ id: `block-${i}-${k}`, s: Math.round(from + (to - from) * k / (n + 1)) });
    }
  }
  signals.sort((a, b) => a.s - b.s);
  const end = stations[LAST].stopS + sec.tail - 20;
  const route: Route = {
    id, lineId: 'hankyu-kobe', theme: 'coast', name,
    lineLimit: LINE_LIMIT, startS: sec.pre, startClock: 10 * 3600, trainLength: TRAIN_LEN,
    // 地面が線路の高さに沿う（西へ行くほど標高が上がる）。高架橋の所だけ地面を viaductHeight 下げる
    segments: sec.segments, elevation0: 0, groundFollowsTrack: true,
    gradients: sec.gradients, limits: limits.sort((a, b) => a.from - b.from), stations,
    services: [
      { id: 'local', name: '普通', cars: 8, units: [8], kind: 'hankyu-2000', lineLimit: LINE_LIMIT, stops: stations.map((_, i) => i), timetable: tt, destination: list[LAST][0], destinationKana: list[LAST][1] },
    ],
    prevName: '', nextName: '', signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
    extent: { from: -400, to: end }, tracks: [0, 4],
    // 建物は後日（ユーザー指示 2026-10-13: 当面は線路・高架・川だけ）。手続き生成の街並みも置かない
    scenery: { cityZones: [] }, noInfill: [{ from: -1000, to: end + 1000 }],
    oncoming: [], signals, crossings: [],
    structures, relief: sec.relief, viaductHeight: 8, extraTracks: extra.extraTracks,
    terminalApproach: false,
  };
  return route;
}

// 大阪梅田〜淀川橋梁は高架（中津も高架駅）。OSM は駅ビルの下が tunnel、中津の前後が途切れているので、梅田の駅ビルから淀川橋梁の手前までを高架橋で埋める
const yodogawa = HK_EAST.structures.find(x => x.kind === 'bridge' && HK_EAST.rivers.some(r => r.name === '淀川' && r.s >= x.from && r.s <= x.to))!;
// 梅田〜十三の3複線: 神戸線の右（東側）に宝塚線、その右に京都線（配線略図 011_01、Wikipedia「中津駅 (阪急)」）。描画だけの線路。
// 横位置はゲーム用の仮値（中津・十三の島式ホームが収まる間隔）。十三の先で宝塚線・京都線は右へ分かれる（実際の分かれ方は概形）
const juso = HK_EAST.pre + HK_EAST.distances['十三'];
const parallel = (id: string, lat: number, away: number, outFrom: number): ExtraTrack => ({
  id, from: 0, to: outFrom + 500, bumpers: [0],
  lat: [[0, lat], [juso - 250, lat], [juso - 120, lat + 3], [juso + 80, lat + 3], [outFrom, lat + 3], [outFrom + 500, lat + away]],
});
const HANSHIN_LINES: ExtraTrack[] = [
  parallel('takarazuka-down', 11, 60, juso + 250), parallel('takarazuka-up', 15, 60, juso + 250),
  parallel('kyoto-down', 19.5, 110, juso + 150), parallel('kyoto-up', 23.5, 110, juso + 150),
];
export const hankyuKobeEast = build('hankyu-kobe-east', '阪急神戸線 大阪梅田 → 西宮北口', HK_EAST, EAST, true, { viaducts: [[-300, Math.round(yodogawa.from) + 5]], extraTracks: HANSHIN_LINES });
const upTT = (r: Route) => ({ local: roughTimetable(r.stations.map(st => -st.stopS).reverse()) });
export const hankyuKobeEastUp = reverseRoute(hankyuKobeEast, { id: 'hankyu-kobe-east-up', name: '阪急神戸線 西宮北口 → 大阪梅田', timetable: upTT(hankyuKobeEast), signs: approachSigns });
// 御影の東の S字は 90km/h 制限（Wikipedia）。位置は不明のため、岡本〜御影の住吉川の前後に仮置き
const mikage = HK_WEST.pre + HK_WEST.distances['御影'];
// 王子公園の先〜神戸三宮で左（南側）に JR 神戸線（東海道線）の複々線が並ぶ。描画だけの線路（JR の列車は走らせない。ユーザー指示）。
// 横位置は OSM の JR の線路の点の平均（HK_WEST.jr）を 5点でならし、阪急の線路・島式ホームにかからないよう中心を -15m より外にする
const jrTracks: ExtraTrack[] = (() => {
  const raw = HK_WEST.jr, pts: [number, number][] = raw.map(([q], i) => {
    const w = raw.slice(Math.max(0, i - 2), i + 3).map(x => x[1]).sort((a, b) => a - b);
    return [q, Math.min(-15, w[Math.floor(w.length / 2)])];
  });
  const end = HK_WEST.pre + HK_WEST.distances['神戸三宮'] + HK_WEST.tail;
  pts.push([end, pts[pts.length - 1][1]]);
  return [-6, -2, 2, 6].map((d, k) => ({ id: `jr-${k}`, from: pts[0][0], to: end, lat: pts.map(([q, l]) => [q, Math.round((l + d) * 10) / 10] as [number, number]) }));
})();
export const hankyuKobeWest = build('hankyu-kobe-west', '阪急神戸線 西宮北口 → 神戸三宮', HK_WEST, WEST, false, { limits: [{ from: mikage - 1300, to: mikage - 500 + TRAIN_LEN, kmh: 90, label: 'S字 90km/h（位置は仮）' }], extraTracks: jrTracks });
export const hankyuKobeWestUp = reverseRoute(hankyuKobeWest, { id: 'hankyu-kobe-west-up', name: '阪急神戸線 神戸三宮 → 西宮北口', timetable: upTT(hankyuKobeWest), signs: approachSigns });
// 大阪梅田は頭端式。上り（梅田行）の終点は車止めの手前で止まる
hankyuKobeEastUp.terminalApproach = true;
for (const r of [hankyuKobeEastUp, hankyuKobeWestUp]) {
  const svc = r.services![0], first = r.stations[r.stations.length - 1];
  svc.destination = first.name; svc.destinationKana = first.kana;
}
