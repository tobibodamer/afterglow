// Pedal loft diagnostics: per station (ring) the side-midpoint and top-midpoint position + normal.
import * as THREE from 'three';
import { buildLegs } from '../../scene/src/piano/geom/legs.js';
import { createMaterials } from '../../scene/src/piano/materials.js';
import { LAYOUT as L } from '../../scene/src/piano/layout.js';

const M = createMaterials(L, {});
const legs = buildLegs(L, M);
let geo = null;
legs.group.traverse((o) => { if (o.isMesh && o.name === 'pedal' && !geo) geo = o.geometry; });
const pos = geo.attributes.position, nr = geo.attributes.normal;
const nR = 36;
const rows = Math.floor(pos.count / nR);
console.log('verts', pos.count, 'rings ~', rows);
for (let r = 0; r < rows; r++) {
  let iSide = -1, iTop = -1, bx = -1, by = -1;
  for (let j = 0; j < nR; j++) { const i = r * nR + j; if (pos.getX(i) > bx) { bx = pos.getX(i); iSide = i; } if (pos.getY(i) > by) { by = pos.getY(i); iTop = i; } }
  const f = (i) => `${pos.getZ(i).toFixed(4)} y${pos.getY(i).toFixed(4)} x${pos.getX(i).toFixed(4)} n(${nr.getX(i).toFixed(3)},${nr.getY(i).toFixed(3)},${nr.getZ(i).toFixed(3)})`;
  if (r % 2 === 0 || r > rows - 16) console.log(String(r).padStart(3), 'side', f(iSide), ' top', f(iTop));
}
