// Camo patterns drawn on a canvas, used as three.js textures (uniforms, guns) and as Armory swatches.
import { LOOKS } from './progress.js';

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483646, 7) + 1;

function draw(g, id, S) {
  const L = LOOKS[id], c = L.colors, r = rng(hash(id));
  g.fillStyle = c[0]; g.fillRect(0, 0, S, S);
  if (L.pattern === 'blotch') {
    for (let k = 1; k < c.length; k++) for (let i = 0; i < 12; i++) {
      g.fillStyle = c[k]; g.beginPath();
      g.ellipse(r() * S, r() * S, S * (0.06 + r() * 0.12), S * (0.03 + r() * 0.07), r() * Math.PI, 0, Math.PI * 2); g.fill();
    }
  } else if (L.pattern === 'digital') {
    const cell = S / 16;
    for (let i = 0; i < 90; i++) {
      g.fillStyle = c[1 + ((r() * (c.length - 1)) | 0)];
      g.fillRect(((r() * 16) | 0) * cell, ((r() * 16) | 0) * cell, cell * (1 + ((r() * 3) | 0)), cell * (1 + ((r() * 2) | 0)));
    }
  } else if (L.pattern === 'tiger') {
    g.fillStyle = c[1];
    for (let i = 0; i < 9; i++) {
      const y = (i / 9) * S * 1.4 - S * 0.2, w = S * (0.02 + r() * 0.04);
      g.beginPath(); g.moveTo(-5, y);
      g.quadraticCurveTo(S * 0.3, y + (r() - 0.5) * S * 0.3, S * 0.6, y + S * 0.12);
      g.quadraticCurveTo(S * 0.8, y + S * 0.2, S + 5, y + S * 0.1);
      g.lineTo(S + 5, y + S * 0.1 + w); g.quadraticCurveTo(S * 0.5, y + S * 0.15 + w * 2, -5, y + w * 2); g.fill();
    }
  } else if (L.pattern === 'metal') {
    const gr = g.createLinearGradient(0, 0, S, S);
    [c[0], c[1], c[0], c[1], c[0]].forEach((col, i) => gr.addColorStop(i / 4, col));
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,240,.35)'; g.lineWidth = S / 40;
    for (let i = 0; i < 6; i++) { const x = r() * S; g.beginPath(); g.moveTo(x, 0); g.lineTo(x - S * 0.4, S); g.stroke(); }
  } else if (L.pattern === 'nebula') {
    for (let k = 1; k < c.length; k++) for (let i = 0; i < 4; i++) {
      const x = r() * S, y = r() * S, rad = S * (0.2 + r() * 0.3), gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, c[k] + 'aa'); gr.addColorStop(1, c[k] + '00'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
    g.fillStyle = '#fff';
    for (let i = 0; i < 50; i++) g.fillRect(r() * S, r() * S, S / 90, S / 90);
  }
}

const texCache = new Map(), urlCache = new Map();
function canvasFor(id, S) { const cv = document.createElement('canvas'); cv.width = cv.height = S; draw(cv.getContext('2d'), id, S); return cv; }
export function lookTexture(id) {
  if (!texCache.has(id)) { const t = new THREE.CanvasTexture(canvasFor(id, 128)); t.wrapS = t.wrapT = THREE.RepeatWrapping; texCache.set(id, t); }
  return texCache.get(id);
}
export function lookSwatch(id) {
  if (!urlCache.has(id)) urlCache.set(id, id === 'factory' ? '' : canvasFor(id, 64).toDataURL());
  return urlCache.get(id);
}
// Paint a material with a look; 'factory' (or an unknown id) restores its original color.
export function applyLook(mat, id) {
  if (mat.userData.base === undefined) mat.userData.base = mat.color.getHex();
  const L = LOOKS[id], had = !!mat.map;
  if (!L || L.pattern === 'none') { mat.map = null; mat.color.setHex(mat.userData.base); }
  else { mat.map = lookTexture(id); mat.color.setHex(0xffffff); }
  if (had !== !!mat.map) mat.needsUpdate = true; // switching texture on/off recompiles the shader
}
