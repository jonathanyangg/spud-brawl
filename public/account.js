// Accounts on the client: email magic-link sign-in (Supabase Auth over fetch), coin balance, the free daily spin,
// coin packs (Stripe Checkout) and cloud save. All of it stays hidden unless GET /api/config says accounts are on.
// The client only asks: the server decides rewards, prices and balances (api.js).
import * as P from './progress.js';
import { SPIN, SPIN_TOTAL, spinLabel } from './economy.js';
import { BOARDS } from './boards.js';

const $ = id => document.getElementById(id);
const AUTH_KEY = 'spudbrawl-auth';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let cfg = null, session = null, me = null, prog = null, hooks = {}, synced = false, pushT = 0, wheelRot = 0, spinning = false;
// the Armory reads this to show prices and Buy buttons
export const shop = { get on() { return !!me; }, get coins() { return me ? me.coins : 0; }, buy };

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const fmtCoins = n => `${Number(n).toLocaleString()} coins`;
function say(t) { $('acctMsg').textContent = t || ''; }

// ---------- session (Supabase Auth REST) ----------
function loadSession() { try { const s = JSON.parse(localStorage.getItem(AUTH_KEY)); if (s?.access_token && s.refresh_token) return s; } catch (e) {} return null; }
function saveSession(s) { session = s; try { if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s)); else localStorage.removeItem(AUTH_KEY); } catch (e) {} }
const authFetch = (path, init = {}) => fetch(cfg.supabaseUrl + path, { ...init, headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json', ...init.headers } });
// one refresh at a time: Supabase rotates the refresh token on every use
let refreshing = null;
const refresh = () => (refreshing ||= doRefresh().finally(() => { refreshing = null; }));
async function doRefresh() {
  if (!session) return false;
  try {
    const r = await authFetch('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) });
    if (r.ok) { const s = await r.json(); saveSession({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Date.now() / 1000 + (s.expires_in || 3600) }); return true; }
    if (r.status >= 400 && r.status < 500) signedOut('Your session ended. Sign in again.'); // refresh token revoked or used up
  } catch (e) {}
  return false;
}
async function token() {
  if (session && session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session?.access_token;
}
// call our own /api with the access token; one retry after a refresh if the token was stale
async function api(path, body, retried) {
  const t = await token(); if (!t) throw new Error('Sign in first');
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !retried && await refresh()) return api(path, body, true);
  const out = await r.json().catch(() => ({}));
  if (r.status === 401) signedOut('Your session ended. Sign in again.');
  if (!r.ok) throw Object.assign(new Error(out.error || 'Something went wrong, try again'), { status: r.status, data: out });
  return out;
}
// the magic link comes back as #access_token=...&refresh_token=... (or #error_description=...)
function takeRedirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error_description')) return false;
  history.replaceState(null, '', location.pathname + location.search); // keep tokens out of the address bar and history
  if (h.get('access_token') && h.get('refresh_token')) {
    saveSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: +h.get('expires_at') || Date.now() / 1000 + (+h.get('expires_in') || 3600) });
  } else say(`Sign-in link failed: ${h.get('error_description')}. Send a new one.`);
  return true;
}
function takeCheckout() {
  const q = new URLSearchParams(location.search), c = q.get('checkout'); if (!c) return null;
  q.delete('checkout'); history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  return c;
}

