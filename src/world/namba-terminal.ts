// 南海本線 堺〜難波（route.id = 'namba'）専用の景観: 頭端式の難波駅（9面8線のホーム・大屋根・コンコース・高架下の店舗）と周囲の大型ビル
// 位置はすべて線路沿い座標（s, lat, y）。ctx.rng は使わない（局所の疑似乱数）
import * as THREE from 'three';
import { FONT } from '../core/config';
import type { GameContext } from '../core/context';
import { NAMBA_END } from '../route/routes/namba';
import { GeoBatch, M, P, onLight } from './batch';
import { canvasTex } from './canvas-tex';
import { cullByDistance } from './cull';
import { nameTex, person } from './stations';
import { getTerrain } from './terrain';

/** 局所の疑似乱数（mulberry32） */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- 配置 ----
const PS0 = 9775, PS1 = NAMBA_END + 1.5;       // ホームの s 範囲
const SH0 = 9790, SH1 = NAMBA_END;             // 大屋根
const CC0 = NAMBA_END + 2, CC1 = 10075;        // コンコース
const ST1 = 10200;                              // 百貨店の奥
const TRACK_LATS = [-18, -6, 6, 18, 30, 42, 54, 66];
const BOARDS: [number, string][] = [[-18, '8・9'], [-6, '7'], [6, '6'], [18, '5'], [30, '4'], [42, '3'], [54, '2'], [66, '1']];
/** ホーム（左の片面・島式 7・右の片面）。edges = 線路側の縁の向き（+1 = 右、−1 = 左） */
const PLATS = [
  { cx: -22.7, w: 6, edges: [1] },
  ...[-12, 0, 12, 24, 36, 48, 60].map(cx => ({ cx, w: 8.6, edges: [-1, 1] })),
  { cx: 70.7, w: 6, edges: [-1] },
];
const COLS = PLATS.map(p => p.cx);
const LAT0 = -26, LAT1 = 74;                   // 大屋根の横幅

// ---- 外壁テクスチャ（1枚のタイルを繰り返す） ----
interface TileSpec { wall: string; frame: string; glass: string; lit: string; fx: number; fy: number; arch?: boolean; band?: string; mullion?: boolean }
const FACE_KEYS = ['store', 'shop', 'glass', 'terr', 'tower', 'signA', 'signB', 'banner', 'fascia'];

function tileMat(spec: TileSpec): THREE.MeshLambertMaterial {
  const draw = (lit: boolean) => (g: CanvasRenderingContext2D, W: number, H: number) => {
    g.fillStyle = lit ? '#000' : spec.wall; g.fillRect(0, 0, W, H);
    if (!lit && spec.band) { g.fillStyle = spec.band; g.fillRect(0, H - 8, W, 8); g.fillRect(0, 0, W, 3); }
    const ww = W * spec.fx, wh = H * spec.fy, x = (W - ww) / 2, y = (H - wh) / 2;
    const path = (px: number, py: number, pw: number, ph: number) => {
      g.beginPath();
      if (spec.arch) { const r = pw / 2; g.moveTo(px, py + ph); g.lineTo(px, py + r); g.arc(px + r, py + r, r, Math.PI, 0); g.lineTo(px + pw, py + ph); } else g.rect(px, py, pw, ph);
      g.closePath();
    };
    if (!lit) { g.fillStyle = spec.frame; path(x - 4, y - 4, ww + 8, wh + 8); g.fill(); }
    g.fillStyle = lit ? spec.lit : spec.glass; path(x, y, ww, wh); g.fill();
    if (spec.mullion) {
      g.strokeStyle = lit ? '#000' : spec.frame; g.lineWidth = 3; g.beginPath();
      g.moveTo(W / 2, y); g.lineTo(W / 2, y + wh); g.moveTo(x, y + wh * .55); g.lineTo(x + ww, y + wh * .55); g.stroke();
    }
  };
  const map = canvasTex(128, 128, draw(false)), emi = canvasTex(128, 128, draw(true));
  for (const t of [map, emi]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap: emi, emissiveIntensity: 0 });
}

