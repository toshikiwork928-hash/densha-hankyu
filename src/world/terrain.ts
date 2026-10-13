// 地形: 地面の高さ（勾配・高架・橋梁・トンネルに合わせる）、地面メッシュ、盛土、トンネル上の山
// 地面は線路方向に変化し、横方向は川の溝（橋の下は一律、離れた所は OSM の水面の形、river.ts）とトンネル上の山だけ変化する。
// 線路より高くならないので切通しは生じない
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Route } from '../route/types';
import type { Track } from '../route/track';
import { loopZone, profileLat, trackSpan } from '../route/service';
import { osmFor, osmReady, osmSceneryFor } from './osm-town';
import { RIVER_WATER, makeRiverField, type RiverField } from './river';
import { buildMountainTerrain, makeMountainTerrain, type MountainTerrain } from './mountain-terrain';

export type StructureKind = 'tunnel' | 'viaduct' | 'bridge';
type Structure = NonNullable<Route['structures']>[number];

export interface Terrain {
  /** 線路方向位置 s における地面の標高 */
  groundY(s: number): number;
  /** 山（トンネル上）を含む地表の標高 */
  terrainY(s: number, lat: number): number;
  /** 周囲の山（route.relief）の、線路の地面からの高さ [m]。線路から ±350m 以内は 0 */
  reliefY(s: number, lat: number): number;
  trackY(s: number): number;
  /** s を含む構造物（margin だけ拡張して判定） */
  structureAt(s: number, margin?: number): Structure | undefined;
  /** 川（橋の下）の水面標高。範囲外は null */
  riverAt(s: number): number | null;
  /** 川の溝を除いた地面の標高（線路の位置の高さ。橋の下の溝・OSM の川の溝を含まない） */
  dryY(s: number): number;
  /** (s, lat) の川の溝の深さ [m]（0 = 溝なし）。橋の下の溝と OSM の水面に沿った溝を合わせた値 */
  riverDepth(s: number, lat: number): number;
  /** (s, lat) が川の溝・水面から margin [m] 以内か（建物・木・道路の判定用） */
  riverNear(s: number, lat: number, margin?: number): boolean;
  /** 川として扱う OSM の water 面の目印（river.ts の areaKey）。osm-town はこれを池として貼らない */
  riverAreaKeys: Set<string>;
  /** 川がある s の範囲（橋の範囲と OSM の水面。細かい格子で地面を作る） */
  riverSpans(): [number, number][];
  /** 川の溝の lat の範囲（OSM の水面。無ければ null） */
  riverLatRange(): [number, number] | null;
  /** 地面が低い所か（川の溝など。建物・道路・木を置かない判定）。m [m] を超えて低いとき true。
   *  既定は地面の高さ 0 を基準に -m より低い所。groundFollowsTrack のコースは線路の高さに沿う地面を基準に、橋の下の溝が m より深い所 */
  low(s: number, m?: number): boolean;
  isCity(s: number): boolean;
  /** 踏切の道路にかかるか */
  nearCrossing(s: number, margin?: number): boolean;
  /** ホーム付近か */
  nearStation(s: number, margin?: number): boolean;
  /** 曲率 [1/m]（右カーブ正） */
  curvature(s: number): number;
}

export const TUNNEL_HALF = 5, TUNNEL_CENTER = 2, TUNNEL_WALL_H = 3.2;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

const cache = new WeakMap<GameContext, Terrain>();

export function getTerrain(ctx: GameContext): Terrain {
  let t = cache.get(ctx);
  if (!t) { t = ctx.route.theme === 'mountain' ? makeMountainTerrain(ctx.route, ctx.track) : makeTerrain(ctx.route, ctx.track); cache.set(ctx, t); }
  return t;
}

