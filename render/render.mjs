// Resumable chunked render of a frame range into FFV1 lossless .mkv chunks, one manifest per chunk.
//   node render/render.mjs --from 0 --to 13500 --chunk 300 --size 1920x1080 --out build/chunks/film [--N 16]
// Options:
//   --from A --to B        frame range [A, B) (t = frame / 60). --chunk C frames per chunk (default 300 = 5 s)
//   --size WxH | 1080p     --quality final|preview   --N 16 (overrides per-shot N; default: shot N or 16)
//   --camera cam.json      --modules ... | --placeholders   --opts '{json}' (renderFrame)   --init '{json}' (AG.init)
//   --force                re-render chunks even if complete        --verify   re-hash complete chunks before skipping
//   --rerender-stale       also re-render complete chunks whose inputs changed: any file the page loaded for that chunk
//                          (manifest `inputs`) has different content now; for old manifests without `inputs`, a
//                          different scene/ content hash. Without the flag such chunks are only reported.
//   --retries 2            fresh-session retries for a failed chunk  --verbose
// Each chunk: chunk_<a>_<b>.mkv + chunk_<a>_<b>.manifest.json {range, settings, settingsHash, git, sceneHash, inputs,
// inputsHash, nb_frames (ffprobe), sha256, bytes, timings}. A chunk is skipped when its manifest says complete, the
// file exists with the recorded size, nb_frames == b - a and the settings hash matches; otherwise it is (re)rendered.
// The .mkv is written as .partial.mkv and renamed only after ffprobe confirms the frame count.
// Failure handling: a lost WebGL context, a page crash or the FFV1 encoder dying fails the chunk at once (the page and
// the session check every frame); it is then retried from its first frame in a fresh browser session.
// Any --chunk length works: encode.mjs rebuilds timestamps from the frame index (Matroska keeps milliseconds, so a
// chunk that is not a multiple of 3 frames has a rounded duration).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openSession } from './lib/session.mjs';
import { FrameAssembler, ffmpegSink, ENCODERS } from './lib/frames.mjs';
import { parseArgs, parseSize, readJsonArg, parseModules, sha256, sha256File, stableStringify, gitInfo, treeHash, countVideoPackets, writeJsonAtomic, pad, fmtMs, inputHashes, staleInputs } from './lib/util.mjs';
import { FPS, MUSIC_OFFSET } from '../scene/src/core/constants.js';

const a = parseArgs();
const [W, H] = parseSize(a.size, [1920, 1080]);
const from = +(a.from ?? 0), to = +(a.to ?? from + 300), chunk = +(a.chunk ?? 300);
if (!(to > from) || !(chunk > 0)) throw new Error('need --from < --to and --chunk > 0');
const outDir = path.resolve(a.out || 'build/chunks/render');
fs.mkdirSync(outDir, { recursive: true });

const init = { quality: a.quality || 'final', ...(readJsonArg(a.init) || {}) };
const modules = parseModules(a.modules, !!a.placeholders); if (modules) init.modules = modules;
const camera = readJsonArg(a.camera); if (camera) init.camera = camera;
if (a.N) init.N = +a.N;
const frameOpts = { ...(readJsonArg(a.opts) || {}) };
const retries = +(a.retries ?? 2);

// what determines the pixels (git hash and timings deliberately excluded: they do not invalidate a chunk)
const settings = { width: W, height: H, fps: FPS, init, frameOpts, encoder: 'ffv1', pixFmt: 'bgr0' };
const settingsHash = sha256(stableStringify(settings)).slice(0, 16);

const chunks = [];
for (let s = from; s < to; s += chunk) chunks.push([s, Math.min(to, s + chunk)]);
const nameOf = ([s, e]) => `chunk_${pad(s)}_${pad(e)}`;

