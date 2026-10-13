// 山岳線の沿線: 杉・檜の針葉樹林と広葉樹、谷川の岩、切土法面（法枠・落石防護網・落石防護柵）、山の集落。
// town-jp.ts の buildTown から呼ばれ、同じチャンク（300m、材質ごとに結合・距離カリング）へ積む。木は軽い低ポリ形状
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { createRng, type Rng } from '../core/rng';
import { basePart, M, P, type ChunkedBatch, type GeoBatch } from './batch';
import { Tag, type MountainTerrain } from './mountain-terrain';
import { hash } from './terrain';
import type { Kit, TreeSpot } from './town-jp';

export interface TownHooks {
  chunks: ChunkedBatch;
  trees: TreeSpot[];
  kit(b: GeoBatch, rnd: Rng): Kit;
  house(k: Kit, w: number, d: number): void;
  farmhouse(k: Kit, w: number, d: number): void;
}

// 軽い木の部品（杉の樹冠 = 開いた円錐 7 面、広葉樹 = 正二十面体、幹 = 5 面）
const CONE = basePart(new THREE.ConeGeometry(.5, 1, 7, 1, true));
const BLOB = basePart(new THREE.IcosahedronGeometry(.5, 0));
const TRUNK = basePart(new THREE.CylinderGeometry(.3, .45, 1, 5, 1, true));
const SUGI = [0x1f3a22, 0x24412a, 0x2a4627, 0x203b2a];
const HINOKI = [0x2b4a2c, 0x30502f, 0x355433];
const BROAD = [0x3d5a34, 0x46633a, 0x4f6b3c, 0x38552f, 0x587040];

/** 杉（細長い円錐 2 段）。y = 根元 */
function sugi(b: GeoBatch, rnd: Rng, x: number, y: number, z: number, h: number): void {
  const col = SUGI[Math.floor(rnd() * SUGI.length)], w = h * (.26 + rnd() * .06);
  b.add('body', TRUNK, M(x, y + h * .2, z, 0, h * .045, h * .4, h * .045), 0x4e3c2e);
  b.add('body', CONE, M(x, y + h * .58, z, rnd() * 6, w, h * .72, w), col);
  b.add('body', CONE, M(x, y + h * .86, z, rnd() * 6, w * .62, h * .3, w * .62), col);
}
/** 檜（やや丸い円錐） */
function hinoki(b: GeoBatch, rnd: Rng, x: number, y: number, z: number, h: number): void {
  const col = HINOKI[Math.floor(rnd() * HINOKI.length)], w = h * (.34 + rnd() * .06);
  b.add('body', TRUNK, M(x, y + h * .15, z, 0, h * .045, h * .3, h * .045), 0x5a4232);
  b.add('body', CONE, M(x, y + h * .55, z, rnd() * 6, w, h * .8, w), col);
}
/** 広葉樹（塊 2 個） */
function broad(b: GeoBatch, rnd: Rng, x: number, y: number, z: number, h: number): void {
  const col = BROAD[Math.floor(rnd() * BROAD.length)], R = h * .33;
  b.add('body', TRUNK, M(x, y + h * .25, z, 0, h * .07, h * .5, h * .07), 0x4a3c30);
  b.add('body', BLOB, M(x, y + h * .58, z, rnd() * 6, R * 2, R * 1.7, R * 2), col);
  const a = rnd() * 6.28;
  b.add('body', BLOB, M(x + Math.cos(a) * R * .6, y + h * .78, z + Math.sin(a) * R * .6, rnd() * 6, R * 1.4, R * 1.1, R * 1.4), new THREE.Color(col).multiplyScalar(1.12).getHex());
}

