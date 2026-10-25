// CPU G-buffer of the piano for a shot camera (no GPU): world position, smooth normal, part and material class per
// pixel, by a plain z-buffer rasterizer over every mesh (instances expanded). Used by tools/piano/lacquer_emu.py to
// tune the art-directed lacquer offline while the shared GPU is busy (docs/PIANO.md section 6).
//   node tools/piano/gbuffer.mjs <shots.json> <outDir> [--only a,b] [--size 960x540]
// Writes <outDir>/<shot>_gb.bin (Float32: px py pz nx ny nz per pixel, rig frame) + <shot>_gb_id.bin (Uint8: part*16 +
// material class) + <shot>_gb.json (camera, size, rigYaw, class names). Part: 0 none, 1 lid, 2 case side, 3 desk,
// 4 legs/lyre/pedals, 5 prop, 6 bench, 7 other. Material class: 0 none, 1 lacquer (case), 2 lacquer leg, 3 other.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';

const args = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const outDir = args[1]; fs.mkdirSync(outDir, { recursive: true });
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const only = opt('only', null);
const [W, H] = String(opt('size', '960x540')).split('x').map(Number);

const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', fallboardMirror: 'off', armMirror: 'off', placeInRig: true, bench: true } } });
P.update(0, null);
P.group.updateMatrixWorld(true);
const legs = new Set(); P.parts.legs.group.traverse((o) => legs.add(o));
const bench = new Set(); if (P.parts.bench) P.parts.bench.group.traverse((o) => bench.add(o));
const SIDE = /^(rim|rimMolding|armBass|armTreble|cheekBass|cheekTreble|keySlip|keybedFront|deskRail)$/;
const partOf = (o) => bench.has(o) ? 6 : legs.has(o) ? 4 : /^(lid|flap)/.test(o.name) ? 1 : /^prop/.test(o.name) ? 5 : (/^desk/.test(o.name) && o.name !== 'deskRail') ? 3 : SIDE.test(o.name) ? 2 : 7;
const matOf = (o) => { const n = (o.material && (o.material.userData.agName || o.material.name)) || ''; return /^lacquerLeg/.test(n) ? 2 : /^lacquer/.test(n) ? 1 : 3; };

// flatten every mesh into world-space (rig frame) triangles with vertex normals
const tris = [];   // per mesh: { pos: Float32Array (9 per tri), nrm: Float32Array (9 per tri), id }
const v = new THREE.Vector3(), nm = new THREE.Matrix3(), mw = new THREE.Matrix4(), tmp = new THREE.Matrix4();
P.group.traverse((o) => {
  if (!o.isMesh || !o.visible) return;
  let vis = true; for (let q = o; q; q = q.parent) if (q.visible === false) vis = false; if (!vis) return;
  const g = o.geometry; const pa = g.attributes.position, na = g.attributes.normal; if (!pa) return;
  const idx = g.index ? g.index.array : null; const nt = idx ? idx.length / 3 : pa.count / 3;
  const mats = [];
  if (o.isInstancedMesh) for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, tmp); mats.push(new THREE.Matrix4().multiplyMatrices(o.matrixWorld, tmp)); }
  else mats.push(o.matrixWorld.clone());
  const id = (partOf(o) << 4) | matOf(o);
  for (const m of mats) {
    nm.getNormalMatrix(m);
    const pos = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9);
    for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) {
      const vi = idx ? idx[3 * t + c] : 3 * t + c;
      v.fromBufferAttribute(pa, vi).applyMatrix4(m); pos[9 * t + 3 * c] = v.x; pos[9 * t + 3 * c + 1] = v.y; pos[9 * t + 3 * c + 2] = v.z;
      if (na) { v.fromBufferAttribute(na, vi).applyMatrix3(nm).normalize(); } else v.set(0, 1, 0);
      nrm[9 * t + 3 * c] = v.x; nrm[9 * t + 3 * c + 1] = v.y; nrm[9 * t + 3 * c + 2] = v.z;
    }
    tris.push({ pos, nrm, id });
  }
});
console.log(`[gbuffer] ${tris.reduce((a, b) => a + b.pos.length / 9, 0)} triangles`);

