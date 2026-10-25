// Room for the damper wires behind the resting hammers (session 5): per damped note, the hammer head's rearmost point
// at rest inside the wire band (y 0.765..0.87), the current wire z, the belly line, in mm relative to the strike point.
//   node tools/piano/damper_room.mjs
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', placeInRig: false, bench: false } } });
P.group.updateMatrixWorld(true);
const L = P.layout;
const m = new THREE.Matrix4(), v = new THREE.Vector3();
const heads = ['hammerFelt', 'hammerMolding'].map((n) => P.group.getObjectByName(n));
const belly = (x) => L.bellyRail[0][1] + (L.bellyRail[1][1] - L.bellyRail[0][1]) * (x - L.bellyRail[0][0]) / (L.bellyRail[1][0] - L.bellyRail[0][0]);
const wires = P.group.getObjectByName('damperWires');
const rows = [];
const D = P.parts.action.dampers;
for (let i = 0; i < 88; i++) {
  let zMax = -1e9;
  for (const im of heads) {
    const pa = im.geometry.attributes.position; im.getMatrixAt(i, m); m.premultiply(im.matrixWorld);
    for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k).applyMatrix4(m); if (v.y > 0.765 && v.y < 0.87) zMax = Math.max(zMax, v.z); }
  }
  rows.push({ n: i + 1, zMax, strike: L.notes[i].strike_xz[1], x: L.notes[i].hammer_x });
}
console.log(' n  headBack(mm)  belly(mm)  damperC(mm)  wireZ(mm)   (all relative to the strike z)');
D.forEach((d, j) => {
  const r = rows[d.n - 1], r2 = rows[Math.min(87, d.n)];
  wires.getMatrixAt(j, m); m.premultiply(wires.matrixWorld); v.set(0, 0, 0).applyMatrix4(m);
  if ([1, 10, 20, 21, 30, 40, 50, 55, 60, 62, 64, 66, 67].includes(d.n))
    console.log(String(d.n).padStart(2), ((Math.max(r.zMax, r2.zMax) - r.strike) * 1000).toFixed(1).padStart(10), ((belly(r.x) - r.strike) * 1000).toFixed(1).padStart(10),
      ((d.c[1] - r.strike) * 1000).toFixed(1).padStart(10), ((v.z - r.strike) * 1000).toFixed(1).padStart(10));
});
