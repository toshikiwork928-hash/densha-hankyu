// 駅（ホーム・上屋・駅名標・ベンチ・柵・駅舎・駅前広場・人）。route.stations から生成
// ホーム照明の光源・発光体は環境担当（env/night-lights.ts）
import * as THREE from 'three';
import { FONT } from '../core/config';
import type { GameContext } from '../core/context';
import type { Station, StationStructure } from '../route/types';
import { GeoBatch, M, P, onLight } from './batch';
import { canvasTex } from './canvas-tex';
import { getTerrain } from './terrain';
import { buildMountainStations } from './mountain-stations';
import { T3_GAP, hagoromoSpec } from './hagoromo-branch';
import { buildIndoorStations } from './indoor-station';
import { buildCustomStation } from './custom-stations';
import { buildElevatedConcourse, buildHeritageFacade, buildCoastalSpecialStations, coastalThirdTracks } from './coastal-stations';
import { addCanopyRoof, addCanopyBraces, addPlatformWall, architectureOf } from './station-architecture';
import { isDaigakumae } from '../route/routes/misaki-wakayamako-daigakumae';

const platMat = new THREE.MeshLambertMaterial({ color: 0xc9c5bc });
const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const SHIRTS = [0x2d3a5a, 0xf0f0f0, 0x6a2a2a, 0x3a5a3a, 0xc8b89a, 0x222222, 0x8a9ab0, 0xd06a3a, 0x5a4a7a, 0xe8d0d8];
const PANTS = [0x22262e, 0x3a3f4a, 0x4a3a2e, 0x6a6a70, 0x1a2a4a];

/** 人（立ち姿、ローカル座標 y=0 が床） */
export function person(b: GeoBatch, rnd: () => number, x: number, z: number, ry: number): void {
  const h = 1.5 + rnd() * .32, shirt = SHIRTS[Math.floor(rnd() * SHIRTS.length)], pants = PANTS[Math.floor(rnd() * PANTS.length)];
  const legH = h * .46, torso = h * .34;
  for (const dx of [-.09, .09]) b.add('body', P.box, M(x + dx * Math.cos(ry), legH / 2, z - dx * Math.sin(ry), ry, .13, legH, .16), pants);
  b.add('body', P.box, M(x, legH + torso / 2, z, ry, .4, torso, .24), shirt);
  for (const dx of [-.24, .24]) b.add('body', P.box, M(x + dx * Math.cos(ry), legH + torso * .55, z - dx * Math.sin(ry), ry, .1, torso * .9, .12), shirt);
  b.add('body', P.sphere, M(x, legH + torso + .13, z, 0, .21, .25, .22), 0xe0b896);
  b.add('body', P.sphere, M(x, legH + torso + .19, z + .02, 0, .23, .16, .23), rnd() < .8 ? 0x1a1612 : 0x6a5a4a); // 髪
  if (rnd() < .4) b.add('body', P.box, M(x + .28 * Math.cos(ry), legH + .05, z - .28 * Math.sin(ry), ry, .1, .3, .35), [0x222222, 0x6a4a2a, 0xb0a090][Math.floor(rnd() * 3)]); // かばん
}

/** 駅名標のテクスチャ。左に「← prevName」、右に「nextName →」（板を表から見て）。userData に左右の駅名（点検用） */
export function nameTex(sta: Station, prevName: string, nextName: string): THREE.CanvasTexture {
  const tex = canvasTex(1024, 300, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e0588c'; g.fillRect(0, 196, w, 22);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.font = `800 112px ${FONT}`; g.fillText(sta.name, w / 2, 130);
    if (sta.kana) { g.font = `600 34px ${FONT}`; g.fillText(sta.kana, w / 2, 178); }
    g.font = `600 40px ${FONT}`; g.textAlign = 'left'; g.fillText('← ' + prevName, 30, 268);
    g.textAlign = 'right'; g.fillText(nextName + ' →', w - 30, 268);
  });
  tex.userData.nameSign = { left: prevName, right: nextName };
  return tex;
}

/** lat = ホームに面する線路の横位置（2面4線駅は待避線）、side = ホームの側、minimal = 駅舎・駅前広場を作らない（対向側ホーム） */
export interface StationBuildOpts { /** ホームを s 方向へずらす [m]（踏切を挟んだ対面ホーム） */ shift?: number; lat?: number; side?: 'L' | 'R'; minimal?: boolean; /** 高架駅: 地面までの高さ（負）。駅舎・広場を地面に置き、ホームを高架上に */ elevatedDy?: number;
  /** 駅舎のホーム上の位置・外観・連絡の種類（未指定は sta.structure。構成のわからない駅は標準の駅舎を中央に置く） */
  end?: StationStructure['end']; link?: StationStructure['link']; style?: StationStructure['style'] }

