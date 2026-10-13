// 外部3D素材（すべてCC0、実行時にCDNから読込）の URL・読込・前処理・インスタンス化
// Kenney City Kit Commercial: https://kenney.nl （GitHubミラー経由、SHA固定。住宅は town-jp.ts で手続き生成）
// Quaternius Nature pack / Buildings pack 3: https://quaternius.com （車両は emu.ts で手続き生成）
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KENNEY = 'https://cdn.jsdelivr.net/gh/GeorgeQLe/assets-3d-city@988f219d48ecc23038ed28a411d2c71791be2c82/assets/kenney/';
const QUAT = 'https://cdn.jsdelivr.net/gh/trebeljahr/quaternius-showcase@e90ffea347393537703ae6f9d73e36492820f5a9/public/glb/';

export const ASSETS = {
  city: [...'abcdefgh'.split('').map(c => `building-${c}`), ...'abcde'.split('').map(c => `building-skyscraper-${c}`)]
    .map(n => `${KENNEY}city-kit-commercial/Models/GLB%20format/${n}.glb`),
  far: 'abcdefghijklm'.split('').map(c => `${KENNEY}city-kit-commercial/Models/GLB%20format/low-detail-building-${c}.glb`),
  mid: ['2Story_Balcony_Mat', '2Story_Sign_Mat', '2Story_Wide_Mat', '3Story_Balcony_Mat', '3Story_Small_Mat', '3Story_Slim_Mat', '4Story_Center_Mat', '4Story_Mat', '6Story_Stack_Mat']
    .map(n => `${QUAT}buildings_pack_3/${n}.glb`),
  trees: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'PineTree_1', 'PineTree_2', 'PineTree_3'].map(n => `${QUAT}nature_pack/${n}.glb`),
  bushes: ['Bush_1', 'Bush_2'].map(n => `${QUAT}nature_pack/${n}.glb`),
};
export type AssetKey = keyof typeof ASSETS;
export type LoadedAssets = Record<AssetKey, GLTF[]>;

/**
 * 描画用に前処理したモデル（ワールド行列・材質色を頂点へ焼き込み、材質ごとに結合済み。原点 = 底面中心）。
 * 属性は flat = position/normal/color、textured = position/normal/uv/color（いずれも index 付き）
 */
export interface PreparedModel {
  flat: THREE.BufferGeometry | null;
  textured: { key: string; map: THREE.Texture; geo: THREE.BufferGeometry }[];
  size: THREE.Vector3;
  /** 遠景用の簡易形状（flat と同じ属性）。木・植え込みのみ */
  lod?: THREE.BufferGeometry;
}

const gltfLoader = new GLTFLoader();
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** 画像内容から短いキーを作る（同一テクスチャを別 glTF から読んでも1つにまとめるため） */
const texKeys = new WeakMap<object, string>();
function textureKey(map: THREE.Texture): string {
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const hit = texKeys.get(img);
  if (hit) return hit;
  let key = `${img.width}x${img.height}`;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, 8, 8);
    key += ':' + Array.from(g.getImageData(0, 0, 8, 8).data).join(',');
  } catch { key += ':' + map.uuid; }
  texKeys.set(img, key);
  return key;
}

/** 量子化・インターリーブ済みでも Float32 の通常属性へ変換（結合時に型を揃えるため） */
function f32(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = a.getComponent(i, j);
  return new THREE.BufferAttribute(out, k);
}

