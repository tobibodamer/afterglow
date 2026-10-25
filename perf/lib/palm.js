// Palm pose optimisation (research/performance.md 8.2) on the rig hand: variables = wrist position (3) + rotation
// vector (3) applied to the bind wrist orientation. Contact fingers are solved exactly by IK inside the objective;
// the objective scores finger posture, hand orientation, wrist angles against an approximate arm, free-finger
// clearance and continuity.
import { qMul, qRot, qExp, qLog, qConj, add, sub, scale, dot, norm, cross, len, DEG, clamp, solveLin } from './math.js';
import { LIMITS, THUMB_PREF, contactPip, ADDUCT } from './hand.js';
import { fingerPenetration, padLowest, palmPenetration, fingerCapsules, segSegClosest } from './collide.js';
import { keyPointP, keyTopYAtP, keyNormalP, KEYS, whiteKeyAtX, blackKeysNearX, WHITE_TOP_Y, BLACK_TOP_Y, sphereClearY } from './pianoGeo.js';

/** hand-frame features for a palm pose */
export function handFeatures(H, palm) {
  const w = palm.p;
  const m3 = H.baseOf(3, palm); const j3 = add(m3.p, qRot(m3.q, H.J[H.fj[3][0]].t));
  const m2 = H.baseOf(2, palm); const j2 = add(m2.p, qRot(m2.q, H.J[H.fj[2][0]].t));
  const m5 = H.baseOf(5, palm); const j5 = add(m5.p, qRot(m5.q, H.J[H.fj[5][0]].t));
  const h = norm(sub(j3, w)); const k = norm(sub(j5, j2));
  const u = norm(sub(k, scale(h, dot(k, h))));          // toward the little finger, in the palm plane
  let n = norm(cross(h, u)); if (n[1] < 0) n = scale(n, -1);   // dorsal normal (up for a palm-down hand)
  const pitch = Math.asin(clamp(h[1], -1, 1));
  const yawIn = -H.lat * Math.atan2(h[0], h[2]);
  const rollSup = Math.asin(clamp(k[1], -1, 1));      // little-finger side up = supination
  return { h, k, u, n, pitch, yawIn, rollSup, mcp3: j3, mcp2: j2, mcp5: j5 };
}

/** wrist angles of the hand relative to a forearm direction f (unit, elbow -> wrist) */
export function wristAngles(feat, f) {
  const ext = -Math.asin(clamp(dot(f, feat.n), -1, 1));
  const uln = -Math.asin(clamp(dot(f, feat.u), -1, 1));
  return { ext, uln };
}

/** 2-bone arm: elbow from shoulder S, wrist W, lengths, swivel angle (rad, 0 = elbow straight down, + = outward) */
export function elbowPos(S, W, L1, L2, swivel, lat) {
  const d = sub(W, S); const D = clamp(len(d), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4); const a = norm(d);
  const x = (L1 * L1 - L2 * L2 + D * D) / (2 * D); const r = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const C = add(S, scale(a, x));
  let down = sub([0, -1, 0], scale(a, -a[1])); down = norm(down);
  const side = norm(cross(a, down));   // perpendicular
  // outward = away from the body midline: for the RH (lat -1) outward is -x
  const out = dot(side, [lat, 0, 0]) > 0 ? side : scale(side, -1);
  return add(C, add(scale(down, r * Math.cos(swivel)), scale(out, r * Math.sin(swivel))));
}

// (cycle 2: a flatter shape (white 23/42/70, black 19/32/58) + pitch0 -4 was tried in range runs r7d/r7e/r7f: knuckles
// stayed 61-69 mm above the keys and the thumb MCP fell back to its floor -> reverted; knuckle height is open)
// cycle 2 fix round 2: posture-space thumb and palm-height terms (env PERF_OLD_THUMB=1 / PERF_OLD_PALMH=1 restore f5a/g1f)
export const THUMB_POSTURE = !process.env.PERF_OLD_THUMB;
export const PALM_HEIGHT = !process.env.PERF_OLD_PALMH;
const THUMB_LOOSE = { ...THUMB_PREF, mcpMin: 4 * DEG, ipMin: 2 * DEG };
export const PREF = PALM_HEIGHT ? {
  // cycle 2 fix round 2: the flatter contact shape that follows a level, lower palm (critic: MCP 20-30, PIP 35-50, DP 40-55)
  white: { mcp: 24, pip: 42, dpa: 60 }, black: { mcp: 20, pip: 34, dpa: 52 },
  fast: { mcp: 26, pip: 48, dpa: 68 }, chordFF: { mcp: 18, pip: 38, dpa: 62 },
} : {
  white: { mcp: 25, pip: 45, dpa: 75 }, black: { mcp: 20, pip: 34, dpa: 62 },
  fast: { mcp: 27, pip: 50, dpa: 82 }, chordFF: { mcp: 18, pip: 38, dpa: 75 },
};

