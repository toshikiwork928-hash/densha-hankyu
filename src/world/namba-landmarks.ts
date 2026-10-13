// 南海本線 堺〜難波（route.id = 'namba'）専用の景観（描画専用・静的）。実在の名称・ロゴは持たない概形。
//   1. 七道駅西側の大型商業施設（s 1420〜1880, 左 lat -46〜-180）と連絡デッキ（s≈1700）
//   2. 新今宮の下をくぐる JR 高架（4線・s≈8530 で約78°に交差）と JR の島式でない相対ホーム2面
//   3. 大和川（s 2155〜2375）の堤防の法面・堤防道路・並行する道路橋（右 lat≈+30）
// ctx.rng は使わない（局所の PRNG）。列車は作らない。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { FONT } from '../core/config';
import { GeoBatch, ChunkedBatch, P, M, onLight } from './batch';
import { cullByDistance } from './cull';
import { canvasTex } from './canvas-tex';
import { getTerrain } from './terrain';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const C = { wall: 0xd9d4c8, white: 0xf1eee6, slab: 0xc4c1b8, dark: 0x4e565c, steel: 0x8b9399, green: 0x6b9456, asphalt: 0x4b4e52, concrete: 0xb5b3aa };
const WARM = 0xffd9a0, COOL = 0xcfe6f4, RED = 0xff3a30;
const UVK = new Set(['mall', 'park', 'sign', 'lot']);

/** 夜に光る面（昼は暗いガラス色） */
function litMaterial(ctx: GameContext): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x4b5760 });
  const day = new THREE.Color(0x4b5760), night = new THREE.Color(0xffffff);
  onLight(ctx, f => m.color.copy(day).lerp(night, f));
  return m;
}
/** 昼の絵＋夜の窓明かりの2枚貼り */
function texMaterial(ctx: GameContext, day: THREE.Texture, emit: THREE.Texture, k: number, repeat: boolean): THREE.MeshLambertMaterial {
  if (repeat) for (const t of [day, emit]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  const m = new THREE.MeshLambertMaterial({ map: day, vertexColors: true, emissiveMap: emit, emissive: 0xffffff, emissiveIntensity: 0 });
  onLight(ctx, f => { m.emissiveIntensity = f * k; });
  return m;
}
const bodyMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });

/** 地面基準のローカル座標（s・lat・地面からの高さ）で箱・面を積む道具 */
function localTools(ctx: GameContext) {
  const { track } = ctx, T = getTerrain(ctx);
  const yaw = (s: number) => -track.trackAt(s).phi;
  const pos = (s: number, lat: number, y: number) => { const p = track.at(s, lat, 0); p.y = T.groundY(s) + y; return p; };
  /** 箱: s0..s1・lat l0..l1・地面からの高さ y0..y1（長いものは seg ごとに分割して曲線に追従） */
  const box = (b: GeoBatch, key: string, s0: number, s1: number, l0: number, l1: number, y0: number, y1: number, color: number, seg = 64) => {
    const n = Math.max(1, Math.ceil((s1 - s0) / seg)), ds = (s1 - s0) / n;
    for (let i = 0; i < n; i++) {
      const sc = s0 + ds * (i + .5), p = pos(sc, (l0 + l1) / 2, (y0 + y1) / 2);
      b.add(key, P.box, M(p.x, p.y, p.z, yaw(sc), Math.abs(l1 - l0), Math.abs(y1 - y0), ds + (n > 1 ? .05 : 0)), color);
    }
  };
  /** 線路側（dir=+1 は +X 向き）の壁面。タイル（tw×th [m]）で繰り返す */
  const faceX = (b: GeoBatch, key: string, s0: number, s1: number, lat: number, y0: number, y1: number, dir: 1 | -1, tw: number, th: number) => {
    const n = Math.max(1, Math.ceil((s1 - s0) / 64)), ds = (s1 - s0) / n;
    for (let i = 0; i < n; i++) {
      const sc = s0 + ds * (i + .5), p = pos(sc, lat + dir * .06, (y0 + y1) / 2);
      b.add(key, P.plane, M(p.x, p.y, p.z, yaw(sc) + dir * Math.PI / 2, ds, y1 - y0, 1), 0xffffff, [0, 0, ds / tw, (y1 - y0) / th]);
    }
  };
  /** s 方向の端面（dir=+1 は s の小さい側を向く） */
  const faceZ = (b: GeoBatch, key: string, s: number, l0: number, l1: number, y0: number, y1: number, dir: 1 | -1, tw: number, th: number) => {
    const sc = s - dir * .06, p = pos(sc, (l0 + l1) / 2, (y0 + y1) / 2);
    b.add(key, P.plane, M(p.x, p.y, p.z, yaw(s) + (dir > 0 ? 0 : Math.PI), Math.abs(l1 - l0), y1 - y0, 1), 0xffffff, [0, 0, Math.abs(l1 - l0) / tw, (y1 - y0) / th]);
  };
  return { track, T, yaw, pos, box, faceX, faceZ };
}

