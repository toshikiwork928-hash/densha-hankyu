// 対向列車は列車番号と実際の発車時刻を持つ。到着時刻・閉そくはゲーム用の推定。
// 描画距離と運行を分離し、プレイヤーの位置・種別に発車や本数を依存させない。
import * as THREE from 'three';
import DATA from '../data/oncoming-timetable.json';
import type { GameContext } from '../core/context';
import type { LatProfile, OncomingSpec, Route, TimeOfDay } from '../route/types';
import { customPlatformSide, islandOffset, loopShape, loopZone, profileLat, serviceOf, type LoopZone } from '../route/service';
import { createTrainSet, type TrainCar } from './train-models';
import { placeCar } from './emu';

export interface TimedPoint { s: number; depart: number; stop: boolean; station: number | null }
export interface TimedTrain { id: string; code: string; points: TimedPoint[] }
interface Point extends TimedPoint { arrive: number }
interface Segment { a: Point; b: Point; speed: number; accelerate: number; brake: number }
export interface Motion { head: number; v: number; station: number | null; stopped: boolean }
export const COUNTER_BLOCK_GAP = 300;
const ACCEL = .8, DECEL = .9, DWELL = 25, MIN_DWELL = 10;
const tables = DATA.routes as unknown as Record<string, Record<TimeOfDay, TimedTrain[]>>;
export const counterTimetable = (id: string, tod: TimeOfDay): TimedTrain[] | undefined => tables[id]?.[tod];
const maximumSpeed = (code: string) => (code === 'L' ? 80 : code === 'S' || code.startsWith('R') ? 105 : 95) / 3.6;
const keyOf = (a: TimedPoint, b: TimedPoint, code: string) => `${code}|${a.s}|${b.s}|${a.stop}|${b.stop}`;
function minimumRun(distance: number, speed: number, a: boolean, b: boolean) {
  const coefficient = (a ? 1 / ACCEL : 0) + (b ? 1 / DECEL : 0);
  const peak = coefficient ? Math.min(speed, Math.sqrt(2 * distance / coefficient)) : speed;
  return distance / peak + coefficient * peak / 2;
}

/** 同区間・同種別の短い所要時間から通常走行を推定。余分な時間は到着後の待避に割り当てる。 */
export function makeCounterPlans(route: Route, tod: TimeOfDay) {
  const samples = new Map<string, number>();
  for (const list of Object.values(tables[route.id] ?? {})) for (const tr of list) for (let i = 1; i < tr.points.length; i++) {
    const a = tr.points[i - 1], b = tr.points[i], duration = b.depart - a.depart;
    if (duration > 0) {
      const key = keyOf(a, b, tr.code);
      samples.set(key, Math.min(samples.get(key) ?? Infinity, duration));
    }
  }
  return (counterTimetable(route.id, tod) ?? []).map(tr => {
    const points: Point[] = tr.points.map(p => ({ ...p, arrive: p.depart - (p.stop ? DWELL : 0) }));
    const segments: Segment[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], distance = a.s - b.s;
      const minimal = minimumRun(distance, maximumSpeed(tr.code), a.stop, b.stop);
      // 分単位の原時刻が加減速・戸扱いに不足する場合は、早発せず後ろへずらす。
      b.depart = Math.max(b.depart, a.depart + minimal + (b.stop ? MIN_DWELL : 0));
      const normal = (samples.get(keyOf(a, b, tr.code)) ?? b.depart - a.depart) - (b.stop ? DWELL : 0);
      const duration = Math.min(b.depart - a.depart - (b.stop ? MIN_DWELL : 0), Math.max(minimal, normal));
      b.arrive = b.stop ? a.depart + duration : b.depart;
      const travel = b.arrive - a.depart;
      const coefficient = (a.stop ? 1 / ACCEL : 0) + (b.stop ? 1 / DECEL : 0);
      const speed = coefficient ? 2 * distance / (travel + Math.sqrt(Math.max(0, travel * travel - 2 * coefficient * distance))) : distance / travel;
      segments.push({ a, b, speed, accelerate: a.stop ? speed / ACCEL : 0, brake: b.stop ? speed / DECEL : 0 });
    }
    const at = (clock: number): Motion | null => {
      if (clock < points[0].arrive || clock > points.at(-1)!.depart) return null;
      for (const p of points) if (p.stop && clock >= p.arrive && clock <= p.depart) return { head: p.s, v: 0, station: p.station, stopped: true };
      for (const g of segments) if (clock >= g.a.depart && clock <= g.b.arrive) {
        const elapsed = clock - g.a.depart, duration = g.b.arrive - g.a.depart;
        let distance: number, v: number;
        if (elapsed < g.accelerate) { v = ACCEL * elapsed; distance = .5 * ACCEL * elapsed * elapsed; }
        else if (duration - elapsed < g.brake) {
          const remaining = duration - elapsed; v = DECEL * remaining;
          distance = g.a.s - g.b.s - .5 * DECEL * remaining * remaining;
        } else { v = g.speed; distance = g.speed * (elapsed - g.accelerate / 2); }
        return { head: g.a.s - distance, v, station: null, stopped: false };
      }
      return null;
    };
    // 安全上待った位置に対応する時刻。停車位置では到着時刻を使い、戸扱いを省略しない。
    const clockAt = (head: number) => {
      let lo = points[0].arrive, hi = points.at(-1)!.depart;
      for (let i = 0; i < 36; i++) { const mid = (lo + hi) / 2; const m = at(mid); if (m && m.head > head) lo = mid; else hi = mid; }
      return hi;
    };
    return { ...tr, points, at, clockAt };
  });
}

