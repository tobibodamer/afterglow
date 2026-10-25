# Offline rendering pipeline on this machine: measured results and recommended architecture

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Scope: how to render "Afterglow" offline, frame by frame, with three.js on this PC (Ryzen 7 260 with a Radeon 780M iGPU, Chrome 155, three r186). Every number below was measured with the harness in `sandbox/render-test/`, unless it is marked as an estimate or as coming from a cited source.

**Measurement caveat.** The machine was shared while I measured. Other jobs were running at the same time (a Python audio job, dev servers, other agents), and CPU load was about 70% at one check. Repeated runs of the same configuration varied by up to 1.6×. I give the quiet-machine figure and the loaded figure where I have both. Plan with the loaded figure.

---

## 0. TL;DR (decisions)

1. **Renderer.** Use the three.js `WebGLRenderer` (WebGL2, GLSL `ShaderMaterial`s) in headless Chrome 155, driven by `puppeteer-core`. The GPU path works with no special flags: `UNMASKED_RENDERER = ANGLE (AMD, AMD Radeon 780M Graphics (0x00001900) Direct3D11 vs_5_0 ps_5_0, D3D11)`. Keep `--use-angle=d3d11` (the default), `--ignore-gpu-blocklist`, `--disable-gpu-watchdog` and `--js-flags=--expose-gc`.
2. **Quality model.** Use an accumulation buffer in the style of Haeberli and Akeley: **N sub-frames per output frame**, each with its own sub-pixel jitter, shutter time and thin-lens aperture sample, summed into an RGBA32F target. This gives supersampling, true motion blur, physical depth of field, soft shadows and stochastic transparency all at once. Implemented and verified (`src/accum.js`).
3. **Budget.** On the test scene (2.1 M triangles, shadow map, full-resolution planar water reflection, PMREM image-based lighting), one sub-frame takes **12.7–16 ms (quiet) to 21–23 ms (loaded) at 1080p**, and **36–56 ms at 2160p**. End to end, with tone mapping, readback, upload and encoding included:
   - 1080p, N=16: **0.25–0.45 s per frame**, so 13,500 frames take **0.9–1.7 h**.
   - 2160p, N=16: **0.75 s per frame**, so about **2.8 h**.

   The final scene will be heavier. Budget 2–4× these figures, which is still feasible overnight even at 4K.
4. **Path tracing (three-gpu-pathtracer 0.0.27, WebGPU).** Measured at about **1.0–1.13 samples per pixel per second at 1080p**. It is still visibly noisy at 67 spp. Skinned geometry costs **1.6–4.0 s to rebuild plus 6.6–16.6 s** before the next sample. Not feasible for the film (about 36 days for 13,500 frames). Use it only for a few hero stills (5–20 min each) and as a reference "ground truth" render for look-dev. Baking static AO and lightmaps is cheap with three-mesh-bvh GLSL rays (23–74 Mrays/s).
5. **Depth of field.** Pure lens sampling shows N "ghost copies" in strong bokeh. Example: 85 mm at f/2 focused at 0.69 m gives a **circle of confusion (CoC) at infinity of 319 px**. Use **N=32 plus the CoC-proportional gap-fill pre-blur** I implemented for shallow-focus close-ups. It removes the ghosting (PSNR in the bokeh region rises from 37.7 to 39.2 dB against an N=1024 reference) for **+2.2 ms per sub-frame**. Wide and medium shots are fine at N=16.
6. **Output path.**
   - Final pass: tone map, then grade, then TPDF dither, into RGBA8.
   - Read back with sync `readPixels`: 7–16 ms at 1080p.
   - Upload with **4 parallel `fetch` POSTs of `Blob` slices**: 42 ms per 1080p frame. Pipeline the upload, and call `gc()` after each one.
   - Node reassembles the frames and pipes them into **ffmpeg FFV1 lossless chunks**, which are resumable.
   - Deliverables are encoded after the render: x264 CRF 14, `-preset slow`, yuv420p, tagged BT.709.

   Do not run x264 during the render. On this APU it slows the GPU by about 17%.
7. **Determinism is verified.** The same frame rendered in two separate browser sessions, and out of order, gives **bit-identical** output (sha256 match), with film grain and DOF pre-blur enabled. Time is driven only by `frame / 60`.
8. **Look.** Use **Khronos PBR Neutral** as the base tone map (it keeps the sky saturated: 0.428 against 0.423 in ref 2; AgX gives 0.243 and ACES 0.296). Then apply a 3D LUT fitted to the references.
   - No threshold bloom. Use a low-energy, physically motivated veiling-glare kernel (a camera point-spread function) over the whole HDR image.
   - Grain is optional and subtle. Dithering is always on.

---

## 1. Headless Chrome and GPU capabilities (measured)

Script: `probe.mjs`, output in `out/probe.json`.

