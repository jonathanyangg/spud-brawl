// Builds maps in Node (no browser) and checks them: spawns clear, every flight of stairs and jump pad usable,
// the ground all one connected area, jump pad arcs clear of walls. Also draws a top-down picture of each map.
//   node tools/mapcheck.mjs [map ...] [--png]      (no names: every map; --png writes tools/out/<map>.png, macOS)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
globalThis.THREE = require('three');
const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

// each map is loaded on its own (as world.js would), so a broken map file only fails its own check
const MAP_IDS = ['depot', 'yard', 'dunes', 'frost', 'stack', 'highrise', 'island'];
const kit = await import('../public/kit.js'), { boxes, SPAWNS, STAIRS, PADS } = kit;
const { buildNav } = await import('../public/nav.js');
const { R, H, STEP, G } = await import('../public/config.js');

const args = process.argv.slice(2), png = args.includes('--png');
const names = args.filter(a => !a.startsWith('--'));
let failed = false;

// a body standing at (x, y, z) would be inside something
const blocked = (x, y, z, r = R) => boxes.some(b => x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z && y + H > b.min.y + 0.01 && y < b.max.y - 0.01);
// the floor height right under (x, z) at or below y (0 = ground)
const floorAt = (x, z, y) => boxes.reduce((f, b) => (x > b.min.x - R * 0.6 && x < b.max.x + R * 0.6 && z > b.min.z - R * 0.6 && z < b.max.z + R * 0.6 && b.max.y <= y + 0.05 && b.max.y > f ? b.max.y : f), 0);

for (const name of names.length ? names : MAP_IDS) {
  const problems = [], scene = new THREE.Scene();
  let m;
  try { kit.clearMap(scene); m = (await import(`../public/maps/${name}.js`)).default(); }
  catch (e) { console.log(`${name}: FAILED TO BUILD\n  ${e.stack.split('\n').slice(0, 4).join('\n  ')}`); failed = true; continue; }
  for (const [x, z] of m.spawns) if (!blocked(x, 0, z)) SPAWNS.push([x, z]); else problems.push(`spawn ${x},${z} is inside something (dropped)`);
  const lim = kit.LIMIT, HALF = m.half || 29;
  if (!(m.sky >= 0) || !Array.isArray(m.fog)) problems.push('return { sky, fog: [near, far], spawns, half? }');
  // spawns
  if (SPAWNS.length < 12) problems.push(`only ${SPAWNS.length} clear spawns (want 12+): spawns inside boxes are dropped`);
  for (const [x, z] of SPAWNS) if (Math.abs(x) > lim - R || Math.abs(z) > lim - R) problems.push(`spawn ${x},${z} is outside the boundary`);
  // stairs and pads: the foot is clear, the top has a floor at the right height and room to stand
  STAIRS.forEach((st, i) => {
    const what = `${st.pad ? 'pad' : 'stairs'} #${i} (foot ${st.foot.map(v => +v.toFixed(1))}, top ${st.top.map(v => +v.toFixed(1))} at ${+st.y1.toFixed(2)})`;
    if (blocked(st.foot[0], st.y0, st.foot[1])) problems.push(`${what}: something is in the way at the foot`);
    if (Math.abs(floorAt(st.top[0], st.top[1], st.y1) - st.y1) > 0.06) problems.push(`${what}: no floor at the top (floor there is ${floorAt(st.top[0], st.top[1], st.y1).toFixed(2)})`);
    if (blocked(st.top[0], st.y1, st.top[1])) problems.push(`${what}: something is in the way at the top`);
  });
  // jump pads: fly the arc the game flies and see that it lands on the spot without hitting anything
  for (const pd of PADS) {
    const g = G, vy = Math.sqrt(2 * g * (pd.ty - pd.y + pd.arc)), t = vy / g + Math.sqrt(2 * pd.arc / g);
    const p = { x: pd.x, y: pd.y, z: pd.z }, v = { x: (pd.tx - pd.x) / t, y: vy, z: (pd.tz - pd.z) / t };
    let hit = null;
    for (let s = 0; s < 600 && !hit; s++) {
      const dt = 1 / 240; v.y -= g * dt; p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      if (v.y < 0 && p.y <= pd.ty + 0.02 && Math.hypot(p.x - pd.tx, p.z - pd.tz) < 1) break;
      if (p.y > pd.y + 0.6 && blocked(p.x, p.y, p.z, R * 0.9)) hit = p;
      if (p.y < pd.y - 1) hit = p;
    }
    if (hit) problems.push(`pad at ${pd.x},${pd.z} -> ${pd.tx},${pd.ty},${pd.tz}: the arc hits something near ${hit.x.toFixed(1)},${hit.y.toFixed(1)},${hit.z.toFixed(1)}`);
  }
  // the ground is one connected area: every spawn and every ground-level stair foot can walk to every other
  const nav = buildNav(boxes, lim, R, STEP, H), cell = (x, z) => Math.floor(z + lim) * nav.n + Math.floor(x + lim);
  const seen = new Uint8Array(nav.n * nav.n), start = cell(...SPAWNS[0] || [0, 0]), q = [start]; seen[start] = 1;
  while (q.length) {
    const c = q.pop(), i = c % nav.n, j = (c - i) / nav.n;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, k = b * nav.n + a;
      if (a >= 0 && b >= 0 && a < nav.n && b < nav.n && nav.free[k] && !seen[k]) { seen[k] = 1; q.push(k); }
    }
  }
  const reach = (x, z) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (seen[cell(x + dx * 0.6, z + dz * 0.6)]) return true; return false; };
  for (const [x, z] of SPAWNS) if (!reach(x, z)) problems.push(`spawn ${x},${z} is cut off from spawn ${SPAWNS[0]} on the ground`);
  for (const st of STAIRS) if (st.y0 < 0.1 && !reach(...st.foot)) problems.push(`the foot of ${st.pad ? 'pad' : 'stairs'} at ${st.foot.map(v => +v.toFixed(1))} can't be walked to from the spawns`);

  const heights = [...new Set(boxes.filter(b => b.max.x - b.min.x > 1.5 && b.max.z - b.min.z > 1.5).map(b => Math.round(b.max.y * 2) / 2))].sort((a, b) => a - b);
  console.log(`${name}: ${boxes.length} boxes, ${SPAWNS.length} spawns, ${STAIRS.length - PADS.length} stairs, ${PADS.length} pads, half ${HALF}, standable heights ${heights.join(' ')}`);
  for (const p of problems) console.log('  PROBLEM: ' + p);
  if (problems.length) failed = true;
  if (png) picture(name, lim);
}
if (!failed) console.log('all maps ok');
process.exit(failed ? 1 : 0);

