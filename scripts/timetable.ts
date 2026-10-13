// 時刻表の生成: 種別ごとに自動運転（最速走行）で各駅の到着・通過時刻を求め、+5% を 5 秒単位に切り上げる
// 実行: npm run timetable（src/route/routes/shiokaze-timetable.ts・mountain-timetable.ts を書き換える）
// 山岳線（単線）は先の下り勾配の分だけ計画減速度を下げる（抑速ブレーキなしで制限を守る運転）。上り勾配では車両性能で遅くなる
import { readFileSync, writeFileSync } from 'node:fs';
import { shiokaze, shiokazeUp } from '../src/route/routes/shiokaze';
import { kishiwada, kishiwadaUp } from '../src/route/routes/kishiwada';
import { izumisano, izumisanoUp } from '../src/route/routes/izumisano';
import { izumisanoMisaki, izumisanoMisakiUp } from '../src/route/routes/izumisano-misaki';
import { through, throughUp } from '../src/route/routes/through';
import { namba, nambaUp } from '../src/route/routes/namba';
import { misakiWakayamako, misakiWakayamakoUp } from '../src/route/routes/misaki-wakayamako';
import { mountain, mountainUp } from '../src/route/routes/mountain';
import { meetDwell } from '../src/game/meet';
import { waitDwell, waitsAt } from '../src/game/overtake';
import { terminalSpeedLimit } from '../src/game/terminal-ats';
import { applyService } from '../src/route/service';
import { buildTrack } from '../src/route/track';
import type { Route, ServiceId } from '../src/route/types';
import { TRAIN_PERF, stepTrain, type TrainState } from '../src/sim/train';

/** 停車時間 [s]（普通の待避駅は優等列車の到着・通過待ち込み。game/overtake.ts の運動計画から求める） */
const DWELL = 25;
const MARGIN = 1.05, DT = 1 / 30;

function run(route: Route, id: ServiceId) {
  const svc = applyService(route, id)!;
  const track = buildTrack(route), perf = TRAIN_PERF[svc.kind];
  const env = { adhesion: 1, gradePermil: 0, perf };
  const plan0 = perf.bMax * .62; // 計画減速度（B5 相当）
  const tr: TrainState = { s: route.startS, v: 0, acc: 0, notch: 0 };
  // 始発駅で待つ（朝の堺1番線で急行を待ち合わせなど）: 待避の停車時間だけ遅れて発車
  const w0 = waitsAt(route, svc, 0), dwell0 = w0.length ? waitDwell(route, 0, w0, svc.cars) : 0;
  const out: Record<number, { arr: number; dep?: number }> = { 0: { arr: 0, dep: dwell0 } };
  let t = dwell0;
  const stops = svc.stops.slice(1);
  let si = 0;
  for (let i = 1; i < route.stations.length; i++) {
    const sta = route.stations[i], stop = svc.stops.includes(i);
    // 次の停車位置まで（通過駅は通過時刻を記録）
    for (; ;) {
      const target = route.stations[stops[si]].stopS;
      // 先の制限・停車位置に対する許容速度
      const vNow = tr.v;
      let plan = plan0;
      if (route.singleTrack) {
        let g = 0;
        for (let d = 0; d < 800; d += 20) g = Math.min(g, track.gradeAt(tr.s + d));
        plan = Math.max(.2, perf.bMax * .75 - 9.81 * -g / 1000);
      }
      let vAllow = Math.min(track.limitAt(tr.s), terminalSpeedLimit(route, stops[si], tr.s)) / 3.6;
      for (let d = 5; d < 2500; d += 5) {
        const q = tr.s + d;
        const lim = q >= target ? 0 : Math.min(track.limitAt(q), terminalSpeedLimit(route, stops[si], q)) / 3.6;
        vAllow = Math.min(vAllow, Math.sqrt(lim * lim + 2 * plan * Math.max(0, (q >= target ? target - tr.s : d) - 1)));
        if (q >= target) break;
      }
      if (vNow > vAllow + .05) tr.notch = -Math.min(8, Math.max(1, Math.ceil((vNow - vAllow) * 8 + 4)));
      else if (vNow > vAllow - .6) tr.notch = 0;
      else tr.notch = 5;
      env.gradePermil = track.gradeAt(tr.s);
      const before = tr.s;
      stepTrain(tr, env, DT); t += DT;
      if (!stop && before < sta.stopS && tr.s >= sta.stopS) { out[i] = { arr: Math.round(t) }; break; }
      if (stop && (tr.v < .05 && target - tr.s < 1.5 || tr.s >= target)) { tr.v = 0; tr.acc = 0; tr.s = target; break; }
      if (t > 3000) throw new Error(`timeout ${id} @${tr.s}`);
    }
    if (stop) {
      si++;
      const last = i === route.stations.length - 1;
      const ws = waitsAt(route, svc, i), w = ws.length > 0;
      const meet = route.meets?.some(m => m.station === i);
      const dwell = meet ? meetDwell() : !w ? DWELL : waitDwell(route, i, ws, svc.cars);
      out[i] = last ? { arr: t } : { arr: t, dep: t + dwell };
      if (!last) t += dwell;
    }
  }
  return out;
}

