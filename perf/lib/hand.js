// Hand model on the rig's own geometry (research/human.md section 5: the MakeHuman wrist pivot is ~2 cm proximal, so
// the solver never uses the performance.md hand model's link lengths; it uses rig.json + the skinned mesh).
//  - long fingers: MCP flex + abduction, PIP flex, DIP coupled to PIP (ratio c, 0.5..0.85, default 2/3)
//  - thumb: its own chain: CMC flex + CMC abduction (palmar), MCP flex, IP flex, axial pronation coupled to the CMC
//  - pad contact: a sphere fitted to the mesh vertices that touch the key in plausible playing orientations;
//    exact mesh contact is enforced afterwards by measuring the skinned pad vertices (refinePad)
import { qMul, qRot, qConj, qAxisAngle, add, sub, scale, dot, norm, cross, len, DEG, clamp, solveLin, qExp, bodyNoise } from './math.js';
import { FINGER_JOINTS, METACARPAL } from './rig.js';

export const LIMITS = {   // anatomical absolute angles (deg); research/performance.md 3.4 (rig hard limits)
  mcp: [-12, 88], pip: [0, 104], dip: [0, 78], abd: { 2: [-20, 20], 3: [-15, 15], 4: [-15, 15], 5: [-25, 25] },
  thumb: { cmcRel: [-30, 42], cmcAbd: [-20, 35], mcp: [-10, 55], ip: [-5, 75] },   // CMC flexion relative to the rig's rest
};
export const RELAXED = { mcp: 22 * DEG, pip: 40 * DEG, dipRatio: 0.67 };
/** the DIP never straightens below 5 deg (no broken knuckle), even on a flat, stretched finger */
export const DIP_MIN = 5 * DEG;
/** a pianist's thumb on this rig (absolute angles; sandbox/perf/probe_thumb2.mjs): along the key, pitched ~22 deg,
 * rolled ~60 deg onto its radial corner, IP slightly bent */
// cycle 2 fix 1 (critic: straight-stick thumb, MCP pinned at the 9 deg floor in 457 of 1297 thumb-on frames of the hand
// shots, IP < 8 on keys, no CMC opposition): an OPPOSED thumb prior - CMC flexed ~16 deg past the rig rest (-8.1) and
// palmarly abducted so the metacarpal turns under the palm, MCP ~20 and IP ~24 (sandbox/perf/r7/probe_thumb3.mjs: the
// pad reaches the same spot behind the index with MCP 20 / IP 25 as with MCP 9 / IP 35-50)
export const THUMB_PREF = { cmc: 8 * DEG, cmcAbd: 14 * DEG, mcp: 20 * DEG, ip: 24 * DEG, dpPitch: 25 * DEG, sideDown: 0.84 };   // fix round 2: mcp 16->18, dpPitch 22->25 (critic: flat stick thumb); cycle 2: cmcAbd 10->14, mcp 18->20, ip 22->24
/** fix round 1: the thumb MCP never hyperextends in the IK (critic: p50 1-3 deg, 1.2k poses below 0 on the -10 clamp);
 * reach comes from CMC flexion / palmar abduction and the palm instead */
export const THUMB_MCP_MIN = 14 * DEG;   // fix round 2: 3 -> 9 deg; cycle 2 fix 1: 9 -> 14 (the floor bound in most frames: the palm must take the reach)
/** cycle 2 fix 1: the thumb IP never straightens below 10 deg in the IK (critic: IP < 8 on a key in 201 frames) */
export const THUMB_IP_MIN = 10 * DEG;
/** cycle 2 fix round 2: posture-space thumb prior in the IK (CMC not laid back past the rig rest; PERF_OLD_THUMB=1 off) */
export const THUMB_POSTURE_IK = !process.env.PERF_OLD_THUMB;
export const THUMB_CMC_FLOOR = -8 * DEG;
/** contact PIP floor per finger (fix round 1: no straight stick fingers; a flatter 5th finger is fine) */
export const contactPip = (f) => (f === 5 ? [17 * DEG, 100 * DEG] : [16 * DEG, 100 * DEG]);   // fix round 2: f5 7 -> 17 deg (critic: 43 % of R5 held frames were a straight stick hinged at the knuckle)
/** fix round 2: relaxed / free finger abduction relative to the MakeHuman bind splay (deg; + = toward the little finger).
 * The bind is splayed (proximal phalanx 2-3 / 3-4 / 4-5 = 18.7 / 12.7 / 10.1 deg, index-to-little tip spread 117 mm): a
 * resting hand at the piano has its fingers close and nearly parallel (critic: 'starfish' hands from above). */
