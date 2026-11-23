// Pings: the ping key marks the spot you're looking at for your squad or team, or the enemy, if one is near the
// crosshair. With the full map open, a click (or the ping key) marks the spot under the map cursor instead. Both work
// while you're down and spectating. Each player has one ping at a time; a new one replaces it, and they fade on their own.
import { sfx } from './audio.js';
import { LIMIT } from './world.js';
import { $, V3, clamp } from './util.js';
import { camera, ents, isUp, now, player, rayWorld, sameTeam, spec, state, supplyStatus } from './game.js';
import { net, netEvent } from './netsync.js';
import { MM } from './hud.js';

const LIFE = 9, GAP = 0.35; // seconds a ping lasts; and between two of mine
export const pings = new Map(); // who ('me', or a player's id) -> { x, y, z, enemy, name, at }
let lastAt = -99;
const _o = new V3(), _d = new V3(), _v = new V3();

function place(x, y, z, enemy) {
  if (now - lastAt < GAP) return;
  lastAt = now;
  const lim = LIMIT * 1.5;
  x = clamp(x, -lim, lim); z = clamp(z, -lim, lim); y = clamp(y, -5, 130);
  pings.set('me', { x, y, z, enemy, name: 'You', at: now });
  netEvent('pg', Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10, enemy ? 1 : 0);
  (enemy ? sfx.pingEnemy : sfx.ping)();
}

// what the crosshair (or the spectating camera) points at: an enemy within a few degrees and in sight, else the world
export function pingAim() {
  if (state !== 'playing') return;
  _o.copy(camera.position); camera.getWorldDirection(_d);
  let best = null, bestCos = Math.cos(0.06);
  for (const e of ents) {
    if (e === player || e === spec.who || !isUp(e) || sameTeam(e, player) || !e.pos) continue;
    _v.set(e.pos.x, e.pos.y + 1.2, e.pos.z).sub(_o);
    const dist = _v.length(); if (dist < 1 || dist > 220) continue;
    _v.divideScalar(dist);
    const c = _v.dot(_d); if (c < bestCos) continue;
    if (rayWorld(_o, _v, dist) < dist - 0.8) continue; // behind a wall
    best = e; bestCos = c;
  }
  if (best) return place(best.pos.x, best.pos.y + 2.1, best.pos.z, true);
  const t = rayWorld(_o, _d, 260);
  if (t >= 259) return; // the sky
  place(_o.x + _d.x * t, _o.y + _d.y * t, _o.z + _d.z * t, false);
}

// ---------- the full map's cursor ----------
// where it starts: on me, or on whoever I spectate
export function mapCursorHome() {
  const e = player.alive ? player : spec.who || player;
  MM.cur = { x: e.pos.x, z: e.pos.z };
}
// with the mouse captured the cursor moves with the mouse, not the view
export function moveMapCursor(dx, dy) {
  const el = $('minimap'), k = (2 * LIMIT) / Math.max(1, el.clientWidth);
  if (!MM.cur) mapCursorHome();
  MM.cur.x = clamp(MM.cur.x + dx * k, -LIMIT, LIMIT); MM.cur.z = clamp(MM.cur.z + dy * k, -LIMIT, LIMIT);
  MM.at = 0; // redraw now
}
// with the mouse free, it sits under the pointer
function cursorAt(e) {
  const r = $('minimap').getBoundingClientRect();
  MM.cur = { x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1) * LIMIT, z: clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1) * LIMIT };
  MM.at = 0;
}
export function pingMap() {
  if (!MM.cur) mapCursorHome();
  const { x, z } = MM.cur;
  _o.set(x, 140, z); _d.set(0, -1, 0);
  const t = rayWorld(_o, _d, 160);
  place(x, t < 159 ? 140 - t : 0, z, false);
}
$('minimap').addEventListener('mousemove', e => { if (MM.big) cursorAt(e); });
$('minimap').addEventListener('mousedown', e => { if (!MM.big || e.button !== 0) return; e.preventDefault(); cursorAt(e); pingMap(); });

