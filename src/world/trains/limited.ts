// 特急形（ラピート 50000系に寄せた架空塗装）: 光沢の濃い青・楕円の側窓（1両 10 枚まで）・流線形の先頭部
// （鼻先の下半分は垂直、上は大きな弧で屋根へ。正面から見て丸い顔・中央の縦の稜線・窓の下の2つの膨らみ・外側の縁に縦3灯ずつ）
import * as THREE from 'three';
import { GeoBatch, M, P, basePart } from '../batch';
import {
  Y0, adder, addEndWall, addSingleArm, addUnderfloor, shellGeo, sideSheet,
  type CarKind, type CarParts, type Ring, type SheetMaps, type V2,
} from './common';

export const HW_L = 1.42;
export const YTOP_L = 3.86;
const HALF: V2[] = [[1.16, Y0], [1.34, 1.3], [1.42, 1.8], [1.42, 2.8], [1.37, 3.28], [1.2, 3.6], [.8, 3.79], [0, YTOP_L]];
export const BLUE_L = 0x252c80;
const BLUE_CSS = '#2a318c';

/** 流線形の先頭部の長さ [m]（車体端から） */
const NOSE_LEN = 3.7;
/** 横から見た先頭部の輪郭（d = 鼻先からの距離 [m]）: 鼻先の下（スカート〜FACE_Y）は垂直、そこから屋根まで前へ膨らんだ1本の弧（超楕円、指数 PROFILE_P）。
 *  鼻先の下端で垂直に立ち上がり、屋根へ向かって寝ていく（横から見て胸が張った形。途中で凹まない） */
const FACE_Y = 1.50, PROFILE_P = 3.4;
const noseTopAt = (d: number) => {
  const t = Math.min(1, Math.max(0, (NOSE_LEN - d) / NOSE_LEN));
  return FACE_Y + (YTOP_L - FACE_Y) * Math.pow(Math.max(0, 1 - t ** PROFILE_P), 1 / PROFILE_P);
};
/** 上から見た鼻先の角の丸み（横幅の係数。鼻先は幅の 8割、PLAN_R 後ろで全幅） */
const PLAN_R = .9;
const planW = (d: number) => { const t = 1 - Math.min(1, d / PLAN_R); return .8 + .2 * Math.sqrt(Math.max(0, 1 - t * t)); };
/** 正面から見た顔の丸み: 鼻先ほど左右の端を後ろへ下げる（横方向に反った、球のように膨らんだ顔）。BOW = 端での後退量 [m] */
const BOW = .60, BOW_D = 2.4;
/** 中央の舳先: 顔の中央が前へ突き出す（幅 PROW_W、突き出し PROW [m]）。屋根の近くでは消える */
const PROW = .32, PROW_W = .28;
const NOSE_FORWARD = .85;
const smo = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
/** 外板の前後方向のずれ（+ = 後ろ）。x, y = 位置、d = 鼻先からの距離 */
const zOff = (x: number, y: number, d: number) => {
  const front = 1 - smo(d / BOW_D);
  return BOW * (x / HW_L) ** 2 * front - PROW * Math.exp(-((x / PROW_W) ** 2)) * (1 - smo((y - 3.35) / .45)) * (1 - smo(d / 2.8))
    + .14 * Math.exp(
      -(((Math.abs(x) - .65) / .35) ** 2)
      -(((y - 2.20) / .55) ** 2)
    ) * front
    - NOSE_FORWARD
      * (1 - smo((y - 1.50) / 1.75))
      * (1 - smo(d / 3.20));
};
/** 車体断面 HALF（右半分）の高さ y での半幅 */
const halfAt = (y: number) => {
  if (y <= HALF[0][1]) return HALF[0][0];
  for (let i = 1; i < HALF.length; i++) if (y <= HALF[i][1]) { const [x0, y0] = HALF[i - 1], [x1, y1] = HALF[i]; return x0 + (x1 - x0) * (y - y0) / (y1 - y0); }
  return 0;
};
/** 鼻先から d の断面: 車体の断面を高さ方向に縮め（屋根の丸みがそのまま正面から見た顔の丸みになる）、横幅は planW で絞る */
const secScale = (d: number) => (noseTopAt(d) - Y0) / (YTOP_L - Y0);
/** 車体断面の点 (x0, y0) を鼻先から d の断面へ写した位置 */
const nosePt = (hz: number, d: number, x0: number, y0: number) => {
  const x = x0 * planW(d), y = Y0 + (y0 - Y0) * secScale(d);
  return new THREE.Vector3(x, y, -hz + d + zOff(x, y, d));
};
/** 鼻先から d の断面の、高さ y での半幅（その高さに届かなければ -1） */
const widthAt = (d: number, y: number) => {
  const y0 = Y0 + (y - Y0) / secScale(d);
  return y0 > YTOP_L ? -1 : halfAt(y0) * planW(d);
};
/** 外板上の点 (x, y) の鼻先からの距離（その点を含む最初の断面）。正面から見た顔の形はこれで決まる */
const surfD = (x: number, y: number) => {
  if (widthAt(0, y) >= Math.abs(x)) return 0;
  let lo = 0, hi = NOSE_LEN;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (widthAt(m, y) >= Math.abs(x)) hi = m; else lo = m; }
  return hi;
};

