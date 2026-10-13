// OpenStreetMap（Overpass API）から線路の両側 約300m の建物・道路・緑地・川・主要施設を取り、
// コースの座標（線路に沿った距離 s・横位置 lat）へ写して、簡略化した小さなデータを src/data/osm/<course>.json に書く。
//
// 実行: npm run osm:scenery -- --course=namba        （取得 → 変換）
//       npm run osm:scenery -- --course=namba --offline （取得済みのキャッシュから変換だけ）
// 生データは node_modules/.cache/osm/ に置く（コミットしない）。出典: © OpenStreetMap contributors（ODbL）
//
// 座標の写し方: コースの線形は、OSM の線路形状を駅間ごとに営業キロへ伸縮して作ってある（src/route/routes/namba.ts の冒頭）。
// ここでも同じく、OSM の線路の中心線に沿った距離を、駅の中心どうしの間で線形に伸縮してゲームの s にする。
// 横位置は中心線からの符号付き距離（進行方向の右が正）に、ゲーム側の本線群の中心の横位置を足す。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { namba } from '../src/route/routes/namba';
import { shiokaze } from '../src/route/routes/shiokaze';
import { kishiwada } from '../src/route/routes/kishiwada';
import { izumisano } from '../src/route/routes/izumisano';
import { izumisanoMisaki } from '../src/route/routes/izumisano-misaki';
import { misakiWakayamako } from '../src/route/routes/misaki-wakayamako';
import { hankyuKobeEast, hankyuKobeWest } from '../src/route/routes/hankyu-kobe';
import { profileLat } from '../src/route/service';
import type { Route } from '../src/route/types';

interface Course {
  route: Route;
  /** 南（または起点側）・西・北・東 */
  bbox: [number, number, number, number];
  /** 線路の OSM の name に含まれる語 */
  railName: string;
  /** ゲームの駅順の OSM の駅名（別名は | 区切り） */
  stations: string[];
  /** 本線群の横位置（ゲーム側）を作る追加の線路の id */
  mainExtras: string[];
  /** 曲がりの大きい区間: 中心線を2回に分けて作る（駅どうしの直線から離れた線路の点も拾う）。route-geometry.ts と同じ方法 */
  twoPass?: boolean;
  /** 海岸線（natural=coastline）・砂浜・防波堤・桟橋も取り、海の多角形（data.coast）を作る。右側（進行方向）が海のコース */
  coast?: boolean;
}

const COURSES: Record<string, Course> = {
  // 阪急神戸線（データの座標は下り = 大阪梅田 → 神戸三宮 の向き）
  'hankyu-kobe-east': {
    route: hankyuKobeEast,
    bbox: [34.69, 135.33, 34.76, 135.51],
    railName: '阪急電鉄神戸線',
    stations: ['大阪梅田', '中津', '十三', '神崎川', '園田', '塚口', '武庫之荘', '西宮北口'],
    mainExtras: [], twoPass: true,
  },
  'hankyu-kobe-west': {
    route: hankyuKobeWest,
    bbox: [34.68, 135.18, 34.76, 135.36],
    railName: '阪急電鉄神戸線',
    stations: ['西宮北口', '夙川', '芦屋川', '岡本', '御影', '六甲', '王子公園', '春日野道', '神戸三宮'],
    mainExtras: [], twoPass: true,
  },
  namba: {
    route: namba,
    bbox: [34.566, 135.452, 34.672, 135.515],
    railName: '南海本線',
    stations: ['堺', '七道', '住ノ江', '住吉大社', '粉浜', '岸里玉出', '天下茶屋', '新今宮', '難波|なんば'],
    mainExtras: ['up-local', 'down-local'],
  },
  // 堺〜泉大津（データの座標は 'shiokaze' = 泉大津 → 堺）
  'sakai-izumiotsu': {
    route: shiokaze,
    bbox: [34.494, 135.398, 34.592, 135.482],
    railName: '南海本線',
    stations: ['泉大津', '松ノ浜', '北助松', '高石', '羽衣', '浜寺公園', '諏訪ノ森', '石津川', '湊', '堺'],
    mainExtras: [],
  },
  // 泉大津〜岸和田（データの座標は 'kishiwada' = 泉大津 → 岸和田）
  'izumiotsu-kishiwada': {
    route: kishiwada,
    bbox: [34.452, 135.362, 34.515, 135.425],
    railName: '南海本線',
    stations: ['泉大津', '忠岡', '春木', '和泉大宮', '岸和田'],
    mainExtras: [],
  },
  // 岸和田〜泉佐野（データの座標は 'izumisano' = 岸和田 → 泉佐野）
  'kishiwada-izumisano': {
    route: izumisano,
    bbox: [34.405, 135.310, 34.470, 135.385],
    railName: '南海本線',
    stations: ['岸和田', '蛸地蔵', '貝塚', '二色浜', '鶴原', '井原里', '泉佐野'],
    mainExtras: [],
  },
  // 泉佐野〜みさき公園（データの座標は 'izumisano-misaki' = 泉佐野 → みさき公園）
  'izumisano-misaki': {
    route: izumisanoMisaki,
    bbox: [34.30, 135.14, 34.43, 135.34],
    railName: '南海本線',
    stations: ['泉佐野', '羽倉崎', '吉見ノ里', '岡田浦', '樽井', '尾崎', '鳥取ノ荘', '箱作', '淡輪', 'みさき公園'],
    mainExtras: [], twoPass: true, coast: true,
  },
  // みさき公園〜和歌山港（データの座標は 'misaki-wakayamako' = みさき公園 → 和歌山港）。和歌山港線は railName の正規表現で含める
  'misaki-wakayamako': {
    route: misakiWakayamako,
    bbox: [34.19, 135.10, 34.34, 135.20],
    railName: '南海本線|和歌山港線',
    stations: ['みさき公園', '孝子', '和歌山大学前', '紀ノ川', '和歌山市', '和歌山港'],
    mainExtras: [], twoPass: true,
  },
};

const RANGE = 320; // 取得・出力する横の範囲 [m]
const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const courseId = args.get('course') ?? 'namba';
const C = COURSES[courseId];
if (!C) throw new Error(`未知のコース: ${courseId}（${Object.keys(COURSES).join(', ')}）`);

