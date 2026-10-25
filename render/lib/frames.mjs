// Frame plumbing: reassemble multi-part uploads in strict frame order, ffmpeg sinks, encoder presets, PNG writer.
import { spawn } from 'node:child_process';

/**
 * Reassembles `parts` slices per frame and hands complete frames to `sink(buf, frame, tag)` strictly in frame order,
 * starting at `start`. Idempotent under client retries: a duplicate part or an already written frame is ignored.
 */
export class FrameAssembler {
  constructor(sink, { start = 0, frameBytes = 0, tag = null } = {}) {
    this.sink = sink; this.next = start; this.frameBytes = frameBytes; this.tag = tag;
    this.parts = new Map(); this.done = new Map(); this.bytes = 0; this.frames = 0; this.duplicates = 0;
    this._chain = Promise.resolve();
    this.error = null; // sticky: once the sink fails, every later upload is answered with an error
  }
  async onFrame(i, tag, buf, q) {
    if (this.error) throw this.error;
    if (this.tag !== null && tag !== this.tag) throw new Error(`frame ${i}: unexpected tag "${tag}" (want "${this.tag}")`);
    const parts = +(q?.get('parts') || 1), part = +(q?.get('part') || 0);
    if (i < this.next || this.done.has(i)) { this.duplicates++; return; }
    let e = this.parts.get(i);
    if (!e) { e = { arr: new Array(parts), n: 0 }; this.parts.set(i, e); }
    if (!e.arr[part]) e.n++;
    e.arr[part] = buf;
    if (e.n < parts) return;
    this.parts.delete(i);
    const full = parts === 1 ? e.arr[0] : Buffer.concat(e.arr);
    if (this.frameBytes && full.length !== this.frameBytes) throw new Error(`frame ${i}: got ${full.length} bytes, expected ${this.frameBytes}`);
    this.done.set(i, full);
    // serialise sink writes so a frame can never overtake the one before it
    this._chain = this._chain.then(async () => {
      while (this.done.has(this.next)) {
        const b = this.done.get(this.next); this.done.delete(this.next);
        const f = this.next++;
        this.bytes += b.length; this.frames++;
        await this.sink(b, f, tag);
      }
    }).catch((e) => { this.error = this.error || e; throw this.error; });
    return this._chain;
  }
  get pending() { return this.parts.size + this.done.size; }
}

/**
 * ffmpeg raw-video sink with backpressure. sink(buf) resolves when ffmpeg can take more; .end() resolves with
 * { code, stderr }. If ffmpeg dies (crash, disk full, killed) every pending and later write rejects at once:
 * a write waiting for 'drain' would otherwise wait forever (the pipe never drains after EPIPE), and with it the
 * frame POST, the page's upload and the driver.
 */
export function ffmpegSink({ width, height, fps = 60, inPixFmt = 'rgba', args, out, loglevel = 'error' }) {
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', loglevel, '-f', 'rawvideo', '-pix_fmt', inPixFmt,
    '-s', `${width}x${height}`, '-framerate', String(fps), '-i', '-', ...args, out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '', failed = null, ending = false;
  const waiters = new Set();
  const fail = (e) => {
    if (failed) return;
    failed = e;
    for (const w of waiters) w.rej(e);
    waiters.clear();
  };
  ff.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
  ff.on('error', (e) => fail(new Error(`ffmpeg could not run: ${e.message}`)));
  ff.stdin.on('error', (e) => fail(new Error(`ffmpeg stdin failed: ${e.message}\n${stderr.slice(-2000)}`)));
  const closed = new Promise((res) => ff.on('close', (code, signal) => {
    if (!ending || code !== 0) fail(new Error(`ffmpeg exited (code ${code}, signal ${signal})${ending ? '' : ' in the middle of the stream'}\n${stderr.slice(-2000)}`));
    res({ code, signal, stderr });
  }));
  const sink = (buf) => new Promise((res, rej) => {
    if (failed) return rej(failed);
    if (ff.stdin.write(buf)) return res();
    const w = { res, rej };
    waiters.add(w);
    ff.stdin.once('drain', () => { if (waiters.delete(w)) res(); });
  });
  sink.end = async () => {
    if (failed) throw failed;
    ending = true; ff.stdin.end();
    const r = await closed;
    if (failed) throw failed;
    return r;
  };
  sink.kill = () => { try { ff.kill('SIGKILL'); } catch {} };
  sink.failed = () => failed;
  sink.proc = ff;
  return sink;
}

/** write one RGBA frame (top-down rows) to a PNG (RGB, 8 bit) */
export function rgbaToPng(buf, width, height, file) {
  return new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
      '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgb24', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; ff.stderr.on('data', (d) => { err += d; });
    ff.on('close', (c) => (c === 0 ? res(file) : rej(new Error(`ffmpeg png ${c}: ${err}`))));
    ff.stdin.end(buf);
  });
}

// Colour: frames are display-referred sRGB-encoded RGB. Convert with an explicit BT.709 matrix (ffmpeg defaults to
// BT.601 for RGB->YUV) and tag primaries/transfer/matrix/range with setparams (plain -color_* output flags were not
// written by libx264 in the research test). Verified with ffprobe in research/rendering.md section 2.5 and again by
// encode.mjs --verify.
export const VF709 = 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/**
 * The deliverable video filter. With `fps`, timestamps are first rebuilt from the frame index (setpts=N/(fps*TB)):
 * the FFV1 chunks are Matroska files with millisecond timestamps, so a chunk whose length is not a multiple of 3 frames
 * has a rounded duration, and the concat demuxer would add those errors up (and -fps_mode cfr would then duplicate or
 * drop frames). Rebuilt timestamps make the output exactly one frame per decoded input frame.
 */
export const vf709 = (fps) => (fps ? `setpts=N/(${fps}*TB),` : '') + VF709;

export const ENCODERS = {
  // lossless render-time master: intra-only, sliced, CRC'd (fast enough not to slow the GPU; x264 does)
  ffv1: ['-c:v', 'ffv1', '-level', '3', '-g', '1', '-slices', '16', '-slicecrc', '1', '-pix_fmt', 'bgr0'],
  x264: ({ crf = 14, preset = 'slow', fps = 0 } = {}) => ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-vf', vf709(fps), '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'],
  x265_10: ({ crf = 14, preset = 'slow', fps = 0 } = {}) => ['-c:v', 'libx265', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p10le',
    '-x265-params', 'log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited', '-vf', vf709(fps), '-tag:v', 'hvc1'],
  // ProRes in .mov: ffmpeg's mov muxer writes a QuickTime 'nclc' colr atom, which has no range field, so the range is
  // tagged afterwards by rewriting it as 'nclx' (render/lib/mov.mjs, called by encode.mjs)
  prores_hq: ({ fps = 0 } = {}) => ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', '-vf', vf709(fps),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'],
};
