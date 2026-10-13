// 時間帯ごとの普通の時刻表（待避で停車時間が変わる。scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec, TimeOfDay } from '../types';

export const LOCAL_TT: Record<string, Partial<Record<TimeOfDay, ServiceSpec['timetable']>>> = {
  'shiokaze': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 85, dep: 110 }, 2: { arr: 190, dep: 215 }, 3: { arr: 305, dep: 330 }, 4: { arr: 440, dep: 465 }, 5: { arr: 540, dep: 703 }, 6: { arr: 788, dep: 813 }, 7: { arr: 903, dep: 928 }, 8: { arr: 1028, dep: 1053 }, 9: { arr: 1158 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 85, dep: 110 }, 2: { arr: 190, dep: 215 }, 3: { arr: 310, dep: 375 }, 4: { arr: 495, dep: 520 }, 5: { arr: 595, dep: 620 }, 6: { arr: 705, dep: 730 }, 7: { arr: 820, dep: 845 }, 8: { arr: 945, dep: 970 }, 9: { arr: 1075 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 85, dep: 110 }, 2: { arr: 190, dep: 215 }, 3: { arr: 305, dep: 330 }, 4: { arr: 440, dep: 465 }, 5: { arr: 540, dep: 565 }, 6: { arr: 650, dep: 675 }, 7: { arr: 765, dep: 790 }, 8: { arr: 890, dep: 915 }, 9: { arr: 1020 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 85, dep: 110 }, 2: { arr: 190, dep: 215 }, 3: { arr: 305, dep: 330 }, 4: { arr: 440, dep: 465 }, 5: { arr: 540, dep: 565 }, 6: { arr: 650, dep: 675 }, 7: { arr: 765, dep: 790 }, 8: { arr: 890, dep: 915 }, 9: { arr: 1020 } },
  },
  'shiokaze-up': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 455, dep: 522 }, 5: { arr: 602, dep: 627 }, 6: { arr: 747, dep: 812 }, 7: { arr: 907, dep: 932 }, 8: { arr: 1012, dep: 1037 }, 9: { arr: 1117 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 445, dep: 470 }, 5: { arr: 540, dep: 565 }, 6: { arr: 685, dep: 750 }, 7: { arr: 845, dep: 870 }, 8: { arr: 950, dep: 975 }, 9: { arr: 1055 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 455, dep: 520 }, 5: { arr: 600, dep: 625 }, 6: { arr: 735, dep: 760 }, 7: { arr: 850, dep: 875 }, 8: { arr: 955, dep: 980 }, 9: { arr: 1060 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 455, dep: 616 }, 5: { arr: 696, dep: 721 }, 6: { arr: 831, dep: 856 }, 7: { arr: 946, dep: 971 }, 8: { arr: 1051, dep: 1076 }, 9: { arr: 1156 } },
  },
  'kishiwada-up': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485 } },
  },
  'izumisano-up': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 215, dep: 240 }, 3: { arr: 315, dep: 340 }, 4: { arr: 455, dep: 480 }, 5: { arr: 590, dep: 615 }, 6: { arr: 700 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 215, dep: 240 }, 3: { arr: 315, dep: 340 }, 4: { arr: 455, dep: 480 }, 5: { arr: 590, dep: 615 }, 6: { arr: 700 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 215, dep: 240 }, 3: { arr: 315, dep: 340 }, 4: { arr: 455, dep: 480 }, 5: { arr: 590, dep: 615 }, 6: { arr: 700 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 215, dep: 240 }, 3: { arr: 315, dep: 340 }, 4: { arr: 455, dep: 480 }, 5: { arr: 590, dep: 615 }, 6: { arr: 700 } },
  },
  'nankai-through-up': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 455, dep: 522 }, 5: { arr: 602, dep: 627 }, 6: { arr: 747, dep: 812 }, 7: { arr: 907, dep: 932 }, 8: { arr: 1012, dep: 1037 }, 9: { arr: 1117, dep: 1216 }, 10: { arr: 1346, dep: 1371 }, 11: { arr: 1471, dep: 1496 }, 12: { arr: 1591, dep: 1616 }, 13: { arr: 1706 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 445, dep: 470 }, 5: { arr: 540, dep: 565 }, 6: { arr: 685, dep: 750 }, 7: { arr: 845, dep: 870 }, 8: { arr: 950, dep: 975 }, 9: { arr: 1055, dep: 1156 }, 10: { arr: 1286, dep: 1311 }, 11: { arr: 1411, dep: 1436 }, 12: { arr: 1531, dep: 1556 }, 13: { arr: 1646 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 455, dep: 520 }, 5: { arr: 600, dep: 625 }, 6: { arr: 735, dep: 760 }, 7: { arr: 850, dep: 875 }, 8: { arr: 955, dep: 980 }, 9: { arr: 1060, dep: 1257 }, 10: { arr: 1387, dep: 1412 }, 11: { arr: 1512, dep: 1537 }, 12: { arr: 1632, dep: 1657 }, 13: { arr: 1747 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 105, dep: 130 }, 2: { arr: 230, dep: 255 }, 3: { arr: 335, dep: 360 }, 4: { arr: 455, dep: 616 }, 5: { arr: 696, dep: 721 }, 6: { arr: 831, dep: 856 }, 7: { arr: 946, dep: 971 }, 8: { arr: 1051, dep: 1076 }, 9: { arr: 1156, dep: 1355 }, 10: { arr: 1485, dep: 1510 }, 11: { arr: 1610, dep: 1635 }, 12: { arr: 1730, dep: 1755 }, 13: { arr: 1845 } },
  },
  'nankai-through': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485, dep: 584 }, 5: { arr: 669, dep: 694 }, 6: { arr: 774, dep: 799 }, 7: { arr: 889, dep: 914 }, 8: { arr: 1024, dep: 1049 }, 9: { arr: 1124, dep: 1287 }, 10: { arr: 1372, dep: 1397 }, 11: { arr: 1487, dep: 1512 }, 12: { arr: 1612, dep: 1637 }, 13: { arr: 1742 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485, dep: 586 }, 5: { arr: 671, dep: 696 }, 6: { arr: 776, dep: 801 }, 7: { arr: 896, dep: 961 }, 8: { arr: 1081, dep: 1106 }, 9: { arr: 1181, dep: 1206 }, 10: { arr: 1291, dep: 1316 }, 11: { arr: 1406, dep: 1431 }, 12: { arr: 1531, dep: 1556 }, 13: { arr: 1661 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485, dep: 680 }, 5: { arr: 765, dep: 790 }, 6: { arr: 870, dep: 895 }, 7: { arr: 985, dep: 1010 }, 8: { arr: 1120, dep: 1145 }, 9: { arr: 1220, dep: 1245 }, 10: { arr: 1330, dep: 1355 }, 11: { arr: 1445, dep: 1470 }, 12: { arr: 1570, dep: 1595 }, 13: { arr: 1700 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 90, dep: 115 }, 2: { arr: 210, dep: 235 }, 3: { arr: 335, dep: 360 }, 4: { arr: 485, dep: 680 }, 5: { arr: 765, dep: 790 }, 6: { arr: 870, dep: 895 }, 7: { arr: 985, dep: 1010 }, 8: { arr: 1120, dep: 1145 }, 9: { arr: 1220, dep: 1245 }, 10: { arr: 1330, dep: 1355 }, 11: { arr: 1445, dep: 1470 }, 12: { arr: 1570, dep: 1595 }, 13: { arr: 1700 } },
  },
  'namba': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 115, dep: 140 }, 2: { arr: 245, dep: 270 }, 3: { arr: 350, dep: 375 }, 4: { arr: 435, dep: 460 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 955 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 115, dep: 140 }, 2: { arr: 245, dep: 270 }, 3: { arr: 350, dep: 375 }, 4: { arr: 435, dep: 460 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 955 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 115, dep: 140 }, 2: { arr: 245, dep: 270 }, 3: { arr: 350, dep: 375 }, 4: { arr: 435, dep: 460 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 955 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 115, dep: 140 }, 2: { arr: 245, dep: 270 }, 3: { arr: 350, dep: 375 }, 4: { arr: 435, dep: 460 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 955 } },
  },
  'namba-up': {
    morning: { 0: { arr: 0, dep: 0 }, 1: { arr: 120, dep: 145 }, 2: { arr: 250, dep: 275 }, 3: { arr: 350, dep: 375 }, 4: { arr: 465, dep: 490 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 925 } },
    noon: { 0: { arr: 0, dep: 0 }, 1: { arr: 120, dep: 145 }, 2: { arr: 250, dep: 275 }, 3: { arr: 350, dep: 375 }, 4: { arr: 465, dep: 490 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 925 } },
    evening: { 0: { arr: 0, dep: 0 }, 1: { arr: 120, dep: 145 }, 2: { arr: 250, dep: 275 }, 3: { arr: 350, dep: 375 }, 4: { arr: 465, dep: 490 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 925 } },
    night: { 0: { arr: 0, dep: 0 }, 1: { arr: 120, dep: 145 }, 2: { arr: 250, dep: 275 }, 3: { arr: 350, dep: 375 }, 4: { arr: 465, dep: 490 }, 5: { arr: 550, dep: 575 }, 6: { arr: 655, dep: 680 }, 7: { arr: 785, dep: 810 }, 8: { arr: 925 } },
  },
};
