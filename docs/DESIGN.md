# Afterglow: architecture contract

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

This is the single source of truth for how the pieces fit. Research that informed each decision is in `research/*.md`.
If you must change something here, change this file in the same edit and say so in your report.

## 1. Repository layout

```
afterglow/
  refs/                    the 12 reference images (shot list + look target)
  docs/                    BRIEF.md, DESIGN.md (this), SHOTLIST.md, CREDITS.md, LOOK.md
  research/                research notes (read-only inputs)
  music/
    dsl.py                 score DSL (shared; do not break its API)
    afterglow_score.py     the composition -> music/final/ (score.json, score.mid, leadsheet, rolls)
    sampler.py             Salamander sampler (MIDI/score.json -> WAV)
    render_audio.py        final mix: sampler + pedal noise + reverb + mastering -> build/audio/
    samples/               downloaded sample sets (gitignored)
  perf/                    performance solver (Node ES modules): fingering, hand/arm IK, body motion, keys, pedal
    solve.mjs              score.json + piano layout + rig -> build/anim/perf.bin + perf.json (+ QC report)
  assets/                  generated or sourced 3-D assets that are small enough to commit (GLB, KTX2, PNG)
    pianist/               pianist GLB(s) + rig description; generation scripts in tools/pianist/
  scene/                   the three.js film (served statically; ES modules + import map, no bundler)
    index.html             render page; exposes window.AG (section 5)
    src/core/              renderer, accumulation, lens, final pass, LUT, PSF, rng, frame IO
    src/world/             sky, clouds, terrain, shores, lake bed, water, mist
    src/piano/             procedural piano (D-class) + bench, materials, key/hammer/damper/pedal animation
    src/pianist/           pianist loader, skin/hair/cloth materials, pose application from perf tracks
    src/camera/            shots.js (the edit), rig yaw cheats, lens per shot; index.js (sun arc, diagnostics)
    src/integration/       glue module (rig wiring checks, per-shot module looks, probe for the sync checks)
    src/film.config.js     output presets, soundtrack, film plan (frames + per-shot N from the edit)
    src/main.js            assembles modules, timeline, per-frame update
  render/                  Node driver: puppeteer-core + Chrome headless -> FFV1 chunks -> deliverables
    render.mjs  still.mjs  encode.mjs  film.mjs (presets)  lib/ (incl. gpulock.mjs: one GPU client machine-wide, also shared with the user's other projects' lock; INTEGRATION.md 8.1)
  tools/                   python/node utilities (compare.py, analyze_refs.py, contact sheets, QC)
  build/                   all generated outputs (gitignored): music/, audio/, anim/, stills/, chunks/, out/
```

Shared rule: one owner per directory during a build phase. Shared files (`scene/src/main.js`, `scene/index.html`,
`package.json`) are edited only by the integrator unless a task says otherwise.

## 2. Coordinate frames and units

Metres, seconds, radians in code (degrees in docs). three.js right-handed, **y up**.

**World frame**
- Water surface is the plane **y = 0**. Lake bed at the piano is y = -0.04 (water depth 4 cm, research/refs.md §0.4),
  sloping to about -0.3 m at 20 m.
- Azimuth A (degrees, clockwise seen from above) is measured from the sun: A = 0 is the sun.
  A horizontal unit vector for azimuth A is **(sin A, 0, -cos A)** (so the sun is toward -Z).
- Sun: A = 0, elevation **-1.0 deg** at the core look. Film time arc (amended 2026-10-22, integrator, MODULE_ISSUES
  I-23): the sun is **below the horizon from the first frame**: about -0.8 deg at the start -> -0.9 (verse 1) -> -1.0
  (chorus 1) -> -1.05 (chorus 2) -> -1.1 (bridge) -> the existing climax keys -> -4.5 deg at the very end (blue-hour
  coda, ref 1), monotone. (It used to start at +0.6 deg: the plates and the world tuning sit at -1 deg, and the opening
  wides came out washed pink and 30-45 % too bright; a -1 deg test moved compare.py S01 50 -> 70, S03 55 -> 65.)
  The sun disc is never visible except as a glow in a ridge notch.
- Terrain layout: research/refs.md §4 table (left headland, left dark peak at A -4 deg, far valley, central far range,
  right hills and boulder shore, right snowy massif A +30 deg, ring of mountains elsewhere).

**Rig frame** (piano + bench + pianist + ripple emitters move together)
- The piano is modelled in the **piano frame** of research/piano.md §0: origin on the floor (lake bed) below the
  front-left case corner, x to the right along the keyboard (bass -> treble), z away from the player (toward the tail),
  y up. **With y up that frame is left-handed**: in three.js someone facing +z has +x on their LEFT. (Corrected by the
  piano module, 2026-10-21; the earlier text said "right-handed as is: no flips", which would have built a mirrored piano.)
