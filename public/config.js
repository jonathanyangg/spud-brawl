// Tuning, weapons, bots and default controls. Pure data, no DOM.
// ---------- tuning ----------
export const G = 24, JUMP = 8.8, R = 0.38, H = 1.7, EYE = 1.45, STEP = 0.55;
export const SCORE_LIMIT = 20;
export const WEAPONS = [
  { name: 'Peeler',    dmg: 13, head: 1.6, rate: 0.09, mag: 30, reload: 1.4, spread: 0.022, pellets: 1, range: 70,  auto: true,  kick: 0.010, pref: 13 },
  { name: 'Masher',    dmg: 11, head: 1.4, rate: 0.85, mag: 6,  reload: 1.9, spread: 0.075, pellets: 9, range: 30,  auto: false, kick: 0.055, pref: 6 },
  { name: 'Fry-Rifle', dmg: 75, head: 2.0, rate: 1.15, mag: 5,  reload: 2.1, spread: 0.002, pellets: 1, range: 140, auto: false, kick: 0.07,  pref: 24, zoom: true },
];
export const DIFF = {
  easy:   { inacc: 0.08,  react: 0.85, turn: 3.2, dmg: 0.45 },
  normal: { inacc: 0.05,  react: 0.5,  turn: 5.5, dmg: 0.65 },
  hard:   { inacc: 0.028, react: 0.28, turn: 9,   dmg: 0.85 },
};
export const BOT_NAMES = ['Russet', 'Yukon', 'Tater Tot', 'Hash Brown', 'Spudnik', 'Wedge', 'Gnocchi', 'Fingerling', 'Duchess', 'Mr. Mash'];
export const HATS = ['#e5432d', '#2f8fe0', '#8cc63f', '#b45be0', '#f28c28', '#1fb5a8', '#e0559b', '#5a62e8'];
export const PLAYER_COLOR = '#ffc83d';
export const WNAMES = ['Peeler', 'Masher', 'Fry-Rifle', 'Hot Potato'];

// ---------- key bindings ----------
// Every rebindable control maps to one KeyboardEvent.code, or 'Mouse0'..'Mouse4' for mouse buttons.
export const ACTIONS = [
  ['fwd', 'Move forward', 'KeyW'], ['back', 'Move back', 'KeyS'], ['left', 'Strafe left', 'KeyA'], ['right', 'Strafe right', 'KeyD'],
  ['jump', 'Jump', 'Space'], ['shoot', 'Shoot', 'Mouse0'], ['scope', 'Scope (Fry-Rifle)', 'Mouse2'],
  ['w1', 'Peeler', 'Digit1'], ['w2', 'Masher', 'Digit2'], ['w3', 'Fry-Rifle', 'Digit3'], ['swap', 'Last weapon', 'KeyQ'],
  ['reload', 'Reload', 'KeyR'], ['nade', 'Throw hot potato', 'KeyG'], ['scores', 'Show scores', 'Tab'], ['mute', 'Mute sound', 'KeyM'],
];
export const DEFAULT_BINDS = Object.fromEntries(ACTIONS.map(a => [a[0], a[2]]));
const BLOCKED_KEYS = ['Escape', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'F5', 'F11', 'F12'];
export const validCode = c => typeof c === 'string' && /^(Mouse[0-4]|[A-Za-z][A-Za-z0-9]{0,24})$/.test(c) && !BLOCKED_KEYS.includes(c);
export function keyName(c) {
  const fixed = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', Space: 'Space',
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', AltLeft: 'Left Alt', AltRight: 'Right Alt', CapsLock: 'Caps Lock', Backquote: '`',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backspace: 'Backspace', Enter: 'Enter' };
  if (fixed[c]) return fixed[c];
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad/.test(c)) return 'Num ' + c.slice(6);
  return c;
}
