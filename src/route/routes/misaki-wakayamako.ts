// 南海本線 みさき公園〜和歌山港の独立コース（6駅・15.1km）。泉佐野〜みさき公園は別の作業（泉佐野駅の作り直し後）で作る。
// 営業キロは泉佐野起点（南海公式の営業キロ）でみさき公園17.9、孝子22.3、和歌山大学前24.0、紀ノ川27.6、和歌山市30.2、和歌山港33.0km。
// 線形・勾配・トンネル・橋は src/data/geometry/south.json（OSM の線路の中心線と国土地理院の標高から作った簡略化した下書き。実測ではない）を
// scripts/slice-south-geometry.ts で切り出したもの（misaki-wakayamako-geometry.ts）。みさき公園の停止位置（south.json の s=17900）が s=180。
// 駅の形は配線略図.net 南海本線 figures/011_06〜011_08 と Wikipedia に基づく概形。
//   みさき公園: 盛土上・島式2面5線。custom 駅（島式2面 + 1番線・5番線の追加の線路 + 多奈川線の分岐）で表す。泉佐野〜みさき公園と共通の定義（misaki-park.ts）。
//   孝子・和歌山大学前・紀ノ川・和歌山市: 地上・相対式2面2線（和歌山市の2面5線は relative で近似）。
//   和歌山港: 築堤上・島式1面2線、終点。ゲーム用に、下りは2番線・上りは1番線に入る。
// 運行は普通と特急サザンだけ。景観は手続き生成のまばらな街並み（OSM の建物・道路データは作らない）、対向列車は置かない。
import type { Route, Sign, SpeedLimit, Station, StationIsland } from '../types';
import { reverseRoute } from '../reverse';
import { islandZone, loopZone, setDestinations } from '../service';
import { MWT, MWT_UP } from './misaki-wakayamako-timetable';
import { MW_DISTANCES, MW_GRADIENTS, MW_RELIEF, MW_SEGMENTS, MW_STRUCTURES } from './misaki-wakayamako-geometry';
import { addMisakiPark, setMisakiParkUp } from './misaki-park';
import { applyWakayama, applyWakayamaUp } from './misaki-wakayamako-wakayama';
import { applyDaigakumae } from './misaki-wakayamako-daigakumae';
import { MISAKI_WAKAYAMAKO_CROSSINGS } from './south-crossings';

/** 和歌山港の島式ホーム: 線路が左右へ 3.9m ずつ開き（線間 4+7.8=11.8m）、幅 8.4m のホーム。ホームの先で車止め（終点）。分岐器は両開き 60m。
 *  実際のホームの幅・線間は不明（ゲーム用の概形） */
const ISLAND: StationIsland = { spread: 3.9, length: 60 };
const names = [
  ['みさき公園', 'みさきこうえん'], ['孝子', 'きょうし'], ['和歌山大学前', 'わかやまだいがくまえ'],
  ['紀ノ川', 'きのかわ'], ['和歌山市', 'わかやまし'], ['和歌山港', 'わかやまこう'],
];
const LAST = names.length - 1;
const stations: Station[] = names.map(([name, kana], i) => {
  const stopS = 180 + MW_DISTANCES[name];
  return {
    name, kana, stopS, platform: { from: stopS - 180, to: stopS + 40, side: 'L' },
    scheduledArrival: i * 100, dwell: i && i < LAST ? 25 : undefined, stopMarkerCars: 6,
    ...(i === LAST ? { elevated: true, island: { ...ISLAND }, headEnd: true } : {}),
    ...(i > 0 && i < LAST ? { layout: 'relative' as const } : {}),
    // 駅舎の位置・ホーム間の連絡（Wikipedia「駅構造」）: 孝子は難波方面ホームのなんば寄りに駅舎、和歌山市方面ホームへは構内踏切。紀ノ川は1番ホーム（下り）側に駅舎、跨線橋
    ...(name === '孝子' ? { structure: { building: 'up' as const, end: 'namba' as const, link: 'crossing' as const } } : {}),
    ...(name === '紀ノ川' ? { structure: { building: 'down' as const, end: 'center' as const, link: 'footbridge' as const } } : {}),
  };
});

