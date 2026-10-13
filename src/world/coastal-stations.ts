import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Route, Station } from '../route/types';
import { GeoBatch, M, P, onLight } from './batch';
import { canvasTex } from './canvas-tex';
import { cullByDistance } from './cull';
import { getTerrain } from './terrain';
import { loopShape, loopZone } from '../route/service';
import { BUMPER_D, DIVERGE_D, hagoromoSpec } from './hagoromo-branch';
import { addPlatformWall, architectureOf } from './station-architecture';

/** 浜寺公園の物理的な副線（両方向で同じ2本）。泉大津方面は島式ホームを挟む外側線、堺方面は本線の外側に寄り添う待避線でホームはその外側。 */
export interface CoastalThird {
  main: number; outer: number; from: number; to: number; lat(s: number): number;
  /** 外側（outer の向き）に張り出すホーム・架線柱までの距離（線路中心から） */
  reach: number;
  /** true = 泉大津方面（本線との間が島式ホーム）、false = 堺方面（ホームは待避線の外側） */
  island: boolean;
  /** 羽衣の3番線: 本線と同じ架線を張る（catenary.ts）。車止め側の端が from か */
  wire?: { bumperAtFrom: boolean };
}
/** 泉大津方面副線の本線からの距離（島式ホームを挟む） */
export const IZUMI_SIDING_LAT = 9.2;
/** 堺方面待避線の本線からの距離（本線の隣、ホームは外側） */
export const SAKAI_SIDING_LAT = 4;
const TURNOUT = 90;

/** 浜寺公園の副線。route の走行側（先頭が通る側）の副線は loopZone と同じ余白（入口10m、出口70m）、反対側は鏡像（入口70m、出口10m）で、
 *  どちらの向きから見ても同じ物理配置になる。床版・架線・検査・描画で共有する。 */
export function coastalThirdTracks(route: Route, sta: Station): CoastalThird[] {
  if (sta.layout === 'hagoromo') {
    // 羽衣の3番線の並行区間（車止め 〜 本線から離れ始める点）。先の離れていく部分は coastal-landmarks.ts の支線が描く。
    const h = hagoromoSpec(route);
    if (!h) return [];
    const a = h.sOf(BUMPER_D), b = h.sOf(DIVERGE_D + 10), from = Math.min(a, b), to = Math.max(a, b);
    return [{ main: h.mainIsland, outer: h.t3, from, to, lat: s => s >= from && s <= to ? h.t3 : h.mainIsland, reach: 2.9, island: true, wire: { bumperAtFrom: a < b } }];
  }
  if (sta.layout !== 'hamadera') return [];
  const reverse = route.id.endsWith('-up'), lo = Math.min(...route.tracks), hi = Math.max(...route.tracks);
  const zone = (own: boolean) => own ? loopZone({ ...sta, loop: { lat: 0, turnoutLength: TURNOUT, turnoutLimitKmh: 45 } })! : {
    inFrom: sta.platform.from - 70 - TURNOUT, inTo: sta.platform.from - 70,
    outFrom: sta.platform.to + 10, outTo: sta.platform.to + 10 + TURNOUT, lat: 0, limit: 45,
  };
  const make = (main: number, outer: number, own: boolean, island: boolean, reach: number): CoastalThird => {
    const z = zone(own);
    return { main, outer, from: z.inFrom, to: z.outTo, lat: s => main + (outer - main) * loopShape(z, s), reach, island };
  };
  // 下り（堺方面）で自線は lo、上りで自線は lo（進行方向左）。物理配置は両方向で鏡像。
  const izumiMain = reverse ? lo : hi, sakaiMain = reverse ? hi : lo;
  return [
    make(izumiMain, izumiMain + (reverse ? -IZUMI_SIDING_LAT : IZUMI_SIDING_LAT), reverse, true, 2.9),
    make(sakaiMain, sakaiMain + (reverse ? SAKAI_SIDING_LAT : -SAKAI_SIDING_LAT), !reverse, false, 7.4),
  ];
}

