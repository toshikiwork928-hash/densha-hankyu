// 日本の街並み（手続き生成）: 住宅・アパート・マンション・商店・コンビニ・自販機・ブロック塀・電柱と電線・
// 線路沿いの道路・田畑・竹林・農家。チャンク単位でジオメトリを結合して描画コールを抑える
import * as THREE from 'three';
import { FONT } from '../core/config';
import type { GameContext } from '../core/context';
import { createRng, type Rng } from '../core/rng';
import { ChunkedBatch, GeoBatch, M, P, basePart, onLight } from './batch';
import { cullByDistance } from './cull';
import { loopZone, seaSideOf, trackSpan } from '../route/service';
import { coastalThirdTracks } from './coastal-stations';
import { towerZones } from './coastal-tower';
import { tramBlocks } from './hankai-tram';
import { getTerrain, hash } from './terrain';
import { isMountain } from './mountain-terrain';
import { buildMountainScenery } from './mountain-scenery';
import { buildOsmTown, osmSceneryFor } from './osm-town';

/** 木を置く位置（素材読込後に scenery.ts が配置） */
export interface TreeSpot { s: number; lat: number; y: number; k: number; small?: boolean }
export interface TownResult { trees: TreeSpot[] }

const WALLS = [0xe9e2cf, 0xf0efe9, 0xd9c9a8, 0xcfcfca, 0xb39673, 0xbfc6cc, 0xe3d3bb, 0xd8d0c4, 0xa7aeb3, 0xeee6d6];
const ROOFS = [0x3c3f45, 0x4a5561, 0x5e4436, 0x3b4c62, 0x8e5a42, 0x46564a, 0x555555, 0x6b6e73];
const MANSION = [0x9c7b62, 0xd6c8ae, 0xe9e6dd, 0xa9a49c, 0xc9b49a, 0xbac0c4];
const GLASS = 0x2b343d;
/** 頂点を少し揺らした形状（同じ位置の頂点は同じだけ動かして割れを防ぐ） */
function jitter(geo: THREE.BufferGeometry, amt: number, seed: number, keepBottom = false): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = (k: number) => { const v = Math.sin(x * 12.99 + y * 78.23 + z * 37.72 + seed * 11.3 + k * 4.1) * 43758.55; return (v - Math.floor(v)) * 2 - 1; };
    if (keepBottom && y < -.49) continue;
    p.setXYZ(i, x + h(1) * amt, y + h(2) * amt * .6, z + h(3) * amt);
  }
  g.computeVertexNormals();
  return g;
}
/** 広葉樹の葉の塊（細分した球を揺らす。3種） */
const BLOBS = [0, 1, 2].map(k => basePart(jitter(new THREE.IcosahedronGeometry(.5, 1), .07, k)));
/** 針葉樹（杉）の段（裾が垂れた円錐。3種） */
const TIERS = [0, 1, 2].map(k => {
  const g = new THREE.ConeGeometry(.5, 1, 11, 2, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -.49) p.setY(i, -.5 - .08 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 5 + k)); // 裾のぎざぎざ
  return basePart(jitter(g, .04, k + 5));
});
const TRUNK = basePart(new THREE.CylinderGeometry(.35, .5, 1, 5, 1, true));

// ---- アトラス（看板・自販機・店内） ----
type Rect = readonly [number, number, number, number];
interface Atlas { tex: THREE.CanvasTexture; signs: Rect[]; conbini: Rect; vend: Rect[]; shop: Rect[]; pole: Rect }
const SHOPS: [string, string, string][] = [
  ['ベーカリー 麦の穂', '#7a4a2a', '#fff4e0'], ['くすり', '#1c6fb8', '#fff'], ['そば処 さくら', '#2b2b2b', '#f5e6c8'],
  ['理容 ミナト', '#ffffff', '#c02020'], ['クリーニング', '#2a9a5a', '#fff'], ['不動産', '#f2f2f2', '#1d3d7a'],
  ['書店', '#5a3a7a', '#fff'], ['喫茶 汐風', '#3a2a20', '#f0d090'], ['居酒屋 波', '#8a1a1a', '#fff'], ['歯科', '#ffffff', '#2a7a9a'],
  ['生花', '#e0f0e0', '#2a6a2a'], ['精肉', '#c8382a', '#fff'],
];

function buildAtlas(): Atlas {
  const W = 1024, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const R = (x: number, y: number, w: number, h: number): Rect => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
  g.fillStyle = '#222'; g.fillRect(0, 0, W, H);
  const signs: Rect[] = [];
  SHOPS.forEach(([t, bg, fg], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 96;
    g.fillStyle = bg; g.fillRect(x, y, 512, 96);
    g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(x + 6, y + 6, 500, 84);
    g.fillStyle = fg; g.font = `800 58px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x + 256, y + 50, 480);
    signs.push(R(x, y, 512, 96));
  });
  // コンビニ（架空）帯
  {
    const y = 576; g.fillStyle = '#fff'; g.fillRect(0, y, 1024, 96);
    g.fillStyle = '#18a39c'; g.fillRect(0, y + 8, 1024, 26); g.fillStyle = '#e8508a'; g.fillRect(0, y + 62, 1024, 26);
    g.fillStyle = '#18a39c'; g.font = `900 40px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('サクラマート', 512, y + 49);
  }
  const conbini = R(0, 576, 1024, 96);
  // 自販機の前面
  const vend: Rect[] = [];
  const vcols = ['#c8282a', '#2a5fb0', '#eeeeee', '#2a8a4a'];
  vcols.forEach((col, i) => {
    const x = i * 128, y = 672;
    g.fillStyle = col; g.fillRect(x, y, 128, 256);
    g.fillStyle = '#e8f0f4'; g.fillRect(x + 10, y + 12, 108, 120);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
      g.fillStyle = ['#d03030', '#f0c020', '#3070d0', '#30a050', '#f08020', '#888'][(k + r + i) % 6];
      g.fillRect(x + 14 + k * 17, y + 18 + r * 38, 12, 24);
      g.fillStyle = '#20c040'; g.fillRect(x + 15 + k * 17, y + 44 + r * 38, 10, 4);
    }
    g.fillStyle = '#222'; g.fillRect(x + 20, y + 150, 30, 40); g.fillRect(x + 20, y + 210, 88, 30);
    g.fillStyle = '#aaa'; g.fillRect(x + 80, y + 150, 30, 20);
    vend.push(R(x, y, 128, 256));
  });
  // 店内（ガラス越し、明るい棚）
  const shop: Rect[] = [];
  for (let i = 0; i < 2; i++) {
    const x = 512 + i * 256, y = 672;
    g.fillStyle = i ? '#f4efe0' : '#eef4f6'; g.fillRect(x, y, 256, 128);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 14; k++) {
      g.fillStyle = `hsl(${(k * 47 + r * 90 + i * 30) % 360},55%,${50 + (k % 3) * 8}%)`;
      g.fillRect(x + 6 + k * 18, y + 40 + r * 28, 14, 20);
    }
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y, 256, 30);
    shop.push(R(x, y, 256, 128));
  }
  // ポール看板
  g.fillStyle = '#fff'; g.fillRect(0, 928, 192, 96); g.fillStyle = '#18a39c'; g.fillRect(0, 928, 192, 30); g.fillStyle = '#e8508a'; g.fillRect(0, 994, 192, 30);
  g.fillStyle = '#18a39c'; g.font = `900 30px ${FONT}`; g.textAlign = 'center'; g.fillText('24h', 96, 978);
  const pole = R(0, 928, 192, 96);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { tex, signs, conbini, vend, shop, pole };
}

