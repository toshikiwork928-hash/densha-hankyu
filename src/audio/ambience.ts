// 環境音: 雨（窓ガラスの雨粒・屋根）・雪・強風、対向列車のすれ違い（風圧＋相手のモーター音＋ジョイント音）
import type { EnvState } from '../core/events';
import type { OncomingSpec } from '../route/types';
import type { AudioCore } from './engine';

export interface Ambience {
  setEnv(e: EnvState): void;
  /** proximity 0..1（対向列車の近さ） */
  pass(proximity: number): void;
  update(dt: number, v: number): void;
  silence(): void;
}

export function createAmbience(core: AudioCore, getOncoming: () => OncomingSpec | undefined): Ambience {
  const { ac } = core;
  const dest = core.sfx;

  // 雨: 細かいザー（高域）＋屋根を打つ低いサー
  const rain = core.noiseSrc('pink');
  const rainHp = ac.createBiquadFilter(); rainHp.type = 'highpass'; rainHp.frequency.value = 1800;
  const rainLp = ac.createBiquadFilter(); rainLp.type = 'lowpass'; rainLp.frequency.value = 9000;
  const rainG = ac.createGain(); rainG.gain.value = 0;
  rain.connect(rainHp).connect(rainLp).connect(rainG).connect(dest);
  const roof = core.noiseSrc('brown');
  const roofBp = ac.createBiquadFilter(); roofBp.type = 'bandpass'; roofBp.frequency.value = 450; roofBp.Q.value = .7;
  const roofG = ac.createGain(); roofG.gain.value = 0;
  roof.connect(roofBp).connect(roofG).connect(dest);
  // 強風（ゆっくりした息づき）
  const gust = core.noiseSrc('pink');
  const gustBp = ac.createBiquadFilter(); gustBp.type = 'bandpass'; gustBp.frequency.value = 350; gustBp.Q.value = .8;
  const gustG = ac.createGain(); gustG.gain.value = 0;
  gust.connect(gustBp).connect(gustG).connect(dest);

  // すれ違い: 風圧（ドン＋ゴー）
  const whoosh = core.noiseSrc('pink');
  const whBp = ac.createBiquadFilter(); whBp.type = 'bandpass'; whBp.frequency.value = 500; whBp.Q.value = .6;
  const whG = ac.createGain(); whG.gain.value = 0;
  whoosh.connect(whBp).connect(whG).connect(core.run);
  // 相手のインバータ音（固定ぎみのキャリア＋側帯）と歯車音
  const oc = ac.createOscillator(); oc.type = 'triangle'; oc.frequency.value = 760;
  const ocM = ac.createOscillator(); ocM.frequency.value = 230;
  const ocAm = ac.createGain(); ocAm.gain.value = .4; const ocD = ac.createGain(); ocD.gain.value = .5;
  ocM.connect(ocD).connect(ocAm.gain); oc.connect(ocAm);
  const og = ac.createOscillator(); og.frequency.value = 820;
  const ogG = ac.createGain(); ogG.gain.value = .5; og.connect(ogG);
  const ocG = ac.createGain(); ocG.gain.value = 0;
  ocAm.connect(ocG); ogG.connect(ocG); ocG.connect(core.run);
  oc.start(); ocM.start(); og.start();

  let weather: EnvState = { timeOfDay: 'noon', weather: 'clear', intensity: 0 };
  let prox = 0, dropT = 0, clatterT = 0, gustPh = 0, prevProx = 0, peaked = false;

  function drop(vol: number) {
    // 窓に当たる雨粒（ポツ）
    core.burst(dest, { dur: .012 + Math.random() * .015, vol, f: 3000 + Math.random() * 5000, q: 2 + Math.random() * 3 });
  }

  return {
    setEnv(e) {
      weather = e;
      const now = ac.currentTime, k = Math.max(0, Math.min(1, e.intensity || (e.weather === 'clear' || e.weather === 'fog' ? 0 : .6)));
      const isRain = e.weather === 'rain', isSnow = e.weather === 'snow';
      rainG.gain.setTargetAtTime(isRain ? .1 * k : isSnow ? .008 * k : 0, now, .8);
      roofG.gain.setTargetAtTime(isRain ? .1 * k : 0, now, .8);
      gustG.gain.setTargetAtTime(isSnow || (isRain && k > .7) ? .05 * k : 0, now, 1);
    },
    pass(p) { prox = p; },
    update(dt, v) {
      const now = ac.currentTime, kmh = v * 3.6;
      // 雨粒: 強さと速度で頻度が増える
      if (weather.weather === 'rain') {
        const k = weather.intensity || .6;
        dropT -= dt * (6 + 24 * k) * (1 + Math.min(kmh, 90) / 60);
        while (dropT < 0) { dropT += Math.random() * 2; drop(.02 + .03 * Math.random() * k); }
      }
      if (weather.weather === 'snow' || weather.weather === 'rain') {
        gustPh += dt;
        gustBp.frequency.setTargetAtTime(300 + 200 * Math.sin(gustPh * .4) + kmh * 3, now, .5);
      }

      // すれ違い
      const p = prox;
      whBp.frequency.setTargetAtTime(400 + 1200 * p, now, .05);
      whG.gain.setTargetAtTime(.45 * p * p, now, .05);
      ocG.gain.setTargetAtTime(.025 * p * p, now, .08);
      // 先頭が並んだ瞬間の風圧（ドン）
      if (p > .85 && !peaked && p >= prevProx) { peaked = true; core.burst(core.run, { dur: .35, vol: .3, f: 140, q: .6, kind: 'brown' }); }
      if (p < .3) peaked = false;
      prevProx = p;
      // 相手の台車がジョイントを叩くタタン・タタン（相対速度で車長ごと）
      if (p > .45) {
        clatterT -= dt;
        if (clatterT <= 0) {
          const oc = getOncoming(), vrel = Math.max(5, v + (oc?.kmh ?? 80) / 3.6);
          clatterT += (oc?.carLen ?? 20) / vrel;
          const t = ac.currentTime, vol = .07 * p;
          for (const d of [0, 2.1, 8.2, 10.3]) core.burst(core.run, { when: t + d / vrel, dur: .05, vol, f: 900, q: 1, kind: 'white' });
        }
      } else clatterT = 0;
    },
    silence() {
      const now = ac.currentTime;
      whG.gain.setTargetAtTime(0, now, .1); ocG.gain.setTargetAtTime(0, now, .1); prox = 0;
    },
  };
}
