// 12000系サザンプレミアム。銀色地に青いサウスウェイブ帯を描く。
import * as THREE from 'three';
import { basePart, GeoBatch, M, P } from '../batch';
import { Y0, adder, addEndWall, addSingleArm, addUnderfloor, capGeo, faceSheet, roundRings, shellGeo, sideSheet, sweepBand, type CarKind, type CarParts, type Ring, type SheetMaps, type V2 } from './common';
import { mergeLed } from './commuter';

const SILVER = '#d9dde0', SILVER_DARK = '#aeb5bb', BLUE = '#2458b9', GOLD = '#e49a25', ORANGE = '#f0a21d';
export const HW_S = 1.45, YTOP_S = 3.84, R_S = .10;
const HALF: V2[] = [[HW_S - .03, Y0], [HW_S, 1.4], [HW_S, 3.4], [HW_S - .04, 3.56], [HW_S - .24, 3.71], [HW_S - .7, 3.81], [0, YTOP_S]];
const WIN: [number, number] = [2.04, 2.98];

export function paint12000Side(Lb: number, head: boolean, open = false): SheetMaps {
  const s = sideSheet(Lb, YTOP_S), hz = Lb / 2;
  s.base(SILVER, .28, .78);
  // 先頭の客室下で立ち上がり、後方へ水平になる青帯と細い金色の上縁。
  const edge: V2[] = [];
  const start = head ? -hz + 2.1 : -hz - .1;
  for (let i = 0; i <= 24; i++) {
    const z = start + (hz + .1 - start) * i / 24;
    const t = Math.min(1, (z - start) / 6.3);
    edge.push([z, head ? 1.10 + .70 * (1 - (1 - t) ** 2) : 1.80]);
  }
  s.poly([[start, 1.06], [hz + .1, 1.06], ...edge.slice().reverse()], BLUE, .28, .35);
  s.poly([...edge, ...edge.slice().reverse().map(([z, y]): V2 => [z, y + .045])], GOLD, .28, .45);
  if (head) sweepBand(s, Lb, [1.45, 1.67], [3.37, 3.44], -hz + .72, .65, BLUE, .2, .35);
  else s.rect(-hz - 1, hz + 1, 3.37, 3.44, BLUE, .18, .38);
  const window = (zc: number, w = .88) => s.glass(zc - w / 2, zc + w / 2, WIN[0], WIN[1], '#59626a', .05, ['#33424f', '#121a22']);
  const doors = [hz - 2.2];
  const windowStart = head ? -hz + 2.4 : -hz + .65;
  const windowEnd = doors[0] - .70;
  const pitch = (windowEnd - windowStart) / 8;
  for (let i = 0; i < 8; i++) window(windowStart + pitch * (i + .5), pitch - .10);
  for (const z of doors) {
    s.rect(z - .46, z + .46, 1.06, 3.10, SILVER_DARK, .3, .7, .02);
    if (open) s.glass(z - .40, z + .40, 1.12, 3.03, '', 0, ['#2d3943', '#11161b']);
    else {
      s.rect(z - .40, z + .40, 1.12, 3.03, SILVER, .3, .7, .02);
      s.rect(z - .40, z + .40, 1.12, 1.80, BLUE, .28, .35);
      s.rect(z - .40, z + .40, 1.80, 1.845, GOLD, .28, .45);
      s.glass(z - .24, z + .24, 2.10, 2.94, '#697279', .05, ['#34424e', '#151c23']);
    }
  }
  if (head) {
    const crew = -hz + 1.10;
    s.rect(crew - .34, crew + .34, 1.06, 3.10, SILVER_DARK, .3, .7, .02);
    s.rect(crew - .29, crew + .29, 1.12, 3.04, SILVER, .3, .7);
    s.glass(crew - .19, crew + .19, 2.10, 2.94, '#697279', .03, ['#34424e', '#151c23']);
  }
  return s.textures();
}

