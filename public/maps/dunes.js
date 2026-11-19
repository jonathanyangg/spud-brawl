import { rand, boxGeo, world, T, lambert, addBox, crate, ground, perimeter, stairs, wall, slab, pad, hut, tower, win } from '../kit.js';

// ---------- Dunes: a canyon town split into three canyons by two rock ridges ----------
// West canyon: a mud-brick kasbah (halls, a keep, a terrace and a keep roof at 7.2 m), a house, a lookout and a mine
// office, behind a tall ridge you can only pass by the north gap, the long middle tunnel or the bent mine tunnel.
// Middle: a market street between two houses joined by a bridge (north), the plaza with a minaret on top and tunnels
// underneath (centre), and a temple and a house joined by a stone bridge over the dry riverbed (south).
// East: a walkable 4 m ridge that every roof in the middle joins, a covered tunnel walkway into a two-storey
// caravanserai, a water tower and a bazaar lane.
// Levels: ground, plaza 2.5, roofs / ridge / bridges / terrace 4, water tower 6.5, keep roof 7.2, minaret 8.
export default function dunes() {
  const M = {
    mud: lambert('du_mud', () => ({ map: T.concrete(), color: 0xe6b77e })), mud2: lambert('du_mud2', () => ({ map: T.concrete(), color: 0xcf9460 })),
    stone: lambert('du_stone', { color: 0xc49a62 }), step: lambert('du_step', { color: 0xb48a5a }), dark: lambert('du_dark', { color: 0x7a5a3a }),
    floor: lambert('du_floor', () => ({ map: T.concrete(), color: 0xb89a74 })), beam: lambert('du_beam', { color: 0x5e4129 }),
    rock: lambert('du_rock', () => ({ map: T.dirt(), color: 0xe0b483 })), rock2: lambert('du_rock2', () => ({ map: T.dirt(), color: 0xc9925f })),
    wood: lambert('du_wood', () => ({ map: T.planks(2, 1) })), bed: lambert('du_bed', { color: 0xbf9866 }), tank: lambert('du_tank', { color: 0x7b8a8f }),
    dome: lambert('du_dome', { color: 0x3f8f8a }), far: lambert('du_far', () => ({ map: T.dirt(), color: 0xd29a62 })),
    cloth: lambert('du_cloth', { color: 0xb0412e, side: THREE.DoubleSide }), cloth2: lambert('du_cloth2', { color: 0x2f7f8f, side: THREE.DoubleSide }),
    cloth3: lambert('du_cloth3', { color: 0xd9a13a, side: THREE.DoubleSide }),
  };
  ground(T.sand());
  perimeter(M.rock2, 12); // tall enough that nothing climbable gets you over it

  const door = (c, w = 2.4, top = 2.8) => [c, w, 0, top];
  const open = (c, w = 2.6) => [c, w, 0, 9]; // full-height gap in a parapet
  const deco = (x, z, w, d, h, y, m) => addBox(x, z, w, d, h, y, m, false);
  const sheet = (x, z, w, d, y, m, rx = 0, rz = 0) => {
    const a = new THREE.Mesh(boxGeo, m); a.scale.set(w, 0.08, d); a.position.set(x, y, z); a.rotation.set(rx, 0, rz); a.castShadow = true; world.add(a);
  };
  // a market stall: a counter (cover) under an awning on two posts
  const stall = (x, z, alongX, m) => {
    addBox(x, z, alongX ? 3.2 : 1, alongX ? 1 : 3.2, 1.1, 0, M.wood);
    for (const s of [-1, 1]) deco(x + (alongX ? s * 1.7 : 0), z + (alongX ? 0 : s * 1.7), 0.15, 0.15, 2.7, 0, M.dark);
    sheet(x, z, alongX ? 3.8 : 2.6, alongX ? 2.6 : 3.8, 2.7, m, alongX ? 0.12 : 0, alongX ? 0 : 0.12);
  };
  // roof beams poking out of a mud wall
  const vigas = (axis, a, b, c, y, s) => {
    for (let u = a + 0.7; u < b - 0.3; u += 1.4) axis === 'x' ? deco(u, c + s * 0.35, 0.18, 0.5, 0.18, y, M.beam) : deco(c + s * 0.35, u, 0.5, 0.18, 0.18, y, M.beam);
  };
  const dome = (x, z, y, r) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.dome); d.position.set(x, y, z); d.castShadow = true; world.add(d);
  };

  // ---------- the ridges ----------
  // west: 9.5 m of rock (10.5 beside the kasbah, whose roof is close), cut by the north gap, the middle tunnel and the mine
  addBox(-14.5, -25.5, 5, 13, 10.5, 0, M.rock2);
  addBox(-14.5, -8.25, 5, 11.5, 9.5, 0, M.rock2);
  addBox(-14.5, 7.25, 5, 9.5, 9.5, 0, M.rock2);
  addBox(-14.5, 0, 5, 5, 6.3, 3.2, M.rock2); // over the middle tunnel
  // the mine: in from the west canyon at z 26, north along the ridge, out into the middle at z 16
  addBox(-14.5, 13.25, 5, 2.5, 9.5, 0, M.rock2); addBox(-14.5, 29.75, 5, 4.5, 9.5, 0, M.rock2);
  addBox(-16.5, 19.5, 1, 10, 9.5, 0, M.rock2); addBox(-12.5, 22.5, 1, 10, 9.5, 0, M.rock2);
  addBox(-14.5, 21, 5, 13, 6.5, 3, M.rock2); // mine roof
  for (const z of [24.3, 27.7]) wall('x', -21, -17, z, 0, 3, M.wood); // timbered portals stick out of the rock
  addBox(-19, 26, 4, 3.8, 0.3, 3, M.wood);
  for (const z of [14.3, 17.7]) wall('x', -12, -9, z, 0, 3, M.wood);
  addBox(-10.5, 16, 3, 3.8, 0.3, 3, M.wood);
  for (let z = 15.5; z < 27.5; z += 2.4) deco(-14.5, z, 3, 0.25, 0.25, 2.7, M.beam);
  for (const x of [-15, -14]) deco(x, 21, 0.08, 12, 0.06, 0, M.dark); // rails
  for (const z of [25.5, 26.5]) deco(-18.5, z, 6, 0.08, 0.06, 0, M.dark);
  for (const [x, z, h] of [[-17.6, -12, 10.5], [-11.4, 8, 10.5], [-17.7, 31, 11]]) addBox(x, z, 1.6, 3, h, 0, M.rock2); // crags
  // middle tunnel portal on the west side
  for (const z of [-2.7, 2.7]) wall('x', -21, -17, z, 0, 3.2, M.wood);
  addBox(-19, 0, 4, 5.8, 0.3, 3.2, M.wood);

  // east: 4 m, walkable end to end, plank bridges over its gaps, an arch over the tunnel
  for (const [z0, z1] of [[-32, -19], [-14, -2.5], [2.5, 14], [19, 32]]) addBox(14.5, (z0 + z1) / 2, 5, z1 - z0, 4, 0, M.rock);
  addBox(14.5, 0, 5, 5, 0.6, 3.4, M.rock);
  for (const z of [-16.5, 16.5]) addBox(14.5, z, 2.2, 5.4, 0.3, 3.7, M.wood);
  for (const [x, z] of [[13.4, -25], [15.8, -9], [13.2, 6], [15.8, 23]]) addBox(x, z, 1.4, 2.4, 1.2, 4, M.rock); // boulders for cover
  stairs(23.4, -25, -1, 0, 8, 0, M.step, 0.5, 0.8, 2); stairs(23.4, 25, -1, 0, 8, 0, M.step, 0.5, 0.8, 2);
  pad(8.5, -10, 14.5, -10, 4); pad(8.5, 10, 14.5, 10, 4);

  // ---------- west canyon ----------
  // the kasbah, in the north-west corner (the boundary is its back walls): south hall and north hall on the ground,
  // stairs up from the north hall into the keep, out onto the terrace, and up again onto the keep roof
  wall('z', -32, -19.2, -21, 0, 4, M.mud2, [door(-22.4), win(-28)]);
  wall('x', -32, -20.8, -19, 0, 4, M.mud2, [door(-24.5)]);
  wall('x', -32, -21.2, -26, 0, 4, M.mud2, [door(-24.5)]);
  slab(-32, -20.8, -32, -18.8, 4, M.floor, [-28.6, -22.6, -32, -29.8]);
  stairs(-22.6, -30.8, -1, 0, 8, 0, M.step, 0.5, 0.75, 2);
  addBox(-25.3, -29.75, 5.4, 0.1, 1, 4, M.dark); addBox(-22.55, -30.85, 0.1, 2.3, 1, 4, M.dark); // rails round the stairwell
  wall('x', -32, -20.8, -26, 4, 3.2, M.mud2, [door(-29.5, 2.4, 2.6), win(-26.5)]);
  wall('z', -32, -26.2, -21, 4, 3.2, M.mud2, [win(-29)]);
  slab(-32, -20.8, -32, -25.8, 7.2, M.floor);
  wall('x', -32, -20.8, -19, 4, 1, M.mud2, [open(-28.5)]);
  wall('z', -25.8, -19.2, -21, 4, 1, M.mud2, [open(-22.4, 2.2)]);
  stairs(-28.5, -13, 0, -1, 8, 0, M.step, 0.5, 0.75, 2.4); // the grand stair up to the terrace
  stairs(-23, -21.5, 0, -1, 6, 4, M.step, 3.2 / 6, 0.75, 2); // terrace to keep roof
  wall('x', -32, -20.8, -25.95, 7.2, 0.6, M.mud2, [open(-23, 2.4)], 0.3);
  wall('z', -32, -26.1, -20.95, 7.2, 0.6, M.mud2, [], 0.3);
  vigas('x', -32, -21, -19, 3.5, 1); vigas('z', -32, -19, -21, 3.5, 1); vigas('x', -32, -21, -26, 6.7, 1); vigas('z', -32, -26, -21, 6.7, 1);
  crate(-30.5, -27.5, 0, 1.4); crate(-30.6, -23.5, 4, 1.2); crate(-19, -29, 0, 1.4);

  // a house with a roof terrace, steps up its side
  wall('z', -9, 1, -25, 0, 3.3, M.mud, [door(-1.5)]);
  wall('x', -32, -24.8, -9, 0, 3.3, M.mud);
  wall('x', -32, -24.8, 1, 0, 3.3, M.mud, [door(-28.5)]);
  slab(-32, -24.8, -9.2, 1.2, 3.6, M.floor);
  wall('z', -9.2, 1.2, -25, 3.6, 0.9, M.mud, [open(-6.5)]);
  wall('x', -32, -25.2, 1, 3.6, 0.9, M.mud);
  stairs(-19.4, -6.5, -1, 0, 8, 0, M.step, 0.45, 0.7, 2);
  vigas('x', -32, -25, 1, 3.0, 1);
  // a dry well and broken walls in the yard below the kasbah
  addBox(-22.5, -13, 2, 2, 0.9, 0, M.stone);
  for (const x of [-23.4, -21.6]) deco(x, -13, 0.15, 0.15, 2.4, 0.9, M.beam);
  deco(-22.5, -13, 2.2, 0.15, 0.15, 3.2, M.beam);
  for (const [x, z, w, d, h] of [[-25.5, -11, 3.6, 0.6, 1.6], [-20.5, 13.5, 3.4, 0.6, 1.5]]) addBox(x, z, w, d, h, 0, M.mud);
  // a lookout, and the mine office by the mine mouth
  tower(-28, 10, 1, M.wood, M.step, M.dark);
  hut(-27, 21.5, 6, 5.6, 3, M.wood, 'ne'); addBox(-27, 21.5, 6.4, 6, 0.3, 3, M.wood);
  crate(-28.6, 23, 0, 1.2); crate(-22, 30, 0, 1.4); crate(-30, 29.6, 0, 1.6);
  addBox(-19.5, 30, 1.2, 2, 1.1, 0, M.beam); // ore cart

  // ---------- middle: market street (north) ----------
  // west house against the ridge: stairs inside up to its roof; east house: its roof is level with the east ridge
  wall('z', -32, -21.2, -5, 0, 4, M.mud, [door(-24), win(-29)]);
  wall('x', -12, -4.8, -21, 0, 4, M.mud, [door(-7)]);
  slab(-12, -4.8, -32, -20.8, 4, M.floor, [-12, -9.6, -28.6, -22.6]);
  stairs(-10.6, -22.6, 0, -1, 8, 0, M.step, 0.5, 0.75, 2);
  addBox(-9.55, -25.3, 0.1, 5.4, 1, 4, M.dark); addBox(-10.75, -22.55, 2.5, 0.1, 1, 4, M.dark);
  wall('z', -32, -20.8, -5, 4, 1, M.mud, [open(-26)]); wall('x', -12, -5.2, -21, 4, 1, M.mud);
  wall('z', -32, -21.2, 5, 0, 4, M.mud2, [door(-27.5), win(-23.5)]);
  wall('x', 4.8, 12, -21, 0, 4, M.mud2, [door(9)]);
  slab(4.8, 12, -32, -20.8, 4, M.floor);
  wall('z', -32, -20.8, 5, 4, 1, M.mud2, [open(-26)]); wall('x', 5.2, 12, -21, 4, 1, M.mud2);
  addBox(0, -26, 10.4, 2.4, 0.3, 3.7, M.wood); // the bridge across the street
  for (const z of [-27.15, -24.85]) addBox(0, z, 9.6, 0.1, 1, 4, M.dark);
  vigas('z', -32, -21, -5, 3.5, 1); vigas('z', -32, -21, 5, 3.5, -1);
  crate(-7, -30.2, 0, 1.4); crate(9.5, -30, 0, 1.6); crate(7, -24, 0, 1.2); crate(-7, -30.2, 4, 1.2);
  stall(-3.4, -30.2, false, M.cloth); stall(3.4, -22.8, false, M.cloth2);
  sheet(0, -29.6, 9.4, 1.8, 3.1, M.cloth3); sheet(0, -22.4, 9.4, 1.8, 3.1, M.cloth); // awnings strung across the street
  // the market square in front: a well and stalls
  addBox(0, -16, 2.2, 2.2, 0.9, 0, M.stone);
  for (const x of [-0.95, 0.95]) deco(x, -16, 0.15, 0.15, 2.3, 0.9, M.beam);
  deco(0, -16, 2.4, 1.2, 0.12, 3.2, M.wood);
  stall(-8, -14.5, true, M.cloth3); stall(7.5, -16.5, true, M.cloth); stall(-2.5, -20, true, M.cloth2);

  // ---------- middle: the plaza ----------
  // 2.5 m up on four corner blocks, two tunnels cross underneath, steps up each side, a minaret on top that two
  // jump pads throw you onto
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(sx * 4, sz * 4, 4, 4, 2.1, 0, M.stone);
  addBox(0, 0, 12, 12, 0.4, 2.1, M.floor);
  stairs(-3.2, -10, 0, 1, 5, 0, M.step, 0.5, 0.8, 2.4); stairs(3.2, 10, 0, -1, 5, 0, M.step, 0.5, 0.8, 2.4);
  stairs(10, -3.2, -1, 0, 5, 0, M.step, 0.5, 0.8, 2.4); stairs(-10, 3.2, 1, 0, 5, 0, M.step, 0.5, 0.8, 2.4);
  for (const [x, z, h] of [[-5.3, -5.3, 3.6], [5.3, -5.3, 1.8], [5.3, 5.3, 3], [-5.3, 5.3, 2.2]]) addBox(x, z, 1, 1, h, 2.5, M.dark); // broken columns
  addBox(3.4, -3.4, 1.6, 0.5, 1.1, 2.5, M.mud); addBox(-3.4, 3.4, 0.5, 1.6, 1.1, 2.5, M.mud);
  addBox(0, 0, 2.2, 2.2, 5.1, 2.5, M.mud); // minaret shaft
  addBox(0, 0, 4.6, 4.6, 0.4, 7.6, M.stone); // balcony, top 8
  for (const s of [-1, 1]) { addBox(0, s * 2.15, 4.6, 0.3, 0.9, 8, M.mud); addBox(s * 2.15, 0, 0.3, 4, 0.9, 8, M.mud); }
  addBox(0, 0, 1.2, 1.2, 2.6, 8, M.mud); dome(0, 0, 10.6, 0.85);
  pad(0, -4.5, 0, -1.3, 8, 2.5, 2.5); pad(0, 4.5, 0, 1.3, 8, 2.5, 2.5);

  // ---------- middle: temple, dry riverbed and stone bridge (south) ----------
  wall('x', -12, -2.8, 21, 0, 4, M.mud2, [door(-7, 3), win(-4)]);
  wall('z', 21.2, 32, -3, 0, 4, M.mud2, [door(24.5)]);
  slab(-12, -2.8, 20.8, 32, 4, M.floor, [-12, -9.8, 22.6, 28.6]);
  stairs(-10.8, 22.6, 0, 1, 8, 0, M.step, 0.5, 0.75, 2);
  addBox(-9.75, 25.3, 0.1, 5.4, 1, 4, M.dark); addBox(-10.9, 22.55, 2.3, 0.1, 1, 4, M.dark);
  for (const z of [25.5, 29.5]) addBox(-6.5, z, 0.8, 0.8, 3.7, 0, M.stone); // pillars in the hall
  wall('x', -12, -2.8, 21, 4, 1, M.mud2); wall('z', 21.2, 32, -3, 4, 1, M.mud2, [open(27)]);
  addBox(-6.5, 29.6, 3.6, 3.6, 1, 4, M.mud2); dome(-6.5, 29.6, 5, 1.5); // rooftop shrine
  wall('z', 20.2, 32, 4, 0, 4, M.mud, [door(24), win(29)]);
  wall('x', 3.8, 12, 20, 0, 4, M.mud, [door(8.5)]);
  slab(3.8, 12, 19.8, 32, 4, M.floor);
  wall('z', 20.2, 32, 4, 4, 1, M.mud, [open(27)]); wall('x', 4.2, 12, 20, 4, 1, M.mud);
  addBox(0.5, 27, 7.6, 2.6, 0.6, 3.4, M.stone); // the bridge over the riverbed
  for (const z of [25.85, 28.15]) addBox(0.5, z, 6.6, 0.3, 0.6, 4, M.stone);
  vigas('x', -12, -3, 21, 3.5, -1); vigas('x', 4, 12, 20, 3.5, -1);
  crate(-4.5, 30.5, 0, 1.4); crate(9.5, 30, 0, 1.6); crate(6.5, 23, 0, 1.2);
  // the riverbed: a darker winding strip with pebbles, boulders to hide behind
  for (const [x, z, w, d] of [[0, 12.5, 4, 3], [0.8, 16.5, 4.6, 5], [1.6, 22, 5, 6.2], [0.6, 28.6, 5.6, 6.2]]) deco(x, z, w, d, 0.02, 0, M.bed);
  for (let i = 0; i < 26; i++) deco(rand(-1.8, 3.4), rand(11.5, 31.4), rand(0.2, 0.5), rand(0.2, 0.5), rand(0.08, 0.2), 0, M.stone);
  for (const [x, z, w, d, h] of [[-0.6, 18, 1.6, 1.2, 0.9], [2.6, 22.8, 1.2, 1.6, 1.1], [0.2, 30.4, 2, 1.2, 0.8]]) addBox(x, z, w, d, h, 0, M.rock);
  for (const [x, z, w, d, h] of [[-6, 13.5, 0.6, 3.2, 1.6], [7.5, 15.5, 3.2, 0.6, 1.6]]) addBox(x, z, w, d, h, 0, M.mud2);
  crate(-8, 18.5, 0, 1.4);

  // ---------- east canyon ----------
  // the tunnel under the ridge carries on as a covered passage whose roof is a walkway from the ridge
  // to the caravanserai's upper floor
  for (const z of [-2.7, 2.7]) wall('x', 17, 22, z, 0, 3.7, M.mud);
  slab(17, 23.8, -2.9, 2.9, 4, M.floor);
  for (const z of [-2.75, 2.75]) addBox(20.4, z, 6.8, 0.3, 0.8, 4, M.mud);
  // the caravanserai: two storeys against the east wall, stairs inside, windows over the canyon
  wall('z', -6.5, 6.5, 24, 0, 4, M.mud2, [door(0), win(-4)]);
  wall('x', 23.8, 32, -6.5, 0, 4, M.mud2, [door(28)]);
  wall('x', 23.8, 32, 6.5, 0, 4, M.mud2, [door(26.5)]);
  slab(23.8, 32, -6.7, 6.7, 4, M.floor, [29.4, 32, -1, 5]);
  stairs(30.4, 5, 0, -1, 8, 0, M.step, 0.5, 0.75, 2);
  addBox(29.35, 2.3, 0.1, 5.4, 1, 4, M.dark); addBox(30.7, 5.05, 2.6, 0.1, 1, 4, M.dark);
  wall('z', -6.5, 6.5, 24, 4, 3.2, M.mud2, [door(0, 2.4, 2.6), win(-4.2), win(4.2)]);
  wall('x', 23.8, 32, -6.5, 4, 3.2, M.mud2, [win(27), win(30.5)]);
  wall('x', 23.8, 32, 6.5, 4, 3.2, M.mud2, [win(27)]);
  slab(23.8, 32, -6.7, 6.7, 7.2, M.floor);
  vigas('z', -6.5, 6.5, 24, 3.5, -1); vigas('z', -6.5, 6.5, 24, 6.8, -1);
  crate(26, -4.5, 0, 1.4); crate(26.2, 4.6, 4, 1.2);
  // the water tower: a jump pad throws you onto its deck
  addBox(27, -18, 5, 5, 0.4, 6.1, M.wood);
  for (const dx of [-2.2, 2.2]) for (const dz of [-2.2, 2.2]) addBox(27 + dx, -18 + dz, 0.35, 0.35, 6.1, 0, M.beam);
  addBox(27, -18, 2.6, 2.6, 3.2, 6.5, M.tank);
  const tk = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 8), M.tank); tk.position.set(27, 8.1, -18); tk.rotation.y = Math.PI / 8; tk.castShadow = true; world.add(tk);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1, 8), M.dark); cap.position.set(27, 10.2, -18); cap.rotation.y = Math.PI / 8; world.add(cap);
  addBox(27, -20.45, 5, 0.1, 1, 6.5, M.dark); addBox(24.55, -18, 0.1, 4.8, 1, 6.5, M.dark); addBox(29.45, -18, 0.1, 4.8, 1, 6.5, M.dark);
  pad(27, -11.5, 27, -16.2, 6.5);
  for (const [x, z, w, d, h] of [[21, -12, 4, 0.6, 1.6], [30.5, -26, 0.6, 4, 1.6]]) addBox(x, z, w, d, h, 0, M.mud);
  crate(20, -29, 0, 1.6); crate(26, -29.5, 0, 1.4);
  // the bazaar lane, and a ruined granary in the corner
  stall(20.5, 9.5, true, M.cloth); stall(26.5, 9.5, true, M.cloth2); stall(20.5, 18.5, true, M.cloth3); stall(26.5, 18.5, true, M.cloth);
  sheet(23.5, 14, 10, 3, 3.2, M.cloth2);
  addBox(30.8, 14, 0.6, 3, 1.4, 0, M.mud);
  hut(28.4, 28.6, 6.4, 6, 2.6, M.mud2, 'nw');
  crate(29.5, 30, 0, 1.4); crate(20.5, 30, 0, 1.6);

  // ---------- scenery beyond the walls ----------
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 + rand(-0.15, 0.15), r = rand(55, 75), h = rand(10, 22);
    deco(Math.cos(a) * r, Math.sin(a) * r, rand(14, 26), rand(14, 26), h, 0, M.far).rotation.y = a;
  }
  const trunkM = lambert('du_palmT', { color: 0x8a6a3e }), leafM = lambert('du_palmL', { color: 0x5d8a3a, side: THREE.DoubleSide });
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2 + rand(-0.1, 0.1), r = rand(38, 50), x = Math.cos(a) * r, z = Math.sin(a) * r, h = rand(9, 13);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 6), trunkM); t.position.set(x, h / 2, z); t.castShadow = true; world.add(t);
    for (let k = 0; k < 5; k++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), leafM), ang = k / 5 * Math.PI * 2;
      l.position.set(x + Math.cos(ang) * 1.8, h - 0.3, z + Math.sin(ang) * 1.8); l.rotation.set(-Math.PI / 2 + 0.4, 0, -ang); world.add(l);
    }
  }
  return { sky: 0xf2d6a2, fog: [45, 125],
    spawns: [[-30.5, -16], [-19, -24], [-27, -22.5], [-20, -9], [-28.5, -4], [-22, 6], [-29, 15], [-24, 29], [-27, 21.5],
      [0, -30], [-8, -27], [8.5, -26], [-4, -16], [0, 0], [-8.5, -5], [9, 4], [-7.5, 23.5], [8, 26], [0, 14],
      [23, -30], [29.5, -28], [21, -8], [27, 0], [23.5, 14], [28, 22], [21, 28.5]] };
}
