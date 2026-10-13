// 線形データから trackAt(s) を生成する。曲線・勾配は任意個数に対応
import * as THREE from 'three';
import type { Route } from './types';
import { playerPathLat } from './service';

export interface TrackPoint {
  x: number;
  /** 勾配による標高 [m] */
  y: number;
  z: number;
  /** 方位角。0 = -Z 方向、右カーブで増加 */
  phi: number;
  /** 進行方向右向き単位ベクトル */
  rx: number;
  rz: number;
}

export interface Track {
  trackAt(s: number): TrackPoint;
  /** 線路基準の座標 → ワールド座標（lat: 右が正、y: レール面基準ではなく地面基準＋標高） */
  at(s: number, lat: number, y: number): THREE.Vector3;
  /** 勾配 [‰] */
  gradeAt(s: number): number;
  /** 制限速度 [km/h] */
  limitAt(s: number): number;
  /** 線形の総延長 */
  length: number;
  /** 自列車の走行位置の横ずれ（2面4線駅の待避線。種別により変わる） */
  pathLat(s: number): number;
  /** 自列車の走行線基準の座標（lat は走行線からの相対） */
  pathAt(s: number, lat: number, y: number): THREE.Vector3;
}

interface Piece { s0: number; s1: number; x0: number; z0: number; phi0: number; seg: Route['segments'][number] }

export function buildTrack(route: Route): Track {
  // 各要素の始点状態を前計算
  const pieces: Piece[] = [];
  let s = 0, x = 0, z = 0, phi = 0;
  for (const seg of route.segments) {
    const len = seg.type === 'straight' ? seg.length : seg.radius * seg.angle;
    pieces.push({ s0: s, s1: s + len, x0: x, z0: z, phi0: phi, seg });
    const e = evalPiece(pieces[pieces.length - 1], s + len);
    s += len; x = e.x; z = e.z; phi = e.phi;
  }
  const total = s;

  // 勾配を積分した標高テーブル（区間端の標高）
  const grads = [...(route.gradients ?? [])].sort((a, b) => a.from - b.from);
  const elevation = (q: number): number => {
    let y = route.elevation0 ?? 0;
    for (const g of grads) {
      if (q <= g.from) break;
      y += (Math.min(q, g.to) - g.from) * g.permil / 1000;
    }
    return y;
  };

  function trackAt(q: number): TrackPoint {
    let p: { x: number; z: number; phi: number };
    if (q < 0 || !pieces.length) {
      // 始点より手前は初期方位の直線で延長
      p = { x: Math.sin(0) * q, z: -Math.cos(0) * q, phi: 0 };
    } else if (q >= total) {
      const last = pieces[pieces.length - 1], e = evalPiece(last, last.s1), d = q - total;
      p = { x: e.x + Math.sin(e.phi) * d, z: e.z - Math.cos(e.phi) * d, phi: e.phi };
    } else {
      let piece = pieces[0];
      for (const pc of pieces) if (q >= pc.s0) piece = pc; else break;
      p = evalPiece(piece, q);
    }
    return { x: p.x, y: elevation(q), z: p.z, phi: p.phi, rx: Math.cos(p.phi), rz: Math.sin(p.phi) };
  }

  // 重なる制限は低い方（route.limits は種別適用で書き換わる）
  const limitAt = (q: number): number => {
    let v = route.lineLimit;
    for (const L of route.limits) if (q >= L.from && q < L.to && L.kmh < v) v = L.kmh;
    return v;
  };
  const gradeAt = (q: number): number => {
    for (const g of grads) if (q >= g.from && q < g.to) return g.permil;
    return 0;
  };
  const at = (q: number, lat: number, y: number): THREE.Vector3 => {
    const t = trackAt(q);
    return new THREE.Vector3(t.x + t.rx * lat, y + t.y, t.z + t.rz * lat);
  };
  const pathLat = (q: number) => playerPathLat(route, q);
  const pathAt = (q: number, lat: number, y: number) => at(q, lat + pathLat(q), y);
  return { trackAt, at, gradeAt, limitAt, length: total, pathLat, pathAt };
}

function evalPiece(p: Piece, q: number): { x: number; z: number; phi: number } {
  const d = q - p.s0;
  if (p.seg.type === 'straight') {
    return { x: p.x0 + Math.sin(p.phi0) * d, z: p.z0 - Math.cos(p.phi0) * d, phi: p.phi0 };
  }
  // 円弧: 中心は右カーブなら右側、左カーブなら左側
  const R = p.seg.radius, sign = p.seg.turn === 'R' ? 1 : -1;
  const cx = p.x0 + Math.cos(p.phi0) * R * sign, cz = p.z0 + Math.sin(p.phi0) * R * sign;
  const phi = p.phi0 + sign * d / R;
  return { x: cx - Math.cos(phi) * R * sign, z: cz - Math.sin(phi) * R * sign, phi };
}