// ---- 部品ヘルパ（ローカル座標: 正面 = -Z、幅 = X、底面 = y0） ----
export class Kit {
  constructor(public b: GeoBatch, public rnd: Rng, public atlas: Atlas) {}
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.rnd() * a.length)]; }
  box(x: number, y: number, z: number, w: number, h: number, d: number, col: number, ry = 0) { this.b.add('body', P.box, M(x, y, z, ry, w, h, d), col); }
  /** 窓（正面向き = face 'f'、背面 'b'、左 'l'、右 'r'）。lit 確率で夜に点灯 */
  win(x: number, y: number, z: number, w: number, h: number, face: 'f' | 'b' | 'l' | 'r', litP = .45) {
    const ry = face === 'f' ? Math.PI : face === 'b' ? 0 : face === 'l' ? -Math.PI / 2 : Math.PI / 2;
    const lit = this.rnd() < litP;
    const col = lit ? this.pick([0xffd696, 0xfff0d0, 0xffc890, 0xe8f0ff]) : GLASS;
    this.b.add(lit ? 'lit' : 'body', P.plane, M(x, y, z, ry, w, h, 1), col);
  }
  sign(rect: Rect, x: number, y: number, z: number, w: number, h: number, ry = Math.PI) {
    this.b.add('sign', P.plane, M(x, y, z, ry, w, h, 1), 0xffffff, rect);
  }
  vend(x: number, z: number, ry: number) {
    const v = Math.floor(this.rnd() * this.atlas.vend.length);
    const cols = [0xc8282a, 0x2a5fb0, 0xe8e8e8, 0x2a8a4a];
    this.b.add('body', P.boxB, M(x, 0, z, ry, .95, 1.83, .72), cols[v]);
    const fx = x - Math.sin(ry) * .37, fz = z - Math.cos(ry) * .37;
    this.b.add('sign', P.plane, M(fx, .92, fz, ry + Math.PI, .9, 1.78, 1), 0xffffff, this.atlas.vend[v]);
  }
}

/** 2階建て戸建て（切妻 / 寄棟 / 片流れ風） */
function house(k: Kit, w: number, d: number): void {
  const { rnd } = k, fh = 2.75, floors = rnd() < .85 ? 2 : 1, base = .35, H = base + floors * fh;
  const wall = k.pick(WALLS), roof = k.pick(ROOFS);
  k.box(0, base / 2, 0, w + .1, base, d + .1, 0x9d998f);
  k.box(0, base + (H - base) / 2, 0, w, H - base, d, wall);
  // 屋根
  const o = .45, rt = rnd(), ridgeX = w >= d || rnd() < .7;
  const span = (ridgeX ? d : w) + o * 2, len = (ridgeX ? w : d) + o * 2, rh = span / 2 * (.38 + rnd() * .12);
  if (rt < .5) {
    // 切妻: 屋根板2枚＋妻壁
    const a = Math.atan2(rh, span / 2), sl = Math.hypot(rh, span / 2) + .1;
    for (const sg of [-1, 1]) {
      if (ridgeX) k.b.add('body', P.box, M(0, H + rh / 2, sg * span / 4, 0, len, .16, sl, sg * a), roof);
      else k.b.add('body', P.box, M(sg * span / 4, H + rh / 2, 0, 0, sl, .16, len, 0, -sg * a), roof);
    }
    k.b.add('body', P.gable, M(0, H - .02, 0, ridgeX ? Math.PI / 2 : 0, span - o * 2, rh * .93, len - o * 2 - .05), wall); // 妻壁
  } else {
    k.b.add('body', P.cone4, M(0, H + rh / 2, 0, 0, w + o * 2, rh, d + o * 2), roof);
  }
  // 窓・ドア（正面）
  const zf = -d / 2 - .02, n = Math.max(1, Math.floor(w / 2.7));
  const doorI = Math.floor(rnd() * n);
  for (let f = 0; f < floors; f++) {
    const y0 = base + f * fh;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (w / n);
      if (f === 0 && i === doorI) {
        k.b.add('body', P.plane, M(x, y0 + 1.0, zf, Math.PI, .95, 2.0, 1), k.pick([0x6b4a32, 0x8a7a66, 0x4a3a2e, 0xb0a490]));
        k.box(x, y0 + 2.2, zf - .35, 1.4, .08, .7, 0x6a6a6a); // 庇
        continue;
      }
      const tall = f === 0 && rnd() < .4;
      k.win(x, y0 + (tall ? 1.05 : 1.55), zf, 1.2 + rnd() * .5, tall ? 1.8 : 1.05, 'f', .4);
      if (rnd() < .25) k.box(x, y0 + (tall ? 2.05 : 2.2), zf - .08, 1.8, .12, .16, 0x777777);
    }
    // 側面窓
    for (const sx of [-1, 1]) if (rnd() < .7) k.win(sx * (w / 2 + .02), y0 + 1.6, (rnd() - .5) * d * .5, .9, .9, sx < 0 ? 'l' : 'r', .35);
  }
  // 2階バルコニー＋室外機・物干し
  if (floors === 2 && rnd() < .65) {
    const bw = Math.min(w - .4, 3 + rnd() * 3), bx = (rnd() - .5) * (w - bw), y = base + fh;
    k.box(bx, y + .05, zf - .55, bw, .14, 1.1, 0xd0d0c8);
    k.box(bx, y + .6, zf - 1.08, bw, .95, .06, k.pick([0xf2f2f2, 0x8a8f94, 0x5a4a3a, 0xd8d0c0]));
    k.box(bx + bw / 2 - .5, y + .42, zf - .5, .78, .56, .28, 0xe4e2da);
    if (rnd() < .5) k.box(bx, y + 1.55, zf - .75, bw * .9, .03, .03, 0xc0c0c0);
  }
  if (rnd() < .6) k.box((rnd() < .5 ? -1 : 1) * (w / 2 + .2), .3 + .28, d * .2, .3, .56, .78, 0xe4e2da); // 地上の室外機
  if (rnd() < .3) k.box(0, H * .55, d / 2 + .02, .12, H * .9, .12, 0x9a9a9a); // 雨どい
}

