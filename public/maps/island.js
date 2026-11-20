import { world, T, lambert, addBox as kAddBox, crate as kCrate, ground, perimeter, stairs as kStairs, wall as kWall, slab as kSlab, hut as kHut, tower as kTower, win } from '../kit.js';

// The places below are laid out round the middle and then pushed out from it by SPREAD (1.5), so there's open
// ground between them; buildings keep their size. Every builder call adds the offset of the place it's in.
const SPREAD = 1.5;
let OX = 0, OZ = 0;
const at = (cx, cz) => { OX = (SPREAD - 1) * cx; OZ = (SPREAD - 1) * cz; }; // the place centred on (cx, cz) moves out to SPREAD x that
const addBox = (x, z, ...r) => kAddBox(x + OX, z + OZ, ...r);
const crate = (x, z, ...r) => kCrate(x + OX, z + OZ, ...r);
const hut = (x, z, ...r) => kHut(x + OX, z + OZ, ...r);
const tower = (x, z, ...r) => kTower(x + OX, z + OZ, ...r);
const stairs = (x, z, dx, dz, n, y0, mat, rise, run, w, via) => kStairs(x + OX, z + OZ, dx, dz, n, y0, mat, rise, run, w, via && via.map(([vx, vz]) => [vx + OX, vz + OZ]));
const slab = (x0, x1, z0, z1, top, mat, hole) => kSlab(x0 + OX, x1 + OX, z0 + OZ, z1 + OZ, top, mat, hole && [hole[0] + OX, hole[1] + OX, hole[2] + OZ, hole[3] + OZ]);
const wall = (axis, a, b, c, y, h, mat, gaps = [], t) => {
  const du = axis === 'x' ? OX : OZ, dc = axis === 'x' ? OZ : OX;
  return kWall(axis, a + du, b + du, c + dc, y, h, mat, gaps.map(([g, ...r]) => [g + du, ...r]), t);
};

