// 車両モデルの窓口。種別ごとの外観を手続き生成する（通勤形 新・旧、特急形、山岳線用 2300系。モブの 1000系・2000系・6300系・30000系）
// 1両 = 材質別に結合したメッシュ数個。ジオメトリ・材質・テクスチャは種別ごとに共有し、行先 LED のみ編成ごと
import * as THREE from 'three';
import type { TrainKind } from '../route/types';
import { envMap, glowTexture, ledDestTexture, ledTexture, ledTypeTexture, type CarKind, type CarParts, type SheetMaps } from './trains/common';
import { buildCommuterCar, paintCommuterFace, paintCommuterSide, HW, YTOP } from './trains/commuter';
import { paintHankyuFace, paintHankyuSide } from './trains/hankyu2000';
import { buildLimitedCar, paintLimitedSide, HW_L } from './trains/limited';
import { build2300Car, paint2300Face, paint2300Side } from './trains/c2300';
import { buildSouthernCar, ledSouthernTexture, paintSouthernFace, paintSouthernSide } from './trains/southern';
import { buildNewLiveryCar, paintNewLiveryFace, paintNewLiverySide } from './trains/c1000';
import { build30000Car, paint30000Face, paint30000Side } from './trains/c30000';
import { build9000Car, paint9000Face, paint9000Side } from './trains/c9000';
import { build12000Car, paint12000Face, paint12000Side } from './trains/c12000';
import { CAR_LEN, carLenOf } from '../route/service';

/** 1両分の生成結果。原点 = 車体中心・レール面高さ、前 = -Z */
export interface TrainCar {
  object: THREE.Object3D;
  length: number;
  /** 客用ドアの開閉（停車中の見た目。何度呼んでもよい）。side = 開ける側（進行方向に対して。ホーム側）。省略は両側 */
  setDoors(open: boolean, side?: 'L' | 'R'): void;
}

/** 行先表示などの任意指定 */
export interface TrainSetOptions {
  /** 行先（既定 海浜公園） */
  dest?: string;
  /** 種別表示（既定は車種から 普通/急行/特急） */
  label?: string;
  /** 連結するユニット（両数）。例 [4, 2]。未指定は 4両ずつ + 端数（特急形は1ユニット） */
  units?: number[];
  /** ユニットごとの車種（units と同じ並び）。未指定・不足分は kind。例 サザン = ['southern-10000', 'commuter-old'] */
  unitKinds?: TrainKind[];
}

/** 編成を生成（先頭車 index 0、最後尾は逆向きの先頭車） */
export type CreateTrainSet = (kind: TrainKind, cars: number, renderer: THREE.WebGLRenderer, opts?: TrainSetOptions) => TrainCar[];

export const TRAIN_KINDS: Record<TrainKind, { label: string; service: string }> = {
  'commuter-new': { label: '通勤形（ステンレス・黒顔）', service: '普通' },
  'commuter-old': { label: '通勤形（鋼製・貫通扉）', service: '急行' },
  limited: { label: '特急形', service: '特急' },
  'commuter-2300': { label: '山岳線用（18m・2扉・2両ユニット）', service: '各停' },
  'southern-10000': { label: '特急形（サザン座席指定車・1扉）', service: '特急' },
  'commuter-9000': { label: '9000系（更新・ステンレス4扉）', service: '急行' },
  'southern-12000': { label: '12000系（サザンプレミアム・銀色1扉）', service: '特急' },
  'hankyu-2000': { label: '阪急2000系（19m・3扉・マルーン）', service: '普通' },
  // 以下は運転しない車種（対向列車・高野線の電車・留置車両）
  'commuter-1000': { label: '1000系（本線・6両）', service: '普通' },
  'commuter-2000': { label: '2000系（17m・2扉・2両ユニット）', service: '普通' },
  'commuter-6300': { label: '6300系（高野線・ステンレス）', service: '各停' },
  'limited-30000': { label: '30000系（特急こうや）', service: '特急' },
};

export { CAR_LEN, carLenOf };
/** 車体長（連結面間隔 0.5m）。2300系は 18m 車 */
const lbOf = (kind: TrainKind) => carLenOf(kind) - .5;
/** 台車中心の車体中心からの距離 [m]（common.addUnderfloor と同じ: 車体端から 2.6m） */
export const bogieOffset = (carLen: number): number => carLen / 2 - .25 - 2.6;

