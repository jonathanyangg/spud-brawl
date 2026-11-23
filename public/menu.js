// The menus: the main menu and its server browser, the online lobby and ready-up, settings, controls and invite links.
// The match itself (startGame, beginMatch, endGame, toMenu) is in game.js.
import { initArmory, openArmory } from './armory.js';
import { initAudio, setVolume } from './audio.js';
import { setupBots } from './bots.js';
import { ACTIONS, DEFAULT_BINDS, EVENT, eventOn, GAMES, keyName, TEAM_NAMES, validCode } from './config.js';
import { loadoutChanged, setText } from './hud.js';
import { setMusicOn } from './music.js';
import { cleanRoom, net, netSend, sendLock } from './netsync.js';
import * as P from './progress.js';
import { $, clamp } from './util.js';
import { currentMap, MAPS } from './world.js';
import {
  actionFor, alliesOn, beginMatch, binds, cfg, deathToLobby, game, mode, oneLife, playAgain, player, plWorks, prog, requestLock,
  saveSettings, setMap, setState, settings, soldierMesh, SQUAD_NAMES, squadsOn, startGame, state, teamsOn, toMenu
} from './game.js';

// ---------- controls screen ----------
export let rebinding = null, ctrlReturn = null;
export const stopRebind = () => { rebinding = null; };
function renderBinds() {
  const list = $('bindList'); list.textContent = '';
  for (const [k, label] of ACTIONS) {
    const row = document.createElement('div'); row.className = 'bind';
    const s = document.createElement('span'); s.textContent = label; s.id = 'bl-' + k;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.k = k;
    b.setAttribute('aria-describedby', 'bl-' + k);
    b.textContent = rebinding === k ? 'Press a key\u2026' : keyName(binds[k]);
    b.classList.toggle('listen', rebinding === k);
    b.addEventListener('click', ev => { ev.stopPropagation(); startRebind(k); });
    row.append(s, b); list.append(row);
  }
}
function startRebind(k) {
  rebinding = rebinding === k ? null : k;
  $('bindMsg').textContent = rebinding ? 'Press a key or mouse button. Esc cancels.' : '';
  renderBinds();
  if (rebinding) { const b = $('bindList').querySelector(`button[data-k="${k}"]`); if (b) b.focus(); }
}
function finishRebind(code) {
  const k = rebinding; if (!k) return;
  if (code === 'Escape') { rebinding = null; $('bindMsg').textContent = ''; renderBinds(); return; }
  if (!validCode(code)) { $('bindMsg').textContent = `${keyName(code)} can't be used. Pick another key.`; return; }
  const other = actionFor(code), old = binds[k];
  binds[k] = code;
  let msg = `${ACTIONS.find(a => a[0] === k)[1]} is now ${keyName(code)}.`;
  if (other && other !== k) { binds[other] = old; msg += ` ${ACTIONS.find(a => a[0] === other)[1]} moved to ${keyName(old)}.`; }
  rebinding = null; settings.binds = { ...binds }; saveSettings();
  $('bindMsg').textContent = msg; renderBinds();
  const b = $('bindList').querySelector(`button[data-k="${k}"]`); if (b) b.focus();
}
function openControls(from) {
  ctrlReturn = from; rebinding = null; $('bindMsg').textContent = '';
  renderBinds(); $('controls').hidden = false; $('ctrlDone').focus();
}
function closeControls() {
  rebinding = null; $('controls').hidden = true;
  const back = ctrlReturn === 'pause' ? $('resumeBtn') : $('ctrlBtn'); if (back) back.focus();
}

