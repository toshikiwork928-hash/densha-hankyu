// 泉佐野以南の2コースの、時間帯ごとの普通の時刻表（尾崎の緩急接続の待ち時間込み。scripts/timetable.ts --south-only が生成。手で直さない）
import type { ServiceSpec, TimeOfDay } from '../types';

export const SOUTH_LOCAL_TT: Record<string, Partial<Record<TimeOfDay, ServiceSpec['timetable']>>> = {
  'izumisano-misaki': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 155, dep: 180 }, 2: { arr: 275, dep: 300 }, 3: { arr: 400, dep: 425 }, 4: { arr: 540, dep: 565 }, 5: { arr: 755, dep: 854 }, 6: { arr: 964, dep: 989 }, 7: { arr: 1130, dep: 1155 }, 8: { arr: 1370, dep: 1395 }, 9: { arr: 1525 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 155, dep: 180 }, 2: { arr: 275, dep: 300 }, 3: { arr: 400, dep: 425 }, 4: { arr: 540, dep: 565 }, 5: { arr: 755, dep: 856 }, 6: { arr: 966, dep: 991 }, 7: { arr: 1130, dep: 1155 }, 8: { arr: 1370, dep: 1395 }, 9: { arr: 1525 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 155, dep: 180 }, 2: { arr: 275, dep: 300 }, 3: { arr: 400, dep: 425 }, 4: { arr: 540, dep: 565 }, 5: { arr: 755, dep: 856 }, 6: { arr: 966, dep: 991 }, 7: { arr: 1130, dep: 1155 }, 8: { arr: 1370, dep: 1395 }, 9: { arr: 1525 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 155, dep: 180 }, 2: { arr: 275, dep: 300 }, 3: { arr: 400, dep: 425 }, 4: { arr: 540, dep: 565 }, 5: { arr: 755, dep: 854 }, 6: { arr: 964, dep: 989 }, 7: { arr: 1130, dep: 1155 }, 8: { arr: 1370, dep: 1395 }, 9: { arr: 1525 } },
  },
  'izumisano-misaki-up': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 110, dep: 135 }, 2: { arr: 335, dep: 360 }, 3: { arr: 515, dep: 540 }, 4: { arr: 650, dep: 749 }, 5: { arr: 904, dep: 929 }, 6: { arr: 1044, dep: 1069 }, 7: { arr: 1190, dep: 1215 }, 8: { arr: 1310, dep: 1335 }, 9: { arr: 1495 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 110, dep: 135 }, 2: { arr: 335, dep: 360 }, 3: { arr: 515, dep: 540 }, 4: { arr: 650, dep: 751 }, 5: { arr: 906, dep: 931 }, 6: { arr: 1046, dep: 1071 }, 7: { arr: 1190, dep: 1215 }, 8: { arr: 1310, dep: 1335 }, 9: { arr: 1495 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 110, dep: 135 }, 2: { arr: 335, dep: 360 }, 3: { arr: 500, dep: 525 }, 4: { arr: 635, dep: 660 }, 5: { arr: 815, dep: 840 }, 6: { arr: 970, dep: 995 }, 7: { arr: 1110, dep: 1135 }, 8: { arr: 1235, dep: 1260 }, 9: { arr: 1405 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 110, dep: 135 }, 2: { arr: 335, dep: 360 }, 3: { arr: 515, dep: 540 }, 4: { arr: 650, dep: 751 }, 5: { arr: 906, dep: 931 }, 6: { arr: 1046, dep: 1071 }, 7: { arr: 1190, dep: 1215 }, 8: { arr: 1310, dep: 1335 }, 9: { arr: 1495 } },
  },
};
