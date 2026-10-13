// 羽衣の3番線ホームに停めておく 2000系 2両（高師浜線。描画のみ）。車両生成は DOM を使うので、world/index.ts からだけ呼ぶ（建築限界検査には含めない）。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { onLight } from './batch';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { BUMPER_D, hagoromoSpec } from './hagoromo-branch';
import { bogieOffset, createTrainSet, setTrainNight } from './train-models';

/** 羽衣の3番線ホームに停まっている 2000系（描画のみ）。当たり判定・運行には関わらず、遠くでは描かない。 */
export function buildHagoromoTrain(ctx: GameContext): void {
  const h = hagoromoSpec(ctx.route);
  if (!h) return;
  const cars = createTrainSet('commuter-2000', 2, ctx.renderer, { dest: '高師浜', label: '普通', units: [2] });
  const group = new THREE.Group(); group.name = 'oncoming-hagoromo-parked';
  const a = new THREE.Vector3(), z = new THREE.Vector3();
  // 先頭を車止め（d = BUMPER_D）の手前 4m に置き、d の増える向きへ連ねる
  let dc = BUMPER_D + 4;
  for (const c of cars) {
    dc += c.length / 2;
    const bog = bogieOffset(c.length);
    a.copy(ctx.track.at(h.sOf(dc - bog), h.lat(dc - bog), .38)); z.copy(ctx.track.at(h.sOf(dc + bog), h.lat(dc + bog), .38));
    placeCar(c.object, a, z); group.add(c.object);
    c.setDoors(true, 'R'); // ホーム（島式）側だけ開ける
    dc += c.length / 2;
  }
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));
  ctx.scene.add(group); cullByDistance(ctx, group, 420);
}

