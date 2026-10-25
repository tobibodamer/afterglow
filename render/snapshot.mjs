// Frozen snapshot of everything the render page loads, so renders and checks are immune to concurrent edits of
// scene/ (module owners work in parallel; a file that changes mid-render makes encode.mjs refuse the chunks and makes
// determinism sessions differ). Serve it with AG_SERVE_ROOT=<dir> (render/lib/session.mjs).
//   node render/snapshot.mjs --out build/snap/<name>        -> prints the directory and a content hash
// Copies scene/, assets/pianist/, music/final/score.json, build/anim/perf.{json,bin}; node_modules/three is linked
// (a directory junction: three is pinned by package-lock and nobody edits it).
//
// Provenance gate: the camera's hand track (scene/src/camera/handtrack.json) must be solved from the performance in
// build/anim (its perf.sha256 = perf.json sha256), otherwise the hand-following shots frame where the hands were in an
// older solve (MODULE_ISSUES I-27). Since fix round 4 the snapshot SOLVES ITS OWN TRACK: when the copied track does not
// match the copied perf, the camera's own tool (sandbox/camera/handtrack.mjs + fk.mjs, copied into the snapshot so that
// it resolves the snapshot's rig, perf tracks code, hands.js and score) writes <snap>/scene/src/camera/handtrack.json
// from <snap>/build/anim (--force-regen-handtrack does it even when the copied track matches). So a perf ship can no
// longer strand a freeze on a stale track. --no-regen-handtrack restores
// the old behaviour (refuse unless --allow-stale-handtrack). The result is recorded in SNAPSHOT.json either way.
//
// Integration A/B: --base build/snap/<old> --overlay-integration copies an existing snapshot (same modules, same perf)
// and replaces only the integrator-owned page files with the live ones (scene/index.html, scene/src/main.js,
// scene/src/film.config.js, scene/src/core/, scene/src/integration/), so a before/after isolates the integration change.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, treeHash } from './lib/util.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const a = parseArgs();
const out = path.resolve(ROOT, a.out || `build/snap/snap_${Date.now()}`);
if (fs.existsSync(out)) { console.error(`${out} exists`); process.exit(2); }
const INTEGRATION_FILES = ['scene/index.html', 'scene/src/main.js', 'scene/src/film.config.js', 'scene/src/core', 'scene/src/integration'];

const base = a.base ? path.resolve(ROOT, a.base) : null;
if (base && !a['overlay-integration']) { console.error('--base needs --overlay-integration'); process.exit(2); }
if (base && !fs.existsSync(path.join(base, 'SNAPSHOT.json'))) { console.error(`${base} is not a snapshot`); process.exit(2); }

function handtrackGate(dir) {
  try {
    const ht = JSON.parse(fs.readFileSync(path.join(dir, 'scene/src/camera/handtrack.json'), 'utf8'));
    const perf = JSON.parse(fs.readFileSync(path.join(dir, 'build/anim/perf.json'), 'utf8'));
    const h = ht.perf?.sha256 || null, p = perf.sha256 || null;
    return { ok: !!h && h === p, handtrackPerf: h && h.slice(0, 16), perf: p && p.slice(0, 16), perfCommand: perf.command || null };
  } catch (e) { return { ok: false, error: e.message }; }
}

const srcRoot = base || ROOT;
const pre = handtrackGate(srcRoot);
const regen = !a['no-regen-handtrack'];
if (!pre.ok && !regen && !a['allow-stale-handtrack']) {
  console.error(`refusing: camera handtrack.json was solved from perf ${pre.handtrackPerf} but build/anim holds ${pre.perf} (${pre.perfCommand}). ` +
    'Regenerate it (node sandbox/camera/handtrack.mjs --perf build/anim, camera owner) or pass --allow-stale-handtrack.');
  process.exit(3);
}

