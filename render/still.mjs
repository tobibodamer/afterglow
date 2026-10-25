// Render specific frames (or film times) to PNG.
//   node render/still.mjs --frames 0,600 --size 960x540 --N 4 --out build/stills/test [--camera cam.json]
// Options:
//   --frames 0,600,1200 | 0-600:100      output frame indices (t = frame / 60)
//   --times 10.5,62                      film times in seconds (rounded to the nearest frame)
//   --size 960x540 | 1080p               --N 16    --quality preview|final (default: preview if --size <= 960 wide)
//   --camera cam.json | '{...}'          camera override {pos, target, focalMm, focusDist, fStop, N, preblur, ...}
//   --modules auto|placeholders|world=placeholder,piano=real     --placeholders (= --modules placeholders)
//   --opts '{json}'                      extra AG.renderFrame options (grade, debugView, shutter, preblur, ...)
//   --init '{json}'                      extra AG.init options (data, lut, ...)
//   --grade name|'{json}'  --lut file.cube  --debug coc|depth|hdr|glare|alpha   --tag suffix   --verbose
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './lib/session.mjs';
import { FrameAssembler, rgbaToPng } from './lib/frames.mjs';
import { parseArgs, parseSize, parseFrameList, readJsonArg, parseModules, sha256, pad, fmtMs } from './lib/util.mjs';
import { FPS } from '../scene/src/core/constants.js';

const a = parseArgs();
const [W, H] = parseSize(a.size, [960, 540]);
let frames = a.frames !== undefined ? parseFrameList(a.frames) : [];
if (a.times !== undefined) frames.push(...String(a.times).split(',').map((s) => Math.round(+s * FPS)));
if (!frames.length) frames = [0];
const out = path.resolve(a.out || 'build/stills/test');
fs.mkdirSync(out, { recursive: true });

const init = { quality: a.quality || (W <= 960 ? 'preview' : 'final'), ...(readJsonArg(a.init) || {}) };
const modules = parseModules(a.modules, !!a.placeholders); if (modules) init.modules = modules;
const camera = readJsonArg(a.camera); if (camera) init.camera = camera;
if (a.N) init.N = +a.N;
if (a.lut) init.lut = '/' + path.relative(path.resolve(import.meta.dirname, '..'), path.resolve(a.lut)).replace(/\\/g, '/');
if (a.grade) init.grade = String(a.grade).trim().startsWith('{') ? JSON.parse(a.grade) : a.grade;
const frameOpts = { ...(readJsonArg(a.opts) || {}) };
if (a.debug) frameOpts.debugView = a.debug;

const t0 = Date.now();
const S = await openSession({ width: W, height: H, init, verbose: !!a.verbose });
console.log(`[still] ${W}x${H} gpu="${S.info.gpu.renderer}" modules=${S.info.modules.map((m) => `${m.slot}:${m.kind}`).join(',')} camera=${S.info.cameraSource} init=${fmtMs(S.info.initTimings.init)}`);
const got = new Map();
const results = [];
try {
  for (const f of frames) {
    const tag = `still${a.tag ? '_' + a.tag : ''}_${f}`;
    const asm = new FrameAssembler(async (buf) => { got.set(tag, buf); }, { start: f, frameBytes: W * H * 4, tag });
    S.setFrameHandler((i, tg, buf, q) => asm.onFrame(i, tg, buf, q));
    const r = await S.renderFrame(f, { ...frameOpts, transfer: 'post4', tag });
    const buf = got.get(tag); got.delete(tag);
    if (!buf) throw new Error(`frame ${f}: no pixels received`);
    const file = path.join(out, `f${pad(f)}${a.tag ? '_' + a.tag : ''}.png`);
    await rgbaToPng(buf, W, H, file);
    const res = { frame: f, t: r.t, shot: r.shot, N: r.N, file: path.relative(process.cwd(), file), rgbaSha256: sha256(buf), timings: r.timings, perSubMs: +r.perSubMs.toFixed(2), lens: r.lens, camera: r.camera, sun: r.sun, preblur: r.preblur };
    results.push(res);
    console.log(`[still] f${f} t=${r.t.toFixed(3)} shot=${r.shot} N=${r.N} total=${r.timings.total.toFixed(0)} ms (sub ${res.perSubMs} ms x ${r.N}) -> ${res.file}`);
  }
} finally {
  await S.close();
}
fs.writeFileSync(path.join(out, `stills${a.tag ? '_' + a.tag : ''}.json`), JSON.stringify({ command: process.argv.slice(1).join(' '), width: W, height: H, init, frameOpts, info: S.info, results, wallMs: Date.now() - t0 }, null, 1));
