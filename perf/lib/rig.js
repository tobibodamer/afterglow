// Pianist skeleton from rig.json (research/human.md section 5): bind local TRS, FK, anatomical joint angles.
// Frame: the GLB/pianist frame (floor y = 0, white-key front plane z = 0, keyboard centre x = 0, faces +Z,
// right hand (treble) at -X).
import fs from 'node:fs';
import { qMul, qRot, qAxisAngle, add, DEG, norm } from './math.js';

export class Rig {
  constructor(json) {
    this.json = json;
    this.joints = json.joints.map((j) => ({ name: j.name, parentName: j.parent, t: j.t.slice(), q: j.q.slice(), worldPos: j.world_pos.slice(), length: j.length }));
    this.index = new Map(this.joints.map((j, i) => [j.name, i]));
    for (const j of this.joints) j.parent = j.parentName == null ? -1 : this.index.get(j.parentName);
    // topological order check
    this.joints.forEach((j, i) => { if (j.parent >= i) throw new Error(`rig order: ${j.name} before its parent`); });
    this.children = this.joints.map(() => []);
    this.joints.forEach((j, i) => { if (j.parent >= 0) this.children[j.parent].push(i); });
    this.n = this.joints.length;
    this.hands = json.hands;
    // bind world transforms
    const w = this.fk(null);
    this.bindWQ = w.q; this.bindWP = w.p;
  }
  static load(path) { return new Rig(JSON.parse(fs.readFileSync(path, 'utf8'))); }
  idx(name) { const i = this.index.get(name); if (i === undefined) throw new Error(`no joint ${name}`); return i; }
  has(name) { return this.index.has(name); }
  /** full FK. localQ: array (length n) of quats or null (bind); rootPos optional translation of the root joint. */
  fk(localQ, rootPos = null) {
    const n = this.n, q = new Array(n), p = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = this.joints[i]; const lq = (localQ && localQ[i]) || j.q;
      if (j.parent < 0) { q[i] = lq; p[i] = rootPos ? rootPos.slice() : j.t.slice(); }
      else { const pq = q[j.parent]; q[i] = qMul(pq, lq); p[i] = add(p[j.parent], qRot(pq, j.t)); }
    }
    return { q, p };
  }
  /** FK for a sub-tree under joint `top`, given the world transform of top's PARENT (pq, pp) and local quats. */
  fkFrom(top, pq, pp, localQ, outQ, outP) {
    const stack = [top];
    while (stack.length) {
      const i = stack.pop(); const j = this.joints[i];
      const parQ = i === top ? pq : outQ[j.parent], parP = i === top ? pp : outP[j.parent];
      const lq = (localQ && localQ[i]) || j.q;
      outQ[i] = qMul(parQ, lq); outP[i] = add(parP, qRot(parQ, j.t));
      for (const c of this.children[i]) stack.push(c);
    }
  }
  /** tip of a leaf joint: joint + local +Y * length (rig contract) */
  tipLocal(i) { return [0, this.joints[i].length, 0]; }
  /** anatomical finger/thumb angles -> local quaternion (rig contract formula, angles in radians, absolute flexion) */
  fingerQuat(side, name, flex, abd = 0, twist = 0) {
    const i = this.idx(name); const info = this.hands[side].fingers[name];
    let q = qMul(this.joints[i].q, qAxisAngle(info.flex_axis_local, flex - info.rest_flex_deg * DEG));
    if (abd) q = qMul(q, qAxisAngle(info.abd_axis_local, abd));
    if (twist) q = qMul(q, qAxisAngle([0, 1, 0], twist));
    return q;
  }
}

export function sideSuffix(side) { return side === 'R' ? '_R' : '_L'; }
export const FINGER_JOINTS = {
  1: ['finger1-1', 'finger1-2', 'finger1-3'],
  2: ['finger2-1', 'finger2-2', 'finger2-3'],
  3: ['finger3-1', 'finger3-2', 'finger3-3'],
  4: ['finger4-1', 'finger4-2', 'finger4-3'],
  5: ['finger5-1', 'finger5-2', 'finger5-3'],
};
export const METACARPAL = { 2: 'metacarpal1', 3: 'metacarpal2', 4: 'metacarpal3', 5: 'metacarpal4' };
export { norm };
