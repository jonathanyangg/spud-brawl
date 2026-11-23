// Vehicles: the tractor at Mash Farm on Spud Island. The use key climbs in when you're next to one and climbs out again.
// Forward and back drive and reverse, left and right steer; the mouse still looks round, but you can't shoot, throw or
// heal while you drive. A vehicle is a solid box in the world like any wall: it blocks people and shots (your head and
// shoulders stick out over it) and it can't be damaged. Driving into someone shoves them aside.
// Online, the driver's game moves it and streams [index, x, y, z, yaw, speed] as vh in their presence; everyone else
// draws it there, and it stays where its last driver left it. If two players get in at once, the lower player id keeps it.
// Every match starts with each vehicle back where the map put it.
import { H, R } from './config.js';
import { LIMIT, VEHICLES, boxes } from './world.js';
import { sfx } from './audio.js';
import { V3, clamp } from './util.js';
import { now, player, scene } from './game.js';

// fwd, rev: top speeds (m/s); acc, brake, coast: how fast speed changes (m/s each second); turn: steering (rad/s at speed);
// hw, hl: half its width and length; h: how tall its solid box is; step: the tallest ledge it climbs;
// seat: where the driver sits (behind the centre, and how high their feet are), seatY: the seat's top in the model
export const KINDS = {
  tractor: { name: 'tractor', fwd: 12, rev: 4.5, acc: 5.5, brake: 14, coast: 3, turn: 1.25, hw: 0.95, hl: 1.55, h: 1.1, step: 0.45, seat: [0, 0.5], seatY: 0.8 },
};
const G = 24;
export const VEH = []; // { i, k, x, y, z, yaw, speed, vy, driver, mesh, wheels, box, target }
const n = v => (Number.isFinite(+v) ? +v : 0);

// ---------- the model ----------
const M = {};
const mat = (k, c) => (M[k] ||= new THREE.MeshLambertMaterial({ color: c }));
function box(g, m, w, h, d, x, y, z) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; }
function wheel(g, r, w, x, y, z) {
  const hub = new THREE.Group(); hub.position.set(x, y, z); g.add(hub);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), mat('tyre', 0x1e1e1e)); t.rotation.z = Math.PI / 2; t.castShadow = true; hub.add(t);
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.02, 10), mat('rim', 0xf2c230)); c.rotation.z = Math.PI / 2; hub.add(c);
  box(hub, mat('rim', 0xf2c230), w + 0.03, r * 1.5, 0.08, 0, 0, 0); // a spoke, so you can see it turn
  return { hub, r };
}
// forward is -z, like everything else in the game
function tractorMesh() {
  const g = new THREE.Group(), red = mat('tred', 0xc8432f), dark = mat('tdark', 0x2b2d31);
  box(g, red, 0.9, 0.42, 2.5, 0, 0.62, -0.1);             // chassis
  box(g, red, 0.82, 0.55, 1.25, 0, 1.0, -0.65);           // hood
  box(g, dark, 0.7, 0.4, 0.06, 0, 0.95, -1.3);            // grille
  box(g, mat('tlight', 0xfff2b0), 0.14, 0.1, 0.04, 0.26, 1.18, -1.29); box(g, mat('tlight', 0xfff2b0), 0.14, 0.1, 0.04, -0.26, 1.18, -1.29);
  for (const s of [-1, 1]) box(g, red, 0.42, 0.08, 1.0, s * 0.82, 1.32, 0.55); // fenders over the big wheels
  box(g, dark, 1.3, 0.06, 0.8, 0, 0.42, 0.45);            // footplate
  box(g, dark, 0.5, 0.1, 0.45, 0, 0.75, 0.55);            // seat
  box(g, dark, 0.5, 0.45, 0.08, 0, 0.98, 0.8);            // seat back
  box(g, dark, 0.06, 0.5, 0.06, 0, 1.15, -0.05).rotation.x = -0.6; // steering column
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), dark); sw.position.set(0, 1.35, 0.05); sw.rotation.x = -1.0; g.add(sw);
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8), dark); ex.position.set(0.3, 1.55, -0.95); g.add(ex);
  const wheels = [wheel(g, 0.66, 0.36, 0.84, 0.66, 0.55), wheel(g, 0.66, 0.36, -0.84, 0.66, 0.55), wheel(g, 0.38, 0.24, 0.62, 0.38, -1.0), wheel(g, 0.38, 0.24, -0.62, 0.38, -1.0)];
  return { g, wheels };
}

