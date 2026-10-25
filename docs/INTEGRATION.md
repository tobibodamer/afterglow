# Integration: how the film is assembled

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

Owner: the integrator (`scene/src/main.js`, `scene/index.html`, `scene/src/core/**`, `scene/src/integration/**`,
`scene/src/film.config.js`, `render/**`, `sandbox/integration/**`). Architecture contract: docs/DESIGN.md; render core and
drivers: docs/RENDERING.md. Module docs: WORLD.md, PIANO.md, PERFORMANCE.md, assets/pianist/README.md, SHOTLIST.md.
Module-level problems found while integrating go to `sandbox/integration/MODULE_ISSUES.md` (the polish rounds read it).

## 1. What the page loads

`scene/index.html` -> `scene/src/main.js` `createFilm()` -> `window.AG`. `AG.init` loads, in this order
(`MODULE_SLOTS`, policy `'auto'` = the real module when its file exists):

| slot | file | parent | role in the film |
|---|---|---|---|
| `world` | `scene/src/world/index.js` | world | sky, clouds, terrain, water + lake bed; registers its own sky bake (`prepareFrame` with the frame-centre camera) and env capture (`scene.environment = world.envMap`); exposes `glowLight`, `envMap`, `envCube` |
| `piano` | `scene/src/piano/index.js` | rig | D-class grand + bench; its own lacquer env probe (layer 5, pianist hidden); desk / lid planar mirrors (layer 7, pianist included) |
| `pianist` | `scene/src/pianist/index.js` -> `pianist.js` | rig | `assets/pianist/pianist.glb` + materials; asks the piano for `setBenchHeight(0.47)` |
| `camera` | `scene/src/camera/index.js` | (no group) | pins the world's sun to the edit's arc every frame (`world.setSunElevation(ctx.sun.elevationDeg)`), checks the rig yaw, diagnostics (`window.__AG_CAMERA`) |
| `integration` | `scene/src/integration/index.js` | (no group) | wiring checks (below), per-shot module looks, `AG.probe()` for the sync checks |