// cycle 2 fix 3 (critic: free-hand spread p50 96 / p90 107 mm in the hand shots, starfish from above; target 75-85):
// x1.3 (index at its 20 deg limit); probe_adduct.mjs: bind-palm tip spread 2-5 90 -> ~80 mm
export const ADDUCT = { 2: 20 * DEG, 3: 4 * DEG, 4: -9 * DEG, 5: -21 * DEG };   // index-to-little tip spread 118 -> ~80 mm (round 2: 16/3/-7/-16 = 90 mm)

export class HandModel {
  constructor(rig, side, mesh) {
    this.rig = rig; this.side = side; this.sfx = side === 'R' ? '_R' : '_L';
    const s = this.sfx; this.lat = side === 'R' ? -1 : 1;   // lateral sign: little-finger side of the RH is -x
    this.iWrist = rig.idx('wrist' + s); this.iForearm = rig.idx('lowerarm02' + s);
    this.fj = {}; for (let f = 1; f <= 5; f++) this.fj[f] = FINGER_JOINTS[f].map((n) => rig.idx(n + s));
    this.mc = {}; for (let f = 2; f <= 5; f++) this.mc[f] = rig.idx(METACARPAL[f] + s);
    this.info = {}; for (let f = 1; f <= 5; f++) this.info[f] = FINGER_JOINTS[f].map((n) => rig.hands[side].fingers[n + s]);
    this.J = rig.joints;
    this.handJoints = [this.iWrist, ...Object.values(this.mc), ...[1, 2, 3, 4, 5].flatMap((f) => this.fj[f])];
    // bind relations
    this.bindWristQ = rig.bindWQ[this.iWrist]; this.bindWristP = rig.bindWP[this.iWrist];
    // bind anatomical angles
    this.bindAngles = {};
    for (let f = 2; f <= 5; f++) { const I = this.info[f]; this.bindAngles[f] = { mcp: I[0].rest_flex_deg * DEG, abd: 0, pip: I[1].rest_flex_deg * DEG, dip: I[2].rest_flex_deg * DEG }; }
    const T = this.info[1]; this.bindAngles[1] = { cmc: T[0].rest_flex_deg * DEG, cmcAbd: 0, mcp: T[1].rest_flex_deg * DEG, ip: T[2].rest_flex_deg * DEG };
    if (mesh) this.buildMesh(mesh);
  }

