// 山岳線用 2300系: 18m 級ステンレス車体・片側2扉・2両ユニット（両車とも運転台・パンタ付き）・ワンマン対応
//  前面: FRP の平面的な顔を朱色一色で塗装、窓まわりは黒、中央の貫通扉も朱色、前照灯は貫通扉の上、尾灯は下部の左右
//  側面: 扉間に大きな1枚窓 3枚、車端は小さな下降窓、窓の上に朱色の細い線、窓の下に朱色〜橙のグラデーションの太い帯（実車はフィルム）
//  屋根: セミ集中式冷房2基、シングルアームパンタ（連結面寄り）、無線アンテナ
import * as THREE from 'three';
import { GeoBatch, M, P } from '../batch';
import {
  Y0, adder, addEndWall, addSingleArm, addUnderfloor, capGeo, faceSheet, roundRings, shellGeo, sideSheet,
  type CarKind, type CarParts, type Ring, type SheetMaps, type V2,
} from './common';
import { mergeLed } from './commuter';

export const HW_23 = 1.37;
export const YTOP_23 = 3.76;
const ROOF: V2[] = [[HW_23, 3.36], [HW_23 - .05, 3.52], [HW_23 - .3, 3.65], [HW_23 - .75, 3.73], [0, YTOP_23]];
const HALF: V2[] = [[HW_23 - .06, Y0], [HW_23, 1.45], ...ROOF];
/** 客用扉の中心（片側2扉）と幅 */
const DOORS = [-4.3, 4.3], DOOR_W = 1.3;
/** 先頭部の丸み・乗務員扉 */
const R = .16, CREW_OFF = .6, CREW_W = .6;
/** 窓の上下端（側窓・客用扉の窓・乗務員扉の窓で共通） */
const WIN: V2 = [2.05, 2.9];
const RED = '#e04a26', RED_D = '#c8361c', LINE = '#f5a46a';
const FACE_RED = '#e2502a';
const ROOF_Y = 3.48;

/** 窓の上下の帯（朱色。上は窓の上の細い線、下は窓の下の太い帯で、上から 朱 → 細い白 → 朱から橙へ抜けるグラデーション） */
function bands(s: ReturnType<typeof sideSheet>, hz: number) {
  s.rect(-hz - 1, hz + 1, 2.98, 3.06, RED, .35, .1); // 上の線は窓の上端（WIN[1] + 枠）に沿わせる
  s.rect(-hz - 1, hz + 1, 3.08, 3.1, LINE, .35, .1);
  s.rect(-hz - 1, hz + 1, 1.88, 1.97, RED, .35, .1);
  s.rect(-hz - 1, hz + 1, 1.84, 1.88, '#f4efe8', .35, .1);
  const g = s.c.createLinearGradient(0, s.Y(1.84), 0, s.Y(1.58));
  g.addColorStop(0, RED_D); g.addColorStop(.6, RED); g.addColorStop(1, LINE);
  s.rect(-hz - 1, hz + 1, 1.58, 1.84, g as unknown as string, .35, .1);
}

