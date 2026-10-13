// 沿線景観: 遠景の山・終端の構造物（同期生成）と、読込素材（木・市街地のビル）の配置
// 住宅・商店などの近景は town-jp.ts（手続き生成）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { fallbackBox, fallbackTree, prepareModel, type LoadedAssets, type PreparedModel } from './assets';
import { buildSceneryBatches, type SceneryItem } from './scenery-batch';
import { tramBlocks } from './hankai-tram';
import { getTerrain } from './terrain';
import { hasOsmScenery, osmCoastFor } from './osm-town';
import { isMountain } from './mountain-terrain';
import type { TreeSpot } from './town-jp';
import { ChunkedBatch, M, P } from './batch';
import { cullByDistance } from './cull';
import { coastalThirdTracks } from './coastal-stations';
import { towerZones } from './coastal-tower';
import { twinTowerZones } from './izumiotsu-towers';
import { seaSideOf } from '../route/service';

/** 景観カテゴリ別のモデル集合 */
export interface SceneryModels {
  city: PreparedModel[];
  far: PreparedModel[];
  mid: PreparedModel[];
  trees: PreparedModel[];
  bushes: PreparedModel[];
}

// 1単位あたりの実寸 [m]（素材キットごとの縮尺合わせ）
export const KIT_SCALE: Record<keyof SceneryModels, number> = { city: 9, far: 9, mid: 2.6, trees: 3.4, bushes: 2.2 };

/** 遠景の山並み（ctx.rng を消費するため生成順を変えないこと）。
 *  線路の左右に帯状の山並みを置く。稜線は重ねた正弦波＋乱数の峰で起伏を付け、手前ほど濃い緑・奥ほど霞んだ青灰色。 */
