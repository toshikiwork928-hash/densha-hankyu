// ゲーム進行: 状態遷移・走行ステップ・停止判定。演出（音・HUD）はイベント経由
import {
  ANNOUNCE_DIST, DOOR_CLOSE_TIME, ORIGIN_DWELL, START_CLOCK, JOINT_INTERVAL, LIMIT_NOTICE_DIST, NEAR_DIST, NOTCH_EB, NOTCH_MAX, NOTCH_MIN,
  OVERRUN_FAIL, OVERSPEED_MARGIN, STOP_CONFIRM, STOP_ZONE,
} from '../core/config';
import type { GameActions, GameContext } from '../core/context';
import type { CameraMode } from '../core/events';
import { DEFAULT_PERF, TRAIN_PERF, stepTrain } from '../sim/train';
import { serviceOf, selectableServices } from '../route/service';
import { createOvertake, waitsAt } from './overtake';
import { createMeet } from './meet';
import { createReplay } from './replay';
import { judgeStop, scoreGame } from './scoring';
import { createSignalSystem } from './signals';
import { saveSelection } from './ranking';
import { departureTime, isFinalStop, nextStopIndex, resetState, stagesOf, type GameMode, type GameStateName } from './state';

const MIN_DWELL = 10; // 遅着時でも最低これだけ停車 [s]
const MODES: GameMode[] = ['normal', 'recovery', 'timeOnly'];

export interface Game {
  actions: GameActions;
  /** 1フレーム進める（main のループから呼ぶ） */
  update(dt: number): void;
}

