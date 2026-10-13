// イラスト風の描画。元の材質・色・ゲーム進行を保持したまま、描画だけ切り替える。
// 標準の描画ではこのモジュールを読み込まず、イラストを選んだ時に render/look-switch.ts が enableIllustratedLook を呼ぶ。
// 標準へ戻すときは dispose で、加工した材質（onBeforeCompile・プログラム鍵）・輪郭線・コールバックをすべて元に戻す。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { TimeOfDay } from '../core/events';
import { addTrainLookListener } from '../world/train-models';

const PREFIX = /* glsl */`
uniform float illustrationStrength;
uniform float illustrationDay;
uniform float illustrationSunMax;
uniform float illustrationBand;
uniform vec3 illustrationShade;
uniform vec3 illustrationRimColor;
`;

const GROUND_NOISE = /* glsl */`
varying vec2 illustrationWorld;
float illustrationHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float illustrationNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(illustrationHash(i), illustrationHash(i + vec2(1.0, 0.0)), f.x),
    mix(illustrationHash(i + vec2(0.0, 1.0)), illustrationHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/** 時間帯ごとの陰の色（環境光へ乗算）。昼は冷たい青、朝は青灰、夕は青紫 */
const SHADE: Record<TimeOfDay, number[]> = {
  morning: [.80, .86, 1.03],
  noon: [.78, .87, 1.02],
  evening: [.84, .79, 1.0],
  night: [.86, .88, 1.0],
};
/** 悪天候時の陰の色（色味を抑えた灰青） */
const SHADE_OVERCAST = new THREE.Vector3(.84, .88, .97);
/** 建物の接地影の色 */
const CONTACT: Record<TimeOfDay, number> = { morning: 0x1c2a42, noon: 0x18283b, evening: 0x2a2242, night: 0x141a2a };
const CONTOUR = new THREE.Color(0x263444);

export interface IllustratedLook {
  /** イラスト専用の処理をすべて止めて、材質・輪郭線・コールバックを元に戻す */
  dispose(): void;
}

export function enableIllustratedLook(ctx: GameContext): IllustratedLook {
  // 有効な間は常に 1。標準へ戻すときは dispose で材質を加工前に戻すので、0 の状態は持たない
  const strength = { value: 1 };
  const day = { value: 1 };
  // 直射光の強さ（帯の基準）と、帯の効き。時間帯で光量が違っても同じ割合で段が付くようにする
  const sunMax = { value: .5 };
  const band = { value: .6 };
  const shade = { value: new THREE.Vector3(...SHADE.noon) };
  const rimColor = { value: new THREE.Color(0, 0, 0) };
  /** 加工した材質と、加工前の onBeforeCompile・プログラム鍵（dispose で戻す） */
  const patched = new Map<THREE.Material, { before: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey'] }>();
  /** 加工しない材質も含め、一度見た材質（二重に調べない）。dispose でそのまま捨てる */
  const seen = new WeakSet<THREE.Material>();
  /** 建物の接地影の材質と、加工前の不透明度・色 */
  const shadows = new Map<THREE.Material, { opacity: number; color?: THREE.Color }>();
  const outlined = new WeakSet<THREE.Mesh>();
  const edgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
  const edgeList = new Set<THREE.EdgesGeometry>();
  const contours: THREE.LineSegments[] = [];
  const contourMat = new THREE.LineBasicMaterial({ color: 0x263444, transparent: true, opacity: .38, depthWrite: false });
  // 輪郭線は遠いほど淡く。線幅は WebGL で変えられないため、濃さで細く見せる
  contourMat.onBeforeCompile = shader => {
    shader.vertexShader = 'varying float illustrationDepth;\n' + shader.vertexShader.replace('#include <fog_vertex>', `
      #include <fog_vertex>
      illustrationDepth = -mvPosition.z;
    `);
    shader.fragmentShader = 'varying float illustrationDepth;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
      diffuseColor.a *= 1.0 - 0.72 * smoothstep(14.0, 140.0, illustrationDepth);
      #include <opaque_fragment>
    `);
  };
  contourMat.customProgramCacheKey = () => 'illustration-contour-v2';

  function patch(mat: THREE.Material) {
    if (mat.userData.illustrationShadow && !shadows.has(mat)) shadows.set(mat, { opacity: mat.opacity, color: (mat as THREE.MeshBasicMaterial).color?.clone() });
    if (seen.has(mat)) return;
    seen.add(mat);
    if (!(mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshStandardMaterial)) return;
    // 透過の柵・雨雪・発光表示には適用しない。
    if (mat.transparent) return;
    const ground = mat.name === 'ground';
    const physical = mat instanceof THREE.MeshStandardMaterial;
    const before = mat.onBeforeCompile, beforeKey = mat.customProgramCacheKey;
    const originalKey = mat.customProgramCacheKey();
    patched.set(mat, { before, key: beforeKey });
    mat.onBeforeCompile = (shader, renderer) => {
      before.call(mat, shader, renderer);
      shader.uniforms.illustrationStrength = strength;
      shader.uniforms.illustrationDay = day;
      shader.uniforms.illustrationSunMax = sunMax;
      shader.uniforms.illustrationBand = band;
      shader.uniforms.illustrationShade = shade;
      shader.uniforms.illustrationRimColor = rimColor;
      shader.fragmentShader = PREFIX + (ground ? GROUND_NOISE : '') + shader.fragmentShader;
      if (ground) {
        shader.vertexShader = 'varying vec2 illustrationWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `
          #include <worldpos_vertex>
          illustrationWorld = (modelMatrix * vec4(transformed, 1.0)).xz;
        `);
      }
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float illustrationAmount = illustrationStrength * illustrationDay;
        float illustrationLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(illustrationLuma), 0.09 * illustrationAmount);
        ${ground ? `
          float broad = illustrationNoise(illustrationWorld * 0.13);
          float fine = illustrationNoise(illustrationWorld * 2.4);
          float hue = illustrationNoise(illustrationWorld * 0.037 + 17.0);
          float detail = 1.0 - smoothstep(18.0, 85.0, length(vViewPosition));
          vec3 grass = diffuseColor.rgb * vec3(0.87, 0.94, 0.88);
          // 明るさだけでなく、黄緑寄り・青緑寄りの大きな色むらで面のまとまりを作る
          grass *= mix(vec3(1.05, 1.0, 0.9), vec3(0.94, 0.99, 1.05), hue);
          grass *= 0.84 + 0.24 * broad + 0.10 * (fine - 0.5) * detail;
          diffuseColor.rgb = mix(diffuseColor.rgb, grass, illustrationAmount);
        ` : ''}
      `);
      // 色を量子化せず、直射光の強さだけを柔らかな3段階へ寄せる。
      // 段の境目は太陽の強さに対する割合で決め、朝・昼・夕で同じ見え方にする。
      // 街灯など太陽より強い光は圧縮しない。信号色・発光・夜間の視認性は既存の計算を保持する。
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        float albedoLuma = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.035);
        float directLuma = dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722));
        float directRel = directLuma / albedoLuma / illustrationSunMax;
        float bandTop = 1.06 * max(directRel, 1.0);
        float bandLevel = 0.24 + 0.38 * smoothstep(0.13, 0.24, directRel)
          + (bandTop - 0.62) * smoothstep(0.44, 0.58, directRel);
        float bandRatio = mix(1.0, bandLevel / max(directRel, 0.001),
          illustrationBand * illustrationAmount * smoothstep(0.03, 0.11, directRel));
        reflectedLight.directDiffuse *= bandRatio;
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), illustrationShade, illustrationAmount);
      `);
      if (physical) {
        // 縁: 日の当たらない側は少し暗く、当たる側は日の色で細く光らせる
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          float illustrationRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.5);
          float illustrationSunSide = 0.0;
          #if NUM_DIR_LIGHTS > 0
            illustrationSunSide = smoothstep(-0.05, 0.45, dot(normal, directionalLights[0].direction));
          #endif
          outgoingLight *= 1.0 - 0.17 * illustrationAmount * illustrationRim * (1.0 - 0.6 * illustrationSunSide);
          outgoingLight += illustrationRimColor * (illustrationAmount * illustrationRim * illustrationSunSide);
          #include <opaque_fragment>
        `);
      }
    };
    mat.customProgramCacheKey = () => `${originalKey}|illustration-v2:${ground}:${physical}`;
    mat.needsUpdate = true;
  }

  const inScene = (o: THREE.Object3D) => { let r: THREE.Object3D | null = o; while (r && r !== ctx.scene) r = r.parent; return !!r; };
  /** 対象の材質を加工する */
  const patchAll = (root: THREE.Object3D) => root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patch(mat);
  });
  /** 対象の車体に輪郭線を付ける */
  const outlineAll = (root: THREE.Object3D) => root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name !== 'train-shell' || outlined.has(mesh)) return;
    outlined.add(mesh);
    let edges = edgeCache.get(mesh.geometry);
    if (!edges) { edges = new THREE.EdgesGeometry(mesh.geometry, 32); edgeCache.set(mesh.geometry, edges); edgeList.add(edges); }
    const line = new THREE.LineSegments(edges, contourMat);
    line.name = 'illustration-contour'; line.userData.noShadow = true;
    mesh.add(line); contours.push(line);
  });
  // 有効にした時の1回の走査と、シーン全体が変わる節目（素材の読込完了・開始）だけ全体を調べる。
  // 実行中に増える車両（対向・追い越し・高野線・自列車の作り直し）は、生成時の登録口（train-models.ts）で知る。
  // 輪郭線は、次のフレームで 3D シーンに入っている車両だけに付ける（車両プレビューの車両には付けない）
  const newCars: THREE.Object3D[] = [];
  const scanScene = () => { patchAll(ctx.scene); outlineAll(ctx.scene); };
  scanScene();
  const off = [
    addTrainLookListener({ car: o => { patchAll(o); newCars.push(o); }, material: patch }),
    ctx.events.on('assetsReady', scanScene),
    ctx.events.on('start', scanScene),
  ];

  // 時間帯・天候の切替は環境側と同じく徐々に移す
  const shadeTarget = new THREE.Vector3(), contactCol = new THREE.Color(CONTACT.noon), contactTarget = new THREE.Color();
  const sunLin = new THREE.Color(), camPos = new THREE.Vector3(), linePos = new THREE.Vector3();
  const onFrame = ({ dt }: { dt: number }) => {
    day.value = (1 - ctx.light.night * 0.85) * (1 - ctx.light.tunnel);
    // 環境モジュールが毎フレーム設定した値へ加算せず乗算するため、切替時も累積しない。
    const amount = strength.value * day.value;
    const sun = ctx.env.sun, env = ctx.envState;
    sunLin.copy(sun.color);
    sunMax.value = Math.max(.02, (.2126 * sunLin.r + .7152 * sunLin.g + .0722 * sunLin.b) * sun.intensity / Math.PI);
    // 曇り・雨・霧で日差しが弱いときは段を付けない（平板な曇天の柔らかさを残す）
    band.value = .6 * THREE.MathUtils.smoothstep(sun.intensity, .35, 1.2);
    rimColor.value.copy(sunLin).multiplyScalar(.13 * Math.min(1, sun.intensity / 1.5));
    const overcast = env.weather === 'clear' ? 0 : .35 + .5 * env.intensity;
    const base = SHADE[env.timeOfDay];
    shadeTarget.set(base[0], base[1], base[2]).lerp(SHADE_OVERCAST, overcast);
    const k = 1 - Math.exp(-dt * 1.6);
    shade.value.lerp(shadeTarget, k);
    contactTarget.setHex(CONTACT[env.timeOfDay]); contactCol.lerp(contactTarget, k);

    ctx.renderer.toneMappingExposure *= 1 + .07 * amount;
    // 遠景の霞。霧・強い雨では視界がすでに短いので重ねない（信号の視認性を保つ）
    ctx.env.fog.far *= 1 - .18 * amount * THREE.MathUtils.smoothstep(ctx.env.fog.far, 500, 1500);
    // 輪郭線: 日の色をわずかに混ぜ、夕方は暖色の暗い線に
    contourMat.color.copy(CONTOUR).lerp(sunLin.multiplyScalar(.22), .25);
    contourMat.opacity = .38 * day.value * (1 - .35 * overcast);
    for (const mat of shadows.keys()) {
      mat.opacity = 0.24 * strength.value * day.value;
      if (mat instanceof THREE.MeshBasicMaterial) mat.color.copy(contactCol);
    }
    // 遠い車両の輪郭線は描かない（描画コール削減。遠景ではほぼ見えない）。シーンから外れた車両（追い越しの終了など）の輪郭線は手放す
    for (const car of newCars.splice(0)) if (inScene(car)) outlineAll(car);
    camPos.setFromMatrixPosition(ctx.camera.matrixWorld);
    for (let i = contours.length - 1; i >= 0; i--) {
      const line = contours[i];
      if (!inScene(line)) { outlined.delete(line.parent as THREE.Mesh); line.removeFromParent(); contours.splice(i, 1); continue; }
      linePos.setFromMatrixPosition(line.matrixWorld);
      line.visible = linePos.distanceToSquared(camPos) < 260 * 260;
    }
  };
  off.push(ctx.events.on('frame', onFrame));

  return {
    dispose() {
      for (const f of off.splice(0)) f();
      // 材質を加工前に戻す。プログラムの鍵も戻るので、イラスト用のシェーダーは次の描画で捨てられる
      for (const [mat, o] of patched) { mat.onBeforeCompile = o.before; mat.customProgramCacheKey = o.key; mat.needsUpdate = true; }
      patched.clear();
      for (const [mat, o] of shadows) {
        mat.opacity = o.opacity;
        if (o.color && mat instanceof THREE.MeshBasicMaterial) mat.color.copy(o.color);
      }
      shadows.clear();
      for (const line of contours) line.removeFromParent();
      contours.length = 0; newCars.length = 0;
      for (const g of edgeList) g.dispose();
      edgeList.clear();
      contourMat.dispose();
      // 露出と霧は環境側が毎フレーム設定し直すので、このモジュールが外れれば次のフレームで元の値になる
    },
  };
}
