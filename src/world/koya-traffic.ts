// 南海本線 堺〜難波（route.id = 'namba'）専用: 高野線の電車（走行・停車）と汐見橋線の停車中の 2000系（2両）、萩ノ茶屋・今宮戎のホーム（描画のみ）
// どちらも ctx.rng を消費しない（buildIsland の人の配置だけ独自の乱数を使う）。buildKoyaTraffic は車両生成で DOM を使うので world/index.ts からだけ呼ぶ
// 走行する電車: 高野線上り（難波行き = s 増加）は右の遠方から合流して難波の 4番線へ、下り（s 減少）は難波の 2番線から出て右へ去る
// （3番線・1番線は留置の 30000系・6300系が使う。world/namba-terminal.ts の buildNambaParked）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { createRng } from '../core/rng';
import type { LatProfile, Station, TrainKind } from '../route/types';
import { KOYA_STATIONS, NAMBA_END, NAMBA_STOP } from '../route/routes/namba';
import { profileLat } from '../route/service';
import { onLight } from './batch';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { buildIsland } from './stations';
import { bogieOffset, createTrainSet, setTrainNight, type TrainCar } from './train-models';

/** 高野線だけの駅（萩ノ茶屋・今宮戎）の島式ホーム。下り線が外へ開いて、上り線（lat 9）との間に置く */
export function buildKoyaPlatforms(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  const sub = Object.assign(Object.create(ctx), { rng: createRng(4242) }) as GameContext; // 人の配置用（ctx.rng は使わない）
  const adj = [['天下茶屋', '新今宮'], ['新今宮', '難波']];
  KOYA_STATIONS.forEach((k, i) => {
    const sta: Station = {
      name: k.name, kana: k.kana, stopS: k.to - 40, platform: { from: k.from, to: k.to, side: 'R' }, scheduledArrival: 0, elevated: true,
    };
    buildIsland(sub, sta, adj[i][0], adj[i][1], 13.7, 6, { stairs: false, roof: .6 });
  });
}

// ---- 走行する電車 ----
interface Variant { kind: TrainKind; units: number[]; label: string; dest: string }
interface Slot { dir: 1 | -1; v: Variant; /** 難波側の番線（up: 4、down: 2。3・1番線は留置用） */ bay: number }
const V = {
  new4: (label: string, dest: string): Variant => ({ kind: 'commuter-new', units: [4], label, dest }),
  new6: (label: string, dest: string): Variant => ({ kind: 'commuter-new', units: [4, 2], label, dest }),
  // 2300系は橋本〜極楽橋の専用（なんばへは来ない）。4両の各停は 2000系
  z4: (label: string, dest: string): Variant => ({ kind: 'commuter-2000', units: [2, 2], label, dest }),
  ss4: (label: string, dest: string): Variant => ({ kind: 'commuter-6300', units: [4], label, dest }),
  ss6: (label: string, dest: string): Variant => ({ kind: 'commuter-6300', units: [4, 2], label, dest }),
  ss8: (label: string, dest: string): Variant => ({ kind: 'commuter-6300', units: [4, 4], label, dest }),
  kouya: (dest: string): Variant => ({ kind: 'limited-30000', units: [4], label: 'こうや', dest }),
  z8: (label: string, dest: string): Variant => ({ kind: 'commuter-2000', units: [4, 4], label, dest }),
};
/** 出現の順番（上り・下りを交互に。両数・車種・種別が混在） */
const SLOTS: Slot[] = [
  { dir: 1, v: V.new6('急行', '難波'), bay: 4 },
  { dir: -1, v: V.ss8('準急', '和泉中央'), bay: 2 },
  { dir: 1, v: V.kouya('難波'), bay: 4 },
  { dir: -1, v: V.z4('各停', '河内長野'), bay: 2 },
  { dir: 1, v: V.z4('各停', '難波'), bay: 4 },
  { dir: -1, v: V.z8('急行', '橋本'), bay: 2 },
  { dir: 1, v: V.ss6('各停', '難波'), bay: 4 },
  { dir: -1, v: V.kouya('極楽橋'), bay: 2 },
  { dir: 1, v: V.z8('急行', '難波'), bay: 4 },
  { dir: -1, v: V.ss4('各停', '北野田'), bay: 2 },
  { dir: 1, v: V.new4('各停', '難波'), bay: 4 },
];