function makeTerrain(route: Route, track: Track): Terrain {
  const structs = route.structures ?? [];
  const tunnels = structs.filter(s => s.kind === 'tunnel'), bridges = structs.filter(s => s.kind === 'bridge');
  const trackY = (s: number) => track.trackAt(s).y;
  const tunnelW = (s: number) => {
    let w = 0;
    for (const t of tunnels) {
      const d = Math.max(t.from - 150 - s, s - (t.to + 150), 0);
      w = Math.max(w, smooth(1 - d / 350));
    }
    return w;
  };
  const riverDip = (s: number) => {
    let d = 0;
    for (const b of bridges) {
      const c = (b.from + b.to) / 2, half = (b.to - b.from) / 2;
      d = Math.max(d, 6 * smooth((half * .85 - Math.abs(s - c)) / (half * .4)));
    }
    return d;
  };
  // 地面が線路の高さに沿うコース（groundFollowsTrack）: 線路が地面の高さ。高架（viaduct）の所だけ viaductHeight だけ地面が低い（両端 120m で線路の高さへ）
  const follow = !!route.groundFollowsTrack, viaducts = structs.filter(s => s.kind === 'viaduct'), viaductH = route.viaductHeight ?? 9;
  const viaductDrop = (s: number) => {
    let d = 0;
    for (const v of viaducts) d = Math.max(d, viaductH * smooth((s - v.from) / 120) * smooth((v.to - s) / 120));
    return d;
  };
  // 橋の下の地面を下げる（drop を持つ橋。紀ノ川橋梁）: 橋の中では両端 120m でならして、桁と水面の間を空ける
  const dropBridges = bridges.filter(b => b.drop);
  const bridgeDrop = (s: number) => {
    let d = 0;
    for (const b of dropBridges) d = Math.max(d, b.drop! * smooth((s - b.from) / 120) * smooth((b.to - s) / 120));
    return d;
  };
  const dryY = (s: number) => {
    const y = trackY(s);
    if (follow) return y - viaductDrop(s) - bridgeDrop(s);
    return y >= 0 ? y * tunnelW(s) : y;
  };
  const groundY = (s: number) => dryY(s) - riverDip(s);
  // OSM の水面に沿った溝。沿線データはコース読み込み後に使える（loadOsmFor）ので、最初に使えるようになった時に作って持ち続ける
  //（releaseOsmData の後も使う）。読み込み前に呼ばれた時は溝なしを返し、確定しない
  let river: RiverField | null | undefined;
  const getRiver = (): RiverField | null => {
    if (river === undefined && osmReady(route)) river = makeRiverField(osmFor(route), bridges);
    return river ?? null;
  };
  /** 橋の下の溝（まっすぐ）: 線路の帯とその両側 6m は橋の範囲の溝のまま、そこから 16m で消える */
  const stubDepth = (s: number, lat: number) => {
    const d = riverDip(s);
    if (d <= 0) return 0;
    const [lo, hi] = trackSpan(route, s, 30), out = lat < lo ? lo - lat : lat > hi ? lat - hi : 0;
    return d * (1 - smooth((out - 6) / 16));
  };
  const riverDepth = (s: number, lat: number) => Math.max(stubDepth(s, lat), getRiver()?.depth(s, lat) ?? 0);
  const hill = (s: number, lat: number) => {
    for (const t of tunnels) {
      if (s < t.from || s > t.to) continue;
      const A = 12 + 26 * smooth(Math.min(s - t.from, t.to - s) / 140);
      const x = Math.abs(lat - TUNNEL_CENTER);
      return A * (x < 14 ? 1 : x > 150 ? 0 : .5 + .5 * Math.cos((x - 14) / 136 * Math.PI));
    }
    return 0;
  };
  // 周囲の山（route.relief）: 行（100m ごとの s）を線形補間し、横は節点を線形に結ぶ。
  // 既定は線路から ±350m 以内を 0 にし（OSM の建物・道路が平らな地面を前提に置かれる）、外側だけ。
  // route.reliefNear の範囲（山あいの区間）は、線路際 25m を除いて ±350m 以内にも広げる。
  // 斜面の傾きは 0.55（約 29°）まで。縁（高さ 0）から外へ向かって、節点ごとに高さを頭打ちにする（標高データの崖を斜面にならす）
  const MAX_SLOPE = .55, NEAR = 45;
  const clampRows = (rows: number[][], baseL: number) => rows.map(row => {
    const L = route.relief!.lats, out = row.slice();
    for (const j of L.keys()) if (Math.abs(L[j]) <= baseL) out[j] = 0;
    for (const dir of [1, -1]) {
      let prevL = baseL * dir, prevH = 0;
      const order = [...L.keys()].filter(j => Math.abs(L[j]) > baseL && Math.sign(L[j]) === dir).sort((p, q) => Math.abs(L[p]) - Math.abs(L[q]));
      for (const j of order) { out[j] = Math.min(out[j], prevH + MAX_SLOPE * Math.abs(L[j] - prevL)); prevL = L[j]; prevH = out[j]; }
    }
    return out;
  });
  const Ro = route.relief && { ...route.relief, rows: clampRows(route.relief.rows, 350) };
  const Rf = route.relief && route.reliefNear?.length ? { ...route.relief, rows: clampRows(route.relief.rows, NEAR) } : undefined;
  const nearMask = (s: number) => {
    let m = 0;
    for (const z of route.reliefNear ?? []) m = Math.max(m, smooth(Math.min(s - z.from, z.to - s) / 150));
    return m;
  };
  const sampleRelief = (Rr: NonNullable<typeof Ro>, s: number, lat: number): number => {
    const f = Math.max(0, Math.min(Rr.rows.length - 1 - 1e-9, (s - Rr.s0) / Rr.step)), k = Math.floor(f), u = f - k;
    const row = (j: number) => Rr.rows[k][j] * (1 - u) + Rr.rows[Math.min(Rr.rows.length - 1, k + 1)][j] * u;
    const L = Rr.lats;
    if (lat <= L[0]) return row(0);
    if (lat >= L[L.length - 1]) return row(L.length - 1);
    let j = 0; while (j + 2 < L.length && lat > L[j + 1]) j++;
    const t = (lat - L[j]) / (L[j + 1] - L[j]);
    return row(j) * (1 - t) + row(j + 1) * t;
  };
  const reliefY = (s: number, lat: number): number => {
    if (!Ro) return 0;
    const m = Rf ? nearMask(s) : 0;
    if (m <= 0 && Math.abs(lat) <= 350) return 0;
    const outer = Math.abs(lat) <= 350 ? 0 : sampleRelief(Ro, s, lat);
    if (m <= 0 || !Rf) return outer;
    const full = sampleRelief(Rf, s, lat) * smooth((Math.abs(lat) - NEAR) / 40);
    return outer * (1 - m) + full * m;
  };
  const crossings = route.crossings ?? [];
  return {
    groundY, trackY, reliefY,
    terrainY: (s, lat) => dryY(s) + hill(s, lat) + reliefY(s, lat) - riverDepth(s, lat),
    dryY, riverDepth,
    riverNear: (s, lat, m = 0) => {
      if (stubDepth(s - m, lat) > 0 || stubDepth(s, lat) > 0 || stubDepth(s + m, lat) > 0) return true;
      const r = getRiver();
      return !!r && r.dist(s, lat) > -m;
    },
    get riverAreaKeys() { return getRiver()?.keys ?? new Set<string>(); },
    riverSpans: () => {
      const spans: [number, number][] = bridges.map(b => [b.from - 30, b.to + 30]);
      spans.push(...(getRiver()?.spans ?? []));
      spans.sort((a, b) => a[0] - b[0]);
      const out: [number, number][] = [];
      for (const sp of spans) { const l = out[out.length - 1]; if (l && sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]); else out.push([sp[0], sp[1]]); }
      return out;
    },
    riverLatRange: () => getRiver()?.lat ?? null,
    structureAt: (s, m = 0) => structs.find(t => s >= t.from - m && s <= t.to + m),
    riverAt: (s) => {
      for (const b of bridges) {
        const c = (b.from + b.to) / 2, half = (b.to - b.from) / 2;
        if (Math.abs(s - c) < half * .7) return -3.6;
      }
      return null;
    },
    low: (s, m = .3) => follow ? riverDip(s) > m : groundY(s) < -m,
    isCity: (s) => route.scenery.cityZones.some(z => s > z.from && s < z.to),
    nearCrossing: (s, m = 4) => crossings.some(c => Math.abs(s - c.s) < (c.roadWidth ?? 6) / 2 + m),
    // 2面4線駅は分岐器を含む待避線区間全体
    nearStation: (s, m = 0) => route.stations.some(st => {
      const z = loopZone(st);
      return s > Math.min(st.platform.from, z?.inFrom ?? Infinity) - m && s < Math.max(st.platform.to, z?.outTo ?? -Infinity) + m;
    }),
    curvature: (s) => {
      const a = track.trackAt(s - 2).phi, b = track.trackAt(s + 2).phi;
      return (b - a) / 4;
    },
  };
}

