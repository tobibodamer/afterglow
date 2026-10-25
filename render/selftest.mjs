// Render-core self test (placeholders, small frame). Checks what silently breaks an accumulation renderer:
//   gpu        WebGL renderer is the expected hardware GPU (never SwiftShader)
//   accumAlpha accumulation alpha == 1 everywhere (autoClear trap: otherwise only the last sub-frame survives)
//   glare      veiling-glare lobe integrates to the input energy (energy conserving, no threshold)
//   lutIdent   an identity .cube changes no pixel by more than 1 code value
//   lutSwap    an R<->B swap .cube gives the R<->B swapped image (proves .cube axis order: red fastest)
//   repeat     the same frame twice in one session is bit-identical
//   glareMix   the final pass mixes the lobe with amount * (1 - PSF core energy) (the core stays in the image)
//   glareScale a small source's far halo (energy beyond 0.042 and 0.17 image heights) is the same at 960x540, 1920x1080
//              and 3840x2160, measured on the rendered glare pyramid (within 5%)
//   contextLoss after WEBGL_lose_context loses and restores the context, renderFrame throws (no stale frames)
//   dispose    AG.dispose() calls every module's dispose() without errors
//   node render/selftest.mjs [--size 480x270]
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './lib/session.mjs';
import { FrameAssembler } from './lib/frames.mjs';
import { parseArgs, parseSize, sha256 } from './lib/util.mjs';
import { REPO_ROOT } from './lib/server.mjs';

const a = parseArgs();
const [W, H] = parseSize(a.size, [480, 270]);
const dir = path.join(REPO_ROOT, 'build', 'selftest');
fs.mkdirSync(dir, { recursive: true });
const cube = (name, f, S = 17) => {
  let s = `TITLE "${name}"\nLUT_3D_SIZE ${S}\n`;
  for (let b = 0; b < S; b++) for (let g = 0; g < S; g++) for (let r = 0; r < S; r++) s += f(r / (S - 1), g / (S - 1), b / (S - 1)).map((x) => x.toFixed(6)).join(' ') + '\n';
  fs.writeFileSync(path.join(dir, name + '.cube'), s);   // kept for inspection; the page gets the text itself
  return s;   // AG.setLUT accepts .cube text: works whatever tree is served (AG_SERVE_ROOT snapshots have no build/selftest)
};
const identUrl = cube('identity17', (r, g, b) => [r, g, b]);
const swapUrl = cube('swap_rb17', (r, g, b) => [b, g, r]);

