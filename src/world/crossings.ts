// 踏切（route.crossings）: 道路・遮断機・警報灯・踏切警標。自列車/対向列車の接近で鳴動し crossing イベントを出す
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { GeoBatch, M, P, basePart, onLight } from './batch';
import { glowTexture } from './emu';
import { cullByDistance } from './cull';
import type { OncomingSystem } from './oncoming';
import { getTerrain, gridAlong } from './terrain';

const APPROACH = 600; // 自列車の鳴動開始距離 [m]
const ONCOMING_APPROACH = 450;
const ARM_DELAY = 3, ARM_TIME = 4.5;

interface CrossingRt {
  id: string; s: number; w: number;
  active: boolean; t: number; arm: number; emitT: number;
  arms: THREE.Object3D[]; lensA: THREE.MeshBasicMaterial; lensB: THREE.MeshBasicMaterial;
  glowA: THREE.Sprite[]; glowB: THREE.Sprite[]; glowMat: THREE.SpriteMaterial; car: THREE.Object3D;
}

const YEL = 0xf2c200, BLK = 0x1a1a1a;
const LENS = basePart(new THREE.CircleGeometry(.15, 16));

/** 遮断機・警報機1基（ローカル: -x = 道路の外向き, -z = 遮断かんが伸びる向き, 原点 = 地面） */
function buildMachine(withArm: boolean, armLen: number, lensA: THREE.Material, lensB: THREE.Material, glowA: THREE.Sprite[], glowB: THREE.Sprite[], glowMat: THREE.SpriteMaterial): { grp: THREE.Group; arm?: THREE.Object3D } {
  const grp = new THREE.Group(), b = new GeoBatch();
  // 柱（下部は黄黒しま）
  b.add('body', P.cyl, M(0, 1.9, 0, 0, .13, 3.8, .13), 0x30343a);
  for (let i = 0; i < 6; i++) b.add('body', P.cyl, M(0, .15 + i * .3, 0, 0, .15, .3, .15), i % 2 ? BLK : YEL);
  // 踏切警標（X）
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    b.add('body', P.box, M(0, 3.45, 0, 0, .05, 1.25, .26, a), BLK);
    b.add('body', P.box, M(0, 3.45, 0, 0, .07, 1.15, .18, a), YEL);
  }
  // 警報灯（外向き・内向きに各2灯）
  b.add('body', P.box, M(0, 2.65, 0, 0, .12, .1, 1.0), 0x222222);
  for (const dir of [-1, 1]) for (const dz of [-.38, .38]) {
    b.add('body', P.box, M(dir * .1, 2.65, dz, 0, .1, .4, .4), 0x111111);
    b.add('body', P.box, M(dir * .2, 2.78, dz, 0, .22, .04, .42), 0x111111); // ひさし
    const isA = dz < 0;
    b.add(isA ? 'lensA' : 'lensB', LENS, M(dir * .16, 2.65, dz, dir * Math.PI / 2));
    const sp = new THREE.Sprite(glowMat); sp.position.set(dir * .25, 2.65, dz); sp.scale.setScalar(1.6); sp.visible = false; grp.add(sp);
    (isA ? glowA : glowB).push(sp);
  }
  // 全方位警報灯
  b.add('body', P.cyl, M(0, 3.95, 0, 0, .22, .25, .22), 0xb01810);
  let arm: THREE.Object3D | undefined;
  if (withArm) {
    b.add('body', P.boxB, M(.35, 0, 0, 0, .4, 1.15, .4), YEL);
    b.add('body', P.box, M(.35, 1.0, 0, 0, .42, .15, .42), BLK);
    const ab = new GeoBatch(), seg = .5;
    for (let y = 0, i = 0; y < armLen; y += seg, i++) ab.add('body', P.box, M(0, y + seg / 2, 0, 0, .07, seg, .07), i % 2 ? BLK : YEL);
    ab.add('body', P.box, M(0, -.35, 0, 0, .1, .6, .1), 0x333333); // 釣り合いおもり
    const pivot = new THREE.Group(); pivot.position.set(.6, 1.0, 0);
    ab.build({ body: armMat }, pivot); grp.add(pivot); arm = pivot;
  }
  b.build({ body: bodyMat, lensA, lensB }, grp);
  return { grp, arm };
}

