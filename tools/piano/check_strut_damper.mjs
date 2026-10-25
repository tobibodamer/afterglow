// (copied from sandbox/piano_critic, critic round 1; kept here as a regression check for the piano module)
// Critic: strut C/D cross-section x-extent vs the neighbouring damper (head + felt) x-extent at the damper line, and the
// hammer-to-strut clearance at the strike point, per height.   node tools/piano/check_strut_damper.mjs
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', placeInRig: false, bench: false } } });
P.group.updateMatrixWorld(true);
const strut = P.group.getObjectByName('struts');
strut.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const rc = new THREE.Raycaster();
const A = P.parts.action;
function strutX(xc, y, z) {
  // cast from far left and far right along x at (y, z) and keep hits within 4 cm of xc
  const hits = [];
  for (const [o, d] of [[[xc - 0.06, y, z], [1, 0, 0]], [[xc + 0.06, y, z], [-1, 0, 0]]]) {
    rc.set(new THREE.Vector3(...o), new THREE.Vector3(...d)); rc.far = 0.12;
    const h = rc.intersectObject(strut, false); if (h.length) hits.push(h[0].point.x);
  }
  return hits.length === 2 ? hits.sort((a, b) => a - b) : null;
}
const m = new THREE.Matrix4(), v = new THREE.Vector3();
function instX(name, idx) {
  const im = P.group.getObjectByName(name); const pa = im.geometry.attributes.position; im.getMatrixAt(idx, m); m.premultiply(im.matrixWorld);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k).applyMatrix4(m); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); }
  return { x0, x1, y0, y1, z0, z1 };
}
const flatIdx = (n) => A.dampers.filter((d) => !d.wedge).findIndex((d) => d.n === n);
for (const [a, b] of [[39, 40], [57, 58]]) {
  const da = A.dampers.find((d) => d.n === a), db = A.dampers.find((d) => d.n === b);
  const z = (da.c[1] + db.c[1]) / 2, xc = (da.c[0] + db.c[0]) / 2;
  const ha = instX('damperHeads', A.dampers.indexOf(da)), hb = instX('damperHeads', A.dampers.indexOf(db));
  const fa = instX('damperFeltFlat', flatIdx(a)), fb = instX('damperFeltFlat', flatIdx(b));
  console.log(`dampers ${a}|${b} at z ${z.toFixed(3)}: head ${a} x ..${ha.x1.toFixed(4)} (y ${ha.y0.toFixed(3)}-${ha.y1.toFixed(3)}), head ${b} x ${hb.x0.toFixed(4)}.. ; felt ${a} x ..${fa.x1.toFixed(4)} (y ${fa.y0.toFixed(3)}-${fa.y1.toFixed(3)}), felt ${b} x ${fb.x0.toFixed(4)}..`);
  for (const y of [0.864, 0.868, 0.872, 0.876, 0.882, 0.888, 0.891]) {
    const s = strutX(xc, y, z);
    if (!s) { console.log(`  y ${y}: strut not hit`); continue; }
    const head = y >= ha.y0; const L = head ? ha.x1 : fa.x1, R = head ? hb.x0 : fb.x0;
    console.log(`  y ${y}: strut x ${s[0].toFixed(4)}..${s[1].toFixed(4)} (w ${((s[1] - s[0]) * 1000).toFixed(1)} mm); overlap with ${head ? 'head' : 'felt'} ${a}: ${((L - s[0]) * 1000).toFixed(1)} mm, ${b}: ${((s[1] - R) * 1000).toFixed(1)} mm (positive = inside)`);
  }
}
// hammers next to struts at the layout strike point (what a corrected strike would need)
for (const [a, b] of [[39, 40], [57, 58], [20, 21], [76, 77]]) {
  const qa = P.layout.notes[a - 1], qb = P.layout.notes[b - 1];
  const z = (qa.strike_xz[1] + qb.strike_xz[1]) / 2, xc = (qa.hammer_x + qb.hammer_x) / 2;
  const W = (n) => (0.0115 + (0.0100 - 0.0115) * (n - 1) / 87) / 2;
  const row = [];
  for (const y of [0.835, 0.845, 0.852, 0.858, 0.862]) { const s = strutX(xc, y, z); row.push(s ? `y${y}: strut ${((s[1] - s[0]) * 1000).toFixed(1)} mm, clear ${((s[0] - (qa.hammer_x + W(a))) * 1000).toFixed(1)}/${(((qb.hammer_x - W(b)) - s[1]) * 1000).toFixed(1)} mm` : `y${y}: -`); }
  console.log(`hammers ${a}|${b} at strike z ${z.toFixed(3)}: ` + row.join('; '));
}
