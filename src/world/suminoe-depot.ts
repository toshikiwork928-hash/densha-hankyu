// 南海本線 堺〜難波（route.id = 'namba'）専用: 住ノ江検車区（住ノ江駅の西側・本線と同じ高さの高架の車庫）
// 構成: 入出庫線(depot-lead, s3440 lat-16)から斜めの引上げ線(ladder)で扇状に 留置線9本＋検修庫の3線 が分かれる。
// 静的な形状は buildSuminoeDepot、留置車両（DOM のキャンバスを使う）は buildSuminoeDepotTrains（建築限界検査には含めない）。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { GeoBatch, M, onLight, P } from './batch';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { coastalDeckBounds } from './structures';
import { getTerrain } from './terrain';
import { extrudeFn } from './track-mesh';
import { bogieOffset, createTrainSet, setTrainNight } from './train-models';
import type { TrainKind } from '../route/types';

const GAUGE = .535;
const S_LEAD = 3440;          // 入出庫線との接続点（lat -16）
const S_BUMP = 3080;          // 留置線の車止めの側
const S_SHED_BUMP = 3094;     // 検修庫の線の車止め
const SLOPE = .42;            // 引上げ線の勾配（lat/s）
const EASE = 16;              // 入口の緩和区間 [m]
const LAT0 = -16;
const PITCH = 4.6;
/** 各線の横位置: 留置線 0〜8（-16 … -52.8）、検修庫 9〜11（-73 …） */
const LATS = [...Array.from({ length: 9 }, (_, k) => LAT0 - PITCH * k), -73, -77.6, -82.2];
const N_STAB = 9;

/** 引上げ線の横位置（u = S_LEAD からの距離） */
const ladderLat = (u: number): number => LAT0 - (u < EASE ? SLOPE * u * u / (2 * EASE) : SLOPE * (u - EASE / 2));
/** k 番線が引上げ線から分かれる u */
const branchU = (k: number): number => k === 0 ? 0 : (Math.abs(LATS[k]) - 16) / SLOPE + EASE / 2;

interface Line { id: string; lat: (s: number) => number; from: number; to: number; bump?: number }
function lines(): { straight: Line[]; ladder: Line } {
  const straight = LATS.map((l, k): Line => {
    const bump = k < N_STAB ? S_BUMP : S_SHED_BUMP;
    return { id: `depot-${k}`, lat: () => l, from: bump, to: S_LEAD - branchU(k), bump };
  });
  const u1 = branchU(LATS.length - 1);
  return { straight, ladder: { id: 'depot-ladder', lat: s => ladderLat(S_LEAD - s), from: S_LEAD - u1, to: S_LEAD - 5 } };
}

const S_SHED_E = S_LEAD - branchU(LATS.length - 1) - 12;   // 検修庫の東端
const S_SHED_W = 3090;
const SLAB_W = 3070, SLAB_E = S_LEAD + .5;
const SHED_L0 = -69.5, SHED_L1 = -87;

