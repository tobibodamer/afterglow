// Piano keyboard geometry in the PIANIST (GLB) frame: x_P = KB_CENTER_X - x_p, y_P = y_p, z_P = z_p - KEY_FRONT_Z
// (floor y = 0, white-key front plane z = 0, keyboard centre x = 0, treble at -x). Pure data from scene/src/piano/layout.js.
import * as L from '../../scene/src/piano/layout.js';

export { L as LAYOUT_MODULE };
export const KB_CENTER_X = L.KB_CENTER_X;
export const KEY_FRONT_Z = L.KEY_FRONT_Z;
export const toP = ([x, y, z]) => [L.KB_CENTER_X - x, y, z - L.KEY_FRONT_Z];
export const fromP = ([x, y, z]) => [L.KB_CENTER_X - x, y, z + L.KEY_FRONT_Z];
/** pianist frame -> rig frame (the pianist group sits at (0, -0.04, KEY_FRONT_Z) in the rig) */
export const pToRig = ([x, y, z]) => [x, y + L.RIG_Y_OFFSET, z + L.KEY_FRONT_Z];

const PIV_Y = L.BALANCE_AXIS.y, PIV_Z = L.BALANCE_AXIS.z - L.KEY_FRONT_Z;   // balance axis in P (z 0.268)
export const WHITE_TOP_Y = L.WHITE_TOP_Y, BLACK_TOP_Y = L.BLACK_TOP_Y;
export const FALLBOARD_Z = L.KEYBOARD.fallboardFaceZ - L.KEY_FRONT_Z;   // 0.150
export const FALLBOARD_Y0 = L.LAYOUT.keyboard.fallboardOpen.y[0];        // 0.729 (lower edge of the open fallboard)
export const KEYSLIP_TOP_Y = L.KEYBOARD.keySlipTopY;                      // 0.702
const K = L.LAYOUT.keyboard;

/** per key (index 0..87) data in P: x range of the head/tail or black top, contact boxes, dip */
export const KEYS = L.KEYS.map((k) => {
  const px = (x) => L.KB_CENTER_X - x;
  const o = { index: k.index, midi: k.midi, name: k.name, black: k.black, topY: k.topY, dipRad: k.dipRad, xCenter: px(k.xCenter) };
  if (k.black) {
    const xs = k.topPolygon.map((p) => px(p[0])), zs = k.topPolygon.map((p) => p[1] - L.KEY_FRONT_Z);
    o.top = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    const bx = k.blackBox.xz.map((p) => px(p[0])), bz = k.blackBox.xz.map((p) => p[1] - L.KEY_FRONT_Z);
    o.box = { x0: Math.min(...bx), x1: Math.max(...bx), z0: Math.min(...bz), z1: Math.max(...bz), y0: k.blackBox.yMin, y1: k.blackBox.yMax };
    o.frontTopZ = K.black.frontZ + K.black.frontSlope - L.KEY_FRONT_Z;      // 0.058: front edge of the flat top
    o.frontBaseZ = K.black.frontZ - L.KEY_FRONT_Z;                         // 0.051
  } else {
    const hx = k.head.map((p) => px(p[0])); const tx = k.tail.map((p) => px(p[0]));
    o.head = { x0: Math.min(...hx), x1: Math.max(...hx), z0: 0, z1: K.headLen };
    o.tail = { x0: Math.min(...tx), x1: Math.max(...tx), z0: K.headLen, z1: FALLBOARD_Z };
  }
  return o;
});
export const keyByMidi = (m) => KEYS[m - 21];

/** a rest-pose point (P frame) on key i moved by key angle a (rad, + = front down) */
export function keyPointP(i, a, [x, y, z]) {
  const c = Math.cos(a), s = Math.sin(a); const yy = y - PIV_Y, zz = z - PIV_Z;
  return [x, PIV_Y + yy * c + zz * s, PIV_Z - yy * s + zz * c];
}
/** key top normal at angle a */
export const keyNormalP = (a) => [0, Math.cos(a), -Math.sin(a)];
/** height of key i's top surface above plan point z (P) at angle a (flat top, exact) */
export function keyTopYAtP(i, z, a) {
  const k = KEYS[i];
  // the top plane passes through keyPointP(i, a, [*, topY, z0]) with normal n; solve for the point above plan z
  const p0 = keyPointP(i, a, [0, k.topY, PIV_Z]); const n = keyNormalP(a);
  // n.y (y - p0y) + n.z (z - p0z) = 0
  return p0[1] - n[2] * (z - p0[2]) / n[1];
}