  // ------------------------------------------------------------------ local rotations from anatomical angles
  localQ(f, k, flex, abd = 0, twist = 0) {
    // rig contract: q = q_bind * R(flex_axis, flex - rest) * R(abd_axis, abd) [* R_y(twist)]; unit axes cached
    const c = this._ax || (this._ax = {}); const key = f * 3 + k;
    let A = c[key];
    if (!A) { const I = this.info[f][k]; A = c[key] = { qb: this.J[this.fj[f][k]].q, fx: norm(I.flex_axis_local), ab: norm(I.abd_axis_local), rest: I.rest_flex_deg * DEG }; }
    const h = 0.5 * (flex - A.rest), s = Math.sin(h);
    let q = qMul(A.qb, [A.fx[0] * s, A.fx[1] * s, A.fx[2] * s, Math.cos(h)]);
    if (abd) { const h2 = 0.5 * abd, s2 = Math.sin(h2); q = qMul(q, [A.ab[0] * s2, A.ab[1] * s2, A.ab[2] * s2, Math.cos(h2)]); }
    if (twist) { const h3 = 0.5 * twist; q = qMul(q, [0, Math.sin(h3), 0, Math.cos(h3)]); }
    return q;
  }
  fingerLocals(f, a) {
    if (f === 1) {
      // axial pronation coupled to the CMC angles (performance.md 3.4): ~0.25 FE + 0.15 AA about the MC1 axis
      const tw = 0.25 * (a.cmc - this.bindAngles[1].cmc) + 0.15 * a.cmcAbd;
      return [this.localQ(1, 0, a.cmc, a.cmcAbd, this.lat * -tw), this.localQ(1, 1, a.mcp), this.localQ(1, 2, a.ip)];
    }
    return [this.localQ(f, 0, a.mcp, a.abd), this.localQ(f, 1, a.pip), this.localQ(f, 2, a.dip)];
  }
  /** world transforms of the finger's base parent (metacarpal or wrist) for a palm pose */
  baseOf(f, palm) {
    if (f === 1) return { q: palm.q, p: palm.p };
    const i = this.mc[f]; const j = this.J[i];
    const cup = palm.cup && palm.cup[f] ? palm.cup[f] : null;
    const lq = cup ? qMul(j.q, cup) : j.q;
    return { q: qMul(palm.q, lq), p: add(palm.p, qRot(palm.q, j.t)) };
  }
  /** FK of one finger: returns [{q,p} x 3] world transforms of the 3 joints */
  fingerFK(f, palm, a, base = null) {
    const b = base || this.baseOf(f, palm); const L = this.fingerLocals(f, a); const out = [];
    let q = b.q, p = b.p;
    for (let k = 0; k < 3; k++) { const j = this.J[this.fj[f][k]]; p = add(p, qRot(q, j.t)); q = qMul(q, L[k]); out.push({ q, p }); }
    return out;
  }
  /** pad point: the sphere centre for the long fingers; for the thumb its support point toward the keys (world down) */
  padCenter(f, fk) {
    const d = fk[2];
    if (this.support && this.support[f]) return add(d.p, qRot(d.q, this.supportLocal(f, qRot(qConj(d.q), [0, -1, 0]))));
    return add(d.p, qRot(d.q, this.pad[f].c));
  }
  /** tabulated support point (DP-local) for a DP-local direction toward the key (bilinear, clamped to the table) */
  supportLocal(f, dl) {
    const S = this.support[f];
    const a = Math.asin(clamp(dl[1], -1, 1)) / DEG; const b = Math.atan2(dot(dl, S.side), dot(dl, S.pal)) / DEG;
    const fa = clamp((a - S.A0) / S.st, 0, S.na - 1.000001), fb = clamp((b - S.B0) / S.st, 0, S.nb - 1.000001);
    const ia = Math.floor(fa), ib = Math.floor(fb), u = fa - ia, v = fb - ib; const T = S.tab, nb = S.nb;
    const o00 = (ia * nb + ib) * 3, o01 = o00 + 3, o10 = o00 + nb * 3, o11 = o10 + 3;
    const w00 = (1 - u) * (1 - v), w01 = (1 - u) * v, w10 = u * (1 - v), w11 = u * v;
    return [T[o00] * w00 + T[o01] * w01 + T[o10] * w10 + T[o11] * w11, T[o00 + 1] * w00 + T[o01 + 1] * w01 + T[o10 + 1] * w10 + T[o11 + 1] * w11, T[o00 + 2] * w00 + T[o01 + 2] * w01 + T[o10 + 2] * w10 + T[o11 + 2] * w11];
  }
  tip(f, fk) { const d = fk[2]; return add(d.p, qRot(d.q, [0, this.J[this.fj[f][2]].length, 0])); }

