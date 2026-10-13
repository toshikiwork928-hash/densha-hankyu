// サウンド統括: イベントを購読して各音源モジュールを鳴らす。AudioContext は最初のユーザー操作で生成
// 構成: engine（バス・残響）/ vvvf・resistance（主回路。種別で切替）/ running（走行音）/ brakes（空気）/ station（駅）/ alarms（警報・警笛・踏切）
//       ambience（天候・すれ違い）/ announce（車内放送 = Web Speech）/ settings（音量保存・UI）
import { JOINT_INTERVAL } from '../core/config';
import type { GameContext } from '../core/context';
import type { EventBus } from '../core/events';
import { createCore, type AudioCore } from './engine';
import { createVvvf, type Vvvf } from './vvvf';
import { createResistance } from './resistance';
import { createRunning, type Running } from './running';
import { createBrakes, type Brakes } from './brakes';
import { createStation, type StationSfx } from './station';
import { createAlarms, type Alarms } from './alarms';
import { createAmbience, type Ambience } from './ambience';
import { createAnnouncer } from './announce';
import { approachText, arriveText, departText } from './announce-text';
import { createSettings, renderSettingsUi, type SettingsStore } from './settings';

interface Parts {
  core: AudioCore; vvvf: Vvvf; resistance: Vvvf; running: Running; brakes: Brakes; station: StationSfx; alarms: Alarms; ambience: Ambience;
}

export interface Sfx {
  readonly settings: SettingsStore;
  /** 他モジュールが追加音を鳴らすための AudioContext（初期化前は null） */
  readonly context: AudioContext | null;
  /** 効果音バス（初期化前は null） */
  readonly bus: GainNode | null;
}

const MELODY_LEAD = 6; // 発車メロディ終了から発車までの余裕 [s]

