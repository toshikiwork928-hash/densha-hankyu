// キーボード入力 → GameActions
import type { GameActions } from '../core/context';

export function attachKeyboard(actions: GameActions, target: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    const k = e.code;
    // 入力欄（他モジュールの設定 UI など）では無視
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return; // 修飾キー付きは他モジュールのショートカット
    // 一時停止（運転・停車中のみ。結果画面の Esc はタイトルへ）。停止中は再開以外の操作を受け付けない
    if ((k === 'Escape' || k === 'KeyP') && actions.canPause()) { actions.togglePause(); return; }
    if (actions.canPause() && !actions.canControl()) return;
    if (k === 'KeyV') { actions.cycleCamera(); return; }
    if (!actions.canControl()) {
      if (k === 'Enter' || k === 'Space') actions.startOrRetry();
      else if (k === 'ArrowLeft') actions.selectStage(-1);
      else if (k === 'ArrowRight') actions.selectStage(1);
      else if (k === 'ArrowUp') actions.selectMode(-1);
      else if (k === 'ArrowDown') actions.selectMode(1);
      else if (k === 'Tab' || k === 'KeyK') actions.selectService(1); // 種別（普通 → 急行 → 特急）
      else if (k === 'KeyR') actions.toggleReplay();
      else if (k === 'Escape' || k === 'KeyT') actions.toTitle();
      return;
    }
    if (k === 'ArrowUp' || k === 'KeyW') actions.notchStep(1);
    else if (k === 'ArrowDown' || k === 'KeyS') actions.notchStep(-1);
    else if (k === 'KeyN') actions.notchOff();
    else if (k === 'Space') actions.emergency();
    else if (k === 'KeyA') actions.atsAck();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
