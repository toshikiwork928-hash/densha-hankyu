// 先行列車（見えない仮想列車）と閉そく信号の現示計算。純関数のみ（テスト・調整用に DOM 非依存）
import type { SignalAspect } from '../core/events';
import type { Route, ServiceId, ServiceSpec } from '../route/types';
import { profileLat, sameClass } from '../route/service';

/** 先行列車の自列車に対する時隔 [s]（種別あり路線は HEADWAY_BY が優先） */
const HEADWAY = 240;
/** 先行（各駅停車）が通過駅に停車する時間 [s]。ここで詰まって Y/YG が出る（種別なし路線用） */
const LOCAL_STOP = 75;
/** 先行（各駅停車）の停車駅での追加停車 [s] */
const EXTRA_DWELL = 15;
/** 先行列車の編成長 [m]（普通 4両） */
const PREC_LEN = 80;
/** 最後の信号の閉そく長 [m]（終端側の閉そくを有限にする） */
const LAST_BLOCK = 500;
/** 種別ごとの先行普通との時隔 [s] と停車駅ごとの追加停車 [s]（普通の後ろを走る急行・特急は途中で追いつく） */
const HEADWAY_BY: Record<ServiceId, { h: number; extra: number }> = {
  local: { h: 300, extra: 8 },
  express: { h: 200, extra: 6 },
  airport: { h: 200, extra: 6 },
  limited: { h: 240, extra: 6 },
  southern: { h: 240, extra: 6 },
};

interface Key { t: number; s: number }

/** 先行列車の計画。depT = 駅 index → その駅の発車キーの時刻（待避線での抑止に使う） */
export interface PrecedingPlan { keys: Key[]; depT: Record<number, number>; arrT: Record<number, number> }

