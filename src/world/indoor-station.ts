// 屋内式の駅（Station.indoor）: ホーム全体（待避線を含む全線の幅）を屋根と側壁で覆った高架の大屋根。ホームに入ると外は見えず、開口は駅の前後端だけ。
// 構造: 内張り（壁・天井）と外皮（壁・屋根）の二重の押し出し、前後端の縁（開口の額縁）、室内の柱・梁・蛍光灯・壁の駅名板、外壁の帯窓。
// 室内ではトンネルと同じに扱う: カメラが大屋根の中にある間は 'tunnel' イベントを出す（env が環境光を落とし、audio/running.ts が反響を掛ける）。
// 室内の内張りはトンネル度に応じて自己発光を足し、ホーム照明で明るく見せる。route.structures には入れない（地形・架線がトンネル扱いにならないように）。
// 範囲: 入口分岐器の終わり（ホーム端の 10m 手前）から出口分岐器の始まりの手前（ホーム端の 50m 先）。この間は線路の間隔が最大で一定なので、横幅は一定の箱で足りる。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Station } from '../route/types';
import { GeoBatch, M, P, onLight } from './batch';
import { cullByDistance } from './cull';
import { extrudeFn } from './track-mesh';
import { getTerrain } from './terrain';
import { nearestS } from './structures';
import { nameTex } from './stations';

/** 壁の高さ（床面から）と屋根のたかさ（壁の上端からの矢高）。架線のビーム上端・き電線は約 9m、出発信号の灯器は約 7.3m */
const WALL_H = 9.9, RISE = 1.9;
/** 外皮の厚み（内張りの外側へ）。壁は床版の外縁の外へ出る */
const SKIN = .45;
const DECK_BOTTOM = -1.1;
const ARCH_N = 14;

export interface HallBox { from: number; to: number; left: number; right: number }

/** 大屋根の範囲と横幅（線路中心からの横位置）。床版の外縁（coastalDeckBounds）と同じく、最も外の線路から 3.3m 外 */
export function hallBox(ctx: GameContext, sta: Station): HallBox {
  const lo = Math.min(...ctx.route.tracks), hi = Math.max(...ctx.route.tracks), lp = sta.loop?.lat ?? 0;
  return {
    from: sta.platform.from - 10, to: sta.platform.to + 50,
    left: Math.min(lo, lo + lp, hi - lp) - 3.3, right: Math.max(hi, hi - lp, lo + lp) + 3.3,
  };
}

export function buildIndoorStations(ctx: GameContext): void {
  const halls = ctx.route.stations.filter(s => s.indoor).map(s => ({ sta: s, box: hallBox(ctx, s) }));
  if (!halls.length) return;
  for (const h of halls) buildHall(ctx, h.sta, h.box);
  watchInside(ctx, halls.map(h => h.box));
}

/** 天井の高さ（床面から）。両壁の上端から中央へ向かう円弧 */
function ceilingY(box: HallBox, lat: number): number {
  const w = box.right - box.left, mid = (box.left + box.right) / 2;
  const R = (w * w / 4 + RISE * RISE) / (2 * RISE), x = Math.max(-w / 2, Math.min(w / 2, lat - mid));
  return WALL_H + Math.sqrt(Math.max(0, R * R - x * x)) - (R - RISE);
}

