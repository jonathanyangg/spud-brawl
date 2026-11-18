// Spud Brawl: a free-for-all arena shooter. three.js is loaded as a global by index.html.
import { G, JUMP, R, H, EYE, STEP, SCORE_LIMIT, MOVE, WEAPONS, KNIFE, SNIPER, THROWABLES, GAMES, GUNGAME, DIFF, BOT_NAMES, HATS, PLAYER_COLOR, WNAMES, ACTIONS, DEFAULT_BINDS, validCode, keyName } from './config.js';
import { MAPS, boxes, SPAWNS, boxGeo, loadMap, currentMap, HALF } from './world.js';
import { initAudio, sfxShot, sfx, toggleMute, setVolume } from './audio.js';
import { joinRoom } from './net.js';
import { setMusic, setMusicOn } from './music.js';
import * as P from './progress.js';
import { applyLook } from './skins.js';
import { initArmory, openArmory } from './armory.js';
import { initAccount, progressSaved } from './account.js';

const $ = id => document.getElementById(id);
const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const UP = new V3(0, 1, 0);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- settings ----------
const settings = { name: 'Soldier', diff: 'normal', bots: 5, sens: 1, adsSens: 1, fov: 75, vol: 1, mode: 'bots', game: 'ffa', room: 'brawl', map: 'depot', music: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('spudbrawl') || '{}')); } catch (e) {}
function saveSettings() { try { localStorage.setItem('spudbrawl', JSON.stringify(settings)); } catch (e) {} }
// progression (XP, unlocks, loadout) is saved per browser, separately from settings
const PROGRESS_KEY = 'spudbrawl-progress';
let progRaw = null; try { progRaw = localStorage.getItem(PROGRESS_KEY); } catch (e) {}
const prog = P.loadProgress(progRaw);
function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)); } catch (e) {} progressSaved(); } // progressSaved: cloud copy, if signed in
// this callsign hits 1.5x as hard (guns and frags)
const isMuted = name => String(name || '').trim().toLowerCase() === 'amimutted';
const binds = { ...DEFAULT_BINDS };
if (settings.binds && typeof settings.binds === 'object') for (const k in DEFAULT_BINDS) if (validCode(settings.binds[k])) binds[k] = settings.binds[k];

const bound = a => keys[binds[a]] === true;
function actionFor(code) { for (const k in binds) if (binds[k] === code) return k; return null; }