// ---------------- 取得 ----------------
interface OsmEl { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

async function fetchOsm(): Promise<OsmEl[]> {
  const cacheDir = 'node_modules/.cache/osm', cache = `${cacheDir}/${courseId}.raw.json`;
  if (args.has('offline') || (existsSync(cache) && !args.has('refresh'))) {
    console.log(`キャッシュを使う: ${cache}`);
    return JSON.parse(readFileSync(cache, 'utf8')).elements;
  }
  const [s, w, n, e] = C.bbox, bb = `${s},${w},${n},${e}`;
  const st = C.stations.flatMap(x => x.split('|')).join('|');
  const A = `around.rail:${RANGE}`;
  const q = `[out:json][timeout:240];
way["railway"="rail"]["name"~"${C.railName}"](${bb})->.rail;
node["railway"="station"]["name"~"^(${st})$"](${bb})->.st;
(
  way(${A})["building"];
  relation(${A})["building"];
  way(${A})["highway"~"^(motorway|motorway_link|trunk|primary|secondary|tertiary|unclassified|residential|living_street|trunk_link|primary_link|secondary_link|tertiary_link)$"];
  way(${A})["leisure"~"^(park|garden|pitch|playground|sports_centre)$"];
  relation(${A})["leisure"~"^(park|garden|pitch|sports_centre)$"];
  way(${A})["landuse"~"^(grass|forest|cemetery|recreation_ground|religious|railway)$"];
  relation(${A})["landuse"~"^(grass|forest|cemetery|recreation_ground|religious)$"];
  way(${A})["natural"~"^(wood|water|scrub)$"];
  relation(${A})["natural"~"^(wood|water|scrub)$"];
  way(${A})["waterway"~"^(river|canal|riverbank)$"];
  relation(${A})["waterway"="riverbank"];
  way(${A})["railway"~"^(tram|light_rail)$"];
  way(${A})["amenity"="parking"];
  way(${A})["amenity"~"^(place_of_worship|school|grave_yard)$"];
  relation(${A})["amenity"="place_of_worship"];
);
out geom;
.rail out tags geom;
.st out;`;
  const url = args.get('endpoint') ?? 'https://overpass-api.de/api/interpreter';
  console.log(`Overpass へ問い合わせ: ${url}`);
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'densha-one-station scenery builder (personal, non-commercial)' } });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json() as { elements: OsmEl[] };
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cache, JSON.stringify(json));
  console.log(`取得 ${json.elements.length} 要素 → ${cache}`);
  return json.elements;
}

/** 海岸線・砂浜・防波堤・桟橋の取得。コースの bbox より北・西へ広げる（海側の海岸線を取りこぼさない）。建物などの生データとは別のキャッシュ */
async function fetchCoast(): Promise<OsmEl[]> {
  const cacheDir = 'node_modules/.cache/osm', cache = `${cacheDir}/${courseId}.coast.raw.json`;
  if (args.has('offline') || (existsSync(cache) && !args.has('refresh'))) {
    console.log(`キャッシュを使う: ${cache}`);
    return JSON.parse(readFileSync(cache, 'utf8')).elements;
  }
  const bb = `${C.bbox[0] - 0.03},${C.bbox[1] - 0.03},${C.bbox[2] + 0.04},${C.bbox[3] + 0.03}`;
  const q = `[out:json][timeout:180];
(
  way["natural"="coastline"](${bb});
  way["natural"="beach"](${bb});
  relation["natural"="beach"](${bb});
  way["man_made"~"^(breakwater|groyne|pier)$"](${bb});
);
out geom;`;
  const endpoints = args.has('endpoint') ? [args.get('endpoint')!] : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  let last = '';
  for (let round = 0; round < 3; round++) for (const url of endpoints) {
    try {
      console.log(`Overpass へ問い合わせ（海岸線）: ${url}`);
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'densha-one-station scenery builder (personal, non-commercial)' } });
      if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const json = await res.json() as { elements: OsmEl[] };
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cache, JSON.stringify(json));
      console.log(`取得 ${json.elements.length} 要素 → ${cache}`);
      return json.elements;
    } catch (e) { last = String(e); console.log(`失敗: ${last}`); await new Promise(r => setTimeout(r, 8000)); }
  }
  throw new Error(`海岸線を取得できなかった: ${last}`);
}

// ---------------- 平面座標（中心付近の等距離近似, m） ----------------
type V = [number, number];
const LAT0 = (C.bbox[0] + C.bbox[2]) / 2, LON0 = (C.bbox[1] + C.bbox[3]) / 2;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
const xy = (lat: number, lon: number): V => [(lon - LON0) * KX, (lat - LAT0) * KY];

