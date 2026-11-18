// The Armory: your loadout (3 weapons + 1 throwable), a uniform, a camo per weapon, and up to two attachments per gun.
// Edits the progress object in place and calls back so the game can save and re-dress the player.
// Signed in, it also lists coin-shop looks: owned ones equip like any other, the rest show a price and a Buy button.
import { WEAPONS, THROWABLES } from './config.js';
import { LOOKS, UNIFORMS, CAMOS, ATTACH, MAX_ATTACH, PREMIUM, premiumOf, level, uniformUnlocked, camoUnlocked, attachUnlocked, camoNeed, weaponUnlocked, throwableUnlocked } from './progress.js';
import { lookSwatch } from './skins.js';
import { shop } from './account.js';

const $ = id => document.getElementById(id);
const TABS = ['Loadout', 'Soldier', ...WEAPONS.map(w => w.name)];
let prog = null, changed = () => {}, closed = () => {}, tab = 0, inMatch = false, pending = null; // pending: shop item awaiting Buy

export function initArmory(p, { onChange, onClose }) {
  prog = p; changed = onChange; closed = onClose;
  const tabs = $('armTabs');
  TABS.forEach((t, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.dataset.i = i;
    b.setAttribute('role', 'tab'); b.id = 'armTab' + i; b.setAttribute('aria-controls', 'armBody');
    b.addEventListener('click', () => { tab = i; pending = null; render(); });
    tabs.append(b);
  });
  tabs.addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
    e.preventDefault(); tab = (tab + d + TABS.length) % TABS.length; pending = null; render(); $('armTab' + tab).focus();
  });
  $('armDone').addEventListener('click', closeArmory);
  document.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('armory').hidden) { e.preventDefault(); closeArmory(); } });
}
// inMatch: opened from the pause screen; weapon changes wait for the next respawn
export function openArmory(fromMatch = false) {
  inMatch = fromMatch; pending = null;
  prog.fresh = 0; changed(); // seen it: clear the "new" count
  $('armMsg').textContent = '';
  render(); $('armory').hidden = false; $('armTab' + tab).focus();
}
export function closeArmory() { $('armory').hidden = true; closed(); }

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
// a look's chip and name, no behavior
function lookBtn(id, on) {
  const b = el('button', 'sw'); b.type = 'button'; b.dataset.key = id;
  const chip = el('span', 'chipsw'), url = lookSwatch(id);
  if (url) chip.style.backgroundImage = `url(${url})`; else chip.classList.add('factory');
  b.append(chip, el('span', 'swname', LOOKS[id].name));
  b.setAttribute('aria-pressed', String(on));
  return b;
}
function swatchBtn(id, on, lockText, pick) {
  const b = lookBtn(id, on);
  if (lockText) { b.classList.add('locked'); b.setAttribute('aria-disabled', 'true'); b.append(el('span', 'swlock', lockText)); }
  b.addEventListener('click', () => {
    if (lockText) { $('armMsg').textContent = `${LOOKS[id].name} is locked: ${lockText}.`; return; }
    pick(); $('armMsg').textContent = ''; changed(); render(); refocus(id);
  });
  return b;
}
function refocus(key) { const b = $('armBody').querySelector(`[data-key="${key}"]`); if (b) b.focus(); }
function render() {
  [...$('armTabs').children].forEach((b, i) => { b.setAttribute('aria-selected', String(i === tab)); b.tabIndex = i === tab ? 0 : -1; });
  $('armBody').setAttribute('aria-labelledby', 'armTab' + tab);
  const body = $('armBody'); body.textContent = '';
  const lv = level(prog);
  if (tab === 0) return renderLoadout(body, lv);
  if (tab === 1) {
    body.append(el('h3', null, 'Uniform'), el('p', 'help', `Level ${lv}. Higher levels unlock more uniforms.`));
    const grid = el('div', 'swatches');
    for (const [id, need] of UNIFORMS) grid.append(swatchBtn(id, prog.uniform === id, uniformUnlocked(prog, id) ? '' : `Level ${need}`, () => { prog.uniform = id; }));
    body.append(grid);
    shopSection(body, 'uniform', id => prog.uniform === id, id => { prog.uniform = id; });
    body.append(el('p', 'help', `${prog.matches} matches played · ${prog.wins} won`));
    return;
  }
  const wi = tab - 2;
  body.append(el('h3', null, 'Camo'), el('p', 'help', `${prog.wk[wi]} kills · ${prog.wh[wi]} headshots with the ${WEAPONS[wi].name}`));
  const grid = el('div', 'swatches');
  for (const [id] of CAMOS) grid.append(swatchBtn(id, prog.camo[wi] === id, camoUnlocked(prog, wi, id) ? '' : camoNeed(prog, wi, id), () => { prog.camo[wi] = id; }));
  body.append(grid);
  shopSection(body, 'camo', id => prog.camo[wi] === id, id => { prog.camo[wi] = id; });
  if (WEAPONS[wi].noAtt) return;
  body.append(el('h3', null, 'Attachments'), el('p', 'help', `Equip up to ${MAX_ATTACH}.`));
  const list = el('div', 'atts');
  for (const id in ATTACH) {
    const a = ATTACH[id], on = prog.att[wi].includes(id), open = attachUnlocked(prog, id);
    const b = el('button', 'att'); b.type = 'button'; b.dataset.key = id; b.setAttribute('aria-pressed', String(on));
    const txt = el('span', 'atttxt'); txt.append(el('b', null, a.name), el('small', null, a.desc));
    b.append(el('span', 'tick', on ? '✓' : ''), txt, el('span', 'swlock', open ? (on ? 'Equipped' : '') : `Level ${a.level}`));
    if (!open) { b.classList.add('locked'); b.setAttribute('aria-disabled', 'true'); }
    b.addEventListener('click', () => {
      if (!open) { $('armMsg').textContent = `${a.name} unlocks at level ${a.level}.`; return; }
      if (on) prog.att[wi] = prog.att[wi].filter(x => x !== id);
      else if (prog.att[wi].length >= MAX_ATTACH) { $('armMsg').textContent = `${MAX_ATTACH} attachments max. Take one off first.`; return; }
      else prog.att[wi].push(id);
      $('armMsg').textContent = ''; changed(); render(); refocus(id);
    });
    list.append(b);
  }
  body.append(list);
}

