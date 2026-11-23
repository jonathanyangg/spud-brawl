// Accounts, coins, the daily spin, the shop, Stripe and cloud saves: everything under /api.
// Nothing here trusts the client: the caller's Supabase token is checked on every call, rewards and prices are
// decided here, and every write uses the service-role key through atomic Postgres functions (supabase/schema.sql).
// With no env vars set, /api/config says so and every other route answers 503; the game runs as before.
import { randomBytes, randomInt } from 'node:crypto';
import { loadProgress, mergeProgress, capGain, unionEv } from './public/progress.js';
import { pickSpin, spinState, SPIN_COOLDOWN_MS, COIN_PACKS, packById, buyCheck } from './public/economy.js';
import { BOARDS, BOARD_TOP, scoreCheck, boardName } from './public/boards.js';

const env = process.env;
const SB_URL = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const ANON = (env.SUPABASE_ANON_KEY || '').trim(), SERVICE = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const WEBHOOK_SECRET = (env.STRIPE_WEBHOOK_SECRET || '').trim();
export const accountsOn = !!(SB_URL && ANON && SERVICE);
// stripe is only loaded when a key is set, so a server without one runs exactly the code it ran before
const stripe = env.STRIPE_SECRET_KEY ? new (await import('stripe')).default(env.STRIPE_SECRET_KEY.trim()) : null;
// selling coins needs somewhere to put them (accounts) and a way to hear about payments (webhook secret)
export const paymentsOn = !!(stripe && WEBHOOK_SECRET && accountsOn);
if (SB_URL && ANON && !SERVICE) console.warn('SUPABASE_SERVICE_ROLE_KEY is missing: accounts stay off');
if (paymentsOn && !env.SITE_URL) console.warn('SITE_URL is not set: Stripe return links use the Host header of each request. Set it to your public URL, like https://spud-brawl.onrender.com');
if (stripe && !paymentsOn) console.warn('Stripe key set, but coin packs stay off until Supabase and STRIPE_WEBHOOK_SECRET are set too');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONFIGURED = { error: 'Accounts are not configured on this server' };
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const send = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(obj));

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req, 64 * 1024);
  try { const o = JSON.parse(raw.toString() || '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {}
  throw new HttpError(400, 'Bad JSON');
}

// ---------- Supabase over plain fetch ----------
// New-style secret keys (sb_secret_...) are not JWTs and go only in the apikey header; legacy JWT keys also go in Authorization.
const serviceHeaders = () => ({ apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { authorization: `Bearer ${SERVICE}` }), 'content-type': 'application/json' });
async function sb(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SB_URL}${path}`, { method, headers: { ...serviceHeaders(), ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const rpc = (fn, args) => sb(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });

// Auth getUser: the only proof of who is calling. Returns { id, email } or throws 401.
async function caller(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Sign in first');
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${m[1]}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new HttpError(401, 'Session expired, sign in again');
  const u = await r.json();
  if (!UUID.test(u?.id || '')) throw new HttpError(401, 'Session expired, sign in again');
  return { id: u.id, email: String(u.email || '') };
}
// The signup trigger makes profiles; this covers anyone it missed.
async function profile(uid) {
  const q = `/rest/v1/profiles?id=eq.${uid}&select=coins,last_spin,owned,progress`;
  let rows = await sb(q);
  if (!rows.length) { await sb('/rest/v1/profiles', { method: 'POST', body: { id: uid }, prefer: 'resolution=ignore-duplicates,return=minimal' }); rows = await sb(q); }
  const p = rows[0]; if (!p) throw new Error('profile missing after insert');
  return { coins: p.coins | 0, last_spin: p.last_spin, owned: Array.isArray(p.owned) ? p.owned : [], progress: p.progress };
}
const spinInfo = lastSpin => { const s = spinState(lastSpin, Date.now()); return { spinReady: s.ready, nextSpin: s.next }; };
// stored progress, cleaned with the same rules the client uses; owned always comes from the profile, never the save
const cleanSave = (progress, owned) => loadProgress(JSON.stringify(progress ?? null), owned);
// at: when the XP bucket was last drawn on (see capGain); kept with the save, never sent back
const forStorage = ({ owned, ...save }, at) => ({ ...save, at });

// ---------- leaderboards ----------
// Scores come from the player's own game, so this is a light check: a signed-in player, a possible score, a run token
// handed out when the run started (used once, and old enough for that score), and not more often than a run could end.
// Each player keeps one row per board, their best.
const SCORE_GAP_MS = 15000, lastScore = new Map(); // user id + board -> when they last posted
// user id + board -> { token, at }: one live run each, so a new run replaces the last and the map stays small.
// RUN_TIME_SCALE only lets the tests shorten the minimum run times.
const runs = new Map(), RUN_SCALE = Number(env.RUN_TIME_SCALE) > 0 ? Number(env.RUN_TIME_SCALE) : 1;
async function topScores(board) {
  const rows = await sb(`/rest/v1/scores?board=eq.${board}&select=user_id,name,score,extra&order=score.desc,extra.desc,updated_at.asc&limit=${BOARD_TOP}`);
  return rows.map(r => ({ name: r.name, score: r.score | 0, extra: r.extra | 0, id: r.user_id }));
}
const publicRows = (rows, uid) => rows.map(({ id, ...r }) => ({ ...r, ...(uid && id === uid ? { me: true } : {}) }));
async function leaderboard(req, res, url) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' });
  if (!accountsOn) return send(res, 503, NOT_CONFIGURED);
  const board = url.searchParams.get('board') || '';
  if (!Object.hasOwn(BOARDS, board)) return send(res, 400, { error: 'Unknown leaderboard' });
  let user = null; // signed in: mark your own row, and send your best even if it's off the list
  if (req.headers.authorization) { try { user = await caller(req); } catch (e) { if (!(e instanceof HttpError)) throw e; } }
  const top = await topScores(board);
  let mine = null;
  if (user) {
    const r = (await sb(`/rest/v1/scores?board=eq.${board}&user_id=eq.${user.id}&select=score,extra`))[0];
    if (r) { const i = top.findIndex(t => t.id === user.id); mine = { score: r.score | 0, extra: r.extra | 0, rank: i >= 0 ? i + 1 : null }; }
  }
  return send(res, 200, { board, top: publicRows(top, user?.id), mine });
}

// ---------- routes ----------
const routes = {
  'GET /api/me': async (req, user) => {
    const p = await profile(user.id);
    return { email: user.email, coins: p.coins, owned: p.owned, ...spinInfo(p.last_spin), progress: p.progress ? cleanSave(p.progress, p.owned) : null };
  },
  // cloud save, both ways: send yours, get back whichever has more XP (and the cloud keeps that one).
  // XP comes from the player's game, so it can only climb so fast (capGain); kept: 'capped' when yours got trimmed
  'POST /api/progress': async (req, user) => {
    const body = await readJson(req), p = await profile(user.id);
    const mine = cleanSave(body.progress, p.owned), cloud = p.progress ? cleanSave(p.progress, p.owned) : null;
    const ev = unionEv(mine, cloud); // event looks from either side are kept whichever save wins
    if (cloud && mergeProgress(mine, cloud) === cloud) {
      if (ev.length > cloud.ev.length) { cloud.ev = ev; await sb(`/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', body: { progress: forStorage(cloud, p.progress?.at) }, prefer: 'return=minimal' }); }
      return { progress: cloud, kept: 'cloud' };
    }
    const r = capGain(mine, cloud, p.progress?.at, Date.now(), p.owned), at = r.at, capped = r.capped;
    const save = ev.length > r.save.ev.length ? { ...r.save, ev } : r.save;
    await sb(`/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', body: { progress: forStorage(save, Math.round(at)) }, prefer: 'return=minimal' });
    return { progress: save, kept: capped ? 'capped' : 'yours' };
  },
  'POST /api/spin': async (req, user) => {
    const p = await profile(user.id), st = spinInfo(p.last_spin);
    if (!st.spinReady) throw new HttpError(429, 'Your free spin is not ready yet', st);
    const reward = pickSpin(randomInt(0, 2 ** 32) / 2 ** 32, p.owned);
    const rows = await rpc('claim_spin', { uid: user.id, reward_coins: reward.coins, reward_item: reward.item, cooldown: `${SPIN_COOLDOWN_MS / 1000} seconds` });
    if (!rows?.length) throw new HttpError(429, 'Your free spin is not ready yet', spinInfo(Date.now())); // lost a race with another click
    return { reward, coins: rows[0].coins, owned: rows[0].owned, ...spinInfo(rows[0].last_spin) };
  },
  'POST /api/buy': async (req, user) => {
    const { item } = await readJson(req), p = await profile(user.id);
    const check = buyCheck(item, p.coins, p.owned);
    if (check.error) throw new HttpError(check.error === 'Unknown item' ? 400 : 409, check.error);
    const rows = await rpc('buy_item', { uid: user.id, item, price: check.price });
    if (!rows?.length) throw new HttpError(409, 'Not enough coins, or already owned');
    return { coins: rows[0].coins, owned: rows[0].owned };
  },
  // a run starts: its token, which the score must bring back
  'POST /api/run': async (req, user) => {
    const { board } = await readJson(req);
    if (!Object.hasOwn(BOARDS, board)) throw new HttpError(400, 'Unknown leaderboard');
    const t = Date.now(), token = randomBytes(18).toString('base64url');
    runs.set(`${user.id}:${board}`, { token, at: t });
    if (runs.size > 5000) for (const [k, v] of runs) if (t - v.at > BOARDS[k.slice(k.indexOf(':') + 1)].ttl) runs.delete(k);
    return { run: token };
  },
  'POST /api/score': async (req, user) => {
    const { board, score, extra = 0, name, run } = await readJson(req);
    const bad = scoreCheck(board, score, extra);
    if (bad) throw new HttpError(400, bad);
    const key = `${user.id}:${board}`, t = Date.now(), live = runs.get(key);
    // the token for this player and board, once: a wrong or reused one (or none) doesn't count
    if (!live || typeof run !== 'string' || run !== live.token || t - live.at > BOARDS[board].ttl) throw new HttpError(400, 'No run to post this score for');
    runs.delete(key);
    if (t - live.at < BOARDS[board].minMs(score) * RUN_SCALE) throw new HttpError(400, 'That run was too quick for this score');
    if (t - (lastScore.get(key) || 0) < SCORE_GAP_MS) throw new HttpError(429, 'Too many scores, try again in a moment');
    lastScore.set(key, t);
    if (lastScore.size > 5000) for (const [k, v] of lastScore) if (t - v > SCORE_GAP_MS) lastScore.delete(k);
    await profile(user.id); // scores reference the profile
    const rows = await rpc('submit_score', { uid: user.id, b: board, nm: boardName(name), s: score, x: extra });
    const r = rows?.[0]; if (!r) throw new Error('submit_score returned nothing');
    return { board, best: r.best | 0, bestExtra: r.best_extra | 0, rank: Number(r.rank) || null, newBest: r.best === score && r.best_extra === extra };
  },
  'POST /api/checkout': async (req, user) => {
    if (!paymentsOn) throw new HttpError(503, 'Payments are not configured on this server');
    const pack = packById((await readJson(req)).pack);
    if (!pack) throw new HttpError(400, 'Unknown coin pack');
    await profile(user.id); // purchases reference the profile, so make sure it exists before taking money
    const site = siteUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: pack.cents, product_data: { name: `${pack.coins} Spud Brawl coins` } } }],
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata: { uid: user.id, pack: pack.id, coins: String(pack.coins) }, // set here, signed by Stripe on the way back
      success_url: `${site}/?checkout=success`,
      cancel_url: `${site}/?checkout=cancel`,
    });
    return { url: session.url };
  },
};
// SITE_URL pins the redirect host; otherwise use the host this request came in on (Render sets x-forwarded-proto)
function siteUrl(req) {
  if (env.SITE_URL) return env.SITE_URL.trim().replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${req.headers.host}`;
}

