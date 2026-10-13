// スカイドーム: グラデーション空 + 太陽(月) + 雲(積雲スプライト・巻雲・層雲) + 星 + 遠景の山並み。カメラに追従（平行移動を無視）
import * as THREE from 'three';
import type { Look } from './look';
import { createCumulusAtlas, CUMULUS_SW } from './clouds';
import { createRidgeTexture } from './ridges';

export interface SkyDome {
  mesh: THREE.Mesh;
  apply(look: Look, fogColor: THREE.Color, time: number, dim?: number): void;
  setOctaves(n: number): void;
}

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww; // 常に最遠
}`;

const frag = /* glsl */`
uniform vec3 uZenith, uHorizon, uFog, uSunDir, uSunColor, uCloudLit, uCloudShade, uAmb, uSunLit;
uniform float uSunSize, uSunDisc, uCover, uStars, uTime, uDim, uMtnVis, uSunLow, uSnow, uCumulus, uCirrus, uStratus;
uniform vec3 uMtnAlb[4];
uniform vec2 uSunH;
uniform float uCoastal;
uniform vec2 uCoastalEast;
uniform sampler2D uRidge, uCumu;
varying vec3 vDir;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 R = mat2(1.6, -1.2, 1.2, 1.6); // 回転 + 拡大（格子の軸が見えないように）
  for (int k = 0; k < OCT; k++) { s += a * noise(p); p = R * p + vec2(1.7, 9.2); a *= 0.5; }
  return s / (1.0 - pow(0.5, float(OCT)));
}
// 巻雲の密度場（方位 az・仰角 el。横に長い筋 + 繊維状のむら + 出る所・出ない所）
float cirrusField(float az, float el) {
  vec2 p = vec2(az * 1.4 + uTime * 0.004, el * 9.0 + az * 0.1);
  p += 0.5 * vec2(noise(p * vec2(0.8, 1.4) + 3.0), noise(p * vec2(0.8, 1.4) + 8.0)) - 0.25;
  float cn = fbm(vec2(p.x * 0.5, p.y * 2.4)) * 0.72 + noise(vec2(p.x * 3.0, p.y * 1.2)) * 0.38;
  float mask = smoothstep(0.3, 0.68, noise(vec2(az * 1.3 + 17.0, el * 4.0)));
  return cn * (0.45 + 0.55 * mask) + (mask - 0.5) * 0.12;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float pixAng = length(fwidth(d));                            // 1 ピクセルの角度（積雲の mip 選択用）
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  // 太陽周辺の散乱光（雲量で弱まる）
  float clear = 1.0 - uCover * 0.85;
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 64.0) * 0.35) * clear * min(uSunDisc, 1.0);
  // 星
  if (uStars > 0.01 && h > 0.0) {
    vec3 sp = d * 260.0; vec3 ip = floor(sp);
    float r = hash3(ip);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
    float star = step(0.9965, r) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5)) * tw;
    col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.0, 0.25, h) * 1.4;
  }
  // 太陽・月の円盤
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.7), sd);
  col += uSunColor * disc * uSunDisc;
  if (h > 0.0) {
    // 巻雲（高層の薄い筋。風向きに引き伸ばし、曇天では隠れる）
    if (uCirrus > 0.01 && h > 0.1) {
      // 方位・仰角の座標で水平方向に引き伸ばす（平面投影だと筋が一点から放射して光線のように見えるため）。方位の継ぎ目は二重サンプルで馴染ませる
      float cel = asin(min(h, 1.0)), caz = atan(d.x, -d.z);
      float cn = cirrusField(caz, cel);
      if (abs(caz) > 2.4) cn = mix(cn, cirrusField(caz - sign(caz) * 6.2831853, cel), 0.5 * smoothstep(2.4, 3.1415927, abs(caz)));
      float ci = smoothstep(0.5, 0.78, cn) * smoothstep(0.12, 0.45, h) * uCirrus * (1.0 - smoothstep(0.4, 0.8, uStratus));
      vec3 cc = mix(uCloudLit, uHorizon, 0.2) + uSunColor * pow(sd, 6.0) * 0.25;
      col = mix(col, cc, ci * 0.5);
    }
    // 層雲（平面投影の fbm。ドメインワープで塊感、太陽側へずらした密度との差で縁を明るく・底を暗く。地平線へ向けて霞む）
    if (uStratus > 0.08) {
      vec2 uv = d.xz / (h + 0.14) * 0.5 + vec2(uTime * 0.006, uTime * 0.0025);
      uv += 0.45 * vec2(noise(uv * 0.9 + 4.0), noise(uv * 0.9 + 11.0)) - 0.2;
      float n = fbm(uv);
      float th0 = mix(0.84, -0.2, uStratus), th1 = th0 + 0.3;
      float c = smoothstep(th0, th1, n);
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.1;
      float n2 = fbm(uv + toSun);
      float rim = clamp((n - n2) * 4.0, -1.0, 1.0);            // 太陽に面した縁が正
      float body = smoothstep(th0, th0 + 0.5, n);               // 厚い所ほど 1
      float shade = clamp(0.2 + body * 0.5 - rim * 0.4 + uStratus * 0.25, 0.0, 1.0);
      vec3 cc = mix(uCloudLit, uCloudShade, shade);
      cc += uSunColor * (pow(sd, 8.0) * 0.3 + max(rim, 0.0) * 0.15) * clear;
      float far = 1.0 - smoothstep(0.02, 0.38, h);              // 遠い雲ほど霞んで地平線の色へ
      cc = mix(cc, uFog, far * 0.7);
      col = mix(col, cc, c * smoothstep(0.0, 0.16, h) * 0.96);
    }
    // 積雲（スプライト: 底が平ら・頭がもくもく。仰角 3 帯 × 方位 CU_N 分割の格子に配置。法線と太陽の向きで陰影、薄い所は逆光で透ける）
    if (uCumulus > 0.01) {
      float elv = asin(min(h, 1.0));
      float aN = atan(d.x, -d.z) * (CU_N / 6.2831853) + uTime * 0.0012;
      float c0 = floor(aN);
      float cosElS = sqrt(max(1.0 - uSunDir.y * uSunDir.y, 0.0));
      for (int b = 0; b < 3; b++) {
        float fb = float(b);
        float lo = b == 0 ? 0.12 : b == 1 ? 0.25 : 0.46;
        float hi = b == 0 ? 0.25 : b == 1 ? 0.46 : 0.80;
        if (elv < lo || elv > hi + (0.17 + 0.75 * hi) * 0.7) continue;   // この帯の雲が届かない仰角は飛ばす
        for (int k = -1; k <= 1; k++) {
          float ci = c0 + float(k);
          float cw = mod(ci, CU_N);
          float r0 = hash(vec2(cw, fb + 1.0));
          // 方位ごとの雲量のむら（雲の多い所・切れ間）
          float pcs = 0.25 + 1.5 * noise(vec2(cw * 0.55 + fb * 7.0, 3.0 + fb));
          if (r0 > uCumulus * pcs * (b == 0 ? 0.9 : b == 1 ? 0.75 : 0.5)) continue;
          float r1 = hash(vec2(cw + 17.3, fb + 3.1)), r2 = hash(vec2(cw + 41.7, fb + 9.7));
          float r3 = hash(vec2(cw + 71.1, fb + 5.3)), r4 = hash(vec2(cw + 3.9, fb + 23.9));
          float ca = ci + 0.5 + (r1 - 0.5) * 0.6;
          float e0 = mix(lo, hi, r2);
          float W = (0.17 + 0.75 * e0) * (0.7 + 0.7 * r3);
          float sx = (aN - ca) * (6.2831853 / CU_N) * cos(e0) / W + 0.5;
          float sy = (elv - e0) / (W * 0.5);
          if (sx < 0.0 || sx > 1.0 || sy < 0.0 || sy > 1.0) continue;
          float flip = r3 > 0.5 ? -1.0 : 1.0;
          float fx = flip > 0.0 ? sx : 1.0 - sx;
          float si = floor(r4 * 3.999);
          vec2 uv = vec2(mod(si, 2.0) * 0.5 + clamp(fx, 0.002, 0.998) * 0.5, floor(si * 0.5) * 0.5 + clamp(sy, 0.002, 0.998) * 0.5);
          float lod = min(log2(max(pixAng / (W / CU_TEX), 1.0)), 5.0);
          vec4 s = textureLod(uCumu, uv, lod);
          if (s.r < 0.004) continue;
          float nx = (s.b * 2.0 - 1.0) * flip, ny = s.g * 2.0 - 1.0;
          float nz = sqrt(max(1.0 - nx * nx - ny * ny, 0.0));
          float caz = (ca - uTime * 0.0012) * (6.2831853 / CU_N);
          vec2 cdir = vec2(sin(caz), -cos(caz));                 // 雲の方向（x, z）
          float sunR = dot(uSunH, vec2(cos(caz), sin(caz))) * cosElS;   // 雲から見て太陽が右にある成分
          float sunT = dot(uSunH, cdir) * cosElS;                        // 太陽が雲の向こう側にある成分（逆光）
          float lam = nx * sunR + ny * uSunDir.y - nz * sunT;
          float lit = smoothstep(-0.2, 0.7, lam);
          float thick = s.a;
          vec3 cc = mix(uCloudShade, uCloudLit, lit);
          cc *= 1.0 - 0.16 * thick * (1.0 - lit);                           // 厚い影側は沈める
          float thin = 1.0 - thick;
          cc += uSunColor * (pow(max(sunT, 0.0), 2.0) * thin * 0.55 + pow(sd, 10.0) * thin * 0.4) * clear;  // 逆光の透け・縁の輝き
          float far = 1.0 - smoothstep(0.06, 0.32, elv);                    // 遠い雲ほど霞む
          cc = mix(cc, uFog, far * 0.5);
          col = mix(col, cc, s.r * smoothstep(0.0, 0.07, h) * 0.97);
        }
      }
    }
  }
  // 地平線付近・下半分は霧の色に合わせる
  col = mix(col, uFog, 1.0 - smoothstep(-0.02, 0.1, h));
  // 遠景の山並み（4 層。奥ほど青く霞み、手前ほど緑〜濃い青緑で稜線がはっきり。谷・麓は霧に沈む。斜面は稜線の傾きから疑似陰影）
  if (h < 0.3) {
    float u = atan(d.x, -d.z) * 0.15915494 + 0.5;
    vec4 rg = texture2D(uRidge, vec2(u, 0.5));
    float du = 3.0 / 4096.0;
    vec4 rgL = texture2D(uRidge, vec2(u - du, 0.5)), rgR = texture2D(uRidge, vec2(u + du, 0.5));
    vec2 dn = normalize(d.xz + 1e-5);
    float cosD = dot(dn, uSunH);                                  // 太陽方位との一致度 -1..1
    float sinD = uSunH.y * dn.x - uSunH.x * dn.y;
    float cosEl = sqrt(max(1.0 - uSunDir.y * uSunDir.y, 0.0));
    vec3 L = vec3(sinD * cosEl, uSunDir.y, cosD * cosEl);           // (接線, 上, 奥行き) 座標の太陽方向
    for (int i = 0; i < 4; i++) {
      float ridgeScale = mix(1.0, 0.08, uCoastal);
      float rh = (i == 0 ? rg.x : i == 1 ? rg.y : i == 2 ? rg.z : rg.w) * ridgeScale;
      float t = float(i) / 3.0;
      float cov = smoothstep(0.0, max(fwidth(h) * 1.6, 1e-5) + (1.0 - uMtnVis) * 0.016 * (1.0 - 0.5 * t), rh - h); // 悪天候ほど稜線が滲む
      // 海沿い平地: 東のごく低い遠景だけ。西と線路前後は平らな地平線。
      cov *= mix(1.0, smoothstep(0.35, 0.7, dot(dn, uCoastalEast)), uCoastal);
      if (cov <= 0.0) continue;
      float g = i == 0 ? (rgR.x - rgL.x) : i == 1 ? (rgR.y - rgL.y) : i == 2 ? (rgR.z - rgL.z) : (rgR.w - rgL.w);
      g *= ridgeScale / 0.0092;                                    // 稜線の傾き（高さ / 方位ラジアン）
      float up = clamp((rh - h) / max(rh, 1e-3), 0.0, 1.0);        // 0 = 稜線, 1 = 麓
      float hb = i == 0 ? 0.30 : i == 1 ? 0.17 : i == 2 ? 0.08 : 0.02;
      float haze = hb + (1.0 - uMtnVis) * (1.0 - 0.4 * t);
      haze = mix(haze, max(haze, 0.85), uCoastal);
      haze = clamp(haze + up * up * (0.55 - 0.2 * t), 0.0, 1.0);
      float tex = noise(vec2(u * 1300.0 + float(i) * 31.0, h * 260.0)) * 0.5 + noise(vec2(u * 420.0, h * 90.0 + float(i))) * 0.5;
      vec3 n = normalize(vec3(-g * 0.45, 0.8, -0.6));
      float lam = clamp(dot(n, L) * 0.75 + 0.3, 0.0, 1.0);
      vec3 m = uMtnAlb[i] * (uAmb * 0.8 + uSunLit * lam) * (0.88 + 0.24 * tex);
      m += uSunColor * pow(max(cosD, 0.0), 3.0) * uSunLow * 0.14 * (1.0 - t * 0.3); // 夕・朝は稜線が染まる
      m = mix(m, vec3(0.86, 0.9, 0.96) * (uAmb * 0.8 + uSunLit * (0.3 + 0.5 * lam)), uSnow * smoothstep(0.35, 0.0, up) * 0.85); // 積雪は上部のみ白く
      vec3 hz = uFog + uSunColor * pow(max(cosD, 0.0), 4.0) * uSunLow * 0.2;
      col = mix(col, mix(m, hz, haze), cov);
    }
  }
  col = mix(col, uFog, uDim); // トンネル内
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 山 4 層（奥 → 手前）の地の色。奥ほど青く、手前ほど緑〜濃い青緑 */
const MTN_ALB = [0x5f86bd, 0x437898, 0x2c6d5a, 0x215834].map(h => new THREE.Color(h));
/** 山岳線: 手前の山腹（地形）の奥に見える遠い山並みなので、どの層も霞んだ青灰色 */
const MTN_ALB_MOUNTAIN = [0x7f9cc2, 0x7393b4, 0x6889a8, 0x5f809c].map(h => new THREE.Color(h));
const tmpA = new THREE.Color(), tmpS = new THREE.Color();

