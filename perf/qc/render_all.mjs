#!/usr/bin/env node
// All performance QC renders in one go (docs/PERFORMANCE.md): the three 24-moment contact sheets and the four 2-second
// 60 fps clips, with the clip windows picked from the score the tracks were solved from (so a re-composed score needs
// no edits here):
//   fast    - the densest 2 s of the piece (both hands)
//   jump    - the biggest register jump of either hand (window centred on the landing)
//   chords  - the first loud chord passage (>= 3-note chords, vel > 90)
//   climax  - around the loudest note
//   node perf/qc/render_all.mjs [--perf build/anim] [--piano simple|real] [--only sheet,fast,jump,chords,climax]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

const argv = process.argv.slice(2); const args = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const perfDir = args.perf || 'build/anim'; const piano = args.piano || 'simple';
const only = args.only ? new Set(String(args.only).split(',')) : null;
const meta = JSON.parse(fs.readFileSync(path.resolve(ROOT, perfDir, 'perf.json'), 'utf8'));
const score = JSON.parse(fs.readFileSync(meta.inputs.score, 'utf8')); const N = score.notes;
const end = Math.max(...N.map((n) => n.t_off));

// ---- clip windows
const pick = {};
{ let best = null; for (let t = 0; t < end - 2; t += 0.25) { const c = N.filter((n) => n.t_on >= t && n.t_on < t + 2).length; if (!best || c > best.c) best = { t, c }; } pick.fast = { m0: best.t, view: 'ref7R', why: `${best.c} notes in 2 s` }; }
{
  let best = null;
  for (const h of ['R', 'L']) {
    const ns = N.filter((n) => n.hand === h).sort((a, b) => a.t_on - b.t_on); const ev = [];
    for (const n of ns) { const e = ev[ev.length - 1]; if (e && n.t_on - e.t < 0.03) e.n.push(n); else ev.push({ t: n.t_on, n: [n] }); }
    const c = (e) => e.n.reduce((s, n) => s + n.pitch, 0) / e.n.length;
    for (let i = 1; i < ev.length; i++) { const d = Math.abs(c(ev[i]) - c(ev[i - 1])); if (!best || d > best.d) best = { d, t: ev[i].t, h }; }
  }
  pick.jump = { m0: best.t - 1.2, view: best.h === 'R' ? 'wideR' : 'wideL', why: `${best.h}H jumps ${best.d.toFixed(0)} semitones at m ${best.t.toFixed(2)}` };
}
{
  const ev = []; for (const n of N.slice().sort((a, b) => a.t_on - b.t_on)) { const e = ev[ev.length - 1]; if (e && n.t_on - e.t < 0.03 && n.hand === e.h) e.n.push(n); else ev.push({ t: n.t_on, h: n.hand, n: [n] }); }
  const ch = ev.find((e) => e.n.length >= 3 && Math.max(...e.n.map((n) => n.vel)) > 90) || ev.find((e) => e.n.length >= 3);
  pick.chords = { m0: ch.t - 0.5, view: ch.h === 'R' ? 'ref12R' : 'ref12L', why: `${ch.n.length}-note ${ch.h}H chord at m ${ch.t.toFixed(2)}` };
}
{ const l = N.reduce((a, b) => (b.vel > a.vel ? b : a)); pick.climax = { m0: l.t_on - 1.0, view: l.hand === 'R' ? 'ref7R' : 'ref7L', why: `loudest note ${l.name} vel ${l.vel} at m ${l.t_on.toFixed(2)}` }; }
console.log('[render_all] windows', JSON.stringify(pick, null, 1));

const run = (a) => { console.log('[render_all] node perf/qc/render_qc.mjs ' + a.join(' ')); execFileSync(process.execPath, [path.join(ROOT, 'perf/qc/render_qc.mjs'), ...a], { stdio: 'inherit', cwd: ROOT }); };
if (!only || only.has('sheet')) run(['sheet', '--perf', perfDir, '--piano', piano]);
for (const [name, p] of Object.entries(pick)) {
  if (only && !only.has(name)) continue;
  run(['clip', '--perf', perfDir, '--piano', piano, '--m0', p.m0.toFixed(3), '--dur', '2', '--view', p.view, '--name', `clip_${name}`]);
  const other = name === 'jump' ? 'topBoth' : p.view.endsWith('R') ? p.view.slice(0, -1) + 'L' : p.view.slice(0, -1) + 'R';
  run(['clip', '--perf', perfDir, '--piano', piano, '--m0', p.m0.toFixed(3), '--dur', '2', '--view', other, '--name', `clip_${name}_2`]);
}
fs.writeFileSync(path.resolve(ROOT, perfDir, 'qc', 'render_all.json'), JSON.stringify({ perf: perfDir, piano, windows: pick }, null, 1));
