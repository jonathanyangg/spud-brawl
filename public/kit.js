// The map-building kit: the loaded map's collision data, textures, materials and builders.
// Every solid thing is an axis-aligned box; each map in ./maps/ builds itself from these pieces.
export const V3 = THREE.Vector3;
export const rand = (a, b) => a + Math.random() * (b - a);

export const boxes = [];   // { min, max } solid boxes of the loaded map
export const SPAWNS = [];  // [x, z] ground spawn points of the loaded map
// every flight of stairs: { foot: [x, z], top: [x, z], y0, y1, via }. Bots and zombies use them to change floors;
// via lists doorway points (outside and inside each door) for stairs that are indoors.
export const STAIRS = [];
// jump pads { x, z, y, tx, tz, ty, arc }: stepping on one throws you onto the spot (tx, ty, tz), peaking `arc` above it
export const PADS = [], PAD_R = 1.2;
// slippery ground (ice): [x0, x1, z0, z1] at ground level
export const ICE = [];
// loot chests for battle royale: [x, z, floor height]. Maps that list none get some placed by the game.
export const CHESTS = [];
export const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export let LIMIT = 32; // inner face of the boundary wall

export const world = new THREE.Group();

// ---------- textures ----------
export function canvasTex(size, draw, rx = 1, ry = rx) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
export const speckle = (n, color, w = 2, h = w) => (g, s) => { for (let i = 0; i < n; i++) { g.fillStyle = color(); g.fillRect(rand(0, s), rand(0, s), w, rand(h, h * 2)); } };
export const T = {
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
export const lambert = (key, opts) => { if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial(typeof opts === 'function' ? opts() : opts)); return mats.get(key); };

// ---------- builders ----------
export function addBox(x, z, w, d, h, y, mat, solid = true) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d); m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true; world.add(m);
  if (solid) boxes.push({ min: new V3(x - w / 2, y, z - d / 2), max: new V3(x + w / 2, y + h, z + d / 2) });
  return m;
}
export const crate = (x, z, y = 0, s = 2) => addBox(x, z, s, s, s, y, lambert('crate', () => ({ map: T.crate() })));
export function ground(tex) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; world.add(m);
}
export function perimeter(mat, h, A = 32) {
  LIMIT = A;
  addBox(0, -A - 0.5, 2 * A + 2, 1, h, 0, mat); addBox(0, A + 0.5, 2 * A + 2, 1, h, 0, mat);
  addBox(-A - 0.5, 0, 1, 2 * A, h, 0, mat); addBox(A + 0.5, 0, 1, 2 * A, h, 0, mat);
}


export function trees(leaf) {
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

// ---------- shared pieces ----------
// straight stairs: n steps of `rise`, each `run` deep and `w` wide, climbing from (x, z) along (dx, dz)
// (one of them is ±1) off a floor at y0. The caller puts a floor at the top.
export function stairs(x, z, dx, dz, n, y0, mat, rise = 0.4, run = 0.75, w = 2, via = null) {
  for (let i = 1; i <= n; i++) { const o = (i - 0.5) * run; addBox(x + dx * o, z + dz * o, dx ? run : w, dz ? run : w, i * rise, y0, mat); }
  const L = n * run;
  STAIRS.push({ foot: [x - dx * 0.6, z - dz * 0.6], top: [x + dx * (L + 0.6), z + dz * (L + 0.6)], y0, y1: y0 + n * rise, via });
}
// a wall along x (running a..b at z = c) or along z (running a..b at x = c), from y up h, with openings
// [center, width, sill, top] measured up from y: a door has sill 0, a window doesn't
export function wall(axis, a, b, c, y, h, mat, gaps = [], t = 0.4) {
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
export function slab(x0, x1, z0, z1, top, mat, hole) {
  const r = (a, b, c, d) => { if (b - a > 0.01 && d - c > 0.01) addBox((a + b) / 2, (c + d) / 2, b - a, d - c, 0.3, top - 0.3, mat); };
  if (!hole) return r(x0, x1, z0, z1);
  const [hx0, hx1, hz0, hz1] = hole;
  r(x0, hx0, z0, z1); r(hx1, x1, z0, z1); r(hx0, hx1, z0, hz0); r(hx0, hx1, hz1, z1);
}
export const win = c => [c, 1.8, 1.0, 2.3];
// a jump pad at (x, z) on a floor at y; it also counts as a (one-way) flight of stairs for bots and zombies
const padTop = new THREE.MeshBasicMaterial({ color: 0x46e0ff }), padRing = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
export function pad(x, z, tx, tz, ty, y = 0, arc = 1.5) {
  PADS.push({ x, z, y, tx, tz, ty, arc });
  STAIRS.push({ foot: [x, z], top: [tx, tz], y0: y, y1: ty, via: null, pad: true });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R + 0.1, 0.12, 24), padRing); base.position.set(x, y + 0.06, z); base.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R - 0.35, PAD_R - 0.35, 0.14, 24), padTop); top.position.set(x, y + 0.07, z);
  world.add(base, top);
}

// a roofless hut: four walls, with a 2 m doorway on each side named in `doors` (n, s, e, w)
export function hut(x, z, w, d, h, mat, doors) {
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
export function tower(x, z, s, deckM, stepM, railM) {
  addBox(x, z, 5, 4, 0.4, 2.6, deckM);
  for (const dx of [-2.3, 2.3]) for (const dz of [-1.8, 1.8]) addBox(x + dx, z + dz, 0.3, 0.3, 2.6, 0, deckM);
  addBox(x, z + 1.95, 5, 0.1, 1, 3, railM); addBox(x, z - 1.95, 5, 0.1, 1, 3, railM); addBox(x - s * 2.45, z, 0.1, 4, 1, 3, railM);
  stairs(x + s * 7.9, z, -s, 0, 6, 0, stepM, 0.5, 0.9, 1.6);
}


// empties the map before the next one is built
export function clearMap(scene) {
  scene.remove(world);
  world.traverse(o => { if (o.isMesh && o.geometry !== boxGeo) o.geometry.dispose(); });
  world.clear(); boxes.length = 0; SPAWNS.length = 0; STAIRS.length = 0; PADS.length = 0; ICE.length = 0; CHESTS.length = 0;
}
