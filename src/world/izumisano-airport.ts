// 泉佐野〜みさき公園コース（route.id = 'izumisano-misaki' / '-up'）専用: 泉佐野の南での南海空港線の分岐と、その上を通る JR 関西空港線の橋。描画専用で、走行経路・信号は持たない。
// 平面形は route/routes/izumisano-airport.ts（下りの座標。上りは world/down-frame.ts の写しで同じ物理位置）。
//   空港線の下り線(AD): 外側下り線(T1)の外（左）で平行になり、35‰で上って、本線の高架を斜めに乗り越える（高々架）。上り線(AU): 外側上り線(T4)の外（右）へ分かれ、本線の高架と同じ高さで右へ遠ざかる。
//   分岐から s 470 までは route.extraTracks（本線の床版の延長）が描く。ここは s 470 から先の高架（床版・高欄・橋脚・架線柱・架線・レール）。
//   JR 関西空港線: 泉佐野駅の約1.1km南西で本線の真上をほぼ直角にまたぐ。橋の長さ・高さ・橋脚の形は資料に無く不明。ゲーム用の概形で、実測値ではない。
// 建築限界: 空港線の桁は本線の架線の上（桁の下面が本線のレール面から 9.6m 以上）を通り、橋脚は本線の高架の外に立てる。ctx.rng は使わない。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { airportGeometry, JR_HALF_WIDTH, type AirPt } from '../route/routes/izumisano-airport';
import { GeoBatch, M, P } from './batch';
import { cullByDistance } from './cull';

const UP = new THREE.Vector3(0, 1, 0);
const COLOR = { concrete: 0xb8b7ad, steel: 0x647773, girder: 0x6d7b86, rail: 0x9caaa9, ballast: 0x7c786d, sleeper: 0x605951, pole: 0x6a6f72 };
/** 地面の高さ。泉佐野〜みさき公園コースは地面が 0（高架は 9m、gradients で s 1961 までに地面へ下りる） */
const GROUND = 0;

function beam(b: GeoBatch, a: THREE.Vector3, z: THREE.Vector3, width: number, color: number, depth = width): void {
  const d = z.clone().sub(a), len = d.length();
  if (len < .001) return;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  b.add('air', P.box, new THREE.Matrix4().compose(a.clone().add(z).multiplyScalar(.5), q, new THREE.Vector3(width, len, depth)), color);
}
/** 帯: 横幅 width・厚み height を固定し、a→z の向き（水平）に沿わせる。勾配は長軸を両端に合わせる */
function strip(b: GeoBatch, a: THREE.Vector3, z: THREE.Vector3, width: number, height: number, color: number): void {
  const d = z.clone().sub(a), length = d.length();
  if (length < .001) return;
  const p = a.clone().add(z).multiplyScalar(.5), yaw = Math.atan2(d.x, d.z);
  b.add('air', P.box, M(p.x, p.y, p.z, yaw, width, height, length + .04, -Math.asin(d.y / length)), color);
}

