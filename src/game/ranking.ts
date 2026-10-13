// 記録（localStorage。使えない環境では記録しないだけ）: 自己ベスト・プレイ履歴・前回の選択
import type { ServiceId, TrainKind } from '../route/types';
import type { GameMode, Selection } from './state';
import { DEFAULT_ROUTE, lineOf } from '../route';

const KEY = 'densha.best.v1';
const KEY_HIST = 'densha.history.v1';
const KEY_SEL = 'densha.selection.v1';
/** 路線（線区）ごとの最後の選択（路線を切り替えて戻ったときに復元） */
const KEY_SEL_LINES = 'densha.selection.lines.v1';
const HIST_MAX = 100;

export interface BestEntry { total: number; rank: string; date: string }

/** 1プレイの記録 */
export interface PlayRecord {
  /** 日時（ISO 文字列） */
  at: string;
  service?: ServiceId;
  kind?: TrainKind;
  cars?: number;
  stageId: string;
  mode: GameMode;
  result: 'stop' | 'overrun';
  total: number;
  rank: string;
  /** 最後の停車の停止位置誤差 [m]・定刻差 [s] */
  err: number;
  delay: number;
}

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
function write(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 保存不可 */ }
}

const load = () => read<Record<string, BestEntry>>(KEY, {});

// 急行は従来（種別導入前）の記録と同じキー
const keyOf = (routeId: string, stageId: string, mode: GameMode, service?: ServiceId) =>
  `${routeId}:${service && service !== 'express' ? service + '/' : ''}${stageId}:${mode}`;

export function getBest(routeId: string, stageId: string, mode: GameMode, service?: ServiceId): BestEntry | undefined {
  return load()[keyOf(routeId, stageId, mode, service)];
}

/** 結果を登録。戻り値: 自己ベスト更新か、と更新前の記録 */
export function submitScore(routeId: string, stageId: string, mode: GameMode, total: number, rank: string, service?: ServiceId): { isNew: boolean; prev?: BestEntry } {
  const all = load(), k = keyOf(routeId, stageId, mode, service), prev = all[k];
  if (prev && prev.total >= total) return { isNew: false, prev };
  all[k] = { total, rank, date: new Date().toISOString().slice(0, 10) };
  write(KEY, all);
  return { isNew: true, prev };
}

/** プレイ履歴（新しい順） */
export const getHistory = (routeId: string): PlayRecord[] => read<Record<string, PlayRecord[]>>(KEY_HIST, {})[routeId] ?? [];

export function addHistory(routeId: string, rec: PlayRecord): void {
  const all = read<Record<string, PlayRecord[]>>(KEY_HIST, {});
  all[routeId] = [rec, ...(all[routeId] ?? [])].slice(0, HIST_MAX);
  write(KEY_HIST, all);
}

/** 自己ベストと履歴をすべて消す */
export function resetRecords(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(KEY_HIST); } catch { /* 保存不可 */ }
}

export const loadSelection = (): Selection | undefined => {
  const s = read<Selection | null>(KEY_SEL, null);
  return s && typeof s.service === 'string' ? { ...s, vehicles: s.vehicles ?? {} } : undefined;
};
/** 選択を保存（現在の選択と、その路線の最後の選択） */
export function saveSelection(sel: Selection): void {
  write(KEY_SEL, sel);
  const line = lineOf(sel.routeId ?? DEFAULT_ROUTE.id);
  if (!line) return;
  const all = read<Record<string, Selection>>(KEY_SEL_LINES, {});
  all[line.id] = sel;
  write(KEY_SEL_LINES, all);
}

/** 路線（線区）の最後の選択。無ければ undefined */
export function selectionForLine(lineId: string): Selection | undefined {
  const s = read<Record<string, Selection>>(KEY_SEL_LINES, {})[lineId];
  return s && typeof s.service === 'string' ? { ...s, vehicles: s.vehicles ?? {} } : undefined;
}
