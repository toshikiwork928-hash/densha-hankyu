// 南海本線 岸和田〜泉佐野の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
export const IT: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 85, dep: 110 }, 2: { arr: 220, dep: 245 }, 3: { arr: 360, dep: 385 }, 4: { arr: 460, dep: 485 }, 5: { arr: 570, dep: 595 }, 6: { arr: 720 } }, express: { 0: { arr: 0, dep: 0 }, 1: { arr: 65 }, 2: { arr: 160, dep: 185 }, 3: { arr: 285 }, 4: { arr: 320 }, 5: { arr: 360 }, 6: { arr: 450 } }, airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 55 }, 2: { arr: 145, dep: 170 }, 3: { arr: 260 }, 4: { arr: 295 }, 5: { arr: 335 }, 6: { arr: 440 } }, limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 60 }, 2: { arr: 130 }, 3: { arr: 195 }, 4: { arr: 230 }, 5: { arr: 270 }, 6: { arr: 375 } }, southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 65 }, 2: { arr: 140 }, 3: { arr: 205 }, 4: { arr: 240 }, 5: { arr: 280 }, 6: { arr: 370 } },
};
export const IT_UP: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 215, dep: 240 }, 3: { arr: 315, dep: 340 }, 4: { arr: 455, dep: 480 }, 5: { arr: 590, dep: 615 }, 6: { arr: 700 } }, express: { 0: { arr: 0, dep: 0 }, 1: { arr: 95 }, 2: { arr: 140 }, 3: { arr: 175 }, 4: { arr: 265, dep: 290 }, 5: { arr: 390 }, 6: { arr: 450 } }, airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 110 }, 2: { arr: 150 }, 3: { arr: 185 }, 4: { arr: 270, dep: 295 }, 5: { arr: 390 }, 6: { arr: 445 } }, limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 110 }, 2: { arr: 150 }, 3: { arr: 185 }, 4: { arr: 250 }, 5: { arr: 320 }, 6: { arr: 375 } }, southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 95 }, 2: { arr: 140 }, 3: { arr: 175 }, 4: { arr: 240 }, 5: { arr: 310 }, 6: { arr: 370 } },
};
