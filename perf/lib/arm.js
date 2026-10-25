// Arm IK on the rig (research/performance.md 8.5): shoulder from the torso FK, wrist pose from the palm planner.
// The elbow is a hinge: the upper-arm rotation is chosen so the bind hinge axis maps onto the new S-E-W plane normal,
// then the forearm rotates about that hinge only. Pronation/supination is split 0.5/0.5 over lowerarm01 and the twist
// bone lowerarm02 about their local +Y (rig contract); the wrist bone takes the remaining flexion/deviation.
import { qMul, qRot, qConj, qAxisAngle, qFromBasis, add, sub, scale, dot, norm, cross, len, clamp, qNorm } from './math.js';
import { elbowPos } from './palm.js';

export class ArmModel {
  constructor(rig, side, names = null) {
    this.rig = rig; this.side = side; const s = side === 'R' ? '_R' : '_L'; this.lat = side === 'R' ? -1 : 1;
    const N = names || { root: 'upperarm01', twist1: 'upperarm02', mid: 'lowerarm01', twist2: 'lowerarm02', end: 'wrist' };
    this.iUa1 = rig.idx(N.root + s); this.iUa2 = rig.idx(N.twist1 + s);
    this.iLa1 = rig.idx(N.mid + s); this.iLa2 = rig.idx(N.twist2 + s); this.iW = rig.idx(N.end + s);
    this.iSh = rig.joints[this.iUa1].parent;
    const P = rig.bindWP; this.S0 = P[this.iUa1]; this.E0 = P[this.iLa1]; this.W0 = P[this.iW];
    this.L1 = len(sub(this.E0, this.S0)); this.L2 = len(sub(this.W0, this.E0));
    // bind hinge axis (world) and in upperarm01's bind frame
    const u0 = norm(sub(this.E0, this.S0)), f0 = norm(sub(this.W0, this.E0));
    this.hinge0 = norm(cross(u0, f0));
    this.u0 = u0; this.f0 = f0;
    this.bindElbowAngle = Math.acos(clamp(dot(u0, f0), -1, 1));
  }
  /**
   * Solve the arm for the current parent pose. W: Float pos[3], Qw: wrist world quat, swivel (rad, + outward).
   * Q/P: world transforms from FK of everything above upperarm01 (clavicle, shoulder01 already set in local[]).
   * local: array of local quats (mutated for upperarm01, lowerarm01, lowerarm02, wrist).
   */
  solve(local, Q, P, W, Qw, swivel, twistShare = [0.5, 0.5]) {
    const rig = this.rig, J = rig.joints;
    // shoulder joint world position with the current parents
    const pSh = this.iSh; const S = add(P[pSh], qRot(Q[pSh], J[this.iUa1].t));
    const E = elbowPos(S, W, this.L1, this.L2, swivel, this.lat);
    const u = norm(sub(E, S)), f = norm(sub(W, E));
    let h = cross(u, f); if (len(h) < 1e-6) h = this.hinge0; h = norm(h);
    // keep the hinge orientation consistent with the bind (flexion direction)
    if (dot(h, this.hinge0) < -0.5 && len(cross(u, f)) < 1e-3) h = scale(h, -1);
    // upper arm world rotation: bind basis (u0, hinge0, u0 x hinge0) -> (u, h, u x h)
    const Bb = [this.u0, this.hinge0, cross(this.u0, this.hinge0)], Bn = [u, h, cross(u, h)];
    const Rb = qFromBasis(Bb[0], Bb[1], Bb[2]), Rn = qFromBasis(Bn[0], Bn[1], Bn[2]);
    const R = qMul(Rn, qConj(Rb));                              // world delta
    const ua1World = qMul(R, rig.bindWQ[this.iUa1]);
    local[this.iUa1] = qNorm(qMul(qConj(Q[pSh]), ua1World));
    Q[this.iUa1] = ua1World; P[this.iUa1] = S;
    // upperarm02 (twist bone) stays at bind local
    local[this.iUa2] = J[this.iUa2].q;
    Q[this.iUa2] = qMul(Q[this.iUa1], local[this.iUa2]); P[this.iUa2] = add(S, qRot(Q[this.iUa1], J[this.iUa2].t));
    // forearm: bind relation rotated about the hinge to the new elbow angle
    const la1Bind = qMul(Q[this.iUa2], J[this.iLa1].q); const Ecur = add(P[this.iUa2], qRot(Q[this.iUa2], J[this.iLa1].t));
    // current forearm direction with bind local = direction to the wrist computed through lowerarm02
    const la2Bind = qMul(la1Bind, J[this.iLa2].q); const la2P = add(Ecur, qRot(la1Bind, J[this.iLa2].t));
    const Wcur = add(la2P, qRot(la2Bind, J[this.iW].t));
    const fc = norm(sub(Wcur, Ecur));
    const ang = Math.atan2(dot(cross(fc, f), h), dot(fc, f));
    const la1World = qMul(qAxisAngle(h, ang), la1Bind);
    // pronation: twist about the forearm axis so the wrist needs only flexion/deviation
    const la2World0 = qMul(la1World, J[this.iLa2].q);
    const wristWorld0 = qMul(la2World0, J[this.iW].q);
    const D = qMul(Qw, qConj(wristWorld0));                     // world delta still needed at the wrist
    const tw = twistAngle(D, f);
    const la1W = qMul(qAxisAngle(f, tw * twistShare[0]), la1World);
    local[this.iLa1] = qNorm(qMul(qConj(Q[this.iUa2]), la1W));
    Q[this.iLa1] = la1W; P[this.iLa1] = Ecur;
    const la2W = qMul(qAxisAngle(f, tw * (twistShare[0] + twistShare[1])), la2World0);
    local[this.iLa2] = qNorm(qMul(qConj(la1W), la2W));
    Q[this.iLa2] = la2W; P[this.iLa2] = add(Ecur, qRot(la1W, J[this.iLa2].t));
    local[this.iW] = qNorm(qMul(qConj(la2W), Qw));
    Q[this.iW] = Qw; P[this.iW] = add(P[this.iLa2], qRot(la2W, J[this.iW].t));
    return { S, E, W: P[this.iW], wristErr: len(sub(P[this.iW], W)), twist: tw, elbowAngle: Math.acos(clamp(dot(u, f), -1, 1)) };
  }
}
/** twist angle of quaternion q about unit axis a (swing-twist decomposition) */
export function twistAngle(q, a) {
  const p = dot([q[0], q[1], q[2]], a); const t = [a[0] * p, a[1] * p, a[2] * p, q[3]]; const l = Math.hypot(...t);
  if (l < 1e-9) return 0; let ang = 2 * Math.atan2(p / l, t[3] / l); if (ang > Math.PI) ang -= 2 * Math.PI; if (ang < -Math.PI) ang += 2 * Math.PI; return ang;
}