const up = (x: number) => Math.ceil(x * MARGIN / 5) * 5;

/** 実際の時刻表に近づけるための下限（泉佐野以南の4コースだけ）。始発の発車からの秒で、停車駅（駅 index）ごとに
 *  'dep' = 発車の下限（途中駅）、'arr' = 到着の下限（終着、または和歌山市のように直前の列車が着く時刻が分かる駅）。
 *  値は鉄道運用Hub の平日時刻表（改正 2024-12-21）の、各駅の発車時刻の始発からの差の中央値（全時間帯。分単位の時刻なので ±30 秒の誤差）。
 *  終着は「実際の発車時刻 − ゲームの停車時間 25 秒」。和歌山港線は線内の普通・直通列車の所要から。出典・求め方は docs/south-timetable-research.md 7章と spec-south-courses.md 15章。
 *  localWait（普通が尾崎で優等列車を待つ時間帯）は、尾崎の到着を待ちなしの時刻にし、以降の発車は実際の値から、ゲームの待ち時間が実際より短い分（下り 約104秒、上り 約164秒。
 *  ゲームの待避は game/overtake.ts の運動計画で決まり、実際の待ち時間（下り 約3分、上り 約4分）より短い）を引いた値にする。
 *  自動運転の最速走行 + 5% より短い値は無視する（最速走行より速い時刻表にしない）。 */
