// Spud Brawl: a free-for-all arena shooter. three.js is loaded as a global by index.html.
import {
  ACTIONS, AMMO, AMMO_OF, CHEST_GUNS, DEFAULT_BINDS, EYE, FRAGS, G, GAMES, GUNGAME, H, HEALS, JUMP, KNIFE, MAX_SLOTS, MOVE, PLAYER_COLOR, R,
  RARITY, SCORE_LIMIT, SNIPER, STEP, TEAM_NAMES, THROWABLES, WEAPONS, WNAMES, keyName, validCode
} from './config.js';
import { CHESTS, HALF, ICE, LIMIT, MAPS, PADS, PAD_R, SPAWNS, STAIRS, boxGeo, boxes, currentMap, loadMap } from './world.js';
import { initAudio, setVolume, sfx, sfxShot, toggleMute } from './audio.js';
import { setMusic, setMusicOn } from './music.js';
import * as P from './progress.js';
import { applyLook } from './skins.js';
import { initArmory, openArmory } from './armory.js';
import { initAccount, progressSaved } from './account.js';
import { $, V3, clamp, rand } from './util.js';
import { navPoint, setupBots, stairWaypoint, updateBot, updateRoster } from './bots.js';
import {
  applyRemote, botHost, checkWinOnline, cleanName, cleanRoom, leaveRoom, myHat, net, netEvent, netSend, num, r2, sendLock, startOnline,
  updateNetStatus, updateRemotes
} from './netsync.js';
import {
  MM, addFeed, awardKill, buildTable, clearBanners, fillLevelBar, fx, gainXP, hitMarker, loadoutChanged, resetRun, run, scoresChanged, setText,
  toast, toggleBigMap, updateHUD, updateProfile, updateScoreTop
} from './hud.js';

const UP = new V3(0, 1, 0);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- settings ----------
export const settings = { name: 'Soldier', diff: 'normal', bots: 5, sens: 1, adsSens: 1, fov: 75, vol: 1, mode: 'bots', game: 'ffa', room: 'brawl', map: 'depot', music: true,
  ts: 4, lim: 25, side: 'together', pub: true, sq: 1, hok: 0 }; // hok: battle royale, health back for each elimination (0, 25 or 50) // sq: battle royale squad size (1 solo, 2 duos, 3 trios, 4 squads) // ts: players a side and lim: score to win (team deathmatch); pub: list my room
try { Object.assign(settings, JSON.parse(localStorage.getItem('spudbrawl') || '{}')); } catch (e) {}
function saveSettings() { try { localStorage.setItem('spudbrawl', JSON.stringify(settings)); } catch (e) {} }
// progression (XP, unlocks, loadout) is saved per browser, separately from settings
const PROGRESS_KEY = 'spudbrawl-progress';
let progRaw = null; try { progRaw = localStorage.getItem(PROGRESS_KEY); } catch (e) {}
export const prog = P.loadProgress(progRaw);
export function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)); } catch (e) {} progressSaved(); } // progressSaved: cloud copy, if signed in
// this callsign hits 1.5x as hard (guns and frags)
const isMuted = name => String(name || '').trim().toLowerCase() === 'amimutted';
export const binds = { ...DEFAULT_BINDS };
if (settings.binds && typeof settings.binds === 'object') {
  const sb = settings.binds;
  if (!settings.bindsV) { // v2: inventory on Tab, map on M, so scores and mute moved
    if (sb.inv === 'KeyI') delete sb.inv;
    if (sb.scores === 'Tab') delete sb.scores;
    if (sb.mute === 'KeyM') delete sb.mute;
  }
  for (const k in DEFAULT_BINDS) if (validCode(sb[k])) binds[k] = sb[k];
}
settings.bindsV = 2;

const bound = a => keys[binds[a]] === true;
function actionFor(code) { for (const k in binds) if (binds[k] === code) return k; return null; }

// ---------- renderer / scene ----------
export const host = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
host.appendChild(renderer.domElement);
const canvas = renderer.domElement;

export const scene = new THREE.Scene(); // sky and fog come from the map
export const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xfff4dc, 0x5d7a3a, 0.7));
const sun = new THREE.DirectionalLight(0xfff6e6, 0.85);
sun.position.set(25, 42, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 130 });
sun.shadow.bias = -0.0008;
scene.add(sun); scene.add(sun.target);

// view-model scene (rendered on top so the gun never clips into walls)
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xfff4dc, 0x6b5a40, 0.95));
const vmLight = new THREE.DirectionalLight(0xffffff, 0.55); vmLight.position.set(1, 2, 1); vmScene.add(vmLight);

let sizeKey = '';
function resize() {
  const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  const key = w + 'x' + h + '@' + dpr; if (key === sizeKey) return; sizeKey = key;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = vmCam.aspect = w / h;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- geometry helpers ----------
function rayBox(o, d, b) {
  let tmin = 0, tmax = Infinity;
  for (const a of 'xyz') {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < b.min[a] || o[a] > b.max[a]) return null; }
    else {
      let t1 = (b.min[a] - o[a]) / d[a], t2 = (b.max[a] - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
export function rayWorld(o, d, maxT) {
  let best = maxT;
  if (d.y < -1e-6) { const t = -o.y / d.y; if (t < best) best = t; }
  for (const b of boxes) { const t = rayBox(o, d, b); if (t !== null && t < best) best = t; }
  return best;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); return t > 0 ? t : null;
}
export function fwdVec(yaw, pitch, out = new V3()) {
  const c = Math.cos(pitch); return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}
function spreadDir(f, s) {
  const right = new V3().crossVectors(f, UP); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
  const up = new V3().crossVectors(right, f).normalize();
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
  return f.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
}
export const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
// How tall someone is right now, as a fraction of standing height: crouching and sliding lower you.
export const poseK = e => 1 - 0.23 * e.crouch * (1 - e.slideK) - 0.41 * e.slideK;
// hit spheres at standing height: [height, radius, zone]; scaled down by poseK
const HITS = [[1.67, 0.22, 'head'], [1.25, 0.34, 'body'], [0.55, 0.3, 'legs']];
export const eyePos = (e, out = new V3()) => out.set(e.pos.x, e.pos.y + EYE * poseK(e), e.pos.z);
export const headC = (e, out = new V3()) => out.set(e.pos.x, e.pos.y + 1.67 * poseK(e), e.pos.z);
export const bodyC = (e, out = new V3()) => out.set(e.pos.x, e.pos.y + 1.25 * poseK(e), e.pos.z);

// ---------- physics ----------
function overlaps(e, b, h = H * poseK(e)) {
  return e.pos.x + R > b.min.x && e.pos.x - R < b.max.x && e.pos.z + R > b.min.z && e.pos.z - R < b.max.z && e.pos.y + h > b.min.y && e.pos.y < b.max.y;
}
const canStand = e => !boxes.some(b => overlaps(e, b, H));
// Moon Knives plays in low gravity
const grav = () => (game === 'moon' ? G * 0.38 : G);
export function moveEntity(e, dt) {
  e.vel.y -= grav() * dt;
  e.bumped = false;
  for (const ax of ['x', 'z']) {
    e.pos[ax] += e.vel[ax] * dt;
    for (const b of boxes) {
      if (!overlaps(e, b)) continue;
      if (b.max.y - e.pos.y <= STEP && e.onGround) { e.pos.y = b.max.y; continue; }
      const c = (b.min[ax] + b.max[ax]) / 2;
      e.pos[ax] = e.pos[ax] < c ? b.min[ax] - R - 0.001 : b.max[ax] + R + 0.001;
      e.vel[ax] = 0; e.bumped = true;
    }
  }
  e.pos.y += e.vel.y * dt; e.onGround = false;
  if (e.pos.y <= 0) { e.pos.y = 0; if (e.vel.y < 0) e.vel.y = 0; e.onGround = true; }
  for (const b of boxes) {
    if (!overlaps(e, b)) continue;
    if (e.vel.y <= 0 && e.pos.y > b.max.y - 0.7) { e.pos.y = b.max.y; e.vel.y = 0; e.onGround = true; }
    else if (e.vel.y > 0) { e.pos.y = b.min.y - H * poseK(e) - 0.001; e.vel.y = 0; }
  }
  const lim = LIMIT - R; e.pos.x = clamp(e.pos.x, -lim, lim); e.pos.z = clamp(e.pos.z, -lim, lim); // never over the boundary wall
  if (e.onGround) {
    e.launched = false;
    for (const pd of PADS) if (Math.abs(e.pos.y - pd.y) < 0.3 && Math.hypot(e.pos.x - pd.x, e.pos.z - pd.z) < PAD_R) { launch(e, pd); break; }
  }
}
// a jump pad: an arc that peaks `arc` above the landing spot and comes down on it; steering in the air is weak
// until you land, so you get there without touching anything
function launch(e, pd) {
  const g = grav(), vy = Math.sqrt(2 * g * (pd.ty - e.pos.y + pd.arc)), t = vy / g + Math.sqrt(2 * pd.arc / g);
  e.vel.set((pd.tx - e.pos.x) / t, vy, (pd.tz - e.pos.z) / t); e.onGround = false; e.launched = true;
  if (e.slide > 0) e.slide = 0;
  if (e === player) sfx.pad();
}
// how much grip the ground gives: 1 normally, a lot less on ice
export const grip = e => (e.onGround && e.pos.y < 0.1 && ICE.some(([x0, x1, z0, z1]) => e.pos.x > x0 && e.pos.x < x1 && e.pos.z > z0 && e.pos.z < z1) ? 0.14 : 1);

// ---------- soldiers ----------
// Built from boxes, facing -z, feet at y = 0. Legs pivot at the hips and knees; the upper body
// (torso, head, arms, gun) leans for crouch and slide, and the arms follow the aim pitch.
const HIP = 0.91;
const SKINS = [0xf1c6a0, 0xd9a47a, 0xb07a52, 0x7a4b2e, 0xe8b894];
const SM = {
  boot: new THREE.MeshLambertMaterial({ color: 0x2a2620 }), gear: new THREE.MeshLambertMaterial({ color: 0x3b3f2e }),
  visor: new THREE.MeshLambertMaterial({ color: 0x15181c }), glove: new THREE.MeshLambertMaterial({ color: 0x2f2b25 }),
};
export const UNIFORM_IDS = P.UNIFORMS.map(u => u[0]), CAMO_IDS = P.CAMOS.map(c => c[0]);
export const pick = a => a[(Math.random() * a.length) | 0];
export const randomLook = () => ({ uniform: pick(UNIFORM_IDS), camo: pick(CAMO_IDS.filter(c => c !== 'nebula')) });
function piece(parent, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(boxGeo, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
// name tag over a soldier; lv adds a level badge in front of the name
function nameSprite(name, color, lv) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 64;
  const g = c.getContext('2d'), tag = lv ? String(lv) : '';
  let size = 30;
  const fit = () => {
    g.font = `800 ${size}px Rubik, system-ui, sans-serif`;
    const tw = tag ? g.measureText(tag).width + 18 : 0;
    return { tw, total: tw + g.measureText(name).width };
  };
  let m = fit(); while (m.total > 300 && size > 14) { size -= 2; m = fit(); }
  g.textBaseline = 'middle';
  let x = 160 - m.total / 2;
  if (tag) {
    g.fillStyle = 'rgba(20,12,4,.85)'; g.fillRect(x, 32 - size * 0.62, m.tw - 6, size * 1.24);
    g.fillStyle = '#ffc83d'; g.textAlign = 'center'; g.fillText(tag, x + (m.tw - 6) / 2, 33);
    x += m.tw;
  }
  g.textAlign = 'left'; g.lineWidth = 6; g.strokeStyle = 'rgba(20,12,4,.85)'; g.strokeText(name, x, 32);
  g.fillStyle = color; g.fillText(name, x, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(2.375, 0.475, 1); s.position.y = 2.3; return s;
}
export function setTag(mesh, name, color, lv) {
  const u = mesh.userData;
  if (u.tag) { mesh.remove(u.tag); u.tag.material.map.dispose(); u.tag.material.dispose(); }
  u.tag = nameSprite(name, color, lv); mesh.add(u.tag);
}
// look: { uniform, camo } ids from progress.js LOOKS. Legs and arms wear the uniform; vest and helmet keep the team color.
export function soldierMesh(name, color, addToScene = true, look = {}) {
  const g = new THREE.Group(), team = new THREE.Color(color);
  const vestM = new THREE.MeshLambertMaterial({ color: team.clone().lerp(new THREE.Color(0x4a4d3a), 0.5) });
  const helmM = new THREE.MeshLambertMaterial({ color: team.clone().lerp(new THREE.Color(0x3d4030), 0.35) });
  const skinM = new THREE.MeshLambertMaterial({ color: SKINS[(Math.random() * SKINS.length) | 0] });
  const uniM = new THREE.MeshLambertMaterial({ color: 0x55593f }), gunM = new THREE.MeshLambertMaterial({ color: 0x2b2e33 });
  applyLook(uniM, look.uniform || 'olive'); applyLook(gunM, look.camo || 'factory');
  const legs = [-1, 1].map(s => {
    const hip = new THREE.Group(); hip.position.set(s * 0.12, HIP, 0); g.add(hip);
    piece(hip, uniM, 0.19, 0.46, 0.22, 0, -0.23, 0);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    piece(knee, uniM, 0.17, 0.4, 0.2, 0, -0.2, 0);
    piece(knee, SM.boot, 0.2, 0.1, 0.3, 0, -0.42, -0.04);
    return { hip, knee };
  });
  const upper = new THREE.Group(); upper.position.y = HIP; g.add(upper);
  piece(upper, uniM, 0.38, 0.16, 0.24, 0, 0.04, 0);
  piece(upper, vestM, 0.44, 0.52, 0.27, 0, 0.36, 0);
  piece(upper, SM.gear, 0.36, 0.24, 0.07, 0, 0.36, -0.16); // chest rig
  piece(upper, SM.gear, 0.3, 0.3, 0.12, 0, 0.4, 0.19);     // backpack
  piece(upper, skinM, 0.12, 0.08, 0.12, 0, 0.65, 0);       // neck
  const head = new THREE.Group(); head.position.y = 0.76; upper.add(head);
  piece(head, skinM, 0.24, 0.26, 0.25, 0, 0, 0);
  piece(head, helmM, 0.3, 0.13, 0.31, 0, 0.15, 0.01);
  piece(head, helmM, 0.32, 0.03, 0.34, 0, 0.09, 0.01);
  piece(head, SM.visor, 0.22, 0.06, 0.02, 0, 0.03, -0.13);
  const aim = new THREE.Group(); aim.position.y = 0.56; upper.add(aim);
  piece(aim, uniM, 0.12, 0.12, 0.4, 0.175, -0.06, -0.19).rotation.y = -0.23;  // right arm to the grip
  piece(aim, uniM, 0.12, 0.12, 0.6, -0.08, -0.04, -0.26).rotation.y = -0.5;   // left arm to the handguard
  piece(aim, SM.glove, 0.1, 0.1, 0.1, 0.13, -0.12, -0.38);
  piece(aim, SM.glove, 0.1, 0.1, 0.1, 0.06, -0.08, -0.52);
  piece(aim, gunM, 0.08, 0.13, 0.62, 0.1, -0.04, -0.46); // receiver + barrel
  piece(aim, gunM, 0.06, 0.18, 0.08, 0.1, -0.17, -0.42); // magazine
  piece(aim, gunM, 0.07, 0.1, 0.22, 0.1, -0.06, -0.08);  // stock
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.1, -0.02, -0.8); aim.add(muzzle);
  g.userData = { legs, upper, aim, muzzle, vestM, uniM, gunM, skinM, bob: 0 };
  if (name) setTag(g, name, color, look.lv);
  if (addToScene) scene.add(g);
  return g;
}
export function poseSoldier(e, dt) {
  const m = e.mesh, u = m.userData, sp = Math.hypot(e.vel.x, e.vel.z);
  if (u.tag) {
    const ally = sameTeam(e, player);
    u.tag.visible = ally || !versus(); // zombies and the range: everyone's on your side
    if (u.tag.material.depthTest === ally) { u.tag.material.depthTest = !ally; u.tag.renderOrder = ally ? 10 : 0; }
  }
  const run = Math.min(1, sp / 6) * (1 - e.slideK), c = e.crouch * (1 - e.slideK), s = e.slideK;
  u.bob += dt * sp * 1.9;
  const ph = Math.floor(u.bob / Math.PI);
  if (ph !== u.stepPh) {
    u.stepPh = ph;
    if (e !== player && sp > 2 && c < 0.5 && !e.drop && !e.zombie && e.alive !== false && state === 'playing') { const v = distVol(e.pos) * (sp > 6.5 ? 1 : 0.7); if (v > 0.08) sfx.step(v * 0.9); }
  }
  const sw = Math.sin(u.bob) * 0.7 * run * (1 - 0.5 * c);
  const hipY = HIP - 0.35 * c - 0.57 * s;
  u.upper.position.y = hipY + Math.abs(Math.sin(u.bob)) * 0.04 * run;
  u.upper.rotation.x = -0.28 * c + 0.55 * s - 0.08 * run;
  u.aim.rotation.x = clamp(e.pitch, -1.2, 1.2) - u.upper.rotation.x;
  u.legs.forEach(({ hip, knee }, i) => {
    const side = i ? -1 : 1;
    hip.position.y = hipY;
    hip.rotation.x = 1.5 * c + 1.35 * s + side * sw;
    knee.rotation.x = -1.5 * c - 0.15 * s - Math.max(0, side * Math.sin(u.bob + 1.2)) * 0.9 * run;
  });
  m.position.copy(e.pos); m.rotation.set(0, e.yaw, 0);
  e.flash = Math.max(0, e.flash - dt);
  u.vestM.emissive.setRGB(e.flash * 5, e.flash * 1.2, 0);
}
export const muzzleOf = e => e.mesh.userData.muzzle.getWorldPosition(new V3());

// ---------- pools: particles, tracers, bodies, blasts ----------
const parts = [], partMats = new Map();
const partMat = c => { if (!partMats.has(c)) partMats.set(c, new THREE.MeshLambertMaterial({ color: c })); return partMats.get(c); };
for (let i = 0; i < 280; i++) { const m = new THREE.Mesh(boxGeo, partMat(0xffffff)); m.visible = false; scene.add(m); parts.push({ m, vel: new V3(), life: 0, max: 1, size: 0.1 }); }
let partIdx = 0;
export function burst(pos, colors, n, speed, size = 0.12, life = 0.9) {
  for (let i = 0; i < n; i++) {
    const p = parts[partIdx++ % parts.length];
    p.m.material = partMat(colors[i % colors.length]); p.m.position.copy(pos); p.m.visible = true;
    p.vel.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
    p.life = p.max = life * rand(0.6, 1.1); p.size = size * rand(0.6, 1.3);
    p.m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
  }
}
function updateParts(dt) {
  for (const p of parts) {
    if (!p.m.visible) continue;
    p.life -= dt; if (p.life <= 0) { p.m.visible = false; continue; }
    p.vel.y -= 16 * dt; p.m.position.addScaledVector(p.vel, dt);
    if (p.m.position.y < 0.04) { p.m.position.y = 0.04; p.vel.multiplyScalar(0.4); p.vel.y = Math.abs(p.vel.y) * 0.3; }
    p.m.scale.setScalar(p.size * Math.min(1, p.life / p.max * 2));
  }
}
const tracers = [];
for (let i = 0; i < 48; i++) {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 1 }));
  l.frustumCulled = false; l.visible = false; l.userData.life = 0; scene.add(l); tracers.push(l);
}
let trIdx = 0;
export function tracer(a, b, mine) {
  const t = tracers[trIdx++ % tracers.length], arr = t.geometry.attributes.position.array;
  arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
  t.geometry.attributes.position.needsUpdate = true;
  t.material.color.set(mine ? 0xfff3b0 : 0xffb347); t.visible = true; t.userData.life = 0.08;
}
const piles = []; // fallen soldiers, cleared after a while
export function corpse(t) {
  const src = t.mesh || (t.corpseSrc ||= soldierMesh('', t.color, false, { uniform: prog.uniform }));
  if (!t.mesh && t.guns[t.weapon]) applyLook(src.userData.gunM, prog.camo[t.guns[t.weapon].id]);
  const ud = src.userData; src.userData = {}; // clone() would JSON-copy userData, which holds scene objects
  const g = src.clone(); src.userData = ud;    // shares geometry and materials
  g.traverse(o => { if (o.isSprite) o.visible = false; });
  g.visible = true; g.rotation.order = 'YXZ';
  g.position.set(t.pos.x, t.pos.y + 0.14, t.pos.z); g.rotation.set(Math.PI / 2 * 0.96, t.yaw + rand(-0.3, 0.3), 0);
  scene.add(g);
  piles.push({ g, born: now });
  if (piles.length > 24) scene.remove(piles.shift().g);
}
const blasts = [];
for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffa531, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; scene.add(m); blasts.push({ m, t: 1 }); }
let blastIdx = 0;

export const distVol = pos => state === 'playing' ? clamp(1 - pos.distanceTo(camera.position) / 60, 0, 1) * 0.7 : 0;

// ---------- game state ----------
export let state = 'menu', now = 0, mode = 'bots', game = 'ffa';
// other modules read game live but can't assign an import: the room's game comes in through here
export function setGame(g) { game = g; }

export const ents = [];
export const player = newEntity(settings.name, PLAYER_COLOR, true, P.loadoutWeapons(prog));
ents.push(player);


