// 音量設定（localStorage に保存）とタイトル画面の音量 UI
export type TractionSound = 'soft' | 'legacy';
export interface AudioSettings { master: number; sfx: number; voice: number; muted: boolean; traction: TractionSound }

const KEY = 'densha-one-station.audio';
const DEFAULTS: AudioSettings = { master: .8, sfx: 1, voice: .9, muted: false, traction: 'soft' };

export interface SettingsStore {
  readonly value: AudioSettings;
  set(patch: Partial<AudioSettings>): void;
  onChange(fn: (s: AudioSettings) => void): void;
}

export function createSettings(): SettingsStore {
  let value: AudioSettings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<AudioSettings>;
      const num = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
      value = { master: num(o.master, DEFAULTS.master), sfx: num(o.sfx, DEFAULTS.sfx), voice: num(o.voice, DEFAULTS.voice), muted: o.muted === true, traction: o.traction === 'legacy' ? 'legacy' : 'soft' };
    }
  } catch { /* 保存領域が使えない環境 */ }
  const fns: ((s: AudioSettings) => void)[] = [];
  return {
    get value() { return value; },
    set(patch) {
      value = { ...value, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* 無視 */ }
      for (const f of fns) f(value);
    },
    onChange(fn) { fns.push(fn); },
  };
}

/** タイトルカード（サウンドタブ）へ追加する音量パネル。見た目は環境パネル（env-row）に合わせる */
export function renderSettingsUi(container: HTMLElement, store: SettingsStore): void {
  container.querySelector('.audio-settings')?.remove();
  const box = document.createElement('div');
  box.className = 'audio-settings env-panel-like';
  const row = (label: string, key: 'master' | 'sfx' | 'voice') => {
    const l = document.createElement('label'); l.className = 'env-row';
    const name = document.createElement('span'); name.className = 'env-lbl'; name.textContent = label;
    const r = document.createElement('input');
    r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.05'; r.value = String(store.value[key]);
    r.setAttribute('aria-label', label + '音量');
    r.addEventListener('input', () => store.set({ [key]: Number(r.value) }));
    // スライダー操作中のキー入力をゲームへ渡さない（Enter/Space 以外）
    r.addEventListener('keydown', e => { if (e.code !== 'Enter' && e.code !== 'Space') e.stopPropagation(); });
    r.addEventListener('change', () => r.blur());
    l.append(name, r);
    return l;
  };
  const mute = document.createElement('label'); mute.className = 'env-row';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = store.value.muted;
  cb.addEventListener('change', () => { store.set({ muted: cb.checked }); cb.blur(); });
  store.onChange(s => { if (cb.isConnected) cb.checked = s.muted; });
  const ml = document.createElement('span'); ml.className = 'env-lbl'; ml.textContent = '消音';
  mute.append(ml, cb, '（M キーでも切替）');
  const traction = document.createElement('label'); traction.className = 'env-row';
  const tl = document.createElement('span'); tl.className = 'env-lbl'; tl.textContent = '走行音';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'VVVF走行音');
  for (const [value, label] of [['soft', '改良（柔らかい音）'], ['legacy', '従来（比較用）']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }
  select.value = store.value.traction;
  select.addEventListener('change', () => { store.set({ traction: select.value as TractionSound }); select.blur(); });
  select.addEventListener('keydown', e => e.stopPropagation());
  traction.append(tl, select);
  const hint = document.createElement('div'); hint.className = 'env-hint';
  hint.textContent = '走行音は独自合成。実車録音ではありません。改良／従来を切り替えて比較できます（VVVF車のみ）。放送は端末・ブラウザの日本語音声です。';
  box.append(row('全体', 'master'), row('効果音', 'sfx'), row('放送', 'voice'), mute, traction);
  box.append(hint);
  container.append(box);
}
