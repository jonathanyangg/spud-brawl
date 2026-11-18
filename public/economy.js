// Coins, the free daily spin and coin packs. Pure logic shared by the server (which decides everything)
// and the client (which only draws the wheel and the price tags). No DOM, no network.
import { PREMIUM, LOOKS } from './progress.js';

// The daily spin is free and only free: it is never sold for money or coins (loot-box rules).
export const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Wheel segments in drawing order; w = weight out of the total. Items are spin-exclusive looks.
export const SPIN = [
  { coins: 25, w: 30 },
  { coins: 50, w: 26 },
  { coins: 75, w: 18 },
  { coins: 100, w: 12 },
  { coins: 250, w: 7 },
  { coins: 500, w: 3 },
  { item: 'spud', w: 2 },
  { item: 'lucky', w: 2 },
];
export const SPIN_TOTAL = SPIN.reduce((t, s) => t + s.w, 0);
export const DUPE_COINS = 150; // landing on a look you already own pays this instead
export const spinLabel = s => (s.item ? LOOKS[s.item].name : `${s.coins} coins`);

// r: a uniform random number in [0, 1). Returns the segment index and what it pays.
export function pickSpin(r, owned = []) {
  let x = Math.min(Math.max(Number(r) || 0, 0), 1 - 1e-12) * SPIN_TOTAL, seg = 0;
  while (seg < SPIN.length - 1 && x >= SPIN[seg].w) { x -= SPIN[seg].w; seg++; }
  const s = SPIN[seg];
  if (!s.item) return { seg, coins: s.coins, item: null, dupe: false };
  if (owned.includes(s.item)) return { seg, coins: DUPE_COINS, item: null, dupe: true };
  return { seg, coins: 0, item: s.item, dupe: false };
}

// lastSpin: null (never spun), an ISO timestamp or epoch ms. now: epoch ms.
export function spinState(lastSpin, now) {
  const t = lastSpin == null ? NaN : new Date(lastSpin).getTime();
  if (!Number.isFinite(t)) return { ready: true, next: now };
  const next = t + SPIN_COOLDOWN_MS;
  return { ready: now >= next, next: Math.max(next, now) };
}

// Coin packs for real money. Prices are placeholders; Stripe Checkout builds the line item from these (price_data).
export const COIN_PACKS = [
  { id: 'small', coins: 500, cents: 99 },
  { id: 'medium', coins: 1200, cents: 199 },
  { id: 'large', coins: 3000, cents: 499 },
];
export const packById = id => COIN_PACKS.find(p => p.id === id) || null;

// Can this player buy this item? Only named premium looks with a price are for sale.
export function buyCheck(item, coins, owned = []) {
  if (typeof item !== 'string' || !Object.hasOwn(PREMIUM, item)) return { error: 'Unknown item' };
  const price = PREMIUM[item].price;
  if (!price) return { error: 'Not for sale' };
  if (owned.includes(item)) return { error: 'Already owned' };
  if (typeof coins !== 'number' || !(coins >= price)) return { error: 'Not enough coins' };
  return { ok: true, price };
}
