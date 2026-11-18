// Maps: textures, collision boxes and spawn points. Every solid thing is an axis-aligned box.
// Maps are 64 x 64 inside the perimeter wall, except Stackyard, which walls off a small square in the middle.
// HALF is how far from the center the playable ground reaches, for bots and spawns that pick random spots.
import { R } from './config.js';

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);

export const MAPS = { depot: 'Depot', yard: 'Market Yard', dunes: 'Dunes', frost: 'Frostbite', stack: 'Stackyard', highrise: 'Highrise' };
export const boxes = [];   // { min, max } solid boxes of the loaded map
export const SPAWNS = [];  // [x, z] ground spawn points of the loaded map
// every flight of stairs: { foot: [x, z], top: [x, z], y0, y1, via }. Bots and zombies use them to change floors;
// via lists doorway points (outside and inside each door) for stairs that are indoors.
export const STAIRS = [];
export const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export let currentMap = null;
export let HALF = 29;
export let LIMIT = 32; // inner face of the boundary wall

const world = new THREE.Group();

// ---------- textures ----------
function canvasTex(size, draw, rx = 1, ry = rx) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
const speckle = (n, color, w = 2, h = w) => (g, s) => { for (let i = 0; i < n; i++) { g.fillStyle = color(); g.fillRect(rand(0, s), rand(0, s), w, rand(h, h * 2)); } };
const T = {
  grass: () => canvasTex(256, (g, s) => { g.fillStyle = '#6f9b40'; g.fillRect(0, 0, s, s); speckle(2600, () => `hsl(${rand(78, 108)},${rand(32, 52)}%,${rand(27, 44)}%)`, 2, 3)(g, s); }, 72),
  dirt: () => canvasTex(256, (g, s) => { g.fillStyle = '#9b7447'; g.fillRect(0, 0, s, s); speckle(1800, () => `hsla(${rand(25, 38)},${rand(30, 45)}%,${rand(30, 52)}%,.8)`, 2)(g, s); }, 4),
  asphalt: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#5d6166'; g.fillRect(0, 0, s, s);
    speckle(4000, () => `hsl(210,${rand(2, 6)}%,${rand(30, 48)}%)`, 1.5)(g, s);
    g.strokeStyle = 'rgba(30,32,36,.55)'; g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) { g.beginPath(); let x = rand(0, s), y = rand(0, s); g.moveTo(x, y); for (let k = 0; k < 6; k++) g.lineTo(x += rand(-25, 25), y += rand(-25, 25)); g.stroke(); }
  }, 40),
  concrete: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#a9a59c'; g.fillRect(0, 0, s, s);
    speckle(900, () => `hsla(40,${rand(3, 8)}%,${rand(50, 72)}%,.6)`, 2)(g, s);
    g.fillStyle = 'rgba(60,58,52,.25)'; g.fillRect(0, s / 2, s, 2); g.fillRect(s / 2, 0, 2, s / 2); g.fillRect(0, 0, 2, s);
  }),
  ribs: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 10) { g.fillStyle = '#bdbdbd'; g.fillRect(x, 0, 4, s); g.fillStyle = '#efefef'; g.fillRect(x + 4, 0, 1, s); }
    g.fillStyle = 'rgba(80,50,30,.25)'; speckle(120, () => 'rgba(110,60,30,.35)', 3)(g, s);
  }),
  crate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#b8823f'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) { g.fillStyle = y % 32 ? '#ab7535' : '#c08a47'; g.fillRect(0, y, s, 15); g.fillStyle = 'rgba(60,35,10,.35)'; g.fillRect(0, y + 15, s, 1); }
    g.strokeStyle = '#7a4f22'; g.lineWidth = 12; g.strokeRect(6, 6, s - 12, s - 12);
    g.lineWidth = 10; g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.stroke();
  }),
  sand: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#d9b77c'; g.fillRect(0, 0, s, s); speckle(2600, () => `hsl(${rand(32, 42)},${rand(40, 58)}%,${rand(58, 74)}%)`, 2)(g, s);
    g.strokeStyle = 'rgba(150,110,60,.25)'; g.lineWidth = 2;
    for (let y = 8; y < s; y += 22) { g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x / 20 + y) * 4); g.stroke(); }
  }, 60),
  snow: () => canvasTex(256, (g, s) => { g.fillStyle = '#e9eef2'; g.fillRect(0, 0, s, s); speckle(2200, () => `hsl(205,${rand(10, 30)}%,${rand(80, 96)}%)`, 3)(g, s); }, 60),
  planks: (rx, ry) => canvasTex(128, (g, s) => {
    g.fillStyle = '#c99a5b'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) { g.fillStyle = `hsl(32,${rand(38, 48)}%,${rand(50, 58)}%)`; g.fillRect(x, 0, 31, s); g.fillStyle = 'rgba(70,40,12,.4)'; g.fillRect(x + 31, 0, 1, s); }
  }, rx, ry),
};
const mats = new Map();
const lambert = (key, opts) => { if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial(typeof opts === 'function' ? opts() : opts)); return mats.get(key); };

