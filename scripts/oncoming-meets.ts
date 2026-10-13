// 対向列車のすれ違いのリストを、実際の平日ダイヤから作る（鉄道運用Hub の時刻表データ。運用表データは CC BY 4.0）。
// ゲームの各コース × 種別 × 時間帯について、ゲームと同じ開始時刻（core/config.ts の START_CLOCK）・同じ時刻表（applyService）で走ったときに、
// 実際のダイヤで出会う逆向きの列車を、すれ違う位置（コースの s）・種別・停車中の駅とともに求め、src/data/oncoming-meets.json に書く。
// 取得した時刻表そのものはリポジトリに入れない（node_modules/.cache/unyohub に一時保存）。
//   npm run oncoming:meets                         … 全コースを作る
//   npm run oncoming:meets -- --new-route-only=...  … 指定コースだけ更新する
//   npm run oncoming:meets -- --refresh             … 取り直す
//   npm run oncoming:meets -- --timetable          … 時刻付きの共通運行データ（src/data/oncoming-timetable.json）。泉佐野以南の4コースは和歌山港線を含む（和歌山港線内は出さない）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROUTES } from '../src/route/index';
import { applyService } from '../src/route/service';
import { START_CLOCK } from '../src/core/config';
import type { Route, TimeOfDay } from '../src/route/types';

(globalThis as any).window = {};
const args = new Set(process.argv.slice(2));
const newRouteOnly = [...args].find(a => a.startsWith('--new-route-only='))?.slice('--new-route-only='.length);
const CACHE = 'node_modules/.cache/unyohub';
const API = 'https://unyohub.2pd.jp/api';
type TimedPoint = { s: number; depart: number; stop: boolean; station: number | null };
type TimedTrain = { id: string; code: string; points: TimedPoint[] };

async function post(name: string, body: string): Promise<any> {
  const file = `${CACHE}/${name}.json`;
  if (existsSync(file) && !args.has('--refresh')) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(`${API}/${name}.php`, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'densha-one-station oncoming builder (personal, non-commercial)' },
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const json = await res.json();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(json));
  return json;
}

/** 種別の記号: L 普通 / E急行・E区急・E準急 急行系（表示名つき）/ A 空港急行 / S サザン / Ra ラピートα / Rb ラピートβ */
function kindOf(type: string): string | null {
  if (type === '普通') return 'L';
  if (type === '空港急行') return 'A';
  if (type.includes('サザン')) return 'S';
  if (type.includes('ラピートα')) return 'Ra';
  if (type.includes('ラピートβ')) return 'Rb';
  if (type === '急行' || type === '区急' || type === '準急') return 'E' + type;
  return null; // 回送など
}

/** 停車駅では発車の DWELL 秒前から停車しているとみなす */
const DWELL = 25;
interface Pt { km: number; t: number; stop: boolean }