// ---------- placing them ----------
const ext = (v, yaw = v.yaw) => { const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); return [c * v.k.hw + s * v.k.hl, s * v.k.hw + c * v.k.hl]; };
function fitBox(v) { const [hx, hz] = ext(v); v.box.min.set(v.x - hx, v.y, v.z - hz); v.box.max.set(v.x + hx, v.y + v.k.h, v.z + hz); }
function place(v) { v.mesh.position.set(v.x, v.y, v.z); v.mesh.rotation.set(0, v.yaw, 0); fitBox(v); }
// back to where the map puts them, nobody in them (a new match, or a new map)
export function resetVehicles() {
  for (const v of VEH) { scene.remove(v.mesh); const i = boxes.indexOf(v.box); if (i >= 0) boxes.splice(i, 1); if (v.driver && v.driver.vehicle === v) v.driver.vehicle = null; }
  VEH.length = 0;
  for (const [x, z, yaw, kind] of VEHICLES) {
    const k = KINDS[kind] || KINDS.tractor, { g, wheels } = tractorMesh();
    const v = { i: VEH.length, k, x, y: 0, z, yaw, speed: 0, vy: 0, driver: null, mesh: g, wheels, box: { min: new V3(), max: new V3(), dyn: true }, target: null };
    scene.add(g); boxes.push(v.box); place(v); VEH.push(v);
  }
}

// ---------- driving ----------
// the floor under a footprint at (x, z): the highest thing low enough to drive up onto, or Infinity if a wall's in the way
function floorAt(v, x, z, yaw = v.yaw) {
  const [hx, hz] = ext(v, yaw); let top = 0;
  for (const b of boxes) {
    if (b === v.box || x + hx <= b.min.x || x - hx >= b.max.x || z + hz <= b.min.z || z - hz >= b.max.z) continue;
    if (b.min.y >= v.y + v.k.h + 0.4) continue; // overhead: a loft, a lintel
    if (b.max.y > v.y + v.k.step) return Infinity;
    top = Math.max(top, b.max.y);
  }
  const lim = LIMIT - Math.max(hx, hz);
  return Math.abs(x) > lim || Math.abs(z) > lim ? Infinity : top;
}
function stepVehicle(v, dt, turn) {
  // turning: only if the new footprint fits where it stands
  if (turn && floorAt(v, v.x, v.z, v.yaw + turn) !== Infinity) v.yaw += turn; else turn = 0;
  const vx = -Math.sin(v.yaw) * v.speed, vz = -Math.cos(v.yaw) * v.speed;
  let hit = false;
  const nx = v.x + vx * dt; if (floorAt(v, nx, v.z) !== Infinity) v.x = nx; else hit = true;
  const nz = v.z + vz * dt; if (floorAt(v, v.x, nz) !== Infinity) v.z = nz; else hit = true;
  if (hit) { if (Math.abs(v.speed) > 5) { sfx.land(Math.min(1, Math.abs(v.speed) / 12)); } v.speed *= -0.2; }
  const floor = floorAt(v, v.x, v.z), ground = floor === Infinity ? v.y : floor;
  if (v.y > ground + 0.01) { v.vy -= G * dt; v.y = Math.max(ground, v.y + v.vy * dt); } else { v.y = ground; v.vy = 0; }
  if (v.y <= ground) v.vy = 0;
  return turn;
}
function spinWheels(v, dt) { for (const w of v.wheels) w.hub.rotation.x -= (v.speed * dt) / w.r; }
// where the driver sits, in the world
export function seatOf(v, out = new V3()) {
  const [sx, sz] = v.k.seat, c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  return out.set(v.x + sx * c + sz * s, v.y + v.k.seatY - 0.45, v.z - sx * s + sz * c);
}
// a frame at the wheel: f is forward (1) or back (-1), s is right (1) or left (-1). The view turns with the vehicle.
export function driveVehicle(p, dt, f, s) {
  const v = p.vehicle, k = v.k;
  const target = f > 0 ? k.fwd : f < 0 ? -k.rev : 0;
  const rate = f === 0 ? k.coast : v.speed * target < 0 ? k.brake : k.acc;
  v.speed += clamp(target - v.speed, -rate * dt, rate * dt);
  const turn = stepVehicle(v, dt, -s * k.turn * clamp(v.speed / 4, -1, 1) * dt);
  p.yaw += turn;
  place(v); spinWheels(v, dt);
  seatOf(v, p.pos); p.vel.set(0, 0, 0); p.onGround = true; p.crouch = 1; p.slideK = 0; p.sprint = false;
}

