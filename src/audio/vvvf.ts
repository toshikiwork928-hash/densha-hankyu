// VVVF インバータ・主電動機・歯車の合成音
// 出力周波数 f ≈ 1.45 × km/h [Hz]（車輪径 860mm・歯車比 7・4極機を想定）
// 低速: 非同期（キャリア固定ぎみ）→ 同期 27P→15P→9P→5P→3P → 1パルス。回生ブレーキは同じ梯子を逆に降りる
import { NOTCH_EB } from '../core/config';
import { harmonicWave, type AudioCore } from './engine';
import type { TractionSound } from './settings';

interface Mode { until: number; pulses: number } // pulses = 0 は非同期
const MODES: Mode[] = [
  { until: 25, pulses: 0 },
  { until: 33, pulses: 27 },
  { until: 45, pulses: 15 },
  { until: 57, pulses: 9 },
  { until: 64, pulses: 5 },
  { until: 70, pulses: 3 },
  { until: Infinity, pulses: 1 },
];
const HZ_PER_KMH = 1.45;
const GEAR_RATIO = 7; // 歯車かみ合い周波数 = 7 × f

export interface Vvvf {
  update(v: number, notch: number): void;
  /** 即時停止（リセット時） */
  silence(): void;
  /** デバッグ用: 現在モード */
  readonly mode: string;
}

