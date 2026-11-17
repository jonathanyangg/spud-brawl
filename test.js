// Relay self-check: starts the server on a spare port and drives it with raw sockets.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const PORT = 3999, base = `ws://localhost:${PORT}/ws`;
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise(r => srv.stdout.once('data', r));

const open = (room, id, map = '') => new Promise((res, rej) => {
  const ws = new WebSocket(`${base}?room=${room}&id=${id}&map=${map}`); ws.msgs = [];
  ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'room') ws.map = m.map; else ws.msgs.push(m); });
  ws.on('open', () => res(ws)); ws.on('error', rej);
});
const tick = () => new Promise(r => setTimeout(r, 100));

try {
  const a = await open('test', 'aaaa1', 'yard');
  a.send(JSON.stringify({ v: 1, n: 'A' }));
  await tick();
  const b = await open('test', 'bbbb2', 'depot');
  await tick();
  assert.equal(a.map, 'yard', 'first joiner picks the map'); assert.equal(b.map, 'yard', 'later joiners get the room map');
  assert.deepEqual(b.msgs[0], { t: 'p', k: 'aaaa1', pr: { v: 1, n: 'A' } }, 'newcomer gets snapshot');
  b.send(JSON.stringify({ v: 1, n: 'B' })); b.send('not json');
  await tick();
  assert.deepEqual(a.msgs, [{ t: 'p', k: 'bbbb2', pr: { v: 1, n: 'B' } }], 'relay to others only, junk dropped');
  const other = await open('elsewhere', 'cccc3', 'nope');
  await tick(); assert.equal(other.map, 'depot', 'unknown map falls back to the default');
  b.send(JSON.stringify({ v: 1, n: 'B2' })); await tick();
  assert.equal(other.msgs.length, 0, 'rooms are isolated');
  const b2 = await open('test', 'bbbb2'); // reconnect with the same id
  await tick();
  assert.ok(!a.msgs.some(m => m.t === 'bye'), 'reconnect does not announce a leave');
  b2.close(); await tick();
  assert.deepEqual(a.msgs.at(-1), { t: 'bye', k: 'bbbb2' }, 'leave is announced');
  const res = await fetch(`http://localhost:${PORT}/%2e%2e/server.js`);
  assert.notEqual(res.status, 200, 'no files outside public');
  assert.equal((await fetch(`http://localhost:${PORT}/%E0`)).status, 404, 'bad encoding does not crash');
  assert.equal((await fetch(`http://localhost:${PORT}/`)).status, 200);
  console.log('ok');
} finally { srv.kill(); }
process.exit(0);