interface Path { zone?: LoopZone; profile?: LatProfile; station: number }
interface Consist extends Partial<OncomingSpec> { cars: number; kind: NonNullable<OncomingSpec['kind']> }
export interface CounterTrain {
  id: string; code: string; head: number; v: number; length: number; delay: number;
  active: boolean; finished: boolean; stopped: boolean; station: number | null;
  arrivedClock?: number;
  spec: Consist; lat: number; paths: Path[]; plan: ReturnType<typeof makeCounterPlans>[number];
}

/** 描画を持たない共通運行。全編成を運行し、近い編成だけ描画側へ渡す。 */
export function createCounterTraffic(route: Route, tod: TimeOfDay, consist: (code: string, ordinal: number, playerTowardNamba: boolean) => Consist) {
  const playerTowardNamba = serviceOf(route, 'local')?.destination === 'なんば';
  const main = route.oncoming.find(o => !o.stop && !o.follow && o.lat !== route.oncomingLocal?.lat)?.lat ?? 4;
  const nth: Record<string, number> = {};
  const trains: CounterTrain[] = makeCounterPlans(route, tod).map(plan => {
    const spec = consist(plan.code, nth[plan.code] = (nth[plan.code] ?? -1) + 1, playerTowardNamba);
    const local = plan.code === 'L', lat = local && route.oncomingLocal ? route.oncomingLocal.lat : main;
    const paths: Path[] = [];
    for (const p of plan.points) {
      if (!p.stop || p.station == null) continue;
      const sta = route.stations[p.station];
      let extra: string | undefined;
      if (local && sta.name === '堺') extra = playerTowardNamba ? 'sakai-1' : 'sakai-3';
      if (sta.name === '泉佐野') {
        // 空港急行は外側線（下りは T1、上りは T4）、なんば方面の自列車と向かい合う下りの普通も T1。本線系統は本線のまま
        if (plan.code === 'A') extra = playerTowardNamba ? 'izumisano-t1' : 'izumisano-t4';
        else if (local && playerTowardNamba) extra = 'izumisano-t1';
      }
      const profile = extra ? route.extraTracks?.find(x => x.id === extra)?.lat : undefined;
      if (profile) { paths.push({ profile, station: p.station }); continue; }
      if (local && sta.loop && sta.layout !== 'custom' && !route.oncomingLocal?.stations.includes(p.station)) {
        const scene = route.oncoming.find(o => o.stop?.station === p.station && o.stop.loop);
        const zone = scene?.stop?.zone ?? loopZone(sta);
        if (zone) paths.push({ zone, station: p.station });
      }
    }
    const length = (spec.units ?? [spec.cars]).reduce((sum, n, i) => {
      const kind = spec.unitKinds?.[i] ?? spec.kind;
      return sum + n * (['commuter-2300', 'commuter-2000', 'limited-30000'].includes(kind) ? 18.8 : 20.8);
    }, 0);
    return { id: plan.id, code: plan.code, head: Infinity, v: 0, length, delay: 0, active: false, finished: false, stopped: false, station: null, spec, lat, paths, plan };
  });
  const laneAt = (o: CounterTrain, s: number) => {
    for (const path of o.paths) {
      if (path.profile && path.station === route.stations.length - 1 && route.stations[path.station].name === '堺' && s > path.profile.at(-1)![0]) {
        // 始終端用の普通の進路は3番線を区間外へ延長している。入線列車は実際の入口分岐器から入る。
        return main + islandOffset(route, main, s);
      }
      if (path.profile && s >= path.profile[0][0] && s <= path.profile.at(-1)![0]) return profileLat(path.profile, s);
      if (path.zone && s >= path.zone.inFrom && s <= path.zone.outTo) return o.lat + islandOffset(route, o.lat, s) - path.zone.lat * loopShape(path.zone, s);
    }
    return o.lat + islandOffset(route, o.lat, s);
  };
  /** 本線を走る列車どうし（待避線・番線の経路が無く、横位置の基準が同じ）。route.counterSameTrack のコースだけ */
  const sameTrack = (a: CounterTrain, b: CounterTrain) => !!route.counterSameTrack && a.lat === b.lat && a.paths.length === 0 && b.paths.length === 0;
  const conflict = (a: CounterTrain, b: CounterTrain) => {
    if (sameTrack(a, b)) return true;
    const from = Math.max(a.head, b.head), to = Math.min(a.head + a.length, b.head + b.length);
    if (from <= to) {
      for (let s = from; s <= to; s += 4) if (Math.abs(laneAt(a, s) - laneAt(b, s)) < 3.4) return true;
      return Math.abs(laneAt(a, to) - laneAt(b, to)) < 3.4;
    }
    // 別線の列車の「将来通る分岐器」を現在の車体重なりと混同しない。
    const rear = a.head > b.head ? a : b, front = rear === a ? b : a;
    return Math.abs(laneAt(rear, rear.head) - laneAt(front, front.head + front.length)) < 3.4;
  };
  const floorOf = (o: CounterTrain) => {
    let floor = -Infinity;
    for (const q of trains) if (q !== o && q.active) {
      if (q.head <= o.head && conflict(o, q)) floor = Math.max(floor, q.head + q.length + COUNTER_BLOCK_GAP);
      for (const sta of route.stations) if (q.head <= sta.platform.to && q.head + q.length >= sta.platform.from && o.head >= q.head) {
        const center = (sta.platform.from + sta.platform.to) / 2;
        if (Math.abs(laneAt(o, center) - laneAt(q, center)) < 3.4) floor = Math.max(floor, sta.platform.to + 180);
      }
      // 合流を始めた待避線列車には先に分岐器を抜けさせ、本線の後続を入口に保持する。
      for (const path of q.paths) {
        const merge = path.zone?.inFrom ?? path.profile?.[0][0];
        const hold = path.zone ? path.zone.inTo + 20 : path.profile ? path.profile[1][0] + 20 : undefined;
        if (merge != null && hold != null && q.head < hold && q.head + q.length > merge && o.head > q.head && Math.abs(laneAt(o, merge) - laneAt(q, merge)) < 3.4 && Math.abs(laneAt(o, hold) - laneAt(q, hold)) >= 3.4) {
          floor = Math.max(floor, hold + q.length + COUNTER_BLOCK_GAP);
        }
      }
      for (const p of o.plan.points) if (p.stop && p.station != null) {
        const sta = route.stations[p.station], path = o.paths.find(x => x.station === p.station);
        const lo = path?.zone?.inFrom ?? path?.profile?.[0][0] ?? sta.platform.from;
        const hi = path?.zone?.outTo ?? path?.profile?.at(-1)?.[0] ?? sta.platform.to;
        if (o.head > hi && q.head <= hi && q.head + q.length >= lo && Math.abs(laneAt(o, p.s + o.length / 2) - laneAt(q, p.s + q.length / 2)) < 3.4) {
          floor = Math.max(floor, hi + COUNTER_BLOCK_GAP);
        }
      }
      // 待避線から本線へ合流する前に、前後双方の本線列車が分岐器を空けるまで待つ。
      for (const path of o.paths) {
        const merge = path.zone?.inFrom ?? path.profile?.[0][0];
        const hold = path.zone ? path.zone.inTo + 20 : path.profile ? path.profile[1][0] + 20 : undefined;
        if (merge == null || hold == null || o.head < merge || o.head > hold + 100) continue;
        if (q.head < merge + o.length + COUNTER_BLOCK_GAP && q.head + q.length > merge - COUNTER_BLOCK_GAP && Math.abs(laneAt(q, merge) - laneAt(o, merge)) < 3.4 && Math.abs(laneAt(q, hold) - laneAt(o, hold)) >= 3.4) {
          floor = Math.max(floor, hold);
        }
      }
    }
    return floor;
  };
  let lastClock: number | undefined;
  const update = (clock: number) => {
    if (clock === lastClock) return;
    if (lastClock != null && clock < lastClock) {
      for (const o of trains) Object.assign(o, { head: Infinity, v: 0, delay: 0, active: false, finished: false, stopped: false, station: null, arrivedClock: undefined });
      lastClock = undefined;
    }
    if (lastClock != null && clock - lastClock > .101) {
      while (clock - lastClock > .101) update(lastClock + .1);
    }
    const initial = lastClock == null || clock < lastClock;
    const dt = initial ? 0 : Math.max(0, clock - lastClock!); lastClock = clock;
    // 先行から更新する。初期配置でも停車ホームに後続を重ねない。
    const ordered = trains.filter(o => !o.finished).sort((a, b) => (a.plan.at(clock - a.delay)?.head ?? Infinity) - (b.plan.at(clock - b.delay)?.head ?? Infinity));
    for (const o of ordered) {
      let m = o.plan.at(clock - o.delay);
      if (!m) {
        if (clock - o.delay > o.plan.points.at(-1)!.depart) { o.finished = true; o.active = false; }
        continue;
      }
      const started = !o.active;
      if (started) { o.active = true; o.head = m.head; o.v = m.v; }
      const floor = floorOf(o);
      const oldHead = o.head;
      let head = Math.max(m.head, floor);
      if (started) {
        o.head = head;
        const rear = () => trains.find(q => q !== o && q.active && q.head >= o.head && q.head < o.head + o.length + COUNTER_BLOCK_GAP && conflict(o, q));
        if (!initial && rear()) {
          // 先行に合わせて入場位置が延びても、既存編成の途中へ割り込まない。
          o.active = false; o.head = Infinity; o.v = 0;
          o.delay = clock - o.plan.points[0].arrive;
          continue;
        }
        if (initial) for (let n = 0; n < trains.length; n++) {
          const q = rear(); if (!q) break;
          head = q.head + q.length + COUNTER_BLOCK_GAP; o.head = head;
        }
      }
      if (!started && dt > 0) {
        const cap = Math.sqrt(2 * DECEL * Math.max(0, o.head - floor));
        let speed = Math.min(maximumSpeed(o.code), o.v + ACCEL * dt, cap);
        for (const path of o.paths) if (path.zone && o.head + o.length > path.zone.inFrom && o.head < path.zone.outTo + 150) speed = Math.min(speed, path.zone.limit / 3.6);
        head = Math.max(head, oldHead - speed * dt);
        head = Math.min(oldHead, head);
      }
      if (head > m.head + .01) {
        o.delay = Math.max(o.delay, clock - o.plan.clockAt(head));
        m = o.plan.at(clock - o.delay) ?? m;
      }
      o.head = head;
      o.v = started || dt === 0 ? (head > m.head + .01 ? 0 : m.v) : Math.max(0, (oldHead - head) / dt);
      o.stopped = m.stopped && Math.abs(head - m.head) < .1 && o.v < .1;
      o.station = o.stopped ? m.station : null;
      if (o.stopped) {
        const point = o.plan.points.find(p => p.stop && Math.abs(p.s - head) < .1);
        o.arrivedClock ??= initial ? Math.min(clock, point?.arrive ?? clock) : clock;
        // 到着が遅れた場合、すでに過ぎた待避時間をもう一度丸ごと待たない。
        if (point && clock >= point.depart && clock - o.arrivedClock >= MIN_DWELL) o.delay = Math.min(o.delay, Math.max(0, clock - point.depart));
      } else o.arrivedClock = undefined;
    }
  };
  return { trains, update, laneAt, conflict, floorOf, sameTrack };
}

