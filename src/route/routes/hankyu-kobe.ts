// 阪急神戸線（大阪梅田〜神戸三宮 32.3km）を西宮北口で分けた2コース。
//   コース1 hankyu-kobe-east: 大阪梅田 → 西宮北口（8駅・15.6km）
//   コース2 hankyu-kobe-west: 西宮北口 → 神戸三宮（9駅・16.7km）
// 営業キロは Wikipedia「阪急神戸本線」。線形・勾配・橋・高架は hankyu-kobe-geometry.ts（OSM と国土地理院の標高から作った下書き。実測ではない）。
// 駅の高架・地上の別とホームの形式は Wikipedia の各駅の記事「駅構造」（2026-10-13 閲覧）。配線略図との照合と、頭端式・2面3線・3面4線などの細部は未実施（概形で近似）。
// 種別と停車駅（Wikipedia「阪急神戸本線」運行形態、2025年2月22日改正の報道。2026-10-13 閲覧）:
//   普通 = 全駅。特急 = 大阪梅田・十三・西宮北口・夙川・岡本・神戸三宮（終日）。通勤特急（平日朝）= 特急 + 塚口。準特急（平日夕・夜）= 特急 + 塚口・六甲。
//   急行・快速・準急は、停車駅の一覧が確かめられないので入れない。行先は下り 新開地（神戸高速線へ直通）、上り 大阪梅田。
//   選べる種別は、そのコースで停車駅が普通と違うものだけ（梅田〜西宮北口は 普通・特急・通勤特急、西宮北口〜三宮は 普通・特急・準特急）。
// 時刻表は自動運転の最速走行 +5%（npm run timetable:hankyu。scripts/timetable-hankyu.ts）。停車 25 秒はゲーム用。
import type { ExtraTrack, Route, Sign, SpeedLimit, Station, StationIsland, StationLoop, StationStructure } from '../types';
import { reverseRoute } from '../reverse';
import { islandZone, loopZone } from '../service';
import { HK_EAST, HK_WEST, type HankyuSection } from './hankyu-kobe-geometry';
import { HKT } from './hankyu-kobe-timetable';
import type { ServiceId, ServiceSpec } from '../types';

/** 駅の仮の形。island = 島式1面2線、relative = 相対式2面2線、loop = 島式2面4線（待避線つき） */
type Kind = 'island' | 'relative' | 'loop' | 'loop-outside';
/** 島式: 線路が左右へ 3.2m ずつ開く。S字は 120m（60m では線路と架線がくねって見えた。ユーザー指摘 2026-10-13） */
const ISLAND: StationIsland = { spread: 3.2, length: 120 };
/** 中津の神戸線の島式ホームは非常に狭い（ユーザー指摘「くっそ細い」）。幅 2.6m（4 + 2×1.0 − 3.4）。実際の幅は不明でゲーム用の値 */
const NARROW: StationIsland = { spread: 1.0, length: 120 };
/** 待避線つき島式2面4線: 待避線は本線から 9.2m（島式ホームが間に入る。南海版と同じ）。六甲（相対式・中央が通過線）は待避線を本線の隣 4m に置き、ホームは待避線の外側 */
const LOOP: StationLoop = { lat: -9.2, turnoutLength: 60, turnoutLimitKmh: 45 };
/** 六甲: ホームのある待避線は本線の外 4m。部品の loop（outside）ではホームが本線にかかったので、自線・対向線を駅の前後で外へ寄せ（trackProfiles）、中央の通過線2本を extraTracks で描く */
const ROKKO_OUT = 4;
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

/** 地上駅の駅舎・改札の位置とホーム間の連絡（Wikipedia 各駅「駅構造」、2026-10-13 閲覧）。end の namba = 大阪梅田寄り、wakayama = 神戸三宮寄り（下りの座標）。
 *  芦屋川（駅舎は芦屋川の西岸。どちらのホーム側か・連絡の方法は記載なし）と、橋上駅舎の西宮北口・六甲、高架駅は標準の形のまま */
