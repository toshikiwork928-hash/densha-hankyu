// 抵抗制御（カム軸式）の旧型通勤電車の主回路音
// - VVVF 車の音から VVVF の成分（キャリア・側帯波・ヒス・同期モードの音程階段）を抜いた音: 主電動機の電磁音（高調波）と低いうなり、歯車音
// - 力行中は速度上昇に合わせてカム軸が1段ずつ進み「カチッ」。直列 → 並列の渡りは少し大きく、一瞬電流が抜ける
// - 惰行は歯車音だけ。ブレーキは空気ブレーキのみ（発電・回生のうなりは無し）。ノッチを切るとカムが戻る音
// Vvvf と同じインターフェイスで差し替える
import { harmonicWave, type AudioCore } from './engine';
import type { Vvvf } from './vvvf';

const HZ_PER_KMH = 1.45; // 電動機回転周波数 [Hz/(km/h)]（VVVF の出力周波数と同じ）
const GEAR_RATIO = 6.07;

/** カム段の切替速度 [km/h]: 直列 → 渡り → 並列 → 弱め界磁 */
const SERIES = Array.from({ length: 11 }, (_, i) => 3 + i * 3.6);   // 3 .. 39
const TRANSITION = 44;
const PARALLEL = Array.from({ length: 8 }, (_, i) => 47 + i * 3.2); // 47 .. 69.4
const FIELD = [73, 77, 81, 85];
/** ノッチ別の到達可能な最終段（P1 = 起動段のみ、P2 = 直列、P3 = 並列、P4/P5 = 弱め界磁） */
const STEPS = [...SERIES, TRANSITION, ...PARALLEL, ...FIELD];
const maxStep = (notch: number) => notch <= 1 ? 1 : notch === 2 ? SERIES.length : notch === 3 ? SERIES.length + 1 + PARALLEL.length : notch === 4 ? STEPS.length - 2 : STEPS.length;