/** 2階建てアパート（外廊下・外階段） */
function apartment(k: Kit, w: number, d: number): void {
  const { rnd } = k, fh = 2.8, floors = rnd() < .75 ? 2 : 3, H = .3 + floors * fh;
  const wall = k.pick([0xe9e6dd, 0xd6c8ae, 0xc9b49a, 0xbfc6cc, 0xe3d3bb]), rail = k.pick([0x7a5a42, 0x8a8f94, 0xe8e8e8, 0x44505a]);
  k.box(0, H / 2, 0, w, H, d, wall);
  if (rnd() < .5) k.b.add('body', P.gable, M(0, H, 0, Math.PI / 2, d + .6, 1.2, w + .6), k.pick(ROOFS));
  else k.box(0, H + .2, 0, w + .1, .4, d + .1, 0xbdb9b0);
  const zf = -d / 2, units = Math.max(2, Math.floor(w / 4.2));
  for (let f = 0; f < floors; f++) {
    const y0 = .3 + f * fh;
    if (f > 0) { // 外廊下
      k.box(0, y0 - .05, zf - .7, w, .18, 1.4, 0xb0aca4);
      k.box(0, y0 + .5, zf - 1.37, w, .95, .07, rail);
    }
    for (let u = 0; u < units; u++) {
      const x = (u + .5) * w / units - w / 2;
      k.b.add('body', P.plane, M(x - .6, y0 + 1.0, zf - .02, Math.PI, .85, 1.95, 1), 0x8f8270);
      k.win(x + .6, y0 + 1.5, zf - .02, .9, .6, 'f', .5);
      k.box(x + .1, y0 + 2.15, zf - .08, .32, .32, .16, 0xdedcd4); // メーターボックス風
    }
  }
  // 外階段
  const sx = w / 2 + .6;
  for (let f = 0; f < floors - 1; f++) {
    const len = Math.hypot(fh, d * .7), ang = Math.atan2(fh, d * .7);
    k.b.add('body', P.box, M(sx, .3 + f * fh + fh / 2, zf + d * .35 - (f % 2 ? 0 : 0), 0, 1.0, .12, len, f % 2 ? ang : -ang), 0x8a8f94);
  }
  k.box(sx, H / 2, zf + .2, .06, H, .06, 0x6a6a6a);
  // 駐輪場の屋根
  if (rnd() < .5) { k.box(-w / 2 - 1.5, 2.2, zf + 1, 2.6, .06, 3, 0x9aa4ae); k.box(-w / 2 - 2.7, 1.1, zf + 1, .08, 2.2, .08, 0x777777); }
}

/** マンション（中高層、バルコニー付き） */
function mansion(k: Kit, w: number, d: number, floors: number): void {
  const { rnd } = k, fh = 2.95, H = .4 + floors * fh, wall = k.pick(MANSION);
  k.box(0, H / 2, 0, w, H, d, wall);
  k.box(0, H + .5, 0, w + .1, 1.0, d + .1, wall); // パラペット
  k.box(w * .25, H + 1.6, d * .1, 3, 2.4, 3, 0xc8c8c4); // 塔屋
  if (rnd() < .5) k.box(-w * .25, H + 1.3, 0, 2.2, 1.6, 2.2, 0x9ab0c0); // 受水槽
  const zf = -d / 2, units = Math.max(2, Math.floor(w / 5));
  const panel = k.pick([0xf0f0ec, 0xd8d4cc, 0x9aa6b0, 0xe8e0d0]);
  for (let f = 0; f < floors; f++) {
    const y0 = .4 + f * fh;
    if (f === 0) {
      k.win(0, 1.3, zf - .02, Math.min(4, w * .3), 2.2, 'f', .9); // エントランス
      continue;
    }
    k.box(0, y0 + .05, zf - .65, w, .16, 1.3, 0xd8d8d4);
    k.box(0, y0 + .58, zf - 1.28, w, 1.0, .08, panel);
    for (let u = 0; u < units; u++) {
      const x = (u + .5) * w / units - w / 2;
      k.win(x, y0 + 1.15, zf - .02, w / units * .62, 1.9, 'f', .42);
      if (u > 0) k.box(x - w / units / 2, y0 + 1.2, zf - .65, .08, 2.1, 1.25, 0xcfcfcb);
      if (rnd() < .5) k.box(x + w / units * .33, y0 + .45, zf - .45, .75, .55, .28, 0xe4e2da);
    }
    // 側面窓
    for (const sx of [-1, 1]) k.win(sx * (w / 2 + .02), y0 + 1.5, (rnd() - .5) * d * .4, 1.0, 1.1, sx < 0 ? 'l' : 'r', .35);
  }
}

/** 商店（1階店舗＋上階住居） */
function shop(k: Kit, w: number, d: number): void {
  const { rnd } = k, floors = rnd() < .6 ? 2 : 3, fh = 2.9, H = .2 + floors * fh;
  const wall = k.pick([...WALLS, 0xc8b8a0, 0x9a8a7a]);
  k.box(0, H / 2, 0, w, H, d, wall);
  if (rnd() < .4) k.b.add('body', P.gable, M(0, H, 0, Math.PI / 2, d + .6, 1.3, w + .4), k.pick(ROOFS));
  else k.box(0, H + .3, -d / 2 + .1, w, .6, .2, wall);
  const zf = -d / 2 - .02;
  // 店頭ガラス（店内テクスチャ）
  k.sign(k.pick(k.atlas.shop), 0, 1.35, zf, w - .6, 2.2);
  k.box(0, 2.7, zf - .6, w, .08, 1.2, k.pick([0x2a6a9a, 0x9a2a2a, 0x2a7a4a, 0x6a4a2a, 0x555555])); // 日よけ
  k.sign(k.pick(k.atlas.signs), 0, 3.35, zf - .02, Math.min(w - .3, 5.5), 1.0);
  for (let f = 1; f < floors; f++) {
    const n = Math.max(1, Math.floor(w / 2.8));
    for (let i = 0; i < n; i++) k.win((i - (n - 1) / 2) * w / n, .2 + f * fh + 1.5, zf, 1.3, 1.1, 'f', .45);
  }
  if (rnd() < .35) k.vend(-w / 2 + .6, zf - .45, 0);
}

