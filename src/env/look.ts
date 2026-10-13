// 時間帯 × 天候 → 見た目パラメータ（目標値）の算出と補間
import * as THREE from 'three';
import type { EnvState, TimeOfDay } from '../core/events';

/** 補間対象の見た目パラメータ一式 */
export interface Look {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunInt: number;
  /** 空に描く太陽（月）円盤の大きさ [rad] と明るさ */
  sunSize: number;
  sunDisc: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiInt: number;
  zenith: THREE.Color;
  /** 地平線色 = 霧の色 */
  horizon: THREE.Color;
  fogNear: number;
  fogFar: number;
  cloudCover: number;
  /** 雲の種類ごとの量 0..1（積雲・巻雲・層雲）。時間帯・天候で混ざり方が変わる */
  cumulus: number;
  cirrus: number;
  stratus: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  stars: number;
  exposure: number;
  /** 0..1 夜間照明（駅灯・街灯）の点灯度 */
  lamps: number;
  /** 0..1 前照灯の明るさ */
  headlight: number;
  /** 0..1 積雪 */
  snow: number;
  /** 0..1 夜らしさ（街の窓明かり・看板・車両灯具用。ctx.light.night へ反映） */
  night: number;
}

interface TodPreset {
  elev: number; az: number; sunColor: number; sunInt: number; sunSize: number; sunDisc: number;
  hemiSky: number; hemiGround: number; hemiInt: number;
  zenith: number; horizon: number; overcast: number;
  cloudLit: number; cloudShade: number; cumulus: number; cirrus: number; exposure: number; lamps: number; stars: number; fogFar: number; night: number;
}

const DEG = Math.PI / 180;
// az: 0 = 進行方向(-Z)、正で右(+X)
const TOD: Record<TimeOfDay, TodPreset> = {
  morning: { elev: 14, az: -140, sunColor: 0xffd7aa, sunInt: 1.5, sunSize: .045, sunDisc: 6, hemiSky: 0xd6e2f5, hemiGround: 0x5d6448, hemiInt: .85,
    zenith: 0x5f8fcf, horizon: 0xe9dccb, overcast: 0xa3a6ad, cloudLit: 0xfff0e2, cloudShade: 0x9aa8c4, cumulus: .5, cirrus: .65, exposure: 1.0, lamps: 0, stars: 0, fogFar: 2400, night: .12 },
  noon: { elev: 58, az: 140, sunColor: 0xfff4e0, sunInt: 1.8, sunSize: .04, sunDisc: 6, hemiSky: 0xdfefff, hemiGround: 0x5d6b45, hemiInt: 1.1,
    zenith: 0x3f7fcf, horizon: 0xb9d9f0, overcast: 0xaab0b8, cloudLit: 0xffffff, cloudShade: 0x93a9cc, cumulus: .85, cirrus: .45, exposure: 1.0, lamps: 0, stars: 0, fogFar: 2600, night: 0 },
  evening: { elev: 5, az: 25, sunColor: 0xff9550, sunInt: 1.35, sunSize: .055, sunDisc: 8, hemiSky: 0xf0b898, hemiGround: 0x4a3c34, hemiInt: .6,
    zenith: 0x34457a, horizon: 0xff9c5e, overcast: 0x7c6c6c, cloudLit: 0xffa874, cloudShade: 0x6c5f86, cumulus: .6, cirrus: .8, exposure: 1.05, lamps: .45, stars: .1, fogFar: 2200, night: .65 },
  night: { elev: 40, az: -50, sunColor: 0x8ea4ff, sunInt: .16, sunSize: .025, sunDisc: 1.2, hemiSky: 0x3c5080, hemiGround: 0x15171c, hemiInt: .38,
    zenith: 0x02050d, horizon: 0x0d1630, overcast: 0x14181f, cloudLit: 0x3a4660, cloudShade: 0x0e1220, cumulus: .3, cirrus: .35, exposure: 1.1, lamps: 1, stars: 1, fogFar: 1800, night: 1 },
};

export function createLook(): Look {
  return {
    sunDir: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(), sunInt: 0, sunSize: .04, sunDisc: 1,
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiInt: 0,
    zenith: new THREE.Color(), horizon: new THREE.Color(), fogNear: 250, fogFar: 2600,
    cloudCover: .3, cumulus: 0, cirrus: 0, stratus: 0, cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), stars: 0,
    exposure: 1, lamps: 0, headlight: 0, snow: 0, night: 0,
  };
}

const tmp = new THREE.Color(), tmp2 = new THREE.Color();

