// 開発時のみ（コンソールから import して使う）。構造物メッシュが走行線の建築限界に入っていないかを機械的に調べる。
//   const m = await import('/src/debug/clearance.ts'); m.checkClearance(__densha)
// 走行線 = route.tracks（島式駅の S字込み）・2面4線の待避線（自線側・対向側）・単線の右の線と副線・海浜公園の第3線。
// 建築限界（線路中心から・レール面基準の高さ）: 0.05〜0.4m は 1.25m、0.4〜1.15m は 1.55m（ホーム端 1.6m を許す）、1.15〜4.5m は 1.9m。
// 三角形を約 0.4m 間隔で標本化して判定する。列車・地面・電線・空は対象外。BatchedMesh は個体のバウンディングボックス表面で判定。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { trackLines } from '../route/service';
import { loopTracks } from '../world/track-mesh';
import { coastalThirdTracks } from '../world/coastal-stations';

const RAIL = .38;
const SKIP = /^(playerTrain|oncoming-|overtake-|cab3d|ground|ground-far|ground-grid|backdrop|coastal-sea|coastal-distant-hills|river|catenary-wire)/;

interface Line { id: string; from: number; to: number; lat(s: number): number }

export function runningLines(ctx: GameContext): Line[] {
  const { route } = ctx, out: Line[] = [];
  trackLines(route).forEach((l, i) => out.push({ id: `${l.kind}${i}`, from: l.from, to: l.to, lat: l.lat }));
  for (const o of loopTracks(ctx)) out.push({ id: `loop-${route.stations[o.z.index].name}-${o.base}`, from: o.z.inFrom, to: o.z.outTo, lat: o.lat });
  // 描画と共通の海浜公園第3線。
  for (const sta of route.stations) {
    coastalThirdTracks(route, sta).forEach((third, k) => out.push({ id: `third-${sta.name}-${k}`, from: third.from, to: third.to, lat: third.lat }));
  }
  return out;
}

const halfWidth = (hr: number) => hr < .05 ? 0 : hr < .4 ? 1.25 : hr < 1.15 ? 1.55 : hr <= 4.5 ? 1.9 : 0;

export interface Hit { obj: string; color: string; line: string; s0: number; s1: number; minD: number; h0: number; h1: number; n: number }