// Coin-shop looks (signed in only). Prices and balances come from the server; Buy asks it to spend the coins.
function shopSection(body, kind, isOn, pick) {
  if (!shop.on) return;
  body.append(el('h3', null, kind === 'camo' ? 'Shop camos' : 'Shop uniforms'),
    el('p', 'help', `You have ${shop.coins.toLocaleString()} coins.${kind === 'camo' ? ' A bought camo fits every weapon.' : ''}`));
  const grid = el('div', 'swatches');
  for (const id of premiumOf(kind)) {
    const price = PREMIUM[id].price;
    if (prog.owned.includes(id) || !price) { grid.append(swatchBtn(id, isOn(id), prog.owned.includes(id) ? '' : 'Daily spin only', () => pick(id))); continue; }
    const b = lookBtn(id, false); // not owned: clicking offers to buy, never equips
    b.classList.toggle('pending', pending === id);
    b.append(el('span', 'price', `${price.toLocaleString()} coins`));
    b.addEventListener('click', () => { pending = id; $('armMsg').textContent = ''; render(); if ($('armBuy')) $('armBuy').focus(); else refocus(id); });
    grid.append(b);
  }
  body.append(grid);
  if (pending && PREMIUM[pending]?.kind === kind && !prog.owned.includes(pending)) body.append(buyBar(pending, pick));
}
function buyBar(id, pick) {
  const price = PREMIUM[id].price, name = `${LOOKS[id].name} ${PREMIUM[id].kind}`, bar = el('div', 'buybar');
  if (shop.coins < price) {
    bar.append(el('span', null, `${name} costs ${price.toLocaleString()} coins. You have ${shop.coins.toLocaleString()}.`));
    return bar;
  }
  const buy = el('button', 'btn small', `Buy for ${price.toLocaleString()}`); buy.type = 'button'; buy.id = 'armBuy';
  const cancel = el('button', 'btn ghost small', 'Cancel'); cancel.type = 'button';
  bar.append(el('span', null, `Buy the ${name}? You have ${shop.coins.toLocaleString()} coins.`), buy, cancel);
  cancel.addEventListener('click', () => { pending = null; render(); refocus(id); });
  buy.addEventListener('click', async () => {
    buy.disabled = cancel.disabled = true; $('armMsg').textContent = 'Buying…';
    const r = await shop.buy(id);
    if (r.error) { $('armMsg').textContent = r.error; buy.disabled = cancel.disabled = false; return; }
    pending = null; pick(id); changed(); render(); refocus(id);
    $('armMsg').textContent = `${name} bought and equipped.`;
  });
  return bar;
}

