// 夜間照明: 自列車の前照灯、駅ホーム照明（点光源少数 + 偽の光だまり）、沿線の街灯
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { getTerrain } from '../world/terrain';
import { coastalThirdTracks } from '../world/coastal-stations';
import { hagoromoSpec } from '../world/hagoromo-branch';

export interface NightLights {
  /** lamps: 0..1 照明の点灯度, head: 0..1 前照灯 */
  update(lamps: number, head: number): void;
}

const LAMP_COLOR = new THREE.Color(0xfff1d6);
const PLAT_COLOR = new THREE.Color(0xeef6ff);

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.55)');
  gr.addColorStop(.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createNightLights(ctx: GameContext): NightLights {
  const { scene, track, route } = ctx;
  const glow = glowTexture();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  /** g 指定時は地面の絶対高さ基準、無ければ線路（ホーム）基準 */
  const place = (s: number, lat: number, y: number, g?: number) => {
    const p = track.at(s, lat, y);
    if (g != null) p.y = g + y;
    return p;
  };

  // 前照灯
  const head = new THREE.SpotLight(0xfff2d8, 0, 320, .3, .5, 1);
  head.name = 'env-headlight';
  scene.add(head, head.target);

  // 偽の光だまり（加算合成の円）
  const poolMat = new THREE.MeshBasicMaterial({
    map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true, color: 0x000000,
  });
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
  const pools: { s: number; lat: number; y: number; r: number; g?: number }[] = [];
  // 光源の芯（発光体）
  const bulbs: { s: number; lat: number; y: number; w: number; d: number; g?: number }[] = [];
  const glows: { s: number; g: number }[] = [];
  // 点光源は2灯だけ用意し、列車に最も近い駅へ移動させる（光源数を固定してシェーダ再生成と負荷を抑える）
  const platLights = [0, 1].map(() => { const pl = new THREE.PointLight(PLAT_COLOR, 0, 30, 1.5); scene.add(pl); return pl; });
  const platSpots: { sc: number; pos: THREE.Vector3[] }[] = [];

  // 駅ホーム: 屋根下に蛍光灯列、光源は駅ごとに2灯
  // 2面4線駅はホームが待避線側（lat0 だけずれる）で、対向側の外にもホーム
  for (const sta of route.stations) {
    const s0 = sta.platform.from, s1 = sta.platform.to, len = s1 - s0;
    const L1 = Math.max(...route.tracks), lp = sta.loop?.lat ?? 0;
    // [蛍光灯の横位置, 照らす床の横位置[]]。島式ホームは中央に蛍光灯、床は両側
    const L0 = Math.min(...route.tracks), mid = (L0 + L1) / 2;
    const hg = sta.layout === 'hagoromo' ? hagoromoSpec(route) : null;
    const sides: [number, number[], number?][] = sta.layout === 'custom'
      // 独自配置のホーム: 島式は中央、片面は線路から 4.2m
      ? (sta.customPlatforms ?? []).map((p): [number, number[], number?] => p.kind === 'island'
        ? [p.lat, [p.lat - 1.5, p.lat + 1.5], ((p.from ?? s0) + (p.to ?? s1)) / 2 - (s0 + s1) / 2]
        : [p.lat + (p.side === 'L' ? -4.2 : 4.2), [p.lat + (p.side === 'L' ? -3.6 : 3.6)], ((p.from ?? s0) + (p.to ?? s1)) / 2 - (s0 + s1) / 2])
      : hg
      // 羽衣: 本線と3番線の間の島式ホームと、もう一方の本線の外の片面ホーム
      ? [[hg.island, [hg.island - 1.5, hg.island + 1.5]], [hg.mainOuter - hg.side * 4.1, [hg.mainOuter - hg.side * 3.6]]]
      : sta.layout === 'hamadera'
      // 浜寺公園: 泉大津方面の島式（本線と副線の間）と、堺方面の副線の外側の片面ホーム
      ? coastalThirdTracks(route, sta).map((t): [number, number[]] => {
        if (t.island) { const c = (t.main + t.outer) / 2; return [c, [c - 1.5, c + 1.5]]; }
        const c = t.outer + (t.outer < t.main ? -4.1 : 4.1); return [c, [c + (t.outer < t.main ? 0.5 : -0.5)]];
      })
      : sta.island
      ? [[mid, [mid - 1.5, mid + 1.5]]] // 島式1面2線: 線間の島式ホーム1本
      : sta.loop
      ? [[lp / 2, [lp / 2 - 1.5, lp / 2 + 1.5]], [L1 - lp / 2, [L1 - lp / 2 - 1.5, L1 - lp / 2 + 1.5]]]
      : [[-4.2, [-3.6]], [L1 + 4.2, [L1 + 3.6], sta.platformOpp]]; // 相対式: 両側（対向側は踏切を挟んでずれることがある）
    const rl = len * .6, sc = (s0 + s1) / 2;
    sides.forEach(([lat, floors, shift], k) => {
      for (let z = -rl / 2 + 3; z <= rl / 2 - 3; z += 8) {
        if (!sta.indoor) bulbs.push({ s: sc + (shift ?? 0) + z, lat, y: 4.1, w: .18, d: 1.6 }); // 屋内式は大屋根の蛍光灯（world/indoor-station.ts）
        for (const f of floors) pools.push({ s: sc + (shift ?? 0) + z, lat: f, y: 1.13, r: 7 });
      }
      if (k === 0) platSpots.push({ sc, pos: [-.22, .22].map(q => track.at(sc + rl * q, lat, 3.9)) });
    });
  }
  // 沿線の街灯（左側の地上区間のみ。ホーム・トンネル・高架・橋梁・踏切・築堤は除く）。y は地面基準の絶対高さ
  const T = getTerrain(ctx);
  const posts: { s: number; lat: number; g: number }[] = [];
  const inPlatform = (s: number) => T.nearStation(s, 15); // 待避線駅は分岐器区間も除く
  for (let s = route.extent.from + 30; s < route.extent.to; s += 75) {
    if (inPlatform(s) || T.structureAt(s, 30) || T.nearCrossing(s, 8)) continue;
    if (route.theme === 'mountain' && !T.isCity(s)) continue; // 山岳線: 街灯は町の中だけ
    const g = T.terrainY(s, -6.4);
    if (Math.abs(T.trackY(s) - g) > 1.5) continue;
    posts.push({ s, lat: -6.4, g });
    bulbs.push({ s, lat: -5.6, y: 6.0, w: .5, d: .3, g });
    pools.push({ s, lat: -4.6, y: .05, r: 13, g: T.terrainY(s, -4.6) });
    glows.push({ s, g });
  }

  // 街灯の支柱
  {
    const geo = new THREE.CylinderGeometry(.07, .09, 6.2, 6); geo.translate(0, 3.1, 0);
    const arm = new THREE.BoxGeometry(.9, .06, .06); arm.translate(.42, 6.1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8c9196 });
    const pm = new THREE.InstancedMesh(geo, mat, posts.length), am = new THREE.InstancedMesh(arm, mat, posts.length);
    posts.forEach((p, i) => {
      const t = track.trackAt(p.s); q.setFromEuler(e.set(0, -t.phi, 0));
      m4.compose(place(p.s, p.lat, 0, p.g), q, v.set(1, 1, 1));
      pm.setMatrixAt(i, m4); am.setMatrixAt(i, m4);
    });
    pm.name = 'env-lamp-posts'; scene.add(pm, am);
  }
  // 発光体
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x9a9a9a });
  const bulbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bulbMat, bulbs.length);
  bulbs.forEach((b, i) => {
    const t = track.trackAt(b.s); q.setFromEuler(e.set(0, -t.phi, 0));
    bulbMesh.setMatrixAt(i, m4.compose(place(b.s, b.lat, b.y, b.g), q, v.set(b.w, .06, b.d)));
  });
  bulbMesh.userData.noShadow = true; scene.add(bulbMesh);
  // 光だまり
  const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, pools.length);
  pools.forEach((p, i) => {
    const t = track.trackAt(p.s); q.setFromEuler(e.set(0, -t.phi, 0));
    poolMesh.setMatrixAt(i, m4.compose(place(p.s, p.lat, p.y, p.g), q, v.set(p.r, 1, p.r)));
  });
  poolMesh.renderOrder = 2; poolMesh.userData.noShadow = true; poolMesh.visible = false; scene.add(poolMesh);
  // 街灯のにじみ（スプライト）
  const gpos = new Float32Array(glows.length * 3);
  glows.forEach((p, i) => { place(p.s, -5.6, 5.9, p.g).toArray(gpos, i * 3); });
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
  const glowMat = new THREE.PointsMaterial({ map: glow, size: 5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x000000 });
  const glowPts = new THREE.Points(gg, glowMat); glowPts.visible = false; glowPts.userData.noShadow = true; scene.add(glowPts);

  const off = new THREE.Color(0x8a8f96), tmp = new THREE.Color();
  return {
    update(lamps, h) {
      const tr = ctx.state.train;
      head.intensity = 45 * h;
      head.position.copy(track.pathAt(tr.s + .5, 0, 1.6)); // 待避線では走行線に沿う
      head.target.position.copy(track.pathAt(tr.s + 70, 0, 0));
      head.target.updateMatrixWorld();
      let best = platSpots[0], bd = Infinity;
      for (const p of platSpots) { const d = Math.abs(p.sc - tr.s - 60); if (d < bd) { bd = d; best = p; } }
      platLights.forEach((pl, i) => { if (best) pl.position.copy(best.pos[i]); pl.intensity = best ? 14 * lamps : 0; });
      bulbMat.color.copy(tmp.copy(off).lerp(LAMP_COLOR, Math.min(1, lamps * 1.5)).multiplyScalar(1 + lamps * 1.5));
      poolMesh.visible = glowPts.visible = lamps > .02;
      poolMat.color.copy(LAMP_COLOR).multiplyScalar(.55 * lamps);
      glowMat.color.copy(LAMP_COLOR).multiplyScalar(.9 * lamps);
    },
  };
}