/** 部品を共通属性（+頂点色、index 付き）へ正規化 */
function normalizePart(src: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: THREE.Color, withUv: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', f32(src.attributes.position));
  if (src.attributes.normal) g.setAttribute('normal', f32(src.attributes.normal));
  if (withUv) g.setAttribute('uv', src.attributes.uv ? f32(src.attributes.uv) : new THREE.Float32BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.index) g.setIndex(src.index.clone());
  if (m) g.applyMatrix4(m);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // 大きいモデルでも 16bit を超えうるので常に 32bit index へ
  const g = list.length === 1 ? list[0] : mergeGeometries(list)!;
  if (g.index && !(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
  return g;
}

/** 木・植え込みの遠景用簡易形状（幹＋樹冠1つ） */
function lodShape(size: THREE.Vector3, leaf: THREE.Color, trunk: THREE.Color | null): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = Math.max(size.x, size.z), h = size.y;
  if (trunk) {
    const t = new THREE.CylinderGeometry(w * .05, w * .07, h * .4, 5, 1, true); t.translate(0, h * .2, 0);
    parts.push(normalizePart(t, null, trunk, false));
  }
  const crownH = trunk ? h * .7 : h, crown = new THREE.IcosahedronGeometry(.5, 0);
  crown.scale(w * .85, crownH, w * .85); crown.translate(0, h - crownH / 2, 0);
  parts.push(normalizePart(crown, null, leaf, false));
  return merge(parts);
}

// glTF → PreparedModel。lod 指定時は遠景用の簡易形状も作る
export function prepareModel(root: THREE.Object3D, lod?: 'tree' | 'bush'): PreparedModel {
  root.updateMatrixWorld(true);
  const flats: THREE.BufferGeometry[] = [], texd = new Map<string, { map: THREE.Texture; list: THREE.BufferGeometry[] }>();
  const box = new THREE.Box3();
  // LOD 用の代表色（面積の大きい部品の色）
  let leaf: THREE.Color | null = null, trunk: THREE.Color | null = null, leafN = 0, trunkN = 0;
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
    const color = (mat.color ?? new THREE.Color(1, 1, 1)).clone();
    const map = mat.map ?? null;
    const g = normalizePart(o.geometry, o.matrixWorld, color, !!map);
    g.computeBoundingBox(); box.union(g.boundingBox!);
    if (map) {
      const key = textureKey(map);
      if (!texd.has(key)) texd.set(key, { map, list: [] });
      texd.get(key)!.list.push(g);
    } else flats.push(g);
    const n = g.attributes.position.count, brown = /wood|trunk|bark/i.test(mat.name ?? '');
    if (brown) { if (n > trunkN) { trunkN = n; trunk = color; } } else if (n > leafN) { leafN = n; leaf = color; }
  });
  const c = box.getCenter(new THREE.Vector3());
  const all = [...flats, ...[...texd.values()].flatMap(t => t.list)];
  for (const g of all) g.translate(-c.x, -box.min.y, -c.z);
  const size = box.getSize(new THREE.Vector3());
  return {
    flat: flats.length ? merge(flats) : null,
    textured: [...texd.entries()].map(([key, t]) => ({ key, map: t.map, geo: merge(t.list) })),
    size,
    lod: lod ? lodShape(size, leaf ?? new THREE.Color(0x4f7a3a), lod === 'tree' ? trunk ?? new THREE.Color(0x5a4636) : null) : undefined,
  };
}

async function loadGroup(urls: string[], onDone: () => void): Promise<GLTF[]> {
  const res = await Promise.allSettled(urls.map(u => withTimeout(gltfLoader.loadAsync(u), 20000).finally(onDone)));
  return res.filter((r): r is PromiseFulfilledResult<GLTF> => r.status === 'fulfilled').map(r => r.value);
}

/** 全素材を並列読込。失敗分は配列から除かれる */
export async function loadAllAssets(progress: (done: number, total: number) => void): Promise<{ loaded: LoadedAssets; failed: number; total: number }> {
  const entries = Object.entries(ASSETS) as [AssetKey, string[]][];
  const total = entries.reduce((a, [, b]) => a + b.length, 0);
  let done = 0; const tick = () => progress(++done, total);
  const loaded = Object.fromEntries(await Promise.all(entries.map(async ([k, urls]) => [k, await loadGroup(urls, tick)]))) as LoadedAssets;
  const failed = total - Object.values(loaded).reduce((a, b) => a + b.length, 0);
  return { loaded, failed, total };
}

// 簡易フォールバック（素材が取れなかった場合）
export function fallbackBox(color: number): PreparedModel {
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, .5, 0);
  return { flat: merge([normalizePart(geo, null, new THREE.Color(color), false)]), textured: [], size: new THREE.Vector3(1, 1, 1) };
}
/** 素材が読めないときの木（幹＋細分した球の樹冠） */
export function fallbackTree(): PreparedModel {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(.07, .1, .9, 6); trunk.translate(0, .45, 0);
  parts.push(normalizePart(trunk, null, new THREE.Color(0x5a4636), false));
  const blobs: [number, number, number, number, number][] = [[0, 1.35, 0, .62, 0x3f6630], [.32, 1.2, .1, .42, 0x4f7a3a], [-.28, 1.25, -.12, .44, 0x4a7336], [.05, 1.65, -.2, .4, 0x5a8540], [-.1, 1.55, .28, .38, 0x56803d]];
  for (const [x, y, z, r, c] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x, y, z);
    parts.push(normalizePart(g, null, new THREE.Color(c), false));
  }
  return { flat: merge(parts), textured: [], size: new THREE.Vector3(1.4, 2, 1.4) };
}

export interface Placement { p: THREE.Vector3; yaw: number; k: number }