export function buildBackdrop(ctx: GameContext): void {
  const { scene, rng: rnd, track, route } = ctx;
  if (route.theme === 'mountain') return; // 山岳線は地形の遠景格子（mountain-terrain.ts）と空の稜線
  const S0 = route.extent.from - 1500, S1 = route.extent.to + 1500;
  // 曲線の内側で山並みが折り重ならないよう、線路を ±600m で平滑化した基準線から横へずらす
  const STEP = 60, W = 10, raw: { x: number; z: number; c: number; sn: number }[] = [];
  for (let s = S0 - W * STEP; s <= S1 + (W + 1) * STEP; s += STEP) { const t = track.trackAt(s); raw.push({ x: t.x, z: t.z, c: Math.cos(t.phi), sn: Math.sin(t.phi) }); }
  const at = (s: number, lat: number, _y: number) => {
    const k = Math.round((s - S0) / STEP) + W;
    let x = 0, z = 0, c = 0, sn = 0;
    for (let j = -W; j <= W; j++) { const r = raw[Math.max(0, Math.min(raw.length - 1, k + j))]; x += r.x; z += r.z; c += r.c; sn += r.sn; }
    const n = 2 * W + 1, l = Math.hypot(c, sn) || 1;
    return new THREE.Vector3(x / n + c / l * lat, 0, z / n + sn / l * lat);
  };
  const near = new THREE.Color(0x587a5c), far = new THREE.Color(0x9fb2bf), tmp = new THREE.Color();
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  // 峰（位置・高さ・幅）を乱数で決めておく（rng の消費量は従来と同程度）
  const peaks: { s: number; h: number; w: number }[] = [];
  for (let s = S0; s < S1; s += 420) peaks.push({ s: s + rnd() * 300, h: 90 + rnd() * 200, w: 300 + rnd() * 400 });
  if (route.coastalLandmarks?.length && route.coastalScenery !== false) {
    // 従来の前後稜線で使っていた82回分も消費し、後続の駅・人などの乱数列を保つ。
    for (let i = 0; i < 82; i++) rnd();
    buildCoastalBackdrop(ctx, S0, S1, at);
    return;
  }
  const ridge = (s: number, layer: number, side: number) => {
    let h = 30 + 18 * Math.sin(s / 290 + layer * 1.7 + side) + 12 * Math.sin(s / 113 + layer * 3.1) + 5 * Math.sin(s / 41 + side * 2);
    for (const p of peaks) { const d = (s - p.s - layer * 230 * side) / p.w; if (Math.abs(d) < 2.2) h += p.h * (layer ? .9 : .7) * Math.exp(-d * d * 2.2); }
    return h * (1 + layer * .45);
  };
  // 3 層 × 左右。各層は線路から dist の位置に、ridge の高さの帯を作る（谷側は地面より下まで）
  const layers = [{ d: 650, depth: 250 }, { d: 1000, depth: 350 }, { d: 1400, depth: 450 }];
  // OSM の海岸線のあるコース: 海側は海の水面（coast.ts）。遠景の山は陸側だけ
  const seaSide = osmCoastFor(route) ? seaSideOf(route) : 0;
  for (const side of [-1, 1]) layers.forEach((L, li) => {
    if (side === seaSide) return;
    const base = pos.length / 3, cols = Math.ceil((S1 - S0) / 60) + 1;
    tmp.copy(near).lerp(far, li / 2 * .85 + .1);
    for (let k = 0; k < cols; k++) {
      const s = S0 + k * 60, h = ridge(s, li, side);
      // 断面: 手前の裾 → 中腹 → 稜線 → 奥の裾（4 点）
      const prof: [number, number, number][] = [[L.d, -20, .78], [L.d + L.depth * .35, h * .62, .9], [L.d + L.depth * .55, h, 1], [L.d + L.depth, -20, .85]];
      for (const [d, y, sh] of prof) {
        const p = at(s, side * d, 0);
        pos.push(p.x, y, p.z);
        col.push(tmp.r * sh, tmp.g * sh, tmp.b * sh);
      }
      if (k > 0) for (let r = 0; r < 3; r++) {
        const a = base + (k - 1) * 4 + r, b2 = a + 4;
        if (side < 0) idx.push(a, b2, a + 1, a + 1, b2, b2 + 1); else idx.push(a, a + 1, b2, a + 1, b2 + 1, b2);
      }
    }
  });
  // 進行方向・後方の遠景（線路の延長上をふさぐ山並み）
  for (const [s, dir] of [[S1, 1], [S0, -1]] as const) {
    const base = pos.length / 3, n = 40;
    tmp.copy(far);
    for (let k = 0; k <= n; k++) {
      const lat = -2600 + 5200 * k / n, h = 120 + 90 * Math.sin(k * .7 + dir) + 60 * Math.sin(k * 1.9) + rnd() * 40;
      for (const [ds, y] of [[0, -20], [400, h]] as const) { const p = at(s + dir * (600 + ds), lat, 0); pos.push(p.x, y, p.z); col.push(tmp.r, tmp.g, tmp.b); }
      if (k > 0) { const a = base + (k - 1) * 2; if (dir > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.name = 'backdrop'; scene.add(m);
}

/** 沿岸市街地の概形。港・海岸線の位置は測量値ではなく、線路から遠いシルエット。 */
function buildCoastalBackdrop(ctx: GameContext, from: number, to: number, at: (s: number, lat: number, y: number) => THREE.Vector3): void {
  if (ctx.route.urban) { buildUrbanBackdrop(ctx, from, to, at); return; }
  const seaSide = seaSideOf(ctx.route);
  const positions: number[] = [], indices: number[] = [];
  // 海は線路から900m以遠。近景の道路・住宅・支線を水面で覆わない。
  const step = 240, n = Math.ceil((to - from) / step);
  for (let i = 0; i <= n; i++) {
    const s = Math.min(to, from + i * step);
    for (const distance of [900, 4800]) {
      const p = at(s, seaSide * distance, 0); positions.push(p.x, .07, p.z);
    }
    if (i) { const a = (i - 1) * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const sea = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x86a7b1, side: THREE.DoubleSide }));
  sea.name = 'coastal-sea'; ctx.scene.add(sea);
  const hillPoints: number[] = [], hillIndices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = Math.min(to, from + i * step), height = 42 + 15 * Math.sin(s / 1500) + 8 * Math.sin(s / 390);
    for (const [distance, y] of [[2600, -8], [2950, height], [3500, -12]]) {
      const p = at(s, -seaSide * distance, 0); hillPoints.push(p.x, y, p.z);
    }
    if (i) for (let j = 0; j < 2; j++) { const a = (i - 1) * 3 + j; hillIndices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
  }
  const hillGeometry = new THREE.BufferGeometry(); hillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(hillPoints, 3));
  hillGeometry.setIndex(hillIndices); hillGeometry.computeVertexNormals();
  const hills = new THREE.Mesh(hillGeometry, new THREE.MeshLambertMaterial({ color: 0xa8b8bf, side: THREE.DoubleSide }));
  hills.name = 'coastal-distant-hills'; ctx.scene.add(hills);
  const industrial = new ChunkedBatch(900);
  for (let s = ctx.route.extent.from - 200; s < ctx.route.extent.to + 300; s += 560) {
    const b = industrial.at(s), t = ctx.track.trackAt(s), phase = Math.abs(Math.round(s / 560));
    const lat = seaSide * (470 + 70 * Math.sin(phase * 2.3));
    const point = (ds: number, dl: number) => at(s + ds, lat + seaSide * dl, 0);
    const box = (ds: number, dl: number, y: number, w: number, h: number, d: number, color: number) => {
      const p = point(ds, dl); b.add('body', P.box, M(p.x, y, p.z, -t.phi, w, h, d), color);
    };
    box(0, 0, .15, 88, .3, 125, 0x959e9c);
    box(-24, -15, 5.5, 48, 11, 45, 0xadb9b9);
    box(-24, -15, 11.2, 50, .5, 47, 0x829796);
    box(33, 14, 4, 60, 8, 35, 0xb7bebb);
    for (const ds of [-23, 7, 37]) {
      const p = point(ds, 55);
      b.add('body', P.cyl, M(p.x, 5, p.z, 0, 16, 10, 16), 0xbcc6c2);
      b.add('body', P.cyl, M(p.x, 10.12, p.z, 0, 16.5, .24, 16.5), 0xa2b2b0);
    }
    if (phase % 3 === 0) {
      // 控えめな煙突・港湾クレーン。煙や追加フレーム更新は持たない。
      box(52, -28, 17, 1.8, 34, 1.8, 0x9baba8);
      box(52, -28, 31, 1.9, 1.6, 1.9, 0xa66e60);
      box(-42, 110, 12, 1.6, 24, 1.6, 0x91aaa5);
      box(-42, 110, 24, 32, .9, .9, 0x91aaa5);
      box(-35, 124, 12, .2, 24, .2, 0x768f8a);
    }
  }
  for (const group of industrial.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, ctx.scene)) {
    group.name = 'coastal-industry'; cullByDistance(ctx, group, 1750);
  }
}

/** 大都市の遠景（route.urban）: 線路から 250〜1500m に中高層ビルの箱を並べる（窓は描かず、遠いほど霞んだ色）。海・工業地帯は置かない */
function buildUrbanBackdrop(ctx: GameContext, from: number, to: number, at: (s: number, lat: number, y: number) => THREE.Vector3): void {
  const city = new ChunkedBatch(900);
  let h = 7;
  const rnd = () => { h = (h * 16807) % 2147483647; return h / 2147483647; }; // 独自乱数（ctx.rng を消費しない）
  const near = new THREE.Color(0xb3b5b4), far = new THREE.Color(0xc4ccd3), c = new THREE.Color();
  const T = getTerrain(ctx), route = ctx.route, osm = hasOsmScenery(ctx);
  // OSM の沿線データがあるコースは、データの範囲（約320m）の外から
  const dMin = osm ? 340 : 250;
  for (let s = from; s < to; s += 22) for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const d = dMin + rnd() * (1500 - dMin), p = at(s + rnd() * 20, side * d, 0), t = ctx.track.trackAt(s);
      const hh = 18 + rnd() * rnd() * (d < 700 ? 90 : 140), w = 18 + rnd() * 30, dep = 18 + rnd() * 30;
      c.copy(near).lerp(far, Math.min(1, (d - 250) / 1250)).multiplyScalar(.9 + rnd() * .15);
      if (T.reliefY(s, side * d) > 1.5) continue; // 周囲の山（route.relief）の中に埋まる遠景ビルは置かない
      city.at(s).add('body', P.boxB, M(p.x, 0, p.z, -t.phi + (rnd() - .5) * .3, w, hh, dep), c.getHex());
    }
  }
  // 町並みの奥（線路から 68〜250m）: 中低層の街区を箱で埋める（手前2列の住宅・商店は town-jp.ts）
  const blockCols = [0xc9c2b4, 0xb9b4aa, 0xd2cfc7, 0xa9aaa6, 0xc4b9a5, 0xb3b9bd];
  for (let s = route.extent.from; s < (osm ? route.extent.from : route.extent.to); s += 16) for (const side of [-1, 1]) {
    for (let d = 68; d < 250; d += 15 + rnd() * 6) {
      if (!T.isCity(s) || rnd() < .12) continue;
      const w = 10 + rnd() * 12, dep = 9 + rnd() * 6, lat = side < 0 ? Math.min(...route.tracks) - d : Math.max(...route.tracks) + d;
      if (tramBlocks(route, s - w / 2, s + w / 2, lat - dep / 2, lat + dep / 2)) continue;
      const t = ctx.track.trackAt(s), p = ctx.track.at(s + (rnd() - .5) * 4, lat, 0), hh = 7 + rnd() * rnd() * 30;
      const col = blockCols[Math.floor(rnd() * blockCols.length)];
      const b = city.at(s);
      b.add('body', P.boxB, M(p.x, T.groundY(s), p.z, -t.phi, dep, hh, w), col);
      b.add('body', P.boxB, M(p.x, T.groundY(s) + hh, p.z, -t.phi, dep * .4, 1.6, w * .3), 0x8d9093); // 屋上の塔屋
    }
  }
  for (const group of city.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, ctx.scene)) {
    group.name = 'urban-backdrop'; cullByDistance(ctx, group, 2600);
  }
}

