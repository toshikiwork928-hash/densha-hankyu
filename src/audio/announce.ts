// 車内放送: Web Speech API（ja-JP）。非対応・音声なしの環境では何もしない
// 声は端末（ブラウザ・OS）に入っている日本語音声に任せる。音程の加工はしない
export interface Announcer {
  say(text: string, delaySec?: number): void;
  cancel(): void;
  setVolume(v: number): void;
  /** 一時停止: 予約中の放送の残り時間を保持し、読み上げ中の放送は止める（再開時にその文を最初から読み直す） */
  pause(): void;
  resume(): void;
}

interface Pending { id: number; at: number; text: string; left: number }

export function createAnnouncer(): Announcer {
  const synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voice: SpeechSynthesisVoice | null = null, volume = 1, paused = false;
  const timers: Pending[] = [];
  /** 読み上げ中・読み上げ待ちの文（終わったら外す） */
  const speaking: string[] = [];

  const pickVoice = () => {
    if (!synth) return;
    const list = synth.getVoices().filter(v => v.lang.replace('_', '-').toLowerCase().startsWith('ja'));
    // 女性・自然な声を優先（名前ヒューリスティック）。無ければ先頭の日本語音声
    voice = list.find(v => /nanami|kyoko|haruka|ayumi|female|女性/i.test(v.name)) ?? list[0] ?? null;
  };
  if (synth) {
    try { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); } catch { /* 古いブラウザ */ }
  }

  function speak(text: string) {
    if (!synth || volume <= 0) return;
    try {
      if (!voice) pickVoice();
      // 表示は「ラピートβ」、読み上げは「ラピートベータ」
      const u = new SpeechSynthesisUtterance(text.replace(/β/g, 'ベータ'));
      u.lang = 'ja-JP'; if (voice) u.voice = voice;
      u.rate = 1.0; u.pitch = 1.0; u.volume = Math.max(0, Math.min(1, volume));
      const done = () => { if (paused) return; const i = speaking.indexOf(text); if (i >= 0) speaking.splice(i, 1); };
      u.onend = done; u.onerror = done;
      speaking.push(text);
      synth.speak(u);
    } catch { /* 無視 */ }
  }
  function schedule(text: string, delaySec: number) {
    const p: Pending = { id: 0, at: performance.now() + delaySec * 1000, text, left: delaySec * 1000 };
    p.id = window.setTimeout(() => { const i = timers.indexOf(p); if (i >= 0) timers.splice(i, 1); speak(text); }, delaySec * 1000);
    timers.push(p);
  }

  return {
    say(text, delaySec = 0) {
      if (!synth || volume <= 0) return;
      if (paused) { timers.push({ id: 0, at: 0, text, left: delaySec * 1000 }); return; }
      schedule(text, delaySec);
    },
    cancel() {
      while (timers.length) clearTimeout(timers.pop()!.id);
      speaking.length = 0;
      try { synth?.cancel(); } catch { /* 無視 */ }
    },
    setVolume(v) { volume = v; if (v <= 0) this.cancel(); },
    pause() {
      if (paused) return;
      paused = true;
      const now = performance.now();
      for (const p of timers) { clearTimeout(p.id); p.left = Math.max(0, p.at - now); }
      try { if (speaking.length) synth?.cancel(); } catch { /* 無視 */ }
    },
    resume() {
      if (!paused) return;
      paused = false;
      const again = speaking.splice(0), list = timers.splice(0);
      for (const t of again) speak(t);
      for (const p of list) schedule(p.text, p.left / 1000);
    },
  };
}