// guns: the weapons this entity carries (weapon = slot in guns; guns[slot].id = index in WEAPONS). Set by gunsFor()
// on respawn; the player's carry their attachments. Remotes keep all of WEAPONS and weapon is the id they hold.
export function newEntity(name, color, isPlayer, guns = WEAPONS) {
  return { name, color, isPlayer, guns, pos: new V3(), vel: new V3(), yaw: 0, pitch: 0, onGround: false, hp: 100, alive: false,
    kills: 0, deaths: 0, lastHurt: -99, respawnAt: Infinity, weapon: 0, prevWeapon: 1, ammo: guns.map(w => w.mag), streak: 0,
    reloading: false, reloadEnd: 0, nextShot: 0, nadeReady: 0, protectUntil: 0, mesh: null, flash: 0, bob: 0, bumped: false,
    crouch: 0, slideK: 0, slide: 0, slideReady: 0, slideDir: new V3(), sprint: false, sprintBlock: 0, stunUntil: 0, blindUntil: 0, nade: 'frag',
    remote: false, peer: null, m: 1, res: {}, heals: { bandage: 0, medkit: 0 }, useT: null, drop: null };
}
function pickSpawn(e) {
  const others = ents.filter(o => o !== e && o.alive && !sameTeam(o, e)); // as far from enemies as we can
  let best = null, bestD = -1;
  for (let i = 0; i < 5; i++) {
    const s = SPAWNS[(Math.random() * SPAWNS.length) | 0];
    let md = Infinity; for (const o of others) md = Math.min(md, Math.hypot(o.pos.x - s[0], o.pos.z - s[1]));
    if (md > bestD) { bestD = md; best = s; }
  }
  return best;
}
export function respawn(e) {
  const s = pickSpawn(e);
  e.pos.set(s[0] + rand(-0.5, 0.5), 0, s[1] + rand(-0.5, 0.5)); e.vel.set(0, 0, 0);
  e.guns = gunsFor(e); e.weapon = e.isPlayer ? 0 : (Math.random() * e.guns.length) | 0; e.prevWeapon = e.guns.length > 1 ? 1 : 0;
  e.nade = e.isPlayer ? prog.nade : 'frag'; e.stunUntil = e.blindUntil = 0;
  e.hp = 100; e.alive = true; e.reloading = false; e.ammo = e.guns.map(w => w.mag); e.streak = 0;
  e.crouch = e.slideK = e.slide = 0; e.sprint = e.crouchOn = false;
  e.yaw = Math.atan2(e.pos.x, e.pos.z) + rand(-0.4, 0.4); e.pitch = 0; e.protectUntil = now + 1.5; e.lastHurt = -99;
  e.res = { light: 0, shells: 0, heavy: 0, rockets: 0 }; e.heals = { bandage: 0, medkit: 0 }; e.frags = 0; e.useT = null; e.drop = null; e.landedAt = -99; e.hurtBy = null;
  if (e.isPlayer) endSpec();
  if (!e.isPlayer) {
    e.ai.target = null; e.ai.visible = false; e.ai.goal = null; e.climb = null;
    e.mesh.visible = true; e.mesh.position.copy(e.pos); setCanopy(e, false); e.ai.loot = null;
  }
  if (oneLife()) startDrop(e);
}

// ---------- game types ----------
// What each entity carries: gun game walks a ladder, the minigames hand out one weapon, otherwise your loadout
// (bots get three random guns).
export function gunsFor(e) {
  const arm = i => (e.isPlayer ? P.armedWeapon(prog, i) : WEAPONS[i]);
  if (game === 'gungame') return [arm(GUNGAME[Math.min(GUNGAME.length - 1, Math.floor(e.kills / 2))])];
  if (game === 'moon') return [arm(KNIFE)];
  if (game === 'snipe') return [{ ...arm(SNIPER), dmg: 100 }]; // one body shot
  if (game === 'br') return [arm(KNIFE)]; // the rest is in the chests
  if (e.isPlayer) return P.loadoutWeapons(prog);
  return [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 3).map(i => WEAPONS[i]);
}
export const scoreLimit = () => (game === 'gungame' ? GUNGAME.length * 2 - 1 : game === 'tdm' ? cfg().lim : SCORE_LIMIT);
// team deathmatch: everyone has a team (0 or 1); teammates can't hurt each other
export const teamsOn = () => game === 'tdm';
// battle royale squads (duos, trios, squads): team is the squad number; squadmates can't hurt each other either
export const squadsOn = () => game === 'br' && (cfg().sq | 0) > 1;
const alliesOn = () => teamsOn() || squadsOn();
export const sameTeam = (a, b) => alliesOn() && a !== b && a.team !== undefined && a.team === b.team;
// which squad each of n bots joins: the players' squads fill up first, then the bots make squads of their own
export function botSquads(hum, sq, n) {
  const size = new Map(); for (const h of hum) if (h.team !== undefined) size.set(h.team, (size.get(h.team) || 0) + 1);
  const out = [];
  for (const [t, k] of size) for (let i = k; i < sq && out.length < n; i++) out.push(t);
  for (let t = 0; out.length < n; t++) { if (size.has(t)) continue; for (let i = 0; i < sq && out.length < n; i++) out.push(t); }
  return out;
}
const SQUAD_NAMES = ['', 'Solo', 'Duos', 'Trios', 'Squads'];
// the match settings: the room's online, the menu's offline
export const cfg = () => (mode === 'online' && net.cfg ? net.cfg : { bots: settings.bots, diff: settings.diff, ts: settings.ts, lim: settings.lim, side: settings.side, sq: clamp(settings.sq | 0, 1, 4), hok: [0, 25, 50].includes(settings.hok) ? settings.hok : 0 });
// team scores: every soldier's kills plus the kills of bots that have left (bank). Online the bot host adds them up.
export const teams = { bank: [0, 0] };
export function teamScore() {
  if (mode === 'online' && !botHost() && net.tscore) return net.tscore;
  const s = [...teams.bank];
  for (const e of ents) if ((e.team === 0 || e.team === 1) && (!e.remote || e.netbot || e.m === net.m)) s[e.team] += e.kills;
  return s;
}
// who has won, if anyone: a soldier, or { name, team } for a team
export function winnerNow() {
  if (!versus()) return null;
  if (oneLife()) { // last one standing, once there were at least two
    const field = ents.filter(inMatch), up = field.filter(isAliveNow);
    if (squadsOn()) { // last squad standing
      const sq = new Set(field.map(e => e.team)), live = new Set(up.map(e => e.team));
      if (sq.size < 2 || live.size > 1) return null;
      const t = live.size ? [...live][0] : player.team, lead = up[0] || player;
      return { name: t === player.team ? 'Your squad' : `${lead.name}'s squad`, team: t };
    }
    return field.length >= 2 && up.length <= 1 ? up[0] || player : null;
  }
  if (teamsOn()) { const s = teamScore(), lim = scoreLimit(); return s[0] >= lim ? { name: 'Blue team', team: 0 } : s[1] >= lim ? { name: 'Red team', team: 1 } : null; }
  return ents.find(e => !e.zombie && (!e.remote || e.netbot || e.m === net.m) && e.kills >= scoreLimit()) || null;
}
// how other screens name a soldier in events: a player's id, 'b' + a bot's id, or '' for nobody
const idOf = e => (!e ? '' : e.isPlayer ? net.myPeer : e.remote ? e.peer : e.bid ? 'b' + e.bid : '');
export const versus = () => game !== 'zombies' && game !== 'aim';
export const oneLife = () => game === 'br';
export const nadesOn = () => game === 'ffa' || game === 'zombies' || game === 'br'; // battle royale: only the frags you find
// gun game: after a kill, move up to the next weapon on the ladder
export function gunGameStep(e) {
  if (game !== 'gungame' || e.remote || !e.alive) return;
  const g = gunsFor(e)[0]; if (g.id === e.guns[0].id) return;
  e.guns = [g]; e.weapon = 0; e.ammo = [g.mag]; e.reloading = false; e.nextShot = now + 0.3;
  if (e.isPlayer) { refreshVM(); dressVM(); vm.switchT = 0.3; toast('Next weapon: <em></em>', g.name, false); }
}

// ---------- combat ----------
export function startReload(e) {
  const w = e.guns[e.weapon];
  if (e.reloading || e.useT || e.ammo[e.weapon] >= w.mag) return;
  const at = AMMO_OF[w.id];
  if (carries(e) && at && !(e.res[at] > 0)) { if (e.isPlayer && now > (e.noAmmoAt || 0)) { toast('Out of <em></em>', AMMO[at].name, false); e.noAmmoAt = now + 1.5; } return; }
  e.reloading = true; e.reloadStart = now; e.reloadEnd = now + w.reload; e.reloadWeapon = e.weapon;
  if (e.isPlayer) sfx.reload();
}
function switchWeapon(e, i) {
  if (i === e.weapon || i < 0 || i >= e.guns.length) return;
  e.prevWeapon = e.weapon; e.weapon = i; e.reloading = false; e.useT = null;
  e.nextShot = Math.max(e.nextShot, now + 0.3);
  if (e.isPlayer) { vm.switchT = 0.3; refreshVM(); }
  if (e.ammo[i] <= 0) startReload(e);
}
export function currentSpread(e) {
  const w = e.guns[e.weapon];
  let s = w.spread;
  if (e.isPlayer) {
    const moving = Math.hypot(e.vel.x, e.vel.z) > 1;
    if (moving) s += 0.012; if (!e.onGround) s += 0.03; if (e.slide > 0) s += 0.015;
    if (zoomed) s *= w.scope ? 0.5 : 0.4;
    else { if (w.scope) s += 0.05; if (w.hipK) s *= w.hipK; } // laser sight tightens hip fire
    s *= 1 - 0.25 * e.crouch * (1 - e.slideK);
  } else s += e.ai.d.inacc * (Math.hypot(e.vel.x, e.vel.z) > 1 ? 1.15 : 1);
  return s;
}
export const _o = new V3(), _f = new V3(), _h = new V3(), _b = new V3();
export const BLOOD = [0x8b1a1a, 0x6a1212];
export function tryFire(e) {
  const w = e.guns[e.weapon], melee = w.kind === 'melee';
  if (now < e.nextShot || e.reloading || e.drop) return false;
  if (e.useT) e.useT = null; // shooting stops a heal
  if (!melee && e.ammo[e.weapon] <= 0) { startReload(e); return false; }
  if (!melee) e.ammo[e.weapon]--;
  e.nextShot = now + w.rate; if (!melee) e.sprintBlock = now + 0.35;
  eyePos(e, _o); fwdVec(e.yaw, e.pitch, _f);
  const spread = melee ? 0 : currentSpread(e);
  if (w.kind === 'rpg') {
    const pos = _o.clone().addScaledVector(_f, 0.7), vel = spreadDir(_f, spread).multiplyScalar(42);
    spawnNade(pos, vel, e, 'rocket');
    if (e.isPlayer && mode === 'online') netEvent('n', r2(pos.x), r2(pos.y), r2(pos.z), r2(vel.x), r2(vel.y), r2(vel.z), NADE_TYPES.indexOf('rocket'));
  } else {
    const muzzle = muzzlePos(e), acc = new Map(), ends = [];
    for (let i = 0; i < w.pellets; i++) ends.push(hitscan(e, _o, spreadDir(_f, spread), w, muzzle, acc));
    if (e.isPlayer && game === 'aim') { AIM.shots++; if (acc.aimHit) AIM.hits++; }
    if (mode === 'online' && (e.isPlayer || e.ai)) {
      // others see my shots from my events; the bots I run show theirs as a flag in their state
      if (e.isPlayer) { const flat = []; if (!melee) ends.slice(0, 3).forEach(h => flat.push(r2(h.x), r2(h.y), r2(h.z))); netEvent('s', w.id, ...flat); }
      else e.fired = true;
      for (const [t, a] of acc) {
        t.hp -= a.dmg;
        netEvent('h', t.peer, Math.round(a.dmg * 10) / 10, a.head ? 1 : 0, w.id, e.ai ? idOf(e) : '');
        if (e.isPlayer) { hitMarker(a.head, t.hp <= 0); a.head ? sfx.head() : sfx.hit(); }
      }
    }
  }
  if (e.isPlayer) {
    sfxShot(w.id, w.sup ? 0.35 : 1);
    e.pitch = clamp(e.pitch + w.kick * rand(0.7, 1.1), -1.45, 1.45); e.yaw += w.kick * rand(-0.35, 0.35);
    vm.kick = Math.min(1, vm.kick + (w.id === 0 || w.id === 3 ? 0.35 : 1)); if (!w.sup && !melee) vm.flashUntil = now + 0.045;
  } else sfxShot(w.id, distVol(e.pos));
  if (!melee && e.ammo[e.weapon] <= 0) startReload(e);
  return true;
}
// one ray: walls, then soldiers (and aim-trainer targets). The knife is a short ray with fatter hit spheres.
function hitscan(shooter, o, d, w, muzzle, acc) {
  const melee = w.kind === 'melee', pad = melee ? 0.3 : 0;
  let best = rayWorld(o, d, w.range), target = null, zone = null, aimHit = null;
  for (const t of ents) {
    if (t === shooter || !t.alive || t.drop || (game === 'zombies' && !t.zombie && !shooter.zombie) || sameTeam(t, shooter)) continue; // no friendly fire
    const k = poseK(t);
    for (const [y, r, z] of HITS) {
      const th = raySphere(o, d, _h.set(t.pos.x, t.pos.y + y * k, t.pos.z), r + pad);
      if (th !== null && th < best) { best = th; target = t; zone = z; }
    }
  }
  if (shooter.isPlayer && game === 'aim') for (const tg of AIM.list) {
    const th = raySphere(o, d, tg.m.position, tg.r);
    if (th !== null && th < best) { best = th; aimHit = tg; target = null; }
  }
  const head = zone === 'head';
  const hit = o.clone().addScaledVector(d, best);
  if (!melee) tracer(muzzle, hit, shooter.isPlayer);
  if (aimHit) { acc.aimHit = true; hitMarker(false, false); sfx.hit(); burst(hit, [0xe5432d, 0xffffff], 10, 4, 0.08, 0.5); aimTarget(aimHit); }
  else if (target) {
    let dmg = w.dmg * (head ? w.head : zone === 'legs' ? 0.85 : 1) * (shooter.isPlayer ? 1 : shooter.ai.d.dmg);
    if (w.pellets > 1) dmg *= clamp(1.25 - best / w.range, 0.35, 1);
    if (shooter.isPlayer && isMuted(shooter.name)) dmg *= 1.5;
    if (target.remote) {
      // online opponents own their health: send the hit, they apply it
      const a = acc.get(target) || { dmg: 0, head: false }; a.dmg += dmg; a.head = a.head || head; acc.set(target, a);
      target.flash = 0.12; burst(hit, BLOOD, head ? 6 : 3, 3, 0.07, 0.5);
    } else damage(target, dmg, shooter, w.name, head, hit);
  } else if (best < w.range) burst(hit, [0x8a8a84, 0xc2bdb0], 3, 2.5, 0.06, 0.4);
  return hit;
}
export function damage(t, amt, src, wname, head, pt) {
  if (t.remote || !t.alive || t.drop || now < t.protectUntil) return;
  t.hp -= amt; t.lastHurt = now; t.flash = 0.12; if (src && src !== t) t.hurtBy = src;
  if (pt) burst(pt, BLOOD, head ? 6 : 3, 3, 0.07, 0.5);
  if (src && src.isPlayer && t !== src) { hitMarker(head, t.hp <= 0); head ? sfx.head() : sfx.hit(); }
  if (t.isPlayer) { sfx.hurt(); if (src && src !== t) { fx.dmgFrom = src; fx.dmg = 1; } shake = Math.max(shake, 0.12); }
  if (t.ai && src && src !== t && src.alive && !sameTeam(src, t)) {
    const ai = t.ai;
    if (!ai.visible || ai.target !== src) { ai.target = src; ai.reactAt = now + ai.d.react * 0.6; ai.lastSeen.copy(src.pos); ai.lastSeenAt = now; ai.goal = null; }
  }
  if (t.hp <= 0) kill(t, src, wname, head);
}
function kill(t, src, wname, head) {
  if (t.zombie) return zombieDied(t, src, wname, head);
  t.alive = false; t.hp = 0; t.deaths++;
  const self = !src || src === t;
  if (!self) { src.kills++; gunGameStep(src); }
  // battle royale option: an elimination gives the shooter some health back (whoever runs them applies it)
  const hok = oneLife() && !self && !t.zombie ? cfg().hok | 0 : 0;
  if (hok && src.alive && !src.remote && src.hp < 100) { src.hp = Math.min(100, src.hp + hok); if (src.isPlayer) { sfx.heal(); toast('+<em></em> HP for the elimination', String(hok), false); } }
  addFeed(src, t, wname, head);
  bodyC(t, _b); burst(_b, [...BLOOD, new THREE.Color(t.color).getHex()], 14, 5, 0.1, 0.9);
  corpse(t);
  if (t.mesh) t.mesh.visible = false;
  if (oneLife()) { dropAll(t); t.useT = null; }
  t.respawnAt = (t.isPlayer && game === 'zombies') || oneLife() ? Infinity : now + (t.isPlayer ? 4 : 3); // zombies: back next wave
  if (t.isPlayer) {
    deathPos.copy(camera.position); killer = self ? null : src; t.diedAt = now;
    $('deathBy').textContent = wname === 'Storm' ? 'The storm got you' : self ? `Killed by your own ${wname === 'RPG' ? 'rocket' : wname.toLowerCase()}` : 'Killed by ' + src.name;
    $('deathHow').textContent = wname === 'Storm' ? 'Stay inside the circle.' : self ? 'Aim it a little further away.' : wname + (head ? ' \u00b7 headshot' : '');
    if (oneLife()) $('deathHow').textContent += ` \u00b7 you placed #${brAlive().length + 1}`;
    $('death').hidden = false; $('scope').hidden = true;
    deathButtons();
  }
  if (src && src.isPlayer && !self) { sfx.kill(); toast(`Eliminated <em></em>`, t.name, head); if (state === 'playing') awardKill(wname, head); }
  if (t.isPlayer && mode === 'online') netEvent('x', self ? '' : idOf(src), WNAMES.indexOf(wname), head ? 1 : 0);
  if (t.ai && mode === 'online') netEvent('bx', t.bid, self ? '' : idOf(src), WNAMES.indexOf(wname), head ? 1 : 0); // a bot I run went down
  scoresChanged(); updateScoreTop();
  if (mode === 'online') checkWinOnline();
  else if (!self || oneLife()) { // in battle royale the storm can decide it too
    const w = winnerNow(); if (!w) return;
    if (state === 'playing') endGame(w);
    else { ents.forEach(e => { e.kills = 0; e.deaths = 0; }); teams.bank = [0, 0]; } // the bots brawling behind the menu start over
  }
}

// ---------- thrown equipment and rockets ----------
// Every client flies every grenade and rocket; each applies the blast only to what it owns (see appliesHere).
const nades = [];
export const NADE_TYPES = ['frag', 'stun', 'flash', 'rocket']; // sent over the network by index
const nadeMats = {
  frag: new THREE.MeshLambertMaterial({ color: 0x4b5233 }), stun: new THREE.MeshLambertMaterial({ color: 0x3d6f9e }),
  flash: new THREE.MeshLambertMaterial({ color: 0xd8dcdf }), rocket: new THREE.MeshLambertMaterial({ color: 0x6b5a3e }),
};
const nadeG = new THREE.SphereGeometry(0.15, 10, 8);
function throwNade(e) {
  if (now < e.nadeReady || !e.alive || !nadesOn() || e.drop) return;
  if (oneLife() && !(e.frags > 0)) { if (e.isPlayer) toast('No frags: find them in chests'); return; }
  const type = oneLife() ? 'frag' : THROWABLES[e.nade] ? e.nade : 'frag';
  e.nadeReady = now + (oneLife() ? FRAGS.cd : THROWABLES[type].cd);
  if (oneLife()) e.frags--;
  const f = fwdVec(e.yaw, e.pitch);
  const pos = eyePos(e).addScaledVector(f, 0.6);
  const vel = f.multiplyScalar(17).add(new V3(0, 4, 0)).addScaledVector(e.vel, 0.5);
  spawnNade(pos, vel, e, type);
  if (e.isPlayer) {
    sfx.toss();
    if (mode === 'online') netEvent('n', r2(pos.x), r2(pos.y), r2(pos.z), r2(vel.x), r2(vel.y), r2(vel.z), NADE_TYPES.indexOf(type));
  }
}
export function spawnNade(pos, vel, owner, type = 'frag') {
  const m = new THREE.Mesh(nadeG, nadeMats[type]); m.castShadow = true; scene.add(m);
  if (type === 'rocket') m.scale.set(0.8, 0.8, 3); else m.scale.set(1, 1.2, 1);
  m.position.copy(pos);
  nades.push({ m, pos, vel, type, owner, fuse: now + (type === 'rocket' ? 4 : type === 'flash' ? 1.4 : 1.7) });
}
function updateNades(dt) {
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    if (n.type === 'rocket') {
      // straight line; it goes off on a wall, the ground, or anyone but the shooter
      const prev = n.pos.clone(), dir = n.vel.clone(), len = dir.length() * dt; dir.divideScalar(dir.length());
      const wall = rayWorld(prev, dir, len);
      n.pos.addScaledVector(dir, Math.min(wall, len));
      let hit = wall < len;
      if (!hit) for (const t of ents) if (t.alive && !t.drop && t !== n.owner && bodyC(t, _b).distanceTo(n.pos) < 0.9) { hit = true; break; }
      n.m.position.copy(n.pos); n.m.lookAt(_h.copy(n.pos).add(n.vel));
      if (Math.random() < 0.7) burst(prev, [0xb0aca4, 0xd8d4cc], 1, 0.5, 0.12, 0.45);
      if (hit || now >= n.fuse) { if (hit) n.pos.addScaledVector(dir, -0.2); detonate(n); scene.remove(n.m); nades.splice(i, 1); }
      continue;
    }
    n.vel.y -= grav() * dt;
    const prev = n.pos.clone();
    n.pos.addScaledVector(n.vel, dt);
    if (n.pos.y < 0.17) { n.pos.y = 0.17; n.vel.y = Math.abs(n.vel.y) * 0.4; n.vel.x *= 0.7; n.vel.z *= 0.7; }
    for (const b of boxes) {
      const r = 0.17;
      if (n.pos.x > b.min.x - r && n.pos.x < b.max.x + r && n.pos.y > b.min.y - r && n.pos.y < b.max.y + r && n.pos.z > b.min.z - r && n.pos.z < b.max.z + r) {
        for (const a of 'xyz') if (prev[a] <= b.min[a] - r || prev[a] >= b.max[a] + r) { n.vel[a] *= -0.4; }
        n.pos.copy(prev); n.vel.x *= 0.8; n.vel.z *= 0.8;
      }
    }
    n.m.position.copy(n.pos); n.m.rotation.x += dt * 9; n.m.rotation.z += dt * 6;
    if (n.type === 'frag') nadeMats.frag.emissive.setRGB(Math.sin(now * 30) > 0.6 ? 0.6 : 0, 0, 0); // blinking fuse light
    if (now >= n.fuse) { detonate(n); scene.remove(n.m); nades.splice(i, 1); }
  }
}
function detonate(n) {
  if (n.type === 'frag') explode(n.pos, n.owner, 'Frag', 115, 6.5);
  else if (n.type === 'rocket') { const g = n.owner && n.owner.guns && n.owner.guns.find(x => x.id === 4); explode(n.pos, n.owner, 'RPG', 150 * RARITY[g && oneLife() ? g.rar | 0 : 0].dmg, 5.5); }
  else if (n.type === 'stun') stunBlast(n.pos, n.owner);
  else flashBlast(n.pos, n.owner);
}
// Blasts: online, each player takes their own; this client also handles its bots, and the zombies if it runs them.
// In zombies, teammates' blasts don't touch you.
function appliesHere(t, owner) {
  if (!t.alive || t.remote) return false;
  if (game === 'zombies' && !t.zombie && owner !== t && !owner.zombie) return false;
  if (sameTeam(t, owner)) return false;
  return t === player || t.zombie || !!t.ai || !owner.remote; // remote players' blasts reach the bots I run
}
const blastVol = pos => (state === 'playing' ? clamp(1 - pos.distanceTo(camera.position) / 70, 0.15, 1) : 0);
function explode(pos, owner, wname, maxDmg, RAD) {
  const bl = blasts[blastIdx++ % blasts.length]; bl.m.position.copy(pos); bl.t = 0; bl.m.visible = true;
  burst(pos, [0xffb347, 0xff7a2a, 0x3a3a3a, 0x6b6660], 30, 9, 0.16, 0.9);
  sfx.boom(blastVol(pos));
  for (const t of ents) {
    if (!appliesHere(t, owner)) continue;
    bodyC(t, _b); const d = _b.distanceTo(pos);
    if (d > RAD) continue;
    const dir = _b.clone().sub(pos).normalize();
    const blocked = rayWorld(pos, dir, d) < d - 0.2;
    let dmg = maxDmg * (1 - d / RAD) * (blocked ? 0.3 : 1);
    if (t === owner) dmg *= 0.5;
    else if (isMuted(owner.name)) dmg *= 1.5; // owner may be a remote: their name is all we have
    t.vel.addScaledVector(dir, 9 * (1 - d / RAD)); t.vel.y += 4 * (1 - d / RAD);
    damage(t, dmg, owner, wname, false, null);
  }
  if (state === 'playing') shake = Math.max(shake, clamp(0.5 - pos.distanceTo(camera.position) / 30, 0, 0.5));
}
// stun: anyone in reach and not behind cover moves and turns slowly for a few seconds
function stunBlast(pos, owner) {
  burst(pos, [0x7fc4ff, 0xffffff, 0x3d6f9e], 24, 7, 0.1, 0.7);
  sfx.stun(blastVol(pos));
  for (const t of ents) {
    if (!appliesHere(t, owner)) continue;
    bodyC(t, _b); const d = _b.distanceTo(pos); if (d > 8) continue;
    const dir = _b.clone().sub(pos).normalize(); if (rayWorld(pos, dir, d) < d - 0.2) continue;
    t.stunUntil = Math.max(t.stunUntil, now + 3.5 * (1 - d / 10));
    damage(t, 8, owner, 'Stun', false, null);
  }
}
// flashbang: whites out anyone with a clear line to it, worst when looking right at it

