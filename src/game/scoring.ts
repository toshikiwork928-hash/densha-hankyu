// 停止判定と採点
import type { Route, ServiceId } from '../route/types';
import type { GameMode, GameState, Penalties } from './state';

export interface StopJudgement {
  index: number;
  kind: 'stop' | 'overrun';
  /** 停止位置誤差 [m]（正 = 行き過ぎ） */
  err: number;
  /** 定刻との差 [s]（正 = 遅れ） */
  delay: number;
  /** 到着時の経過時間 [s] */
  t: number;
  notchAtStop: number;
  /** 強いブレーキで停車（衝動） */
  jolt: boolean;
  stopPts: number;
  timePts: number;
}

/** 通過駅の判定 */
export interface PassJudgement {
  index: number;
  /** 通過時刻の定刻差 [s] */
  delay: number;
  t: number;
  /** 誤って停車した */
  wrongStop: boolean;
}

export interface GameResult {
  kind: 'stop' | 'overrun';
  rank: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  stopPts: number;
  timePts: number;
  safePts: number;
  total: number;
  overspeed: number;
  eb: boolean;
  /** 最後の停車の判定（結果画面の主表示） */
  last: StopJudgement;
  stops: StopJudgement[];
  // ---- 拡張 ----
  passes: PassJudgement[];
  penalties: Penalties;
  mode: GameMode;
  stageId: string;
  /** 運行種別 */
  service: ServiceId;
  /** 各配点の満点 */
  max: { stop: number; time: number; safe: number };
}

const JOLT_NOTCH = -5; // B5 以上で停車したら衝動

/** モード別の配点と定時判定の厳しさ */
const RULES: Record<GameMode, { stop: number; time: number; safe: number; tol: number; lateSlope: number; earlySlope: number }> = {
  normal: { stop: 50, time: 30, safe: 20, tol: 1, lateSlope: 1.5, earlySlope: 1.5 },
  // 遅れは厳しく、早着は 5 秒まで許容
  recovery: { stop: 40, time: 40, safe: 20, tol: 0.5, lateSlope: 2.5, earlySlope: 0.8 },
  timeOnly: { stop: 0, time: 80, safe: 20, tol: 0.5, lateSlope: 4, earlySlope: 4 },
};

export const rulesFor = (mode: GameMode) => RULES[mode];

export function judgeStop(route: Route, st: GameState, index: number, kind: 'stop' | 'overrun'): StopJudgement {
  const sta = route.stations[index], R = RULES[st.sel.mode];
  const err = st.train.s - sta.stopS, delay = st.t - sta.scheduledArrival;
  const jolt = st.notchAtStop <= JOLT_NOTCH;
  let stopPts = 0, timePts = 0;
  if (kind === 'stop') {
    stopPts = R.stop * Math.max(0, 1 - Math.max(0, Math.abs(err) - .3) * 8 / 50);
    const off = delay > 0 ? Math.max(0, delay - R.tol) * R.lateSlope
      : Math.max(0, -delay - (st.sel.mode === 'recovery' ? 5 : R.tol)) * R.earlySlope;
    timePts = Math.max(0, R.time - off);
  }
  return { index, kind, err, delay, t: st.t, notchAtStop: st.notchAtStop, jolt, stopPts, timePts };
}

/** 安全点の減点内訳 */
export function safetyDeductions(st: GameState): { label: string; pts: number }[] {
  const p = st.penalties, list: { label: string; pts: number }[] = [];
  if (st.overspeed > 0) list.push({ label: `速度超過 ${st.overspeed.toFixed(1)}秒`, pts: st.overspeed * 2 });
  if (st.eb) list.push({ label: '非常ブレーキ使用', pts: 10 });
  if (st.stops.some(j => j.jolt)) list.push({ label: '停車時の衝動', pts: 5 });
  if (p.atsWarn) list.push({ label: `ATS警報 ${p.atsWarn}回`, pts: p.atsWarn * 3 });
  if (p.atsBrake) list.push({ label: `ATS非常制動 ${p.atsBrake}回`, pts: p.atsBrake * 10 });
  if (p.redPass) list.push({ label: `停止信号冒進 ${p.redPass}回`, pts: p.redPass * 20 });
  if (p.wrongStop) list.push({ label: `通過駅で停車 ${p.wrongStop}回`, pts: p.wrongStop * 10 });
  return list;
}

/** 全停車を集計。停止・定時は停車駅の平均、安全はプレイ全体 */
export function scoreGame(st: GameState): GameResult {
  const stops = st.stops, last = stops[stops.length - 1], R = RULES[st.sel.mode];
  const kind = last.kind;
  let stopPts = 0, timePts = 0, safePts = 0, rank: GameResult['rank'] = 'F';
  if (kind === 'stop') {
    stopPts = stops.reduce((a, j) => a + j.stopPts, 0) / stops.length;
    timePts = stops.reduce((a, j) => a + j.timePts, 0) / stops.length;
    safePts = Math.max(0, R.safe - safetyDeductions(st).reduce((a, d) => a + d.pts, 0));
    const tot = stopPts + timePts + safePts;
    rank = tot >= 95 ? 'S' : tot >= 85 ? 'A' : tot >= 70 ? 'B' : tot >= 50 ? 'C' : 'D';
  }
  return {
    kind, rank, stopPts, timePts, safePts, total: Math.round(stopPts + timePts + safePts),
    overspeed: st.overspeed, eb: st.eb, last, stops,
    passes: st.passes, penalties: { ...st.penalties }, mode: st.sel.mode, stageId: st.sel.stageId, service: st.sel.service,
    max: { stop: R.stop, time: R.time, safe: R.safe },
  };
}
