// Camera maths: plain arrays, no three.js import, so Node tools (sandbox/camera/*.mjs) evaluate exactly the same
// camera the page renders. Everything here is a pure function of its arguments (no Math.random / Date / now).

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

// ------------------------------------------------------------------------------------------------ vectors
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, u) => a + (b - a) * u;
export const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** rotate v about the world/rig vertical (y) by deg (three.js sense: +deg turns +x toward -z) */
export function rotY(v, deg) {
  const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
/** rotate v about unit axis k by deg (Rodrigues) */
export function rotAxis(v, k, deg) {
  const a = deg * D2R, c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v), kd = dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

// ------------------------------------------------------------------------------------------------ easing
export const smoothstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export const smootherstep = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
/** integral of smootherstep from 0 to x (x in [0, 1]); I(1) = 0.5 */
const smootherInt = (x) => { const x2 = x * x, x4 = x2 * x2; return x4 * (x2 - 3 * x + 2.5); };

/**
 * Velocity profile of a camera move (a dolly grip's push): normalized progress s(u), u = (t - ta) / (tb - ta).
 * The speed ramps from v0 (fraction of cruise speed at the start, 0 = from rest) to cruise over the first `ain` of the
 * move and from cruise down to v1 over the last `aout`, with smootherstep ramps: acceleration AND jerk are
 * continuous (no linear starts or stops, no bump at the end of a ramp). v0 > 0 means the move is already running at
 * the cut (it started before the shot). Outside [0, 1] the move continues at its end speeds, so shutter sub-frames
 * just outside a shot (centred 180-degree shutter) stay on the same smooth path.
 * Returns { s(u), v(u) (ds/du), peak (max ds/du) }.
 */
export function makeProfile({ ain = 0.3, aout = 0.3, v0 = 0, v1 = 0 } = {}) {
  let a = clamp(ain, 0, 1), b = clamp(aout, 0, 1);
  if (a + b > 1) { const k = 1 / (a + b); a *= k; b *= k; }
  const total = a * (1 + v0) / 2 + (1 - a - b) + b * (1 + v1) / 2;
  const raw = (u) => {
    if (u <= 0) return v0 * u;
    if (u >= 1) return total + v1 * (u - 1);
    let s = 0;
    if (a > 0) { const x = Math.min(u, a) / a; s += v0 * Math.min(u, a) + (1 - v0) * a * smootherInt(x); }
    if (u > a) s += Math.min(u, 1 - b) - a;
    if (u > 1 - b && b > 0) { const x = (u - (1 - b)) / b; s += (u - (1 - b)) - (1 - v1) * b * smootherInt(x); }
    return s;
  };
  const vraw = (u) => {
    if (u <= 0) return v0; if (u >= 1) return v1;
    if (a > 0 && u < a) return v0 + (1 - v0) * smootherstep(u / a);
    if (b > 0 && u > 1 - b) return 1 - (1 - v1) * smootherstep((u - (1 - b)) / b);
    return 1;
  };
  return { s: (u) => raw(u) / total, v: (u) => vraw(u) / total, peak: 1 / total, ain: a, aout: b, v0, v1 };
}

// ------------------------------------------------------------------------------------------------ splines
/**
 * Centripetal Catmull-Rom through `pts` (>= 2 points), re-parameterised by arc length so the velocity profile alone
 * sets the speed. at(s), s in [0, 1] (extrapolates linearly along the end tangents outside).
 */
export function makePath(pts, { alpha = 0.5, samples = 256 } = {}) {
  if (pts.length === 1) return { at: () => pts[0].slice(), length: 0 };
  if (pts.length === 2) {
    const L = len(sub(pts[1], pts[0]));
    return { at: (s) => lerp3(pts[0], pts[1], s), length: L };
  }
  const P = [sub(mul(pts[0], 2), pts[1]), ...pts, sub(mul(pts[pts.length - 1], 2), pts[pts.length - 2])];
  const segs = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const t0 = 0, t1 = t0 + Math.pow(len(sub(p1, p0)) || 1e-6, alpha), t2 = t1 + Math.pow(len(sub(p2, p1)) || 1e-6, alpha), t3 = t2 + Math.pow(len(sub(p3, p2)) || 1e-6, alpha);
    segs.push((u) => {
      const t = lerp(t1, t2, u);
      const A1 = lerp3(p0, p1, (t - t0) / (t1 - t0)), A2 = lerp3(p1, p2, (t - t1) / (t2 - t1)), A3 = lerp3(p2, p3, (t - t2) / (t3 - t2));
      const B1 = lerp3(A1, A2, (t - t0) / (t2 - t0)), B2 = lerp3(A2, A3, (t - t1) / (t3 - t1));
      return lerp3(B1, B2, (t - t1) / (t2 - t1));
    });
  }
  // arc-length table
  const n = segs.length * samples; const tab = [0]; let prev = segs[0](0), L = 0; const pt = [prev];
  for (let i = 1; i <= n; i++) {
    const g = i / samples, si = Math.min(segs.length - 1, Math.floor(g)), u = g - si;
    const p = segs[si](si === segs.length - 1 && i === n ? 1 : u);
    L += len(sub(p, prev)); tab.push(L); pt.push(p); prev = p;
  }
  const evalG = (g) => { const si = Math.min(segs.length - 1, Math.floor(g)); return segs[si](g - si); };
  const tanStart = norm(sub(pt[1], pt[0])), tanEnd = norm(sub(pt[n], pt[n - 1]));
  // inverse arc length by linear interpolation in a dense table (256 samples per segment, was 64: the speed steps at
  // every table entry, so the finer table cuts the 240 Hz jerk spikes of the multi-point moves, camqc resume 3)
  return {
    length: L,
    at(s) {
      if (s <= 0) return add(pt[0], mul(tanStart, s * L));
      if (s >= 1) return add(pt[n], mul(tanEnd, (s - 1) * L));
      const target = s * L; let lo = 0, hi = n;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tab[mid] < target) lo = mid; else hi = mid; }
      const f = (target - tab[lo]) / Math.max(1e-12, tab[hi] - tab[lo]);
      return evalG((lo + f) / samples);
    },
  };
}

