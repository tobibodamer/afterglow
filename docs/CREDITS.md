# Credits and licences

Every third-party asset, library and tool that Afterglow uses, with author, source, licence and what it is used for.
Each entry was checked against the files in this repository (asset headers, `package-lock.json`, the Python package
metadata of the project venv, and the render log of the released mix, `build/audio/afterglow.render.json`, which
`music/render_audio.py` writes next to the WAV). Rule of the project
(DESIGN.md section 8): only CC0 / CC BY / MIT-style assets go into the film or the repository.

## What licence covers what

The same scope as the top of [`LICENSE`](../LICENSE) and the licence section of the [README](../README.md); the
third-party assets are listed below.

<!-- licence-scope: this block is identical in README.md and docs/CREDITS.md (publish.ps1 checks it) -->
| part | licence |
|---|---|
| The source code: `scene/`, `render/`, `perf/`, `tools/`; the Python code in `music/` (`dsl.py`, `afterglow_lib.py`, `afterglow_checks.py`, `sampler.py`, `render_audio.py`, `mix_meter.py`, and the candidates' helper modules `arranger/arr_tools.py`, `groove/analysis.py`, `groove/checks.py`, `groove/lib.py`, `melody/checks.py`, `melody/lib.py`); the helper scripts `sandbox/camera/handtrack.mjs`, `sandbox/camera/fk.mjs`, `sandbox/integration/blurstep.mjs`; the documentation (`README.md`, `docs/` except `docs/stills/`, `research/` except `research/music.md`, `analysis/`); the data the code generates and reads (the pianist GLB as a build, layouts, LUTs, camera and integration tables, mix presets, sampler calibration) | MIT (`LICENSE`) |
| The musical composition "Afterglow" and every file that encodes its notes: `music/afterglow_melody.py`, `music/afterglow_arr.py`, `music/afterglow_score.py`, `sandbox/music-research/sketch.py`, `research/music.md` (the composition brief: the chorus hook note by note, the chord charts with their voicings, the left-hand patterns); all of `music/final/` (`score.json`, `score.mid`, `leadsheet.txt`, `checks.txt`, `report.txt`, `roll_*.png`); the earlier versions in `music/candidates/`: `arranger/score.py`, `groove/score.py`, `groove/sec_a.py`, `sec_b.py`, `sec_c.py`, `sec_d.py`, `melody/score.py`, `melody/melodies.py`, `melody/chords.py`, `melody/arr.py`, and each candidate's `score.json`, `score.mid`, `leadsheet.txt`, `checks.txt`, `report.txt`, `roll_*.png`; the performance tracks (release asset `afterglow_perf_g1f.zip`: `perf.json`, `perf.bin`, `qc.json`), whose key, hammer and damper tracks encode the notes | © 2026 Leonxlnx, all rights reserved |
| The film and its renders: the film (`afterglow_1080p60.mp4`), the audio renders of the composition (the soundtrack `afterglow.wav` and `afterglow.mp3`) and the stills (`docs/stills/`) | © 2026 Leonxlnx, all rights reserved |
| Third-party assets: the Detmold impulse response in `music/ir/` (CC BY 4.0), the MakeHuman / MPFB parts of the pianist asset (CC0 1.0), the meshoptimizer decoder (MIT) and the others listed in `docs/CREDITS.md` | their own licences, as listed in `docs/CREDITS.md` |

A listed file is excluded from the MIT licence as a whole, including any code in it. The all-rights-reserved parts
are visible here for study: you may read them and rebuild the film and the soundtrack locally for your own study,
but no other right is granted (no copying, publishing, performing, recording or arranging of the music, and no
redistribution of the film, the audio or the stills).
<!-- /licence-scope -->

## Audio

| asset | author / source | licence | use |
|---|---|---|---|
| "Salamander Grand Piano V3" (48 kHz / 24-bit edition) | Alexander Holm, https://archive.org/details/SalamanderGrandPianoV3 | CC BY 3.0, https://creativecommons.org/licenses/by/3.0/ | Every piano note of the soundtrack. **Modified:** re-imaged to mono-compatible stereo, onset-trimmed and aligned, re-tuned, re-voiced and rendered by the Afterglow sampler (`music/sampler.py`). The samples are **not** in the repository: they are downloaded into `music/samples/` (gitignored), see the README. Licence evidence: research/audio.md section 1 |
| Detmold Konzerthaus impulse response (RevC4, receiver R2), `music/ir/detmold_konzerthaus_revc4_r2_stereo.wav` | S. V. Amengual Garí, B. Sahin, D. Eddy, M. Kob, "Open Database of Spatial Room Impulse Responses at Detmold University of Music", 149th AES Convention, 2020; data https://doi.org/10.5281/zenodo.4007388 | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ | **Not used in the released mix.** The soundtrack uses the sampler's synthetic hall (`music/presets/final.json` and `build/audio/afterglow.render.json`: `"reverb": "synth"`). The IR ships only as an optional preset (`music/presets/detmold_hall.json`); the same file is also attached to the v1.0 release (for clones whose Git LFS download fails), with the attribution below in the release notes. **Modified:** two open-array capsules (4, 3) taken as L/R, trimmed to 6 s from 5 ms before the direct sound, faded out over the last 0.5 s, peak-normalised (`music/ir/README.md`); when used, the sampler also removes the direct sound and high-passes it at 60 Hz |

The composition, arrangement, performance data, sampler, reverb and mastering chain are this project's own.

## Pianist (`assets/pianist/`, `scene/src/pianist/`)

| asset | author / source | licence | use |
|---|---|---|---|
| Base mesh, phenotype targets, `default` skeleton and weights, eyes `high-poly`, `eyebrow001`, `eyelashes01` | MakeHuman / MPFB system assets: Data Collection AB, Joel Palmius, Jonas Hauquier; http://www.makehumancommunity.org | CC0 1.0 (MakeHuman `LICENSE.md` section C) | body, rig, eyes (kept for silhouettes) |
| Suit `male_elegantsuit01` (jacket, trousers, shirt front, tie) and its base texture | same | CC0 1.0 (asset header: "explicitly released as CC0 in september 2020") | the suit, recoloured near-black, cloth-simulated and refined by this project |
| Shoes `shoes04` | same | CC0 1.0 (same header) | shoes, recoloured |
| Skin texture "Aksel skin" (asset pack `skins02`) | Mindfront, MakeHuman community | CC0 1.0 | skin base colour (hands too, de-chromed and detailed by this project) |
| Hand detail targets (asset pack `hands01`) | Mindfront and jujube, MakeHuman community | CC0 1.0 | hand shape corrections |
| `scene/src/pianist/vendor/meshopt_decoder.module.js` | meshoptimizer, Arseny Kapoulkine, https://github.com/zeux/meshoptimizer (the copy shipped with three r186) | MIT (notice kept in the file) | decoding the EXT_meshopt_compression GLB |

Made by this project: hair and beard strands, scalp and beard shells, shirt cuffs, pinstripe, suit folds and seams,
nails, hand textures, sleeve buttons and tailoring, all pipeline scripts.

Deliberately **not** used: the `toigo` pinstripe suit recolours (their `.mhmat` header says AGPLv3) and the CC BY hair
packs `hair02` / `hair03` (research/human.md section 2).

Build tools for the GLB (used, **not** redistributed): Blender 5.2.2 (GPL) and MPFB 2.0.18 (GPL-3.0-or-later). The
scripts in `tools/pianist/blender/` drive them through their Python APIs (`bpy`, and MPFB imported at run time from the
local Blender extension directory); no Blender or MPFB code is copied into this repository (checked: no vendored
files, no GPL headers). The scripts are MIT, which is GPL-compatible. Packing: glTF-Transform 4.2.1 (MIT) and
meshoptimizer 0.25.0 (MIT) from `tools/pianist/package.json`; their dependency `sharp` 0.35.5 (Apache-2.0) installs
prebuilt libvips binaries (LGPL-3.0-or-later). None of them is committed (`node_modules/` is gitignored).

## Piano (`scene/src/piano/`) and world (`scene/src/world/`)

None. Geometry, materials, sky, clouds, terrain, boulders, water and lake bed are procedural: no models, textures or
HDRIs were downloaded. Reference data only: published piano dimensions and drawings (research/piano.md) and the
measured string lengths and strike points of the Steinway D in INRIA report RT-0425 (Chabassier and Durufle, 2012),
transcribed as numbers into `tools/piano/inria_wrapped.json`. The INRIA top-view photograph that the layout generator
can draw its plan over is **not** in the repository (licence unknown; `tools/piano/im1.png` is gitignored). The
modelled piano carries no brand name or logo.

## Code libraries (npm, `package.json` / `package-lock.json`)

| package | version | licence | use |
|---|---|---|---|
| three.js (https://threejs.org) | 0.186.1 (r186) | MIT | the renderer, incl. the `Reflector` addon used by the water and the piano mirrors |
| puppeteer-core (https://pptr.dev) | 25.15.0 | Apache-2.0 | drives headless Chrome |
| its dependencies | | Apache-2.0 (`@puppeteer/browsers`, `chromium-bidi`, `webdriver-bidi-protocol`), BSD-3-Clause (`devtools-protocol`), MIT / ISC (`ws`, `yargs`, `zod`, `mitt`, `modern-tar`, `typed-query-selector`, `cliui`, `y18n`, `escalade`, `get-caller-file`, the ansi / string-width helpers) | - |

Reference code: the PBR Neutral tone-mapping function in `scene/src/core/glsl.js` (about 15 lines of GLSL) follows the
Khronos Group's reference implementation, https://github.com/KhronosGroup/ToneMapping (Apache-2.0); three.js ships
the same operator as `NeutralToneMapping`.

## Python packages (`requirements.txt`, installed into `.venv/`, not redistributed)

| package | version | licence (package metadata) | used by |
|---|---|---|---|
| numpy | 2.4.6 | BSD-3-Clause (and bundled 0BSD, MIT, Zlib, CC0-1.0 parts) | music, tools |
| scipy | 1.17.1 | BSD | sampler, mix meter, texture tools |
| soundfile | 0.14.0 | BSD-3-Clause | sampler, render_audio, mix meter |
| pyloudnorm | 0.2.0 | MIT | loudness (sampler) |
| soxr (python-soxr) | 1.1.0 | LGPL-2.1-or-later | resampling (sampler) |
| mido | 1.3.3 | MIT | MIDI in / out |
| matplotlib | 3.11.2 | Matplotlib licence (PSF-based) | piano rolls (score DSL), plan plots |
| pillow | 13.0.0 | MIT-CMU | image tools, stills |
| shapely | 2.2.0 | BSD-3-Clause | piano layout generators |
| opencv-python-headless | 5.0.0.93 | Apache-2.0 | `tools/compare.py`, hand texture tool |

## External programs (used as tools, not redistributed)

| program | version used | licence | use |
|---|---|---|---|
| FFmpeg | 8.0.1 (gyan.dev full build, `--enable-gpl --enable-version3`) | GPL-3.0 build | FFV1 chunks, H.264 / AAC encode and verification, MP3 (libmp3lame) |
| Google Chrome | 155.0.8059.85 | Google Chrome terms | headless WebGL renderer (ANGLE / D3D11) |
| Node.js | 22 | MIT | render driver, performance solver |
| Python | 3.11 | PSF | score, sampler, tools |
| Blender + MPFB | 5.2.2 + 2.0.18 | GPL / GPL-3.0-or-later | pianist asset build only (above) |

## Reference images

The twelve reference images that served as the look target and shot list (`refs/`) are **not** in the repository:
their origin and licence are unknown. `analysis/ref_stats.json` holds only statistics measured on them (luminance
percentiles, hue bands) and `research/refs.md` describes them in words.

## Made with

Afterglow was built with Claude Code (Anthropic), which orchestrated the work as multi-agent workflows (research,
module builders, critics, integration, render). See the README.

## Attribution text (README, release notes, video description)

Piano samples: "Salamander Grand Piano V3" by Alexander Holm, licensed under CC BY 3.0
(https://creativecommons.org/licenses/by/3.0/), source https://archive.org/details/SalamanderGrandPianoV3; modified
(re-imaged, onset-aligned, re-tuned, re-voiced and rendered by the Afterglow sampler). Pianist base mesh, rig, suit,
shoes and skin texture: MakeHuman / MPFB community assets (Data Collection AB, Joel Palmius, Jonas Hauquier; Mindfront;
jujube), CC0 1.0. Rendering: three.js (MIT). Everything else (composition, sampler, performance, piano, sky, mountains,
water, camera, grade) was made for this project.

Wherever the IR file itself is distributed (the release notes, since it is attached to the release) and if a mix
with the Detmold preset is ever published, add: Reverb impulse response: Detmold Konzerthaus, from "Open
Database of Spatial Room Impulse Responses at Detmold University of Music" by S. V. Amengual Garí, B. Sahin, D. Eddy,
M. Kob (149th AES Convention, 2020), https://doi.org/10.5281/zenodo.4007388, CC BY 4.0; modified.
