// Self-checks: progression and economy logic (pure), then the relay (starts the server on a spare port and drives it
// with raw sockets), then /api with no env vars, with Stripe only, and against a mock Supabase; then a headless browser.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import Stripe from 'stripe';
import * as P from './public/progress.js';
import * as E from './public/economy.js';
import { buildNav, navToward } from './public/nav.js';
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

  // premium looks: never by level or kills, only when the server says you own them
  const rich = P.newProgress(); rich.xp = 1e9; rich.wk.fill(1e6); rich.wh.fill(1e6);
  for (const id in P.PREMIUM) {
    assert.ok(P.LOOKS[id], `${id} has a look`);
    assert.ok(!P.uniformUnlocked(rich, id) && !P.camoUnlocked(rich, 0, id), `${id} does not unlock by playing`);
    assert.ok(!P.UNIFORMS.some(u => u[0] === id) && !P.CAMOS.some(c => c[0] === id), `${id} is not in the free lists`);
  }
  P.setOwned(rich, ['hazard', 'cherry', 'bogus', 'hazard', '__proto__']);
  assert.deepEqual(rich.owned, ['hazard', 'cherry'], 'unknown and duplicate ids dropped');
  assert.ok(P.uniformUnlocked(rich, 'hazard')); assert.ok(!P.uniformUnlocked(rich, 'cherry'), 'a camo is not a uniform');
  assert.ok(WEAPONS.every((w, i) => P.camoUnlocked(rich, i, 'cherry')), 'a bought camo fits every weapon');
  assert.ok(!P.camoUnlocked(rich, 0, 'hazard')); assert.equal(P.camoNeed(rich, 0, 'cherry'), '');
  rich.uniform = 'hazard'; rich.camo[2] = 'cherry';
  const back = P.loadProgress(JSON.stringify(rich));
  assert.equal(back.uniform, 'hazard'); assert.equal(back.camo[2], 'cherry'); assert.deepEqual(back.owned, ['hazard', 'cherry'], 'local cache round-trips');
  const srv = P.loadProgress(JSON.stringify({ ...rich, owned: ['hazard', 'cherry', 'toxic'] }), ['cherry']);
  assert.deepEqual(srv.owned, ['cherry'], 'the owned argument (the server) beats the save'); assert.equal(srv.uniform, 'olive'); assert.equal(srv.camo[2], 'cherry');
  assert.deepEqual(P.loadProgress('garbage', ['toxic']).owned, ['toxic']);
  P.setOwned(rich, []);
  assert.equal(rich.uniform, 'olive', 'unowned uniform taken off'); assert.equal(rich.camo[2], 'factory', 'unowned camo taken off');
  assert.equal(rich.camo[0], 'factory');

  // cloud save merge: more XP wins, ties keep the first (the incoming edit)
  const lo2 = { xp: 5 }, hi2 = { xp: 9 }, tie = { xp: 9 };
  assert.equal(P.mergeProgress(lo2, hi2), hi2); assert.equal(P.mergeProgress(hi2, lo2), hi2); assert.equal(P.mergeProgress(tie, hi2), tie);
  console.log('progress ok');
}

