// 9000系更新車。既存の通勤形ジオメトリを使い、更新標準塗装を描く。
import * as THREE from 'three';
import { GeoBatch, M, P } from '../batch';
import { Y0, adder, addEndWall, addSingleArm, addTaperedSkirt, addUnderfloor, capGeo, faceSheet, roundRings, shellGeo, sideSheet, sweepBand, type CarKind, type CarParts, type Ring, type SheetMaps, type V2 } from './common';
import { mergeLed } from './commuter';
import { paintDoor } from './c1000';

const BLUE = '#2f3fa8', ORANGE = '#f0961c';
export const YTOP = 3.84;
const HW = 1.45, R = .28, HALF: V2[] = [[HW, Y0], [HW, 1.5], [HW, 3.42], [HW - .05, 3.58], [HW - .3, 3.71], [HW - .75, 3.8], [0, YTOP]];

export function paint9000Side(Lb: number, head: boolean, open = false): SheetMaps {
  const s = sideSheet(Lb, YTOP), hz = Lb / 2;
  s.base('#d6dbe0', .34, .78);
  for (let y = Y0 + .08; y < 1.94; y += .055) {
    s.rect(-hz, hz, y, y + .018, 'rgba(255,255,255,.22)');
    s.rect(-hz, hz, y + .018, y + .03, 'rgba(0,0,0,.1)');
  }
  s.rect(-hz - 1, hz + 1, 3.48, YTOP + .1, '#aeb4ba', .55, .45);
  const doors = head ? [-6.8, -2.35, 2.4, 7.2] : [-7.2, -2.4, 2.4, 7.2];
  if (head) {
    const zs = -hz + 1.2;
    sweepBand(s, Lb, [1.40, 1.52], [3.21, 3.30], zs + .12, .62, ORANGE, .35, .15);
    sweepBand(s, Lb, [1.52, 2.03], [3.32, 3.47], zs, .62, BLUE, .35, .2, -.12);
  } else {
    s.rect(-hz - 1, hz + 1, 3.32, 3.47, BLUE, .35, .2);
    s.rect(-hz - 1, hz + 1, 3.21, 3.30, ORANGE, .35, .15);
  }
  const lowStart = head ? doors[0] : -hz - 1;
  s.rect(lowStart, hz + 1, 1.60, 1.73, BLUE, .35, .2);
  s.rect(lowStart, hz + 1, 1.49, 1.59, ORANGE, .35, .15);
  const win: [number, number] = [2.02, 2.96];
  for (const z of doors) {
    s.rect(z - .68, z + .68, 1.12, 3.08, '#aeb4ba', .45, .55);
    if (open) s.glass(z - .62, z + .62, 1.16, 3.04, '', 0, ['#4a463e', '#23262b']);
    else {
      s.rect(z - .58, z + .58, 1.16, 3.04, '#c4c9ce', .4, .7);
      s.rect(z - .015, z + .015, 1.16, 3.04, '#727980', .4, .5);
      s.glass(z - .47, z - .10, win[0], win[1], '#565e68', .04);
      s.glass(z + .10, z + .47, win[0], win[1], '#565e68', .04);
    }
  }
  for (let i = 0; i < doors.length - 1; i++) {
    const z = (doors[i] + doors[i + 1]) / 2;
    const half = (win[1] - win[0]) / 2;
    for (const dz of [-.53, .53]) s.glass(z + dz - half, z + dz + half, win[0], win[1], '#565c63', .07);
  }
  s.glass(hz - 1.6, hz - .65, win[0], win[1], '#25313c', .06);
  if (head) {
    paintDoor(s, -hz + .55, .64, 3.08, win, '#c4c9ce', false, false);
    s.glass(-hz + 1.12, -hz + 2.12, win[0], win[1], '#25313c', .06);
  }
  s.rect(1.2, 1.52, 3.43, 3.55, '#2b3138');
  return s.textures();
}

export function paint9000Face(): SheetMaps {
  const s = faceSheet(1.45, YTOP);
  s.base('#cfd4d9', .34, .78);
  s.rect(-1.45, 1.45, 1.52, 2.03, BLUE, .35, .2);
  s.rect(-1.45, 1.45, 1.40, 1.52, ORANGE, .35, .15);
  s.rect(-1.45, 1.45, 2.08, 3.72, '#101419', .2, .3);
  s.glass(.52, 1.19, 2.10, 3.43, '#202a33', .06, ['#3e4b58', '#111820']);
  s.glass(-1.19, -.52, 2.10, 3.43, '#202a33', .06, ['#3e4b58', '#111820']);
  s.rect(-.48, .48, 1.18, 3.72, '#9ea5ab', .4, .75);
  s.glass(-.29, .29, 2.10, 3.17, '#26323c', .04);
  s.rect(-.48, .48, 1.55, 1.98, BLUE, .35, .2);
  s.rect(-.48, .48, 1.43, 1.55, ORANGE, .35, .15);
  return s.textures();
}

export function build9000Car(kind: CarKind, Lb: number): CarParts {
  // 9000系更新車は専用の貫通面・窓下前照灯を持つ20m級4扉車。
  const head = kind === 'head', hz = Lb / 2, zf = -hz;
  const rings: Ring[] = [...(head ? roundRings(zf, R, 1) : [{ z: -hz, inset: 0 }]), { z: hz, inset: 0 }];
  const shell = shellGeo(HALF, rings, YTOP, Lb), b = new GeoBatch(), add = adder(b), lit = new GeoBatch();
  const glows: THREE.Vector3[] = [], marksL = new GeoBatch(), marksR = new GeoBatch();
  let face: THREE.BufferGeometry | undefined, led: THREE.BufferGeometry | undefined;
  if (head) {
    face = capGeo(HALF, { z: zf, inset: R }, YTOP, HW, -1);
    const z = zf - .01;
    led = mergeLed([[0, 3.52, .60]], z - .015, .18);
    for (const sx of [-1, 1]) {
      b.add('paint', P.cyl, M(sx * .86, 1.78, z - .04, 0, .26, .05, .26, Math.PI / 2), 0xd1c3a0);
      lit.add('l', P.cyl, M(sx * .86, 1.78, z - .08, 0, .18, .02, .18, Math.PI / 2), 0xffffff);
      glows.push(new THREE.Vector3(sx * .86, 1.78, z - .22));
      (sx > 0 ? marksL : marksR).add('l', P.box, M(sx * 1.05, 1.49, z - .08, 0, .16, .12, .02), 0xffffff);
    }
    addTaperedSkirt(b, zf, 1.32, 1.23, .67, .60, 0x9ca2a9);
    add(0, .88, zf - .15, .3, .24, .5, 0x22252a);
  }
  addEndWall(b, head ? hz : -hz, YTOP, HW, 0xb9bec4);
  addUnderfloor(b, Lb, kind, { frame: 0x3a3d42, equip: 0x2b2e33, bogie: 0x24272b });
  for (const z of [-6, -2, 2, 6]) add(0, YTOP + .14, z, 1.5, .25, 1.6, 0xb5bac0);
  add(0, YTOP + .03, 0, .45, .06, Lb - 1.2, 0x868b91);
  if (kind === 'pan') addSingleArm(b, -hz + 4, YTOP - .02);
  return { shell, face, paint: b.geometry('paint')!, glass: undefined, led, head: lit.geometry('l') ?? undefined, marks: { l: marksL.geometry('l')!, r: marksR.geometry('l')! }, glows };
}
