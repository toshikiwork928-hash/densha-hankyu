import { loadSettings, saveSettings } from '../env/settings';

const KEY = 'densha.render.pending.v1';
let frames = 0;

export function beginQualityChange(): void {
  frames = 0;
  try { sessionStorage.setItem(KEY, 'pending'); } catch { /* 保存不可 */ }
}

/** 3Dが起動しなくても使えるDOMだけの復旧口。記録・車両・音設定は保持する。 */
export function installRenderRecovery(canvas: HTMLCanvasElement) {
  let failed = false;
  let pending = false;
  try { pending = sessionStorage.getItem(KEY) === 'pending'; } catch { /* 保存不可 */ }
  const safe = new URLSearchParams(location.search).get('safe') === '1';
  if (pending || safe) {
    saveSettings({ ...loadSettings(), quality: 'low' });
  }
  if (safe) {
    const url = new URL(location.href); url.searchParams.delete('safe');
    history.replaceState(history.state, '', url.href);
  }
  beginQualityChange();
  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    saveSettings({ ...loadSettings(), quality: 'low' });
    const panel = document.createElement('section');
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#17212b;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;font:16px sans-serif;text-align:center';
    const title = document.createElement('h2'); title.textContent = '描画を続けられないため停止した';
    const detail = document.createElement('p'); detail.textContent = message + ' 低画質へ戻した。プレイ記録・車両選択は保持。';
    const retry = document.createElement('button'); retry.textContent = '低画質で再読み込み';
    retry.style.cssText = 'font:inherit;padding:16px 24px;border-radius:8px';
    retry.onclick = () => { const url = new URL(location.href); url.searchParams.set('safe', '1'); location.replace(url.href); };
    panel.append(title, detail, retry); document.body.append(panel);
  };
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('GPUの描画接続が失われた。'); });
  window.addEventListener('error', () => fail('起動・描画処理でエラーが発生した。'));
  return {
    get failed() { return failed; }, fail,
    healthyFrame() {
      if (failed || ++frames !== 2) return;
      try { sessionStorage.removeItem(KEY); } catch { /* 保存不可 */ }
    },
  };
}
