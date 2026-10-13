// 1000系（モブ。本線の対向列車・留置車両）・2000系（モブ。高野線の 8両と支線の 2両）と、前面の上半分が後ろへ傾いた車両の共通部品（30000系も使う）
//  1000系: 20m 級4扉・6両固定。8300系と同じ拡幅・すそ絞りの車体で、塗装は 7100系と同じ（銀灰色に青・橙の帯。先頭で斜めに立ち上がる）。
//          前面は大きな窓が少し後ろへ傾き、中央に銀色の貫通扉。前照灯と標識灯はガラスの下の青帯に一体化。
//          窓配置: 扉間2枚、中間車の車端は片側1枚ずつ
//  2000系: 17m 級（ゲームでは 18m）2扉（ズームカー）。1000系に近い顔と帯で、車体はステンレス無塗装の銀。
//          編成は支線用 2両・高野線用 4両 × 2 の 8両
import * as THREE from 'three';
import { GeoBatch, M, P } from '../batch';
import {
  Y0, adder, addEndWall, addLozenge, addSingleArm, addTaperedSkirt, addUnderfloor, capGeo, faceSheet, roundRings, shellGeo, sideSheet, sweepBand,
  type CarKind, type CarParts, type Ring, type SheetMaps, type V2,
} from './common';

// ---------- 傾いた前面（共通） ----------

/** 前面の傾き: 高さ knee から上を屋根まで depth [m] 後ろへ、左右の端を bow [m] 後ろへ（上から見て丸い顔） */
export interface Slant { depth: number; bow: number; hw: number; ytop: number }
/** 前面の knee は前面の中心高さ（capGeo の扇の中心）。扇の三角形が折れ目と一致して平面になる */
const kneeOf = (sl: Slant) => (Y0 + sl.ytop) / 2;
/** 前端からの後退量 [m]（x, y = 前面上の位置） */
export function slantZ(sl: Slant, x: number, y: number): number {
  const k = kneeOf(sl), t = Math.min(1, Math.max(0, (y - k) / (sl.ytop - k)));
  return sl.depth * t + sl.bow * (x / sl.hw) ** 2;
}
/** 高さ y での前面の傾き（dz/dy） */
export const slantSlope = (sl: Slant, y: number): number => y > kneeOf(sl) ? sl.depth / (sl.ytop - kneeOf(sl)) : 0;

/** 先頭部の外板リング（丸み r の後ろに、傾きが収まるまでのリングを足す） */
export function slantRings(zf: number, r: number, sl: Slant): Ring[] {
  const d = sl.depth + sl.bow;
  return [...roundRings(zf, r, 1), { z: zf + d * .35, inset: 0 }, { z: zf + d * .7, inset: 0 }, { z: zf + d + .12, inset: 0 }];
}
/** 外板・前面の頂点を傾いた前面へ押し込む（z が前面より前にある頂点だけ）。cap = 前面（全頂点を前面に乗せる） */
export function applySlant(g: THREE.BufferGeometry, zf: number, sl: Slant, cap: boolean): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), zs = zf + slantZ(sl, x, y);
    if (cap || z < zs) p.setZ(i, zs);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