// ---------- economy ----------
{
  assert.equal(E.SPIN_TOTAL, 100, 'weights read as percentages');
  assert.ok(E.SPIN.every(s => (s.coins > 0) !== !!s.item), 'each segment pays coins or an item');
  for (const s of E.SPIN) if (s.item) assert.equal(P.PREMIUM[s.item].price, 0, `${s.item} is spin-only, never sold`);
  assert.deepEqual(E.pickSpin(0), { seg: 0, coins: 25, item: null, dupe: false });
  assert.equal(E.pickSpin(0.2999).seg, 0); assert.equal(E.pickSpin(0.30).seg, 1);
  assert.equal(E.pickSpin(0.9599).seg, 5); assert.deepEqual(E.pickSpin(0.96), { seg: 6, coins: 0, item: 'spud', dupe: false });
  assert.deepEqual(E.pickSpin(0.99999), { seg: 7, coins: 0, item: 'lucky', dupe: false });
  assert.deepEqual(E.pickSpin(0.97, ['spud']), { seg: 6, coins: E.DUPE_COINS, item: null, dupe: true }, 'owned item pays coins');
  for (const r of [1, 2, -1, NaN, 'x', undefined]) assert.ok(E.pickSpin(r).seg >= 0 && E.pickSpin(r).seg < E.SPIN.length, `out of range r=${r}`);
  const counts = E.SPIN.map(() => 0); for (let i = 0; i < 10000; i++) counts[E.pickSpin(i / 10000).seg]++;
  assert.deepEqual(counts, E.SPIN.map(s => s.w * 100), 'a uniform sweep lands exactly on the weights');

  const day = E.SPIN_COOLDOWN_MS, t0 = Date.UTC(2026, 0, 1);
  assert.deepEqual(E.spinState(null, t0), { ready: true, next: t0 }, 'never spun');
  assert.deepEqual(E.spinState('not a date', t0), { ready: true, next: t0 });
  assert.deepEqual(E.spinState(new Date(t0).toISOString(), t0 + 1000), { ready: false, next: t0 + day });
  assert.deepEqual(E.spinState(t0, t0 + day - 1), { ready: false, next: t0 + day });
  assert.deepEqual(E.spinState(t0, t0 + day), { ready: true, next: t0 + day }, 'ready exactly 24h later');

  assert.deepEqual(E.buyCheck('cherry', 500, []), { ok: true, price: 500 });
  assert.equal(E.buyCheck('cherry', 499, []).error, 'Not enough coins');
  assert.equal(E.buyCheck('cherry', 9999, ['cherry']).error, 'Already owned');
  assert.equal(E.buyCheck('spud', 9999, []).error, 'Not for sale', 'spin-only looks are never sold');
  for (const bad of ['nope', '__proto__', 'toString', 42, null]) assert.equal(E.buyCheck(bad, 1e9, []).error, 'Unknown item');
  assert.equal(E.buyCheck('cherry', '9999', []).error, 'Not enough coins', 'coins must be a number');
  assert.deepEqual(E.COIN_PACKS.map(p => [p.coins, p.cents]), [[500, 99], [1200, 199], [3000, 499]]);
  assert.equal(E.packById('medium').coins, 1200); assert.equal(E.packById('huge'), null);
  console.log('economy ok');
}

// ---------- ground pathfinding ----------
{
  // a wall across the middle of a 20 x 20 yard (x from -10 to 10, along z = 0) with a 2 m gap at x = 6..8
  const box = (x0, x1, z0, z1, y0 = 0, y1 = 3) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
  const nav = buildNav([box(-10, 6, -0.2, 0.2), box(8, 10, -0.2, 0.2), box(-3, -2, 5, 6, 0, 0.4), box(-3, -2, -6, -5, 2.9, 3.2)], 10);
  let x = -5, z = -5, steps = 0;
  while (Math.hypot(x + 5, z - 5) > 0.5 && steps++ < 200) {
    const p = navToward(nav, x, z, -5, 5); assert.ok(p, 'there is a way round');
    const d = Math.hypot(p.x - x, p.z - z); x += (p.x - x) / d * Math.min(d, 0.5); z += (p.z - z) / d * Math.min(d, 0.5);
    assert.ok(!(Math.abs(z) < 0.2 && (x < 6 || x > 8)), `walked through the wall at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
  assert.ok(steps < 200, 'got there through the gap');
  assert.equal(navToward(buildNav([box(-10, 10, -0.2, 0.2)], 10), -5, -5, -5, 5), null, 'sealed off: no path');
  const open = buildNav([], 10); assert.deepEqual(navToward(open, 0, 0, 0.3, 0.2), { x: 0.3, z: 0.2 }, 'same cell: straight there');
  console.log('nav ok');
}

// ---------- relay ----------

// every server runs with the account/payment env vars stripped, plus whatever a test adds
const ACCOUNT_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SITE_URL'];
const servers = [];
async function startServer(port, extra = {}) {
  const env = { ...process.env, PORT: String(port), ...extra };
  for (const k of ACCOUNT_VARS) if (!(k in extra)) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { env, stdio: 'pipe' }); servers.push(child);
  child.stderr.on('data', d => { if (!/coin packs stay off|accounts stay off|without our metadata|^\s*$/.test(d)) process.stderr.write(d); });
  await new Promise((res, rej) => { child.stdout.once('data', res); child.once('exit', c => rej(new Error(`server exited ${c}`))); });
  return child;
}
process.on('exit', () => { for (const c of servers) c.kill(); });

const PORT = 3999, base = `ws://localhost:${PORT}/ws`;
await startServer(PORT);

const open = (room, id, map = '', game = '') => new Promise((res, rej) => {
  const ws = new WebSocket(`${base}?room=${room}&id=${id}&map=${map}&game=${game}`); ws.msgs = [];
  ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'room') { ws.map = m.map; ws.game = m.game; } else ws.msgs.push(m); });
  ws.on('open', () => res(ws)); ws.on('error', rej);
});
const tick = () => new Promise(r => setTimeout(r, 100));