/**
 * 線路に沿った格子メッシュ。cols(s) は [横位置, 絶対標高] の列（行ごとに同数）
 * color(s, j) で頂点色を与える
 */
export function gridAlong(track: Track, s0: number, s1: number, step: number, cols: (s: number) => [number, number][],
  mat: THREE.Material, color?: (s: number, j: number, out: THREE.Color) => void): THREE.Mesh {
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  let m = 0;
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const s = Math.min(s0 + i * step, s1), t = track.trackAt(s), row = cols(s);
    m = row.length;
    row.forEach(([l, y], j) => {
      pos.push(t.x + t.rx * l, y, t.z + t.rz * l);
      if (color) { color(s, j, c); col.push(c.r, c.g, c.b); }
    });
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + 1, cc = a + m, d = cc + 1; idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // 線路の進行方向に対して表裏が逆になる場合があるので法線を上向きへそろえる
  const nr = g.attributes.normal as THREE.BufferAttribute;
  let up = 0; for (let i = 0; i < nr.count; i++) up += nr.getY(i);
  if (up < 0) { g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
  return new THREE.Mesh(g, mat);
}

/**
 * 川の水面。cols(s) の地面の高さが水面 level より低い所のある格子だけに平らな面を置く。
 * 地面が水面より高い所は地面が面を隠すので、岸の線は地面の形（溝）で決まる
 */
export function waterAlong(track: Track, s0: number, s1: number, step: number, cols: (s: number) => [number, number][],
  level: number, mat: THREE.Material): THREE.Mesh | null {
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const rows: { x: number; z: number; r: [number, number][] }[] = [];
  for (let i = 0; i < n; i++) { const s = Math.min(s0 + i * step, s1), t = track.trackAt(s); rows.push({ x: t.x, z: t.z, r: cols(s) }); }
  const m = rows[0].r.length, pos: number[] = [], idx: number[] = [];
  const rxz = (i: number) => { const t = track.trackAt(Math.min(s0 + i * step, s1)); return [t.rx, t.rz]; };
  for (let i = 0; i < n - 1; i++) {
    const [rx0, rz0] = rxz(i), [rx1, rz1] = rxz(i + 1);
    for (let j = 1; j < m - 2; j++) { // 両端の列（遠方の縁）は水にしない
      const lo = Math.min(rows[i].r[j][1], rows[i].r[j + 1][1], rows[i + 1].r[j][1], rows[i + 1].r[j + 1][1]);
      if (lo >= level) continue;
      const A = rows[i], B = rows[i + 1], k = pos.length / 3;
      pos.push(A.x + rx0 * A.r[j][0], level, A.z + rz0 * A.r[j][0], A.x + rx0 * A.r[j + 1][0], level, A.z + rz0 * A.r[j + 1][0],
        B.x + rx1 * B.r[j][0], level, B.z + rz1 * B.r[j][0], B.x + rx1 * B.r[j + 1][0], level, B.z + rz1 * B.r[j + 1][0]);
      // 頂点 k = (i, j), k+1 = (i, j+1), k+2 = (i+1, j), k+3 = (i+1, j+1)。上向きの面にそろえる
      const ux = pos[(k + 2) * 3] - pos[k * 3], uz = pos[(k + 2) * 3 + 2] - pos[k * 3 + 2], vx = pos[(k + 1) * 3] - pos[k * 3], vz = pos[(k + 1) * 3 + 2] - pos[k * 3 + 2];
      if (uz * vx - ux * vz >= 0) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// 0..1 の簡易ハッシュ
export const hash = (x: number, y = 0) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };

/** 地面・盛土・山を生成 */
export function buildTerrain(ctx: GameContext): Terrain {
  const T = getTerrain(ctx), { track, route, scene } = ctx;
  if (route.theme === 'mountain') { buildMountainTerrain(ctx, T as MountainTerrain); return T; }
  const S0 = route.extent.from - 400, S1 = route.extent.to + 400;
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  groundMat.name = 'ground';
  // 地面の外縁（線路から遠い端）の高さ。groundFollowsTrack のコースは地面の高さに沿って 9m 下げる（標高が負の所でも遠方の地面より上）
  const follow = !!route.groundFollowsTrack;
  const edgeY = (y: number) => follow ? y - 9 : Math.min(y, 0) - 9;
  // 地面リボン（曲線内側は折り返さないよう幅を制限）
  const LAT = [-1404, -1000, -700, -500, -350, -220, -90, -30, -6, 0, 4, 10, 34, 94, 224, 350, 500, 700, 1000, 1404];
  const cols = (s: number): [number, number][] => {
    const y = T.groundY(s), k = T.curvature(s), R = Math.abs(k) > 1e-5 ? 1 / Math.abs(k) : 1e9;
    return LAT.map((l, j) => {
      const inside = (k > 0 && l > 0) || (k < 0 && l < 0);
      const ll = inside ? Math.sign(l) * Math.min(Math.abs(l), R * .85) : l;
      const rel = T.reliefY(s, l);
      return [ll, (j === 0 || j === LAT.length - 1 ? edgeY(y) : y - .02) + rel];
    });
  };
  // 大都市（route.urban）は舗装・空き地の灰色がちの地面
  const gc = new THREE.Color(route.urban ? 0x9a9a8e : 0x7fa05a), dirt = new THREE.Color(0x9a9270), forestC = new THREE.Color(0x48663a);
  // OSM の沿線データで街並みを作るコース（海沿いの市街地）は、線路から約 500m まで町の地面の色（舗装・空き地）
  const town = !route.urban && !!osmSceneryFor(route), townC = new THREE.Color(0x9a9886);
  // 川（橋の範囲と OSM の水面）がある s の範囲は、溝の形を出せるよう細かい格子で作る（lat 4m・s 5m）。ほかは従来の格子
  const spans = T.riverSpans().filter(sp => sp[1] > S0 && sp[0] < S1);
  const denseLat = (() => {
    const [r0, r1] = T.riverLatRange() ?? [-340, 340], set = new Set<number>([-1400, -1000, 1000, 1404]);
    for (let l = Math.min(-340, r0 - 20); l < -340; l += 20) set.add(l);
    for (let l = -340; l <= 340; l += 4) set.add(l);
    for (let l = 340; l <= Math.max(340, r1 + 20); l += 20) set.add(l);
    return [...set].sort((a, b) => a - b);
  })();
  const mud = new THREE.Color(0x6f6a55);
  const denseCols = (rowDip: number[]) => (s: number): [number, number][] => {
    const k = T.curvature(s), R = Math.abs(k) > 1e-5 ? 1 / Math.abs(k) : 1e9;
    rowDip.length = 0;
    return denseLat.map((l, j) => {
      const inside = (k > 0 && l > 0) || (k < 0 && l < 0);
      const ll = inside ? Math.sign(l) * Math.min(Math.abs(l), R * .85) : l;
      const edge = j === 0 || j === denseLat.length - 1;
      // 溝は線路方向の位置と同じ横位置（曲線の内側で寄せた位置）で測る
      const y = edge ? T.dryY(s) : T.terrainY(s, ll);
      rowDip.push(edge ? 0 : T.dryY(s) - y);
      return [ll, edge ? edgeY(T.dryY(s)) : y - .02];
    });
  };
  const river = new THREE.MeshPhongMaterial({ color: 0x3c6577, shininess: 90, specular: 0x8899aa });
  /** 区間 [a, b] を、川の範囲の内側（細かい格子）と外側（従来の格子）に分けて作る */
  const buildGround = (a: number, b: number) => {
    const pieces: [number, number, boolean, number][] = [];
    let at = a;
    for (const [x0, x1] of spans) {
      if (x1 <= at || x0 >= b) continue;
      if (x0 > at) pieces.push([at, x0, false, RIVER_WATER]);
      // 水面の高さ: 地面が線路の高さに沿うコースは、川の範囲の中央の地面（橋の前後の地面）より 3.6m 低い。川は1本の平らな水面にするので、区間を分けても同じ高さ
      pieces.push([Math.max(at, x0), Math.min(b, x1), true, follow ? T.dryY((x0 + x1) / 2) + RIVER_WATER : RIVER_WATER]); at = Math.min(b, x1);
    }
    if (at < b) pieces.push([at, b, false, RIVER_WATER]);
    for (const [p0, p1, dense, waterY] of pieces) {
      if (p1 - p0 < .5) continue;
      if (!dense) {
        const g = gridAlong(track, p0, p1, 10, cols, groundMat, (q, j, out) => {
          const h = hash(Math.floor(q / 30), j);
          const l = LAT[j], rel = T.reliefY(q, l);
          out.copy(town && Math.abs(l) <= 500 ? townC : gc).multiplyScalar(.85 + h * .22);
          if (Math.abs(l) <= 10) out.lerp(dirt, .35); // 線路際は土っぽく
          if (rel > 4) out.lerp(forestC, Math.min(.65, rel / 60)); // 山は濃い緑
        });
        g.name = 'ground'; scene.add(g);
        continue;
      }
      const dip: number[] = [], rows = denseCols(dip);
      const g = gridAlong(track, p0, p1, 5, rows, groundMat, (q, j, out) => {
        const h = hash(Math.floor(q / 30), j), l = denseLat[j];
        out.copy(town && j >= 1 && j <= denseLat.length - 2 ? townC : gc).multiplyScalar(.85 + h * .22);
        if (l >= -6 && l <= 10) out.lerp(dirt, .35);
        out.lerp(mud, Math.min(1, dip[j] / 3) * .85); // 岸の斜面は土の色
      });
      g.name = 'ground'; scene.add(g);
      const w = waterAlong(track, p0, p1, 5, denseCols([]), waterY, river);
      if (w) { w.name = 'river'; w.userData.noShadow = true; scene.add(w); }
    }
  };
  for (let s = S0; s < S1; s += 1000) buildGround(s, Math.min(S1, s + 1000));
  // 遠方の地面
  const base = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: route.urban ? 0x8f9286 : 0x7a9a58 }));
  const mid = track.at((S0 + S1) / 2, 0, 0);
  let farY = -9;
  if (follow) for (let s = S0; s <= S1; s += 50) farY = Math.min(farY, T.dryY(s) - 12); // 遠方の地面は一番低い地面より下
  base.rotation.x = -Math.PI / 2; base.position.set(mid.x, farY, mid.z); base.name = 'ground-far'; scene.add(base);

  // 盛土（線路が地面より高く、構造物でない区間）。bank 指定の追加の線路（みさき公園の番線・多奈川線）は、
  // 本線と並ぶ（11m 以内）間は同じ盛土を線路の外まで広げ、本線から離れる区間はその線路だけの盛土を作る
  const embMat = new THREE.MeshLambertMaterial({ color: 0x748f4e, side: THREE.DoubleSide });
  const bankX = (route.extraTracks ?? []).filter(x => x.bank);
  const T0 = Math.min(...route.tracks), T1 = Math.max(...route.tracks);
  const bankSpan = (q: number): [number, number] => {
    let lo = T0, hi = T1;
    if (bankX.length) {
      const lats = bankX.filter(x => q >= x.from - 1 && q <= x.to + 1).map(x => profileLat(x.lat, q)).sort((a, b) => a - b);
      for (const l of lats) if (l > hi && l - hi < 11) hi = l;
      for (let i = lats.length - 1; i >= 0; i--) if (lats[i] < lo && lo - lats[i] < 11) lo = lats[i];
    }
    return [lo, hi];
  };
  /** 盛土が要る区間（s0〜s1 のうち test を満たす所）に、横断が ribbon(s) = [左, 右]（線路中心）の盛土を作る */
  const embank = (s0: number, s1: number, test: (q: number) => boolean, ribbon: (q: number) => [number, number]) => {
    let runStart: number | null = null;
    const flush = (a: number, b: number) => {
      if (b - a < 4) return;
      scene.add(gridAlong(track, a, b, 5, (q) => {
        const y = T.trackY(q), g = T.groundY(q), dh = Math.max(0, y - g), [lo, hi] = ribbon(q);
        return [[lo - 2.5 - 1.6 * dh - .5, g - .05], [lo - 2.5, y - .02], [hi + 2.5, y - .02], [hi + 2.5 + 1.6 * dh + .5, g - .05]];
      }, embMat));
    };
    for (let q = s0; q <= s1; q += 5) {
      const need = T.trackY(q) - T.groundY(q) > .08 && !T.structureAt(q, -2) && test(q);
      if (need && runStart == null) runStart = q - 5;
      if (!need && runStart != null) { flush(runStart, q); runStart = null; }
    }
    if (runStart != null) flush(runStart, s1);
  };
  embank(S0, S1, () => true, bankSpan);
  for (const x of bankX) {
    const lat = (q: number) => profileLat(x.lat, q);
    embank(Math.max(S0, x.from), Math.min(S1, x.to), q => { const [lo, hi] = bankSpan(q), l = lat(q); return l < lo - .01 || l > hi + .01; }, q => [lat(q), lat(q)]);
  }

  // トンネル上の山
  const hillMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const forest = new THREE.Color(0x4f7040);
  for (const t of route.structures ?? []) {
    if (t.kind !== 'tunnel') continue;
    const hl: number[] = []; for (let l = -150; l <= 154; l += 8) hl.push(l + TUNNEL_CENTER - 2);
    scene.add(gridAlong(track, t.from, t.to, 8, (s) => hl.map(l => [l, T.terrainY(s, l)] as [number, number]), hillMat,
      (s, j, out) => out.copy(forest).multiplyScalar(.8 + hash(Math.floor(s / 16), j) * .35)));
  }
  return T;
}
