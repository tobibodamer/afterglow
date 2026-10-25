// Where the hands are, for the camera: tracking targets, slider follows, follow focus.
//
// SOURCE 1 (preferred): the SOLVED performance. scene/src/camera/handtrack.json is generated from perf.bin by
// sandbox/camera/handtrack.mjs (forward kinematics of the rig: centre of the five fingertips + five knuckles, and their
// bounding box, smoothed like an operator follows a performer). Used when its bar timing matches the score in use.
// SOURCE 2 (fallback): a proxy from the score (key positions of the notes, smoothed), with the hand height/depth
// calibrated against the solved performance (critic camqc, 2026-10-21: the old proxy sat 2-3.5 cm high and 2-5 cm
// deep). Works before any perf exists.
// Both are sampled with a uniform cubic B-spline (C2), so camera follows have no velocity or acceleration steps (the
// old linear 30 Hz table gave jerk spikes of 18-66 m/s^3 in S04/S06/S08/S11/S15/S24, critic camqc).
import { KEYS, KB_CENTER_X } from '../piano/layout.js';

const IS_NODE = typeof window === 'undefined';
/**
 * Load the hand track. Pin order: globalThis.AG_HANDTRACK (set by shots.js?handtrack=<url>), AG_HANDTRACK (Node env),
 * then ./handtrack.json next to this module. 'none' disables it (score proxy). Missing file -> null; shots.js then
 * REFUSES to load unless the proxy fallback was opted into (no silent change of hand source, critic r2).
 */
export async function loadHandTrack() {
  const pin = globalThis.AG_HANDTRACK ?? (IS_NODE ? globalThis.process?.env?.AG_HANDTRACK : null);
  if (pin === 'none') return { track: null, url: 'none' };
  try {
    if (IS_NODE) {
      const fs = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const root = fileURLToPath(new URL('../../../', import.meta.url));
      const p = pin ? (/^[A-Za-z]:|^\\\\/.test(pin) ? pin : root + pin.replace(/^\//, '')) : fileURLToPath(new URL('./handtrack.json', import.meta.url));
      return { track: JSON.parse(await fs.readFile(p, 'utf8')), url: pin || '/scene/src/camera/handtrack.json' };
    }
    const u = pin || new URL('./handtrack.json', import.meta.url).href;
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) return { track: null, url: `${u} (${r.status})` };
    return { track: await r.json(), url: u };
  } catch (e) { return { track: null, url: `error: ${e.message}` }; }
}

export const HAND_Y = 0.708;     // proxy: rig y of the hand centre (solved median: R 0.704-0.712, L 0.705-0.710)
export const HAND_Z = 0.055;     // proxy: rig z of the hand centre (solved median L 0.056, R 0.053)
export const KEY_TOP_Y = 0.675;  // rig y of the white key tops
export const HAND_BOX = [0.055, 0.035, 0.06];   // proxy: half extents of the tips+knuckles box (x, y, z)
// proxy: a key played with finger f puts the hand centre (3 - f) finger widths toward the little finger
export const FINGER_W = 0.022;
const fingerShift = (hand, finger) => {
  const f = Number(finger); if (!(f >= 1 && f <= 5)) return 0;
  return (hand === 'R' ? -1 : 1) * (3 - f) * FINGER_W;     // rig x: treble is -x
};

/** rig x of a MIDI pitch's key centre (rig = KB_CENTER_X - piano x; treble is -x) */
export function keyX(midi) {
  const k = KEYS[Math.max(0, Math.min(87, midi - 21))];
  return KB_CENTER_X - k.xCenter;
}

/** fingerprint of a score's bar timing (FNV-1a of the bar times in ms): a hand track solved for one score version
 *  stays valid for another with the same bar times (re-humanised notes move the hands by millimetres, not bars) */
export function barsFingerprint(bars) {
  let h = 0x811c9dc5;
  const s = bars.map((b) => `${b.bar}:${Math.round(b.t * 1000)}`).join(',');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function gaussianSmooth(arr, sigmaSamples) {
  if (sigmaSamples <= 0) return arr.slice();
  const r = Math.ceil(3 * sigmaSamples), w = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-0.5 * (i / sigmaSamples) ** 2));
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, ws = 0;
    for (let j = -r; j <= r; j++) { const k = Math.min(arr.length - 1, Math.max(0, i + j)); s += arr[k] * w[j + r]; ws += w[j + r]; }
    out[i] = s / ws;
  }
  return out;
}
/** uniform cubic B-spline through a table at fractional index g (clamped ends): C2, so camera follows and pans have
 *  continuous acceleration and bounded jerk (a Catmull-Rom is only C1: its acceleration steps at every 30 Hz knot,
 *  which camqc measured as 15-150 m/s^3 jerk in the follow shots, resume 3). Approximating: it smooths the samples
 *  with a [1 4 1]/6 kernel at the knots, on top of the operator smoothing already in the table. */