// ================= 1. 七道の大型商業施設 =================
const MALL_S = { a0: 1470, a1: 1850 };

function buildMall(ctx: GameContext): void {
  const { T, yaw, pos, box, faceX, faceZ } = localTools(ctx);
  const far = new GeoBatch(UVK), near = new GeoBatch(UVK), lit = new GeoBatch();
  const rnd = seeded(5150);

  // 外壁タイル: 8ベイ×4層（32m×22m）。昼の絵と夜の窓明かりを同じ乱数で描く
  const cells: { glass: number; on: number; tone: number }[] = [];
  for (let i = 0; i < 32; i++) cells.push({ glass: rnd() < .8 ? 1 : 0, on: rnd() < .82 ? 1 : 0, tone: Math.floor(rnd() * 3) });
  const glassCol = ['#5f7f93', '#587a8f', '#6a8aa0'], accent = ['#c9b99a', '#b8c4cf', '#d3b9a6'];
  const mallDay = canvasTex(512, 256, (g) => {
    g.fillStyle = '#d9d4c8'; g.fillRect(0, 0, 512, 256);
    cells.forEach((c, i) => {
      const x = (i % 8) * 64, y = Math.floor(i / 8) * 64;
      g.fillStyle = '#c3beb1'; g.fillRect(x, y, 64, 12);
      if (c.glass) {
        g.fillStyle = glassCol[c.tone]; g.fillRect(x + 3, y + 14, 58, 38);
        g.fillStyle = '#dcd8cc'; g.fillRect(x + 31, y + 14, 2, 38);
      } else { g.fillStyle = accent[c.tone]; g.fillRect(x + 3, y + 14, 58, 38); }
      g.fillStyle = '#b9b4a6'; g.fillRect(x, y + 56, 64, 8);
    });
  });
  const mallEmit = canvasTex(512, 256, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
    cells.forEach((c, i) => {
      if (!c.glass || !c.on) return;
      const x = (i % 8) * 64, y = Math.floor(i / 8) * 64;
      g.fillStyle = c.tone === 1 ? '#fff1d2' : '#ffe2a6'; g.fillRect(x + 3, y + 14, 58, 38);
      g.fillStyle = '#000'; g.fillRect(x + 31, y + 14, 2, 38);
    });
  });
  const parkDay = canvasTex(128, 64, (g) => {
    g.fillStyle = '#3d4348'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#bdbab1'; g.fillRect(0, 0, 128, 10); g.fillRect(0, 50, 128, 14);
    g.fillStyle = '#c9c6bd'; g.fillRect(0, 10, 6, 40); g.fillRect(64, 10, 6, 40);
  });
  const parkEmit = canvasTex(128, 64, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#7a6a45'; g.fillRect(10, 12, 44, 3); g.fillRect(74, 12, 44, 3);
  });
  const signTex = canvasTex(1024, 192, (g, w, h) => {
    g.fillStyle = '#12365c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2b632'; g.fillRect(0, h - 18, w, 18); g.fillRect(0, 0, w, 10);
    g.fillStyle = '#ffffff'; g.font = `900 108px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SHICHIDO MALL', w / 2, h / 2 - 4);
  });
  const lotTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#4b4e52'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#d7d7d0';
    for (let i = 0; i < 4; i++) { g.fillRect(i * 32, 0, 2, 40); g.fillRect(i * 32, 88, 2, 40); }
    g.fillRect(0, 0, 128, 2); g.fillRect(0, 126, 128, 2);
  });

  const farGroup = new THREE.Group(), nearGroup = new THREE.Group();
  farGroup.name = 'namba-mall-far'; nearGroup.name = 'namba-mall-near';

  const LT = 32, LH = 22;                        // 外壁タイル [m]
  const { a0, a1 } = MALL_S;
  const aL0 = -46, aL1 = -100;                   // 本館（線路側 -46）
  // ---- 本館（4層 22m）
  box(far, 'body', a0, a1, aL1, aL0, 0, LH, C.wall);
  faceX(far, 'mall', a0, a1, aL0, 0, LH, 1, LT, LH);
  faceZ(far, 'mall', a0, aL1, aL0, 0, LH, 1, LT, LH);
  faceZ(far, 'mall', a1, aL1, aL0, 0, LH, -1, LT, LH);
  box(far, 'body', a0 - .4, a1 + .4, aL1 - .4, aL0 + .4, LH, LH + 1.1, C.white);        // パラペット
  // 1階の庇と低い基壇（店舗の連続ガラスの上）
  box(near, 'body', a0, a1, aL0, aL0 + 2.4, 5.0, 5.35, C.steel);
  box(near, 'body', a0, a1, aL0, aL0 + .5, 11.0, 11.3, C.white);                         // 3階床の帯
  // ---- 別館（3層 16.5m）・映画館（窓なし 25m）
  box(far, 'body', a0, 1605, -150, aL1, 0, 16.5, C.wall);
  faceX(far, 'mall', a0, 1605, aL1, 0, 16.5, 1, LT, LH);
  faceZ(far, 'mall', a0, -150, aL1, 0, 16.5, 1, LT, LH);
  box(far, 'body', a0 - .3, 1605 + .3, -150 - .3, aL1 + .3, 16.5, 17.5, C.white);
  box(far, 'body', 1625, 1715, -148, aL1, 0, 25, 0x8e98a6);
  box(far, 'body', 1624.5, 1715.5, -148.5, aL1 + .5, 25, 25.8, C.slab);
  box(near, 'body', 1625.2, 1714.8, aL1 - 12.2, aL1, 17, 21, 0x6a7482);                  // 映画館の大壁面（帯）
  // ---- 立体駐車場（5層・開放型）
  const pk = { s0: 1790, s1: 1880, l0: -180, l1: -104 };
  box(far, 'body', pk.s0, pk.s1, pk.l0, pk.l1, 0, 16.4, C.slab);
  faceX(far, 'park', pk.s0, pk.s1, pk.l1, 0, 16, 1, 8, 3.2);
  faceZ(far, 'park', pk.s0, pk.l0, pk.l1, 0, 16, 1, 8, 3.2);
  faceZ(far, 'park', pk.s1, pk.l0, pk.l1, 0, 16, -1, 8, 3.2);
  box(far, 'body', pk.s0 - .2, pk.s1 + .2, pk.l0 - .2, pk.l1 + .2, 16, 17.2, C.white);
  box(near, 'body', pk.s0 + 30, pk.s0 + 42, pk.l1 - 14, pk.l1, 17.2, 23, C.steel);        // 斜路の塔屋
  // サービスヤード棟（低い倉庫）
  box(far, 'body', 1480, 1610, -182, -154, 0, 8, 0xb9bcc0);
  box(far, 'body', 1478.5, 1611.5, -183, -153, 8, 8.4, C.slab);

  // ---- 屋上の設備・看板
  for (let i = 0; i < 16; i++) {
    const s = a0 + 12 + rnd() * (a1 - a0 - 24), l = aL0 - 8 - rnd() * (aL0 - aL1 - 16), w = 2 + rnd() * 4;
    box(near, 'body', s - w / 2, s + w / 2, l - w / 2, l + w / 2, LH + 1.1, LH + 1.1 + 1.2 + rnd() * 1.6, i % 3 ? C.steel : C.slab);
  }
  const sign = (s: number, y0: number, y1: number, len: number, onSide: boolean) => {
    // 看板: 本館の線路側壁面（onSide）または西端の壁面
    if (onSide) {
      const p = pos(s, aL0 + .12, (y0 + y1) / 2);
      far.add('sign', P.plane, M(p.x, p.y, p.z, yaw(s) + Math.PI / 2, len, y1 - y0, 1), 0xffffff);
    } else {
      const sc = a0 - .12, p = pos(sc, (aL0 + aL1) / 2, (y0 + y1) / 2);
      far.add('sign', P.plane, M(p.x, p.y, p.z, yaw(sc), len, y1 - y0, 1), 0xffffff);
    }
  };
  sign(1565, 17, 21.2, 30, true);
  sign(1800, 17, 21.2, 30, true);
  sign(0, 14.5, 19, 32, false);
  // 屋上の航空障害灯（映画館棟・本館の端）
  for (const [s0, l0] of [[1630, -142], [1710, -104], [a1 - 3, aL1 + 3]] as const) box(lit, 'lit', s0 - .3, s0 + .3, l0 - .3, l0 + .3, 26, 26.6, RED);
  // 道路沿いの袖看板（ポール）
  const pylon = (s: number, l: number) => {
    box(near, 'body', s - .4, s + .4, l - .4, l + .4, 0, 11, C.steel);
    const p = pos(s - .5, l, 10);
    far.add('sign', P.plane, M(p.x, p.y, p.z, yaw(s), 8, 2.2, 1), 0xffffff);
  };
  pylon(1452, -40); pylon(1890, -40);

  // ---- 駐車場・前面道路・街灯
  const lotPlane = (s0: number, s1: number, l0: number, l1: number) => {
    const n = Math.max(1, Math.ceil((s1 - s0) / 40)), ds = (s1 - s0) / n;
    for (let i = 0; i < n; i++) {
      const sc = s0 + ds * (i + .5), p = pos(sc, (l0 + l1) / 2, .06);
      far.add('lot', P.plane, M(p.x, p.y, p.z, yaw(sc), Math.abs(l1 - l0), ds + .05, 1, -Math.PI / 2), 0xffffff, [0, 0, Math.abs(l1 - l0) / 10, ds / 10]);
    }
  };
  lotPlane(1380, 1470, -188, -46);
  lotPlane(1470, 1790, -188, -154);
  lotPlane(1880, 1905, -188, -46);
  box(far, 'body', 1380, 1905, -46, -14, .0, .08, C.asphalt);                          // 前面道路・バス乗り場
  box(near, 'body', 1380, 1905, -34.4, -34.0, .08, .1, 0xe6e2c2);                       // 中央線
  box(near, 'body', 1380, 1905, -14.6, -14.2, .08, .1, 0xe6e2c2);
  for (let s = 1400; s < 1900; s += 32) {
    box(near, 'body', s - .1, s + .1, -22, -18, 0, 5.6, C.steel);
    box(near, 'body', s - 3, s + 3, -22.4, -17.6, 5.6, 5.9, C.white);                   // バス停風の屋根
  }
  const poleLots: [number, number][] = [];
  for (let s = 1400; s < 1800; s += 38) for (const l of [-70, -120, -170]) if (!(s > 1470 && l > -150 && s < 1790 && l < -46)) poleLots.push([s, l]);
  for (let s = 1395; s < 1905; s += 30) poleLots.push([s, -43]);
  for (const [s, l] of poleLots) {
    box(near, 'body', s - .13, s + .13, l - .13, l + .13, 0, 8.5, C.steel);
    box(lit, 'lit', s - .6, s + .6, l - .4, l + .4, 8.5, 8.7, WARM);
  }
  // 街路樹（前面道路の外側）
  for (let s = 1410; s < 1900; s += 22) {
    const p = pos(s, -31, 0);
    near.add('body', P.boxB, M(p.x, p.y, p.z, 0, .3, 3.4, .3), 0x6d5640);
    near.add('body', P.sphere, M(p.x, p.y + 4.6, p.z, 0, 3.8 + (s % 3), 3.6, 3.8 + (s % 3)), 0x5a8a4c);
  }

  // ---- 連絡デッキ（駅の左側ホーム → 商業施設 2階以上のフロア）
  const S = 1700, FY = T.trackY(S) + 1.1 - T.groundY(S), CH = 3.3;
  const dl0 = -9, dl1 = aL0;
  box(near, 'body', S - 2.7, S + 2.7, dl1, dl0, FY - .5, FY, C.slab);
  box(near, 'body', S - 2.9, S + 2.9, dl1, dl0 - .4, FY + CH, FY + CH + .4, C.white);
  for (const sd of [-1, 1]) {
    const s0 = S + sd * 2.55;
    box(near, 'body', s0 - .15, s0 + .15, dl1, dl0, FY, FY + .9, C.white);
    box(lit, 'lit', s0 + sd * .02 - .02, s0 + sd * .02 + .02, dl1 + .2, dl0 - .2, FY + .9, FY + CH - .1, COOL);
    for (let l = dl0; l >= dl1 - .01; l -= 4.1) box(near, 'body', s0 - .17, s0 + .17, l - .09, l + .09, FY, FY + CH, C.white);
  }
  box(lit, 'lit', S - 1.2, S + 1.2, dl1 + .5, dl0 - .5, FY + CH - .04, FY + CH - .01, WARM);
  for (const l of [-22, -34]) {
    for (const sd of [-1, 1]) box(near, 'body', S + sd * 2.2 - .35, S + sd * 2.2 + .35, l - .35, l + .35, 0, FY - .5, C.steel);
    box(near, 'body', S - 3.4, S + 3.4, l - .45, l + .45, FY - 1.4, FY - .5, C.steel);
  }
  box(near, 'body', S - 3, S + 3, dl1 - .8, dl1, FY - .5, FY + CH + .4, C.dark);        // 商業施設側の入口枠

  const mats = { body: bodyMat(), mall: texMaterial(ctx, mallDay, mallEmit, .9, true), park: texMaterial(ctx, parkDay, parkEmit, .7, true),
    sign: texMaterial(ctx, signTex, signTex, .85, false), lot: new THREE.MeshLambertMaterial({ map: lotTex, vertexColors: true }) };
  lotTex.wrapS = lotTex.wrapT = THREE.RepeatWrapping;
  far.build(mats, farGroup);
  near.build(mats, nearGroup); lit.build({ lit: litMaterial(ctx) }, nearGroup);
  ctx.scene.add(farGroup, nearGroup);
  cullByDistance(ctx, farGroup, 2000);
  cullByDistance(ctx, nearGroup, 800);
}

// ================= 2. 新今宮の JR 高架 =================
const JR = {
  s0: 8530, angle: 78 * Math.PI / 180, half: 400,
  deckTop: 6.6, railTop: 7.07, tracks: [-7.5, -2.5, 2.5, 7.5], hw: 10.5, hwSta: 14.2, sta: { t0: 60, t1: 220 },
  gapFrom: -25, gapTo: 40,   // 南海の高架（lat -9〜25）の上下をまたぐ長い桁の範囲（JR 軸上の t）
};

function buildJr(ctx: GameContext): void {
  const { track } = ctx, T = getTerrain(ctx);
  const gy = T.groundY(JR.s0), tp = track.trackAt(JR.s0), o = track.at(JR.s0, 0, 0);
  const fx = Math.sin(tp.phi), fz = -Math.cos(tp.phi);
  const ax = tp.rx * Math.sin(JR.angle) + fx * Math.cos(JR.angle), az = tp.rz * Math.sin(JR.angle) + fz * Math.cos(JR.angle);
  const nx = -az, nz = ax, theta = Math.atan2(-az, ax);
  /** JR 軸基準（t = 軸方向、w = 直角方向）→ ワールド（y は地面から） */
  const J = (t: number, w: number, y: number) => new THREE.Vector3(o.x + ax * t + nx * w, gy + y, o.z + az * t + nz * w);
  const farC = new ChunkedBatch(100), nearC = new ChunkedBatch(100, new Set(['sign'])), litC = new ChunkedBatch(100);
  const chunkOf = (t: number) => t + JR.half;
  /** t0..t1 を100m区画で割って箱を積む */
  const jb = (c: ChunkedBatch, key: string, t0: number, t1: number, w0: number, w1: number, y0: number, y1: number, color: number) => {
    for (let a = t0; a < t1 - 1e-6;) {
      const b = Math.min(t1, (Math.floor((a + JR.half) / 100) + 1) * 100 - JR.half), p = J((a + b) / 2, (w0 + w1) / 2, (y0 + y1) / 2);
      c.at(chunkOf((a + b) / 2)).add(key, P.box, M(p.x, p.y, p.z, theta, b - a + (b < t1 ? .02 : 0), y1 - y0, Math.abs(w1 - w0)), color);
      a = b;
    }
  };
  const jpost = (c: ChunkedBatch, t: number, w: number, y0: number, y1: number, sz: number, color: number) => {
    const p = J(t, w, (y0 + y1) / 2); c.at(chunkOf(t)).add('body', P.box, M(p.x, p.y, p.z, theta, sz, y1 - y0, sz), color);
  };
  const { t0: st0, t1: st1 } = JR.sta, inSta = (t: number) => t > st0 - 8 && t < st1 + 8;
  const H = JR.half, DT = JR.deckTop, RT = JR.railTop;

  // ---- 桁・床版・防音壁・道床・レール
  const segs: [number, number, number][] = [[-H, st0 - 8, JR.hw], [st0 - 8, st1 + 8, JR.hwSta], [st1 + 8, H, JR.hw]];
  for (const [a, b, hw] of segs) {
    jb(farC, 'body', a, b, -hw, hw, DT - .9, DT, C.concrete);
    for (const sd of [-1, 1]) {
      jb(farC, 'body', a, b, sd < 0 ? -hw : hw - .5, sd < 0 ? -hw + .5 : hw, DT - 1.5, DT + .15, C.slab);          // 桁の縁
      if (a >= st0 - 8 && b <= st1 + 8) continue;                                                                    // 駅部は壁なし
      jb(farC, 'body', a, b, sd * (hw - .45) - .12, sd * (hw - .45) + .12, DT, DT + 1.25, 0xaab4b9);                  // 防音壁
    }
  }
  // 長い桁（南海の高架をまたぐ区間）は縁を深く
  for (const sd of [-1, 1]) jb(farC, 'body', JR.gapFrom, JR.gapTo, sd < 0 ? -JR.hw : JR.hw - .5, sd < 0 ? -JR.hw + .5 : JR.hw, DT - 2.9, DT - 1.5, C.slab);
  jb(farC, 'body', -H, st0 - 8, -JR.hw + .6, JR.hw - .6, DT, DT + .3, 0x7d7a74);
  jb(farC, 'body', st1 + 8, H, -JR.hw + .6, JR.hw - .6, DT, DT + .3, 0x7d7a74);
  jb(farC, 'body', st0 - 8, st1 + 8, -JR.hwSta + .5, JR.hwSta - .5, DT, DT + .3, 0x7d7a74);
  for (const w of JR.tracks) {
    jb(nearC, 'body', -H, H, w - 1.3, w + 1.3, DT + .3, DT + .36, 0x4d4a45);
    for (const g of [-.53, .53]) jb(nearC, 'body', -H, H, w + g - .06, w + g + .06, DT + .36, RT, 0xa3a39c);
  }
  // 橋脚（ラーメン式）: 南海の高架の下は 長い桁でまたぐので、JR 軸上 t = -25 / +40 から外側へ 25m 間隔
  const piers: number[] = [];
  for (let t = JR.gapFrom; t >= -H + 10; t -= 25) piers.push(t);
  for (let t = JR.gapTo; t <= H - 10; t += 25) piers.push(t);
  for (const t of piers) {
    const hw = inSta(t) ? JR.hwSta : JR.hw;
    jb(farC, 'body', t - .9, t + .9, -hw + .5, hw - .5, DT - 2.2, DT - .9, C.concrete);                                // 梁
    for (const w of [-hw * .62, hw * .62]) jpost(farC, t, w, -.4, DT - 2.2, 1.6, C.concrete);
  }

  // ---- 電車線（南海の高架の下は低い単線だけ）と支持門型
  const wireY = 12.2;
  for (const w of JR.tracks) jb(nearC, 'body', -H, H, w - .03, w + .03, wireY, wireY + .05, 0x30343a);
  for (let t = -H + 25; t < H; t += 50) {
    if (t > JR.gapFrom - 22 && t < JR.gapTo + 15) continue;
    if (inSta(t)) continue;
    for (const sd of [-1, 1]) jpost(nearC, t, sd * (JR.hw - .9), DT, DT + 6.2, .35, C.steel);
    jb(nearC, 'body', t - .1, t + .1, -JR.hw + .7, JR.hw - .7, DT + 5.7, DT + 6.0, C.steel);
    for (const w of JR.tracks) jb(nearC, 'body', t - .05, t + .05, w - .03, w + .03, wireY - .02, DT + 5.7, 0x6b7076);
  }

  // ---- 駅（新今宮）: 外側のレールの外にホーム2面（t 60〜220）、鉄骨の屋根・照明・駅名標
  const pw0 = JR.tracks[3] + 1.7, pw1 = pw0 + 4.2, PT = RT + .9;
  const boardTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#f3f3ee'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b5d8e'; g.fillRect(0, 0, w, 22); g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#12202c'; g.font = `800 56px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('新今宮', w / 2, h / 2 - 2);
    g.font = `600 22px ${FONT}`; g.fillText('Shin-Imamiya', w / 2, h / 2 + 34);
  });
  for (const sd of [-1, 1]) {
    const a = sd * pw0, b = sd * pw1;
    jb(nearC, 'body', st0, st1, Math.min(a, b), Math.max(a, b), DT, PT, 0xbdbab1);
    jb(nearC, 'body', st0, st1, Math.min(sd * pw0, sd * (pw0 + .5)), Math.max(sd * pw0, sd * (pw0 + .5)), PT, PT + .03, 0xc9b038);   // 点字ブロックの帯
    // 屋根（屋根は線路側の端を少しホームの内側まで）
    const rin = sd * (pw0 + .4), rout = sd * (pw1 + .5), roofY = PT + 3.4;
    jb(nearC, 'body', st0 + 4, st1 - 4, Math.min(rin, rout), Math.max(rin, rout), roofY, roofY + .3, 0x7f8f9c);
    for (let t = st0 + 6; t <= st1 - 6; t += 12) {
      jpost(nearC, t, sd * (pw1 - .2), PT, roofY, .3, C.steel);
      jb(litC, 'lit', t - 1.5, t + 1.5, sd * (pw0 + 2.1) - .3, sd * (pw0 + 2.1) + .3, roofY - .08, roofY, WARM);
    }
    // 駅名標（両面）
    for (const t of [st0 + 40, st0 + 110]) {
      const w = sd * (pw0 + 2.4);
      jpost(nearC, t, w, PT, PT + 2.6, .15, C.steel);
      for (const f of [-1, 1]) {
        const p = J(t + f * .1, w, PT + 2.2), th = Math.atan2(f * ax, f * az);
        nearC.at(chunkOf(t)).add('sign', P.plane, M(p.x, p.y, p.z, th, 3.2, .8, 1), 0xffffff);
      }
    }
    // 階段室（地上からホームへ）
    jb(farC, 'body', st0 - 4, st0 + 8, sd * (JR.hwSta + .2) - 1.8, sd * (JR.hwSta + .2) + 1.8, 0, PT - .2, C.wall);
    jb(litC, 'lit', st0 - 3.5, st0 + 7.5, sd * (JR.hwSta + .2 + 1.84) - .02, sd * (JR.hwSta + .2 + 1.84) + .02, 2, 4.2, COOL);
  }
  // 駅部の桁の縁より外側のホームの張り出し（台）を支える桁
  jb(farC, 'body', st0, st1, -pw1 - .6, pw1 + .6, DT - 1.2, DT - .8, C.concrete);

  const farMat = bodyMat();
  const boardMat = new THREE.MeshLambertMaterial({ map: boardTex, vertexColors: true, emissiveMap: boardTex, emissive: 0xffffff, emissiveIntensity: 0 });
  onLight(ctx, f => { boardMat.emissiveIntensity = f * .35; });
  const farRoot = new THREE.Group(), nearRoot = new THREE.Group();
  for (const g of farC.build({ body: farMat }, farRoot)) cullByDistance(ctx, g, 2000);
  for (const g of nearC.build({ body: farMat, sign: boardMat }, nearRoot)) cullByDistance(ctx, g, 800);
  for (const g of litC.build({ lit: litMaterial(ctx) }, nearRoot)) cullByDistance(ctx, g, 800);
  ctx.scene.add(farRoot, nearRoot);
}

