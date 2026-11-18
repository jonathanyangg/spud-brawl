// Procedural sound effects (Web Audio, no files).
// ---------- audio ----------
let ac = null, master = null, noiseBuf = null, muted = false;
// muting silences the master bus, so it covers the music too
export const toggleMute = () => { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.45; return muted; };
export const audioOut = () => ac && { ac, master, noiseBuf };
export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.45; master.connect(ac.destination);
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
  else { noise(0.5, 1700, 0.5 * v); tone(320, 0.28, 0.22 * v, 'sawtooth', 55); }
}
export const sfx = {
  hit: () => tone(1250, 0.05, 0.16, 'square', 900),
  head: () => { tone(1700, 0.06, 0.18, 'square', 1300); },
  kill: () => { tone(660, 0.09, 0.2, 'triangle'); setTimeout(() => tone(990, 0.16, 0.2, 'triangle'), 80); },
  hurt: () => tone(160, 0.12, 0.25, 'sawtooth', 80),
  boom: v => { noise(0.9, 380, 0.9 * v); tone(80, 0.6, 0.5 * v, 'sine', 30); },
  reload: () => { tone(500, 0.04, 0.08, 'square'); setTimeout(() => tone(700, 0.04, 0.08, 'square'), 120); },
  toss: () => noise(0.15, 600, 0.15, 'bandpass', 2),
  slide: () => noise(0.45, 700, 0.22, 'bandpass', 0.6),
};
