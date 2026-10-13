// 手続き生成用のジオメトリ結合器。部品（箱・円柱など）を行列＋頂点色付きで積み、マテリアル別に1メッシュへまとめる
import * as THREE from 'three';
import type { GameContext } from '../core/context';

/** 結合元の部品形状（非インデックス化済み配列） */
export interface BasePart { pos: Float32Array; nrm: Float32Array; uv: Float32Array; count: number }

export function basePart(geo: THREE.BufferGeometry): BasePart {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  const uv = g.attributes.uv ? new Float32Array(g.attributes.uv.array) : new Float32Array(count * 2);
  return { pos: new Float32Array(g.attributes.position.array), nrm: new Float32Array(g.attributes.normal.array), uv, count };
}

// よく使う単位形状（中心原点、1x1x1）
export const P = {
  box: basePart(new THREE.BoxGeometry(1, 1, 1)),
  /** 底面原点の箱 */
  boxB: basePart(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0)),
  cyl: basePart(new THREE.CylinderGeometry(.5, .5, 1, 10)),
  cyl6: basePart(new THREE.CylinderGeometry(.5, .5, 1, 6)),
  cone4: basePart(new THREE.ConeGeometry(.5 * Math.SQRT2, 1, 4, 1).rotateY(Math.PI / 4)),
  sphere: basePart(new THREE.IcosahedronGeometry(.5, 1)),
  plane: basePart(new THREE.PlaneGeometry(1, 1)),
  /** 切妻屋根（幅1・高さ1・奥行1、底面原点、棟はZ方向） */
  gable: basePart(prismGeo()),
};

function prismGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape([new THREE.Vector2(-.5, 0), new THREE.Vector2(.5, 0), new THREE.Vector2(0, 1)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -.5);
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** 平行移動・Y回転・スケールの行列（使い回しの一時行列を返す） */
export function M(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
}

const _c = new THREE.Color(), _nm = new THREE.Matrix3(), _v = new THREE.Vector3();

class Buf {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = [];
}

/** マテリアルキー別に部品を積む。uv は uvKeys に含まれるキーのみ保持（メモリ節約） */
export class GeoBatch {
  private bufs = new Map<string, Buf>();
  /** 親行列（ローカル座標系で部品を積むとき用） */
  parent: THREE.Matrix4 | null = null;
  private tmp = new THREE.Matrix4();
  constructor(public uvKeys: Set<string> = new Set()) {}

  private buf(key: string): Buf {
    let b = this.bufs.get(key);
    if (!b) { b = new Buf(); this.bufs.set(key, b); }
    return b;
  }

  /** uvRect = [u0, v0, u1, v1]（アトラスの一部を貼る） */
  add(key: string, part: BasePart, m: THREE.Matrix4, color: THREE.ColorRepresentation = 0xffffff, uvRect?: readonly number[]): void {
    const b = this.buf(key), wantUv = this.uvKeys.has(key);
    const mm = this.parent ? this.tmp.multiplyMatrices(this.parent, m) : m;
    _nm.getNormalMatrix(mm); _c.set(color);
    const cr = Math.round(_c.r * 255), cg = Math.round(_c.g * 255), cb = Math.round(_c.b * 255);
    const e = mm.elements, { pos, nrm, uv, count } = part;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      b.pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      _v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(_nm).normalize();
      b.nrm.push(_v.x, _v.y, _v.z);
      if (wantUv) {
        const u = uv[i * 2], v = uv[i * 2 + 1];
        if (uvRect) b.uv.push(uvRect[0] + u * (uvRect[2] - uvRect[0]), uvRect[1] + v * (uvRect[3] - uvRect[1])); else b.uv.push(u, v);
      }
      b.col.push(cr, cg, cb);
    }
  }

  /** 線路沿いの帯など、生の三角形（ワールド座標）を追加 */
  addTris(key: string, positions: number[], color: THREE.ColorRepresentation = 0xffffff): void {
    const b = this.buf(key), wantUv = this.uvKeys.has(key);
    _c.set(color);
    const cr = Math.round(_c.r * 255), cg = Math.round(_c.g * 255), cb = Math.round(_c.b * 255);
    const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 9) {
      a.fromArray(positions, i); bb.fromArray(positions, i + 3); c.fromArray(positions, i + 6);
      const n = bb.clone().sub(a).cross(c.clone().sub(a)).normalize();
      for (let k = 0; k < 9; k++) b.pos.push(positions[i + k]);
      for (let k = 0; k < 3; k++) { b.nrm.push(n.x, n.y, n.z); if (wantUv) b.uv.push(0, 0); b.col.push(cr, cg, cb); }
    }
  }

  /** 頂点ごとの法線・色（0..1）付きの三角形（ワールド座標、親行列は適用しない） */
  addColored(key: string, positions: ArrayLike<number>, normals: ArrayLike<number>, colors: ArrayLike<number>): void {
    const b = this.buf(key), wantUv = this.uvKeys.has(key);
    for (let i = 0; i < positions.length; i++) { b.pos.push(positions[i]); b.nrm.push(normals[i]); b.col.push(Math.round(colors[i] * 255)); }
    if (wantUv) for (let i = 0; i < positions.length / 3; i++) b.uv.push(0, 0);
  }

  isEmpty(): boolean { return this.bufs.size === 0; }

  geometry(key: string): THREE.BufferGeometry | null {
    const b = this.bufs.get(key);
    if (!b || !b.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    if (b.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(b.col), 3, true));
    g.computeBoundingSphere();
    return g;
  }

  /** マテリアル表に従ってメッシュ化（表に無いキーは無視） */
  build(mats: Record<string, THREE.Material>, target?: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const key of this.bufs.keys()) {
      const mat = mats[key], g = mat && this.geometry(key);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat); mesh.name = key;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      target?.add(mesh); out.push(mesh);
    }
    this.bufs.clear();
    return out;
  }
}

/** s 方向にチャンク分けしたバッチ（視錐台カリング用） */
export class ChunkedBatch {
  private chunks = new Map<number, GeoBatch>();
  constructor(private size = 300, private uvKeys: Set<string> = new Set()) {}
  at(s: number): GeoBatch {
    const k = Math.floor(s / this.size);
    let b = this.chunks.get(k);
    if (!b) { b = new GeoBatch(this.uvKeys); this.chunks.set(k, b); }
    return b;
  }
  /** チャンクごとに Group を作って target へ追加（距離カリングの単位） */
  build(mats: Record<string, THREE.Material>, target: THREE.Object3D): THREE.Group[] {
    const out: THREE.Group[] = [];
    for (const [k, b] of this.chunks) {
      const g = new THREE.Group(); g.name = `chunk${k}`;
      b.build(mats, g);
      if (g.children.length) { target.add(g); out.push(g); }
    }
    this.chunks.clear();
    return out;
  }
}

/** 明るさ係数（ctx.light）の変化時に呼ぶ。night = 夜らしさ 0..1、tunnel = トンネル内 0..1。登録直後にも1回呼ぶ */
export function onLight(ctx: GameContext, fn: (night: number, tunnel: number) => void): void {
  let n = -1, t = -1;
  const check = () => {
    const L = ctx.light;
    if (Math.abs(L.night - n) < .004 && Math.abs(L.tunnel - t) < .004) return;
    n = L.night; t = L.tunnel; fn(n, t);
  };
  check(); ctx.events.on('frame', check);
}
