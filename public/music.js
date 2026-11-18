// Procedural soundtrack (Web Audio, no files): a calm menu theme and a driving match theme,
// both in D minor over Dm - Bb - F - C. A small step sequencer schedules notes a moment ahead.
import { audioOut } from './audio.js';

const VOL = 0.55;
const midi = n => 440 * 2 ** ((n - 69) / 12);
const PROG = [[62, 65, 69], [58, 62, 65], [65, 69, 72], [60, 64, 67]]; // one chord per bar
// the match theme's lead hook: eight 8th notes per chord, 0 = rest
const HOOK = [[69, 0, 74, 0, 72, 69, 0, 65], [65, 0, 70, 0, 69, 65, 0, 62], [72, 0, 69, 0, 65, 69, 72, 0], [67, 0, 64, 0, 67, 72, 0, 71]];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2], OST = [0, 1, 2, 1, 0, 2, 1, 2];

let ac = null, bus = null, nb = null, mood = null, on = true, step = 0, nextT = 0;

export function setMusic(m) { if (m !== mood) { mood = m; step = 0; nextT = 0; } }
export function setMusicOn(v) { on = v; if (bus) bus.gain.setTargetAtTime(v ? VOL : 0, ac.currentTime, 0.2); }

// ---------- instruments ----------
function osc(type, f, t, dur, vol, { to, cut, q = 1, att = 0.005, detune = 0 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  let node = o;
  if (cut) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; fl.Q.value = q; o.connect(fl); node = fl; }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  node.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
function hiss(t, dur, vol, type, f, q = 1) {
  const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = nb; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function pad(t, notes, dur, vol) {
  for (const n of notes) for (const detune of [-9, 9]) {
    const o = ac.createOscillator(), fl = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = detune;
    fl.type = 'lowpass'; fl.frequency.value = 900;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.6, dur / 3));
    g.gain.setValueAtTime(vol, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(fl); fl.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
}
const kick = (t, v) => osc('sine', 140, t, 0.32, v, { to: 42, att: 0.002 });
const snare = (t, v) => { hiss(t, 0.16, v, 'bandpass', 1900, 0.8); osc('triangle', 200, t, 0.08, v * 0.5, { to: 150 }); };
const hat = (t, v, len = 0.035) => hiss(t, len, v, 'highpass', 7500);
const crash = (t, v) => hiss(t, 1.6, v, 'highpass', 4500);

// ---------- tracks: (time, bar, 16th within the bar, chord, 16th length) ----------
function menuStep(t, bar, i, ch, len) {
  if (i === 0) pad(t, [ch[0] - 12, ...ch], len * 16, 0.045);
  if (bar >= 4) {
    if (i % 2 === 0) osc('triangle', midi(ch[ARP[i / 2]] + 12), t, len * 3, 0.07, { cut: 2400 });
    if (i === 0 || i === 8) osc('sawtooth', midi(ch[0] - 24), t, len * 7, 0.08, { cut: 380, q: 3 });
  }
  if (bar >= 8) {
    if (i === 0 || i === 10) kick(t, 0.24);
    if (i === 8) snare(t, 0.05);
    if (i % 4 === 2) hat(t, 0.025);
    if (bar % 4 === 3 && i >= 12) snare(t, 0.02 + (i - 12) * 0.012); // little march roll into the next phrase
  }
}
function matchStep(t, bar, i, ch, len) {
  const sec = bar < 8 ? 'A' : bar < 24 ? 'B' : bar < 28 ? 'C' : 'D';
  if ((bar === 8 || bar === 28) && i === 0) crash(t, 0.07);
  if (sec !== 'C') {
    if (i % 4 === 0) kick(t, 0.32);
    if (sec === 'B' && i === 14) kick(t, 0.18);
    if (i % 2 === 1) hat(t, 0.035);
    if (sec === 'B' && i % 4 === 2) hat(t, 0.025, 0.1);
    if (i % 2 === 0) osc('sawtooth', midi(ch[0] - 24 + (i % 8 === 6 ? 12 : 0)), t, len * 1.6, 0.11, { cut: 520, q: 4 });
  } else if (i === 0) osc('sawtooth', midi(ch[0] - 24), t, len * 15, 0.09, { cut: 300, q: 2, att: 0.05 });
  if (sec === 'B' || sec === 'D') {
    if (i === 4 || i === 12) snare(t, 0.15);
    if (sec === 'D' && bar === 31 && i >= 8) snare(t, 0.05 + (i - 8) * 0.015); // fill back to the top
  }
  if (sec !== 'A') osc('sawtooth', midi(ch[OST[i % 8] % 3] + (i % 8 >= 4 ? 12 : 0)), t, len * 0.9, 0.028, { cut: 1500 });
  if ((sec === 'B' || sec === 'C') && i === 0) pad(t, [ch[0] - 12, ...ch], len * 16, 0.03);
  if (bar >= 16 && bar < 24 && i % 2 === 0) { const n = HOOK[bar % 4][i / 2]; if (n) osc('square', midi(n), t, len * 1.8, 0.045, { cut: 2600 }); }
}
const TRACKS = { menu: { bpm: 92, bars: 16, play: menuStep }, match: { bpm: 132, bars: 32, play: matchStep } };

// ---------- scheduler ----------
setInterval(() => {
  const out = audioOut(); if (!out || !mood || !on) return;
  if (!bus) { ({ ac, noiseBuf: nb } = out); bus = ac.createGain(); bus.gain.value = VOL; bus.connect(out.master); }
  if (ac.state !== 'running') return;
  const tr = TRACKS[mood], len = 60 / tr.bpm / 4;
  if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05; // after a stall (hidden tab) pick up from now, don't burst
  while (nextT < ac.currentTime + 0.2) {
    const bar = Math.floor(step / 16) % tr.bars;
    tr.play(nextT, bar, step % 16, PROG[bar % 4], len);
    nextT += len; step++;
  }
}, 50);