/**
 * contacts: [{f, target (pad centre world), black, fixed}], free: [fingers not in contact]
 * ctx: {shoulder, L1, L2, swivel, prev (palm), wPrev, next, wNext, pitch0, yaw0, rollPref, hover}
 */
export function makeObjective(H, contacts, free, ctx) {
  const cache = new Map();
  return (pose) => {
    const palm = { q: pose.q, p: pose.p, cup: ctx.cup };
    const res = []; const sol = {};
    const feat0 = handFeatures(H, palm); const fwd = norm([feat0.h[0], 0, feat0.h[2]]);
    for (const c of contacts) {
      if (c.f === 1) {
        // the thumb's pad point is its support point toward the keys (hand.js), so the target is the contact point itself
        // cycle 2 fix round 2: the reach rescue's loose starts may bend the thumb below the global MCP/IP floors (ctx.thumbLoose)
        const r = H.solveThumb(palm, c.target, cache.get(1), ctx.thumbLoose ? THUMB_LOOSE : null);
        cache.set(1, r.a); sol[1] = r;
        const B = H.bindAngles[1];
        res.push(r.err * 1000 / 0.25);
        void B; res.push((r.a.mcp - THUMB_PREF.mcp) / DEG / 14, (r.a.ip - THUMB_PREF.ip) / DEG / 14, (r.a.cmc - THUMB_PREF.cmc) / DEG / 14, (r.a.cmcAbd - THUMB_PREF.cmcAbd) / DEG / 14);
        // thumb plays on its radial corner: DP rolled toward side-down, pitched 15-35 deg (performance.md 3.6), pointing
        // along the key (yawed at most ~16 deg toward the fingers, so the tip stays on its own key)
        { const fk1 = H.fingerFK(1, palm, r.a); const k3 = fk1[2]; const sd = -qRot(k3.q, H.pad[1].side)[1]; const dir = qRot(k3.q, [0, 1, 0]); const pt = Math.asin(clamp(-dir[1], -1, 1)) / DEG;
          const yaw = Math.atan2(dir[0] * H.lat, dir[2]) / DEG;
          res.push(lim(sd, [0.55, 0.95]) / 0.08, lim(pt, [12, 40]) / 4, lim(yaw, [-16, 22]) / 4); r.sideDown = sd; r.dpPitch = pt; r.yaw = yaw;
          if (ctx.collide) { const pen = fingerPenetration(H, 1, palm, fk1, ctx.keyAngles, c.key, 0.0003); res.push(Math.sqrt(pen.sum) * 1000 / 0.25); r.pen = pen.max; } }
        const L = H.thumbLimits();
        // fix round 1: a rounded thumb (MCP flexed 8-30, IP 10-38), never the hyperextended stick
        { const bw = ctx.thumbLoose ? 0.25 : 1; res.push(lim(r.a.cmc / DEG, L.cmc) / 1.5, lim(r.a.cmcAbd / DEG, L.cmcAbd) / 1.5, bw * lim(r.a.mcp / DEG, [18, 32]) / 0.6, bw * lim(r.a.ip / DEG, [16, 38]) / 0.8); }   // fix round 2: mcp 8 -> 12, ip 10 -> 14; cycle 2 fix 1: mcp 17 / ip 16 (opposed, bent thumb; the palm takes the reach)
        // cycle 2 fix round 2 (critical, user #1: 'pointer' thumb unchanged on screen although its joint angles rose: the CMC
        // was laid back to -26..-32 deg and the tip sat 40-73 mm outside the index-MCP line, the MCP-to-tip line nearly
        // horizontal): the thumb is constrained in POSTURE space - CMC never extended past the rig rest (-8 deg), the tip
        // within ctx.thOut mm of the index-MCP line (32 mm; wider only for spans >= 9 semitones), the MCP-to-tip line
        // >= 25 deg down toward the key. The palm moves (and rolls) to the thumb instead of the thumb pointing out.
        if (THUMB_POSTURE) {
          const fk1 = H.fingerFK(1, palm, r.a); const tip = H.tip(1, fk1); const latv = norm(sub(feat0.mcp5, feat0.mcp2));
          const out = -dot(sub(tip, feat0.mcp2), latv) * 1000; const v = sub(tip, fk1[1].p); const lp = Math.asin(clamp(-v[1] / Math.max(1e-9, len(v)), -1, 1)) / DEG;
          res.push(Math.max(0, out - (ctx.thOut ?? 32)) / 2.5, lim(lp, [25, 85]) / 2, lim(r.a.cmc / DEG, [ctx.cmcFloor ?? -8, 99]) / 3);
          r.thOut = out; r.thLine = lp;
        }
      } else {
        const r = H.solveFinger(c.f, palm, c.target, cache.get(c.f), c.dipRatio || 0.67, null, contactPip(c.f));
        cache.set(c.f, r.a); sol[c.f] = r;
        const P = c.pref || (c.black ? PREF.black : PREF.white);
        const fk = H.fingerFK(c.f, palm, r.a); const dir = qRot(fk[2].q, [0, 1, 0]); const dpa = signedDPA(dir, fwd);
        r.dpa = dpa;
        res.push(r.err * 1000 / 0.25);
        if (ctx.collide) { const pen = fingerPenetration(H, c.f, palm, fk, ctx.keyAngles, c.key, 0.0003); res.push(Math.sqrt(pen.sum) * 1000 / 0.25); r.pen = pen.max; }
        // fix round 2: abduction prior about the adducted rest (fingers close and parallel), not the splayed bind
        res.push((r.a.mcp / DEG - P.mcp) / 9, (r.a.pip / DEG - P.pip) / 11, (r.a.abd - 0.5 * ADDUCT[c.f]) / DEG / 9, (dpa - P.dpa) / 10);
        const L = LIMITS; const al = L.abd[c.f];
        // fix round 1: no straight stick (PIP >= 22 / 14 deg for the 5th) and no high-knuckle claw (MCP <= 58)
        res.push(lim(r.a.mcp / DEG, [-5, 58]) / 0.5, lim(r.a.pip / DEG, [c.f === 5 ? 26 : 22, 95]) / (c.f === 5 ? 0.5 : 1.0), lim(r.a.abd / DEG, [al[0] * 0.8, al[1] * 0.8]) / 1.0, lim(dpa, [42, 96]) / 0.8);
      }
    }
    const feat = handFeatures(H, palm);
    if (PALM_HEIGHT) {
      // cycle 2 fix round 2 (major: tented 'spider' hands, knuckles p50 59-61 mm above the white tops, the wrist 22 mm
      // below the knuckle line): the palm is constrained first - knuckles (mean MCP2-5) 44-52 mm above the white tops,
      // the wrist joint level with the knuckle line (-12..+6 mm); the contact shape follows (flatter, PREF below). The
      // bind-pitch prior is weakened so it does not hold the hand tented.
      const mm = (feat.mcp2[1] + feat.mcp3[1] + feat.mcp5[1] + feat.mcp3[1]) / 4;   // (MCP4 ~ MCP3 height)
      const kh = (mm - WHITE_TOP_Y) * 1000, wl = (palm.p[1] - mm) * 1000;
      res.push(lim(kh, [44, 52]) / 3, lim(wl, [-12, 6]) / 3, (feat.pitch / DEG - ctx.pitch0) / 14);
    } else res.push((feat.pitch / DEG - ctx.pitch0) / 5);
    res.push((feat.yawIn / DEG - ctx.yaw0) / 9, (feat.rollSup / DEG - (ctx.rollPref || 0)) / 7);
    // fix round 1: forearm-rotation band (critic: the RH rolled 51 deg into a twisted fist at m 66): palm roll stays
    // within -22..+12 deg, hand yaw within +-24 deg of the bind yaw (beyond that a held key is let go or re-solved)
    res.push(lim(feat.rollSup / DEG, [-22, 12]) / 1.0, lim(feat.yawIn / DEG - ctx.yaw0, [-24, 24]) / 1.5);
    // wrist vs forearm (approximate arm)
    // the wrist must stay within a relaxed reach of the shoulder (elbow never locked straight)
    const reach = len(sub(palm.p, ctx.shoulder)) / (ctx.L1 + ctx.L2);
    res.push(Math.max(0, reach - 0.93) * 200);
    // the elbow swivel is chosen for this hand pose (forearm lined up with the hand, elbows out only as needed)
    const sw = bestSwivel(ctx.shoulder, palm.p, ctx.L1, ctx.L2, H.lat, feat, ctx.swivel);
    const E = elbowPos(ctx.shoulder, palm.p, ctx.L1, ctx.L2, sw, H.lat);
    const f = norm(sub(palm.p, E)); const wa = wristAngles(feat, f);
    // fix round 2: beyond ext 42 / ulnar 33 the wrist is broken (m 118.7: 63 / 65 deg): a near-hard wall, so an unreachable
    // span moves the palm or is released instead of being solved by the wrist
    res.push(lim(wa.ext / DEG, [-24, 42]) * 3, lim(wa.uln / DEG, [-16, 33]) * 3);
    res.push(lim(wa.ext / DEG, WRIST_BAND.ext) / 2, lim(wa.uln / DEG, WRIST_BAND.uln) / 2, (wa.ext / DEG - WRIST_PREF.ext) / 18, (wa.uln / DEG - WRIST_PREF.uln) / 18, (sw - ctx.swivel) / DEG / 20);
    // fix round 1: fingers of the keyframe pose keep out of each other (capsules of the contact fingers and the relaxed
    // free ones; the MCP webbing between neighbours is shared skin): the 4th and 3rd crossing into each other in chords
    if (H.caps) {
      const caps = []; for (const c of contacts) { const s = sol[c.f]; if (s) caps.push(fingerCapsules(H, c.f, H.fingerFK(c.f, palm, s.a))); }
      for (const fr of free) caps.push(fingerCapsules(H, fr, H.fingerFK(fr, palm, H.relaxed(fr))));
      let ov2 = 0; for (let a = 0; a < caps.length; a++) for (let b = a + 1; b < caps.length; b++) for (const A of caps[a]) for (const B of caps[b]) {
        if (A.k === 0 && B.k === 0 && A.f !== 1 && B.f !== 1 && Math.abs(A.f - B.f) === 1) continue;
        const d = A.r + B.r + 0.001 - segSegClosest(A.a, A.b, B.a, B.b).d; if (d > 0) ov2 += d * d;
      }
      res.push(Math.sqrt(ov2) * 1000 / 0.5);
    }
    // free fingers: relaxed tip must hover above the key bed under it
    for (const fr of free) {
      // cycle 2 fix round 2: with the lower palm a resting finger lies flatter on the keys (the per-sample drape solves its
      // real shape); the full relaxed curl (tip ~62 mm below the knuckle) held every knuckle line ~60 mm up
      const a = H.relaxed(fr, PALM_HEIGHT && fr !== 1 ? 0.6 : 1); const fk = H.fingerFK(fr, palm, a); const c = H.padCenter(fr, fk);
      const rr = Math.max(H.pad[fr].r, 0.006); const surf = sphereClearY(c[0], c[2], rr) - (rr - H.pad[fr].r); const clr = (c[1] - surf) * 1000;
      res.push(Math.max(0, (ctx.hoverMin ?? 4) - clr) / 1.0);
    }
    // wrist and knuckles above the keys, hand in front of the fallboard
    res.push(Math.max(0, WHITE_TOP_Y + 0.012 - palm.p[1]) * 1000 / 2, Math.max(0, feat.mcp3[2] - 0.075) * 1000 / 3);
    // fix round 1: the heel of the hand and the palm never sink into keys or the key slip (2 mm margin)
    if (ctx.keyAngles && H.palmSet) { const pp = palmPenetration(H, palm, ctx.keyAngles, 0.002); res.push(Math.sqrt(pp.sum) * 1000 / 0.5); }
    if (ctx.prev) { const d = sub(palm.p, ctx.prev.p); res.push(d[0] * 1000 / ctx.sPrev, d[1] * 1000 / ctx.sPrev, d[2] * 1000 / ctx.sPrev); const r = qLog(qMul(palm.q, qConj(ctx.prev.q))); res.push(...r.map((x) => x / DEG / (ctx.sPrev * 0.6))); }
    if (ctx.next) { const d = sub(palm.p, ctx.next.p); res.push(d[0] * 1000 / ctx.sNext, d[1] * 1000 / ctx.sNext, d[2] * 1000 / ctx.sNext); }
    return { res, sol, feat, wrist: wa, elbow: E, swivel: sw };
  };
}

