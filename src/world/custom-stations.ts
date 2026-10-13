// 独自配置の駅（Station.layout = 'custom'）: Station.customPlatforms の島式・片面ホームを並べる（複々線の駅・高野線と並ぶ駅）。
// external のホームは専用モジュール（難波のターミナルなど）が描く。駅舎は高架下の簡易な箱（最初の片面ホームの側、無ければ左）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Station } from '../route/types';
import { buildFootbridge, buildIsland, buildStation } from './stations';
import { GeoBatch, M, P } from './batch';
import { getTerrain } from './terrain';
import { trackSpan } from '../route/service';
import { addHallArchitecture, architectureOf, hallBounds } from './station-architecture';
import { buildMisakiParkStation, isMisakiPark } from './misaki-park';

export function buildCustomStation(ctx: GameContext, sta: Station, prev: string, next: string): void {
  const T = getTerrain(ctx), list = sta.customPlatforms ?? [];
  const sc = (sta.platform.from + sta.platform.to) / 2;
  const dy = sta.elevated ? T.groundY(sc) - T.trackY(sc) : 0;
  let main = true;
  for (const p of list) {
    if (p.external) continue;
    const st: Station = { ...sta, platform: { ...sta.platform, from: p.from ?? sta.platform.from, to: p.to ?? sta.platform.to } };
    if (p.kind === 'island') buildIsland(ctx, st, prev, next, p.lat, p.width, { stairs: p.stairs ?? true, roof: p.roof });
    else { buildStation(ctx, st, prev, next, { lat: p.lat, side: p.side, minimal: !main, elevatedDy: dy }); main = false; }
  }
  // 跨線橋（樽井）: 片面ホームと島式ホームの階段室と、線路の上を渡る通路
  if (sta.structure?.link === 'footbridge') {
    const lats = list.filter(p => !p.external).map(p => p.kind === 'island' ? p.lat : p.lat + (p.side === 'L' ? -4.1 : 4.1));
    if (lats.length > 1) buildFootbridge(ctx, sta, lats);
  }
  // みさき公園: 盛土の下の地下道・駅舎2か所・ホームの階段/エスカレーター/エレベーター（world/misaki-park.ts）
  if (isMisakiPark(sta)) { buildMisakiParkStation(ctx, sta); return; }
  const arch = architectureOf(sta.name);
  if (arch?.kind === 'hall') {
    const t = ctx.track.trackAt(sc), b = new GeoBatch();
    const grp = new THREE.Group(); grp.position.copy(ctx.track.at(sc, 0, 0)); grp.rotation.y = -t.phi; ctx.scene.add(grp);
    const hb = hallBounds(ctx.route, sta);
    addHallArchitecture(b, { ...hb, from: hb.from - sc, to: hb.to - sc }, arch, dy);
    grp.name = `station-hall-${sta.name}`;
    b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x454545, emissiveIntensity: .25 }) }, grp);
  }
  // 泉佐野の分割屋根の駅舎は東西の出入口と改札階を自前で持つので、下の簡易な箱は置かない（二重にしない）
  if (!sta.elevated || !main || list.every(p => p.external) || (arch?.kind === 'hall' && arch.style === 'split-roof')) return;
  // 片面ホームが無い（島式だけの）高架駅: 高架下の改札・駅舎（線路の範囲の左外）
  const [lo] = trackSpan(ctx.route, sc), t = ctx.track.trackAt(sc), b = new GeoBatch();
  const grp = new THREE.Group(); grp.position.copy(ctx.track.at(sc, 0, 0)); grp.rotation.y = -t.phi; ctx.scene.add(grp);
  b.add('body', P.boxB, M(lo - 9, dy, 0, 0, 12, 6, 40), 0xe2ded4);
  b.add('body', P.box, M(lo - 15.05, dy + 2, 0, 0, .1, 3, 10), 0x2b343d);
  b.add('body', P.box, M(lo - 9, dy + 6.2, 0, 0, 12.4, .4, 40.4), 0x6b7680);
  b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, grp);
}