/** 基準の折れ線 ref に沿った距離で 10m ごとに点を平均する（ref から corridor [m] 以内の点だけ） */
function rebin(ref: V[], pts: V[], corridor: number): V[] {
  const cum = [0];
  for (let i = 1; i < ref.length; i++) cum.push(cum[i - 1] + Math.hypot(ref[i][0] - ref[i - 1][0], ref[i][1] - ref[i - 1][1]));
  const G = 100, grid = new Map<string, number[]>();
  for (let i = 0; i + 1 < ref.length; i++) {
    const [x0, y0] = ref[i], [x1, y1] = ref[i + 1], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (G / 2)) + 1;
    for (let k = 0; k <= n; k++) { const kk = `${Math.floor((x0 + (x1 - x0) * k / n) / G)},${Math.floor((y0 + (y1 - y0) * k / n) / G)}`; const a = grid.get(kk) ?? []; if (a[a.length - 1] !== i) a.push(i); grid.set(kk, a); }
  }
  const R = Math.ceil(corridor / G) + 1, bins = new Map<number, [number, number, number]>();
  for (const p of pts) {
    const gx = Math.floor(p[0] / G), gy = Math.floor(p[1] / G);
    let best = Infinity, bc = 0; const seen = new Set<number>();
    for (let ix = gx - R; ix <= gx + R; ix++) for (let iy = gy - R; iy <= gy + R; iy++) for (const i of grid.get(`${ix},${iy}`) ?? []) {
      if (seen.has(i)) continue; seen.add(i);
      const [x0, y0] = ref[i], [x1, y1] = ref[i + 1], dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / L2)), d = Math.hypot(p[0] - (x0 + dx * t), p[1] - (y0 + dy * t));
      if (d < best) { best = d; bc = cum[i] + t * Math.sqrt(L2); }
    }
    if (best > corridor) continue;
    const k = Math.floor(bc / 10), v = bins.get(k) ?? [0, 0, 0];
    v[0] += p[0]; v[1] += p[1]; v[2]++; bins.set(k, v);
  }
  const out: V[] = [ref[0]];
  for (const k of [...bins.keys()].sort((a, b) => a - b)) { const v = bins.get(k)!; out.push([v[0] / v[2], v[1] / v[2]]); }
  out.push(ref[ref.length - 1]);
  return out;
}
const smoothPts = (pts: V[], w: number): V[] => pts.map((_, i) => {
  if (i === 0 || i === pts.length - 1) return pts[i];
  let x = 0, y = 0, n = 0;
  for (let j = Math.max(0, i - w); j <= Math.min(pts.length - 1, i + w); j++) { x += pts[j][0]; y += pts[j][1]; n++; }
  return [x / n, y / n] as V;
});
/** 等間隔（step m）に取り直す */
function resamplePts(pts: V[], step: number): V[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1], out: V[] = [];
  let j = 0;
  for (let c = 0; c <= len + 1e-6; c += step) {
    while (j + 1 < cum.length - 1 && cum[j + 1] < c) j++;
    const t = (c - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

/** 線路の中心線（駅順に並べ、10m ごとに上下線の点を平均してならす） */
function centerline(rails: OsmEl[], stationPts: V[]): V[] {
  const pts: V[] = [];
  for (const w of rails) for (const g of w.geometry ?? []) pts.push(xy(g.lat, g.lon));
  const out: V[] = [];
  for (let i = 0; i + 1 < stationPts.length; i++) {
    const a = stationPts[i], b = stationPts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const bins = new Map<number, [number, number, number]>();
    for (const p of pts) {
      const t = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy, d = -(p[0] - a[0]) * uy + (p[1] - a[1]) * ux;
      if (t < 0 || t >= L || Math.abs(d) > 260) continue;
      const k = Math.floor(t / 10), v = bins.get(k) ?? [0, 0, 0];
      v[0] += p[0]; v[1] += p[1]; v[2]++; bins.set(k, v);
    }
    const ks = [...bins.keys()].sort((x, y) => x - y);
    if (i === 0) out.push(a);
    for (const k of ks) { const v = bins.get(k)!; out.push([v[0] / v[2], v[1] / v[2]]); }
  }
  out.push(stationPts[stationPts.length - 1]);
  // 移動平均でならす（上下線の点の偏りによる小さなジグザグを消す）
  const sm: V[] = out.map((_, i) => {
    let x = 0, y = 0, n = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(out.length - 1, i + 3); j++) { x += out[j][0]; y += out[j][1]; n++; }
    return [x / n, y / n];
  });
  sm[0] = out[0]; sm[sm.length - 1] = out[out.length - 1];
  return sm;
}

/** 折れ線への射影: 沿った距離 c と符号付きの横距離 d（進行方向の右が正） */
function projector(line: V[]) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  // 50m 格子の空間索引
  const G = 50, grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1];
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (G / 2)) + 1;
    for (let k = 0; k <= n; k++) { const kk = key(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n); const a = grid.get(kk) ?? []; if (a[a.length - 1] !== i) a.push(i); grid.set(kk, a); }
  }
  return (p: V, maxDist = RANGE + 80): { c: number; d: number } | null => {
    const R = Math.ceil(maxDist / G);
    const gx = Math.floor(p[0] / G), gy = Math.floor(p[1] / G);
    let best = Infinity, bc = 0, bd = 0;
    const seen = new Set<number>();
    for (let r = 0; r <= R; r++) {
      for (let ix = gx - r; ix <= gx + r; ix++) for (let iy = gy - r; iy <= gy + r; iy++) {
        if (Math.max(Math.abs(ix - gx), Math.abs(iy - gy)) !== r) continue;
        for (const i of grid.get(`${ix},${iy}`) ?? []) {
          if (seen.has(i)) continue; seen.add(i);
          const [x0, y0] = line[i], [x1, y1] = line[i + 1], dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
          // 線の両端の外は延長線に射影する（端の点へ寄せると、範囲の外の点がみな端の s に集まる）
          const t0 = ((p[0] - x0) * dx + (p[1] - y0) * dy) / L2;
          const t = i === 0 && t0 < 0 ? t0 : i === line.length - 2 && t0 > 1 ? t0 : Math.max(0, Math.min(1, t0));
          const qx = x0 + dx * t, qy = y0 + dy * t, dist = Math.hypot(p[0] - qx, p[1] - qy);
          if (dist < best) { best = dist; bc = cum[i] + t * Math.sqrt(L2); bd = ((p[0] - x0) * dy - (p[1] - y0) * dx) / Math.sqrt(L2); }
        }
      }
      if (best < (r - 1) * G) break; // これより外の格子はもっと遠い
    }
    return best === Infinity ? null : { c: bc, d: bd };
  };
}

// ---------------- 変換 ----------------
const r1 = (x: number) => Math.round(x * 10) / 10;

function simplify(pts: V[], tol: number): V[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [x0, y0] = pts[a], [x1, y1] = pts[b], L = Math.hypot(x1 - x0, y1 - y0) || 1;
    let mi = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - x0) * (y1 - y0) - (pts[i][1] - y0) * (x1 - x0)) / L; if (d > md) { md = d; mi = i; } }
    if (mi >= 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 多角形を |lat| ≤ lim の帯で切る（s-lat 平面、Sutherland–Hodgman） */
function clipBand(poly: V[], lo: number, hi: number): V[] {
  const clip = (P: V[], inside: (p: V) => boolean, cut: (a: V, b: V) => V) => {
    const out: V[] = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  const at = (v: number) => (a: V, b: V): V => { const t = (v - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, v]; };
  return clip(clip(poly, p => p[1] >= lo, at(lo)), p => p[1] <= hi, at(hi));
}

const area = (p: V[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };

/** 最小面積の外接長方形（辺の向きを候補にする）: 中心・長さ（角度方向）・幅・角度 */
function obb(p: V[]): { cs: number; cl: number; len: number; wid: number; ang: number } {
  let best = { a: Infinity, cs: 0, cl: 0, len: 0, wid: 0, ang: 0 };
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length], ang = Math.atan2(q[1] - p[i][1], q[0] - p[i][0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of p) { const u = x * c + y * s, v = -x * s + y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0);
    if (A < best.a) { const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; best = { a: A, cs: uc * c - vc * s, cl: uc * s + vc * c, len: u1 - u0, wid: v1 - v0, ang }; }
  }
  // 角度は −45°〜45° に寄せる（長さ・幅を入れ替え）
  let { ang, len, wid } = best;
  while (ang > Math.PI / 4) { ang -= Math.PI / 2; [len, wid] = [wid, len]; }
  while (ang < -Math.PI / 4) { ang += Math.PI / 2; [len, wid] = [wid, len]; }
  return { cs: best.cs, cl: best.cl, len, wid, ang };
}

/** 建物の種類: h 戸建て / a 集合住宅 / c 商業・事務所 / i 工場・倉庫 / r 社寺 / p 学校・公共 / g 車庫・小屋 */
function buildingType(t: Record<string, string>, footprint: number): string {
  const b = t.building ?? 'yes', am = t.amenity ?? '';
  if (/^(house|detached|semidetached_house|terrace|bungalow)$/.test(b)) return 'h';
  if (/^(apartments|dormitory)$/.test(b)) return 'a';
  if (/^(commercial|retail|office|hotel|supermarket|kiosk)$/.test(b) || t.shop) return 'c';
  if (/^(industrial|warehouse|factory|manufacture|storage_tank|hangar)$/.test(b)) return 'i';
  if (/^(temple|shrine|church|religious|chapel|cathedral)$/.test(b) || am === 'place_of_worship') return 'r';
  if (/^(school|university|college|public|civic|government|hospital|kindergarten|fire_station|train_station|transportation)$/.test(b)) return 'p';
  if (/^(garage|garages|shed|roof|carport|hut|cabin|service)$/.test(b)) return 'g';
  if (b === 'residential') return footprint > 220 ? 'a' : 'h';
  // building=yes: 大きさで推定
  return footprint < 140 ? 'h' : footprint < 600 ? 'a' : 'c';
}
const levelsOf = (t: Record<string, string>, type: string, footprint: number) => {
  const lv = parseFloat(t['building:levels'] ?? ''), h = parseFloat(t.height ?? '');
  if (lv > 0) return Math.round(lv);
  if (h > 0) return Math.max(1, Math.round(h / 3.1));
  if (type === 'h' || type === 'g') return type === 'g' ? 1 : 2;
  if (type === 'a') return footprint < 300 ? 3 : 5;
  if (type === 'i') return 1;
  if (type === 'r') return 1;
  return footprint < 400 ? 3 : 4;
};

type G = { lat: number; lon: number };
/** 多角形の辺を細かく分ける（範囲の外の頂点を帯で切るとき、線路の曲がりに沿うように） */
function densify(r: G[], step: number): G[] {
  const out: G[] = [];
  for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i], b = r[i + 1], L = Math.hypot((b.lat - a.lat) * 110574, (b.lon - a.lon) * 92000), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push({ lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n });
  }
  out.push(r[r.length - 1]);
  return out;
}
const same = (a: G, b: G) => a.lat === b.lat && a.lon === b.lon;