function buildHall(ctx: GameContext, sta: Station, box: HallBox): void {
  const { track } = ctx;
  const { from, to, left, right } = box, sc = (sta.platform.from + sta.platform.to) / 2;
  const lo = Math.min(...ctx.route.tracks), hi = Math.max(...ctx.route.tracks), lp = sta.loop?.lat ?? 0;
  const prev = ctx.route.stations[ctx.route.stations.indexOf(sta) - 1]?.name ?? ctx.route.prevName ?? '';
  const next = ctx.route.stations[ctx.route.stations.indexOf(sta) + 1]?.name ?? ctx.route.nextName ?? '';

  const archLats = (): number[] => Array.from({ length: ARCH_N + 1 }, (_, i) => left + (right - left) * i / ARCH_N);
  const innerArch = (): [number, number][] => archLats().map(x => [x, ceilingY(box, x)]);
  const outerArch = (): [number, number][] => archLats().map((x, i) => [left - SKIN + (right - left + 2 * SKIN) * i / ARCH_N, ceilingY(box, x) + SKIN]);

  // ---- 材質 ----
  const mk = (color: number, emissiveK: number) => {
    const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }), base = new THREE.Color(color);
    return { m, set: (tunnel: number) => { m.emissive.copy(base).multiplyScalar(tunnel * emissiveK); } };
  };
  const lining = [mk(0xd8d4c8, .55), mk(0xeeece5, .62)], skin = [mk(0xc3c7c5, 0), mk(0x737b82, 0)];
  const detail = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const glassMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x39464f });
  // 駅名板は +x を向く面（板の右 = 進行方向）と -x を向く面（板の右 = 後方）で左右の駅名を入れ替える
  const signMats = [nameTex(sta, prev, next), nameTex(sta, next, prev)].map(tex => new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .35 }));

  const shell = new THREE.Group(); shell.name = `indoor-hall-shell-${sta.name}`;
  const inner = new THREE.Group(); inner.name = `indoor-hall-inner-${sta.name}`;

  // ---- 内張り（壁・天井）と外皮（壁・屋根）。線路に沿った押し出し ----
  const step = 10;
  const add = (g: THREE.Group, profile: [number, number][], mat: THREE.Material) => g.add(extrudeFn(track, () => profile, from, to, step, mat));
  add(inner, [[left, .02], [left, WALL_H]], lining[0].m);
  add(inner, [[right, WALL_H], [right, .02]], lining[0].m);
  add(inner, innerArch(), lining[1].m);
  add(shell, [[left - SKIN, DECK_BOTTOM], [left - SKIN, WALL_H + SKIN]], skin[0].m);
  add(shell, [[right + SKIN, WALL_H + SKIN], [right + SKIN, DECK_BOTTOM]], skin[0].m);
  add(shell, outerArch(), skin[1].m);

  // 前後端の縁（内張りと外皮のすき間をふさぐ額縁）。開口は線路の全幅
  const rim = (s: number) => {
    const t = track.trackAt(s), outer: THREE.Vector2[] = [new THREE.Vector2(left - SKIN, DECK_BOTTOM), ...outerArch().map(([x, y]) => new THREE.Vector2(x, y)), new THREE.Vector2(right + SKIN, DECK_BOTTOM)];
    const shape = new THREE.Shape(outer);
    shape.holes.push(new THREE.Path([new THREE.Vector2(left, .02), ...innerArch().map(([x, y]) => new THREE.Vector2(x, y)), new THREE.Vector2(right, .02)]));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), skin[0].m);
    mesh.position.copy(track.at(s, 0, 0)); mesh.rotation.y = -t.phi;
    shell.add(mesh);
  };
  rim(from); rim(to);

  // ---- 室内の部品（柱・梁・壁の柱型・蛍光灯・壁の駅名板） ----
  const frame = (s: number) => {
    const t = track.trackAt(s);
    return new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t.phi, 0)), new THREE.Vector3(1, 1, 1));
  };
  const body = new GeoBatch(), lamps = new GeoBatch(), signs = new GeoBatch(new Set(['signA', 'signB']));
  const put = (b: GeoBatch, key: string, s: number, x: number, y: number, z: number, w: number, h: number, d: number, color: number, rz = 0) => {
    b.parent = frame(s); b.add(key, P.box, M(x, y, z, 0, w, h, d, 0, rz), color); b.parent = null;
  };
  const COL = { rib: 0xb8b5ab, pilaster: 0xcbc7bb, skirt: 0x6f6b64, stripe: 0x3f6f8f, column: 0xd6d3c9, housing: 0x555a5e, lamp: 0xfff4de };
  const centers = [lo + lp / 2, hi - lp / 2].filter((v, i, a) => lp !== 0 && a.indexOf(v) === i);
  const lampRows = [lo + lp, lo + lp / 2, lo, hi, hi - lp / 2, hi - lp].filter((v, i, a) => a.indexOf(v) === i);
  const PITCH = 15;
  // 梁（アーチ状の横桁）と壁の柱型。ホーム中央を基準に 15m ごと
  for (let k = Math.ceil((from - sc) / PITCH); sc + k * PITCH <= to; k++) {
    const s = sc + k * PITCH;
    if (s < from + 1 || s > to - 1) continue;
    const arch = innerArch();
    for (let i = 0; i < arch.length - 1; i++) {
      const [x0, y0] = arch[i], [x1, y1] = arch[i + 1], len = Math.hypot(x1 - x0, y1 - y0);
      put(body, 'body', s, (x0 + x1) / 2, (y0 + y1) / 2 - .3, 0, len + .08, .6, .45, COL.rib, Math.atan2(y1 - y0, x1 - x0));
    }
    for (const x of [left + .3, right - .3]) put(body, 'body', s, x, WALL_H / 2, 0, .6, WALL_H, .8, COL.pilaster);
    // 島式ホーム中央の柱（階段室の前後は避ける）
    if (Math.abs(s - sc) > 9) for (const c of centers) {
      const top = ceilingY(box, c) - .55;
      put(body, 'body', s, c, (1.1 + top) / 2, 0, .9, top - 1.1, .9, COL.column);
      put(body, 'body', s, c, top - .3, 0, 1.5, .5, 1.5, COL.rib);
    }
  }
  // 壁の幅木と帯（20m ごとの区間）
  for (let s = from; s < to; s += 20) {
    const z = Math.min(20, to - s), mid = s + z / 2;
    for (const x of [left + .03, right - .03]) {
      put(body, 'body', mid, x, .55, 0, .08, 1.1, z + .05, COL.skirt);
      put(body, 'body', mid, x, 2.6, 0, .08, .5, z + .05, COL.stripe);
    }
  }
  // 蛍光灯: 各線路・ホームの真上に 6m ごと（器具は天井から吊る）
  for (let s = from + 3; s < to - 2; s += 6) for (const lat of lampRows) {
    const y = ceilingY(box, lat) - .55;
    put(body, 'body', s, lat, y + .12, 0, .5, .14, 3.0, COL.housing);
    put(lamps, 'lamp', s, lat, y, 0, .34, .06, 2.7, COL.lamp);
  }
  // 壁の駅名板（両壁、45m ごと）
  for (let k = -3; k <= 3; k++) {
    const s = sc + k * 45;
    if (s < from + 8 || s > to - 8) continue;
    signs.parent = frame(s);
    signs.add('signA', P.plane, M(left + .08, 5.6, 0, Math.PI / 2, 6.6, 1.93, 1));
    signs.add('signB', P.plane, M(right - .08, 5.6, 0, -Math.PI / 2, 6.6, 1.93, 1));
    signs.parent = null;
  }
  body.build({ body: detail }, inner); lamps.build({ lamp: lampMat }, inner); signs.build({ signA: signMats[0], signB: signMats[1] }, inner);

  // ---- 外装（外壁の帯窓・軒・駅名・屋根の換気塔） ----
  const outside = new GeoBatch(), glass = new GeoBatch(), outSigns = new GeoBatch(new Set(['signA', 'signB']));
  for (let s = from + 2; s < to - 2; s += 3.4) for (const x of [left - SKIN - .03, right + SKIN + .03]) {
    glass.parent = frame(s); glass.add('glass', P.box, M(x, 6.6, 0, 0, .06, 2.5, 2.9), 0xffffff); glass.parent = null;
  }
  for (let s = from; s < to; s += 20) {
    const z = Math.min(20, to - s), mid = s + z / 2;
    for (const x of [left - SKIN - .12, right + SKIN + .12]) {
      put(outside, 'body', mid, x, WALL_H + SKIN - .15, 0, .3, .5, z + .05, 0xeeeeea);
      put(outside, 'body', mid, x, 3.2, 0, .2, .3, z + .05, 0x8e9498);
    }
  }
  for (let s = from + 25; s < to - 20; s += 40) {
    const x = (left + right) / 2, y = ceilingY(box, x) + SKIN;
    put(outside, 'body', s, x, y + .5, 0, 2.6, 1, 1.6, 0x9aa1a6);
    put(outside, 'body', s, x, y + 1.1, 0, 3.0, .2, 2.0, 0x6d7479);
  }
  for (const s of [sc - 40, sc + 40]) {
    outSigns.parent = frame(s);
    outSigns.add('signB', P.plane, M(left - SKIN - .2, 8.6, 0, -Math.PI / 2, 8.5, 2.48, 1));
    outSigns.add('signA', P.plane, M(right + SKIN + .2, 8.6, 0, Math.PI / 2, 8.5, 2.48, 1));
    outSigns.parent = null;
  }
  outside.build({ body: detail }, shell); glass.build({ glass: glassMat }, shell); outSigns.build({ signA: signMats[0], signB: signMats[1] }, shell);

  // ---- 点灯 ----
  const day = new THREE.Color(0x39464f), warm = new THREE.Color(0xffe2a8);
  onLight(ctx, (night, tunnel) => {
    for (const l of lining) l.set(tunnel);
    detail.emissive.setScalar(tunnel * .33);
    glassMat.color.copy(day).lerp(warm, night);
    for (const m of signMats) m.emissiveIntensity = .35 + .45 * Math.max(night, tunnel);
  });

  ctx.scene.add(shell, inner);
  cullByDistance(ctx, shell, 2200);
  cullByDistance(ctx, inner, 500);
}

