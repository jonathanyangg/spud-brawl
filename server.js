// Serves the game from ./public and relays presence between players in the same room over /ws.
// The server keeps no game logic: clients own their own health and report their own deaths.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_PLAYERS = 12;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer(async (req, res) => {
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

const rooms = new Map(); // room code -> Map(player id -> socket)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const code = String(q.get('room') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'brawl';
  const id = q.get('id');
  if (!/^[a-z0-9]{4,16}$/.test(id || '')) { ws.close(1008, 'bad id'); return; }

  let room = rooms.get(code);
  if (!room) rooms.set(code, room = new Map());
  const old = room.get(id);
  if (old) old.terminate(); // same player reconnecting: drop the stale socket
  else if (room.size >= MAX_PLAYERS) { ws.send('{"t":"full"}'); ws.close(); return; }
  room.set(id, ws);

  // catch the newcomer up on everyone already here
  for (const [k, peer] of room) if (k !== id && peer.last) ws.send(relay(k, peer.last));

  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const raw = data.toString();
    try { const o = JSON.parse(raw); if (!o || typeof o !== 'object' || Array.isArray(o)) return; } catch { return; }
    ws.last = raw;
    const msg = relay(id, raw);
    for (const [k, peer] of room) if (k !== id && peer.readyState === 1) peer.send(msg);
  });
  ws.on('close', () => {
    if (room.get(id) !== ws) return; // replaced by a reconnect
    room.delete(id);
    if (!room.size) rooms.delete(code);
    const bye = JSON.stringify({ t: 'bye', k: id });
    for (const peer of room.values()) if (peer.readyState === 1) peer.send(bye);
  });
});

const relay = (k, raw) => `{"t":"p","k":"${k}","pr":${raw}}`;

// drop sockets that stopped answering (closed laptop, lost wifi)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 10000);

server.listen(PORT, () => console.log(`Spud Brawl on http://localhost:${PORT}`));
