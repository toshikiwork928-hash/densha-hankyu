// 南海本線 みさき公園〜和歌山港（route.id = 'misaki-wakayamako' / '-up'）専用: 和歌山市駅の構内（座標は下りのもの。上りは world/mw-frame.ts で写す）。
//   島式ホーム2面（3番線|ホーム1|4番線（自列車・下り）|5番線|ホーム2|6/7番線）、駅舎、跨線橋、車庫（留置線・検修庫）、JR 和歌山市駅（簡易）、駅前の大型施設の箱。
//   3・6・7番線と車庫の引上げ線は route.extraTracks（描画は track-mesh.ts）。車庫の留置線・JR の線路はここで描く（route.extraTracks に入れない）。
//   ホームの上屋・駅名標・人は buildIsland（独自の乱数で ctx.rng を消費しない）。形・寸法は出典に無く、ゲーム用の概形。
// 留置の電車は車両モデルが DOM を使うので world/wakayamashi-trains.ts（world/index.ts からだけ呼ぶ。建築限界検査には含めない）。
import * as THREE from 'three';
import { FONT } from '../core/config';
import type { GameContext } from '../core/context';
import { createRng } from '../core/rng';
import { profileLat } from '../route/service';
import { WK } from '../route/routes/misaki-wakayamako-wakayama';
import type { LatProfile } from '../route/types';
import { GeoBatch, M, P } from './batch';
import { canvasTex } from './canvas-tex';
import { cullByDistance } from './cull';
import { buildIsland } from './stations';
import { extrudeFn } from './track-mesh';
import { mwFrame } from './mw-frame';

const GAUGE = .535;

/** 構内の線路（route.extraTracks に入れない描画だけの線）。bump = 行き止まりの端（to）に車止め */
export interface YardLine { id: string; lat: LatProfile; from: number; to: number; wire?: boolean }
export const SHED = { from: 12440, to: 12600, lat0: 31.0, lat1: 41.4 };
export const YARD: Record<string, YardLine> = {
  jr: { id: 'jr', lat: [[11640, -64], [WK.jr, WK.jrLat]], from: 11640, to: WK.jrBump },
  d1: { id: 'd1', lat: [[12330, 20]], from: 12330, to: WK.depot.bump, wire: true },
  d2: { id: 'd2', lat: [[12350, 20], [12430, 24.6]], from: 12350, to: WK.depot.bump, wire: true },
  d4: { id: 'd4', lat: [[12335, 20], [12435, 33.8]], from: 12335, to: WK.depot.bump },
  d5: { id: 'd5', lat: [[12450, 33.8], [12520, 38.4]], from: 12450, to: WK.depot.bump },
};
/** JR のホーム（1面1線の簡易）: 線路の外側（左）に片面ホーム */
const JR_PLAT = { from: 12435, to: 12530, lat: WK.jrPlat, width: 6 };

const wall = 0xe3ded2, roofC = 0x6d7a86;