- The piano group sits inside a **rig group** and is **mirrored in x**: piano group position = (+0.780, -0.04, 0),
  scale = (-1, 1, 1), i.e. rig = (0.780 - x_p, y_p - 0.04, z_p). Rig origin = the keyboard centre at the key-front plane,
  on the water surface; rig x = 0 is the keyboard centre (E4|F4 boundary). The pianist sits at negative rig z and faces
  +z, so **rig -x is the treble (his right hand), rig +x the bass/spine (his left)**; with rig yaw 120 deg the treble side
  faces A = +150 deg, as research/refs.md §4 assumes. `scene/src/piano/layout.js` exports pianoToRig()/rigToPiano()
  and the solver should work in the piano frame and convert with them (docs/PIANO.md).
- Rig yaw: rig.rotation.y = 120 deg makes the pianist face A = +60 deg (sun at his left-front, phi = -60 deg).
  Shots may add a yaw cheat (research/refs.md §4 per-shot table); the world never rotates.

**Piano class**: build the **D-class concert grand** (2.74 x 1.56 m): the references show concert-grand proportions
(research/refs.md §3.8). research/piano.md gives B-class numbers plus D outline and the INRIA D measurements; scale the
interior layout to D with the same generators (sandbox/piano/*.py) and keep all keyboard/action/key-height numbers.

## 3. Time

- Film time **t = frame / 60** exactly. Frame 0 is the first frame of the film.
- Music time m = t - **MUSIC_OFFSET**; MUSIC_OFFSET = 4.0 s (the film opens on the vista before the first note).
  The film's audio track is the soundtrack WAV delayed by MUSIC_OFFSET. The film ends a few seconds after the
  final pedal release (exact length is set by the shot list).
- `music/final/score.json` times (t_on, t_off, pedal curve, bars, sections, phrases) are in music time.
- Note-on time = hammer-string contact = audible onset (minus the sampler's measured attack offset, research/performance.md §1).
  The key starts moving `tt(v)` before it; see research/performance.md §5.
- Shutter: 180 deg (1/120 s), sub-frame times centred on t (no lag against audio).
- Everything that affects a pixel is a pure function of t (and of the frame/sub-frame index for noise).
  No Math.random, Date, performance.now or requestAnimationFrame in anything that draws.

## 4. Data contracts

**Score** `music/final/score.json` (written by music/dsl.py `to_json`): notes[{id, pitch, name, t_on, t_off, vel, hand,
voice, finger, bar, section, beat}], pedal[[t, cc64]], bars[{bar, t, beats}], sections[...], phrases[...], beats[...].
`t_off` is the key release (sound may continue under pedal).

**Performance tracks** `build/anim/perf.bin` + `build/anim/perf.json` (written by perf/solve.mjs):
- Sample rate 240 Hz in music time, starting at m = -MUSIC_OFFSET (film t = 0), through the end of the film.
- perf.json lists channels: for every pianist bone (names from assets/pianist/rig.json) a local quaternion (x,y,z,w),
  plus root position; 88 key angles (rad, about the balance axis); 88 hammer angles; 88 damper lifts (m);
  3 pedal angles; and the ripple emitter event list (time, source position in rig frame, amplitude).
- The page interpolates linearly between samples (nlerp for quaternions). QC report: build/anim/qc.json + qc.csv.

**Shots** `scene/src/camera/shots.js`: ordered list of shots {id, t0, t1, ref (optional ref image id), rigYawCheatDeg,
camera keyframes [{t, pos(world), target(world) or rig-relative, fovDeg or focalMm, focusDist, fStop}], easing,
N (sub-frames), dofPreblur, sunElevationDeg override, grade preset}. Cuts land on musical events (bars/phrases from score.json).

## 5. Render page API (`scene/index.html`)

```
await AG.init({ width, height, quality: 'preview'|'final', data: {...urls} })
await AG.renderFrame(frame, { N, shutter, debugView })   // draws the graded RGBA8 frame
AG.readPixels() -> Uint8Array (top-down rows)            // or the pipelined Blob upload from render-test
AG.info() -> { shot, t, m, timings, integration }
AG.probe({ t, fingers, foot, ripples })                  // integration checks only (never used by the drivers)
```
How the film is assembled from the modules (slots, wiring, commands): docs/INTEGRATION.md.
The Node driver (render/) never lets the page run its own loop. Preview renders: 960x540, N = 4.

## 6. Rendering model (research/rendering.md)

- three r186 `WebGLRenderer`, headless Chrome 155 (ANGLE D3D11, Radeon 780M), puppeteer-core.
- Accumulation buffer: N sub-frames from one fixed sample table per N (`core/rng.js`): stratified shutter times centred
  on the frame, CMJ pixel jitter, CMJ thin-lens aperture samples on the 9-blade polygon and stratified 2-D module dims
  (`sub.dim(i)`, e.g. jittered shadow / fill lights), paired to the sub-frames so that they are decorrelated
  (RENDERING.md section 3; this replaced the first draft's Halton jitter); RGBA16F scene target -> RGBA32F
  accumulation. DOF gap-fill pre-blur for shallow focus: each sub-frame is blurred by a Gaussian of sigma
  `0.5 * preblur * CoC / sqrt(N)` (about half the spacing of N aperture samples on a CoC-wide disk) before it is
  accumulated, so thin defocused highlights fuse into a line instead of N beads (fix round 3; it was a disk of half that).
  Since fix round 4 the gap-fill is **'layered'** (`core/accum.js`, default): a dense base layer for everything behind
  focus (each pixel a tap with its own normalised Gaussian) plus near-field sigma levels 2-32 px for content in front of
  focus, so a near highlight is blurred by ITS OWN sigma wherever it lands (a lacquer edge 10 cm from the lens no longer
  fans out into discrete lines over the sharp background); reach up to 96 px (2.5 sigma). 'disk' / 'gauss' stay for A/B.
- Motion blur: the 180-degree shutter is sampled at N stratum-centre times, so a moving edge is N copies `disp / N`
  apart. Where a fast hand would put those copies more than 1 px apart at the shot's own N, a per-frame **motion N
  boost** raises that frame's N (to the next multiple of 16, at most 128): `scene/src/integration/motion_n.json`, solved
  from the performance and the edit by `sandbox/integration/blurstep.mjs --boost-out`, re-solved by
  `render/snapshot.mjs`, applied by `main.js` only in final-quality renders that do not force N (fix round 4; ~110
  frames, +0.5 % sub-frames). Review clips and approval stills use each shot's own N (`review-1080p`); N=16 presets are
  for wiring and sync checks only.
- Sky + clouds baked once per output frame into a cube/equirect; used for background, reflections, aerial perspective.
- Water: Reflector (planar) per sub-frame with analytic ring ripples (dispersion relation), swell, micro-normals,
  Fresnel (F0 exposed for look-dev), depth tint/transparency to the pebble bed.
- Lacquer: MeshPhysicalMaterial clearcoat + env cube captured at the piano (pianist hidden) + planar reflectors for
  fallboard/music desk/case side in close-ups.
- Final pass per output frame: veiling-glare PSF (no threshold bloom) -> Khronos PBR Neutral -> film 3D LUT -> optional
  subtle grain -> TPDF dither -> RGBA8. The film LUT (`scene/src/core/luts/afterglow_film.cube`, 33^3, the session LUT
  of every render) is **hand-built, not a free fit**: a constrained grade with a handful of parameters (OKLab shadow
  desaturation with hue and lightness kept; highlights pulled toward peach) fitted on the stills that realise refs
  (`sandbox/integration/lut/`). Since fix round 4 (v2) the highlight chroma gain is gamut-aware (it saturates before
  any display channel reaches 0.98, so the sunset glow rolls off instead of clipping red at 255), and the wides and the
  blue hour use a second table with a gentler shadow desaturation (`afterglow_film_wide.cube`, s 0.6 instead of 0.3
  since 2026-10-23 (v3; s 0.5 in v2): their refs keep navy/plum shadows, dark chroma 7-16), chosen per shot class by `FILM_LUT_CLASS` in
  `scene/src/main.js`; everything else (close-ups) keeps the v1 shadow grade. A free 3D LUT fitted to the refs (iterative distribution transfer) was measured to
  overfit (compare.py 55.9 -> 56.5 leave-one-ref-out) and to crush close-up blacks (S04 near-black 34 -> 43 %), and the
  remaining colour gap is in the scene (water, sky, lacquer), not in the grade. docs/INTEGRATION.md section 7.
- Output: FFV1 lossless chunks (resumable, manifest per chunk) -> concat -> deliverables:
  H.264 CRF 14 slow yuv420p BT.709 + AAC/Opus audio (MP4), 2160p60 master if the budget allows, else 1440p/1080p.

## 7. Look targets (research/refs.md §3)

Automated checks on rendered stills, per comparable shot: luminance percentiles (p1 0-1, p50 63-75, p99 179-196, nothing
at L >= 250 in wides), hue-by-luminance bands (±8 deg), HSV saturation mean 0.43-0.49, palette swatches per element,
snow darker than the sky behind it (0.6-0.75x), highlights roll off to peach #FEC08A-#FEC493. `tools/compare.py` gives the
side-by-side sheets and proxy metrics; two different references of the same shot score ~77 on it, so treat 75+ as "in family"
and use the sheets plus critique for the rest.

## 8. Faces, honesty, licences

- The pianist's face is never lit frontally: every camera stays behind/beside him (|alpha| < 100 deg) or he is in silhouette,
  or his head is out of frame (head centre outside the frame by 5 % of its height) on every frame where |alpha| >= 100 deg;
  when the head is in frame at |alpha| >= 100 deg the lens must be >= 110 deg off the face's forward direction
  (camera C-01, 2026-10-22; frame_check.mjs tests it, also with the head pitched 10 deg up).
- Only CC0 / CC-BY / MIT-style assets; every one recorded in docs/CREDITS.md with author, URL, licence, what we use it for.
- No real brand names or logos on the piano (fictional or blank fallboard/plate).
- Never claim a check that was not run; QC reports carry the command that produced them.
