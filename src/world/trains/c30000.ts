// 30000系（特急こうや。モブ）: 17m 級・4両・片側1か所の扉。白（アイボリー）と赤の塗り分け
//  側面: 窓の高さまでは白（屋根の下に赤の細線）、窓の下から裾までは赤で、中に白の細線が2本
//  前面: 非貫通。大きな曲面ガラスが上半分を占めて後ろへ傾き、角は丸く回り込む。ガラスの下は 赤帯・白線・赤帯（中央に愛称表示、
//        左右に四角い灯具 = 上が前照灯・下が尾灯）・白線・赤
import * as THREE from 'three';
import { GeoBatch, M, P } from '../batch';
import {
  Y0, adder, addEndWall, addLozenge, addUnderfloor, capGeo, faceSheet, shellGeo, sideSheet,
  type CarKind, type CarParts, type Ring, type SheetMaps, type V2,
} from './common';
import { applySlant, paintDoor, slantLed, slantRings, slantZ, type Slant } from './c1000';

export const HW_30 = 1.4;
const YTOP = 3.8, ROOF_Y = 3.5;
const HALF: V2[] = [[1.32, Y0], [1.4, 1.45], [1.4, 3.38], [1.35, 3.54], [1.1, 3.67], [.65, 3.76], [0, YTOP]];
const SL: Slant = { depth: .75, bow: .5, hw: HW_30, ytop: YTOP };
const R = .3;
const IVORY = ['#f6f2e8', '#e4dfd2'] as const, RED = '#c4141e', RED_D = '#7a1414';
/** 側面: 赤の上端・白の細線（2本）・屋根の下の赤の細線・窓の上下 */
const RED_TOP = 2.0, STRIPE: V2 = [1.72, 1.8], STRIPE2: V2 = [1.18, 1.24], TOP_LINE: V2 = [3.24, 3.31], WIN: V2 = [2.1, 2.96];
/** 前面: ガラスの下端、上の赤帯の下端（= 白線の上端） */
const SHIELD: V2 = [2.16, 3.42];
/** 扉（先頭車は運転台の後ろ、中間車は後ろの車端）の中心と幅 */
const DOOR_W = .9;
const doorZ = (hz: number, head: boolean) => head ? -hz + 2.9 : hz - 1.2;

/** 側面（head = 前端 -Z に運転台）。open = 扉を開けた状態 */
export function paint30000Side(Lb: number, head: boolean, open = false): SheetMaps {
  const s = sideSheet(Lb, YTOP), hz = Lb / 2;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, IVORY[0]); grd.addColorStop(1, IVORY[1]);
  s.base(grd, .28, .1);
  s.rect(-hz - 1, hz + 1, ROOF_Y + .05, YTOP + .1, '#e9e5da', .45, .1);
  s.rect(-hz - 1, hz + 1, TOP_LINE[0], TOP_LINE[1], RED, .3, .12);
  s.rect(-hz - 1, hz + 1, Y0 - .1, RED_TOP, RED, .3, .12);
  s.rect(-hz - 1, hz + 1, STRIPE[0], STRIPE[1], IVORY[0], .3, .1);
  s.rect(-hz - 1, hz + 1, STRIPE2[0], STRIPE2[1], IVORY[0], .3, .1);
  const dz = doorZ(hz, head);
  // 窓（大きな固定窓。角は丸い）
  const win = (z0: number, z1: number) => s.glass(z0, z1, WIN[0], WIN[1], '#5a5f66', .1, ['#2f3a44', '#141a20']);
  const row = (a: number, b: number) => {
    const n = Math.max(1, Math.round((b - a) / 1.95)), w = (b - a - .2 * (n + 1)) / n;
    for (let i = 0; i < n; i++) { const z0 = a + .2 + i * (w + .2); win(z0, z0 + w); }
  };
  if (head) {
    s.glass(-hz + 1.35, -hz + 1.85, WIN[0] + .1, WIN[1], '#5a5f66', .05); // 運転台の側窓
    row(dz + DOOR_W / 2 + .1, hz - .25);
  } else row(-hz + .25, dz - DOOR_W / 2 - .1);
  paintDoor(s, dz, DOOR_W, 3.0, WIN, '#efeae0', open, true);
  if (!open) {
    // 扉も車体と同じ塗り分け（窓の下は赤・白の細線）
    s.rect(dz - DOOR_W / 2, dz + DOOR_W / 2, 1.16, RED_TOP, RED, .3, .12);
    s.rect(dz - DOOR_W / 2, dz + DOOR_W / 2, STRIPE[0], STRIPE[1], IVORY[0], .3, .1);
    s.rect(dz - DOOR_W / 2, dz + DOOR_W / 2, STRIPE2[0], STRIPE2[1], IVORY[0], .3, .1);
  }
  return s.textures();
}

