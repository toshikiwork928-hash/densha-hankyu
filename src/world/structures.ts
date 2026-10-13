// 構造物（route.structures）: トンネル（坑口・覆工・照明）、高架橋、橋梁＋川。トンネル出入りを tunnel イベントで通知
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { GeoBatch, M, P } from './batch';
import { extrudeAlong, extrudeFn, loopTracks } from './track-mesh';
import { coastalThirdTracks } from './coastal-stations';
import { customPlatformEdges, islandOffset, islandShape, islandZones, profileLat, trackSpan } from '../route/service';
import { TUNNEL_CENTER, TUNNEL_HALF, TUNNEL_WALL_H, getTerrain } from './terrain';
import { BAND_CULL, isMountain } from './mountain-terrain';
import { cullByDistance } from './cull';
import { buildMountainSpan, buildRockSheds } from './mountain-structures';
import { hagoromoDeckEdge, hagoromoParapetGap } from './hagoromo-branch';

const concrete = new THREE.MeshLambertMaterial({ color: 0xc4c0b6, side: THREE.DoubleSide });

/** 待避線の分岐と相対式ホームを包む床版外縁。横断形を変えて高欄を線路から離す。 */
export function coastalDeckBounds(ctx: GameContext): (s: number) => [number, number] {
  const { route } = ctx, loops = loopTracks(ctx);
  const thirds = route.stations.flatMap(st => coastalThirdTracks(route, st)).filter(q => !q.wire);
  const lo = Math.min(...route.tracks), hi = Math.max(...route.tracks);
  return s => {
    let left = lo - 3.3, right = hi + 3.3;
    // route.tracks の横位置の変化（複々線で対向線が外へずれる・駅で開く）と、続いて並ぶ追加の線路（離れていく支線は buildExtraDecks）
    if (route.trackProfiles || route.extraTracks) {
      const [a, b] = trackSpan(route, s);
      left = Math.min(left, a - 3.3); right = Math.max(right, b + 3.3);
      const pe = customPlatformEdges(route, s, 2);
      if (pe) { left = Math.min(left, pe[0] - .4); right = Math.max(right, pe[1] + .4); }
    }
    for (const t of loops) { left = Math.min(left, t.lat(s) - 3.3); right = Math.max(right, t.lat(s) + 3.3); }
    for (const t of thirds) { left = Math.min(left, t.lat(s) - 3.3); right = Math.max(right, t.lat(s) + 3.3); }
    // 島式1面2線の高架駅: 線路が駅の前後でホームの両側へ開く（S字）分だけ床版を広げる
    for (const z of islandZones(route)) if (s > z.inFrom && s < z.outTo) {
      const k = z.spread * islandShape(z, s);
      left = Math.min(left, lo - k - 3.3); right = Math.max(right, hi + k + 3.3);
    }
    const hg = hagoromoDeckEdge(route, s);
    if (hg) { if (hg.side < 0) left = Math.min(left, hg.lat); else right = Math.max(right, hg.lat); }
    for (const st of route.stations) if (st.elevated && !st.loop && !st.island && st.layout !== 'custom') {
      const u = Math.max(0, Math.min(1, (s - st.platform.from + 25) / 25, (st.platform.to + 25 - s) / 25));
      const edge = 3.3 + 3.9 * u * u * (3 - 2 * u);
      left = Math.min(left, lo - edge); right = Math.max(right, hi + edge);
    }
    return [left, right];
  };
}

/** トンネル断面（線路基準の横位置・高さ） */
function archProfile(segs = 14): [number, number][] {
  const c = TUNNEL_CENTER, r = TUNNEL_HALF, out: [number, number][] = [[c - r, -.2], [c - r, TUNNEL_WALL_H]];
  for (let i = 1; i < segs; i++) { const a = Math.PI - Math.PI * i / segs; out.push([c + Math.cos(a) * r, TUNNEL_WALL_H + Math.sin(a) * r]); }
  out.push([c + r, TUNNEL_WALL_H], [c + r, -.2]);
  return out;
}

