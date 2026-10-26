// Palm motion between the keyframes (plan.js solves the keyframes, this file moves the hand through them). Kept apart
// from plan.js so motion changes do not invalidate the keyframe cache.
//
// Timing follows how a prepared pianist moves (research/performance.md 4.6): a transfer takes an unhurried time that
// grows with the distance (transferTime, capped) and ends with the hand set over the next keys shortly before they are
// played. In a longer gap the hand waits at its old position (it does not crawl across the whole gap) and leaves just in
// time; only when the music leaves less time than transferTime does the transfer start as soon as the fingers that do
// not carry over are off their keys, and get faster. smoothPalmPath then turns the held-pose/transfer reference into one minimum-jerk path (Flash & Hogan 1985):
// stiff where fingers are on keys, loose in between, so dense passages glide through their positions instead of stopping
// at each one, and every transfer has a bell-shaped speed profile with no corner at its start or end.
import { qMul, qRot, qSlerp, qConj, qLog, qExp, qAxisAngle, qAngle, add, sub, len, DEG, clamp, minjerk, lerp3, smoothstep } from './math.js';
import { touchT, upT } from './fingers.js';

/** unhurried transfer time for a palm path of d metres (wrist travel + 95 mm per radian of turn): 0.3 s for a small
 * shift, ~0.8 s for a two-octave leap; peak speed of the min-jerk reach 1.875 d / T (0.1 m/s at 2 cm, 0.7 m/s at 30 cm) */
export const transferTime = (d) => clamp(0.30 + 1.6 * d, 0.30, 0.90);

/** arrival and departure times of every keyframe (P.kf[k].A / .D), then the leap pivots */
export function buildTrajectory(P, { tStart, tEnd, phrases }) {
  const kf = P.kf;
  for (let k = 0; k < kf.length; k++) { kf[k].A = kf[k].T - 0.035; kf[k].D = kf[k].T; delete kf[k].late; }
  for (let k = 0; k + 1 < kf.length; k++) {
    const a = kf[k], b = kf[k + 1];
    const d = len(sub(b.pose.p, a.pose.p));
    const dEff = d + 0.095 * qAngle(a.pose.q, b.pose.q);
    // notes of k not continuing into k+1 must be released (finger off the key) before a big move
    const nextIds = new Set(b.contacts.map((c) => c.id));
    let lastUp = -1e9; for (const c of a.contacts) if (!nextIds.has(c.id)) { const n = P.notes.find((x) => x.id === c.id); lastUp = Math.max(lastUp, n.tUp); }
    // earliest departure: the hand has landed on a and the fingers that do not carry over are (nearly) off their keys
    const E = Math.max(a.T + 0.01, lastUp - 0.02);
    // set over the next keys up to 100 ms before the first of them is touched, less when the time is short
    const A = b.T - clamp(0.25 * (b.T - E), 0.035, 0.10);
    let D = Math.max(E, A - transferTime(dEff));
    b.A = A;
    if (D > b.A - 0.07) { b.A = Math.min(b.T - 0.004, D + 0.07); D = Math.min(D, b.A - 0.05); }
    a.D = Math.max(a.A + 0.001, Math.min(D, b.A - 0.03));
    // fix round 1 (critic: L4 dragged 100 mm through the keys in the m 173.8 leap): the palm never leaves while a finger
    // that does not carry over is still on its key; when there is no time left, the hand arrives late instead (the
    // landing is struck, from the air) - a finger is never pulled off or through the keys by its own hand
    // the palm may start before the last finger is up only as far as it has moved <= 8 mm by then (a finger leaving a
    // key from a moving hand; the per-sample IK and the contact-preserving nudge keep it on the key that long)
    // critic round 2 (S11 m 100.94: the palm rolled 51 deg toward the thumb-under while L4 still held D3, hooking it):
    // the <= 8 mm budget counts the fingertip motion of the hand's TURN too (~95 mm lever from the wrist), not only
    // the wrist's translation
    let lead = 0; { const dur0 = Math.max(0.03, b.A - a.D); for (let x = 0.07; x > 0; x -= 0.0025) if (dEff * minjerk(x / dur0) <= 0.008) { lead = x; break; } }
    if (lastUp > -1e8 && a.D < lastUp - lead) {
      const need = clamp(0.05 + 0.25 * d, 0.06, 0.2);
      a.D = Math.max(a.A + 0.001, lastUp - lead);
      if (b.A < a.D + need) { b.A = a.D + need; if (kf[k + 2]) b.A = Math.min(b.A, kf[k + 2].A - 0.01); }
      if (b.A > b.T - 0.004) { P.lateArrivals = (P.lateArrivals || 0) + 1; P.lateMax = Math.max(P.lateMax || 0, b.A - b.T); b.late = b.A - b.T; }
    }
    a.moveD = d;
  }
  planPivots(P);
  P.traj = { kf, tStart, tEnd };
  // free windows (no finger in contact) for musical vertical motion
  const busy = P.notes.map((n) => [n.tm.tFk - 0.05, n.tUp]).sort((x, y) => x[0] - y[0]);
  const merged = []; for (const iv of busy) { const m = merged[merged.length - 1]; if (m && iv[0] <= m[1]) m[1] = Math.max(m[1], iv[1]); else merged.push(iv.slice()); }
  const free = []; let t0 = tStart; for (const m of merged) { if (m[0] > t0) free.push([t0, m[0]]); t0 = Math.max(t0, m[1]); } if (tEnd > t0) free.push([t0, tEnd]);
  P.freeWins = free;
  P.phrases = phrases || [];
}

