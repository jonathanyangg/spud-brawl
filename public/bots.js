// Bots: their brains (offline, and on the bot host online), the roster, and drawing the host's bots on everyone else's screen.
import { BOT_NAMES, DIFF, H, HATS, JUMP, KNOCK, R, STEP, TEAM_COLORS, WEAPONS } from './config.js';
import { HALF, LIMIT, PADS, PAD_R, STAIRS, boxes, currentMap } from './world.js';
import { buildNav, navToward } from './nav.js';
import { sfxShot } from './audio.js';
import { V3, clamp, rand } from './util.js';
import {
  DROP_ST, FLIGHT, HEAL_KEYS, LOOT_WINDOW, _f, _h, _o, angDiff, botArm, botDrop, botLoot, botThrow, botSquads, cfg, distVol, ents, eyePos, fwdVec, grip, headC, moveEntity,
  idOf, isUp, muzzleOf, newEntity, now, oneLife, pick, player, poseK, poseSoldier, randomLook, rayWorld, respawn, revProg, sameTeam, scene, soldierMesh, squadsOn,
  startHeal, startReload, startRevive, state, storm, teams, teamsOn, tracer, tryFire, versus
} from './game.js';
import { botHost, cleanName, net, num, r2, remoteDrop, remoteReload } from './netsync.js';
import { scoresChanged } from './hud.js';

// teams: the team of each bot (team deathmatch), or nothing
export function setupBots(n, diff, teams) {
  for (const e of ents) if (e.mesh) scene.remove(e.mesh);
  ents.length = 0; ents.push(player);
  for (let i = 0; i < n; i++) makeBot(teams ? teams[i] : undefined, diff);
}
// bid: the bot's id, the same on every screen online (kept when another player takes the bots over)
let botSeq = 0;
export function makeBot(team, diff, name = freeBotName(), bid = ++botSeq) {
  botSeq = Math.max(botSeq, bid);
  const b = newEntity(name, team === undefined || !teamsOn() ? HATS[bid % HATS.length] : TEAM_COLORS[team], false);
  b.bid = bid; b.team = team;
  b.mesh = soldierMesh(b.name, b.color, true, randomLook());
  b.ai = { d: DIFF[diff] || DIFF.normal, target: null, visible: false, reactAt: 0, nextScan: 0, strafeDir: 1, strafeSwitch: 0, goal: null, goalExpire: 0,
    lastSeen: new V3(), lastSeenAt: -99, stuckAt: 0, lastPos: new V3(), stuck: 0, aimH: 1.3, nextJump: 0, burst: 4, burstPause: 0 };
  ents.push(b); respawn(b);
  return b;
}
function freeBotName() {
  const used = new Set(ents.map(e => e.name)), free = BOT_NAMES.filter(n => !used.has(n));
  if (free.length) return pick(free);
  for (let i = 2; ; i++) { const n = `${pick(BOT_NAMES)} ${i}`; if (!used.has(n)) return n; }
}
function removeBot(b) {
  if (teamsOn() && b.team !== undefined) teams.bank[b.team] += b.kills; // their kills still count for the team
  scene.remove(b.mesh); ents.splice(ents.indexOf(b), 1); scoresChanged();
}

