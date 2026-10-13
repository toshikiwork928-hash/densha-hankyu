// 描画の切替（標準 / イラスト）。ボタンと URL の ?look= を扱う。
// イラスト専用の処理（render/illustrated.ts）は、イラストを選んだ時だけ読み込んで有効にする。標準で始めた場合は最後まで読み込まない。
import type { GameContext } from '../core/context';
import type { IllustratedLook } from './illustrated';

type LookName = 'illustrated' | 'standard';
type IllustratedModule = typeof import('./illustrated');

/** URL の ?look=。standard だけが標準。それ以外（無指定を含む）はイラスト */
const lookFromUrl = (): LookName => new URL(location.href).searchParams.get('look') === 'standard' ? 'standard' : 'illustrated';

let loading: Promise<IllustratedModule> | undefined;
let loaded: IllustratedModule | undefined;
function loadIllustrated(): Promise<IllustratedModule> {
  loading ??= import('./illustrated').then(m => (loaded = m), e => { loading = undefined; throw e; });
  return loading;
}

/**
 * 起動時、最初の見た目がイラストなら加工コードの取得を先に始めておく。標準で始めるなら何も読まない。
 * 待たない: 起動処理（main.ts の top-level await）の完了を待たずに読み込むだけ。イラストのチャンクは本体のチャンクを import するため、
 * main.ts がここで待つと互いに待ち合って起動しない（ビルド版のみ）
 */
export function preloadLook(): void {
  if (lookFromUrl() === 'illustrated') loadIllustrated().catch(e => console.error(e));
}

export function attachLookSwitch(ctx: GameContext): void {
  let current: LookName = 'standard';
  let active: IllustratedLook | undefined;
  let busy = false, failed = false;
  /** 切替の要求番号。読み込み中にさらに切り替えられたら古い要求は何もしない */
  let request = 0;
  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:30;padding:7px 12px;border:1px solid #ffffff40;border-radius:8px;background:#14202de0;color:#edf3f6;font:600 12px system-ui;cursor:pointer';
  button.title = '描画を切替。走行状態はそのまま';
  const refresh = () => {
    button.textContent = busy ? '描画：読み込み中…' : failed ? '描画：標準（イラストを読めない。もう一度押す）' : current === 'illustrated' ? '描画：イラスト' : '描画：標準';
    button.setAttribute('aria-pressed', String(current === 'illustrated'));
  };

  /** 見た目を切り替える。戻り値は反映できたか。標準では何も作らない／作ったものを全部片付ける */
  async function select(next: LookName): Promise<boolean> {
    const mine = ++request;
    if (next === 'standard') {
      active?.dispose(); active = undefined;
      current = 'standard'; busy = failed = false; refresh();
      return true;
    }
    if (!loaded) {
      busy = true; failed = false; refresh();
      try { await loadIllustrated(); } catch (e) {
        console.error(e);
        if (mine === request) { busy = false; failed = true; refresh(); }
        return false;
      }
      if (mine !== request) return false;
      busy = false;
    }
    active ??= loaded!.enableIllustratedLook(ctx);
    current = 'illustrated'; failed = false; refresh();
    return true;
  }

  button.addEventListener('click', () => {
    const next: LookName = current === 'illustrated' ? 'standard' : 'illustrated';
    void select(next).then(ok => {
      if (!ok) return;
      const url = new URL(location.href);
      url.searchParams.set('look', next);
      history.replaceState(null, '', url);
    });
  });
  refresh(); document.body.appendChild(button);
  void select(lookFromUrl());
}
