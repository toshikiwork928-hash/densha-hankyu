// 自列車の外観（運転台視点以外で表示）。運行種別ごとに車種・両数を組み替え、2面4線駅では待避線の経路に沿う
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { onLight } from './batch';
import { placeCar } from './emu';
import { destOf, kindsKey } from '../route/service';
import { bogieOffset, carLenOf, createTrainSet, setTrainNight, type TrainCar } from './train-models';

export { formation } from './train-models';

export interface PlayerTrain {
  readonly group: THREE.Group;
  /** 編成両数 */
  readonly cars: number;
}

export function createPlayerTrain(ctx: GameContext): PlayerTrain {
  const { scene, track, route } = ctx;
  const group = new THREE.Group(); group.name = 'playerTrain'; scene.add(group);
  let cars: TrainCar[] = [];
  let built = '';

  /** 種別に合わせて編成を作り直す（車種・両数・種別表示） */
  function build() {
    const svc = ctx.service;
    const kind = svc?.kind ?? 'commuter-new', units = svc?.units;
    const n = svc?.cars ?? Math.max(2, Math.round(route.trainLength / carLenOf(kind)));
    const key = `${svc ? kindsKey(svc) : kind}:${units?.join('+') ?? n}:${svc?.name ?? ''}:${destOf(route, svc)}`;
    if (key === built) return;
    built = key;
    for (const c of cars) group.remove(c.object);
    cars = createTrainSet(kind, n, ctx.renderer, { dest: destOf(route, svc), label: svc?.name, units, unitKinds: svc?.unitKinds });
    for (const c of cars) group.add(c.object);
  }
  build();
  ctx.events.on('serviceChange', build);
  ctx.events.on('reset', build);

  // 線路を照らす前照灯の光源は環境担当（env/night-lights.ts）。ここは灯具の発光・窓明かりのみ
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));

  const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  ctx.events.on('frame', () => {
    const s = ctx.state.train.s;
    group.visible = ctx.cameraMode !== 'cab';
    if (!group.visible) return;
    let sc = s;
    const open = ctx.state.doors === 'open';
    // ホーム側（進行方向に対して）だけ開ける。待避線に入ると右側
    const side = route.stations[ctx.state.target]?.platform.side;
    for (const c of cars) {
      c.setDoors(open, side);
      sc -= c.length / 2;
      const bogie = bogieOffset(c.length), a = sc + bogie, b = sc - bogie;
      p1.copy(track.pathAt(a, 0, .38)); p2.copy(track.pathAt(b, 0, .38));
      placeCar(c.object, p1, p2);
      sc -= c.length / 2;
    }
  });
  return { group, get cars() { return cars.length; } };
}
