// 距離カリング: カメラから遠い静的オブジェクトを丸ごと非表示にする（視錐台カリングの前段）。
// 登録したオブジェクトの visible はここが管理するので、他から visible を変えるものは子に入れて登録すること
import * as THREE from 'three';
import type { GameContext } from '../core/context';

interface Entry { obj: THREE.Object3D; c: THREE.Vector3; r: number; max: number }

const registry = new WeakMap<GameContext, Entry[]>();

/** maxDist = カメラから包含球の表面までの距離がこれを超えたら非表示 [m]。
 *  sphereFrom を渡すと包含球をそれらから取る（同じ球・同じ距離なら表示/非表示が必ずそろう。地面と一体で消すもの用） */
export function cullByDistance(ctx: GameContext, obj: THREE.Object3D, maxDist: number, sphereFrom?: THREE.Object3D[]): void {
  let list = registry.get(ctx);
  if (!list) {
    const l: Entry[] = []; list = l; registry.set(ctx, l);
    ctx.events.on('frame', () => {
      const p = ctx.camera.position;
      for (const e of l) e.obj.visible = e.c.distanceTo(p) - e.r < e.max;
    });
  }
  const box = new THREE.Box3();
  for (const o of sphereFrom?.length ? sphereFrom : [obj]) { o.updateMatrixWorld(true); box.expandByObject(o); }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  list.push({ obj, c: sphere.center, r: sphere.radius, max: maxDist });
}
