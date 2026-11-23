// Online play: the presence this game streams through the relay, other players' presences and events, and who hosts the room.
import { AMMO_OF, DIFF, GAMES, HATS, TEAM_COLORS, WEAPONS, WNAMES } from './config.js';
import { LIMIT, MAPS, currentMap } from './world.js';
import { sfx, sfxShot } from './audio.js';
import { joinRoom } from './net.js';
import * as P from './progress.js';
import { applyLook } from './skins.js';
import { $, V3, clamp } from './util.js';
import {
  BLOOD, CAMO_IDS, CH, DROP_ST, NADE_TYPES, UNIFORM_IDS, Z, _b, angDiff, beginMatch, bodyC, burst, cfg, corpse, damage, decItems, distVol,
  endGame, ents, game, gunGameStep, hostPeer, mode, muzzleOf, nearestZombie, newEntity, now, oneLife, openChest, outOfMatch, readyHere, player, poseSoldier, prog,
  refreshVM, resetBR, resetZombies, respawn, scene, setCanopy, setGame, setMap, setTag, settings, soldierMesh, spawnNade, spillItems, squadsOn,
  state, stormState, syncStorm, syncZombies, takeItem, teamScore, teams, teamsOn, toMenu, tracer, winnerNow, zHost, zombieState
} from './game.js';
import { botState, byId, humansInMatch, makeBot, myBot, removeNetBot, syncBots } from './bots.js';
import { addFeed, awardKill, scoresChanged, toast, updateScoreTop } from './hud.js';
import { remotePing } from './ping.js';
import { releaseDriver, remoteVehicle, vehicleState } from './vehicles.js';

// ---------- online play ----------
// Every player streams a presence (position, aim, score, a ring of recent events) through the relay.
// Shooters report hits; the player who was hit applies the damage and reports their own death,
// so nobody edits anyone else's health.
// cfg: the room's settings; host: who runs the bots (the server says: whoever has been in the room longest);
// bots: the host's bots as I see them (others' screens); tscore: the host's team scores
export const net = { room: null, status: '', myPeer: Math.random().toString(36).slice(2, 12), seq: 0, ev: [], lastSeq: new Map(), remotes: new Map(), m: 1, sendAt: 0,
  cfg: null, host: null, bots: new Map(), tscore: null, rosterAt: 0, ready: true,
  // key: secret, only ever sent to the server; it proves a reconnect is really us (myPeer is public: every presence carries it)
  key: Array.from(crypto.getRandomValues(new Uint8Array(24)), b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[b & 63]).join('') };
export const botHost = () => mode === 'online' && net.host === net.myPeer;
// the leader locks the room while a battle royale is on (newcomers are turned away) and unlocks it after
export const sendLock = on => { if (mode === 'online' && net.room && net.host === net.myPeer) net.room.control({ t: 'lock', on }); };
export const myHat = HATS[(Math.random() * HATS.length) | 0];
export const r2 = v => Math.round(v * 100) / 100;
export const num = v => (Number.isFinite(+v) ? +v : 0);
export const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').trim().slice(0, 16);
// shop looks are valid too, so friends see what you bought (bots never wear them: randomLook uses the free lists)
const cleanUniform = v => (UNIFORM_IDS.includes(v) || P.premiumOf('uniform').includes(v) || P.EVENT_LOOKS.some(([e]) => e === v) ? v : 'olive');
const cleanCamo = v => (CAMO_IDS.includes(v) || P.premiumOf('camo').includes(v) ? v : 'factory');
const cleanLevel = v => clamp(Math.floor(num(v)), 1, P.MAX_LEVEL);
export const cleanRoom = v => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'brawl';