/** n 両ユニットの車種並び（両端 = 運転台付きの先頭車、所々にパンタ付き） */
export function formation(n: number): CarKind[] {
  return Array.from({ length: n }, (_, i): CarKind => i === 0 || i === n - 1 ? 'head' : i % 3 === 2 ? 'pan' : 'mid');
}

/** 既定のユニット分け（通勤形は 4両 + 端数、2300系・2000系は 2両ずつ、特急形・1000系の6両は1ユニット） */
export function defaultUnits(kind: TrainKind, n: number): number[] {
  const u = kind === 'commuter-2300' || kind === 'commuter-2000' ? 2 : 4;
  if (kind === 'limited' || kind === 'limited-30000' || kind === 'southern-12000' || (kind === 'commuter-1000' && n === 6) || n <= u) return [Math.max(1, n)];
  const out: number[] = []; let r = n;
  while (r > u) { out.push(u); r -= u; }
  out.push(r);
  return out;
}

interface KindKit {
  geo(k: CarKind): CarParts;
  side: { head: THREE.MeshStandardMaterial; mid: THREE.MeshStandardMaterial };
  /** ドアを開けた側面（初めて開けるときに作る） */
  open(head: boolean): THREE.MeshStandardMaterial;
  openMats: THREE.MeshStandardMaterial[];
  face?: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  base: { env: number; paintEnv: number };
}

const kindKits = new Map<TrainKind, KindKit>();
const shared = {
  headOn: new THREE.MeshBasicMaterial({ color: 0xfff6e0, vertexColors: true, toneMapped: false }),
  tailOn: new THREE.MeshBasicMaterial({ color: 0xff2414, toneMapped: false }),
  off: null as THREE.MeshStandardMaterial | null,
  glow: new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff2d8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .25, fog: true }),
};
const ledMats = new Map<string, THREE.MeshBasicMaterial>();
let night = 0;

/**
 * 描画の見た目の切替（render/illustrated.ts）へ、車両の生成を知らせる登録口。
 * 見た目の切替はこれで新しい車両・材質を知るので、シーン全体を定期的に走査しなくてよい。登録が無い間（標準）は何もしない
 */
export interface TrainLookListener {
  /** 車両が1両生成された（外板・塗装・窓などを子に持つグループ） */
  car(object: THREE.Object3D): void;
  /** 種別ごとの共有材質のうち、あとから作られるもの（ドア開放の外板）が生成された */
  material(mat: THREE.Material): void;
}
const lookListeners = new Set<TrainLookListener>();
/** 登録する。すでにあるドア開放の外板はすぐ渡す。戻り値で登録を解除する */
export function addTrainLookListener(l: TrainLookListener): () => void {
  lookListeners.add(l);
  for (const k of kindKits.values()) for (const m of k.openMats) l.material(m);
  return () => { lookListeners.delete(l); };
}

function sheetMat(m: SheetMaps, env: THREE.Texture, physical: boolean, envI: number): THREE.MeshStandardMaterial {
  const p = {
    map: m.map, roughnessMap: m.rm, metalnessMap: m.rm, emissiveMap: m.emissive, emissive: 0xfff1d6, emissiveIntensity: 0,
    roughness: 1, metalness: 1, envMap: env, envMapIntensity: envI,
  };
  return physical ? new THREE.MeshPhysicalMaterial({ ...p, clearcoat: 1, clearcoatRoughness: .07 }) : new THREE.MeshStandardMaterial(p);
}

