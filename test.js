// Self-checks: progression logic (pure), then the relay (starts the server on a spare port and drives it with raw sockets).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import * as P from './public/progress.js';
import { WEAPONS } from './public/config.js';

// ---------- progression ----------
{
  // level math
  assert.deepEqual(P.levelInfo(0), { level: 1, into: 0, need: 600 });
  assert.deepEqual(P.levelInfo(599), { level: 1, into: 599, need: 600 });
  assert.deepEqual(P.levelInfo(600), { level: 2, into: 0, need: 800 });
  assert.deepEqual(P.levelInfo(600 + 800 + 5), { level: 3, into: 5, need: 1000 });
  let total = 0; for (let l = 1; l < P.MAX_LEVEL; l++) total += P.xpToNext(l);
  assert.equal(P.levelInfo(total - 1).level, P.MAX_LEVEL - 1);
  assert.deepEqual(P.levelInfo(total), { level: P.MAX_LEVEL, into: 0, need: 0 }, 'max level');
  assert.equal(P.levelInfo(1e12).level, P.MAX_LEVEL, 'capped');
  const xpFor = lv => { let x = 0; for (let l = 1; l < lv; l++) x += P.xpToNext(l); return x; };

  // uniforms unlock by level
  const p = P.newProgress();
  assert.ok(P.uniformUnlocked(p, 'olive')); assert.ok(!P.uniformUnlocked(p, 'woodland'));
  assert.ok(!P.uniformUnlocked(p, 'factory'), 'factory is a gun look, not a uniform');
  assert.ok(!P.uniformUnlocked(p, 'nope'));
  p.xp = xpFor(3); assert.ok(P.uniformUnlocked(p, 'woodland')); assert.ok(!P.uniformUnlocked(p, 'desert'));

  // award: XP, level-ups, kill counts, unlock labels, fresh count
  const q = P.newProgress();
  let r = P.award(q, 100, { kill: { w: 0, head: true } });
  assert.equal(q.xp, 100); assert.deepEqual(q.wk, [1, 0, 0, 0, 0, 0]); assert.deepEqual(q.wh, [1, 0, 0, 0, 0, 0]);
  assert.equal(r.levelUp, null); assert.deepEqual(r.unlocks, []);
  r = P.award(q, 3000, { match: true, win: true });
  assert.equal(r.levelUp, P.level(q)); assert.ok(r.levelUp >= 4);
  assert.ok(r.unlocks.includes('Woodland uniform') && r.unlocks.includes('Extended mag'), r.unlocks.join());
  assert.equal(q.fresh, r.unlocks.length); assert.equal(q.matches, 1); assert.equal(q.wins, 1);
  P.award(q, 50, { kill: { w: WEAPONS.length, head: false } }); assert.deepEqual(q.wk, [1, 0, 0, 0, 0, 0], 'frag kills count toward no gun');
  P.award(q, -500); assert.equal(q.xp, 3150, 'negative XP is ignored');

  // camos unlock per gun by kills and headshots
  const c = P.newProgress();
  assert.ok(P.camoUnlocked(c, 1, 'factory')); assert.ok(!P.camoUnlocked(c, 1, 'woodland'));
  for (let i = 0; i < 9; i++) P.award(c, 0, { kill: { w: 1 } });
  r = P.award(c, 0, { kill: { w: 1 } });
  assert.deepEqual(r.unlocks, ['Woodland camo \u00b7 Shotgun']);
  assert.ok(P.camoUnlocked(c, 1, 'woodland')); assert.ok(!P.camoUnlocked(c, 0, 'woodland'), 'per gun');
  c.wk[1] = 150; c.wh[1] = 24; assert.ok(!P.camoUnlocked(c, 1, 'crimson')); assert.equal(P.camoNeed(c, 1, 'crimson'), '24/25 headshots');
  c.wh[1] = 25; assert.ok(P.camoUnlocked(c, 1, 'crimson'));
  assert.equal(P.camoNeed(c, 1, 'gold'), '150/250 kills, 25/50 headshots');
  c.wk = [250, 250, 250, 0, 0, 0]; c.wh = [50, 50, 49, 0, 0, 0];
  assert.ok(P.camoUnlocked(c, 0, 'gold')); assert.ok(!P.camoUnlocked(c, 0, 'nebula'), 'nebula needs gold on three');
  c.wh[2] = 50; assert.ok(P.camoUnlocked(c, 0, 'nebula'));
  c.wk[4] = 250; assert.ok(P.camoUnlocked(c, 4, 'gold'), 'RPG gold needs no headshots'); assert.equal(P.camoNeed(c, 4, 'crimson'), '');

  // loading saves: good ones round-trip, bad values are dropped
  const good = P.newProgress(); good.xp = xpFor(20); good.wk = [300, 300, 300]; good.wh = [60, 60, 60];
  good.wk.push(0, 0, 0); good.wh.push(0, 0, 0);
  good.uniform = 'night'; good.camo = ['nebula', 'gold', 'tiger', 'factory', 'factory', 'factory']; good.att = [['ext', 'laser'], ['fast'], [], [], [], []];
  good.loadout = [3, 4, 5]; good.nade = 'flash'; good.bestAim = 31;
  assert.deepEqual(P.loadProgress(JSON.stringify(good)), good, 'round trip (nebula on gun 0 included)');
  for (const raw of [null, '', 'garbage{', '42', 'null', '[]', '"x"']) assert.deepEqual(P.loadProgress(raw), P.newProgress(), `bad save ${raw}`);
  const bad = P.loadProgress(JSON.stringify({
    xp: -5, matches: 'lots', wins: 1.7, fresh: Infinity, wk: [5, -1, 'x'], wh: { 0: 3 },
    uniform: 'gold', camo: ['desert', '__proto__', 'nope'], att: [['sup', 'sup', 'ext', 'laser', 'zzz'], 'ext', null],
  }));
  assert.equal(bad.xp, 0); assert.equal(bad.matches, 0); assert.equal(bad.wins, 1); assert.equal(bad.fresh, 0);
  assert.deepEqual(bad.wk, [5, 0, 0, 0, 0, 0]); assert.deepEqual(bad.wh, [3, 0, 0, 0, 0, 0]);
  assert.equal(bad.uniform, 'olive', 'locked uniform dropped'); assert.deepEqual(bad.camo, P.newProgress().camo, 'locked and unknown camos dropped');
  assert.deepEqual(bad.att, P.newProgress().att, 'locked attachments dropped at level 1');
  const lo = P.loadProgress(JSON.stringify({ loadout: [4, 3, 3, 9, 'x', 5, 0], nade: 'flash' }));
  assert.deepEqual(lo.loadout, [3, 5, 0], 'RPG locked at level 1, dupes and junk dropped, max 3'); assert.equal(lo.nade, 'frag', 'flashbang locked at level 1');
  assert.deepEqual(P.loadProgress('{"loadout":[]}').loadout, [0, 1, 2], 'empty loadout falls back');
  const hi = P.loadProgress(JSON.stringify({ xp: xpFor(16), att: [['sup', 'sup', 'ext', 'laser', 'zzz'], 'ext', ['toString']] }));
  assert.deepEqual(hi.att.slice(0, 3), [['sup', 'ext'], [], []], 'deduped, unknown dropped, max 2');
  const knifeAtt = P.loadProgress(JSON.stringify({ xp: xpFor(16), att: [[], [], [], [], ['ext'], ['sup']] }));
  assert.deepEqual(knifeAtt.att[4], []); assert.deepEqual(knifeAtt.att[5], [], 'RPG and knife take no attachments');

  // attachment mods: applied to a copy, never to WEAPONS
  const m = P.newProgress(); m.xp = xpFor(16);
  m.att = [['ext', 'fast'], ['laser', 'sup'], [], [], [], []];
  const g = P.loadoutWeapons(m);
  assert.equal(g[0].mag, 45); assert.ok(Math.abs(g[0].reload - 1.6 * 1.15 * 0.7) < 1e-9);
  assert.equal(g[1].hipK, 0.65); assert.equal(g[1].sup, true); assert.ok(Math.abs(g[1].range - 30 * 0.85) < 1e-9);
  assert.deepEqual(g[2], WEAPONS[2]); assert.notEqual(g[2], WEAPONS[2]);
  assert.equal(WEAPONS[0].mag, 30); assert.equal(WEAPONS[1].sup, undefined, 'WEAPONS untouched');
  const k = P.newProgress(); k.loadout = [5, 3]; assert.deepEqual(P.loadoutWeapons(k).map(w => w.name), ['Knife', 'AR'], 'loadout order');
  m.xp = 0; assert.equal(P.loadoutWeapons(m)[0].mag, 30, 'locked attachments do nothing');
  console.log('progress ok');
}

