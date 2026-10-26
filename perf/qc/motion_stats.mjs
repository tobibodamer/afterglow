#!/usr/bin/env node
// Hand-motion quality metrics measured on the WRITTEN tracks (rig FK of perf.bin), so any two runs compare directly.
//   node perf/qc/motion_stats.mjs <perfDir> [m0,m1] [--json out.json]
// Per hand: wrist speed / acceleration / jerk percentiles, the share of playing time the hand is moving, and every
// transfer (wrist faster than 5 cm/s) with its duration, peak speed and peak-to-mean speed ratio (1.875 for a
// minimum-jerk reach, higher for a dash that starts late and brakes hard). Strike: per velocity band, the downward speed
// of the playing finger's distal joint at the touch and its peak over the 100 ms before, and the wrist's at the touch.
import fs from 'node:fs';
import path from 'node:path';
import { Rig } from '../lib/rig.js';
import { qAngle } from '../lib/math.js';

const argv = process.argv.slice(2);
const dir = argv[0]; if (!dir) { console.error('usage: motion_stats.mjs <perfDir> [m0,m1] [--json out.json]'); process.exit(1); }
const ji = argv.indexOf('--json'); const jsonOut = ji >= 0 ? argv[ji + 1] : null;
const rangeArg = argv[1] && !argv[1].startsWith('--') ? argv[1].split(',').map(Number) : null;
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'perf.json'), 'utf8'));
const buf = fs.readFileSync(path.join(dir, 'perf.bin')); const F = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const rig = Rig.load(meta.inputs?.rig && fs.existsSync(meta.inputs.rig) ? meta.inputs.rig : path.join(ROOT, 'assets/pianist/rig.json'));
const S = meta.stride, rate = meta.rate, dt = 1 / rate;
const chan = new Map(meta.channels.map((c) => [c.name, c]));
const boneIdx = meta.bones.map((b) => rig.idx(b)); const rootC = chan.get('root.position');
const [m0, m1] = rangeArg || (meta.command?.match(/--range ([\d.]+),([\d.]+)/)?.slice(1).map(Number) ?? [meta.t0, meta.t0 + meta.duration]);
const i0 = Math.max(0, Math.ceil((m0 - meta.t0) * rate)), i1 = Math.min(meta.frames - 1, Math.floor((m1 - meta.t0) * rate));
const notes = meta.notes || [];
// runs written before notes[].vel existed: velocities from the score
if (notes.length && notes[0].vel === undefined && meta.inputs?.score && fs.existsSync(meta.inputs.score)) { const V = new Map(JSON.parse(fs.readFileSync(meta.inputs.score, 'utf8')).notes.map((n) => [n.id, n.vel])); for (const n of notes) n.vel = V.get(n.id); }

const track = { R: { p: [], q: [] }, L: { p: [], q: [] } };
const wristI = { R: rig.idx('wrist_R'), L: rig.idx('wrist_L') };
const local = new Array(rig.n).fill(null);
for (let i = i0; i <= i1; i++) {
  const o = i * S;
  meta.bones.forEach((b, k) => { const c = chan.get(b); local[boneIdx[k]] = [F[o + c.offset], F[o + c.offset + 1], F[o + c.offset + 2], F[o + c.offset + 3]]; });
  const fk = rig.fk(local, [F[o + rootC.offset], F[o + rootC.offset + 1], F[o + rootC.offset + 2]]);
  for (const s of ['R', 'L']) { track[s].p.push(fk.p[wristI[s]]); track[s].q.push(fk.q[wristI[s]]); }
}

const pct = (a, p) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const diff = (a) => a.slice(1).map((v, i) => v.map((x, k) => (x - a[i][k]) / dt));
const mag = (a) => a.map((v) => Math.hypot(...v));
// 10 ms Gaussian before differentiating twice more (float32 tracks: raw third differences are noise)
const smooth = (a, sig = 0.010 / dt) => { const R = Math.ceil(3 * sig); const w = []; for (let j = -R; j <= R; j++) w.push(Math.exp(-0.5 * (j / sig) ** 2)); const ws = w.reduce((x, y) => x + y, 0);
  return a.map((_, i) => { const o = [0, 0, 0]; for (let j = -R; j <= R; j++) { const v = a[Math.min(a.length - 1, Math.max(0, i + j))]; for (let k = 0; k < 3; k++) o[k] += w[j + R] * v[k]; } return o.map((x) => x / ws); }); };

