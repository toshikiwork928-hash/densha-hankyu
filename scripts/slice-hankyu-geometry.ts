// src/data/geometry/hankyu-kobe.json（大阪梅田を s=0 とする営業キロ）から、2コース分の線形・勾配・構造物・川・周囲の山を切り出して
// src/route/routes/hankyu-kobe-geometry.ts に書く。ネットワーク不要。
// 実行: npm run geometry:hankyu-slice
// 各コースは始発駅の停止位置が s=PRE。始発駅の手前が足りない（大阪梅田）ときは直線を足す。終点の先は直線で TAIL [m] 延ばす。
// 切る位置は駅のホームの直線の中（route-geometry.ts がホームの範囲を直線にしている）。
import { readFileSync, writeFileSync } from 'node:fs';

type Seg = { type: 'straight'; length: number } | { type: 'arc'; radius: number; angle: number; turn: 'L' | 'R' };
interface Src {
  relief: { step: number; lats: number[]; rows: number[][] };
  segments: Seg[];
  gradients: { from: number; to: number; permil: number }[];
  structures: { kind: 'bridge' | 'tunnel'; from: number; to: number; name?: string }[];
  rivers: { name: string; s: number; type: string }[];
  riverLines: { name: string; type: string; pts: number[] }[];
  jr: [number, number][];
  stations: { name: string; s: number }[];
  profile: { s: number; z: number }[];
}
const data = JSON.parse(readFileSync('src/data/geometry/hankyu-kobe.json', 'utf8')) as Src;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const segLen = (g: Seg) => g.type === 'straight' ? g.length : g.radius * g.angle;

function slice(first: string, last: string, PRE: number, TAIL: number) {
  const sA = data.stations.find(x => x.name === first)!.s, sB = data.stations.find(x => x.name === last)!.s;
  const cut = sA - PRE, end = sB;
  const segs: Seg[] = [];
  if (cut < 0) segs.push({ type: 'straight', length: -cut });
  let s = 0;
  for (const g of data.segments) {
    const len = segLen(g), a = s, b = s + len; s = b;
    if (b <= Math.max(cut, 0) || a >= end) continue;
    const lo = Math.max(a, cut), hi = Math.min(b, end);
    if (lo === a && hi === b) { segs.push(g); continue; }
    if (g.type !== 'straight') {
      // 円弧の途中で切る（終点側はホームの直線の中のはずだが、念のため角度を比例で切る）
      segs.push({ ...g, angle: r3(g.angle * (hi - lo) / len) });
    } else segs.push({ type: 'straight', length: r3(hi - lo) });
  }
  segs.push({ type: 'straight', length: TAIL });
  const total = end - cut;
  const gradients = data.gradients.filter(g => g.to > cut && g.from < end).map(g => ({ from: Math.max(g.from, cut) - cut, to: Math.min(g.to, end) - cut, permil: g.permil }));
  const structures = data.structures.filter(x => x.to > cut && x.from < end && x.to - x.from > 20).map(x => ({ kind: x.kind, from: Math.max(x.from, cut) - cut, to: Math.min(x.to, end + TAIL) - cut, ...(x.name ? { name: x.name } : {}) }));
  const rivers = data.rivers.filter(r => r.s > cut && r.s < end + TAIL).map(r => ({ name: r.name, s: r.s - cut, type: r.type }));
  const k0 = Math.max(0, Math.ceil(cut / data.relief.step)), k1 = Math.min(data.relief.rows.length, Math.ceil((end + TAIL) / data.relief.step) + 1);
  const relief = { s0: k0 * data.relief.step - cut, step: data.relief.step, lats: data.relief.lats, rows: data.relief.rows.slice(k0, k1) };
  // 地面の標高（始発駅の地面を 0）
  const zA = data.profile.find(p => p.s >= sA)?.z ?? 0;
  const ground = data.profile.filter(p => p.s >= Math.max(cut, 0) && p.s <= end + TAIL).map(p => [p.s - cut, Math.round((p.z - zA) * 10) / 10]);
  const distances = Object.fromEntries(data.stations.filter(x => x.s >= sA && x.s <= sB).map(x => [x.name, x.s - sA]));
  // 川の水面（手作りの水面データ。OSM の川の中心線に幅を与えた帯）。大きな川は橋の長さの 6 割、ほかは川 12m・水路 8m・小川 4m
  const BIG = /^(淀川|神崎川|猪名川|旧猪名川|藻川|武庫川)$/;
  const water: [string, number[]][] = [];
  for (const rl of data.riverLines) {
    let w = rl.type === 'river' ? 12 : rl.type === 'canal' ? 8 : 4;
    if (BIG.test(rl.name)) {
      const near = rl.pts.findIndex((_, i) => i % 2 === 1 && Math.abs(rl.pts[i]) < 20);
      const sc = near >= 0 ? rl.pts[near - 1] : NaN;
      const br = data.structures.find(x => x.kind === 'bridge' && sc >= x.from - 20 && sc <= x.to + 20);
      if (br) w = Math.max(30, (br.to - br.from) * .6);
    }
    const P: [number, number][] = [];
    for (let i = 0; i < rl.pts.length; i += 2) P.push([rl.pts[i] - cut, rl.pts[i + 1]]);
    if (!P.some(([ps]) => ps > -300 && ps < end - cut + TAIL + 300)) continue;
    const L: number[] = [], R: number[] = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
      const ox = -dy / n * w / 2, oy = dx / n * w / 2;
      L.push(Math.round((P[i][0] + ox) * 10) / 10, Math.round((P[i][1] + oy) * 10) / 10);
      R.unshift(Math.round((P[i][0] - ox) * 10) / 10, Math.round((P[i][1] - oy) * 10) / 10);
    }
    // R は unshift で点の順が逆（[s, lat] の組は保つ）
    water.push(['water', [...L, ...R]]);
  }
  const jr = data.jr.filter(([q]) => q > cut && q < end + TAIL).map(([q, l]) => [q - cut, l]);
  return { jr, water, segs, total, gradients, structures, rivers, relief, ground, distances, pre: PRE, tail: TAIL };
}

