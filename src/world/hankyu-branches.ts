// 阪急神戸線の駅で、神戸線と直角に並ぶ支線のホームと線路（描画だけ。route.extraTracks は線路に沿う形しか描けないため専用に描く）。
// 出典: 配線略図.net 阪急電鉄神戸線 figures/010_03、Wikipedia「西宮北口駅」「夙川駅」（2026-10-13 閲覧）。
//   西宮北口: 今津北線（北側。頭端式3面2線、6・7号線）、今津南線（南側。高架の単式1面1線、5号線。2010年高架化）
//   夙川: 甲陽線（単式1面1線。神戸本線の大阪方面行きホームの北側に垂直に延びる）
// 座標は下り（大阪梅田 → 神戸三宮）の向きで、u = 駅の中心からの s 方向のずれ（神戸三宮へ正）、v = 神戸線の中心（横位置 2）からの北への距離。
// 上り（'-up'）では s と横位置を反転して同じ物理位置に置く。ホームの長さ・線の間隔・高さはゲーム用の概形。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { GeoBatch, P, M } from './batch';
import { cullByDistance } from './cull';

interface Branch {
  station: string;
  /** 線路の u（駅の中心から） */
  tracks: number[];
  /** ホーム（中心の u、幅） */
  platforms: { u: number; w: number }[];
  /** 線路の範囲 v（神戸線に近い側に車止め）・ホームの範囲 v */
  v: [number, number]; pv: [number, number];
  /** 高架の高さ [m]（今津南線） */
  elevated?: number;
}
const BRANCHES: Branch[] = [
  { station: '西宮北口', tracks: [-4.6, 4.6], platforms: [{ u: -9.2, w: 5.8 }, { u: 0, w: 5.8 }, { u: 9.2, w: 5.8 }], v: [20, 420], pv: [20, 170] },
  { station: '西宮北口', tracks: [3], platforms: [{ u: -2.6, w: 5 }], v: [-20, -420], pv: [-20, -150], elevated: 7 },
  { station: '夙川', tracks: [2.5], platforms: [{ u: -2.2, w: 4 }], v: [10, 320], pv: [10, 120] },
];
/** 神戸線と平行に並ぶ、ほかの線のホーム（線路は route.extraTracks）。lat = 下りの座標の中心、u0〜u1 = 駅の中心からの範囲 */
const SIDE_PLATFORMS: { station: string; lat: number; width: number; u0: number; u1: number }[] = [
  { station: '中津', lat: 13.5, width: 2.6, u0: -95, u1: 95 }, // 宝塚線の島式（3・4号線。神戸線と同じく狭い）。線路は hankyu-kobe.ts の takarazuka-down（10.5）・up（16.5）
];
const GAUGE = .7175;