/** 高架島式駅の地上改札・駅床・ホーム支持。寸法は実測ではなく構内形式の近似。 */
export function buildElevatedConcourse(ctx: GameContext, sta: Station, centers: number[], outside: number, opt: { /** ホーム背面のスクリーンを作らない（線路が床版の縁に近い駅） */ noScreen?: boolean } = {}): void {
  const sc = (sta.platform.from + sta.platform.to) / 2, len = sta.platform.to - sta.platform.from;
  const dy = getTerrain(ctx).groundY(sc) - ctx.track.trackAt(sc).y;
  const group = new THREE.Group(); group.position.copy(ctx.track.at(sc, 0, 0)); group.rotation.y = -ctx.track.trackAt(sc).phi;
  const batch = new GeoBatch();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number) => batch.add('body', P.box, M(x, y, z, 0, w, h, d), color);
  const left = outside - 3.3, right = 4 - outside + 3.3, width = right - left;
  box((left + right) / 2, -.55, 0, width, .8, len, 0xb9b9b3);
  for (let z = -len / 2 + 8; z < len / 2; z += 18) for (const x of centers) {
    box(x, dy / 2 - .3, z, 1.1, -dy - .6, 1.1, 0xb0b3ae);
  }
  // 高架下コンコース。線路上を横切る跨線橋ではなく地上でホーム階段をつなぐ。
  box(2, dy + 3, 0, width, 6, 35, 0xe2e2dc);
  for (const x of [left - .02, right + .02]) {
    box(x, dy + 2.5, 0, .04, 3.5, 16, 0x405764);
    box(x, dy + 4.6, 0, 3, .18, 20, 0x64727a);
  }
  for (const x of centers) box(x, dy / 2, len * .18, 2.6, -dy + 1, 10, 0xd5d8d2);
  // ホーム背面の高架駅スクリーン。屋根を覆い尽くさず列車の顔が見える高さ。
  const arch = architectureOf(sta.name);
  if (sta.layout === 'hagoromo' && arch?.kind === 'platform-wall') {
    // 高師浜線の外周壁。片面ホーム背面の壁はbuildStationが描く。
    // 島式ホームの端に壁を置くと3番線への乗降口を塞ぐため、線路の外へ置く。
    const h = hagoromoSpec(ctx.route);
    if (h) addPlatformWall(batch, h.t3 + h.side * 3.2, len * arch.roofRatio, arch);
  }
  if (!opt.noScreen && arch?.kind !== 'platform-wall' && arch?.kind !== 'hall') for (const x of [left + .2, right - .2]) {
    box(x, 2.4, 0, .12, 2.4, len * .85, 0xd2d6d5);
    for (let z = -len * .4; z < len * .4; z += 12) box(x, 3, z, .14, 1, 8, 0x9caeb5);
  }
  batch.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, group);
  const texture = canvasTex(768, 128, (g, w, h) => {
    g.fillStyle = '#164f67'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 76px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sta.name + '駅', w / 2, h / 2);
  });
  const material = new THREE.MeshLambertMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: .05 });
  for (const [x, rotation] of [[left - .12, -Math.PI / 2], [right + .12, Math.PI / 2]]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), material); sign.position.set(x, dy + 5.2, 0); sign.rotation.y = rotation; group.add(sign);
  }
  onLight(ctx, f => material.emissiveIntensity = .05 + f * .75);
  ctx.scene.add(group); cullByDistance(ctx, group, 1200);
}

/** 浜寺モチーフ: 地上の旧駅舎を保存した木造洋風の意匠。画像素材は使わない。 */
export function buildHeritageFacade(ctx: GameContext, sta: Station): void {
  const sc = (sta.platform.from + sta.platform.to) / 2;
  const reverse = ctx.route.id.endsWith('-up');
  const group = new THREE.Group(); group.position.copy(ctx.track.at(sc, reverse ? 30 : -26, 0)); group.rotation.y = -ctx.track.trackAt(sc).phi + (reverse ? Math.PI : 0);
  const b = new GeoBatch();
  b.add('body', P.boxB, M(0, 0, 0, 0, 8, 4.5, 26), 0xefe5cc);
  b.add('body', P.gable, M(0, 4.5, 0, 0, 10, 2.6, 29), 0x655548);
  b.add('body', P.gable, M(-4.5, 3.2, 0, Math.PI / 2, 9, 2.8, 8), 0x655548);
  for (let z = -10; z <= 10; z += 4) {
    b.add('body', P.box, M(-4.02, 2.1, z, 0, .06, 2.2, 2.2), 0x53747a);
    b.add('body', P.box, M(-4.06, 2.1, z, 0, .08, 2.3, .12), 0xefe8da);
    b.add('body', P.box, M(-4.1, 2.1, z, 0, .1, .12, 2.3), 0xefe8da);
  }
  for (const z of [-4, 4]) b.add('body', P.box, M(-7.2, 1.6, z, 0, .2, 3.2, .2), 0xeee3cd);
  b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, group);
  ctx.scene.add(group); cullByDistance(ctx, group, 1000);
}

