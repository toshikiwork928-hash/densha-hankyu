// 線路脇の標識（route.signs から生成）。速度制限・制限解除は種別（編成長・分岐器）ごとに route.limits から作り直す
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Sign } from '../route/types';
import { limitTex, postMat, textBoard } from './canvas-tex';
import { cullByDistance } from './cull';
import { trackLines } from '../route/service';
import { loopTracks } from './track-mesh';
import { coastalThirdTracks } from './coastal-stations';

export function addSign(ctx: GameContext, tex: THREE.Texture, s: number, lat: number, w: number, h: number, y: number, yaw = 0, parent: THREE.Object3D = ctx.scene): THREE.Group {
  const t = ctx.track.trackAt(s), grp = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
  board.position.y = y; grp.add(board);
  const ph = y - h / 2, post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, ph, 6), postMat);
  post.position.y = ph / 2; grp.add(post);
  grp.position.copy(ctx.track.at(s, lat, 0)); grp.rotation.y = -t.phi + yaw;
  parent.add(grp);
  cullByDistance(ctx, grp, 800);
  return grp;
}

/** 標識1枚の配置情報。lat は走行線（lat0）からではなく線路基準の横位置 */
interface Def { s: number; lat: number; w: number; h: number; y: number; tex: () => THREE.Texture; pri: number; parent: THREE.Object3D }

/** 近接とみなす前後方向の距離 [m]。この範囲で横位置が重なる標識は外側へずらす（運転台からも重なって見えない） */
const NEAR_S = 14;
/** 標識どうしの横方向の最小すき間 [m] */
const GAP = .35;

/** lat0 = 標識を立てる線路の横位置（待避線では横にずれる）。配置は place() が重なりを避けて決める */
function define(sg: Sign, lat0: number, parent: THREE.Object3D): Def {
  switch (sg.kind) {
    case 'limit': {
      const k = sg.size ?? 1.0;
      return { s: sg.s, lat: lat0 + (sg.lat ?? -2.2), w: k, h: k, y: sg.y ?? 3.0, tex: () => limitTex(sg.kmh), pri: 2, parent };
    }
    case 'limitEnd':
      return { s: sg.s, lat: lat0 + (sg.lat ?? -2.2), w: .9, h: .9, y: 3.0, tex: () => textBoard([{ t: '制限' }, { t: '解除' }], '#fff', '#e8502a', 256, 256, 80), pri: 3, parent };
    case 'limitNotice':
      // 黄地に黒の数字、下に「予告」
      return { s: sg.s, lat: lat0 + (sg.lat ?? -2.2), w: .85, h: 1.0, y: 3.0, tex: () => textBoard([{ t: sg.kmh, size: 120 }, { t: '予告', size: 46 }], '#ffd21a', '#111', 256, 300), pri: 4, parent };
    case 'distance':
      return { s: sg.s, lat: lat0 + (sg.lat ?? -2.0), w: .7, h: .7, y: sg.meters >= 200 ? 2.2 : 2.9, tex: () => textBoard([{ t: sg.meters, size: 120 }], '#fff', '#111'), pri: 1, parent };
    case 'stopMarker':
      // 6両と8両は先頭が同じ位置に止まる（ホームは 200m）
      return { s: sg.s, lat: lat0 + (sg.lat ?? -2.0), w: .9, h: 1.05, y: 3.0, tex: () => textBoard([{ t: sg.cars === 6 ? '6・8' : String(sg.cars), size: sg.cars === 6 ? 100 : 150 }, { t: '停止位置', size: 34 }], '#1b4fd1', '#fff', 256, 300), pri: 0, parent };
  }
}

/** 標識を立てる。優先度の高いもの（停止位置目標 → 距離標 → 速度制限 → 解除 → 予告）から順に、前後 NEAR_S 以内で横に重なる標識があれば
 *  外側（走行線から離れる向き）へ横にずらす。標識の向きは走行線の接線に直角（待避線の S字区間でも正対する） */