/** 線路のカメラ位置に最も近い s（運転台以外のカメラ用） */
export function nearestS(ctx: GameContext, p: THREE.Vector3, guess: number): { s: number; lat: number } {
  let best = guess, bd = Infinity;
  for (let ds = -400; ds <= 400; ds += 10) {
    const q = ctx.track.trackAt(guess + ds), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) { bd = d; best = guess + ds; }
  }
  for (let ds = -10; ds <= 10; ds += 1) {
    const q = ctx.track.trackAt(best + ds), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) { bd = d; best = best + ds; }
  }
  const q = ctx.track.trackAt(best);
  return { s: best, lat: (p.x - q.x) * q.rx + (p.z - q.z) * q.rz };
}

export function buildStructures(ctx: GameContext): void {
  const { scene, track, route } = ctx, T = getTerrain(ctx);
  const list = route.structures ?? [];
  const batch = new GeoBatch();
  const lining = new THREE.MeshLambertMaterial({ color: 0x5d5a55, side: THREE.DoubleSide });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
  const lamps: THREE.Matrix4[] = [];
  const MT = isMountain(T) ? T : null;
  const bounds = coastalDeckBounds(ctx);

  for (const st of list) {
    if (st.kind === 'tunnel') {
      // 山岳線は地面の帯を距離カリングするので、覆工・床・トラフ・坑口はトンネル区間の帯と同じ包含球・距離で一体に消す
      //（帯だけ消えて覆工が谷に浮いて見えないように）
      const tg = new THREE.Group(); scene.add(tg);
      if (MT) {
        const own = MT.bands.filter(b => b.inside && b.a < st.to && b.b > st.from).map(b => b.mesh);
        if (own.length) cullByDistance(ctx, tg, BAND_CULL, own);
      }
      // 覆工（内壁）と床
      tg.add(extrudeAlong(track, archProfile(), st.from, st.to, 5, lining));
      tg.add(extrudeAlong(track, [[TUNNEL_CENTER - TUNNEL_HALF, .005], [TUNNEL_CENTER + TUNNEL_HALF, .005]], st.from, st.to, 10, lining));
      // 照明（左右の壁、交互）
      for (let s = st.from + 10; s < st.to; s += 18) {
        const t = track.trackAt(s), side = Math.round((s - st.from) / 18) % 2 ? -1 : 1;
        const p = track.at(s, TUNNEL_CENTER + side * (TUNNEL_HALF - .12), 4.2);
        lamps.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t.phi, 0)), new THREE.Vector3(.12, .14, 1.2)));
      }
      // 坑口（両端）
      for (const [s, back] of [[st.from, true], [st.to, false]] as const) {
        // 山岳線: 尾根が広いので断面を広く取り、下端は坑口の外の地表に合わせる（谷側の段差もふさぐ）
        if (MT) buildPortal(ctx, s, back, (q, l) => MT.sample(q, l), 400, (q, l) => MT.sample(q, l, undefined, false), 0x3d5a36, tg);
        else buildPortal(ctx, s, back, T.terrainY.bind(T));
      }
      // ケーブルトラフ
      for (const side of [-1, 1]) tg.add(extrudeAlong(track, [[TUNNEL_CENTER + side * (TUNNEL_HALF - .5), .0], [TUNNEL_CENTER + side * (TUNNEL_HALF - .5), .45], [TUNNEL_CENTER + side * (TUNNEL_HALF - .05), .45]], st.from, st.to, 10, concrete));
    } else if (MT) {
      buildMountainSpan(ctx, MT, st, batch);
    } else {
      const bridge = st.kind === 'bridge';
      // 上下線が別々の単線橋（split）: 線路ごとに床版・主桁・高欄・橋脚。それ以外は1枚の床版
      const decks: ((s: number) => [number, number])[] = st.split
        ? route.tracks.map(c => (s: number): [number, number] => { const l = c + islandOffset(route, c, s); return [l - 2.6, l + 2.6]; })
        : [bounds];
      for (const [di, bounds] of decks.entries()) {
      // 床版・地覆・高欄
      const [L0, L1] = bounds((st.from + st.to) / 2);
      scene.add(extrudeFn(track, s => { const [a, b] = bounds(s); return [[a, .02], [a, -1.1], [b, -1.1], [b, .02]]; }, st.from, st.to, 2, concrete));
      scene.add(extrudeFn(track, s => { const [a, b] = bounds(s); return [[a + .25, .02], [b - .25, .02]]; }, st.from, st.to, 2, concrete));
      const wallH = bridge || st.open ? .55 : 1.15;
      const gap = hagoromoParapetGap(route);
      for (const side of [-1, 1]) {
        // 羽衣の支線が離れる所は、支線側の高欄を切る（床版の縁が3番線を横切って戻る区間）
        let spans = gap && gap.side === side && gap.from < st.to && gap.to > st.from
          ? [[st.from, gap.from], [gap.to, st.to]].filter(([a, b]) => b - a > 1) : [[st.from, st.to]];
        // 追加の線路が本線の床版に加わる・離れる所（床版の縁が段になる）は高欄を切る（縁が線路を横切らないように）
        if (route.extraTracks?.length) {
          const cuts: [number, number][] = [];
          for (let q = st.from; q < st.to - 2; q += 2) {
            const e0 = bounds(q)[side < 0 ? 0 : 1], e1 = bounds(q + 2)[side < 0 ? 0 : 1];
            if (Math.abs(e1 - e0) > 1.2) cuts.push([q - 4, q + 6]);
          }
          for (const [c0, c1] of cuts) spans = spans.flatMap(([a, b]) => b <= c0 || a >= c1 ? [[a, b]] : [[a, c0], [c1, b]].filter(([x, y]) => y - x > 1));
        }
        for (const [s0, s1] of spans) scene.add(extrudeFn(track, s => {
          const [left, right] = bounds(s), a = side < 0 ? left : right - .25, b = a + .25;
          const h = wallH;
          return [[a, .02], [a, h], [b, h], [b, .02]];
        }, s0, s1, 2, concrete));
      }
      // 橋台（盛土との境）
      for (const s of [st.from, st.to]) {
        const [L0, L1] = bounds(s);
        const t = track.trackAt(s), g = T.groundY(s), y = T.trackY(s), p = track.at(s, (L0 + L1) / 2, 0);
        // 別の構造物（壁のない高架・橋梁）に続く端は橋台を作らない
        if (y - g > .5 && !list.some(o => o !== st && (Math.abs(o.to - s) < 1 || Math.abs(o.from - s) < 1))) batch.add('concrete', P.boxB, M(p.x, g - .5, p.z, -t.phi, L1 - L0 + 1, y - g + .3, 3), 0xffffff);
      }
      if (bridge) {
        // 鋼桁（主桁）と手すり
        const steel = new THREE.MeshLambertMaterial({ color: route.bridgeStyle?.color ?? 0x5f7488, side: THREE.DoubleSide });
        if (route.bridgeStyle?.throughGirder) {
          // 下路プレートガーダー: 床版の両縁に高さ 2m の主桁（トラス区間は除く）。上端にフランジ、外面に補剛材
          const trusses = (route.coastalLandmarks ?? []).filter(l => l.kind === 'steel-bridge').map(l => [l.s - (l.length ?? 170) / 2, l.s + (l.length ?? 170) / 2]);
          const spans: [number, number][] = [], sb = new GeoBatch();
          let a = st.from;
          for (const [t0, t1] of trusses.sort((p, q) => p[0] - q[0])) if (t1 > st.from && t0 < st.to) { if (t0 - a > 2) spans.push([a, t0]); a = t1; }
          if (st.to - a > 2) spans.push([a, st.to]);
          for (const [s0, s1] of spans) for (const side of [-1, 1]) {
            scene.add(extrudeFn(track, s => { const [l0, l1] = bounds(s), x = side < 0 ? l0 + .35 : l1 - .35; return [[x - .12, -1.1], [x - .12, 2.0], [x + .12, 2.0], [x + .12, -1.1]]; }, s0, s1, 4, steel));
            scene.add(extrudeFn(track, s => { const [l0, l1] = bounds(s), x = side < 0 ? l0 + .35 : l1 - .35; return [[x - .3, 1.92], [x - .3, 2.08], [x + .3, 2.08], [x + .3, 1.92]]; }, s0, s1, 4, steel));
            for (let q = s0 + 1.5; q < s1 - 1; q += 3) {
              const t = track.trackAt(q), [l0, l1] = bounds(q), p = track.at(q, side < 0 ? l0 + .1 : l1 - .1, .45);
              sb.add('bstiff', P.box, M(p.x, p.y, p.z, -t.phi, .18, 3.1, .12), 0xffffff);
            }
          }
          sb.build({ bstiff: steel }, scene);
        }
        for (const c of route.tracks) {
          const lc = (q: number) => c + islandOffset(route, c, q), [b0, b1] = bounds((st.from + st.to) / 2);
          if (lc((st.from + st.to) / 2) < b0 || lc((st.from + st.to) / 2) > b1) continue;
          scene.add(extrudeFn(track, q => { const l = lc(q); return [[l - 1.1, -1.1], [l - 1.1, -2.9], [l + 1.1, -2.9], [l + 1.1, -1.1]]; }, st.from + 2, st.to - 2, 5, steel));
        }
        for (const l of [L0 + .1, L1 - .1]) scene.add(extrudeAlong(track, [[l - .05, 1.05], [l - .05, 1.15], [l + .05, 1.15], [l + .05, 1.05]], st.from, st.to, 5, steel));
        for (let s = st.from; s <= st.to; s += 2.5) for (const l of [L0 + .1, L1 - .1]) {
          const t = track.trackAt(s), p = track.at(s, l, .55);
          batch.add('steel', P.box, M(p.x, p.y + .3, p.z, -t.phi, .06, .6, .06), 0xffffff);
        }
        // 橋脚（川の中は小判形）。piers があれば、その位置に線路ごとの小判形の橋脚（材質は pierStyle。川底から立てる）
        if (st.piers) for (const s of st.piers) slimPier(batch, ctx, s, bounds(s), st.pierStyle?.[di] ?? 'concrete');
        else for (let s = st.from + 40; s < st.to - 20; s += 45) pier(batch, ctx, s, 2.9, true, bounds(s));
      }
      }
      // 橋の川面は地形側（terrain.ts）。橋の下の溝と OSM の水面の形に沿って作る
      if (!bridge) {
        for (let s = st.from + 12; s < st.to - 4; s += 20) if (!route.reserved?.some(z => z.noPiers && s > z.from && s < z.to)) pier(batch, ctx, s, 1.1, false, bounds(s));
      }
    }
  }
  batch.build({ concrete, brick: new THREE.MeshLambertMaterial({ color: 0x9c5a44 }), steel: new THREE.MeshLambertMaterial({ color: 0x5f7488 }), mbody: new THREE.MeshLambertMaterial({ vertexColors: true }) }, scene);
  if (lamps.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lampMat, lamps.length);
    lamps.forEach((m, i) => im.setMatrixAt(i, m)); im.computeBoundingSphere(); im.userData.noShadow = true; scene.add(im);
  }

  if (MT) buildRockSheds(ctx, MT);
  if (!MT) buildExtraDecks(ctx, bounds);
  // トンネル出入り判定（カメラ位置基準）
  const tunnels = list.filter(s => s.kind === 'tunnel');
  if (!tunnels.length) return;
  let inside = false, guess = ctx.state.train.s;
  ctx.events.on('reset', () => { if (inside) { inside = false; ctx.events.emit('tunnel', { inside }); } });
  ctx.events.on('frame', () => {
    const tr = ctx.state.train.s;
    let s = tr, lat = -.45, y = ctx.camera.position.y - T.trackY(tr);
    if (ctx.cameraMode !== 'cab') {
      const r = nearestS(ctx, ctx.camera.position, guess); s = r.s; lat = r.lat; y = ctx.camera.position.y - T.trackY(s);
    }
    guess = s;
    const now = tunnels.some(t => s > t.from + .5 && s < t.to - .5) && Math.abs(lat - TUNNEL_CENTER) < TUNNEL_HALF && y < TUNNEL_WALL_H + TUNNEL_HALF;
    if (now !== inside) { inside = now; ctx.events.emit('tunnel', { inside }); }
  });
}

