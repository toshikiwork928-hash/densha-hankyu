// 特急サザンの座席指定車「10000系」（架空塗装）: 鋼製 20m 級・メタリックシルバー。帯の形は 7100系と同じ
//  （窓上の太い青＋細い橙、窓下の細い青＋橙。先頭車は運転台寄りで窓上の帯が斜めに下がって前面の帯へつながる）
//  先頭車: 乗務員扉 → 客用の折戸1か所 → 独立した客室窓8枚
//  中間車: 連続した1枚の横長窓・車端側に小窓2枚・片方の車端寄りに折戸1か所
//  前面: 貫通型。上半分は黒（前面窓は貫通扉の横から前面の両端まで延び、角の丸みへ回り込む + 窓付き貫通扉）、
//  下半分は濃い青 → 太い橙帯 → 白線 → 銀の裾。行先表示器は中央上部の1面、灯具は下部左右の銀枠（1枠に2灯）
import * as THREE from 'three';
import { GeoBatch, M, P } from '../batch';
import {
  Y0, adder, addEndWall, addSingleArm, addUnderfloor, capGeo, cv, faceSheet, roundRings, shellGeo, sideSheet, sweepBand,
  type CarKind, type CarParts, type Ring, type SheetMaps, type V2,
} from './common';
import { mergeLed } from './commuter';
import { FONT } from '../../core/config';

export const HW_S = 1.45;
export const YTOP_S = 3.84;
const ROOF: V2[] = [[HW_S, 3.4], [HW_S - .04, 3.56], [HW_S - .24, 3.71], [HW_S - .7, 3.81], [0, YTOP_S]];
const HALF: V2[] = [[HW_S - .03, Y0], [HW_S, 1.4], ...ROOF];
/** 先頭部の丸み（前面は側面へ丸く回り込む）。前面シートの有効幅は HW_S - R_S */
const R_S = .38;
const BLUE = '#1a2f86', ROYAL = '#1f3fae', ORANGE = '#f0961c';
const WIN: V2 = [2.0, 2.95];
/** 側面の帯（7100系 commuter.ts の old と同じ並び）: 窓上 = 太い青（TOP_BAND）とその下の細い橙（TOP_LINE）、窓下 = 細い青（LOW_BAND）とその下の橙（LOW_LINE） */
const TOP_BAND: V2 = [3.4, 3.65], TOP_LINE: V2 = [3.26, 3.37], LOW_BAND: V2 = [1.44, 1.53], LOW_LINE: V2 = [1.34, 1.43];
/** 前面の帯（側面の帯は運転台寄りでここまで下がる）: 青 = 前面の下半分、橙 = その下 */
const FRONT_BAND: V2 = [1.49, 2.05], FRONT_LINE: V2 = [1.33, 1.49];
/** 前面窓の上下端（前面と、角の丸みに回り込む部分で共通） */
const FWIN: V2 = [2.15, 3.1];
/** 先頭車: 前端から乗務員扉・客用折戸の中心。中間車: 折戸の中心（前端から） */
const CREW_Z = .8, CREW_W = .6, HEAD_DOOR = 2.5, MID_DOOR = 1.35, DOOR_W = 1.0;

