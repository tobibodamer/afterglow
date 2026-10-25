// Cycle 2: clearance check of a box in the piano frame against every other mesh's vertices (instanced meshes included).
// Default box = the raised pin-block cover (case.js pinblockFront, y 0.719 .. 0.9845, z 0.250 .. 0.2555) above the old
// top 0.848. Prints the meshes with vertices inside the box (shrunk by 0.2 mm) and the nearest vertices behind it.
//   node tools/piano/check_panel.mjs [x0 x1 y0 y1 z0 z1]
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', fallboardMirror: 'off', armMirror: 'off', pinMirror: 'off', placeInRig: false, bench: false } } });
P.group.updateMatrixWorld(true);
const L = P.layout, a = process.argv.slice(2).map(Number);
const [x0, x1, y0, y1, z0, z1] = a.length === 6 ? a : [L.rimThickness, L.caseWidth - L.rimThickness, 0.848, 0.9845, 0.250, 0.2555];
const e = 0.0002, v = new THREE.Vector3(), m = new THREE.Matrix4();
const hits = new Map(); let nearZ = Infinity, nearName = '';
P.group.traverse((o) => {
  if (!o.isMesh || !o.geometry || o.name === 'pinblockFront') return;
  const pa = o.geometry.attributes.position; const n = o.isInstancedMesh ? o.count : 1;
  for (let i = 0; i < n; i++) {
    if (o.isInstancedMesh) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); } else m.copy(o.matrixWorld);
    for (let j = 0; j < pa.count; j++) {
      v.fromBufferAttribute(pa, j).applyMatrix4(m);
      if (v.x > x0 + e && v.x < x1 - e && v.y > y0 + e && v.y < y1 - e) {
        if (v.z > z0 + e && v.z < z1 - e) hits.set(o.name, (hits.get(o.name) || 0) + 1);
        else if (v.z >= z1 && v.z < nearZ) { nearZ = v.z; nearName = o.name; }
      }
    }
  }
});
console.log(`box x ${x0.toFixed(4)}..${x1.toFixed(4)} y ${y0}..${y1} z ${z0}..${z1}`);
console.log(hits.size ? 'INSIDE: ' + [...hits].map(([k, c]) => `${k} ${c}`).join(', ') : 'inside: none');
console.log(`nearest vertex behind the box (same x/y range): z ${nearZ.toFixed(4)} (${nearName}), clearance ${((nearZ - z1) * 1000).toFixed(2)} mm`);
