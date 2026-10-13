// 高野線の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

/** 下り（橋本 → 極楽橋） */
export const MT: Record<'local', ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 175, dep: 200 }, 2: { arr: 440, dep: 470 }, 3: { arr: 695, dep: 720 }, 4: { arr: 915 } },
};

/** 上り（極楽橋 → 橋本） */
export const MT_UP: Record<'local', ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 185, dep: 210 }, 2: { arr: 420, dep: 450 }, 3: { arr: 670, dep: 695 }, 4: { arr: 865 } },
};
