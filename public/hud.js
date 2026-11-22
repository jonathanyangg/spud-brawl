// The HUD: text and toasts, the kill feed and scoreboard, XP and unlock banners, the battle royale minimap and squad list.
import { AMMO_OF, HEALS, MAX_SLOTS, RARITY, TEAM_NAMES, THROWABLES, WEAPONS, WNAMES, keyName } from './config.js';
import { LIMIT, boxes, currentMap } from './world.js';
import { sfx } from './audio.js';
import * as P from './progress.js';
import { $, V3, clamp } from './util.js';
import {
  AIM, CH, FLIGHT, Z, binds, brAlive, camera, carries, currentSpread, dressVM, ents, fixSlots, flightT, game, gunsFor, host, isUp, knifeFull,
  lootName, nadesOn, nearChest, nearGun, now, oneLife, player, prog, rarCss, rayWorld, refreshVM, sameTeam, saveProgress, scoreLimit, slotIdx,
  spec, squadmates, squadsOn, state, storm, stormText, teamScore, teamsOn, zLeft, zoomed
} from './game.js';
import { net } from './netsync.js';

// ---------- HUD ----------
const txtCache = new Map();
// screen effects other modules set: flash (a flashbang's white-out), dmg and dmgFrom (the red arrow toward who hit you)
export const fx = { flash: 0, dmg: 0, dmgFrom: null };
// the scoreboard order, worked out again after scoresChanged()
let leaderCache = null;
export function scoresChanged() { leaderCache = null; }
export function setText(id, s) { if (txtCache.get(id) !== s) { txtCache.set(id, s); $(id).textContent = s; } }
let hitT = 0, toastTimer = 0;
export function hitMarker(head, isKill) { hitT = head ? 0.35 : 0.22; $('hitm').classList.toggle('kill', !!isKill || head); }
export function toast(html, name, head) {
  const el = $('toast'); el.innerHTML = html;
  const em = el.querySelector('em'); if (em) em.textContent = name + (head ? ' \u00b7 headshot' : '');
  el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}
