// 住吉大社（住吉大社駅の東）の概形: 西の大鳥居 → 反橋（太鼓橋）と池 → 本宮4棟（住吉造: 直線の切妻屋根・朱の柱と白壁・千木と鰹木）と瑞垣。
// 位置は OpenStreetMap（src/data/osm/namba.json の 第一〜第四本宮・池）を、上りのコース 'namba' の座標で書く。森は osm-town.ts が木を植える。
// 実物の寸法・細部の再現ではない。ctx.rng は使わない
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { GeoBatch, M, P } from './batch';
import { cullByDistance } from './cull';
import { getTerrain } from './terrain';

const VERMILION = 0xc8412b, WHITE = 0xf1ece0, BARK = 0x4a3a30, BRONZE = 0x5c6a5a, STONE = 0xb9b4a6, GRAVEL = 0xd4cdb8;

/** 本宮の位置 [s, lat]（OSM の本殿の中心。第四本宮は第三本宮の南に並べる） */
const HONDEN: [number, number][] = [[4219.7, 335.5], [4215.3, 292.4], [4213.7, 261.5], [4191.7, 265]];
/** 反橋（池の上、東西に架かる）と西の大鳥居 */
const BRIDGE = { s: 4200, lat: 191.5, span: 20 };
const TORII = { s: 4200, lat: 172 };

