// Aim Trainer: 60 seconds against three targets (game.js runs the match; this is the mode's own rules)
import { gainXP } from '../hud.js';
import * as P from '../progress.js';
import { $, rand, V3 } from '../util.js';
import { HALF } from '../world.js';
import { boardRow } from './runs.js';
import { _o, eyePos, game, now, player, prog, rayWorld, scene, setState, showOverXp, state } from '../game.js';

// ---------- aim trainer: 60 seconds, hit as many targets as you can ----------
export const AIM = { list: [], end: 0, hits: 0, shots: 0 };
const aimM = new THREE.MeshLambertMaterial({ color: 0xe5432d, emissive: 0x501010 }), aimG = new THREE.SphereGeometry(0.45, 16, 12);
// put a target somewhere in front of the player, 8 to 26 m out, in plain sight
export function aimTarget(tg) {
  for (let i = 0; i < 40; i++) {
    const a = player.yaw + rand(-0.9, 0.9), d = rand(8, 26);
    const p = new V3(player.pos.x - Math.sin(a) * d, rand(0.8, 3.5), player.pos.z - Math.cos(a) * d);
    if (Math.abs(p.x) > HALF || Math.abs(p.z) > HALF) continue;
    eyePos(player, _o); const dir = p.clone().sub(_o), dist = dir.length(); dir.divideScalar(dist);
    if (rayWorld(_o, dir, dist) < dist - 0.6) continue;
    tg.base = p; tg.phase = rand(0, 6); tg.m.position.copy(p); return;
  }
  tg.base = new V3(rand(-4, 4), 2, rand(-4, 4)); tg.phase = 0; tg.m.position.copy(tg.base);
}
export function startAim() {
  stopAim(); AIM.end = now + 60; AIM.hits = AIM.shots = 0;
  for (let i = 0; i < 3; i++) { const tg = { m: new THREE.Mesh(aimG, aimM), r: 0.45 }; tg.m.castShadow = true; scene.add(tg.m); AIM.list.push(tg); aimTarget(tg); }
}
export function stopAim() { for (const t of AIM.list) scene.remove(t.m); AIM.list.length = 0; }
export function updateAim() {
  if (game !== 'aim') return;
  const sway = Math.min(1.8, AIM.hits / 10); // targets start drifting once you're warmed up
  for (const t of AIM.list) t.m.position.x = t.base.x + Math.sin(now * 1.3 + t.phase) * sway;
  if (now >= AIM.end && state === 'playing') endAim();
}
function endAim() {
  setState('over');
  const acc = AIM.shots ? Math.round(100 * AIM.hits / AIM.shots) : 0, best = AIM.hits > prog.bestAim;
  if (best) prog.bestAim = AIM.hits;
  $('overTitle').textContent = `${AIM.hits} hits · ${acc}% accuracy`;
  const tbl = $('overTbl'); tbl.textContent = '';
  for (const [k, v] of [['Shots', AIM.shots], ['Personal best', best ? `${prog.bestAim} (new!)` : prog.bestAim]]) {
    const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td'); a.textContent = k; b.textContent = v; tr.append(a, b); tbl.append(tr);
  }
  gainXP(P.XP.match + AIM.hits * 8, { match: true });
  showOverXp(); stopAim();
  boardRow('aim', AIM.hits, acc);
}