/** 前面シート（正面から見て左 = +X） */
export function paint30000Face(): SheetMaps {
  const s = faceSheet(HW_30, YTOP);
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, IVORY[0]); grd.addColorStop(1, IVORY[1]);
  s.base(grd, .28, .1);
  // 大きな曲面ガラス（黒い縁。中央の細い窓柱なし）
  s.rect(-HW_30 + .02, HW_30 - .02, SHIELD[0] - .05, SHIELD[1] + .05, '#16191d', .15, .25, .12);
  s.glass(-HW_30 + .1, HW_30 - .1, SHIELD[0], SHIELD[1], '', .12, ['#33404c', '#11161c']);
  // ガラスの下: 白 → 赤帯 → 白線 → 赤帯（灯具・愛称表示）→ 白線 → 赤
  s.rect(-HW_30, HW_30, RED_TOP - .3, 2.06, RED, .3, .12);
  s.rect(-HW_30, HW_30, STRIPE[0] - .1, STRIPE[1] - .1, IVORY[0], .3, .1);
  s.rect(-HW_30, HW_30, 1.28, STRIPE[0] - .1, RED, .3, .12);
  s.rect(-HW_30, HW_30, 1.2, 1.28, IVORY[0], .3, .1);
  s.rect(-HW_30, HW_30, Y0 - .1, 1.2, RED_D, .4, .12);
  // 灯具（四角い銀の枠）と愛称表示の枠
  for (const sx of [-1, 1]) {
    s.rect(sx * .92 - .19, sx * .92 + .19, 1.31, 1.66, '#b8bcc0', .3, .6, .04);
    s.rect(sx * .92 - .15, sx * .92 + .15, 1.34, 1.63, '#1a1c20', .2, .3, .03);
  }
  s.rect(-.5, .5, 1.32, 1.64, '#d8d6d0', .3, .4, .03);
  s.emit(-HW_30, HW_30, Y0, YTOP + .1, '#000'); // 夜は運転台の窓を光らせない
  return s.textures();
}

/** 1両分のジオメトリ */
export function build30000Car(kind: CarKind, Lb: number): CarParts {
  const hz = Lb / 2, head = kind === 'head', zf = -hz, roofTop = YTOP;
  const rings: Ring[] = [...(head ? slantRings(zf, R, SL) : [{ z: -hz, inset: 0 }]), { z: hz, inset: 0 }];
  const shell = shellGeo(HALF, rings, YTOP, Lb);
  if (head) applySlant(shell, zf, SL, false);
  const b = new GeoBatch(), add = adder(b), lit = new GeoBatch(), tl = new GeoBatch();
  const glows: THREE.Vector3[] = [];
  addEndWall(b, hz, YTOP, HW_30, 0xe4dfd2);
  let face: THREE.BufferGeometry | undefined, led: THREE.BufferGeometry | undefined;
  if (head) {
    face = applySlant(capGeo(HALF, { z: zf, inset: R }, YTOP, HW_30, -1), zf, SL, true);
    const zAt = (x: number, y: number) => zf + slantZ(SL, x, y) - .006;
    for (const sx of [-1, 1]) {
      const x = sx * .92;
      lit.add('l', P.box, M(x, 1.555, zAt(x, 1.555) - .02, 0, .26, .12, .02), 0xffffff); // 前照灯（灯具の上半分）
      glows.push(new THREE.Vector3(x, 1.555, zAt(x, 1.555) - .2));
      tl.add('l', P.box, M(x, 1.41, zAt(x, 1.41) - .02, 0, .26, .1, .02), 0xffffff); // 尾灯（下半分）
    }
    // 愛称・種別の表示（下の赤帯の中央）
    led = slantLed(SL, zf, [[0, 1.48, .92]], .27);
    // スカート（アイボリー）・連結器
    add(0, .78, zf + .3, 2.5, .5, .1, 0x5a1414, -.1);
    add(0, .88, zf + .05, .3, .22, .4, 0x22252a);
    for (const sx of [-1, 1]) add(sx * .45, 2.4, zAt(sx * .45, 2.4) - .03, .6, .025, .025, 0x111111, 0, 0, -sx * .9); // ワイパー（中央寄りに立つ）
  } else addEndWall(b, -hz, YTOP, HW_30, 0xe4dfd2);
  addUnderfloor(b, Lb, 'pan', { frame: 0x3a3d42, equip: 0x2b2e33, bogie: 0x24272b });
  // 屋根上: 低い冷房装置2基（アイボリー系）
  for (const z of [-3.4, 3.0]) {
    add(0, roofTop + .08, z, 1.6, .18, 2.6, 0xe6e2d8);
    for (const dz of [-.7, 0, .7]) add(0, roofTop + .18, z + dz, 1.0, .02, .36, 0x6a7076);
  }
  // 全電動車: 各車にパンタ（中間車は後ろ寄り、先頭車は後ろの車端）
  addLozenge(b, hz - 2.6, roofTop - .02);
  return { shell, face, paint: b.geometry('paint')!, led, head: lit.geometry('l') ?? undefined, tail: tl.geometry('l') ?? undefined, glows };
}