// ---------- builders ----------
function addBox(x, z, w, d, h, y, mat, solid = true) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d); m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true; world.add(m);
  if (solid) boxes.push({ min: new V3(x - w / 2, y, z - d / 2), max: new V3(x + w / 2, y + h, z + d / 2) });
  return m;
}
const crate = (x, z, y = 0, s = 2) => addBox(x, z, s, s, s, y, lambert('crate', () => ({ map: T.crate() })));
function ground(tex) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; world.add(m);
}
function perimeter(mat, h, A = 32) {
  LIMIT = A;
  addBox(0, -A - 0.5, 2 * A + 2, 1, h, 0, mat); addBox(0, A + 0.5, 2 * A + 2, 1, h, 0, mat);
  addBox(-A - 0.5, 0, 1, 2 * A, h, 0, mat); addBox(A + 0.5, 0, 1, 2 * A, h, 0, mat);
}

// ---------- Market Yard: the original map ----------
function yard() {
  const M = {
    wall: lambert('yWall', { color: 0xd8c3a0 }), wallTop: lambert('yWallTop', { color: 0xb79d75 }),
    sack: lambert('ySack', { color: 0xcdb27c }), tower: lambert('yTower', () => ({ map: T.planks(3, 2) })),
    step: lambert('yStep', { color: 0x8f6a42 }), cover: lambert('yCover', { color: 0x9fb5a3 }),
  };
  ground(T.grass());
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(10, 40), new THREE.MeshLambertMaterial({ map: T.dirt() }));
  dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.01; dirt.receiveShadow = true; world.add(dirt);
  perimeter(M.wall, 4);

  addBox(0, 0, 10, 10, 2, 0, lambert('yStage', () => ({ map: T.planks(5, 1) })));
  addBox(6, 0, 2, 3, 1, 0, M.step); addBox(-6, 0, 2, 3, 1, 0, M.step);
  addBox(0, 6, 3, 2, 1, 0, M.step); addBox(0, -6, 3, 2, 1, 0, M.step);
  crate(-3.4, -3.4, 2, 1.4); crate(3.4, 3.4, 2, 1.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addBox(sx * 24, sz * 24, 6, 6, 3, 0, M.tower);
    addBox(sx * 20, sz * 24, 2, 2.4, 2, 0, M.step);
    addBox(sx * 18, sz * 24, 2, 2.4, 1, 0, M.step);
    addBox(sx * 24 + sx * 2.5, sz * 24 + sz * 2.5, 1, 1, 1, 3, M.wallTop);
  }
  [[-12, 8], [-14, 8], [12, -8], [14, -8], [-8, -18], [8, 18], [18, 4], [-18, -4], [-22, 10], [22, -10], [0, -20], [0, 20], [-4, 26], [4, -26]].forEach(([x, z]) => crate(x, z));
  crate(-13, 8, 2); crate(13, -8, 2);
  addBox(-14, -14, 8, 1, 1.3, 0, M.sack); addBox(14, 14, 8, 1, 1.3, 0, M.sack);
  addBox(14, -18, 1, 7, 1.3, 0, M.sack); addBox(-14, 18, 1, 7, 1.3, 0, M.sack);
  addBox(-24, 0, 1, 10, 3, 0, M.cover); addBox(24, 0, 1, 10, 3, 0, M.cover);
  addBox(0, -13, 8, 1, 2.6, 0, M.cover); addBox(0, 13, 8, 1, 2.6, 0, M.cover);
  trees(0x4f8a35);
  return { sky: 0xa8d8ea, fog: [45, 120],
    spawns: [[28, 0], [-28, 0], [0, 28], [0, -28], [16, 26], [-16, -26], [-28, 16], [28, -16], [10, 10], [-10, -10], [12, -26], [-12, 26], [-28, -14], [28, 14]] };
}
function trees(leaf) {
  const trunkM = lambert('trunk', { color: 0x6b4a2b });
  const leafM = [leaf, 0x5e9a3c, 0x447a2e].map(c => lambert('leaf' + c, { color: c }));
  const trunkG = new THREE.CylinderGeometry(0.4, 0.55, 4, 7), leafG = new THREE.IcosahedronGeometry(2.6, 1);
  for (let i = 0; i < 34; i++) {
    const a = i / 34 * Math.PI * 2 + rand(-0.05, 0.05), r = rand(40, 62);
    const t = new THREE.Mesh(trunkG, trunkM); t.position.set(Math.cos(a) * r, 2, Math.sin(a) * r);
    const l = new THREE.Mesh(leafG, leafM[i % 3]); l.position.set(t.position.x, rand(5, 6.5), t.position.z);
    const s = rand(0.9, 1.5); l.scale.set(s, s * rand(0.9, 1.2), s); t.castShadow = l.castShadow = true;
    world.add(t, l);
  }
}

