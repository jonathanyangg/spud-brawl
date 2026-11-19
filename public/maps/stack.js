import { rand, boxGeo, world, T, lambert, addBox, crate, ground, perimeter, stairs, wall, slab, win, pad } from '../kit.js';

// ---------- Stackyard: a tiny walled container yard, fights in seconds ----------
// Three floors: the ground (2.6 m containers, run-through containers as tunnels), the 2.6 m deck (dock, container
// roofs, catwalks) and the 5.2 m double stacks joined by a zig-zag bridge over the middle. A crane holds a container
// up at 7 m that two jump pads reach. North: a loading dock with an office on it.
export default function stack() {
  const M = {
    wall: lambert('sy_wall', () => ({ map: T.ribs(), color: 0x7f868c })), deck: lambert('sy_deck', { color: 0x5b6168 }),
    dock: lambert('sy_dock', () => ({ map: T.concrete(), color: 0x9d9a92 })), office: lambert('sy_office', { color: 0xd8d2c0 }),
    rail: lambert('sy_rail', { color: 0xd4a017 }), crane: lambert('sy_crane', { color: 0xe0b020 }), dark: lambert('sy_dark', { color: 0x2b2f36 }),
    far: lambert('sy_far', { color: 0x7d858c }),
  };
  const cm = color => lambert('sy_box' + color, () => ({ map: T.ribs(), color }));
  const RED = 0xb33a2e, BLUE = 0x2f5f8f, GREEN = 0x4c7a3a, ORANGE = 0xc8702a, TEAL = 0x2f7f7a;
  // a closed container (6 x 2.5 x 2.6)
  const box = (x, z, alongX, color, y = 0) => addBox(x, z, alongX ? 6 : 2.5, alongX ? 2.5 : 6, 2.6, y, cm(color));
  // a container with both ends open: two side walls and a roof you can stand on (top y + 2.6)
  const hollow = (x, z, alongX, color, y = 0) => {
    for (const s of [-1.15, 1.15]) wall(alongX ? 'x' : 'z', (alongX ? x : z) - 3, (alongX ? x : z) + 3, (alongX ? z : x) + s, y, 2.3, cm(color), [], 0.2);
    addBox(x, z, alongX ? 6 : 2.5, alongX ? 2.5 : 6, 0.3, y + 2.3, cm(color));
  };
  // a catwalk at the 2.6 deck, with thin (decorative) rails down its long sides
  const walk = (x0, x1, z0, z1) => {
    slab(x0, x1, z0, z1, 2.6, M.deck);
    const along = x1 - x0 > z1 - z0;
    for (const s of [0, 1]) along ? addBox((x0 + x1) / 2, s ? z1 - 0.05 : z0 + 0.05, x1 - x0, 0.06, 1, 2.6, M.rail, false)
      : addBox(s ? x1 - 0.05 : x0 + 0.05, (z0 + z1) / 2, 0.06, z1 - z0, 1, 2.6, M.rail, false);
  };
  const step = (x, z, dx, dz, y0 = 0) => stairs(x, z, dx, dz, 5, y0, M.deck, 0.52, 0.8, 2);

  ground(T.asphalt());
  perimeter(M.wall, 9, 18);

  // north: a loading dock (deck at 2.6, open underneath) with an office on its west end, roof at 5.2
  slab(-18, -2.5, -18, -11.5, 2.6, M.dock);
  for (const x of [-14, -8.5, -3]) addBox(x, -11.8, 0.4, 0.4, 2.3, 0, M.dock);
  for (const x of [-16, -12, -6.5]) addBox(x, -11.45, 0.6, 0.2, 0.5, 1.6, M.dark, false); // bumpers
  wall('x', -18, -11, -13.5, 2.6, 2.3, M.office, [win(-15.8), win(-12.8)]);
  wall('z', -18, -13.7, -11.2, 2.6, 2.3, M.office, [[-14.7, 2, 0, 2.1]]);
  addBox(-14.5, -15.6, 7.4, 4.8, 0.3, 4.9, M.office); // roof, x -18.2..-10.8, top 5.2
  crate(-16.6, -16.6, 2.6, 1.2);
  step(-6.6, -16.6, -1, 0, 2.6); // dock -> office roof
  step(-4.5, -7.5, 0, -1); // yard -> dock front
  step(1.5, -16.5, -1, 0); // along the north wall -> dock east end
  for (const [x, z] of [[-16.4, -14], [-10.5, -16.4]]) crate(x, z, 0, 1.4); // under the dock

  // the two middle rows: a single, a double stack, then a run-through pair of containers on the far side
  for (const k of [-1, 1]) {
    const z = k * -4.5;
    box(k * -9.6, z, true, k < 0 ? ORANGE : GREEN); // C1, top 2.6
    box(k * -3.6, z, true, BLUE); box(k * -3.6, z, true, RED, 2.6); // C2, top 5.2
    hollow(k * 7, z, true, k < 0 ? GREEN : ORANGE); hollow(k * 13, z, true, k < 0 ? TEAL : BLUE); // tunnel x 4..16, roof 2.6
    step(k * -16.6, z, k, 0); // ground -> C1
    step(k * -10.6, z, k, 0, 2.6); // C1 -> C2
    step(k * 3.6, z, -k, 0, 2.6); // tunnel roof -> C2
    pad(k * -7, 0, k * -1.6, k * -2, 5.2); // ground -> bridge
  }
  // the bridge, 5.2 up: off C2 south, across the middle, onto the other C2
  slab(-2.6, -0.6, -3.25, -1, 5.2, M.deck); slab(-2.6, 2.6, -1, 1, 5.2, M.deck); slab(0.6, 2.6, 1, 3.25, 5.2, M.deck);
  for (const [x, z, w, d] of [[-2.65, -2, 0.06, 2.5], [0.65, -2, 0.06, 2.5], [2.65, 2, 0.06, 2.5], [-0.65, 2, 0.06, 2.5], [-0.6, -1.05, 4, 0.06], [0.6, 1.05, 4, 0.06]]) addBox(x, z, w, d, 1, 5.2, M.rail, false);

  // catwalks on the 2.6 deck: dock <-> C1 (west), dock <-> NE block, NE block <-> east tunnel roof
  walk(-12.6, -10.6, -11.5, -5.75);
  walk(-2.5, 9, -14, -12);
  walk(14, 16, -12.5, -5.75);
  // north-east block: two containers side by side (2.6), one more on top (5.2), pad up to it
  box(12, -16.25, true, RED); box(12, -13.75, true, TEAL); box(12, -16.25, true, ORANGE, 2.6);
  step(10, -8.5, 0, -1);
  pad(14, -13.6, 11.5, -16.25, 5.2, 2.6);
  // west tunnel roof -> ground, and a catwalk from it to the south tunnel
  step(-13, 9.75, 0, -1);
  walk(-10, -8, 5.75, 13.25);

  // south: a run-through container, a block of two with a catwalk from C1', and a gantry crane holding a container at 4.4-7
  hollow(-8, 14.5, true, RED);
  step(-1, 14.5, -1, 0); // -> south tunnel roof
  box(12, 12.75, true, BLUE); box(12, 15.25, true, GREEN);
  walk(10.6, 12.6, 5.75, 11.5);
  step(5, 14, 1, 0); // -> SE block
  box(2, 14.5, true, ORANGE, 4.4); // hanging, top 7
  pad(-2.5, 10, 1.5, 14.5, 7, 0, 1.5); pad(13, 13.5, 4, 14.5, 7, 2.6, 1.5);
  for (const x of [-4, 8]) for (const z of [11.5, 17.5]) addBox(x, z, 0.5, 0.5, 10, 0, M.crane);
  for (const z of [11.5, 17.5]) addBox(2, z, 12.5, 0.6, 0.8, 10, M.crane, false);
  addBox(2, 14.5, 2, 6.6, 0.6, 10.2, M.crane, false); addBox(2, 14.5, 1.6, 1.6, 0.8, 9.4, M.dark, false); // trolley
  for (const x of [-0.5, 4.5]) addBox(x, 14.5, 0.06, 0.06, 2.4, 7, M.dark, false); // cables
  for (let k = 0; k < 3; k++) box(-15, 16.6, true, [TEAL, RED, BLUE][k], k * 2.6); // a 3-high stack in the corner
  // a forklift with a pallet up on its forks
  addBox(4, 9.5, 2.2, 1.3, 1.3, 0, M.crane); addBox(4.3, 9.5, 1.2, 1.2, 0.9, 1.3, M.dark, false);
  addBox(2.75, 9.5, 0.15, 1.1, 2.6, 0, M.dark); addBox(2.2, 9.5, 1, 1.1, 0.1, 0.9, M.dark, false); crate(2.1, 9.5, 1, 1);

  // low cover on the ground
  for (const [x, z, s] of [[4.5, -1.5, 1.4], [-4.5, 1.5, 1.4], [-15.5, -1, 1.6], [15.5, 1, 1.6], [-16, 1.4, 1.2], [6, -9, 1.6], [16.2, -15.8, 1.4], [-2, 16.4, 1.2]]) crate(x, z, 0, s);
  for (const [x, z, w, d] of [[-12, 0, 0.6, 3], [12, 0, 0.6, 3], [1, -9.5, 3, 0.6], [-7, 9.5, 3, 0.6]]) addBox(x, z, w, d, 1, 0, M.dark);

  // the rest of the port beyond the wall (scenery only): container stacks
  const cols = [RED, BLUE, GREEN, ORANGE, TEAL];
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2, r = rand(26, 40), n = 2 + Math.floor(rand(0, 3));
    for (let k = 0; k < n; k++) addBox(Math.cos(a) * r, Math.sin(a) * r, 6, 2.5, 2.6, k * 2.6, cm(cols[(i + k) % 5]), false).rotation.y = a;
  }
  const lampM = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  for (const [x, z] of [[-17.5, 0], [17.5, 0]]) { const h = new THREE.Mesh(boxGeo, lampM); h.scale.set(0.3, 0.3, 1.2); h.position.set(x, 8.6, z); world.add(h); }

  return { sky: 0xe7b98c, fog: [28, 85], half: 16,
    spawns: [[-16.5, -9], [16.5, 9], [-6, -9.5], [6, 9.5], [-1.5, -8.5], [0, 9], [-17, -2.6], [16.5, -1.5], [-8, 0], [8, 0], [-7, -16.5], [-1, -12.5],
      [12, -9], [-11, 10.5], [-16.5, 12], [16.5, -8], [-6, 17], [14, 17], [0, 0]] };
}
