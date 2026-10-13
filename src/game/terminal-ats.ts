import type { Route } from '../route/types';

// ゲーム用の連続速度照査。泉大津・堺は実際には本線の途中駅なので、
// 実設備の終端防護パターンとは称さず、コース終着の低速進入として設定する。
export const TERMINAL_CHECKPOINTS = [[1000, 65], [600, 45], [300, 35], [120, 25], [50, 15], [0, 10]] as const;

export function terminalSpeedLimit(route: Route, target: number, s: number): number {
  if (!route.terminalApproach || target !== route.stations.length - 1) return Infinity;
  const d = route.stations[target].stopS - s;
  if (d > 1000) return Infinity;
  if (d <= 0) return 10;
  for (let i = 0; i < TERMINAL_CHECKPOINTS.length - 1; i++) {
    const [far, fast] = TERMINAL_CHECKPOINTS[i], [near, slow] = TERMINAL_CHECKPOINTS[i + 1];
    if (d >= near) return slow + (fast - slow) * (d - near) / (far - near);
  }
  return 10;
}
