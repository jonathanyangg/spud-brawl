// Tuning, weapons, bots and default controls. Pure data, no DOM.
// ---------- tuning ----------
export const G = 24, JUMP = 8.8, R = 0.38, H = 1.85, EYE = 1.62, STEP = 0.55;
export const SCORE_LIMIT = 20;
// movement speeds (m/s) and slide timing (s)
export const MOVE = { walk: 6.6, sprint: 9.4, crouch: 3.3, ads: 4.0, slide: 12.5, slideTime: 0.75, slideCooldown: 0.25 };
// fov: field of view while aiming down sights; scope: full-screen scope overlay
// kind: gun (hitscan), rpg (fires a rocket), melee (short hitscan, no ammo). level: player level that unlocks it.
// noAtt: takes no attachments; noHead: can't headshot (camos skip the headshot goals); speed: move speed multiplier
export const WEAPONS = [
  { name: 'SMG',     dmg: 13, head: 1.6, rate: 0.085, mag: 30, reload: 1.6, spread: 0.022, pellets: 1, range: 70,  auto: true,  kick: 0.010, pref: 13, fov: 58 },
  { name: 'Shotgun', dmg: 11, head: 1.4, rate: 0.85,  mag: 6,  reload: 2.0, spread: 0.075, pellets: 9, range: 30,  auto: false, kick: 0.055, pref: 6,  fov: 64 },
  { name: 'Sniper',  dmg: 75, head: 2.0, rate: 1.15,  mag: 5,  reload: 2.4, spread: 0.002, pellets: 1, range: 140, auto: false, kick: 0.07,  pref: 24, fov: 22, scope: true },
  { name: 'AR',      dmg: 20, head: 1.7, rate: 0.105, mag: 30, reload: 2.0, spread: 0.011, pellets: 1, range: 100, auto: true,  kick: 0.015, pref: 20, fov: 50 },
  { name: 'RPG',     dmg: 130, head: 1,  rate: 1.0,   mag: 1,  reload: 2.6, spread: 0.004, pellets: 1, range: 120, auto: false, kick: 0.09,  pref: 22, fov: 55, kind: 'rpg', level: 6, noAtt: true, noHead: true },
  { name: 'Knife',   dmg: 55, head: 1.5, rate: 0.5,   mag: 1,  reload: 0,   spread: 0,     pellets: 1, range: 2.6, auto: true,  kick: 0,     pref: 1,  fov: 70, kind: 'melee', noAtt: true, speed: 1.12 },
].map((w, id) => ({ id, kind: 'gun', level: 1, ...w }));
export const KNIFE = 5, SNIPER = 2;
// the equipment slot: one throwable per loadout
export const THROWABLES = { frag: { name: 'Frag', cd: 7, level: 1 }, stun: { name: 'Stun', cd: 9, level: 3 }, flash: { name: 'Flashbang', cd: 9, level: 5 } };
// battle royale loot: you land with a knife and find the rest in chests.
// ammo: the reserve each weapon reloads from (the knife needs none); pack: what one box of it holds; max: how much you can carry
export const AMMO_OF = ['light', 'shells', 'heavy', 'light', 'rockets', null];
export const AMMO = {
  light: { name: 'Light ammo', pack: 30, max: 180, color: 0xe8c33a },
  shells: { name: 'Shells', pack: 8, max: 40, color: 0xd9452f },
  heavy: { name: 'Heavy ammo', pack: 10, max: 40, color: 0x4c9a52 },
  rockets: { name: 'Rockets', pack: 2, max: 6, color: 0x7a6a45 },
};
// heals: hp restored (bandages only patch you up to cap), seconds to use (standing still; moving or shooting stops it), how many you can carry
export const HEALS = { bandage: { name: 'Bandage', hp: 25, time: 2.2, max: 10, cap: 75 }, medkit: { name: 'Medkit', hp: 100, time: 5, max: 3 } };
// chest guns by weight (weapon index, weight), and the color of each gun's loot beam (how good it is)
export const CHEST_GUNS = [[0, 26], [1, 22], [2, 14], [3, 26], [4, 5]];
// battle royale gun rarity: every gun from a chest rolls one. Rarer ones hit harder and reload faster.
// w: chance weight; dmg and reload: multipliers on the gun's own numbers
export const RARITY = [
  { name: 'Common', color: 0xb9b9b9, w: 44, dmg: 1, reload: 1 },
  { name: 'Uncommon', color: 0x5fbf3a, w: 30, dmg: 1.08, reload: 0.95 },
  { name: 'Rare', color: 0x2f8fe0, w: 16, dmg: 1.16, reload: 0.9 },
  { name: 'Epic', color: 0xb45be0, w: 8, dmg: 1.25, reload: 0.85 },
  { name: 'Legendary', color: 0xffc83d, w: 2, dmg: 1.35, reload: 0.8 },
];
export const MAX_SLOTS = 4; // the knife plus three guns
// game types. Aim trainer is solo only.
export const GAMES = { ffa: 'Free-for-all', tdm: 'Team Deathmatch', br: 'Battle Royale', zombies: 'Zombies', gungame: 'Gun Game', moon: 'Moon Knives', snipe: 'Snipers Only', aim: 'Aim Trainer' };
// gun game: two kills on each weapon, then one with the knife wins (AR, SMG, Shotgun, Sniper, RPG, Knife)
export const GUNGAME = [3, 0, 1, 2, 4, 5];
export const DIFF = {
  easy:   { inacc: 0.08,  react: 0.85, turn: 3.2, dmg: 0.45 },
  normal: { inacc: 0.05,  react: 0.5,  turn: 5.5, dmg: 0.65 },
  hard:   { inacc: 0.028, react: 0.28, turn: 9,   dmg: 0.85 },
};
export const BOT_NAMES = ['Havoc', 'Rook', 'Bishop', 'Mako', 'Talon', 'Ridge', 'Kestrel', 'Onyx', 'Sable', 'Cinder'];
// team deathmatch: team 0 and team 1
export const TEAM_COLORS = ['#2f8fe0', '#e5432d'], TEAM_NAMES = ['Blue', 'Red'];
export const HATS = ['#e5432d', '#2f8fe0', '#8cc63f', '#b45be0', '#f28c28', '#1fb5a8', '#e0559b', '#5a62e8'];
export const PLAYER_COLOR = '#ffc83d';
// names sent over the network by index: weapons, then throwables, then zombies
export const WNAMES = [...WEAPONS.map(w => w.name), 'Frag', 'Stun', 'Flashbang', 'Zombie', 'Storm'];

