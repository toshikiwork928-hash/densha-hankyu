// 車両モデルの共通部品: 車体断面の押し出し（端部の丸み付き）、塗装キャンバス、行先LED、台車・床下・パンタグラフ
// 座標: 原点 = 車両中心のレール面、前 = -Z、右 = +X
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FONT } from '../../core/config';
import { basePart, GeoBatch, M, P } from '../batch';

export type V2 = [number, number];
export type CarKind = 'head' | 'mid' | 'pan';

/** 車体下端 */
export const Y0 = 1.05;

let envTex: THREE.Texture | null = null;
export function envMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!envTex) {
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromScene(new RoomEnvironment(), .04).texture;
    pm.dispose();
  }
  return envTex;
}

export function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

export function canvasTexture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

export interface SheetMaps { map: THREE.Texture; emissive: THREE.Texture; rm: THREE.Texture }

/** 塗装シート: 色・発光マスク・粗さ金属度（G=粗さ, B=金属度）を同時に塗る。座標は (u[m], y[m]) */
export class Sheet {
  readonly c: CanvasRenderingContext2D; readonly e: CanvasRenderingContext2D; readonly r: CanvasRenderingContext2D;
  private cc: HTMLCanvasElement; private ec: HTMLCanvasElement; private rc: HTMLCanvasElement;
  constructor(readonly W: number, readonly H: number, readonly X: (u: number) => number, readonly Y: (y: number) => number) {
    [this.cc, this.c] = cv(W, H); [this.ec, this.e] = cv(W, H); [this.rc, this.r] = cv(W, H);
    this.e.fillStyle = '#000'; this.e.fillRect(0, 0, W, H);
  }
  private rm(rough: number, metal: number) { return `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`; }
  /** 全面の地塗り（色はグラデーション可） */
  base(fill: string | CanvasGradient, rough: number, metal: number) {
    this.c.fillStyle = fill; this.c.fillRect(0, 0, this.W, this.H);
    this.r.fillStyle = this.rm(rough, metal); this.r.fillRect(0, 0, this.W, this.H);
  }
  private path(g: CanvasRenderingContext2D, pts: V2[]) {
    g.beginPath(); pts.forEach(([u, y], i) => i ? g.lineTo(this.X(u), this.Y(y)) : g.moveTo(this.X(u), this.Y(y))); g.closePath();
  }
  poly(pts: V2[], col: string, rough?: number, metal?: number) {
    this.c.fillStyle = col; this.path(this.c, pts); this.c.fill();
    if (rough != null) { this.r.fillStyle = this.rm(rough, metal ?? 0); this.path(this.r, pts); this.r.fill(); }
  }
  rect(u0: number, u1: number, y0: number, y1: number, col: string, rough?: number, metal?: number, rad = 0) {
    const x0 = Math.min(this.X(u0), this.X(u1)), x1 = Math.max(this.X(u0), this.X(u1));
    const ya = this.Y(y1), yb = this.Y(y0);
    const draw = (g: CanvasRenderingContext2D) => {
      g.beginPath();
      if (rad > 0) g.roundRect(x0, ya, x1 - x0, yb - ya, rad * (this.H / 3)); else g.rect(x0, ya, x1 - x0, yb - ya);
      g.fill();
    };
    this.c.fillStyle = col; draw(this.c);
    if (rough != null) { this.r.fillStyle = this.rm(rough, metal ?? 0); draw(this.r); }
    return draw;
  }
  /** 窓ガラス（枠つき・発光マスク付き） */
  glass(u0: number, u1: number, y0: number, y1: number, frame = '#4c5258', rad = .05, tint: [string, string] = ['#3b4a58', '#1b232c']) {
    if (frame) this.rect(u0 - .045 * Math.sign(u1 - u0), u1 + .045 * Math.sign(u1 - u0), y0 - .045, y1 + .045, frame, .5, 0, rad + .02);
    const gg = this.c.createLinearGradient(0, this.Y(y1), 0, this.Y(y0)); gg.addColorStop(0, tint[0]); gg.addColorStop(1, tint[1]);
    const draw = this.rect(u0, u1, y0, y1, gg as unknown as string, .06, .2, rad);
    this.e.fillStyle = '#fff'; draw(this.e);
  }
  /** 発光マスクだけを矩形で塗り直す（色は変えない）。fill は CSS 色または emitGrad の戻り値 */
  emit(u0: number, u1: number, y0: number, y1: number, fill: string | CanvasGradient) {
    const x0 = Math.min(this.X(u0), this.X(u1)), x1 = Math.max(this.X(u0), this.X(u1));
    this.e.fillStyle = fill; this.e.fillRect(x0, this.Y(y1), x1 - x0, this.Y(y0) - this.Y(y1));
  }
  /** 発光マスク用の縦グラデーション（y1 側 = 上端の色） */
  emitGrad(y0: number, y1: number, top: string, bottom: string): CanvasGradient {
    const g = this.e.createLinearGradient(0, this.Y(y1), 0, this.Y(y0)); g.addColorStop(0, top); g.addColorStop(1, bottom); return g;
  }
  /** 楕円窓 */
  oval(u: number, y: number, ru: number, ry: number, frame: string) {
    const ell = (g: CanvasRenderingContext2D, k: number) => {
      g.beginPath(); g.ellipse(this.X(u), this.Y(y), Math.abs(this.X(u + ru) - this.X(u)) + k, Math.abs(this.Y(y + ry) - this.Y(y)) + k, 0, 0, Math.PI * 2); g.fill();
    };
    this.c.fillStyle = frame; ell(this.c, 4); this.r.fillStyle = this.rm(.25, .6); ell(this.r, 4);
    const gg = this.c.createLinearGradient(0, this.Y(y + ry), 0, this.Y(y - ry)); gg.addColorStop(0, '#36435a'); gg.addColorStop(1, '#141a26');
    this.c.fillStyle = gg; ell(this.c, 0); this.r.fillStyle = this.rm(.06, .2); ell(this.r, 0);
    this.e.fillStyle = '#fff'; ell(this.e, 0);
  }
  line(u0: number, y0: number, u1: number, y1: number, col: string, px = 2) {
    const g = this.c; g.strokeStyle = col; g.lineWidth = px; g.beginPath(); g.moveTo(this.X(u0), this.Y(y0)); g.lineTo(this.X(u1), this.Y(y1)); g.stroke();
  }
  text(s: string, u: number, y: number, sizeM: number, col: string, weight = 700) {
    const g = this.c; g.fillStyle = col; g.font = `${weight} ${Math.round(sizeM * Math.abs(this.Y(0) - this.Y(1)))}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, this.X(u), this.Y(y));
  }
  textures(): SheetMaps { return { map: canvasTexture(this.cc, true), emissive: canvasTexture(this.ec, true), rm: canvasTexture(this.rc, false) }; }
}

/** 側面用シート（u = z。左右の側面で共用するので文字は描かない） */
export function sideSheet(Lb: number, ytop: number, W = 2048, H = 256): Sheet {
  return new Sheet(W, H, z => (z + Lb / 2) / Lb * W, y => (ytop - y) / (ytop - Y0) * H);
}
/** 前面用シート（u = x。正面から見て左 = +X をキャンバス左に） */
export function faceSheet(hw: number, ytop: number, W = 512, H = 512): Sheet {
  return new Sheet(W, H, x => (hw - x) / (2 * hw) * W, y => (ytop - y) / (ytop - Y0) * H);
}

/**
 * 側帯（前面の帯 → 乗務員扉の後ろで斜めに立ち上がり → 幕板の帯）。
 * lo = 前端での [下, 上]、hi = 後方での [下, 上]、zs = 立ち上がり開始位置、k = 斜線の傾き [z/y]
 */
export function sweepBand(s: Sheet, Lb: number, lo: V2, hi: V2, zs: number, k: number, col: string, rough: number, metal: number, dz = 0) {
  const hz = Lb / 2;
  s.poly([
    [-hz - .1, lo[0]], [zs, lo[0]], [zs + k * (hi[0] - lo[0]), hi[0]], [hz + .1, hi[0]],
    [hz + .1, hi[1]], [zs + dz + k * (hi[1] - lo[1]), hi[1]], [zs + dz, lo[1]], [-hz - .1, lo[1]],
  ], col, rough, metal);
}

/** 押し出しの断面位置。inset = 端部の丸めによる縮み、clip = 上端の頭打ち関数 */
export interface Ring { z: number; inset: number; clip?: (x: number, y: number) => number }

/** 端部の丸み用リング列（zEnd = 端面、dir = 内側へ向かう符号） */
export function roundRings(zEnd: number, r: number, dir: 1 | -1, n = 5): Ring[] {
  if (r <= 0) return [{ z: zEnd, inset: 0 }];
  const out: Ring[] = [];
  for (let i = n; i >= 0; i--) { const a = Math.PI / 2 * (i / n); out.push({ z: zEnd + dir * (r - r * Math.sin(a)), inset: r - r * Math.cos(a) }); }
  return out; // 端面 → 内側
}

/** 片側断面（右半分: 下端 → 屋根中心）を全周断面に */
export function fullSection(half: V2[]): V2[] {
  const left = half.slice(0, -1).reverse().map(([x, y]) => [-x, y] as V2);
  return [...half, ...left];
}

function ringPoint(p: V2, rg: Ring, ytop: number): V2 {
  const [x, y] = p, w = Math.min(1, Math.max(0, (y - (ytop - 1)) / 1));
  const xi = Math.sign(x) * Math.max(0, Math.abs(x) - rg.inset);
  let yi = y - rg.inset * w;
  if (rg.clip) yi = Math.min(yi, rg.clip(xi, yi));
  return [xi, yi];
}

/** 車体外板（インデックス付き・滑らかな法線）。uv: u = z、v = y（側面シートに対応） */
export function shellGeo(half: V2[], rings: Ring[], ytop: number, Lb: number): THREE.BufferGeometry {
  const sec = fullSection(half), n = sec.length;
  const rs = [...rings].sort((a, b) => a.z - b.z);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const rg of rs) for (const p of sec) {
    const [x, y] = ringPoint(p, rg, ytop);
    pos.push(x, y, rg.z); uv.push((rg.z + Lb / 2) / Lb, (y - Y0) / (ytop - Y0));
  }
  // 外板は +X 側（右半分）と -X 側（左半分）を別グループにする（ドアを開ける側だけ材質を替えるため。group 0 = +X、1 = -X）
  const idxL: number[] = [], m = half.length;
  for (let j = 0; j < rs.length - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    // 外向き: 断面は +X 下端から反時計回り（正面 -Z から見て）
    (i < m - 1 ? idx : idxL).push(a, b, d, a, d, c);
  }
  const nR = idx.length;
  idx.push(...idxL);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.addGroup(0, nR, 0); g.addGroup(nR, idx.length - nR, 1);
  return g;
}

/** 端面（扇形）。facing = -1 で -Z 向き。uv は前面シート座標（正面左 = +X） */
export function capGeo(half: V2[], rg: Ring, ytop: number, hw: number, facing: -1 | 1): THREE.BufferGeometry {
  const sec = fullSection(half).map(p => ringPoint(p, rg, ytop));
  const cx = 0, cy = (Y0 + ytop) / 2;
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], col: number[] = [];
  const U = (x: number) => (hw - x) / (2 * hw), V = (y: number) => (y - Y0) / (ytop - Y0);
  const pts: V2[] = [...sec, sec[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const A: V2 = [cx, cy], B = pts[i], C = pts[i + 1];
    const tri = facing < 0 ? [A, C, B] : [A, B, C];
    for (const [x, y] of tri) { pos.push(x, y, rg.z); uv.push(U(x), V(y)); nrm.push(0, 0, facing); col.push(1, 1, 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** 行先表示（LED風）: 種別 + 行先 */
export function ledTexture(label: string, dest: string): THREE.CanvasTexture {
  const [k, g] = cv(512, 128);
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 512, 128);
  const col: Record<string, string> = { 普通: '#e8e8e8', 急行: '#ff5a3a', 空港急行: '#ff8a2a', 特急: '#ff4a6a', 特急ラピート: '#ff4a6a', 特急ラピートα: '#ff4a6a', 特急ラピートβ: '#ff4a6a', 特急サザン: '#ff3b3b', サザン: '#ff3b3b', 準急: '#5ad06a', 快速: '#ff9a2a' };
  const kc = col[label] ?? '#ffb347';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = kc; g.font = `800 58px ${FONT}`; g.fillText(label, 78, 66, 140);
  g.fillStyle = '#f4f4f0'; g.font = `700 64px ${FONT}`; g.fillText(dest, 330, 68, 330);
  // ドット感
  g.fillStyle = 'rgba(0,0,0,.45)';
  for (let x = 0; x < 512; x += 4) g.fillRect(x, 0, 1, 128);
  for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 512, 1);
  const t = new THREE.CanvasTexture(k); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 種別だけを表示する表示器（8300系の前面左） */
export function ledTypeTexture(label: string): THREE.CanvasTexture {
  const [k, g] = cv(256, 64);
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 256, 64);
  const col: Record<string, string> = { 普通: '#e8e8e8', 急行: '#ff5a3a', 空港急行: '#ff8a2a', 特急: '#ff4a6a', 特急ラピート: '#ff4a6a', 特急ラピートα: '#ff4a6a', 特急ラピートβ: '#ff4a6a', 特急サザン: '#ff3b3b', サザン: '#ff3b3b', 準急: '#5ad06a', 快速: '#ff9a2a' };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = col[label] ?? '#ffb347'; g.font = `800 46px ${FONT}`; g.fillText(label, 128, 34, 220);
  g.fillStyle = 'rgba(0,0,0,.45)';
  for (let x = 0; x < 256; x += 4) g.fillRect(x, 0, 1, 64);
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 256, 1);
  const t = new THREE.CanvasTexture(k); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 行先だけを表示する表示器（8300系の前面右） */
export function ledDestTexture(dest: string): THREE.CanvasTexture {
  const [k, g] = cv(256, 64);
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 256, 64);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f4f4f0'; g.font = `700 46px ${FONT}`; g.fillText(dest, 128, 34, 220);
  g.fillStyle = 'rgba(0,0,0,.45)';
  for (let x = 0; x < 256; x += 4) g.fillRect(x, 0, 1, 64);
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 256, 1);
  const t = new THREE.CanvasTexture(k); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 発光グロー用の放射グラデーション */
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const [k, g] = cv(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.15, 'rgba(255,255,255,.8)'); r.addColorStop(.4, 'rgba(255,255,255,.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(k); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** 1両分の部品（材質別ジオメトリ） */
export interface CarParts {
  /** 側面シート材質（外板） */
  shell: THREE.BufferGeometry;
  /** 前面シート材質（先頭車の前面） */
  face?: THREE.BufferGeometry;
  /** 頂点色の塗装材質（屋根上・床下・前面の立体部品など） */
  paint: THREE.BufferGeometry;
  /** ガラス（光沢） */
  glass?: THREE.BufferGeometry;
  /** 行先 LED 面（8300系は左 = 種別） */
  led?: THREE.BufferGeometry;
  /** 行先 LED 面の右側（8300系: 行先） */
  led2?: THREE.BufferGeometry;
  head?: THREE.BufferGeometry;
  tail?: THREE.BufferGeometry;
  /** 標識灯（列車識別灯）のレンズ。l = 前から見て左（+X）、r = 右。先頭は普通 = 左のみ点灯・優等 = 両方、最後尾は両方赤、連結部は消灯（makeCar） */
  marks?: { l: THREE.BufferGeometry; r: THREE.BufferGeometry };
  /** 前照灯グローの位置 */
  glows: THREE.Vector3[];
}

type Add = (x: number, y: number, z: number, w: number, h: number, d: number, col: number | string, rx?: number, ry?: number, rz?: number) => void;
export function adder(b: GeoBatch, key = 'paint'): Add {
  return (x, y, z, w, h, d, col, rx = 0, ry = 0, rz = 0) => b.add(key, P.box, M(x, y, z, ry, w, h, d, rx, rz), col);
}

export function addTaperedSkirt(
  b: GeoBatch, zf: number,
  outerTop: number, outerBottom: number,
  innerTop: number, innerBottom: number,
  color: number,
) {
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape([
      new THREE.Vector2(sx * outerTop, Y0 + .01),
      new THREE.Vector2(sx * innerTop, Y0 + .01),
      new THREE.Vector2(sx * innerBottom, .40),
      new THREE.Vector2(sx * outerBottom, .40),
    ]);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: .14, bevelEnabled: false,
    });
    b.add('paint', basePart(geo), M(0, 0, zf - .12), color);
    geo.dispose();
  }
  const add = adder(b);
  add(0, .72, zf - .06, innerTop * 2, .58, .08, 0x22252a);
  add(0, .40, zf - .05, outerBottom * 2, .14, .14, color);
  for (const sx of [-1, 1])
    add(sx * .46, .80, zf - .14, .08, .42, .08, 0x969b9f);
  for (const y of [.61, .99])
    add(0, y, zf - .14, 1.00, .08, .08, 0x969b9f);
  add(0, .83, zf - .43, .36, .22, .08, 0x81868b);
}

/** 台車・台枠・床下機器 */
export function addUnderfloor(b: GeoBatch, Lb: number, kind: CarKind, o: { frame: number; equip: number; bogie: number; frontCut?: number }) {
  const hz = Lb / 2, add = adder(b), cut = o.frontCut ?? 0;
  add(0, Y0 - .05, cut / 2, 2.6, .12, Lb - cut, o.frame);
  const boxes: V2[] = kind === 'pan' ? [[-3.3, 3.4], [.8, 2.2], [3.6, 1.6]] : kind === 'head' ? [[-2.6, 2.2], [1.2, 3.0]] : [[-3.2, 1.8], [-.4, 2.6], [3.2, 2.2]];
  for (const [z, l] of boxes) add(0, .82, z, 2.2, .42, l, o.equip);
  const bz = hz - 2.6;
  for (const z of [-bz, bz]) {
    add(0, .66, z, 2.2, .26, 1.0, o.bogie); // 標準軌（1435mm）の台車
    for (const sx of [-1, 1]) {
      add(sx * 1.0, .52, z, .16, .32, 2.6, o.bogie);
      for (const dz of [-1.05, 1.05]) {
        b.add('paint', P.cyl, M(sx * .78, .43, z + dz, 0, .86, .12, .86, 0, Math.PI / 2), 0x3c3f44);
        add(sx * 1.08, .43, z + dz, .1, .2, .3, 0x1c1e21);
      }
      add(sx * 1.08, .62, z, .22, .22, .5, 0x1c1e21); // 空気ばね
    }
  }
}

/** 妻面（中間側の端）: 貫通扉と幌 */
export function addEndWall(b: GeoBatch, z: number, ytop: number, hw: number, wall: number) {
  const add = adder(b), s = Math.sign(z);
  add(0, (Y0 + ytop) / 2 - .05, z, hw * 2 - .1, ytop - Y0 - .2, .05, wall);
  add(0, 2.1, z + s * .03, .9, 1.9, .04, 0x5d646c);
  add(0, 2.55, z + s * .05, .55, .7, .02, 0x26303a);
  add(0, 2.1, z + s * .2, 1.25, 2.1, .35, 0x2b2e33); // 幌
}

function arm(b: GeoBatch, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, col: number) {
  const dy = y1 - y0, dz = z1 - z0, len = Math.hypot(x1 - x0, dy, dz);
  b.add('paint', P.box, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, t, len, t, Math.atan2(dz, dy)), col);
}

/** シングルアームパンタグラフ */
export function addSingleArm(b: GeoBatch, pz: number, roofTop: number) {
  const add = adder(b);
  add(0, roofTop + .08, pz, 1.5, .1, 1.3, 0x5a5f66);
  for (const sx of [-.6, .6]) for (const dz of [-.5, .5]) b.add('paint', P.cyl, M(sx, roofTop + .04, pz + dz, 0, .12, .16, .12), 0x9a6b4b);
  const hy = roofTop + 1.45, ky = roofTop + .7;
  arm(b, 0, roofTop + .16, pz + .55, 0, ky, pz - .85, .09, 0x3d4248);
  arm(b, 0, ky, pz - .85, 0, hy - .05, pz + .1, .06, 0x3d4248);
  add(0, hy, pz + .1, 1.9, .05, .12, 0x2a2d31);
  for (const sx of [-1, 1]) add(sx * 1.0, hy - .06, pz + .1, .25, .04, .08, 0x2a2d31, 0, 0, sx * .5);
}

/** 菱形パンタグラフ */
export function addLozenge(b: GeoBatch, pz: number, roofTop: number) {
  const add = adder(b), c = 0x3d4248;
  add(0, roofTop + .08, pz, 1.6, .1, 1.6, 0x5a5f66);
  for (const sx of [-.65, .65]) for (const dz of [-.65, .65]) b.add('paint', P.cyl, M(sx, roofTop + .04, pz + dz, 0, .12, .16, .12), 0x9a6b4b);
  const yb = roofTop + .18, ym = roofTop + .75, yt = roofTop + 1.3;
  for (const sx of [-.5, .5]) {
    arm(b, sx, yb, pz - .7, sx, ym, pz - .05, .05, c); arm(b, sx, ym, pz - .05, sx, yt, pz - .45, .045, c);
    arm(b, sx, yb, pz + .7, sx, ym, pz + .05, .05, c); arm(b, sx, ym, pz + .05, sx, yt, pz + .45, .045, c);
  }
  add(0, ym, pz, 1.05, .04, .04, c); add(0, yt, pz - .45, 1.1, .04, .04, c); add(0, yt, pz + .45, 1.1, .04, .04, c);
  add(0, yt + .05, pz, 1.9, .05, .12, 0x2a2d31);
  for (const sx of [-1, 1]) add(sx * 1.0, yt - .01, pz, .25, .04, .08, 0x2a2d31, 0, 0, sx * .5);
}