/** コンビニ（架空チェーン）＋駐車場 */
function conbini(k: Kit, w: number, d: number): void {
  const H = 4.4, zf = -d / 2 - .02;
  k.box(0, H / 2, 0, w, H, d, 0xf4f4f2);
  k.box(0, H + .25, 0, w + .2, .5, d + .2, 0xe6e6e4);
  k.sign(k.atlas.conbini, 0, 3.7, zf - .01, w, .95);
  k.sign(k.atlas.shop[0], -w * .12, 1.45, zf, w * .7, 2.5);
  k.b.add('body', P.plane, M(w * .32, 1.2, zf - .01, Math.PI, 1.8, 2.3, 1), 0x9ab0b8); // 自動ドア
  k.b.add('lit', P.plane, M(w * .32, 1.2, zf - .015, Math.PI, 1.7, 2.2, 1), 0xf4f8ff);
  // 駐車場（前面）
  k.b.add('body', P.plane, M(0, .03, zf - 5, 0, w, 10, 1, -Math.PI / 2), 0x5c5e62);
  for (let i = -2; i <= 2; i++) k.b.add('body', P.plane, M(i * 2.6, .045, zf - 3.2, 0, .12, 5, 1, -Math.PI / 2), 0xeeeeee);
  k.box(w / 2 - .5, 3.0, zf - 9, .25, 6, .25, 0x8a8f94);
  k.sign(k.atlas.pole, w / 2 - .5, 6.2, zf - 9.15, 2.4, 1.2);
  k.sign(k.atlas.pole, w / 2 - .5, 6.2, zf - 8.85, 2.4, 1.2, 0);
  k.vend(-w / 2 - .7, zf + 1, -Math.PI / 2 + Math.PI);
  k.vend(-w / 2 - .7, zf + 2, -Math.PI / 2 + Math.PI);
}

/** 農家（大きな寄棟＋蔵） */
function farmhouse(k: Kit, w: number, d: number): void {
  const { rnd } = k, H = .4 + 2.9 * (rnd() < .5 ? 1 : 2);
  k.box(0, H / 2, 0, w, H, d, k.pick([0xd8cfbc, 0xb8a68a, 0xe8e2d4]));
  k.b.add('body', P.cone4, M(0, H + 1.7, 0, 0, w + 1.6, 3.4, d + 1.6), k.pick([0x3a3c40, 0x4a4e56, 0x5a4a40]));
  for (let i = -1; i <= 1; i++) k.win(i * w / 3.2, 1.4, -d / 2 - .02, 1.8, 1.6, 'f', .4);
  // 蔵
  const kx = w / 2 + 4;
  k.box(kx, .5, d * .1, 4.2, 1.0, 5.2, 0x3a3a3a);
  k.box(kx, 2.75, d * .1, 4, 3.5, 5, 0xf4f2ea);
  k.b.add('body', P.gable, M(kx, 4.5, d * .1, 0, 5, 1.6, 6), 0x3a3c40);
}

/** 田（水田・畦）や畑 */
function field(b: GeoBatch, rnd: Rng, Lw: number, Ls: number): void {
  const t = rnd();
  const col = t < .55 ? [0x7aa24e, 0x6d9a45, 0x86ad55, 0x5f8f3e][Math.floor(rnd() * 4)] : t < .7 ? 0x7d9a8a : t < .92 ? 0x8b7a55 : 0xa69a60;
  b.add('body', P.plane, M(0, .07, 0, 0, Lw - .6, Ls - .6, 1, -Math.PI / 2), col);
  b.add('body', P.box, M(0, .1, Ls / 2 - .25, 0, Lw, .22, .5), 0x7a8a4a);
  b.add('body', P.box, M(Lw / 2 - .25, .1, 0, 0, .5, .22, Ls), 0x7a8a4a);
  if (t >= .7 && t < .92) for (let i = -2; i <= 2; i++) b.add('body', P.box, M(i * Lw / 6, .18, 0, 0, .5, .25, Ls - 2), 0x5d8a3a); // 畝
  if (t >= .92) { // ビニールハウス
    b.add('body', P.boxB, M(0, 0, 0, 0, Lw * .5, 2.0, Ls * .7), 0xdfe8ea);
    b.add('body', P.gable, M(0, 2.0, 0, 0, Lw * .5, 1.1, Ls * .7), 0xe8eef0);
  }
}

function bamboo(b: GeoBatch, rnd: Rng, r: number): void {
  for (let i = 0; i < 22; i++) {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r, h = 8 + rnd() * 5;
    b.add('body', P.cyl6, M(Math.cos(a) * d, h / 2, Math.sin(a) * d, 0, .12, h, .12, (rnd() - .5) * .1, (rnd() - .5) * .1), 0x86a050);
  }
  for (let i = 0; i < 7; i++) {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r * .8;
    b.add('body', BLOBS[i % 3], M(Math.cos(a) * d, 8 + rnd() * 3.5, Math.sin(a) * d, rnd() * 3, r * .9 + rnd() * 2, 3.5 + rnd() * 2, r * .9 + rnd() * 2), [0x6f9a40, 0x7aa548, 0x648f3a][i % 3]);
  }
}

/** 沿岸公園の低い松。既存の軽量針葉樹パーツを扁平な樹冠に使う。 */
function coastalParkTile(b: GeoBatch, rnd: Rng, w: number, d: number, path: boolean, plant: boolean): void {
  // parentAt のローカルXは線路方向、Zは線路から離れる方向。
  b.add('body', P.plane, M(0, .075, 0, 0, d + .05, w + .05, 1, -Math.PI / 2), 0x82916c);
  if (path) {
    b.add('body', P.box, M(0, .1, 0, 0, d + .06, .055, 3.2), 0xc4bba3);
    if (rnd() < .12) {
      b.add('body', P.box, M(0, .48, 3, 0, 2.1, .08, .6), 0x866548);
      b.add('body', P.box, M(0, .78, 3.3, 0, 2.1, .5, .08), 0x866548);
      for (const x of [-.75, .75]) b.add('body', P.box, M(x, .23, 3, 0, .08, .45, .45), 0x606965);
    }
  }
  if (!plant || path) return;
  const x = (rnd() - .5) * d * .45, z = (rnd() - .5) * w * .6, height = 5.5 + rnd() * 2;
  b.add('body', TRUNK, M(x, height / 2, z, 0, .38, height, .38), 0x665440);
  for (let i = 0; i < 3; i++) {
    const spread = 4.5 - i * .8;
    b.add('body', TIERS[i], M(x + (i - 1) * .65, height - .6 + i * .45, z + (i % 2 ? .55 : -.3), i, spread, 1.55, spread), [0x344e3d, 0x3e6046, 0x486b4b][i]);
  }
}