// someone's ping came in: only my squad's or team's count
export function remotePing(r, e) {
  if (!sameTeam(r, player)) return;
  const n = v => (Number.isFinite(+v) ? +v : 0), lim = LIMIT * 1.5;
  const enemy = e[5] === 1;
  pings.set(r.peer, { x: clamp(n(e[2]), -lim, lim), y: clamp(n(e[3]), -5, 130), z: clamp(n(e[4]), -lim, lim), enemy, name: r.name, at: now });
  (enemy ? sfx.pingEnemy : sfx.ping)();
}

// ---------- drawing ----------
// on screen: a marker over each ping with who placed it and how far it is, and one over the supply drop
const els = new Map();
export function updatePings() {
  const layer = $('pings'), show = state === 'playing' && !MM.big;
  for (const [who, p] of pings) if (now - p.at > LIFE || now < p.at) pings.delete(who);
  const sd = show ? supplyStatus() : null, list = [...pings];
  if (sd) list.push(['supply', { x: sd.x, y: sd.y + (sd.landed ? 3 : 1), z: sd.z, supply: sd }]);
  for (const [who, el] of els) if (!list.some(([w]) => w === who)) { el.remove(); els.delete(who); }
  if (!show) return;
  const W = layer.clientWidth, H = layer.clientHeight, me = player.alive ? player : spec.who || player;
  for (const [who, p] of list) {
    let el = els.get(who);
    if (!el) { el = document.createElement('div'); el.className = 'ping' + (p.supply ? ' supply' : ''); el.innerHTML = '<i></i><b></b>'; layer.append(el); els.set(who, el); }
    el.classList.toggle('enemy', !!p.enemy);
    _v.set(p.x, p.y, p.z).project(camera);
    const behind = _v.z > 1;
    // off screen or behind me: pinned to the edge, pointing the right way
    let sx = _v.x, sy = _v.y;
    if (behind) { sx = -sx; sy = -sy; }
    const m = Math.max(Math.abs(sx), Math.abs(sy));
    if (behind || m > 0.94) { const f = 0.94 / Math.max(m, 1e-6); sx *= f; sy *= f; }
    el.style.transform = `translate(${((sx + 1) / 2) * W}px, ${((1 - sy) / 2) * H}px)`;
    const dist = Math.round(Math.hypot(p.x - me.pos.x, p.z - me.pos.z));
    if (p.supply) {
      const es = Math.ceil(p.supply.eta), eta = `${Math.floor(es / 60)}:${String(es % 60).padStart(2, '0')}`;
      el.querySelector('b').textContent = p.supply.landed ? `Supply drop · ${dist} m` : `Supply drop · lands in ${eta} · ${dist} m`;
      continue;
    }
    el.querySelector('b').textContent = `${p.enemy ? 'Enemy' : p.name} · ${dist} m`;
    el.style.opacity = clamp((LIFE - (now - p.at)) / 1.5, 0, 1);
  }
}
// on the map: a diamond for each ping (red for an enemy), and the cursor while the full map is open
export function drawPings(g, X, u) {
  for (const p of pings.values()) {
    const x = X(p.x), z = X(p.z), s = 6 * u;
    g.fillStyle = p.enemy ? '#ff5a4a' : '#ffd23f'; g.strokeStyle = '#1b1208'; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(x, z - s); g.lineTo(x + s, z); g.lineTo(x, z + s); g.lineTo(x - s, z); g.closePath(); g.fill(); g.stroke();
  }
  if (MM.big && MM.cur) {
    const x = X(MM.cur.x), z = X(MM.cur.z), s = 10 * u;
    g.strokeStyle = '#fff6e0'; g.lineWidth = 2 * u; g.beginPath();
    g.moveTo(x - s, z); g.lineTo(x - s / 3, z); g.moveTo(x + s / 3, z); g.lineTo(x + s, z);
    g.moveTo(x, z - s); g.lineTo(x, z - s / 3); g.moveTo(x, z + s / 3); g.lineTo(x, z + s); g.stroke();
  }
}
export function clearPings() { pings.clear(); updatePings(); }
