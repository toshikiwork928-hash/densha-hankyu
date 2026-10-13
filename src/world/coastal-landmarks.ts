// 南海本線の目印。道路の跨線橋（路面電車の跨線橋は hankai-tram.ts）、鋼橋、描画専用支線。
// 走行経路・信号・分岐器制御は持たず、路線データに指定した位置だけに置く。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { GeoBatch, M, P } from './batch';
import { cullByDistance } from './cull';
import { getTerrain } from './terrain';
import { islandOffset } from '../route/service';
import { buildTwinTower } from './izumiotsu-towers';
import { buildHankaiTram } from './hankai-tram';
import { BUMPER_D, DIVERGE_D, hagoromoSpec } from './hagoromo-branch';

type Landmark = {
  kind: 'road-overpass' | 'tram-overpass' | 'steel-bridge' | 'branch' | 'twin-tower';
  s: number;
  length?: number;
  label?: string;
  side?: 1 | -1;
  direction?: 1 | -1;
  reversed?: boolean;
  color?: number;
  trussStyles?: ('pratt' | 'warren')[];
};
const UP = new THREE.Vector3(0, 1, 0);
const COLOR = { concrete: 0xb8b7ad, steel: 0x647773, road: 0x51565a, line: 0xe5e3cd, rail: 0x9caaa9, ballast: 0x7c786d };

/** 任意向きの角材を、独立メッシュを増やさずバッチへ積む。 */
function beam(b: GeoBatch, a: THREE.Vector3, z: THREE.Vector3, width: number, color: number, depth = width): void {
  const d = z.clone().sub(a), len = d.length();
  if (len < .001) return;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  b.add('coastal', P.box, new THREE.Matrix4().compose(a.clone().add(z).multiplyScalar(.5), q, new THREE.Vector3(width, len, depth)), color);
}

/** 帯。横幅と厚みを固定し、線路の向きが変わっても床版が回転しない。勾配のある区間は長軸を両端に合わせる。 */
function strip(b: GeoBatch, a: THREE.Vector3, z: THREE.Vector3, width: number, height: number, color: number): void {
  const d = z.clone().sub(a), length = d.length();
  if (length < .001) return;
  const p = a.clone().add(z).multiplyScalar(.5), yaw = Math.atan2(d.x, d.z);
  b.add('coastal', P.box, M(p.x, p.y, p.z, yaw, width, height, length + .04, -Math.asin(d.y / length)), color);
}

/** 跨線橋は線路に斜交。軌道の真上には橋脚を置かない。 */
function crossing(ctx: GameContext, b: GeoBatch, st: Landmark): void {
  const { track } = ctx, t = track.trackAt(st.s), terrain = getTerrain(ctx);
  const side = st.side ?? -1, span = st.length ?? 155, width = 19;
  // 路線データの side は下りの斜交の向き。上りは進行方向が逆で、reverseRoute が side を反転しているので、
  // そのまま使うと橋が物理的に鏡像になる（斜交が逆、橋上の電車の位置も反対）。同じ物理配置になるよう、上りは座標を 180° 回して斜交を保つ。
  const up = st.reversed ?? ctx.route.id.endsWith('-up'), sgn = up ? -1 : 1, skew = (up ? -side : side) * .26;
  // 上りの自線（横位置 0）は下りの対向線（横位置 4）の位置。橋の中心は物理的に同じ点へ。
  const base = track.at(st.s, up ? Math.max(...ctx.route.tracks) : 0, 0);
  // 主線の吊架線・門形ビームも通せる余裕を取る。
  const deckY = t.y + 9.35, roadAngle = -t.phi + skew;
  const p = (x: number, y: number, z = 0): THREE.Vector3 => {
    const c = Math.cos(roadAngle), s = Math.sin(roadAngle), xx = x * sgn, zz = z * sgn;
    return new THREE.Vector3(base.x + c * xx + s * zz, y, base.z - s * xx + c * zz);
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: number) => {
    const v = p(x, y, z); b.add('coastal', P.box, M(v.x, v.y, v.z, roadAngle, w, h, d), col);
  };
  box(0, deckY, 0, span, 1.2, width, COLOR.concrete);
  box(0, deckY + .62, 0, span, .07, width - .65, COLOR.road);
  for (const z of [-width / 2, width / 2]) {
    box(0, deckY + 1.2, z, span, 1.2, .3, COLOR.concrete);
    box(0, deckY + 1.9, z, span, .09, .09, COLOR.steel);
    for (let x = -span / 2 + 2; x < span / 2; x += 3) box(x, deckY + 1.65, z, .065, .65, .065, COLOR.steel);
  }
  // 橋脚: 中央の無柱スパン（本線・待避線の建築限界）を避け、両端にも橋台代わりの橋脚を置く。
  const pierAt = (x: number) => {
    const ground = terrain.groundY(st.s + sgn * x * Math.sin(skew)), height = deckY - .6 - ground;
    if (height <= 0) return;
    for (const z of [-width * .3, width * .3]) box(x, ground + height / 2, z, 1.2, height, 1.5, COLOR.concrete);
    box(x, deckY - 1, 0, 2.5, .8, width + .4, COLOR.concrete);
  };
  for (let x = -span / 2 + 12; x < span / 2; x += 27) if (Math.abs(x) >= 18) pierAt(x);
  for (const x of [-span / 2 + 3, span / 2 - 3]) pierAt(x);
  // 4車線バイパス。線路から見える床版・側壁が主役。
  box(0, deckY + .8, 0, span, .3, .6, COLOR.concrete);
  for (const z of [-width * .25, width * .25]) for (let x = -span / 2 + 2; x < span / 2; x += 11) box(x, deckY + .68, z, 5, .02, .12, COLOR.line);
  for (const [x, z, color] of [[-42, -6.8, 0xe8e4db], [39, 6.8, 0x537186], [62, -2.3, 0x98755a]] as const) {
    box(x, deckY + 1.25, z, 4.1, 1.05, 1.7, color);
    box(x, deckY + 2, z, 2.2, .55, 1.5, color);
    box(x, deckY + 2.03, z, 2.25, .4, 1.52, 0x40565e);
  }
}