/** critic round 2: leap pivots (see below); called again by the solver after it moved arrival/departure times */
export function planPivots(P) {
  const kf = P.kf;
  for (let k = 0; k + 1 < kf.length; k++) {
    const a = kf[k], b = kf[k + 1]; const d = a.moveD || 0; const nextIds = new Set(b.contacts.map((c) => c.id));
    // critic round 2 (critical, S02 m 6.825: LH G1 -> F3/Bb3, 287 mm in 100 ms, 6.2 m/s; the hand sat still on G1, then
    // crossed in 4 frames): a LEAP away from a single held finger is led during the hold. While the finger is still on
    // its key the hand turns about that fingertip (vertical axis through the contact point, so the finger's own pose and
    // its contact are unchanged) and the wrist and forearm swing toward the target; the transfer then continues from the
    // turned pose with the same speed. One min-jerk progress over [pivot start, arrival] drives both phases, so the
    // speed is continuous and the peak speed drops by the share of the path covered in the pivot.
    delete a.pivot;
    const leaving = a.contacts.filter((c) => !nextIds.has(c.id));
    const dx = b.pose.p[0] - a.pose.p[0];
    if (d > 0.12 && Math.abs(dx) > 0.10 && leaving.length === 1 && a.contacts.length === 1) {
      const n = P.notes.find((x) => x.id === leaving[0].id);
      const c = n && n.P0;
      if (c) {
        const r = [a.pose.p[0] - c[0], 0, a.pose.p[2] - c[2]]; const rl = Math.hypot(r[0], r[2]);
        // y x r = [r.z, 0, -r.x]: the wrist moves along +-[r.z, 0, -r.x]; the sign that moves it toward the target
        const sgn = Math.sign(dx * r[2]) || 1;
        const thMax = 13 * DEG;                                         // hand-forearm yaw the wrist absorbs
        const Dp = thMax * rl;                                          // wrist path in the pivot
        const sH = clamp(Dp / d, 0, 0.3);                              // share of the path (equal speed in both phases)
        // u at which minjerk reaches sH (bisection), then the lead L from the flight time after the pivot
        let lo = 0, hi = 0.5; for (let it = 0; it < 30; it++) { const m = 0.5 * (lo + hi); if (minjerk(m) < sH) lo = m; else hi = m; }
        // the turn lasts until the held finger is up (tE), so the flight never drags it (contactsnaps r4c: L1 A2 34 deg in
        // one frame 14 ms before its up when the turn ended at a.D, up to 70 ms before the finger left)
        const tE = clamp(n.tUp ?? a.D, a.D, b.A - 0.03);
        const uH = 0.5 * (lo + hi); const fl = Math.max(0.03, b.A - tE);
        let L = uH * fl / Math.max(1e-3, 1 - uH);
        // the pivot starts after the key reached its bottom and the hand settled on a (>= 40 ms after its arrival)
        const tP0 = Math.max(a.A + 0.04, n.tm.tKb + 0.01);
        if (tE - L < tP0) L = tE - tP0;
        if (L > 0.02) {
          const tP = tE - L; const uh = L / (b.A - tP); const sh = minjerk(uh);
          const th = sgn * thMax * (sh / sH);                            // shorter pivot -> proportionally smaller turn
          a.pivot = { tP, tE, c: [c[0], 0, c[2]], th, sh };
        }
      }
    }
  }
}

