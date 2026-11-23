// Zombies: co-op waves (game.js runs the match; this is the mode's own rules)
import { sfx } from '../audio.js';
import { navPoint, stairWaypoint } from '../bots.js';
import { JUMP, R, WNAMES } from '../config.js';
import { awardKill, buildTable, gainXP, toast, updateScoreTop } from '../hud.js';
import { net, netEvent, num, r2 } from '../netsync.js';
import * as P from '../progress.js';
import { $, clamp, rand, V3 } from '../util.js';
import { LIMIT, SPAWNS } from '../world.js';
import { boardRow } from './runs.js';
import {
  _b, angDiff, BLOOD, bodyC, burst, damage, ents, game, grip, mode, moveEntity, newEntity, now, pick, player, poseSoldier, refreshVM,
  relockAfterDeath, respawn, scene, setState, showOverXp, soldierMesh, state
} from '../game.js';

// ---------- zombies: co-op waves ----------
// Offline, or online as the host (the lowest player id still in this match), this client runs the zombies.
// Everyone else draws them from the host's presence and sends their hits on zombies to the host.
// If the host leaves, the next lowest id picks up the zombies where they are.
export const Z = { wave: 0, toSpawn: 0, nextSpawn: 0, breakUntil: 0, list: [], byId: new Map(), nextId: 1, over: false, overAt: 0, left: 0 };
const ZOMBIE_W = WNAMES.indexOf('Zombie');
const ZOMBIE_LOOKS = ['woodland', 'urban', 'desert', 'olive', 'night'];
export function hostPeer() { let lo = net.myPeer; for (const r of net.remotes.values()) if (r.m === net.m && r.peer < lo) lo = r.peer; return lo; }
export const zHost = () => mode !== 'online' || hostPeer() === net.myPeer;
const humans = () => [player, ...[...net.remotes.values()].filter(r => r.m === net.m)];
export const zLeft = () => (zHost() ? Z.toSpawn + Z.list.length : Z.left);
export function nearestZombie(pos) { let best = null, bd = Infinity; for (const z of Z.list) { const d = z.pos.distanceTo(pos); if (d < bd) { bd = d; best = z; } } return best; }
function addZombie(id, x, z, remote) {
  const e = newEntity('Zombie', '#7da34a', false, []);
  Object.assign(e, { zombie: true, zid: id, peer: 'z' + id, remote, target: new V3(x, 0, z), tyaw: 0, atkReady: 0, sideT: 0, side: 1 });
  e.pos.set(x, 0, z); e.alive = true; e.hp = 50 + Z.wave * 12;
  e.speed = Math.min(6.8, 3.4 + Z.wave * 0.25) * (Math.random() < 0.2 ? 1.3 : 1); // a few sprinters
  e.mesh = soldierMesh('', '#5f7f3a', true, { uniform: pick(ZOMBIE_LOOKS) });
  const u = e.mesh.userData; u.skinM.color.setHex(0x8fae6a); u.aim.children.slice(4, 7).forEach(c => { c.visible = false; }); // green skin, no gun
  e.mesh.position.copy(e.pos);
  Z.list.push(e); Z.byId.set(id, e); ents.push(e);
  return e;
}
function removeZombie(z, died) {
  if (died) { bodyC(z, _b); burst(_b, [0x5a7a2a, ...BLOOD], 12, 5, 0.1, 0.8); }
  z.alive = false; scene.remove(z.mesh);
  Z.list.splice(Z.list.indexOf(z), 1); Z.byId.delete(z.zid);
  const i = ents.indexOf(z); if (i >= 0) ents.splice(i, 1);
}
export function resetZombies() {
  for (const z of [...Z.list]) removeZombie(z, false);
  Object.assign(Z, { wave: 0, toSpawn: 0, nextSpawn: 0, breakUntil: 0, nextId: 1, over: false, overAt: 0, left: 0 });
}
export function zombieDied(z, src, wname, head) {
  removeZombie(z, true);
  if (src === player) { player.kills++; sfx.kill(); if (state === 'playing') awardKill(wname, head); }
  else if (src && src.remote && !src.zombie) netEvent('zx', src.peer, WNAMES.indexOf(wname), head ? 1 : 0);
  updateScoreTop();
}
// every client, when a new wave starts: the downed get back up
function onWave(w) {
  if (state !== 'playing' && state !== 'paused') return;
  toast('Wave <em></em>', String(w), false); sfx.kill();
  if (!player.alive) { respawn(player); $('death').hidden = true; refreshVM(); relockAfterDeath(); }
}
// a free spot at least 12 m from every living player
function zombieSpawnPoint() {
  const hs = humans().filter(h => h.alive);
  const ok = SPAWNS.filter(s => hs.every(h => Math.hypot(h.pos.x - s[0], h.pos.z - s[1]) > 12));
  return pick(ok.length ? ok : SPAWNS);
}
const inPlay = h => h.alive && (h !== player || state === 'playing'); // a paused host isn't chased
export function updateZombies(dt) {
  if (game !== 'zombies') return;
  const host = zHost();
  for (const z of Z.list) z.remote = !host;
  if (!host) { // draw the host's zombies
    for (const z of Z.list) {
      const px = z.pos.x, pz = z.pos.z;
      if (z.pos.distanceTo(z.target) > 6) z.pos.copy(z.target); else z.pos.lerp(z.target, 1 - Math.pow(0.0005, dt));
      z.yaw += angDiff(z.yaw, z.tyaw) * Math.min(1, dt * 12);
      z.vel.set((z.pos.x - px) / Math.max(dt, 1e-3), 0, (z.pos.z - pz) / Math.max(dt, 1e-3));
      poseSoldier(z, dt);
    }
    return;
  }
  if (Z.over) { if (now >= Z.overAt && state === 'playing') endZombies(); return; }
  const hs = humans();
  if (Z.wave > 0 && hs.every(h => (h === player ? !h.alive : h.dead))) { Z.over = true; Z.overAt = now + 2; return; } // everyone down
  if (!Z.list.length && Z.toSpawn <= 0) {
    if (!Z.breakUntil) Z.breakUntil = now + (Z.wave ? 6 : 3);
    else if (now >= Z.breakUntil) {
      Z.breakUntil = 0; Z.wave++;
      Z.toSpawn = Math.round((4 + Z.wave * 3) * (1 + 0.5 * (hs.length - 1)));
      onWave(Z.wave);
    }
  }
  if (Z.toSpawn > 0 && Z.list.length < 20 && now >= Z.nextSpawn) {
    const sp = zombieSpawnPoint(); addZombie(Z.nextId++, sp[0] + rand(-1, 1), sp[1] + rand(-1, 1), false); Z.toSpawn--;
    Z.nextSpawn = now + Math.max(0.35, 1.5 - Z.wave * 0.08);
  }
  for (const z of [...Z.list]) updateZombie(z, dt, hs);
}
function updateZombie(z, dt, hs) {
  let tgt = null, bd = Infinity;
  for (const h of hs) if (inPlay(h)) { const d = h.pos.distanceTo(z.pos); if (d < bd) { bd = d; tgt = h; } }
  const wish = new V3();
  if (tgt && now >= z.blindUntil) {
    const wp = navPoint(z, stairWaypoint(z, tgt.pos) || tgt.pos); // a target on another floor: head for the stairs
    wish.set(wp.x - z.pos.x, 0, wp.z - z.pos.z).normalize();
    if (now < z.sideT) wish.set(-wish.z * z.side, 0, wish.x * z.side).addScaledVector(wish, 0.3).normalize(); // detour round a wall
    if (bd < 1.6 && now >= z.atkReady && Math.abs(tgt.pos.y - z.pos.y) < 1.5) {
      z.atkReady = now + 0.9;
      const dmg = Math.min(35, 18 + Z.wave);
      if (tgt === player) damage(player, dmg, z, 'Zombie', false, null);
      else netEvent('h', tgt.peer, dmg, 0, ZOMBIE_W);
    }
  }
  const sp = z.speed * (now < z.stunUntil ? 0.4 : 1), k = z.launched ? 0 : Math.min(1, (z.onGround ? 8 * grip(z) : 2) * dt);
  z.vel.x += (wish.x * sp - z.vel.x) * k; z.vel.z += (wish.z * sp - z.vel.z) * k;
  moveEntity(z, dt);
  // blocked: climb the wall if the target is higher up (zombies scale buildings), otherwise go round
  if (z.bumped && tgt && tgt.pos.y > z.pos.y + 1) z.vel.y = 3.5;
  else if (z.bumped && now >= z.sideT) { z.sideT = now + 0.9; z.side = Math.random() < 0.5 ? -1 : 1; if (z.onGround) z.vel.y = JUMP * 0.8; }
  const lim = LIMIT - R; z.pos.x = clamp(z.pos.x, -lim, lim); z.pos.z = clamp(z.pos.z, -lim, lim); // never over the boundary wall
  if (wish.lengthSq() > 0) z.yaw += angDiff(z.yaw, Math.atan2(-wish.x, -wish.z)) * Math.min(1, dt * 8);
  poseSoldier(z, dt);
}
// what the host sends: wave, game over, zombies left, and each zombie [id, x, y, z, yaw, hp]
export function zombieState() {
  return { w: Z.wave, o: Z.over ? 1 : 0, n: zLeft(), l: Z.list.map(z => [z.zid, r2(z.pos.x), r2(z.pos.y), r2(z.pos.z), r2(z.yaw), Math.ceil(z.hp)]) };
}
export function syncZombies(zs) {
  if (!zs || typeof zs !== 'object' || !Array.isArray(zs.l)) return;
  const w = clamp(zs.w | 0, 0, 9999);
  if (w > Z.wave) { Z.wave = w; onWave(w); } else Z.wave = w;
  Z.left = clamp(zs.n | 0, 0, 9999);
  const seen = new Set();
  for (const a of zs.l.slice(0, 40)) {
    if (!Array.isArray(a)) continue;
    const id = a[0] | 0; if (id <= 0) continue;
    seen.add(id);
    const x = clamp(num(a[1]), -LIMIT, LIMIT), y = clamp(num(a[2]), 0, 40), zz = clamp(num(a[3]), -LIMIT, LIMIT);
    const z = Z.byId.get(id) || addZombie(id, x, zz, true);
    z.target.set(x, y, zz); z.tyaw = num(a[4]); z.hp = num(a[5]);
    Z.nextId = Math.max(Z.nextId, id + 1);
  }
  for (const z of [...Z.list]) if (!seen.has(z.zid)) removeZombie(z, true);
  if (zs.o === 1 && state === 'playing') endZombies();
}
function endZombies() {
  if (state === 'over') return;
  setState('over');
  $('overTitle').textContent = `Overrun on wave ${Z.wave}`;
  buildTable($('overTbl'));
  gainXP(P.XP.match + 60 * Z.wave, { match: true });
  showOverXp();
  boardRow('zombies', Z.wave, player.kills | 0);
}
