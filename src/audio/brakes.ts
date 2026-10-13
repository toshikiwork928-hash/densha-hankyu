// 空気ブレーキ・コンプレッサ・停止直前のブレーキ鳴き
import { NOTCH_EB } from '../core/config';
import type { AudioCore } from './engine';

export interface Brakes {
  notch(notch: number, prev: number): void;
  update(dt: number, v: number, notch: number, active: boolean): void;
  stopped(): void;
  /** 汎用のエア音（ドア等でも使う） */
  hiss(when: number, dur: number, vol: number, f?: number): void;
  silence(): void;
}

const level = (n: number) => (n === NOTCH_EB ? 9 : n < 0 ? -n : 0);

export function createBrakes(core: AudioCore): Brakes {
  const { ac } = core;
  const dest = core.sfx;

  /** プシュー: 立ち上がり速く、尾を引いて消える */
  function hiss(when: number, dur: number, vol: number, f = 3200) {
    const t0 = Math.max(ac.currentTime, when);
    const src = core.noiseSrc('white', t0, dur + .1);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const bp = ac.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = f; bp.gain.value = 8; bp.Q.value = .8;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .03);
    g.gain.exponentialRampToValueAtTime(vol * .45, t0 + .03 + dur * .4);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    bp.frequency.setValueAtTime(f, t0); bp.frequency.exponentialRampToValueAtTime(f * .7, t0 + dur);
    src.connect(hp).connect(bp).connect(g).connect(dest);
  }

  // ブレーキ鳴き（キーー）: 2つの非整数倍音、ゆらぎ
  const sq = ac.createOscillator(); sq.frequency.value = 2650;
  const sqb = ac.createOscillator(); sqb.frequency.value = 3980;
  const sqbG = ac.createGain(); sqbG.gain.value = .4;
  const sqG = ac.createGain(); sqG.gain.value = 0;
  sq.connect(sqG); sqb.connect(sqbG).connect(sqG); sqG.connect(dest);
  sq.start(); sqb.start();

  // コンプレッサ（ドドドド…）: 低域ノイズを約 17Hz のピストン周期で変調
  const comp = core.noiseSrc('brown');
  const compLp = ac.createBiquadFilter(); compLp.type = 'lowpass'; compLp.frequency.value = 380;
  const compAm = ac.createGain(); compAm.gain.value = .5;
  const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 17;
  const lfoD = ac.createGain(); lfoD.gain.value = .45; lfo.connect(lfoD).connect(compAm.gain);
  const compHum = ac.createOscillator(); compHum.type = 'triangle'; compHum.frequency.value = 102;
  const compHumG = ac.createGain(); compHumG.gain.value = .12;
  const compG = ac.createGain(); compG.gain.value = 0;
  comp.connect(compLp).connect(compAm); compHum.connect(compHumG).connect(compAm);
  compAm.connect(compG).connect(core.run);
  lfo.start(); compHum.start();

  let compT = 20 + Math.random() * 25, compRun = 0, airUsed = 0, sqPhase = 0;

  return {
    hiss,
    notch(n, prev) {
      const t = ac.currentTime, a = level(n), b = level(prev);
      if (n === NOTCH_EB && prev !== NOTCH_EB) {
        // 非常: 大きく長いプシュー＋低い衝撃
        hiss(t, 2.6, .2, 2200);
        core.burst(dest, { dur: .25, vol: .25, f: 120, q: .7, kind: 'brown' });
        airUsed += 6;
      } else if (a < b) {
        // 緩め: ブレーキシリンダ排気（プシュー）
        const d = b - a;
        hiss(t + .05, .35 + .14 * d, .045 + .018 * Math.min(d, 6), 3600);
        airUsed += d * .6;
      } else if (a > b && b === 0) {
        // 込め始め: 短いシュッ
        hiss(t + .03, .18, .025, 5200);
      }
    },
    update(dt, v, n, activeRun) {
      const now = ac.currentTime, kmh = v * 3.6, lv = level(n);
      // 停止直前の鳴き: 10km/h 未満でブレーキ中、低速ほど強い
      let sv = 0;
      if (lv > 0 && kmh > .3 && kmh < 10) {
        sqPhase += dt;
        const near = 1 - kmh / 10;
        sv = .016 * near * near * Math.min(1, lv / 5) * (.6 + .4 * Math.sin(sqPhase * 9.3) * Math.sin(sqPhase * 2.2));
        sq.frequency.setTargetAtTime(2650 - 150 * near + 40 * Math.sin(sqPhase * 7), now, .05);
      }
      sqG.gain.setTargetAtTime(Math.max(0, sv), now, .04);

      // コンプレッサ: 空気を使うと早めに起動。停車中に目立つ
      if (!activeRun) { compG.gain.setTargetAtTime(0, now, .4); return; }
      if (compRun > 0) {
        compRun -= dt;
        compG.gain.setTargetAtTime(compRun > .6 ? .09 : 0, now, compRun > .6 ? .5 : .25);
        if (compRun <= 0) { compT = 35 + Math.random() * 40; hiss(now, .5, .03, 2500); /* アンローダ排気 */ }
      } else {
        compT -= dt * (1 + Math.min(3, airUsed / 6));
        if (compT <= 0) { compRun = 8 + Math.random() * 5; airUsed = 0; }
      }
    },
    stopped() {
      // 停止の瞬間: 車体の揺り戻し（コトン）
      core.burst(dest, { dur: .18, vol: .12, f: 90, q: .8, kind: 'brown' });
      sqG.gain.setTargetAtTime(0, ac.currentTime, .03);
    },
    silence() {
      const now = ac.currentTime;
      sqG.gain.setTargetAtTime(0, now, .05); compG.gain.setTargetAtTime(0, now, .2); compRun = 0;
    },
  };
}
