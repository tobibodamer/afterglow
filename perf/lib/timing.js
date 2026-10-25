// Note timing and piano action (research/performance.md section 5; research/audio.md sections 2.4 and 5).
// All times in MUSIC time (seconds). t_hs = t_on (delta_audio = 0 within 3.2 ms, research/audio.md section 5).
import { clamp, smoothstep } from './math.js';

export const MUSIC_OFFSET = 4.0;
export const RATE = 240;

export const HV = (v) => Math.pow(2, (v - 52) / 25);                     // m/s (Boesendorfer SE log map)
export const ttPressMs = (v) => 89.16 * Math.pow(HV(v), -0.570);          // finger-key contact -> hammer-string
export const ttStruckMs = (v) => Math.max(20, ttPressMs(v) - 35);
export const kbRelMs = (v) => 12.106 * Math.pow(HV(v), -0.702) - 7.444;  // key bottom relative to t_hs
export const freeFlightMs = (v) => clamp(1.63 * Math.pow(HV(v), -1.403), 0.5, 20);

/** touch type: struck for loud notes / accents / chord attacks after a lift; pressed otherwise (performance.md 4.8) */
export function touchType(note, ctx) {
  if (note.vel > 95) return 'struck';
  if (ctx && ctx.detached && note.vel > 70) return 'struck';
  return 'pressed';
}

/**
 * Per-note key timing. Returns {tFk, tKb, tHs, tRel0, tUp, touch}.
 *  tFk  fingertip meets the key, key starts moving (t_hs - tt)
 *  tKb  key reaches the bottom
 *  tRel0 key starts rising (t_off - 25 ms); half travel at ~t_off; tUp key back at rest
 */
export function noteTiming(n, touch) {
  const tt = (touch === 'struck' ? ttStruckMs(n.vel) : ttPressMs(n.vel)) / 1000;
  const tHs = n.t_on;
  let tFk = tHs - tt;
  let tKb = tHs + kbRelMs(n.vel) / 1000;
  if (tKb < tFk + 0.012) tKb = tFk + 0.012;
  return { tFk, tKb, tHs, tRel0: n.t_off - 0.025, touch };
}

// key release: critically damped return, half-life 20 ms (performance.md 5.2): x(t) = (1 + w t) e^{-w t}
// half value at (1 + w t)e^{-wt} = 0.5 -> w t = 1.678; with t_half = 0.025 s (t_off - 25 ms -> half travel at t_off)
const REL_W = 1.678 / 0.025;
export function releaseFrac(dt) { if (dt <= 0) return 1; const x = REL_W * dt; return (1 + x) * Math.exp(-x); }
export const RELEASE_DONE = 0.09;  // s after tRel0, key within 0.6 % of rest

/** key press profile 0..1 between tFk and tKb (pressed: tau^2, struck: 1-(1-tau)^1.6) */
export function pressFrac(t, tm) {
  if (t <= tm.tFk) return 0; if (t >= tm.tKb) return 1;
  const tau = (t - tm.tFk) / (tm.tKb - tm.tFk);
  return tm.touch === 'struck' ? 1 - Math.pow(1 - tau, 1.6) : tau * tau;
}

/**
 * Key depression fraction (0 = rest, 1 = full dip) for a sequence of strokes on ONE key, sorted by time.
 * Each stroke: {tFk, tKb, tRel0, touch, ...}. Re-strikes before the key is fully up start from the current height
 * (repetition from a partly raised key, double escapement).
 */
