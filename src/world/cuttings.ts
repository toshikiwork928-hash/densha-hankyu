// 切土の擁壁（route.cuttings）: 線路の脇にコンクリートの壁と、その上の草の法面を作る。山あいの区間で、線路が周囲の地面より低い所。
// 壁は最も外側の線路から offset の位置に立て、s 方向に 3m ごとの継ぎ目と、水抜きの穴の列を描く（色の濃淡と小さな箱）。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { trackSpan } from '../route/service';
import { GeoBatch, M, P } from './batch';
import { cullByDistance } from './cull';
import { getTerrain, gridAlong } from './terrain';

// 擁壁の色は、照明で暗く見えるので明るめのコンクリート色にする（Lambert は法線が横を向くと昼でも暗い）
const WALL = new THREE.Color(0xe6e2d6), JOINT = new THREE.Color(0xb3ae9e), GRASS = new THREE.Color(0x6a9a4c);

export function buildCuttings(ctx: GameContext): void {
  const { scene, track, route } = ctx, list = route.cuttings ?? [];
  if (!list.length) return;
  const T = getTerrain(ctx);
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const bankMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  for (const c of list) {
    const off = c.offset ?? 6.5, h = c.height ?? 4.5;
    const latOf = (s: number) => { const [lo, hi] = trackSpan(route, s, 30); return c.side < 0 ? lo - off : hi + off; };
    const grp = new THREE.Group(); grp.name = `cutting-${c.from}`;
    // 壁面: 上端から下端の2列。端は s 方向 8m で壁の高さを 0 へ（壁の端が唐突に立たない）
    const hs = (s: number) => h * Math.min(1, Math.min(s - c.from, c.to - s) / 8 + .12);
    const base = (s: number) => Math.min(T.trackY(s), T.groundY(s)) - .3;
    // 壁面は 1.5m ごとに格子（継ぎ目の色）。s 方向 1.5m・縦 3 列で、継ぎ目の列だけ濃くする
    const wall = gridAlong(track, c.from, c.to, 1.5,
      s => { const y0 = base(s), y1 = T.trackY(s) + hs(s), l = latOf(s); return [[l, y0], [l, y0 + (y1 - y0) * .33], [l, y0 + (y1 - y0) * .66], [l, y1]]; }, wallMat,
      (s, j, out) => { const u = ((s % 3) + 3) % 3; out.copy(WALL).lerp(JOINT, (u < .75 ? .55 : 0) + (j === 1 || j === 2 ? .18 : 0)); });
    // 法面: 壁の上端から外側へ 10m、1:1.4 の上り勾配（草）
    const bank = gridAlong(track, c.from, c.to, 6,
      s => { const l = latOf(s), y = T.trackY(s) + hs(s), d = c.side < 0 ? -1 : 1; return [[l, y], [l + d * 3, y + .1], [l + d * 10, y + 5]]; }, bankMat,
      (s, j, out) => out.copy(GRASS).multiplyScalar(.85 + ((Math.floor(s / 6) * 7 + j * 3) % 5) * .05));
    grp.add(wall, bank);
    // 水抜きの穴（小さな暗い箱を 9m ごと・2段）
    const b = new GeoBatch();
    for (let s = c.from + 4; s < c.to - 4; s += 9) {
      const l = latOf(s), y0 = T.trackY(s), hh = hs(s);
      for (const yy of [.9, 2.3]) {
        if (yy > hh - .3) continue;
        const p = track.at(s, l + (c.side < 0 ? .08 : -.08), 0), t = track.trackAt(s);
        b.add('hole', P.box, M(p.x, y0 + yy, p.z, -t.phi, .5, .22, .22), 0x4a4944);
      }
    }
    b.build({ hole: new THREE.MeshLambertMaterial({ vertexColors: true }) }, grp);
    scene.add(grp);
    cullByDistance(ctx, grp, 900);
  }
}
