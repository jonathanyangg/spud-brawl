// Serves the game from ./public and relays presence between players in the same room over /ws.
// The server keeps no game logic: clients own their own health and report their own deaths.
// Accounts, coins and payments live under /api (api.js) and stay off until their env vars are set.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { handleApi } from './api.js';

const PORT = process.env.PORT || 3000;
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_PLAYERS = 12;
// flood limits: rooms on the server, sockets from one address, and each socket's messages and bytes a second
// (a game sends about 30 presences a second; the bot host's are the biggest). Over the rate: dropped; far over: closed.
const MAX_ROOMS = +process.env.MAX_ROOMS || 300, PER_IP = +process.env.MAX_PER_IP || 16;
const MSG_RATE = 60, MSG_BURST = 120, BYTE_RATE = 512 * 1024, STRIKES = 200;
const MAPS = ['depot', 'yard', 'dunes', 'frost', 'stack', 'highrise', 'island'];
const GAMES = ['ffa', 'tdm', 'br', 'zombies', 'gungame', 'moon', 'snipe']; // aim trainer is solo, never a room
const DIFFS = ['easy', 'normal', 'hard'];
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  if (req.url === '/rooms') { // the server browser: public rooms with someone in them
    const list = [...rooms].filter(([, r]) => r.pub && r.peers.size).map(([code, r]) => ({ code, map: r.map, game: r.game, players: r.peers.size, max: MAX_PLAYERS, bots: r.cfg.bots, ts: r.cfg.ts, sq: r.cfg.sq, busy: !!r.locked }));
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(list));
  }
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(PUBLIC, /[\\/]$/.test(path) ? path + 'index.html' : path); // normalize gives '\' on Windows
    if (!file.startsWith(PUBLIC)) throw new Error('outside public');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

// room code -> { map, game, cfg, pub, peers: Map(player id -> socket) }. Peers keep join order, so the first one is the
// host: the player whose game runs the bots (and hands them on when they leave).
const rooms = new Map();
const perIp = new Map(); // address -> open sockets
// behind a host's proxy every socket comes from the proxy, so use the address it saw (the last x-forwarded-for entry)
const addrOf = req => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '?';
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const code = String(q.get('room') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'brawl';
  const id = q.get('id'), key = q.get('key');
  if (!/^[a-z0-9]{4,16}$/.test(id || '')) { ws.close(1008, 'bad id'); return; }
  // key: the player's secret, never relayed. Ids are public (every presence carries one), so only the matching key
  // can take a seat back, which stops anyone from kicking a player off their seat or playing as them (or as the leader)
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key || '')) { ws.close(1008, 'bad key'); return; }
  const ip = addrOf(req);
  if ((perIp.get(ip) || 0) >= PER_IP) { ws.close(1008, 'too many connections'); return; }
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  ws.once('close', () => { const n = perIp.get(ip) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); });

  // whoever opens a room picks its map and game type; everyone who joins later plays those
  let room = rooms.get(code);
  if (!room && rooms.size >= MAX_ROOMS) { ws.send('{"t":"full"}'); ws.close(); return; } // the server is full, not just this room
  // and its settings: bots (free-for-all count), bot skill, team size and score limit (team deathmatch), and whether
  // the players go on one team against bots or get split evenly; pub: listed in the server browser
  if (!room) rooms.set(code, room = {
    map: MAPS.includes(q.get('map')) ? q.get('map') : MAPS[0], game: GAMES.includes(q.get('game')) ? q.get('game') : GAMES[0],
    cfg: { bots: int(q.get('bots'), 0, 11, 0), diff: DIFFS.includes(q.get('diff')) ? q.get('diff') : 'normal', ts: int(q.get('ts'), 1, 6, 4),
      lim: int(q.get('lim'), 5, 100, 25), side: q.get('side') === 'split' ? 'split' : 'together', sq: int(q.get('sq'), 1, 4, 1), hok: [0, 25, 50].includes(+q.get('hok')) ? +q.get('hok') : 0 }, // sq: battle royale squad size; hok: health back per kill
    pub: q.get('pub') === '1', peers: new Map(),
    locked: false, inMatch: new Set(), seats: new Map(), // locked: a battle royale is on; inMatch: who was here when it started; seats: their squads
    keys: new Map(), // player id -> their secret key, for everyone seated (and, while locked, everyone in the match)
  });
  const peers = room.peers, known = room.keys.get(id);
  if (known !== undefined && known !== key) { ws.send('{"t":"taken"}'); ws.close(); return; } // their id, not their key
  const old = peers.get(id);
  // during a locked match only the players who were in it get back in (a dropped connection, a reload)
  if (room.locked && !old && !room.inMatch.has(id)) { ws.send('{"t":"busy"}'); ws.close(); return; }
  if (old) { ws.team = old.team; old.terminate(); } // same player reconnecting: drop the stale socket, keep the seat
  else if (peers.size >= MAX_PLAYERS) { ws.send('{"t":"full"}'); ws.close(); return; }
  else ws.team = room.locked && room.seats.has(id) ? room.seats.get(id) : pickTeam(room);
  peers.set(id, ws); room.keys.set(id, key);
  ws.send(roomMsg(room, ws));

  // catch the newcomer up on everyone already here
  for (const [k, peer] of peers) if (k !== id && peer.last) ws.send(relay(k, peer.last, peer.team));

  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  // token buckets: MSG_RATE messages and BYTE_RATE bytes a second, with some burst; every dropped message is a strike
  let msgs = MSG_BURST, bytes = BYTE_RATE, strikes = 0, at = Date.now();
  ws.on('message', (data, isBinary) => {
    const now = Date.now(), dt = (now - at) / 1000; at = now;
    msgs = Math.min(MSG_BURST, msgs + dt * MSG_RATE); bytes = Math.min(BYTE_RATE, bytes + dt * BYTE_RATE);
    strikes = Math.max(0, strikes - dt * MSG_RATE / 4);
    if (msgs < 1 || bytes < data.length) { if (++strikes > STRIKES) ws.close(1008, 'too many messages'); return; }
    msgs--; bytes -= data.length;
    if (isBinary) return;
    const raw = data.toString();
    let o; try { o = JSON.parse(raw); if (!o || typeof o !== 'object' || Array.isArray(o)) return; } catch { return; }
    // the room's leader (its first peer) can change the room's settings and hand the lead to someone else
    if (o.t === 'set' || o.t === 'lead' || o.t === 'lock') {
      if (peers.keys().next().value !== id) return;
      if (o.t === 'lock') { // the leader started a battle royale (on) or it's over / they're back in the lobby (off)
        room.locked = o.on === true;
        room.inMatch = new Set(room.locked ? peers.keys() : []);
        room.seats = new Map(room.locked ? [...peers].map(([k, v]) => [k, v.team]) : []);
        if (!room.locked) for (const k of [...room.keys.keys()]) if (!peers.has(k)) room.keys.delete(k); // match over: forget who left
      } else if (o.t === 'set') {
        setRoom(room, o);
        const seated = []; for (const peer of peers.values()) { peer.team = pickTeam(room, seated); seated.push(peer); } // seat everyone again
        for (const peer of peers.values()) if (peer.readyState === 1) peer.send(roomMsg(room, peer));
      } else if (typeof o.k === 'string' && o.k !== id && peers.has(o.k)) {
        const list = [...peers], i = list.findIndex(([k]) => k === o.k), [lead] = list.splice(i, 1);
        peers.clear(); for (const [k, v] of [lead, ...list]) peers.set(k, v);
        const msg = JSON.stringify({ t: 'host', k: o.k });
        for (const peer of peers.values()) if (peer.readyState === 1) peer.send(msg);
      }
      return;
    }
    ws.last = raw;
    const msg = relay(id, raw, ws.team);
    for (const [k, peer] of peers) if (k !== id && peer.readyState === 1) peer.send(msg);
  });
  ws.on('close', () => {
    if (peers.get(id) !== ws) return; // replaced by a reconnect
    const wasHost = peers.keys().next().value === id;
    peers.delete(id);
    if (!(room.locked && room.inMatch.has(id))) room.keys.delete(id); // a player from a locked match keeps their key to come back
    if (!peers.size) { rooms.delete(code); return; }
    const bye = JSON.stringify({ t: 'bye', k: id }), host = JSON.stringify({ t: 'host', k: peers.keys().next().value });
    for (const peer of peers.values()) if (peer.readyState === 1) { peer.send(bye); if (wasHost) peer.send(host); }
  });
});