/** contact box (P) where a fingertip pad centre may land: white head (front 50 mm) or the flat black top */
export function contactBox(i, isThumb, lat = 0) {
  const k = KEYS[i];
  if (k.black) {
    const zf = k.frontTopZ;
    return isThumb ? { x0: k.top.x0 + 0.0035, x1: k.top.x1 - 0.0035, z0: zf + 0.0015, z1: zf + 0.020 }   // fix round 1: the thumb may take a black key right at its front edge (was +4 mm)
      : { x0: k.top.x0 + 0.0035, x1: k.top.x1 - 0.0035, z0: zf + 0.008, z1: zf + 0.028 };
  }
  // white: inside the head with the whole pad on the key (a pressed key sinks 10 mm below its neighbours, so a pad
  // overhanging the gap cuts into the next key). Long fingers prefer the head: the 12.4-13.1 mm tails between the
  // black keys are narrower than the fingertips, and a deep pad puts the nail into the black key's front face once the
  // white key is down (critic: R2/R3/R4 into A#4/F#5 up to 6 mm), so the tail now ends at 64 mm (was 65).
  const h = k.head; const half = (h.x1 - h.x0) / 2, c = (h.x0 + h.x1) / 2;
  if (isThumb) {
    // the thumb plays on its RADIAL corner (its lowest point); the rest of the tip rises toward the index side. Its
    // support point therefore sits 2-6 mm radial of the key centre, so the ulnar flesh stays over its own key and does
    // not sink into the neighbour toward the fingers while the key is down (radial = -lat: +x for the RH, -x for the LH)
    if (lat) { const a = c - lat * 0.002, b = c - lat * 0.006; return { x0: Math.min(a, b), x1: Math.max(a, b), z0: 0.008, z1: 0.036 }; }
    const s = Math.max(0.0004, half - 0.0100); return { x0: c - s, x1: c + s, z0: 0.008, z1: 0.036 };
  }
  // ... but a hand whose thumb or other fingers sit on black keys must play its white keys between the black keys (the
  // thumb is the shortest finger: with it on a black key the long fingers land 50-60 mm in). The tail stays allowed up
  // to 64 mm (centred in the slot by clampContact); the keyframe's natural landing only goes there when the hand is deep,
  // and the collision term keeps the flesh off the black keys' sides as far as the slot allows.
  const s = Math.max(0.0004, half - 0.0085);
  return { x0: c - s, x1: c + s, z0: 0.016, z1: 0.064, tail: true };
}
/** clamp a desired pad point (x, z) into key i's playable region for the finger (head rectangle or centred tail) */
export function clampContact(i, isThumb, x, z, lat = 0) {
  const k = KEYS[i]; const b = contactBox(i, isThumb, lat);
  const zc = Math.min(b.z1, Math.max(b.z0, z));
  if (k.black || !b.tail || zc <= 0.046) return [Math.min(b.x1, Math.max(b.x0, x)), zc];
  // on the tail: the gap between the black keys; keep the finger centred (its tip is ~13-16 mm wide)
  const t = k.tail; const c = (t.x0 + t.x1) / 2; const slack = Math.max(0.0004, (t.x1 - t.x0 - 0.0125) / 2);
  const s = smooth01((zc - 0.046) / 0.008);   // blend from the head clamp to the tail clamp over 8 mm
  const xh = Math.min(b.x1, Math.max(b.x0, x)), xt = Math.min(c + slack, Math.max(c - slack, x));
  return [xh + (xt - xh) * s, zc];
}
const smooth01 = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };

/** which key (index) is under plan point (x, z) in P, or -1. Black keys first. */
export function keyAtP(x, z) {
  for (const k of KEYS) if (k.black && x >= k.box.x0 && x <= k.box.x1 && z >= k.box.z0 && z <= k.box.z1) return k.index;
  for (const k of KEYS) if (!k.black) {
    if (z >= 0 && z <= k.head.z1 && x >= k.head.x0 && x <= k.head.x1) return k.index;
    if (z > k.tail.z0 && z <= k.tail.z1 && x >= k.tail.x0 && x <= k.tail.x1) return k.index;
  }
  return -1;
}
/** white keys sorted by x (P) for fast lookup */
const WHITE = KEYS.filter((k) => !k.black).sort((a, b) => a.head.x0 - b.head.x0);
const BLACKS = KEYS.filter((k) => k.black).sort((a, b) => a.box.x0 - b.box.x0);
export const KEYBOARD_X = [Math.min(...WHITE.map((k) => k.head.x0)), Math.max(...WHITE.map((k) => k.head.x1))];
export function whiteKeyAtX(x) {
  let lo = 0, hi = WHITE.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; const k = WHITE[m]; if (x < k.head.x0 - 0.0006) hi = m - 1; else if (x > k.head.x1 + 0.0006) lo = m + 1; else return k; }
  return null;
}
export function blackKeysNearX(x, r) {
  // BLACKS sorted by x0 (boxes do not overlap): binary search the first box that may reach x - r
  let lo = 0, hi = BLACKS.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (BLACKS[m].box.x1 <= x - r) lo = m + 1; else hi = m; }
  const out = []; for (let i = lo; i < BLACKS.length && BLACKS[i].box.x0 < x + r; i++) out.push(BLACKS[i]);
  return out;
}