type Floor = Record<number, ['dep' | 'arr', number]>;
const REAL_FLOORS: Record<string, { local?: Floor; localWait?: Floor; express?: Floor; southern?: Floor }> = {
  // 泉佐野 0、羽倉崎 1、吉見ノ里 2、岡田浦 3、樽井 4、尾崎 5、鳥取ノ荘 6、箱作 7、淡輪 8、みさき公園 9
  'izumisano-misaki': {
    local: { 1: ['dep', 180], 2: ['dep', 300], 3: ['dep', 420], 4: ['dep', 540], 5: ['dep', 780], 6: ['dep', 900], 7: ['dep', 1020], 8: ['dep', 1260], 9: ['arr', 1355] },
    localWait: { 1: ['dep', 180], 2: ['dep', 300], 3: ['dep', 420], 4: ['dep', 540], 5: ['arr', 755], 6: ['dep', 975], 7: ['dep', 1155], 8: ['dep', 1395], 9: ['arr', 1490] },
    express: { 5: ['dep', 480], 9: ['arr', 935] },
    southern: { 5: ['dep', 480], 9: ['arr', 935] },
  },
  // みさき公園 0、淡輪 1、箱作 2、鳥取ノ荘 3、尾崎 4、樽井 5、岡田浦 6、吉見ノ里 7、羽倉崎 8、泉佐野 9。泉佐野の到着は、羽倉崎の発車 + 下りの羽倉崎〜泉佐野の所要（約 160 秒）
  'izumisano-misaki-up': {
    local: { 1: ['dep', 120], 2: ['dep', 360], 3: ['dep', 540], 4: ['dep', 660], 5: ['dep', 840], 6: ['dep', 1020], 7: ['dep', 1140], 8: ['dep', 1260], 9: ['arr', 1420] },
    localWait: { 1: ['dep', 120], 2: ['dep', 360], 3: ['dep', 540], 4: ['arr', 635], 5: ['dep', 915], 6: ['dep', 1035], 7: ['dep', 1215], 8: ['dep', 1335], 9: ['arr', 1495] },
    express: { 4: ['dep', 480], 9: ['arr', 890] },
    southern: { 4: ['dep', 480], 9: ['arr', 890] },
  },
  // みさき公園 0、孝子 1、和歌山大学前 2、紀ノ川 3、和歌山市 4、和歌山港 5。普通の和歌山港は、和歌山市の発車（到着 + 25 秒）+ 線内の普通の所要 240 秒
  'misaki-wakayamako': {
    local: { 1: ['dep', 360], 2: ['dep', 480], 3: ['dep', 720], 4: ['arr', 900], 5: ['arr', 1165] },
    express: { 2: ['dep', 420], 4: ['arr', 780], 5: ['arr', 1140] },
    southern: { 2: ['dep', 420], 4: ['arr', 780], 5: ['arr', 1140] },
  },
  // 和歌山港 0、和歌山市 1、紀ノ川 2、和歌山大学前 3、孝子 4、みさき公園 5。普通の和歌山市の到着は線内の普通の所要 300 秒、サザン・急行の和歌山市の発車は 420 秒
  'misaki-wakayamako-up': {
    local: { 1: ['arr', 300], 2: ['dep', 505], 3: ['dep', 805], 4: ['dep', 925], 5: ['arr', 1200] },
    express: { 1: ['dep', 420], 3: ['dep', 780], 5: ['arr', 1175] },
    southern: { 1: ['dep', 420], 3: ['dep', 780], 5: ['arr', 1175] },
  },
};
/** 実際の停車が30秒以内の途中駅。REAL_FLOORS の下限を当てない（実ダイヤの動画で和歌山大学前は着・発とも同じ分の表示。ユーザー指摘 2026-10-10）。
 *  ゲーム内の停車は時刻表の 25 秒だが、下限でずらすと最速の自動運転が定時より約20秒早く着き、約45秒待つことになっていた */
const SHORT_STOPS: Record<string, string[]> = {
  'misaki-wakayamako': ['孝子', '和歌山大学前', '紀ノ川'],
  'misaki-wakayamako-up': ['孝子', '和歌山大学前', '紀ノ川'],
};
function floorsOf(route: Route, id: ServiceId): Floor | undefined {
  const f = REAL_FLOORS[route.id];
  if (!f || (id !== 'local' && id !== 'express' && id !== 'southern')) return undefined;
  const svc = route.services?.find(v => v.id === id);
  // 普通が尾崎で優等列車を待つ時間帯（待ちありの実際の時刻に合わせる）
  if (id === 'local' && f.localWait && svc?.waits?.some(w => route.stations[w.station].name === '尾崎')) return f.localWait;
  return f[id];
}