// ================= 3. 大和川の堤防と道路橋 =================
function buildRiver(ctx: GameContext): void {
  const { T, track, pos, box } = localTools(ctx);
  const far = new GeoBatch(), near = new GeoBatch(), lit = new GeoBatch();
  const c = (2155 + 2375) / 2, half = (2375 - 2155) / 2, crest = half * .85;     // 地形の窪みの肩（|s-c| = 93.5）
  const rnd = seeded(2265);
  const LAT = 300;
  const latRanges: [number, number][] = [[-LAT, -11], [17, LAT]];

  // ---- 法面（芝＋下はコンクリートブロック張り）。地面メッシュの上に薄く重ねる
  const quad = (A: THREE.Vector3, B: THREE.Vector3, Cc: THREE.Vector3, D: THREE.Vector3, color: number) =>
    far.addTris('slope', [A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z, A.x, A.y, A.z, Cc.x, Cc.y, Cc.z, D.x, D.y, D.z], color);
  const rows = 11, d0 = crest, d1 = 45;
  for (const sg of [-1, 1]) for (let i = 0; i < rows; i++) {
    const da = d0 + (d1 - d0) * i / rows, db = d0 + (d1 - d0) * (i + 1) / rows, sa = c + sg * da, sb = c + sg * db;
    const color = db > 74 ? (i % 2 ? 0x6b9a4a : 0x739f50) : (i % 2 ? 0x9da19a : 0xaeb1a9);
    for (const [l0, l1] of latRanges) {
      const pa0 = track.at(sa, l0, 0), pa1 = track.at(sa, l1, 0), pb0 = track.at(sb, l0, 0), pb1 = track.at(sb, l1, 0);
      pa0.y = pa1.y = T.groundY(sa) + .1; pb0.y = pb1.y = T.groundY(sb) + .1;
      quad(pa0, pa1, pb1, pb0, color);
    }
  }
  // ---- 堤防道路（川の両岸の肩の外側）・ガードレール・街灯・並木
  for (const sg of [-1, 1]) {
    const sA = c + sg * (crest + 3), sB = c + sg * (crest + 11);
    box(far, 'body', Math.min(sA, sB), Math.max(sA, sB), -LAT, LAT, 0, .12, C.asphalt, 40);
    const rs = c + sg * (crest + .6);
    for (const [l0, l1] of latRanges) {
      box(near, 'body', rs - .04, rs + .04, l0, l1, .5, .62, 0xc9ccd0, 40);
      for (let l = l0 + 2; l < l1; l += 6) box(near, 'body', rs - .05, rs + .05, l - .05, l + .05, 0, .75, 0xc9ccd0);
      for (let l = l0 + 10; l < l1; l += 36) {
        const s = c + sg * (crest + 10.5);
        box(near, 'body', s - .12, s + .12, l - .12, l + .12, 0, 8, C.steel);
        box(lit, 'lit', s - .6, s + .6, l - .4, l + .4, 8, 8.2, WARM);
      }
      for (let l = l0 + 18; l < l1; l += 24) {
        const p = pos(c + sg * (crest + 14 + rnd() * 3), l + rnd() * 6, 0), r = 3.2 + rnd() * 1.8;
        near.add('body', P.boxB, M(p.x, p.y, p.z, 0, .35, 3.6, .35), 0x6d5640);
        near.add('body', P.sphere, M(p.x, p.y + 5, p.z, 0, r * 2, r * 1.7, r * 2), 0x5f8f4a);
      }
    }
  }

  // ---- 道路橋（右側 lat≈+30、地面と同じ高さで川の窪みをまたぐ）
  const L0 = 23, L1 = 37, DK = .45;
  const bs0 = c - crest - 8.5, bs1 = c + crest + 8.5;
  box(far, 'body', bs0, bs1, L0, L1, DK - 1.0, DK, C.concrete, 40);
  box(far, 'body', bs0, bs1, L0 + .3, L1 - .3, DK, DK + .06, 0x3f4246, 40);             // 舗装
  for (const sd of [L0, L1]) {
    box(far, 'body', bs0, bs1, sd - .25 + (sd === L0 ? .25 : 0), sd + .25 - (sd === L0 ? 0 : .25), DK, DK + 1.0, C.slab, 40);   // 高欄の腰壁
    box(near, 'body', bs0, bs1, sd + (sd === L0 ? .1 : -.1) - .05, sd + (sd === L0 ? .1 : -.1) + .05, DK + 1.0, DK + 1.3, C.steel, 40);
  }
  for (let s = bs0 + 4; s < bs1; s += 8) box(near, 'body', s - 1.4, s + 1.4, 29.85, 30.15, DK + .06, DK + .09, 0xe8e8e0);   // 中央線の破線
  for (const s of [bs0 + 2.5, bs1 - 2.5, ...Array.from({ length: 6 }, (_, i) => bs0 + 38 * (i + 1))]) {
    // 橋脚（壁式）
    if (s > bs0 + 5 && s < bs1 - 5) box(far, 'body', s - .7, s + .7, L0 + 1.5, L1 - 1.5, -6.6, DK - 1.0, C.concrete);
    for (const l of [L0 + .6, L1 - .6]) {
      box(near, 'body', s - .1, s + .1, l - .1, l + .1, DK, DK + 7, C.steel);
      box(lit, 'lit', s - .35, s + .35, l - (l < 30 ? -.9 : .9) - .25, l - (l < 30 ? -.9 : .9) + .25, DK + 7, DK + 7.15, WARM);
    }
  }
  // 橋の前後の取付道路（地面上）
  for (const [a, b] of [[c - crest - 8.5 - 90, c - crest - 8.5], [c + crest + 8.5, c + crest + 8.5 + 90]] as const) {
    box(far, 'body', a, b, L0 + .3, L1 - .3, .0, .1, 0x3f4246, 16);
    for (let s = a + 4; s < b; s += 8) box(near, 'body', s - 1.4, s + 1.4, 29.85, 30.15, .1, .13, 0xe8e8e0);
  }

  const farG = new THREE.Group(), nearG = new THREE.Group();
  const bm = bodyMat(), slope = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  far.build({ body: bm, slope }, farG);
  near.build({ body: bm }, nearG); lit.build({ lit: litMaterial(ctx) }, nearG);
  ctx.scene.add(farG, nearG);
  cullByDistance(ctx, farG, 2000);
  cullByDistance(ctx, nearG, 800);
}

export function buildNambaLandmarks(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  buildMall(ctx);
  buildJr(ctx);
  buildRiver(ctx);
}
