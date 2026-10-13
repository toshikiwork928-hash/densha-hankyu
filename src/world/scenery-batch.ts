// 読込素材（木・ビル）の一括描画: 材質（頂点色 / テクスチャ）ごとに1つの BatchedMesh へまとめる。
// 個体ごとの視錐台カリングは BatchedMesh 側。木は距離で簡易形状へ切替え、遠方は非表示
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Placement, PreparedModel } from './assets';

const LOD_NEAR = 240;  // 初回の詳細/簡易形状の境界 [m]
const LOD_MARGIN = 20; // 境界付近で視点が動いても樹冠を往復切替しない
const TREE_FAR = 1400; // これより遠い木は描かない [m]
const FAR_MARGIN = 50;

export interface SceneryItem { model: PreparedModel; pl: Placement }

interface Group { map: THREE.Texture | null; geos: Map<THREE.BufferGeometry, { list: Placement[]; lod?: THREE.BufferGeometry }> }
interface LodEntry { bm: THREE.BatchedMesh; id: number; x: number; z: number; full: number; lod: number; g: number; vis: boolean }

export function buildSceneryBatches(ctx: GameContext, items: SceneryItem[]): THREE.BatchedMesh[] {
  const groups = new Map<string, Group>();
  const add = (key: string, map: THREE.Texture | null, geo: THREE.BufferGeometry, pl: Placement, lod?: THREE.BufferGeometry) => {
    let g = groups.get(key);
    if (!g) { g = { map, geos: new Map() }; groups.set(key, g); }
    let e = g.geos.get(geo);
    if (!e) { e = { list: [], lod }; g.geos.set(geo, e); }
    e.list.push(pl);
  };
  for (const { model, pl } of items) {
    if (model.flat) add('flat', null, model.flat, pl, model.lod);
    for (const t of model.textured) add('tex:' + t.key, t.map, t.geo, pl);
  }

  const out: THREE.BatchedMesh[] = [], lods: LodEntry[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), sc = new THREE.Vector3();
  const vc = (g: THREE.BufferGeometry) => g.attributes.position.count, ic = (g: THREE.BufferGeometry) => g.index!.count;
  for (const [key, g] of groups) {
    let nInst = 0, nVert = 0, nIdx = 0;
    for (const [geo, e] of g.geos) {
      nInst += e.list.length; nVert += vc(geo); nIdx += ic(geo);
      if (e.lod) { nVert += vc(e.lod); nIdx += ic(e.lod); }
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: g.map });
    const bm = new THREE.BatchedMesh(nInst, nVert, nIdx, mat);
    // r170 の setGeometryIdAt はバッチ全体の包含球を更新しない。
    // 初回が遠景形状だと、接近後の詳細形状が包含球をはみ出して消える。
    // 全個体・両形状を含む固定球を作り、個体の視錐台カリングは維持する。
    const bounds = new THREE.Sphere().makeEmpty(), sphere = new THREE.Sphere();
    bm.name = 'scenery-' + (key === 'flat' ? 'flat' : 'tex');
    bm.sortObjects = false; // 並べ替えより CPU 負荷を優先
    for (const [geo, e] of g.geos) {
      const full = bm.addGeometry(geo), lod = e.lod ? bm.addGeometry(e.lod) : -1;
      for (const pl of e.list) {
        const id = bm.addInstance(full);
        bm.setMatrixAt(id, m4.compose(pl.p, q.setFromEuler(e3.set(0, pl.yaw, 0)), sc.setScalar(pl.k)));
        bm.getBoundingSphereAt(full, sphere); bounds.union(sphere.applyMatrix4(m4));
        if (lod >= 0) { bm.getBoundingSphereAt(lod, sphere); bounds.union(sphere.applyMatrix4(m4)); }
        if (lod >= 0) lods.push({ bm, id, x: pl.p.x, z: pl.p.z, full, lod, g: full, vis: true });
      }
    }
    bm.boundingSphere = bounds;
    // 影は BatchedMesh が影カメラで個体カリングするので近景だけが描かれる
    bm.castShadow = bm.receiveShadow = true;
    bm.userData.castOverride = true;
    ctx.scene.add(bm); out.push(bm);
  }

  // 木の距離 LOD（0.25 秒ごと）
  let initialized = false;
  const update = () => {
    const c = ctx.camera.position;
    for (const L of lods) {
      const d2 = (L.x - c.x) ** 2 + (L.z - c.z) ** 2;
      const far = !initialized || L.vis ? TREE_FAR : TREE_FAR - FAR_MARGIN;
      const vis = d2 < far * far;
      if (vis !== L.vis) { L.bm.setVisibleAt(L.id, vis); L.vis = vis; }
      const near = !initialized ? LOD_NEAR : L.g === L.full ? LOD_NEAR + LOD_MARGIN : LOD_NEAR - LOD_MARGIN;
      const g = d2 > near * near ? L.lod : L.full;
      if (vis && g !== L.g) { L.bm.setGeometryIdAt(L.id, g); L.g = g; }
    }
    initialized = true;
  };
  let acc = 1;
  ctx.events.on('frame', ({ dt }) => { if ((acc += dt) >= .25) { acc = 0; update(); } });
  ctx.events.on('reset', () => { acc = 1; });
  return out;
}