const STRUCT: Record<string, StationStructure> = {
  神崎川: { building: 'down', end: 'wakayama', link: 'underpass' }, // 改札は下層の梅田寄りと、三宮方面ホームの三宮寄り
  塚口: { building: 'both', end: 'wakayama', link: 'underpass' }, // 三宮寄りに北口・南口、地下道2か所
  武庫之荘: { building: 'both', end: 'wakayama', link: 'footbridge' }, // 三宮寄り、南口（下り側）・北口（上り側）、地下道と跨線橋
  夙川: { building: 'both', end: 'namba', link: 'underpass' }, // 南北に改札、東寄り（梅田寄り）の地下道
  岡本: { building: 'both', end: 'namba', link: 'underpass' }, // 駅舎は三宮方面ホームの梅田寄り、梅田方面ホームにも改札、地下道
  御影: { building: 'both', end: 'namba', link: 'underpass' }, // 両ホームの梅田寄りに改札（下層のコンコース）、地下道
};

/** [id, 名前, 停車駅（null = 全駅）] */
type Svc = [ServiceId, string, string[] | null];
const TOKKYU = ['大阪梅田', '十三', '西宮北口', '夙川', '岡本', '神戸三宮'];
const SVC_EAST: Svc[] = [['local', '普通', null], ['limited', '特急', TOKKYU], ['express', '通勤特急', [...TOKKYU, '塚口']]];
const SVC_WEST: Svc[] = [['local', '普通', null], ['limited', '特急', TOKKYU], ['express', '準特急', [...TOKKYU, '塚口', '六甲']]];

function build(id: string, name: string, sec: HankyuSection, list: Sta[], svcs: Svc[], headStart: boolean, extra: { viaducts?: [number, number][]; limits?: SpeedLimit[]; extraTracks?: ExtraTrack[] } = {}): Route {
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
      ...(kind === 'island' ? { island: { ...(nm === '中津' ? NARROW : ISLAND) } } : kind === 'loop' ? { loop: { ...LOOP } } : kind === 'loop-outside' ? { layout: 'custom' as const, customPlatforms: [{ kind: 'side' as const, lat: -ROKKO_OUT, side: 'L' as const }, { kind: 'side' as const, lat: 4 + ROKKO_OUT, side: 'R' as const }] } : { layout: 'relative' as const }),
      ...(i === 0 && headStart ? { headEnd: true } : {}),
      ...(STRUCT[nm] ? { structure: { ...STRUCT[nm] } } : {}),
      // 六甲: 待避線（本線の隣 4m）が分かれ切ってからホームが始まるよう、梅田寄りの端を 20m 縮める（8両 152m は収まる）
      ...(kind === 'loop-outside' ? { platform: { from: stopS - 155, to: stopS + 15, side: 'L' as const } } : {}),
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
      ...svcs.map(([sid, nm, stopNames]): ServiceSpec => ({ id: sid, name: nm, cars: 8, units: [8], kind: 'hankyu-2000', lineLimit: LINE_LIMIT,
        stops: stations.map((_, i) => i).filter(i => !stopNames || stopNames.includes(stations[i].name)), timetable: HKT[id]?.[sid] ?? tt,
        destination: '新開地', destinationKana: 'しんかいち' })),
    ],
    // 先行の普通: 途中に待避が無い（特急は普通を西宮北口で追い越す）ので、優等列車が追いつかない間隔で先に出す（日中は10分間隔。ゲーム用）
    precedingHeadway: { limited: 600, express: 600 },
    prevName: '', nextName: '', signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
    extent: { from: -400, to: end }, tracks: [0, 4],
    // 沿線は全線が市街地（大阪・尼崎・西宮・芦屋・神戸）。OSM の建物のある所はそれを置き、無い所は手続き生成の市街地で埋める
    scenery: { cityZones: [{ from: -1000, to: end + 1000 }] },
    oncoming: [], signals, crossings: [],
    structures, relief: sec.relief, viaductHeight: 8, extraTracks: extra.extraTracks,
    terminalApproach: false,
  };
  return route;
}

