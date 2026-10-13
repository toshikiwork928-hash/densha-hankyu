// 阪急神戸線の時刻表の生成: 種別ごとに自動運転（最速走行）で各駅の到着・通過時刻を求め、+5% を 5 秒単位に切り上げる（scripts/timetable.ts と同じ方法）
// 実行: npm run timetable:hankyu（src/route/routes/hankyu-kobe-timetable.ts を書き換える）
// 待避・待ち合わせは無い（始発・終着の西宮北口の接続は時刻表に入れない）。停車時間は 25 秒（ゲーム用）
import { writeFileSync } from 'node:fs';
import { ROUTES } from '../src/route';
import { terminalSpeedLimit } from '../src/game/terminal-ats';
import { applyService } from '../src/route/service';
import { buildTrack } from '../src/route/track';
import type { Route, ServiceId, ServiceSpec } from '../src/route/types';
import { TRAIN_PERF, stepTrain, type TrainState } from '../src/sim/train';

const DWELL = 25, MARGIN = 1.05, DT = 1 / 30;

function run(route: Route, id: ServiceId): ServiceSpec['timetable'] {
  const svc = applyService(route, id)!;
  const track = buildTrack(route), perf = TRAIN_PERF[svc.kind];
  const env = { adhesion: 1, gradePermil: 0, perf };
  const plan = perf.bMax * .62;
  const tr: TrainState = { s: route.startS, v: 0, acc: 0, notch: 0 };
  const out: ServiceSpec['timetable'] = { 0: { arr: 0, dep: 0 } };
  const stops = svc.stops.slice(1);
  let t = 0, si = 0;
  for (let i = 1; i < route.stations.length; i++) {
    const sta = route.stations[i], stop = svc.stops.includes(i);
    for (; ;) {
      const target = route.stations[stops[si]].stopS;
      let vAllow = Math.min(track.limitAt(tr.s), terminalSpeedLimit(route, stops[si], tr.s)) / 3.6;
      for (let d = 5; d < 2500; d += 5) {
        const q = tr.s + d, lim = q >= target ? 0 : Math.min(track.limitAt(q), terminalSpeedLimit(route, stops[si], q)) / 3.6;
        vAllow = Math.min(vAllow, Math.sqrt(lim * lim + 2 * plan * Math.max(0, (q >= target ? target - tr.s : d) - 1)));
        if (q >= target) break;
      }
      tr.notch = tr.v > vAllow + .05 ? -Math.min(8, Math.max(1, Math.ceil((tr.v - vAllow) * 8 + 4))) : tr.v > vAllow - .6 ? 0 : 5;
      env.gradePermil = track.gradeAt(tr.s);
      const before = tr.s;
      stepTrain(tr, env, DT); t += DT;
      if (!stop && before < sta.stopS && tr.s >= sta.stopS) { out[i] = { arr: Math.round(t) }; break; }
      if (stop && (tr.v < .05 && target - tr.s < 1.5 || tr.s >= target)) { tr.v = 0; tr.acc = 0; tr.s = target; break; }
      if (t > 4000) throw new Error(`timeout ${route.id} ${id} @${tr.s}`);
    }
    if (stop) {
      si++;
      const last = i === route.stations.length - 1;
      out[i] = last ? { arr: t } : { arr: t, dep: t + DWELL };
      if (!last) t += DWELL;
    }
  }
  // 走行時間に +5%（停車時間はそのまま）を 5 秒単位で
  const up = (x: number) => Math.ceil(x * MARGIN / 5) * 5;
  let prevDep = 0, prevOrig = 0;
  const res: ServiceSpec['timetable'] = {};
  for (const k of Object.keys(out).map(Number).sort((a, b) => a - b)) {
    const e = out[k];
    if (k === 0) { res[0] = { arr: 0, dep: 0 }; continue; }
    const arr = prevDep + up(e.arr - prevOrig);
    res[k] = e.dep != null ? { arr, dep: arr + (e.dep - e.arr) } : { arr };
    if (e.dep != null) { prevDep = arr + (e.dep - e.arr); prevOrig = e.dep; }
  }
  return res;
}

const ids = ['hankyu-kobe-east', 'hankyu-kobe-east-up', 'hankyu-kobe-west', 'hankyu-kobe-west-up'];
const all: Record<string, Record<string, ServiceSpec['timetable']>> = {};
for (const rid of ids) {
  const r = ROUTES[rid];
  all[rid] = Object.fromEntries((r.services ?? []).map(v => [v.id, run(r, v.id)]));
  console.log(rid, Object.entries(all[rid]).map(([k, v]) => `${k} ${Math.max(...Object.values(v).map(x => x.arr))}s`).join(' / '));
}
writeFileSync('src/route/routes/hankyu-kobe-timetable.ts', `// 阪急神戸線の時刻表（scripts/timetable-hankyu.ts が生成。手で直さない）
import type { ServiceSpec } from '../types';

export const HKT: Record<string, Record<string, ServiceSpec['timetable']>> = ${JSON.stringify(all)};
`);
