// 南海本線 みさき公園〜和歌山港（route.id = 'misaki-wakayamako' / '-up'）専用: 和歌山大学前駅（ふじと台）の周辺。座標は下りのもの。上りは world/mw-frame.ts で写す。
//   橋上駅舎（レンガ調・線路をまたぐ）、ホームへの階段室・エレベーター、駅ビル東館（エスタシオン）、東のペデストリアンデッキ、
//   イオンモール和歌山（OSM の建物と同じ位置・大きさ。屋上駐車場・太陽光パネルの屋根）、立体駐車場、西口の駅舎棟・ロータリー、西側のマンション、山の斜面と樹林。
//   寸法・色・階数は出典に無いものが多く、ゲーム用の概形（route/routes/misaki-wakayamako-daigakumae.ts のコメントに確かめた内容と不明な点）。
//   OSM の建物とは二重にしない: その範囲は route.reserved（DK_RESERVED）で OSM 側が置かない。乱数は独自（ctx.rng を消費しない）。
//   建築限界: 線路の真上は床版の下面を 8.1m 以上、階段室・エレベーターは線路中心から 2.9m 以上離す（verify:clearance）。
//   局所座標（mkFrame）: x = 右（横位置の正）、z = s の減る向き。看板の板の向きは plane() の ry（0 = 後ろ向き、π = 前向き、+π/2 = 右向き、-π/2 = 左向き）。
import * as THREE from 'three';
import { FONT } from '../core/config';
import type { GameContext } from '../core/context';
import { createRng } from '../core/rng';
import { DK } from '../route/routes/misaki-wakayamako-daigakumae';
import { GeoBatch, M, P, onLight } from './batch';
import { canvasTex } from './canvas-tex';
import { cullByDistance } from './cull';
import { mwFrame } from './mw-frame';
import { person } from './stations';
import { gridAlong } from './terrain';

const C = {
  brick: 0xa4503a, brickLight: 0xb86b50, brickDark: 0x8a3f2e, cream: 0xe0d6c4, conc: 0xc6c2b9, concDark: 0x8c8984, concUnder: 0x77746f,
  glass: 0x2c3e4d, glassPale: 0x9ac0cc, roof: 0x4f4a47, roofLight: 0xe8e9e6, metal: 0x9aa0a6, asphalt: 0x7f8084, white: 0xf0f0ea,
  solar: 0x1d3358, solarB: 0x27426f, green: 0x6c9a52,
};
const CARS = [0xf2f2ef, 0x2b2d30, 0x9aa0a6, 0x6e7a86, 0xb8342c, 0x2f4f7f, 0xd9d4c4, 0x50565c];