export function createVvvf(core: AudioCore, dest: AudioNode = core.run, getSound: () => TractionSound = () => 'soft'): Vvvf {
  const { ac } = core;
  const out = ac.createGain(); out.gain.value = 0; // インバータ動作中の音量
  const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 5200; tone.Q.value = .4;
  // 車体越しに聞こえる磁励音を近似。耳に刺さる高い倍音を全体音量と独立に抑える。
  const presence = ac.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = .75;
  out.connect(tone).connect(presence).connect(dest);

  // キャリア（PWM の主成分）。わずかに倍音を含む
  const carrierWave = harmonicWave(ac, { 1: 1, 2: .12, 3: .18, 5: .05 });
  const softCarrierWave = harmonicWave(ac, { 1: 1, 2: .025, 3: .035, 5: .006 });
  const carrier = ac.createOscillator(); carrier.setPeriodicWave(carrierWave); carrier.frequency.value = 1000;
  // fc ± 2f の側帯波: キャリアを 2f で振幅変調（キャリア抑圧）
  const mod2f = ac.createOscillator(); mod2f.frequency.value = 1;
  const amSide = ac.createGain(); amSide.gain.value = 0;
  const sideDepth = ac.createGain(); sideDepth.gain.value = .6;
  mod2f.connect(sideDepth).connect(amSide.gain);
  const carrierDirect = ac.createGain(); carrierDirect.gain.value = .5;
  carrier.connect(carrierDirect); carrier.connect(amSide);
  // 2fc ± f の成分（弱め）
  const carrier2 = ac.createOscillator(); carrier2.frequency.value = 2000;
  const modF = ac.createOscillator(); modF.frequency.value = 1;
  const am2 = ac.createGain(); am2.gain.value = 0;
  const am2Depth = ac.createGain(); am2Depth.gain.value = .22;
  carrier2.connect(am2); modF.connect(am2Depth).connect(am2.gain);
  const carrierMix = ac.createGain(); carrierMix.gain.value = 1;
  carrierDirect.connect(carrierMix); amSide.connect(carrierMix); am2.connect(carrierMix);
  carrierMix.connect(out);

  // キャリア周辺のインバータ雑音（シャー）
  const hiss = core.noiseSrc('white');
  const hissBp = ac.createBiquadFilter(); hissBp.type = 'bandpass'; hissBp.Q.value = 3; hissBp.frequency.value = 1000;
  const hissG = ac.createGain(); hissG.gain.value = .12;
  hiss.connect(hissBp).connect(hissG).connect(out);

  // 主電動機の電磁音（6k±1 次高調波が支配的。1パルスで目立つ）
  const motorWave = harmonicWave(ac, { 1: .25, 2: .2, 5: 1, 7: .7, 11: .35, 13: .28, 17: .12, 19: .1, 23: .05 });
  const motor = ac.createOscillator(); motor.setPeriodicWave(motorWave); motor.frequency.value = 1;
  const motorG = ac.createGain(); motorG.gain.value = 0;
  const motorLp = ac.createBiquadFilter(); motorLp.type = 'lowpass'; motorLp.frequency.value = 2600;
  motor.connect(motorLp).connect(motorG).connect(out);

  // 低いうなり（基本波・トルク脈動）
  const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 1;
  const humLp = ac.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 220;
  const humG = ac.createGain(); humG.gain.value = .25;
  hum.connect(humLp).connect(humG).connect(out);

  // 歯車音（惰行中も鳴る）。正弦＋狭帯域ノイズでざらつき
  const gearOut = ac.createGain(); gearOut.gain.value = 0;
  const gearLp = ac.createBiquadFilter(); gearLp.type = 'lowpass'; gearLp.Q.value = .5;
  gearOut.connect(gearLp).connect(dest);
  const gear = ac.createOscillator(); gear.setPeriodicWave(harmonicWave(ac, { 1: 1, 2: .35, 3: .08 })); gear.frequency.value = 100;
  const gearToneG = ac.createGain(); gearToneG.gain.value = .55;
  gear.connect(gearToneG).connect(gearOut);
  const gearNoise = core.noiseSrc('white');
  const gearBp = ac.createBiquadFilter(); gearBp.type = 'bandpass'; gearBp.Q.value = 18; gearBp.frequency.value = 100;
  const gearNG = ac.createGain(); gearNG.gain.value = 2.2;
  gearNoise.connect(gearBp).connect(gearNG).connect(gearOut);

  for (const o of [carrier, mod2f, carrier2, modF, motor, hum, gear]) o.start();

  let modeIdx = 0, active = false, lastSound: TractionSound | null = null;
  const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

  function update(v: number, notch: number) {
    const now = ac.currentTime, kmh = Math.max(0, v * 3.6);
    const sound = getSound(), legacy = sound === 'legacy';
    if (sound !== lastSound) {
      carrier.setPeriodicWave(legacy ? carrierWave : softCarrierWave);
      tone.frequency.setTargetAtTime(legacy ? 5200 : 2400, now, .12);
      presence.gain.setTargetAtTime(legacy ? 0 : -6, now, .12);
      carrierDirect.gain.setTargetAtTime(legacy ? .5 : .14, now, .1);
      sideDepth.gain.setTargetAtTime(legacy ? .6 : .46, now, .1);
      am2Depth.gain.setTargetAtTime(legacy ? .22 : .065, now, .1);
      humG.gain.setTargetAtTime(legacy ? .25 : .45, now, .1);
      gearToneG.gain.setTargetAtTime(legacy ? .55 : .32, now, .1);
      gearNG.gain.setTargetAtTime(legacy ? 2.2 : 1.6, now, .1);
      gearLp.frequency.setTargetAtTime(legacy ? ac.sampleRate * .49 : 2200, now, .12);
      lastSound = sound;
    }
    const power = notch > 0, brake = notch < 0 && notch > NOTCH_EB;
    // 回生は 5km/h 付近で失効（電空切替）。力行は停止中から
    const regenFade = brake ? Math.min(1, Math.max(0, (kmh - 4) / 6)) : 0;
    const tq = power ? notch / 5 : brake ? Math.min(1, -notch / 7) * regenFade : 0;
    const on = tq > 0.001;

    // 出力周波数（すべり: 力行 +、回生 −）
    const slip = power ? 1 + 1.5 * tq : brake ? -1.2 * tq : 0;
    const f = Math.max(.5, kmh * HZ_PER_KMH + slip);

    // モード決定（回生側は 2km/h 低めで切替＝ヒステリシス）
    const hyst = brake ? -2 : 0;
    let mi = MODES.findIndex(m => kmh < m.until + hyst);
    if (mi < 0) mi = MODES.length - 1;
    // 同じ境界を速度が往復してもモードが毎フレーム切り替わらない。
    if (!legacy && mi !== modeIdx) {
      if (mi > modeIdx && kmh < MODES[modeIdx].until + hyst + .8) mi = modeIdx;
      if (mi < modeIdx && kmh > MODES[modeIdx - 1].until + hyst - .8) mi = modeIdx;
    }
    const m = MODES[mi];
    let fc: number;
    // 改良音は低い起動キャリアから立ち上げる独自近似。実車の制御値ではない。
    if (m.pulses === 0) fc = legacy ? 1000 + 200 * Math.min(1, kmh / 25) : 220 + 330 * smooth(kmh / 25);
    else fc = m.pulses * f;

    const jumped = mi !== modeIdx;
    modeIdx = mi;
    const setF = (p: AudioParam, val: number) => {
      if (legacy && jumped) { p.cancelScheduledValues(now); p.setValueAtTime(val, now); }
      else p.setTargetAtTime(val, now, legacy ? .025 : jumped ? .055 : .035);
    };
    const one = m.pulses === 1;
    setF(carrier.frequency, Math.max(20, fc));
    setF(carrier2.frequency, Math.max(40, fc * 2));
    setF(hissBp.frequency, Math.max(200, fc));
    setF(mod2f.frequency, 2 * f);
    setF(modF.frequency, f);
    setF(motor.frequency, f);
    setF(hum.frequency, f);

    // 各層の配分: 1パルスはキャリア無し・電動機音主体
    const carrierLevel = one ? 0 : m.pulses === 3 ? .55 : m.pulses === 5 ? .75 : 1;
    carrierMix.gain.setTargetAtTime(carrierLevel * (legacy ? 1 : .62 + .38 * smooth(kmh / 18)), now, legacy ? .01 : .05);
    hissG.gain.setTargetAtTime((one ? .02 : .1) * (legacy ? 1 : .6), now, .05);
    const motorLevel = one ? .55 : m.pulses && m.pulses <= 5 ? .3 : .12 * Math.min(1, kmh / 15);
    motorG.gain.setTargetAtTime(legacy ? motorLevel : motorLevel + .12 * smooth(kmh / 12), now, .05);

    // 全体音量: トルク依存。高速域（定出力域）では電流が減って少し静かに
    const speedShape = .55 + .45 * Math.min(1, kmh / 30);
    const fieldWeak = kmh > 75 ? Math.max(.6, 1 - (kmh - 75) / 80) : 1;
    // 起動直後（非同期域の低速）はうるさく感じるので 35% から 20km/h までに滑らかに 100% へ
    const lt = Math.min(1, kmh / 20), lowFade = .35 + .65 * lt * lt * (3 - 2 * lt);
    // 停止状態でPを入れただけでは高い音を鳴らさず、車輪の動きとともに出す。
    const motion = legacy ? 1 : smooth(kmh / .9);
    const vol = on ? (legacy ? .085 : .095) * Math.pow(tq, .55) * speedShape * fieldWeak * lowFade * motion : 0;
    // ゲート ON は速く、OFF は少し余韻
    out.gain.setTargetAtTime(vol, now, legacy ? on && !active ? .03 : on ? .06 : .09 : on ? .1 : .12);
    active = on;

    // 歯車音: 速度依存＋トルクで増える
    const gf = GEAR_RATIO * kmh * HZ_PER_KMH;
    gear.frequency.setTargetAtTime(Math.max(20, gf), now, .03);
    gearBp.frequency.setTargetAtTime(Math.max(20, gf), now, .03);
    const gv = kmh < 3 ? 0 : .018 * Math.min(1, kmh / 60) * (1 + 1.2 * tq);
    gearOut.gain.setTargetAtTime(gv, now, .08);
  }

  return {
    update,
    silence() { const now = ac.currentTime; out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0, now, .05); gearOut.gain.setTargetAtTime(0, now, .05); active = false; },
    get mode() { const m = MODES[modeIdx]; return m.pulses === 0 ? 'async' : m.pulses + 'P'; },
  };
}
