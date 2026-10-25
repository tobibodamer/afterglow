// Small vector / quaternion helpers (plain arrays, no dependencies). Quaternions are [x, y, z, w].
export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** minimum-jerk blend 0..1 (Flash & Hogan) */
export const minjerk = (t) => { t = clamp(t, 0, 1); return t * t * t * (10 - 15 * t + 6 * t * t); };

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const addScaled = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const qId = () => [0, 0, 0, 1];
export function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qNorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
export function qAxisAngle(axis, ang) { const n = norm(axis); const s = Math.sin(ang / 2); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)]; }
export function qRot(q, v) {
  const [x, y, z, w] = q; const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
export function qFromUnitVectors(a, b) {
  const d = dot(a, b);
  if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a); return qAxisAngle(ax, Math.PI); }
  const c = cross(a, b); return qNorm([c[0], c[1], c[2], 1 + d]);
}
export function qSlerp(a, b, t) {
  let [bx, by, bz, bw] = b; let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (c > 0.9995) return qNorm([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  const th = Math.acos(c), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}
/** rotation vector (axis * angle) of q */
export function qLog(q) {
  let [x, y, z, w] = q; if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z); if (s < 1e-12) return [2 * x, 2 * y, 2 * z];
  const a = 2 * Math.atan2(s, w); return [x / s * a, y / s * a, z / s * a];
}
export function qExp(r) { const a = len(r); if (a < 1e-12) return qNorm([r[0] / 2, r[1] / 2, r[2] / 2, 1]); return qAxisAngle(r, a); }
/** quaternion from an orthonormal basis given as columns x, y, z */
export function qFromBasis(x, y, z) {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22; let q;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  return qNorm(q);
}
export const qAngle = (a, b) => { const c = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, c)); };

/** Solve a small dense linear system A x = b (Gaussian elimination with partial pivoting). A is n x n array of arrays. */
export function solveLin(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

/** Deterministic hash noise: smooth 1-D gradient noise for seasoning (seeded, aperiodic sums of octaves). */
function hash32(i, seed) { let h = (i * 374761393 + seed * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
/** deterministic uniform [0, 1) from an integer and a seed (per-phrase / per-event variation) */
export const hash01 = (i, seed) => hash32(i, seed);
export function gradNoise1(x, seed) {
  const i = Math.floor(x), f = x - i; const g0 = hash32(i, seed) * 2 - 1, g1 = hash32(i + 1, seed) * 2 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return 2 * ((g0 * f) * (1 - u) + (g1 * (f - 1)) * u);
}
/** 3 incommensurate octaves (performance.md 6.2): 0.071, 0.173, 0.389 Hz, amplitudes 1 : 0.45 : 0.2 */
export function bodyNoise(t, seed) {
  return (gradNoise1(t * 0.071, seed) + 0.45 * gradNoise1(t * 0.173 + 17.3, seed + 7) + 0.2 * gradNoise1(t * 0.389 + 41.1, seed + 13)) / 1.0;
}