function flashBlast(pos, owner) {
  burst(pos, [0xffffff, 0xfff6d0], 20, 8, 0.08, 0.4);
  sfx.flash(blastVol(pos));
  for (const t of ents) {
    if (!appliesHere(t, owner)) continue;
    eyePos(t, _o); const d = _o.distanceTo(pos); if (d > 22) continue;
    const dir = pos.clone().sub(_o).divideScalar(d || 1);
    if (rayWorld(_o, dir, d) < d - 0.3) continue;
    const k = (1 - d / 22) * (fwdVec(t.yaw, t.pitch).dot(dir) > 0.3 ? 1 : 0.35);
    if (t.isPlayer) fx.flash = Math.max(fx.flash, 4 * k + 0.4);
    else t.blindUntil = Math.max(t.blindUntil, now + 4 * k);
  }
}

// ---------- first-person heal ----------
// a bandage you wind round your arm, or a medkit you open and use, in place of the gun
const healVM = { root: new THREE.Group(), bandage: new THREE.Group(), medkit: new THREE.Group() };
{
  const M = c => new THREE.MeshLambertMaterial({ color: c }), white = M(0xf4f1e8), red = M(0xd9452f), skin = M(0xe0b48a), sleeve = M(0x5d6b3a);
  const bx = (g, m, w, h, d, x, y, z) => { const b = new THREE.Mesh(boxGeo, m); b.scale.set(w, h, d); b.position.set(x, y, z); g.add(b); return b; };
  // bandage: the left forearm held across, a roll in the right hand going round it
  const arm = new THREE.Group(); arm.rotation.set(0.15, 0, 1.25); healVM.bandage.add(arm);
  bx(arm, sleeve, 0.11, 0.42, 0.11, 0, -0.08, 0); bx(arm, skin, 0.1, 0.24, 0.1, 0, 0.24, 0);
  healVM.wrap = bx(arm, white, 0.115, 0.02, 0.115, 0, 0.18, 0); // the wound wrap grows as you go
  healVM.roll = new THREE.Group(); healVM.bandage.add(healVM.roll);
  const rl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12), white); rl.rotation.z = Math.PI / 2; healVM.roll.add(rl);
  bx(healVM.roll, skin, 0.07, 0.07, 0.1, 0.06, -0.05, 0.02);
  // medkit: an open case held low in both hands
  bx(healVM.medkit, white, 0.34, 0.16, 0.22, 0, 0, 0);
  bx(healVM.medkit, red, 0.16, 0.012, 0.05, 0, 0.086, 0); bx(healVM.medkit, red, 0.05, 0.012, 0.16, 0, 0.086, 0);
  healVM.lid = new THREE.Group(); healVM.lid.position.set(0, 0.08, -0.11); healVM.medkit.add(healVM.lid);
  bx(healVM.lid, white, 0.34, 0.03, 0.22, 0, 0.015, 0.11);
  for (const s of [-1, 1]) { bx(healVM.medkit, sleeve, 0.1, 0.1, 0.36, s * 0.2, -0.04, 0.2); bx(healVM.medkit, skin, 0.08, 0.08, 0.1, s * 0.19, -0.02, 0.02); }
  healVM.root.add(healVM.bandage, healVM.medkit); healVM.root.scale.setScalar(0.6); healVM.root.visible = false; vmScene.add(healVM.root);
}
function poseHealVM(u) {
  const t = now - u.start, k = clamp(t / (u.end - u.start), 0, 1);
  const up = Math.min(1, t / 0.25) * Math.min(1, (u.end - now) / 0.2 + 0.3); // comes up, dips at the end
  const med = u.type === 'medkit';
  healVM.bandage.visible = !med; healVM.medkit.visible = med;
  healVM.root.position.set(0.04, -0.5 + 0.24 * up + Math.sin(now * 3) * 0.006, -0.7);
  if (med) {
    healVM.root.rotation.set(0.5, 0, Math.sin(now * 2.2) * 0.05);
    healVM.lid.rotation.x = -Math.min(1, t / 0.5) * 1.9; // open the case
    healVM.medkit.position.y = Math.max(0, Math.sin(now * 9)) * 0.02 * (k > 0.15 ? 1 : 0); // working on it
  } else {
    healVM.root.rotation.set(0.25, 0, 0);
    const a = now * 9; // the roll circles the forearm while the wrap grows along it
    healVM.roll.position.set(-0.05 + k * 0.1 + Math.cos(a) * 0.09, 0.02 + Math.sin(a) * 0.07, -0.02 + Math.sin(a) * 0.05);
    healVM.roll.rotation.x = a;
    healVM.wrap.scale.y = 0.02 + k * 0.2; healVM.wrap.position.y = 0.17 - k * 0.1;
  }
}
// ---------- first-person view model ----------
const vm = { root: new THREE.Group(), guns: [], kick: 0, switchT: 0, flashUntil: 0, swayX: 0, swayY: 0, bob: 0, ads: 0, spr: 0 };
vmScene.add(vm.root);
function part(g, w, h, d, x, y, z, color, rx = 0) {
  const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color })); m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
}
function cyl(g, r, l, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), new THREE.MeshLambertMaterial({ color })); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m;
}
const SLEEVE = 0x4d5240;
(function buildVM() {
  const DARK = 0x2b2e33, BLACK = 0x1b1d20, TAN = 0x8b6a45, TAPE = 0xe5b02d;
  const BLADE = 0xc9ced4;
  const CAMO_ON = [DARK, 0x24272b, TAN, 0x3a3f36, 0x6b5a3e, BLADE]; // body colors that take the gun camo
  // attachment meshes, toggled per loadout: ext (longer mag), sup (suppressor), laser (box + beam), fast (taped mag)
  const beamM = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.45, depthWrite: false });
  const attach = (g, o) => {
    const grp = {};
    for (const k of ['ext', 'sup', 'laser', 'fast']) { grp[k] = new THREE.Group(); g.add(grp[k]); }
    part(grp.ext, ...o.ext, BLACK, o.extR || 0);
    cyl(grp.sup, 0.042, 0.22, 0, o.supY, o.supZ, 0x3a3e44); cyl(grp.sup, 0.045, 0.02, 0, o.supY, o.supZ + 0.1, 0x5c6168);
    const [lx, ly, lz] = o.laser;
    part(grp.laser, 0.03, 0.035, 0.08, lx, ly, lz, BLACK); part(grp.laser, 0.012, 0.012, 0.004, lx, ly, lz - 0.041, 0xff4040);
    const beam = new THREE.Mesh(boxGeo, beamM); beam.scale.set(0.004, 0.004, 3); beam.position.set(lx, ly, lz - 1.54); grp.laser.add(beam);
    part(grp.fast, ...o.fast, TAPE, o.extR || 0);
    g.userData.att = grp; g.userData.supMuzzle = new V3(0, o.supY, o.supZ - 0.12);
  };
  const finish = (g, muzzle, sightY, o) => {
    const camoMats = [], sleeves = [];
    g.traverse(m => { if (!m.isMesh) return; const c = m.material.color.getHex(); if (CAMO_ON.includes(c)) camoMats.push(m.material); else if (c === SLEEVE) sleeves.push(m.material); });
    Object.assign(g.userData, { camoMats, sleeves, baseMuzzle: muzzle, muzzle, sightY, att: {} });
    if (o) attach(g, o); // RPG and knife take no attachments
    vm.guns.push(g);
  };
  // gloved hands and sleeves; leftZ is where the support hand holds the gun
  const hands = (g, leftZ) => {
    part(g, 0.1, 0.1, 0.34, 0.02, -0.14, 0.2, SLEEVE, -0.25); part(g, 0.08, 0.09, 0.1, 0, -0.1, 0.06, 0x2f2b25);
    part(g, 0.1, 0.1, 0.3, -0.09, -0.1, leftZ + 0.15, SLEEVE, -0.2); part(g, 0.09, 0.08, 0.1, -0.02, -0.06, leftZ, 0x2f2b25);
  };
  // SMG with a red-dot sight
  let g = new THREE.Group();
  part(g, 0.08, 0.1, 0.38, 0, 0, -0.12, DARK); part(g, 0.06, 0.07, 0.16, 0, -0.005, -0.38, 0x24272b); cyl(g, 0.018, 0.12, 0, 0.01, -0.5, BLACK);
  part(g, 0.05, 0.2, 0.07, 0, -0.14, -0.16, BLACK, 0.12); part(g, 0.05, 0.13, 0.06, 0, -0.1, 0, BLACK, -0.3); part(g, 0.05, 0.07, 0.2, 0, -0.01, 0.14, DARK);
  // red-dot: an open frame you look through, with the dot floating in the middle
  part(g, 0.05, 0.02, 0.09, 0, 0.06, -0.12, BLACK);
  for (const x of [-0.024, 0.024]) part(g, 0.008, 0.05, 0.012, x, 0.09, -0.15, BLACK);
  part(g, 0.056, 0.008, 0.012, 0, 0.115, -0.15, BLACK);
  const dot = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a })); dot.scale.setScalar(0.005); dot.position.set(0, 0.09, -0.15); g.add(dot);
  hands(g, -0.36);
  finish(g, new V3(0, 0.01, -0.57), 0.09, { ext: [0.05, 0.12, 0.07, 0, -0.29, -0.18], extR: 0.12, supY: 0.01, supZ: -0.67,
    laser: [0.05, -0.03, -0.36], fast: [0.058, 0.035, 0.078, 0, -0.17, -0.163] });
  // pump shotgun
  g = new THREE.Group();
  part(g, 0.09, 0.11, 0.34, 0, 0, -0.02, DARK); cyl(g, 0.025, 0.6, 0, 0.03, -0.45, BLACK); cyl(g, 0.022, 0.5, 0, -0.025, -0.4, 0x22252a);
  part(g, 0.08, 0.07, 0.18, 0, -0.025, -0.36, TAN); part(g, 0.07, 0.12, 0.26, 0, -0.05, 0.27, TAN, 0.15); part(g, 0.05, 0.12, 0.06, 0, -0.1, 0.08, TAN, -0.3);
  part(g, 0.015, 0.02, 0.015, 0, 0.06, -0.73, 0xdddddd);
  hands(g, -0.36);
  finish(g, new V3(0, 0.03, -0.76), 0.07, { ext: [0.044, 0.044, 0.1, 0, -0.025, -0.7], supY: 0.03, supZ: -0.86,
    laser: [0.055, 0.0, -0.5], fast: [0.054, 0.054, 0.03, 0, -0.025, -0.56] });
  // bolt-action sniper with a long scope
  g = new THREE.Group();
  part(g, 0.08, 0.1, 0.4, 0, 0, -0.05, 0x3a3f36); cyl(g, 0.02, 0.6, 0, 0.015, -0.55, BLACK); part(g, 0.08, 0.14, 0.34, 0, -0.04, 0.28, 0x6b5a3e);
  part(g, 0.05, 0.12, 0.06, 0, -0.1, 0.06, 0x6b5a3e, -0.3); part(g, 0.05, 0.1, 0.08, 0, -0.09, -0.12, BLACK);
  cyl(g, 0.035, 0.32, 0, 0.1, -0.08, BLACK); cyl(g, 0.045, 0.04, 0, 0.1, -0.25, BLACK); cyl(g, 0.042, 0.04, 0, 0.1, 0.07, BLACK);
  part(g, 0.02, 0.02, 0.07, 0.06, 0.02, 0.02, 0x888888);
  hands(g, -0.3);
  finish(g, new V3(0, 0.015, -0.86), 0.1, { ext: [0.05, 0.08, 0.08, 0, -0.18, -0.12], supY: 0.015, supZ: -0.96,
    laser: [0.05, -0.01, -0.4], fast: [0.056, 0.03, 0.086, 0, -0.1, -0.12] });
  // assault rifle with a holo sight
  g = new THREE.Group();
  part(g, 0.075, 0.1, 0.46, 0, 0, -0.14, DARK); part(g, 0.065, 0.075, 0.22, 0, -0.005, -0.46, 0x3a3f36); cyl(g, 0.016, 0.16, 0, 0.01, -0.64, BLACK);
  part(g, 0.05, 0.2, 0.08, 0, -0.15, -0.2, BLACK, 0.22); part(g, 0.05, 0.13, 0.06, 0, -0.1, -0.02, BLACK, -0.3); part(g, 0.06, 0.1, 0.24, 0, -0.02, 0.18, 0x3a3f36);
  part(g, 0.05, 0.02, 0.09, 0, 0.06, -0.16, BLACK);
  for (const x of [-0.024, 0.024]) part(g, 0.008, 0.05, 0.012, x, 0.09, -0.19, BLACK);
  part(g, 0.056, 0.008, 0.012, 0, 0.115, -0.19, BLACK);
  const dot2 = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x2aff6a })); dot2.scale.setScalar(0.005); dot2.position.set(0, 0.09, -0.19); g.add(dot2);
  hands(g, -0.44);
  finish(g, new V3(0, 0.01, -0.73), 0.09, { ext: [0.05, 0.12, 0.08, 0, -0.3, -0.22], extR: 0.22, supY: 0.01, supZ: -0.83,
    laser: [0.05, -0.02, -0.46], fast: [0.058, 0.035, 0.088, 0, -0.19, -0.205] });
  // RPG: launch tube with the warhead loaded
  g = new THREE.Group();
  cyl(g, 0.055, 1.0, 0, 0.02, -0.2, 0x3a3f36); cyl(g, 0.064, 0.08, 0, 0.02, 0.28, BLACK); cyl(g, 0.045, 0.12, 0, 0.02, -0.74, 0x6b5a3e);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 10), new THREE.MeshLambertMaterial({ color: 0x6b5a3e })); tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0.02, -0.9); g.add(tip);
  part(g, 0.05, 0.13, 0.06, 0, -0.08, -0.05, BLACK, -0.2); part(g, 0.05, 0.12, 0.06, 0, -0.08, -0.35, BLACK, -0.2); part(g, 0.03, 0.05, 0.05, 0, 0.1, -0.3, BLACK);
  hands(g, -0.36);
  finish(g, new V3(0, 0.02, -1.0), 0.1, null);
  // combat knife in the right hand
  g = new THREE.Group();
  part(g, 0.035, 0.05, 0.14, 0, 0, 0, BLACK); part(g, 0.06, 0.07, 0.015, 0, 0, -0.075, 0x555a60); part(g, 0.012, 0.05, 0.26, 0, 0.005, -0.21, BLADE);
  part(g, 0.1, 0.1, 0.34, 0.02, -0.06, 0.22, SLEEVE, -0.25); part(g, 0.08, 0.09, 0.1, 0, -0.02, 0.04, 0x2f2b25);
  g.rotation.set(0.25, 0.3, 0);
  finish(g, new V3(0, 0, -0.34), 0, null);
  vm.guns.forEach(gg => { gg.visible = false; vm.root.add(gg); });
})();
const flashMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
vm.root.add(flashMesh);
const VM_BASE = new V3(0.2, -0.2, -0.5), VM_ADS = new V3(0, 0, -0.38); // ADS height comes from each gun's sightY
vm.root.scale.setScalar(0.72);
const curW = () => player.guns[player.weapon];
const curVM = () => vm.guns[curW().id];
export function refreshVM() { vm.guns.forEach((g, i) => g.visible = i === curW().id); }
// dress the first-person guns: camo, uniform sleeves, attachment meshes
export function dressVM() {
  vm.guns.forEach((g, i) => {
    const u = g.userData, w = player.guns.find(x => x.id === i);
    u.camoMats.forEach(m => applyLook(m, prog.camo[i]));
    u.sleeves.forEach(m => applyLook(m, prog.uniform));
    for (const k in u.att) u.att[k].visible = prog.att[i].includes(k) && P.attachUnlocked(prog, k);
    u.muzzle = w && w.sup && u.supMuzzle ? u.supMuzzle : u.baseMuzzle;
  });
}
function muzzlePos(e) {
  if (e.isPlayer) {
    const local = curVM().userData.muzzle.clone().multiplyScalar(0.72).add(vm.root.position);
    camera.updateMatrixWorld(); return local.applyMatrix4(camera.matrixWorld);
  }
  return muzzleOf(e);
}

// ---------- input ----------
const keys = {};
export let locked = false, plWorks = null, fireLatch = false, triggerUsed = false, zoomed = false, crouchTap = false;
function requestLock() {
  // some views neither grant nor refuse the lock; fall back to drag-to-aim if nothing happens
  setTimeout(() => { if (!locked && plWorks === null) plWorks = false; }, 1200);
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { if (plWorks !== true) plWorks = false; else $('pauseMsg').textContent = 'Click Resume again to grab the mouse.'; });
  } catch (e) { plWorks = false; }
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { plWorks = true; if (state === 'paused') setState('playing'); }
  else if (state === 'playing' && !invOpen && player.alive) { setState('paused'); } // dead: the mouse is free for the death screen buttons
});
document.addEventListener('pointerlockerror', () => { if (plWorks !== true) plWorks = false; });
// back from the dead in a bot game: take the mouse again (or ask for a click if the browser says no)
function relockAfterDeath() {
  if (locked || plWorks === false || state !== 'playing') return;
  requestLock();
  setTimeout(() => { if (!locked && state === 'playing' && player.alive) toast('Click to keep playing'); }, 400);
}
document.addEventListener('mousemove', e => {
  if (state !== 'playing' || !player.alive) return;
  if (locked || (plWorks === false && e.buttons)) {
    const s = settings.sens * 0.0022 * (zoomed ? camera.fov / settings.fov * settings.adsSens : 1) * (now < player.stunUntil ? 0.4 : 1);
    player.yaw -= e.movementX * s; player.pitch = clamp(player.pitch - e.movementY * s, -1.45, 1.45);
    vm.swayX = clamp(vm.swayX - e.movementX * 0.0004, -0.04, 0.04); vm.swayY = clamp(vm.swayY + e.movementY * 0.0004, -0.04, 0.04);
  }
});
canvas.addEventListener('mousedown', e => {
  if (state !== 'playing') return;
  initAudio();
  if (invOpen) { closeInv(); return; }
  if (!player.alive && mode !== 'online') return;
  if (!locked && plWorks !== false) { requestLock(); return; }
  pressCode('Mouse' + e.button);
});
canvas.addEventListener('auxclick', e => e.preventDefault());
document.addEventListener('mouseup', e => { keys['Mouse' + e.button] = false; });
// a pressed control: movement is read from `keys` each frame; one-shot actions fire here
function pressCode(code) {
  keys[code] = true;
  const a = actionFor(code);
  if (a === 'shoot') { fireLatch = true; triggerUsed = false; }
  if (a === 'scores') { buildTable($('boardTbl')); $('board').hidden = false; }
  if (!player.alive || !a) return;
  if (player.drop) { if (a === 'jump') dropPress(player); return; }
  if (a === 'w1') switchWeapon(player, slotIdx(player, 0));
  else if (a === 'w2') switchWeapon(player, slotIdx(player, 1));
  else if (a === 'w3') switchWeapon(player, slotIdx(player, 2));
  else if (a === 'w4') switchWeapon(player, slotIdx(player, 3));
  else if (a === 'use') useKey(player);
  else if (a === 'dropGun') dropGun(player, player.weapon);
  else if (a === 'bandage' || a === 'medkit') startHeal(player, a);
  else if (a === 'inv') openInv();
  else if (a === 'map') toggleBigMap();
  else if (a === 'swap') switchWeapon(player, player.prevWeapon);
  else if (a === 'slotL') moveSlot(player, -1);
  else if (a === 'slotR') moveSlot(player, 1);
  else if (a === 'reload') startReload(player);
  else if (a === 'nade') throwNade(player);
  else if (a === 'crouch') crouchTap = true;
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => { // next or previous gun, in slot order
  if (state !== 'playing' || !player.alive || player.drop || invOpen) return;
  const order = slotOrder(player), n = order.length, k = order.indexOf(player.weapon);
  switchWeapon(player, order[(k + (e.deltaY > 0 ? 1 : n - 1)) % n]);
}, { passive: true });
// Ctrl+W/T/N can't be blocked in a page, so a crouch bound to Ctrl could close the tab: ask first while in a match
addEventListener('beforeunload', e => { if (state === 'playing') e.preventDefault(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; $('board').hidden = true; });
document.addEventListener('keydown', e => {
  if (rebinding || (e.target && e.target.tagName === 'INPUT')) return;
  if (e.code === binds.mute && !e.repeat) { toast(toggleMute() ? 'Sound off' : 'Sound on'); }
  if (state !== 'playing') return;
  if (e.code.startsWith('Arrow') || actionFor(e.code)) e.preventDefault();
  if (invOpen) {
    if (!e.repeat && (e.code === binds.inv || e.code === 'Escape')) { e.preventDefault(); closeInv(); return; }
    const a = actionFor(e.code);
    if (['fwd', 'back', 'left', 'right', 'jump', 'sprint', 'crouch'].includes(a)) keys[e.code] = true;
    else if (!e.repeat && (a === 'bandage' || a === 'medkit')) startHeal(player, a);
    return;
  }
  // Esc pauses. With the mouse captured the browser takes Esc itself (see pointerlockchange); this covers the
  // times it isn't: dead with the mouse freed for the death buttons, or after the browser refused to recapture it
  if (e.code === 'Escape' && !e.repeat && !locked) { e.preventDefault(); setState('paused'); return; }
  if (e.code === 'Enter' && !e.repeat && !player.alive && mode !== 'online') { e.preventDefault(); playAgain(); return; }
  if (e.code === binds.jump && !e.repeat && !player.alive && spec.who && state === 'playing') { e.preventDefault(); nextSpec(); return; }
  if (e.repeat) return;
  pressCode(e.code);
});
document.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === binds.scores) $('board').hidden = true; });