// ---------- key bindings ----------
// Every rebindable control maps to one KeyboardEvent.code, or 'Mouse0'..'Mouse4' for mouse buttons.
export const ACTIONS = [
  ['fwd', 'Move forward', 'KeyW'], ['back', 'Move back', 'KeyS'], ['left', 'Strafe left', 'KeyA'], ['right', 'Strafe right', 'KeyD'],
  ['jump', 'Jump', 'Space'], ['sprint', 'Sprint', 'ShiftLeft'], ['crouch', 'Crouch / slide', 'KeyC'],
  ['shoot', 'Shoot', 'Mouse0'], ['scope', 'Aim down sights', 'Mouse2'],
  ['w1', 'Weapon 1', 'Digit1'], ['w2', 'Weapon 2', 'Digit2'], ['w3', 'Weapon 3', 'Digit3'], ['w4', 'Weapon 4', 'Digit4'], ['swap', 'Last weapon', 'KeyQ'], ['slotL', 'Move gun left in loadout', 'BracketLeft'], ['slotR', 'Move gun right in loadout', 'BracketRight'],
  ['reload', 'Reload', 'KeyR'], ['use', 'Open chest / pick up', 'KeyE'], ['dropGun', 'Drop weapon (battle royale)', 'KeyX'], ['bandage', 'Use bandage', 'KeyB'], ['medkit', 'Use medkit', 'KeyN'], ['inv', 'Inventory (battle royale)', 'Tab'], ['map', 'Full map (battle royale)', 'KeyM'], ['nade', 'Throw equipment', 'KeyG'], ['scores', 'Show scores', 'KeyL'], ['mute', 'Mute sound', 'KeyK'],
];
export const DEFAULT_BINDS = Object.fromEntries(ACTIONS.map(a => [a[0], a[2]]));
const BLOCKED_KEYS = ['Escape', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'F5', 'F11', 'F12'];
export const validCode = c => typeof c === 'string' && /^(Mouse[0-4]|[A-Za-z][A-Za-z0-9]{0,24})$/.test(c) && !BLOCKED_KEYS.includes(c);
export function keyName(c) {
  const fixed = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', Space: 'Space',
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', CapsLock: 'Caps Lock', Backquote: '`',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backspace: 'Backspace', Enter: 'Enter' };
  if (fixed[c]) return fixed[c];
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad/.test(c)) return 'Num ' + c.slice(6);
  return c;
}
