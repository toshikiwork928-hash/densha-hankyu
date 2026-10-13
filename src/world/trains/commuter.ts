// 通勤形 20m 級4扉（架空塗装の青帯＋橙線）
//  new: ステンレス車体・黒い前面・中央貫通扉・角ばったスカート・シングルアーム
//  old: 鋼製（銀灰色塗装）・丸みのある前面・屋根上の2灯前照灯・分散冷房・菱形パンタ
//  6300系（ss = true）: old と同じ形で、車体は塗装なしのステンレス（銀）。材質（塗装シート）だけを替える
import * as THREE from 'three';
import { GeoBatch, M, P } from '../batch';
import {
  Y0, adder, addEndWall, addLozenge, addSingleArm, addTaperedSkirt, addUnderfloor, capGeo, faceSheet, roundRings, shellGeo, sideSheet, sweepBand,
  type CarKind, type CarParts, type Ring, type SheetMaps, type V2,
} from './common';

export type CommuterVariant = 'new' | 'old';

export const HW = 1.45;
export const YTOP = 3.84;
const ROOF: V2[] = [[HW, 3.42], [HW - .05, 3.58], [HW - .3, 3.71], [HW - .75, 3.8], [0, YTOP]];
/** 断面: new = すそ絞り、old = 直線車体（鋼製） */
const HALFS: Record<CommuterVariant, V2[]> = { new: [[HW - .06, Y0], [HW, 1.5], ...ROOF], old: [[HW, Y0], ...ROOF] };
const DOORS = [-7.2, -2.4, 2.4, 7.2], DOOR_W = 1.3;
/** 先頭車: 前端から乗務員扉の中心まで・扉幅・客用扉1の後ろへのずらし量 */
const CREW_OFF = .55, CREW_W = .64, HEAD_SHIFT = .4;
const BLUE = '#2f3fa8', ORANGE = '#f0961c';

interface Look {
  r: number; base: [string, string]; roof: string; rough: number; metal: number;
  topBand: V2; topLine: V2; lowBand: V2; lowLine: V2; frontBand: V2; frontLine: V2;
  win: V2; door: string; roofY: number;
}
const LOOK: Record<CommuterVariant, Look> = {
  new: {
    r: .24, base: ['#d3d7dc', '#b4bac1'], roof: '#a7acb2', rough: .38, metal: .75,
    topBand: [3.34, 3.48], topLine: [3.24, 3.33], lowBand: [1.66, 1.77], lowLine: [1.54, 1.64],
    frontBand: [1.58, 2.0], frontLine: [1.48, 1.55], win: [2.04, 2.93], door: '#c4c9cf', roofY: 3.55, // 窓は戸間に1枚（2枚引き違い）の約1.76m幅。上下端は客用扉の窓と揃える
  },
  old: {
    r: .3, base: ['#c6cbd6', '#b3b9c6'], roof: '#9fa4aa', rough: .42, metal: .12,
    topBand: [3.4, 3.65], topLine: [3.26, 3.37], lowBand: [1.44, 1.53], lowLine: [1.34, 1.43],
    frontBand: [1.6, 2.02], frontLine: [1.49, 1.56], win: [2.0, 2.93], door: '#c9ccd1', roofY: 3.7, // ドアは車体と同系色の塗装。上の帯は太い青＋細い橙。窓の上下端は客用扉の窓と揃える
  },
};

/** 6300系（old の形・ステンレス無塗装）の外板。帯・窓は old のまま */
const stainless = (L: Look): Look => ({ ...L, base: ['#d8dce0', '#b5bbc2'], roof: '#a3a8ae', rough: .36, metal: .78, door: '#c8cdd3' });
const lookOf = (v: CommuterVariant, ss: boolean): Look => ss ? stainless(LOOK[v]) : LOOK[v];

