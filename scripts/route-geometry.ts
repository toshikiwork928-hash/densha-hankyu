// 路線データの下書き生成: OSM の線路の中心線と国土地理院の標高から、線形（直線・円弧）・勾配・トンネル・橋の範囲を作る。
// 出力: src/data/geometry/<chain>.json。路線データ（src/route/routes/*.ts）を書く人が読む材料で、アプリは直接読まない。
// 実行: npm run geometry:south（ローカルのみ。Overpass と国土地理院の標高 API へ接続する）
//   --offline  取得済みのキャッシュ（node_modules/.cache/osm/<chain>.raw.json、標高は .elev.json）だけで変換
// 出典: © OpenStreetMap contributors（ODbL 1.0）、標高は国土地理院（標高API、5mメッシュ（レーザ）等）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type V = [number, number];
interface OsmEl { type: string; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }
interface StationSpec { name: string; osm: string; km: number }
interface Chain { id: string; bbox: [number, number, number, number]; rail: string; stations: StationSpec[]; /** 同名駅で優先する事業者 */ operator: RegExp }

// 営業キロは南海公式（Wikipedia「南海本線」の駅一覧）の難波起点から泉佐野（34.0km）を引いた値。和歌山港線は和歌山市から2.8km。
const CHAINS: Record<string, Chain> = {
  south: {
    id: 'south',
    bbox: [34.14, 135.10, 34.42, 135.33],
    rail: '南海本線|和歌山港線',
    stations: [
      { name: '泉佐野', osm: '泉佐野', km: 0 }, { name: '羽倉崎', osm: '羽倉崎', km: 2.1 }, { name: '吉見ノ里', osm: '吉見ノ里', km: 3.4 },
      { name: '岡田浦', osm: '岡田浦', km: 4.8 }, { name: '樽井', osm: '樽井', km: 6.6 }, { name: '尾崎', osm: '尾崎', km: 9.1 },
      { name: '鳥取ノ荘', osm: '鳥取ノ荘', km: 10.6 }, { name: '箱作', osm: '箱作', km: 12.6 }, { name: '淡輪', osm: '淡輪', km: 16.2 },
      { name: 'みさき公園', osm: 'みさき公園', km: 17.9 }, { name: '孝子', osm: '孝子', km: 22.3 }, { name: '和歌山大学前', osm: '和歌山大学前', km: 24.0 },
      { name: '紀ノ川', osm: '紀ノ川', km: 27.6 }, { name: '和歌山市', osm: '和歌山市', km: 30.2 }, { name: '和歌山港', osm: '和歌山港', km: 33.0 },
    ],
    operator: /南海/,
  },
  // 阪急神戸本線 大阪梅田〜神戸三宮（営業キロは Wikipedia「阪急神戸本線」）
  'hankyu-kobe': {
    id: 'hankyu-kobe',
    bbox: [34.68, 135.18, 34.77, 135.51],
    rail: '神戸本線|神戸線',
    stations: [
      ['大阪梅田', 0], ['中津', 0.9], ['十三', 2.4], ['神崎川', 4.1], ['園田', 7.2], ['塚口', 10.2], ['武庫之荘', 12.3], ['西宮北口', 15.6],
      ['夙川', 18.3], ['芦屋川', 21.0], ['岡本', 23.4], ['御影', 25.6], ['六甲', 27.4], ['王子公園', 29.2], ['春日野道', 30.7], ['神戸三宮', 32.3],
    ].map(([name, km]) => ({ name: name as string, osm: name as string, km: km as number })),
    operator: /阪急/,
  },
};
const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const chain = CHAINS[args.get('chain') ?? 'south'];
const offline = args.has('offline');
const cacheDir = 'node_modules/.cache/osm';
const rawFile = `${cacheDir}/${chain.id}.raw.json`, elevFile = `${cacheDir}/${chain.id}.elev.json`;
const outFile = `src/data/geometry/${chain.id}.json`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------- 取得 ----------------
async function fetchRaw(): Promise<OsmEl[]> {
  if (existsSync(rawFile) && (offline || args.has('cache'))) return JSON.parse(readFileSync(rawFile, 'utf8')).elements;
  if (offline) throw new Error(`キャッシュがない: ${rawFile}`);
  const A = chain.bbox.join(',');
  const op = chain.operator.source;
  const q = `[out:json][timeout:120];(way["railway"="rail"]["name"~"${chain.rail}"]["operator"~"${op}"](${A});way["railway"="rail"]["name"~"${chain.rail}"][!"operator"](${A});node["railway"="station"](${A});way["waterway"~"^(river|canal|stream)$"](${A}););out tags geom;`;
  const eps = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  for (let round = 0; round < 12; round++) for (const url of eps) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'densha-one-station route builder (personal, non-commercial)' } });
      const text = await res.text();
      if (text.startsWith('{')) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(rawFile, text); return JSON.parse(text).elements; }
      console.log(`再試行（${url}）: ${text.replace(/<[^>]*>/g, '').trim().slice(-120)}`);
    } catch (e) { console.log(`接続失敗 ${url}: ${(e as Error).message}`); }
    await sleep(20000);
  }
  throw new Error('Overpass から取得できなかった');
}

