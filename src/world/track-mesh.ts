// 線路（バラスト・レール・枕木）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Track } from '../route/track';
import { islandOffset, islandZones, loopShape, loopZones, profileTransitions, trackLines, type LoopZone } from '../route/service';
import { cullByDistance } from './cull';

const GAUGE = 0.7175; // 軌間の半分 [m]（阪急は標準軌 1435mm）
/** 分岐器の長枕木を使う線間隔の上限 [m]。枕木長 2.0m より十分広がったら各線の独立した枕木に分ける（長枕木の長さ = 線間隔 + 2.0） */
const LONG_SLEEPER_MAX_GAP = 2.6;

/** 線路に沿った押し出しメッシュ。profile = [横位置, 高さ][] */
export function extrudeAlong(track: Track, profile: [number, number][], s0: number, s1: number, step: number, mat: THREE.Material): THREE.Mesh {
  const n = Math.ceil((s1 - s0) / step) + 1, m = profile.length;
  const pos = new Float32Array(n * m * 3), idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = track.trackAt(Math.min(s0 + i * step, s1));
    for (let j = 0; j < m; j++) {
      const [l, y] = profile[j], k = (i * m + j) * 3;
      pos[k] = t.x + t.rx * l; pos[k + 1] = y + t.y; pos[k + 2] = t.z + t.rz * l;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** 断面が s で変わる押し出しメッシュ（待避線・分岐器用）。fn(s) = [横位置, 高さ][]（点数一定） */
export function extrudeFn(track: Track, fn: (s: number) => [number, number][], s0: number, s1: number, step: number, mat: THREE.Material): THREE.Mesh {
  const n = Math.ceil((s1 - s0) / step) + 1, m = fn(s0).length;
  const pos = new Float32Array(n * m * 3), idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.min(s0 + i * step, s1), t = track.trackAt(s), prof = fn(s);
    for (let j = 0; j < m; j++) {
      const [l, y] = prof[j], k = (i * m + j) * 3;
      pos[k] = t.x + t.rx * l; pos[k + 1] = y + t.y; pos[k + 2] = t.z + t.rz * l;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** 2面4線駅の待避線1本（base = 本線の横位置、off = 本線からの振れ） */
export interface LoopTrack { z: LoopZone & { index: number }; base: number; off: number; lat(s: number): number }

/** 待避線の一覧（自線側は左、対向線側は右へ鏡像） */
export function loopTracks(ctx: GameContext): LoopTrack[] {
  const L0 = Math.min(...ctx.route.tracks), L1 = Math.max(...ctx.route.tracks);
  // 海浜公園は一方向だけの第3線。両側へ鏡像の4線を生成しない。
  return loopZones(ctx.route).filter(z => ctx.route.stations[z.index].layout !== 'hamadera').flatMap(z => [
    { z, base: L0, off: z.lat },
    ...(L1 !== L0 ? [{ z, base: L1, off: -z.lat }] : []),
  ].map(o => ({ ...o, lat: (s: number) => o.base + o.off * loopShape(z, s) })));
}

export function buildTrackMesh(ctx: GameContext): void {
  const { scene, track, route } = ctx, { trackAt, at } = track;
  const TS0 = route.extent.from, TS1 = route.extent.to;
  const matBallast = new THREE.MeshLambertMaterial({ color: 0x8a8378, side: THREE.DoubleSide });
  const matRail = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: .8, roughness: .35, side: THREE.DoubleSide });
  const matSleeper = new THREE.MeshLambertMaterial({ color: 0x6b6259 });
  // 島式1面2線駅の区間は線路が左右へ開く（S字）ので断面を s ごとに求める。それ以外は直線の押し出し
  const isl = islandZones(route);
  for (const c of route.tracks) {
    let a = TS0;
    // 横位置が変わる線（複々線・頭端駅の番線への振れ）: S字の区間は細かい断面、それ以外は従来の刻み
    const prof = route.trackProfiles?.[String(c)];
    if (prof) {
      const l = (s: number) => c + islandOffset(route, c, s);
      const fine = [...profileTransitions(prof).map(t => [t.from, t.to]), ...isl.map(z => [z.inFrom, z.outTo])].sort((p, q) => p[0] - q[0]);
      const cuts: [number, number, boolean][] = [];
      let q0 = TS0;
      for (const [f0, f1] of fine) {
        const a = Math.max(q0, f0), b = Math.min(TS1, f1);
        if (b <= a) continue;
        if (a > q0) cuts.push([q0, a, false]);
        cuts.push([a, b, true]); q0 = b;
      }
      if (q0 < TS1) cuts.push([q0, TS1, false]);
      // 単線区間（route.hiddenTracks）は他の線と重なっているので、その範囲は描かない
      const shown: [number, number, boolean][] = [];
      for (const [s0, s1, f] of cuts) {
        let from = s0;
        for (const h of (route.hiddenTracks ?? []).filter(q => q.track === c).sort((p, q) => p.from - q.from)) {
          if (h.to <= from || h.from >= s1) continue;
          if (h.from > from) shown.push([from, h.from, f]);
          from = Math.max(from, h.to);
        }
        if (s1 > from) shown.push([from, s1, f]);
      }
      for (const [s0, s1, f] of shown) {
        if (s1 - s0 < .5) continue;
        scene.add(extrudeFn(track, s => { const m = l(s); return [[m - 2.3, 0.0], [m - 1.4, 0.22], [m + 1.4, 0.22], [m + 2.3, 0.0]]; }, s0, s1, f ? 2 : 4, matBallast));
        for (const g of [-GAUGE, GAUGE])
          scene.add(extrudeFn(track, s => { const r = l(s) + g; return [[r - .035, .24], [r - .035, .38], [r + .035, .38], [r + .035, .24]]; }, s0, s1, f ? 1 : 3, matRail));
      }
      continue;
    }
    const piece = (s0: number, s1: number, island: boolean) => {
      if (s1 - s0 < 1) return;
      const l = (s: number) => c + (island ? islandOffset(route, c, s) : 0);
      scene.add(extrudeFn(track, s => { const m = l(s); return [[m - 2.3, 0.0], [m - 1.4, 0.22], [m + 1.4, 0.22], [m + 2.3, 0.0]]; }, s0, s1, island ? 2 : 4, matBallast));
      for (const g of [-GAUGE, GAUGE])
        scene.add(extrudeFn(track, s => { const r = l(s) + g; return [[r - .035, .24], [r - .035, .38], [r + .035, .38], [r + .035, .24]]; }, s0, s1, island ? 1 : 3, matRail));
    };
    for (const z of isl) {
      const z0 = Math.max(TS0, z.inFrom), z1 = Math.min(TS1, z.outTo);
      if (z1 <= a) continue;
      piece(a, z0, false); piece(z0, z1, true); a = z1;
    }
    piece(a, TS1, false);
  }
  // 枕木（200m ごとの InstancedMesh。遠方は距離カリング）
  {
    const geo = new THREE.BoxGeometry(2.4, 0.14, 0.22), sp = 0.65, CH = 200;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    const loops = loopTracks(ctx), wide = new THREE.Vector3();
    for (let s0 = TS0; s0 < TS1; s0 += CH) {
      const s1 = Math.min(TS1, s0 + CH), cnt = Math.ceil((s1 - s0) / sp) * route.tracks.length * 2;
      const inst = new THREE.InstancedMesh(geo, matSleeper, cnt);
      let i = 0;
      for (let k = Math.ceil((s0 - TS0) / sp); TS0 + k * sp < s1 && i < cnt - 1; k++) for (const c of route.tracks) {
        const s = TS0 + k * sp, t = trackAt(s); q.setFromEuler(e.set(0, -t.phi, 0));
        if (route.hiddenTracks?.some(h => h.track === c && s >= h.from && s <= h.to)) continue; // 単線区間: 重なっている線の枕木は作らない
        const lp = loops.find(o => o.base === c && s > o.z.inFrom && s < o.z.outTo);
        const d = lp ? lp.lat(s) - c : 0;
        const co = c + islandOffset(route, c, s); // 島式ホーム駅の S字
        if (lp && Math.abs(d) < LONG_SLEEPER_MAX_GAP) {
          // 分岐器の入口・出口付近: 本線と分岐線にまたがる長枕木（線間隔が枕木長より広がるまで）
          inst.setMatrixAt(i++, m4.compose(at(s, c + d / 2, .27), q, wide.set((Math.abs(d) + 2) / 2, 1, 1)));
          continue;
        }
        inst.setMatrixAt(i++, m4.compose(at(s, co, .27), q, one));
        if (lp) inst.setMatrixAt(i++, m4.compose(at(s, c + d, .27), q, one));
      }
      inst.count = i; inst.computeBoundingSphere(); scene.add(inst);
      cullByDistance(ctx, inst, 700);
    }
  }
  buildLoopTracks(ctx, matBallast, matRail);
  if (route.singleTrack) buildSingleTrackExtras(ctx, matBallast, matRail, matSleeper);
  // 追加の線路が無くても、頭端駅の route.tracks の終端には車止めを作る（みさき公園〜和歌山港の和歌山港）
  else if (route.extraTracks?.length || trackLines(route).some(l => l.bumpers.length)) buildExtraTracks(ctx, matBallast, matRail, matSleeper);
  // 地面は terrain.ts
  // 架線柱・架線は catenary.ts
}

/** 待避線のバラスト・レールと分岐器（転てつ機・クロッシング・ガードレール） */
function buildLoopTracks(ctx: GameContext, matBallast: THREE.Material, matRail: THREE.Material): void {
  const { scene, track } = ctx;
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d52 });
  const machine = new THREE.MeshLambertMaterial({ color: 0x8a8f72 });
  for (const o of loopTracks(ctx)) {
    const { z, base } = o, dir = Math.sign(o.off);
    const s0 = z.inFrom, s1 = z.outTo;
    // バラスト: 待避線の外側の法面から本線の道床まで埋める（2線の道床は一続きの路盤。枕木は別に各線ごと）
    scene.add(extrudeFn(track, s => {
      const l = o.lat(s);
      return dir < 0 ? [[l - 2.3, 0], [l - 1.4, .215], [base - 1.0, .215]] : [[base + 1.0, .215], [l + 1.4, .215], [l + 2.3, 0]];
    }, s0, s1, 2, matBallast));
    // レール（本線と重なる分岐部で z-fight しないよう僅かに上げる）
    for (const g of [-GAUGE, GAUGE]) {
      scene.add(extrudeFn(track, s => {
        const r = o.lat(s) + g;
        return [[r - .035, .243], [r - .035, .383], [r + .035, .383], [r + .035, .243]];
      }, s0, s1, 1, matRail));
    }
    // 分岐器の部品（入口・出口）
    const grp = new THREE.Group();
    const put = (geo: THREE.BufferGeometry, m: THREE.Material, s: number, lat: number, y: number) => {
      const t = track.trackAt(s), mesh = new THREE.Mesh(geo, m);
      mesh.position.copy(track.at(s, lat, y)); mesh.rotation.y = -t.phi; grp.add(mesh);
    };
    const ends: [number, number, number][] = [[z.inFrom, z.inTo, 1], [z.outTo, z.outFrom, -1]];
    for (const [from, to, sgn] of ends) {
      // 転てつ機（分岐の起点、本線の外側）と動作かん
      put(new THREE.BoxGeometry(.5, .35, 1.0), machine, from + sgn * 1.5, base - dir * 1.6, .35);
      put(new THREE.BoxGeometry(1.0, .06, .08), steel, from + sgn * 1.5, base - dir * .9, .33);
      // トングレール付近の床板
      put(new THREE.BoxGeometry(1.4, .04, 6), steel, from + sgn * 3.5, base + dir * .1, .262);
      // クロッシング: 分岐線の内側レールが本線のレールと交わる位置
      let fs = to;
      for (let k = 0; k <= 200; k++) {
        const s = from + (to - from) * k / 200;
        if (Math.abs(o.lat(s) - base) >= GAUGE * 2) { fs = s; break; }
      }
      put(new THREE.BoxGeometry(.5, .08, 3.2), steel, fs, base + dir * GAUGE, .3);
      // ガードレール（反対側レールの内側）
      put(new THREE.BoxGeometry(.06, .1, 4.5), steel, fs, base - dir * (GAUGE - .12), .33);
      put(new THREE.BoxGeometry(.06, .1, 4.5), steel, fs, o.lat(fs) - dir * (GAUGE - .12), .33);
    }
    scene.add(grp); cullByDistance(ctx, grp, 700);
  }
}