fs.mkdirSync(out, { recursive: true });
const copyFrom = (root, rel) => { const src = path.join(root, rel), dst = path.join(out, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true }); };
if (base) {
  for (const rel of ['scene', 'assets/pianist', 'music/final/score.json', 'build/anim/perf.json', 'build/anim/perf.bin']) copyFrom(base, rel);
  for (const rel of INTEGRATION_FILES) { fs.rmSync(path.join(out, rel), { recursive: true, force: true }); copyFrom(ROOT, rel); }
} else {
  for (const rel of ['scene', 'assets/pianist', 'music/final/score.json', 'build/anim/perf.json', 'build/anim/perf.bin']) copyFrom(ROOT, rel);
}
fs.mkdirSync(path.join(out, 'node_modules'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules', 'three'), path.join(out, 'node_modules', 'three'), 'junction');
let regenerated = null;
if ((!handtrackGate(out).ok && regen) || a['force-regen-handtrack']) {
  // the camera's tool, run inside the snapshot: ROOT there = the snapshot (fk.mjs resolves ../..), so rig.json,
  // scene/src/perf/tracks.js, scene/src/camera/hands.js, the score and perf.bin are all the frozen copies
  for (const f of ['handtrack.mjs', 'fk.mjs']) copyFrom(ROOT, `sandbox/camera/${f}`);
  const { execFileSync } = await import('node:child_process');
  const t0 = Date.now();
  const log = execFileSync(process.execPath, [path.join(out, 'sandbox/camera/handtrack.mjs'), '--perf', 'build/anim', '--score', 'music/final/score.json', '--out', 'scene/src/camera/handtrack.json'],
    { cwd: out, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  regenerated = { tool: 'sandbox/camera/handtrack.mjs (copied into the snapshot)', was: pre, seconds: +((Date.now() - t0) / 1000).toFixed(1), log: log.trim().split('\n') };
  console.error(`[snapshot] hand track re-solved from the snapshot's perf in ${regenerated.seconds} s`);
}
// Motion-blur N boost table (fix round 4, docs/INTEGRATION.md section 8.4): solved from the snapshot's own perf, rig and
// edit, so it always matches what the snapshot renders (scene/src/main.js MOTION_N_URL; wiring check 9).
// --no-motion-boost leaves the copied table as it is.
let motionBoost = null;
if (!a['no-motion-boost']) {
  const { execFileSync } = await import('node:child_process');
  const t0 = Date.now(), rel = 'scene/src/integration/motion_n.json';
  const log = execFileSync(process.execPath, [path.join(ROOT, 'sandbox/integration/blurstep.mjs'), '--snap', out, '--out', path.join(out, 'blurstep.json'),
    '--boost-out', path.join(out, rel), '--target', String(a['motion-target'] || 1.0)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const t = JSON.parse(fs.readFileSync(path.join(out, rel), 'utf8'));
  motionBoost = { file: rel, frames: Object.keys(t.frames).length, extraSubframes: t.extraSubframes, targetPx: t.targetPx, perf: t.perfSha.slice(0, 16),
    seconds: +((Date.now() - t0) / 1000).toFixed(1), log: log.trim().split('\n').slice(-2) };
  console.error(`[snapshot] motion N boost solved: ${motionBoost.frames} frames, +${motionBoost.extraSubframes} sub-frames (${motionBoost.seconds} s)`);
}
const h = treeHash(['scene', 'assets/pianist'], out).sha256.slice(0, 16);
const gate = handtrackGate(out);
if (!gate.ok && !a['allow-stale-handtrack']) { console.error(`snapshot ${out}: hand track still does not match its perf`, JSON.stringify(gate)); process.exit(3); }
fs.writeFileSync(path.join(out, 'SNAPSHOT.json'), JSON.stringify({ from: ROOT, base: base ? path.relative(ROOT, base) : null,
  overlay: base ? INTEGRATION_FILES : null, created: new Date().toISOString(), sceneAssetsHash: h, handtrack: gate, handtrackRegenerated: regenerated, motionBoost }, null, 1));
console.log(JSON.stringify({ dir: out, sceneAssetsHash: h, base: base ? path.relative(ROOT, base) : null, handtrack: gate, handtrackRegenerated: !!regenerated, motionBoost: motionBoost && motionBoost.frames }));
