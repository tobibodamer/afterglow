# Rendering: how to run it, and how modules plug in

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

This document covers the production render core: `scene/index.html`, `scene/src/main.js`, `scene/src/core/**` and the
Node driver in `render/`. The architecture contract is in `docs/DESIGN.md`. The measurements behind each choice are
in `research/rendering.md`.

```
render/*.mjs (Node) --puppeteer-core--> headless Chrome 155 (ANGLE D3D11, Radeon 780M) --> /scene/index.html (window.AG)
  per output frame f, t = f/60:
    shot + settings -> rig yaw, sun -> camera at frame centre -> module.beforeFrame -> module.update(t, centre)
    -> sky bakes -> module bakes -> env captures
    -> N sub-frames: t_k, camera(t_k), module.update(t_k, sub), thin lens + jitter, pre-subframe hooks,
                     render -> RGBA16F -> [DOF gap-fill pre-blur] -> += 1/N into RGBA32F
    -> final pass: exposure -> veiling glare -> PBR Neutral -> saturation -> sRGB -> lift/gamma/gain -> 3D LUT
                   -> grain -> TPDF dither -> RGBA8 (rows top-down)
    -> readPixels -> 4 parallel Blob POSTs (pipelined, gc()) -> Node FrameAssembler -> ffmpeg FFV1 chunk
```

## 1. Running it

All commands run from the repository root. `npm install` installs three 0.186.1 and puppeteer-core 25.15.0. Chrome is
expected at `C:\Program Files\Google\Chrome\Application\chrome.exe`; set `AG_CHROME` to override.

Every run checks the WebGL renderer string and **fails if it is not the Radeon 780M**. It also fails on SwiftShader,
llvmpipe or any other software rasterizer, and the browser is launched with `--disable-software-rasterizer`. On
another machine, set `AG_GPU_EXPECT=<regex>`, or `AG_GPU_ANY=1` to accept any hardware GPU.

Modules: by default (`auto`), every slot uses the real module when its file exists (`scene/src/world/index.js`,
`scene/src/piano/index.js`, `scene/src/pianist/index.js`) and the built-in placeholder otherwise. Pass `--placeholders`
for a run that does not depend on work in progress.

### Self test (about 10-40 s)
```
node render/selftest.mjs            # accumulation alpha == 1, glare energy + resolution independence, LUT axis order,
                                    # repeatability, context loss fails the frame, AG.dispose(), GPU
```

### Stills
```
node render/still.mjs --frames 0,600 --size 960x540 --N 4 --out build/stills/test
node render/still.mjs --times 62.5 --size 1080p --N 16 --camera build/cams/hands.json --out build/stills/hands
node render/still.mjs --frames 0-1200:300 --placeholders --debug coc --out build/stills/coc
```
| option | meaning |
|---|---|
| `--frames 0,600` or `0-600:100` | output frames (t = frame / 60) |
| `--times 10.5,62` | film seconds, rounded to the nearest frame |
| `--size 960x540`, `1080p`, `2160p` | output size. `--quality preview\|final`; the default is preview at 960 px wide or less |
| `--N 16` | sub-frames per frame. This overrides the shot's N. Preview quality defaults to 4 |
| `--camera cam.json` or inline `'{...}'` | camera override (section 5) |
| `--modules auto\|placeholders\|world=placeholder,piano=real` | module policy (section 3); `--placeholders` is a shorthand |
| `--opts '{json}'` | extra `AG.renderFrame` options, e.g. `{"grade":{"grain":2.5},"preblur":1.2}` |
| `--init '{json}'` | extra `AG.init` options, e.g. `{"data":{...},"moduleOptions":{"world":{...}}}` |
| `--grade name\|'{json}'`, `--lut file.cube`, `--debug coc\|depth\|hdr\|glare\|alpha\|nolut`, `--tag x` | |

Output: `<out>/f<frame>[_tag].png` (RGB, 8 bit) plus `<out>/stills.json`. The JSON records the command, the page
info, per-frame timings, the lens and camera, and the sha256 of the raw RGBA.

### Chunked film render (resumable)
```
node render/render.mjs --from 0 --to 13500 --chunk 300 --size 1920x1080 --out build/chunks/film
```
- Output per chunk: `chunk_<a>_<b>.mkv` (FFV1 level 3, intra, 16 slices, slice CRC, bgr0) and
  `chunk_<a>_<b>.manifest.json`. The manifest records `range`, `timeRange`, `settings`, `settingsHash`,
  `git {hash, dirty}`, `sceneHash` (content hash of `scene/`), `inputs` (path -> content hash of **every file the page
  loaded**: code, shots.js, data such as score.json and perf.bin, assets) and `inputsHash`, `nb_frames` (ffprobe packet
  count), `bytes`, `sha256`, the GPU, Chrome, the modules (real or placeholder, with URLs), `cameraSource` and
  `cameraModule`, the shots, the N values used and the timings. A file that changed while it was being rendered is
  recorded as `changed:<hash>`.
