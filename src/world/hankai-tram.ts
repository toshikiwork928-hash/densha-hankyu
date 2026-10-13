// 阪堺線（路面電車）の跨線橋。浜寺公園〜諏訪ノ森の間で南海本線を約20°の斜交で越える（描画専用。走行経路・信号は持たない）。
// 地上の複線 → 上り勾配（最大 約58‰、盛土は擁壁・高い所は橋脚）→ 南海の真上（レール面 +9.35m の床版）→ 下り勾配 → 地上。
// 浜寺公園側（s が小さい側）は海側（西）、堺側は内陸側（東）。周りの道路は OpenStreetMap の沿線データ（osm-town.ts）。
// 物理配置は下りの向き（s 増加 = 北東）の局所座標 (u: 進行方向, v: 右) で定義し、上りの区間データ（reversed）は座標を 180° 回して同じ位置へ置く。
import * as THREE from 'three';
import { profileLat } from '../route/service';
import type { GameContext } from '../core/context';
import type { Route } from '../route/types';
import { GeoBatch, M, P } from './batch';
import { cullByDistance } from './cull';
import { getTerrain } from './terrain';
import { DIVERGE_D, hagoromoSpec } from './hagoromo-branch';

/** 路線データ側の目印（kind === 'tram-overpass'）。s = 斜交の中心 */
interface Mark { kind: string; s: number; reversed?: boolean }

const THETA = 20 * Math.PI / 180, SIN = Math.sin(THETA), COS = Math.cos(THETA);
/** 南海の複線（横位置 0 と 4）の中心。局所座標の原点 */
const PIVOT_LAT = 2;
/** 軸（路面電車の中心線）に沿った距離 a: 床版が水平な範囲・勾配区間・地上区間 */
const FLAT = 36, RAMP = 260, GROUND = 140, HALF = FLAT + RAMP + GROUND;
/** 軸に沿った a の位置にある橋脚の線（南海の建築限界の外側）: 南海中心から横 8.7m、軸上では a = 8.7/sin */
const PIER_V = 8.7;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/** 縦断の形（1 = 南海の真上の高さ、0 = 地上） */
const prof = (a: number) => 1 - smooth((Math.abs(a) - FLAT) / RAMP);

const COLOR = { concrete: 0xb8b7ad, steel: 0x647773, rail: 0x9caaa9, ballast: 0x7c786d, sleeper: 0x5b5147, fill: 0x6f6a5c, road: 0x4f5357, line: 0xe5e3cd, yellow: 0xd9b84a, stop: 0xb5352a };

const UP = new THREE.Vector3(0, 1, 0);
function beam(b: GeoBatch, a: THREE.Vector3, z: THREE.Vector3, width: number, color: number, depth = width): void {
  const d = z.clone().sub(a), len = d.length();
  if (len < .001) return;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  b.add('coastal', P.box, new THREE.Matrix4().compose(a.clone().add(z).multiplyScalar(.5), q, new THREE.Vector3(width, len, depth)), color);
}
/** 帯（幅・厚み固定、長軸は両端に合わせる） */
function strip(b: GeoBatch, a: THREE.Vector3, z: THREE.Vector3, width: number, height: number, color: number): void {
  const d = z.clone().sub(a), length = d.length();
  if (length < .001) return;
  const p = a.clone().add(z).multiplyScalar(.5), yaw = Math.atan2(d.x, d.z);
  b.add('coastal', P.box, M(p.x, p.y, p.z, yaw, width, height, length + .04, -Math.asin(d.y / length)), color);
}

// ---- 周辺の建物・木・道路を避けるための範囲（路線の s・横位置で表す。南海は直線） ----

interface Disc { s: number; lat: number; r: number; span: boolean }
const corridors = new WeakMap<Route, Disc[] | null>();

