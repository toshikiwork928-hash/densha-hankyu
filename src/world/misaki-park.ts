// みさき公園駅（南海本線・盛土上の島式2面5線）の駅舎・地下道の口・ホームの階段/エスカレーター/エレベーター。5番線に停まっている 7100系は misaki-park-train.ts。
// 線路・ホームの形は route/routes/misaki-park.ts（泉佐野〜みさき公園と みさき公園〜和歌山港で共通）。このモジュールは描画だけで、走行・当たり判定には関わらない。
// 資料は docs/south-scenery-research-1.md 4章: 改札は「みさき公園出口」側（西・遊園地跡側）と東出口の2か所、ホームと駅舎は地下道でつながり、エスカレーターと橋上のエレベーターがある。
// 建物の大きさ・形・色、地下道の位置、エレベーターの位置は資料に無く、ゲーム用の概形。橋上の通路（跨線橋）は描かない（不明）。
import * as THREE from 'three';
import { FONT } from '../core/config';
import { createRng } from '../core/rng';
import type { GameContext } from '../core/context';
import type { Station } from '../route/types';
import { profileLat, trackLines } from '../route/service';
import { GeoBatch, M, P, onLight } from './batch';
import { canvasTex } from './canvas-tex';
import { cullByDistance } from './cull';
import { person } from './stations';
import { getTerrain } from './terrain';

export const isMisakiPark = (sta: Station): boolean => sta.name === 'みさき公園' && sta.layout === 'custom';

/** 駅の位置関係（このコースの座標）: 線路の左右の端、西（海・5番線の側）が右か左か */
export function layout(ctx: GameContext, sc: number) {
  const { route } = ctx;
  const lats = trackLines(route).filter(l => sc >= l.from && sc <= l.to).map(l => l.lat(sc));
  const lo = Math.min(...lats), hi = Math.max(...lats);
  const t5 = route.extraTracks?.find(x => x.id === 'misaki-t5');
  const west: 1 | -1 = t5 && profileLat(t5.lat, sc) > (lo + hi) / 2 ? 1 : -1;
  return { lo, hi, west, t5Lat: t5 ? profileLat(t5.lat, sc) : hi };
}

/** 駅舎2か所・広場・地下道の口・ホームの階段/エスカレーター/エレベーター */
export function buildMisakiParkStation(ctx: GameContext, sta: Station): void {
  const { track } = ctx, T = getTerrain(ctx);
  const sc = (sta.platform.from + sta.platform.to) / 2;
  const { lo, hi, west } = layout(ctx, sc);
  const dy = T.groundY(sc) - T.trackY(sc); // 線路面から地面までの高さ（負。盛土の高さ。みさき公園〜和歌山港は地面が線路に沿うので 0）
  const t = track.trackAt(sc);
  const grp = new THREE.Group(); grp.name = 'misaki-park-station';
  grp.position.copy(track.at(sc, 0, 0)); grp.rotation.y = -t.phi; ctx.scene.add(grp);
  const b = new GeoBatch(), rnd = createRng(9301);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: number) => b.add('body', P.box, M(x, y, z, 0, w, h, d), col);
  const boxB = (x: number, y: number, z: number, w: number, h: number, d: number, col: number) => b.add('body', P.boxB, M(x, y, z, 0, w, h, d), col);

  // --- ホームの地下道の口（階段2本とエスカレーター）とエレベーター。島式ホームごと（ホーム面は線路面 + 1.1m）
  const islands = (sta.customPlatforms ?? []).filter(p => p.kind === 'island').map(p => ({ lat: p.lat, w: p.width }));
  for (const isl of islands) {
    const x = isl.lat, top = 1.1;
    // 階段（幅 1.8m・長さ 6m）とエスカレーター（幅 1.4m・長さ 8m）の開口。黒い面と手すり
    for (const [dz, w, l, rail] of [[-34, 1.8, 6, 0x9aa0a6], [-24, 1.4, 8, 0x3a3f45], [26, 1.8, 6, 0x9aa0a6]] as const) {
      box(x, top + .012, dz, w, .02, l, 0x15181c);
      for (const sx of [-1, 1]) box(x + sx * (w / 2 + .12), top + .5, dz, .06, 1.0, l + .4, rail);
      for (const sz of [-1, 1]) box(x, top + .5, dz + sz * (l / 2 + .2), w + .5, 1.0, .06, rail);
    }
    // エレベーター（ガラス張りの昇降路）
    const ez = 8;
    boxB(x, top, ez, 2.4, 3.2, 2.4, 0xcfd4d6);
    box(x, top + 1.8, ez, 2.46, 2.0, 2.46, 0x3a5a6e);
    box(x, top + 3.3, ez, 2.9, .2, 2.9, 0x6b7680);
  }

  // --- 駅舎2か所（地上。盛土の外側の足元に立つ）と広場
  const slope = dy < -.5 ? 2.5 + 1.6 * -dy + .5 : 3.5;
  const gy = dy;
  const building = (s: -1 | 1, outer: number, bd: number, bw: number, h: number, wall: number, roof: number, name: string) => {
    const near = outer + s * slope, cx = near + s * bd / 2, far = near + s * bd;
    boxB(cx, gy, 0, bd, h, bw, wall);
    boxB(cx, gy + h, 0, bd + .8, .5, bw + .8, roof);
    // 出入口のガラスと庇、上階の窓（外側の面）
    box(far + s * .03, gy + 2.0, 0, .06, 3.2, 9, 0x2b343d);
    box(far + s * 1.5, gy + 4.0, 0, 3.0, .15, 12, 0x8a9096);
    for (let z = -bw / 2 + 3; z < bw / 2 - 2; z += 3.4) if (Math.abs(z) > 5.6) box(far + s * .03, gy + h * .68, z, .06, 1.5, 2.2, 0x2b343d);
    // 広場の舗装と人
    b.add('body', P.plane, M(far + s * 14, gy + .04, 0, 0, 28, bw * 1.5, 1, -Math.PI / 2), 0x6a6c70);
    b.parent = new THREE.Matrix4().makeTranslation(0, gy, 0);
    for (let k = 0; k < 8; k++) person(b, rnd, far + s * (3 + rnd() * 14), (rnd() - .5) * bw * 1.2, rnd() * 6);
    b.parent = null;
    return { far, name, s, h };
  };
  // 西側（5番線・多奈川線の側）がみさき公園出口（遊園地跡の側）、東側が東出口
  const W = building(west, west > 0 ? hi : lo, 14, 36, 8, 0xe8e4da, 0x6b7680, 'みさき公園駅');
  const E = building(-west as -1 | 1, west > 0 ? lo : hi, 10, 24, 6.5, 0xdcd8cc, 0x6b7680, 'みさき公園駅 東出口');
  b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, grp);

  // 看板
  const mats: THREE.MeshLambertMaterial[] = [];
  for (const q of [W, E]) {
    const tex = canvasTex(1024, 192, (g, w, h) => {
      g.fillStyle = '#1d2a5a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = `800 ${q.name.length > 6 ? 96 : 120}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(q.name, w / 2, h / 2 + 6);
    });
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .05 });
    mats.push(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), mat);
    m.position.set(q.far + q.s * .08, gy + q.h - 1.4, 0); m.rotation.y = q.s * Math.PI / 2; grp.add(m);
  }
  onLight(ctx, f => { for (const m of mats) m.emissiveIntensity = .05 + f * .75; });
  cullByDistance(ctx, grp, 900);
}
