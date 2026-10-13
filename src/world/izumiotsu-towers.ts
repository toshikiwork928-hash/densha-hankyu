// 泉大津駅前の2棟並びのタワーマンション（描画専用）。90年代前半の高層住宅を想定した概形で、
// 外壁は焼き物タイル調の落ち着いた色、各階のバルコニー手すり壁の水平線、規則的な窓割り、屋上の機械室とアンテナ。
// 実在建物の名称・看板・ロゴ・寸法の写しは持たない。位置は route.coastalLandmarks の { kind:'twin-tower' }。
//   s = 近い棟（線路から約70m）の中心の s、side = 線路のどちら側か、direction = 岸和田側が s の増える向きなら 1。
//   遠い棟（約140m）は岸和田側へ TWIN_SHIFT だけずらす。reverseRoute が s・side・direction を反転するので、上り・下りで同じ物理位置になる。
// 外壁アトラス（昼の色と夜の窓明かり）と夜の点灯は羽衣のタワー（coastal-tower.ts）と同じ作り方。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Route } from '../route/types';
import { GeoBatch, P, M, onLight } from './batch';
import { cullByDistance } from './cull';
import { getTerrain } from './terrain';

type Landmark = NonNullable<Route['coastalLandmarks']>[number];

/** 近い棟・遠い棟の線路からの距離（外側の線路から塔の中心まで）[m]、遠い棟の岸和田側へのずれ [m] */
const OFFSETS = [70, 140];
const TWIN_SHIFT = 8;
/** 平面（約 30m 角で角を落とした正方形）、階数、階高。足元の2層は店舗・エントランスの低層部 */
const HALF = 15, CHAMFER = 3.6;
const FLOORS = 34, FLOOR_H = 3.2, PODIUM_H = 6.4;
const ROOF_Y = PODIUM_H + FLOORS * FLOOR_H;
/** 外壁アトラスの 1 セル = 1住戸（幅 BAY_W × 高さ FLOOR_H）。8 × 8 セルを繰り返す */
const BAY_W = 2.75, CELLS = 8, CELL_PX = 64;