function kindKit(kind: TrainKind, renderer: THREE.WebGLRenderer): KindKit {
  let k = kindKits.get(kind);
  if (k) return k;
  const env = envMap(renderer), geos = new Map<CarKind, CarParts>();
  shared.off ??= new THREE.MeshStandardMaterial({ color: 0x8a8f95, roughness: .2, metalness: .5, envMap: env });
  const LB = lbOf(kind);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c0f13, roughness: .06, metalness: .3, envMap: env, envMapIntensity: 1.2, emissive: 0xfff1d6, emissiveIntensity: 0 });
  if (kind === 'limited') {
    const paint = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: .22, metalness: .5, clearcoat: 1, clearcoatRoughness: .07, envMap: env, envMapIntensity: 1.2, side: THREE.DoubleSide });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, buildLimitedCar(c, LB)), geos.get(c)!),
      side: { head: sheetMat(paintLimitedSide(LB, true), env, true, 1.2), mid: sheetMat(paintLimitedSide(LB, false), env, true, 1.2) },
      paint, glass, base: { env: 1.2, paintEnv: 1.2 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(paintLimitedSide(LB, h, true), env, true, 1.2)),
    };
  } else if (kind === 'southern-10000' || kind === 'southern-12000') {
    const premium = kind === 'southern-12000';
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .5, envMap: env, envMapIntensity: .8 });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, premium ? build12000Car(c, LB) : buildSouthernCar(c, LB)), geos.get(c)!),
      side: { head: sheetMat(premium ? paint12000Side(LB, true) : paintSouthernSide(LB, true), env, false, .9), mid: sheetMat(premium ? paint12000Side(LB, false) : paintSouthernSide(LB, false), env, false, .9) },
      face: sheetMat(premium ? paint12000Face() : paintSouthernFace(), env, false, .9),
      paint, glass, base: { env: .9, paintEnv: .8 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(premium ? paint12000Side(LB, h, true) : paintSouthernSide(LB, h, true), env, false, .9)),
    };
  } else if (kind === 'commuter-2300') {
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .35, envMap: env, envMapIntensity: .6 });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, build2300Car(c, LB)), geos.get(c)!),
      side: { head: sheetMat(paint2300Side(LB, true), env, false, .9), mid: sheetMat(paint2300Side(LB, false), env, false, .9) },
      face: sheetMat(paint2300Face(), env, false, .9),
      paint, glass, base: { env: .9, paintEnv: .6 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(paint2300Side(LB, h, true), env, false, .9)),
    };
  } else if (kind === 'commuter-9000') {
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .4, metalness: .7, envMap: env, envMapIntensity: .8 });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, build9000Car(c, LB)), geos.get(c)!),
      side: { head: sheetMat(paint9000Side(LB, true), env, false, .9), mid: sheetMat(paint9000Side(LB, false), env, false, .9) },
      face: sheetMat(paint9000Face(), env, false, .9),
      paint, glass, base: { env: .9, paintEnv: .7 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(paint9000Side(LB, h, true), env, false, .9)),
    };
  } else if (kind === 'commuter-1000' || kind === 'commuter-2000') {
    const m = kind === 'commuter-1000' ? '1000' : '2000', envI = m === '2000' ? .9 : .7;
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .35, envMap: env, envMapIntensity: .6 });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, buildNewLiveryCar(m, c, LB)), geos.get(c)!),
      side: { head: sheetMat(paintNewLiverySide(m, LB, true), env, false, envI), mid: sheetMat(paintNewLiverySide(m, LB, false), env, false, envI) },
      face: sheetMat(paintNewLiveryFace(m), env, false, envI),
      paint, glass, base: { env: envI, paintEnv: .6 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(paintNewLiverySide(m, LB, h, true), env, false, envI)),
    };
  } else if (kind === 'hankyu-2000') {
    // 阪急2000系: 形は通勤形（new）の流用、塗装と扉配置だけ阪急（hankyu2000.ts）
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .3, metalness: .2, envMap: env, envMapIntensity: .7 });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, buildCommuterCar('new', c, LB)), geos.get(c)!),
      side: { head: sheetMat(paintHankyuSide(LB, true), env, false, .8), mid: sheetMat(paintHankyuSide(LB, false), env, false, .8) },
      face: sheetMat(paintHankyuFace(), env, false, .8),
      paint, glass, base: { env: .8, paintEnv: .7 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(paintHankyuSide(LB, h, true), env, false, .8)),
    };
  } else if (kind === 'limited-30000') {
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .45, metalness: .25, envMap: env, envMapIntensity: .6 });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, build30000Car(c, LB)), geos.get(c)!),
      side: { head: sheetMat(paint30000Side(LB, true), env, false, .8), mid: sheetMat(paint30000Side(LB, false), env, false, .8) },
      face: sheetMat(paint30000Face(), env, false, .8),
      paint, glass, base: { env: .8, paintEnv: .6 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(paint30000Side(LB, h, true), env, false, .8)),
    };
  } else {
    // 8300系・7100系。6300系（ss）は 7100系と同じ形でステンレス無塗装
    const v = kind === 'commuter-new' ? 'new' : 'old', ss = kind === 'commuter-6300', envI = v === 'new' || ss ? .9 : .6;
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: v === 'new' ? .35 : .15, envMap: env, envMapIntensity: .6 });
    k = {
      geo: c => geos.get(c) ?? (geos.set(c, buildCommuterCar(v, c, LB, ss)), geos.get(c)!),
      side: { head: sheetMat(paintCommuterSide(v, LB, true, false, ss), env, false, envI), mid: sheetMat(paintCommuterSide(v, LB, false, false, ss), env, false, envI) },
      face: sheetMat(paintCommuterFace(v, ss), env, false, envI),
      paint, glass, base: { env: envI, paintEnv: .6 },
      openMats: [], open: h => openMat(k!, h, () => sheetMat(paintCommuterSide(v, LB, h, true, ss), env, false, envI)),
    };
  }
  kindKits.set(kind, k);
  applyNight(k);
  return k;
}

