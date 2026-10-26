#!/usr/bin/env node
// QC renders of the performance tracks with the pianist GLB over an accurate keyboard (layout.js) or the real piano
// module, in headless Chrome. docs/PERFORMANCE.md.
//   node perf/qc/render_qc.mjs sheet  [--perf build/anim] [--n 24] [--piano simple|real] [--out build/anim/qc]
//   node perf/qc/render_qc.mjs clip   --m0 <music s> [--dur 2] [--view ref7R|ref7L|ref12R|ref12L|topBoth|wideR] [--name x]
//                                     [--camfrom <perfDir>]   (frame the camera on another run: identical A/B shots)
//   node perf/qc/render_qc.mjs frames --m 12.3,40.1 [--views ref7R,ref12R,topBoth]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openQC, saveDataUrl, ROOT } from './lib.mjs';

const argv = process.argv.slice(2); const mode = argv[0] || 'sheet'; const args = {};
for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const perfDir = args.perf || 'build/anim';
const outDir = path.resolve(ROOT, args.out || path.join(perfDir, 'qc'));
const perfJson = JSON.parse(fs.readFileSync(path.resolve(ROOT, perfDir, 'perf.json'), 'utf8'));
const glb = '/' + path.relative(ROOT, perfJson.inputs.glb).replaceAll('\\', '/');
const MO = perfJson.musicOffset;
fs.mkdirSync(outDir, { recursive: true });

const qc = await openQC({ glb, piano: args.piano || 'simple' });
const page = qc.page;
await page.evaluate((j, b) => window.QC.loadTracks(j, b), `/${perfDir.replaceAll('\\', '/')}/perf.json`, `/${perfDir.replaceAll('\\', '/')}/perf.bin`);
console.log('[qc]', qc.info);

// camera presets relative to the hands (pianist frame: treble at -x, keys toward +z)
async function views(tFilm) {
  await page.evaluate((t) => window.QC.poseAt(t), tFilm);
  const b = await page.evaluate(() => ({ r3: window.QC.bonePos('finger3-1_R'), l3: window.QC.bonePos('finger3-1_L'), rw: window.QC.bonePos('wrist_R'), lw: window.QC.bonePos('wrist_L'), head: window.QC.bonePos('head') }));
  const hc = (p) => [p[0], p[1] - 0.015, p[2] + 0.005];
  const R = hc(b.r3), Lh = hc(b.l3); const mid = [(R[0] + Lh[0]) / 2, (R[1] + Lh[1]) / 2, (R[2] + Lh[2]) / 2]; const span = Math.abs(R[0] - Lh[0]);
  return {
    ref7R: { pos: [R[0] - 0.40, R[1] + 0.25, R[2] - 0.42], target: [R[0], R[1] - 0.01, R[2] + 0.01], fov: 24 },
    ref7L: { pos: [Lh[0] + 0.40, Lh[1] + 0.25, Lh[2] - 0.42], target: [Lh[0], Lh[1] - 0.01, Lh[2] + 0.01], fov: 24 },
    ref12R: { pos: [R[0] - 0.36, R[1] + 0.035, R[2] - 0.05], target: [R[0] + 0.02, R[1] - 0.012, R[2] + 0.02], fov: 26 },
    ref12L: { pos: [Lh[0] + 0.36, Lh[1] + 0.035, Lh[2] - 0.05], target: [Lh[0] - 0.02, Lh[1] - 0.012, Lh[2] + 0.02], fov: 26 },
    frontR: { pos: [R[0] + 0.02, R[1] + 0.10, R[2] + 0.42], target: [R[0], R[1] - 0.01, R[2]], fov: 24 },
    frontL: { pos: [Lh[0] - 0.02, Lh[1] + 0.10, Lh[2] + 0.42], target: [Lh[0], Lh[1] - 0.01, Lh[2]], fov: 24 },
    // thumb side, low (the thumb is hidden behind the hand in the ref12 views): RH seen from the bass side, LH from the treble side
    thumbR: { pos: [R[0] + 0.30, R[1] + 0.04, R[2] - 0.10], target: [R[0] - 0.01, R[1] - 0.02, R[2] + 0.02], fov: 26 },
    // fix round 2: close top-down view of one hand (critic: finger fan / claws read from above, S14 / S21 / S22)
    topR: { pos: [R[0], R[1] + 0.36, R[2] - 0.07], target: [R[0], R[1] - 0.01, R[2] + 0.015], fov: 30 },
    topL: { pos: [Lh[0], Lh[1] + 0.36, Lh[2] - 0.07], target: [Lh[0], Lh[1] - 0.01, Lh[2] + 0.015], fov: 30 },
    thumbL: { pos: [Lh[0] - 0.30, Lh[1] + 0.04, Lh[2] - 0.10], target: [Lh[0] + 0.01, Lh[1] - 0.02, Lh[2] + 0.02], fov: 26 },
    topBoth: { pos: [mid[0], mid[1] + 0.55 + 0.6 * span, mid[2] - 0.12], target: [mid[0], mid[1] - 0.02, mid[2] + 0.03], fov: 32 + 25 * span },
    wideR: { pos: [-1.6, 1.25, -1.55], target: [-0.05, 0.85, -0.25], fov: 30 },
    wideL: { pos: [1.6, 1.25, -1.55], target: [0.05, 0.85, -0.25], fov: 30 },
  };
}
const tag = (m) => `m ${m.toFixed(2)} (film ${(m + MO).toFixed(2)})`;