/** 側面（head = 前端 -Z に乗務員扉）。open = 客用扉を開けた状態 */
export function paint2300Side(Lb: number, head: boolean, open = false): SheetMaps {
  const s = sideSheet(Lb, YTOP_23), hz = Lb / 2;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, '#d6dade'); grd.addColorStop(1, '#b6bcc3');
  s.base(grd, .36, .78);
  s.rect(-hz - 1, hz + 1, ROOF_Y, YTOP_23 + .1, '#a3a8ae', .6, .45);
  // ステンレスの継ぎ目（うっすら）
  for (let z = -hz + 1.6; z < hz; z += 2.9) s.rect(z, z + .015, Y0, ROOF_Y, 'rgba(0,0,0,.05)');
  bands(s, hz);
  const door = (zc: number, w: number, dbl: boolean) => {
    s.rect(zc - w / 2 - .03, zc + w / 2 + .03, 1.13, 3.06, '#868c93', .5, .3);
    if (open && dbl) {
      s.glass(zc - w / 2, zc + w / 2, 1.16, 3.03, '', 0, ['#4a463e', '#23262b']);
      s.rect(zc - w / 2, zc + w / 2, 1.16, 1.3, '#5b5f66', .6, .1);
      s.rect(zc - w / 2, zc + w / 2, 2.96, 3.03, '#d9d6c8', .5, 0);
      for (const sg of [-1, 1]) s.rect(zc + sg * (w / 2 - .06) - .06, zc + sg * (w / 2 - .06) + .06, 1.16, 3.03, '#c4c9cf', .4, .7);
      s.emit(zc - w / 2, zc + w / 2, 1.16, 3.03, s.emitGrad(1.3, 3.03, '#ffffff', '#6a5e48'));
      s.emit(zc - w / 2, zc + w / 2, 1.16, 1.3, '#000');
      for (const sg of [-1, 1]) s.emit(zc + sg * (w / 2 - .06) - .06, zc + sg * (w / 2 - .06) + .06, 1.16, 3.03, '#000');
      return;
    }
    s.rect(zc - w / 2, zc + w / 2, 1.16, 3.03, '#c6cbd1', .4, .7);
    if (dbl) {
      s.rect(zc - .012, zc + .012, 1.16, 3.03, '#5e646b');
      for (const sg of [-1, 1]) s.glass(zc + sg * w / 4 - .2, zc + sg * w / 4 + .2, WIN[0], WIN[1], '#5a6067', .06);
    } else s.glass(zc - .19, zc + .19, WIN[0], WIN[1], '#5a6067', .03);
  };
  for (const d of DOORS) door(d, DOOR_W, true);
  const BIG = 1.7; // 扉間の1枚窓の幅
  const big = (zc: number) => s.glass(zc - BIG / 2, zc + BIG / 2, WIN[0], WIN[1], '#4a5056', .08);
  const drop = (zc: number) => s.glass(zc - .42, zc + .42, WIN[0], WIN[1], '#565c63', .05); // 車端の下降窓
  // 扉間: 大窓3枚
  const a = DOORS[0] + DOOR_W / 2, b = DOORS[1] - DOOR_W / 2, gap = (b - a - 3 * BIG) / 4;
  for (let i = 0; i < 3; i++) big(a + gap * (i + 1) + BIG * i + BIG / 2);
  // 後端（連結面側）: 下降窓2枚
  const e0 = DOORS[1] + DOOR_W / 2;
  drop(e0 + .7); drop(e0 + 1.75);
  if (head) {
    const crewZ = -hz + CREW_OFF;
    door(crewZ, CREW_W, false);
    // 乗務員扉と客用扉の間: 大窓1枚（運転台後ろのクロスシート部）
    const f0 = crewZ + CREW_W / 2 + .2, f1 = DOORS[0] - DOOR_W / 2 - .25;
    big((f0 + f1) / 2);
    // ワンマン表示灯（乗務員扉の後ろ上）
    s.rect(f0 - .05, f0 + .25, 3.28, 3.38, '#202428', .3, .2);
  } else { drop(-e0 - .7); drop(-e0 - 1.75); }
  // 号車札・行先の小窓（文字なし）
  s.rect(DOORS[1] - 1.1, DOORS[1] - .75, 3.28, 3.38, '#22272d');
  return s.textures();
}

/** 前面シート（正面から見て左 = +X） */
export function paint2300Face(): SheetMaps {
  const s = faceSheet(HW_23, YTOP_23);
  s.base(FACE_RED, .28, .15);
  // 窓まわりの黒
  s.rect(-HW_23, HW_23, 2.1, 3.48, '#111316', .15, .25, .04);
  s.glass(.5, 1.24, 2.26, 3.16, '', .03, ['#2e3a46', '#10151b']);
  s.glass(-1.24, -.5, 2.26, 3.16, '', .03, ['#2e3a46', '#10151b']);
  // 帯（側面の帯を前面へ回す）
  s.rect(-HW_23, HW_23, 1.84, 1.96, RED_D, .3, .1);
  s.rect(-HW_23, HW_23, 1.725, 1.765, LINE, .3, .1);
  // 下部（前面の朱色のまま裾まで。少し濃い）
  s.rect(-HW_23, HW_23, Y0, 1.22, '#cc3e20', .3, .15);
  // 貫通扉（前面と同じ朱色・窓は小さめ）
  s.rect(-.46, .46, 1.18, 3.46, '#b8341c', .3, .15, .03);
  s.rect(-.4, .4, 1.22, 3.4, FACE_RED, .28, .15, .02);
  s.glass(-.26, .26, 2.42, 3.08, '#3d434a', .03);
  s.rect(-.18, .18, 1.24, 1.3, '#8a9097');
  // 尾灯・標識灯のケース（下部左右）
  for (const sx of [-1, 1]) s.rect(sx * .98 - .24, sx * .98 + .24, 1.48, 1.66, '#0e1012', .2, .3, .03);
  // 車番・ワンマン表示（架空）
  s.text('2301', .98, 1.36, .16, '#eef2f4', 600);
  s.rect(-1.22, -.72, 1.29, 1.43, '#f2f4f6', .4, 0, .02);
  s.text('ワンマン', -.97, 1.36, .1, RED_D, 800);
  return s.textures();
}