// ---------- controls screen ----------
let rebinding = null, ctrlReturn = null;
function renderBinds() {
  const list = $('bindList'); list.textContent = '';
  for (const [k, label] of ACTIONS) {
    const row = document.createElement('div'); row.className = 'bind';
    const s = document.createElement('span'); s.textContent = label; s.id = 'bl-' + k;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.k = k;
    b.setAttribute('aria-describedby', 'bl-' + k);
    b.textContent = rebinding === k ? 'Press a key\u2026' : keyName(binds[k]);
    b.classList.toggle('listen', rebinding === k);
    b.addEventListener('click', ev => { ev.stopPropagation(); startRebind(k); });
    row.append(s, b); list.append(row);
  }
  renderKeyHelp();
}
function renderKeyHelp() {
  const kb = c => `<kbd>${keyName(c).replace(/[&<>"']/g, ch => '&#' + ch.charCodeAt(0) + ';')}</kbd>`;
  $('keyHelp').innerHTML = [
    `${kb(binds.fwd)}${kb(binds.left)}${kb(binds.back)}${kb(binds.right)} Move`,
    `${kb(binds.jump)} Jump`, `${kb(binds.sprint)} Sprint`, `${kb(binds.crouch)} Crouch \u00b7 slide while sprinting`,
    `${kb(binds.shoot)} Shoot`, `${kb(binds.scope)} Aim down sights`,
    `${kb(binds.w1)}${kb(binds.w2)}${kb(binds.w3)}${kb(binds.w4)} ${kb(binds.swap)} Switch weapon`,
    `${kb(binds.use)} Open chest \u00b7 pick up &nbsp;${kb(binds.dropGun)} Drop weapon &nbsp;${kb(binds.bandage)} Bandage &nbsp;${kb(binds.medkit)} Medkit &nbsp;${kb(binds.slotL)}${kb(binds.slotR)} Reorder guns &nbsp;${kb(binds.inv)} Inventory (battle royale)`,
    `${kb(binds.reload)} Reload`, `${kb(binds.nade)} Throw equipment`,
    `${kb(binds.map)} Full map &nbsp;${kb(binds.scores)} Scores &nbsp;${kb(binds.mute)} Mute`,
  ].map(s => `<div>${s}</div>`).join('');
}
function startRebind(k) {
  rebinding = rebinding === k ? null : k;
  $('bindMsg').textContent = rebinding ? 'Press a key or mouse button. Esc cancels.' : '';
  renderBinds();
  if (rebinding) { const b = $('bindList').querySelector(`button[data-k="${k}"]`); if (b) b.focus(); }
}
function finishRebind(code) {
  const k = rebinding; if (!k) return;
  if (code === 'Escape') { rebinding = null; $('bindMsg').textContent = ''; renderBinds(); return; }
  if (!validCode(code)) { $('bindMsg').textContent = `${keyName(code)} can't be used. Pick another key.`; return; }
  const other = actionFor(code), old = binds[k];
  binds[k] = code;
  let msg = `${ACTIONS.find(a => a[0] === k)[1]} is now ${keyName(code)}.`;
  if (other && other !== k) { binds[other] = old; msg += ` ${ACTIONS.find(a => a[0] === other)[1]} moved to ${keyName(old)}.`; }
  rebinding = null; settings.binds = { ...binds }; saveSettings();
  $('bindMsg').textContent = msg; renderBinds();
  const b = $('bindList').querySelector(`button[data-k="${k}"]`); if (b) b.focus();
}
document.addEventListener('keydown', e => {
  if (!rebinding) { if (e.code === 'Escape' && !$('controls').hidden) { e.preventDefault(); closeControls(); } return; }
  e.preventDefault(); e.stopImmediatePropagation();
  finishRebind(e.code);
}, true);
document.addEventListener('mousedown', e => {
  if (!rebinding) return;
  // a left click on another control button just switches which one is listening
  if (e.button === 0 && e.target.closest && e.target.closest('#controls button')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  finishRebind('Mouse' + e.button);
}, true);
$('controls').addEventListener('contextmenu', e => e.preventDefault());
function openControls(from) {
  ctrlReturn = from; rebinding = null; $('bindMsg').textContent = '';
  renderBinds(); $('controls').hidden = false; $('ctrlDone').focus();
}
function closeControls() {
  rebinding = null; $('controls').hidden = true;
  const back = ctrlReturn === 'pause' ? $('resumeBtn') : $('ctrlBtn'); if (back) back.focus();
}

// ---------- player update ----------
const deathPos = new V3(); let killer = null, shake = 0, stepD = 0, airT = 0, wasGround = true;
function updatePlayer(dt) {
  const p = player;
  if (!p.alive) {
    const left = Math.ceil(p.respawnAt - now);
    $('deathCount').textContent = game === 'zombies' ? 'Back next wave' : oneLife() ? `Out \u00b7 ${brAlive().length} left` : 'Back in ' + Math.max(1, left);
    if (oneLife() && now > p.diedAt + 2.5 && spectate(dt)) return; // a moment on your killer, then your squad
    camera.position.lerp(_o.copy(deathPos).add(new V3(0, 3, 0)), 1 - Math.pow(0.1, dt));
    if (killer && killer.alive) camera.lookAt(killer.pos.x, killer.pos.y + 1, killer.pos.z);
    if (now >= p.respawnAt) { respawn(p); $('death').hidden = true; refreshVM(); relockAfterDeath(); }
    return;
  }
  const turn = 2.4 * dt;
  if (keys.ArrowLeft) p.yaw += turn; if (keys.ArrowRight) p.yaw -= turn;
  if (keys.ArrowUp) p.pitch = clamp(p.pitch + turn, -1.45, 1.45); if (keys.ArrowDown) p.pitch = clamp(p.pitch - turn, -1.45, 1.45);
  const f = (bound('fwd') ? 1 : 0) - (bound('back') ? 1 : 0), s = (bound('right') ? 1 : 0) - (bound('left') ? 1 : 0);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  const wish = new V3(-sy * f + cy * s, 0, -cy * f - sy * s);
  if (wish.lengthSq() > 0) wish.normalize();
  if (p.drop) { zoomed = false; fireLatch = false; updateDrop(p, dt, wish); dropCamera(p, dt); return; }
  hideSelf();
  const w = p.guns[p.weapon], firing = bound('shoot') || fireLatch;
  zoomed = bound('scope') && !p.reloading && w.kind !== 'melee';

  if (firing && p.sprint) { p.nextShot = Math.max(p.nextShot, now + 0.1); p.sprintBlock = now + 0.35; }
  // crouch toggles; crouch while sprinting slides. Crouch again or jump mid-slide to cancel it:
  // you stand straight back up into a sprint and keep the slide's speed.
  if (crouchTap) {
    if (p.slide > 0) endSlide(p, false);
    else if (p.sprint && p.onGround && now >= p.slideReady) {
      p.slide = MOVE.slideTime; p.sprint = false; p.crouchOn = false;
      const hv = new V3(p.vel.x, 0, p.vel.z);
      p.slideDir.copy(hv.lengthSq() > 0.01 ? hv.normalize() : wish);
      const v0 = Math.max(MOVE.slide, Math.hypot(p.vel.x, p.vel.z));
      p.vel.x = p.slideDir.x * v0; p.vel.z = p.slideDir.z * v0;
      sfx.slide();
    } else p.crouchOn = !p.crouchOn;
    crouchTap = false;
  }
  // sprint: hold while moving forward. Firing drops out of sprint, with a short delay before the first shot.
  p.sprint = bound('sprint') && f > 0 && !zoomed && !firing && p.slide <= 0 && now >= p.sprintBlock;
  if (p.sprint && p.crouchOn && canStand(p)) p.crouchOn = false;

  if (p.slide > 0) {
    p.slide -= dt;
    if (bound('jump') && p.onGround) { endSlide(p, false); p.vel.y = JUMP; p.onGround = false; }
    else if (p.slide <= 0) endSlide(p, true);
  }
  let target = p.slide > 0 || p.crouchOn ? 1 : 0;
  if (!target && p.crouch > 0.01 && !canStand(p)) target = 1; // no room to stand up
  p.crouch += (target - p.crouch) * Math.min(1, dt * 12);
  p.slideK += ((p.slide > 0 ? 1 : 0) - p.slideK) * Math.min(1, dt * 14);

  if (p.slide > 0) {
    // ride the slide's momentum, fading to crouch speed, with a little steering
    const v = MOVE.crouch + (MOVE.slide - MOVE.crouch) * (p.slide / MOVE.slideTime);
    if (wish.lengthSq() > 0) p.slideDir.lerp(wish, Math.min(1, dt * 1.5)).normalize();
    const k = Math.min(1, (p.onGround ? 6 * grip(p) : 1) * dt);
    p.vel.x += (p.slideDir.x * v - p.vel.x) * k; p.vel.z += (p.slideDir.z * v - p.vel.z) * k;
  } else if (p.launched) {
    p.vel.x += wish.x * 3 * dt; p.vel.z += wish.z * 3 * dt; // flying off a jump pad: nudge, don't brake
  } else {
    let speed = (zoomed ? MOVE.ads : p.sprint ? MOVE.sprint : MOVE.walk) * (w.speed || 1) * (now < p.stunUntil ? 0.5 : 1);
    if (target) speed = Math.min(speed, MOVE.crouch); // by intent, so standing back up isn't slowed
    const k = Math.min(1, (p.onGround ? 12 * grip(p) : 3) * dt);
    p.vel.x += (wish.x * speed - p.vel.x) * k; p.vel.z += (wish.z * speed - p.vel.z) * k;
  }
  if (bound('jump') && p.onGround) { if (p.crouchOn && canStand(p)) p.crouchOn = false; p.vel.y = JUMP; p.onGround = false; }
  moveEntity(p, dt);
  if (firing && (w.auto || !triggerUsed) && tryFire(p)) triggerUsed = true;
  fireLatch = false; // a tap shorter than one frame still fires
  if (!oneLife() && now - p.lastHurt > 5 && p.hp < 100) p.hp = Math.min(100, p.hp + 12 * dt);

  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (p.onGround) vm.bob += dt * sp * 1.6;
  // your footsteps: one per stride, quieter crouched, none while sliding; a thud when you land
  if (p.onGround && !wasGround && airT > 0.35) sfx.land(Math.min(1, airT));
  airT = p.onGround ? 0 : airT + dt; wasGround = p.onGround;
  if (p.onGround && p.slide <= 0 && sp > 1.2) {
    stepD += sp * dt;
    if (stepD >= (p.sprint ? 2.5 : 1.9)) { stepD = 0; sfx.step(p.crouch > 0.5 ? 0.3 : p.sprint ? 0.85 : 0.6); }
  } else stepD = Math.min(stepD, 1.2);
  const bobY = reduceMotion ? 0 : Math.sin(vm.bob * 2) * 0.04 * Math.min(1, sp / 6);
  camera.position.set(p.pos.x, p.pos.y + EYE * poseK(p) + bobY, p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, reduceMotion ? 0 : p.slideK * 0.07);
  if (shake > 0 && !reduceMotion) camera.position.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.3));
}

// ---------- spectating your squad ----------
export const spec = { who: null };
export const isUp = e => (e.remote && !e.netbot ? !e.dead && e.m === net.m : e.alive);
export const squadmates = () => (squadsOn() && player.team !== undefined ? ents.filter(e => e !== player && !e.zombie && sameTeam(e, player) && isUp(e)) : []);
function spectate(dt) {
  const mates = squadmates();
  if (!mates.length) { if (spec.who) endSpec(true); return false; }
  if (!mates.includes(spec.who)) { spec.who = mates[0]; $('death').hidden = true; $('spec').hidden = false; }
  const e = spec.who; setText('specName', e.name); setText('specHp', `${Math.ceil(e.hp || 0)} HP`);
  setText('specKeys', mates.length > 1 ? `${keyName(binds.jump)} next teammate${mode !== 'online' ? ' \u00b7 Enter play again' : ''}` : mode !== 'online' ? 'Enter play again' : '');
  $('specNext').hidden = mates.length < 2; $('specAgain').hidden = mode === 'online';
  // over their shoulder, pulled in if a wall is behind them
  fwdVec(e.yaw, 0, _f); _o.set(e.pos.x, e.pos.y + 1.9, e.pos.z);
  const back = Math.min(4.2, rayWorld(_o, _sd.copy(_f).negate(), 4.6) - 0.4);
  _b.copy(_o).addScaledVector(_f, -Math.max(0.6, back));
  camera.position.lerp(_b, 1 - Math.pow(0.002, dt));
  camera.lookAt(e.pos.x + _f.x * 6, e.pos.y + 1.4, e.pos.z + _f.z * 6);
  return true;
}
function nextSpec() {
  const mates = squadmates(); if (mates.length < 2) return;
  spec.who = mates[(mates.indexOf(spec.who) + 1) % mates.length];
}
// stop watching: back to the death card if you're still out (squad wiped), or nothing at all
function endSpec(showDeath) {
  spec.who = null; $('spec').hidden = true;
  if (showDeath && !player.alive && state === 'playing') { $('death').hidden = false; deathButtons(); }
}
// the death card's buttons: offline always (Play again, Main menu); online only once you're out for good, in battle
// royale with nobody left in your squad, and then they take you back to the lobby (ready for the next one, or not)
function deathButtons() {
  const online = mode === 'online', on = !online || (oneLife() && !squadmates().length);
  $('deathBtns').hidden = !on; $('deathKeys').hidden = online || !on;
  $('deathMenu').textContent = online ? 'Back to lobby' : 'Main menu';
  if (on) { closeInv(false); if (document.pointerLockElement) document.exitPointerLock(); }
}
function deathToLobby(ready) { net.ready = ready; endSpec(); enterLobby(); }
$('specNext').addEventListener('click', nextSpec);
$('specAgain').addEventListener('click', () => playAgain());
// on the blimp the camera sits behind it and you look around; once you jump it follows behind you so you see
// yourself fall and glide, and on landing it's your own eyes again
let selfMesh = null;
function hideSelf() { if (selfMesh) selfMesh.visible = false; }
function dropCamera(p, dt = 0) {
  fwdVec(p.yaw, p.pitch, _f);
  if (p.drop && p.drop.stage === 'ride' && FLIGHT.mesh) {
    hideSelf();
    camera.position.copy(FLIGHT.mesh.position).addScaledVector(_f, -26); camera.position.y += 5;
  } else if (p.drop) {
    if (!selfMesh) selfMesh = soldierMesh('', p.color, true, { uniform: prog.uniform, camo: prog.camo[p.guns[p.weapon].id] });
    const keep = p.mesh; p.mesh = selfMesh; selfMesh.visible = true;
    poseSoldier(p, dt); setCanopy(p, p.drop.stage === 'glide'); p.mesh = keep;
    camera.position.set(p.pos.x, p.pos.y + 1.6, p.pos.z).addScaledVector(_f, -6); camera.position.y += 1.2;
  } else { hideSelf(); camera.position.set(p.pos.x, p.pos.y + EYE, p.pos.z); }
  camera.rotation.set(p.pitch, p.yaw, 0);
}
// battle royale: every gun sits in a numbered slot (1-4) and slots can be empty, so you can put a gun on any key.
// The guns list stays packed; g.slot says where each one shows. Elsewhere slot = list position.
export function fixSlots(e) {
  const used = new Set();
  e.guns.forEach((g, i) => {
    if (!g.mine) e.guns[i] = g = { ...g, mine: true }; // our own copy, so the slot never lands on a shared weapon
    if (!(g.slot >= 0 && g.slot < MAX_SLOTS) || used.has(g.slot)) g.slot = -1; else used.add(g.slot);
  });
  for (const g of e.guns) if (g.slot < 0) { let s = 0; while (used.has(s)) s++; g.slot = s; used.add(s); }
}
export function slotIdx(e, s) { // the gun in slot s, or -1
  if (!oneLife() || !e.isPlayer) return s < e.guns.length ? s : -1;
  fixSlots(e); return e.guns.findIndex(g => g.slot === s);
}
const slotOrder = e => [...Array(MAX_SLOTS).keys()].map(s => slotIdx(e, s)).filter(i => i >= 0);
// put gun i into slot s, trading places with whatever is there
function moveToSlot(e, i, s) {
  if (!oneLife() || !e.isPlayer) return swapSlots(e, i, s);
  fixSlots(e); const g = e.guns[i]; if (!g || s < 0 || s >= MAX_SLOTS || g.slot === s) return;
  const j = slotIdx(e, s); if (j >= 0) e.guns[j].slot = g.slot;
  g.slot = s;
}
// move the gun in your hands one slot left or right (the knife can move too)
function moveSlot(e, dir) { if (!oneLife()) return; fixSlots(e); moveToSlot(e, e.weapon, e.guns[e.weapon].slot + dir); }
function swapSlots(e, i, j) {
  if (i === j || i < 0 || j < 0 || i >= e.guns.length || j >= e.guns.length) return;
  [e.guns[i], e.guns[j]] = [e.guns[j], e.guns[i]]; [e.ammo[i], e.ammo[j]] = [e.ammo[j], e.ammo[i]];
  const fix = k => (k === i ? j : k === j ? i : k); // the gun in your hands stays in your hands
  e.weapon = fix(e.weapon); e.prevWeapon = fix(e.prevWeapon);
  if (e.reloading) e.reloadWeapon = fix(e.reloadWeapon);
  if (e.isPlayer) dressVM();
}

// ---------- inventory (battle royale) ----------
// opens over the game (which keeps running) and frees the mouse: guns you can drag into a new order or click to hold,
// with their numbers on hover, and the ammo and heals you carry
let invOpen = false, invKey = '', invDrag = -1;
function openInv() {
  const p = player;
  if (!oneLife() || !p.alive || p.drop || state !== 'playing') return;
  invOpen = true; invKey = ''; renderInv(); $('inv').hidden = false;
  fireLatch = false; zoomed = false;
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeInv(relock = true) {
  if (!invOpen) return;
  invOpen = false; $('inv').hidden = true; $('invTip').hidden = true; invDrag = -1;
  if (relock && state === 'playing' && plWorks !== false) requestLock();
}
const gunStats = g => {
  const R = RARITY[g.rar | 0], at = AMMO_OF[g.id];
  return [['Damage', `${Math.round(g.dmg)}${g.pellets > 1 ? ' \u00d7 ' + g.pellets : ''}`], ['Headshot', '\u00d7' + g.head],
    ['Fire rate', `${(1 / g.rate).toFixed(1)}/s`], ['Magazine', g.kind === 'melee' ? '\u2013' : String(g.mag)],
    ['Reload', g.kind === 'melee' ? '\u2013' : g.reload.toFixed(1) + 's'], ['Range', g.range + ' m'],
    ['Ammo', at ? AMMO[at].name : 'none'], ['Rarity', g.kind === 'melee' ? '\u2013' : R.name]];
};
{
  const dz = $('invDrop'), inv = $('inv');
  const take = ev => { ev.preventDefault(); dz.classList.remove('over'); if (invDrag >= 0) dropGun(player, invDrag); invDrag = -1; renderInv(); };
  dz.addEventListener('dragover', ev => { if (invDrag >= 0) { ev.preventDefault(); dz.classList.add('over'); } });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', take);
  // outside the box: the dimmed backdrop itself
  inv.addEventListener('dragover', ev => { if (invDrag >= 0 && ev.target === inv) ev.preventDefault(); });
  inv.addEventListener('drop', ev => { if (ev.target === inv) take(ev); });
}
const invSig = () => { const p = player; return [p.weapon, ...p.guns.map((g, i) => g.name + (g.rar | 0) + ':' + p.ammo[i] + '@' + g.slot), JSON.stringify(p.res), JSON.stringify(p.heals), p.frags, binds.w1, binds.w2, binds.w3, binds.w4].join('|'); };
function renderInv() {
  fixSlots(player);
  const p = player, slots = $('invGuns');
  invKey = invSig();
  slots.textContent = '';
  for (let s = 0; s < MAX_SLOTS; s++) {
    const i = slotIdx(p, s), g = p.guns[i], el = document.createElement('div');
    const line = (c, t) => { const d = document.createElement('div'); d.className = c; d.textContent = t; el.append(d); };
    // every slot, full or not, takes a dropped gun
    el.addEventListener('dragover', ev => { if (invDrag >= 0) { ev.preventDefault(); el.classList.add('over'); } });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', ev => { ev.preventDefault(); if (invDrag >= 0) moveToSlot(p, invDrag, s); invDrag = -1; renderInv(); });
    if (!g) { el.className = 'invGun empty'; line('k', keyName(binds['w' + (s + 1)] || '')); line('n', 'Empty'); slots.append(el); continue; }
    el.className = 'invGun' + (i === p.weapon ? ' on' : ''); el.draggable = true; el.dataset.i = i;
    if (g.kind !== 'melee') el.style.setProperty('--rar', rarCss(g.rar));
    const at = AMMO_OF[g.id];
    line('k', keyName(binds['w' + (s + 1)] || '')); line('n', g.name);
    line('r', g.kind === 'melee' ? 'Melee' : RARITY[g.rar | 0].name);
    if (at) line('a', `${p.ammo[i]} / ${g.mag} \u00b7 ${p.res[at] | 0} spare`);
    el.addEventListener('mouseenter', ev => showTip(g, ev)); el.addEventListener('mousemove', ev => moveTip(ev));
    el.addEventListener('mouseleave', () => { $('invTip').hidden = true; });
    el.addEventListener('click', () => { switchWeapon(p, i); renderInv(); });
    el.addEventListener('dragstart', ev => { invDrag = i; el.classList.add('drag'); $('invTip').hidden = true; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(i)); });
    el.addEventListener('dragend', () => { invDrag = -1; renderInv(); });
    slots.append(el);
  }
  const row = (box, color, name, have, max, use) => {
    const r = document.createElement(use ? 'button' : 'div'); r.className = 'invItem';
    if (use) { r.classList.add('invUse'); r.title = 'Click to use'; r.disabled = !(have > 0); r.addEventListener('click', () => { closeInv(); startHeal(player, use); }); }
    const sw = document.createElement('i'); sw.style.background = color; const n = document.createElement('b'); n.textContent = name;
    const c = document.createElement('span'); c.textContent = `${have | 0} / ${max}`; r.append(sw, n, c); box.append(r);
  };
  const am = $('invAmmo'); am.textContent = '';
  for (const k of AMMO_KEYS) row(am, '#' + AMMO[k].color.toString(16).padStart(6, '0'), AMMO[k].name, p.res[k], AMMO[k].max);
  const hl = $('invHeals'); hl.textContent = '';
  row(hl, '#f4f1e8', `Bandages (${keyName(binds.bandage)})`, p.heals.bandage, HEALS.bandage.max, 'bandage');
  row(hl, '#d9452f', `Medkits (${keyName(binds.medkit)})`, p.heals.medkit, HEALS.medkit.max, 'medkit');
  row(hl, '#6b7a45', `Frags (${keyName(binds.nade)} to throw)`, p.frags, FRAGS.max);
  const note = document.createElement('div'); note.className = 'invItem'; note.textContent = 'Click one to use it. Stand still.'; note.style.color = 'var(--muted)'; note.style.fontSize = '11px'; hl.append(note);
  $('invHint').textContent = `${keyName(binds.inv)} or Esc to close`;
}
function showTip(g, ev) {
  const tip = $('invTip'); tip.textContent = '';
  tip.style.setProperty('--rar', g.kind === 'melee' ? '#bbb' : rarCss(g.rar));
  const h = document.createElement('b'); h.textContent = (g.kind === 'melee' ? '' : RARITY[g.rar | 0].name + ' ') + g.name; tip.append(h);
  for (const [k, v] of gunStats(g)) { const r = document.createElement('div'), a = document.createElement('span'), b = document.createElement('b'); a.textContent = k; b.textContent = v; b.style.cssText = 'font-size:12px;margin:0;color:var(--cream)'; r.append(a, b); tip.append(r); }
  tip.hidden = false; moveTip(ev);
}
function moveTip(ev) { const t = $('invTip'); t.style.left = Math.min(innerWidth - 200, ev.clientX + 14) + 'px'; t.style.top = Math.min(innerHeight - 200, ev.clientY + 14) + 'px'; }
function updateInv() {
  if (!invOpen) return;
  if (state !== 'playing' || !player.alive || !oneLife()) { closeInv(false); return; }
  if (invDrag < 0 && invSig() !== invKey) renderInv();
}
// natural end: you stay crouched; cancelled: you stand (if there's room)
function endSlide(p, natural) {
  p.slide = 0; p.slideReady = now + MOVE.slideCooldown;
  p.crouchOn = natural || !canStand(p);
}
let camHold = false; // the localhost test hook can park the menu camera
function menuCamera(dt) {
  if (camHold) return;
  const a = now * 0.07;
  camera.position.set(Math.cos(a) * 40, 19, Math.sin(a) * 40);
  camera.lookAt(0, 1, 0);
}