/** 床版の左縁（検修庫・付属棟の所は -100、東は引上げ線に沿う） */
function slabLeft(s: number): number {
  const base = ladderLat(Math.max(0, Math.min(S_LEAD - s, branchU(LATS.length - 1) + 10))) - 3.6;
  const x = Math.max(0, Math.min(1, (S_SHED_E + 30 - s) / 26)), w = x * x * (3 - 2 * x);
  return base * (1 - w) + -100 * w;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildSuminoeDepot(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  const { track, scene } = ctx, T = getTerrain(ctx);
  const root = new THREE.Group(); root.name = 'suminoe-depot';
  const concrete = new THREE.MeshLambertMaterial({ color: 0xc4c0b6, side: THREE.DoubleSide });
  const matBallast = new THREE.MeshLambertMaterial({ color: 0x8a8378, side: THREE.DoubleSide });
  const matRail = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: .8, roughness: .35, side: THREE.DoubleSide });
  const matSleeper = new THREE.MeshLambertMaterial({ color: 0x6b6259 });
  const matBatch = new THREE.MeshLambertMaterial({ vertexColors: true });
  const bounds = coastalDeckBounds(ctx);
  const { straight, ladder } = lines();
  const all = [...straight, ladder];
  const batch = new GeoBatch();
  const boxAt = (key: string, s: number, lat: number, y: number, w: number, h: number, d: number, color: number) => {
    const p = track.at(s, lat, y), t = track.trackAt(s);
    batch.add(key, P.boxB, M(p.x, p.y, p.z, -t.phi, w, h, d), color);
  };

  // --- 床版（本線の床版の左縁から、留置線・検修庫の外まで）と低い高欄
  const right = (s: number) => bounds(s)[0];
  root.add(extrudeFn(track, s => { const a = slabLeft(s), b = right(s); return [[a, .0], [a, -1.1], [b, -1.1], [b, .0]]; }, SLAB_W, SLAB_E, 4, concrete));
  root.add(extrudeFn(track, s => [[slabLeft(s), .0], [right(s), .0]], SLAB_W, SLAB_E, 4, concrete));
  root.add(extrudeFn(track, s => { const a = slabLeft(s); return [[a, .0], [a, .6], [a + .25, .6], [a + .25, .0]]; }, SLAB_W, SLAB_E, 4, concrete));
  // 西の端: 床版の断面（棟梁）と高欄
  for (const sc of [SLAB_W + .4]) {
    const a = slabLeft(sc), b = right(sc), c = (a + b) / 2;
    boxAt('c', sc, c, -1.1, b - a, 1.1, .8, 0xc4c0b6); boxAt('c', sc, c, 0, b - a, .6, .25, 0xc4c0b6);
  }
  // 柱（16m 格子）と横梁
  for (let s = SLAB_W + 8; s <= SLAB_E; s += 16) {
    const R = right(s), Lf = slabLeft(s), g = T.groundY(s) - .5, top = track.at(s, 0, -2.1).y, h = top - g;
    if (R - Lf > 6) boxAt('c', s, (R + Lf) / 2, -2.1, R - Lf, 1.0, 1.1, 0xb9b5ab);
    if (h < .3) continue;
    const cols: number[] = [];
    for (let l = R - 2.5; l > Lf + 2; l -= 16) cols.push(l);
    cols.push(Lf + 1.6);
    for (const l of cols) { const p = track.at(s, l, 0), t = track.trackAt(s); batch.add('c', P.boxB, M(p.x, g, p.z, -t.phi, 1.1, h, 1.1), 0xbdb9af); }
  }

  // --- 線路（バラスト・レール）
  for (const l of all) {
    root.add(extrudeFn(track, s => { const m = l.lat(s); return [[m - 2.3, 0], [m - 1.4, .215], [m + 1.4, .215], [m + 2.3, 0]]; }, l.from, l.to, l === ladder ? 2 : 6, matBallast));
    for (const g of [-GAUGE, GAUGE])
      root.add(extrudeFn(track, s => { const r = l.lat(s) + g + (l === ladder ? .002 : 0); return [[r - .035, .243], [r - .035, .383], [r + .035, .383], [r + .035, .243]]; }, l.from, l.to, l === ladder ? 1.5 : 6, matRail));
  }
  // 枕木（他の線と重なる所は省く）
  const sleeperGeo = new THREE.BoxGeometry(2.0, .14, .22);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  for (const l of all) {
    const n = Math.ceil((l.to - l.from) / .65) + 1, inst = new THREE.InstancedMesh(sleeperGeo, matSleeper, n);
    let i = 0;
    for (let s = l.from; s < l.to && i < n; s += .65) {
      const a = l.lat(s);
      if (l === ladder && straight.some(o => s >= o.from && s <= o.to && Math.abs(o.lat(s) - a) < 1.3)) continue;
      const t = track.trackAt(s), slope = l.lat(s + .5) - l.lat(s - .5);
      q.setFromEuler(e.set(0, -t.phi - Math.atan(slope), 0));
      inst.setMatrixAt(i++, m4.compose(track.at(s, a, .27), q, one));
    }
    inst.count = i; inst.computeBoundingSphere(); root.add(inst);
  }
  // 車止め
  const red = new THREE.MeshLambertMaterial({ color: 0xc8322a }), white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d52 });
  const redLamp = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  for (const l of straight) {
    const s = l.bump! + 1.2, t = track.trackAt(s), grp = new THREE.Group();
    grp.name = 'track-bumper'; grp.userData.clearanceExempt = 'rail-stop';
    grp.position.copy(track.at(s, l.lat(s), 0)); grp.rotation.y = -t.phi;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, .5, .35), red); beam.position.set(0, 1.0, 0); grp.add(beam);
    for (const x of [-.6, .6]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(.4, .52, .37), white); st.position.set(x, 1.0, 0); grp.add(st);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.3, .12), steel); leg.position.set(x * 1.4, .6, -.5); leg.rotation.x = .5; grp.add(leg);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.25, .25, .1), redLamp); lamp.position.set(0, 1.5, -.2); grp.add(lamp);
    root.add(grp);
  }

  // --- 検修庫（切妻屋根）と付属棟
  const WALL_H = 9, wallC = 0xd9d6cc, roofC = 0x6d7a86;
  const shedW = SHED_L0 - SHED_L1, shedC = (SHED_L0 + SHED_L1) / 2;
  for (let s0 = S_SHED_W; s0 < S_SHED_E; s0 += 18) {
    const s1 = Math.min(S_SHED_E, s0 + 18), sc = (s0 + s1) / 2, len = s1 - s0 + .5;
    boxAt('c', sc, SHED_L0 - .15, 0, .3, WALL_H, len, wallC);
    boxAt('c', sc, SHED_L1 + .15, 0, .3, WALL_H, len, wallC);
    // 腰の帯（窓風）
    boxAt('s', sc, SHED_L0 + .05, 5.2, .1, 1.3, len - 1.2, 0x39485a);
    boxAt('s', sc, SHED_L1 - .05, 5.2, .1, 1.3, len - 1.2, 0x39485a);
    const p = track.at(sc, shedC, WALL_H), t = track.trackAt(sc);
    batch.add('r', P.gable, M(p.x, p.y, p.z, -t.phi, shedW + 1.4, 3.6, len), roofC);
    // 柱と梁（庫内）
    boxAt('c', sc, SHED_L0 + .6, 0, .5, WALL_H, .5, 0xb0ada3);
    boxAt('c', sc, SHED_L1 - .6, 0, .5, WALL_H, .5, 0xb0ada3);
  }
  boxAt('c', S_SHED_W + .3, shedC, 0, shedW, WALL_H, .6, wallC);
  {
    const p = track.at(S_SHED_W + .3, shedC, WALL_H), t = track.trackAt(S_SHED_W);
    batch.add('r', P.gable, M(p.x, p.y, p.z, -t.phi, shedW + 1.4, 3.6, .7), 0xcfcbc0);
  }
  // 付属棟（検修庫の南側: 部品庫・事務所）
  const AN0 = 3100, AN1 = S_SHED_E - 8, anC = (SHED_L1 - 11.2 + SHED_L1 - .5) / 2;
  for (let s0 = AN0; s0 < AN1; s0 += 25) {
    const s1 = Math.min(AN1, s0 + 25), sc = (s0 + s1) / 2, len = s1 - s0 + .4;
    boxAt('c', sc, anC, 0, 10.7, 5.6, len, 0xbdb7a8);
    boxAt('c', sc, anC, 5.6, 11.0, .35, len, 0x9a978e);
    boxAt('s', sc, SHED_L1 - 11.2 - .05, 2.4, .1, 1.2, len - 2, 0x39485a);
  }
  // 上り側の本線から見える引込み線沿いの設備（給油・洗浄小屋）
  boxAt('c', 3340, -12, 0, 2.4, 2.6, 5, 0xa9b0a2);
  boxAt('c', 3300, -11.4, 0, 2, 2.2, 3.5, 0xb9a98d);

  // --- 架線柱（門型）と架線（留置線の上だけ。軽量）
  const polePos: number[] = [];
  for (let s = 3100; s <= 3300; s += 50) polePos.push(s);
  const LP = LATS[N_STAB - 1] - 3.2;
  for (const s of polePos) {
    const a = -9.8, b = LP, t = track.trackAt(s);
    for (const l of [a, b]) { const p = track.at(s, l, 0); batch.add('s', P.boxB, M(p.x, p.y, p.z, -t.phi, .32, 7.2, .32), 0x7d8286); }
    boxAt('s', s, (a + b) / 2, 6.9, a - b, .3, .3, 0x7d8286);
    boxAt('s', s, (a + b) / 2, 6.3, a - b, .12, .12, 0x7d8286);
  }
  const wirePts: number[] = [];
  for (let k = 0; k < N_STAB; k++) {
    const l = straight[k], lat = l.lat(0), top = Math.min(l.to - 8, 3300);
    let prev: THREE.Vector3 | null = null, i = 0;
    for (let s = S_BUMP + 6; s <= top; s += 12, i++) {
      const p = track.at(s, lat + (i % 2 ? .2 : -.2), 5.35);
      if (prev) wirePts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p.clone();
    }
  }
  const wire = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3)), new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
  wire.name = 'catenary-wire'; root.add(wire);

  // --- 照明灯（構内: 東西の縁に 40m ごと、庫内: 各線の上）。夜に明るくする
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
  const lamps: THREE.Matrix4[] = [];
  const addLamp = (s: number, lat: number, y: number, w: number, d: number) => {
    const p = track.at(s, lat, y), t = track.trackAt(s);
    lamps.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t.phi, 0)), new THREE.Vector3(w, .16, d)));
  };
  for (let s = 3092; s <= 3420; s += 40) {
    const edge = ladderLat(Math.max(0, S_LEAD - s)) - 3;
    const lats: [number, number][] = [[-11.4, -1.1]];
    if (s <= S_SHED_E + 20) lats.push([LP - .2, 1.1]); else lats.push([edge, 1.1]);
    for (const [l, dir] of lats) {
      const p = track.at(s, l, 0), t = track.trackAt(s);
      batch.add('s', P.boxB, M(p.x, p.y, p.z, -t.phi, .22, 11, .22), 0x6e7377);
      addLamp(s, l + dir, 11.1, 1.4, .5);
    }
  }
  for (let k = N_STAB; k < LATS.length; k++) for (let s = S_SHED_W + 8; s < S_SHED_E - 4; s += 12) addLamp(s, LATS[k], 8.3, .5, 1.6);
  if (lamps.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lampMat, lamps.length);
    lamps.forEach((m, i) => im.setMatrixAt(i, m)); im.computeBoundingSphere(); im.userData.noShadow = true; root.add(im);
  }
  onLight(ctx, (n, t) => { lampMat.color.setHex(0xffe2b0).multiplyScalar(.3 + .7 * Math.max(n, t)); });

  batch.build({ c: matBatch, s: matBatch, r: matBatch }, root);
  scene.add(root);
  cullByDistance(ctx, root, 800);
}