/** 追加の線路のうち本線の床版の外に出る区間（離れていく支線・入出庫線）の細い床版と橋脚。高架区間（structures）の中だけ */
function buildExtraDecks(ctx: GameContext, bounds: (s: number) => [number, number]): void {
  const { route, track, scene } = ctx, T = getTerrain(ctx);
  const batch = new GeoBatch();
  for (const x of route.extraTracks ?? []) {
    if (x.ownDeck === false) continue;
    // 床版の外に出る区間を集める
    const runs: [number, number][] = [];
    let a: number | null = null;
    for (let s = x.from; s <= x.to + .01; s += 2) {
      const [L, R] = bounds(s), l = profileLat(x.lat, s), out = (l - 2.6 > R - .5 || l + 2.6 < L + .5) && !!T.structureAt(s, 0) && T.trackY(s) - T.groundY(s) > 1.5;
      if (out && a == null) a = s;
      if (!out && a != null) { runs.push([a, s]); a = null; }
    }
    if (a != null) runs.push([a, x.to]);
    for (const [s0, s1] of runs) {
      const lo = (s: number) => profileLat(x.lat, s), [d0, d1] = x.deckSpan ?? [-2.7, 2.7];
      scene.add(extrudeFn(track, s => { const l = lo(s); return [[l + d0, .02], [l + d0, -1.0], [l + d1, -1.0], [l + d1, .02]]; }, s0, s1, 2, concrete));
      for (const e of [d0 + .15, d1 - .15]) scene.add(extrudeFn(track, s => { const l = lo(s) + e; return [[l - .12, .02], [l - .12, .7], [l + .12, .7], [l + .12, .02]]; }, s0, s1, 2, concrete));
      for (let s = s0 + 8; s < s1 - 2; s += 16) {
        const t = track.trackAt(s), p = track.at(s, lo(s) + (d0 + d1) / 2, 0), g = T.groundY(s) - .5, top = T.trackY(s) - 1.0;
        if (top - g > .3) batch.add('concrete', P.boxB, M(p.x, g, p.z, -t.phi, 1.4, top - g, 1.4), 0xffffff);
      }
    }
  }
  batch.build({ concrete }, scene);
}