/** monotone cubic (Fritsch-Carlson) through [[x, y], ...] (x increasing); C1, no overshoot; clamped outside */
export function makeMonotone(keys) {
  const n = keys.length, x = keys.map((k) => k[0]), y = keys.map((k) => k[1]);
  if (n === 1) return () => y[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (t) => {
    if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1];
    let i = 0, hi = n - 1;
    while (hi - i > 1) { const mid = (i + hi) >> 1; if (x[mid] <= t) i = mid; else hi = mid; }
    const h = x[i + 1] - x[i], u = (t - x[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * y[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

// ------------------------------------------------------------------------------------------------ noise
/** 32-bit integer hash (lowbias32) -> [0, 1) */
export function hash01(...ints) {
  let h = 0x9e3779b9;
  for (const v of ints) { h ^= (v | 0) + 0x7f4a7c15 + (h << 6) + (h >>> 2); h = Math.imul(h ^ (h >>> 16), 0x21f0aaad); h = Math.imul(h ^ (h >>> 15), 0x735a2d97); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}
/**
 * Smooth deterministic 1-D noise: a sum of 5 sines with hashed phases and slightly detuned, incommensurate
 * frequencies around `freq` (Hz). C-infinity in t, so camera motion blur over the shutter is exact. Output ~[-1, 1]
 * (unit RMS ~0.5). `rough` in [0, 1] shifts energy to the higher octaves (0 = floating / boat, 1 = handheld).
 */
export function smoothNoise(seed, channel, t, freq = 0.25, rough = 0.3) {
  let s = 0, w = 0;
  const ratios = [1, 1.93, 3.71, 7.13, 13.7];
  for (let i = 0; i < ratios.length; i++) {
    const f = freq * ratios[i] * (0.9 + 0.2 * hash01(seed, channel, i, 1));
    const ph = 2 * Math.PI * hash01(seed, channel, i, 2);
    const amp = Math.pow(ratios[i], -(1.6 - rough));
    s += amp * Math.sin(2 * Math.PI * f * t + ph); w += amp * amp;
  }
  return s / Math.sqrt(2 * w) * Math.SQRT2;
}

// ------------------------------------------------------------------------------------------------ lens helpers
/** focus pull in diopter space (a follow-focus ring is close to linear in 1/d), smootherstep timing */
export function pullFocus(d0, d1, u) {
  const k = smootherstep(u);
  return 1 / lerp(1 / d0, 1 / d1, k);
}
/** horizontal field of view (deg) on a 36 mm wide sensor */
export const hfov = (mm) => 2 * Math.atan(18 / mm) * R2D;
