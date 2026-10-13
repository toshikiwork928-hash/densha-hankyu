// 山岳線の駅: 起点の町の駅（島式＋副線の片面ホーム・駅舎・跨線橋）、交換駅（島式＋小さな木造駅舎・構内踏切）、
// 棒線駅（片面ホーム・待合所）、終点の頭端駅（谷間の島式ホーム・頭端の駅舎・ケーブルカーのりば・朱色の橋）
import * as THREE from 'three';
import { FONT } from '../core/config';
import type { GameContext } from '../core/context';
import type { Station } from '../route/types';
import { bayZone } from '../route/service';
import { GeoBatch, M, P, onLight } from './batch';
import { canvasTex } from './canvas-tex';
import { cullByDistance } from './cull';
import { getTerrain } from './terrain';
import type { MountainTerrain, StationYard } from './mountain-terrain';
import { buildIsland, buildStation, nameTex, person } from './stations';

const VERMILION = 0xc8402c, WOOD = 0x6b4f38, WALL = 0xe6dfcf, ROOF = 0x4a5560, CONC = 0xc9c5bc;

/** 線路基準の配置ヘルパ（s・横位置・絶対標高） */
class Put {
  b = new GeoBatch();
  constructor(private ctx: GameContext) {}
  yaw(s: number) { return -this.ctx.track.trackAt(s).phi; }
  pos(s: number, lat: number) { const t = this.ctx.track.trackAt(s); return { x: t.x + t.rx * lat, z: t.z + t.rz * lat }; }
  /** 箱（中心）。w = 横方向、d = 線路方向 */
  box(s: number, lat: number, y: number, w: number, h: number, d: number, col: number, rx = 0, rz = 0) {
    const p = this.pos(s, lat); this.b.add('body', P.box, M(p.x, y, p.z, this.yaw(s), w, h, d, rx, rz), col);
  }
  /** 切妻屋根（棟は線路方向 = ridgeAlong、または横方向） */
  gable(s: number, lat: number, y: number, w: number, h: number, d: number, col: number, ridgeAlong = true) {
    const p = this.pos(s, lat); this.b.add('body', P.gable, M(p.x, y, p.z, this.yaw(s) + (ridgeAlong ? 0 : Math.PI / 2), ridgeAlong ? w : d, h, ridgeAlong ? d : w), col);
  }
  cyl(s: number, lat: number, y: number, r: number, h: number, col: number) {
    const p = this.pos(s, lat); this.b.add('body', P.cyl, M(p.x, y, p.z, 0, r * 2, h, r * 2), col);
  }
  build(): THREE.Group {
    const g = new THREE.Group();
    for (const m of this.b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, g)) { m.castShadow = m.receiveShadow = true; }
    this.ctx.scene.add(g); cullByDistance(this.ctx, g, 1800);
    return g;
  }
}