/** open = 乗降口を開けた状態 */
export function paintLimitedSide(Lb: number, head: boolean, open = false): SheetMaps {
  const s = sideSheet(Lb, YTOP_L), hz = Lb / 2;
  const grd = s.c.createLinearGradient(0, 0, 0, s.H);
  grd.addColorStop(0, '#2c3494'); grd.addColorStop(.55, BLUE_CSS); grd.addColorStop(1, '#1d2368');
  s.base(grd, .2, .55);
  s.rect(-hz - 1, hz + 1, Y0, 1.16, '#151a4a', .35, .4); // 裾
  const door = (zc: number) => {
    s.rect(zc - .42, zc + .42, 1.2, 3.1, '#151a46', .3, .5, .08);
    if (open) {
      s.glass(zc - .39, zc + .39, 1.23, 3.07, '', .02, ['#4a463e', '#23262b']);
      // 夜の発光: 上が明るく床へ向かって暗い車内。床と左右の縁は光らない
      s.emit(zc - .39, zc + .39, 1.23, 3.07, s.emitGrad(1.35, 3.07, '#ffffff', '#6a5e48'));
      s.emit(zc - .39, zc + .39, 1.23, 1.35, '#000');
      for (const sg of [-1, 1]) s.emit(zc + sg * .37 - .02, zc + sg * .37 + .02, 1.23, 3.07, '#000');
      return;
    }
    s.rect(zc - .39, zc + .39, 1.23, 3.07, BLUE_CSS, .2, .55, .07);
    s.oval(zc, 2.55, .09, .38, '#151a3e');
  };
  const zd = head ? -hz + NOSE_LEN + 1.2 : -hz + 1.1;
  door(zd);
  s.rect(zd + .55, zd + .69, 2.35, 2.95, '#e8ecf4', .3, .1); // 白い標記板（無地）
  // 楕円の側窓（1両 10 枚まで、等間隔）
  const z0 = zd + 1.35, z1 = hz - .9, n = Math.min(10, Math.floor((z1 - z0) / 1.45) + 1);
  for (let i = 0; i < n; i++) s.oval(z0 + (z1 - z0) * i / Math.max(1, n - 1), 2.52, .27, .46, '#151a3e');
  return s.textures();
}