// ---------- sign in / out ----------
async function sendLink() {
  const email = $('acctEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Type your email address.'); $('acctEmail').focus(); return; }
  $('acctSend').disabled = true; say('Sending…');
  try {
    const back = encodeURIComponent(location.origin + location.pathname);
    const r = await authFetch(`/auth/v1/otp?redirect_to=${back}`, { method: 'POST', body: JSON.stringify({ email, create_user: true }) });
    if (r.ok) say(`Check ${email} for a sign-in link. Open it in this browser.`);
    else if (r.status === 429) say('Too many emails. Wait a minute, then try again.');
    else say('Could not send the link. Check the address and try again.');
  } catch (e) { say('Could not reach the sign-in server. Try again.'); }
  $('acctSend').disabled = false;
}
async function signOut() {
  const t = session?.access_token;
  signedOut('Signed out. Your progress stays on this device.');
  if (t) authFetch('/auth/v1/logout', { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => {});
}
function signedOut(msg) {
  const had = !!me || !!session;
  saveSession(null); me = null; synced = false;
  if (prog.owned.length) { P.setOwned(prog, []); hooks.onProgress(); } // shop looks belong to the account
  if (had) { render(); if (msg) say(msg); }
}

// ---------- profile and cloud save ----------
async function loadMe() {
  me = await api('/api/me');
  if (!synced) {
    // first sync this page load: the save with more XP wins, on both sides
    const r = await api('/api/progress', { progress: prog });
    // capped: the cloud took only part of this device's XP; keep playing from ours, the cloud catches up over time
    if (r.kept === 'capped') P.setOwned(prog, me.owned);
    else Object.assign(prog, P.loadProgress(JSON.stringify(r.progress), me.owned));
    synced = true;
    if (r.kept === 'cloud') say('Loaded your cloud save.');
  } else P.setOwned(prog, me.owned);
  hooks.onProgress(); render();
}
// game.js calls this after every local save; pushes are batched
export function progressSaved() {
  if (!me || !synced) return;
  clearTimeout(pushT); pushT = setTimeout(push, 4000);
}
function push(keepalive = false) {
  clearTimeout(pushT); pushT = 0;
  if (!me || !synced || !session) return;
  if (!keepalive) { api('/api/progress', { progress: prog }).catch(() => {}); return; } // refreshes the token if it expired
  // the page is closing: no time to refresh, send what we have and let it outlive the page
  fetch('/api/progress', { method: 'POST', keepalive: true, headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ progress: prog }) }).catch(() => {});
}

// ---------- shop ----------
async function buy(item) {
  try {
    const r = await api('/api/buy', { item });
    me.coins = r.coins; me.owned = r.owned; P.setOwned(prog, r.owned); render();
    return { ok: true };
  } catch (e) { return { error: e.message }; }
}
async function checkout(pack, btn) {
  btn.disabled = true; $('coinMsg').textContent = 'Opening checkout…';
  try { const r = await api('/api/checkout', { pack }); location.assign(r.url); }
  catch (e) { $('coinMsg').textContent = e.message; btn.disabled = false; }
}

// ---------- UI ----------
function render() {
  $('acctOut').hidden = !!me; $('acctIn').hidden = !me;
  if (!me) return;
  $('acctName').textContent = hooks.name() || 'Soldier';
  $('acctEmailOut').textContent = me.email;
  $('acctCoins').textContent = fmtCoins(me.coins);
  $('coinBtn').hidden = !cfg.payments;
  tick();
}
function untilText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function tick() {
  if (!me) return;
  const left = me.spinReady ? 0 : me.nextSpin - Date.now();
  if (left <= 0) me.spinReady = true;
  $('spinBtn').textContent = me.spinReady ? 'Free spin' : `Spin in ${untilText(left)}`;
  $('spinBtn').classList.toggle('ready', me.spinReady);
  if (!spinning) {
    $('spinGo').disabled = !me.spinReady;
    $('spinWhen').textContent = me.spinReady ? 'Your free spin is ready.' : `Next free spin in ${untilText(left)}`;
  }
}

