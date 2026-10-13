// 対向列車。南海本線は oncoming-timetable の時刻付き共通運行を使う。
// 以下の路線設定による処理は、実ダイヤ未収録のコース・単線交換用。警笛・すれ違いをイベントで通知。
// 走り抜けるものと、駅（spec.stop）に停車してドアを開け、自列車が同じ駅で停車して少し経つと発車するものがある
// 2面4線駅（汐見町・海浜公園）の対向側には待避線（対向線の +lat 側へ鏡像）があり、対向の普通（spec.stop.loop）はそこへ分岐器（制限 45km/h）で入って停車し、
// 島式ホーム側のドアだけ開ける。同じ駅の対向の優等列車（spec.follow）は本線に停車 / 通過し、普通はその優等列車が分岐器を抜けてから発車する
// 同時に走る対向列車は、走路が重ならないものだけ（出現位置が他の編成の走路と重なるうちは出さない）。同じ線の前後の編成は間隔を保つ。車両セットは種別・両数ごとに使い回す
// 単線（route.singleTrack）: 交換駅で行き違う対向列車（route.meets）は game/meet.ts が動かし（st.meet）、ここでは描画・ドア・警笛のみ。右の線（+spread）を走る
// ラッシュ時（朝・夜）は、対向の停車シーンが無い途中駅にも停車する対向列車を足す（複線のみ。route/oncoming-stops.ts の rushStopScenes）
// spec.kind 未指定なら 普通(新型4両) → 急行(旧型6両) → 特急(6両) の順に割り当てる
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { OncomingSpec, ServiceId, Station, TimeOfDay, TrainKind } from '../route/types';
import { carLenOf, customPlatformSide, islandOffset, loopShape, loopZone, sameClass, serviceOf, WAKAYAMA_DEST, type LoopZone } from '../route/service';
import { classOfSpec, hourlyOf, planOncoming, runClasses, runConsist, rushStopScenes, tokkyuOrder, type TrainClass } from '../route/oncoming-stops';
import MEETS from '../data/oncoming-meets.json';
import { counterTimetable, createTimetableOncoming } from './oncoming-timetable';
import { onLight } from './batch';
import { placeCar } from './emu';
import { createTrainSet, setTrainNight, TRAIN_KINDS, type TrainCar } from './train-models';

/** 車両セット（種別・両数・表示ごとに1つ。使用中は他の編成へ貸さない） */
interface SetView { key: string; group: THREE.Group; cars: TrainCar[]; length: number; inUse: boolean }

/** cruise = 巡航、brake = 停車駅へ制動、stopped = 停車（ドア開）、closing = 戸閉め、accel = 発車（以後は cruise） */
type Phase = 'cruise' | 'brake' | 'stopped' | 'closing' | 'accel';

interface OncomingTrain {
  spec: OncomingSpec;
  /** 間引き前の設定（停車シーン。plan で停車しない扱いになると spec は stop を外したもの） */
  spec0: OncomingSpec;
  /** 今回のプレイでの扱い（planOncoming） */
  mode: 'stop' | 'run' | 'off';
  kind: TrainKind;
  /** route.oncoming の添字（follow の相手 = 前の要素） */
  idx: number;
  /** 待避線に停車する編成の待避線区間 */
  zone: LoopZone | null;
  view: SetView | null;
  active: boolean;
  done: boolean;
  /** 出現済み（reset まで） */
  started: boolean;
  head: number;
  /** 速度 [m/s] */
  v: number;
  phase: Phase;
  /** 停車駅を発車済み */
  left: boolean;
  /** 停車してからの経過 / 戸閉めからの経過 / 自列車が同じ駅で停車してからの経過 [s] */
  tStop: number;
  tClose: number;
  tPlayer: number;
  horn: boolean;
  /** ラッシュ時（朝・夜）だけ出す編成 */
  rush: boolean;
  /** 途中の停車駅（停車しないすれ違いの編成が、自分の種別の停車駅で停まる。自列車は待たない）。s の大きい順 */
  halts: Halt[];
  /** 制動・停車中の停車駅（停車シーンの stop か halts の要素） */
  cur: Halt | null;
  /** 実際のダイヤから作った編成（data/oncoming-meets.json）。出現の判定を出現位置の付近だけにする */
  real?: boolean;
}

/** 停車駅。scene = 停車シーン（自列車を待つ）。dwell = 停車時間 [s]（scene 以外） */
interface Halt { station: number; headS: number; scene: boolean; dwell: number; done: boolean }

export interface OncomingSystem {
  /** 走行中の対向列車の範囲（先頭 s < 最後尾 s）。踏切制御用。停車中の列車は含めない */
  activeSpans(): { head: number; tail: number }[];
}