export function buildHankyuBranches(ctx: GameContext): void {
  const route = ctx.route;
  if (route.lineId !== 'hankyu-kobe') return;
  const up = route.id.endsWith('-up'), K = up ? -1 : 1;
  const b = new GeoBatch(), group = new THREE.Group();
  const W = (c: number, u: number, v: number, dy = 0) => {
    const lat = 2 + v;
    return ctx.track.at(c + K * u, up ? 4 - lat : lat, dy);
  };
  /** p → q の箱（幅 w・高さ h、底面を p・q の高さ + y0 に置く） */
  const seg = (p: THREE.Vector3, q: THREE.Vector3, w: number, h: number, y0: number, col: number) => {
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
    b.add('m', P.boxB, M((p.x + q.x) / 2, (p.y + q.y) / 2 + y0, (p.z + q.z) / 2, Math.atan2(dx, dz), w, h, len), col);
  };
  for (const br of BRANCHES) {
    const st = route.stations.find(x => x.name === br.station);
    if (!st) continue;
    const c = (st.platform.from + st.platform.to) / 2, dy = br.elevated ?? 0;
    const [v0, v1] = br.v, n = Math.max(2, Math.ceil(Math.abs(v1 - v0) / 20)), dir = Math.sign(v1 - v0);
    for (const u of br.tracks) {
      for (let k = 0; k < n; k++) {
        const va = v0 + (v1 - v0) * k / n, vb = v0 + (v1 - v0) * (k + 1) / n;
        // 道床・レール（v の向きに伸びる）
        seg(W(c, u, va, dy), W(c, u, vb, dy), 3.2, .3, -.3, 0x8a8478);
        for (const g of [-GAUGE, GAUGE]) seg(W(c, u + g, va, dy), W(c, u + g, vb, dy), .07, .16, 0, 0x6c6a66);
      }
      // 枕木（u の向き）
      for (let v = v0; dir * (v1 - v) > 0; v += dir * .65) seg(W(c, u - 1.2, v, dy), W(c, u + 1.2, v, dy), .22, .12, -.02, 0x5a4a3a);
      // 車止め（神戸線側の端）
      seg(W(c, u - 1, v0 - dir * .5, dy), W(c, u + 1, v0 - dir * .5, dy), .6, 1.2, 0, 0xc03a2c);
    }
    for (const pf of br.platforms) {
      const [a, z] = br.pv, m = Math.max(2, Math.ceil(Math.abs(z - a) / 20));
      for (let k = 0; k < m; k++) {
        const va = a + (z - a) * k / m, vb = a + (z - a) * (k + 1) / m;
        seg(W(c, pf.u, va, dy), W(c, pf.u, vb, dy), pf.w, 1.1, -.2, 0xb9b4aa); // ホーム
        seg(W(c, pf.u, va, dy), W(c, pf.u, vb, dy), pf.w * .8, .12, 3.6, 0x6e6a64); // 上屋
        for (const s of [-1, 1]) seg(W(c, pf.u + s * (pf.w / 2 - .15), va, dy), W(c, pf.u + s * (pf.w / 2 - .15), vb, dy), .12, .02, .9, 0xe8c840); // 黄色の線
      }
      for (let v = a; Math.sign(z - a) * (z - v) > 0; v += Math.sign(z - a) * 10) {
        const p = W(c, pf.u, v, dy);
        b.add('m', P.boxB, M(p.x, p.y + .9, p.z, 0, .2, 2.7, .2), 0x8c8a86); // 上屋の柱
      }
    }
    if (dy) {
      // 高架（今津南線）: 床版と橋脚
      const u0 = Math.min(...br.tracks, ...br.platforms.map(p => p.u - p.w / 2)) - 1, u1 = Math.max(...br.tracks, ...br.platforms.map(p => p.u + p.w / 2)) + 1;
      for (let k = 0; k < n; k++) {
        const va = v0 + (v1 - v0) * k / n, vb = v0 + (v1 - v0) * (k + 1) / n, um = (u0 + u1) / 2;
        seg(W(c, um, va, dy), W(c, um, vb, dy), u1 - u0, .9, -1.2, 0xa9a59c);
        const p = W(c, um, va, 0);
        b.add('m', P.boxB, M(p.x, p.y - 6, p.z, 0, 1.2, dy + 4.8, 1.2), 0x9e9a92);
      }
    }
  }
  for (const sp of SIDE_PLATFORMS) {
    const st = route.stations.find(x => x.name === sp.station);
    if (!st) continue;
    const c = (st.platform.from + st.platform.to) / 2, v = sp.lat - 2, dy = st.elevated ? 0 : 0;
    for (let u = sp.u0; u < sp.u1; u += 19) {
      const ue = Math.min(sp.u1, u + 19), p = W(c, u, v, dy), q = W(c, ue, v, dy);
      seg(p, q, sp.width, 1.1, -.2, 0xb9b4aa);
      seg(p, q, sp.width * .8, .12, 3.6, 0x6e6a64);
      for (const sd of [-1, 1]) seg(W(c, u, v + sd * (sp.width / 2 - .15), dy), W(c, ue, v + sd * (sp.width / 2 - .15), dy), .12, .02, .9, 0xe8c840);
      b.add('m', P.boxB, M(p.x, p.y + .9, p.z, 0, .2, 2.7, .2), 0x8c8a86);
    }
  }
  b.build({ m: new THREE.MeshLambertMaterial({ vertexColors: true }) }, group);
  group.name = 'hankyu-branches';
  ctx.scene.add(group);
  cullByDistance(ctx, group, 2500);
}
