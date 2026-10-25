// Debug an inset ring: node tools/piano/diag_inset.mjs  (pinblock outline from geom/interior.js logic)
import * as THREE from 'three';
import { roundedOutline, polygonNormals, ensureCCW } from '../../scene/src/piano/geom/util.js';
import { LAYOUT as L } from '../../scene/src/piano/layout.js';

const e = L.plate.frontBackEdge;
const zBack = (x) => { let k = 1; while (k < e.length - 1 && e[k][0] < x) k++; const a = e[k - 1], b = e[k]; return a[1] + (b[1] - a[1]) * THREE.MathUtils.clamp((x - a[0]) / (b[0] - a[0]), 0, 1); };
const xL = L.rimThickness + 0.0005, xR = L.caseWidth - L.rimThickness - 0.0005, zF = L.plate.frontEdgeZ + 0.004;
const back = [];
for (let i = 0; i <= 48; i++) { const x = xL + ((xR - xL) * i) / 48; let z = 0, w = 0; for (let k = -3; k <= 3; k++) { const xx = THREE.MathUtils.clamp(x + k * 0.025, xL, xR); const ww = 4 - Math.abs(k); z += ww * zBack(xx); w += ww; } back.push([x, z / w - 0.02]); }
const pb = [[xL, zF], [xR, zF], ...back.reverse()];
const out = ensureCCW(roundedOutline(pb, pb.map((_, i) => (i < 3 || i === pb.length - 1 ? 0.004 : 0)), 3));
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
console.log('n', out.length, 'area', area(out).toFixed(4));
const nrm = polygonNormals(out);
const ins = 0.014;
const r = out.map((p, i) => [p[0] - nrm[i][0] * nrm[i][2] * ins, p[1] - nrm[i][1] * nrm[i][2] * ins]);
console.log('inset area', area(r).toFixed(4));
out.forEach((p, i) => { if (i < 12 || i > out.length - 6) console.log(i, p.map((v) => v.toFixed(4)).join(','), 'n', nrm[i].map((v) => v.toFixed(3)).join(','), '->', r[i].map((v) => v.toFixed(4)).join(',')); });
const { cleanInsetRing } = await import('../../scene/src/piano/geom/util.js');
const cl = cleanInsetRing(out, r.map((p) => new THREE.Vector2(p[0], p[1])));
console.log('cleaned n', cl.length, 'area', area(cl.map((v) => [v.x, v.y])).toFixed(4));
const kept = new Set(cl.map((v) => v.x.toFixed(5) + ',' + v.y.toFixed(5)));
r.forEach((p, i) => { if (!kept.has(p[0].toFixed(5) + ',' + p[1].toFixed(5))) console.log('dropped', i, out[i].map((v) => v.toFixed(4)).join(','), '->', p.map((v) => v.toFixed(4)).join(',')); });
