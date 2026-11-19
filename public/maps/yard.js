import { world, T, lambert, addBox, crate, ground, perimeter, trees, stairs, wall, slab, win, pad } from '../kit.js';

// ---------- Old Town: a walled town round a fountain square ----------
// Middle: the square, where two tall houses stare at each other across the fountain; each has a balcony and an outside stair.
// West: a row of two-storey houses joined upstairs over a covered passage, an inn on the square, and a raised garden
// terrace with a T-shaped vaulted tunnel under it. Bridges link all of it into one "high road" at 3.2 m.
// East: the covered market hall (flat roof at 4.5) and the bell tower, joined to the market roof by a long bridge.
// North-west and south-east: stretches of the old town wall you can walk along, each with a gatehouse over an archway,
// running into the upstairs of the square's houses.
const UP = 3.2, ROOF = 6; // upstairs floor and roof heights of the town houses
// upstairs openings run up to the eaves (one box fewer each than a framed one)
const door = (c, w = 2.2) => [c, w, 0, 2.6], udoor = (c, w = 2.2) => [c, w, 0, 2.8], uwin = c => [c, 1.6, 1, 2.8];
const FLIGHT = [UP / 6, 1, 2]; // 6 tall steps up one storey: rise, run, width
const sort = (a, b) => [Math.min(a, b), Math.max(a, b)];

