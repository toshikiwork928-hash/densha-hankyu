// 環境設定（時間帯・天候・画質）の型・既定値・保存
import type { EnvState, TimeOfDay, Weather } from '../core/events';

export type Quality = 'low' | 'mid' | 'high';

export interface EnvSettings extends EnvState { quality: Quality }

export const TIMES: TimeOfDay[] = ['morning', 'noon', 'evening', 'night'];
export const WEATHERS: Weather[] = ['clear', 'rain', 'snow', 'fog'];
export const QUALITIES: Quality[] = ['low', 'mid', 'high'];

export const TIME_LABEL: Record<TimeOfDay, string> = { morning: '朝', noon: '昼', evening: '夕', night: '夜' };
export const WEATHER_LABEL: Record<Weather, string> = { clear: '晴れ', rain: '雨', snow: '雪', fog: '霧' };
export const QUALITY_LABEL: Record<Quality, string> = { low: '低', mid: '中', high: '高' };

/** 画質ごとの設定値 */
export const QUALITY_SPEC: Record<Quality, {
  pixelRatio: number; shadows: boolean; shadowSize: number; castBudget: number; rain: number; snow: number; drops: number; cloudOctaves: number;
}> = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 0, castBudget: 0, rain: 2500, snow: 1500, drops: 70, cloudOctaves: 3 },
  mid: { pixelRatio: 1.5, shadows: true, shadowSize: 1024, castBudget: 120_000, rain: 6000, snow: 3500, drops: 140, cloudOctaves: 4 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, castBudget: 600_000, rain: 12000, snow: 7000, drops: 220, cloudOctaves: 5 },
};

const KEY = 'densha.env.v1';

export function mobileDisplay(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  } catch { /* 無視 */ }
  return false;
}

/** スマホの中・高は雲や天候表現を上げる。動的影と高DPRはGPU負荷を抑えるため使わない。 */
export function qualitySpec(quality: Quality, mobile = mobileDisplay()): typeof QUALITY_SPEC[Quality] {
  const spec = QUALITY_SPEC[quality];
  return mobile ? { ...spec, pixelRatio: 1, shadows: false, shadowSize: 0, castBudget: 0 } : spec;
}

export function loadSettings(): EnvSettings {
  const def: EnvSettings = { timeOfDay: 'noon', weather: 'clear', intensity: .6, quality: mobileDisplay() ? 'low' : 'mid' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const o = JSON.parse(raw) as Partial<EnvSettings>;
    return {
      timeOfDay: TIMES.includes(o.timeOfDay as TimeOfDay) ? o.timeOfDay! : def.timeOfDay,
      weather: WEATHERS.includes(o.weather as Weather) ? o.weather! : def.weather,
      intensity: typeof o.intensity === 'number' ? Math.max(0, Math.min(1, o.intensity)) : def.intensity,
      quality: QUALITIES.includes(o.quality as Quality) ? o.quality! : def.quality,
    };
  } catch { return def; }
}

export function saveSettings(s: EnvSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存不可は無視 */ }
}

/** 天候ごとの粘着係数（雨 0.8・雪 0.65 が強さ最大時） */
export function adhesionFor(w: Weather, intensity: number): number {
  if (w === 'rain') return .9 - .1 * intensity;
  if (w === 'snow') return .78 - .13 * intensity;
  return 1;
}
