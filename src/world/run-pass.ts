// 複々線の走行中の追い越し（ServiceSpec.runPasses、時間帯のパターン）。描画のみで、信号・時刻には関わらない。
//   自列車が普通: from 駅を出たあと（from = to なら to 駅に止まっている間に）、隣の急行線を後続の優等列車が追い抜いていく
//   自列車が優等（同じ格）: from 駅に止まっている普通が自列車の手前で発車し、隣の緩行線で追い抜かれる（from = to なら to 駅に止まっている）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { classOf, destOf, islandOffset, profileLat, serviceOf } from '../route/service';
import type { LatProfile, RunPass, ServiceSpec } from '../route/types';
import { placeCar } from './emu';
import { bogieOffset, createTrainSet, type TrainCar } from './train-models';

interface Actor { pass: RunPass; svc: ServiceSpec; group: THREE.Group; cars: TrainCar[]; len: number; head: number; v: number; mode: 'passer' | 'local'; stage: 'wait' | 'run' | 'stop' }

/** 優等列車の速度 [km/h]（追い抜く側）・普通の巡航速度 */
const PASS_KMH = 95, LOCAL_KMH = 75, ACC = .8, DEC = .8;

export function createRunPasses(ctx: GameContext): void {
  const { route, events, track, scene } = ctx, st = ctx.state;
  if (route.singleTrack || !route.services?.some(v => v.runPassesByTime)) return;
  const local = serviceOf(route, 'local')!;
  const laneOf = (svc: ServiceSpec) => (s: number) => svc.lane ? profileLat(svc.lane as LatProfile, s) : islandOffset(route, route.tracks[0], s);
  let actors: Actor[] = [];
  const done = new Set<string>();
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const make = (pass: RunPass, svc: ServiceSpec, mode: Actor['mode'], head: number, v: number, stage: Actor['stage']): Actor => {
    const cars = createTrainSet(svc.kind, svc.cars, ctx.renderer, { dest: destOf(route, svc), label: svc.name, units: svc.units, unitKinds: svc.unitKinds });
    const group = new THREE.Group(); group.name = 'overtake-runpass';
    for (const c of cars) group.add(c.object);
    scene.add(group);
    return { pass, svc, group, cars, len: cars.reduce((a, c) => a + c.length, 0), head, v, mode, stage };
  };
  // 車両の形状・材質は車種で共有されているので破棄しない（場面から外すだけ）
  const drop = (a: Actor) => { scene.remove(a.group); };
  const clear = () => { for (const a of actors) drop(a); actors = []; done.clear(); };
  events.on('reset', clear);

  events.on('frame', ({ dt }) => {
    const playing = st.state === 'run' || st.state === 'dwell';
    if (!playing) return;
    if (st.paused) return;
    const me = serviceOf(route, st.sel.service);
    if (!me) return;
    const ps = st.train.s;
    // 出現
    for (const p of local.runPasses ?? []) {
      const key = `${p.from}-${p.to}-${p.passedBy}`;
      if (done.has(key)) continue;
      const to = route.stations[p.to], from = route.stations[p.from];
      if (me.id === 'local') {
        if (st.target !== p.to && !(st.state === 'dwell' && p.from === p.to)) continue;
        const passer = serviceOf(route, p.passedBy);
        if (!passer) { done.add(key); continue; }
        if (p.from < p.to && ps > from.stopS + 20) { actors.push(make(p, passer, 'passer', ps - 380, PASS_KMH / 3.6, 'run')); done.add(key); }
        else if (p.from === p.to && ps > to.stopS - 450) { actors.push(make(p, passer, 'passer', ps - 650, 80 / 3.6, 'run')); done.add(key); }
      } else if (classOf(me.id) === classOf(p.passedBy)) {
        // 普通は from 駅（from = to なら to 駅）に止まっていて、自列車が近づくと（from = to なら止まったまま）
        if (ps > from.stopS - 1400 && ps < from.stopS - 300) { actors.push(make(p, local, 'local', from.stopS, 0, 'wait')); done.add(key); }
      }
    }
    // 動き
    for (const a of actors) {
      if (a.mode === 'passer') a.head += a.v * dt;
      else {
        const to = route.stations[a.pass.to];
        if (a.stage === 'wait' && a.pass.from !== a.pass.to && ps > route.stations[a.pass.from].stopS - 380) a.stage = 'run';
        if (a.stage === 'run') {
          const rem = to.stopS - a.head;
          a.v = rem <= a.v * a.v / (2 * DEC) ? Math.sqrt(2 * DEC * Math.max(0, rem)) : Math.min(LOCAL_KMH / 3.6, a.v + ACC * dt);
          a.head += a.v * dt;
          if (rem < .3) { a.stage = 'stop'; a.v = 0; }
        }
      }
      const lat = laneOf(a.svc);
      let sc = a.head;
      for (const c of a.cars) {
        sc -= c.length / 2;
        const bg = bogieOffset(c.length);
        pa.copy(track.at(sc + bg, lat(sc + bg), .38)); pb.copy(track.at(sc - bg, lat(sc - bg), .38));
        placeCar(c.object, pa, pb);
        sc -= c.length / 2;
        // 止まっている普通はホーム側（左右は駅の普通の側）のドアを開ける
        const si = a.stage === 'wait' ? a.pass.from : a.pass.to;
        c.setDoors(a.mode === 'local' && a.stage !== 'run', local.platformSides?.[si] ?? route.stations[si].platform.side);
      }
    }
    // 片付け（自列車から十分に離れたら）
    actors = actors.filter(a => {
      const far = a.mode === 'passer' ? a.head - a.len > ps + 1500 : a.head < ps - 900;
      if (far) drop(a);
      return !far;
    });
  });
}