function discs(route: Route): Disc[] | null {
  const cached = corridors.get(route);
  if (cached !== undefined) return cached;
  const mk = (route.coastalLandmarks ?? []).find(l => l.kind === 'tram-overpass') as Mark | undefined;
  let out: Disc[] | null = null;
  if (mk) {
    out = [];
    const sgn = (mk.reversed ?? route.id.endsWith('-up')) ? -1 : 1;
    const put = (a: number, off: number, r: number, span: boolean) => {
      const u = a * COS - off * SIN, v = a * SIN + off * COS;
      out!.push({ s: mk.s + sgn * u, lat: PIVOT_LAT + sgn * v, r, span });
    };
    for (let a = -HALF - 30; a <= HALF + 30; a += 5) {
      // 南海の真上の径間と、高さ 4.5m 以上の高架の下は道路を通す
      put(a, 0, 8, Math.abs(a) <= PIER_V / SIN + 8 || prof(a) * 9.35 > 4.5);
    }
  }
  // 羽衣の3番線（高師浜線）の高架支線: 本線から離れていく先の通り道（中心 ±11m）にも建物・木を置かない
  const h = hagoromoSpec(route);
  if (h) {
    out ??= [];
    for (let d = DIVERGE_D - 40; d <= h.length + 20; d += 6) out.push({ s: h.sOf(d), lat: h.lat(d), r: 11, span: d < DIVERGE_D + 60 });
  }
  // 追加の線路（複々線・番線・支線・入出庫線）の高架の通り道（中心 ±8m）
  for (const x of route.extraTracks ?? []) {
    out ??= [];
    for (let q = x.from; q <= x.to; q += 6) out.push({ s: q, lat: profileLat(x.lat, q), r: 8, span: false });
  }
  for (const c of route.tracks) {
    const p = route.trackProfiles?.[String(c)];
    if (!p) continue;
    out ??= [];
    for (let q = route.extent.from; q <= route.extent.to; q += 6) out.push({ s: q, lat: profileLat(p, q), r: 6, span: false });
  }
  corridors.set(route, out);
  return out;
}

/** 長方形 [s0,s1] × [lat0,lat1] が阪堺線の跨線橋（地上・斜路・高架）に掛かるか。
 *  underSpan = true なら南海の真上の径間と高い高架の下は通す（道路・柵向け。電柱・建物・木は false） */
export function tramBlocks(route: Route, s0: number, s1: number, lat0: number, lat1: number, underSpan = false): boolean {
  const a = Math.min(s0, s1), b = Math.max(s0, s1), c = Math.min(lat0, lat1), d = Math.max(lat0, lat1);
  // 景観を置かない敷地（車庫・大型施設）
  for (const z of route.reserved ?? []) if (a < z.to && b > z.from && c < z.lat1 && d > z.lat0) return true;
  const ds = discs(route);
  if (!ds) return false;
  for (const q of ds) {
    if (underSpan && q.span) continue;
    if (q.s + q.r < a || q.s - q.r > b || q.lat + q.r < c || q.lat - q.r > d) continue;
    const dx = Math.max(a - q.s, 0, q.s - b), dy = Math.max(c - q.lat, 0, q.lat - d);
    if (dx * dx + dy * dy < q.r * q.r) return true;
  }
  return false;
}

// ---- 描画 ----