{
  const a = await open('test', 'aaaa1', 'yard', 'zombies');
  a.send(JSON.stringify({ v: 1, n: 'A' }));
  await tick();
  const b = await open('test', 'bbbb2', 'depot', 'gungame');
  await tick();
  assert.equal(a.map, 'yard', 'first joiner picks the map'); assert.equal(b.map, 'yard', 'later joiners get the room map');
  assert.equal(b.game, 'zombies', 'and the room game');
  assert.deepEqual(b.msgs[0], { t: 'p', k: 'aaaa1', tm: 0, pr: { v: 1, n: 'A' } }, 'newcomer gets snapshot, with the seat the server gave');
  b.send(JSON.stringify({ v: 1, n: 'B' })); b.send('not json');
  await tick();
  assert.deepEqual(a.msgs, [{ t: 'p', k: 'bbbb2', tm: 0, pr: { v: 1, n: 'B' } }], 'relay to others only, junk dropped');
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
  for (const s of [a, b, b2, other]) s.close();
  console.log('relay ok');
}

// ---------- battle royale room lock ----------
{
  const lead = await open('lockroom', 'lead1', 'yard', 'br');
  const mate = await open('lockroom', 'mate2');
  await tick();
  mate.send(JSON.stringify({ t: 'lock', on: true })); await tick(); // not the leader: ignored
  let late = await open('lockroom', 'late3'); await tick();
  assert.ok(!late.msgs.some(m => m.t === 'busy'), 'only the leader can lock');
  late.close(); await tick();
  lead.send(JSON.stringify({ t: 'lock', on: true })); await tick();
  late = await open('lockroom', 'late4'); await tick();
  assert.ok(late.msgs.some(m => m.t === 'busy'), 'a newcomer is turned away while locked');
  mate.close(); await tick();
  const back = await open('lockroom', 'mate2'); await tick();
  assert.ok(!back.msgs.some(m => m.t === 'busy'), 'a player from the match can reconnect');
  lead.send(JSON.stringify({ t: 'lock', on: false })); await tick();
  const after = await open('lockroom', 'late5'); await tick();
  assert.ok(!after.msgs.some(m => m.t === 'busy'), 'unlocked: newcomers get in again');
  for (const s of [lead, back, after, late]) s.close();
  console.log('room lock ok');
}
{
  // /rooms reports a locked room as in progress (it has to be public to be listed)
  const pubOpen = id => new Promise((res, rej) => { const ws = new WebSocket(`${base}?room=pubbr&id=${id}&game=br&pub=1`); ws.msgs = []; ws.on('message', d => ws.msgs.push(JSON.parse(d))); ws.on('open', () => res(ws)); ws.on('error', rej); });
  const lead = await pubOpen('plead1'); await tick();
  const list = async () => (await (await fetch(`http://localhost:${PORT}/rooms`)).json()).find(r => r.code === 'pubbr');
  assert.equal((await list()).busy, false, 'listed as open');
  lead.send(JSON.stringify({ t: 'lock', on: true })); await tick();
  assert.equal((await list()).busy, true, 'listed as in progress');
  lead.close(); await tick();
  console.log('rooms busy ok');
}