- Frames are encoded into `.partial.mkv`. The file is renamed only after ffprobe counts exactly `b - a` frames.
- **Restart = run the same command again.** A chunk is skipped when its manifest says `complete`, the .mkv exists
  with the recorded size, `nb_frames == b - a` and the settings hash matches. Anything else is re-rendered.
  - A skipped chunk whose recorded `inputs` no longer match the files on disk is reported as stale (WARNING line).
  - `--verify` re-hashes complete chunks before it skips them.
  - `--rerender-stale` also re-renders the stale chunks (for manifests older than `inputs`: a different `sceneHash`).
  - `--force` re-renders everything.
- Any `--chunk` length works. Matroska stores millisecond timestamps, so a chunk that is not a multiple of 3 frames has
  a rounded container duration; encode.mjs does not use those timestamps (see Deliverables). The default is 300.
- One browser session renders all chunks. A failed chunk is retried from its first frame in a fresh session
  (`--retries 2`). A chunk fails at once, and is never written as complete, when:
  - the WebGL context is lost (GPU process crash, driver reset). The page listens for `webglcontextlost`, checks
    `gl.isContextLost()` at the start and end of every frame, and the readback writes a sentinel into the alpha bytes
    before every `readPixels` and checks that it was overwritten (a lost context makes `readPixels` a silent no-op).
    A loss is sticky: the session stays invalid even after Chrome restores the context;
  - the FFV1 ffmpeg child dies (crash, disk full, killed): every pending and later frame write rejects at once, the
    frame POST answers 500, and the driver stops;
  - the page crashes or the browser disconnects;
  - a frame upload gets no answer for 180 s (each slice POST has a timeout; the protocol timeout of 30 min is only the
    last resort).
- Other options are the same as for `still.mjs`: `--N`, `--camera`, `--modules`, `--placeholders`, `--opts`, `--init`,
  `--quality`.

### Deliverables
```
node render/encode.mjs --chunks build/chunks/film --audio build/audio/afterglow.wav --out build/out/afterglow_1080p60.mp4 [--archive prores,x265] [--master]
```
- **Provenance.** Before encoding, the chunk manifests are compared: `settingsHash`, the modules (slot, kind, URL),
  `cameraSource`, `cameraModule` and the content hash of every input file. Chunks that disagree on any of these (for
  example a resumed render after shots.js or a real module appeared, or after perf.bin was re-solved) would splice two
  different films, so encode.mjs **refuses** them (exit 2) and names the differing inputs. Re-render the stale chunks
  (`render.mjs --rerender-stale` or `--force`), or pass `--allow-mixed` to encode anyway (the report records it).
  An input that changed while a chunk was rendering also fails. For manifests older than `inputs`, a differing
  `sceneHash` fails. GPU, Chrome and three versions are compared as warnings.
- Video: concat demuxer over the chunks, then H.264 High, CRF 14 (`--crf`), `-preset slow` (`--preset`), yuv420p, CFR 60.
  - Timestamps: the concat list states each chunk's exact duration, and the filter chain starts with
    `setpts=N/(60*TB)`, so every output frame is exactly one rendered frame whatever the chunk lengths (Matroska's
    millisecond timestamps would otherwise add up over the concat, and `-fps_mode cfr` would duplicate frames).
  - BT.709 conversion and tags: `-vf scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`.
  - `+faststart` is set.
- Audio: the WAV is placed at film time `MUSIC_OFFSET` (4.0 s, from `scene/src/core/constants.js`; override with
  `--offset`). **The film soundtrack `build/audio/afterglow_film.wav` already carries the 4.0 s lead-in**, so it needs
  `--offset 0` (`render/film.mjs encode` does that; the default 4.0 is for the plain `afterglow.wav`).
  - It is delayed or trimmed sample-exactly for the encoded range: `--from/--to` must lie on chunk boundaries.
  - It is padded or trimmed to exactly the video duration, then encoded as AAC 320k.
- `--archive prores` writes ProRes 422 HQ 10-bit (.mov, PCM 24-bit). ffmpeg's mov muxer writes a QuickTime `nclc`
  colour atom, which has no range field, so `render/lib/mov.mjs` rewrites it in place as `nclx` with
  `full_range = 0` (ffprobe then reports `color_range=tv`). `--archive x265` writes x265 10-bit CRF 12 (.mkv, FLAC).
  `--master` writes the lossless FFV1 concat (stream copy).
