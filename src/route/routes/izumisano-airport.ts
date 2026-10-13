// 泉佐野の南の南海空港線の分岐と、その上を通る JR 関西空港線の概形（泉佐野〜みさき公園コース、下りの座標）。描画専用で、走行経路は持たない。
// 出典: docs/south-scenery-research-1.md の 1章（Wikipedia と OSM の座標から手計算）。
//   分岐は泉佐野駅の約260m南西。本線は左へカーブし、空港線は右（西・北西）へ分かれる。空港線の下り線は本線の高架を乗り越える高々架。
//   JR 関西空港線は駅の約1.1km南西で南海本線の真上をほぼ直角にまたぐ（JR が上）。
// 橋の長さ・高さ・橋脚の形、空港線の2段の高さは資料に無い（不明）。ここの寸法はすべてゲーム用の概形で、実測値ではない。
// 位置は本線の (s, 横位置) と、レール面の本線レール面からの高さ h で表す。点列は本線の線形（Track）から数値で求める。
import type { Track } from '../track';

/** 空港線の外側下り線(T1)・外側上り線(T4)から分かれる所（本線の s）。泉佐野のホーム端(s 220)の約 80m 先から外へ振れ始める */
export const AIR_S0 = 300;
/** 本線の床版の延長で描く追加の線路（route.extraTracks）の終点。ここから先は world/izumisano-airport.ts が描く */
export const AIR_S1 = 470;
/** 描く終わり（本線の s）。分岐から約750m。その先は描かない（ゲームの視界の外） */
export const AIR_END = 1050;
/** 空港線の下り線(AD)は外側下り線の外（左）、上り線(AU)は外側上り線の外（右）へ 6m 振れて平行になる */
export const AD_LAT = -15.2, AU_LAT = 24.4;
/** 下り線が本線の上を越える高さ（本線レール面から）[m]。架線柱とビームの上に桁が来る高さ。資料に無く、ゲーム用 */
export const AD_RISE = 12;
/** 上り線の勾配なし。下り線の上り勾配 [‰]（高さ 0 → AD_RISE）。ゲーム用の概形 */
const AD_GRADE = .035;

/** JR 関西空港線が本線をまたぐ位置（本線の s）。泉佐野駅の中心（s 110）から約1.1km（OSM）の 1190。メートル単位の位置は不明 */
export const JR_S = 1190;
/** JR の橋: 平らな区間の半幅、レール面の高さ（本線のレール面から）、地面へ下りる勾配、橋の半幅。桁の下面は本線のレール面から約 9.2m（本線の架線より上）。
 *  橋の長さ・高さは資料に無く不明。ゲーム用の概形で、実測値ではない */
export const JR_FLAT = 130, JR_RISE = 12, JR_GRADE = .035, JR_HALF_WIDTH = 5;

export interface AirPt { s: number; lat: number; /** 本線のレール面からの高さ [m] */ h: number }
export interface AirportGeometry { ad: AirPt[]; au: AirPt[]; jr: AirPt[] }

type Op = { type: 'straight'; len: number } | { type: 'arc'; R: number; angle: number; turn: 'L' | 'R' };

const STEP = 8;