const approachSigns = (stopS: number): Sign[] => [
  ...[500, 200, 100, 50].map((d): Sign => ({ kind: 'distance', s: stopS - d, meters: d })),
  { kind: 'stopMarker', s: stopS - 20, cars: 4 }, { kind: 'stopMarker', s: stopS, cars: 6 }, { kind: 'stopMarker', s: stopS, cars: 8 },
];

/** 曲線制限（ゲーム用）。半径 R の円弧は 3.8√R km/h（カント＋カント不足量 170mm 相当）を 5 の倍数に切り下げ、線区最高速度（普通 90）に満たないものだけ置く。
 *  south.json の円弧は実際の曲線ではない（概形）ので、実際の制限速度とは一致しない */
const TRAIN_LEN = 120;
const curveKmh = (R: number) => Math.floor(3.8 * Math.sqrt(R) / 5) * 5;
const limits: SpeedLimit[] = (() => {
  const out: SpeedLimit[] = [];
  let s = 0;
  for (const g of MW_SEGMENTS) {
    const len = g.type === 'straight' ? g.length : g.radius * g.angle;
    if (g.type === 'arc' && curveKmh(g.radius) < 90) out.push({ from: Math.round(s), to: Math.round(s + len) + TRAIN_LEN, kmh: curveKmh(g.radius), label: '曲線制限' });
    s += len;
  }
  // 和歌山市〜和歌山港（和歌山港線）の最高速度は不明。ゲーム用の仮値 80km/h（和歌山市のホームの先から終端まで）
  const wakayamashi = stations[4];
  out.push({ from: wakayamashi.platform.to, to: 15400 + TRAIN_LEN, kmh: 80, label: '和歌山港線' });
  return out.sort((a, b) => a.from - b.from);
})();

// 踏切（OSM の位置。scripts/build-crossings.ts が作る）
const crossings = MISAKI_WAKAYAMAKO_CROSSINGS;
const nearCrossing = (s: number) => crossings.find(c => Math.abs(s - c.s) < 25);
/** 出発・場内信号と駅間の閉そく信号（izumisano.ts と同じ作り方。島式の和歌山港は S字区間の外に場内信号を置く）。踏切の上には置かない */
const signals: { id: string; s: number }[] = [];
for (let i = 0; i < stations.length; i++) {
  const sta = stations[i], z = loopZone(sta), iz = islandZone(sta);
  if (i > 0) signals.push({ id: `entry-${i}`, s: iz ? iz.inFrom - 60 : z ? z.inFrom - 60 : sta.platform.from - 150 });
  if (i < LAST) {
    const c = crossings.find(q => q.s > sta.platform.to && q.s < sta.stopS + 95);
    signals.push({ id: `departure-${i}`, s: z || iz ? sta.stopS + 65 : c ? Math.min(sta.stopS + 65, c.s - 20) : sta.stopS + 65 });
  }
  const next = stations[i + 1];
  if (next) {
    const from = z ? z.outTo + 60 : sta.platform.to + 160, nz = loopZone(next), niz = islandZone(next);
    const to = niz ? niz.inFrom - 200 : nz ? nz.inFrom - 100 : next.platform.from - 200;
    const n = Math.floor((to - from) / 600);
    for (let k = 1; k <= n; k++) {
      let s = Math.round(from + (to - from) * k / (n + 1));
      const c = nearCrossing(s);
      if (c) s = c.s - 30;
      signals.push({ id: `block-${i}-${k}`, s });
    }
  }
}
signals.sort((a, b) => a.s - b.s);