/** カメラが大屋根の中にある間は 'tunnel' を出す（structures.ts のトンネル判定と同じ流れ。env が環境光を落とし、音に反響が掛かる） */
function watchInside(ctx: GameContext, boxes: HallBox[]): void {
  const T = getTerrain(ctx);
  let inside = false, guess = ctx.state.train.s;
  ctx.events.on('reset', () => { if (inside) { inside = false; ctx.events.emit('tunnel', { inside }); } guess = ctx.state.train.s; });
  // 大屋根から離れている間は判定しない（列車位置で粗く見る。外部視点のカメラは列車から数百 m 以内）
  const near = (s: number) => boxes.some(b => s > b.from - 600 && s < b.to + 600);
  ctx.events.on('frame', () => {
    if (!inside && !near(ctx.state.train.s)) return;
    const r = nearestS(ctx, ctx.camera.position, guess);
    guess = Math.abs(r.lat) > 150 ? ctx.state.train.s : r.s;
    const y = ctx.camera.position.y - T.trackY(r.s);
    const now = boxes.some(b => r.s > b.from + .5 && r.s < b.to - .5 && r.lat > b.left + .2 && r.lat < b.right - .2 && y < ceilingY(b, r.lat) && y > -1);
    if (now !== inside) { inside = now; ctx.events.emit('tunnel', { inside }); }
  });
}