/** 車止め先の遠方構造物（終端を隠す） */
export function buildEndBlock(ctx: GameContext): void {
  const s = ctx.route.scenery.endBlockS;
  if (s == null) return;
  const b = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 20), new THREE.MeshLambertMaterial({ color: 0x8b97a3 }));
  const p = ctx.track.at(s, 0, 0); b.position.set(p.x, 15 + p.y, p.z); b.rotation.y = -ctx.track.trackAt(s).phi; ctx.scene.add(b);
}

/** 読込結果から景観モデルを用意（失敗カテゴリは代替） */
export function prepareSceneryModels(loaded: LoadedAssets): SceneryModels {
  const p = (k: keyof SceneryModels) => (loaded[k] ?? []).map(g => prepareModel(g.scene, k === 'trees' ? 'tree' : k === 'bushes' ? 'bush' : undefined));
  const M: SceneryModels = { city: p('city'), far: p('far'), mid: p('mid'), trees: p('trees'), bushes: p('bushes') };
  if (!M.city.length) M.city = [fallbackBox(0xb9c1c9)];
  if (!M.far.length) M.far = [fallbackBox(0x9fa8b3)];
  if (!M.mid.length) M.mid = M.city;
  if (!M.trees.length) M.trees = [fallbackTree()];
  if (!M.bushes.length) M.bushes = M.trees;
  return M;
}

