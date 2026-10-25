const { makeHeightField } = await import('../../scene/src/world/terrain.js');
const pm = await import('../../scene/src/world/params.js');
const P = pm.PARAMS || pm.default || pm.params || Object.values(pm).find((v) => v && v.terrain);
const h = makeHeightField(P.terrain);
let t0 = performance.now(), n = 0, s = 0;
const N = 512, el = new Float32Array(N);
for (let i = 0; i < N; i++) { const a = ((i + 0.5) / N) * 2 * Math.PI - Math.PI, dx = Math.cos(a), dz = Math.sin(a); let b = -0.2; for (let d = 15; d < 60000; d *= 1.02) { const y = h(dx * d, dz * d); n++; const e = Math.atan2(y - 0.9, d) - d / 12.742e6; if (e > b) b = e; } el[i] = b; }
console.log('calls', n, 'ms', (performance.now() - t0).toFixed(0));
const deg = Array.from(el, (e) => e * 180 / Math.PI);
// azimuth convention: a = atan2(z, x); sun at -z => a = -90 deg
const at = (A) => { const i = Math.floor(((A + 180) / 360) * N) % N; return deg[i].toFixed(2); };
console.log('a=-90 (sun, -z):', at(-90), ' a=-80:', at(-80), ' a=-100:', at(-100), ' a=0 (+x):', at(0), ' a=90 (+z):', at(90), ' a=180:', at(179));
const srt = [...deg].sort((p, q) => p - q); console.log('p10', srt[51].toFixed(2), 'p50', srt[256].toFixed(2), 'p98', srt[501].toFixed(2), 'max', srt[511].toFixed(2));
let line = ''; for (let i = 0; i < N; i += 16) line += deg[i].toFixed(1) + ' '; console.log(line);
