// 選んだコースの景観データを読み込む間の表示。失敗したときは内容と再試行ボタンを出す
import type { Route } from '../route/types';
import { loadOsmFor, OsmLoadSuperseded } from '../world/osm-town';

/**
 * 必要な区間データの読み込みを待つ。失敗したら画面に内容を出す。
 * 再試行はページの再読み込み: ブラウザーは失敗した dynamic import の結果を保持し、同じページのまま取り直せない。
 * コースの選択は保存済みなので、再読み込みしても同じコースを読む。
 * 別のコースの読み込みに追い越された場合（OsmLoadSuperseded）は、この起動処理を先へ進めない
 */
export async function loadCourseData(route: Route, load: (route: Route) => Promise<void> = loadOsmFor): Promise<void> {
  const panel = document.createElement('div');
  panel.id = 'courseLoad';
  panel.setAttribute('role', 'status');
  panel.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0f1822;color:#edf3f6;font:600 15px system-ui;text-align:center;padding:24px';
  const text = document.createElement('div');
  text.textContent = 'コースを読み込み中…';
  panel.append(text);
  document.body.appendChild(panel);
  try {
    await load(route);
  } catch (e) {
    if (e instanceof OsmLoadSuperseded) await new Promise<never>(() => {}); // 新しい読み込みが引き継ぐ。ここから先へは進めない
    console.error(e);
    panel.setAttribute('role', 'alert');
    text.textContent = `コースの読み込みに失敗した。${e instanceof Error ? e.message : String(e)}`;
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = '再試行（ページを再読み込み）';
    retry.style.cssText = 'padding:9px 20px;border:1px solid #ffffff60;border-radius:8px;background:#27466b;color:#fff;font:600 14px system-ui;cursor:pointer';
    retry.onclick = () => location.reload();
    panel.append(retry);
    await new Promise<never>(() => {}); // 読み込めないまま先へは進めない（表示は残す）
  }
  panel.remove();
}