| Flag set | Unmasked renderer |
|---|---|
| none / `--use-angle=d3d11` (new headless and `shell`) | `ANGLE (AMD, AMD Radeon 780M Graphics (0x00001900) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| `--use-angle=gl` | `ANGLE (ATI Technologies Inc., AMD Radeon 780M Graphics, OpenGL 4.5.0)` |
| `--use-angle=vulkan --enable-features=Vulkan` | `ANGLE (AMD, Vulkan 1.4.349 (AMD Radeon 780M Graphics …), AMD proprietary driver)` |

SwiftShader was never selected. Browser launch takes about 1 s.

WebGL2 capabilities (D3D11):
- `EXT_color_buffer_float`: yes. `EXT_color_buffer_half_float`: yes. `EXT_float_blend`: yes. `OES_texture_float_linear`: yes.
- `MAX_TEXTURE_SIZE` 16384, `MAX_3D_TEXTURE_SIZE` 2048, `MAX_RENDERBUFFER_SIZE` 16384.
- `MAX_SAMPLES` 8. MSAA counts for RGBA8, RGBA16F and RGBA32F are {8, 4, 2, 1}.
- Anisotropy 16×. `MAX_DRAW_BUFFERS` 8.
- `EXT_disjoint_timer_query_webgl2`, `EXT_clip_control`, `KHR_parallel_shader_compile` and `WEBGL_multi_draw` are available.
- Additive blending into RGBA32F and RGBA16F was verified correct on the D3D11, GL and Vulkan backends (`blendtest.mjs`).

WebGPU in headless (`probe-webgpu.mjs`): adapter `vendor=amd, architecture=rdna-3`, not a fallback adapter. Features include `float32-filterable`, `float32-blendable`, `subgroup-size-control` and `texture-compression-bc`.

---

## 2. Accumulation renderer (implemented and measured)

Code: `src/accum.js`, `src/rng.js`, `src/page.js`, `src/scene.js`.

### 2.1 How a frame is built

```
for k in 0..N-1 (fixed, decorrelated low-discrepancy table; Halton bases 2,3 / 5,7 + shuffled stratified time):
  t_k   = frame/60 + (s_k.t - 0.5) * shutter/60       # centred 180 deg shutter = 1/120 s
  pose(t_k); camera(t_k)                              # pure functions of time
  lens: eye += (lx*R)*right + (ly*R)*up,  R = f/(2*fStop)   (9-blade polygon disk)
        P[8] -= P[0]*lx*R/focusDist;  P[9] -= P[5]*ly*R/focusDist   # shear: focal plane stays fixed
  jitter: P[8] += 2*jx/W;  P[9] += 2*jy/H                          # sub-pixel AA (box filter)
  render scene -> sceneRT (RGBA16F + depth texture)   # Reflector water re-renders automatically with the
                                                      # same sheared projection, so reflections get AA + DOF too
  additive-blend sceneRT*(1/N) -> accumRT (RGBA32F)   # or the DOF gap-fill blur pass (section 4)
final: exposure -> [grain] -> tone map -> grade (sat, lift/gamma/gain; LUT recommended) -> sRGB OETF
       -> TPDF dither (±1 LSB) -> RGBA8 (flipped so readPixels rows come out top-down)