export function keyFracAt(t, strokes) {
  let f = 0;
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (t < s.tStart) break;
    if (t <= s.tKb) { const p = pressFrac2(t, s); f = s.f0 + (1 - s.f0) * p; return f; }
    if (t <= s.tRel0) return 1;
    f = releaseFrac(t - s.tRel0);
    const nx = strokes[i + 1];
    if (!nx || t < nx.tStart) return f;
  }
  return f;
}
function pressFrac2(t, s) {
  if (t <= s.tStart) return 0; if (t >= s.tKb) return 1;
  const tau = (t - s.tStart) / (s.tKb - s.tStart);
  return s.touch === 'struck' || s.f0 > 0.05 ? 1 - Math.pow(1 - tau, 1.6) : tau * tau;
}
/** prepare strokes of one key: resolve overlaps (re-strike from a partly raised key) */
export function prepareStrokes(strokes) {
  strokes.sort((a, b) => a.tFk - b.tFk);
  let prev = null;
  for (const s of strokes) {
    s.tStart = s.tFk; s.f0 = 0;
    if (prev) {
      // the key rises before the re-strike (fix round 1: ~60 % of its travel, 30 ms after its release starts, as long as the
      // stroke down still takes >= 15 ms; planRestrikes moves the release so there is room for it)
      const earliest = prev.tRel0 + 0.030;
      if (s.tStart < earliest) s.tStart = Math.min(s.tKb - 0.006, Math.max(Math.min(earliest, s.tKb - 0.015), prev.tRel0 + 0.012, s.tFk));
      if (s.tStart > prev.tRel0) s.f0 = releaseFrac(s.tStart - prev.tRel0); else s.f0 = 1;
      if (s.tStart < prev.tKb) s.tStart = prev.tKb + 0.004;
    }
    prev = s;
  }
  return strokes;
}

// ------------------------------------------------------------------ pedal + dampers (sampler model, research/audio.md 2.4)
export const PEDAL_LO = 32 / 127, PEDAL_HI = 76 / 127, PEDAL_TRAVEL_S = 0.07;

/** CC64 step curve (the sampler holds each value until the next event) -> value 0..1 at t */
export function ccStep(pedal, t) {
  let v = 0; for (let i = 0; i < pedal.length; i++) { if (pedal[i][0] <= t) v = pedal[i][1] / 127; else break; } return v;
}
/**
 * Sampler damper lift (0 = on the strings, 1 = lifted) sampled on a uniform grid (t0, dt, n): smoothstep of the half-pedal
 * zone, slew-limited to full travel in 70 ms. Exactly the sampler's damper_lift() at control rate dt.
 */
export function damperLiftCurve(pedal, t0, dt, n) {
  const out = new Float32Array(n); let cur = null; let pi = 0; let cc = 0; const step = dt / PEDAL_TRAVEL_S;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    while (pi < pedal.length && pedal[pi][0] <= t) { cc = pedal[pi][1] / 127; pi++; }
    const x = clamp((cc - PEDAL_LO) / (PEDAL_HI - PEDAL_LO), 0, 1); const target = x * x * (3 - 2 * x);
    if (cur === null) cur = target;
    else if (target > cur) cur = Math.min(target, cur + step); else cur = Math.max(target, cur - step);
    out[i] = cur;
  }
  return out;
}
/**
 * Physical pedal travel (0..1) from the CC64 steps: the foot moves with a smooth (min-jerk) 60-70 ms stroke centred so the
 * travel crosses the CC value at the CC time (performance.md 5.5: crossing at the event time).
 */
export function pedalTravelCurve(pedal, t0, dt, n) {
  // every CC step becomes a smooth foot stroke centred on the CC time (press 70 ms, release 60 ms wide), so the travel
  // crosses the half-pedal zone when the sampler moves its dampers; consecutive steps (127 -> 18 -> 0) add up.
  const steps = []; let prev = 0;
  for (const [t, v] of pedal) { const x = v / 127; if (Math.abs(x - prev) > 1e-6) steps.push({ t, d: x - prev, w: x > prev ? 0.07 : 0.06 }); prev = x; }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt; let s = 0;
    for (const st of steps) { if (t >= st.t + st.w / 2) s += st.d; else if (t > st.t - st.w / 2) s += st.d * smoothstep(st.t - st.w / 2, st.t + st.w / 2, t); else if (t < st.t - 0.05) break; }
    out[i] = clamp(s, 0, 1);
  }
  return out;
}
