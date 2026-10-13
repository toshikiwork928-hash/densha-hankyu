// 音響エンジンの土台: バス構成・ノイズバッファ・トンネル残響・小物ユーティリティ
// BaseAudioContext を受け取るので OfflineAudioContext でも同じ音を生成できる

export type NoiseKind = 'white' | 'pink' | 'brown';

export interface AudioCore {
  ac: BaseAudioContext;
  /** 最終段（設定の master × mute）→ リミッタ → 出力 */
  master: GainNode;
  /** 効果音バス（設定の sfx） */
  sfx: GainNode;
  /** 声・車内チャイムバス（設定の voice） */
  voice: GainNode;
  /** 走行系（モーター・転動・継ぎ目など）。トンネルでこもる・残響がかかる */
  run: GainNode;
  /** 走行系の低域ブースト（トンネル・橋梁で上げる） */
  runLowShelf: BiquadFilterNode;
  /** 走行系の高域カット（車内 / 車外視点の切替） */
  runTone: BiquadFilterNode;
  /** トンネル残響へのセンド量 */
  reverbSend: GainNode;
  noise: Record<NoiseKind, AudioBuffer>;
  now(): number;
  /** ループするノイズ源を開始して返す（ランダム位相） */
  noiseSrc(kind: NoiseKind, when?: number, dur?: number): AudioBufferSourceNode;
  /** 単純な sin/三角等の単発トーン（減衰エンベロープ付き） */
  tone(dest: AudioNode, f: number, dur: number, vol: number, when?: number, type?: OscillatorType, attack?: number): void;
  /** 短いノイズバースト（フィルタ付き） */
  burst(dest: AudioNode, opt: { when?: number; dur: number; vol: number; type?: BiquadFilterType; f: number; q?: number; kind?: NoiseKind; attack?: number }): void;
}

/** a-param を now から tau で目標へ（微小値の負を避ける） */
export function glide(p: AudioParam, v: number, now: number, tau = 0.05): void {
  p.setTargetAtTime(v, now, tau);
}

function makeNoise(ac: BaseAudioContext, kind: NoiseKind, sec = 4): AudioBuffer {
  const n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'pink') {
      // Paul Kellet 近似
      b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
      b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
    } else { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
  }
  // ループ継ぎ目のクリック防止にクロスフェード
  const xf = Math.floor(ac.sampleRate * .05);
  for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[n - xf + i] * (1 - a); }
  return buf;
}

/** トンネル用の残響インパルス（減衰ノイズ・低域寄り・左右非相関） */
function makeImpulse(ac: BaseAudioContext, sec = 1.6): AudioBuffer {
  const n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, w = Math.random() * 2 - 1;
      lp += (w - lp) * (0.08 + 0.25 * (1 - t)); // 後半ほど暗く
      // 初期反射（壁面のフラッターエコー）
      const er = i % Math.floor(ac.sampleRate * .021) < 30 && t < .25 ? .6 : 0;
      d[i] = (lp + er * w) * Math.pow(1 - t, 2.2);
    }
  }
  return buf;
}

export function createCore(ac: BaseAudioContext, destination: AudioNode = ac.destination): AudioCore {
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 8;
  limiter.attack.value = .004; limiter.release.value = .2;
  limiter.connect(destination);
  const master = ac.createGain(); master.connect(limiter);
  const sfx = ac.createGain(); sfx.connect(master);
  const voice = ac.createGain(); voice.connect(master);
  const run = ac.createGain();
  const runLowShelf = ac.createBiquadFilter(); runLowShelf.type = 'lowshelf'; runLowShelf.frequency.value = 180; runLowShelf.gain.value = 0;
  const runTone = ac.createBiquadFilter(); runTone.type = 'lowpass'; runTone.frequency.value = 9000; runTone.Q.value = .5;
  run.connect(runLowShelf).connect(runTone).connect(sfx);
  const reverbSend = ac.createGain(); reverbSend.gain.value = 0;
  const conv = ac.createConvolver(); conv.buffer = makeImpulse(ac);
  const revOut = ac.createGain(); revOut.gain.value = .9;
  run.connect(reverbSend).connect(conv).connect(revOut).connect(sfx);

  const noise = { white: makeNoise(ac, 'white'), pink: makeNoise(ac, 'pink'), brown: makeNoise(ac, 'brown') };
  const now = () => ac.currentTime;

  const noiseSrc: AudioCore['noiseSrc'] = (kind, when, dur) => {
    const s = ac.createBufferSource(); s.buffer = noise[kind]; s.loop = true;
    const t0 = when ?? ac.currentTime;
    s.start(t0, Math.random() * 3.5);
    if (dur !== undefined) s.stop(t0 + dur);
    return s;
  };

  const tone: AudioCore['tone'] = (dest, f, dur, vol, when = 0, type = 'sine', attack = .005) => {
    const t0 = Math.max(ac.currentTime, when || ac.currentTime), o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(g).connect(dest); o.start(t0); o.stop(t0 + dur + .05);
  };

  const burst: AudioCore['burst'] = (dest, o) => {
    const t0 = Math.max(ac.currentTime, o.when ?? ac.currentTime);
    const src = noiseSrc(o.kind ?? 'white', t0, o.dur + .05);
    const f = ac.createBiquadFilter(); f.type = o.type ?? 'bandpass'; f.frequency.value = o.f; f.Q.value = o.q ?? 1;
    const g = ac.createGain(); const a = o.attack ?? .002;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(o.vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + o.dur);
    src.connect(f).connect(g).connect(dest);
  };

  return { ac, master, sfx, voice, run, runLowShelf, runTone, reverbSend, noise, now, noiseSrc, tone, burst };
}

/** 加算合成の PeriodicWave（harm[k] = k 倍音の振幅、k=1 始まり） */
export function harmonicWave(ac: BaseAudioContext, harm: Record<number, number>): PeriodicWave {
  const max = Math.max(...Object.keys(harm).map(Number));
  const real = new Float32Array(max + 1), imag = new Float32Array(max + 1);
  for (const [k, a] of Object.entries(harm)) imag[Number(k)] = a;
  return ac.createPeriodicWave(real, imag);
}

/** 鐘・ベル系の単発音（非整数倍音の減衰和） */
export function bell(core: AudioCore, dest: AudioNode, f: number, when: number, vol: number, decay = 1.2,
  partials: [number, number, number][] = [[1, 1, 1], [2, .5, .6], [2.76, .35, .4], [5.4, .15, .2]]): void {
  const { ac } = core, t0 = Math.max(ac.currentTime, when);
  for (const [ratio, amp, dk] of partials) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = f * ratio;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol * amp, t0 + .003);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + decay * dk);
    o.connect(g).connect(dest); o.start(t0); o.stop(t0 + decay * dk + .05);
  }
}