// The menu shows only what applies: offline it's the game setup; online it's either the server browser or
// setting up a new room (the same game setup plus who can join and the code)
export function updateModeUI() {
  const online = settings.mode === 'online', browse = online && settings.otab !== 'create', g = settings.game;
  if (online && g === 'aim') { $('gameSeg').querySelector('[data-v=ffa]').click(); return; }
  $('onlineTabs').hidden = !online;
  $('browsePane').hidden = !browse; $('setupPane').hidden = browse;
  $('gAim').hidden = online; // aim trainer is solo
  const fighting = !['zombies', 'aim'].includes(g), tdm = g === 'tdm';
  $('rowTs').hidden = !tdm; $('rowLim').hidden = !tdm; $('rowSide').hidden = !tdm || !online;
  const sq = clamp(settings.sq | 0, 1, 4), fill = settings.fill !== 0; $('rowSq').hidden = $('rowHok').hidden = g !== 'br';
  $('rowFill').hidden = g !== 'br' || sq === 1;
  $('sqHelp').textContent = sq === 1 ? 'Everyone for themselves.'
    : online ? `Players in this room team up ${sq} to a squad, in the order they join; a party of 2 to 4 always shares one${fill ? ', and bots fill the empty seats' : ''}. Down, not out: squadmates can revive you.`
    : `${fill ? `You and ${sq - 1} bot${sq > 2 ? 's' : ''}` : 'You on your own'} against squads of ${sq} bots. Down, not out: squadmates can revive you.`;
  $('rowBots').hidden = !fighting || tdm; $('rowDiff').hidden = !fighting;
  $('b0').hidden = !online; $('b11').hidden = g !== 'br'; // online a room can have no bots; battle royale takes a crowd
  if (($('b0').hidden && settings.bots === 0) || ($('b11').hidden && settings.bots === 11)) $('botSeg').querySelector('[data-v="5"]').click();
  $('tsHelp').textContent = online ? (settings.side === 'split' ? 'Players are split between the teams; bots fill the empty seats.' : 'Players join Blue together; bots fill the empty seats on both sides.')
    : `You and ${settings.ts - 1 || 'no'} bot${settings.ts === 2 ? '' : 's'} against ${settings.ts} bot${settings.ts === 1 ? '' : 's'}.`;
  $('roomRows').hidden = !online;
  $('playBtn').hidden = browse;
  $('playBtn').textContent = online ? 'Create room' : 'Play';
  $('gameHelp').textContent = GAME_HELP[g] || '';
  $('rowMap').hidden = $('rowBots').hidden = $('rowDiff').hidden = g === EVENT.game; // the event has its own map and bots
  if (state === 'menu') { const m = g === EVENT.game ? EVENT.map : settings.map; if (m !== currentMap) { setMap(m); setupBots(5, 'normal'); } }
  if (browse) refreshRooms();
}
// ---------- server browser ----------
let roomsTimer = 0;
async function refreshRooms() {
  clearTimeout(roomsTimer);
  if (state !== 'menu' || settings.mode !== 'online' || settings.otab === 'create') return;
  let list = null;
  try { const r = await fetch('/rooms', { cache: 'no-store' }); if (r.ok) list = await r.json(); } catch (e) {}
  const box = $('roomList'); box.textContent = '';
  if (!Array.isArray(list)) { box.innerHTML = '<p class="help">Couldn\'t reach the server. Trying again…</p>'; }
  else if (!list.length) { box.innerHTML = '<p class="help">No public games right now. Create a room and your friends will find it here.</p>'; }
  else for (const r of list.sort((a, b) => b.players - a.players)) {
    const row = document.createElement('div'); row.className = 'room' + (r.players >= r.max ? ' full' : '');
    const what = document.createElement('div'); what.className = 'what';
    const name = document.createElement('b'); name.textContent = cleanRoom(r.code);
    const info = document.createElement('small');
    info.textContent = `${GAMES[r.game] || r.game}${r.game === 'tdm' ? ` ${r.ts}v${r.ts}` : ''}${r.game === 'br' && r.sq > 1 ? ` ${SQUAD_NAMES[r.sq] || ''}` : ''} · ${MAPS[r.map] || r.map}${r.bots && r.game !== 'tdm' ? ` · ${r.bots} bots` : ''}`;
    what.append(name, info);
    const count = document.createElement('span'); count.className = 'count'; count.textContent = `${r.players}/${r.max}`;
    const btn = document.createElement('button'); btn.className = 'btn ghost small'; btn.type = 'button'; btn.textContent = r.busy ? 'In progress' : r.players >= r.max ? 'Full' : 'Join';
    btn.disabled = r.busy || r.players >= r.max; if (r.busy) row.classList.add('full'); btn.addEventListener('click', () => joinCode(r.code));
    row.append(what, count, btn); box.append(row);
  }
  roomsTimer = setTimeout(refreshRooms, 4000);
}
function joinCode(code) {
  code = cleanRoom(code); if (!code) return;
  settings.room = code; saveSettings(); startGame();
}
const GAME_HELP = {
  ffa: 'Everyone for themselves. First to 20 eliminations wins.',
  tdm: 'Blue against Red. Every elimination scores for your team; first team to the target wins. No friendly fire.',
  br: 'One life each. Ride the potato blimp, jump out over the island and glide down. You land with a knife: open chests for guns, ammo and heals. The storm closes in, so keep moving. Last one standing wins. Pick Duos, Trios or Squads to team up; online, friends in the same room join your squad.',
  zombies: 'Team up against waves of zombies. Downed players come back each wave. Online, everyone in the room plays together.',
  gungame: 'Every two kills hands you the next weapon: AR, SMG, Shotgun, Sniper, RPG, then the knife. One knife kill wins.',
  moon: 'Knives only, in low gravity. Jump high, stab fast. First to 20.',
  snipe: 'Snipers only, and one body shot drops anyone. First to 20.',
  fest: `Limited time, through ${EVENT.last}. Free-for-all on Frostbite in a snowstorm, and the ground is slick everywhere. You against 7 bots on hard. Win a match to unlock the Frost Fest uniform for good. First to 20.`,
  aim: 'Solo. 60 seconds, as many targets as you can hit.',
};
// ---------- the lobby: everyone in the room, standing in a line-up, until everyone is ready ----------
export const LB = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(35, 1, 0.1, 200), meshes: new Map(), key: '', t: 0, ui: 0 };
const START_DELAY = 3000; // ms from everyone ready to the match starting
// the leader's game starts the match on its own, so nobody clicked: everyone (the leader too) gets the "Click Play" card
function startFromLobby() {
  const hi = Math.max(net.m, ...[...net.remotes.values()].map(r => r.m));
  beginMatch(hi > net.m ? hi : net.m + 1, false);
}
export function enterLobby() {
  net.lobbyFrom = net.m; setState('lobby'); netSend(true);
  net.unlockDue = true; // the lobby unlocks the room once nobody from the match is still alive (renderLobbyUI)
}
// battle royale: players from the last match who are still alive in it
const stillInMatch = () => (oneLife() ? [...net.remotes.values()].filter(r => !r.lobby && !r.dead && !r.over).length : 0);
// the room's players in groups: squads in battle royale, Blue and Red in team deathmatch, otherwise one line
export function lobbyGroups() {
  const all = [player, ...net.remotes.values()];
  const by = new Map();
  for (const e of all) { const k = alliesOn() && e.team !== undefined ? e.team : 0; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, list]) => ({ t, list: list.sort((a, b) => (a === player ? -1 : b === player ? 1 : a.name.localeCompare(b.name))) }));
}
const groupName = t => (teamsOn() ? TEAM_NAMES[t] : squadsOn() ? `Squad ${t + 1}` : 'Players');
export function updateLobby(dt) {
  LB.t += dt;
  const groups = lobbyGroups();
  const looks = e => (e === player ? { uniform: prog.uniform, camo: prog.camo[player.guns[player.weapon].id], lv: P.level(prog) } : { uniform: e.sk, camo: e.cm, lv: e.lv });
  const sig = e => { const l = looks(e); return [e.name, e.color, l.uniform, l.camo, l.lv].join('|'); };
  const key = groups.map(g => g.t + ':' + g.list.map(e => (e === player ? 'me' : e.peer) + '=' + sig(e)).join(',')).join(';');
  if (key !== LB.key) {
    LB.key = key;
    const keep = new Set();
    for (const g of groups) for (const e of g.list) {
      const id = e === player ? 'me' : e.peer, s = sig(e); keep.add(id);
      const old = LB.meshes.get(id); if (old && old.sig === s) continue;
      if (old) LB.scene.remove(old.mesh);
      const mesh = soldierMesh(e.name, e.color, false, looks(e)); LB.scene.add(mesh); LB.meshes.set(id, { mesh, sig: s });
    }
    for (const [id, m] of LB.meshes) if (!keep.has(id)) { LB.scene.remove(m.mesh); LB.meshes.delete(id); }
    // stand them in a row, a gap between groups, and pull the camera back to fit everyone
    const gap = 1.1, sep = 2, n = groups.reduce((a, g) => a + g.list.length, 0), w = (n - 1) * gap + (groups.length - 1) * sep;
    let x = -w / 2;
    for (const g of groups) { for (const e of g.list) { const m = LB.meshes.get(e === player ? 'me' : e.peer); m.mesh.position.set(x, 0, 0); m.x = x; x += gap; } x += sep - gap; }
    LB.dist = Math.max(9, w * 1.35 + 5);
    renderLobbyUI(groups);
  }
  let i = 0;
  for (const m of LB.meshes.values()) { m.mesh.rotation.y = Math.sin(LB.t * 0.6 + i++ * 1.3) * 0.25; }
  const sway = Math.sin(LB.t * 0.15) * 0.6;
  LB.cam.position.set(sway, 1.5, LB.dist || 7); LB.cam.lookAt(0, 0.55, 0); // aimed low so the line-up sits above the bottom card
  if (performance.now() > LB.ui) { LB.ui = performance.now() + 500; renderLobbyUI(groups); }
}
export function renderLobbyUI(groups) {
  const isHost = net.host === net.myPeer;
  setText('lobbyTitle', `Room ${settings.room}`);
  const c = cfg(), bits = [GAMES[game], MAPS[net.map || currentMap]];
  if (squadsOn()) bits.push(SQUAD_NAMES[c.sq] + (c.fill === 0 ? ', no fill' : '')); else if (teamsOn()) bits.push(`${c.ts}v${c.ts}`);
  if (oneLife() && c.hok) bits.push(`+${c.hok} HP per kill`);
  setText('lobbyInfo', bits.join(' \u00b7 '));
  const listKey = JSON.stringify([isHost, net.host, game, cfg().sq, groups.map(g => [g.t, g.list.map(e => [e.peer, e.name, e.color, e.lobby, e.ready, e.lv]), net.ready])]);
  const box = $('lobbyList');
  if (box.dataset.k !== listKey) { box.dataset.k = listKey; box.textContent = ''; } else groups = [];
  for (const g of groups) {
    const col = document.createElement('div'); col.className = 'lbGroup';
    const h = document.createElement('small'); h.textContent = groupName(g.t); col.append(h);
    for (const e of g.list) {
      const row = document.createElement('div'); row.className = 'lbRow';
      const dot = document.createElement('i'); dot.style.background = e.color;
      const n = document.createElement('b'); n.textContent = e === player ? `${e.name} (you)` : e.name;
      const tag = document.createElement('span');
      const id = e === player ? net.myPeer : e.peer;
      tag.textContent = [id === net.host ? 'Leader' : '', e === player ? (net.ready ? 'Ready' : 'Not ready') : e.ready ? 'Ready' : !e.lobby ? 'In a match' : 'Not ready', `Lv ${e === player ? P.level(prog) : e.lv || 1}`].filter(Boolean).join(' \u00b7 ');
      row.append(dot, n, tag);
      if (isHost && e !== player) { // hand the lead to them
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost small lbLead'; b.textContent = 'Make leader';
        b.addEventListener('click', () => { if (net.room) net.room.control({ t: 'lead', k: e.peer }); });
        row.append(b);
      }
      col.append(row);
    }
    box.append(col);
  }
  // battle royale: the leader can't start the next one while anyone is still alive in the last one,
  // and the room stays locked until then, so nobody joins and the settings can't re-seat the squads mid-match
  if (isHost && !stillInMatch() && net.unlockDue && net.status === 'ready') { net.unlockDue = false; sendLock(false); }
  const { n, still, waiting, go, left } = readyTick();
  setText('lobbyMsg', net.status !== 'ready' ? 'Connecting\u2026'
    : still ? `${still} player${still > 1 ? 's are' : ' is'} still alive in the last match. The next one can start when it ends.`
    : go ? `Everyone's ready. Starting in ${left}\u2026`
    : !net.ready ? (n === 1 ? 'Press Ready to start: bots fill the empty seats. Or send friends the invite link first.' : `Press Ready. The match starts once all ${n} of you are ready; bots fill the empty seats.`)
    : `Waiting for ${waiting} more player${waiting > 1 ? 's' : ''} to get ready.`);
  $('lobbyStart').hidden = true;
  $('lobbyReady').hidden = false; $('lobbyReady').textContent = net.ready ? 'Not ready' : 'Ready'; $('lobbyReady').classList.toggle('ghost', net.ready);
  renderLobbySet(isHost, still > 0);
}
// ---------- ready for the next match: from the lobby, or right where you are once you're out of this one ----------
// Out of the match: down for good in battle royale (spectating or not), or on the match-over card. Either way the
// next match starts by itself a few seconds after everyone in the room is ready, wherever they are (the leader's game
// starts it); anyone who un-readies in that time stops the countdown.
export const outOfMatch = () => mode === 'online' && (state === 'over' || (oneLife() && !player.alive && !player.drop && (state === 'playing' || state === 'paused')));
export const readyHere = () => state === 'lobby' || outOfMatch();
function readyTick() {
  const n = 1 + net.remotes.size, still = stillInMatch(), isHost = net.host === net.myPeer;
  const waiting = [...net.remotes.values()].filter(r => !r.ready).length + (net.ready ? 0 : 1);
  const go = net.status === 'ready' && !still && !waiting && !(isHost && state === 'lobby' && net.unlockDue);
  if (!go) net.goAt = 0; else if (!net.goAt) net.goAt = performance.now() + START_DELAY;
  const left = Math.max(0, Math.ceil((net.goAt - performance.now()) / 1000));
  if (go && isHost && performance.now() >= net.goAt) { net.goAt = 0; startFromLobby(); }
  return { n, still, waiting, go, left };
}
export function toggleReadyOut() {
  if (!outOfMatch()) return;
  net.ready = !net.ready; netSend(true); updateReadyOut();
}
let readyAt = 0;
export function updateReadyOut() {
  readyAt = performance.now() + 250;
  const { n, still, waiting, go, left } = readyTick();
  if (!outOfMatch()) return; // the match just started
  const msg = !net.ready ? (n === 1 ? 'Ready up to play again, or go back to the lobby.' : `Ready up to play again with this group, or go back to the lobby. It starts once all ${n} of you are ready.`)
    : go ? `Everyone's ready. Starting in ${left}…`
    : `Ready. Waiting for ${waiting} more player${waiting > 1 ? 's' : ''}${still ? ` (${still} still in the match)` : ''}.`;
  for (const id of ['deathReady', 'specReadyMsg', 'overReady']) setText(id, msg);
  for (const id of ['deathAgain', 'specReady', 'againBtn']) { const b = $(id); b.textContent = net.ready ? 'Not ready' : 'Ready up'; b.classList.toggle('ghost', net.ready); }
}
export function readyOutFrame() { if (outOfMatch() && performance.now() > readyAt) updateReadyOut(); }
// the leader's controls: game, map and that game's options. Each change goes to the server, which tells everyone.
// busy: a battle royale is still going (the server ignores changes then), so the controls are greyed out
function renderLobbySet(isHost, busy) {
  const box = $('lobbySet'), c = cfg(), map = net.map || currentMap;
  const key = JSON.stringify([isHost, busy, game, map, c, net.pub]);
  $('lobbySetWrap').hidden = !isHost; if (!isHost || box.dataset.k === key) return;
  box.dataset.k = key; box.textContent = '';
  const send = msg => { if (net.room) net.room.control({ t: 'set', ...msg }); };
  const pick = (label, opts, val, on) => {
    const w = document.createElement('label'); w.className = 'lbSet';
    const s = document.createElement('small'); s.textContent = label;
    const sel = document.createElement('select');
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = String(v); o.textContent = t; sel.append(o); }
    sel.value = String(val); sel.disabled = busy; sel.addEventListener('change', () => on(sel.value));
    w.append(s, sel); box.append(w);
  };
  pick('Game', Object.entries(GAMES).filter(([k]) => k !== 'aim'), game, v => send({ game: v }));
  pick('Map', Object.entries(MAPS), map, v => send({ map: v }));
  if (game === 'br') {
    // a party of 2 to 4 stays in one squad, so only the sizes it fits in (the server holds to that too)
    const party = 1 + net.remotes.size, least = party >= 2 && party <= 4 ? party : 1;
    pick('Squads', [[1, 'Solo'], [2, 'Duos'], [3, 'Trios'], [4, 'Squads']].filter(([v]) => v >= least), Math.max(c.sq || 1, least), v => send({ sq: +v }));
    if ((c.sq | 0) > 1) pick('Empty seats', [[1, 'Fill with bots'], [0, 'No fill']], c.fill === 0 ? 0 : 1, v => send({ fill: +v }));
    pick('Heal on kill', [[0, 'Off'], [25, '+25 HP'], [50, '+50 HP']], c.hok || 0, v => send({ hok: +v }));
  }
  if (game === 'tdm') {
    pick('Teams', [1, 2, 3, 4, 5].map(n => [n, `${n}v${n}`]), c.ts, v => send({ ts: +v }));
    pick('Score to win', [[15, '15'], [25, '25'], [50, '50']], c.lim, v => send({ lim: +v }));
    pick('Players', [['together', 'Together vs bots'], ['split', 'Split evenly']], c.side, v => send({ side: v }));
  } else if (game !== 'zombies') pick('Bots', [0, 3, 5, 7, 11].map(n => [n, n ? String(n) : 'None']), c.bots, v => send({ bots: +v }));
  if (game !== 'zombies') pick('Bot skill', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], c.diff, v => send({ diff: v }));
  pick('Who can join', [['true', 'Public: listed'], ['false', 'Private: code only']], String(net.pub !== false), v => send({ pub: v === 'true' }));
}
// menu wiring
function segment(id, key, parse, onChange) {
  const seg = $(id);
  const sync = () => [...seg.children].forEach(b => b.setAttribute('aria-pressed', String(String(settings[key]) === b.dataset.v)));
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings[key] = parse(b.dataset.v); sync(); saveSettings(); if (onChange) onChange(); });
  sync();
}
// a new room gets a fresh code, so two people creating rooms don't land in the same one by accident
const freshCode = () => 'spud-' + Math.random().toString(36).slice(2, 6);
function createRoom() { settings.room = cleanRoom($('roomIn').value); $('roomIn').value = settings.room; startGame(); }
// settings: open from the menu or mid-match from the pause screen; everything applies at once
let setReturn = null;
function slider(id, key, min, max, fmt, onChange) {
  const inp = $(id), out = $(id.replace('In', 'Val'));
  if (!Number.isFinite(+settings[key])) settings[key] = +inp.value;
  settings[key] = clamp(+settings[key], min, max);
  inp.value = settings[key]; out.textContent = fmt(settings[key]);
  inp.addEventListener('input', () => { settings[key] = +inp.value; out.textContent = fmt(settings[key]); saveSettings(); if (onChange) onChange(); });
}
function openSettings(from) { setReturn = from; $('settings').hidden = false; $('setDone').focus(); }
function closeSettings() { $('settings').hidden = true; const b = setReturn === 'pause' ? $('pSetBtn') : $('setBtn'); if (b) b.focus(); }