/** タワーの敷地（その側の住宅・道路・木・ビルを置かない s の範囲）。向きに依らず中心対称 */
export function twinTowerZones(route: Route): { side: 1 | -1; from: number; to: number }[] {
  return (route.coastalLandmarks ?? []).filter(l => l.kind === 'twin-tower').map(l => {
    const dir = l.direction ?? 1, a = l.s, b = l.s + dir * TWIN_SHIFT;
    return { side: l.side ?? 1, from: Math.min(a, b) - HALF - 18, to: Math.max(a, b) + HALF + 18 };
  });
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 外壁アトラス。セル（64px）: 上に梁型、中ほどに掃き出し窓（引違い）、下にバルコニーの手すり壁（タイル）。両端は縦の柱型 */
function facadeTextures(): { map: THREE.CanvasTexture; emit: THREE.CanvasTexture } {
  const size = CELLS * CELL_PX, mk = () => { const c = document.createElement('canvas'); c.width = size; c.height = size; return c; };
  const day = mk(), lit = mk(), gd = day.getContext('2d')!, gl = lit.getContext('2d')!;
  gd.fillStyle = '#cdb996'; gd.fillRect(0, 0, size, size);
  gl.fillStyle = '#000'; gl.fillRect(0, 0, size, size);
  const rnd = seeded(19950211);
  const glass = ['#52646d', '#4a5c66', '#5a6d76', '#4f6168'];
  const warm = ['#ffd68a', '#ffe3a8', '#ffeec9', '#ffc977'], cool = ['#e1ecff', '#c7dcf2'];
  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
    const x = cx * CELL_PX, y = cy * CELL_PX, tone = (rnd() - .5) * 10;
    const shade = (hex: number[]) => `rgb(${hex.map(v => Math.max(0, Math.min(255, Math.round(v + tone)))).join(',')})`;
    // 壁面タイル（面）: 目地の横線 8px ごと・縦線 16px ごと
    gd.fillStyle = shade([205, 185, 150]); gd.fillRect(x, y, CELL_PX, CELL_PX);
    gd.fillStyle = 'rgba(120,98,66,.22)';
    for (let k = 0; k < CELL_PX; k += 8) gd.fillRect(x, y + k, CELL_PX, 1);
    for (let k = 0; k < CELL_PX; k += 16) gd.fillRect(x + k, y, 1, CELL_PX);
    // 縦の柱型（隣のセルとつながる）
    gd.fillStyle = shade([176, 152, 116]); gd.fillRect(x, y, 5, CELL_PX); gd.fillRect(x + CELL_PX - 5, y, 5, CELL_PX);
    // バルコニーの手すり壁（下 22px）。上端に笠木の明るい帯、下端にスラブの小口
    gd.fillStyle = shade([214, 197, 165]); gd.fillRect(x + 5, y + 42, CELL_PX - 10, 20);
    gd.fillStyle = 'rgba(120,98,66,.28)'; for (let k = 46; k < 60; k += 7) gd.fillRect(x + 5, y + k, CELL_PX - 10, 1);
    gd.fillStyle = '#eee5d1'; gd.fillRect(x, y + 40, CELL_PX, 3);
    gd.fillStyle = '#f2ecdd'; gd.fillRect(x, y + 61, CELL_PX, 3);
    gd.fillStyle = 'rgba(70,55,38,.35)'; gd.fillRect(x, y + 63, CELL_PX, 1);
    // 掃き出し窓（ガラス + 中桟）と、梁型の下の影
    gd.fillStyle = glass[Math.floor(rnd() * glass.length)]; gd.fillRect(x + 8, y + 11, CELL_PX - 16, 28);
    gd.fillStyle = '#d6cfbf'; gd.fillRect(x + CELL_PX / 2 - 1, y + 11, 2, 28);
    gd.fillStyle = 'rgba(0,0,0,.18)'; gd.fillRect(x + 8, y + 11, CELL_PX - 16, 3);
    if (rnd() < .3) { gd.fillStyle = '#d2c8ae'; gd.fillRect(x + 8, y + 11, (CELL_PX - 16) * (.4 + rnd() * .4), 28); }
    if (rnd() < .5) {
      const colors = rnd() < .9 ? warm : cool;
      gl.fillStyle = colors[Math.floor(rnd() * colors.length)];
      gl.fillRect(x + 8, y + 11, CELL_PX - 16, 28);
      gl.fillStyle = '#000'; gl.fillRect(x + CELL_PX / 2 - 1, y + 11, 2, 28);
    }
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  };
  return { map: tex(day), emit: tex(lit) };
}