/** 既定の種別ローテーション */
const MIX: { kind: TrainKind; cars: number; kmhScale: number }[] = [
  { kind: 'commuter-new', cars: 4, kmhScale: .95 },
  { kind: 'commuter-old', cars: 6, kmhScale: 1 },
  { kind: 'limited', cars: 6, kmhScale: 1.12 },
  { kind: 'commuter-1000', cars: 6, kmhScale: 1 },
];

/** 制動・加速度 [m/s²] */
const DECEL = .9, ACCEL = .8;
/** 停車してから発車できるまでの最短時間（自列車が来る前でも）・自列車の停車後に待つ時間・待ち続ける上限・戸閉めの時間 [s] */
const MIN_DWELL = 12, AFTER_PLAYER = 8, MAX_DWELL = 300, CLOSE_T = 5;
/** 途中の停車駅の停車時間（戸閉めの前まで）[s]: 普通 / 急行・特急 */
const HALT_DWELL_LOCAL = 18, HALT_DWELL_FAST = 22;
/** 停止位置: ホームの手前端（対向列車から見て）からの余裕 [m]（route/oncoming-stops.ts の HEAD_MARGIN と同じ） */
const HALT_MARGIN = 8;
/** 出現させる最小距離 [m]（自列車の前方これ以上遠くでないと、出現が見えるので出さない） */
const MIN_SPAWN_DIST = 800;
/** 自列車の後方にこれ以上離れたら消す [m]（編成長に加える） */
const VANISH = 250;

/** 停車中の対向列車のドアを開ける側（対向列車の進行方向に対して）。相対式・2面4線の本線: ホームは対向線の外側（+lat）= 左、島式1面2線: ホームは線間 = 右、
 *  2面4線の対向側の待避線: 島式ホームは待避線の内側（-lat）= 右。
 *  custom 駅は停車位置の横位置 lat に面するホームから決める（platform.side は自列車の種別の側なので使わない）。自列車から見た側の逆 */
const doorSide = (sta: Station, loop: boolean, lat: number): 'L' | 'R' => {
  if (sta.layout === 'custom') { const s = customPlatformSide(sta, lat); if (s) return s === 'L' ? 'R' : 'L'; }
  return sta.island ? 'R' : sta.loop ? (loop ? 'R' : 'L') : sta.platform.side;
};

/** 待避線を使う編成の速度制限 [m/s] = 分岐器制限。入口の手前から制動で合わせ、区間内は一定、後部が抜けるまで（出発時）制限する */
function zoneCap(z: LoopZone, head: number, len: number): number {
  const vl = z.limit / 3.6;
  if (head > z.outTo) return Math.sqrt(vl * vl + 2 * DECEL * (head - z.outTo));
  return head + len > z.inFrom ? vl : Infinity;
}
/** 同じ線で前を行く編成との最小間隔（停止時）[m] */
const FOLLOW_GAP = 60;
/** 実際のダイヤから作った停車しない編成: 出現位置の手前に空けておく距離 [m]・すれ違う位置の何 m 手前（自列車）/ 先（対向列車）から出すか */
const REAL_CLEAR = 300, REAL_LEAD = 900;
/** 同じ線とみなす横位置の差 [m] */
const SAME_LANE = 3.4;
/** 優等列車の出現: 普通が出現位置からこれだけ進んでから（出現位置の重なりを避ける）[m] */
const FOLLOW_AFTER = 100;
/** 優等列車が出口分岐器側を抜けたとみなす余裕 [m]（通過列車の後部が待避線区間の入口よりこれだけ先へ出たら、待避線の普通が発車してよい） */
const CLEAR_MARGIN = 30;

