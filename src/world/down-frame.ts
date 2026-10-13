// 下りの座標で書いた専用景観（泉佐野〜みさき公園の空港線・JR・羽倉崎検車区）を、上りでも同じ物理位置に描くための写し。
// 下り（id）ではそのまま、上り（id + '-up'）では s' = 全長 − s、lat' = 線路の左右の和 − lat を写した ctx を返す。進行方向・右向きも反転する。
// world/namba-frame.ts と同じ考え方（そちらは路線データを堺〜なんば固定で渡す）。route は実際のコースのまま渡す（景観側は route.id だけを見る）。
import type { GameContext } from '../core/context';
import type { Track } from '../route/track';
import { totalLength } from '../route/reverse';

/** 専用景観に渡す ctx（下りの座標）。対象のコース以外は null */
export function downFrame(ctx: GameContext, id: string): GameContext | null {
  if (ctx.route.id === id) return ctx;
  if (ctx.route.id !== id + '-up') return null;
  const L = totalLength(ctx.route), C = Math.min(...ctx.route.tracks) + Math.max(...ctx.route.tracks), real = ctx.track;
  const track: Track = {
    trackAt(s) { const t = real.trackAt(L - s); return { ...t, x: t.x + t.rx * C, z: t.z + t.rz * C, phi: t.phi + Math.PI, rx: -t.rx, rz: -t.rz }; },
    at: (s, lat, y) => real.at(L - s, C - lat, y),
    gradeAt: s => -real.gradeAt(L - s),
    limitAt: s => real.limitAt(L - s),
    length: real.length,
    pathLat: s => C - real.pathLat(L - s),
    pathAt: (s, lat, y) => real.pathAt(L - s, -lat, y),
  };
  return { ...ctx, track };
}