function table(route: Route): Record<string, string> {
  const res: Record<string, string> = {};
  for (const id of (route.services ?? []).map(v => v.id)) res[id] = tableOf(route, id, true);
  return res;
}
/** 1種別の時刻表（ソースの文字列） */
function tableOf(route: Route, id: ServiceId, log = false): string {
  {
    const raw = run(route, id);
    const floors = floorsOf(route, id);
    // 実ダイヤに合わせて後ろへずらす量は、1駅につき最大 CAP 秒まで。ゲームの列車は実際より速く走れるので、実際の所要時間のままにすると、
    // 速く運転した人が途中駅で定時発車まで長く待たされる（夕方の急行の尾崎で約80秒）。尾崎で優等列車を待つ普通（localWait）の待ちは実際どおり
    const CAP = floors && floors === REAL_FLOORS[route.id]?.localWait ? Infinity : 15;
    // 駅間の走行時間に余裕を足し、停車時間はそのまま
    let prevRaw = 0, prevOut = 0;
    const tt: string[] = [];
    for (const k of Object.keys(raw).map(Number).sort((a, b) => a - b)) {
      const r = raw[k];
      let arr = k === 0 ? 0 : prevOut + up(r.arr - prevRaw);
      let dep = r.dep != null ? arr + (r.dep - r.arr) : undefined;
      // 実際の時刻表より早い分は後ろへずらす（以降の駅間の走行時間は保つ）。実際の停車が短い途中駅（SHORT_STOPS）はずらさず、
      // 速く運転した人でも停車を約25秒に近づける（ずらす分は後続の駅の到着側の下限に回る）
      const f = SHORT_STOPS[route.id]?.includes(route.stations[k].name) ? undefined : floors?.[k];
      if (f) {
        if (f[0] === 'arr' && arr < f[1]) { const d = Math.min(CAP, f[1] - arr); arr += d; if (dep != null) dep += d; }
        else if (f[0] === 'dep' && dep != null && dep < f[1]) { const d = Math.min(CAP, f[1] - dep); dep += d; arr += d; }
      }
      tt.push(`${k}: { arr: ${arr}${dep != null ? `, dep: ${dep}` : ''} }`);
      prevRaw = r.dep ?? r.arr; prevOut = dep ?? arr;
      if (log) console.log(route.id, id, k, route.stations[k].name, r.arr.toFixed(1), '→', arr, dep ?? '');
    }
    return `{ ${tt.join(', ')} }`;
  }
}

const kishiwadaThroughExpressOnly = process.argv.includes('--kishiwada-through-express-only');
if (kishiwadaThroughExpressOnly) {
  const replaceExpressLines = (path: string, lines: [string, string]) => {
    const source = readFileSync(path, 'utf8');
    let index = 0;
    const replaced = source.replace(/^  express: .*,$/gm, () => `  express: ${lines[index++]},`);
    if (index !== 2) throw new Error(`${path}: expected 2 express lines, found ${index}`);
    writeFileSync(path, replaced);
  };
  replaceExpressLines('src/route/routes/kishiwada-timetable.ts', [
    tableOf(kishiwada, 'express'), tableOf(kishiwadaUp, 'express'),
  ]);
  replaceExpressLines('src/route/routes/through-timetable.ts', [
    tableOf(throughUp, 'express'), tableOf(through, 'express'),
  ]);
  process.exit(0);
}

/** 泉佐野〜みさき公園の時間帯ごとの普通の時刻表（尾崎の待ち合わせの待ち時間込み）。既存コースの local-timetables.ts には触らない */
function writeSouthLocal(): void {
  const lines: string[] = [];
  for (const route of [izumisanoMisaki, izumisanoMisakiUp]) {
    const local = route.services?.find(v => v.id === 'local');
    if (!local?.waitsByTime) continue;
    const byTod: string[] = [];
    for (const tod of ['morning', 'noon', 'evening', 'night'] as const) {
      route.timeOfDay = tod;
      local.timetableByTime = undefined; // 生成中は基準の時刻表から
      byTod.push(`${tod}: ${tableOf(route, 'local')}`);
    }
    route.timeOfDay = undefined;
    lines.push(`  '${route.id}': {\n    ${byTod.join(',\n    ')},\n  },`);
  }
  writeFileSync('src/route/routes/south-local-timetables.ts', `// 泉佐野以南の2コースの、時間帯ごとの普通の時刻表（尾崎の緩急接続の待ち時間込み。scripts/timetable.ts --south-only が生成。手で直さない）
import type { ServiceSpec, TimeOfDay } from '../types';

export const SOUTH_LOCAL_TT: Record<string, Partial<Record<TimeOfDay, ServiceSpec['timetable']>>> = {
${lines.join('\n')}
};
`);
}

