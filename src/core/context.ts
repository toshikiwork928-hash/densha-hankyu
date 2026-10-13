// モジュール間で共有するコンテキスト。グローバル変数の代わりにこれを渡す
import type * as THREE from 'three';
import type { EventBus, CameraMode, EnvState } from './events';
import type { Rng } from './rng';
import type { Route } from '../route/types';
import type { Track } from '../route/track';
import type { GameState } from '../game/state';
import type { TrainEnv } from '../sim/train';
import type { EnvironmentHandles } from '../env/environment';

/** 入力デバイス（キーボード・タッチ・将来のゲームパッド）から呼ぶ操作 */
export interface GameActions {
  /** ノッチを直接指定（範囲外は丸める） */
  setNotch(n: number): void;
  /** +1 = 力行側、-1 = ブレーキ側 */
  notchStep(delta: number): void;
  notchOff(): void;
  emergency(): void;
  /** タイトル/結果画面からの開始 */
  startOrRetry(): void;
  /** 運転操作を受け付ける状態か */
  canControl(): boolean;
  /** [A] ATS 確認扱い */
  atsAck(): void;
  /** [A] カメラ切替（運転台 → 俯瞰追従 → 前方斜め → 編成全景 → 運転台） */
  cycleCamera(): void;
  /** [A] 結果画面からタイトルへ */
  toTitle(): void;
  /** 一時停止できる状態か（運転中・停車中のみ。リプレイ・タイトル・結果では不可） */
  canPause(): boolean;
  /** 一時停止の切替 / 指定（reason: user = 操作, hidden = タブ非表示で自動） */
  togglePause(): void;
  setPaused(paused: boolean, reason?: 'user' | 'hidden'): void;
  /** 一時停止中にプレイを中断してタイトルへ戻る */
  quitToTitle(): void;
  /** [A] 結果画面でリプレイ開始/停止 */
  toggleReplay(): void;
  /** [A] タイトルでステージ/モード選択（delta で前後へ） */
  selectStage(delta: number): void;
  selectMode(delta: number): void;
  /** タイトルで運行種別選択（普通・急行・特急） */
  selectService(delta: number): void;
  /** タイトルで選択中の種別の車種・両数を変更 */
  selectVehicle(v: { kind?: import('../route/types').TrainKind; freeKind?: import('../route/types').TrainKind; units?: number[] }): void;
}

export interface GameContext {
  route: Route;
  track: Track;
  events: EventBus;
  state: GameState;
  /** 天候等が書き換える列車環境係数 */
  trainEnv: TrainEnv;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** 光源・霧・空（環境モジュールが管理） */
  env: EnvironmentHandles;
  /** 景観配置用の共有乱数（呼び出し順に注意） */
  rng: Rng;
  assetsReady: boolean;
  /** [B] 現在の時間帯・天候（envChange で更新） */
  envState: EnvState;
  /** [B] 連続的な明るさ係数（環境モジュールが毎フレーム更新。時間帯の切替に追従して滑らかに変化）
   *  night: 0 = 昼 .. 1 = 夜（窓明かり・看板・灯具の点灯度）、tunnel: 0..1 自列車がトンネル内 */
  light: { night: number; tunnel: number };
  /** 選択中の運行種別（未選択・旧路線では undefined）。音や車両外観の切替に使う */
  service?: import('../route/types').ServiceSpec;
  /** [A] 現在のカメラモード */
  cameraMode: CameraMode;
  /** game/loop.ts が設定 */
  actions: GameActions;
}
