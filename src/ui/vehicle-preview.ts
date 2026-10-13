// ゲームと同じ車両モデルを、小さな独立シーンで展示する。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from '../core/context';
import type { ServiceSpec, TrainKind } from '../route/types';
import { createTrainSet } from '../world/train-models';
import { destOf, kindsKey } from '../route/service';

export function createVehiclePreview(ctx: GameContext) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  // GPUで作った環境マップは別WebGLコンテキストへ共有できないので、展示用にも生成する。
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const reflection = pmrem.fromScene(room, .04);
  pmrem.dispose(); room.dispose();
  const canvas = renderer.domElement;
  canvas.className = 'vehicle-preview-canvas'; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '車両外観。ドラッグまたは矢印キーで回転、ホイールまたはプラス・マイナスで拡大縮小');
  const makeScene = () => {
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight(0xe2efff, 0x7a8390, 2));
    const sun = new THREE.DirectionalLight(0xfff1db, 3); sun.position.set(-12, 18, -20); s.add(sun);
    const fill = new THREE.DirectionalLight(0xc6ddff, 1); fill.position.set(15, 5, 8); s.add(fill);
    return s;
  };
  const scene = makeScene(), root = new THREE.Group(); scene.add(root);
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 2000);
  const center = new THREE.Vector3(), size = new THREE.Vector3();
  const icons = new Map<TrainKind, string>();
  let host: HTMLElement | null = null, svc: ServiceSpec | undefined;
  let materials: THREE.Material[] = [], yaw = .8, elevation = .22, zoom = 1, full = false;
  let modelKey = '', dirty = true, width = 0, height = 0;

  // ジオメトリ・テクスチャは共有、材質は複製。ゲーム側の夜間照明には触らない。
  function model(kind: TrainKind, count: number, units: number[], label?: string, unitKinds?: TrainKind[], dest?: string) {
    const group = new THREE.Group(), owned = new Map<THREE.Material, THREE.Material>();
    const cars = createTrainSet(kind, count, ctx.renderer, { units, label, unitKinds, dest: dest ?? ctx.route.stations.at(-1)?.name });
    const total = cars.reduce((a, c) => a + c.length, 0);
    let z0 = -total / 2;
    cars.forEach(car => {
      car.object.position.z = z0 + car.length / 2; z0 += car.length;
      car.object.traverse(o => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Sprite)) return;
        const clone = (m: THREE.Material) => {
          let copy = owned.get(m);
          if (!copy) {
            copy = m.clone(); owned.set(m, copy);
            if (copy instanceof THREE.MeshStandardMaterial) {
              copy.emissiveIntensity = 0; copy.envMap = reflection.texture; copy.envMapIntensity = 1;
            }
          }
          return copy;
        };
        if (o instanceof THREE.Mesh) o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
        else { o.material = clone(o.material) as THREE.SpriteMaterial; o.visible = false; }
      });
      group.add(car.object);
    });
    return { group, owned: [...owned.values()] };
  }

  function faceIcon(kind: TrainKind): string {
    const cached = icons.get(kind); if (cached) return cached;
    const iconScene = makeScene(), m = model(kind, 1, [1]); iconScene.add(m.group);
    const box = new THREE.Box3().setFromObject(m.group);
    const c = new THREE.OrthographicCamera(-3, 3, 3, -3, .1, 80);
    c.position.set(0, 2.3, box.min.z - 10); c.lookAt(0, 2.3, 0);
    renderer.setSize(128, 128, false); renderer.render(iconScene, c);
    const uri = canvas.toDataURL('image/png'); icons.set(kind, uri);
    for (const mat of m.owned) mat.dispose();
    width = 0; dirty = true;
    return uri;
  }

  function rebuild() {
    if (!svc) return;
    const key = `${kindsKey(svc)}:${svc.units.join('+')}:${svc.name}:${full}`;
    if (key === modelKey) return;
    modelKey = key; root.clear(); for (const m of materials) m.dispose();
    // サザンの単車表示は物理先頭ではなく座席指定車を表示する。
    const previewKind = svc.id === 'southern'
      ? (svc.unitKinds?.find(k => k === 'southern-10000' || k === 'southern-12000') ?? svc.kind)
      : svc.kind;
    const m = model(full ? svc.kind : previewKind, full ? svc.cars : 1, full ? svc.units : [1], svc.name, full ? svc.unitKinds : undefined, destOf(ctx.route, svc));
    root.add(m.group); materials = m.owned;
    const box = new THREE.Box3().setFromObject(root); box.getCenter(center); box.getSize(size);
    zoom = 1; dirty = true;
  }

  function draw() {
    if (!host?.isConnected || host.closest<HTMLElement>('[data-pane]')?.hidden || ctx.state.state !== 'title') return;
    const w = Math.round(canvas.clientWidth), h = Math.round(canvas.clientHeight);
    if (!w || !h) return;
    if (w !== width || h !== height) {
      width = w; height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
    }
    if (!dirty) return;
    const sy = Math.abs(Math.sin(yaw)), cy = Math.abs(Math.cos(yaw));
    const se = Math.sin(elevation), ce = Math.cos(elevation), tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const lateral = (size.x * cy + size.z * sy) / 2;
    const vertical = (size.y * ce + (size.x * sy + size.z * cy) * se) / 2;
    const depth = ((size.x * sy + size.z * cy) * ce + size.y * se) / 2;
    const distance = (Math.max(lateral / (tan * camera.aspect), vertical / tan) + depth) * 1.12 * zoom;
    camera.position.copy(center).add(new THREE.Vector3(Math.sin(yaw) * ce, se, -Math.cos(yaw) * ce).multiplyScalar(distance));
    camera.lookAt(center); renderer.render(scene, camera); dirty = false;
  }

  let drag: { id: number; x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.focus();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    yaw += (e.clientX - drag.x) * .012;
    elevation = THREE.MathUtils.clamp(elevation + (e.clientY - drag.y) * .008, .04, 1.25);
    drag.x = e.clientX; drag.y = e.clientY; dirty = true;
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * .001), .65, 1.8); dirty = true;
  }, { passive: false });
  canvas.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') yaw -= .16;
    else if (e.key === 'ArrowRight') yaw += .16;
    else if (e.key === 'ArrowUp') elevation = Math.min(1.25, elevation + .1);
    else if (e.key === 'ArrowDown') elevation = Math.max(.04, elevation - .1);
    else if (e.key === '+' || e.key === '=') zoom = Math.max(.65, zoom / 1.15);
    else if (e.key === '-') zoom = Math.min(1.8, zoom * 1.15);
    else return;
    e.preventDefault(); e.stopPropagation(); dirty = true;
  });
  ctx.events.on('frame', draw);
  return {
    faceIcon,
    mount(container: HTMLElement, service: ServiceSpec) {
      host = container; svc = service;
      host.innerHTML = `<div class="preview-heading">外観プレビュー <span>昼・晴れ</span></div>
        <div class="preview-stage"></div>
        <div class="preview-controls" role="group" aria-label="外観プレビューの操作">
          <button type="button" data-view="front">正面</button><button type="button" data-view="angle">斜め</button>
          <button type="button" data-view="side">側面</button><button type="button" data-view="roof">屋根</button>
          <button type="button" data-view="out" aria-label="プレビュー縮小">−</button><button type="button" data-view="in" aria-label="プレビュー拡大">＋</button>
          <button type="button" data-view="formation" aria-pressed="${full}">${full ? '先頭車を見る' : `${svc.cars}両編成を見る`}</button>
        </div><p class="sub">ドラッグで回転・ホイールで拡大縮小。矢印キー・＋ − にも対応。</p>`;
      host.querySelector('.preview-stage')!.appendChild(canvas);
      host.onkeydown = e => { e.stopPropagation(); };
      host.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => {
        switch (b.dataset.view) {
          case 'front': yaw = 0; elevation = .06; zoom = 1; break;
          case 'angle': yaw = .8; elevation = .22; zoom = 1; break;
          case 'side': yaw = Math.PI / 2; elevation = .08; zoom = 1; break;
          case 'roof': yaw = .8; elevation = 1.05; zoom = 1; break;
          case 'in': zoom = Math.max(.65, zoom / 1.15); break;
          case 'out': zoom = Math.min(1.8, zoom * 1.15); break;
          case 'formation': full = !full; rebuild(); b.textContent = full ? '先頭車を見る' : `${svc!.cars}両編成を見る`; b.setAttribute('aria-pressed', String(full)); break;
        }
        dirty = true; b.blur();
      });
      rebuild(); dirty = true; draw();
    },
  };
}