/**
 * Lowest height of a pad sphere centre (x, z, radius r) that clears the key bed at rest: white key tops everywhere over
 * the keyboard, black-key boxes only where the sphere actually overlaps them horizontally (a fingertip beside a black
 * key does not need to rise over it).
 */
export function sphereClearY(x, z, r) {
  let y = -1;
  if (x > KEYBOARD_X[0] - r && x < KEYBOARD_X[1] + r && z > -0.004 - r && z < FALLBOARD_Z) y = WHITE_TOP_Y + r;
  for (const k of blackKeysNearX(x, r + 0.001)) {
    const b = k.top;   // flat top rectangle (front slope ignored: it only lowers the requirement)
    const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0, dz = z < k.box.z0 ? k.box.z0 - z : z > b.z1 ? z - b.z1 : 0;
    const dh = Math.hypot(dx, dz); if (dh >= r) continue;
    y = Math.max(y, k.box.y1 + Math.sqrt(r * r - dh * dh));
  }
  return y;
}

/**
 * Signed penetration of a point into the key bed geometry given current key angles (Float32Array 88).
 * Returns { depth (m, > 0 = inside), key (index), part } for the deepest solid among: white key bodies, black key bodies,
 * fallboard, key slip. Only meaningful for points near the keyboard.
 */
export function penetrationP(p, angles) {
  const [x, y, z] = p; let best = { depth: -1, key: -1, part: '' };
  if (y > 0.80 || y < 0.60) return best;
  // fallboard (open): solid slab behind the visible keys from y0 upward
  if (z > FALLBOARD_Z && z < FALLBOARD_Z + 0.03 && y > FALLBOARD_Y0 && x > KEYBOARD_X[0] - 0.05 && x < KEYBOARD_X[1] + 0.05) {
    const d = Math.min(z - FALLBOARD_Z, y - FALLBOARD_Y0); if (d > best.depth) best = { depth: d, key: -1, part: 'fallboard' };
  }
  // key slip (front rail, below the key tops)
  if (z < 0 && z > -0.020 && y < KEYSLIP_TOP_Y) { const d = Math.min(KEYSLIP_TOP_Y - y, -z); if (d > best.depth) best = { depth: d, key: -1, part: 'keyslip' }; }
  if (z < -0.002 || z > FALLBOARD_Z) return best;
  // black keys (boxes rotated about the balance axis: transform the point into the key's rest frame)
  for (const k of blackKeysNearX(x, 0.002)) {
    const a = angles ? angles[k.index] : 0; const q = keyPointP(k.index, -a, p);   // inverse rotation
    const b = k.box; if (q[0] < b.x0 || q[0] > b.x1 || q[2] < b.z0 || q[2] > b.z1 || q[1] < b.y0 || q[1] > b.y1) continue;
    const d = Math.min(q[0] - b.x0, b.x1 - q[0], q[2] - b.z0, b.y1 - q[1]);
    if (d > best.depth) best = { depth: d, key: k.index, part: 'black' };
  }
  // white keys: head or tail rectangle, from the top surface down 23.5 mm
  const cand = [];
  for (let dx = -1; dx <= 1; dx++) { const w = whiteKeyAtX(x + dx * 0.0235); if (w && !cand.includes(w)) cand.push(w); }
  for (const k of cand) {
    const a = angles ? angles[k.index] : 0; const q = keyPointP(k.index, -a, p);
    const r = q[2] <= k.head.z1 ? k.head : k.tail;
    if (q[0] < r.x0 || q[0] > r.x1 || q[2] < r.z0 || q[2] > r.z1) continue;
    if (q[1] > k.topY || q[1] < k.topY - 0.0235) continue;
    const d = Math.min(k.topY - q[1], q[0] - r.x0, r.x1 - q[0], q[2] < 0.002 ? q[2] + 0.0235 : 1);
    if (d > best.depth) best = { depth: d, key: k.index, part: 'white' };
  }
  return best;
}
export const PEDALS = L.PEDALS;
export const PEDAL_MAX_RAD = L.PEDAL_MAX_RAD;
export const BENCH = L.BENCH;
export const RIPPLE_SOURCES = L.RIPPLE_SOURCES;
export const DAMPED_NOTES = L.DAMPED_NOTES;
export const LAYOUT = L.LAYOUT;
export const KEY_DIP_RAD = L.KEY_DIP_RAD;