export function buildWakayamashi(ctx: GameContext): void {
  const f = mwFrame(ctx);
  if (!f) return;
  const { scene, track } = f;
  const sta = f.route.stations.find(s => s.name === '和歌山市');
  if (!sta) return;
  const root = new THREE.Group(); root.name = 'wakayamashi';
  const matBallast = new THREE.MeshLambertMaterial({ color: 0x8a8378, side: THREE.DoubleSide });
  const matRail = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: .8, roughness: .35, side: THREE.DoubleSide });
  const matSleeper = new THREE.MeshLambertMaterial({ color: 0x6b6259 });
  const matBody = new THREE.MeshLambertMaterial({ vertexColors: true });
  const batch = new GeoBatch();
  const boxAt = (s: number, lat: number, y: number, w: number, h: number, d: number, color: number, key = 'c') => {
    const p = track.at(s, lat, y), t = track.trackAt(s);
    batch.add(key, P.boxB, M(p.x, p.y, p.z, -t.phi, w, h, d), color);
  };

  // --- ホーム（独自の乱数。ctx.rng は消費しない）
  const prev = '紀ノ川', next = '和歌山港';
  const ictx: GameContext = { ...f, rng: createRng(0x5a11) };
  buildIsland(ictx, sta, prev, next, WK.latP1, WK.platW, { stairs: true, roof: .72 });
  buildIsland(ictx, sta, prev, next, WK.latP2, WK.platW, { stairs: true, roof: .72 });

  // --- 構内の線路（JR・車庫）: バラスト・レール・枕木・車止め
  const sleeperGeo = new THREE.BoxGeometry(2.0, .14, .22);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const red = new THREE.MeshLambertMaterial({ color: 0xc8322a }), white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d52 }), redLamp = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  for (const l of Object.values(YARD)) {
    const lat = (s: number) => profileLat(l.lat, s);
    root.add(extrudeFn(track, s => { const m = lat(s); return [[m - 2.3, 0], [m - 1.4, .215], [m + 1.4, .215], [m + 2.3, 0]]; }, l.from, l.to, 3, matBallast));
    for (const g of [-GAUGE, GAUGE])
      root.add(extrudeFn(track, s => { const r = lat(s) + g; return [[r - .035, .243], [r - .035, .383], [r + .035, .383], [r + .035, .243]]; }, l.from, l.to, 3, matRail));
    const n = Math.ceil((l.to - l.from) / .65) + 1, inst = new THREE.InstancedMesh(sleeperGeo, matSleeper, n);
    let i = 0;
    for (let s = l.from; s < l.to && i < n; s += .65) {
      const t = track.trackAt(s), slope = lat(s + .5) - lat(s - .5);
      // 分かれ始めの重なる所（別の線の上）は枕木を省く
      if (l.id !== 'jr' && Object.values(YARD).some(o => o !== l && o.id !== 'jr' && s >= o.from && s <= o.to && o.from < l.from && Math.abs(profileLat(o.lat, s) - lat(s)) < 1.3)) continue;
      q.setFromEuler(e.set(0, -t.phi - Math.atan(slope), 0));
      inst.setMatrixAt(i++, m4.compose(track.at(s, lat(s), .27), q, one));
    }
    inst.count = i; inst.computeBoundingSphere(); root.add(inst);
    // 車止め（to の端）
    const sb = l.to - 1.2, t = track.trackAt(sb), grp = new THREE.Group();
    grp.name = 'track-bumper'; grp.userData.clearanceExempt = 'rail-stop';
    grp.position.copy(track.at(sb, lat(sb), 0)); grp.rotation.y = -t.phi;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, .5, .35), red); beam.position.set(0, 1.0, 0); grp.add(beam);
    for (const x of [-.6, .6]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(.4, .52, .37), white); st.position.set(x, 1.0, 0); grp.add(st);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.3, .12), steel); leg.position.set(x * 1.4, .6, -.5); leg.rotation.x = .5; grp.add(leg);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.25, .25, .1), redLamp); lamp.position.set(0, 1.5, -.2); grp.add(lamp);
    root.add(grp);
  }

  // --- JR のホーム・上屋（簡易）
  {
    const sc = (JR_PLAT.from + JR_PLAT.to) / 2, len = JR_PLAT.to - JR_PLAT.from;
    boxAt(sc, JR_PLAT.lat, 0, JR_PLAT.width, 1.1, len, 0xc9c5bc);
    boxAt(sc, JR_PLAT.lat + JR_PLAT.width / 2 - 1.1, 1.1, .3, .02, len, 0xf2c200);
    boxAt(sc, JR_PLAT.lat, 4.0, JR_PLAT.width - .6, .16, len * .7, 0x7d8a8f);
    for (let s = sc - len * .35 + 3; s <= sc + len * .35; s += 10) boxAt(s, JR_PLAT.lat - JR_PLAT.width / 2 + .5, 1.1, .22, 2.9, .22, 0x8a9096);
  }
  // JR の架線柱と架線（簡易。ホームのある範囲はホームの外側、それ以外は線路の左）
  {
    const pts: number[] = [];
    let prevP: THREE.Vector3 | null = null, k = 0;
    for (let s = 11660; s <= YARD.jr.to - 8; s += 45, k++) {
      const jl = profileLat(YARD.jr.lat, s), onPlat = s >= JR_PLAT.from - 4 && s <= JR_PLAT.to;
      const pl = onPlat ? JR_PLAT.lat - JR_PLAT.width / 2 - .2 : jl - 2.9;
      boxAt(s, pl, onPlat ? 1.1 : 0, .3, onPlat ? 5.4 : 6.4, .3, 0x7d8286);
      boxAt(s, (pl + jl) / 2, onPlat ? 6.3 : 6.2, Math.abs(jl - pl), .16, .16, 0x7d8286);
      const p = track.at(s, jl + (k % 2 ? .2 : -.2), 5.5);
      if (prevP) pts.push(prevP.x, prevP.y, prevP.z, p.x, p.y, p.z);
      prevP = p.clone();
    }
    const wire = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
    wire.name = 'catenary-wire'; root.add(wire);
  }

  // --- 車庫の架線（D1・D2。門型の柱と架線）
  {
    const pts: number[] = [];
    for (const id of ['d1', 'd2']) {
      const l = YARD[id];
      let prevP: THREE.Vector3 | null = null, k = 0;
      for (let s = 12440; s <= WK.depot.bump - 6; s += 12, k++) {
        const p = track.at(s, profileLat(l.lat, s) + (k % 2 ? .2 : -.2), 5.5);
        if (prevP) pts.push(prevP.x, prevP.y, prevP.z, p.x, p.y, p.z);
        prevP = p.clone();
      }
    }
    for (const s of [12460, 12520, 12580]) {
      for (const lat of [17.9, 27.2]) boxAt(s, lat, 0, .3, 7.0, .3, 0x7d8286);
      boxAt(s, 22.55, 6.8, 9.3, .3, .3, 0x7d8286);
    }
    const wire = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
    wire.name = 'catenary-wire'; root.add(wire);
  }

  // --- 検修庫（D4・D5を覆う。北東側は開口）
  {
    const sc = (SHED.from + SHED.to) / 2, len = SHED.to - SHED.from, wc = (SHED.lat0 + SHED.lat1) / 2, ww = SHED.lat1 - SHED.lat0, H = 7;
    boxAt(sc, SHED.lat0, 0, .3, H, len, wall);
    boxAt(sc, SHED.lat1, 0, .3, H, len, wall);
    boxAt(SHED.to + .15, wc, 0, ww + .3, H, .3, wall);
    boxAt(sc, SHED.lat0 - .1, 4.4, .1, 1.2, len - 4, 0x39485a, 's');
    boxAt(sc, SHED.lat1 + .1, 4.4, .1, 1.2, len - 4, 0x39485a, 's');
    for (let s = SHED.from + 10; s < SHED.to; s += 20) {
      const p = track.at(s, wc, H), t = track.trackAt(s);
      batch.add('r', P.gable, M(p.x, p.y, p.z, -t.phi, ww + 1.6, 2.8, 20.5), roofC);
    }
    boxAt(SHED.from + .5, SHED.lat0 + .3, 0, .4, H, .4, 0xb0ada3); boxAt(SHED.from + .5, SHED.lat1 - .3, 0, .4, H, .4, 0xb0ada3);
    // 付属棟（車庫の事務所・部品庫）
    boxAt(12350, 46, 0, 9, 4.5, 40, 0xbdb7a8); boxAt(12350, 46, 4.5, 9.4, .3, 40.4, 0x9a978e);
  }

  // --- 駅舎（南海・JR 共用の簡素な地平の建物。南西の端、3番線・JR の行き止まりの先）
  {
    const s0 = 12548, s1 = 12610, l0 = -46, l1 = -4.5, H = 10.5, sc = (s0 + s1) / 2, lc = (l0 + l1) / 2;
    boxAt(sc, lc, 0, l1 - l0, H, s1 - s0, wall);
    boxAt(sc, lc, H, l1 - l0 + 1.2, .5, s1 - s0 + 1.2, roofC);
    for (let l = l0 + 3; l < l1 - 2; l += 4) boxAt(s0 - .05, l, 2.6, 2.4, 1.6, .1, 0x2b343d, 's');
    for (let l = l0 + 3; l < l1 - 2; l += 4) boxAt(s0 - .05, l, 6.4, 2.4, 1.6, .1, 0x2b343d, 's');
    boxAt(s0 - 1.4, (l0 + l1) / 2, 4.0, l1 - l0 - 6, .2, 2.8, 0x8a9096); // 庇
    // 駅名看板（両端の面）
    const tex = canvasTex(1024, 192, (g, w, h) => {
      g.fillStyle = '#1d2a5a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = `800 120px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('和歌山市駅', w / 2, h / 2 + 6);
    });
    const signMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .12 });
    for (const [s, ry] of [[s0 - .2, Math.PI], [s1 + .2, 0]] as const) {
      const t = track.trackAt(s), p = track.at(s, lc, H - 2.4), m = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.1), signMat);
      m.position.copy(p); m.rotation.y = -t.phi + ry; root.add(m);
    }
  }
  // --- キーノ和歌山（南海・和歌山市の再開発。2020年開業。JR ホームの奥、駅の北側）
  // 資料: 商業棟・オフィス棟（南海和歌山市駅ビル・鉄骨7階）・ホテル（カンデオホテルズ南海和歌山・地上12階）・公益施設棟（市民図書館）・駐車場棟からなる。
  // OSM の「キーノ和歌山」は s 12402・横 -44 の約 169m × 50m（4階）。棟ごとの位置・高さ・形は不明で、ゲーム用の概形（docs/plan-south-polish.md 1章）。
  {
    const FL = 3.9; // 1階分の高さ
    const glass = 0x2f4a5c, concrete = 0xd9d5ca, band = 0xb9b4a6, roofGray = 0x7c8389;
    /** 棟: s0〜s1、lat0〜lat1、floors 階。壁と屋上の縁、窓の帯（線路側の面と両端の面）を描く */
    const block = (s0: number, s1: number, l0: number, l1: number, floors: number, col: number, win = true) => {
      const H = floors * FL, sc = (s0 + s1) / 2, lc = (l0 + l1) / 2;
      boxAt(sc, lc, 0, l1 - l0, H, s1 - s0, col);
      boxAt(sc, lc, H, l1 - l0 + .6, .5, s1 - s0 + .6, roofGray);
      if (!win) return;
      for (let k = 0; k < floors; k++) {
        const y = k * FL + 1.0;
        boxAt(sc, l1 + .06, y, .1, FL - 1.5, s1 - s0 - 3, glass, 's'); // 線路側（右）の窓帯
        boxAt(s0 - .06, lc, y, l1 - l0 - 3, FL - 1.5, .1, glass, 's'); // なんば寄りの端
        boxAt(s1 + .06, lc, y, l1 - l0 - 3, FL - 1.5, .1, glass, 's'); // 和歌山港寄りの端
        boxAt(sc, l1 + .1, k * FL + FL - .45, .14, .3, s1 - s0, band, 's'); // 階の境の帯
      }
    };
    block(12322, 12486, -76, -40, 4, concrete);                       // 商業棟（4階）
    block(12430, 12486, -76, -54, 12, 0xe8e6df);                      // ホテル（地上12階）。商業棟の南西端から立ち上がる
    block(12488, 12518, -72, -42, 7, 0xe3e0d6);                       // オフィス棟（南海和歌山市駅ビル 7階）
    block(12330, 12384, -104, -78, 4, 0xe9e4d6);                      // 公益施設棟（市民図書館 4階）
    // 立体駐車場: 床スラブを重ね、外周に低い壁。車は入れない
    {
      const s0 = 12392, s1 = 12436, l0 = -104, l1 = -80, n = 5;
      for (let k = 0; k <= n; k++) boxAt((s0 + s1) / 2, (l0 + l1) / 2, k * 3, l1 - l0, .3, s1 - s0, 0xb8b5ad);
      for (const [ss, ll] of [[s0, l0], [s1, l0], [s0, l1], [s1, l1], [(s0 + s1) / 2, l0], [(s0 + s1) / 2, l1]]) boxAt(ss, ll, 0, .5, n * 3, .5, 0xa7a49c);
      boxAt((s0 + s1) / 2, l1, 0, .1, n * 3, s1 - s0, 0x8e8c85, 's');
    }
    // 施設名の看板は置かない（ユーザー指示 2026-10-10）
  }

  // --- 跨線橋（JR ホーム〜ホーム1〜ホーム2。架線の上を越える）
  {
    const S = 12500, yb = 8.4, a = WK.jrPlat, b = WK.latP2 + 1.3;
    boxAt(S, (a + b) / 2, yb, b - a, 3, 4, 0xdedad0);
    boxAt(S, (a + b) / 2, yb + 3, b - a + .6, .25, 4.6, roofC);
    for (let l = a + 2; l < b - 1; l += 2.2) for (const dz of [-2.01, 2.01]) boxAt(S + dz, l, yb + 1.1, 1.6, .9, .02, 0x2b343d, 's');
    for (const l of [a, WK.latP1, WK.latP2]) {
      boxAt(S, l, 1.1, 2.6, yb - 1.1, 3, 0xd8d4ca);
      for (const dz of [-1.8, 1.8]) boxAt(S + dz, l, 1.1, .4, yb - 1.1, .4, 0x9aa0a6);
    }
  }

  batch.build({ c: matBody, s: matBody, r: matBody }, root);
  scene.add(root);
  cullByDistance(f, root, 900);
}
