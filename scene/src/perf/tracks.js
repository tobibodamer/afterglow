// Performance-track reader (browser + Node, no dependencies). DESIGN.md section 4 / docs/PERFORMANCE.md.
// perf.bin: float32 little-endian frames at `rate` Hz in MUSIC time from t0 (= -MUSIC_OFFSET, i.e. film t = 0);
// perf.json: { rate, t0, musicOffset, frames, stride, channels:[{name, kind, offset, size, stride}], bones, ripples }.
//   bone channels  kind 'quat', size 4: FULL local quaternion (x, y, z, w) replacing the bone's local rotation
//   'root.position' kind 'vec3': local position of the root bone (GLB/pianist frame)
//   'keys' / 'hammers' (rad), 'dampers' (m) size 88 each; 'pedals' size 3 (una corda, sostenuto, damper; rad)
// Sampling: linear between frames (nlerp for quaternions), clamped at both ends. tFilm = frame / 60.
//
//   const perf = await loadPerf('/build/anim/perf.json', '/build/anim/perf.bin');
//   perf.sampleBones(t, out)   // out[name] = [x, y, z, w]
export function fromBuffers(json, arrayBuffer) {
  const meta = typeof json === 'string' ? JSON.parse(json) : json;
  const buf = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
  const F = new Float32Array(buf);
  const rate = meta.rate, t0 = meta.t0, stride = meta.stride, frames = meta.frames, musicOffset = meta.musicOffset ?? 4.0;
  if (F.length < frames * stride) throw new Error(`perf.bin too short: ${F.length} < ${frames * stride}`);
  const byName = new Map(meta.channels.map((c) => [c.name, c]));
  const quatCh = meta.channels.filter((c) => c.kind === 'quat');
  const bones = quatCh.map((c) => c.name);
  const loc = (tFilm) => {
    const s = ((tFilm - musicOffset) - t0) * rate;
    const i0 = Math.max(0, Math.min(frames - 1, Math.floor(s))); const i1 = Math.min(frames - 1, i0 + 1);
    const f = s <= 0 ? 0 : Math.min(1, Math.max(0, s - i0));
    return [i0 * stride, i1 * stride, f];
  };
  const lin = (name) => {
    const c = byName.get(name); if (!c) return () => null;
    return (tFilm, out) => {
      const [a, b, f] = loc(tFilm); const o = out || new Float32Array(c.size);
      for (let k = 0; k < c.size; k++) { const x = F[a + c.offset + k], y = F[b + c.offset + k]; o[k] = x + (y - x) * f; }
      return o;
    };
  };
  const api = {
    meta, rate, t0, frames, stride, musicOffset,
    duration: (frames - 1) / rate,            // film seconds covered (film t = 0 at sample 0)
    bones,
    ripples: meta.ripples || [],
    sampleBones(tFilm, outObj = {}) {
      const [a, b, f] = loc(tFilm);
      for (const c of quatCh) {
        const o = outObj[c.name] || (outObj[c.name] = [0, 0, 0, 1]);
        let x0 = F[a + c.offset], y0 = F[a + c.offset + 1], z0 = F[a + c.offset + 2], w0 = F[a + c.offset + 3];
        let x1 = F[b + c.offset], y1 = F[b + c.offset + 1], z1 = F[b + c.offset + 2], w1 = F[b + c.offset + 3];
        if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
        const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, z = z0 + (z1 - z0) * f, w = w0 + (w1 - w0) * f;
        const l = Math.hypot(x, y, z, w) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; o[3] = w / l;
      }
      return outObj;
    },
    sampleRoot: lin('root.position'),
    sampleKeys: lin('keys'),
    sampleHammers: lin('hammers'),
    sampleDampers: lin('dampers'),
    samplePedals: lin('pedals'),
    /** generic channel sampler by name */
    sample(name, tFilm, out) { return lin(name)(tFilm, out); },
  };
  return api;
}

export async function loadPerf(jsonUrl, binUrl) {
  const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!(process.versions && process.versions.node);
  if (isNode && !/^https?:/i.test(jsonUrl)) {
    const fs = await import('node:fs/promises');
    const [j, b] = await Promise.all([fs.readFile(jsonUrl, 'utf8'), fs.readFile(binUrl)]);
    return fromBuffers(JSON.parse(j), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  const [jr, br] = await Promise.all([fetch(jsonUrl), fetch(binUrl)]);
  if (!jr.ok || !br.ok) throw new Error(`perf tracks not found (${jsonUrl}: ${jr.status}, ${binUrl}: ${br.status})`);
  return fromBuffers(await jr.json(), await br.arrayBuffer());
}
