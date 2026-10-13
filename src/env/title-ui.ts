// タイトル画面の環境設定パネル（時間帯 / 天候 / 強さ / 画質 / ランダム）
import './env.css';
import {
  QUALITIES, QUALITY_LABEL, TIMES, TIME_LABEL, WEATHERS, WEATHER_LABEL,
  type EnvSettings,
} from './settings';
import { mobileDisplay } from './settings';

export interface EnvPanelApi {
  get(): EnvSettings;
  set(p: Partial<EnvSettings>): void;
  random(): void;
}

export function buildEnvPanel(api: EnvPanelApi): HTMLElement {
  const root = document.createElement('div');
  root.className = 'env-panel';

  function seg<T extends string>(label: string, keys: T[], names: Record<T, string>, cur: () => T, apply: (k: T) => void): HTMLElement {
    const row = document.createElement('div'); row.className = 'env-row';
    row.innerHTML = `<span class="env-lbl">${label}</span>`;
    const box = document.createElement('div'); box.className = 'env-seg';
    for (const k of keys) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = names[k]; b.dataset.k = k;
      b.onclick = () => { apply(k); b.blur(); refresh(); };
      box.appendChild(b);
    }
    row.appendChild(box);
    (row as any).__sync = () => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === cur()));
    return row;
  }

  const rTime = seg('時間帯', TIMES, TIME_LABEL, () => api.get().timeOfDay, k => api.set({ timeOfDay: k }));
  const rWeather = seg('天候', WEATHERS, WEATHER_LABEL, () => api.get().weather, k => api.set({ weather: k }));
  const rQual = seg('画質', QUALITIES, QUALITY_LABEL, () => api.get().quality, k => api.set({ quality: k }));

  // 強さスライダー
  const rInt = document.createElement('div'); rInt.className = 'env-row';
  rInt.innerHTML = '<span class="env-lbl">強さ</span>';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.05';
  slider.oninput = () => api.set({ intensity: Number(slider.value) });
  slider.onchange = () => slider.blur();
  rInt.appendChild(slider);

  const rand = document.createElement('button'); rand.type = 'button'; rand.className = 'env-rand'; rand.textContent = 'ランダム';
  rand.onclick = () => { api.random(); rand.blur(); refresh(); };
  rQual.appendChild(rand);

  const hint = document.createElement('div'); hint.className = 'env-hint';
  hint.textContent = 'Shift+T 時間帯 / Shift+Y 天候 / X ワイパー（走行中も可）';
  if (mobileDisplay()) hint.textContent += '。スマホでは全画質で動的影なし・描画解像度を制限';

  root.append(rTime, rWeather, rInt, rQual, hint);

  function refresh() {
    for (const r of [rTime, rWeather, rQual]) (r as any).__sync();
    const s = api.get();
    slider.value = String(s.intensity);
    slider.disabled = s.weather === 'clear';
  }
  (root as any).__refresh = refresh;
  refresh();
  return root;
}

/** 既存パネルの表示を最新設定へ更新 */
export function refreshEnvPanels(): void {
  document.querySelectorAll('.env-panel').forEach(p => (p as any).__refresh?.());
}
