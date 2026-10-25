// Expressive body motion (research/performance.md 6.2), all driven by score structure (phrases, dynamics, register,
// beats) with smooth aperiodic noise only as seasoning. Subtle: centimetres and a few degrees. No loops: every channel
// is a function of the music + incommensurate gradient noise.
import { clamp, smoothstep, bodyNoise, DEG, qMul, qConj, qAxisAngle, qRot, hash01 } from './math.js';

/** exact critically damped spring filter (Holden), x tracks target series g sampled at dt; half-life hl (s) */
export function springFilter(g, dt, hl, sub = 4) {
  const out = new Float32Array(g.length); const y = 4 * Math.LN2 / hl / 2; // damping = 4 ln2 / hl; y = damping / 2
  let x = g[0], v = 0; const h = dt / sub;
  for (let i = 0; i < g.length; i++) {
    for (let s = 0; s < sub; s++) {
      const j0 = x - g[i], j1 = v + j0 * y; const e = Math.exp(-y * h);
      x = e * (j0 + j1 * h) + g[i]; v = e * (v - j1 * y * h);
    }
    out[i] = x;
  }
  return out;
}
/** limit the rate of change (deg/s) of a series */
function rateLimit(a, dt, maxRate) { const o = new Float32Array(a.length); o[0] = a[0]; const m = maxRate * dt; for (let i = 1; i < a.length; i++) o[i] = o[i - 1] + clamp(a[i] - o[i - 1], -m, m); return o; }
function gauss(series, dt, sigma) {
  const s = sigma / dt, R = Math.ceil(3 * s); const k = []; let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / s) ** 2); k.push(w); ks += w; }
  const o = new Float32Array(series.length);
  for (let i = 0; i < series.length; i++) { let a = 0; for (let j = -R; j <= R; j++) { const q = Math.min(series.length - 1, Math.max(0, i + j)); a += series[q] * k[j + R]; } o[i] = a / ks; }
  return o;
}

