// src/data/geometry/south.json（泉佐野を s=0 とする営業キロ）から、みさき公園〜和歌山港コースの線形・勾配・構造物を切り出して
// src/route/routes/misaki-wakayamako-geometry.ts に書く。ネットワーク不要。
// 実行: npm run geometry:misaki-wakayamako
// みさき公園の停止位置（south.json の s=17900。ゲームの stopS=180）が、新コースの s=180 になるよう s=17720 で切る。
// 切る位置はみさき公園のホーム（直線 17703.7〜17955.1）の中。以降の s・勾配・構造物はすべて -17720 ずらす。
// 終端（和歌山港 s=33000）の先は直線で TAIL [m] 延ばす。標高はみさき公園の地面を 0 とする（勾配を積分するだけ）。
import { readFileSync, writeFileSync } from 'node:fs';

const CUT = 17720, TAIL = 100;
type Seg = { type: 'straight'; length: number } | { type: 'arc'; radius: number; angle: number; turn: 'L' | 'R' };
interface South {
  relief: { step: number; lats: number[]; rows: number[][] };
  segments: Seg[];
  gradients: { from: number; to: number; permil: number }[];
  structures: { kind: 'bridge' | 'tunnel'; from: number; to: number }[];
  stations: { name: string; s: number }[];
}
const data = JSON.parse(readFileSync('src/data/geometry/south.json', 'utf8')) as South;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// 線形: 切る位置を含む要素は直線でなければならない（円弧を切ると向きが変わる）
const segs: Seg[] = [];
let s = 0, cutDone = false;
for (const g of data.segments) {
  const len = g.type === 'straight' ? g.length : g.radius * g.angle, end = s + len;
  if (!cutDone && end > CUT) {
    if (g.type !== 'straight') throw new Error(`切る位置 ${CUT} が円弧の中: ${s}〜${end}`);
    segs.push({ type: 'straight', length: r3(end - CUT) });
    cutDone = true;
  } else if (cutDone) segs.push(g);
  s = end;
}
const total = segs.reduce((a, g) => a + (g.type === 'straight' ? g.length : g.radius * g.angle), 0);
segs.push({ type: 'straight', length: TAIL });

const gradients = data.gradients.filter(g => g.to > CUT).map(g => ({ from: Math.max(g.from, CUT) - CUT, to: g.to - CUT, permil: g.permil }));
// 20〜40m の橋は描画の効果が小さいので入れない（作る側の指示）。範囲は south.json のまま（-CUT）
const structures = data.structures.filter(x => x.to > CUT && x.to - x.from > 40).map(x => ({ kind: x.kind, from: x.from - CUT, to: x.to - CUT }));
const dropped = data.structures.filter(x => x.to > CUT && x.to - x.from <= 40);
const stations = data.stations.filter(x => x.s >= 17900).map(x => ({ name: x.name, s: x.s - 17900 }));

// 周囲の山（south.json の relief）: 営業キロ CUT 以降の行を使い、s0 は最初の行の s（-CUT）
const k0 = Math.ceil(CUT / data.relief.step);
const relief = { s0: k0 * data.relief.step - CUT, step: data.relief.step, lats: data.relief.lats, rows: data.relief.rows.slice(k0) };
const lit = (x: unknown) => JSON.stringify(x).replace(/"([a-z]+)":/g, '$1: ').replace(/"([^"]+)":/g, '\'$1\': ').replace(/"/g, "'").replace(/,/g, ', ').replace(/\{/g, '{ ').replace(/\}/g, ' }');
const lines = (xs: unknown[]) => xs.map(x => `  ${lit(x)},`).join('\n');
writeFileSync('src/route/routes/misaki-wakayamako-geometry.ts', `// みさき公園〜和歌山港の線形・勾配・構造物（scripts/slice-south-geometry.ts が src/data/geometry/south.json から生成。手で直さない）
// 切り出し: south.json の s=${CUT}（みさき公園のホームの直線の中）を s=0 とし、和歌山港（south.json の s=33000）の先を直線で ${TAIL}m 延ばす。
// south.json は OpenStreetMap の線路の中心線（© OpenStreetMap contributors、ODbL 1.0）と国土地理院の標高から作った簡略化した下書きで、実測ではない。
import type { Gradient, Segment } from '../types';

/** 総延長（TAIL を除く）${total.toFixed(2)}m */
export const MW_SEGMENTS: Segment[] = [
${lines(segs)}
];

/** 勾配（みさき公園の地面を標高 0 とする。ホームの範囲は水平） */
export const MW_GRADIENTS: Gradient[] = [
${lines(gradients)}
];

/** トンネルと橋（40m を超えるもの）。south.json の構造物の範囲 -${CUT} */
export const MW_STRUCTURES: { kind: 'bridge' | 'tunnel'; from: number; to: number }[] = [
${lines(structures)}
];

/** 周囲の山（国土地理院の標高。線路の地面からの高さ [m]。線路から ±350m 以内は 0）。Route.relief */
export const MW_RELIEF: { s0: number; step: number; lats: number[]; rows: number[][] } = ${JSON.stringify(relief)};

/** みさき公園を 0 とした各駅の営業キロ [m]（south.json の駅の s - 17900） */
export const MW_DISTANCES: Record<string, number> = ${lit(Object.fromEntries(stations.map(x => [x.name, x.s])))};
`);
console.log(`線形 ${segs.length} 要素、総延長 ${total.toFixed(2)}m（+${TAIL}m）、勾配 ${gradients.length}、構造物 ${structures.length}、除いた短い構造物 ${dropped.length}: ${JSON.stringify(dropped)}`);