for (const shot0 of job.shots) {
  if (only && !only.split(',').includes(shot0.name)) continue;
  const c = { ...((job.defaults || {}).cam || {}), ...(shot0.cam || {}) };
  let pos = c.posRig, tgt = c.targetRig || c.target;
  if (c.alpha !== undefined) { const a = (c.alpha * Math.PI) / 180; const t = c.target || [0, 0.9, 1.0]; pos = [t[0] - Math.sin(a) * c.dist, c.h, t[2] - Math.cos(a) * c.dist]; tgt = t; }
  const mm = c.mm || 50, vfov = 2 * Math.atan((36 / (W / H) / 2) / mm), near = c.near || 0.05;   // 36 mm wide sensor (core)
  const cam = new THREE.PerspectiveCamera((vfov * 180) / Math.PI, W / H, near, 200);
  cam.position.set(...pos); cam.lookAt(new THREE.Vector3(...tgt)); cam.updateMatrixWorld(true);
  const view = cam.matrixWorldInverse.elements, f = 1 / Math.tan(vfov / 2), asp = W / H;
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const gb = new Float32Array(W * H * 6), gid = new Uint8Array(W * H);
  const sx = new Float32Array(3), sy = new Float32Array(3), sw = new Float32Array(3), cz = new Float32Array(3);
  for (const T of tris) {
    const { pos: p, nrm: n, id } = T;
    for (let t = 0; t < p.length; t += 9) {
      let behind = false;
      for (let k = 0; k < 3; k++) {
        const x = p[t + 3 * k], y = p[t + 3 * k + 1], z = p[t + 3 * k + 2];
        const ex = view[0] * x + view[4] * y + view[8] * z + view[12];
        const ey = view[1] * x + view[5] * y + view[9] * z + view[13];
        const ez = view[2] * x + view[6] * y + view[10] * z + view[14];
        if (ez > -near) { behind = true; break; }
        const iw = 1 / -ez;
        sx[k] = (ex * f / asp * iw * 0.5 + 0.5) * W; sy[k] = (0.5 - ey * f * iw * 0.5) * H; sw[k] = iw; cz[k] = -ez;
      }
      if (behind) continue;
      const minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2]))), maxX = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
      const minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2]))), maxY = Math.min(H - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
      if (minX > maxX || minY > maxY) continue;
      const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (Math.abs(area) < 1e-12) continue;
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const X = px + 0.5, Y = py + 0.5;
        let w0 = ((sx[1] - X) * (sy[2] - Y) - (sx[2] - X) * (sy[1] - Y)) / area;
        let w1 = ((sx[2] - X) * (sy[0] - Y) - (sx[0] - X) * (sy[2] - Y)) / area;
        let w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // perspective-correct weights
        const q0 = w0 * sw[0], q1 = w1 * sw[1], q2 = w2 * sw[2], qs = q0 + q1 + q2;
        const a0 = q0 / qs, a1 = q1 / qs, a2 = q2 / qs;
        const depth = a0 * cz[0] + a1 * cz[1] + a2 * cz[2];
        const pi = py * W + px;
        if (depth >= zbuf[pi]) continue;
        zbuf[pi] = depth;
        const o = pi * 6;
        for (let k = 0; k < 3; k++) {
          gb[o + k] = a0 * p[t + k] + a1 * p[t + 3 + k] + a2 * p[t + 6 + k];
          gb[o + 3 + k] = a0 * n[t + k] + a1 * n[t + 3 + k] + a2 * n[t + 6 + k];
        }
        gid[pi] = id;
      }
    }
  }
  fs.writeFileSync(path.join(outDir, `${shot0.name}_gb.bin`), Buffer.from(gb.buffer));
  fs.writeFileSync(path.join(outDir, `${shot0.name}_gb_id.bin`), Buffer.from(gid.buffer));
  fs.writeFileSync(path.join(outDir, `${shot0.name}_gb.json`), JSON.stringify({ W, H, camPos: pos, camTarget: tgt, mm, rigYaw: shot0.rigYaw ?? 120, parts: ['none', 'lid', 'side', 'desk', 'legs', 'prop', 'bench', 'other'], mats: ['none', 'lacquer', 'lacquerLeg', 'other'] }));
  let cov = 0; for (let i = 0; i < gid.length; i++) if (gid[i]) cov++;
  console.log(`[gbuffer] ${shot0.name}: ${cov} piano pixels`);
}
