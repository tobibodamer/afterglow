// Deterministic sampling. Nothing in the render path may use Math.random, Date, performance.now or rAF:
// every random number comes from these integer hashes / stratified sample tables, seeded by constants,
// the frame index or the sub-frame index.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// lowbias32 integer hash
export function hash32(x) {
  x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

// hash of several integers -> uint32
export function hashInts(...v) {
  let h = 0x9E3779B9;
  for (const x of v) h = hash32((h ^ (x >>> 0)) >>> 0);
  return h;
}

// uniform [0,1) from integers
export const hash01 = (...v) => hashInts(...v) / 4294967296;

export function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

export const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];

// Concentric (Shirley-Chiu) square -> disk mapping, optionally onto an n-blade regular polygon (blades >= 3).
export function squareToDisk(u, v, blades = 0, rotation = 0) {
  const a = 2 * u - 1, b = 2 * v - 1;
  if (a === 0 && b === 0) return [0, 0];
  let r, phi;
  if (a * a > b * b) { r = a; phi = (Math.PI / 4) * (b / a); }
  else { r = b; phi = Math.PI / 2 - (Math.PI / 4) * (a / b); }
  if (blades >= 3) { // scale the radius to the polygon edge distance (iris with straight blades)
    const seg = (2 * Math.PI) / blades;
    const p = ((((phi - rotation) % seg) + seg) % seg) - seg / 2;
    r *= Math.cos(Math.PI / blades) / Math.cos(p);
  }
  return [r * Math.cos(phi), r * Math.sin(phi)];
}

// ---------------------------------------------------------------------------------------------------------------
// Sub-frame sample tables: one table per N, identical for every output frame and every session.
//
// The sample dimensions come in groups. Each group is a stratified point set over the N sub-frames:
//   T   shutter time      1-D: the N stratum centres (k + 0.5) / N, exactly centred on the frame (no lag vs audio)
//   J   pixel jitter      2-D correlated multi-jittered pattern (CMJ, Kensler 2013) on m x n = N cells: one point per
//                         cell and N-rooks in both axes (each 1-D projection has one point per 1/N stratum)
//   L   aperture          2-D CMJ, mapped to the disk / 9-blade polygon with the concentric map
//   D0..D3  module dims   sub.dim(0..7): four 2-D CMJ pairs (0,1) (2,3) (4,5) (6,7)
// Each group's CMJ seed is the best of a fixed list of candidates (256 for N <= 8, else 32) for the spread of that
// group on its own (centroid, x/y correlation, isotropy; the aperture on the disk, the module pairs as a square and as
// a polar disk r = sqrt(u), angle = 2 pi v), plus how well it can be decorrelated from time (this matters at small N,
// where the point set itself limits what any pairing can reach).
//
// Which point of each group goes with which sub-frame k decides the cross-dimension correlations, and a bad pairing
// is visible: if late shutter times go with right-hand aperture samples, a defocused object moving right is blurred
// more than the same object moving left. The pairing is chosen by a deterministic local search (pairwise swaps of k
// within a group; the time order is fixed) that minimises weighted squared cross-group correlations. Weights, by
// visibility: time x aperture 1 (plus 0.3 for the odd-in-time terms t*lx^2, t*ly^2, t*lx*ly, t^3*lx, t^3*ly that
// also make left and right motion blur differ), time x module dims 0.3, time x jitter 0.1, everything else 0.05.
// N = 1 is the exact centre: no jitter, the centre of the aperture, t = 0.5, dims 0.5.
// ---------------------------------------------------------------------------------------------------------------

const N_MODULE_DIMS = 8;            // optimised module dims (4 pairs); higher dims fall back to unoptimised CMJ pairs
const SEARCH_MAX_N = 512;           // above this the pairing is left as generated (correlations ~ 1/sqrt(N) anyway)

function shuffled(n, rnd) {
  const p = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}

/**
 * N-point correlated multi-jittered pattern (Kensler 2013) on m x n = N cells (m = the largest divisor of N that is
 * <= sqrt(N), so both 1-D projections are exactly N-rooks for every N), deterministic for a seed. Returns [[x, y]].
 */
export function cmjPoints(N, seed) {
  if (N === 1) return [[0.5, 0.5]];
  let m = Math.floor(Math.sqrt(N)); while (N % m) m--;
  const n = N / m;
  const rnd = mulberry32(seed);
  const ps = shuffled(N, rnd), px = shuffled(m, rnd), py = shuffled(n, rnd);
  const out = [];
  for (let i = 0; i < N; i++) {
    const s = ps[i];
    const sx = px[s % m], sy = py[Math.floor(s / m)];
    out.push([(sx + (sy + rnd()) / n) / m, (s + rnd()) / N]);
  }
  return out;
}