/** 2棟のタワーを建てる（呼び出しは路線あたり1回） */
export function buildTwinTower(ctx: GameContext, st: Landmark): void {
  const { track, route } = ctx, T = getTerrain(ctx);
  const lo = Math.min(...route.tracks), hi = Math.max(...route.tracks);
  const side = st.side ?? 1, dir = st.direction ?? 1;
  const latOf = (u: number) => side > 0 ? hi + u : lo - u;
  const sAt = (z: number) => st.s + dir * z;
  const g = T.groundY(st.s), yaw = -track.trackAt(st.s).phi;
  const world = (z: number, u: number, y: number) => { const p = track.at(sAt(z), latOf(u), 0); p.y = g + y; return p; };
  const bx = (b: GeoBatch, key: string, z0: number, z1: number, u0: number, u1: number, y0: number, y1: number, color: number) => {
    const p = world((z0 + z1) / 2, (u0 + u1) / 2, (y0 + y1) / 2);
    b.add(key, P.box, M(p.x, p.y, p.z, yaw, Math.abs(u1 - u0), Math.abs(y1 - y0), Math.abs(z1 - z0)), color);
  };
  const BODY = { base: 0x7d6a52, trim: 0xe9e1d0, slab: 0xc4bfb3, dark: 0x4f5459, steel: 0x8a9298, green: 0x5f8a4e };
  const WARM = 0xffd9a0, COOL = 0xcfe6f4, RED = 0xff3a30;

  const far = new GeoBatch(), near = new GeoBatch(), lit = new GeoBatch(), beacon = new GeoBatch();
  const farGroup = new THREE.Group(); farGroup.name = 'izumiotsu-towers-far';
  const nearGroup = new THREE.Group(); nearGroup.name = 'izumiotsu-towers-near';
  const { map, emit } = facadeTextures();
  const facade = new THREE.MeshLambertMaterial({ map, emissiveMap: emit, emissive: 0xffffff, emissiveIntensity: 0 });
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [];
  const rnd = seeded(7791);

  OFFSETS.forEach((d, n) => {
    const zc = n * TWIN_SHIFT, uc = d;
    // 平面: 角を落とした正方形（局所 z = 線路方向、u = 線路からの距離）
    const h = HALF, k = CHAMFER;
    const P8: [number, number][] = [
      [zc - h + k, uc - h], [zc + h - k, uc - h], [zc + h, uc - h + k], [zc + h, uc + h - k],
      [zc + h - k, uc + h], [zc - h + k, uc + h], [zc - h, uc + h - k], [zc - h, uc - h + k],
    ];
    // 塔身: 8面をアトラスの繰り返しで貼る（描画1回）。面ごとに別のセルから始めて模様の反復を目立たなくする
    const ca = world(zc, uc, 0);
    P8.forEach((a, i) => {
      const b = P8[(i + 1) % 8];
      const A = world(a[0], a[1], PODIUM_H), B = world(b[0], b[1], PODIUM_H), C = world(b[0], b[1], ROOF_Y), D = world(a[0], a[1], ROOF_Y);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), bays = Math.max(1, Math.round(len / BAY_W));
      const mid = world((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0), co = mid.clone().sub(ca).setY(0).normalize();
      const n3 = B.clone().sub(A).cross(D.clone().sub(A)).normalize(), flip = n3.dot(co) < 0, N = [co.x, 0, co.z];
      const uo = Math.floor(rnd() * CELLS), vo = Math.floor(rnd() * CELLS);
      const u0 = uo / CELLS, u1 = (uo + bays) / CELLS, v0 = vo / CELLS, v1 = (vo + FLOORS) / CELLS;
      const tA = [u0, v0], tB = [u1, v0], tC = [u1, v1], tD = [u0, v1];
      const tri = (p: THREE.Vector3[], t: number[][]) => p.forEach((v, q) => { pos.push(v.x, v.y, v.z); nrm.push(...N); uvs.push(...t[q]); });
      if (!flip) { tri([A, B, C], [tA, tB, tC]); tri([A, C, D], [tA, tC, tD]); } else { tri([A, C, B], [tA, tC, tB]); tri([A, D, C], [tA, tD, tC]); }
    });
    // 屋上: 笠木・機械室・避雷針（遠景にも見える）
    bx(far, 'body', zc - h - .3, zc + h + .3, uc - h - .3, uc + h + .3, ROOF_Y - .15, ROOF_Y + 1.3, BODY.trim);
    bx(far, 'body', zc - 9, zc + 9, uc - 9, uc + 9, ROOF_Y + 1.3, ROOF_Y + 5.4, BODY.slab);
    bx(far, 'body', zc - 6, zc + 6, uc - 6, uc + 6, ROOF_Y + 5.4, ROOF_Y + 6.2, BODY.trim);
    bx(far, 'body', zc - 5, zc - 1, uc + 6, uc + 12, ROOF_Y + 1.3, ROOF_Y + 3.4, BODY.steel);
    const mast = world(zc, uc, ROOF_Y + 6.2);
    far.add('body', P.boxB, M(mast.x, mast.y, mast.z, yaw, .35, 9, .35), BODY.steel);
    // 足元の低層部（2層分）: 一回り張り出した茶色のタイル壁
    bx(far, 'body', zc - h - 1.4, zc + h + 1.4, uc - h - 1.4, uc + h + 1.4, 0, PODIUM_H, BODY.base);
    bx(far, 'body', zc - h - 1.8, zc + h + 1.8, uc - h - 1.8, uc + h + 1.8, PODIUM_H - .5, PODIUM_H + .1, BODY.trim);
    // 航空障害灯（4隅の頂部と避雷針の先。夜に光る）
    for (const [z, u] of [[zc - h, uc - h], [zc + h, uc + h]] as const) bx(beacon, 'lit', z - .3, z + .3, u - .3, u + .3, ROOF_Y + 1.3, ROOF_Y + 2, RED);
    const mt = world(zc, uc, ROOF_Y + 15.2);
    beacon.add('lit', P.box, M(mt.x, mt.y, mt.z, yaw, .5, .5, .5), RED);

    // ---- 近景 ----
    const hh = h + 1.4;
    // 低層部の窓（1階: 連続ガラスのエントランス・店舗、2階: 窓列）。線路側の面と側面
    for (let z = zc - hh + 2.5; z < zc + hh - 4; z += 4.2) {
      bx(lit, 'lit', z, z + 3.6, uc - hh - .06, uc - hh - .04, .6, 3.9, (z - zc) % 8 < 4 ? WARM : COOL);
      bx(lit, 'lit', z, z + 2.6, uc - hh - .06, uc - hh - .04, 4.4, 6, COOL);
      bx(near, 'body', z - .15, z + .15, uc - hh - .08, uc - hh - .02, .5, 4.1, BODY.dark);
    }
    bx(near, 'body', zc - hh, zc + hh, uc - hh - 2.6, uc - hh, 4.1, 4.35, BODY.trim);          // エントランスの庇
    for (const zs of [-1, 1]) for (let u = uc - hh + 3; u < uc + hh - 3; u += 5) {
      bx(lit, 'lit', zc + zs * (hh + .05), zc + zs * (hh + .07), u, u + 2.8, 1, 3.6, COOL);
    }
    // 植栽: 低層部の足元の低木と高木
    for (let z = zc - hh - 3; z <= zc + hh + 3; z += 5.5) {
      for (const u of [uc - hh - 4.5, uc + hh + 3.5]) {
        const p = world(z + rnd() * 2, u, 0), r = 1.4 + rnd() * 1.1;
        near.add('body', P.boxB, M(p.x, p.y, p.z, 0, .22, 2.2, .22), 0x6d5640);
        near.add('body', P.sphere, M(p.x, p.y + 2.2 + r * .6, p.z, 0, r * 2, r * 1.8, r * 2), BODY.green);
      }
    }
    // 屋上の室外機・手すり
    for (let z = zc - 8; z < zc + 8; z += 3.2) bx(near, 'body', z, z + 2.2, uc + 9.4, uc + 12.6, ROOF_Y + 1.3, ROOF_Y + 2.7, BODY.steel);
  });

  const shaftGeo = new THREE.BufferGeometry();
  shaftGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shaftGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  shaftGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  shaftGeo.computeBoundingSphere();
  const shaft = new THREE.Mesh(shaftGeo, facade); shaft.name = 'izumiotsu-tower-shaft'; farGroup.add(shaft);
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  far.build({ body: bodyMat }, farGroup);
  near.build({ body: bodyMat }, nearGroup);
  beacon.build({ lit: new THREE.MeshBasicMaterial({ vertexColors: true }) }, farGroup);
  const litMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x4b5760 });
  lit.build({ lit: litMat }, nearGroup);
  const dayGlass = new THREE.Color(0x4b5760), night = new THREE.Color(0xffffff);
  onLight(ctx, f => { litMat.color.copy(dayGlass).lerp(night, f); facade.emissiveIntensity = f * .9; });
  ctx.scene.add(farGroup, nearGroup);
  cullByDistance(ctx, farGroup, 3200);
  cullByDistance(ctx, nearGroup, 650);
}
