// ゲーム状態（1プレイ分）
import { NOTCH_INITIAL } from '../core/config';
import type { SignalAspect } from '../core/events';
import { applyService, selectableServices } from '../route/service';
import { applyPlayerVehicles } from '../route/player-vehicles';
import type { Route, ServiceId, TrainKind } from '../route/types';
import type { TrainState } from '../sim/train';
import type { PassJudgement, StopJudgement } from './scoring';
import type { MeetState } from './meet';

export type GameStateName = 'title' | 'run' | 'dwell' | 'result';

/** 運転モード: 通常 / 遅延回復（遅れて発車、定時採点が厳しい）/ 定時運転（時間のみ採点） */
export type GameMode = 'normal' | 'recovery' | 'timeOnly';
export const MODE_LABEL: Record<GameMode, string> = { normal: '通常', recovery: '遅延回復', timeOnly: '定時運転' };

/** ステージ = 停車駅間（全線通しは from = 始発, to = 終着） */
export interface Stage { id: string; from: number; to: number; label: string; /** 全線通しと同じく長い区間（遅延回復の開始遅れを大きくする） */ long?: boolean }

/** 種別ごとに選んだ車種・両数 */
/** units = 連結するユニット（両数）。cars は旧形式の保存データ（両数のみ）の読み込み用 */
export type VehicleSel = Partial<Record<ServiceId, { kind: TrainKind; freeKind?: TrainKind; units?: number[]; cars?: number }>>;
export interface Selection {
  stageId: string; mode: GameMode; /** 運行種別（route.services が無い路線では無視） */ service: ServiceId;
  vehicles: VehicleSel;
  /** 路線（方向）。切替はページの再読込で反映（main.ts が起動時に読む） */
  routeId?: string;
}

/** 待避中に通過していく後続列車（game/overtake.ts が動かし、world/overtaking.ts が描画） */
export interface OvertakeState {
  /** 待避する駅 index */
  station: number;
  /** 通過列車の種別 */
  passedBy: ServiceId;
  /** この駅で待つ何本目か（0 から。同じ駅で特急の通過 → 急行の接続など、続けて待つ） */
  seq: number;
  /** 出発信号（route.signals の index）。通過列車が抜けるまで停止現示 */
  depSignal: number;
  /** run = 走行中, done = 通過済み（見えなくなった） */
  phase: 'run' | 'done';
  /** 通過列車がこの駅に停車する場合の停止位置 [m]（本線ホーム）。停車しないなら null */
  stopAt: number | null;
  /** 停車中の残り時間 [s]（停車前は未使用） */
  dwellLeft: number;
  /** 停車列車の走行段階 */
  stage: 'cruise' | 'brake' | 'stopped' | 'accel';
  /** 先頭位置 [m]・速度 [m/s]・編成長 [m] */
  head: number;
  v: number;
  len: number;
  /** 出口分岐器を後部が抜けて見えなくなった（出発信号を開けてよい） */
  cleared: boolean;
  /** 普通がこの駅に停車した（出発信号の停止現示はそれから） */
  localStopped: boolean;
}

export interface AtsState {
  /** normal = 正常, warn = 警報中（確認待ち）, brake = 非常制動中 */
  state: 'normal' | 'warn' | 'brake';
  /** warn の残り時間 [s] */
  timer: number;
  reason: string;
}

export interface Penalties { atsWarn: number; atsBrake: number; redPass: number; wrongStop: number }

export interface GameState {
  state: GameStateName;
  train: TrainState;
  /** 始発駅出発からの経過時間 [s]（ステージ途中開始でも時刻表基準） */
  t: number;
  /** 次に停車する駅の index（route.stations） */
  target: number;
  /** 速度超過の累積時間 [s] */
  overspeed: number;
  /** 非常ブレーキ使用（ATS による作動は除く） */
  eb: boolean;
  /** 停止継続時間（停止判定用） */
  stopTimer: number;
  /** 停止した瞬間のノッチ（衝動判定用） */
  notchAtStop: number;
  lastJoint: number;
  /** 速度超過中 */
  overspeedActive: boolean;
  /** 警報音の間隔タイマ */
  beepT: number;
  /** 停車中の戸閉めまでの残り時間（dwell） */
  dwellT: number;
  /** 一度だけ出す案内のフラグ */
  flags: Record<string, boolean>;
  /** 停車駅ごとの判定 */
  stops: StopJudgement[];
  /** 通過駅ごとの判定 */
  passes: PassJudgement[];

  // ---- 拡張 ----
  /** 選択中のステージ・モード（リセットしても保持） */
  sel: Selection;
  /** 今回プレイの開始駅 / 終着駅 index */
  fromIndex: number;
  endIndex: number;
  /** 開始時の遅れ [s]（遅延回復モード） */
  lateStart: number;
  /** ドア状態（closing = 戸閉め中。閉まり切るまで発車できない） */
  doors: 'open' | 'closing' | 'closed';
  /** 戸閉め中の残り時間 [s] */
  doorCloseT: number;
  /** 各信号の表示現示（route.signals と同順。自列車・先行列車の在線を反映） */
  signals: SignalAspect[];
  /** 次に通過する信号の index（無ければ -1） */
  nextSignal: number;
  /** 直前に通過した信号による制限 [km/h]（Infinity = 制限なし） */
  sigLimit: number;
  /** 先行列車の先頭位置 [m] */
  precedingS: number;
  ats: AtsState;
  penalties: Penalties;
  /** 待避（普通のみ）。無ければ null */
  overtake: OvertakeState | null;
  /** 単線の交換駅で行き違う対向列車（game/meet.ts）。無ければ null */
  meet: MeetState | null;
  /** 一時停止中（run / dwell のときのみ true になり得る。シミュレーション時刻・信号・ATS・対向列車・音を止める） */
  paused: boolean;
}