/** 側面（head = 先頭車。前端 -Z 側に乗務員扉）。open = 折戸を開けた状態 */
export function paintSouthernSide(Lb: number, head: boolean, open = false): SheetMaps {
  const s = sideSheet(Lb, YTOP_S), hz = Lb / 2;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, '#dfe2e7'); grd.addColorStop(1, '#bcc1c8');
  s.base(grd, .3, .7);
  s.rect(-hz - 1, hz + 1, 3.7, YTOP_S + .1, '#c4c8ce', .4, .6); // 屋根
  const hband = (b: V2, col: string, z0 = -hz - 1, z1 = hz + 1) => s.rect(z0, z1, b[0], b[1], col, .3, .2);
  if (head) {
    // 7100系と同じ: 乗務員扉の後ろで、前面の帯（青・橙）から窓上の帯へ斜めに立ち上がる。窓下の帯は客用扉から後ろ
    const zs = -hz + CREW_Z + CREW_W / 2 + .06, k = .62;
    sweepBand(s, Lb, FRONT_LINE, TOP_LINE, zs + .12, k, ORANGE, .3, .2);
    sweepBand(s, Lb, FRONT_BAND, TOP_BAND, zs, k, BLUE, .3, .2, -.12);
    hband(LOW_BAND, BLUE, -hz + HEAD_DOOR); hband(LOW_LINE, ORANGE, -hz + HEAD_DOOR);
  } else { hband(TOP_BAND, BLUE); hband(TOP_LINE, ORANGE); hband(LOW_BAND, BLUE); hband(LOW_LINE, ORANGE); }
  /** 折戸（片引きの2枚折り）: 閉 = 銀の扉に細い窓2枚、開 = 暗い車内 + 戸袋の縁 */
  const fold = (zc: number) => {
    const w = DOOR_W;
    s.rect(zc - w / 2 - .035, zc + w / 2 + .035, 1.13, 3.08, '#8f959c', .5, .3);
    if (open) {
      s.glass(zc - w / 2, zc + w / 2, 1.16, 3.05, '', 0, ['#4a463e', '#23262b']);
      s.rect(zc - w / 2, zc + w / 2, 1.16, 1.3, '#5b5f66', .6, .1);
      s.rect(zc - w / 2, zc + w / 2, 2.98, 3.05, '#d9d6c8', .5, 0);
      s.rect(zc + w / 2 - .12, zc + w / 2, 1.16, 3.05, '#c8ccd2', .35, .6);
      s.emit(zc - w / 2, zc + w / 2, 1.16, 3.05, s.emitGrad(1.3, 3.05, '#ffffff', '#6a5e48'));
      s.emit(zc - w / 2, zc + w / 2, 1.16, 1.3, '#000');
      s.emit(zc + w / 2 - .12, zc + w / 2, 1.16, 3.05, '#000');
      return;
    }
    s.rect(zc - w / 2, zc + w / 2, 1.16, 3.05, '#cfd3d9', .3, .65); // 扉は車体と同じ銀（7100系と同じく窓下の帯は扉で切れる）
    s.rect(zc - .012, zc + .012, 1.16, 3.05, '#6a7078');
    for (const sg of [-1, 1]) s.glass(zc + sg * .24 - .15, zc + sg * .24 + .15, WIN[0], WIN[1], '#5a6067', .05);
  };
  const smallWin = (zc: number, w: number) => s.glass(zc - w / 2, zc + w / 2, WIN[0], WIN[1], '#3f454b', .05);
  if (head) {
    // 前面窓が角の丸み（前端から R_S）へ回り込む: 前面の黒い上半分とガラスを側面の前端にも塗る
    s.rect(-hz - .1, -hz + R_S + .02, FRONT_BAND[1], 3.5, '#0b0d10', .12, .3);
    s.glass(-hz - .1, -hz + R_S - .02, FWIN[0], FWIN[1], '', .02, ['#2a3440', '#0e1319']);
    s.emit(-hz - .1, -hz + R_S + .02, FRONT_BAND[1], 3.5, '#000');
    // 乗務員扉（銀。帯は扉の上にも描く）
    const cz = -hz + CREW_Z;
    s.rect(cz - CREW_W / 2 - .03, cz + CREW_W / 2 + .03, 1.13, 3.08, '#8f959c', .5, .3);
    s.rect(cz - CREW_W / 2, cz + CREW_W / 2, 1.16, 3.05, '#cfd3d9', .3, .65);
    s.rect(cz - CREW_W / 2, cz + CREW_W / 2, FRONT_BAND[0], FRONT_BAND[1], BLUE, .3, .2);
    s.rect(cz - CREW_W / 2, cz + CREW_W / 2, FRONT_LINE[0], FRONT_LINE[1], ORANGE, .3, .2);
    s.glass(cz - .2, cz + .2, WIN[0] + .15, WIN[1], '#5a6067', .03);
    fold(-hz + HEAD_DOOR);
    // 客室窓 8枚（独立した窓）
    const n = 8, gap = .42, z0 = -hz + HEAD_DOOR + DOOR_W / 2 + .5, z1 = hz - .55, pitch = (z1 - z0 + gap) / n, w = pitch - gap;
    for (let i = 0; i < n; i++) s.glass(z0 + i * pitch, z0 + i * pitch + w, WIN[0], WIN[1], '#3a4046', .07, ['#34414f', '#141b23']);
  } else {
    fold(-hz + MID_DOOR);
    // 連続した1枚の大きな横長窓（黒い帯状）+ 車端側に小窓2枚
    s.glass(-hz + MID_DOOR + DOOR_W / 2 + .45, hz - 2.4, WIN[0], WIN[1], '#14181c', .06, ['#2a343f', '#0d1217']);
    smallWin(hz - 1.8, .6); smallWin(hz - .9, .6);
  }
  // 号車札（文字なし）
  s.rect(hz - 4.5, hz - 4.2, 3.28, 3.38, '#2b3138');
  return s.textures();
}

