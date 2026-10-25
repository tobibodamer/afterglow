// Feet: the right foot rests its ball on the sustain pedal and follows the pedal travel by rotating about the planted
// heel (2-bone leg IK keeps the knee plane); the left foot rests flat. Geometry from the shoe mesh in the bind pose.
import { ArmModel } from './arm.js';
import { elbowPos } from './palm.js';
import { qAxisAngle, qMul, qConj, add, sub, qRot, len, DEG } from './math.js';
import { PEDALS, PEDAL_MAX_RAD, toP, fromP, LAYOUT_MODULE as LY } from './pianoGeo.js';

const USE_TOE_FLEX = false;   // fix round 3: see solveFootToe

export class LegModel {
  constructor(rig, shoes) {
    this.rig = rig;
    this.leg = new ArmModel(rig, 'R', { root: 'upperleg01', twist1: 'upperleg02', mid: 'lowerleg01', twist2: 'lowerleg02', end: 'foot' });
    const A = this.leg; let best = 0, bd = 1e9;
    for (let sw = -180; sw <= 180; sw += 0.25) { const e = elbowPos(A.S0, A.W0, A.L1, A.L2, sw * DEG, A.lat); const d = len(sub(e, A.E0)); if (d < bd) { bd = d; best = sw; } }
    this.swivel = best * DEG; this.swivelErr = bd;
    this.iFoot = rig.idx('foot_R');
    const ped = PEDALS[2]; const tip = toP(ped.tip), piv = toP(ped.pivot);
    this.ped = { x: tip[0], tipZ: tip[2], pivY: piv[1], pivZ: piv[2], treadY: ped.treadY, len: 0.110 };
    // right shoe sole vertices over the pedal footprint + heel
    let V = []; this.toeW = new Map();
    // fix round 3: the shoe's forefoot is skinned to toe1-1_R (1009 of 3504 right-shoe vertices): its weight per vertex
    const toeJ = shoes ? shoes.jointNames.indexOf('toe1-1_R') : -1;
    if (shoes) for (let v = 0; v < shoes.count; v++) { const p = [shoes.positions[v * 3], shoes.positions[v * 3 + 1], shoes.positions[v * 3 + 2]]; if (p[0] < 0) { V.push(p); let wt = 0; for (let k = 0; k < 4; k++) if (shoes.joints[v * 4 + k] === toeJ) wt += shoes.weights[v * 4 + k]; this.toeW.set(p, wt); } }
    if (!V.length) V = [[-0.08, 0.075, 0.19]];
    const minY = Math.min(...V.map((p) => p[1]));
    this.heel = V.filter((p) => p[1] < minY + 0.01).reduce((a, b) => (b[2] < a[2] ? b : a));
    this.sole = V.filter((p) => Math.abs(p[0] - this.ped.x) < 0.024 && p[2] > this.ped.tipZ - 0.01 && p[2] < this.ped.tipZ + this.ped.len && p[1] < this.ped.treadY + 0.03);
    // fix round 3 (critic f2c: the shoe hovered 4-10 mm over the tread in all 3472 poses): the foot is solved against the
    // EXACT pedal top of layout.js (curved pad, pedalTreadYAt, rotated about the real pivot) over the tread polygon, plus
    // the rounded nose in front of it, with every right-shoe vertex that can reach it (not a flat treadY plane over a
    // 48 mm wide strip)
    this.soleX = V.filter((p) => Math.abs(p[0] - this.ped.x) < 0.035 && p[1] < this.ped.treadY + 0.05);
    this.pd = LY.PEDALS[2]; this.zT = LY.PEDALS[2].tip[2] + LY.PEDAL_SHAPE.nose;
    this.iToe = rig.has('toe1-1_R') ? rig.idx('toe1-1_R') : -1; this.toeP = this.iToe >= 0 ? rig.bindWP[this.iToe] : null;
    // table: pedal angle -> foot rotation about the heel (toe-down +) that just keeps the sole on the tread
    this.table = []; this.toeTable = [];
    // (the forefoot flex, solveFootToe, is NOT used: it only reaches 2.1-3.7 mm over the tread, swings the toe box 16 deg
    // within the last quarter of the stroke and needs a toe1-1_R output channel; kept for a later round)
    for (let k = 0; k <= 32; k++) { const a = PEDAL_MAX_RAD.sustain * k / 32; const b = USE_TOE_FLEX ? this.solveFootToe(a) : { phi: this.solvePhi(a, 0), psi: 0 }; this.table.push(b.phi); this.toeTable.push(b.psi); }
    this.restPhi = this.table[0];
  }
  treadYAt(z, a) { // tread top surface height at plan z for pedal angle a (rotation about the pivot, tip down)
    const yy = this.ped.treadY - this.ped.pivY, zz = z - this.ped.pivZ; const c = Math.cos(a), s = Math.sin(a);
    // point on the rest tread at zr maps to (pivY + yy c + zz s, pivZ - yy s + zz c); invert approximately for z
    const zr = this.ped.pivZ + (zz + yy * s) / c; const zzr = zr - this.ped.pivZ;
    return this.ped.pivY + yy * c + zzr * s;
  }
  penetration(phi, a) {
    const H = this.heel; let worst = -1;
    for (const p of this.sole) {
      const dy = p[1] - H[1], dz = p[2] - H[2]; const y = H[1] + dy * Math.cos(phi) - dz * Math.sin(phi), z = H[2] + dy * Math.sin(phi) + dz * Math.cos(phi);
      if (z < this.ped.tipZ - 0.002 || z > this.ped.tipZ + this.ped.len) continue;
      worst = Math.max(worst, this.treadYAt(z, a) - y);
    }
    return worst;
  }
  /** fix round 3: smallest height of the rotated sole above the real pedal top (tread polygon + nose), pedal frame */
  gapExact(phi, a, psi = 0) {
    const H = this.heel; const c = Math.cos(phi), s = Math.sin(phi); let gTread = Infinity, gNose = Infinity; const PD = this.pd;
    const cp = Math.cos(psi), sp = Math.sin(psi); const Tp = this.toeP;
    for (const p0 of this.soleX) {
      // linear-blend skin of the toe flex (rotation psi about the toe joint, world x axis, before the foot rotation)
      let p = p0; const wt = psi && Tp ? this.toeW.get(p0) || 0 : 0;
      if (wt > 0) { const ty = p0[1] - Tp[1], tz = p0[2] - Tp[2]; const q = [p0[0], Tp[1] + ty * cp - tz * sp, Tp[2] + ty * sp + tz * cp]; p = [p0[0], p0[1] + wt * (q[1] - p0[1]), p0[2] + wt * (q[2] - p0[2])]; }
      const dy = p[1] - H[1], dz = p[2] - H[2]; const P = [p[0], H[1] + dy * c - dz * s, H[2] + dy * s + dz * c];
      const r = LY.pedalPoint(2, -a, fromP(P));   // the pressed pedal rotated back to its rest pose, piano frame
      if (pointInPoly(PD.tread, r[0], r[2])) gTread = Math.min(gTread, r[1] - LY.pedalTreadYAt(r[2]));
      else if (r[2] < this.zT && r[2] > PD.tip[2] && Math.abs(r[0] - PD.x) < 0.5 * LY.pedalSection(this.zT).w) {
        const sec = LY.pedalSection(this.zT); const u = (this.zT - r[2]) / LY.PEDAL_SHAPE.nose; const yN = sec.yTop - 0.5 * sec.thick * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
        gNose = Math.min(gNose, r[1] - yN);
      }
    }
    return { gTread, gNose };
  }
  /** fix round 3: foot rotation phi and forefoot flex psi together: for psi in 0..20 deg the largest toe-down phi that
   * keeps the sole out of the pedal, then the pair whose lowest sole vertex over the tread is closest to 0.25 mm */
  solveFootToe(a) {
    let best = { phi: this.solvePhi(a, 0), psi: 0 }; best.g = this.gapExact(best.phi, a, 0).gTread;
    if (this.toeP) for (let d = 2; d <= 20; d += 2) { const psi = d * DEG; const phi = this.solvePhi(a, psi); const g = this.gapExact(phi, a, psi).gTread; if (g < best.g - 1e-5) best = { phi, psi, g }; }
    return best;
  }
  solvePhi(a, psi = 0) {
    // fix round 3: largest toe-down rotation with the lowest sole vertex over the tread >= 0.25 mm above it and nothing
    // in the nose: bisection on [-15, +15] deg (the old flat-plane test left the sole 4-10 mm above the real tread)
    const bad = (phi) => { const g = this.gapExact(phi, a, psi); return g.gTread < 0.00025 || g.gNose < 0.0001; };
    let lo = -15 * DEG, hi = 15 * DEG;
    if (bad(lo)) return lo;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (bad(m)) hi = m; else lo = m; }
    return lo;
  }
  /** fix round 3: with the heel planted the rigid shoe meets only the pedal's nose (the sole rises ~27 deg from the heel,
   * the tread is nearly flat: a 2.5-6.7 mm wedge over the tread). The forefoot flexes at the ball (toe1-1_R, toe-down,
   * <= 20 deg) until its sole rests on the tread (lowest vertex over the tread 0.25 mm, nothing in the nose) */
  solvePsi(phi, a) {
    if (!this.toeP) return 0;
    const bad = (psi) => { const g = this.gapExact(phi, a, psi); return g.gTread < 0.00025 || g.gNose < 0.0001; };
    let lo = 0, hi = 20 * DEG; if (bad(lo)) return 0; if (!bad(hi)) return hi;
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (bad(m)) hi = m; else lo = m; }
    return lo;
  }
  psiFor(travel) { const x = Math.max(0, Math.min(1, travel)) * 32; const i = Math.min(31, Math.floor(x)); const f = x - i; return this.toeTable[i] + (this.toeTable[i + 1] - this.toeTable[i]) * f; }
  phiFor(travel) { const x = Math.max(0, Math.min(1, travel)) * 32; const i = Math.min(31, Math.floor(x)); const f = x - i; return this.table[i] + (this.table[i + 1] - this.table[i]) * f; }
  /** set the right leg locals for the pedal travel (0..1) */
  apply(local, travel, delta = null) {
    const rig = this.rig; const phi = this.phiFor(travel);
    const R = qAxisAngle([1, 0, 0], phi);
    const A0 = rig.bindWP[this.iFoot]; const W = add(this.heel, qRot(R, sub(A0, this.heel)));
    const Qw = qMul(R, rig.bindWQ[this.iFoot]);
    // the hip may have slid with the pelvis (delta, world): the foot target stays on the pedal
    const Q = rig.bindWQ.slice(), P = delta ? rig.bindWP.map((p) => add(p, delta)) : rig.bindWP.slice();
    const r = this.leg.solve(local, Q, P, W, Qw, this.swivel);
    // fix round 3: forefoot flex at the ball (local = conj(bind foot) * Rx(psi) * bind toe; both rotations are about x)
    if (USE_TOE_FLEX && this.iToe >= 0) local[this.iToe] = qMul(qConj(rig.bindWQ[this.iFoot]), qMul(qAxisAngle([1, 0, 0], this.psiFor(travel)), rig.bindWQ[this.iToe]));
    return r;
  }
}
function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; }
  return inside;
}
