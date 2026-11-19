import { rand, boxGeo, world, T, lambert, addBox, crate, ground, perimeter, stairs, wall, slab, win, pad } from '../kit.js';

// ---------- Depot: a rail yard (north = -z) ----------
// West: container yard. Double stacks along x = -19 are joined by catwalks into an upper lane (5.2 m) that runs
//   from the signal box in the north to a footbridge in the south; singles form a maze behind them.
// Middle: a raised station platform (3.2 m) with a pedestrian tunnel inside it, running into the base of the
//   signal box, whose cabin (5.2 m) looks down the track; a boxcar train you cut through and run along the roofs
//   of; a gantry crane (6 m) over the middle that joins the warehouse roof. East of the train: open yard, tank car.
// East: a three-storey office (roof 9.6 m) with a stairwell, a skybridge to the warehouse mezzanine (its roof
//   at 6.4 m leads onto the warehouse roof), the warehouse with a skylight you can be launched through, and an
//   engine shed whose roof the south footbridge lands on.
export default function depot() {
  const M = {
    wall: lambert('dp_wall', () => ({ map: T.concrete(), color: 0xc9c4b8 })), shed: lambert('dp_shed', () => ({ map: T.ribs(), color: 0x9aa3ab })),
    brick: lambert('dp_brick', { color: 0x9a5a44 }), office: lambert('dp_office', () => ({ map: T.concrete(), color: 0xd8d4c8 })),
    cabin: lambert('dp_cabin', { color: 0x3f6b4f }), floor: lambert('dp_floor', () => ({ map: T.concrete(), color: 0x9d9a92 })),
    step: lambert('dp_step', { color: 0x7d7a74 }), metal: lambert('dp_metal', { color: 0x5b6168 }), rail: lambert('dp_rail', { color: 0xd4a017 }),
    trim: lambert('dp_trim', { color: 0x4a3f36 }), barrier: lambert('dp_barrier', { color: 0xbab5aa }), roof: lambert('dp_roof', { color: 0x4d5258 }),
    far: lambert('dp_far', { color: 0x7d858c }), cab: lambert('dp_cab', { color: 0xe0b020 }), loco: lambert('dp_loco', { color: 0x2d4a6e }),
    tank: lambert('dp_tank', { color: 0x30343a }), glow: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }),
  };
  const container = (x, z, alongX, color, y = 0) =>
    addBox(x, z, alongX ? 6 : 2.5, alongX ? 2.5 : 6, 2.6, y, lambert('dp_box' + color, () => ({ map: T.ribs(), color })));
  const stack = (x, z, c1, c2) => { container(x, z, false, c1); container(x, z, false, c2, 2.6); }; // top 5.2
  const light = (x, y, z, w, d) => { const m = new THREE.Mesh(boxGeo, M.glow); m.scale.set(w, 0.08, d); m.position.set(x, y, z); world.add(m); };
  const R32 = 3.2 / 6; // six steps per 3.2 m storey
  ground(T.asphalt());
  perimeter(M.wall, 8); // tall enough that nobody jumps out from the 6 m roofs

  // ===== the track and the train: four boxcars with doors on both sides, roofs at 3.3 =====
  for (const x of [-0.75, 0.75]) addBox(x, 0, 0.12, 63, 0.1, 0, M.metal, false);
  for (let z = -30; z <= 30; z += 1.5) addBox(0, z, 2.4, 0.3, 0.06, 0, M.trim, false);
  for (const z of [-31, 31]) addBox(0, z, 3, 0.8, 1.2, 0, M.rail); // buffer stops
  [[-21, 0x8f3a2a], [-8.5, 0x2f5f8f], [8.5, 0x4c7a3a], [21, 0x8f3a2a]].forEach(([z, color]) => {
    const m = lambert('dp_car' + color, () => ({ map: T.ribs(), color }));
    for (const x of [-1.6, 1.6]) wall('z', z - 5, z + 5, x, 0, 3, m, [[z, 2.2, 0, 2.4]], 0.3);
    addBox(0, z - 4.9, 2.9, 0.2, 3, 0, m); addBox(0, z + 4.9, 2.9, 0.2, 3, 0, m);
    addBox(0, z, 3.5, 10.2, 0.3, 3, m);
  });
  pad(4.5, -8.5, 0, -8.5, 3.3); pad(4.5, 21, 0, 21, 3.3);

  // ===== station platform (top 3.2) with a tunnel through it, x -9.2..-3.8, z -15..15 =====
  slab(-9.2, -3.8, -15, 15, 3.2, M.floor);
  wall('z', -15, 15, -9, 0, 2.9, M.wall, [[-6, 2.4, 0, 2.5], [6, 2.4, 0, 2.5]]);
  wall('z', -15, 15, -4, 0, 2.9, M.wall, [[-8.5, 2.4, 0, 2.5], [0, 2.4, 0, 2.5], [8.5, 2.4, 0, 2.5]]);
  wall('x', -9.2, -3.8, 15, 0, 2.9, M.wall, [[-6.5, 2.4, 0, 2.5]]);
  for (let z = -18; z <= 13; z += 6) light(-6.5, 2.86, z, 0.5, 2.5);
  crate(-7.6, -3, 0, 1.2); crate(-5.2, 11, 0, 1.2);
  for (const z of [-12, 12]) stairs(-14, z, 1, 0, 6, 0, M.step, R32, 0.8, 2);
  for (const [z0, z1] of [[-15, -13.2], [-10.8, -2], [2, 10.8], [13.2, 15]]) addBox(-9.1, (z0 + z1) / 2, 0.2, z1 - z0, 1, 3.2, M.rail);
  // waiting shelter on the platform
  addBox(-8.8, -5, 0.3, 4, 2.4, 3.2, M.brick); addBox(-7.6, -7, 2.4, 0.3, 2.4, 3.2, M.brick); addBox(-7.6, -3, 2.4, 0.3, 2.4, 3.2, M.brick);
  addBox(-7.4, -5, 3, 4.6, 0.2, 5.6, M.roof);
  pad(-6.5, 6, -6.5, 0, 6, 3.2); // up onto the gantry

  // ===== signal box over the platform's north end: tunnel room below, cabin (floor 5.2) above =====
  wall('x', -9.2, -3.8, -21, 0, 4.9, M.brick, [[-6.5, 2.2, 0, 2.4]]);
  wall('x', -9.2, -3.8, -15, 0, 4.9, M.brick, [[-6.5, 2.4, 0, 2.5]]);
  wall('z', -20.8, -15.2, -9, 0, 4.9, M.brick, [[-18, 2.2, 0, 2.4]]);
  wall('z', -20.8, -15.2, -4, 0, 4.9, M.brick);
  slab(-9.6, -3.4, -21.4, -15, 5.2, M.floor);
  wall('x', -9.6, -3.4, -15, 5.2, 2.8, M.cabin, [[-5, 2.2, 0, 2.3], [-8, 1.6, 1, 2.3]]);
  wall('x', -9.6, -3.4, -21.4, 5.2, 2.8, M.cabin, [[-6.5, 4.4, 1, 2.3]]);
  wall('z', -21.2, -15.2, -9.6, 5.2, 2.8, M.cabin, [[-18.5, 2.2, 0, 2.3]]);
  wall('z', -21.2, -15.2, -3.4, 5.2, 2.8, M.cabin, [[-19.4, 2.2, 0, 2.3], [-16.6, 1.6, 1, 2.3]]); // door: drop onto the train
  slab(-9.9, -3.1, -21.7, -14.7, 8.3, M.roof);
  addBox(-6.5, -20.4, 4, 0.8, 0.9, 5.2, M.trim); // lever frame
  stairs(-5, -11.6, 0, -1, 4, 3.2, M.step, 0.5, 0.8, 2); // platform up to the cabin

  // ===== west: double stacks on x = -19 joined by catwalks (5.2), singles behind =====
  const catwalk = (x0, x1, z0, z1) => {
    slab(x0, x1, z0, z1, 5.2, M.metal);
    if (x1 - x0 > z1 - z0) for (const z of [z0, z1]) addBox((x0 + x1) / 2, z, x1 - x0, 0.1, 1, 5.2, M.rail);
    else for (const x of [x0, x1]) addBox(x, (z0 + z1) / 2, 0.1, z1 - z0, 1, 5.2, M.rail);
  };
  stack(-19, -18.5, 0xb33a2e, 0x2f5f8f); stack(-19, -4, 0x4c7a3a, 0xc8702a); stack(-19, 10, 0x2f5f8f, 0xb33a2e); stack(-19, 26, 0xc8702a, 0x4c7a3a);
  catwalk(-20, -18, -15.5, -7); catwalk(-20, -18, -1, 7); catwalk(-20, -18, 13, 23);
  catwalk(-17.75, -9.6, -19.5, -17.5); // to the signal box cabin
  container(-28, -24, false, 0x2f5f8f); container(-28, -24, false, 0x4c7a3a, 2.6);
  container(-25.5, -15, true, 0xc8702a); container(-30.35, -9, false, 0xb33a2e);
  container(-25, -3, false, 0xb33a2e); container(-25, -3, false, 0x2f5f8f, 2.6);
  container(-27, 6, true, 0x4c7a3a); container(-24.5, 14, false, 0xc8702a);
  container(-29.5, 20, false, 0x2f5f8f); container(-29.5, 20, false, 0xc8702a, 2.6);
  container(-25, 29.5, true, 0xb33a2e); container(-27, -29.8, true, 0x4c7a3a);
  stairs(-27, 11.25, 0, -1, 5, 0, M.step, 0.52, 0.8, 2); // onto a single
  crate(-22, -10, 0, 1.4); crate(-29, 13, 0, 1.4); crate(-19, -6.2, 5.2, 1.2); crate(-19, 10.8, 5.2, 1.2); crate(-14.5, 5, 0, 1.6);
  pad(-14, -4, -19, -4, 5.2); pad(-24, -19, -19, -18.5, 5.2); pad(-25, 20.5, -19, 18, 5.2, 0, 2.5);

  // ===== gantry crane across the middle (deck 6.0); its east end runs onto the warehouse roof =====
  for (const x of [-13, 13]) for (const z of [-1.6, 1.6]) addBox(x, z, 0.5, 0.5, 5.6, 0, M.cab);
  addBox(0, 0, 26.6, 2.8, 0.4, 5.6, M.cab);
  addBox(-2.5, 0, 2, 1.2, 2, 6, M.metal); addBox(-2.5, 0, 2.1, 1.3, 0.2, 8, M.cab);
  container(5.5, 0, true, 0xc8702a, 2.9); // hanging load
  for (const x of [3.5, 7.5]) addBox(x, 0, 0.08, 0.08, 0.1, 5.5, M.metal, false);
  pad(10.5, -5.5, 10.5, 0, 6);

  // ===== east yard between the train and the warehouse: a tank car on a siding, barriers =====
  for (const x of [6.75, 8.25]) addBox(x, -3, 0.12, 34, 0.1, 0, M.metal, false);
  addBox(7.5, 8.5, 2.6, 9, 3, 0, M.tank).visible = false; // collider; the visible tank is a cylinder
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 9, 16), M.tank); tank.rotation.x = Math.PI / 2; tank.position.set(7.5, 1.7, 8.5); tank.castShadow = true; world.add(tank);
  for (const [x, z, w, d] of [[6, -14, 4, 0.6], [4.5, -4, 0.6, 2.5], [10, 4, 0.6, 3], [-12, -8, 0.6, 3], [-14, 16, 4, 0.6], [6, 15.5, 4, 0.6], [-13, -26, 4, 0.6], [5, -30, 0.6, 3]]) addBox(x, z, w, d, 1, 0, M.barrier);
  crate(10.5, -16, 0, 1.6); crate(4, 26, 0, 1.6); crate(-4, 24, 0, 1.4); crate(-10, 27, 0, 1.6);

  // ===== north: a lamp room hut and a water tower =====
  wall('x', 5.5, 10.5, -29, 0, 2.8, M.brick); wall('x', 5.5, 10.5, -25, 0, 2.8, M.brick, [[8, 2.2, 0, 2.4]]);
  wall('z', -28.8, -25.2, 5.5, 0, 2.8, M.brick, [[-27, 2.2, 0, 2.4]]); wall('z', -28.8, -25.2, 10.5, 0, 2.8, M.brick);
  addBox(8, -27, 5.6, 4.6, 0.3, 2.8, M.roof);
  for (const dx of [-1.6, 1.6]) for (const dz of [-1.6, 1.6]) addBox(-12 + dx, -29 + dz, 0.3, 0.3, 6, 0, M.metal);
  const wt = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 16), M.tank); wt.position.set(-12, 7.6, -29); wt.castShadow = true; world.add(wt);

  // ===== office: three storeys (floors 0, 3.2, 6.4, roof 9.6), x 15..29, z -29..-19, stairwell in the SE corner =====
  wall('x', 15, 29, -19, 0, 3.2, M.office, [[21, 2.4, 0, 2.5], win(17)]);
  wall('x', 15, 29, -29, 0, 3.2, M.office, [win(19), win(24)]);
  wall('z', -28.8, -19.2, 15, 0, 3.2, M.office, [[-24, 2.4, 0, 2.5], win(-21)]);
  wall('z', -28.8, -19.2, 29, 0, 3.2, M.office, [[-27, 2.2, 0, 2.5]]);
  stairs(27.6, -20.4, 0, -1, 6, 0, M.step, R32, 0.8, 2);
  slab(15, 29, -29, -19, 3.2, M.floor, [26.4, 29, -25.2, -20.8]);
  wall('x', 15, 29, -19, 3.2, 3.2, M.office, [[17.5, 2.2, 0, 2.4], win(22)]);
  wall('x', 15, 29, -29, 3.2, 3.2, M.office, [win(20)]);
  wall('z', -28.8, -19.2, 15, 3.2, 3.2, M.office, [win(-26), win(-21.5)]);
  wall('z', -28.8, -19.2, 29, 3.2, 3.2, M.office);
  stairs(25.4, -25.6, 0, 1, 6, 3.2, M.step, R32, 0.8, 2);
  slab(15, 29, -29, -19, 6.4, M.floor, [24.4, 26.4, -24.8, -20.8]);
  wall('x', 15, 29, -19, 6.4, 3.2, M.office, [[17.5, 2.2, 0, 2.4], win(22)]);
  wall('x', 15, 29, -29, 6.4, 3.2, M.office, [win(20)]);
  wall('z', -28.8, -19.2, 15, 6.4, 3.2, M.office, [win(-26), win(-23), win(-20.6)]);
  wall('z', -28.8, -19.2, 29, 6.4, 3.2, M.office);
  stairs(27.6, -20.4, 0, -1, 6, 6.4, M.step, R32, 0.8, 2);
  slab(15, 29, -29, -19, 9.6, M.roof, [26.4, 29, -25.2, -20.8]);
  addBox(22, -19.1, 14, 0.2, 1, 9.6, M.office); addBox(15.1, -24, 0.2, 9.6, 1, 9.6, M.office); // low parapets to the yard
  addBox(22, -28.9, 14, 0.2, 2.2, 9.6, M.office); addBox(28.9, -24, 0.2, 9.6, 2.2, 9.6, M.office); // high ones to the boundary
  addBox(19, -24, 3, 1, 0.9, 0, M.trim); addBox(20, -26, 1, 3, 0.9, 3.2, M.trim); addBox(19, -22, 3, 1, 0.9, 6.4, M.trim); // desks
  addBox(18.5, -21, 2, 2, 1.2, 9.6, M.metal); // roof plant, kept away from the boundary side

  // skybridge from the office's first floor to the warehouse mezzanine; its roof joins office floor 2 to the warehouse roof
  slab(16, 19, -19, -12, 3.2, M.floor);
  for (const x of [16, 19]) wall('z', -18.8, -12.2, x, 3.2, 2.9, M.shed, [[-15.5, 4.6, 0.9, 2.3]]);
  slab(15.8, 19.2, -19, -12.2, 6.4, M.roof);

  // ===== warehouse: x 13..31.6, z -12..14, mezzanine (3.2) along the west wall, roof (6.0) with a skylight =====
  wall('z', -12, 14, 13, 0, 5.7, M.shed, [[-8, 3, 0, 3], [-5, 3, 4.2, 5.2], [5, 3, 4.2, 5.2], [10, 3, 0, 3]]);
  wall('x', 12.8, 31.6, -12, 0, 5.7, M.shed, [[25, 4, 0, 3.5], [17.5, 2.2, 3.2, 5.5]]);
  wall('x', 12.8, 31.6, 14, 0, 5.7, M.shed, [[22, 3, 0, 3]]);
  slab(13.2, 19.4, -11.8, 13.8, 3.2, M.floor);
  for (const z of [-8, 9]) stairs(24.2, z, -1, 0, 6, 0, M.step, R32, 0.8, 2);
  for (const [z0, z1] of [[-11.8, -9.2], [-6.8, 7.8], [10.2, 13.8]]) addBox(19.35, (z0 + z1) / 2, 0.1, z1 - z0, 1, 3.2, M.rail);
  for (const z of [-6, 6.5]) addBox(29.8, z, 1.2, 7, 3.6, 0, M.metal);
  crate(22, -2, 0, 1.6); crate(27.5, 11, 0, 1.4); crate(16, -4, 3.2, 1.2); crate(16, 6, 3.2, 1.2);
  slab(12.8, 31.6, -12.2, 14.2, 6, M.roof, [22, 28, -4, 6]);
  addBox(12.9, -6.9, 0.2, 10.6, 0.9, 6, M.shed); addBox(12.9, 7.9, 0.2, 12.6, 0.9, 6, M.shed);
  addBox(18, 10, 2, 2, 1.2, 6, M.metal); addBox(26, -9, 2, 2, 1.2, 6, M.metal);
  pad(25, 3, 25, -6.5, 6, 0, 2); // up through the skylight

  // ===== engine shed: x 12..31.6, z 18..31.6, roof 5.2, a locomotive inside =====
  wall('x', 12, 31.6, 18, 0, 4.9, M.brick, [[22, 3, 0, 3.2], win(16), win(28)]);
  wall('z', 18.2, 31.6, 12, 0, 4.9, M.brick, [[24.5, 4, 0, 4]]);
  slab(11.8, 31.6, 17.8, 31.6, 5.2, M.roof);
  for (const z of [23.75, 25.25]) addBox(19, z, 14, 0.12, 0.1, 0, M.metal, false);
  addBox(23, 24.5, 10, 2.8, 3.2, 0, M.loco); addBox(20, 24.5, 3, 2.8, 1, 3.2, M.loco);
  crate(15, 21, 0, 1.4); crate(29, 29, 0, 1.6);
  addBox(20, 22, 2, 2, 1.2, 5.2, M.metal); addBox(24, 27, 2, 2, 1.2, 5.2, M.metal);

  // ===== south footbridge (5.2) from the last stack over the track onto the shed roof, stairs down by the boundary =====
  slab(-17.75, 12, 27.5, 29.5, 5.2, M.metal);
  addBox(-2.875, 27.45, 29.75, 0.1, 1, 5.2, M.rail);
  addBox(-8.875, 29.55, 17.75, 0.1, 1, 5.2, M.rail); addBox(7.5, 29.55, 9, 0.1, 1, 5.2, M.rail);
  for (const x of [-10, 6]) addBox(x, 28.5, 0.4, 0.4, 4.9, 0, M.metal);
  slab(0, 3, 29.5, 31.4, 5.2, M.metal);
  stairs(10.4, 30.4, -1, 0, 10, 0, M.step, 0.52, 0.8, 2);

  // lamp posts and far-off sheds (scenery)
  for (const [x, z] of [[-11, -10], [11, 17], [-30, 0], [11, -18]]) {
    addBox(x, z, 0.3, 0.3, 8, 0, M.metal, false);
    const head = new THREE.Mesh(boxGeo, M.glow); head.scale.set(0.9, 0.25, 0.5); head.position.set(x, 8.1, z); world.add(head);
  }
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + rand(-0.1, 0.1), r = rand(48, 70), h = rand(9, 18);
    addBox(Math.cos(a) * r, Math.sin(a) * r, rand(10, 18), rand(10, 18), h, 0, M.far, false).rotation.y = a;
  }
  return { sky: 0xb8c4cc, fog: [40, 115],
    spawns: [[-31, -25], [-22, -26], [-14, -29], [-6.5, -26], [5, -21], [12.5, -30], [22, -16], [30.5, -24], [26, 10], [8, -10],
      [5, 17], [20, 16], [-4, 30.5], [-14, 22], [-22.5, 25], [-30.8, 2], [-14, 8], [16, 25], [-6.5, -9]] };
}