/** wrist working band and preference (deg; performance.md 3.4: ext 0-25, ulnar 0-25 at the piano) */
export const WRIST_PREF = { ext: 16, uln: 8 };
export const WRIST_BAND = { ext: [-6, 32], uln: [-8, 26] };
/**
 * Elbow swivel (rad) for a hand pose: minimises the wrist's deviation/extension from the preference with a weak pull
 * toward swPref (rad; the posture default, elbows a little out). Grid 6..66 deg + parabolic refinement (continuous).
 */
export function bestSwivel(S, W, L1, L2, lat, feat, swPref) {
  const cost = (sw) => {
    const E = elbowPos(S, W, L1, L2, sw, lat); const wa = wristAngles(feat, norm(sub(W, E)));
    const u = (wa.uln / DEG - WRIST_PREF.uln) / 10, e = (wa.ext / DEG - WRIST_PREF.ext) / 14, p = (sw - swPref) / DEG / 22;
    return u * u + e * e + p * p;
  };
  const lo = 6 * DEG, hi = 66 * DEG, st = 3 * DEG; let bi = 0, bc = Infinity; const cs = [];
  for (let k = 0, sw = lo; sw <= hi + 1e-9; k++, sw += st) { const c = cost(sw); cs.push(c); if (c < bc) { bc = c; bi = k; } }
  if (bi === 0 || bi === cs.length - 1) return lo + bi * st;
  const a = cs[bi - 1], b = cs[bi], c = cs[bi + 1]; const den = a - 2 * b + c;
  const off = den > 1e-12 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
  return lo + (bi + off) * st;
}
const lim = (v, [a, b]) => (v < a ? a - v : v > b ? v - b : 0);
/** distal-phalanx angle below horizontal (deg) in the hand's forward plane: 90 = vertical, > 90 = hooked (nail first) */
export function signedDPA(dir, fwd) { return Math.atan2(-dir[1], dir[0] * fwd[0] + dir[2] * fwd[2]) / DEG; }