/** 側面（head = 先頭車。前端 = -Z 側に乗務員扉と帯の立ち上がり） */
/** open = 客用ドアを開けた状態（開口部は暗い車内、夜は点灯）。ss = ステンレス無塗装（6300系） */
export function paintCommuterSide(v: CommuterVariant, Lb: number, head: boolean, open = false, ss = false): SheetMaps {
  const L = lookOf(v, ss), s = sideSheet(Lb, YTOP), hz = Lb / 2;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, L.base[0]); grd.addColorStop(1, L.base[1]);
  s.base(grd, L.rough, L.metal);
  s.rect(-hz - 1, hz + 1, L.roofY, YTOP + .1, L.roof, .6, L.metal * .6);
  if (ss) {
    // 6300系: 腰板（窓の下）と幕板（窓の上）のコルゲート（横方向の細い波板）。帯・扉・窓はこの上に描く
    const rib = (y0: number, y1: number) => {
      for (let y = y0; y < y1; y += .055) {
        s.rect(-hz, hz, y, y + .018, 'rgba(255,255,255,.22)');
        s.rect(-hz, hz, y + .018, y + .03, 'rgba(0,0,0,.1)');
      }
    };
    rib(Y0 + .08, L.win[0] - .08); rib(L.win[1] + .1, L.roofY - .04);
  }
  const band = (b: V2, col: string, z0 = -hz - 1) => s.rect(z0, hz + 1, b[0], b[1], col, .35, .1);
  // 先頭車: 乗務員扉（幅0.64m）→ 窓（約1.1m）→ 客用扉。1つ目の客用扉は中間車より後ろ（+0.35m）へずらして窓の幅を取る
  const crewZ = -hz + CREW_OFF;
  const doors = head ? [DOORS[0] + HEAD_SHIFT, ...DOORS.slice(1)] : DOORS;
  if (head) {
    const zs = crewZ + CREW_W / 2 + .06, k = .62;
    sweepBand(s, Lb, L.frontLine, L.topLine, zs + .12, k, ORANGE, .35, .1);
    sweepBand(s, Lb, L.frontBand, L.topBand, zs, k, BLUE, .35, .1, -.12);
    band(L.lowBand, BLUE, doors[0]); band(L.lowLine, ORANGE, doors[0]);
  } else {
    band(L.topBand, BLUE); band(L.topLine, ORANGE); band(L.lowBand, BLUE); band(L.lowLine, ORANGE);
  }
  /** 窓の上下端（側窓・客用扉の窓・乗務員扉の窓で共通） */
  const [w0, w1] = L.win, sq = (w1 - w0) / 2; // sq = old の正方形窓の半幅
  const door = (zc: number, w: number, dbl: boolean) => {
    s.rect(zc - w / 2 - .03, zc + w / 2 + .03, 1.13, 3.08, v === 'old' ? '#a9adb3' : '#8b9198', .5, .3);
    if (open && dbl) {
      // 開口: 戸袋へ引き込まれた扉の縁だけを残し、車内（床・つり革・天井の灯り）を暗く描く
      s.glass(zc - w / 2, zc + w / 2, 1.16, 3.05, '', .0, ['#4a463e', '#23262b']);
      s.rect(zc - w / 2, zc + w / 2, 1.16, 1.3, '#5b5f66', .6, .1);
      s.rect(zc - w / 2, zc + w / 2, 2.98, 3.05, '#d9d6c8', .5, 0);
      for (const sg of [-1, 1]) s.rect(zc + sg * (w / 2 - .06) - .06, zc + sg * (w / 2 - .06) + .06, 1.16, 3.05, L.door, v === 'old' ? L.rough : .4, v === 'old' ? L.metal : .7);
      // 夜の発光: 天井の灯りが明るく、床へ向かって暗くなる車内。床・引き込まれた扉の縁は光らない
      s.emit(zc - w / 2, zc + w / 2, 1.16, 3.05, s.emitGrad(1.3, 3.05, '#ffffff', '#6a5e48'));
      s.emit(zc - w / 2, zc + w / 2, 1.16, 1.3, '#000');
      for (const sg of [-1, 1]) s.emit(zc + sg * (w / 2 - .06) - .06, zc + sg * (w / 2 - .06) + .06, 1.16, 3.05, '#000');
      return;
    }
    s.rect(zc - w / 2, zc + w / 2, 1.16, 3.05, L.door, v === 'old' ? L.rough : .4, v === 'old' ? L.metal : .7);
    if (dbl) {
      s.rect(zc - .012, zc + .012, 1.16, 3.05, '#5e646b');
      for (const sg of [-1, 1]) s.glass(zc + sg * w / 4 - .22, zc + sg * w / 4 + .22, w0, w1, '#5a6067', .06);
    } else s.glass(zc - .2, zc + .2, w0, w1, '#5a6067', .03); // 乗務員扉の窓も側窓・客用扉の窓と同じ高さ
  };
  for (const d of doors) door(d, DOOR_W, true);
  // 側窓
  for (let i = 0; i < doors.length - 1; i++) {
    const zc = (doors[i] + doors[i + 1]) / 2;
    if (v === 'new') {
      // 幅1.76mの大窓: 外枠の中に2枚の窓ガラスと、中央の細い仕切り（約6cm）
      const bw = .88;
      s.rect(zc - bw - .045, zc + bw + .045, w0 - .045, w1 + .045, '#4a5056', .5, 0, .12);
      for (const sg of [-1, 1]) s.glass(sg < 0 ? zc - bw : zc + .03, sg < 0 ? zc - .03 : zc + bw, w0, w1, '', .04);
    } else for (const dz of [-.53, .53]) s.glass(zc + dz - sq, zc + dz + sq, w0, w1, '#565c63', .07); // 正方形の1段下降窓を2枚ずつ（間に約13cmの窓柱）
  }
  if (v === 'new') {
    const zc = (DOORS[3] + DOOR_W / 2 + .35 + hz - .4) / 2;
    s.glass(zc - sq, zc + sq, w0, w1, '#565c63', .05);
  }
  else if (head) s.glass((DOORS[3] + DOOR_W / 2 + hz) / 2 - sq, (DOORS[3] + DOOR_W / 2 + hz) / 2 + sq, w0, w1, '#565c63', .03);
  else {
    // 7100系の中間車: 後ろ（+Z）の車端は窓が2枚（先頭車の乗務員扉の位置も窓になったような並び）。幅を少し細くして収める
    const z0 = DOORS[3] + DOOR_W / 2, ww = .8, gap = .1, zc = (z0 + hz) / 2;
    for (const sg of [-1, 1]) { const c = zc + sg * (ww + gap) / 2; s.glass(c - ww / 2, c + ww / 2, w0, w1, '#565c63', .03); }
  }
  if (head) {
    door(crewZ, CREW_W, false);
    // 乗務員扉と客用扉の間の窓: 7100系にはあり、8300系は窓の無い壁（帯の立ち上がりだけ）
    // 7100系の窓は他の側窓と同じ正方形（乗務員扉と客用扉の間の中央）
    if (v === 'old') {
      const zc = (crewZ + CREW_W / 2 + doors[0] - DOOR_W / 2) / 2;
      s.glass(zc - sq, zc + sq, w0, w1, '#565c63', .07);
    }
  } else if (v === 'new') {
    const zc = (-hz + .4 + DOORS[0] - DOOR_W / 2 - .35) / 2;
    s.glass(zc - sq, zc + sq, w0, w1, '#565c63', .05);
  }
  else s.glass((DOORS[0] - DOOR_W / 2 - hz) / 2 - sq, (DOORS[0] - DOOR_W / 2 - hz) / 2 + sq, w0, w1, '#565c63', .03);
  // 号車札・小表示（文字なし）
  s.rect(DOORS[1] + .9, DOORS[1] + 1.2, 3.46, 3.53, '#2b3138');
  if (ss) {
    // 外板継ぎ目（コルゲートは地塗りの直後に描いた）
    for (let z = -hz + 1.6; z < hz; z += 2.9) s.rect(z, z + .015, Y0, L.roofY, 'rgba(0,0,0,.05)');
  } else if (v === 'old') for (let z = -hz + .2; z < hz; z += 2.1) s.rect(z, z + .02, Y0, 3.55, 'rgba(0,0,0,.06)'); // 外板継ぎ目
  return s.textures();
}

