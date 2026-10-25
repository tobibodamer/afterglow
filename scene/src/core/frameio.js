// Pixel readback and upload to the Node driver (research/rendering.md section 3).
//
// - Sync readPixels of the RGBA8 output target (rows already flipped top-down by the final pass): 7-16 ms at 1080p.
//   (The async PBO path was measured slower.)
// - Upload = 4 parallel fetch POSTs of Blob slices (~200 MB/s on localhost; an ArrayBuffer body is 10x slower).
// - Pipelined: the upload of frame f runs while frame f+1 renders; at most one upload is in flight.
// - window.gc() (Chrome --js-flags=--expose-gc) after every upload: otherwise uncollected Blobs fill blob storage at
//   ~60 frames of 1080p and every fetch fails. Each slice is retried up to 5 times; the Node assembler is idempotent.
// - Readback integrity: the final pass writes alpha = 255 in every pixel. A strided sample of alpha bytes is zeroed
//   before each read and checked after it, so a read that silently did nothing (lost context) cannot pass the
//   previous frame's pixels off as this one.
// - Each slice POST has a timeout (default 180 s), so a stuck receiver fails the frame instead of hanging the page.
export class FrameIO {
  constructor(renderer, target, { check = null, timeoutMs = 180000 } = {}) {
    this.renderer = renderer; this.target = target;
    this.width = target.width; this.height = target.height;
    this.bufs = [0, 1].map(() => new Uint8Array(this.width * this.height * 4));
    this.flip = 0; this.inflight = null; this.last = null; this.retries = 0; this.uploads = 0;
    this.check = check; this.timeoutMs = timeoutMs;
    const n = this.width * this.height;
    this.sentinelStep = Math.max(1, Math.floor(n / 4096)) * 4; // ~4096 alpha bytes per frame, plus the last pixel
  }

  /** wait for the in-flight upload (if any); returns ms waited */
  async drain() {
    if (!this.inflight) return 0;
    const t = performance.now();
    const p = this.inflight; this.inflight = null;
    await p;
    return performance.now() - t;
  }

  /** read the output target into the next buffer (top-down RGBA rows) */
  read() {
    this.flip ^= 1;
    const buf = this.bufs[this.flip], end = buf.length, step = this.sentinelStep;
    for (let i = 3; i < end; i += step) buf[i] = 0;
    buf[end - 1] = 0;
    this.renderer.readRenderTargetPixels(this.target, 0, 0, this.width, this.height, buf);
    this.check?.('readback');
    for (let i = 3; i < end; i += step) if (buf[i] !== 255) throw new Error(`readback check failed: alpha ${buf[i]} at byte ${i} (expected 255): the read did not happen`);
    if (buf[end - 1] !== 255) throw new Error(`readback check failed: alpha ${buf[end - 1]} in the last pixel (expected 255)`);
    this.last = buf;
    return buf;
  }

  /** POST buf to /frame in `parts` slices. pipelined = return immediately (the next drain() waits for it) */
  async upload(buf, { frame, tag = '', parts = 4, endpoint = '/frame', pipelined = false } = {}) {
    if (this.inflight) await this.drain();
    const q = buf.byteLength / parts;
    if (q !== Math.floor(q)) throw new Error(`frame size ${buf.byteLength} not divisible into ${parts} parts`);
    const send = async (k) => {
      const body = new Blob([buf.subarray(k * q, (k + 1) * q)]); // the Blob copies the bytes: buf may be reused at once
      for (let attempt = 0; ; attempt++) {
        let timedOut = false;
        const ac = new AbortController(), timer = setTimeout(() => { timedOut = true; ac.abort(); }, this.timeoutMs);
        try {
          const res = await fetch(`${endpoint}?i=${frame}&tag=${encodeURIComponent(tag)}&part=${k}&parts=${parts}`, { method: 'POST', body, signal: ac.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
          return;
        } catch (e) {
          this.retries++;
          const msg = timedOut ? `no answer within ${this.timeoutMs} ms` : String(e);
          console.warn('[AG] upload retry', frame, k, attempt, msg);
          if (attempt >= 5 || timedOut) throw new Error(`upload of frame ${frame} part ${k} failed: ${msg}`);
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        } finally { clearTimeout(timer); }
      }
    };
    const p = Promise.all([...Array(parts).keys()].map(send)).then(() => { this.uploads++; if (typeof window.gc === 'function') window.gc(); });
    if (pipelined) { this.inflight = p; p.catch(() => {}); return; }
    await p;
  }
}