function buildWheel() {
  const n = SPIN.length, step = 360 / n, wheel = $('wheel');
  const cols = ['#ffc83d', '#e5432d', '#8cc63f', '#f09a3e', '#5aa6e8', '#b05cd6', '#f6d26b', '#3f9b4c'];
  wheel.style.background = `conic-gradient(${SPIN.map((s, i) => `${cols[i % cols.length]} ${i * step}deg ${(i + 1) * step}deg`).join(',')})`;
  SPIN.forEach((s, i) => {
    const lab = el('span', 'wlab', s.item ? P.LOOKS[s.item].name : String(s.coins));
    lab.style.transform = `rotate(${(i + 0.5) * step}deg)`; // a spoke from the hub, text at the rim
    wheel.append(lab);
  });
  // spins are free, but the odds are still published
  const odds = $('spinOdds');
  for (const s of SPIN) odds.append(el('li', null, `${spinLabel(s)}${s.item ? ' (exclusive look)' : ''}: ${Math.round(1000 * s.w / SPIN_TOTAL) / 10}%`));
}
function openSpin() { $('spinMsg').textContent = ''; tick(); $('spinOv').hidden = false; ($('spinGo').disabled ? $('spinDone') : $('spinGo')).focus(); }
function closeSpin() { if (spinning) return; $('spinOv').hidden = true; $('spinBtn').focus(); }
async function doSpin() {
  if (spinning || !me?.spinReady) return;
  spinning = true; $('spinGo').disabled = true; $('spinMsg').textContent = ''; $('spinWhen').textContent = 'Spinning…';
  let r;
  try { r = await api('/api/spin', {}); }
  catch (e) {
    spinning = false; $('spinMsg').textContent = e.message;
    if (e.data?.nextSpin) { me.spinReady = false; me.nextSpin = e.data.nextSpin; }
    tick(); return;
  }
  const step = 360 / SPIN.length, center = (r.reward.seg + 0.5) * step;
  const jitter = (Math.random() - 0.5) * step * 0.6; // land somewhere inside the segment, not dead center
  wheelRot += 5 * 360 + ((((-center - jitter - wheelRot) % 360) + 360) % 360);
  const wheel = $('wheel');
  wheel.style.transition = reduceMotion ? 'none' : 'transform 4s cubic-bezier(.15,.7,.2,1)';
  wheel.style.transform = `rotate(${wheelRot}deg)`;
  setTimeout(() => {
    spinning = false;
    me.coins = r.coins; me.owned = r.owned; me.spinReady = r.spinReady; me.nextSpin = r.nextSpin;
    P.setOwned(prog, r.owned); hooks.onProgress();
    const w = r.reward;
    $('spinMsg').textContent = w.item ? `You won the ${P.LOOKS[w.item].name} ${P.PREMIUM[w.item].kind}! Equip it in the Armory.`
      : w.dupe ? `You already own that look, so here are ${fmtCoins(w.coins)}.` : `You won ${fmtCoins(w.coins)}!`;
    render(); $('spinDone').focus();
  }, reduceMotion ? 50 : 4100);
}
function openCoins() {
  const list = $('coinPacks'); list.textContent = ''; $('coinMsg').textContent = '';
  for (const p of cfg.packs) {
    const b = el('button', 'btn ghost pack'); b.type = 'button';
    b.append(el('b', null, fmtCoins(p.coins)), el('span', null, `$${(p.cents / 100).toFixed(2)}`));
    b.addEventListener('click', () => checkout(p.id, b));
    list.append(b);
  }
  $('coinTest').hidden = !cfg.testMode;
  $('coinOv').hidden = false; list.querySelector('button')?.focus();
}
function closeCoins() { $('coinOv').hidden = true; $('coinBtn').focus(); }

