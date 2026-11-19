// Ground-floor pathfinding for bots and zombies: a 1 m grid of the map's ground, and a breadth-first
// distance field toward each target cell (cached, since many zombies chase the same few players).
// Only the ground floor: changing floors is still done by heading for a flight of stairs or a jump pad.
const CELL = 1;

// boxes: [{ min: {x,y,z}, max: {x,y,z} }]. A cell is blocked when a body standing at its center would touch
// something it can't step over (judged at the center, so a 2 m doorway always leaves a free cell in it)
// avoid: [{ x, z, r }] circles to keep off as well (jump pads: walking across one would launch you)
export function buildNav(boxes, limit, r = 0.38, step = 0.55, height = 1.85, avoid = []) {
  const n = Math.ceil(2 * limit / CELL), free = new Uint8Array(n * n).fill(1);
  const first = v => Math.max(0, Math.ceil((v + limit) / CELL - 0.5)), last = v => Math.min(n - 1, Math.floor((v + limit) / CELL - 0.5));
  for (const b of boxes) {
    if (b.max.y <= step || b.min.y >= height) continue;
    const i0 = first(b.min.x - r), i1 = last(b.max.x + r), j0 = first(b.min.z - r), j1 = last(b.max.z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) free[j * n + i] = 0;
  }
  for (const a of avoid) for (let j = first(a.z - a.r); j <= last(a.z + a.r); j++) for (let i = first(a.x - a.r); i <= last(a.x + a.r); i++) {
    const x = (i + 0.5) * CELL - limit, z = (j + 0.5) * CELL - limit;
    if ((x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r) free[j * n + i] = 0;
  }
  return { n, limit, free, fields: new Map() };
}

const cellOf = (nav, x, z) => {
  const i = Math.floor((x + nav.limit) / CELL), j = Math.floor((z + nav.limit) / CELL);
  return i < 0 || j < 0 || i >= nav.n || j >= nav.n ? -1 : j * nav.n + i;
};
const center = (nav, c) => ({ x: (c % nav.n + 0.5) * CELL - nav.limit, z: (Math.floor(c / nav.n) + 0.5) * CELL - nav.limit });
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// the free cell nearest the point (x, z), searching outward from its cell c up to `reach` cells. Nearest to the
// point itself, not just the first found: someone pressed against a thin wall must not be put on its far side.
function nearestFree(nav, c, x, z, reach = 6) {
  if (c < 0) return -1;
  if (nav.free[c]) return c;
  const ci = c % nav.n, cj = Math.floor(c / nav.n);
  for (let r = 1; r <= reach; r++) {
    let best = -1, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nav.n || j >= nav.n || !nav.free[j * nav.n + i]) continue;
      const p = center(nav, j * nav.n + i), d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = j * nav.n + i; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

// steps from every cell to `goal` (65535 = can't get there); diagonals only where both sides are open
function field(nav, goal) {
  let f = nav.fields.get(goal);
  if (f) return f;
  const { n, free } = nav;
  f = new Uint16Array(n * n).fill(65535); f[goal] = 0;
  const q = new Int32Array(n * n); let head = 0, tail = 0; q[tail++] = goal;
  while (head < tail) {
    const c = q[head++], i = c % n, j = (c - i) / n;
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const k = b * n + a;
      if (!free[k] || f[k] !== 65535) continue;
      if (di && dj && (!free[j * n + a] || !free[b * n + i])) continue;
      f[k] = f[c] + 1; q[tail++] = k;
    }
  }
  if (nav.fields.size > 40) nav.fields.clear();
  nav.fields.set(goal, f);
  return f;
}

// Where to walk next to get from (x, z) to (tx, tz) on the ground: a point a few cells along the shortest
// path, or null when there's no path (the caller then just heads straight for the target).
export function navToward(nav, x, z, tx, tz, ahead = 3) {
  const goal = nearestFree(nav, cellOf(nav, tx, tz), tx, tz), start = nearestFree(nav, cellOf(nav, x, z), x, z, 2);
  if (goal < 0 || start < 0) return null;
  const f = field(nav, goal);
  if (f[start] === 65535) return null;
  let c = start, best = start;
  for (let s = 0; s < ahead && f[c] > 0; s++) {
    const i = c % nav.n, j = (c - i) / nav.n; let next = c;
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nav.n || b >= nav.n) continue;
      const k = b * nav.n + a;
      if (f[k] < f[next] && !(di && dj && (!nav.free[j * nav.n + a] || !nav.free[b * nav.n + i]))) next = k;
    }
    if (next === c) break;
    c = next;
    if (s === 0 || lineFree(nav, x, z, center(nav, c))) best = c; else break; // don't cut a corner on a bend
  }
  return f[best] === 0 ? { x: tx, z: tz } : center(nav, best);
}
// every point on the way from (x, z) to p is in a free cell
function lineFree(nav, x, z, p) {
  const d = Math.hypot(p.x - x, p.z - z), n = Math.ceil(d / 0.25);
  for (let k = 1; k < n; k++) { const c = cellOf(nav, x + (p.x - x) * k / n, z + (p.z - z) * k / n); if (c < 0 || !nav.free[c]) return false; }
  return true;
}
