// 走行音: 転動音・風切り・橋梁の空洞音・レール継ぎ目（台車配置どおりのタタン・タタン）・フランジ音・トンネル残響
import type { Route } from '../route/types';
import type { AudioCore } from './engine';

// 20m 車・台車中心間 13.8m・軸距 2.1m → 先頭からの車軸位置 [m]
const CAR = 20, BOGIE_CENTERS = 13.8, AXLE = 2.1;
const OVERHANG = (CAR - BOGIE_CENTERS) / 2; // 3.1
function axleOffsets(cars: number): { d: number; w: number }[] {
  const list: { d: number; w: number }[] = [];
  for (let c = 0; c < cars; c++) {
    for (const bogie of [OVERHANG, OVERHANG + BOGIE_CENTERS]) {
      for (const a of [-AXLE / 2, AXLE / 2]) {
        const d = c * CAR + bogie + a;
        // 運転台直下の第1台車が一番大きく、後方ほど遠く小さく聞こえる
        const w = d < 6 ? 1 : 0.6 / (1 + (d - 6) / 14);
        list.push({ d, w });
      }
    }
  }
  return list;
}
const AXLES = axleOffsets(3);

export interface Running {
  update(v: number, s: number): void;
  /** 継ぎ目通過（先頭が jointS を越えた。s は現在位置） */
  joint(v: number, s: number, jointS: number): void;
  setTunnel(inside: boolean): void;
  silence(): void;
}