export function createOncoming(ctx: GameContext): OncomingSystem {
  const { scene, track, events, route } = ctx, st = ctx.state;
  const dest = route.stations[0]?.name ?? route.prevName ?? '';
  const sets = new Map<string, SetView[]>();
  const labelOf = (o: { spec: OncomingSpec; kind: TrainKind }) => o.spec.label ?? TRAIN_KINDS[o.kind].service;
  const keyOf = (o: { spec: OncomingSpec; kind: TrainKind }) => `${o.spec.unitKinds?.join('+') ?? o.kind}:${o.spec.units?.join('+') ?? o.spec.cars}:${labelOf(o)}:${o.spec.dest ?? dest}`;
  const build = (o: { spec: OncomingSpec; kind: TrainKind }): SetView => {
    const key = keyOf(o);
    const group = new THREE.Group(); group.visible = false; group.name = `oncoming-${o.kind}`; scene.add(group);
    const list = createTrainSet(o.kind, o.spec.cars, ctx.renderer, { dest: o.spec.dest ?? dest, label: labelOf(o), units: o.spec.units, unitKinds: o.spec.unitKinds });
    for (const c of list) group.add(c.object);
    const v: SetView = { key, group, cars: list, length: list.reduce((a, c) => a + c.length, 0), inUse: false };
    const arr = sets.get(key) ?? []; arr.push(v); sets.set(key, arr);
    return v;
  };
  // ラッシュ用の編成は末尾に足す（follow は直前の要素を相手にするので、既存の並びを崩さない）
  // 複々線の駅では対向の普通は緩行線（route.oncomingLocal の横位置）に停まる
  const ol = route.oncomingLocal;
  const rushSpecs = (route.singleTrack ? [] : rushStopScenes(route.stations, route.oncoming))
    .map(o => ol && o.stop && ol.stations.includes(o.stop.station) ? { ...o, lat: ol.lat } : o);
  const trains: OncomingTrain[] = [...route.oncoming, ...rushSpecs].map((spec0, i) => {
    const mix = MIX[i % MIX.length];
    const spec: OncomingSpec = spec0.kind ? spec0 : { ...spec0, kind: mix.kind, cars: mix.cars, kmh: Math.round(spec0.kmh * mix.kmhScale) };
    const zone = spec.stop?.loop ? spec.stop.zone ?? loopZone(route.stations[spec.stop.station]) : null;
    return { spec, spec0: spec, mode: 'stop', kind: spec.kind!, idx: i, zone, view: null, active: false, done: false, started: false, head: 0, v: 0, phase: 'cruise', left: false, tStop: 0, tClose: 0, tPlayer: 0, horn: false, rush: i >= route.oncoming.length, halts: [], cur: null } as OncomingTrain;
  });
  const RUSH_TIMES = new Set(['morning', 'night']);
  /** 路線データから作った編成の一覧（実際のダイヤのすれ違いリストが無いときに使う） */
  const baseTrains = [...trains];
  const lenOf = (o: OncomingTrain) => o.view ? o.view.length : o.spec.cars * (o.spec.carLen + o.spec.gap);
  /** 待避線に停車する編成について、同じ駅の優等列車（後ろに続く follow の要素）。無ければ null */
  const followerOf = (o: OncomingTrain): OncomingTrain | null => { const f = trains[o.idx + 1]; return o.zone && f?.spec.follow ? f : null; };
  const leaderOf = (o: OncomingTrain): OncomingTrain | null => o.spec.follow ? trains[o.idx - 1] ?? null : null;
  /** 編成の走る線の横位置（待避線に入る編成は分岐器で +lat 側の待避線へ） */
  const laneLat = (o: OncomingTrain, s: number): number => {
    const lat = o.spec.lat;
    if (route.singleTrack) return islandOffset(route, 0, s, 1);
    return lat + islandOffset(route, lat, s) + (o.zone ? -o.zone.lat * loopShape(o.zone, s) : 0);
  };
  // 種別・両数ごとに1セットを先に作る（出現時の負荷を避ける）
  if (!counterTimetable(route.id, ctx.envState.timeOfDay)) for (const o of trains) if (!sets.has(keyOf(o))) build(o);
  const acquire = (o: OncomingTrain): SetView => {
    const v = sets.get(keyOf(o))?.find(x => !x.inUse) ?? build(o);
    v.inUse = true; v.group.visible = true;
    for (const c of v.cars) c.setDoors(false);
    return v;
  };
  const release = (o: OncomingTrain) => { if (o.view) { o.view.inUse = false; o.view.group.visible = false; o.view = null; } };
  // 窓明かり・前照灯グロー（全編成共通。トンネル内でも点灯）
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));

  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  function place(o: OncomingTrain) {
    let s0 = o.head;
    for (const c of o.view!.cars) {
      const s = s0 + c.length / 2, bog = c.length / 2 - .25 - 2.6;
      // s が減る向きへ走るので前側台車は s - bog
      // 島式ホーム駅では対向線もホームの反対側へ開く
      pa.copy(track.at(s - bog, laneLat(o, s - bog), .38)); pb.copy(track.at(s + bog, laneLat(o, s + bog), .38));
      placeCar(c.object, pa, pb);
      s0 += c.length;
    }
  }

  const finish = (o: OncomingTrain) => { o.active = false; o.done = true; release(o); };

  /** 前を行く編成（self より先頭が s の小さい側）の車体と、同じ線で重なる位置の手前で止まれる速度の上限 [m/s]。
   *  待避線の普通が分岐器へ入る前の本線で後ろの優等列車が間隔を保つ。待避線から本線へ戻る普通が、本線を走る編成の横へ合流しない */
  function followLimit(o: OncomingTrain): number {
    let lim = Infinity;
    for (const q of trains) {
      if (q === o || !q.active || !q.view || q.head >= o.head) continue;
      const qt = q.head + q.view.length;
      // o の先頭が進む先（s が減る向き）で、q の車体のうち最初に同じ線で重なる位置
      for (let s = Math.min(o.head, qt); s >= q.head; s -= 6) {
        if (Math.abs(laneLat(o, s) - laneLat(q, s)) >= SAME_LANE) continue;
        lim = Math.min(lim, Math.sqrt(2 * DECEL * Math.max(0, o.head - s - FOLLOW_GAP)));
        break;
      }
    }
    return lim;
  }

  /** 待避線の普通が発車してよいか: 同じ駅の優等列車が（停車するなら発車済み、通過するなら後部が待避線区間を抜けて）本線から退いている */
  function followerClear(o: OncomingTrain): boolean {
    const f = followerOf(o);
    if (!f || !o.zone) return true;
    if (f.done) return true;
    if (!f.active || !f.view) return false; // まだ出現していない
    return f.spec.stop ? f.left : f.head + f.view.length < o.zone.inFrom - CLEAR_MARGIN;
  }

  /** 戻り値 = すれ違いの近さ 0..1（非走行なら -1） */
  /** 次の停車駅: 停車シーン（発車前）→ 途中の停車駅（先頭より先にあるもの） */
  function nextHalt(o: OncomingTrain): Halt | null {
    const stop = o.spec.stop;
    if (stop && !o.left) return { station: stop.station, headS: stop.headS, scene: true, dwell: 0, done: false };
    return o.halts.find(h => !h.done && h.headS < o.head - 1) ?? null;
  }

  function update(o: OncomingTrain, dt: number, ps: number, pv: number): number {
    const O = o.spec, vmax = O.kmh / 3.6, view = o.view!;
    const len = view.length;
    const hold = followLimit(o), cap = Math.min(hold, o.zone ? zoneCap(o.zone, o.head, len) : Infinity);
    switch (o.phase) {
      case 'cruise': {
        o.v = Math.min(vmax, cap);
        const h = nextHalt(o);
        if (h && o.head - h.headS <= o.v * o.v / (2 * DECEL) + 1) { o.cur = h; o.phase = 'brake'; }
        break;
      }
      case 'brake': {
        const stop = o.cur!;
        const d = Math.max(o.head - stop.headS, .5);
        const vb = Math.max(0, o.v - Math.max(DECEL, o.v * o.v / (2 * d)) * dt);
        // 前の編成・分岐器制限に合わせて遅い間は、停止位置に着いたとは扱わない
        if (cap < vb) { o.v = cap; break; }
        o.v = vb;
        // 停止位置の手前 1.5m 以内で止まったら位置を合わせる
        if (o.v < .15 || o.head - stop.headS < .3) {
          if (o.head - stop.headS < 1.5) o.head = stop.headS;
          o.v = 0; o.phase = 'stopped'; o.tStop = 0; o.tPlayer = 0;
        }
        break;
      }
      case 'stopped': {
        o.tStop += dt;
        const stop = o.cur!;
        // 途中の停車駅: 停車時間が過ぎたら発車（自列車は待たない）
        if (!stop.scene) { if (o.tStop >= stop.dwell) { o.phase = 'closing'; o.tClose = 0; } break; }
        const sta = route.stations[stop.station];
        // 自列車が同じ駅に停車している間だけ数える。自列車が通過する駅では、通過し終えたら条件を満たす
        if (st.state === 'dwell' && st.target === stop.station) o.tPlayer += dt;
        const playerStops = !sta.pass, playerGone = !playerStops && ps > sta.platform.to + 30;
        if (o.tStop >= MIN_DWELL && ((playerStops && o.tPlayer >= AFTER_PLAYER) || playerGone || o.tStop >= MAX_DWELL) && (followerClear(o) || o.tStop >= MAX_DWELL)) { o.phase = 'closing'; o.tClose = 0; }
        break;
      }
      case 'closing':
        o.tClose += dt;
        if (o.tClose >= CLOSE_T) {
          o.phase = 'accel';
          if (o.cur?.scene) o.left = true; else if (o.cur) o.cur.done = true;
          const d = o.head - ps;
          if (Math.abs(d) < 500) { o.horn = true; events.emit('oncomingHorn', { distance: Math.max(0, d) }); }
        }
        break;
      case 'accel':
        o.v = Math.min(vmax, o.v + ACCEL * dt, cap);
        if (o.v >= vmax) o.phase = 'cruise';
        break;
    }
    o.head -= o.v * dt;
    // 停車中は戸を開ける（ホーム側のみ）、動き出したら閉める
    if (o.cur) {
      const open = o.phase === 'stopped', side = doorSide(route.stations[o.cur.station], !!o.zone, laneLat(o, o.cur.headS + len / 2));
      for (const c of view.cars) c.setDoors(open, side);
    }
    place(o);
    const tail = o.head + len, d = o.head - ps;
    if (!o.horn && !O.stop && d > 0 && d < 260) { o.horn = true; events.emit('oncomingHorn', { distance: d }); }
    if (tail < ps - VANISH - route.trainLength) { finish(o); return 0; }
    // すれ違い中（先頭〜最後尾が自車横）は風切り音。相対速度が小さいとき（停車中どうし）は鳴らさない。待避線の編成は線が遠い分だけ弱める
    const dist = d > 0 ? d : tail > ps ? 0 : ps - tail;
    return Math.max(0, 1 - dist / 60) * Math.min(1, (pv + o.v) / 8) * (o.zone ? .7 : 1);
  }

  /** 出現できるか。優等列車（follow）は待避線の普通が動き出してから。走路（停止位置 〜 出現位置）が他の出現中の編成と重なるうちは出さない */
  function canSpawn(o: OncomingTrain, ps: number): boolean | 'skip' {
    const leader = leaderOf(o);
    if (leader) {
      if (!leader.started) return leader.done ? 'skip' : false; // 普通が出なかった（近すぎた）なら出さない
      if (!leader.active) return 'skip';
      if (leader.head > leader.spec.startS - FOLLOW_AFTER) return false;
    }
    if (o.spec.startS - ps < MIN_SPAWN_DIST) return 'skip';
    // 実際のダイヤから作った停車しない編成は、出現位置の付近の同じ線だけを見る（間隔は実際のダイヤどおり。追いついたら followLimit で保つ）
    const near = !!o.real && !o.spec.stop;
    const lo = o.spec.stop ? o.spec.stop.headS - 100 : near ? o.spec.startS - REAL_CLEAR : -Infinity, hi = o.spec.startS + lenOf(o) + 20;
    for (const q of trains) {
      if (!q.active || q === leader) continue;
      if (near && Math.abs(laneLat(o, o.spec.startS) - laneLat(q, Math.min(Math.max(o.spec.startS, q.head), q.head + lenOf(q)))) >= SAME_LANE) continue;
      if (q.head <= hi && q.head + lenOf(q) >= lo) return false;
    }
    return true;
  }

  // ---------- 行き違いの対向列車（st.meet） ----------
  const meetSpecs: OncomingTrain[] = (route.meets ?? []).map((m, i) => ({
    mode: 'stop' as const, spec0: undefined as unknown as OncomingSpec,
    spec: { spawnAt: Infinity, startS: 0, cars: m.cars, carLen: 18, gap: .8, kmh: m.kmh, lat: 0, kind: m.kind, ...(m.label ? { label: m.label } : {}), ...(m.dest ? { dest: m.dest } : {}) },
    kind: m.kind, idx: -1 - i, zone: null, view: null, active: false, done: false, started: false, head: 0, v: 0, phase: 'cruise', left: false, tStop: 0, tClose: 0, tPlayer: 0, horn: false, rush: false, halts: [], cur: null,
  }));
  for (const o of meetSpecs) if (!sets.has(keyOf(o))) build(o);
  let meetHornStage = '';
  /** 戻り値 = すれ違いの近さ 0..1（非表示なら -1） */
  function updateMeet(ps: number, pv: number): number {
    const m = st.meet;
    for (const [i, o] of meetSpecs.entries()) {
      const show = !!m && m.spec === i && m.stage !== 'gone';
      if (!show) { if (o.active) { o.active = false; release(o); } continue; }
      if (!o.active) { o.active = true; o.view = acquire(o); meetHornStage = ''; }
      o.head = m!.head; o.v = m!.v;
      const open = m!.stage === 'stopped';
      for (const c of o.view!.cars) c.setDoors(open, 'R');
      place(o);
      // 警笛: 交換駅へ進入するとき・発車するとき（自列車の近く）
      const d = o.head - ps;
      if ((m!.stage === 'brake' && meetHornStage === '' && Math.abs(d) < 400) || (m!.stage === 'accel' && meetHornStage !== 'accel' && Math.abs(d) < 500)) {
        meetHornStage = m!.stage;
        events.emit('oncomingHorn', { distance: Math.max(0, d) });
      }
      const tail = o.head + o.view!.length, dist = d > 0 ? d : tail > ps ? 0 : ps - tail;
      return Math.max(0, 1 - dist / 60) * Math.min(1, (pv + o.v) / 8) * .8;
    }
    return -1;
  }

  /** 対向列車の本線（急行線）の横位置: 停車しない対向列車の設定の横位置（無ければ 4） */
  const mainOncomingLat = route.oncoming.find(o => !o.stop && !o.follow && o.lat !== route.oncomingLocal?.lat)?.lat ?? 4;
  /** 種別表示 → 種別（停車駅を引くため） */
  const serviceIdOf = (label: string): ServiceId => label.includes('サザン') ? 'southern' : label.includes('特急') ? 'limited'
    : label.includes('空港急行') ? 'airport' : label.includes('急行') ? 'express' : 'local';
  /** 対向列車が横位置 lat の線に停まったとき、ホームがあるか（custom 駅はホームの形から。浜寺公園の堺方面は本線にホームが無い） */
  const platformFor = (sta: Station, lat: number): boolean =>
    sta.layout === 'custom' ? !!customPlatformSide(sta, lat) : !(sta.layout === 'hamadera' && route.id.endsWith('-up'));
  /** すれ違う編成の途中の停車駅: 種別の停車駅（普通は全駅）のうち、出現位置より先にあり、走る線にホームがある駅 */
  function haltsOf(o: OncomingTrain, id: ServiceId): Halt[] {
    const svc = route.services?.find(v => v.id === id) ?? route.services?.find(v => sameClass(v.id, id));
    // ラピートαは堺・岸和田を通過（この路線の範囲で停まるのは なんば・新今宮・天下茶屋）
    const alpha = o.spec.label?.includes('α');
    const stops = (id === 'local' || !svc ? route.stations.map((_, i) => i) : svc.stops)
      .filter(i => !alpha || ['なんば', '難波', '新今宮', '天下茶屋'].includes(route.stations[i].name));
    const len = o.spec.cars * (o.spec.carLen + o.spec.gap), dwell = id === 'local' ? HALT_DWELL_LOCAL : HALT_DWELL_FAST;
    return stops.map((i): Halt => ({ station: i, headS: route.stations[i].platform.from + HALT_MARGIN, scene: false, dwell, done: false }))
      .filter(h => {
        const sta = route.stations[h.station];
        if (h.headS > o.spec.startS - 100 || h.headS + len > sta.platform.to + 1) return false; // 出現位置の先・ホームに収まる
        return platformFor(sta, laneLat(o, h.headS + len / 2));
      })
      .sort((a, b) => b.headS - a.headS);
  }

  /** 実際のダイヤのすれ違いリスト → 編成の一覧。停車中の相手は駅に停まる場面（普通は待避線・緩行線）、走行中の相手は すれ違う位置の手前から出す */
  function realTrains(list: [number, string, number][], _tod: TimeOfDay, towardNamba: boolean): OncomingTrain[] {
    const nth: Record<string, number> = {};
    const ol = route.oncomingLocal, end = route.stations[route.stations.length - 1];
    const sMax = end.headEnd ? end.platform.from - 60 : route.extent.to - 30;
    const out: OncomingTrain[] = [];
    for (const [sm, code, st] of list) {
      const local = code === 'L', fast = code === 'S' || code.startsWith('R');
      const k = nth[code] = (nth[code] ?? -1) + 1;
      const { id, ...consist } = realConsist(code, k, towardNamba);
      let lat = local && ol ? ol.lat : mainOncomingLat;
      const base = {
        carLen: carLenOf(consist.kind!), gap: .8, kmh: local ? 80 : fast ? 105 : 95, ...consist, cars: consist.cars!,
        dest: towardNamba ? (route.wakayamaDest?.[id] ?? WAKAYAMA_DEST[id])[0] : 'なんば',
      };
      let spec: OncomingSpec | null = null;
      if (st >= 0) {
        const sta = route.stations[st];
        // 路線データの停車シーン（待避線・諏訪ノ森の対向ホームのずれ・複々線の緩行線を含む）があれば、その停止位置と出現位置を使う
        const scenes = route.oncoming.filter(o => o.stop?.station === st && o.spawnAt < 1e8);
        const sc = (local ? scenes.find(o => o.stop!.loop) : undefined) ?? scenes.find(o => !o.stop!.loop);
        if (sc) {
          if (sc.stop!.loop) lat = sc.lat;
          spec = { ...base, lat, spawnAt: sc.spawnAt, startS: sc.startS, stop: { ...sc.stop! } };
        } else if (platformFor(sta, lat + islandOffset(route, lat, sta.platform.from + 40))) {
          spec = { ...base, lat, spawnAt: sta.platform.from - 2600, startS: Math.min(sta.platform.to + 800, sMax), stop: { station: st, headS: sta.platform.from + 8 } };
        }
      }
      if (!spec) {
        const startS = Math.min(sm + REAL_LEAD, sMax);
        spec = { ...base, lat, spawnAt: Math.min(sm - REAL_LEAD, startS - MIN_SPAWN_DIST - 200), startS };
      }
      const zone = spec.stop?.loop ? spec.stop.zone ?? loopZone(route.stations[spec.stop.station]) : null;
      const o: OncomingTrain = {
        spec, spec0: spec, mode: 'stop', kind: spec.kind!, idx: out.length, zone, view: null, active: false, done: false, started: false,
        head: 0, v: 0, phase: 'cruise', left: false, tStop: 0, tClose: 0, tPlayer: 0, horn: false, rush: false, halts: [], cur: null, real: true,
      };
      // 停車シーンの相手は、その駅を発車した後の自分の停車駅に停まる
      const stopHead = spec.stop?.headS;
      o.halts = haltsOf(o, id).filter(h => stopHead == null || h.headS < stopHead - 50);
      if (!sets.has(keyOf(o))) build(o);
      out.push(o);
    }
    return out.sort((a, b) => a.spec.spawnAt - b.spec.spawnAt).map((o, i) => Object.assign(o, { idx: i }));
  }
  /** 種別の記号 → 編成（同じ種別は車両を順に回す） */
  function realConsist(code: string, k: number, towardWakayama: boolean): ReturnType<typeof runConsist> {
    if (code === 'L') return runConsist('local', k, 'noon', towardWakayama);
    if (code === 'A') return runConsist('kyuko', k % 2 ? 3 : 1, 'evening', towardWakayama);
    if (code.startsWith('E')) return { ...runConsist('kyuko', [0, 2, 4][k % 3], 'evening', towardWakayama), label: code.slice(1), id: 'express' };
    if (code === 'S') return runConsist('tokkyu', 1, 'evening', towardWakayama);
    return { id: 'limited', kind: 'limited', cars: 6, units: [6], label: code === 'Ra' ? '特急ラピートα' : '特急ラピートβ' };
  }

  const timed = createTimetableOncoming(ctx, (code, k, towardNamba) => {
    const { id, ...spec } = realConsist(code, k, towardNamba);
    // 泉佐野以南のコースでは、和歌山方面の普通は実際のダイヤどおり和歌山市行き（既存コースの羽倉崎行きは変えない）
    const south = route.id.startsWith('izumisano-misaki') || route.id.startsWith('misaki-wakayamako');
    return { ...spec, cars: spec.cars!, kind: spec.kind!, dest: towardNamba ? (south && id === 'local' ? '和歌山市' : WAKAYAMA_DEST[id][0]) : 'なんば' };
  });
  // 停車シーンの間引き: プレイ開始後の最初のフレームで決める（種別・時間帯が確定してから。同じプレイ中は変わらない）
  let planned = false;
  function applyPlan() {
    planned = true;
    // 時間帯と向きで対向列車の多さを変える（平日）: 朝はなんば方面が多く和歌山方面は少し少なめ、夕・夜は和歌山方面が多い、昼（デイタイム）は少ない
    const tod = ctx.envState.timeOfDay;
    const towardNamba = serviceOf(route, 'local')?.destination === 'なんば'; // 対向列車は逆向き
    // 実際のダイヤのすれ違いリストがあるコースは、それどおりに出す
    const real = (MEETS.meets as unknown as Record<string, Record<string, Record<string, [number, string, number][]>>>)[route.id]?.[ctx.service?.id ?? '']?.[tod];
    trains.splice(0, trains.length, ...(real ? realTrains(real, tod, towardNamba) : baseTrains));
    if (real) return;
    const level = route.lineId !== 'shiokaze' ? (RUSH_TIMES.has(tod) ? 2 : 0)
      : towardNamba ? ({ morning: 1, noon: 0, evening: 2, night: 2 } as const)[tod] : ({ morning: 2, noon: 0, evening: 1, night: 1 } as const)[tod];
    const rushHour = level > 0;
    // 南海本線（複線）は種別の格ごとの本数の比率（平日ダイヤ）に合わせる。本数・出現の位置は変えず、
    // 停車する普通が比率を超える分を停車しないすれ違いへ回し、停車しない編成の種別を割り当て直す
    const share = route.lineId === 'shiokaze' && !route.singleTrack ? hourlyOf(tod, towardNamba) : undefined;
    const seedKey = `${route.id}|${ctx.service?.id ?? ''}|${tod}`;
    const items = trains.map(o => ({ spec: o.spec0, kind: o.spec0.kind!, rush: o.rush }));
    const modes = planOncoming(items, {
      seedKey, rushHour, level, share,
      passStations: new Set(route.stations.flatMap((s, i) => (s.pass ? [i] : []))),
    });
    const classes = share ? runClasses(items, modes, share, seedKey) : null;
    const nth: Record<TrainClass, number> = { local: 0, kyuko: 0, tokkyu: 0 };
    trains.forEach((o, i) => {
      o.mode = modes[i];
      if (modes[i] === 'run' && o.spec0.stop) { const { stop: _s, ...rest } = o.spec0; o.spec = rest; } else o.spec = o.spec0;
      o.kind = o.spec0.kind!;
      const cls = classes?.[i];
      if (classes && !cls && modes[i] !== 'off' && classOfSpec(o.spec0, o.kind) === 'tokkyu') {
        const order = tokkyuOrder(tod, towardNamba);
        // 固定のラピート（待避線の普通に続く特急など）は、時間帯と向きの α/β の表示に
        if (o.kind === 'limited') {
          const { id: _id, ...c } = runConsist('tokkyu', order.findIndex(x => x !== 'southern'), tod, towardNamba);
          o.spec = { ...o.spec, ...c, dest: towardNamba ? WAKAYAMA_DEST.limited[0] : 'なんば' };
          if (!sets.has(keyOf(o))) build(o);
        }
        // 固定の特急の次は、もう一方の特急から（ラピートの次はサザン、サザンの次はラピート）
        const k = order.findIndex(x => (o.kind === 'limited') === (x === 'southern'));
        nth.tokkyu = k < 0 ? 0 : k;
      }
      // 日中の急行系は空港急行だけ（固定の編成の「急行」も空港急行に）
      if (classes && !cls && tod === 'noon' && classOfSpec(o.spec0, o.kind) === 'kyuko' && o.spec.label !== '空港急行') {
        o.spec = { ...o.spec, label: '空港急行', dest: towardNamba ? WAKAYAMA_DEST.airport[0] : 'なんば' };
        if (!sets.has(keyOf(o))) build(o);
      }
      if (cls) {
        // 対向列車は自列車と逆向き: 自列車がなんば方面なら和歌山方面
        const { id, ...c } = runConsist(cls, nth[cls]++, tod, towardNamba);
        o.spec = { ...o.spec, ...c, dest: towardNamba ? WAKAYAMA_DEST[id][0] : 'なんば' };
        // 複々線の区間がある路線（堺〜なんば）は、普通は緩行線、急行系・特急は急行線の進路を走る
        // （ラッシュ時の普通の停車シーンを停車しないすれ違いにしたものは緩行線の横位置を持っているので、急行線へ戻す）
        const ol = route.oncomingLocal;
        if (ol) o.spec.lat = cls === 'local' ? ol.lat : o.spec.lat === ol.lat ? mainOncomingLat : o.spec.lat;
        o.kind = c.kind!;
        o.halts = haltsOf(o, id);
        if (!sets.has(keyOf(o))) build(o); // 出現時の負荷を避けて先に作る
      } else if (classes && modes[i] !== 'off') {
        // 停車シーンの編成は停車駅を発車した後、待避線の普通に続く優等列車は待避の駅を過ぎた後の、自分の停車駅に停まる
        const after = o.spec.stop ? o.spec.stop.headS : o.spec.follow ? route.stations[trains[i - 1]?.spec0.stop?.station ?? 0]?.platform.from : undefined;
        o.halts = after == null ? [] : haltsOf(o, serviceIdOf(o.spec.label ?? TRAIN_KINDS[o.kind].service)).filter(h => h.headS < after - 50);
      } else o.halts = [];
      if (modes[i] === 'off') o.done = true;
    });
  }

  events.on('frame', ({ dt }) => {
    if ((st.state !== 'run' && st.state !== 'dwell') || st.paused) return;
    if (timed.update()) return;
    if (!planned) applyPlan();
    const ps = st.train.s, pv = st.train.v;
    let p = updateMeet(ps, pv);
    for (const o of trains) {
      if (!o.active && !o.done && ps >= o.spec.spawnAt) {
        const ok = canSpawn(o, ps);
        if (ok === 'skip') { o.done = true; continue; }
        if (ok) {
          Object.assign(o, { active: true, started: true, head: o.spec.startS, v: o.spec.kmh / 3.6, phase: 'cruise', left: false, tStop: 0, tClose: 0, tPlayer: 0, horn: false, cur: null });
          for (const h of o.halts) h.done = false;
          o.view = acquire(o);
        }
      }
      if (o.active) p = Math.max(p, update(o, Math.min(dt, .1), ps, pv));
    }
    if (p >= 0) events.emit('oncomingPass', { proximity: p });
  });
  events.on('reset', () => {
    timed.reset();
    planned = false;
    for (const o of trains) { Object.assign(o, { active: false, done: false, started: false, horn: false }); release(o); }
    for (const o of meetSpecs) { o.active = false; release(o); }
  });

  // 開発時の確認用: 各編成の状態
  if (import.meta.env.DEV) (window as any).__oncomingDebug = () => timed.debug() ?? trains.map(o => ({ mode: o.mode, kind: o.kind, rush: o.rush, started: o.started, stop: o.spec.stop?.station, loop: !!o.zone, active: o.active, done: o.done, phase: o.phase, head: Math.round(o.head), len: Math.round(lenOf(o)), lat: +laneLat(o, o.head).toFixed(1), kmh: Math.round(o.v * 3.6), tStop: Math.round(o.tStop), tPlayer: Math.round(o.tPlayer), label: o.spec.label, specLat: o.spec.lat, halts: o.halts.map(h => route.stations[h.station].name) }));

  return {
    activeSpans: () => [
      ...trains.filter(o => o.active && o.view && o.phase !== 'stopped' && o.phase !== 'closing'),
      ...meetSpecs.filter(o => o.active && o.view && o.v > 0),
    ].map(o => ({ head: o.head, tail: o.head + o.view!.length })).concat(timed.spans()),
  };
}
