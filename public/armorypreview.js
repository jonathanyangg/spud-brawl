// The Armory's preview: your soldier in their uniform, and the gun the open tab is about (your first weapon on the
// Loadout and Soldier tabs), in its camo with its attachments, so you see each change as you make it.
// The gun is the first-person model itself, borrowed from the view model while the Armory is open (hands hidden),
// so it always matches what you'll hold. It has its own small renderer; it turns slowly, and you can drag it round.
import { LOOKS } from './progress.js';
import { applyLook } from './skins.js';
import { WEAPONS } from './config.js';
import { player, prog, refreshVM, soldierMesh, vmGun } from './game.js';

const GLOVE = 0x2f2b25;
let P = null, raf = 0; // the preview's renderer, scene and models, made on first use
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function init(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0x4a3c2a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(2, 4, 3); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(-0.55, 0.002, 0); scene.add(floor); // a shadow to stand on
  const soldier = soldierMesh('', player.color, false, {}); soldier.position.x = -0.55; scene.add(soldier);
  const stand = new THREE.Group(); stand.position.set(0.62, 1.15, 0); scene.add(stand); // the gun turns on this
  P = { renderer, scene, cam, soldier, stand, gun: null, wi: -1, home: null, hidden: [], turn: 0.5, drag: null };
  canvas.addEventListener('pointerdown', e => { P.drag = { x: e.clientX, t: P.turn }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (P.drag) P.turn = P.drag.t + (e.clientX - P.drag.x) * 0.012; });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { P.drag = null; });
}

// the view model's gun for weapon wi, on the preview's stand: hands and the laser's beam hidden, sized and centred
function borrow(wi) {
  giveBack();
  const g = vmGun(wi); if (!g) return;
  P.home = { parent: g.parent, pos: g.position.clone(), rot: g.rotation.clone(), scale: g.scale.clone(), visible: g.visible };
  g.traverse(m => {
    if (!m.isMesh || !m.visible) return;
    const hand = g.userData.sleeves.includes(m.material) || m.material.color.getHex() === GLOVE;
    const beam = m.material.transparent && m.scale.z > 1; // the laser's beam: 3 m long
    if (hand || beam) { m.visible = false; P.hidden.push(m); }
  });
  g.rotation.set(0, 0, 0);
  P.stand.add(g); P.gun = g; P.wi = wi;
}
// centre the gun on the stand and size it so every gun fills about the same space: only the parts that show count
// (not the hidden hands, the beam, or attachments that are off), so it's measured again after each change
function fit() {
  const g = P.gun, st = P.stand, keep = [st.position.clone(), st.rotation.clone()];
  st.position.set(0, 0, 0); st.rotation.set(0, 0, 0); g.position.set(0, 0, 0); g.scale.setScalar(1); st.updateMatrixWorld(true);
  const box = new THREE.Box3(), shows = m => { for (let o = m; o && o !== g; o = o.parent) if (!o.visible) return false; return true; };
  g.traverse(m => { if (m.isMesh && shows(m)) box.expandByObject(m); });
  st.position.copy(keep[0]); st.rotation.copy(keep[1]);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3()), k = 0.95 / Math.max(size.x, size.y, size.z, 0.2);
  g.scale.setScalar(k); g.position.copy(mid).multiplyScalar(-k);
}
function giveBack() {
  const g = P?.gun; if (!g) return;
  for (const m of P.hidden) m.visible = true;
  P.hidden.length = 0;
  P.home.parent.add(g); g.position.copy(P.home.pos); g.rotation.copy(P.home.rot); g.scale.copy(P.home.scale); g.visible = P.home.visible;
  P.gun = null; P.wi = -1; refreshVM();
}

function frame() {
  raf = requestAnimationFrame(frame);
  const cv = P.renderer.domElement, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * P.renderer.getPixelRatio()) || cv.height !== Math.round(h * P.renderer.getPixelRatio())) P.renderer.setSize(w, h, false);
  // narrow and tall, or wide: frame the pair so both fit
  P.cam.aspect = w / h; P.cam.fov = w / h < 1.2 ? 32 * Math.min(1.9, 1.2 / (w / h)) : 32; P.cam.updateProjectionMatrix();
  P.cam.position.set(0, 1.15, 4.3); P.cam.lookAt(0, 0.98, 0);
  if (!P.drag && !still()) P.turn += 0.006;
  P.soldier.rotation.y = Math.PI + Math.sin(P.turn * 0.7) * 0.6; // faces you, turning a little either way
  P.stand.rotation.set(0.12, P.turn, 0);
  if (P.gun) P.gun.visible = true; // the game's refreshVM may have hidden it meanwhile
  P.renderer.render(P.scene, P.cam);
}

// show the soldier and weapon wi as they are dressed now; call again after every change
export function showPreview(canvas, wi) {
  if (!P) init(canvas);
  const u = P.soldier.userData;
  applyLook(u.uniM, prog.uniform); applyLook(u.gunM, prog.camo[wi]);
  if (wi !== P.wi) borrow(wi);
  if (P.gun) fit();
  if (!raf) frame();
  return `${LOOKS[prog.uniform]?.name || 'Olive'} uniform · ${WEAPONS[wi].name}${prog.camo[wi] && prog.camo[wi] !== 'factory' ? ` in ${LOOKS[prog.camo[wi]].name}` : ''}`;
}
// the Armory closed: stop drawing and hand the gun back to the view model
export function hidePreview() {
  cancelAnimationFrame(raf); raf = 0;
  if (P) giveBack();
}
