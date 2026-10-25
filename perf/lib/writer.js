// perf.json + perf.bin writer (DESIGN.md section 4 data contract).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function writePerf(outDir, res, extraMeta = {}) {
  const { meta, bones, boneData, rootPos, rootS, keyArrays, ripples } = res;
  const N = meta.N, NB = bones.length;
  const channels = []; let off = 0;
  for (const b of bones) { channels.push({ name: b, kind: 'quat', offset: off, size: 4 }); off += 4; }
  channels.push({ name: 'root.position', kind: 'vec3', offset: off, size: 3 }); off += 3;
  channels.push({ name: 'keys', kind: 'keys', offset: off, size: 88, unit: 'rad', note: 'key angle about the balance axis, + = front down; index 0 = A0' }); off += 88;
  channels.push({ name: 'hammers', kind: 'hammers', offset: off, size: 88, unit: 'rad', note: 'hammer rotation about the flange pin, 0 = rest (geom/action.js convention)' }); off += 88;
  channels.push({ name: 'dampers', kind: 'dampers', offset: off, size: 88, unit: 'm', note: 'damper lift (notes 1-67; 0 above)' }); off += 88;
  channels.push({ name: 'pedals', kind: 'pedals', offset: off, size: 3, unit: 'rad', note: '[una corda, sostenuto, damper] pedal angles, + = tip down' }); off += 3;
  const stride = off; for (const c of channels) c.stride = stride;
  const F = new Float32Array(N * stride);
  for (let i = 0; i < N; i++) {
    const o = i * stride;
    F.set(boneData.subarray(i * NB * 4, (i + 1) * NB * 4), o);
    if (rootS) { F[o + NB * 4] = rootS[i * 3]; F[o + NB * 4 + 1] = rootS[i * 3 + 1]; F[o + NB * 4 + 2] = rootS[i * 3 + 2]; }
    else { F[o + NB * 4] = rootPos[0]; F[o + NB * 4 + 1] = rootPos[1]; F[o + NB * 4 + 2] = rootPos[2]; }
    F.set(keyArrays.keys.subarray(i * 88, (i + 1) * 88), o + NB * 4 + 3);
    F.set(keyArrays.ham.subarray(i * 88, (i + 1) * 88), o + NB * 4 + 3 + 88);
    F.set(keyArrays.damp.subarray(i * 88, (i + 1) * 88), o + NB * 4 + 3 + 176);
    F.set(keyArrays.ped.subarray(i * 3, (i + 1) * 3), o + NB * 4 + 3 + 264);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const bin = Buffer.from(F.buffer, F.byteOffset, F.byteLength);
  const sha = crypto.createHash('sha256').update(bin).digest('hex');
  fs.writeFileSync(path.join(outDir, 'perf.bin'), bin);
  const json = {
    format: 'afterglow-perf', version: 1,
    rate: meta.rate, t0: meta.t0, musicOffset: meta.musicOffset, frames: N, stride, duration: (N - 1) / meta.rate,
    frame: 'bone quaternions are FULL local rotations (x,y,z,w) replacing the bind local rotation of the named bone of the pianist GLB (rig.json); root.position is the root bone local position in the GLB frame (floor y = 0, white-key front plane z = 0, keyboard centre x = 0, treble at -x). The pianist group sits in the rig at (0, -0.04, KEY_FRONT_Z) with no rotation. Ripple positions are in the rig frame on the water surface.',
    channels, bones,
    ripples,
    sha256: sha,
    ...extraMeta,
  };
  fs.writeFileSync(path.join(outDir, 'perf.json'), JSON.stringify(json));
  return { stride, bytes: bin.length, sha };
}