/** 0..1: how far the hand has gone to its rest on the thigh after the final release */
export function lapW(P, t) { if (!P.ctx.lap || !P.kf.length) return 0; const lastUp = P.lastUp ?? (P.lastUp = Math.max(...P.notes.map((n) => n.tUp))); return smoothstep(lastUp + 0.6, lastUp + 1.9, t); }

/** palm pose at time t (the reference path: holds at the keyframes, min-jerk transfers; before musical offsets) */
export function palmBase(P, t) {
  const kf = P.kf;
  if (t <= kf[0].A) {
    // before the first note: hands poised above the first position, settling down over ~1.2 s
    const k0 = kf[0]; const lift = 0.03 * smoothstep(k0.A - 0.2, k0.A - 1.6, t);
    return { p: add(k0.pose.p, [0, lift, -0.6 * lift]), q: k0.pose.q };
  }
  // binary search the segment
  let lo = 0, hi = kf.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (kf[m].A <= t) lo = m; else hi = m - 1; }
  const a = kf[lo], b = kf[lo + 1];
  if (!b) {
    // after the last keyframe: fix round 1 (critic: the hands hovered frozen in mid-air for the last 4 s) - after the
    // final release the hand lifts ~2 cm, then is lowered in an arc onto the thigh over ~1.5 s and rests there
    const lastUp = P.lastUp ?? (P.lastUp = Math.max(...P.notes.map((n) => n.tUp)));
    const lift = 0.02 * minjerk((t - lastUp) / 0.45);
    let p = add(a.pose.p, [0, lift, -0.3 * lift]); let q = a.pose.q;
    const lap = P.ctx.lap;
    if (lap) {
      const u = clamp((t - lastUp - 0.35) / 1.55, 0, 1); const s = minjerk(u);
      p = lerp3(p, lap.p, s); p = add(p, [0, 0.03 * 16 * u * u * (1 - u) * (1 - u), 0]); q = qSlerp(a.pose.q, lap.q, s);
    }
    return { p, q };
  }
  const pv = a.pivot;
  if (pv && t > pv.tP) {
    // critic round 2: leap led during the hold (buildTrajectory): turn about the held fingertip, then fly on from there
    const s = minjerk((t - pv.tP) / Math.max(1e-3, b.A - pv.tP));
    const turn = (w) => { const qy = qAxisAngle([0, 1, 0], pv.th * w); const r = sub(a.pose.p, pv.c); return { p: add(pv.c, qRot(qy, r)), q: qMul(qy, a.pose.q) }; };
    if (t <= pv.tE) return turn(clamp(s / pv.sh, 0, 1));
    const a1 = turn(1); const w = clamp((s - pv.sh) / Math.max(1e-3, 1 - pv.sh), 0, 1);
    const u = clamp((t - pv.tE) / Math.max(1e-3, b.A - pv.tE), 0, 1);
    let p = lerp3(a1.p, b.pose.p, w);
    const d = a.moveD || 0; const apex = 0.015 + 0.12 * d; const bump = 16 * u * u * (1 - u) * (1 - u);
    p = add(p, [0, apex * bump, -0.35 * apex * bump]);
    return { p, q: qSlerp(a1.q, b.pose.q, w) };
  }
  if (t <= a.D) return { p: a.pose.p, q: a.pose.q };
  const u = clamp((t - a.D) / Math.max(1e-3, b.A - a.D), 0, 1); const s = minjerk(u);
  let p = lerp3(a.pose.p, b.pose.p, s);
  const d = a.moveD || 0;
  // arc: leaps lift 15 mm + 0.12 d; small shifts lift a few mm
  const apex = d > 0.045 ? 0.015 + 0.12 * d : 0.08 * d;
  const bump = 16 * u * u * (1 - u) * (1 - u);
  p = add(p, [0, apex * bump, -0.35 * apex * bump]);
  return { p, q: qSlerp(a.pose.q, b.pose.q, s) };
}