export function attachSfx(events: EventBus, ctx: GameContext): Sfx {
  const settings = createSettings();
  const announcer = createAnnouncer();
  let ac: AudioContext | null = null, p: Parts | null = null;
  let doorsOpen = false, fromDwell = false, dwellMelody = false, hornStop: (() => void) | null = null;
  let lastIdle: Vvvf | null = null;

  function applySettings() {
    const s = settings.value;
    announcer.setVolume(s.muted ? 0 : s.master * s.voice);
    if (!p) return;
    const now = p.core.now();
    p.core.master.gain.setTargetAtTime(s.muted ? 0 : s.master, now, .03);
    p.core.sfx.gain.setTargetAtTime(s.sfx, now, .03);
    p.core.voice.gain.setTargetAtTime(s.voice, now, .03);
  }
  settings.onChange(applySettings);
  applySettings();

  /** ユーザー操作の中で呼ぶ */
  function ensure(): Parts | null {
    if (p) { if (ac?.state === 'suspended') void ac.resume(); return p; }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ac = new Ctor({ latencyHint: 'interactive' });
      const core = createCore(ac);
      const brakes = createBrakes(core);
      p = {
        core, brakes,
        vvvf: createVvvf(core, core.run, () => settings.value.traction),
        resistance: createResistance(core),
        running: createRunning(core, () => ctx.route),
        station: createStation(core, brakes),
        alarms: createAlarms(core),
        ambience: createAmbience(core, () => ctx.route.oncoming[0]),
      };
      p.ambience.setEnv(ctx.envState);
      p.running.setTunnel(false);
      applySettings();
      if (ac.state === 'suspended') void ac.resume();
    } catch (e) { console.warn('[audio] 初期化失敗', e); p = null; }
    return p;
  }

  function silenceAll() {
    announcer.cancel();
    hornStop?.(); hornStop = null;
    if (!p) return;
    p.vvvf.silence(); p.resistance.silence(); p.running.silence(); p.brakes.silence(); p.station.silence(); p.alarms.silence(); p.ambience.silence();
  }

  /** 車内放送: チャイム → 音声 */
  function announce(text: string, delay = 0) {
    if (p) {
      const t = p.core.now() + delay;
      p.core.tone(p.core.voice, 784, 1.1, .05, t, 'sine', .01);
      p.core.tone(p.core.voice, 1047, 1.4, .05, t + .32, 'sine', .01);
    }
    announcer.say(text, delay + 1.1);
  }

  events.on('start', () => { ensure(); doorsOpen = false; });
  // 一時停止: AudioContext ごと止める（走行音・VVVF・ブレーキ・警報・踏切・予約済みの音の時刻も止まる）。放送は残り時間を保持
  events.on('pause', e => {
    hornStop?.(); hornStop = null;
    // suspend/resume は非同期。連打で順序が入れ替わらないよう、状態を見ずに毎回最後の指示を出す
    if (e.paused) { announcer.pause(); if (ac && ac.state !== 'closed') void ac.suspend(); }
    else { if (ac && ac.state !== 'closed') void ac.resume(); announcer.resume(); }
  });
  events.on('reset', () => { silenceAll(); doorsOpen = false; });
  events.on('notch', e => { if (!p) return; p.alarms.click(e.notch); p.brakes.notch(e.notch, e.prev); });
  events.on('stop', () => p?.brakes.stopped());
  events.on('jointPass', e => p?.running.joint(e.v, e.s, Math.floor(e.s / JOINT_INTERVAL) * JOINT_INTERVAL));
  events.on('alarm', () => p?.alarms.beep());

  events.on('depart', e => {
    let delay = 2;
    // 始発（停車時間なしで発車する場合）はここで発車メロディ。途中駅は停車中に鳴らし済み
    if (p && !fromDwell) delay = p.station.melody() + .5;
    // 待避から発車するときは「お待たせしました」から（優等列車の通過・待ち合わせを待った駅）
    const ot = ctx.state.overtake;
    const text = departText(ctx.route, e.index, !!ot && ot.station === e.index && ot.localStopped, ctx.service);
    if (text) announce(text, delay);
  });
  events.on('stationApproach', e => {
    if (e.stage !== 'announce') return;
    announce(approachText(ctx.route, e.index, ctx.service));
  });
  events.on('arrive', e => {
    if (e.judgement.kind === 'overrun') return;
    announcer.say(arriveText(ctx.route, ctx.service, e.index), 1.2);
  });
  events.on('stateChange', e => {
    fromDwell = e.from === 'dwell' && e.to === 'run';
    if (e.to === 'dwell') dwellMelody = false;
    if (e.to === 'title') silenceAll();
  });
  events.on('doorOpen', () => { doorsOpen = true; p?.station.door(true); });
  events.on('doorClose', () => {
    doorsOpen = false; p?.station.door(false);
    announcer.say('ドアが閉まります。ご注意ください。', .2);
  });
  events.on('result', () => {
    if (!p) return;
    p.vvvf.silence(); p.resistance.silence(); p.alarms.atsBell(false); p.alarms.atsBuzzer(false);
    p.core.tone(p.core.voice, 988, .6, .06); p.core.tone(p.core.voice, 784, .9, .06, p.core.now() + .35);
  });

  events.on('ats', e => {
    if (!p) return;
    if (e.kind === 'warn') p.alarms.atsBell(true);
    else if (e.kind === 'brake') { p.alarms.atsBell(false); p.alarms.atsBuzzer(true); }
    else { p.alarms.atsBell(false); p.alarms.atsBuzzer(false); }
  });
  events.on('oncomingHorn', e => p?.alarms.horn(1.3, { far: Math.max(0, Math.min(1, e.distance / 700)), pitch: 1.03 }));
  events.on('oncomingPass', e => p?.ambience.pass(e.proximity));
  events.on('overtakePass', e => p?.ambience.pass(e.proximity)); // [G] 待避中の通過列車
  events.on('envChange', e => p?.ambience.setEnv(e));
  events.on('crossing', e => p?.alarms.crossing(e.id, e.active, e.distance, ctx.state.train.v));
  events.on('tunnel', e => p?.running.setTunnel(e.inside));
  events.on('cameraMode', e => {
    if (!p) return;
    // 車外視点: 車体越しのこもりを外す
    p.core.runTone.frequency.setTargetAtTime(e.mode === 'cab' ? 9000 : 18000, p.core.now(), .1);
  });
  events.on('titleRender', e => renderSettingsUi(e.container, settings));

  events.on('frame', e => {
    if (!p) return;
    const tr = ctx.state.train, st = e.state;
    if (st === 'title') return;
    const live = st === 'run' || st === 'dwell';
    // 主回路音: 旧型通勤車・10000系は抵抗制御。更新9000系・12000系は明示的にVVVF。
    const k = ctx.service?.kind, resist = k === 'commuter-old' || k === 'southern-10000';
    const vvvf = k === 'commuter-9000' || k === 'southern-12000';
    const [drive, idle] = resist && !vvvf ? [p.resistance, p.vvvf] : [p.vvvf, p.resistance];
    if (idle !== lastIdle) { idle.silence(); lastIdle = idle; }
    drive.update(live ? tr.v : 0, live ? tr.notch : 0);
    p.running.update(tr.v, tr.s);
    p.brakes.update(e.dt, tr.v, tr.notch, live);
    p.alarms.update(e.dt);
    p.ambience.update(e.dt, tr.v);
    p.station.update();

    // 途中駅の停車中: 発車の少し前に発車メロディ
    if (st === 'dwell' && !dwellMelody && ctx.state.dwellT < 8 + MELODY_LEAD) {
      dwellMelody = true; p.station.melody();
    }
    // ホームに停車中はざわめき（ドア開で大きく）
    const atPlatform = tr.v < .5 && ctx.route.stations.some(s => tr.s >= s.platform.from && tr.s <= s.platform.to + 30);
    p.station.setMurmur(atPlatform ? (doorsOpen ? 1.6 : 1) : 0);
  });

  // 警笛（H 長押し）・消音（M）。入力モジュールとは独立にここで購読
  const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox';
  window.addEventListener('keydown', ev => {
    if (ev.repeat || isTyping(ev.target)) return;
    if (ev.code === 'KeyH') {
      if (ctx.state.paused) return;
      const parts = ensure();
      if (parts && !hornStop) hornStop = parts.alarms.hornStart();
    } else if (ev.code === 'KeyM') {
      settings.set({ muted: !settings.value.muted });
      events.emit('banner', { text: settings.value.muted ? '消音' : '消音解除', sec: 1.2 });
    }
  });
  const hornOff = () => { hornStop?.(); hornStop = null; };
  window.addEventListener('keyup', ev => { if (ev.code === 'KeyH') hornOff(); });
  window.addEventListener('blur', hornOff);

  return {
    settings,
    get context() { return ac; },
    get bus() { return p ? p.core.sfx : null; },
  };
}
