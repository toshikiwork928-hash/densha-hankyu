// 泉佐野〜みさき公園コース（route.id = 'izumisano-misaki' / '-up'）専用: 羽倉崎検車区（羽倉崎駅の樽井寄り、進行方向左の山側。地上）。
// 平面形は route/routes/hagurazaki-depot.ts（下りの座標。上りは world/down-frame.ts の写しで同じ物理位置）。
// 構成: 羽倉崎駅の 1番線（route.extraTracks の引上げ線）→ 梯子線（斜め）→ 留置線 13本（南西端が車止め）、検修庫（留置線の南西側 5本が入る）、洗浄線の屋根、事務棟、柵、照明。
// 建物の形・色・高さ、構内の線路が何番線までかは不明（資料に無い）。ゲーム用の概形で、実測値ではない。ctx.rng は使わない。
// 静的な形状は buildHagurazakiDepot、留置車両（DOM のキャンバスを使う）は buildHagurazakiDepotTrains（建築限界検査には含めない）。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { TrainKind } from '../route/types';
import { DEPOT, ladderLat, yardBranchS, yardLat } from '../route/routes/hagurazaki-depot';
import { GeoBatch, M, onLight, P } from './batch';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { extrudeFn } from './track-mesh';
import { bogieOffset, createTrainSet, setTrainNight } from './train-models';

const GAUGE = .535;
/** 地面の高さ（泉佐野〜みさき公園コースは地面 0。羽倉崎付近は線路も 0） */
const GROUND = 0;
const N = DEPOT.count;
const SHED_L0 = yardLat(DEPOT.shedFrom - 1) - DEPOT.pitch / 2, SHED_L1 = yardLat(N - 1) - DEPOT.pitch / 2;

interface Line { id: string; lat: (s: number) => number; from: number; to: number; bump?: number }
function lines(): { yard: Line[]; ladder: Line } {
  const yard = Array.from({ length: N }, (_, k): Line => ({ id: `yard-${k}`, lat: () => yardLat(k), from: yardBranchS(k), to: DEPOT.bumper, bump: DEPOT.bumper }));
  return { yard, ladder: { id: 'yard-ladder', lat: ladderLat, from: DEPOT.ladderS, to: yardBranchS(N - 1) + 4 } };
}