/** 前面シート（正面から見て左 = +X）。有効幅は ±(HW_S - R_S) = ±1.07 */
export function paintSouthernFace(): SheetMaps {
  const s = faceSheet(HW_S, YTOP_S), H = HW_S;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, '#d9dce1'); grd.addColorStop(1, '#bcc1c8');
  s.base(grd, .3, .7);
  // 上半分 = 黒（ガラス面と一体）
  s.rect(-H, H, 2.05, 3.9, '#0b0d10', .12, .3);
  // 下半分 = 濃い青（ロイヤルブルー）→ 太い橙帯 → 細い白線 → 銀の裾
  s.rect(-H, H, 1.49, 2.05, ROYAL, .28, .3);
  s.rect(-H, H, 1.33, 1.49, ORANGE, .3, .15);
  s.rect(-H, H, 1.27, 1.31, '#f3f5f8', .3, .1);
  s.rect(-H, H, Y0, 1.25, '#c9cdd3', .35, .7);
  // 前面窓: 貫通扉の枠の横から前面の両端まで（シートの端 ±H まで塗り、角の丸みの部分は側面シートが続ける）
  for (const sg of [-1, 1]) s.glass(sg < 0 ? -H : .5, sg < 0 ? -.5 : H, FWIN[0], FWIN[1], '', .02, ['#2a3440', '#0e1319']);
  // 貫通扉（黒い枠・窓付き・下は青）
  s.rect(-.47, .47, 1.34, 3.12, '#060708', .25, .2, .03);
  s.rect(-.4, .4, 1.4, 3.05, '#17191d', .3, .3, .02);
  s.rect(-.4, .4, 1.42, 2.1, '#1c389a', .3, .25);
  s.glass(-.28, .28, 2.2, 2.98, '#060708', .03, ['#26303a', '#0c1015']);
  // 行先表示器の凹み（中央上部）
  s.rect(-.47, .47, 3.12, 3.38, '#040506', .3, .2, .02);
  // 右の前面窓の上: 架空の車号
  s.text('10003', -.74, 3.2, .1, '#f4f6fa', 600);
  s.emit(-H, H, Y0, YTOP_S + .1, '#000'); // 夜は運転台の窓を光らせない（客室窓は側面シートで発光）
  return s.textures();
}