/** 経路 pts（本線の s・横位置・高さ）に沿う高架 1 本。center = レール面中心 */
function elevatedLine(ctx: GameContext, b: GeoBatch, pts: AirPt[], opt: { poleSide: 1 | -1; /** 橋脚を立てない範囲（本線の高架の上・真横）の横位置 [lo, hi] */ keepOut: [number, number]; skipFrom?: number }): void {
  const W = pts.map(p => ctx.track.at(p.s, p.lat, p.h));
  /** 向き（水平の単位ベクトル）と右の法線 */
  const dir = (i: number) => {
    const a = W[Math.max(0, i - 1)], z = W[Math.min(W.length - 1, i + 1)];
    const x = z.x - a.x, y = z.z - a.z, l = Math.hypot(x, y) || 1;
    return { fx: x / l, fz: y / l, nx: -y / l, nz: x / l };
  };
  const at = (i: number, off = 0, h = 0): THREE.Vector3 => {
    const d = dir(i);
    return new THREE.Vector3(W[i].x + d.nx * off, W[i].y + h, W[i].z + d.nz * off);
  };
  const girderAt = (i: number) => pts[i].lat > opt.keepOut[0] - 4 && pts[i].lat < opt.keepOut[1] + 4;
  for (let i = 0; i + 1 < pts.length; i++) {
    // 軌道（バラスト・レール）。枕木は 1m おき
    strip(b, at(i, 0, .11), at(i + 1, 0, .11), 3.2, .22, COLOR.ballast);
    for (const lat of [-.5335, .5335]) strip(b, at(i, lat, .31), at(i + 1, lat, .31), .07, .14, COLOR.rail);
    const len = Math.hypot(W[i + 1].x - W[i].x, W[i + 1].z - W[i].z);
    for (let q = 0; q < len; q += 1.2) {
      const t = q / len, a = at(i, -1.05, .22).lerp(at(i + 1, -1.05, .22), t), z = at(i, 1.05, .22).lerp(at(i + 1, 1.05, .22), t);
      strip(b, a, z, .2, .14, COLOR.sleeper);
    }
    // 床版（桁の区間は鋼桁）と高欄
    const g = girderAt(i) || girderAt(i + 1);
    if (g) strip(b, at(i, 0, -1.2), at(i + 1, 0, -1.2), 6.6, 2.4, COLOR.girder);
    else strip(b, at(i, 0, -.54), at(i + 1, 0, -.54), 6.6, 1.1, COLOR.concrete);
    for (const off of [-3.2, 3.2]) strip(b, at(i, off, .6), at(i + 1, off, .6), .25, 1.15, g ? COLOR.girder : COLOR.concrete);
  }
  // 橋脚（経路 25m ごと。本線の高架の上と真横には立てない）
  let acc = 12;
  for (let i = 1; i + 1 < pts.length; i++) {
    acc += Math.hypot(W[i].x - W[i - 1].x, W[i].z - W[i - 1].z);
    if (acc < 25 || pts[i].lat > opt.keepOut[0] - 4 && pts[i].lat < opt.keepOut[1] + 4) continue;
    acc = 0;
    const d = dir(i), bottom = W[i].y - 1.1, h = bottom - GROUND - .5;
    if (h < .5) continue;
    for (const off of [-2.2, 2.2]) b.add('air', P.boxB, M(W[i].x + d.nx * off, GROUND, W[i].z + d.nz * off, Math.atan2(d.nx, d.nz), 1.3, h, 1.3), COLOR.concrete);
    b.add('air', P.box, M(W[i].x, bottom - .5, W[i].z, Math.atan2(d.nx, d.nz), 1.5, 1, 6.4), COLOR.concrete);
  }
  // 架線柱（経路 40m ごと、片側）と架線
  const wire: number[] = [];
  let prev: THREE.Vector3 | null = null, accP = 24;
  for (let i = 0; i < pts.length; i++) {
    if (prev) accP += Math.hypot(W[i].x - W[i - 1].x, W[i].z - W[i - 1].z);
    const c = at(i, 0, 5.72);
    if (prev) wire.push(prev.x, prev.y, prev.z, c.x, c.y, c.z);
    prev = c;
    if (accP >= 40 && i > 0 && i + 1 < pts.length && pts[i].s >= (opt.skipFrom ?? 0)) {
      accP = 0;
      const off = opt.poleSide * 2.9;
      beam(b, at(i, off, 0), at(i, off, 6.9), .26, COLOR.pole);
      beam(b, at(i, off, 6.5), at(i, 0, 6.5), .1, COLOR.pole);
    }
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0x24272a, fog: true });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  const wires = new THREE.LineSegments(geo, lineMat); wires.name = 'catenary-wire';
  ctx.scene.add(wires); cullByDistance(ctx, wires, 1600);
}

