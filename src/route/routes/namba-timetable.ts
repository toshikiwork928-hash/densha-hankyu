// 南海本線 堺〜難波の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
/** 上り（堺 → 難波） */
export const NB: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 115, dep: 140 }, 2: { arr: 245, dep: 270 }, 3: { arr: 350, dep: 375 }, 4: { arr: 435, dep: 460 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 955 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 95 }, 2: { arr: 165 }, 3: { arr: 205 }, 4: { arr: 230 }, 5: { arr: 275 }, 6: { arr: 330, dep: 355 }, 7: { arr: 470, dep: 495 }, 8: { arr: 645 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 85 }, 2: { arr: 150 }, 3: { arr: 190 }, 4: { arr: 215 }, 5: { arr: 260 }, 6: { arr: 315, dep: 340 }, 7: { arr: 445, dep: 470 }, 8: { arr: 615 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 85 }, 2: { arr: 150 }, 3: { arr: 190 }, 4: { arr: 215 }, 5: { arr: 260 }, 6: { arr: 315, dep: 340 }, 7: { arr: 445, dep: 470 }, 8: { arr: 620 } },
  southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 95 }, 2: { arr: 165 }, 3: { arr: 205 }, 4: { arr: 230 }, 5: { arr: 275 }, 6: { arr: 330, dep: 355 }, 7: { arr: 470, dep: 495 }, 8: { arr: 645 } },
};

/** 下り（難波 → 堺） */
export const NB_UP: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 120, dep: 145 }, 2: { arr: 250, dep: 275 }, 3: { arr: 350, dep: 375 }, 4: { arr: 465, dep: 490 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 925 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 125, dep: 150 }, 2: { arr: 260, dep: 285 }, 3: { arr: 350 }, 4: { arr: 400 }, 5: { arr: 425 }, 6: { arr: 465 }, 7: { arr: 530 }, 8: { arr: 620 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 120, dep: 145 }, 2: { arr: 245, dep: 270 }, 3: { arr: 330 }, 4: { arr: 375 }, 5: { arr: 400 }, 6: { arr: 440 }, 7: { arr: 505 }, 8: { arr: 590 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 120, dep: 145 }, 2: { arr: 250, dep: 275 }, 3: { arr: 335 }, 4: { arr: 380 }, 5: { arr: 405 }, 6: { arr: 445 }, 7: { arr: 510 }, 8: { arr: 595 } },
  southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 125, dep: 150 }, 2: { arr: 260, dep: 285 }, 3: { arr: 350 }, 4: { arr: 400 }, 5: { arr: 425 }, 6: { arr: 465 }, 7: { arr: 530 }, 8: { arr: 620 } },
};