export function buildSumiyoshiTaisha(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  const { track } = ctx, T = getTerrain(ctx);
  const b = new GeoBatch();
  const yaw0 = (s: number) => -track.trackAt(s).phi;
  /** 局所座標（x = 横位置の向き、z = −s の向き）で部品を置く */
  const at = (s: number, lat: number) => { const p = track.at(s, lat, 0); p.y = T.groundY(s); return p; };
  const put = (part: typeof P.box, s: number, lat: number, y: number, w: number, h: number, d: number, col: number, ry = 0, rx = 0, rz = 0) => {
    const p = at(s, lat); b.add('body', part, M(p.x, p.y + y, p.z, yaw0(s) + ry, w, h, d, rx, rz), col);
  };

  // ---- 鳥居（朱の明神鳥居。線路側を向く）: 西の大鳥居と、本宮の前の角鳥居 ----
  const torii = (s: number, lat: number, H: number, W: number) => {
    const k = H / 9;
    for (const ds of [-W / 2, W / 2]) put(P.cyl, s + ds, lat, H / 2, .9 * k, H, .9 * k, VERMILION);
    put(P.box, s, lat, H + .55 * k, .9 * k, .6 * k, W + 4.2 * k, 0x222222);   // 笠木（黒）
    put(P.box, s, lat, H - .1 * k, .75 * k, .5 * k, W + 3.2 * k, VERMILION); // 島木
    put(P.box, s, lat, H - 1.6 * k, .55 * k, .5 * k, W + 1.6 * k, VERMILION); // 貫
    put(P.box, s, lat, H - .85 * k, .4 * k, 1.1 * k, .5 * k, VERMILION);     // 額束
    for (const ds of [-W / 2, W / 2]) put(P.cyl, s + ds, lat, .4 * k, 1.4 * k, .8 * k, 1.4 * k, 0x2a2a2a);
  };
  torii(TORII.s, TORII.lat, 9, 8.5);
  torii(4205, 236, 6, 5.5);

  // ---- 本宮を囲む玉垣（朱の板垣に緑青の笠）と西の神門 ----
  {
    const E = { s0: 4174, s1: 4243, l0: 243, l1: 352 }, H = 2.6, ROOF = 0x4f7a68;
    const wallL = (s: number, l0: number, l1: number) => { put(P.boxB, s, (l0 + l1) / 2, 0, l1 - l0, H, .45, VERMILION); put(P.boxB, s, (l0 + l1) / 2, H, l1 - l0 + .6, .35, 1.6, ROOF); };
    const wallS = (lat: number, s0: number, s1: number) => { put(P.boxB, (s0 + s1) / 2, lat, 0, .45, H, s1 - s0, VERMILION); put(P.boxB, (s0 + s1) / 2, lat, H, 1.6, .35, s1 - s0 + .6, ROOF); };
    wallL(E.s0, E.l0, E.l1); wallL(E.s1, E.l0, E.l1);
    wallS(E.l1, E.s0, E.s1); wallS(E.l0, E.s0, 4198); wallS(E.l0, 4212, E.s1);
    // 神門（四脚門。棟は s の向き）
    for (const ds of [-5, 5]) for (const dl of [-1.6, 1.6]) put(P.cyl, 4205 + ds, E.l0 + dl, 2.2, .55, 4.4, .55, VERMILION);
    put(P.box, 4205, E.l0, 4.5, 4.4, .5, 11.5, VERMILION);
    put(P.gable, 4205, E.l0, 4.75, 6.4, 2.6, 13.5, ROOF);
  }

  // ---- 反橋（太鼓橋）: 朱の高欄の急な弧。池は osm-town.ts が地面に貼る ----
  {
    const { s, lat, span } = BRIDGE, n = 14, rise = 3.6, w = 5;
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, y0 = rise * Math.sin(Math.PI * u0), y1 = rise * Math.sin(Math.PI * u1);
      const l0 = lat - span / 2 + span * u0, l1 = lat - span / 2 + span * u1, L = Math.hypot(l1 - l0, y1 - y0), a = Math.atan2(y1 - y0, l1 - l0);
      // 床（横位置の向きに傾ける）
      put(P.box, s, (l0 + l1) / 2, (y0 + y1) / 2 + .2, L + .05, .3, w, 0x6b5440, 0, 0, a);
      for (const side of [-1, 1]) {
        put(P.box, s + side * w / 2, (l0 + l1) / 2, (y0 + y1) / 2 + 1.0, L + .05, .12, .12, VERMILION, 0, 0, a);
        put(P.box, s + side * w / 2, l0, y0 + .65, .18, .9, .18, VERMILION);
      }
    }
    // 橋脚
    for (const u of [.2, .5, .8]) for (const side of [-1, 1]) put(P.cyl, s + side * (w / 2 - .4), lat - span / 2 + span * u, rise * Math.sin(Math.PI * u) / 2 - .3, .35, rise * Math.sin(Math.PI * u) + .2, .35, 0x3a3028);
  }

  // ---- 参道（橋から本宮へ、砂利）と石灯籠 ----
  {
    const s = 4205, l0 = BRIDGE.lat + BRIDGE.span / 2, l1 = 250;
    put(P.boxB, s, (l0 + l1) / 2, 0, l1 - l0, .06, 9, GRAVEL);
    for (let l = l0 + 4; l < l1; l += 7) for (const side of [-1, 1]) {
      put(P.boxB, s + side * 5.5, l, 0, .8, .9, .8, STONE);
      put(P.box, s + side * 5.5, l, 1.25, .45, .6, .45, STONE);
      put(P.cone4, s + side * 5.5, l, 1.75, .9, .5, .9, STONE);
    }
  }

  // ---- 本宮（住吉造）と瑞垣 ----
  for (const [i, [s, lat]] of HONDEN.entries()) {
    const W = 6.2, D = 13, H = 4.4, rh = 3.4; // 正面（妻入り）は西 = 線路側
    // 瑞垣（朱の板垣）と玉砂利
    put(P.boxB, s, lat, 0, D + 7, .05, W + 7, GRAVEL);
    for (const side of [-1, 1]) {
      put(P.boxB, s + side * (W / 2 + 3.5), lat, 0, D + 7, 2.2, .3, VERMILION);
      put(P.boxB, s, lat + side * (D / 2 + 3.5), 0, .3, 2.2, W + 7, VERMILION);
    }
    // 床下の基壇と本体（朱の柱・白壁）
    put(P.boxB, s, lat, 0, D, .9, W, 0x5a4a3c);
    put(P.boxB, s, lat, .9, D, H, W, WHITE);
    for (const dl of [-D / 2, -D / 6, D / 6, D / 2]) for (const side of [-1, 1]) put(P.boxB, s + side * W / 2, lat + dl, .9, .35, H, .35, VERMILION);
    put(P.box, s, lat, .9 + H - .2, D + .2, .35, W + .2, VERMILION); // 桁
    // 直線の切妻屋根（檜皮葺の濃い茶）: 棟は横位置の向き（妻入り）
    const half = W / 2 + .9, sl = Math.hypot(half, rh), a = Math.atan2(rh, half), top = .9 + H;
    for (const side of [-1, 1]) put(P.box, s + side * half / 2, lat, top + rh / 2, D + 1.6, .35, sl + .1, BARK, 0, side * a);
    put(P.gable, s, lat - D / 2 + .05, top - .02, W, rh * .95, .1, WHITE, Math.PI / 2);
    // 千木（棟の両端で交差）と鰹木
    for (const end of [-1, 1]) for (const side of [-1, 1]) put(P.box, s + side * .45, lat + end * (D / 2 + .3), top + rh + .7, .18, 2.4, .25, BARK, 0, -side * .5);
    for (let k = 0; k < 5; k++) put(P.cyl, s, lat - D / 2 + 1.8 + k * (D - 3.6) / 4, top + rh + .25, .5, 2.2, .5, BARK, 0, Math.PI / 2, 0);
    // 第四本宮の前の小さな拝所の屋根（銅板）
    if (i === 3) put(P.gable, s, lat - D / 2 - 3, 2.8, W + 2, 1.6, 4, BRONZE, Math.PI / 2);
  }

  const g = new THREE.Group(); g.name = 'sumiyoshi-taisha';
  b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, g);
  ctx.scene.add(g);
  cullByDistance(ctx, g, 1300);
}