export function buildLimitedCar(kind: CarKind, Lb: number): CarParts {
  const hz = Lb / 2, head = kind === 'head';
  const b = new GeoBatch(), add = adder(b), lit = new GeoBatch(), tl = new GeoBatch(), gl = new GeoBatch();
  const glows: THREE.Vector3[] = [];
  let rings: Ring[];
  if (head) {
    rings = [{ z: -hz + NOSE_LEN, inset: 0 }, { z: hz, inset: 0 }];
    buildNose(b, lit, tl, glows, hz);
  } else {
    rings = [{ z: -hz, inset: 0 }, { z: hz, inset: 0 }];
    addEndWall(b, -hz, YTOP_L, HW_L, BLUE_L);
  }
  const shell = shellGeo(HALF, rings, YTOP_L, Lb);
  addEndWall(b, hz, YTOP_L, HW_L, BLUE_L);
  addUnderfloor(b, Lb, kind, { frame: 0x1b1d26, equip: 0x24262e, bogie: 0x202228, frontCut: head ? NOSE_LEN - 1.2 : 0 });
  // 屋根上の低いカバー
  // 屋根上の FRP 製の冷却装置カバー（青で統一。2段の低い箱）
  const cz = head ? NOSE_LEN / 2 + 1 : 0, cl = head ? Lb - NOSE_LEN - 3 : 12;
  add(0, YTOP_L + .04, cz, 1.5, .1, cl, 0x232970);
  add(0, YTOP_L + .11, cz, 1.0, .06, cl - .6, 0x2b3280);
  if (kind === 'pan') addSingleArm(b, -hz + 4.0, YTOP_L - .02);
  return { shell, paint: b.geometry('paint')!, glass: gl.geometry('g') ?? undefined, head: lit.geometry('l') ?? undefined, tail: tl.geometry('l') ?? undefined, glows };
}

/** 断面（片側）を弧長で等分し直す */
function resample(half: V2[], n: number): V2[] {
  // +X 下端 → 屋根 → -X 下端 → 床下を通って +X 下端へ（閉じた断面）
  const full: V2[] = [...half, ...half.slice(0, -1).reverse().map(([x, y]) => [-x, y] as V2), half[0]];
  const len: number[] = [0];
  for (let i = 1; i < full.length; i++) len.push(len[i - 1] + Math.hypot(full[i][0] - full[i - 1][0], full[i][1] - full[i - 1][1]));
  const out: V2[] = [];
  for (let k = 0; k <= n; k++) {
    const d = len[len.length - 1] * k / n;
    let i = 1; while (i < len.length - 1 && len[i] < d) i++;
    const f = (d - len[i - 1]) / (len[i] - len[i - 1] || 1);
    out.push([full[i - 1][0] + (full[i][0] - full[i - 1][0]) * f, full[i - 1][1] + (full[i][1] - full[i - 1][1]) * f]);
  }
  return out;
}

const sm = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** 前面窓: 高さ WS_Y、鼻先から WS_D まで（前面から側面へ回り込む。真横からは細長い窓）。正面の幅は顔の約 2/3（断面の半幅に対する比 WS_X まで） */
const WS_Y: V2 = [2.50, 3.24], WS_D = 2.15, WS_X = .80;
/** 乗務員室の小窓（側面、前面窓の後ろの縦長の楕円） */
const CREW = { d: 2.62, y: 2.78, rd: .16, ry: .3 };
const C = {
  body: new THREE.Color(BLUE_L), glass: new THREE.Color(0x07080f), mask: new THREE.Color(0x161c62), ridge: new THREE.Color(0x5560cc),
};