export default function yard() {
  const M = {
    plaster: lambert('ot_plaster', { color: 0xe2d2b4 }), plaster2: lambert('ot_plaster2', { color: 0xc9a98a }), plaster3: lambert('ot_plaster3', { color: 0xb8c4a8 }),
    plaster4: lambert('ot_plaster4', { color: 0xd9b9a0 }),
    timber: lambert('ot_timber', () => ({ map: T.planks(2, 2), color: 0x9c7552 })), roof: lambert('ot_roof', { color: 0x9b4a35 }),
    tile: lambert('ot_tile', { color: 0x8a3f2c }), slate: lambert('ot_slate', { color: 0x4d5560 }),
    stone: lambert('ot_stone', () => ({ map: T.concrete(), color: 0xb8ae9c })), step: lambert('ot_step', { color: 0x8f8576 }),
    hall: lambert('ot_hall', { color: 0xa36b47 }), hedge: lambert('ot_hedge', { color: 0x4f7f3a }),
    water: lambert('ot_water', { color: 0x4f9cc4, transparent: true, opacity: 0.8 }),
    face: new THREE.MeshBasicMaterial({ color: 0xf4efe0 }), hands: new THREE.MeshBasicMaterial({ color: 0x222222 }),
    bell: lambert('ot_bell', { color: 0xb08d3c }),
  };
  ground(T.grass());
  const sq = new THREE.Mesh(new THREE.PlaneGeometry(24, 40), new THREE.MeshLambertMaterial({ map: T.concrete() }));
  sq.rotation.x = -Math.PI / 2; sq.position.y = 0.01; sq.receiveShadow = true; world.add(sq);
  perimeter(M.stone, 7); // the town wall: tall enough that no roof or wall walk can jump over it

  // a tiled gable (decoration only) sitting on a flat roof whose top is at y: a long box turned 45 degrees
  const gable = (x, z, w, d, y, m = M.tile) => {
    const alongX = w >= d, s = (alongX ? d : w) / Math.SQRT2;
    const g = addBox(x, z, alongX ? w : s, alongX ? s : d, s, y - s / 2, m, false);
    if (alongX) g.rotation.x = Math.PI / 4; else g.rotation.z = Math.PI / 4;
  };
  // a two-storey town house with walls on the lines x0/x1 and z0/z1. g and u are the ground and upstairs openings per
  // side { n, s, w, e }; the upstairs floor (at UP) has a stairwell hole; flat roof at ROOF with a gable on top
  const house = (x0, x1, z0, z1, m, g, u, hole) => {
    for (const [y, h, o] of [[0, UP, g], [UP, ROOF - UP, u]]) {
      wall('x', x0 - 0.2, x1 + 0.2, z0, y, h, m, o.n || []); wall('x', x0 - 0.2, x1 + 0.2, z1, y, h, m, o.s || []);
      wall('z', z0 + 0.2, z1 - 0.2, x0, y, h, m, o.w || []); wall('z', z0 + 0.2, z1 - 0.2, x1, y, h, m, o.e || []);
    }
    slab(x0, x1, z0, z1, UP, M.timber, hole);
    addBox((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 0.8, z1 - z0 + 0.8, 0.3, ROOF, M.roof);
    gable((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 0.8, z1 - z0 + 0.8, ROOF + 0.3);
  };

  // ---------- the square ----------
  // fountain: a low basin round a tall column
  addBox(0, -3, 6.4, 0.6, 0.8, 0, M.stone); addBox(0, 3, 6.4, 0.6, 0.8, 0, M.stone);
  addBox(-3, 0, 0.6, 5.4, 0.8, 0, M.stone); addBox(3, 0, 0.6, 5.4, 0.8, 0, M.stone);
  addBox(0, 0, 1.2, 1.2, 2.6, 0, M.stone); addBox(0, 0, 2, 2, 0.3, 2.6, M.stone);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4), M.water); water.rotation.x = -Math.PI / 2; water.position.y = 0.55; world.add(water);
  for (const [x, z, w, d] of [[-7, -11, 3, 1.4], [7, 11, 3, 1.4], [8, -6, 1.4, 3], [-8, 6, 1.4, 3]]) addBox(x, z, w, d, 1.1, 0, M.timber);
  for (const [x, z] of [[-9, -16], [9, 16], [9, -16], [-4.5, 13]]) addBox(x, z, 1.6, 1.6, 0.9, 0, M.stone);

  // two tall houses facing each other across the square (s = -1 north, s = 1 south): stairs inside along the back wall,
  // big upstairs windows looking at the other house, a balcony along the front with an outside stair up to it,
  // and an upstairs side door onto the town wall
  for (const s of [-1, 1]) {
    const Z = v => s * v, X = v => s * v;
    const [zb0, zb1] = sort(Z(21.2), Z(28.8));
    wall('x', -9, 9, Z(21), 0, UP, M.plaster, [[0, 2.4, 0, 2.6]]);
    wall('x', -9, 9, Z(29), 0, UP, M.plaster, [win(X(4))]);
    wall('z', zb0, zb1, -9, 0, UP, M.plaster, [[Z(25), 2.2, 0, 2.6]]); wall('z', zb0, zb1, 9, 0, UP, M.plaster, [[Z(25), 2.2, 0, 2.6]]);
    const [hx0, hx1] = sort(X(-7.6), X(-1.4)), [hz0, hz1] = sort(Z(28.8), Z(26.4));
    slab(-9, 9, ...sort(Z(21), Z(29)), UP, M.timber, [hx0, hx1, hz0, hz1]);
    stairs(X(-7.5), Z(27.6), s, 0, 6, 0, M.step, ...FLIGHT, [[0, Z(19.5)], [0, Z(22.5)], [-10.5, Z(25)], [-7.5, Z(25)], [10.5, Z(25)], [7.5, Z(25)]]);
    addBox((hx0 + hx1) / 2, Z(26.3), 6.2, 0.1, 1, UP, M.timber); // rail along the stairwell
    wall('x', -9, 9, Z(21), UP, 2.8, M.plaster, [udoor(X(-5)), [0, 2.6, 0.9, 2.8], [X(5), 2.6, 0.9, 2.8]]);
    wall('x', -9, 9, Z(29), UP, 2.8, M.plaster);
    for (const x of [-9, 9]) wall('z', zb0, zb1, x, UP, 2.8, M.plaster, [x === X(9) ? udoor(Z(22.2), 2) : uwin(Z(24))]);
    addBox(0, Z(25), 19, 9, 0.4, ROOF, M.roof); gable(0, Z(25), 19, 9, ROOF + 0.4);
    // balcony along the front and the outside stair that climbs to it past the ground-floor windows
    addBox(X(-3.3), Z(19.85), 11.8, 1.9, 0.3, UP - 0.3, M.timber);
    addBox(X(-3.3), Z(19), 11.8, 0.12, 1, UP, M.timber);
    stairs(X(8.6), Z(19.85), -s, 0, 6, 0, M.step, UP / 6, 1, 1.9);
    crate(X(4), Z(26), UP, 1.2);
  }

  // ---------- the old town wall: a wall walk at UP with a gatehouse over an archway (s = -1 north-west, s = 1 south-east) ----------
  for (const s of [-1, 1]) {
    const X = v => s * v, Z = v => s * v, seg = (a, b) => addBox(X((a + b) / 2), Z(22), b - a, 2.8, UP, 0, M.stone);
    seg(9.2, 19); seg(22, 29.6);
    addBox(X(30.8), Z(22), 2.4, 2.8, 0.3, UP - 0.3, M.stone); // low arch over the lane along the boundary
    // the gatehouse: a 3 m archway 4.4 m long under a guard room with doors onto both stretches of the wall walk
    for (const g of [18.8, 22.2]) addBox(X(g), Z(22), 0.4, 4.4, UP, 0, M.stone);
    const [gx0, gx1] = sort(X(17.6), X(23.4)), [gz0, gz1] = sort(Z(19.8), Z(24.2));
    slab(gx0, gx1, gz0, gz1, UP, M.stone);
    wall('x', gx0, gx1, Z(20), UP, 2.8, M.stone, [uwin(X(20.5))]); wall('x', gx0, gx1, Z(24), UP, 2.8, M.stone, [uwin(X(20.5))]);
    for (const x of [17.8, 23.2]) wall('z', gz0 + 0.4, gz1 - 0.4, X(x), UP, 2.8, M.stone, [udoor(Z(22), 2)]);
    addBox(X(20.5), Z(22), 6.4, 5, 0.3, ROOF, M.slate); gable(X(20.5), Z(22), 6.4, 5, ROOF + 0.3, M.slate);
    // battlements on the outer edge, open where the outside stair arrives
    for (const [a, b] of [[23.4, 32], [14.4, 17.6], [9.2, 11.6]]) addBox(X((a + b) / 2), Z(23.25), b - a, 0.3, 0.9, UP, M.stone);
    stairs(X(13), Z(29.6), 0, -s, 6, 0, M.step, ...FLIGHT); // from the yard outside the wall up onto the wall walk
  }
  stairs(26, 15.4, 0, 1, 6, 0, M.step, ...FLIGHT); // south-east wall walk from the street behind the market

  // ---------- west: the row houses ----------
  // north house of the row: against the town wall, door onto the wall walk, bridge over the alley to the inn
  house(-29.4, -23.8, -20.4, -1.8, M.plaster2,
    { e: [door(-15), door(-4)], w: [door(-17)] },
    { n: [udoor(-26.5)], s: [udoor(-26.5)], e: [uwin(-15), udoor(-7)], w: [uwin(-17)] },
    [-29.4, -27, -14.1, -8]);
  stairs(-28.1, -8, 0, -1, 6, 0, M.step, ...FLIGHT);
  addBox(-26.95, -11.05, 0.1, 6.1, 1, UP, M.timber);
  // south house of the row: bridge over the alley onto the garden terrace
  house(-29.4, -23.8, 1.8, 18.8, M.plaster3,
    { e: [door(4.5), door(16)], w: [door(17)] },
    { n: [udoor(-26.5)], s: [uwin(-26.5)], e: [uwin(7), udoor(14.5)], w: [uwin(15)] },
    [-29.4, -27, 8, 14.1]);
  stairs(-28.1, 8, 0, 1, 6, 0, M.step, ...FLIGHT);
  addBox(-26.95, 11.05, 0.1, 6.1, 1, UP, M.timber);
  // the room over the covered passage that joins the two upstairs; the passage below links the alley to the boundary lane
  slab(-29.4, -23.8, -1.8, 1.8, UP, M.timber);
  for (const x of [-29.4, -23.8]) wall('z', -1.6, 1.6, x, UP, ROOF - UP, M.plaster4, [[0, 1.4, 1, 2.8]]);
  addBox(-26.6, 0, 6.4, 3.6, 0.3, ROOF, M.roof); gable(-26.6, 0, 6.4, 3.6, ROOF + 0.3);

  // the inn on the square: stairs inside, a balcony over the square (jump pad up to it), a bridge west to the row
  house(-18.8, -12.2, -16.8, -5.2, M.plaster4,
    { w: [door(-7.5)], e: [door(-7)], s: [door(-15.5)] },
    { w: [udoor(-7)], e: [udoor(-13), uwin(-7.5)], n: [uwin(-15.5)], s: [uwin(-14.5)] },
    [-18.8, -16.4, -15.4, -9.4]);
  stairs(-17.5, -15.4, 0, 1, 6, 0, M.step, ...FLIGHT);
  addBox(-16.35, -12.4, 0.1, 6, 1, UP, M.timber);
  addBox(-11.1, -13, 1.8, 5, 0.3, UP - 0.3, M.timber); addBox(-10.25, -13, 0.1, 5, 1, UP, M.timber);
  pad(-6, -13.5, -11.2, -13, UP, 0, 3);
  // plank bridges over the alley
  addBox(-21.3, -7, 4.6, 2, 0.3, UP - 0.3, M.timber); addBox(-21.3, 14.5, 4.6, 2, 0.3, UP - 0.3, M.timber);

  // the garden terrace (top at UP) with a vaulted tunnel under it: north-south from the cross street to the south-west
  // yard, with a branch east onto the square. Stairs from the square, a landing to the south house's balcony.
  addBox(-18, 11.5, 2, 13, UP, 0, M.stone);
  addBox(-13, 7.5, 2, 5, UP, 0, M.stone); addBox(-13, 15.5, 2, 5, UP, 0, M.stone);
  slab(-17, -14, 5, 18, UP, M.stone); slab(-14, -12, 10, 13, UP, M.stone);
  addBox(-15.5, 5.15, 7, 0.3, 0.7, UP, M.stone); // parapet over the tunnel mouth
  stairs(-6.4, 16, -1, 0, 6, 0, M.step, ...FLIGHT);
  slab(-12.4, -9, 17.6, 20.8, UP, M.timber);
  for (const [x, z, w, d] of [[-15.5, 8, 3, 0.8], [-17.6, 12, 0.8, 2.4], [-14, 13.4, 2.6, 0.8]]) addBox(x, z, w, d, 1, UP, M.hedge);
  const tree = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), lambert('ot_leaf', { color: 0x5e9a3c }));
  tree.position.set(-15.5, UP + 3.4, 10.6); tree.castShadow = true; world.add(tree);
  addBox(-15.5, 10.6, 0.35, 0.35, 2.6, UP, M.timber);

  // ---------- east: covered market hall, roof at 4.5 ----------
  wall('z', -14, 14, 13, 0, 4.2, M.hall, [[-9, 2.4, 0, 3], [-3, 2.4, 0, 3], [3, 2.4, 0, 3], [9, 2.4, 0, 3]]);
  wall('z', -14, 14, 28, 0, 4.2, M.hall, [[-6, 2.4, 0, 3]]);
  wall('x', 13.2, 27.8, -14, 0, 4.2, M.hall, [[20.5, 2.6, 0, 3]]); wall('x', 13.2, 27.8, 14, 0, 4.2, M.hall, [[20.5, 2.6, 0, 3]]);
  slab(12.8, 28.2, -14.2, 14.2, 4.5, M.roof);
  for (const z of [-10, -2.5, 5]) addBox(17.5, z, 1, 3.5, 1.1, 0, M.timber);
  for (const z of [-6, 1.5, 9.5]) addBox(23.5, z, 1, 3.5, 1.1, 0, M.timber);
  for (const z of [-7, 7]) addBox(20.5, z, 0.6, 0.6, 4.2, 0, M.stone);
  addBox(13.2, -8.5, 0.4, 5, 0.9, 4.5, M.hall); addBox(13.2, 8.5, 0.4, 5, 0.9, 4.5, M.hall); // low wall at the roof's edge
  for (const [x, z] of [[18, -4], [24, 6]]) addBox(x, z, 1.4, 1.4, 1.6, 4.5, M.stone); // chimneys
  addBox(29.9, 1.4, 3.4, 2.8, 0.3, 4.2, M.timber); // landing at the top of the back stairs
  stairs(29.9, 10, 0, -1, 9, 0, M.step, 0.5, 0.8, 2);
  pad(9.5, -12.5, 17, -12.5, 4.5);

  // ---------- the bell tower (north-east, against the town wall) ----------
  // two flights inside: up to a room at 4.5 with a bridge onto the market roof, then up to the open belfry at 8.5
  wall('x', 19.8, 28.2, -23.6, 0, 4.5, M.stone, [[23.2, 2.2, 0, 2.6]]);
  wall('z', -32, -23.8, 20, 0, 4.5, M.stone, [[-27.5, 2.2, 0, 2.6]]); wall('z', -32, -23.8, 28, 0, 4.5, M.stone);
  slab(20.2, 27.8, -32, -23.8, 4.5, M.timber, [25.4, 27.8, -30.3, -23.8]);
  stairs(26.6, -24.9, 0, -1, 9, 0, M.step, 0.5, 0.6, 2);
  addBox(25.35, -27.05, 0.1, 6.5, 1, 4.5, M.timber);
  wall('x', 19.8, 28.2, -23.6, 4.5, 4, M.stone, [udoor(24), win(21.5)]); wall('x', 19.8, 28.2, -31.8, 4.5, 4, M.stone);
  wall('z', -31.6, -23.8, 20, 4.5, 4, M.stone, [win(-27.5)]); wall('z', -31.6, -23.8, 28, 4.5, 4, M.stone);
  stairs(21.4, -30.4, 0, 1, 8, 4.5, M.step, 0.5, 0.6, 2);
  slab(19.8, 28.2, -32, -23.4, 8.5, M.stone, [20.2, 22.6, -31.6, -25.6]);
  // belfry: walled up on the sides by the town wall (so nobody can leap from it onto the wall), waist-high toward the town
  addBox(24, -31.8, 8.4, 0.4, 3, 8.5, M.stone); addBox(28, -27.7, 0.4, 8.2, 3, 8.5, M.stone);
  addBox(24, -23.6, 8.4, 0.4, 1, 8.5, M.stone); addBox(20, -27.7, 0.4, 8.2, 1, 8.5, M.stone);
  for (const x of [20.3, 27.7]) addBox(x, -23.9, 1, 1, 3, 8.5, M.stone);
  addBox(24, -27.7, 9, 9, 0.4, 11.5, M.stone);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(6.4, 6, 4), M.slate);
  spire.rotation.y = Math.PI / 4; spire.position.set(24, 14.9, -27.7); spire.castShadow = true; world.add(spire);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 1.2, 14), M.bell); bell.position.set(25.2, 10.7, -28.2); world.add(bell);
  for (const [x, z, ry] of [[24, -23.38, 0], [19.58, -27.7, -Math.PI / 2]]) { // clock faces
    const f = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), M.face); f.position.set(x, 7.7, z); f.rotation.y = ry; world.add(f);
    for (const [len, a] of [[0.55, 0.4], [0.4, 2.1]]) {
      const h = new THREE.Mesh(new THREE.PlaneGeometry(0.08, len), M.hands);
      h.rotation.z = a; h.position.set(-Math.sin(a) * len / 2, Math.cos(a) * len / 2, 0.01); f.add(h);
    }
  }
  // the bridge from the tower room to the market roof
  addBox(24, -18.8, 2.4, 9.2, 0.3, 4.2, M.timber);
  for (const x of [22.85, 25.15]) addBox(x, -18.8, 0.1, 9.2, 1, 4.5, M.timber);

  // ---------- yards and cover ----------
  addBox(-25, 29.6, 6, 0.4, 2.4, 0, M.timber); addBox(-27.8, 27.2, 0.4, 4.4, 2.4, 0, M.timber); // stable walls in the south-west yard
  for (const [x, z, s] of [[-28, -28, 1.4], [-17, -29, 1.6], [15, -27, 1.6], [12, -18.5, 1.4],
    [24, 28, 1.6], [17, 27.5, 1.4], [-16, 25, 1.6]]) crate(x, z, 0, s);
  for (const [x, z, w, d] of [[-22, -28, 3, 1.4], [16, -21, 1.4, 3], [21, 27, 3, 1.4], [-21, 25.5, 1.4, 3]]) addBox(x, z, w, d, 1.1, 0, M.timber); // carts
  addBox(-14, 22, 1.8, 1.8, 0.9, 0, M.stone); // well

  trees(0x4f8a35);
  return { sky: 0xa8d8ea, fog: [45, 120],
    spawns: [[0, -15], [0, 15], [-28, -30.5], [-13, -31], [14, -30.5], [29, -21], [-30.8, -10], [-21.3, -12], [-26.6, 0], [-15.5, 0],
      [-21.3, 10], [-15.5, 11.5], [-28, 22.5], [-17, 29], [20.5, -2.5], [17, 17.5], [28.5, 28], [16, 30.6], [6, 0], [-6, -3], [30.5, -8]] };
}
