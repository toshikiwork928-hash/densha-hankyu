// 樹冠LOD: 遠景から接近したときの包含球と、境界の視点往復を検証する。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/events';
import type { GameContext } from '../src/core/context';
import { buildSceneryBatches } from '../src/world/scenery-batch';

const ctx = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), events: new EventBus() } as GameContext;
const full = new THREE.BoxGeometry(8, 20, 8).translate(0, 10, 0);
const lod = new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0);
const [batch] = buildSceneryBatches(ctx, [{
  model: { flat: full, textured: [], lod, size: new THREE.Vector3(8, 20, 8) },
  pl: { p: new THREE.Vector3(), yaw: 0, k: 1 },
}]);
const at = (x: number) => {
  ctx.camera.position.set(x, 0, 0);
  ctx.events.emit('frame', { dt: .26, time: 0, state: 'title' });
  // WebGLRenderer が描画直前に行う全体球の視錐台判定も通す。
  new THREE.Frustum().intersectsObject(batch);
  return batch.getGeometryIdAt(0);
};
at(300); const farId = batch.getGeometryIdAt(0);
assert.ok(batch.boundingSphere);
const initialBounds = batch.boundingSphere.clone();
at(210); const fullId = batch.getGeometryIdAt(0);
assert.notEqual(fullId, farId);
// 接近しても全体球が詳細樹冠全頂点を含む。遠景での初回カリングに依存しない。
const point = new THREE.Vector3(), positions = full.attributes.position;
for (let i = 0; i < positions.count; i++) {
  point.fromBufferAttribute(positions, i);
  assert.ok(batch.boundingSphere.containsPoint(point), `full crown vertex ${i} outside bounds`);
}
assert.ok(batch.boundingSphere.equals(initialBounds));
for (const x of [239, 241, 235, 245]) assert.equal(at(x), fullId);
assert.equal(at(261), farId);
for (const x of [241, 239, 230, 250]) assert.equal(at(x), farId);
assert.equal(at(219), fullId);
at(1401); assert.equal(batch.getVisibleAt(0), false);
for (const x of [1399, 1401, 1380]) { at(x); assert.equal(batch.getVisibleAt(0), false); }
at(1349); assert.equal(batch.getVisibleAt(0), true);
console.log('樹冠LOD: 全形状の包含球・詳細/遠景境界・遠方再表示の検証成功');
