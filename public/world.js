// Maps: textures, collision boxes and spawn points. Every solid thing is an axis-aligned box.
// Both maps are 64 x 64 inside the perimeter wall, so bounds elsewhere stay the same.
import { R } from './config.js';

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);

export const MAPS = { depot: 'Depot', yard: 'Market Yard' };
export const boxes = [];   // { min, max } solid boxes of the loaded map
export const SPAWNS = [];  // [x, z] ground spawn points of the loaded map
export const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export let currentMap = null;

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
function perimeter(mat, h) {
  const A = 32;
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
    for (let i = 1; i <= 6; i++) addBox(2.5 + (6 - i) * 0.9 + 0.45, z, 0.9, 1.6, i * 0.5, 0, M.dock);
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

// Clears the current map and builds `name` (falls back to the default map).
export function loadMap(scene, name) {
  if (!MAPS[name]) name = 'depot';
  scene.remove(world);
  world.traverse(o => { if (o.isMesh && o.geometry !== boxGeo) o.geometry.dispose(); });
  world.clear(); boxes.length = 0; SPAWNS.length = 0;
  const m = name === 'yard' ? yard() : depot();
  scene.add(world);
  scene.background = new THREE.Color(m.sky);
  scene.fog = new THREE.Fog(m.sky, m.fog[0], m.fog[1]);
  for (const [x, z] of m.spawns) if (!boxes.some(b => b.min.y < 1 && x + R > b.min.x && x - R < b.max.x && z + R > b.min.z && z - R < b.max.z)) SPAWNS.push([x, z]);
  console.assert(SPAWNS.length >= 8, `map ${name} has only ${SPAWNS.length} clear spawns`);
  currentMap = name;
  return name;
}
