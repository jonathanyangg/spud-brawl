// Battle royale: the closing storm, the drop, loot chests and the supply drop (game.js runs the match; this is the mode's own rules)
import { sfx } from '../audio.js';
import { AMMO, AMMO_OF, CHEST_GUNS, G, KNIFE, WEAPONS } from '../config.js';
import { fx, MM, toast } from '../hud.js';
import { botHost, net, num, r2 } from '../netsync.js';
import { $, clamp, rand, V3 } from '../util.js';
import { boxGeo, HALF, LIMIT, SPAWNS } from '../world.js';
import {
  angDiff, CH, chestMesh, damage, distVol, ents, grav, mode, moveEntity, now, oneLife, openChest, pick, player, poseSoldier, rayWorld, scene,
  settings, SM, state, tick
} from '../game.js';

// ---------- battle royale: one life, a closing storm ----------
// The storm is a circle (x, z, r) that waits, then shrinks to the next circle (tx, tz, tr) inside it, five times.
// Outside it you lose health every second, more each phase. Offline or as the bot host this client runs it;
// everyone else follows the host's.
const PHASES = [[25, 20, 30, 3], [20, 18, 19, 5], [18, 16, 11, 8], [15, 14, 5, 12], [12, 12, 0, 18]]; // wait s, shrink s, next radius, damage/s
export const storm = { on: false, x: 0, z: 0, r: 48, fx: 0, fz: 0, fr: 48, tx: 0, tz: 0, tr: 30, phase: 0, waitEnd: 0, shrinkEnd: 0, dps: 2, tick: 0, mesh: null };
export function resetStorm() {
  storm.on = oneLife(); storm.phase = -1; storm.x = storm.z = 0; storm.r = LIMIT * 1.45;
  if (storm.on) nextPhase();
  if (!storm.mesh) {
    storm.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 140, 72, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9a3cdc, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    storm.mesh.position.y = 50; scene.add(storm.mesh);
  }
  storm.mesh.visible = storm.on;
}
function nextPhase() {
  const ph = PHASES[++storm.phase]; if (!ph) { storm.waitEnd = storm.shrinkEnd = Infinity; return; }
  // bigger maps get bigger circles and a little longer to cross them; the first wait starts once the blimp is done
  const k = LIMIT / 32, tk = 1 + (k - 1) * 0.45;
  const extra = storm.phase === 0 && FLIGHT.on ? Math.max(0, FLIGHT.t0 + FLIGHT.dur * FLIGHT.inEnd - now) + 12 : 0;
  storm.fx = storm.x; storm.fz = storm.z; storm.fr = storm.r; storm.tr = ph[2] * k; storm.dps = PHASES[Math.max(0, storm.phase - 1)][3];
  const a = Math.random() * Math.PI * 2, d = Math.random() * Math.max(0, storm.r - storm.tr) * 0.8, lim = Math.max(0, HALF - storm.tr * 0.5);
  storm.tx = clamp(storm.x + Math.cos(a) * d, -lim, lim); storm.tz = clamp(storm.z + Math.sin(a) * d, -lim, lim);
  storm.waitEnd = now + ph[0] * tk + extra; storm.shrinkEnd = storm.waitEnd + ph[1] * tk;
}
export function updateStorm(dt) {
  if (!storm.on || !storm.mesh) return;
  const host = mode !== 'online' || botHost();
  if (host && state !== 'menu') {
    if (now >= storm.shrinkEnd) { storm.x = storm.tx; storm.z = storm.tz; storm.r = storm.tr; nextPhase(); }
    else if (now >= storm.waitEnd) {
      const k = (now - storm.waitEnd) / (storm.shrinkEnd - storm.waitEnd);
      storm.x = storm.fx + (storm.tx - storm.fx) * k; storm.z = storm.fz + (storm.tz - storm.fz) * k; storm.r = storm.fr + (storm.tr - storm.fr) * k;
      storm.dps = PHASES[storm.phase][3];
    }
  }
  storm.mesh.position.x = storm.x; storm.mesh.position.z = storm.z; storm.mesh.scale.set(Math.max(0.1, storm.r), 1, Math.max(0.1, storm.r));
  // the storm hurts me, and the bots I run
  const out = e => e.alive && !e.drop && Math.hypot(e.pos.x - storm.x, e.pos.z - storm.z) > storm.r;
  if (now >= storm.tick) { // in half-second bites, so it hurts (and sounds) like ticks
    storm.tick = now + 0.5;
    if (state === 'playing' && out(player)) damage(player, storm.dps * 0.5, null, 'Storm', false, null);
    if (host) for (const e of ents) if (e.ai && out(e)) damage(e, storm.dps * 0.5, null, 'Storm', false, null);
  }
  $('stormFx').style.opacity = state === 'playing' && out(player) ? 0.85 : 0;
}
// [x, z, r, next x, next z, next r, seconds to shrink, seconds to done, dps]
export function stormState() {
  return [r2(storm.x), r2(storm.z), r2(storm.r), r2(storm.tx), r2(storm.tz), r2(storm.tr), r2(Math.min(999, storm.waitEnd - now)), r2(Math.min(999, storm.shrinkEnd - now)), storm.dps];
}
export function syncStorm(a) {
  if (!Array.isArray(a) || a.length < 9) return;
  const v = a.map(num);
  const sl = LIMIT * 1.6;
  storm.on = true; [storm.x, storm.z, storm.r, storm.tx, storm.tz, storm.tr] = v.slice(0, 6).map(n => clamp(n, -sl, sl));
  storm.r = Math.max(0, storm.r); storm.tr = Math.max(0, storm.tr);
  storm.waitEnd = now + v[6]; storm.shrinkEnd = now + v[7]; storm.dps = clamp(v[8], 0, 50);
  if (storm.mesh) storm.mesh.visible = true;
}
export function stormText() {
  if (!storm.on) return '-';
  if (now < storm.waitEnd) return `closes in ${Math.ceil(storm.waitEnd - now)}s`;
  return now < storm.shrinkEnd ? 'closing!' : storm.r < 1 ? 'everywhere' : 'holding';
}
// who is still in: me, players who haven't gone down, and living bots
// in this match: not someone else's old match, and not a player waiting back in the lobby
export const inMatch = e => !e.zombie && (!e.remote || e.netbot || (e.m === net.m && !e.lobby));
export const isAliveNow = e => (e.remote && !e.netbot ? !e.dead : e.alive);
export function brAlive() { return ents.filter(e => inMatch(e) && isAliveNow(e)); }

