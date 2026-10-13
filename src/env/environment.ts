// 環境（空・霧・光源）。天候・時間帯モジュールはこのハンドルを書き換える
import * as THREE from 'three';

export interface EnvironmentHandles {
  /** 空の色（scene.background と共有） */
  sky: THREE.Color;
  fog: THREE.Fog;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  /** 空色を変更（背景と霧の色を同時に更新） */
  setSky(hex: number): void;
  /** 毎フレーム更新用フック（時間帯・天候アニメーション用。現状は何もしない） */
  update(dt: number, time: number): void;
}

const SKY = 0xb9d9f0;

export function createEnvironment(scene: THREE.Scene): EnvironmentHandles {
  const sky = new THREE.Color(SKY);
  scene.background = sky;
  const fog = new THREE.Fog(SKY, 250, 2600);
  scene.fog = fog;
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x5d6b45, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
  sun.position.set(300, 500, 200);
  scene.add(sun);
  // 旧・ポリゴンの山並み（world/scenery.ts の 'backdrop'）はスカイドームの山並みに置き換えたので隠す
  let oldBackdrop: THREE.Object3D | undefined, scan = 0;
  return {
    sky, fog, hemi, sun,
    setSky(hex) { sky.setHex(hex); fog.color.setHex(hex); },
    update() {
      if (!oldBackdrop && scan < 600) { scan++; oldBackdrop = scene.getObjectByName('backdrop'); }
      if (oldBackdrop) oldBackdrop.visible = false;
    },
  };
}