/** 既存 buildStructures の川面・橋脚・床版に、上部鋼トラスだけを追加。 */
function truss(ctx: GameContext, b: GeoBatch, st: Landmark, edges?: [number, number], style?: 'pratt' | 'warren'): void {
  const steel = st.color ?? ctx.route.bridgeStyle?.color ?? COLOR.steel;
  if (edges) { if (style) curvedTruss(ctx, b, st, edges[0], edges[1], steel, style); else trussSpan(ctx, b, st, edges[0], edges[1], steel); return; }
  // 線路の横位置（route.trackProfiles）。上下線が 7m 以上離れる所は単線のトラスを線路ごとに
  const lats = ctx.route.tracks.map(c => c + islandOffset(ctx.route, c, st.s)).sort((a, z) => a - z);
  if (lats[lats.length - 1] - lats[0] > 7) {
    // 線路ごとの形式（trussStyles は route.tracks の横位置の小さい線から。向きが反転した側は逆順）
    const rev = st.reversed ?? ctx.route.id.endsWith('-up'), styles = st.trussStyles && (rev ? [...st.trussStyles].reverse() : st.trussStyles);
    lats.forEach((l, i) => truss(ctx, b, { ...st, kind: 'steel-bridge' }, [l - 2.7, l + 2.7], styles?.[i]));
    return;
  }
  const left = lats[0] - 3.4, right = lats[lats.length - 1] + 3.4;
  trussSpan(ctx, b, st, left, right, steel);
}

/** 下路曲弦トラス1連（紀ノ川橋梁）。上弦は放物線状に端から中央へ高くなる（端 7.6m・中央 10.6m）、下弦は水平。
 *  pratt = 全部の格点に垂直材、斜材は中央へ向かって下がる（引張材）。warren = 斜材が交互に上下する（垂直材は端柱だけ）。
 *  上弦の横構（各格点の横材と対角材）。寸法・パネル数は実測ではなくゲーム用の概形 */