- Verification runs by default (`--no-verify` skips it) and writes `<out>.verify.json`. For every output it checks:
  - 60/1 frame rate and the frame count; the pixel format; bt709 primaries, transfer and matrix with tv range.
  - **Frame identity** (`frameIdentity`): every output frame is compared with its own source frame and with both
    neighbours (PSNR, frames paired by index). Each output frame must match its own source frame better than either
    neighbour, wherever the neighbour differs from it by more than the encoding error. A dropped, duplicated or
    shifted frame fails this on every moving frame after it. `testable` counts the frames where the test was decisive
    (a static shot has few).
  - **Compression quality** (`pictureQuality`): PSNR of the output against the uncompressed deliverable conversion of
    the source (the same BT.709 swscale call into yuv420p / 10-bit), so it measures the encoder's loss only, not the
    4:2:0 chroma loss of the format (which alone is 39.7 dB in RGB on 320x180 aliased test frames and 43 dB on the
    film). Thresholds: H.264 average > 42, 1st percentile > 38, minimum > 30 dB (ProRes 48/45/40, x265 43/39/32). The
    minimum is a loose bound: a single B-frame can dip far below its neighbours in a correct encode.
  - For the main MP4, over the first 120 frames: decoded to RGB with BT.709 it must match the RGB source (> 34 dB,
    `rgbMatchesSource`; this catches a wrong range or matrix in the conversion itself), and decoded with the wrong
    BT.601 matrix it must be clearly worse (`matrixIsBt709`, at least 3 dB).
  - Audio: the expected signal is the WAV segment that should play over the encoded range. Its onset (first sample
    above 25% of that segment's own peak) must match the MP4's onset (25% of the MP4 segment's peak) to within 2 ms,
    and the cross-correlation lag must be under 2 ms with correlation > 0.9 in a window around the onset and, where
    the expected signal is not silent there, around the loudest part of the last third. The duration must match.

### Determinism check
```
node render/determinism.mjs --placeholders [--frames 240,241] [--size 1920x1080] [--N 16] [--camera cam.json]
```
Session A renders the frames in order. Session B renders them in reverse after a different warm-up frame. Session C
renders only the last frame. The check requires bit-identical sha256 across sessions and different hashes for
different frames. The default options enable grain, so the hashed noise is covered too. Frames render at their own N
(the shot's or the camera file's, e.g. 32 for `build/cams/keys_closeup.json`; 16 when nothing sets one) unless `--N`
is given; the N used is printed per frame and recorded in `determinism.json`.

### Interactive preview
```
node render/serve.mjs     # then open http://127.0.0.1:8137/scene/index.html?preview&frame=600&N=4&w=960&h=540[&placeholders][&debug=coc]
```

## 2. Page API (`window.AG`, DESIGN.md section 5)

| call | what it does |
|---|---|
| `await AG.init(opts)` | Builds the renderer, loads data, the camera source and the modules, compiles, and renders warm-up frame 0 at N=1. Returns `AG.info()`. |
| `await AG.renderFrame(frame, opts)` | Draws the graded RGBA8 frame into the output target and returns `{frame, t, m, shot, N, timings, perSubMs, lens, camera, sun, preblur, ...}`. |
| `AG.readPixels()` | Reads back the output target. Returns a `Uint8Array` with top-down RGBA rows. |
| `AG.info()` | `{width, height, quality, gpu, three, modules, cameraModule, cameraSource, hooks, data, initTimings, uploads, uploadRetries, contextLost: {lost, restored, firstFrame}, last, shot, t, m, timings}`. |
| `await AG.renderStill(frame, opts)` | `renderFrame` plus readback. `{dataURL: true}` also returns a PNG data URL. |
| `await AG.flush()` | Waits for the in-flight pipelined upload. Throws if the WebGL context was lost at any point in the session. |
| `AG.dispose()` | Calls every module's `dispose()` (reverse creation order), then frees the core targets and the renderer. Returns `{disposed, errors}`. Render sessions end by closing the browser; the self test calls it. |

`renderFrame`, `readPixels` and `flush` throw once the WebGL context has been lost (section 1, chunked render), so a
driver can never read the previous frame's pixels as the current one.
| `AG.present()` | Draws the last output frame to the canvas (interactive use only). |
| `AG.setCamera(o)`, `await AG.setLUT(src)`, `AG.setGrade(g)` | Session camera override, session LUT (`'film'`, `'identity'`/null, URL, .cube text, Float32 table; `AG.info().lut` names the one in use; the per-class wide LUT only rides on `'film'`), session grade. |
| `await AG.regrade({ debugView, lut, grade, transfer, tag })` | Checks only: runs the final pass again on the LAST frame's accumulation with another look (e.g. `debugView: 'nolut'` = the ungraded frame the LUT fit uses) and outputs it like `renderFrame`. `session.regrade(opts)` in render/lib/session.mjs; `check.mjs --nolut` saves `<still>_nolut.png` this way. |

`init` options:
- `width`, `height`, `quality` (`'preview'|'final'`).
- `modules` (section 3) and `cameraModule` (`'auto'|'off'|url`).
- `camera` (override, section 5).
- `data` (`{key: url | {url, type, optional}}`, merged over the defaults `score`, `perfMeta` and `perf`, which are
  optional).
- `lut` (URL, .cube text or a Float32 table; omitted = the film LUT, `'identity'`/`null`/`false` = none), `grade` (preset name or object), `moduleOptions` (becomes `ctx.options`).
- Any per-shot setting (`N`, `shutter`, `preblur`, `nearestDist`, ...). A setting given here overrides the shot list
  for the whole session.
- `shadows`, `warmup`, `warmupFrame`.

`renderFrame` options:
- Any per-shot setting, plus `grade` and `debugView`.
- `camera`: an override for this frame only, or `null` to ignore the session override.
- `transfer`: `'none'` (default), `'read'`, `'post4'` (upload and wait), `'post4async'` (pipelined, used by
  `render.mjs`) or `'post'` (a single slice).
- `tag`: the upload tag that the Node assembler checks.
- `sync: false` skips the GPU sync used for the timing split.

Timing fields in milliseconds:
- `prep`, `skyBake`, `bakes`, `envCapture`.
- `subframes`: GPU-inclusive, because the page syncs after the loop.
- `final`: CPU submission only. Its GPU time shows up in `read`.
- `uploadWait`, `upload`, `total`.

## 3. Modules

The module slots are configured at the top of `scene/src/main.js` (`MODULE_SLOTS`) and load in this order:

| slot | real module | placeholder (built in) | `group` is added to |
|---|---|---|---|
| `world` | `scene/src/world/index.js` | `core/placeholders/world.js`: baked gradient sky cube, PMREM env, Reflector water with capillary rings, mountain ring, jittered sun | `worldGroup` |
| `piano` | `scene/src/piano/index.js` | `core/placeholders/piano.js`: black clearcoat box with legs, keys and lid | `rigGroup` |
| `pianist` | `scene/src/pianist/index.js` | `core/placeholders/pianist.js`: dark capsule figure with fast-moving hands (motion-blur test) | `rigGroup` |
| `camera` | `scene/src/camera/index.js` | none (skipped when missing or under `'placeholders'`) | no group: pins the world's sun to the edit's arc, rig-yaw check, diagnostics |
| `integration` | `scene/src/integration/index.js` | none (skipped likewise) | no group: rig wiring checks, per-shot module looks, `AG.probe` (docs/INTEGRATION.md) |

The camera source is `scene/src/camera/shots.js` (section 5) when that file exists. Otherwise the camera comes from
the override or the default.

Module policy (`AG.init({modules})`, CLI `--modules`):
- `'auto'` is the default: the real module when its file exists, the placeholder otherwise.
- `'placeholders'` loads every placeholder.
- An object such as `{ world: 'auto'|'real'|'placeholder'|'off'|'<url>', default: 'auto', extra: ['./world/mist.js'] }`
  sets each slot. Relative URLs resolve against `scene/src/main.js`; `extra` modules load after the slots, into
  `worldGroup` unless the module returns `parent: 'rig'`.
- From the CLI: `--modules world=placeholder,piano=./piano/index.js` or `--modules '{"extra":["./world/mist.js"]}'`.

### Module interface

A module is an ES module that exports `async create(ctx)`. It returns:
```
{ group?, parent?: 'world'|'rig', update(t, sub), beforeFrame?(frame, t, info), bakes?, dispose? }
```

```js
// scene/src/core/examples/example-module.js : a minimal module (this is a runnable copy, abridged here)
export async function create(ctx) {
  const { THREE } = ctx;
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.3, clearcoat: 1 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 64, 32), mat);
  const group = new THREE.Group(); group.add(ball);
  const light = new THREE.PointLight(0xffc090, 0.6, 6, 2); group.add(light);

  // per sub-frame, after the camera is posed: jitter the light across a 10 cm disk (soft shadows / highlights).
  // dims (0, 1) are one stratified 2-D pair, so (sqrt(u), 2 pi v) covers the disk evenly at every N
  ctx.registerPreSubframe((sub) => {
    const r = 0.05 * Math.sqrt(sub.dim(0)), a = 2 * Math.PI * sub.dim(1);
    light.position.set(0.9 + r * Math.cos(a), 1.6, 1.4 + r * Math.sin(a));
  });

  return {
    group, parent: 'rig',                                  // rig frame (yaw applied); 'world' for world-fixed things
    beforeFrame(frame, t, info) { /* per output frame: look up tracks at t, react to info.shotChanged ... */ },
    update(t, sub) { ball.position.set(0.9, 1.25 + 0.05 * Math.sin(2 * Math.PI * 0.5 * t), 1.2); },   // pure f(t)
    bakes: [{ name: 'once', when: 'init', run: (info) => { /* one-time precompute */ } }],
    dispose() { ball.geometry.dispose(); mat.dispose(); },
  };
}
// try it:  node render/still.mjs --modules '{"default":"placeholder","extra":["./core/examples/example-module.js"]}' --frames 0 --out build/stills/example
```

Lifecycle in each output frame. The full sequence is in the header of `main.js`.
1. The rig yaw and `ctx.sun` are set. The camera is posed at the frame centre, without aperture offset or jitter;
   `ctx.subframe` is the centre sub (`k = -1`).
2. `beforeFrame(frame, t, info)` runs for every module, in slot order.
3. `update(t, centreSub)` runs for every module, so that bakes and captures see the frame-centre pose.
4. The `registerSkyBake` functions run, then the module `bakes` with `when: 'shot'` (when the shot changed) and
   `'frame'`, then the `registerEnvCapture` functions.
5. For each of the N sub-frames:
   - The camera is posed at t_k.
   - `update(t_k, sub)` runs for every module.
   - The thin-lens offset, the shear and the pixel jitter are applied.
   - The `registerPreSubframe` functions run.
   - The scene is rendered and accumulated.
6. The final pass runs.

`bakes` is either an array `[{name, when: 'init'|'shot'|'frame', run(info)}]` or an object `{init, shot, frame}` of
functions. `'init'` bakes run once, after every module has been created. They get the same `info` shape as the other
hooks plus `when: 'init'`; there is no frame yet, so `frame`, `t`, `m` and `shot` are `null` and `shotChanged` is
`false` (`settings` holds the session defaults). A `'shot'` bake must depend only on the shot (use `info.shot.t0`),
because a chunk can start in the middle of a shot.

`dispose()` is optional. `AG.dispose()` calls it for every module in reverse creation order. A render session normally
ends by closing the browser, so do not rely on `dispose()` for anything but freeing GPU resources.

Rules every module must follow (BRIEF and DESIGN section 3):
- Everything that reaches a pixel is a pure function of `t` (and of `sub.k`, `sub.seed` or `frame` for noise).
- Do not use `Math.random`, `Date`, `performance.now` or `requestAnimationFrame` in anything that draws. Timing
  statistics are the only exception.
- Use the integer hashes in `ctx.core.rng` and `ctx.core.glsl`.
- Do not keep state from one frame to the next that changes the image. Frames are rendered out of order and in
  separate sessions.
- `renderer.autoClear` is `true`, three's default, everywhere except the accumulation quad, which switches it off
  locally. Code that renders cube maps or targets of its own can rely on the normal three behaviour. Restore any
  renderer state you change.
- Size your render targets from `ctx.width` and `ctx.height`, and check `ctx.quality === 'preview'` to cut costs.

### `ctx` reference

| field | meaning |
|---|---|
| `THREE`, `renderer`, `scene`, `camera` | three r186 namespace, the WebGLRenderer, the scene, the PerspectiveCamera (36 mm film gauge) |
| `worldGroup`, `rigGroup` | world-fixed root; rig root with `rotation.y = (120 + rigYawCheatDeg)` deg applied per frame |
| `sun` | `{ azimuthDeg: 0, elevationDeg, dir: Vector3 (unit, toward the sun), keys }`. Updated per output frame: elevation follows `keys` (default arc in constants.js), or the shot's `sunElevationDeg` |
| `settings` | resolved settings for the current frame: `width, height, aspect, quality, N, shutter, preblur, nearestDist, maxPreblurPx, aaFilter, blades, debugView, rigYawCheatDeg, sunElevationDeg, grade, gradePreset` |
| `width`, `height`, `quality`, `options` | session constants (aliases of `settings.*`). `options = AG.init({moduleOptions})` |
| `data` | `{ score, perfMeta, perf, ... }`: parsed JSON, ArrayBuffer or `null` when an optional file is missing |
| `loadData(url, {type, optional})` | cached loader (`json` / `text` / `binary` by extension) |
| `frame`, `t`, `m`, `shot` | current output frame, film time, music time (`t - 4.0`), shot `{id, t0, t1, settings, raw}` |
| `subframe` | the current sub (below) |
| `modules` | `{ world, piano, pianist, ... }`: instances created so far (create order = slot order) |
| `FPS`, `MUSIC_OFFSET`, `time` | 60, 4.0, `{frameToTime, timeToFrame, filmToMusic, musicToFilm}` |
| `registerSkyBake(fn)` | `fn(info)` once per output frame, before sub-frames, with the frame-centre camera; bake sky and clouds into a cube or equirect here |
| `registerEnvCapture(fn)` | `fn(info)` after the sky bakes and module bakes (e.g. a lacquer env cube at the piano, pianist hidden). Set `scene.environment` here |
| `registerPreSubframe(fn)` | `fn(sub)` every sub-frame, after the camera, lens and jitter are applied, just before the render |
| `registerGradePreset(name, params)` | add a grade preset that shots can name |
| `core` | `{ CubeProbe, withAutoClear, lens, rng, glsl, sun, accum, final }`: helpers. `CubeProbe` is a re-capturable cube with optional PMREM; `glsl` has `GLSL_PCG`, `GLSL_HASHED_ALPHA`, `GLSL_SRGB` |

`info`, passed to `beforeFrame` and the hooks, is `{ frame, t, m, shot, shotChanged, settings, sun, ctx }`.

`sub`, passed to `update` and the pre-subframe hooks, has these fields:
- `k`: index in `0..N-1`, or `-1` for the frame-centre pose. `N`, `frame`.
- `time` (t_k), `frameT` (t), `centre`, `camera`.
- `shutterPos`: in [0, 1).
- `jitter: {x, y}`: in pixels.
- `lens: {x, y, dx, dy, radius, focalMm, fStop, focusDist}`: the aperture sample on the unit 9-blade disk, the eye
  offset in metres, and the lens.
- `seed`: a uint32 hash of (frame, k), e.g. for hashed alpha.
- `dim(i)`: extra stratified [0, 1) sample dimensions for jittered shadow lights or glossy normals. They come in 2-D
  pairs (0,1), (2,3), (4,5), (6,7): use one pair per 2-D decision, e.g. a point on a light's disk
  `r = sqrt(dim(0))`, `angle = 2 pi dim(1)`. Each dim has exactly one value per 1/N stratum over the N sub-frames, and
  each pair is a 2-D correlated multi-jittered pattern, so the pair covers the square (and the disk) at every N,
  including N = 4. Dims 0-7 are paired with the sub-frames so that they are decorrelated from time, aperture, jitter
  and each other as far as N allows: at N = 16 the largest |corr| against time is 0.10 and dim 0 vs dim 1 is 0.006
  (0.06 and 0.02 at N = 32). At N = 4 (preview) four points cannot be decorrelated from everything: dim 0 vs dim 1
  is 0.03, but some dims correlate with time by up to 0.66. Dims 8 and up are stratified pairs with an unoptimised
  (hashed) pairing. The frame-centre sub (`k = -1`) gives 0.5.

Sub-frame sample tables (`core/rng.js`, `subframeTable(N)`): one fixed table per N, identical for every frame and
session. Shutter times are the N stratum centres `(k + 0.5) / N` (centred on the frame, no lag against the audio).
Jitter, aperture and each module-dim pair are 2-D CMJ point sets (the aperture mapped to the 9-blade polygon with the
concentric map), each chosen from a fixed list of seeds for its own spread. Which point goes with which sub-frame is
then chosen by a deterministic local search that minimises the cross-correlations, weighted by visibility (time x
aperture first, including the odd-in-time terms that make left and right motion blur differ). Without it, late
shutter times went with right-hand aperture samples at N = 16 (corr 0.66), and a defocused object moving right was
blurred about twice as much as the same object moving left. Building a table takes 0.1-0.6 s at N = 4-64 (once per N
per session; 2.5 s at N = 128).

## 4. Per-shot settings

These can be set in a shot (shots.js), in a camera override, per session (`AG.init` or CLI) or per frame
(`renderFrame`). Precedence: defaults < shot < session < frame.

| key | default | meaning |
|---|---|---|
| `N` | 16 (preview: 4) | Sub-frames per output frame. Each has its own pixel jitter, shutter time and aperture sample. In preview quality the shot's N is ignored. In final quality, when neither the session nor the frame sets N, the **motion N boost** table `scene/src/integration/motion_n.json` raises N on the frames where a fast hand's motion-blur copies would sit > 1 px apart (next multiple of 16, max 128; `renderFrame` returns `nBoost: {from, to}`); `AG.init({ motionBoost: false })` disables it. |
| `shutter` | 0.5 | Fraction of the frame interval. 0.5 = 180 deg = 1/120 s, centred on t, so there is no lag against the audio. |
| `preblur` | 0 | DOF gap-fill pre-blur: each sub-frame is blurred by a Gaussian of sigma `0.5 * preblur * CoC / sqrt N` (CoC = blur-circle diameter in px; truncated at 2.5 sigma) before accumulation. N aperture samples on the CoC disk lie ~`0.886 CoC / sqrt N` apart, so preblur 1 fuses the N copies of a defocused point or thin highlight into one disk (ripple < 1 %); in-focus pixels are not blurred. 1.0-1.2 for shallow focus. Until 2026-10-22 this was a flat disk of radius `preblur * CoC / (2 sqrt N)` (half the sigma), which left thin out-of-focus highlights as rows of beads at N=32 (S11). |
| `preblurKernel` | `layered` | Since fix round 4: dense base layer (behind focus; each pixel a tap with its own normalised Gaussian) + near-field sigma levels 2-32 px, so content in front of focus is blurred by its own sigma wherever it lands (docs/INTEGRATION.md 8.3). `gauss` (round 3) and `disk` (before 2026-10-22) are kept for A/B checks only. |
| `nearestDist` | 0.6 x focusDist | Nearest visible depth in the shot (m). Bounds the pre-blur reach (2.5 sigma at that depth; 'layered' needs near levels up to 1.5x that sigma). |
| `maxPreblurPx` | 96 | Cap on the pre-blur reach (px, 2.5 sigma; was 32 before fix round 4). |
| `aaFilter`, `aaSigma` | `box`, 0.42 | Pixel reconstruction filter for the jitter: box over the pixel, or Gaussian (sigma in px). |
| `blades`, `bladeRotation` | 9, 0.3 | Aperture polygon. |
| `rigYawCheatDeg` | 0 | Added to the 120 deg rig yaw for this shot. The world never rotates. |
| `sunElevationDeg` | null | Overrides the film's sun arc. |
| `grade` | `'default'` | Preset name, or an object merged over the preset (section 6). |
| `debugView` | `none` | `hdr` (no tone map, clamped), `glare` (lobe x10), `depth` (log), `coc` (CoC/32 px in red; blue = in front of focus), `alpha` (white = accumulation weights sum to 1), `nolut`. |

Recommended values (research/rendering.md section 8):

| shot | N | shutter | lens | preblur |
|---|---|---|---|---|
| wide / establishing | 16 | 0.5 | 24-35 mm, f/4-f/8 | 0 |
| medium | 16 | 0.5 | 50 mm, f/2.8 | 0 |
| hand / key close-up | 32 | 0.5 | 85-100 mm, f/2-f/2.8 | 1.0-1.2, `nearestDist` set |
| top-down | 16 | 0.5 | 35-50 mm | 0 |

Keep defocused foreground objects farther than about 0.5 x focusDist, or raise `maxPreblurPx`.

## 5. Camera

The camera state is
`{ pos, target, up, rollDeg, focalMm | fovDeg (vertical) | hfovDeg, focusDist, fStop, near, far, space }`.
- `posRig` and `targetRig` give coordinates in the rig frame; `space: 'rig'` makes `pos` and `target` rig-relative.
- `focusDist` defaults to |target - pos|. `fStop <= 0` turns DOF off.
- `near` is 0.05 and `far` is 60000 by default. Lower `near` for macro shots.
- Focal lengths are on a 36 mm wide sensor (three's `filmGauge` = 36 on the long side).

Sources, highest priority first:
1. **Override**: `AG.init({camera})`, `AG.renderFrame(f, {camera})`, or the CLI `--camera cam.json`.
   - Either a single state, or `{keys: [{t, ...state}], easing}`, with optional shot settings beside it.
   - Example:
     ```json
     { "id": "keys_closeup", "posRig": [-0.95, 0.9, -0.12], "targetRig": [0.18, 0.74, 0.06], "focalMm": 85, "fStop": 2.0,
       "N": 32, "preblur": 1.2, "nearestDist": 0.5 }
     ```
2. **`scene/src/camera/shots.js`**, which exports any of:
   - `cameraAt(t, shotRaw) -> state`.
   - `shotAt(t) -> shot`.
   - `SHOTS = [{id, t0, t1, ref, rigYawCheatDeg, camera: [{t, pos|posRig, target|targetRig, focalMm|fovDeg, focusDist, fStop}], easing, N, dofPreblur|preblur, nearestDist, shutter, sunElevationDeg, grade}]`.
     These are DESIGN.md section 4 shots; the keys are interpolated with easing `linear | smooth (default) | smoother | easeInOut | easeIn | easeOut`, and the focal length in log space.
3. **Default**: a low wide shot over the water, backlit, `pos [2.6, 0.55, 7.6]`, `target [0, 0.85, 0]`, 35 mm f/5.6.

The camera is re-evaluated at every sub-frame time, so camera motion is motion-blurred and focus pulls work.

## 6. Final pass and grade

The grade object (`DEFAULT_GRADE` in `core/final.js`) is merged as defaults < preset < shot object < session < frame:

| key | default | notes |
|---|---|---|
| `exposure`, `exposureEV` | 1, 0 | linear multiplier x 2^EV on the scene-linear HDR |
| `glare` | `{amount: 0.015, r0: 0.002}` | Energy-conserving veiling glare, no threshold. `amount` is the fraction of each pixel's energy in the PSF `(1+(r/r0)^2)^-1.5` (r0 as a fraction of the image height). The pyramid's first level is ~2 px wide, so the PSF core inside sqrt(2) px stays in the image: `out = (1-a')*hdr + a'*lobe` with `a' = amount * lobeFraction` (`lobeFraction = 1 - E(sqrt 2 px)`: 0.61 at 540p, 0.84 at 1080p, 0.95 at 2160p). The halo beyond a given fraction of the image height therefore has the same energy at every output size (rendered self test: 540p/1080p 0.998, 1080p/2160p 0.995; the earlier renormalisation gave 1.38 and 1.13). `amount: 0` skips it. |
| tone map | Khronos PBR Neutral | Fixed. The output is display-linear. |
| `saturation` | 1 | Rec.709-luma preserving, in display-linear |
| `lift`, `gamma`, `gain` | 0, 1, 1 | Applied to the sRGB-encoded signal: `c = (c*gain + lift*(1-c))^(1/gamma)`. Scalar or [r,g,b]. |
| `lut`, `lutMix` | null, 1 | 3D LUT on the sRGB-encoded signal (encoded in, encoded out). `.cube` (red fastest, DOMAIN_MIN/MAX honoured) or raw Float32 S^3*3\|4 (33^3 default). null = the session LUT (`AG.setLUT`, `--lut`), which is **the film LUT** `scene/src/core/luts/afterglow_film.cube` unless `AG.init({ lut })` says otherwise (`'identity'` / `null` / `false` = none; fix round 3, docs/INTEGRATION.md section 7). With the film LUT, the shots listed in `FILM_LUT_CLASS.wide` (`scene/src/main.js`: the wides + blue hour) use `afterglow_film_wide.cube` instead (fix round 4, section 8); a shot's own `grade.lut` wins over both; `AG.info().lut.classes` lists them. `debugView: 'nolut'` shows a frame without it. |
| `grain` | 0 | Luminance grain: 3x3 binomial-filtered white noise (~1.5-2 px), seeded by (pixel, frame). The value is the std in 8-bit code values at mid grey and is weighted to the midtones; 2-3 is "subtle". |
| `dither` | 1 | TPDF dither, +-1 LSB, seeded by (pixel, frame). Leave it on: sunset gradients band without it. |

## 7. Measured on this machine (2026-10-21, placeholder scene)

The machine was shared with other agents, and the same command ran up to 15x slower under their load. The pixels were
bit-identical either way. "Quiet" and "loaded" are both reported.

| run | result |
|---|---|
| still 960x540, N=4 | 43-50 ms per frame, 4.6-4.8 ms per sub-frame (quiet); 0.5-1.2 s (heavily loaded) |
| still 1920x1080, N=16, wide | 131-157 ms per frame, 5.4-6.9 ms per sub-frame (quiet); 0.8-0.9 s at 27 ms per sub-frame (loaded); 2.8-3.1 s at 86 ms (heavily loaded) |
| still 1080p, 85 mm f/2, N=32 close-up | with pre-blur 1.2: 9.0-11.2 ms per sub-frame; without: 7.9-10.4 ms |
| render.mjs, 120 frames, 1080p, N=16 | 246 ms per frame (35.8 s per chunk) at moderate load; 1317 ms per frame under heavy load. FFV1: 167 MB per 120 frames (about 19 GB for 13,500 frames) |
| render.mjs re-run | chunk skipped in 4-6 s (startup + manifest checks) |
| encode.mjs, 120 frames | H.264 CRF 14 slow: 3-11 s, 5.4 Mbit/s. ProRes 422 HQ: 4-8 s, 462 Mbit/s. x265 10-bit: 13-72 s, 4.4 Mbit/s |
| encode verification | 960x540, 240 frames (shots.js camera): 60/1, bt709/bt709/bt709/tv, yuv420p, frame identity 240/240 testable, 0 violations. Compression PSNR (YUV, against the uncompressed conversion) H.264 50.6 dB average, 49.9 min; ProRes 63.0; x265 54.5. RGB against the source 44.0 dB (BT.601 control 32.4). ProRes `color_range=tv`. Audio onset error 0 ms, lag 0 samples on the delay path, the trim path, and a trimmed range whose loudest WAV note lies outside it |
| chunk lengths | 400 frames in chunks of 4, 7 and 100: 400 output frames each, frame identity 0 violations, all checks passed (before the fix: 402 frames from `--chunk 4`) |
| determinism | 1080p N=16 with grain 2.5: three fresh sessions (in order, reversed, single frame) bit-identical. The 85 mm f/2 pre-blur close-up at its own N=32 (frames 600/601), and at `--N 4`. Frames 240 and 299 decoded from the FFV1 chunk equal fresh-session stills (sha256 of the RGBA) |
| failure injection | GPU process killed mid-chunk: the chunk fails (the readback sentinel caught it, then the context-lost event arrived), is re-rendered in a fresh session, 240/240 frames equal a clean render (before: 23 stale frames in a "complete" chunk, exit 0). FFV1 ffmpeg killed: fails at once, 52 s total (before: hung 30 min). Browser killed: 21.5 s |
| motion blur x DOF symmetry | 50 mm f/1.4 pan at N=16, right vs left: horizontal-gradient energy ratio 0.980 (pinhole control 0.972; before the fix 1.168), mean abs difference 0.90 code values (pinhole 0.77; before 2.16). At N=4: 1.034 (pinhole 0.993) |
| selftest | accumulation alpha = 1 everywhere; glare lobe energy 0.998 of the input; glare halo resolution-independent (above); identity .cube max 1 LSB (3D-texture filtering precision); R<->B swap .cube correct; a lost context fails the next frame; `AG.dispose()` without errors |

The real `world` and `piano` modules (work in progress, loaded automatically in `auto`) took 33-58 s to initialise
and 27-29 ms per sub-frame at 540p under load.

## 8. Known issues and notes

- **Piano frame handedness.** The piano frame of research/piano.md (x to the player's right, y up, z toward the tail)
  is **left-handed**. DESIGN.md section 2 says it is right-handed "as is". The piano module mirrors it
  (`scale (-1,1,1)`, rig position `+0.780`) so that the treble is on the pianist's right; DESIGN.md says the position
  is `-0.780` with no flip. In three.js, someone facing +z with y up has their right at **-x**. The owner of
  DESIGN.md should fix that paragraph.
- **World hooks.** Since the world's session 2 the world module registers itself: `registerSkyBake` calls
  `world.prepareFrame(t, {camera, frame})` with the frame-centre camera, and a `registerEnvCapture` hook sets
  `scene.environment = world.envMap` (docs/WORLD.md section 1). (This note used to say the world did not use the hooks.)
  The piano's env probe still wraps `world.prepareFrame` as a guard; it does nothing when the world is already prepared.
- **Motion-blur stepping.** At N=32, a fast hand in an 85 mm close-up shows discrete copies at its edges. Since fix
  round 4 the motion N boost (section 4, `N`) raises N on exactly those frames: the table is solved from the perf FK
  fingertips/knuckles projected through the edit camera (`sandbox/integration/blurstep.mjs --boost-out`, target copy
  spacing 1 px), re-solved for every snapshot by `render/snapshot.mjs`, and keyed to the perf sha and each shot's N
  (a stale table is ignored by the page and fails integration wiring check 9). A velocity gap-fill pass (the
  analogue of the DOF pre-blur) is still not implemented: it would need per-sub-frame motion vectors of the skinned
  hands.
- **The DOF pre-blur uses the water surface depth**, not the reflected path length, so it under-fills reflections in
  very shallow focus. The lens sampling itself is still correct (research/rendering.md section 4).
- **Chunk validity and code changes.** The settings hash covers the size, the init options and the frame options,
  but not the code. The manifests record the content hash of every file the page loaded (code, shots.js, data such as
  `score.json` and `perf.bin`), render.mjs reports stale chunks, `--rerender-stale` re-renders them, and encode.mjs
  refuses to join chunks whose inputs differ. Files the page never requested (e.g. a module's lazily fetched asset
  that a given chunk did not need) are not covered.
- **Do not render while another agent edits the inputs.** A file that changes during a chunk is recorded as
  `changed:<hash>` and encode.mjs then refuses that chunk set. Freeze `scene/` and the data files for a film render.
- **Preview sampling (N = 4).** Four points cannot decorrelate every dimension. The time x aperture correlation is
  small (0.08 / 0.12), so the defocus x motion asymmetry is at most 13% in the analytic worst case (1.03 measured on
  the pan test), and the aperture covers all four quadrants. Some module dims still correlate with time (up to 0.66).
  Final renders use N >= 16.
- **Hosting.** The server serves the whole repository on 127.0.0.1 only.
