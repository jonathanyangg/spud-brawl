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
function noise(dur, freq, vol, type = 'lowpass', q = 1) {
  if (!ac || muted || vol <= 0.005) return;
  const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function tone(freq, dur, vol, type = 'square', to) {
  if (!ac || muted || vol <= 0.005) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
export function sfxShot(wi, v) {
  if (wi === 0) { noise(0.08, 2400, 0.32 * v, 'bandpass', 0.7); tone(200, 0.05, 0.12 * v, 'square', 90); }
  else if (wi === 1) { noise(0.35, 900, 0.65 * v); tone(120, 0.2, 0.3 * v, 'sine', 40); }
  else if (wi === 2) { noise(0.5, 1700, 0.5 * v); tone(320, 0.28, 0.22 * v, 'sawtooth', 55); }
  else if (wi === 3) { noise(0.1, 1600, 0.4 * v, 'bandpass', 0.8); tone(150, 0.07, 0.16 * v, 'square', 70); }
  else if (wi === 4) { noise(0.7, 500, 0.6 * v); tone(90, 0.5, 0.3 * v, 'sawtooth', 40); }
  else noise(0.12, 3200, 0.22 * v, 'highpass', 0.8); // knife swish
}
export const sfx = {
  hit: () => tone(1250, 0.05, 0.16, 'square', 900),
  ping: () => { tone(1320, 0.07, 0.12, 'sine', 1560); setTimeout(() => tone(1760, 0.1, 0.1, 'sine'), 70); },
  pingEnemy: () => { tone(980, 0.06, 0.14, 'square', 1200); setTimeout(() => tone(980, 0.06, 0.14, 'square', 1200), 110); },
  head: () => { tone(1700, 0.06, 0.18, 'square', 1300); },
  kill: () => { tone(660, 0.09, 0.2, 'triangle'); setTimeout(() => tone(990, 0.16, 0.2, 'triangle'), 80); },
  hurt: () => tone(160, 0.12, 0.25, 'sawtooth', 80),
  boom: v => { noise(0.9, 380, 0.9 * v); tone(80, 0.6, 0.5 * v, 'sine', 30); },
  reload: () => { tone(500, 0.04, 0.08, 'square'); setTimeout(() => tone(700, 0.04, 0.08, 'square'), 120); },
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
