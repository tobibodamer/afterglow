// Hammer-vs-neighbour sweep test (round 2, after the critic's build/qc/piano_r2_c1/hammer_pairs.mjs / hammer_depth.mjs):
// hammer i swings from rest to the strike angle in 8 steps while its neighbours i-1 and i+1 rest; at each step every
// vertex of the swinging head (felt, underfelt, molding) is tested inside the neighbour's head meshes and vice versa
// (ray parity along 3 directions, all odd = inside). Also reports the x clearance margin by shifting the neighbour away.
//   node tools/piano/check_hammer_sweep.mjs [first=1] [last=30]
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
const first = +(process.argv[2] ?? 1), last = +(process.argv[3] ?? 30);
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', fallboardMirror: 'off', armMirror: 'off', placeInRig: false, bench: false } } });
const IMs = ['hammerFelt', 'hammerUnderfelt', 'hammerMolding'].map((nm) => P.group.getObjectByName(nm));
const m = new THREE.Matrix4(), v = new THREE.Vector3(); const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const rc = new THREE.Raycaster();
const dirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.31, 0.88, 0.36).normalize(), new THREE.Vector3(-0.4, 0.2, 0.89).normalize()];
const meshesOf = (i, dx) => IMs.map((im) => { im.getMatrixAt(i, m); const mm = new THREE.Mesh(im.geometry, mat); mm.matrixAutoUpdate = false; mm.matrixWorld.copy(m).premultiply(im.matrixWorld); mm.matrixWorld.elements[12] += dx; mm.geometry.computeBoundingBox(); mm.userData.bb = mm.geometry.boundingBox.clone().applyMatrix4(mm.matrixWorld); return mm; });
const inside = (mesh, p) => mesh.userData.bb.containsPoint(p) && dirs.every((d) => { rc.set(p, d); return rc.intersectObject(mesh, false).length % 2 === 1; });
function count(i, j, dx = 0) {
  const A = meshesOf(i, 0), B = meshesOf(j, dx); let c = 0;
  for (const a of A) { const pa = a.geometry.attributes.position; for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k).applyMatrix4(a.matrixWorld); for (const b of B) if (inside(b, v)) c++; } }
  return c;
}
const pose = (i, f) => { const ang = new Float32Array(88); ang[i] = P.hammerStrikeAngles[i] * f; P.setHammerAngles(ang); P.update(0); P.group.updateMatrixWorld(true); };
let bad = 0; const lines = [];
for (let n = first; n <= last; n++) {
  const i = n - 1; let worst = 0, worstMargin = 1;
  for (const j of [i - 1, i + 1]) {
    if (j < 0 || j > 87) continue;
    for (let q = 1; q <= 8; q++) { pose(i, q / 8); worst = Math.max(worst, count(i, j) + count(j, i)); }
    // margin: shift the resting neighbour TOWARD the swinging one until a vertex enters (max over the swing: q 4 and 8)
    const s = Math.sign(P.layout.notes[j].hammer_x - P.layout.notes[i].hammer_x);
    for (const q of [4, 8]) {
      pose(i, q / 8); let lo = 0, hi = 0.004;
      if (count(j, i, -s * hi) + count(i, j, 0) === 0) { worstMargin = Math.min(worstMargin, hi); continue; }
      for (let it = 0; it < 8; it++) { const mid = (lo + hi) / 2; const meshesJ = meshesOf(j, -s * mid); let c = 0; const A = meshesOf(i, 0); for (const a of A) { const pa = a.geometry.attributes.position; for (let k = 0; k < pa.count && !c; k++) { v.fromBufferAttribute(pa, k).applyMatrix4(a.matrixWorld); for (const b of meshesJ) if (inside(b, v)) { c++; break; } } } if (c) hi = mid; else lo = mid; }
      worstMargin = Math.min(worstMargin, lo);
    }
  }
  if (worst) bad++;
  lines.push(`note ${String(n).padStart(2)}: vertices inside a resting neighbour over the swing ${worst}, x margin >= ${(worstMargin * 1000).toFixed(2)} mm`);
}
console.log(lines.join('\n'));
console.log(bad ? `FAIL: ${bad} note(s) collide with a neighbour` : `ok: no hammer-vs-neighbour contact over the swing (notes ${first}-${last})`);