// The menu shows only what applies: offline it's the game setup; online it's either the server browser or
// setting up a new room (the same game setup plus who can join and the code)
function updateModeUI() {
  const online = settings.mode === 'online', browse = online && settings.otab !== 'create', g = settings.game;
  if (online && g === 'aim') { $('gameSeg').querySelector('[data-v=ffa]').click(); return; }
  $('onlineTabs').hidden = !online;
  $('browsePane').hidden = !browse; $('setupPane').hidden = browse;
  $('gAim').hidden = online; // aim trainer is solo
  const fighting = !['zombies', 'aim'].includes(g), tdm = g === 'tdm';
  $('rowTs').hidden = !tdm; $('rowLim').hidden = !tdm; $('rowSide').hidden = !tdm || !online;
  const sq = clamp(settings.sq | 0, 1, 4); $('rowSq').hidden = $('rowHok').hidden = g !== 'br';
  $('sqHelp').textContent = sq === 1 ? 'Everyone for themselves.'
    : online ? `Players in this room team up ${sq} to a squad, in the order they join; bots fill the empty seats. No friendly fire.`
    : `You and ${sq - 1} bot${sq > 2 ? 's' : ''} against squads of ${sq} bots. No friendly fire.`;
  $('rowBots').hidden = !fighting || tdm; $('rowDiff').hidden = !fighting;
  $('b0').hidden = !online; $('b11').hidden = g !== 'br'; // online a room can have no bots; battle royale takes a crowd
  if (($('b0').hidden && settings.bots === 0) || ($('b11').hidden && settings.bots === 11)) $('botSeg').querySelector('[data-v="5"]').click();
  $('tsHelp').textContent = online ? (settings.side === 'split' ? 'Players are split between the teams; bots fill the empty seats.' : 'Players join Blue together; bots fill the empty seats on both sides.')
    : `You and ${settings.ts - 1 || 'no'} bot${settings.ts === 2 ? '' : 's'} against ${settings.ts} bot${settings.ts === 1 ? '' : 's'}.`;
  $('roomRows').hidden = !online;
  $('playBtn').hidden = browse;
  $('playBtn').textContent = online ? 'Create room' : 'Play';
  $('gameHelp').textContent = GAME_HELP[g] || '';
  if (browse) refreshRooms();
}
// ---------- server browser ----------
let roomsTimer = 0;
async function refreshRooms() {
  clearTimeout(roomsTimer);
  if (state !== 'menu' || settings.mode !== 'online' || settings.otab === 'create') return;
  let list = null;
  try { const r = await fetch('/rooms', { cache: 'no-store' }); if (r.ok) list = await r.json(); } catch (e) {}
  const box = $('roomList'); box.textContent = '';
  if (!Array.isArray(list)) { box.innerHTML = '<p class="help">Couldn\'t reach the server. Trying again…</p>'; }
  else if (!list.length) { box.innerHTML = '<p class="help">No public games right now. Create a room and your friends will find it here.</p>'; }
  else for (const r of list.sort((a, b) => b.players - a.players)) {
    const row = document.createElement('div'); row.className = 'room' + (r.players >= r.max ? ' full' : '');
    const what = document.createElement('div'); what.className = 'what';
    const name = document.createElement('b'); name.textContent = cleanRoom(r.code);
    const info = document.createElement('small');
    info.textContent = `${GAMES[r.game] || r.game}${r.game === 'tdm' ? ` ${r.ts}v${r.ts}` : ''}${r.game === 'br' && r.sq > 1 ? ` ${SQUAD_NAMES[r.sq] || ''}` : ''} · ${MAPS[r.map] || r.map}${r.bots && r.game !== 'tdm' ? ` · ${r.bots} bots` : ''}`;
    what.append(name, info);
    const count = document.createElement('span'); count.className = 'count'; count.textContent = `${r.players}/${r.max}`;
    const btn = document.createElement('button'); btn.className = 'btn ghost small'; btn.type = 'button'; btn.textContent = r.busy ? 'In progress' : r.players >= r.max ? 'Full' : 'Join';
    btn.disabled = r.busy || r.players >= r.max; if (r.busy) row.classList.add('full'); btn.addEventListener('click', () => joinCode(r.code));
    row.append(what, count, btn); box.append(row);
  }
  roomsTimer = setTimeout(refreshRooms, 4000);
}
function joinCode(code) {
  code = cleanRoom(code); if (!code) return;
  settings.room = code; saveSettings(); startGame();
}
const GAME_HELP = {
  ffa: 'Everyone for themselves. First to 20 eliminations wins.',
  tdm: 'Blue against Red. Every elimination scores for your team; first team to the target wins. No friendly fire.',
  br: 'One life each. Ride the potato blimp, jump out over the island and glide down. You land with a knife: open chests for guns, ammo and heals. The storm closes in, so keep moving. Last one standing wins. Pick Duos, Trios or Squads to team up; online, friends in the same room join your squad.',
  zombies: 'Team up against waves of zombies. Downed players come back each wave. Online, everyone in the room plays together.',
  gungame: 'Every two kills hands you the next weapon: AR, SMG, Shotgun, Sniper, RPG, then the knife. One knife kill wins.',
  moon: 'Knives only, in low gravity. Jump high, stab fast. First to 20.',
  snipe: 'Snipers only, and one body shot drops anyone. First to 20.',
  aim: 'Solo. 60 seconds, as many targets as you can hit.',
};


// ---------- battle royale: one life, a closing storm ----------
// The storm is a circle (x, z, r) that waits, then shrinks to the next circle (tx, tz, tr) inside it, five times.
// Outside it you lose health every second, more each phase. Offline or as the bot host this client runs it;
// everyone else follows the host's.
const PHASES = [[25, 20, 30, 3], [20, 18, 19, 5], [18, 16, 11, 8], [15, 14, 5, 12], [12, 12, 0, 18]]; // wait s, shrink s, next radius, damage/s
export const storm = { on: false, x: 0, z: 0, r: 48, fx: 0, fz: 0, fr: 48, tx: 0, tz: 0, tr: 30, phase: 0, waitEnd: 0, shrinkEnd: 0, dps: 2, tick: 0, mesh: null };
function resetStorm() {
  storm.on = oneLife(); storm.phase = -1; storm.x = storm.z = 0; storm.r = LIMIT * 1.45;
  if (storm.on) nextPhase();
  if (!storm.mesh) {
    storm.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 140, 72, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9a3cdc, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    storm.mesh.position.y = 50; scene.add(storm.mesh);
  }
  storm.mesh.visible = storm.on;
}
function nextPhase() {
  const ph = PHASES[++storm.phase]; if (!ph) { storm.waitEnd = storm.shrinkEnd = Infinity; return; }
  // bigger maps get bigger circles and a little longer to cross them; the first wait starts once the blimp is done
  const k = LIMIT / 32, tk = 1 + (k - 1) * 0.45;
  const extra = storm.phase === 0 && FLIGHT.on ? Math.max(0, FLIGHT.t0 + FLIGHT.dur * FLIGHT.inEnd - now) + 12 : 0;
  storm.fx = storm.x; storm.fz = storm.z; storm.fr = storm.r; storm.tr = ph[2] * k; storm.dps = PHASES[Math.max(0, storm.phase - 1)][3];
  const a = Math.random() * Math.PI * 2, d = Math.random() * Math.max(0, storm.r - storm.tr) * 0.8, lim = Math.max(0, HALF - storm.tr * 0.5);
  storm.tx = clamp(storm.x + Math.cos(a) * d, -lim, lim); storm.tz = clamp(storm.z + Math.sin(a) * d, -lim, lim);
  storm.waitEnd = now + ph[0] * tk + extra; storm.shrinkEnd = storm.waitEnd + ph[1] * tk;
}
function updateStorm(dt) {
  if (!storm.on || !storm.mesh) return;
  const host = mode !== 'online' || botHost();
  if (host && state !== 'menu') {
    if (now >= storm.shrinkEnd) { storm.x = storm.tx; storm.z = storm.tz; storm.r = storm.tr; nextPhase(); }
    else if (now >= storm.waitEnd) {
      const k = (now - storm.waitEnd) / (storm.shrinkEnd - storm.waitEnd);
      storm.x = storm.fx + (storm.tx - storm.fx) * k; storm.z = storm.fz + (storm.tz - storm.fz) * k; storm.r = storm.fr + (storm.tr - storm.fr) * k;
      storm.dps = PHASES[storm.phase][3];
    }
  }
  storm.mesh.position.x = storm.x; storm.mesh.position.z = storm.z; storm.mesh.scale.set(Math.max(0.1, storm.r), 1, Math.max(0.1, storm.r));
  // the storm hurts me, and the bots I run
  const out = e => e.alive && !e.drop && Math.hypot(e.pos.x - storm.x, e.pos.z - storm.z) > storm.r;
  if (now >= storm.tick) { // in half-second bites, so it hurts (and sounds) like ticks
    storm.tick = now + 0.5;
    if (state === 'playing' && out(player)) damage(player, storm.dps * 0.5, null, 'Storm', false, null);
    if (host) for (const e of ents) if (e.ai && out(e)) damage(e, storm.dps * 0.5, null, 'Storm', false, null);
  }
  $('stormFx').style.opacity = state === 'playing' && out(player) ? 0.85 : 0;
}
// [x, z, r, next x, next z, next r, seconds to shrink, seconds to done, dps]
export function stormState() {
  return [r2(storm.x), r2(storm.z), r2(storm.r), r2(storm.tx), r2(storm.tz), r2(storm.tr), r2(Math.min(999, storm.waitEnd - now)), r2(Math.min(999, storm.shrinkEnd - now)), storm.dps];
}
export function syncStorm(a) {
  if (!Array.isArray(a) || a.length < 9) return;
  const v = a.map(num);
  const sl = LIMIT * 1.6;
  storm.on = true; [storm.x, storm.z, storm.r, storm.tx, storm.tz, storm.tr] = v.slice(0, 6).map(n => clamp(n, -sl, sl));
  storm.r = Math.max(0, storm.r); storm.tr = Math.max(0, storm.tr);
  storm.waitEnd = now + v[6]; storm.shrinkEnd = now + v[7]; storm.dps = clamp(v[8], 0, 50);
  if (storm.mesh) storm.mesh.visible = true;
}
export function stormText() {
  if (!storm.on) return '-';
  if (now < storm.waitEnd) return `closes in ${Math.ceil(storm.waitEnd - now)}s`;
  return now < storm.shrinkEnd ? 'closing!' : storm.r < 1 ? 'everywhere' : 'holding';
}
// who is still in: me, players who haven't gone down, and living bots
// in this match: not someone else's old match, and not a player waiting back in the lobby
const inMatch = e => !e.zombie && (!e.remote || e.netbot || (e.m === net.m && !e.lobby));
const isAliveNow = e => (e.remote && !e.netbot ? !e.dead : e.alive);
export function brAlive() { return ents.filter(e => inMatch(e) && isAliveNow(e)); }

// ---------- battle royale: the drop, loot chests, ammo and heals ----------
// Seeded numbers, so every screen in a room flies the same route and finds the same loot in each chest.
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let brSeed = 'x';
const brKey = () => (mode === 'online' ? `${settings.room}:${net.m}` : brSeed);
const DOWN = new V3(0, -1, 0), _dp = new V3();
const floorBelow = (x, y, z) => y - rayWorld(_dp.set(x, y, z), DOWN, 200); // the height of whatever is under (x, y, z)

// The blimp flies a straight line across the map. Everyone rides it, jumps out once it's over land
// (or gets pushed out before it leaves), falls, opens a glider and steers down to a landing spot.
export const DROP_ST = ['', 'ride', 'fall', 'glide']; // sent over the network by index
export const FLIGHT = { on: false, ax: 0, az: 0, bx: 0, bz: 0, t0: 0, dur: 1, inStart: 0, inEnd: 1, y: 60, mesh: null };
export const flightT = () => (now - FLIGHT.t0) / FLIGHT.dur;
const flightPos = (t, out = new V3()) => out.set(FLIGHT.ax + (FLIGHT.bx - FLIGHT.ax) * t, FLIGHT.y, FLIGHT.az + (FLIGHT.bz - FLIGHT.az) * t);
function blimpMesh() {
  const g = new THREE.Group(), RX = 4.2, RZ = 10;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), new THREE.MeshLambertMaterial({ color: 0xc8955a }));
  body.scale.set(RX, RX, RZ); g.add(body);
  const spotM = new THREE.MeshLambertMaterial({ color: 0x8a6036 }); // potato eyes, on the skin
  for (const [x, y, z, s] of [[2.6, 1.8, 3, 0.7], [-3, 1, -2, 0.9], [1.2, 3.2, -5, 0.6], [-2, 2.8, 5, 0.5], [3.4, -0.5, -4, 0.6], [-1.5, -2, -6, 0.5]]) {
    const f = 0.97 / Math.sqrt((x / RX) ** 2 + (y / RX) ** 2 + (z / RZ) ** 2);
    const m = new THREE.Mesh(body.geometry, spotM); m.scale.setScalar(s); m.position.set(x * f, y * f, z * f); g.add(m);
  }
  const finM = new THREE.MeshLambertMaterial({ color: 0xd9452f });
  for (const rz of [0, Math.PI / 2]) { const f = new THREE.Mesh(boxGeo, finM); f.scale.set(0.25, 5, 3.2); f.position.z = 9.2; f.rotation.z = rz; g.add(f); }
  const gond = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3b3f2e })); gond.scale.set(2.2, 1.3, 5.5); gond.position.y = -4.7; g.add(gond);
  const win = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); win.scale.set(2.25, 0.4, 4.6); win.position.y = -4.6; g.add(win);
  for (const s of [-1, 1]) { const r = new THREE.Mesh(boxGeo, SM.gear); r.scale.set(0.12, 1.6, 0.12); r.position.set(s * 0.8, -3.6, 0); g.add(r); }
  g.visible = false; scene.add(g);
  return g;
}
function resetFlight() {
  FLIGHT.on = oneLife();
  if (!FLIGHT.mesh) FLIGHT.mesh = blimpMesh();
  FLIGHT.mesh.visible = FLIGHT.on;
  if (!FLIGHT.on) return;
  const r = rng(hashStr(brKey() + ':flight')), a = r() * Math.PI * 2, L = LIMIT * 1.35, off = (r() - 0.5) * HALF * 0.7;
  const dx = Math.cos(a), dz = Math.sin(a);
  FLIGHT.ax = -dx * L - dz * off; FLIGHT.az = -dz * L + dx * off; FLIGHT.bx = dx * L - dz * off; FLIGHT.bz = dz * L + dx * off;
  FLIGHT.y = 40 + LIMIT * 0.3; FLIGHT.dur = 2 * L / 17; FLIGHT.t0 = now + 2;
  // the stretch of the route over the playable ground: you can only jump there
  let s = -1, e = -1; const lim = HALF * 0.9, p = new V3();
  for (let i = 0; i <= 200; i++) { flightPos(i / 200, p); if (Math.abs(p.x) < lim && Math.abs(p.z) < lim) { if (s < 0) s = i / 200; e = i / 200; } }
  FLIGHT.inStart = s < 0 ? 0.4 : s; FLIGHT.inEnd = s < 0 ? 0.6 : e;
}
function updateFlight() {
  if (!FLIGHT.on) return;
  const t = flightT();
  flightPos(t, FLIGHT.mesh.position);
  FLIGHT.mesh.rotation.set(Math.sin(now * 0.7) * 0.03, Math.atan2(-(FLIGHT.bx - FLIGHT.ax), -(FLIGHT.bz - FLIGHT.az)), Math.sin(now * 0.5) * 0.04);
  if (t > 1.25) { FLIGHT.on = false; FLIGHT.mesh.visible = false; }
}
// a soldier's glider: a canopy over their head while they come down
const canopyM = new THREE.MeshLambertMaterial({ color: 0xffc83d, side: THREE.DoubleSide });
const canopyG = new THREE.SphereGeometry(1.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
export function setCanopy(e, on) {
  if (!e.mesh) return;
  const u = e.mesh.userData;
  if (on && !u.canopy) {
    u.canopy = new THREE.Group();
    const dome = new THREE.Mesh(canopyG, canopyM); dome.scale.set(1, 0.55, 1.2); dome.position.y = 3.6; u.canopy.add(dome);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(boxGeo, SM.gear); l.scale.set(0.03, 2.1, 0.03); l.position.set(x * 0.55, 2.55, z * 0.65); l.rotation.set(z * 0.25, 0, -x * 0.22); u.canopy.add(l); }
    e.mesh.add(u.canopy);
  }
  if (u.canopy) u.canopy.visible = on;
}
// in battle royale every soldier starts on the blimp (or, once it has gone, high over a spawn)
function startDrop(e) {
  const t = flightT();
  e.drop = { stage: 'ride', at: now, jumpT: FLIGHT.inStart + (FLIGHT.inEnd - FLIGHT.inStart) * rand(0.05, 0.9), goal: null };
  e.vel.set(0, 0, 0); e.onGround = false;
  if (!FLIGHT.on || t > FLIGHT.inEnd) { const s = pick(SPAWNS); e.pos.set(s[0], 40 + LIMIT * 0.3, s[1]); leaveFlight(e); }
  else flightPos(Math.max(0, t), e.pos).y -= 5;
  if (e.mesh) { e.mesh.visible = e.drop.stage !== 'ride'; setCanopy(e, false); }
}
function leaveFlight(e) {
  const d = e.drop; d.stage = 'fall'; d.at = now;
  if (FLIGHT.on && flightT() <= 1) e.vel.set((FLIGHT.bx - FLIGHT.ax) / FLIGHT.dur * 0.25, 0, (FLIGHT.bz - FLIGHT.az) / FLIGHT.dur * 0.25);
  if (e.mesh) e.mesh.visible = true;
  if (e.isPlayer) sfx.toss();
  if (e.ai) { // a bot claims one of the closest chests below it, keeping clear of chests other bots already claimed
    const near = CH.list.filter(c => !c.open).map(c => [c, Math.hypot(c.x - e.pos.x, c.z - e.pos.z)]).filter(a => a[1] < 70).sort((a, b) => a[1] - b[1]).slice(0, 10).map(a => a[0]);
    const claimed = CH.list.filter(c => c.claim && c.claim !== e && c.claim.alive);
    const free = near.filter(c => !claimed.includes(c)), clear = free.filter(c => claimed.every(o => Math.hypot(o.x - c.x, o.z - c.z) > 15));
    const list = clear.length ? clear : free.length ? free : near;
    if (list.length) { d.goal = pick(list); d.goal.claim = e; } else { const s = pick(SPAWNS); d.goal = { x: s[0], z: s[1], y: 0 }; }
  }
}
function openGlider(e) {
  if (!e.drop || e.drop.stage !== 'fall') return;
  e.drop.stage = 'glide'; setCanopy(e, true);
  if (e.isPlayer) sfx.glider();
}
export const LOOT_WINDOW = 25; // seconds after landing that a bot ignores other bots (unless one shoots it); players are fair game
function land(e) {
  e.drop = null; setCanopy(e, false); e.landedAt = now; e.hurtBy = null;
  if (e.mesh) e.mesh.visible = true;
  if (e.isPlayer) sfx.slide();
}
// one step of a drop for anyone I run: wish is the way they steer
function updateDrop(e, dt, wish) {
  const d = e.drop;
  if (d.stage === 'ride') {
    const t = flightT();
    flightPos(clamp(t, 0, 1), e.pos).y -= 5; e.vel.set(0, 0, 0);
    if (!FLIGHT.on || t >= FLIGHT.inEnd || (e.ai && t >= d.jumpT)) leaveFlight(e);
    return;
  }
  if (d.stage === 'fall' && e.pos.y - floorBelow(e.pos.x, e.pos.y, e.pos.z) < 20) openGlider(e);
  const glide = d.stage === 'glide', spd = glide ? 10 : 7;
  const n = Math.ceil(dt / 0.02), h = dt / n; // small steps: falling fast must not go through a roof
  for (let i = 0; i < n; i++) {
    e.vel.x += (wish.x * spd - e.vel.x) * Math.min(1, h * 2); e.vel.z += (wish.z * spd - e.vel.z) * Math.min(1, h * 2);
    if (glide) e.vel.y += (-4.5 - e.vel.y) * Math.min(1, h * 3); else e.vel.y = Math.max(-26, e.vel.y - G * h);
    e.vel.y += grav() * h; // moveEntity takes gravity off again
    moveEntity(e, h);
    if (e.onGround) { land(e); return; }
  }
}
function dropPress(p) {
  const d = p.drop; if (!d) return;
  if (d.stage === 'ride' && flightT() >= FLIGHT.inStart) leaveFlight(p);
  else if (d.stage === 'fall' && now - d.at > 0.3) openGlider(p);
}
export function botDrop(b, dt) {
  const d = b.drop, wish = new V3();
  if (d.goal) {
    wish.set(d.goal.x - b.pos.x, 0, d.goal.z - b.pos.z);
    const l = wish.length(); if (l > 1) { wish.divideScalar(l); b.yaw += angDiff(b.yaw, Math.atan2(-wish.x, -wish.z)) * Math.min(1, dt * 3); } else wish.set(0, 0, 0);
  }
  updateDrop(b, dt, wish);
  poseSoldier(b, dt);
  setCanopy(b, !!b.drop && b.drop.stage === 'glide');
}