// ---------- Depot: shipping yard with a gutted office in the middle ----------
function depot() {
  const M = {
    wall: lambert('dWall', () => ({ map: T.concrete(), color: 0xc9c4b8 })),
    brick: lambert('dBrick', { color: 0x9a7b66 }), trim: lambert('dTrim', { color: 0x6f5a4b }),
    metal: lambert('dMetal', { color: 0x5b6168 }), rail: lambert('dRail', { color: 0xd4a017 }),
    barrier: lambert('dBarrier', { color: 0xbab5aa }), dock: lambert('dDock', () => ({ map: T.concrete(), color: 0x9d9a92 })),
    paint: new THREE.MeshBasicMaterial({ color: 0xd8b13a }), far: lambert('dFar', { color: 0x7d858c }),
  };
  const container = (x, z, alongX, color, y = 0) =>
    addBox(x, z, alongX ? 6 : 2.5, alongX ? 2.5 : 6, 2.6, y, lambert('box' + color, () => ({ map: T.ribs(), color })));

  ground(T.asphalt());
  // painted lane markings
  for (const [x, z, w, d] of [[0, -11, 0.25, 6], [0, 11, 0.25, 6], [-17, 0, 6, 0.25], [17, 0, 6, 0.25], [0, -30, 20, 0.25], [0, 30, 20, 0.25]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.paint); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.015, z); world.add(m);
  }
  perimeter(M.wall, 4.5);

  // gutted office: no roof, doors on north, south and east, a window on the west
  const W = M.brick;
  for (const s of [-1, 1]) { // north / south walls with a center door
    addBox(-3.625, s * 5, 4.75, 0.5, 3.6, 0, W); addBox(3.625, s * 5, 4.75, 0.5, 3.6, 0, W); addBox(0, s * 5, 2.5, 0.5, 1, 2.6, M.trim);
  }
  addBox(-6, -3, 0.5, 4, 3.6, 0, W); addBox(-6, 3, 0.5, 4, 3.6, 0, W);
  addBox(-6, 0, 0.5, 2, 1.1, 0, M.trim); addBox(-6, 0, 0.5, 2, 1.3, 2.3, W);
  addBox(6, -3.125, 0.5, 3.75, 3.6, 0, W); addBox(6, 3.125, 0.5, 3.75, 3.6, 0, W); addBox(6, 0, 0.5, 2.5, 1, 2.6, M.trim);
  crate(-3.6, -2.8, 0, 1.6); crate(3.4, 2.6, 0, 1.6); crate(3.4, 2.6, 1.6, 1.2);
  addBox(0.5, -0.5, 3, 1, 1.05, 0, M.metal); // counter

  // containers (some stacked)
  container(-18, -18, true, 0xb33a2e); container(-18, -18, true, 0x2f5f8f, 2.6);
  container(18, 18, true, 0xc8702a); container(18, 18, true, 0x4c7a3a, 2.6);
  container(-22, -8, false, 0x2f5f8f); container(22, 8, false, 0xb33a2e);
  container(-14, 10, false, 0x4c7a3a); container(14, -10, false, 0x4c7a3a);
  container(6, -20, true, 0x2f5f8f); container(-6, 20, true, 0xb33a2e);
  container(26, -22, false, 0xc8702a); container(-26, 22, false, 0x2f5f8f);

  // sniper decks north and south, with stairs on the +x side (0.5 m steps so you walk up them)
  for (const s of [-1, 1]) {
    const z = s * 25;
    addBox(0, z, 5, 4, 0.4, 2.6, M.metal); // deck top at 3.0
    for (const dx of [-2.3, 2.3]) for (const dz of [-1.8, 1.8]) addBox(dx, z + dz, 0.3, 0.3, 2.6, 0, M.metal);
    addBox(0, z + s * 1.95, 5, 0.1, 1, 3, M.rail); addBox(0, z - s * 1.95, 5, 0.1, 1, 3, M.rail); addBox(-2.45, z, 0.1, 4, 1, 3, M.rail);
    stairs(7.9, z, -1, 0, 6, 0, M.dock, 0.5, 0.9, 1.6);
  }

  // loading docks on the east and west walls
  for (const s of [-1, 1]) {
    const z = s * -4;
    addBox(s * 29.5, z, 5, 16, 1.2, 0, M.dock);
    addBox(s * 26.5, z, 1, 3, 0.8, 0, M.dock); addBox(s * 25.5, z, 1, 3, 0.4, 0, M.dock);
    crate(s * 30, z + s * -5, 1.2, 1.4); crate(s * 30, z + s * 5, 1.2, 1.4);
  }

  // concrete barriers (low cover)
  for (const [x, z, w, d] of [[-9, -11, 4, 0.6], [9, 11, 4, 0.6], [12, -3, 0.6, 4], [-12, 3, 0.6, 4], [0, -14, 3, 0.6], [0, 14, 3, 0.6]]) addBox(x, z, w, d, 1, 0, M.barrier);

  // floodlight poles
  const lampM = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  for (const [x, z] of [[16, 4], [-16, -4], [-4, -16], [4, 16]]) {
    addBox(x, z, 0.3, 0.3, 7, 0, M.metal);
    const head = new THREE.Mesh(boxGeo, lampM); head.scale.set(0.9, 0.25, 0.5); head.position.set(x, 7.1, z); world.add(head);
  }
  // warehouses beyond the wall (scenery only)
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + rand(-0.1, 0.1), r = rand(48, 70), h = rand(7, 16);
    const b = addBox(Math.cos(a) * r, Math.sin(a) * r, rand(10, 18), rand(10, 18), h, 0, M.far, false);
    b.rotation.y = a;
  }
  return { sky: 0xb8c4cc, fog: [40, 115],
    spawns: [[29, 20], [-29, -20], [20, 28], [-20, -28], [29, -28], [-29, 28], [0, -17], [0, 17], [17, 0], [-17, 0], [10, -25], [-10, 25], [24, -6], [-24, 6]] };
}