function chunkComplete([s, e]) {
  const base = path.join(outDir, nameOf([s, e]));
  const mf = base + '.manifest.json', mkv = base + '.mkv';
  if (!fs.existsSync(mf) || !fs.existsSync(mkv)) return { ok: false, why: 'missing' };
  let m; try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { return { ok: false, why: 'bad manifest' }; }
  if (m.status !== 'complete') return { ok: false, why: `status ${m.status}` };
  if (m.settingsHash !== settingsHash) return { ok: false, why: `settings changed (${m.settingsHash} -> ${settingsHash})` };
  if (m.nb_frames !== e - s) return { ok: false, why: `nb_frames ${m.nb_frames} != ${e - s}` };
  if (fs.statSync(mkv).size !== m.bytes) return { ok: false, why: 'size mismatch' };
  const stale = m.inputs ? staleInputs(m.inputs) : (m.sceneHash !== sceneHash ? [`scene/ tree ${m.sceneHash} -> ${sceneHash}`] : []);
  if (stale.length && a['rerender-stale']) return { ok: false, why: `inputs changed: ${stale.slice(0, 4).join(', ')}${stale.length > 4 ? ` (+${stale.length - 4})` : ''}` };
  return { ok: true, manifest: m, stale };
}

const git = gitInfo();
const sceneHash = treeHash(['scene']).sha256.slice(0, 16);
console.log(`[render] frames [${from}, ${to}) in ${chunks.length} chunk(s) of ${chunk} -> ${outDir}  settings=${settingsHash} scene=${sceneHash} git=${git.hash || 'none'}`);

const todo = [];
for (const c of chunks) {
  const st = a.force ? { ok: false, why: 'forced' } : chunkComplete(c);
  if (st.ok && a.verify) {
    const mkv = path.join(outDir, nameOf(c) + '.mkv');
    const [h, n] = [await sha256File(mkv), countVideoPackets(mkv)];
    if (h !== st.manifest.sha256 || n !== c[1] - c[0]) { st.ok = false; st.why = 'verify failed'; }
  }
  if (st.ok) console.log(`[render] SKIP ${nameOf(c)}: complete (${st.manifest.nb_frames} frames, sha256 ${st.manifest.sha256.slice(0, 12)})${st.stale?.length ? `  WARNING: stale, inputs changed since it was rendered: ${st.stale.slice(0, 4).join(', ')} (use --rerender-stale)` : ''}`);
  else { todo.push(c); console.log(`[render] TODO ${nameOf(c)}: ${st.why}`); }
}
if (!todo.length) { console.log('[render] nothing to do: all chunks complete'); process.exit(0); }

// PRE-ROLL (integration 2026-10-22): the integrated scene is history-dependent by one frame (a frame's pixels depend on
// the frame rendered just before it; sandbox/integration/MODULE_ISSUES.md I-11). A chunk that starts a session (or a
// retry) would otherwise follow the warm-up frame instead of its film predecessor and differ from a continuous render.
// So the frame before the chunk is rendered first, with the chunk's own settings, and discarded. With one-frame memory
// this makes chunked, resumed and continuous renders identical. Some shots showed a longer memory (S20 after a 1-frame
// pre-roll still depended on what came before), so the default pre-roll is 3 frames (1 % of a 300-frame chunk).
// --preroll K sets it, --no-preroll (or --preroll 0) turns it off.
let S = null, lastRendered = null;
const preroll = a['no-preroll'] ? 0 : Math.max(0, Math.round(+(a.preroll ?? 3)));
const openS = async () => { lastRendered = null; S = await openSession({ width: W, height: H, init, verbose: !!a.verbose }); console.log(`[render] session: gpu="${S.info.gpu.renderer}" modules=${S.info.modules.map((m) => `${m.slot}:${m.kind}`).join(',')} camera=${S.info.cameraSource} init ${fmtMs(S.info.initTimings.init)}`); };