export function buildMountainScenery(ctx: GameContext, T: MountainTerrain, H: TownHooks): void {
  const { track, route } = ctx, rnd = createRng(77031);
  const S0 = route.extent.from - 300, S1 = route.extent.to + 300;
  const tag = { tag: Tag.Forest };
  const tunnels = (route.structures ?? []).filter(s => s.kind === 'tunnel');
  const yardAt = (s: number, lat: number, m: number) => T.yards.some(y => s > y.from - 40 && s < y.to + 40 && lat > -y.left - m && lat < y.right + m);
  const portalNear = (s: number, lat: number) => tunnels.some(t => (Math.abs(s - t.from) < 14 || Math.abs(s - t.to) < 14) && Math.abs(lat) < 14);
  const world = (s: number, lat: number) => { const t = track.trackAt(s); return { x: t.x + t.rx * lat, z: t.z + t.rz * lat }; };

  // ---- 山林（線路際〜中景は木、遠景は地面の色） ----
  const tree = (s: number, lat: number, far: boolean) => {
    const y = T.sample(s, lat, tag);
    if (tag.tag === Tag.Shelf || tag.tag === Tag.RiverBed || tag.tag === Tag.Field || tag.tag === Tag.Cut) return;
    if (tag.tag === Tag.Fill && rnd() < .6) return;
    if ((T.flat(s) > .6 && y - T.trackY(s) < 3) || yardAt(s, lat, 6) || portalNear(s, lat) || T.nearCrossing(s, 6)) return;
    if (T.bridgeW(s) > 0 && Math.abs(lat) < 10) return;
    if (Math.abs(lat - T.riverLat(s)) < T.riverHalf(s) + 4) return;
    const b = H.chunks.at(s); b.parent = null;
    const p = world(s, lat), cs = T.canon(s);
    // 植林（杉・檜）と雑木林の斑。谷筋・川沿いは広葉樹が多い
    const plant = hash(Math.floor(cs / 140), Math.floor(lat * T.latSign / 90)) < .62;
    const nearRiver = Math.abs(lat - T.riverLat(s)) < 30;
    const h = (far ? 15 : 13) * (.8 + rnd() * .45);
    if (far) {
      // 中景: 円錐 1 つ（杉）または塊 1 つ
      if (plant || rnd() < .4) b.add('body', CONE, M(p.x, y + h * .5, p.z, rnd() * 6, h * .34, h, h * .34), SUGI[Math.floor(rnd() * SUGI.length)]);
      else b.add('body', BLOB, M(p.x, y + h * .45, p.z, rnd() * 6, h * .55, h * .5, h * .55), BROAD[Math.floor(rnd() * BROAD.length)]);
      return;
    }
    if (plant && !nearRiver) (rnd() < .7 ? sugi : hinoki)(b, rnd, p.x, y - .3, p.z, h * 1.15);
    else if (rnd() < .3) sugi(b, rnd, p.x, y - .3, p.z, h);
    else broad(b, rnd, p.x, y - .3, p.z, h * .8);
  };
  for (let s = S0; s < S1; s += 4.5 + rnd() * 3) {
    for (const sd of [-1, 1]) {
      const W = T.shelf(s, sd);
      for (let d = W + 3 + rnd() * 3; d < 46; d += 3.8 + rnd() * 4.5) tree(s + (rnd() - .5) * 4, sd * d, false);
    }
  }
  for (let s = S0 - 300; s < S1 + 300; s += 9 + rnd() * 6) {
    for (const sd of [-1, 1]) for (let d = 46 + rnd() * 8; d < 250; d += 9 + rnd() * 9) {
      if (hash(Math.floor(T.canon(s) / 60), Math.floor(d / 50) + sd) < .12) continue; // 伐採跡・岩場の切れ間
      tree(s + (rnd() - .5) * 8, sd * d, true);
    }
  }
  // 素材の木（広葉樹）を線路際に少し
  for (let s = S0; s < S1; s += 30 + rnd() * 40) {
    const sd = rnd() < .5 ? -1 : 1, lat = sd * (T.shelf(s, sd) + 4 + rnd() * 10);
    const y = T.sample(s, lat, tag);
    if (tag.tag !== Tag.Forest && tag.tag !== Tag.Hill && tag.tag !== Tag.Fill) continue;
    if (T.flat(s) > .6 || yardAt(s, lat, 4) || portalNear(s, lat) || (T.bridgeW(s) > 0 && Math.abs(lat) < 10)) continue;
    H.trees.push({ s, lat, y: y - .2, k: .9 + rnd() * .5 });
  }

  // ---- 谷川の岩 ----
  for (let s = S0; s < S1; s += 5 + rnd() * 9) {
    if (T.flat(s) > .5) continue;
    const r = T.riverLat(s), hw = T.riverHalf(s), lat = r + (rnd() * 2 - 1) * (hw + 3);
    const p = world(s, lat), y = T.riverY(s), sz = .8 + rnd() * rnd() * 3.2;
    const b = H.chunks.at(s); b.parent = null;
    b.add('body', BLOB, M(p.x, y - sz * .15, p.z, rnd() * 6, sz * 1.4, sz * .8, sz * 1.2), [0x8d8a80, 0x7a776e, 0x9a968a, 0x6e6c66][Math.floor(rnd() * 4)]);
  }

  buildSlopeWorks(ctx, T, H.chunks);
  buildVillages(ctx, T, H, rnd);
}