export function buildStation(ctx: GameContext, sta: Station, prevName: string, nextName: string, opt: StationBuildOpts = {}): THREE.Group {
  const { rng: rnd, track } = ctx;
  const s0 = sta.platform.from + (opt.shift ?? 0), s1 = sta.platform.to + (opt.shift ?? 0);
  const len = s1 - s0, sc = (s0 + s1) / 2, t = track.trackAt(sc);
  // 右側ホームは左右反転（x と向きを反転）
  const sx = (opt.side ?? sta.platform.side) === 'L' ? 1 : -1;
  const X = (x: number) => sx * x; // ホーム側を負とする横位置
  const grp = new THREE.Group(); grp.position.copy(track.at(sc, opt.lat ?? 0, 0)); grp.rotation.y = -t.phi; ctx.scene.add(grp);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(5, 1.1, len), platMat); plat.position.set(X(-(1.6 + 2.5)), .55, 0); grp.add(plat);
  const b = new GeoBatch();
  const arch = architectureOf(sta.name);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: number) => b.add('body', P.box, M(X(x), y, z, 0, w, h, d), col);
  // 点字ブロック・白線・ホーム端
  box(-2.3, 1.11, 0, .3, .02, len, 0xf2c200);
  box(-1.72, 1.115, 0, .25, .03, len, 0xf4f4f4);
  box(-1.62, .9, 0, .06, .3, len, 0x9a968c);
  // 上屋（屋根・梁・柱）
  const rl = len * (arch && arch.kind !== 'hall' ? arch.roofRatio : .62);
  if (arch?.kind !== 'hall') {
    const roofY = arch ? arch.Yroof : 4.35;
    if (arch?.roofShape) addCanopyRoof(b, X(-4.3), 4.6, rl, arch);
    else {
      box(-4.3, roofY, 0, 4.6, .14, rl, arch ? arch.roofColor : 0x6b7680);
      box(-4.3, roofY - .13, 0, 4.4, .12, rl, 0xdcdcd8);
    }
    if (arch) addCanopyBraces(b, X(-5), 4.2, rl, arch);
    box(-2.0, roofY - .2, 0, .1, .35, rl, arch ? arch.roofColor : 0x6b7680);
    for (let z = -rl / 2 + 4; z <= rl / 2 - 4; z += arch ? arch.supportSpacing : 10) {
      box(-5.0, roofY - 1.7, z, .2, 3.1, .2, arch ? arch.supportColor ?? 0x8a9096 : 0x8a9096);
      box(-4.3, roofY - .25, z, 4.2, .16, .14, arch ? arch.supportColor ?? 0x8a9096 : 0x8a9096);
    }
  }
  if (arch?.kind === 'platform-wall') {
    addPlatformWall(b, X(-6.6), rl, arch);
  }
  // 柵（ホーム裏側）
  {
    const stairOpening: number | undefined = undefined;
    for (let z = -len / 2; z <= len / 2; z += 2.5) if ((arch?.kind !== 'platform-wall' || Math.abs(z) > rl / 2) && (stairOpening === undefined || Math.abs(z - stairOpening) > 1.2)) box(-6.55, 1.75, z, .06, 1.3, .06, 0x8a9096);
    const segments = arch?.kind === 'platform-wall' ? [[-len / 2, -rl / 2], [rl / 2, len / 2]] : stairOpening === undefined ? [[-len / 2, len / 2]] : [[-len / 2, stairOpening - 1.2], [stairOpening + 1.2, len / 2]];
    for (const [from, to] of segments) {
      box(-6.55, 2.35, (from + to) / 2, .05, .06, to - from, 0x8a9096);
      box(-6.55, 1.8, (from + to) / 2, .02, .9, to - from, 0x9fb0a8);
    }
  }
  // ベンチ・自販機・ごみ箱・時計
  for (let z = -rl / 2 + 8; z <= rl / 2 - 8; z += 16) {
    box(-5.4, 1.55, z, .45, .06, 2.2, 0x2a6aa8); box(-5.62, 1.85, z, .06, .45, 2.2, 0x2a6aa8);
    for (const dz of [-.9, .9]) box(-5.4, 1.32, z + dz, .4, .42, .06, 0x777777);
  }
  for (const z of [-rl / 2 + 3, rl / 2 - 14]) {
    b.add('body', P.boxB, M(X(-6.0), 1.1, z, 0, .7, 1.83, .95), [0xc8282a, 0x2a5fb0][z < 0 ? 0 : 1]);
    box(-5.64, 2.25, z, .02, .9, .8, 0xe8f0f4);
    for (let k = 0; k < 3; k++) box(-5.63, 2.05 + k * .25, z, .02, .08, .7, [0xd03030, 0x3070d0, 0x30a050][k]);
  }
  box(-4.3, 3.7, 0, .1, .5, .5, 0x222222);
  // 駅名標の柱
  const signs: number[] = [-len * .3, 0, len * .3];
  for (const z of signs) for (const dz of [-1.5, 1.5]) box(-4.0, 1.9, z + dz, .08, 1.6, .08, 0x777d84);
  // 人（ホーム上、停車駅のみ多め）
  const n = opt.minimal ? 10 : sta.pass && !sta.loop && !sta.island ? 6 : 22;
  for (let k = 0; k < n; k++) {
    const z = (rnd() - .5) * len * .8, x = -(3.0 + rnd() * 2.8);
    b.parent = new THREE.Matrix4().makeTranslation(0, 1.1, 0);
    person(b, rnd, X(x), z, rnd() < .7 ? (sx > 0 ? -Math.PI / 2 : Math.PI / 2) : rnd() * 6);
    b.parent = null;
  }

  // 駅舎・駅前広場（ホーム裏、中央付近）。高架駅は地上（gy）に置き、ホームへ上がる階段を付ける
  const bw = 26, bd = 10, bx = -(7.2 + bd / 2), gy = opt.elevatedDy ?? 0;
  if (gy) {
    b.parent = new THREE.Matrix4().makeTranslation(0, gy, 0);
    // 高架下からホームへの階段室
    box(-5.2, -gy / 2 + .6, len * .2, 2.6, -gy + 1.2, 7, 0xd8d4ca);
    box(-5.2, 1.1 + 2.6, len * .2, 2.8, .2, 7.4, 0x6b7680);
  }
  // 駅舎の位置: 局所 +z = s の減る向き（なんば寄り）。構成（structure）が無ければ中央。ends = 両端に小さな駅舎を1棟ずつ
  const stc = sta.structure, endPos = opt.end ?? stc?.end ?? 'center', wood = (opt.style ?? stc?.style) === 'wood-western';
  const link = opt.link ?? stc?.link;
  const bwU = endPos === 'ends' ? 14 : wood ? 20 : bw;
  const bzs = endPos === 'ends' ? [len / 2 - bwU / 2 - 4, -(len / 2 - bwU / 2 - 4)] : [endPos === 'namba' ? len / 2 - bwU / 2 - 8 : endPos === 'wakayama' ? -(len / 2 - bwU / 2 - 8) : 0];
  // 階段口（跨線橋・地下道への降り口）の位置: 駅舎の反対側の少し内側。構成が無い駅は従来どおり対向側ホームだけ（len の 18%）
  const linkZ = endPos === 'namba' ? bzs[0] - bwU / 2 - 14 : endPos === 'wakayama' ? bzs[0] + bwU / 2 + 14 : endPos === 'ends' ? 0 : len * .18;
  const drawStairs = (!stc && opt.minimal) || (!!stc && link === 'underpass');
  if (!opt.minimal) {
  const pz = bzs.reduce((q, w) => q + w, 0) / bzs.length;
  b.add('body', P.plane, M(X(-21), .04, pz, 0, 28, len * .9, 1, -Math.PI / 2), 0x6a6c70); // 広場の舗装
  for (let z = -len * .3; z < len * .3; z += 3) box(-28, .06, z, 4.5, .02, .1, 0xeeeeee); // 駐車枠
  for (const bz of bzs) {
    if (wood) {
      // 洋風木造駅舎（淡輪: 1925年竣工。屋根は黒）
      b.add('body', P.boxB, M(X(bx), 0, bz, 0, bd - 1, 4.6, bwU), 0xe6dcc2);
      b.add('body', P.gable, M(X(bx), 4.6, bz, 0, bd + 1.2, 2.6, bwU + 1.2), 0x2a2c30);
      box(bx - (bd - 1) / 2 - .02, 1.7, bz, .04, 2.6, 6, 0x2b343d); // 出入口
      for (let z = -bwU / 2 + 2.5; z < bwU / 2 - 1; z += 3.4) if (Math.abs(z) > 3.2) box(bx - (bd - 1) / 2 - .02, 2.6, bz + z, .04, 1.3, 1.6, 0x2b343d);
      continue;
    }
    b.add('body', P.boxB, M(X(bx), 0, bz, 0, bd, 7.5, bwU), 0xe8e4da);
    box(bx, 7.75, bz, bd + .6, .5, bwU + .6, 0x6b7680);
    box(bx - bd / 2 - .02, 2.0, bz, .04, 3.2, Math.min(8, bwU - 4), 0x2b343d); // 出入口ガラス
    box(bx - bd / 2 - 1.2, 3.8, bz, 2.4, .15, Math.min(10, bwU - 3), 0x8a9096); // 庇
    for (let z = -bwU / 2 + 2; z < bwU / 2 - 1; z += 3.2) if (Math.abs(z) > 5 || bwU < 18) box(bx - bd / 2 - .02, 5.4, bz + z, .04, 1.3, 2, 0x2b343d);
  }
  // 広場の人・タクシー・バス停
  for (let k = 0; k < 10; k++) person(b, rnd, X(-(14 + rnd() * 12)), pz + (rnd() - .5) * 40, rnd() * 6);
  for (const z of [-14, -9]) {
    b.add('body', P.boxB, M(X(-25), .25, pz + z, 0, 1.7, .7, 4.4), 0xd8c020);
    b.add('body', P.boxB, M(X(-25), .95, pz + z + .2, 0, 1.5, .55, 2.2), 0xd8c020);
    box(-25, 1.25, pz + z + .2, 1.52, .4, 2.0, 0x2a333c);
    box(-25, 1.6, pz + z + .3, .3, .15, .5, 0xf4f4f4);
  }
  box(-20, 1.3, pz + 14, .1, 2.6, .1, 0x777777); box(-20, 2.5, pz + 14, .05, .5, .5, 0x2a7ab8);
  // 駐輪場
  box(-12, 2.1, pz - len * .3, 3, .06, 14, 0x9aa4ae);
  for (let z = pz - len * .3 - 6; z < pz - len * .3 + 6; z += .6) box(-12, .5, z, 1.6, .9, .05, [0x333333, 0x9a2a2a, 0x2a4a8a, 0xcccccc][Math.floor(rnd() * 4)]);
  }
  if (!gy && drawStairs) {
    // 跨線橋・地下道の階段口（簡易）。跨線橋の階段室と橋は buildFootbridge
    box(-4.6, 2.3, linkZ, 2.2, 2.4, 9, 0xd8d4ca);
    box(-4.6, 3.6, linkZ, 2.6, .2, 9.6, 0x6b7680);
  }
  b.parent = null;
  if (gy) {
    // 高架駅のホーム: 高架の外側に張り出した床（支柱付き）
    box(-4.1, -.2, 0, 5, .5, len, 0xb9b5ac);
    for (let z = -len / 2 + 5; z < len / 2; z += 15) box(-5.4, gy / 2 - .2, z, .7, -gy, .7, 0xb9b5ac);
  }
  b.build({ body: bodyMat }, grp);

  // 駅名標（ホーム）・駅舎の看板
  // 板の表の右は、左側ホーム（sx = 1）では進行方向（次の駅）、右側ホームでは後ろ（前の駅）を向く
  const tex = sx > 0 ? nameTex(sta, prevName, nextName) : nameTex(sta, nextName, prevName);
  const signMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .05 });
  for (const z of signs) {
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.0), signMat);
    bb.position.set(X(-4.0), 3.0, z); bb.rotation.y = sx * (Math.PI / 2 - 0.55); grp.add(bb);
  }
  const bTex = canvasTex(1024, 192, (g, w, h) => {
    g.fillStyle = '#1d2a5a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = `800 120px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sta.name + '駅', w / 2, h / 2 + 6);
  });
  const bsMat = new THREE.MeshLambertMaterial({ map: bTex, emissive: 0xffffff, emissiveMap: bTex, emissiveIntensity: .05 });
  // 駅舎の正面看板（広場側）と線路側
  if (!opt.minimal) {
  const front = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), bsMat);
  front.position.set(X(bx - bd / 2 - .05), (wood ? 5.0 : 6.4) + gy, bzs[0]); front.rotation.y = -sx * Math.PI / 2; grp.add(front);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), bsMat);
  back.position.set(X(bx + bd / 2 + .05), (wood ? 5.0 : 6.4) + gy, bzs[0]); back.rotation.y = sx * Math.PI / 2; grp.add(back);
  }

  onLight(ctx, f => { signMat.emissiveIntensity = bsMat.emissiveIntensity = .05 + f * .75; });
  return grp;
}