/** 停車駅（高野線がホームに沿う区間）。local = 各停だけ停車 */
const HALTS = [
  { from: 6800, to: 7020, local: false, doors: 'island' as const },
  { from: KOYA_STATIONS[0].from, to: KOYA_STATIONS[0].to, local: true, doors: 'koya' as const },
  { from: 8400, to: 8620, local: false, doors: 'island' as const },
  { from: KOYA_STATIONS[1].from, to: KOYA_STATIONS[1].to, local: true, doors: 'koya' as const },
];

// 難波の 4・2番線での停止位置（車止め側の端）は本線の停止位置にそろえる
const ENTRY_S = 5850, THROAT_S = 9400, STOP_END = NAMBA_STOP;
const DECEL = .9, ACCEL = .8, V_RUN = 60 / 3.6, V_THROAT = 30 / 3.6;
const DWELL = 25, DWELL_TERM = 40, SPAWN_RANGE = 2500, MAX_ALIVE = 4, SPAWN_GAP = 10;
/** 同じ向きの列車の出現間隔の下限 [s] と、出現位置の前方に空ける距離 [m]（各駅で停まる列車の後ろに詰まらないように） */
const HEADWAY = 80, SPAWN_CLEAR = 500;
/** 難波行きの出現位置は自列車からこれ以上離さない [m]（消える距離 SPAWN_RANGE + 600 の内側。自列車が難波の近くでも出せるように） */
const SPAWN_MAX_DIST = 2900;

interface Stop { s: number; dwell: number; doors: 'L' | 'R' | 'both'; done: boolean }
interface Running {
  slot: Slot; cars: TrainCar[]; group: THREE.Group; key: string; len: number;
  /** 先頭の s */
  pos: number; v: number; stops: Stop[]; wait: number; end: boolean;
  lat: (s: number) => number;
}