async function renderChunk([s, e]) {
  const base = path.join(outDir, nameOf([s, e]));
  const partial = base + '.partial.mkv', mkv = base + '.mkv', mf = base + '.manifest.json';
  for (const f of [partial, mkv, mf]) if (fs.existsSync(f)) fs.rmSync(f);
  const tag = `chunk${s}`;
  const sink = ffmpegSink({ width: W, height: H, fps: FPS, args: ENCODERS.ffv1, out: partial });
  const asm = new FrameAssembler(sink, { start: s, frameBytes: W * H * 4, tag });
  S.setFrameHandler((i, tg, buf, q) => asm.onFrame(i, tg, buf, q));
  const started = new Date().toISOString(), t0 = Date.now();
  const per = []; const Ns = new Set(); const shots = new Set();
  const failFast = () => { const err = asm.error || sink.failed(); if (err) throw new Error(`frame writer failed: ${err.message}`); };
  let prerolled = null;
  try {
    if (preroll && s > 0 && lastRendered !== s - 1) {
      lastRendered = null;
      const p0 = Math.max(0, s - preroll);
      for (let f = p0; f < s; f++) await S.renderFrame(f, { ...frameOpts, transfer: 'none' });   // discarded: only sets the history
      prerolled = [p0, s]; lastRendered = s - 1;
    }
    for (let f = s; f < e; f++) {
      lastRendered = null;
      const r = await S.renderFrame(f, { ...frameOpts, transfer: 'post4async', tag }); // throws on context loss / crash
      lastRendered = f;
      failFast();
      per.push(r.timings.total); Ns.add(r.N); shots.add(r.shot);
      if ((f - s) % 30 === 29 || f === e - 1) {
        const el = Date.now() - t0, done = f - s + 1;
        console.log(`[render] ${nameOf([s, e])} ${done}/${e - s}  ${(el / done).toFixed(0)} ms/frame  eta ${fmtMs((el / done) * (e - s - done))}`);
      }
    }
    await S.flush();
    await asm._chain;
    failFast();
    if (asm.next !== e) throw new Error(`assembler stopped at frame ${asm.next}, expected ${e}`);
    // the page counts context-loss events for the whole session: any loss invalidates the chunk
    const pi = await S.pageInfo();
    if (pi.contextLost?.lost) throw new Error(`WebGL context was lost during the chunk (${JSON.stringify(pi.contextLost)})`);
    S.assertHealthy('end of chunk');
    await sink.end();
  } catch (err) { sink.kill(); throw err; }
  const wallMs = Date.now() - t0;
  const nb = countVideoPackets(partial);
  if (nb !== e - s) throw new Error(`${partial}: ffprobe counts ${nb} frames, expected ${e - s}`);
  fs.renameSync(partial, mkv);
  const inputs = await inputHashes(S.servedFiles());
  const sorted = [...per].sort((x, y) => x - y);
  const manifest = {
    status: 'complete', chunk: nameOf([s, e]), file: path.basename(mkv), range: [s, e], frames: e - s,
    timeRange: [s / FPS, e / FPS], fps: FPS, musicOffset: MUSIC_OFFSET,
    nb_frames: nb, bytes: fs.statSync(mkv).size, sha256: await sha256File(mkv),
    settings, settingsHash, N: [...Ns], shots: [...shots], preroll: prerolled,
    git, sceneHash, inputsHash: sha256(stableStringify(inputs)).slice(0, 16), inputs,
    three: S.info.three, gpu: S.info.gpu.renderer, modules: S.info.modules.map(({ slot, kind, url }) => ({ slot, kind, url })),
    cameraSource: S.info.cameraSource, cameraModule: S.info.cameraModule,
    chrome: await S.browser.version(), node: process.version, host: os.hostname(),
    timings: { wallMs, msPerFrame: +(wallMs / (e - s)).toFixed(1), pageMsMedian: +sorted[Math.floor(sorted.length / 2)].toFixed(1), pageMsMax: +sorted[sorted.length - 1].toFixed(1) },
    started, finished: new Date().toISOString(), command: process.argv.slice(1).join(' '),
  };
  writeJsonAtomic(mf, manifest);
  console.log(`[render] DONE ${nameOf([s, e])}: ${nb} frames, ${(manifest.bytes / 1e6).toFixed(1)} MB, ${manifest.timings.msPerFrame} ms/frame, sha256 ${manifest.sha256.slice(0, 12)}`);
  return manifest;
}

const tAll = Date.now();
let failed = 0;
try {
  for (const c of todo) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!S) await openS();
        await renderChunk(c);
        break;
      } catch (err) {
        console.error(`[render] chunk ${nameOf(c)} failed (attempt ${attempt + 1}): ${err.stack || err.message}`);
        try { await S?.close(); } catch {}
        S = null;
        if (attempt >= retries) { failed++; break; }
      }
    }
  }
} finally {
  await S?.close();
}
console.log(`[render] finished ${todo.length - failed}/${todo.length} chunk(s) in ${fmtMs(Date.now() - tAll)}${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
