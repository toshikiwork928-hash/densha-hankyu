// Canvas 描画からテクスチャを作る（標識・駅名標用）
import * as THREE from 'three';
import { FONT } from '../core/config';

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export const limitTex = (v: number) => canvasTex(256, 256, (g) => {
  g.fillStyle = '#e8502a'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 98, 0, 7); g.fill();
  g.fillStyle = '#111'; g.font = `900 110px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), 128, 136);
});

export interface BoardLine { t: string | number; size?: number }

export const textBoard = (lines: BoardLine[], bg: string, fg: string, w = 256, h = 256, size = 90) => canvasTex(w, h, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.font = `800 ${l.size || size}px ${FONT}`; g.fillText(String(l.t), w / 2, h / 2 + (i - (lines.length - 1) / 2) * (l.size || size) * 1.15); });
});

export const postMat = new THREE.MeshLambertMaterial({ color: 0x777d84 });
