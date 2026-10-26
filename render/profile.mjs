// Per-pass GPU profile of film frames (scene/src/core/profiler.js): where a frame's time goes, pass by pass.
//   node render/profile.mjs --shots all --size 1080p --N 1            the middle frame of every shot
//   node render/profile.mjs --frames 1500,4200 --size 720p --N 1 --repeat 6 --top 25
// Options:
//   --frames list | --shots all|S03,S06    --size 1080p|720p|WxH   --N 1   --quality final|preview   --repeat 4 (first dropped)
//   --init '{json}' (extra AG.init options)   --opts '{json}' (extra renderFrame options)   --top 15 (passes listed per frame)
//   --out build/profile/<tag>.json   --tag name
// Times are medians over the kept repeats. GPU = the frame's GPU work (timer queries); CPU = JS time inside render calls;
// wall = the page's renderFrame time (includes the GPU sync).
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './lib/session.mjs';
import { parseArgs, parseSize, parseFrameList, readJsonArg } from './lib/util.mjs';

const a = parseArgs();
const size = a.size === '720p' ? '1280x720' : a.size;
const [W, H] = parseSize(size, [1920, 1080]);
const repeat = Math.max(2, +(a.repeat || 4));
const N = +(a.N || 1);
const top = +(a.top || 15);
const tag = a.tag || `${W}x${H}_N${N}`;
const out = path.resolve(a.out || `build/profile/${tag}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });

const init = { quality: a.quality || 'final', profile: true, ...(readJsonArg(a.init) || {}) };
const frameOpts = { N, ...(readJsonArg(a.opts) || {}) };
const S = await openSession({ width: W, height: H, init });
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : 0; };
const results = [];
try {
  let frames = a.frames !== undefined ? parseFrameList(a.frames) : [];
  if (a.shots) {
    const shots = await S.page.evaluate(async () => (await import('/scene/src/camera/shots.js')).SHOTS.map((s) => ({ id: s.id, t0: s.t0, t1: s.t1 })));
    const want = a.shots === 'all' || a.shots === true ? null : new Set(String(a.shots).split(','));
    for (const s of shots) if (!want || want.has(s.id)) frames.push(Math.round(((s.t0 + s.t1) / 2) * 60));
  }
  if (!frames.length) frames = [1500];
  console.log(`[profile] ${W}x${H} N=${N} gpu="${S.info.gpu.renderer}" frames=${frames.length} repeat=${repeat}`);
  for (const f of frames) {
    const runs = [];
    for (let i = 0; i < repeat; i++) runs.push(await S.renderFrame(f, { ...frameOpts, transfer: 'none' }));
    const kept = runs.slice(1);
    if (!kept[0].profile?.gpuTimers) throw new Error('no EXT_disjoint_timer_query_webgl2 in this browser: GPU times unavailable');
    const byKey = new Map();
    for (const r of kept) for (const n of r.profile.nodes) { if (!byKey.has(n.key)) byKey.set(n.key, []); byKey.get(n.key).push(n); }
    const passes = [...byKey].filter(([, ns]) => ns.some((n) => n.gpu > 0 || n.draws > 0 || n.cpu > 0.05)).map(([key, ns]) => ({ key, gpu: median(ns.map((n) => n.gpu)), cpu: median(ns.map((n) => n.cpu)), calls: ns[0].calls, draws: ns[0].draws, prims: ns[0].prims }))
      .sort((x, y) => y.gpu - x.gpu);
    const phases = {};
    for (const p of passes) { const ph = p.key.split('>')[0]; phases[ph] = +((phases[ph] || 0) + p.gpu).toFixed(3); }
    const res = {
      frame: f, shot: kept[0].shot, N: kept[0].N,
      gpuMs: median(kept.map((r) => r.profile.gpuMs)), cpuMs: median(kept.map((r) => r.profile.cpuMs)), wallMs: median(kept.map((r) => r.timings.total)),
      jsMs: Object.fromEntries(Object.keys(kept[0].timings).map((k) => [k, median(kept.map((r) => r.timings[k]))])),
      draws: kept[0].profile.draws, prims: kept[0].profile.prims, disjoint: kept.some((r) => r.profile.disjoint), phases, passes,
    };
    results.push(res);
    console.log(`\n[profile] f${f} ${res.shot}  GPU ${res.gpuMs.toFixed(2)} ms  CPU(render) ${res.cpuMs.toFixed(2)} ms  wall ${res.wallMs.toFixed(1)} ms  draws ${res.draws}  prims ${(res.prims / 1e6).toFixed(2)} M${res.disjoint ? '  (DISJOINT: discard)' : ''}`);
    console.log('  phases ' + Object.entries(phases).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | '));
    const cpuTop = [...passes].sort((x, y) => y.cpu - x.cpu).slice(0, 6).map((p) => `${p.key.split('>').pop()} ${p.cpu.toFixed(2)}`).join(' | ');
    console.log('  cpu top ' + cpuTop);
    for (const p of passes.filter((x) => x.gpu > 0 || x.draws > 0 || x.cpu > 0.05).slice(0, top)) console.log(`  ${p.gpu.toFixed(3).padStart(8)} gpu ${p.cpu.toFixed(2).padStart(6)} cpu ${String(p.draws).padStart(5)} dr ${(p.prims / 1e3).toFixed(0).padStart(6)} kprim  x${p.calls}  ${p.key}`);
  }
} finally {
  await S.close();
}
fs.writeFileSync(out, JSON.stringify({ command: process.argv.slice(1).join(' '), width: W, height: H, N, init, frameOpts, info: S.info, results }, null, 1));
const sorted = [...results].sort((x, y) => y.gpuMs - x.gpuMs);
console.log(`\n[profile] GPU ms per frame: median ${median(results.map((r) => r.gpuMs)).toFixed(2)}, worst ${sorted[0]?.gpuMs.toFixed(2)} (${sorted[0]?.shot}) -> ${path.relative(process.cwd(), out)}`);