/** 1両分のジオメトリ（2両ユニットの各車 = 運転台付き。head 以外は中間車として妻面両側） */
export function build2300Car(kind: CarKind, Lb: number): CarParts {
  const hz = Lb / 2, head = kind === 'head', zf = -hz;
  const rings: Ring[] = [...(head ? roundRings(zf, R, 1) : [{ z: -hz, inset: 0 }]), { z: hz, inset: 0 }];
  const shell = shellGeo(HALF, rings, YTOP_23, Lb);
  const b = new GeoBatch(), add = adder(b), lit = new GeoBatch(), tl = new GeoBatch();
  const glows: THREE.Vector3[] = [];
  const roofTop = YTOP_23;
  for (const sx of [-1, 1]) add(sx * (HW_23 - .03), ROOF_Y + .02, 0, .04, .04, Lb - (head ? .5 : 0), 0x8d939a);
  addEndWall(b, hz, YTOP_23, HW_23, 0xb9bec4);
  let face: THREE.BufferGeometry | undefined, led: THREE.BufferGeometry | undefined, led2: THREE.BufferGeometry | undefined;
  if (head) {
    face = capGeo(HALF, { z: zf, inset: R }, YTOP_23, HW_23, -1);
    const z = zf - .005;
    // 貫通扉の枠と手すり、渡り板
    add(0, 3.47, z - .025, .98, .05, .06, 0xb8bdc3);
    for (const sx of [-1, 1]) add(sx * .47, 2.32, z - .025, .05, 2.3, .06, 0xb8bdc3);
    for (const sx of [-1, 1]) add(sx * .62, 2.0, z - .05, .03, .7, .03, 0xc8ccd0);
    add(0, 1.2, z - .1, .86, .05, .22, 0x9da3aa);
    // 前照灯（貫通扉の上、LED 2灯）と尾灯・標識灯（下部左右）
    for (const sx of [-1, 1]) {
      add(sx * .2, 3.6, z - .01, .34, .16, .03, 0x15171a);
      lit.add('l', P.box, M(sx * .2, 3.6, z - .03, 0, .26, .09, .02), 0xffffff);
      glows.push(new THREE.Vector3(sx * .2, 3.6, z - .2));
      lit.add('l', P.box, M(sx * 1.08, 1.57, z - .015, 0, .14, .1, .02), 0xffb040); // 標識灯（外側）
      tl.add('l', P.box, M(sx * .88, 1.57, z - .02, 0, .18, .1, .02), 0xffffff); // 尾灯（内側）
    }
    // 行先 LED（窓まわりの黒の上部）: 正面から見て左 = 種別、右 = 行先の2面
    led = mergeLed([[.86, 3.32, .58]], z - .01, .15);
    led2 = mergeLed([[-.86, 3.32, .58]], z - .01, .15);
    // スカート（細身・黒灰）・連結器・ホース
    for (const sx of [-1, 1]) b.add('paint', P.box, M(sx * .82, .72, zf - .06, sx * .2, .95, .56, .07, -.18), 0x3a3e44);
    add(0, .5, zf - .08, 1.0, .1, .1, 0x3a3e44, -.18);
    add(0, .88, zf - .16, .3, .24, .5, 0x22252a);
    for (const sx of [-.5, -.35, .35]) b.add('paint', P.cyl, M(sx, 1.0, zf - .1, 0, .07, .34, .07), 0x1c1e21);
    // ワイパー・後写鏡（ワンマン用の大きめのミラー）
    for (const sx of [-1, 1]) add(sx * .88, 2.36, z - .03, .52, .025, .025, 0x111111, 0, 0, sx * .35);
    for (const sx of [-1, 1]) {
      add(sx * (HW_23 + .1), 2.9, zf + .4, .06, .32, .22, 0x222529);
      add(sx * (HW_23 + .04), 3.1, zf + .4, .14, .03, .03, 0x55595f);
    }
    // 屋根上の無線アンテナ
    add(0, roofTop + .04, zf + 1.1, .7, .05, .3, 0x6f747a);
    add(0, roofTop + .2, zf + 1.1, .03, .3, .03, 0x2a2d31);
  } else addEndWall(b, -hz, YTOP_23, HW_23, 0xb9bec4);
  addUnderfloor(b, Lb, 'pan', { frame: 0x3a3d42, equip: 0x2b2e33, bogie: 0x24272b });
  // セミ集中式冷房2基
  for (const z of [-3.6, 2.0]) {
    add(0, roofTop + .11, z, 1.7, .22, 2.4, 0xb5bac0);
    add(0, roofTop + .23, z, 1.3, .03, 1.9, 0x9fa5ab);
    for (const dz of [-.6, 0, .6]) add(0, roofTop + .25, z + dz, .9, .02, .36, 0x6a7076);
  }
  add(0, roofTop + .03, 0, .45, .06, Lb - 2.4, 0x868b91); // 屋根上の配線ダクト
  // パンタは全車（連結面寄り）。中間車扱いでも付ける
  addSingleArm(b, hz - 3.2, roofTop - .02);
  return { shell, face, paint: b.geometry('paint')!, led, led2, head: lit.geometry('l') ?? undefined, tail: tl.geometry('l') ?? undefined, glows };
}