const polar = ([u, v]) => { const r = Math.sqrt(u); return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)]; };
const disk = ([u, v]) => squareToDisk(u, v);
const square = ([u, v]) => [2 * u - 1, 2 * v - 1];

function spreadCost(pts, maps) {
  let c = 0;
  for (const f of maps) {
    const q = pts.map(f), n = q.length;
    const mx = q.reduce((a, p) => a + p[0], 0) / n, my = q.reduce((a, p) => a + p[1], 0) / n;
    let vx = 0, vy = 0, cxy = 0;
    for (const [x, y] of q) { vx += (x - mx) ** 2; vy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
    c += Math.hypot(mx, my) + 0.5 * Math.abs(cxy) / Math.sqrt(vx * vy || 1) + 0.5 * Math.abs(vx - vy) / (vx + vy || 1);
  }
  return c;
}

const centre = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return a.map((x) => x - m); };

// Features per group for the pairing search: [values per sub-frame, kind]. kind: 'lin' (first order), 'quad', 'odd3'.
function features(name, pts) {
  if (name === 'T') { const tau = pts.map((t) => t - 0.5); return [[tau, 'lin'], [centre(tau.map((x) => x * x * x)), 'odd3']]; }
  if (name === 'J') return [[centre(pts.map((p) => p[0])), 'lin'], [centre(pts.map((p) => p[1])), 'lin']];
  if (name === 'L') {
    const d = pts.map(disk), lx = d.map((p) => p[0]), ly = d.map((p) => p[1]);
    return [[centre(lx), 'lin'], [centre(ly), 'lin'], [centre(lx.map((x) => x * x)), 'quad'], [centre(ly.map((y) => y * y)), 'quad'],
      [centre(d.map((p) => p[0] * p[1])), 'quad']];
  }
  const p = pts.map(polar);
  return [[centre(pts.map((q) => q[0])), 'lin'], [centre(pts.map((q) => q[1])), 'lin'], [centre(p.map((q) => q[0])), 'lin'], [centre(p.map((q) => q[1])), 'lin']];
}

function pairWeight(ga, ka, gb, kb) {
  if (gb === 'T') return pairWeight(gb, kb, ga, ka);
  if (ga === 'T') {
    const hi = ka === 'odd3' || kb !== 'lin';                  // a higher-order term
    if (gb === 'L') return ka === 'odd3' && kb !== 'lin' ? 0.1 : hi ? 0.3 : 1;
    if (gb === 'J') return hi ? 0 : 0.1;
    return hi ? 0.1 : 0.3;                                     // module dims (soft shadows of moving casters)
  }
  return ka === 'lin' && kb === 'lin' ? 0.05 : 0;
}

/**
 * Deterministic local search over the pairing of points to sub-frames. groups: [{name, pts}], pts[k] belongs to
 * sub-frame k; group 0 stays fixed. Pairwise swaps within a group are applied while they lower
 * cost = sum over cross-group feature pairs of w * corr^2. Returns {pts (permuted), cost, sweeps}.
 */