function cr(arr, g) {
  const n = arr.length;
  if (g <= 0) return arr[0]; if (g >= n - 1) return arr[n - 1];
  const i = Math.floor(g), u = g - i, u2 = u * u, u3 = u2 * u;
  const p0 = arr[Math.max(0, i - 1)], p1 = arr[i], p2 = arr[i + 1], p3 = arr[Math.min(n - 1, i + 2)];
  return ((1 - 3 * u + 3 * u2 - u3) * p0 + (4 - 6 * u2 + 3 * u3) * p1 + (1 + 3 * u + 3 * u2 - 3 * u3) * p2 + u3 * p3) / 6;
}
function decode(b64, n, scale = 1000) {
  let bytes;
  if (typeof Buffer !== 'undefined') bytes = Buffer.from(b64, 'base64');
  else { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[k][i] = dv.getInt16((i * 3 + k) * 2, true) / scale;
  return out;
}

/**
 * Build tracks. Returns { source, at(hand, m) -> [x, y, z] (rig), box(hand, m) -> { lo, hi }, x(hand, m) } with
 * hand 'L', 'R' or 'both' (midpoint of the two centres; box = union). m = music time.
 * `track` = parsed handtrack.json or null.
 */
export function buildHandTracks(score, opts = {}, track = null) {
  const MUSIC_OFFSET = opts.musicOffset ?? 4.0;
  const fp = barsFingerprint(score.bars);
  let T = null, why = 'no hand track';
  if (track && track.format === 'afterglow-camera-handtrack') {
    if (track.score?.bars === fp) T = track; else why = `hand track bars ${track.score?.bars} != score bars ${fp}`;
  }
  if (T) {
    const n = T.n, rate = T.rate, t0 = T.t0Film ?? 0, H = {};
    const sc = T.scale || 1000;   // units per metre (0.1 mm since resume 3: 1 mm steps showed up as jerk in the follows)
    for (const h of ['L', 'R']) {
      H[h] = { c: decode(T.hands[h].c, n, sc), lo: decode(T.hands[h].lo, n, sc), hi: decode(T.hands[h].hi, n, sc) };
      // fast box (0.08 s smoothing, 0.04 s lead) for focus on jumping hands; older tracks fall back to the normal box
      H[h].loF = T.hands[h].loF ? decode(T.hands[h].loF, n, sc) : H[h].lo; H[h].hiF = T.hands[h].hiF ? decode(T.hands[h].hiF, n, sc) : H[h].hi;
    }
    const g = (m) => (m + MUSIC_OFFSET - t0) * rate;
    const at1 = (h, m) => { const q = g(m); return [cr(H[h].c[0], q), cr(H[h].c[1], q), cr(H[h].c[2], q)]; };
    const box1 = (h, m, fast) => { const q = g(m), lo = fast ? H[h].loF : H[h].lo, hi = fast ? H[h].hiF : H[h].hi; return { lo: [0, 1, 2].map((k) => cr(lo[k], q)), hi: [0, 1, 2].map((k) => cr(hi[k], q)) }; };
    const at = (h, m) => { if (h !== 'both') return at1(h, m); const a = at1('L', m), b = at1('R', m); return [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])]; };
    const box = (h, m, fast = false) => { if (h !== 'both') return box1(h, m, fast); const a = box1('L', m, fast), b = box1('R', m, fast); return { lo: a.lo.map((v, k) => Math.min(v, b.lo[k])), hi: a.hi.map((v, k) => Math.max(v, b.hi[k])) }; };
    return { source: 'perf', perfSha: T.perf?.sha256 || null, scoreBars: fp, at, box, x: (h, m) => at(h, m)[0] };
  }
  // ------------------------------------------------------------------ proxy from the score
  const { rate = 30, m0 = -6, m1 = null, anticipate = 0.18, window = 0.45, smooth = 0.55, fingers = true } = opts;
  const end = m1 ?? (Math.max(...score.notes.map((n) => n.t_off)) + 12);
  const n = Math.ceil((end - m0) * rate) + 1;
  const tracks = {};
  for (const hand of ['L', 'R']) {
    const notes = score.notes.filter((q) => q.hand === hand).map((q) => ({ on: q.t_on, off: q.t_off, x: keyX(q.pitch) + (fingers ? fingerShift(hand, q.finger) : 0), w: q.voice === 'mel' ? 2.0 : q.voice === 'ghost' ? 0.3 : 1.0 }));
    notes.sort((a, b) => a.on - b.on);
    const x = new Float64Array(n);
    let last = hand === 'L' ? keyX(48) : keyX(72), j0 = 0;
    for (let i = 0; i < n; i++) {
      const m = m0 + i / rate, c = m + anticipate;
      while (j0 < notes.length && notes[j0].off < m - 3 * window && notes[j0].on < m - 3 * window) j0++;
      let s = 0, ws = 0;
      for (let j = j0; j < notes.length && notes[j].on < c + 3 * window; j++) {
        const q = notes[j];
        const gw = Math.exp(-0.5 * ((c - q.on) / window) ** 2);
        const held = m >= q.on && m <= q.off ? 0.35 : 0;
        const w = q.w * (gw + held);
        s += w * q.x; ws += w;
      }
      if (ws > 0.05) last = (s + 0.05 * last) / (ws + 0.05);
      x[i] = last;
    }
    tracks[hand] = gaussianSmooth(x, smooth * rate);
  }
  const xOf = (hand, m) => { const q = (m - m0) * rate; return hand === 'both' ? 0.5 * (cr(tracks.L, q) + cr(tracks.R, q)) : cr(tracks[hand], q); };
  const at = (hand, m) => [xOf(hand, m), HAND_Y, HAND_Z];
  const box = (hand, m) => {
    if (hand === 'both') { const a = xOf('L', m), b = xOf('R', m); return { lo: [Math.min(a, b) - HAND_BOX[0], HAND_Y - HAND_BOX[1], HAND_Z - HAND_BOX[2]], hi: [Math.max(a, b) + HAND_BOX[0], HAND_Y + HAND_BOX[1], HAND_Z + HAND_BOX[2]] }; }
    const c = at(hand, m); return { lo: c.map((v, k) => v - HAND_BOX[k]), hi: c.map((v, k) => v + HAND_BOX[k]) };
  };
  return { source: 'score', why, scoreBars: fp, at, box, x: xOf };
}
