// 車両配置の共通処理（車両モデル本体は world/train-models.ts と world/trains/*）
import * as THREE from 'three';

export { glowTexture } from './trains/common';

/** 2台車の位置から車体の位置・向きを決める（曲線・勾配で自然に見えるよう弦で近似） */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _mm = new THREE.Matrix4();
export function placeCar(obj: THREE.Object3D, front: THREE.Vector3, rear: THREE.Vector3): void {
  _a.copy(front); _b.copy(rear);
  obj.position.addVectors(_a, _b).multiplyScalar(.5);
  _mm.lookAt(_b, _a, _up); // z 軸 = 後ろ向き → 前 = -Z
  obj.quaternion.setFromRotationMatrix(_mm);
}