/** 車両モデルは種別・編成ごとに再利用し、描画範囲外でも運行時計を進める。 */
export function createTimetableOncoming(ctx: GameContext, consist: (code: string, ordinal: number, playerTowardNamba: boolean) => Consist) {
  interface View { group: THREE.Group; cars: TrainCar[]; key: string; train?: CounterTrain }
  const pool: View[] = [];
  const horned = new Set<string>();
  let traffic: ReturnType<typeof createCounterTraffic> | undefined;
  const reset = () => { traffic = undefined; horned.clear(); for (const v of pool) { v.group.visible = false; v.train = undefined; for (const c of v.cars) c.setDoors(false); } };
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const update = () => {
    if (!counterTimetable(ctx.route.id, ctx.envState.timeOfDay) || ctx.route.singleTrack) return false;
    traffic ??= createCounterTraffic(ctx.route, ctx.envState.timeOfDay, consist);
    traffic.update(ctx.route.startClock + ctx.state.t);
    const ps = ctx.state.train.s;
    const visible = new Set(traffic.trains.filter(o => o.active && o.head <= ctx.route.extent.to && o.head + o.length >= ctx.route.extent.from && o.head > ps - 500 - ctx.route.trainLength && o.head < ps + 2400));
    for (const view of pool) if (view.train && !visible.has(view.train)) { view.group.visible = false; view.train = undefined; }
    let proximity = 0;
    for (const o of visible) {
      let view = pool.find(v => v.train === o);
      if (!view) {
        const key = JSON.stringify([o.spec.kind, o.spec.cars, o.spec.units, o.spec.unitKinds, o.spec.label, o.spec.dest]);
        view = pool.find(v => !v.train && v.key === key);
        if (!view) {
          const group = new THREE.Group(); ctx.scene.add(group);
          const cars = createTrainSet(o.spec.kind, o.spec.cars, ctx.renderer, { units: o.spec.units, unitKinds: o.spec.unitKinds, label: o.spec.label, dest: o.spec.dest });
          for (const c of cars) group.add(c.object);
          view = { group, cars, key }; pool.push(view);
        }
        view.train = o; view.group.visible = true;
      }
      let s0 = o.head;
      const sta = o.station == null ? null : ctx.route.stations[o.station];
      const lat = traffic.laneAt(o, o.head + o.length / 2);
      const custom = sta?.layout === 'custom' ? customPlatformSide(sta, lat) : undefined;
      const side = custom ? (custom === 'L' ? 'R' : 'L') : o.paths.some(p => p.station === o.station && p.zone) ? 'R' : sta?.island ? 'R' : 'L';
      for (const car of view.cars) {
        const s = s0 + car.length / 2, bogie = car.length / 2 - 2.85;
        pa.copy(ctx.track.at(s - bogie, traffic.laneAt(o, s - bogie), .38));
        pb.copy(ctx.track.at(s + bogie, traffic.laneAt(o, s + bogie), .38));
        placeCar(car.object, pa, pb); car.setDoors(o.stopped, side); s0 += car.length;
      }
      const tail = o.head + o.length, distance = o.head > ps ? o.head - ps : tail > ps ? 0 : ps - tail;
      if (!horned.has(o.id) && o.v > 1 && o.head > ps && o.head - ps < 260) {
        horned.add(o.id); ctx.events.emit('oncomingHorn', { distance: o.head - ps });
      }
      proximity = Math.max(proximity, Math.max(0, 1 - distance / 60) * Math.min(1, (ctx.state.train.v + o.v) / 8));
    }
    ctx.events.emit('oncomingPass', { proximity });
    return true;
  };
  return {
    update, reset,
    spans: () => traffic?.trains.filter(o => o.active && o.v > .1).map(o => ({ head: o.head, tail: o.head + o.length })) ?? [],
    debug: () => traffic?.trains.map(o => ({ id: o.id, label: o.spec.label, head: Math.round(o.head), len: Math.round(o.length), lat: +traffic!.laneAt(o, o.head).toFixed(1), kmh: Math.round(o.v * 3.6), active: o.active, started: o.active || o.finished, done: o.finished, phase: o.stopped ? 'stopped' : o.v < .1 ? 'held' : 'cruise', stop: o.station, delay: Math.round(o.delay) })),
  };
}
