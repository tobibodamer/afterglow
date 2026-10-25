// Camera hand track from the SOLVED performance: forward kinematics of perf.bin -> per hand, the centre of the
// fingertips + knuckles and their bounding box, smoothed the way a camera operator / focus puller follows a performer,
// written to scene/src/camera/handtrack.json (loaded by shots.js; hands.js falls back to the score proxy when the
// track's bar timing does not match the score in use).
//   node sandbox/camera/handtrack.mjs [--perf build/anim] [--score music/final/score.json] [--out scene/src/camera/handtrack.json]
// Re-run whenever the performance is re-solved (the animatic does it for its pinned perf).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadRig, loadPerf, makeFK, handPoints } from './fk.mjs';
import { barsFingerprint } from '../../scene/src/camera/hands.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const perfDir = path.resolve(ROOT, opt('--perf', 'build/anim'));
const outFile = path.resolve(ROOT, opt('--out', 'scene/src/camera/handtrack.json'));
const perf = loadPerf(perfDir);
const scoreFile = path.resolve(ROOT, opt('--score', perf.meta.inputs?.score || 'music/final/score.json'));
const score = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
const R = loadRig();
const fk = makeFK(R, perf);

const RAW = 60, OUT = 30;                         // raw FK rate, stored rate (Hz)
const T1 = (perf.frames - 1) / perf.rate;         // film seconds covered
const n = Math.floor(T1 * RAW) + 1;
const raw = { L: { c: [[], [], []], lo: [[], [], []], hi: [[], [], []] }, R: { c: [[], [], []], lo: [[], [], []], hi: [[], [], []] } };
for (let i = 0; i < n; i++) {
  const W = fk(i / RAW);
  for (const h of ['L', 'R']) {
    const hp = handPoints(W, h), pts = [...hp.tips, ...hp.mcp];
    for (let k = 0; k < 3; k++) {
      raw[h].c[k].push(hp.centre[k]);
      raw[h].lo[k].push(Math.min(...pts.map((p) => p[k])));
      raw[h].hi[k].push(Math.max(...pts.map((p) => p[k])));
    }
  }
}
function gauss(arr, sigmaS, leadS = 0) {
  const sg = sigmaS * RAW, r = Math.ceil(3 * sg), w = [];
  for (let j = -r; j <= r; j++) w.push(Math.exp(-0.5 * (j / sg) ** 2));
  const lead = Math.round(leadS * RAW), out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, ws = 0;
    for (let j = -r; j <= r; j++) { const k = Math.min(arr.length - 1, Math.max(0, i + lead + j)); s += arr[k] * w[j + r]; ws += w[j + r]; }
    out[i] = s / ws;
  }
  return out;
}
// operator smoothing: register (x) follows with a slight lead and ~0.4 s inertia; height/depth (y, z) ~0.25 s;
// the box (focus) ~0.2 s, no lead (a focus puller follows what is there)
// (resume 3: y/z at 0.25 s let the camera ride the hand's 1-2 cm key-press bob - camqc measured 20-80 deg/s^2 median
//  angular acceleration in the tracking shots; an operator frames the hand's register and height, not each keystroke)
const SM = { cx: [0.45, 0.12], cy: [0.6, 0], cz: [0.6, 0], box: [0.25, 0], boxFast: [0.08, 0.04] };
// boxFast: a quick focus puller with a small lead, for hands that jump (left-hand stride, critic r2: S08 / S16b soft at the
// jumps with the 0.25 s box); used by focus specs with fast: true
const enc = (arrs) => {
  const m = Math.floor(T1 * OUT) + 1, b = Buffer.alloc(m * 3 * 2);
  for (let i = 0; i < m; i++) for (let k = 0; k < 3; k++) {
    const j = Math.min(arrs[k].length - 1, Math.round(i * RAW / OUT));
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(arrs[k][j] * 10000))), (i * 3 + k) * 2);
  }
  return b.toString('base64');
};
const hands = {};
for (const h of ['L', 'R']) {
  const c = [gauss(raw[h].c[0], ...SM.cx), gauss(raw[h].c[1], ...SM.cy), gauss(raw[h].c[2], ...SM.cz)];
  const lo = raw[h].lo.map((a) => gauss(a, ...SM.box)), hi = raw[h].hi.map((a) => gauss(a, ...SM.box));
  const loF = raw[h].lo.map((a) => gauss(a, ...SM.boxFast)), hiF = raw[h].hi.map((a) => gauss(a, ...SM.boxFast));
  hands[h] = { c: enc(c), lo: enc(lo), hi: enc(hi), loF: enc(loF), hiF: enc(hiF) };
}
// stats for the record (raw, unsmoothed)
const med = (a) => { const b = Array.from(a).sort((x, y) => x - y); return +b[b.length >> 1].toFixed(4); };
const stats = {};
for (const h of ['L', 'R']) stats[h] = { y: med(raw[h].c[1]), z: med(raw[h].c[2]), depthSpanZ: med(raw[h].hi[2].map((v, i) => v - raw[h].lo[2][i])), spanX: med(raw[h].hi[0].map((v, i) => v - raw[h].lo[0][i])) };
const out = {
  format: 'afterglow-camera-handtrack', version: 1,
  command: 'node sandbox/camera/handtrack.mjs ' + args.join(' '),
  perf: { dir: path.relative(ROOT, perfDir).replace(/\\/g, '/'), sha256: perf.meta.sha256 },
  score: { file: path.relative(ROOT, scoreFile).replace(/\\/g, '/'), notes: score.notes.length, bars: barsFingerprint(score.bars) },
  rate: OUT, t0Film: 0, n: Math.floor(T1 * OUT) + 1, units: '0.1 mm, rig frame, Int16LE xyz per sample, base64', scale: 10000,
  smoothing: SM, stats, hands,
};
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`[handtrack] ${path.relative(ROOT, outFile)}: ${out.n} samples @ ${OUT} Hz, perf ${out.perf.dir} (${perf.meta.sha256.slice(0, 12)}), score ${out.score.file} bars ${out.score.bars}; ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
console.log('[handtrack] stats (raw medians, m):', JSON.stringify(stats));