// ---------- bot brains ----------
function canSee(b, t) {
  eyePos(b, _o); headC(t, _h);
  const d = _h.clone().sub(_o); const dist = d.length(); d.divideScalar(dist);
  return rayWorld(_o, d, dist) >= dist - 0.05;
}
// Multi-floor maps: when the goal is a floor up or down, walk to the nearest stairs that start on this floor
// (preferring ones that end nearest the goal's height), then up or down them.
export function stairWaypoint(e, goal) {
  if (e.climb) {
    if (now < e.climb.until && Math.hypot(e.climb.x - e.pos.x, e.climb.z - e.pos.z) > 0.7) return e.climb;
    e.climb = null;
  }
  const dy = goal.y - e.pos.y; if (Math.abs(dy) < 1.5) return null;
  const up = dy > 0; let best = null, bs = Infinity;
  for (const st of STAIRS) {
    if (st.pad && !up) continue; // jump pads only go up; to get down, walk off the edge
    if (up && st.y1 > goal.y + 1.5) continue; // overshoots: we'd only have to come back down
    if (Math.abs(e.pos.y - (up ? st.y0 : st.y1)) > 1) continue;
    if (up && goal.y - st.y1 > 1.5 && !STAIRS.some(o => o !== st && Math.abs(o.y0 - st.y1) < 0.3)) continue; // dead end below the goal
    // the walk to these stairs plus the walk from where they come out to the goal (so we take the flight that leads there)
    const [ex, ez] = up ? st.foot : st.top, [ox, oz] = up ? st.top : st.foot;
    const score = Math.hypot(ex - e.pos.x, ez - e.pos.z) + Math.hypot(goal.x - ox, goal.z - oz) + 10 * Math.abs(goal.y - (up ? st.y1 : st.y0));
    if (score < bs) { bs = score; best = st; }
  }
  if (!best) return null;
  const [ex, ez] = up ? best.foot : best.top, [xx, xz] = up ? best.top : best.foot;
  if (Math.hypot(ex - e.pos.x, ez - e.pos.z) < 1.2) { e.climb = { x: xx, z: xz, until: now + 5 }; return e.climb; }
  // indoor stairs with a wall in the way: go via the doorway point nearest the stairs that we can walk straight to
  if (best.via && !clearTo(e, ex, ez)) {
    let bv = null, bd = Infinity;
    for (const [vx, vz] of best.via) { const d = Math.hypot(vx - ex, vz - ez); if (d < bd && clearTo(e, vx, vz)) { bd = d; bv = { x: vx, z: vz }; } }
    if (bv) return bv;
  }
  return { x: ex, z: ez };
}
// on the ground with something in the way: follow the ground grid round it
let nav = null, navMap = null;
export function navPoint(e, wp) {
  // the grid keeps a body's width off walls, so follow it unless the spot is right there (a straight ray can
  // slip past a corner that the body then snags on)
  if (e.climb || e.pos.y > 0.6 || (Math.hypot(wp.x - e.pos.x, wp.z - e.pos.z) < 2 && clearTo(e, wp.x, wp.z))) return wp;
  if (navMap !== currentMap) { nav = buildNav(boxes.filter(b => !b.dyn), LIMIT, R, STEP, H, PADS.filter(p => p.y < 0.6).map(p => ({ x: p.x, z: p.z, r: PAD_R }))); navMap = currentMap; }
  return navToward(nav, e.pos.x, e.pos.z, wp.x, wp.z) || wp;
}
// nothing solid between e and (x, z) at knee height
function clearTo(e, x, z) {
  _o.set(e.pos.x, e.pos.y + 0.6, e.pos.z); _h.set(x - e.pos.x, 0, z - e.pos.z);
  const d = _h.length(); if (d < 0.01) return true;
  _h.divideScalar(d); return rayWorld(_o, _h, d) >= d;
}
function randomGoal() {
  if (oneLife() && storm.on) { // somewhere inside the next circle
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * storm.tr * 0.8, x = storm.tx + Math.cos(a) * d, z = storm.tz + Math.sin(a) * d;
      if (Math.abs(x) < HALF && Math.abs(z) < HALF && !boxes.some(b => x + 1 > b.min.x && x - 1 < b.max.x && z + 1 > b.min.z && z - 1 < b.max.z)) return new V3(x, 0, z);
    }
    return new V3(storm.tx, 0, storm.tz);
  }
  if (STAIRS.length && Math.random() < 0.25) { const st = pick(STAIRS); return new V3(st.top[0], st.y1, st.top[1]); } // roam upstairs too
  for (let i = 0; i < 20; i++) {
    const x = rand(-HALF, HALF), z = rand(-HALF, HALF);
    if (!boxes.some(b => x + 1 > b.min.x && x - 1 < b.max.x && z + 1 > b.min.z && z - 1 < b.max.z)) return new V3(x, 0, z);
  }
  return new V3(rand(-4, 4), 0, rand(-4, 4));
}
export function updateBot(b, dt) {
  if (!b.alive) { if (now >= b.respawnAt) respawn(b); return; }
  if (b.drop) return botDrop(b, dt);
  if (b.knock) return botCrawl(b, dt);
  const ai = b.ai, w = b.guns[b.weapon];
  const blind = now < b.blindUntil, stunned = now < b.stunUntil;
  if (blind) ai.visible = false; // flashed: can't pick anyone out, just wanders
  else if (now >= ai.nextScan) {
    ai.nextScan = now + 0.22;
    let best = null, bd = Infinity;
    for (const t of ents) {
      if (t === b || !t.alive || t.drop || sameTeam(t, b)) continue;
      if (t.ai && oneLife() && now - b.landedAt < LOOT_WINDOW && b.hurtBy !== t) continue; // fresh off the blimp: loot, leave other bots be
      let d = t.pos.distanceTo(b.pos) * (t.isPlayer ? 0.85 : 1) * (t.knock ? 2.5 : 1); // someone already down can wait
      if (d < 55 && d < bd && canSee(b, t)) { bd = d; best = t; }
    }
    if (best) {
      if (ai.target !== best || !ai.visible) {
        const toT = Math.atan2(-(best.pos.x - b.pos.x), -(best.pos.z - b.pos.z));
        const behind = Math.abs(angDiff(b.yaw, toT)) > 1.4;
        ai.reactAt = now + ai.d.react * rand(0.8, 1.25) + (behind ? 0.35 : 0);
        ai.aimH = rand(0.85, 1.65);
      }
      ai.target = best; ai.visible = true; ai.lastSeen.copy(best.pos); ai.lastSeenAt = now;
    } else ai.visible = false;
  }
  if (ai.target && !ai.target.alive) { ai.target = null; ai.visible = false; }

  const wish = new V3();
  const tgt = ai.visible ? ai.target : null;
  // battle royale: a bot with only its knife goes for a gun before it picks a fight it can't reach
  // and with only a knife it fights another knife, or anyone within 4 m; from a gun it backs off while it loots
  const knifeOnly = oneLife() && b.guns.length === 1, tdist = tgt ? tgt.pos.distanceTo(b.pos) : 0;
  const engage = tgt && (!knifeOnly || tdist < 4 || b.hurtBy === tgt);
  const threat = tgt && !engage && knifeOnly && tgt.guns.length > 1 && tdist < 20 ? tgt : null;
  // squads: with nobody to shoot, a squadmate down comes first, then your own health
  let help = null;
  if (squadsOn() && !tgt) { let hd = 45; for (const e of ents) if (e !== b && e.knock && sameTeam(e, b) && isUp(e)) { const d = e.pos.distanceTo(b.pos); if (d < hd) { hd = d; help = e; } } }
  if (help) b.useT = null;
  if (oneLife() && !tgt && !help && b.hp < 65 && !b.useT) startHeal(b);
  if (oneLife()) botArm(b);
  // battle royale: a frag at someone in the open at mid range, or where they ducked out of sight a moment ago
  if (oneLife() && b.frags > 0 && now > (ai.nextNade || 0) && !b.reloading && !b.useT && !knifeOnly && ai.target?.alive) {
    const lost = !tgt && now - ai.lastSeenAt < 2.5, at = tgt ? tgt.pos : lost ? ai.lastSeen : null;
    const d = at ? Math.hypot(at.x - b.pos.x, at.z - b.pos.z) : 0;
    if (at && d > 9 && d < 26 && Math.random() < dt * (lost ? 1.2 : 0.35)) { botThrow(b, at.x, at.y, at.z); ai.nextNade = now + rand(5, 9); }
  }
  if (engage) {
    const to = new V3(tgt.pos.x - b.pos.x, 0, tgt.pos.z - b.pos.z); const dist = to.length(); to.divideScalar(dist || 1);
    if (now > ai.strafeSwitch) { ai.strafeDir = Math.random() < 0.5 ? -1 : 1; ai.strafeSwitch = now + rand(0.5, 1.6); }
    wish.set(-to.z * ai.strafeDir, 0, to.x * ai.strafeDir);
    if (w.kind === 'melee') wish.multiplyScalar(0.4).addScaledVector(to, 1.5); // knife: close in
    else if (dist > w.pref + 4) wish.addScaledVector(to, 1.3); else if (dist < w.pref - 3) wish.addScaledVector(to, -0.9);
    if (now > ai.nextJump && b.onGround && Math.random() < dt * 0.6) { b.vel.y = JUMP; ai.nextJump = now + 1.2; }
    if (b.ammo[b.weapon] < w.mag * 0.25 && !b.reloading && dist > 20) startReload(b);
  } else {
    const chasing = now - ai.lastSeenAt < 6 && !knifeOnly;
    if (oneLife()) botLoot(b, ai);
    if (oneLife() && storm.on && Math.hypot(b.pos.x - storm.x, b.pos.z - storm.z) > storm.r - 3 && (!ai.goal || Math.hypot(ai.goal.x - storm.tx, ai.goal.z - storm.tz) > storm.tr)) ai.goal = null; // run from the storm
    if (!ai.goal || now > ai.goalExpire || (Math.hypot(ai.goal.x - b.pos.x, ai.goal.z - b.pos.z) < 1.5 && Math.abs(ai.goal.y - b.pos.y) < 1.5)) {
      if (chasing) { ai.goal = ai.lastSeen.clone(); ai.lastSeenAt = -99; } // chase the last sighting once, then wander
      else ai.goal = randomGoal();
      ai.goalExpire = now + rand(6, 10);
    }
    const wp = navPoint(b, stairWaypoint(b, ai.goal) || ai.goal);
    wish.set(wp.x - b.pos.x, 0, wp.z - b.pos.z);
    if (!b.reloading && b.ammo[b.weapon] < w.mag) startReload(b);
    if (threat) { // keep heading for loot, but bend away from the gun
      if (wish.lengthSq() > 0.0001) wish.normalize();
      const away = new V3(b.pos.x - threat.pos.x, 0, b.pos.z - threat.pos.z); away.divideScalar(away.length() || 1);
      wish.addScaledVector(away, 1.4 * (1 - tdist / 20) + 0.4);
    }
  }
  if (help) { // go to them, then kneel and hold till they're up
    if (help.pos.distanceTo(b.pos) < KNOCK.reach - 0.4) { wish.set(0, 0, 0); startRevive(b, help); }
    else { b.rev = null; const wp = navPoint(b, help.pos); wish.set(wp.x - b.pos.x, 0, wp.z - b.pos.z); }
  } else b.rev = null;
  if (wish.lengthSq() > 0.0001) wish.normalize();

  // unstick
  if (now >= ai.stuckAt) {
    const moved = Math.hypot(b.pos.x - ai.lastPos.x, b.pos.z - ai.lastPos.z);
    if (moved < 0.6 && wish.lengthSq() > 0) {
      if (b.onGround) b.vel.y = JUMP;
      if (++ai.stuck > 1) { ai.goal = randomGoal(); ai.goalExpire = now + 5; ai.strafeDir *= -1; ai.stuck = 0; }
    } else ai.stuck = 0;
    ai.lastPos.copy(b.pos); ai.stuckAt = now + 0.7;
  }

  const speed = 6.4 * (w.speed || 1) * (stunned ? 0.45 : 1) * (b.useT ? 0 : 1), k = b.launched ? 0 : (b.onGround ? 10 * grip(b) : 2.5) * dt;
  b.vel.x += (wish.x * speed - b.vel.x) * Math.min(1, k);
  b.vel.z += (wish.z * speed - b.vel.z) * Math.min(1, k);
  moveEntity(b, dt);

  // aim
  let ty, tp;
  if (tgt) {
    eyePos(b, _o);
    const dx = tgt.pos.x - _o.x, dy = tgt.pos.y + ai.aimH * poseK(tgt) - _o.y, dz = tgt.pos.z - _o.z;
    ty = Math.atan2(-dx, -dz); tp = Math.atan2(dy, Math.hypot(dx, dz));
  } else if (wish.lengthSq() > 0) { ty = Math.atan2(-wish.x, -wish.z); tp = 0; }
  else { ty = b.yaw; tp = 0; }
  const dyaw = angDiff(b.yaw, ty), turn = ai.d.turn * dt * (stunned ? 0.4 : 1);
  b.yaw += clamp(dyaw, -turn, turn); b.pitch += clamp(tp - b.pitch, -turn, turn);
  if (tgt && now >= ai.reactAt && now >= ai.burstPause && Math.abs(dyaw) + Math.abs(tp - b.pitch) < 0.14) {
    const dist = tgt.pos.distanceTo(b.pos);
    if (dist < w.range * 0.85 && tryFire(b)) {
      if (w.auto && --ai.burst <= 0) { ai.burst = 3 + ((Math.random() * 4) | 0); ai.burstPause = now + rand(0.35, 0.8); }
      else if (!w.auto) ai.burstPause = now + rand(0.1, 0.5);
    }
  }
  if (!oneLife() && now - b.lastHurt > 5 && b.hp < 100) b.hp = Math.min(100, b.hp + 10 * dt);

  poseSoldier(b, dt);
}