export function buildHagurazakiDepot(ctx: GameContext): void {
  const { track, scene } = ctx;
  const root = new THREE.Group(); root.name = 'hagurazaki-depot';
  const matBallast = new THREE.MeshLambertMaterial({ color: 0x8a8378, side: THREE.DoubleSide });
  const matRail = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: .8, roughness: .35, side: THREE.DoubleSide });
  const matSleeper = new THREE.MeshLambertMaterial({ color: 0x6b6259 });
  const matBatch = new THREE.MeshLambertMaterial({ vertexColors: true });
  const { yard, ladder } = lines();
  const all = [...yard, ladder];
  const batch = new GeoBatch();
  /** 局所座標の箱: s・横位置・高さ（底面）と、横幅 w・高さ h・s 方向の長さ d */
  const boxAt = (key: string, s: number, lat: number, y: number, w: number, h: number, d: number, color: number) => {
    const p = track.at(s, lat, y), t = track.trackAt(s);
    batch.add(key, P.boxB, M(p.x, p.y, p.z, -t.phi, w, h, d), color);
  };

  // --- 構内の地面（砕石）: 梯子線の北東側も含めた矩形
  for (let s = DEPOT.ladderS - 4; s < DEPOT.fenceSouth; s += 60) {
    const len = Math.min(60, DEPOT.fenceSouth - s), sc = s + len / 2, a = -7, b = DEPOT.fenceLat + 1.5;
    boxAt('g', sc, (a + b) / 2, GROUND + .005 - track.trackAt(sc).y, a - b, .035, len + .2, 0x9c978c);
  }

  // --- 線路（バラスト・レール）と枕木
  for (const l of all) {
    const step = l === ladder ? 2 : 8;
    root.add(extrudeFn(track, s => { const m = l.lat(s); return [[m - 2.3, 0], [m - 1.4, .215], [m + 1.4, .215], [m + 2.3, 0]]; }, l.from, l.to, step, matBallast));
    for (const g of [-GAUGE, GAUGE])
      root.add(extrudeFn(track, s => { const r = l.lat(s) + g + (l === ladder ? .002 : 0); return [[r - .035, .243], [r - .035, .383], [r + .035, .383], [r + .035, .243]]; }, l.from, l.to, l === ladder ? 1.5 : 6, matRail));
  }
  {
    const sleeperGeo = new THREE.BoxGeometry(2.0, .14, .22);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    for (const l of all) {
      const n = Math.ceil((l.to - l.from) / .65) + 1, inst = new THREE.InstancedMesh(sleeperGeo, matSleeper, n);
      let i = 0;
      for (let s = l.from; s < l.to && i < n; s += .65) {
        const a = l.lat(s);
        // 梯子線は、留置線と重なる所の枕木を省く
        if (l === ladder && yard.some(o => s >= o.from && Math.abs(o.lat(s) - a) < 1.3)) continue;
        const t = track.trackAt(s), slope = l.lat(s + .5) - l.lat(s - .5);
        q.setFromEuler(e.set(0, -t.phi - Math.atan(slope), 0));
        inst.setMatrixAt(i++, m4.compose(track.at(s, a, .27), q, one));
      }
      inst.count = i; inst.computeBoundingSphere(); root.add(inst);
    }
  }
  // 車止め（線路の南西端を塞ぐので建築限界検査の対象外）
  {
    const red = new THREE.MeshLambertMaterial({ color: 0xc8322a }), white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
    const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d52 }), redLamp = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    for (const l of yard) {
      const s = l.bump! - 1.2, t = track.trackAt(s), grp = new THREE.Group();
      grp.name = 'track-bumper'; grp.userData.clearanceExempt = 'rail-stop';
      grp.position.copy(track.at(s, l.lat(s), 0)); grp.rotation.y = -t.phi;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, .5, .35), red); bar.position.set(0, 1.0, 0); grp.add(bar);
      for (const x of [-.6, .6]) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(.4, .52, .37), white); st.position.set(x, 1.0, 0); grp.add(st);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.3, .12), steel); leg.position.set(x * 1.4, .6, .5); leg.rotation.x = -.5; grp.add(leg);
      }
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(.25, .25, .1), redLamp); lamp.position.set(0, 1.5, .2); grp.add(lamp);
      root.add(grp);
    }
  }

  // --- 検修庫（留置線の南西側 5本が入る。北東側は開口）
  const WALL_H = 7, wallC = 0xd9d6cc, roofC = 0x6d7a86;
  {
    const shedW = SHED_L0 - SHED_L1, shedC = (SHED_L0 + SHED_L1) / 2;
    for (let s0 = DEPOT.shedS0; s0 < DEPOT.shedS1; s0 += 18) {
      const s1 = Math.min(DEPOT.shedS1, s0 + 18), sc = (s0 + s1) / 2, len = s1 - s0 + .5;
      boxAt('c', sc, SHED_L0, 0, .3, WALL_H, len, wallC);
      boxAt('c', sc, SHED_L1, 0, .3, WALL_H, len, wallC);
      boxAt('s', sc, SHED_L0 + .05, 4.4, .1, 1.2, len - 1.2, 0x39485a);
      boxAt('s', sc, SHED_L1 - .05, 4.4, .1, 1.2, len - 1.2, 0x39485a);
      boxAt('r', sc, shedC, WALL_H, shedW + 1.4, 3.4, len, roofC);
      boxAt('c', sc, SHED_L0 + .6, 0, .5, WALL_H, .5, 0xb0ada3);
      boxAt('c', sc, SHED_L1 - .6, 0, .5, WALL_H, .5, 0xb0ada3);
    }
    boxAt('c', DEPOT.shedS1 - .3, shedC, 0, shedW, WALL_H, .6, wallC);
    // 北東の口の門型の柱と梁
    for (const l of [SHED_L0, SHED_L1]) boxAt('c', DEPOT.shedS0 - .3, l, 0, .8, WALL_H + .6, .8, 0xb9b5ab);
    boxAt('c', DEPOT.shedS0 - .3, shedC, WALL_H - .6, shedW, 1.2, .8, 0xb9b5ab);
  }
  // 洗浄線の屋根（留置線 3・4番の上。柱は線路の間）
  {
    const c = (yardLat(3) + yardLat(4)) / 2, cols = [yardLat(2) - DEPOT.pitch / 2, yardLat(4) - DEPOT.pitch / 2];
    boxAt('r', 2735, c, 6.2, DEPOT.pitch * 3 + .6, .3, 70, 0x8b949c);
    for (let s = 2704; s <= 2766; s += 15.5) for (const l of cols) boxAt('c', s, l, 0, .4, 6.3, .4, 0xaeb0a8);
    boxAt('c', 2735, c, 0, DEPOT.pitch * 3 - 1, .05, 70, 0x9a9990);
  }
  // 事務・乗務員棟と倉庫（梯子線の北東側の空き地）
  boxAt('c', 2412, -52, 0, 11, 6, 40, 0xe2ded4); boxAt('s', 2412, -52, 6, 11.6, .35, 40.6, 0x7b8790); boxAt('s', 2412, -46.4, 2.6, .1, 1.2, 36, 0x39485a);
  boxAt('c', 2468, -50, 0, 9, 4.6, 24, 0xcfc9bb); boxAt('s', 2468, -50, 4.6, 9.6, .3, 24.6, 0x7b8790);
  boxAt('c', 2500, -63, 0, 7, 3.4, 12, 0xb9b5a8); boxAt('s', 2500, -63, 3.4, 7.4, .25, 12.4, 0x6d7a86);

  // --- 柵（東・南・西）と、柱
  {
    const post = (s: number, lat: number) => boxAt('f', s, lat, 0, .08, 1.9, .08, 0x8a9096);
    const side = (lat: number, s0: number, s1: number) => {
      for (let s = s0; s <= s1; s += 3) post(s, lat);
      for (let s = s0; s < s1; s += 30) {
        const len = Math.min(30, s1 - s) + .1;
        boxAt('f', s + len / 2 - .05, lat, 1.85, .06, .08, len, 0x8a9096);
        boxAt('f', s + len / 2 - .05, lat, .25, .02, 1.5, len, 0x9fb0a8);
      }
    };
    side(DEPOT.fenceLat, DEPOT.fenceNorth, DEPOT.fenceSouth);
    side(DEPOT.fenceWest, 2330, DEPOT.fenceSouth);
    for (let l = DEPOT.fenceLat; l <= DEPOT.fenceWest; l += 3) post(DEPOT.fenceSouth, l);
    for (let l = DEPOT.fenceLat; l < DEPOT.fenceWest; l += 30) {
      const len = Math.min(30, DEPOT.fenceWest - l) + .1;
      boxAt('f', DEPOT.fenceSouth, l + len / 2 - .05, 1.85, len, .08, .06, 0x8a9096);
    }
  }

  // --- 照明灯（構内の通路に 45m ごと）。夜に明るくする
  {
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
    const lamps: THREE.Matrix4[] = [];
    // 留置線の間の通路（1・2番の間と 4・5番の間）。梯子線が横切る範囲と洗浄線の屋根の柱は避ける
    for (let s = 2490; s <= 3080; s += 45) for (const lat of [yardLat(1) - DEPOT.pitch / 2, yardLat(4) - DEPOT.pitch / 2]) {
      if (s > 2690 && s < 2780) continue;
      boxAt('s', s, lat, 0, .22, 10, .22, 0x6e7377);
      const p = track.at(s, lat + 1, 10.1), t = track.trackAt(s);
      lamps.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t.phi, 0)), new THREE.Vector3(1.4, .16, .5)));
    }
    if (lamps.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lampMat, lamps.length);
      lamps.forEach((m, i) => im.setMatrixAt(i, m)); im.computeBoundingSphere(); im.userData.noShadow = true; root.add(im);
    }
    onLight(ctx, (n, t) => { lampMat.color.setHex(0xffe2b0).multiplyScalar(.3 + .7 * Math.max(n, t)); });
  }

  batch.build({ g: matBatch, c: matBatch, s: matBatch, r: matBatch, f: matBatch }, root);
  scene.add(root);
  cullByDistance(ctx, root, 1300);
}