/** 外板の色（d = 鼻先からの距離、x, y = 位置、xr = その高さでの車体断面の半幅に対する |x| の比） */
function noseColor(out: THREE.Color, d: number, x: number, y: number, xr: number): THREE.Color {
  out.copy(C.body);
  // 窓の下の濃い紺の2つの膨らみ（正面から見て左右の楕円。間は中央の稜線）
  for (const sx of [-1, 1]) {
    const e = Math.hypot((x - sx * .5) / .52, (WS_Y[0] - y) / 1.1);
    out.lerp(C.mask, (1 - sm(.92, 1, e)) * sm(1.25, 1.35, y) * (1 - sm(1.2, 1.5, d)));
  }
  // 前面窓（縁は約 3cm でぼかす）。正面側（顔）は中央寄り WS_X まで、側面へ回り込んだ部分（xr が大きい側）は鼻先から WS_D まで
  const wy = sm(WS_Y[0] - .02, WS_Y[0] + .02, y) * (1 - sm(WS_Y[1] - .02, WS_Y[1] + .02, y));
  const wd = 1 - sm(WS_D - .03, WS_D + .03, d);
  const face = 1 - sm(WS_X - .03, WS_X + .01, xr), side = sm(.9, .96, xr);
  out.lerp(C.glass, wy * wd * Math.max(face, side));
  // 乗務員室の小窓
  out.lerp(C.glass, (1 - sm(.85, 1, Math.hypot((d - CREW.d) / CREW.rd, (y - CREW.y) / CREW.ry))) * sm(.85, .95, xr));
  // 中央の縦の稜線（屋根から鼻先まで、明るい青。窓の中は窓の仕切り）
  out.lerp(C.ridge, (1 - sm(.045, .07, Math.abs(x))) * (1 - wy * wd * .9) * (1 - sm(3.75, 3.85, y)));
  return out;
}