// 大阪梅田〜淀川橋梁は高架（中津も高架駅）。OSM は駅ビルの下が tunnel、中津の前後が途切れているので、梅田の駅ビルから淀川橋梁の手前までを高架橋で埋める
const yodogawa = HK_EAST.structures.find(x => x.kind === 'bridge' && HK_EAST.rivers.some(r => r.name === '淀川' && r.s >= x.from && r.s <= x.to))!;
// ---- 大阪梅田（頭端式10面9線）: 配線略図 011_01。西（下り本線の左）から神戸線3線・宝塚線3線・京都線3線が 9.4m ごとに並び、線路の間と両外側にホーム（10面）。
// 神戸線: A（下り本線。横位置 -3.2）・B（上り本線 7.2）・C（16.6）。駅の先で B と C が合流し、A・B は 0・4 へ寄る。
// 宝塚線（26・35.4・44.8）・京都線（54.2・63.6・73）は駅の先でそれぞれ2線になり、十三まで神戸線の右に並ぶ（描画だけ）。
// 線路の間隔・ホームの幅（6m。A と B の間は 7m）・合流の位置はゲーム用の概形。号線の対応（神戸線は7〜9号線）は表示していない
const UMEDA = { A: -3.2, B: 7.2, C: 16.6, pitch: 9.4 } as const;
const umedaStop = HK_EAST.pre + HK_EAST.distances['大阪梅田'];
const U_OUT = umedaStop + 40, U_IN = umedaStop + 420; // 寄せ始め・寄せ終わり
const juso = HK_EAST.pre + HK_EAST.distances['十三'];
// 中津・十三では宝塚線・京都線のホームが入るよう線路を開く（配線略図 011_01）:
//   中津: 神戸線・宝塚線とも狭い島式（宝塚線は下り 10.5・上り 16.5。ホームは world/hankyu-branches.ts が描く）、京都線は通過（19.5・23.5）
//   十三（4面6線）: 神戸線の下りは外側の単式、神戸線の上りと宝塚線の下り（14.4）が島式を共用、宝塚線の上り（18.4）と京都線の下り（28.8）が島式を共用、京都線の上り（32.8）は外側の単式
const nakatsu = HK_EAST.pre + HK_EAST.distances['中津'];
const NK = { tD: 10.5, tU: 16.5, kD: 21, kU: 25 }, JS = { tD: 14.4, tU: 18.4, kD: 28.8, kU: 32.8 };
/** 宝塚線・京都線の本線（梅田 lat0 → 中津 nk → 十三 js → 十三の先で右へ away 離れる） */
const parallel = (id: string, lat0: number, nk: number, js: number, away: number, outFrom: number): ExtraTrack => ({
  id, from: 0, to: outFrom + 500, bumpers: [0],
  lat: [[0, lat0], [U_OUT, lat0], [nakatsu - 300, nk], [nakatsu + 120, nk], [juso - 300, js], [outFrom, js], [outFrom + 500, js + away]],
});
/** 梅田の3線目（駅の先で隣の線へ合流する短い線） */
const merge = (id: string, lat0: number, into: number, end: number): ExtraTrack => ({ id, from: 0, to: end, bumpers: [0], lat: [[0, lat0], [U_OUT, lat0], [end, into]] });
const L = (k: number) => UMEDA.C + UMEDA.pitch * k; // 宝塚線・京都線の線路（k = 1〜6）
const HANSHIN_LINES: ExtraTrack[] = [
  merge('kobe-c', UMEDA.C, 4, U_IN),
  parallel('takarazuka-down', L(1), NK.tD, JS.tD, 60, juso + 250), parallel('takarazuka-up', L(2), NK.tU, JS.tU, 60, juso + 250), merge('takarazuka-3', L(3), NK.tU, nakatsu - 300),
  parallel('kyoto-down', L(4), NK.kD, JS.kD, 110, juso + 150), parallel('kyoto-up', L(5), NK.kU, JS.kU, 110, juso + 150), merge('kyoto-3', L(6), NK.kU, nakatsu - 300),
];
/** 十三のホーム（神戸線の下りの外側の単式・2つの島式・京都線の上りの外側の単式） */
const JUSO_PLATFORMS: NonNullable<Station['customPlatforms']> = [
  { kind: 'side', lat: 0, side: 'L', width: 5 },
  { kind: 'island', lat: (4 + JS.tD) / 2, width: JS.tD - 4 - 3.4, roof: 1 },
  { kind: 'island', lat: (JS.tU + JS.kD) / 2, width: JS.kD - JS.tU - 3.4, roof: 1 },
  { kind: 'side', lat: JS.kU, side: 'R', width: 5 },
];
const UMEDA_PLATFORMS: NonNullable<Station['customPlatforms']> = [
  { kind: 'island', lat: UMEDA.A - 4.7, width: 6, from: 0, roof: 1 },
  { kind: 'island', lat: (UMEDA.A + UMEDA.B) / 2, width: 7, from: 0, roof: 1 },
  ...Array.from({ length: 8 }, (_, k) => ({ kind: 'island' as const, lat: UMEDA.B + UMEDA.pitch / 2 + UMEDA.pitch * k, width: 6, from: 0, roof: 1 })),
];

