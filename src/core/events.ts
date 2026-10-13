// 型付きイベントバス。モジュール間は直接呼び出しではなくここで疎結合にする
import type { ServiceSpec, Station } from '../route/types';
import type { GameResult, StopJudgement } from '../game/scoring';
import type { GameStateName } from '../game/state';
import type { TrainState } from '../sim/train';

export interface EventMap {
  /** 毎フレーム（状態に関係なく）。描画系の更新用 */
  frame: { dt: number; time: number; state: GameStateName };
  /** 走行シミュレーション1ステップ後（state==='run' のときのみ） */
  tick: { dt: number; train: Readonly<TrainState> };
  /** ゲーム状態遷移 */
  stateChange: { from: GameStateName; to: GameStateName };
  /** 新しいプレイ開始前の初期化 */
  reset: Record<string, never>;
  /** 開始操作（ユーザー操作の同期コールバック内。AudioContext 初期化に使える） */
  start: Record<string, never>;
  /** 駅を発車（index = 発車した駅） */
  depart: { index: number; station: Station };
  /** マスコン操作 */
  notch: { notch: number; prev: number };
  /** 駅接近（stage: 'announce' = 800m 手前の車内放送, 'near' = 100m 手前） */
  stationApproach: { index: number; station: Station; remain: number; stage: 'announce' | 'near' };
  /** 速度超過の開始/終了（エッジ） */
  overspeed: { active: boolean; limit: number; kmh: number };
  /** 警報音を鳴らすタイミング（速度超過中 0.5 秒ごと） */
  alarm: { kind: 'overspeed' };
  /** 制限区間の予告/解除 */
  limitNotice: { kind: 'ahead' | 'end'; kmh: number; from: number; to: number };
  /** レール継ぎ目通過 */
  jointPass: { v: number; s: number };
  /** 列車が停止した瞬間 */
  stop: { s: number; notch: number };
  /** 停車駅で停止確定（判定付き） */
  arrive: { index: number; station: Station; judgement: StopJudgement; final: boolean };
  /** 対向列車の警笛タイミング */
  oncomingHorn: { distance: number };
  /** 対向列車との近さ 0..1（すれ違い風切り音用。毎 tick） */
  oncomingPass: { proximity: number };
  /** 結果確定 */
  result: GameResult;
  /** HUD バナー表示要求 */
  banner: { text: string; sec: number };
  /** 素材読込の進捗 */
  assetsProgress: { done: number; total: number };
  assetsReady: { failed: number };

  // ---- 並列拡張用（A: ゲームプレイ / B: 環境 / C: ビジュアル / D: 音）。ここで名前と型を先に固定 ----
  /** [A] ドア開閉（停車駅の dwell 中） */
  doorOpen: { index: number; station: Station };
  doorClose: { index: number; station: Station };
  /** [G] ドアが閉まり切った（戸閉灯点灯。これ以降に力行で発車できる） */
  doorsClosed: { index: number; station: Station };
  /** [A] 信号現示の変化（自列車が次に見る信号） */
  signalAspect: { id: string; s: number; aspect: SignalAspect };
  /** [A] ATS 動作（warn = 警報ベル, brake = 非常ブレーキ作動, release = 復帰） */
  ats: { kind: 'warn' | 'brake' | 'release'; reason: string };
  /** [A] タイトル画面描画後。他モジュールが設定UIを container へ追加できる */
  titleRender: { container: HTMLElement };
  /** [A] カメラモード変更 */
  cameraMode: { mode: CameraMode };
  /** [B] 時間帯・天候の変更（タイトルでの選択時・開始時） */
  envChange: EnvState;
  /** [C] 踏切の鳴動状態（distance = 自列車先頭から踏切まで[m]、負なら通過後） */
  crossing: { id: string; s: number; active: boolean; distance: number };
  /** [C] トンネル出入り */
  tunnel: { inside: boolean };
  /** [G] 運行種別の変更（タイトルでの選択時。起動時は route に適用済みで発火しない場合あり → ctx.service を参照） */
  serviceChange: { service: ServiceSpec };
  /** 一時停止の開始/解除（停止中はシミュレーション・音・放送を止める） */
  pause: { paused: boolean; reason: 'user' | 'hidden' };
  /** [G] 待避中に後続列車が本線を通過（0..1 の近さ。風切り音用。通過中は毎フレーム） */
  overtakePass: { proximity: number };
}

export type SignalAspect = 'R' | 'Y' | 'YG' | 'G';
export type CameraMode = 'cab' | 'outside' | 'replay';
export type TimeOfDay = 'morning' | 'noon' | 'evening' | 'night';
export type Weather = 'clear' | 'rain' | 'snow' | 'fog';
export interface EnvState { timeOfDay: TimeOfDay; weather: Weather; /** 0..1 */ intensity: number }

export type EventName = keyof EventMap;
type Handler<K extends EventName> = (payload: EventMap[K]) => void;

export class EventBus {
  private handlers: { [K in EventName]?: Handler<K>[] } = {};

  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const list = (this.handlers[name] ??= []) as Handler<K>[];
    list.push(fn);
    return () => this.off(name, fn);
  }

  off<K extends EventName>(name: K, fn: Handler<K>): void {
    const list = this.handlers[name] as Handler<K>[] | undefined;
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends EventName>(name: K, ...args: EventMap[K] extends Record<string, never> ? [] | [EventMap[K]] : [EventMap[K]]): void {
    const list = this.handlers[name] as Handler<K>[] | undefined;
    if (!list) return;
    const payload = (args[0] ?? {}) as EventMap[K];
    for (const fn of [...list]) fn(payload);
  }
}