export function buildKoyaTraffic(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  const { scene, track, events, route } = ctx, st = ctx.state;
  const prof = (id: string): LatProfile => route.extraTracks!.find(t => t.id === id)!.lat;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));

  // ---- 汐見橋線: 行き止まりの手前に停まる 2000系 2両（支線用。ドアはホーム = 左の側だけ） ----
  {
    const lat = prof('shiomibashi'), cars = createTrainSet('commuter-2000', 2, ctx.renderer, { dest: '汐見橋', label: '普通', units: [2] });
    const group = new THREE.Group(); group.name = 'koya-parked-shiomibashi';
    let d = 5965 + 4; // 先頭を車止めの手前 4m に置き、s の増える向きへ連ねる（向きは s 減少 = 進行方向の右がホーム）
    for (const c of cars) {
      d += c.length / 2;
      const bog = bogieOffset(c.length);
      pa.copy(track.at(d - bog, profileLat(lat, d - bog), .38)); pb.copy(track.at(d + bog, profileLat(lat, d + bog), .38));
      placeCar(c.object, pa, pb); group.add(c.object);
      c.setDoors(true, 'R'); // 進行方向（s 減少）に対して右 = lat の小さい側 = ホーム
      d += c.length / 2;
    }
    scene.add(group); cullByDistance(ctx, group, 420);
  }

  // ---- 走行する電車 ----
  const pool = new Map<string, { group: THREE.Group; cars: TrainCar[]; len: number; inUse: boolean }[]>();
  const keyOf = (v: Variant) => `${v.kind}:${v.units.join('+')}:${v.label}:${v.dest}`;
  const acquire = (v: Variant) => {
    const key = keyOf(v);
    let arr = pool.get(key); if (!arr) { arr = []; pool.set(key, arr); }
    let e = arr.find(x => !x.inUse);
    if (!e) {
      const cars = createTrainSet(v.kind, v.units.reduce((a, b) => a + b, 0), ctx.renderer, { dest: v.dest, label: v.label, units: v.units });
      const group = new THREE.Group(); group.name = 'koya-train'; group.visible = false; scene.add(group);
      for (const c of cars) group.add(c.object);
      e = { group, cars, len: cars.reduce((a, c) => a + c.length, 0), inUse: false }; arr.push(e);
    }
    e.inUse = true; for (const c of e.cars) c.setDoors(false);
    return { e, key };
  };
  const trains: Running[] = [];
  const release = (t: Running) => {
    t.group.visible = false;
    const e = pool.get(t.key)?.find(x => x.group === t.group); if (e) e.inUse = false;
  };

  /** 難波側の番線へ分かれる前は同じ線（高野線）を走る */
  const latFn = (s: Slot): ((s: number) => number) => {
    const main = prof(s.dir === 1 ? 'koya-up' : 'koya-down');
    if (s.bay === 3) { const p = prof('namba-3'); return x => profileLat(x < THROAT_S ? main : p, x); }
    if (s.bay === 1) { const p = prof('namba-1'); return x => profileLat(x < 9360 ? main : p, x); }
    return x => profileLat(main, x);
  };

  let idx = 0, cool = 5, clock = 0;
  /** 向きごとの最後の出現時刻（上り・下り） */
  const lastSpawn = [-HEADWAY, -HEADWAY];
  /** 難波行きの出現位置: 合流の手前（ENTRY_S）。自列車が難波に近いときは自列車から SPAWN_MAX_DIST の位置（高野線の上で、見えない距離） */
  const entryOf = (ps: number) => Math.max(ENTRY_S, Math.min(ps - SPAWN_MAX_DIST, STOP_END - 800));
  const canSpawn = (s: Slot, ps: number): boolean => {
    // 出現位置が見える範囲（自列車の前後 SPAWN_RANGE）のときだけ。難波発は自列車が難波に近いときだけ
    if (s.dir === 1 ? ps < ENTRY_S - SPAWN_RANGE : ps < ENTRY_S + 1000 || ps > NAMBA_END) return false;
    const entry = entryOf(ps);
    for (const t of trains) {
      if (t.slot.dir !== s.dir) continue;
      // 同じ向きの列車と出現位置が近いうちは出さない
      if (s.dir === 1 ? t.pos - t.len < entry + SPAWN_CLEAR && t.pos > entry - 400 : t.pos + t.len > STOP_END - SPAWN_CLEAR) return false;
    }
    return clock - lastSpawn[s.dir === 1 ? 0 : 1] >= HEADWAY;
  };

  function spawn(slot: Slot, ps: number): void {
    const { e, key } = acquire(slot.v);
    const dir = slot.dir, len = e.len, local = slot.v.label === '各停';
    const doorsOf = (h: typeof HALTS[number]): Stop['doors'] => h.doors === 'island' ? 'L' : 'R';
    // 天下茶屋・新今宮: 上り（lat 14.4）は島式が左、下り（lat 18.4）は右の片面が進行方向左。萩ノ茶屋・今宮戎: どちらも島式が右
    const halts = HALTS.filter(h => local || !h.local);
    const entry = entryOf(ps);
    const stops: Stop[] = (dir === 1 ? halts.filter(h => h.to - 6 > entry) : [...halts].reverse()).map(h => ({
      s: dir === 1 ? h.to - 6 : h.from + 6, dwell: DWELL, doors: doorsOf(h), done: false,
    }));
    if (dir === 1) stops.push({ s: STOP_END, dwell: DWELL_TERM, doors: 'both', done: false });
    const t: Running = {
      slot, cars: e.cars, group: e.group, key, len,
      pos: dir === 1 ? entry : STOP_END - len, v: 0, stops, wait: dir === 1 ? 0 : DWELL_TERM, end: false, lat: latFn(slot),
    };
    if (dir === -1) for (const c of t.cars) c.setDoors(true);
    else t.v = V_RUN;
    trains.push(t);
  }

  /** 前を行く同じ向きの列車の手前で止まれる速度の上限 [m/s] */
  function followCap(t: Running): number {
    let cap = Infinity;
    for (const q of trains) {
      if (q === t || q.slot.dir !== t.slot.dir) continue;
      const gap = t.slot.dir === 1 ? q.pos - q.len - t.pos : t.pos - (q.pos + q.len);
      if (gap < 0 || gap > 400) continue;
      cap = Math.min(cap, Math.sqrt(2 * DECEL * Math.max(0, gap - 35)));
    }
    return cap;
  }

  const mid = new THREE.Vector3();
  function place(t: Running, dir: 1 | -1): void {
    let off = 0;
    for (const c of t.cars) {
      const sc = t.pos - dir * (off + c.length / 2), bog = bogieOffset(c.length);
      // 前側の台車が進行方向
      const sf = sc + dir * bog, sr = sc - dir * bog;
      pa.copy(track.at(sf, t.lat(sf), .38)); pb.copy(track.at(sr, t.lat(sr), .38));
      placeCar(c.object, pa, pb);
      off += c.length;
    }
  }

  function step(t: Running, dt: number): void {
    const dir = t.slot.dir;
    if (t.wait > 0) {
      t.wait -= dt;
      if (t.wait <= 0) {
        for (const c of t.cars) c.setDoors(false);
        if (t.stops.length === 0 || (dir === 1 && t.stops.every(x => x.done))) t.end = true;
      }
      return;
    }
    const next = t.stops.find(x => !x.done);
    const cruise = (dir === 1 ? t.pos : t.pos + t.len) > THROAT_S ? V_THROAT : V_RUN;
    let vT = Math.min(cruise, followCap(t));
    let d = Infinity;
    if (next) {
      d = (next.s - t.pos) * dir;
      if (d < 0) d = 0;
      vT = Math.min(vT, Math.max(Math.sqrt(2 * DECEL * d), d > .25 ? 1 : 0));
    }
    t.v += Math.max(-DECEL * 1.3 * dt, Math.min(ACCEL * dt, vT - t.v));
    if (t.v < 0) t.v = 0;
    t.pos += dir * t.v * dt;
    if (next && (next.s - t.pos) * dir <= Math.max(.25, t.v * dt)) {
      t.pos = next.s; t.v = 0; next.done = true; t.wait = next.dwell;
      for (const c of t.cars) next.doors === 'both' ? c.setDoors(true) : c.setDoors(true, next.doors);
    }
    // 下りは 5850 を抜けたら消す（上りは終点で待った後に消す）
    if (dir === -1 && t.pos + t.len < ENTRY_S - 20) t.end = true;
  }

  events.on('frame', ({ dt }) => {
    if ((st.state !== 'run' && st.state !== 'dwell') || st.paused) return;
    const ps = st.train.s, step_dt = Math.min(dt, .1);
    cool -= step_dt; clock += step_dt;
    if (cool <= 0 && trains.length < MAX_ALIVE) {
      // 順番の枠が出せない向きなら、先の枠から出せるものを探す（待たずに次の向きへ）
      const k = [0, 1, 2, 3].find(j => canSpawn(SLOTS[(idx + j) % SLOTS.length], ps));
      if (k != null) { const sl = SLOTS[(idx + k) % SLOTS.length]; spawn(sl, ps); lastSpawn[sl.dir === 1 ? 0 : 1] = clock; idx += k + 1; cool = SPAWN_GAP; }
    }
    for (let i = trains.length - 1; i >= 0; i--) {
      const t = trains[i];
      step(t, step_dt);
      const far = Math.min(Math.abs(t.pos - ps), Math.abs(t.pos + t.len - ps)) > SPAWN_RANGE + 600;
      if (t.end || far) { release(t); trains.splice(i, 1); continue; }
      // 遠くは描かない（位置も更新しない）
      const m = t.slot.dir === 1 ? t.pos - t.len / 2 : t.pos + t.len / 2;
      mid.copy(track.at(m, t.lat(m), 5));
      const vis = mid.distanceTo(ctx.camera.position) < 700 + t.len;
      t.group.visible = vis;
      if (vis) place(t, t.slot.dir);
    }
  });
  if (import.meta.env.DEV) (window as any).__koyaDebug = () => trains.map(t => ({ dir: t.slot.dir, kind: t.slot.v.kind, pos: Math.round(t.pos), len: Math.round(t.len), kmh: Math.round(t.v * 3.6), wait: Math.round(t.wait) }));
  events.on('reset', () => {
    for (const t of trains) release(t);
    trains.length = 0; idx = 0; cool = 5; clock = 0; lastSpawn[0] = lastSpawn[1] = -HEADWAY;
  });
}