interface Parked { track: number; kind: TrainKind; units: number[]; /** 車止めから先頭までの余裕 [m] */ gap: number; label: string }
// 留置線の編成（7100系・8300系・1000系。空きの線もある）。公式の留置状況は不明で、ゲーム用の配置
const PARKED: Parked[] = [
  { track: 1, kind: 'commuter-new', units: [4, 4], gap: 30, label: '回送' },
  { track: 2, kind: 'commuter-old', units: [4, 2], gap: 70, label: '回送' },
  { track: 4, kind: 'commuter-1000', units: [6], gap: 18, label: '回送' },
  { track: 5, kind: 'commuter-new', units: [4], gap: 120, label: '回送' },
  { track: 6, kind: 'commuter-old', units: [4], gap: 40, label: '回送' },
  { track: 8, kind: 'commuter-new', units: [4, 4], gap: 14, label: '回送' },
  { track: 10, kind: 'commuter-old', units: [4], gap: 22, label: '回送' },
  { track: 12, kind: 'commuter-new', units: [4], gap: 30, label: '回送' },
];

/** 検車区に留置している編成（描画のみ）。車両生成は DOM を使うので world/index.ts からだけ呼ぶ（建築限界検査には含めない） */
export function buildHagurazakiDepotTrains(ctx: GameContext): void {
  const a = new THREE.Vector3(), z = new THREE.Vector3();
  const group = new THREE.Group(); group.name = 'oncoming-hagurazaki-depot';
  for (const p of PARKED) {
    const lat = yardLat(p.track);
    const cars = createTrainSet(p.kind, p.units.reduce((x, y) => x + y, 0), ctx.renderer, { dest: '', label: p.label, units: p.units });
    // 先頭を車止めの側（s の増える向き）へ、後ろへ連ねる
    let cur = DEPOT.bumper - 4 - p.gap;
    for (const c of cars) {
      const sc = cur - c.length / 2, bog = bogieOffset(c.length);
      a.copy(ctx.track.at(sc + bog, lat, .38)); z.copy(ctx.track.at(sc - bog, lat, .38));
      placeCar(c.object, a, z); group.add(c.object);
      c.setDoors(false);
      cur -= c.length;
    }
  }
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));
  ctx.scene.add(group); cullByDistance(ctx, group, 700);
}
