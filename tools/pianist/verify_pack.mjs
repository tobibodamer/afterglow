// Verify the packed GLB against the raw export: same meshes / vertex counts / joints, and the geometric error that
// quantization adds, measured in the bind pose through the skin (positions are skinned with each file's own inverse bind
// matrices, so a quantization transform folded into the IBMs is accounted for).
//   node tools/pianist/verify_pack.mjs build/pianist/work/pianist_raw.glb assets/pianist/pianist.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [rawPath, packPath] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [A, B] = [await io.read(rawPath), await io.read(packPath)];

function mat4mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function apply(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }
function skinnedPositions(doc) {
  const out = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const skin = node.getSkin();
    const joints = skin ? skin.listJoints() : [];
    const ibm = skin ? skin.getInverseBindMatrices() : null;
    const jm = joints.map((j, i) => { const w = j.getWorldMatrix(); const b = ibm ? ibm.getElement(i, []) : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; return mat4mul(w, b); });
    mesh.listPrimitives().forEach((prim, pi) => {
      const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const n = P.getCount(), arr = new Float64Array(n * 3), p = [], j = [], w = [];
      for (let i = 0; i < n; i++) {
        P.getElement(i, p);
        let q = [0, 0, 0];
        if (J && W && jm.length) {
          J.getElement(i, j); W.getElement(i, w);
          const ws = w[0] + w[1] + w[2] + w[3] || 1;
          for (let k = 0; k < 4; k++) { if (!w[k]) continue; const t = apply(jm[j[k]], p); q[0] += t[0] * w[k] / ws; q[1] += t[1] * w[k] / ws; q[2] += t[2] * w[k] / ws; }
        } else q = apply(node.getWorldMatrix(), p);
        arr.set(q, i * 3);
      }
      out.set(`${node.getName()}#${pi}:${prim.getMaterial()?.getName()}`, arr);
    });
  }
  return out;
}
const SA = skinnedPositions(A), SB = skinnedPositions(B);
const rows = [];
for (const [k, a] of SA) {
  const b = SB.get(k);
  if (!b) { rows.push({ prim: k, status: 'missing in packed' }); continue; }
  if (a.length !== b.length) { rows.push({ prim: k, status: `vertex count ${a.length / 3} vs ${b.length / 3} (reordered/deduped)` }); continue; }
  // meshopt reorders vertices: compare by nearest neighbour on a coarse hash grid
  const grid = new Map(), cell = 0.002;
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < b.length; i += 3) { const kk = key(b[i], b[i + 1], b[i + 2]); (grid.get(kk) || grid.set(kk, []).get(kk)).push(i); }
  let max = 0, sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const cx = Math.floor(a[i] / cell), cy = Math.floor(a[i + 1] / cell), cz = Math.floor(a[i + 2] / cell); let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) { const d = Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1], a[i + 2] - b[j + 2]); if (d < best) best = d; }
    }
    max = Math.max(max, best); sum += best;
  }
  rows.push({ prim: k, verts: a.length / 3, meanErrMm: +(sum / (a.length / 3) * 1000).toFixed(4), maxErrMm: +(max * 1000).toFixed(4) });
}
for (const [k, b] of SB) if (!SA.has(k)) rows.push({ prim: k, verts: b.length / 3, status: 'packed only (added by pack.mjs)' });
console.table(rows);
const ja = A.getRoot().listSkins()[0].listJoints().map((j) => j.getName()), jb = B.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
console.log('joints raw', ja.length, 'packed', jb.length, 'same order', ja.join() === jb.join(), 'skins raw/packed', A.getRoot().listSkins().length, B.getRoot().listSkins().length);