async function main() {
  const ri = await post('railroad_info', 'railroad_id=nankai&last_modified_timestamp=0');
  const ttAll = await post('timetable', 'railroad_id=nankai&diagram_revision=2024-12-21&timetable_id=weekday&last_modified_timestamp=0');
  const tt = ttAll.honsen, wakayamako = ttAll.wakayamakosen;
  const NAMES: string[] = ri.lines.honsen.stations.map((s: { station_name: string }) => s.station_name);
  const N = NAMES.length;
  const nameOf = (s: string) => s === 'なんば' ? '難波' : s;
  // 駅の なんばからの距離 [km]（ゲームの路線データ。駅間は営業キロに合わせてある）
  const KM: Record<string, number> = {};
  { const r = ROUTES['namba'], sN = r.stations.at(-1)!.stopS; for (const s of r.stations) KM[nameOf(s.name)] = (sN - s.stopS) / 1000; }
  { const r = ROUTES['nankai-through-up'], s0 = r.stations[0].stopS; for (const s of r.stations) KM[s.name] ??= KM['堺'] + (s.stopS - s0) / 1000; }
  { const r = ROUTES['izumisano'], s0 = r.stations[0].stopS; for (const s of r.stations) KM[s.name] ??= KM['岸和田'] + (s.stopS - s0) / 1000; }
  /** 実ダイヤの駅間の距離（KM）を持つコースだけ旧方式（oncoming-meets.json）のすれ違いを作る。泉佐野以南の4コースは --timetable（oncoming-timetable.json）だけ */
  const hasKm = (r: Route) => r.stations.every(s => KM[nameOf(s.name)] != null);
  const tsec = (v: string | null) => { const m = v ? /(\d+):(\d+)/.exec(v) : null; return m ? +m[1] * 3600 + +m[2] * 60 : null; };
  const trains = (dir: 'inbound_trains' | 'outbound_trains') => {
    const out: { kind: string; pts: Pt[] }[] = [];
    for (const arr of Object.values<any[]>(tt[dir])) for (const tr of arr) {
      const kind = kindOf(tr.train_type);
      if (!kind) continue;
      const pts: Pt[] = [];
      tr.departure_times.forEach((v: string | null, j: number) => {
        const name = NAMES[dir === 'inbound_trains' ? N - 1 - j : j]; // 上りの並びは 和歌山市 → 難波
        const t = tsec(v);
        if (t != null && KM[name] != null) pts.push({ km: KM[name], t, stop: !String(v).startsWith('|') });
      });
      if (pts.length >= 2) out.push({ kind, pts: pts.sort((a, b) => a.t - b.t) });
    }
    return out;
  };
  const OUT = trains('outbound_trains'), IN = trains('inbound_trains');
  const posAt = (pts: Pt[], t: number): { km: number; stopped: boolean } | null => {
    if (t < pts[0].t - DWELL || t > pts.at(-1)!.t) return null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], arr = p.t - (p.stop ? DWELL : 0);
      if (p.stop && t >= arr && t <= p.t) return { km: p.km, stopped: true };
      if (i && t < arr) { const a = pts[i - 1]; return { km: a.km + (p.km - a.km) * (t - a.t) / (arr - a.t), stopped: false }; }
    }
    return null;
  };
  /** km → コースの s（コースの駅で折れ線補間、端は外挿） */
  const sOf = (r: Route) => {
    const k = r.stations.map(s => KM[nameOf(s.name)]), s = r.stations.map(x => x.stopS), up = k[0] < k.at(-1)!;
    return (km: number) => {
      let i = 1;
      while (i < k.length - 1 && (up ? km > k[i] : km < k[i])) i++;
      return s[i - 1] + (s[i] - s[i - 1]) * (km - k[i - 1]) / (k[i] - k[i - 1]);
    };
  };
  if (args.has('--timetable')) {
    // API の全駅を、既知駅の営業キロから補間・外挿する。コース外の駅も
    // 入出場点として残すため、路線ごとの変換前に全駅の距離を埋める。
    const apiNames = NAMES.map(nameOf);
    const fillKm = (K: Record<string, number>) => {
      const known = apiNames.map((name, i) => K[name] == null ? null : { i, km: K[name]! }).filter((x): x is { i: number; km: number } => x != null);
      for (let i = 0; i < apiNames.length; i++) if (K[apiNames[i]] == null) {
        const left = [...known].reverse().find(x => x.i < i), right = known.find(x => x.i > i);
        if (left && right) K[apiNames[i]] = left.km + (right.km - left.km) * (i - left.i) / (right.i - left.i);
        else if (left) {
          const prev = [...known].reverse().find(x => x.i < left.i);
          K[apiNames[i]] = left.km + (left.km - (prev?.km ?? left.km - 1)) * (i - left.i) / (left.i - (prev?.i ?? left.i - 1));
        } else if (right) {
          const next = known.find(x => x.i > right.i);
          K[apiNames[i]] = right.km - ((next?.km ?? right.km + 1) - right.km) * (right.i - i) / ((next?.i ?? right.i + 1) - right.i);
        }
      }
    };
    // 泉佐野以南の4コース（泉佐野〜みさき公園、みさき公園〜和歌山港。上り下り）は、コースの駅の営業キロ（stopS の差）を KMS に持つ。
    // 既存コースの距離 KM は変えない（泉佐野以南の駅を KM に入れると、既存コースの区間外の点の位置が変わり、収録済みのデータが変わる）。
    const SOUTH = new Set(['izumisano-misaki', 'izumisano-misaki-up', 'misaki-wakayamako', 'misaki-wakayamako-up']);
    const KMS: Record<string, number> = { ...KM };
    for (const [id, anchor] of [['izumisano-misaki', '泉佐野'], ['misaki-wakayamako', 'みさき公園']] as const) {
      const r = ROUTES[id], s0 = r.stations[0].stopS;
      if (KMS[anchor] == null) throw new Error(`${id}: 基準駅 ${anchor} の距離がない`);
      for (const s of r.stations) KMS[nameOf(s.name)] ??= KMS[anchor] + (s.stopS - s0) / 1000;
    }
    fillKm(KM); fillKm(KMS);
    const routes: Record<string, Record<TimeOfDay, TimedTrain[]>> = {};
    const revision = '2024-12-21';
    // 和歌山港線（Hub では別の線 wakayamakosen）。本線から直通する列車は、列車番号で本線の列車の前後につなぐ。線内だけの列車（普通）は単独の列車にする
    type TPt = { km: number; t: number; stop: boolean; name: string };
    const kinds = (dir: 'inbound_trains' | 'outbound_trains', K: Record<string, number>) => {
      const out: { id: string; code: string; pts: TPt[] }[] = [];
      const wk: Record<string, any[]> = wakayamako?.[dir] ?? {};
      const wkUsed = new Set<string>();
      for (const [id, arr] of Object.entries<any[]>(tt[dir])) for (const tr of arr) {
        const code = kindOf(tr.train_type);
        if (!code) continue;
        const pts: TPt[] = [];
          tr.departure_times.forEach((v: string | null, j: number) => {
          const t = tsec(v);
            const apiIndex = dir === 'inbound_trains' ? N - 1 - j : j;
            if (t == null || K[apiNames[apiIndex]] == null) return;
            pts.push({ km: K[apiNames[apiIndex]], t, stop: !String(v).startsWith('|'), name: apiNames[apiIndex] });
        });
        // 和歌山港線へ直通する列車（下り: 本線の終点の次が和歌山港、上り: 和歌山港が本線の始点の前）
        const link = (dir === 'outbound_trains' ? tr.next_trains : tr.previous_trains)?.find((x: any) => x.line_id === 'wakayamakosen' && x.train_number === id);
        const wkTrain = link ? wk[id]?.[0] : undefined;
        if (K === KMS && wkTrain && K['和歌山港'] != null) {
          wkUsed.add(id);
          const port = tsec(wkTrain.departure_times[dir === 'outbound_trains' ? 1 : 0]);
          if (port != null) pts.push({ km: K['和歌山港'], t: port, stop: true, name: '和歌山港' });
        }
        if (pts.length >= 2) out.push({ id, code, pts });
      }
      // 線内だけの列車（普通）。和歌山市〜和歌山港の2点
      if (K === KMS && K['和歌山港'] != null) for (const [id, arr] of Object.entries<any[]>(wk)) for (const tr of arr) {
        const code = kindOf(tr.train_type);
        if (!code || wkUsed.has(id) || (tr.previous_trains?.length ?? 0) + (tr.next_trains?.length ?? 0) > 0) continue;
        const [a, b] = dir === 'outbound_trains' ? ['和歌山市', '和歌山港'] : ['和歌山港', '和歌山市'];
        const ta = tsec(tr.departure_times[0]), tb = tsec(tr.departure_times[1]);
        if (ta == null || tb == null) continue;
        out.push({ id, code, pts: [{ km: K[a], t: ta, stop: true, name: a }, { km: K[b], t: tb, stop: true, name: b }] });
      }
      return out;
    };
    const OUT_L = kinds('outbound_trains', KM), IN_L = kinds('inbound_trains', KM);
    const OUT_S = kinds('outbound_trains', KMS), IN_S = kinds('inbound_trains', KMS);
    const timeOfDays: TimeOfDay[] = ['morning', 'noon', 'evening', 'night'];
    const timetableSOf = (r: Route, K: Record<string, number>) => {
      const k = r.stations.map(s => K[nameOf(s.name)]!), s = r.stations.map(x => x.platform.from + 8), up = k[0] < k.at(-1)!;
      return (km: number) => {
        let i = 1;
        while (i < k.length - 1 && (up ? km > k[i] : km < k[i])) i++;
        return s[i - 1] + (s[i] - s[i - 1]) * (km - k[i - 1]) / (k[i] - k[i - 1]);
      };
    };
    for (const [id, r0] of Object.entries(ROUTES)) {
      const south = SOUTH.has(id), K = south ? KMS : KM, OUT = south ? OUT_S : OUT_L, IN = south ? IN_S : IN_L;
      if (r0.lineId !== 'shiokaze' || r0.singleTrack || !r0.stations.every(s => K[nameOf(s.name)] != null)) continue;
      routes[id] = { morning: [], noon: [], evening: [], night: [] };
      const firstKm = K[nameOf(r0.stations[0].name)]!, lastKm = K[nameOf(r0.stations.at(-1)!.name)]!;
      const oncoming = firstKm < lastKm ? IN : OUT;
      /** 和歌山港線は単線で、このコースでは上下の線が重なる（s 12870〜14790）。そこへ対向列車を出すと自列車の線と重なるので、
       *  みさき公園〜和歌山港のコースでは和歌山市より先（和歌山港線内）の点を落とし、線内だけの列車は出さない */
      const clipKm = id.startsWith('misaki-wakayamako') ? K['和歌山市'] : undefined;
      for (const tod of timeOfDays) {
        const r = structuredClone(r0); r.timeOfDay = tod;
        let courseMax = 0;
        for (const sv of r0.services ?? []) {
          const rs = structuredClone(r0); rs.timeOfDay = tod; applyService(rs, sv.id);
          courseMax = Math.max(courseMax, ...rs.stations.map(s => s.scheduledArrival));
        }
        const start = START_CLOCK[tod], winStart = start - 600, winEnd = start + courseMax + 600;
        const toS = timetableSOf(r, K), routeMin = Math.min(r.extent.from, r.extent.to), routeMax = Math.max(r.extent.from, r.extent.to);
        const result: TimedTrain[] = [];
        for (const tr of oncoming) {
          const points0 = tr.pts.filter(p => clipKm == null || p.km <= clipKm + 1e-9).map(p => ({ s: Math.round(toS(p.km)), depart: p.t, stop: p.stop, station: r.stations.findIndex(s => nameOf(s.name) === p.name) })).map(p => ({ ...p, station: p.station < 0 ? null : p.station }));
          points0.sort((a, b) => a.depart - b.depart || b.s - a.s);
          const points: TimedPoint[] = [];
          for (const p of points0) {
            const prev = points.at(-1);
            if (prev && p.depart === prev.depart) continue;
            if (prev && p.s >= prev.s) continue;
            points.push(p);
          }
          if (points.length < 2) continue;
          const crosses = points.some(p => p.s >= routeMin && p.s <= routeMax && p.depart >= winStart && p.depart <= winEnd)
            || points.some((p, i) => {
              const q = points[i + 1];
              if (!q) return false;
              return Math.max(routeMin, Math.min(p.s, q.s)) <= Math.min(routeMax, Math.max(p.s, q.s))
                && Math.max(winStart, p.depart) <= Math.min(winEnd, q.depart);
            });
          if (!crosses) continue;
          const inside = points.map((p, i) => p.s >= routeMin && p.s <= routeMax ? i : -1).filter(i => i >= 0);
          let from = inside.length ? Math.max(0, inside[0] - 1) : 0;
          let to = inside.length ? Math.min(points.length - 1, inside.at(-1)! + 1) : points.length - 1;
          if (!inside.length) {
            const crossing = points.findIndex((p, i) => points[i + 1] && p.s >= routeMax && points[i + 1].s <= routeMin);
            if (crossing >= 0) { from = crossing; to = crossing + 1; }
          }
          result.push({ id: tr.id, code: tr.code, points: points.slice(from, to + 1) });
        }
        result.sort((a, b) => (a.points.find(p => p.s >= routeMin)?.depart ?? a.points[0].depart) - (b.points.find(p => p.s >= routeMin)?.depart ?? b.points[0].depart) || a.id.localeCompare(b.id));
        routes[id][tod] = result;
      }
    }
    const out = { source: '南海電鉄の平日ダイヤ（鉄道運用Hub https://unyohub.2pd.jp/railroad_nankai/ の時刻表データ）。コース外駅の距離は既知駅からの補間・外挿推定', revision, routes };
    mkdirSync('src/data', { recursive: true });
    writeFileSync('src/data/oncoming-timetable.json', JSON.stringify(out));
    let trains = 0, points = 0;
    for (const byTod of Object.values(routes)) for (const list of Object.values(byTod)) { trains += list.length; points += list.reduce((n, x) => n + x.points.length, 0); }
    console.log(`src/data/oncoming-timetable.json: ${(JSON.stringify(out).length / 1024).toFixed(0)} KB、${Object.keys(routes).length}コース、${trains}列車、${points}点`);
    return;
  }
  const old = newRouteOnly && existsSync('src/data/oncoming-meets.json')
    ? JSON.parse(readFileSync('src/data/oncoming-meets.json', 'utf8')) as { source?: string; meets?: Record<string, Record<string, Record<string, [number, string, number][]>>> }
    : undefined;
  const result: Record<string, Record<string, Record<string, [number, string, number][]>>> = newRouteOnly ? structuredClone(old?.meets ?? {}) : {};
  for (const [id, r0] of Object.entries(ROUTES)) {
    if (r0.lineId !== 'shiokaze' || r0.singleTrack || !hasKm(r0)) continue;
    if (newRouteOnly && id !== newRouteOnly) continue;
    result[id] = {};
    for (const sv of r0.services ?? []) {
      result[id][sv.id] = {};
      for (const tod of ['morning', 'noon', 'evening', 'night'] as TimeOfDay[]) {
        const r = structuredClone(r0); r.timeOfDay = tod; applyService(r, sv.id);
        const T0 = START_CLOCK[tod], toS = sOf(r);
        // 自列車の位置（停車駅の着・発で折れ線。始発・終着は通過扱いでも点にする）
        const pp: Pt[] = [];
        r.stations.forEach((s, i) => {
          if (s.pass && i && i < r.stations.length - 1) return;
          const arr = T0 + s.scheduledArrival, km = KM[nameOf(s.name)];
          pp.push({ km, t: arr, stop: true });
          if (s.dwell) pp.push({ km, t: arr + s.dwell, stop: true });
        });
        const towardNamba = pp.at(-1)!.km < pp[0].km;
        const pAt = (t: number) => {
          for (let i = 1; i < pp.length; i++) if (t <= pp[i].t) { const a = pp[i - 1], b = pp[i]; return b.t === a.t ? a.km : a.km + (b.km - a.km) * (t - a.t) / (b.t - a.t); }
          return pp.at(-1)!.km;
        };
        const list: [number, string, number][] = [];
        for (const o of towardNamba ? OUT : IN) {
          let prev: number | null = null;
          for (let t = pp[0].t; t <= pp.at(-1)!.t; t += 2) {
            const q = posAt(o.pts, t);
            if (!q) { prev = null; continue; }
            const d = (q.km - pAt(t)) * (towardNamba ? -1 : 1);
            if (prev != null && prev > 0 && d <= 0) {
              const st = q.stopped ? r.stations.findIndex(s => KM[nameOf(s.name)] === q.km) : -1;
              list.push([Math.round(toS(q.km)), o.kind, st]);
              break;
            }
            prev = d;
          }
        }
        list.sort((a, b) => a[0] - b[0]);
        result[id][sv.id][tod] = list;
      }
    }
  }
  const out = {
    source: '南海電鉄の平日ダイヤ（鉄道運用Hub https://unyohub.2pd.jp/railroad_nankai/ の時刻表データ）から計算',
    /** [routeId][serviceId][timeOfDay] = [すれ違う位置 s, 種別の記号, 相手が停車中の駅 index（走行中は -1）] の並び（s の小さい順） */
    meets: result,
  };
  mkdirSync('src/data', { recursive: true });
  writeFileSync('src/data/oncoming-meets.json', JSON.stringify(out));
  let n = 0;
  for (const a of Object.values(result)) for (const b of Object.values(a)) for (const c of Object.values(b)) n += c.length;
  console.log(`src/data/oncoming-meets.json: ${n} 件、${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
}
main().catch(e => { console.error(e); process.exit(1); });
