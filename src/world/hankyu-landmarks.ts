// 阪急神戸線の沿線の目印（描画だけ）。形は概形で、実在建物の看板・ロゴ・細部は写さない。
// 位置は OSM（© OpenStreetMap contributors、ODbL）の施設の位置をコースの座標へ写したもの（scripts/route-geometry.ts の landmarks、
// scripts/osm-scenery.ts の landmarks）。OSM で位置が取れなかったもの（梅田スカイビル・阪急百貨店のタワー）は周辺の OSM の点からの推定で、「推定」と書く。
// 高さは公開資料のおおよその値（梅田スカイビル 173m、グランフロント大阪 北館 約174m・南館 約179m、大阪梅田ツインタワーズ・ノース 約187m、
// HEP FIVE の観覧車 頂上 約106m・直径 約75m、神戸三宮阪急ビル 約120m、ANAクラウンプラザホテル神戸 約163m）。
// 座標は下り（大阪梅田 → 神戸三宮）の向きで、s = そのコースの距離、lat = 横位置（右が正）。上り（'-up'）では s・lat を反転する。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { GeoBatch, P, M, onLight } from './batch';
import { cullByDistance } from './cull';
import { getTerrain } from './terrain';

type Item =
  | { kind: 'tower'; s: number; lat: number; w: number; d: number; h: number; color: number; band?: number; y0?: number; legs?: [number, number] }
  | { kind: 'wheel'; s: number; lat: number; base: number; r: number; color: number; baseW?: number; baseColor?: number }
  | { kind: 'sky'; s: number; lat: number }
  | { kind: 'trees'; s: number; lat0: number; lat1: number; gap: number };

const ITEMS: Record<string, Item[]> = {
  'hankyu-kobe-east': [
    // HEP FIVE（OSM: s -127・lat 70）。商業ビルの屋上に赤い観覧車
    { kind: 'wheel', s: -127, lat: 70, base: 34, r: 37, color: 0xd8262c, baseW: 70, baseColor: 0xd9d2c4 },
    // 大阪梅田ツインタワーズ・ノース（阪急百貨店）。駅の南。位置は推定
    { kind: 'tower', s: -300, lat: 60, w: 60, d: 55, h: 187, color: 0x9aa6b0, band: 0x6c7a86 },
    // グランフロント大阪（OSM: 南 s 216〜224・lat -414〜-430、北 s 793〜824・lat -330〜-356）
    { kind: 'tower', s: 215, lat: -420, w: 55, d: 45, h: 179, color: 0x8fa2b4, band: 0x5d7488 },
    { kind: 'tower', s: 300, lat: -370, w: 45, d: 40, h: 154, color: 0x9cb0c0, band: 0x5d7488 },
    { kind: 'tower', s: 810, lat: -345, w: 50, d: 45, h: 174, color: 0x8fa2b4, band: 0x5d7488 },
    // 梅田スカイビル（2棟を最上部の空中庭園でつなぐ）。OSM の駐車場（s 1099・lat -418）の西。位置は推定
    { kind: 'sky', s: 1110, lat: -560 },
  ],
  'hankyu-kobe-west': [
    // 夙川（s 約3177）・芦屋川（s 約5864）の堤の桜と松。川は線路と直角として並べる（実際の角度は概形）
    { kind: 'trees', s: 3177, lat0: -320, lat1: 320, gap: 9 },
    { kind: 'trees', s: 5864, lat0: -320, lat1: 320, gap: 9 },
    // 王子動物園（OSM: s 14282・lat 102）の観覧車
    { kind: 'wheel', s: 14250, lat: 150, base: 2, r: 12, color: 0x3a7cc4 },
    // ANAクラウンプラザホテル神戸（新神戸。OSM の新神戸駅前から s 16040・lat 860）
    { kind: 'tower', s: 16040, lat: 860, w: 40, d: 32, h: 163, color: 0xc9c3b6, band: 0x8a8478 },
    // 神戸三宮阪急ビル: 線路の上に建つ（ホームの上、地上約14m から上が建物）。神戸三宮の停止位置の手前
    { kind: 'tower', s: 17130, lat: 8, w: 90, d: 34, h: 120, y0: 15, color: 0xb9b2a4, band: 0x7c7466, legs: [-7.5, 18] },
  ],
};