// ---------- loot ----------
// Chests sit where the map puts them (or by the spawns on maps without any). Opening one spills a gun, ammo for it
// and maybe a heal; online every screen spills the same loot, and picking something up takes it off every screen.
export const CH = { list: [], items: [], byId: new Map(), seq: 0 };
const LM = {
  wood: new THREE.MeshLambertMaterial({ color: 0x8a5a2b }), dark: new THREE.MeshLambertMaterial({ color: 0x5a3a1d }),
  gold: new THREE.MeshLambertMaterial({ color: 0xffc83d }), spent: new THREE.MeshLambertMaterial({ color: 0x77684a }),
  beam: new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.22, depthWrite: false }),
  gun: new THREE.MeshLambertMaterial({ color: 0x2b2e33 }), white: new THREE.MeshLambertMaterial({ color: 0xf2efe6 }), red: new THREE.MeshLambertMaterial({ color: 0xd9452f }),
};
const beamG = new THREE.CylinderGeometry(0.07, 0.07, 1, 8);
const beamMats = new Map();
const beamMat = c => { if (!beamMats.has(c)) beamMats.set(c, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.38, depthWrite: false })); return beamMats.get(c); };
const ammoMats = {}; for (const k in AMMO) ammoMats[k] = new THREE.MeshLambertMaterial({ color: AMMO[k].color });
const AMMO_KEYS = Object.keys(AMMO), HEAL_KEYS = Object.keys(HEALS);
function chestMesh(c) {
  const g = new THREE.Group();
  piece(g, LM.wood, 1.1, 0.5, 0.7, 0, 0.25, 0);
  const trims = [piece(g, LM.gold, 1.14, 0.07, 0.74, 0, 0.47, 0), piece(g, LM.gold, 0.1, 0.5, 0.74, -0.38, 0.25, 0), piece(g, LM.gold, 0.1, 0.5, 0.74, 0.38, 0.25, 0)];
  const lid = new THREE.Group(); lid.position.set(0, 0.5, 0.35); g.add(lid);
  piece(lid, LM.dark, 1.1, 0.22, 0.7, 0, 0.11, -0.35);
  trims.push(piece(lid, LM.gold, 0.14, 0.16, 0.06, 0, 0.02, -0.72));
  const beam = new THREE.Mesh(beamG, LM.beam); beam.scale.set(1, 7, 1); beam.position.y = 4; g.add(beam);
  g.position.set(c.x, c.y, c.z); g.rotation.y = c.rot; scene.add(g);
  Object.assign(c, { mesh: g, lid, trims, beam });
}
function fallbackChests() {
  return SPAWNS.map(s => [s[0], s[1], 0]).filter(([x, z, y]) => !boxes.some(b => x + 0.6 > b.min.x && x - 0.6 < b.max.x && z + 0.6 > b.min.z && z - 0.6 < b.max.z && y + 0.5 > b.min.y && y < b.max.y - 0.05));
}
function resetLoot() {
  for (const c of CH.list) scene.remove(c.mesh);
  for (const it of CH.items) scene.remove(it.mesh);
  CH.list = []; CH.items = []; CH.byId.clear();
  if (!oneLife()) return;
  const r = rng(hashStr(currentMap + ':chests'));
  (CHESTS.length ? CHESTS.map(([x, z, y]) => [x, z, y || 0]) : fallbackChests()).forEach(([x, z, y], i) => {
    const c = { i, x, y, z, rot: r() * Math.PI * 2, open: false, claim: null }; chestMesh(c); CH.list.push(c);
  });
}
// what chest i holds this match: a gun by weight, a pack of its ammo, maybe more ammo, maybe a heal
export const rarCss = r => '#' + RARITY[r | 0].color.toString(16).padStart(6, '0');
function rollRarity(r) {
  let x = r() * RARITY.reduce((a, t) => a + t.w, 0);
  for (let i = 0; i < RARITY.length; i++) if ((x -= RARITY[i].w) < 0) return i;
  return 0;
}
function chestLoot(i) {
  const r = rng(hashStr(brKey() + ':c' + i)), out = [];
  let x = r() * CHEST_GUNS.reduce((a, g) => a + g[1], 0), gid = CHEST_GUNS[0][0];
  for (const [id, w] of CHEST_GUNS) if ((x -= w) < 0) { gid = id; break; }
  out.push({ kind: 'gun', w: gid, qty: WEAPONS[gid].mag, r: rollRarity(r) });
  out.push({ kind: 'ammo', type: AMMO_OF[gid], qty: AMMO[AMMO_OF[gid]].pack });
  if (r() < 0.5) { const t = ['light', 'shells', 'heavy', 'light'][(r() * 4) | 0]; out.push({ kind: 'ammo', type: t, qty: AMMO[t].pack }); }
  const h = r();
  if (h < 0.55) out.push({ kind: 'heal', type: 'bandage', qty: r() < 0.4 ? 2 : 1 });
  else if (h < 0.77) out.push({ kind: 'heal', type: 'medkit', qty: 1 });
  if (r() < 0.4) out.push({ kind: 'frag', qty: r() < 0.35 ? 2 : 1 });
  return out;
}
function itemMesh(it) {
  const g = new THREE.Group(), spin = new THREE.Group(); g.add(spin);
  if (it.kind === 'gun') {
    const L = [0.5, 0.8, 1.0, 0.8, 1.0, 0.35][it.w];
    if (it.w === 4) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, L, 10), LM.gun); t.rotation.x = Math.PI / 2; spin.add(t); piece(spin, LM.red, 0.1, 0.1, 0.18, 0, 0, -L / 2 - 0.08); }
    else if (it.w === KNIFE) { piece(spin, LM.gun, 0.04, 0.05, 0.14, 0, 0, 0.1); piece(spin, LM.white, 0.015, 0.05, 0.24, 0, 0, -0.08); }
    else {
      piece(spin, LM.gun, 0.08, 0.12, L * 0.6, 0, 0, 0); piece(spin, LM.gun, 0.04, 0.04, L * 0.4, 0, 0.02, -L * 0.5);
      piece(spin, LM.gun, 0.06, 0.16, 0.08, 0, -0.12, -0.05); piece(spin, it.w === 1 || it.w === 2 ? LM.wood : LM.gun, 0.06, 0.1, L * 0.3, 0, -0.03, L * 0.42);
      if (it.w === 2) piece(spin, LM.gun, 0.06, 0.06, 0.3, 0, 0.1, 0);
    }
    spin.scale.setScalar(1.3);
    const rr = it.r | 0, beam = new THREE.Mesh(beamG, beamMat(RARITY[rr].color)); beam.scale.set(1 + rr * 0.35, 3 + rr, 1 + rr * 0.35); beam.position.y = 1.4 + rr / 2; g.add(beam);
  } else if (it.kind === 'ammo') {
    piece(spin, ammoMats[it.type], 0.34, 0.22, 0.24, 0, 0, 0); piece(spin, LM.dark, 0.36, 0.05, 0.26, 0, 0.1, 0);
  } else if (it.kind === 'frag') {
    const f = new THREE.Mesh(nadeG, nadeMats.frag); f.scale.set(1.3, 1.55, 1.3); spin.add(f); piece(spin, LM.dark, 0.06, 0.1, 0.06, 0, 0.25, 0);
  } else if (it.type === 'medkit') {
    piece(spin, LM.white, 0.5, 0.3, 0.36, 0, 0, 0); piece(spin, LM.red, 0.28, 0.02, 0.08, 0, 0.16, 0); piece(spin, LM.red, 0.08, 0.02, 0.28, 0, 0.16, 0);
  } else {
    piece(spin, LM.white, 0.3, 0.12, 0.3, 0, 0, 0); piece(spin, LM.red, 0.16, 0.02, 0.05, 0, 0.07, 0); piece(spin, LM.red, 0.05, 0.02, 0.16, 0, 0.07, 0);
  }
  scene.add(g);
  return { mesh: g, spin };
}
// where the k-th of n things dropped at (x, y, z) lands: in a ring round it, kept off walls
const _sd = new V3(), _so = new V3();
function spillSpot(x, y, z, k, n, a0 = 0, r0 = 1) {
  const a = a0 + (n > 1 ? (k / n) * Math.PI * 2 : 0), dx = -Math.sin(a), dz = -Math.cos(a);
  const d = Math.max(0.2, Math.min(r0, rayWorld(_so.set(x, y + 0.4, z), _sd.set(dx, 0, dz), r0 + 0.5) - 0.45));
  const px = x + dx * d, pz = z + dz * d;
  return [px, floorBelow(px, y + 0.6, pz), pz];
}
function addItem(id, spec, x, y, z, fx = x, fz = z) {
  if (CH.byId.has(id)) return;
  const it = { id, ...spec, x, y, z, fx, fz, born: now, ph: Math.random() * 6, ...itemMesh(spec) };
  CH.items.push(it); CH.byId.set(id, it);
  if (CH.items.length > 140) takeItem(CH.items[0], true);
}
export function takeItem(it, quiet) {
  scene.remove(it.mesh); CH.byId.delete(it.id);
  const i = CH.items.indexOf(it); if (i >= 0) CH.items.splice(i, 1);
  if (!quiet && mode === 'online') netEvent('pk', it.id);
}
export function openChest(i, by, fromNet) {
  const c = CH.list[i]; if (!c || c.open) return;
  c.open = true; c.beam.visible = false; c.trims.forEach(m => { m.material = LM.spent; });
  if (state === 'playing') sfx.chest(by === player ? 1 : distVol(c.mesh.position));
  const loot = chestLoot(i);
  loot.forEach((it, k) => { const [x, y, z] = spillSpot(c.x, c.y, c.z, 0, 1, c.rot + (k - (loot.length - 1) / 2) * 0.75, 1.3); addItem('c' + i + ':' + k, it, x, y, z, c.x, c.z); });
  if (!fromNet && mode === 'online') netEvent('c', i);
}
// someone I run went down (or swapped a gun): their things fall where they stand, on every screen
const encItems = list => list.flatMap(it => [it.kind === 'gun' ? 0 : it.kind === 'ammo' ? 1 : it.kind === 'frag' ? 3 : 2, it.kind === 'gun' ? it.w + 10 * (it.r | 0) : it.kind === 'ammo' ? AMMO_KEYS.indexOf(it.type) : it.kind === 'frag' ? 0 : HEAL_KEYS.indexOf(it.type), it.qty]);
export function decItems(flat) {
  const out = [];
  for (let i = 0; i + 2 < flat.length && out.length < 12; i += 3) {
    const k = flat[i] | 0, t = flat[i + 1] | 0, q = clamp(flat[i + 2] | 0, 1, 999);
    if (k === 0 && WEAPONS[t % 10]) out.push({ kind: 'gun', w: t % 10, qty: q, r: clamp((t / 10) | 0, 0, RARITY.length - 1) }); // gun id + 10 x rarity
    else if (k === 1 && AMMO_KEYS[t]) out.push({ kind: 'ammo', type: AMMO_KEYS[t], qty: q });
    else if (k === 2 && HEAL_KEYS[t]) out.push({ kind: 'heal', type: HEAL_KEYS[t], qty: q });
    else if (k === 3) out.push({ kind: 'frag', qty: Math.min(q, FRAGS.max) });
  }
  return out;
}
export function spillItems(key, list, x, y, z) {
  list.forEach((it, k) => { const [px, py, pz] = spillSpot(x, y, z, k, list.length, 0.4, list.length > 1 ? 1 : 0.6); addItem(key + ':' + k, it, px, py, pz, x, z); });
}
function dropItems(e, list) {
  if (!list.length) return;
  const x = r2(e.pos.x), y = r2(e.pos.y), z = r2(e.pos.z);
  if (mode === 'online') { spillItems(net.myPeer + ':' + (net.seq + 1), list, x, y, z); netEvent('dp', x, y, z, ...encItems(list)); }
  else spillItems('l' + ++CH.seq, list, x, y, z);
}
// battle royale: put a gun down at your feet (never the knife). The gun in your hands goes back to the knife.
function dropGun(e, i) {
  if (!oneLife() || !e.alive || e.drop) return;
  const g = e.guns[i];
  if (!g || g.kind === 'melee') { if (e.isPlayer && g) toast("You can't drop the knife"); return; }
  dropItems(e, [{ kind: 'gun', w: g.id, qty: Math.max(1, e.ammo[i]), r: g.rar | 0 }]);
  if (e.reloading && e.reloadWeapon === i) e.reloading = false;
  e.guns.splice(i, 1); e.ammo.splice(i, 1);
  const fix = k => (k > i ? k - 1 : k === i ? -1 : k);
  if (e.reloading) e.reloadWeapon = fix(e.reloadWeapon);
  const prev = fix(e.prevWeapon);
  if (e.weapon === i) {
    const k = e.guns.findIndex(x => x.kind === 'melee'); e.weapon = k >= 0 ? k : 0;
    e.useT = null; e.nextShot = Math.max(e.nextShot, now + 0.3); if (e.isPlayer) vm.switchT = 0.3;
  } else e.weapon = fix(e.weapon);
  e.prevWeapon = prev < 0 ? e.weapon : prev;
  if (e.isPlayer) { dressVM(); refreshVM(); sfx.pick(); toast('Dropped <em></em>', `${RARITY[g.rar | 0].name} ${g.name}`, false); }
}
function dropAll(e) {
  const list = [];
  e.guns.forEach((g, i) => { if (g.kind !== 'melee') list.push({ kind: 'gun', w: g.id, qty: Math.max(1, e.ammo[i]), r: g.rar | 0 }); });
  if (e.isPlayer) { for (const k of AMMO_KEYS) if (e.res[k] > 0) list.push({ kind: 'ammo', type: k, qty: e.res[k] }); }
  else for (const g of e.guns) if (AMMO_OF[g.id]) list.push({ kind: 'ammo', type: AMMO_OF[g.id], qty: AMMO[AMMO_OF[g.id]].pack });
  for (const k of HEAL_KEYS) if (e.heals[k] > 0) list.push({ kind: 'heal', type: k, qty: e.heals[k] });
  if (e.frags > 0) list.push({ kind: 'frag', qty: e.frags });
  dropItems(e, list.slice(0, 12));
}
function giveGun(e, w, ammo, slot = e.guns.length, rar = 0) {
  const g = { ...(e.isPlayer ? P.armedWeapon(prog, w) : WEAPONS[w]) }, R = RARITY[rar | 0];
  if (g.kind !== 'melee') { g.rar = rar | 0; g.dmg *= R.dmg; g.reload *= R.reload; }
  e.guns[slot] = g; e.ammo[slot] = Math.min(g.mag, ammo);
  if (e.isPlayer) dressVM();
  if (slot === e.weapon) { e.reloading = false; if (e.isPlayer) { vm.switchT = 0.3; refreshVM(); } }
  else if (e.guns[e.weapon].kind === 'melee') switchWeapon(e, slot);
}
export const lootName = it => (it.kind === 'frag' ? `${it.qty} Frag${it.qty > 1 ? 's' : ''}` : it.kind === 'gun' ? `${RARITY[it.r | 0].name} ${WEAPONS[it.w].name}` : it.kind === 'ammo' ? `${it.qty} ${AMMO[it.type].name}` : `${it.qty} ${HEALS[it.type].name}${it.qty > 1 ? 's' : ''}`);
// walking over something takes it if there's room: guns into a free slot, ammo and heals up to what you can carry
function autoPickup(e) {
  for (let i = CH.items.length - 1; i >= 0; i--) {
    const it = CH.items[i];
    if (now - it.born < 0.45 || Math.abs(it.y - e.pos.y) > 1.6 || Math.hypot(it.x - e.pos.x, it.z - e.pos.z) > (e.isPlayer ? 1.3 : 2)) continue;
    let took = null;
    if (e.isPlayer && it.kind === 'gun') continue; // you pick guns up yourself (E)
    if (it.kind === 'gun') {
      if (e.guns.length < MAX_SLOTS && !e.guns.some(g => g.id === it.w)) { giveGun(e, it.w, it.qty, undefined, it.r); took = it.qty; }
    } else if (it.kind === 'ammo') {
      if (!e.isPlayer) continue; // bots never run dry, so they leave ammo for the players
      const n = Math.min(AMMO[it.type].max - (e.res[it.type] || 0), it.qty);
      if (n > 0) { e.res[it.type] = (e.res[it.type] || 0) + n; it.qty -= n; took = n; }
    } else if (it.kind === 'frag') {
      if (!e.isPlayer) continue; // bots don't throw, so they leave frags for the players
      const n = Math.min(FRAGS.max - (e.frags || 0), it.qty);
      if (n > 0) { e.frags = (e.frags || 0) + n; it.qty -= n; took = n; }
    } else {
      const n = Math.min(HEALS[it.type].max - (e.heals[it.type] || 0), it.qty);
      if (n > 0) { e.heals[it.type] = (e.heals[it.type] || 0) + n; it.qty -= n; took = n; }
    }
    if (took === null) continue;
    if (e.isPlayer) { sfx.pick(); toast('+ <em></em>', lootName({ ...it, qty: took }), false); }
    if (it.kind === 'gun' || it.qty <= 0) takeItem(it);
  }
}
const nearTo = (e, x, y, z, reach) => Math.abs(y - e.pos.y) < 1.6 && Math.hypot(x - e.pos.x, z - e.pos.z) < reach;
export function nearChest(e, reach = 2.2) {
  let best = null, bd = Infinity;
  for (const c of CH.list) if (!c.open && nearTo(e, c.x, c.y, c.z, reach)) { const d = Math.hypot(c.x - e.pos.x, c.z - e.pos.z); if (d < bd) { bd = d; best = c; } }
  return best;
}
export function nearGun(e) {
  let best = null, bd = Infinity;
  for (const it of CH.items) if (it.kind === 'gun' && nearTo(e, it.x, it.y, it.z, 1.9)) { const d = Math.hypot(it.x - e.pos.x, it.z - e.pos.z); if (d < bd) { bd = d; best = it; } }
  return best;
}
// with every slot full you swap the gun in your hands, so holding the knife picks nothing up
export const knifeFull = p => p.guns.length >= MAX_SLOTS && p.guns[p.weapon].kind === 'melee';
// E: open the chest in front of you, or trade the gun in your hands for the one at your feet
function useKey(p) {
  if (!oneLife()) return;
  const c = nearChest(p); if (c) return openChest(c.i, p);
  const it = nearGun(p); if (!it) return;
  if (knifeFull(p)) { toast('Slots full: hold the gun you want to swap'); return; }
  // any three guns, doubles included: a free slot takes it, otherwise it swaps for the gun in your hands
  if (p.guns.length < MAX_SLOTS) { giveGun(p, it.w, it.qty, undefined, it.r); takeItem(it); sfx.pick(); return; }
  const slot = p.weapon, old = p.guns[slot];
  dropItems(p, [{ kind: 'gun', w: old.id, qty: Math.max(1, p.ammo[slot]), r: old.rar | 0 }]);
  takeItem(it); giveGun(p, it.w, it.qty, slot, it.r); p.guns[slot].slot = old.slot; switchWeapon(p, slot); sfx.pick();
  toast('Swapped for <em></em>', lootName(it), false);
}
// bots: open a chest when they reach it, and go for one (or a gun on the floor) while they're short of guns
function findLoot(b) {
  let best = null, bs = Infinity;
  const inStorm = (x, z) => !storm.on || Math.hypot(x - storm.x, z - storm.z) < storm.r - 3;
  const consider = (o, x, y, z) => { const d = Math.hypot(x - b.pos.x, z - b.pos.z) + 12 * Math.abs(y - b.pos.y); if (d < 60 && d < bs && inStorm(x, z)) { bs = d; best = o; } };
  for (const c of CH.list) if (!c.open && !(c.claim && c.claim !== b && c.claim.alive)) consider(c, c.x, c.y, c.z); // leave other bots' claims alone
  for (const it of CH.items) if (it.kind === 'gun' && !b.guns.some(g => g.id === it.w)) consider(it, it.x, it.y, it.z);
  return best;
}
export function botLoot(b, ai) {
  const c = nearChest(b, 1.8); if (c) openChest(c.i, b);
  const valid = ai.loot && (ai.loot.spin ? CH.byId.get(ai.loot.id) === ai.loot : !ai.loot.open);
  if (!valid) ai.loot = null;
  if (b.guns.length >= 3) { ai.loot = null; return; }
  if (!ai.loot || now > ai.lootUntil) {
    ai.loot = findLoot(b); ai.lootUntil = now + 15;
    if (ai.loot) { ai.goal = new V3(ai.loot.x, ai.loot.y, ai.loot.z); ai.goalExpire = now + 15; }
  }
  if (ai.loot && ai.goal) ai.goal.set(ai.loot.x, ai.loot.y, ai.loot.z); // don't wander off once close
}