// ---------- renderer / scene ----------
const host = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
host.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene(); // sky and fog come from the map
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xfff4dc, 0x5d7a3a, 0.7));
const sun = new THREE.DirectionalLight(0xfff6e6, 0.85);
sun.position.set(25, 42, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 130 });
sun.shadow.bias = -0.0008;
scene.add(sun);

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
function rayWorld(o, d, maxT) {
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
function fwdVec(yaw, pitch, out = new V3()) {
  const c = Math.cos(pitch); return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}
function spreadDir(f, s) {
  const right = new V3().crossVectors(f, UP); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
  const up = new V3().crossVectors(right, f).normalize();
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
  return f.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
}
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
// How tall someone is right now, as a fraction of standing height: crouching and sliding lower you.
const poseK = e => 1 - 0.23 * e.crouch * (1 - e.slideK) - 0.41 * e.slideK;
// hit spheres at standing height: [height, radius, zone]; scaled down by poseK
const HITS = [[1.67, 0.22, 'head'], [1.25, 0.34, 'body'], [0.55, 0.3, 'legs']];
const eyePos = (e, out = new V3()) => out.set(e.pos.x, e.pos.y + EYE * poseK(e), e.pos.z);
const headC = (e, out = new V3()) => out.set(e.pos.x, e.pos.y + 1.67 * poseK(e), e.pos.z);
const bodyC = (e, out = new V3()) => out.set(e.pos.x, e.pos.y + 1.25 * poseK(e), e.pos.z);

// ---------- physics ----------
function overlaps(e, b, h = H * poseK(e)) {
  return e.pos.x + R > b.min.x && e.pos.x - R < b.max.x && e.pos.z + R > b.min.z && e.pos.z - R < b.max.z && e.pos.y + h > b.min.y && e.pos.y < b.max.y;
}
const canStand = e => !boxes.some(b => overlaps(e, b, H));
// Moon Knives plays in low gravity
const grav = () => (game === 'moon' ? G * 0.38 : G);
function moveEntity(e, dt) {
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
}

// ---------- soldiers ----------
// Built from boxes, facing -z, feet at y = 0. Legs pivot at the hips and knees; the upper body
// (torso, head, arms, gun) leans for crouch and slide, and the arms follow the aim pitch.
const HIP = 0.91;
const SKINS = [0xf1c6a0, 0xd9a47a, 0xb07a52, 0x7a4b2e, 0xe8b894];
const SM = {
  boot: new THREE.MeshLambertMaterial({ color: 0x2a2620 }), gear: new THREE.MeshLambertMaterial({ color: 0x3b3f2e }),
  visor: new THREE.MeshLambertMaterial({ color: 0x15181c }), glove: new THREE.MeshLambertMaterial({ color: 0x2f2b25 }),
};
const UNIFORM_IDS = P.UNIFORMS.map(u => u[0]), CAMO_IDS = P.CAMOS.map(c => c[0]);
const pick = a => a[(Math.random() * a.length) | 0];
const randomLook = () => ({ uniform: pick(UNIFORM_IDS), camo: pick(CAMO_IDS.filter(c => c !== 'nebula')) });
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
function setTag(mesh, name, color, lv) {
  const u = mesh.userData;
  if (u.tag) { mesh.remove(u.tag); u.tag.material.map.dispose(); u.tag.material.dispose(); }
  u.tag = nameSprite(name, color, lv); mesh.add(u.tag);
}
// look: { uniform, camo } ids from progress.js LOOKS. Legs and arms wear the uniform; vest and helmet keep the team color.
function soldierMesh(name, color, addToScene = true, look = {}) {
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
function poseSoldier(e, dt) {
  const m = e.mesh, u = m.userData, sp = Math.hypot(e.vel.x, e.vel.z);
  const run = Math.min(1, sp / 6) * (1 - e.slideK), c = e.crouch * (1 - e.slideK), s = e.slideK;
  u.bob += dt * sp * 1.9;
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
const muzzleOf = e => e.mesh.userData.muzzle.getWorldPosition(new V3());

// ---------- pools: particles, tracers, bodies, blasts ----------
const parts = [], partMats = new Map();
const partMat = c => { if (!partMats.has(c)) partMats.set(c, new THREE.MeshLambertMaterial({ color: c })); return partMats.get(c); };
for (let i = 0; i < 280; i++) { const m = new THREE.Mesh(boxGeo, partMat(0xffffff)); m.visible = false; scene.add(m); parts.push({ m, vel: new V3(), life: 0, max: 1, size: 0.1 }); }
let partIdx = 0;
function burst(pos, colors, n, speed, size = 0.12, life = 0.9) {
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
function tracer(a, b, mine) {
  const t = tracers[trIdx++ % tracers.length], arr = t.geometry.attributes.position.array;
  arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
  t.geometry.attributes.position.needsUpdate = true;
  t.material.color.set(mine ? 0xfff3b0 : 0xffb347); t.visible = true; t.userData.life = 0.08;
}
const piles = []; // fallen soldiers, cleared after a while
function corpse(t) {
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

const distVol = pos => state === 'playing' ? clamp(1 - pos.distanceTo(camera.position) / 60, 0, 1) * 0.7 : 0;

// ---------- game state ----------
let state = 'menu', now = 0, mode = 'bots', game = 'ffa';
const ents = [];
const player = newEntity(settings.name, PLAYER_COLOR, true, P.loadoutWeapons(prog));
ents.push(player);
let leaderCache = null;

// guns: the weapons this entity carries (weapon = slot in guns; guns[slot].id = index in WEAPONS). Set by gunsFor()
// on respawn; the player's carry their attachments. Remotes keep all of WEAPONS and weapon is the id they hold.
function newEntity(name, color, isPlayer, guns = WEAPONS) {
  return { name, color, isPlayer, guns, pos: new V3(), vel: new V3(), yaw: 0, pitch: 0, onGround: false, hp: 100, alive: false,
    kills: 0, deaths: 0, lastHurt: -99, respawnAt: Infinity, weapon: 0, prevWeapon: 1, ammo: guns.map(w => w.mag), streak: 0,
    reloading: false, reloadEnd: 0, nextShot: 0, nadeReady: 0, protectUntil: 0, mesh: null, flash: 0, bob: 0, bumped: false,
    crouch: 0, slideK: 0, slide: 0, slideReady: 0, slideDir: new V3(), sprint: false, sprintBlock: 0, stunUntil: 0, blindUntil: 0, nade: 'frag',
    remote: false, peer: null, m: 1 };
}
function setupBots(n, diff) {
  for (const e of ents) if (e.mesh) scene.remove(e.mesh);
  ents.length = 0; ents.push(player);
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    const b = newEntity(names[i], HATS[i % HATS.length], false);
    b.mesh = soldierMesh(b.name, b.color, true, randomLook());
    b.ai = { d: DIFF[diff], target: null, visible: false, reactAt: 0, nextScan: 0, strafeDir: 1, strafeSwitch: 0, goal: null, goalExpire: 0,
      lastSeen: new V3(), lastSeenAt: -99, stuckAt: 0, lastPos: new V3(), stuck: 0, aimH: 1.3, nextJump: 0, burst: 4, burstPause: 0 };
    ents.push(b); respawn(b);
  }
}
function pickSpawn(e) {
  const others = ents.filter(o => o !== e && o.alive);
  let best = null, bestD = -1;
  for (let i = 0; i < 5; i++) {
    const s = SPAWNS[(Math.random() * SPAWNS.length) | 0];
    let md = Infinity; for (const o of others) md = Math.min(md, Math.hypot(o.pos.x - s[0], o.pos.z - s[1]));
    if (md > bestD) { bestD = md; best = s; }
  }
  return best;
}
function respawn(e) {
  const s = pickSpawn(e);
  e.pos.set(s[0] + rand(-0.5, 0.5), 0, s[1] + rand(-0.5, 0.5)); e.vel.set(0, 0, 0);
  e.guns = gunsFor(e); e.weapon = e.isPlayer ? 0 : (Math.random() * e.guns.length) | 0; e.prevWeapon = e.guns.length > 1 ? 1 : 0;
  e.nade = e.isPlayer ? prog.nade : 'frag'; e.stunUntil = e.blindUntil = 0;
  e.hp = 100; e.alive = true; e.reloading = false; e.ammo = e.guns.map(w => w.mag); e.streak = 0;
  e.crouch = e.slideK = e.slide = 0; e.sprint = e.crouchOn = false;
  e.yaw = Math.atan2(e.pos.x, e.pos.z) + rand(-0.4, 0.4); e.pitch = 0; e.protectUntil = now + 1.5; e.lastHurt = -99;
  if (!e.isPlayer) {
    e.ai.target = null; e.ai.visible = false; e.ai.goal = null;
    e.mesh.visible = true; e.mesh.position.copy(e.pos);
  }
}

// ---------- game types ----------
// What each entity carries: gun game walks a ladder, the minigames hand out one weapon, otherwise your loadout
// (bots get three random guns).
function gunsFor(e) {
  const arm = i => (e.isPlayer ? P.armedWeapon(prog, i) : WEAPONS[i]);
  if (game === 'gungame') return [arm(GUNGAME[Math.min(GUNGAME.length - 1, Math.floor(e.kills / 2))])];
  if (game === 'moon') return [arm(KNIFE)];
  if (game === 'snipe') return [{ ...arm(SNIPER), dmg: 100 }]; // one body shot
  if (e.isPlayer) return P.loadoutWeapons(prog);
  return [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 3).map(i => WEAPONS[i]);
}
const scoreLimit = () => (game === 'gungame' ? GUNGAME.length * 2 - 1 : SCORE_LIMIT);
const versus = () => game !== 'zombies' && game !== 'aim';
const nadesOn = () => game === 'ffa' || game === 'zombies';
// gun game: after a kill, move up to the next weapon on the ladder
function gunGameStep(e) {
  if (game !== 'gungame' || e.remote || !e.alive) return;
  const g = gunsFor(e)[0]; if (g.id === e.guns[0].id) return;
  e.guns = [g]; e.weapon = 0; e.ammo = [g.mag]; e.reloading = false; e.nextShot = now + 0.3;
  if (e.isPlayer) { refreshVM(); dressVM(); vm.switchT = 0.3; toast('Next weapon: <em></em>', g.name, false); }
}

// ---------- combat ----------
function startReload(e) {
  const w = e.guns[e.weapon];
  if (e.reloading || e.ammo[e.weapon] >= w.mag) return;
  e.reloading = true; e.reloadEnd = now + w.reload; e.reloadWeapon = e.weapon;
  if (e.isPlayer) sfx.reload();
}
function switchWeapon(e, i) {
  if (i === e.weapon || i < 0 || i >= e.guns.length) return;
  e.prevWeapon = e.weapon; e.weapon = i; e.reloading = false;
  e.nextShot = Math.max(e.nextShot, now + 0.3);
  if (e.isPlayer) { vm.switchT = 0.3; refreshVM(); }
  if (e.ammo[i] <= 0) startReload(e);
}
function currentSpread(e) {
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
const _o = new V3(), _f = new V3(), _h = new V3(), _b = new V3();
const BLOOD = [0x8b1a1a, 0x6a1212];
function tryFire(e) {
  const w = e.guns[e.weapon], melee = w.kind === 'melee';
  if (now < e.nextShot || e.reloading) return false;
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
    if (e.isPlayer && mode === 'online') {
      const flat = []; if (!melee) ends.slice(0, 3).forEach(h => flat.push(r2(h.x), r2(h.y), r2(h.z)));
      netEvent('s', w.id, ...flat);
      for (const [t, a] of acc) {
        t.hp -= a.dmg;
        netEvent('h', t.peer, Math.round(a.dmg * 10) / 10, a.head ? 1 : 0, w.id);
        hitMarker(a.head, t.hp <= 0); a.head ? sfx.head() : sfx.hit();
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
    if (t === shooter || !t.alive || (game === 'zombies' && !t.zombie && !shooter.zombie)) continue; // no friendly fire in co-op
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
function damage(t, amt, src, wname, head, pt) {
  if (t.remote || !t.alive || now < t.protectUntil) return;
  t.hp -= amt; t.lastHurt = now; t.flash = 0.12;
  if (pt) burst(pt, BLOOD, head ? 6 : 3, 3, 0.07, 0.5);
  if (src && src.isPlayer && t !== src) { hitMarker(head, t.hp <= 0); head ? sfx.head() : sfx.hit(); }
  if (t.isPlayer) { sfx.hurt(); if (src && src !== t) { dmgFrom = src; dmgT = 1; } shake = Math.max(shake, 0.12); }
  if (t.ai && src && src !== t && src.alive) {
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
  addFeed(src, t, wname, head);
  bodyC(t, _b); burst(_b, [...BLOOD, new THREE.Color(t.color).getHex()], 14, 5, 0.1, 0.9);
  corpse(t);
  if (t.mesh) t.mesh.visible = false;
  t.respawnAt = t.isPlayer && game === 'zombies' ? Infinity : now + (t.isPlayer ? 4 : 3); // zombies: back next wave
  if (t.isPlayer) {
    deathPos.copy(camera.position); killer = self ? null : src;
    $('deathBy').textContent = self ? `Killed by your own ${wname === 'RPG' ? 'rocket' : wname.toLowerCase()}` : 'Killed by ' + src.name;
    $('deathHow').textContent = self ? 'Aim it a little further away.' : wname + (head ? ' \u00b7 headshot' : '');
    $('death').hidden = false; $('scope').hidden = true;
  }
  if (src && src.isPlayer && !self) { sfx.kill(); toast(`Eliminated <em></em>`, t.name, head); if (state === 'playing') awardKill(wname, head); }
  if (t.isPlayer && mode === 'online') netEvent('x', src && src.remote ? src.peer : '', WNAMES.indexOf(wname), head ? 1 : 0);
  leaderCache = null; updateScoreTop();
  if (mode === 'online') checkWinOnline();
  else if (!self && versus() && src.kills >= scoreLimit()) {
    if (state === 'playing') endGame(src);
    else ents.forEach(e => { e.kills = 0; e.deaths = 0; });
  }
}

// ---------- thrown equipment and rockets ----------
// Every client flies every grenade and rocket; each applies the blast only to what it owns (see appliesHere).
const nades = [];
const NADE_TYPES = ['frag', 'stun', 'flash', 'rocket']; // sent over the network by index
const nadeMats = {
  frag: new THREE.MeshLambertMaterial({ color: 0x4b5233 }), stun: new THREE.MeshLambertMaterial({ color: 0x3d6f9e }),
  flash: new THREE.MeshLambertMaterial({ color: 0xd8dcdf }), rocket: new THREE.MeshLambertMaterial({ color: 0x6b5a3e }),
};
const nadeG = new THREE.SphereGeometry(0.15, 10, 8);
function throwNade(e) {
  if (now < e.nadeReady || !e.alive || !nadesOn()) return;
  const type = THROWABLES[e.nade] ? e.nade : 'frag';
  e.nadeReady = now + THROWABLES[type].cd;
  const f = fwdVec(e.yaw, e.pitch);
  const pos = eyePos(e).addScaledVector(f, 0.6);
  const vel = f.multiplyScalar(17).add(new V3(0, 4, 0)).addScaledVector(e.vel, 0.5);
  spawnNade(pos, vel, e, type);
  if (e.isPlayer) {
    sfx.toss();
    if (mode === 'online') netEvent('n', r2(pos.x), r2(pos.y), r2(pos.z), r2(vel.x), r2(vel.y), r2(vel.z), NADE_TYPES.indexOf(type));
  }
}
function spawnNade(pos, vel, owner, type = 'frag') {
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
      if (!hit) for (const t of ents) if (t.alive && t !== n.owner && bodyC(t, _b).distanceTo(n.pos) < 0.9) { hit = true; break; }
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
  else if (n.type === 'rocket') explode(n.pos, n.owner, 'RPG', 150, 5.5);
  else if (n.type === 'stun') stunBlast(n.pos, n.owner);
  else flashBlast(n.pos, n.owner);
}
// Blasts: online, each player takes their own; this client also handles its bots, and the zombies if it runs them.
// In zombies, teammates' blasts don't touch you.
function appliesHere(t, owner) {
  if (!t.alive || t.remote) return false;
  if (game === 'zombies' && !t.zombie && owner !== t && !owner.zombie) return false;
  return t === player || t.zombie || !owner.remote;
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
let flashT = 0;
function flashBlast(pos, owner) {
  burst(pos, [0xffffff, 0xfff6d0], 20, 8, 0.08, 0.4);
  sfx.flash(blastVol(pos));
  for (const t of ents) {
    if (!appliesHere(t, owner)) continue;
    eyePos(t, _o); const d = _o.distanceTo(pos); if (d > 22) continue;
    const dir = pos.clone().sub(_o).divideScalar(d || 1);
    if (rayWorld(_o, dir, d) < d - 0.3) continue;
    const k = (1 - d / 22) * (fwdVec(t.yaw, t.pitch).dot(dir) > 0.3 ? 1 : 0.35);
    if (t.isPlayer) flashT = Math.max(flashT, 4 * k + 0.4);
    else t.blindUntil = Math.max(t.blindUntil, now + 4 * k);
  }
}

// ---------- bot brains ----------
function canSee(b, t) {
  eyePos(b, _o); headC(t, _h);
  const d = _h.clone().sub(_o); const dist = d.length(); d.divideScalar(dist);
  return rayWorld(_o, d, dist) >= dist - 0.05;
}
function randomGoal() {
  for (let i = 0; i < 20; i++) {
    const x = rand(-HALF, HALF), z = rand(-HALF, HALF);
    if (!boxes.some(b => x + 1 > b.min.x && x - 1 < b.max.x && z + 1 > b.min.z && z - 1 < b.max.z)) return new V3(x, 0, z);
  }
  return new V3(rand(-4, 4), 0, rand(-4, 4));
}
function updateBot(b, dt) {
  if (!b.alive) { if (now >= b.respawnAt) respawn(b); return; }
  const ai = b.ai, w = b.guns[b.weapon];
  const blind = now < b.blindUntil, stunned = now < b.stunUntil;
  if (blind) ai.visible = false; // flashed: can't pick anyone out, just wanders
  else if (now >= ai.nextScan) {
    ai.nextScan = now + 0.22;
    let best = null, bd = Infinity;
    for (const t of ents) {
      if (t === b || !t.alive) continue;
      let d = t.pos.distanceTo(b.pos) * (t.isPlayer ? 0.85 : 1);
      if (d < 55 && d < bd && canSee(b, t)) { bd = d; best = t; }
    }
    if (best) {
      if (ai.target !== best || !ai.visible) {
        const toT = Math.atan2(-(best.pos.x - b.pos.x), -(best.pos.z - b.pos.z));
        const behind = Math.abs(angDiff(b.yaw, toT)) > 1.4;
        ai.reactAt = now + ai.d.react * rand(0.8, 1.25) + (behind ? 0.35 : 0);
        ai.aimH = rand(0.85, 1.65);
      }
      ai.target = best; ai.visible = true; ai.lastSeen.copy(best.pos); ai.lastSeenAt = now;
    } else ai.visible = false;
  }
  if (ai.target && !ai.target.alive) { ai.target = null; ai.visible = false; }

  const wish = new V3();
  const tgt = ai.visible ? ai.target : null;
  if (tgt) {
    const to = new V3(tgt.pos.x - b.pos.x, 0, tgt.pos.z - b.pos.z); const dist = to.length(); to.divideScalar(dist || 1);
    if (now > ai.strafeSwitch) { ai.strafeDir = Math.random() < 0.5 ? -1 : 1; ai.strafeSwitch = now + rand(0.5, 1.6); }
    wish.set(-to.z * ai.strafeDir, 0, to.x * ai.strafeDir);
    if (w.kind === 'melee') wish.multiplyScalar(0.4).addScaledVector(to, 1.5); // knife: close in
    else if (dist > w.pref + 4) wish.addScaledVector(to, 1.3); else if (dist < w.pref - 3) wish.addScaledVector(to, -0.9);
    if (now > ai.nextJump && b.onGround && Math.random() < dt * 0.6) { b.vel.y = JUMP; ai.nextJump = now + 1.2; }
    if (b.ammo[b.weapon] < w.mag * 0.25 && !b.reloading && dist > 20) startReload(b);
  } else {
    const chasing = now - ai.lastSeenAt < 6;
    if (!ai.goal || now > ai.goalExpire || Math.hypot(ai.goal.x - b.pos.x, ai.goal.z - b.pos.z) < 1.5) {
      if (chasing) { ai.goal = ai.lastSeen.clone(); ai.lastSeenAt = -99; } // chase the last sighting once, then wander
      else ai.goal = randomGoal();
      ai.goalExpire = now + rand(4, 8);
    }
    wish.set(ai.goal.x - b.pos.x, 0, ai.goal.z - b.pos.z);
    if (!b.reloading && b.ammo[b.weapon] < w.mag) startReload(b);
  }
  if (wish.lengthSq() > 0.0001) wish.normalize();

  // unstick
  if (now >= ai.stuckAt) {
    const moved = Math.hypot(b.pos.x - ai.lastPos.x, b.pos.z - ai.lastPos.z);
    if (moved < 0.6 && wish.lengthSq() > 0) {
      if (b.onGround) b.vel.y = JUMP;
      if (++ai.stuck > 1) { ai.goal = randomGoal(); ai.goalExpire = now + 5; ai.strafeDir *= -1; ai.stuck = 0; }
    } else ai.stuck = 0;
    ai.lastPos.copy(b.pos); ai.stuckAt = now + 0.7;
  }

  const speed = 6.4 * (stunned ? 0.45 : 1), k = (b.onGround ? 10 : 2.5) * dt;
  b.vel.x += (wish.x * speed - b.vel.x) * Math.min(1, k);
  b.vel.z += (wish.z * speed - b.vel.z) * Math.min(1, k);
  moveEntity(b, dt);

  // aim
  let ty, tp;
  if (tgt) {
    eyePos(b, _o);
    const dx = tgt.pos.x - _o.x, dy = tgt.pos.y + ai.aimH * poseK(tgt) - _o.y, dz = tgt.pos.z - _o.z;
    ty = Math.atan2(-dx, -dz); tp = Math.atan2(dy, Math.hypot(dx, dz));
  } else if (wish.lengthSq() > 0) { ty = Math.atan2(-wish.x, -wish.z); tp = 0; }
  else { ty = b.yaw; tp = 0; }
  const dyaw = angDiff(b.yaw, ty), turn = ai.d.turn * dt * (stunned ? 0.4 : 1);
  b.yaw += clamp(dyaw, -turn, turn); b.pitch += clamp(tp - b.pitch, -turn, turn);
  if (tgt && now >= ai.reactAt && now >= ai.burstPause && Math.abs(dyaw) + Math.abs(tp - b.pitch) < 0.14) {
    const dist = tgt.pos.distanceTo(b.pos);
    if (dist < w.range * 0.85 && tryFire(b)) {
      if (w.auto && --ai.burst <= 0) { ai.burst = 3 + ((Math.random() * 4) | 0); ai.burstPause = now + rand(0.35, 0.8); }
      else if (!w.auto) ai.burstPause = now + rand(0.1, 0.5);
    }
  }
  if (now - b.lastHurt > 5 && b.hp < 100) b.hp = Math.min(100, b.hp + 10 * dt);

  poseSoldier(b, dt);
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
function refreshVM() { vm.guns.forEach((g, i) => g.visible = i === curW().id); }
// dress the first-person guns: camo, uniform sleeves, attachment meshes
function dressVM() {
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
let locked = false, plWorks = null, fireLatch = false, triggerUsed = false, zoomed = false, crouchTap = false;
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
  else if (state === 'playing') { setState('paused'); }
});
document.addEventListener('pointerlockerror', () => { if (plWorks !== true) plWorks = false; });
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
  if (a === 'w1') switchWeapon(player, 0);
  else if (a === 'w2') switchWeapon(player, 1);
  else if (a === 'w3') switchWeapon(player, 2);
  else if (a === 'swap') switchWeapon(player, player.prevWeapon);
  else if (a === 'reload') startReload(player);
  else if (a === 'nade') throwNade(player);
  else if (a === 'crouch') crouchTap = true;
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => { const n = player.guns.length; if (state === 'playing' && player.alive) switchWeapon(player, (player.weapon + (e.deltaY > 0 ? 1 : n - 1)) % n); }, { passive: true });
// Ctrl+W/T/N can't be blocked in a page, so a crouch bound to Ctrl could close the tab: ask first while in a match
addEventListener('beforeunload', e => { if (state === 'playing') e.preventDefault(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; $('board').hidden = true; });
document.addEventListener('keydown', e => {
  if (rebinding || (e.target && e.target.tagName === 'INPUT')) return;
  if (e.code === binds.mute && !e.repeat) { toast(toggleMute() ? 'Sound off' : 'Sound on'); }
  if (state !== 'playing') return;
  if (e.code.startsWith('Arrow') || actionFor(e.code)) e.preventDefault();
  if (e.code === 'Escape' && plWorks === false) { setState('paused'); return; }
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
    `${kb(binds.w1)}${kb(binds.w2)}${kb(binds.w3)} ${kb(binds.swap)} Switch weapon`,
    `${kb(binds.reload)} Reload`, `${kb(binds.nade)} Throw equipment`,
    `${kb(binds.scores)} Scores &nbsp;${kb(binds.mute)} Mute`,
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
const deathPos = new V3(); let killer = null, shake = 0, dmgFrom = null, dmgT = 0;
function updatePlayer(dt) {
  const p = player;
  if (!p.alive) {
    const left = Math.ceil(p.respawnAt - now);
    $('deathCount').textContent = game === 'zombies' ? 'Back next wave' : 'Back in ' + Math.max(1, left);
    camera.position.lerp(_o.copy(deathPos).add(new V3(0, 3, 0)), 1 - Math.pow(0.1, dt));
    if (killer && killer.alive) camera.lookAt(killer.pos.x, killer.pos.y + 1, killer.pos.z);
    if (now >= p.respawnAt) { respawn(p); $('death').hidden = true; refreshVM(); }
    return;
  }
  const turn = 2.4 * dt;
  if (keys.ArrowLeft) p.yaw += turn; if (keys.ArrowRight) p.yaw -= turn;
  if (keys.ArrowUp) p.pitch = clamp(p.pitch + turn, -1.45, 1.45); if (keys.ArrowDown) p.pitch = clamp(p.pitch - turn, -1.45, 1.45);
  const f = (bound('fwd') ? 1 : 0) - (bound('back') ? 1 : 0), s = (bound('right') ? 1 : 0) - (bound('left') ? 1 : 0);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  const wish = new V3(-sy * f + cy * s, 0, -cy * f - sy * s);
  if (wish.lengthSq() > 0) wish.normalize();
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
    const k = Math.min(1, (p.onGround ? 6 : 1) * dt);
    p.vel.x += (p.slideDir.x * v - p.vel.x) * k; p.vel.z += (p.slideDir.z * v - p.vel.z) * k;
  } else {
    let speed = (zoomed ? MOVE.ads : p.sprint ? MOVE.sprint : MOVE.walk) * (w.speed || 1) * (now < p.stunUntil ? 0.5 : 1);
    if (target) speed = Math.min(speed, MOVE.crouch); // by intent, so standing back up isn't slowed
    const k = Math.min(1, (p.onGround ? 12 : 3) * dt);
    p.vel.x += (wish.x * speed - p.vel.x) * k; p.vel.z += (wish.z * speed - p.vel.z) * k;
  }
  if (bound('jump') && p.onGround) { if (p.crouchOn && canStand(p)) p.crouchOn = false; p.vel.y = JUMP; p.onGround = false; }
  moveEntity(p, dt);
  if (firing && (w.auto || !triggerUsed) && tryFire(p)) triggerUsed = true;
  fireLatch = false; // a tap shorter than one frame still fires
  if (now - p.lastHurt > 5 && p.hp < 100) p.hp = Math.min(100, p.hp + 12 * dt);

  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (p.onGround) vm.bob += dt * sp * 1.6;
  const bobY = reduceMotion ? 0 : Math.sin(vm.bob * 2) * 0.04 * Math.min(1, sp / 6);
  camera.position.set(p.pos.x, p.pos.y + EYE * poseK(p) + bobY, p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, reduceMotion ? 0 : p.slideK * 0.07);
  if (shake > 0 && !reduceMotion) camera.position.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.3));
}

// natural end: you stay crouched; cancelled: you stand (if there's room)
function endSlide(p, natural) {
  p.slide = 0; p.slideReady = now + MOVE.slideCooldown;
  p.crouchOn = natural || !canStand(p);
}
function menuCamera(dt) {
  const a = now * 0.07;
  camera.position.set(Math.cos(a) * 40, 19, Math.sin(a) * 40);
  camera.lookAt(0, 1, 0);
}

// ---------- HUD ----------
const txtCache = new Map();
function setText(id, s) { if (txtCache.get(id) !== s) { txtCache.set(id, s); $(id).textContent = s; } }
let hitT = 0, toastTimer = 0;
function hitMarker(head, isKill) { hitT = head ? 0.35 : 0.22; $('hitm').classList.toggle('kill', !!isKill || head); }
function toast(html, name, head) {
  const el = $('toast'); el.innerHTML = html;
  const em = el.querySelector('em'); if (em) em.textContent = name + (head ? ' \u00b7 headshot' : '');
  el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}
function addFeed(src, t, wname, head) {
  if (state !== 'playing') return;
  const li = document.createElement('li');
  const nm = e => { const b = document.createElement('b'); b.textContent = e.name; b.style.color = e.color; return b; };
  const self = !src || src === t;
  if (!self) li.appendChild(nm(src));
  const w = document.createElement('span'); w.className = 'w'; w.textContent = self ? 'suicide' : wname; li.appendChild(w);
  if (head) { const h = document.createElement('span'); h.className = 'hs'; h.textContent = 'HEAD'; li.appendChild(h); }
  li.appendChild(nm(t));
  if ((src && src.isPlayer) || t.isPlayer) li.className = 'me';
  const feed = $('feed'); feed.prepend(li);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => li.classList.add('fade'), 5000); setTimeout(() => li.remove(), 5600);
}
function sorted() { return ents.filter(e => !e.zombie).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths); }
// the three chips at the top: label and value for each, by game type
function chips(a, av, b, bv, c, cv) { setText('sYouL', a); setText('sYou', String(av)); setText('sLeadL', b); setText('sLead', String(bv)); setText('sGoalL', c); setText('sGoal', String(cv)); }
function updateScoreTop() {
  if (game === 'zombies') return chips('Kills', player.kills, 'Wave', Z.wave || '-', 'Left', zLeft());
  if (game === 'aim') {
    return chips('Hits', AIM.hits, 'Accuracy', AIM.shots ? Math.round(100 * AIM.hits / AIM.shots) + '%' : '-', 'Time', Math.max(0, Math.ceil(AIM.end - now)));
  }
  if (!leaderCache) leaderCache = sorted();
  const lead = leaderCache.find(e => !e.isPlayer) || leaderCache[0];
  chips('You', player.kills, 'Top rival', lead && !lead.isPlayer ? `${lead.name} ${lead.kills}` : '-', 'To win', scoreLimit());
}
const levelOf = e => e.isPlayer ? P.level(prog) : e.remote ? e.lv : '\u2013';
function buildTable(tbl) {
  tbl.innerHTML = '<tr><th>#</th><th>Player</th><th>Lv</th><th>Kills</th><th>Deaths</th></tr>';
  sorted().forEach((e, i) => {
    const tr = document.createElement('tr'); if (e.isPlayer) tr.className = 'me';
    const c = (t) => { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); return td; };
    c(i + 1); const n = c(''); const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = e.color; n.appendChild(dot); n.appendChild(document.createTextNode(e.name));
    c(levelOf(e)); c(e.kills); c(e.deaths); tbl.appendChild(tr);
  });
}
function updateHUD(dt) {
  const p = player, w = p.guns[p.weapon];
  setText('hpnum', String(Math.ceil(p.hp)));
  const hpb = $('hpbar'); hpb.style.width = p.hp + '%'; hpb.style.backgroundColor = p.hp < 35 ? 'var(--ketchup)' : p.hp < 65 ? 'var(--butter)' : 'var(--herb)';
  setText('wname', w.name);
  const ammo = $('ammo'), s = w.kind === 'melee' ? 'melee' : `${p.ammo[p.weapon]}|${w.mag}`;
  if (txtCache.get('ammo') !== s) { txtCache.set('ammo', s); ammo.innerHTML = w.kind === 'melee' ? '&ndash;' : `${p.ammo[p.weapon]} <small>/ ${w.mag}</small>`; }
  const slotKey = p.guns.map(g => g.name).join();
  if (txtCache.get('slots') !== slotKey) {
    txtCache.set('slots', slotKey); $('slots').textContent = '';
    p.guns.forEach((g, i) => { const sp = document.createElement('span'); sp.textContent = `${i + 1} ${g.name}`; $('slots').append(sp); });
  }
  [...$('slots').children].forEach((el, i) => el.classList.toggle('on', i === p.weapon));
  $('nade').hidden = !nadesOn();
  const nd = Math.ceil(p.nadeReady - now), nn = (THROWABLES[p.nade] || THROWABLES.frag).name;
  setText('nade', `${keyName(binds.nade)} \u00b7 ` + (nd > 0 ? `${nn} in ${nd}s` : `${nn} ready`)); $('nade').classList.toggle('ready', nd <= 0);
  flashT = Math.max(0, flashT - dt); $('flashFx').style.opacity = clamp(flashT, 0, 1);
  $('stunFx').style.opacity = now < p.stunUntil ? clamp((p.stunUntil - now) / 1.5, 0, 0.8) : 0;
  if (game === 'zombies' || game === 'aim') updateScoreTop();
  $('reloadTxt').hidden = !p.reloading;
  $('scope').hidden = !(zoomed && w.scope && p.alive && camera.fov < 40);
  // crosshair gap matches the real spread cone
  const px = (host.clientHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  $('cross').style.setProperty('--gap', (3 + currentSpread(p) * px).toFixed(1) + 'px');
  $('cross').style.opacity = zoomed || !p.alive ? 0 : 1;
  hitT = Math.max(0, hitT - dt); $('hitm').style.opacity = hitT > 0 ? Math.min(1, hitT * 6) : 0;
  const since = now - p.lastHurt;
  $('hurt').style.opacity = clamp((since < 0.5 ? 0.6 * (1 - since / 0.5) : 0) + (p.alive && p.hp < 35 ? 0.25 + 0.1 * Math.sin(now * 5) : 0), 0, 1);
  dmgT = Math.max(0, dmgT - dt * 0.9);
  if (dmgFrom && dmgT > 0) {
    const rx = dmgFrom.pos.x - p.pos.x, rz = dmgFrom.pos.z - p.pos.z, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const ang = Math.atan2(rx * cy - rz * sy, -rx * sy - rz * cy);
    $('dmgdir').style.transform = `rotate(${ang}rad)`;
  }
  $('dmgdir').style.opacity = dmgT;
}

// ---------- XP and unlocks ----------
const run = { xp: 0, unlocks: [], startLv: 1 }; // this match, for the Match over screen
function resetRun() { run.xp = 0; run.unlocks = []; run.startLv = P.level(prog); }
function gainXP(xp, opts) {
  const r = P.award(prog, xp, opts);
  run.xp += xp; run.unlocks.push(...r.unlocks);
  saveProgress(); updateProfile();
  return r;
}
function awardKill(wname, head) {
  const w = WNAMES.indexOf(wname), p = player;
  p.streak++;
  let xp = P.XP.kill + (head ? P.XP.head : 0) + (w >= WEAPONS.length ? P.XP.frag : 0) + P.XP.streak * clamp(p.streak - 1, 0, 5);
  if (game === 'zombies') xp = Math.round(xp * 0.4); // zombies come in crowds
  const r = gainXP(xp, { kill: { w, head } });
  xpPop(xp, p.streak >= 3 ? `${p.streak} streak` : head ? 'headshot' : '');
  if (r.levelUp || r.unlocks.length) showBanner(r.levelUp, r.unlocks);
}
let xpPopT = 0;
function xpPop(xp, why) {
  const el = $('xpPop'); el.textContent = `+${xp} XP` + (why ? ` \u00b7 ${why}` : '');
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  clearTimeout(xpPopT); xpPopT = setTimeout(() => el.classList.remove('go'), 1200);
}
// level-ups and unlocks queue up and show one at a time under the score
const bannerQ = []; let bannerBusy = false;
function showBanner(levelUp, unlocks) {
  if (levelUp) bannerQ.push({ big: `Level ${levelUp}`, un: unlocks });
  else for (const u of unlocks) bannerQ.push({ big: 'Unlocked', un: [u] });
  if (!bannerBusy) nextBanner();
}
function nextBanner() {
  const el = $('banner'), b = bannerQ.shift();
  if (!b) { bannerBusy = false; el.classList.remove('show'); return; }
  bannerBusy = true; el.textContent = '';
  const big = document.createElement('div'); big.className = 'big'; big.textContent = b.big; el.append(big);
  for (const u of b.un.slice(0, 3)) {
    const d = document.createElement('div'); d.className = 'un';
    const sm = document.createElement('small'); sm.textContent = 'New';
    d.append(sm, document.createTextNode(u)); el.append(document.createElement('br'), d);
  }
  if (b.un.length > 3) { const d = document.createElement('div'); d.className = 'un'; d.textContent = `+${b.un.length - 3} more in the Armory`; el.append(document.createElement('br'), d); }
  el.classList.add('show');
  if (b.big.startsWith('Level')) sfx.kill();
  setTimeout(() => { el.classList.remove('show'); setTimeout(nextBanner, 350); }, 2600);
}
function clearBanners() { bannerQ.length = 0; bannerBusy = false; $('banner').classList.remove('show'); }
function fillLevelBar(barId, textId) {
  const li = P.levelInfo(prog.xp);
  $(barId).style.width = li.need ? (100 * li.into / li.need).toFixed(1) + '%' : '100%';
  if (textId) $(textId).textContent = li.need ? `${li.into} / ${li.need} XP` : 'Max level';
  return li;
}
function updateProfile() {
  const lv = P.level(prog);
  $('pLv').textContent = lv; $('pLv').setAttribute('aria-label', `Level ${lv}`);
  $('pLvName').textContent = `Level ${lv}`;
  fillLevelBar('pXpBar', 'pXp');
  $('armNew').hidden = !prog.fresh; $('armNew').textContent = `${prog.fresh} new`;
  setText('sLv', String(lv));
}
// the Armory changed the loadout: looks change now; in a match, weapons change when you next respawn
function loadoutChanged() {
  if (state === 'menu') { player.guns = gunsFor(player); player.ammo = player.guns.map(w => w.mag); player.weapon = 0; refreshVM(); }
  player.corpseSrc = null;
  dressVM(); saveProgress(); updateProfile();
}

// ---------- online play ----------
// Every player streams a presence (position, aim, score, a ring of recent events) through the relay.
// Shooters report hits; the player who was hit applies the damage and reports their own death,
// so nobody edits anyone else's health.
const net = { room: null, status: '', myPeer: Math.random().toString(36).slice(2, 12), seq: 0, ev: [], lastSeq: new Map(), remotes: new Map(), m: 1, sendAt: 0 };
const myHat = HATS[(Math.random() * HATS.length) | 0];
const r2 = v => Math.round(v * 100) / 100;
const num = v => (Number.isFinite(+v) ? +v : 0);
const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').trim().slice(0, 16);
// shop looks are valid too, so friends see what you bought (bots never wear them: randomLook uses the free lists)
const cleanUniform = v => (UNIFORM_IDS.includes(v) || P.premiumOf('uniform').includes(v) ? v : 'olive');
const cleanCamo = v => (CAMO_IDS.includes(v) || P.premiumOf('camo').includes(v) ? v : 'factory');
const cleanLevel = v => clamp(Math.floor(num(v)), 1, P.MAX_LEVEL);
const cleanRoom = v => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'brawl';

function netEvent(...e) {
  if (mode !== 'online') return;
  net.ev.push([++net.seq, ...e]); if (net.ev.length > 16) net.ev.shift();
  netSend(true);
}
function netSend(force) {
  if (!net.room) return;
  const t = performance.now(); if (!force && t < net.sendAt) return; net.sendAt = t + 33;
  const p = player;
  net.room.presence({ v: 1, n: p.name, c: p.color, m: net.m,
    p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], yw: r2(p.yaw), pt: r2(p.pitch), w: p.guns[p.weapon].id,
    a: state === 'playing' && p.alive ? 1 : 0, dd: p.alive ? 0 : 1, hp: Math.ceil(p.hp), k: p.kills, d: p.deaths, ev: net.ev,
    cr: r2(p.crouch), sl: r2(p.slideK),
    sk: prog.uniform, cm: prog.camo[p.guns[p.weapon].id], lv: P.level(prog), su: p.guns[p.weapon].sup ? 1 : 0,
    z: game === 'zombies' && zHost() ? zombieState() : undefined });
}
function startOnline(code) {
  net.room = joinRoom(code, net.myPeer, settings.map, game, {
    onPeer: applyRemote,
    onRoom: (map, g) => {
      net.map = map;
      const changed = GAMES[g] && g !== 'aim' && g !== game;
      if (changed) { game = g; resetZombies(); player.kills = player.deaths = 0; toast('This room plays <em></em>', GAMES[g], false); }
      if (map !== currentMap) setMap(map);
      if (changed || map !== currentMap || net.map !== settings.map) { respawn(player); refreshVM(); }
      leaderCache = null; updateScoreTop(); netSend(true);
      updateNetStatus();
    },
    onLeave: id => { for (const r of [...net.remotes.values()]) if (id === null || r.peer === id) removeRemote(r); updateNetStatus(); },
    onStatus: s => { net.status = s; updateNetStatus(); },
  });
  netSend(true);
}
function leaveRoom() {
  if (net.room) net.room.leave();
  net.room = null; net.status = ''; net.map = null;
  for (const r of [...net.remotes.values()]) removeRemote(r);
  net.lastSeq.clear(); net.ev = [];
  resetZombies();
}
function removeRemote(r) {
  scene.remove(r.mesh); net.remotes.delete(r.peer);
  const i = ents.indexOf(r); if (i >= 0) ents.splice(i, 1);
  leaderCache = null; if (state !== 'menu') updateScoreTop();
}
function applyRemote(id, s) {
  if (typeof id !== 'string' || !/^[a-z0-9]{4,16}$/.test(id) || id === net.myPeer) return;
  let r = net.remotes.get(id);
  if (s.v !== 1 || !Array.isArray(s.p)) { if (r) removeRemote(r); return; }
  if (!r) {
    const name = cleanName(s.n) || 'Player', color = /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#cccccc';
    r = newEntity(name, color, false);
    Object.assign(r, { remote: true, peer: id, target: new V3(), tyaw: 0, sk: cleanUniform(s.sk), cm: cleanCamo(s.cm), lv: cleanLevel(s.lv) });
    r.mesh = soldierMesh(name, color, true, { uniform: r.sk, camo: r.cm, lv: r.lv }); r.mesh.visible = false;
    net.remotes.set(id, r); ents.push(r);
    // don't replay events that happened before we arrived
    net.lastSeq.set(id, (Array.isArray(s.ev) ? s.ev : []).reduce((a, e) => Math.max(a, num(e && e[0])), 0));
    if ((s.m | 0) > net.m && player.kills === 0 && player.deaths === 0) net.m = s.m | 0;
    if (state === 'playing') toast(`<em></em> joined`, name, false);
    updateNetStatus();
  }
  r.target.set(clamp(num(s.p[0]), -32, 32), clamp(num(s.p[1]), 0, 10), clamp(num(s.p[2]), -32, 32));
  r.tyaw = num(s.yw); r.pitch = clamp(num(s.pt), -1.5, 1.5); r.weapon = clamp(s.w | 0, 0, WEAPONS.length - 1);
  r.hp = num(s.hp); r.kills = Math.max(0, s.k | 0); r.deaths = Math.max(0, s.d | 0); r.m = s.m | 0;
  r.dead = s.dd === 1; // a: in play right now; dd: actually down (paused players are neither)
  r.crouch = clamp(num(s.cr), 0, 1); r.slideK = clamp(num(s.sl), 0, 1); r.su = s.su === 1;
  // their look: gun camo follows the weapon in hand; the tag shows their level
  const sk = cleanUniform(s.sk), cm = cleanCamo(s.cm), lv = cleanLevel(s.lv);
  if (sk !== r.sk) { r.sk = sk; applyLook(r.mesh.userData.uniM, sk); }
  if (cm !== r.cm) { r.cm = cm; applyLook(r.mesh.userData.gunM, cm); }
  if (lv !== r.lv) { r.lv = lv; setTag(r.mesh, r.name, r.color, lv); }
  if (game === 'zombies' && s.z && r.m === net.m && hostPeer() === id) syncZombies(s.z);
  const alive = s.a === 1;
  if (alive && !r.alive) { r.alive = true; r.pos.copy(r.target); r.yaw = r.tyaw; r.mesh.visible = true; poseSoldier(r, 0); }
  else if (!alive && r.alive) { r.alive = false; r.mesh.visible = false; }
  const last = net.lastSeq.get(id) || 0; let max = last;
  for (const e of (Array.isArray(s.ev) ? s.ev : [])) {
    const sq = num(e && e[0]); if (!(sq > last)) continue;
    max = Math.max(max, sq); handleNetEvent(r, e);
  }
  net.lastSeq.set(id, max);
  leaderCache = null; if (state !== 'menu') updateScoreTop();
  checkWinOnline();
}
function handleNetEvent(r, e) {
  const type = e[1];
  if (type === 's') {
    const from = muzzleOf(r);
    for (let i = 3; i + 2 < e.length && i < 12; i += 3) tracer(from, new V3(num(e[i]), num(e[i + 1]), num(e[i + 2])), false);
    sfxShot(clamp(e[2] | 0, 0, WEAPONS.length - 1), distVol(r.pos) * (r.su ? 0.35 : 1));
  } else if (type === 'h') {
    // a hit on me, or (if I run the zombies) on one of my zombies
    const wn = wname(e[5]), amt = clamp(num(e[3]), 0, 250);
    if (e[2] === net.myPeer && state === 'playing') damage(player, amt, wn === 'Zombie' ? nearestZombie(player.pos) || r : r, wn, e[4] === 1, null);
    else if (typeof e[2] === 'string' && e[2][0] === 'z' && game === 'zombies' && zHost()) {
      const z = Z.byId.get(+e[2].slice(1)); if (z && z.alive) damage(z, amt, r, wn, e[4] === 1, null);
    }
  } else if (type === 'x') {
    const k = e[2] === net.myPeer ? player : (e[2] && net.remotes.get(e[2])) || null;
    remoteDied(r, k === r ? null : k, wname(e[3]), e[4] === 1);
  } else if (type === 'n') {
    const t = NADE_TYPES[clamp(e[8] | 0, 0, NADE_TYPES.length - 1)], v = c => clamp(num(c), -60, 60);
    const pos = new V3(clamp(num(e[2]), -40, 40), clamp(num(e[3]), -5, 40), clamp(num(e[4]), -40, 40));
    spawnNade(pos, new V3(v(e[5]), v(e[6]), v(e[7])), r, t);
    if (t === 'rocket') sfxShot(4, distVol(r.pos));
  } else if (type === 'zx') {
    // the zombie host says I got a zombie kill
    if (e[2] === net.myPeer && state === 'playing') { player.kills++; sfx.kill(); awardKill(wname(e[3]), e[4] === 1); updateScoreTop(); }
  }
}
const wname = i => WNAMES[clamp(i | 0, 0, WNAMES.length - 1)];
function remoteDied(r, k, wname, head) {
  r.alive = false; r.mesh.visible = false;
  bodyC(r, _b); burst(_b, [...BLOOD, new THREE.Color(r.color).getHex()], 14, 5, 0.1, 0.9);
  corpse(r);
  addFeed(k, r, wname, head);
  if (k === player && state === 'playing') { player.kills++; gunGameStep(player); sfx.kill(); toast(`Eliminated <em></em>`, r.name, head); awardKill(wname, head); netSend(true); }
  leaderCache = null; updateScoreTop(); checkWinOnline();
}
function updateRemotes(dt) {
  for (const r of net.remotes.values()) {
    if (!r.alive) continue;
    const px = r.pos.x, pz = r.pos.z;
    if (r.pos.distanceTo(r.target) > 6) r.pos.copy(r.target); else r.pos.lerp(r.target, 1 - Math.pow(0.0001, dt));
    r.yaw += angDiff(r.yaw, r.tyaw) * Math.min(1, dt * 16);
    r.vel.set((r.pos.x - px) / Math.max(dt, 1e-3), 0, (r.pos.z - pz) / Math.max(dt, 1e-3));
    poseSoldier(r, dt);
  }
}
function checkWinOnline() {
  if (mode !== 'online' || state !== 'playing' || !versus()) return;
  const w = [player, ...[...net.remotes.values()].filter(r => r.m === net.m)].find(e => e.kills >= scoreLimit());
  if (w) endGame(w);
}
function updateNetStatus() {
  const el = $('netStatus');
  if (mode !== 'online') { el.hidden = true; return; }
  el.hidden = false;
  const n = net.remotes.size, rm = `Room ${settings.room} · ${MAPS[net.map || currentMap]} · ${GAMES[game]} · `;
  el.textContent = net.status === 'full' ? `${rm}room is full, quit and try another code`
    : net.status !== 'ready' ? `${rm}connecting…`
    : n ? `${rm}${n + 1} players`
    : `${rm}waiting for friends (Esc → Copy invite link)`;
}
function updateModeUI() {
  const online = settings.mode === 'online';
  if (online && settings.game === 'aim') { settings.game = 'ffa'; $('gameSeg').querySelector('[data-v=ffa]').click(); }
  $('gAim').hidden = online; // aim trainer is solo
  $('botRows').hidden = online || settings.game === 'zombies' || settings.game === 'aim'; $('roomRows').hidden = !online;
  $('playBtn').textContent = online ? 'Join room' : 'Play';
  $('gameHelp').textContent = GAME_HELP[settings.game] || '';
}
const GAME_HELP = {
  ffa: 'Everyone for themselves. First to 20 eliminations wins.',
  zombies: 'Team up against waves of zombies. Downed players come back each wave. Online, everyone in the room plays together.',
  gungame: 'Every two kills hands you the next weapon: AR, SMG, Shotgun, Sniper, RPG, then the knife. One knife kill wins.',
  moon: 'Knives only, in low gravity. Jump high, stab fast. First to 20.',
  snipe: 'Snipers only, and one body shot drops anyone. First to 20.',
  aim: 'Solo. 60 seconds, as many targets as you can hit.',
};


// ---------- zombies: co-op waves ----------
// Offline, or online as the host (the lowest player id still in this match), this client runs the zombies.
// Everyone else draws them from the host's presence and sends their hits on zombies to the host.
// If the host leaves, the next lowest id picks up the zombies where they are.
const Z = { wave: 0, toSpawn: 0, nextSpawn: 0, breakUntil: 0, list: [], byId: new Map(), nextId: 1, over: false, overAt: 0, left: 0 };
const ZOMBIE_W = WNAMES.indexOf('Zombie');
const ZOMBIE_LOOKS = ['woodland', 'urban', 'desert', 'olive', 'night'];
function hostPeer() { let lo = net.myPeer; for (const r of net.remotes.values()) if (r.m === net.m && r.peer < lo) lo = r.peer; return lo; }
const zHost = () => mode !== 'online' || hostPeer() === net.myPeer;
const humans = () => [player, ...[...net.remotes.values()].filter(r => r.m === net.m)];
const zLeft = () => (zHost() ? Z.toSpawn + Z.list.length : Z.left);
function nearestZombie(pos) { let best = null, bd = Infinity; for (const z of Z.list) { const d = z.pos.distanceTo(pos); if (d < bd) { bd = d; best = z; } } return best; }
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
function resetZombies() {
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
  if (!player.alive) { respawn(player); $('death').hidden = true; refreshVM(); }
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
    wish.set(tgt.pos.x - z.pos.x, 0, tgt.pos.z - z.pos.z).normalize();
    if (now < z.sideT) wish.set(-wish.z * z.side, 0, wish.x * z.side).addScaledVector(wish, 0.3).normalize(); // detour round a wall
    if (bd < 1.6 && now >= z.atkReady && Math.abs(tgt.pos.y - z.pos.y) < 1.5) {
      z.atkReady = now + 0.9;
      const dmg = Math.min(35, 18 + Z.wave);
      if (tgt === player) damage(player, dmg, z, 'Zombie', false, null);
      else netEvent('h', tgt.peer, dmg, 0, ZOMBIE_W);
    }
  }
  const sp = z.speed * (now < z.stunUntil ? 0.4 : 1), k = Math.min(1, (z.onGround ? 8 : 2) * dt);
  z.vel.x += (wish.x * sp - z.vel.x) * k; z.vel.z += (wish.z * sp - z.vel.z) * k;
  moveEntity(z, dt);
  if (z.bumped && now >= z.sideT) { z.sideT = now + 0.9; z.side = Math.random() < 0.5 ? -1 : 1; if (z.onGround) z.vel.y = JUMP * 0.8; }
  if (wish.lengthSq() > 0) z.yaw += angDiff(z.yaw, Math.atan2(-wish.x, -wish.z)) * Math.min(1, dt * 8);
  poseSoldier(z, dt);
}
// what the host sends: wave, game over, zombies left, and each zombie [id, x, y, z, yaw, hp]
function zombieState() {
  return { w: Z.wave, o: Z.over ? 1 : 0, n: zLeft(), l: Z.list.map(z => [z.zid, r2(z.pos.x), r2(z.pos.y), r2(z.pos.z), r2(z.yaw), Math.ceil(z.hp)]) };
}
function syncZombies(zs) {
  if (!zs || typeof zs !== 'object' || !Array.isArray(zs.l)) return;
  const w = clamp(zs.w | 0, 0, 9999);
  if (w > Z.wave) { Z.wave = w; onWave(w); } else Z.wave = w;
  Z.left = clamp(zs.n | 0, 0, 9999);
  const seen = new Set();
  for (const a of zs.l.slice(0, 40)) {
    if (!Array.isArray(a)) continue;
    const id = a[0] | 0; if (id <= 0) continue;
    seen.add(id);
    const x = clamp(num(a[1]), -32, 32), y = clamp(num(a[2]), 0, 10), zz = clamp(num(a[3]), -32, 32);
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
const AIM = { list: [], end: 0, hits: 0, shots: 0 };
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
  if (s === 'menu' || s === 'over') setMusic('menu'); else if (s === 'playing') setMusic('match');
  if (s === 'menu') { $('armory').hidden = true; updateProfile(); }
  if (s !== 'playing') clearBanners();
  $('menu').hidden = s !== 'menu';
  $('pause').hidden = s !== 'paused';
  $('over').hidden = s !== 'over';
  $('hud').hidden = s === 'menu';
  if (s !== 'playing') { for (const k in keys) keys[k] = false; $('board').hidden = true; }
  if (s === 'playing' || s === 'over') { $('controls').hidden = true; rebinding = null; $('settings').hidden = true; $('armory').hidden = true; }
  if (s === 'paused') { $('pInviteBtn').hidden = mode !== 'online'; $('pInviteOut').hidden = true; }
  if (s === 'over') $('overTbl').hidden = false;
  if (s === 'paused') {
    $('pauseTitle').textContent = 'Paused'; $('resumeBtn').textContent = 'Resume';
    $('pauseMsg').textContent = plWorks === false ? 'Press Resume when you are ready.' : 'Click Resume to grab the mouse again.';
  }
  if (s === 'menu' || s === 'over') { $('death').hidden = true; if (document.pointerLockElement) document.exitPointerLock(); }
}
function setMap(name) {
  if (name === currentMap) return;
  loadMap(scene, name);
  for (const n of nades) scene.remove(n.m); nades.length = 0;
  for (const pl of piles) scene.remove(pl.g); piles.length = 0;
}
// fromLink: joined by opening an invite link. Browsers only grab the mouse after a click,
// so we join the room right away and wait on one "Play" click.
function startGame(fromLink = false) {
  settings.name = cleanName($('nameIn').value) || 'Soldier';
  settings.room = cleanRoom($('roomIn').value); $('roomIn').value = settings.room;
  saveSettings();
  leaveRoom();
  mode = settings.mode;
  game = GAMES[settings.game] ? settings.game : 'ffa';
  if (mode === 'online' && game === 'aim') game = 'ffa'; // the room's game replaces this once connected
  resetZombies(); stopAim(); flashT = 0;
  player.name = settings.name;
  player.color = mode === 'online' ? myHat : PLAYER_COLOR;
  player.corpseSrc = null; resetRun();
  net.m = 1; net.ev = [];
  for (const n of nades) scene.remove(n.m); nades.length = 0;
  for (const pl of piles) scene.remove(pl.g); piles.length = 0;
  $('feed').innerHTML = '';
  setMap(settings.map); // online, the room's map replaces this once connected
  setupBots(mode === 'online' || !versus() ? 0 : settings.bots, settings.diff);
  player.kills = player.deaths = 0; player.nadeReady = 0;
  respawn(player); dressVM(); refreshVM();
  if (game === 'aim') startAim();
  leaderCache = null; updateScoreTop();
  $('death').hidden = true; shake = 0; dmgT = 0;
  initAudio();
  if (fromLink) {
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
  net.m = hi > net.m ? hi : net.m + 1; // everyone who presses Play again lands on the same match number
  player.kills = player.deaths = 0; player.nadeReady = 0; resetRun(); resetZombies(); flashT = 0;
  respawn(player); refreshVM();
  leaderCache = null; updateScoreTop(); $('death').hidden = true;
  setState('playing'); netSend(true);
  if (plWorks !== false) requestLock();
}
function endGame(winner) {
  setState('over');
  $('overTitle').textContent = winner.isPlayer ? 'You win!' : `${winner.name} wins`;
  buildTable($('overTbl'));
  if (winner.isPlayer) sfx.kill();
  gainXP(P.XP.match + (winner.isPlayer ? P.XP.win : 0), { match: true, win: winner.isPlayer });
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
function toMenu() {
  leaveRoom(); mode = 'bots'; game = 'ffa'; stopAim(); flashT = 0; updateNetStatus();
  setState('menu');
  player.alive = false; player.respawnAt = Infinity;
  setMap(settings.map); setupBots(5, 'normal');
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
$('roomIn').value = cleanRoom(settings.room);
$('roomIn').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
segment('diffSeg', 'diff', v => v);
if (!GAMES[settings.game]) settings.game = 'ffa';
segment('gameSeg', 'game', v => v, updateModeUI);
updateModeUI();
segment('botSeg', 'bots', v => +v);
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
$('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
$('playBtn').addEventListener('click', () => startGame());
$('againBtn').addEventListener('click', playAgain);
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
  settings.room = code; $('roomIn').value = code; saveSettings();
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
$('resumeBtn').addEventListener('click', () => { if (plWorks === false) setState('playing'); else requestLock(); });
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
      if (e.reloading && now >= e.reloadEnd) { e.ammo[e.reloadWeapon] = e.guns[e.reloadWeapon].mag; e.reloading = false; }
    }
    if (mode === 'online') updateRemotes(dt);
    updateZombies(dt); updateAim();
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
  const showVM = state !== 'menu' && player.alive && !(zoomed && camera.fov < 40);
  if (showVM) {
    vm.kick = Math.max(0, vm.kick - dt * 7); vm.switchT = Math.max(0, vm.switchT - dt);
    vm.swayX *= Math.pow(0.002, dt); vm.swayY *= Math.pow(0.002, dt);
    const sp = Math.hypot(player.vel.x, player.vel.z) / 7.4;
    vm.ads += ((zoomed ? 1 : 0) - vm.ads) * Math.min(1, dt * 14);
    vm.spr += ((player.sprint ? 1 : 0) - vm.spr) * Math.min(1, dt * 10);
    VM_ADS.y = -curVM().userData.sightY * 0.72; // puts the sight on the screen center
    const swing = curW().kind === 'melee' ? vm.kick : 0; // knife slash
    const hip = 1 - vm.ads, base = _f.copy(VM_BASE).lerp(VM_ADS, vm.ads);
    vm.root.position.set(base.x + (vm.swayX + Math.sin(vm.bob) * 0.012 * sp) * hip - vm.spr * 0.06,
      base.y + (vm.swayY - Math.abs(Math.cos(vm.bob)) * 0.012 * sp) * hip - vm.switchT * 0.8 - vm.spr * 0.05,
      base.z + vm.kick * 0.07 * (1 - 0.6 * vm.ads) - swing * 0.25);
    vm.root.rotation.set(vm.kick * 0.18 * (1 - 0.6 * vm.ads) - vm.spr * 0.2 - swing * 1.1, vm.spr * 0.75 + swing * 0.7, vm.spr * 0.3);
    flashMesh.visible = now < vm.flashUntil;
    if (flashMesh.visible) { flashMesh.position.copy(curVM().userData.muzzle); flashMesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); flashMesh.scale.setScalar(curW().id === 0 || curW().id === 3 ? 1 : 1.8); }
  }
  if (state !== 'menu') updateHUD(dt);
  if (mode === 'online') netSend(false);

  renderer.clear();
  renderer.render(scene, camera);
  if (showVM) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}

if (location.hostname === 'localhost') window.__spud = { player, net, ents, prog, Z, AIM, get game() { return game; }, get state() { return state; }, get now() { return now; } };
resize();
dressVM(); updateProfile();
setMap(settings.map);
setupBots(5, 'normal');
setState('menu');
applyInvite();
// accounts are off unless the server is configured; then the menu grows a sign-in panel
initAccount(prog, { onProgress: loadoutChanged, name: () => cleanName($('nameIn').value) || settings.name });
requestAnimationFrame(frame);
