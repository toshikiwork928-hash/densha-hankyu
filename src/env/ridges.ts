// 遠景の山並みの稜線データ: 方位ごとの稜線の高さ（d.y = 仰角の sin）を 4 層ぶん RGBA の 1 次元テクスチャに事前生成。
// スカイドームのシェーダが参照して描く（描画コール・三角形の追加なし）。奥(R) → 手前(A)。
import * as THREE from 'three';

const W = 4096;

/** 円周上で周期的な 1 次元バリューノイズ */
function makeNoise(seed: number) {
  const tab = new Float32Array(256);
  let s = seed >>> 0;
  for (let i = 0; i < 256; i++) { s = (s * 1664525 + 1013904223) >>> 0; tab[i] = s / 4294967296; }
  return (x: number, period: number) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const a = tab[((i % period) + period) % period & 255], b = tab[(((i + 1) % period) + period) % period & 255];
    return a + (b - a) * u;
  };
}

/** 層ごとの形（base: 麓の高さ, amp: 起伏, f: 基本周波数[周/円周], ridged: 尖り具合 0..1） */
const LAYERS = [
  { base: .045, amp: .200, f: 3, ridged: .30, seed: 11 },
  { base: .030, amp: .150, f: 4, ridged: .24, seed: 23 },
  { base: .017, amp: .115, f: 6, ridged: .20, seed: 37 },
  { base: .009, amp: .085, f: 9, ridged: .16, seed: 51 },
];

/** scale = 稜線の高さの倍率（山岳線は近く高い山並み） */
export function createRidgeTexture(scale = 1): THREE.DataTexture {
  const data = new Uint16Array(W * 4);
  LAYERS.forEach((L, li) => {
    const nz = makeNoise(L.seed * 7919 + 13);
    for (let x = 0; x < W; x++) {
      const t = x / W;
      let n = 0, a = .5, tot = 0;
      for (let o = 0; o < 5; o++) {
        const f = L.f << o; // 整数周波数 = 周期なので 0 と 1 でつながる
        const v = nz(t * f + o * 0.37, f);
        const r = 1 - Math.abs(2 * v - 1); // 尾根状
        n += a * (v * (1 - L.ridged) + r * L.ridged); tot += a; a *= .5;
      }
      n /= tot;
      // 緩やかな起伏: 中央付近を持ち上げ、谷を広めに
      const sh = Math.pow(Math.min(1, Math.max(0, (n - .30) / .42)), 1.2);
      data[x * 4 + li] = THREE.DataUtils.toHalfFloat((L.base + L.amp * sh) * scale);
    }
  });
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}
