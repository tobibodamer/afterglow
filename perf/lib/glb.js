// Minimal GLB reader (Node): JSON + BIN chunk, EXT_meshopt_compression (three's meshopt decoder), KHR_mesh_quantization
// (normalized integer attributes; skinned meshes carry the dequantisation in their inverse bind matrices), node
// hierarchy, skinned mesh attributes with BIND-POSE WORLD positions (v = sum_k w_k * M_jk * IBM_jk * v_stored).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

// ---- 4x4 column-major helpers
function m4FromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q; const x2 = x + x, y2 = y + y, z2 = z + z; const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
function m4Mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
const m4Pt = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

let MESHOPT = null;
async function meshopt() {
  if (MESHOPT) return MESHOPT;
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
  const mod = await import(pathToFileURL(path.join(root, 'node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')).href);
  await mod.MeshoptDecoder.ready; MESHOPT = mod.MeshoptDecoder; return MESHOPT;
}

export class GLB {
  constructor(path, buf = null) {
    buf = buf || fs.readFileSync(path);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
    let off = 12; this.json = null; this.bin = null;
    while (off < buf.length) {
      const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4); const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) this.json = JSON.parse(data.toString('utf8'));
      else if (type === 0x004e4942) this.bin = data;
      off += 8 + len;
    }
    const g = this.json; this.nodeParent = new Array(g.nodes.length).fill(-1);
    g.nodes.forEach((n, i) => (n.children || []).forEach((c) => { this.nodeParent[c] = i; }));
    this.views = new Map();
    this.needsDecode = (g.extensionsUsed || []).includes('EXT_meshopt_compression');
  }
  /** async loader: decodes meshopt-compressed buffer views */
  static async load(p) {
    const G = new GLB(p);
    if (G.needsDecode) {
      const D = await meshopt();
      G.json.bufferViews.forEach((bv, i) => {
        const e = bv.extensions && bv.extensions.EXT_meshopt_compression; if (!e) return;
        if (e.buffer !== 0) throw new Error('meshopt source outside the GLB BIN chunk');
        const src = new Uint8Array(G.bin.buffer, G.bin.byteOffset + (e.byteOffset || 0), e.byteLength);
        const dst = new Uint8Array(e.count * e.byteStride);
        D.decodeGltfBuffer(dst, e.count, e.byteStride, src, e.mode, e.filter || 'NONE');
        G.views.set(i, dst);
      });
    }
    return G;
  }
  viewBytes(bvIndex) {
    if (this.views.has(bvIndex)) return { u8: this.views.get(bvIndex), base: 0 };
    const bv = this.json.bufferViews[bvIndex];
    return { u8: this.bin, base: bv.byteOffset || 0 };
  }
  accessor(i) {
    const g = this.json, a = g.accessors[i], bv = g.bufferViews[a.bufferView];
    const [T, bytes] = COMP[a.componentType]; const nc = NCOMP[a.type];
    const stride = bv.byteStride || bytes * nc; const { u8, base: vbase } = this.viewBytes(a.bufferView); const base = vbase + (a.byteOffset || 0);
    const out = new Float32Array(a.count * nc);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const rd = { 5126: (o) => dv.getFloat32(o, true), 5121: (o) => dv.getUint8(o), 5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5120: (o) => dv.getInt8(o), 5122: (o) => dv.getInt16(o, true) }[a.componentType];
    const normMax = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < nc; c++) {
      let v = rd(base + k * stride + c * bytes); if (a.normalized && normMax) v = Math.max(-1, v / normMax); out[k * nc + c] = v;
    }
    return { data: out, count: a.count, nc, T };
  }
  nodeLocal(i) { const n = this.json.nodes[i]; return { t: n.translation || [0, 0, 0], q: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1] }; }
  nodeMatrix(i) { const chain = []; for (let k = i; k >= 0; k = this.nodeParent[k]) chain.unshift(k); let m = m4FromTRS(); for (const k of chain) { const L = this.nodeLocal(k); m = m4Mul(m, m4FromTRS(L.t, L.q, L.s)); } return m; }
  meshNodes() { return this.json.nodes.map((n, i) => ({ i, n })).filter((o) => o.n.mesh !== undefined); }
  /** skinned mesh by node name: bind-pose world positions, joints (indices into jointNames), weights, indices */
  skinnedMesh(nodeName) {
    const g = this.json; const ni = g.nodes.findIndex((n) => n.name === nodeName);
    if (ni < 0) throw new Error(`GLB node ${nodeName} not found; have ${g.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name).join(', ')}`);
    const node = g.nodes[ni]; const mesh = g.meshes[node.mesh]; const skin = g.skins[node.skin];
    const jointNames = skin.joints.map((j) => g.nodes[j].name);
    const ibm = skin.inverseBindMatrices !== undefined ? this.accessor(skin.inverseBindMatrices).data : null;
    const jm = skin.joints.map((j, k) => { const M = this.nodeMatrix(j); return ibm ? m4Mul(M, Array.from(ibm.subarray(k * 16, k * 16 + 16))) : M; });
    const P = [], J = [], W = [], I = []; let vbase = 0;
    for (const prim of mesh.primitives) {
      const pos = this.accessor(prim.attributes.POSITION);
      const jo = this.accessor(prim.attributes.JOINTS_0), we = this.accessor(prim.attributes.WEIGHTS_0);
      const wp = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        let x = 0, y = 0, z = 0, ws = 0;
        for (let k = 0; k < 4; k++) { const w = we.data[v * 4 + k]; if (w <= 0) continue; const p = m4Pt(jm[jo.data[v * 4 + k]], pos.data[v * 3], pos.data[v * 3 + 1], pos.data[v * 3 + 2]); x += w * p[0]; y += w * p[1]; z += w * p[2]; ws += w; }
        wp[v * 3] = x / ws; wp[v * 3 + 1] = y / ws; wp[v * 3 + 2] = z / ws;
      }
      // weights normalised (quantised weights may not sum to exactly 1)
      for (let v = 0; v < pos.count; v++) { let s = 0; for (let k = 0; k < 4; k++) s += we.data[v * 4 + k]; if (s > 0) for (let k = 0; k < 4; k++) we.data[v * 4 + k] /= s; }
      P.push(wp); J.push(jo.data); W.push(we.data);
      if (prim.indices !== undefined) { const idx = this.accessor(prim.indices).data; I.push(Uint32Array.from(idx, (x) => x + vbase)); }
      vbase += pos.count;
    }
    const cat = (arr, T) => { const n = arr.reduce((s, a) => s + a.length, 0); const o = new T(n); let k = 0; for (const a of arr) { o.set(a, k); k += a.length; } return o; };
    return { name: nodeName, count: vbase, positions: cat(P, Float32Array), joints: cat(J, Float32Array), weights: cat(W, Float32Array), indices: I.length ? cat(I, Uint32Array) : null, jointNames };
  }
}