/** 島式ホーム（幅 PW、両側に線路）。lat = ホーム中心の横位置。駅名標は rev で前後を入れ替え（対向側） */
const PW0 = 6;
export function buildIsland(ctx: GameContext, sta: Station, prevName: string, nextName: string, lat: number, PW = PW0,
  opt: { /** 跨線橋への階段口 */ stairs?: boolean; /** 上屋の長さ（ホーム長に対する割合） */ roof?: number; /** 屋内式の駅: ホーム上屋と柱を作らない（大屋根が覆う。world/indoor-station.ts） */ indoor?: boolean } = {}): THREE.Group {
  const { rng: rnd, track } = ctx;
  const s0 = sta.platform.from, s1 = sta.platform.to;
  const len = s1 - s0, sc = (s0 + s1) / 2, t = track.trackAt(sc);
  const grp = new THREE.Group(); grp.position.copy(track.at(sc, lat, 0)); grp.rotation.y = -t.phi; ctx.scene.add(grp);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(PW, 1.1, len), platMat); plat.position.set(0, .55, 0); grp.add(plat);
  const b = new GeoBatch();
  const arch = architectureOf(sta.name);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: number) => b.add('body', P.box, M(x, y, z, 0, w, h, d), col);
  for (const sx of [-1, 1]) {
    const e = sx * PW / 2;
    box(e - sx * .7, 1.11, 0, .3, .02, len, 0xf2c200); // 点字ブロック
    box(e - sx * .12, 1.115, 0, .25, .03, len, 0xf4f4f4); // 白線
    box(e - sx * .02, .9, 0, .06, .3, len, 0x9a968c);
  }
  // 上屋（中央の柱1列）
  const rl = len * (arch && arch.kind !== 'hall' ? arch.roofRatio : (opt.roof ?? .7));
  if (!opt.indoor && arch?.kind !== 'hall') {
    const roofY = arch ? arch.Yroof : 4.35;
    if (arch?.roofShape) addCanopyRoof(b, 0, PW - .8, rl, arch);
    else {
      box(0, roofY, 0, PW - .8, .14, rl, arch ? arch.roofColor : 0x6b7680);
      box(0, roofY - .13, 0, PW - 1, .12, rl, 0xdcdcd8);
    }
    if (arch) addCanopyBraces(b, 0, PW - 1.2, rl, arch);
    for (const sx of [-1, 1]) box(sx * (PW / 2 - .45), roofY - .2, 0, .1, .35, rl, arch ? arch.roofColor : 0x6b7680);
    for (let z = -rl / 2 + 4; z <= rl / 2 - 4; z += arch ? arch.supportSpacing : 10) {
      box(0, roofY - 1.7, z, .22, 3.1, .22, arch ? arch.supportColor ?? 0x8a9096 : 0x8a9096);
      box(0, roofY - .25, z, PW - 1.2, .16, .14, arch ? arch.supportColor ?? 0x8a9096 : 0x8a9096);
    }
  }
  // ベンチ（背中合わせ）・自販機・時計
  for (let z = -rl / 2 + 8; z <= rl / 2 - 8; z += 16) for (const sx of [-1, 1]) {
    box(sx * .55, 1.55, z, .45, .06, 2.2, 0x2a6aa8); box(sx * .32, 1.85, z, .06, .45, 2.2, 0x2a6aa8);
  }
  for (const z of [-rl / 2 + 3, rl / 2 - 14]) b.add('body', P.boxB, M(0, 1.1, z, 0, .95, 1.83, .7), [0xc8282a, 0x2a5fb0][z < 0 ? 0 : 1]);
  box(0, 3.7, 6, .5, .5, .1, 0x222222);
  const signs: number[] = [-len * .3, len * .3];
  for (const z of signs) for (const dz of [-1.5, 1.5]) box(0, 1.9, z + dz, .08, 1.6, .08, 0x777d84);
  // 階段口（跨線橋へ。ホーム中央）
  if (opt.stairs ?? true) {
    box(0, 1.6, 0, 2.6, 1.0, 14, 0xd8d4ca);
    for (const sx of [-1, 1]) box(sx * 1.32, 2.6, 0, .06, 1.0, 14, 0x9aa0a6);
  }
  // 人（両側の乗車位置付近）
  for (let k = 0; k < 26; k++) {
    const z = (rnd() - .5) * len * .8, sx = rnd() < .5 ? -1 : 1;
    if (Math.abs(z) < 8) continue;
    b.parent = new THREE.Matrix4().makeTranslation(0, 1.1, 0);
    // 人の腕・かばんまで黄色線の内側。狭いホームも幅に追従する。
    person(b, rnd, sx * Math.min(1.0 + rnd(), Math.max(0, PW / 2 - 1)), z, rnd() < .7 ? (sx > 0 ? -Math.PI / 2 : Math.PI / 2) : rnd() * 6);
    b.parent = null;
  }
  b.build({ body: bodyMat }, grp);
  // 左（-X）を向く面は表の右が後ろ（前の駅）、右（+X）を向く面は表の右が進行方向（次の駅）
  const tex = nameTex(sta, nextName, prevName), tex2 = nameTex(sta, prevName, nextName);
  const signMats = [tex, tex2].map(tx => new THREE.MeshLambertMaterial({ map: tx, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: .05 }));
  for (const z of signs) for (const [k, sx] of [[0, -1], [1, 1]] as const) {
    // 進行方向から読めるよう両面を少し線路側へ向ける（左側の線路 = 下り側の駅名標）
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.0), signMats[k]);
    bb.position.set(sx * .05, 3.0, z); bb.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2; grp.add(bb);
  }
  onLight(ctx, f => { for (const m of signMats) m.emissiveIntensity = .05 + f * .75; });
  return grp;
}

