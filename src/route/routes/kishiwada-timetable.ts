// 南海本線 泉大津〜岸和田の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
/** 下り（泉大津 → 岸和田） */
export const KT: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 130, dep: 155 }, 2: { arr: 255, dep: 280 }, 3: { arr: 375, dep: 400 }, 4: { arr: 490 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 105 }, 2: { arr: 160 }, 3: { arr: 210 }, 4: { arr: 275 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 95 }, 2: { arr: 170, dep: 195 }, 3: { arr: 270 }, 4: { arr: 330 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 100 }, 2: { arr: 155 }, 3: { arr: 205 }, 4: { arr: 270 } },
  southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 105 }, 2: { arr: 160 }, 3: { arr: 210 }, 4: { arr: 275 } },
};

/** 上り（岸和田 → 泉大津） */
export const KT_UP: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 70 }, 2: { arr: 120 }, 3: { arr: 175 }, 4: { arr: 270 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 65 }, 2: { arr: 135, dep: 160 }, 3: { arr: 235 }, 4: { arr: 330 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 65 }, 2: { arr: 115 }, 3: { arr: 170 }, 4: { arr: 265 } },
  southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 70 }, 2: { arr: 120 }, 3: { arr: 175 }, 4: { arr: 270 } },
};