/** 駅舎の看板（線路から・駅前から読める向きに 2 枚） */
function nameBoard(ctx: GameContext, text: string, s: number, lat: number, y: number, w: number, yawOff: number, bg = '#1d2a5a', fg = '#fff'): void {
  const tex = canvasTex(1024, 192, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.font = `800 112px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + 6, W - 40);
  });
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .05, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 192 / 1024), mat);
  const t = ctx.track.trackAt(s);
  m.position.set(t.x + t.rx * lat, y, t.z + t.rz * lat); m.rotation.y = -t.phi + yawOff;
  ctx.scene.add(m);
  onLight(ctx, f => { mat.emissiveIntensity = .05 + f * .75; });
}

/** 小さな木造駅舎（交換駅・棒線駅）。lat = 中心、side = 線路から見て外側の向き */
function smallBuilding(P3: Put, s: number, lat: number, y: number, side: number, w: number, d: number): void {
  P3.box(s, lat, y + .25, w + .4, .5, d + .4, 0x9a968c); // 基礎
  P3.box(s, lat, y + .5 + 1.6, w, 3.2, d, WALL);
  for (const dz of [-d / 2 + .1, d / 2 - .1]) P3.box(s + dz, lat, y + .5 + 1.6, w + .05, 3.2, .18, WOOD); // 柱
  P3.box(s, lat, y + .5 + .45, w + .04, .9, d + .04, 0x7a5c42); // 腰板
  P3.gable(s, lat, y + 3.7, w + 1.6, 1.6, d + 1.6, ROOF);
  // 線路側の出入口・窓
  const face = lat - side * (w / 2 + .03);
  P3.box(s, face, y + 1.6, .05, 2.2, 2.0, 0x2b343d);
  for (const dz of [-d / 2 + 2, d / 2 - 2]) P3.box(s + dz, face, y + 2.1, .05, 1.0, 1.6, 0x2b343d);
  P3.box(s, face - side * .8, y + 3.0, 1.6, .1, 3.2, 0x5a5a5a); // 庇
}

export function buildMountainStations(ctx: GameContext): void {
  const T = getTerrain(ctx) as MountainTerrain, st = ctx.route.stations;
  for (const y of T.yards) {
    const sta = st[y.index];
    const prev = st[y.index - 1]?.name ?? ctx.route.prevName ?? '', next = st[y.index + 1]?.name ?? ctx.route.nextName ?? '';
    if (y.kind === 'town') townStation(ctx, T, sta, y, prev, next);
    else if (y.kind === 'loop') passingStation(ctx, T, sta, y, prev, next);
    else if (y.kind === 'terminal') terminalStation(ctx, T, sta, y, prev, next);
    else haltStation(ctx, T, sta, y, prev, next);
  }
}

const islandWidth = (sta: Station) => 2 * (sta.island?.spread ?? 4.2) - 3.4;

/** 起点の町の駅: 島式ホーム（本線・交換線）＋副線の片面ホームと駅舎、跨線橋でつなぐ */
function townStation(ctx: GameContext, T: MountainTerrain, sta: Station, y: StationYard, prev: string, next: string): void {
  const sc = (sta.platform.from + sta.platform.to) / 2, y0 = T.trackY(sc);
  if (sta.island) buildIsland(ctx, sta, prev, next, 0, islandWidth(sta), { stairs: true, roof: .75 });
  const bz = bayZone(sta);
  const side = bz ? Math.sign(bz.lat) : y.side, outer = bz ? Math.abs(bz.lat) : (sta.island?.spread ?? 0);
  // 副線の外側の片面ホーム＋駅舎・駅前広場（stations.ts の地上駅を流用。ホーム端は線路中心から 1.6m）
  buildStation(ctx, sta, prev, next, { lat: side * outer, side: side > 0 ? 'R' : 'L' });
  // 跨線橋（駅舎側の片面ホーム → 島式ホーム）。架線の上（床 8.2m）
  const P3 = new Put(ctx), a = side * (outer + 4.1), yb = y0 + 8.2, W = 3.6;
  const mid = a / 2, span = Math.abs(a) + 2;
  P3.box(sc, mid, yb + 1.4, span, 2.8, W, 0xdedad0);
  P3.box(sc, mid, yb + 2.95, span + .4, .25, W + .5, 0x6b7680);
  for (const dz of [-W / 2 - .01, W / 2 + .01]) for (let k = -span / 2 + 1.2; k < span / 2 - .8; k += 2.2) P3.box(sc + dz, mid + k, yb + 1.8, 1.6, .9, .04, 0x2b343d);
  for (const l of [0, a]) {
    P3.box(sc, l, (y0 + 1.1 + yb) / 2 + .6, 2.6, yb - y0 - 1.1, 3, 0xd8d4ca); // 階段室
    for (const dz of [-1.5, 1.5]) P3.box(sc + dz, l, (y0 + yb) / 2, .35, yb - y0, .35, 0x9aa0a6);
  }
  P3.build();
}

/** 交換駅: 島式ホーム（上屋は短い）＋山側の小さな木造駅舎、ホーム端の構内踏切 */
function passingStation(ctx: GameContext, T: MountainTerrain, sta: Station, y: StationYard, prev: string, next: string): void {
  const sc = (sta.platform.from + sta.platform.to) / 2, y0 = T.trackY(sc), sp = sta.island?.spread ?? 4.2;
  buildIsland(ctx, sta, prev, next, 0, islandWidth(sta), { stairs: false, roof: .4 });
  const P3 = new Put(ctx), side = y.side;
  // 駅舎の庇（壁から1.6m）まで走行線から2m以上離す。
  const bs = sta.platform.from + 16, bl = side * (sp + 3.4 + 4.5);
  smallBuilding(P3, bs, bl, T.trackY(bs) - .05, side, 8, 14);
  // 構内踏切（ホーム端のスロープ → 外側の線路を渡って駅舎へ）
  const xs = sta.platform.from - 2.5, yx = T.trackY(xs);
  const pw = islandWidth(sta) / 2;
  P3.box(xs, side * (pw + sp + 3.4) / 2 + side * .2, yx + .36, sp * 2 - pw + 1.5, .08, 2.4, 0x7a6a56);
  P3.box(sta.platform.from + 3, side * pw * .45, yx + .65, pw * .9, .1, 7.5, CONC, Math.atan2(.8, 7.5) * 1, 0); // スロープ
  // 踏切の警標
  const xp = P3.pos(xs - 1.6, side * (sp + 2.4));
  P3.b.add('body', P.cyl6, M(xp.x, yx + 1.1, xp.z, 0, .08, 2.2, .08), 0x222222);
  P3.box(xs - 1.6, side * (sp + 2.4), yx + 2.1, .7, .7, .05, 0xf2d020, 0, Math.PI / 4);
  // ホームの外側の柵と、駅の灯り
  for (let s = sta.platform.from; s <= sta.platform.to; s += 12) {
    const p = P3.pos(s, side * (sp + 3.0));
    P3.b.add('body', P.cyl6, M(p.x, y0 + 2.4, p.z, 0, .14, 4.8, .14), 0x8a9096);
  }
  nameBoard(ctx, sta.name + '駅', bs, bl + side * 4.05, T.trackY(bs) + 3.2, 4.6, -side * Math.PI / 2);
  for (let k = 0; k < 3; k++) { const p = P3.pos(bs + (k - 1) * 3, bl + side * 5.6); P3.b.parent = new THREE.Matrix4().makeTranslation(0, T.trackY(bs), 0); person(P3.b, ctx.rng, p.x, p.z, ctx.rng() * 6); P3.b.parent = null; }
  P3.build();
}

/** 棒線駅: 片面ホーム（幅 3.2m）と待合所 */
function haltStation(ctx: GameContext, T: MountainTerrain, sta: Station, y: StationYard, prev: string, next: string): void {
  const s0 = sta.platform.from, s1 = sta.platform.to, sc = (s0 + s1) / 2, side = y.side, len = s1 - s0;
  const P3 = new Put(ctx), y0 = T.trackY(sc), c = side * 3.3;
  for (let s = s0; s < s1; s += 10) {
    const e = Math.min(s1, s + 10), m = (s + e) / 2, yy = T.trackY(m), l = e - s + .05;
    P3.box(m, c, yy + .55, 3.2, 1.1, l, CONC);
    P3.box(m, side * 2.3, yy + 1.11, .3, .02, l, 0xf2c200); // 点字ブロック
    P3.box(m, side * 1.85, yy + 1.115, .2, .03, l, 0xf4f4f4);
    P3.box(m, side * 4.85, yy + 1.7, .04, 1.1, l, 0x8a9096); // 柵
  }
  for (let s = s0; s <= s1; s += 2.5) P3.box(s, side * 4.85, T.trackY(s) + 1.6, .06, 1.0, .06, 0x6b7076);
  // 待合所（三方が壁、片流れ屋根、ベンチ）
  const wy = y0 + 1.1;
  P3.box(sc, side * 4.6, wy + 1.3, .12, 2.6, 6, 0xb8b2a4);
  for (const dz of [-3, 3]) P3.box(sc + dz, side * 4.0, wy + 1.3, 1.3, 2.6, .12, 0xb8b2a4);
  P3.box(sc, side * 3.95, wy + 2.75, 1.8, .14, 6.6, ROOF, 0, -side * .12);
  P3.box(sc, side * 4.25, wy + .45, .45, .08, 4.6, 0x7a5a3a); // ベンチ
  // 駅名標（2 枚）・灯具の柱
  // 板の表は線路側へ向ける（stations.ts の buildStation と同じ: 左側のホームは表の右が進行方向＝次の駅、右側は前の駅）
  const tex = side < 0 ? nameTex(sta, prev, next) : nameTex(sta, next, prev);
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .05, side: THREE.DoubleSide });
  for (const z of [-len * .3, len * .3]) {
    const s = sc + z, p = P3.pos(s, side * 3.9), t = ctx.track.trackAt(s);
    for (const dz of [-1.5, 1.5]) P3.box(s + dz, side * 3.9, T.trackY(s) + 1.9, .08, 1.6, .08, 0x777d84);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.0), mat);
    m.position.set(p.x, T.trackY(s) + 3.0, p.z); m.rotation.y = -t.phi - side * (Math.PI / 2 - .55); ctx.scene.add(m);
  }
  onLight(ctx, f => { mat.emissiveIntensity = .05 + f * .75; });
  for (let s = s0 + 8; s < s1; s += 22) P3.box(s, side * 4.5, T.trackY(s) + 2.6, .12, 3.0, .12, 0x8a9096);
  // ホームへ下りる階段（端）
  const se = s0 - 3;
  P3.box(se, c, T.trackY(se) + .3, 2.2, .6, 6, CONC, -Math.atan2(1.1, 6), 0);
  const rnd = ctx.rng;
  for (let k = 0; k < 3; k++) { const s = sc + (rnd() - .5) * len * .6, p = P3.pos(s, side * (3.0 + rnd())); P3.b.parent = new THREE.Matrix4().makeTranslation(0, T.trackY(s) + 1.1, 0); person(P3.b, rnd, p.x, p.z, rnd() * 6); P3.b.parent = null; }
  P3.build();
}

/** 終点の頭端駅: 谷間の島式ホーム、頭端の駅舎（2 階・朱の柱）、山側のケーブルカーのりばと斜面を上る軌道、谷川に架かる朱色の橋 */
function terminalStation(ctx: GameContext, T: MountainTerrain, sta: Station, y: StationYard, prev: string, next: string): void {
  const { route } = ctx;
  const pw = islandWidth(sta), dir = y.endDir;
  buildIsland(ctx, sta, prev, next, 0, pw, { stairs: false, roof: .85 });
  const sEnd = dir > 0 ? route.extent.to : route.extent.from;
  const platEnd = dir > 0 ? sta.platform.to : sta.platform.from;
  const P3 = new Put(ctx), y0 = T.trackY(sEnd), side = y.side;
  // 頭端の通路（ホーム端 → 駅舎）
  const ca = platEnd, cb = sEnd + dir * 4, cm = (ca + cb) / 2;
  // 車止めまでは島式ホーム幅。頭端通路を線路の上へ張り出させない。
  P3.box(cm, 0, y0 + .55, pw, 1.1, Math.abs(cb - ca) + .5, CONC);
  const front = sEnd + dir * .5;
  P3.box((front + cb) / 2, 0, y0 + .55, 15, 1.1, Math.abs(cb - front), CONC);
  // 両線路を覆う上屋は、跨線橋と同じく架線より上（下面8.2m）へ。
  P3.box(cm, 0, y0 + 8.3, 15, .2, Math.abs(cb - ca) + .5, 0x6b7680);
  for (const l of [-7, 7]) P3.box(cm, l, y0 + 4.55, .25, 6.9, .25, 0x8a9096);
  // 駅舎（線路の先、横長の 2 階建て。屋根は入母屋風、朱の柱）
  const bs = sEnd + dir * 13, BW = 34, BD = 16;
  P3.box(bs, 0, y0 + .3, BW + 1, .6, BD + 1, 0x9a968c);
  P3.box(bs, 0, y0 + .6 + 3.2, BW, 6.4, BD, WALL);
  P3.box(bs, 0, y0 + 6.9, BW + 2.4, .35, BD + 2.4, 0x3d4650); // 1 階の庇
  P3.box(bs, 0, y0 + 7.2 + 1.5, BW - 6, 3.0, BD - 4, WALL);
  P3.gable(bs, 0, y0 + 10.2, BW - 3, 3.6, BD - 1, 0x3d4650, false);
  for (let l = -BW / 2; l <= BW / 2 + .01; l += BW / 6) for (const dz of [-BD / 2, BD / 2]) P3.box(bs + dz * dir, l, y0 + 3.6, .5, 6.6, .5, VERMILION);
  P3.box(bs - dir * (BD / 2 + .05), 0, y0 + 2.2, 10, 3.0, .06, 0x2b343d); // ホーム側の入口
  for (let l = -BW / 2 + 3; l < BW / 2 - 2; l += 3.5) if (Math.abs(l) > 6) P3.box(bs - dir * (BD / 2 + .05), l, y0 + 4.8, 2.2, 1.4, .06, 0x2b343d);
  nameBoard(ctx, sta.name + '駅', bs - dir * (BD / 2 + .12), 0, y0 + 6.2, 9, dir > 0 ? Math.PI : 0);
  nameBoard(ctx, sta.name + '駅', bs + dir * (BD / 2 + .12), 0, y0 + 6.2, 9, dir > 0 ? 0 : Math.PI);
  // ケーブルカーのりば（山側）と、斜面を上る軌道
  const cl = side * (BW / 2 + 9), cs = bs;
  P3.box(cs, cl, y0 + 4, 14, 8, 12, 0xd8d0bc);
  P3.gable(cs, cl, y0 + 8, 15, 2.4, 13, ROOF, false);
  P3.box(cs, cl - side * 7.05, y0 + 2.4, .06, 3.6, 5, 0x2b343d);
  nameBoard(ctx, 'ケーブルカーのりば', cs, cl - side * 7.12, y0 + 6.2, 7, -side * Math.PI / 2, '#7a1e14', '#fff');
  {
    const L0 = Math.abs(cl) + 7, L1 = L0 + 260;
    const ya = y0 + 2, yt = T.sample(cs, side * L1) + 4;
    const pt = (u: number) => { const l = L0 + (L1 - L0) * u; return { l: side * l, y: Math.max(ya + (yt - ya) * u, T.sample(cs, side * l) + .6) }; };
    const N = 26;
    for (let k = 0; k < N; k++) {
      const a = pt(k / N), b = pt((k + 1) / N), ml = (a.l + b.l) / 2, my = (a.y + b.y) / 2;
      const ang = Math.atan2(b.y - a.y, Math.abs(b.l - a.l)), len = Math.hypot(b.l - a.l, b.y - a.y) + .05;
      // 軌道は横方向（線路と直角）へ上る: 箱の幅方向 w を軌道方向として回す
      P3.box(cs, ml, my, len, .5, 3.2, 0xb0aca2, 0, side * ang);
      for (const g of [-.55, .55]) P3.box(cs + g, ml, my + .32, len, .12, .1, 0x777b80, 0, side * ang);
      // 支柱（地面から浮いている所）
      const gy = T.sample(cs, ml);
      if (my - gy > 1.5) P3.box(cs, ml, (my + gy) / 2, .5, my - gy, .5, 0xb0aca2);
    }
    // ケーブルカー（段になった車体）
    const a = pt(.3), b = pt(.3 + 12 / (L1 - L0)), ang = Math.atan2(b.y - a.y, Math.abs(b.l - a.l));
    P3.box(cs, (a.l + b.l) / 2, (a.y + b.y) / 2 + 2.0, 12, 2.8, 2.6, 0xd8402e, 0, side * ang);
    P3.box(cs, (a.l + b.l) / 2, (a.y + b.y) / 2 + 2.5, 11.4, .9, 2.65, 0x2b343d, 0, side * ang);
    // 山上駅
    const top = pt(1);
    P3.box(cs, top.l + side * 5, top.y + 3, 10, 6, 10, 0xd8d0bc);
    P3.gable(cs, top.l + side * 5, top.y + 6, 11, 2, 11, ROOF, false);
  }
  // 谷川に架かる朱色の橋（駅前から対岸へ。中央が少し高い）
  {
    const s = sEnd + dir * 34, vs = -side, r = T.riverLat(s), hw = T.riverHalf(s);
    const l0 = vs * (vs > 0 ? y.right : y.left) * .8, l1 = r + vs * (hw + 14);
    const ya = T.sample(s, l0) + .3, yb = T.sample(s, l1) + .3, n = 24;
    for (let k = 0; k < n; k++) {
      const u0 = k / n, u1 = (k + 1) / n, um = (u0 + u1) / 2;
      const l = l0 + (l1 - l0) * um, yy = ya + (yb - ya) * um + 3.2 * Math.sin(Math.PI * um);
      const y1 = ya + (yb - ya) * u0 + 3.2 * Math.sin(Math.PI * u0), y2 = ya + (yb - ya) * u1 + 3.2 * Math.sin(Math.PI * u1);
      const len = Math.hypot((l1 - l0) / n, y2 - y1) + .05, ang = Math.atan2(y2 - y1, Math.abs(l1 - l0) / n) * Math.sign(l1 - l0);
      P3.box(s, l, yy, len, .35, 4.2, 0x8a6a4a, 0, ang); // 床板
      for (const dz of [-2.1, 2.1]) {
        P3.box(s + dz, l, yy + 1.05, len, .12, .14, VERMILION, 0, ang); // 高欄
        P3.box(s + dz, l, yy + .55, .16, 1.0, .16, VERMILION); // 親柱
      }
      P3.box(s, l, yy - .4, len, .35, 3.6, VERMILION, 0, ang); // 桁
    }
    // 橋脚（川の中に 2 本）
    for (const u of [.35, .65]) {
      const l = l0 + (l1 - l0) * u, yy = ya + (yb - ya) * u + 3.2 * Math.sin(Math.PI * u) - .6, g = T.riverY(s) - 1.5;
      if (yy - g > .5) for (const dz of [-1.4, 1.4]) P3.box(s + dz, l, (yy + g) / 2, .5, yy - g, .5, VERMILION);
    }
  }
  // 駅前の人
  const rnd = ctx.rng;
  for (let k = 0; k < 12; k++) { const s = bs + dir * (BD / 2 + 4 + rnd() * 14), p = P3.pos(s, (rnd() - .5) * 30); P3.b.parent = new THREE.Matrix4().makeTranslation(0, T.sample(s, 0), 0); person(P3.b, rnd, p.x, p.z, rnd() * 6); P3.b.parent = null; }
  P3.build();
}
