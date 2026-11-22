// Small helpers the game's modules share. No game state lives here.

export const $ = id => document.getElementById(id);
export const V3 = THREE.Vector3;
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