/** 傾いた前面に貼る行先 LED（[x, y, 幅]、高さ h）。面に沿って傾け、少し浮かせる */
export function slantLed(sl: Slant, zf: number, list: [number, number, number][], h: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
  for (const [x, y, w] of list) {
    const a = Math.atan(slantSlope(sl, y));
    const g = new THREE.PlaneGeometry(w, h).rotateY(Math.PI).rotateX(a).translate(x, y, zf + slantZ(sl, x, y) - .02).toNonIndexed();
    pos.push(...g.attributes.position.array); uv.push(...g.attributes.uv.array); nrm.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** 客用扉（閉 / 開）を側面シートに描く。開 = 暗い車内（夜は点灯）と引き込まれた扉の縁 */
export function paintDoor(s: ReturnType<typeof sideSheet>, zc: number, w: number, y1: number, win: V2, col: string, open: boolean, dbl: boolean) {
  s.rect(zc - w / 2 - .03, zc + w / 2 + .03, 1.13, y1 + .03, '#868c93', .5, .3);
  if (open && dbl) {
    s.glass(zc - w / 2, zc + w / 2, 1.16, y1, '', 0, ['#4a463e', '#23262b']);
    s.rect(zc - w / 2, zc + w / 2, 1.16, 1.3, '#5b5f66', .6, .1);
    s.rect(zc - w / 2, zc + w / 2, y1 - .07, y1, '#d9d6c8', .5, 0);
    for (const sg of [-1, 1]) s.rect(zc + sg * (w / 2 - .06) - .06, zc + sg * (w / 2 - .06) + .06, 1.16, y1, col, .4, .7);
    s.emit(zc - w / 2, zc + w / 2, 1.16, y1, s.emitGrad(1.3, y1, '#ffffff', '#6a5e48'));
    s.emit(zc - w / 2, zc + w / 2, 1.16, 1.3, '#000');
    for (const sg of [-1, 1]) s.emit(zc + sg * (w / 2 - .06) - .06, zc + sg * (w / 2 - .06) + .06, 1.16, y1, '#000');
    return;
  }
  s.rect(zc - w / 2, zc + w / 2, 1.16, y1, col, .4, .7);
  if (dbl) {
    s.rect(zc - .012, zc + .012, 1.16, y1, '#5e646b');
    for (const sg of [-1, 1]) s.glass(zc + sg * w / 4 - .2, zc + sg * w / 4 + .2, win[0], win[1], '#5a6067', .06);
  } else s.glass(zc - .19, zc + .19, win[0], win[1], '#5a6067', .03);
}

// ---------- 1000系・2000系 ----------

export type NewLiveryModel = '1000' | '2000';
/** 帯（7100系と同じ。world/trains/commuter.ts の LOOK.old）。2000系は屋根が低いので幕板の帯を下げる（Spec.top） */
const L7100 = {
  base: ['#c6cbd6', '#b3b9c6'] as [string, string], blue: '#2f3fa8', orange: '#f0961c',
  topBand: [3.4, 3.65] as V2, topLine: [3.26, 3.37] as V2, lowBand: [1.44, 1.53] as V2, lowLine: [1.34, 1.43] as V2,
  frontBand: [1.6, 2.04] as V2, frontLine: [1.49, 1.56] as V2,
};

interface Spec {
  hw: number; ytop: number; half: V2[]; slant: Slant; r: number;
  doors: number[]; doorW: number; win: V2; roofY: number;
  /** 車体の地（グラデーションの上・下）と粗さ・金属度 */
  base: [string, string]; rough: number; metal: number;
  /** 幕板の帯 [青, 橙]（車種で高さが違う） */
  top: [V2, V2];
  crewOff: number; crewW: number;
  /** 前面: 窓の上下、前面の地色、車番 */
  fwin: V2; face: string; num: string;
}
const ROOF = (hw: number, ytop: number): V2[] => [[hw, ytop - .42], [hw - .05, ytop - .26], [hw - .3, ytop - .13], [hw - .75, ytop - .04], [0, ytop]];
const SPEC: Record<NewLiveryModel, Spec> = {
  '1000': {
    hw: 1.45, ytop: 3.84, half: [[1.39, Y0], [1.45, 1.5], ...ROOF(1.45, 3.84)], slant: { depth: .3, bow: .14, hw: 1.45, ytop: 3.84 }, r: .2,
    doors: [-7.2, -2.4, 2.4, 7.2], doorW: 1.3, win: [2.08, 2.90], roofY: 3.7,
    base: L7100.base, rough: .42, metal: .12, top: [L7100.topBand, L7100.topLine],
    crewOff: .55, crewW: .64, fwin: [2.2, 3.58], face: '#c9cdd3', num: '1010',
  },
  '2000': {
    hw: 1.4, ytop: 3.8, half: [[1.34, Y0], [1.4, 1.48], ...ROOF(1.4, 3.8)], slant: { depth: .28, bow: .14, hw: 1.4, ytop: 3.8 }, r: .18,
    doors: [-4.3, 4.3], doorW: 1.3, win: [2.0, 2.92], roofY: 3.4,
    base: ['#d8dce0', '#b5bbc2'], rough: .36, metal: .78, top: [[3.18, 3.34], [3.05, 3.14]],
    crewOff: .58, crewW: .6, fwin: [2.2, 3.52], face: '#cdd1d6', num: '2186',
  },
};

/** 側面（head = 前端 -Z に乗務員扉）。open = 客用扉を開けた状態 */
export function paintNewLiverySide(m: NewLiveryModel, Lb: number, head: boolean, open = false): SheetMaps {
  const S = SPEC[m], s = sideSheet(Lb, S.ytop), hz = Lb / 2, [w0, w1] = S.win;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H); grd.addColorStop(0, S.base[0]); grd.addColorStop(1, S.base[1]);
  s.base(grd, S.rough, S.metal);
  s.rect(-hz - 1, hz + 1, S.roofY, S.ytop + .1, '#a3a8ae', .6, .45);
  if (m === '2000') {
    // ダルフィニッシュのビード（腰板の細い横筋）と外板継ぎ目
    for (let y = 1.2; y < 1.6; y += .06) s.rect(-hz, hz, y, y + .014, 'rgba(255,255,255,.16)');
    for (let z = -hz + 1.6; z < hz; z += 2.9) s.rect(z, z + .015, Y0, S.roofY, 'rgba(0,0,0,.05)');
  }
  // 1000系の乗務員扉と最初の客用扉の間には客室窓を置かない。
  const D = S.doors;
  {
    // 7100系と同じ帯: 幕板の太い青＋細い橙、腰の青＋橙。先頭車は前面の帯から斜めに立ち上がる
    const L = L7100, [tb, tl] = S.top, band = (b: V2, col: string, z0 = -hz - 1) => s.rect(z0, hz + 1, b[0], b[1], col, .35, .1);
    if (head) {
      const zs = -hz + S.crewOff + S.crewW / 2 + .06, k = .62;
      sweepBand(s, Lb, L.frontLine, tl, zs + .12, k, L.orange, .35, .1);
      sweepBand(s, Lb, L.frontBand, tb, zs, k, L.blue, .35, .1, -.12);
      band(L.lowBand, L.blue, D[0]); band(L.lowLine, L.orange, D[0]);
    } else { band(tb, L.blue); band(tl, L.orange); band(L.lowBand, L.blue); band(L.lowLine, L.orange); }
  }
  const y1 = 3.05, dc = m === '2000' ? '#c6cbd1' : '#c9ccd1';
  for (const d of D) paintDoor(s, d, S.doorW, y1, S.win, dc, open, true);
  const win = (z0: number, z1: number) => s.glass(z0, z1, w0, w1, '#3d4248', .05);
  /** 区間 [a, b] に n 枚の窓（間に窓柱 gap） */
  const row = (a: number, b: number, n: number, gap = .12, pad = .2) => {
    const w = m === '1000'
      ? w1 - w0
      : (b - a - 2 * pad - gap * (n - 1)) / n;
    const start = m === '1000'
      ? (a + b - n * w - gap * (n - 1)) / 2
      : a + pad;
    for (let i = 0; i < n; i++) {
      const z0 = start + i * (w + gap);
      win(z0, z0 + w);
    }
  };
  const dw = S.doorW / 2;
  for (let i = 0; i < D.length - 1; i++) row(D[i] + dw, D[i + 1] - dw, m === '1000' ? 2 : 3, .12, m === '1000' ? .5 : .2);
  row(D[D.length - 1] + dw, hz, m === '1000' ? 1 : 2, .12, .3);
  if (head) {
    const crewZ = -hz + S.crewOff;
    paintDoor(s, crewZ, S.crewW, y1, S.win, dc, false, false);
    if (m === '2000') row(crewZ + S.crewW / 2, D[0] - dw, 1, .12, .25);
  } else row(-hz, D[0] - dw, m === '1000' ? 1 : 2, .12, .3);
  s.rect(D[1] - .9, D[1] - .55, 3.28, 3.38, '#22272d'); // 号車札（文字なし）
  return s.textures();
}

/** 前面シート（正面から見て左 = +X）。1000系・2000系共通: 銀色の地に左右の大きな窓（黒い枠）、中央に銀色の貫通扉。
 *  窓の下の青帯に灯具（外側 = 標識灯、内側 = 前照灯）、その下に橙の細帯 */
export function paintNewLiveryFace(m: NewLiveryModel): SheetMaps {
  const S = SPEC[m], s = faceSheet(S.hw, S.ytop), hw = S.hw, L = L7100, [f0, f1] = S.fwin, xo = hw - S.r - .01;
  s.base(S.face, S.rough, S.metal);
  // 実効幅は端部の丸み（r）を除いた ±xo。窓は貫通扉の両側を大きく取る
  for (const sx of [-1, 1]) {
    s.rect(sx * .5, sx * xo, f0 - .06, f1 + .04, '#14171b', .2, .2, .05);
    s.glass(sx * .55, sx * (xo - .05), f0, f1 - .02, '', .04, ['#2e3a46', '#10151b']);
  }
  s.rect(-hw, hw, L.frontBand[0], L.frontBand[1], L.blue, .35, .1);
  s.rect(-hw, hw, L.frontLine[0], L.frontLine[1], L.orange, .35, .1);
  // 貫通扉（銀色の枠・扉。窓は縦長、帯は扉にも通す）
  s.rect(-.45, .45, 1.22, f1 + .08, '#a9aeb4', .45, .3, .04);
  s.rect(-.38, .38, 1.27, f1, '#d0d4d9', .4, .2, .03);
  if (m !== '1000') s.glass(-.25, .25, 2.32, f1 - .16,
    '#3d434a', .03, ['#24303a', '#0f1418']);
  s.rect(-.38, .38, L.frontBand[0], L.frontBand[1], L.blue, .35, .1);
  s.rect(-.38, .38, L.frontLine[0], L.frontLine[1], L.orange, .35, .1);
  if (m === '1000') s.glass(-.25, .25, 1.94, 3.15,
    '#3d434a', .03, ['#24303a', '#0f1418']);
  // 灯具の黒いケース（青帯の中、左右）
  const lc = (hw - .2 + .5) / 2; // 灯具の中心（貫通扉と車体の角の間）
  for (const sx of [-1, 1]) s.rect(sx * lc - .3, sx * lc + .3, 1.7, 1.92, '#0e1012', .2, .3, .04);
  s.text(S.num, -lc, 1.98, .09, '#f4f6fa', 700);
  s.emit(-hw, hw, Y0, S.ytop + .1, '#000'); // 夜は運転台の窓を光らせない
  return s.textures();
}

/** 1両分のジオメトリ */
export function buildNewLiveryCar(m: NewLiveryModel, kind: CarKind, Lb: number): CarParts {
  const S = SPEC[m], hz = Lb / 2, head = kind === 'head', zf = -hz, sl = S.slant, roofTop = S.ytop;
  const rings: Ring[] = [...(head ? slantRings(zf, S.r, sl) : [{ z: -hz, inset: 0 }]), { z: hz, inset: 0 }];
  const shell = shellGeo(S.half, rings, S.ytop, Lb);
  if (head) applySlant(shell, zf, sl, false);
  const b = new GeoBatch(), add = adder(b), lit = new GeoBatch(), mkL = new GeoBatch(), mkR = new GeoBatch();
  const glows: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) add(sx * (S.hw - .03), S.roofY + .02, head ? 1 : 0, .04, .04, Lb - (head ? 2 : 0), 0x8d939a); // 雨樋
  addEndWall(b, hz, S.ytop, S.hw, 0xb9bec4);
  let face: THREE.BufferGeometry | undefined, led: THREE.BufferGeometry | undefined, led2: THREE.BufferGeometry | undefined, marks: CarParts['marks'];
  if (head) {
    face = applySlant(capGeo(S.half, { z: zf, inset: S.r }, S.ytop, S.hw, -1), zf, sl, true);
    const zAt = (x: number, y: number) => zf + slantZ(sl, x, y) - .006;
    // 貫通扉の枠・渡り板・手すり
    for (const sx of [-1, 1]) add(sx * .45, 1.9, zAt(sx * .45, 1.9) - .02, .05, 1.5, .05, 0xa6acb2);
    add(0, 1.2, zAt(0, 1.2) - .1, .84, .05, .22, 0x9da3aa);
    // 前照灯（内側）と標識灯（外側）: 窓の下の青帯の中に一体の灯具
    const lc = (S.hw - .2 + .5) / 2, ly = 1.81, lx = lc - .12, mx = lc + .13;
    for (const sx of [-1, 1]) {
      const zl = zAt(sx * lc, ly);
      lit.add('l', P.box, M(sx * lx, ly, zl - .02, 0, .2, .13, .02), 0xffffff);
      glows.push(new THREE.Vector3(sx * lx, ly, zl - .2));
      (sx > 0 ? mkL : mkR).add('l', P.box, M(sx * mx, ly, zl - .02, 0, .17, .12, .02), 0xffffff);
    }
    marks = { l: mkL.geometry('l')!, r: mkR.geometry('l')! };
    // 行先 LED: 左右の窓の内側上部（左 = 種別、右 = 行先）
    const lw = S.hw - S.r - .55, lxc = .55 + lw / 2 + .02, lyc = S.fwin[1] - .16;
    led = slantLed(sl, zf, [[lxc, lyc, lw - .08]], .15); led2 = slantLed(sl, zf, [[-lxc, lyc, lw - .08]], .15);
    // スカート・連結器・ホース
    if (m === '1000') addTaperedSkirt(b, zf, 1.30, 1.22, .92, .88, 0x9ca2a9);
    else {
      for (const sx of [-1, 1]) b.add('paint', P.box, M(sx * .92, .72, zf + .06, sx * .18, .95, .6, .08, -.2), 0x9ca2a9);
      add(0, .48, zf + .02, 1.1, .1, .1, 0x9ca2a9, -.2);
    }
    add(0, .88, zf - .1, .3, .24, .5, 0x22252a);
    for (const sx of [-.5, -.35, .35]) b.add('paint', P.cyl, M(sx, 1.0, zf - .05, 0, .07, .34, .07), 0x1c1e21);
    // ワイパー（傾いた窓の下端）
    for (const sx of [-1, 1]) add(sx * .88, S.fwin[0] + .06, zAt(sx * .88, S.fwin[0] + .06) - .03, .5, .025, .025, 0x111111, 0, 0, sx * .35);
    // 屋根上の無線アンテナ
    add(0, roofTop + .04, zf + 1.3, .7, .05, .3, 0x6f747a);
  } else addEndWall(b, -hz, S.ytop, S.hw, 0xb9bec4);
  addUnderfloor(b, Lb, kind, { frame: 0x3a3d42, equip: 0x2b2e33, bogie: 0x24272b });
  if (m === '1000') {
    // 低く長い冷房カバーを屋根中央に3基。前後端は斜めに下がる。
    for (const z of [-3.8, 0, 3.8]) {
      add(0, roofTop + .035, z, 1.7, .05, 3.7, 0xb5bac0);
      add(0, roofTop + .125, z, 1.7, .18, 3.1, 0xb5bac0);
      add(0, roofTop + .225, z, 1.7, .02, 3.1, 0xc4c8cc);
      for (const end of [-1, 1]) add(0, roofTop + .145, z + end * 1.69, 1.7, .035, .36, 0xc4c8cc, end * .5);
      for (const side of [-1, 1]) for (const dz of [-.8, .8]) {
        add(side * .855, roofTop + .13, z + dz, .018, .1, .72, 0x565d64);
        for (const dy of [-.025, 0, .025]) add(side * .866, roofTop + .13 + dy, z + dz, .01, .008, .72, 0x9fa5ab);
      }
    }
  } else {
    // 2000系: 箱形の冷房装置を4基（側面に丸い吸い込み口）
    for (const z of [-6, -2.2, 1.6, 5.4]) {
      if (Math.abs(z - (hz - 3.0)) < 1.2) continue;
      add(0, roofTop + .14, z, 1.4, .3, 1.8, 0xc4c8cd);
      for (const sx of [-1, 1]) for (const dz of [-.45, 0, .45]) add(sx * .71, roofTop + .15, z + dz, .02, .14, .2, 0x3a3f45);
    }
  }
  add(0, roofTop + .03, 0, .45, .06, Lb - 3, 0x868b91);
  // パンタ: 1000系は中間車（シングルアーム）、2000系は各車の連結面寄り（菱形。2両編成でも付くように先頭車にも）
  if (m === '1000' && kind !== 'head') addSingleArm(b, -hz + 3.4, roofTop - .02);
  if (m === '2000' && kind !== 'mid') addLozenge(b, hz - 3.0, roofTop - .02);
  return { shell, face, paint: b.geometry('paint')!, led, led2, head: lit.geometry('l') ?? undefined, marks, glows };
}