/** JR 関西空港線の橋: 本線（s = JR_S）に直角。複線。本線の高架の外に橋脚（高架の左右 12m / 16m 以遠）、本線をまたぐ区間は鋼桁 */
function jrBridge(ctx: GameContext, b: GeoBatch, pts: AirPt[]): void {
  const W = pts.map(p => ctx.track.at(p.s, p.lat, p.h));
  // 橋の向き（水平）は横位置の増える向き。法線 = 本線の進行方向
  const dir = (i: number) => {
    const a = W[Math.max(0, i - 1)], z = W[Math.min(W.length - 1, i + 1)];
    const x = z.x - a.x, y = z.z - a.z, l = Math.hypot(x, y) || 1;
    return { nx: -y / l, nz: x / l };
  };
  const at = (i: number, off = 0, h = 0): THREE.Vector3 => {
    const d = dir(i);
    return new THREE.Vector3(W[i].x + d.nx * off, W[i].y + h, W[i].z + d.nz * off);
  };
  const [pierL, pierR] = [-13, 17];
  const over = (i: number) => pts[i].lat > pierL - 1 && pts[i].lat < pierR + 1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const g = over(i) || over(i + 1);
    const groundGap = W[i].y - 1.1 - GROUND;
    if (g) strip(b, at(i, 0, -1.4), at(i + 1, 0, -1.4), JR_HALF_WIDTH * 2 + 1, 2.8, COLOR.girder);
    else strip(b, at(i, 0, -.74), at(i + 1, 0, -.74), JR_HALF_WIDTH * 2, 1.5, COLOR.concrete);
    strip(b, at(i, 0, .15), at(i + 1, 0, .15), JR_HALF_WIDTH * 2 - 1, .3, COLOR.ballast);
    for (const off of [-2, 2]) for (const lat of [-.5335, .5335]) strip(b, at(i, off + lat, .4), at(i + 1, off + lat, .4), .07, .14, COLOR.rail);
    for (const off of [-JR_HALF_WIDTH + .15, JR_HALF_WIDTH - .15]) strip(b, at(i, off, .7), at(i + 1, off, .7), .3, 1.3, g ? COLOR.girder : COLOR.concrete);
    // 地面に近い区間は築堤（盛土）
    if (!g && groundGap < 4) {
      const yy = (W[i].y + W[i + 1].y) / 2 - 1.5, h = yy - GROUND;
      if (h > .1) { const a = at(i, 0, 0), z = at(i + 1, 0, 0), m = a.clone().add(z).multiplyScalar(.5); b.add('air', P.boxB, M(m.x, GROUND, m.z, Math.atan2(z.x - a.x, z.z - a.z), JR_HALF_WIDTH * 2 + 6, h, a.distanceTo(z) + .1), 0x8e9a7e); }
    }
  }
  // 橋脚（経路 30m ごと。本線の高架の左右の外に 1 組ずつ置く）
  let acc = 30;
  const pierAt = (i: number) => {
    const d = dir(i), bottom = W[i].y - 1.5 - 1.1;
    const h = bottom - GROUND;
    if (h < 4) return;
    for (const off of [-3, 3]) b.add('air', P.boxB, M(W[i].x + d.nx * off, GROUND, W[i].z + d.nz * off, Math.atan2(d.nx, d.nz), 2, h, 2), COLOR.concrete);
    b.add('air', P.box, M(W[i].x, bottom + .3, W[i].z, Math.atan2(d.nx, d.nz), 2.2, 1.2, JR_HALF_WIDTH * 2 + .6), COLOR.concrete);
  };
  const iL = pts.findIndex(p => p.lat >= pierL - 1), iR = pts.findIndex(p => p.lat >= pierR - 1);
  if (iL > 0) pierAt(iL - 1);
  if (iR > 0) pierAt(iR);
  for (let i = 1; i + 1 < pts.length; i++) {
    acc += Math.hypot(W[i].x - W[i - 1].x, W[i].z - W[i - 1].z);
    if (acc < 30 || over(i) || Math.abs(pts[i].lat - pierL) < 12 || Math.abs(pts[i].lat - pierR) < 12) continue;
    acc = 0; pierAt(i);
  }
  // 架線柱（40m ごと、両側交互）と架線 2 本
  const wire: number[] = [];
  const prev: (THREE.Vector3 | null)[] = [null, null];
  let accP = 30, side = 1;
  for (let i = 0; i < pts.length; i++) {
    if (i) accP += Math.hypot(W[i].x - W[i - 1].x, W[i].z - W[i - 1].z);
    [-2, 2].forEach((off, k) => {
      const c = at(i, off, 5.74);
      if (prev[k]) wire.push(prev[k]!.x, prev[k]!.y, prev[k]!.z, c.x, c.y, c.z);
      prev[k] = c;
    });
    if (accP >= 40 && i > 0 && i + 1 < pts.length && !over(i) && W[i].y - GROUND > 8) {
      accP = 0; side = -side;
      const off = side * (JR_HALF_WIDTH - .7);
      beam(b, at(i, off, 0), at(i, off, 7), .28, COLOR.pole);
      beam(b, at(i, off, 6.6), at(i, -side * 2, 6.6), .1, COLOR.pole);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  const wires = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x24272a, fog: true })); wires.name = 'catenary-wire';
  ctx.scene.add(wires); cullByDistance(ctx, wires, 2200);
}

/** ctx は下りの座標（world/down-frame.ts）。空港線の高架（s 470〜）と JR の橋を描く */
export function buildIzumisanoAirport(ctx: GameContext): void {
  const g = airportGeometry(ctx.track);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const groups: [string, AirPt[], (b: GeoBatch) => void, number][] = [
    ['airport-down', g.ad, b => elevatedLine(ctx, b, g.ad, { poleSide: -1, keepOut: [-9.5, 13.5] }), 1500],
    ['airport-up', g.au, b => elevatedLine(ctx, b, g.au, { poleSide: 1, keepOut: [-9.5, 13.5] }), 1500],
    ['jr-kansai-airport', g.jr, b => jrBridge(ctx, b, g.jr), 2400],
  ];
  for (const [name, , build, far] of groups) {
    const batch = new GeoBatch(), group = new THREE.Group(); group.name = name;
    build(batch);
    batch.build({ air: mat }, group);
    ctx.scene.add(group); cullByDistance(ctx, group, far);
  }
}