/** 島式駅の駅舎（自線側の最も外の線路 loopLat の外）と跨線橋。centers = 跨線橋が階段でつながる島式ホームの中心の横位置。compact = 駅舎・広場を小さくする（島式1面2線） */
function buildIslandConcourse(ctx: GameContext, sta: Station, loopLat: number, centers: number[], compact = false): void {
  if (sta.elevated) { buildElevatedConcourse(ctx, sta, centers, loopLat, { noScreen: sta.indoor }); return; }
  const { track } = ctx;
  const sc = (sta.platform.from + sta.platform.to) / 2, t = track.trackAt(sc);
  const grp = new THREE.Group(); grp.position.copy(track.at(sc, 0, 0)); grp.rotation.y = -t.phi; ctx.scene.add(grp);
  const b = new GeoBatch();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: number) => b.add('body', P.box, M(x, y, z, 0, w, h, d), col);
  // 駅舎（外側の線路の外、2階で跨線橋につながる）
  const bd = compact ? 10 : 12, bw = compact ? 22 : 24, bx = loopLat - (compact ? 2.8 : 3.2) - bd / 2, plazaW = compact ? 16 : 24;
  b.add('body', P.boxB, M(bx, 0, 0, 0, bd, 11.5, bw), 0xe8e4da);
  box(bx, 11.75, 0, bd + .6, .5, bw + .6, 0x6b7680);
  box(bx - bd / 2 - .02, 2.0, 0, .04, 3.2, 8, 0x2b343d);
  box(bx - bd / 2 - 1.2, 3.8, 0, 2.4, .15, 10, 0x8a9096);
  for (let z = -bw / 2 + 2; z < bw / 2 - 1; z += 3.2) if (Math.abs(z) > 5) box(bx - bd / 2 - .02, 8.5, z, .04, 1.6, 2, 0x2b343d);
  b.add('body', P.plane, M(bx - bd / 2 - plazaW / 2, .04, 0, 0, plazaW, 60, 1, -Math.PI / 2), 0x6a6c70);
  // 跨線橋（駅舎 → 両方の島式ホーム。架線の上を通す）
  const x0 = bx + bd / 2, x1 = centers[centers.length - 1] + 2, yb = 8.4, w = 4;
  box((x0 + x1) / 2, yb + 1.5, 0, x1 - x0, 3, w, 0xdedad0); // 通路
  box((x0 + x1) / 2, yb + 3.1, 0, x1 - x0 + .4, .2, w + .4, 0x6b7680); // 屋根
  for (let x = x0 + 2; x < x1; x += 2.2) for (const sz of [-1, 1]) box(x, yb + 1.9, sz * (w / 2 + .01), 1.6, .9, .02, 0x2b343d); // 窓
  // 階段（島式ホームの階段口から上がる）と橋脚
  for (const c of centers) {
    box(c, (1.1 + yb) / 2 + .6, 0, 2.6, yb - 1.1, 3, 0xd8d4ca);
    for (const sz of [-1, 1]) box(c, yb / 2, sz * (w / 2 - .2), .4, yb, .4, 0x9aa0a6);
  }
  for (const x of [x1 - .3]) for (const sz of [-1, 1]) box(x, yb / 2, sz * (w / 2 - .2), .4, yb, .4, 0x9aa0a6);
  b.build({ body: bodyMat }, grp);
  const bTex = canvasTex(1024, 192, (g, w2, h) => {
    g.fillStyle = '#1d2a5a'; g.fillRect(0, 0, w2, h);
    g.fillStyle = '#fff'; g.font = `800 120px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sta.name + '駅', w2 / 2, h / 2 + 6);
  });
  const bsMat = new THREE.MeshLambertMaterial({ map: bTex, emissive: 0xffffff, emissiveMap: bTex, emissiveIntensity: .05 });
  for (const [x, ry] of [[bx - bd / 2 - .05, -Math.PI / 2], [(x0 + x1) / 2, 0]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), bsMat);
    if (ry === 0) { m.position.set(x, yb + 4.1, 0); m.rotation.y = Math.PI; m.scale.set(.8, .8, 1); }
    else { m.position.set(x, 10, 0); m.rotation.y = ry; }
    grp.add(m);
  }
  onLight(ctx, f => { bsMat.emissiveIntensity = .05 + f * .75; });
}

/** 跨線橋（地上駅）: 階段室（各ホーム）と、線路・架線の上を渡る屋根つきの通路。lats = つなぐホームの中心の横位置。位置はホーム中央（駅舎の位置に応じてずらす） */
export function buildFootbridge(ctx: GameContext, sta: Station, lats: number[]): void {
  const { track } = ctx;
  const lo = Math.min(...lats) - 1.4, hi = Math.max(...lats) + 1.4;
  const sc = (sta.platform.from + sta.platform.to) / 2, len = sta.platform.to - sta.platform.from;
  const e = sta.structure?.end;
  const z = e === 'namba' ? len * .25 : e === 'wakayama' ? -len * .25 : 0;
  const s = sc - z, t = track.trackAt(s);
  const grp = new THREE.Group(); grp.name = 'footbridge'; grp.position.copy(track.at(s, 0, 0)); grp.rotation.y = -t.phi; ctx.scene.add(grp);
  const b = new GeoBatch(), yb = 7.6, H = 3.0;
  const box = (x: number, y: number, zz: number, w: number, h: number, d: number, col: number) => b.add('body', P.boxB, M(x, y, zz, 0, w, h, d), col);
  box((lo + hi) / 2, yb, 0, hi - lo, H, 3.4, 0xdedad0); // 通路（壁）
  box((lo + hi) / 2, yb + H, 0, hi - lo + .6, .3, 4.0, 0x6b7680); // 屋根
  for (let x = lo + 2; x < hi - 1; x += 3) b.add('body', P.box, M(x, yb + 1.6, 1.72, 0, 2.0, 1.0, .06), 0x2b343d); // 窓
  for (const l of lats) { // 階段室（ホーム上）
    box(l, 1.1, 0, 3.4, yb - 1.1, 4.2, 0xd8d4ca);
    box(l, yb + .0, 0, 3.8, .3, 4.6, 0x6b7680);
    b.add('body', P.box, M(l, 2.6, 2.12, 0, 2.2, 1.8, .06), 0x2b343d);
  }
  b.build({ body: bodyMat }, grp);
}

export function buildStations(ctx: GameContext): void {
  const st = ctx.route.stations, T = getTerrain(ctx);
  if (ctx.route.theme === 'mountain') { buildMountainStations(ctx); return; }
  st.forEach((sta, i) => {
    const prev = st[i - 1]?.name ?? ctx.route.prevName ?? '';
    const next = st[i + 1]?.name ?? ctx.route.nextName ?? '';
    if (sta.layout === 'custom') { buildCustomStation(ctx, sta, prev, next); return; }
    if (sta.layout === 'hamadera') buildHeritageFacade(ctx, sta);
    buildCoastalSpecialStations(ctx, sta);
    if (sta.layout === 'hamadera') {
      const [izumi, sakai] = coastalThirdTracks(ctx.route, sta);
      // 泉大津方面: 本線と副線の間が島式ホーム（2線）。堺方面: 待避線の外側に片面ホーム。両方向で鏡像の同じ駅。
      buildIsland(ctx, sta, prev, next,
        (izumi.main + izumi.outer) / 2, Math.abs(izumi.outer - izumi.main) - 3.2, { stairs: false });
      buildStation(ctx, sta, prev, next,
        { lat: sakai.outer, side: sakai.outer < sakai.main ? 'L' : 'R', minimal: true });
      return;
    }
    if (sta.island) {
      // 島式1面2線: 下り線と上り線の間に島式ホーム1本（線路は駅の前後で両側へ開く）。幅 = 線間 + 2×spread − 3.4（ホーム端から線路中心 1.7m）
      const L0 = Math.min(...ctx.route.tracks), L1 = Math.max(...ctx.route.tracks), sp = sta.island.spread;
      const mid = (L0 + L1) / 2;
      buildIsland(ctx, sta, prev, next, mid, L1 - L0 + 2 * sp - 3.4);
      buildIslandConcourse(ctx, sta, L0 - sp, [mid], true);
      return;
    }
    if (sta.loop) {
      // 島式2面4線: 自線（本線と待避線の間）と対向線（同）に島式ホーム
      const L1 = Math.max(...ctx.route.tracks), lp = sta.loop.lat;
      buildIsland(ctx, sta, prev, next, lp / 2, PW0, { indoor: sta.indoor });
      // 駅名標の左右は板の向きで決まる（buildIsland / buildStation の中で決める）ので、呼び出しは常に 前の駅・次の駅 の順
      buildIsland(ctx, sta, prev, next, L1 - lp / 2, PW0, { indoor: sta.indoor });
      buildIslandConcourse(ctx, sta, lp, [lp / 2, L1 - lp / 2]);
      return;
    }
    if (sta.layout === 'hagoromo') {
      // 2面3線: 本線の外側に島式ホーム（3番線＝高師浜線との間）、もう一方の本線の外側に片面ホーム。下り・上りで同じ物理配置。
      const h = hagoromoSpec(ctx.route);
      if (h) {
        const sc2 = (sta.platform.from + sta.platform.to) / 2, dy2 = T.groundY(sc2) - T.trackY(sc2);
        buildIsland(ctx, sta, prev, next, h.island, T3_GAP - 3.2, { roof: .8 });
        buildStation(ctx, sta, prev, next, { lat: h.mainOuter, side: h.side < 0 ? 'R' : 'L', minimal: true, elevatedDy: dy2 });
        buildElevatedConcourse(ctx, sta, [h.island, h.mainOuter - h.side * 4.1], -4.3, { noScreen: true });
        return;
      }
    }
    const sc = (sta.platform.from + sta.platform.to) / 2;
    const dy = sta.elevated ? T.groundY(sc) - T.trackY(sc) : 0;
    // 和歌山大学前: 橋上駅舎・駅ビル・駅前は専用モジュール（world/wakayamadaigakumae.ts）が描くので、標準の駅舎・駅前広場は作らない
    // 駅舎の位置（Station.structure）: 下りホーム（左）か上りホーム（右）か、ホームごとか。構成の不明な駅は従来どおり下りホームの中央
    const L1 = Math.max(...ctx.route.tracks), S = sta.structure;
    const fullDown = !S || S.building === 'down' || S.building === 'both', fullUp = !!S && (S.building === 'up' || S.building === 'both');
    buildStation(ctx, sta, prev, next, { elevatedDy: dy, minimal: isDaigakumae(ctx.route.id, sta.name) || !fullDown });
    // 相対式ホーム: 対向線側にもホーム（上りの運転で使う）
    if (L1 > 0) buildStation(ctx, sta, prev, next, { lat: L1, side: sta.platform.side === 'L' ? 'R' : 'L', minimal: !fullUp, elevatedDy: dy, shift: sta.platformOpp });
    if (S?.link === 'footbridge' && L1 > 0) buildFootbridge(ctx, sta, [-4.1, L1 + 4.1]);
  });
  buildIndoorStations(ctx); // 屋内式の駅の大屋根・室内（Station.indoor）
}
