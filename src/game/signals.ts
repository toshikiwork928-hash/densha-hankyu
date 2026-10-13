// 閉そく信号と ATS。先行列車（仮想）の在線から現示を決め、通過時に速度照査する
import type { GameContext } from '../core/context';
import type { SignalAspect } from '../core/events';
import { islandZone, loopZone, sameClass, type LoopZone } from '../route/service';
import type { Meet } from './meet';
import { terminalSpeedLimit } from './terminal-ats';
import { ASPECT_LABEL, ASPECT_LIMIT, PRECEDING_LENGTH, aspectOf, buildPrecedingKeys, precedingHead, type PrecedingPlan } from './preceding';

const ATS_ACK_TIME = 5; // 警報から確認までの猶予 [s]
const ATS_ACK_NOTCH = -4; // 確認に必要なブレーキ段（B4 以上）
const RED_APPROACH = 400; // 停止現示の信号へこの距離まで近づくと警報 [m]
const OVER_MARGIN = 0.5;

export interface SignalSystem {
  /** 現示更新（run / dwell 中）。moving = 走行判定（通過・ATS）も行う */
  update(dt: number, moving: boolean): void;
  /** ATS 確認扱い。戻り値 = 受け付けたか */
  ack(): boolean;
  reset(): void;
  /** 先行列車が待避線上にいるか（描画用。いれば駅の待避線区間） */
  precedingLoop(): LoopZone | null;
}

const RANK: Record<SignalAspect, number> = { R: 0, Y: 1, YG: 2, G: 3 };
const restrict = (a: SignalAspect, cap: SignalAspect | undefined): SignalAspect => cap && RANK[cap] < RANK[a] ? cap : a;