// ---------------- 平面座標 ----------------
const LAT0 = (chain.bbox[0] + chain.bbox[2]) / 2, LON0 = (chain.bbox[1] + chain.bbox[3]) / 2;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
const xy = (lat: number, lon: number): V => [(lon - LON0) * KX, (lat - LAT0) * KY];
const inv = (p: V): { lat: number; lon: number } => ({ lat: p[1] / KY + LAT0, lon: p[0] / KX + LON0 });

/** 上下線の点を駅の間ごとに 10m の区切りで平均して中心線にする（osm-scenery.ts と同じ考え方） */
function centerline(pts: V[], st: V[]): V[] {
  const out: V[] = [];
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i], b = st[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const bins = new Map<number, [number, number, number]>();
    for (const p of pts) {
      const t = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy, d = -(p[0] - a[0]) * uy + (p[1] - a[1]) * ux;
      if (t < 0 || t >= L || Math.abs(d) > 220) continue;
      const k = Math.floor(t / 10), v = bins.get(k) ?? [0, 0, 0];
      v[0] += p[0]; v[1] += p[1]; v[2]++; bins.set(k, v);
    }
    if (i === 0) out.push(a);
    for (const k of [...bins.keys()].sort((x, y) => x - y)) { const v = bins.get(k)!; out.push([v[0] / v[2], v[1] / v[2]]); }
  }
  out.push(st[st.length - 1]);
  return out;
}
/** 基準の折れ線 ref に沿った距離で 10m ごとに点を平均する（ref から corridor [m] 以内の点だけ）。曲がりの大きい駅間でも、基準を直前の結果にして二度かけると線路に沿う */
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
const smoothLine = (pts: V[], w: number): V[] => pts.map((_, i) => {
  if (i === 0 || i === pts.length - 1) return pts[i];
  let x = 0, y = 0, n = 0;
  for (let j = Math.max(0, i - w); j <= Math.min(pts.length - 1, i + w); j++) { x += pts[j][0]; y += pts[j][1]; n++; }
  return [x / n, y / n];
});
/** 等間隔（step m）に取り直す */
function resample(pts: V[], step: number): { p: V[]; len: number } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1], out: V[] = [];
  let j = 0;
  for (let c = 0; c <= len + 1e-6; c += step) {
    while (j + 1 < cum.length - 1 && cum[j + 1] < c) j++;
    const t = (c - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return { p: out, len };
}
const project = (line: V[], cum: number[], p: V) => {
  let best = Infinity, bc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1], dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / L2));
    const d = Math.hypot(p[0] - (x0 + dx * t), p[1] - (y0 + dy * t));
    if (d < best) { best = d; bc = cum[i] + t * Math.sqrt(L2); }
  }
  return { c: bc, d: best };
};