/** 外周。multipolygon は外周の線（複数の way に分かれている）を端点でつないで閉じた輪にする */
function rings(el: OsmEl): G[][] {
  if (el.type === 'way') return el.geometry ? [el.geometry] : [];
  const parts = (el.members ?? []).filter(m => m.role === 'outer' && m.geometry && m.geometry.length > 1).map(m => m.geometry!.slice());
  return joinLines(parts).filter(r => r.length > 3 && same(r[0], r[r.length - 1]));
}

/** 端点を共有する折れ線をつなぐ（向きは必要なら反転）。key が同じものだけつなぐ */
function joinLines(parts: G[][], keyOf: (i: number) => string = () => '', firsts: number[] = []): G[][] {
  const used = new Uint8Array(parts.length), out: G[][] = [];
  const ends = new Map<string, number[]>();
  const k = (g: G) => `${g.lat},${g.lon}`;
  parts.forEach((p, i) => { for (const g of [p[0], p[p.length - 1]]) { const a = ends.get(k(g)) ?? []; a.push(i); ends.set(k(g), a); } });
  for (let i = 0; i < parts.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let line = parts[i].slice();
    const key = keyOf(i);
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const tail = line[line.length - 1];
        if (same(line[0], tail) && line.length > 2) break; // 閉じた
        const cand = (ends.get(k(tail)) ?? []).filter(j => !used[j] && keyOf(j) === key);
        if (!cand.length) break;
        const j = cand[0]; used[j] = 1;
        const q = same(parts[j][0], tail) ? parts[j] : parts[j].slice().reverse();
        line = line.concat(q.slice(1));
      }
      line.reverse();
    }
    out.push(line); firsts.push(i);
  }
  return out;
}

/** 道路の way を、同じ等級・名前・高架かどうかでつないだ長い折れ線にする（つぎはぎを減らす） */
function mergeRoads(els: OsmEl[]): OsmEl[] {
  const roads = els.filter(e => e.type === 'way' && e.tags?.highway && e.geometry && e.geometry.length > 1);
  const rest = els.filter(e => !roads.includes(e));
  const keyOf = (e: OsmEl) => { const t = e.tags!; return `${roadClass(t)}|${t.name ?? ''}|${isElevated(t) ? 1 : 0}|${t.lanes ?? ''}`; };
  const keys = roads.map(keyOf);
  const firsts: number[] = [];
  const lines = joinLines(roads.map(r => r.geometry!), i => keys[i], firsts);
  const merged: OsmEl[] = lines.map((ln, i) => ({ type: 'way', id: roads[firsts[i]].id, tags: roads[firsts[i]].tags, geometry: ln }));
  console.log(`道路 ${roads.length} 本 → つないで ${merged.length} 本`);
  return [...rest, ...merged];
}
const roadClass = (t: Record<string, string>) => /^motorway/.test(t.highway) ? 0 : /^(trunk|primary)/.test(t.highway) ? 1 : /^(secondary|tertiary)/.test(t.highway) ? 2 : 3;
/** 都市高速（阪神高速など）は高架として別に描く */
const isElevated = (t: Record<string, string>) => /^motorway/.test(t.highway ?? '');

// ---------------- 海岸線 → 海の多角形 ----------------
/** OSM の海岸線は進行方向の右が海。向きは変えずに（逆向きにせず）端点でつなぐ */
function chainForward(parts: G[][]): G[][] {
  const k = (g: G) => `${g.lat},${g.lon}`;
  const byStart = new Map<string, number[]>(), isEnd = new Set<string>();
  parts.forEach((p, i) => { const a = byStart.get(k(p[0])) ?? []; a.push(i); byStart.set(k(p[0]), a); isEnd.add(k(p[p.length - 1])); });
  const used = new Uint8Array(parts.length), out: G[][] = [];
  const follow = (i: number): G[] => {
    let line = parts[i].slice(); used[i] = 1;
    for (;;) {
      const tail = line[line.length - 1];
      if (same(line[0], tail) && line.length > 2) break;
      const nx = (byStart.get(k(tail)) ?? []).find(j => !used[j]);
      if (nx === undefined) break;
      used[nx] = 1; line = line.concat(parts[nx].slice(1));
    }
    return line;
  };
  parts.forEach((p, i) => { if (!used[i] && !isEnd.has(k(p[0]))) out.push(follow(i)); });
  parts.forEach((_, i) => { if (!used[i]) out.push(follow(i)); });
  return out;
}