export function createResistance(core: AudioCore, dest: AudioNode = core.run): Vvvf {
  const { ac } = core;
  const out = ac.createGain(); out.gain.value = 0;
  const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200; tone.Q.value = .5;
  out.connect(tone).connect(dest);

  // 主電動機の電磁音（VVVF 車と同じ 6k±1 次の高調波・基本波のうなり。インバータのキャリア・側帯波・ヒスは無し）。回転数に比例して滑らかに音程が上がる
  const motor = ac.createOscillator(); motor.setPeriodicWave(harmonicWave(ac, { 1: .25, 2: .2, 5: 1, 7: .7, 11: .35, 13: .28, 17: .12, 19: .1 }));
  const motorLp = ac.createBiquadFilter(); motorLp.type = 'lowpass'; motorLp.frequency.value = 1800;
  const motorG = ac.createGain(); motorG.gain.value = .5;
  motor.connect(motorLp).connect(motorG).connect(out);
  const hum = ac.createOscillator(); hum.type = 'sawtooth';
  const humLp = ac.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 220;
  const humG = ac.createGain(); humG.gain.value = .25;
  hum.connect(humLp).connect(humG).connect(out);

  // 歯車音（惰行中も鳴る）
  const gearOut = ac.createGain(); gearOut.gain.value = 0; gearOut.connect(dest);
  const gear = ac.createOscillator(); gear.setPeriodicWave(harmonicWave(ac, { 1: 1, 2: .4, 3: .12 }));
  const gearToneG = ac.createGain(); gearToneG.gain.value = .5;
  gear.connect(gearToneG).connect(gearOut);
  const gearNoise = core.noiseSrc('white');
  const gearBp = ac.createBiquadFilter(); gearBp.type = 'bandpass'; gearBp.Q.value = 14; gearBp.frequency.value = 100;
  const gearNG = ac.createGain(); gearNG.gain.value = 2.4;
  gearNoise.connect(gearBp).connect(gearNG).connect(gearOut);

  for (const o of [motor, hum, gear]) o.start();

  // カム軸の音（運転台の床下から聞こえる機械音）は走行系バスへ
  const camBus = ac.createGain(); camBus.gain.value = 1; camBus.connect(dest);
  function camClick(loud: number, when = core.now()) {
    core.burst(camBus, { when, dur: .045, vol: .05 * loud, type: 'bandpass', f: 2600, q: 2.5 });
    core.burst(camBus, { when: when + .012, dur: .09, vol: .035 * loud, type: 'bandpass', f: 700, q: 1.5 });
    core.tone(camBus, 140, .08, .03 * loud, when, 'triangle');
  }

  let step = 0, active = false, surge = 1, surgeT = 0, gap = 0, lastT = core.now();

  function update(v: number, notch: number) {
    const now = core.now(), dt = Math.min(.1, Math.max(0, now - lastT)); lastT = now;
    const kmh = Math.max(0, v * 3.6), power = notch > 0;

    // カム軸: 力行中は速度に応じて1段ずつ進む（1回の更新で最大1段）
    if (power) {
      if (step === 0) { step = 1; camClick(1); surge = 1.15; }
      const lim = maxStep(notch);
      if (step < lim && kmh >= STEPS[step - 1]) {
        step++;
        const isTransition = STEPS[step - 2] === TRANSITION;
        if (isTransition) { camClick(2.2); camClick(1.2, now + .12); gap = .35; }
        else camClick(1);
        surge = isTransition ? 1.25 : 1.12; surgeT = 0;
      } else if (step > lim) step = lim; // ノッチを戻した
    } else if (step > 0) {
      // ノッチオフ: カムが戻る（ガラガラ）
      const n = Math.min(6, 2 + Math.floor(step / 4));
      for (let i = 0; i < n; i++) camClick(.45, now + .05 + i * .05);
      step = 0;
    }
    surgeT += dt; surge = 1 + (surge - 1) * Math.exp(-dt / .35);
    gap = Math.max(0, gap - dt);

    // 電動機の回転・音程（VVVF の出力周波数と同じ。段階ではなく連続して上がる）
    const fr = Math.max(.5, kmh * HZ_PER_KMH);
    motor.frequency.setTargetAtTime(fr, now, .04);
    hum.frequency.setTargetAtTime(fr, now, .04);

    // 電流: 直列・並列の抵抗段では大きく、弱め界磁以降は速度とともに減る
    const notchI = power ? Math.min(1, .45 + notch * .14) : 0;
    const highV = kmh > 85 ? Math.max(.45, 1 - (kmh - 85) / 50) : 1;
    // 起動直後は控えめに（速度 0〜15km/h で 35%→100%）
    const lt = Math.min(1, kmh / 15), start = .35 + .65 * lt * lt * (3 - 2 * lt);
    const vol = power && gap <= 0 ? .1 * notchI * highV * start * surge : 0;
    out.gain.setTargetAtTime(vol, now, power && !active ? .05 : gap > 0 ? .03 : power ? .08 : .12);
    active = power;

    // 歯車音
    const gf = GEAR_RATIO * kmh * 1.45 * .55;
    gear.frequency.setTargetAtTime(Math.max(20, gf), now, .03);
    gearBp.frequency.setTargetAtTime(Math.max(20, gf), now, .03);
    const gv = kmh < 3 ? 0 : .016 * Math.min(1, kmh / 60) * (1 + .8 * (power ? notchI : 0));
    gearOut.gain.setTargetAtTime(gv, now, .08);
  }

  return {
    update,
    silence() {
      const now = core.now();
      out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0, now, .05); gearOut.gain.setTargetAtTime(0, now, .05);
      active = false; step = 0;
    },
    get mode() { return step === 0 ? 'off' : step <= SERIES.length ? `直列${step}` : step <= SERIES.length + 1 ? '渡り' : step <= SERIES.length + 1 + PARALLEL.length ? `並列${step - SERIES.length - 1}` : `弱め界磁${step - SERIES.length - 1 - PARALLEL.length}`; },
  };
}