/** 看板のテクスチャ */
const signTex = (text: string, w: number, h: number, bg: string, fg = '#fff', size = 120) => canvasTex(w, h, (g, W, H) => {
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = fg; g.font = `800 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + 4);
});

export function buildWakayamadaigakumae(ctx: GameContext): void {
  const f = mwFrame(ctx);
  if (!f || !f.route.stations.some(s => s.name === DK.name)) return;
  const { scene, track } = f;
  const rnd = createRng(0xda1a);
  const ST = DK.storey, CF = DK.floor, TOP = ST * DK.storeys;

  const matBody = new THREE.MeshLambertMaterial({ vertexColors: true });
  // 窓（昼は暗いガラス。夜は黄色く光る）
  const matWin = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffd896, emissiveIntensity: 0 });
  const signMats: THREE.MeshLambertMaterial[] = [];
  onLight(f, night => { matWin.emissiveIntensity = night * .8; for (const m of signMats) m.emissiveIntensity = .1 + night * .65; });

  /** 構造は3つのグループに分けて距離カリングする（駅・東・西） */
  const mk = (name: string) => { const g = new THREE.Group(); g.name = `wakayamadaigakumae-${name}`; return { b: new GeoBatch(), g }; };
  const stationG = mk('station'), eastG = mk('east'), westG = mk('west');
  let cur = stationG;

  /** 線路に平行な箱（s, lat = 中心。y = 底）。w = 横位置方向、d = s 方向。rz = 横位置方向への傾き（太陽光パネル） */
  const box = (s: number, lat: number, y: number, w: number, h: number, d: number, color: number, key = 'body', rz = 0) => {
    const p = track.at(s, lat, y), t = track.trackAt(s);
    cur.b.parent = null;
    cur.b.add(key, P.boxB, M(p.x, p.y, p.z, -t.phi, w, h, d, 0, rz), color);
  };
  /** 局所座標の箱（fr = mkFrame の行列。x = 右、z = s の減る向き） */
  const lbox = (fr: THREE.Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, color: number, key = 'body', rz = 0) => {
    cur.b.parent = fr;
    cur.b.add(key, P.boxB, M(x, y, z, 0, w, h, d, 0, rz), color);
    cur.b.parent = null;
  };
  const mkFrame = (s: number, lat: number, angDeg = 0) => {
    const p = track.at(s, lat, 0), t = track.trackAt(s);
    return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t.phi - angDeg * Math.PI / 180, 0)), new THREE.Vector3(1, 1, 1));
  };
  /** 看板の板（fr の局所座標。x = 右、y = 高さ、z = s の減る向き）。ry: 0 = 後ろ向き（難波側から見える）、π = 前向き、+π/2 = 右向き、-π/2 = 左向き */
  const plane = (fr: THREE.Matrix4, tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .1 });
    signMats.push(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    const grp = new THREE.Group(); grp.applyMatrix4(fr); grp.add(m); cur.g.add(grp);
  };
  const car = (fr: THREE.Matrix4, x: number, y: number, z: number, long: 'x' | 'z') => {
    const col = CARS[Math.floor(rnd() * CARS.length)], a = long === 'x' ? 4.3 : 1.7, b = long === 'x' ? 1.7 : 4.3;
    lbox(fr, x, y, z, a, .8, b, col);
    lbox(fr, x, y + .8, z, long === 'x' ? 2.4 : 1.55, .55, long === 'x' ? 1.55 : 2.4, 0x3a4048);
  };

  // ===================== 橋上駅舎（線路をまたぐ。改札階 = 3階） =====================
  cur = stationG;
  const c = DK.concourse, cs = (c.s0 + c.s1) / 2, cl = (c.l0 + c.l1) / 2, cw = c.l1 - c.l0, cd = c.s1 - c.s0;
  {
    // 床版（下面は 8.1m。架線柱の上端 7.7m より上）と躯体
    box(cs, cl, CF - 1.1, cw + .6, 1.1, cd + .6, C.concUnder);
    box(cs, cl, CF - 1.2, cw + 1.0, .25, cd + 1.0, C.brickDark); // 床版の縁
    box(cs, cl, CF, cw, ST, cd, C.brick);
    // 屋根（深い軒）・笠木・屋上の機械
    box(cs, cl, TOP, cw + 1.6, .4, cd + 1.6, C.roof);
    box(cs, cl, TOP + .4, cw + .4, .5, cd + .4, C.brickLight);
    for (const [ds, dl, w, d] of [[-9, -3, 5, 3.6], [8, 3, 4.4, 3], [0, 8, 3, 3]] as const) box(cs + ds, cl + dl, TOP + .9, w, 1.7, d, C.metal);
    // 南北の端の面: 窓の帯と柱型
    for (const sgn of [-1, 1]) {
      const s = sgn < 0 ? c.s0 - .04 : c.s1 + .04;
      box(s, cl, CF + .5, cw - 2.4, 1.8, .1, C.glass, 'w');
      for (let l = c.l0 + 2.4; l < c.l1 - 1; l += 4.6) box(s + sgn * .02, l, CF + .2, .5, 2.6, .14, C.brickLight);
      box(s + sgn * .04, cl, TOP - .35, cw + .4, .35, .16, C.cream);
    }
    // ホームへの階段室とエレベーター（線路中心から 2.9m 以上離す。標準のホームの小さな箱（s 約 6170。待合室）とは別に、橋上駅舎の真下に建てる）
    for (const lat of [-4.6, 8.6]) {
      const faceL = lat < 0 ? lat + 1.7 : lat - 1.7, inward = lat < 0 ? .04 : -.04; // 線路側の面
      box(DK.towerS, lat, 1.1, 3.4, CF - 1.1 + .1, DK.towerLen, C.brick);
      box(DK.towerS, lat, CF - .5, 3.8, .4, DK.towerLen + .4, C.roof);
      box(DK.towerS, faceL + inward, 5.2, .1, 2.6, DK.towerLen - 2.4, C.glass, 'w');
      box(DK.towerS, faceL + inward, 1.1, .1, 2.5, 3.2, 0x1c2227);
      const es = DK.towerS + DK.towerLen / 2 + 2; // エレベーター（ガラスの昇降路）
      box(es, lat, 1.1, 2.4, CF - 1.1 + .3, 2.6, C.glassPale);
      for (const dl of [-1.2, 1.2]) for (const ds of [-1.3, 1.3]) box(es + ds, lat + dl, 1.1, .16, CF - 1.1 + .3, .16, C.white);
      box(es, lat, CF + .2, 2.7, .25, 2.9, C.roof);
    }
    // 駅名看板（南北の端の面。北 = 難波側の面は下りの列車から、南の面は上りの列車から見える）
    const tex = signTex('和歌山大学前駅', 1024, 192, '#1d2a5a');
    plane(mkFrame(c.s0 - .12, cl), tex, 12, 2.25, 0, CF + 3.2, 0, 0);
    plane(mkFrame(c.s1 + .12, cl), tex, 12, 2.25, 0, CF + 3.2, 0, Math.PI);
  }

  // ===================== 駅ビル東館（ふじと台ステーションビル エスタシオン） =====================
  {
    const e = DK.east, sc = (e.s0 + e.s1) / 2, lc = (e.l0 + e.l1) / 2, w = e.l1 - e.l0, d = e.s1 - e.s0;
    box(sc, lc, 0, w, TOP, d, C.brick);
    box(sc, lc, TOP, w + 1.2, .4, d + 1.2, C.roof);
    box(sc, lc, TOP + .4, w + .3, .5, d + .3, C.brickLight);
    // 窓の帯: 東の面（駅前）・西の面（線路側）・南北の面。各階1本、1階は店舗の大きなガラス
    for (let fl = 0; fl < DK.storeys; fl++) {
      const y = fl === 0 ? .6 : fl * ST + 1.0, h = fl === 0 ? 3.2 : 2.3;
      for (const [lat, sgn] of [[e.l0 - .04, -1], [e.l1 + .04, 1]] as const) {
        box(sc, lat, y, .1, h, d - 5, C.glass, 'w');
        for (let s = e.s0 + 3; s < e.s1 - 2; s += 8.2) box(s, lat + sgn * .03, y - .2, .22, h + .4, .6, C.brickLight);
        box(sc, lat + sgn * .05, fl * ST + ST - .55, .22, .55, d + .2, C.cream);
      }
      for (const [s, sgn] of [[e.s0 - .04, -1], [e.s1 + .04, 1]] as const) {
        box(s, lc, y, w - 4, h, .1, C.glass, 'w');
        box(s + sgn * .05, lc, fl * ST + ST - .55, w + .2, .55, .22, C.cream);
      }
    }
    for (const [ds, dl, ww, dd] of [[-22, -4, 6, 4], [-4, 3, 5, 5], [18, -3, 7, 4.5]] as const) box(sc + ds, lc + dl, TOP + .9, ww, 2.2, dd, C.metal);
    // 駅前の出入口（東の面。ブリッジの真下）と庇
    box(DK.deck.s, e.l0 - 1.4, 3.8, 3.4, .2, 12, C.roof);
    box(DK.deck.s, e.l0 - .08, .1, .1, 3.5, 9, 0x1c2227);
    for (const dz of [-5.2, 5.2]) box(DK.deck.s + dz, e.l0 - 2.4, .1, .22, 3.7, .22, C.white);
    // 施設名の看板は置かない（ユーザー指示 2026-10-10。駅名標だけ）
  }
  // 東のバス乗り場（OSM のバス停「和歌山大学前駅東口」・タクシー乗り場の付近。東館の南）と交番
  {
    const b = DK.eastBus, sc = (b.s0 + b.s1) / 2, lc = (b.l0 + b.l1) / 2;
    box(sc, lc, 0, b.l1 - b.l0, .06, b.s1 - b.s0, 0x74777a);
    box(sc, b.l1 - 1.4, .06, 2.8, .1, b.s1 - b.s0, 0xbdb8ae);
    for (const s of [6288, 6312]) {
      box(s, b.l1 - 1.4, 2.6, 2.4, .14, 7, 0x3a7bc8);
      for (const ds of [-3, 3]) box(s + ds, b.l1 - 1.4, 0, .12, 2.6, .12, C.metal);
      box(s, b.l1 - .3, 0, .5, .5, 3.2, 0x2a6aa8);
      box(s + 8, b.l1 - 4.6, .5, 2.5, 2.7, 10.5, 0xf2f2ee); box(s + 8, b.l1 - 4.6, 1.0, 2.52, .7, 10, 0x3a7bc8); box(s + 8, b.l1 - 4.6, 2.0, 2.52, .8, 9.6, C.glass, 'w');
    }
    for (let k = 0; k < 4; k++) { const s = 6272 + k * 5.4; box(s, b.l0 + 5, .15, 1.8, .8, 4.6, k % 2 ? 0xe6c837 : 0xf0f0ea); box(s, b.l0 + 5, .95, 1.6, .55, 2.4, 0x2a333c); }
    const p = DK.police;
    box(p.s, p.lat, 0, 6.5, 3.6, 10, 0xe6e2d8); box(p.s, p.lat, 3.6, 7.3, .35, 10.8, 0x2a4a8a);
    box(p.s, p.lat + 3.3, 1.0, .1, 1.4, 6, C.glass, 'w');
    for (let k = 0; k < 6; k++) { // 人
      const fr = mkFrame(b.s0 + 14 + k * 9, b.l1 - 3, 0);
      cur.b.parent = fr; person(cur.b, rnd, (rnd() - .5) * 3, (rnd() - .5) * 3, rnd() * 6); cur.b.parent = null;
    }
  }

  // ===================== 西口の駅舎棟・バス乗り場・ロータリー・マンション・斜面 =====================
  cur = westG;
  {
    const w = DK.west, sc = (w.s0 + w.s1) / 2, lc = (w.l0 + w.l1) / 2, ww = w.l1 - w.l0, d = w.s1 - w.s0;
    box(sc, lc, 0, ww, TOP, d, C.brick);
    box(sc, lc, TOP, ww + 1.2, .4, d + 1.2, C.roof);
    box(sc, lc, TOP + .4, ww + .3, .5, d + .3, C.brickLight);
    for (let fl = 0; fl < DK.storeys; fl++) {
      const y = fl === 0 ? .6 : fl * ST + 1.0, h = fl === 0 ? 3.0 : 2.3;
      box(sc, w.l1 + .04, y, .1, h, d - 5, C.glass, 'w');
      for (let s = w.s0 + 3; s < w.s1 - 2; s += 8.2) box(s, w.l1 + .07, y - .2, .22, h + .4, .6, C.brickLight);
      box(sc, w.l1 + .09, fl * ST + ST - .55, .22, .55, d + .2, C.cream);
      box(w.s1 + .04, lc, y, ww - 3, h, .1, C.glass, 'w');
    }
    // バス乗り場の庇（西口の駅舎棟の西の面に沿う）
    box(sc, w.l1 + 1.9, 4.3, 3.8, .2, d - 6, C.roofLight);
    for (let s = w.s0 + 6; s < w.s1 - 4; s += 8) box(s, w.l1 + 3.5, 0, .2, 4.3, .2, C.metal);
    plane(mkFrame(sc, 0), signTex('和歌山大学前駅 西口', 1536, 160, '#1d2a5a', '#fff', 104), 22, 2.3, w.l1 + .15, TOP - 1.4, 0, Math.PI / 2);
    for (const [ds, ww2, dd] of [[-20, 4, 4], [-2, 5, 5], [18, 4, 3.5]] as const) box(sc + ds, lc, TOP + .9, ww2, 2.1, dd, C.metal);
  }
  {
    // ロータリー（OSM の道路の内側）: 舗装・歩道・中央の島・バス停・バス・タクシー・駐輪場・照明柱
    const r = DK.rotary, m = DK.mansion, sc = (r.s0 + r.s1) / 2, lc = (r.l0 + r.l1) / 2;
    box(sc, lc, 0, r.l1 - r.l0, .06, r.s1 - r.s0, 0x8d8e90);
    box(sc, r.l0 + 1.6, .06, 3.2, .08, r.s1 - r.s0, 0xbdb8ae);
    box(sc + 2, r.l0 + 16, .06, 5, .4, 34, C.green);
    for (const s of [6252, 6272, 6292]) {
      box(s, r.l0 + 7, 2.6, 2.6, .14, 7.5, 0x3a7bc8);
      for (const ds of [-3.4, 3.4]) box(s + ds, r.l0 + 7, 0, .12, 2.6, .12, C.metal);
      box(s, r.l0 + 5.9, 0, .5, .5, 3.2, 0x2a6aa8);
    }
    for (const s of [6262, 6298]) { // バス（白地に青い帯）
      box(s, r.l0 + 11, .5, 2.5, 2.7, 10.5, 0xf2f2ee);
      box(s, r.l0 + 11, 1.0, 2.52, .7, 10.0, 0x3a7bc8);
      box(s, r.l0 + 11, 2.0, 2.52, .8, 9.6, C.glass, 'w');
    }
    for (let k = 0; k < 5; k++) { // タクシー乗り場
      const s = 6232 + k * 5.4;
      box(s, r.l0 + 20, .15, 1.8, .8, 4.6, k % 2 ? 0xe6c837 : 0xf0f0ea); box(s, r.l0 + 20, .95, 1.6, .55, 2.4, 0x2a333c);
    }
    box(6243, r.l0 + 5.5, 2.2, 3.4, .1, 14, 0x9aa4ae); // 駐輪場
    for (let s = 6236.6; s < 6249.4; s += .7) box(s, r.l0 + 5.5, .05, 1.6, .9, .06, [0x333333, 0x9a2a2a, 0x2a4a8a, 0xcccccc][Math.floor(rnd() * 4)]);
    for (const s of [6212, 6240, 6268, 6296, 6324]) for (const lat of [r.l0 + 4, r.l0 + 23]) { // 照明柱（マンション・OSM の道路にかかる所は除く）
      if (lat < m.l1 + 2 && s < m.s1 + 4 || s < 6222 && lat > 45) continue;
      box(s, lat, 0, .22, 7.5, .22, C.metal); box(s, lat, 7.5, .3, .15, 1.2, 0xd9dde0);
    }
    const fr = mkFrame(sc, 0);
    cur.b.parent = fr;
    for (let k = 0; k < 14; k++) person(cur.b, rnd, r.l0 + 2 + rnd() * 12, (rnd() - .5) * 100, rnd() * 6);
    cur.b.parent = null;
  }
  {
    // 西側のマンション（線路際。10 階前後・ゲーム用の概形）
    const m = DK.mansion, sc = (m.s0 + m.s1) / 2, lc = (m.l0 + m.l1) / 2, w = m.l1 - m.l0, d = m.s1 - m.s0, fh = 3.0, H = m.floors * fh;
    box(sc, lc, 0, w, H, d, 0xe3dcc8);
    box(sc, lc, 0, w + .4, 3.6, d + .4, 0xb9ad94);
    box(sc, lc, H, w + .6, .5, d + .6, 0xb9ad94);
    box(sc - 6, lc, H + .5, 6, 2.2, 5, C.metal); box(sc + 8, lc + 3, H + .5, 4, 3.2, 4, 0xcfd2d4);
    for (let fl = 1; fl < m.floors; fl++) {
      const y = fl * fh + .9;
      for (const [lat, sg] of [[m.l0, -1], [m.l1, 1]] as const) {
        box(sc, lat + sg * .35, y - .1, .7, .1, d - 1, 0xf0efe9);
        box(sc, lat + sg * .68, y, .06, .95, d - 1, 0xb5bcc0);
        box(sc, lat + sg * .03, y + 1.0, .1, 1.5, d - 4, C.glass, 'w');
      }
    }
  }
  {
    // 山の斜面と樹林（駅のすぐ西。横位置 l0 から l1 へ上る。s の両端は低くなる）
    const sl = DK.slope, smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
    const hAt = (s: number, lat: number) => {
      const taper = smooth((s - sl.s0) / 80) * smooth((sl.s1 - s) / 80);
      return sl.h * taper * (lat <= sl.l1 ? smooth((lat - sl.l0) / (sl.l1 - sl.l0)) : 1 - smooth((lat - sl.l1) / 110));
    };
    const lats = [sl.l0 - 2, sl.l0 + 12, sl.l0 + 26, sl.l0 + 40, sl.l0 + 55, sl.l0 + 70, sl.l0 + 85, sl.l1, sl.l1 + 25, sl.l1 + 55, sl.l1 + 85, sl.l1 + 110];
    const forest = new THREE.Color(0x4f7040), grass = new THREE.Color(0x7fa05a);
    const mesh = gridAlong(track, sl.s0, sl.s1, 10, s => lats.map(l => { const h = hAt(s, l); return [l, track.trackAt(s).y + h + (h > .05 ? .03 : -.03)] as [number, number]; }),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      (s, j, out) => out.copy(j < 2 ? grass : forest).multiplyScalar(.78 + (Math.sin(s * .13 + j * 1.7) + 1) * .15));
    mesh.name = 'wakayamadaigakumae-slope';
    westG.g.add(mesh);
    const cols = [0x3f6a35, 0x4a7a3c, 0x365c30, 0x557f40, 0x2f5530];
    cur.b.parent = null;
    for (let s = sl.s0 + 25; s < sl.s1 - 20; s += 7.5) for (let lat = sl.l0 + 6; lat < sl.l1 + 60; lat += 8.5) {
      if (rnd() < .42) continue;
      const ss = s + (rnd() - .5) * 6, ll = lat + (rnd() - .5) * 6, hh = hAt(ss, ll), h = 7 + rnd() * 5, col = cols[Math.floor(rnd() * cols.length)];
      if (hh < .4 && ll > sl.l1) continue;
      const p = track.at(ss, ll, hh);
      cur.b.add('body', P.cyl6, M(p.x, p.y + h * .13, p.z, 0, .5, h * .26, .5), 0x6a4b33);
      if (rnd() < .6) {
        cur.b.add('body', P.cone4, M(p.x, p.y + h * .4, p.z, 0, h * .5, h * .55, h * .5), col);
        cur.b.add('body', P.cone4, M(p.x, p.y + h * .72, p.z, 0, h * .36, h * .5, h * .36), col);
      } else cur.b.add('body', P.sphere, M(p.x, p.y + h * .62, p.z, 0, h * .6, h * .55, h * .6), col);
    }
  }

  // ===================== 東: ペデストリアンデッキ・イオンモール和歌山・立体駐車場 =====================
  cur = eastG;
  {
    const d = DK.deck, lc = (d.l0 + d.l1) / 2, len = Math.abs(d.l1 - d.l0);
    box(d.s, lc, CF - .55, len, .55, d.w, C.conc);
    for (const sg of [-1, 1]) box(d.s + sg * (d.w / 2 - .06), lc, CF, len, 1.05, .12, 0xcfd6da);
    box(d.s, lc, CF + 3.6, len, .2, d.w + 1.0, C.roofLight);
    for (let l = d.l0 - 2; l > d.l1 + 4; l -= 12) for (const sg of [-1, 1]) box(d.s + sg * (d.w / 2 - .1), l, CF, .16, 3.6, .16, C.white);
    for (const l of [-47.5, -64, -86, -108, -126]) { box(d.s, l, 0, 1.1, CF - .5, 1.1, C.conc); box(d.s, l, CF - 1.4, 3.4, .9, 1.7, C.conc); }
    cur.b.parent = new THREE.Matrix4().multiplyMatrices(mkFrame(d.s, lc), new THREE.Matrix4().makeTranslation(0, CF, 0));
    for (let k = 0; k < 9; k++) person(cur.b, rnd, (rnd() - .5) * (len - 10), (rnd() - .5) * 3, rnd() < .5 ? Math.PI / 2 : -Math.PI / 2);
    cur.b.parent = null;
  }
  {
    // もう1本の短いデッキ（OSM の bridge=yes の歩道）: 屋根なし。先は地上へ降りる階段室
    const d = DK.deck2, lc = (d.l0 + d.l1) / 2, len = Math.abs(d.l1 - d.l0);
    box(d.s, lc, CF - .55, len, .55, d.w, C.conc);
    for (const sg of [-1, 1]) box(d.s + sg * (d.w / 2 - .06), lc, CF, len, 1.05, .12, 0xcfd6da);
    for (const l of [-46.5, -62, -78]) { box(d.s, l, 0, 1.0, CF - .5, 1.0, C.conc); box(d.s, l, CF - 1.3, 3.0, .8, 1.6, C.conc); }
    box(d.s, d.l1 - 2.4, 0, 4.8, CF + 3.0, 5, C.brick);
    box(d.s, d.l1 - 2.4, CF + 3.0, 5.4, .3, 5.6, C.roof);
    box(d.s, d.l1 - 4.9, .1, 3, 3.2, .1, 0x1c2227);
  }
  {
    // イオンモール和歌山（OSM の建物の位置・大きさ。3 階。赤茶色のレンガ調、屋上駐車場、太陽光パネルの屋根、看板帯、ブリッジの入口）
    const m = DK.mall, F = mkFrame(m.s, m.lat, m.ang), W = m.wid, L = m.len, H = 15.6;
    lbox(F, 0, -1.6, 0, W, H + 1.6, L, C.brick);
    for (const lv of [5.2, 10.4]) { // 床の高さの帯
      for (const sx of [-1, 1]) lbox(F, sx * (W / 2 + .05), lv - .3, 0, .12, .6, L + .2, C.brickLight);
      for (const sz of [-1, 1]) lbox(F, 0, lv - .3, sz * (L / 2 + .05), W + .2, .6, .12, C.brickLight);
    }
    for (const lv of [6.4, 11.6]) { // 窓（短い窓を間隔をあけて並べる）
      for (let z = -L / 2 + 14; z < L / 2 - 10; z += 24) {
        lbox(F, W / 2 + .04, lv, z, .1, 2.4, 16, C.glass, 'w');
        lbox(F, -W / 2 - .04, lv, z, .1, 2.4, 16, C.glass, 'w');
      }
      for (let x = -W / 2 + 14; x < W / 2 - 10; x += 26) {
        lbox(F, x, lv, L / 2 + .04, 14, 2.4, .1, C.glass, 'w');
        lbox(F, x, lv, -L / 2 - .04, 14, 2.4, .1, C.glass, 'w');
      }
    }
    for (let z = -L / 2 + 20; z < L / 2 - 10; z += 40) lbox(F, -W / 2 - .05, 0, z, .1, 4.2, 9, 0x4a4d52); // 搬入口
    for (const sx of [-1, 1]) lbox(F, sx * (W / 2 - .25), H, 0, .5, 1.1, L, C.brickLight); // パラペット
    for (const sz of [-1, 1]) lbox(F, 0, H, sz * (L / 2 - .25), W, 1.1, .5, C.brickLight);
    lbox(F, 0, H, 0, W - 1, .08, L - 1, C.asphalt);
    // 屋上駐車場（区画の白線と車。車の長辺は x 方向）
    for (const bx of [-48, -33, -18, -3, 12, 27, 42]) {
      for (const dx of [-2.4, 2.4]) for (let z = -150; z < -18; z += 2.6) if (rnd() >= .45) car(F, bx + dx, H + .08, z, 'x');
      lbox(F, bx - 4.9, H + .09, -84, .12, .02, 132, C.white);
    }
    for (const [x, z, w, d] of [[40, 100, 12, 14], [-38, 100, 12, 14], [30, -168, 14, 8], [-30, -168, 14, 8]] as const) { // 階段室・昇降機の塔屋
      lbox(F, x, H, z, w, 4.2, d, C.brickLight); lbox(F, x, H + 4.2, z, w + .8, .35, d + .8, C.roof);
    }
    for (const x of [-50, 0, 52]) for (let z = -150; z < -10; z += 28) { lbox(F, x, H, z, .25, 7.5, .25, C.metal); lbox(F, x, H + 7.5, z, 1.2, .15, .5, 0xd9dde0); }
    // 太陽光パネルの屋根（屋上駐車場の北側）: 傾けたパネルの列と支柱
    for (let x = -54 + 2.1, k = 0; x < 54; x += 4.2, k++) lbox(F, x, H + 3.4, -90, 4.0, .14, 120, k % 2 ? C.solarB : C.solar, 'body', .17);
    for (let x = -50; x < 54; x += 13.6) for (let z = -144; z <= -36; z += 27) lbox(F, x, H, z, .34, 3.6, .34, C.metal);
    // ブリッジの入口（2 階の高さ）。施設名の看板は置かない（ユーザー指示 2026-10-10）
    const entrZ = -(DK.deck.s - m.s);
    lbox(F, W / 2 + 1.8, 0, entrZ, 3.6, 10.6, 26, C.glass, 'w');
    lbox(F, W / 2 + 2.0, 10.6, entrZ, 4.4, .45, 28, C.roofLight);
    lbox(F, W / 2 + 1.8, 0, entrZ, 3.7, .5, 26.2, C.concDark);
    for (let z = -11.5; z <= 11.6; z += 5.75) lbox(F, W / 2 + 3.62, 0, entrZ + z, .2, 10.6, .25, C.white);
  }
  {
    // 立体駐車場（OSM の 4 階建て 153×56m の建物。用途は推測）。各階は開放で、屋上に太陽光パネルの屋根
    const m = DK.carpark, F = mkFrame(m.s, m.lat, m.ang), W = m.wid, L = m.len, lev = 3.1, n = 4, Ht = lev * n;
    lbox(F, 0, -1.4, 0, W - 2, Ht + 1.4, L - 2, 0x3d4044);
    for (let k = 0; k <= n; k++) {
      lbox(F, 0, k * lev, 0, W, .38, L, 0xc9c5bc);
      if (k === 0) continue;
      for (const sx of [-1, 1]) lbox(F, sx * (W / 2 - .2), k * lev + .38, 0, .35, 1.0, L, 0xd6d2c9);
      for (const sz of [-1, 1]) lbox(F, 0, k * lev + .38, sz * (L / 2 - .2), W, 1.0, .35, 0xd6d2c9);
    }
    for (let z = -L / 2 + .4; z <= L / 2; z += 7.65) for (const sx of [-1, 1]) lbox(F, sx * (W / 2 - .3), 0, z, .6, Ht, .6, 0xb9b5ac);
    for (let z = -L / 2 + 6; z < L / 2 - 4; z += 4.8) if (rnd() < .5) car(F, (rnd() < .5 ? -1 : 1) * (W / 2 - 4.2), Ht + .38, z, 'z');
    for (let x = -W / 2 + 3, k = 0; x < W / 2 - 2; x += 4.2, k++) lbox(F, x, Ht + 3.4, 0, 4.0, .14, L - 10, k % 2 ? C.solarB : C.solar, 'body', .17);
    for (let x = -W / 2 + 6; x <= W / 2 - 3; x += 14) for (let z = -L / 2 + 8; z <= L / 2 - 6; z += 25) lbox(F, x, Ht + .38, z, .34, 3.4, .34, C.metal);
  }

  // ===================== 組み立て =====================
  for (const x of [stationG, eastG, westG]) {
    x.b.build({ body: matBody, w: matWin }, x.g);
    scene.add(x.g);
    cullByDistance(f, x.g, 1100);
  }
}
