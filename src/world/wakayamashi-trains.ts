// 和歌山市駅（world/wakayamashi.ts）に停まっている電車（描画のみ）。座標は下り（world/mw-frame.ts で上りへ写す）。
//   3番線: 加太線の 7100系 2両（行き止まりの車止めの手前、ホーム側のドアを開けて停車）
//   車庫: 留置線 D1 に 7100系 4両 + 8300系 4両、D2 に 1000系 6両、検修庫の D4・D5 に 2両ずつ
// ctx.rng は使わない。車両生成は DOM を使うので world/index.ts からだけ呼ぶ（建築限界検査には含めない）。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { profileLat } from '../route/service';
import { WK } from '../route/routes/misaki-wakayamako-wakayama';
import type { TrainKind } from '../route/types';
import { onLight } from './batch';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { bogieOffset, createTrainSet, setTrainNight } from './train-models';
import { mwFrame } from './mw-frame';
import { YARD } from './wakayamashi';

interface Parked { line: string; kind: TrainKind; units: number[]; dest: string; label: string; /** 先頭の位置（車止めの手前）[m] */ front: number; doorsRight?: boolean }
const END = WK.depot.bump - 4;
const PARKED: Parked[] = [
  { line: 'k3', kind: 'commuter-old', units: [2], dest: '加太', label: '普通', front: WK.bump3 - 4, doorsRight: true },
  { line: 'd1', kind: 'commuter-old', units: [4], dest: '回送', label: '回送', front: END },
  { line: 'd1', kind: 'commuter-new', units: [4], dest: '回送', label: '回送', front: END - 84 },
  { line: 'd2', kind: 'commuter-1000', units: [6], dest: '回送', label: '回送', front: END - 6 },
  { line: 'd4', kind: 'commuter-old', units: [2], dest: '回送', label: '回送', front: END },
  { line: 'd5', kind: 'commuter-new', units: [2], dest: '回送', label: '回送', front: END },
];

export function buildWakayamashiTrains(ctx: GameContext): void {
  const f = mwFrame(ctx);
  if (!f) return;
  const group = new THREE.Group(); group.name = 'oncoming-wakayamashi-yard';
  const a = new THREE.Vector3(), z = new THREE.Vector3();
  const lat = (id: string, s: number) => id === 'k3' ? WK.lat3 : profileLat(YARD[id].lat, s);
  for (const p of PARKED) {
    const cars = createTrainSet(p.kind, p.units.reduce((x, y) => x + y, 0), f.renderer, { dest: p.dest, label: p.label, units: p.units });
    let cur = p.front;
    for (const c of cars) {
      const sc = cur - c.length / 2, bog = bogieOffset(c.length), l = lat(p.line, sc);
      a.copy(f.track.at(sc + bog, l, .38)); z.copy(f.track.at(sc - bog, l, .38));
      placeCar(c.object, a, z); group.add(c.object);
      c.setDoors(!!p.doorsRight, p.doorsRight ? 'R' : undefined);
      cur -= c.length;
    }
  }
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));
  f.scene.add(group); cullByDistance(f, group, 700);
}