function pairSearch(groups, N, { maxSweeps = 40, restarts = 1, seed = 0x5EA4C1 } = {}) {
  const fg = [], fk = [], vals = [];
  groups.forEach((G, g) => {
    for (const [v, kind] of features(G.name, G.pts)) {
      const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
      if (norm > 1e-12) { fg.push(g); fk.push(kind); vals.push(v.map((x) => x / norm)); } // unit vectors: dot = corr
    }
  });
  const F = fg.length;
  const base = new Float64Array(F * N); vals.forEach((v, a) => base.set(v, a * N));
  // pair lists per group: (a in g, b not in g, w, index of S)
  const pairs = [];
  for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++) {
    if (fg[a] === fg[b]) continue;
    const w = pairWeight(groups[fg[a]].name, fk[a], groups[fg[b]].name, fk[b]);
    if (w > 0) pairs.push([a, b, w]);
  }
  const lists = groups.map((_, g) => {
    const L = pairs.flatMap(([a, b, w], i) => (fg[a] === g ? [[a, b, w, i]] : fg[b] === g ? [[b, a, w, i]] : []));
    return { fa: Int32Array.from(L, (x) => x[0] * N), fb: Int32Array.from(L, (x) => x[1] * N), w: Float64Array.from(L, (x) => x[2]), si: Int32Array.from(L, (x) => x[3]) };
  });
  const mine = groups.map((_, g) => fg.flatMap((h, a) => (h === g ? [a * N] : [])));
  const G = groups.length;
  let best = null;
  for (let r = 0; r < restarts; r++) {
    const V = base.slice();
    const perms = groups.map(() => [...Array(N).keys()]);
    if (r > 0) { // deterministic restart: shuffle every free group
      const rnd = mulberry32(hashInts(seed, r));
      for (let g = 1; g < G; g++) {
        const p = shuffled(N, rnd);
        perms[g] = p;
        for (const o of mine[g]) { const old = base.subarray(o, o + N); for (let k = 0; k < N; k++) V[o + k] = old[p[k]]; }
      }
    }
    const S = Float64Array.from(pairs, ([a, b]) => { let s = 0; for (let k = 0; k < N; k++) s += V[a * N + k] * V[b * N + k]; return s; });
    let sweeps = 0;
    for (; sweeps < maxSweeps; sweeps++) {
      let improved = false;
      for (let g = 1; g < G; g++) {
        const { fa, fb, w, si } = lists[g], np = w.length, mg = mine[g];
        if (!np) continue;
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          // swapping sub-frames i and j in group g changes S(a,b) by -(a_i - a_j)(b_i - b_j)
          let d = 0;
          for (let p = 0; p < np; p++) {
            const oa = fa[p], ob = fb[p];
            const x = (V[oa + i] - V[oa + j]) * (V[ob + i] - V[ob + j]);
            d += w[p] * x * (x - 2 * S[si[p]]);
          }
          if (d < -1e-14) {
            for (let p = 0; p < np; p++) { const oa = fa[p], ob = fb[p]; S[si[p]] -= (V[oa + i] - V[oa + j]) * (V[ob + i] - V[ob + j]); }
            for (const o of mg) { const t = V[o + i]; V[o + i] = V[o + j]; V[o + j] = t; }
            const pg = perms[g], t = pg[i]; pg[i] = pg[j]; pg[j] = t;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    let cost = 0; pairs.forEach(([, , w], i) => { cost += w * S[i] * S[i]; });
    if (!best || cost < best.cost - 1e-15) best = { cost, sweeps, perms };
  }
  return { pts: groups.map((Gr, g) => best.perms[g].map((i) => Gr.pts[i])), cost: best.cost, sweeps: best.sweeps };
}

// search settings: full search for the usual N (a few ms at N = 16), bounded for large N
const searchOpts = (N) => ({ maxSweeps: N <= 128 ? 40 : 6, restarts: N <= 8 ? 24 : 1 });

/**
 * The CMJ point set for one group: the best of a fixed list of seeds (256 for N <= 8, else 32) by
 * spread + wTime * (how well it can be decorrelated from the time samples t, after a pairing search against t alone).
 * Returns the points in that pre-paired order.
 */
function bestCmj(N, base, name, maps, t, wTime) {
  let best = null, bestC = Infinity;
  const nCand = N <= 8 ? 256 : 32, pre = N > 1 && N <= SEARCH_MAX_N && wTime > 0;
  for (let c = 0; c < nCand; c++) {
    let pts = cmjPoints(N, hashInts(base, c));
    let cost = spreadCost(pts, maps);
    if (pre) {
      const r = pairSearch([{ name: 'T', pts: t }, { name, pts }], N, { maxSweeps: 12, restarts: N <= 8 ? 6 : 1, seed: hashInts(base, c, 0x7A1) });
      pts = r.pts[1]; cost += wTime * Math.sqrt(r.cost);
    }
    if (cost < bestC - 1e-12) { bestC = cost; best = pts; }
  }
  return best;
}

const _tables = new Map();

/** The raw (square-domain) sample table for N sub-frames; cached. Exposed for tests and tools. */
export function subframeTable(N) {
  N = Math.max(1, Math.round(N));
  const hit = _tables.get(N);
  if (hit) return hit;
  // shutter time: stratum centres in a fixed shuffled order (k -> t_k as in the first version of this file)
  const order = shuffled(N, mulberry32(1234567));
  const t = order.map((o) => (o + 0.5) / N);
  const groups = [
    { name: 'T', pts: t },
    { name: 'L', pts: bestCmj(N, 0x1E45E5, 'L', [disk], t, 0.5) },
    { name: 'J', pts: bestCmj(N, 0x4A177E5, 'J', [square], t, 0.1) },
  ];
  for (let p = 0; p < N_MODULE_DIMS / 2; p++) groups.push({ name: `D${p}`, pts: bestCmj(N, hashInts(0xD1A5, p), `D${p}`, [square, polar], t, 0.25) });
  const res = N > 1 && N <= SEARCH_MAX_N ? pairSearch(groups, N, searchOpts(N)) : { pts: groups.map((G) => G.pts), cost: NaN, sweeps: 0 };
  const [, L, J, ...D] = res.pts;
  const dims = [];
  for (const P of D) dims.push(Float64Array.from(P, (q) => q[0]), Float64Array.from(P, (q) => q[1]));
  const table = Object.freeze({ N, t: Float64Array.from(t), jitter: J, lens: L, dims, cost: res.cost, sweeps: res.sweeps });
  _tables.set(N, table);
  return table;
}

const _extraDims = new Map();

/**
 * Extra sample dimension `dim` (0, 1, 2, ...) of sub-frame k (0..N-1) for modules: a value in [0, 1), one per 1/N
 * stratum over the N sub-frames. Dims come in 2-D stratified pairs (0,1), (2,3), ...: use one pair per 2-D decision
 * (a point on a light's disk, a glossy lobe direction). Dims 0-7 are paired against time, jitter, aperture and each
 * other by the search in subframeTable (N = 16: |corr| <= 0.10 against time, 0.006 between dims 0 and 1; at N = 4 the
 * four points leave up to 0.66 against time); dims 8+ are stratified pairs with a hashed (unoptimised) pairing.
 * k < 0 (the frame-centre pose) gives 0.5.
 */
export function subframeDim(k, dim, N) {
  if (!(N >= 1)) throw new Error('subframeDim(k, dim, N): N (sub-frames per output frame) is required');
  if (k < 0) return 0.5;
  N = Math.max(1, Math.round(N));
  if (dim < N_MODULE_DIMS) return subframeTable(N).dims[dim][k];
  const pair = dim >> 1, key = `${N}|${pair}`;
  let P = _extraDims.get(key);
  if (!P) {
    const pts = cmjPoints(N, hashInts(0xE71A, pair));
    const perm = shuffled(N, mulberry32(hashInts(0xE71B, pair, N)));
    P = perm.map((i) => pts[i]);
    _extraDims.set(key, P);
  }
  return P[k][dim & 1];
}

const _cache = new Map();

/**
 * N sub-frame samples, identical for every output frame (temporally stable: DOF ghosts, if any, do not flicker).
 *  jx, jy : sub-pixel jitter in pixels (box filter: [-0.5, 0.5]; 'gauss' filter: Gaussian with sigma aaSigma px)
 *  lx, ly : point on the unit aperture (9-blade polygon by default)
 *  t      : shutter position in [0,1): one sample per 1/N stratum, at the stratum centre
 *  dims   : module dims 0-7 (sub.dim)
 * The groups are decorrelated from each other by the pairing search in subframeTable().
 */
export function subframeSamples(N, { blades = 9, bladeRotation = 0.3, aaFilter = 'box', aaSigma = 0.42 } = {}) {
  N = Math.max(1, Math.round(N));
  const key = `${N}|${blades}|${bladeRotation}|${aaFilter}|${aaSigma}`;
  const hit = _cache.get(key);
  if (hit) return hit;
  const T = subframeTable(N);
  const out = [];
  for (let k = 0; k < N; k++) {
    const [u0, u1] = T.jitter[k];
    let jx, jy;
    if (N === 1) { jx = 0; jy = 0; }
    else if (aaFilter === 'gauss') { // Box-Muller on the stratified pair: Gaussian pixel reconstruction filter
      const r = aaSigma * Math.sqrt(-2 * Math.log(Math.max(1e-6, 1 - u0))), th = 2 * Math.PI * u1;
      jx = Math.max(-1.5, Math.min(1.5, r * Math.cos(th))); jy = Math.max(-1.5, Math.min(1.5, r * Math.sin(th)));
    } else { jx = u0 - 0.5; jy = u1 - 0.5; }
    const [lx, ly] = squareToDisk(T.lens[k][0], T.lens[k][1], blades, bladeRotation);
    out.push(Object.freeze({ k, jx, jy, lx, ly, t: T.t[k], dims: Object.freeze(T.dims.map((d) => d[k])) }));
  }
  Object.freeze(out);
  _cache.set(key, out);
  return out;
}
