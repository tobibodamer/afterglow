// Motion-blur stepping gate (fix round 4; logic of the sync critic's build/qc/integration_sync/blurstep.mjs).
// The accumulation renderer poses the scene at N stratum-centre times inside the 1/120 s shutter, so a moving edge is
// drawn as N copies spaced disp/N apart. For every frame of the shots that show hands, the fingertips and knuckles
// (perf FK, rig frame) are projected through the edit camera at t -+ 1/240 s; spacing = displacement / the shot's own N.
//   node sandbox/integration/blurstep.mjs [--snap build/snap/integ3c] [--out <file.json>]
//        [--boost-out <snap or repo>/scene/src/integration/motion_n.json] [--target 1.5] [--maxN 128]
// Reads the snapshot's edit (scene/src/camera/shots.js), perf (build/anim) and rig (assets/pianist/rig.json); the FK
// code is the camera's sandbox/camera/fk.mjs (read only). Prints one line per shot; writes the JSON.
// --boost-out (fix round 4, integration defect "own-N frames > 2 px"): writes the motion-blur N boost table that
// scene/src/main.js applies in final-quality renders: every frame whose copy spacing at the shot's own N exceeds
// --target px gets N = the next multiple of 16 that brings it to <= target (capped at --maxN), so a fast hand is drawn
// as fused copies instead of a banded multi-exposure. Keyed to the perf sha and each shot's edit N: the page ignores
// the table for a shot whose N changed and the integration wiring check 9 fails until it is re-solved
// (render/snapshot.mjs re-solves it for every snapshot, like the hand track).
// spacing is the WORST frame-centre-to-shutter-end displacement / N; with stratified shutter times the copies are
// exactly disp / N apart.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../../render/lib/util.mjs';

