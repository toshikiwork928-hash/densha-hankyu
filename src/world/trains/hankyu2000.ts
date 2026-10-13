// 阪急2000系（2代目）の塗装。形（ジオメトリ）は通勤形 new（commuter.ts）を流用し、側面・前面のシートだけを描く。
// 外観の要点（公開の写真・報道から）: 車体はマルーン、屋根肩はアイボリー、片側3扉、窓は銀の枠。前面は黒い窓まわり。
// 扉位置・窓寸法・色の値は実測ではなくゲーム用の概形。
import { Y0, faceSheet, sideSheet, type SheetMaps, type V2 } from './common';
import { HW, YTOP } from './commuter';

const MAROON = '#5c1a1f', MAROON_D = '#3f1014', IVORY = '#e9e2cc', FRAME = '#b9bcc0';
const WIN: V2 = [2.0, 2.95];
const DOOR_W = 1.3;

/** 側面（head = 先頭車。前端 = -Z 側に乗務員扉）。open = 客用ドアを開けた状態 */
export function paintHankyuSide(Lb: number, head: boolean, open = false): SheetMaps {
  const s = sideSheet(Lb, YTOP), hz = Lb / 2;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, MAROON); grd.addColorStop(1, MAROON_D);
  s.base(grd, .28, .2);
  s.rect(-hz - 1, hz + 1, 3.3, YTOP + .1, IVORY, .35, .1); // 屋根肩のアイボリー
  s.rect(-hz - 1, hz + 1, 3.26, 3.3, '#8a7f66', .4, .1);
  const doors = [-6.1, 0, 6.1].map(z => head && z < 0 ? z + .3 : z);
  const [w0, w1] = WIN;
  for (const zc of doors) {
    if (open) {
      s.glass(zc - DOOR_W / 2, zc + DOOR_W / 2, 1.16, 3.05, '', 0, ['#4a463e', '#23262b']);
      s.rect(zc - DOOR_W / 2, zc + DOOR_W / 2, 1.16, 1.3, '#5b5f66', .6, .1);
      s.emit(zc - DOOR_W / 2, zc + DOOR_W / 2, 1.16, 3.05, s.emitGrad(1.3, 3.05, '#ffffff', '#6a5e48'));
      s.emit(zc - DOOR_W / 2, zc + DOOR_W / 2, 1.16, 1.3, '#000');
      continue;
    }
    s.rect(zc - DOOR_W / 2 - .03, zc + DOOR_W / 2 + .03, 1.13, 3.08, '#2e0c0f', .5, .2);
    s.rect(zc - DOOR_W / 2, zc + DOOR_W / 2, 1.16, 3.05, MAROON, .28, .2);
    s.rect(zc - .012, zc + .012, 1.16, 3.05, '#24090b');
    for (const sg of [-1, 1]) s.glass(zc + sg * DOOR_W / 4 - .22, zc + sg * DOOR_W / 4 + .22, w0, w1, '#3e4248', .05);
  }
  // 側窓（戸間は2枚、車端は1枚）。銀の枠
  const win = (z0: number, z1: number) => {
    s.rect(z0 - .05, z1 + .05, w0 - .05, w1 + .05, FRAME, .3, .8, .04);
    s.glass(z0, z1, w0, w1, '', .04);
  };
  for (let i = 0; i + 1 < doors.length; i++) {
    const a = doors[i] + DOOR_W / 2 + .35, b = doors[i + 1] - DOOR_W / 2 - .35, m = (a + b) / 2;
    win(a, m - .05); win(m + .05, b);
  }
  win(doors[2] + DOOR_W / 2 + .35, hz - .5);
  if (head) {
    const crew = -hz + .6;
    s.rect(crew - .32, crew + .32, 1.16, 3.05, MAROON, .28, .2);
    s.glass(crew - .2, crew + .2, w0, w1, '#3e4248', .03);
    win(crew + .55, doors[0] - DOOR_W / 2 - .3);
  } else win(-hz + .5, doors[0] - DOOR_W / 2 - .35);
  return s.textures();
}

/** 前面シート */
export function paintHankyuFace(): SheetMaps {
  const s = faceSheet(HW, YTOP);
  s.base(MAROON, .28, .2);
  s.rect(-HW, HW, 3.3, YTOP + .1, IVORY, .35, .1);
  // 窓まわりの黒い面と前面窓（左右）・中央の貫通扉の窓
  s.rect(-HW + .1, HW - .1, 2.0, 3.2, '#111316', .18, .3, .06);
  s.glass(.45, 1.25, 2.15, 3.12, '', .03, ['#2e3a46', '#10151b']);
  s.glass(-1.25, -.45, 2.15, 3.12, '', .03, ['#2e3a46', '#10151b']);
  s.glass(-.3, .3, 2.15, 3.12, '', .03, ['#2e3a46', '#10151b']);
  // 行先表示（左上）・種別表示（右上）の枠
  s.rect(.5, 1.2, 2.85, 3.08, '#0b0c0e', .3, 0, .02);
  s.rect(-1.2, -.5, 2.85, 3.08, '#0b0c0e', .3, 0, .02);
  s.text('2000', 0, 1.7, .18, '#e9e2cc', 600);
  s.rect(-HW, HW, Y0, 1.1, '#3a1013', .4, .2);
  s.emit(-HW, HW, Y0, YTOP + .1, '#000');
  return s.textures();
}