// ---------- shared pieces ----------
// straight stairs: n steps of `rise`, each `run` deep and `w` wide, climbing from (x, z) along (dx, dz)
// (one of them is ±1) off a floor at y0. The caller puts a floor at the top.
function stairs(x, z, dx, dz, n, y0, mat, rise = 0.4, run = 0.75, w = 2, via = null) {
  for (let i = 1; i <= n; i++) { const o = (i - 0.5) * run; addBox(x + dx * o, z + dz * o, dx ? run : w, dz ? run : w, i * rise, y0, mat); }
  const L = n * run;
  STAIRS.push({ foot: [x - dx * 0.6, z - dz * 0.6], top: [x + dx * (L + 0.6), z + dz * (L + 0.6)], y0, y1: y0 + n * rise, via });
}
// a wall along x (running a..b at z = c) or along z (running a..b at x = c), from y up h, with openings
// [center, width, sill, top] measured up from y: a door has sill 0, a window doesn't
function wall(axis, a, b, c, y, h, mat, gaps = [], t = 0.4) {
  const seg = (u0, u1, y0, y1) => {
    if (u1 - u0 < 0.01 || y1 - y0 < 0.01) return;
    if (axis === 'x') addBox((u0 + u1) / 2, c, u1 - u0, t, y1 - y0, y0, mat); else addBox(c, (u0 + u1) / 2, t, u1 - u0, y1 - y0, y0, mat);
  };
  let u = a;
  for (const [g, w, sill, top] of [...gaps].sort((p, q) => p[0] - q[0])) {
    seg(u, g - w / 2, y, y + h); seg(g - w / 2, g + w / 2, y, y + sill); seg(g - w / 2, g + w / 2, y + top, y + h);
    u = g + w / 2;
  }
  seg(u, b, y, y + h);
}
// a floor whose top is at `top`, over x0..x1 by z0..z1, leaving a stairwell hole [hx0, hx1, hz0, hz1]
function slab(x0, x1, z0, z1, top, mat, hole) {
  const r = (a, b, c, d) => { if (b - a > 0.01 && d - c > 0.01) addBox((a + b) / 2, (c + d) / 2, b - a, d - c, 0.3, top - 0.3, mat); };
  if (!hole) return r(x0, x1, z0, z1);
  const [hx0, hx1, hz0, hz1] = hole;
  r(x0, hx0, z0, z1); r(hx1, x1, z0, z1); r(hx0, hx1, z0, hz0); r(hx0, hx1, hz1, z1);
}
const win = c => [c, 1.8, 1.0, 2.3];

// a roofless hut: four walls, with a 2 m doorway on each side named in `doors` (n, s, e, w)
function hut(x, z, w, d, h, mat, doors) {
  const t = 0.4, gap = 2;
  for (const [side, sz] of [['n', -1], ['s', 1]]) {
    const zz = z + sz * d / 2;
    if (doors.includes(side)) { const seg = (w - gap) / 2; addBox(x - (gap + seg) / 2, zz, seg, t, h, 0, mat); addBox(x + (gap + seg) / 2, zz, seg, t, h, 0, mat); }
    else addBox(x, zz, w, t, h, 0, mat);
  }
  for (const [side, sx] of [['w', -1], ['e', 1]]) {
    const xx = x + sx * w / 2, len = d - t;
    if (doors.includes(side)) { const seg = (len - gap) / 2; addBox(xx, z - (gap + seg) / 2, t, seg, h, 0, mat); addBox(xx, z + (gap + seg) / 2, t, seg, h, 0, mat); }
    else addBox(xx, z, t, len, h, 0, mat);
  }
}
// a lookout deck (top at 3 m) on legs, with 0.5 m steps running toward +x (s = 1) or -x (s = -1)
function tower(x, z, s, deckM, stepM, railM) {
  addBox(x, z, 5, 4, 0.4, 2.6, deckM);
  for (const dx of [-2.3, 2.3]) for (const dz of [-1.8, 1.8]) addBox(x + dx, z + dz, 0.3, 0.3, 2.6, 0, deckM);
  addBox(x, z + 1.95, 5, 0.1, 1, 3, railM); addBox(x, z - 1.95, 5, 0.1, 1, 3, railM); addBox(x - s * 2.45, z, 0.1, 4, 1, 3, railM);
  stairs(x + s * 7.9, z, -s, 0, 6, 0, stepM, 0.5, 0.9, 1.6);
}