// smoothPalmPath: stiffness while a finger is on a key and for the free hand; how far the path may leave the reference
export const PATH_TAU = 0.05;        // s: smoothing time constant where the stiffness is 1 (cutoff ~3 Hz)
const W_CONTACT = 1, W_FREE = 0.003;
const TOL_HOLD = 0.006, TOL_LAND = 0.0015;   // m of fingertip motion the fingers absorb (wrist shift + 95 mm lever x turn)
const TOL_SWING = 0.0015, SWING_LOOK = 0.35;   // m of wind-up against the coming move / overshoot past the arrival; s looked ahead and back

/**
 * Minimum-jerk palm path: per channel (position xyz, rotation vector about the first keyframe) the x minimising
 *   sum_i w_i (x_i - ref_i)^2 + (tau / dt)^6 sum_i (third difference of x at i)^2,
 * a banded (7-diagonal) SPD system solved by Cholesky in O(N). w_i is W_CONTACT while a finger is on a key and W_FREE
 * between contacts, so a free hand follows the retimed reference only loosely and its motion spreads over the free time.
 * Where a finger is on a key the path may leave the reference only as far as the finger absorbs (TOL_HOLD; TOL_LAND
 * from touch to key bottom, where the hand must be set): those samples are stiffened and the system re-solved until
 * they are within tolerance. Small shifts in dense passages therefore glide through the held positions, while a hand
 * that leaps away from a held finger still waits for it. Along the reference's motion (SWING_LOOK back and ahead) the slack
 * is one-sided: the hand may trail its last move or lead into its next, but a wind-up against the coming move or an
 * overshoot past an arrival (the smoother's side lobes) gets only TOL_SWING. Ramps of 50 ms before a touch and 30 ms after a release keep
 * the weights from switching in one sample. Returns { p, q } (arrays of N), the solves used and the samples still over
 * tolerance after the last one.
 */
export function smoothPalmPath(P, notes, t0, dt, N, tau = PATH_TAU) {
  const w = new Float64Array(N).fill(W_FREE), tol = new Float64Array(N).fill(Infinity), tolS = new Float64Array(N).fill(Infinity);
  for (const n of notes) {
    if (!n.P0) continue;
    const ta = touchT(n) - 0.015, tu = upT(n), tk = Math.max(ta, n.tm.tKb + 0.015);
    const i0 = Math.floor((ta - 0.05 - t0) / dt), i1 = Math.ceil((tu + 0.03 - t0) / dt);
    for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
      const t = t0 + i * dt;
      const c = t < ta ? smoothstep(ta - 0.05, ta, t) : t > tu ? 1 - smoothstep(tu, tu + 0.03, t) : 1;
      w[i] = Math.max(w[i], W_FREE + (W_CONTACT - W_FREE) * c);
      if (c > 0.05) { tol[i] = Math.min(tol[i], (t >= ta && t <= tk ? TOL_LAND : TOL_HOLD) / c); tolS[i] = Math.min(tolS[i], TOL_SWING / c); }
    }
  }
  const ref = new Array(N); for (let i = 0; i < N; i++) ref[i] = palmBase(P, t0 + i * dt);
  const qref = P.kf[0].pose.q;
  const ch = [0, 1, 2, 3, 4, 5].map(() => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    const r = qLog(qMul(ref[i].q, qConj(qref)));
    ch[0][i] = ref[i].p[0]; ch[1][i] = ref[i].p[1]; ch[2][i] = ref[i].p[2]; ch[3][i] = r[0]; ch[4][i] = r[1]; ch[5][i] = r[2];
  }
  // unit directions (6-D, rotation scaled to fingertip metres) to where the reference is SWING_LOOK ahead / came from behind
  const K = Math.round(SWING_LOOK / dt);
  const dirTo = (i, j) => { const v = [0, 1, 2, 3, 4, 5].map((k) => (ch[k][j] - ch[k][i]) * (k < 3 ? 1 : 0.095)); const l = Math.hypot(...v); return l > 0.004 ? v.map((x) => x / l) : null; };
  const uNext = new Array(N).fill(null), uPrev = new Array(N).fill(null);
  for (let i = 0; i < N; i++) if (tol[i] !== Infinity) { uNext[i] = dirTo(i, Math.min(N - 1, i + K)); uPrev[i] = dirTo(Math.max(0, i - K), i); }
  const lam = (tau / dt) ** 6;
  let sm, it = 0, over = 0;
  for (; it < 10; it++) {
    const L = jerkFactor(w, lam);
    sm = ch.map((c) => jerkSolve(L, c, lam));
    over = 0;
    for (let i = 0; i < N; i++) {
      if (tol[i] === Infinity) continue;
      const e = [0, 1, 2, 3, 4, 5].map((k) => (sm[k][i] - ch[k][i]) * (k < 3 ? 1 : 0.095));
      const dev = Math.hypot(e[0], e[1], e[2]) + Math.hypot(e[3], e[4], e[5]);
      // a lag behind the last move or a lead into the next is slack; past the last move AND against the next is a swing
      const past = uPrev[i] ? e.reduce((a, x, k) => a + x * uPrev[i][k], 0) : Infinity, against = uNext[i] ? -e.reduce((a, x, k) => a + x * uNext[i][k], 0) : Infinity;
      const swing = uPrev[i] || uNext[i] ? Math.max(0, Math.min(past, against)) : 0;
      const x = Math.max(dev / tol[i], swing / tolS[i]);
      if (x > 1.05) { w[i] *= Math.min(16, x * x); over++; }
    }
    if (!over) break;
  }
  const p = new Array(N), q = new Array(N);
  for (let i = 0; i < N; i++) { p[i] = [sm[0][i], sm[1][i], sm[2][i]]; q[i] = qMul(qExp([sm[3][i], sm[4][i], sm[5][i]]), qref); }
  return { p, q, iters: Math.min(it + 1, 10), over };
}