const openCache = new Map<KindKit, Partial<Record<'head' | 'mid', THREE.MeshStandardMaterial>>>();
function openMat(k: KindKit, head: boolean, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let c = openCache.get(k);
  if (!c) { c = {}; openCache.set(k, c); }
  const key = head ? 'head' : 'mid';
  if (!c[key]) {
    c[key] = make(); c[key]!.userData.doorsOpen = true; k.openMats.push(c[key]!); applyNight(k);
    for (const l of lookListeners) l.material(c[key]!);
  }
  return c[key]!;
}

function ledMatPart(part: 'type' | 'dest', label: string, dest: string): THREE.MeshBasicMaterial {
  const key = `${part}:${label}|${dest}`;
  let m = ledMats.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ map: part === 'type' ? ledTypeTexture(label) : ledDestTexture(dest), toneMapped: false }); ledMats.set(key, m); }
  return m;
}

function ledSouthernMat(label: string, dest: string): THREE.MeshBasicMaterial {
  const key = `south:${label}|${dest}`;
  let m = ledMats.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ map: ledSouthernTexture(label, dest), toneMapped: false }); ledMats.set(key, m); }
  return m;
}

function ledMat(label: string, dest: string): THREE.MeshBasicMaterial {
  const key = `${label}|${dest}`;
  let m = ledMats.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ map: ledTexture(label, dest), toneMapped: false }); ledMats.set(key, m); }
  return m;
}

/** front / rear = 編成の先頭・最後尾、mid = 中間車、jointFront / jointRear = ユニット連結部の運転台付き車（灯火・行先は消灯） */
type Role = 'front' | 'rear' | 'mid' | 'jointFront' | 'jointRear';
const blankLed = new THREE.MeshBasicMaterial({ color: 0x060606 });

/** 優等列車（急行・特急・サザン）の表示。標識灯は普通 = 前から見て左のみ、優等 = 両方点灯 */
const isExpress = (label: string) => /急|特|サザン/.test(label);

function makeCar(kit: KindKit, kind: CarKind, role: Role, led: THREE.Material, led2: THREE.Material | undefined, express: boolean): { car: THREE.Group; setDoors: TrainCar['setDoors'] } {
  const g = kit.geo(kind), car = new THREE.Group(), body = new THREE.Group();
  const closed = kind === 'head' ? kit.side.head : kit.side.mid;
  // 外板は +X 側 / -X 側の2グループ（材質配列 [+X, -X]）。+X = 車の進行方向右。後ろ向きの運転台付き車（body を PI 回転）は左右が入れ替わる
  const shell = new THREE.Mesh(g.shell, [closed, closed]);
  shell.name = 'train-shell';
  body.add(shell);
  body.add(new THREE.Mesh(g.paint, kit.paint));
  if (g.face && kit.face) body.add(new THREE.Mesh(g.face, kit.face));
  if (g.glass) body.add(new THREE.Mesh(g.glass, kit.glass));
  const lit = role === 'front' || role === 'rear';
  if (g.led) body.add(new THREE.Mesh(g.led, lit ? led : blankLed));
  if (g.led2) body.add(new THREE.Mesh(g.led2, lit && led2 ? led2 : blankLed));
  if (kind === 'head') {
    // 前: 前照灯点灯（尾灯は付けない）、後: 尾灯点灯・前照灯は消灯色
    if (role === 'front' && g.head) body.add(new THREE.Mesh(g.head, shared.headOn));
    if (role !== 'front' && g.head) body.add(new THREE.Mesh(g.head, shared.off!));
    if (role === 'rear' && g.tail) body.add(new THREE.Mesh(g.tail, shared.tailOn));
    if (g.marks) {
      // 標識灯: 先頭は左（前から見て +X 側）だけ点灯、優等は両方。最後尾は両方赤。ユニット連結部は消灯
      const lens = (left: boolean) => role === 'front' ? (left || express ? shared.headOn : shared.off!) : role === 'rear' ? shared.tailOn : shared.off!;
      body.add(new THREE.Mesh(g.marks.l, lens(true)));
      body.add(new THREE.Mesh(g.marks.r, lens(false)));
    }
    if (role === 'front') for (const p of g.glows) {
      const s = new THREE.Sprite(shared.glow); s.position.copy(p); s.scale.setScalar(1.4); s.name = 'glow'; body.add(s);
    }
    if (role === 'rear' || role === 'jointRear') body.rotation.y = Math.PI;
  }
  for (const o of body.children) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  car.add(body);
  const flip = body.rotation.y !== 0;
  let key = '';
  return {
    car,
    setDoors(open, side) {
      const l = open && side !== 'R', r = open && side !== 'L'; // 左側 / 右側を開ける
      const k = `${l ? 1 : 0}${r ? 1 : 0}`;
      if (k === key) return;
      key = k;
      const o = kit.open(kind === 'head');
      shell.material = flip ? [l ? o : closed, r ? o : closed] : [r ? o : closed, l ? o : closed];
    },
  };
}