const lit = (x: unknown) => JSON.stringify(x);
const out: string[] = [
  '// 阪急神戸線の線形・勾配・構造物・川（scripts/slice-hankyu-geometry.ts が src/data/geometry/hankyu-kobe.json から生成。手で直さない）',
  '// 元データは OpenStreetMap の線路の中心線（© OpenStreetMap contributors、ODbL 1.0）と国土地理院の標高から作った簡略化した下書きで、実測ではない。',
  "import type { Gradient, Segment } from '../types';",
  '',
  'export interface HankyuSection {',
  '  segments: Segment[]; gradients: Gradient[];',
  "  structures: { kind: 'bridge' | 'tunnel'; from: number; to: number; name?: string }[];",
  '  /** OSM の川（waterway）が線路を横切る位置 */',
  '  rivers: { name: string; s: number; type: string }[];',
  '  relief: { s0: number; step: number; lats: number[]; rows: number[][] };',
  '  /** 地面の標高 [s, z]（始発駅の地面 = 0） */',
  '  ground: [number, number][];',
  '  /** 始発駅を 0 とした各駅の営業キロ [m] */',
  '  distances: Record<string, number>;',
  '  /** 始発駅の停止位置の s（= 始発駅の手前の長さ）と、終点の停止位置の先の長さ [m] */',
  '  pre: number; tail: number;',
  '  /** 並走する JR の線路群の中心の横位置 [s, lat]（50m ごと。OSM の点の平均） */',
  '  jr: [number, number][];',
  '}',
];
// 大阪梅田は頭端式なので手前 180m（ゲームの規約）。西宮北口は待避線の分岐器が入るよう手前 500m。終点の先は待避線・分岐器が収まる 400m
for (const [id, a, b, pre] of [['EAST', '大阪梅田', '西宮北口', 180], ['WEST', '西宮北口', '神戸三宮', 500]] as const) {
  const x = slice(a, b, pre, 400);
  out.push('', `/** ${a}〜${b}。総延長（TAIL を除く）${x.total.toFixed(1)}m */`, `export const HK_${id}: HankyuSection = ${lit({ segments: x.segs, gradients: x.gradients, structures: x.structures, rivers: x.rivers, relief: x.relief, ground: x.ground, distances: x.distances, pre: x.pre, tail: x.tail, jr: x.jr })};`);
  const course = id === 'EAST' ? 'hankyu-kobe-east' : 'hankyu-kobe-west';
  writeFileSync(`src/data/osm/${course}.json`, JSON.stringify({ source: '© OpenStreetMap contributors（ODbL 1.0）の川の中心線に幅を与えた手作りの水面（建物・道路なし）', course, range: 320, fetched: '2026-10-13', buildings: [], roads: [], highways: [], areas: x.water, landmarks: [] }));
  console.log(`${a}〜${b}: 線形 ${x.segs.length}、勾配 ${x.gradients.length}、構造物 ${x.structures.length}、川 ${x.rivers.length}`);
}
writeFileSync('src/route/routes/hankyu-kobe-geometry.ts', out.join('\n') + '\n');