// ---------- battle royale: the drop, loot chests, ammo and heals ----------
// Seeded numbers, so every screen in a room flies the same route and finds the same loot in each chest.
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export let brSeed = 'x';
export const newBrSeed = () => { brSeed = Math.random().toString(36).slice(2); }; // a new match offline: new chests
export const brKey = () => (mode === 'online' ? `${settings.room}:${net.m}` : brSeed);
const DOWN = new V3(0, -1, 0), _dp = new V3();
export const floorBelow = (x, y, z) => y - rayWorld(_dp.set(x, y, z), DOWN, 200); // the height of whatever is under (x, y, z)

// The blimp flies a straight line across the map. Everyone rides it, jumps out once it's over land
// (or gets pushed out before it leaves), falls, opens a glider and steers down to a landing spot.
export const DROP_ST = ['', 'ride', 'fall', 'glide']; // sent over the network by index
export const FLIGHT = { on: false, ax: 0, az: 0, bx: 0, bz: 0, t0: 0, dur: 1, inStart: 0, inEnd: 1, y: 60, mesh: null };
export const flightT = () => (now - FLIGHT.t0) / FLIGHT.dur;
const flightPos = (t, out = new V3()) => out.set(FLIGHT.ax + (FLIGHT.bx - FLIGHT.ax) * t, FLIGHT.y, FLIGHT.az + (FLIGHT.bz - FLIGHT.az) * t);
function blimpMesh() {
  const g = new THREE.Group(), RX = 4.2, RZ = 10;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), new THREE.MeshLambertMaterial({ color: 0xc8955a }));
  body.scale.set(RX, RX, RZ); g.add(body);
  const spotM = new THREE.MeshLambertMaterial({ color: 0x8a6036 }); // potato eyes, on the skin
  for (const [x, y, z, s] of [[2.6, 1.8, 3, 0.7], [-3, 1, -2, 0.9], [1.2, 3.2, -5, 0.6], [-2, 2.8, 5, 0.5], [3.4, -0.5, -4, 0.6], [-1.5, -2, -6, 0.5]]) {
    const f = 0.97 / Math.sqrt((x / RX) ** 2 + (y / RX) ** 2 + (z / RZ) ** 2);
    const m = new THREE.Mesh(body.geometry, spotM); m.scale.setScalar(s); m.position.set(x * f, y * f, z * f); g.add(m);
  }
  const finM = new THREE.MeshLambertMaterial({ color: 0xd9452f });
  for (const rz of [0, Math.PI / 2]) { const f = new THREE.Mesh(boxGeo, finM); f.scale.set(0.25, 5, 3.2); f.position.z = 9.2; f.rotation.z = rz; g.add(f); }
  const gond = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3b3f2e })); gond.scale.set(2.2, 1.3, 5.5); gond.position.y = -4.7; g.add(gond);
  const win = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); win.scale.set(2.25, 0.4, 4.6); win.position.y = -4.6; g.add(win);
  for (const s of [-1, 1]) { const r = new THREE.Mesh(boxGeo, SM.gear); r.scale.set(0.12, 1.6, 0.12); r.position.set(s * 0.8, -3.6, 0); g.add(r); }
  g.visible = false; scene.add(g);
  return g;
}
export function resetFlight() {
  FLIGHT.on = oneLife();
  if (!FLIGHT.mesh) FLIGHT.mesh = blimpMesh();
  FLIGHT.mesh.visible = FLIGHT.on;
  if (!FLIGHT.on) return;
  const r = rng(hashStr(brKey() + ':flight')), a = r() * Math.PI * 2, L = LIMIT * 1.35, off = (r() - 0.5) * HALF * 0.7;
  const dx = Math.cos(a), dz = Math.sin(a);
  FLIGHT.ax = -dx * L - dz * off; FLIGHT.az = -dz * L + dx * off; FLIGHT.bx = dx * L - dz * off; FLIGHT.bz = dz * L + dx * off;
  FLIGHT.y = 40 + LIMIT * 0.3; FLIGHT.dur = 2 * L / 17; FLIGHT.t0 = now + 2;
  // the stretch of the route over the playable ground: you can only jump there
  let s = -1, e = -1; const lim = HALF * 0.9, p = new V3();
  for (let i = 0; i <= 200; i++) { flightPos(i / 200, p); if (Math.abs(p.x) < lim && Math.abs(p.z) < lim) { if (s < 0) s = i / 200; e = i / 200; } }
  FLIGHT.inStart = s < 0 ? 0.4 : s; FLIGHT.inEnd = s < 0 ? 0.6 : e;
}
export function updateFlight() {
  if (!FLIGHT.on) return;
  const t = flightT();
  flightPos(t, FLIGHT.mesh.position);
  FLIGHT.mesh.rotation.set(Math.sin(now * 0.7) * 0.03, Math.atan2(-(FLIGHT.bx - FLIGHT.ax), -(FLIGHT.bz - FLIGHT.az)), Math.sin(now * 0.5) * 0.04);
  if (t > 1.25) { FLIGHT.on = false; FLIGHT.mesh.visible = false; }
}