function curvedTruss(ctx: GameContext, b: GeoBatch, st: Landmark, left: number, right: number, steel: number, style: 'pratt' | 'warren'): void {
  const length = st.length ?? 62, from = st.s - length / 2, n = 10, H0 = 7.6, H1 = 10.6, BOT = .8;
  const top = (i: number) => H0 + (H1 - H0) * (1 - (2 * i / n - 1) ** 2);
  const pt = (i: number, lat: number, y: number) => ctx.track.at(from + length * i / n, lat, y);
  for (const side of [left, right]) {
    for (let i = 0; i < n; i++) {
      beam(b, pt(i, side, BOT), pt(i + 1, side, BOT), .5, steel, .5);
      beam(b, pt(i, side, top(i)), pt(i + 1, side, top(i + 1)), .55, steel, .6);
    }
    for (let i = 0; i <= n; i++) if (style === 'pratt' || i === 0 || i === n) beam(b, pt(i, side, BOT), pt(i, side, top(i)), i === 0 || i === n ? .55 : .34, steel, .4);
    for (let i = 0; i < n; i++) {
      let a: THREE.Vector3, z: THREE.Vector3;
      if (style === 'pratt') {
        // 左半分は上弦の外側の格点から下弦の内側の格点へ、右半分は対称
        [a, z] = i < n / 2 ? [pt(i, side, top(i)), pt(i + 1, side, BOT)] : [pt(i + 1, side, top(i + 1)), pt(i, side, BOT)];
      } else {
        [a, z] = i % 2 === 0 ? [pt(i, side, BOT), pt(i + 1, side, top(i + 1))] : [pt(i, side, top(i)), pt(i + 1, side, BOT)];
      }
      beam(b, a, z, .3, steel, .36);
    }
  }
  // 上弦の横構: 各格点の横材（端は門構え）と、パネルごとの対角材
  for (let i = 0; i <= n; i++) beam(b, pt(i, left, top(i)), pt(i, right, top(i)), i === 0 || i === n ? .4 : .28, steel, .3);
  for (let i = 1; i < n - 1; i++) beam(b, pt(i, i % 2 ? left : right, top(i)), pt(i + 1, i % 2 ? right : left, top(i + 1)), .16, steel, .16);
}

/** 鋼トラス1連（left / right = 両側の主構の横位置） */
function trussSpan(ctx: GameContext, b: GeoBatch, st: Landmark, left: number, right: number, steel: number): void {
  const length = st.length ?? 170, from = st.s - length / 2, to = st.s + length / 2;
  const point = (s: number, lat: number, y: number) => ctx.track.at(s, lat, y);
  const count = Math.max(2, Math.ceil(length / 18));
  for (let i = 0; i < count; i++) {
    const a = from + length * i / count, z = from + length * (i + 1) / count;
    for (const side of [left, right]) {
      beam(b, point(a, side, .8), point(z, side, .8), .32, steel, .46);
      beam(b, point(a, side, 9.2), point(z, side, 9.2), .29, steel, .38);
      beam(b, point(a, side, .8), point(a, side, 9.2), .28, steel);
      beam(b, point(a, side, i % 2 ? 9.2 : .8), point(z, side, i % 2 ? .8 : 9.2), .25, steel);
    }
    beam(b, point(a, left, 9.2), point(a, right, 9.2), .28, steel);
    beam(b, point(a, left, 9.2), point(z, right, 9.2), .14, steel);
  }
  for (const side of [left, right]) beam(b, point(to, side, .8), point(to, side, 9.2), .28, steel);
  beam(b, point(to, left, 9.2), point(to, right, 9.2), .28, steel);
}

/** 羽衣の3番線（高師浜線）。ホームの車止めから本線と3線並行のまま高架を泉大津側へ進み、のちに海側（西）へ曲がって離れ、行き止まりで終わる（走行不可の描画専用）。
 *  並行区間の床版・高欄は structures.ts（本線の高架）が受け持ち、離れた先の床版・橋脚・高欄・架線柱はここで描く。平面形は world/hagoromo-branch.ts。 */