// 沿線に配置。各カテゴリはモデル配列からランダムに選ぶ
export function placeScenery(ctx: GameContext, M: SceneryModels, spots: TreeSpot[] = []): void {
  const { rng: rnd, route, track: { trackAt } } = ctx, T = getTerrain(ctx);
  const TS0 = route.extent.from, TS1 = route.extent.to;
  const L0 = Math.min(...route.tracks), L1 = Math.max(...route.tracks);
  const latOf = (sd: number, d: number) => sd < 0 ? L0 - d : L1 + d;
  // 配置を集めて材質ごとの BatchedMesh へ（scenery-batch.ts）
  const items: SceneryItem[] = [];
  const thirds = route.stations.flatMap(st => coastalThirdTracks(route, st));
  // OSM の沿線データがあるコースは、素材のビル（市街地・遠景）を置かない（乱数の消費順は変えない）
  const osm = hasOsmScenery(ctx);
  let noBuildings = false;
  const put = (model: PreparedModel, s: number, lat: number, yaw: number, k: number, y?: number) => {
    if (noBuildings) return;
    const radius = Math.hypot(model.size.x, model.size.z) * k / 2;
    // 描画専用線も分岐端まで敷地を確保。樹冠の幅と前後方向の張り出しを含む。
    if (thirds.some(t => s > t.from - radius && s < t.to + radius && Math.abs(lat - t.lat(s)) < radius + 2.1)) return;
    if (tramBlocks(route, s - radius, s + radius, lat - radius, lat + radius)) return; // 阪堺線の跨線橋・高師浜線の高架支線の通り道
    const t = trackAt(s);
    items.push({ model, pl: { p: new THREE.Vector3(t.x + t.rx * lat, y ?? T.groundY(s) + T.reliefY(s, lat), t.z + t.rz * lat), yaw: -t.phi + yaw, k } });
  };
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const facing = (side: number) => (side < 0 ? Math.PI / 2 : -Math.PI / 2) + (rnd() < .3 ? Math.PI : 0);
  const nearCity = (s: number, m: number) => route.scenery.cityZones.some(z => s > z.from - m && s < z.to + m);
  // 山岳線: ビル・線路際の植え込みは平地（町）で地面が線路と同じ高さの所だけ
  const MT = isMountain(T) ? T : null;
  const level = (s: number, lat: number) => !MT || (MT.flat(s) > .97 && Math.abs(MT.terrainY(s, lat) - MT.groundY(s)) < .9);
  const blocked = (s: number) => T.nearCrossing(s, 3) || T.structureAt(s, 60)?.kind === 'tunnel' || (!MT && T.low(s)) || !level(s, 0);
  const overpasses = (route.coastalLandmarks ?? []).filter(l => l.kind === 'road-overpass');
  const blockedBuilding = (s: number, half = 0) => overpasses.some(l => Math.abs(s - l.s) < 45 + half);
  const towers = towerZones(route);
  // 泉大津駅前の2棟のタワーの敷地には、奥の商業ビル・遠景ビルも置かない
  const twins = twinTowerZones(route);
  const twinNear = (sd: number, s: number, half: number) => twins.some(t => t.side === sd && s + half > t.from && s - half < t.to);

  for (const side of [-1, 1]) {
    // 市街地の奥: 商業ビル・中層ビル
    noBuildings = osm;
    for (let s = TS0; s < TS1;) {
      if (!T.isCity(s) || blocked(s)) { s += 10; continue; }
      const mid = rnd() < .4, model = pick(mid ? M.mid : M.city), k = mid ? KIT_SCALE.mid : KIT_SCALE.city;
      const half = Math.max(model.size.x, model.size.z) * k / 2;
      if (blockedBuilding(s, half) || twinNear(side, s, half)) { s += 10; continue; }
      if (!level(s, latOf(side, 70 + half))) { s += 10; continue; }
      put(model, s, latOf(side, 70 + half + rnd() * 10), facing(side), k);
      s += half * 2 + 3 + rnd() * 6;
    }
    // 遠景: 簡易ビル群（市街地付近のみ）
    for (let s = TS0; s < TS1 + 400;) {
      if (!nearCity(s, 250) || blocked(s)) { s += 20; continue; }
      const fm = pick(M.far), fl = latOf(side, 100 + rnd() * 140); // 乱数の消費順は従来どおり
      const fhalf = Math.max(fm.size.x, fm.size.z) * KIT_SCALE.far * 1.5 / 2;
      if (blockedBuilding(s, fhalf) || twinNear(side, s, fhalf)) { s += 20; continue; }
      if (level(s, fl)) put(fm, s, fl, rnd() * 6, KIT_SCALE.far * (1 + rnd() * .5));
      s += 12 + rnd() * 25;
    }
    noBuildings = false;
    // 線路際の木・植え込み（柵と道路の間）
    for (let s = TS0; s < TS1; s += 5 + rnd() * 16) {
      if (rnd() < .5 || blocked(s) || T.structureAt(s, 5) || T.nearStation(s, 10) || towers.some(t => t.side === side && s > t.from && s < t.to)) continue;
      const big = rnd() < .35;
      const model = pick(big ? M.trees : M.bushes), k = (big ? KIT_SCALE.trees * .8 : KIT_SCALE.bushes) * (.7 + rnd() * .4);
      const tl = latOf(side, 8.6 + rnd() * 1.4);
      if (level(s, tl)) put(model, s, tl, rnd() * 6, k);
    }
  }
  // 街並み側が決めた木（庭木・屋敷林・山林）
  for (const t of spots) {
    const model = t.small ? pick(rnd() < .5 ? M.bushes : M.trees) : pick(M.trees);
    put(model, t.s, t.lat, rnd() * 6, (t.small ? KIT_SCALE.bushes * 1.3 : KIT_SCALE.trees) * t.k, t.y);
  }
  buildSceneryBatches(ctx, items);
}
