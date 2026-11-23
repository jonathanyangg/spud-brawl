// The player: input (mouse, keys, pointer lock, the one-shot actions) and each frame's movement and camera.
// Shooting itself, damage and kills are shared with bots and other players, so they're in game.js.
import { initAudio, sfx, toggleMute } from './audio.js';
import { EYE, JUMP, KNOCK, MOVE } from './config.js';
import { buildTable, MM, toast, toggleBigMap } from './hud.js';
import { outOfMatch, rebinding, toggleReadyOut } from './menu.js';
import { brAlive, dropPress, updateDrop } from './modes/br.js';
import { moveMapCursor, pingAim, pingMap } from './ping.js';
import { $, clamp, rand, V3 } from './util.js';
import { driveVehicle } from './vehicles.js';
import {
  _o, actionFor, binds, bound, camera, canStand, canvas, closeInv, deathPos, dropCamera, dropGun, endSlide, game, grip, hideSelf, invOpen,
  killer, mode, moveEntity, moveSlot, nextSpec, now, oneLife, openInv, playAgain, player, poseK, reduceMotion, refreshVM, respawn, setState,
  settings, shake, slotIdx, slotOrder, spec, spectate, startHeal, startReload, state, switchWeapon, throwNade, tryFire, useKey, vm
} from './game.js';

// ---------- input ----------
export const keys = {};
export let locked = false, plWorks = null, fireLatch = false, triggerUsed = false, zoomed = false, crouchTap = false;
// out of the scope (and, trigger: let go of the trigger too), from outside this file
export function releaseAim(trigger) { zoomed = false; if (trigger) fireLatch = false; }
export function requestLock() {
  // some views neither grant nor refuse the lock; fall back to drag-to-aim if nothing happens
  setTimeout(() => { if (!locked && plWorks === null) plWorks = false; }, 1200);
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { if (plWorks !== true) plWorks = false; else $('pauseMsg').textContent = 'Click Resume again to grab the mouse.'; });
  } catch (e) { plWorks = false; }
}
// back from the dead in a bot game: take the mouse again (or ask for a click if the browser says no)
export function relockAfterDeath() {
  if (locked || plWorks === false || state !== 'playing') return;
  requestLock();
  setTimeout(() => { if (!locked && state === 'playing' && player.alive) toast('Click to keep playing'); }, 400);
}
// a pressed control: movement is read from `keys` each frame; one-shot actions fire here
function pressCode(code) {
  keys[code] = true;
  const a = actionFor(code);
  if (a === 'shoot') { fireLatch = true; triggerUsed = false; }
  if (a === 'scores') { buildTable($('boardTbl')); $('board').hidden = false; }
  if (a === 'map') { toggleBigMap(); return; } // these two work dead too, while you spectate
  if (a === 'ping') { if (MM.big) pingMap(); else pingAim(); return; }
  if (!player.alive || !a) return;
  if (player.drop) { if (a === 'jump') dropPress(player); return; }
  if (player.knock) return; // down: crawling is all you can do
  if (a === 'w1') switchWeapon(player, slotIdx(player, 0));
  else if (a === 'w2') switchWeapon(player, slotIdx(player, 1));
  else if (a === 'w3') switchWeapon(player, slotIdx(player, 2));
  else if (a === 'w4') switchWeapon(player, slotIdx(player, 3));
  else if (a === 'use') useKey(player);
  else if (a === 'dropGun') dropGun(player, player.weapon);
  else if (a === 'bandage' || a === 'medkit') startHeal(player, a);
  else if (a === 'inv') openInv();
  else if (a === 'swap') switchWeapon(player, player.prevWeapon);
  else if (a === 'slotL') moveSlot(player, -1);
  else if (a === 'slotR') moveSlot(player, 1);
  else if (a === 'reload') startReload(player);
  else if (a === 'nade') throwNade(player);
  else if (a === 'crouch') crouchTap = true;
}

// ---------- player update ----------
let stepD = 0, airT = 0, wasGround = true; // footsteps
export function updatePlayer(dt) {
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
  if (p.vehicle) { // at the wheel: drive, look round, nothing else
    zoomed = false; fireLatch = false; crouchTap = false;
    driveVehicle(p, dt, f, s);
    camera.position.set(p.pos.x, p.pos.y + EYE * poseK(p), p.pos.z);
    camera.rotation.set(p.pitch, p.yaw, 0);
    if (shake > 0 && !reduceMotion) camera.position.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.3));
    return;
  }
  if (p.knock) return crawl(p, dt, wish);
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

// knocked down: crawl, look round, nothing else
function crawl(p, dt, wish) {
  zoomed = false; fireLatch = false; crouchTap = false; p.sprint = false; p.slide = 0; p.slideK = 0; p.crouch = 1;
  const k = Math.min(1, (p.onGround ? 10 : 3) * dt);
  p.vel.x += (wish.x * KNOCK.speed - p.vel.x) * k; p.vel.z += (wish.z * KNOCK.speed - p.vel.z) * k;
  moveEntity(p, dt);
  camera.position.set(p.pos.x, p.pos.y + EYE * poseK(p), p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, reduceMotion ? 0 : 0.1);
  if (shake > 0 && !reduceMotion) camera.position.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.3));
}

// the input listeners: game.js calls this once its own state is set up
export function initInput() {
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (locked) { plWorks = true; if (state === 'paused') setState('playing'); }
    else if (state === 'playing' && !invOpen && player.alive) { setState('paused'); } // dead: the mouse is free for the death screen buttons
  });
  document.addEventListener('pointerlockerror', () => { if (plWorks !== true) plWorks = false; });
  document.addEventListener('mousemove', e => {
    if (state === 'playing' && MM.big && locked) { moveMapCursor(e.movementX, e.movementY); return; } // the full map's cursor, not the view
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
    if (MM.big && locked && e.button === 0) { pingMap(); return; } // a click on the full map pings there
    if (!player.alive && mode !== 'online') return;
    if (!locked && plWorks !== false) { requestLock(); return; }
    pressCode('Mouse' + e.button);
  });
  canvas.addEventListener('auxclick', e => e.preventDefault());
  document.addEventListener('mouseup', e => { keys['Mouse' + e.button] = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('wheel', e => { // next or previous gun, in slot order
    if (state !== 'playing' || !player.alive || player.drop || player.knock || invOpen) return;
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
    if (e.code === 'Enter' && !e.repeat && outOfMatch() && state !== 'over') { e.preventDefault(); toggleReadyOut(); return; }
    if (e.code === binds.jump && !e.repeat && !player.alive && spec.who && state === 'playing') { e.preventDefault(); nextSpec(); return; }
    if (e.repeat) return;
    pressCode(e.code);
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === binds.scores) $('board').hidden = true; });
}