// ---------- Spud Island: the battle royale map, 240 x 240 (three and a half times a normal map each way) ----------
// Ringed by sea cliffs. Six places worth landing at, with open fields, woods and lone huts between them:
//   Spudville (north): a main street of roof-terrace houses, a plaza with a fountain and a ruined chapel.
//   Radio Hill (centre): a two-level radio tower, the highest point you can stand on (8.5 m), and two bunkers.
//   Mash Farm (west): a barn with a hayloft, a silo, a farmhouse and a field of hay bales.
//   Peel Fort (north-east): a walled stone plateau with a keep you can climb.
//   Fry Port (south-east): stacked shipping containers, a warehouse, a crane and the docks.
//   Tater Camp (south-west): cabins in the woods round two lookout towers.
// Every chest is listed in `chests` ([x, z, floor height]); the game spawns and fills them.
// Decorations (trees, rocks) come from a fixed seed, so every player online gets the same island.
export default function island() {
  const A = 120;
  OX = OZ = 0;
  let seed = 7331;
  const sr = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const sb = (a, b) => a + sr() * (b - a);
  const M = {
    rock: lambert('is_rock', () => ({ map: T.dirt(), color: 0x9a948a })), cliff: lambert('is_cliff', () => ({ map: T.dirt(), color: 0x8a8378 })),
    plaster: lambert('is_plaster', () => ({ map: T.concrete(), color: 0xf0e2c4 })), plaster2: lambert('is_plaster2', () => ({ map: T.concrete(), color: 0xd9b48a })),
    plaster3: lambert('is_plaster3', () => ({ map: T.concrete(), color: 0xc9d6c0 })), brick: lambert('is_brick', { color: 0xa5523a }),
    roof: lambert('is_roof', () => ({ map: T.concrete(), color: 0x8a8070 })), step: lambert('is_step', { color: 0x9a8f7e }),
    stone: lambert('is_stone', () => ({ map: T.concrete(), color: 0xb3ab9a })), wood: lambert('is_wood', () => ({ map: T.planks(2, 1) })),
    barn: lambert('is_barn', { color: 0xa8382c }), barnRoof: lambert('is_barnroof', { color: 0x4a3b34 }), hay: lambert('is_hay', { color: 0xd8b452 }),
    metal: lambert('is_metal', { color: 0x9aa3a8 }), dark: lambert('is_dark', { color: 0x3a3d42 }), road: lambert('is_road', { color: 0x9d8a68 }),
    water: lambert('is_water', { color: 0x2f7fb3 }), sand: lambert('is_sand', () => ({ map: T.sand(), color: 0xf0dcae })),
    trunk: lambert('is_trunk', { color: 0x6b4a2b }), leaf: lambert('is_leaf', { color: 0x4f8f34 }), leaf2: lambert('is_leaf2', { color: 0x3f7a2b }),
    pine: lambert('is_pine', { color: 0x2f6a3a }), red: lambert('is_red', { color: 0xc8432f }), white: lambert('is_white', { color: 0xeeeeee }),
    c1: lambert('is_c1', { color: 0x2f6fb0 }), c2: lambert('is_c2', { color: 0xc8582f }), c3: lambert('is_c3', { color: 0x3f8f5a }), c4: lambert('is_c4', { color: 0xd2a63a }),
  };
  ground(T.grass());
  perimeter(M.cliff, 10, A);
  const chests = [], spawns = [];
  const chest = (x, z, y = 0) => chests.push([x + OX, z + OZ, y]);
  const spawn = (...pts) => spawns.push(...pts.map(([x, z]) => [x + OX, z + OZ]));
  const deco = (x, z, w, d, h, y, m) => addBox(x, z, w, d, h, y, m, false);
  // a flat strip on the ground from (x0, z0) to (x1, z1), any angle (only for looks)
  const strip = (x0, z0, x1, z1, w, m, y = 0.01) => {
    [x0, z0, x1, z1] = [x0, z0, x1, z1].map(v => v * SPREAD); const ox = OX, oz = OZ; OX = OZ = 0; // roads stretch with the gaps
    const L = Math.hypot(x1 - x0, z1 - z0), s = deco((x0 + x1) / 2, (z0 + z1) / 2, w, L, 0.02, y, m); OX = ox; OZ = oz;
    s.rotation.y = Math.atan2(x1 - x0, z1 - z0); s.castShadow = false;
  };
  // the sea round the cliffs, and a beach under them
  for (const [x, z, w, d] of [[0, -A - 40, 2 * A + 160, 78], [0, A + 40, 2 * A + 160, 78], [-A - 40, 0, 78, 2 * A + 2], [A + 40, 0, 78, 2 * A + 2]]) { const s = deco(x, z, w, d, 0.05, 0.02, M.water); s.castShadow = false; }

  // ---------- builders ----------
  // a house with a flat roof terrace: door on one side, stairs up the outside on the east (s = 1) or west (s = -1)
  function house(x, z, w, d, door, wm, y = 0, s = 1) {
    const H = 3.4, x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, dr = c => [c, 2, 0, 2.6];
    wall('x', x0, x1, z0, y, H, wm, door === 'n' ? [dr(x), win(x0 + 1.6), win(x1 - 1.6)] : [win(x0 + 2), win(x1 - 2)]);
    wall('x', x0, x1, z1, y, H, wm, door === 's' ? [dr(x), win(x0 + 1.6), win(x1 - 1.6)] : [win(x0 + 2), win(x1 - 2)]);
    wall('z', z0 + 0.2, z1 - 0.2, x0, y, H, wm, door === 'w' ? [dr(z)] : [win(z)]);
    wall('z', z0 + 0.2, z1 - 0.2, x1, y, H, wm, door === 'e' ? [dr(z)] : [win(z)]);
    slab(x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2, y + H, M.roof);
    const sx = x + s * (w / 2 + 1), zs = z1 - 0.3;
    stairs(sx, zs, 0, -1, 8, y, M.step, 0.425, 0.75, 1.6);
    addBox(sx, zs - 6.9, 1.6, 2, 0.3, y + H - 0.3, M.roof);
    // a low parapet round the roof, open on the stairs side
    wall('x', x0 - 0.2, x1 + 0.2, z0 - 0.05, y + H, 0.9, wm, [], 0.3);
    wall('x', x0 - 0.2, x1 + 0.2, z1 + 0.05, y + H, 0.9, wm, [], 0.3);
    wall('z', z0 + 0.1, z1 - 0.1, s > 0 ? x0 - 0.05 : x1 + 0.05, y + H, 0.9, wm, [], 0.3);
    crate(x - s * (w / 2 - 1.1), z + (door === 'n' ? 1 : -1) * (d / 2 - 1.1), y, 1.2);
  }
  // a log cabin: walls, one door, a roof
  function cabin(x, z, door) {
    hut(x, z, 6, 5, 2.8, M.wood, door);
    addBox(x, z, 6.6, 5.6, 0.3, 2.8, M.barnRoof);
  }
  // a shipping container along x, at floor y
  const box = (x, z, y, m) => addBox(x, z, 6.1, 2.5, 2.6, y, m);
  // a tree: a solid trunk under a cloud of leaves; pines are a stack of cones
  const coneG = new THREE.ConeGeometry(2.2, 3.4, 8), leafG = new THREE.IcosahedronGeometry(2.5, 1);
  function tree(x, z, pine) {
    addBox(x, z, 0.7, 0.7, pine ? 3 : 3.6, 0, M.trunk);
    const s = sb(0.85, 1.35);
    if (pine) for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(coneG, M.pine); c.position.set(x + OX, 3 + k * 1.6 * s, z + OZ); c.scale.setScalar(s * (1 - k * 0.22)); c.castShadow = true; world.add(c); }
    else { const l = new THREE.Mesh(leafG, sr() < 0.5 ? M.leaf : M.leaf2); l.position.set(x + OX, 4.6 * s, z + OZ); l.scale.set(s, s * sb(0.85, 1.15), s); l.castShadow = true; world.add(l); }
  }

  // ---------- Spudville (north) ----------
  at(0, -44);
  strip(-34, -42, 34, -42, 6, M.road); strip(0, -39, 0, -4, 5, M.road);
  const town = [[-24, -52, 's', M.plaster, 1], [-12, -52, 's', M.plaster2, 1], [12, -52, 's', M.plaster3, -1], [24, -52, 's', M.plaster, -1],
    [-24, -32, 'n', M.plaster3, 1], [-12, -32, 'n', M.plaster, 1], [12, -32, 'n', M.plaster2, -1], [24, -32, 'n', M.plaster3, -1]];
  for (const [x, z, door, m, s] of town) {
    house(x, z, 8, 8, door, m, 0, s);
    chest(x - s * 2, z + (door === 'n' ? -2 : 2));
  }
  chest(-24, -52, 3.4); chest(24, -32, 3.4); chest(-12, -32, 3.4);
  // the plaza and its fountain
  addBox(0, -42, 4.4, 4.4, 0.7, 0, M.stone); addBox(0, -42, 0.9, 0.9, 2.2, 0, M.stone);
  deco(0, -42, 3.6, 3.6, 0.05, 0.7, M.water);
  // the ruined chapel: no roof, pews for cover, the bell tower behind it
  wall('x', -5, 5, -49, 0, 6, M.stone, [[0, 3, 0, 4]]);
  wall('x', -5, 5, -63, 0, 6, M.stone);
  wall('z', -62.8, -49.2, -5, 0, 6, M.stone, [win(-59), win(-53)]);
  wall('z', -62.8, -49.2, 5, 0, 4.2, M.stone, [win(-59), [-53, 2.6, 0, 3]]); // a collapsed corner you can walk through
  for (const z of [-52, -54.5, -57]) for (const x of [-2.6, 2.6]) addBox(x, z, 3, 0.6, 0.9, 0, M.wood);
  addBox(0, -61, 3, 1.2, 1.1, 0, M.stone); chest(0, -59.6);
  addBox(0, -65.5, 4, 4, 12, 0, M.stone); deco(0, -65.5, 4.6, 4.6, 0.6, 12, M.roof);
  // a water tower west of town and a market east of it
  tower(-38, -48, 1, M.wood, M.step, M.dark); chest(-38, -48, 3);
  deco(-38, -48, 3.2, 3.2, 2.4, 3.4, M.metal);
  for (const [x, z] of [[34, -44], [38, -38]]) { addBox(x, z, 3.2, 1, 1.1, 0, M.wood); deco(x, z, 3.8, 2.6, 0.08, 2.7, M.red); }
  chest(36, -41);
  spawn([-30, -42], [-6, -42], [6, -42], [30, -42], [0, -36], [-18, -47], [18, -37]);

  // ---------- Radio Hill (centre) ----------
  at(0, 0);
  addBox(0, 8, 10, 10, 0.3, 3.95, M.metal); // the first deck, top 4.25
  for (const x of [-4.85, 4.85]) for (const z of [3.15, 12.85]) addBox(x, z, 0.3, 0.3, 3.95, 0, M.dark);
  stairs(12.5, 8, -1, 0, 10, 0, M.step, 0.425, 0.75, 2);
  wall('x', -5, 5, 3.05, 4.25, 1, M.dark, [], 0.1); wall('x', -5, 5, 12.95, 4.25, 1, M.dark, [], 0.1);
  wall('z', 3.1, 12.9, -4.95, 4.25, 1, M.dark, [], 0.1);
  stairs(-4.2, 4.2, 1, 0, 10, 4.25, M.step, 0.425, 0.54, 1.6); // up to the top deck, 8.5
  addBox(3, 5, 3.6, 3.6, 0.3, 8.2, M.metal);
  wall('x', 1.2, 4.8, 3.25, 8.5, 1, M.dark, [], 0.1); wall('z', 3.3, 6.8, 4.75, 8.5, 1, M.dark, [], 0.1);
  for (const [x, z] of [[1.4, 3.4], [4.6, 3.4], [1.4, 6.6], [4.6, 6.6]]) deco(x, z, 0.15, 0.15, 14, 8.5, M.red);
  deco(3, 5, 3.4, 0.15, 0.15, 15.5, M.red); deco(3, 5, 0.15, 3.4, 0.15, 19, M.red); deco(3, 5, 0.3, 0.3, 4, 22.5, M.white);
  chest(3, 6, 8.5); chest(-2, 10); chest(-3, 6, 4.25);
  // two bunkers
  for (const [x, z, door] of [[-14, 14, 'e'], [14, -2, 'w']]) { hut(x, z, 6, 5, 2.4, M.stone, door); addBox(x, z, 6.6, 5.6, 0.4, 2.4, M.stone); chest(x, z); }
  for (const [x, z] of [[-9, 2], [9, 16], [-6, 18], [16, 10]]) addBox(x, z, 2.8, 0.8, 1.1, 0, M.stone); // sandbags
  spawn([0, 20], [-12, 4], [10, 2], [20, 14], [-18, 22]);

  // ---------- Mash Farm (west) ----------
  at(-48, 4);
  strip(-34, 6, -6, 6, 5, M.road); strip(-50, 12, -50, 30, 4, M.road);
  // the barn: doors at both ends, a hayloft over the north half, stairs up from inside
  wall('x', -57, -43, -10, 0, 7, M.barn, [[-50, 4, 0, 4]]);
  wall('x', -57, -43, 10, 0, 7, M.barn, [[-50, 4, 0, 4]]);
  wall('z', -9.8, 9.8, -57, 0, 7, M.barn, [win(-5), win(5)]);
  wall('z', -9.8, 9.8, -43, 0, 7, M.barn, [win(-5), [4, 2.4, 0, 2.8]]);
  slab(-56.8, -43.2, -9.8, 1, 3.4, M.wood);
  stairs(-54.6, 7, 0, -1, 8, 0, M.step, 0.425, 0.75, 1.6, [[-50, 12], [-50, 7.5], [-41, 4], [-45, 4]]);
  wall('x', -56.8, -43.2, 1.05, 3.4, 1, M.wood, [[-54.6, 2.2, 0, 9]], 0.15);
  for (const s of [-1, 1]) { const r = deco(-50 + s * 3.6, 0, 7.8, 20.8, 0.2, 8.5, M.barnRoof); r.rotation.z = -s * 0.4; }
  for (const [x, z, y] of [[-55, -7, 0], [-45.5, -6, 0], [-55.5, -4, 3.4], [-45, -8, 3.4], [-47, 7, 0]]) addBox(x, z, 1.6, 1.2, 1.2, y, M.hay);
  chest(-50, -6, 3.4); chest(-44.8, -4, 3.4); chest(-52, 4);
  // silo and farmhouse
  addBox(-38, -8, 4.4, 4.4, 12, 0, M.metal);
  { const c = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.metal); c.position.set(-38 + OX, 12, -8 + OZ); world.add(c); }
  chest(-38, -4.6);
  house(-64, 24, 8, 8, 'n', M.plaster2, 0, 1); chest(-66, 22); chest(-64, 24, 3.4);
  // the field: a fence with gaps and hay bales for cover
  for (const [x0, x1, z] of [[-44, -38, 18], [-34, -26, 18], [-44, -26, 32]]) wall('x', x0, x1, z, 0, 1, M.wood, [], 0.15);
  wall('z', 18, 25, -44, 0, 1, M.wood, [], 0.15); wall('z', 28, 32, -26, 0, 1, M.wood, [], 0.15);
  for (const [x, z] of [[-40, 22], [-34, 25], [-30, 21], [-38, 28.5], [-30, 29]]) addBox(x, z, 1.6, 1.2, 1.2, 0, M.hay);
  chest(-35, 21.5);
  addBox(-60, 8, 3, 1.8, 1.4, 0, M.red); addBox(-61, 8, 1.2, 1.6, 2.4, 0, M.red); // tractor
  spawn([-50, 14], [-34, 0], [-60, -2], [-36, 14], [-52, 34]);

  // ---------- Peel Fort (north-east) ----------
  at(48, -42);
  addBox(48, -42, 28, 24, 3, 0, M.stone);
  stairs(48, -24.6, 0, -1, 6, 0, M.step, 0.5, 0.9, 3); stairs(28.6, -42, 1, 0, 6, 0, M.step, 0.5, 0.9, 3);
  stairs(48, -59.4, 0, 1, 6, 0, M.step, 0.5, 0.9, 3); stairs(67.4, -42, -1, 0, 6, 0, M.step, 0.5, 0.9, 3);
  const gap = c => [c, 3.6, 0, 9];
  wall('x', 34, 62, -53.8, 3, 1.3, M.stone, [gap(48)]); wall('x', 34, 62, -30.2, 3, 1.3, M.stone, [gap(48)]);
  wall('z', -53.6, -30.4, 34.2, 3, 1.3, M.stone, [gap(-42)]); wall('z', -53.6, -30.4, 61.8, 3, 1.3, M.stone, [gap(-42)]);
  house(46, -44, 9, 8, 's', M.stone, 3, 1);
  chest(48.5, -46, 3); chest(46, -44, 6.4); chest(37, -51, 3); chest(59, -33, 3); chest(40, -36, 0 + 3);
  for (const [x, z] of [[38, -33], [58, -51], [56, -36]]) addBox(x, z, 2.4, 1, 1.2, 3, M.stone);
  spawn([48, -20], [24, -42], [68, -28], [36, -62]);

  // ---------- Fry Port (south-east) ----------
  at(48, 52);
  strip(6, 14, 30, 34, 5, M.road);
  for (const [x, m] of [[32, M.c1], [40, M.c2], [54, M.c3], [62, M.c4]]) box(x, 34, 0, m);
  for (const [x, m] of [[32, M.c3], [40, M.c4], [54, M.c1], [62, M.c2]]) box(x, 40, 0, m);
  box(54, 40, 2.6, M.c2);
  for (const [x, m] of [[36, M.c2], [44, M.c1], [58, M.c4], [66, M.c3]]) box(x, 48, 0, m);
  box(66, 48, 2.6, M.c1);
  stairs(40, 45.25, 0, -1, 5, 0, M.step, 0.52, 0.8, 1.6);
  stairs(53.8, 49.25, 0, -1, 10, 0, M.step, 0.52, 0.8, 1.4);
  chest(40, 40, 2.6); chest(54, 40, 5.2); chest(47, 37); chest(50, 44); chest(70, 41);
  // the warehouse
  hut(40, 64, 18, 10, 5, M.metal, 'ne');
  for (const [x, z] of [[34, 61], [35, 66.5], [46, 66.5], [44, 61.5]]) crate(x, z, 0, 1.6);
  chest(37.5, 64); chest(46.5, 63.5);
  // docks, a crane and a lighthouse
  for (let x = 52; x <= 76; x += 6) { const p = deco(x, 75, 5.6, 9.6, 0.15, 0, M.wood); p.receiveShadow = true; }
  tower(60, 64, -1, M.metal, M.step, M.dark); deco(60, 64, 0.5, 0.5, 9, 3, M.c4); deco(57, 64, 7, 0.5, 0.5, 11.5, M.c4);
  chest(60, 64, 3);
  addBox(72, 72, 3.6, 3.6, 9, 0, M.white); deco(72, 72, 3.8, 3.8, 1.2, 4, M.red); deco(72, 72, 2.4, 2.4, 1.6, 9, M.c4);
  for (const x of [54, 64]) addBox(x, 70.6, 0.6, 0.6, 0.8, 0, M.dark);
  spawn([48, 30], [30, 56], [58, 58], [70, 30], [24, 44]);

  // ---------- Tater Camp (south-west) ----------
  at(-50, 52);
  strip(-6, 14, -40, 46, 4, M.road);
  for (const [x, z, door] of [[-58, 40, 'e'], [-38, 40, 'w'], [-56, 62, 'n'], [-34, 60, 'n']]) { cabin(x, z, door); chest(x, z); }
  tower(-48, 50, 1, M.wood, M.step, M.dark); chest(-48, 50, 3);
  tower(-68, 68, 1, M.wood, M.step, M.dark); chest(-68, 68, 3);
  for (const [x, z, w, d] of [[-44, 56, 3.2, 0.6], [-50, 45, 0.6, 3.2], [-62, 52, 3.4, 0.7]]) addBox(x, z, w, d, 0.7, 0, M.trunk); // logs
  for (let i = 0; i < 6; i++) deco(-44 + Math.cos(i) * 0.9, 44 + Math.sin(i) * 0.9, 0.35, 0.35, 0.3, 0, M.stone);
  spawn([-46, 34], [-30, 50], [-62, 46], [-44, 66]);

  // ---------- lone spots ----------
  // a gas station on the road east of Radio Hill
  at(33, -7);
  for (const [x, z] of [[27, -10], [33, -10], [27, -4], [33, -4]]) addBox(x, z, 0.35, 0.35, 4, 0, M.white);
  deco(30, -7, 8, 8, 0.4, 4, M.red);
  for (const z of [-8.5, -5.5]) addBox(30, z, 0.8, 0.6, 1.4, 0, M.dark);
  hut(40, -7, 6, 6, 3, M.plaster, 'w'); addBox(40, -7, 6.6, 6.6, 0.3, 3, M.roof); chest(41, -7); chest(30, -7);
  // shacks
  for (const [x, z, door] of [[-22, 30, 'n'], [18, 30, 's'], [-28, -18, 'e'], [22, -22, 'w']]) { at(x, z); cabin(x, z, door); chest(x, z); }
  // the ruins east of the hill
  at(63, 8);
  wall('x', 58, 68, 4, 0, 3, M.brick, [[61, 2, 0, 9]]); wall('z', 4.2, 12, 68, 0, 2.2, M.brick); wall('x', 62, 68, 12, 0, 1.4, M.brick);
  chest(64, 8);
  for (const [x, z] of [[-70, -50], [-12, 70], [10, 56], [-66, -20]]) { at(x, z); chest(x, z); }
  for (const [x, z] of [[30, 4], [-22, 38], [18, 22], [-36, -22], [56, 14], [-70, -60], [-10, 62], [10, 64], [-70, 0], [70, -6]]) { at(x, z); spawn([x, z]); }
  // the open ground between places gets a few more shacks with a chest each
  OX = OZ = 0;
  for (const [x, z, door] of [[-60, -78, 'e'], [100, -100, 'w'], [100, -30, 'w'], [-98, 22, 'e'], [-8, 100, 'n'], [-104, -104, 'e'], [-30, -96, 's'], [40, 104, 'n']]) { cabin(x, z, door); chest(x, z); spawn([x + 5, z + 5]); }

  // ---------- trees and rocks, kept out of the places above ----------
  const keepOut = [[-36, 36, -70, -24], [-20, 20, -6, 22], [-72, -24, -14, 36], [26, 72, -64, -18], [22, 78, 26, 80], [-72, -26, 30, 74],
    [22, 46, -14, 0], [-28, -14, 24, 36], [12, 26, 24, 36], [-34, -22, -24, -12], [16, 28, -28, -16], [54, 72, 0, 16], [-6, 6, -40, 0]];
  for (const k of keepOut) for (let i = 0; i < 4; i++) k[i] *= SPREAD;
  const free = (x, z, pad) => !keepOut.some(([x0, x1, z0, z1]) => x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad)
    && ![...chests, ...spawns].some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 3 + pad);
  const placed = [];
  for (let i = 0, n = 0; i < 1600 && n < 210; i++) {
    const x = sb(-A + 4, A - 4), z = sb(-A + 4, A - 4);
    if (!free(x, z, 1.5) || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 5)) continue;
    placed.push([x, z]); n++;
    tree(x, z, z > 30 || sr() < 0.25);
  }
  for (let i = 0, n = 0; i < 1000 && n < 70; i++) {
    const x = sb(-A + 5, A - 5), z = sb(-A + 5, A - 5);
    if (!free(x, z, 2) || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 4)) continue;
    placed.push([x, z]); n++;
    const w = sb(1.6, 3.4), d = sb(1.4, 3), h = sb(1, 2.2); addBox(x, z, w, d, h, 0, M.rock);
  }
  // a beach strip along the cliff foot, for looks
  for (const [x, z, w, d] of [[0, -A + 1.2, 2 * A, 2.4], [0, A - 1.2, 2 * A, 2.4], [-A + 1.2, 0, 2.4, 2 * A], [A - 1.2, 0, 2.4, 2 * A]]) { const s = deco(x, z, w, d, 0.02, 0.01, M.sand); s.castShadow = false; }

  return { sky: 0x9fd0ee, fog: [110, 320], spawns, chests, half: A - 6 };
}
