// 警報・合図: ATS ベル/ブザー・速度超過ブザー・警笛（空気笛 2音）・踏切警報・マスコン操作音
import { bell, type AudioCore } from './engine';

export interface Alarms {
  click(notch: number): void;
  beep(): void;
  atsBell(on: boolean): void;
  atsBuzzer(on: boolean): void;
  /** 警笛を鳴らし始める。戻り値の関数で止める */
  hornStart(opt?: { far?: number; pitch?: number }): () => void;
  horn(dur: number, opt?: { far?: number; pitch?: number }): void;
  /** 踏切: id ごとの鳴動・距離[m]・自列車速度[m/s] */
  crossing(id: string, active: boolean, distance: number, v: number): void;
  update(dt: number): void;
  silence(): void;
}

/** ATS ベルの1秒ループ（約 16 打/s の電鈴）を事前生成 */
function makeBellLoop(ac: BaseAudioContext): AudioBuffer {
  const sr = ac.sampleRate, n = sr, buf = ac.createBuffer(1, n, sr), d = buf.getChannelData(0);
  const parts = [[2380, 1], [3010, .6], [5150, .3], [6620, .15]];
  const hits = 16;
  for (let i = 0; i < n; i++) {
    const t = i / sr, tk = (t * hits) % 1 / hits; // 直近の打撃からの時間
    let x = 0;
    for (const [f, a] of parts) x += a * Math.sin(2 * Math.PI * f * t);
    // 打撃ごとに減衰＋余韻の持続
    d[i] = x * (.35 * Math.exp(-tk * 60) + .12) * .5;
  }
  return buf;
}

export function createAlarms(core: AudioCore): Alarms {
  const { ac } = core;
  const dest = core.sfx;
  const bellBuf = makeBellLoop(ac);
  let bellSrc: AudioBufferSourceNode | null = null, bellG: GainNode | null = null;
  let buzz: { o: OscillatorNode; g: GainNode } | null = null;

  // 踏切: id ごとの状態
  const xings = new Map<string, { active: boolean; distance: number; v: number; next: number; seen: number; alt: number }>();
  let clock = 0;

  function hornStart(opt: { far?: number; pitch?: number } = {}): () => void {
    const far = opt.far ?? 0, pitch = opt.pitch ?? 1, t0 = ac.currentTime;
    const g = ac.createGain();
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200 - far * 2200;
    const form = ac.createBiquadFilter(); form.type = 'peaking'; form.frequency.value = 1100; form.gain.value = 7; form.Q.value = 1.4;
    g.connect(form).connect(lp).connect(dest);
    const vol = .1 * (1 - far * .75);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .07);
    // 空気笛 2音（短3度ほど離れた和音）。立ち上がりで少し上ずる
    const oscs: OscillatorNode[] = [];
    for (const f of [311, 370]) {
      for (const [type, a, det] of [['sawtooth', .55, 0], ['square', .25, 4]] as [OscillatorType, number, number][]) {
        const o = ac.createOscillator(), og = ac.createGain();
        o.type = type; o.detune.value = det;
        o.frequency.setValueAtTime(f * pitch * .96, t0); o.frequency.exponentialRampToValueAtTime(f * pitch, t0 + .12);
        og.gain.value = a; o.connect(og).connect(g); o.start(t0); oscs.push(o);
      }
    }
    // 空気のかすれ
    const air = core.noiseSrc('white'); const abp = ac.createBiquadFilter(); abp.type = 'bandpass'; abp.frequency.value = 1500; abp.Q.value = 1;
    const ag = ac.createGain(); ag.gain.value = .12; air.connect(abp).connect(ag).connect(g);
    let stopped = false;
    return () => {
      if (stopped) return; stopped = true;
      const t = Math.max(ac.currentTime, t0 + .3);
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + .18);
      for (const o of oscs) { o.frequency.setTargetAtTime(o.frequency.value * .97, t, .1); o.stop(t + .25); }
      air.stop(t + .25);
    };
  }

  function stopBell() {
    if (bellSrc && bellG) { const t = ac.currentTime; bellG.gain.setTargetAtTime(0, t, .03); bellSrc.stop(t + .2); }
    bellSrc = null; bellG = null;
  }
  function stopBuzz() {
    if (buzz) { const t = ac.currentTime; buzz.g.gain.setTargetAtTime(0, t, .02); buzz.o.stop(t + .15); }
    buzz = null;
  }

  return {
    click(n) {
      // マスコンのノッチ（カチッ）: 力行側とブレーキ側でわずかに音色を変える
      core.burst(dest, { dur: .025, vol: .09, f: n >= 0 ? 2600 : 2100, q: 3 });
      core.burst(dest, { dur: .05, vol: .05, f: 600, q: 2 });
    },
    beep() {
      core.tone(dest, 1050, .16, .07, 0, 'square');
    },
    atsBell(on) {
      if (!on) { stopBell(); return; }
      if (bellSrc) return;
      bellSrc = ac.createBufferSource(); bellSrc.buffer = bellBuf; bellSrc.loop = true;
      bellG = ac.createGain(); bellG.gain.value = .5;
      bellSrc.connect(bellG).connect(dest); bellSrc.start();
    },
    atsBuzzer(on) {
      if (!on) { stopBuzz(); return; }
      if (buzz) return;
      const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = 330;
      const g = ac.createGain(); g.gain.value = .045;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      o.connect(lp).connect(g).connect(dest); o.start();
      buzz = { o, g };
    },
    hornStart,
    horn(dur, opt) { const stop = hornStart(opt); setTimeout(stop, dur * 1000); },
    crossing(id, active, distance, v) {
      const x = xings.get(id);
      if (x) { x.active = active; x.distance = distance; x.v = v; x.seen = clock; }
      else xings.set(id, { active, distance, v, next: 0, seen: clock, alt: 0 });
    },
    update(dt) {
      clock += dt;
      for (const [id, x] of xings) {
        if (clock - x.seen > 2) { xings.delete(id); continue; } // 更新が途絶えたら終了
        if (!x.active) continue;
        x.next -= dt;
        if (x.next > 0) continue;
        x.next += .42; if (x.next < 0) x.next = .42;
        // 距離減衰（後方はさらに小さく）＋ドップラー（接近で高く、通過後低く）
        const d = Math.abs(x.distance);
        const vol = .16 / (1 + Math.pow(d / 45, 1.6)) * (x.distance < 0 ? .7 : 1);
        if (vol < .002) continue;
        const dop = 343 / (343 - Math.sign(x.distance) * Math.min(x.v, 40));
        // 左右 2 基の警報機を交互に（約 700 / 900Hz）
        const f = (x.alt++ % 2 ? 900 : 700) * dop;
        bell(core, dest, f, ac.currentTime, vol, .5, [[1, 1, 1], [2.02, .4, .5], [3.1, .2, .35]]);
      }
    },
    silence() { stopBell(); stopBuzz(); xings.clear(); },
  };
}