interface Rect { x0: number; x1: number; y0: number; y1: number }
/** 折れ線を長方形で切る（Liang–Barsky）。長方形の中に入る部分ごとの折れ線を返す */
function clipLine(line: V[], r: Rect): V[][] {
  const out: V[][] = []; let cur: V[] = [];
  const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy], q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.y0, r.y1 - a[1]];
    let t0 = 0, t1 = 1, ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      if (p[k] === 0) { if (q[k] < 0) ok = false; continue; }
      const t = q[k] / p[k];
      if (p[k] < 0) { if (t > t1) ok = false; else if (t > t0) t0 = t; } else { if (t < t0) ok = false; else if (t < t1) t1 = t; }
    }
    if (!ok) { flush(); continue; }
    if (cur.length === 0 || t0 > 0) { flush(); cur.push([a[0] + dx * t0, a[1] + dy * t0]); }
    cur.push([a[0] + dx * t1, a[1] + dy * t1]);
    if (t1 < 1) flush();
  }
  flush();
  return out;
}
const insideRect = (r: Rect, p: V) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
/** 長方形の周を反時計回り（x 軸 → y 軸の向きに内側が左）にたどった位置 */
function perimPos(r: Rect, p: V): number {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  const d = [Math.abs(p[1] - r.y0), Math.abs(p[0] - r.x1), Math.abs(p[1] - r.y1), Math.abs(p[0] - r.x0)];
  const e = d.indexOf(Math.min(...d));
  return e === 0 ? p[0] - r.x0 : e === 1 ? W + (p[1] - r.y0) : e === 2 ? W + H + (r.x1 - p[0]) : 2 * W + H + (r.y1 - p[1]);
}
const onRectEdge = (r: Rect, p: V) => Math.min(Math.abs(p[0] - r.x0), Math.abs(p[0] - r.x1), Math.abs(p[1] - r.y0), Math.abs(p[1] - r.y1)) < 1e-4;
/** 点 from から向き dir へ進んで長方形の縁に着く点 */
function toRectEdge(r: Rect, from: V, dir: V): V {
  const tx = dir[0] > 0 ? (r.x1 - from[0]) / dir[0] : dir[0] < 0 ? (r.x0 - from[0]) / dir[0] : Infinity;
  const ty = dir[1] > 0 ? (r.y1 - from[1]) / dir[1] : dir[1] < 0 ? (r.y0 - from[1]) / dir[1] : Infinity;
  const t = Math.min(tx, ty);
  return [from[0] + dir[0] * t, from[1] + dir[1] * t];
}
/**
 * 海岸線の線（左が海）と輪から、海の多角形（反時計回り）と島の穴を作る。
 * 線は窓（長方形）の縁から縁へ。線の終点から窓の縁を反時計回りにたどり、次の線の始点へつなぐ（osmcoastline と同じ考え方）
 */
