// 山岳線の構造物: 鉄橋（深い谷は鈑桁＋高い橋脚、大河は上路トラス）、ロックシェッド（坑口の前の落石覆い）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Route } from '../route/types';
import { basePart, GeoBatch, M, P } from './batch';
import { cullByDistance } from './cull';
import type { MountainTerrain } from './mountain-terrain';
import { hash } from './terrain';

type Structure = NonNullable<Route['structures']>[number];

const STEEL_RED = 0x7d3328, STEEL_GREY = 0x5f6b72, CONCRETE = 0xbdb8ac, CONCRETE_D = 0x9f9a8e;
/** 角錐台（上が細い四角柱。底面原点） */
const FRUSTUM = basePart(new THREE.CylinderGeometry(.5 * .72, .5, 1, 4, 1).rotateY(Math.PI / 4).translate(0, .5, 0));

const _a = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** 2 点を結ぶ角材 */
function beam(b: GeoBatch, p0: THREE.Vector3, p1: THREE.Vector3, w: number, h: number, col: number, key = 'body'): void {
  const len = p0.distanceTo(p1);
  if (len < .01) return;
  _m.lookAt(p0, p1, Math.abs(p1.y - p0.y) / len > .98 ? new THREE.Vector3(1, 0, 0) : _up);
  _q.setFromRotationMatrix(_m);
  b.add(key, P.box, new THREE.Matrix4().compose(_a.copy(p0).add(p1).multiplyScalar(.5), _q, _s.set(w, h, len)), col);
}

/** 橋梁 1 本（橋台・床版・桁・高欄・橋脚） */
export function buildMountainSpan(ctx: GameContext, T: MountainTerrain, st: Structure, b: GeoBatch): void {
  const { track } = ctx, len = st.to - st.from;
  const P3 = (s: number, lat: number, y: number) => track.at(s, lat, y);
  const big = len > 250; // 大河の長い橋: 上路トラス
  const yaw = (s: number) => -track.trackAt(s).phi;
  // 床版・地覆・高欄（線路基準 y=0 がレール下面付近）
  for (let s = st.from; s < st.to; s += 5) {
    const e = Math.min(st.to, s + 5), c = (s + e) / 2, p = P3(c, 0, 0), ry = yaw(c), l = e - s + .05;
    b.add('mbody', P.box, M(p.x, p.y - .3, p.z, ry, 5.0, .6, l), CONCRETE);
    for (const sd of [-1, 1]) {
      const q = P3(c, sd * 2.35, 0);
      b.add('mbody', P.box, M(q.x, q.y + .25, q.z, ry, .3, .5, l), CONCRETE);
      b.add('mbody', P.box, M(q.x, q.y + 1.15, q.z, ry, .06, .06, l), big ? STEEL_GREY : STEEL_RED); // 手すり
    }
  }
  for (let s = st.from; s <= st.to; s += 2.5) for (const sd of [-1, 1]) {
    const q = P3(s, sd * 2.35, 0);
    b.add('mbody', P.box, M(q.x, q.y + .85, q.z, yaw(s), .05, .6, .05), big ? STEEL_GREY : STEEL_RED);
  }
  // 橋台
  for (const s of [st.from, st.to]) {
    const g = T.baseY(s, 0), y = T.trackY(s);
    if (y - g < .5) continue;
    const p = P3(s, 0, 0);
    b.add('mbody', P.boxB, M(p.x, g - 1, p.z, yaw(s), 7, y - g + .5, 4), CONCRETE_D);
  }
  // 径間割り
  const spanLen = big ? 52 : 28, n = Math.max(1, Math.round(len / spanLen)), sp = len / n;
  const depth = big ? 6 : 2.1;
  // 橋脚（谷底から桁下まで）
  for (let k = 1; k < n; k++) {
    const s = st.from + k * sp, g = Math.min(T.baseY(s, -2), T.baseY(s, 0), T.baseY(s, 2)) - 1.5, top = T.trackY(s) - .6 - depth;
    const h = top - g;
    if (h < .5) continue;
    const p = P3(s, 0, 0), ry = yaw(s);
    b.add('mbody', P.boxB, M(p.x, g - 1, p.z, ry, 7, 1.5, 7), CONCRETE_D); // 基礎
    b.add('mbody', FRUSTUM, M(p.x, g, p.z, ry, 3.2 + h * .045, h, 4.4 + h * .06), CONCRETE);
    b.add('mbody', P.box, M(p.x, top + .3, p.z, ry, 4.4, .6, 5.6), CONCRETE); // 沓座
  }
  if (!big) {
    // 鈑桁: 主桁 2 本（I 形）、補剛材、横構
    for (let s = st.from; s < st.to; s += 5) {
      const e = Math.min(st.to, s + 5), c = (s + e) / 2, ry = yaw(c), l = e - s + .05;
      for (const sd of [-1, 1]) {
        const q = P3(c, sd * 1.05, 0);
        b.add('mbody', P.box, M(q.x, q.y - .6 - depth / 2, q.z, ry, .04 + .02, depth, l), STEEL_RED); // ウェブ
        b.add('mbody', P.box, M(q.x, q.y - .6 - depth + .03, q.z, ry, .5, .06, l), STEEL_RED); // 下フランジ
        b.add('mbody', P.box, M(q.x, q.y - .63, q.z, ry, .45, .06, l), STEEL_RED);
      }
      for (const sd of [-1, 1]) for (const dz of [-1.25, 1.25]) {
        const q = P3(c + dz, sd * 1.05, 0);
        b.add('mbody', P.box, M(q.x - (P3(c, sd, 0).x - P3(c, 0, 0).x) * .12, q.y - .6 - depth / 2, q.z - (P3(c, sd, 0).z - P3(c, 0, 0).z) * .12, ry, .2, depth - .1, .04), STEEL_RED); // 補剛材
      }
      // 横構（X 形）
      beam(b, P3(s, -1.05, -.6 - depth + .1), P3(e, 1.05, -.6 - depth + .1), .08, .08, STEEL_RED, 'mbody');
      beam(b, P3(s, 1.05, -.6 - depth + .1), P3(e, -1.05, -.6 - depth + .1), .08, .08, STEEL_RED, 'mbody');
    }
    return;
  }
  // 上路トラス: 上弦（床版の下）・下弦・垂直材・斜材（ワーレン）、両側 ±2.2m
  const PANEL = sp / Math.max(4, Math.round(sp / 5.5));
  for (let k = 0; k < n; k++) {
    const a = st.from + k * sp, e = a + sp;
    for (const sd of [-1, 1]) {
      const lat = sd * 2.2;
      for (let s = a; s < e - .01; s += PANEL) {
        const s2 = Math.min(e, s + PANEL);
        const top0 = P3(s, lat, -.65), top1 = P3(s2, lat, -.65), bot0 = P3(s, lat, -.65 - depth), bot1 = P3(s2, lat, -.65 - depth);
        beam(b, top0, top1, .45, .5, STEEL_GREY, 'mbody');
        beam(b, bot0, bot1, .45, .5, STEEL_GREY, 'mbody');
        beam(b, top0, bot0, .3, .3, STEEL_GREY, 'mbody');
        // ワーレン: パネルごとに向きを交互に
        const up = Math.round((s - a) / PANEL) % 2 === 0;
        beam(b, up ? bot0 : top0, up ? top1 : bot1, .32, .32, STEEL_GREY, 'mbody');
      }
      beam(b, P3(e, lat, -.65), P3(e, lat, -.65 - depth), .3, .3, STEEL_GREY, 'mbody');
    }
    // 下横構
    for (let s = a; s < e - .01; s += PANEL * 2) {
      const s2 = Math.min(e, s + PANEL * 2);
      beam(b, P3(s, -2.2, -.65 - depth), P3(s2, 2.2, -.65 - depth), .12, .12, STEEL_GREY, 'mbody');
      beam(b, P3(s, 2.2, -.65 - depth), P3(s2, -2.2, -.65 - depth), .12, .12, STEEL_GREY, 'mbody');
    }
  }
}

