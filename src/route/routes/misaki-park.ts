// 南海本線 みさき公園駅の共通の定義（泉佐野〜みさき公園の終着駅と、みさき公園〜和歌山港の始発駅が同じ駅の形を使う）。
// 資料: docs/south-scenery-research-1.md 4章（Wikipedia「みさき公園駅」「南海多奈川線」、配線略図.net 010_01、OSM）。
//   盛土上の島式2面5線。1・2番線が下り（和歌山市方面）、3番線が上り（難波方面）、4番線は未使用（3番線の和歌山市寄りを切り欠いた線）、
//   5番線が多奈川線。島式ホームは2面で、東（山）側に1・2番線のホーム、西（海）側に3・5番線のホーム。
//   多奈川線は駅の南西約250mで本線の右（西・海側）に並んで出てから、西へ大きく離れる。単線で、終点の多奈川（営業キロ 2.6km）に車止め。
// ゲームでの表し方（横位置はすべて下りの座標。左が負、route.tracks = [0, 4] は T2・T3）:
//   T1 = 1番線（-9.2、extraTracks）  T2 = 2番線＝下り本線（0）  T3 = 3番線＝上り本線（4）  T5 = 5番線＝多奈川線（13.2、extraTracks）
//   島式A（-4.6、幅5.8）= T1とT2の間  島式B（8.6、幅5.8）= T3とT5の間。線路中心からホーム端 1.7m。
//   4番線は未使用なので描かない。多奈川線は分岐から数百m先の車止めまで描く（多奈川までは描かない）。
// 線間 9.2m、ホーム幅 5.8m、ホームの長さ、分岐の位置と曲線、車止めの位置は資料に無く、ゲーム用の概形。盛土の高さも不明（泉佐野〜みさき公園は勾配の積分で約16m、みさき公園〜和歌山港は地面が線路に沿うので0）。
import type { ExtraTrack, LatProfile, Route, Station } from '../types';

/** 下りの座標での線路・ホームの横位置 [m] */
export const MISAKI = { T1: -9.2, T2: 0, T3: 4, T5: 13.2, islandA: -4.6, islandB: 8.6, width: 5.8 } as const;

/** 停止位置から多奈川線の車止めまでの距離 [m]。多奈川線の終点は多奈川（営業キロ 2.6km）だが、分岐から数百m先で打ち切る（ゲーム用） */
export const TANAGAWA_END = 800;
/** コースの終端（extent.to）を停止位置から何 m 先まで伸ばすか。多奈川線の車止めの先 40m */
export const MISAKI_RUNOUT = TANAGAWA_END + 40;

/** 島式ホーム2面（custom 駅のホーム）。階段口は専用モジュール（world/misaki-park.ts）が描く */
export const MISAKI_PLATFORMS: NonNullable<Station['customPlatforms']> = [
  { kind: 'island', lat: MISAKI.islandA, width: MISAKI.width, roof: .8, stairs: false },
  { kind: 'island', lat: MISAKI.islandB, width: MISAKI.width, roof: .8, stairs: false },
];

/** 駅の定義（共有）。stopS・platform・時刻は呼び出し側のまま */
export const misakiParkStation = (): Partial<Station> => ({ layout: 'custom', customPlatforms: MISAKI_PLATFORMS.map(p => ({ ...p })), mainTrack: '2番線', elevated: false });

/** 本線から分かれる・本線へ戻る S字を始端で切り捨てる（コースの端に近く、本線に重なったまま始まるのを避ける） */
function clipSwitch(pts: [number, number][], from: number): [number, number][] {
  return pts[0][0] < from + 120 ? [[from, pts[1][1]], ...pts.slice(2)] : pts;
}

/** 多奈川線の分岐曲線（停止位置からの距離 d、本線の右へ離れる量）。d0 から長さ L の余弦のS字で幅 W だけ離れる。ゲーム用の概形 */
const DIVERGE = { d0: 300, L: 700, W: 150, gap: 4 };

/** 下りの座標での、みさき公園の線路の追加分（停止位置 stopS を基準に、コースの端 from で切る） */
export function misakiExtraTracks(stopS: number, from: number): ExtraTrack[] {
  const r = (d: number) => stopS + d;
  const t1 = clipSwitch([[r(-640), MISAKI.T2], [r(-380), MISAKI.T1], [r(110), MISAKI.T1], [r(330), MISAKI.T2]], from);
  // 5番線: 北東（難波方）で上り本線(T3)から分かれてホームに入り、ホームの先で本線の右 4m に並び、そこから西（右）へ離れる多奈川線になる
  const t5 = clipSwitch([[r(-560), MISAKI.T3], [r(-300), MISAKI.T5], [r(60), MISAKI.T5], [r(220), MISAKI.T3 + DIVERGE.gap], [r(DIVERGE.d0), MISAKI.T3 + DIVERGE.gap],
    [r(DIVERGE.d0 + DIVERGE.L), MISAKI.T3 + DIVERGE.gap + DIVERGE.W]], from);
  // 多奈川線は車止め（停止位置から TANAGAWA_END）で打ち切る。曲線は S字の途中（終点まで続く向き）
  const end = TANAGAWA_END;
  return [
    { id: 'misaki-t1', lat: t1, from: t1[0][0], to: r(330), ownDeck: false, bank: true },
    { id: 'misaki-t5', lat: t5, from: t5[0][0], to: r(end), bumpers: [r(end)], ownDeck: false, bank: true },
    // 分岐の渡り線（上り本線 → 5番線・多奈川線）。ホームの先 230〜310m
    { id: 'misaki-cross', lat: [[r(230), MISAKI.T3], [r(310), MISAKI.T3 + DIVERGE.gap]], from: r(230), to: r(310), ownDeck: false, bank: true },
    // 保守用の留置線（和歌山市寄り、下り本線の左）。運転席からの画像で、黄色い保守用車両と資材置き場が線路の脇に並ぶ（位置・本数・長さは不明。ゲーム用の概形）
    ...misakiYardTracks(stopS, from),
  ];
}