/** 時間帯・天候から目標の見た目を計算 */
export function computeLook(st: EnvState, out: Look): Look {
  const T = TOD[st.timeOfDay], i = st.weather === 'clear' ? 0 : st.intensity;
  const night = st.timeOfDay === 'night';
  out.sunDir.set(Math.sin(T.az * DEG) * Math.cos(T.elev * DEG), Math.sin(T.elev * DEG), -Math.cos(T.az * DEG) * Math.cos(T.elev * DEG)).normalize();
  out.sunColor.setHex(T.sunColor); out.sunSize = T.sunSize; out.sunDisc = T.sunDisc;
  out.hemiSky.setHex(T.hemiSky); out.hemiGround.setHex(T.hemiGround);
  out.zenith.setHex(T.zenith); out.horizon.setHex(T.horizon);
  out.cloudLit.setHex(T.cloudLit);
  out.exposure = T.exposure; out.lamps = T.lamps; out.stars = T.stars;
  out.fogNear = 250; out.fogFar = T.fogFar; out.snow = 0; out.night = T.night;

  // 天候: 空の灰色化(gray)・雲量(cover)・霧
  let gray = 0, cover = night ? .2 : .4, oc = 1, cum = T.cumulus, cir = T.cirrus, str = 0;
  switch (st.weather) {
    case 'rain': gray = .6 + .35 * i; cover = .8 + .2 * i; oc = .78; cum = 0; cir = 0; str = .8 + .2 * i;
      out.fogNear = 30; out.fogFar = THREE.MathUtils.lerp(T.fogFar * .5, 450, i); break;
    case 'snow': gray = .55 + .4 * i; cover = .75 + .25 * i; oc = 1.12; cum = 0; cir = 0; str = .8 + .2 * i; out.snow = .45 + .55 * i;
      out.fogNear = 10; out.fogFar = THREE.MathUtils.lerp(900, 220, i); break;
    case 'fog': gray = .75 + .25 * i; cover = .55; oc = 1.06; cum = 0; cir = 0; str = .5;
      out.fogNear = 4; out.fogFar = THREE.MathUtils.lerp(480, 110, i); break;
  }
  const ocCol = tmp.setHex(T.overcast).multiplyScalar(oc);
  out.zenith.lerp(ocCol, gray); out.horizon.lerp(ocCol, gray * .92);
  // 雲の陰: 晴れは時間帯の青み・紫み、悪天候ほど曇天の灰色へ
  out.cloudShade.setHex(T.cloudShade).lerp(tmp2.copy(ocCol).multiplyScalar(st.weather === 'rain' ? .62 : .8), gray);
  out.cloudLit.lerp(ocCol, gray * .6);
  out.cloudCover = cover; out.cumulus = cum; out.cirrus = cir; out.stratus = str;
  out.stars *= 1 - gray;
  out.sunInt = T.sunInt * (1 - gray * .85);
  out.sunDisc = T.sunDisc * (1 - gray * .97);
  out.hemiInt = T.hemiInt * (1 - gray * .2) * (st.weather === 'snow' ? 1.12 : 1);
  out.hemiSky.lerp(ocCol, gray * .5);
  if (out.snow > 0) out.hemiGround.lerp(tmp.setHex(night ? 0x2a2e36 : 0xb8bcc4), out.snow * .7);
  // 悪天候の昼間はやや早めに点灯
  if (gray > 0 && !night) { out.lamps = Math.max(out.lamps, gray * .35); out.night = Math.max(out.night, gray * .3); }
  out.headlight = night ? 1 : st.timeOfDay === 'evening' ? .5 : gray * .3;
  return out;
}

/** a を b へ係数 k で近づける */
export function lerpLook(a: Look, b: Look, k: number): void {
  a.sunDir.lerp(b.sunDir, k).normalize();
  a.sunColor.lerp(b.sunColor, k); a.hemiSky.lerp(b.hemiSky, k); a.hemiGround.lerp(b.hemiGround, k);
  a.zenith.lerp(b.zenith, k); a.horizon.lerp(b.horizon, k); a.cloudLit.lerp(b.cloudLit, k); a.cloudShade.lerp(b.cloudShade, k);
  const L = THREE.MathUtils.lerp;
  a.sunInt = L(a.sunInt, b.sunInt, k); a.sunSize = L(a.sunSize, b.sunSize, k); a.sunDisc = L(a.sunDisc, b.sunDisc, k);
  a.hemiInt = L(a.hemiInt, b.hemiInt, k); a.fogNear = L(a.fogNear, b.fogNear, k); a.fogFar = L(a.fogFar, b.fogFar, k);
  a.cloudCover = L(a.cloudCover, b.cloudCover, k); a.cumulus = L(a.cumulus, b.cumulus, k); a.cirrus = L(a.cirrus, b.cirrus, k); a.stratus = L(a.stratus, b.stratus, k); a.stars = L(a.stars, b.stars, k); a.exposure = L(a.exposure, b.exposure, k);
  a.lamps = L(a.lamps, b.lamps, k); a.headlight = L(a.headlight, b.headlight, k); a.snow = L(a.snow, b.snow, k);
  a.night = L(a.night, b.night, k);
}

export function copyLook(a: Look, b: Look): void { lerpLook(a, b, 1); }
