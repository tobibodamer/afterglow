# WORLD module (`scene/src/world/`) — v2, 2026-10-21 (session 4)

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

Sky, clouds, terrain, shores, boulders, mist, water and lake bed for Afterglow. Everything is procedural (no external
assets, nothing to add to CREDITS.md) and deterministic: every pixel is a pure function of film time `t` and of the
sub-frame index (glossy-reflection jitter). No `Math.random`, `Date` or `performance.now` anywhere in the module.
Bit-identical across sessions / render order was verified in session 1 (`sandbox/world/out/det_a|det_b`).

Status: plugged into the production core (`scene/src/main.js` loads it as the `world` slot); every number below is
measured THROUGH the core (`sandbox/world/harness/corevar.mjs` / `corestill.mjs`: scene/index.html + render/lib,
final pass with exposure 1, veiling glare, PBR Neutral, sRGB). The world has **no sun light**: the sun is below the
horizon for the whole film and the sky dome is the only light (section 6 says what that means for the piano).

## 1. API

```js
import { create, ENV_LAYER, pianoToWorld } from './world/index.js';
const world = await create(ctx);   // ctx = core ctx: renderer, width, height, quality, options.world, scene, camera,
                                   // rigGroup, sun, registerSkyBake, registerEnvCapture (all optional standalone)
scene.add(world.group);
```

With the core, the module wires itself (RENDERING.md section 3): `registerSkyBake` calls `world.prepareFrame(t,
{ camera: ctx.camera, frame })` once per output frame with the frame-centre camera, and a `registerEnvCapture` hook sets
`ctx.scene.environment = world.envMap` (turn off with `options.world.setSceneEnvironment = false`). Standalone,
`update()` calls `prepareFrame` itself on sub-frame `k === 0` when `sub.frame` and `sub.camera` are given.

| member | |
|---|---|
| `group` | everything (dome, terrain, boulders, water) |
| `prepareFrame(t, {camera, frame, env?})` | per output frame: sun + clouds, sky bakes (view, mirror, cube), SH9, glow light, env capture + PMREM, ripple upload |
| `update(t, {k, N, frame, camera})` | per sub-frame: shutter time for the water, sub-frame index for the glossy jitter |
| `envMap` | PMREM (sky + clouds + terrain + boulders + mirror lake), captured at `bake.envPos` every output frame (a pure function of the frame; no `envEvery`). Piano / pianist are never in it (not on `ENV_LAYER`) |
| `envCube` | the raw env capture cube (before PMREM), for probes / diagnostics |
| `skyCube` | sky + clouds cube (scene-linear, half float) |
| `glowLight` | `{ direction, irradiance, radiance }` (THREE.Vector3, scene-linear) of the horizon glow this frame, for art-directed kickers / rims (section 6) |
| `setRippleEvents([{ t, x, z \| pos: [x,0,z], amp, wavelength?, space? }], { space = 'rig' })` | ring packets, film time (s), amp = height (m). `space`: `'rig'` (default: rig-local x/z, re-projected through `ctx.rigGroup.matrixWorld` every frame, so rings stay at the legs across per-shot rig-yaw cheats), `'piano'` (physical X = treble, Y = toward the tail) or `'world'`. Empty / null restores the defaults |
| `setPerfRipples(perf.ripples)` | the performance solver's events (build/anim/perf.json `ripples`, rig frame) through `rippleEventsFromPerf` (conversion below) over a faint default stream; `info().ripples.source` = `'perf'` |
| `setEmitters([{ x, z, amp, wavelength, radius?, phase?, space? }], { space = 'rig' })` | continuous micro-ring sources (legs, bench legs, shoes), max 16 |
| `setSunElevation(deg \| null)` | pin the sun; `null` = core `ctx.sun.elevationDeg` (film arc + per-shot override), else `params.sunKeys` |
| `setBedCenter(x, z)` | where the lake bed is shallowest (default: under the lyre, follows the rig) |
| `sunDirection`, `heightAt(x, z)`, `info()`, `stats`, `params`, `sharedUniforms`, `terrainMaterial`, `dispose()` | |

`ENV_LAYER` (5): world objects are on layers 0 and 5; env captures see only layer 5.

Ripple sources: by default (no events given) one short packet every 0.6 s (lambda 7-13 cm, 3.5 mm) and one long ring
swell every 2.6 s (0.35-0.75 m, 6 mm) from the lyre, plus 9 micro emitters (legs, bench legs, shoes; lambda 3.5 cm,
0.35 mm, radius 0.4 m). With the core the defaults follow `ctx.rigGroup` (base yaw + per-shot cheat; physical piano
frame X = treble, Y = toward the tail maps to rig local (-X, 0, Y)). The integrator should map note onsets to short
packets and bass downbeats / pedal changes to long ones; the long ones are what makes concentric ellipses visible in
the LOW shots (10 cm rings are sub-pixel at grazing angles).

**Performance-solver ripples (wired, session 6/8).** The integrator (`scene/src/integration/index.js`) calls
`world.setPerfRipples(perfMeta.ripples)`; standalone, `create()` does it itself when `ctx.data.perfMeta.ripples` exists
and `water.perfRipples.use` is true (`false` keeps the default stream only). perf.json lists
`[{ t (film s), m (music s), pos: [x, 0, z] (RIG frame, m), amp (m, solver estimate 0.12-1.14 mm), src }]`
(src: legBass, legTreble, legRear, lyre, footR, benchFront, benchFront2; 334 events in the current solve).
Conversion (`rippleEventsFromPerf`, params `water.perfRipples`):

