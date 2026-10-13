// 列車の運動モデル。ノッチ → 目標加速度、ブレーキ遅れ、走行抵抗
import { NOTCH_EB } from '../core/config';
import type { TrainKind } from '../route/types';

/** 車種ごとの性能（加速度は P5 の値） */
export interface TrainPerf {
  /** 起動加速度 [m/s²] */
  a0: number;
  /** 定トルク域の上限速度 [m/s]（これより上は a0·(vBase/v)^k） */
  vBase: number;
  /** 高速域の加速度の落ち方（1 = 定出力、大きいほど高速で弱い） */
  k: number;
  /** 常用最大（B8）の減速度 [m/s²] */
  bMax: number;
  /** 非常ブレーキの減速度 [m/s²] */
  eb: number;
  /** 設計最高速度 [m/s]（これ以上は力行しても加速しない） */
  vMax: number;
}

const kmh = (x: number) => x / 3.6;
/** 通勤形（新・VVVF）: 3.0km/h/s、高速まで素直 / 通勤形（旧・抵抗制御）: 2.5km/h/s、高速で弱い / 特急形: 2.5km/h/s、定出力域が広く 110km/h 運転が楽 */
export const TRAIN_PERF: Record<TrainKind, TrainPerf> = {
  'commuter-new': { a0: kmh(3.0), vBase: kmh(40), k: 1, bMax: 1.2, eb: 1.45, vMax: kmh(110) },
  'commuter-old': { a0: kmh(2.5), vBase: kmh(35), k: 1.25, bMax: 1.1, eb: 1.4, vMax: kmh(110) },
  // 2300系（山岳線の 18m 車。高速域が弱い）: 2.8km/h/s。50‰ の上りでは約 40km/h で頭打ち（均衡速度）、
  // 下りは B4 以上で 50‰ の勾配に打ち勝って減速できる（抑速ブレーキなしで速度を保てる）
  'commuter-2300': { a0: kmh(2.8), vBase: kmh(30), k: 1.4, bMax: 1.2, eb: 1.45, vMax: kmh(100) },
  // 10000系（特急サザンの座席指定車）: 7100系と併結する抵抗制御車。加速 2.5km/h/s・最高 110km/h（7100系と同等）
  'southern-10000': { a0: kmh(2.5), vBase: kmh(35), k: 1.25, bMax: 1.1, eb: 1.4, vMax: kmh(110) },
  // 12000系（サザンプレミアム）: 指定席側を基準にしたゲーム用近似。
  'southern-12000': { a0: kmh(2.5), vBase: kmh(40), k: 1, bMax: 3.7 / 3.6, eb: 4.0 / 3.6, vMax: kmh(120) },
  limited: { a0: kmh(2.5), vBase: kmh(55), k: 1, bMax: 1.15, eb: 1.45, vMax: kmh(120) },
  // 以下はモブ（運転しない）。表を埋めるための近い値
  'commuter-1000': { a0: kmh(2.5), vBase: kmh(40), k: 1, bMax: 1.2, eb: 1.45, vMax: kmh(110) },
  // 9000系更新VVVF車: 既存通勤形に近い値を使うゲーム用近似。
  'commuter-9000': { a0: kmh(2.5), vBase: kmh(40), k: 1, bMax: 1.2, eb: 1.45, vMax: kmh(110) },
  'commuter-2000': { a0: kmh(2.5), vBase: kmh(35), k: 1.2, bMax: 1.2, eb: 1.45, vMax: kmh(110) },
  'commuter-6300': { a0: kmh(2.5), vBase: kmh(35), k: 1.25, bMax: 1.1, eb: 1.4, vMax: kmh(100) },
  // 阪急2000系（2代目・SiC素子VVVF）。性能値は不明のためゲーム用の仮値（加速 2.6km/h/s・設計最高 120km/h）
  'hankyu-2000': { a0: kmh(2.6), vBase: kmh(40), k: 1, bMax: 1.2, eb: 1.45, vMax: kmh(120) },
  'limited-30000': { a0: kmh(2.5), vBase: kmh(35), k: 1.25, bMax: 1.1, eb: 1.4, vMax: kmh(110) },
};
/** 種別なし路線の従来性能 */
export const DEFAULT_PERF: TrainPerf = { a0: .92, vBase: 9.7, k: 1, bMax: 1.15, eb: 1.45, vMax: kmh(120) };

export interface TrainState {
  /** 先頭位置 [m] */
  s: number;
  /** 速度 [m/s] */
  v: number;
  /** 現在の加減速度（遅れ込み）[m/s²] */
  acc: number;
  notch: number;
}

/** 外部環境係数。天候・路線側モジュールが書き換える */
export interface TrainEnv {
  /** 粘着係数の倍率（1 = 乾燥。雨天で < 1） */
  adhesion: number;
  /** 現在位置の勾配 [‰]（正 = 上り）。ゲームループが毎 tick 更新 */
  gradePermil: number;
  /** 車両性能（運行種別の車種。game/loop.ts が設定） */
  perf?: TrainPerf;
}

export const createTrainEnv = (): TrainEnv => ({ adhesion: 1, gradePermil: 0 });

const G = 9.81;

/** 1 ステップ進める。戻り値: 今回停止した瞬間なら true */
export function stepTrain(tr: TrainState, env: TrainEnv, dt: number): boolean {
  const v = tr.v, n = tr.notch, P = env.perf ?? DEFAULT_PERF;
  let target = 0;
  if (n > 0) {
    const amax = v >= P.vMax ? 0 : v < P.vBase ? P.a0 : P.a0 * Math.pow(P.vBase / v, P.k);
    target = amax * n / 5;
  } else if (n < 0) target = n === NOTCH_EB ? -P.eb : -P.bMax * (-n) / 8;
  // 粘着低下時は加減速度の上限を下げる（簡易）
  if (env.adhesion < 1) target *= env.adhesion;
  const tau = n < 0 ? .75 : .5; // 空気ブレーキの立ち上がり遅れ
  tr.acc += (target - tr.acc) * Math.min(1, dt / tau);
  const res = .018 + .00005 * v * v;
  // 勾配抵抗（上りで減速）
  const grade = env.gradePermil ? G * env.gradePermil / 1000 : 0;
  const a = tr.acc - (v > 0 ? res : 0) - grade;
  const prevV = tr.v;
  tr.v = Math.max(0, v + a * dt);
  tr.s += tr.v * dt;
  return prevV > 0 && tr.v === 0;
}