/** height of the key bed (white or black tops at rest) under plan point x, z (pianist frame) */
export function surfaceUnder(x, z, r = 0.006) {
  let y = 0.6;
  for (const dx of [-r, 0, r]) { const w = whiteKeyAtX(x + dx); if (w && z > -0.01 && z < 0.155) y = Math.max(y, WHITE_TOP_Y); }
  for (const k of blackKeysNearX(x, r)) if (z + r > k.box.z0 && z - r < k.box.z1) y = Math.max(y, BLACK_TOP_Y);
  return y;
}

/** Levenberg-Marquardt over the 6 palm variables */
export function solvePalm(H, contacts, free, ctx, init) {
  const q0 = init.q; const p0 = init.p;
  const obj = makeObjective(H, contacts, free, ctx);
  const toPose = (x) => ({ p: [p0[0] + x[0], p0[1] + x[1], p0[2] + x[2]], q: qMul(qExp([x[3], x[4], x[5]]), q0) });
  let x = [0, 0, 0, 0, 0, 0]; let o = obj(toPose(x)); let cost = o.res.reduce((s, v) => s + v * v, 0);
  let lam = 1e-2;
  for (let it = 0; it < (ctx.iters || 40); it++) {
    const hs = [2e-4, 2e-4, 2e-4, 2e-3, 2e-3, 2e-3]; const J = [];
    for (let k = 0; k < 6; k++) { const y = x.slice(); y[k] += hs[k]; const oy = obj(toPose(y)); J.push(oy.res.map((v, m) => (v - o.res[m]) / hs[k])); }
    const AtA = [0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3, 4, 5].map((j) => J[i].reduce((s, v, m) => s + v * J[j][m], 0)));
    const Atr = [0, 1, 2, 3, 4, 5].map((i) => J[i].reduce((s, v, m) => s + v * o.res[m], 0));
    let improved = false;
    for (let tries = 0; tries < 6; tries++) {
      const A = AtA.map((r, i) => r.map((v, j) => v + (i === j ? lam * (AtA[i][i] + 1e-6) : 0)));
      const dx = solveLin(A, Atr); if (!dx) { lam *= 10; continue; }
      const xn = x.map((v, k) => v - dx[k]); const on = obj(toPose(xn)); const cn = on.res.reduce((s, v) => s + v * v, 0);
      if (cn < cost) { x = xn; o = on; const dc = cost - cn; cost = cn; lam = Math.max(1e-6, lam * 0.3); improved = true; if (dc < 1e-6 * (1 + cost)) it = 999; break; }
      lam *= 8;
    }
    if (!improved) break;
  }
  return { pose: toPose(x), cost, o };
}

/** contact target: pad centre for a key contact point P0 (rest pose, P frame) on key i at angle a, sphere radius r */
export function padTargetForKey(i, a, P0, r) {
  const p = keyPointP(i, a, P0); const n = keyNormalP(a);
  return add(p, scale(n, r));
}
export { KEYS, keyTopYAtP };