// ---------- heals ----------
// Using one takes a few seconds standing still: moving, jumping, shooting or switching weapons stops it.
const _hb = new V3(), _hf = new V3();
function pickHeal(e) {
  const b = e.heals.bandage > 0 && e.hp < HEALS.bandage.cap, m = e.heals.medkit > 0 && e.hp < 100;
  return m && (e.hp <= 50 || !b) ? 'medkit' : b ? 'bandage' : null;
}
const movingKeys = () => ['fwd', 'back', 'left', 'right', 'jump'].some(bound);
export function startHeal(e, want) {
  if (!oneLife() || e.useT || !e.alive || e.drop) return;
  if (e.isPlayer && (movingKeys() || !e.onGround || Math.hypot(e.vel.x, e.vel.z) > 1.5)) { toast('Stand still to heal'); return; }
  if (want) { // the player asked for this one
    const H = HEALS[want];
    if (!(e.heals[want] > 0)) { if (e.isPlayer) toast(`No ${H.name.toLowerCase()}s`); return; }
    if (e.hp >= (H.cap || 100)) { if (e.isPlayer) { if (H.cap) toast('Bandages only heal to <em></em>', String(H.cap), false); else toast('Already at full health'); } return; }
  }
  const type = want || pickHeal(e);
  if (!type) {
    if (e.isPlayer) {
      if (e.heals.bandage + e.heals.medkit === 0) toast('No heals'); else if (e.hp >= 100) toast('Already at full health');
      else toast('Bandages only heal to <em></em>', String(HEALS.bandage.cap), false);
    }
    return;
  }
  e.useT = { type, start: now, end: now + HEALS[type].time, puff: now }; e.reloading = false; e.sprint = false;
}
function updateHeal(e) {
  const u = e.useT; if (!u) return;
  if (!e.alive) { e.useT = null; return; }
  if (e.isPlayer && (movingKeys() || !e.onGround)) { e.useT = null; toast('Heal cancelled: you moved'); return; }
  if (now > u.puff + 0.35) { // little green crosses rising off whoever is healing
    u.puff = now; bodyC(e, _hb); _hb.y += 0.3;
    if (e.isPlayer) _hb.addScaledVector(fwdVec(e.yaw, 0, _hf), 0.7).y -= 0.5;
    burst(_hb, [0x6fe36f, 0xb8f7a8, 0xffffff], 3, 1.2, 0.07, 0.7);
  }
  if (now < u.end) return;
  const h = HEALS[u.type];
  e.heals[u.type]--; e.hp = Math.max(e.hp, Math.min(h.cap || 100, e.hp + h.hp)); e.useT = null;
  if (e.isPlayer) { sfx.heal(); toast('Used <em></em>', h.name, false); }
}
// reloading in battle royale draws on the ammo you carry; everywhere else (and for bots) mags are free
export const carries = e => oneLife() && e.isPlayer;
function finishReload(e) {
  const i = e.reloadWeapon, w = e.guns[i]; e.reloading = false; if (!w) return;
  let need = w.mag - e.ammo[i];
  const at = AMMO_OF[w.id];
  if (carries(e) && at) { need = Math.max(0, Math.min(need, e.res[at] || 0)); e.res[at] -= need; }
  e.ammo[i] += need;
}

function updateLoot(dt) {
  if (!CH.list.length && !CH.items.length) return;
  const gl = 0.3 + 0.22 * Math.sin(now * 4); LM.gold.emissive.setRGB(gl, gl * 0.7, 0);
  for (const c of CH.list) if (c.open && c.lid.rotation.x < 1.85) c.lid.rotation.x += (1.9 - c.lid.rotation.x) * Math.min(1, dt * 10);
  for (const it of CH.items) {
    const k = clamp((now - it.born) / 0.4, 0, 1);
    it.mesh.position.set(it.fx + (it.x - it.fx) * k, it.y + 0.35 + Math.sin(k * Math.PI) * 0.8 + Math.sin(now * 2.2 + it.ph) * 0.06, it.fz + (it.z - it.fz) * k);
    it.spin.rotation.y += dt * 1.4;
  }
  for (const e of [...ents]) if (e.alive && !e.drop && !e.remote && !e.zombie && (e.isPlayer ? state === 'playing' : e.ai)) autoPickup(e);
}
export function resetBR() {
  brSeed = Math.random().toString(36).slice(2);
  resetFlight(); resetLoot(); resetStorm(); hideSelf();
  MM.at = 0;
}

// ---------- zombies: co-op waves ----------
// Offline, or online as the host (the lowest player id still in this match), this client runs the zombies.
// Everyone else draws them from the host's presence and sends their hits on zombies to the host.
// If the host leaves, the next lowest id picks up the zombies where they are.
export const Z = { wave: 0, toSpawn: 0, nextSpawn: 0, breakUntil: 0, list: [], byId: new Map(), nextId: 1, over: false, overAt: 0, left: 0 };
const ZOMBIE_W = WNAMES.indexOf('Zombie');
const ZOMBIE_LOOKS = ['woodland', 'urban', 'desert', 'olive', 'night'];
export function hostPeer() { let lo = net.myPeer; for (const r of net.remotes.values()) if (r.m === net.m && r.peer < lo) lo = r.peer; return lo; }
export const zHost = () => mode !== 'online' || hostPeer() === net.myPeer;
const humans = () => [player, ...[...net.remotes.values()].filter(r => r.m === net.m)];
export const zLeft = () => (zHost() ? Z.toSpawn + Z.list.length : Z.left);
export function nearestZombie(pos) { let best = null, bd = Infinity; for (const z of Z.list) { const d = z.pos.distanceTo(pos); if (d < bd) { bd = d; best = z; } } return best; }
function addZombie(id, x, z, remote) {
  const e = newEntity('Zombie', '#7da34a', false, []);
  Object.assign(e, { zombie: true, zid: id, peer: 'z' + id, remote, target: new V3(x, 0, z), tyaw: 0, atkReady: 0, sideT: 0, side: 1 });
  e.pos.set(x, 0, z); e.alive = true; e.hp = 50 + Z.wave * 12;
  e.speed = Math.min(6.8, 3.4 + Z.wave * 0.25) * (Math.random() < 0.2 ? 1.3 : 1); // a few sprinters
  e.mesh = soldierMesh('', '#5f7f3a', true, { uniform: pick(ZOMBIE_LOOKS) });
  const u = e.mesh.userData; u.skinM.color.setHex(0x8fae6a); u.aim.children.slice(4, 7).forEach(c => { c.visible = false; }); // green skin, no gun
  e.mesh.position.copy(e.pos);
  Z.list.push(e); Z.byId.set(id, e); ents.push(e);
  return e;
}
function removeZombie(z, died) {
  if (died) { bodyC(z, _b); burst(_b, [0x5a7a2a, ...BLOOD], 12, 5, 0.1, 0.8); }
  z.alive = false; scene.remove(z.mesh);
  Z.list.splice(Z.list.indexOf(z), 1); Z.byId.delete(z.zid);
  const i = ents.indexOf(z); if (i >= 0) ents.splice(i, 1);
}
export function resetZombies() {
  for (const z of [...Z.list]) removeZombie(z, false);
  Object.assign(Z, { wave: 0, toSpawn: 0, nextSpawn: 0, breakUntil: 0, nextId: 1, over: false, overAt: 0, left: 0 });
}
function zombieDied(z, src, wname, head) {
  removeZombie(z, true);
  if (src === player) { player.kills++; sfx.kill(); if (state === 'playing') awardKill(wname, head); }
  else if (src && src.remote && !src.zombie) netEvent('zx', src.peer, WNAMES.indexOf(wname), head ? 1 : 0);
  updateScoreTop();
}
// every client, when a new wave starts: the downed get back up
function onWave(w) {
  if (state !== 'playing' && state !== 'paused') return;
  toast('Wave <em></em>', String(w), false); sfx.kill();
  if (!player.alive) { respawn(player); $('death').hidden = true; refreshVM(); relockAfterDeath(); }
}
// a free spot at least 12 m from every living player
function zombieSpawnPoint() {
  const hs = humans().filter(h => h.alive);
  const ok = SPAWNS.filter(s => hs.every(h => Math.hypot(h.pos.x - s[0], h.pos.z - s[1]) > 12));
  return pick(ok.length ? ok : SPAWNS);
}
const inPlay = h => h.alive && (h !== player || state === 'playing'); // a paused host isn't chased
function updateZombies(dt) {
  if (game !== 'zombies') return;
  const host = zHost();
  for (const z of Z.list) z.remote = !host;
  if (!host) { // draw the host's zombies
    for (const z of Z.list) {
      const px = z.pos.x, pz = z.pos.z;
      if (z.pos.distanceTo(z.target) > 6) z.pos.copy(z.target); else z.pos.lerp(z.target, 1 - Math.pow(0.0005, dt));
      z.yaw += angDiff(z.yaw, z.tyaw) * Math.min(1, dt * 12);
      z.vel.set((z.pos.x - px) / Math.max(dt, 1e-3), 0, (z.pos.z - pz) / Math.max(dt, 1e-3));
      poseSoldier(z, dt);
    }
    return;
  }
  if (Z.over) { if (now >= Z.overAt && state === 'playing') endZombies(); return; }
  const hs = humans();
  if (Z.wave > 0 && hs.every(h => (h === player ? !h.alive : h.dead))) { Z.over = true; Z.overAt = now + 2; return; } // everyone down
  if (!Z.list.length && Z.toSpawn <= 0) {
    if (!Z.breakUntil) Z.breakUntil = now + (Z.wave ? 6 : 3);
    else if (now >= Z.breakUntil) {
      Z.breakUntil = 0; Z.wave++;
      Z.toSpawn = Math.round((4 + Z.wave * 3) * (1 + 0.5 * (hs.length - 1)));
      onWave(Z.wave);
    }
  }
  if (Z.toSpawn > 0 && Z.list.length < 20 && now >= Z.nextSpawn) {
    const sp = zombieSpawnPoint(); addZombie(Z.nextId++, sp[0] + rand(-1, 1), sp[1] + rand(-1, 1), false); Z.toSpawn--;
    Z.nextSpawn = now + Math.max(0.35, 1.5 - Z.wave * 0.08);
  }
  for (const z of [...Z.list]) updateZombie(z, dt, hs);
}
function updateZombie(z, dt, hs) {
  let tgt = null, bd = Infinity;
  for (const h of hs) if (inPlay(h)) { const d = h.pos.distanceTo(z.pos); if (d < bd) { bd = d; tgt = h; } }
  const wish = new V3();
  if (tgt && now >= z.blindUntil) {
    const wp = navPoint(z, stairWaypoint(z, tgt.pos) || tgt.pos); // a target on another floor: head for the stairs
    wish.set(wp.x - z.pos.x, 0, wp.z - z.pos.z).normalize();
    if (now < z.sideT) wish.set(-wish.z * z.side, 0, wish.x * z.side).addScaledVector(wish, 0.3).normalize(); // detour round a wall
    if (bd < 1.6 && now >= z.atkReady && Math.abs(tgt.pos.y - z.pos.y) < 1.5) {
      z.atkReady = now + 0.9;
      const dmg = Math.min(35, 18 + Z.wave);
      if (tgt === player) damage(player, dmg, z, 'Zombie', false, null);
      else netEvent('h', tgt.peer, dmg, 0, ZOMBIE_W);
    }
  }
  const sp = z.speed * (now < z.stunUntil ? 0.4 : 1), k = z.launched ? 0 : Math.min(1, (z.onGround ? 8 * grip(z) : 2) * dt);
  z.vel.x += (wish.x * sp - z.vel.x) * k; z.vel.z += (wish.z * sp - z.vel.z) * k;
  moveEntity(z, dt);
  // blocked: climb the wall if the target is higher up (zombies scale buildings), otherwise go round
  if (z.bumped && tgt && tgt.pos.y > z.pos.y + 1) z.vel.y = 3.5;
  else if (z.bumped && now >= z.sideT) { z.sideT = now + 0.9; z.side = Math.random() < 0.5 ? -1 : 1; if (z.onGround) z.vel.y = JUMP * 0.8; }
  const lim = LIMIT - R; z.pos.x = clamp(z.pos.x, -lim, lim); z.pos.z = clamp(z.pos.z, -lim, lim); // never over the boundary wall
  if (wish.lengthSq() > 0) z.yaw += angDiff(z.yaw, Math.atan2(-wish.x, -wish.z)) * Math.min(1, dt * 8);
  poseSoldier(z, dt);
}
// what the host sends: wave, game over, zombies left, and each zombie [id, x, y, z, yaw, hp]
export function zombieState() {
  return { w: Z.wave, o: Z.over ? 1 : 0, n: zLeft(), l: Z.list.map(z => [z.zid, r2(z.pos.x), r2(z.pos.y), r2(z.pos.z), r2(z.yaw), Math.ceil(z.hp)]) };
}
export function syncZombies(zs) {
  if (!zs || typeof zs !== 'object' || !Array.isArray(zs.l)) return;
  const w = clamp(zs.w | 0, 0, 9999);
  if (w > Z.wave) { Z.wave = w; onWave(w); } else Z.wave = w;
  Z.left = clamp(zs.n | 0, 0, 9999);
  const seen = new Set();
  for (const a of zs.l.slice(0, 40)) {
    if (!Array.isArray(a)) continue;
    const id = a[0] | 0; if (id <= 0) continue;
    seen.add(id);
    const x = clamp(num(a[1]), -LIMIT, LIMIT), y = clamp(num(a[2]), 0, 40), zz = clamp(num(a[3]), -LIMIT, LIMIT);
    const z = Z.byId.get(id) || addZombie(id, x, zz, true);
    z.target.set(x, y, zz); z.tyaw = num(a[4]); z.hp = num(a[5]);
    Z.nextId = Math.max(Z.nextId, id + 1);
  }
  for (const z of [...Z.list]) if (!seen.has(z.zid)) removeZombie(z, true);
  if (zs.o === 1 && state === 'playing') endZombies();
}
function endZombies() {
  if (state === 'over') return;
  setState('over');
  $('overTitle').textContent = `Overrun on wave ${Z.wave}`;
  buildTable($('overTbl'));
  gainXP(P.XP.match + 60 * Z.wave, { match: true });
  showOverXp();
}

// ---------- aim trainer: 60 seconds, hit as many targets as you can ----------
export const AIM = { list: [], end: 0, hits: 0, shots: 0 };
const aimM = new THREE.MeshLambertMaterial({ color: 0xe5432d, emissive: 0x501010 }), aimG = new THREE.SphereGeometry(0.45, 16, 12);
// put a target somewhere in front of the player, 8 to 26 m out, in plain sight
function aimTarget(tg) {
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
function startAim() {
  stopAim(); AIM.end = now + 60; AIM.hits = AIM.shots = 0;
  for (let i = 0; i < 3; i++) { const tg = { m: new THREE.Mesh(aimG, aimM), r: 0.45 }; tg.m.castShadow = true; scene.add(tg.m); AIM.list.push(tg); aimTarget(tg); }
}
function stopAim() { for (const t of AIM.list) scene.remove(t.m); AIM.list.length = 0; }
function updateAim() {
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
}

// ---------- state ----------
function setState(s) {
  state = s;
  setMusic(s === 'menu' || s === 'lobby' ? 'menu' : null); // the soundtrack is for the menu (and lobby) only: matches are quiet
  $('lobby').hidden = s !== 'lobby';
  if (s === 'menu') { $('armory').hidden = true; updateProfile(); }
  if (s !== 'playing') clearBanners();
  $('menu').hidden = s !== 'menu';
  $('pause').hidden = s !== 'paused';
  $('over').hidden = s !== 'over';
  $('hud').hidden = s === 'menu' || s === 'lobby';
  if (s !== 'playing') { for (const k in keys) keys[k] = false; $('board').hidden = true; }
  if (s === 'playing' || s === 'over') { $('controls').hidden = true; rebinding = null; $('settings').hidden = true; $('armory').hidden = true; }
  if (s === 'paused') { $('pInviteBtn').hidden = mode !== 'online'; $('pInviteOut').hidden = true; }
  if (s === 'over') { $('overTbl').hidden = false; $('lobbyBtn').hidden = mode !== 'online'; }
  if (s === 'paused') {
    $('pauseTitle').textContent = 'Paused'; $('resumeBtn').textContent = 'Resume';
    $('pauseMsg').textContent = plWorks === false ? 'Press Resume when you are ready.' : 'Click Resume to grab the mouse again.';
  }
  if (s === 'menu' || s === 'over' || s === 'lobby') { $('death').hidden = true; if (document.pointerLockElement) document.exitPointerLock(); }
  if (s === 'lobby') { $('pause').hidden = true; endSpec(); closeInv(false); LB.key = ''; }
}
export function setMap(name) {
  if (name === currentMap) return;
  loadMap(scene, name);
  for (const n of nades) scene.remove(n.m); nades.length = 0;
  for (const pl of piles) scene.remove(pl.g); piles.length = 0;
}
// fromLink: joined by opening an invite link. Browsers only grab the mouse after a click,
// so we join the room right away and wait on one "Play" click.
function startGame(fromLink = false) {
  settings.name = cleanName($('nameIn').value) || 'Soldier';
  settings.room = cleanRoom(settings.room);
  saveSettings();
  leaveRoom();
  mode = settings.mode;
  game = GAMES[settings.game] ? settings.game : 'ffa';
  if (mode === 'online' && game === 'aim') game = 'ffa'; // the room's game replaces this once connected
  resetZombies(); stopAim(); fx.flash = 0;
  player.name = settings.name;
  player.color = mode === 'online' ? myHat : PLAYER_COLOR;
  player.corpseSrc = null; resetRun();
  net.m = 1; net.ev = [];
  for (const n of nades) scene.remove(n.m); nades.length = 0;
  for (const pl of piles) scene.remove(pl.g); piles.length = 0;
  $('feed').innerHTML = '';
  setMap(settings.map); // online, the room's map replaces this once connected
  teams.bank = [0, 0]; net.tscore = null; resetBR();
  player.team = game === 'tdm' || (game === 'br' && mode !== 'online' && (settings.sq | 0) > 1) ? 0 : undefined; // online, the server seats you once connected
  endSpec();
  if (mode === 'online' || !versus()) setupBots(0, settings.diff);
  else if (teamsOn()) { const ts = clamp(settings.ts | 0, 1, 6); setupBots(ts * 2 - 1, settings.diff, [...Array(ts - 1).fill(0), ...Array(ts).fill(1)]); } // you plus ts - 1 bots, against ts bots
  else if (squadsOn()) { const sq = cfg().sq, n = Math.min(11, Math.max(settings.bots, sq)); setupBots(n, settings.diff, botSquads([player], sq, n)); } // your squad first, then bot squads
  else setupBots(settings.bots, settings.diff);
  player.kills = player.deaths = 0; player.nadeReady = 0;
  respawn(player); dressVM(); refreshVM();
  if (game === 'aim') startAim();
  scoresChanged(); updateScoreTop();
  $('death').hidden = true; shake = 0; fx.dmg = 0;
  initAudio();
  if (mode === 'online') { enterLobby(); }
  else if (fromLink) {
    setState('paused');
    $('pauseTitle').textContent = `Room ${settings.room}`; $('resumeBtn').textContent = 'Play';
    $('pauseMsg').textContent = `You're joining as ${settings.name}.`;
    $('resumeBtn').focus();
  } else {
    setState('playing');
    if (plWorks !== false) requestLock();
  }
  updateNetStatus();
  if (mode === 'online') {
    startOnline(settings.room);
    // keep the address bar pointing at this room, so it can be copied and shared as-is
    try { history.replaceState(null, '', inviteLink(settings.room)); } catch (e) {}
  }
}
function playAgain() {
  if (mode !== 'online') return startGame();
  const hi = Math.max(net.m, ...[...net.remotes.values()].map(r => r.m));
  beginMatch(hi > net.m ? hi : net.m + 1, true); // everyone who presses Play again lands on the same match number
}
// online: start match m (the host pressed Start, or Play again). mine: I clicked, so I can grab the mouse;
// pulled in by the host, I wait on one click
export function beginMatch(m, mine) {
  net.m = m;
  player.kills = player.deaths = 0; player.nadeReady = 0; resetRun(); resetZombies(); fx.flash = 0;
  teams.bank = [0, 0]; net.tscore = null; resetBR();
  for (const e of ents) if (e.ai) { e.kills = e.deaths = 0; respawn(e); }
  respawn(player); refreshVM(); endSpec();
  scoresChanged(); updateScoreTop(); $('death').hidden = true;
  net.rosterAt = 0; // the host seats this match's bots right away (they board the blimp with everyone)
  if (mine && oneLife()) { net.unlockDue = false; sendLock(true); } // only does anything for the leader
  if (mine || plWorks === false) { setState('playing'); netSend(true); if (plWorks !== false) requestLock(); return; }
  setState('paused'); netSend(true);
  $('pauseTitle').textContent = 'Match started'; $('resumeBtn').textContent = 'Play';
  $('pauseMsg').textContent = 'The host started the match. Click Play to jump in.'; $('resumeBtn').focus();
}
// ---------- the lobby: everyone in the room, standing in a line-up, until the host presses Start ----------
const LB = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(35, 1, 0.1, 200), meshes: new Map(), key: '', t: 0, ui: 0 };
{
  LB.scene.background = new THREE.Color(0x2b2216); LB.scene.fog = new THREE.Fog(0x2b2216, 14, 40);
  LB.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x3a2c1a, 1.1));
  const key = new THREE.DirectionalLight(0xffe2b0, 1.3); key.position.set(4, 8, 6); LB.scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb8ff, 0.5); rim.position.set(-6, 4, -6); LB.scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x4a3a24 }));
  floor.rotation.x = -Math.PI / 2; LB.scene.add(floor);
}
function enterLobby() {
  net.lobbyFrom = net.m; setState('lobby'); netSend(true);
  net.unlockDue = true; // the lobby unlocks the room once nobody from the match is still alive (renderLobbyUI)
}
// battle royale: players from the last match who are still alive in it
const stillInMatch = () => (oneLife() ? [...net.remotes.values()].filter(r => !r.lobby && !r.dead && !r.over).length : 0);
// the room's players in groups: squads in battle royale, Blue and Red in team deathmatch, otherwise one line
function lobbyGroups() {
  const all = [player, ...net.remotes.values()];
  const by = new Map();
  for (const e of all) { const k = alliesOn() && e.team !== undefined ? e.team : 0; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, list]) => ({ t, list: list.sort((a, b) => (a === player ? -1 : b === player ? 1 : a.name.localeCompare(b.name))) }));
}
const groupName = t => (teamsOn() ? TEAM_NAMES[t] : squadsOn() ? `Squad ${t + 1}` : 'Players');
function updateLobby(dt) {
  LB.t += dt;
  const groups = lobbyGroups();
  const looks = e => (e === player ? { uniform: prog.uniform, camo: prog.camo[player.guns[player.weapon].id], lv: P.level(prog) } : { uniform: e.sk, camo: e.cm, lv: e.lv });
  const sig = e => { const l = looks(e); return [e.name, e.color, l.uniform, l.camo, l.lv].join('|'); };
  const key = groups.map(g => g.t + ':' + g.list.map(e => (e === player ? 'me' : e.peer) + '=' + sig(e)).join(',')).join(';');
  if (key !== LB.key) {
    LB.key = key;
    const keep = new Set();
    for (const g of groups) for (const e of g.list) {
      const id = e === player ? 'me' : e.peer, s = sig(e); keep.add(id);
      const old = LB.meshes.get(id); if (old && old.sig === s) continue;
      if (old) LB.scene.remove(old.mesh);
      const mesh = soldierMesh(e.name, e.color, false, looks(e)); LB.scene.add(mesh); LB.meshes.set(id, { mesh, sig: s });
    }
    for (const [id, m] of LB.meshes) if (!keep.has(id)) { LB.scene.remove(m.mesh); LB.meshes.delete(id); }
    // stand them in a row, a gap between groups, and pull the camera back to fit everyone
    const gap = 1.1, sep = 2, n = groups.reduce((a, g) => a + g.list.length, 0), w = (n - 1) * gap + (groups.length - 1) * sep;
    let x = -w / 2;
    for (const g of groups) { for (const e of g.list) { const m = LB.meshes.get(e === player ? 'me' : e.peer); m.mesh.position.set(x, 0, 0); m.x = x; x += gap; } x += sep - gap; }
    LB.dist = Math.max(9, w * 1.35 + 5);
    renderLobbyUI(groups);
  }
  let i = 0;
  for (const m of LB.meshes.values()) { m.mesh.rotation.y = Math.sin(LB.t * 0.6 + i++ * 1.3) * 0.25; }
  const sway = Math.sin(LB.t * 0.15) * 0.6;
  LB.cam.position.set(sway, 1.5, LB.dist || 7); LB.cam.lookAt(0, 0.55, 0); // aimed low so the line-up sits above the bottom card
  if (performance.now() > LB.ui) { LB.ui = performance.now() + 500; renderLobbyUI(groups); }
}
function renderLobbyUI(groups) {
  const isHost = net.host === net.myPeer, hostR = net.remotes.get(net.host);
  setText('lobbyTitle', `Room ${settings.room}`);
  const c = cfg(), bits = [GAMES[game], MAPS[net.map || currentMap]];
  if (squadsOn()) bits.push(SQUAD_NAMES[c.sq]); else if (teamsOn()) bits.push(`${c.ts}v${c.ts}`);
  if (oneLife() && c.hok) bits.push(`+${c.hok} HP per kill`);
  setText('lobbyInfo', bits.join(' \u00b7 '));
  const listKey = JSON.stringify([isHost, net.host, game, cfg().sq, groups.map(g => [g.t, g.list.map(e => [e.peer, e.name, e.color, e.lobby, e.ready, e.lv]), net.ready])]);
  const box = $('lobbyList');
  if (box.dataset.k !== listKey) { box.dataset.k = listKey; box.textContent = ''; } else groups = [];
  for (const g of groups) {
    const col = document.createElement('div'); col.className = 'lbGroup';
    const h = document.createElement('small'); h.textContent = groupName(g.t); col.append(h);
    for (const e of g.list) {
      const row = document.createElement('div'); row.className = 'lbRow';
      const dot = document.createElement('i'); dot.style.background = e.color;
      const n = document.createElement('b'); n.textContent = e === player ? `${e.name} (you)` : e.name;
      const tag = document.createElement('span');
      const id = e === player ? net.myPeer : e.peer;
      tag.textContent = [id === net.host ? 'Leader' : '', e === player ? (net.ready || isHost ? 'Ready' : 'Not ready') : !e.lobby ? 'In a match' : e.ready || id === net.host ? 'Ready' : 'Not ready', `Lv ${e === player ? P.level(prog) : e.lv || 1}`].filter(Boolean).join(' \u00b7 ');
      row.append(dot, n, tag);
      if (isHost && e !== player) { // hand the lead to them
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost small lbLead'; b.textContent = 'Make leader';
        b.addEventListener('click', () => { if (net.room) net.room.control({ t: 'lead', k: e.peer }); });
        row.append(b);
      }
      col.append(row);
    }
    box.append(col);
  }
  const n = 1 + net.remotes.size;
  // battle royale: the leader can't start the next one while anyone is still alive in the last one
  const still = stillInMatch();
  // and the room stays locked until then, so nobody joins and the settings can't re-seat the squads mid-match
  if (isHost && !still && net.unlockDue && net.status === 'ready') { net.unlockDue = false; sendLock(false); }
  setText('lobbyMsg', net.status !== 'ready' ? 'Connecting\u2026'
    : isHost && still ? `${still} player${still > 1 ? 's are' : ' is'} still alive in the last match. You can change settings and start when it ends.`
    : isHost ? (n === 1 ? 'Waiting for friends. Send them the invite link, or start now: bots fill the empty seats.' : `${n} players here. Bots fill the empty seats. Start when everyone's in.`)
    : !net.ready ? `Not ready: you'll sit out the next match until you press Ready.`
    : `Waiting for ${hostR ? hostR.name : 'the host'} to start the match.`);
  $('lobbyStart').hidden = !isHost; $('lobbyStart').disabled = net.status !== 'ready' || still > 0;
  $('lobbyReady').hidden = isHost; $('lobbyReady').textContent = net.ready ? 'Not ready' : 'Ready';
  renderLobbySet(isHost, still > 0);
}
// the leader's controls: game, map and that game's options. Each change goes to the server, which tells everyone.
// busy: a battle royale is still going (the server ignores changes then), so the controls are greyed out
function renderLobbySet(isHost, busy) {
  const box = $('lobbySet'), c = cfg(), map = net.map || currentMap;
  const key = JSON.stringify([isHost, busy, game, map, c, net.pub]);
  $('lobbySetWrap').hidden = !isHost; if (!isHost || box.dataset.k === key) return;
  box.dataset.k = key; box.textContent = '';
  const send = msg => { if (net.room) net.room.control({ t: 'set', ...msg }); };
  const pick = (label, opts, val, on) => {
    const w = document.createElement('label'); w.className = 'lbSet';
    const s = document.createElement('small'); s.textContent = label;
    const sel = document.createElement('select');
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = String(v); o.textContent = t; sel.append(o); }
    sel.value = String(val); sel.disabled = busy; sel.addEventListener('change', () => on(sel.value));
    w.append(s, sel); box.append(w);
  };
  pick('Game', Object.entries(GAMES).filter(([k]) => k !== 'aim'), game, v => send({ game: v }));
  pick('Map', Object.entries(MAPS), map, v => send({ map: v }));
  if (game === 'br') {
    pick('Squads', [[1, 'Solo'], [2, 'Duos'], [3, 'Trios'], [4, 'Squads']], c.sq || 1, v => send({ sq: +v }));
    pick('Heal on kill', [[0, 'Off'], [25, '+25 HP'], [50, '+50 HP']], c.hok || 0, v => send({ hok: +v }));
  }
  if (game === 'tdm') {
    pick('Teams', [1, 2, 3, 4, 5].map(n => [n, `${n}v${n}`]), c.ts, v => send({ ts: +v }));
    pick('Score to win', [[15, '15'], [25, '25'], [50, '50']], c.lim, v => send({ lim: +v }));
    pick('Players', [['together', 'Together vs bots'], ['split', 'Split evenly']], c.side, v => send({ side: v }));
  } else if (game !== 'zombies') pick('Bots', [0, 3, 5, 7, 11].map(n => [n, n ? String(n) : 'None']), c.bots, v => send({ bots: +v }));
  if (game !== 'zombies') pick('Bot skill', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], c.diff, v => send({ diff: v }));
  pick('Who can join', [['true', 'Public: listed'], ['false', 'Private: code only']], String(net.pub !== false), v => send({ pub: v === 'true' }));
}
$('lobbyStart').addEventListener('click', () => { if (state === 'lobby') playAgain(); });
$('lobbyReady').addEventListener('click', () => { net.ready = !net.ready; netSend(true); renderLobbyUI(lobbyGroups()); });
$('lobbyLeave').addEventListener('click', () => toMenu());
$('lobbyInvite').addEventListener('click', () => copyInvite(settings.room, $('lobbyInvite'), $('lobbyInviteOut')));
$('lobbyBtn').addEventListener('click', () => { if (mode === 'online') enterLobby(); });
export function endGame(winner) {
  setState('over'); sendLock(false);
  const won = winner.isPlayer || (alliesOn() && winner.team === player.team);
  $('overTitle').textContent = winner.isPlayer ? 'You win!' : won ? (squadsOn() ? 'Your squad wins!' : 'Your team wins!') : `${winner.name} wins`;
  endSpec();
  buildTable($('overTbl'));
  if (won) sfx.kill();
  gainXP(P.XP.match + (won ? P.XP.win : 0), { match: true, win: won });
  showOverXp();
}
function showOverXp() {
  const lv = P.level(prog);
  $('overGain').textContent = `+${run.xp} XP`;
  $('overLv').textContent = lv > run.startLv ? `Level ${run.startLv} \u2192 ${lv}` : `Level ${lv}`;
  fillLevelBar('overBar');
  const ul = $('overUnlocks'); ul.textContent = '';
  for (const u of run.unlocks) { const li = document.createElement('li'); li.textContent = u; ul.append(li); }
  ul.hidden = !run.unlocks.length;
}
export function toMenu() {
  leaveRoom(); mode = 'bots'; game = 'ffa'; stopAim(); fx.flash = 0; updateNetStatus();
  setState('menu');
  player.alive = false; player.respawnAt = Infinity;
  setMap(settings.map); resetBR(); setupBots(5, 'normal');
  updateModeUI(); // back on the server browser, its list starts refreshing again
}