export class BodyMotion {
  /**
   * score: {notes(with hand, t_on, vel, pitch, t_off), phrases[{t0,t1,peak}], beats[], sections[]}; grid: t0 (music), dt, n
   * xCentroid(hand, t) -> lateral wrist position (pianist frame x) of that hand's plan (for register).
   */
  constructor(score, grid, opts = {}) {
    const { t0, dt, n } = grid; this.t0 = t0; this.dt = dt; this.n = n;
    const T = (i) => t0 + i * dt;
    const notes = score.notes;
    // ---- dynamic envelope D(t): onset velocities, 1.5 s Gaussian, normalised 0..1 over the piece
    const raw = new Float32Array(n);
    for (const nt of notes) { const i = Math.round((nt.t_on - t0) / dt); if (i >= 0 && i < n) raw[i] += nt.vel / 127; }
    let D = gauss(raw, dt, 1.5); { let mx = 0, mn = 1e9; for (const v of D) { mx = Math.max(mx, v); } for (let i = 0; i < n; i++) D[i] = D[i] / (mx || 1); }
    this.D = D;
    // ---- phrase arc phi and phrase peak
    const phr = (score.phrases || []).slice().sort((a, b) => a.t0 - b.t0);
    const arc = new Float32Array(n), inPhr = new Float32Array(n), peak = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = T(i); const p = phr.find((q) => t >= q.t0 && t < q.t1); if (p) { arc[i] = (t - p.t0) / (p.t1 - p.t0); inPhr[i] = 1; peak[i] = p.peak ?? 0.5; } }
    this.arc = arc;
    // ---- register centroid per hand from the hand planners (lateral wrist x), smoothed
    const xr = new Float32Array(n), xl = new Float32Array(n);
    for (let i = 0; i < n; i++) { xr[i] = opts.xCentroid ? opts.xCentroid('R', T(i)) : -0.18; xl[i] = opts.xCentroid ? opts.xCentroid('L', T(i)) : 0.16; }
    const xm = new Float32Array(n); for (let i = 0; i < n; i++) xm[i] = 0.5 * (xr[i] + xl[i]) - opts.xMid0;
    // melody hand for gaze: whichever hand has the 'mel' voice recently, else RH
    const gazeX = new Float32Array(n);
    const mel = notes.filter((q) => q.voice === 'mel').sort((a, b) => a.t_on - b.t_on);
    for (let i = 0; i < n; i++) {
      const t = T(i) + 0.3; // look-ahead 300 ms
      gazeX[i] = 0.65 * xr[Math.min(n - 1, i + Math.round(0.3 / dt))] + 0.35 * xl[Math.min(n - 1, i + Math.round(0.3 / dt))];
      void t;
    }
    void mel;
    // ---- targets (deg / m)
    const pitchT = new Float32Array(n), rollT = new Float32Array(n), yawT = new Float32Array(n), headPT = new Float32Array(n), headYT = new Float32Array(n), headRT = new Float32Array(n);
    const seasonOf = (t) => { const s = (score.sections || []).find((q) => t >= q.t_start && t < q.t_end); return s ? s.name : ''; };
    const seasonBoost = (t) => ({ climax: 1.0, build: 0.8, chorus2: 0.7, chorus1: 0.6, bridge: 0.5 }[seasonOf(t)] ?? 0.35);
    const lastOn = notes.length ? Math.max(...notes.map((q) => q.t_off)) : 0;
    // fix round 1 (critic: one stamped template per 4-bar phrase, phrase-to-phrase correlation 0.71): every phrase gets
    // its own gesture from its own content (climax = its loudest/highest melody note, size from its dynamics) plus
    // seeded per-phrase variation of size (0.55-1.45x), timing (+-150 ms), head gesture and nod (some phrases none)
    const PI = phr.map((p, k) => {
      const ns = notes.filter((q) => q.t_on >= p.t0 && q.t_on < p.t1); const mel = ns.filter((q) => q.voice === 'mel'); const src = mel.length ? mel : ns;
      let tc = 0.5 * (p.t0 + p.t1), best = -1; for (const q of src) { const sc = q.vel + 0.6 * q.pitch; if (sc > best) { best = sc; tc = q.t_on; } }
      const vmax = ns.length ? Math.max(...ns.map((q) => q.vel)) : 50; const r = (s) => hash01(k, s);
      const restBefore = !notes.some((q) => q.t_on < p.t0 - 0.02 && q.t_off > p.t0 - 0.5);
      return {
        t0: p.t0, t1: p.t1, peak: p.peak ?? 0.5, tc: clamp(tc + (r(101) - 0.5) * 0.3, p.t0 + 0.25 * (p.t1 - p.t0), p.t1 - 0.15 * (p.t1 - p.t0)),
        amp: (r(1616) < 0.2 ? -0.5 : 1) * (0.55 + 0.9 * r(202)) * (0.55 + 0.75 * clamp((vmax - 50) / 60, 0, 1)), dAmp: 0.6 + 0.8 * r(1313), head: (r(303) < 0.3 ? -0.5 : 1) * (0.5 + 0.9 * r(404)), roll: (r(505) < 0.5 ? -1 : 1) * (0.4 + 0.8 * r(606)),
        nod: restBefore || r(707) > 0.35, nodAmp: 0.35 + 1.1 * r(808), nodDt: (r(909) - 0.5) * 0.3, nodW: 0.16 + 0.12 * r(1010),
      };
    });
    const bump = (t, P) => (t < P.t0 || t >= P.t1 ? 0 : t < P.tc ? Math.sin(0.5 * Math.PI * (t - P.t0) / (P.tc - P.t0)) ** 2 : Math.cos(0.5 * Math.PI * (t - P.tc) / (P.t1 - P.tc)) ** 2);
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const t = T(i); const d = D[i]; const play = smoothstep(-1.5, 0.0, t) * (1 - smoothstep(lastOn + 1, lastOn + 5, t));
      while (pk + 1 < PI.length && PI[pk + 1].t0 <= t) pk++;
      const P = PI[pk] && t >= PI[pk].t0 && t < PI[pk].t1 ? PI[pk] : null; const b = P ? bump(t, P) : 0;
      // lean into the phrase's own climax, ease back at the cadence; louder = further in
      // after the final release the body exhales and settles back a little as the hands go to the lap (fix round 1)
      const settle = smoothstep(lastOn + 0.4, lastOn + 2.8, t);
      pitchT[i] = play * (2.6 * (2 * d - 1) * (P ? P.dAmp : 1) + 1.5 * b * (P ? P.amp * (0.6 + 0.6 * P.peak) : 0)) - 0.6 - 1.3 * settle;
      // lateral (fix round 1: the torso was laterally locked, chest +-9 mm): lean and shift toward the hands' register,
      // up to ~4.5 cm at the shoulders / 5 deg, strongest when both hands play at one end
      const lat = clamp(0.35 * xm[i], -0.045, 0.045);
      rollT[i] = clamp(-lat / 0.45 / DEG, -5, 5);            // lean toward the active register (x<0 treble -> roll +)
      yawT[i] = clamp(-0.4 * Math.atan2(xm[i], 0.45) / DEG, -9, 9);
      // head: gaze toward the active hands (a bowed head, the eyes do most of it), roll with intensity and phrase arc
      headYT[i] = clamp(-Math.atan2(gazeX[i] - opts.xMid0, 0.55) / DEG * 0.45, -12, 12);
      headPT[i] = play * (2.0 * d) + 1.0 * b * (P ? P.head : 0) + 3.0 * settle;
      headRT[i] = play * (2.5 * b * (P ? P.roll * (0.4 + P.peak) : 0) + 1.2 * (d - 0.5));
    }
    // accents (fix round 1): a strong, sudden attack gives the torso a quick, smoothly started forward dip (8-15 deg/s)
    const acc = new Float32Array(n);
    { const hs = notes.slice().sort((a, b) => a.t_on - b.t_on); let k = 0;
      for (const q of hs) {
        while (hs[k].t_on < q.t_on - 2) k++; const prevV = hs.slice(k).filter((x) => x.t_on < q.t_on - 0.05).map((x) => x.vel);
        const mean = prevV.length ? prevV.reduce((s, v) => s + v, 0) / prevV.length : 50;
        if (q.vel < 88 || q.vel - mean < 14) continue;
        const a = 0.8 + 1.0 * clamp((q.vel - 88) / 30, 0, 1); const i0 = Math.max(0, Math.floor((q.t_on - 0.3 - t0) / dt)), i1 = Math.min(n - 1, Math.ceil((q.t_on + 0.6 - t0) / dt));
        for (let i = i0; i <= i1; i++) { const x = (T(i) - q.t_on - 0.05) / 0.16; acc[i] = Math.max(acc[i], a * Math.exp(-0.5 * x * x)); }
      } }
    const accF = springFilter(acc, dt, 0.07);
    const pitchS = springFilter(pitchT, dt, 0.8);
    this.pitch = rateLimit(new Float32Array(n).map((_, i) => pitchS[i] + accF[i]), dt, 18);
    this.roll = rateLimit(springFilter(rollT, dt, 0.45), dt, 15);
    this.yaw = rateLimit(springFilter(yawT, dt, 0.45), dt, 15);
    // pelvis slide on the bench toward the register (fix round 1: the chest moved +-9 mm while the hands travelled 25 cm):
    // up to +-15 mm, slower than the lean (half-life 0.6 s)
    const slide = new Float32Array(n); for (let i = 0; i < n; i++) slide[i] = clamp(0.25 * xm[i], -0.015, 0.015) * smoothstep(-2.0, 0.0, T(i));
    this.rootX = springFilter(slide, dt, 0.6);
    this.headY = rateLimit(springFilter(headYT, dt, 0.35), dt, 30);
    this.headR = rateLimit(springFilter(headRT, dt, 1.2), dt, 30);
    // nods (fix round 1): only some phrase starts nod (after a rest always), each with its own size, timing and width;
    // micro-nods only on accented attacks (no beat-locked repetition); summed, then spring-filtered (smooth onset, no
    // hard 30 deg/s rate clamp shaping every nod alike)
    const nod = new Float32Array(n);
    const addPulse = (tc, amp, w) => { const i0 = Math.max(0, Math.floor((tc - 0.5 - t0) / dt)), i1 = Math.min(n - 1, Math.ceil((tc + 0.8 - t0) / dt)); for (let i = i0; i <= i1; i++) { const x = (T(i) - tc) / w; nod[i] += amp * Math.exp(-0.5 * x * x) * (x < 0 ? 0.6 : 1); } };
    for (const P of PI) if (P.nod) addPulse(P.t0 + 0.02 + P.nodDt, (1.2 + 2.0 * P.peak) * P.nodAmp, P.nodW);
    { const hs = notes.slice().sort((a, b) => a.t_on - b.t_on); let last = -9, k = 0;
      for (const q of hs) {
        if (q.t_on - last < 0.6) continue; while (hs[k].t_on < q.t_on - 2) k++;
        const prevV = hs.slice(k).filter((x) => x.t_on < q.t_on - 0.05).map((x) => x.vel); const mean = prevV.length ? prevV.reduce((s, v) => s + v, 0) / prevV.length : 50;
        if (q.vel - mean < 10 || q.vel < 70) continue;
        const i = Math.round((q.t_on - t0) / dt); if (i < 0 || i >= n) continue; const r = hash01(q.id, 1111);
        if (r < 0.35) continue; addPulse(q.t_on + 0.03 + (r - 0.5) * 0.06, (0.4 + 0.6 * r) * D[i] * seasonBoost(q.t_on), 0.10 + 0.05 * r); last = q.t_on;
      } }
    const headP0 = springFilter(headPT, dt, 0.3); const nodF = springFilter(nod, dt, 0.05);
    this.headP = rateLimit(new Float32Array(n).map((_, i) => headP0[i] + nodF[i]), dt, 45);
    // ---- breathing: inhale 0.55 s before phrase onsets and rests, exhale through the phrase, extra breaths in long
    // phrases at bar lines; interval clamped 3-9 s (Sakaguchi & Aiba 2016 tendencies)
    const inh = [];
    const bars = (score.bars || []).map((b) => b.t);
    // critic round 2 (the chest/head pitch repeated every ~6.18 s, high-passed autocorrelation 0.41 at 6.18 / 12.37 s:
    // one inhale per 4-bar phrase made the breathing a clock at the phrase period): the breathing runs on its OWN
    // irregular clock (2.8-8 s, faster when loud), and an inhale is drawn into a phrase onset only when one is near
    // (<= 0.9 s) and only for every other such phrase on average; otherwise it lands just before a bar line
    { const ons = phr.map((p) => p.t0).sort((a, b) => a - b); let t = -3.2 - 0.5; inh.push(t); let nb = 0;
      while (t < lastOn - 1.5) {
        const di = Math.round((t - t0) / dt); const calm = 1 - (D[Math.max(0, Math.min(n - 1, di))] || 0);
        const interval = clamp(3.2 + 3.0 * calm + 5.0 * (hash01(nb, 1515) - 0.5), 2.6, 8.5);
        let tn = t + interval; const lead = 0.35 + 0.5 * hash01(nb, 1414); nb++;
        const near = ons.filter((s) => Math.abs(s - lead - tn) < 0.9 && s - lead > t + 2.6);
        if (near.length && hash01(nb, 1717) < 0.35) tn = near[0] - lead;
        else { const bl = bars.filter((b) => Math.abs(b - 0.3 - tn) < 0.7 && b - 0.3 > t + 2.6); if (bl.length) tn = bl.reduce((x, y) => (Math.abs(y - 0.3 - tn) < Math.abs(x - 0.3 - tn) ? y : x)) - 0.3; }
        inh.push(tn); t = tn;
      } }
    // final long breath after the last release
    inh.push(lastOn + 1.0);
    inh.sort((a, b) => a - b);
    // breath size per inhale (fix round 1: breathing barely read): a visibly deeper inhale before big phrases (build,
    // climax, high phrase peaks), the others varied 0.85-1.1x
    const inhAmp = inh.map((ta, k) => { const p = phr.find((q) => q.t0 >= ta && q.t0 < ta + 1.2); const big = p && ((p.peak ?? 0) >= 0.7 || ['build', 'climax'].includes(seasonOf(p.t0))); return big ? 1.4 : 0.85 + 0.25 * hash01(k, 1212); });
    const br = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = T(i); let k = -1; for (let j = 0; j < inh.length; j++) if (inh[j] <= t) k = j; else break;
      if (k < 0) { br[i] = 0.3; continue; }
      const ta = inh[k], tb = inh[k + 1] ?? ta + 6; const dur = clamp(0.8 + 0.12 * (tb - ta - 3), 0.8, 1.5);
      const prevLevel = 0.12, top = inhAmp[k];
      if (t < ta + dur) br[i] = prevLevel + (top - prevLevel) * (0.5 - 0.5 * Math.cos(Math.PI * (t - ta) / dur));
      else { const ex = clamp((t - ta - dur) / Math.max(0.8, (tb - ta - dur) * 0.75), 0, 1); br[i] = top - (top - prevLevel) * (0.5 - 0.5 * Math.cos(Math.PI * ex)); }
    }
    this.breath = springFilter(br, dt, 0.12);
    this.inhales = inh;
    // shoulder elevation (mm): breath + preparation before loud chords
    const sh = new Float32Array(n);
    for (let i = 0; i < n; i++) sh[i] = 4.5 * this.breath[i];
    for (const nt of notes) if (nt.vel >= 95) { const tc = nt.t_on - 0.15; const i0 = Math.max(0, Math.floor((tc - 0.25 - t0) / dt)), i1 = Math.min(n - 1, Math.ceil((tc + 0.3 - t0) / dt)); for (let i = i0; i <= i1; i++) { const x = (T(i) - tc) / 0.1; sh[i] = Math.max(sh[i], 4.5 * this.breath[i] + 6 * Math.exp(-0.5 * x * x)); } }
    this.shoulder = springFilter(sh, dt, 0.25);
  }
  /** angles at sample i (deg) with noise seasoning */
  at(i) {
    const t = this.t0 + i * this.dt;
    return {
      pitch: this.pitch[i] + 0.5 * bodyNoise(t, 11), roll: this.roll[i] + 0.35 * bodyNoise(t, 23), yaw: this.yaw[i] + 0.4 * bodyNoise(t, 37),
      headP: this.headP[i] + 0.8 * bodyNoise(t, 41) - 0.5 * this.breath[i], headY: this.headY[i] + 0.8 * bodyNoise(t, 53), headR: this.headR[i] + 0.6 * bodyNoise(t, 59),
      breath: this.breath[i], shoulderMm: this.shoulder[i] + 0.6 * bodyNoise(t, 67), D: this.D[i], rootX: this.rootX[i],
    };
  }
}

