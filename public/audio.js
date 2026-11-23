// Procedural sound effects (Web Audio, no files).
// ---------- audio ----------
let ac = null, master = null, noiseBuf = null, muted = false, vol = 1;
// muting silences the master bus, so it covers the music too
const gainNow = () => (muted ? 0 : 0.45 * vol);
export const toggleMute = () => { muted = !muted; if (master) master.gain.value = gainNow(); return muted; };
export const setVolume = v => { vol = v; if (master) master.gain.value = gainNow(); };
export const audioOut = () => ac && { ac, master, noiseBuf };
export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = gainNow(); master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ac = null; }
}
function noise(dur, freq, vol, type = 'lowpass', q = 1, at = 0) {
  if (!ac || muted || vol <= 0.005) return null;
  const t = ac.currentTime + at, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  return s;
}
function tone(freq, dur, vol, type = 'square', to, at = 0) {
  if (!ac || muted || vol <= 0.005) return null;
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  return o;
}
export function sfxShot(wi, v) {
  if (wi === 0) { noise(0.08, 2400, 0.32 * v, 'bandpass', 0.7); tone(200, 0.05, 0.12 * v, 'square', 90); }
  else if (wi === 1) { noise(0.35, 900, 0.65 * v); tone(120, 0.2, 0.3 * v, 'sine', 40); }
  else if (wi === 2) { noise(0.5, 1700, 0.5 * v); tone(320, 0.28, 0.22 * v, 'sawtooth', 55); }
  else if (wi === 3) { noise(0.1, 1600, 0.4 * v, 'bandpass', 0.8); tone(150, 0.07, 0.16 * v, 'square', 70); }
  else if (wi === 4) { noise(0.7, 500, 0.6 * v); tone(90, 0.5, 0.3 * v, 'sawtooth', 40); }
  else noise(0.12, 3200, 0.22 * v, 'highpass', 0.8); // knife swish
}
// ---------- reloads ----------
// Each gun's reload is a few mechanical sounds spread over its reload time: the mag out, the new one seated, the
// charging handle; shells and a pump for the shotgun, the bolt for the sniper, a rocket slid into the RPG.
const RL = {
  magOut: (a, v) => [noise(0.09, 1300, 0.28 * v, 'bandpass', 1.6, a), tone(320, 0.05, 0.08 * v, 'triangle', 210, a)],
  magIn: (a, v) => [noise(0.05, 2600, 0.34 * v, 'bandpass', 2, a), tone(150, 0.07, 0.2 * v, 'sine', 90, a), noise(0.03, 4200, 0.18 * v, 'highpass', 1, a + 0.05)],
  rack: (a, v) => [noise(0.05, 3000, 0.3 * v, 'bandpass', 2.5, a), noise(0.06, 2200, 0.34 * v, 'bandpass', 2, a + 0.09), tone(900, 0.03, 0.08 * v, 'square', 600, a + 0.09)],
  shell: (a, v) => [noise(0.05, 1700, 0.24 * v, 'bandpass', 2, a), tone(420, 0.04, 0.09 * v, 'triangle', 300, a + 0.02)],
  pump: (a, v) => [noise(0.1, 900, 0.36 * v, 'bandpass', 1.4, a), noise(0.09, 1300, 0.4 * v, 'bandpass', 1.6, a + 0.16), tone(200, 0.06, 0.12 * v, 'sine', 120, a + 0.16)],
  boltUp: (a, v) => [noise(0.07, 2400, 0.28 * v, 'bandpass', 2, a), noise(0.09, 1600, 0.26 * v, 'bandpass', 1.5, a + 0.08)],
  boltDown: (a, v) => [noise(0.09, 1600, 0.26 * v, 'bandpass', 1.5, a), noise(0.05, 3200, 0.32 * v, 'bandpass', 2.5, a + 0.1), tone(700, 0.03, 0.08 * v, 'square', 500, a + 0.1)],
  tube: (a, v) => [noise(0.32, 650, 0.3 * v, 'bandpass', 0.9, a), tone(110, 0.1, 0.2 * v, 'sine', 70, a + 0.3)],
  latch: (a, v) => [noise(0.04, 3600, 0.3 * v, 'bandpass', 2.5, a), tone(500, 0.04, 0.1 * v, 'square', 380, a)],
};
// the reload clicks are short and narrow-band, so they get lost next to gunfire at the same level: all of them get this boost
const RL_GAIN = 2.5;
// [sound, when as a share of the reload time] for each weapon; the shotgun's shells are spread by its mag size
const RELOADS = [
  [['magOut', 0.1], ['magIn', 0.55], ['rack', 0.8]],                       // SMG
  null,                                                                   // shotgun: see below
  [['boltUp', 0.06], ['magOut', 0.24], ['magIn', 0.58], ['boltDown', 0.84]], // sniper
  [['magOut', 0.12], ['magIn', 0.58], ['rack', 0.84]],                     // AR
  [['tube', 0.2], ['latch', 0.78]],                                        // RPG
];
// wi: weapon index; dur: reload seconds; v: loudness; shells: how many go in (shotgun). Returns stop(), for when the
// reload is cut short (a weapon switch, a heal)
export function sfxReload(wi, dur, v = 1, shells = 4) {
  if (!ac || muted || v <= 0.02) return () => {};
  const steps = wi === 1 ? [...Array(Math.max(1, Math.min(8, shells))).keys()].map(i => ['shell', 0.08 + 0.62 * i / Math.max(1, shells)]).concat([['pump', 0.8]]) : RELOADS[wi];
  if (!steps) return () => {};
  const srcs = steps.flatMap(([k, at]) => RL[k](at * dur, v * RL_GAIN)).filter(Boolean);
  return () => { for (const s of srcs) try { s.stop(); } catch (e) {} };
}
export const sfx = {
  hit: () => tone(1250, 0.05, 0.16, 'square', 900),
  ping: () => { tone(1320, 0.07, 0.12, 'sine', 1560); setTimeout(() => tone(1760, 0.1, 0.1, 'sine'), 70); },
  pingEnemy: () => { tone(980, 0.06, 0.14, 'square', 1200); setTimeout(() => tone(980, 0.06, 0.14, 'square', 1200), 110); },
  head: () => { tone(1700, 0.06, 0.18, 'square', 1300); },
  kill: () => { tone(660, 0.09, 0.2, 'triangle'); setTimeout(() => tone(990, 0.16, 0.2, 'triangle'), 80); },
  hurt: () => tone(160, 0.12, 0.25, 'sawtooth', 80),
  boom: v => { noise(0.9, 380, 0.9 * v); tone(80, 0.6, 0.5 * v, 'sine', 30); },
  chest: (v = 1) => { tone(420, 0.12, 0.15 * v, 'triangle', 620); setTimeout(() => tone(880, 0.22, 0.14 * v, 'triangle'), 110); noise(0.25, 1400, 0.08 * v, 'bandpass', 2); },
  pick: () => tone(900, 0.05, 0.1, 'triangle', 1300),
  // a footstep: a soft scuff and a low thud (v: loudness, from distance and how fast they move)
  step: (v = 1) => { noise(0.06, 700 + Math.random() * 400, 0.16 * v, 'bandpass', 1.4); tone(85 + Math.random() * 20, 0.05, 0.07 * v, 'sine', 55); },
  land: (v = 1) => { noise(0.12, 500, 0.25 * v, 'bandpass', 1); tone(70, 0.09, 0.12 * v, 'sine', 45); },
  heal: () => { tone(520, 0.12, 0.12, 'sine', 780); setTimeout(() => tone(780, 0.2, 0.12, 'sine'), 120); },
  glider: () => noise(0.5, 500, 0.2, 'bandpass', 0.8),
  pad: () => { tone(260, 0.3, 0.16, 'sine', 900); noise(0.25, 900, 0.1, 'bandpass', 1.5); },
  toss: () => noise(0.15, 600, 0.15, 'bandpass', 2),
  slide: () => noise(0.45, 700, 0.22, 'bandpass', 0.6),
  stun: v => { noise(0.5, 1200, 0.5 * v, 'bandpass', 3); tone(220, 0.5, 0.25 * v, 'sine', 110); },
  flash: v => { noise(0.3, 5000, 0.6 * v, 'highpass'); tone(3200, 1.2, 0.12 * v, 'sine', 3000); },
};
