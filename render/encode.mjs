// Concatenate FFV1 chunks -> deliverables.
//   node render/encode.mjs --chunks build/chunks/film --audio build/audio/afterglow.wav --out build/out/afterglow_1080p60.mp4
// Options:
//   --chunks DIR           directory with chunk_*.mkv + *.manifest.json (render.mjs output)
//   --from A --to B        encode only frames [A, B) (must be covered by complete, contiguous chunks; default: all)
//   --audio file.wav       soundtrack; placed at film time MUSIC_OFFSET (4.0 s, scene/src/core/constants.js) or --offset S
//   --out file.mp4         H.264 High, CRF 14 (--crf), -preset slow (--preset), yuv420p, BT.709 matrix + tags, AAC 320k
//   --archive prores,x265  also write ProRes 422 HQ (.mov, PCM 24-bit) and/or x265 10-bit (.mkv, FLAC) next to --out
//   --master               also write the concatenated lossless FFV1 master (.mkv, stream copy)
//   --allow-mixed          encode even if the chunks were rendered from different scene states (see Provenance)
//   --no-verify            skip verification (on by default; writes <out>.verify.json)
// Provenance: every chunk manifest records the settings hash, the modules (real/placeholder/url), the camera source and
// the content hash of every file the page loaded. Chunks that disagree on any of these (e.g. a resumed render after
// shots.js or a real module appeared, or after perf.bin was re-solved) would splice two different films: encode.mjs
// refuses them unless --allow-mixed. GPU, Chrome and three versions and the scene/ tree hash are compared as warnings.
// Timing: the chunks are Matroska files with millisecond timestamps; a chunk that is not a multiple of 3 frames long
// has a rounded duration. The concat list states each chunk's exact duration, and every output rebuilds its timestamps
// from the frame index (setpts=N/(60*TB)), so any chunk length gives exactly one output frame per rendered frame.
// Audio alignment: the WAV sample at music time m plays at film time t = m + offset. For a range starting at film time
// T0 = A/60 the WAV is delayed by (offset - T0) (exact, in samples) or trimmed by (T0 - offset), then padded/trimmed
// to exactly the video duration.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, ffprobe, runFfmpeg, writeJsonAtomic, fmtMs } from './lib/util.mjs';
import { ENCODERS } from './lib/frames.mjs';
import { tagMovColorRange } from './lib/mov.mjs';
import { FPS, MUSIC_OFFSET } from '../scene/src/core/constants.js';

