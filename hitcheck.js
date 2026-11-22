// A light check on the hits players report. The game still runs in each player's browser: this only throws out
// reports no real game could make, so a lazily modified client gets nowhere. Ruled out:
// - hits from someone who is dead or in the lobby (or from a bot of theirs that is down)
// - hits from further than the gun reaches
// - more damage in one report than one shot of that gun can do
// - more damage to one target over two seconds than the gun's fire rate allows
// Hits arrive as 'h' events in the presence's event ring: [seq, 'h', target id, damage, head, weapon, shooting bot id or ''].
// Grenades and rockets aren't reported this way (every game works out its own blast damage), so they never reach here.
import { WEAPONS, WNAMES } from './public/config.js';

// the most one shot can do: a headshot with every pellet, at the best rarity, for the callsign that hits 1.5x as hard
const BEST = 1.35 * 1.5, SLACK = 1.1;
export const MAX_HIT = WEAPONS.map(w => w.dmg * Math.max(1, w.head || 1) * w.pellets * BEST * SLACK);
// how far a hit can come from: the gun's range, plus room for where the target was a moment ago
export const REACH = WEAPONS.map(w => w.range * 1.25 + 6);
export const ZOMBIE_W = WNAMES.indexOf('Zombie'), ZOMBIE_MAX = 100;
const WINDOW = 2000; // ms

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pos3 = v => (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite) ? v.slice(0, 3) : null);
const botIn = (pres, id) => { // a bot in a host's state: [bid, name, team, x, y, z, yaw, pitch, weapon, alive, ...]
  const bid = typeof id === 'string' && /^b\d+$/.test(id) ? +id.slice(1) : NaN;
  return Array.isArray(pres?.bt) ? pres.bt.find(b => Array.isArray(b) && b[0] === bid) || null : null;
};

// shooter: { pres (their latest presence), prev (the one before), hist (Map for the damage window) }; host: the room host's record like shooter's (it runs the bots);
// presOf(id): a player's last presence. Returns null when the hit is fine, or why it isn't.
export function checkHit(e, shooter, presOf, host, now) {
  const [, , tgt, dmg, , w, botId] = e, me = shooter.pres, was = shooter.prev || me;
  if (typeof tgt !== 'string' || !Number.isFinite(dmg) || dmg < 0) return 'malformed';
  if (!me) return 'not in a match';
  if (w === ZOMBIE_W) return dmg > ZOMBIE_MAX ? 'too much damage' : null; // the zombie host's zombies; no position to check
  const gun = WEAPONS[w];
  if (!Number.isInteger(w) || !gun) return 'unknown weapon';
  if (dmg > MAX_HIT[w]) return 'too much damage';
  let from;
  if (botId) { // one of the host's bots shot
    if (host !== shooter) return 'not the bot host';
    const b = botIn(me, botId); if (!b) return 'no such bot';
    if (b[9] !== 1) return 'shooter is dead';
    from = b.slice(3, 6);
  } else { // the room host's zombies and bots keep going while the host is down or in the lobby; a player's own shots
    // need them in play. Down in this presence and the one before, so a shot fired in the frame they died still counts
    if (me.lb === 1 && was.lb === 1) return 'not in a match';
    if (me.dd === 1 && was.dd === 1) return 'shooter is dead';
    from = pos3(me.p);
  }
  // the target: another player, or one of the host's bots ('b' + its number); zombies and anything else go unchecked
  const tp = presOf(tgt), tb = tp ? null : botIn(host?.pres, tgt), to = tp ? pos3(tp.p) : tb && pos3(tb.slice(3, 6));
  if (from && to && dist(from, to) > REACH[w]) return 'out of range';
  // damage to this target over the window: at most one full shot per fire interval (a fast-reload rarity's included), plus one
  const key = `${botId || ''}>${tgt}`, list = (shooter.hist.get(key) || []).filter(([t]) => now - t < WINDOW);
  const total = list.reduce((s, [, d]) => s + d, 0) + dmg;
  if (total > MAX_HIT[w] * (Math.floor(WINDOW / 1000 / (gun.rate * 0.8)) + 1)) return 'too much damage per second';
  list.push([now, dmg]); shooter.hist.set(key, list);
  if (shooter.hist.size > 64) for (const [k, l] of shooter.hist) if (!l.length || now - l.at(-1)[0] >= WINDOW) shooter.hist.delete(k);
  return null;
}

// Runs the new events in a presence through checkHit (each event once, the first time it shows up) and drops the
// ones that failed from this and every later copy of the ring. Returns the presence to relay: raw when nothing changed.
export function filterPresence(o, raw, shooter, presOf, host, now) {
  shooter.prev = shooter.pres; shooter.pres = o;
  if (!Array.isArray(o.ev) || !o.ev.length) return raw;
  shooter.bad ||= new Set(); shooter.hist ||= new Map();
  for (const e of o.ev) {
    if (!Array.isArray(e) || !Number.isFinite(e[0]) || e[0] <= (shooter.seen ?? -Infinity)) continue;
    shooter.seen = e[0];
    if (e[1] === 'h') { const why = checkHit(e, shooter, presOf, host, now); if (why) { shooter.bad.add(e[0]); shooter.rejected = (shooter.rejected || 0) + 1; } }
  }
  if (!shooter.bad.size) return raw;
  const lo = o.ev[0]?.[0];
  for (const s of shooter.bad) if (s < lo) shooter.bad.delete(s); // out of the ring now
  if (!o.ev.some(e => shooter.bad.has(e?.[0]))) return raw;
  return JSON.stringify({ ...o, ev: o.ev.filter(e => !shooter.bad.has(e?.[0])) });
}