// knocked down: crawl toward the nearest squadmate still standing, and that's all
function botCrawl(b, dt) {
  const ai = b.ai; ai.target = null; ai.visible = false; b.useT = null; b.rev = null; b.reloading = false;
  let mate = null, md = Infinity;
  for (const e of ents) if (e !== b && sameTeam(e, b) && isUp(e) && !e.knock) { const d = e.pos.distanceTo(b.pos); if (d < md) { md = d; mate = e; } }
  const wish = new V3();
  if (mate && md > 1.5) { const wp = navPoint(b, mate.pos); wish.set(wp.x - b.pos.x, 0, wp.z - b.pos.z); if (wish.lengthSq() > 0.0001) wish.normalize(); }
  const k = Math.min(1, (b.onGround ? 10 : 2.5) * dt);
  b.vel.x += (wish.x * KNOCK.speed - b.vel.x) * k; b.vel.z += (wish.z * KNOCK.speed - b.vel.z) * k;
  moveEntity(b, dt);
  if (wish.lengthSq() > 0) b.yaw += clamp(angDiff(b.yaw, Math.atan2(-wish.x, -wish.z)), -3 * dt, 3 * dt);
  b.pitch = 0; b.crouch = 1;
  poseSoldier(b, dt);
}

// ---------- bots online ----------
// The host (whoever has been in the room longest) runs the bots like offline and puts their state in its presence;
// everyone else draws them from that and sends their hits on them to the host, like hits on players.
export const myBot = id => (typeof id === 'string' ? ents.find(e => e.ai && 'b' + e.bid === id) : null);
export const byId = id => (!id ? null : id === net.myPeer ? player : net.remotes.get(id) || net.bots.get(id) || myBot(id) || null);
export const humansInMatch = () => [player, ...[...net.remotes.values()].filter(r => r.m === net.m)];
// [id, name, team (-1 none), x, y, z, yaw, pitch, weapon, alive, kills, deaths, fired since last time, crouch, hp, drop stage,
//  reload length (0: not reloading), knock bar (0: standing), heal in hand (0 none, else 1 + its HEAL_KEYS index), how far
//  along, who they're reviving ('' nobody), how far along]
export function botState() {
  return ents.filter(e => e.ai).map(b => {
    const f = b.fired ? 1 : 0; b.fired = false;
    return [b.bid, b.name, b.team === undefined ? -1 : b.team, r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), r2(b.yaw), r2(b.pitch), b.guns[b.weapon].id,
      b.alive ? 1 : 0, b.kills, b.deaths, f, r2(b.crouch), Math.ceil(b.hp), b.drop ? DROP_ST.indexOf(b.drop.stage) : 0,
      b.reloading ? r2(b.reloadEnd - b.reloadStart) : 0, b.knock ? Math.max(1, Math.ceil(b.knock.hp)) : 0,
      b.useT ? HEAL_KEYS.indexOf(b.useT.type) + 1 : 0, b.useT ? r2(clamp((now - b.useT.start) / (b.useT.end - b.useT.start), 0, 1)) : 0,
      b.rev ? idOf(b.rev.who) : '', b.rev ? r2(revProg(b)) : 0];
  });
}
export function syncBots(list) {
  if (!Array.isArray(list)) return;
  const seen = new Set();
  for (const a of list.slice(0, 12)) {
    if (!Array.isArray(a)) continue;
    const id = 'b' + (a[0] | 0), team = teamsOn() ? (a[2] === 0 || a[2] === 1 ? a[2] : undefined) : squadsOn() && Number.isInteger(a[2]) && a[2] >= 0 && a[2] < 12 ? a[2] : undefined; seen.add(id);
    let b = net.bots.get(id);
    if (!b) {
      const name = cleanName(a[1]) || 'Bot';
      b = newEntity(name, team === undefined || !teamsOn() ? HATS[(a[0] | 0) % HATS.length] : TEAM_COLORS[team], false);
      Object.assign(b, { remote: true, netbot: true, peer: id, bid: a[0] | 0, team, target: new V3(), tyaw: 0 });
      b.mesh = soldierMesh(name, b.color, true, randomLook()); b.mesh.visible = false;
      net.bots.set(id, b); ents.push(b); scoresChanged();
    }
    b.team = team;
    const pl = LIMIT * 1.5;
    b.target.set(clamp(num(a[3]), -pl, pl), clamp(num(a[4]), 0, 120), clamp(num(a[5]), -pl, pl));
    b.tyaw = num(a[6]); b.pitch = clamp(num(a[7]), -1.5, 1.5); b.weapon = clamp(a[8] | 0, 0, WEAPONS.length - 1);
    b.kills = Math.max(0, a[10] | 0); b.deaths = Math.max(0, a[11] | 0); b.crouch = clamp(num(a[13]), 0, 1); b.hp = clamp(num(a[14]), 0, 100);
    if (a[9] === 1 && !b.alive) { b.alive = true; b.pos.copy(b.target); b.yaw = b.tyaw; b.mesh.visible = true; poseSoldier(b, 0); }
    else if (a[9] !== 1 && b.alive) { b.alive = false; b.mesh.visible = false; }
    remoteDrop(b, a[15]); remoteReload(b, num(a[16]));
    b.knock = b.alive && num(a[17]) > 0 ? { hp: clamp(num(a[17]), 0, 100) } : null;
    b.healT = b.alive ? HEAL_KEYS[(a[18] | 0) - 1] || null : null; b.healP = clamp(num(a[19]), 0, 1);
    b.revId = b.alive && typeof a[20] === 'string' && a[20] ? a[20].slice(0, 16) : null; b.revP = clamp(num(a[21]), 0, 1);
    if (a[12] === 1 && b.alive) botShotFx(b);
  }
  for (const [id, b] of net.bots) if (!seen.has(id)) removeNetBot(b);
}
// a host bot fired: a tracer along its aim and the sound
function botShotFx(b) {
  const w = WEAPONS[b.weapon]; if (w.kind === 'melee') return;
  eyePos(b, _o); fwdVec(b.yaw, b.pitch, _f);
  tracer(muzzleOf(b), _o.clone().addScaledVector(_f, rayWorld(_o, _f, w.range)), false);
  sfxShot(w.id, distVol(b.pos));
}
export function removeNetBot(b) {
  scene.remove(b.mesh); net.bots.delete(b.peer);
  const i = ents.indexOf(b); if (i >= 0) ents.splice(i, 1);
  scoresChanged();
}