// what a player is told about the room: its map, game, settings, their seat, and who leads
const roomMsg = (room, ws) => JSON.stringify({ t: 'room', map: room.map, game: room.game, cfg: room.cfg, pub: room.pub, team: ws.team, host: room.peers.keys().next().value });
// the leader's changes, checked like a new room's
function setRoom(room, o) {
  const c = room.cfg, has = k => o[k] !== undefined && o[k] !== null;
  if (MAPS.includes(o.map)) room.map = o.map;
  if (GAMES.includes(o.game)) room.game = o.game;
  if (has('bots')) c.bots = int(o.bots, 0, 11, c.bots);
  if (DIFFS.includes(o.diff)) c.diff = o.diff;
  if (has('ts')) c.ts = int(o.ts, 1, 6, c.ts);
  if (has('lim')) c.lim = int(o.lim, 5, 100, c.lim);
  if (o.side === 'split' || o.side === 'together') c.side = o.side;
  if (has('sq')) c.sq = int(o.sq, 1, 4, c.sq);
  if ([0, 25, 50].includes(o.hok)) c.hok = o.hok;
  if (typeof o.pub === 'boolean') room.pub = o.pub;
}
// team deathmatch seats: 'together' fills the first team with players (bots make up the rest), 'split' evens them out
// battle royale squads: players fill squad 0 first, then squad 1, and so on, sq to a squad (solos: nobody shares)
// seated: the players already placed (all of the room's by default)
function pickTeam(room, seated = [...room.peers.values()]) {
  if (room.game === 'br') {
    const sq = room.cfg.sq || 1, n = new Map(); if (sq <= 1) return 0;
    for (const ws of seated) n.set(ws.team | 0, (n.get(ws.team | 0) || 0) + 1);
    let t = 0; while ((n.get(t) || 0) >= sq) t++;
    return t;
  }
  const n = [0, 0]; for (const ws of seated) n[ws.team | 0]++;
  if (room.cfg.side === 'together') return n[0] < room.cfg.ts ? 0 : n[1] < room.cfg.ts ? 1 : n[0] <= n[1] ? 0 : 1;
  return n[0] <= n[1] ? 0 : 1;
}
// tm: the seat the server gave them, so a squad never depends on what their own game says
const relay = (k, raw, tm) => `{"t":"p","k":"${k}","tm":${Number.isInteger(tm) ? tm : -1},"pr":${raw}}`;

// drop sockets that stopped answering (closed laptop, lost wifi)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 10000);

server.listen(PORT, () => console.log(`Spud Brawl on http://localhost:${PORT}`));