  // ------------------------------------------------------------------ mesh: pad spheres + skinning data for QC
  buildMesh(mesh) {
    const jn = mesh.jointNames; const rig = this.rig;
    const gidx = jn.map((n) => (rig.has(n) ? rig.idx(n) : -1));
    const handSet = new Set(this.handJoints);
    // vertices whose dominant joint belongs to this hand (fingers + palm), skinned data relative to the bind
    const verts = [];
    for (let v = 0; v < mesh.count; v++) {
      let wmax = 0, jmax = -1;
      for (let k = 0; k < 4; k++) { const w = mesh.weights[v * 4 + k]; if (w > wmax) { wmax = w; jmax = gidx[mesh.joints[v * 4 + k]]; } }
      if (!handSet.has(jmax)) continue;
      const P = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
      const inf = [];
      for (let k = 0; k < 4; k++) {
        const w = mesh.weights[v * 4 + k]; if (w < 1e-4) continue; const gi = gidx[mesh.joints[v * 4 + k]];
        inf.push({ j: gi, w, local: qRot(qConj(rig.bindWQ[gi]), sub(P, rig.bindWP[gi])) });
      }
      verts.push({ v, dom: jmax, P, inf });
    }
    this.verts = verts;
    // pad spheres per finger: the key-facing direction d (in DP-local coordinates) is sampled over plausible playing
    // orientations; the lowest vertices (max v.d) and their 0.6 mm ring are the contact candidates; a sphere is fitted.
    this.pad = {};
    const yAx = [0, 1, 0];
    for (let f = 1; f <= 5; f++) {
      const iD = this.fj[f][2];
      const dist = verts.filter((x) => x.dom === iD);
      const loc = dist.map((x) => qRot(qConj(rig.bindWQ[iD]), sub(x.P, rig.bindWP[iD])));
      const I = this.info[f][2];
      const pal = norm(cross(I.flex_axis_local, yAx));                 // palmar direction of the distal phalanx
      let side = norm(cross(yAx, pal));                                // perpendicular, in the abduction plane
      // orient `side` toward the radial side for the thumb (away from the index MCP)
      const idxMcp = rig.bindWP[this.fj[2][0]]; const toIdx = qRot(qConj(rig.bindWQ[iD]), sub(idxMcp, rig.bindWP[iD]));
      if (dot(toIdx, side) > 0) side = scale(side, -1);               // side now points away from the index (radial)
      const dirs = [];
      if (f === 1) {
        for (const pitch of [12, 20, 28, 36, 44]) for (const roll of [30, 40, 50, 60, 70]) {
          const p = pitch * DEG, r = roll * DEG;
          dirs.push(norm(add(scale(add(scale(pal, Math.cos(r)), scale(side, Math.sin(r))), Math.cos(p)), scale(yAx, Math.sin(p)))));
        }
      } else {
        for (const dpa of [45, 55, 65, 75, 85, 92]) for (const roll of [-12, -6, 0, 6, 12]) {
          const p = dpa * DEG, r = roll * DEG;
          dirs.push(norm(add(scale(add(scale(pal, Math.cos(r)), scale(side, Math.sin(r))), Math.cos(p)), scale(yAx, Math.sin(p)))));
        }
      }
      const cand = new Map();
      for (const d of dirs) {
        let best = -1e9; for (const p of loc) best = Math.max(best, dot(p, d));
        loc.forEach((p, k) => { if (dot(p, d) > best - 0.0006) cand.set(k, p); });
      }
      const pts = [...cand.values()];
      let sph = fitSphere(pts);
      if (f === 1) {
        // the thumb plays on the radial corner of a rolled tip: a sphere fitted over all plausible orientations is huge
        // (r ~ 28 mm, centre deep in the phalanx) and its lowest point wanders. The thumb's pad point is its SUPPORT
        // POINT: the tip's lowest point toward the keys for the current orientation, tabulated over DP-local directions
        // (pitch -20..80, roll -60..120 deg, 2.5 deg grid; soft-max lateral position, exact depth) and interpolated, so
        // it is smooth in the joint angles. Radius 0: the IK puts that point on the key.
        const A0 = -20, A1 = 80, B0 = -60, B1 = 120, st = 2.5, tau = 0.0004;
        const na = Math.round((A1 - A0) / st) + 1, nb = Math.round((B1 - B0) / st) + 1; const tab = new Float64Array(na * nb * 3);
        for (let ia = 0; ia < na; ia++) for (let ib = 0; ib < nb; ib++) {
          const a = (A0 + ia * st) * DEG, b = (B0 + ib * st) * DEG;
          const d = norm(add(scale(add(scale(pal, Math.cos(b)), scale(side, Math.sin(b))), Math.cos(a)), scale(yAx, Math.sin(a))));
          let mx = -1e9; for (const q of loc) { const v = dot(q, d); if (v > mx) mx = v; }
          let ws = 0, sx = 0, sy = 0, sz = 0;
          for (const q of loc) { const w = Math.exp((dot(q, d) - mx) / tau); if (w < 1e-6) continue; ws += w; sx += w * q[0]; sy += w * q[1]; sz += w * q[2]; }
          const s = [sx / ws, sy / ws, sz / ws]; const corr = mx - dot(s, d);
          const o = (ia * nb + ib) * 3; tab[o] = s[0] + d[0] * corr; tab[o + 1] = s[1] + d[1] * corr; tab[o + 2] = s[2] + d[2] * corr;
        }
        this.support = this.support || {}; this.support[f] = { tab, na, nb, A0, B0, st, pal, side };
        sph = { c: [0, 0, 0], r: 0 };
      }
      // contact candidates: for the thumb every distal vertex (its lowest point wanders over the rolled tip)
      this.pad[f] = { c: sph.c, r: sph.r, n: pts.length, cand: f === 1 ? dist : [...cand.keys()].map((k) => dist[k]), allDistal: dist, pal, side, dirs };
    }
  }
  /** skinned world position of a hand vertex record given world transforms (Q[], P[] indexed by rig joint) */
  skin(vr, Q, P) {
    let x = 0, y = 0, z = 0;
    for (const s of vr.inf) { const q = Q[s.j], p = P[s.j]; const r = qRot(q, s.local); x += s.w * (r[0] + p[0]); y += s.w * (r[1] + p[1]); z += s.w * (r[2] + p[2]); }
    return [x, y, z];
  }