/** 保守用の留置線2本（下り本線 T2 から左へ分かれる）。架線は張らない */
export const YARD_LAT = { a: -19, b: -25 } as const;
function misakiYardTracks(stopS: number, from: number): ExtraTrack[] {
  const r = (d: number) => stopS + d;
  const a: [number, number][] = [[r(340), MISAKI.T2], [r(430), YARD_LAT.a], [r(720), YARD_LAT.a]];
  const b: [number, number][] = [[r(430), YARD_LAT.a], [r(500), YARD_LAT.b], [r(690), YARD_LAT.b]];
  void from;
  return [
    { id: 'misaki-yard-1', lat: a, from: r(340), to: r(720), bumpers: [r(720)], ownDeck: false, bank: true, noWire: true },
    { id: 'misaki-yard-2', lat: b, from: r(430), to: r(690), bumpers: [r(690)], ownDeck: false, bank: true, noWire: true },
  ];
}

/** 多奈川線の横位置（停止位置からの距離 d）。T5 の折れ線を引く側と同じ式（world 側の確認用） */
export const tanagawaLat = (d: number): number => {
  if (d <= DIVERGE.d0) return MISAKI.T3 + DIVERGE.gap;
  const u = Math.min(1, (d - DIVERGE.d0) / DIVERGE.L);
  return MISAKI.T3 + DIVERGE.gap + DIVERGE.W * (1 - Math.cos(Math.PI * u)) / 2;
};

/** 景観（OSM の建物・木）を置かない範囲: 駅と盛土、多奈川線の盛土の帯 */
export function misakiReserved(stopS: number): NonNullable<Route['reserved']> {
  const out: NonNullable<Route['reserved']> = [{ from: stopS - 300, to: stopS + 300, lat0: -62, lat1: 62 }];
  out.push({ from: stopS + 300, to: stopS + 760, lat0: -52, lat1: -10 }); // 保守用の留置線と資材置き場
  for (let d = 300; d < TANAGAWA_END + 40; d += 80) {
    const a = tanagawaLat(d), b = tanagawaLat(d + 80);
    out.push({ from: stopS + d, to: stopS + d + 80, lat0: Math.min(a, b) - 50, lat1: Math.max(a, b) + 50 });
  }
  return out;
}

/** 下りの普通の走行線（1番線 T1 へ入る・本線へ戻る）。サザンは下り本線(T2)のまま */
export function misakiLane(stopS: number, from: number): LatProfile {
  return clipSwitch([[stopS - 640, MISAKI.T2], [stopS - 380, MISAKI.T1], [stopS + 110, MISAKI.T1], [stopS + 330, MISAKI.T2]], from);
}

/** 下りのコースにみさき公園の定義を足す（stationIndex = みさき公園の駅 index）。arrival = みさき公園が終着駅。
 *  駅の形・追加の線路・景観の除外範囲・コース終端・種別ごとの走行線と番線を設定する。reverseRoute の前に呼ぶ */
export function addMisakiPark(route: Route, stationIndex: number, arrival: boolean): void {
  const sta = route.stations[stationIndex], stopS = sta.stopS, from = route.extent.from;
  Object.assign(sta, misakiParkStation());
  delete sta.loop; delete sta.loopTrack; delete sta.loopPriority;
  route.extraTracks = [...(route.extraTracks ?? []), ...misakiExtraTracks(stopS, from)];
  route.reserved = [...(route.reserved ?? []), ...misakiReserved(stopS)];
  route.extent = { from, to: Math.max(route.extent.to, stopS + MISAKI_RUNOUT) };
  for (const v of route.services ?? []) {
    const local = v.id === 'local', mine = misakiLane(stopS, from);
    // 1番線（T1、島式Aの右、ドア右）は普通、2番線（T2、島式Aの左、ドア左）は特急サザン。ゲーム用の割り当て（docs/spec-south-courses.md）
    // 走行線は s の昇順でなければならない（profileLat）。コースの始端（みさき公園が始発）では、1番線へ入る点（s 0〜）が既存の点より前に来る
    v.lane = local ? [...(v.lane ?? []), ...mine].sort((p, q) => p[0] - q[0]) : v.lane;
    v.trackNames = { ...v.trackNames, [stationIndex]: local ? '1番線' : '2番線' };
    v.platformSides = { ...v.platformSides, [stationIndex]: local ? 'R' : 'L' };
    // 分岐器の制限（泉佐野と同じ 45km/h）。到着は T1 へ入る分岐器、出発は T1 から本線へ戻る分岐器
    if (local) v.laneLimits = [...(v.laneLimits ?? []), arrival
      ? { from: stopS - 640, to: stopS - 360, kmh: 45, label: 'みさき公園分岐器' }
      : { from: stopS + 100, to: stopS + 340, kmh: 45, label: 'みさき公園分岐器' }];
  }
}

/** 上りのコース（reverseRoute 済み）のみさき公園の番線: 上り本線(T3)の3番線（島式Bの側）。普通・サザンとも。stationIndex = 上りのコースでのみさき公園の index */
export function setMisakiParkUp(route: Route, stationIndex: number): void {
  for (const v of route.services ?? []) {
    v.trackNames = { ...v.trackNames, [stationIndex]: '3番線' };
    v.platformSides = { ...v.platformSides, [stationIndex]: 'L' };
  }
}
