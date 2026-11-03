// 西宮車庫（阪急神戸線、西宮北口の梅田寄りの北側）に留置中の2000系（描画のみ）。
// 留置線は route.extraTracks の 'nishinomiya-depot-*'（hankyu-kobe.ts の depotTracks。上りは reverseRoute が写した線）。
// 横位置が一定の区間（留置線の直線）に、8両編成を置く。線・本数はゲーム用（実際の運用ではない）。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { onLight } from './batch';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { bogieOffset, createTrainSet, setTrainNight } from './train-models';

export function buildHankyuDepotTrains(ctx: GameContext): void {
  if (ctx.route.lineId !== 'hankyu-kobe') return;
  const tracks = (ctx.route.extraTracks ?? []).filter(x => x.id.startsWith('nishinomiya-depot-'));
  if (!tracks.length) return;
  const a = new THREE.Vector3(), z = new THREE.Vector3();
  const group = new THREE.Group(); group.name = 'oncoming-nishinomiya-depot';
  const L = ctx.route.segments.reduce((q, g) => q + (g.type === 'straight' ? g.length : g.radius * g.angle), 0);
  tracks.forEach((tr, k) => {
    if (k % 3 !== 0) return; // 描画の負荷（1両ごとに数回の描画）のため、3本に1本だけ（4編成）
    // 横位置が一定の区間（留置線の直線）
    const p = tr.lat;
    let s0 = NaN, s1 = NaN, lat = 0;
    for (let i = 0; i + 1 < p.length; i++) if (Math.abs(p[i][1] - p[i + 1][1]) < .01 && p[i + 1][0] - p[i][0] > 170) { s0 = p[i][0]; s1 = p[i + 1][0]; lat = p[i][1]; break; }
    if (!Number.isFinite(s0)) return;
    s0 = Math.max(s0, 5); s1 = Math.min(s1, L - 5);
    const len = 8 * 19 + 8, n = Math.min(1, Math.floor((s1 - s0) / len));
    for (let j = 0; j < n; j++) {
      const cars = createTrainSet('hankyu-2000', 8, ctx.renderer, { dest: '', label: '回送', units: [8] });
      let cur = s1 - 8 - j * len;
      for (const c of cars) {
        const sc = cur - c.length / 2, bog = bogieOffset(c.length);
        a.copy(ctx.track.at(sc + bog, lat, .38)); z.copy(ctx.track.at(sc - bog, lat, .38));
        placeCar(c.object, a, z); group.add(c.object);
        c.setDoors(false);
        cur -= c.length;
      }
    }
  });
  onLight(ctx, (night, tunnel) => setTrainNight(Math.max(night, tunnel)));
  ctx.scene.add(group); cullByDistance(ctx, group, 900);
}