/** 空港線の2本と JR の点列を本線の線形から求める。同じ Track なら結果は同じ（route の reserved と world の描画で共有） */
export function airportGeometry(track: Track): AirportGeometry {
  // 本線の中心線（1m 刻み）
  const N = 1700, cx = new Float64Array(N), cz = new Float64Array(N);
  for (let i = 0; i < N; i++) { const p = track.trackAt(i); cx[i] = p.x; cz[i] = p.z; }
  /** 世界座標 → 本線の (s, 横位置)。guess の前後で最も近い s */
  const project = (x: number, z: number, lo: number, hi: number): { s: number; lat: number } => {
    let best = Math.max(0, lo), bd = Infinity;
    for (let i = Math.max(0, Math.floor(lo)); i <= Math.min(N - 1, Math.ceil(hi)); i++) { const d = (cx[i] - x) ** 2 + (cz[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    // 接線方向へ射影して補正
    const p = track.trackAt(best), tx = Math.sin(p.phi), tz = -Math.cos(p.phi);
    const s = best + (x - p.x) * tx + (z - p.z) * tz, q = track.trackAt(s);
    return { s, lat: (x - q.x) * q.rx + (z - q.z) * q.rz };
  };
  /** 本線から lat 離れて平行な区間（s0〜s1）の後、その終端の向きのまま ops をたどる点列（sample ごとに (s, lat)）。h は経路長 u の関数 */
  const path = (lat: number, s0: number, sFollow: number, ops: Op[], hOf: (u: number) => number): AirPt[] => {
    const out: AirPt[] = [];
    for (let s = s0; s < sFollow; s += STEP) out.push({ s, lat, h: hOf(s - s0) });
    let p = track.at(sFollow, lat, 0), phi = track.trackAt(sFollow).phi, u = sFollow - s0, x = p.x, z = p.z;
    out.push({ s: sFollow, lat, h: hOf(u) });
    let guess = sFollow;
    for (const op of ops) {
      const len = op.type === 'straight' ? op.len : op.R * op.angle, n = Math.max(1, Math.round(len / STEP));
      const sign = op.type === 'arc' ? (op.turn === 'R' ? 1 : -1) : 0;
      const x0 = x, z0 = z, phi0 = phi;
      const ccx = x0 + Math.cos(phi0) * (op.type === 'arc' ? op.R : 0) * sign, ccz = z0 + Math.sin(phi0) * (op.type === 'arc' ? op.R : 0) * sign;
      for (let k = 1; k <= n; k++) {
        const d = len * k / n;
        if (op.type === 'straight') { x = x0 + Math.sin(phi0) * d; z = z0 - Math.cos(phi0) * d; phi = phi0; }
        else { phi = phi0 + sign * d / op.R; x = ccx - Math.cos(phi) * op.R * sign; z = ccz - Math.sin(phi) * op.R * sign; }
        const q = project(x, z, guess - 60, guess + 400);
        guess = q.s;
        out.push({ s: q.s, lat: q.lat, h: hOf(u + d) });
      }
      u += len;
    }
    return out;
  };
  // 下り線(AD): 外側下り線から左へ 6m 振れて平行、AIR_S1 から 35‰ で上り、s 790 で右へ曲がって本線を斜めにまたぎ、その先で緩く戻る
  const ad = path(AD_LAT, AIR_S1, 790, [
    { type: 'arc', R: 260, angle: 32 * Math.PI / 180, turn: 'R' }, { type: 'straight', len: 40 },
    { type: 'arc', R: 320, angle: 40 * Math.PI / 180, turn: 'R' }, { type: 'straight', len: 160 },
  ], u => Math.max(0, Math.min(AD_RISE, u * AD_GRADE)));
  // 上り線(AU): 外側上り線から右へ 6m 振れて平行、s 540 から本線のカーブに沿わず直進し、のち右（西・北西）へ曲がる。本線の高架と同じ高さ
  const au = path(AU_LAT, AIR_S1, 540, [
    { type: 'straight', len: 330 }, { type: 'arc', R: 450, angle: 50 * Math.PI / 180, turn: 'R' }, { type: 'straight', len: 180 },
  ], () => 0);
  // 描くのは分岐から数百m先まで（ゲームの視界内）。本線の s が AIR_END を超えた点は捨てる
  const cut = (a: AirPt[]) => a.filter(p => p.s <= AIR_END);
  // JR: 本線に直角（横位置の方向）。平らな区間 ±JR_FLAT、その外は 35‰ で地面へ
  const jr: AirPt[] = [];
  const y0 = track.trackAt(JR_S).y, reach = JR_FLAT + (y0 + JR_RISE) / JR_GRADE;
  for (let l = -reach; l <= reach + .01; l += 12) {
    const a = Math.abs(l), y = a <= JR_FLAT ? y0 + JR_RISE : Math.max(.6, y0 + JR_RISE - (a - JR_FLAT) * JR_GRADE);
    jr.push({ s: JR_S, lat: l, h: y - y0 });
  }
  return { ad: cut(ad), au: cut(au), jr };
}

/** 景観（OSM の建物・道路・木）を置かない範囲。空港線の高架の下（道路は残す）と、JR の高架・築堤の帯（道路は残す） */
export function airportReserved(g: AirportGeometry): { from: number; to: number; lat0: number; lat1: number; keepRoads: boolean }[] {
  const out: { from: number; to: number; lat0: number; lat1: number; keepRoads: boolean }[] = [];
  for (const line of [g.ad, g.au]) {
    for (let i = 0; i + 1 < line.length;) {
      let j = i + 1;
      while (j + 1 < line.length && line[j].s - line[i].s < 24) j++;
      const seg = line.slice(i, j + 1);
      out.push({ from: Math.floor(Math.min(...seg.map(p => p.s))) - 2, to: Math.ceil(Math.max(...seg.map(p => p.s))) + 2,
        lat0: Math.floor(Math.min(...seg.map(p => p.lat))) - 7, lat1: Math.ceil(Math.max(...seg.map(p => p.lat))) + 7, keepRoads: true });
      i = j;
    }
  }
  const reach = Math.max(...g.jr.map(p => Math.abs(p.lat)));
  out.push({ from: JR_S - JR_HALF_WIDTH - 5, to: JR_S + JR_HALF_WIDTH + 5, lat0: -reach, lat1: reach, keepRoads: true });
  return out;
}