// Stripe calls this after payment. Raw body + signature check, then credit once per checkout session.
async function webhook(req, res) {
  if (!stripe || !WEBHOOK_SECRET) return send(res, 503, { error: 'Payments are not configured on this server' });
  const raw = await readBody(req, 512 * 1024);
  let event;
  try { event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'] || '', WEBHOOK_SECRET); }
  catch { return send(res, 400, { error: 'Bad signature' }); }
  const s = event.data?.object;
  const paidEvent = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
  if (!paidEvent || s?.payment_status !== 'paid') return send(res, 200, { received: true, ignored: true });
  if (!accountsOn) return send(res, 503, NOT_CONFIGURED); // Stripe retries for days, so nothing is lost while this is fixed
  const uid = s.metadata?.uid, coins = Number(s.metadata?.coins);
  if (!UUID.test(uid || '') || !COIN_PACKS.some(p => p.coins === coins)) {
    console.error('webhook: session without our metadata', s.id); return send(res, 200, { received: true, ignored: true });
  }
  const credited = await rpc('credit_purchase', { session_id: s.id, uid, add_coins: coins, paid: s.amount_total ?? null, cur: s.currency ?? null });
  return send(res, 200, { received: true, credited });
}

// Handles any /api/... request.
export async function handleApi(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/api/config') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' });
      if (!accountsOn) return send(res, 200, { accounts: false, payments: false, ...NOT_CONFIGURED });
      return send(res, 200, { accounts: true, supabaseUrl: SB_URL, supabaseAnonKey: ANON, payments: paymentsOn, packs: paymentsOn ? COIN_PACKS : [],
        testMode: paymentsOn && env.STRIPE_SECRET_KEY.trim().startsWith('sk_test_') });
    }
    if (path === '/api/leaderboard') return await leaderboard(req, res, new URL(req.url, 'http://x'));
    if (path === '/api/stripe/webhook') return req.method === 'POST' ? await webhook(req, res) : send(res, 405, { error: 'Use POST' });
    const route = routes[`${req.method} ${path}`];
    if (!route) return send(res, 404, { error: 'Not found' });
    if (!accountsOn) return send(res, 503, NOT_CONFIGURED);
    return send(res, 200, await route(req, await caller(req)));
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
    console.error('api', path, e);
    return send(res, 500, { error: 'Something went wrong, try again' });
  }
}