function place(ctx: GameContext, defs: Def[], base: (d: Def) => number): void {
  const placed: { s: number; lat: number; w: number }[] = [];
  const rails = trackLines(ctx.route), loops = loopTracks(ctx);
  const thirds = ctx.route.stations.flatMap(st => coastalThirdTracks(ctx.route, st));
  for (const d of [...defs].sort((a, b) => a.pri - b.pri || a.s - b.s)) {
    const dir = d.lat >= base(d) ? 1 : -1;
    let lat = d.lat;
    for (let k = 0; k < 32; k++) {
      // 板幅を含む離隔を全線で確認。分岐部で隣の待避線へ押し込まない。
      const centers = [
        ...rails.filter(l => d.s >= l.from && d.s <= l.to).map(l => l.lat(d.s)),
        ...loops.filter(l => d.s >= l.z.inFrom && d.s <= l.z.outTo).map(l => l.lat(d.s)),
        ...thirds.filter(l => d.s >= l.from && d.s <= l.to).map(l => l.lat(d.s)),
      ];
      const rail = centers.find(c => Math.abs(c - lat) < 2.05 + d.w / 2 - 1e-7);
      if (rail !== undefined) { lat = rail + dir * (2.05 + d.w / 2); continue; }
      const hit = placed.find(p => Math.abs(p.s - d.s) < NEAR_S && Math.abs(p.lat - lat) < (p.w + d.w) / 2 + GAP);
      if (!hit) break;
      lat = hit.lat + dir * ((hit.w + d.w) / 2 + GAP);
    }
    placed.push({ s: d.s, lat, w: d.w });
    // 走行線の進行方向（S字区間では接線が線路方向と異なる）に直角に立てる
    const slope = (ctx.track.pathLat(d.s + 1) - ctx.track.pathLat(d.s - 1)) / 2;
    addSign(ctx, d.tex(), d.s, lat, d.w, d.h, d.y, -Math.atan(slope), d.parent);
  }
}

function clear(group: THREE.Group): void {
  for (const c of [...group.children]) {
    group.remove(c);
    c.traverse(o => { if (o instanceof THREE.Mesh && o.material !== postMat) { (o.material as THREE.MeshBasicMaterial).map?.dispose(); (o.material as THREE.Material).dispose(); o.geometry.dispose(); } });
  }
}

export function buildSigns(ctx: GameContext): void {
  const { route, track, events } = ctx;
  const stopGroup = new THREE.Group(); stopGroup.name = 'stopSigns'; ctx.scene.add(stopGroup);
  const group = new THREE.Group(); group.name = 'limitSigns'; ctx.scene.add(group);
  if (!route.services) {
    place(ctx, route.signs.map(sg => define(sg, 0, ctx.scene)), () => 0);
    return;
  }
  // 停止位置と制限の標識は同じ並びで重なりを判定するため、まとめて作り直す
  let built = '';
  const rebuild = () => {
    const key = route.stations.map(x => `${x.enterLoop ? 1 : 0}`).join('') + ':' + (ctx.service?.cars ?? 0) + ':' + route.lineLimit + ':' + route.limits.map(L => `${L.from}-${L.to}-${L.kmh}`).join() + ':' + JSON.stringify(route.activeLane ?? 0);
    if (key === built) return;
    built = key;
    clear(stopGroup); clear(group);
    const defs: Def[] = [];
    // 距離標・停止位置目標: 自列車の走行線の左（2面4線駅は種別により待避線または本線）。待避線・島式1面2線駅ではホームが右なので、
    // 線路がホーム側へ寄り始めたら（走行線が -1m より左）右に立てる
    for (const sg of route.signs) {
      const lat = track.pathLat(sg.s), rightSta = route.stations.find(x => (x.enterLoop || x.island || (x.layout === 'custom' && x.platform.side === 'R')) && Math.abs(x.stopS - sg.s) < 520);
      defs.push(define(rightSta && (lat < -1 || rightSta.layout === 'custom') ? { ...sg, lat: 2.0 } : sg, lat, stopGroup));
    }
    // 速度制限・解除: 自列車の走行線の左。解除標は、より厳しい制限の中・終着駅より先なら立てない
    const last = route.stations[route.stations.length - 1].stopS;
    // 始発駅を出た所の線区最高速度（種別ごと）
    defs.push(define({ kind: 'limit', s: route.startS + 60, kmh: route.lineLimit, size: .9 }, 0, group));
    for (const L of route.limits) {
      defs.push(define({ kind: 'limit', s: L.from, kmh: L.kmh }, track.pathLat(L.from), group));
      // 予告標: 制限の 400m 手前（より厳しい制限の中や始発駅の手前には立てない）
      const ns = L.from - 400;
      const covered = route.limits.some(o => o !== L && o.kmh <= L.kmh && ns >= o.from && ns < o.to);
      if (!covered && ns > route.startS + 80) defs.push(define({ kind: 'limitNotice', s: ns, kmh: L.kmh }, track.pathLat(ns), group));
      const inner = route.limits.some(o => o !== L && o.kmh <= L.kmh && L.to > o.from && L.to < o.to);
      if (!inner && L.to < last) defs.push(define({ kind: 'limitEnd', s: L.to }, track.pathLat(L.to), group));
    }
    place(ctx, defs, d => track.pathLat(d.s));
  };
  rebuild();
  events.on('serviceChange', rebuild);
  events.on('reset', rebuild);
}