const out = { dir, range: [m0, m1] };
for (const s of ['R', 'L']) {
  const P = track[s].p, Q = track[s].q;
  const vel = diff(P), sp = mag(vel);
  const acc = mag(diff(smooth(vel))), jerk = mag(diff(smooth(diff(smooth(vel)))));
  const ang = Q.slice(1).map((q, i) => qAngle(Q[i], q) / dt * 180 / Math.PI);
  // playing time: from this hand's first touch to its last release inside the range
  const hn = notes.filter((n) => n.hand === s && n.tFk >= m0 && n.tFk <= m1);
  const tA = hn.length ? Math.min(...hn.map((n) => n.tFk)) : m0, tB = hn.length ? Math.max(...hn.map((n) => n.tRel0)) : m1;
  const play = sp.filter((_, i) => { const t = meta.t0 + (i0 + i) * dt; return t >= tA && t <= tB; });
  // transfers: maximal runs with speed > 5 cm/s, merged across dips shorter than 30 ms
  const tr = []; let a = -1, lastHi = -1e9;
  for (let i = 0; i < sp.length; i++) {
    if (sp[i] > 0.05) { if (a < 0 || i - lastHi > 0.03 * rate) { if (a >= 0) tr.push([a, lastHi]); a = i; } lastHi = i; }
  }
  if (a >= 0) tr.push([a, lastHi]);
  const trs = tr.map(([x, y]) => { const seg = sp.slice(x, y + 1); let dist = 0; for (let k = x; k <= y; k++) dist += sp[k] * dt; const dur = (y - x + 1) * dt;
    return { t: +(meta.t0 + (i0 + x) * dt).toFixed(3), dur: +dur.toFixed(3), dist: +(dist * 1000).toFixed(1), peak: +Math.max(...seg).toFixed(3), ratio: +(Math.max(...seg) / (dist / dur)).toFixed(2) }; }).filter((x) => x.dist > 5);
  out[s] = {
    speed_p50: +pct(play, 0.5).toFixed(4), speed_p95: +pct(play, 0.95).toFixed(3), speed_max: +Math.max(...sp).toFixed(3),
    moving_share: +(play.filter((v) => v > 0.02).length / Math.max(1, play.length)).toFixed(3),
    still_share: +(play.filter((v) => v < 0.005).length / Math.max(1, play.length)).toFixed(3),
    acc_p95: +pct(acc, 0.95).toFixed(2), acc_max: +Math.max(...acc).toFixed(2),
    jerk_p95: +pct(jerk, 0.95).toFixed(1), jerk_p99: +pct(jerk, 0.99).toFixed(1), jerk_rms: +Math.sqrt(jerk.reduce((x, y) => x + y * y, 0) / jerk.length).toFixed(1),
    ang_p95: +pct(ang, 0.95).toFixed(1), ang_max: +Math.max(...ang).toFixed(1),
    transfers: trs.length, tr_dur_p50: +pct(trs.map((x) => x.dur), 0.5).toFixed(3), tr_peak_p50: +pct(trs.map((x) => x.peak), 0.5).toFixed(3),
    tr_peak_p95: +pct(trs.map((x) => x.peak), 0.95).toFixed(3), tr_ratio_p50: +pct(trs.map((x) => x.ratio), 0.5).toFixed(2),
    tr_list: trs,
  };
}
const BANDS = [[0, 45], [45, 60], [60, 75], [75, 95], [95, 128]];
const fkCache = new Map();
const fkAt = (i) => { if (fkCache.has(i)) return fkCache.get(i); const o = i * S;
  meta.bones.forEach((b, k) => { const c = chan.get(b); local[boneIdx[k]] = [F[o + c.offset], F[o + c.offset + 1], F[o + c.offset + 2], F[o + c.offset + 3]]; });
  const r = rig.fk(local, [F[o + rootC.offset], F[o + rootC.offset + 1], F[o + rootC.offset + 2]]).p; fkCache.set(i, r); return r; };
const down = (i, j) => -(fkAt(i + 1)[j][1] - fkAt(i - 1)[j][1]) * rate / 2;
if (notes.length && notes[0].vel !== undefined) {
  const med = (a) => +pct(a, 0.5).toFixed(3);
  out.strike = BANDS.map(([a, b]) => {
    const ns = notes.filter((n) => n.vel >= a && n.vel < b && n.tFk >= m0 && n.tFk <= m1);
    const tip = [], peak = [], wr = [];
    for (const n of ns) {
      const ji = rig.idx(`finger${n.finger}-3_${n.hand}`), wi = rig.idx(`wrist_${n.hand}`); const iF = Math.round((n.tFk - meta.t0) * rate);
      if (iF < 1 + Math.round(0.1 * rate) || iF >= meta.frames - 2) continue;
      let pk = 0; for (let i = iF - Math.round(0.1 * rate); i <= iF; i++) pk = Math.max(pk, down(i, ji));
      tip.push(down(iF, ji)); peak.push(pk); wr.push(down(iF, wi));
    }
    return { vel: `${a}-${b}`, n: tip.length, struck: ns.filter((n) => n.touch === 'struck').length, tip_at_touch: med(tip), tip_peak_100ms: med(peak), wrist_at_touch: med(wr) };
  });
}
const row = (k) => `${k.padEnd(14)} ${String(out.R[k]).padStart(9)} ${String(out.L[k]).padStart(9)}`;
console.log(`${dir}  m ${m0}..${m1}\n${''.padEnd(14)} ${'R'.padStart(9)} ${'L'.padStart(9)}`);
for (const k of Object.keys(out.R)) if (k !== 'tr_list') console.log(row(k));
if (out.strike) { console.log('strike (m/s down, medians)  vel     n  struck  tip@touch  tip peak  wrist@touch');
  for (const r of out.strike) console.log(`${''.padEnd(28)} ${r.vel.padEnd(7)} ${String(r.n).padStart(4)} ${String(r.struck).padStart(6)} ${String(r.tip_at_touch).padStart(9)} ${String(r.tip_peak_100ms).padStart(9)} ${String(r.wrist_at_touch).padStart(11)}`); }
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
