// 待避の描画: 普通の待避中に本線を通過していく後続列車（st.overtake）と、
// 急行・特急で通過する2面4線駅の待避線に止まっている先行の普通（st.precedingS が待避線にいる間）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { BASE_CARS, carLenOf, customPlatformSide, destOf, islandOffset, loopShape, loopZone, loopZones, profileLat, sameClass, serviceOf, stationIslandOffset, stopOffset } from '../route/service';
import type { ServiceSpec, TrainKind } from '../route/types';
import { placeCar } from './emu';
import { bogieOffset, createTrainSet, type TrainCar } from './train-models';

interface SetView { group: THREE.Group; cars: TrainCar[] }

/** 近さの判定距離 [m]（風切り音） */
const NEAR = 60;

export function createOvertaking(ctx: GameContext): void {
  const { scene, track, route, events } = ctx, st = ctx.state;
  const cache = new Map<string, SetView>();
  const destAll = route.stations[route.stations.length - 1]?.name ?? '';
  const view = (kind: TrainKind, units: number[], label: string, unitKinds?: TrainKind[], dest = destAll, tag = ''): SetView => {
    const key = `${unitKinds?.join('+') ?? kind}:${units.join('+')}:${label}:${dest}${tag}`;
    let v = cache.get(key);
    if (!v) {
      const group = new THREE.Group(); group.name = 'overtake-' + key; group.visible = false; scene.add(group);
      const cars = createTrainSet(kind, units.reduce((a, n) => a + n, 0), ctx.renderer, { dest, label, units, unitKinds });
      for (const c of cars) group.add(c.object);
      v = { group, cars }; cache.set(key, v);
    }
    return v;
  };
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  /** 先頭 head から後ろへ並べる。latAt = 横位置 */
  const place = (v: SetView, head: number, latAt: (s: number) => number) => {
    let sc = head;
    for (const c of v.cars) {
      sc -= c.length / 2;
      const bogie = bogieOffset(c.length);
      pa.copy(track.at(sc + bogie, latAt(sc + bogie), .38)); pb.copy(track.at(sc - bogie, latAt(sc - bogie), .38));
      placeCar(c.object, pa, pb);
      sc -= c.length / 2;
    }
  };
  const zones = loopZones(route);
  /** 本線のホーム側 / 待避線のホーム側（島式: 本線は進行方向左、待避線は右。自列車が待避線に入る駅は platform.side が 'R' に変わる） */
  const mainSide = (i: number): 'L' | 'R' => { const sta = route.stations[i]; return sta.enterLoop ? (sta.platform.side === 'R' ? 'L' : 'R') : sta.platform.side; };
  const flip = (x: 'L' | 'R'): 'L' | 'R' => x === 'L' ? 'R' : 'L';
  let hornDone = false, wasNear = false, lastH = 0, lastStation = -1;

  events.on('reset', () => { hornDone = false; lastStation = -1; });

  // 優等列車で堺・泉大津を終着にするとき: 終着駅の普通の番線（待避線、堺は3番線・1番線）に普通が止まっている（時間帯によらず）
  const goal = route.stations.length - 1, goalSta = route.stations[goal];
  const goalTerminal = goalSta && (goalSta.name === '堺' || goalSta.name === '泉大津');
  function showTerminalLocal(local: ServiceSpec, ps: number): void {
    if (!goalTerminal || st.endIndex !== goal) return;
    const me = serviceOf(route, st.sel.service);
    if (!me || Math.abs(goalSta.stopS - ps) > 1600) return;
    // 普通の停止位置（駅の停止位置は自列車の両数のもの）と走行線
    const head = goalSta.stopS + stopOffset(me.cars, carLenOf(me.kind), route.stopBaseCars ?? BASE_CARS) - stopOffset(local.cars, carLenOf(local.kind), route.stopBaseCars ?? BASE_CARS);
    const z = loopZone(goalSta);
    const latAt = local.lane ? (s: number) => profileLat(local.lane!, s) + stationIslandOffset(route, route.tracks[0], s) + (z ? z.lat * loopShape(z, s) : 0)
      : z ? (s: number) => z.lat * loopShape(z, s) : null;
    if (!latAt) return;
    const lat = latAt(head);
    const side = goalSta.layout === 'custom' ? customPlatformSide(goalSta, lat) ?? 'R' : goalSta.loop?.outside ? (goalSta.loop.lat < 0 ? 'L' : 'R') : 'R';
    const v = view(local.kind, local.units, local.name, local.unitKinds, destOf(route, local), ':goal');
    v.group.visible = true;
    for (const c of v.cars) c.setDoors(true, side);
    place(v, head, latAt);
  }
  events.on('frame', () => {
    for (const v of cache.values()) v.group.visible = false;
    const playing = st.state === 'run' || st.state === 'dwell' || st.state === 'result';
    if (!playing) { if (wasNear) { events.emit('overtakePass', { proximity: 0 }); wasNear = false; } return; }
    const ps = st.train.s, plen = route.trainLength;

    // 後続の通過列車（本線 = 横位置 0）
    const o = st.overtake;
    if (o && o.phase === 'run') {
      if (lastStation !== o.station) { lastStation = o.station; hornDone = false; }
      const svc = serviceOf(route, o.passedBy)!;
      const v = view(svc.kind, svc.units, svc.name, svc.unitKinds, destOf(route, svc));
      v.group.visible = true;
      const connecting = o.stage === 'stopped' && o.localStopped, side = mainSide(o.station);
      for (const c of v.cars) c.setDoors(connecting, side); // 停車して接続中は本線ホーム側のドアを開ける
      place(v, o.head, s => islandOffset(route, 0, s));
      const gap = o.head < ps - plen ? ps - plen - o.head : o.head - o.len > ps ? o.head - o.len - ps : 0;
      if (!hornDone && o.head > ps - plen - 250) { hornDone = true; events.emit('oncomingHorn', { distance: Math.max(0, ps - plen - o.head) }); }
      const prox = Math.max(0, 1 - gap / NEAR);
      if (prox > 0 || wasNear) events.emit('overtakePass', { proximity: prox });
      wasNear = prox > 0;
    } else if (wasNear) { events.emit('overtakePass', { proximity: 0 }); wasNear = false; }

    // 待避線の先行普通（自列車が本線を通る駅のみ。自列車の近くにいるときだけ表示）
    const local = serviceOf(route, 'local');
    if (!local || st.sel.service === 'local') return;
    showTerminalLocal(local, ps);
    const h = st.precedingS, prevH = lastH;
    lastH = h;
    const last = route.stations.length - 1;
    const z = zones.find(q => q.index < last && !route.stations[q.index].enterLoop && local.waits?.some(w => w.station === q.index && sameClass(w.passedBy, st.sel.service)) && h > q.inFrom && h < q.outTo + 400);
    if (!z || Math.abs(h - ps) > 1500) return;
    const v = view(local.kind, local.units, local.name, local.unitKinds, destOf(route, local));
    v.group.visible = true;
    // 待避線に停車している間はドアを開ける（動き出したら閉める）
    const still = Math.abs(h - prevH) < 1e-3;
    const side = flip(mainSide(z.index));
    for (const c of v.cars) c.setDoors(still, side);
    place(v, h, s => z.lat * loopShape(z, s));
  });
}