// ---- 塚口: 下りは単式、上りは伊丹線（3号線）と共用の島式。伊丹線は駅の先で右（北）へ分かれる。梅田寄りに伊丹線の行き止まりの線（配線略図 010_02）
const tsuka = HK_EAST.pre + HK_EAST.distances['塚口'];
const ITAMI = 13.4;
const ITAMI_TRACK: ExtraTrack = { id: 'itami', from: tsuka - 230, to: tsuka + 420, bumpers: [tsuka - 230], lat: [[tsuka - 230, ITAMI], [tsuka + 30, ITAMI], [tsuka + 140, ITAMI + 8], [tsuka + 420, ITAMI + 90]] };

// ---- 西宮車庫: 西宮北口の梅田寄りの右（北東）に留置線が並ぶ（配線略図 010_03、OSM の道路「車庫北線」の位置）。本数・長さは概形（12本・約600m）
const depotTracks = (c: number, from: number): ExtraTrack[] => Array.from({ length: 12 }, (_, k): ExtraTrack => {
  const a = Math.max(from, c - 950 + k * 12), lat = 24 + k * 4.6;
  return { id: `nishinomiya-depot-${k}`, from: a, to: c - 250, bumpers: [a], noWire: true, /* 架線柱が隣の留置線にかかるので架線は省く */ lat: [[a, lat], [c - 340 - k * 6, lat], [c - 250, 14]] };
});
const nishiE = HK_EAST.pre + HK_EAST.distances['西宮北口'];
/** 直角の支線（world/hankyu-branches.ts）の敷地。西宮北口の今津線（北・南）。c = 停止位置。ホームの中心は停止位置の約80m手前 */
const branchReserved = (c: number): NonNullable<Route['reserved']> => [
  { from: c - 110, to: c - 50, lat0: 16, lat1: 430 }, { from: c - 100, to: c - 60, lat0: -430, lat1: -14 },
];
export const hankyuKobeEast = build('hankyu-kobe-east', '阪急神戸線 大阪梅田 → 西宮北口', HK_EAST, EAST, SVC_EAST, true, {
  viaducts: [[-300, Math.round(yodogawa.from) + 5]], extraTracks: [...HANSHIN_LINES, ITAMI_TRACK, ...depotTracks(nishiE, 0)],
});
{
  const r = hankyuKobeEast, umeda = r.stations[0], ts = r.stations.find(x => x.name === '塚口')!;
  // 梅田はターミナルビルの中の屋内のホーム（ユーザー指摘）。9線10面を1つの大屋根で覆う
  Object.assign(umeda, { layout: 'custom', customPlatforms: UMEDA_PLATFORMS, island: undefined, indoor: true, indoorSpan: [UMEDA.A - 8.5, L(6) + 8.5] });
  Object.assign(r.stations.find(x => x.name === '十三')!, { layout: 'custom', customPlatforms: JUSO_PLATFORMS });
  r.trackProfiles = { 0: [[0, UMEDA.A], [U_OUT, UMEDA.A], [U_IN, 0]], 4: [[0, UMEDA.B], [U_OUT, UMEDA.B], [U_IN, 4]] };
  Object.assign(ts, { layout: 'custom', customPlatforms: [{ kind: 'side', lat: 0, side: 'L' }, { kind: 'island', lat: (4 + ITAMI) / 2, width: ITAMI - 4 - 3.4 }] });
  // 梅田の駅（ターミナルビル）と車庫の敷地には建物を置かない
  r.reserved = [{ from: -300, to: umedaStop + 60, lat0: -15, lat1: 95 }, { from: nishiE - 960, to: nishiE - 240, lat0: 18, lat1: 85 }, ...branchReserved(nishiE)];
}
const upTT = (r: Route) => Object.fromEntries((r.services ?? []).map(v => [v.id, HKT[`${r.id}-up`]?.[v.id] ?? roughTimetable(r.stations.map(st => -st.stopS).reverse())]));
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
  return [-6, -2, 2, 6].map((d, k) => ({ id: `jr-${k}`, from: pts[0][0], to: end, noWire: true, /* 架線柱が隣の JR の線路にかかるので架線は省く（描画だけの線） */ lat: pts.map(([q, l]) => [q, Math.round((l + d) * 10) / 10] as [number, number]) }));
})();
export const hankyuKobeWest = build('hankyu-kobe-west', '阪急神戸線 西宮北口 → 神戸三宮', HK_WEST, WEST, SVC_WEST, false, { limits: [{ from: mikage - 1300, to: mikage - 500 + TRAIN_LEN, kmh: 90, label: 'S字 90km/h（位置は仮）' }], extraTracks: [...jrTracks, ...depotTracks(HK_WEST.pre + HK_WEST.distances['西宮北口'], 0)] });
{
  const rk = HK_WEST.pre + HK_WEST.distances['六甲'], a0 = rk - 330, a1 = rk - 215, b0 = rk + 50, b1 = rk + 165;
  hankyuKobeWest.trackProfiles = { 0: [[a0, 0], [a1, -ROKKO_OUT], [b0, -ROKKO_OUT], [b1, 0]], 4: [[a0, 4], [a1, 4 + ROKKO_OUT], [b0, 4 + ROKKO_OUT], [b1, 4]] };
  hankyuKobeWest.extraTracks!.push({ id: 'rokko-through-down', from: a0, to: b1, lat: [[a0, 0], [b1, 0]] }, { id: 'rokko-through-up', from: a0, to: b1, lat: [[a0, 4], [b1, 4]] });
}
{
  const r = hankyuKobeWest, c = HK_WEST.pre + HK_WEST.distances['西宮北口'], sh = HK_WEST.pre + HK_WEST.distances['夙川'];
  // JR の線路の帯（両側 4m）にも建物・木を置かない
  const jr = jrTracks[0].lat, jrBand = jr.slice(1).map(([q, l], i) => ({ from: jr[i][0], to: q, lat0: Math.min(l, jr[i][1]) - 4, lat1: Math.max(l, jr[i][1]) + 12 + 4 }));
  r.reserved = [{ from: 0, to: c - 240, lat0: 18, lat1: 85 }, ...branchReserved(c), { from: sh - 100, to: sh - 60, lat0: 10, lat1: 330 }, ...jrBand];
}
export const hankyuKobeWestUp = reverseRoute(hankyuKobeWest, { id: 'hankyu-kobe-west-up', name: '阪急神戸線 神戸三宮 → 西宮北口', timetable: upTT(hankyuKobeWest), signs: approachSigns });
// 大阪梅田は頭端式。上り（梅田行）の終点は車止めの手前で止まる
hankyuKobeEastUp.terminalApproach = true;
{ const u = hankyuKobeEastUp.stations.at(-1)!; u.indoorSpan = [4 - u.indoorSpan![1], 4 - u.indoorSpan![0]]; }
// 上りは s と左右が反転するので、駅舎のホーム（下り・上り）と位置（梅田寄り・三宮寄り）を入れ替える（reverseRoute は structure をそのまま写す）
const SWAP_B = { down: 'up', up: 'down', both: 'both' } as const, SWAP_E = { namba: 'wakayama', wakayama: 'namba', center: 'center', ends: 'ends' } as const;
for (const r of [hankyuKobeEastUp, hankyuKobeWestUp]) for (const st of r.stations) if (st.structure) {
  st.structure = { ...st.structure, building: SWAP_B[st.structure.building], ...(st.structure.end ? { end: SWAP_E[st.structure.end] } : {}) };
}
for (const r of [hankyuKobeEastUp, hankyuKobeWestUp]) for (const svc of r.services!) { svc.destination = '大阪梅田'; svc.destinationKana = 'おおさかうめだ'; }