const a = parseArgs();
if (!a.chunks || !a.out) { console.error('usage: node render/encode.mjs --chunks DIR --out file.mp4 [--audio file.wav] [--offset 4] [--archive prores,x265] [--master] [--allow-mixed]'); process.exit(2); }
const dir = path.resolve(a.chunks), out = path.resolve(a.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
const offset = a.offset !== undefined ? +a.offset : MUSIC_OFFSET;
const stem = out.replace(/\.[^.]+$/, '');

// ---- chunks
const manifests = fs.readdirSync(dir).filter((f) => f.endsWith('.manifest.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((m) => m.status === 'complete')
  .sort((x, y) => x.range[0] - y.range[0]);
if (!manifests.length) throw new Error(`no complete chunks in ${dir}`);
const from = a.from !== undefined ? +a.from : manifests[0].range[0];
const to = a.to !== undefined ? +a.to : manifests[manifests.length - 1].range[1];
const use = manifests.filter((m) => m.range[1] > from && m.range[0] < to);
let cursor = from;
for (const m of use) {
  if (m.range[0] !== cursor) throw new Error(`gap or overlap: expected a chunk starting at frame ${cursor}, found ${m.chunk}`);
  if (!fs.existsSync(path.join(dir, m.file))) throw new Error(`missing ${m.file}`);
  cursor = m.range[1];
}
if (cursor < to || use[0].range[0] !== from || use[use.length - 1].range[1] !== to) throw new Error(`chunks do not cover exactly [${from}, ${to}) (selection must align to chunk boundaries)`);
const frames = to - from, T0 = from / FPS, dur = frames / FPS;
const { width, height } = use[0].settings;
if (use.some((m) => m.settings.width !== width || m.settings.height !== height)) throw new Error('chunks have different sizes');

// ---- provenance: were all chunks rendered from the same scene state?
function provenance(list) {
  const errors = [], warnings = [];
  const groupsOf = (f) => { const g = new Map(); for (const m of list) { const k = JSON.stringify(f(m) ?? null); if (!g.has(k)) g.set(k, []); g.get(k).push(m.chunk); } return g; };
  const describe = (g) => [...g].map(([v, cs]) => `${v} in ${cs.length} chunk(s) [${cs.slice(0, 3).join(', ')}${cs.length > 3 ? ', ...' : ''}]`).join('  |  ');
  const strict = {
    settingsHash: (m) => m.settingsHash,
    modules: (m) => (m.modules || []).map(({ slot, kind, url }) => `${slot}:${kind}:${url}`),
    cameraSource: (m) => m.cameraSource,
    cameraModule: (m) => m.cameraModule,
  };
  for (const [k, f] of Object.entries(strict)) { const g = groupsOf(f); if (g.size > 1) errors.push(`${k} differs: ${describe(g)}`); }
  const withInputs = list.filter((m) => m.inputs);
  const files = new Map();
  for (const m of withInputs) for (const [rel, h] of Object.entries(m.inputs)) {
    if (!files.has(rel)) files.set(rel, new Map());
    const g = files.get(rel); if (!g.has(h)) g.set(h, []); g.get(h).push(m.chunk);
  }
  for (const [rel, g] of files) {
    if (g.size > 1) errors.push(`input ${rel} has different content between chunks: ${describe(g)}`);
    else if ([...g.keys()].some((h) => h === 'missing' || h.startsWith('changed:'))) errors.push(`input ${rel} changed while it was being rendered: ${describe(g)}`);
  }
  const scene = groupsOf((m) => m.sceneHash);
  if (withInputs.length < list.length) { if (scene.size > 1) errors.push(`sceneHash differs (some manifests predate input hashing): ${describe(scene)}`); }
  else if (scene.size > 1) warnings.push(`the scene/ tree hash differs, but every file the page loaded is identical: ${describe(scene)}`);
  for (const k of ['gpu', 'three', 'chrome']) { const g = groupsOf((m) => m[k]); if (g.size > 1) warnings.push(`${k} differs: ${describe(g)}`); }
  return { consistent: !errors.length, errors, warnings, chunksWithInputs: withInputs.length, inputFiles: files.size };
}
const prov = provenance(use);
console.log(`[encode] ${use.length} chunk(s), frames [${from}, ${to}) = ${frames} frames, ${dur.toFixed(3)} s, ${width}x${height}; provenance ${prov.consistent ? `consistent (${prov.inputFiles} input files compared)` : 'MIXED'}`);
for (const w of prov.warnings) console.log(`[encode] WARNING: ${w}`);
if (!prov.consistent) {
  for (const e of prov.errors) console.error(`[encode] ${a['allow-mixed'] ? 'WARNING' : 'ERROR'}: chunks rendered from different scene states: ${e}`);
  if (!a['allow-mixed']) { console.error('[encode] refusing to splice them into one film. Re-render the stale chunks (render.mjs --rerender-stale or --force), or pass --allow-mixed.'); process.exit(2); }
}

const listFile = stem + '.concat.txt';
fs.writeFileSync(listFile, 'ffconcat version 1.0\n' + use.map((m) => `file '${path.join(dir, m.file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration ${((m.range[1] - m.range[0]) / FPS).toFixed(9)}\n`).join(''));
const vIn = ['-f', 'concat', '-safe', '0', '-i', listFile];

// ---- audio
let aIn = [], aMap = [], afilter = null, wavInfo = null;
if (a.audio) {
  const wav = path.resolve(a.audio);
  const p = ffprobe(wav);
  const as = p.streams.find((s) => s.codec_type === 'audio');
  if (!as) throw new Error(`${wav}: no audio stream`);
  const sr = +as.sample_rate;
  wavInfo = { file: wav, sampleRate: sr, channels: as.channels, duration: +p.format.duration, codec: as.codec_name };
  const lead = offset - T0; // > 0: silence before the music; < 0: start inside the music
  const total = Math.round(dur * sr);
  const parts = [];
  if (lead > 0) parts.push(`adelay=delays=${Math.round(lead * sr)}S:all=1`);
  else if (lead < 0) parts.push(`atrim=start_sample=${Math.round(-lead * sr)}`, 'asetpts=N/SR/TB');
  parts.push(`apad=whole_len=${total}`, `atrim=end_sample=${total}`, 'asetpts=N/SR/TB');
  afilter = parts.join(',');
  aIn = ['-i', wav]; aMap = ['-map', '1:a:0', '-af', afilter];
  console.log(`[encode] audio ${path.basename(wav)} ${sr} Hz x${as.channels}, offset ${offset} s, film start ${T0.toFixed(3)} s -> ${afilter}`);
}

const t0 = Date.now();
const outputs = [];   // { file, kind }
const vcommon = ['-map', '0:v:0', '-fps_mode', 'cfr', '-r', String(FPS)];

// H.264 deliverable
await runFfmpeg([...vIn, ...aIn, ...vcommon, ...aMap, ...ENCODERS.x264({ crf: +(a.crf ?? 14), preset: a.preset || 'slow', fps: FPS }),
  ...(a.audio ? ['-c:a', 'aac', '-b:a', '320k'] : []), '-movflags', '+faststart', '-metadata', `comment=afterglow frames ${from}-${to}`, out]);
outputs.push({ file: out, kind: 'h264' });
console.log(`[encode] wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) in ${fmtMs(Date.now() - t0)}`);

const colrTags = {};
for (const kind of String(a.archive || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const t1 = Date.now();
  let file, args;
  if (kind === 'prores') { file = stem + '_prores422hq.mov'; args = [...ENCODERS.prores_hq({ fps: FPS }), ...(a.audio ? ['-c:a', 'pcm_s24le'] : [])]; }
  else if (kind === 'x265') { file = stem + '_x265_10bit.mkv'; args = [...ENCODERS.x265_10({ crf: +(a.x265crf ?? 12), preset: a.x265preset || 'slow', fps: FPS }), ...(a.audio ? ['-c:a', 'flac'] : [])]; }
  else throw new Error(`unknown --archive ${kind} (prores | x265)`);
  await runFfmpeg([...vIn, ...aIn, ...vcommon, ...aMap, ...args, file]);
  if (kind === 'prores') { colrTags[path.basename(file)] = tagMovColorRange(file, { fullRange: false }); console.log(`[encode] ${path.basename(file)}: colr nclc -> nclx (range tv): ${JSON.stringify(colrTags[path.basename(file)])}`); }
  outputs.push({ file, kind });
  console.log(`[encode] wrote ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB) in ${fmtMs(Date.now() - t1)}`);
}
if (a.master) {
  const file = stem + '_ffv1_master.mkv';
  await runFfmpeg([...vIn, '-map', '0:v:0', '-c', 'copy', file]);
  outputs.push({ file, kind: 'master' });
}

if (a['no-verify'] || a.verify === 'false') process.exit(0);

// ---- verification
const report = { command: process.argv.slice(1).join(' '), range: [from, to], frames, duration: dur, offset, chunks: use.map((m) => m.chunk), provenance: { ...prov, mixedAllowed: !prov.consistent && !!a['allow-mixed'] }, colrTags, outputs: {}, checks: {} };
const EXPECT = { h264: { pix: 'yuv420p', tagged: true }, prores: { pix: 'yuv422p10le', tagged: true }, x265: { pix: 'yuv420p10le', tagged: true }, master: { pix: 'bgr0', tagged: false } };
for (const { file, kind } of outputs) {
  const p = ffprobe(file, ['-show_streams', '-show_format', '-count_packets']);
  const v = p.streams.find((s) => s.codec_type === 'video'), au = p.streams.find((s) => s.codec_type === 'audio');
  report.outputs[path.basename(file)] = {
    kind, bytes: +p.format.size, duration: +p.format.duration, bitRateMbps: +(p.format.bit_rate / 1e6).toFixed(2),
    video: { codec: v.codec_name, profile: v.profile, pix_fmt: v.pix_fmt, width: v.width, height: v.height, r_frame_rate: v.r_frame_rate, avg_frame_rate: v.avg_frame_rate,
      nb_frames: +(v.nb_read_packets || v.nb_frames), color_space: v.color_space, color_transfer: v.color_transfer, color_primaries: v.color_primaries, color_range: v.color_range, start_time: +v.start_time },
    audio: au ? { codec: au.codec_name, sample_rate: +au.sample_rate, channels: au.channels, bit_rate: +au.bit_rate, duration: +au.duration, start_time: +au.start_time } : null,
  };
}

/**
 * Per-frame comparison of an output with the lossless chunks. outConv / srcConv convert the decoded output and the
 * source into a common pixel format. One ffmpeg run, four PSNR streams with timestamps rebuilt from the frame index
 * (exact pairing by index):
 *   p0: out k vs src k,  p1: out k vs src k-1,  p2: out k vs src k+1,  p3: src k vs src k-1
 * Quality = p0 statistics. Identity = every output frame matches its own source frame better than either neighbour,
 * judged only where the neighbour differs from it by more than the encoding error (p3 < p0 - 3 dB): a dropped,
 * duplicated or reordered frame fails this on every moving frame after it, while an encoder quality dip on one frame
 * only lowers p0 there.
 */
const RGB = 'format=gbrp';
// decode a tv-range YUV output to RGB with a given matrix (the matrix control compares bt709 against bt601)
const decodeRgb = (matrix) => `scale=in_color_matrix=${matrix}:in_range=tv:flags=accurate_rnd+full_chroma_int,format=gbrp`;
// the deliverable's own RGB -> YUV conversion (frames.mjs VF709, same swscale call), uncompressed: the reference
// picture the encoder was given. Comparing in this domain measures compression loss only. The chroma subsampling of
// 4:2:0 alone costs 40-43 dB in RGB on this film's content, and less than 40 dB on small aliased test frames, so an
// RGB PSNR threshold would judge the format, not the encode.
const toDeliverable = (pix) => `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=${pix}`;
async function compareToSource(file, { outConv, srcConv = RGB, maxFrames = 0, identity = true } = {}) {
  const n = maxFrames ? Math.min(maxFrames, frames) : frames;
  const tmp = fs.mkdtempSync(stem + '.cmp-');
  const ts = `setpts=N/(${FPS}*TB)`;
  const conv = outConv;
  const id = identity && n >= 3;
  const g = id
    ? `[0:v]${ts},${conv},trim=end_frame=${n},split=3[a0][a1][a2];[1:v]${ts},${srcConv},trim=end_frame=${n},split=5[b0][b1][b2][b3][b4];`
      + `[a1]trim=start_frame=1,${ts}[a1s];[b1]trim=end_frame=${n - 1},${ts}[b1s];[a2]trim=end_frame=${n - 1},${ts}[a2s];[b2]trim=start_frame=1,${ts}[b2s];`
      + `[b3]trim=start_frame=1,${ts}[c1];[b4]trim=end_frame=${n - 1},${ts}[c0];`
      + '[a0][b0]psnr=stats_file=p0.log[o0];[a1s][b1s]psnr=stats_file=p1.log[o1];[a2s][b2s]psnr=stats_file=p2.log[o2];[c1][c0]psnr=stats_file=p3.log[o3]'
    : `[0:v]${ts},${conv},trim=end_frame=${n}[a0];[1:v]${ts},${srcConv},trim=end_frame=${n}[b0];[a0][b0]psnr=stats_file=p0.log[o0]`;
  const outs = (id ? ['o0', 'o1', 'o2', 'o3'] : ['o0']).flatMap((o) => ['-map', `[${o}]`, '-f', 'null', '-']);
  await runFfmpeg(['-i', file, ...vIn, '-filter_complex', g, ...outs], { cwd: tmp }); // all paths absolute; stats files land in tmp
  const read = (f) => {
    const p = path.join(tmp, f); if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => {
      const mse = +/mse_avg:([\d.]+)/.exec(l)[1], ps = /psnr_avg:([\d.]+|inf)/.exec(l)[1];
      return { mse, psnr: ps === 'inf' ? Infinity : +ps };
    });
  };
  const p0 = read('p0.log'), p1 = read('p1.log'), p2 = read('p2.log'), p3 = read('p3.log');
  fs.rmSync(tmp, { recursive: true, force: true });
  const ps = p0.map((x) => x.psnr), sorted = [...ps].sort((x, y) => x - y);
  // average PSNR = PSNR of the mean normalised MSE (10^(-psnr/10) per frame): independent of the bit depth (the psnr
  // filter reports mse in 10-bit units for the 10-bit outputs)
  const meanNmse = ps.reduce((s, x) => s + (x === Infinity ? 0 : 10 ** (-x / 10)), 0) / Math.max(1, ps.length);
  const res = {
    frames: p0.length, average: meanNmse > 0 ? +(-10 * Math.log10(meanNmse)).toFixed(3) : Infinity,
    min: +sorted[0]?.toFixed(3), p1: +sorted[Math.floor(0.01 * (sorted.length - 1))]?.toFixed(3),
    below35: ps.filter((x) => x < 35).length, worst: ps.map((x, k) => [k + from, x]).sort((x, y) => x[1] - y[1]).slice(0, 3).map(([f, x]) => ({ frame: f, psnr: +x.toFixed(2) })),
  };
  if (id) {
    let testable = 0; const violations = [];
    for (let k = 0; k < n; k++) {
      const own = ps[k];
      const alts = [];
      if (k >= 1) alts.push({ alt: p1[k - 1]?.psnr, src: p3[k - 1]?.psnr, what: 'previous' });   // p1 line k-1: out k vs src k-1; p3 line k-1: src k vs src k-1
      if (k <= n - 2) alts.push({ alt: p2[k]?.psnr, src: p3[k]?.psnr, what: 'next' });          // p2 line k: out k vs src k+1; p3 line k: src k+1 vs src k
      let tested = false;
      for (const x of alts) {
        if (x.alt === undefined || x.src === undefined) continue;
        if (!(x.src < own - 3)) continue;  // the neighbour is closer to this frame than the encoding error: not decisive
        tested = true;
        if (!(own > x.alt)) violations.push({ frame: k + from, own: +own.toFixed(2), [x.what]: +x.alt.toFixed(2) });
      }
      if (tested) testable++;
    }
    res.identity = { testable, violations: violations.length, examples: violations.slice(0, 5) };
  }
  return res;
}

// compression loss against the uncompressed deliverable conversion (YUV domain, see toDeliverable). The minimum is a
// loose sanity bound: a single B-frame can dip well below its neighbours in a correct encode; dropped, duplicated or
// shifted frames are caught by the identity test and the frame count, not by PSNR.
const QUALITY = { h264: { average: 42, p1: 38, min: 30 }, prores: { average: 48, p1: 45, min: 40 }, x265: { average: 43, p1: 39, min: 32 } };
for (const { file, kind } of outputs) {
  const o = report.outputs[path.basename(file)], key = path.basename(file), exp = EXPECT[kind];
  const c = {};
  c.fps60 = o.video.r_frame_rate === `${FPS}/1` && (kind === 'master' || o.video.avg_frame_rate === `${FPS}/1`);
  c.frameCount = o.video.nb_frames === frames;
  c.pixFmt = o.video.pix_fmt === exp.pix;
  if (exp.tagged) c.bt709tv = o.video.color_space === 'bt709' && o.video.color_transfer === 'bt709' && o.video.color_primaries === 'bt709' && o.video.color_range === 'tv';
  o.compare = await compareToSource(file, kind === 'master' ? { outConv: RGB } : { outConv: `format=${exp.pix}`, srcConv: toDeliverable(exp.pix) });
  if (kind === 'master') c.losslessCopy = o.compare.frames === frames && o.compare.min === Infinity;
  else {
    const q = QUALITY[kind];
    c.pictureQuality = o.compare.frames === frames && o.compare.average > q.average && o.compare.p1 > q.p1 && o.compare.min > q.min;
  }
  c.frameIdentity = o.compare.identity ? o.compare.identity.violations === 0 : o.compare.frames === frames;
  report.checks[key] = c;
}
// absolute colour (first 120 frames): the H.264 decoded to RGB with BT.709 must match the RGB source to within the
// 4:2:0 + compression error (this also catches a wrong range or matrix in the shared conversion, which the YUV-domain
// comparison cannot see), and decoded with the wrong BT.601 matrix it must be clearly worse
const mainKey = path.basename(out), main = report.outputs[mainKey];
main.compareRgbBt709 = await compareToSource(out, { outConv: decodeRgb('bt709'), maxFrames: 120, identity: false });
main.compareRgbBt601WrongMatrix = await compareToSource(out, { outConv: decodeRgb('bt601'), maxFrames: 120, identity: false });
report.checks[mainKey].rgbMatchesSource = main.compareRgbBt709.average > 34;
// The matrix test is made at 1/8 scale (area average on both sides): at full resolution the 4:2:0 chroma loss and the
// compression error of fine texture dominate both PSNRs, and on a saturated wide full of water texture (integration
// test_wide, S03) the margin fell to 2.96 dB although the matrix was right. Averaged over 8x8 blocks those errors
// cancel and what is left is the matrix error, so the 3 dB margin tests the matrix alone (the full-res numbers stay
// in the report).
const down = ',scale=iw/8:ih/8:flags=area';
main.compareRgbBt709Down8 = await compareToSource(out, { outConv: decodeRgb('bt709') + down, srcConv: RGB + down, maxFrames: 120, identity: false });
main.compareRgbBt601WrongMatrixDown8 = await compareToSource(out, { outConv: decodeRgb('bt601') + down, srcConv: RGB + down, maxFrames: 120, identity: false });
report.checks[mainKey].matrixIsBt709 = main.compareRgbBt709Down8.average > main.compareRgbBt601WrongMatrixDown8.average + 3;

// audio: the MP4 track against the WAV over the same film-time window (the expected signal is the WAV segment that
// should play in [T0, T0 + dur)). Offset = cross-correlation lag in two windows (around the first onset and around
// the loudest passage of the last third), plus the onset (first sample above 25% of the window's own peak) for
// reference; both signals use their own peak over the same window, so the thresholds match.
async function decodeMono48k(file, n) {
  const r = await runFfmpeg(['-i', file, '-map', 'a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  return n === undefined ? f : f.subarray(0, n);
}
function xcorrLag(x, y, start, len, maxLag) {
  let best = -Infinity, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0, ex = 0, ey = 0;
    for (let i = start; i < start + len; i++) { const j = i + lag; if (j < 0 || j >= y.length || i >= x.length) continue; s += x[i] * y[j]; ex += x[i] * x[i]; ey += y[j] * y[j]; }
    const c = ex && ey ? s / Math.sqrt(ex * ey) : 0;
    if (c > best) { best = c; bestLag = lag; }
  }
  return { lag: bestLag, corr: best };
}
if (a.audio && main.audio) {
  const SR = 48000, n = Math.round(dur * SR), shift = Math.round((T0 - offset) * SR);
  const wavAll = await decodeMono48k(path.resolve(a.audio));
  const expected = new Float32Array(n);
  for (let i = 0; i < n; i++) { const j = i + shift; if (j >= 0 && j < wavAll.length) expected[i] = wavAll[j]; }
  const got = await decodeMono48k(out, n);
  const onset = (x) => { let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v)); if (peak < 1e-5) return { t: null, peak }; const thr = 0.25 * peak; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= thr) return { t: i / SR, i, peak }; return { t: null, peak }; };
  const oe = onset(expected), og = onset(got);
  const ao = { expectedOnset: oe.t, mp4Onset: og.t, onsetErrorMs: oe.t != null && og.t != null ? +((og.t - oe.t) * 1000).toFixed(3) : null, expectedPeak: +oe.peak.toFixed(4), mp4Peak: +og.peak.toFixed(4), mp4Samples48k: got.length, expectedSamples48k: n };
  if (oe.t == null) { report.checks[mainKey].audioOffset = og.t == null; ao.note = 'the WAV is silent in this range'; }
  else {
    const W = Math.min(Math.round(0.5 * SR), n), maxLag = Math.round(0.02 * SR);
    const energy = (s) => { let e = 0; for (let i = s; i < s + W; i += 8) e += expected[i] * expected[i]; return e; };
    const w1 = Math.max(0, Math.min(n - W, oe.i - Math.round(0.1 * SR)));
    let w2 = w1, bestE = -1;
    for (let s = Math.floor((2 * n) / 3); s + W <= n; s += Math.round(0.05 * SR)) { const e = energy(s); if (e > bestE) { bestE = e; w2 = s; } }
    // the second window only counts where the expected signal has some energy (a silent stretch correlates with
    // nothing, and says nothing about the offset)
    const starts = w2 !== w1 && bestE > 1e-3 * energy(w1) ? [w1, w2] : [w1];
    ao.windows = starts.map((s) => ({ startSec: +(s / SR).toFixed(3), ...xcorrLag(expected, got, s, W, maxLag) })).map((w) => ({ ...w, lagMs: +(w.lag / 48).toFixed(3), corr: +w.corr.toFixed(4) }));
    report.checks[mainKey].audioOffset = ao.windows.every((w) => Math.abs(w.lagMs) < 2 && w.corr > 0.9) && ao.onsetErrorMs != null && Math.abs(ao.onsetErrorMs) < 2;
  }
  report.audio = ao;
  report.checks[mainKey].audioDuration = Math.abs(main.audio.duration - dur) < 0.03;
  // (target -b:a 320k; ffprobe's measured bit_rate is far lower for mostly-silent test audio, so only the codec is checked)
  report.checks[mainKey].aacAudio = main.audio.codec === 'aac' && main.audio.channels === wavInfo.channels;
}
report.ok =Object.values(report.checks).every((c) => Object.values(c).every(Boolean));
writeJsonAtomic(stem + '.verify.json', report);
console.log('[encode] verify', JSON.stringify({ checks: report.checks, compare: Object.fromEntries(Object.entries(report.outputs).map(([k, o]) => [k, o.compare])), rgb709: main.compareRgbBt709?.average, bt601: main.compareRgbBt601WrongMatrix?.average, audio: report.audio, video: main.video }, null, 1));
console.log(`[encode] ${report.ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}${report.provenance.mixedAllowed ? ' (chunks from MIXED scene states, allowed by --allow-mixed)' : ''} -> ${stem}.verify.json`);
process.exit(report.ok ? 0 : 1);
