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
const MAPS = ['depot', 'yard', 'dunes', 'frost', 'stack', 'highrise'];
const GAMES = ['ffa', 'tdm', 'br', 'zombies', 'gungame', 'moon', 'snipe']; // aim trainer is solo, never a room
const DIFFS = ['easy', 'normal', 'hard'];
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  if (req.url === '/rooms') { // the server browser: public rooms with someone in them
    const list = [...rooms].filter(([, r]) => r.pub && r.peers.size).map(([code, r]) => ({ code, map: r.map, game: r.game, players: r.peers.size, max: MAX_PLAYERS, bots: r.cfg.bots, ts: r.cfg.ts }));
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(list));
  }
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(PUBLIC, path.endsWith('/') ? path + 'index.html' : path);
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
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const code = String(q.get('room') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'brawl';
  const id = q.get('id');
  if (!/^[a-z0-9]{4,16}$/.test(id || '')) { ws.close(1008, 'bad id'); return; }

  // whoever opens a room picks its map and game type; everyone who joins later plays those
  let room = rooms.get(code);
  // and its settings: bots (free-for-all count), bot skill, team size and score limit (team deathmatch), and whether
  // the players go on one team against bots or get split evenly; pub: listed in the server browser
  if (!room) rooms.set(code, room = {
    map: MAPS.includes(q.get('map')) ? q.get('map') : MAPS[0], game: GAMES.includes(q.get('game')) ? q.get('game') : GAMES[0],
    cfg: { bots: int(q.get('bots'), 0, 11, 0), diff: DIFFS.includes(q.get('diff')) ? q.get('diff') : 'normal', ts: int(q.get('ts'), 1, 6, 4),
      lim: int(q.get('lim'), 5, 100, 25), side: q.get('side') === 'split' ? 'split' : 'together' },
    pub: q.get('pub') === '1', peers: new Map(),
  });
  const peers = room.peers, old = peers.get(id);
  if (old) { ws.team = old.team; old.terminate(); } // same player reconnecting: drop the stale socket, keep the seat
  else if (peers.size >= MAX_PLAYERS) { ws.send('{"t":"full"}'); ws.close(); return; }
  else ws.team = pickTeam(room);
  peers.set(id, ws);
  ws.send(JSON.stringify({ t: 'room', map: room.map, game: room.game, cfg: room.cfg, team: ws.team, host: peers.keys().next().value }));

  // catch the newcomer up on everyone already here
  for (const [k, peer] of peers) if (k !== id && peer.last) ws.send(relay(k, peer.last));

  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const raw = data.toString();
    try { const o = JSON.parse(raw); if (!o || typeof o !== 'object' || Array.isArray(o)) return; } catch { return; }
    ws.last = raw;
    const msg = relay(id, raw);
    for (const [k, peer] of peers) if (k !== id && peer.readyState === 1) peer.send(msg);
  });
  ws.on('close', () => {
    if (peers.get(id) !== ws) return; // replaced by a reconnect
    const wasHost = peers.keys().next().value === id;
    peers.delete(id);
    if (!peers.size) { rooms.delete(code); return; }
    const bye = JSON.stringify({ t: 'bye', k: id }), host = JSON.stringify({ t: 'host', k: peers.keys().next().value });
    for (const peer of peers.values()) if (peer.readyState === 1) { peer.send(bye); if (wasHost) peer.send(host); }
  });
});

// team deathmatch seats: 'together' fills the first team with players (bots make up the rest), 'split' evens them out
function pickTeam(room) {
  const n = [0, 0]; for (const ws of room.peers.values()) n[ws.team | 0]++;
  if (room.cfg.side === 'together') return n[0] < room.cfg.ts ? 0 : n[1] < room.cfg.ts ? 1 : n[0] <= n[1] ? 0 : 1;
  return n[0] <= n[1] ? 0 : 1;
}
const relay = (k, raw) => `{"t":"p","k":"${k}","pr":${raw}}`;

// drop sockets that stopped answering (closed laptop, lost wifi)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 10000);

server.listen(PORT, () => console.log(`Spud Brawl on http://localhost:${PORT}`));