// menu wiring
function segment(id, key, parse, onChange) {
  const seg = $(id);
  const sync = () => [...seg.children].forEach(b => b.setAttribute('aria-pressed', String(String(settings[key]) === b.dataset.v)));
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings[key] = parse(b.dataset.v); sync(); saveSettings(); if (onChange) onChange(); });
  sync();
}
if (settings.mode !== 'online') settings.mode = 'bots';
segment('modeSeg', 'mode', v => v, updateModeUI);
// a new room gets a fresh code, so two people creating rooms don't land in the same one by accident
const freshCode = () => 'spud-' + Math.random().toString(36).slice(2, 6);
$('roomIn').value = freshCode();
function createRoom() { settings.room = cleanRoom($('roomIn').value); $('roomIn').value = settings.room; startGame(); }
$('roomIn').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
$('joinIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinCode($('joinIn').value); });
$('joinBtn').addEventListener('click', () => joinCode($('joinIn').value));
if (settings.otab !== 'create') settings.otab = 'browse';
segment('otabSeg', 'otab', v => v, updateModeUI);
segment('tsSeg', 'ts', v => +v, updateModeUI);
segment('limSeg', 'lim', v => +v);
segment('sideSeg', 'side', v => v, updateModeUI);
segment('sqSeg', 'sq', v => +v, updateModeUI);
segment('hokSeg', 'hok', v => +v);
segment('pubSeg', 'pub', v => v === 'true');
segment('diffSeg', 'diff', v => v);
if (!GAMES[settings.game]) settings.game = 'ffa';
segment('gameSeg', 'game', v => v, updateModeUI);
segment('botSeg', 'bots', v => +v);
updateModeUI();
if (typeof settings.music !== 'boolean') settings.music = true;
segment('musicSeg', 'music', v => v === 'true', () => setMusicOn(settings.music));
setMusicOn(settings.music);
// settings: open from the menu or mid-match from the pause screen; everything applies at once
let setReturn = null;
function slider(id, key, min, max, fmt, onChange) {
  const inp = $(id), out = $(id.replace('In', 'Val'));
  if (!Number.isFinite(+settings[key])) settings[key] = +inp.value;
  settings[key] = clamp(+settings[key], min, max);
  inp.value = settings[key]; out.textContent = fmt(settings[key]);
  inp.addEventListener('input', () => { settings[key] = +inp.value; out.textContent = fmt(settings[key]); saveSettings(); if (onChange) onChange(); });
}
slider('sensIn', 'sens', 0.3, 2.5, v => v.toFixed(1));
slider('adsIn', 'adsSens', 0.3, 2, v => v.toFixed(1));
slider('fovIn', 'fov', 60, 100, v => String(v));
slider('volIn', 'vol', 0, 1, v => Math.round(v * 100) + '%', () => setVolume(settings.vol));
setVolume(settings.vol);
function openSettings(from) { setReturn = from; $('settings').hidden = false; $('setDone').focus(); }
function closeSettings() { $('settings').hidden = true; const b = setReturn === 'pause' ? $('pSetBtn') : $('setBtn'); if (b) b.focus(); }
$('setBtn').addEventListener('click', () => openSettings('menu'));
$('pSetBtn').addEventListener('click', () => openSettings('pause'));
$('setDone').addEventListener('click', closeSettings);
document.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('settings').hidden) { e.preventDefault(); closeSettings(); } });
$('pArmBtn').addEventListener('click', () => openArmory(true));
// browsers only start audio after a user gesture
addEventListener('pointerdown', initAudio, { once: true });
addEventListener('keydown', initAudio, { once: true });
initArmory(prog, { onChange: loadoutChanged, onClose: () => (state === 'menu' ? $('armBtn') : $('pArmBtn')).focus() });
$('armBtn').addEventListener('click', () => openArmory(false));
if (!MAPS[settings.map]) settings.map = 'depot';
segment('mapSeg', 'map', v => v, () => { if (state === 'menu') { setMap(settings.map); setupBots(5, 'normal'); } });
$('nameIn').value = settings.name;
$('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('playBtn').hidden) $('playBtn').click(); });
$('playBtn').addEventListener('click', () => (settings.mode === 'online' ? createRoom() : startGame()));
$('againBtn').addEventListener('click', playAgain);
$('deathAgain').addEventListener('click', () => (mode === 'online' ? deathToLobby(true) : playAgain()));
$('deathMenu').addEventListener('click', () => (mode === 'online' ? deathToLobby(false) : toMenu()));
$('menuBtn').addEventListener('click', toMenu);
$('quitBtn').addEventListener('click', toMenu);
$('ctrlBtn').addEventListener('click', () => openControls('menu'));
$('pCtrlBtn').addEventListener('click', () => openControls('pause'));
$('ctrlDone').addEventListener('click', closeControls);
$('ctrlReset').addEventListener('click', () => {
  Object.assign(binds, DEFAULT_BINDS); rebinding = null; settings.binds = { ...binds }; saveSettings();
  $('bindMsg').textContent = 'Controls are back to the defaults.'; renderBinds();
});
renderKeyHelp();

// ---------- invite links ----------
// A link ending in #room=<code> opens the game in online mode with that room filled in.
function roomFromLink() {
  const m = /(?:^|[#&?])room=([^&#]*)/.exec(location.hash + '&' + location.search);
  if (!m) return null;
  let v = m[1]; try { v = decodeURIComponent(v); } catch (e) {}
  return cleanRoom(v.replace(/\+/g, ' '));
}
function inviteLink(code) { return location.origin + location.pathname + location.search + '#room=' + cleanRoom(code); }
function showInviteMsg(t) { $('inviteMsg').textContent = t; $('inviteMsg').hidden = !t; }
async function copyInvite(code, btn, out) {
  const link = inviteLink(code), label = btn.textContent;
  let ok = false;
  try { await navigator.clipboard.writeText(link); ok = true; } catch (e) {}
  if (ok) {
    out.hidden = true; btn.textContent = 'Link copied';
    setTimeout(() => { btn.textContent = label; }, 2000);
  } else {
    out.value = link; out.hidden = false; out.focus(); out.select(); // clipboard blocked: let them copy it by hand
  }
  return ok;
}
function applyInvite() {
  const code = roomFromLink(); if (!code) return;
  if (settings.mode !== 'online') $('mOnline').click();
  settings.room = code; saveSettings();
  startGame(true);
}
$('inviteBtn').addEventListener('click', async () => {
  const code = cleanRoom($('roomIn').value); $('roomIn').value = code;
  if (await copyInvite(code, $('inviteBtn'), $('inviteOut'))) showInviteMsg(`Send it to your friend. Opening it puts them in room ${code}.`);
  else showInviteMsg('Copy this link and send it to your friend.');
});
$('pInviteBtn').addEventListener('click', () => copyInvite(settings.room, $('pInviteBtn'), $('pInviteOut')));
$('roomIn').addEventListener('input', () => { $('inviteOut').hidden = true; showInviteMsg(''); });
addEventListener('hashchange', () => { if (state === 'menu') applyInvite(); });
$('resumeBtn').addEventListener('click', () => { if (plWorks === false || (!player.alive && mode !== 'online')) setState('playing'); else requestLock(); }); // dead: keep the mouse free for Play again
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) $('touchNote').hidden = false;

// ---------- main loop ----------
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  resize();
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  // online the world keeps going while you're paused (others are still playing); offline it waits for you
  if (state === 'playing' || state === 'menu' || (state === 'paused' && mode === 'online')) {
    now += dt;
    if (state === 'playing') updatePlayer(dt); else if (state === 'menu') menuCamera(dt);
    for (const e of ents) {
      if (!e.isPlayer && !e.remote && !e.zombie) updateBot(e, dt);
      if (e.reloading && now >= e.reloadEnd) finishReload(e);
      if (e.useT && !e.remote) updateHeal(e);
    }
    if (mode === 'online') { updateRemotes(dt); updateRoster(); }
    updateZombies(dt); updateAim(); updateStorm(dt); updateFlight(); updateLoot(dt);
    updateNades(dt); updateParts(dt);
    for (const tr of tracers) if (tr.visible) { tr.userData.life -= dt; tr.material.opacity = tr.userData.life / 0.08; if (tr.userData.life <= 0) tr.visible = false; }
    for (const b of blasts) if (b.m.visible) { b.t += dt / 0.35; b.m.scale.setScalar(0.5 + b.t * 5.5); b.m.material.opacity = Math.max(0, 0.85 * (1 - b.t)); if (b.t >= 1) b.m.visible = false; }
    for (let i = piles.length - 1; i >= 0; i--) { const age = now - piles[i].born; if (age > 14) { piles[i].g.scale.setScalar(Math.max(0.01, 1 - (age - 14))); if (age > 15) { scene.remove(piles[i].g); piles.splice(i, 1); } } }
    shake = Math.max(0, shake - dt * 1.5);
  }
  // camera fov for scope
  const baseFov = state === 'menu' ? 75 : settings.fov;
  const targetFov = state !== 'playing' ? baseFov : zoomed ? curW().fov * settings.fov / 75 : baseFov + (player.sprint ? 6 : 0) + 6 * player.slideK;
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }

  // view model
  const healing = state !== 'menu' && player.alive && !player.drop && !!player.useT;
  const showVM = state !== 'menu' && state !== 'lobby' && player.alive && !player.drop && (healing || !(zoomed && camera.fov < 40));
  vm.root.visible = !healing; healVM.root.visible = healing;
  if (healing) poseHealVM(player.useT);
  if (showVM && !healing) {
    vm.kick = Math.max(0, vm.kick - dt * 7); vm.switchT = Math.max(0, vm.switchT - dt);
    vm.swayX *= Math.pow(0.002, dt); vm.swayY *= Math.pow(0.002, dt);
    const sp = Math.hypot(player.vel.x, player.vel.z) / 7.4;
    vm.ads += ((zoomed ? 1 : 0) - vm.ads) * Math.min(1, dt * 14);
    vm.spr += ((player.sprint ? 1 : 0) - vm.spr) * Math.min(1, dt * 10);
    VM_ADS.y = -curVM().userData.sightY * 0.72; // puts the sight on the screen center
    const swing = curW().kind === 'melee' ? vm.kick : 0; // knife slash
    const hip = 1 - vm.ads, base = _f.copy(VM_BASE).lerp(VM_ADS, vm.ads);
    const rk = player.reloading ? clamp((now - player.reloadStart) / Math.max(0.01, player.reloadEnd - player.reloadStart), 0, 1) : 0;
    const rl = rk > 0 ? Math.sin(Math.PI * Math.min(1, rk * 1.15)) : 0; // down, hold, back up
    const tap = rk > 0.45 && rk < 0.62 ? Math.sin((rk - 0.45) / 0.17 * Math.PI) : 0; // the mag slapping home
    vm.root.position.set(base.x + (vm.swayX + Math.sin(vm.bob) * 0.012 * sp) * hip - vm.spr * 0.06,
      base.y + (vm.swayY - Math.abs(Math.cos(vm.bob)) * 0.012 * sp) * hip - vm.switchT * 0.8 - vm.spr * 0.05 - rl * 0.13 + tap * 0.03,
      base.z + vm.kick * 0.07 * (1 - 0.6 * vm.ads) - swing * 0.25);
    vm.root.rotation.set(vm.kick * 0.18 * (1 - 0.6 * vm.ads) - vm.spr * 0.2 - swing * 1.1 + rl * 0.35 + tap * 0.08, vm.spr * 0.75 + swing * 0.7 + rl * 0.25, vm.spr * 0.3 + rl * 0.7);
    flashMesh.visible = now < vm.flashUntil;
    if (flashMesh.visible) { flashMesh.position.copy(curVM().userData.muzzle); flashMesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); flashMesh.scale.setScalar(curW().id === 0 || curW().id === 3 ? 1 : 1.8); }
  }
  if (state !== 'menu' && state !== 'lobby') updateHUD(dt);
  if (state === 'lobby') updateLobby(dt);
  updateInv();
  if (mode === 'online') netSend(false);

  // big maps: the sun's shadow box follows the camera (snapped, so shadows don't shimmer)
  if (LIMIT > 40) { const sx = Math.round(camera.position.x / 4) * 4, sz = Math.round(camera.position.z / 4) * 4; sun.position.set(sx + 25, 42, sz + 15); sun.target.position.set(sx, 0, sz); }
  else { sun.position.set(25, 42, 15); sun.target.position.set(0, 0, 0); }
  renderer.clear();
  if (state === 'lobby') { LB.cam.aspect = camera.aspect; LB.cam.updateProjectionMatrix(); renderer.render(LB.scene, LB.cam); }
  else renderer.render(scene, camera);
  if (showVM) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}

if (location.hostname === 'localhost') window.__spud = { player, net, ents, prog, Z, AIM, settings, tryFire, teamScore, storm,
  CH, FLIGHT, useKey, startHeal, get LIMIT() { return LIMIT; },
  applyRemote: (id, s, seat) => applyRemote(id, s, seat), renderLobbyUI: () => renderLobbyUI(lobbyGroups()), enterLobby: () => enterLobby(),
  camAt: (x, y, z, tx, ty, tz) => { camHold = true; camera.position.set(x, y, z); camera.lookAt(tx, ty, tz); }, boxes, STAIRS, PADS, SPAWNS, startGame, toMenu: () => toMenu(), get game() { return game; }, get state() { return state; }, get now() { return now; },
  kill: (t, by = player) => kill(t, by, "Pistol", false), squadmates: () => squadmates(), winnerNow: () => winnerNow() };
resize();
dressVM(); updateProfile();
setMap(settings.map);
setupBots(5, 'normal');
setState('menu');
applyInvite();
// accounts are off unless the server is configured; then the menu grows a sign-in panel
initAccount(prog, { onProgress: loadoutChanged, name: () => cleanName($('nameIn').value) || settings.name });
requestAnimationFrame(frame);