/** 単線の橋（split）の橋脚: 小判形の胴（煉瓦積み 'brick' または 'concrete'）と笠石。胴は川底（OSM の水面の溝を含む地面）から桁の下まで */
function slimPier(b: GeoBatch, ctx: GameContext, s: number, edges: [number, number], style: 'brick' | 'concrete'): void {
  const T = getTerrain(ctx), t = ctx.track.trackAt(s), c = (edges[0] + edges[1]) / 2, p = ctx.track.at(s, c, 0);
  const g = Math.min(T.groundY(s), T.terrainY(s, c)) - .5, top = T.trackY(s) - 2.9, h = top - g;
  if (h <= .2) return;
  b.add(style, P.cyl, M(p.x, g + h / 2, p.z, -t.phi, 4.2, h, 1.7), 0xffffff);
  b.add('concrete', P.box, M(p.x, top - .15, p.z, -t.phi, 4.8, .3, 2.2), 0xffffff);
}

/** 橋脚（高架はラーメン、橋梁は小判形） */
function pier(b: GeoBatch, ctx: GameContext, s: number, beamDepth: number, river: boolean, edges: [number, number]): void {
  const T = getTerrain(ctx), t = ctx.track.trackAt(s), g = T.groundY(s) - .5, top = T.trackY(s) - beamDepth;
  const h = top - g;
  if (h <= .2) return;
  const [left, right] = edges, c = (left + right) / 2;
  if (river) {
    const p = ctx.track.at(s, c, 0);
    b.add('concrete', P.cyl, M(p.x, g + h / 2, p.z, -t.phi, Math.min(9, right - left + 1), h, 2.4), 0xffffff);
    return;
  }
  const columns = [left + 1.7, right - 1.7];
  if (right - left > 18) columns.push(c - 3.6, c + 3.6);
  for (const l of columns) {
    const p = ctx.track.at(s, l, 0);
    b.add('concrete', P.boxB, M(p.x, g, p.z, -t.phi, 1.0, h, 1.0), 0xffffff);
  }
  const p = ctx.track.at(s, c, 0);
  b.add('concrete', P.boxB, M(p.x, top - 1.0, p.z, -t.phi, right - left, 1.0, 1.2), 0xffffff);
}