/** ロックシェッド: 坑口の前（線路の外側へ L m）に、山側の壁・屋根・谷側の柱 */
export function buildRockSheds(ctx: GameContext, T: MountainTerrain): void {
  const { route, track, scene } = ctx;
  const tunnels = (route.structures ?? []).filter(s => s.kind === 'tunnel');
  const b = new GeoBatch();
  const blocked = (s: number) => T.structureAt(s, 0)?.kind === 'bridge' || T.nearStation(s, 30) || T.nearCrossing(s, 15) || T.flat(s) > .2 || T.bridgeW(s) > 0;
  for (const t of tunnels) {
    for (const [end, dir] of [[t.from, -1], [t.to, 1]] as const) {
      if (hash(T.canon(end) * .013, 5) > .55) continue;
      const L = 40 + Math.round(hash(T.canon(end) * .021, 6) * 4) * 8;
      let ok = true;
      for (let d = 0; d <= L + 20; d += 5) if (blocked(end + dir * d) || T.structureAt(end + dir * d, 0)?.kind === 'tunnel' && d > 2) { ok = false; break; }
      if (!ok) continue;
      const s0 = Math.min(end, end + dir * L), s1 = Math.max(end, end + dir * L), vs = T.valleySide((s0 + s1) / 2);
      const P3 = (s: number, lat: number, y: number) => track.at(s, lat, y);
      for (let s = s0; s < s1; s += 4) {
        const e = Math.min(s1, s + 4), c = (s + e) / 2, ry = -track.trackAt(c).phi, l = e - s + .04;
        // 山側の壁（基礎から屋根まで）
        const w = P3(c, -vs * 4.9, 0);
        b.add('body', P.boxB, M(w.x, w.y - .3, w.z, ry, 1.0, 8.9, l), CONCRETE);
        // 屋根（谷側へ少し下がる）と敷き土
        const r = P3(c, 0, 0);
        b.add('body', P.box, M(r.x, r.y + 8.3, r.z, ry, 10.6, .9, l, 0, -vs * .05), CONCRETE);
        b.add('body', P.box, M(r.x, r.y + 9.0, r.z, ry, 10.2, .5, l, 0, -vs * .05), 0x7d7562);
        // 谷側の梁
        const v = P3(c, vs * 4.75, 0);
        b.add('body', P.box, M(v.x, v.y + 7.55, v.z, ry, .7, .7, l), CONCRETE);
      }
      // 谷側の柱（5m ごと、斜めの方杖付き）
      for (let s = s0 + 1; s <= s1 - .5; s += 5) {
        const ry = -track.trackAt(s).phi, v = P3(s, vs * 4.75, 0);
        b.add('body', P.boxB, M(v.x, v.y - .4, v.z, ry, .6, 8.0, .6), CONCRETE);
        beam(b, P3(s, vs * 4.75, 5.8), P3(s, vs * 3.6, 7.6), .35, .35, CONCRETE);
      }
      // 外側の端（坑口でない側）の妻
      const eS = dir < 0 ? s0 : s1, ry = -track.trackAt(eS).phi, r = P3(eS, 0, 0);
      b.add('body', P.box, M(r.x, r.y + 8.6, r.z, ry, 11, 1.6, .8), CONCRETE_D);
    }
  }
  const mesh = b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) });
  for (const m of mesh) { m.castShadow = m.receiveShadow = true; scene.add(m); cullByDistance(ctx, m, 1500); }
}
