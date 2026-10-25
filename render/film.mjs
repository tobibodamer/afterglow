// Film driver: the presets of scene/src/film.config.js on top of render.mjs / encode.mjs (docs/INTEGRATION.md).
//
//   node render/film.mjs plan   [--preset final-1080p] [--timings sandbox/integration/out/v1/stills.json]
//   node render/film.mjs render --preset final-1080p [--from A --to B] [--per-session K] [--force|--rerender-stale]
//   node render/film.mjs encode --preset final-1080p [--from A --to B] [--out file.mp4] [--archive prores] [--master]
//   node render/film.mjs clip   --preset check-1080p --from A --to B --name hands      -> build/out/test_hands.mp4
//
// render: chunks of the preset's length; every group of K chunks runs in its OWN render.mjs process (= its own browser
// session and its own hold of the machine-wide GPU lock, render/lib/gpulock.mjs), so other GPU users get the slot
// between groups and no session runs for hours. K = --per-session, default the preset's perSession (final presets 4,
// so the film pays 12 session starts instead of 47; check / animatic presets 1). Same resumable chunk files and
// manifests as render.mjs: re-running the same command skips complete chunks.
// encode: always muxes the approved soundtrack (film.config AUDIO: afterglow_film.wav at --offset 0).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from './lib/util.mjs';
import { PRESETS, AUDIO, presetSize, filmPlan } from '../scene/src/film.config.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const a = parseArgs();
const cmd = process.argv[2];
const P = PRESETS[a.preset || 'final-1080p'];
if (!P) { console.error(`unknown preset "${a.preset}" (${Object.keys(PRESETS).join(', ')})`); process.exit(2); }
const [W, H] = presetSize(P);
const plan = await filmPlan();
const from = +(a.from ?? 0), to = +(a.to ?? plan.frames);
const chunk = +(a.chunk ?? P.chunk);
const chunksDir = a.chunks || P.chunks;

function run(args, label) {
  console.log(`[film] node ${args.join(' ')}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`[film] ${label} failed with exit ${r.status}`); process.exit(r.status || 1); }
}
function renderArgs(f0, f1) {
  const args = ['render/render.mjs', '--from', String(f0), '--to', String(f1), '--chunk', String(chunk), '--size', `${W}x${H}`, '--quality', P.quality, '--out', chunksDir];
  if (P.N) args.push('--N', String(P.N));
  for (const k of ['force', 'rerender-stale', 'verify']) if (a[k]) args.push(`--${k}`);
  if (a.opts) args.push('--opts', a.opts);
  if (a.init) args.push('--init', a.init);
  return args;
}
function doRender() {
  // chunk boundaries are multiples of the chunk length from `from` (the same grid render.mjs uses)
  // default: the preset's perSession (final presets 4: 12 session starts of 65-180 s for the film instead of 47,
  // sandbox/integration/out/estimate.json; check/animatic presets 1)
  const per = Math.max(1, +(a['per-session'] ?? P.perSession ?? 1));
  for (let s = from; s < to; s += chunk * per) run(renderArgs(s, Math.min(to, s + chunk * per)), `render ${s}`);
}
function doEncode(out) {
  const args = ['render/encode.mjs', '--chunks', chunksDir, '--from', String(from), '--to', String(to), '--audio', AUDIO.file, '--offset', String(AUDIO.offset), '--out', out];
  if (a.archive) args.push('--archive', a.archive);
  if (a.master) args.push('--master');
  if (a['allow-mixed']) args.push('--allow-mixed');
  if (a['no-verify']) args.push('--no-verify');
  run(args, 'encode');
}

if (cmd === 'plan') {
  const N = P.N;
  const subs = plan.subframes(N);
  console.log(`film: ${plan.frames} frames (${plan.end.toFixed(3)} s) at ${plan.fps} fps; preset ${a.preset || 'final-1080p'} ${W}x${H} ${P.quality} N=${N ?? 'per shot'}: ${subs} sub-frames (${(subs / plan.frames).toFixed(2)} per frame)`);
  let T = null;
  if (a.timings) {
    // per-shot cost model from measured stills: ms(frame) = fixed + perSub * N (both from the measurement at its own N)
    const st = JSON.parse(fs.readFileSync(path.resolve(ROOT, a.timings), 'utf8'));
    T = new Map();
    for (const r of st) { const e = T.get(r.shot) || []; e.push(r); T.set(r.shot, e); }
  }
  let total = 0;
  for (const s of plan.shots) {
    const n = N ?? s.N;
    let est = '';
    if (T && T.get(s.id)) {
      const rs = T.get(s.id), sub = rs.reduce((x, r) => x + r.timings.subframes / r.N, 0) / rs.length, fix = rs.reduce((x, r) => x + (r.timings.total - r.timings.subframes), 0) / rs.length;
      const ms = fix + sub * n; total += ms * s.frames; est = `  est ${(ms / 1000).toFixed(2)} s/frame -> ${(ms * s.frames / 3.6e6).toFixed(2)} h`;
    }
    console.log(`${s.id.padEnd(5)} ${String(s.name).padEnd(28)} ref ${String(s.ref ?? '-').padStart(2)}  frames ${String(s.f0).padStart(5)}-${String(s.f1).padEnd(5)} (${String(s.frames).padStart(4)})  N ${String(n).padStart(2)}  preblur ${s.preblur}  cheat ${s.cheatDeg}${est}`);
  }
  if (T) console.log(`estimated total: ${(total / 3.6e6).toFixed(1)} h (measured stills scaled to N; machine load changes this by up to ~15x, docs/RENDERING.md section 7)`);
} else if (cmd === 'render') {
  doRender();
} else if (cmd === 'encode') {
  doEncode(a.out || P.out);
} else if (cmd === 'clip') {
  if (a.from === undefined || a.to === undefined || !a.name) { console.error('clip needs --from --to --name'); process.exit(2); }
  doRender();
  doEncode(a.out || `build/out/test_${a.name}.mp4`);
} else {
  console.error('usage: node render/film.mjs plan|render|encode|clip --preset <name> (see the header)');
  process.exit(2);
}