/** 坑口: 山の断面（アーチ穴あき）＋コンクリート面壁 */
function buildPortal(ctx: GameContext, s: number, back: boolean, terrainY: (s: number, lat: number) => number,
  range = 150, bottomY?: (s: number, lat: number) => number, capColor = 0x55703f, parent: THREE.Object3D = ctx.scene): void {
  const { track } = ctx, t = track.trackAt(s), base = t.y;
  const sx = back ? 1 : -1; // 前向き坑口は x を反転して作る
  const arch = archProfile().map(([l, y]) => new THREE.Vector2(sx * l, y));
  // 山の断面
  const outer: THREE.Vector2[] = [];
  for (let l = -range; l <= range + 4; l += 8) outer.push(new THREE.Vector2(sx * (l + TUNNEL_CENTER - 2), Math.max(.5, terrainY(s, l + TUNNEL_CENTER - 2) - base)));
  if (bottomY) {
    // 下端: 坑口の外の地表（尾根を除く）に沿わせる
    for (let l = range + 4; l >= -range; l -= 8) outer.push(new THREE.Vector2(sx * (l + TUNNEL_CENTER - 2), Math.min(-.5, bottomY(s, l + TUNNEL_CENTER - 2) - base - .3)));
  } else outer.push(new THREE.Vector2(sx * 152, -.5), new THREE.Vector2(-sx * 150, -.5));
  const shape = new THREE.Shape(back ? outer : outer.reverse());
  const hole = new THREE.Path(back ? [...arch].reverse() : arch);
  shape.holes.push(hole);
  const capMat = new THREE.MeshLambertMaterial({ color: capColor, side: THREE.DoubleSide });
  const cap = new THREE.Mesh(new THREE.ShapeGeometry(shape), capMat);
  const grp = new THREE.Group(); grp.position.copy(track.at(s, 0, 0)); grp.rotation.y = -t.phi + (back ? 0 : Math.PI); parent.add(grp);
  grp.add(cap);
  // 面壁（アーチ穴あきの板を押し出し）
  const c = TUNNEL_CENTER * sx, W = 8.5, H = TUNNEL_WALL_H + TUNNEL_HALF + 2.2;
  const face = new THREE.Shape([new THREE.Vector2(c - W, -.3), new THREE.Vector2(c + W, -.3), new THREE.Vector2(c + W, H), new THREE.Vector2(c - W, H)]);
  face.holes.push(new THREE.Path(archProfile().map(([l, y]) => new THREE.Vector2(sx * l, y))));
  const fg = new THREE.ExtrudeGeometry(face, { depth: 1.0, bevelEnabled: false });
  const fm = new THREE.Mesh(fg, concrete); fm.position.z = -.2; grp.add(fm);
  // 笠石
  const coping = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + .6, .5, 1.6), concrete); coping.position.set(c, H + .2, .3); grp.add(coping);
  // 坑口銘板（架空）
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.2, .6), new THREE.MeshLambertMaterial({ color: 0x3b3f44 }));
  plate.position.set(c, TUNNEL_WALL_H + TUNNEL_HALF + 1.0, 1.02); grp.add(plate);
}
