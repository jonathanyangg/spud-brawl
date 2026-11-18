// The Armory: pick a uniform, a camo per gun, and up to two attachments per gun.
// Edits the progress object in place and calls back so the game can save and re-dress the player.
import { WEAPONS } from './config.js';
import { LOOKS, UNIFORMS, CAMOS, ATTACH, MAX_ATTACH, level, uniformUnlocked, camoUnlocked, attachUnlocked, camoNeed } from './progress.js';
import { lookSwatch } from './skins.js';

const $ = id => document.getElementById(id);
const TABS = ['Soldier', ...WEAPONS.map(w => w.name)];
let prog = null, changed = () => {}, closed = () => {}, tab = 0;

export function initArmory(p, { onChange, onClose }) {
  prog = p; changed = onChange; closed = onClose;
  const tabs = $('armTabs');
  TABS.forEach((t, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.dataset.i = i;
    b.setAttribute('role', 'tab'); b.id = 'armTab' + i; b.setAttribute('aria-controls', 'armBody');
    b.addEventListener('click', () => { tab = i; render(); });
    tabs.append(b);
  });
  tabs.addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
    e.preventDefault(); tab = (tab + d + TABS.length) % TABS.length; render(); $('armTab' + tab).focus();
  });
  $('armDone').addEventListener('click', closeArmory);
  document.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('armory').hidden) { e.preventDefault(); closeArmory(); } });
}
export function openArmory() {
  prog.fresh = 0; changed(); // seen it: clear the "new" count
  $('armMsg').textContent = '';
  render(); $('armory').hidden = false; $('armTab' + tab).focus();
}
export function closeArmory() { $('armory').hidden = true; closed(); }

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function swatchBtn(id, on, lockText, pick) {
  const b = el('button', 'sw'); b.type = 'button'; b.dataset.key = id;
  const chip = el('span', 'chipsw'), url = lookSwatch(id);
  if (url) chip.style.backgroundImage = `url(${url})`; else chip.classList.add('factory');
  b.append(chip, el('span', 'swname', LOOKS[id].name));
  b.setAttribute('aria-pressed', String(on));
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
  if (tab === 0) {
    body.append(el('h3', null, 'Uniform'), el('p', 'help', `Level ${lv}. Higher levels unlock more uniforms.`));
    const grid = el('div', 'swatches');
    for (const [id, need] of UNIFORMS) grid.append(swatchBtn(id, prog.uniform === id, uniformUnlocked(prog, id) ? '' : `Level ${need}`, () => { prog.uniform = id; }));
    body.append(grid);
    body.append(el('p', 'help', `${prog.matches} matches played · ${prog.wins} won`));
    return;
  }
  const wi = tab - 1;
  body.append(el('h3', null, 'Camo'), el('p', 'help', `${prog.wk[wi]} kills · ${prog.wh[wi]} headshots with the ${WEAPONS[wi].name}`));
  const grid = el('div', 'swatches');
  for (const [id] of CAMOS) grid.append(swatchBtn(id, prog.camo[wi] === id, camoUnlocked(prog, wi, id) ? '' : camoNeed(prog, wi, id), () => { prog.camo[wi] = id; }));
  body.append(grid);
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