/** 海浜公園の第3線。第3線は桜ヶ丘方面の普通の待避にも使う。 */
export function buildCoastalSpecialStations(ctx: GameContext, sta: Station): void {
  if (sta.layout !== 'hamadera') return;
  const sc = (sta.platform.from + sta.platform.to) / 2;
  const group = new THREE.Group(), b = new GeoBatch();
  group.name = `coastal-special-station-${sta.name}`;
  group.position.copy(ctx.track.at(sc, 0, 0)); group.rotation.y = -ctx.track.trackAt(sc).phi;
  {
    const point = (s: number, lat: number, y: number) => ctx.track.at(s, lat, y);
    // 本線→副線→本線。泉大津方面は島式の外縁、堺方面は本線の隣に副線のレールを追加する。
    const wb = new GeoBatch();
    const strip = (a: THREE.Vector3, z: THREE.Vector3, width: number, height: number, color: number) => {
      const d = z.clone().sub(a), p = a.clone().add(z).multiplyScalar(.5);
      // 勾配上も棒の長軸を両端に合わせる。水平な箱だとレール端が線路基準から浮く。
      wb.add('body', P.box, M(p.x, p.y, p.z, Math.atan2(d.x, d.z), width, height, d.length() + .025, -Math.asin(d.y / d.length())), color);
    };
    for (const third of coastalThirdTracks(ctx.route, sta)) {
      const { main, outer, lat: position } = third;
      for (let s = third.from; s < third.to; s += 4) {
        const z = Math.min(third.to, s + 4), la = position(s), lb = position(z);
        strip(point(s, la, .06), point(z, lb, .06), 2.7, .28, 0x827e72);
        for (const rail of [-.5335, .5335]) strip(point(s, la + rail, .323), point(z, lb + rail, .323), .065, .12, 0x99a5a3);
        for (let q = s; q < z; q += 1) strip(point(q, position(q) - 1, .19), point(q, position(q) + 1, .19), .14, .12, 0x5b554a);
      }
      const outerSide = outer < main ? -1 : 1;
      // 堺方面の副線は外側にホームがあり、柱はホームの外（reach）。泉大津方面は副線の外 2.5m。
      const poleOffset = third.island ? 2.5 : third.reach - .6;
      for (let s = third.from + 5; s < third.to; s += 25) {
        const lat = position(s), t = ctx.track.trackAt(s), p = point(s, lat + outerSide * poleOffset, 0);
        wb.add('body', P.boxB, M(p.x, p.y, p.z, -t.phi, .16, 6.9, .16), 0x8c9691);
        const arm = point(s, lat + outerSide * (poleOffset - .2) / 2, 6.4);
        wb.add('body', P.box, M(arm.x, arm.y, arm.z, -t.phi, poleOffset + .3, .12, .12), 0x8c9691);
        const end = Math.min(third.to, s + 25);
        strip(point(s, lat, 5.72), point(end, position(end), 5.72), .03, .03, 0x68716a);
      }
    }
    const trackGroup = new THREE.Group(); trackGroup.name = 'coastal-third-track';
    wb.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, trackGroup);
    ctx.scene.add(trackGroup); cullByDistance(ctx, trackGroup, 1000);
    // ホームは stations.ts で島式1面＋副線の外の片面1面として一度だけ作る。
  }
  b.build({ body: new THREE.MeshLambertMaterial({ vertexColors: true }) }, group);
  ctx.scene.add(group); cullByDistance(ctx, group, 1000);
}