// ---------- Dunes: a desert outpost around a raised stone plaza ----------
function dunes() {
  const M = {
    wall: lambert('uWall', { color: 0xd9b47c }), stone: lambert('uStone', { color: 0xc49a62 }), dark: lambert('uDark', { color: 0x8a6a45 }),
    cloth: lambert('uCloth', { color: 0xb0412e, side: THREE.DoubleSide }), cloth2: lambert('uCloth2', { color: 0x2f7f8f, side: THREE.DoubleSide }),
    wood: lambert('uWood', () => ({ map: T.planks(2, 1) })),
  };
  ground(T.sand());
  perimeter(M.wall, 4);
  // hollow plaza, 2.5 m up on four corner blocks: two tunnels cross underneath, and a flight of steps
  // climbs each side beside the tunnel mouth (pinwheel, so every side has a way up and a way through)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(sx * 4, sz * 4, 4, 4, 2.1, 0, M.stone);
  addBox(0, 0, 12, 12, 0.4, 2.1, M.stone);
  stairs(-3.2, -10, 0, 1, 5, 0, M.stone, 0.5, 0.8, 2.4); stairs(3.2, 10, 0, -1, 5, 0, M.stone, 0.5, 0.8, 2.4);
  stairs(10, -3.2, -1, 0, 5, 0, M.stone, 0.5, 0.8, 2.4); stairs(-10, 3.2, 1, 0, 5, 0, M.stone, 0.5, 0.8, 2.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(sx * 5.3, sz * 5.3, 1, 1, 2.6, 2.5, M.dark);
  addBox(0, 0, 3, 0.6, 1.1, 2.5, M.dark); // low wall across the top
  // adobe huts in the corners
  hut(-21, -19, 8, 7, 3.2, M.wall, 'se'); hut(21, 19, 8, 7, 3.2, M.wall, 'nw');
  addBox(21, 19, 8.4, 7.4, 0.3, 3.2, M.stone); stairs(30.6, 17, -1, 0, 7, 0, M.stone, 0.5, 0.8, 1.6); // this one has a flat roof you can climb onto
  hut(19, -21, 7, 8, 3.2, M.wall, 'ws'); hut(-19, 21, 7, 8, 3.2, M.wall, 'en');
  // market stalls: a counter under a cloth awning (the awning is not solid)
  for (const [x, z, c] of [[-12, 0, M.cloth], [12, 0, M.cloth2], [0, 13, M.cloth2], [0, -13, M.cloth]]) {
    const along = x === 0;
    addBox(x, z, along ? 4 : 1, along ? 1 : 4, 1.1, 0, M.wood);
    const aw = new THREE.Mesh(boxGeo, c); aw.scale.set(along ? 4.6 : 2.6, 0.08, along ? 2.6 : 4.6); aw.position.set(x, 2.6, z); aw.castShadow = true; world.add(aw);
    for (const p of [-1, 1]) addBox(x + (along ? p * 2.1 : 0), z + (along ? 0 : p * 2.1), 0.15, 0.15, 2.6, 0, M.dark, false);
  }
  // lookouts west and east
  tower(-26, 6, 1, M.wood, M.stone, M.dark); tower(26, -6, -1, M.wood, M.stone, M.dark);
  // broken walls and barrels for cover
  for (const [x, z, w, d, h] of [[-10, -22, 6, 0.6, 2], [10, 22, 6, 0.6, 2], [-24, -6, 0.6, 5, 1.6], [24, 6, 0.6, 5, 1.6], [8, -9, 0.6, 3, 1.2], [-8, 9, 0.6, 3, 1.2]]) addBox(x, z, w, d, h, 0, M.wall);
  for (const [x, z] of [[-15, 12], [15, -12], [-5, 22], [5, -22], [-28, -26], [28, 26]]) crate(x, z, 0, 1.6);
  // palms beyond the wall
  const trunkM = lambert('palmT', { color: 0x8a6a3e }), leafM = lambert('palmL', { color: 0x5d8a3a, side: THREE.DoubleSide });
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2 + rand(-0.1, 0.1), r = rand(40, 60), x = Math.cos(a) * r, z = Math.sin(a) * r, h = rand(6, 9);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 6), trunkM); t.position.set(x, h / 2, z); t.castShadow = true; world.add(t);
    for (let k = 0; k < 5; k++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), leafM); const ang = k / 5 * Math.PI * 2;
      l.position.set(x + Math.cos(ang) * 1.8, h - 0.3, z + Math.sin(ang) * 1.8); l.rotation.set(-Math.PI / 2 + 0.4, 0, -ang); world.add(l);
    }
  }
  return { sky: 0xf2d6a2, fog: [45, 125],
    spawns: [[28, 28], [-28, -28], [28, -28], [-28, 28], [0, 26], [0, -26], [-14, -8], [14, 8], [-6, 18], [6, -18], [22, -2], [-22, 2], [-10, -14], [10, 14], [0, 0]] };
}

