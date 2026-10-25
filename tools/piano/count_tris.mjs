// Build the piano module in Node (no renderer) and report triangles / draw calls per mesh name.
//   node tools/piano/count_tris.mjs [--top 30]
import { create } from '../../scene/src/piano/index.js';
const t0 = Date.now();
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off' } } });
const by = new Map(); let tris = 0, draws = 0;
P.group.traverse((m) => {
  if (!m.isMesh || !m.geometry) return;
  const g = m.geometry; const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (m.isInstancedMesh ? m.count : 1);
  tris += n; draws++;
  const e = by.get(m.name) || { tris: 0, draws: 0 }; e.tris += n; e.draws++; by.set(m.name, e);
});
const top = [...by.entries()].sort((a, b) => b[1].tris - a[1].tris);
const ti = process.argv.indexOf('--top'); const k = ti >= 0 ? +process.argv[ti + 1] : 30;
for (const [name, e] of top.slice(0, k)) console.log(name.padEnd(28), String(Math.round(e.tris)).padStart(9), 'tris', String(e.draws).padStart(3), 'draws');
console.log('TOTAL', Math.round(tris), 'triangles,', draws, 'draw calls, build', Date.now() - t0, 'ms');