export function netEvent(...e) {
  if (mode !== 'online') return;
  net.ev.push([++net.seq, ...e]); if (net.ev.length > 24) net.ev.shift();
  netSend(true);
}
export function netSend(force) {
  if (!net.room) return;
  const t = performance.now(); if (!force && t < net.sendAt) return; net.sendAt = t + 33;
  const p = player;
  net.room.presence({ v: 1, n: p.name, c: p.color, m: net.m,
    p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], yw: r2(p.yaw), pt: r2(p.pitch), w: p.guns[p.weapon].id,
    a: state === 'playing' && p.alive ? 1 : 0, dd: p.alive ? 0 : 1, hp: Math.ceil(p.hp), k: p.kills, d: p.deaths, ev: net.ev,
    cr: r2(p.crouch), sl: r2(p.slideK), tm: p.team, dr: p.drop ? DROP_ST.indexOf(p.drop.stage) : 0,
    bt: botHost() ? botState() : undefined, sto: botHost() && oneLife() ? stormState() : undefined, tsc: botHost() && teamsOn() ? teamScore() : undefined,
    sk: prog.uniform, cm: prog.camo[p.guns[p.weapon].id], lv: P.level(prog), su: p.guns[p.weapon].sup ? 1 : 0, lb: state === 'lobby' ? 1 : 0, rd: readyHere() && net.ready ? 1 : 0, ov: state === 'over' ? 1 : 0,
    vh: p.vehicle && p.alive ? vehicleState(p.vehicle) : undefined,
    z: game === 'zombies' && zHost() ? zombieState() : undefined, iv: oneLife() && p.alive ? invState(p) : undefined });
}
// battle royale: what I carry, for a squadmate spectating me: [held gun, its mag, spare ammo for it, bandages, medkits,
// frags, then id, rarity and slot for each gun]
function invState(p) {
  const w = p.guns[p.weapon], at = w && AMMO_OF[w.id];
  return [p.weapon, p.ammo[p.weapon] | 0, at ? p.res[at] | 0 : 0, p.heals.bandage | 0, p.heals.medkit | 0, p.frags | 0, ...p.guns.flatMap(g => [g.id, g.rar | 0, g.slot | 0])];
}
export function startOnline(code) {
  const opts = { map: settings.map, game, bots: settings.bots, diff: settings.diff, ts: settings.ts, lim: settings.lim, side: settings.side, sq: settings.sq, hok: settings.hok, pub: settings.pub ? 1 : 0 };
  net.room = joinRoom(code, net.myPeer, net.key, opts, {
    onPeer: applyRemote,
    onHost: setHost,
    onRoom: ({ map, game: g, cfg: c, team, host, pub }) => {
      net.map = map; net.pub = pub !== false;
      const changed = GAMES[g] && g !== 'aim' && g !== game;
      if (changed) { setGame(g); resetZombies(); player.kills = player.deaths = 0; toast('This room plays <em></em>', GAMES[g], false); }
      if (c && typeof c === 'object') net.cfg = { bots: clamp(c.bots | 0, 0, 11), diff: DIFF[c.diff] ? c.diff : 'normal', ts: clamp(c.ts | 0, 1, 6), lim: clamp(c.lim | 0, 5, 100), side: c.side, sq: clamp(c.sq | 0, 1, 4), hok: [0, 25, 50].includes(c.hok) ? c.hok : 0 };
      player.team = teamsOn() ? (team === 1 ? 1 : 0) : squadsOn() ? clamp(team | 0, 0, 11) : undefined;
      if (squadsOn()) toast('You are in squad <em></em>', String((player.team | 0) + 1), false);
      player.color = teamsOn() ? TEAM_COLORS[player.team] : myHat;
      setHost(host);
      if (map !== currentMap) setMap(map);
      if (changed || map !== currentMap || net.map !== settings.map) { resetBR(); respawn(player); refreshVM(); }
      scoresChanged(); updateScoreTop(); netSend(true);
      updateNetStatus();
    },
    onLeave: id => { for (const r of [...net.remotes.values()]) if (id === null || r.peer === id) removeRemote(r); updateNetStatus(); },
    onStatus: s => {
      net.status = s; updateNetStatus();
      if (s === 'busy') { toMenu(); toast('That room has a match in progress. Try again when it ends.'); }
      if (s === 'taken') { toMenu(); toast('Someone in that room is already using your player id. Reload and try again.'); }
    },
  });
  netSend(true);
}
export function leaveRoom() {
  if (net.room) net.room.leave();
  net.room = null; net.status = ''; net.map = null;
  for (const r of [...net.remotes.values()]) removeRemote(r);
  for (const b of [...net.bots.values()]) removeNetBot(b);
  net.lastSeq.clear(); net.ev = []; net.cfg = null; net.host = null; net.tscore = null;
  resetZombies();
}
function removeRemote(r) {
  releaseDriver(r); scene.remove(r.mesh); net.remotes.delete(r.peer);
  const i = ents.indexOf(r); if (i >= 0) ents.splice(i, 1);
  scoresChanged(); if (state !== 'menu') updateScoreTop();
}
export function applyRemote(id, s, seat) {
  if (typeof id !== 'string' || !/^[a-z0-9]{4,16}$/.test(id) || id === net.myPeer) return;
  let r = net.remotes.get(id);
  if (s.v !== 1 || !Array.isArray(s.p)) { if (r) removeRemote(r); return; }
  // the leader started the next match while I was ready for it: in the lobby, or still out of the last one
  if (net.ready && id === net.host && s.lb !== 1 && ((state === 'lobby' && (s.m | 0) > net.lobbyFrom) || (outOfMatch() && (s.m | 0) > net.m))) { beginMatch(s.m | 0, false); }
  if (!r) {
    const name = cleanName(s.n) || 'Player', color = /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#cccccc';
    r = newEntity(name, color, false);
    Object.assign(r, { remote: true, peer: id, target: new V3(), tyaw: 0, sk: cleanUniform(s.sk), cm: cleanCamo(s.cm), lv: cleanLevel(s.lv) });
    r.mesh = soldierMesh(name, color, true, { uniform: r.sk, camo: r.cm, lv: r.lv }); r.mesh.visible = false;
    net.remotes.set(id, r); ents.push(r);
    // don't replay events that happened before we arrived
    net.lastSeq.set(id, (Array.isArray(s.ev) ? s.ev : []).reduce((a, e) => Math.max(a, num(e && e[0])), 0));
    if ((s.m | 0) > net.m && player.kills === 0 && player.deaths === 0) net.m = s.m | 0;
    if (state === 'playing') toast(`<em></em> joined`, name, false);
    updateNetStatus();
  }
  const pl = LIMIT * 1.5; // riders on the blimp can be past the edge, and high up
  r.target.set(clamp(num(s.p[0]), -pl, pl), clamp(num(s.p[1]), 0, 120), clamp(num(s.p[2]), -pl, pl));
  r.tyaw = num(s.yw); r.pitch = clamp(num(s.pt), -1.5, 1.5); r.weapon = clamp(s.w | 0, 0, WEAPONS.length - 1);
  r.iv = Array.isArray(s.iv) && s.iv.length <= 40 ? s.iv : null;
  r.hp = num(s.hp); r.kills = Math.max(0, s.k | 0); r.deaths = Math.max(0, s.d | 0); r.m = s.m | 0;
  r.lobby = s.lb === 1; r.ready = s.rd === 1; r.over = s.ov === 1; r.dead = s.dd === 1; // lb: waiting in the lobby; a: in play right now; dd: actually down (paused players are neither)
  r.crouch = clamp(num(s.cr), 0, 1); r.slideK = clamp(num(s.sl), 0, 1); r.su = s.su === 1;
  // their look: gun camo follows the weapon in hand; the tag shows their level
  const sk = cleanUniform(s.sk), cm = cleanCamo(s.cm), lv = cleanLevel(s.lv);
  if (sk !== r.sk) { r.sk = sk; applyLook(r.mesh.userData.uniM, sk); }
  if (cm !== r.cm) { r.cm = cm; applyLook(r.mesh.userData.gunM, cm); }
  if (lv !== r.lv) { r.lv = lv; setTag(r.mesh, r.name, r.color, lv); }
  const tm = Number.isInteger(seat) && seat >= 0 ? seat : s.tm; // the server's seat when it sends one
  r.team = teamsOn() ? (tm === 0 || tm === 1 ? tm : undefined) : squadsOn() && Number.isInteger(tm) && tm >= 0 && tm < 12 ? tm : undefined;
  if (game === 'zombies' && s.z && r.m === net.m && hostPeer() === id) syncZombies(s.z);
  if (id === net.host && !botHost() && r.m === net.m) {
    syncBots(s.bt); if (oneLife()) syncStorm(s.sto);
    net.tscore = Array.isArray(s.tsc) ? [Math.max(0, s.tsc[0] | 0), Math.max(0, s.tsc[1] | 0)] : null;
  }
  const alive = s.a === 1;
  if (alive && !r.alive) { r.alive = true; r.pos.copy(r.target); r.yaw = r.tyaw; r.mesh.visible = true; poseSoldier(r, 0); }
  else if (!alive && r.alive) { r.alive = false; r.mesh.visible = false; }
  remoteDrop(r, s.dr);
  if (remoteVehicle(r, r.alive ? s.vh : null, net.myPeer)) toast(`<em></em> got to the wheel first`, r.name, false);
  const last = net.lastSeq.get(id) || 0; let max = last;
  for (const e of (Array.isArray(s.ev) ? s.ev : [])) {
    const sq = num(e && e[0]); if (!(sq > last)) continue;
    max = Math.max(max, sq); handleNetEvent(r, e);
  }
  net.lastSeq.set(id, max);
  scoresChanged(); if (state !== 'menu') updateScoreTop();
  checkWinOnline();
}
function handleNetEvent(r, e) {
  const type = e[1];
  if (type === 's') {
    const from = muzzleOf(r);
    for (let i = 3; i + 2 < e.length && i < 12; i += 3) tracer(from, new V3(num(e[i]), num(e[i + 1]), num(e[i + 2])), false);
    sfxShot(clamp(e[2] | 0, 0, WEAPONS.length - 1), distVol(r.pos) * (r.su ? 0.35 : 1));
  } else if (type === 'h') {
    // a hit on me, or (if I run the zombies) on one of my zombies
    const wn = wname(e[5]), amt = clamp(num(e[3]), 0, 250);
    if (e[2] === net.myPeer && state === 'playing') {
      const src = wn === 'Zombie' ? nearestZombie(player.pos) || r : (typeof e[6] === 'string' && net.bots.get(e[6])) || r; // a bot's shot, or theirs
      damage(player, amt, src, wn, e[4] === 1, null);
    } else if (typeof e[2] === 'string' && e[2][0] === 'z' && game === 'zombies' && zHost()) {
      const z = Z.byId.get(+e[2].slice(1)); if (z && z.alive) damage(z, amt, r, wn, e[4] === 1, null);
    } else if (typeof e[2] === 'string' && e[2][0] === 'b' && botHost()) {
      const b = myBot(e[2]); if (b && b.alive) damage(b, amt, r, wn, e[4] === 1, null);
    }
  } else if (type === 'x') {
    const k = byId(e[2]);
    remoteDied(r, k === r ? null : k, wname(e[3]), e[4] === 1);
  } else if (type === 'bx') {
    // one of the host's bots went down
    const b = r.peer === net.host && net.bots.get('b' + (e[2] | 0));
    if (b) remoteDied(b, byId(e[3]), wname(e[4]), e[5] === 1);
  } else if (type === 'n') {
    const t = NADE_TYPES[clamp(e[8] | 0, 0, NADE_TYPES.length - 1)], v = c => clamp(num(c), -60, 60);
    const nl = LIMIT + 10, pos = new V3(clamp(num(e[2]), -nl, nl), clamp(num(e[3]), -5, 130), clamp(num(e[4]), -nl, nl));
    // one of the host's bots threw or fired it: theirs, so its blast hurts and credits like the bot's
    const who = (typeof e[9] === 'string' && e[9] && r.peer === net.host && net.bots.get(e[9])) || r;
    spawnNade(pos, new V3(v(e[5]), v(e[6]), v(e[7])), who, t);
    if (t === 'rocket') sfxShot(4, distVol(who.pos));
  } else if (type === 'c') {
    openChest(e[2] | 0, r, true);
  } else if (type === 'pk') {
    const it = CH.byId.get(String(e[2])); if (it) takeItem(it, true);
  } else if (type === 'dp' && oneLife()) {
    const pl = LIMIT * 1.5;
    spillItems(r.peer + ':' + num(e[0]), decItems(e.slice(5).map(num)), clamp(num(e[2]), -pl, pl), clamp(num(e[3]), 0, 120), clamp(num(e[4]), -pl, pl));
  } else if (type === 'pg') {
    remotePing(r, e); // a squadmate's or teammate's ping
  } else if (type === 'zx') {
    // the zombie host says I got a zombie kill
    if (e[2] === net.myPeer && state === 'playing') { player.kills++; sfx.kill(); awardKill(wname(e[3]), e[4] === 1); updateScoreTop(); }
  }
}
const wname = i => WNAMES[clamp(i | 0, 0, WNAMES.length - 1)];
// someone else's drop stage (0 on the ground, then ride, fall, glide): hidden on the blimp, canopy while gliding, can't be hit
export function remoteDrop(r, v) {
  const st = DROP_ST[clamp(v | 0, 0, 3)];
  r.drop = st ? { stage: st } : null;
  if (r.alive) r.mesh.visible = st !== 'ride';
  setCanopy(r, st === 'glide');
}
function remoteDied(r, k, wname, head) {
  r.alive = false; r.mesh.visible = false;
  bodyC(r, _b); burst(_b, [...BLOOD, new THREE.Color(r.color).getHex()], 14, 5, 0.1, 0.9);
  corpse(r);
  addFeed(k, r, wname, head);
  if (k === player && state === 'playing') { player.kills++; gunGameStep(player); sfx.kill(); toast(`Eliminated <em></em>`, r.name, head); awardKill(wname, head); netSend(true); }
  else if (k && k.ai) { k.kills++; gunGameStep(k); } // a bot I run got them
  scoresChanged(); updateScoreTop(); checkWinOnline();
}
export function updateRemotes(dt) {
  for (const r of [...net.remotes.values(), ...net.bots.values()]) {
    if (!r.alive) continue;
    const px = r.pos.x, pz = r.pos.z;
    if (r.pos.distanceTo(r.target) > 6) r.pos.copy(r.target); else r.pos.lerp(r.target, 1 - Math.pow(0.0001, dt));
    r.yaw += angDiff(r.yaw, r.tyaw) * Math.min(1, dt * 16);
    r.vel.set((r.pos.x - px) / Math.max(dt, 1e-3), 0, (r.pos.z - pz) / Math.max(dt, 1e-3));
    poseSoldier(r, dt);
  }
}
export function checkWinOnline() {
  if (mode !== 'online' || state !== 'playing') return;
  const w = winnerNow(); if (w) endGame(w);
}

