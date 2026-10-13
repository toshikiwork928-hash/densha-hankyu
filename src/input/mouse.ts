// マウス入力 → GameActions（PC）。運転中だけ有効: ホイールを奥へ回すと力行側、手前へ回すとブレーキ側へ1段、中ボタンでノッチオフ
// タッチパッドの細かい連続スクロールは量を貯めて1段ずつにする（1回の大きなスクロールでも1イベントで1段まで）
import type { GameActions } from '../core/context';

/** 1段に必要なスクロール量 [px]（ホイール1刻みは約100px） */
const STEP_PX = 90;
/** 段と段の最小間隔 [ms]（勢いよく回したときの行き過ぎを抑える） */
const STEP_GAP_MS = 70;

export function attachMouse(actions: GameActions, target: Window = window): () => void {
  let acc = 0, last = 0;
  /** タイトル・結果画面などの UI 上の操作は、その UI のスクロールに任せる */
  const onUi = (e: Event) => (e.target as HTMLElement | null)?.closest?.('#overlay, .vehicle-preview, #pauseOverlay') != null;
  const onWheel = (e: WheelEvent) => {
    if (!actions.canControl() || onUi(e)) { acc = 0; return; }
    e.preventDefault();
    const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (Math.sign(px) !== Math.sign(acc)) acc = 0; // 回す向きが変わったら貯めた量を捨てる
    acc += px;
    const now = performance.now();
    if (Math.abs(acc) < STEP_PX || now - last < STEP_GAP_MS) return;
    actions.notchStep(acc < 0 ? 1 : -1); // 奥へ（deltaY < 0）= 力行側
    acc = 0; last = now;
  };
  const onDown = (e: MouseEvent) => {
    if (e.button !== 1 || !actions.canControl() || onUi(e)) return;
    e.preventDefault(); // 中ボタンの自動スクロールを出さない
    actions.notchOff();
  };
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('mousedown', onDown);
  return () => { target.removeEventListener('wheel', onWheel); target.removeEventListener('mousedown', onDown); };
}