// ---------- /api with no env vars: off, and says so ----------
const call = async (port, method, path, { body, token, headers = {} } = {}) => {
  const r = await fetch(`http://localhost:${port}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
{
  const c = await call(PORT, 'GET', '/api/config');
  assert.equal(c.status, 200); assert.equal(c.json.accounts, false); assert.equal(c.json.payments, false); assert.match(c.json.error, /not configured/);
  for (const [m, path] of [['GET', '/api/me'], ['POST', '/api/progress'], ['POST', '/api/spin'], ['POST', '/api/buy'], ['POST', '/api/checkout'], ['POST', '/api/stripe/webhook']]) {
    const r = await call(PORT, m, path, { body: m === 'POST' ? {} : undefined, token: 'whatever' });
    assert.equal(r.status, 503, `${m} ${path} is 503 when unconfigured`); assert.match(r.json.error, /not configured/);
  }
  assert.equal((await call(PORT, 'GET', '/api/nope')).status, 404);
  console.log('api off ok');
}

// ---------- Stripe set, Supabase not: webhook signatures are still checked, nothing is sold ----------
const WHSEC = 'whsec_test_secret', stripeLocal = new Stripe('sk_test_dummy');
const signed = (event, secret = WHSEC) => { const payload = JSON.stringify(event); return { body: payload, headers: { 'stripe-signature': stripeLocal.webhooks.generateTestHeaderString({ payload, secret }), 'content-type': 'application/json' } }; };
const paidEvent = (id, metadata, extra = {}) => ({ id: 'evt_' + id, type: 'checkout.session.completed',
  data: { object: { id, object: 'checkout.session', payment_status: 'paid', amount_total: 99, currency: 'usd', metadata, ...extra } } });
{
  const port = 3997; await startServer(port, { STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WHSEC });
  assert.equal((await call(port, 'GET', '/api/config')).json.payments, false, 'no coin packs without accounts');
  const ev = paidEvent('cs_1', { uid: '11111111-1111-4111-8111-111111111111', coins: '500' });
  let r = await call(port, 'POST', '/api/stripe/webhook', { body: JSON.stringify(ev) });
  assert.equal(r.status, 400, 'no signature'); assert.equal(r.json.error, 'Bad signature');
  r = await call(port, 'POST', '/api/stripe/webhook', signed(ev, 'whsec_wrong'));
  assert.equal(r.status, 400, 'signed with the wrong secret');
  const tampered = signed(ev); tampered.body = tampered.body.replace('"500"', '"50000"');
  assert.equal((await call(port, 'POST', '/api/stripe/webhook', tampered)).status, 400, 'body changed after signing');
  r = await call(port, 'POST', '/api/stripe/webhook', signed(ev));
  assert.equal(r.status, 503, 'good signature gets past the check, then needs accounts (Stripe will retry)');
  console.log('webhook signature ok');
}

// ---------- the whole API against a mock Supabase ----------
const UA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', UB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USERS = { 'tok-a': { id: UA, email: 'a@example.com' }, 'tok-b': { id: UB, email: 'b@example.com' } };
const db = new Map(), purchases = new Set(), otp = [];
// Mirrors supabase/schema.sql: each rpc is one atomic step (JS is single-threaded, so it really is)
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
  const out = (status, obj) => res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }).end(obj === undefined ? '' : JSON.stringify(obj));
  if (req.method === 'OPTIONS') return out(204);
  if (u.pathname === '/auth/v1/user') {
    const user = req.headers.apikey === 'anon-key' && USERS[(req.headers.authorization || '').replace('Bearer ', '')];
    return user ? out(200, user) : out(401, { msg: 'bad jwt' });
  }
  if (u.pathname === '/auth/v1/otp') { otp.push({ body, redirect: u.searchParams.get('redirect_to'), apikey: req.headers.apikey }); return out(200, {}); }
  if (u.pathname === '/auth/v1/logout') return out(204);
  if (u.pathname === '/auth/v1/token') { // refresh: r-b is good once, and rotates
    if (u.searchParams.get('grant_type') !== 'refresh_token' || body.refresh_token !== 'r-b') return out(400, { error: 'invalid_grant' });
    return out(200, { access_token: 'tok-b', refresh_token: 'r-b2', expires_in: 3600 });
  }
  if (req.headers.apikey !== 'service-key' || req.headers.authorization !== 'Bearer service-key') return out(401, { message: 'service key required' });
  if (u.pathname === '/rest/v1/profiles') {
    const id = (u.searchParams.get('id') || '').replace('eq.', '');
    if (req.method === 'GET') return out(200, db.has(id) ? [db.get(id)] : []);
    if (req.method === 'POST') { if (!db.has(body.id)) db.set(body.id, { coins: 0, last_spin: null, owned: [], progress: null }); return out(201); }
    if (req.method === 'PATCH') { Object.assign(db.get(id), body); return out(204); }
  }
  const row = body && db.get(body.uid);
  if (u.pathname === '/rest/v1/rpc/claim_spin') {
    const cd = parseInt(body.cooldown) * 1000;
    if (!row || (row.last_spin && Date.now() - new Date(row.last_spin) < cd)) return out(200, []);
    row.coins += Math.max(0, body.reward_coins); row.last_spin = new Date().toISOString();
    if (body.reward_item && !row.owned.includes(body.reward_item)) row.owned.push(body.reward_item);
    return out(200, [{ coins: row.coins, last_spin: row.last_spin, owned: row.owned }]);
  }
  if (u.pathname === '/rest/v1/rpc/buy_item') {
    if (!row || !(body.price > 0) || row.coins < body.price || row.owned.includes(body.item)) return out(200, []);
    row.coins -= body.price; row.owned.push(body.item);
    return out(200, [{ coins: row.coins, owned: row.owned }]);
  }
  if (u.pathname === '/rest/v1/rpc/credit_purchase') {
    if (purchases.has(body.session_id)) return out(200, false);
    purchases.add(body.session_id); db.get(body.uid).coins += body.add_coins; return out(200, true);
  }
  out(404, { message: 'no route' });
});
await new Promise(r => mock.listen(3996, r));
const MOCK_ENV = { SUPABASE_URL: 'http://localhost:3996/', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WHSEC };
const AP = 3995; await startServer(AP, MOCK_ENV);
{
  const cfg = await call(AP, 'GET', '/api/config');
  assert.deepEqual({ ...cfg.json, packs: cfg.json.packs.length }, { accounts: true, supabaseUrl: 'http://localhost:3996', supabaseAnonKey: 'anon-key', payments: true, packs: 3, testMode: true });
  assert.ok(!JSON.stringify(cfg.json).includes('service-key') && !JSON.stringify(cfg.json).includes(WHSEC), 'secrets never sent');

  // every call checks the token with Supabase
  for (const token of [undefined, 'tok-nobody']) for (const [m, path] of [['GET', '/api/me'], ['POST', '/api/spin'], ['POST', '/api/buy'], ['POST', '/api/progress'], ['POST', '/api/checkout']]) {
    assert.equal((await call(AP, m, path, { token, body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${path} needs a real token (${token})`);
  }
  let r = await call(AP, 'GET', '/api/me', { token: 'tok-a' });
  assert.deepEqual(r.json, { email: 'a@example.com', coins: 0, owned: [], spinReady: true, nextSpin: r.json.nextSpin, progress: null }, 'profile made on first call');

  // cloud save: more XP wins both ways; shop looks you don't own are dropped; owned is never stored in the save
  const mine = P.newProgress(); mine.xp = 1000; mine.uniform = 'hazard'; mine.owned = ['hazard'];
  r = await call(AP, 'POST', '/api/progress', { token: 'tok-a', body: { progress: mine } });
  assert.equal(r.json.kept, 'yours'); assert.equal(r.json.progress.xp, 1000); assert.equal(r.json.progress.uniform, 'olive'); assert.deepEqual(r.json.progress.owned, []);
  assert.equal(db.get(UA).progress.xp, 1000); assert.ok(!('owned' in db.get(UA).progress));
  r = await call(AP, 'POST', '/api/progress', { token: 'tok-a', body: { progress: { xp: 10 } } });
  assert.equal(r.json.kept, 'cloud'); assert.equal(r.json.progress.xp, 1000); assert.equal(db.get(UA).progress.xp, 1000, 'less XP never overwrites');
  r = await call(AP, 'POST', '/api/progress', { token: 'tok-a', body: { progress: { xp: -5, wk: 'junk', loadout: [99] } } });
  assert.equal(r.json.kept, 'cloud', 'junk sanitizes to a fresh save, which loses');
  assert.equal((await call(AP, 'POST', '/api/progress', { token: 'tok-a', body: 'not json{' })).status, 400);
  assert.equal((await call(AP, 'GET', '/api/me', { token: 'tok-a' })).json.progress.xp, 1000);

  // daily spin: server picks, once per 24h, and two clicks at once only pay once
  r = await call(AP, 'POST', '/api/spin', { token: 'tok-a' });
  assert.equal(r.status, 200); const w = r.json.reward;
  assert.equal(r.json.coins, w.coins); assert.equal(r.json.spinReady, false); assert.ok(r.json.nextSpin > Date.now() + E.SPIN_COOLDOWN_MS - 60000);
  if (w.item) assert.deepEqual(r.json.owned, [w.item]);
  r = await call(AP, 'POST', '/api/spin', { token: 'tok-a' });
  assert.equal(r.status, 429); assert.equal(r.json.spinReady, false); assert.ok(r.json.nextSpin > Date.now());
  db.get(UA).last_spin = new Date(Date.now() - E.SPIN_COOLDOWN_MS - 1000).toISOString();
  const before = db.get(UA).coins;
  const both = await Promise.all([1, 2, 3].map(() => call(AP, 'POST', '/api/spin', { token: 'tok-a' })));
  assert.deepEqual(both.map(x => x.status).sort(), [200, 429, 429], 'three clicks, one spin');
  const won = both.find(x => x.status === 200).json.reward;
  assert.equal(db.get(UA).coins, before + won.coins);

  // shop: priced by the server, coins spent once, spin-only looks never sold
  Object.assign(db.get(UA), { coins: 550, owned: [] });
  r = await call(AP, 'POST', '/api/buy', { token: 'tok-a', body: { item: 'cherry', price: 1 } });
  assert.equal(r.status, 200); assert.deepEqual(r.json, { coins: 50, owned: ['cherry'] }, 'client price ignored');
  assert.equal((await call(AP, 'POST', '/api/buy', { token: 'tok-a', body: { item: 'cherry' } })).json.error, 'Already owned');
  assert.equal((await call(AP, 'POST', '/api/buy', { token: 'tok-a', body: { item: 'carbon' } })).json.error, 'Not enough coins');
  assert.equal((await call(AP, 'POST', '/api/buy', { token: 'tok-a', body: { item: 'spud' } })).status, 409, 'spin-only');
  assert.equal((await call(AP, 'POST', '/api/buy', { token: 'tok-a', body: { item: 'coins' } })).status, 400);
  Object.assign(db.get(UA), { coins: 900 });
  const buys = await Promise.all(['hazard', 'carbon'].map(item => call(AP, 'POST', '/api/buy', { token: 'tok-a', body: { item } })));
  assert.equal(buys.filter(x => x.status === 200).length, 1, '900 coins buys 600 or 700, not both'); assert.ok(db.get(UA).coins >= 0);
  // a bought camo survives the cloud save; another user's purchases are theirs alone
  const camoSave = P.newProgress(); camoSave.xp = 2000; camoSave.camo[0] = 'cherry';
  assert.equal((await call(AP, 'POST', '/api/progress', { token: 'tok-a', body: { progress: camoSave } })).json.progress.camo[0], 'cherry');
  assert.equal((await call(AP, 'POST', '/api/progress', { token: 'tok-b', body: { progress: camoSave } })).json.progress.camo[0], 'factory');

  // checkout validates the pack before talking to Stripe
  assert.equal((await call(AP, 'POST', '/api/checkout', { token: 'tok-a', body: { pack: 'free' } })).status, 400);

  // webhook: credits once per session, only for paid sessions with our metadata
  Object.assign(db.get(UA), { coins: 0 });
  const ev = paidEvent('cs_test_1', { uid: UA, pack: 'small', coins: '500' });
  r = await call(AP, 'POST', '/api/stripe/webhook', signed(ev));
  assert.equal(r.status, 200); assert.equal(r.json.credited, true); assert.equal(db.get(UA).coins, 500);
  r = await call(AP, 'POST', '/api/stripe/webhook', signed(ev));
  assert.equal(r.json.credited, false, 'replayed event'); assert.equal(db.get(UA).coins, 500, 'credited once');
  r = await call(AP, 'POST', '/api/stripe/webhook', signed(paidEvent('cs_test_2', { uid: UA, coins: '500' }, { payment_status: 'unpaid' })));
  assert.equal(r.json.ignored, true, 'unpaid');
  r = await call(AP, 'POST', '/api/stripe/webhook', signed(paidEvent('cs_test_3', { uid: UA, coins: '99999' })));
  assert.equal(r.json.ignored, true, 'coins must match a pack'); assert.equal(db.get(UA).coins, 500);
  assert.equal((await call(AP, 'POST', '/api/stripe/webhook', signed(paidEvent('cs_test_4', { uid: UA, coins: '500' }), 'whsec_nope'))).status, 400);
  console.log('api ok');
}