export function buildHankaiTram(ctx: GameContext, st: Mark): void {
  const { track } = ctx, T = getTerrain(ctx);
  const sgn = (st.reversed ?? ctx.route.id.endsWith('-up')) ? -1 : 1;
  const t0 = track.trackAt(st.s), piv = track.at(st.s, PIVOT_LAT, 0);
  // 下りの向きの前方 f と右 r（水平単位ベクトル）。上りは両方とも反転
  const fx = sgn * Math.sin(t0.phi), fz = -sgn * Math.cos(t0.phi), rx = sgn * t0.rx, rz = sgn * t0.rz;
  const yawAxis = Math.atan2(fx * COS + rx * SIN, fz * COS + rz * SIN), yawF = Math.atan2(fx, fz);
  const gnd = (a: number, off = 0) => T.groundY(st.s + sgn * (a * COS - off * SIN));
  const g0 = gnd(0), bed0 = t0.y + 9.35 + .62;
  /** 軌道面（バラスト上面）の高さ */
  const bed = (a: number) => gnd(a) + .12 + (bed0 - g0 - .12) * prof(a);
  const W = (a: number, off: number, y: number): THREE.Vector3 => {
    const u = a * COS - off * SIN, v = a * SIN + off * COS;
    return new THREE.Vector3(piv.x + fx * u + rx * v, y, piv.z + fz * u + rz * v);
  };
  const b = new GeoBatch();
  /** 軸に平行な箱（長さ len = 軸方向、wid = 軸に直角、中心 y） */
  const ab = (a: number, off: number, y: number, len: number, wid: number, hgt: number, color: number) => {
    const p = W(a, off, y); b.add('coastal', P.box, M(p.x, p.y, p.z, yawAxis, wid, hgt, len), color);
  };
  /** 軸上の2点間の帯。top = 上面の高さ関数、drop = 上面から帯の中心までの距離 */
  const band = (a0: number, a1: number, off: number, top: (a: number) => number, drop: number, width: number, thick: number, color: number) =>
    strip(b, W(a0, off, top(a0) - drop), W(a1, off, top(a1) - drop), width, thick, color);

  const STEP = 6;
  for (let a = -HALF; a < HALF; a += STEP) {
    const a1 = Math.min(HALF, a + STEP), am = (a + a1) / 2;
    const y0 = bed(a), y1 = bed(a1), gm = gnd(am), hm = (y0 + y1) / 2 - gm;
    const hi = Math.max(y0, y1), lo = Math.min(y0, y1);
    if (hm >= 5.8) {
      // 高架: 床版・バラスト・高欄（南海の真上は鋼の桁）
      band(a, a1, 0, bed, .62, 9, 1.2, COLOR.concrete);
      band(a, a1, 0, bed, .05, 8, .1, COLOR.ballast);
      const girder = Math.abs(am) <= 29;
      for (const o of [-4.3, 4.3]) band(a, a1, o, bed, girder ? -1.15 : -.5, girder ? .26 : .3, girder ? 2.5 : 1.1, girder ? COLOR.steel : COLOR.concrete);
    } else if (hm >= .5) {
      // 盛土: 両側の擁壁と中詰め
      for (const o of [-4.35, 4.35]) {
        const bot = gm - .4, top = hi + .35;
        ab(am, o, (bot + top) / 2, STEP + .05, .35, top - bot, COLOR.concrete);
      }
      ab(am, 0, (gm - .3 + lo - .1) / 2, STEP + .05, 8.4, lo - .1 - (gm - .3), COLOR.fill);
      band(a, a1, 0, bed, .08, 8.4, .16, COLOR.ballast);
    } else {
      band(a, a1, 0, bed, .1, 6.4, .2, COLOR.ballast);
    }
    // 複線のレール（軌間 1.435、線間 3.1m）
    for (const c of [-1.55, 1.55]) for (const r of [c - .7175, c + .7175]) band(a, a1, r, bed, -.06, .065, .12, COLOR.rail);
  }
  // 枕木（水平の短い箱。勾配は最大 6% 弱なので傾きは無視）
  for (let a = -HALF + .5; a < HALF; a += 1.1) for (const c of [-1.55, 1.55]) ab(a, c, bed(a) + .02, .16, 2.3, .09, COLOR.sleeper);

  // 橋脚（高架部）。南海の真上: 建築限界の外側に南海と平行な梁、その外は軸に直角の2柱
  const colBox = (x: number, z: number, g: number, top: number, w: number, d: number, yaw: number) => {
    if (top - g < .3) return;
    b.add('coastal', P.boxB, M(x, g, z, yaw, w, top - g, d), COLOR.concrete);
  };
  for (const k of [-1, 1]) {
    const u = k * PIER_V / SIN * COS, v = k * PIER_V, p = W(0, 0, 0);
    const cx = piv.x + fx * u + rx * v, cz = piv.z + fz * u + rz * v, bottom = bed0 - 1.22, g = T.groundY(st.s + sgn * u);
    b.add('coastal', P.box, M(cx, bottom - .55, cz, yawF, 1.8, 1.1, 25), COLOR.concrete);
    for (const du of [-8, 8]) colBox(cx + fx * du, cz + fz * du, g, bottom - 1.1, 1.5, 1.5, yawF);
    void p;
  }
  for (const k of [-1, 1]) for (let i = 1; i < 30; i++) {
    const a = k * (PIER_V / SIN + 20 * i);
    if (Math.abs(a) > HALF) break;
    const y = bed(a), g = gnd(a), bottom = y - 1.22;
    if (y - g < 5.8) break;
    for (const o of [-2.8, 2.8]) { const q = W(a, o, 0); colBox(q.x, q.z, gnd(a, o), bottom - .9, 1.5, 1.3, yawAxis); }
    ab(a, 0, bottom - .45, 1.7, 8.4, .9, COLOR.concrete);
  }

  // 架線柱（片側）と吊架線
  for (let a = -HALF + 12; a < HALF; a += 30) {
    const y = bed(a);
    beam(b, W(a, -3.8, y), W(a, -3.8, y + 7.4), .16, COLOR.steel);
    beam(b, W(a, -3.8, y + 7), W(a, 1.8, y + 7), .1, COLOR.steel);
  }
  for (const c of [-1.55, 1.55]) for (let a = -HALF; a < HALF; a += STEP) {
    const a1 = Math.min(HALF, a + STEP);
    beam(b, W(a, c, bed(a) + 5.7), W(a1, c, bed(a1) + 5.7), .028, 0x6d726d);
  }
  // 終端（地上）の車止め
  for (const k of [-1, 1]) {
    const e = k * (HALF - 3);
    for (const c of [-1.55, 1.55]) {
      ab(e, c, bed(e) + .55, .4, 1.2, 1.1, 0x4b4f50);
      ab(e - k * .21, c, bed(e) + .85, .15, 1.2, .3, COLOR.stop);
    }
  }
  // 高架上の電車（南海の真上、手前の線）
  {
    const a = 18, y = bed(a) - .62, c = -1.55;
    ab(a, c, y + 2.4, 11.5, 2.4, 2.7, 0x67997c);
    ab(a, c, y + 3.85, 11.7, 2.45, .2, 0xd4cec0);
    ab(a, c, y + 1.42, 11.4, 2.45, .4, 0xc9c9b8);
    for (let x = a - 4.2; x < a + 5; x += 1.7) for (const o of [c - 1.22, c + 1.22]) ab(x, o, y + 2.9, 1.15, .03, 1.05, 0x364d50);
    for (const x of [a - 3.7, a + 3.7]) for (const o of [c - .75, c + .75]) ab(x, o, y + 1.03, .7, .28, .65, 0x393d3c);
    for (const dx of [-.8, .8]) {
      beam(b, W(a, c, y + 4), W(a + dx, c, y + 5), .065, 0x414c48);
      beam(b, W(a + dx, c, y + 5), W(a, c, y + 6), .065, 0x414c48);
    }
    ab(a, c, y + 6, .16, 1.2, .07, 0x414c48);
  }

  const group = new THREE.Group();
  group.name = `coastal-tram-overpass-${Math.round(st.s)}`;
  b.build({ coastal: new THREE.MeshLambertMaterial({ vertexColors: true }) }, group);
  ctx.scene.add(group);
  cullByDistance(ctx, group, 1400);
}
