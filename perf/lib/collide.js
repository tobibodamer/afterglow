// Finger-vs-keybed collision on the REAL skinned mesh (a fixed subset of each finger's vertices), cheap enough to sit
// inside the palm optimiser. The QC measures every hand vertex; this subset (~90 per finger, denser at the tip) is what
// the optimiser sees. Vertices are kept only if all their skin influences are on the finger's own chain (+ its
// metacarpal / the wrist), so they can be skinned from the finger FK alone.
import { penetrationP, keyNormalP, keyPointP, keyTopYAtP, KEYS, KEYSLIP_TOP_Y } from './pianoGeo.js';
import { add, sub, scale, dot, len, clamp, qRot } from './math.js';

export function buildCollisionSets(H, counts = [14, 26, 50]) {
  H.colSet = {};
  for (let f = 1; f <= 5; f++) {
    const allowed = new Set([H.iWrist, ...H.fj[f]]); if (f > 1) allowed.add(H.mc[f]);
    const out = [];
    for (let k = 0; k < 3; k++) {
      const vs = H.verts.filter((v) => v.dom === H.fj[f][k] && v.inf.every((x) => allowed.has(x.j)));
      const n = counts[k]; const step = Math.max(1, Math.floor(vs.length / n));
      for (let i = 0; i < vs.length; i += step) out.push(vs[i]);
    }
    H.colSet[f] = out;
  }
  // palm / heel of the hand (wrist + metacarpals only): fix round 1, the keyframe objective keeps it off the key bed
  const pset = new Set([H.iWrist, ...[2, 3, 4, 5].map((f) => H.mc[f])]);
  const pv = H.verts.filter((v) => pset.has(v.dom) && v.inf.every((x) => pset.has(x.j)));
  const step = Math.max(1, Math.floor(pv.length / 120)); H.palmSet = pv.filter((_, i) => i % step === 0);
  return H.colSet;
}
/** penetration of the palm set into the key bed (+ margin): { sum (m^2), max (m) } */
export function palmPenetration(H, palm, angles, margin = 0.002) {
  const T = new Map(); T.set(H.iWrist, palm); for (const f of [2, 3, 4, 5]) T.set(H.mc[f], H.baseOf(f, palm));
  const x = [0, 0, 0]; let sum = 0, max = 0;
  for (const v of H.palmSet) {
    skinInto(v, T, x); if (x[1] > 0.76) continue;
    const r = penetrationP([x[0], x[1] - margin, x[2]], angles); if (r.depth <= 0) continue;
    sum += r.depth * r.depth; if (r.depth > max) max = r.depth;
  }
  return { sum, max };
}

/** world transforms (joint index -> {q, p}) for one finger: palm, its metacarpal and the 3 finger joints */
export function fingerTransforms(H, f, palm, fk) {
  const T = new Map(); T.set(H.iWrist, palm);
  if (f > 1) T.set(H.mc[f], H.baseOf(f, palm));
  H.fj[f].forEach((j, k) => T.set(j, fk[k]));
  return T;
}

function skinInto(v, T, out) {
  let x = 0, y = 0, z = 0;
  for (const s of v.inf) {
    const tr = T.get(s.j); const [qx, qy, qz, qw] = tr.q; const [vx, vy, vz] = s.local;
    const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
    x += s.w * (vx + qw * tx + (qy * tz - qz * ty) + tr.p[0]);
    y += s.w * (vy + qw * ty + (qz * tx - qx * tz) + tr.p[1]);
    z += s.w * (vz + qw * tz + (qx * ty - qy * tx) + tr.p[2]);
  }
  out[0] = x; out[1] = y; out[2] = z; return out;
}

/**
 * Penetration of finger f (pose fk on palm) into the key bed with key angles `angles` (Float32Array 88); into its own
 * key `ownKey` only beyond 0.4 mm (the contact itself). Returns { sum (sum of squared depths, m^2), max (m), n }.
 */
export function fingerPenetration(H, f, palm, fk, angles, ownKey = -1, margin = 0) {
  const T = fingerTransforms(H, f, palm, fk); const x = [0, 0, 0];
  let sum = 0, max = 0, n = 0;
  for (const v of H.colSet[f]) {
    skinInto(v, T, x);
    if (x[1] > 0.76) continue;
    // the contact itself touches the own key's top: there only penetration beyond 0.4 mm (skin compliance) counts
    const r = penetrationP(x, angles); const d = r.key === ownKey && r.key >= 0 ? r.depth - 0.0004 : r.depth + margin;
    if (d <= 0) continue;
    sum += d * d; if (d > max) max = d; n++;
  }
  return { sum, max, n };
}

/**
 * The pad's actual lowest skinned vertex relative to a key's top plane (key `key` at angle `ang`, plane through the
 * rest-pose point P0): { d (m, > 0 = above the plane), p (world point) }. Uses the pad candidate vertices (hand.js).
 */
