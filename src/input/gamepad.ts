// ゲームパッド（Gamepad API, standard mapping 想定）→ GameActions。frame ごとにポーリング
// 十字上下/RB・LB = ノッチ±1, A = 開始・ATS確認, B = 非常(EB)・結果画面でタイトルへ, X = ノッチオフ, Y = 視点,
// Start = 開始・一時停止/再開（運転・停車中）, Back = リプレイ, 十字左右 = ステージ選択, LB/RB = 種別選択（タイトル）, L3 = 1軸レバーモード切替（左スティック上下をマスコン位置に対応）
import { NOTCH_MAX } from '../core/config';
import type { GameContext } from '../core/context';

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, L3: 10, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEAD = 0.25;
const REPEAT = 0.28; // スティック段送りの間隔 [s]

export function attachGamepad(ctx: GameContext): void {
  if (typeof navigator === 'undefined' || !('getGamepads' in navigator)) return;
  const { events } = ctx, act = () => ctx.actions;
  let prev: boolean[] = [];
  let lever = false;
  let stickT = 0, stickDir = 0;
  const banner = (text: string, sec = 2) => events.emit('banner', { text, sec });

  addEventListener('gamepadconnected', e => banner(`ゲームパッド接続: ${(e as GamepadEvent).gamepad.id.slice(0, 24)}`, 2.5));

  /** -1(手前=ブレーキ) .. +1(奥=力行) → ノッチ。中央付近は N */
  const leverNotch = (a: number): number => {
    if (Math.abs(a) < 0.12) return 0;
    if (a > 0) return Math.min(NOTCH_MAX, Math.ceil((a - 0.12) / 0.88 * NOTCH_MAX));
    if (a < -0.97) return -9; // 最奥まで引くと EB
    return -Math.min(8, Math.ceil((-a - 0.12) / 0.85 * 8));
  };

  events.on('frame', ({ dt }) => {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = Array.from(pads).find((p): p is Gamepad => !!p && p.connected);
    if (!gp) return;
    const now = gp.buttons.map(b => b.pressed);
    const hit = (i: number) => !!now[i] && !prev[i];
    prev = now;
    const a = act(), running = a.canControl();
    // Start = 一時停止 / 再開（運転・停車中）。停止中は他のボタンを受け付けない
    if (a.canPause()) {
      if (hit(B.START)) { a.togglePause(); return; }
      if (!running) return;
    }

    if (hit(B.Y)) a.cycleCamera();
    if (hit(B.L3)) { lever = !lever; banner(lever ? 'レバーモード（左スティック上下 = マスコン位置）' : '段送りモード', 2.5); }

    if (!running) {
      if (hit(B.A) || hit(B.START)) a.startOrRetry();
      if (hit(B.LEFT)) a.selectStage(-1);
      if (hit(B.RIGHT)) a.selectStage(1);
      if (hit(B.UP)) a.selectMode(-1);
      if (hit(B.DOWN)) a.selectMode(1);
      if (hit(B.LB)) a.selectService(-1);
      if (hit(B.RB)) a.selectService(1);
      if (hit(B.BACK)) a.toggleReplay();
      if (hit(B.B)) a.toTitle();
      return;
    }
    if (hit(B.UP) || hit(B.RB)) a.notchStep(1);
    if (hit(B.DOWN) || hit(B.LB)) a.notchStep(-1);
    if (hit(B.X)) a.notchOff();
    if (hit(B.B)) a.emergency();
    if (hit(B.A)) a.atsAck();

    const ay = -(gp.axes[1] ?? 0); // 上 = 正
    if (lever) {
      const n = leverNotch(ay);
      if (n !== ctx.state.train.notch) a.setNotch(n);
      return;
    }
    // 段送り: 倒している間は一定間隔で 1 段ずつ
    const dir = ay > 0.6 ? 1 : ay < -0.6 ? -1 : 0;
    if (Math.abs(ay) < DEAD) stickDir = 0;
    if (dir !== 0 && (dir !== stickDir || (stickT -= dt) <= 0)) { a.notchStep(dir); stickDir = dir; stickT = REPEAT; }
  });
}
