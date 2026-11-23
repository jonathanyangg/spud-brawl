// Maps: which ones there are, and loading one. Each map is built in its own file in ./maps/ from the pieces in kit.js.
// Maps are 64 x 64 inside the perimeter wall, except Stackyard, which walls off a small square in the middle,
// and Spud Island (the battle royale map), which is 160 x 160.
// HALF is how far from the center the playable ground reaches, for bots and spawns that pick random spots.
import { R } from './config.js';
import { world, boxes, SPAWNS, CHESTS, VEHICLES, clearMap } from './kit.js';
import depot from './maps/depot.js';
import yard from './maps/yard.js';
import dunes from './maps/dunes.js';
import frost from './maps/frost.js';
import stack from './maps/stack.js';
import highrise from './maps/highrise.js';
import island from './maps/island.js';
export { boxes, SPAWNS, STAIRS, PADS, PAD_R, ICE, CHESTS, VEHICLES, boxGeo, LIMIT } from './kit.js';

export const MAPS = { depot: 'Depot', yard: 'Old Town', dunes: 'Dunes', frost: 'Frostbite', stack: 'Stackyard', highrise: 'Highrise', island: 'Spud Island' };
const BUILD = { depot, yard, dunes, frost, stack, highrise, island };
export let currentMap = null;
export let HALF = 29;

// Clears the current map and builds `name` (falls back to the default map).
export function loadMap(scene, name) {
  if (!MAPS[name]) name = 'depot';
  clearMap(scene);
  const m = BUILD[name]();
  HALF = m.half || 29;
  scene.add(world);
  scene.background = new THREE.Color(m.sky);
  scene.fog = new THREE.Fog(m.sky, m.fog[0], m.fog[1]);
  for (const [x, z] of m.spawns) if (!boxes.some(b => b.min.y < 1 && x + R > b.min.x && x - R < b.max.x && z + R > b.min.z && z - R < b.max.z)) SPAWNS.push([x, z]);
  if (Array.isArray(m.chests)) CHESTS.push(...m.chests);
  if (Array.isArray(m.vehicles)) VEHICLES.push(...m.vehicles);
  console.assert(SPAWNS.length >= 8, `map ${name} has only ${SPAWNS.length} clear spawns`);
  currentMap = name;
  return name;
}