// the server says who runs the bots; if that's now me, I take over the ones I was drawing, as they were
function setHost(id) {
  net.host = typeof id === 'string' ? id : null;
  if (net.host === net.myPeer && state === 'lobby') net.unlockDue = true; // took the lead in the lobby: unlock when the match is over
  if (!botHost() || !net.bots.size) return;
  const sum = [0, 0];
  for (const nb of [...net.bots.values()]) {
    removeNetBot(nb);
    const b = makeBot(nb.team, cfg().diff, nb.name, nb.bid);
    b.kills = nb.kills; b.deaths = nb.deaths;
    if (nb.alive) { b.pos.copy(nb.target); b.yaw = nb.tyaw; b.mesh.position.copy(b.pos); } else { b.alive = false; b.mesh.visible = false; b.respawnAt = oneLife() ? Infinity : now + 2; }
    if (teamsOn() && b.team !== undefined) sum[b.team] += b.kills;
  }
  if (net.tscore && teamsOn()) for (const e of humansInMatch()) if (e.team !== undefined) sum[e.team] += e.kills;
  if (net.tscore && teamsOn()) teams.bank = [0, 1].map(t => Math.max(0, net.tscore[t] - sum[t])); // keep kills of soldiers who left
}

export function updateNetStatus() {
  const el = $('netStatus');
  if (mode !== 'online') { el.hidden = true; return; }
  el.hidden = false;
  const n = net.remotes.size, rm = `Room ${settings.room} · ${MAPS[net.map || currentMap]} · ${GAMES[game]} · `;
  el.textContent = net.status === 'full' ? `${rm}room is full, quit and try another code`
    : net.status === 'busy' ? `${rm}match in progress`
    : net.status !== 'ready' ? `${rm}connecting…`
    : n ? `${rm}${n + 1} players`
    : `${rm}waiting for friends (Esc → Copy invite link)`;
}
