# Afterglow documentation

These are the working documents of the project, kept as they were written while the film was built: each module
owner recorded what was built, what was measured and which command measured it. Start with the repository
[README](../README.md) for the overview; come here for the detail.

| document | what it covers |
|---|---|
| [BRIEF.md](BRIEF.md) | the request, the hardware and the ground rules every agent worked under |
| [DESIGN.md](DESIGN.md) | the architecture contract: repository layout, coordinate frames, time, data formats, page API, rendering model, look targets |
| [RENDERING.md](RENDERING.md) | the render core and the Node drivers: stills, chunked film render, encode and verification, module interface, per-shot settings |
| [INTEGRATION.md](INTEGRATION.md) | how the modules are wired into one film, the checks (wiring, sync, determinism), the film LUT, DOF gap-fill, motion-blur N boost, render-time estimates and the final freeze |
| [PERFORMANCE.md](PERFORMANCE.md) | the performance solver: timing, fingering, keyframes, hand / finger / arm IK, body, feet, keys and dampers, ripples, QC and every solver run |
| [PIANO.md](PIANO.md) | the procedural D-class concert grand: frames, layout, materials, parts inventory, checks |
| [WORLD.md](WORLD.md) | sky, clouds, terrain, boulders, water and lake bed |
| [SHOTLIST.md](SHOTLIST.md) | the edit: 26 shots, cuts against the score, reference coverage, hand readability, faces (generated from `scene/src/camera/shots.js`; its N column predates the final close-up N cap, see INTEGRATION.md 10.1) |
| [CREDITS.md](CREDITS.md) | every third-party asset, library and tool, with licences |
| [USER_FEEDBACK.md](USER_FEEDBACK.md) | the user's feedback rounds |
| [../research/](../research/) | the research notes behind each decision (rendering, audio, music, piano, human, performance, references); `music.md` is the composition brief (the chorus hook note by note, the chord charts with their voicings), so like the score files it is part of the composition, not MIT (see [CREDITS.md](CREDITS.md)) |
| [../assets/pianist/README.md](../assets/pianist/README.md) | the pianist asset and its build pipeline |

## Paths into `build/` and `sandbox/`

The documents name many files under `build/` and `sandbox/`. Neither directory is in the repository:

- `build/` holds everything the commands generate: `build/audio/` (soundtrack), `build/anim/` (performance tracks),
  `build/chunks/` (lossless FFV1 film chunks), `build/out/` (encoded films and clips), `build/snap/` (frozen render
  snapshots), `build/review/` (review stills), `build/qc/` (critic evidence). Re-create them with the commands in the
  repository README.
- `sandbox/` was the local working area of the build: per-module look-dev harnesses, check and analysis scripts,
  logs, progress notes, critic reports and review renders. A path into it records where a number came from; the file
  itself is not published. Four helper scripts are the exception, because published code runs them by path:
  `sandbox/camera/handtrack.mjs`, `sandbox/camera/fk.mjs` (the camera's hand track) and
  `sandbox/integration/blurstep.mjs` (the motion-blur N boost table), which `render/snapshot.mjs` runs, and
  `sandbox/music-research/sketch.py` (the composition sketch, whose score checks `music/afterglow_score.py` imports;
  as a file that encodes the notes it is part of the composition, not MIT: see [CREDITS.md](CREDITS.md)).

The reference images (`refs/`) that the documents compare against are not published either (their licence is
unknown); `research/refs.md` describes them in words.