/** 前面シート（ss = ステンレス無塗装の 6300系） */
export function paintCommuterFace(v: CommuterVariant, ss = false): SheetMaps {
  const L = lookOf(v, ss), s = faceSheet(HW, YTOP);
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, L.base[0]); grd.addColorStop(1, L.base[1]);
  s.base(grd, L.rough, L.metal);
  if (v === 'new') {
    // 黒い前面（窓まわり）
    s.rect(-HW, HW, 2.0, 3.7, '#121417', .18, .3);
    s.glass(.56, 1.3, 2.3, 3.28, '', .03, ['#2e3a46', '#10151b']);
    s.glass(-1.3, -.56, 2.3, 3.28, '', .03, ['#2e3a46', '#10151b']);
    s.rect(-HW, HW, L.frontBand[0], 2.0, BLUE, .3, .15);
    s.rect(-HW, HW, L.frontLine[0], L.frontLine[1], ORANGE, .3, .1);
    s.rect(-HW, HW, Y0, 1.25, '#c1c6cc', .4, .7);
    // 貫通扉（銀）
    s.rect(-.5, .5, 1.18, 3.42, '#9aa0a7', .4, .7, .03);
    s.rect(-.44, .44, 1.22, 3.36, '#cdd2d7', .35, .8, .02);
    s.glass(-.3, .3, ss ? 2.38 : 2.20, ss ? 3.12 : 3.18, '#3d434a', .03);
    s.rect(-.2, .2, 1.24, 1.3, '#8a9097');
    // 上部の前照灯箱まわり
    s.rect(-.42, .42, 3.47, 3.72, '#0d0f11', .2, .2);
  } else {
    // 実効幅は端部の丸み（r = .3）を除いた ±1.15。前面窓・表示器はその内側に収める（外周が車体の角で見切れない）
    s.base(ss ? '#ccd0d5' : '#c9cdd3', L.rough, L.metal); // 前面は明るい灰色（6300系はステンレス）
    if (ss) for (let y = Y0 + .06; y < 2.28; y += .055) { // 6300系: 前面の腰部もコルゲート（帯・貫通扉はこの上に描く）
      s.rect(-HW, HW, y, y + .018, 'rgba(255,255,255,.22)');
      s.rect(-HW, HW, y + .018, y + .03, 'rgba(0,0,0,.1)');
    }
    s.rect(-HW, HW, L.frontBand[0], L.frontBand[1], BLUE, .35, .1);
    s.rect(-HW, HW, L.frontLine[0], L.frontLine[1], ORANGE, .35, .1);
    s.rect(-HW, HW, 1.4, 1.43, '#f3f5f8', .35, .1); // 細い白線
    // 前面窓: 左右とも正方形（約0.58m角）。上下端は貫通扉の窓とそろえる（FW）。黒ゴム枠・角の丸い四角
    const FW: V2 = ss ? [2.36, 2.96] : [2.25, 3.04];
    s.glass(ss ? .54 : .50, ss ? 1.12 : 1.18, FW[0], FW[1], '#22262b', .07);
    s.glass(ss ? -1.12 : -1.18, ss ? -.54 : -.50, FW[0], FW[1], '#22262b', .07);
    // 貫通扉と、その周りの幌の枠（灰色の太い枠）
    s.rect(-.5, .5, 1.2, 3.22, '#7f858c', .5, .1, .06);
    s.rect(-.37, .37, 1.27, 3.12, L.door, L.rough, L.metal, .04);
    s.rect(-.37, .37, L.frontBand[0], L.frontBand[1], BLUE, .35, .1);
    s.rect(-.37, .37, L.frontLine[0], L.frontLine[1], ORANGE, .35, .1);
    // 貫通扉の窓: 縦長の長方形（幅0.42m・高さは前面窓と同じ）
    s.glass(ss ? -.21 : -.25, ss ? .21 : .25, FW[0], FW[1], '#22262b', .05);
    // 車号は中央（貫通扉の窓の下、青い帯の中に白文字）
    s.text(ss ? '6301' : '7157', 0, 1.81, .2, '#f4f6fa', 600);
    // 行先表示器（左窓の上）の枠
    s.rect(.52, 1.12, 3.16, 3.4, '#15171a', .3, 0, .02);
    s.emit(-HW, HW, Y0, YTOP + .1, '#000'); // 夜は運転台の窓を光らせない
  }
  return s.textures();
}