const a = parseArgs();
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC = a.snap ? path.resolve(ROOT, a.snap) : ROOT;
const { loadRig, loadPerf, makeFK, handPoints } = await import(pathToFileURL(path.join(ROOT, 'sandbox/camera/fk.mjs')).href);
const { director, EDIT } = await import(pathToFileURL(path.join(SRC, 'scene/src/camera/shots.js')).href);
const rigFile = fs.existsSync(path.join(SRC, 'assets/pianist/rig.json')) ? path.join(SRC, 'assets/pianist/rig.json') : undefined;
const perf = loadPerf(path.join(SRC, 'build/anim'));
const fk = makeFK(loadRig(rigFile), perf);
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = (p) => { const l = Math.hypot(...p) || 1; return p.map((x) => x / l); };
const W = 1920;
function proj(cam, p) {
  const fwd = norm(sub(cam.targetRig, cam.posRig)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  const d = sub(p, cam.posRig), z = dot(d, fwd); if (z <= 0.05) return null;
  const f = cam.focalMm / 36 * W; return [W / 2 + f * dot(d, right) / z, 540 - f * dot(d, up) / z];
}
const NOF = {}; for (const s of (EDIT.shots || [])) NOF[s.id] = s.lens?.N;
const SH = ['S02', 'S04', 'S06', 'S07', 'S08', 'S09', 'S11', 'S13', 'S14', 'S15', 'S16b', 'S18', 'S19', 'S20b', 'S20c', 'S21', 'S22', 'S24'];
const res = { snap: a.snap || null, shots: {}, over2: [] };
const allRows = [];
for (const s of director.shots) {
  if (!SH.includes(s.id)) continue;
  const N = s.settings?.N ?? s.spec?.lens?.N ?? NOF[s.id] ?? 16;   // settings.N = what the page renders (main.js frameSettings)
  const rows = [];
  for (let f = s.f0; f < s.f1; f++) {
    const t = f / 60, ta = t - 1 / 240, tb = t + 1 / 240;
    const ca = director.evaluate(ta, s), cb = director.evaluate(tb, s);
    // fk() returns one shared object per call: take the hand points before the next call
    const FA = fk(ta); const HA = { L: handPoints(FA, 'L'), R: handPoints(FA, 'R') };
    const FB = fk(tb); const HB = { L: handPoints(FB, 'L'), R: handPoints(FB, 'R') };
    let best = 0, what = '';
    for (const h of ['L', 'R']) {
      const A = HA[h], B = HB[h];
      const pa = [...A.tips, ...A.mcp], pb = [...B.tips, ...B.mcp];
      for (let i = 0; i < pa.length; i++) {
        const qa = proj(ca, pa[i]), qb = proj(cb, pb[i]);
        if (!qa || !qb) continue;
        const inF = (q) => q[0] >= 0 && q[0] < W && q[1] >= 0 && q[1] < 1080;
        if (!inF(qa) && !inF(qb)) continue;
        const d = Math.hypot(qa[0] - qb[0], qa[1] - qb[1]);
        if (d > best) { best = d; what = h + (i < 5 ? 'tip' + (i + 1) : 'mcp' + (i - 4)); }
      }
    }
    rows.push({ f, disp: best, what });
    allRows.push({ f, disp: best, N, shot: s.id });
  }
  const steps = rows.map((r) => r.disp / N).sort((x, y) => x - y);
  for (const r of rows) if (r.disp / N > 2) res.over2.push({ shot: s.id, f: r.f, N, px: +(r.disp / N).toFixed(2), what: r.what, dispPx: +r.disp.toFixed(1) });
  res.shots[s.id] = { N, frames: rows.length, p50: +steps[steps.length >> 1].toFixed(2), p99: +steps[Math.floor(steps.length * 0.99)].toFixed(2),
    max: +steps[steps.length - 1].toFixed(2), over2: rows.filter((r) => r.disp / N > 2).length, over2AtN16: rows.filter((r) => r.disp / 16 > 2).length };
  console.log(`${s.id.padEnd(5)} N${N} spacing px p50 ${res.shots[s.id].p50} p99 ${res.shots[s.id].p99} max ${res.shots[s.id].max} | > 2 px ${res.shots[s.id].over2}/${rows.length} (at N16 ${res.shots[s.id].over2AtN16})`);
}
res.maxPx = Math.max(0, ...res.over2.map((r) => r.px));
// ---- motion-blur N boost table (see header)
const TARGET = a.target ? +a.target : 1.5, MAXN = a.maxN ? +a.maxN : 128;
const boost = {}; let extraSub = 0;
for (const r of allRows) {
  if (r.disp / r.N <= TARGET) continue;
  const nb = Math.min(MAXN, Math.ceil(r.disp / TARGET / 16) * 16);
  if (nb > r.N) { boost[r.f] = nb; extraSub += nb - r.N; }
}
const after = allRows.map((r) => r.disp / (boost[r.f] || r.N));
res.boost = { targetPx: TARGET, maxN: MAXN, frames: Object.keys(boost).length, extraSubframes: extraSub,
  maxPxAfter: +Math.max(0, ...after).toFixed(2), over2After: after.filter((x) => x > 2).length,
  byShot: Object.fromEntries(Object.keys(res.shots).map((id) => [id, allRows.filter((r) => r.shot === id && boost[r.f]).length]).filter(([, n]) => n)) };
// ---- spacing as the served tree renders it: own N + its motion_n.json table when that is valid for this perf / edit
{
  let tab = null; try { tab = JSON.parse(fs.readFileSync(path.join(SRC, 'scene/src/integration/motion_n.json'), 'utf8')); } catch (e) { /* none */ }
  const perfSha = JSON.parse(fs.readFileSync(path.join(SRC, 'build/anim/perf.json'), 'utf8')).sha256;
  const valid = !!tab && tab.perfSha === perfSha && Object.entries(res.shots).every(([id, s]) => tab.editN?.[id] === undefined || tab.editN[id] === s.N);
  const nOf = (r) => (valid && tab.frames[r.f] > r.N && tab.shotOf?.[r.f] === r.shot ? tab.frames[r.f] : r.N);
  const sp = allRows.map((r) => ({ shot: r.shot, f: r.f, N: nOf(r), px: r.disp / nOf(r) }));
  res.rendered = { table: valid ? 'valid' : tab ? 'stale' : 'none', boostedFrames: sp.filter((x, i) => x.N !== allRows[i].N).length,
    maxPx: +Math.max(0, ...sp.map((x) => x.px)).toFixed(2), over2: sp.filter((x) => x.px > 2).length, over1: sp.filter((x) => x.px > 1.0001).length,
    worst: sp.sort((x, y) => y.px - x.px).slice(0, 6).map((x) => ({ ...x, px: +x.px.toFixed(2) })) };
  console.log(`as rendered (motion_n.json ${res.rendered.table}): max spacing ${res.rendered.maxPx} px, frames > 2 px ${res.rendered.over2}, > 1 px ${res.rendered.over1}`);
}
const out = a.out ? path.resolve(ROOT, a.out) : path.join(ROOT, 'sandbox/integration/out/blurstep.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`frames > 2 px at own N: ${res.over2.length} (max ${res.maxPx} px) -> ${out}`);
console.log(`N boost (target ${TARGET} px, max N ${MAXN}): ${res.boost.frames} frames, +${extraSub} sub-frames; max spacing after ${res.boost.maxPxAfter} px, frames > 2 px after ${res.boost.over2After}`);
if (a['boost-out']) {
  const perfMeta = JSON.parse(fs.readFileSync(path.join(SRC, 'build/anim/perf.json'), 'utf8'));
  const table = { format: 'afterglow-motion-n', version: 1, generated: new Date().toISOString(),
    command: 'node sandbox/integration/blurstep.mjs ' + process.argv.slice(2).join(' '),
    note: 'per-frame N boost for fast hands (motion-blur copy spacing at the shot\'s own N > targetPx); applied by scene/src/main.js in final-quality renders when the session does not force N; void for a shot whose edit N differs from editN, or when perfSha differs from build/anim/perf.json sha256',
    perfSha: perfMeta.sha256, targetPx: TARGET, maxN: MAXN,
    editN: Object.fromEntries(Object.entries(res.shots).map(([id, s]) => [id, s.N])),
    shotOf: Object.fromEntries(allRows.filter((r) => boost[r.f]).map((r) => [r.f, r.shot])),
    frames: boost, extraSubframes: extraSub };
  const bo = path.resolve(ROOT, a['boost-out']);
  fs.mkdirSync(path.dirname(bo), { recursive: true });
  fs.writeFileSync(bo, JSON.stringify(table, null, 1));
  console.log(`motion N boost table -> ${bo}`);
}