// 山あいの区間: みさき公園の先〜和歌山大学前の手前、和歌山大学前の先〜紀ノ川の手前（トンネル2本の前後。70km/h制限のあたりから山。ユーザー指摘 2026-10-10）
const MOUNTAIN = [
  { from: stations[0].stopS + 250, to: stations[2].stopS - 450 },
  { from: stations[2].stopS + 700, to: stations[3].stopS - 1380 },
];
export const misakiWakayamako: Route = {
  id: 'misaki-wakayamako', lineId: 'shiokaze', theme: 'coast', name: '南海本線 みさき公園 → 和歌山港',
  lineLimit: 90, startS: 180, startClock: 10 * 3600, trainLength: TRAIN_LEN,
  segments: MW_SEGMENTS,
  // 標高はみさき公園の地面が 0。地面が線路の高さに沿って上下する（terrain.ts の groundFollowsTrack）
  elevation0: 0, groundFollowsTrack: true,
  gradients: MW_GRADIENTS,
  limits,
  stations,
  services: [
    { id: 'local', name: '普通', cars: 4, units: [4], kind: 'commuter-new', kindOptions: ['commuter-new', 'commuter-old', 'commuter-1000'], formationOptions: [[4], [4, 2], [6]], lineLimit: 90, stops: [0, 1, 2, 3, 4, 5], timetable: MWT.local, trackNames: { 5: '2番線' } },
    // 急行（ラッシュ時の運転。停車駅はみさき公園、和歌山大学前、和歌山市、和歌山港でサザンと同じ。docs/south-timetable-research.md 3章。実際は和歌山港まで行く急行は一部）
    { id: 'express', name: '急行', cars: 6, units: [4, 2], kind: 'commuter-old', kindOptions: ['commuter-old', 'commuter-new', 'commuter-1000', 'commuter-9000'], formationOptions: [[4, 2], [4, 4], [6]], lineLimit: 110, stops: [0, 2, 4, 5], timetable: MWT.express, trackNames: { 5: '2番線' } },
    { id: 'southern', name: '特急サザン', cars: 8, units: [4, 4], kind: 'southern-10000', unitKinds: ['southern-10000', 'commuter-old'], lineLimit: 110, stops: [0, 2, 4, 5], timetable: MWT.southern, trackNames: { 5: '2番線' } },
  ],
  // 途中に待避駅が無いので、先行の普通はサザン・急行に追いつかれない間隔で先に出す（普通の時刻表を実際の所要時間に合わせて長くしたので、従来の 330 から広げた）
  precedingHeadway: { express: 440, southern: 440 },
  prevName: '淡輪', nextName: '', signs: stations.slice(1).flatMap(st => approachSigns(st.stopS)),
  extent: { from: -400, to: 15355 }, tracks: [0, 4],
  // 孝子〜和歌山大学前は山あいで市街地にしない。和歌山市の周辺（紀ノ川橋梁の先から和歌山市の先まで）を市街地にする
  scenery: { cityZones: [{ from: 11700, to: 13300 }] },
  // 対向列車は実ダイヤの時刻付き共通運行（data/oncoming-timetable.json）。和歌山港線（単線）内の対向列車は出さない（scripts/oncoming-meets.ts が和歌山市より先の点を落とす）
  oncoming: [], signals, crossings,
  // トンネル3本は south.json の OSM のトンネル（第一孝子越隧道・第二貴志隧道・第三貴志隧道に数が一致、どれがどれかは未確認）。橋は紀ノ川橋梁（推定）と小さな橋1つ。
  // 最後の south.json の橋（32645〜32868、223m）は和歌山港のホーム（32820〜）と重なるため、川の橋でなく築堤・高架の取り付きと判断して viaduct にした（実際は不明）
  structures: [
    ...MW_STRUCTURES.filter(x => !(x.kind === 'bridge' && x.from === 14925)),
    { kind: 'viaduct', from: 14925, to: 15365 },
  ],
  relief: MW_RELIEF, // 周囲の山（国土地理院の標高）
  // みさき公園〜和歌山大学前は、ほぼ山あいで建物がほとんど無い（ユーザー指摘）。線路際まで山を広げ、OSM に無い所へ家を補わない。駅の前後 250m は除く
  reliefNear: MOUNTAIN, noInfill: MOUNTAIN,
  // 切土の擁壁（実際の運転席からの画像: 和歌山大学前の手前の右側（上りの向き）の壁、みさき公園の手前の切土、トンネル坑口の前後の切通し）
  cuttings: [
    { from: 6340, to: 6920, side: -1, height: 4.5 },
    { from: 240, to: 640, side: 1, height: 5 },
    ...[[4929, 5009], [5698, 5778], [7554, 7634], [7710, 7767], [7885, 7965]].flatMap(([a, b]) => [{ from: a, to: b, side: -1 as const, height: 4 }, { from: a, to: b, side: 1 as const, height: 4 }]),
  ],
  // 築堤・高架の高さ [m]（和歌山港。ゲーム用の仮値）。紀ノ川橋梁の下の水面は手作りのデータ（loadOsmFor。src/data/osm/misaki-wakayamako.json）
  viaductHeight: 6,
  // 終点・和歌山港は低速進入の ATS を有効にする（頭端式の終着駅。上りは終着が途中駅なので下で無効にする）
  terminalApproach: true,
  // 普通の通しは和歌山市まで（和歌山市〜和歌山港は区間だけ選べる）。急行・サザンは通し（和歌山港まで）のほかに和歌山市を終点にする区間も選べる。上りへは引き継がない
  partialGoals: [
    { from: 0, to: stations.findIndex(s => s.name === '和歌山市'), services: ['local'], asAll: true },
    { from: 0, to: stations.findIndex(s => s.name === '和歌山市'), services: ['express', 'southern'] },
  ],
};
// 行先: 普通は和歌山市（和歌山市〜和歌山港の区間だけ和歌山港）、急行・サザンは和歌山港（和歌山市までの区間を選んだときは和歌山市）。ユーザー指示 2026-10-10
for (const v of misakiWakayamako.services!) {
  const local = v.id === 'local';
  v.destination = local ? '和歌山市' : '和歌山港'; v.destinationKana = local ? 'わかやまし' : 'わかやまこう';
  v.destinationByEnd = local ? { 和歌山港: ['和歌山港', 'わかやまこう'] } : { 和歌山市: ['和歌山市', 'わかやまし'] };
}
misakiWakayamako.wakayamaDest = { local: ['和歌山市', 'わかやまし'] };
// みさき公園（始発）: 盛土上の島式2面5線（custom 駅）。下りは普通が1番線(T1)、サザンが2番線(T2)から発車する。多奈川線(5番線・T5)と分岐も描く。定義は misaki-park.ts（泉佐野〜みさき公園と共通）
addMisakiPark(misakiWakayamako, 0, false);
// 和歌山側の景観・配線（紀ノ川橋梁・加太線の分岐・和歌山市駅・和歌山港線の単線）。reverseRoute より前に足す
applyWakayama(misakiWakayamako);
// 和歌山大学前（橋上駅舎・駅ビル・イオンモール和歌山へのデッキ・西口・マンション・斜面）。景観を置かない範囲。描画は world/wakayamadaigakumae.ts
applyDaigakumae(misakiWakayamako);