export function padLowest(H, f, palm, a, key, ang, P0) {
  const fk = H.fingerFK(f, palm, a); const T = fingerTransforms(H, f, palm, fk);
  const n = keyNormalP(ang); const p0 = keyPointP(key, ang, P0); const x = [0, 0, 0];
  // only vertices over the key's top outline (+1 mm) can rest on it; vertices beside it are the collision term's job
  const K = KEYS[key]; const rects = K.black ? [K.top] : [K.head, K.tail];
  let best = 1e9, bp = null, bestAny = 1e9, bpAny = null;
  for (const v of H.pad[f].cand) {
    if (v.inf.some((s) => !T.has(s.j))) continue;
    skinInto(v, T, x); const d = (x[0] - p0[0]) * n[0] + (x[1] - p0[1]) * n[1] + (x[2] - p0[2]) * n[2];
    if (d < bestAny) { bestAny = d; bpAny = x.slice(); }
    const q = keyPointP(key, -ang, x);
    if (!rects.some((r) => q[0] >= r.x0 - 0.001 && q[0] <= r.x1 + 0.001 && q[2] >= r.z0 - 0.001 && q[2] <= r.z1 + 0.001)) continue;
    if (d < best) { best = d; bp = x.slice(); }
  }
  return bp ? { d: best, p: bp, n, p0 } : { d: bestAny, p: bpAny, n, p0 };
}

/**
 * Vertical lift (m) that clears finger f's collision set above the key bed by `margin`: white/black key tops at their
 * current angles, the key slip and the fallboard (fix round 1: free fingers were checked only as a pad sphere, so the
 * nail, the DP flesh and the middle phalanx dipped into keys and the thumb into the key slip).
 */
export function freeLift(H, f, palm, fk, angles, margin = 0.002, ignoreKey = -1) {
  const T = fingerTransforms(H, f, palm, fk); const x = [0, 0, 0]; let need = 0;
  for (const v of H.colSet[f]) {
    skinInto(v, T, x); if (x[1] > 0.76) continue;
    const y = x[1] - margin; const r = penetrationP([x[0], y, x[2]], angles); if (r.depth <= 0 || (r.key >= 0 && r.key === ignoreKey)) continue;
    let top;
    if (r.part === 'white' || r.part === 'black') top = keyTopYAtP(r.key, x[2], angles[r.key]);
    else if (r.part === 'keyslip') top = KEYSLIP_TOP_Y;
    else top = y + r.depth;
    need = Math.max(need, top - y);
  }
  return need;
}

/** capsule radii per finger segment from the bind mesh (as qc.js: 35th percentile of the vertex distances - 0.5 mm) */
export function buildCapsules(H) {
  const rig = H.rig; H.caps = {};
  for (let f = 1; f <= 5; f++) {
    H.caps[f] = [];
    for (let k = 0; k < 3; k++) {
      const ji = H.fj[f][k]; const child = k < 2 ? H.fj[f][k + 1] : -1; const a = rig.bindWP[ji];
      const b = child >= 0 ? rig.bindWP[child] : add(a, qRot(rig.bindWQ[ji], [0, rig.joints[ji].length * 0.85, 0]));
      const ds = H.verts.filter((v) => v.dom === ji).map((v) => segDist(v.P, a, b)).sort((p, q) => p - q);
      H.caps[f].push({ r: ds.length ? ds[Math.floor(ds.length * 0.35)] - 0.0005 : 0.006, tipLen: rig.joints[ji].length * 0.85 });
    }
  }
  return H.caps;
}
/** world capsules [{a, b, r, f, k}] of finger f for its FK */
export function fingerCapsules(H, f, fk) {
  const C = H.caps[f];
  return [0, 1, 2].map((k) => ({ a: fk[k].p, b: k < 2 ? fk[k + 1].p : add(fk[2].p, qRot(fk[2].q, [0, C[2].tipLen, 0])), r: C[k].r, f, k }));
}
/**
 * Deepest overlap of capsule set A (one finger) with the capsules B of other fingers of the same hand (the MCP webbing
 * between neighbouring long fingers is shared skin and skipped): { depth (m), dir (unit, pushes A out of B), other }
 */
export function capsuleOverlap(A, B, pad = 0.0005, sameHand = true) {
  let best = { depth: 0, dir: null, other: null };
  for (const a of A) for (const b of B) {
    if (sameHand && a.f === b.f) continue;
    if (sameHand && a.k === 0 && b.k === 0 && a.f !== 1 && b.f !== 1 && Math.abs(a.f - b.f) === 1) continue;
    const c = segSegClosest(a.a, a.b, b.a, b.b); const d = a.r + b.r + pad - c.d;
    if (d > best.depth) { const n = c.d > 1e-9 ? scale(sub(c.pa, c.pb), 1 / c.d) : [0, 1, 0]; best = { depth: d, dir: n, other: `${b.f}-${b.k + 1}` }; }
  }
  return best;
}
function segDist(p, a, b) { const ab = sub(b, a); const t = clamp(dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab)), 0, 1); return len(sub(p, add(a, scale(ab, t)))); }
export function segSegClosest(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2); const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t; const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  const pa = add(p1, scale(d1, s)), pb = add(p2, scale(d2, t));
  return { d: len(sub(pa, pb)), pa, pb };
}

/** lowest skinned point of the finger's collision set (for clearance checks of free fingers) */
export function fingerLowest(H, f, palm, fk) {
  const T = fingerTransforms(H, f, palm, fk); const x = [0, 0, 0]; let best = null;
  for (const v of H.colSet[f]) { skinInto(v, T, x); if (!best || x[1] < best[1]) best = x.slice(); }
  return best;
}
