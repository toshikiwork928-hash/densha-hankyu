// 海の水面・砂浜・護岸・防波堤（OSM の海岸線 natural=coastline など。data は osm-town.ts の osmFor で走るコースの座標に写したもの）。
// 水面は海岸線の多角形の形に張る（従来の「線路から一定距離の帯」は使わない）。色・材質は従来の海（scenery.ts の coastal-sea）と同じ。
// 防波堤・桟橋は OSM に登録されているものだけ。実在の確認・高さ・形は不明（概形）。乱数は使わない。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { osmCoastFor } from './osm-town';
import { getTerrain } from './terrain';

/** 水面の高さ（地面 0 の上。道路 .09〜.13・公園 .05 より上、橋・桟橋より下） */
const SEA_Y = .085;
const BEACH_Y = .045;
const SEA_COLOR = 0x86a7b1;
const smooth01 = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

type SL = [number, number];

export function buildCoast(ctx: GameContext): void {
  const coast = osmCoastFor(ctx.route);
  if (!coast || !coast.sea.length) return;
  const { track, route } = ctx, T = getTerrain(ctx);
  const clampS = (s: number) => Math.max(route.extent.from, Math.min(route.extent.to, s));
  const center = (L0 => (L0 + Math.max(...route.tracks)) / 2)(Math.min(...route.tracks));

  // 線路から遠い所（曲線の内側で折り返す）は、±600m でならした基準線から測る（scenery.ts の遠景の山と同じ考え方）
  const smoothCache = new Map<number, { x: number; z: number; rx: number; rz: number }>();
  const smoothed = (s: number) => {
    const k = Math.round(s / 60);
    let v = smoothCache.get(k);
    if (!v) {
      let x = 0, z = 0, rx = 0, rz = 0;
      for (let j = -10; j <= 10; j++) { const t = track.trackAt((k + j) * 60); x += t.x; z += t.z; rx += t.rx; rz += t.rz; }
      const l = Math.hypot(rx, rz) || 1;
      v = { x: x / 21, z: z / 21, rx: rx / l, rz: rz / l }; smoothCache.set(k, v);
    }
    return v;
  };
  /** (s, lat) → 世界の (x, z)。線路から 800m までは線路そのもの、1800m より遠くはならした基準線 */
  const world = (s: number, lat: number): [number, number] => {
    const t = track.trackAt(s), w = smooth01((Math.abs(lat - center) - 800) / 1000);
    const ex = t.x + t.rx * lat, ez = t.z + t.rz * lat;
    if (w <= 0) return [ex, ez];
    const q = smoothed(s), sx = q.x + q.rx * lat, sz = q.z + q.rz * lat;
    return [ex + (sx - ex) * w, ez + (sz - ez) * w];
  };

  // ---------------- 水面 ----------------
  const seaPos: number[] = [], seaIdx: number[] = [];
  /** 辺を細かく分ける（線路の曲がりに沿わせる。遠い辺は粗く） */
  const dens = (f: number[]): SL[] => {
    const out: SL[] = [];
    for (let i = 0; i < f.length; i += 2) {
      const a: SL = [f[i], f[i + 1]], b: SL = [f[(i + 2) % f.length], f[(i + 3) % f.length]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), far = Math.min(Math.abs(a[1] - center), Math.abs(b[1] - center)) > 800;
      const n = Math.max(1, Math.ceil(len / (far ? 150 : 30)));
      for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    return out;
  };
  for (const rings of coast.sea) {
    const outer = dens(rings[0]), holes = rings.slice(1).map(dens).filter(h => h.length >= 3);
    const all = [...outer, ...holes.flat()];
    const tri = THREE.ShapeUtils.triangulateShape(outer.map(p => new THREE.Vector2(p[0], p[1])), holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1]))));
    const base = seaPos.length / 3;
    for (const [s, l] of all) { const [x, z] = world(s, l); seaPos.push(x, SEA_Y, z); }
    for (const [a, b, c] of tri) seaIdx.push(base + a, base + b, base + c);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(seaPos, 3));
  geom.setIndex(seaIdx); geom.computeVertexNormals();
  const sea = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: SEA_COLOR, side: THREE.DoubleSide }));
  sea.name = 'coastal-sea'; sea.userData.noShadow = true; ctx.scene.add(sea);

  // ---------------- 砂浜（OSM の natural=beach。水面の下に入る部分は水面が隠す） ----------------
  const beachPos: number[] = [];
  for (const f of coast.beach) {
    const pts: SL[] = [];
    for (let i = 0; i < f.length; i += 2) {
      const a: SL = [f[i], f[i + 1]], b: SL = [f[(i + 2) % f.length], f[(i + 3) % f.length]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 20));
      for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    if (pts.length < 3) continue;
    const tri = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
    const V = pts.map(([s, l]) => { const [x, z] = world(s, l); return [x, T.dryY(clampS(s)) + BEACH_Y, z]; });
    for (const [a, b, c] of tri) beachPos.push(...V[a], ...V[b], ...V[c]);
  }
  if (beachPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(beachPos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xd8cba5, side: THREE.DoubleSide }));
    m.name = 'coastal-sea-beach'; m.userData.noShadow = true; ctx.scene.add(m);
  }

  // ---------------- 護岸・防波堤・桟橋（断面を線に沿って押し出す） ----------------
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c3 = new THREE.Color();
  /** 折れ線 pts（s,lat）に、断面 profile（法線方向の位置 o・高さ y・色。法線 = 進行方向の右 = (dl,-ds)）を押し出す。y は水面からの絶対値（ground = 地面基準） */
  const extrude = (pts: SL[], profile: { o: number; y: number; ground?: boolean; c: number }[]) => {
    if (pts.length < 2) return;
    const base = pos.length / 3;
    pts.forEach(([s, l], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], ds = b[0] - a[0], dl = b[1] - a[1], L = Math.hypot(ds, dl) || 1;
      const ns = dl / L, nl = -ds / L;
      for (const p of profile) {
        const [x, z] = world(s + ns * p.o, l + nl * p.o);
        pos.push(x, (p.ground ? T.dryY(clampS(s)) : 0) + p.y, z);
        c3.setHex(p.c); col.push(c3.r, c3.g, c3.b);
      }
    });
    const m = profile.length;
    for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k + 1 < m; k++) {
      const a = base + i * m + k, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  /** 折れ線を細かく（step m ごと） */
  const dline = (f: number[], step: number): SL[] => {
    const out: SL[] = [];
    for (let i = 0; i + 3 < f.length; i += 2) {
      const n = Math.max(1, Math.ceil(Math.hypot(f[i + 2] - f[i], f[i + 3] - f[i + 1]) / step));
      for (let k = 0; k < n; k++) out.push([f[i] + (f[i + 2] - f[i]) * k / n, f[i + 1] + (f[i + 3] - f[i + 1]) * k / n]);
    }
    out.push([f[f.length - 2], f[f.length - 1]]);
    return out;
  };
  const beachBox = coast.beach.map(f => {
    let s0 = Infinity, s1 = -Infinity, l0 = Infinity, l1 = -Infinity;
    for (let i = 0; i < f.length; i += 2) { s0 = Math.min(s0, f[i]); s1 = Math.max(s1, f[i]); l0 = Math.min(l0, f[i + 1]); l1 = Math.max(l1, f[i + 1]); }
    return { s0: s0 - 30, s1: s1 + 30, l0: l0 - 30, l1: l1 + 30 };
  });
  const nearBeach = (s: number, l: number) => beachBox.some(b => s >= b.s0 && s <= b.s1 && l >= b.l0 && l <= b.l1);
  // 護岸: 海岸線の陸側にコンクリートの帯（砂浜のそばは付けない。線路から 1600m より遠い所は見えないので省く）
  const WALL = [{ o: -.2, y: SEA_Y, c: 0x8e8b82 }, { o: -.2, y: .8, c: 0xa19e95 }, { o: 2.4, y: .8, c: 0xb8b5aa }, { o: 3.6, y: .02, ground: true, c: 0x8d8a80 }];
  for (const ln of coast.lines) {
    let cur: SL[] = [];
    const flush = () => { if (cur.length > 1) extrude(cur, WALL); cur = []; };
    for (const p of dline(ln, 12)) {
      if (Math.abs(p[1] - center) > 1600 || nearBeach(p[0], p[1]) || p[0] < route.extent.from - 300 || p[0] > route.extent.to + 300) { flush(); continue; }
      cur.push(p);
    }
    flush();
  }
  // 防波堤・桟橋（OSM にあるもの）。線は断面を押し出し、輪は上面と側面
  const BREAK_H = 1.7, PIER_H = 1.3;
  for (const [kind, closed, f] of coast.works) {
    const h = kind === 'p' ? PIER_H : BREAK_H, top = kind === 'p' ? 0xb4b2aa : 0xa7a9a4, side = kind === 'p' ? 0x8f8d86 : 0x8a8c88;
    if (f.length < 4) continue;
    let near = false;
    for (let i = 0; i < f.length; i += 2) if (Math.abs(f[i + 1] - center) < 1600 && f[i] > route.extent.from - 300 && f[i] < route.extent.to + 300) { near = true; break; }
    if (!near) continue;
    if (closed) {
      const pts: SL[] = [];
      for (let i = 0; i < f.length; i += 2) pts.push([f[i], f[i + 1]]);
      const tri = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
      const base = pos.length / 3;
      for (const [s, l] of pts) { const [x, z] = world(s, l); pos.push(x, h, z); c3.setHex(top); col.push(c3.r, c3.g, c3.b); }
      for (const [a, b, c] of tri) idx.push(base + a, base + b, base + c);
      for (let i = 0; i < pts.length; i++) {
        const q = pts[(i + 1) % pts.length], p = pts[i], [x0, z0] = world(p[0], p[1]), [x1, z1] = world(q[0], q[1]), b0 = pos.length / 3;
        pos.push(x0, h, z0, x1, h, z1, x0, SEA_Y, z0, x1, SEA_Y, z1);
        c3.setHex(side); for (let k = 0; k < 4; k++) col.push(c3.r, c3.g, c3.b);
        idx.push(b0, b0 + 2, b0 + 1, b0 + 1, b0 + 2, b0 + 3);
      }
    } else if (kind === 'p') {
      extrude(dline(f, 15), [{ o: -2, y: SEA_Y, c: side }, { o: -2, y: h, c: side }, { o: 2, y: h, c: top }, { o: 2, y: SEA_Y, c: side }]);
    } else {
      extrude(dline(f, 15), [{ o: -6, y: SEA_Y, c: side }, { o: -2.2, y: h, c: top }, { o: 2.2, y: h, c: top }, { o: 6, y: SEA_Y, c: side }]);
    }
  }
  if (idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.name = 'coastal-sea-works'; ctx.scene.add(m);
  }
  if (import.meta.env?.DEV) console.info(`海岸線: 水面 ${seaIdx.length / 3} 三角形、砂浜 ${beachPos.length / 9}、護岸・防波堤 ${idx.length / 3}`);
}