/** 複線の路線の追加の線路（route.extraTracks: 複々線の線・頭端駅の番線・支線・渡り線）: バラスト・レール・枕木・車止め。
 *  他の線と重なる分岐部は枕木を省き、近い所は両線にまたがる長枕木にする。頭端駅の route.tracks の終端の車止めもここで作る */
function buildExtraTracks(ctx: GameContext, matBallast: THREE.Material, matRail: THREE.Material, matSleeper: THREE.Material): void {
  const { scene, track, route } = ctx;
  const lines = trackLines(route), extras = lines.filter(l => l.kind === 'extra');
  const sleeperGeo = new THREE.BoxGeometry(2.4, 0.14, 0.22);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  const red = new THREE.MeshLambertMaterial({ color: 0xc8322a }), white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d52 });
  for (const l of extras) {
    if (l.to - l.from < 1) continue;
    const others = lines.filter(o => o !== l);
    /** s で最も近い他の線の横位置 */
    const near = (s: number) => {
      let best = Infinity, lat = l.lat(s);
      for (const o of others) if (s >= o.from && s <= o.to) { const d = o.lat(s) - lat; if (Math.abs(d) < Math.abs(best)) best = d; }
      return best;
    };
    const CH = 200;
    for (let s0 = l.from; s0 < l.to; s0 += CH) {
      const s1 = Math.min(l.to, s0 + CH);
      const grp = new THREE.Group();
      grp.add(extrudeFn(track, s => { const m = l.lat(s); return [[m - 2.3, 0.0], [m - 1.4, 0.215], [m + 1.4, 0.215], [m + 2.3, 0.0]]; }, s0, s1, 2, matBallast));
      for (const g of [-GAUGE, GAUGE])
        grp.add(extrudeFn(track, s => { const r = l.lat(s) + g; return [[r - .035, .243], [r - .035, .383], [r + .035, .383], [r + .035, .243]]; }, s0, s1, 1, matRail));
      const n = Math.ceil((s1 - s0) / .65), inst = new THREE.InstancedMesh(sleeperGeo, matSleeper, n + 1);
      let i = 0;
      for (let s = s0; s < s1 && i <= n; s += .65) {
        const t = track.trackAt(s), a = l.lat(s), d = near(s);
        // 線路の向き（横位置の変化）に合わせて枕木を回す
        const slope = (l.lat(s + .5) - l.lat(s - .5));
        q.setFromEuler(e.set(0, -t.phi - Math.atan(slope), 0));
        if (Math.abs(d) < .3) continue;
        if (Math.abs(d) < LONG_SLEEPER_MAX_GAP) inst.setMatrixAt(i++, m4.compose(track.at(s, a + d / 2, .265), q, sc.set((Math.abs(d) + 2) / 2, 1, 1)));
        else inst.setMatrixAt(i++, m4.compose(track.at(s, a, .27), q, sc.set(1, 1, 1)));
      }
      inst.count = i; inst.computeBoundingSphere(); grp.add(inst);
      scene.add(grp); cullByDistance(ctx, grp, 900);
    }
  }
  // 車止め（追加の線・頭端駅の route.tracks の終端）
  for (const l of lines) for (const b of l.bumpers) {
    const inward = Math.abs(b - l.from) < Math.abs(b - l.to) ? 1 : -1, s = b + inward * 1.2, lat = l.lat(s);
    const t = track.trackAt(s), grp = new THREE.Group();
    grp.name = 'track-bumper'; grp.userData.clearanceExempt = 'rail-stop';
    grp.position.copy(track.at(s, lat, 0)); grp.rotation.y = -t.phi;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, .5, .35), red); beam.position.set(0, 1.0, 0); grp.add(beam);
    for (const x of [-.6, .6]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(.4, .52, .37), white); st.position.set(x, 1.0, 0); grp.add(st);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.3, .12), steel); leg.position.set(x * 1.4, .6, inward * -.5); leg.rotation.x = inward * .5; grp.add(leg);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.25, .25, .1), new THREE.MeshBasicMaterial({ color: 0xff3020 })); lamp.position.set(0, 1.5, -inward * .2); grp.add(lamp);
    scene.add(grp); cullByDistance(ctx, grp, 700);
  }
}

