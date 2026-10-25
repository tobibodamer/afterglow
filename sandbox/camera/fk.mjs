// Forward kinematics of the pianist rig from the performance tracks (plain JS, no three.js), so the camera tools can
// frame, focus and score against the SOLVED hands and head instead of a score-derived proxy.
// Adapted from the camera critic's build/qc/camera_critique1/tools/fk.mjs (same maths; validated there against the
// key contact points: fingertip vs key at note-on, median 8.7 mm).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const ROOT = path.resolve(import.meta.dirname, '..', '..').replace(/\\/g, '/');
const { fromBuffers } = await import(pathToFileURL(ROOT + '/scene/src/perf/tracks.js').href);

export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
export const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];

export function loadRig(file = ROOT + '/assets/pianist/rig.json') {
  const rig = JSON.parse(fs.readFileSync(file, 'utf8'));
  const joints = rig.joints;
  const idx = new Map(joints.map((j, i) => [j.name, i]));
  const order = []; const seen = new Set();
  const visit = (j) => { if (seen.has(j.name)) return; if (j.parent) visit(joints[idx.get(j.parent)]); seen.add(j.name); order.push(j); };
  joints.forEach(visit);
  return { rig, joints, idx, order };
}

export function loadPerf(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'perf.json'), 'utf8'));
  const b = fs.readFileSync(path.join(dir, 'perf.bin'));
  return fromBuffers(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export const GROUP = [0, -0.04, 0.022];   // pianist group in the rig (perf.json "frame" note: (0, -0.04, KEY_FRONT_Z))

/** rig-frame transforms of every joint at film time t; perf null = bind pose */
export function makeFK(R, perf) {
  const out = {}; const qs = {};
  return function fk(tFilm) {
    if (perf) perf.sampleBones(tFilm, qs);
    let rp = null;
    if (perf) { const r = perf.sampleRoot(tFilm); if (r && Number.isFinite(r[0])) rp = [r[0], r[1], r[2]]; }
    for (const j of R.order) {
      const ql = (perf && qs[j.name]) ? qs[j.name] : j.q;
      const tl = (j.name === 'root' && rp) ? rp : j.t;
      if (!j.parent) out[j.name] = { p: [tl[0] + GROUP[0], tl[1] + GROUP[1], tl[2] + GROUP[2]], q: ql.slice(), len: j.length || 0 };
      else {
        const P = out[j.parent]; const d = qrot(P.q, tl);
        out[j.name] = { p: [P.p[0] + d[0], P.p[1] + d[1], P.p[2] + d[2]], q: qmul(P.q, ql), len: j.length || 0 };
      }
    }
    return out;
  };
}
export const tipOf = (J) => { const d = qrot(J.q, [0, J.len, 0]); return [J.p[0] + d[0], J.p[1] + d[1], J.p[2] + d[2]]; };

/** hand points in the rig frame: 5 fingertips, 4 MCP knuckles + thumb MCP, 4 PIPs, wrist; centre = mean of tips+MCPs */
export function handPoints(W, side) {
  const s = '_' + side;
  const tips = [1, 2, 3, 4, 5].map((f) => tipOf(W[`finger${f}-3${s}`]));
  const mcp = [2, 3, 4, 5].map((f) => W[`finger${f}-1${s}`].p).concat([W[`finger1-2${s}`].p]);
  const pip = [2, 3, 4, 5].map((f) => W[`finger${f}-2${s}`].p);
  const wrist = W[`wrist${s}`].p;
  const all = [...tips, ...mcp, ...pip, wrist];
  const c = [0, 0, 0]; for (const p of [...tips, ...mcp]) { c[0] += p[0] / 10; c[1] += p[1] / 10; c[2] += p[2] / 10; }
  return { tips, mcp, pip, wrist, all, centre: c };
}

/** head: centre (8 cm up the head bone), face direction (bind-calibrated), face point, up */
export function headFrame(R) {
  const bindW = makeFK(R, null)(0);
  const qB = bindW.head.q;
  const upB = qrot(qB, [0, 1, 0]);
  const fB = norm3(sub3([0, 0, 1], mul3(upB, dot3([0, 0, 1], upB))));
  const fLocal = qrot(qinv(qB), fB);
  return (W) => {
    const up = qrot(W.head.q, [0, 1, 0]);
    const centre = add3(W.head.p, mul3(up, 0.08));
    const fwd = qrot(W.head.q, fLocal);
    const face = add3(add3(centre, mul3(fwd, 0.095)), mul3(up, -0.03));
    return { centre, fwd, face, up };
  };
}
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** body capsules (rig frame) for occlusion tests (critic's camqc set) */
export function bodyCapsules(W, head) {
  const P = (n) => W[n].p;
  const C = [
    { name: 'head', a: head.centre, b: head.centre, r: 0.14 },   // skull ~0.10 + the curls (the critic's camqc used 0.115; S07's renders showed the curls hiding more)
    { name: 'torso', a: P('spine05'), b: P('neck01'), r: 0.15 },
    { name: 'neck', a: P('neck01'), b: P('head'), r: 0.065 },
  ];
  for (const s of ['R', 'L']) {
    C.push({ name: 'shoulder' + s, a: P('clavicle_' + s), b: P('upperarm01_' + s), r: 0.07 });
    C.push({ name: 'upperarm' + s, a: P('upperarm01_' + s), b: P('lowerarm01_' + s), r: 0.055 });
    const wa = P('lowerarm01_' + s), wb = P('wrist_' + s), dir = norm3(sub3(wb, wa));
    C.push({ name: 'forearm' + s, a: wa, b: sub3(wb, mul3(dir, 0.035)), r: 0.042, side: s });
    C.push({ name: 'thigh' + s, a: P('upperleg01_' + s), b: P('lowerleg01_' + s), r: 0.08 });
    C.push({ name: 'shin' + s, a: P('lowerleg01_' + s), b: P('foot_' + s), r: 0.055 });
  }
  return C;
}
