// 泉佐野以南2コースの踏切データ src/route/routes/south-crossings.ts を作る。
// 入力: `npm run osm:scenery -- --course=<id> --crossings` が書く node_modules/.cache/osm/<id>.crossings.json（OSM の踏切の位置 s と道路の種類）。
// ここで、ゲームの線路に置けない踏切（駅のホーム、高架・トンネル・橋、留置線・待避線・分岐の区間）を除き、ホーム端に近いものは端の先へ寄せる。
// 実行: npm run crossings:south
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { izumisanoMisaki } from '../src/route/routes/izumisano-misaki';
import { misakiWakayamako } from '../src/route/routes/misaki-wakayamako';
import { loopZone } from '../src/route/service';
import type { Route } from '../src/route/types';

interface Row { s: number; d: number; kind: string; hw: string; w: number; name: string; node: number }
interface Out { id: string; s: number; roadWidth: number; foot?: true }

function build(courseId: string, route: Route, prefix: string): { list: Out[]; log: string[] } {
  const file = `node_modules/.cache/osm/${courseId}.crossings.json`;
  if (!existsSync(file)) throw new Error(`${file} が無い。先に npm run osm:scenery -- --course=${courseId} --crossings を実行する`);
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
  const log: string[] = [];
  // 停車した列車（最長 8両 160m）の下になる範囲。下りは先頭が stopS（後ろへ 165m）、上りは同じホームを反対向きに使うので、
  // ホームの端どうしを写した範囲（reverseRoute と同じ: stopS' = from + to - stopS）も加える
  const stops = route.stations.map(s => ({ name: s.name, lo: Math.min(s.stopS - 165, s.platform.from + s.platform.to - s.stopS - 6), hi: Math.max(s.stopS + 6, s.platform.from + s.platform.to - s.stopS + 165) }));
  const structures = (route.structures ?? []).map(x => ({ from: x.from, to: x.to, kind: x.kind }));
  const extras = (route.extraTracks ?? []).map(x => ({ id: x.id, from: x.from, to: x.to }));
  const road = rows.filter(r => r.kind === 'level_crossing' && r.w >= 3);
  const out: Out[] = [];
  for (const r of rows) {
    const foot = r.kind === 'crossing' || r.w < 3;
    let s = r.s;
    const why = (m: string) => log.push(`除外 s=${r.s} ${r.hw} ${m}`);
    if (s < route.extent.from + 30 || s > route.extent.to - 30) { why('コースの端'); continue; }
    // 歩行者だけの踏切は、道路の踏切のすぐ横（20m以内）にあれば省く
    if (foot && road.some(q => Math.abs(q.s - s) < 20)) { why('道路の踏切の横の歩行者踏切'); continue; }
    const st = structures.find(x => s > x.from - 6 && s < x.to + 6);
    if (st) { why(`${st.kind}の区間`); continue; }
    const ex = extras.find(x => s > x.from - 12 && s < x.to + 12);
    if (ex) { why(`線路の増える区間（${ex.id}）`); continue; }
    // 待避線のある駅（尾崎・みさき公園）の、分岐器の区間（入口分岐器〜出口分岐器 + 余裕）
    const lz = route.stations.map(x => ({ n: x.name, z: loopZone(x) })).find(x => x.z && s > x.z.inFrom - 20 && s < x.z.outTo + 20);
    if (lz) { why(`${lz.n}の待避線の区間`); continue; }
    // 停車した列車の下に当たるものは、近い端へ寄せる。寄せる量が 45m を超えるものは、
    // OSM の道路と離れすぎるので置かない（道路は線路の手前で切れたまま）
    const half = foot ? 1.5 : r.w / 2;
    const p = stops.find(x => s > x.lo - half && s < x.hi + half);
    if (p) {
      const ahead = p.hi + half + 2, behind = p.lo - half - 2;
      const to = Math.abs(ahead - s) <= Math.abs(s - behind) ? ahead : behind;
      if (Math.abs(to - s) > 45) { why(`${p.name}の停車位置の下（寄せる量 ${Math.round(Math.abs(to - s))}m）`); continue; }
      log.push(`移動 ${r.s} → ${Math.round(to)}（${p.name}の停車位置）`);
      s = to;
    }
    out.push({ id: `${prefix}${Math.round(s)}`, s: Math.round(s), roadWidth: foot ? 3 : Math.max(4, Math.min(8, r.w)), ...(foot ? { foot: true as const } : {}) });
  }
  // 構内踏切（Station.structure.link = crossing）: 駅舎のあるホームの端の先に歩行者踏切を置く（孝子・吉見ノ里）
  for (const st of route.stations) {
    if (st.structure?.link !== 'crossing') continue;
    const s = Math.round(st.structure.end === 'namba' ? st.platform.from - 6 : st.platform.to + 6);
    out.push({ id: `${prefix}uchi${s}`, s, roadWidth: 3, foot: true });
    log.push(`構内踏切 ${st.name} s=${s}`);
  }
  // 寄せた結果、他の踏切と重なるものは省く
  out.sort((a, b) => a.s - b.s);
  const res: Out[] = [];
  for (const c of out) {
    const l = res[res.length - 1];
    if (l && c.s - l.s < (l.roadWidth + c.roadWidth) / 2 + 6) { log.push(`除外 s=${c.s} 重なり（${l.id}）`); continue; }
    res.push(c);
  }
  return { list: res, log };
}

const a = build('izumisano-misaki', izumisanoMisaki, 'iz');
const b = build('misaki-wakayamako', misakiWakayamako, 'mw');
const fmt = (name: string, list: Out[]) => `export const ${name}: SouthCrossing[] = [\n${list.map(c => `  { id: '${c.id}', s: ${c.s}, roadWidth: ${c.roadWidth}${c.foot ? ', foot: true' : ''} },`).join('\n')}\n];\n`;
const text = `// 泉佐野以南2コースの踏切（下りの向きの s）。scripts/build-crossings.ts が OSM の踏切位置から作る（手で直さない）。
// 出典: © OpenStreetMap contributors（ODbL 1.0）の railway=level_crossing / crossing。道路の幅は道路の種類・車線数からの概算。
export type SouthCrossing = { id: string; s: number; roadWidth: number; foot?: true };
${fmt('IZUMISANO_MISAKI_CROSSINGS', a.list)}${fmt('MISAKI_WAKAYAMAKO_CROSSINGS', b.list)}`;
writeFileSync('src/route/routes/south-crossings.ts', text);
console.log(`泉佐野〜みさき公園 ${a.list.length} か所（道路 ${a.list.filter(c => !c.foot).length}、歩行者 ${a.list.filter(c => c.foot).length}）`);
a.log.forEach(l => console.log('  ' + l));
console.log(`みさき公園〜和歌山港 ${b.list.length} か所（道路 ${b.list.filter(c => !c.foot).length}、歩行者 ${b.list.filter(c => c.foot).length}）`);
b.log.forEach(l => console.log('  ' + l));
