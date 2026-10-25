// Assemble full-skeleton local rotations from body offsets, palm poses (arm IK) and finger angles.
import { ArmModel } from './arm.js';

export class PoseBuilder {
  constructor(rig, hands) {
    this.rig = rig; this.hands = hands; this.arms = { R: new ArmModel(rig, 'R'), L: new ArmModel(rig, 'L') };
  }
  /**
   * body: { local: Map(jointIndex -> quat) } (spine, neck, head, clavicles, shoulders, legs...), root: [x,y,z] or null
   * hands: { R: {palm:{q,p}, angles:{1..5}, swivel, twistShare}, L: ... }
   * returns { local, Q, P, arm: {R, L} }
   */
  build(body, handsState) {
    const rig = this.rig; const local = rig.joints.map((j) => j.q);
    if (body && body.local) for (const [i, q] of body.local) local[i] = q;
    const fk = rig.fk(local, body && body.root);
    const Q = fk.q, P = fk.p; const arm = {};
    for (const side of ['R', 'L']) {
      const hs = handsState && handsState[side]; if (!hs) continue;
      arm[side] = this.arms[side].solve(local, Q, P, hs.palm.p, hs.palm.q, hs.swivel ?? 0.6, hs.twistShare);
      const H = this.hands[side];
      if (hs.cup) for (const f of [4, 5]) if (hs.cup[f]) { const i = H.mc[f]; local[i] = qMulLocal(rig.joints[i].q, hs.cup[f]); }
      for (let f = 1; f <= 5; f++) {
        const a = hs.angles[f]; if (!a) continue;
        const L3 = H.fingerLocals(f, a); H.fj[f].forEach((i, k) => { local[i] = L3[k]; });
      }
    }
    const fk2 = rig.fk(local, body && body.root);
    return { local, Q: fk2.q, P: fk2.p, arm };
  }
}
import { qMul } from './math.js';
const qMulLocal = (a, b) => qMul(a, b);