/** 行先表示（種別 = 赤地に白、行先 = 白地に黒の1面）。label '特急サザン' は「サザン」と表示 */
export function ledSouthernTexture(label: string, dest: string): THREE.CanvasTexture {
  const [k, g] = cv(512, 128), shown = label === '特急サザン' ? 'サザン' : label;
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#d4202a'; g.fillRect(8, 8, 200, 112);
  g.fillStyle = '#f4f4f0'; g.fillRect(212, 8, 292, 112);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.font = `800 62px ${FONT}`; g.fillText(shown, 108, 66, 176);
  g.fillStyle = '#16181c'; g.font = `700 66px ${FONT}`; g.fillText(dest, 358, 68, 268);
  const t = new THREE.CanvasTexture(k); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 1両分のジオメトリ */
export function buildSouthernCar(kind: CarKind, Lb: number): CarParts {
  const hz = Lb / 2, head = kind === 'head', zf = -hz;
  const rings: Ring[] = [...(head ? roundRings(zf, R_S, 1) : [{ z: -hz, inset: 0 }]), { z: hz, inset: 0 }];
  const shell = shellGeo(HALF, rings, YTOP_S, Lb);
  const b = new GeoBatch(), add = adder(b), lit = new GeoBatch(), mkL = new GeoBatch(), mkR = new GeoBatch();
  const glows: THREE.Vector3[] = [];
  const roofTop = YTOP_S;
  for (const sx of [-1, 1]) add(sx * (HW_S - .03), 3.56, 0, .04, .04, Lb - (head ? .6 : 0), 0x9aa0a7);
  addEndWall(b, hz, YTOP_S, HW_S, 0xc2c6cc);
  let face: THREE.BufferGeometry | undefined, led: THREE.BufferGeometry | undefined, marks: CarParts['marks'];
  if (head) {
    face = capGeo(HALF, { z: zf, inset: R_S }, YTOP_S, HW_S, -1);
    const z = zf - .005;
    // 行先表示器（中央上部）: 黒い枠の奥に1面
    add(0, 3.25, z - .014, .94, .27, .03, 0x0a0b0d);
    add(0, 3.395, z - .03, .98, .03, .06, 0x15171a); // 庇
    led = mergeLed([[0, 3.25, .84]], z - .05, .2);
    // 前照灯・標識灯・尾灯: 下部左右の銀の枠（1枠に2灯。内側 = 前照灯、外側 = 標識灯・尾灯）
    for (const sx of [-1, 1]) {
      const cx = sx * .78;
      add(cx, 1.65, z - .015, .48, .24, .03, 0xc4c9d0);
      add(cx, 1.65, z - .03, .42, .18, .02, 0x2a2e34);
      lit.add('l', P.box, M(sx * .68, 1.65, z - .045, 0, .16, .12, .02), 0xffffff);
      glows.push(new THREE.Vector3(sx * .68, 1.65, z - .2));
      (sx > 0 ? mkL : mkR).add('l', P.box, M(sx * .88, 1.65, z - .045, 0, .16, .12, .02), 0xffffff);
    }
    // ワイパー（前面窓の下）
    for (const sx of [-1, 1]) add(sx * .74, 2.2, z - .02, .4, .025, .025, 0x111111, 0, 0, sx * .3);
    // 裾（銀）・連結器・ホース
    add(0, .8, zf + .02, 2.0, .38, .16, 0xc2c7ce, -.12);
    add(0, .88, zf - .13, .3, .24, .5, 0x22252a);
    for (const sx of [-.7, -.5, .5, .7]) b.add('paint', P.cyl, M(sx, 1.0, zf - .09, 0, .07, .3, .07), 0x1c1e21);
    marks = { l: mkL.geometry('l')!, r: mkR.geometry('l')! };
  } else addEndWall(b, -hz, YTOP_S, HW_S, 0xc2c6cc);
  addUnderfloor(b, Lb, kind, { frame: 0x3a3d42, equip: 0x2b2e33, bogie: 0x24272b });
  // 屋根上: 低い箱形の冷房装置
  for (const z of [-7.2, -4.4, -1.6, 1.2, 4.0, 6.8]) {
    if (kind === 'pan' && Math.abs(z - (-hz + 4.0)) < 1.7) continue;
    if (head && z < -6.5) continue;
    add(0, roofTop + .13, z, 1.4, .26, 1.6, 0xcdd1d6);
    for (const sx of [-1, 1]) add(sx * .71, roofTop + .14, z, .02, .16, 1.1, 0x3a3f45);
  }
  add(0, roofTop + .03, 0, .4, .06, Lb - 1.4, 0xa9aeb4);
  if (kind === 'pan') addSingleArm(b, -hz + 4.0, roofTop - .02);
  return { shell, face, paint: b.geometry('paint')!, led, head: lit.geometry('l') ?? undefined, marks, glows };
}
