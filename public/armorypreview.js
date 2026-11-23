// The Armory's preview shows only what the open tab changes: the soldier alone on the Soldier tab, the gun alone on a
// weapon tab, and on the Loadout tab the soldier holding your first weapon, so you see each change as you make it.
// The gun is the first-person model itself, borrowed from the view model while the Armory is open (hands hidden),
// so it always matches what you'll hold. It has its own small renderer; it turns slowly, and you can drag it round.
import { LOOKS } from './progress.js';
import { applyLook } from './skins.js';
import { WEAPONS } from './config.js';
import { player, prog, refreshVM, soldierMesh, vmGun } from './game.js';

const GLOVE = 0x2f2b25;
// what each mode frames: the width and height to fit, and the height to look at
const VIEW = {
  soldier: { w: 1.1, h: 2.2, y: 0.95 },
  loadout: { w: 1.7, h: 2.1, y: 0.95 },
  gun: { w: 1.4, h: 1.1, y: 1 },
};
const HALF = Math.tan((32 / 2) * Math.PI / 180); // the camera's fov is 32 degrees
let P = null, raf = 0; // the preview's renderer, scene and models, made on first use
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function box(parent, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m;
}

function init(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0x4a3c2a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(2, 4, 3); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; scene.add(floor); // a shadow to stand on
  const soldier = soldierMesh('', player.color, false, {}); scene.add(soldier);
  const u = soldier.userData;
  // the soldier's own stand-in gun, and the arms posed to hold it
  const ownGun = [], aimArms = [];
  for (const m of u.aim.children) if (m.isMesh) (m.material === u.gunM ? ownGun : aimArms).push(m);
  // arms at the sides, for when there's no gun to hold
  const glove = aimArms.find(m => m.material.color?.getHex() === GLOVE)?.material;
  const restArms = [-1, 1].flatMap(s => [box(u.upper, u.uniM, 0.11, 0.48, 0.13, s * 0.275, 0.36, 0), box(u.upper, glove, 0.1, 0.1, 0.11, s * 0.275, 0.08, 0)]);
  const stand = new THREE.Group(); stand.position.set(0, VIEW.gun.y, 0); scene.add(stand); // the lone gun turns on this
  P = { renderer, scene, cam, floor, soldier, ownGun, aimArms, restArms, stand, mode: '', gun: null, wi: -1, home: null, hidden: [], t: 0, yaw: 0, drag: null };
  canvas.addEventListener('pointerdown', e => { P.drag = { x: e.clientX, yaw: P.yaw }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (P.drag) P.yaw = P.drag.yaw + (e.clientX - P.drag.x) * 0.012; });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { P.drag = null; });
}

// the view model's gun for weapon wi, with its hands and the laser's beam hidden
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
  P.gun = g; P.wi = wi;
}
// put the gun on parent, its longest side `size` long, centred on `at`. Only the parts that show count (not the
// hidden hands, the beam, or attachments that are off), so it's measured again after each change
function place(parent, size, at) {
  const g = P.gun;
  g.parent?.remove(g); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.setScalar(1); g.updateMatrixWorld(true);
  const b = new THREE.Box3(), shows = m => { for (let o = m; o && o !== g; o = o.parent) if (!o.visible) return false; return true; };
  g.traverse(m => { if (m.isMesh && shows(m)) b.expandByObject(m); });
  parent.add(g);
  if (b.isEmpty()) return;
  const dims = b.getSize(new THREE.Vector3()), k = size / Math.max(dims.x, dims.y, dims.z, 0.2);
  g.scale.setScalar(k); g.position.copy(b.getCenter(new THREE.Vector3()).multiplyScalar(-k).add(at));
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
  // back the camera off until what this tab shows fits both ways, with a little room
  const v = VIEW[P.mode], aspect = w / h, d = 1.12 * Math.max(v.h / 2 / HALF, v.w / 2 / (HALF * aspect));
  P.cam.aspect = aspect; P.cam.updateProjectionMatrix();
  P.cam.position.set(0, v.y + 0.1, d); P.cam.lookAt(0, v.y, 0);
  if (!P.drag && !still()) P.t += 0.006;
  // the soldier faces you, turning a little either way; holding a gun, they stand side-on so it shows
  P.soldier.rotation.y = Math.PI + (P.mode === 'loadout' ? 0.75 : 0) + Math.sin(P.t * 0.7) * 0.5 + P.yaw;
  P.stand.rotation.set(0.12, P.t + P.yaw, 0);
  if (P.gun) P.gun.visible = true; // the game's refreshVM may have hidden it meanwhile
  P.renderer.render(P.scene, P.cam);
}

// mode is 'soldier', 'gun' or 'loadout'; show it dressed as it is now, with weapon wi. Call again after every change
export function showPreview(canvas, mode, wi) {
  if (!P) init(canvas);
  const u = P.soldier.userData, man = mode !== 'gun', holds = mode === 'loadout';
  P.mode = mode;
  applyLook(u.uniM, prog.uniform);
  P.soldier.visible = P.floor.visible = man;
  for (const m of P.ownGun) m.visible = false; // the real gun goes in their hands instead
  for (const m of P.aimArms) m.visible = holds;
  for (const m of P.restArms) m.visible = !holds;
  if (mode === 'soldier') { if (P.gun) giveBack(); }
  else {
    if (wi !== P.wi) borrow(wi);
    if (P.gun) holds ? place(u.aim, 0.8, new THREE.Vector3(0.1, -0.06, -0.42)) : place(P.stand, 1.3, new THREE.Vector3());
  }
  if (!raf) frame();
  const look = `${LOOKS[prog.uniform]?.name || 'Olive'} uniform`, camo = prog.camo[wi];
  const gun = `${WEAPONS[wi]?.name}${camo && camo !== 'factory' ? ` in ${LOOKS[camo].name}` : ''}`;
  return mode === 'soldier' ? look : mode === 'gun' ? gun : `${look} · ${gun}`;
}
// the Armory closed: stop drawing and hand the gun back to the view model
export function hidePreview() {
  cancelAnimationFrame(raf); raf = 0;
  if (P) giveBack();
}