// the host keeps the bot count right: the room's number of bots, or in team deathmatch enough to fill both sides
export function updateRoster() {
  // (a timer left over from far ahead, if the clock ever goes back, doesn't hold the roster up)
  if (!botHost() || !versus() || state === 'menu' || (now < net.rosterAt && net.rosterAt - now <= 1)) return;
  net.rosterAt = now + 1;
  if (oneLife() && state !== 'lobby' && !FLIGHT.on) return; // battle royale: the bots are set while the blimp flies, then never change
  const c = cfg(), hum = humansInMatch(), want = new Map();
  if (teamsOn()) { for (const t of [0, 1]) want.set(t, Math.max(0, c.ts - hum.filter(h => (h.team | 0) === t).length)); }
  else if (squadsOn()) { for (const t of botSquads(hum, c.sq, Math.max(0, Math.min(12 - hum.length, Math.max(c.bots, c.sq))), c.fill !== 0)) want.set(t, (want.get(t) || 0) + 1); }
  else want.set(undefined, Math.max(0, Math.min(c.bots, 12 - hum.length)));
  const bots = ents.filter(e => e.ai);
  for (const b of bots) if (!want.has(b.team)) removeBot(b); // left over from another game type
  for (const [t, n] of want) {
    const have = bots.filter(b => b.team === t && ents.includes(b));
    have.sort((a, b) => a.alive - b.alive).slice(0, Math.max(0, have.length - n)).forEach(removeBot); // drop dead ones first
    for (let i = have.length; i < n; i++) makeBot(t, c.diff);
  }
}
