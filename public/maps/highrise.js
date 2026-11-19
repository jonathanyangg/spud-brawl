import { rand, world, boxGeo, T, lambert, addBox, ground, perimeter, stairs, wall, slab, win, pad, canvasTex, crate } from '../kit.js';

// ---------- Highrise: a downtown block. North and south halves mirror each other across z = 0 ----------
// West lane: a three-level parking garage over the middle, a brick walk-up on each side with a fire escape,
//   and a plank walkway from its roof to the garage roof.
// Middle lane: a raised plaza with a cross-shaped subway underpass beneath it, and an elevated train line
//   (with a parked tram) running over the plaza from the garage roof into the office tower.
// East lane: the office tower (three floors and a roof, stairs all the way up), a back alley behind it,
//   and a corner shop on each side whose roof has a skybridge into the tower's first floor.
// Levels: ground 0, 3 (plaza, garage deck, tower 1st floor, shop roofs), 6 (garage roof, train line,
//   tower 2nd floor, walk-up roofs), 9 (tower roof).
export default function highrise() {
  const brick = () => canvasTex(128, (g, s) => {
    g.fillStyle = '#b9aa98'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < s; x += 32) { g.fillStyle = `hsl(${rand(8, 18)},${rand(35, 50)}%,${rand(32, 42)}%)`; g.fillRect(x + 1, y + 1, 30, 14); }
  }, 3, 2);
  const M = {
    perim: lambert('hr_perim', () => ({ map: T.concrete(), color: 0x8c8a86 })), brick: lambert('hr_brick', () => ({ map: brick() })),
    tower: lambert('hr_tower', () => ({ map: T.concrete(), color: 0xc4beb2 })), shop: lambert('hr_shop', () => ({ map: T.concrete(), color: 0x86a2b6 })),
    garage: lambert('hr_garage', () => ({ map: T.concrete(), color: 0x9a968e })), floor: lambert('hr_floor', () => ({ map: T.concrete(), color: 0x8f8a80 })),
    step: lambert('hr_step', { color: 0x9a948a }), band: lambert('hr_band', { color: 0x6c727a }), rail: lambert('hr_rail', { color: 0xd4a017 }),
    iron: lambert('hr_iron', { color: 0x3a3d42 }), plank: lambert('hr_plank', () => ({ map: T.planks(1, 4) })),
    tram: lambert('hr_tram', () => ({ map: T.ribs(), color: 0x3f8f72 })), bus: lambert('hr_bus', { color: 0xd9a21e }),
    glass: lambert('hr_glass', { color: 0x2a3440 }), far: lambert('hr_far', { color: 0x6d7682 }), kiosk: lambert('hr_kiosk', { color: 0x2e6b4f }),
    paint: lambert('hr_paint', { color: 0xe8e4d8 }), board: [0xd2452f, 0x2f7fd2].map(c => lambert('hr_board' + c, { color: c })),
    car: [0x2f5f8f, 0xb33a2e, 0xd8d8d8, 0x3c3c40].map(c => lambert('hr_car' + c, { color: c })),
  };
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  const door = (c, w = 2.4) => [c, w, 0, 2.5];
  const up = (x, z, dx, dz, y0, m = M.step, w = 2) => stairs(x, z, dx, dz, 6, y0, m, 0.5, 0.8, w); // one storey: 6 steps, 3 m up, 4.8 m long
  const car = (x, z, alongX, m, y = 0) => { addBox(x, z, alongX ? 4.2 : 1.9, alongX ? 1.9 : 4.2, 1, y, m); addBox(x, z, alongX ? 2.2 : 1.7, alongX ? 1.7 : 2.2, 0.6, y + 1, M.glass); };
  const light = (x, z, w, d, y) => { const l = new THREE.Mesh(boxGeo, lamp); l.scale.set(w, 0.08, d); l.position.set(x, y, z); world.add(l); };
  ground(T.asphalt());
  perimeter(M.perim, 12);

  // ---- middle: the plaza (top 3) over a cross-shaped underpass (N-S 4 m wide, E-W 3 m wide)
  for (const [x, z] of [[-4, -5.25], [4, -5.25], [-4, 5.25], [4, 5.25]]) addBox(x, z, 4, 7.5, 3, 0, M.garage);
  addBox(0, 0, 12, 3, 0.3, 2.7, M.floor); addBox(0, -5.25, 4, 7.5, 0.3, 2.7, M.floor); addBox(0, 5.25, 4, 7.5, 0.3, 2.7, M.floor);
  addBox(0, 0, 0.8, 0.8, 2.7, 0, M.band); // column at the crossing
  for (const z of [-6, -3, 3, 6]) light(0, z, 1.4, 0.3, 2.66);
  for (const x of [-4, 4]) light(x, 0, 0.3, 1.4, 2.66);
  // the elevated train line at 6 m, over the plaza from the garage roof into the tower's 2nd floor
  addBox(-0.3, 0, 30.2, 5, 0.3, 5.7, M.iron);
  for (const x of [-10.5, 10.5]) addBox(x, 0, 1.2, 1.2, 5.7, 0, M.band);
  addBox(0, 0, 1.2, 1.2, 2.7, 3, M.band);
  for (const [x0, x1, z] of [[-15, -6, -2.42], [6, 15, -2.42], [-15, -6, 2.42], [9, 15, 2.42]]) addBox((x0 + x1) / 2, z, x1 - x0, 0.15, 1, 6, M.rail);
  // a parked tram on the line: doors on both sides, you can run through it or drop off the far side
  wall('x', 2, 9, -0.05, 6, 2.6, M.tram, [[4, 2, 0, 2.2]], 0.3);
  wall('x', 2, 9, 2.35, 6, 2.6, M.tram, [[7, 2, 0, 2.2]], 0.3);
  addBox(2, 1.15, 0.3, 2.4, 2.6, 6, M.tram); addBox(9, 1.15, 0.3, 2.4, 2.6, 6, M.tram); addBox(5.5, 1.15, 7.3, 2.7, 0.2, 8.6, M.tram);

  // ---- west: the parking garage, x -31.6..-15 by z -10..10: open ground floor, a covered deck at 3, the roof at 6
  slab(-29.2, -15, -10, 10, 3, M.floor);
  for (const [z0, z1] of [[-10, -7.4], [-2.4, 2.4], [7.4, 10]]) slab(-31.6, -29.2, z0, z1, 3, M.floor);
  slab(-31.6, -17.6, -10, 10, 6, M.floor);
  for (const [z0, z1] of [[-10, -8.4], [-3.4, 3.4], [8.4, 10]]) slab(-17.6, -15, z0, z1, 6, M.floor);
  wall('z', -10, 10, -15.2, 3, 1, M.band, [[0, 4, 0, 1]]); wall('z', -10, 10, -15.2, 6, 1, M.band, [[0, 5.4, 0, 1]]);
  addBox(-17, 0, 1.6, 1.6, 2.4, 0, M.kiosk); // pay booth at the entrance
  addBox(-29.6, 0, 3, 4, 2.6, 6, M.garage); // lift housing on the roof

  // ---- east: the office tower, x 15..28 by z -9..9; stairs zigzag up the east side to the roof
  slab(15, 28, -9, 9, 3, M.floor, [25.4, 28, -6.2, -1.4]);
  slab(15, 28, -9, 9, 6, M.floor, [25.4, 28, 1.4, 6.2]);
  slab(15, 28, -9, 9, 9, M.floor, [25.4, 28, -6.2, -1.4]);
  up(26.6, -6.2, 0, 1, 0); up(26.6, 6.2, 0, -1, 3); up(26.6, -6.2, 0, 1, 6);
  addBox(25.35, -3.8, 0.1, 4.8, 1, 3, M.rail); addBox(25.35, 3.8, 0.1, 4.8, 1, 6, M.rail); addBox(25.35, -3.8, 0.1, 4.8, 1, 9, M.rail);
  const storey = (y, w, e, n, s) => {
    wall('z', -8.8, 8.8, 15, y, 3, M.tower, w); wall('z', -8.8, 8.8, 28, y, 3, M.tower, e);
    wall('x', 15, 28, -9, y, 3, M.tower, n); wall('x', 15, 28, 9, y, 3, M.tower, s);
  };
  storey(0, [door(-4.5), door(4.5), win(0)], [door(0)], [door(19)], [door(19)]);
  storey(3, [win(-3), win(3)], [], [door(22, 2.2), win(17.5)], [door(22, 2.2), win(17.5)]);
  storey(6, [door(0, 2.8), win(-6), win(6)], [], [win(20.5)], [win(20.5)]);
  for (const z of [-9, 9]) wall('x', 15, 28, z, 9, 1, M.band);
  for (const x of [15, 28]) wall('z', -8.8, 8.8, x, 9, 1, M.band);
  addBox(20.5, 0, 1, 4, 1.1, 0, M.band); // lobby desk
  wall('x', 15.2, 21, 0, 3, 3, M.tower, [door(18.5, 2.2)]); crate(19, -4.5, 3, 1.2); crate(22.5, 5, 3, 1.4); // 1st floor: two offices
  addBox(21, -5.4, 0.3, 6.8, 3, 6, M.tower); crate(18, 4, 6, 1.4); // 2nd floor: a partition and a crate
  addBox(18, 0, 2.4, 2.4, 2.4, 9, M.iron); for (const z of [-6.5, 6.5]) addBox(23, z, 2, 1.2, 1.2, 9, M.band); // water tank, vents on the roof
  // a billboard high over the tower roof (out of reach, scenery only)
  for (const z of [-3, 3]) addBox(27.6, z, 0.2, 0.2, 3, 10, M.iron, false);
  addBox(27.6, 0, 0.3, 9, 3.2, 12.6, M.board[1], false);

  // ---- streets between the middle pieces
  car(-12.8, -8.5, false, M.car[2]); car(-12.8, 8.5, false, M.car[3]);
  car(9, -6.5, false, M.car[0]); car(9, 6.5, false, M.car[1]);

  // ---- each half (s = 1 south, s = -1 north); coordinates below are written for the south half
  const spawns = [];
  for (const s of [-1, 1]) {
    const Z = v => s * v, zs = (a, b) => [Math.min(s * a, s * b), Math.max(s * a, s * b)];
    const WX = (a, b, c, y, h, m, g = []) => wall('x', a, b, s * c, y, h, m, g);
    const WZ = (a, b, c, y, h, m, g = []) => wall('z', ...zs(a, b), c, y, h, m, g.map(([c0, ...r]) => [s * c0, ...r]));
    const SL = (x0, x1, z0, z1, top, m) => slab(x0, x1, ...zs(z0, z1), top, m);

    // plaza: stairs up from the cross street and the west street, a jump pad onto the train line, planters
    up(4, Z(13.8), 0, -s, 0); up(-10.8, Z(5.5), 1, 0, 0);
    pad(0, Z(6), 0, Z(1), 6, 3);
    addBox(-3.6, Z(7.6), 1.6, 1.6, 0.9, 3, M.kiosk); addBox(3, Z(3.4), 1.6, 1.6, 0.9, 3, M.kiosk);
    addBox(5.8, Z(5.2), 0.4, 4.4, 1, 3, M.band); // low wall facing the tower
    addBox(1.5, Z(5.5), 0.6, 2, 0.9, 0, M.band); // bench in the underpass

    // garage: ramps-as-stairs ground -> deck (west side) and deck -> roof (east side), pillars, parked cars
    up(-30.4, Z(2.6), 0, s, 0); up(-16.4, Z(8.4), 0, -s, 3);
    for (const x of [-25, -20]) { addBox(x, Z(5), 0.8, 0.8, 2.7, 0, M.garage); addBox(x, Z(5), 0.8, 0.8, 2.7, 3, M.garage); }
    WX(-31.6, -15, 10, 6, 1, M.band, [[-24, 2.4, 0, 1]]);
    addBox(-26, Z(9.8), 6, 0.4, 1, 3, M.band);
    car(-23, Z(8), true, M.car[s > 0 ? 0 : 1]); car(-23.5, Z(1.8), true, M.car[s > 0 ? 3 : 2], 3); car(-25, Z(4.5), true, M.car[s > 0 ? 1 : 0], 6);

    // brick walk-up, x -31.6..-20 by z 17..27: two floors and a roof (6); fire escape up the east face,
    // a balcony over the cross street, and a plank walkway from the roof to the garage roof
    WX(-31.6, -20, 17, 0, 3, M.brick, [door(-26), win(-22.5)]); WX(-31.6, -20, 27, 0, 3, M.brick, [door(-23)]);
    WZ(17.2, 26.8, -20, 0, 3, M.brick, [door(22.5)]);
    WX(-31.6, -20, 17, 3, 3, M.brick, [door(-25.5, 2.2), win(-29.5)]); WX(-31.6, -20, 27, 3, 3, M.brick);
    WZ(17.2, 26.8, -20, 3, 3, M.brick, [door(19)]);
    SL(-31.6, -20, 17, 27, 3, M.floor); SL(-31.6, -20, 17, 27, 6, M.floor);
    addBox(-25.5, Z(16.1), 5, 1.8, 0.3, 2.7, M.floor); addBox(-25.5, Z(15.25), 5, 0.1, 1, 3, M.rail);
    addBox(-24, Z(13.5), 2, 7, 0.25, 5.75, M.plank);
    addBox(-18.8, Z(19), 2.4, 4, 0.3, 2.7, M.iron); addBox(-18.8, Z(26.8), 2.4, 2, 0.3, 5.7, M.iron);
    up(-18.8, Z(12.2), 0, s, 0, M.iron, 1.6); up(-18.8, Z(21), 0, s, 3, M.iron, 1.6);
    addBox(-17.65, Z(19), 0.1, 4, 1, 3, M.rail);
    WX(-31.6, -20, 17, 6, 0.9, M.band, [[-24, 2.4, 0, 0.9]]); WX(-31.6, -20, 27, 6, 0.9, M.band); WZ(17.2, 25.6, -20, 6, 0.9, M.band);
    addBox(-28.5, Z(21), 2.4, 2.4, 2.4, 6, M.iron);
    for (const x of [-29, -23]) addBox(x, Z(27.2), 0.2, 0.2, 2, 6.9, M.iron, false);
    addBox(-26, Z(27.2), 8, 0.3, 3, 8.6, M.board[s > 0 ? 0 : 1], false);
    pad(-12, Z(25), -25, Z(22), 6, 0, 2);

    // corner shop, x 15..27 by z 18..27: one storey, a roof (3) with stairs up the west side, a skybridge
    // from the roof into the tower's 1st floor, and a jump pad up to the tower roof
    WX(15, 27, 18, 0, 2.7, M.shop, [door(19)]); WX(15, 27, 27, 0, 2.7, M.shop, [door(21)]);
    WZ(18.2, 26.8, 15, 0, 2.7, M.shop, [door(21.5)]); WZ(18.2, 26.8, 27, 0, 2.7, M.shop, [door(22.5)]);
    SL(15, 27, 18, 27, 3, M.floor);
    WX(15, 27, 18, 3, 0.9, M.band, [[22, 2.4, 0, 0.9]]); WX(15, 27, 27, 3, 0.9, M.band);
    WZ(18.2, 26.8, 15, 3, 0.9, M.band, [[25, 2.4, 0, 0.9]]); WZ(18.2, 26.8, 27, 3, 0.9, M.band);
    up(10.2, Z(25), 1, 0, 0);
    addBox(22, Z(13.5), 2.4, 9, 0.3, 2.7, M.iron);
    for (const x of [20.85, 23.15]) addBox(x, Z(13.5), 0.1, 8.6, 1, 3, M.rail);
    addBox(21, Z(23), 4, 0.8, 1.1, 0, M.band); // shop counter
    pad(24, Z(22.5), 21, Z(4), 9, 3, 2.5);

    // the spawn street: a parked bus, a newsstand, a car, barriers in the cross street
    addBox(-5.5, Z(21.5), 9, 2.4, 2.8, 0, M.bus); addBox(-5.5, Z(21.5), 8.6, 2.45, 0.8, 1.6, M.glass, false);
    addBox(3, Z(26.5), 2.4, 1.6, 2.4, 0, M.kiosk);
    car(5, Z(20), false, M.car[s > 0 ? 2 : 3]); car(-3, Z(13), true, M.car[s > 0 ? 1 : 0]);
    addBox(-9, Z(13.5), 3.5, 0.6, 1, 0, M.band); addBox(13.6, Z(12.5), 1.6, 1.2, 1.3, 0, M.kiosk);
    addBox(-1.5, Z(15.8), 3.5, 0.6, 1, 0, M.band);
    for (let i = 0; i < 6; i++) addBox(-10.5, Z(11 + i * 1.1), 3, 0.5, 0.02, 0, M.paint, false); // crosswalk

    spawns.push([-27, Z(29.5)], [-14, Z(29)], [-4, Z(28.5)], [7, Z(29.5)], [21, Z(29.5)], [30, Z(22)], [-8, Z(18)], [-26, Z(13.5)], [12, Z(14.5)]);
  }

  // office facades painted on the boundary wall above the rooftops (scenery)
  for (const y of [7.6, 10]) for (const [x, z, w, d] of [[0, -31.95, 62, 0.1], [0, 31.95, 62, 0.1], [-31.95, 0, 0.1, 62], [31.95, 0, 0.1, 62]]) addBox(x, z, w, d, 1.2, y, M.glass, false);
  // street lamps along the avenues (scenery)
  for (const [x, z] of [[-15.6, -14], [-15.6, 14], [14.4, -14], [14.4, 14], [-6.5, -24], [8.5, 24]]) {
    addBox(x, z, 0.2, 0.2, 5, 0, M.iron, false);
    const head = new THREE.Mesh(boxGeo, lamp); head.scale.set(0.8, 0.2, 0.4); head.position.set(x, 5.1, z); world.add(head);
  }
  // skyline beyond the wall (scenery only)
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2 + rand(-0.08, 0.08), r = rand(46, 70);
    addBox(Math.cos(a) * r, Math.sin(a) * r, rand(8, 16), rand(8, 16), rand(18, 45), 0, M.far, false).rotation.y = a;
  }
  return { sky: 0x9fb8d0, fog: [45, 130], spawns };
}