// ---------- relay ----------

const PORT = 3999, base = `ws://localhost:${PORT}/ws`;
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise(r => srv.stdout.once('data', r));

const open = (room, id, map = '', game = '') => new Promise((res, rej) => {
  const ws = new WebSocket(`${base}?room=${room}&id=${id}&map=${map}&game=${game}`); ws.msgs = [];
  ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'room') { ws.map = m.map; ws.game = m.game; } else ws.msgs.push(m); });
  ws.on('open', () => res(ws)); ws.on('error', rej);
});
const tick = () => new Promise(r => setTimeout(r, 100));

try {
  const a = await open('test', 'aaaa1', 'yard', 'zombies');
  a.send(JSON.stringify({ v: 1, n: 'A' }));
  await tick();
  const b = await open('test', 'bbbb2', 'depot', 'gungame');
  await tick();
  assert.equal(a.map, 'yard', 'first joiner picks the map'); assert.equal(b.map, 'yard', 'later joiners get the room map');
  assert.equal(b.game, 'zombies', 'and the room game');
  assert.deepEqual(b.msgs[0], { t: 'p', k: 'aaaa1', pr: { v: 1, n: 'A' } }, 'newcomer gets snapshot');
  b.send(JSON.stringify({ v: 1, n: 'B' })); b.send('not json');
  await tick();
  assert.deepEqual(a.msgs, [{ t: 'p', k: 'bbbb2', pr: { v: 1, n: 'B' } }], 'relay to others only, junk dropped');
  const other = await open('elsewhere', 'cccc3', 'nope');
  await tick(); assert.equal(other.map, 'depot', 'unknown map falls back to the default'); assert.equal(other.game, 'ffa', 'unknown game too');
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
