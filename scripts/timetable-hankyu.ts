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

// ---- 対向列車（離合）の時刻表: src/data/hankyu-oncoming.json ----
// 実ダイヤではなくゲーム用の規則: 日中の神戸線と同じく、各方向に特急と普通が10分ごと（特急の1分後に普通）に走る。
// 走行時間は逆向きのコースの自動運転の時刻表（上の all）。コースの外は 25m/s で出入りする。時間帯ごとに開始時刻の前後を収録
const START: Record<string, number> = { morning: 7.5 * 3600, noon: 10 * 3600, evening: 17.5 * 3600, night: 21.5 * 3600 };
const counterOf = (id: string) => id.endsWith('-up') ? id.slice(0, -3) : `${id}-up`;
const oncoming: Record<string, Record<string, { id: string; code: string; points: { s: number; depart: number; stop: boolean; station: number | null }[] }[]>> = {};
for (const rid of ids) {
  const R = ROUTES[rid], C = ROUTES[counterOf(rid)], n = R.stations.length;
  const head = (i: number) => R.stations[i].stopS - 160; // 対向列車（s の減る向き）の停車時の先頭。ホームに 8両が収まる位置
  oncoming[rid] = {};
  for (const [tod, t0] of Object.entries(START)) {
    const list: (typeof oncoming)[string][string] = [];
    for (const [svc, code, offset] of [['limited', 'T', 0], ['local', 'L', 60]] as const) { // 特急が先に出て、普通は1分後（普通は特急に追いつかれない）
      const tt = all[C.id][svc];
      for (let dep = Math.floor((t0 - 2400) / 600) * 600 + offset; dep < t0 + 2400; dep += 600) {
        const pts: { s: number; depart: number; stop: boolean; station: number | null }[] = [];
        const first = head(n - 1);
        // 大阪梅田（頭端式）が始発の対向列車は、車止めの先から入らず梅田の番線に止まった状態から出る
        if (R.stations[n - 1].name !== '大阪梅田') pts.push({ s: Math.round(R.extent.to + 600), depart: dep - Math.round((R.extent.to + 600 - first) / 25), stop: false, station: null });
        for (let j = 0; j < n; j++) {
          const e = tt[j], i = n - 1 - j, stop = svc === 'local' || C.services!.find(v => v.id === svc)!.stops.includes(j);
          pts.push({ s: Math.round(head(i)), depart: dep + (e?.dep ?? e?.arr ?? 0), stop: stop && j < n - 1 ? true : stop, station: i });
        }
        const last = pts[pts.length - 1];
        // 大阪梅田が終着の対向列車は梅田で止まったまま 3分後に消える（車止めの先へ走らせない）
        if (R.stations[0].name === '大阪梅田') last.depart += 180;
        else pts.push({ s: -900, depart: last.depart + 25 + Math.round((last.s + 900) / 25), stop: false, station: null });
        list.push({ id: `${code}${dep}`, code, points: pts });
      }
    }
    oncoming[rid][tod] = list.sort((a, b) => a.points[0].depart - b.points[0].depart);
  }
}
writeFileSync('src/data/hankyu-oncoming.json', JSON.stringify({ source: 'ゲーム用の規則（日中10分間隔の普通・特急）。走行時間は scripts/timetable-hankyu.ts の自動運転', routes: oncoming }));
console.log('対向列車', Object.entries(oncoming).map(([k, v]) => `${k} ${v.noon.length}本`).join(' / '));