export function paint12000Face(): SheetMaps {
  const s = faceSheet(HW_S, YTOP_S);
  s.base('#f1f3f4', .24, .78);
  // 前面窓は黒い一枚のマスクに見えるよう下端を中央へ落とす。
  s.poly([[-1.45, 3.78], [1.45, 3.78], [1.45, 2.22], [1.10, 2.10], [.65, 2.03], [0, 2.00], [-.65, 2.03], [-1.10, 2.10], [-1.45, 2.22]], '#151a20', .1, .25);
  s.glass(-1.45, -.50, 2.24, 3.72, '', .02, ['#34434f', '#10161c']);
  s.glass(.50, 1.45, 2.24, 3.72, '', .02, ['#34434f', '#10161c']);
  for (const sx of [-1, 1]) {
    s.poly([[sx * 1.45, 1.90], [sx * 1.10, 1.70], [sx * .58, 1.65], [sx * .58, 1.52], [sx * 1.45, 1.52]], BLUE, .22, .35);
    s.poly([[sx * 1.45, 1.70], [sx * .58, 1.63], [sx * .58, 1.50], [sx * 1.45, 1.57]], GOLD, .22, .35);
  }
  s.rect(-.46, .46, 1.18, 3.28, SILVER_DARK, .3, .72, .08);
  s.rect(-.40, .40, 1.23, 3.22, '#e7e9e9', .3, .6, .06);
  s.glass(-.29, .29, 2.02, 3.12, '#20272d', .06, ['#34414c', '#0c1116']);
  s.poly([[-.27, 1.78], [.27, 1.78], [.27, 1.46], [0, 1.30], [-.27, 1.46]], BLUE, .3, .2);
  s.poly([[-.24, 1.75], [.24, 1.75], [.24, 1.48], [0, 1.34], [-.24, 1.48]], GOLD, .3, .2);
  s.poly([[-.20, 1.71], [.20, 1.71], [.20, 1.50], [0, 1.39], [-.20, 1.50]], '#e7e9e9', .3, .2);
  s.text('SOUTHERN', 0, 1.57, .085, BLUE, 700);
  s.text('12101', -.86, 3.42, .14, '#e7eeee', 600);
  for (const x of [-.92, .92]) { s.rect(x - .30, x + .30, 1.49, 1.72, '#25292c', .18, .3, .05); s.rect(x - .24, x + .24, 1.55, 1.66, ORANGE, .2, .25, .04); }
  return s.textures();
}

export function build12000Car(kind: CarKind, Lb: number): CarParts {
  const head = kind === 'head', hz = Lb / 2, zf = -hz;
  const rings: Ring[] = [...(head ? roundRings(zf, R_S, 1) : [{ z: -hz, inset: 0 }]), { z: hz, inset: 0 }];
  const shell = shellGeo(HALF, rings, YTOP_S, Lb), b = new GeoBatch(), add = adder(b), lit = new GeoBatch();
  const glows: THREE.Vector3[] = [], marksL = new GeoBatch(), marksR = new GeoBatch();
  let face: THREE.BufferGeometry | undefined, led: THREE.BufferGeometry | undefined;
  if (head) {
    face = capGeo(HALF, { z: zf, inset: R_S }, YTOP_S, HW_S, -1);
    const z = zf - .01;
    led = mergeLed([[.82, 3.42, .58]], z - .05, .23);
    add(0, 3.46, z - .03, .65, .24, .04, 0x252a2e);
    for (const sx of [-1, 1]) {
      add(sx * .20, 3.46, z - .06, .20, .16, .03, 0x89949b);
      lit.add('l', P.box, M(sx * .20, 3.46, z - .08, 0, .14, .10, .02), 0xffffff);
      glows.push(new THREE.Vector3(sx * .20, 3.46, z - .22));
      add(sx * .92, 1.62, z - .03, .56, .24, .04, 0x282d31);
      lit.add('l', P.box, M(sx * .92, 1.62, z - .08, 0, .40, .12, .02), 0xf0a21d);
      (sx > 0 ? marksL : marksR).add('l', P.box, M(sx * .92, 1.62, z - .08, 0, .40, .12, .02), 0xf0a21d);
    }
    // 連結器を囲む青いV字スカート。
    add(0, .72, zf - .01, 1.35, .58, .10, 0x15191e);
    for (const sx of [-1, 1]) {
      const shape = new THREE.Shape([
        new THREE.Vector2(sx * 1.32, 1.06),
        new THREE.Vector2(sx * .64, 1.06),
        new THREE.Vector2(sx * .37, .40),
        new THREE.Vector2(sx * 1.00, .40),
      ]);
      const skirt = new THREE.ExtrudeGeometry(shape, {
        depth: .14, bevelEnabled: false,
      });
      b.add('paint', basePart(skirt), M(0, 0, zf - .12), 0x2458b9);
      skirt.dispose();
    }
    add(0, .40, zf - .05, 2.00, .16, .14, 0x2458b9);
    add(0, .88, zf - .16, .3, .24, .5, 0x22252a);
  }
  addEndWall(b, head ? hz : -hz, YTOP_S, HW_S, 0xc2c6cc);
  addUnderfloor(b, Lb, kind, { frame: 0x3a3d42, equip: 0x2b2e33, bogie: 0x24272b });
  for (const z of [-4, 4]) add(0, YTOP_S + .13, z, 1.7, .26, 2.8, 0xcdd1d6);
  add(0, YTOP_S + .03, 0, .4, .06, Lb - 1.4, 0xa9aeb4);
  if (head) addSingleArm(b, hz - 2.1, YTOP_S - .02);
  return { shell, face, paint: b.geometry('paint')!, glass: undefined, led, head: lit.geometry('l') ?? undefined, marks: { l: marksL.geometry('l')!, r: marksR.geometry('l')! }, glows };
}
