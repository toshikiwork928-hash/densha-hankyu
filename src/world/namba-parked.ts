// 南海本線 堺〜難波（座標は上り 'namba'。下り 'namba-up' でも world/namba-frame.ts の ctx で同じ位置）専用:
// 難波の他の番線に停まっている電車（描画のみ・発車待ち。先頭は堺の側）。全部の番線は埋めない
//   本線（9・7・5番線）: 1000系・8300系。自列車の番線を避けて2本だけ出す（自列車の番線は種別で変わる）
//   高野線（3・1番線）: 30000系（特急こうや）・6300系。走行する高野線の電車（world/koya-traffic.ts）は 4・2番線だけを使う
// ctx.rng は使わない。車両生成は DOM を使うので world/index.ts からだけ呼ぶ（建築限界検査には含めない）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { NAMBA_END, NAMBA_STOP, NAMBA_TRACKS } from '../route/routes/namba';
import type { ServiceId, TrainKind } from '../route/types';
import { onLight } from './batch';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { bogieOffset, createTrainSet, setTrainNight } from './train-models';

interface Parked { track: keyof typeof NAMBA_TRACKS; kind: TrainKind; units: number[]; label: string; dest: string; /** 車止め側の端の位置 [m]（未指定は自列車の停止位置 NAMBA_STOP にそろえる） */ end?: number }
/** 本線の候補（自列車の番線を除いて先頭から2本） */
const MAIN: Parked[] = [
  { track: 7, kind: 'commuter-new', units: [4, 4], label: '普通', dest: '羽倉崎' },
  { track: 5, kind: 'commuter-1000', units: [6], label: '急行', dest: '和歌山市' },
  { track: 9, kind: 'commuter-1000', units: [6], label: '普通', dest: '岸和田' },
];
const KOYA: Parked[] = [
  { track: 3, kind: 'limited-30000', units: [4], label: 'こうや', dest: '極楽橋' },
  // 1番線は終端が他より手前（車止めの近くまで寄せたまま）
  { track: 1, kind: 'commuter-6300', units: [4, 2], label: '準急', dest: '和泉中央', end: NAMBA_END - 9.5 },
];
const MAIN_SHOWN = 2;
/** 自列車の難波の番線（route/routes/namba.ts の trackNames と同じ） */
const playerTrack = (id: ServiceId | undefined): number => id === 'local' ? 7 : id === 'southern' ? 5 : id === 'limited' ? 9 : 6;

export function buildNambaParked(ctx: GameContext): void {
  if (ctx.route.id !== 'namba') return;
  const { track, scene, events } = ctx;
  const root = new THREE.Group(); root.name = 'namba-parked';
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const sets = [...MAIN, ...KOYA].map(p => {
    const cars = createTrainSet(p.kind, p.units.reduce((a, b) => a + b, 0), ctx.renderer, { dest: p.dest, label: p.label, units: p.units });
    const g = new THREE.Group(); g.name = `namba-parked-${p.track}`;
    const lat = NAMBA_TRACKS[p.track], len = cars.reduce((a, c) => a + c.length, 0);
    // 先頭（index 0）は堺の側（s の小さい側）、最後尾（車止め側の端）は自列車の停止位置にそろえる
    let sc = (p.end ?? NAMBA_STOP) - len;
    for (const c of cars) {
      sc += c.length / 2;
      const bog = bogieOffset(c.length);
      pa.copy(track.at(sc - bog, lat, .38)); pb.copy(track.at(sc + bog, lat, .38));
      placeCar(c.object, pa, pb); g.add(c.object);
      c.setDoors(true); // 頭端式: 両側にホーム
      sc += c.length / 2;
    }
    root.add(g);
    return { p, g };
  });
  const sync = () => {
    const mine = playerTrack(ctx.state.sel?.service);
    let n = 0;
    for (const { p, g } of sets) {
      if (!MAIN.includes(p)) { g.visible = true; continue; }
      g.visible = p.track !== mine && n < MAIN_SHOWN;
      if (g.visible) n++;
    }
  };
  sync();
  events.on('serviceChange', sync);
  events.on('reset', sync);
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));
  scene.add(root); cullByDistance(ctx, root, 900);
}