export function buildHankyuLandmarks(ctx: GameContext): void {
  const route = ctx.route;
  if (route.lineId !== 'hankyu-kobe') return;
  const up = route.id.endsWith('-up'), items = ITEMS[route.id.replace(/-up$/, '')] ?? [];
  if (!items.length) return;
  const L = route.segments.reduce((a, g) => a + (g.type === 'straight' ? g.length : g.radius * g.angle), 0);
  const T = getTerrain(ctx), tr = ctx.track;
  const S = (s: number) => up ? L - s : s, Lt = (lat: number) => up ? 4 - lat : lat;
  const b = new GeoBatch(), lit = new GeoBatch(), group = new THREE.Group();
  /** 線路の範囲外（梅田の駅ビルの南など）は端の向きのまま延ばした位置 */
  const ext = (s: number, lat: number) => {
    const ss = S(s), sc = Math.max(0, Math.min(L, ss)), p = tr.at(sc, Lt(lat), 0);
    if (ss !== sc) {
      const d = tr.at(Math.min(L, sc + 1), Lt(lat), 0).sub(tr.at(Math.max(0, sc - 1), Lt(lat), 0)).normalize();
      p.addScaledVector(d, ss - sc);
    }
    return { p, sc };
  };
  /** 下りの座標 (s, lat) の地面の点 */
  const at = (s: number, lat: number, y = 0) => {
    const { p, sc } = ext(s, lat);
    p.y = T.groundY(sc) + T.reliefY(sc, Lt(lat)) + y;
    return p;
  };
  const Z = new THREE.Vector3(0, 0, 1), q = new THREE.Quaternion(), sc = new THREE.Vector3(), mx = new THREE.Matrix4();
  /** p → q の角材（太さ t） */
  const beam = (p: THREE.Vector3, r: THREE.Vector3, t: number, col: number) => {
    const d = r.clone().sub(p), len = d.length();
    q.setFromUnitVectors(Z, d.normalize());
    b.add('m', P.box, mx.compose(p.clone().add(r).multiplyScalar(.5), q, sc.set(t, t, len + t * .5)), col);
  };
  const yaw = (s: number) => -tr.trackAt(Math.max(0, Math.min(L, S(s)))).phi;
  for (const it of items) {
    if (it.kind === 'tower') {
      const p = at(it.s, it.lat), ry = yaw(it.s), y0 = it.y0 ?? 0;
      const base = it.y0 ? ext(it.s, it.lat).p.y + y0 : p.y;
      b.add('m', P.boxB, M(p.x, base, p.z, ry, it.d, it.h - y0, it.w), it.color);
      // 窓の帯（数階ごとの横帯）。夜は窓明かり
      for (let y = 6; y < it.h - y0 - 4; y += 4.2) {
        lit.add('lit', P.boxB, M(p.x, base + y, p.z, ry, it.d + .3, 1.3, it.w + .3), it.band ?? 0x6c7a86);
      }
      b.add('m', P.boxB, M(p.x, base + it.h - y0, p.z, ry, it.d * .6, 6, it.w * .5), 0x8c8f92); // 屋上の機械室
      if (it.legs) for (const lg of it.legs) for (const ds of [-it.w / 2 + 3, 0, it.w / 2 - 3]) {
        const q = ext(it.s + ds, lg).p;
        b.add('m', P.boxB, M(q.x, q.y - 1, q.z, ry, 1.2, y0 + 1, 1.2), 0x9d968a);
      }
    } else if (it.kind === 'wheel') {
      const c = at(it.s, it.lat), ry = yaw(it.s);
      if (it.baseW) b.add('m', P.boxB, M(c.x, c.y, c.z, ry, it.baseW, it.base, it.baseW), it.baseColor ?? 0xd0c8ba);
      const cy = c.y + it.base + it.r + 2;
      // 輪の面は線路に直角（運転台から正面に輪が見える）。局所 x = 線路の横方向
      const ax = Math.cos(ry), az = -Math.sin(ry), N = 40;
      const pt = (a: number, r: number) => new THREE.Vector3(c.x + ax * Math.cos(a) * r, cy + Math.sin(a) * r, c.z + az * Math.cos(a) * r);
      const t = Math.max(.5, it.r * .025);
      for (let k = 0; k < N; k++) {
        const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2;
        beam(pt(a0, it.r), pt(a1, it.r), t, it.color);
        beam(pt(a0, it.r * .93), pt(a1, it.r * .93), t * .6, it.color);
        if (k % 2 === 0) {
          beam(pt(a0, 0), pt(a0, it.r), t * .4, 0xe8e4dc); // スポーク
          const g = pt(a0, it.r), gs = Math.max(1.4, it.r * .07);
          b.add('m', P.box, M(g.x, g.y - gs, g.z, ry, gs * 1.4, gs * 1.5, gs * 1.4), k % 4 ? 0xf2f0ea : it.color); // ゴンドラ
        }
      }
      // 支柱（A 字）
      for (const sd of [-1, 1]) beam(new THREE.Vector3(c.x + ax * sd * it.r * .55, c.y + it.base, c.z + az * sd * it.r * .55), new THREE.Vector3(c.x, cy, c.z), t * 1.6, 0xb8b4ac);
    } else if (it.kind === 'sky') {
      // 梅田スカイビル: 2棟（各 約40×40m、間隔 約54m）を最上部（約150〜173m）の空中庭園でつなぐ。外壁はガラスの銀色
      const ry = yaw(it.s), p0 = at(it.s, it.lat - 27), p1 = at(it.s, it.lat + 27), H = 173;
      for (const p of [p0, p1]) {
        b.add('m', P.boxB, M(p.x, p.y, p.z, ry, 40, H, 40), 0xb7c3cc);
        for (let y = 8; y < H - 4; y += 4) lit.add('lit', P.boxB, M(p.x, p.y + y, p.z, ry, 40.3, 1.4, 40.3), 0x7f8f9c);
      }
      const m = p0.clone().add(p1).multiplyScalar(.5);
      b.add('m', P.boxB, M(m.x, m.y + H - 12, m.z, ry, 54, 12, 94), 0xa9b5be); // 空中庭園の連結部
      b.add('m', P.cyl, M(m.x, m.y + H - 6, m.z, 0, 46, 13, 46), 0x8e9aa4); // 円形の吹き抜け
      b.add('m', P.box, M(m.x, m.y + 40, m.z, ry, 6, 3, 54), 0x9aa6b0); // 中層の渡り廊下
    } else {
      // 堤の桜（春の色ではなく、通年で見分けやすい淡い色）と松
      const ry = yaw(it.s);
      for (const bank of [-14, 14]) for (let lat = it.lat0; lat <= it.lat1; lat += it.gap) {
        if (Math.abs(lat - 2) < 16) continue;
        const sk = it.s + bank + ((lat * 7.3) % 3), p = at(sk, lat), pine = Math.abs(Math.round(lat / it.gap)) % 3 === 0;
        const h = pine ? 7 : 5, r = pine ? 2.6 : 3.4;
        b.add('m', P.boxB, M(p.x, p.y, p.z, ry, .4, h, .4), 0x5b4636);
        b.add('m', pine ? P.cone4 : P.sphere, M(p.x, p.y + h - (pine ? 1 : 0), p.z, ry, r * 2, pine ? 4.5 : r * 1.6, r * 2), pine ? 0x3f6b3a : 0xe9b9c6);
      }
    }
  }
  const litMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x6c7480 });
  b.build({ m: new THREE.MeshLambertMaterial({ vertexColors: true }) }, group);
  lit.build({ lit: litMat }, group);
  const day = new THREE.Color(0x6c7480), night = new THREE.Color(0xfff1c8);
  onLight(ctx, f => { litMat.color.copy(day).lerp(night, f); });
  group.name = 'hankyu-landmarks';
  ctx.scene.add(group);
  cullByDistance(ctx, group, 6000);
}