export const misakiWakayamakoUp: Route = reverseRoute(misakiWakayamako, {
  id: 'misaki-wakayamako-up', name: '南海本線 和歌山港 → みさき公園', timetable: MWT_UP, signs: approachSigns,
});
misakiWakayamakoUp.terminalApproach = false; // みさき公園は終着だが頭端式でない（終着 ATS は無効）
// 和歌山市発: 普通の通しは和歌山市始発（和歌山港〜和歌山市は区間だけ選べる）。急行・サザンは通し（和歌山港始発）のほかに和歌山市始発の区間も選べる
{
  const wk = misakiWakayamakoUp.stations.findIndex(s => s.name === '和歌山市'), last = misakiWakayamakoUp.stations.length - 1;
  misakiWakayamakoUp.partialGoals = [
    { from: wk, to: last, services: ['local'], asAll: true },
    { from: wk, to: last, services: ['express', 'southern'] },
  ];
}
for (const v of misakiWakayamakoUp.services!) {
  // 和歌山港は上りの始発。島式の線のうち、ゲームの自線（進行方向の左）は物理的に下りの反対側の1番線
  v.trackNames = { 0: '1番線' };
  if (v.id === 'southern') { v.kind = 'commuter-old'; v.unitKinds = ['commuter-old', 'southern-10000']; }
}
setDestinations(misakiWakayamakoUp.services!, 'namba');
// みさき公園（上りの終着）: 上り本線(T3)の3番線に着く（普通・サザンとも）
setMisakiParkUp(misakiWakayamakoUp, misakiWakayamakoUp.stations.length - 1);
applyWakayamaUp(misakiWakayamakoUp);