export async function checkClearance(ctx: GameContext, opt: { step?: number; filter?: RegExp; max?: number; progress?: (done: number, total: number) => void; log?: (m: string) => void } = {}): Promise<{ hits: Hit[]; tris: number; points: number; ms: number; slow: string[] }> {
  const t0 = performance.now();
  const { track, route, scene } = ctx, step = opt.step ?? .4;
  const S0 = route.extent.from - 30, S1 = route.extent.to + 30;
  // 中心線の標本と空間ハッシュ（20m セル）
  const DS = 1, CELL = 20, n = Math.ceil((S1 - S0) / DS) + 1;
  const xs = new Float64Array(n), zs = new Float64Array(n);
  const hash = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const p = track.trackAt(S0 + i * DS); xs[i] = p.x; zs[i] = p.z;
    const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    let a = hash.get(k); if (!a) hash.set(k, a = []); a.push(i);
  }
  const nearestS = (x: number, z: number): number | null => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = -1, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = hash.get(`${cx + dx},${cz + dz}`); if (!a) continue;
      for (const i of a) { const d = (xs[i] - x) ** 2 + (zs[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) return null;
    // 接線方向へ射影して補正
    const s = S0 + best * DS, p = track.trackAt(s), tx = Math.sin(p.phi), tz = -Math.cos(p.phi);
    return s + (x - p.x) * tx + (z - p.z) * tz;
  };
  const lines = runningLines(ctx);
  const groups = new Map<string, Hit>();
  let tris = 0, points = 0;
  const test = (x: number, y: number, z: number, sHint: number | null, key: string, color: string) => {
    points++;
    const s = sHint ?? nearestS(x, z);
    if (s == null || s < route.extent.from || s > route.extent.to) return;
    const p = track.trackAt(s), lat = (x - p.x) * p.rx + (z - p.z) * p.rz, hr = y - p.y - RAIL;
    const hw = halfWidth(hr);
    if (!hw) return;
    for (const L of lines) {
      if (s < L.from || s > L.to) continue;
      const d = Math.abs(lat - L.lat(s));
      if (d >= hw) continue;
      const gk = `${key}|${color}|${L.id}|${Math.round(s / 25)}`;
      const g = groups.get(gk);
      if (!g) groups.set(gk, { obj: key, color, line: L.id, s0: s, s1: s, minD: d, h0: hr, h1: hr, n: 1 });
      else { g.s0 = Math.min(g.s0, s); g.s1 = Math.max(g.s1, s); g.minD = Math.min(g.minD, d); g.h0 = Math.min(g.h0, hr); g.h1 = Math.max(g.h1, hr); g.n++; }
    }
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  /** 三角形（辺 12m 以下）を判定。頂点の s・横位置・高さの範囲がどの走行線の建築限界にも届かなければ省く */
  const small = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, L: number, key: string, color: string) => {
    const gx = (A.x + B.x + C.x) / 3, gz = (A.z + B.z + C.z) / 3;
    const sc = nearestS(gx, gz);
    if (sc == null) return;
    const p = track.trackAt(sc), tx = Math.sin(p.phi), tz = -Math.cos(p.phi);
    let sMin = Infinity, sMax = -Infinity, lMin = Infinity, lMax = -Infinity, hMin = Infinity, hMax = -Infinity;
    for (const v of [A, B, C]) {
      const s = sc + (v.x - gx) * tx + (v.z - gz) * tz, l = (v.x - p.x) * p.rx + (v.z - p.z) * p.rz, h = v.y - p.y - RAIL;
      sMin = Math.min(sMin, s); sMax = Math.max(sMax, s); lMin = Math.min(lMin, l); lMax = Math.max(lMax, l); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    }
    if (hMax < -.3 || hMin > 4.9) return;
    const pad = .2 + 1.9;
    let near = false;
    for (const Ln of lines) {
      if (sMax < Ln.from || sMin > Ln.to) continue;
      for (let s = Math.max(sMin, Ln.from); ; s += 2) {
        const qq = Math.min(s, sMax, Ln.to), l = Ln.lat(qq);
        if (l > lMin - pad && l < lMax + pad) { near = true; break; }
        if (qq >= Math.min(sMax, Ln.to)) break;
      }
      if (near) break;
    }
    if (!near) return;
    const k = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
      const u = i / k, v = j / k, w = 1 - u - v;
      q.set(A.x * w + B.x * u + C.x * v, A.y * w + B.y * u + C.y * v, A.z * w + B.z * u + C.z * v);
      test(q.x, q.y, q.z, sc + (q.x - gx) * tx + (q.z - gz) * tz, key, color);
    }
  };
  /** 大きい三角形は4分割して small へ。線路から十分遠い部分はハッシュで省く */
  const split = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, key: string, color: string) => {
    const L = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A));
    if (L <= 12) { small(A, B, C, L, key, color); return; }
    // 外接の大きさより十分遠ければ省く（ハッシュは約 20m 以内しか返さないので重心と各頂点で確かめる）
    if (L < 40 && [A, B, C].every(v => nearestS(v.x, v.z) == null) && nearestS((A.x + B.x + C.x) / 3, (A.z + B.z + C.z) / 3) == null) return;
    const ab = A.clone().add(B).multiplyScalar(.5), bc = B.clone().add(C).multiplyScalar(.5), ca = C.clone().add(A).multiplyScalar(.5);
    split(A, ab, ca, key, color); split(ab, B, bc, key, color); split(ca, bc, C, key, color); split(ab, bc, ca, key, color);
  };
  const sampleTri = (key: string, color: string) => { tris++; split(a.clone(), b.clone(), c.clone(), key, color); };
  const pathOf = (o: THREE.Object3D) => { const n: string[] = []; for (let p: THREE.Object3D | null = o; p && p !== scene; p = p.parent) if (p.name) n.push(p.name); return n.reverse().join('/') || o.type; };
  const hex = (r: number, g: number, bl: number) => '#' + [r, g, bl].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const m4 = new THREE.Matrix4(), mi = new THREE.Matrix4();
  scene.updateMatrixWorld(true);
  const objs: THREE.Object3D[] = [], slow: string[] = [];
  scene.traverse(o => objs.push(o));
  let last = performance.now();
  for (let oi = 0; oi < objs.length; oi++) {
    if (performance.now() - last > 40) { opt.progress?.(oi, objs.length); await new Promise(r => setTimeout(r, 0)); last = performance.now(); }
    const tv = performance.now(), p0 = points;
    visit(objs[oi]);
    const dt = performance.now() - tv;
    if (dt > 200) opt.log?.(`slow ${Math.round(dt)}ms ${pathOf(objs[oi])}`), slow.push(`${Math.round(dt)}ms ${points - p0}pt ${pathOf(objs[oi])} ${objs[oi].type}`);
  }
  function visit(o: THREE.Object3D): void {
    // 車止めは線路終端を塞ぐために設置する物。一般構造物の干渉とは区別する。
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (SKIP.test(p.name) || p.userData.clearanceExempt === 'rail-stop') return;
    const path = pathOf(o);
    if (opt.filter && !opt.filter.test(path)) return;
    if ((o as THREE.BatchedMesh).isBatchedMesh) {
      const bm = o as THREE.BatchedMesh, box = new THREE.Box3(), info = (bm as any)._instanceInfo as { active: boolean; visible: boolean }[] | undefined;
      const count = info ? info.length : 0;
      for (let i = 0; i < count; i++) {
        if (!info![i].active) continue;
        const gid = bm.getGeometryIdAt(i); bm.getMatrixAt(i, m4); m4.premultiply(bm.matrixWorld);
        bm.getBoundingBoxAt(gid, box);
        // ボックス表面（側面と上面）の格子点
        const nx = 6, nz = 6, ny = 6;
        for (let ix = 0; ix <= nx; ix++) for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) {
          if (ix % nx && iy % ny && iz % nz) continue;
          q.set(box.min.x + (box.max.x - box.min.x) * ix / nx, box.min.y + (box.max.y - box.min.y) * iy / ny, box.min.z + (box.max.z - box.min.z) * iz / nz).applyMatrix4(m4);
          test(q.x, q.y, q.z, null, path + `#batched${i}`, 'bbox');
        }
      }
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const g = mesh.geometry, pos = g.attributes.position, col = g.attributes.color, idx = g.index;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const nInst = inst ? inst.count : 1;
    const triN = idx ? idx.count / 3 : pos.count / 3;
    for (let ii = 0; ii < nInst; ii++) {
      if (inst) { inst.getMatrixAt(ii, mi); m4.multiplyMatrices(mesh.matrixWorld, mi); } else m4.copy(mesh.matrixWorld);
      for (let t = 0; t < triN; t++) {
        const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos as THREE.BufferAttribute, ia).applyMatrix4(m4);
        b.fromBufferAttribute(pos as THREE.BufferAttribute, ib).applyMatrix4(m4);
        c.fromBufferAttribute(pos as THREE.BufferAttribute, ic).applyMatrix4(m4);
        const color = col ? hex(col.getX(ia), col.getY(ia), col.getZ(ia)) : '#' + (((mesh.material as THREE.MeshLambertMaterial)?.color?.getHex?.() ?? 0).toString(16).padStart(6, '0'));
        sampleTri(path + (inst ? '#inst' : ''), color);
      }
    }
  }
  const hits = [...groups.values()].sort((p, r) => p.s0 - r.s0).map(h => ({ ...h, s0: Math.round(h.s0), s1: Math.round(h.s1), minD: +h.minD.toFixed(2), h0: +h.h0.toFixed(2), h1: +h.h1.toFixed(2) }));
  return { hits: hits.slice(0, opt.max ?? Infinity), tris, points, ms: Math.round(performance.now() - t0), slow };
}