export function createSkyDome(scene: THREE.Scene, octaves: number, theme: 'coast' | 'mountain' = 'coast', coastalEast?: THREE.Vector2): SkyDome {
  const atlas = createCumulusAtlas(); // 積雲スプライトはフレームに分割して生成し、できあがったら雲を浮かべる
  let cumulusFade = 0;
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
    uMtnAlb: { value: theme === 'mountain' ? MTN_ALB_MOUNTAIN : MTN_ALB }, uAmb: { value: new THREE.Color() }, uSunLit: { value: new THREE.Color() },
    uCumu: { value: atlas.texture }, uCumulus: { value: 0 }, uCirrus: { value: 0 }, uStratus: { value: 0 },
    uSunH: { value: new THREE.Vector2(0, -1) }, uRidge: { value: createRidgeTexture(theme === 'mountain' ? 1.6 : 1) },
    uMtnVis: { value: 1 }, uSunLow: { value: 0 }, uSnow: { value: 0 },
    uCoastal: { value: coastalEast ? 1 : 0 }, uCoastalEast: { value: coastalEast ?? new THREE.Vector2(1, 0) },
    uSunSize: { value: .04 }, uSunDisc: { value: 1 }, uCover: { value: .3 }, uStars: { value: 0 }, uTime: { value: 0 }, uDim: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    defines: { OCT: octaves, CU_N: '12.0', CU_TEX: CUMULUS_SW.toFixed(1) },
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.name = 'env-sky';
  mesh.userData.noShadow = true;
  scene.add(mesh);
  return {
    mesh,
    apply(look, fogColor, time, dim = 0) {
      uniforms.uDim.value = dim;
      if (!atlas.step(4)) cumulusFade = 0; else cumulusFade = Math.min(1, cumulusFade + .02);
      uniforms.uZenith.value.copy(look.zenith); uniforms.uHorizon.value.copy(look.horizon); uniforms.uFog.value.copy(fogColor);
      uniforms.uSunDir.value.copy(look.sunDir); uniforms.uSunColor.value.copy(look.sunColor);
      uniforms.uCloudLit.value.copy(look.cloudLit); uniforms.uCloudShade.value.copy(look.cloudShade);
      // 山: 環境光(半球光)と直射光（斜面の向きで陰影）に追従、霧・悪天候で霞みが増し見えなくなる
      uniforms.uAmb.value.copy(tmpA.copy(look.hemiSky).multiplyScalar(look.hemiInt * .8));
      uniforms.uSunLit.value.copy(tmpS.copy(look.sunColor).multiplyScalar(look.sunInt * .55));
      uniforms.uMtnVis.value = Math.min(1, Math.max(0, (look.fogFar - 300) / 1800));
      uniforms.uSunH.value.set(look.sunDir.x, look.sunDir.z).normalize();
      uniforms.uSunLow.value = (1 - Math.min(1, Math.max(0, (look.sunDir.y - .05) / .4))) * Math.min(1, look.sunInt / 1.2);
      uniforms.uSnow.value = look.snow;
      uniforms.uSunSize.value = look.sunSize; uniforms.uSunDisc.value = look.sunDisc;
      uniforms.uCover.value = look.cloudCover; uniforms.uCumulus.value = look.cumulus * cumulusFade;
      uniforms.uCirrus.value = look.cirrus; uniforms.uStratus.value = look.stratus;
      uniforms.uStars.value = look.stars; uniforms.uTime.value = time;
    },
    setOctaves(n) { if (mat.defines.OCT !== n) { mat.defines.OCT = n; mat.needsUpdate = true; } },
  };
}