// ---------- getting in and out ----------
export function nearVehicle(p) {
  if (!p.alive || p.drop || p.vehicle) return null;
  let best = null, bd = Infinity;
  for (const v of VEH) {
    if (v.driver || Math.abs(p.pos.y - v.y) > 1.6) continue;
    const d = Math.hypot(p.pos.x - v.x, p.pos.z - v.z);
    if (d < v.k.hl + 1.3 && d < bd) { best = v; bd = d; }
  }
  return best;
}
export function enterVehicle(p, v) {
  v.driver = p; p.vehicle = v; v.speed = 0; v.target = null;
  p.useT = null; p.reloading = false; p.slide = 0; p.crouchOn = false;
  seatOf(v, p.pos); sfx.pick();
}
// out on whichever side has room: left, right, behind, in front, or else on top
export function exitVehicle(p) {
  const v = p.vehicle; if (!v) return;
  v.driver = null; p.vehicle = null; v.speed = 0;
  p.crouch = 0; p.vel.set(0, 0, 0);
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw), out = v.k.hw + R + 0.25, back = v.k.hl + R + 0.25;
  const free = (x, z) => Math.abs(x) < LIMIT - R && Math.abs(z) < LIMIT - R && !boxes.some(b => x + R > b.min.x && x - R < b.max.x && z + R > b.min.z && z - R < b.max.z && v.y + H > b.min.y && v.y + 0.3 < b.max.y);
  for (const far of [0, 0.5, 1]) // turned, its box is wider than the tractor, so step further out if need be
    for (const [lx, lz] of [[-out - far, 0.3], [out + far, 0.3], [0, back + far], [0, -back - far]]) {
      const x = v.x + lx * c + lz * s, z = v.z - lx * s + lz * c;
      if (free(x, z)) { p.pos.set(x, v.y, z); return; }
    }
  p.pos.set(v.x, v.y + v.k.h + 0.01, v.z);
}

// ---------- each frame ----------
export function updateVehicles(dt) {
  for (const v of VEH) {
    if (v.driver && (v.driver.vehicle !== v || v.driver.alive === false || v.driver.dead)) { // they died, respawned or left
      if (v.driver.vehicle === v) v.driver.vehicle = null;
      v.driver = null; v.speed = 0;
    }
    if (v.driver === player) continue; // moved in driveVehicle
    if (v.target) { // someone else drives: follow their game
      const t = v.target, far = Math.hypot(t.x - v.x, t.z - v.z) > 8, a = far ? 1 : 1 - Math.pow(0.0005, dt);
      const yaw0 = v.yaw;
      v.x += (t.x - v.x) * a; v.y += (t.y - v.y) * a; v.z += (t.z - v.z) * a;
      let d = t.yaw - v.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; v.yaw = yaw0 + d * a;
      if (!v.driver) { v.speed = 0; if (Math.hypot(t.x - v.x, t.z - v.z) < 0.02) v.target = null; }
      place(v); spinWheels(v, dt);
    }
  }
}

// ---------- online ----------
export const vehicleState = v => [v.i, Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100, Math.round(v.yaw * 1000) / 1000, Math.round(v.speed * 10) / 10];
// a remote player's presence: vh is the vehicle they drive, if any. myPeer: my id, for when we both got in.
// Returns true when their claim threw me out.
export function remoteVehicle(r, vh, myPeer) {
  const ok = Array.isArray(vh) && vh.length >= 6 && Number.isInteger(vh[0]) && VEH[vh[0]];
  const v = ok ? VEH[vh[0]] : null;
  for (const o of VEH) if (o.driver === r && o !== v) { o.driver = null; o.speed = 0; } // they got out: it stays where they left it
  r.seated = !!v;
  if (!v) { r.vehicle = null; return false; }
  let bumped = false;
  if (v.driver === player) { if (r.peer < myPeer) { exitVehicle(player); bumped = true; } else return false; }
  else if (v.driver && v.driver !== r) return false;
  const lim = LIMIT;
  v.driver = r; r.vehicle = v;
  v.target = { x: clamp(n(vh[1]), -lim, lim), y: clamp(n(vh[2]), 0, 60), z: clamp(n(vh[3]), -lim, lim), yaw: n(vh[4]) };
  v.speed = clamp(n(vh[5]), -20, 20);
  return bumped;
}
export function releaseDriver(r) { for (const v of VEH) if (v.driver === r) { v.driver = null; v.speed = 0; } r.vehicle = null; r.seated = false; }