interface Parked { track: number; kind: TrainKind; cars: number; units: number[]; gap: number }
// 留置線の編成（空き: 0 番線＝入出庫の本線、4・7 番線）。gap = 車止めからの余裕 [m]
const PARKED: Parked[] = [
  { track: 1, kind: 'commuter-new', cars: 4, units: [4], gap: 7 },
  { track: 2, kind: 'commuter-old', cars: 6, units: [6], gap: 12 },
  { track: 3, kind: 'limited', cars: 6, units: [6], gap: 6 },
  { track: 5, kind: 'southern-10000', cars: 4, units: [4], gap: 20 },
  { track: 6, kind: 'commuter-new', cars: 8, units: [4, 4], gap: 8 },
  { track: 8, kind: 'commuter-old', cars: 4, units: [4], gap: 15 },
  { track: 9, kind: 'commuter-new', cars: 4, units: [4], gap: 14 },   // 検修庫の中
];

/** 検車区に留置している編成（描画のみ）。車両生成は DOM を使うので world/index.ts からだけ呼ぶ（建築限界検査には含めない） */
export function buildSuminoeDepotTrains(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  const rand = rng(0x5a3d17), { straight } = lines();
  const a = new THREE.Vector3(), z = new THREE.Vector3();
  const group = new THREE.Group(); group.name = 'oncoming-suminoe-depot';
  for (const p of PARKED) {
    const ln = straight[p.track], lat = ln.lat(0);
    const cars = createTrainSet(p.kind, p.cars, ctx.renderer, { dest: '', label: '回送', units: p.units });
    const total = cars.reduce((sum, c) => sum + c.length, 0);
    // 車止めの側に後尾、進行方向（+s）が入出庫線の側
    let cur = ln.from + 4 + p.gap + rand() * 3 + total;
    for (const c of cars) {
      const sc = cur - c.length / 2, bog = bogieOffset(c.length);
      a.copy(ctx.track.at(sc + bog, lat, .38)); z.copy(ctx.track.at(sc - bog, lat, .38));
      placeCar(c.object, a, z); group.add(c.object);
      c.setDoors(false);
      cur -= c.length;
    }
  }
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));
  ctx.scene.add(group); cullByDistance(ctx, group, 600);
}