export function addFeed(src, t, wname, head) {
  if (state !== 'playing') return;
  const li = document.createElement('li');
  const nm = e => { const b = document.createElement('b'); b.textContent = e.name; b.style.color = e.color; return b; };
  const self = !src || src === t;
  if (!self) li.appendChild(nm(src));
  const w = document.createElement('span'); w.className = 'w'; w.textContent = wname === 'Storm' ? 'storm' : self ? 'suicide' : wname; li.appendChild(w);
  if (head) { const h = document.createElement('span'); h.className = 'hs'; h.textContent = 'HEAD'; li.appendChild(h); }
  li.appendChild(nm(t));
  if ((src && src.isPlayer) || t.isPlayer) li.className = 'me';
  const feed = $('feed'); feed.prepend(li);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => li.classList.add('fade'), 5000); setTimeout(() => li.remove(), 5600);
}
function sorted() { return ents.filter(e => !e.zombie).sort((a, b) => (teamsOn() ? (a.team | 0) - (b.team | 0) : 0) || b.kills - a.kills || a.deaths - b.deaths); }
// the three chips at the top: label and value for each, by game type
function chips(a, av, b, bv, c, cv) { setText('sYouL', a); setText('sYou', String(av)); setText('sLeadL', b); setText('sLead', String(bv)); setText('sGoalL', c); setText('sGoal', String(cv)); }
export function updateScoreTop() {
  if (game === 'zombies') return chips('Kills', player.kills, 'Wave', Z.wave || '-', 'Left', zLeft());
  if (game === 'aim') {
    return chips('Hits', AIM.hits, 'Accuracy', AIM.shots ? Math.round(100 * AIM.hits / AIM.shots) + '%' : '-', 'Time', Math.max(0, Math.ceil(AIM.end - now)));
  }
  if (oneLife()) return chips('Alive', brAlive().length, 'Storm', stormText(), 'Kills', player.kills);
  if (teamsOn()) { const s = teamScore(), me = player.team | 0; return chips(`${TEAM_NAMES[me]} (you)`, s[me], TEAM_NAMES[1 - me], s[1 - me], 'To win', scoreLimit()); }
  if (!leaderCache) leaderCache = sorted();
  const lead = leaderCache.find(e => !e.isPlayer) || leaderCache[0];
  chips('You', player.kills, 'Top rival', lead && !lead.isPlayer ? `${lead.name} ${lead.kills}` : '-', 'To win', scoreLimit());
}
const levelOf = e => e.isPlayer ? P.level(prog) : e.remote && !e.netbot ? e.lv : '\u2013';
export function buildTable(tbl) {
  tbl.innerHTML = '<tr><th>#</th><th>Player</th><th>Lv</th><th>Kills</th><th>Deaths</th></tr>';
  sorted().forEach((e, i) => {
    const tr = document.createElement('tr'); if (e.isPlayer) tr.className = 'me';
    const c = (t) => { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); return td; };
    c(i + 1); const n = c(''); const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = e.color; n.appendChild(dot); n.appendChild(document.createTextNode(e.name));
    c(levelOf(e)); c(e.kills); c(e.deaths); tbl.appendChild(tr);
  });
}
export function updateHUD(dt) {
  const p = player, w = p.guns[p.weapon];
  setText('hpnum', String(Math.ceil(p.hp)));
  const hpb = $('hpbar'); hpb.style.width = p.hp + '%'; hpb.style.backgroundColor = p.hp < 35 ? 'var(--ketchup)' : p.hp < 65 ? 'var(--butter)' : 'var(--herb)';
  setText('wname', w.name); $('wname').style.color = oneLife() && w.kind !== 'melee' ? rarCss(w.rar) : '';
  const spare = carries(p) && AMMO_OF[w.id] ? p.res[AMMO_OF[w.id]] | 0 : w.mag; // battle royale shows what you carry
  const ammo = $('ammo'), s = w.kind === 'melee' ? 'melee' : `${p.ammo[p.weapon]}|${spare}`;
  if (txtCache.get('ammo') !== s) { txtCache.set('ammo', s); ammo.innerHTML = w.kind === 'melee' ? '&ndash;' : `${p.ammo[p.weapon]} <small>/ ${spare}</small>`; }
  // each slot shows the key you bound to it
  const br = oneLife(), sk = i => keyName(binds['w' + (i + 1)] || '');
  if (br) fixSlots(p);
  const slotKey = [br, ...p.guns.map(g => g.name + (g.rar | 0) + '@' + g.slot), ...[1, 2, 3, 4].map(i => binds['w' + i])].join();
  if (txtCache.get('slots') !== slotKey) {
    txtCache.set('slots', slotKey); $('slots').textContent = '';
    const list = br ? [...Array(MAX_SLOTS).keys()].map(s => slotIdx(p, s)) : p.guns.map((g, i) => i);
    list.forEach((i, s) => {
      const g = p.guns[i], sp = document.createElement('span'); sp.dataset.i = i;
      if (!g) { sp.className = 'empty'; sp.textContent = `${sk(s)} –`; $('slots').append(sp); return; }
      sp.textContent = s < 4 ? `${sk(s)} ${g.name}` : g.name;
      if (br && g.kind !== 'melee') { // battle royale: each slot wears its gun's rarity color
        const R = RARITY[g.rar | 0];
        sp.classList.add('rar'); sp.style.setProperty('--rar', rarCss(g.rar)); sp.title = R.name;
        const r = document.createElement('small'); r.textContent = R.name; sp.append(r);
      }
      $('slots').append(sp);
    });
  }
  [...$('slots').children].forEach(el => el.classList.toggle('on', +el.dataset.i === p.weapon));
  $('nade').hidden = !nadesOn();
  if (oneLife()) { // battle royale: frags you've found
    setText('nade', `${keyName(binds.nade)} \u00b7 ` + (p.frags > 0 ? `${p.frags} frag${p.frags > 1 ? 's' : ''}` : 'no frags')); $('nade').classList.toggle('ready', p.frags > 0 && now >= p.nadeReady);
  } else {
    const nd = Math.ceil(p.nadeReady - now), nn = (THROWABLES[p.nade] || THROWABLES.frag).name;
    setText('nade', `${keyName(binds.nade)} \u00b7 ` + (nd > 0 ? `${nn} in ${nd}s` : `${nn} ready`)); $('nade').classList.toggle('ready', nd <= 0);
  }
  updateSquadHud();
  fx.flash = Math.max(0, fx.flash - dt); $('flashFx').style.opacity = clamp(fx.flash, 0, 1);
  $('stunFx').style.opacity = now < p.stunUntil ? clamp((p.stunUntil - now) / 1.5, 0, 0.8) : 0;
  if (game === 'zombies' || game === 'aim' || oneLife()) updateScoreTop();
  $('reloadTxt').hidden = !p.reloading;
  if (p.reloading) {
    const T = Math.max(0.01, p.reloadEnd - p.reloadStart);
    $('reloadFill').style.width = (100 * clamp((now - p.reloadStart) / T, 0, 1)).toFixed(1) + '%';
    setText('reloadLeft', Math.max(0, p.reloadEnd - now).toFixed(1) + 's');
  }
  $('scope').hidden = !(zoomed && w.scope && p.alive && camera.fov < 40);
  // crosshair gap matches the real spread cone
  const px = (host.clientHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  $('cross').style.setProperty('--gap', (3 + currentSpread(p) * px).toFixed(1) + 'px');
  $('cross').style.opacity = zoomed || !p.alive || p.drop ? 0 : 1;
  updateBRHud();
  hitT = Math.max(0, hitT - dt); $('hitm').style.opacity = hitT > 0 ? Math.min(1, hitT * 6) : 0;
  const since = now - p.lastHurt;
  $('hurt').style.opacity = clamp((since < 0.5 ? 0.6 * (1 - since / 0.5) : 0) + (p.alive && p.hp < 35 ? 0.25 + 0.1 * Math.sin(now * 5) : 0), 0, 1);
  fx.dmg = Math.max(0, fx.dmg - dt * 0.9);
  if (fx.dmgFrom && fx.dmg > 0) {
    const rx = fx.dmgFrom.pos.x - p.pos.x, rz = fx.dmgFrom.pos.z - p.pos.z, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const ang = Math.atan2(rx * cy - rz * sy, -rx * sy - rz * cy);
    $('dmgdir').style.transform = `rotate(${ang}rad)`;
  }
  $('dmgdir').style.opacity = fx.dmg;
}

// ---------- XP and unlocks ----------
export const run = { xp: 0, unlocks: [], startLv: 1 }; // this match, for the Match over screen
export function resetRun() { run.xp = 0; run.unlocks = []; run.startLv = P.level(prog); }
export function gainXP(xp, opts) {
  const r = P.award(prog, xp, opts);
  run.xp += xp; run.unlocks.push(...r.unlocks);
  saveProgress(); updateProfile();
  return r;
}
export function awardKill(wname, head) {
  const w = WNAMES.indexOf(wname), p = player;
  p.streak++;
  let xp = P.XP.kill + (head ? P.XP.head : 0) + (w >= WEAPONS.length ? P.XP.frag : 0) + P.XP.streak * clamp(p.streak - 1, 0, 5);
  if (game === 'zombies') xp = Math.round(xp * 0.4); // zombies come in crowds
  const r = gainXP(xp, { kill: { w, head } });
  xpPop(xp, p.streak >= 3 ? `${p.streak} streak` : head ? 'headshot' : '');
  if (r.levelUp || r.unlocks.length) showBanner(r.levelUp, r.unlocks);
}
let xpPopT = 0;
function xpPop(xp, why) {
  const el = $('xpPop'); el.textContent = `+${xp} XP` + (why ? ` \u00b7 ${why}` : '');
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  clearTimeout(xpPopT); xpPopT = setTimeout(() => el.classList.remove('go'), 1200);
}
// level-ups and unlocks queue up and show one at a time under the score
const bannerQ = []; let bannerBusy = false;
function showBanner(levelUp, unlocks) {
  if (levelUp) bannerQ.push({ big: `Level ${levelUp}`, un: unlocks });
  else for (const u of unlocks) bannerQ.push({ big: 'Unlocked', un: [u] });
  if (!bannerBusy) nextBanner();
}
function nextBanner() {
  const el = $('banner'), b = bannerQ.shift();
  if (!b) { bannerBusy = false; el.classList.remove('show'); return; }
  bannerBusy = true; el.textContent = '';
  const big = document.createElement('div'); big.className = 'big'; big.textContent = b.big; el.append(big);
  for (const u of b.un.slice(0, 3)) {
    const d = document.createElement('div'); d.className = 'un';
    const sm = document.createElement('small'); sm.textContent = 'New';
    d.append(sm, document.createTextNode(u)); el.append(document.createElement('br'), d);
  }
  if (b.un.length > 3) { const d = document.createElement('div'); d.className = 'un'; d.textContent = `+${b.un.length - 3} more in the Armory`; el.append(document.createElement('br'), d); }
  el.classList.add('show');
  if (b.big.startsWith('Level')) sfx.kill();
  setTimeout(() => { el.classList.remove('show'); setTimeout(nextBanner, 350); }, 2600);
}
export function clearBanners() { bannerQ.length = 0; bannerBusy = false; $('banner').classList.remove('show'); }
export function fillLevelBar(barId, textId) {
  const li = P.levelInfo(prog.xp);
  $(barId).style.width = li.need ? (100 * li.into / li.need).toFixed(1) + '%' : '100%';
  if (textId) $(textId).textContent = li.need ? `${li.into} / ${li.need} XP` : 'Max level';
  return li;
}
export function updateProfile() {
  const lv = P.level(prog);
  $('pLv').textContent = lv; $('pLv').setAttribute('aria-label', `Level ${lv}`);
  $('pLvName').textContent = `Level ${lv}`;
  fillLevelBar('pXpBar', 'pXp');
  $('armNew').hidden = !prog.fresh; $('armNew').textContent = `${prog.fresh} new`;
  setText('sLv', String(lv));
}
// the Armory changed the loadout: looks change now; in a match, weapons change when you next respawn
export function loadoutChanged() {
  if (state === 'menu') { player.guns = gunsFor(player); player.ammo = player.guns.map(w => w.mag); player.weapon = 0; refreshVM(); }
  player.corpseSrc = null;
  dressVM(); saveProgress(); updateProfile();
}

// ---------- minimap (battle royale) ----------
export const MM = { base: null, map: null, at: 0, S: 360, big: false };
export function toggleBigMap(on = !MM.big) {
  on = on && oneLife() && state === 'playing';
  if (on === MM.big) return;
  MM.big = on; MM.S = on ? 900 : 360; MM.base = null; MM.at = 0;
  const el = $('minimap'); el.width = el.height = MM.S; el.classList.toggle('big', on);
}
function mmBase() {
  const S = MM.S, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), k = S / (2 * LIMIT);
  g.fillStyle = '#5f7448'; g.fillRect(0, 0, S, S);
  const list = boxes.filter(b => b.max.y > 0.3 && (b.max.x - b.min.x) * (b.max.z - b.min.z) < LIMIT * LIMIT).sort((a, b) => a.max.y - b.max.y);
  for (const b of list) {
    const t = clamp(b.max.y / 9, 0, 1);
    g.fillStyle = `rgb(${Math.round(110 + 110 * t)},${Math.round(104 + 100 * t)},${Math.round(88 + 90 * t)})`;
    g.fillRect((b.min.x + LIMIT) * k, (b.min.z + LIMIT) * k, Math.max(1, (b.max.x - b.min.x) * k), Math.max(1, (b.max.z - b.min.z) * k));
  }
  MM.base = c; MM.map = currentMap;
}
function drawMinimap() {
  const el = $('minimap'); el.hidden = !oneLife() || state === 'menu';
  if (MM.big && (el.hidden || state !== 'playing')) toggleBigMap(false);
  if (el.hidden || now < MM.at) return;
  MM.at = now + 0.1;
  if (MM.map !== currentMap || !MM.base) mmBase();
  const S = MM.S, g = el.getContext('2d'), k = S / (2 * LIMIT), X = x => (x + LIMIT) * k, u = MM.big ? 1.4 : 1; // u: marker size on the big map
  g.clearRect(0, 0, S, S); g.drawImage(MM.base, 0, 0);
  if (FLIGHT.on) {
    g.setLineDash([10 * u, 8 * u]); g.strokeStyle = 'rgba(255,240,200,.8)'; g.lineWidth = 3 * u;
    g.beginPath(); g.moveTo(X(FLIGHT.ax), X(FLIGHT.az)); g.lineTo(X(FLIGHT.bx), X(FLIGHT.bz)); g.stroke(); g.setLineDash([]);
    const t = clamp(flightT(), 0, 1); g.fillStyle = '#c8955a';
    g.beginPath(); g.arc(X(FLIGHT.ax + (FLIGHT.bx - FLIGHT.ax) * t), X(FLIGHT.az + (FLIGHT.bz - FLIGHT.az) * t), 7 * u, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#ffc83d';
  for (const c of CH.list) if (!c.open && Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 45) g.fillRect(X(c.x) - 3 * u, X(c.z) - 3 * u, 6 * u, 6 * u);
  if (storm.on) {
    g.fillStyle = 'rgba(150,60,220,.45)'; g.beginPath(); g.rect(0, 0, S, S); g.arc(X(storm.x), X(storm.z), Math.max(0, storm.r * k), 0, Math.PI * 2, true); g.fill('evenodd');
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2 * u; g.beginPath(); g.arc(X(storm.tx), X(storm.tz), Math.max(0, storm.tr * k), 0, Math.PI * 2); g.stroke();
  }
  for (const e of squadmates()) { // your squad
    g.fillStyle = e === spec.who ? '#fff6e0' : '#5fd068'; g.strokeStyle = '#1b1208'; g.lineWidth = 2 * u;
    g.beginPath(); g.arc(X(e.pos.x), X(e.pos.z), 5 * u, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (player.alive) {
    const px = X(player.pos.x), pz = X(player.pos.z), fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const a = 11 * u, b = 6 * u, w = 7 * u;
    g.fillStyle = '#fff6e0'; g.strokeStyle = '#1b1208'; g.lineWidth = 2 * u; g.beginPath();
    g.moveTo(px + fx * a, pz + fz * a); g.lineTo(px - fx * b - fz * w, pz - fz * b + fx * w); g.lineTo(px - fx * b + fz * w, pz - fz * b - fx * w); g.closePath(); g.stroke(); g.fill();
  }
}
// the prompt under the crosshair, the heals you carry, the heal bar and the minimap
const _lv = new V3(), _lf = new V3();
function lookedAtGun() {
  camera.getWorldDirection(_lf);
  let best = null, bs = Infinity;
  for (const it of CH.items) {
    if (it.kind !== 'gun') continue;
    _lv.set(it.x, it.y + 0.45, it.z).sub(camera.position);
    const d = _lv.length(); if (d > 15 || d < 0.3) continue;
    const off = _lv.divideScalar(d).angleTo(_lf); // how far off the crosshair, allowing for the gun's size up close
    if (off < Math.max(0.05, 0.55 / d) && off * d < bs) { bs = off * d; best = it; }
  }
  if (best) { _lv.set(best.x, best.y + 0.45, best.z).sub(camera.position); const d = _lv.length(); if (rayWorld(camera.position, _lv.divideScalar(d), d) < d - 0.4) return null; } // behind a wall
  return best;
}
// your squad down the left: name and health, crossed out once they're out
let squadAt = 0;
function updateSquadHud() {
  const el = $('squadHud'), on = squadsOn() && state === 'playing' && player.team !== undefined;
  el.hidden = !on; if (!on || now < squadAt) return; squadAt = now + 0.25;
  const mates = ents.filter(e => e !== player && !e.zombie && sameTeam(e, player) && (!e.remote || e.netbot || e.m === net.m));
  el.textContent = '';
  const head = document.createElement('small'); head.textContent = `Squad ${(player.team | 0) + 1}`; el.append(head);
  for (const e of [player, ...mates]) {
    const up = e === player ? player.alive : isUp(e), row = document.createElement('div'); row.className = 'sqRow' + (up ? '' : ' out') + (e === player ? ' me' : '');
    const n = document.createElement('b'); n.textContent = e === player ? `${e.name} (you)` : e.name;
    const bar = document.createElement('span'), fill = document.createElement('i'); fill.style.width = (up ? clamp(e.hp || 0, 0, 100) : 0) + '%'; bar.append(fill);
    row.append(n, bar); el.append(row);
  }
}
function updateBRHud() {
  const p = player, br = oneLife() && p.alive; let s = '';
  if (br && p.drop) {
    const d = p.drop, t = flightT(), kj = keyName(binds.jump);
    if (d.stage === 'ride') s = t < FLIGHT.inStart ? 'Heading for the island…' : `${kj} · Jump (pushed out in ${Math.max(0, Math.ceil((FLIGHT.inEnd - t) * FLIGHT.dur))}s)`;
    else if (d.stage === 'fall') s = `${kj} · Open glider`;
  } else if (br) {
    const ku = keyName(binds.use), c = nearChest(p);
    if (c) s = `${ku} · Open chest`;
    else {
      const it = nearGun(p);
      if (it) s = knifeFull(p) ? `Slots full · hold a gun to swap for ${lootName(it)}` : `${ku} · ${p.guns.length < MAX_SLOTS ? 'Pick up' : 'Swap for'} ${lootName(it)}`;
    }
  }
  setText('prompt', s); $('prompt').hidden = !s;
  // the gun under your crosshair, up to 15 m away: its rarity, name and what it does
  const lk = br && !p.drop ? lookedAtGun() : null, tag = $('lookTag');
  tag.hidden = !lk;
  if (lk) {
    const W = WEAPONS[lk.w], R = RARITY[lk.r | 0];
    tag.style.setProperty('--rar', rarCss(lk.r));
    setText('lookName', `${R.name} ${W.name}`);
    setText('lookStats', `${Math.round(W.dmg * R.dmg)} dmg${W.pellets > 1 ? ' × ' + W.pellets : ''} · ${W.mag} mag · ${(W.reload * R.reload).toFixed(1)}s reload`);
  }
  $('heals').hidden = !oneLife();
  if (oneLife()) setText('heals', `${keyName(binds.bandage)} · ${p.heals.bandage | 0} bandage${p.heals.bandage === 1 ? '' : 's'} · ${keyName(binds.medkit)} · ${p.heals.medkit | 0} medkit${p.heals.medkit === 1 ? '' : 's'}`);
  const u = p.useT; $('useBar').hidden = !u;
  if (u) { setText('useName', `${HEALS[u.type].name}…`); $('useFill').style.width = (100 * clamp((now - u.start) / (u.end - u.start), 0, 1)).toFixed(1) + '%'; }
  drawMinimap();
}
