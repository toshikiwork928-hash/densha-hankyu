// 走行記録（約10Hz）と結果後のリプレイ再生。再生中は state.train を記録値で上書きする
import type { GameContext } from '../core/context';
import type { CameraMode } from '../core/events';

export interface ReplaySample { t: number; s: number; v: number; notch: number }

export interface Replay {
  /** 再生開始。記録が無ければ false */
  start(): boolean;
  stop(): void;
  readonly active: boolean;
  /** 再生位置の進行（frame ごと）。戻り値 = 再生中の game 時刻 */
  update(dt: number): number | null;
  /** 再生速度（表示用） */
  readonly speed: number;
}

const INTERVAL = 0.1;

export function createReplay(ctx: GameContext, setCamera: (m: CameraMode) => void): Replay {
  const { events, route } = ctx, st = ctx.state;
  let rec: ReplaySample[] = [];
  let lastT = -1;
  let active = false, head = 0, idx = 0, speed = 1;
  let saved: typeof st.train | null = null, savedT = 0;

  const push = () => { rec.push({ t: st.t, s: st.train.s, v: st.train.v, notch: st.train.notch }); lastT = st.t; };
  events.on('start', () => { rec = []; lastT = -1; });
  events.on('tick', () => { if (lastT < 0 || st.t - lastT >= INTERVAL) push(); });
  events.on('arrive', push);
  events.on('result', push);

  // 駅・踏切付近は等速、それ以外は早送り
  const focusAt = (s: number, v: number) =>
    v < 8 || route.stations.some(x => Math.abs(x.stopS - s) < 450) || (route.crossings ?? []).some(c => Math.abs(c.s - s) < 150);

  function stop() {
    if (!active) return;
    active = false;
    if (saved) { Object.assign(st.train, saved); st.t = savedT; }
    setCamera('cab');
  }

  return {
    get active() { return active; },
    get speed() { return speed; },
    start() {
      if (active || rec.length < 2) return false;
      saved = { ...st.train }; savedT = st.t;
      active = true; head = rec[0].t; idx = 0;
      setCamera('replay');
      return true;
    },
    stop,
    update(dt) {
      if (!active) return null;
      const cur = rec[idx];
      speed = focusAt(cur.s, cur.v) ? 1 : 3;
      head += dt * speed;
      while (idx < rec.length - 2 && rec[idx + 1].t <= head) idx++;
      const a = rec[idx], b = rec[idx + 1];
      if (head >= rec[rec.length - 1].t) { stop(); return null; }
      const u = Math.max(0, Math.min(1, (head - a.t) / Math.max(1e-6, b.t - a.t)));
      st.train.s = a.s + (b.s - a.s) * u;
      st.train.v = a.v + (b.v - a.v) * u;
      st.train.notch = u < .5 ? a.notch : b.notch;
      st.t = head;
      return head;
    },
  };
}