/** 1両分のジオメトリ */
export function buildCommuterCar(v: CommuterVariant, kind: CarKind, Lb: number, ss = false): CarParts {
  const L = LOOK[v], HALF = HALFS[v], hz = Lb / 2, head = kind === 'head', zf = -hz;
  const rings: Ring[] = [...(head ? roundRings(zf, L.r, 1) : [{ z: -hz, inset: 0 }]), { z: hz, inset: 0 }];
  const shell = shellGeo(HALF, rings, YTOP, Lb);
  const b = new GeoBatch(), add = adder(b), lit = new GeoBatch(), tl = new GeoBatch(), gl = new GeoBatch();
  const glows: THREE.Vector3[] = [];
  const roofTop = YTOP;
  // 雨樋
  for (const sx of [-1, 1]) add(sx * (HW - .03), 3.56, 0, .04, .04, Lb - (head ? .6 : 0), 0x8d939a, 0, 0, 0);
  addEndWall(b, hz, YTOP, HW, v === 'new' ? 0xb9bec4 : 0xbfc3c9);
  let face: THREE.BufferGeometry | undefined, led: THREE.BufferGeometry | undefined, led2: THREE.BufferGeometry | undefined;
  let marks: CarParts['marks'];
  const mkL = new GeoBatch(), mkR = new GeoBatch();
  if (head) {
    face = capGeo(HALF, { z: zf, inset: L.r }, YTOP, HW, -1);
    const z = zf - .005;
    if (v === 'new') {
      // 貫通扉の枠（銀の張り出し）
      add(0, 3.42, z - .03, 1.04, .06, .08, 0xb8bdc3);
      for (const sx of [-1, 1]) add(sx * .5, 2.3, z - .03, .06, 2.24, .08, 0xb8bdc3);
      add(0, 1.21, z - .1, .9, .05, .22, 0x9da3aa); // 渡り板
      // 前照灯（上部中央の LED）と標識灯（帯の中）
      for (const sx of [-1, 1]) {
        lit.add('l', P.box, M(sx * .2, 3.6, z - .012, 0, .26, .1, .02), 0xffffff);
        glows.push(new THREE.Vector3(sx * .2, 3.6, z - .2));
        add(sx * 1.02, 1.79, z - .006, .42, .16, .02, 0x0e1012);
        lit.add('l', P.box, M(sx * 1.02, 1.79, z - .018, 0, .32, .09, .02), 0xffb040);
        tl.add('l', P.box, M(sx * 1.02, 1.79, z - .026, 0, .32, .09, .02), 0xffffff);
      }
      // 行先 LED（左右の黒い部分の上）
      // 左（正面から見て +X 側）= 種別、右 = 行先
      led = mergeLed([[.93, 3.42, .62]], z - .01, .17);
      led2 = mergeLed([[-.93, 3.42, .62]], z - .01, .17);
      // スカート（角ばった銀灰色）と連結器
      addTaperedSkirt(b, zf, 1.30, .97, .78, .42, 0xd3d7dc);
      add(0, .88, zf - .15, .3, .24, .5, 0x22252a);
      // ワイパー
      for (const sx of [-1, 1]) add(sx * .95, 2.38, z - .03, .55, .025, .025, 0x111111, 0, 0, sx * .35);
    } else {
      // 貫通扉まわりの幌の枠（灰色の太い枠）
      const hood = 0x7f858c;
      add(0, 3.26, z - .05, 1.08, .12, .1, hood);
      for (const sx of [-1, 1]) add(sx * .44, 2.2, z - .05, .12, 2.1, .1, hood);
      add(0, 1.2, z - .12, .9, .05, .24, 0x8f959b);
      // 前照灯: 前面最上部の中央。屋根の縁の上に、丸い2灯が横に並ぶ灯具
      add(0, 3.62, zf + .1, .86, .2, .34, 0x7a8087);
      add(0, 3.62, zf - .065, .8, .17, .02, 0x15171a);
      for (const sx of [-1, 1]) {
        b.add('paint', P.cyl, M(sx * .2, 3.62, zf - .08, 0, .22, .03, .22, Math.PI / 2), 0xdadde1);
        lit.add('l', P.cyl, M(sx * .2, 3.62, zf - .1, 0, .17, .02, .17, Math.PI / 2), 0xffffff);
        glows.push(new THREE.Vector3(sx * .2, 3.62, zf - .25));
      }
      // 標識灯（列車識別灯）: 下部の左右端に小さな四角い灯具。点灯は makeCar（普通 = 左のみ / 優等 = 両方 / 後尾 = 赤）
      const mk: [GeoBatch, number][] = [[mkL, 1], [mkR, -1]];
      for (const [bt, sx] of mk) {
        add(sx * .98, 1.28, z - .04, .3, .24, .06, 0x15171a);
        add(sx * .98, 1.28, z - .075, .33, .02, .02, 0x8f959b);
        bt.add('l', P.box, M(sx * .98, 1.28, z - .075, 0, .2, .16, .02), 0xffffff);
      }
      marks = { l: mkL.geometry('l')!, r: mkR.geometry('l')! };
      // 行先表示器（左窓の上）: 枠・庇・奥行きを付けて1面に種別 + 行先
      add(.82, 3.28, z - .015, .62, .27, ss ? .03 : .01, 0x15171a);
      add(.82, 3.425, z - .03, .66, .03, .06, 0x2a2d31);
      led = mergeLed([[.82, 3.28, .54]], ss ? z - .05 : z - .025, .2);
      // 簡易スカート・連結器・ホース
      if (ss) add(0, .78, zf + .05, 2.4, .42, .1, 0x8e9399, -.1);
      else addTaperedSkirt(b, zf, 1.30, 1.20, .66, .56, 0x8e9399);
      add(0, .9, zf - .15, .3, .24, .5, 0x22252a);
      for (const sx of [-.75, -.55, -.35]) b.add('paint', P.cyl, M(sx, 1.0, zf - .1, 0, .07, .35, .07), 0x1c1e21);
      for (const sx of [-1, 1]) add(sx * .93, 2.5, z - .03, .5, .025, .025, 0x111111, 0, 0, sx * .5);
    }
  } else addEndWall(b, -hz, YTOP, HW, v === 'new' ? 0xb9bec4 : 0xbfc3c9);
  addUnderfloor(b, Lb, kind, { frame: 0x3a3d42, equip: 0x2b2e33, bogie: 0x24272b });
  // 屋根上: 冷房装置
  if (v === 'new') {
    // セミ集中式の冷房装置（2基）と独立した車外スピーカー
    for (const z of [-4.2, 4.2]) {
      add(0, roofTop + .12, z, 1.8, .24, 2.7, 0xb5bac0);
      add(0, roofTop + .25, z, 1.4, .03, 2.2, 0x9fa5ab);
      for (const dz of [-.7, 0, .7]) add(0, roofTop + .27, z + dz, 1.0, .02, .4, 0x6a7076);
    }
    add(0, roofTop + .08, 0, .5, .16, .9, 0x9da2a8);
    add(0, roofTop + .03, 0, .5, .06, Lb - 2, 0x868b91);
  } else {
    // 分散冷房（箱形・両側にルーバー）
    // 低い箱形クーラーを約2.4m間隔で並べる（実車は1両8基ほど）
    for (const z of [-8.4, -6, -3.6, -1.2, 1.2, 3.6, 6, 8.4]) {
      if (kind === 'pan' && Math.abs(z - (-hz + 4.0)) < 1.6) continue;
      if (head && z < -8) continue;
      add(0, roofTop + .15, z, 1.3, .32, 1.3, 0xc0c4c9);
      for (const sx of [-1, 1]) for (const dz of [-.33, .33]) add(sx * .66, roofTop + .16, z + dz, .02, .18, .44, 0x3a3f45); // 側面のフィルター（1基に2つ）
    }
    for (const sx of [-.85, .85]) add(sx, roofTop - .05, 0, .06, .06, Lb - 1, 0x8a8f95); // 配管
    for (const z of [-8.2, -4, 0, 4, 8.2]) add(0, roofTop + .06, z, .3, .1, .3, 0x8a8f95); // 通風器
    if (kind === 'head') add(0, roofTop + .05, zf + .9, .5, .06, .5, 0x8a8f95);
  }
  if (kind === 'pan') (v === 'new' ? addSingleArm : addLozenge)(b, -hz + 4.0, roofTop - .02);
  return { shell, face, paint: b.geometry('paint')!, glass: gl.geometry('l') ?? undefined, led, led2, head: lit.geometry('l') ?? undefined, tail: tl.geometry('l') ?? undefined, marks, glows };
}

/** 行先 LED 面（[x, y, 幅]）を -Z 向きで */
export function mergeLed(list: [number, number, number][], z: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
  for (const [x, y, w] of list) {
    const g = new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(x, y, z).toNonIndexed();
    pos.push(...g.attributes.position.array); uv.push(...g.attributes.uv.array); nrm.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
