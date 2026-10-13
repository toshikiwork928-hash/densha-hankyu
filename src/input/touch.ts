// タッチボタン（#touch button[data-k]）→ GameActions。ATS確認・視点ボタンはここで追加する
import type { GameActions } from '../core/context';

export function attachTouch(actions: GameActions, root: ParentNode = document): void {
  const box = root.querySelector<HTMLElement>('#touch');
  if (box && !box.querySelector('[data-k="ats"]')) {
    const mk = (k: string, html: string) => { const b = document.createElement('button'); b.dataset.k = k; b.innerHTML = html; return b; };
    box.insertBefore(mk('ats', 'ATS<small>確認</small>'), box.querySelector('[data-k="eb"]'));
    box.appendChild(mk('cam', '視点'));
  }
  root.querySelectorAll<HTMLButtonElement>('#touch button').forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    const k = b.dataset.k;
    if (k === 'cam') { actions.cycleCamera(); return; }
    if (!actions.canControl()) return;
    if (k === 'up') actions.notchStep(1);
    else if (k === 'down') actions.notchStep(-1);
    else if (k === 'ats') actions.atsAck();
    else if (k === 'eb') actions.emergency();
  }));
}