/** 切土法面: 法枠・落石防護網と、法肩の落石防護柵 */
function buildSlopeWorks(ctx: GameContext, T: MountainTerrain, chunks: ChunkedBatch): void {
  const { track, route } = ctx;
  const STEP = 5;
  // 山側の切土の高さ（法肩までの横距離 dx と高さ h）
  const cutAt = (s: number, sd: number): { W: number; dx: number; h: number } | null => {
    const W = T.shelf(s, sd), y0 = T.trackY(s), tag = { tag: Tag.Forest };
    let dx = 0, h = 0;
    for (let k = 1; k <= 14; k++) {
      const lat = sd * (W + k);
      const y = T.sample(s, lat, tag, false);
      if (tag.tag !== Tag.Cut) break;
      dx = k; h = y - y0;
    }
    return h > 3 ? { W, dx, h } : null;
  };
  const pt = (s: number, lat: number, y: number) => { const t = track.trackAt(s); return [t.x + t.rx * lat, y, t.z + t.rz * lat]; };
  for (let s = route.extent.from; s < route.extent.to; s += STEP) {
    if (T.structureAt(s, 2) || T.flat(s) > .3 || T.nearStation(s, 60)) continue;
    for (const sd of [-1, 1]) {
      const c0 = cutAt(s, sd), c1 = cutAt(s + STEP, sd);
      if (!c0 || !c1 || c0.h / c0.dx < 1.2 || c1.h / c1.dx < 1.2) continue;
      const cs = T.canon(s), kind = hash(Math.floor(cs / 90), sd * T.latSign + 3);
      const b = chunks.at(s); b.parent = null;
      const y0a = T.trackY(s), y0b = T.trackY(s + STEP);
      // 法面の上に沿う四角形（オフセット off）を帯で張る
      const quad = (key: string, a0: number, a1: number, off: number, col: number) => {
        const A = pt(s, sd * (c0.W + c0.dx * a0 - off), y0a + c0.h * a0 + off * .6), B = pt(s, sd * (c0.W + c0.dx * a1 - off), y0a + c0.h * a1 + off * .6);
        const C = pt(s + STEP, sd * (c1.W + c1.dx * a0 - off), y0b + c1.h * a0 + off * .6), D = pt(s + STEP, sd * (c1.W + c1.dx * a1 - off), y0b + c1.h * a1 + off * .6);
        const tri = sd < 0 ? [...A, ...B, ...C, ...C, ...B, ...D] : [...A, ...C, ...B, ...B, ...C, ...D];
        b.addTris(key, tri, col);
      };
      if (kind < .55) {
        // 落石防護網（斜面に掛けた金網）
        quad('fence', .05, 1, .08, 0x4a4f52);
      }
      // 法肩の落石防護柵（H 鋼の支柱＋金網）
      if (kind > .3) {
        const top = (q: number, c: { W: number; dx: number; h: number }) => ({ lat: sd * (c.W + c.dx + .8), y: T.trackY(q) + c.h });
        const a = top(s, c0), e = top(s + STEP, c1);
        const pa = pt(s, a.lat, a.y), pe = pt(s + STEP, e.lat, e.y);
        const t = track.trackAt(s);
        b.add('body', P.box, M(pa[0], a.y + 1.5, pa[2], -t.phi, .2, 3.2, .2), 0x6d7378);
        b.addTris('fence', [...pa.slice(0, 1), a.y + .1, pa[2], ...pe.slice(0, 1), e.y + .1, pe[2], pa[0], a.y + 3, pa[2],
          pa[0], a.y + 3, pa[2], pe[0], e.y + .1, pe[2], pe[0], e.y + 3, pe[2]], 0x5a6064);
        b.add('body', P.box, M((pa[0] + pe[0]) / 2, (a.y + e.y) / 2 + 3, (pa[2] + pe[2]) / 2, -t.phi, .06, .06, STEP), 0x6d7378);
      }
    }
  }
}

/** 山の集落: 交換駅・棒線駅の近くの斜面に数軒（石垣で平場を作った上に家） */
function buildVillages(ctx: GameContext, T: MountainTerrain, H: TownHooks, rnd: Rng): void {
  const { track } = ctx;
  for (const y of T.yards) {
    if (y.kind !== 'loop' && y.kind !== 'halt' && y.kind !== 'terminal') continue;
    const n = y.kind === 'halt' ? 3 : 5;
    let placed = 0;
    for (let tries = 0; tries < 40 && placed < n; tries++) {
      const sd = rnd() < .7 ? y.side : -y.side;
      const ext = sd < 0 ? y.left : y.right;
      const s = (y.from + y.to) / 2 + (rnd() - .5) * 220, d = ext + 10 + rnd() * 50;
      const lat = sd * d, w = 8 + rnd() * 3, dep = 7 + rnd() * 2;
      if (T.structureAt(s, 30) || T.nearCrossing(s, 12)) continue;
      // 敷地の四隅の地表
      const hs = [-1, 1].flatMap(a => [-1, 1].map(c => T.sample(s + a * w / 2, sd * (d + c * dep / 2))));
      const top = Math.max(...hs), low = Math.min(...hs);
      if (top - low > 6 || Math.abs(lat - T.riverLat(s)) < T.riverHalf(s) + 10) continue;
      const t = track.trackAt(s), b = H.chunks.at(s);
      b.parent = new THREE.Matrix4().compose(
        new THREE.Vector3(t.x + t.rx * lat, top + .1, t.z + t.rz * lat),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -t.phi + (sd < 0 ? -Math.PI / 2 : Math.PI / 2)),
        new THREE.Vector3(1, 1, 1));
      const k = H.kit(b, rnd);
      // 石垣（敷地の下）
      const hh = top - low + 1.2;
      k.box(0, -hh / 2 + .1, 0, w + 3, hh, dep + 4, 0x8c887c);
      k.box(0, .12, 0, w + 3, .1, dep + 4, 0x6f7a52);
      if (rnd() < .65) H.house(k, w, dep); else H.farmhouse(k, w + 2, dep + 1);
      b.parent = null;
      placed++;
    }
  }
}