| perf.json | world event |
|---|---|
| `t` | `t` as is (film time; the packet is born at t and ages with the shutter time) |
| `pos[0]`, `pos[2]` | `x`, `z` with `space: 'rig'` (re-projected through `ctx.rigGroup` every frame, so the rings follow the per-shot rig-yaw cheat and stay at the legs) |
| `amp` | `amp x gain` (gain 6: the solver's physical estimate -> the packet height the ring look was tuned with on refs 1/3/5/6) |
| — | `wavelength`: short packets 0.09-0.15 m (Halton per event index), right foot (`src` foot*) 0.07-0.10 m |
| `amp >= longAmp` (0.5 mm), not foot | a second LONG ring at `t + 0.03` s, wavelength 0.35-0.75 m, amp x gain x longGain (1.6): the flat concentric ellipses of the low shots |
| — | plus the default stream x `background` (0.6) so the field never goes flat between phrases |

Events are merged (same source, same kind, < 2 cm, within the merge window) and the 40 uploaded per frame are picked by
peak contribution, faded by age (maxAge 16 s), never dropped while visible. `integration.probe({ t, ripples: true })`
returns the packets the water shader received at a film time.

## 2. Frames and conventions

World frame as DESIGN.md section 2: y up, water y = 0, azimuth A clockwise from above, A = 0 is the sun, horizontal
direction (sin A, 0, -cos A). Sun elevation keys (`params.sunKeys`, same as core DEFAULT_SUN_KEYS):
+0.6 -> -1.0 -> -1.6 -> -4.5 deg. Camera far plane >= 60 km (terrain to 52 km; the dome sits at min(0.9 far, 50 km)).
Call `prepareFrame` with the UNJITTERED frame camera (the core's sky-bake hook does).

## 3. How it works

### Sky (`sky.js`, `skytable.js`, `cloudmap.js`)
- **Clear sky = measured table**: `sandbox/world/tools/skyfit2.py` + `skytable.py` fit a 15 x 20 (azimuth from the glow
  x elevation) grid to the plate refs 2/3/9/10 plus palette pseudo-points for what no ref shows (zenith #1A2040,
  anti-sun #2E3660, glow core #FEC391 within +-8 deg, coral to +-20, rose/violet to +-35); the display table is inverted
  through PBR Neutral into a float LUT. Sun elevation s: base gain exp(0.18 (s+1)), glow gain exp(0.42 (s+1)), arch
  compressed exp(-0.11 (s+1)), blue-hour tint below -2 deg (base [0.72,1,1], glow [1,0.72,0.62]).
- **Clouds**: 2-D altocumulus layer at 4.5 km on a spherical shell. Coverage is ART-DIRECTED: `cloudmap.js` is a
  signed-azimuth x elevation map fitted to the plate's cloud mask (`tools/cloudmap.py`, `cloudmapfit.py`), drifting
  with the clouds; the field is thresholded at its exact (1 - coverage) quantile (`tools/cloudcalib.py`, a numpy port of
  the GLSL noise). Field = envelope (clumps in loose bands along A +20, stretched **6:1** since session 4, x lobes) x 0.82
  + Worley floccus tufts (two octaves) x 0.18, domain warped, drifting 8 m/s along the bands. Lighting: 6-tap 2-D light
  march toward the sun on the envelope (rims on the sun-facing lower edges), only the sun-facing fringe of each puff lit,
  isolated puffs stay dark; Earth-shadow terminator on the layer (golden at +0.6, salmon at -1, all shadowed except
  toward the sun at -4.5). Palette (display): lit low #F99A82/#D06A72, lit high #BD8097/#8E678B, bodies
  #523454/#3C2C4A, anti-sun #3A3657/#6A5675, overhead undersides #FEA070 x 1.3 from 15 deg (HDR, seen in ref 6's water).
- **Fix round 1 (sessions 5-8)**: the field is near-isotropic (band A 20, stretch 1.8, map gain 0.9: f06 r18m8; stretch 6
  across the view gave venetian-blind streaks, A 110 cost ref 6 its mottled reflections). Session 8 (g04/g05): BIG MASSES =
  envelope scale 1.6 km, envelope weight 0.92 (the quantile tables were fitted for 0.82; the measured coverage still
  matches ref 10: 0.279 vs 0.277), floccus tufts 0.35 km, edge softness 0.12, bodies x0.85 (`bodyGain`), upper lit edges
  x0.75 / x0.85 (`litHighGain`; the bright fringes belong to the low clumps near the glow); an underside band (`litBand`:
  lit within 400 m of each clump's sun-side edge, no rims beyond |A| 60); a clear band above the ridges
  (`clearBand`). **Cloud slab** (session 8, `clouds.slab` = [thickness km, march step km, heap exponent, wall
  darkening], `uSlab`; thickness 0 = the old flat layer): every clump is a column whose height grows with its envelope
  density; a ray that passes the base between clumps marches up through the slab (front to back, <= 12 steps) to the first
  column wall. Near the horizon the walls make the big dark masses of the refs (a flat layer foreshortens every clump to a
  thin streak); the base keeps the lit underside band, walls are shaded at their own point (dark, only their foot lit).
- **Terrain erosion** (session 7-8, `terrain.erosion`, `terrain.js erosionAt`): slope-aligned branching ribs / couloirs
  in the GEOMETRY, octave by octave along the eroded fall line (dendritic), faded where the mesh cannot resolve them;
  `gullySnow` (0.6) turns ribs to rock and couloirs to snow, `rockInSnow` strength 1.0 (massif p95 128 -> 108, ref 65). k 0.12 grew
  a needle forest on every skyline: k 0.045, sharp 0.35.
- **Bakes per output frame**: view bake (frame camera + 8 % margin), mirror bake (the Reflector's virtual camera), sky
  cube (512 preview / 1024 final). The dome samples view bake -> mirror bake -> cube, so clouds cost nothing per
  sub-frame. Env capture: `bake.envSize` cube (preview 256, final 512) at `bake.envPos` (layer 5, dome in env mode: sky cube above, Fresnel-weighted mirror
  lake below) -> PMREM -> `envMap`. SH9 of the clear sky + lake for terrain, boulders and the lake bed.

### Terrain (`terrain.js`, `boulders.js`)
- One height function from layout features (`params.terrain.features`), heights given as ELEVATION ANGLES read off the
  plate: near headland left (A -75..+4, shore 0.65-1.5 km), left dark peak (A -3.7, 12 km, 4.5 deg), left dark chain
  (11.5-14.5 km), low hazy chain at the far end of the lake (13.5-17.5 km), mid layer (20-26 km), central far snowy range
  (29-40 km, 7 summits 2.9-4.05 deg + chain), right snowy massif (A +28.5, 20 km, 5.9 deg + satellites + chain), right
  dark peak (A 24.6, 9.5 km), right mid chain (7-10.5 km), right near hills + boulder shore (0.43-0.6 km), left massif
  (A -29, 6.3 deg), ring of mountains elsewhere. Every peak is an alpine pyramid (aretes + planar faces + apron + ridged
  gullies + rock ribs), chains are serrated rows of such peaks.
- Polar mesh patches, culled at build time (under water, facing away, below the skyline from the lake):
  **0.35 M terrain triangles** (cycle 3 round 2, guard-band culling; 0.40 M before) + 820 fractured boulders x 720 tris
  (**0.59 M**, fix round 2) = **~0.94 M** main, plus the env-only mirror copies (layer 32) of terrain + boulders (~0.94 M) =
  **~1.9 M per sub-frame** (critic c3.json at f5062: 9,021 draw calls, 13.9 M tris per sub-frame for the whole scene; timings
  fine, 60-80 ms per sub-frame at 1080p). Budget restated: ~1.0 M main + ~1.0 M env mirror. Build 15-25 s in node (incl.
  guard bands and the chamfer opening), ~7-10 s in the page.
- Patch seams (cycle 3 round 2): every patch edge that adjoins another patch gets a GUARD band (`terrain.guard`: radially
  min(2 km, 0.2 d), 3 deg sideways); erosion, the crest opening, local max, normals, AO and the crest flag run on the extended
  grid, only the core is emitted, and the inner core row is WELDED to the previous patch's outer row (heights linear in
  azimuth, then normals / smoothed normals / AO / convexity / gully, faded over `weldRows` 4 rows).
- Shading: rock / granite (shore band < 25 m) / snow albedo x SH irradiance x concavity AO, detail normals, snow by
  height + slope + concavity + streaks (dark: lavender-navy, never pink), crest light from the glow side, a neutral dark
  floor (section 5), then the atmosphere: valley haze (7.8e-5 /m, H 250 m, from 2.5 km, navy), distance layer (5e-5,
  H 2.5 km, from 16 km, violet), in-scatter = the sky at 20 deg (10 deg toward the sun) in the point's azimuth with a
  forward-scatter boost (warm mauve sun side, navy anti-sun), blending to the sky behind beyond 80 km; low mist
  (#423E62 / #4A4268 sun side, H 70 m, 1.5-5 km) = the band over the far water and the lines at far shores. The medium
  is mirror-symmetric about y = 0, so the reflection gets the same haze.

### Water (`water.js`)
- three.js `Reflector` per sub-frame (inherits the jittered / sheared projection) with a depth texture.
  **Session 3 fix**: the water point is reconstructed per pixel from gl_FragCoord + camera rotation + projection terms
  (incl. jitter / shear) + viewport (`ag_waterPoint`); interpolating it over the 120 km quad was off by metres on
  ANGLE/D3D11, differently per sub-frame, which smeared the reflection and erased the piano's mirror image at N > 1.
- Parallax-corrected lookup (reflection depth -> distance to the reflected surface -> re-project the perturbed ray).
- Normals (analytic slopes): ring packets with omega^2 = g k + (sigma/rho) k^3 (stationary phase: the k whose group
  velocity is r / tau, Newton on cg(k); gaussian band around the event's k0; 1/sqrt(r) spreading, field radius `ring.fieldRadius` = 8 m),
  up to 40 events; 16 micro emitters; 6-component swell (0.28-1.9 m, a few mm) visible from ~1 m to 40-160 m (beyond:
  mirror); irregular wind-wave chop (**0.04 @ 2 m**, crests stretched across, fades 150-400 m: the refs' waves stay bold far out); wind micro-normals (**0.12 slope @ 5 cm** since session 4, 3
  octaves, diagonal streaks). Every component is band-limited by the pixel footprint in its own direction; the removed
  variance becomes capped glossy roughness. Glossy lookup: the Reflector target is mipmapped every sub-frame; 4 FIXED prefiltered taps along the long axis of the lobe, read at the LOD of the short axis (no jitter, no stochastic taps). Fix round 2: near reflected objects (reflection depth D < 5-30 m, `water.reflSharp`) keep x0.15 of the roughness.
- Fresnel (Schlick, exposed F0) by camera depression, a far mirror (Fresnel -> 1 x 0.8 from 12 to 60 m), the
  art-directed glitter path, bright / dark reflection tints (section 5).
- Lake bed: dark rounded pebbles (Worley, 4.5 cm) through clear water, depth 0.04 m under the lyre sloping 1.3 cm/m to
  0.6 m, refracted lookup, Beer-Lambert (9, 5.5, 4.2 /m), lit by the SH and shadowed by whatever darkens the
  reflection (the piano above it); `bedGain` 3 so ref 6's pebbles under the piano read.

## 4. Parameters (`params.js`; all overridable through `options.world`)

| group | key | default | meaning |
|---|---|---|---|
| | `exposure` | 1.0 | exposure the display targets assume (= core `exposure` 1, EV 0) |
| | `sunKeys`, `sunElevationOverride` | see 2, null | |
| sky | `gainBaseK`, `gainGlowK`, `archK`, `glowWidthDeg`, `glowHeightDeg` | 0.18, 0.42, 0.11, 32, 9 | sun-elevation response |
| clouds | `altitudeKm`, `bandAzimuthDeg`, `windKmPerS` | 4.5, 20, 0.008 | |
| clouds | `mapGain`, `envWeight`, `tuft2Weight`, `isolatedRim` | 0.95, 0.92, 0.2, 0.1 | coverage map gain, field mix |
| clouds | `bandScaleKm`, `bandStretch`, `lobStretch`, `tuftScaleKm`, `edgeErosion` | 1.6, 1.8, 1.667, 0.35, [0.06, 0.09] | shapes |
| clouds | `softness`, `envSoft`, `opacity`, `lightStepKm`, `lightAbsorb` | 0.10, 0.10, **2.5** (c3r2; was 6), 0.22, 4.5 | |
| clouds | `litBand`, `litGate`, `bodyGain`, `litHighGain` | [0.25,0.42,55,0.25], [45,65,12,20], 0.85, [0.75,0.85] | lit underside band / gate |
| clouds | `holeFill`, `rimPx`, `core`, `inner`, `mapCubic` (c3r2) | [0.3,0.75], 5, [0.6,0.8,1,1], [0.15,0.4,0.5], 1 | no lit holes, thin rims, navy cores, interior lumps, bicubic map |
| clouds | palette, `topGain`, `topLoDeg`, `sunWidthDeg`, `shadowLoKm/HiKm` | see file | |
| bake | `viewScale`, `viewMargin`, `reflScale`, `cubeSize`, `envSize`, `envPos` | preview 1, 0.08, 0.5, 512, 256; final (`byQuality.final`) 1.25, 0.08, 1, 1024, 512; [0,1.4,0] | use `reflScale` 1 and `cubeSize` 1024 for finals |
| haze | `density`/`scaleHeight`/`startM`, `density2`/`scaleHeight2`/`start2M`, `elevDeg`/`elevSunDeg`, `phase`/`phaseWidthDeg`/`phaseBase`, `farKm`, `antiTint` | 6e-5/250/2500, 5e-5/2500/16000, 20/10, 0.6/21/0.45, 80, [0.75,0.97,1.1,5] | |
| mist | `color`, `colorSun`, `density`, `height`, `startM`, `fullM` | #423E62, #4A4268, 5e-4, 70, 1500, 5000 | |
| terrain | `snowLine`, `snowFeather`, `snowSlope`, `snowConcave`, `snowAlbedo`, `snowLook`, `snowLedge` | 1100, 220, [0.50,0.75], 2.5, [0.75,0.88,1.15], [1,1.4,0.75,0.6], [45,0.55] | |
| terrain | `rockAlbedo`, `graniteAlbedo`, `graniteTop`, `darkFloor`, `rimGain`, `bumpNear/Far`, `aoStrength` | [0.09,0.11,0.12], [0.20,0.20,0.23], 25, [0.012,0.012,0.013], 1.6, 90/45, 0.75 | |
| terrain | `crestSmooth` (c3r2: `cone` 'chamfer', `slope` 1.75, `cutMin` [1,3], `crestAA` 1), `guard` ({on 1, metres 2000, frac 0.2, deg 3, weldRows 4}), `antiAmbient` [0.6,0.8,1.35,1] / `antiSnow` 0.7 | | Euclidean cone opening, seam guard + weld, navy anti-sun irradiance |
| water | `F0`, `reflGain`, `reflGainFar` / `F0High`, `reflGainHigh`, `highDepression` | 0.30, **1.08, 0.92** / 0.80, 1.0, [12,38] deg | Fresnel by camera depression; gain near -> far over the far-mirror range (new in s4) |
| water | `tint`, `tintDark`, `farMirror`, `glitter`, `glitterK`, `glitterFade` | [0.96,0.86,0.93], [0.85,1,1.05], [12,60,0.8], 0.7, 0.2, [80,250] | look terms (5) |
| water | `swell`, `swellFade`, `chop`, `chopFade`, `wind`, `bandLimit` | 6 comps, [1.5,160], **[0.04,2.0,2.2], [150,400]**, **0.12 @ 0.05 m**, [1,2] | |
| water | `roughNear`, `lostRoughCap`, `reflSharp`, `shortCrest`, `reflFloor`, `ringLow`, `ringSteep` | 0.004, [0.0015,0], [5,30,0.15], [1,1,15,0.5], [0.6,18], 1.6, [0.5,0.6] | |
| water | `nearRefl` (c3r2), `sunSide` (c3r2) | [0.5,3,8,0.12], [1.2,25] | piano mirror image: lookup slope x0.5 and bed occlusion 0.12 for D < 3-8 m (low views); reflection gain x1.2 toward the sun |
| water | `ring` (`fieldRadius`, `damping`, `kBand`, `maxEvents`), `defaultEvents`, `defaultLongEvents`, `micro*` | 8 m, 0.02, 0.6, 40; 0.6 s / **3.5 mm**; 2.6 s / 6 mm; 0.35 mm, 3.5 cm, 0.4 m | |
| water | `depthAtPiano`, `depthSlope`, `depthMax`, `absorb`, `bedAlbedo`, `bedGain`, `bedOccMin`, `pebbleSize`, `deep` | 0.04, 0.013, 0.6, [9,5.5,4.2], [0.15,0.14,0.14], 3, 0.4, 0.045, #0B101C | |

## 5. Look decisions that are not physics (on purpose)
- **Display-referred palette**: colours are targets after exposure 1 + PBR Neutral + sRGB, inverted to scene-linear
  (`util.invNeutral`). If the core changes the tone map, re-derive.
- **Snow albedo > 1 in blue** ([1.0, 1.25, 2.0]): physical snow in sky-shade comes out too dark against the refs' snow
  p98 #3D4A78; the snow stays lavender-navy, 0.6-0.75 x the sky behind it.
- **Neutral dark floor** (scene-linear (0.012, 0.013, 0.018)) on terrain / boulders: PBR Neutral's toe over-saturates
  physically dark sky-lit rock; with the floor the near headlands land on the refs' near-neutral #0C0F1D-#101323.
- **Fresnel by camera depression**: F0 0.30 / gain 1.08 near (0.92 beyond 12-60 m) below 12 deg of depression, F0 0.80 above 38 deg (ref 6's lake is a
  far brighter mirror); the far lake is pushed toward a mirror (x 0.8 from 12 to 60 m).
- **Glitter path**: where the reflection sees open sky (depth > 0.3-3 km), reflected elevation 1.5-13 deg, within ~24 deg
  of the sun and < 80-250 m from the camera: add 0.7 x the excess of the sky at 0.2 x the elevation, so the warm glow
  streaks down the water as in refs 2/3/10.
- **Long ring swells** (0.35-0.75 m) and wind micro-normals stronger than a calm lake would have (ref 6's mottled
  reflection, the low shots' texture).
- **Per-shot rig cheats** used for comparisons (refs.md section 4): ref 10 +2.6, ref 2 -0.6, ref 3 -46 (base -45),
  ref 9 +5.8 deg (core `rigYawCheatDeg` = -(refs.md cheat)).

## 6. Lighting for the piano and the pianist (USER_FEEDBACK item 1)

There is no sun light. What other modules get from the world:

1. **IBL**: `world.envMap` (scene.environment, set every frame) or their own probe of layer 5 (the piano's CubeProbe
   sees exactly the same content). Measured at the piano (`sandbox/world/harness/envprobe.js`,
   `sandbox/world/out/v15/envprobe/js_result.json`), scene-linear luminance, sun -1 deg:

   | direction | env L | note |
   |---|---|---|
   | glow, A 0, e 4 deg | **1.05** (RGB 2.03 / 0.84 / 0.29) | the brightest thing; a band ~+-20 deg x ~4 deg above the far ridges |
   | valley gap, A 0, e 0 | 0.49 | the far water horizon |
   | lake toward the glow, e -2..-4 | 0.53-0.70 | its mirror image |
   | sky e 10 / 20 / 45, toward the sun | 0.26 / 0.13 / 0.06 | |
   | sky e 10-20, A 60-180 | 0.06-0.10 | cool anti-sun hemisphere |
   | zenith | 0.066 | |
   | mountains / shores, e 0-2, most azimuths | **0.02-0.04** | the horizon band all round is DARK terrain |
   | lake straight down / at -15..-60 deg | 0.03-0.07 | |
   | irradiance / pi: up / facing the sun / facing away | 0.061 / 0.082 / 0.045 | |

   Sun +0.6: about x1.5 (glow 1.9); sun -1.6: about x0.8; sun -4.5 (blue hour): glow 0.18, irradiance/pi 0.026.

2. **Horizon glow light**: `world.glowLight` (new in session 4): direction (A 0, e ~5 deg), irradiance on a surface facing
   it (sun -1: (0.173, 0.069, 0.074); +0.6: (0.337, 0.127, 0.118); -4.5: (0.039, 0.021, 0.030)) and peak radiance
   (sun -1: (2.21, 1.05, 0.37)). The env already contains this light, so a kicker built from it is art direction; it
   ignores terrain occlusion (the dark peak at A -4 hides part of the glow from the piano).

What that means. **PBR Neutral has a strong toe**: for a near-grey input g < 0.08 it outputs 6.25 g^2 (it subtracts
the min channel minus 6.25 min^2), so grey 0.02 -> display 8/255, 0.045 -> 30, 0.085 -> 60, 0.23 -> 120. Dark,
low-chroma pixels are crushed much harder than a plain sRGB curve suggests (that is why the terrain has a dark floor).
- A physical clear coat (F0 0.06) reflecting the mid sky (0.06-0.13) returns 0.004-0.008: the toe maps that to display
  0-2, i.e. pure black. To show the refs' sky-coloured sheen on the lid top / case at display ~30-60 the coat must
  return 0.045-0.085, i.e. **0.5-1 x the sky it mirrors**. So the piano must art-direct the coat in wide shots (refs
  2/4/9/10/11), not the world: **clear-coat env intensity ~x8-12 on the coat lobe only (or coat F0 ~0.4-0.5) for the
  lid top and case in wides**, tapering to the physical 0.06 in close-ups. Boost only the coat, never the base: where
  it mirrors the dark mountains (0.02-0.04) the case stays black, which is also what gives the reflections structure.
- The glow (L 1-2) is already strong enough for highlights: at F0 0.06 it returns 0.06-0.12 (display 45-75) and at
  grazing incidence (F 0.3) 0.3-0.6 (display 140-190).
- Vertical faces (case side, legs, lyre) mirror mostly the dark horizon band and the lake; they only light up where
  they see the glow (A 0) or its lake image. Thin bright highlights on the lid edge / rim cap / desk edge come from the
  glow at L 1-2: they need fillet normals that sweep through A 0, e 0-6 deg, a probe of 512+ px per face, and a
  roughness <= 0.03 on the coat. If that is not enough, add a kicker from `world.glowLight` (direction as given, colour =
  irradiance x 2-4 for wides) that drives ONLY the clear coat / specular, so it adds edge highlights without greying
  the black.
- **Pianist**: diffuse sky irradiance is ~0.06-0.08 x pi; a black suit (albedo ~0.04) returns ~0.003 -> crushed to a
  silhouette by the toe, which matches the refs, but hands, face and hair edges need a rim: use `world.glowLight` as a back / rim light
  (colour = irradiance x 1.5-3) with a wrap / sheen term on cloth and skin; env intensity 1.5-2 on skin is acceptable.
- **Do not raise the global exposure** to brighten the piano: the sky and the glow are tuned for exposure 1.0 (the glow
  core already maps to display ~250, and the grade stats in section 7 would break).

## 7. Validation (latest)

**Fix round 1, session 8 (2026-10-22)**: corevar now loads the camera + integration modules too (perf ripples live), so the
numbers are not comparable with the c35 table below. Same-session baseline: g03 slab0 (session-7 state with r18m8 clouds +
erosion k 0.045) 65.4 at 960x540 N=4. Final params (g06 fold, **1920x1080 N=16, final bake sizes**): ref10 70.8, ref5 63.2,
ref2 66.5, ref3 68.4, ref9 59.8, ref6 59.3, ref1 64.4 = **mean 64.6**. The proxy is down ~0.8 from the slab0 state because the
plates' own cloud draw differs; by the critic's per-element numbers (sandbox/world_critic/measure.py) ref 10 clouds moved to
coverage 0.258 (ref 0.277), mass 6202 px (ref 6042; g00 6093 but as thin streaks), body #734A62 (ref #6E4663).
Stills: sandbox/world/out/g06/fold/cmp/*.jpg, crops sandbox/world/out/g06/crops/.

Render: through the production core at 960x540 N=4 (`sandbox/world/harness/corevar.mjs`), exposure **1.0** (EV 0),
PBR Neutral, sRGB, default grade; black placeholder piano + seated figure (`harness/phmodule.js`) at the rig
(yaw 120 deg + the per-shot cheats). Cameras: refs.md section 2 solves; refs 6 / 1 re-solved from point
correspondences (`tools/camsolve_high.py`); ref 1 rendered at 34 mm and centre-cropped to 1.2:1.

`tools/compare.py` (two refs of the same shot score ~77; the shared AI plate has a specific cloud draw that a
different draw cannot reproduce):

| run | ref10 | ref5 | ref2 | ref3 | ref9 | ref6 | ref1 | mean |
|---|---|---|---|---|---|---|---|---|
| **c35, 960x540 N=4 (session 4 final, `sandbox/world/out/c35/base`)** | 71.7 | 70.9 | 69.6 | 71.6 | 61.0 | 63.3 | 64.9 | **67.6** |
| c34, session 4 start (`out/c34/base`) | 73.4 | 66.9 | 68.5 | 67.0 | 58.7 | 59.9 | 65.0 | 65.6 |
| c20, session 2 (broken reflection, see 3) | 70.2 | 67.8 | 68.0 | 69.8 | 59.8 | 52.9 | 70.9 | 65.6 |
| t21, v1 doc (prototype harness) | 67.5 | 66.4 | 63.8 | 69.7 | 61.4 | 52.1 | 60.8 | 63.1 |
| hd2, 1920x1080 N=16, reflScale 1, cube 1024 (`out/hd2/base`, ~3 s per frame) | 71.6 | | 69.6 | 71.5 | | 63.4 | | |

Every iteration with its change is in `sandbox/world/log.md`. Proxy scores saturate around 66-68 here: the last points
are look decisions as much as score (session 4 picked variants that also looked closer on the side-by-side sheets).

Grade statistics (`sandbox/world/tools/gradestats.py` on c35, refs.md 3.7; 8-bit luma percentiles):
ref 10 p5/p50/p90/p99/p99.9 = 15.3/76.5/158.1/185.8/194.7 (ref 18.5/74.3/148.4/184.7/194.4), HSV-S mean 0.47 (0.48),
no clipping, brightest 0.5 % #FAB586 (ref #FDB47E); hue per luma band within 4 deg of the ref from L 40 up, L 15-40
246 deg vs 230 (slightly violet). Refs 2 / 3: p50 70.8 / 73.2 (71.6 / 75.5), p99.9 194.7 / 194.9 (207.4 / 207.7: the
plate's glow core is a little brighter and yellower, #FEC386 vs our #FAB585), S p90 0.74 / 0.77 (0.63 / 0.59): the
darkest band (L 2-15) is saturated navy in ours (#0A0920) and near-neutral in the refs (#09060A): mostly the pure
black placeholder piano and its reflection, which the real piano / pianist replace.
Water regions (session 4): the means match (ref 2 warm water 180/105/87 vs render 190/119/93) but the refs have more contrast (top 10 % 253/181/121 vs 241/157/106,
bottom 25 % 80/47/60 vs 108/69/75); the near-water reflection gain 1.08 and the 2 m chop closed part of it.

Performance (Radeon 780M shared with other agents, Chrome 155, whole core frame with the placeholder): ~1 s per
960x540 N=4 frame, ~2.5-3 s per 1920x1080 N=16 frame (reflScale 1, cube 1024); world create 6-15 s (+ shader compile
on the first frame).

## 8. Known gaps (for the critique rounds)
- **Clouds**: better since the 6:1 band stretch (less camouflage speckle, sloping streaks), but still thinner and less
  contrasty than the plate: the refs' clouds are bigger dark masses with brighter salmon undersides, and right above
  the ridges the plate has long horizontal lit streaks where ours show wisps radiating from the band vanishing point
  (A +20). Small isolated puffs with pink dots remain in the upper right.
- **Mountains** (the main 1080p gap): layering and haze are right, but the faces are smooth and flat-coloured (the mid
  chain reads as uniform violet triangles at 1080p); the refs show more internal contrast (dark faces, lit snow ridges,
  gullies). Per-pixel bump / rib relief x2.5 changed nothing visible (v21): the detail has to come from geometry and
  albedo / snow structure that survives the haze. The far range is slightly too light / violet. The right shore's pale
  boulders reflect as vertical streaks.
- **Water**: low shots (2, 3, 9) need more breakup of the piano's mirror image into zig-zag slices and more contrast
  (darker troughs, brighter glow tops); swell x1.5 and more oblique swell did not score better. Ref 6: the rings are
  still bolder than the ref's, the reflected cloud field is streakier and more orange than the ref's pink mottling.
- **Ref 9** (water level) is the weakest shot (~60): mostly the near water (large wavelets and bright blobs in the
  ref) and the camera / placeholder scale.
- **Ref 5**: the mid water should be a crisper mirror of the mountains and clouds (ours shows glow streaks + chop
  there), and the 5 cm wind micro-normals make sparkle dots in its near water (elevated camera); the near-right
  boulder shore of the ref is out of our frame.
- **Ref 1** (blue hour, top-down) fell from ~71 (session 2) to ~65 after the reflection fix and the blue-hour / high-sky
  desaturation (c33): its water lacks the faint warm cloud reflections at the frame edges. Revisit the blue-hour tint.
- The clear-sky table has a dip at A 0, e ~2 deg (L 1.1 between 2.0 at e 0 and 1.8 at e 4); mostly hidden by terrain.
- RENDERING.md section 8 still says the world does not use the hooks; it does (since session 2).

## 8b. Fix round 2 (session 9, 2026-10-22 21:03-) -- what changed, what is still open
Changed (params.js / code, all in scene/src/world):
- **Mountains**: `terrain.areteJag` 0; `erosion.sharp` 0.35 -> 0.15 and `erosion.topFade` 0.25 (erosion fades to 0 over the top
  25 % of the local relief); NEW `terrain.crestSmooth` (terrain.js buildTerrainGeometry): within the top 50 % of the local relief
  (local max over 1.2 km) the height blends toward a 160 m low-pass, lifted by the local max drop so the summits keep their
  plate-matched elevation angles (CPU skyline from the piano, `sandbox/world/harness/skyline_cpu.mjs` + `tools/skyline_cpu.py`,
  ref-10 px: massif roughness 5.6 -> 3.3 px, thin spires 12 -> 0; left peak 5.1 -> 3.3, spires 8 -> 1; summits within 0.1 deg).
  `terrain.subSummits` (1; 0 changed the composition at A 20-24). NEW `terrain.streakPx` [5, 10] (uniform `uStreak`): the
  fall-line rib / rock-in-snow streak octaves fade in from 5 to 10 px of across-slope period (2-5 px = the combed striation).
  `snowAlbedo` [1.0, 1.25, 2.0] -> [0.75, 0.88, 1.15] (bluish frosting, massif p95 112 vs ref 65).
- **Clouds**: NEW `clouds.litGate` [20, 40, 6, 14] (uniform `uLitGate`: lit rims only at |A| < 20-40 deg and e < 6-14 deg; the
  overhead wTop lighting is unaffected); `litBand` [0.15, 0.5, 35, 0.25]; `softness` 0.18, `envSoft` 0.20. NEW (neutral by
  default) `clouds.edgeErosion` [amp, km] (uniform `uEdgeEro`) and `clouds.sunBody` [gain, A, e] (uniform `uSunBody`).
- **Sun look** (index.js `lookSun`): NEW `sunLook` [-1, 0.15]: elevations above -1 deg are compressed x0.15 (CPU check, sun +0.53: clear-sky L vs the -1 deg table raw x1.4-3.2 and hue +49 deg -> x1.05-1.15, hue <= 5 deg; `sandbox/world/harness/sunlook_cpu.mjs`) before they reach the
  sky table, cloud terminator, alpenglow and water (the plates are all at ~-1 deg; S01 at +0.53 washed everything pastel pink).
  `world.sunElevation(t)` still returns the raw elevation; `world.sunDirection` is the look direction.
- **Water**: NEW `water.reflSharp` [5, 30, 0.15] (uniform `uReflSharp`): reflected objects nearer than 5-30 m keep x0.15 of the
  glossy roughness (the piano's mirror image); `lostRoughCap` near 0.005 -> 0.0015. NEW (neutral by default): `water.ringCalm`
  [r0, r1, floor] (wind + chop calmed inside the ring field around the lyre), `water.ringSteep` [clip scale, amp scale] for
  steep views (S20 ink splats), `water.tapFar` (glossy tap spread beyond 150-250 m). Ring upload (index.js uploadEvents): when
  more packets compete than `maxEvents`, the selected ones near the cut-off weight fade to 0 at it (stateless, no pops).
- **Haze**: NEW (neutral by default) `haze.antiTint` [r, g, b, A0] (uniform `uHazeAnti`, shared): in-scatter tint from |A| A0 to
  A0 + 25 deg (navy anti-sun shadows; massif #231E3C vs ref #0F1F44).
- **Boulders**: NEW `boulders.fracture` (3-6 fracture planes, ridged relief, height / width 0.6-1.5, faceted normals),
  `detail` 5 (720 tris / rock, 590 k tris for 820 rocks; was 80 / 65.6 k).
- GPU checks of all of this (`sandbox/world/jobs/h01.mjs` folds + A/B, `h02.mjs` water, `h03.mjs` clouds / haze) were QUEUED
  behind the camera animatic (GPU slot held 21:08-~22:15); results land in `sandbox/world/out/h01..h03` + `.log`.

Still open (see also section 8):
- **Depth precision / z-fight (core)**: 24-bit depth with near 0.05 m gives ~0.5 km depth steps at 20 km and ~1.5 km at 35 km:
  terrain blotches and ridge slivers pop frame to frame in MOVING wides (critic: S01 massif 1729 px popping >= 10x in 120 frames,
  1.39 % of massif px > 20 codes/frame at N=32 vs 0.002 % with near 20). Needs reversed-Z / log depth or a per-shot near >= 1 m
  in the core (accum.js depth, camera near), plus the water's `ag_reflDist` (uReflInvVP on the depth texture) adapted to it.
- **Water shimmer (band limit)**: the noise octaves keep wavelengths of 1-2 px (`bandLimit` [1, 2]): the sun-side far band pops
  (S10: 31 % of px >= 10 pops / 120 frames; share > 20 codes 0.204 at N=16, 0.101 at N=32). Candidates: `bandLimit` [2, 4] or
  `footprintAniso` 0.75 with the energy moved into resolved 3-12 px wavelets.
- Mid-ground ridge layers (5-8 km and 10-15 km chains), overhead cloud masses for ref 6 / S20, near-sun cloud colour,
  perf ring gain 6 -> 10.

## 8c. Cycle 3, fix round 1 (session 10, 2026-10-23 07:19-)
- **Summits (critical: round 2 made domes)**: `terrain.crestSmooth.mode: 'open'` (default) replaces the 160 m low-pass with a
  grayscale OPENING by an L1 cone of slope `crestSmooth.slope` 1.5 (separable two-pass min / max envelopes on the polar grid,
  ~1 s): every spike steeper than the cone is cut to a straight-flanked point, every apex with flanks shallower than the cone
  stays exactly as built; never raises the terrain. Same `top` / `minH` weighting near the local crests. `mode: 'lowpass'`
  keeps the round-2 path. CPU check (`sandbox/world/harness/skyline_cpu2.mjs`: exact triangle-rasterised skyline at 1 ref-10 px;
  `sandbox/world/tools/apex_cpu.py`: the critic's apex.py summit metric): ref-10 massif main summit sharpness 0.06 -> 0.20,
  apex exponent 1.93 -> 1.27 (ref 0.15 / 1.29), needles 0, summits within 0.02 deg. Slope 1.2 lowers the massif 0.3 deg,
  2.0 lets spires through.
- **Snow**: `terrain.snowLook` [planar, sunGain, antiGain, ledge] = [1, 1.4, 0.75, 0.6]: in the snow zone no fall-line streak
  relief and no streak modulation of the snow edge (the 'marbled wax' worms); snow albedo x1.4 on faces turned to the sun's
  azimuth, x0.75 turned away (~150 m smoothed normal); rock in the snow as contour LEDGES (`snowLedge` [45 m, 0.55]) instead of
  fall-line ribs. `haze.antiTint` [0.75, 0.97, 1.1, 5] (navy anti-sun in-scatter) is now ON.
- **Water**: `water.shortCrest` [1.0 m, 1, 15 m, 0.5]: the swell / chop (and half the wind) are modulated by a patch envelope
  (1 m across the main swell, 6 m along it, world-fixed) from 15-45 m on: short broken crests with calm patches instead of
  continuous scan lines. `water.reflFloor` [0.6, 18]: from 18-33 deg depression the reflected radiance is floored at 0.6 x the
  clear-sky zenith colour (no pure-black ink blotches from above). `water.ringLow` 1.6 (ring gain below 10-20 deg depression),
  `water.ringSteep` [0.5, 0.6] (steep views) now on.
- **Clouds**: softness / envSoft 0.10 / 0.10, litBand [0.25, 0.42, 55, 0.25], litGate [45, 65, 12, 20] (round 2 overshot to
  lit_frac 0.005 vs ref 0.014), `clouds.edgeErosion` [0.06, 0.09] (isotropic puff octave on the edges), mapGain 0.95.
- GPU verification: `sandbox/world/out/h04` (job `jobs/h04.mjs`, variants read late from `jobs/h04v.mjs`), 1080p N=16, final
  bakes: fold 70.4 / 63.6 / 67.4 / 64.8 / 57.8 / 60.3 / ref1 70.5 (6-shot mean 64.05 vs round 2's 62.1, every shot up).
  A/B in the same session: round-2 low-pass crests -1 on refs 10/5/3; round-2 clouds -0.6..-2.1; no reflection floor -1.4 (ref 6)
  / -2.4 (ref 1); short crests off: barcode.py far-left scan lines |dy| 15.8 -> 28.8 (ref 6.5), right-shore barcode share 0.012
  -> 0.030 (ref 0.008). Rejected: near wavelets (`water.wavelets.slope` 0.05: -1.1..-2.1), footprintAniso 0.25.
- Clouds after h04: lit rims overshoot (lit_frac 0.031 vs ref 0.014, rim lit share 0.24 vs 0.065, lit dL 48 vs 22). h05 tried
  litBand [0.20, 0.45, 45] + litGate [32, 52, 9, 16] + mapGain 1.05: lit_frac only 0.029, proxy -0.9..-1.8 on every shot ->
  REVERTED to the h04 values. The excess is the rims' BRIGHTNESS (dL), not their extent: next, a rim gain / dimmer litLow.
  h05 A/B (not folded): bandStretch 3 (ref5 +1.7, ref2 -0.6), ringLow 3 (ref3 -1.1), overhead prior 0.45 (ref6 -0.3,
  ref1 +1.1), reflFloor 0.9 (ref6 -1.1), shortCrest 0.6 m (neutral), antiTint (0.5, 0.92, 1.15) (massif colour unchanged:
  the grey-violet is terrain shading, not haze), snow aspect 1.75 / 0.6 (neutral).
- Right-shore 'tombstones' diagnosed (h04 dbg1 / dbg3 = raw reflection at the flat UV / glossy reflection): the env-only mirror
  copies are NOT involved (ENV_LAYER only) and the Reflector's oblique frustum does not clip the headland
  (`sandbox/world/harness/oblique_check.mjs`). The reflection target holds a correct dark headland + boulder image; the
  long-crested swell / chop tilted the lookup past the thin, low headland reflection onto the pink mountains / sky above it,
  in columns that followed the gaps between boulders. Short crests break those columns into dashes (ref-like).
- NEW look-dev API: `world.rebuildTerrain({ 'path.to.param': value })` rebuilds the terrain geometry with terrain-param
  overrides inside a running session (geometry A/B in one corevar job; heightAt / boulders keep the original field).
- NEW `terrain.midRidges` (OFF until its GPU A/B, h05 'ridges'): four sloping spurs at 6.5-7.5 km and 11.5-12.5 km framing
  a V toward the glow, each descending to the water (the refs' overlapping mid-ground ridge silhouettes).
## 8d. Cycle 3, fix round 2 (session 11, 2026-10-23 12:26-)
- **Patch seam at 19 km (critic major)**: guard bands + weld (section 3). CPU (`sandbox/world/harness/seam_check.mjs` = the
  critic's seam.mjs on the FULL build, split by the new `patchRanges`): height gap max 172 m -> 0.01 m (p90 34 -> 0), AO jump
  p90 0.61 -> 0.02, normal jump interpolated along the row p90 0.01 deg (the critic's nearest-vertex metric stays ~11 deg p90:
  that is the intra-row spacing of the sparse emitted boundary vertices, 11.6 deg p50 between neighbours). Guard alone (no
  weld): gap max 35 m (erosion is computed from grid gradients; erosion off: 8.5 m).
- **Saw-tooth teeth (critic critical #3)**: `crestSmooth.cone` 'chamfer' = Euclidean cone (two-pass chamfer with every
  (di, +-1) link up to K = 3 x radial / azimuth cell: < 2 % anisotropy instead of the L1 diamonds' 41 %), cut blurred
  (5-tap binomial, min with the raw cut) and applied only above `cutMin` [1, 3] m; `crestAA` 1 blends the crest zone toward
  a radial [1 2 1] / 4 average (a sharp arete crossing the radial rows obliquely is cut by the triangles at every row: the
  regular teeth). Slope 1.75 (the Euclidean cone at 1.5 cuts more than the L1 one on oblique flanks). CPU (out/sky_c3r2*.json,
  `tools/teeth_cpu.py`, `tools/apex_cpu.py`): regular teeth run on the left flank 6 (L1) / 10 (chamfer 1.5) -> 5, skyline
  hp std 1.61 -> 1.39, massif main summit s / e 0.20 / 1.27 -> 0.19 / 1.33 (ref 0.15 / 1.29), summit 5.94 -> 5.89 deg.
- **Massif colour (critic #5)**: `terrain.antiAmbient` [0.6, 0.8, 1.35, 1]: SH irradiance x navy on faces turned away from the
  sun beyond 5-8 km, shaded snow there x `antiSnow` 0.7.
- **Clouds (critic #1)**: opacity 6 -> 2.5 (critic A/B +1.3..+1.6); `holeFill` (no see-through holes inside a clump; the
  sun-side edge search ignores holes inside the envelope: no lit holes); `rimPx` 5 (lit band at most 5 output px; affects the
  higher clouds, near the horizon the band is already ~1 px); `core` navy cores deep in dense clumps; `inner` lumps (Worley,
  0.4 km, +-30 % body, half of it on the lit band); `mapCubic` B-spline coverage map (no texel steps).
- **Piano mirror image (critic #6, USER_FEEDBACK 1)**: `water.nearRefl`: for reflected surfaces closer than 3-8 m the lookup
  uses half the slope (dark broken bands instead of rays escaping to the sky past the legs) and, in low views, the lit bed
  under them is occluded down to 0.12 (was 0.4: the grey lift). `water.sunSide` x1.2 toward the sun azimuth.
- GPU (h06, 1080p N16, final bakes, corevar + placeholder piano; GLSL compiles): fold 73.0 / 65.2 / 68.9 / 65.6 / 59.9 /
  **ref6 54.9** / ref1 70.7 (h04: 70.4 / 63.6 / 67.4 / 64.8 / 57.8 / 60.3 / 70.5): every low shot +0.8..+2.6, ref 6 -5.4 (its
  overhead peach cloud reflections went dark: rimPx shrinks the overhead lit band to a few px, cores + opacity 2.5 thin the
  overhead clouds) -> `clouds.lowSky` [12, 22, 6.0] restricts rimPx / cores / opacity 2.5 to the low sky (h07 verifies).
  A/B vs fold: round-1 clouds -1.2 / -0.8 / -0.3 / -1.0 (10/5/2/9); opacity 2.5 alone +0.2 / +0.9 / +1.1 vs fold (the other
  cloud terms cost on 5 / 2 but carry the critic's per-element numbers); litLow x0.55 -0.2..-0.7; sunSide off -1.0 / -1.2;
  nearRefl / antiAmbient / snowWarp / ringSharp / kBand / haze x0.6 / midRidges / bandLimit 1.5-3 / shortCrest 2 m / chop 0.055
  within +-0.3; wind 0.075 +0.7 / -0.6; near-hill albedo x2 +0.7 / +0.6; round-1 terrain (L1, no AA / guard) -0.2 / -0.1.
- Critic tools on h06 fold (jobs/qc_c3r2.ps1; h04 -> h06, ref): ref10 lit_frac 0.031 -> 0.020 (0.014), lit dL p90 48 -> 43
  (22), body_dark_p10 #3A2C4A -> #2C274B (#26264B), litedge top share 0.133 -> 0.050 (0.019) / bottom 0.232 -> 0.202 (0.007),
  coverage 0.238 -> 0.218 (0.277, worse), inner_texture 7.2 -> 7.1 (9.0, no change), water0 p90 146 -> 159 (164), col_p90
  #EC9067 -> #F69A72 (#FD9E6D); ref2 lit_frac 0.032 -> 0.021 (0.016), water0 p90 147 -> 161 (180); ref5 lit_frac 0.036 ->
  0.026 (0.025). Unchanged: piano reflbox L<20 ref10 0.14 -> 0.13 (0.34), massif rock #1F1E34 -> #1F1E35 (#0C1C3E): the far
  rock radiance is mostly the neutral dark floor -> the floor now takes the antiAmbient tint too (h07 verifies).
## 8e. Cycle 4, fix round 1 (session 12, 2026-10-23 17:11-) -- warm water, wispy clouds, navy far ranges

Kept from cycle 3 (h07 check): `clouds.lowSky` (ref 6 54.9 -> 60.3) and the navy tint of the dark floor on far anti-sun faces
(score-neutral, massif hue 242 -> 239).

What changed (all GPU-verified in h08 unless marked; 1080p N16, refs graded with the WIDE film LUT, film frames S01 / S03 / S17 /
S19 / S23 through the camera module; numbers in sandbox/world/PROGRESS.md):

| group | params | why / result |
|---|---|---|
| water warmth | `water.tint` [0.96, 0.86, 0.93] -> [1.0, 0.94, 0.80], `sunSide` 1.2 -> 1.35 | bright reflections orange / peach, not pink: ref10 top-10 % hue 18.4 -> 22.9 (ref 20.3), pink share 0.41 -> 0.34 (0.28), R/B 1.83 -> 1.97 (2.14) |
| ripple scale | `chop[2]` crest stretch 2.2 -> 3.3 (4.5 tested: crests too long, acHalf x 41 vs ref 24), `wind.strength` 0.12 -> 0.06 (steep-view `strengthDown` kept), `bandLimit` [1, 2] -> [1.5, 3], swell 1.9 / 1.25 / 0.85 m amplitudes x1.6 | the 'sequin' mosaic -> long horizontal bands: ref2 / S03 acHalf x 7 -> 22-32 px (ref 19.5), fine/mid 0.69-0.72 -> 0.51-0.60 (ref 0.52) |
| troughs | `reflFloor` 0.6 -> 0.4 | steep views only (ref 6 / ref 1 neutral). Low-view troughs are still too bright (ref10 L10 61 vs 41): open |
| far calm | `farFadeHeight` [100, 200] (off) -> [1.6, 2.4] | S23 (2.0-2.6 m) / ref 5 (2.7 m): swell / chop end at 25 / 25-60 m -> ref 5's calm far mirror (by eye); compare -1.3 on ref 5 / S23 because our S23 framing reflects the dark ranges where ref 5 reflects glow |
| cloud edges | `clouds.softness` / `envSoft` 0.10 -> 0.16, NEW `clouds.litLowGain` [0.7, 0.7] (scene-linear gain on litLow / litLowDim, sky.js), `edgeErosion` [0.06, 0.09] -> [0.12, 0.05] | critic cWisp: ref10 edge width p50 3.76 -> 5.01 px (ref 4.85), hard share 0.165 -> 0.118 (0.094), rim lit share 0.183 -> 0.102 (0.068), rim dL 44 -> 34 (24) |
| cloud field | `bandScaleKm` 1.6 -> 1.1 | more, smaller clumps: +0.8 / +0.4 / 0 / +0.8 (ref10 / ref2 / ref9 / S01). `mapGain` 1.05 rejected (-0.4..-0.8) |
| far rock | NEW `terrain.rockFar` [0.05, 0.075, 0.14, 1] / `rockFarD` [12000, 16000, 0.5] (terrain.js uRockFar: navy albedo beyond 12-16 km, sun-facing faces half), `antiAmbient` [0.45, 0.8, 1.6], `haze.antiTint` [0.6, 0.95, 1.2] | massif #1C1D3B hue 238 sat 0.53 -> #191E44 hue 233 sat 0.63 (ref #0E1D41 222 0.79), L50 31.5 (28.2); near hills unchanged |
| snow streaks | `rockInSnow` strength 1.0 -> 0.6, `gullySnow` 0.6 -> 0.35 | fewer 'brush strokes', but by eye the massif is now snowier than the ref (out/h08/sh_m10b.png): h09 A/B snowOld |
| massif relief | the six snowy massif peaks `rough` 0.28 -> 0.38, `ribs` [420-460, 0.05] -> [250, 0.10] | denser ridge / gully detail by eye, proxy neutral (-0.1 / +0.3 / -0.2) |
| flank teeth | NEW `crestSmooth.ridgeAA` [1, 2, 10] + `aaPasses` 1 (crest AA also on every radially convex arete) | CPU exact mesh skyline: left-flank teeth >= 1 px 17 -> 6, summits unchanged; but on the GPU (h09 fold vs gOld, S01) the visible left-flank saw-tooth is UNCHANGED (teeth box share of px changed > 8 codes 0.4 %): the visible teeth are not radial-row crossings. Kept (neutral); open |
| fractured snow | NEW `terrain.snowBreak` [0.85, 120, 0.80, 0.25] = amount, scale m, threshold, crest weight (terrain.js uSnowBreak: biplanar face-coordinate outcrop net) | h09 sb80: navy rock with broken snowfields instead of the snow blanket (out/h09/sh_m10.png), +0.1 / -0.5 / +0.3 (ref10 / ref2 / S01). [0.8, 90, 0.62] took ~80 % of the snow; threshold 0.74 too little snow |

Verification of the final state: h09 (1080p N16) fold 75.3 / 70.8 / 61.6 / 64.6 / 67.3 / 61.7 / 74.5 (refs 10 / 2 / 9 / 5 / 3 / 6 / 1),
film S01 75.8, S03 68.5, S17 61.9, S19 58.4, S23 58.7; the module = h09 fold + snowBreak amount 0.85 (= h09 'sb80', rendered on
ref10 / ref2 / S01 only). Same harness on the h07 values ('old' in h08): ref10 73.6, ref2 68.0, ref9 60.4, ref5 64.8, S01 74.3,
S03 65.5, S23 59.0.

Look-dev harness: `sandbox/world/harness/corevar.mjs` takes `refLut` (grade the ref setups with a LUT; the default v1 close-up LUT
made the navy look grey) and `film: [{ f, ref }]` (film frames through the camera module, paired with a ref for compare.py).
`sandbox/world/tools/h08m.py` runs the critic's cycle-4 metrics (c4m.py + wscale.py) on a variant dir; `tools/sheet.py` makes
side-by-side crop sheets.

Still open after this round: low-view troughs (L10 +20..+30), cloud field still smeared streaks rather than popcorn clumps
(blobs 50-59 vs 76-84), massif snow layout (snowfields vs blanket), central far range lavender (no alpenglow on the 29-40 km
snow), S19 / S23 glow width, S10 defocused near water, ref 2 anti-sun pink streaks.

## 9. Files
- `scene/src/world/index.js` (API, wiring, glow light), `params.js`, `util.js`, `sky.js`, `skytable.js` (generated),
  `cloudmap.js` (generated), `terrain.js`, `boulders.js`, `water.js`.
- `sandbox/world/harness/`: `corevar.mjs` (uniform / param sweeps in one core session; a variant's js may return data,
  saved as `js_result.json`; `noRender` variants only run js), `corestill.mjs`, `dbgrefl.mjs` (reflection debug),
  `envprobe.js` (env luminance probe), `phmodule.js` / `placeholder.js` (black piano + figure), `shots.js` (camera
  solves). `sandbox/world/tools/`: sky / cloud fits, camera solves, `gradestats.py`, `regions.py`, `skylinecmp.py`.
- `sandbox/world/log.md` (scores per iteration), `sandbox/world/PROGRESS.md`.