function polygonize(lines: V[][], rings: V[][], r: Rect): { outer: V[]; holes: V[][] }[] {
  const W = r.x1 - r.x0, H = r.y1 - r.y0, P = 2 * (W + H);
  const corners: [number, V][] = [[0, [r.x0, r.y0]], [W, [r.x1, r.y0]], [W + H, [r.x1, r.y1]], [2 * W + H, [r.x0, r.y1]]];
  const ts = lines.map(l => perimPos(r, l[0])), te = lines.map(l => perimPos(r, l[l.length - 1]));
  const used = new Uint8Array(lines.length), polys: { outer: V[]; holes: V[][] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const poly: V[] = lines[i].slice();
    let cur = i;
    for (let guard = 0; guard < lines.length + 2; guard++) {
      let best = -1, bd = Infinity;
      for (let j = 0; j < lines.length; j++) {
        if (used[j] && j !== i) continue;
        const d = (((ts[j] - te[cur]) % P) + P) % P;
        if (d < bd) { bd = d; best = j; }
      }
      if (best < 0) break;
      const between = corners.map(([t, p]) => ({ d: (((t - te[cur]) % P) + P) % P, p })).filter(c => c.d > 1e-6 && c.d < bd - 1e-6).sort((a, b) => a.d - b.d);
      for (const c of between) poly.push(c.p);
      if (best === i) break;
      used[best] = 1; poly.push(...lines[best]); cur = best;
    }
    if (area(poly) > 0) polys.push({ outer: poly, holes: [] });
  }
  // 窓の中で閉じた輪: 反時計回り = 海（湖）、時計回り = 島（穴）
  for (const ring of rings) { if (area(ring) > 0) polys.push({ outer: ring, holes: [] }); }
  for (const ring of rings) {
    if (area(ring) > 0) continue;
    const host = polys.find(p => ptInPoly(ring[0], p.outer));
    if (host) host.holes.push(ring.slice().reverse());
  }
  return polys;
}
/** 閉じた輪（最後の点 = 最初の点）の簡略化。始点と終点が同じだと Douglas–Peucker が潰れるので、半分ずつに分ける */
function simplifyClosed(ring: V[], tol: number): V[] {
  const open = ring.slice(0, -1);
  if (open.length < 6) return ring;
  const h = Math.floor(open.length / 2), a = simplify(open.slice(0, h + 1), tol), b = simplify([...open.slice(h), open[0]], tol);
  return [...a.slice(0, -1), ...b];
}
function ptInPoly(p: V, poly: V[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** 踏切（railway=level_crossing）と構内・歩行者の踏切（railway=crossing）。線路から 40m 以内の点と、その点を通る道路の種類を取る */
async function fetchCrossings(): Promise<OsmEl[]> {
  const cacheDir = 'node_modules/.cache/osm', cache = `${cacheDir}/${courseId}.cross.json`;
  if (existsSync(cache) && !args.has('refresh')) return JSON.parse(readFileSync(cache, 'utf8')).elements;
  const [s, w, n, e] = C.bbox, bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:180];
way["railway"="rail"]["name"~"${C.railName}"](${bb})->.rail;
node(around.rail:40)["railway"~"^(level_crossing|crossing)$"]->.cr;
.cr out;
way(bn.cr)["highway"];
out tags geom;`;
  const url = args.get('endpoint') ?? 'https://overpass-api.de/api/interpreter';
  console.log(`Overpass へ問い合わせ（踏切）: ${url}`);
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'densha-one-station scenery builder (personal, non-commercial)' } });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json() as { elements: OsmEl[] };
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cache, JSON.stringify(json));
  return json.elements;
}

const ROAD_W: Record<string, number> = { trunk: 9, primary: 8, secondary: 7, tertiary: 6, unclassified: 5, residential: 5, living_street: 4, service: 4, track: 3.5, cycleway: 3, footway: 2.5, path: 2.5, pedestrian: 3, steps: 2.5 };

async function makeCrossings(route: Route, proj: (p: V, maxDist?: number) => { c: number; d: number } | null, toS: (c: number) => number) {
  const els = await fetchCrossings();
  const nodes = els.filter(e => e.type === 'node' && e.tags?.railway && e.lat != null);
  const ways = els.filter(e => e.type === 'way' && e.tags?.highway && e.geometry);
  const rows: { s: number; d: number; kind: string; hw: string; w: number; name: string; node: number }[] = [];
  for (const nd of nodes) {
    const r = proj(xy(nd.lat!, nd.lon!), 200);
    if (!r || Math.abs(r.d) > 30) continue;
    const s = toS(r.c);
    if (s < route.extent.from - 20 || s > route.extent.to + 20) continue;
    const cand = ways.filter(w => w.geometry!.some(g => Math.abs(g.lat - nd.lat!) < 2e-7 && Math.abs(g.lon - nd.lon!) < 2e-7));
    // 道路の種類は、いちばん太いものを採る
    let hw = '', w = 0, name = '';
    for (const c of cand) {
      const h = c.tags!.highway, base = ROAD_W[h] ?? 4, lanes = Number(c.tags!.lanes ?? 0);
      const ww = Math.max(base, lanes >= 2 ? Math.min(9, 3 + lanes * 1.7) : 0, Number(c.tags!.width ?? 0) > 0 ? Math.min(10, Number(c.tags!.width)) : 0);
      if (ww > w) { w = ww; hw = h; name = c.tags!.name ?? ''; }
    }
    rows.push({ s: Math.round(s), d: Math.round(r.d * 10) / 10, kind: nd.tags!.railway, hw, w: Math.round(w * 2) / 2, name, node: nd.id });
  }
  rows.sort((p, q) => p.s - q.s);
  // 同じ s（数m以内）の点（上下線で別の点になっている）はまとめる
  const merged: typeof rows = [];
  for (const r of rows) { const l = merged[merged.length - 1]; if (l && l.kind === r.kind && Math.abs(l.s - r.s) < 8) { l.w = Math.max(l.w, r.w); if (!l.name) l.name = r.name; continue; } merged.push({ ...r }); }
  console.log(`踏切の点 ${rows.length} → まとめて ${merged.length}（level_crossing ${merged.filter(m => m.kind === 'level_crossing').length}、crossing ${merged.filter(m => m.kind === 'crossing').length}）`);
  for (const m of merged) console.log(`  s=${String(m.s).padStart(6)}  d=${String(m.d).padStart(6)}  ${m.kind.padEnd(15)} ${m.hw.padEnd(12)} w=${m.w}  ${m.name}  node/${m.node}`);
  mkdirSync('node_modules/.cache/osm', { recursive: true });
  writeFileSync(`node_modules/.cache/osm/${courseId}.crossings.json`, JSON.stringify(merged, null, 1));
}

async function main() {
  const els = await fetchOsm();
  const route = C.route;
  const rails = els.filter(e => e.type === 'way' && e.tags?.railway === 'rail' && new RegExp(C.railName).test(e.tags.name ?? ''));
  const stNodes = els.filter(e => e.type === 'node' && e.tags?.railway === 'station');
  // 駅の位置（同名が複数ある場合は線路に最も近いもの）
  const railPts = rails.flatMap(w => (w.geometry ?? []).map(g => xy(g.lat, g.lon)));
  const nearRail = (p: V) => Math.min(...railPts.filter((_, i) => i % 3 === 0).map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
  const stationPts: V[] = C.stations.map(names => {
    const cand = stNodes.filter(n => names.split('|').includes(n.tags!.name)).map(n => xy(n.lat!, n.lon!));
    if (!cand.length) throw new Error(`駅が見つからない: ${names}`);
    return cand.sort((a, b) => nearRail(a) - nearRail(b))[0];
  });
  let line: V[];
  if (C.twoPass) {
    const pts = rails.flatMap(w => (w.geometry ?? []).map(g => xy(g.lat, g.lon)));
    const pass1 = resamplePts(smoothPts(rebin(stationPts, pts, 1200), 3), 10);
    line = smoothPts(smoothPts(rebin(pass1, pts, 60), 3), 3);
  } else line = centerline(rails, stationPts);
  const proj = projector(line);
  // 駅の中心の位置 → ゲームの s（ホームの中心）
  const cSt = stationPts.map(p => proj(p)!.c);
  const sSt = route.stations.map(st => (st.platform.from + st.platform.to) / 2);
  const toS = (c: number) => {
    if (c <= cSt[0]) return sSt[0] + (c - cSt[0]);
    for (let i = 0; i + 1 < cSt.length; i++) if (c <= cSt[i + 1]) return sSt[i] + (sSt[i + 1] - sSt[i]) * (c - cSt[i]) / (cSt[i + 1] - cSt[i]);
    return sSt[sSt.length - 1] + (c - cSt[cSt.length - 1]);
  };
  // ゲーム側の本線群の中心の横位置
  const mains = [...Object.entries(route.trackProfiles ?? {}).filter(([k]) => route.tracks.includes(Number(k))).map(([, p]) => p),
    ...(route.extraTracks ?? []).filter(x => C.mainExtras.includes(x.id)).map(x => ({ p: x.lat, from: x.from, to: x.to }))];
  const center = (s: number) => {
    const ls: number[] = [];
    for (const m of mains) {
      if (Array.isArray(m)) ls.push(profileLat(m, s));
      else if (s >= m.from && s <= m.to) ls.push(profileLat(m.p, s));
    }
    if (!ls.length) return (Math.min(...route.tracks) + Math.max(...route.tracks)) / 2;
    return (Math.min(...ls) + Math.max(...ls)) / 2;
  };
  /** far = 範囲の外の頂点も写す（大きな公園・森の多角形を帯で切るため） */
  const toSL = (lat: number, lon: number, far = false): V | null => {
    const r = proj(xy(lat, lon), far ? 8000 : RANGE + 80);
    if (!r || (!far && Math.abs(r.d) > RANGE + 60)) return null;
    const s = toS(r.c);
    return [s, r.d + center(s)];
  };
  // ---- 踏切（--crossings: 踏切の位置だけを取り直して src/route/routes/<course>-crossings.ts を書く。建物などの JSON は書き換えない）----
  if (args.has('crossings')) { await makeCrossings(route, proj, toS); return; }
  const S0 = route.extent.from - 100, S1 = route.extent.to + 100;
  console.log(`中心線 ${line.length} 点、駅 OSM ${cSt.map(c => (c / 1000).toFixed(2)).join(' / ')} km → ゲーム ${sSt.map(s => (s / 1000).toFixed(2)).join(' / ')} km`);

  // ---- 海岸線（data.coast）: 海の多角形・護岸の線・砂浜・防波堤/桟橋。範囲は線路の始点の前 500m・終点の後 200m、横は -1500〜3200m（霧の遠さまで）----
  const makeCoast = async () => {
    const cels = await fetchCoast();
    const win: Rect = { x0: route.extent.from - 500, x1: route.extent.to + 200, y0: -1500, y1: 3200 };
    // 中心線の始点の近くには小さな折れ（駅の位置に引かれた点）があり、延長線の向きが狂う。海岸線の写しでは始点側の 6 点を使わない（c はその分ずらす）
    const K0 = 6; let c0 = 0; for (let i = 1; i <= K0; i++) c0 += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const projC = projector(line.slice(K0));
    // 中心線から 4.5km より遠い点は写さない（その点で線を分ける。窓の外に出る部分で、写すと遅い）
    const lineSamp = line.filter((_, i) => i % 2 === 0);
    const farOut = (p: V) => { let m = Infinity; for (const q of lineSamp) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < m) m = d; } return m > 4500; };
    /** 写した折れ線（遠い点で分かれた部分ごと）。whole = 分かれず全部写せた */
    const map = (g: G[], step: number): { segs: V[][]; whole: boolean } => {
      const segs: V[][] = []; let cur: V[] = [], whole = true;
      for (const q of densify(g, step)) {
        const w = xy(q.lat, q.lon), r = farOut(w) ? null : projC(w, 6000);
        if (!r) { whole = false; if (cur.length > 1) segs.push(cur); cur = []; continue; }
        const s = toS(r.c + c0); cur.push([s, r.d + center(s)]);
      }
      if (cur.length > 1) segs.push(cur);
      return { segs, whole };
    };
    // 海岸線: 同じ向きにつないで写し、窓で切る。窓の中に端がある線（取得範囲の外で切れた海岸線）は端の向きに延ばして縁へ
    const chains = chainForward(cels.filter(e => e.type === 'way' && e.tags?.natural === 'coastline' && e.geometry && e.geometry.length > 1).map(e => e.geometry!));
    const pieces: V[][] = [], rings: V[][] = [];
    let dangling = 0;
    for (const ch of chains) {
      const closed = same(ch[0], ch[ch.length - 1]) && ch.length > 3;
      const m = map(ch, 25);
      for (const seg of m.segs) {
        const isRing = closed && m.whole;
        let pts = isRing ? simplifyClosed(seg, 4) : simplify(seg, 4);
        if (pts.length < 2) continue;
        if (isRing) {
          const k = pts.findIndex(p => !insideRect(win, p));
          if (k < 0) { rings.push(pts.slice(0, -1)); continue; }
          pts = [...pts.slice(k, -1), ...pts.slice(0, k + 1)]; // 窓の外の点から始める（つなぎ目をまたがない）
        }
        const clipped = clipLine(pts, win);
        clipped.forEach((pc, i) => {
          // 元の線の端（窓の中）で終わる部分は、端の向きに延ばして縁へ
          if (!isRing && i === 0 && !onRectEdge(win, pc[0])) { dangling++; pc.unshift(toRectEdge(win, pc[0], [pc[0][0] - pc[1][0], pc[0][1] - pc[1][1]])); }
          if (!isRing && i === clipped.length - 1 && !onRectEdge(win, pc[pc.length - 1])) { dangling++; const n = pc.length; pc.push(toRectEdge(win, pc[n - 1], [pc[n - 1][0] - pc[n - 2][0], pc[n - 1][1] - pc[n - 2][1]])); }
          if (onRectEdge(win, pc[0]) && onRectEdge(win, pc[pc.length - 1])) pieces.push(pc);
        });
      }
    }
    const polys = polygonize(pieces, rings, win).filter(p => area(p.outer) > 3000); // 窓の縁の細い切れ端を除く
    // 窓を使い切る海（海岸線が窓に入らない）は無し。海が見つからない時は警告
    if (!polys.length) console.warn('海の多角形ができなかった');
    const flat1 = (p: V[]) => p.flatMap(([s, l]) => [r1(s), r1(l)]);
    const sea = polys.map(p => [flat1(p.outer), ...p.holes.map(flat1)]);
    // 護岸の帯に使う海岸線の線（窓の縁に沿う部分は含めない）
    const lines = pieces.map(flat1);
    // 砂浜
    const beach: number[][] = [];
    for (const el of cels) {
      if (el.tags?.natural !== 'beach') continue;
      for (const ring of rings0(el)) {
        let p = simplify(map(ring, 10).segs.flat().slice(0, -1), 2);
        if (p.length < 3) continue;
        if (!p.some(q => insideRect(win, q))) continue;
        if (area(p) < 0) p = p.reverse();
        beach.push(flat1(p));
      }
    }
    // 防波堤・桟橋（OSM にあるものだけ。実在の確認は未実施）
    const works: [string, number, number[]][] = [];
    for (const el of cels) {
      const mm = el.tags?.man_made;
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 2 || !mm || !/^(breakwater|groyne|pier)$/.test(mm)) continue;
      const closed = same(el.geometry[0], el.geometry[el.geometry.length - 1]) && el.geometry.length > 3;
      let p = closed ? simplifyClosed(map(el.geometry, 8).segs.flat(), 1.5) : simplify(map(el.geometry, 8).segs.flat(), 1.5);
      if (closed) { p = p.slice(0, -1); if (p.length < 3) continue; if (area(p) < 0) p = p.reverse(); } else if (p.length < 2) continue;
      if (!p.some(q => insideRect(win, q))) continue;
      works.push([mm === 'pier' ? 'p' : 'b', closed ? 1 : 0, flat1(p)] as [string, number, number[]]);
    }
    const nv = sea.reduce((a, p) => a + p.reduce((b, r) => b + r.length / 2, 0), 0);
    console.log(`海岸線: 線 ${chains.length} 本 → 窓の中 ${pieces.length} 本（端の延長 ${dangling}）、輪 ${rings.length}、海の多角形 ${polys.length}（頂点 ${nv}、穴 ${polys.reduce((a, p) => a + p.holes.length, 0)}）、砂浜 ${beach.length}、防波堤・桟橋 ${works.length}`);
    return { sea, lines, beach, works };
  };
  const rings0 = (el: OsmEl): G[][] => el.type === 'way' ? (el.geometry && same(el.geometry[0], el.geometry[el.geometry.length - 1]) ? [el.geometry] : []) : rings(el);
  const coast = C.coast ? await makeCoast() : undefined;

  const B: number[][] = [], roads: [number, number, string, number[]][] = [], green: [string, number[]][] = [], landmarks: [string, number, number][] = [];
  const counts: Record<string, number> = {};
  const inS = (p: V[]) => p.some(([s]) => s >= S0 && s <= S1);
  const flat = (p: V[]) => p.flatMap(([s, l]) => [r1(s), r1(l)]);
  // 都市高速の本線の点（ランプの高い側の判定）
  const mwNodes = new Set(els.filter(e => e.type === 'way' && e.tags?.highway === 'motorway').flatMap(e => (e.geometry ?? []).map(g => `${g.lat},${g.lon}`)));
  const highways: [number, number[]][] = [];
  for (const el of mergeRoads(els)) {
    const t = el.tags ?? {};
    if (el.type === 'node') continue;
    if (t.railway === 'tram' || t.railway === 'light_rail') continue;
    if (t.railway === 'rail') continue;
    const isArea = !t.building && !t.highway, farOk = isArea || isElevated(t);
    for (const ring of rings(el)) {
      const raw = (isArea ? densify(ring, 20) : ring).map(g => toSL(g.lat, g.lon, farOk));
      if (raw.some(p => !p)) { if (!t.highway) continue; }
      if (t.building) {
        const p = raw as V[];
        if (!inS(p)) continue;
        const fp = Math.abs(area(p));
        if (fp < 15) continue;
        const o = obb(p);
        if (Math.abs(o.cl - center(o.cs)) < 9) continue; // 線路の上（駅舎・高架下）は除く
        const type = buildingType(t, fp);
        if (type === 'g' && fp < 40) continue;
        const lv = levelsOf(t, type, fp);
        B.push([r1(o.cs), r1(o.cl), r1(o.len), r1(o.wid), Math.round(o.ang * 180 / Math.PI), lv, type.charCodeAt(0)]);
        counts['b' + type] = (counts['b' + type] ?? 0) + 1;
        if (t.name && (lv >= 8 || fp > 3000 || type === 'r')) landmarks.push([t.name, r1(o.cs), r1(o.cl)]);
      } else if (t.highway) {
        const segs: V[][] = []; let cur: V[] = [];
        for (const p of raw) { if (p && Math.abs(p[1]) <= RANGE + 40) cur.push(p); else { if (cur.length > 1) segs.push(cur); cur = []; } }
        if (cur.length > 1) segs.push(cur);
        const lanes = parseFloat(t.lanes ?? ''), width = parseFloat(t.width ?? '');
        if (isElevated(t)) {
          // 高架の都市高速: 本線は高さ 12m、ランプは本線につながる側が高く、もう一方は地上
          const ring2 = ring, n = ring2.length, hiA = mwNodes.has(`${ring2[0].lat},${ring2[0].lon}`), hiB = mwNodes.has(`${ring2[n - 1].lat},${ring2[n - 1].lon}`);
          const main = t.highway === 'motorway';
          const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(...(xy(ring2[i].lat, ring2[i].lon).map((v, k) => v - xy(ring2[i - 1].lat, ring2[i - 1].lon)[k]) as V)));
          const Lt = cum[n - 1] || 1, H = 12;
          const hAt = (i: number) => main || (hiA && hiB) ? H : hiA ? H * Math.max(0, 1 - cum[i] / Math.min(Lt, 300)) : hiB ? H * Math.max(0, 1 - (Lt - cum[i]) / Math.min(Lt, 300)) : H;
          const w = width > 0 ? width : lanes > 0 ? lanes * 3.5 + 3 : main ? 10 : 7;
          let cur: number[] = [];
          const flush = () => { if (cur.length >= 6) highways.push([r1(w), cur]); cur = []; };
          raw.forEach((p, i) => { if (p && Math.abs(p[1]) <= RANGE + 200) cur.push(r1(p[0]), r1(p[1]), r1(hAt(i))); else flush(); });
          flush();
          counts.hw = (counts.hw ?? 0) + 1;
          continue;
        }
        const cls = roadClass(t);
        const w = width > 0 ? width : lanes > 0 ? lanes * 3.2 + 2 : cls === 1 ? 16 : cls === 2 ? 9 : 5;
        for (const sg of segs) {
          const p = simplify(sg, 1.2);
          if (!inS(p)) continue;
          roads.push([cls, r1(w), t.name ?? '', flat(p)]);
          counts['r' + cls] = (counts['r' + cls] ?? 0) + 1;
        }
      } else {
        let type = '';
        if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'river' && el.type !== 'way') type = 'water';
        else if (t.natural === 'wood' || t.landuse === 'forest') type = 'wood';
        else if (t.landuse === 'religious' || t.amenity === 'place_of_worship') type = 'shrine';
        else if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'recreation_ground') type = 'park';
        else if (t.landuse === 'grass' || t.natural === 'scrub' || t.leisure === 'playground') type = 'grass';
        else if (t.leisure === 'pitch' || t.leisure === 'sports_centre') type = 'pitch';
        else if (t.amenity === 'school') type = 'school';
        else if (t.amenity === 'grave_yard' || t.landuse === 'cemetery') type = 'grave';
        else if (t.amenity === 'parking') type = 'lot';
        if (!type || raw.some(p => !p)) continue;
        // 閉じた多角形だけ（川の中心線などは除く）
        const first = ring[0], last = ring[ring.length - 1];
        if (first.lat !== last.lat || first.lon !== last.lon) continue;
        let p = clipBand(simplify((raw as V[]).slice(0, -1), 1.5), -RANGE, RANGE);
        if (p.length < 3 || !inS(p) || Math.abs(area(p)) < 80) continue;
        if (area(p) < 0) p = p.reverse();
        green.push([type, flat(p)]);
        counts['g' + type] = (counts['g' + type] ?? 0) + 1;
        if (t.name && (type === 'shrine' || type === 'park' || type === 'water')) {
          const cs = p.reduce((a, q) => a + q[0], 0) / p.length, cl = p.reduce((a, q) => a + q[1], 0) / p.length;
          landmarks.push([t.name, r1(cs), r1(cl)]);
        }
      }
    }
  }
  B.sort((a, b) => a[0] - b[0]);
  const out = {
    source: '© OpenStreetMap contributors（ODbL 1.0）。OpenStreetMap API / Overpass API で取得し、コースの座標へ写して簡略化',
    course: courseId, range: RANGE, fetched: new Date().toISOString().slice(0, 10),
    /** 建物: [s, lat, 長さ, 幅, 角度(度, s 軸から), 階数, 種類の文字コード] */
    buildings: B,
    /** 道路: [等級 1=幹線 2=主要 3=生活, 幅 m, 名前, s,lat の並び] */
    roads,
    /** 高架の都市高速: [幅 m, s,lat,高さ の並び] */
    highways,
    /** 面: [種類, s,lat の並び（反時計回り）] */
    areas: green,
    /** 名前のある主な施設: [名前, s, lat] */
    landmarks,
    /** 海岸線（C.coast のコースだけ）: sea = 海の多角形 [[外周 s,lat の並び（反時計回り）, 島の穴…], …]、lines = 海岸線 [s,lat の並び]（進行方向に対し海は左 = lat の大きい側）、
     *  beach = 砂浜の多角形、works = 防波堤(b)・桟橋(p) [種類, 閉じた輪か, s,lat の並び] */
    ...(coast ? { coast } : {}),
  };
  mkdirSync('src/data/osm', { recursive: true });
  const file = `src/data/osm/${courseId}.json`, text = JSON.stringify(out);
  writeFileSync(file, text);
  console.log(`${file}: ${(text.length / 1024).toFixed(0)} KB`, counts);
  console.log('主な施設:', landmarks.slice(0, 40).map(([n, s, l]) => `${n}(s=${s.toFixed(0)}, lat=${l.toFixed(0)})`).join(' '));
}

main().catch(e => { console.error(e); process.exit(1); });
