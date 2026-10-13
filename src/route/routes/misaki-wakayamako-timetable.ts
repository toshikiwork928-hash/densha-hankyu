// 南海本線 みさき公園〜和歌山港の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'southern';
/** 下り（みさき公園 → 和歌山港） */
export const MWT: Record<Id, ServiceSpec['timetable']> = { local: { 0: { arr: 0, dep: 0 }, 1: { arr: 260, dep: 285 }, 2: { arr: 400, dep: 425 }, 3: { arr: 620, dep: 645 }, 4: { arr: 815, dep: 840 }, 5: { arr: 1070 } }, express: { 0: { arr: 0, dep: 0 }, 1: { arr: 250 }, 2: { arr: 355, dep: 380 }, 3: { arr: 550 }, 4: { arr: 695, dep: 720 }, 5: { arr: 955 } }, southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 255 }, 2: { arr: 360, dep: 385 }, 3: { arr: 560 }, 4: { arr: 705, dep: 730 }, 5: { arr: 965 } } };
/** 上り（和歌山港 → みさき公園） */
export const MWT_UP: Record<Id, ServiceSpec['timetable']> = { local: { 0: { arr: 0, dep: 0 }, 1: { arr: 185, dep: 210 }, 2: { arr: 365, dep: 390 }, 3: { arr: 590, dep: 615 }, 4: { arr: 735, dep: 760 }, 5: { arr: 1015 } }, express: { 0: { arr: 0, dep: 0 }, 1: { arr: 190, dep: 215 }, 2: { arr: 355 }, 3: { arr: 535, dep: 560 }, 4: { arr: 675 }, 5: { arr: 920 } }, southern: { 0: { arr: 0, dep: 0 }, 1: { arr: 190, dep: 215 }, 2: { arr: 355 }, 3: { arr: 535, dep: 560 }, 4: { arr: 675 }, 5: { arr: 925 } } };
