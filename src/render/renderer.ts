// レンダラ・シーン・カメラの生成とリサイズ
import * as THREE from 'three';
import { mobileDisplay } from '../env/settings';

export interface RenderCore {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function createRenderCore(canvas: HTMLCanvasElement): RenderCore {
  const mobile = mobileDisplay();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile });
  renderer.setPixelRatio(mobile ? 1 : Math.min(2, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 5000);
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera };
}