  // ------------------------------------------------------------------ IK
  /**
   * Long finger IK: place the pad sphere centre at `target` (world). Unknowns mcp, abd, pip (dip = c * pip).
   * Returns {a, err (m), ok}. Warm start from `a0`.
   */
  solveFinger(f, palm, target, a0, c = RELAXED.dipRatio, base = null, bounds = null, abdCap = null) {
    // Hierarchical, branch-safe IK: (1) PIP from the MCP-to-pad distance (rotations about the MCP centre keep it), a
    // monotone 1-D problem on [pipMin, pipMax]; (2) MCP flexion + abduction point the chain at the target (2-D Newton).
    // With PIP at a bound the pad lands on the line MCP -> target (closest reachable point).
    const b = base || this.baseOf(f, palm);
    const j1 = this.J[this.fj[f][0]]; const mcpP = add(b.p, qRot(b.q, j1.t));
    const D = len(sub(target, mcpP));
    const distAt = (pip) => len(sub(this.padCenter(f, this.fingerFK(f, palm, { mcp: 0, abd: 0, pip, dip: Math.max(c * pip, DIP_MIN) }, b)), mcpP));
    const lo0 = bounds ? bounds[0] : 0, hi0 = bounds ? bounds[1] : 104 * DEG; let pip;
    const dLo = distAt(lo0), dHi = distAt(hi0);
    if (D >= dLo) pip = lo0; else if (D <= dHi) pip = hi0;
    else {
      // secant/bisection on the monotone distance (warm start from a0)
      let lo = lo0, hi = hi0; let x = a0 ? clamp(a0.pip, lo0 + 1e-3, hi0 - 1e-3) : 0.7;
      for (let it = 0; it < 40; it++) {
        const d = distAt(x); if (Math.abs(d - D) < 2e-7) break;
        if (d > D) lo = x; else hi = x;
        const h = 1e-4; const dd = (distAt(x + h) - d) / h;
        let xn = dd < -1e-6 ? x - (d - D) / dd : (lo + hi) / 2;
        if (!(xn > lo && xn < hi)) xn = (lo + hi) / 2;
        x = xn;
      }
      pip = x;
    }
    // pointing: find mcp, abd so that the pad centre lies at the target (the distance already matches); if PIP is at a
    // bound, aim at the point of the MCP->target line at the reachable distance instead
    const dReach = distAt(pip); const aimT = Math.abs(dReach - D) > 1e-5 ? add(mcpP, scale(sub(target, mcpP), dReach / Math.max(1e-9, D))) : target;
    // fix round 2: the free-finger cap is centred on the adducted rest (ADDUCT), not on the splayed bind
    const abL = LIMITS.abd[f]; const abC = abdCap ? ADDUCT[f] : 0; const abLo = Math.max(abL[0] * DEG, abdCap ? abC - abdCap : -9), abHi = Math.min(abL[1] * DEG, abdCap ? abC + abdCap : 9);   // anatomical abduction limits (free fingers: +-abdCap, fix round 1: no sideways splay)
    const mLo = LIMITS.mcp[0] * DEG, mHi = LIMITS.mcp[1] * DEG;                  // MCP flexion limits too: no broken knuckles
    let x = [a0 ? clamp(a0.mcp, mLo, mHi) : RELAXED.mcp, a0 ? clamp(a0.abd, abLo, abHi) : clamp(abC, abLo, abHi)];
    const F = (v) => this.padCenter(f, this.fingerFK(f, palm, { mcp: v[0], abd: v[1], pip, dip: Math.max(c * pip, DIP_MIN) }, b));
    let r = sub(F(x), aimT); let err = len(r);
    for (let it = 0; it < 20 && err > 1e-6; it++) {
      const h = 1e-4; const f0 = F(x);
      const c0 = scale(sub(F([x[0] + h, x[1]]), f0), 1 / h), c1 = scale(sub(F([x[0], x[1] + h]), f0), 1 / h);
      const AtA = [[dot(c0, c0) + 1e-9, dot(c0, c1)], [dot(c0, c1), dot(c1, c1) + 1e-9]];
      const Atr = [dot(c0, r), dot(c1, r)];
      const dx = solveLin(AtA, Atr); if (!dx) break;
      let step = 1, xn, rn, en;
      for (let ls = 0; ls < 8; ls++) { xn = [clamp(x[0] - step * dx[0], mLo, mHi), clamp(x[1] - step * dx[1], abLo, abHi)]; rn = sub(F(xn), aimT); en = len(rn); if (en < err) break; step *= 0.5; }
      if (en >= err) break;
      x = xn; r = rn; err = en;
    }
    const a = { mcp: x[0], abd: x[1], pip, dip: Math.max(c * pip, DIP_MIN) };
    return { a, err: len(sub(F(x), target)), ok: err < 0.0003 };
  }
  /**
   * Thumb IK: pad centre at target; 4 unknowns (cmc, cmcAbd, mcp, ip) with soft priors toward a relaxed thumb and a DP
   * pitch preference (side of the tip on the key, distal phalanx 15-35 deg below horizontal).
   */
  solveThumb(palm, target, a0, pref = null, free = false) {
    const B = this.bindAngles[1];
    void B;
    const P = pref || THUMB_PREF;
    let x = a0 ? [a0.cmc, a0.cmcAbd, a0.mcp, a0.ip] : [P.cmc, P.cmcAbd, P.mcp, P.ip];
    const fk = (v) => this.fingerFK(1, palm, { cmc: v[0], cmcAbd: v[1], mcp: v[2], ip: v[3] });
    const wPos = 1, wReg = 0.004, wPitch = 0.006, wRoll = 0.012;   // metres vs radians balance
    const sideL = this.pad[1].side;
    const lat = this.lat; const wYaw = 0.02, yLo = -14 * DEG, yHi = 20 * DEG;
    const cmcF = Math.min(THUMB_CMC_FLOOR, P.cmc - 4 * DEG);   // (a keyframe that opened the CMC for a span keeps it)
    const res = (v) => {
      const k = fk(v); const c = this.padCenter(1, k); const d = sub(c, target);
      const dir = qRot(k[2].q, [0, 1, 0]); const pitch = Math.asin(clamp(-dir[1], -1, 1));
      const sideDown = -qRot(k[2].q, sideL)[1];      // radial side of the tip toward the key: 0.82 = rolled 55 deg
      // DP heading along the key (toward the fingers +): outside [-6, 15] deg the tip would reach over a neighbour key
      const yaw = Math.atan2(dir[0] * lat, dir[2]); const yb = yaw < yLo ? yaw - yLo : yaw > yHi ? yaw - yHi : 0;
      const out = [d[0] * wPos, d[1] * wPos, d[2] * wPos, (v[0] - P.cmc) * wReg, (v[1] - P.cmcAbd) * wReg, (v[2] - P.mcp) * wReg, (v[3] - P.ip) * wReg * 0.7, (pitch - P.dpPitch) * wPitch, (sideDown - (P.sideDown ?? 0.75)) * wRoll, yb * wYaw];
      if (THUMB_POSTURE_IK) {
        // cycle 2 fix round 2 (critical: pointer thumb = CMC laid back, MCP-to-tip line horizontal): the redundant chain
        // prefers CMC >= the rig rest (-8 deg) and the MCP-to-tip line >= 22 deg down (the min-norm polish keeps the contact)
        const tp = this.tip(1, k); const w = sub(tp, k[1].p); const lp = Math.asin(clamp(-w[1] / Math.max(1e-9, len(w)), -1, 1));
        // (g2a: weights 0.02 per rad traded 1.5-2.5 mm of thumb contact before the polish (5 thumb notes > 1.5 mm, a 10.9 mm hold)
        // -> 0.006, and the final polish runs 10 steps)
        out.push((v[0] < cmcF ? v[0] - cmcF : 0) * 0.006, (lp < 22 * DEG ? lp - 22 * DEG : 0) * 0.006);
      }
      return out;
    };
    // cycle 2 fix round 2 (bar 22, S08 m 66.8: thumb-on-black chords made reach-limited by the global MCP/IP floors): a
    // per-note prior may carry its own floors (the keyframe's own angles, solver.js thumbSeq; the rescue's loose prior)
    const clampX = this.thumbClamp(P.mcpMin, P.ipMin); x = clampX(x);
    const lm = (x) => {
      let r = res(x); let cost = r.reduce((s, v) => s + v * v, 0);
      for (let it = 0; it < 25; it++) {
        const h = 1e-4; const J = [];
        for (let k = 0; k < 4; k++) { const y = x.slice(); y[k] += h; const ry = res(y); J.push(ry.map((v, m) => (v - r[m]) / h)); }
        const lam = 1e-7;
        const AtA = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => J[i].reduce((s, v, m) => s + v * J[j][m], 0) + (i === j ? lam : 0)));
        const Atr = [0, 1, 2, 3].map((i) => J[i].reduce((s, v, m) => s + v * r[m], 0));
        let dx = solveLin(AtA, Atr); if (!dx) break;
        // free thumb: a joint held at its limit by the clamp is frozen and the step re-solved for the others (the clipped
        // step otherwise stalls the whole chain: pinned at its MCP limit 15-33 mm short of its hover while the hand moved)
        if (free) { const xc = clampX(x.map((v, k) => v - dx[k])); const fr = [0, 1, 2, 3].filter((k) => Math.abs(xc[k] - x[k]) < 1e-9 && Math.abs(dx[k]) > 1e-9);
          if (fr.length && fr.length < 4) { for (const k of fr) { for (let j = 0; j < 4; j++) { AtA[k][j] = 0; AtA[j][k] = 0; } AtA[k][k] = 1; Atr[k] = 0; } const d2 = solveLin(AtA, Atr); if (d2) dx = d2; } }
        let step = 1, xn, rn, cn;
        for (let ls = 0; ls < 8; ls++) { xn = clampX(x.map((v, k) => v - step * dx[k])); rn = res(xn); cn = rn.reduce((s, v) => s + v * v, 0); if (cn < cost) break; step *= 0.5; }
        if (cn >= cost - 1e-16) break;
        const imp = cost - cn; x = xn; r = rn; cost = cn;
        if (imp < 1e-13 + 2e-4 * cost) break;   // converged (relative improvement < 0.02 %)
      }
      return { x, cost };
    };
    // warm start, and (when a posture prior is given) also from the prior itself: the warm start can sit in another
    // basin of the redundant chain (e.g. coming out of a hover) and stall short of the target
    let best = lm(x);
    if (pref && a0) {
      const e1 = len(sub(this.padCenter(1, fk(best.x)), target));
      // hysteresis (fix round 1): the restart only wins when it is clearly better, so consecutive samples do not
      // flip-flop between two basins of the redundant chain (a 40-55 deg thumb pop); a free thumb stalled more than 5 mm
      // short takes any better restart
      if (e1 > 0.0003) { const b2 = lm(clampX([P.cmc, P.cmcAbd, P.mcp, P.ip])); if (b2.cost < (free && e1 > 0.005 ? 1 : 0.6) * best.cost) best = b2; }
    }
    return this.polishThumb(palm, target, best.x, 10);
  }
  /**
   * Thumb re-projection: from the angles x0 ([cmc, cmcAbd, mcp, ip] or {cmc,...}) take minimum-norm steps until the
   * support point sits on `target` (the solution NEAREST to x0: continuous when x0 is continuous). Returns {a, err, ok}.
   */
  polishThumb(palm, target, x0, iters = 6) {
    let x = Array.isArray(x0) ? x0.slice() : [x0.cmc, x0.cmcAbd, x0.mcp, x0.ip];
    // (cycle 2 fix round 2: the re-projection never raises MCP/IP above the input's own angles: no floor pop)
    const clampX = this.thumbClamp(Math.min(THUMB_MCP_MIN, x[2]), Math.min(THUMB_IP_MIN, x[3])); x = clampX(x);
    const fk = (v) => this.fingerFK(1, palm, { cmc: v[0], cmcAbd: v[1], mcp: v[2], ip: v[3] });
    for (let it = 0; it < iters; it++) {
      const c0 = this.padCenter(1, fk(x)); const d = sub(c0, target); if (len(d) < 2e-6) break;
      const h = 1e-4; const J = [];
      for (let k = 0; k < 4; k++) { const y = x.slice(); y[k] += h; J.push(scale(sub(this.padCenter(1, fk(y)), c0), 1 / h)); }
      // minimum-norm step: dx = J^T (J J^T + l I)^-1 d
      const JJt = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J.reduce((s, col) => s + col[a] * col[b], 0) + (a === b ? 1e-9 : 0)));
      const y = solveLin(JJt, d); if (!y) break;
      const xn = clampX(x.map((v, k) => v - (J[k][0] * y[0] + J[k][1] * y[1] + J[k][2] * y[2])));
      if (len(sub(this.padCenter(1, fk(xn)), target)) >= len(d)) break;
      x = xn;
    }
    const a = { cmc: x[0], cmcAbd: x[1], mcp: x[2], ip: x[3] };
    const err = len(sub(this.padCenter(1, fk(x)), target));
    return { a, err, ok: err < 0.0003 };
  }
  /** clamp of the thumb's IK variables: anatomical limits, MCP never below THUMB_MCP_MIN (no hyperextended thumb) */
  thumbClamp(mcpMin = THUMB_MCP_MIN, ipMin = THUMB_IP_MIN) {
    if (mcpMin === undefined) mcpMin = THUMB_MCP_MIN; if (ipMin === undefined) ipMin = THUMB_IP_MIN;
    const glob = mcpMin >= THUMB_MCP_MIN && ipMin >= THUMB_IP_MIN; if (glob && this._tc) return this._tc; const lim = this.thumbLimits();
    const lo = [lim.cmc[0] * DEG, lim.cmcAbd[0] * DEG, Math.max(lim.mcp[0] * DEG, glob ? THUMB_MCP_MIN : mcpMin), Math.max(lim.ip[0] * DEG, glob ? THUMB_IP_MIN : ipMin)], hi = [lim.cmc[1] * DEG, lim.cmcAbd[1] * DEG, lim.mcp[1] * DEG, lim.ip[1] * DEG];
    const fn = (v) => [clamp(v[0], lo[0], hi[0]), clamp(v[1], lo[1], hi[1]), clamp(v[2], lo[2], hi[2]), clamp(v[3], lo[3], hi[3])];
    if (glob) this._tc = fn; return fn;
  }
  /** absolute thumb limits (deg) for this rig (CMC flexion is defined relative to the rig's rest flexion) */
  thumbLimits() { const L = LIMITS.thumb; const r = this.bindAngles[1].cmc / DEG; return { cmc: [r + L.cmcRel[0], r + L.cmcRel[1]], cmcAbd: L.cmcAbd, mcp: L.mcp, ip: L.ip }; }
  /** relaxed (non-playing) finger angles; thumb relaxed beside the index */
  relaxed(f, s = 1, t = null, abdDev = 0) {
    // fix round 1: a natural cascade (MCP rising from the index to the little finger, PIP 34-46, DIP 0.67 PIP) with a
    // slow, small per-finger drift (seeded smooth noise) so resting fingers are never frozen in one canned pose
    const v = t === null ? 0 : bodyNoise(t * 0.8 + 3.1 * f, 70 + f) * DEG;
    if (f === 1) return { cmc: 6 * DEG + v, cmcAbd: 12 * DEG, mcp: 20 * DEG + 0.6 * v, ip: 28 * DEG + v };   // cycle 2: opposed, bent (was cmc 5 / abd 8 / mcp 16 / ip 26)
    const mcp = ([0, 0, 17, 21, 25, 29][f] * DEG + 2.5 * v) * s, pip = ([0, 0, 36, 40, 44, 42][f] * DEG + 3 * v) * s;
    // fix round 2: adducted toward the middle finger (ADDUCT), plus the neighbours' pull (juncturae tendinum, abdDev)
    return { mcp, abd: ADDUCT[f] + 0.4 * v + (abdDev || 0), pip, dip: RELAXED.dipRatio * pip };
  }
}

/** algebraic least-squares sphere fit */
export function fitSphere(pts) {
  // |p|^2 = 2 c.p + (r^2 - |c|^2)  ->  linear in (cx, cy, cz, d)
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
  for (const p of pts) {
    const row = [2 * p[0], 2 * p[1], 2 * p[2], 1]; const rhs = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
    for (let i = 0; i < 4; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; }
  }
  const s = solveLin(A, b); const c = [s[0], s[1], s[2]]; const r = Math.sqrt(Math.max(1e-8, s[3] + dot(c, c)));
  return { c, r };
}
export { qExp, norm, cross };
