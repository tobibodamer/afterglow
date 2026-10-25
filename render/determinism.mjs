// Determinism check: the same frames rendered in independent fresh browser sessions (and out of order) must be
// bit-identical (sha256 of the RGBA8 frame), and different frames must differ.
//   node render/determinism.mjs [--frames 240,241] [--size 1920x1080] [--N 16] [--opts '{"grade":{"grain":2}}'] [--camera cam.json]
// --preroll [K] renders frames f-K..f-1 (discarded, K = 1 by default) before every checked frame f, as render.mjs does at
// chunk starts.
// Session A renders the frames in order, session B in reverse order (after a different warm-up frame), session C
// renders only the last one. Writes build/determinism/determinism.json.
// N: by default the frames render at their own N (the shot's or the camera file's, e.g. 32 for a close-up; 16 when
// nothing sets one). --N overrides it for the whole run. The N actually used is printed and recorded per frame.
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './lib/session.mjs';
import { FrameAssembler } from './lib/frames.mjs';
import { parseArgs, parseSize, parseFrameList, readJsonArg, parseModules, sha256 } from './lib/util.mjs';

const a = parseArgs();
const [W, H] = parseSize(a.size, [1920, 1080]);
const frames = parseFrameList(a.frames || '240,241');
const init = { quality: a.quality || 'final', ...(a.N ? { N: +a.N } : {}), ...(readJsonArg(a.init) || {}) };
const modules = parseModules(a.modules, !!a.placeholders); if (modules) init.modules = modules;
const camera = readJsonArg(a.camera); if (camera) init.camera = camera;
const frameOpts = readJsonArg(a.opts) || { grade: { grain: 2.5 } };
const out = path.resolve(a.out || 'build/determinism');
fs.mkdirSync(out, { recursive: true });

const prerollK = a.preroll === true ? 1 : Math.max(0, Math.round(+(a.preroll || 0)));   // --preroll [K]
const usedN = {};
async function session(name, order, warmupFrame) {
  const S = await openSession({ width: W, height: H, init: { ...init, warmupFrame } });
  const hashes = {};
  try {
    for (const f of order) {
      const tag = `${name}_${f}`; let got = null;
      const asm = new FrameAssembler(async (buf) => { got = buf; }, { start: f, frameBytes: W * H * 4, tag });
      S.setFrameHandler((i, tg, buf, q) => asm.onFrame(i, tg, buf, q));
      // --preroll: render f-1 first (discarded), as render.mjs does at a chunk start (the scene has one-frame memory)
      for (let q = Math.max(0, f - prerollK); q < f; q++) await S.renderFrame(q, { ...frameOpts, transfer: 'none' });
      const r = await S.renderFrame(f, { ...frameOpts, transfer: 'post4', tag });
      hashes[f] = sha256(got);
      (usedN[f] ||= new Set()).add(r.N);
      console.log(`[det] session ${name} frame ${f}: ${hashes[f].slice(0, 16)}  (${r.timings.total.toFixed(0)} ms, N=${r.N}${init.N ? ' from --N' : ''}, shot ${r.shot})`);
    }
  } finally { await S.close(); }
  return hashes;
}

const A = await session('A', frames, 0);
const B = await session('B', [...frames].reverse(), 7);
const C = await session('C', [frames[frames.length - 1]], 3);
const res = {
  command: process.argv.slice(1).join(' '), preroll: prerollK, width: W, height: H, frames, init, frameOpts,
  N: Object.fromEntries(Object.entries(usedN).map(([f, s]) => [f, [...s]])), sessions: { A, B, C },
  identicalAcrossSessions: frames.every((f) => A[f] === B[f]) && A[frames[frames.length - 1]] === C[frames[frames.length - 1]],
  framesDiffer: frames.length < 2 || new Set(frames.map((f) => A[f])).size === frames.length,
};
res.ok = res.identicalAcrossSessions && res.framesDiffer;
fs.writeFileSync(path.join(out, 'determinism.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ identicalAcrossSessions: res.identicalAcrossSessions, framesDiffer: res.framesDiffer, ok: res.ok }));
process.exit(res.ok ? 0 : 1);
