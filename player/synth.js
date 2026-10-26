// A small Web Audio piano for the player: plays score.json notes against an AudioContext clock.
// Not the film's sampler (music/sampler.py, offline, Salamander samples); a synthesised grand that needs no files:
//   per note   two slightly detuned oscillators on one harmonic wave per register (piano-like partial rolloff), a
//              low-pass whose cutoff starts high with the velocity and falls (the spectrum dulls as the note decays),
//              two-stage decay (prompt sound, then a long aftersound shorter in the treble), a short hammer-noise burst
//   dampers    a key's sound stops at its release, or at the next pedal-up when CC64 is down then (score.pedal);
//              the top 1.5 octaves have no dampers, as on a grand
//   room       a generated stereo hall (1.9 s), a gentle compressor
// Times passed in are AudioContext seconds; the player maps music time to them (play(score, ctxT0, mFrom)).

const DAMPERLESS = 90;      // keys above F#6 ring on (no dampers)

/** pedal down (CC64 >= 64) intervals -> releaseAt(m): when a key released at music time m stops sounding */
function damperTimes(pedal) {
  const ups = [];          // [down, up] music-time intervals
  let down = null;
  for (const [t, v] of pedal || []) {
    if (v >= 64 && down == null) down = t;
    else if (v < 64 && down != null) { ups.push([down, t]); down = null; }
  }
  if (down != null) ups.push([down, Infinity]);
  return (m) => { for (const [a, b] of ups) if (m >= a && m < b) return b; return m; };
}

function impulse(ctx, seconds = 1.9) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      lp += (Math.random() * 2 - 1 - lp) * (0.25 + 0.6 * Math.exp(-t * 3));      // darker as it decays
      d[i] = lp * Math.exp(-t * 6.9 / seconds) * (t < 0.012 ? t / 0.012 : 1);
    }
  }
  return buf;
}

export class PianoSynth {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.dry = ctx.createGain(); this.dry.gain.value = 0.8;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.32;
    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx);
    this.bus = ctx.createGain();
    this.bus.connect(this.dry); this.bus.connect(verb); verb.connect(this.wet);
    this.dry.connect(comp); this.wet.connect(comp); comp.connect(this.out); this.out.connect(ctx.destination);
    this.waves = new Map();
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    this.noise = nb;
    this.voices = new Set();
  }

  wave(pitch) {
    const reg = Math.max(0, Math.min(8, Math.floor((pitch - 21) / 11)));
    if (!this.waves.has(reg)) {
      const K = 24, re = new Float32Array(K + 1), im = new Float32Array(K + 1);
      const p0 = 21 + reg * 11 + 5, f0 = 440 * 2 ** ((p0 - 69) / 12);
      for (let k = 1; k <= K; k++) {
        if (k * f0 > 12000) break;
        // rolloff steeper in the treble; the strike point near 1/8 of the string thins the 8th partial
        const roll = 1 / k ** (1.0 + reg * 0.12), strike = Math.abs(Math.sin(Math.PI * k / 8.3));
        im[k] = roll * (0.35 + 0.65 * strike);
      }
      this.waves.set(reg, this.ctx.createPeriodicWave(re, im));
    }
    return this.waves.get(reg);
  }

  /** schedule one note: AudioContext times tOn (strike) and tOff (damper contact) */
  note(pitch, vel, tOn, tOff) {
    const ctx = this.ctx, f = 440 * 2 ** ((pitch - 69) / 12), v = vel / 127;
    const peak = 0.16 * v ** 1.7 * (1 + 0.5 * Math.max(0, (60 - pitch) / 40));
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    const c0 = Math.min(16000, f * (3 + 18 * v * v)), c1 = Math.min(9000, f * 1.6 + 250);
    lp.frequency.setValueAtTime(c0, tOn); lp.frequency.setTargetAtTime(c1, tOn + 0.01, 0.25 + 0.6 * (1 - v));
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.setPeriodicWave(this.wave(pitch)); o2.setPeriodicWave(this.wave(pitch));
    o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = pitch < 30 ? 0.6 : 1.4;
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    o1.connect(mix); o2.connect(mix); mix.connect(lp); lp.connect(g); g.connect(this.bus);
    // envelope: 3 ms attack, prompt decay, aftersound (shorter as the strings get shorter)
    const tauPrompt = Math.max(0.08, 0.35 * 2 ** (-(pitch - 48) / 24)), tauAfter = Math.max(0.5, Math.min(10, 7 * 2 ** (-(pitch - 36) / 20)));
    g.gain.setValueAtTime(0, tOn);
    g.gain.linearRampToValueAtTime(peak, tOn + 0.003);
    g.gain.setTargetAtTime(peak * 0.45, tOn + 0.003, tauPrompt);
    const tSplit = tOn + 0.003 + 2 * tauPrompt;
    if (tSplit < tOff) g.gain.setTargetAtTime(0, tSplit, tauAfter);
    const tauRel = pitch < 40 ? 0.18 : 0.09;
    const end = pitch > DAMPERLESS ? tOn + 5 * tauAfter : tOff;
    if (pitch <= DAMPERLESS) g.gain.setTargetAtTime(0, end, tauRel);
    const stopAt = (pitch > DAMPERLESS ? end : end + 6 * tauRel) + 0.05;
    o1.start(tOn); o2.start(tOn); o1.stop(stopAt); o2.stop(stopAt);
    // hammer
    const h = ctx.createBufferSource(); h.buffer = this.noise;
    const hb = ctx.createBiquadFilter(); hb.type = 'bandpass'; hb.frequency.value = Math.min(5000, Math.max(900, f * 3)); hb.Q.value = 0.9;
    const hg = ctx.createGain(); hg.gain.value = 0.05 * v ** 2;
    h.connect(hb); hb.connect(hg); hg.connect(this.bus); h.start(tOn);
    const voice = { o1, o2, h, g, stopAt };
    this.voices.add(voice);
    o1.onended = () => { this.voices.delete(voice); g.disconnect(); };
    return voice;
  }

  /** silence everything now (seek, pause) */
  stopAll() {
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.02);
      for (const o of [v.o1, v.o2, v.h]) { try { o.stop(t + 0.1); } catch { /* not started yet */ } }
    }
    this.voices.clear();
  }
}

/**
 * A scheduler over a score: start(ctxTime, m) plays from music time m at AudioContext time ctxTime; tick() keeps
 * `ahead` seconds scheduled (call it from a timer); stop() silences.
 */
export class ScorePlayer {
  constructor(synth, score, { ahead = 0.4 } = {}) {
    this.synth = synth; this.ahead = ahead;
    this.notes = [...score.notes].sort((a, b) => a.t_on - b.t_on);
    const rel = damperTimes(score.pedal);
    this.offs = this.notes.map((n) => rel(n.t_off));
    this.i = 0; this.base = null;
  }
  start(ctxTime, m) {
    this.stop();
    this.base = ctxTime - m;                       // ctx time of music time 0
    let lo = 0, hi = this.notes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.notes[mid].t_on < m - 0.005) lo = mid + 1; else hi = mid; }
    this.i = lo;
    this.tick();
  }
  tick() {
    if (this.base == null) return;
    const until = this.synth.ctx.currentTime + this.ahead - this.base;
    while (this.i < this.notes.length && this.notes[this.i].t_on < until) {
      const n = this.notes[this.i];
      const tOn = Math.max(this.synth.ctx.currentTime, this.base + n.t_on);
      this.synth.note(n.pitch, n.vel, tOn, Math.max(tOn + 0.02, this.base + this.offs[this.i]));
      this.i++;
    }
  }
  stop() { this.base = null; this.synth.stopAll(); }
}