const checks = {};
const S = await openSession({ width: W, height: H, init: { modules: 'placeholders', quality: 'final', N: 8, lut: 'identity' } });   // baseline without the film LUT (lutIdent/lutSwap compare against it)
checks.gpu = S.info.gpu.renderer;
let got = null, nTag = 0;
const frame = async (f, opts = {}) => {
  const tag = `selftest${++nTag}`;
  const asm = new FrameAssembler(async (buf) => { got = buf; }, { start: f, frameBytes: W * H * 4, tag });
  S.setFrameHandler((i, tg, buf, q) => asm.onFrame(i, tg, buf, q));
  await S.renderFrame(f, { ...opts, transfer: 'post4', tag });
  return got;
};
try {
  const base = await frame(300, { grade: { dither: 0 } });
  const again = await frame(300, { grade: { dither: 0 } });
  checks.repeat = sha256(base) === sha256(again);

  // accumulation alpha + glare energy, read back inside the page
  const e = await S.page.evaluate(() => {
    const ctx = window.__AG_CTX, r = ctx.renderer, acc = ctx.core.accum.accumRT, gl = ctx.core.final.glare;
    const w = acc.width, h = acc.height, f = new Float32Array(w * h * 4);
    r.readRenderTargetPixels(acc, 0, 0, w, h, f);
    let amin = Infinity, amax = -Infinity, sum = 0;
    for (let i = 0; i < w * h; i++) { const al = f[i * 4 + 3]; amin = Math.min(amin, al); amax = Math.max(amax, al); sum += f[i * 4] + f[i * 4 + 1] + f[i * 4 + 2]; }
    const lob = gl.render(acc.texture); // lobe of the current accumulation (half resolution, RGBA16F)
    const t = gl.acc[0], hw = t.width, hh = t.height, u = new Uint16Array(hw * hh * 4);
    r.readRenderTargetPixels(t, 0, 0, hw, hh, u);
    const half = (x) => { const s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 31, m = x & 1023; return e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + m / 1024); };
    let gsum = 0; for (let i = 0; i < hw * hh; i++) gsum += half(u[i * 4]) + half(u[i * 4 + 1]) + half(u[i * 4 + 2]);
    gsum *= (w * h) / (hw * hh);
    return { amin, amax, sum, gsum, ratio: gsum / sum, levels: gl.levels, weights: gl.weights, lobeIsAcc0: lob === t.texture };
  });
  checks.accumAlpha = Math.abs(e.amin - 1) < 1e-4 && Math.abs(e.amax - 1) < 1e-4;
  checks.glare = Math.abs(e.ratio - 1) < 0.03;
  checks.glareDetail = e;

  // glare mix weight of the last frame (default grade: amount 0.015, r0 0.002)
  const st = await S.page.evaluate(() => { const f = window.__AG_CTX.core.final; return { stats: f.stats, lobeFraction: f.glare.lobeFraction, core: f.glare.coreEnergy }; });
  checks.glareMix = Math.abs(st.stats.glareMix - 0.015 * st.lobeFraction) < 1e-6 && st.lobeFraction < 1;
  checks.glareMixDetail = { mix: st.stats.glareMix, lobeFraction: +st.lobeFraction.toFixed(4), coreEnergy: +st.core.toFixed(4) };

  // resolution independence, rendered: a 2x2 px source at the centre, the real pyramid at three output sizes
  const scale = await S.page.evaluate(async (sizes) => {
    const { VeilingGlare } = await import('/scene/src/core/glare.js');
    const ctx = window.__AG_CTX, THREE = ctx.THREE, r = ctx.renderer;
    const half = (x) => { const s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 31, m = x & 1023; return e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + m / 1024); };
    const res = [];
    for (const [W, H] of sizes) {
      const src = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      r.setRenderTarget(src); r.setClearColor(0x000000, 0); r.clear(true, false, false);
      // a bright source (1e4, like a sun glint): the pyramid levels are RGBA16F, and a dim 2x2 px source would average
      // to ~1e-7 at the coarse 4K levels, below half-float precision
      r.setScissorTest(true); r.setScissor(W / 2 - 1, H / 2 - 1, 2, 2); r.setClearColor(new THREE.Color(1e4, 1e4, 1e4), 1); r.clear(true, false, false); r.setScissorTest(false);
      r.setClearColor(0x000000, 0);
      const g = new VeilingGlare(r, W, H); g.setShape(0.002); g.render(src.texture);
      const t = g.acc[0], hw = t.width, hh = t.height, u = new Uint16Array(hw * hh * 4);
      r.readRenderTargetPixels(t, 0, 0, hw, hh, u);
      r.setRenderTarget(null);
      const radii = [0.0105, 0.042, 0.17]; const beyond = radii.map(() => 0); let total = 0;
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const v = half(u[(y * hw + x) * 4]); total += v;
        const d = Math.hypot((x + 0.5) * (W / hw) - W / 2, (y + 0.5) * (H / hh) - H / 2) / H;
        radii.forEach((R, i) => { if (d >= R) beyond[i] += v; });
      }
      const mixNew = g.mixWeight(0.015), mixOld = 0.015;   // the lobe image is the same; the old code mixed it with `amount`
      res.push({ W, H, levels: g.levels, mixNew, beyondNew: beyond.map((b) => (mixNew * b) / total), beyondOld: beyond.map((b) => (mixOld * b) / total) });
      g.dispose(); src.dispose();
    }
    return res;
  }, [[960, 540], [1920, 1080], [3840, 2160]]);
  const ratio = (k, i, j, ri) => scale[i][k][ri] / scale[j][k][ri];
  checks.glareScaleDetail = {
    sizes: scale.map((s) => `${s.W}x${s.H}: levels ${s.levels}, mix ${s.mixNew.toFixed(5)}, energy beyond 0.0105/0.042/0.17 H = ${s.beyondNew.map((b) => b.toExponential(3)).join(' / ')} (old code ${s.beyondOld.map((b) => b.toExponential(3)).join(' / ')})`),
    farHalo540over1080: { new: +ratio('beyondNew', 0, 1, 1).toFixed(3), old: +ratio('beyondOld', 0, 1, 1).toFixed(3) },
    farHalo1080over2160: { new: +ratio('beyondNew', 1, 2, 1).toFixed(3), old: +ratio('beyondOld', 1, 2, 1).toFixed(3) },
  };
  checks.glareScale = [1, 2].every((ri) => Math.abs(ratio('beyondNew', 0, 1, ri) - 1) < 0.05 && Math.abs(ratio('beyondNew', 1, 2, ri) - 1) < 0.05);

  await S.page.evaluate((u) => window.AG.setLUT(u), identUrl);
  const ident = await frame(300, { grade: { dither: 0 } });
  let maxd = 0, nd = 0; for (let i = 0; i < base.length; i++) { const d = Math.abs(base[i] - ident[i]); if (d) nd++; maxd = Math.max(maxd, d); }
  checks.lutIdent = maxd <= 1; checks.lutIdentDetail = { maxDiff: maxd, differingBytes: nd };
  await S.page.evaluate((u) => window.AG.setLUT(u), swapUrl);
  const sw = await frame(300, { grade: { dither: 0 } });
  let maxs = 0; for (let i = 0; i < base.length; i += 4) { maxs = Math.max(maxs, Math.abs(sw[i] - base[i + 2]), Math.abs(sw[i + 2] - base[i]), Math.abs(sw[i + 1] - base[i + 1])); }
  checks.lutSwap = maxs <= 2; checks.lutSwapDetail = { maxDiff: maxs };

  // context loss: lose and restore the context between frames; the next frame must fail instead of reading stale pixels
  const cl = await S.page.evaluate(async () => {
    const gl = window.__AG_CTX.renderer.getContext(), ext = gl.getExtension('WEBGL_lose_context');
    const lost = new Promise((r) => gl.canvas.addEventListener('webglcontextlost', r, { once: true }));
    ext.loseContext(); await lost;
    const restored = new Promise((r) => gl.canvas.addEventListener('webglcontextrestored', r, { once: true }));
    ext.restoreContext(); await Promise.race([restored, new Promise((r) => setTimeout(r, 3000))]);
    return { lostNow: gl.isContextLost() };
  });
  let clErr = null;
  try { await frame(301, { grade: { dither: 0 } }); } catch (err) { clErr = err.message; }
  checks.contextLoss = !!clErr && /context lost/i.test(clErr);
  checks.contextLossDetail = { restoredBeforeTheFrame: !cl.lostNow, error: clErr && clErr.split('\n')[0].slice(0, 300) };

  const d = await S.page.evaluate(() => window.AG.dispose());
  checks.dispose = d.disposed && d.errors.length === 0; checks.disposeDetail = d;
} finally { await S.close(); }
const ok = ['repeat', 'accumAlpha', 'glare', 'glareMix', 'glareScale', 'lutIdent', 'lutSwap', 'contextLoss', 'dispose'].every((k) => checks[k] === true);
fs.writeFileSync(path.join(dir, 'selftest.json'), JSON.stringify({ ok, checks }, null, 1));
console.log(JSON.stringify({ ok, ...checks }, null, 1));
process.exit(ok ? 0 : 1);