// ---------- invite links ----------
// A link ending in #room=<code> opens the game in online mode with that room filled in.
function roomFromLink() {
  const m = /(?:^|[#&?])room=([^&#]*)/.exec(location.hash + '&' + location.search);
  if (!m) return null;
  let v = m[1]; try { v = decodeURIComponent(v); } catch (e) {}
  return cleanRoom(v.replace(/\+/g, ' '));
}
export function inviteLink(code) { return location.origin + location.pathname + location.search + '#room=' + cleanRoom(code); }
function showInviteMsg(t) { $('inviteMsg').textContent = t; $('inviteMsg').hidden = !t; }
async function copyInvite(code, btn, out) {
  const link = inviteLink(code), label = btn.textContent;
  let ok = false;
  try { await navigator.clipboard.writeText(link); ok = true; } catch (e) {}
  if (ok) {
    out.hidden = true; btn.textContent = 'Link copied';
    setTimeout(() => { btn.textContent = label; }, 2000);
  } else {
    out.value = link; out.hidden = false; out.focus(); out.select(); // clipboard blocked: let them copy it by hand
  }
  return ok;
}
export function applyInvite() {
  const code = roomFromLink(); if (!code) return;
  if (settings.mode !== 'online') $('mOnline').click();
  settings.room = code; saveSettings();
  startGame(true);
}

// the menu's wiring: game.js calls this once its own state is set up (where this code used to run)
export function initMenu() {
  document.addEventListener('keydown', e => {
    if (!rebinding) { if (e.code === 'Escape' && !$('controls').hidden) { e.preventDefault(); closeControls(); } return; }
    e.preventDefault(); e.stopImmediatePropagation();
    finishRebind(e.code);
  }, true);
  document.addEventListener('mousedown', e => {
    if (!rebinding) return;
    // a left click on another control button just switches which one is listening
    if (e.button === 0 && e.target.closest && e.target.closest('#controls button')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    finishRebind('Mouse' + e.button);
  }, true);
  $('controls').addEventListener('contextmenu', e => e.preventDefault());
  {
    LB.scene.background = new THREE.Color(0x2b2216); LB.scene.fog = new THREE.Fog(0x2b2216, 14, 40);
    LB.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x3a2c1a, 1.1));
    const key = new THREE.DirectionalLight(0xffe2b0, 1.3); key.position.set(4, 8, 6); LB.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.5); rim.position.set(-6, 4, -6); LB.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x4a3a24 }));
    floor.rotation.x = -Math.PI / 2; LB.scene.add(floor);
  }
  $('lobbyStart').addEventListener('click', () => { if (state === 'lobby') playAgain(); });
  $('lobbyReady').addEventListener('click', () => { net.ready = !net.ready; netSend(true); renderLobbyUI(lobbyGroups()); });
  $('lobbyLeave').addEventListener('click', () => toMenu());
  $('lobbyInvite').addEventListener('click', () => copyInvite(settings.room, $('lobbyInvite'), $('lobbyInviteOut')));
  $('lobbyBtn').addEventListener('click', () => { if (mode === 'online') { net.ready = false; enterLobby(); } });
  if (settings.mode !== 'online') settings.mode = 'bots';
  segment('modeSeg', 'mode', v => v, updateModeUI);
  $('roomIn').value = freshCode();
  $('roomIn').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
  $('joinIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinCode($('joinIn').value); });
  $('joinBtn').addEventListener('click', () => joinCode($('joinIn').value));
  if (settings.otab !== 'create') settings.otab = 'browse';
  segment('otabSeg', 'otab', v => v, updateModeUI);
  segment('tsSeg', 'ts', v => +v, updateModeUI);
  segment('limSeg', 'lim', v => +v);
  segment('sideSeg', 'side', v => v, updateModeUI);
  segment('sqSeg', 'sq', v => +v, updateModeUI);
  segment('hokSeg', 'hok', v => +v);
  segment('fillSeg', 'fill', v => +v, updateModeUI);
  segment('pubSeg', 'pub', v => v === 'true');
  segment('diffSeg', 'diff', v => v);
  if (!GAMES[settings.game] || (settings.game === EVENT.game && !eventOn())) settings.game = 'ffa';
  if (!eventOn()) $('gameSeg').querySelector(`[data-v=${EVENT.game}]`).remove(); // the event is over (or not on yet)
  segment('gameSeg', 'game', v => v, updateModeUI);
  segment('botSeg', 'bots', v => +v);
  updateModeUI();
  if (typeof settings.music !== 'boolean') settings.music = true;
  segment('musicSeg', 'music', v => v === 'true', () => setMusicOn(settings.music));
  setMusicOn(settings.music);
  slider('sensIn', 'sens', 0.3, 2.5, v => v.toFixed(1));
  slider('adsIn', 'adsSens', 0.3, 2, v => v.toFixed(1));
  slider('fovIn', 'fov', 60, 100, v => String(v));
  slider('volIn', 'vol', 0, 1, v => Math.round(v * 100) + '%', () => setVolume(settings.vol));
  setVolume(settings.vol);
  $('setBtn').addEventListener('click', () => openSettings('menu'));
  $('pSetBtn').addEventListener('click', () => openSettings('pause'));
  $('setDone').addEventListener('click', closeSettings);
  document.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('settings').hidden) { e.preventDefault(); closeSettings(); } });
  $('pArmBtn').addEventListener('click', () => openArmory(true));
  // browsers only start audio after a user gesture
  addEventListener('pointerdown', initAudio, { once: true });
  addEventListener('keydown', initAudio, { once: true });
  initArmory(prog, { onChange: loadoutChanged, onClose: () => (state === 'menu' ? $('armBtn') : $('pArmBtn')).focus() });
  $('armBtn').addEventListener('click', () => openArmory(false));
  if (!MAPS[settings.map]) settings.map = 'depot';
  segment('mapSeg', 'map', v => v, () => { if (state === 'menu') { setMap(settings.map); setupBots(5, 'normal'); } });
  $('nameIn').value = settings.name;
  $('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('playBtn').hidden) $('playBtn').click(); });
  $('playBtn').addEventListener('click', () => (settings.mode === 'online' ? createRoom() : startGame()));
  $('againBtn').addEventListener('click', () => (mode === 'online' ? toggleReadyOut() : playAgain())); // online: ready for the next one, right here
  $('deathAgain').addEventListener('click', () => (mode === 'online' ? toggleReadyOut() : playAgain()));
  $('deathMenu').addEventListener('click', () => (mode === 'online' ? deathToLobby(false) : toMenu()));
  $('menuBtn').addEventListener('click', toMenu);
  $('quitBtn').addEventListener('click', toMenu);
  $('ctrlBtn').addEventListener('click', () => openControls('menu'));
  $('pCtrlBtn').addEventListener('click', () => openControls('pause'));
  $('ctrlDone').addEventListener('click', closeControls);
  $('ctrlReset').addEventListener('click', () => {
    Object.assign(binds, DEFAULT_BINDS); rebinding = null; settings.binds = { ...binds }; saveSettings();
    $('bindMsg').textContent = 'Controls are back to the defaults.'; renderBinds();
  });
  $('inviteBtn').addEventListener('click', async () => {
    const code = cleanRoom($('roomIn').value); $('roomIn').value = code;
    if (await copyInvite(code, $('inviteBtn'), $('inviteOut'))) showInviteMsg(`Send it to your friend. Opening it puts them in room ${code}.`);
    else showInviteMsg('Copy this link and send it to your friend.');
  });
  $('pInviteBtn').addEventListener('click', () => copyInvite(settings.room, $('pInviteBtn'), $('pInviteOut')));
  $('roomIn').addEventListener('input', () => { $('inviteOut').hidden = true; showInviteMsg(''); });
  addEventListener('hashchange', () => { if (state === 'menu') applyInvite(); });
  $('resumeBtn').addEventListener('click', () => { if (plWorks === false || (!player.alive && mode !== 'online')) setState('playing'); else requestLock(); }); // dead: keep the mouse free for Play again
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) $('touchNote').hidden = false;
}
