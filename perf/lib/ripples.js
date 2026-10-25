// Water ripple emitter events (rig frame, on the water surface y = 0): piano legs and lyre from strong attacks and
// low-register energy, the right foot from pedal strokes, bench legs from big body moves. Sparse and plausible.
import { RIPPLE_SOURCES, BENCH, KEY_FRONT_Z } from './pianoGeo.js';
import * as Lay from '../../scene/src/piano/layout.js';
import { clamp } from './math.js';

export function makeRipples({ notes, score, t0, dt, N, travel, legs, body }) {
  const MO = 4.0;
  const src = {};
  for (const s of RIPPLE_SOURCES) { const r = Lay.pianoToRig([s.xz[0], 0.04, s.xz[1]]); src[s.name] = [r[0], 0, r[2]]; }
  const bx = BENCH.center[0], bz = BENCH.center[2], hw = BENCH.seatSize[0] / 2 - 0.03, hd = BENCH.seatSize[1] / 2 - 0.03;
  const benchLegs = [[bx - hw, bz - hd], [bx + hw, bz - hd], [bx - hw, bz + hd], [bx + hw, bz + hd]].map(([x, z]) => { const r = Lay.pianoToRig([x, 0.04, z]); return [r[0], 0, r[2]]; });
  // right foot: where the shin meets the water, approx. above the heel (pianist frame -> rig)
  const h = legs.heel; const footR = [h[0], 0, h[2] + 0.03 + KEY_FRONT_Z];
  const footL = [0.145, 0, 0.03 + KEY_FRONT_Z];
  const out = []; const last = {};
  const emit = (t, name, pos, amp, minGap = 0.35) => { if (last[name] !== undefined && t - last[name] < minGap) return; last[name] = t; out.push({ t: +(t + MO).toFixed(5), m: +t.toFixed(5), pos: pos.map((v) => +v.toFixed(4)), amp: +amp.toFixed(5), src: name }); };
  // attacks: onset groups (both hands) within 40 ms
  const ons = notes.slice().sort((a, b) => a.t_on - b.t_on); const groups = [];
  for (const n of ons) { const g = groups[groups.length - 1]; if (g && n.t_on - g.t < 0.04) g.n.push(n); else groups.push({ t: n.t_on, n: [n] }); }
  for (const g of groups) {
    let E = 0, low = 0;
    for (const n of g.n) { const w = clamp(1 + (60 - n.pitch) / 30, 0.5, 2.0); const e = (n.vel / 127) ** 2 * w; E += e; if (n.pitch < 45) low += e; }
    if (E > 0.9) { const amp = clamp(0.0006 * (E - 0.6), 0.0002, 0.0022); emit(g.t + 0.012, 'legBass', src.legBass, amp * (0.6 + 0.4 * clamp(low / (E + 1e-6), 0, 1))); emit(g.t + 0.012, 'legTreble', src.legTreble, amp * 0.7); emit(g.t + 0.015, 'lyre', src.lyre, amp * 0.8); if (E > 1.6) emit(g.t + 0.02, 'legRear', src.legRear, amp * 0.6); }
    else if (low > 0.30) emit(g.t + 0.012, 'legBass', src.legBass, clamp(0.0005 * low, 0.00015, 0.0008), 0.6);
  }
  // pedal: a stroke that presses quickly (travel rising > 60 % within 80 ms) -> right foot + lyre
  for (let i = 20; i < N; i++) {
    const d = travel[i] - travel[i - 20];
    if (d > 0.6 && travel[i - 21] - travel[i - 41] < 0.3) { const t = t0 + i * dt; emit(t, 'footR', footR, 0.00035, 0.9); emit(t + 0.005, 'lyre', src.lyre, 0.00025, 0.6); }
  }
  // body: strong lean changes push through the bench legs (rare)
  if (body) for (let i = 240; i < N; i += 24) {
    const v = (body.pitch[i] - body.pitch[i - 24]) / (24 * dt);
    if (Math.abs(v) > 3.0) { const t = t0 + i * dt; const amp = clamp(0.00012 * Math.abs(v), 0.0002, 0.0007); emit(t, 'benchFront', v > 0 ? benchLegs[2] : benchLegs[0], amp, 2.5); emit(t + 0.01, 'benchFront2', v > 0 ? benchLegs[3] : benchLegs[1], amp * 0.8, 2.5); }
  }
  void footL;
  out.sort((a, b) => a.t - b.t);
  return out;
}
