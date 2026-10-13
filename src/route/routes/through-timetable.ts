// 南海本線 堺〜岸和田（通し）の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
/** 下り（堺 → 岸和田） */
export const NT: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 445, dep: 470 }, 5: { arr: 540, dep: 565 }, 6: { arr: 685, dep: 750 }, 7: { arr: 845, dep: 870 }, 8: { arr: 950, dep: 975 }, 9: { arr: 1055, dep: 1156 }, 10: { arr: 1286, dep: 1311 }, 11: { arr: 1411, dep: 1436 }, 12: { arr: 1531, dep: 1556 }, 13: { arr: 1646 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 85 }, 2: { arr: 140 }, 3: { arr: 185 }, 4: { arr: 235 }, 5: { arr: 290, dep: 315 }, 6: { arr: 415 }, 7: { arr: 460 }, 8: { arr: 505 }, 9: { arr: 565, dep: 590 }, 10: { arr: 695 }, 11: { arr: 750 }, 12: { arr: 800 }, 13: { arr: 865 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 75 }, 2: { arr: 130 }, 3: { arr: 175 }, 4: { arr: 220 }, 5: { arr: 275, dep: 300 }, 6: { arr: 395 }, 7: { arr: 440 }, 8: { arr: 480 }, 9: { arr: 535, dep: 560 }, 10: { arr: 660 }, 11: { arr: 735, dep: 760 }, 12: { arr: 835 }, 13: { arr: 895 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 75 }, 2: { arr: 130 }, 3: { arr: 170 }, 4: { arr: 215 }, 5: { arr: 255 }, 6: { arr: 330 }, 7: { arr: 375 }, 8: { arr: 415 }, 9: { arr: 450 }, 10: { arr: 525 }, 11: { arr: 580 }, 12: { arr: 630 }, 13: { arr: 695 } },
  southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 85 }, 2: { arr: 140 }, 3: { arr: 185 }, 4: { arr: 235 }, 5: { arr: 275 }, 6: { arr: 350 }, 7: { arr: 395 }, 8: { arr: 435 }, 9: { arr: 470 }, 10: { arr: 550 }, 11: { arr: 605 }, 12: { arr: 655 }, 13: { arr: 720 } },
};

/** 上り（岸和田 → 堺） */
export const NT_UP: Record<Id, ServiceSpec['timetable']> = {
  local: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485, dep: 586 }, 5: { arr: 671, dep: 696 }, 6: { arr: 776, dep: 801 }, 7: { arr: 896, dep: 961 }, 8: { arr: 1081, dep: 1106 }, 9: { arr: 1181, dep: 1206 }, 10: { arr: 1291, dep: 1316 }, 11: { arr: 1406, dep: 1431 }, 12: { arr: 1531, dep: 1556 }, 13: { arr: 1661 } },
  express: { 0: { arr: 0, dep: 0 }, 1: { arr: 70 }, 2: { arr: 120 }, 3: { arr: 175 }, 4: { arr: 270, dep: 295 }, 5: { arr: 360 }, 6: { arr: 405 }, 7: { arr: 450 }, 8: { arr: 545, dep: 570 }, 9: { arr: 625 }, 10: { arr: 660 }, 11: { arr: 715 }, 12: { arr: 775 }, 13: { arr: 850 } },
  airport: { 0: { arr: 0, dep: 0 }, 1: { arr: 65 }, 2: { arr: 135, dep: 160 }, 3: { arr: 235 }, 4: { arr: 330, dep: 355 }, 5: { arr: 415 }, 6: { arr: 455 }, 7: { arr: 500 }, 8: { arr: 590, dep: 615 }, 9: { arr: 670 }, 10: { arr: 705 }, 11: { arr: 760 }, 12: { arr: 815 }, 13: { arr: 890 } },
  limited: { 0: { arr: 0, dep: 0 }, 1: { arr: 65 }, 2: { arr: 115 }, 3: { arr: 170 }, 4: { arr: 250 }, 5: { arr: 285 }, 6: { arr: 325 }, 7: { arr: 370 }, 8: { arr: 445 }, 9: { arr: 485 }, 10: { arr: 520 }, 11: { arr: 575 }, 12: { arr: 630 }, 13: { arr: 705 } },
  southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 70 }, 2: { arr: 120 }, 3: { arr: 175 }, 4: { arr: 255 }, 5: { arr: 290 }, 6: { arr: 335 }, 7: { arr: 380 }, 8: { arr: 455 }, 9: { arr: 495 }, 10: { arr: 530 }, 11: { arr: 585 }, 12: { arr: 645 }, 13: { arr: 720 } },
};