```

### 2.2 Traps I hit (each one cost a debugging cycle)

- **`renderer.autoClear` must be `false`.** Otherwise every `render()` call, including the full-screen accumulation quad, clears its target. The result is silently the last sample divided by N. I confirmed this by reading the RGBA32F target back: the alpha channel stayed at 1 instead of N.
- **r186 removed `PCFSoftShadowMap`.** It falls back to `PCFShadowMap` with only a console warning.
- **GLSL uniform arrays must be fully populated.** For example, `uSources[8]` with 5 entries throws "Cannot read properties of undefined (reading 'toArray')".
- **`fetch(body: ArrayBuffer)` is slow, about 13–22 MB/s.** Use `Blob` bodies instead (section 3).

### 2.3 Timing matrix at 1080p

Test scene: 2,116,734 triangles. 1.5 M of those are the ridged-multifractal mountain ring. The rest are a lacquered piano proxy with hollow rim, keys, 230 strings, plate and soundboard; a pianist proxy with fast-moving hands; a lake bed; a full-resolution `Reflector` water plane with analytic ripples and a normal map; a 2048² shadow map; PMREM IBL; and fog. Scripts: `bench.mjs`, results in `out/bench_main.json` and `out/bench_dof.json`. Values are medians of 5 frames.

| Configuration | ms per sub-frame | Notes |
|---|---|---|
| wide shot, N=16, everything on | 22.1–23.2 (loaded); about 14 (quiet) | scales linearly: N=8 gives 196 ms, N=16 gives 354–371 ms, N=32 gives 719 ms of accumulation (loaded) |
| hands close-up, N=16 | 22.3 (loaded); 13.4 (quiet) | about the same as the wide shot; the cost is dominated by geometry, not pixels |
| top-down shot, N=16 | 22.3 (loaded) | |
| terrain 1.5 M → 0.5 M triangles | 22.3 → **14.9** | **vertex/geometry-bound**: each triangle is drawn twice (main pass plus reflection) |
| reflection render target at 0.5× | 23.2 → 19.5 | |
| shadow map disabled at init | about 13.8 → 12.7 (quiet) | the shadow pass is about 1.1 ms; this is an indirect estimate across two sessions (wide + pre-blur 16.0 minus the measured 2.2 ms pre-blur cost) |
| MSAA 4× on the scene render target | 23.2 → **33.5** | not worth it, since jitter accumulation already anti-aliases |
| DOF gap-fill pre-blur (48 taps) | 13.4 → 15.6 | +2.2 ms |

| Configuration at 2160p | ms per sub-frame | |
|---|---|---|
| wide shot, N=16 | 55.7 (loaded) | about 2.4× the 1080p cost, not 4×, because it is geometry-bound |
| wide shot, N=8 | 36.0 (quiet) | |
| hands close-up, N=16 | 48.0 (loaded) | |

Fixed costs per output frame:

| Cost | 1080p | 2160p |
|---|---|---|
| Final pass + sync readback (RGBA8) | 7–16 ms | 27–49 ms |
| `readRenderTargetPixelsAsync` (PBO) | 44.6 ms | — |
| Upload to Node (4 parallel Blobs) | 50–84 ms (sequential), or about 20 ms visible when pipelined | 183–233 ms |
| Environment capture (CubeCamera 512² + PMREM), 2.1 M-triangle scene | 77–139 ms | |
| Environment capture, 0.6 M-triangle scene | 65–69 ms | |
| Per browser session: scene build + compile | 1.0–1.8 s + 1.6–3.4 s | |

The async PBO readback (`readRenderTargetPixelsAsync`) is slower than the sync read, so use the sync one. The environment capture is a per-frame cost only when it must update every frame.

### 2.4 End to end (render, upload, encode), 120–240 frames

Script: `e2e.mjs`, results in `out/e2e/results.jsonl`.

| Run | ms per frame | Throughput |
|---|---|---|
| 1080p wide, N=16 → raw file (no encoder) | **248** | 4.0 fps |
| 1080p wide, N=16 → FFV1 lossless (in-line) | **256–265** | 3.8–3.9 fps |
| 1080p wide, N=16 → x264 CRF 14 `medium` (in-line) | 265 | |
| 1080p wide, N=16 → x264 CRF 14 `slow` (in-line) | 299 (quiet) / 443 (loaded, 240 frames) | |
| 1080p hands, N=16 + DOF pre-blur → x264 slow | 304 | |
| 1080p wide, N=8 → raw | 183–206 | |
| 2160p wide, N=16 → x264 slow | **752** | 25.1 Mbit/s |
| 1080p, N=16, **RGBA16F readback** → x265 10-bit (`rgbaf16le` input) | 731 (loaded) | the 10-bit path works, at about 2× the transfer cost |

**APU contention.** CPU-heavy encoding slows the iGPU, because CPU and GPU share one power budget. With everything else equal: raw 248 ms, FFV1 256 ms, x264 medium 265 ms, x264 slow 299 ms. So **encode lossless FFV1 during the render and make the deliverables afterwards.**

### 2.5 Encoders on 240 rendered 1080p60 frames

Script: `encbench.mjs`.

| Encoder | Speed | Bitrate on the test content |
|---|---|---|
| x264 CRF 14 `slow`, yuv420p | 21.7 fps | 9.0 Mbit/s |
| x264 CRF 14 `medium` | 34.8 fps | 9.9 Mbit/s |
| x265 10-bit CRF 14 `medium` | 14.5 fps | 5.7 Mbit/s |
| x265 10-bit CRF 14 `slow` | 5.2 fps | 6.4 Mbit/s |
| ProRes 422 HQ (`prores_ks` profile 3), 10-bit | 43.3 fps | 460 Mbit/s |
| FFV1 lossless (`bgr0`, 16 slices, intra) | 51 fps | 677 Mbit/s |

The final scene, with water detail and grain, will raise the bitrates.

Disk for a 225 s FFV1 master: about **19 GB at 1080p** and about 75 GB at 4K (estimate). E: has about 135 GB free. Re-encoding 13,500 frames with x264 slow takes about 10 min.

**Colour.** ffmpeg converts RGB to YUV with **BT.601 by default**. Also, `-color_primaries` and `-color_trc` were **not written** by libx264 in my test (ffprobe showed `unknown`). The fix, verified with ffprobe:

```
-vf scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv
```

This is in `lib/frames.mjs` → `ENCODERS`. YouTube asks for BT.709 SDR and recommends **12 Mbit/s for 1080p60 and 53–68 Mbit/s for 2160p60** ([YouTube upload settings](https://support.google.com/youtube/answer/1722171)). CRF 14 is above that for our content, which is fine.

### 2.6 Estimated render time for 13,500 frames (3:45 at 60 fps)

The "measured scene" column applies measured seconds per frame. The last column applies an assumed 3× complexity factor for the final scene; that factor is an estimate.

| Resolution / N | Measured scene | Final scene at 3× (estimate) |
|---|---|---|
| 1080p, N=8 | 0.18–0.21 s → **0.7–0.8 h** | about 2.3 h |
| 1080p, N=16 | 0.25–0.45 s → **0.9–1.7 h** | 3–5 h |
| 1080p, N=32 | 0.55–0.81 s → **2.1–3.0 h** | 6–9 h |
| 2160p, N=8 | 0.59 s → **2.2 h** | about 7 h |
| 2160p, N=16 | 0.75–1.17 s → **2.8–4.4 h** | 8–13 h |
| 2160p, N=32 (estimate: about 2× N=16) | about 1.5–2.3 s → 5.6–8.6 h | 17–26 h |

**Recommendation.** Set N per shot. A **2160p master at N=16** (N=32 for shallow-DOF close-ups) is feasible in one or two overnight runs. For iteration, render previews at 960×540 with N=4 (estimate: about 15–20× faster).

---

## 3. Getting pixels out of the page (measured)

Script: `xfer.mjs`, one 8.29 MB RGBA frame, median of 8.

| Method | 1080p | 2160p |
|---|---|---|
| `fetch` POST with an ArrayBuffer body | 377–624 ms (13–22 MB/s) | 2113 ms |
| `fetch` POST with one Blob | 90–121 ms (68–92 MB/s) | 278 ms |
| **4 parallel `fetch` POSTs of Blob slices** | **42 ms (198 MB/s)** | **157 ms (212 MB/s)** |
| WebSocket (`ws`) | 128 ms (65 MB/s) | 464 ms |
| CDP `page.evaluate` returning base64 | 298–323 ms (26–28 MB/s) | 1254 ms |
| Stripping alpha in JS (RGBA → RGB) | 6.4 ms | 36.6 ms |

The alpha strip is not worth it; ffmpeg accepts `-pix_fmt rgba` directly.

**Blob trap.** Uploads failed with `TypeError: Failed to fetch`, every retry included, at **frame 63** (about 0.5 GB of uncollected Blobs). Launching Chrome with `--js-flags=--expose-gc` and calling `gc()` after each upload fixed it: verified over 240 frames at 1080p and 120 at 4K. Chromium's design notes describe blob memory and disk quotas and renderer out-of-memory risk with many large blobs ([Chromium blob README](https://chromium.googlesource.com/chromium/src/+show/HEAD/storage/browser/blob/README.md)). The exact root cause on our side is unconfirmed.

The upload also retries up to 5×, and the Node-side `FrameAssembler` is idempotent: duplicate parts or frames are ignored and output order is strict.

---

## 4. Depth of field: ghosting and the fix (measured)

Script: `tools/dofcompare.py`, results in `out/stills/dof_psnr.json` and `out/stills/dof_compare.png`.

CoC in pixels: `K · |d − s| / d`, with `K = (f² / (N_f · (s − f))) · W_px / sensor_w`. For 85 mm at f/2 focused at 0.69 m on 36 mm / 1920 px, **K = 319 px** (the CoC diameter at infinity). N lens samples leave gaps of roughly CoC/√N, so the image shows **N discrete copies**: about 80 px apart at N=16 for the background. This is clearly visible in `hands_agx_N16_pb0.png`.

**Fix (implemented as `blurAddQuad`).** Before accumulating, each sub-frame is blurred with a 48-tap Vogel disk. The radius is `preblur · CoC_px(depth) / (2√N)`, with scatter-as-gather weights so that a blurred background cannot bleed over a sharp foreground. The disk is rotated by the golden angle per sub-frame.

PSNR against N=1024 with no pre-blur, frozen time:

| Variant | Bokeh region | Full frame | p99 error (bokeh) |
|---|---|---|---|
| N=16 | 34.02 dB | 37.88 | 23 |
| N=16 + pre-blur 1.2 | 35.46 | 35.51 | 19 |
| N=32 | 37.67 | 42.13 | 18 |
| **N=32 + pre-blur 1.2** | **39.22** | 41.46 | 14 |
| N=64 | 42.59 | 46.74 | 11 |
| N=64 + pre-blur 1.2 | 43.37 | 45.13 | 10 |

Visually, the pre-blur removes the stepping, and N=32 with pre-blur is indistinguishable from the reference at 100%.

The pre-blur has a cost. Full-frame PSNR drops by about 0.7–2.4 dB, mostly at the extremely defocused foreground hand, where the gather radius is capped at 32 px, and as slight over-softening near the focal plane.

**Rules:**
- N=16 for wide and medium shots, where the background CoC is under about 40 px.
- N=32 + pre-blur 1.0–1.2 for shallow-focus close-ups. Set `nearestDist` per shot.
- Keep defocused foreground objects farther than about 0.5× the focus distance, or raise `maxPreblurPx`.

**Water reflections in heavy DOF.** The pre-blur uses the depth of the water surface, not the reflected object's distance, so it under-fills reflections. The lens sampling itself is still correct for them. The fix if needed: render the `Reflector` with a depth texture and write a "virtual depth" (camera → water → object path length) into an auxiliary target. The planar mirror makes that path length equal the reflected-camera depth.

**Motion blur.** This is an estimate; I did not run this specific test. A finger moving at 1 m/s, shot at 0.6 m with 85 mm, smears about 63 px over a 1/120 s shutter. That is about 4 px between copies at N=16 and 2 px at N=32. In a hand close-up with fast passages, use N=32, or add a velocity-buffer gap-fill blur analogous to the DOF pre-blur. The measured clip (`out/e2e/hands_*`) shows smooth blur on the fast proxy hand at N=16.

---

## 5. Path tracing feasibility (measured)

Scripts: `ptbench.mjs`, `src/pt.js`. Results in `out/pt/*.json` and `*.png`.

- **three-gpu-pathtracer 0.0.27.** The `WebGLPathTracer` now logs *"deprecated … Use WebGPUPathTracer"*. The WebGPU wavefront tracer runs headless on the 780M.
- **Comparable scene.** 612k–664k triangles: piano, pianist, 0.5 M-triangle terrain, lake bed, a physical water dielectric (transmission, IOR 1.333), an equirect sunset environment, a sun light and a `PhysicalCamera` at f/4. Six bounces.
  - `setScene` (BVH build) takes 2.1–3.4 s. The first sample (compile) takes 2.3 s, plus about 9 s of further kernel compiles.
  - **Throughput at 1080p:** 20.8 spp after 24.8 s and 67 spp after 65.6 s, so **about 1.0–1.13 spp/s**, or about 2.2–2.4 M paths/s. That is with `frameBudget = 1e6`; the default of 2.5e5 gave 7.5 spp after 16 s.
  - **Noise.** High-frequency noise on the lacquer: 14.8 at 21 spp and 8.9 at 67 spp, against 6.45 for the N=16 raster render. Fireflies remain at 67 spp (`out/pt/noise_crops.png`).
- **Dynamic updates.**
  - Camera: `updateCamera` takes 0.1–0.6 ms, with the first new sample 25–77 ms later.
  - Rigid motion: `updateTransforms` takes **40–57 ms**.
  - **Skinned mesh** (51k triangles, 12 bones): `setScene` does a `SkinnedMeshBVH` refit plus a top-level BVH rebuild, taking **1.6–4.0 s**. The next sample then takes **6.6–16.6 s**, because `setCamera` calls `rebuild()`.
- **Verdict.**
  - Full film: about 256 spp at about 1.1 spp/s is about 230 s per frame, so **about 36 days. Not feasible.**
  - Hero stills or posters at 1080p: 256–1024 spp in 4–15 min. Feasible. Also use it to produce look-dev reference renders to tune the raster version against.
  - Baking static lighting: feasible. The faster tool is three-mesh-bvh GLSL rays inside WebGL (`bvhbench.mjs`, `out/bvhbench.json`):

| BVH ray test | Result |
|---|---|
| Primary rays only, piano + pianist (113k triangles) | 74 Mrays/s |
| + 4 AO rays per hit | 43.6 Mrays/s |
| + 16 AO rays per hit | **26.9 Mrays/s** (incoherent) |
| + 0.6 M terrain triangles | 31.1 Mrays/s |
| + 2.1 M terrain triangles | 23.5 Mrays/s |
| CPU SAH BVH build | 0.28 s for 113k triangles, 1.5 s for 613k, 9.2 s for 2.1 M |

  A 2048² AO lightmap at 256 rays per texel is about 1.07 G rays, or **about 40 s** (estimate from the measured rate). Bake AO for the piano body, interior, plate, strings and bench this way.

  Do not ray-trace AO every sub-frame across the full screen: one ray per pixel costs about 25–45 ms per sub-frame (estimate from the same rates), which is 2–3× the whole raster pass. For contact occlusion that moves (hands on keys), use screen-space GTAO per sub-frame, or a tiny BVH of the hands only (a few thousand triangles, refit per frame).

---

## 6. Recommended technique per element (research + implications for our pipeline)

### Water: calm, shallow lake with concentric ripples

- **Planar reflection.** `Reflector` per sub-frame. It inherits the jittered, sheared projection, so reflections get correct AA and DOF; verified in `wide_*` stills. Use a 1.0× render target in hero shots and 0.5× elsewhere (23.2 → 19.5 ms).
- **Normals.** No vertex displacement.
  - **Analytic ring sources** at the piano legs, bench legs and feet. Each source is `h = A(r,t) · sin(k r − ω t + φ)` with amplitude decaying as `r^-½ · e^{-βr}`, and the normal comes from the analytic gradient. That is what `scene.js` does.
  - Use the capillary-gravity **dispersion relation `ω² = g k + (σ/ρ) k³`**, with σ = 0.0728 N/m and ρ = 1000 kg/m³, so ring spacing and speed look physically right. My test used ω = 3.2 for k = 9; physically ω ≈ 9.4. For 15 cm rings, k = 42 and ω ≈ 20 rad/s. Phase speed is about 0.5 m/s. ([capillary waves](https://en.wikipedia.org/wiki/Capillary_wave))
  - Emit wave packets from the MIDI: on pedal and keystrokes, or a gentle pulse per bar. The rings then breathe with the music, and it stays deterministic.
  - Add two scrolling tiling normal maps for wind micro-ripples.
- **Fresnel.** Schlick with F0 = ((1.33 − 1)/(1.33 + 1))² ≈ 0.020 ([Schlick approximation](https://notes.lesleylai.info/Concepts/Schlick's-approximation)). The references (ref 6 top-down, ref 1) show much brighter reflections at steep angles than F0 = 0.02 allows, so expose `uF0` and fit it to the references. That fit is a look-dev decision.
- **Glossy blur.** With accumulation this is nearly free: **jitter the micro-normal per sub-frame** (sample a GGX lobe of roughness r). The N sub-frames then average into a rough reflection, with no blur pass and no mips. Alternative: drei's `MeshReflectorMaterial` approach of blurring the reflection render target and mixing by roughness ([drei docs](https://drei.docs.pmnd.rs/shaders/mesh-reflector-material)). Three's `Water.js` uses the same reflection, normal-map distortion and Fresnel pattern ([three.js Water](https://threejs.org/docs/pages/Water.html)).
- **Depth tint.** Use Beer–Lambert absorption over water depth (0.2–0.5 m at the piano) to blend toward the lake bed near the camera. Add a meniscus or foam ring where legs enter the water (refs 2 and 6).

### Sky: sunset with altocumulus

- **Gradient.** Fit it to the measured reference palette (`analysis/ref_stats.json` band colours). For physically plausible colour relationships, Hillaire's sky-view LUT model ([EGSR 2020 paper](https://diglib.eg.org/handle/10.1111/cgf14050)) is the reference. To hit the references, an art-directed fit is more controllable.
- **Clouds: use a 2D cloud layer, not raymarching.** Altocumulus sits at about 3 km. The camera moves a few metres, so volumetric parallax is invisible.
  - Shape: Worley cells × fBm with domain warping ([Quilez, domain warping](https://iquilezles.org/articles/warp)) for the "mackerel" cloudlets.
  - Lighting: a 4–8-tap 2D light march toward the sun gives the bright sun-facing rims and pink undersides.
  - Raymarched volumes ([Schneider/Guerrilla 2015](https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf)) are only worth it for a cloud close-up or time-lapse.
- **Bake the sky once per output frame** into a 2048² cube or 4096×2048 equirect, and sample it in every sub-frame and every reflection. Its per-sub-frame cost then drops to about 0. The thin-lens shear still blurs it correctly at infinity, because each sub-frame samples different directions.

### Terrain: mountains with snow and aerial perspective

- **Shape.** Musgrave **ridged multifractal** ([Texturing & Modeling](https://engineering.purdue.edu/~ebertd/book/book.html); [Blender's description](https://docs.blender.org/manual/en/2.80/render/shader_nodes/textures/musgrave.html)) on a ring 3–15 km out.
- **Triangle budget: about 0.5 M or less.** Measured: dropping 1.5 M terrain triangles saved 7.4 ms per sub-frame. Put detail in normal maps or triplanar detail. Distant ridges can be layered silhouette meshes.
- **Snow.** `smoothstep(height) · (1 − smoothstep(slope))` + noise.
- **Aerial perspective.** Exponential height fog whose in-scatter colour is the **baked sky sampled in the view direction flattened to the horizon**. Mountains then fade into exactly the sky colour behind them, which is the purple layering of ref 2.

### Glossy black lacquer

- **Material.** `MeshPhysicalMaterial` with colour about #020202, base roughness about 0.3, `clearcoat: 1`, `clearcoatRoughness` 0–0.02, IOR 1.5.
- **Distant world.** Use an environment from a CubeCamera at the piano, with the piano hidden, at 512–1024², then PMREM. Update it per frame only when the pianist must appear in it (measured 65–139 ms per frame), otherwise once per shot.
- **Near reflections.** The references (8, 12) show the **hands, keys and landscape mirrored in the fallboard and case** with correct parallax, and a cube map cannot do that for near objects. Add a planar `Reflector` for the fallboard / music desk (and lid underside if it is in frame). Render only the near layers (pianist, keys, interior, baked sky cube) at 0.5×. Estimated +5–10 ms per sub-frame, not measured.

### Skin (mostly backlit hands; the face is never lit)

- Use `MeshPhysicalMaterial` plus a custom translucency term via `onBeforeCompile`: wrap diffuse plus thickness-map transmission toward the sun, for the red rim glow of backlit fingers. Add `sheen` for vellus.
- Optional: separable SSS as a per-sub-frame post pass on a skin mask ([Jimenez et al. 2015](https://graphics.unizar.es/papers/Separable-Subsurface-Scattering.pdf); 0.49 ms at 1080p on an HD 7970 per the paper, not measured here).

### Hair (dark curly)

- Use strand ribbons or cards with **hashed alpha testing** ([Wyman & McGuire 2017](https://research.nvidia.com/publication/2017-02_hashed-alpha-testing)), with the hash seeded by (frame, sub-frame).
- Across N jittered sub-frames this converges to stochastic transparency ([Enderton et al. 2010](https://www.cse.chalmers.se/~d00sint/StochasticTransparency_I3D2010.pdf)): correct, order-independent coverage with no sorting, and up to N coverage levels per pixel. Plain alpha-tested strands also become anti-aliased under accumulation, since jitter supersamples the test. Not measured.
- Alpha-to-coverage is unnecessary, because the scene render target has no MSAA.

### Shadows

- **Jitter the shadow light per sub-frame** across the sun's angular disk (0.53°), or wider to fake skylight softness, with a small PCF kernel. Accumulation produces a true penumbra, the accumulation-buffer soft-shadow technique ([Haeberli & Akeley 1990](https://history.siggraph.org/?p=122075)). PCSS ([Fernando 2005](https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf)) is unnecessary.
- Shadow pass: about 1.1 ms per sub-frame with a 2048² map and the piano and pianist as casters. This is an indirect estimate (section 2.3).
- Skylight occlusion matters more than sun shadows at sunset. Use baked AO (section 5) for static objects and GTAO for dynamic contact.

### Tone mapping and grading

Measured on the same HDR wide frame against ref 2 (`out/stills/tonemap_compare_wide.png`):

| Tone map | Sky saturation | Note |
|---|---|---|
| Ref 2 | 0.423 | target |
| AgX | 0.243 | pastel |
| ACES Filmic | 0.296 | magenta hue skew |
| **Neutral** | **0.428** | |

- **Use Khronos PBR Neutral** ([Khronos press release](https://khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products)), which keeps hue and saturation and compresses only the highlights. Then apply a **33³ 3D LUT fitted to the references**: colour-transfer or histogram match in OKLab from look-dev frames to refs 2/3 for wide shots and 8/12 for close-ups. Add lift/gamma/gain and saturation (already implemented as uniforms).
- Keep the grade **after** tone mapping and **before** dithering.
- Note that PBR Neutral keeps deep shadows darker ([Blender discussion](https://projects.blender.org/blender/blender/issues/118824)); raise exposure or lift the blacks to match the reference shadow floor (`#251e2e`).

### No cheap bloom

- Do not use a threshold-and-blur pass.
- Apply a **lens point-spread function / veiling glare** to the whole accumulated HDR image once per output frame: an energy-conserving kernel, about 97–99% delta plus 1–3% of a wide `~1/(1+(r/r0)²)^1.5` falloff. Build it from a mip pyramid as in Jimenez 2014 ([CoD AW post-processing](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/)), or with an FFT.
- Only the sun disk and the brightest horizon will visibly glow, because they are the brightest values; nothing is thresholded.
- An optional tiny diffraction star on the sun can come from the 9-blade aperture.

### Grain and dither at 60 fps

- **Always** apply TPDF dither of ±1 LSB before quantization ([Gjøl's banding talk, via Wronski](https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/)). Sunset gradients band badly otherwise.
- **Grain is optional.** Measured: 3% scene-linear multiplicative per-pixel grain changed x264 CRF 14 bitrate only from 9.0 to 9.6 Mbit/s, and the sky's high-frequency energy after decode only from 2.11 to 2.39. Most of it is eaten by the encoder, and YouTube will eat more.
- If grain is wanted, make it luminance-only, 1.5–2 px (filtered noise), 2–3 code values in the midtones, seeded with `pcg3d(pixel, frame)`. It must never be `Math.random`.

---

## 7. Determinism, explicit time, resumable chunks

**Verified.** `determinism.mjs` → `out/determinism.json`: hands shot, N=16, grain 0.02, frames 100/101/102.
- Session A rendered in order and session B rendered 102 then 100. Their frame 100 and frame 102 outputs are bit-identical.
- Two fresh sessions rendering frame 101 with the DOF pre-blur are bit-identical.
- Frames 100 and 101 differ.

**Rules (as implemented):**
- **Time.** `t = frame / 60` exactly. Sub-frame times come from a fixed table centred on t, so motion blur is symmetric and adds no lag against the audio. Never use `requestAnimationFrame`, `Date` or `performance.now` in anything that affects pixels. The driver calls `API.renderFrame(f)`; the page never runs its own loop.
- **Avoid virtual-time / BeginFrame tricks.** BeginFrame control stops the page's own event loop and is reported to work only on Linux ([HeyGen notes](https://www.heygen.com/research/html-to-video); [CDP HeadlessExperimental](https://cdpstatus.reactnative.dev/devtools-protocol/tot/HeadlessExperimental)). Explicit time makes them unnecessary.
- **Randomness.** Integer hashes only: `pcg3d(uvec3(pixel, frame*… + subframe))` in GLSL, and `mulberry32` / Halton in JS, seeded from constants or the frame index. Sample tables are identical every frame (`rotatePerFrame = false`), so DOF ghosts, if any, are temporally stable instead of flickering.
- **Animation.** Every animated quantity must be a pure function of t: bones, keys, pedal, camera, ripple emitters, cloth. Any simulation (cloth, hair dynamics) is run offline once and stored per frame, for example `anim/*.bin` indexed by frame; the page only looks values up.
- **Resumable chunks.** Render frames `[a, b)` (300–600 frames, 5–10 s) into `build/chunks/chunk_<a>.mkv` (FFV1).
  - Keep a `manifest.json` per chunk: frame range, scene git hash, settings, ffprobe frame count, sha256.
  - On restart, skip chunks whose file exists and has the right `nb_frames`.
  - Concat with the ffmpeg concat demuxer (`-c copy`), then encode deliverables and mux the WAV (convert to AAC or Opus for MP4).
  - A per-session restart costs about 5 s (scene build plus compile). Pass a chunk's frames in one session.

---

## 8. Recommended architecture

```
music/score.mid + performance.json ──► anim solver (Node/Python, offline, deterministic)
                                        └─► anim/frame_XXXXX.bin: bones (all 10 fingers, wrists, arms, body), keys, pedal,
                                            camera rig + lens per shot, ripple emitters, cloth/hair caches
render page (three r186 WebGLRenderer, GLSL, Chrome 155 headless, ANGLE D3D11)
  per output frame f:   load anim f; bake sky cube (+ lacquer env cube if needed)
  per sub-frame k<N:    pose(t_k), camera(t_k), lens/jitter shear -> shadow map (jittered sun)
                        -> water Reflector (+ fallboard Reflector in close-ups) -> main pass (RGBA16F + depth)
                        -> [DOF gap-fill pre-blur when shallow focus] -> additive accumulate (RGBA32F)
  per output frame f:   veiling-glare PSF -> PBR Neutral -> 3D LUT grade -> [grain] -> TPDF dither -> RGBA8
                        -> sync readPixels -> 4 parallel Blob POSTs (pipelined, gc() after) -> Node
Node driver (puppeteer-core): shot list -> chunks -> FrameAssembler -> ffmpeg FFV1 chunk + manifest
post: concat -> x264 CRF 14 slow yuv420p BT.709 (+audio) for YouTube/GitHub release; optional x265 10-bit / ProRes archive
offline tools: three-gpu-pathtracer WebGPU for reference stills; three-mesh-bvh GLSL AO/lightmap baking for static meshes
```

Per-shot defaults:

| Shot type | N | Shutter | Lens | Pre-blur |
|---|---|---|---|---|
| Wide / establishing | 16 | 180° (0.5 frame) | 24–35 mm, f/4–f/8 | off |
| Medium | 16 | 180° | 50 mm, f/2.8 | off |
| Hand / key close-up | 32 | 180° | 85–100 mm, f/2–f/2.8 | 1.0–1.2, `nearestDist` set per shot |
| Top-down | 16 | 180° | 35–50 mm | off |

Resolution: master at 2160p if the final scene stays under about 3× the test scene's cost; otherwise 1440p at N=32. Both are feasible on this machine per section 2.6.

---

## 9. Harness (`sandbox/render-test/`, gitignored)

The production code to carry over is `src/accum.js` (accumulation, DOF pre-blur, final pass), `lib/frames.mjs` (assembler and encoder presets) and `lib/server.mjs` + `lib/chrome.mjs` (launch flags, keep-alive and gc fixes).

| File | What it measures |
|---|---|
| `probe.mjs`, `probe-webgpu.mjs` | Headless GPU and WebGL2/WebGPU capabilities across flag sets |
| `blendtest.mjs` | Raw WebGL float blending |
| `render.html` + `src/page.js`, `src/accum.js`, `src/scene.js`, `src/rng.js`, `src/noise.js` | Accumulation renderer and test scene |
| `stills.mjs` | PNG stills + timing (`node stills.mjs '{"shots":["hands"],"N":32,"opts":{"preblur":1.2}}'`) |
| `bench.mjs main\|dof` | Timing matrix |
| `e2e.mjs <frames> <N> <encoder\|raw> <shot> [W H start outType]` | Full pipeline into ffmpeg (`E2E_OPTS` env for extra options) |
| `xfer.mjs`, `encbench.mjs`, `determinism.mjs`, `tools/dofcompare.py` | Transfer, encoders, determinism, DOF quality |
| `pt.html` + `src/pt.js`, `ptbench.mjs` | WebGPU path tracer |
| `bvh.html` + `src/bvh.js`, `bvhbench.mjs` | BVH ray throughput |
| `out/` | Stills, JSON results, clips (about 0.8 GB) |

## Sources

- Haeberli & Akeley, "The Accumulation Buffer: Hardware Support for High-Quality Rendering", SIGGRAPH 1990: https://history.siggraph.org/?p=122075 , https://www.microsoft.com/en-us/research/publication/the-accumulation-buffer-hardware-support-for-high-quality-rendering/
- Unreal Movie Render Queue (temporal vs spatial accumulation samples): https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-rendering-image-quality-settings-in-unreal-engine
- Khronos PBR Neutral tone mapper: https://khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products ; Blender discussion: https://projects.blender.org/blender/blender/issues/118824
- Hillaire 2020, scalable sky and atmosphere: https://diglib.eg.org/handle/10.1111/cgf14050
- Schneider 2015, Horizon Zero Dawn cloudscapes: https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf
- Quilez, domain warping: https://iquilezles.org/articles/warp
- Ebert/Musgrave et al., Texturing & Modeling: A Procedural Approach: https://engineering.purdue.edu/~ebertd/book/book.html ; Blender Musgrave node: https://docs.blender.org/manual/en/2.80/render/shader_nodes/textures/musgrave.html
- Capillary waves / dispersion: https://en.wikipedia.org/wiki/Capillary_wave
- Schlick Fresnel: https://notes.lesleylai.info/Concepts/Schlick's-approximation
- three.js Water addon: https://threejs.org/docs/pages/Water.html ; drei MeshReflectorMaterial: https://drei.docs.pmnd.rs/shaders/mesh-reflector-material
- three.js renderer autoClear: https://threejs.org/docs/pages/Renderer.html
- Jimenez et al., Separable Subsurface Scattering: https://graphics.unizar.es/papers/Separable-Subsurface-Scattering.pdf
- Wyman & McGuire, Hashed Alpha Testing: https://research.nvidia.com/publication/2017-02_hashed-alpha-testing ; Enderton et al., Stochastic Transparency: https://www.cse.chalmers.se/~d00sint/StochasticTransparency_I3D2010.pdf
- Fernando, PCSS: https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf
- Jimenez 2014, CoD Advanced Warfare post-processing (bloom pyramid): https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/
- Dithering (TPDF; Gjøl's talk via Wronski): https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/
- YouTube upload encoding settings: https://support.google.com/youtube/answer/1722171
- Chromium blob storage limits: https://chromium.googlesource.com/chromium/src/+show/HEAD/storage/browser/blob/README.md
- CDP HeadlessExperimental / BeginFrame and its caveats: https://cdpstatus.reactnative.dev/devtools-protocol/tot/HeadlessExperimental , https://www.heygen.com/research/html-to-video
- three-gpu-pathtracer (bundled API.md, v0.0.27): https://github.com/gkjohnson/three-gpu-pathtracer ; three-mesh-bvh: https://npmjs.com/package/three-mesh-bvh
