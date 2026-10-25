# Project brief: "Afterglow" (working title)

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

Cinematic 3D solo-piano performance rendered offline with Three.js, plus an original piece of music.
Root: the repository root  (Python venv: .venv\Scripts\python.exe, Node 22, ffmpeg 8, Chrome 155)
Hardware: AMD Ryzen 7 260 + Radeon 780M iGPU (shared memory), 62 GB RAM, Windows 11. E: has ~135 GB free.

> **GPU etiquette (one shared GPU slot, render/lib/gpulock.mjs):**
> - Hold the GPU for at most about 15 minutes per session; split longer jobs into batches that close the browser and release the lock in between.
> - Do NOT render full-length animatics before the final phase: one holds the slot for about an hour and stalls every other agent. Render the shots you need, or a short segment.
>
> **READ docs/USER_FEEDBACK.md NEXT.** It holds the user's latest feedback and outranks everything else here:
> the piano is too dark in wides; sleeve end, cuff and skin detail are not good enough; at least 2x more detail overall;
> stills and the song go to the user for approval before any full render. Builders and fixers address it;
> critics check it explicitly.

## The request (paraphrased from the user)
- Build a cinematic 3D piano performance in Three.js that matches the 12 reference images in refs/ (1.png ... 12.png).
  The references are the MINIMUM bar: match mood, light, colour, water, materials and detail; use them as the shot list.
  Scene: a grand piano standing in shallow, calm lake water at sunset (purple/magenta/orange sky, scattered pink-lit clouds),
  ringed by snow-capped mountains with haze; concentric ripples spread from the piano; a pianist in a dark suit with dark
  curly hair plays; strong silhouettes, glossy black lacquer mirroring the sky; close-ups of hands on keys.
- MUSIC: original 3-4 min solo piano piece. Emotional pull of Yiruma's "River Flows in You" WITHOUT copying it, and
  (user's later addition) more POP, with a bit of HIP-HOP feel: think the catchy pop side of classic piano hits.
  Unforgettable theme, rich voicings, moving inner lines, contrasting middle section, a real build to a climax, an ending
  that lands. Must sound composed, not looped arpeggios. High-quality multi-velocity samples, sustain pedal, natural
  releases, tasteful reverb. Melody sings above the accompaniment; expressive rubato and dynamics.
- PIANIST: face always dark (backlit / silhouette / profile; never a lit frontal close-up). Clothing with real thickness,
  seams and folds. FINGERS ARE THE #1 PRIORITY: real piano posture and hand anatomy, all ten fingers animated with correct
  joints, thumb as its own system, no claws / broken knuckles / clipping, real fingering across phrases, wrists and arms
  move between registers, resting fingers relaxed and curved, fingertips meet the moving keys exactly; keys, pedal and
  audio in perfect sync. Body: subtle natural motion (breathing, slight lean into phrases, soft head tilt, relaxed
  shoulders), never stiff, never overacted, no idle loops.
- PIANO: survives extreme close-ups, full interior included.
- CAMERA: directed like a film; time moves and cuts to the music; show the hands playing clearly; never hide flaws behind
  distance or cuts.
- RENDER: offline, frame-by-frame, max quality: supersampling, depth of field, motion blur, proper reflections, filmic
  grading, path tracing if feasible. No cheap bloom. Credit any open-licensed assets.
- ITERATE: render frames and clips, compare side by side with the references, fix the weakest thing, repeat. Review motion,
  not just stills. Listen to the full piece. Never claim a check that was not run.
- DELIVERABLES: (1) full performance video, 1080p minimum (4K if feasible), 60 fps, synced audio, clean picture, no UI;
  (2) soundtrack WAV + MP3; (3) clean source: project, score/MIDI, animation data, render scripts, credits;
  (4) a new PUBLIC GitHub repo with a clean README showing stills and linking the video (LFS or Releases for big files).

## Ground rules for every agent
- Everything must be redistributable in a public repo: only CC0 / CC-BY / MIT-style assets, recorded in docs/CREDITS.md.
- Big downloads go to gitignored folders (music/samples/, sandbox/, build/). Never commit binaries > 50 MB.
- Python: use .venv\Scripts\python.exe (numpy, scipy, soundfile, mido,
  pretty_midi, pillow, opencv, matplotlib installed; pip install more into it if needed).
- Units: metres, seconds. Deterministic: no wall-clock or unseeded randomness in anything that affects a frame.
