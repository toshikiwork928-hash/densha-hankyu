// みさき公園〜和歌山港の和歌山市駅の専用景観（world/wakayamashi.ts ほか）は下り（misaki-wakayamako）の座標で書いてある。
// 上り（misaki-wakayamako-up）では、下りの座標（s, 横位置）を上りの線形へ写す ctx を渡して、同じ物理位置に描く（namba-frame.ts と同じ考え方）。
//   s' = 全長 − s、lat' = 4 − lat（下りの対向線 4 が上りの自線 0）。進行方向・右向きも反転する
import type { GameContext } from '../core/context';
import type { Track } from '../route/track';
import { misakiWakayamako } from '../route/routes/misaki-wakayamako';
import { totalLength } from '../route/reverse';

/** 専用景観に渡す ctx（下りの座標）。みさき公園〜和歌山港以外は null */
export function mwFrame(ctx: GameContext): GameContext | null {
  if (ctx.route.id === 'misaki-wakayamako') return ctx;
  if (ctx.route.id !== 'misaki-wakayamako-up') return null;
  const L = totalLength(misakiWakayamako), C = 4, real = ctx.track;
  const track: Track = {
    trackAt(s) { const t = real.trackAt(L - s); return { ...t, x: t.x + t.rx * C, z: t.z + t.rz * C, phi: t.phi + Math.PI, rx: -t.rx, rz: -t.rz }; },
    at: (s, lat, y) => real.at(L - s, C - lat, y),
    gradeAt: s => -real.gradeAt(L - s),
    limitAt: s => real.limitAt(L - s),
    length: real.length,
    pathLat: s => C - real.pathLat(L - s),
    pathAt: (s, lat, y) => real.pathAt(L - s, -lat, y),
  };
  const train = new Proxy(ctx.state.train, { get: (t, k) => k === 's' ? L - t.s : Reflect.get(t, k) });
  const state = new Proxy(ctx.state, { get: (st, k) => k === 'train' ? train : Reflect.get(st, k) });
  return { ...ctx, route: misakiWakayamako, track, state };
}