/** 停車駅（通過駅を除く）の index 列 */
export const stopIndices = (route: Route): number[] => route.stations.map((s, i) => (s.pass ? -1 : i)).filter(i => i >= 0);

export function stagesOf(route: Route): Stage[] {
  const idx = stopIndices(route), st = route.stations;
  const list: Stage[] = [];
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    list.push({ id: `${a}-${b}`, from: a, to: b, label: `${st[a].name} → ${st[b].name}` });
  }
  if (list.length > 1) {
    let a = idx[0], b = idx[idx.length - 1];
    const goals = (route.partialGoals ?? []).filter(g => g.services.includes(route.activeServiceId as ServiceId) && idx.includes(g.from) && idx.includes(g.to) && g.from < g.to);
    const whole = goals.find(g => g.asAll);
    if (whole) { a = whole.from; b = whole.to; }
    for (const g of goals) {
      if (!g.asAll && !(g.from === a && g.to === b))
        list.push({ id: `${g.from}-${g.to}`, from: g.from, to: g.to, label: `${st[g.from].name} → ${st[g.to].name}`, long: true });
    }
    list.push({ id: 'all', from: a, to: b, label: '全線通し' });
  }
  return list;
}

export const findStage = (route: Route, id: string): Stage => {
  const list = stagesOf(route);
  return list.find(s => s.id === id) ?? list[0];
};

/** 駅の定刻発車時刻 [s] */
export const departureTime = (route: Route, index: number): number => {
  const s = route.stations[index];
  return s.scheduledArrival + (index === 0 ? 0 : s.dwell ?? 20);
};

/** 遅延回復モードの開始遅れ [s] */
export const lateStartFor = (stage: Stage, mode: GameMode): number =>
  mode !== 'recovery' ? 0 : stage.id === 'all' || stage.long ? 45 : 20;

export function createState(route: Route, sel?: Selection): GameState {
  const st = {} as GameState;
  if (sel) st.sel = sel;
  resetState(st, route);
  return st;
}

/** 選んだ区間の終点に合わせて行先を決める（ServiceSpec.destinationByEnd）。元の行先は初回に退避 */
const baseDest = new WeakMap<object, [string | undefined, string | undefined]>();
function applyDestinations(route: Route, end: number): void {
  const name = route.stations[end]?.name;
  for (const v of route.services ?? []) {
    if (!v.destinationByEnd) continue;
    let b = baseDest.get(v);
    if (!b) { b = [v.destination, v.destinationKana]; baseDest.set(v, b); }
    const hit = name ? v.destinationByEnd[name] : undefined;
    v.destination = hit ? hit[0] : b[0]; v.destinationKana = hit ? hit[1] : b[1];
  }
}

export function resetState(st: GameState, route: Route): void {
  const services = selectableServices(route);
  const fallback = services.find(x => x.id === 'express')?.id ?? services[0]?.id ?? 'express';
  const sel: Selection = st.sel ?? { stageId: '', mode: 'normal', service: fallback, vehicles: {} };
  // 保存済み種別がこのコースで選べない場合、急行または先頭の種別へ戻す。
  if (services.length && !services.some(x => x.id === sel.service)) sel.service = fallback;
  applyPlayerVehicles(route, sel.vehicles);
  applyService(route, sel.service); // 停車駅・時刻・編成長を種別に合わせてから区間を決める
  if (!sel.stageId) sel.stageId = stagesOf(route)[0]?.id ?? 'all';
  const stage = findStage(route, sel.stageId);
  if (stage) sel.stageId = stage.id; // 種別により存在しない区間（例: 特急の全線通し）は先頭区間へ
  const from = stage?.from ?? 0, end = stage?.to ?? route.stations.length - 1;
  applyDestinations(route, end);
  const s0 = from === 0 ? route.startS : route.stations[from].stopS;
  const late = stage ? lateStartFor(stage, sel.mode) : 0;
  Object.assign(st, {
    state: 'title',
    train: { s: s0, v: 0, acc: 0, notch: NOTCH_INITIAL },
    t: departureTime(route, from) + late, target: nextStopIndex(route, from), overspeed: 0, eb: false,
    stopTimer: 0, notchAtStop: 0, lastJoint: Math.floor(s0 / 25),
    overspeedActive: false, beepT: 0, dwellT: 0, flags: {}, stops: [], passes: [],
    sel, fromIndex: from, endIndex: end, lateStart: late, doors: 'closed', doorCloseT: 0,
    signals: (route.signals ?? []).map(() => 'G'), nextSignal: -1, sigLimit: Infinity, precedingS: 0,
    ats: { state: 'normal', timer: 0, reason: '' },
    penalties: { atsWarn: 0, atsBrake: 0, redPass: 0, wrongStop: 0 },
    overtake: null, meet: null, paused: false,
  } satisfies GameState);
}

/** index より後の最初の停車駅（通過駅を除く）。無ければ -1 */
export function nextStopIndex(route: Route, index: number): number {
  for (let i = index + 1; i < route.stations.length; i++) if (!route.stations[i].pass) return i;
  return -1;
}

/** 今回プレイの終着か */
export const isFinalStop = (route: Route, index: number, st?: GameState): boolean =>
  st ? index === st.endIndex || nextStopIndex(route, index) < 0 : nextStopIndex(route, index) < 0;