const C3 = [-1, 3, -3, 1];   // third difference
/** Cholesky factor (band, half-bandwidth 3) of diag(w) + lam * D3^T D3 */
function jerkFactor(w, lam) {
  const N = w.length, B = 4; const M = new Float64Array(N * B);   // M[i*B + k] = A[i][i-k]
  for (let i = 0; i < N; i++) M[i * B] = w[i];
  for (let r = 0; r + 3 < N; r++) for (let a = 0; a < 4; a++) for (let b = 0; b <= a; b++) M[(r + a) * B + (a - b)] += lam * C3[a] * C3[b];
  const L = new Float64Array(N * B);
  for (let i = 0; i < N; i++) {
    for (let k = Math.min(3, i); k >= 0; k--) {
      const j = i - k; let s = M[i * B + k];
      for (let m = 1; m <= 3 - k && j - m >= 0; m++) s -= L[i * B + k + m] * L[j * B + m];
      L[i * B + k] = k === 0 ? Math.sqrt(s) : s / L[j * B];
    }
  }
  return L;
}
/** solves (diag(w) + lam D^T D) x = diag(w) ref as x = ref + e, (diag(w) + lam D^T D) e = -lam D^T D ref (better conditioned) */
function jerkSolve(L, ref, lam) {
  const N = ref.length, B = 4; const rhs = new Float64Array(N);
  for (let r = 0; r + 3 < N; r++) { const g = C3[0] * ref[r] + C3[1] * ref[r + 1] + C3[2] * ref[r + 2] + C3[3] * ref[r + 3]; for (let a = 0; a < 4; a++) rhs[r + a] -= lam * C3[a] * g; }
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) { let s = rhs[i]; for (let k = 1; k <= Math.min(3, i); k++) s -= L[i * B + k] * y[i - k]; y[i] = s / L[i * B]; }
  const x = new Float64Array(N);
  for (let i = N - 1; i >= 0; i--) { let s = y[i]; for (let k = 1; k <= 3 && i + k < N; k++) s -= L[(i + k) * B + k] * x[i + k]; x[i] = s / L[i * B]; }
  for (let i = 0; i < N; i++) x[i] += ref[i];
  return x;
}
