// Check slab caps against their plan polygons: top-cap triangles whose centroid lies outside the polygon (or inside a
// hole) mean the cap triangulation covers an opening (self-intersecting inset ring -> earcut garbage).
//   node tools/piano/check_caps.mjs
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
import { LAYOUT as L } from '../../scene/src/piano/layout.js';
import { SLAB_WARNINGS } from '../../scene/src/piano/geom/util.js';

const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const inPg = (p, pg) => inside(p, pg.outer) && !(pg.holes || []).some((h) => inside(p, h));
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', placeInRig: false } } });
console.log(`roundedSlab caps whose triangulated area differs from the inset outline by > 1 %: ${SLAB_WARNINGS.length}`,
  SLAB_WARNINGS.slice(0, 8).map((w) => `\n  ${w.which} n=${w.n} expect ${w.expect.toFixed(5)} got ${w.got.toFixed(5)} at ${w.at.replace(/\s+/g, ' ')}`).join(''));
const checks = { plateWeb: L.plate.web, pinblock: L.plate.frontPlate, soundboard: L.soundboard };
P.group.updateMatrixWorld(true);
for (const [name, polys] of Object.entries(checks)) {
  P.group.traverse((o) => {
    if (!o.isMesh || o.name !== name) return;
    const g = o.geometry; const pos = g.attributes.position, nr = g.attributes.normal; const idx = g.index;
    let bad = 0, badArea = 0, topArea = 0; const ex = [];
    const n = idx ? idx.count : pos.count;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let t = 0; t < n; t += 3) {
      const ii = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      if (ii.some((i) => Math.abs(nr.getY(i)) < 0.999)) continue;          // caps only (flat, normal +-y)
      ii.forEach((i, k) => v[k].fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
      const area = new THREE.Triangle(v[0], v[1], v[2]).getArea();
      const c = [(v[0].x + v[1].x + v[2].x) / 3, (v[0].z + v[1].z + v[2].z) / 3];
      topArea += area;
      if (!polys.some((pg) => inPg(c, pg))) { bad++; badArea += area; if (ex.length < 5) ex.push(c.map((q) => q.toFixed(3)).join(',')); }
    }
    console.log(`${name}: cap area ${topArea.toFixed(4)} m2, triangles outside the plan ${bad} (${(badArea * 1e4).toFixed(1)} cm2)`, ex.join(' | '));
  });
}