// ---------- leaderboards ----------
// anyone can look; signed in, your runs go up (your best stays) and your row is marked
export const boards = { get on() { return !!cfg?.accounts; }, get signedIn() { return !!me; } };
// after an Aim Trainer or Zombies run: { best, bestExtra, rank, newBest }, or null when signed out or it failed
export async function postScore(board, score, extra, name) {
  if (!me) return null;
  try { return await api('/api/score', { board, score, extra, name }); } catch (e) { return null; }
}
let lbBoard = 'aim', lbReq = 0;
async function showBoard(board) {
  lbBoard = board; const req = ++lbReq, B = BOARDS[board];
  for (const b of $('lbTabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === board));
  $('lbHow').textContent = board === 'aim' ? 'Most hits in 60 seconds; accuracy breaks ties.' : 'Highest wave reached; kills break ties.';
  const list = $('lbList'); list.textContent = ''; $('lbMine').textContent = 'Loading…';
  let out;
  try {
    const t = me ? await token() : null;
    const r = await fetch(`/api/leaderboard?board=${board}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
    out = await r.json(); if (!r.ok) throw new Error(out.error);
  } catch (e) { if (req === lbReq) $('lbMine').textContent = 'Could not load the leaderboard. Try again in a moment.'; return; }
  if (req !== lbReq) return; // switched tabs meanwhile
  out.top.forEach((r, i) => {
    const li = el('li', r.me ? 'me' : null);
    const sc = el('span', null, B.score(r.score)); sc.append(el('small', null, B.extra(r.extra)));
    li.append(el('i', null, `${i + 1}.`), el('b', null, r.name), sc); list.append(li);
  });
  if (!out.top.length) list.append(el('li', 'empty', 'No scores yet. Be the first.'));
  $('lbMine').textContent = !me ? `Sign in to put your ${B.name} runs on the board.`
    : !out.mine ? `You have no ${B.name} score yet. Play a run while signed in.`
    : `Your best: ${B.score(out.mine.score)}, ${B.extra(out.mine.extra)}${out.mine.rank ? ` (#${out.mine.rank})` : ''}.`;
}
function openBoards() { $('lbOv').hidden = false; showBoard(lbBoard); $('lbDone').focus(); }
function closeBoards() { $('lbOv').hidden = true; $('lbBtn').focus(); }

// After a paid checkout the webhook credits coins a moment later: poll a few times.
async function awaitCoins(before) {
  for (let i = 0; i < 8 && me; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try { const m = await api('/api/me'); me.coins = m.coins; render(); if (m.coins > before) { say(`Payment received: you now have ${fmtCoins(m.coins)}.`); return; } } catch (e) {}
  }
  say('Payment received. Your coins can take a minute to show up; reload the page if they have not.');
}

// onProgress: prog changed under the game (cloud save, owned looks); name: the current callsign
export async function initAccount(p, h) {
  prog = p; hooks = h;
  try { const r = await fetch('/api/config'); cfg = r.ok ? await r.json() : null; } catch (e) { cfg = null; }
  if (!cfg?.accounts) {
    if (prog.owned.length) { P.setOwned(prog, []); hooks.onProgress(); } // no accounts on this server: no shop looks
    return;
  }
  $('acct').hidden = false;
  $('acctSend').addEventListener('click', sendLink);
  $('acctEmail').addEventListener('keydown', e => { if (e.key === 'Enter') sendLink(); });
  $('acctOutBtn').addEventListener('click', signOut);
  $('nameIn').addEventListener('input', render); // the panel shows your callsign
  $('spinBtn').addEventListener('click', openSpin);
  $('spinGo').addEventListener('click', doSpin);
  $('spinDone').addEventListener('click', closeSpin);
  $('coinBtn').addEventListener('click', openCoins);
  $('coinDone').addEventListener('click', closeCoins);
  $('lbBtn').addEventListener('click', openBoards);
  $('lbDone').addEventListener('click', closeBoards);
  for (const b of $('lbTabs').querySelectorAll('button')) b.addEventListener('click', () => showBoard(b.dataset.v));
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if (!$('spinOv').hidden) { e.preventDefault(); closeSpin(); } else if (!$('coinOv').hidden) { e.preventDefault(); closeCoins(); }
    else if (!$('lbOv').hidden) { e.preventDefault(); closeBoards(); }
  });
  addEventListener('pagehide', () => { if (pushT) push(true); }); // don't lose the last few seconds of XP
  // a magic link opened in this same tab only changes the hash
  addEventListener('hashchange', () => { if (!me && takeRedirect() && session) loadMe().catch(e => say(`Could not load your account: ${e.message}`)); });
  buildWheel();
  setInterval(tick, 1000);
  takeRedirect();
  const paid = takeCheckout();
  session = session || loadSession();
  if (!session) { if (prog.owned.length) { P.setOwned(prog, []); hooks.onProgress(); } render(); return; }
  try {
    await loadMe();
    if (paid === 'success') { say('Payment received. Adding your coins…'); awaitCoins(me.coins); }
    else if (paid === 'cancel') say('Checkout cancelled. You were not charged.');
  } catch (e) { if (session) say(`Could not load your account: ${e.message}`); render(); }
}
