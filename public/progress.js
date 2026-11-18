// Saved progression: XP and levels, uniforms, weapon camos and attachments. Pure logic, no DOM.
// Progress lives in this browser's localStorage, so it is per device and easy to edit; fine among friends.
import { WEAPONS } from './config.js';

export const MAX_LEVEL = 55;
export const XP = { kill: 100, head: 50, frag: 50, streak: 50, match: 200, win: 500 };
export const xpToNext = level => 400 + 200 * level;
export function levelInfo(xp) {
  let level = 1, need = xpToNext(1);
  while (level < MAX_LEVEL && xp >= need) { xp -= need; level++; need = xpToNext(level); }
  return level >= MAX_LEVEL ? { level, into: 0, need: 0 } : { level, into: xp, need };
}

// Looks are shared by uniforms and guns. 'factory' keeps the model's own colors.
export const LOOKS = {
  factory:  { name: 'Factory',    pattern: 'none' },
  olive:    { name: 'Olive drab', pattern: 'solid',   colors: ['#55593f'] },
  woodland: { name: 'Woodland',   pattern: 'blotch',  colors: ['#5b6b3a', '#3b4a2a', '#7a6a45', '#22261a'] },
  desert:   { name: 'Desert',     pattern: 'blotch',  colors: ['#c8b07a', '#a88b5a', '#8a6d43', '#e0cfa0'] },
  urban:    { name: 'Urban',      pattern: 'digital', colors: ['#8a8d90', '#5d6166', '#b8bbbd', '#3c3f43'] },
  arctic:   { name: 'Arctic',     pattern: 'digital', colors: ['#e8eef2', '#b8c4cc', '#8c9aa5', '#ffffff'] },
  night:    { name: 'Night ops',  pattern: 'digital', colors: ['#23283a', '#1a1d28', '#353b52', '#0e1016'] },
  tiger:    { name: 'Tiger',      pattern: 'tiger',   colors: ['#d98a2b', '#1b1712'] },
  blaze:    { name: 'Blaze',      pattern: 'tiger',   colors: ['#e5432d', '#ffb02e'] },
  crimson:  { name: 'Crimson',    pattern: 'blotch',  colors: ['#8b1a1a', '#5a1010', '#b02828', '#2a0808'] },
  royal:    { name: 'Royal',      pattern: 'blotch',  colors: ['#4b2a7a', '#2f1a52', '#c9a227', '#6a3fa8'] },
  gold:     { name: 'Gold',       pattern: 'metal',   colors: ['#f6d26b', '#b8860b'] },
  nebula:   { name: 'Nebula',     pattern: 'nebula',  colors: ['#1a0f2e', '#7b3fe4', '#e040fb', '#40c4ff'] },
};
// uniforms unlock by level: [look, level]
export const UNIFORMS = [['olive', 1], ['woodland', 3], ['desert', 6], ['urban', 10], ['arctic', 14], ['night', 18], ['tiger', 24], ['blaze', 30], ['royal', 38], ['gold', 50]];
// gun camos unlock per weapon: [look, kills, headshots]; nebula needs gold on all three
export const CAMOS = [['factory', 0, 0], ['woodland', 10, 0], ['desert', 25, 0], ['urban', 50, 0], ['tiger', 100, 0], ['crimson', 150, 25], ['gold', 250, 50], ['nebula', Infinity, Infinity]];
export const MAX_ATTACH = 2;
export const ATTACH = {
  ext:   { name: 'Extended mag', level: 4,  desc: '+50% magazine, 15% slower reload', mod: w => { w.mag = Math.round(w.mag * 1.5); w.reload *= 1.15; } },
  laser: { name: 'Laser sight',  level: 8,  desc: 'Tighter hip-fire spread',          mod: w => { w.hipK = 0.65; } },
  sup:   { name: 'Suppressor',   level: 12, desc: 'Quiet shots, no flash, 15% less range', mod: w => { w.sup = true; w.range *= 0.85; } },
  fast:  { name: 'Fast mag',     level: 16, desc: 'Reloads 30% faster',               mod: w => { w.reload *= 0.7; } },
};