export function createGame(ctx: GameContext): Game {
  const { route, track, events } = ctx;
  const st = ctx.state;

  const setState = (to: GameStateName) => {
    const from = st.state;
    if (from === to) return;
    st.state = to;
    events.emit('stateChange', { from, to });
  };
  const banner = (text: string, sec = 3) => events.emit('banner', { text, sec });

  // カメラ: 0 = 運転台, 1 = 俯瞰追従, 2 = 前方斜め, 3 = 編成全景（camera.ts が 'outside' の連続で切替）
  let camCycle = 0;
  function setCamera(mode: CameraMode) {
    if (mode !== 'outside') camCycle = 0;
    ctx.cameraMode = mode;
    events.emit('cameraMode', { mode });
  }

  const meet = createMeet(ctx);
  const signals = createSignalSystem(ctx, () => setNotch(NOTCH_EB, true), meet);
  const replay = createReplay(ctx, setCamera);
  const overtake = createOvertake(ctx);

  /** 種別の反映（route は resetState が書き換え済み）。変わったら描画側へ通知 */
  let appliedService = '';
  function syncService() {
    ctx.service = serviceOf(route, st.sel.service);
    // 12000系混成は指定席側の性能を編成全体へ適用する。
    const perfKind = ctx.service?.id === 'southern' && ctx.service.unitKinds?.includes('southern-12000')
      ? 'southern-12000' : ctx.service?.kind;
    ctx.trainEnv.perf = perfKind ? TRAIN_PERF[perfKind] : DEFAULT_PERF;
    const key = ctx.service ? `${ctx.service.id}:${ctx.service.kind}:${ctx.service.units.join('+')}` : '';
    if (ctx.service && key !== appliedService) {
      appliedService = key;
      events.emit('serviceChange', { service: ctx.service });
    }
  }

  function reset() {
    setPaused(false);
    replay.stop();
    resetState(st, route);
    signals.reset();
    syncService();
    events.emit('reset');
  }

  /** 一時停止: 運転・停車中のみ（リプレイ・タイトル・結果では不可）。停止中は update() が何も進めない */
  const canPause = () => (st.state === 'run' || st.state === 'dwell') && ctx.cameraMode !== 'replay' && !replay.active;
  function setPaused(paused: boolean, reason: 'user' | 'hidden' = 'user') {
    if (paused && !canPause()) return;
    if (st.paused === paused) return;
    st.paused = paused;
    events.emit('pause', { paused, reason });
  }
  /** 一時停止中にプレイを中断してタイトルへ（記録は残さない） */
  function quitToTitle() {
    const from = st.state;
    if (from !== 'run' && from !== 'dwell') return;
    reset(); // 一時停止の解除（音の再開）・状態の初期化を含む
    setCamera('cab');
    events.emit('stateChange', { from, to: 'title' });
  }

  function setNotch(n: number, force = false) {
    n = Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, n));
    // ATS 非常制動中は EB 固定
    if (!force && st.ats.state === 'brake') n = NOTCH_EB;
    if (n === st.train.notch) return;
    const prev = st.train.notch;
    st.train.notch = n;
    events.emit('notch', { notch: n, prev });
  }

  function startOrRetry() {
    if (!ctx.assetsReady || st.paused) return;
    if (st.state === 'run' || st.state === 'dwell') return;
    if (replay.active) { replay.stop(); return; }
    events.emit('start');
    if (st.state === 'result') reset();
    if (ctx.cameraMode === 'replay') setCamera('cab');
    // 始発駅はドアを開けて停車中から。発車メロディ → 戸閉め → 閉まり切ったら力行で発車
    const from = st.fromIndex, sta = route.stations[from];
    st.target = from;
    // 待避駅から始めるステージは定刻に着いた状態から（後続列車の通過を待つ）
    const waits = waitsAt(route, ctx.service, from).length > 0 || !!route.meets?.some(m => m.station === from);
    const dwell = waits ? Math.max(ORIGIN_DWELL, departureTime(route, from) - DOOR_CLOSE_TIME - sta.scheduledArrival) : ORIGIN_DWELL;
    st.t -= dwell + DOOR_CLOSE_TIME;
    st.dwellT = dwell;
    st.doors = 'open';
    setState('dwell');
    events.emit('doorOpen', { index: from, station: sta });
    // 待ち合わせ・行き違いの案内は「発車待ち」案内に上書きされないよう1つにまとめる
    const waitMsg = waits ? [overtake.onArrive(from, true), meet.onArrive(from, true)].filter(Boolean).join(' ') : '';
    const late = st.lateStart > 0 ? `（${st.lateStart}秒遅れ。回復運転せよ）` : '';
    banner(waitMsg ? `発車待ち。${waitMsg}${late}` : `${sta.name} 発車待ち。戸閉め後、出発信号を確認して力行${late}`, waitMsg ? 5 : 4);
  }

  function finish() {
    setState('result');
    events.emit('result', scoreGame(st));
  }

  /** 停車駅で停止確定（または失格） */
  function arrive(kind: 'stop' | 'overrun') {
    const index = st.target, station = route.stations[index];
    const judgement = judgeStop(route, st, index, kind);
    st.stops.push(judgement);
    const final = kind === 'overrun' || isFinalStop(route, index, st);
    events.emit('arrive', { index, station, judgement, final });
    if (final) { finish(); return; }
    // 途中駅: ドア開 → 定刻に閉まり切るよう戸閉め（遅着なら最低停車時間）→ 閉まり切ったら力行で発車
    st.dwellT = Math.max(MIN_DWELL, departureTime(route, index) - DOOR_CLOSE_TIME - st.t);
    st.stopTimer = 0;
    st.doors = 'open';
    setState('dwell');
    events.emit('doorOpen', { index, station });
    overtake.onArrive(index);
    meet.onArrive(index);
  }

  function depart() {
    const from = st.target;
    st.target = nextStopIndex(route, from);
    setState('run');
    banner(from === st.fromIndex && st.stops.length === 0 && st.lateStart > 0 ? '出発進行！ 回復運転せよ' : '出発進行！', 2);
    events.emit('depart', { index: from, station: route.stations[from] });
  }

  function updateDwell(dt: number) {
    st.t += dt;
    overtake.update(dt);
    meet.update(dt);
    signals.update(dt, false);
    const sta = route.stations[st.target];
    if (st.doors === 'open') {
      if ((st.dwellT -= dt) > 0) return;
      st.doors = 'closing';
      st.doorCloseT = DOOR_CLOSE_TIME;
      events.emit('doorClose', { index: st.target, station: sta });
      return;
    }
    if (st.doors === 'closing') {
      // 戸閉め中は力行しても動かない
      if (st.train.notch > 0 && !st.flags['closing' + st.target]) { st.flags['closing' + st.target] = true; banner('戸閉め中。戸閉灯の点灯を待て', 2); }
      if ((st.doorCloseT -= dt) > 0) return;
      st.doors = 'closed';
      events.emit('doorsClosed', { index: st.target, station: sta });
      banner('戸閉め よし。出発信号を確認して力行で発車', 3);
      return;
    }
    if (st.train.notch <= 0) return;
    const n = st.nextSignal;
    if (n >= 0 && st.signals[n] === 'R') {
      if (!st.flags['waitR' + st.target]) { st.flags['waitR' + st.target] = true; banner('出発信号 停止現示。進行を待て', 2.5); }
      return;
    }
    depart();
  }

  /** 通過駅の処理（通過判定・誤停車） */
  let passStopT = 0;
  function checkPassStations(dt: number) {
    const tr = st.train, f = st.flags;
    route.stations.forEach((sta, i) => {
      if (!sta.pass || i <= st.fromIndex || i >= st.endIndex) return;
      const remain = sta.stopS - tr.s;
      if (!f['pann' + i] && remain < ANNOUNCE_DIST && remain > 0) { f['pann' + i] = true; banner(`次は ${sta.name} 通過`, 3); }
      const onPlat = tr.s > sta.platform.from && tr.s - route.trainLength < sta.platform.to;
      const heldBySignal = st.nextSignal >= 0 && st.signals[st.nextSignal] === 'R';
      if (onPlat && tr.v === 0 && !f['ws' + i] && !heldBySignal) {
        if ((passStopT += dt) > 1.5) { f['ws' + i] = true; st.penalties.wrongStop++; banner(`${sta.name} は通過駅！（減点）`, 3); }
      } else if (!onPlat || tr.v > 0) passStopT = 0;
      if (!f['passed' + i] && tr.s - route.trainLength > sta.platform.to) {
        f['passed' + i] = true;
        const delay = st.t - sta.scheduledArrival;
        st.passes.push({ index: i, delay, t: st.t, wrongStop: !!f['ws' + i] });
        banner(`${sta.name} 通過（${delay >= 0 ? '+' : ''}${delay.toFixed(0)}秒）`, 2);
      }
    });
  }

  function step(dt: number) {
    const tr = st.train, n = tr.notch;
    ctx.trainEnv.gradePermil = track.gradeAt(tr.s);
    if (stepTrain(tr, ctx.trainEnv, dt)) {
      st.notchAtStop = n;
      events.emit('stop', { s: tr.s, notch: n });
    }
    st.t += dt;
    overtake.update(dt);
    meet.update(dt);
    signals.update(dt, true);

    // 速度超過（線路の制限と信号現示の制限の低い方）
    const vk = tr.v * 3.6, lim = Math.min(track.limitAt(tr.s), st.sigLimit);
    if (vk > lim + OVERSPEED_MARGIN) {
      st.overspeed += dt; st.beepT -= dt;
      if (st.beepT <= 0) { events.emit('alarm', { kind: 'overspeed' }); st.beepT = .5; }
      if (!st.overspeedActive) {
        banner('速度超過！ 減速せよ', 2); st.overspeedActive = true;
        events.emit('overspeed', { active: true, limit: lim, kmh: vk });
      }
    } else if (st.overspeedActive) {
      st.overspeedActive = false;
      events.emit('overspeed', { active: false, limit: lim, kmh: vk });
    }
    if (n === NOTCH_EB && tr.v > 0 && st.ats.state !== 'brake') st.eb = true;

    // レール継ぎ目
    const j = Math.floor(tr.s / JOINT_INTERVAL);
    if (j !== st.lastJoint) { st.lastJoint = j; events.emit('jointPass', { v: tr.v, s: tr.s }); }
    events.emit('tick', { dt, train: tr });

    // 制限予告・解除（既に通過済みの区間は出さない）
    const f = st.flags;
    for (const L of route.limits) {
      if (L.to < tr.s - 1 && !f['end' + L.from]) { f['pre' + L.from] = f['end' + L.from] = true; continue; }
      if (!f['pre' + L.from] && L.from - tr.s < LIMIT_NOTICE_DIST) {
        f['pre' + L.from] = true; banner(`この先 ${L.label ?? '速度制限'} ${L.kmh}km/h`, 3);
        events.emit('limitNotice', { kind: 'ahead', kmh: L.kmh, from: L.from, to: L.to });
      }
      if (!f['end' + L.from] && tr.s >= L.to) {
        f['end' + L.from] = true; banner('制限解除', 2);
        events.emit('limitNotice', { kind: 'end', kmh: L.kmh, from: L.from, to: L.to });
      }
    }

    checkPassStations(dt);

    // 次の停車駅
    if (st.target < 0) return;
    const sta = route.stations[st.target], remain = sta.stopS - tr.s;
    if (!f['ann' + st.target] && remain < ANNOUNCE_DIST) {
      f['ann' + st.target] = true; banner(`次は ${sta.name}、${sta.name}です`, 3.5);
      events.emit('stationApproach', { index: st.target, station: sta, remain, stage: 'announce' });
    }
    if (!f['near' + st.target] && remain < NEAR_DIST) {
      f['near' + st.target] = true; banner('停止位置まで 100m', 2);
      events.emit('stationApproach', { index: st.target, station: sta, remain, stage: 'near' });
    }

    if (tr.s > sta.stopS + OVERRUN_FAIL) { arrive('overrun'); return; }
    if (tr.v === 0 && tr.s > sta.stopS - STOP_ZONE) {
      st.stopTimer += dt;
      if (st.stopTimer > STOP_CONFIRM) arrive('stop');
    } else st.stopTimer = 0;
  }

  function select(stageDelta: number, modeDelta: number, serviceDelta = 0) {
    if (st.state !== 'title') return;
    const stages = stagesOf(route);
    const si = Math.max(0, stages.findIndex(s => s.id === st.sel.stageId));
    const mi = Math.max(0, MODES.indexOf(st.sel.mode));
    const svcs = selectableServices(route);
    let service = st.sel.service, stageId = stages[(si + stageDelta + stages.length) % stages.length].id;
    if (serviceDelta && svcs.length) {
      const k = Math.max(0, svcs.findIndex(x => x.id === service));
      service = svcs[(k + serviceDelta + svcs.length) % svcs.length].id;
      // 種別が変わると停車駅間が変わるので先頭区間へ（全線通しと、新しい種別でも選べる終点指定の区間は維持）
      const keep = route.partialGoals?.some(g => !g.asAll && `${g.from}-${g.to}` === stageId && g.services.includes(service));
      if (stageId !== 'all' && !keep) stageId = '';
    }
    st.sel = { stageId, mode: MODES[(mi + modeDelta + MODES.length) % MODES.length], service, vehicles: st.sel.vehicles, routeId: st.sel.routeId };
    saveSelection(st.sel);
    reset();
  }

  /** 時間帯に合わせて始発時刻とダイヤ（待避・追い越しのパターン、時刻表）を変える（タイトル・結果画面のときのみ。走行中は変えない） */
  function syncClock(e?: { timeOfDay: keyof typeof START_CLOCK }) {
    const tod = e?.timeOfDay ?? ctx.envState.timeOfDay; // 環境側より先に呼ばれるので payload を優先
    const c = START_CLOCK[tod] ?? START_CLOCK.noon;
    if ((c === route.startClock && route.timeOfDay === tod) || (st.state !== 'title' && st.state !== 'result')) return;
    route.startClock = c;
    route.timeOfDay = tod;
    if (st.state === 'title') reset(); // 時刻表・待避を時間帯のものにして、HUD・時刻表・行路表を描き直す
  }
  events.on('envChange', syncClock);

  const actions: GameActions = {
    setNotch,
    notchStep: d => setNotch(st.train.notch + d),
    notchOff: () => setNotch(0),
    emergency: () => setNotch(NOTCH_EB),
    startOrRetry,
    canControl: () => (st.state === 'run' || st.state === 'dwell') && !st.paused,
    atsAck: () => { if ((st.state === 'run' || st.state === 'dwell') && !st.paused) signals.ack(); },
    canPause: () => canPause() || st.paused,
    togglePause: () => setPaused(!st.paused),
    setPaused,
    quitToTitle,
    cycleCamera: () => {
      if (replay.active || st.paused) return;
      camCycle = (camCycle + 1) % 4;
      const mode: CameraMode = camCycle === 0 ? 'cab' : 'outside';
      ctx.cameraMode = mode;
      events.emit('cameraMode', { mode });
    },
    toTitle: () => {
      if (st.state !== 'result') return;
      reset();
      setCamera('cab');
      events.emit('stateChange', { from: 'result', to: 'title' });
    },
    toggleReplay: () => {
      if (st.state !== 'result') return;
      if (replay.active) replay.stop(); else replay.start();
    },
    selectStage: d => select(d, 0),
    selectMode: d => select(0, d),
    selectService: d => select(0, 0, d),
    selectVehicle: v => {
      if (st.state !== 'title') return;
      const svc = serviceOf(route, st.sel.service);
      if (!svc) return;
      const prev = st.sel.vehicles[svc.id];
      const seatKind = svc.id === 'southern' ? svc.unitKinds?.find(k => k === 'southern-10000' || k === 'southern-12000') : undefined;
      st.sel.vehicles = { ...st.sel.vehicles, [svc.id]: { kind: v.kind ?? prev?.kind ?? seatKind ?? svc.kind, freeKind: v.freeKind ?? prev?.freeKind, units: v.units ?? prev?.units ?? svc.units } };
      saveSelection(st.sel);
      reset();
    },
  };
  ctx.actions = actions;
  signals.reset();
  syncService();
  syncClock();

  const game: Game = {
    actions,
    update(dt) {
      if (st.paused) return; // 一時停止中: 時刻・信号・待避/行き違い・ATS タイマーを進めない
      if (st.state === 'run') step(dt);
      else if (st.state === 'dwell') updateDwell(dt);
      else if (st.state === 'result' && replay.active) {
        if (replay.update(dt) != null) signals.update(0, false);
      }
    },
  };
  return game;
}