The camera POSE does not come from a module: the core's `CameraDirector` imports `scene/src/camera/shots.js` (the
edit) and calls `shotAt(t)` (shot settings) and `cameraAt(t, shot)` (camera state) at the frame centre and at every
sub-frame time. Shared data (`DEFAULT_DATA`): `music/final/score.json` (FROZEN, sha1 7CB6BB6C...),
`build/anim/perf.json` + `perf.bin` (the solver's tracks).

## 2. Wiring (who drives what, per output frame and per sub-frame)

| what | source | how it reaches the scene | per |
|---|---|---|---|
| shot, N, pre-blur, nearestDist, shutter, rig-yaw cheat | edit `director.shotAt(t)` (`s.settings`) | core `frameSettings`: defaults < shot < session < frame | output frame |
| sun elevation | edit `sunAt(t)` (monotone, musically anchored) -> `shot.sunElevationDeg` | core `ctx.sun.update`; camera module pins the world (`setSunElevation`) | output frame |
| fades / grade | edit `fadeAt(t)` -> `shot.grade = {exposureEV}` (no named presets used yet) | core grade merge -> final pass | output frame |
| camera pose, focal length, focus distance, f-stop | edit `cameraAt(t_k, shot)` (rig frame, `space: 'rig'`) | core `applyCameraState` through the rig's world matrix (so the cheat moves the camera with the rig) + thin lens | **sub-frame** |
| rig yaw | `120 deg + rigYawCheatDeg` | `rigGroup.rotation.y` (piano, bench, pianist, ripple sources; the world never rotates) | output frame |
| pianist bones + root | `build/anim/perf.*` via `scene/src/perf/tracks.js` (`sampleBones`, nlerp, 240 Hz) | `pianist.update(t_k)` | **sub-frame** |
| keys, hammers, dampers, pedals | the same `perf.*` (channels `keys`, `hammers`, `dampers`, `pedals`) via the piano's `makeTrackReader` | `piano.update(t_k, sub)` reads `sub.time` | **sub-frame** |
| water rings | `perf.json ripples` (rig frame, film time) -> `rippleEventsFromPerf` (+ a faint default stream x0.5) | world: re-projected through `ctx.rigGroup.matrixWorld` every output frame (`prepareFrame` -> `uploadEvents`), so the per-shot cheat moves the rings with the piano | output frame (packet list); the ring phase is evaluated at each sub-frame time in the shader |
| world lighting for piano / pianist | `world.glowLight` (direction + irradiance + radiance of the horizon glow), `world.envMap` | piano coat kicker follows `glowLight`; pianist glow rim reads `ctx.modules.world.glowLight`; `scene.environment = world.envMap` | output frame |
| piano lacquer look per shot | edit spec `piano.lacquerLook` (none set yet) else `'auto'` (distance blend) | integration `beforeFrame` -> `piano.setLacquerLook` | output frame |
| pianist look per shot | edit spec `pianist: {...}` (none set yet) | integration forwards `spec.pianist` into `info.shot.raw.pianist` before the pianist's `beforeFrame` | output frame |
| soundtrack | `build/audio/afterglow_film.wav` = 4.0 s silence + the approved mix (bit-exact) | `encode.mjs --offset 0` (film.config `AUDIO`) | file |

Placement (asserted at init by the integration module, `AG.info().integration.wiring`):
- piano group in the rig at `(KB_CENTER_X 0.780, RIG_Y_OFFSET -0.04, 0)`, scale `(-1, 1, 1)` (piano frame is left-handed);
- pianist group in the rig at `(0, -0.04, KEY_FRONT_Z 0.022)`, unrotated (the solver's pianist frame);
- bench seat at 0.47 m (`piano.setBenchHeight`; the GLB is seated on 0.47);
- water rings from the solver (`world.info().ripples.source === 'perf'`), `glowLight` + `envMap` present;
- perf tracks loaded, the pianist's bone tracks bound (72 bones).
A failed check prints `[AG] integration check FAILED` in the page log; a misplaced pianist group is re-placed
(`wiring.fixes`).

## 3. Film config and commands

`scene/src/film.config.js`: output sizes (`1080p` 1920x1080, `1440p` 2560x1440, `2160p` 3840x2160), the soundtrack
(`AUDIO`), render presets, and `filmPlan()` = the film as the edit defines it: **13,857 frames (230.95 s)**, 27 shots,
each with its own N (16 wides ... 48 macro close-ups; 404,392 sub-frames = 29.2 per frame on average) and pre-blur. The
film length comes from the score: the edit ends 5.5 s after the final pedal release in score.json.

| preset | size | quality | N | chunks -> deliverable |
|---|---|---|---|---|
| `final-1080p` / `final-1440p` / `final-2160p` | 1080p / 1440p / 2160p | final | per shot | `build/chunks/film_<size>` -> `build/out/afterglow_<size>60.mp4` |
| `check-1080p` / `check-1440p` | 1080p / 1440p | final | 16 | `build/chunks/check_<size>` |
| `animatic` | 640x360 | preview | 1 | `build/chunks/animatic_integrated` -> `build/out/animatic_integrated.mp4` |

```
node render/film.mjs plan   --preset final-1080p [--timings sandbox/integration/out/v2/stills.json]   # shots, N, estimate
node render/film.mjs render --preset final-1080p [--from A --to B] [--per-session K]                  # resumable chunks
node render/film.mjs encode --preset final-1080p                                                        # MP4 + film audio
node render/film.mjs clip   --preset check-1080p --from 1920 --to 2520 --name hands                     # build/out/test_hands.mp4
node render/film.mjs render --preset animatic --from 3600 --to 6000 --chunks build/chunks/animatic_integ2 --per-session 4
node render/film.mjs encode --preset animatic --chunks build/chunks/animatic_integ2 --from 3600 --to 6000 \
                            --out build/out/animatic_segment.mp4                                        # 40 s animatic, 5 cuts
```
`render` runs one `render.mjs` process per chunk (`--per-session K`: K chunks), so every browser session holds the
machine-wide GPU lock (`render/lib/gpulock.mjs`) for one chunk only. Re-running the same command skips complete chunks
(manifests, docs/RENDERING.md section 1). `encode` always muxes `afterglow_film.wav` at `--offset 0`.
Because the piano is history-dependent (MODULE_ISSUES I-11), `render.mjs` renders the 3 frames before a chunk
(discarded) whenever the chunk does not continue the frame the session rendered last (`--preroll K`, manifest field
`preroll`); within a session chunks follow each other directly.

**Frozen snapshots.** Module owners edit `scene/` while renders run (during this integration the scene tree hash
changed several times per minute). A render that spans several browser sessions (every chunked render, the
determinism check) must therefore load a frozen copy:
```
node render/snapshot.mjs --out build/snap/<name>        # copies scene/, assets/pianist/, score.json, build/anim/perf.*;
                                                        # links node_modules/three; prints the scene+assets hash
$env:AG_SERVE_ROOT = 'E:\...\build\snap\<name>'          # render/lib/session.mjs serves the snapshot instead of the repo
node render/film.mjs render --preset final-1080p         # every session (and every chunk manifest) sees the same files
```
With `AG_SERVE_ROOT` set the session logs every GET that 404s (a file missing from the snapshot). Chunk manifests then
record the snapshot paths as inputs, so encode.mjs compares like with like.

Before the final render: snapshot (or freeze) `scene/`, `assets/`, `build/anim/` and the score, run nothing else on the
GPU, and get the user's approval of the stills (USER_FEEDBACK item 5).

## 4. Checks

```
node sandbox/integration/check.mjs --size 1080p --N 16 --out sandbox/integration/out/v2 --sync 30
.venv/Scripts/python.exe sandbox/integration/contact.py sandbox/integration/out/v2
.venv/Scripts/python.exe tools/compare.py sandbox/integration/out/v2/pairs.json sandbox/integration/out/v2/compare
node render/determinism.mjs --frames F1,F2,F3 --size 1920x1080 --N 16 --out sandbox/integration/out/det
```
`check.mjs` (one GPU session): wiring checks; a sync probe of N seeded random notes through `AG.probe` (what the scene
actually applied, not the track files): key angle around the note-on at 1/960 s and at the film frames, hammer at the
string, the playing finger's lowest skinned distal vertex against the key top at key bottom, dampers while held and
after the release against the score's CC64, the sustain pedal against CC64 over the whole film and the right foot
against the pedal; then the first and middle frame of every shot with per-frame timings and, after each, the water's
ring packets matched to the solver's events (rig -> world computed independently from 120 deg + the shot's cheat).

## 5. Results (2026-10-22 00:00-, measured; commands in section 4)

Inputs: score sha1 7CB6BB6C (frozen), perf b24f8e5b (run C), scene snapshot `build/snap/integ1` (scene+assets hash
5c32fde2c23ae9d3) for every multi-session render.

**Wiring** (`out/v2/check.log`): 7/7 checks OK: piano at (0.78, -0.04, 0) scale (-1,1,1); pianist at (0, -0.04, 0.022)
unrotated; bench 0.47; water rings from the solver (302 solver events -> 1043 ring packets incl. long rings and the faint
background); `glowLight` + `envMap`; perf tracks (55,551 samples x 558 floats); 72 bone tracks. Module create times:
world 8-23 s, piano 0.6 s, pianist 1.0 s; session init (incl. shader compile and the warm-up frame) 85-130 s.

**Sync** (30 seeded notes, `out/v2/sync.json`, measured on what the scene applied):
| check | result |
|---|---|
| key reaches >= 97 % of its dip within one film frame of the note-on (audio onset) | **30/30** (key bottom 0.6-11 ms after the note-on, soft notes latest, as research/performance.md predicts) |
| key at the note-on frame | 75-100 % of the dip; at the next frame on the bottom |
| hammer at the string (within 0.25 deg of `hammerStrikeAngles`) within one frame | 23/30, at -0.4..+2.7 ms; the other 7 peak 0.2-0.55 deg short (240 Hz track sampling, MODULE_ISSUES I-09) |
| the playing finger's lowest skinned distal vertex on its key at key bottom | **30/30** on the key outline, gap to the key top p50 0.1 mm, max 0.27 mm |
| dampers lifted while the key is held | 30/30 (6-8 mm) |
| dampers after the release follow the score's CC64 (half-pedal and change windows excluded) | 13/13 |
| sustain pedal angle vs CC64 over the film (904 samples, change windows excluded) | Pearson 1.000; down when CC64 >= 100, up when <= 10 |
| right foot height vs pedal angle | Pearson -1.000, 12.1 mm travel |
| water rings vs the solver's ripple events (27 shot middles, 1440p run, 16 different rig cheats) | 434 of 1062 packets are solver events, world position error 0.000 mm (rig -> world computed independently); 67/74 solver events of the last 1.5 s are in the water, the 7 missing ones in the climax where the 40-packet cap is full (I-10) |

**Stills** (`out/v2/contact_1..4.jpg`, first + middle frame of all 27 shots at 1080p N=16, the ref beside each shot that
realises one; compare sheets `out/v2/compare/`): every shot renders with all modules; compare.py mean 55.4 over the
26 ref pairs (S10/ref9 60.8-67.2, S19/ref3 51.8-66.8, S17/ref4 64.3, S09/ref8 43.6 lowest). The look gaps are module
issues (MODULE_ISSUES I-03..I-08).

**Render time** (`node sandbox/integration/estimate.mjs` -> `out/estimate.json`; page time per frame on the shared 780M):
| measurement | result |
|---|---|
| 1080p N=16, every shot (first + middle frame, `out/v2`) | 0.9-3.8 s per frame; per sub-frame 53 ms (vista) .. 215 ms (desk-mirror hand shots S04, S15, S22) |
| 1440p N=16, every shot (middle frame, `out/t1440`) | 1.0-4.9 s per frame: the same as 1080p within tonight's noise |
| same 3 frames x 2 renders at 1080p / 1440p / 2160p (S03 wide, S04 hand, S15 macro; `out/timing_*`) | 1.27 / 1.06 / 2.18 s, 2.19 / 1.62 / 3.34 s, 1.86 / 1.66 / 3.55 s -> size factor vs 1080p: 1440p 0.84 (= 1.0 within noise), 2160p 1.71 |
| full film at each shot's own N (404,392 sub-frames, 29.2 per frame) | **1080p 9-11 h, 1440p 9-11 h, 2160p 15.5-19 h** of page time (+ session starts ~2 min per chunk group, + load from other GPU users) |

~~The renderer is not fill-bound at 1080p-1440p on this GPU, so 1440p costs what 1080p costs; 1440p fits comfortably.~~
**Withdrawn in fix round 3 (section 7):** the 0.84 size factor came from 2 renders of 3 frames in different sessions and
does not reproduce; the critic's same-frame own-N sessions give 1440p/1080p 1.05-1.28 (slower in all 8 frames) and
2160p/1080p 1.47-2.82, and the totals left out the session starts. The current estimate and advice are in section 7.

**Determinism** (`render/determinism.mjs --frames 1519,2269,10334 --size 1920x1080 --N 16`, snapshot `integ1`):
**fails as an order-independence test**: sessions A (in order) and B (reversed) differ on all 3 frames, C equals B on
10334. Diagnosis (`out/detdiag`): the scene has a one-frame memory inside the piano module (differences only on the
piano and its reflection, 1-3.5 % of the pixels, max 6-20 code values; MODULE_ISSUES I-11). Same history -> same bits
(B = C; every repeat with the same predecessor is bit-identical, also across sessions). Mitigation: `render.mjs` pre-rolls
frame a-1 at every chunk/session start, so a chunked or resumed render equals a continuous one; `determinism.mjs
--preroll` verifies that (result below).
Pre-roll result (`determinism.mjs --preroll`, `out/det_preroll`): 1519 and 2269 bit-identical in all sessions; 10334
(S20) still differs in one session of three (B), whose only difference from C is the warm-up frame. So the memory is
longer than one frame for some shots, or there is a session-level effect; **determinism of the integrated scene is not
established** and stays a blocker for the piano module (I-11) before the final render. `render.mjs` pre-rolls 3 frames by
default meanwhile.
Re-run on the current modules (snapshot `integ2`, section 6): with `--preroll 3` **PASS**, all three frames bit-identical in
sessions A, B and C (`out/det2`); without the pre-roll still FAIL (`out/det_nopre`). So the chunked film render (which
pre-rolls 3 frames at every chunk/session start) is reproducible; the piano module is still not a pure function of t.

**Test clips** (`node render/film.mjs clip --preset check-1080p ...`, snapshot integ1, 1080p N=16, film audio):
| clip | result |
|---|---|
| `build/out/test_hands.mp4` (perf run C; archived as `test_hands_integ1_runC.mp4`, 8.2): S04 (ref 7, right hand, desk mirror), frames 1920-2520 (32-42 s) | 600 frames in 2 chunks (2.84 / ~2.8 s per frame sustained incl. readback + FFV1; session start 3.0 min). encode.mjs: provenance consistent (65 loaded files identical across the chunks; the live scene/ hash differed, the snapshot did not), ALL CHECKS PASSED: 60/1, 600 frames, BT.709 tv, frame identity 600/600 testable, 0 violations, H.264 PSNR 50.0 dB avg (min 49.3), audio onset error 0 ms, lag 0, correlation 1.00. Looked at: no flicker (max frame-to-frame mean-luma change 0.20 code values, no spikes), no visible seam at the chunk start 2220 (3-frame pre-roll), hand motion blurred smoothly, the right hand plays along the keyboard (`out/clips/chunk_001920_002220_strip.jpg`, note-on crops f2057-2061, `out/clips/hands_noteon_crops.jpg`: fingers on the keys, the hand mirrored in the fallboard) |
| `build/out/test_wide.mp4` (perf run C; renamed `test_wide_integ1_runC.mp4`, 8.2): S03 (ref 2, hero wide, slow orbit), frames 1200-1800 (20-30 s) | 600 frames in 2 chunks, 1.53 s per frame sustained (session start 2.4 min). The first encode (02:00) refused the chunks on provenance (live scene hash differed between the chunks); after encode.mjs learnt to compare the files the page actually loaded, the re-encode (02:04) passed ALL CHECKS: 60/1, 600 frames, frame identity 600/600, 0 violations, H.264 PSNR 44.6 dB avg (min 43.3; the fine water glitter costs more bits than the dark hand shot), RGB vs source 35.8 dB (BT.601 decode 32.9, so the BT.709 tags are right), audio onset error 0 ms, lag 0, correlation 1.00. Looked at (`out/clips/test_wide_strip.jpg`, `test_wide_crops.jpg` = f1499 / f1500 / f1650 around the pianist): no flicker (max frame-to-frame mean-luma change 0.23 code values, p99 0.19, no spikes), the chunk seam 1499 -> 1500 continuous, pianist, bench, legs, lid prop and desk read; mountains / clouds as in I-03 |
| `build/out/animatic_integrated.mp4` (perf run C; renamed `animatic_integrated_integ1_runC.mp4`, 8.2): the FULL film as an animatic (640x360 N=1, `--preset animatic`, snapshot integ1) | 13,857 frames in 24 chunks of 600, ~0.23 s per frame, 62 min of GPU (02:01-03:03). encode: every check passed except `rgbMatchesSource` (RGB PSNR 32.4 < 34 dB): the N=1 preview is aliased and 4:2:0 chroma at 320x180 cannot hold that, a 1080p N>=16 render passes it (the clips above). Frame identity 12,976/12,976 testable, audio onset 0 ms, correlation 1.00 in every window |
| `build/out/animatic_segment_integ1.mp4`: 40 s cut of that animatic, frames 3600-6000 (S06 macro hook -> S07 -> S08 -> S09 -> S10 -> S11, 5 cuts) | `node render/encode.mjs --chunks build/chunks/animatic_integrated --from 3600 --to 6000 --audio build/audio/afterglow_film.wav --offset 0 --out ...`: ALL CHECKS PASSED (RGB 36.9 dB, audio onset 0 ms, lag 0 in both windows). Looked at (`out/animatic_segment_sheet.jpg`, one frame every 2 s): every cut lands on a new framing, no black or broken frames |

## 6. Round 2: re-check on the current modules (2026-10-22 03:25-, snapshot `build/snap/integ2`)

Module owners kept working after `integ1` (piano `index.js` 01:39, pianist `tailoring.js` 02:00, `assets/pianist` 00:50).
`node render/snapshot.mjs --out build/snap/integ2` froze the live tree (scene+assets hash `99f0a116c8b105a8`, unchanged
since 02:04); the GPU steps ran from `sandbox/integration/queue2.ps1` (`AG_SERVE_ROOT` = integ2, log lines in
`sandbox/integration/queue.log`, full output `q_<step>.log`).

| check | command | result |
|---|---|---|
| wiring + sync + stills | `node sandbox/integration/check.mjs --size 1080p --N 16 --sync 30 --out sandbox/integration/out/v3` (6.6 min session, init 158 s) | wiring **7/7 OK** (same placement, bench 0.47, 302 solver ripples -> 1043 packets, glowLight/envMap, perf b24f8e5b, 72 bone tracks); sync identical to v2: key bottom within one frame **30/30**, hammer at the string 23/30 (I-09), fingertip on its key **30/30** (gap p50 0.07 mm, max 0.27), dampers 30/30 + 13/13, pedal vs CC64 r = 1.000, right foot vs pedal r = -1.000 (12.1 mm); the probe's -140 ms key-bottom minimum is two fast repeated notes whose key was already down (I-15), not a sync error |
| ripples | same run, after each of the 54 stills | 2,124 ring packets, 855 from the solver, world position error **0.000 mm** in every still (16 different rig cheats; the 1,240 mm in v2 was the check's own matching bug, fixed); 119/130 solver events of the last 1.5 s are in the water, the 11 missing ones all in S20-S23 where the 40-packet cap is full (I-10) |
| stills + refs | `.venv/Scripts/python.exe sandbox/integration/contact.py sandbox/integration/out/v3` and `tools/compare.py .../v3/pairs.json .../v3/compare` | `out/v3/contact_1..4.jpg` (first + middle frame of all 27 shots, ref beside each of the 13 shots that realise one); compare.py mean **55.9** over 26 pairs (v2 55.4; S06/ref12 +3.6..4.1, S24/ref12 +1.7..3.0, rest within +-1; best S10/ref9 67.5, S19/ref3 67.1, S17/ref4 64.5; lowest S09/ref8 43.5). New module issues I-12 (overhead claw fingers), I-13 (black blotches in the water from above), I-14 (wide case side satin, not mirror), I-15 |
| determinism, pre-roll 3 | `node render/determinism.mjs --preroll 3 --frames 1519,2269,10334 --size 1920x1080 --N 16 --out sandbox/integration/out/det2` | **PASS**: identical across sessions A / B / C (fa804279.., c60198f5.., 35a22327..), frames differ from each other |
| determinism, no pre-roll | same without `--preroll` -> `out/det_nopre` | FAIL (A != B on all three, B = C on 10334): I-11 still in the piano |
| 40 s animatic segment with audio | `node render/film.mjs render --preset animatic --from 3600 --to 6000 --chunks build/chunks/animatic_integ2 --per-session 4` + `encode` (section 3) -> **`build/out/animatic_segment.mp4`** (perf run C; renamed `animatic_segment_integ2_runC.mp4`, 8.2) | 2,400 frames, 640x360 N=1, S06 -> S07 -> S08 -> S09 -> S10 -> S11 (5 cuts), one session (init 1.7 min, 0.14-0.24 s per frame). encode: ALL CHECKS PASSED (60/1, frame identity 2,400 testable / 0 violations, H.264 PSNR 45.1, RGB vs source 36.8 dB vs 35.0 with the wrong matrix, audio onset error 0 ms, lag 0, correlation 1.00). Looked at (`out/animatic_segment_integ2_sheet.jpg`, `out/clips/animatic_segment_strip.jpg`): every cut on a new framing, no broken frames. Luma spikes at 5885-5891 (2-frame strobing of the water in the fast S11 crane, also in the integ1 cut) are N=1 temporal aliasing: the same frames at 1080p N=16 final are smooth (`out/flick_s11`, MODULE_ISSUES I-16) |
| render time | per still in `out/v3/stills.json` | 1080p N=16: 1.09-4.47 s per frame (median 1.90, mean 1.85; v2 mean 1.69; non-Afterglow GPU jobs ran alongside) |

**Render-time estimate (full film, each shot's own N, page time).** `out/estimate.json` (v2 + t1440 + the size factors)
gives 1080p 9.1-11.1 h, 1440p 7.6-9.3 h (size factor 0.84, i.e. 1080p within the noise), 2160p 15.5-19.0 h. The same
model fed with the v3 per-shot timings gives 1080p 13.0 h, 1440p 10.9-13.0 h, 2160p 22.2 h (all-N16 1080p 6.9 h).
So: **1080p 9-13 h, 1440p 7.6-13 h, 2160p 15.5-22 h**, plus ~2.5 min session start per chunk group and whatever else
runs on the GPU. ~~1440p is the safe final resolution for a 12-16 h window.~~ **Superseded by section 7** (the 1440p
factor does not reproduce; 1080p is the recommended final).

**Not for approval:** everything rendered in sections 5 and 6 (integ1, integ2, both test clips, both animatics, out/v2
and out/v3 stills) uses perf run C (b24f8e5b). build/anim has held run f1k (71e9df37) since 04:22, and run C has film-wide
defects that f1k fixes (65 of 175 fast re-strikes lift only 17-19 % of the dip, MODULE_ISSUES I-15; 12,642 vs 719
finger pops, I-37). Do not send stills from integ2 to the user; the next integrated snapshot (integ3) must carry f1k
and a camera hand track solved from it (section 7).

**Open before the final render** (state 2026-10-22 04:20): the two 1080p N=16 test clips are from `integ1` (before the
piano 01:39 / pianist 02:00 changes; integ2 is covered by v3, det2 and the animatic segment); I-11 (piano history) is
mitigated by the 3-frame pre-roll, not fixed; the look issues I-03..I-08 and I-12..I-14 are with the module owners
(`sandbox/integration/MODULE_ISSUES.md`); the user's stills approval (USER_FEEDBACK item 5) comes before the full render;
freeze a new snapshot of whatever the modules hand in and render from it (section 3).

## 7. Fix round 3 (2026-10-22 05:30-, integration defects from the round-3 critics: look, tech, sync)

Module defects of the same critique are in `sandbox/integration/MODULE_ISSUES.md` round 3 (I-17..I-37, corrections to
I-10 / I-15); this section covers what the integrator owns.

### 7.1 Film grade: a hand-built film LUT (was: none)

Defect: shadows and low mid-tones carried a strong magenta/violet cast (median RGB chroma of display luma 2-15:
15-22 vs the refs' 3-8; close-ups at luma 15-40: 27-35 vs 15-21); `GRADE_PRESETS.default = {}` and the session LUT
was identity although DESIGN.md section 6 specified one.

What was built (`sandbox/integration/lut/`):
- `gradelib.py`: the grade, display-encoded sRGB in -> out (the LUT slot after PBR Neutral): OKLab chroma x
  `k(L) = s + (1-s) smoothstep(L0, L1, L)` with hue and OKLab lightness kept (shadow desaturation), plus a highlight
  term above OKLab `Lh` (chroma x `1 + hc ramp`, optional hue pull `hp` toward the DESIGN.md peach #FEC08A),
  `ramp = smoothstep(Lh, Lh + 0.2, L)`; trilinear lattice application exactly as the shader does it.
- `fit_grade.py`: grid over the parameters on the 26 stills of `out/v3` that realise refs (half size), each candidate
  baked into a 33^3 table and applied by lattice interpolation, scored with `tools/compare.py` and the critics' limits
  (luma 2-15 chroma <= max(8, ref); close-up luma 15-40 chroma <= max(20, ref); luma <= 4 fraction not above the
  ungraded one + 0.5 points; p1 not lower). Leave-one-ref-out: the rule is re-run without each ref and scored on it.
  Shadow stage (48 candidates, `fit_coarse.json`): best s 0.2 / L0 0.10 / L1 0.34, mean 55.78 -> 58.17, LORO 57.96.
  Highlight stage (24, `fit_hi.json`): hue pull hurts (hp 0.6: -0.2..-0.5), chroma gain helps (hc 0.15 +0.31,
  hc 0.3 +0.36, Lh 0.6 best), LORO 58.53 (same candidate in every fold).
- Pick (`bake_lut.py`): **s 0.3, L0 0.14, L1 0.34, hc 0.15, Lh 0.6, hp 0** -> `scene/src/core/luts/afterglow_film.cube`
  (title "afterglow film v1", sha256 27c3998b...). Within 0.1 of the best-scoring candidates, chosen for the look
  targets: at the refs' own size the s 0.2 candidate puts the S24 close-up at luma-15-40 chroma 21 (> 20) and leaves the
  shadows more neutral than the refs (OKLab C 0.009 vs refs 0.016); hc 0.3 overshoots the peach highlights (blue channel of
  the brightest 0.5 %: S23 112 vs ref 142, S19 138 vs 147), hc 0.15 lands on the refs (S10 142/152, S17 138/138,
  S19 148/147, S24 144/145, S04 150/150). Offline on the 26 v3 stills at ref size (`lut/eval_film_v1_offline_v3.json`):
  compare.py mean **55.92 -> 58.52**; luma 2-15 chroma max **22 -> 7** (median 20 -> 5.5; refs 6, max 15); close-up
  luma 15-40 chroma max **35 -> 19**; OKLab shadow chroma 0.043 -> 0.012 (refs 0.016); luma <= 4 fraction 18.3 -> 17.6 %
  mean (no crush), p1 1.12 -> 1.20; biggest gains S25 +20 (ref 1, blue hour), S06 +3.5, S24 +3, S03 +2.5, S09 +2.1;
  small losses S20 -0.8/-0.9 (ref 6's shadows are bluer), S19 mid -0.3. Sheet: `lut/film_v1_offline_sheet.jpg`.
- Blacks: the max-channel <= 4 fraction rises where the shot already had more black than its ref (S04 34 -> 51 %, ref
  35 %; S09 20 -> 42 %, ref 23 %) because a near-black magenta pixel (e.g. 11,2,14, luma ~4) becomes neutral at the same
  lightness (~4,4,4). Its luminance does not change: the luma <= 4 fraction falls (S04 60.1 -> 58.1 %, ref 46 %). The
  extra black area in S04/S09 is the scene (suit, case), visible now that the magenta no longer hides it.
- Not done on purpose: no free 3D LUT fitted to the refs. The tech critic's iterative-distribution-transfer LUT gave
  55.9 -> 56.5 leave-one-ref-out and crushed close-up blacks (S04 34 -> 43 %); the per-pair oracle reaches only 67.9, so
  the remaining gap (water reflections, mountains, clouds, lacquer: I-17..I-22, I-26, I-29) is in the scene.

Wiring (`scene/src/main.js`): `FILM_LUT_URL = './core/luts/afterglow_film.cube'` is the session LUT of every session
unless `AG.init({ lut })` says otherwise (`'identity'` / `null` / `false` = none, a URL / .cube text / Float32 table =
that LUT); `AG.setLUT('film' | 'identity' | ...)`; `AG.info().lut` = `{ title, size, src }`. So it applies to every shot
whatever grade preset or per-shot grade object (the edit's exposureEV fades) a shot uses; `debugView: 'nolut'` shows a
frame without it. `render/selftest.mjs` pins `lut: 'identity'` for its baseline and hands its test LUTs to the page as
.cube text (it failed under `AG_SERVE_ROOT` because the snapshot has no `build/selftest/`): **PASS** on `integ2dof`.

### 7.2 DOF gap-fill scaled with CoC / sqrt(N)

Defect: thin out-of-focus highlights render as chains of discrete beads (S11 at N=32: 2 rows ~11 px apart on the cheek).
`scene/src/core/accum.js`: the per-sub-frame pre-blur is now a Gaussian of sigma `0.5 * preblur * CoC / sqrt(N)`
(truncated at 2.5 sigma; about half the spacing of N aperture samples on a CoC-wide disk), was a flat disk of radius
`preblur * CoC / (2 sqrt N)` (half that sigma); `preblurKernel: 'disk'` keeps the old kernel for A/B checks.
A/B, same snapshot, same history (`build/snap/integ2dof`, `sandbox/integration/jobs/dof.json` -> `out/dof`, `dofcheck.py`):

| S11 f5981 (65 mm f/8, N=32, preblur 1.1), cheek highlight crop x 1560-1920, y 950-1060 | row high-pass rms (bead ripple) | result |
|---|---|---|
| legacy disk | 5.19 | two rows of discrete round beads ~11 px apart (`out/dof/s11_cheek_disk_gauss_N128.png`) |
| new Gaussian | 4.76 | no discrete beads: one continuous band with a fine horizontal dash texture |
| N=128 (reference, same history) | 4.23 | continuous, slightly beaded |

Whole frame vs N=128 (luma mean abs error): S11 1.59 -> 1.58, S06 0.73 -> 0.77, S24 1.24 -> 1.32 code values; in-focus
areas are identical. In all three shots the worst 64-px tiles (error 16-72 code values) sit on the lacquer kicker and
edge highlights, whose position itself changes with N (piano I-30 / I-32), not on defocused areas
(`out/dof/dof_<shot>_crops.png`). Page time per frame, single frames on the shared GPU: S11 3.19 vs 3.35 s, S06 4.13 vs 4.06 s,
S24 13.7 vs 10.9 s (S24's gather radius is clamped at maxPreblurPx 32 px, 2.5x the old reach: the 48 taps spread wider, so a
cost increase in the near-macro shots is plausible; re-measure in the idle-GPU probe).

### 7.3 Render-time estimate and the final resolution (supersedes sections 5 and 6)

Defect: the round-2 1440p factor 0.84 does not reproduce, the totals left out the session starts, and "1440p fits
comfortably" was not supported. `node sandbox/integration/estimate.mjs` -> `out/estimate.json` (round-2 copy
`out/estimate_round2.json`) now uses:
- size factors from the round-3 tech critic's same-frame own-N sessions (8 frames, pre-roll 3,
  `build/qc/integration_tech/{A,B,C}/results.json`): 1440p / 1080p 1.05-1.28 per frame (sum 1.18; slower in all 8),
  2160p / 1080p 1.47-2.82 (sum 1.98, median 1.83);
- a sustained-cost band from 30-frame own-N sequences: 0.63 (quiet GPU, S03 N16) .. 1.15 (busy GPU, S07 N32) x the
  per-still model;
- session starts of 65-180 s; `film.mjs render` final presets now default to `--per-session 4` (12 starts for the film
  instead of 47, which alone cost 0.8-2.4 h).

| plan (sub-frames) | 1080p | 1440p | 2160p |
|---|---|---|---|
| the edit's own N (404,392; 29.2 per frame) | **7.8-14.5 h** (model 12.1) | 9.2-17.0 h (14.2) | 15.3-28.1 h (23.9) |
| camera I-28: wides N32, S10/S11 N48 (500,936) | 9.2-17.0 h | 10.8-19.9 h | 18.0-33.1 h |
| same, macro N48 -> 32 after the kicker fix (464,520) | 8.4-15.6 h | 9.9-18.3 h | 16.4-30.2 h |

Page time incl. session starts, nothing else on the GPU assumed. **Recommendation: render the final at 1080p.** Choose
1440p only if the idle-GPU probe projects <= 14 h for the chosen N plan; 2160p is dropped. The probe
(`sandbox/integration/sizeprobe.ps1`, one session per size rendering the same 2 real chunks 7200-7800 at the final
preset, summarised by `sizeprobe.mjs`) has **not been run**: it needs an idle GPU and the frozen final snapshot, i.e. it
runs right before the final render.

### 7.4 The reviewed film is not the current performance (integ3)

Defect: every integrated render and check (integ1, integ2, test clips, animatics, out/v3) used perf run C (b24f8e5b);
build/anim has held f1k (71e9df37) since 04:22, plus newer pianist/piano files.
- State at 10:40: `build/anim/perf.json` = f1k (`perf/solve.mjs --out sandbox/perf/out/f1k`, sha256 71e9df37...);
  `scene/src/camera/handtrack.json` = run C (b24f8e5b). The camera fix round is deferred by the night plan, so the
  precondition for integ3 (a hand track solved from f1k, MODULE_ISSUES I-27) is not met and **integ3 was not frozen**.
- Guards so this cannot slip through again: `render/snapshot.mjs` refuses a tree whose handtrack perf sha differs from
  `build/anim/perf.json` (exit 3, `--allow-stale-handtrack` to override, result in SNAPSHOT.json); wiring check 8 in
  `scene/src/integration/index.js` ("camera hand track solved from the rendered performance"); `check.mjs` now reads
  the edit, piano layout, score and perf metadata from the served snapshot (`AG_SERVE_ROOT`), not from the live repo
  (against integ2 it would have matched f1k ripples to run C water since 04:22).
- Corrected statements: sections 5 and 6 mark every integ1/integ2 output "not for approval"; MODULE_ISSUES I-15 (film-wide,
  65 of 175 re-strikes in run C, fixed by f1k) and I-10 (cap full in 63 % of the frames, not only the climax).
- Ready to run when the camera hands in the f1k track: `pwsh -File sandbox/integration/queue_integ3.ps1` = snapshot
  integ3 (gated) -> check.mjs out/v5 (wiring 8/8, sync 30, ripples, stills) -> determinism `--preroll 3` (out/det3) ->
  test_hands + test_wide (1080p N16, film audio) -> 40 s animatic segment -> contact sheets, compare.py, clipreview.py
  (incl. the local temporal-noise metric). Only stills from integ3 or later go to the user.

## 8. Fix round 4 (2026-10-22 14:55-, integration defects from the round-4 critics r2 on the live tree "live2")

Module defects of the same critique: `sandbox/integration/MODULE_ISSUES.md` round 4 (updates of I-08, I-12, I-13/19/22,
I-17, I-18, I-20, I-21, I-22, I-23, I-26, I-29, I-31, I-32, I-34, I-35, I-37; new I-38..I-44). This section covers the
integrator-owned defects. Every number below names the snapshot it was measured on.

### 8.1 GPU safety: a third 0x119, and the user's other projects

The machine bluescreened a third time (System event 1001, bugcheck 0x119, 2026-10-22 18:27) while **no Afterglow job
ran** (no file under `afterglow/` was written between 16:15 and 18:49; all agents had been stopped at ~16:12). The user's
other projects (Claude Code sessions of their own) render headless Chrome / Remotion on the same 780M
through their own wrapper (`heavy.mjs`), outside our lock. `render/lib/gpulock.mjs` now:
- **joins their machine-wide lock** `<their lock dir>/.gpu.lock` (their documented protocol: exclusive create, the
  holder's pid as text, a lock whose pid is gone is stale). A taker holds our slot first, then waits for and takes that
  lock (order slot -> shared, so no cycle: they take only the shared one), and both are released together. Their jobs are
  capped at 10 min, so our wait is short; their wrapper waits up to 3 h behind an Afterglow hold. `AG_GPU_SHARED_LOCK`
  overrides the path ('' = off); nothing is created when the folder does not exist. In the published code the lock has
  no default: unset, with no `build/locks/shared-lock.path`, means no shared lock. On the build machine that untracked file
  (and the launchers' `AG_GPU_SHARED_LOCK`) names the lock file.
- **waits for foreign active headless GPU jobs** that hold no lock at all: when a slot is free, the taker samples the GPU
  processes whose browser runs `--headless` (or is a `*headless*` executable) over 4 s and gives the slot back while one
  uses > 0.4 s CPU (idle leftovers do not count; the user's desktop Chrome / Electron apps are never headless).
  `node render/lib/gpulock.mjs foreign` prints both. `AG_GPU_FOREIGN=0` disables it.
- Tested in scratch lock dirs: a live shared holder -> the taker waits, then times out and frees our slot; a dead holder ->
  reclaimed; the child sees our pid in the shared lock; it is removed on exit; an idle software headless Chrome is ignored,
  an active one makes the taker wait (timeout message names it). In production the guard caught another project's headless
  Chrome at 21:00 and the dof4 session waited for it.
- **FIFO**: waiters queue with tickets (`build/locks/queue/<ms>-<pid>.ticket`, touched on every poll; a dead or untouched
  (> 60 s) ticket is skipped), and a free slot goes to the oldest live ticket. Before, the slot went to whichever waiter
  polled first after a release (the dof4 A/B waited 1.5 h behind a stream of fresh arrivals). Tested with three processes
  in a scratch lock dir (order kept, queue and slots empty afterwards). Processes that loaded the module earlier keep
  polling without a ticket.
- **Mid-hold foreign watch** (2026-10-23 04:05). The foreign check ran only when a slot was taken, so a foreign renderer
  that starts while we hold the slot ran next to us for its whole length. Seen at 04:00: another project's
  `node shot.mjs out/c1_5.png spp=1&hres=4096...` (headless Chrome, under `timeout 3600`, no lock) rendering next to the
  Afterglow holder; and page times of the same frames on the same snapshot varied 0.5-2.2x between sessions (8.6).
  `startForeignWatch()` in `render/lib/gpulock.mjs` probes asynchronously every 15 s (60 s until 07:15) while a session holds the slot;
  `render/lib/session.mjs` calls `waitIdle()` before every frame and pauses OUR rendering (slot kept, so no other
  Afterglow job starts) until the foreign job is idle (max 3 h, then it resumes and says so); our own browser (a child
  of the session process) is never counted. Pixels and page timings are unaffected; the pause is logged. Tested without
  the GPU (`scratchpad fw_test.mjs`): it detected the then-holder's Chrome as foreign from a process that does not own
  it, paused, re-probed every 10 s and resumed at the limit. We never kill the foreign process.
  In production (cost4-cost8, 2026-10-23 04:29-07:24) it paused 4 of 5 sessions for 11-135 s each: foreign headless
  Chrome renders of the user's other projects (e.g. `node tools/shot.mjs qa/dv_spotsm 960 540 3.6` under `timeout 300`,
  no lock); our own browser (a child of the session's node process) was never flagged (checked: the probe lists our
  holder's Chrome with `browserParent` = the session pid, which the watch excludes). The probe interval is now **15 s**
  (was 60 s; a foreign job ran up to ~60 s next to our frames before the pause), `AG_GPU_FOREIGN_EVERY_S` overrides it.

### 8.2 integ3: the reviewed film is the current performance, with film-wide gates

- `build/snap/integ3` (13:00, hash 0fe31f984fee6195): perf **f2c** (`5d8ca794`), the camera hand track solved from it.
  `render/snapshot.mjs` now **solves the snapshot's own hand track** from the snapshot's perf with the camera's tool when the
  copied track does not match, so a perf ship can no longer strand a freeze (verified identical hand data to the camera's
  14:48 track). `integ3c` = integ3 + the integration overlay with the LUT v2 pair (hash c2dad5d3b262facc; DOF A/B);
  `integ3d` = integ3 + the final round-4 overlay (layered DOF default, LUT v2 pair; hash bee83ba1c03a8262; contact sheet v5,
  determinism, review clips). Each number below names its snapshot.
- `sandbox/integration/gates.py` (CPU, run by `check.mjs` before the session, on the served snapshot's perf): restrike
  (rise >= 50 % of the dip), flicks (0 one-frame flicks > 12 deg on a readable hand), keyonset (key bottom within one frame
  of every note-on), handtrack (track sha = perf sha), **motionstep** (new: `sandbox/integration/blurstep.mjs`, fastest
  fingertip/knuckle copy spacing at the shot's own N; <= 6 frames > 2 px, none > 2.5 px). integ3c: restrike OK (175, min
  rise 0.565), **flicks FAIL** (130 / 45 / 20 frames > 8 / 12 / 15 deg; S21 15, S15 8, S13 6 = perf I-37, open), keyonset OK
  (1131/1131, -9.96..+13.05 ms), handtrack OK, motionstep OK (4 frames > 2 px: S08 f4263 2.17, S16b f7747/7748 2.22/2.30,
  S22 f11274 2.43; the camera has since put S21/S22 at N48 on the live tree, I-44).
- Stale deliverables are named by provenance so nobody reviews run C by mistake (2026-10-23 07:10): `build/out/
  test_wide_integ1_runC.mp4`, `animatic_integrated_integ1_runC.mp4`, `animatic_segment_integ2_runC.mp4` (+ their
  `.verify.json` / `.concat.txt`), next to `test_hands_integ1_runC.mp4` and `animatic_segment_integ1.mp4`. The current
  reviewed clips are `build/out/test_hands.mp4` and `build/out/test_climax.mp4` (integ3d, review-1080p own N, 8.4); the
  current full-film animatic is the camera's (`sandbox/camera/out/anim9`, live modules). Not re-rendered: test_wide (S03
  temporal noise is measured from the own-N S03 sequence of every check instead, 8.7).

### 8.3 DOF gap-fill: 'layered' near-field-aware pre-blur (default; 'disk' / 'gauss' kept for A/B)

Defects: (a) S24 f12351 (ref 12): a defocused lacquer edge 10 cm from the lens rendered as a fan of discrete parallel
lines, because the round-3 gather blurred each pixel with its OWN CoC, so a near highlight landing on sharp far pixels was
never smoothed (plus a 32 px cap); (b) the round-3 Gaussian gather (48 Vogel taps sized to the shot-global reach) was
undersampled: dash / lattice texture on thin defocused highlights, worse than the legacy disk against N128, and slower.
`scene/src/core/accum.js` `preblurKernel: 'layered'` (per sub-frame, sigma = 0.5 x preblur x CoC / sqrt(N) as before):
- prep: colour + SIGNED sigma per pixel (+ in front of the focus plane) -> `csRT`;
- base layer: everything behind focus and near pixels with sigma < 2 px, separable normalised scatter-as-gather where every
  pixel is a tap with its OWN normalised 1-D Gaussian (dense, no lattice; a farther/blurrier tap cannot bleed over a sharper
  pixel beyond that pixel's reach), sigma capped at 8 px;
- near field: pixels in front of focus split over sigma levels 2, 4, 8, 16, 32 px (tent weights in log2 sigma), each
  level premultiplied (colour x w, w) at 1/2^(k-1) resolution and blurred by a plain separable Gaussian of 2 texels, so a
  near highlight is blurred by ITS sigma wherever it lands (the root cause of (a));
- composite: near over base by coverage, added into the accumulation with weight 1/N. `maxPreblurPx` 32 -> 96.
A/B on integ3c, same snapshot and history (`jobs/dof4.json` -> `out/dof4`, `dofab4.py`; reference N256 without pre-blur;
error = 5x5 high-pass rms of the luma error vs N256, "bright" = pixels with reference luma > 80):

| frame (N) | crop | disk | **layered** | note |
|---|---|---|---|---|
| S24 f12351 (48) | critic box x608-928 y640-832 | 2.81 | **1.31** | the lacquer edge line: layered is sharp like N256, disk soft |
| S24 f12351 (48) | whole frame, bright | 8.19 | **6.99** | |
| S24 f12351 (16) | whole frame, bright | 10.43 | **7.51** | disk N16 prints a dotted line pattern in the dark corner, layered not |
| S06 f3583 (48) | desk box x896-1152 y128-320 | 4.69 | **3.91** | defocused hand edge: disk stair-steps, layered smooth like N256 |
| S06 f3583 (48) | whole frame, bright | 3.36 | **2.71** | |
| S11 f5981 (48) | whole frame, bright | **9.77** | 10.36 | both bead the sparkling desk edge (I-32 shading aliasing, also speckled at N256) |
| frame mean abs error | S06 / S11 / S24 | 0.42 / 0.43 / 0.34 | **0.38 / 0.39 / 0.28** | |

Page time per frame (single frames under the lock): S06 3.86 -> 5.01 s, S24 4.30 -> 4.81 s, S11 4.25 -> 4.30 s, S13
3.43 -> 3.65 s (+1 % .. +30 %, largest where near levels up to 16 px are needed). The critic's acceptance "S24 page time
not above the disk's" is **not met** (+12 %), nor "bright error <= disk on S11" (+6 %, on the I-32 sparkle edge, not DOF);
the layered kernel is the default anyway because it removes the discrete-copy artefacts that are visible in the ref-12 hero
shots and at N16, and its cost is limited to the DOF shots. The other two acceptance items of the round-4 tech critic:
"S11 cheek d2v <= 9" cannot be measured any more on the current modules (the f5981 cheek crop holds no defocused highlight:
d2v 0.85 disk / 0.85 layered / 0.89 N256); "no lattice on the S06 desk edge": the dotted desk-edge highlight is in the N256
reference as well (`out/dof4/dofab4_S06_f3583_desk.png`), i.e. lacquer shading aliasing (piano I-32), not the gap-fill;
layered is closer to N256 there than disk (crop error 3.91 vs 4.69, d2v 4.9 vs 9.1). On integ3c the S24 f12351 corner no longer contains the
near-lens cheek (the camera's S24 path moved 2.3 cm up since integ2), so the streak case itself is re-tested on
`integ2L` (integ2 modules + the current integration overlay; `jobs/dof4s.json` -> `out/dof4s`).

**The streak case (dof4s on integ2L, 2026-10-22 23:28; `out/dof4s/dofab4.json`, sheet `out/dof4s/dofab4_S24_f12351_corner.png`).**
S24 f12351, lower-right corner where the lacquer cheek edge sits ~0.1 m from the lens; "d2v" = fine 1-px vertical second
difference (line structure), crop error vs N256:

| S24 f12351 corner | d2v | 5x5 high-pass error vs N256 | look |
|---|---|---|---|
| disk, N48 (production N) | 9.17 | 5.34 | the amber fan of discrete parallel lines (the critic's "light-saber") |
| **layered, N48** | **0.95** | **4.47** | one soft amber out-of-focus mass, no lines (ref 12's dark soft mass) |
| disk, N16 | 17.04 | 7.85 | lines, stronger |
| layered, N16 | 3.80 | 4.71 | soft mass with a few short residual strokes |
| N256, no pre-blur (reference) | 11.29 | 0 | still line-structured: even 256 aperture samples do not fuse an edge 10 cm from the lens |

Acceptance "no discrete lines in the S24 f12351 corner at N=48": **met** with 'layered'. Page time S24 N48 disk 3.73 s /
layered 4.39 s (+18 %), N16 1.65 / 1.53 s (single frames). Whole frame vs N256 (mean abs): disk 1.28, layered 1.19.
The module-side alternative (no kicker/edgeLine on lacquer < 0.25 m from the lens) is therefore not needed for this
shot; it stays noted for piano/camera in MODULE_ISSUES (near-lens note).

### 8.4 Motion review at each shot's own N, and a per-frame motion N boost

Defect: every motion review (test_hands, v3 stills, clip review) used N=16, so close-ups that the film renders at N32/48
were reviewed with banded multi-exposure hands; at each shot's own N a few frames still put the copies > 2 px apart.
- `scene/src/film.config.js` preset **`review-1080p`** (N null = each shot's own N); the N=16 presets are documented as
  wiring / sync only. Rendered on integ3d (perf f2c, layered DOF, LUT v2), each under the GPU lock in one session:
  `build/out/test_hands.mp4` (1920-2520, S04 N32) and `build/out/test_climax.mp4` (10840-11320: S20c N48, S21 N32,
  S22 N32), both **ALL CHECKS PASSED** (frame identity 600/600 and 480/480, RGB PSNR 37-39 dB, audio onset 0 ms; the
  run-C clip is archived as `build/out/test_hands_integ1_runC.mp4`). Reviewed (`sandbox/integration/clipreview.py` ->
  `out/clips5/`): hands clip max frame-to-frame luma step 0.51 (no flicker), the run-C defects at f2101 (one-frame flick),
  f2424/2425 and f2446 (ghost thumbs) are gone (`out/clips5/hands_own_n_zoom.jpg`; f2446 is a smooth motion smear).
  The climax clip still shows the stepping the critic predicted: S22 f11273/11274, the fast left hand at N32 is a striped
  multi-exposure (`out/clips5/climax_step_zoom.jpg`; blurstep: 2.43 px copy spacing at f11274).
- **Fix: motion N boost.** `sandbox/integration/blurstep.mjs --boost-out <tree>/scene/src/integration/motion_n.json
  --target 1.0` projects the perf FK fingertips and knuckles of both hands through the edit camera at t -+ 1/240 s
  (the 180-degree shutter) for every frame of the hand shots and writes, for each frame whose copy spacing at the
  shot's own N exceeds 1 px, N = the next multiple of 16 that brings it to <= 1 px (max 128), keyed to the perf sha
  and each shot's edit N. `scene/src/main.js` (`MOTION_N_URL`) applies it in final-quality renders whose session and
  frame do not force N (so the N=16 checks, previews and A/B jobs with an explicit N are unchanged); `renderFrame`
  returns `nBoost {from, to}`, `AG.info().motionN` summarises the table. A table whose perf sha or edit N does not match
  is ignored by the page and fails **integration wiring check 9** ("motion-blur N boost solved from the rendered
  performance and edit"). `render/snapshot.mjs` re-solves the table inside every snapshot (like the hand track), so a
  perf ship or a camera N change cannot leave a stale one in a frozen render.
- Size: integ3e (integ3 modules + perf f2c) 112 frames, +2,528 sub-frames (+0.49 % of 517,536); integ4 (live modules,
  perf f3c 911e8991, camera S16b 64, S21/S22 48) 103 frames, +2,384. Biggest boosts: S08 f4263 and S16b f7747/7748 48 ->
  112, S22 f11274 32 -> 80, f11273 32 -> 64. Copy spacing at the rendered N on integ3e: max **1.00 px**, 0 frames
  > 2 px (own N alone: 4 frames > 2 px, max 2.43); `gates.py` motionstep now gates on the rendered N (no frame > 2 px,
  max <= 1.5 px): **OK** on integ3e.
- GPU A/B on integ3e (own N forced vs the table, same session, 3-frame pre-roll; `jobs/motionN.json` -> `out/mn`,
  `mnab.py` -> `out/mn/mnab.json`, 2026-10-23 02:29): **wiring 9/9 OK** (check 9 = the new one), `AG.info().motionN` =
  112 frames, perf 5d8ca794 ok. S22 f11273 32 -> 64 and f11274 32 -> 80: the striped multi-exposure of the fast left hand
  fuses (`out/mn/mn_f11274.png`; luma second difference in the hand box d2h/d2v 5.85/5.28 -> 4.39/3.80, f11273 5.50/5.52 ->
  3.91/4.29); page time 3.35 -> 7.98 s and 3.69 -> 6.91 s for those frames. S16b f7748 and S08 f4263 (48 -> 112): the
  fast point blurstep found (left thumb / little finger at the frame edge) changes no visible hand area; the largest
  differences are lacquer glints that sparkle at any N (piano I-32; `out/mn/mn_S16b_S08_hand.png`), so these two boosts cost
  ~5 s per frame for nothing visible (accepted: 4 frames). A frame without a boost (S22 f11212) is **bit-identical** with
  and without the table.
- Not done: a velocity-aligned gap-fill in `core/accum.js`. It would need per-sub-frame screen motion of the skinned
  hands (previous bone matrices in the pianist's materials, i.e. module code); raising N on ~110 frames costs 0.5 %
  and converges to the same image.

### 8.5 Film LUT v2: gamut-aware highlights + a wide / blue-hour class LUT

Defects: (a) the v1 highlight chroma gain pushed red out of gamut (273 of 35,937 lattice entries hard-clamped at 1.0;
sunset glow 247-251 -> flat 255 plateaus; close-ups clipped one channel far more often than their refs); (b) the v1 shadow
desaturation (s 0.3) turned the wides' dark hills, piano and near water neutral grey-black where the refs keep navy/plum.
- `gradelib.py` `gm`: the highlight chroma boost saturates smoothly (OKLCh) below the chroma at which a display channel
  reaches `gm` = 0.98 -> **0 clamped lattice entries** (v1 273). Same parameters otherwise.
- Two tables, chosen per shot class in `scene/src/main.js` (`FILM_LUT_CLASS.wide` = S01, S03, S05, S10, S17, S19, S20,
  S23, S25; only on top of the film LUT, not with `lut: 'identity'` or a custom session LUT):
  `core/luts/afterglow_film.cube` "afterglow film v2 close" (s 0.3, L0 0.14, L1 0.34, hc 0.15, Lh 0.6, gm 0.98) and
  `core/luts/afterglow_film_wide.cube` "afterglow film v2 wide" (s **0.5**, rest equal; the refs' OKLab shadow chroma
  0.016-0.029, mean 0.020, vs ungraded 0.043 -> s ~0.47). v1 is kept as `sandbox/integration/lut/afterglow_film_v1.cube`.
  A blue-hour hue pull for S25 was tried and rejected (compare 74.5 -> 70.8-72.7).
- Offline before/after with the shipped .cube files on the 26 ungraded integ2 stills that realise refs
  (`fit_v2.py out/v3/pairs.json --shipped --cands none` -> `lut/ab_v1v2_v3.json`; ref-size compare.py, 1920-wide metrics):

| shot (ref) | dark chroma ungraded / v1 / **v2** / ref | clip % any channel >= 254.5: ungraded / v1 / **v2** / ref | compare v1 / **v2** |
|---|---|---|---|
| S01 (10) | 22.0 / 6.5 / **10.9** / 16.0 | 0.00 / 5.65 / **0.00** / 1.51 | 50.2 / 50.0 |
| S03 (2) | 20.8 / 5.8 / **10.0** / 8.2 | 0.00 / 3.37 / **0.00** / 2.13 | 57.8 / 57.1 |
| S05 (11) | 17.3 / 4.7 / **8.0** / 7.9 | 0.01 / 2.11 / **0.01** / 0.79 | 56.6 / 56.4 |
| S10 (9) | 18.7 / 5.0 / **8.7** / 7.9 | 0.01 / 1.26 / **0.01** / 0.85 | 65.5 / 65.5 |
| S17 (4) | 21.7 / 6.5 / **10.6** / 9.4 | 0.00 / 1.75 / **0.00** / 1.21 | 64.3 / 64.5 |
| S19 (3) | 20.3 / 6.1 / **10.0** / 7.0 | 0.03 / 1.18 / **0.03** / 1.00 | 59.8 / 59.9 |
| S20 (6) | 16.1 / 4.3 / **7.4** / 12.6 | 0.00 / 0.00 / **0.00** / 0.85 | 56.5 / 57.4 |
| S23 (5) | 18.4 / 5.4 / **9.0** / 11.9 | 0.00 / 0.76 / **0.00** / 0.96 | 56.0 / 56.4 |
| S25 (1) | 20.5 / 5.6 / **9.3** / 13.1 | 0.00 / 0.00 / **0.00** / 0.46 | 74.5 / 72.1 |
| S04 (7) close | 17.6 / 4.4 / **4.4** / 4.1 | 0.01 / 1.79 / **0.01** / 0.39 | 60.4 / 60.4 |
| S06 (12) close | 20.1 / 5.3 / **5.3** / 5.0 | 0.07 / 1.21 / **0.07** / 0.06 | 60.8 / 60.6 |
| S09 (8) close | 20.2 / 5.1 / **5.1** / 5.8 | 0.00 / 0.35 / **0.00** / 1.11 | 45.7 / 45.6 |
| S24 (12) close | 20.2 / 5.8 / **5.8** / 5.0 | 0.06 / 0.27 / **0.06** / 0.06 | 53.1 / 53.1 |
| **mean of 26 pairs** | | | **ungraded 55.92, v1 58.55, v2 58.38** |

  Dark chroma = mean RGB max-min of luma-2-15 pixels (the look critic's grade3 metric). Acceptance: wides 7-12 -> all nine
  in range (v1 4.3-6.5); close-ups unchanged; clip share at most the ungraded value + 0.3 points and at most the ref in every
  shot -> met (v2 = ungraded everywhere). The compare.py gain over ungraded is +2.46 (v1 +2.63, 94 % kept); the cost is
  S25 -2.4 and S03 -0.7 (their v1 scores came partly from crushed neutral shadows), S20 +0.9 and S23 +0.4.

**Rendered check on the current modules (v5 = integ3d, own N, 2026-10-22 23:50).** `check.mjs --nolut` writes every
still twice from the same accumulation (as rendered with the session's LUT, and `AG.regrade({debugView:'nolut'})`), so
`fit_v2.py out/v5/pairs.json --nolut-suffix _nolut --shipped` compares the grades without any sampling difference
(`lut/ab_v1v2_v5.json`); "page" = the frame as the page rendered it with the class LUTs:

| shot (ref) | dark chroma none / v1 / **page (v2)** / ref | clip % none / v1 / **page** / ref | compare v1 / **page** |
|---|---|---|---|
| S01 (10) | 20.5 / 5.8 / **9.7** / 16.0 | 0.00 / 6.55 / **0.08** / 1.51 | 48.9 / 48.7 |
| S03 (2) | 16.4 / 4.3 / **7.4** / 8.2 | 0.00 / 3.81 / **0.02** / 2.14 | 58.5 / 58.1 |
| S05 (11) | 13.9 / 3.6 / **6.2** / 7.9 | 0.01 / 2.39 / **0.01** / 0.79 | 57.8 / 57.7 |
| S10 (9) | 17.0 / 4.7 / **8.1** / 7.9 | 0.00 / 1.05 / **0.00** / 0.85 | 65.3 / 65.5 |
| S17 (4) | 16.0 / 4.5 / **7.5** / 9.4 | 0.00 / 1.89 / **0.00** / 1.21 | 63.9 / 64.3 |
| S19 (3) | 17.2 / 5.1 / **8.6** / 7.0 | 0.01 / 1.37 / **0.01** / 1.00 | 64.5 / 64.7 |
| S20 (6) | 14.0 / 3.8 / **6.5** / 12.6 | 0.01 / 0.43 / **0.02** / 0.85 | 47.3 / 47.6 |
| S23 (5) | 17.2 / 5.1 / **8.4** / 11.9 | 0.01 / 1.07 / **0.01** / 0.96 | 58.3 / 58.1 |
| S25 (1) | 15.8 / 4.7 / **7.7** / 13.1 | 0.00 / 0.00 / **0.00** / 0.46 | 63.8 / 60.3 |
| S04 (7) close | 17.1 / 4.2 / **4.3** / 4.1 | 0.00 / 1.72 / **0.00** / 0.39 | 60.9 / 60.7 |
| S06 (12) close | 18.1 / 4.5 / **4.6** / 5.0 | 0.06 / 1.21 / **0.07** / 0.06 | 57.9 / 57.9 |
| S09 (8) close | 16.4 / 3.8 / **3.9** / 5.9 | 0.00 / 0.09 / **0.00** / 1.11 | 42.4 / 42.4 |
| S24 (12) close | 19.1 / 5.1 / **5.2** / 5.0 | 0.05 / 0.18 / **0.06** / 0.06 | 47.1 / 47.3 |
| **mean of 26 pairs** | | | none 54.53, v1 56.64, **page 56.39** |

- The page reproduces the offline application (v2 offline 56.35 vs page 56.39; dark chroma within 0.3).
- Dark chroma in the wides: 7.4-9.7 in seven of nine (v1 3.6-5.8); **S05 6.2 and S20 6.5 sit just under the 7-12
  target** on these modules (their ungraded shadows are less saturated than on integ2: 13.9 / 14.0 vs 17.3 / 16.1). A
  gentler s 0.55 would lift them to 6.8 / 6.9 only and costs S25 another 1.4 points, so v2 stays as baked.
- Clip share: page <= ungraded + 0.08 points in every shot and <= the ref except S06 / S24 (0.07 / 0.06 vs ref 0.06),
  where the ungraded frame is already at 0.06 / 0.05 (lacquer glints clipping in the scene, piano I-32); v1 added up to
  6.5 points (S01).
- compare.py: the grade gain over ungraded is +1.86 (v1 +2.11, 88 % kept). S25 pays most (63.8 -> 60.3): v1 scored by
  turning the blue-hour shadows neutral grey (dark chroma 4.7 vs ref 13.1), which is the overshoot the look critic
  reported, so v2 stays the blue-hour LUT.
- Highlights stay peach and blacks deep: look summary (`lut/look_v5.json`, mean over the 26 pairs) p1 1.29 (ref 0.70),
  p50 46.4 (43.5), p99 166.3 (193.5), HSV saturation 0.483 (0.468), luma >= 250 0.002 % (0.058 %).

**Wide LUT v3 (2026-10-23, on the current modules).** On v7 (integ5 = live modules 07:04, 8.7) the wides' ungraded
shadows are less saturated than on integ2 (dark chroma 12.9-21.2 vs 16.1-22.0), so s 0.5 left three wides under the
7-12 target as rendered: S05 6.9, S17 6.9, S20 5.9 (`lut/ab_v1v2_v7.json`, page column). Sweep on the v7 ungraded stills
(`fit_v2.py out/v7/pairs.json --nolut-suffix _nolut`, `lut/wide_s_v7.json`, `lut/wide_s06_v7.json`), wides only:

| wide s | dark chroma S01 S03 S05 S10 S17 S19 S20 S23 S25 (refs 16.0 8.2 7.9 7.9 9.4 7.0 12.6 11.9 13.1) | in 7-12 | mean \|dc - ref\| | compare, sum of the 9 wide shots |
|---|---|---|---|---|
| 0.5 (v2, shipped until now) | 10.8 8.8 6.9 8.2 6.6 8.4 5.7 8.0 6.9 | 6 / 9 | 3.14 | 533.0 |
| 0.55 | 11.8 9.7 7.5 9.1 7.3 9.3 6.3 8.8 7.6 | 8 / 9 | 2.96 | 531.9 |
| **0.6 (v3)** | **12.9 10.6 8.2 9.9 8.3 10.1 7.0 9.7 8.4** | **8 / 9** (S01 above, toward its ref) | **2.72** | 530.5 |
| 0.65 | 13.9 11.6 9.0 10.8 9.3 11.0 7.8 10.6 9.3 | 8 / 9 | 2.61 | 529.4 |

- Chosen **s 0.6** (the look critic's own suggestion): every wide but S01 lands in 7-12 and S01 (12.9) moves toward its
  ref (16.0); the fit to the refs' shadow chroma improves (2.72 vs 3.14). Cost: compare.py -2.5 over the nine wides:
  S25 -3.0 (60.1 -> 57.1; compare.py prefers neutral blue-hour shadows, the overshoot the look critic reported, as with
  v1 in the table above), the other eight +0.5 together; mean of the 26 pairs 56.64 -> **56.44**, still +1.93 over
  ungraded. Wide HSV saturation (mean of the 9 mid frames, offline) 0.480 -> 0.497 (refs 0.482). Close-ups unchanged (close .cube untouched), clip share unchanged.
- `scene/src/core/luts/afterglow_film_wide.cube` = "afterglow film v3 wide" (`lut/film_v3_wide.json`, sha256 783f1b5b...);
  v2 kept as `sandbox/integration/lut/afterglow_film_wide_v2.cube`. Offline check with the shipped files on the v7 ungraded
  stills: `lut/ab_v1v3_v7.json` (the offline application reproduced the page within 0.1-0.4 compare points and 0.1-0.3
  dark chroma in every wide on v5 and v7). **Rendered check** (`queue6.ps1 -Step lut3`: snapshot `integ5L` = integ5 +
  the integration overlay, hash ef0d1923adaf7cda; the 18 wide ref-pair stills of v7 at own N, 3-frame pre-roll, 08:22-08:40
  under the lock, paused 4x for foreign renders; `out/lut3`, `compare.log`, `lut/look_lut3.json`): dark chroma S01 12.9,
  S03 10.7, S05 8.3, S10 10.0, S17 8.4, S19 10.2, S20 7.2, S23 9.8, S25 8.4 (offline 7.0-12.9), compare.py sum of the nine
  wides 531.0 (offline 530.5, v2 page 533.9; S25 57.5), clip share <= 0.02 %, i.e. the page reproduces the offline result.
  Mean of the 26 pairs with v7's close-ups: **56.5** (v2 56.7, ungraded 54.5). Sheet `out/lut3/lut3_vs_v7_S01_S20_S25.jpg`
  (v7 with v2 left, v3 right): the darks keep a little more navy / plum, blacks stay deep, highlights unchanged.

### 8.6 Render-time estimate on the current modules (supersedes 7.3's numbers; the method of 7.3 is kept)

Defect: the estimate was modelled on integ2 stills (disk gap-fill, pre-tailoring pianist), its 7.8-14.5 h band was too
wide to commit a window, and the idle-GPU probe never ran.
- `sandbox/integration/estimate.mjs` now takes `--snap` (plan = that snapshot's edit and per-shot N, plus its motion N
  boost table) and `--chunks` (REAL render.mjs chunks as the sustained-cost correction, replacing the round-3 sequences
  that came from integ2 modules on a busy GPU). Per-shot model = the v5 stills (integ3d: current modules, layered DOF,
  LUT v2, each shot's own N).
- Real chunks (`build/chunks/review_1080p_integ3`, 4 chunks / 1,080 frames, own N, one session each, held under our lock
  AND the shared lock of the user's other projects, so nothing else rendered on the GPU): S04 N32 2.70 / 2.85 s per frame,
  S20c+S21 (N48/32) 2.67 s, S21+S22 (N32) 2.91 s = **1.53-1.62 x the stills model** of the same frames (stills are
  single frames after a 3-frame pre-roll; sustained frames are slower). Session init on integ3: 1.3-3.0 min.
- `node sandbox/integration/estimate.mjs --snap build/snap/integ3e --runs sandbox/integration/out/v5/stills.json
  --chunks build/chunks/review_1080p_integ3` -> `out/estimate_v5.json`:

| plan (integ3e) | sub-frames | 1080p | 1440p | 2160p |
|---|---|---|---|---|
| own N (wides 32, close-ups 48) | 517,536 | 11.6-12.6 h | 13.6-14.8 h | 22.7-24.4 h |
| **own N + motion N boost** | 520,064 | **11.6-12.7 h** | 13.7-14.9 h | 22.8-24.5 h |
| N48 -> 32 in the close-ups | 467,392 | 10.3-11.3 h | 12.2-13.2 h | 20.3-21.8 h |

  (incl. 12 session starts at --per-session 4), with the chunks' global 1.53-1.62 correction. Those chunks are close /
  medium hand shots only, so a per-class session followed:
- **Per-class sustained timing** (integ3e, one session under the lock, 16 consecutive own-N frames per class after a
  3-frame pre-roll; `jobs/timing5.json` -> `out/tim/classes.json`, 2026-10-23 02:41). Median page time vs the stills
  model of the same shot, then calibrated to the real chunks through S04 (S04 jobs 3.06 s vs its chunks 2.70 / 2.85 s =
  0.91): wide S03 N32 1.71 s (x1.49 -> **1.35**), S10 N48 3.81 s (x2.30 -> **2.09**), macro S06 / S24 N48 with the layered
  gap-fill 5.22 / 5.24 s (x1.64 / 1.68 -> **1.51**), overhead S14 N32 3.25 s (x1.47 -> **1.34**), close S04 N32 3.06 s
  (x1.74 -> **1.58**; the S20c-S22 chunks give 1.53-1.58 directly). The first frame after the pre-roll runs at the stills
  speed (S04 1.79 s); consecutive full-N frames are slower, so stills alone underestimate the film by a third.
  `estimate.mjs ... --classes sandbox/integration/out/tim/classes.json` applies the class ratio per shot (band +-7 %):

| plan | sub-frames | 1080p | 1440p | 2160p |
|---|---|---|---|---|
| integ3e own N + motion boost (`out/estimate_v5.json`) | 520,064 | **10.8-12.8 h** | 12.8-15.0 h | 21.3-24.8 h |
| integ4 (live edit: S16b 64, S21/S22 48) own N + boost (`out/estimate_integ4.json`) | 534,784 | **11.2-13.2 h** | 13.2-15.5 h | 21.9-25.6 h |
| N48 -> 32 in the close-ups (if the kicker fix allows it) | 467,392 | 9.6-11.4 h | 11.3-13.4 h | 18.9-22.1 h |

- Decision: **1080p, window 13.5 h** (top of the band + margin) on an idle GPU. 1440p (13.2-15.5 h) straddles the 14 h
  bar of 7.3, and 2160p is dropped. The idle-GPU size probe (`sizeprobe.ps1`) stays the last step before the final
  render, on the frozen final snapshot; it can only move 1440p back in if it projects <= 14 h.
- **Are the newer modules slower? (v6's stills took 1.79x v5's page time per sub-frame.)** Page-time attribution,
  `sandbox/integration/cost.ps1` + `queue6.ps1`: 8 sessions of `jobs/cost.json` (5 consecutive own-N frames each of S01,
  S03, S04, S10, S24, S14 after a 3-frame pre-roll; one session per snapshot under the lock; cost4-cost8 with the mid-hold
  foreign watch); `costab.py` -> `out/cost/costab.json`. Minimum page time of the 5 frames, ms (S14 left out: its boost
  N differs between perf f2c and f3c):

| session (start) | snapshot | S01 N32 | S03 N32 | S04 N32 | S10 N48 | S24 N48 |
|---|---|---|---|---|---|---|
| cost1 (02:59), cost5 (04:37) | integ3e (13:00 modules, perf f2c) | 1427 / 1543 | 1455 / 1654 | 3232 / 2763 | 3464 / 3532 | 5989 / 4595 |
| cost6 (07:05) | integ3e | 846 | 882 | 1909 | 1890 | 3345 |
| cost3 (03:57) | integ3e + integ4 world | 1428 | 1615 | 3050 | 3465 | 5093 |
| cost4 (04:29) | integ3e + integ4 pianist (hand hair) | 1340 | 1489 | 2961 | 3279 | 4800 |
| cost2 (03:30), cost7 (07:13) | integ4 (live 02:10, perf f3c) | 1901 / 1836 | 1880 / 1925 | 3756 / 3879 | 4011 / 4050 | 5838 / 5942 |
| cost8 (07:18) | **integ5** (live 07:04: piano 03:53, pianist 03:26, camera 02:16) | 1512 | 1524 | 3066 | 3092 | 4858 |

  The same snapshot varies **1.6-1.8x between sessions** (integ3e cost6 vs cost5) with the machine's state and the
  foreign renders (cost6 paused 135 s for two of them, and the 60 s probe let one run next to its S24 frames: 3.3 -> 5.7 s).
  The integ4 world and pianist cost nothing measurable; integ4 itself sat 20-30 % above integ5 in both of its sessions
  (not attributable to one module); **integ5, the current live tree, is inside the integ3e range** and matches the
  per-class model of `out/tim` (S03 1.52 vs 1.71 s, S04 3.07 vs 3.06 s, S10 3.09 vs 3.81 s, S24 4.86 vs 5.24 s). v6's 1.79x
  was session noise (v6 ran 02:11-02:50, before the mid-hold watch existed). `estimate.mjs --snap build/snap/integ5
  ... --classes out/tim/classes.json` -> `out/estimate_integ5.json`: 534,768 sub-frames (own N + 102 boosted frames),
  **1080p 11.2-13.2 h**, 1440p 13.2-15.5 h: the decision above stands (1080p, 13.5 h window, idle-GPU probe last).

### 8.7 Contact sheets after the fix round (v5 on integ3d, v6 on integ4) and before/after numbers

- **v5** (`out/v5`, integ3d = integ3 modules + perf f2c + this round's integration, every shot at its own N, 2026-10-22
  23:50): wiring 8/8, sync 30/30 key bottom within one frame, 30/30 fingertip on its key (gap p50 0.15 mm), 24/30 hammer
  within a frame (I-09 240 Hz sampling), dampers 30/30 + 13/13, pedal r = 1, foot r = -0.98; contact_1-4.jpg viewed.
- **v6** (`out/v6`, **integ4** = the live tree at 02:10: world 21:42, pianist 21:22, camera 22:28 with the I-23 sun arc,
  perf f3c 911e8991 with its hand track, + this round's integration incl. the motion N boost; 2026-10-23 02:50): wiring
  **9/9** (check 9 = motion boost), sync identical (tip gap max 0.64 mm), contact_1-4.jpg viewed; gates: flicks FAIL (perf
  I-37, 147 / 46 / 20), the rest OK.
- Determinism (det3 on integ3d, 3 sessions, --preroll 3, 1080p N16): **PASS**, identical across sessions.

Before / after (mean of the 26 compare.py pairs; "ungraded" = `AG.regrade({debugView:'nolut'})` of the same
accumulation, so grade and scene are separated):

| run | modules | grade | ungraded | as rendered | wide dark chroma (refs 7.0-16.0) | clip % (max over shots) |
|---|---|---|---|---|---|---|
| v3 (integ2) | 02:00 | none | 55.92 | 55.9 | 16.1-22.0 | 0.07 |
| v4 (integ2g) | 02:00 | LUT v1, disk DOF, N16 | 55.92 | 58.6 | 4.3-6.5 | 5.65 |
| v5 (integ3d) | 13:00 + f2c | **LUT v2 pair, layered DOF, own N** | 54.53 | **56.4** (v1 would be 56.6) | **6.2-9.7** | **0.08** |
| v6 (integ4) | live 22:28 + f3c | same + motion N boost | 54.31 | **56.3** (v1 would be 56.5) | **6.5-10.9** | **0.07** |
| v7 (integ5) | live 07:04 (piano 03:53, pianist 03:26, camera 02:16) + f3c | LUT v2 pair (wide s 0.5), layered DOF, own N + boost | 54.51 | **56.7** (v1 would be 56.9) | **5.9-10.9** | **0.07** |
| lut3 (integ5L = integ5 + overlay): the 18 wide stills rendered with the wide LUT v3, close-ups from v7 | same | LUT v2 close + **v3 wide (s 0.6)** | 54.51 | **56.5** (offline 56.4) | **7.2-12.9** | 0.07 |

- **v7** (`out/v7`, **integ5** = the live tree frozen 2026-10-23 07:04, hash b305c43f604add02, + this round's integration;
  `sandbox/integration/queue6.ps1 -Step v7`, 07:24-07:34 under the lock, `analyse_v7.ps1`): wiring **9/9 OK**, sync 30/30
  key bottom within one frame (p50 +1.7 ms), 30/30 fingertip on its key (gap p50 0.16 mm, max 0.64), 24/30 hammer (I-09),
  dampers 30/30 + 13/13, pedal r = 1, right foot r = -0.9995; gates as on integ4 (flicks FAIL 147 / 46 / 20 on f3c, perf
  I-37; restrike, keyonset 1131/1131, handtrack, motionstep OK: own-N worst S02 f652 2.78 px, at the rendered N max 1.00 px);
  contact_1-4.jpg viewed. compare.py per ref shot v6 -> v7: S04 55.7 -> 57.2, S24 45.9 -> 48.4, S09 41.9 -> 42.9 (piano
  03:26-03:53), the rest within 0.2; module re-measure in MODULE_ISSUES "Re-measured on integ5" (`out/v7/module_metrics_v7.json`,
  `sandbox/integration/modmetrics.py`, which reproduces `module_metrics_v6.json` exactly).

The grade's contribution is stable across module states (+1.9 .. +2.2 for v2; v1 +2.1 .. +2.4 but with neutral-grey shadows
and red plateaus); the as-rendered means move with the modules (v4 -> v5 -2.2 = modules, ungraded -1.4; v5 -> v6: S01 +22
from the sun arc, S04 / S10 / S17 / S19 -4.5 .. -6, MODULE_ISSUES "Re-measured on integ4").

## 9. Final integration pass (2026-10-23 19:18-, before the final full-length render)

All module tracks are finished. This pass picks the performance, freezes the final snapshot, re-runs the wiring / sync /
gates / determinism checks on it and renders the review set at the review-1080p preset (each shot's own N). Integrator
changes to module files in this pass are data / parameter level only and are listed in 9.4 with before / after numbers.

### 9.1 Performance pick: g1f stays in build/anim (g2b gated, not shipped)
- g2b (perf track's last full candidate: thumb posture + palm height; sha256 0e3ad8e7) finished 19:20 (QC 19:29) and was
  run through `pwsh -File sandbox/perf/r8/gate.ps1 -Run g2b` (`sandbox/perf/r8/gate_g2b.log`, `anat_g2b.txt`).
- Ship rule of this pass: contact p99 < 0.5 mm, notes off key 0, hold max < 2 mm, joint limits clean, better than g1f on the
  anatomy census.

| check (QC 15 Hz / critic census 30 Hz) | g1f (build/anim) | g2b | rule |
|---|---|---|---|
| contact p99 / max (mm) | 0.486 / 1.30 | 0.489 / **4.13** | p99 < 0.5: pass |
| notes off key | 0 | 0 | pass |
| hold max (mm) | 0.85 | 1.72 | < 2: pass |
| joint-limit frames | 1 (L wrist +0.2 deg) | **19** (R wrist 18 frames up to +1.9 deg at m 100.2-101.3; R4 abduction +3.3 deg at m 103.2) | clean: **fail** |
| census thumbOut / pointerThumb / wristExt / knuckleHigh | 515 / 636 / 65 / 115 | 265 / 344 / 14 / 68 | better |
| census thumbStraight / contactStraight | 0 / 0 | **142 / 38** | worse (new defects) |
| census freeClaw / freeLifted / freeStraight | 38 / 67 / 19 | **134 / 252 / 92** | worse |
| I-37 flicks60 > 8 / 12 / 15 deg | 71 / 9 / 2 | 97 / 24 / 9 | worse |
| own-key flesh > 1 mm (vertex-frames) | 373 | 958 | worse |

  -> **not shipped** (joint limits not clean; census not better overall: the thumb / palm-height gain comes with new straight
  thumbs and straight contact fingers). build/anim stays **g1f** (sha256 150017f6, shipped by the perf track). The g2b
  solver process had already exited when the gate ran (nothing to kill). PERFORMANCE.md section 8 has the same table.

### 9.2 Snapshots integ6 / integ6b
- `node render/snapshot.mjs --out build/snap/integ6` (19:36) = live tree, perf g1f; the snapshot re-solved its camera hand
  track from g1f (`handtrack perf` 911e8991 (f3c) -> 150017f6) and the motion-blur N boost table (f3c: 102 frames,
  +2368 sub-frames -> g1f: **68 frames, +1616 sub-frames**, target 1 px). Both regenerated files were copied back to the
  live tree (`scene/src/camera/handtrack.json`, `scene/src/integration/motion_n.json`; the f3c-keyed copies are in
  `sandbox/integration/bak_pre_integ6/`), so the live tree hash equals the snapshot's (065b404fabc6d812).
- **integ6b** (`build/snap/integ6b`, hash **1f41ec4abad09f90**) = integ6 + the pianist GLB fix of 9.4. It is the snapshot
  every check and render of this pass ran on, and the one to freeze for the final render.

### 9.3 World h07: clouds.lowSky and the navy floor tint both kept (no change)
- `sandbox/world/out/h07` (1080p N16, placeholder piano): fold (lowSky on) ref 6 **60.3** vs lowOff (lowSky [90, 91, 2.5] =
  off) **54.9**; by eye the overhead peach cloud reflections of ref 6 come back with lowSky (lowOff is a flat blue-mauve
  sheet). The navy tint of the dark floor on far anti-sun faces is code (terrain.js, `uDarkFloor * mix(1, uAntiAmb.rgb,
  wAnti)`), was score-neutral in h07 (massif hue 242 -> 239, toward the ref navy) and world cycle 4 builds on it
  (`rockFar`, h09 verification). Both stay as they are in `scene/src/world/params.js`.

### 9.4 Integrator data / parameter changes in module files (this pass)

| file | change | before | after | evidence |
|---|---|---|---|---|
| `assets/pianist/pianist.glb` (run15, pianist track) | restored the `pianist_suit` material's `extras.buttons` (4 sleeve-button UV discs, copied from run14) with `sandbox/integration/glb_restore_extras.mjs`; BIN chunk untouched | run15 packed 13:55 without material extras: tailoring `buttons` **0** and no disc pass at all (no `discsCollapsed` in the log: no 3-D horn sleeve buttons; q7_det4.log on integ6); run14 / integ5: 10 | tailoring `buttons` **10**, `discsCollapsed` 10 (q7_v8.log on integ6b); sha256 AEF9200E1BE071E1.. | run14 vs run15: 13 meshes, 114 accessors, 12 images identical; all 88 vertex-attribute bufferViews byte-identical; materials identical except that field. Original run15 kept in `build/pianist/assets_run15_noextras/` |
| `scene/src/camera/handtrack.json` | regenerated by the snapshot from build/anim (g1f) | perf f3c 911e8991 | perf g1f 150017f6 | wiring check 8, gate handtrack OK |
| `scene/src/integration/motion_n.json` | regenerated by the snapshot from g1f | f3c: 102 frames, +2368 sub-frames | g1f: 68 frames, +1616 | gate motionstep OK (rendered max 1.00 px) |

Tooling (integrator-owned, no effect on pixels): `sandbox/integration/sizeprobe.mjs` takes the estimate file as argv[3] /
`AG_ESTIMATE` and levels the probe against the same class-corrected model the estimate's totals use (the round-3 version
compared real chunks with the raw stills rows, i.e. it would count the sustained correction twice with a per-class
estimate), and also reports a projection from the chunks' page-time medians (without the foreign-watch pauses, which
`timings.wallMs` includes). `queue7.ps1` (GPU steps of this pass), `analyse_v8.ps1`, `hands_sheet.py`.

### 9.5 Checks on integ6b (v8: gates, wiring 9, sync 30, stills of all 26 shots at their own N)
`pwsh -File sandbox/integration/queue7.ps1 -Step v8` = `check.mjs --size 1080p --N own --sync 30 --out
sandbox/integration/out/v8` (19:41-20:58; 76.5 min instead of ~10 because of foreign GPU renders, 9.7), then
`pwsh -File sandbox/integration/analyse_v8.ps1` (contact.py, tools/compare.py, modmetrics.py).
- **Gates (CPU, served perf g1f):** restrike OK (175, min rise 0.563), keyonset OK (1131/1131 within one frame), handtrack
  OK (150017f6), motionstep OK (68 boosted frames, rendered max 1.00 px, none > 1 px); **flicks FAIL** 71 / 9 / 2 (> 8 / 12 /
  15 deg on readable hands; > 12 deg by shot S15 3, S09 2, S21 2, S16b 1, S18 1) - perf I-37, much better than f3c's 147 / 46
  / 20 but not 0.
- **Wiring 9/9 OK** (perf tracks sha256 150017f6, 72 bone tracks, ripples 334 solver events -> 1075 water events, hand
  track and motion boost keyed to g1f). Pianist tailoring: buttons 10, discsCollapsed 10 (9.4).
- **Sync (30 seeded notes, AG.probe):** key bottom within one frame 30/30 (p50 +0.6 ms, -4.6..+10 ms), fingertip on its key
  within 1.5 mm 30/30 (gap p50 0.15, max 0.63 mm), hammer at the string within one frame 24/30 (I-09, 240 Hz sampling),
  dampers lifted while held 30/30, after release follow CC64 13/13, sustain pedal vs CC64 r = 1, right foot vs pedal
  r = -0.9995 (9.5 mm travel).
- **Stills:** 52 (first + middle of 26 shots, own N 32-64 + motion boost), `out/v8/contact_1.jpg` .. `contact_4.jpg` (each
  row: first | mid | the ref the shot realises), all viewed. compare.py mean of the 26 ref pairs **59.3** (v7 on integ5
  56.7): S01 71.0/71.1 -> 76.6/76.3, S03 57.2/64.2 -> 60.4/69.0, S04 56.7/57.8 -> 64.1/64.2, S05 58.5/60.1 -> 59.4/62.7,
  S09 42.8/43.0 -> 45.5/45.4, S10 62.3/56.3 -> 67.9/59.2, S17 59.5/59.7 -> 63.2/63.0, S19 63.7/56.7 -> 67.5/60.2,
  S20 44.7/50.0 -> 45.7/52.2, S23 54.5/57.3 -> 55.6/58.8, S24 48.6/48.1 -> 52.8/51.4; lower: S06 56.3/54.1 -> 53.7/53.4,
  S25 50.1/70.8 -> 47.9/66.2 (world cycle 4 water / cloud changes and the 14:00 pianist / piano edits; integ5 -> integ6b
  changed world, piano, pianist, camera and perf together, so the deltas are not attributed per module).
- **Hand close-up sheets** (`sandbox/integration/hands_sheet.py`): `out/v8/hands_sheet_mid.jpg` and `hands_sheet_first.jpg`
  = S04, S06, S09, S16b, S24 and the two overhead shots S14 (top-down) and S20 (drone rise): full frame with the crop box +
  the hands at 1:1 (close-ups) or 2x nearest (S04, S09, S14, S20). Seen: the 4 horn sleeve buttons are back (S04, S09,
  S16b); cuffs are a clean warm-white band with a small 4-hole button (S06, S24); dorsal veins, knuckle creases and nails
  read at 1:1; the run15 skin mottling on the S24 / S06 back of the hand reads as skin tone variation at 1080p, not as dirt
  (lead note 15:30), so run15 stays. Still open (not fixable as a parameter in this pass): S14 top-down left hand hovers
  fingers splayed / curled (perf C-04 / I-12); S14 water around the bench has hard-edged black blotches (world I-13 / C-05,
  also in v7); S20 overhead water shows the hard-edged foil pattern (world I-22) and no peach cloud patches (I-19);
  S09 case side darker than ref 8 (I-08, p90 62 vs >= 90); S25 blue hour darker / greyer than ref 1.
- Module metrics (`out/v8/module_metrics_v8.json`, same boxes as v6 / v7): I-29 S06 keys p99 173.2, 84.9 % > 100 (met);
  I-29 panel p50 / std / p99 39.7 / 29.7 / 106.2 (v7 6.8 / 18.4 / 66.4); I-34 cuff (102, 93, 93) B/R 0.91; I-08 S09 case
  side p50 / p90 42.9 / 62.3; I-19 S20 open water std / p99 22.8 / 111.9 (v7 18.3 / 86.0); I-18 S03 under / beside 0.5
  (v7 0.75); I-42 S25 keyboard p99 38.7; I-26 S19 left cheek p99 200.1.

### 9.6 Determinism with pre-roll on integ6b
`node render/determinism.mjs --preroll 3 --frames 1519,2269,10334 --size 1920x1080 --N 16 --out sandbox/integration/out/det5`
(`queue7.ps1 -Step det5`, 21:12-21:43): sessions A (in order), B (reversed, after a different warm-up) and C (last frame
only) are **bit-identical** (1519 f9ad4c32.., 2269 c2d3e976.., 10334 2c604009..) and the frames differ -> **PASS**. (det4 on
integ6 was stopped after its session A while it waited for the slot; integ6b differs from integ6 only by the GLB extras.)

### 9.7 Foreign GPU load during this pass (not under any lock)
From ~19:20 on, other Claude sessions of the user rendered headless Chrome on the 780M without the Afterglow lock or the
shared `<their lock dir>/.gpu.lock`: a game-QA workspace (`tools/shot.mjs`, `scratchpad/perf.mjs`,
`qa.mjs`, `wtest.mjs`), a second workspace (`scratchpad/swipe4.mjs`, `sheet.mjs`), a third session's `video.mjs
seg3/seg4.mp4 1920x1080` (one of them measured at 98.6 % / 93 % of the 3D engine at 20:30 / 21:25 while our page was
paused). The mid-hold foreign watch paused our frames 13+ times in v8 (17-226 s), 461 s once in det5; between probes our
frames ran next to theirs (still page time per sub-frame 10-20x normal, e.g. S15 N48 43-51 s per still). v8 took 76.5 min
(~10 min on a quiet GPU). Not our processes: not touched; the user was notified (push, 21:25). **The final render needs
these sessions stopped**: at this load it would take several times the 11-13 h estimate, and concurrent GPU contexts are
the bluescreen (0x119) pattern of 2026-10-21/22.
- Scope cut taken because of it (deadline: final render start by ~02:00): the review clips start as 5 s clips (one
  300-frame chunk each: hands S04 1920-2220, wide S03 1200-1500); the 10 s versions reuse those chunks and add the second
  one only if time allows; the size probe runs only on an idle GPU.

### 9.8 Review clips with the film audio (review-1080p, own N, integ6b)
`queue7.ps1 -Step clip_hands6a / clip_wide6a` (5 s, first chunk) then `clip_hands6 / clip_wide6` (10 s: the first chunk
skipped as complete, the second rendered) = `node render/film.mjs clip --preset review-1080p --from A --to B --name <n>
--chunks build/chunks/review_1080p_integ6 --per-session 1` (render.mjs per 300-frame chunk, then encode.mjs with
`build/audio/afterglow_film.wav` at offset 0 and its verify). Review: `sandbox/integration/clipreview.py` -> `out/clips6/`.

| clip | range (shot) | chunks s/frame (wall, incl. foreign pauses) | encode verify | clipreview |
|---|---|---|---|---|
| `build/out/test_hands_integ6.mp4` (10 s; `test_hands_integ6_5s.mp4` = first half) | 1920-2520 (S04, ref 7, N32) | 5.24 / 5.19 (page-time median 3.96 / 3.70; quiet-GPU integ3 chunks of the same frames: 2.70 / 2.85) | ALL CHECKS PASSED: identity 600/600, PSNR 49.6, RGB bt709 43.4 dB, audio onset error 0 ms, xcorr lag 0 ms at 0 s and 7.4 s, provenance consistent (2 chunks, 69 inputs) | max frame-to-frame luma delta 0.38, no spikes > 1 code value; seam 2219/2220/2221 smooth |
| `build/out/test_wide_integ6.mp4` (10 s; `test_wide_integ6_5s.mp4` = first half) | 1200-1800 (S03, ref 2, N32) | 4.70 / 1.87 (page median 1.88 / 1.75; the foreign load stopped before chunk 2) | ALL CHECKS PASSED: identity 600/600, PSNR 46.1, RGB 36.3 dB, audio onset 0 ms, lag 0 at 0 / 7.7 s | max luma delta 0.21; near water (y >= 700) \|d2\| > 20 mean 2.8 % |

Looked at: both strips (`out/clips6/*_strip.jpg`), hand crops f2000 / 2001 / 2150 (`hands5s_crops_f2000_2001_2150.png`:
sleeve buttons, fingertips on the keys), the worst local-noise frames of the hand clip 2347-2350 / 2444-2447
(`seam/fast_2347_2350_2444_2447.jpg`): the right hand's leaps travel ~100 px per frame with a smooth motion-blur streak
(the perf track's known fast transfers, PERFORMANCE.md open items), no stepping, no pop.

### 9.9 Final render-time estimate (idle-GPU probe on integ6b) and the size decision
- Model: `node sandbox/integration/estimate.mjs --snap build/snap/integ6 --runs sandbox/integration/out/v5/stills.json --chunks
  build/chunks/review_1080p_integ3 --classes sandbox/integration/out/tim/classes.json --out sandbox/integration/out/estimate_integ6.json`
  (integ6 and integ6b have the same edit, N and boost table): 534,016 sub-frames (own N + 68 boosted frames); **1080p 11.2-13.2 h**, 1440p 13.1-15.5 h
  (incl. 12 session starts at --per-session 4).
- Probe: `queue7.ps1 -Step probe` = `sizeprobe.ps1 -Sizes 1080p,1440p -From 7200 -To 7500` (one 300-frame chunk per size,
  S15 macro N48 + 44 frames of S16, final presets, one session each; the default 600 frames was halved for the deadline).
  `sandbox/integration/chunklevel.mjs` levels each real chunk against the same class-corrected model as the totals.

| chunk (integ6b, final quality, own N) | GPU state | wall s/frame | page median | class model | level | 1080p film projection |
|---|---|---|---|---|---|---|
| probe_1080p 7200-7500 (S15 + S16) | **quiet** (our Chrome 96 % of the 3D engine, no foreign pause) | **4.28** | 4.38 | 3.38 | **1.27** | **15.2-15.5 h** |
| review 1500-1800 (S03) | quiet | 1.87 | 1.75 | 1.55 | 1.21 | 14.5-14.8 h |
| review 1200-1500 (S03) | foreign renders | 4.70 | 1.88 | 1.55 | 3.03 (wall) | - |
| review 1920-2220 / 2220-2520 (S04) | foreign renders | 5.24 / 5.19 | 3.96 / 3.70 | 2.78 | 1.88 / 1.87 (wall) | 22.5-22.8 h at that load |

  The sustained cost on integ6b is ~1.2-1.3x the class model (which was calibrated on integ3e, 2026-10-23 02:40): the newer
  modules (world cycle 4, pianist run15 + hand hair, piano cycle 2) cost more per frame, and the probe chunk slowed from 4.08
  to 4.46 s/frame over its 5 minutes (sustained-load clocks). **1080p: about 15-15.5 h on a quiet GPU** (not the 11-13 h of
  section 8.6). Under tonight's foreign load the same film needs ~23 h.
- Probe result (`sandbox/integration/out/sizeprobe.json`, summary at the end of `sandbox/integration/q7_probe.log`; 23:25-00:38):

| size | wall s/frame | page median s/frame | factor vs 1080p | session start | projected film (wall level) | projected (page level) |
|---|---|---|---|---|---|---|
| 1080p (quiet GPU) | 4.28 | 4.38 | 1 | 121 s | **15.3 h** | 15.7 h |
| 1440p (the foreign renders came back: 6 pauses of 92-146 s, concurrency between probes) | 9.60 | 6.41 | 2.24 wall / 1.46 page; **1.26-1.29** over its first 90 frames while still quiet | 111 s | 33.9 h | 22.7 h (~19.5 h with the quiet factor 1.27) |

- **Decision: final render at 1080p** (final-1080p, own N + motion boost, --per-session 4, pre-roll 3, snapshot integ6b);
  budget **~15.5 h on a quiet GPU** (start 01:00 -> done ~16:30 on 10-24; encode + publish before 23:00). 1440p is out
  (>= 19 h even with the quiet factor; the 14 h rule). Optional cut if the GPU cannot be kept to ourselves: N48 -> 32 in the
  close-ups (model 10.1 h -> ~13 h at level 1.27; 1080p own N stays the recommendation).
- Reusable final-1080p chunks (same render.mjs settings hash 6c97b724bd8bdf60 and scene hash 432f8ffde0a8d90b as a
  final-1080p render of integ6b, film's 300-frame grid): `build/chunks/probe_1080p/chunk_007200_007500`,
  `build/chunks/review_1080p_integ6/chunk_001200_001500` and `chunk_001500_001800` (copy them with their manifests into
  `build/chunks/film_1080p` to skip ~25 min; the 1920-2520 review chunks are off the grid).

### 9.10 Open items for the GO / NO-GO (integrator view; nothing here was changed in this pass)
- **GPU must be ours** for 15+ h: stop the other Claude sessions' headless renders (three other workspaces) before the start; the lock cannot hold them.
- Perf: gate flicks FAIL on g1f (9 one-frame flicks > 12 deg on readable hands); S14 top-down free fingers splay / curl;
  fast RH transfers in S04 (~100 px/frame, smooth blur).
- World: S14 black water blotches (I-13 / C-05), S20 overhead foil / no cloud patches (I-19 / I-22), S25 darker than ref 1
  (compare 70.8 -> 66.2 since v7), mauve vs warm-orange water in the wides (lead note 15:40).
- Piano: S09 case side p90 62 (ref 8 brighter; I-08). Pianist: cuff band still ~45 px in S06 (I-34 width).

## 10. Final freeze (2026-10-24 01:20-, the last pass before the full-length render)

The integrator's last pass: the launch condition and the close-up N decision, the foreign-GPU guard fix, the launch
command / environment, the FINAL snapshot and its checks, a smoke test of the final command. Launch, encode and resume
instructions: `sandbox/integration/FINAL_RENDER.md`. The full-length render is NOT started in this pass.

### 10.1 Launch condition and the close-up N cap (decided before the start; all 47 chunks render with it)
- Foreign GPU load tonight (other Claude sessions of the user, no lock): `node render/lib/gpulock.mjs foreign` listed 2 active
  headless GPU jobs at 01:16 (another session's `tools/shot.mjs`), 1 at 01:31 (another session's `node tools/perf.mjs`) and 01:41,
  and at 01:49 another session's `timeout 400 node tools/perf.mjs` paused v9 (10.4); the user's other projects' `tools/heavy.mjs`
  held the shared lock `<their lock dir>/.gpu.lock` at 01:41 (v9 waited for it, 8.1
  interop). The user was asked by push notification (01:33) to pause those
  sessions; their processes are not ours and were not touched.
- **Decision: the N cap is TAKEN** (not a mid-render switch: decided before any final chunk exists). Own N is 15.3 h on a
  quiet GPU (9.9), above the lead's 14 h rule (NIGHT_PLAN 00:50: cap if FINAL_RENDER implies > ~14 h); the foreign renders
  cannot be stopped from here while the user sleeps, and every minute one of them is active adds a minute to our wall time
  (the guard pauses our frames, 8.1). The capped film projects ~13.4 h quiet, leaving ~4-5 h for foreign pauses before
  the 23:00 deadline minus encode + publish (~2 h).
- What is capped and why it is safe: the N of these shots was raised for reasons that are now covered elsewhere; the shots
  whose N buys something the boost does not cover keep it.

| shot (frames) | N before -> after | why it had been raised | covered now by |
|---|---|---|---|
| S06 (737), S24 (639), S08 (360), S13 (299), S15 (369), S20b (158), S20c (202) | 48 -> 32 | close-ups at 48 from the start: DOF on the near keys + the kicker "string of pearls" (piano I-30: more N did not fix it) | I-30 fixed in the piano module (kickR 0.12, kickCone 2.5 deg, PIANO.md); layered DOF gap-fill sigma ~ CoC / sqrt(N) (8.3; dof4: S24 bright error vs N256 at N16 7.51 vs N48 6.99) |
| S21 (338), S22 (382) | 48 -> 32 | fast-hand edges stepped > 2 px apart at N32 (I-44, S22 banding) | motion N boost re-solved for N32 (target 1 px): S22 11 boosted frames |
| S16b (209) | 64 -> 32 | walk-down leaps stepped 2.76 px at N48 (round 8) | motion N boost: 28 boosted frames up to N128 (rendered max 1.00 px) |
| S10 (760), S11 (738), S16 (161) | **48 kept** | defocused foreground water / glints step at N32 (I-28), fast crane (camera critic) | - (whole-frame DOF / camera motion: not what the per-frame hand boost measures) |

- `sandbox/integration/final_ncap.mjs` makes exactly these 10 edits in `scene/src/camera/shots.js` (each must match once;
  inline comment `/* final freeze 2026-10-24: was 48 */` and a header note; backup `sandbox/integration/bak_pre_final/shots.js`).
  Shot boundaries, cameras and everything else in the edit are unchanged (`film.mjs plan`: the same 13,857 frames and cuts).
- Cost (`node sandbox/integration/estimate.mjs --snap build/snap/final --runs sandbox/integration/out/v5/stills.json --chunks
  build/chunks/review_1080p_integ3 --classes sandbox/integration/out/tim/classes.json --out sandbox/integration/out/estimate_final.json`):

| plan | sub-frames (incl. boost) | boost | class model 1080p | x probe level 1.27 + 12 session starts |
|---|---|---|---|---|
| integ6b own N (9.9) | 534,016 | 68 frames, +1,616 | 11.8 h (11.2-13.2 with starts) | **15.3 h** (sizeprobe, quiet GPU) |
| **final** (N cap) | **473,760** | 132 frames, +3,792 | **10.3 h** (9.8-11.6) | **~13.4 h** |

  The level 1.27 was measured on an S15 + S16 chunk at N48; the capped close-ups may sit slightly differently against the
  model, so ~13.4 h is a projection, not a measurement.
- Not reused: the three integ6b final-quality chunks (9.9: probe 7200-7500, review 1200-1500 / 1500-1800). The probe chunk
  is S15 at N48 (now 32); the S03 chunks are pixel-equivalent in principle but their manifests list `build/snap/integ6b/...`
  inputs, and encode.mjs compares inputs by path, so chunks of two snapshots would splice without a provenance error. The
  final render therefore renders all 47 chunks from one snapshot (`final_render.ps1` refuses foreign manifests, 10.5).

### 10.2 gpulock.mjs: the foreign-GPU guard no longer fails open on one probe failure
- Defect (reviewer, confirmed in the logs): one failed PowerShell CIM probe switched the guard off for the rest of the
  process. Mid-hold (`startForeignWatch` tick rejection: `broken = true; active = []`) that also ended a running pause:
  `q7_v8.log` l.101 and `q7_probe.log` l.50 'mid-hold foreign probe failed ... continuing without it', after which there were
  0 pauses (19 / 6 before) while the foreign renders continued; the 1440p probe's last ~90 frames ran next to them. At slot take
  (`foreignGpuJobs`: `foreignProbeBroken = true`) the same. Both logged failures have an EMPTY stderr (only the command
  line in the message), i.e. a non-zero exit without an error text or the 30 s timeout under load, consistent with
  processes exiting during the enumeration while three Chromes started and stopped.
- Fix (Node-side tooling only; not a page input, so no chunk / input hash changes):
  - a failed probe is transient: the watch keeps its previous `active` (a pause stays a pause), logs
    `transient k/20 ... retrying` and probes again on the next tick; `foreignGpuJobs` returns the last successful result
    marked `probeFailed`, and the taker treats that as "not known to be free": it gives the slot back and retries in 15 s;
  - the guard is given up (fail open, as before) only after `AG_GPU_FOREIGN_MAX_FAILS` (default **20**) consecutive
    failures, i.e. >= ~5 min of a probe that cannot work; a success resets the count and is logged;
  - `Get-CimInstance ... -ErrorAction SilentlyContinue`; stdout that parses as the JSON list is used whatever the exit
    code; probe timeout 30 -> 45 s; the error text now names exit code / timeout kill / stderr instead of the command line;
  - test hooks: `AG_GPU_FOREIGN_FAIL_TEST=K` (fail the first K probes), `AG_GPU_FOREIGN_FAIL_AT=1,4` (fail those probe
    calls), `AG_GPU_FOREIGN_ONLY=<regex>` (count only browsers whose command line matches: scratch tests next to real load).
- Test (re-run of the 2026-10-22 20:59 scratch-lock-dir test with forced failures): `node sandbox/integration/fw_freeze/
  fw_freeze_test.mjs` (scratch `AG_GPU_LOCK_DIR`, shared lock off, software headless Chrome `--disable-gpu
  --use-angle=swiftshader`, never the real GPU; log `sandbox/integration/fw_freeze/fw_freeze_test.log`):

| case | result |
|---|---|
| idle software Chrome only / + busy WebGL page | `[]` / busy GPU process detected (51.6 s CPU per window) |
| mid-hold watch, forced failures at probe calls 1 (before detection) and 4 (DURING the pause) | `transient 1/20` twice, never broken; call 4 logged `keeping the previous state (1 active)`; the pause lasted until the busy job was killed (resumed 3.7 s after the kill, pause 45 s); `failsTotal 2`, `fails 0` |
| slot take, forced failure at the first probe | slot given back ('probe failed, state unknown'), retried, the busy job then detected and waited for; slot taken 9.1 s after the job was killed |
| give-up threshold (`AG_GPU_FOREIGN_MAX_FAILS=3`, all probes failing) | 2 x transient, then 'failed 3 times in a row; continuing without it' in both `foreignGpuJobs` and the watch |
| afterwards | scratch queue tickets 0, slot free |

  The first attempt of the test was confounded by a REAL foreign job (another session's `node tools/perf.mjs`, 01:31: 61 s CPU per
  window in its GPU process), which is why `AG_GPU_FOREIGN_ONLY` exists.

### 10.3 The FINAL snapshot `build/snap/final`
- `node render/snapshot.mjs --out build/snap/final` (01:37) from the live tree after the N cap: hash **47b456cd03e3da91**;
  hand track gate OK (handtrack perf = perf.json = g1f 150017f6, not regenerated); motion N boost re-solved for the new
  edit N: **132 frames, +3,792 sub-frames** (S08 47, S16b 28, S13 22, S22 11, S06 8, S02 7, S14 4, S24 3, S11 2), rendered
  copy spacing max 1.00 px, 0 frames > 2 px (`build/snap/final/blurstep.json`). The re-solved table was copied back to the
  live tree, so live = final (the launcher checks it, 10.5).
- Content diff final vs integ6b over scene/, assets/pianist/, music/final/, build/anim/ (MD5 of every file): exactly
  `scene/src/camera/shots.js` (the 10 N values + comments) and `scene/src/integration/motion_n.json` (re-solved); the
  pianist GLB with the restored sleeve-button extras (9.4), perf, score, world, piano and everything else are identical.
  Before the freeze the live tree differed from integ6b only in motion_n.json's `generated` / `command` fields.

### 10.5 Launch command and environment (`sandbox/integration/final_render.ps1`, `FINAL_RENDER.md`)
The planned launch (`node render/film.mjs render --preset final-1080p` alone) left out three settings; the launcher adds them:
1. **Serve root**: `$env:AG_SERVE_ROOT = build\snap\final` (never the live tree). The launcher also refuses to start when
   the live files film.mjs reads for the frame count and chunk grid (`shots.js`, `film.config.js`, `handtrack.json`,
   `motion_n.json`, `score.json`, `perf.json`) differ from the snapshot's, or when `build/chunks/film_1080p` holds a
   manifest with inputs outside `build/snap/final/` (encode.mjs keys inputs by path: chunks of two snapshots would not be
   flagged there).
2. **Lock wait limit**: `$env:AG_GPU_WAIT_MIN = '600'`. With the default 90 min, `acquireGpu` throws (gpulock.mjs l.282),
   render.mjs marks the chunk failed after 3 attempts and film.mjs exits on the first failed group, so a long foreign render
   would end the overnight render.
3. **Resume / verify**: `film.mjs render` re-runs until exit 0 (max 10 tries, 60 s between); every run after a failure,
   and the first run when chunks already exist (relaunch after a kill or reboot), adds `--verify` (render.mjs re-hashes each
   complete chunk against its manifest sha256; without it a chunk is checked only for size, frame count and settings,
   and encode.mjs decodes the same chunks, so a chunk damaged by a bugcheck would pass both). The render counts as done
   only after a `--verify` pass exits 0; then `film.mjs encode --preset final-1080p` (encode.mjs with
   `build/audio/afterglow_film.wav`, offset 0, verification on; exit 1 when a check fails).
- `-DryRun` runs the guards + env + plan only: passed at 01:41 (snapshot hash, live = snapshot, plan 13,857 frames /
  473,760 sub-frames, one foreign job noted). The full launcher (render + verify + encode) was not run in this pass (the
  full render is not part of it); the smoke test (10.6) ran the same film.mjs render / encode commands on frames 0-120.
- Not done (decision): copying the 3 integ6b chunks into `build/chunks/film_1080p` (planned to save ~25 min): they are
  from a different edit N / snapshot (10.1).

### 10.4 Checks on `final` (v9: gates, wiring 9, sync 30, stills of all 26 shots) and the N-cap A/B against v8
`pwsh -File sandbox/integration/queue8.ps1 -Step v9` = `check.mjs --size 1080p --N own --sync 30 --out
sandbox/integration/out/v9` on `build/snap/final` (START 01:38, slot + shared lock at 01:44, done 02:34: 54.3 min, of which
**9 pauses = 40.2 min** for foreign headless renders, 0 probe failures), then contact.py, compare.py, modmetrics.py.
- **Gates (CPU, served perf g1f):** restrike OK (175, min rise 0.563), keyonset OK (1131/1131), handtrack OK (150017f6),
  **motionstep OK** at the new N (132 boosted frames, rendered max 1.00 px, none > 1 px; without the boost the capped edit
  would have 26 frames > 2 px, max 3.93 px in S16b), **flicks FAIL 71 / 9 / 2** (perf I-37, unchanged from g1f / v8).
- **Wiring 9/9 OK** (incl. check 9: boost table solved from this perf and edit, 132 frames, +3,792); pianist tailoring
  buttons 10 / cuffs 2 (the restored GLB extras).
- **Sync 30 notes:** identical to v8: key bottom within one frame 30/30 (p50 +0.6 ms, -4.6..+10), fingertip on its key
  30/30 (gap p50 0.15 / max 0.63 mm), hammer at the string 24/30 (I-09), dampers 30/30 + after release 13/13, pedal vs CC64
  r = 1, right foot vs pedal r = -0.9995 (9.5 mm).
- **Stills (52) and compare.py:** mean of the 26 ref pairs **59.3** (v8 59.3; S06 / S24 equal to 0.1), `out/v9/contact_1-4.jpg`.
- **A/B N cap** (`.venv/Scripts/python.exe sandbox/integration/ab_ncap.py sandbox/integration/out/v8 sandbox/integration/out/v9`
  -> `out/v9/ncap_ab.json`, `ncap_ab_1.jpg`, `ncap_ab_2.jpg`): the **32 stills of the 16 unchanged shots are bit-identical**
  to v8 on integ6b (rgbaSha256): the final snapshot renders everything else exactly as reviewed. The 20 stills of the 10
  capped shots differ by a mean of 0.30-1.54 code values (p99 4-23; 0.9-8.9 % of pixels > 4), all of it sampling noise in
  defocused water, bokeh and edge highlights; the 5x5 high-pass rms (noise energy) is unchanged over the frame (N32 / N48
  median ratio 0.994) and slightly LOWER in the tile where the two differ most (0.93: the layered gap-fill blurs a little
  more at lower N). Viewed: the worst-tile crops at 2x (N48 | N32 | diff x8) for all 20: indistinguishable by eye (S13 /
  S15 / S20c / S21 defocused water, S08 / S16b / S24 edge highlights with the same beads in both, S22 the moving hand's
  blur with the same smoothness).
- Review stills of the final snapshot: 10.7.

### 10.6 Smoke test of the final command (frames 0-120) and the verify path
`pwsh -File sandbox/integration/queue8.ps1 -Step smoke` = `film.mjs render --preset final-1080p --from 0 --to 120 --chunks
build/chunks/smoke_final` + `film.mjs encode ... --out build/out/smoke_final_0_120.mp4` with the launcher's env (serve root
final, wait 600 min). Separate chunk dir on purpose: 0-120 is off the 300-frame grid (encode.mjs would see an overlap).
- Chunk: 120 frames, 196.5 MB, settingsHash 6c97b724bd8bdf60 (the full render's), inputsHash 466e3c58b257fbb4, all 69 inputs
  under `build/snap/final/`; init 4.2 min; 6.80 s/frame wall incl. 540 s of foreign pauses (66 %), 2.3 s/frame rendering.
- Encode + verify: **ALL CHECKS PASSED** (PSNR avg 47.2 / min 43.7 dB, identity 74 / 0 violations, RGB BT.709, tags, AAC,
  duration; provenance consistent, 69 inputs). Audio checks trivial here (0-2 s is inside the WAV's 4 s silent lead-in).
- `sandbox/integration/smoke_check.py` -> `out/smoke/smoke.json`: chunk frame 96 is **bit-identical** to v9's S01 still f96
  (pre-roll determinism on final); MP4 frames 0 / 60 / 96 / 119 viewed (`out/smoke/strip.jpg`, `mp4_f119.png`): the 1.6 s
  fade-in (mean luma 0.2 -> 85.5, then flat within 0.2) and a clean S01 vista.
- Verify path: `--verify` on the complete smoke chunk SKIPs it (exit 0, no browser); a same-size copy with 4 KB flipped
  mid-file is SKIPPED as complete without `--verify` and is `TODO ... verify failed` with it (scratch lock held by a dummy
  process, so no browser started).

### 10.7 Review stills of the final snapshot (`build/review/`)
`.venv/Scripts/python.exe sandbox/integration/review_stills.py sandbox/integration/out/v9 build/review`: 26 shot stills
(`01_S01_vista_ref10_f00096.png` ... `26_S25_blue_hour_ref01_f13264.png`; for a shot that realises a reference the frame with
the higher compare.py score, otherwise the middle frame, S14 the first frame by eye) + 4 hand close-ups (`hands_1_S04 ..`,
`hands_2_S06 ..`, `hands_3_S24 ..`, `hands_4_S16b ..`: the other frame of those shots), all 1920x1080 PNG, rendered from
`build/snap/final` at the film's settings; `index.json` (source, frame, N, compare, sha256), `_contact_sheet.jpg` (viewed).

### 10.8 Foreign GPU load during the freeze, and what it means for the deadline
v9: 9 pauses, 40.2 min of a ~50 min session; smoke: 6 pauses, 66 % of its chunk; at 02:12 four foreign headless GPU jobs ran
at once (QA / perf scripts `tools/perf.mjs` + `syncshot.mjs` + `pyprobe.mjs`, a `tools/render.mjs --mode=frames --width=1920`,
`tools/shots.mjs`, `.work/shot.mjs`, an `inspect.mjs`), and the other projects' `heavy.mjs` jobs held the shared lock
for 57 min before the smoke test got it. 0 probe failures in this pass. At ~13.4 h of own rendering the film takes ~20 h at
a 33 % foreign share and ~40 h at 66 %: the render must end by ~21:00 (latest start ~07:30 on a quiet GPU), so the deadline
depends on the user pausing those sessions (push 01:33). Not our processes: not touched. The guard is not switched off.

### 10.9 Module-file parameter changes in this pass (before / after)
| file | change | before | after | evidence |
|---|---|---|---|---|
| `scene/src/camera/shots.js` (camera) | lens N of S06 S08 S13 S15 S20b S20c S21 S22 S24 / S16b | 48 / 64 | 32 / 32 | 10.1, 10.4 (32 unchanged stills bit-identical, capped ones indistinguishable); `final_ncap.mjs`, backup `bak_pre_final/shots.js` |
| `scene/src/integration/motion_n.json` (integration, regenerated) | boost table re-solved for the new edit N | 68 frames, +1,616 sub-frames | 132 frames, +3,792; rendered max 1.00 px | gate motionstep OK, wiring check 9 |
| `render/lib/gpulock.mjs` (integration tooling) | foreign probe failures transient | 1 failure -> guard off | 20 in a row -> guard off; failure keeps the last state | 10.2 |