export const newProgress = () => ({ xp: 0, wk: [0, 0, 0], wh: [0, 0, 0], uniform: 'olive', camo: ['factory', 'factory', 'factory'], att: [[], [], []], matches: 0, wins: 0, fresh: 0 });
// localStorage is user-editable: keep only well-formed values
export function loadProgress(raw) {
  const p = newProgress(); let o = null;
  try { o = JSON.parse(raw); } catch (e) {}
  if (!o || typeof o !== 'object') return p;
  const n = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  p.xp = n(o.xp); p.matches = n(o.matches); p.wins = n(o.wins); p.fresh = n(o.fresh);
  for (let i = 0; i < 3; i++) {
    p.wk[i] = n(o.wk?.[i]); p.wh[i] = n(o.wh?.[i]);
    if (camoUnlocked(p, i, o.camo?.[i])) p.camo[i] = o.camo[i];
    if (Array.isArray(o.att?.[i])) p.att[i] = [...new Set(o.att[i])].filter(a => attachUnlocked(p, a)).slice(0, MAX_ATTACH);
  }
  if (uniformUnlocked(p, o.uniform)) p.uniform = o.uniform;
  return p;
}

export const level = p => levelInfo(p.xp).level;
export const uniformUnlocked = (p, id) => UNIFORMS.some(([u, l]) => u === id && level(p) >= l);
export const attachUnlocked = (p, id) => Object.hasOwn(ATTACH, id) && level(p) >= ATTACH[id].level;
const isGold = (p, wi) => p.wk[wi] >= 250 && p.wh[wi] >= 50;
export function camoUnlocked(p, wi, id) {
  const c = CAMOS.find(c => c[0] === id); if (!c) return false;
  if (id === 'nebula') return [0, 1, 2].every(i => isGold(p, i));
  return p.wk[wi] >= c[1] && p.wh[wi] >= c[2];
}
// the next step toward a camo, for the Armory
export function camoNeed(p, wi, id) {
  const c = CAMOS.find(c => c[0] === id);
  if (id === 'nebula') return 'Gold on all three guns';
  const parts = [];
  if (p.wk[wi] < c[1]) parts.push(`${p.wk[wi]}/${c[1]} kills`);
  if (p.wh[wi] < c[2]) parts.push(`${p.wh[wi]}/${c[2]} headshots`);
  return parts.join(', ');
}

function unlockLabels(p) {
  const out = new Map();
  for (const [u] of UNIFORMS) if (uniformUnlocked(p, u)) out.set('u' + u, `${LOOKS[u].name} uniform`);
  for (let i = 0; i < 3; i++) for (const [c] of CAMOS) if (camoUnlocked(p, i, c)) out.set(`c${i}${c}`, `${LOOKS[c].name} camo · ${WEAPONS[i].name}`);
  for (const a in ATTACH) if (attachUnlocked(p, a)) out.set('a' + a, ATTACH[a].name);
  return out;
}
// Add XP (and a kill or match result); returns the new level, if any, and what just unlocked.
// kill: { w: weapon index (3 = frag), head }
export function award(p, xp, { kill, match, win } = {}) {
  const before = unlockLabels(p), lvl = level(p);
  p.xp += Math.max(0, Math.round(xp));
  if (kill && kill.w >= 0 && kill.w < 3) { p.wk[kill.w]++; if (kill.head) p.wh[kill.w]++; }
  if (match) p.matches++;
  if (win) p.wins++;
  const unlocks = [...unlockLabels(p)].filter(([k]) => !before.has(k)).map(([, v]) => v);
  p.fresh += unlocks.length;
  return { levelUp: level(p) > lvl ? level(p) : null, unlocks };
}

// your guns with your equipped attachments applied
export function loadoutWeapons(p) {
  return WEAPONS.map((w, i) => {
    const c = { ...w };
    for (const a of p.att[i]) if (attachUnlocked(p, a)) ATTACH[a].mod(c);
    return c;
  });
}
