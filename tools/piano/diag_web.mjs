import * as THREE from 'three';
import { roundedOutline, polygonNormals, ensureCCW, ensureCW } from '../../scene/src/piano/geom/util.js';
import { LAYOUT as L } from '../../scene/src/piano/layout.js';

const pg = L.plate.web[0];
const out = ensureCCW(roundedOutline(pg.outer, pg.outer.map(() => 0.0), 3));
const holes = pg.holes.map((h) => ensureCW(h.slice()));
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
console.log('outline pts', out.length, 'area', area(out).toFixed(4), 'holes', holes.map((h) => area(h).toFixed(4)).join(','));
// duplicate / near-duplicate points
let dups = 0; for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6) dups++; }
console.log('consecutive duplicates', dups);
const segX = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
const selfX = (r) => { const hits = []; for (let i = 0; i < r.length; i++) for (let j = i + 2; j < r.length; j++) { if (i === 0 && j === r.length - 1) continue; if (segX(r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length])) hits.push([i, j]); } return hits; };
console.log('self-intersections raw', selfX(out).length);
for (const ins of [0.004, 0.0015]) {
  const nrm = polygonNormals(out);
  const r = out.map((p, i) => [p[0] - nrm[i][0] * nrm[i][2] * ins, p[1] - nrm[i][1] * nrm[i][2] * ins]);
  const sx = selfX(r);
  let maxMiter = 0, at = -1; nrm.forEach((n, i) => { if (n[2] > maxMiter) { maxMiter = n[2]; at = i; } });
  console.log('inset', ins, 'self-intersections', sx.length, sx.slice(0, 5).map(([i, j]) => `${i}:${r[i].map((v) => v.toFixed(3))} x ${j}`).join(' '), 'max miter', maxMiter.toFixed(2), 'at', at, out[at]);
  const tris = THREE.ShapeUtils.triangulateShape(r.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const all = r.concat(...holes);
  let ta = 0, big = 0; for (const t of tris) { const [a, b, c] = t.map((k) => all[k]); const A = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; ta += A; if (A > 0.05) big++; }
  console.log('  earcut tris', tris.length, 'area', ta.toFixed(4), 'big', big);
}
// raw earcut
{
  const tris = THREE.ShapeUtils.triangulateShape(out.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const all = out.concat(...holes); let ta = 0; for (const t of tris) { const [a, b, c] = t.map((k) => all[k]); ta += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; }
  console.log('raw earcut area', ta.toFixed(4));
}
// holes vs outline proximity
const minD = (h) => { let m = 9; for (const p of h) for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; const vx = b[0] - a[0], vz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / (vx * vx + vz * vz + 1e-12))); m = Math.min(m, Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t)); } return m; };
console.log('hole min distance to outline', holes.map((h) => minD(h).toFixed(4)).join(','));