/** 単線の駅の右の線（交換・島式駅）と副線: バラスト・レール・枕木、両開き分岐器の部品、行き止まりの車止め。本線（自列車の線）は buildTrackMesh が描く */
function buildSingleTrackExtras(ctx: GameContext, matBallast: THREE.Material, matRail: THREE.Material, matSleeper: THREE.Material): void {
  const { scene, track, route } = ctx;
  const lines = trackLines(route), main = lines.find(l => l.kind === 'main')!;
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d52 });
  const machine = new THREE.MeshLambertMaterial({ color: 0x8a8f72 });
  const red = new THREE.MeshLambertMaterial({ color: 0xc8322a }), white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const sleeperGeo = new THREE.BoxGeometry(2.4, 0.14, 0.22);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  /** 分かれる側の線（副線は合流先の島式の線） */
  const parentOf = (l: (typeof lines)[number]) => (s: number) => l.kind === 'bay' ? (lines.find(o => o.kind === 'passing' && s >= o.from && s <= o.to && Math.sign(o.lat(s) || 1) === Math.sign(l.lat(s))) ?? main).lat(s) : main.lat(s);
  for (const l of lines) {
    if (l.kind === 'main' || l.to - l.from < 1) continue;
    const par = parentOf(l);
    scene.add(extrudeFn(track, s => { const m = l.lat(s); return [[m - 2.3, 0.0], [m - 1.4, 0.215], [m + 1.4, 0.215], [m + 2.3, 0.0]]; }, l.from, l.to, 2, matBallast));
    for (const g of [-GAUGE, GAUGE])
      scene.add(extrudeFn(track, s => { const r = l.lat(s) + g; return [[r - .035, .243], [r - .035, .383], [r + .035, .383], [r + .035, .243]]; }, l.from, l.to, 1, matRail));
    // 枕木（本線と近い分岐部は両線にまたがる長い枕木）
    const n = Math.ceil((l.to - l.from) / .65), inst = new THREE.InstancedMesh(sleeperGeo, matSleeper, n + 1);
    let i = 0;
    for (let s = l.from; s < l.to && i <= n; s += .65) {
      const t = track.trackAt(s), a = l.lat(s), b = par(s), d = a - b;
      q.setFromEuler(e.set(0, -t.phi, 0));
      if (Math.abs(d) < .3) continue;
      if (Math.abs(d) < LONG_SLEEPER_MAX_GAP) inst.setMatrixAt(i++, m4.compose(track.at(s, b + d / 2, .265), q, sc.set((Math.abs(d) + 2) / 2, 1, 1)));
      else inst.setMatrixAt(i++, m4.compose(track.at(s, a, .27), q, sc.set(1, 1, 1)));
    }
    inst.count = i; inst.computeBoundingSphere(); scene.add(inst); cullByDistance(ctx, inst, 700);
    // 分岐器（分かれる点）: 転てつ機・床板・クロッシング
    const grp = new THREE.Group();
    const put = (geo: THREE.BufferGeometry, m: THREE.Material, s: number, lat: number, y: number) => {
      const t = track.trackAt(s), mesh = new THREE.Mesh(geo, m);
      mesh.position.copy(track.at(s, lat, y)); mesh.rotation.y = -t.phi; grp.add(mesh);
    };
    for (const end of [l.from, l.to]) {
      if (l.bumpers.some(b => Math.abs(b - end) < 1)) continue;
      const sgn = end === l.from ? 1 : -1, b0 = par(end), dir = Math.sign(l.lat(end + sgn * 30) - par(end + sgn * 30)) || 1;
      put(new THREE.BoxGeometry(.5, .35, 1.0), machine, end + sgn * 1.5, b0 - dir * 1.6, .35);
      put(new THREE.BoxGeometry(1.0, .06, .08), steel, end + sgn * 1.5, b0 - dir * .9, .33);
      put(new THREE.BoxGeometry(1.4, .04, 6), steel, end + sgn * 3.5, b0 + dir * .1, .262);
      let fs = end + sgn * 20;
      for (let k = 0; k <= 120; k++) { const s = end + sgn * k * .5; if (Math.abs(l.lat(s) - par(s)) >= GAUGE * 2) { fs = s; break; } }
      put(new THREE.BoxGeometry(.5, .08, 3.2), steel, fs, (l.lat(fs) + par(fs)) / 2, .3);
    }
    scene.add(grp); cullByDistance(ctx, grp, 700);
  }
  // 車止め（頭端駅の線路の終端・副線の端）: 赤白の受け台と2本の支柱
  for (const l of lines) for (const b of l.bumpers) {
    const inward = Math.abs(b - l.from) < Math.abs(b - l.to) ? 1 : -1, s = b + inward * 1.2, lat = l.lat(s);
    const t = track.trackAt(s), grp = new THREE.Group();
    grp.name = 'track-bumper'; grp.userData.clearanceExempt = 'rail-stop';
    grp.position.copy(track.at(s, lat, 0)); grp.rotation.y = -t.phi;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, .5, .35), red); beam.position.set(0, 1.0, 0); grp.add(beam);
    for (const x of [-.6, .6]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(.4, .52, .37), white); st.position.set(x, 1.0, 0); grp.add(st);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.3, .12), steel); leg.position.set(x * 1.4, .6, inward * -.5); leg.rotation.x = inward * .5; grp.add(leg);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.25, .25, .1), new THREE.MeshBasicMaterial({ color: 0xff3020 })); lamp.position.set(0, 1.5, -inward * .2); grp.add(lamp);
    scene.add(grp); cullByDistance(ctx, grp, 700);
  }
}