// ---------- headless browser ----------
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { console.log('browser checks skipped: playwright not installed'); }
if (chromium) {
  const browser = await chromium.launch();
  const page = async (port, opts = {}) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', locale: 'en-US', ...opts }), pg = await ctx.newPage();
    pg.errors = []; pg.on('pageerror', e => pg.errors.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pg.errors.push(m.text()); });
    // three.js comes from cdnjs; THREE_JS=/path/to/three.min.js (r128) serves a local copy where that host is blocked
    if (process.env.THREE_JS) await pg.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ path: process.env.THREE_JS, contentType: 'text/javascript' }));
    return pg;
  };
  const probe = await page(PORT);
  await probe.goto(`http://localhost:${PORT}/`);
  const hasThree = await probe.evaluate(() => typeof THREE !== 'undefined'); await probe.context().close();
  if (!hasThree) console.log('browser checks skipped: three.js did not load (offline? set THREE_JS=/path/to/three.min.js)');
  if (hasThree) try {
    // no env vars: the game is exactly as before, no account UI anywhere
    const pg = await page(PORT);
    await pg.goto(`http://localhost:${PORT}/`);
    await pg.waitForFunction(() => window.__spud?.state === 'menu', null, { timeout: 15000 });
    await pg.waitForLoadState('networkidle');
    for (const id of ['acct', 'spinOv', 'coinOv']) assert.equal(await pg.isHidden('#' + id), true, `#${id} hidden with no env vars`);
    assert.equal(await pg.isVisible('#playBtn'), true);
    await pg.click('#armBtn'); await pg.click('#armTab1');
    assert.ok(!(await pg.textContent('#armBody')).includes('Shop'), 'no shop in the Armory');
    await pg.click('#armTab2'); assert.ok(!(await pg.textContent('#armBody')).includes('Shop'));
    await pg.click('#armDone');
    await pg.click('#playBtn'); await pg.waitForFunction(() => window.__spud.state !== 'menu');
    assert.deepEqual(pg.errors, [], 'no page errors');
    console.log('browser (accounts off) ok');

    // accounts on (mock Supabase): magic link, balance, spin, buy, sign out
    const b = await page(AP);
    await b.goto(`http://localhost:${AP}/`);
    await b.waitForSelector('#acct:not([hidden]) #acctOut:not([hidden])');
    await b.fill('#acctEmail', 'b@example.com'); await b.click('#acctSend');
    await b.waitForFunction(() => /Check b@example.com/.test(document.getElementById('acctMsg').textContent));
    assert.deepEqual(otp.at(-1), { body: { email: 'b@example.com', create_user: true }, redirect: `http://localhost:${AP}/`, apikey: 'anon-key' });
    Object.assign(db.get(UB), { coins: 700, last_spin: null, owned: [] });
    await b.goto('about:blank'); // the link opens as a fresh page load
    await b.goto(`http://localhost:${AP}/#access_token=tok-b&refresh_token=r-b&expires_in=3600&token_type=bearer&type=magiclink`);
    await b.waitForSelector('#acctIn:not([hidden])');
    await b.waitForFunction(() => document.getElementById('acctCoins').textContent === '700 coins');
    assert.equal(await b.evaluate(() => location.hash), '', 'tokens cleared from the address bar');
    assert.equal(await b.textContent('#acctEmailOut'), 'b@example.com');
    assert.equal(await b.isVisible('#coinBtn'), true, 'coin packs shown with Stripe configured');
    await b.click('#coinBtn'); assert.equal(await b.locator('#coinPacks button').count(), 3); assert.equal(await b.isVisible('#coinTest'), true);
    await b.click('#coinDone');

    await b.click('#spinBtn'); await b.click('#spinGo');
    await b.waitForFunction(() => /won|already own/.test(document.getElementById('spinMsg').textContent));
    assert.match(await b.textContent('#spinWhen'), /Next free spin in 2[34]:\d\d:\d\d/);
    assert.equal(await b.isDisabled('#spinGo'), true);
    const coinsNow = db.get(UB).coins;
    await b.click('#spinDone');
    assert.equal(await b.textContent("#acctCoins"), `${coinsNow.toLocaleString("en-US")} coins`);

    db.get(UB).coins = Math.max(coinsNow, 600);
    await b.reload(); await b.waitForSelector('#acctIn:not([hidden])');
    await b.click('#armBtn'); await b.click('#armTab1');
    await b.click('#armBody [data-key="hazard"]'); await b.click('#armBuy');
    await b.waitForFunction(() => /bought and equipped/.test(document.getElementById('armMsg').textContent));
    assert.equal(await b.evaluate(() => window.__spud.prog.uniform), 'hazard');
    assert.ok(db.get(UB).owned.includes('hazard'));
    assert.equal(await b.getAttribute('#armBody [data-key="hazard"]', 'aria-pressed'), 'true');
    await b.click('#armDone');
    await b.waitForTimeout(4500); // the batched cloud push
    assert.equal(db.get(UB).progress.uniform, 'hazard', 'equipped look saved to the cloud');

    await b.click('#acctOutBtn');
    await b.waitForSelector('#acctOut:not([hidden])');
    assert.equal(await b.evaluate(() => window.__spud.prog.uniform), 'olive', 'shop looks come off when signed out');
    // an expired session refreshes itself on load (rotating the refresh token); a dead one signs out
    await b.evaluate(() => localStorage.setItem('spudbrawl-auth', JSON.stringify({ access_token: 'stale', refresh_token: 'r-b', expires_at: 1 })));
    await b.reload(); await b.waitForSelector('#acctIn:not([hidden])');
    assert.deepEqual(await b.evaluate(() => JSON.parse(localStorage.getItem('spudbrawl-auth'))).then(s => [s.access_token, s.refresh_token]), ['tok-b', 'r-b2']);
    await b.evaluate(() => localStorage.setItem('spudbrawl-auth', JSON.stringify({ access_token: 'stale', refresh_token: 'used', expires_at: 1 })));
    await b.reload(); await b.waitForFunction(() => /session ended/.test(document.getElementById('acctMsg').textContent));
    assert.equal(await b.isVisible('#acctOut'), true);
    assert.deepEqual(b.errors, [], 'no page errors');
    console.log('browser (accounts on) ok');
  } finally { await browser.close(); }
  else await browser.close();
}
mock.close();
console.log('all ok');
process.exit(0);
