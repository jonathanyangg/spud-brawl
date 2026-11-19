import { rand, ICE, world, T, lambert, addBox, crate, ground, perimeter, stairs, wall, slab, win, pad, hut } from '../kit.js';

// ---------- Frostbite: a snowed-in mountain outpost round a frozen lake ----------
// Middle: the lake is ice (you slide), with a fishing shack, and long sightlines across it.
// North: a snow hill (top 3.2) hollowed by tunnels: an east-west tunnel, a south entrance and an ice cave with
//   carved steps up through its roof. A walkway runs from the hill east to the research station.
// East: the research station: ground, upper floor (3.2) with a balcony over the lake, roof deck (6.4) with a radar dome.
// West: two log cabins with lofts (2.8), joined by a loft bridge along the wall.
// South: a frozen waterfall cliff (4.0) with a cave behind the fall and steps up inside it, and a bridge
//   east to the ski-lift station on stilts (4.0), whose lift line runs over the lake.
export default function frost() {
  const M = {
    wall: lambert('fr_wall', () => ({ map: T.concrete(), color: 0xb9c7d2 })), logs: lambert('fr_logs', () => ({ map: T.planks(3, 1), color: 0x9c7a5a })),
    deck: lambert('fr_deck', () => ({ map: T.planks(2, 2), color: 0x8a6a4c })), lab: lambert('fr_lab', () => ({ map: T.ribs(), color: 0xe4e9ee })),
    floor: lambert('fr_floor', () => ({ map: T.concrete(), color: 0x9aa4ad })), snow: lambert('fr_snow', { color: 0xf3f7fa }),
    drift: lambert('fr_drift', { color: 0xdde7ef }), rock: lambert('fr_rock', { color: 0x6d7782 }), metal: lambert('fr_metal', { color: 0x5b6670 }),
    red: lambert('fr_red', { color: 0xc23b2e }), orange: lambert('fr_orange', { color: 0xe07a22 }), white: lambert('fr_white', { color: 0xffffff }),
    dark: lambert('fr_dark', { color: 0x1e2a33 }), lamp: lambert('fr_lamp', { color: 0xfff1c8, emissive: 0xffe2a0 }),
    ice: lambert('fr_ice', { color: 0xa8d4ec, transparent: true, opacity: 0.85 }), iceBlock: lambert('fr_iceBlock', { color: 0x9fd0ea, transparent: true, opacity: 0.9 }),
    fall: lambert('fr_fall', { color: 0xd4eefa, transparent: true, opacity: 0.55 }),
  };
  // a box from corner to corner (x0..x1, z0..z1), from y up h
  const B = (x0, x1, z0, z1, h, mat, y = 0, solid = true) => addBox((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, h, y, mat, solid);
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; world.add(m); return m; };
  const icePlane = (x0, x1, z0, z1) => { mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), M.ice, (x0 + x1) / 2, 0.02, (z0 + z1) / 2).rotation.x = -Math.PI / 2; ICE.push([x0, x1, z0, z1]); };
  const tank = (x, z, alongX) => { // collision box; the round tank is what you see
    addBox(x, z, alongX ? 4.4 : 2.4, alongX ? 2.4 : 4.4, 2.4, 0, M.metal).visible = false;
    const t = mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.4, 14), M.metal, x, 1.2, z); if (alongX) t.rotation.z = Math.PI / 2; else t.rotation.x = Math.PI / 2;
  };
  ground(T.snow());
  perimeter(M.wall, 5);

  // ===== middle: the frozen lake =====
  icePlane(-11, 11, -8, 8);
  hut(0, 0, 5, 4, 2.6, M.logs, 'ns'); addBox(0, 0, 5.6, 4.6, 0.3, 2.6, M.drift);
  for (const [x, z] of [[-7, -4], [7, 4], [-4, 5.5], [5, -5.5], [8.5, -2], [-8.5, 3]]) addBox(x, z, 1.8, 1.2, 1.2, 0, M.iceBlock);
  B(-7.5, -4.5, -0.6, 0.6, 0.9, M.red); B(-7.3, -6.5, -0.5, 0.5, 0.5, M.white, 0.9); // a frozen-in boat
  const holeG = new THREE.CircleGeometry(0.5, 16);
  for (const [x, z] of [[-3, -5], [3, 6], [-9, -6], [9, 6], [4, -1.5]]) mesh(holeG, M.dark, x, 0.03, z).rotation.x = -Math.PI / 2;

  // ===== north: the snow hill (top 3.2) and the tunnels through it =====
  const HT = 3.2;
  for (const [x0, x1, z0, z1] of [[-26, 4, -32, -30.5], [-26, -19, -30.5, -26.5], [-5, 4, -30.5, -26.5],
    [-26, -18, -26.5, -24.5], [-15, -10, -26.5, -24.5], [-7, 4, -26.5, -24.5], [-26, -6, -21.5, -18], [-3, 4, -21.5, -18]]) B(x0, x1, z0, z1, HT, M.snow);
  slab(-26, 4, -24.5, -21.5, HT, M.drift); // the main east-west tunnel
  slab(-6, -3, -21.5, -18, HT, M.drift); // the south entrance
  slab(-18, -15, -26.5, -24.5, HT, M.drift); slab(-10, -7, -26.5, -24.5, HT, M.drift); // two ways into the ice cave
  slab(-19, -5, -30.5, -26.5, HT, M.iceBlock, [-12, -6, -30.5, -28.5]); // the ice cave, steps up through its roof
  stairs(-12, -29.5, 1, 0, 8, 0, M.iceBlock);
  B(-17, -16, -29, -28, HT, M.iceBlock); // an ice pillar
  const icicleG = new THREE.ConeGeometry(0.25, 1.1, 6);
  for (let i = 0; i < 14; i++) mesh(icicleG, M.iceBlock, rand(-18.5, -12.5), 2.35, rand(-30.2, -26.8)).rotation.x = Math.PI;
  for (const x of [-22, -14, -6, 1]) B(x - 0.3, x + 0.3, -23.2, -22.8, 0.12, M.lamp, 2.78, false);
  for (const x of [-15, -9]) B(x - 0.3, x + 0.3, -28.7, -28.3, 0.12, M.lamp, 2.78, false);
  stairs(-20, -12, 0, -1, 8, 0, M.drift); stairs(10, -28, -1, 0, 8, 0, M.drift);
  pad(-12, -13, -12, -19.5, HT);
  for (const [x0, x1, z0, z1] of [[-17, -13, -19.2, -18.7], [-2, 2, -19.2, -18.7], [-24, -21, -25.6, -25], [-1, 2, -29, -28.4]]) B(x0, x1, z0, z1, 0.9, M.drift, HT);
  // the radio mast on top
  B(-22.5, -21.5, -29.5, -28.5, 1.2, M.metal, HT);
  for (let i = 0; i < 6; i++) B(-22.12, -21.88, -29.12, -28.88, 2, i % 2 ? M.red : M.white, HT + 1.2 + i * 2, false);

  // ===== east: the research station: floors at 0, 3.2 and a roof deck at 6.4 =====
  const F2 = 3.2, RF = 6.4;
  wall('x', 16, 28, -12, 0, F2, M.lab, [[24, 2.4, 0, 2.6], win(19.5)]);
  wall('x', 16, 28, 4, 0, F2, M.lab, [[22, 2.4, 0, 2.6], win(18.5), win(26)]);
  wall('z', -12, 4, 16, 0, F2, M.lab, [[-6, 2.4, 0, 2.6], win(-10), win(0)]);
  wall('z', -12, 4, 28, 0, F2, M.lab, [[-8, 2.2, 0, 2.6], win(-0.5)]);
  wall('x', 16, 28, -12, F2, F2, M.lab, [[20, 2.2, 0, 2.6], win(25)]);
  wall('x', 16, 28, 4, F2, F2, M.lab, [win(19), win(24.5)]);
  wall('z', -12, 4, 16, F2, F2, M.lab, [[0, 2.2, 0, 2.6], win(-10.6), win(-5)]);
  wall('z', -12, 4, 28, F2, F2, M.lab, [win(-8), win(1)]);
  for (const z of [-12, 4]) wall('x', 16, 28, z, RF, 1, M.orange, [], 0.3);
  for (const x of [16, 28]) wall('z', -12, 4, x, RF, 1, M.orange, [], 0.3);
  B(15.75, 28.25, -12.25, 4.25, 0.3, M.orange, 2.9, false); // stripe round the building at the upper floor
  slab(16, 28, -12, 4, F2, M.floor, [25.4, 28, -3.6, 2.6]);
  slab(16, 28, -12, 4, RF, M.floor, [16, 18.6, -8.8, -2.6]);
  stairs(26.5, 2.4, 0, -1, 8, 0, M.metal); stairs(17.5, -8.6, 0, 1, 8, F2, M.metal);
  B(25.25, 25.35, -3.6, 2.6, 1, M.orange, F2); B(18.65, 18.75, -8.8, -2.6, 1, M.orange, RF); // rails by the stairwells
  B(19, 23, -9.5, -8.5, 1, M.metal); B(19, 21.5, -2.5, -1.5, 1, M.metal); crate(18, 2.6, 0, 1.4); // lab benches
  B(22, 23, -11.6, -9, 2.2, M.metal, F2); B(20, 24, -1, 0, 1, M.metal, F2); crate(23.5, 2.6, F2, 1.2);
  B(23, 27, -9, -5, 1.2, M.metal, RF); // the radar dome on the roof
  mesh(new THREE.SphereGeometry(2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, 25, RF + 1.2, -7);
  B(26.9, 27.1, 1.9, 2.1, 5, M.metal, RF, false);
  pad(12, -8, 20, -8, RF, 0, 3);
  // the balcony over the lake, with steps down
  slab(12.5, 16, -2, 6, F2, M.deck);
  for (const z of [-1.8, 5.8]) B(12.5, 12.9, z - 0.2, z + 0.2, F2 - 0.3, M.logs);
  B(12.5, 12.6, -2, 6, 1, M.logs, F2); B(12.5, 16, -2, -1.9, 1, M.logs, F2);
  stairs(14.25, 12, 0, -1, 8, 0, M.deck);
  // the walkway from the hill to the station's upper door, with steps down at the corner
  slab(4, 21, -21, -19, F2, M.deck); slab(19, 21, -19, -12, F2, M.deck);
  B(12.35, 12.65, -20.15, -19.85, F2 - 0.3, M.logs); B(19.85, 20.15, -16.15, -15.85, F2 - 0.3, M.logs);
  B(4, 21, -21, -20.9, 1, M.logs, F2); B(4, 19, -19.1, -19, 1, M.logs, F2); B(19, 19.1, -19, -12, 1, M.logs, F2); B(20.9, 21, -19, -12, 1, M.logs, F2);
  stairs(27, -20, -1, 0, 8, 0, M.deck);
  // generator shed and fuel tanks in the north-east
  hut(25, -27, 6, 5, 3, M.metal, 'sw'); B(21.7, 28.3, -29.8, -24.2, 0.3, M.drift, 3);
  tank(16, -30, true); tank(4, -13.5, true);

  // ===== west: two log cabins with lofts, joined by a bridge along the wall; one more in the south-east =====
  const LOFT = 2.8, CH = 5.2;
  const cabin = (sx, z0, z1, northStairs, bridge) => {
    const xi = sx * 22, xo = sx * 32, xl = sx * 28.65, X0 = Math.min(xi, xo), X1 = Math.max(xi, xo);
    const zs = northStairs ? z0 + 1.5 : z1 - 1.5, zd = northStairs ? z0 + 5 : z1 - 5, loftWin = [sx * 30.5, 1.6, LOFT + 1, LOFT + 2.1];
    wall('z', z0, z1, xi, 0, CH, M.logs, [[zd, 2.2, 0, 2.4]]);
    wall('x', X0, X1, northStairs ? z1 : z0, 0, CH, M.logs, [[sx * 25.5, 2.2, 0, 2.4], bridge ? [sx * 30.5, 2.2, LOFT, CH] : loftWin]);
    wall('x', X0, X1, northStairs ? z0 : z1, 0, CH, M.logs, [loftWin]);
    slab(Math.min(xl, xo), Math.max(xl, xo), z0, z1, LOFT, M.deck);
    slab(X0, X1, z0, z1, CH + 0.3, M.drift);
    stairs(sx * 23.4, zs, sx, 0, 7, 0, M.logs);
    const rx = xl - sx * 0.1;
    B(rx - 0.05, rx + 0.05, northStairs ? z0 + 2.6 : z0, northStairs ? z1 : z1 - 2.6, 1, M.logs, LOFT);
    crate(sx * 30.3, (z0 + z1) / 2, 0, 1.2); B(sx * 26 - 0.8, sx * 26 + 0.8, zd - 0.6, zd + 0.6, 0.9, M.deck, 0); // table
    B(sx * 26 - 0.4, sx * 26 + 0.4, z0 + 1, z0 + 1.8, 1.4, M.rock, CH + 0.3, false); // chimney
  };
  cabin(-1, -12, -4, true, true); cabin(-1, 6, 14, false, true); cabin(1, 12, 20, true, false);
  slab(-32, -29.2, -4, 6, LOFT, M.deck);
  B(-29.3, -29.2, -4, 6, 1, M.logs, LOFT); B(-29.5, -29.2, 0.85, 1.15, LOFT - 0.3, M.logs);

  // ===== south-west: the frozen waterfall cliff (top 4.0) with a cave behind the fall =====
  const CL = 4;
  B(-32, -26, 20, 32, CL, M.rock); B(-23, -14, 20, 26, CL, M.rock); B(-26, -14, 31, 32, CL, M.rock);
  slab(-26, -23, 20, 26, CL, M.rock); slab(-26, -14, 26, 31, CL, M.rock, [-24, -16.5, 28.9, 31]);
  stairs(-16.5, 30, -1, 0, 10, 0, M.iceBlock); // steps up inside the cave
  stairs(-6.5, 23, -1, 0, 10, 0, M.rock); // steps up the east face
  pad(-18, 15.5, -18, 21.5, CL);
  for (const [x0, x1, z0, z1] of [[-32, -26, 20, 32], [-23, -14, 20, 26], [-26, -24, 26, 31]]) B(x0, x1, z0, z1, 0.03, M.snow, CL, false);
  B(-30, -27.5, 20.3, 20.8, 0.9, M.snow, CL); B(-16.5, -14.5, 24.5, 25, 0.9, M.snow, CL);
  B(-26.2, -22.8, 19.7, 19.95, CL + 0.3, M.fall, 0, false); // the frozen fall, hanging over the cave mouth
  B(-25.8, -24.2, 20, 32, 0.05, M.fall, CL, false);
  B(-27.2, -26, 19.2, 20, CL, M.iceBlock); B(-23, -21.8, 19.2, 20, CL, M.iceBlock);
  icePlane(-28, -20, 15, 19.2); // the frozen plunge pool
  for (const z of [22, 29]) B(-24.8, -24.2, z, z + 0.4, 0.12, M.lamp, CL - 0.42, false);

  // ===== south: the bridge and the ski-lift station on stilts (4.0) =====
  slab(-14, 2, 27, 29, CL, M.deck);
  B(-6.2, -5.8, 27.8, 28.2, CL - 0.3, M.logs);
  B(-14, 2, 27, 27.1, 1, M.logs, CL); B(-14, 2, 28.9, 29, 1, M.logs, CL);
  slab(2, 14, 22, 32, CL, M.deck);
  for (const [x, z] of [[2.3, 22.3], [13.7, 22.3], [2.3, 31.6], [13.7, 31.6], [8, 22.3]]) B(x - 0.2, x + 0.2, z - 0.2, z + 0.2, CL - 0.3, M.logs);
  B(5.2, 14, 22, 22.1, 1, M.metal, CL); B(13.9, 14, 22, 26, 1, M.metal, CL); B(2, 2.1, 22, 27, 1, M.metal, CL); B(2, 2.1, 29, 32, 1, M.metal, CL);
  stairs(4, 14.5, 0, 1, 10, 0, M.deck);
  wall('x', 7, 13, 24, CL, 2.8, M.red, [[10, 2.2, 0, 2.4]]); wall('x', 7, 13, 30, CL, 2.8, M.red, [win(10)]);
  wall('z', 24, 30, 7, CL, 2.8, M.red, [[27, 2.2, 0, 2.4]]); wall('z', 24, 30, 13, CL, 2.8, M.red, [win(27)]);
  slab(6.6, 13.4, 23.6, 30.4, CL + 3.1, M.drift);
  B(11.6, 12.6, 25, 29, 1, M.metal, CL); // the lift controls
  crate(5, 27, 0, 1.6); crate(11, 30.2, 0, 1.4); B(9.5, 12.5, 24.5, 25.7, 0.9, M.orange); // under the station: crates and a snowmobile
  // the lift line runs north over the lake: bull wheel, two pylons, cables and chairs (only the pylons are solid)
  mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.3, 20), M.metal, 10, 8.4, 22.5);
  B(9.8, 10.2, 22.3, 22.7, 1.3, M.metal, CL + 3.1, false);
  for (const z of [12, -12]) { B(9.7, 10.3, z - 0.3, z + 0.3, 8.6, M.metal); B(8, 12, z - 0.15, z + 0.15, 0.25, M.metal, 8.6, false); }
  for (const x of [8.2, 11.8]) {
    B(x - 0.03, x + 0.03, -45, 22.5, 0.06, M.dark, 8.6, false);
    for (let z = x < 10 ? 18 : 15; z > -42; z -= 7) { B(x - 0.03, x + 0.03, z - 0.03, z + 0.03, 1.6, M.dark, 7, false); B(x - 0.6, x + 0.6, z - 0.35, z + 0.35, 0.12, M.red, 6.9, false); }
  }

  // ===== the snowcat, snow banks and crates in the open =====
  B(-18.5, -15.5, -9.5, -5, 1.8, M.orange); B(-18.2, -15.8, -9.2, -7.2, 1, M.metal, 1.8);
  for (const [x, z, w, d, h] of [[-6, -12, 6, 1.4, 1.1], [-15.5, 0, 1.4, 6, 1.1], [-3, 13, 5, 1.4, 1.1], [-18, 6, 1.4, 5, 1.1],
    [14, -16, 1.4, 5, 1.2], [24, 8, 5, 1.4, 1.1], [-10, 19, 4, 1.4, 1.1]]) addBox(x, z, w, d, h, 0, M.drift);
  for (const [x, z] of [[-9, -16], [16, -24], [6, 18], [-26, 9.5]]) crate(x, z, 0, 1.6);

  // ===== scenery beyond the wall =====
  B(-40, 0, 33, 46, 13, M.rock, 0, false); B(-27, -22, 32.8, 33.2, 9, M.fall, CL, false); // the rock face the fall comes down
  B(-34, 12, -48, -33, 7, M.snow, 0, false);
  const rockG = new THREE.ConeGeometry(18, 30, 7), capG = new THREE.ConeGeometry(7.5, 12.5, 7);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + 0.3, r = rand(95, 120), s = rand(0.8, 1.4), x = Math.cos(a) * r, z = Math.sin(a) * r;
    mesh(rockG, M.rock, x, 15 * s, z).scale.setScalar(s); mesh(capG, M.snow, x, 15 * s + 9 * s, z).scale.setScalar(s);
  }
  const leafM = lambert('fr_pine', { color: 0x2f5a3f }), capM = lambert('fr_pineSnow', { color: 0xf3f7fa }), trunkM = lambert('trunk', { color: 0x6b4a2b });
  const trunkG = new THREE.CylinderGeometry(0.3, 0.4, 2, 6), coneG = new THREE.ConeGeometry(2.4, 6, 8), topG = new THREE.ConeGeometry(1, 2, 8);
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2 + rand(-0.05, 0.05), r = rand(40, 64), x = Math.cos(a) * r, z = Math.sin(a) * r, s = rand(0.9, 1.5);
    mesh(trunkG, trunkM, x, 1, z); mesh(coneG, leafM, x, 2 + 3 * s, z).scale.setScalar(s); mesh(topG, capM, x, 2 + 5.4 * s, z).scale.setScalar(s);
  }
  for (const [x, z] of [[-29.5, 27], [-19, 23.5]]) { B(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 2, trunkM, CL); mesh(coneG, leafM, x, CL + 4, z); mesh(topG, capM, x, CL + 6.4, z); }

  return { sky: 0xcfdce6, fog: [35, 105],
    spawns: [[-29, -26], [-8, -23], [8, -24], [24, -17], [30, -4], [13, -11], [18, 9], [28, 9], [26, 27], [8, 26], [-9, 25.5],
      [-30, 17], [-26, 1], [-27, -15], [-17, -1], [-2, -15], [1, 11], [-14, 12]] };
}