export function createSignalSystem(ctx: GameContext, forceEB: () => void, meet?: Meet): SignalSystem {
  const { route, events } = ctx, st = ctx.state;
  const sigs = route.signals ?? [];
  const sigS = sigs.map(g => g.s);
  let plan: PrecedingPlan = buildPrecedingKeys(route, st.sel.service);
  /** 場内信号の現示上限（停車する2面4線駅は分岐側へ進むので Y） */
  let caps: (SignalAspect | undefined)[] = [];
  /** 先行列車の待避抑止（自列車が通過する待避線駅で、自列車が通過するまで先行を待避線に止める） */
  let holds: { zone: LoopZone; depT: number; passT: number }[] = [];
  /** 先行が待避線上にいる駅（先行が停車する待避線駅すべて） */
  let precZones: LoopZone[] = [];
  let precDelay = 0;
  let lastEmit = '';
  let passed = -1; // 直前に通過した信号
  /** 通過時に受けた現示（通過後に先行列車が詰めて現示が下がっても、制限は次の信号まで通過時のまま。上がる方向のみ追従） */
  let passedAsp: SignalAspect = 'G';
  const redWarned = new Set<number>();

  const banner = (text: string, sec = 3) => events.emit('banner', { text, sec });
  /** 先行列車が待避線上（本線の閉そくを占有しない）か */
  const precOnLoop = () => precZones.find(z => st.precedingS >= z.inFrom + PRECEDING_LENGTH && st.precedingS <= z.outFrom) ?? null;
  /** 単線は先行列車なし（行き違いの対向列車が単線上にいる間は、その閉そくを占有） */
  const single = !!route.singleTrack;
  const precTrains = (): [number, number][] => {
    if (single) { const o = meet?.occupying(); return o ? [o] : []; }
    return precOnLoop() ? [] : [[st.precedingS, PRECEDING_LENGTH]];
  };
  /** 上限（場内）と待避の抑止（出発）を反映 */
  const adjust = (i: number, a: SignalAspect): SignalAspect => {
    const o = st.overtake;
    if (o && !o.cleared && o.localStopped && o.depSignal === i) return 'R';
    if (meet && meet.heldSignal() === i) return 'R'; // 交換駅: 対向列車の到着まで出発信号は停止
    return restrict(a, caps[i]);
  };
  const precOnly = (i: number): SignalAspect => adjust(i, aspectOf(sigS, i, precTrains()));

  function refreshAspects() {
    // 自列車が通過する待避線駅では、自列車が抜けるまで先行を待避線に止めておく
    for (const h of holds) {
      if (st.train.s - route.trainLength < h.zone.outTo && st.t - precDelay > h.depT) precDelay = st.t - h.depT;
    }
    st.precedingS = precedingHead(plan.keys, st.t - precDelay);
    const trains: [number, number][] = [...precTrains(), [st.train.s, route.trainLength]];
    for (let i = 0; i < sigS.length; i++) st.signals[i] = adjust(i, aspectOf(sigS, i, trains));
    // R（冒進後）は ATS が扱うので速度超過判定には使わない
    let pa: SignalAspect = passed >= 0 ? precOnly(passed) : 'G';
    if (passed >= 0 && RANK[pa] < RANK[passedAsp]) pa = passedAsp;
    else passedAsp = pa;
    st.sigLimit = pa === 'R' ? Infinity : ASPECT_LIMIT[pa];
    st.sigLimit = Math.min(st.sigLimit, terminalSpeedLimit(route, st.target, st.train.s));
    const n = st.nextSignal;
    const key = n >= 0 ? `${sigs[n].id}:${st.signals[n]}` : 'none';
    if (n >= 0 && key !== lastEmit) {
      lastEmit = key;
      events.emit('signalAspect', { id: sigs[n].id, s: sigS[n], aspect: st.signals[n] });
    }
  }

  function warn(reason: string) {
    if (st.ats.state !== 'normal') return;
    st.ats = { state: 'warn', timer: ATS_ACK_TIME, reason };
    st.penalties.atsWarn++;
    events.emit('ats', { kind: 'warn', reason });
    banner(`ATS警報！ ${reason} — B4以上＋確認(A)`, 3);
  }

  function brake(reason: string) {
    if (st.ats.state === 'brake') return;
    st.ats = { state: 'brake', timer: 0, reason };
    st.penalties.atsBrake++;
    events.emit('ats', { kind: 'brake', reason });
    forceEB();
    banner(`ATS 非常制動（${reason}）`, 3.5);
  }

  function release() {
    const reason = st.ats.reason;
    st.ats = { state: 'normal', timer: 0, reason: '' };
    events.emit('ats', { kind: 'release', reason });
  }

  function onPass(i: number) {
    passed = i;
    const asp = precOnly(i), lim = ASPECT_LIMIT[asp], vk = st.train.v * 3.6;
    if (asp === 'R') {
      st.penalties.redPass++;
      brake('停止信号冒進');
      return;
    }
    passedAsp = asp;
    if (vk > lim + OVER_MARGIN) warn(`${ASPECT_LABEL[asp]}現示 ${lim}km/h 超過`);
  }

  return {
    update(dt, moving) {
      const s = st.train.s;
      if (moving) {
        while (st.nextSignal >= 0 && s >= sigS[st.nextSignal]) {
          const i = st.nextSignal;
          st.nextSignal = i + 1 < sigS.length ? i + 1 : -1;
          onPass(i);
        }
      }
      refreshAspects();
      if (!moving) return;
      const terminalLimit = terminalSpeedLimit(route, st.target, s);
      const terminalDistance = route.terminalApproach && st.target === route.stations.length - 1
        ? route.stations[st.target].stopS - s : Infinity;
      if (terminalDistance <= 1500 && !st.flags.terminalNotice) {
        st.flags.terminalNotice = true;
        banner('終着進入予告：停止位置まで1000mで65km/h以下。その後もATS速度照査で段階的に減速', 6);
      }
      // 終着の待避線入線（普通）: 番線と分岐器制限を予告する（終着 ATS は無効でも出す）
      const tsta = route.stations[st.target];
      if (st.target === route.stations.length - 1 && tsta && (tsta.enterLoop ? tsta.loopTrack : tsta.mainTrack) && tsta.stopS - s <= 1200 && !st.flags.terminalTrackNotice) {
        st.flags.terminalTrackNotice = true;
        // 分岐器を渡って入る番線（custom 駅の種別ごとの進路）は、ホーム手前の制限も案内する
        const lim = ctx.track.limitAt(tsta.platform.from - 20);
        banner(tsta.enterLoop ? `${tsta.name} ${tsta.loopTrack}へ入線。分岐器制限 ${tsta.loop?.turnoutLimitKmh ?? 45}km/h` : `${tsta.name} ${tsta.mainTrack}へ入線${lim < route.lineLimit ? `。制限 ${lim}km/h` : ''}`, 6);
      }
      if (st.train.v * 3.6 > terminalLimit + 3) brake(`終着進入 ${Math.floor(terminalLimit)}km/h 照査超過`);
      // 停止現示への接近
      const n = st.nextSignal;
      // 単線: 停車駅の出発信号（停止位置の先）は、手前で止まるので警報しない
      const tgt = st.target >= 0 ? route.stations[st.target] : null;
      const beyondStop = single && !!tgt && tgt.stopS < sigS[n] && sigS[n] - tgt.stopS < 200;
      if (n >= 0 && st.signals[n] === 'R' && sigS[n] - s < RED_APPROACH && st.train.v > 0 && !redWarned.has(n) && !beyondStop) {
        redWarned.add(n);
        warn('停止信号接近');
      }
      if (st.ats.state === 'warn' && (st.ats.timer -= dt) <= 0) brake('確認扱いなし');
    },
    ack() {
      if (st.ats.state === 'warn') {
        if (st.train.notch > ATS_ACK_NOTCH) { banner('B4以上のブレーキを掛けて確認', 2); return false; }
        release(); banner('ATS 確認', 1.5); return true;
      }
      if (st.ats.state === 'brake') {
        if (st.train.v > 0) { banner('停止後に ATS 復帰', 2); return false; }
        release(); banner('ATS 復帰', 1.5); return true;
      }
      return false;
    },
    precedingLoop: () => precOnLoop(),
    reset() {
      // 種別ごとに先行列車の計画・場内信号の上限・待避抑止を作り直す
      plan = buildPrecedingKeys(route, st.sel.service);
      precDelay = 0;
      caps = sigS.map(() => undefined); holds = []; precZones = [];
      const local = route.services?.find(x => x.id === 'local');
      // 単線の交換駅・頭端駅（分岐器で左の線へ入る）: 場内信号は注意（Y）まで
      if (single) route.stations.forEach((sta, k) => {
        const iz = islandZone(sta);
        if (!iz || k === 0 || sta.pass) return;
        let home = -1;
        for (let i = 0; i < sigS.length; i++) if (sigS[i] < iz.inFrom) home = i;
        if (home >= 0) caps[home] = 'Y';
      });
      route.stations.forEach((sta, k) => {
        const z = loopZone(sta);
        if (!z) return;
        if (sta.enterLoop) {
          let home = -1;
          for (let i = 0; i < sigS.length; i++) if (sigS[i] < z.inFrom) home = i;
          if (home >= 0) caps[home] = 'Y';
        }
        const precStops = local ? local.stops.includes(k) : true;
        if (precStops) precZones.push(z);
        // 自列車が本線を通る（通過・本線ホームに停車）駅では、先行の普通を待避線に止めて先に行かせない
        const scheduledWait = local?.waits?.some(w => w.station === k && sameClass(w.passedBy, st.sel.service) && k > 0 && k < route.stations.length - 1);
        if (!sta.enterLoop && precStops && scheduledWait && plan.depT[k] != null) {
          const passT = sta.scheduledArrival + (sta.pass ? 0 : sta.dwell ?? 20);
          holds.push({ zone: z, depT: plan.depT[k], passT });
          // 待避駅より先から始めるステージでは、定刻どおり待避した後の位置にしておく
          if (st.train.s >= z.outTo) precDelay = Math.max(precDelay, passT + 15 - plan.depT[k]);
        }
      });
      lastEmit = ''; redWarned.clear();
      passed = -1; passedAsp = 'G';
      for (let i = sigS.length - 1; i >= 0; i--) if (sigS[i] <= st.train.s) { passed = i; break; }
      st.nextSignal = sigS.findIndex(x => x > st.train.s);
      refreshAspects();
    },
  };
}

export { ASPECT_LIMIT, ASPECT_LABEL };
