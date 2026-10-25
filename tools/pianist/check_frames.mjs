// Numerical frame check: pianist GLB bind fingertips (rig.json) placed at (0, RIG_Y_OFFSET, KEY_FRONT_Z) vs the piano's
// key geometry (scene/src/piano/layout.js). Prints, for each fingertip, the nearest key, the lateral offset from its
// centre, the height above its top and the distance behind the key front.
//   node tools/pianist/check_frames.mjs [assets/pianist/rig.json]
import fs from 'node:fs';
import { KEYS, KEY_FRONT_Z, RIG_Y_OFFSET, pianoToRig, KB_CENTER_X, WHITE_TOP_Y } from '../../scene/src/piano/layout.js';

const rig = JSON.parse(fs.readFileSync(process.argv[2] || new URL('../../assets/pianist/rig.json', import.meta.url), 'utf8'));
const J = Object.fromEntries(rig.joints.map((j) => [j.name, j]));
const qrot = (q, v) => {   // rotate v by quaternion q (x,y,z,w)
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function worldQ(name) { const j = J[name]; return j.parent ? qmul(worldQ(j.parent), j.q) : j.q; }
const place = (p) => [p[0], p[1] + RIG_Y_OFFSET, p[2] + KEY_FRONT_Z];
const out = [];
for (const s of ['L', 'R']) for (let f = 1; f <= 5; f++) {
  const n = `finger${f}-3_${s}`; const j = J[n];
  const dir = qrot(worldQ(n), [0, 1, 0]);
  const tipG = j.world_pos.map((v, i) => v + dir[i] * j.length);
  const tip = place(tipG);
  // nearest key by rig x (keys: piano frame x_center -> rig)
  let best = null;
  for (const k of KEYS) {
    const kx = KB_CENTER_X - k.xCenter;
    const d = Math.abs(kx - tip[0]);
    if (!best || d < best.d) best = { k, d, kx };
  }
  const topRig = best.k.topY + RIG_Y_OFFSET;
  out.push({ finger: `${s}${f}`, tip: tip.map((v) => +v.toFixed(4)), key: best.k.name, keyColor: best.k.color,
    lateralFromKeyCentre_mm: +((tip[0] - best.kx) * 1000).toFixed(1), aboveKeyTop_mm: +((tip[1] - topRig) * 1000).toFixed(1),
    behindKeyFront_mm: +((tip[2] - KEY_FRONT_Z) * 1000).toFixed(1) });
}
console.table(out);
console.log('white top (rig y)', WHITE_TOP_Y + RIG_Y_OFFSET, 'key front (rig z)', KEY_FRONT_Z, 'rig of E4|F4 boundary x = 0:', pianoToRig([KB_CENTER_X, 0, 0]));
