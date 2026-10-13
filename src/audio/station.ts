// 駅の音: ドアチャイム・ドア開閉・発車メロディ（オリジナル）・ホームのざわめき
import { bell, type AudioCore } from './engine';
import type { Brakes } from './brakes';

export interface StationSfx {
  doorChime(when?: number): void;
  door(open: boolean): void;
  /** 発車メロディ。戻り値 = 長さ [s] */
  melody(): number;
  /** ホームのざわめき量 0..1 */
  setMurmur(x: number): void;
  update(): void;
  silence(): void;
}

// 発車メロディ（オリジナル作曲・ヘ長調・♩=120 の8分音符単位）。[開始拍, MIDI, 長さ拍]
const MELODY: [number, number, number][] = [
  [0, 84, 1], [1, 81, 1], [2, 77, 1], [3, 81, 1], [4, 84, 1], [5, 86, 1], [6, 84, 2],
  [8, 82, 1], [9, 79, 1], [10, 76, 1], [11, 79, 1], [12, 82, 1], [13, 84, 1], [14, 82, 2],
  [16, 81, 1], [17, 84, 1], [18, 89, 1], [19, 88, 1], [20, 86, 1], [21, 84, 1], [22, 82, 1], [23, 81, 1],
  [24, 79, 2], [26, 84, 2], [28, 77, 4],
];
const BASS: [number, number, number][] = [[0, 53, 4], [4, 57, 4], [8, 55, 4], [12, 52, 4], [16, 53, 4], [20, 50, 4], [24, 48, 4], [28, 53, 4]];
const BEAT = .25;
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function createStation(core: AudioCore, brakes: Brakes): StationSfx {
  const { ac } = core;

  // ホームのスピーカー経由の響き（帯域制限＋短いディレイ）
  const speaker = ac.createGain(); speaker.gain.value = .9;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5500;
  const delay = ac.createDelay(1); delay.delayTime.value = .19;
  const fb = ac.createGain(); fb.gain.value = .28;
  speaker.connect(hp).connect(lp).connect(core.sfx);
  lp.connect(delay).connect(fb).connect(delay); fb.connect(core.sfx);

  // ざわめき: 声の帯域の狭帯域ノイズ数本をゆっくり揺らす
  const murmurOut = ac.createGain(); murmurOut.gain.value = 0; murmurOut.connect(core.sfx);
  const voices = [380, 620, 950, 1500].map((f, i) => {
    const src = core.noiseSrc(i % 2 ? 'pink' : 'white');
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 5;
    const g = ac.createGain(); g.gain.value = .3;
    src.connect(bp).connect(g).connect(murmurOut);
    return { g, bp, f, phase: Math.random() * 10 };
  });

  function doorChime(when = ac.currentTime) {
      // 2音の下降チャイム ×3（オリジナル）
      for (let i = 0; i < 3; i++) {
        const t = when + i * .62;
        core.tone(core.sfx, 1175, .55, .07, t, 'sine', .004);
        core.tone(core.sfx, 2350, .25, .012, t, 'sine', .004);
        core.tone(core.sfx, 880, .7, .07, t + .3, 'sine', .004);
        core.tone(core.sfx, 1760, .3, .012, t + .3, 'sine', .004);
      }
  }

  return {
    doorChime,
    door(open) {
      const t = ac.currentTime + (open ? .1 : 1.9);
      if (!open) doorChime();
      // エア（プシュー）→ 戸袋への摺動（ゴロゴロ）→ 当たり（ドン）
      brakes.hiss(t, open ? .9 : .7, .07, 2600);
      const slide = core.noiseSrc('brown', t + .1, 1.4);
      const slp = ac.createBiquadFilter(); slp.type = 'bandpass'; slp.frequency.value = 260; slp.Q.value = 1.2;
      const sg = ac.createGain();
      sg.gain.setValueAtTime(0, t + .1); sg.gain.linearRampToValueAtTime(.22, t + .3);
      sg.gain.linearRampToValueAtTime(.18, t + 1.1); sg.gain.exponentialRampToValueAtTime(.0001, t + 1.35);
      slide.connect(slp).connect(sg).connect(core.sfx);
      core.burst(core.sfx, { when: t + 1.2, dur: .2, vol: open ? .14 : .26, f: 110, q: .8, kind: 'brown' });
      core.burst(core.sfx, { when: t + 1.2, dur: .05, vol: .05, f: 1800, q: 2 });
    },
    melody() {
      const t0 = ac.currentTime + .1;
      for (const [b, m, len] of MELODY) bell(core, speaker, midi(m), t0 + b * BEAT, .085, .45 + len * BEAT,
        [[1, 1, 1], [2, .35, .6], [3, .12, .4], [4.2, .08, .3]]);
      for (const [b, m, len] of BASS) core.tone(speaker, midi(m + 12), len * BEAT * 1.1, .045, t0 + b * BEAT, 'triangle', .01);
      return 32 * BEAT + .6;
    },
    setMurmur(x) { murmurOut.gain.setTargetAtTime(.05 * x, ac.currentTime, .8); },
    update() {
      const now = ac.currentTime;
      for (const v of voices) {
        v.phase += .016;
        const a = .15 + .35 * Math.max(0, Math.sin(v.phase * 1.3 + Math.sin(v.phase * .37) * 3));
        v.g.gain.setTargetAtTime(a, now, .12);
        v.bp.frequency.setTargetAtTime(v.f * (1 + .15 * Math.sin(v.phase * 2.1)), now, .2);
      }
    },
    silence() { murmurOut.gain.setTargetAtTime(0, ac.currentTime, .3); },
  };
}