// --south-only は泉佐野以南のコースだけ更新
if (process.argv.includes('--south-only')) {
  const dn = table(izumisanoMisaki), up = table(izumisanoMisakiUp);
  const body = (r: Record<string, string>) => `{ local: ${r.local}, express: ${r.express}, southern: ${r.southern} }`;
  writeFileSync('src/route/routes/izumisano-misaki-timetable.ts', `// 南海本線 泉佐野〜みさき公園の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'southern';
export const SM: Record<Id, ServiceSpec['timetable']> = ${body(dn)};
export const SM_UP: Record<Id, ServiceSpec['timetable']> = ${body(up)};
`);
  writeSouthLocal();
  process.exit(0);
}
/** 南海本線 みさき公園〜和歌山港（普通・特急サザン）。ほかのコースの時刻表には触らない */
function writeMisakiWakayamako(): void {
  const dn = table(misakiWakayamako), up = table(misakiWakayamakoUp);
  const body = (r: Record<string, string>) => `{ local: ${r.local}, express: ${r.express}, southern: ${r.southern} }`;
  writeFileSync('src/route/routes/misaki-wakayamako-timetable.ts', `// 南海本線 みさき公園〜和歌山港の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'southern';
/** 下り（みさき公園 → 和歌山港） */
export const MWT: Record<Id, ServiceSpec['timetable']> = ${body(dn)};
/** 上り（和歌山港 → みさき公園） */
export const MWT_UP: Record<Id, ServiceSpec['timetable']> = ${body(up)};
`);
}
if (process.argv.includes('--misaki-wakayamako-only')) { writeMisakiWakayamako(); process.exit(0); }

const izumisanoOnly = process.argv.includes('--izumisano-only');
if (izumisanoOnly) {
  const dn = table(izumisano), up = table(izumisanoUp);
  const body = (r: Record<string, string>) => `{
  local: ${r.local}, express: ${r.express}, airport: ${r.airport}, limited: ${r.limited}, southern: ${r.southern},
}`;
  writeFileSync('src/route/routes/izumisano-timetable.ts', `// 南海本線 岸和田〜泉佐野の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
export const IT: Record<Id, ServiceSpec['timetable']> = ${body(dn)};
export const IT_UP: Record<Id, ServiceSpec['timetable']> = ${body(up)};
`);
  process.exit(0);
}
// 時間帯ごとの普通の時刻表（待避で停車時間が変わる）。全コースの普通（時間帯のパターンを持つもの）
{
  const lines: string[] = [];
  for (const route of [shiokaze, shiokazeUp, kishiwadaUp, izumisano, izumisanoUp, throughUp, through, namba, nambaUp]) {
    const local = route.services?.find(v => v.id === 'local');
    if (!local?.waitsByTime) continue;
    const byTod: string[] = [];
    for (const tod of ['morning', 'noon', 'evening', 'night'] as const) {
      route.timeOfDay = tod;
      local.timetableByTime = undefined; // 生成中は基準の時刻表から
      byTod.push(`${tod}: ${tableOf(route, 'local')}`);
    }
    route.timeOfDay = undefined;
    lines.push(`  '${route.id}': {\n    ${byTod.join(',\n    ')},\n  },`);
  }
  writeFileSync('src/route/routes/local-timetables.ts', `// 時間帯ごとの普通の時刻表（待避で停車時間が変わる。scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec, TimeOfDay } from '../types';

export const LOCAL_TT: Record<string, Partial<Record<TimeOfDay, ServiceSpec['timetable']>>> = {
${lines.join('\n')}
};
`);

}

