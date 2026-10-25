// Key, hammer, damper and pedal tracks (research/performance.md 5; research/audio.md 2.4 sampler damper model;
// hammer geometry as scene/src/piano/geom/action.js computes it).
import { prepareStrokes, keyFracAt, freeFlightMs, releaseFrac, damperLiftCurve, pedalTravelCurve } from './timing.js';
import { KEYS, LAYOUT, PEDAL_MAX_RAD, DAMPED_NOTES } from './pianoGeo.js';
import { clamp, smoothstep } from './math.js';

const SHANK_LEN = 0.125, CROWN_ABOVE_SHANK = 0.051, H0 = 0.082;
const BLOW = LAYOUT.action.blowDistance, CHECK_BELOW = LAYOUT.action.checkBelowString;
const LETOFF = 0.002;
/** hammer angle (rad) for crown rise y (m) on note index i (0..87): same formula as action.js */
export function hammerAngle(i, y) {
  const t = i / 87; const Hh = H0 + (0.076 - H0) * t; const cy = CROWN_ABOVE_SHANK * (Hh / H0);
  const R = Math.hypot(cy, SHANK_LEN), a0 = Math.atan2(cy, SHANK_LEN);
  return Math.asin(Math.min(1, (cy + y) / R)) - a0;
}

export class KeyTracks {
  /** notes: all notes with tm (timing) resolved; pedal: score.pedal */
  constructor(notes, pedal) {
    this.strokes = Array.from({ length: 88 }, () => []);
    for (const n of notes) {
      const i = n.pitch - 21; if (i < 0 || i > 87) continue;
      this.strokes[i].push({ id: n.id, tFk: n.tm.tFk, tKb: n.tm.tKb, tHs: n.tm.tHs, tRel0: n.tm.tRel0, touch: n.tm.touch, vel: n.vel });
    }
    for (const s of this.strokes) prepareStrokes(s);
    this.pedal = pedal || [];
  }
  frac(i, t) { const s = this.strokes[i]; return s.length ? keyFracAt(t, s) : 0; }
  angle(i, t) { return this.frac(i, t) * KEYS[i].dipRad; }
  /** hammer crown rise (m) */
  hammerRise(i, t) {
    const S = this.strokes[i]; if (!S.length) return 0;
    const yEsc = BLOW - LETOFF, yChk = BLOW - CHECK_BELOW;
    let y = 0;
    for (let k = 0; k < S.length; k++) {
      const s = S[k]; const nx = S[k + 1];
      if (t < s.tStart) break;
      const tEsc = Math.max(s.tStart + 0.6 * (s.tHs - s.tStart), s.tHs - freeFlightMs(s.vel) / 1000);
      const fEsc = Math.max(0.05, this.frac(i, tEsc));
      const y0 = s.f0 > 0 ? this.prevChk(s) : 0;
      if (t <= tEsc) { const f = this.frac(i, t); y = y0 + (yEsc - y0) * clamp((f - s.f0) / Math.max(0.02, fEsc - s.f0), 0, 1); return y; }
      if (t <= s.tHs) { y = yEsc + (BLOW - yEsc) * (t - tEsc) / Math.max(1e-4, s.tHs - tEsc); return y; }
      if (t <= s.tHs + 0.002) return BLOW;
      // rebound to the backcheck (critically damped, ~8 ms half-life) while the key is held
      const dt = t - s.tHs - 0.002; const w = 1.678 / 0.008; const e = (1 + w * dt) * Math.exp(-w * dt);
      y = yChk + (BLOW - yChk) * e;
      if (t >= s.tRel0) y *= this.frac(i, t);          // the hammer falls back with the key
      if (nx && t >= nx.tStart) continue;
      return y;
    }
    return y;
  }
  prevChk() { return (BLOW - CHECK_BELOW) * 0.7; }
  /** arrays sampled on the grid (t0, dt, n) */
  sample(t0, dt, n) {
    const keys = new Float32Array(n * 88), ham = new Float32Array(n * 88), damp = new Float32Array(n * 88), ped = new Float32Array(n * 3);
    const lift = damperLiftCurve(this.pedal, t0, dt, n);
    const travel = pedalTravelCurve(this.pedal, t0, dt, n);
    const kLift = LAYOUT.action.damperLiftKey, pLift = LAYOUT.action.damperLiftPedal;
    const h0 = new Float32Array(88); for (let i = 0; i < 88; i++) h0[i] = hammerAngle(i, 0);
    for (let i = 0; i < 88; i++) {
      const S = this.strokes[i]; const damped = i + 1 >= DAMPED_NOTES[0] && i + 1 <= DAMPED_NOTES[1];
      const F = new Float32Array(n), Y = new Float32Array(n);
      // evaluate only inside each stroke's window (key fully back at rest 0.3 s after the release starts)
      for (let k = 0; k < S.length; k++) {
        const s = S[k]; const a = Math.max(0, Math.floor((s.tStart - 0.01 - t0) / dt)); const b = Math.min(n - 1, Math.ceil((s.tRel0 + 0.3 - t0) / dt));
        for (let j = a; j <= b; j++) { const t = t0 + j * dt; F[j] = this.frac(i, t); Y[j] = this.hammerRise(i, t); }
      }
      for (let j = 0; j < n; j++) {
        const f = F[j]; const o = j * 88 + i;
        keys[o] = f * KEYS[i].dipRad;
        ham[o] = Y[j] > 0 ? hammerAngle(i, Y[j]) : h0[i];
        damp[o] = damped ? Math.max(kLift * smoothstep(0.45, 0.80, f), pLift * lift[j]) : 0;
      }
    }
    for (let j = 0; j < n; j++) { ped[j * 3 + 2] = travel[j] * PEDAL_MAX_RAD.sustain; }
    return { keys, ham, damp, ped, lift, travel };
  }
}