/** 先行列車の走行計画 (t, s) キー。区間内は smoothstep で加減速を近似。種別あり路線では先行は普通 */
export function buildPrecedingKeys(route: Route, service?: ServiceId): PrecedingPlan {
  const keys: Key[] = [], depT: Record<number, number> = {}, arrT: Record<number, number> = {};
  const local = route.services?.find(x => x.id === 'local');
  if (local) {
    const { h: h0, extra: ex } = HEADWAY_BY[service ?? 'express'];
    // 普通どうし: 待避で長く停まる駅があると、先行の普通が出てすぐ後続が着くので、長い停車の分だけ時隔を広げる
    const longDwell = service === 'local' ? Math.max(0, ...Object.values(local.timetable).map(x => (x.dep ?? x.arr) - x.arr - 25)) : 0;
    const h = (route.precedingHeadway?.[service ?? 'express'] ?? h0) + longDwell;
    let extra = 0;
    route.stations.forEach((sta, i) => {
      if (!local.stops.includes(i)) return;
      const tt = local.timetable[i] ?? { arr: sta.scheduledArrival };
      if (i === 0) { keys.push({ t: -1e6, s: sta.stopS }, { t: -h, s: sta.stopS }); depT[i] = -h; return; }
      const arr = tt.arr - h + extra;
      extra += ex;
      const dep = (tt.dep ?? tt.arr + 20) - h + extra;
      keys.push({ t: arr, s: sta.stopS }, { t: dep, s: sta.stopS });
      arrT[i] = arr; depT[i] = dep;
    });
  } else {
    let extra = 0;
    route.stations.forEach((sta, i) => {
      const arr = sta.scheduledArrival - HEADWAY + extra;
      if (i === 0) { keys.push({ t: -1e6, s: sta.stopS }, { t: -HEADWAY, s: sta.stopS }); return; }
      keys.push({ t: arr, s: sta.stopS });
      const dw = sta.pass ? LOCAL_STOP : (sta.dwell ?? 20) + EXTRA_DWELL;
      extra += sta.pass ? LOCAL_STOP : EXTRA_DWELL; // 停車分 + 加減速の損失
      keys.push({ t: arr + dw, s: sta.stopS });
      arrT[i] = arr; depT[i] = arr + dw;
    });
  }
  // 自列車に抜かれる普通は、対象駅の通過予定時刻より60秒前までに到着させる。
  // 反対種別の待避で普通の時刻が伸びても、目の前の本線上で競合させない。
  const player = route.services?.find(x => x.id === service);
  const waits = local?.waits?.filter(w => !!service && sameClass(w.passedBy, service) && w.station > 0 && w.station < route.stations.length - 1) ?? [];
  // 待避駅より手前で自列車も停車する駅（普通と同じ本線に停車）では、普通の発車を自列車の到着より80秒以上前にして、目の前で詰まらせない。
  // 待避駅が無い（終着まで先着する）ときは全線で、自列車が着く・通過する80秒前までに普通を発車させておく（途中で追いつかない）
  const lastWait = waits.length ? Math.max(...waits.map(w => w.station)) : route.stations.length;
  const nLast = route.stations.length - 1;
  const clearAdvance = Math.max(0, ...Object.keys(player?.timetable ?? {}).map(Number).filter(i => i > 0 && i < lastWait && local?.stops.includes(i) && (depT[i] ?? arrT[i]) != null && player?.timetable[i])
    // 終着駅は着いた時刻（そこで本線から外れる）、途中駅は発車時刻
    .map(i => (i === nLast ? arrT[i] + 30 : depT[i]) - (player!.timetable[i].arr - 80)));
  const advance = Math.max(clearAdvance, ...waits.map(w => (arrT[w.station] ?? 0) - (player?.timetable[w.station]?.arr ?? 0) + 60), 0);
  if (advance > 0) {
    for (const key of keys) if (key.t > -1e5) key.t -= advance;
    for (const i of Object.keys(arrT)) arrT[Number(i)] -= advance;
    for (const i of Object.keys(depT)) depT[Number(i)] -= advance;
  }
  // 終着後は先へ抜けて消える。終着駅の待避線に入る普通（南海本線）はそのまま待避線に留まる（本線の閉そくを占有しない）
  const last = keys[keys.length - 1];
  const lastSta = route.stations[route.stations.length - 1];
  // 終着駅で自列車と別の番線（普通の進路 lane が分かれる）に入る普通は、着いたら本線の閉そくから外す
  const ownLane = (v?: ServiceSpec) => v?.lane ? profileLat(v.lane, lastSta.stopS) : 0;
  const apart = !!lastSta && !!local && !!player && (Math.abs(ownLane(local) - ownLane(player)) > 1 || !!player.precedingLocalApart);
  if (local?.useLoop && lastSta?.loop && !lastSta.loopPriority) keys.push({ t: 1e6, s: last.s });
  else if (apart) keys.push({ t: last.t + 1, s: last.s + 1e5 }, { t: 1e6, s: last.s + 1e5 });
  else keys.push({ t: last.t + 140, s: last.s + 2500 }, { t: 1e6, s: last.s + 2500 });
  return { keys, depT, arrT };
}

/** 時刻 t の先行列車先頭位置 */
export function precedingHead(keys: Key[], t: number): number {
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t < b.t) {
      if (b.s === a.s) return a.s;
      const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
      return a.s + (b.s - a.s) * u * u * (3 - 2 * u);
    }
  }
  return keys[keys.length - 1].s;
}

/** 列車（先頭 head, 長さ len）が閉そく j を占有しているか */
function occupies(sigS: number[], j: number, head: number, len: number): boolean {
  const from = sigS[j], to = j + 1 < sigS.length ? sigS[j + 1] : sigS[j] + LAST_BLOCK;
  return head >= from && head - len < to;
}

/** 信号 i の現示。trains = 占有判定する列車 [head, len][] */
export function aspectOf(sigS: number[], i: number, trains: [number, number][]): SignalAspect {
  for (let k = 0; k < 3; k++) {
    const j = i + k;
    if (j >= sigS.length) break;
    if (trains.some(([h, l]) => occupies(sigS, j, h, l))) return k === 0 ? 'R' : k === 1 ? 'Y' : 'YG';
  }
  return 'G';
}

export const PRECEDING_LENGTH = PREC_LEN;

/** 現示ごとの速度制限 [km/h]（R は 0 = 停止） */
export const ASPECT_LIMIT: Record<SignalAspect, number> = { R: 0, Y: 45, YG: 65, G: Infinity };
export const ASPECT_LABEL: Record<SignalAspect, string> = { R: '停止', Y: '注意', YG: '減速', G: '進行' };
