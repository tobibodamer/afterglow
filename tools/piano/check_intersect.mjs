// (copied from sandbox/piano_critic, critic round 1; kept here as a regression check for the piano module)
// Critic: interpenetration of the moving parts (keys, hammers, dampers, pedals, rods) with every static mesh, per pose.
// Samples vertices of each moving instance; inside test = vertical ray parity (+y) through a 2-D (x,z) triangle grid
// per static mesh, done at two slightly offset (x,z) positions (both must be odd).
//   node tools/piano/check_intersect.mjs [rest|c4|c4strike|all|check] ...
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', placeInRig: false, bench: false } } });
P.group.updateMatrixWorld(true);
const MOVING = /^(keyTop_|keyWood_|keySharp|keyLeverBlack|hammerFelt|hammerUnderfelt|hammerMolding|hammerShank|damperHeads|damperFelt|damperWires|pedal$|pedalRod)/;
const SKIP = /^(lid|prop|flapHinge|desk|bench|rim$|innerRimWood|rimMolding|soundboard$|ribs|braces|longBridge|bassBridge|hitch|redFelts|strings|duplex|cartouche|plateFlanges|plateSlot)/;
const statics = [], movers = [];
P.group.traverse((o) => { if (!o.isMesh || !o.geometry) return; if (MOVING.test(o.name)) movers.push(o); else if (!o.isInstancedMesh && !SKIP.test(o.name)) statics.push(o); });
const CELL = 0.004;
function buildGrid(o) {
  o.updateMatrixWorld(true);
  const g = o.geometry; const pa = g.attributes.position; const idx = g.index ? g.index.array : null;
  const nTri = (idx ? idx.length : pa.count) / 3;
  const tri = new Float32Array(nTri * 9); const a = new THREE.Vector3();
  for (let t = 0; t < nTri; t++) for (let j = 0; j < 3; j++) { const vi = idx ? idx[t * 3 + j] : t * 3 + j; a.fromBufferAttribute(pa, vi).applyMatrix4(o.matrixWorld); tri.set([a.x, a.y, a.z], t * 9 + j * 3); }
  const cells = new Map(); const box = new THREE.Box3();
  for (let t = 0; t < nTri; t++) {
    const xs = [tri[t * 9], tri[t * 9 + 3], tri[t * 9 + 6]], zs = [tri[t * 9 + 2], tri[t * 9 + 5], tri[t * 9 + 8]];
    const i0 = Math.floor(Math.min(...xs) / CELL), i1 = Math.floor(Math.max(...xs) / CELL), k0 = Math.floor(Math.min(...zs) / CELL), k1 = Math.floor(Math.max(...zs) / CELL);
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) { const key = i * 100000 + k; let c = cells.get(key); if (!c) { c = []; cells.set(key, c); } c.push(t); }
    for (let j = 0; j < 3; j++) box.expandByPoint(a.set(tri[t * 9 + j * 3], tri[t * 9 + j * 3 + 1], tri[t * 9 + j * 3 + 2]));
  }
  return { o, tri, cells, box };
}
function parityUp(G, x, y, z) {
  const c = G.cells.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)); if (!c) return 0;
  let n = 0; const T = G.tri;
  for (const t of c) {
    const o = t * 9;
    const ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-14) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const yy = l1 * T[o + 1] + l2 * T[o + 4] + l3 * T[o + 7];
    if (yy > y) n++;
  }
  return n;
}
const inside = (G, p) => (parityUp(G, p.x + 1.3e-5, p.y, p.z + 0.7e-5) % 2 === 1) && (parityUp(G, p.x - 0.9e-5, p.y, p.z - 1.1e-5) % 2 === 1);
const m = new THREE.Matrix4(), v = new THREE.Vector3();
function run(label, pose) {
  P.setPose(pose); P.update(0, null); P.group.updateMatrixWorld(true);
  const grids = statics.map(buildGrid);
  const hits = new Map();
  for (const mv of movers) {
    const pp = mv.geometry.attributes.position; const step = Math.max(1, Math.floor(pp.count / 400));
    const count = mv.isInstancedMesh ? mv.count : 1;
    for (let i = 0; i < count; i++) {
      if (mv.isInstancedMesh) { mv.getMatrixAt(i, m); m.premultiply(mv.matrixWorld); } else m.copy(mv.matrixWorld);
      for (let k = 0; k < pp.count; k += step) {
        v.fromBufferAttribute(pp, k).applyMatrix4(m);
        for (const G of grids) {
          if (!G.box.containsPoint(v)) continue;
          if (inside(G, v)) { const key = `${mv.name} -> ${G.o.name}`; const e = hits.get(key) || { inst: new Set(), n: 0 }; e.inst.add(i); e.n++; hits.set(key, e); }
        }
      }
    }
  }
  console.log(`\n[${label}]`);
  if (!hits.size) console.log('  none');
  for (const [k, e] of [...hits.entries()].sort()) console.log(`  ${k.padEnd(40)} instances ${[...e.inst].slice(0, 44).join(',')}${e.inst.size > 44 ? ' ...' : ''} (${e.n} sampled verts)`);
}
const all = {}; const isB = P.layout.keys.map((k) => k.color === 'black');
for (let n = 1; n <= 88; n++) all[n] = isB[n - 1] ? 2.46 : 2.14;
const allStrike = {}; for (let n = 1; n <= 88; n++) allStrike[n] = 1;
const allCheck = {}; for (let n = 1; n <= 88; n++) allCheck[n] = P.hammerCheckAngles[n - 1] / P.hammerStrikeAngles[n - 1];
const args = process.argv.slice(2);
const want = (k) => !args.length || args.includes(k);
if (want('rest')) run('rest', {});
if (want('c4')) run('keys 40/41/42 full dip + sustain full (fallback hammers = check, dampers by rule)', { keys: { 40: 2.14, 41: 2.46, 42: 2.14 }, pedals: [0, 0, 4.16] });
if (want('c4strike')) run('keys 40/41/42 + hammers at strike + sustain', { keys: { 40: 2.14, 41: 2.46, 42: 2.14 }, hammers: { 40: 1, 41: 1, 42: 1 }, pedals: [0, 0, 4.16] });
if (want('all')) run('ALL keys full dip + all pedals full (fallback hammers at check)', { keys: all, pedals: [3.47, 3.47, 4.16] });
if (want('allstrike')) run('ALL keys full dip + ALL hammers at strike', { keys: all, hammers: allStrike });
if (want('una')) run('una corda full only', { pedals: [3.47, 0, 0] });