if (mode === 'sheet') {
  const n = +(args.n || 24);
  // note-on moments spread across the piece, preferring onsets where both hands start notes
  const notes = perfJson.notes; const ons = [...new Set(notes.map((x) => +x.t_on.toFixed(3)))].sort((a, b) => a - b);
  const both = ons.filter((t) => notes.some((x) => x.hand === 'R' && Math.abs(x.t_on - t) < 0.04) && notes.some((x) => x.hand === 'L' && Math.abs(x.t_on - t) < 0.04));
  const pool = both.length >= n ? both : ons; const picks = [];
  for (let k = 0; k < n; k++) picks.push(pool[Math.floor((k + 0.5) * pool.length / n)]);
  const tw = +(args.tw || 420), th = +(args.th || 315);
  const sheets = [['ref7', ['ref7R', 'ref7L']], ['ref12', ['ref12R', 'ref12L']], ['top', ['topBoth']]];
  for (const [nm, vs] of sheets) {
    const cols = vs.length === 1 ? 4 : 4; const rows = Math.ceil(n * vs.length / cols);
    await page.evaluate((c, r, w, h, title) => window.QC.sheetBegin(c, r, w, h, title), cols, rows, tw, th, `${nm} at ${n} note-on moments (key bottom +10 ms) - ${perfDir}`);
    let k = 0;
    for (const m of picks) {
      // key bottom of the onset group: render slightly after t_on so the keys are down
      const tF = m + 0.010 + MO; const V = await views(tF);
      for (const v of vs) { await page.evaluate((i, label, view) => window.QC.sheetTile(i, label, view), k++, `${v} ${tag(m)}`, V[v]); }
    }
    const f = path.join(outDir, `sheet_${nm}.png`); saveDataUrl(f, await page.evaluate(() => window.QC.sheetData())); console.log('[qc] wrote', f);
  }
} else if (mode === 'frames') {
  const ms = String(args.m).split(',').map(Number); const vs = String(args.views || 'ref7R,ref12R,topBoth').split(',');
  const tw = +(args.tw || 520), th = +(args.th || 390);
  await page.evaluate((c, r, w, h, title) => window.QC.sheetBegin(c, r, w, h, title), vs.length, ms.length, tw, th, `frames ${perfDir}`);
  let k = 0;
  for (const m of ms) { const V = await views(m + MO); for (const v of vs) await page.evaluate((i, label, view) => window.QC.sheetTile(i, label, view), k++, `${v} ${tag(m)}`, V[v]); }
  const f = path.join(outDir, `${args.name || 'frames'}.png`); saveDataUrl(f, await page.evaluate(() => window.QC.sheetData())); console.log('[qc] wrote', f);
} else if (mode === 'clip') {
  const m0 = +args.m0, dur = +(args.dur || 2), fps = 60, view = args.view || 'ref7R'; const name = args.name || `clip_${view}_${m0.toFixed(1)}`;
  const w = +(args.w || 960), h = +(args.h || 540);
  const dir = path.join(outDir, name); fs.mkdirSync(dir, { recursive: true });
  // fixed camera from the middle of the window (a locked-off shot, so motion reads)
  const load = (d) => page.evaluate((j, b) => window.QC.loadTracks(j, b), `/${d.replaceAll('\\', '/')}/perf.json`, `/${d.replaceAll('\\', '/')}/perf.bin`);
  if (args.camfrom) await load(args.camfrom);
  const V = await views(m0 + dur / 2 + MO); const cam = V[view];
  if (args.camfrom) await load(perfDir);
  const strip = []; const nF = Math.round(dur * fps);
  for (let f = 0; f < nF; f++) {
    const t = m0 + MO + f / fps; await page.evaluate((tt) => window.QC.poseAt(tt), t);
    const url = await page.evaluate((c, W, H) => window.QC.render({ ...c, w: W, h: H }), cam, w, h);
    saveDataUrl(path.join(dir, `f${String(f).padStart(4, '0')}.png`), url);
  }
  const mp4 = path.join(outDir, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', mp4]);
  // frame strip: every 6th frame (10 per second)
  const tiles = []; for (let f = 0; f < nF; f += 6) tiles.push(path.join(dir, `f${String(f).padStart(4, '0')}.png`));
  const cols = 5; const rows = Math.ceil(tiles.length / cols);
  const list = tiles.map((t) => ['-i', t]).flat();
  const fc = tiles.map((_, i) => `[${i}:v]scale=384:-1[v${i}]`).join(';') + ';' + tiles.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${tiles.length}:layout=` + tiles.map((_, i) => `${(i % cols) * 384}_${Math.floor(i / cols) * 216}`).join('|') + `:fill=black[o]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...list, '-filter_complex', fc, '-map', '[o]', '-frames:v', '1', path.join(outDir, `${name}_strip.png`)]);
  console.log('[qc] wrote', mp4, 'and strip');
}
await qc.close();