// ---------------- 標高（国土地理院 標高API） ----------------
async function elevations(line: V[], seaZero = false): Promise<number[]> {
  const cache: Record<string, number> = existsSync(elevFile) ? JSON.parse(readFileSync(elevFile, 'utf8')) : {};
  const out: number[] = [];
  let fetched = 0;
  for (const p of line) {
    const { lat, lon } = inv(p), key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (cache[key] == null) {
      if (offline) throw new Error('標高のキャッシュがない');
      for (let k = 0; k < 4 && cache[key] == null; k++) {
        try {
          const r = await fetch(`https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon.toFixed(6)}&lat=${lat.toFixed(6)}&outtype=JSON`);
          const j = await r.json() as { elevation: number | string };
          const e = Number(j.elevation);
          if (Number.isFinite(e)) cache[key] = e;
        } catch { await sleep(500); }
      }
      if (cache[key] == null) cache[key] = NaN;
      if (++fetched % 40 === 0) writeFileSync(elevFile, JSON.stringify(cache));
      await sleep(60);
    }
    out.push(cache[key]);
  }
  writeFileSync(elevFile, JSON.stringify(cache));
  // 取れなかった点（海上など）。seaZero は標高 0（海）、そうでなければ前後から補う
  if (seaZero) return out.map(e => Number.isFinite(e) ? e : 0);
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) { let j = i + 1; while (j < out.length && !Number.isFinite(out[j])) j++; const a = out[i - 1] ?? out[j], b = out[j] ?? a; for (let k = i; k < j; k++) out[k] = a + (b - a) * (k - i + 1) / (j - i + 1); }
  return out;
}