// top-down picture: darker = lower, lighter = higher (white = 10 m+), cyan dots = pads, red = stairs
// (foot to top), green = spawns, grey outside the walls. 12 px per metre.
function picture(name, lim) {
  const S = 12, A = Math.ceil(lim + 1), N = 2 * A * S, px = new Uint8Array(N * N * 3).fill(60);
  const put = (x, z, [r, g, b]) => { const i = Math.round((x + A) * S), j = Math.round((z + A) * S); if (i >= 0 && j >= 0 && i < N && j < N) { const k = (j * N + i) * 3; px[k] = r; px[k + 1] = g; px[k + 2] = b; } };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = i / S - A, z = j / S - A; if (Math.abs(x) < lim && Math.abs(z) < lim) put(x, z, [196, 186, 160]); }
  for (const b of [...boxes].sort((p, q) => p.max.y - q.max.y)) {
    const t = Math.min(1, b.max.y / 10), c = [Math.round(90 + 160 * t), Math.round(70 + 170 * t), Math.round(60 + 180 * t)];
    for (let x = b.min.x; x <= b.max.x; x += 1 / S) for (let z = b.min.z; z <= b.max.z; z += 1 / S) {
      const edge = x - b.min.x < 1 / S || b.max.x - x < 1 / S || z - b.min.z < 1 / S || b.max.z - z < 1 / S;
      put(x, z, edge ? c.map(v => v * 0.6) : c);
    }
  }
  const dot = (x, z, r, c) => { for (let a = -r; a <= r; a += 1 / S) for (let b = -r; b <= r; b += 1 / S) if (a * a + b * b <= r * r) put(x + a, z + b, c); };
  for (const st of STAIRS) { for (let k = 0; k <= 1; k += 0.02) dot(st.foot[0] + (st.top[0] - st.foot[0]) * k, st.foot[1] + (st.top[1] - st.foot[1]) * k, 0.12, st.pad ? [40, 220, 255] : [230, 40, 40]); dot(...st.top, 0.35, [255, 255, 0]); }
  for (const pd of PADS) dot(pd.x, pd.z, 1.2, [40, 220, 255]);
  for (const [x, z] of SPAWNS) dot(x, z, 0.6, [40, 200, 60]);
  // 24-bit BMP, rows bottom-up, then sips turns it into a PNG
  const row = Math.ceil(N * 3 / 4) * 4, buf = Buffer.alloc(54 + row * N);
  buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(N, 18); buf.writeInt32LE(N, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * N, 34);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const s = (j * N + i) * 3, d = 54 + (N - 1 - j) * row + i * 3; buf[d] = px[s + 2]; buf[d + 1] = px[s + 1]; buf[d + 2] = px[s]; }
  mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  const bmp = fileURLToPath(new URL(`./out/${name}.bmp`, import.meta.url)), out = bmp.replace(/\.bmp$/, '.png');
  writeFileSync(bmp, buf);
  try { execFileSync('sips', ['-s', 'format', 'png', bmp, '--out', out], { stdio: 'ignore' }); console.log(`  picture: ${out} (north = top, x to the right)`); }
  catch { console.log(`  picture: ${bmp}`); }
}