const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const armMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/** 待機中の乗用車（簡易） */
function buildCar(color: number): THREE.Group {
  const b = new GeoBatch(), g = new THREE.Group();
  b.add('body', P.boxB, M(0, .3, 0, 0, 1.7, .65, 4.2), color);
  b.add('body', P.boxB, M(0, .95, .2, 0, 1.5, .55, 2.2), color);
  b.add('body', P.boxB, M(0, 1.0, .2, 0, 1.52, .42, 2.0), 0x2a333c);
  for (const x of [-.75, .75]) for (const z of [-1.3, 1.3]) b.add('body', P.cyl, M(x, .32, z, 0, .62, .2, .62, 0, Math.PI / 2), 0x1a1a1a);
  for (const x of [-.6, .6]) b.add('body', P.box, M(x, .62, -2.11, 0, .3, .12, .02), 0xfff3d0);
  b.build({ body: bodyMat }, g);
  return g;
}

export function buildCrossings(ctx: GameContext, oncoming: OncomingSystem): void {
  const { scene, track, route, events } = ctx, T = getTerrain(ctx);
  const list = route.crossings ?? [];
  if (!list.length) return;
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x55575b });
  const lineMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const tr = route.tracks, L0 = Math.min(...tr), L1 = Math.max(...tr);
  const sideLat = [L0 - 3.6, L1 + 3.6];
  const rts: CrossingRt[] = [];

  for (const c of list) {
    const w = c.roadWidth ?? 6, g = T.groundY(c.s);
    // 路面（線路上はレール面まで持ち上げる）
    // 周囲の山（route.relief）がある所は、道路も山の斜面に沿わせる（山あいの踏切で道路が空中や地中に伸びない）
    const prof = (s: number): [number, number][] => {
      const roadY = T.groundY(s) + .03, railY = T.trackY(s) + .36;
      const at = (l: number): [number, number] => [l, roadY + T.reliefY(s, l)];
      if (c.foot) return [[L0 - 12, roadY], [L0 - 2.6, railY], [L1 + 2.6, railY], [L1 + 12, roadY]]; // 歩行者専用: 線路の脇までの短い通路
      return [at(-160), at(-80), at(-40), at(-20), [L0 - 6.5, roadY], [L0 - 2.6, railY], [L1 + 2.6, railY], [L1 + 6.5, roadY], at(20), at(40), at(80), at(164)];
    };
    scene.add(gridAlong(track, c.s - w / 2, c.s + w / 2, 1, prof, roadMat));
    // 踏切板（ゴム）
    const pad = gridAlong(track, c.s - w / 2 - .3, c.s + w / 2 + .3, 1, s => [[L0 - 1.2, T.trackY(s) + .375], [L1 + 1.2, T.trackY(s) + .375]], new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
    scene.add(pad);
    // 停止線・外側線
    const lines = new GeoBatch(), t = track.trackAt(c.s);
    for (const l of [L0 - 9, L1 + 9]) {
      const p = track.at(c.s, l, 0); lines.add('l', P.box, M(p.x, g + .045, p.z, -t.phi, .35, .02, w * .5 - .2, 0, 0), 0xffffff);
    }
    for (const side of [-1, 1]) for (let l = -150; l < 154; l += 2) {
      if (c.foot) break; // 歩行者専用の踏切には道路の外側線を描かない
      if (l > L0 - 3 && l < L1 + 3) continue;
      const p = track.at(c.s + side * (w / 2 - .25), l, 0);
      lines.add('l', P.box, M(p.x, g + .045, p.z, -t.phi, 1.9, .02, .12), 0xffffff);
    }
    lines.build({ l: lineMat }, scene);

    const lensA = new THREE.MeshBasicMaterial({ color: 0x3a0c08 }), lensB = lensA.clone();
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .5 });
    const glowA: THREE.Sprite[] = [], glowB: THREE.Sprite[] = [], arms: THREE.Object3D[] = [];
    const cg = new THREE.Group(); cg.name = 'crossing-' + c.id; scene.add(cg); // 機器一式（距離カリング単位）
    // 各側: 遮断機付き1基（手前側）＋警報機のみ1基（対角）
    sideLat.forEach((lat, k) => {
      const flip = k === 1;
      for (const withArm of [true, false]) {
        const ds = (withArm ? -1 : 1) * (flip ? -1 : 1) * (w / 2 + .7);
        const { grp, arm } = buildMachine(withArm, w + .6, lensA, lensB, glowA, glowB, glowMat);
        grp.position.copy(track.at(c.s + ds, lat, 0)); grp.position.y = g;
        grp.rotation.y = -track.trackAt(c.s).phi + (flip ? Math.PI : 0);
        cg.add(grp); if (arm) arms.push(arm);
      }
    });
    // 待機車両（鳴動中のみ表示）
    const car = buildCar([0xd8dde2, 0x2b2f36, 0x9a2020, 0x3a5a8a, 0xf0f0f0][rts.length % 5]);
    car.position.copy(track.at(c.s - w / 4, L0 - 12.5, 0)); car.position.y = g + .03;
    car.rotation.y = -track.trackAt(c.s).phi - Math.PI / 2; // 線路へ向く
    car.visible = false;
    if (!c.foot) cg.add(car); // 歩行者専用の踏切には車を出さない
    cullByDistance(ctx, cg, 1000);
    rts.push({ id: c.id, s: c.s, w, active: false, t: 0, arm: 0, emitT: 0, arms, lensA, lensB, glowA, glowB, glowMat, car });
  }

  const ON = new THREE.Color(0xff2a1a), OFF = new THREE.Color(0x3a0c08);
  let night = 0;
  onLight(ctx, n => { night = n; });
  events.on('reset', () => { for (const r of rts) { if (r.active) events.emit('crossing', { id: r.id, s: r.s, active: false, distance: r.s - ctx.state.train.s }); r.active = false; r.arm = 0; } });

  events.on('frame', ({ dt, time }) => {
    const { s, v } = ctx.state.train, running = ctx.state.state === 'run';
    const spans = oncoming.activeSpans();
    for (const r of rts) {
      const d = r.s - s, half = r.w / 2 + 2;
      const occupied = d <= half && s - route.trainLength <= r.s + half;
      const approach = running && d > 0 && d < APPROACH && (v > .5 || (r.active && d < 150));
      const onc = spans.some(o => (o.head > r.s - half && o.head - r.s < ONCOMING_APPROACH) || (o.head <= r.s + half && o.tail >= r.s - half));
      const act = occupied || approach || onc;
      if (act !== r.active) {
        r.active = act; r.t = 0; r.emitT = 0;
        events.emit('crossing', { id: r.id, s: r.s, active: act, distance: d });
        r.car.visible = act;
      }
      r.t += dt;
      if (r.active) {
        r.emitT -= dt;
        if (r.emitT <= 0) { r.emitT = .2; events.emit('crossing', { id: r.id, s: r.s, active: true, distance: d }); }
        if (r.t > ARM_DELAY) r.arm = Math.min(1, r.arm + dt / ARM_TIME);
      } else r.arm = Math.max(0, r.arm - dt / ARM_TIME);
      for (const a of r.arms) a.rotation.x = -Math.PI / 2 * (r.arm * r.arm * (3 - 2 * r.arm)) * .985;
      // 交互点滅（約 50 回/分）
      const ph = r.active ? Math.floor(time / .6) % 2 : -1;
      r.lensA.color.copy(ph === 0 ? ON : OFF); r.lensB.color.copy(ph === 1 ? ON : OFF);
      for (const sp of r.glowA) sp.visible = ph === 0;
      for (const sp of r.glowB) sp.visible = ph === 1;
      r.glowMat.opacity = .35 + night * .65;
    }
  });
}