// ---------- Frostbite: a snowed-in radio outpost with log cabins ----------
function frost() {
  const M = {
    wall: lambert('fWall', () => ({ map: T.concrete(), color: 0xb9c7d2 })), logs: lambert('fLogs', () => ({ map: T.planks(3, 1), color: 0x9c7a5a })),
    snow: lambert('fSnow', { color: 0xf3f7fa }), metal: lambert('fMetal', { color: 0x5b6670 }), red: lambert('fRed', { color: 0xc23b2e }),
    ice: new THREE.MeshLambertMaterial({ color: 0xa8d4ec, transparent: true, opacity: 0.85 }),
  };
  ground(T.snow());
  perimeter(M.wall, 4.5);
  // frozen pond (flat, walkable)
  const pond = new THREE.Mesh(new THREE.CircleGeometry(7, 40), M.ice); pond.rotation.x = -Math.PI / 2; pond.position.set(-8, 0.02, 8); pond.receiveShadow = true; world.add(pond);
  // cabins
  hut(-18, -16, 9, 7, 3.4, M.logs, 'se');
  // two-storey lodge: stairs inside up to a walled loft with windows on every side
  wall('x', 11, 21, 12, 0, 3.2, M.logs, [[14, 2.2, 0, 2.6], win(18)]); wall('x', 11, 21, 20, 0, 3.2, M.logs, [win(14), win(17.5)]);
  wall('z', 12.2, 19.8, 11, 0, 3.2, M.logs, [[16, 2.2, 0, 2.6]]); wall('z', 12.2, 19.8, 21, 0, 3.2, M.logs, [win(14.5)]);
  slab(11, 21, 12, 20, 3.2, M.logs, [18.5, 20.7, 13.1, 19.6]);
  stairs(19.6, 19.2, 0, -1, 8, 0, M.snow, 0.4, 0.75, 2, [[14, 10.5], [14, 13.5], [9.5, 16], [12.5, 16]]);
  wall('x', 11, 21, 12, 3.2, 2.4, M.logs, [win(13.5), win(16.5)]); wall('x', 11, 21, 20, 3.2, 2.4, M.logs, [win(13.5), win(16.5)]);
  wall('z', 12.2, 19.8, 11, 3.2, 2.4, M.logs, [win(14), win(18)]); wall('z', 12.2, 19.8, 21, 3.2, 2.4, M.logs, [win(15.5)]);
  addBox(18.4, 16.35, 0.1, 6.5, 1, 3.2, M.red); // rail beside the stairwell
  crate(14, 16, 3.2, 1.2);
  hut(18, -18, 7, 9, 3.4, M.logs, 'wn'); hut(-20, 20, 7, 7, 3.4, M.logs, 'es');
  // radio mast on a lookout in the middle
  tower(2, -2, 1, M.metal, M.snow, M.red);
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(boxGeo, i % 2 ? M.red : lambert('fWhite', { color: 0xffffff })); m.scale.set(0.25, 2, 0.25); m.position.set(0.5, 4 + i * 2, -2); world.add(m); }
  // snow banks and fuel tanks
  for (const [x, z, w, d, h] of [[-6, -10, 6, 1.4, 1.1], [10, 6, 1.4, 6, 1.1], [-14, 2, 1.4, 5, 1.1], [6, 14, 5, 1.4, 1.1], [24, 2, 1.4, 6, 1.3], [-24, -4, 1.4, 6, 1.3], [-2, -24, 7, 1.4, 1.2], [4, 25, 7, 1.4, 1.2]]) addBox(x, z, w, d, h, 0, M.snow);
  for (const [x, z] of [[-26, 8], [26, -8], [10, -26], [-10, 26]]) {
    addBox(x, z, 2.4, 4.4, 2.4, 0, M.metal, true).visible = false; // collision only; the round tank below is what you see
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.4, 14), M.metal); t.rotation.x = Math.PI / 2; t.position.set(x, 1.2, z); t.castShadow = t.receiveShadow = true; world.add(t);
  }
  for (const [x, z] of [[-4, 18], [12, -10], [-12, -24], [26, 26]]) crate(x, z, 0, 1.6);
  // pines beyond the wall
  const leafM = lambert('pine', { color: 0x2f5a3f }), capM = lambert('pineSnow', { color: 0xf3f7fa }), trunkM = lambert('trunk', { color: 0x6b4a2b });
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2 + rand(-0.05, 0.05), r = rand(40, 64), x = Math.cos(a) * r, z = Math.sin(a) * r, s = rand(0.9, 1.5);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2, 6), trunkM); t.position.set(x, 1, z); world.add(t);
    const c = new THREE.Mesh(new THREE.ConeGeometry(2.4 * s, 6 * s, 8), leafM); c.position.set(x, 2 + 3 * s, z); c.castShadow = true; world.add(c);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1 * s, 2 * s, 8), capM); cap.position.set(x, 2 + 5.4 * s, z); world.add(cap);
  }
  return { sky: 0xcfdce6, fog: [35, 105],
    spawns: [[28, 28], [-28, -28], [28, -28], [-28, 28], [0, 28], [0, -28], [28, 0], [-28, 0], [-8, 8], [14, 2], [-12, -6], [8, -14], [-2, 14], [20, -26]] };
}

// ---------- Stackyard: a tiny square of shipping containers, fights in seconds ----------
function stack() {
  const M = { wall: lambert('sWall', () => ({ map: T.concrete(), color: 0x8f949a })), far: lambert('dFar', { color: 0x7d858c }) };
  const container = (x, z, alongX, color, y = 0) =>
    addBox(x, z, alongX ? 6 : 2.5, alongX ? 2.5 : 6, 2.6, y, lambert('box' + color, () => ({ map: T.ribs(), color })));
  ground(T.asphalt());
  perimeter(M.wall, 5, 18);
  container(-10, -10, true, 0xb33a2e); container(10, -10, false, 0x2f5f8f); container(10, -10, false, 0xc8702a, 2.6);
  container(-10, 10, false, 0x4c7a3a); container(10, 10, true, 0xc8702a); container(-10, 10, false, 0x2f5f8f, 2.6);
  container(0, -4.5, true, 0x2f5f8f); container(0, 4.5, true, 0xb33a2e);
  container(-13, 0, false, 0xc8702a); container(13, 0, false, 0x4c7a3a);
  // upper deck: steps onto two containers, and catwalks from them to the middle pair, so the top is a second lane
  const deck = lambert('sDeck', { color: 0x5b6168 });
  stairs(-17, -10, 1, 0, 5, 0, deck, 0.52, 0.8, 1.6); stairs(17, 10, -1, 0, 5, 0, deck, 0.52, 0.8, 1.6);
  for (const k of [-1, 1]) {
    addBox(k * 5, k * 9.75, 4, 1.5, 0.25, 2.35, deck); addBox(k * 3.75, k * 7.75, 1.5, 5.5, 0.25, 2.35, deck);
  }
  for (const [x, z, y, sz] of [[-4, -13, 0, 1.6], [4, 13, 0, 1.6], [-5, 0, 0, 1.4], [5, 0, 0, 1.4], [-15.5, -15.5, 0, 2], [15.5, 15.5, 0, 2], [-15.5, 15.5, 0, 1.4], [15.5, -15.5, 0, 1.4], [0, -4.5, 2.6, 1.2]]) crate(x, z, y, sz);
  // the rest of the port, beyond the wall (scenery only)
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, r = rand(30, 50);
    const b = addBox(Math.cos(a) * r, Math.sin(a) * r, rand(6, 12), rand(6, 12), rand(5, 12), 0, M.far, false); b.rotation.y = a;
  }
  return { sky: 0xe7b98c, fog: [30, 90], half: 16,
    spawns: [[-16, -6], [16, 6], [-6, 16], [6, -16], [-16, 6], [16, -6], [6, 16], [-6, -16], [0, 0], [-7, -7], [7, 7], [-7, 7], [7, -7], [0, 15], [0, -15]] };
}

