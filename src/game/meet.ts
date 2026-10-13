// 単線の交換駅での行き違い（route.meets）。自列車は交換駅の左の線に停車し、対向列車が右の線に着くまで出発信号は停止現示。
// 対向列車はこのモジュールが動かし（st.meet）、world/oncoming.ts が描く。対向列車は交換駅の先（自列車の進む側）の単線から来て、
// 自列車の停車の約 ARRIVE_GAP 秒後に着く。交換駅以外では単線上で自列車と出会わない（交換駅より先から出現し、自列車が発車してから後方へ去る）
import type { GameContext } from '../core/context';
import { carLenOf, islandZone } from '../route/service';
import type { MeetSpec, Route } from '../route/types';

/** 自列車が止まってから対向列車が着くまで [s] */
export const ARRIVE_GAP = 18;
/** 対向列車の到着から自列車の定刻発車までの余裕 [s]（出発信号の進行 → 戸閉め → 発車） */
const READY = 12;
/** 出現位置（停止位置の何 m 先か）の上限 */
const BACK = 900;
const DECEL = .7, ACCEL = .6;
/** 停止位置: ホームの手前端（対向列車から見て先端）から [m] */
const HEAD_MARGIN = 4;
/** 自列車が発車してから対向列車が動き出すまで [s]・戸閉め [s] */
const AFTER_PLAYER = 4, CLOSE_T = 4;

export interface MeetState {
  /** 交換駅 index・route.meets の index */
  station: number; spec: number;
  head: number; v: number; len: number; headS: number;
  stage: 'cruise' | 'brake' | 'stopped' | 'closing' | 'accel' | 'gone';
  /** 交換駅の右の線に停車した（出発信号を開けてよい） */
  arrived: boolean;
  tStage: number;
}

/** 交換駅での自列車の停車時間 [s]（時刻表用） */
export const meetDwell = (): number => ARRIVE_GAP + READY;

/** 対向列車の運動の諸元 */
export function planMeet(route: Route, m: MeetSpec) {
  const sta = route.stations[m.station];
  const v = m.kmh / 3.6, dB = v * v / (2 * DECEL), tBrake = v / DECEL;
  const len = m.cars * carLenOf(m.kind);
  const headS = sta.platform.from + HEAD_MARGIN;
  /** 出現位置から停止までの時間 */
  const tArrive = (BACK - dB) / v + tBrake;
  return { v, dB, tBrake, len, headS, tArrive };
}

export interface Meet {
  /** 交換駅に着いた。行き違いの案内文を返す（quiet なら案内を出さない。始発駅の発車待ち案内にまとめる用） */
  onArrive(index: number, quiet?: boolean): string | null;
  update(dt: number): void;
  /** 停止現示に抑える出発信号（route.signals の index）。無ければ -1 */
  heldSignal(): number;
  /** 単線上（交換駅の右の線に入り切る前）の対向列車 [最大 s, 長さ]。閉そくの占有に使う */
  occupying(): [number, number] | null;
}

