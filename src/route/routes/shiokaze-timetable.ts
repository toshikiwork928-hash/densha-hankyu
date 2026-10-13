// 南海本線の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

/** 下り（桜ヶ丘 → 岬口） */
export const TT: Record<'local' | 'express' | 'airport' | 'limited', ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 85, dep: 110 }, 2: { arr: 190, dep: 215 }, 3: { arr: 310, dep: 375 }, 4: { arr: 495, dep: 520 }, 5: { arr: 595, dep: 620 }, 6: { arr: 705, dep: 730 }, 7: { arr: 820, dep: 845 }, 8: { arr: 945, dep: 970 }, 9: { arr: 1075 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 65 }, 2: { arr: 110 }, 3: { arr: 155 }, 4: { arr: 250, dep: 275 }, 5: { arr: 330 }, 6: { arr: 365 }, 7: { arr: 420 }, 8: { arr: 480 }, 9: { arr: 555 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 60 }, 2: { arr: 105 }, 3: { arr: 150 }, 4: { arr: 240, dep: 265 }, 5: { arr: 320 }, 6: { arr: 355 }, 7: { arr: 410 }, 8: { arr: 465 }, 9: { arr: 535 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 60 }, 2: { arr: 100 }, 3: { arr: 145 }, 4: { arr: 215 }, 5: { arr: 255 }, 6: { arr: 290 }, 7: { arr: 345 }, 8: { arr: 400 }, 9: { arr: 475 } },
};

/** 上り（岬口 → 桜ヶ丘） */
export const TT_UP: Record<'local' | 'express' | 'airport' | 'limited', ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 445, dep: 470 }, 5: { arr: 540, dep: 565 }, 6: { arr: 685, dep: 750 }, 7: { arr: 845, dep: 870 }, 8: { arr: 950, dep: 975 }, 9: { arr: 1055 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 85 }, 2: { arr: 140 }, 3: { arr: 185 }, 4: { arr: 235 }, 5: { arr: 290, dep: 315 }, 6: { arr: 415 }, 7: { arr: 460 }, 8: { arr: 505 }, 9: { arr: 565 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 75 }, 2: { arr: 130 }, 3: { arr: 175 }, 4: { arr: 220 }, 5: { arr: 275, dep: 300 }, 6: { arr: 395 }, 7: { arr: 440 }, 8: { arr: 480 }, 9: { arr: 535 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 75 }, 2: { arr: 130 }, 3: { arr: 170 }, 4: { arr: 215 }, 5: { arr: 255 }, 6: { arr: 330 }, 7: { arr: 375 }, 8: { arr: 415 }, 9: { arr: 470 } },
};
