// 羽倉崎検車区の平面形（泉佐野〜みさき公園コース、下りの座標）。描画は world/hagurazaki-depot.ts。
// 資料: docs/south-scenery-research-1.md の 2章（OSM と Wikipedia）。
//   羽倉崎駅の樽井寄り（南側）に沿い、進行方向（下り）の左側（東〜南東・山側）。構内の線路は長さ約760m、南西端で約14本（留置線の公式な本数は不明）。
//   羽倉崎駅は2面3線（島式の1・2番と単式の3番。駅舎は3番線側）で、1番線が車庫に直接つながる。駅の泉佐野寄り約230mで引上げ線が本線に合流する。
// 車庫の建物（検修庫・洗浄線の屋根）の形・色・高さ、構内の線路が何番線までか、車庫が本線と同じ高さか（地上と判断）は不明。
// 寸法はすべてゲーム用の概形で、実測値ではない。
import type { ExtraTrack, Route } from '../types';

/** 羽倉崎駅の 1番線（島式ホームの左の線）の横位置。島式ホーム（幅 5.8）の線路中心から端 1.7m */
export const T1_LAT = -9.2;
/** 1番線（引上げ線）が本線から分かれる範囲と、車庫への入口（梯子線の始点） */
export const LEAD_FROM = 1990, LEAD_TO_FULL = 2080, LEAD_END = 2335;

export const DEPOT = {
  /** 梯子線（斜めの引上げ線）の始点 s と、s あたりの横位置の変化（左へ） */
  ladderS: 2330, ladderSlope: .2,
  /** 留置線の本数・線間隔・1本目の横位置（OSM は約14本。ゲームでは13本） */
  count: 13, pitch: 4.2, lat0: -13.4,
  /** 留置線の車止め（南西端）の s。入口（2361）から約 724m。構内は駅のホーム端（s 2320）から約 765m */
  bumper: 3085,
  /** 検修庫（建物の中に入る線）: 留置線 shedFrom〜count-1 番（0 始まり）、s の範囲 */
  shedFrom: 8, shedS0: 2850, shedS1: 3098,
  /** 構内の柵 */
  fenceLat: -73, fenceSouth: 3104, fenceWest: -5.8, fenceNorth: 2326,
};

/** k 番目の留置線の横位置 */
export const yardLat = (k: number): number => DEPOT.lat0 - DEPOT.pitch * k;
/** k 番目の留置線が梯子線から分かれる s */
export const yardBranchS = (k: number): number => DEPOT.ladderS + (T1_LAT - yardLat(k)) / DEPOT.ladderSlope;
/** 梯子線の横位置 */
export const ladderLat = (s: number): number => T1_LAT - DEPOT.ladderSlope * Math.max(0, s - DEPOT.ladderS);

/** 本線から分かれて羽倉崎の 1番線になり、車庫の梯子線へ続く線（route.extraTracks）。描画する床版は無い（地上） */
export const HAGURAZAKI_LEAD: ExtraTrack = {
  id: 'hagurazaki-t1', lat: [[LEAD_FROM, 0], [LEAD_TO_FULL, T1_LAT], [LEAD_END, T1_LAT]], from: LEAD_FROM, to: LEAD_END, ownDeck: false,
};

/** 景観（OSM の建物・道路・木・駐車場）を置かない範囲: 車庫の構内全体 */
export const HAGURAZAKI_RESERVED: NonNullable<Route['reserved']> = [
  { from: DEPOT.ladderS - 6, to: DEPOT.fenceSouth + 6, lat0: DEPOT.fenceLat - 8, lat1: -6.5 },
];