export function createMeet(ctx: GameContext): Meet {
  const { route, events } = ctx, st = ctx.state;
  const sigs = route.signals ?? [];
  const banner = (text: string, sec = 3) => events.emit('banner', { text, sec });
  const specAt = (k: number) => route.meets?.findIndex(m => m.station === k) ?? -1;

  /** arriveIn 秒後に停止するよう出現させる */
  function spawn(k: number, arriveIn: number): void {
    const i = specAt(k);
    if (i < 0) return;
    const p = planMeet(route, route.meets![i]);
    let head: number, stage: MeetState['stage'] = 'cruise', v = p.v;
    if (arriveIn >= p.tArrive) head = p.headS + BACK;
    else if (arriveIn > p.tBrake) head = p.headS + p.dB + (arriveIn - p.tBrake) * p.v;
    else { stage = 'brake'; v = DECEL * arriveIn; head = p.headS + v * arriveIn / 2; }
    st.meet = { station: k, spec: i, head, v, len: p.len, headS: p.headS, stage, arrived: false, tStage: 0 };
  }

  /** 自列車が停車駅（st.target）に止まるまでの見込み時間 [s]。先の制限速度・停止までの減速を見て 10m ごとに積算 */
  function playerEta(): number {
    const sta = route.stations[st.target], rem = sta.stopS - st.train.s;
    let t = 2, v = st.train.v;
    for (let d = 0; d < rem; d += 10) {
      const vl = Math.min(ctx.track.limitAt(st.train.s + d) / 3.6, Math.sqrt(2 * .5 * Math.max(1, rem - d)));
      v = Math.min(vl, Math.sqrt(v * v + 2 * .4 * 10));
      t += 10 / Math.max(2, v);
    }
    return t;
  }

  /** 交換駅へ向かう間: 自列車の停止の約 ARRIVE_GAP 秒後に着くよう、頃合いで出現させる */
  function approach(): void {
    if (st.state !== 'run' || st.target < 0 || st.meet?.station === st.target) return;
    const i = specAt(st.target);
    if (i < 0) return;
    const sta = route.stations[st.target], p = planMeet(route, route.meets![i]);
    if (sta.stopS - st.train.s > 2500) return;
    const eta = playerEta();
    if (eta + ARRIVE_GAP <= p.tArrive) spawn(st.target, eta + ARRIVE_GAP);
  }

  return {
    onArrive(index, quiet) {
      if (specAt(index) < 0) return null;
      if (!st.meet || st.meet.station !== index) spawn(index, ARRIVE_GAP);
      if (st.meet?.arrived) return null;
      const text = `${route.stations[index].name}で対向列車と行き違い。出発信号が進行になるまで待て`;
      if (!quiet) banner(text, 4);
      return text;
    },
    update(dt) {
      approach();
      const m = st.meet;
      if (!m || m.stage === 'gone') return;
      const spec = route.meets![m.spec], vmax = spec.kmh / 3.6;
      m.tStage += dt;
      switch (m.stage) {
        case 'cruise': {
          // 自列車がまだ交換駅へ向かっている間は、自列車の停止の約 ARRIVE_GAP 秒後に着くよう速度を合わせる（先に着かない）
          let vt = vmax;
          if (st.state === 'run' && st.target === m.station) {
            const T = playerEta() + ARRIVE_GAP, tB = vmax / DECEL, dist = m.head - m.headS - vmax * vmax / (2 * DECEL);
            if (T > tB + 1 && dist > 0) vt = Math.max(3, Math.min(vmax, dist / (T - tB)));
          }
          m.v = vt > m.v ? Math.min(vt, m.v + ACCEL * dt) : Math.max(vt, m.v - DECEL * dt);
          if (m.head - m.headS <= m.v * m.v / (2 * DECEL)) { m.stage = 'brake'; m.tStage = 0; }
          break;
        }
        case 'brake': {
          const d = Math.max(0, m.head - m.headS);
          m.v = Math.min(m.v, Math.sqrt(2 * DECEL * d));
          if (d < .05 || m.v < .05) {
            m.head = m.headS; m.v = 0; m.stage = 'stopped'; m.tStage = 0; m.arrived = true;
            const sta = route.stations[m.station];
            if (st.target === m.station) banner(`対向列車 到着。${sta.name} 出発信号を確認`, 3);
          }
          break;
        }
        case 'stopped': {
          // 自列車が交換駅を発車して少し進んでから戸閉め
          const sta = route.stations[m.station];
          const gone = st.train.s > sta.stopS + 10 || (st.target !== m.station && st.train.s > sta.platform.to);
          if (gone && m.tStage > AFTER_PLAYER) { m.stage = 'closing'; m.tStage = 0; }
          break;
        }
        case 'closing':
          if (m.tStage >= CLOSE_T) { m.stage = 'accel'; m.tStage = 0; }
          break;
        case 'accel':
          m.v = Math.min(vmax, m.v + ACCEL * dt);
          break;
      }
      m.head -= m.v * dt;
      if (m.stage === 'accel' && (m.head + m.len < route.extent.from || m.head + m.len < st.train.s - 2500)) m.stage = 'gone';
    },
    heldSignal() {
      const k = st.target;
      if (k < 0 || specAt(k) < 0) return -1;
      if (st.meet?.station === k && st.meet.arrived) return -1;
      const stopS = route.stations[k].stopS;
      return sigs.findIndex(g => g.s > stopS);
    },
    occupying() {
      const m = st.meet;
      if (!m || m.arrived || m.stage === 'gone') return null;
      const z = islandZone(route.stations[m.station]);
      // 右の線（交換駅の構内）に入り切ったら単線の閉そくは空く
      if (z && m.head + m.len < z.outFrom) return null;
      return [m.head + m.len, m.len];
    },
  };
}