// --namba-only は堺〜難波だけ更新
const nambaOnly = process.argv.includes('--namba-only');
{
  const nb = table(namba), nbUp = table(nambaUp);
  writeFileSync('src/route/routes/namba-timetable.ts', `// 南海本線 堺〜難波の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
/** 上り（堺 → 難波） */
export const NB: Record<Id, ServiceSpec['timetable']> = {
  local: ${nb.local},
  express: ${nb.express},
  airport: ${nb.airport},
  limited: ${nb.limited},
  southern: ${nb.southern},
};

/** 下り（難波 → 堺） */
export const NB_UP: Record<Id, ServiceSpec['timetable']> = {
  local: ${nbUp.local},
  express: ${nbUp.express},
  airport: ${nbUp.airport},
  limited: ${nbUp.limited},
  southern: ${nbUp.southern},
};
`);
}
if (nambaOnly) process.exit(0);
const dn = table(shiokaze), upT = table(shiokazeUp);
const body = (r: Record<string, string>) => `{
  local: ${r.local},
  express: ${r.express},
  airport: ${r.airport},
  limited: ${r.limited},
}`;
writeFileSync('src/route/routes/shiokaze-timetable.ts', `// 南海本線の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

/** 下り（桜ヶ丘 → 岬口） */
export const TT: Record<'local' | 'express' | 'airport' | 'limited', ServiceSpec['timetable']> = ${body(dn)};

/** 上り（岬口 → 桜ヶ丘） */
export const TT_UP: Record<'local' | 'express' | 'airport' | 'limited', ServiceSpec['timetable']> = ${body(upT)};
`);

// 南海本線 泉大津〜岸和田（特急サザンを含む）
const kDn = table(kishiwada), kUp = table(kishiwadaUp);
const kBody = (r: Record<string, string>) => `{
  local: ${r.local},
  express: ${r.express},
  airport: ${r.airport},
  limited: ${r.limited},
  southern: ${r.southern},
}`;
writeFileSync('src/route/routes/kishiwada-timetable.ts', `// 南海本線 泉大津〜岸和田の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
/** 下り（泉大津 → 岸和田） */
export const KT: Record<Id, ServiceSpec['timetable']> = ${kBody(kDn)};

/** 上り（岸和田 → 泉大津） */
export const KT_UP: Record<Id, ServiceSpec['timetable']> = ${kBody(kUp)};
`);

// 南海本線 岸和田〜泉佐野（独立コース）
const iDn = table(izumisano), iUp = table(izumisanoUp);
const iBody = (r: Record<string, string>) => `{
  local: ${r.local}, express: ${r.express}, airport: ${r.airport}, limited: ${r.limited}, southern: ${r.southern},
}`;
writeFileSync('src/route/routes/izumisano-timetable.ts', `// 南海本線 岸和田〜泉佐野の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
export const IT: Record<Id, ServiceSpec['timetable']> = ${iBody(iDn)};
export const IT_UP: Record<Id, ServiceSpec['timetable']> = ${iBody(iUp)};
`);

// 南海本線 みさき公園〜和歌山港
writeMisakiWakayamako();

// 南海本線 堺〜岸和田（通し）。下り = 堺 → 岸和田（throughUp）、上り = 岸和田 → 堺（through）
const nDn = table(throughUp), nUp = table(through);
writeFileSync('src/route/routes/through-timetable.ts', `// 南海本線 堺〜岸和田（通し）の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

type Id = 'local' | 'express' | 'airport' | 'limited' | 'southern';
/** 下り（堺 → 岸和田） */
export const NT: Record<Id, ServiceSpec['timetable']> = ${kBody(nDn)};

/** 上り（岸和田 → 堺） */
export const NT_UP: Record<Id, ServiceSpec['timetable']> = ${kBody(nUp)};
`);

// --shiokaze-only は南海本線だけ更新。別作業中の山岳線の生成物を触らない。
if (!process.argv.includes('--shiokaze-only')) {
const mDn = table(mountain), mUp = table(mountainUp);
writeFileSync('src/route/routes/mountain-timetable.ts', `// 高野線の時刻表（scripts/timetable.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

/** 下り（橋本 → 極楽橋） */
export const MT: Record<'local', ServiceSpec['timetable']> = {
  local: ${mDn.local},
};

/** 上り（極楽橋 → 橋本） */
export const MT_UP: Record<'local', ServiceSpec['timetable']> = {
  local: ${mUp.local},
};
`);
}