function branch(ctx: GameContext, b: GeoBatch, st: Landmark): void {
  const h = hagoromoSpec(ctx.route);
  if (!h) return;
  const { side, length } = h, terrain = getTerrain(ctx);
  /** d 地点の3番線中心（線路基準 y）と、進行方向に直角の水平単位ベクトル（+側 = 本線の横位置が増える向き） */
  const frame = (d: number) => {
    const s = h.sOf(d), c = (q: number) => ctx.track.at(q, h.lat(h.dOf(q)), 0);
    const p = c(s), a = c(s - 1), z = c(s + 1);
    let tx = z.x - a.x, tz = z.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { p, nx: -tz, nz: tx, s };
  };
  const pt = (d: number, off = 0, height = 0): THREE.Vector3 => {
    const f = frame(d);
    return new THREE.Vector3(f.p.x + f.nx * off, f.p.y + height, f.p.z + f.nz * off);
  };
  const rails = (d: number, z: number) => {
    strip(b, pt(d, 0, .11), pt(z, 0, .11), 3.2, .22, COLOR.ballast);
    for (const lat of [-.5335, .5335]) strip(b, pt(d, lat, .31), pt(z, lat, .31), .07, .14, COLOR.rail);
  };
  const pier = (d: number) => {
    const f = frame(d), g0 = terrain.groundY(f.s), top = f.p.y - 1.1, height = top - g0;
    if (height < .5) return;
    for (const off of [-2.2, 2.2]) b.add('coastal', P.boxB, M(f.p.x + f.nx * off, g0, f.p.z + f.nz * off, Math.atan2(f.nx, f.nz), 1.3, height, 1.3), COLOR.concrete);
    b.add('coastal', P.box, M(f.p.x, top - .5, f.p.z, Math.atan2(f.nx, f.nz), 6.4, 1, 1.5), COLOR.concrete);
  };
  const pole = (d: number) => {
    beam(b, pt(d, side * 2.9, 0), pt(d, side * 2.9, 6.9), .16, COLOR.steel);
    beam(b, pt(d, side * 2.9, 6.5), pt(d, side * .2, 6.5), .1, COLOR.steel);
  };
  // 車止めは線路終端を塞ぐ物なので、建築限界検査の対象外（clearanceExempt）として別グループに置く。
  const stops = new GeoBatch();
  const bumper = (d: number, inward: 1 | -1) => {
    const e = d + inward * .6;
    for (const lat of [-.95, .95]) beam(stops, pt(e, lat, 0), pt(e, lat, 1.1), .2, 0x4b4f50);
    beam(stops, pt(e, -1, .9), pt(e, 1, .9), .22, 0x4b4f50, .3);
    beam(stops, pt(e, -.8, .62), pt(e, .8, .62), .1, 0xb5352a, .34);
  };
  const STEP = 6, SLAB = DIVERGE_D + 40, PARAPET = DIVERGE_D + 80;
  // 軌道（車止めから先端まで）。枕木は進行方向に直角。
  for (let d = BUMPER_D; d < length; d += STEP) {
    const z = Math.min(length, d + STEP);
    rails(d, z);
    for (let q = d; q < z; q += .8) strip(b, pt(q, -1.05, .22), pt(q, 1.05, .22), .2, .14, 0x605951);
    beam(b, pt(d, 0, 5.72), pt(z, 0, 5.72), .03, 0x68706b);
  }
  // 離れた先の床版・高欄（並行区間は本線の高架の床版）
  for (let d = SLAB; d < length; d += STEP) {
    const z = Math.min(length, d + STEP);
    strip(b, pt(d, 0, -.54), pt(z, 0, -.54), 6.6, 1.1, COLOR.concrete);
    if (d >= PARAPET) for (const off of [-3.2, 3.2]) strip(b, pt(d, off, .6), pt(z, off, .6), .25, 1.15, COLOR.concrete);
  }
  for (let d = PARAPET + 10; d < length; d += 24) pier(d);
  for (let d = DIVERGE_D - 25; d < length; d += 25) if (d > DIVERGE_D + 10) pole(d);
  bumper(BUMPER_D, 1); bumper(length, -1);
  const stopGroup = new THREE.Group(); stopGroup.name = 'branch-bumper'; stopGroup.userData.clearanceExempt = 'rail-stop';
  stops.build({ coastal: new THREE.MeshLambertMaterial({ vertexColors: true }) }, stopGroup);
  ctx.scene.add(stopGroup); cullByDistance(ctx, stopGroup, 1100);
  void st;
}

export function buildCoastalLandmarks(ctx: GameContext): void {
  // Optional metadata keeps mountain routes entirely unchanged.
  const list: Landmark[] = ctx.route.coastalLandmarks ?? [];
  if (!list.length) return;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const st of list) {
    if (st.kind === 'twin-tower') { buildTwinTower(ctx, st); continue; } // 泉大津駅前の2棟並びのタワー
    if (st.kind === 'tram-overpass') { buildHankaiTram(ctx, st); continue; } // 阪堺線の跨線橋（world/hankai-tram.ts）
    const batch = new GeoBatch(), group = new THREE.Group();
    group.name = `coastal-${st.kind}-${Math.round(st.s)}`;
    if (st.kind === 'road-overpass') crossing(ctx, batch, st);
    else if (st.kind === 'steel-bridge') truss(ctx, batch, st);
    else branch(ctx, batch, st);
    batch.build({ coastal: material }, group);
    ctx.scene.add(group);
    cullByDistance(ctx, group, st.kind === 'branch' ? 1100 : 1400);
  }
}