// a checkbox-like row: title, description, a tick when on, a lock note when locked
function optionBtn(key, title, desc, on, lockText, click) {
  const b = el('button', 'att'); b.type = 'button'; b.dataset.key = key; b.setAttribute('aria-pressed', String(on));
  const txt = el('span', 'atttxt'); txt.append(el('b', null, title), el('small', null, desc));
  b.append(el('span', 'tick', on ? '\u2713' : ''), txt, el('span', 'swlock', lockText || (on ? 'Equipped' : '')));
  if (lockText) { b.classList.add('locked'); b.setAttribute('aria-disabled', 'true'); }
  b.addEventListener('click', () => {
    if (lockText) { $('armMsg').textContent = `${title} unlocks at ${lockText.toLowerCase()}.`; return; }
    if (click() === false) return;
    $('armMsg').textContent = inMatch ? 'Weapon changes apply when you next respawn.' : ''; changed(); render(); refocus(key);
  });
  return b;
}
const DESC = { SMG: 'Fast and light, short range', Shotgun: 'Nine pellets, deadly up close', Sniper: 'Scoped, two-shot body, one-shot head',
  AR: 'Accurate auto at any range', RPG: 'One rocket, big splash. Rocket-jump at your own risk', Knife: 'One swing, quick feet' };
const TDESC = { frag: 'Explodes after a short fuse', stun: 'Slows movement and aim for a few seconds', flash: 'Blinds anyone looking at it' };
function renderLoadout(body, lv) {
  body.append(el('h3', null, 'Weapons'), el('p', 'help', `Carry up to 3. Keys 1, 2 and 3 follow this order: ${prog.loadout.map(i => WEAPONS[i].name).join(', ')}.` +
    (inMatch ? ' In a match, changes apply when you next respawn.' : '')));
  const list = el('div', 'atts');
  WEAPONS.forEach((w, i) => {
    const on = prog.loadout.includes(i);
    list.append(optionBtn('w' + i, w.name, DESC[w.name] || '', on, weaponUnlocked(prog, i) ? '' : `Level ${w.level}`, () => {
      if (on) {
        if (prog.loadout.length <= 1) { $('armMsg').textContent = 'Keep at least one weapon.'; return false; }
        prog.loadout = prog.loadout.filter(x => x !== i);
      } else if (prog.loadout.length >= 3) { $('armMsg').textContent = 'You carry 3 weapons. Take one off first.'; return false; }
      else prog.loadout.push(i);
    }));
  });
  body.append(list, el('h3', null, 'Equipment'), el('p', 'help', 'One throwable, on the equipment key.'));
  const eq = el('div', 'atts');
  for (const id in THROWABLES) {
    const t = THROWABLES[id];
    eq.append(optionBtn('t' + id, t.name, TDESC[id], prog.nade === id, throwableUnlocked(prog, id) ? '' : `Level ${t.level}`, () => { prog.nade = id; }));
  }
  body.append(eq);
}