// ---------- Highrise: a three-storey block and a two-storey annex joined by a skybridge ----------
// Stairs zigzag up the main block (east, west, east) to a roof with a parapet; the 2nd floor has a balcony.
function highrise() {
  const M = {
    wall: lambert('hWall', () => ({ map: T.concrete(), color: 0xb8b2a6 })), band: lambert('hBand', { color: 0x7a8088 }),
    floor: lambert('hFloor', () => ({ map: T.concrete(), color: 0x8f8a80 })), step: lambert('hStep', { color: 0x9a948a }),
    rail: lambert('hRail', { color: 0xd4a017 }), annex: lambert('hAnnex', { color: 0xa0624a }), far: lambert('hFar', { color: 0x6d7682 }),
    glass: lambert('hGlass', { color: 0x2a3440 }), car: [0x2f5f8f, 0xb33a2e, 0xd8d8d8].map(c => lambert('car' + c, { color: c })),
  };
  const container = (x, z, alongX, color, y = 0) =>
    addBox(x, z, alongX ? 6 : 2.5, alongX ? 2.5 : 6, 2.6, y, lambert('box' + color, () => ({ map: T.ribs(), color })));
  ground(T.asphalt());
  perimeter(lambert('hPerim', () => ({ map: T.concrete(), color: 0xa9a59c })), 4);

  // main block, x -8..8, z -6..6: walls per floor with doors and windows
  const door = (c, w = 2.2) => [c, w, 0, 2.6];
  const floors = [
    { y: 0, s: [door(0, 2.4), win(-5), win(4)], n: [door(-3), win(2.5)], w: [door(0), win(-4), win(4)], e: [win(-3), win(3.5)] },
    { y: 3.2, s: [win(-5.5), win(-2), win(2), win(5.5)], n: [win(-5.5), win(-2), win(2)], w: [win(-3.5), win(0.5)], e: [win(-3), [3, 2, 0, 2.5]] },
    { y: 6.4, s: [win(-5.5), door(0, 2.4), win(5.5)], n: [win(-5), win(0), win(5)], w: [win(-3.5), win(3.5)], e: [win(-3.5), win(3.5)] },
  ];
  for (const f of floors) {
    wall('x', -8, 8, 6, f.y, 3.2, M.wall, f.s); wall('x', -8, 8, -6, f.y, 3.2, M.wall, f.n);
    wall('z', -5.8, 5.8, -8, f.y, 3.2, M.wall, f.w); wall('z', -5.8, 5.8, 8, f.y, 3.2, M.wall, f.e);
  }
  slab(-8, 8, -6, 6, 3.2, M.floor, [5.4, 7.6, -5.8, 1.1]);
  slab(-8, 8, -6, 6, 6.4, M.floor, [-7.6, -5.4, -1.1, 5.8]);
  slab(-8, 8, -6, 6, 9.6, M.floor, [5.4, 7.6, -5.8, 1.1]);
  stairs(6.5, -5, 0, 1, 8, 0, M.step, 0.4, 0.75, 2, [[0, 7.5], [0, 4.5], [-9.5, 0], [-6.5, 0], [-3, -7.5], [-3, -4.5]]);
  stairs(-6.5, 5, 0, -1, 8, 3.2, M.step); stairs(6.5, -5, 0, 1, 8, 6.4, M.step);
  // rails along the open side of each stairwell
  addBox(5.3, -2.35, 0.1, 6.9, 1, 3.2, M.rail); addBox(-5.3, 2.35, 0.1, 6.9, 1, 6.4, M.rail); addBox(5.3, -2.35, 0.1, 6.9, 1, 9.6, M.rail);
  // roof parapet, 2nd-floor balcony over the front door
  wall('x', -8, 8, 6, 9.6, 1, M.band); wall('x', -8, 8, -6, 9.6, 1, M.band); wall('z', -5.8, 5.8, -8, 9.6, 1, M.band); wall('z', -5.8, 5.8, 8, 9.6, 1, M.band);
  slab(-4, 4, 6, 8.5, 6.4, M.floor);
  addBox(0, 8.45, 8, 0.1, 1, 6.4, M.rail); addBox(-3.95, 7.25, 0.1, 2.5, 1, 6.4, M.rail); addBox(3.95, 7.25, 0.1, 2.5, 1, 6.4, M.rail);
  // cover on every floor
  addBox(-2, 2.5, 4, 0.6, 1.1, 0, M.band); crate(-6, -4, 0, 1.4); crate(2, -4, 0, 1.4);
  crate(-2, -3, 3.2, 1.4); crate(3, -3, 3.2, 1.2); addBox(-1, 0.5, 0.4, 4, 1.2, 3.2, M.band); // keep the walk between stairwells clear
  crate(-1, 4.2, 6.4, 1.6); crate(-3, 2, 6.4, 1.2); crate(3, 2.5, 6.4, 1.2);
  crate(-4, -3, 9.6, 1.4); crate(2, 3, 9.6, 1.2);
  const mast = new THREE.Mesh(boxGeo, M.band); mast.scale.set(0.2, 5, 0.2); mast.position.set(-6, 12.6, -4); world.add(mast);

  // annex, x 16..24, z -4..4: stairs inside up to a walled roof terrace; the skybridge lands on the terrace
  wall('x', 16, 24, 4, 0, 3.2, M.annex, [door(20), win(22.5)]); wall('x', 16, 24, -4, 0, 3.2, M.annex, [win(18), win(22)]);
  wall('z', -3.8, 3.8, 16, 0, 3.2, M.annex, [door(-2), win(1.5)]); wall('z', -3.8, 3.8, 24, 0, 3.2, M.annex, [win(0)]);
  slab(16, 24, -4, 4, 3.2, M.floor, [21.7, 23.9, -3.1, 3.1]);
  stairs(22.8, 3, 0, -1, 8, 0, M.step, 0.4, 0.75, 2, [[14.5, -2], [17.5, -2], [20, 5.5], [20, 2.5]]);
  wall('x', 16, 24, 4, 3.2, 1.1, M.annex); wall('x', 16, 24, -4, 3.2, 1.1, M.annex);
  wall('z', -3.8, 3.8, 16, 3.2, 1.1, M.annex, [[3, 2, 0, 1.1]]); wall('z', -3.8, 3.8, 24, 3.2, 1.1, M.annex);
  addBox(21.6, 0, 0.1, 6.2, 1, 3.2, M.rail);
  // skybridge from the main block's 1st floor (east door) to the annex roof, open underneath
  addBox(12, 3, 8, 2, 0.3, 2.9, M.floor); addBox(12, 2.05, 8, 0.1, 1, 3.2, M.rail); addBox(12, 3.95, 8, 0.1, 1, 3.2, M.rail);

  // the street: parked cars, barriers, and two containers you can climb
  const car = (x, z, alongX, m) => { addBox(x, z, alongX ? 4.2 : 1.9, alongX ? 1.9 : 4.2, 1, 0, m); addBox(x, z, alongX ? 2.2 : 1.7, alongX ? 1.7 : 2.2, 0.6, 1, M.glass); };
  car(-4, 12, true, M.car[0]); car(6, 14, true, M.car[1]); car(-20, -10, false, M.car[2]); car(20, 14, false, M.car[0]); car(-14, 20, true, M.car[1]); car(12, -16, true, M.car[2]);
  for (const [x, z, w, d] of [[-14, 4, 0.6, 4], [14, -6, 0.6, 4], [0, 18, 4, 0.6], [0, -16, 4, 0.6], [-22, 12, 4, 0.6], [24, -18, 0.6, 4]]) addBox(x, z, w, d, 1, 0, M.band);
  container(-22, -20, true, 0x4c7a3a); stairs(-15, -20, -1, 0, 5, 0, M.step, 0.52, 0.8, 1.6);
  container(22, 20, true, 0xc8702a); stairs(15, 20, 1, 0, 5, 0, M.step, 0.52, 0.8, 1.6);
  // skyline beyond the wall (scenery only)
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2 + rand(-0.08, 0.08), r = rand(48, 72);
    addBox(Math.cos(a) * r, Math.sin(a) * r, rand(8, 16), rand(8, 16), rand(15, 40), 0, M.far, false).rotation.y = a;
  }
  return { sky: 0x9fb8d0, fog: [45, 130],
    spawns: [[0, 26], [0, -26], [27, 26], [-27, -26], [27, -26], [-27, 26], [-24, 2], [28, 6], [12, 22], [-12, -22], [-14, 12], [14, -10], [-3, 4], [19, 0], [-24, -12]] };
}

// Clears the current map and builds `name` (falls back to the default map).
export function loadMap(scene, name) {
  if (!MAPS[name]) name = 'depot';
  scene.remove(world);
  world.traverse(o => { if (o.isMesh && o.geometry !== boxGeo) o.geometry.dispose(); });
  world.clear(); boxes.length = 0; SPAWNS.length = 0; STAIRS.length = 0;
  const m = { depot, yard, dunes, frost, stack, highrise }[name]();
  HALF = m.half || 29;
  scene.add(world);
  scene.background = new THREE.Color(m.sky);
  scene.fog = new THREE.Fog(m.sky, m.fog[0], m.fog[1]);
  for (const [x, z] of m.spawns) if (!boxes.some(b => b.min.y < 1 && x + R > b.min.x && x - R < b.max.x && z + R > b.min.z && z - R < b.max.z)) SPAWNS.push([x, z]);
  console.assert(SPAWNS.length >= 8, `map ${name} has only ${SPAWNS.length} clear spawns`);
  currentMap = name;
  return name;
}