const textTex = (w: number, h: number, bg: string, fg: string, text: string, size: number) => canvasTex(w, h, (g, W, H) => {
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = fg; g.font = `800 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + size * .05);
});

export function buildNambaTerminal(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  const { track } = ctx, T = getTerrain(ctx), rnd = prng(0x4e414d42);
  const sts = ctx.route.stations, sta = sts[sts.length - 1], prevName = sts[sts.length - 2]?.name ?? '新今宮';
  const dyAt = (s: number) => T.groundY(s) - T.trackY(s);
  const phiAt = (s: number) => track.trackAt(s).phi;
  const FACE_RY = { F: 0, B: Math.PI, L: -Math.PI / 2, R: Math.PI / 2 };

  /** 箱: 中心 (s, lat, y)、寸法 lat 幅 w・高さ h・s 長さ d */
  const bx = (b: GeoBatch, key: string, s: number, lat: number, y: number, w: number, h: number, d: number, col: number) => {
    const v = track.at(s, lat, y); b.add(key, P.box, M(v.x, v.y, v.z, -phiAt(s), w, h, d), col);
  };
  /** s 範囲・lat 範囲・y 範囲で指定する箱 */
  const solid = (b: GeoBatch, key: string, sa: number, sb: number, l0: number, l1: number, y0: number, y1: number, col: number) =>
    bx(b, key, (sa + sb) / 2, (l0 + l1) / 2, (y0 + y1) / 2, l1 - l0, y1 - y0, sb - sa, col);
  /** 板（face の向きに面する）。tw/th を渡すとタイルを繰り返す。w は横（F/B は lat 方向、L/R は s 方向） */
  const pl = (b: GeoBatch, key: string, s: number, lat: number, y: number, face: keyof typeof FACE_RY, w: number, h: number, tw = 0, th = 0) => {
    const v = track.at(s, lat, y);
    b.add(key, P.plane, M(v.x, v.y, v.z, -phiAt(s) + FACE_RY[face], w, h, 1), 0xffffff, tw ? [0, 0, w / tw, h / th] : undefined);
  };
  const arc = (sc: number, lat: number, h = 10) => { const a = track.at(sc - h, lat, 0), c = track.at(sc + h, lat, 0); return Math.hypot(a.x - c.x, a.z - c.z); };

  const det = new GeoBatch(new Set(['signA', 'signB'])), big = new GeoBatch(new Set(FACE_KEYS)), park = new GeoBatch(new Set(FACE_KEYS));
  const dy0 = dyAt(9900), top0 = -.12; // 高架下の底（地面）と、既存の高架床の下に隠れる上面

  // ================= ホーム（9面） =================
  for (const p of PLATS) {
    solid(det, 'body', PS0, PS1, p.cx - p.w / 2, p.cx + p.w / 2, top0, 1.1, 0xc9c5bc);
    for (const e of p.edges) {
      const ex = p.cx + e * p.w / 2;
      solid(det, 'body', PS0, PS1, ex - e * .7 - .15, ex - e * .7 + .15, 1.1, 1.12, 0xf2c200);  // 点字ブロック
      solid(det, 'body', PS0, PS1, ex - e * .12 - .125, ex - e * .12 + .125, 1.1, 1.13, 0xf4f4f4); // 白線
      solid(det, 'body', PS0, PS1, ex - e * .05, ex + e * .01, .75, 1.05, 0x9a968c);
    }
    // 片面ホームの外側: 柵
    if (p.edges.length === 1) {
      const out = p.cx - p.edges[0] * (p.w / 2 - .1);
      solid(det, 'body', PS0, PS1, out - .03, out + .03, 1.1, 2.4, 0x9fb0a8);
      solid(det, 'body', PS0, PS1, out - .04, out + .04, 2.35, 2.45, 0x8a9096);
    }
    // ベンチ
    for (let s = PS0 + 24; s < PS1 - 30; s += 30) {
      if (p.edges.length === 2) for (const sx of [-1, 1]) {
        bx(det, 'body', s, p.cx + sx * .55, 1.55, .45, .06, 2.2, 0x2a6aa8); bx(det, 'body', s, p.cx + sx * .32, 1.85, .06, .45, 2.2, 0x2a6aa8);
      } else {
        const o = p.cx - p.edges[0] * 2.2;
        bx(det, 'body', s, o, 1.55, .45, .06, 2.2, 0x2a6aa8); bx(det, 'body', s, o - p.edges[0] * .22, 1.85, .06, .45, 2.2, 0x2a6aa8);
      }
    }
    // 自販機
    for (const s of [PS0 + 14, PS1 - 22]) bx(det, 'body', s, p.edges.length === 2 ? p.cx + 1.4 : p.cx - p.edges[0] * 1.4, 2.0, .7, 1.8, .95, s < 9900 ? 0xc8282a : 0x2a5fb0);
    // 改札（ホーム端）
    const gl = p.edges.length === 2 ? [-3.4, -1.2, 1.2, 3.4] : [-1.6, 0, 1.6];
    for (const g of gl) { bx(det, 'body', PS1 - 3.5, p.cx + g, 1.6, .5, 1.0, 1.6, 0x8a9096); bx(det, 'body', PS1 - 3.5, p.cx + g, 2.12, .52, .05, 1.62, 0x2a6aa8); }
    // 人（まばら）
    const n = p.edges.length === 2 ? 7 : 4;
    for (let k = 0; k < n; k++) {
      const s = PS1 - 8 - rnd() * 180, e = p.edges[Math.floor(rnd() * p.edges.length)];
      const lat = p.cx + e * (1.1 + rnd() * 1.1), v = track.at(s, lat, 1.1);
      det.parent = new THREE.Matrix4().makeRotationY(-phiAt(s)).setPosition(v);
      person(det, rnd, 0, 0, rnd() < .7 ? (e > 0 ? -Math.PI / 2 : Math.PI / 2) : rnd() * 6);
      det.parent = null;
    }
  }
  // 駅名標（島式は吊り下げ、両面。片面は線路側の面だけ）。左を向く面は 次→前、右を向く面は 前→次
  for (const p of PLATS) for (const s of [9850, 9930, 10010]) {
    if (p.edges.length === 2) {
      bx(det, 'body', s, p.cx, 7.85, .06, 2.1, .06, 0x777d84);
      pl(det, 'signA', s, p.cx - .05, 6.3, 'L', 3.4, 1.0); pl(det, 'signB', s, p.cx + .05, 6.3, 'R', 3.4, 1.0);
    } else {
      const e = p.edges[0], lat = p.cx + e * 1.8;
      bx(det, 'body', s, lat, 7.85, .06, 2.1, .06, 0x777d84);
      if (e > 0) pl(det, 'signB', s, lat + .05, 6.3, 'R', 3.4, 1.0); else pl(det, 'signA', s, lat - .05, 6.3, 'L', 3.4, 1.0);
    }
  }

  // ================= 大屋根 =================
  const ROWS: number[] = []; for (let s = 9800; s <= 10020; s += 20) ROWS.push(s);
  const RW = LAT1 - LAT0, RC = (LAT0 + LAT1) / 2;
  for (const s of ROWS) {
    for (const cx of COLS) bx(big, 'body', s, cx, 5.05, .5, 7.9, .5, 0x8a9096);          // 柱（ホーム上だけ）
    bx(big, 'body', s, RC, 9.2, RW, .6, .5, 0x6b7680);                                    // 横梁
  }
  for (const cx of COLS) solid(big, 'body', SH0, SH1, cx - .25, cx + .25, 8.9, 9.2, 0x6b7680); // 縦の桁
  solid(big, 'body', SH0, SH1, LAT0, LAT1, 9.5, 9.7, 0x9aa3ab);                           // 屋根板
  solid(big, 'body', SH0 - .2, SH0 + .3, LAT0, LAT1, 9.0, 10.9, 0xbcc3c9);                // 前面の鼻隠し
  for (let i = 0; i + 1 < COLS.length; i++) {
    const mid = (COLS[i] + COLS[i + 1]) / 2, w = (COLS[i + 1] - COLS[i]) * .55;
    for (let s = SH0 + 3; s + 14 < SH1 - 2; s += 20) {
      solid(big, 'skyT', s, s + 14, mid - w / 2, mid + w / 2, 9.7, 10.8, 0x9fc4d8);       // 天窓
      solid(big, 'skyU', s, s + 14, mid - w / 2, mid + w / 2, 9.45, 9.49, 0xe4eef4);      // 天窓の下面（明かり）
    }
  }
  for (let s = 9806; s < SH1 - 3; s += 12) for (const lat of [...COLS, ...TRACK_LATS]) bx(big, 'lamp', s, lat, 8.7, .3, .12, 2.2, 0xfff4de); // 照明
  // 前面の看板
  pl(big, 'fascia', SH0 - .25, 24, 9.95, 'F', 28, 1.75);
  // 番線標（各線路の中心上、梁から吊る）
  const boardGrp = new THREE.Group(), boardMats: THREE.MeshLambertMaterial[] = [];
  for (const [lat, label] of BOARDS) for (const s of [9860, 10000]) {
    const tex = textTex(512, 160, '#1d4f9a', '#fff', label + '番線', 100);
    const m = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .05 }); boardMats.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.06), m), v = track.at(s - .4, lat, 8.0);
    mesh.position.copy(v); mesh.rotation.y = -phiAt(s); boardGrp.add(mesh);
    bx(big, 'body', s - .4, lat, 8.7, .08, .5, .08, 0x777d84);
  }

  // ================= コンコース・高架下・百貨店 =================
  solid(big, 'body', CC0, CC1, -30, 80, -.05, 8, 0xcfc9bc);
  solid(big, 'body', CC0 - .5, CC1, -31, 81, 8, 8.5, 0x6b7680);                           // 屋根
  pl(big, 'glass', CC0 - .05, 25, 2.1, 'F', 110, 3.9, 3, 3.9);                            // 正面ガラス
  solid(big, 'body', CC0 - .12, CC0 - .05, -30, 80, 4.05, 8, 0x22305e);                    // 看板帯
  for (const lat of [-5, 25, 55]) pl(big, 'banner', CC0 - .14, lat, 6.03, 'F', 19.5, 3.65);
  // 高架下の店舗（地面から高架の床まで）
  solid(big, 'body', 9760, CC1, -27, 75, dy0 - 1, top0, 0xaaa497);
  pl(big, 'shop', 9759.95, 24, (dy0 + top0) / 2, 'F', 102, top0 - dy0, 5, 4);
  // 側面は s 方向に長いので中心 s から置く
  pl(big, 'shop', (9760 + CC1) / 2, -27.05, (dy0 + top0) / 2, 'L', CC1 - 9760, top0 - dy0, 5, 4);
  pl(big, 'shop', (9760 + CC1) / 2, 75.05, (dy0 + top0) / 2, 'R', CC1 - 9760, top0 - dy0, 5, 4);
  // 百貨店（石造り風の大きな箱、地面から約45m）
  const sTop = dy0 + 45;
  solid(big, 'body', CC1, ST1, -40, 90, dy0 - 1, sTop, 0xd6ccb4);
  pl(big, 'store', CC1 - .05, 25, (8.5 + sTop) / 2, 'F', 130, sTop - 8.5, 3.6, 4.5);
  for (const lat of [-35, 85]) pl(big, 'store', CC1 - .05, lat, (dy0 + 8.5) / 2, 'F', 10, 8.5 - dy0, 3.6, 4.5);
  pl(big, 'store', (CC1 + ST1) / 2, -40.05, (dy0 + sTop) / 2, 'L', ST1 - CC1, sTop - dy0, 3.6, 4.5);
  pl(big, 'store', (CC1 + ST1) / 2, 90.05, (dy0 + sTop) / 2, 'R', ST1 - CC1, sTop - dy0, 3.6, 4.5);
  solid(big, 'body', CC1 - 1, ST1 + 1, -41, 91, sTop - 1.4, sTop + .2, 0xe4dcc8);          // 軒蛇腹
  solid(big, 'body', CC1 + 10, ST1 - 10, -30, 80, sTop + .2, sTop + 3.4, 0x8a8f86);       // 屋上の段
  solid(big, 'body', CC1 + 25, ST1 - 25, -5, 55, sTop + 3.4, sTop + 7.6, 0x5d7d6a);       // 銅葺き風の屋根
  solid(big, 'body', CC1 + 35, CC1 + 45, 14, 36, sTop + 7.6, sTop + 12, 0x6d8d78);

  // ================= なんばパークス風の段状の複合施設（左 = 西側、カーブの内側。OpenStreetMap の位置） =================
  // 駅のホームの西に沿って s 9570〜9850（OSM のなんばパークスの外形）。線路側から外へ段々に高くなる。
  // 西寄りにパークスタワー（約150m）、南西にタワーマンション（約150m）
  const TIERS = 6, TW = 19, STEP = 20, PK0 = 9570, PK1 = 9850;
  const TOWERS = [{ s: 9756, lat: -121, h: 148, w: 26 }, { s: 9584, lat: -150, h: 149, w: 28 }];
  const onTower = (sc: number, lc: number) => TOWERS.some(t => Math.abs(sc - t.s) < t.w / 2 + STEP / 2 && Math.abs(lc - t.lat) < t.w / 2 + TW / 2);
  for (let k = 0; k < TIERS; k++) {
    const l1 = -(46 + k * TW), l0 = l1 - TW, lc = (l0 + l1) / 2, H = 14 + k * 5.5, Hp = k ? 14 + (k - 1) * 5.5 : 0;
    for (let s = PK0; s < PK1; s += STEP) {
      const sc = s + STEP / 2, dy = dyAt(sc), d = arc(sc, lc) + .5;
      if (onTower(sc, lc)) continue;
      bx(park, 'body', sc, lc, dy + H / 2 - .5, TW, H + 1, d, 0xd9d1c0);
      bx(park, 'body', sc, lc, dy + H + .3, TW - 2, .6, d - 1, 0x4f8f45);                  // 屋上緑化
      pl(park, 'terr', sc, l1 + .05, dy + (Hp + H) / 2, 'R', d, H - Hp, 4, 5.5);
      if (s === PK0) pl(park, 'terr', sc - STEP / 2 - .05, lc, dy + H / 2, 'F', TW, H, 4, 5.5);
      for (let q = 0; q < 2; q++) bx(park, 'body', sc + (rnd() - .5) * (d - 4), lc + (rnd() - .5) * (TW - 6), dy + H + 1.1, 3, 1.4, 3, 0x2f6f3a); // 植え込み
      if (((s - PK0) / STEP + k) % 2 === 0) {
        const x = sc + (rnd() - .5) * (d - 6), y = lc + (rnd() - .5) * (TW - 8);
        bx(park, 'body', x, y, dy + H + 1.6, .4, 2, .4, 0x6a4a2a);
        const v = track.at(x, y, dy + H + 4.4);
        park.add('body', P.sphere, M(v.x, v.y, v.z, 0, 3.6, 3.2, 3.6), 0x3f8a3f);
      }
    }
  }
  // 高層棟
  for (const { s, lat, h, w } of TOWERS) {
    const dy = dyAt(s);
    bx(park, 'body', s, lat, dy + h / 2 - .5, w, h + 1, w, 0x9fb0be);
    pl(park, 'tower', s - w / 2 - .05, lat, dy + h / 2, 'F', w, h, 3, 3.6);
    pl(park, 'tower', s + w / 2 + .05, lat, dy + h / 2, 'B', w, h, 3, 3.6);
    pl(park, 'tower', s, lat - w / 2 - .05, dy + h / 2, 'L', w, h, 3, 3.6);
    pl(park, 'tower', s, lat + w / 2 + .05, dy + h / 2, 'R', w, h, 3, 3.6);
    bx(park, 'body', s, lat, dy + h + 2, w - 6, 4, w - 6, 0x7a8896);
    bx(park, 'body', s, lat, dy + h + 10, .8, 12, .8, 0xc8282a);
  }

  // ================= 仕上げ =================
  const body = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lamp = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const skyU = new THREE.MeshBasicMaterial({ vertexColors: true });
  const skyT = new THREE.MeshLambertMaterial({ vertexColors: true });
  const face: THREE.MeshLambertMaterial[] = [
    tileMat({ wall: '#d8cdb6', frame: '#b9ad94', glass: '#3a4a5c', lit: '#ffd88a', fx: .5, fy: .62, arch: true, band: '#c4b89e', mullion: true }), // store
    tileMat({ wall: '#8d8a82', frame: '#55524c', glass: '#2c3a46', lit: '#ffe2a8', fx: .84, fy: .5, band: '#6a675f' }),                              // shop
    tileMat({ wall: '#cfc9bc', frame: '#6b7680', glass: '#35505f', lit: '#ffe9b8', fx: .96, fy: .94, mullion: true }),                              // glass
    tileMat({ wall: '#e0d9c8', frame: '#9a948a', glass: '#4a6a7a', lit: '#ffe2a8', fx: .92, fy: .5, band: '#bdb6a6' }),                              // terr
    tileMat({ wall: '#9fb0be', frame: '#5d6d7a', glass: '#27414f', lit: '#d8ecff', fx: .9, fy: .62, mullion: true }),                               // tower
  ];
  const signTex = [nameTex(sta, '終点', prevName), nameTex(sta, prevName, '終点')];
  const signMats = signTex.map(t => new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .05 }));
  const bannerTex = textTex(1024, 192, '#22305e', '#fff', '南海なんば駅', 120), fasciaTex = textTex(2048, 128, '#1d2a5a', '#fff', '難波 なんば  NAMBA', 84);
  const bannerMat = new THREE.MeshLambertMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: .05 });
  const fasciaMat = new THREE.MeshLambertMaterial({ map: fasciaTex, emissive: 0xffffff, emissiveMap: fasciaTex, emissiveIntensity: .05 });
  const mats: Record<string, THREE.Material> = {
    body, lamp, skyU, skyT, store: face[0], shop: face[1], glass: face[2], terr: face[3], tower: face[4],
    signA: signMats[0], signB: signMats[1], banner: bannerMat, fascia: fasciaMat,
  };

  const detG = new THREE.Group(), bigG = new THREE.Group(), parkG = new THREE.Group();
  det.build(mats, detG); detG.add(boardGrp);
  big.build(mats, bigG); park.build(mats, parkG);
  ctx.scene.add(detG, bigG, parkG);
  cullByDistance(ctx, detG, 700);
  cullByDistance(ctx, bigG, 1500);
  cullByDistance(ctx, parkG, 1800);

  onLight(ctx, night => {
    for (const m of face) m.emissiveIntensity = night * .9;
    for (const m of [...signMats, ...boardMats, bannerMat, fasciaMat]) m.emissiveIntensity = .05 + night * .75;
    lamp.color.setScalar(.35 + .65 * night);
    skyU.color.setScalar(.92 - .62 * night);
    skyT.emissive.setScalar(night * .18);
  });
}