const SPINE = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'];
const NECK = ['neck01', 'neck02', 'neck03', 'head'];
/** apply world-axis deltas (deg) to a joint in its bind frame: local' = local * (Bw^-1 R Bw) */
function applyWorld(rig, local, name, axis, deg) {
  if (!deg) return; const i = rig.idx(name); const Bw = rig.bindWQ[i];
  const ax = qRot(qConj(Bw), axis); local[i] = qMul(local[i], qAxisAngle(ax, deg * DEG));
}
/** body angles -> Map(jointIndex -> local quat) */
export function bodyLocals(rig, a, extra = {}) {
  const local = rig.joints.map((j) => j.q.slice());
  const wP = [0.30, 0.25, 0.20, 0.15, 0.10], wR = [0.25, 0.25, 0.2, 0.15, 0.15], wY = [0.10, 0.15, 0.20, 0.25, 0.30];
  SPINE.forEach((nm, k) => {
    // breath extends the upper chest (fix round 1: 1.15 deg per upper joint at a normal breath, ~1.6 before big phrases;
    // the lower spine flexes a little less so the chest rises and opens rather than the whole torso tipping back)
    applyWorld(rig, local, nm, [1, 0, 0], a.pitch * wP[k] + (k >= 3 ? -1.15 * a.breath : k === 2 ? 0.35 * a.breath : 0));
    applyWorld(rig, local, nm, [0, 0, 1], a.roll * wR[k]);
    applyWorld(rig, local, nm, [0, 1, 0], a.yaw * wY[k]);
  });
  const wn = [0.22, 0.26, 0.22, 0.30];
  NECK.forEach((nm, k) => {
    applyWorld(rig, local, nm, [1, 0, 0], a.headP * wn[k] - (k === 0 ? a.pitch * 0.35 : 0));  // keep the gaze when leaning
    applyWorld(rig, local, nm, [0, 1, 0], a.headY * wn[k]);
    applyWorld(rig, local, nm, [0, 0, 1], a.headR * wn[k]);
  });
  // clavicles: elevation (breath, preparation) and protraction with lateral reach
  const el = (a.shoulderMm / 1000) / 0.10 / DEG; // deg for a ~10 cm lever
  applyWorld(rig, local, 'clavicle_R', [0, 0, 1], -el); applyWorld(rig, local, 'clavicle_L', [0, 0, 1], el);
  if (extra.protractR) applyWorld(rig, local, 'clavicle_R', [0, 1, 0], extra.protractR);
  if (extra.protractL) applyWorld(rig, local, 'clavicle_L', [0, 1, 0], extra.protractL);
  return local;
}
