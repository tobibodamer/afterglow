#!/usr/bin/env node
// Performance solver CLI (docs/PERFORMANCE.md).
//   node perf/solve.mjs [--score music/final/score.json] [--rig assets/pianist/rig.json] [--glb assets/pianist/<x>.glb]
//                       [--out build/anim] [--fingering composer|solver] [--range m0,m1] [--no-qc] [--qc-rate 60]
// Defaults fall back to music/candidates/melody/score.json and sandbox/human/out/v11/ while the final files are missing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { solve } from './lib/solver.js';
import { writePerf } from './lib/writer.js';
import { runQC } from './lib/qc.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; args[k] = v; } }
const pick = (...c) => c.find((p) => p && fs.existsSync(path.resolve(ROOT, p)));
const score = path.resolve(ROOT, args.score || pick('music/final/score.json', 'music/candidates/melody/score.json'));
const rig = path.resolve(ROOT, args.rig || pick('assets/pianist/rig.json', 'sandbox/human/out/v11/rig.json'));
const glbDefault = fs.existsSync(path.resolve(ROOT, 'assets/pianist')) ? fs.readdirSync(path.resolve(ROOT, 'assets/pianist')).filter((f) => f.endsWith('.glb')).map((f) => 'assets/pianist/' + f)[0] : null;
const glb = path.resolve(ROOT, args.glb || pick(glbDefault, 'sandbox/human/out/v11/pianist_seated.glb'));
const out = path.resolve(ROOT, args.out || 'build/anim');
const range = args.range ? String(args.range).split(',').map(Number) : null;
const cmd = 'node perf/solve.mjs ' + argv.join(' ');
console.log(`[solve] score=${score}\n[solve] rig=${rig}\n[solve] glb=${glb}\n[solve] out=${out}`);
const t0 = Date.now();
const debug = args.debug ? (([hf, a, b]) => ({ hand: hf[0], finger: +hf[1], t0: +a, t1: +b }))(String(args.debug).split(',')) : null;
const res = await solve({ score, rig, glb, fingering: args.fingering || 'composer', range, debug, debugSameFinger: !!args['debug-sf'], kfCache: args['no-cache'] ? null : path.resolve(ROOT, 'build/anim/cache') });
const fingerTable = res.notes.map((n) => ({ id: n.id, hand: n.hand, pitch: n.pitch, t_on: n.t_on, finger: n.f, composer: n.finger, touch: n.tm.touch, tFk: +n.tm.tFk.toFixed(5), tKb: +n.tm.tKb.toFixed(5), tRel0: +n.tm.tRel0.toFixed(5), tUp: n.tUp !== undefined ? +n.tUp.toFixed(5) : undefined, tStart: n.tStart !== undefined ? +n.tStart.toFixed(5) : undefined, relWhy: n.relWhy, P0: n.P0 && n.P0.map((v) => +v.toFixed(5)) }));
const w = writePerf(out, res, { command: cmd, inputs: { score, scoreSha1: crypto.createHash('sha1').update(fs.readFileSync(score)).digest('hex'), rig, glb }, generated: 'perf/solve.mjs', notes: fingerTable, fingering: res.meta.fingering, sameFingerConflicts: res.meta.conflicts, solveSeconds: (Date.now() - t0) / 1000 });
console.log(`[solve] wrote ${out}/perf.bin (${(w.bytes / 1e6).toFixed(1)} MB, stride ${w.stride}, sha256 ${w.sha.slice(0, 16)}) and perf.json in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!args['no-qc']) {
  const q = runQC(res, { out, command: cmd, range, rateQC: args['qc-rate'] ? +args['qc-rate'] : 60 });
  console.log('[qc] ' + JSON.stringify(q.summary, null, 1));
}