// ---------------- 本体 ----------------
/** 並走する JR（東海道線）の線路。別のキャッシュ（<chain>.jr.raw.json） */
async function fetchJr(): Promise<OsmEl[]> {
  const f = `${cacheDir}/${chain.id}.jr.raw.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')).elements;
  if (offline) return [];
  const q = `[out:json][timeout:90];way["railway"="rail"]["operator"~"西日本旅客鉄道|JR"]["name"~"東海道|神戸線"][!"service"](${chain.bbox.join(',')});out tags geom;`;
  for (let round = 0; round < 6; round++) for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const text = await (await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'densha-hankyu route builder (personal, non-commercial)' } })).text();
      if (text.startsWith('{')) { writeFileSync(f, text); return JSON.parse(text).elements; }
    } catch { /* 次へ */ }
    await sleep(15000);
  }
  return [];
}

async function main() {
  const els = await fetchRaw();
  const jrEls = chain.id === 'hankyu-kobe' ? await fetchJr() : [];
  // 線路の点（側線・渡り線・車庫線は除く）
  const rails = els.filter(e => e.type === 'way' && e.tags?.railway === 'rail' && !e.tags.service && e.geometry && !/JR|東海道|山陽/.test(e.tags.name ?? ''));
  const pts: V[] = [];
  for (const w of rails) for (const g of w.geometry!) pts.push(xy(g.lat, g.lon));
  const sts = els.filter(e => e.type === 'node' && e.tags?.railway === 'station');
  const stPt: V[] = chain.stations.map(s => {
    const c = sts.filter(e => e.tags?.name === s.osm);
    if (!c.length) throw new Error(`駅が無い: ${s.name}`);
    // 同名が複数なら南海の駅（operator に南海）を優先
    // 事業者の一致を優先し、無ければ線路に最も近いもの（阪神の御影・春日野道など同名駅を除く）
    const near = (e: OsmEl) => { const p = xy(e.lat!, e.lon!); let d = Infinity; for (let i = 0; i < pts.length; i += 3) d = Math.min(d, Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1])); return d; };
    const pick = c.find(e => chain.operator.test(e.tags?.operator ?? '')) ?? [...c].sort((p, q) => near(p) - near(q))[0];
    return xy(pick.lat!, pick.lon!);
  });
  // 1回目: 駅どうしを結ぶ直線から 1.2km 以内の点で粗い中心線、2回目: その線から 60m 以内の点（上下線）で中心線
  const pass1 = resample(smoothLine(rebin(stPt, pts, 1200), 3), 10).p;
  const raw = rebin(pass1, pts, 60);
  const sm = smoothLine(smoothLine(raw, 3), 3);
  const { p: line, len: osmLen } = resample(sm, 10);
  const cum = line.map((_, i) => i * 10);
  // 駅の OSM 上の距離 → 営業キロへ伸縮（駅間ごとの線形）
  const stC = stPt.map(p => project(line, cum, p).c);
  const stS = chain.stations.map(s => s.km * 1000);
  const toGame = (c: number) => {
    let i = 0; while (i + 2 < stC.length && c > stC[i + 1]) i++;
    return stS[i] + (c - stC[i]) * (stS[i + 1] - stS[i]) / (stC[i + 1] - stC[i]);
  };
  const fromGame = (s: number) => {
    let i = 0; while (i + 2 < stS.length && s > stS[i + 1]) i++;
    return stC[i] + (s - stS[i]) * (stC[i + 1] - stC[i]) / (stS[i + 1] - stS[i]);
  };
  console.log(`中心線 ${line.length} 点 ${(osmLen / 1000).toFixed(2)}km、営業キロ ${(stS[stS.length - 1] / 1000).toFixed(2)}km`);
  console.log('駅間の伸縮率（営業キロ / OSM）:', chain.stations.slice(1).map((s, i) => `${chain.stations[i].name}→${s.name} ${((stS[i + 1] - stS[i]) / (stC[i + 1] - stC[i])).toFixed(3)}`).join(' | '));

  // 進行方向の角度 θ(c)（左＝反時計回りが増える向き）。60m の窓でならす
  const th: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 12)], b = line[Math.min(line.length - 1, i + 12)];
    th.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
  }
  for (let i = 1; i < th.length; i++) { while (th[i] - th[i - 1] > Math.PI) th[i] -= 2 * Math.PI; while (th[i] - th[i - 1] < -Math.PI) th[i] += 2 * Math.PI; }
  /** θ を折れ線で近似する分割点（Douglas–Peucker。値は両端の θ を結ぶ。forced の添字では必ず分ける） */
  const MIN_GAP = 15; // 分割点どうしは 150m 以上あける（ならしたあとの細かい揺れを円弧にしない）
  const dpFit = (v: number[], tol: number, forced: number[]): number[] => {
    const cut = new Set<number>([0, v.length - 1, ...forced.filter(k => k > 0 && k < v.length - 1)]);
    const order = [...cut].sort((p, q) => p - q);
    for (let o = 0; o + 1 < order.length; o++) {
      const stack: [number, number][] = [[order[o], order[o + 1]]];
      while (stack.length) {
        const [p, q] = stack.pop()!;
        let mi = -1, md = tol;
        for (let k = p + MIN_GAP; k <= q - MIN_GAP; k++) { const e = Math.abs(v[k] - (v[p] + (v[q] - v[p]) * (k - p) / (q - p))); if (e > md) { md = e; mi = k; } }
        if (mi >= 0) { cut.add(mi); stack.push([p, mi], [mi, q]); }
      }
    }
    return [...cut].sort((p, q) => p - q);
  };
  const lerpFit = (v: number[], br: number[]): number[] => {
    const o = v.slice();
    for (let k = 0; k + 1 < br.length; k++) for (let i = br[k]; i <= br[k + 1]; i++) o[i] = v[br[k]] + (v[br[k + 1]] - v[br[k]]) * (i - br[k]) / (br[k + 1] - br[k]);
    return o;
  };
  const TOL = .9 * Math.PI / 180;
  const th1 = lerpFit(th, dpFit(th, TOL, []));
  // ホームの範囲（停止位置の手前180m〜先40m。ゲームの規約。余裕を足す）は直線にする。
  // 直線にして失う角度は、直後の300mで元の θ へ戻す（以降の位置ずれを残さない）
  const th2 = th1.slice(), forced: number[] = [];
  for (let k = 0; k < chain.stations.length; k++) {
    const i0 = Math.max(0, Math.round(fromGame(stS[k] - 190) / 10)), i1 = Math.min(th2.length - 1, Math.round(fromGame(stS[k] + 60) / 10));
    const mid = th1[Math.round((i0 + i1) / 2)];
    for (let i = i0; i <= i1; i++) th2[i] = mid;
    forced.push(i0, i1);
    const back = 30;
    for (let i = i1 + 1; i <= Math.min(th2.length - 1, i1 + back); i++) { const t = (i - i1) / back; th2[i] = mid + (th1[i] - mid) * t; }
    forced.push(Math.min(th2.length - 1, i1 + back));
  }
  const br = dpFit(th2, TOL / 2, forced);
  const thF = lerpFit(th2, br);
  type Seg = { type: 'straight'; length: number } | { type: 'arc'; radius: number; angle: number; turn: 'L' | 'R' };
  const merged: Seg[] = [];
  for (let k = 0; k + 1 < br.length; k++) {
    const len = (br[k + 1] - br[k]) * 10, d = thF[br[k + 1]] - thF[br[k]];
    const g: Seg = Math.abs(d) < .0006 ? { type: 'straight', length: len } : { type: 'arc', radius: len / Math.abs(d), angle: Math.abs(d), turn: d > 0 ? 'L' : 'R' };
    const last = merged[merged.length - 1];
    if (g.type === 'straight' && last?.type === 'straight') last.length += g.length; else merged.push(g);
  }
  // 営業キロへ伸縮: 円弧は半径を変えて長さを合わせる
  let acc = 0; const scaled: { seg: Seg; from: number; to: number }[] = [];
  for (const g of merged) {
    const l = g.type === 'straight' ? g.length : g.radius * g.angle;
    const from = toGame(acc), to = toGame(acc + l);
    const ratio = (to - from) / l;
    const seg: Seg = g.type === 'straight' ? { type: 'straight', length: g.length * ratio } : { type: 'arc', radius: g.radius * ratio, angle: g.angle, turn: g.turn };
    scaled.push({ seg, from, to }); acc += l;
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const segments = scaled.map(({ seg }) => seg.type === 'straight' ? { type: 'straight', length: r2(seg.length) } : { type: 'arc', radius: Math.round(seg.radius), angle: Math.round(seg.angle * 1e5) / 1e5, turn: seg.turn });
  const minRadius = Math.min(...scaled.filter(x => x.seg.type === 'arc').map(x => (x.seg as { radius: number }).radius));
  // 再構成した線形と OSM の中心線のずれ
  let x = line[0][0], y = line[0][1], h = thF[0], maxDev = 0, devAt = 0;
  const rec: V[] = [[x, y]];
  const idx = (c: number) => Math.min(line.length - 1, Math.round(c / 10));
  for (const g of merged) {
    const l = g.type === 'straight' ? g.length : g.radius * g.angle;
    const n = Math.max(1, Math.round(l / 10));
    for (let k = 0; k < n; k++) {
      const dl = l / n, dh = g.type === 'straight' ? 0 : (g.turn === 'L' ? 1 : -1) * g.angle / n;
      h += dh / 2; x += Math.cos(h) * dl; y += Math.sin(h) * dl; h += dh / 2; rec.push([x, y]);
    }
  }
  for (let q = 0; q < rec.length; q++) { const o = line[idx(q * 10)]; const d = Math.hypot(rec[q][0] - o[0], rec[q][1] - o[1]); if (d > maxDev) { maxDev = d; devAt = q * 10; } }
  { const dv: string[] = []; for (let q = 0; q < rec.length; q += 150) { const o = line[idx(q * 10)]; dv.push(`${Math.round(q * 10 / 1000 * 10) / 10}km:${Math.round(Math.hypot(rec[q][0] - o[0], rec[q][1] - o[1]))}`); } console.log('ずれ（OSM上のkm:m）', dv.join(' ')); }
  console.log(`円弧 ${segments.filter(g => g.type === 'arc').length} 個、最小半径 ${Math.round(minRadius)}m、再構成との最大ずれ ${Math.round(maxDev)}m（OSM上 ${Math.round(devAt)}m 付近）`);

  // トンネル・橋: OSM の tunnel / bridge タグの way が中心線に沿う範囲
  const cls = els.filter(e => e.type === 'way' && e.tags?.railway === 'rail' && !e.tags.service && e.geometry && (e.tags.tunnel || e.tags.bridge));
  const spans: { kind: string; from: number; to: number; layer?: string; name?: string }[] = [];
  for (const w of cls) {
    const ps = w.geometry!.map(g => project(line, cum, xy(g.lat, g.lon)));
    const near = ps.filter(q => q.d < 40);
    if (near.length < 2) continue;
    const c0 = Math.min(...near.map(q => q.c)), c1 = Math.max(...near.map(q => q.c));
    spans.push({ kind: w.tags!.tunnel ? 'tunnel' : 'bridge', from: toGame(c0), to: toGame(c1), layer: w.tags!.layer, name: w.tags!['bridge:name'] ?? w.tags!.name });
  }
  spans.sort((a, b) => a.from - b.from);
  // 隣り合う同種を合わせる（上下線で重なる分）
  const mergedSpans: typeof spans = [];
  for (const s of spans) { const l = mergedSpans[mergedSpans.length - 1]; if (l && l.kind === s.kind && s.from <= l.to + 20) l.to = Math.max(l.to, s.to); else mergedSpans.push({ ...s }); }
  const structures = mergedSpans.filter(s => s.to - s.from >= 20).map(s => ({ kind: s.kind, from: Math.round(s.from), to: Math.round(s.to), length: Math.round(s.to - s.from), name: s.name }));
  // 川と線路の交点（waterway の線が中心線を横切る位置）
  const rivers: { name: string; s: number; type: string }[] = [];
  for (const w of els.filter(e => e.type === 'way' && e.tags?.waterway && e.geometry)) {
    const g = w.geometry!.map(q => xy(q.lat, q.lon));
    for (let k = 0; k + 1 < g.length; k++) {
      const [a, b] = [g[k], g[k + 1]];
      for (let i = 0; i + 1 < line.length; i++) {
        const [c, d] = [line[i], line[i + 1]];
        const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
        if (!den) continue;
        const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) rivers.push({ name: w.tags!.name ?? '(名前なし)', s: Math.round(toGame(cum[i] + u * 10)), type: w.tags!.waterway });
      }
    }
  }
  rivers.sort((p, q) => p.s - q.s);
  // 並走する JR の線路の横位置: 50m ごとに、線路から 80m 以内の JR の点の横位置の平均（上下線の中心）。点が無い所は出さない
  const jr: [number, number][] = [];
  {
    const bins = new Map<number, [number, number]>();
    for (const w of jrEls.filter(e => e.type === 'way' && e.geometry)) for (const q of w.geometry!) {
      const p = xy(q.lat, q.lon), pr = project(line, cum, p);
      if (pr.d > 80) continue;
      const i = Math.min(line.length - 2, Math.floor(pr.c / 10)), dx = line[i + 1][0] - line[i][0], dy = line[i + 1][1] - line[i][1];
      const left = dx * (p[1] - line[i][1]) - dy * (p[0] - line[i][0]) > 0;
      const k = Math.round(toGame(pr.c) / 50), v = bins.get(k) ?? [0, 0];
      v[0] += left ? -pr.d : pr.d; v[1]++; bins.set(k, v);
    }
    for (const k of [...bins.keys()].sort((p, q) => p - q)) { const v = bins.get(k)!; jr.push([k * 50, Math.round(v[0] / v[1] * 10) / 10]); }
    if (jr.length) console.log(`JR の並走: ${jr[0][0]}〜${jr[jr.length - 1][0]}m、横位置 ${Math.min(...jr.map(x => x[1]))}〜${Math.max(...jr.map(x => x[1]))}m`);
  }
  // 川の線をコースの座標（s, lat。進行方向の右が正）へ写す。線路から 330m 以内の部分だけ（水面の手作りデータの材料）
  const riverLines: { name: string; type: string; pts: number[] }[] = [];
  for (const w of els.filter(e => e.type === 'way' && e.tags?.waterway && e.geometry)) {
    let run: number[] = [];
    const flush = () => { if (run.length >= 4) riverLines.push({ name: w.tags!.name ?? '', type: w.tags!.waterway, pts: run }); run = []; };
    for (const q of w.geometry!) {
      const p = xy(q.lat, q.lon), pr = project(line, cum, p);
      if (pr.d > 330) { flush(); continue; }
      const i = Math.min(line.length - 2, Math.floor(pr.c / 10)), dx = line[i + 1][0] - line[i][0], dy = line[i + 1][1] - line[i][1];
      const left = dx * (p[1] - line[i][1]) - dy * (p[0] - line[i][0]) > 0;
      run.push(Math.round(toGame(pr.c) * 10) / 10, Math.round((left ? -pr.d : pr.d) * 10) / 10);
    }
    flush();
  }
  console.log('川:', rivers.map(r => `${r.name}(${r.type}) ${r.s}`).join(' | '));
  console.log('橋・トンネル:', structures.map(x => `${x.kind}${x.name ? ' ' + x.name : ''} ${x.from}-${x.to}`).join(' | '));

  // 標高: 100m ごと（中心線上の営業キロの位置）。5点の移動平均でならす
  const step = 100, N = Math.floor(stS[stS.length - 1] / step) + 1;
  const samples: V[] = []; const sPos: number[] = [];
  for (let k = 0; k < N; k++) { const s = k * step; sPos.push(s); samples.push(line[idx(fromGame(s))]); }
  const elev = await elevations(samples);
  // トンネルと長い橋の中は、地面（山の上・川底）の標高ではなく、出入口の標高の直線補間にする
  for (const sp of structures.filter(x => x.kind === 'tunnel' || x.length > 60)) {
    const k0 = Math.max(0, Math.floor(sp.from / step)), k1 = Math.min(elev.length - 1, Math.ceil(sp.to / step));
    for (let k = k0 + 1; k < k1; k++) elev[k] = elev[k0] + (elev[k1] - elev[k0]) * (k - k0) / (k1 - k0);
  }
  const el5 = elev.map((_, k) => { let a = 0, n = 0; for (let j = Math.max(0, k - 2); j <= Math.min(elev.length - 1, k + 2); j++) { a += elev[j]; n++; } return a / n; });
  const base = el5[0];
  const profile = el5.map((e, k) => ({ s: sPos[k], z: r2(e - base), raw: r2(elev[k] - base) }));

  // 勾配: 300m ごとの平均勾配を ±25‰ に収め、5‰ 未満は水平。近い値は合わせる
  const grads: { from: number; to: number; permil: number }[] = [];
  for (let s = 0; s + 300 <= stS[stS.length - 1] + 1; s += 300) {
    const a = el5[Math.round(s / step)], b = el5[Math.min(el5.length - 1, Math.round((s + 300) / step))];
    let g = (b - a) / 300 * 1000;
    g = Math.abs(g) < 5 ? 0 : Math.max(-25, Math.min(25, Math.round(g / 5) * 5));
    const last = grads[grads.length - 1];
    if (last && last.permil === g && last.to === s) last.to = s + 300; else grads.push({ from: s, to: s + 300, permil: g });
  }
  // 駅のホーム（停止位置の手前180m〜先40m）は水平にする: 勾配の区間をホームの外へ切る
  const hold: { from: number; to: number }[] = chain.stations.map((_, i) => ({ from: stS[i] - 200, to: stS[i] + 70 }));
  const gradients: { from: number; to: number; permil: number }[] = [];
  for (const g of grads.filter(g => g.permil !== 0)) {
    let parts: [number, number][] = [[g.from, g.to]];
    for (const hz of hold) parts = parts.flatMap(([a, b]) => b <= hz.from || a >= hz.to ? [[a, b] as [number, number]] : [[a, Math.min(b, hz.from)] as [number, number], [Math.max(a, hz.to), b] as [number, number]].filter(([p, q]) => q - p > 30));
    for (const [a, b] of parts) gradients.push({ from: Math.round(a), to: Math.round(b), permil: g.permil });
  }

  // 周囲の山（relief）: 線路の中心から左右 350m 以上の所の標高を、線路の地面（トンネル・橋の中は出入口の補間）からの高さで持つ。
  // 350m 以内の節点は、route.reliefNear の範囲（山あいの区間）だけで使う（ほかは OSM の建物・道路が平らな地面前提で置かれるので 0 として扱う）。海（標高データ無し）は 0。右が正（ゲームの lat と同じ）
  const RELIEF_LATS = [-1400, -1000, -700, -500, -350, -250, -170, -100, -50, 50, 100, 170, 250, 350, 500, 700, 1000, 1400];
  const reliefPts: V[] = [];
  for (let k = 0; k < N; k++) {
    const ci = idx(fromGame(k * step)), th0 = th[ci], nx = Math.sin(th0), ny = -Math.cos(th0), c = line[ci];
    for (const l of RELIEF_LATS) reliefPts.push([c[0] + nx * l, c[1] + ny * l]);
  }
  const reliefZ = await elevations(reliefPts, true);
  const relief = { step, lats: RELIEF_LATS, rows: Array.from({ length: N }, (_, k) => RELIEF_LATS.map((_, j) => Math.max(0, Math.round(reliefZ[k * RELIEF_LATS.length + j] - elev[k] - 2)))) };
  console.log(`周囲の山: 最大 ${Math.max(...relief.rows.flat())}m、5m 以上の点 ${relief.rows.flat().filter(h => h >= 5).length} / ${relief.rows.flat().length}`);
  // 勾配を積分した標高と、ならした標高（地面）の差
  let zr = 0, maxZ = 0, zAt = 0;
  for (let k = 0; k < el5.length; k++) {
    const s = k * step;
    zr = gradients.reduce((a, g) => a + (Math.min(s, g.to) - Math.min(s, g.from)) * g.permil / 1000, 0);
    const e = Math.abs(zr - (el5[k] - base));
    if (e > maxZ) { maxZ = e; zAt = s; }
  }
  console.log(`勾配から再構成した標高と地面の最大差 ${maxZ.toFixed(1)}m（営業キロ ${zAt}m 付近）。最大勾配 ${Math.max(...gradients.map(g => Math.abs(g.permil)))}‰`);
  const out = {
    source: '© OpenStreetMap contributors（ODbL 1.0）の線路の中心線、標高は国土地理院の標高API。簡略化した下書き（実測ではない）',
    chain: chain.id, generated: new Date().toISOString().slice(0, 10),
    note: 's は起点駅（0）からの営業キロ [m]。駅の stopS は s + 開始位置の規約（180）を路線データ側で足す。標高 z は泉佐野の地面からの差（地面。高架・築堤の高さは含まない）。',
    stations: chain.stations.map((s, i) => ({ name: s.name, s: Math.round(stS[i]), osmLatLon: inv(stPt[i]), groundZ: profile[Math.round(stS[i] / step)]?.z })),
    segments, structures, rivers, riverLines, jr, gradients, profile, relief,
    diagnostics: { osmLengthM: Math.round(osmLen), arcs: segments.filter(g => g.type === 'arc').length, minRadiusM: Math.round(minRadius), maxDeviationM: Math.round(maxDev) },
  };
  mkdirSync('src/data/geometry', { recursive: true });
  writeFileSync(outFile, JSON.stringify(out));
  console.log(`出力 ${outFile}: 線形 ${segments.length} 要素、構造物 ${structures.length}（トンネル ${structures.filter(s => s.kind === 'tunnel').length}、橋 ${structures.filter(s => s.kind === 'bridge').length}）、勾配 ${gradients.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