/** 街並みを構築（同期）。木の位置を返す */
export function buildTown(ctx: GameContext): TownResult {
  const { track, route, scene } = ctx, T = getTerrain(ctx);
  const rnd = createRng(20240917);
  const atlas = buildAtlas();
  const chunks = new ChunkedBatch(300, new Set(['sign']));
  const shadowChunks = new ChunkedBatch(300, new Set(['shadow']));
  // 建物の接地影。地面に貼るだけなので低画質でも足元の浮きを抑えられる。
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
  const sg = shadowCanvas.getContext('2d')!;
  const fade = sg.createRadialGradient(32, 32, 8, 32, 32, 32);
  fade.addColorStop(0, '#ffffff'); fade.addColorStop(.55, '#aaaaaa'); fade.addColorStop(1, '#000000');
  sg.fillStyle = fade; sg.fillRect(0, 0, 64, 64);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x18283b, alphaMap: new THREE.CanvasTexture(shadowCanvas),
    transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  shadowMat.userData.illustrationShadow = true;
  const trees: TreeSpot[] = [];
  const S0 = route.extent.from, S1 = route.extent.to;
  const L0 = Math.min(...route.tracks), L1 = Math.max(...route.tracks);
  const latOf = (sd: number, d: number) => sd < 0 ? L0 - d : L1 + d;
  // 山岳線: 町並み・田畑・道路は平地（川沿いの町・平野）で、地面が線路と同じ高さの所だけ
  const MT = isMountain(T) ? T : null;
  const coastal = !!route.coastalLandmarks?.length && route.coastalScenery !== false && !MT;
  const parkSide = seaSideOf(route);
  const parkAt = (sd: number, s: number) => coastal && sd === parkSide && !T.isCity(s);
  const overpasses = (route.coastalLandmarks ?? []).filter(l => l.kind === 'road-overpass');
  // 斜交する床版の線路方向投影と建物の奥行きに、余裕を含める。
  const blockedBuilding = (from: number, to: number) => overpasses.some(l => from < l.s + 45 && to > l.s - 45);
  // 駅直結タワー（低層棟・歩廊）の敷地。その側の道路・住宅は置かない。
  const towers = towerZones(route);
  const towerNear = (sd: number, from: number, to: number) => towers.some(t => t.side === sd && from < t.to && to > t.from);
  const flatOk = (s: number) => !MT || MT.flat(s) > .97;
  const levelAt = (s: number, lat: number) => !MT || Math.abs(MT.terrainY(s, lat) - MT.groundY(s)) < .9;
  const wires = new Map<number, number[]>();
  /** 建物の占有区間（田畑との重なり防止） */
  const occ: { sd: number; a: number; b: number; d: number }[] = [];

  const mats: Record<string, THREE.Material> = {
    body: new THREE.MeshLambertMaterial({ vertexColors: true }),
    lit: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x3a434c }),
    sign: new THREE.MeshLambertMaterial({ map: atlas.tex, emissiveMap: atlas.tex, emissive: 0xffffff, emissiveIntensity: .05 }),
    road: new THREE.MeshLambertMaterial({ vertexColors: true }),
    fence: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .38, depthWrite: false, side: THREE.DoubleSide }),
  };

  const platSide = (_sd: number, s: number, m: number) => route.stations.some(st => s > st.platform.from - m && s < st.platform.to + m); // ホームは両側（相対式・島式）
  /** 2面4線駅の待避線区間（両側。対向側ホーム・分岐器・門型架線柱の分） */
  const loopNear = (s: number, m: number) => route.stations.some(st => { const z = loopZone(st); return !!z && s > z.inFrom - m && s < z.outTo + m; });
  const thirds = route.stations.flatMap(st => coastalThirdTracks(route, st));
  const thirdNear = (sd: number, s: number, m: number) => thirds.some(t => Math.sign(t.outer - t.main) === sd && s > t.from - m && s < t.to + m);
  /** 待避線駅は駅舎が待避線の分だけ外へずれる */
  const stationDepth = (s: number) => route.stations.some(st => st.loop && s > st.platform.from - 25 && s < st.platform.to + 25) ? 54 : 32;
  const tunnelNear = (s: number, m: number) => T.structureAt(s, m)?.kind === 'tunnel';
  const zone = (s: number): 'city' | 'suburb' | 'rural' => {
    if (T.isCity(s)) return 'city';
    if (coastal) return 'suburb'; // 海浜公園周辺も市街地。田園・農家に切り替えない。
    let dc = Infinity;
    for (const z of route.scenery.cityZones) dc = Math.min(dc, Math.abs(s - z.from), Math.abs(s - z.to));
    return dc < 450 || hash(Math.floor(s / 350), 7) > .6 ? 'suburb' : 'rural';
  };
  /** 区画が使えるか（踏切道路・トンネル・川・ホーム側駅前を避ける） */
  const lotFree = (sd: number, a: number, b: number, d: number) => {
    if (towerNear(sd, a, b)) return false;
    if (tramBlocks(route, a - 1, b + 1, latOf(sd, d - 1), latOf(sd, d + 23))) return false; // 阪堺線・高師浜線の高架の通り道
    for (let s = a; s <= b; s += 3) {
      if (!flatOk(s) || !levelAt(s, latOf(sd, d)) || !levelAt(s, latOf(sd, d + 14))) return false;
      if (T.nearCrossing(s, 4) || tunnelNear(s, 80) || T.low(s)) return false;
      if (d < stationDepth(s) && (platSide(sd, s, 25) || thirdNear(sd, s, 25))) return false;
    }
    return true;
  };

  // ローカル座標で置くための親行列（正面 = 線路側）
  const parentAt = (s: number, lat: number, sd: number, y?: number) => {
    const t = track.trackAt(s);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(t.x + t.rx * lat, y ?? T.groundY(s), t.z + t.rz * lat),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -t.phi + (sd < 0 ? -Math.PI / 2 : Math.PI / 2)),
      new THREE.Vector3(1, 1, 1));
  };
  const kitAt = (s: number, lat: number, sd: number) => {
    const b = chunks.at(s); b.parent = parentAt(s, lat, sd);
    return new Kit(b, rnd, atlas);
  };

  // 低ポリの木（山林・屋敷林・河畔林。素材の木より軽い）: 針葉樹（杉）と広葉樹
  const ptree = (s: number, lat: number, y: number, k: number, conifer = rnd() < .55) => {
    const t = track.trackAt(s), b = chunks.at(s); b.parent = null;
    const x = t.x + t.rx * lat, z = t.z + t.rz * lat, h = (conifer ? 11 : 8) * k * (.85 + rnd() * .3);
    b.add('body', TRUNK, M(x, y + h * .2, z, 0, .4 * k, h * .4, .4 * k), 0x5a4636);
    if (conifer) {
      // 段を重ねた樹冠（下ほど広く暗い）
      const pal = [[0x223d25, 0x2b4a2d, 0x335834, 0x3b623b], [0x263f22, 0x2f4b2a, 0x385732, 0x41633a]][Math.floor(rnd() * 2)];
      const n = 4, top = h, base = h * .28;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1), w = (3.6 - 2.4 * f) * k, th = (top - base) * .42, cy = base + (top - base - th) * f + th / 2;
        b.add('body', TIERS[Math.floor(rnd() * 3)], M(x, y + cy, z, rnd() * 6, w, th, w), pal[i]);
      }
    } else {
      // 樹冠: 内側の暗い塊＋外側の明るい塊 5〜7 個
      const pal = [[0x3c5f2e, 0x4d7537, 0x5a8540], [0x3a5a30, 0x4a7038, 0x58803f], [0x45602c, 0x557533, 0x67873c]][Math.floor(rnd() * 3)];
      const cy = y + h * .66, R = 2.6 * k;
      b.add('body', BLOBS[0], M(x, cy, z, rnd() * 6, R * 1.9, R * 1.5, R * 1.9), pal[0]);
      const m = 5 + Math.floor(rnd() * 3);
      for (let i = 0; i < m; i++) {
        const a = i / m * Math.PI * 2 + rnd() * .6, r = R * (.55 + rnd() * .25), up = (rnd() - .3) * R * .7, sz = R * (.9 + rnd() * .45);
        b.add('body', BLOBS[Math.floor(rnd() * 3)], M(x + Math.cos(a) * r, cy + up, z + Math.sin(a) * r, rnd() * 6, sz, sz * .85, sz), pal[1 + (up > 0 ? 1 : 0)]);
      }
    }
  };

  // 帯（道路など）を三角形で追加
  const strip = (b: GeoBatch, a: number, c: number, la: number, lb: number, dy: number, col: number) => {
    const pts: number[] = [];
    for (let s = a; s < c; s += 8) {
      const s2 = Math.min(c, s + 8), p = track.trackAt(s), q = track.trackAt(s2), y1 = T.groundY(s) + dy, y2 = T.groundY(s2) + dy;
      const A = [p.x + p.rx * la, y1, p.z + p.rz * la], B = [p.x + p.rx * lb, y1, p.z + p.rz * lb];
      const C = [q.x + q.rx * la, y2, q.z + q.rz * la], D = [q.x + q.rx * lb, y2, q.z + q.rz * lb];
      // 上向きになる順序（la < lb、s 増加で）
      pts.push(...A, ...C, ...B, ...B, ...C, ...D);
    }
    // 法線が下向きなら反転
    const ux = pts[3] - pts[0], uz = pts[5] - pts[2], vx = pts[6] - pts[0], vz = pts[8] - pts[2];
    if (uz * vx - ux * vz < 0) for (let i = 0; i < pts.length; i += 9) for (let k = 0; k < 3; k++) { const t = pts[i + 3 + k]; pts[i + 3 + k] = pts[i + 6 + k]; pts[i + 6 + k] = t; }
    b.addTris('road', pts, col);
  };

  // OpenStreetMap の沿線データがあるコースは、建物・道路・緑地をデータから作る（osm-town.ts）
  const osmDetail = new ChunkedBatch(300, new Set(['sign']));
  const osm = osmSceneryFor(route);
  if (osm) {
    buildOsmTown(ctx, osm, {
      detail: osmDetail, chunks, shadowChunks, kit: (b, r) => new Kit(b, r, atlas),
      house: (k, w, d) => house(k as Kit, w, d), apartment: (k, w, d) => apartment(k as Kit, w, d),
      mansion: (k, w, d, f) => mansion(k as Kit, w, d, f), shop: (k, w, d) => shop(k as Kit, w, d),
    }, trees);
  }
  // OSM のコース: 地上区間の線路の柵（すべての線路の外側 3.8m。駅・踏切・構造物・分岐する線路の付近は除く）
  if (osm) for (const sd of [-1, 1]) for (let s = S0; s < S1; s += 6) {
    if (T.structureAt(s, 10) || T.nearStation(s, 15) || thirdNear(sd, s, 30) || T.nearCrossing(s, 3) || T.trackY(s) - T.groundY(s) > 1 || !flatOk(s)) continue;
    const [lo, hi] = trackSpan(route, s, 30), lat = sd < 0 ? lo - 3.8 : hi + 3.8;
    if (tramBlocks(route, s - 3, s + 3, lat - .3, lat + .3, true) || towerNear(sd, s - 3, s + 3)) continue;
    const t = track.trackAt(s), g = T.groundY(s), b = chunks.at(s); b.parent = null;
    b.add('body', P.box, M(t.x + t.rx * lat, g + .75, t.z + t.rz * lat, -t.phi, .08, 1.5, .08), 0x5f7a66);
    b.add('fence', P.box, M(t.x + t.rx * lat, g + .95, t.z + t.rz * lat, -t.phi, .03, 1.0, 6), 0x7f9a86);
  }
  for (const sd of osm ? [] : [-1, 1]) {
    // ---- 線路沿いの道路・電柱・電線・柵 ----
    const roadOk = (s: number) => !tunnelNear(s, 30) && !T.low(s) && !platSide(sd, s, 20) && !loopNear(s, 20) && !thirdNear(sd, s, 20) && !T.nearCrossing(s, -1) && !towerNear(sd, s - 6, s + 6) && flatOk(s) && levelAt(s, latOf(sd, 13)) && levelAt(s, latOf(sd, 16.5));
    const dA = 10.5, dB = 15.5, la = latOf(sd, dA), lb = latOf(sd, dB);
    for (let s = S0; s < S1; s += 40) {
      const e = Math.min(S1, s + 40);
      if (!roadOk(s) || !roadOk(e)) continue;
      if (tramBlocks(route, s, e, la, lb, true)) continue;
      const b = chunks.at(s); b.parent = null;
      strip(b, s, e, Math.min(la, lb), Math.max(la, lb), .02, 0x55575c);
      for (const d of [dA + .25, dB - .25]) { const l = latOf(sd, d); strip(b, s, e, l - .07, l + .07, .03, 0xe8e8e8); }
    }
    // 電柱（道路の外側）と電線
    let prev: THREE.Vector3[] | null = null, prevS = -1e9;
    for (let s = S0 + (sd < 0 ? 0 : 15); s < S1; s += 32) {
      if (!roadOk(s) || tramBlocks(route, s - 1, s + 1, latOf(sd, dB + .7) - 1, latOf(sd, dB + .7) + 1)) { prev = null; continue; }
      const lat = latOf(sd, dB + .7), t = track.trackAt(s), g = T.groundY(s);
      const b = chunks.at(s); b.parent = null;
      const p = new THREE.Vector3(t.x + t.rx * lat, g, t.z + t.rz * lat);
      b.add('body', P.cyl6, M(p.x, g + 5.5, p.z, 0, .32, 11, .32), 0x9c9a94);
      for (const [yy, w] of [[10.5, 1.8], [9.6, 1.4]] as const) b.add('body', P.box, M(p.x, g + yy, p.z, -t.phi, w, .12, .12), 0x6a6a6a);
      const hasTr = hash(s, sd) < .3;
      if (hasTr) b.add('body', P.cyl, M(p.x + t.rx * -sd * .45, g + 8.4, p.z + t.rz * -sd * .45, 0, .6, 1.1, .6), 0x8f9496);
      b.add('body', P.box, M(p.x, g + 1.8, p.z, -t.phi, .26, .5, .02), 0xf2f2f2); // 電柱番号札
      // 電線の取り付け点
      const pts = [[-.85, 10.55], [0, 10.55], [.85, 10.55], [-.65, 9.65], [.65, 9.65], [0, 7.2], [0, 6.6]].map(([dx, yy]) =>
        new THREE.Vector3(p.x + t.rx * dx, g + yy, p.z + t.rz * dx));
      if (prev && s - prevS < 40) {
        const arr = wires.get(Math.floor(s / 300)) ?? []; wires.set(Math.floor(s / 300), arr);
        pts.forEach((q, i) => {
          const a = prev![i], sag = i >= 5 ? .55 : .35, N = 6;
          for (let k = 0; k < N; k++) {
            const u0 = k / N, u1 = (k + 1) / N;
            const y0 = a.y + (q.y - a.y) * u0 - sag * 4 * u0 * (1 - u0), y1 = a.y + (q.y - a.y) * u1 - sag * 4 * u1 * (1 - u1);
            arr.push(a.x + (q.x - a.x) * u0, y0, a.z + (q.z - a.z) * u0, a.x + (q.x - a.x) * u1, y1, a.z + (q.z - a.z) * u1);
          }
        });
      }
      prev = pts; prevS = s;
    }
    // 線路の柵（駅・踏切・構造物以外）
    for (let s = S0; s < S1; s += 6) {
      if (T.structureAt(s, 10) || T.nearStation(s, 15) || thirdNear(sd, s, 20) || T.nearCrossing(s, 3) || T.trackY(s) - T.groundY(s) > 1 || !flatOk(s) || !levelAt(s, latOf(sd, 7.8)) || tramBlocks(route, s - 3, s + 3, latOf(sd, 7.8) - .3, latOf(sd, 7.8) + .3, true)) continue;
      const t = track.trackAt(s), lat = latOf(sd, 7.8), g = T.groundY(s), b = chunks.at(s); b.parent = null;
      b.add('body', P.box, M(t.x + t.rx * lat, g + .75, t.z + t.rz * lat, -t.phi, .08, 1.5, .08), 0x5f7a66);
      b.add('fence', P.box, M(t.x + t.rx * lat, g + .95, t.z + t.rz * lat, -t.phi, .03, 1.0, 6), 0x7f9a86);
    }

    // ---- 建物列 ----
    const rows = [17.5, 33, 49];
    rows.forEach((d0, ri) => {
      for (let s = S0 + rnd() * 8; s < S1;) {
        if (parkAt(sd, s)) { s += 20; continue; }
        const z = zone(s);
        if (ri === 2 && z !== 'suburb') { s += 20; continue; } // 3列目は郊外のみ
        if (z === 'rural' && ri > 0 && rnd() < .9) { s += 20 + rnd() * 30; continue; }
        if (z === 'rural' && rnd() < .7) { s += 25 + rnd() * 40; continue; }
        // 種別・寸法
        let type: 'house' | 'apt' | 'mansion' | 'shop' | 'conbini' | 'farm', w: number, dep: number;
        const r = rnd();
        if (z === 'city') {
          if (ri === 0) [type, w, dep] = r < .55 ? ['shop', 6 + rnd() * 4, 9 + rnd() * 3] : r < .62 ? ['conbini', 16, 12] : r < .85 ? ['mansion', 16 + rnd() * 10, 11] : ['apt', 13 + rnd() * 5, 8];
          else [type, w, dep] = r < .6 ? ['mansion', 16 + rnd() * 12, 11] : r < .8 ? ['apt', 13 + rnd() * 5, 8] : ['house', 8 + rnd() * 3, 8];
        } else if (z === 'rural') [type, w, dep] = r < .5 ? ['farm', 12 + rnd() * 3, 10] : ['house', 8 + rnd() * 3, 8];
        else [type, w, dep] = r < .8 ? ['house', 7.5 + rnd() * 3.5, 7 + rnd() * 2.5] : r < .95 ? ['apt', 13 + rnd() * 5, 8] : ['conbini', 16, 12];
        const lotW = w + (type === 'conbini' ? 4 : 2.5);
        if (blockedBuilding(s, s + lotW)) { s += 6; continue; }
        if (!lotFree(sd, s, s + lotW, d0)) { s += 6; continue; }
        const sc = s + lotW / 2, setback = type === 'conbini' ? 11 : type === 'shop' ? .6 : 2.2 + rnd() * 1.5;
        const dc = d0 + setback + dep / 2, lat = latOf(sd, dc);
        const k = kitAt(sc, lat, sd);
        const sb = shadowChunks.at(sc); sb.parent = parentAt(sc, lat, sd);
        sb.add('shadow', P.plane, M(0, .025, 0, 0, w + 5, dep + 5, 1, -Math.PI / 2));
        occ.push({ sd, a: s - 2, b: s + lotW + 2, d: d0 + setback + dep + 3 });
        switch (type) {
          case 'house': house(k, w, dep); break;
          case 'apt': apartment(k, w, dep); break;
          case 'mansion': mansion(k, w, dep, ri === 0 ? 4 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 5)); break;
          case 'shop': shop(k, w, dep); break;
          case 'conbini': conbini(k, w, dep); break;
          case 'farm': farmhouse(k, w, dep); break;
        }
        // ブロック塀・生垣（正面の敷地境界）
        if (type === 'house' || type === 'apt' || type === 'farm') {
          const zfl = -(setback + dep / 2) + .15, gate = (rnd() - .5) * (lotW - 3);
          const hedge = rnd() < .3, hgt = hedge ? 1.2 : .9 + rnd() * .5, col = hedge ? 0x3f6a3a : k.pick([0xa9a69c, 0xb4b0a6, 0x9c998f]);
          const segs: [number, number][] = [[-lotW / 2, gate - .8], [gate + .8, lotW / 2]];
          for (const [a, b2] of segs) if (b2 - a > .3) {
            k.box((a + b2) / 2, hgt / 2, zfl, b2 - a, hgt, .15, col);
            if (!hedge) k.box((a + b2) / 2, hgt + .03, zfl, b2 - a, .06, .2, 0x8a877e);
          }
          if (rnd() < .08 && ri === 0) k.vend(lotW / 2 - .8, zfl - .5, 0);
          // 庭木
          if (rnd() < .55) trees.push({ s: sc + (rnd() - .5) * lotW * .7, lat: latOf(sd, d0 + setback * .5), y: T.groundY(sc), k: .55 + rnd() * .4, small: true });
        }
        s += lotW + (z === 'city' ? .5 + rnd() * 2 : 1 + rnd() * 6);
      }
    });

    // ---- 田畑・竹林・遠景の木（郊外の3列目以遠、田園は1列目から） ----
    const FW = 18, FS = 24;
    for (let s = S0; s < S1; s += FS) {
      const z = zone(s + FS / 2);
      if (z === 'city' || tunnelNear(s, 60)) continue;
      if (coastal && sd !== parkSide) continue; // 公園の東側は上の住宅列を使う。
      const dStart = coastal ? 17.5 : z === 'rural' ? 17.5 : 66;
      for (let d = dStart; d < 330; d += FW) {
        const sc = s + FS / 2;
        if (!lotFree(sd, s, s + FS, d) || T.low(sc)) continue;
        // 建物がある所は避ける
        if (d < 72 && occ.some(o => o.sd === sd && o.d > d && o.a < s + FS && o.b > s)) continue;
        const lat = latOf(sd, d + FW / 2), h = hash(Math.floor(sc / FS), Math.floor(d / FW) + sd * 100);
        const b = chunks.at(sc); b.parent = parentAt(sc, lat, sd);
        if (coastal) coastalParkTile(b, rnd, FW, FS, Math.floor(d / FW) % 5 === 1, h < .56);
        else if (h < .04) bamboo(b, rnd, 7 + rnd() * 4);
        else if (h < .07) { farmhouse(new Kit(b, rnd, atlas), 12, 10); ptree(sc + 8, latOf(sd, d + 2), T.groundY(sc), 1 + rnd() * .4, false); }
        else if (h < .1) for (let i = 0; i < 4; i++) ptree(sc + (rnd() - .5) * FS, latOf(sd, d + rnd() * FW), T.groundY(sc), .9 + rnd() * .6);
        else field(b, rnd, FW, FS);
      }
    }
  }

  // トンネル上の山林（山岳線は mountain-scenery.ts）
  for (const st of MT ? [] : route.structures ?? []) {
    if (st.kind !== 'tunnel') continue;
    for (let s = st.from - 40; s < st.to + 40; s += 7) for (const sd of [-1, 1]) for (let d = 9; d < 150; d += 9 + rnd() * 8) {
      if (rnd() < .3) continue;
      const lat = latOf(sd, d + rnd() * 4), ss = s + (rnd() - .5) * 6;
      if (ss > st.from - 4 && ss < st.to + 4 && Math.abs(lat - 2) < 9) continue;
      if ((ss < st.from || ss > st.to) && Math.abs(lat - 2) < 12) continue;
      ptree(ss, lat, T.terrainY(ss, lat) - .3, 1 + rnd() * .5, rnd() < .7);
    }
  }
  // 川沿いの木・竹
  for (const st of MT ? [] : route.structures ?? []) {
    if (st.kind !== 'bridge') continue;
    for (const sd of [-1, 1]) for (let i = 0; i < 26; i++) {
      const s = st.from + rnd() * (st.to - st.from);
      if (T.low(s, 2.2)) continue;
      const lat = latOf(sd, 12 + rnd() * 150), k = .8 + rnd() * .6;
      if (T.riverNear(s, lat, 3)) continue; // 川の溝・水面（橋の下の溝、OSM の水面）の中は植えない
      ptree(s, lat, T.terrainY(s, lat), k, false);
    }
  }

  // 山岳線の山林・谷川・構造物まわり・山の集落
  if (MT) buildMountainScenery(ctx, MT, { chunks, trees, kit: (b, r) => new Kit(b, r, atlas), house, farmhouse });
  const group = new THREE.Group(); group.name = 'town'; scene.add(group);
  // 遠方のチャンクは距離で非表示（家屋は 1.6km 先でほぼ点、電線は 900m 先で見えない）
  for (const g of chunks.build(mats, group)) cullByDistance(ctx, g, 1600);
  // OSM の近景の建物（窓・ベランダ・看板つき）は 550m まで
  for (const g of osmDetail.build(mats, group)) cullByDistance(ctx, g, 550);
  for (const g of shadowChunks.build({ shadow: shadowMat }, group)) {
    g.traverse(o => { o.userData.noShadow = true; });
    cullByDistance(ctx, g, 350);
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x2a2a2a });
  for (const arr of wires.values()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const l = new THREE.LineSegments(g, wireMat); l.userData.noShadow = true; group.add(l);
    cullByDistance(ctx, l, 900);
  }

  // 夜: 窓・看板・自販機を点灯
  const day = new THREE.Color(0x3a434c), night = new THREE.Color(0xffffff);
  onLight(ctx, f => {
    (mats.lit as THREE.MeshBasicMaterial).color.copy(day).lerp(night, f);
    (mats.sign as THREE.MeshLambertMaterial).emissiveIntensity = .05 + f * .85;
  });
  return { trees };
}