export function createRunning(core: AudioCore, getRoute: () => Route): Running {
  const { ac } = core;
  const dest = core.run;

  // 転動音（低域のゴー）
  const roll = core.noiseSrc('brown');
  const rollLp = ac.createBiquadFilter(); rollLp.type = 'lowpass'; rollLp.frequency.value = 200; rollLp.Q.value = .7;
  const rollPk = ac.createBiquadFilter(); rollPk.type = 'peaking'; rollPk.frequency.value = 70; rollPk.gain.value = 6; rollPk.Q.value = 1;
  const rollG = ac.createGain(); rollG.gain.value = 0;
  roll.connect(rollLp).connect(rollPk).connect(rollG).connect(dest);
  // レール面のザー（中高域）
  const rail = core.noiseSrc('pink');
  const railBp = ac.createBiquadFilter(); railBp.type = 'bandpass'; railBp.frequency.value = 900; railBp.Q.value = .6;
  const railG = ac.createGain(); railG.gain.value = 0;
  rail.connect(railBp).connect(railG).connect(dest);
  // 風切り（速度の2乗）
  const wind = core.noiseSrc('pink');
  const windBp = ac.createBiquadFilter(); windBp.type = 'bandpass'; windBp.frequency.value = 600; windBp.Q.value = .5;
  const windG = ac.createGain(); windG.gain.value = 0;
  wind.connect(windBp).connect(windG).connect(dest);
  // 橋梁・高架の空洞音
  const hollow = core.noiseSrc('brown');
  const hollowBp = ac.createBiquadFilter(); hollowBp.type = 'bandpass'; hollowBp.frequency.value = 95; hollowBp.Q.value = 2.5;
  const hollowG = ac.createGain(); hollowG.gain.value = 0;
  hollow.connect(hollowBp).connect(hollowG).connect(dest);
  // フランジ音（急曲線のキーー）
  const sq1 = ac.createOscillator(); sq1.frequency.value = 3150;
  const sq2 = ac.createOscillator(); sq2.frequency.value = 4720;
  const sqG = ac.createGain(); sqG.gain.value = 0;
  const sq2G = ac.createGain(); sq2G.gain.value = .5;
  sq1.connect(sqG); sq2.connect(sq2G).connect(sqG); sqG.connect(dest);
  sq1.start(); sq2.start();

  // 曲線半径・構造物の参照表（路線が差し替わったら作り直す）
  let cached: Route | null = null, curves: { from: number; to: number; r: number }[] = [], structs: NonNullable<Route['structures']> = [];
  const tables = () => {
    const route = getRoute();
    if (route === cached) return;
    cached = route; curves = []; structs = route.structures ?? [];
    let s = 0;
    for (const seg of route.segments) {
      const len = seg.type === 'straight' ? seg.length : seg.radius * seg.angle;
      if (seg.type === 'arc') curves.push({ from: s, to: s + len, r: seg.radius });
      s += len;
    }
  };
  const radiusAt = (s: number) => { for (const c of curves) if (s >= c.from && s < c.to) return c.r; return Infinity; };
  const structAt = (s: number, kind: string) => structs.some(st => st.kind === kind && s >= st.from && s < st.to);

  let tunnelEvt = false, tunnelNow = false, squealLevel = 0;

  function setTunnelState(inside: boolean) {
    if (inside === tunnelNow) return;
    tunnelNow = inside;
    const now = ac.currentTime;
    core.reverbSend.gain.setTargetAtTime(inside ? .55 : 0, now, inside ? .15 : .4);
    core.runLowShelf.gain.setTargetAtTime(inside ? 7 : 0, now, .2);
  }

  function update(v: number, s: number) {
    const now = ac.currentTime, kmh = v * 3.6, x = Math.min(1.3, kmh / 90);
    tables();
    const inTunnel = tunnelEvt || structAt(s, 'tunnel');
    setTunnelState(inTunnel);
    const tun = inTunnel ? 1.6 : 1;
    rollLp.frequency.setTargetAtTime(160 + kmh * 7, now, .2);
    rollG.gain.setTargetAtTime(kmh < .5 ? 0 : .22 * Math.pow(x, .8) * tun, now, .15);
    railBp.frequency.setTargetAtTime(600 + kmh * 9, now, .2);
    railG.gain.setTargetAtTime(.07 * Math.pow(x, 1.4) * tun, now, .2);
    windBp.frequency.setTargetAtTime(400 + kmh * 10, now, .3);
    windG.gain.setTargetAtTime(.11 * x * x * (inTunnel ? 1.9 : 1), now, .3);
    // 鉄橋は強く、コンクリート高架は控えめに
    const hollowK = structAt(s, 'bridge') ? 1 : structAt(s, 'viaduct') ? .4 : 0;
    hollowG.gain.setTargetAtTime(.5 * hollowK * Math.min(1, kmh / 50), now, .25);

    // フランジ音: R<700m で発生。半径が小さいほど強い。ゆらぎあり
    const r = radiusAt(s);
    const target = r < 700 && kmh > 8 ? Math.min(1, (700 - r) / 400) * Math.min(1, (kmh - 8) / 25) : 0;
    squealLevel += (target - squealLevel) * .05;
    const flutter = target > 0 ? (Math.random() < .08 ? Math.random() : .35 + .3 * Math.sin(now * 3.1) * Math.sin(now * 1.7)) : 0;
    sqG.gain.setTargetAtTime(.012 * squealLevel * Math.max(0, flutter), now, .06);
    sq1.frequency.setTargetAtTime(3150 + 120 * Math.sin(now * .9), now, .2);
  }

  /** ガタン1発: 低い打撃＋金属的なカチ */
  function click(t: number, vol: number, kmh: number) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + .07);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * .9, t + .003); g.gain.exponentialRampToValueAtTime(.0001, t + .11);
    o.connect(g).connect(dest); o.start(t); o.stop(t + .14);
    core.burst(dest, { when: t, dur: .05 + .02 * Math.random(), vol: vol * .55, f: 1100 + kmh * 12, q: 1.1 });
    core.burst(dest, { when: t, dur: .09, vol: vol * .5, f: 320, q: .9, kind: 'brown' });
  }

  function joint(v: number, s: number, jointS: number) {
    if (v < .3) return;
    const kmh = v * 3.6;
    // 先頭が継ぎ目を通過した正確な時刻を逆算し、各車軸の通過時刻を予約
    const t0 = ac.currentTime - Math.max(0, s - jointS) / v;
    const base = .5 * Math.min(1, .3 + kmh / 70);
    for (const a of AXLES) {
      const t = t0 + a.d / v;
      if (t < ac.currentTime - .005 || t > ac.currentTime + 3) continue;
      click(Math.max(ac.currentTime, t), base * a.w * (.85 + .3 * Math.random()), kmh);
    }
  }

  return {
    update, joint,
    setTunnel(inside) { tunnelEvt = inside; },
    silence() {
      const now = ac.currentTime;
      for (const g of [rollG, railG, windG, hollowG, sqG]) g.gain.setTargetAtTime(0, now, .1);
      tunnelEvt = false; setTunnelState(false);
    },
  };
}