function buildNose(b: GeoBatch, lit: GeoBatch, tl: GeoBatch, glows: THREE.Vector3[], hz: number) {
  const add = adder(b);
  // 外板: 車体断面を縮めながら鼻先へ並べたロフト（滑らかな法線）。鼻先（d = 0）は垂直な面で閉じる
  const sec = resample(HALF, 160), NU = 70;
  const pos: number[] = [], idx: number[] = [], par: [number, number][] = [];
  for (let j = 0; j <= NU; j++) {
    const d = NOSE_LEN * (j / NU) ** 1.5; // 鼻先ほど細かく
    for (const [x0, y0] of sec) {
      const p = nosePt(hz, d, x0, y0);
      pos.push(p.x, p.y, p.z); par.push([d, Math.abs(x0) / Math.max(.01, halfAt(y0))]);
    }
  }
  const n = sec.length;
  for (let j = 0; j < NU; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, c = a + n;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const P3 = g.attributes.position, tmp = new THREE.Color(), col = new Float32Array(P3.count * 3);
  for (let k = 0; k < P3.count; k++) {
    const [d, xr] = par[k];
    noseColor(tmp, d, P3.getX(k), P3.getY(k), xr);
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const ng = g.toNonIndexed();
  b.addColored('paint', ng.attributes.position.array, ng.attributes.normal.array, ng.attributes.color.array);
  // 鼻先の垂直な面（d = 0 の断面の蓋）
  {
    const cp: number[] = [], cn: number[] = [], cc: number[] = [];
    const ring = sec.map(([x0, y0]) => nosePt(hz, 0, x0, y0)), ctr = new THREE.Vector3(0, (Y0 + FACE_Y) / 2, -hz + zOff(0, (Y0 + FACE_Y) / 2, 0));
    for (let i = 0; i < ring.length - 1; i++) for (const p of [ctr, ring[i + 1], ring[i]]) {
      cp.push(p.x, p.y, p.z); cn.push(0, 0, -1);
      noseColor(tmp, 0, p.x, p.y, 0); cc.push(tmp.r, tmp.g, tmp.b);
    }
    b.addColored('paint', cp, cn, cc);
  }
  // 外板上の点と法線（正面から見た位置 x, y）
  const surf = (x: number, y: number) => {
    const zAt = (qx: number, qy: number) => { const qd = surfD(qx, qy); return qd + zOff(qx, qy, qd); };
    const d = surfD(x, y), z = zAt(x, y), p = new THREE.Vector3(x, y, -hz + z);
    const ex = new THREE.Vector3(.02, 0, zAt(x + .02, y) - z), ey = new THREE.Vector3(0, .02, zAt(x, y + .02) - z);
    void d;
    const nrm = ex.clone().cross(ey).normalize(); if (nrm.z > 0) nrm.negate();
    return { p, nrm };
  };
  // 灯具: 顔の外側の縁に、小さい丸を縦に3個ずつ（上2つ = 前照灯、下 = 尾灯）
  for (const sx of [-1, 1]) for (const [y, kind] of [[3.12, 'off'], [2.78, 't'], [2.42, 'h']] as const) {
    const { p, nrm } = surf(sx * halfAt(y) * .86, y);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    const m = (k: number, r: number, h: number) => new THREE.Matrix4().compose(p.clone().addScaledVector(nrm, k), q, new THREE.Vector3(r, h, r));
    b.add('paint', P.cyl, m(.01, .2, .04), 0x9aa2b6); // 銀の縁
    b.add('paint', P.cyl, m(.025, .16, .02), 0x0a0c14);
    if (kind !== 'off') (kind === 'h' ? lit : tl).add('l', P.cyl, m(.035, .12, .02), 0xffffff);
    if (kind === 'h') glows.push(p.clone().addScaledVector(nrm, .25));
  }
  // 乗務員室の後ろの側面の溝（3本の水平なえら）
  for (const sx of [-1, 1]) for (const y of [3.0, 2.55, 2.1]) {
    const d0 = 3.0, d1 = 3.65, w0 = widthAt(d0, y), w1 = widthAt(d1, y);
    if (w0 < 0 || w1 < 0) continue;
    const a = new THREE.Vector3(sx * (w0 + .005), y, -hz + d0), c = new THREE.Vector3(sx * (w1 + .005), y, -hz + d1);
    const mid = a.clone().add(c).multiplyScalar(.5);
    b.add('paint', P.box, M(mid.x, mid.y, mid.z, Math.atan2(c.x - a.x, c.z - a.z), .03, .05, a.distanceTo(c)), 0x0b0e2a);
  }
  // 鼻先の下半分（垂直な面）= スカート: 上から見た輪郭を押し出し、高さ SK_Y0 〜 車体の下端
  const SK_D = 2.2, SK_Y0 = .4;
  const skirtP = (d: number, sx: number): [number, number] => { const x = sx * HALF[0][0] * planW(d) * .98; return [x, -hz + d + zOff(x, .9, d)]; };
  const outline: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) { const [x, z] = skirtP(SK_D * (1 - k / 16), 1); outline.push(new THREE.Vector2(x, -z)); }
  // 前端（d = 0 の辺）: 中央の舳先へ向かって前へ反る
  for (let k = 1; k < 12; k++) { const x = HALF[0][0] * planW(0) * .98 * (1 - 2 * k / 12); outline.push(new THREE.Vector2(x, hz - zOff(x, .9, 0))); }
  for (let k = 0; k <= 16; k++) { const [x, z] = skirtP(SK_D * k / 16, -1); outline.push(new THREE.Vector2(x, -z)); }
  const skirt = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: Y0 + .02 - SK_Y0, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, SK_Y0, 0);
  b.add('paint', basePart(skirt), new THREE.Matrix4(), 0x1f2570);
  // スカートの丸いボルト頭: 外周に沿って一列
  const bolt = (x: number, z: number, nx: number, nz: number) => {
    const nv = new THREE.Vector3(nx, 0, nz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nv);
    b.add('paint', P.cyl, new THREE.Matrix4().compose(new THREE.Vector3(x, .95, z).addScaledVector(nv, .006), q, new THREE.Vector3(.07, .03, .07)), 0x9aa2b6);
  };
  for (const sx of [-1, 1]) for (const d of [.25, .55, .9, 1.3, 1.7, 2.1]) {
    const [x, z] = skirtP(d, sx), [x2, z2] = skirtP(d + .01, sx);
    // 外向きの法線（輪郭の接線を横へ回す）
    bolt(x, z, sx * (z2 - z), -sx * (x2 - x));
  }
  for (const bx of [-.6, -.3, .3, .6]) bolt(bx, -hz + zOff(bx, .9, 0), 0, -1);
  // ワイパー（前面窓の下端）
  for (const sx of [-1, 1]) {
    const { p } = surf(sx * .5, WS_Y[0] + .06);
    add(p.x, p.y, p.z - .03, .45, .02, .02, 0x111111, 0, 0, sx * .35);
  }
}
