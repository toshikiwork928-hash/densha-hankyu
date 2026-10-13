// 太陽の影: カメラ追従の影錐台（テクセル単位でスナップしてちらつき低減）。近景のみ描く
import * as THREE from 'three';

export interface Shadows {
  /** instBudget = InstancedMesh が影を落とす総三角形数の上限（影パスは個体ごとのカリングが効かないため） */
  configure(enabled: boolean, mapSize: number, instBudget: number): void;
  /** focus = 影を描く中心（列車の少し前方）、sunDir = 太陽方向 */
  update(focus: THREE.Vector3, sunDir: THREE.Vector3): void;
  /** シーン内メッシュの cast/receive を設定（未処理のものだけ） */
  tagScene(force?: boolean): void;
}

const HALF = 70;       // 影錐台の半幅 [m]
const DIST = 260;      // 太陽までの距離 [m]
const MAX_CAST_R = 120; // これより大きい物体は影を落とさない（地面・線路・遠景）

export function createShadows(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sun: THREE.DirectionalLight): Shadows {
  if (!sun.target.parent) scene.add(sun.target);
  const cam = sun.shadow.camera;
  cam.left = -HALF; cam.right = HALF; cam.top = HALF; cam.bottom = -HALF;
  cam.near = 1; cam.far = DIST * 2; cam.updateProjectionMatrix();
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
  let enabled = false, size = 0, budget = Infinity;
  const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3(), snapped = new THREE.Vector3();
  const sphere = new THREE.Sphere();

  function tagObject(o: THREE.Object3D) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.noShadow) return;
    // 生成側が明示した場合（BatchedMesh 等、個体カリングが効くもの）
    if (o.userData.castOverride !== undefined) { m.castShadow = !!o.userData.castOverride; m.receiveShadow = true; return; }
    const mat = m.material as THREE.Material | THREE.Material[];
    const basic = (Array.isArray(mat) ? mat[0] : mat)?.type === 'MeshBasicMaterial';
    const transparent = (Array.isArray(mat) ? mat[0] : mat)?.transparent;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere!);
    const s = o.getWorldScale(right); sphere.radius *= Math.max(s.x, s.y, s.z);
    let cast = !basic && !transparent && sphere.radius < MAX_CAST_R;
    const inst = o as THREE.InstancedMesh;
    if (cast && inst.isInstancedMesh) {
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3 * inst.count;
      cast = tris <= budget;
    }
    m.castShadow = cast;
    m.receiveShadow = !basic;
  }

  return {
    configure(en, ms, ib) {
      enabled = en;
      if (ib !== budget) { budget = ib; this.tagScene(true); }
      renderer.shadowMap.enabled = en;
      renderer.shadowMap.type = ms >= 2048 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      sun.castShadow = en;
      if (ms && ms !== size) {
        size = ms; sun.shadow.mapSize.set(ms, ms);
        sun.shadow.map?.dispose(); sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
      renderer.shadowMap.needsUpdate = true;
    },
    update(focus, sunDir) {
      // 光の座標系で中心をテクセル格子にスナップ
      fwd.copy(sunDir).negate();
      right.set(0, 1, 0).cross(fwd); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
      up.copy(fwd).cross(right).normalize();
      const texel = (HALF * 2) / Math.max(1, size);
      const a = Math.round(focus.dot(right) / texel) * texel, b = Math.round(focus.dot(up) / texel) * texel, c = focus.dot(fwd);
      if (enabled && size) snapped.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(fwd, c);
      else snapped.copy(focus);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDir, DIST);
      sun.target.updateMatrixWorld();
    },
    tagScene(force = false) {
      scene.traverse(o => {
        if (!force && o.userData.__envShadow) return;
        o.userData.__envShadow = true;
        tagObject(o);
      });
    },
  };
}
