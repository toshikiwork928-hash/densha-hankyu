// カメラ: 運転台視点（走行揺れ付き）/ 外部視点（俯瞰追従・前方斜め・編成全景）/ リプレイ（沿線カメラの切替演出）
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { loopZone } from '../route/service';
import { TUNNEL_CENTER, getTerrain } from '../world/terrain';
import { isMountain } from '../world/mountain-terrain';

export interface CabCamera {
  update(time: number): void;
}

const CAB_FOV = 58;
/** 運転台: 車体の向きから先の線路の方へ振る角の上限の目安 [rad]（tanh で頭打ち） */
const LOOK_LEAD = THREE.MathUtils.degToRad(6);
/** 沿線カメラの地表からの最低高さ [m] */
const CAM_CLEAR = 1.5;

/** リプレイのショット種別 */
type ShotKind = 'trackside' | 'low' | 'chase' | 'heli' | 'platform';
interface Shot { kind: ShotKind; s: number; lat: number; h: number; t0: number; fov: number }
const SHOT_ORDER: ShotKind[] = ['trackside', 'chase', 'low', 'heli', 'trackside', 'trackside'];

export function createCabCamera(ctx: GameContext): CabCamera {
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const smPos = new THREE.Vector3(), smLook = new THREE.Vector3();
  const bogieA = new THREE.Vector3(), bogieB = new THREE.Vector3();
  const viewDir = new THREE.Vector3(), viewRight = new THREE.Vector3(), viewUp = new THREE.Vector3(), viewPoint = new THREE.Vector3();
  const lat = -.45; // 運転席は左寄り
  const { events, route } = ctx;
  const T0 = getTerrain(ctx), MT = isMountain(T0) ? T0 : null;
  let outsideVariant = 0, prevMode = ctx.cameraMode, snap = true;
  let shot: Shot | null = null, shotN = 0;
  const viewLabel = document.createElement('div');
  viewLabel.className = 'camera-view-label'; viewLabel.hidden = true;
  viewLabel.setAttribute('role', 'status'); document.body.appendChild(viewLabel);

  events.on('cameraMode', ({ mode }) => {
    outsideVariant = mode === 'outside' && prevMode === 'outside' ? (outsideVariant + 1) % 3 : 0;
    prevMode = mode; snap = true; shot = null; shotN = 0;
    viewLabel.hidden = mode !== 'outside';
    viewLabel.textContent = ['俯瞰追従', '前方斜め', '編成全景'][outsideVariant];
    setFov(CAB_FOV);
    document.body.classList.toggle('cam-outside', mode !== 'cab');
    document.body.classList.toggle('cam-replay', mode === 'replay');
  });

  function setFov(f: number) {
    if (Math.abs(ctx.camera.fov - f) < .01) return;
    ctx.camera.fov = f; ctx.camera.updateProjectionMatrix();
  }

  // 曲線・勾配・縦長画面でも、編成の端が画面から切れない距離まで引く。
  function fitFormation(s: number, length: number) {
    viewDir.copy(camPos).sub(camLook);
    let distance = viewDir.length(); viewDir.normalize();
    viewRight.set(0, 1, 0).cross(viewDir).normalize(); viewUp.copy(viewDir).cross(viewRight).normalize();
    const tan = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2));
    for (let i = 0; i <= 4; i++) for (const x of [-1.65, 1.65]) for (const y of [.3, 6.4]) {
      viewPoint.copy(ctx.track.pathAt(s - length * i / 4, x, y)).sub(camLook);
      distance = Math.max(distance, viewPoint.dot(viewDir) + 1.15 * Math.max(
        Math.abs(viewPoint.dot(viewRight)) / (tan * ctx.camera.aspect), Math.abs(viewPoint.dot(viewUp)) / tan));
    }
    camPos.copy(camLook).addScaledVector(viewDir, distance);
  }

  /** 次の停車駅 index（リプレイでは位置から推定） */
  const nearStation = (s: number) => route.stations.find(x => !x.pass && x.stopS - s > 0 && x.stopS - s < 420);

  function nextShot(s: number, v: number, time: number): Shot {
    const L = route.trainLength;
    const sta = nearStation(s);
    if (sta && v > 1) {
      // 島式は線路間、待避線はその外側、棒線駅はホームの側（南海本線は左、山岳線は駅ごと）
      const plat = sta.island ? (Math.min(...route.tracks) + Math.max(...route.tracks)) / 2 + 1 : sta.enterLoop ? (loopZone(sta)?.lat ?? 0) + (sta.loop?.outside ? (sta.loop.lat < 0 ? -4.2 : 4.2) : 4.2) : (sta.platform.side === 'R' ? 1 : -1) * 4.2;
      return { kind: 'platform', s: sta.stopS + 12, lat: plat, h: 2.4, t0: time, fov: 40 };
    }
    const kind = SHOT_ORDER[shotN++ % SHOT_ORDER.length];
    const ahead = Math.max(120, v * 7);
    const side = shotN % 2 ? -1 : 1;
    switch (kind) {
      case 'trackside': {
        const shot: Shot = { kind, s: s + ahead, lat: side * (9 + (shotN % 3) * 4), h: 1.8 + (shotN % 2) * 3, t0: time, fov: 32 };
        // 置けなければ後方追従（トンネルに入っても覆工の内側に収まるよう線路の真上寄り）
        return MT ? fitTrackside(shot) ?? { kind: 'chase', s: 0, lat: TUNNEL_CENTER, h: 4.5, t0: time, fov: 55 } : shot;
      }
      case 'low': return { kind, s: s + ahead * .8, lat: -2.7, h: .5, t0: time, fov: 50 };
      // 山岳線は切土・トンネルが多いので、後方追従は線路の真上寄り（トンネルでも覆工の内側）
      case 'chase': return { kind, s: 0, lat: MT ? TUNNEL_CENTER : side * 6, h: MT ? 4.5 : 5, t0: time, fov: 55 };
      case 'heli': return { kind, s: 0, lat: 40, h: 45, t0: time, fov: 45 };
      default: return { kind: 'chase', s: 0, lat: -L * 0, h: 5, t0: time, fov: 55 };
    }
  }

  /** 山岳線: 沿線カメラを地表（斜面・切土）より上に置き、列車が斜面・建物・木に隠れない側を選ぶ。トンネル内・坑口際や両側とも置けなければ null（別ショット） */
  const ray = new THREE.Raycaster(), rayFrom = new THREE.Vector3(), rayTo = new THREE.Vector3();
  function fitTrackside(shot: Shot): Shot | null {
    const T = MT!;
    if (T.structureAt(shot.s, 25)?.kind === 'tunnel') return null;
    const y0 = T.trackY(shot.s);
    ray.camera = ctx.camera; // Sprite の判定に要る
    const near = Math.sign(shot.lat) * 9;
    for (const lat of new Set([shot.lat, -shot.lat, near, -near])) {
      const g = T.terrainY(shot.s, lat);
      const h = Math.max(shot.h, g + CAM_CLEAR - y0);
      if (h > shot.h + 8) continue; // 法面の上に高く持ち上がる側は避ける
      // 見通し: 近づく列車（後方）〜通過後（前方）の線路との間に地表・建物・木が無いこと
      let clear = true;
      for (const ds of [-60, 0, 30]) {
        for (let k = 1; k < 6 && clear; k++) {
          const u = k / 6, q = shot.s + ds * u, l = lat * (1 - u);
          const yl = y0 + h + (T.trackY(shot.s + ds) + 2 - y0 - h) * u;
          if (T.terrainY(q, l) > yl - .3) clear = false;
        }
        if (!clear) break;
        rayFrom.copy(ctx.track.at(shot.s, lat, h)); rayTo.copy(ctx.track.pathAt(shot.s + ds, 0, 2)).sub(rayFrom);
        const d = rayTo.length();
        ray.set(rayFrom, rayTo.normalize()); ray.far = Math.max(0, d - 4);
        if (ray.intersectObjects(ctx.scene.children, true).some(hit => (hit.object as THREE.Mesh).isMesh)) clear = false;
        if (!clear) break;
      }
      if (clear) return { ...shot, lat, h };
    }
    return null;
  }

  function updateReplay(s: number, v: number, time: number) {
    // 列車に追従するショットは自列車の走行線（待避線）基準
    const L = route.trainLength, at = ctx.track.at, pat = ctx.track.pathAt;
    const dur = time - (shot?.t0 ?? 0);
    const fixedPassed = shot && (shot.kind === 'trackside' || shot.kind === 'low' || shot.kind === 'platform') && s - L > shot.s + 10;
    const moveDone = shot && (shot.kind === 'chase' || shot.kind === 'heli') && dur > 7;
    const stalled = shot && dur > 14;
    if (!shot || fixedPassed || moveDone || stalled) { shot = nextShot(s, v, time); snap = true; }
    setFov(shot.fov);
    const mid = s - L * .35;
    switch (shot.kind) {
      case 'trackside': case 'low': case 'platform':
        camPos.copy(shot.kind === 'low' ? pat(shot.s, shot.lat, shot.h) : at(shot.s, shot.lat, shot.h));
        camLook.copy(pat(Math.min(s - 10, shot.s + 30), 0, 2));
        break;
      case 'chase':
        camPos.copy(pat(s - L - 28, shot.lat, shot.h));
        camLook.copy(pat(s + 40, 0, 1.5));
        break;
      case 'heli': {
        const a = dur * .12;
        const hs = mid + Math.cos(a) * 60, hl = shot.lat + Math.sin(a) * 20;
        camPos.copy(pat(hs, hl, shot.h));
        // 山岳線: 山腹・尾根より上を回る
        if (MT) camPos.y = Math.max(camPos.y, MT.terrainY(hs, ctx.track.pathLat(hs) + hl) + 6);
        camLook.copy(pat(mid, 0, 1));
        break;
      }
    }
  }

  const cam: CabCamera = {
    update(time) {
      // 自列車の走行線（2面4線駅では待避線）に沿う
      const { s, v } = ctx.state.train, at = ctx.track.pathAt, mode = ctx.cameraMode;
      const L = route.trainLength;
      if (mode === 'cab') {
        const shake = Math.min(1, v / 22);
        camPos.copy(at(s, lat, 3.0));
        camPos.y += Math.sin(time * 11.3) * .006 * shake + Math.sin(time * 3.1) * .012 * shake;
        // 向きは車体（台車の並び = 先頭の 3m・17m 後ろの台車を結ぶ向き）を基準に、先の線路（60m 先）の方へ少しだけ振る。
        // 振り幅は LOOK_LEAD で頭打ち（急曲線 R100〜200 で 60m 先を直接見ると車体から 15〜20° ずれ、首振りが速く大きい。
        // 南海本線の R500 以上では 3〜4° 程度で従来とほぼ同じ）。上下は従来どおり 60m 先の線路。
        // 待避線の分岐器では注視点を先の線路に合わせず、現在の横ずれの傾きで延長する（車体の向きも台車の並びなので横ずれを含む）
        const pl = ctx.track.pathLat(s), slope = (ctx.track.pathLat(s - 3) - ctx.track.pathLat(s - 17)) / 14;
        camLook.copy(ctx.track.at(s + 60, pl + slope * 60 + lat * .3, 2.4));
        bogieA.copy(at(s - 3, 0, 0)); bogieB.copy(at(s - 17, 0, 0));
        const bodyYaw = Math.atan2(bogieA.x - bogieB.x, bogieA.z - bogieB.z);
        const dx = camLook.x - camPos.x, dz = camLook.z - camPos.z, dh = Math.hypot(dx, dz);
        const lead = Math.atan2(dx, dz) - bodyYaw, d = Math.atan2(Math.sin(lead), Math.cos(lead));
        const yaw = bodyYaw + LOOK_LEAD * Math.tanh(d / LOOK_LEAD) + Math.sin(time * 2.3) * .001 * shake;
        camLook.set(camPos.x + Math.sin(yaw) * dh, camLook.y, camPos.z + Math.cos(yaw) * dh);
        ctx.camera.position.copy(camPos);
        ctx.camera.lookAt(camLook);
        return;
      }
      if (mode === 'outside') {
        // ホームと駅舎は進行左側にあるので、外部視点は線路間〜右側から撮る（屋根・駅舎で列車が隠れないように）
        if (outsideVariant === 0) { // 後方斜め上から追従
          camPos.copy(at(s - L - 16, 2.2, 6));
          camLook.copy(at(s + 30, 0, 1.5));
        } else if (outsideVariant === 1) { // 顔と側面を見る。街側へ出ず、屋根の上から先頭車を撮る。
          setFov(45);
          camPos.copy(at(s + 26, 7.5, 10));
          camLook.copy(at(s - 10, 0, 2.4));
        } else { // 先頭斜め上から編成全体。車両数に合わせて引き、駅の屋根より高く撮る。
          setFov(50);
          camPos.copy(at(s + 24 + L * .25, THREE.MathUtils.clamp(L * .22, 18, 32), Math.max(56, L * .85)));
          camLook.copy(at(s - L * .48, 0, 2));
          fitFormation(s, L);
        }
      } else updateReplay(s, v, time);
      // 追従系はなめらかに（切替直後は即時）
      const k = snap ? 1 : mode === 'replay' && shot && (shot.kind === 'trackside' || shot.kind === 'low' || shot.kind === 'platform') ? 1 : .15;
      smPos.lerp(camPos, k); smLook.lerp(camLook, k);
      if (snap) { smPos.copy(camPos); smLook.copy(camLook); snap = false; }
      ctx.camera.position.copy(smPos);
      ctx.camera.lookAt(smLook);
    },
  };
  return cam;
}
