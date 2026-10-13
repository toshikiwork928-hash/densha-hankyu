// 羽衣駅の 2面3線（島式＋片面）と、3番線（高師浜線）の高架支線の平面形。描画専用で、走行経路は持たない。
// 配線略図.net 011_03 の羽衣: 本線2線のうち図の下側の線（ゲーム下りの自線）の外側に島式ホーム、その外側が3番線で、
// 3番線は島式ホームの泉大津側の端（約80m）で車止めに終わり、駅の先も本線と3線並行のまま高架を進み、のちに南西（ゲーム内は海側）へ分かれる。
// 位置は route.coastalLandmarks の { kind:'branch' }。s = ホームの泉大津側の端、direction = 支線の延びる向き（d = direction × (s − landmark.s)）、
// side = 3番線のある側。reverseRoute が s・side・direction を反転するので、上り・下りで同じ物理配置になる。
import type { Route } from '../route/types';

/** 島式ホームの線間（本線 〜 3番線）[m] */
export const T3_GAP = 9.2;
/** 3番線の車止め（ホーム内。d < 0 はホーム側）[m] */
export const BUMPER_D = -80;
/** 3線並行が終わり、3番線が本線から離れ始める距離 [m] */
export const DIVERGE_D = 300;
/** 離れる曲線の半径に相当する値 [m]（横ずれ = u² / 2R） */
const BRANCH_R = 420;
/** 島式ホーム側の床版外縁（本線中心から）[m] */
export const ISLAND_EDGE = 8.7;

export interface HagoromoSpec {
  s0: number; dir: 1 | -1; side: -1 | 1; length: number;
  /** 島式ホームに面する本線・もう一方の本線・3番線の横位置 */
  mainIsland: number; mainOuter: number; t3: number;
  /** 島式ホームの中心 */
  island: number;
  platform: { from: number; to: number };
  sOf(d: number): number;
  dOf(s: number): number;
  /** 3番線（支線）の横位置。DIVERGE_D より先は本線から離れていく */
  lat(d: number): number;
}

export function hagoromoSpec(route: Route): HagoromoSpec | null {
  const lm = route.coastalLandmarks?.find(l => l.kind === 'branch');
  const sta = route.stations.find(s => s.layout === 'hagoromo');
  if (!lm || !sta) return null;
  const side = lm.side ?? -1, dir = lm.direction ?? -1, lo = Math.min(...route.tracks), hi = Math.max(...route.tracks);
  const mainIsland = side < 0 ? lo : hi, mainOuter = side < 0 ? hi : lo, t3 = mainIsland + side * T3_GAP;
  return {
    s0: lm.s, dir, side, length: lm.length ?? 760, mainIsland, mainOuter, t3, island: (mainIsland + t3) / 2,
    platform: sta.platform,
    sOf: d => lm.s + dir * d,
    dOf: s => (s - lm.s) * dir,
    lat: d => t3 + (d > DIVERGE_D ? side * (d - DIVERGE_D) ** 2 / (2 * BRANCH_R) : 0),
  };
}

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** 支線が本線から離れる所で、本線の床版の縁が3番線の外側から本線側へ戻る区間（s の範囲）。ここの本線側の高欄は3番線を横切る壁になるので描かない（支線の高欄は coastal-landmarks.ts の branch が PARAPET から描く） */
export function hagoromoParapetGap(route: Route): { side: -1 | 1; from: number; to: number } | null {
  const h = hagoromoSpec(route);
  if (!h) return null;
  const a = h.sOf(DIVERGE_D + 55), b = h.sOf(DIVERGE_D + 85);
  return { side: h.side, from: Math.min(a, b), to: Math.max(a, b) };
}

/** 島式ホーム側の床版外縁の横位置（本線高架の床版を広げる量）。広げる必要がなければ null */
export function hagoromoDeckEdge(route: Route, s: number): { side: -1 | 1; lat: number } | null {
  const h = hagoromoSpec(route);
  if (!h) return null;
  let e = 0;
  const { from, to } = h.platform;
  const u = Math.max(0, Math.min(1, (s - from + 25) / 25, (to + 25 - s) / 25));
  e = Math.max(e, 3.3 + (ISLAND_EDGE - 3.3) * smooth(u));
  // 3番線が並行する区間（ホーム側から車止めの先 12m まで、泉大津側は離れ始めてから 60m 先まで）は 3番線の外まで。
  const d = h.dOf(s), full = T3_GAP + 3.3;
  if (d >= BUMPER_D - 12 && d <= DIVERGE_D + 80) {
    const head = smooth(1 - (BUMPER_D - d) / 12);
    const tail = d <= DIVERGE_D + 60 ? 1 : smooth(1 - (d - DIVERGE_D - 60) / 20);
    const reach = d > DIVERGE_D ? h.lat(d) - h.mainIsland : 0;
    e = Math.max(e, 3.3 + (Math.max(T3_GAP, Math.abs(reach)) ) * Math.min(head, tail));
    e = Math.max(e, Math.min(full, e));
  }
  return e > 3.3 ? { side: h.side, lat: h.mainIsland + h.side * e } : null;
}