export const createTrainSet: CreateTrainSet = (kind, cars, renderer, opts = {}) => {
  const label = opts.label ?? TRAIN_KINDS[kind].service, dest = opts.dest ?? '堺';
  const shown = label === '特急サザン' ? 'サザン' : label, express = isExpress(label);
  // 前面の表示器: 8300系・2300系は左に種別・右に行先の2面、10000系は赤地の種別と白地の行先の1面、それ以外は1面に種別と行先
  const leds = (k: TrainKind) => k === 'commuter-new' || k === 'commuter-2300' || k === 'commuter-1000'
    ? { led: ledMatPart('type', shown, dest), led2: ledMatPart('dest', shown, dest) }
    : k === 'southern-10000' || k === 'southern-12000' ? { led: ledSouthernMat(label, dest), led2: undefined } : { led: ledMat(shown, dest), led2: undefined };
  const units = opts.units?.length ? opts.units : defaultUnits(kind, Math.max(1, cars));
  const out: TrainCar[] = [];
  units.forEach((m, u) => {
    // ユニットごとの車種（サザンは 10000系 + 7100系）。未指定は編成の kind
    const uk = opts.unitKinds?.[u] ?? kind, kit = kindKit(uk, renderer), len = carLenOf(uk), { led, led2 } = leds(uk);
    const first = u === 0, last = u === units.length - 1;
    formation(m).forEach((k, i) => {
      const lastCar = i === m - 1;
      const role: Role = i === 0 ? (first ? 'front' : 'jointFront') : lastCar ? (last ? 'rear' : 'jointRear') : 'mid';
      const c = makeCar(kit, m === 1 ? 'head' : k, role, led, led2, express);
      out.push({ object: c.car, length: len, setDoors: c.setDoors });
    });
  });
  for (const l of lookListeners) for (const c of out) l.car(c.object);
  return out;
};

function applyNight(k: KindKit) {
  for (const m of [k.side.head, k.side.mid, k.face, ...k.openMats]) if (m) { m.emissiveIntensity = night * 1.1; m.envMapIntensity = k.base.env * (1 - night * .75); }
  k.paint.envMapIntensity = k.base.paintEnv * (1 - night * .75);
  k.glass.envMapIntensity = 1.2 - night * .9; k.glass.emissiveIntensity = night * .5;
}

/** 夜間係数 0..1（窓明かり・灯具のグロー・環境反射）。全編成で共通 */
export function setTrainNight(f: number): void {
  night = f;
  for (const k of kindKits.values()) applyNight(k);
  shared.glow.opacity = .25 + f * .75;
}
/** 互換: 編成指定版（材質は種別で共有のため全体に効く） */
export function setTrainSetNight(_set: readonly TrainCar[], f: number): void { setTrainNight(f); }

/** 車体寸法（カメラ・当たり判定などの参考） */
export const TRAIN_DIMS = { halfWidth: Math.max(HW, HW_L), height: YTOP };