// ---------- battle royale: the supply drop ----------
// Partway through the match the blimp comes back over the island and drops one crate of top-tier loot on a parachute.
// Where and when are seeded like the rest, so every screen in a room sees the same drop without a word on the network;
// the crate is the last chest in the list, so opening it and picking up its loot travel like any chest's.
const SUPPLY_AFTER = 75, SUPPLY_WARN = 10, CRATE_FALL = 5; // s after the first pass leaves; s of warning; m/s down
export const SUPPLY = { state: 'off', at: 0, dur: 1, ax: 0, az: 0, bx: 0, bz: 0, x: 0, z: 0, crate: null, warned: false, pendingOpen: false };
const supplyM = {
  trim: new THREE.MeshLambertMaterial({ color: 0xff7a1a }), chute: new THREE.MeshLambertMaterial({ color: 0xf2efe6, side: THREE.DoubleSide }),
  beam: new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.3, depthWrite: false }),
};
export function resetSupply() {
  Object.assign(SUPPLY, { state: oneLife() && FLIGHT.on ? 'wait' : 'off', crate: null, warned: false, pendingOpen: false, landAt: 0 });
  if (SUPPLY.state === 'off') return;
  const r = rng(hashStr(brKey() + ':supply')), lim = HALF * 0.7;
  const spots = SPAWNS.filter(s => Math.abs(s[0]) < lim && Math.abs(s[1]) < lim);
  // a spot a few metres off a spawn (maps keep chests by them), short of any wall: the first of a few seeded tries
  // that lands on open ground well clear of every chest
  const list = spots.length ? spots : SPAWNS.length ? SPAWNS : [[0, 0]], dir = new V3();
  let s = list[0];
  for (let k = 0; k < 16; k++) {
    const b = list[(r() * list.length) | 0], ao = r() * Math.PI * 2; dir.set(Math.cos(ao), 0, Math.sin(ao));
    const od = Math.max(0, Math.min(6, rayWorld(_dp.set(b[0], 1, b[1]), dir, 7) - 1.5)), x = b[0] + dir.x * od, z = b[1] + dir.z * od;
    s = [x, z];
    if (floorBelow(x, 60, z) - floorBelow(b[0], 60, b[1]) < 0.6 && CH.list.every(c => Math.hypot(c.x - x, c.z - z) > 4)) break;
  }
  const a = r() * Math.PI * 2, L = LIMIT * 1.35, dx = Math.cos(a), dz = Math.sin(a);
  SUPPLY.x = s[0]; SUPPLY.z = s[1]; // the route crosses the island with the drop spot halfway along
  SUPPLY.ax = s[0] - dx * L; SUPPLY.az = s[1] - dz * L; SUPPLY.bx = s[0] + dx * L; SUPPLY.bz = s[1] + dz * L;
  SUPPLY.dur = 2 * L / 22; SUPPLY.at = FLIGHT.t0 + FLIGHT.dur * 1.25 + SUPPLY_AFTER;
}
// where the supply drop is, for the map and the on-screen marker: from the warning until someone opens it.
// eta: seconds until it touches down (0 once it has)
export function supplyStatus() {
  const S = SUPPLY, c = S.crate;
  if (S.state === 'off' || !S.warned || (c && c.open)) return null;
  if (c && !c.falling) return { x: S.x, y: c.y, z: S.z, landed: true, eta: 0 };
  if (c) return { x: S.x, y: c.y, z: S.z, landed: false, eta: (c.y - c.gy) / CRATE_FALL };
  if (!S.landAt) { const y0 = FLIGHT.y - 5; S.landAt = S.at + S.dur * 0.5 + Math.max(0, y0 - floorBelow(S.x, y0, S.z)) / CRATE_FALL; }
  return { x: S.x, y: FLIGHT.y, z: S.z, landed: false, eta: Math.max(0, S.landAt - now) };
}
function spawnCrate() {
  const y0 = FLIGHT.y - 5, gy = floorBelow(SUPPLY.x, y0, SUPPLY.z);
  const c = { i: CH.list.length, x: SUPPLY.x, y: y0, z: SUPPLY.z, gy, rot: 0, open: false, claim: null, supply: true, falling: true };
  chestMesh(c); CH.list.push(c); SUPPLY.crate = c;
  c.mesh.scale.setScalar(1.4); c.trims.forEach(m => { m.material = supplyM.trim; });
  c.beam.material = supplyM.beam; c.beam.scale.set(2.5, 60, 2.5); c.beam.position.y = 30; c.beam.visible = false;
  const chute = new THREE.Group(), dome = new THREE.Mesh(canopyG, supplyM.chute); dome.scale.set(1.3, 0.8, 1.3); dome.position.y = 3.2; chute.add(dome);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(boxGeo, SM.gear); l.scale.set(0.03, 2.6, 0.03); l.position.set(x * 0.55, 1.9, z * 0.45); l.rotation.set(z * 0.3, 0, -x * 0.3); chute.add(l); }
  c.mesh.add(chute); c.chute = chute;
}
export function updateSupply(dt) {
  const S = SUPPLY;
  if (S.state === 'off') return;
  if (S.state === 'wait') {
    if (!S.warned && now >= S.at - SUPPLY_WARN) { S.warned = true; if (state === 'playing') { toast('Supply drop incoming: <em></em>', 'top-tier loot, marked on your map', false); sfx.pad(); } MM.at = 0; }
    if (now < S.at) return;
    S.state = 'fly';
  }
  if (S.state === 'fly') {
    const t = (now - S.at) / S.dur, m = FLIGHT.mesh;
    if (m && !FLIGHT.on) {
      m.visible = t <= 1.1;
      m.position.set(S.ax + (S.bx - S.ax) * t, FLIGHT.y, S.az + (S.bz - S.az) * t);
      m.rotation.set(Math.sin(now * 0.7) * 0.03, Math.atan2(-(S.bx - S.ax), -(S.bz - S.az)), Math.sin(now * 0.5) * 0.04);
    }
    if (t >= 0.5 && !S.crate) spawnCrate();
    if (t > 1.1) { S.state = 'done'; if (m && !FLIGHT.on) m.visible = false; }
  }
  const c = S.crate;
  if (c && c.falling) {
    c.y = Math.max(c.gy, c.y - CRATE_FALL * dt); c.mesh.position.y = c.y;
    c.mesh.rotation.z = Math.sin(now * 1.3) * 0.06; // swinging under the chute
    if (c.y <= c.gy) {
      c.falling = false; c.mesh.rotation.z = 0; c.mesh.remove(c.chute); c.beam.visible = true;
      if (state === 'playing') sfx.land(distVol(c.mesh.position));
      if (S.pendingOpen) openChest(c.i, null, true); // someone else's screen already opened it
    }
  }
}
// the crate's loot: one Epic or Legendary gun, plenty of ammo for it, a medkit, bandages and frags
export function supplyLoot(i) {
  const r = rng(hashStr(brKey() + ':supply' + i)), guns = CHEST_GUNS.filter(([id]) => id !== KNIFE);
  const gid = guns[(r() * guns.length) | 0][0];
  return [{ kind: 'gun', w: gid, qty: WEAPONS[gid].mag, r: r() < 0.45 ? 4 : 3 }, { kind: 'ammo', type: AMMO_OF[gid], qty: AMMO[AMMO_OF[gid]].pack * 2 },
    { kind: 'heal', type: 'medkit', qty: 1 }, { kind: 'heal', type: 'bandage', qty: 2 }, { kind: 'frag', qty: 2 }];
}
// a soldier's glider: a canopy over their head while they come down
const canopyM = new THREE.MeshLambertMaterial({ color: 0xffc83d, side: THREE.DoubleSide });
const canopyG = new THREE.SphereGeometry(1.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
export function setCanopy(e, on) {
  if (!e.mesh) return;
  const u = e.mesh.userData;
  if (on && !u.canopy) {
    u.canopy = new THREE.Group();
    const dome = new THREE.Mesh(canopyG, canopyM); dome.scale.set(1, 0.55, 1.2); dome.position.y = 3.6; u.canopy.add(dome);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(boxGeo, SM.gear); l.scale.set(0.03, 2.1, 0.03); l.position.set(x * 0.55, 2.55, z * 0.65); l.rotation.set(z * 0.25, 0, -x * 0.22); u.canopy.add(l); }
    e.mesh.add(u.canopy);
  }
  if (u.canopy) u.canopy.visible = on;
}
// in battle royale every soldier starts on the blimp (or, once it has gone, high over a spawn)
export function startDrop(e) {
  const t = flightT();
  e.drop = { stage: 'ride', at: now, jumpT: FLIGHT.inStart + (FLIGHT.inEnd - FLIGHT.inStart) * rand(0.05, 0.9), goal: null };
  e.vel.set(0, 0, 0); e.onGround = false;
  if (!FLIGHT.on || t > FLIGHT.inEnd) { const s = pick(SPAWNS); e.pos.set(s[0], 40 + LIMIT * 0.3, s[1]); leaveFlight(e); }
  else flightPos(Math.max(0, t), e.pos).y -= 5;
  if (e.mesh) { e.mesh.visible = e.drop.stage !== 'ride'; setCanopy(e, false); }
}
function leaveFlight(e) {
  const d = e.drop; d.stage = 'fall'; d.at = now;
  if (FLIGHT.on && flightT() <= 1) e.vel.set((FLIGHT.bx - FLIGHT.ax) / FLIGHT.dur * 0.25, 0, (FLIGHT.bz - FLIGHT.az) / FLIGHT.dur * 0.25);
  if (e.mesh) e.mesh.visible = true;
  if (e.isPlayer) sfx.toss();
  if (e.ai) { // a bot claims one of the closest chests below it, keeping clear of chests other bots already claimed
    const near = CH.list.filter(c => !c.open).map(c => [c, Math.hypot(c.x - e.pos.x, c.z - e.pos.z)]).filter(a => a[1] < 70).sort((a, b) => a[1] - b[1]).slice(0, 10).map(a => a[0]);
    const claimed = CH.list.filter(c => c.claim && c.claim !== e && c.claim.alive);
    const free = near.filter(c => !claimed.includes(c)), clear = free.filter(c => claimed.every(o => Math.hypot(o.x - c.x, o.z - c.z) > 15));
    const list = clear.length ? clear : free.length ? free : near;
    if (list.length) { d.goal = pick(list); d.goal.claim = e; } else { const s = pick(SPAWNS); d.goal = { x: s[0], z: s[1], y: 0 }; }
  }
}
function openGlider(e) {
  if (!e.drop || e.drop.stage !== 'fall') return;
  e.drop.stage = 'glide'; setCanopy(e, true);
  if (e.isPlayer) sfx.glider();
}
export const LOOT_WINDOW = 25; // seconds after landing that a bot ignores other bots (unless one shoots it); players are fair game
function land(e) {
  e.drop = null; setCanopy(e, false); e.landedAt = now; e.hurtBy = null;
  if (e.mesh) e.mesh.visible = true;
  if (e.isPlayer) sfx.slide();
}
// one step of a drop for anyone I run: wish is the way they steer
export function updateDrop(e, dt, wish) {
  const d = e.drop;
  if (d.stage === 'ride') {
    const t = flightT();
    flightPos(clamp(t, 0, 1), e.pos).y -= 5; e.vel.set(0, 0, 0);
    if (!FLIGHT.on || t >= FLIGHT.inEnd || (e.ai && t >= d.jumpT)) leaveFlight(e);
    return;
  }
  if (d.stage === 'fall' && e.pos.y - floorBelow(e.pos.x, e.pos.y, e.pos.z) < 20) openGlider(e);
  const glide = d.stage === 'glide', spd = glide ? 10 : 7;
  const n = Math.ceil(dt / 0.02), h = dt / n; // small steps: falling fast must not go through a roof
  for (let i = 0; i < n; i++) {
    e.vel.x += (wish.x * spd - e.vel.x) * Math.min(1, h * 2); e.vel.z += (wish.z * spd - e.vel.z) * Math.min(1, h * 2);
    if (glide) e.vel.y += (-4.5 - e.vel.y) * Math.min(1, h * 3); else e.vel.y = Math.max(-26, e.vel.y - G * h);
    e.vel.y += grav() * h; // moveEntity takes gravity off again
    moveEntity(e, h);
    if (e.onGround) { land(e); return; }
  }
}
export function dropPress(p) {
  const d = p.drop; if (!d) return;
  if (d.stage === 'ride' && flightT() >= FLIGHT.inStart) leaveFlight(p);
  else if (d.stage === 'fall' && now - d.at > 0.3) openGlider(p);
}
export function botDrop(b, dt) {
  const d = b.drop, wish = new V3();
  if (d.goal) {
    wish.set(d.goal.x - b.pos.x, 0, d.goal.z - b.pos.z);
    const l = wish.length(); if (l > 1) { wish.divideScalar(l); b.yaw += angDiff(b.yaw, Math.atan2(-wish.x, -wish.z)) * Math.min(1, dt * 3); } else wish.set(0, 0, 0);
  }
  updateDrop(b, dt, wish);
  poseSoldier(b, dt);
  setCanopy(b, !!b.drop && b.drop.stage === 'glide');
}
