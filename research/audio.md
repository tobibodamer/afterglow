# Audio: piano samples, offline sampler, reverb, mastering, onset sync

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Owner: audio agent (2026-10-21). Everything here was run on this machine unless marked otherwise; the commands that
produced each number are listed in section 7. Scratch files and logs: `sandbox/audio/` (gitignored).

---

## 0. Decisions for the lead (TL;DR)

1. **Samples: Salamander Grand Piano V3, 48 kHz / 24-bit** (Yamaha C5, Alexander Holm, **CC BY 3.0**). 30 sampled notes
   (every minor third A0-C8) x **16 velocity layers** = 480 note files, plus 88 key-release noises, 69 damper/string
   release samples (3 kinds x 23 notes), 4 pedal noises. Licence and checksums verified (section 1).
2. **`music/sampler.py` is the whole audio chain**: MIDI *or* `score.json` in, 48 kHz stereo 24-bit WAV + 320 kb/s MP3 +
   a per-note render log out. Deterministic (bit-identical re-render verified). `music/render_audio.py` is a thin
   wrapper that writes `build/audio/afterglow.{wav,mp3,render.json}` and `afterglow_film.wav` (+4.0 s MUSIC_OFFSET).
3. **Sync contract**: the sampler measures every voice's attack and places it **exactly on the note-on**
   (`align_onsets`). Measured `delta_audio(v)` (note-on to audible onset) over 645 renders (3 registers x v=1..127 +
   whole keyboard at v=30/64/100): **median -0.02 ms, all within -3.2 .. +0.06 ms** (section 5). The animator can take
   `t_hs = t_on` (score time) and use `music/onset_calibration.json` or the render log for the residual.
4. **Dampers**: no pedal -> damped decay (T60 1.8 s at A0 ... 0.26 s at E6); CC64 lifts dampers with a half-pedal zone
   (CC64 32..76 = 25 %..60 % pedal travel, research/performance.md 5.5) and 70 ms rail slew; **E6 (MIDI 88) and up have
   no dampers** (matches research/piano.md: dampers on A0-D#6) and ring through pedal lifts.
5. **Reverb**: deterministic synthetic true-stereo hall (no licence question), T30 2.08 s at 1 kHz, EDT 1.45 s, 24 ms
   pre-delay, wet -9 dB re dry. Measured-hall alternative: Detmold Konzerthaus IR (CC BY 4.0, verified), preset
   `detmold_hall.json`.
6. **Mastering**: zero-phase EQ (HP 25 Hz, -1 dB @ 300 Hz, +0.5 dB shelf @ 9 kHz) -> 2:1 slow leveller above the
   integrated level -> true-peak limiter (4x oversampled, 5 ms look-ahead) -> **-16.0 LUFS integrated, -1.2 dBTP**
   (ffmpeg ebur128 agrees), LRA 13.7 LU on the 3:52 sketch; the limiter works only on 0.6 % of the time (max 2.4 dB).
   -14 LUFS is available (`--set target_lufs=-14`) at the cost of up to 5 dB limiting. Decoded MP3 true peak -1.18 dBTP.
7. **Speed**: about 1.2-1.6x real time for the 994-note sketch on the Ryzen 7 260 once the sample cache exists
   (0.8x while other agents loaded the machine; section 6.7). First ever run prepares the samples (~0.37 s per file, cached in `music/samples/_prepared/<hash>/`).

---

## 1. Sample set and licence

| | |
|---|---|
| Name | Salamander Grand Piano V3 (48 kHz 24-bit edition) |
| Instrument | Yamaha C5 grand, two AKG C414 in AB ~12 cm above the strings (README in the archive) |
| Author | Alexander Holm (axeldenstore at gmail) |
| Licence | **Creative Commons Attribution 3.0 Unported**, https://creativecommons.org/licenses/by/3.0/ |
| Source | https://archive.org/details/SalamanderGrandPianoV3 (uploaded 2015-02-18 by lfzawacki) |
| Download | https://archive.org/download/SalamanderGrandPianoV3/SalamanderGrandPianoV3_48khz24bit.tar.bz2 |
| Size | 1,448,107,335 bytes (1.35 GiB) compressed, 1.9 GB unpacked |
| Checksums | md5 `44c5be2c774aeb968cf9bc09952511dd`, sha1 `90dfa11fa1f812a1cd956f38e66bc82820c918aa`: the local file matches archive.org `SalamanderGrandPianoV3_files.xml` (checked 2026-10-21) |
| Mirror | https://github.com/sfzinstruments/SalamanderGrandPiano (FLAC remap by kinwie; README: "Creative Commons Attribution 3.0 Unported License", source archive.org) |
| Local path | `music/samples/SalamanderGrandPianoV3/SalamanderGrandPianoV3_48khz24bit/` (gitignored) |

Licence evidence: the archive.org item page shows "Attribution 3.0" linking to http://creativecommons.org/licenses/by/3.0/;
the README inside the tarball says "Licence: CC-by http://creativecommons.org/licenses/by/3.0/ Author: Alexander Holm";
the SFZ header says "License: CC-by". CC BY 3.0 allows redistribution and commercial use of adaptations (our rendered
soundtrack) with attribution, a licence link and a note of changes. The samples themselves are never committed.

Contents used: `A0v1..C8v16` (480 notes, sfz velocity bands 1-26, 27-34, 35-36, 37-43, 44-46, 47-50, 51-56, 57-64,
65-72, 73-80, 81-88, 89-96, 97-104, 105-112, 113-120, 121-127), `rel1..rel88` (key-up mechanical noise, sfz -37 dB),
`harmL/harmS/harmV3` x 23 notes A0-D#6 (string/damper release resonance for loud/soft notes plus a short "V3" layer),
`pedalD1/2`, `pedalU1/2` (sfz -20/-19 dB). The sfz marks F#6 and up as "Notes without dampers".

**CREDITS.md strings** (copy verbatim):

```
Piano samples: "Salamander Grand Piano V3" by Alexander Holm, licensed under CC BY 3.0
(https://creativecommons.org/licenses/by/3.0/). Source: https://archive.org/details/SalamanderGrandPianoV3 .
Changes: re-imaged to mono-compatible stereo, onset-trimmed and aligned, re-tuned, re-voiced, and rendered by the
Afterglow sampler (music/sampler.py) into the soundtrack.
```
Only if the Detmold preset is used for the final mix:
```
Reverb impulse response: Detmold Konzerthaus, from "Open Database of Spatial Room Impulse Responses at Detmold
University of Music" by S. V. Amengual Garí, B. Sahin, D. Eddy, M. Kob (149th AES Convention, 2020),
https://doi.org/10.5281/zenodo.4007388 , licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
Changes: two open-array capsules used as L/R, trimmed, faded, direct sound removed, high-passed at 60 Hz.
```
The sampler also writes the Salamander credit into every `<out>.render.json` (`credit`) and the MP3 comment tag.

---

## 2. Signal chain (`music/sampler.py`)

```
score.json / .mid --> notes (t_on, t_off, pitch, vel) + CC64 (+CC67)
  per voice:  layer pick + crossfade (2 layers, x-corr aligned) -> soxr VHQ pitch shift (<= +-1 semitone + tuning)
              -> loudness target (smoothed per-key voicing + velocity curve) -> onset alignment
              -> damper envelope (key-up x (1 - damper lift)) + re-strike fade -> constant-power pan by key + side
  per key-up: key noise (rel*) ; at damper contact: release resonance (harm*) scaled by remaining string energy
  pedal:      pedal-down / pedal-up noises at damper-rail half lift ; sympathetic string bank while lifted
  bus:        synthetic hall (true stereo FFT convolution, send HP 110 Hz / LP 11 kHz)
  master:     zero-phase HP 25 Hz + EQ -> 2:1 slow leveller -> BS.1770 gain -> true-peak limiter -> 24-bit WAV, MP3
```

### 2.1 Sample preparation (once per sample, cached)
- **Mono-compatible stereo**. The AB pair cancels badly when summed for some notes (raw (L+R)/2 is 8.7-9.0 dB below
  the channel average on C5 v8/v2, measured). The sampler builds an energy-preserving mid (STFT, per-bin gain
  sqrt((|L|^2+|R|^2)/2 / |M|^2), capped at +9 dB) and keeps the raw mid through the first 10-50 ms (coherent hammer
  transient, no STFT pre-echo), plus the original side signal capped at -9 dB re mid. Measured on C5 v8 by the
  previous agent (`sandbox/audio/test_report.json`, prep settings of that time): mono fold-down -8.65 dB (raw) ->
  -2.01 dB (prepared) over the first 200 ms. Final mix: section 6.4 (-0.56 dB).
- Onset detection (`attack_onset`: -20 dB re peak, back-tracked to the last -32 dB crossing within 8 ms), trim to a
  2 ms pre-roll with a 1 ms raised-cosine fade-in; 20 ms fade-out at the file end; zero-phase rumble HP at
  min(60 Hz, 0.45 f0).
- Cache: `music/samples/_prepared/<hash of the prep settings>/` (.npy float32 + .json meta).

### 2.2 Velocity layers and loudness
- Layer = sfz band containing v; within +-3 velocity units of a band edge two layers are crossfaded (weights 0.5/0.5 at
  the edge -> 1/0 at 3 units). The nearest edge wins for the 2-3-unit bands (v3, v5). The secondary layer is aligned
  on the primary by cross-correlation of the first 60 ms (previous agent's note in the code: onset thresholds of
  different layers disagree by up to ~1.8 ms, which made 50/50 mixes cancel by up to 9 dB without this). Lags found
  on the sketch: up to 144 samples (3 ms); one layer pair hit the +-144-sample search limit.
- Loudness: each mixed voice is scaled to a target 200 ms RMS that interpolates the (median+5-tap smoothed) per-key
  layer levels between layer centres, plus extra velocity tracking `0.30 * 40*log10(v/127)` dB. Measured on the
  scale in test.mid (dry): v20 -40.1, v48 -26.5, v76 -20.6, v105 -14.9, v120 -11.3 dB; monotonic; brightness rises
  with velocity (C4 spectral centroid 482 Hz at v20, 727 at v64, 962 at v100, 1034 at v127).
- Voicing evenness across the keyboard at v72 (`sandbox/audio/iso_report.json`, previous agent's run): largest jump
  between adjacent keys 1.66 dB with voicing on vs 5.25 dB raw; deviation from a 9-key trend 0.08 dB RMS vs 0.99 dB.
- Tuning: `smoothed` (default) keeps the piano's measured stretch (cubic fit of partial 1, partial 2 below C3) and
  removes per-note errors; `retuned` uses Markus Fiedler's retuned sfz offsets; `natural` = as recorded.

### 2.3 Pitch shifting
Each played key uses the nearest sampled note (minor-third grid, so |shift| <= 100 cents + tuning correction) and is
resampled with **soxr VHQ** (python-soxr 1.1.0). Shifted buffers are LRU-cached (8 GB cap).

### 2.4 Dampers, pedal, re-strike (numbers measured in section 6.3)
- Damper decay after key-up without pedal: per-key T60 interpolated over (A0 1.8, C2 1.2, C3 0.8, C4 0.55, C5 0.40,
  C6 0.30, E6 0.26 s), multiplied onto the sample's own decay. The rate is scaled by (1 - lift).
- CC64 -> damper lift: `x = clip((cc - 32)/(76 - 32), 0, 1)`, `lift = x^2 (3 - 2x)` (smoothstep), then slew-limited to a
  full travel in 70 ms. CC64 <= 32: dampers on; >= 76: fully lifted; in between: partial damping (half pedal).
  Pedal noises fire when `lift` crosses 0.5 (down sample on the way up, up sample on the way down).
- **For the animation**: damper contact of a note = first moment after its key-up with lift < 0.5 (logged per note as
  `damper` in the render log); the pedal angle can be mapped linearly from CC64 as performance.md 5.5 says.
- Undamped: keys > `damper_top` = 87 (D#6). E6 (MIDI 88) and up never get a damper envelope or damper release sample.
- Re-strike of a sounding key: the previous voice of that key fades with T60 0.3 s from the new note-on.
- Pedal held after key-up ("catching" a note): the decay stops when the dampers lift (verified: same 0.5 s decay as a
  held key, 11.1 dB vs 11.1 dB).

### 2.5 Releases, noises, resonance
- Key-up noise (`rel<n>`, sfz -37 dB, amp_veltrack 82 %, rt_decay 2 dB/s of hold time) at the key release.
- Release resonance (`harmL` for v >= 45 else `harmS`, plus `harmV3`) at damper contact, **scaled by the string energy
  left**: level = sfz volume + (sample's natural decay at that moment) + (damper envelope). Measured C3 v80: release
  bus -57.9 dB after a 0.15 s hold, -63.2 dB after 1 s, -70.5 dB after 4 s.
- Pedal noise: 2 down / 2 up samples, picked by the seeded RNG, at sfz levels.
- Sympathetic resonance: while the dampers are lifted, the summed strings x lift feed a synthetic bank of all damped
  strings (partials n <= 40 below 9 kHz with inharmonicity, T60 3-10 s, panned by key), gain -42 dB, which measures
  -24.1 dB re the strings while pedalled on the sketch and -23.5 dB on test.mid (-17.3 dB on a sustained 3-note test
  chord at -40 dB gain).
  Nothing without pedal.

### 2.6 Stereo (player's perspective)
Mid panned by key with constant power, A0 at -0.30 ... C8 at +0.30 (bass left, treble right, as the pianist hears it)
plus the sample's own side signal at 0.6 x (capped -9 dB re mid). Measured numbers: section 6.4.

---

## 3. Reverb

Default `reverb='synth'`: true-stereo (2x2 paths, cross paths -6 dB) synthetic hall built from octave-band
exponentially decaying noise (seeded) + 16 soft early-reflection taps in the first 75 ms after a 24 ms pre-delay,
normalised so that `reverb_wet_db` is the wet/dry energy ratio over 250 Hz-2 kHz. Send is high-passed at 110 Hz
(keeps the bass clean) and gently low-passed at 11 kHz.

Measured (Schroeder, `decay_metrics`) on the default IR: T30 per octave 63 Hz 2.39 s, 125 2.39, 250 2.26, 500 2.19,
1k 2.08, 2k 1.91, 4k 1.63, 8k 1.27, 16k 0.91 s; EDT 1.45 s; C80 (wet only) +1.2 dB. In the mix the wet signal is
-9.0 dB re dry (measured on the sketch). These are typical mid-size concert-hall values (RT ~2 s) without washing
out a ballad's moving inner lines; `cinematic_hall` (+1.5 dB wetter, T30 ~2.25 s) and `pop_intimate` (T30 ~1.65 s,
-10 dB) are the alternatives in `music/presets/`.

Measured alternative (`music/ir/detmold_konzerthaus_revc4_r2_stereo.wav`, preset `detmold_hall.json`): Detmold SRIR
database, Set A, Konzerthaus, source S1, receiver R2, RevC4 (enhancement system "Romantik Musik"), open-array capsules
4 (L) and 3 (R). Licence **CC BY 4.0**, verified on https://zenodo.org/records/4007388 (files DetmoldSRIR_v01.zip
985.7 MB, MainDocumentation_v01.pdf 5.2 MB).

| IR as the sampler loads it (`sandbox/audio/ir_final.json`) | T30 250 / 500 / 1k / 2k / 4k / 8k Hz (s) | EDT s | C80 dB (wet only) | L/R correlation of the tail 80 ms-1 s |
|---|---|---|---|---|
| synthetic default | 2.26 / 2.19 / 2.08 / 1.91 / 1.63 / 1.27 | 1.45 | +1.2 | 0.01 |
| Detmold Konzerthaus RevC4 R2 | 2.56 / 2.52 / 2.56 / 2.33 / 2.06 / 1.66 | 1.69 | +0.8 | 0.45 |

The measured hall is longer (2.5 s, the RevC4 "Romantik" setting) and its two capsules 10 cm apart give a much
narrower, more correlated tail. It is kept as an option; the synthetic hall is the default (deterministic, fully
decorrelated tail, no third-party asset in the mix).

---

## 4. Mastering

Chain (`master()`): zero-phase HP 25 Hz (1st order, run forward-backward) + peaking -1 dB @ 300 Hz Q 0.9 (de-mud) +
high shelf +0.5 dB @ 9 kHz (air) -> slow compressor 2:1, soft knee 6 dB, 300 ms RMS detector, threshold = the
integrated loudness, attack 60 ms, release 600 ms -> gain to the target (pyloudnorm BS.1770-4) -> look-ahead
true-peak limiter (4x oversampled detection via soxr, 5 ms look-ahead, 120 ms release, ceiling -1.2 dBTP) -> one
correction pass for the loudness lost to limiting -> 24-bit WAV -> `ffmpeg -c:a libmp3lame -b:a 320k`.
If reaching the target would need more than 6 dB of limiting, the level is lowered instead (reported as
`level_lowered_by_gr_budget_db`).

Mastering experiments on the sketch pre-master (-17.68 LUFS, +2.59 dBTP, LRA 16.0 LU, PLR 20.3 dB;
`sandbox/audio/master_lab.json`):

| variant | target | result LUFS | TP dBTP | LRA LU | limiter max GR / % time | compressor max / mean GR |
|---|---|---|---|---|---|---|
| limiter only (250 ms release), 3 dB budget = the previous agent's default | -16 | **-18.51** (level lowered 2.5 dB) | -1.20 | 15.9 | 3.0 dB / 0.25 % | - |
| limiter only, 6 dB budget | -16 | -16.06 | -1.20 | 15.0 | 5.8 dB / 4.1 % | - |
| limiter only, 9 dB budget | -14 | -14.18 | -1.20 | 13.6 | 8.2 dB / 8.1 % | - |
| 1.5:1 slow + limiter (250 ms) | -16 | -16.03 | -1.20 | 14.5 | 4.3 dB / 2.6 % | 1.9 / 0.09 dB |
| 2:1 slow + limiter (250 ms) | -16 | -16.00 | -1.20 | 13.5 | 2.9 dB / 0.8 % | 3.8 / 0.28 dB |
| **2:1 slow + limiter (120 ms) = default** | **-16** | **-16.00** | **-1.20** | **13.6** | **2.9 dB / 0.4 %** | 3.8 / 0.28 dB |
| 2:1 slow + limiter (120 ms) | -15 | -15.01 | -1.20 | 13.3 | 4.0 dB / 1.9 % | 3.8 / 0.28 dB |
| 2:1 slow + limiter (120 ms) | -14 | -14.04 | -1.20 | 12.8 | 5.1 dB / 4.0 % | 3.8 / 0.28 dB |

(The lab ran before the zero-phase EQ / onset-alignment change; the final sketch render with the default reads
-16.01 LUFS, -1.20 dBTP, LRA 13.7 LU, limiter max 2.4 dB on 0.6 % of the time; section 6.)

-16 LUFS is the default: the lower end of the brief's -16..-14 window keeps the piano's attacks intact (limiter
active 0.4-0.6 % of the time). -15/-14 are one flag away and stay under -1 dBTP.

---

## 5. Onset calibration: delta_audio(v) (research/performance.md sections 1 and 5)

**Method** (`calibrate_onsets` in sampler.py, `python music/sampler.py calibrate`, 81 s wall): the exact render chain
(layer pick + crossfade, pitch shift, onset alignment, zero-phase master HP/EQ) with reverb, resonance, release and
pedal noises and loudness normalisation switched off (gain cannot move an onset; the reverb only adds energy after its
24 ms pre-delay). One note per 2 s slot, so nothing overlaps: velocities 1..127 on **C2 (36), C4 (60), C6 (84)**, plus
the whole keyboard (A0..C8) at v = 30, 64, 100: 645 notes. On each note, envelope = 0.25 ms moving average of
max(|L|,|R|), and:
- `rise` = start of the continuous rise into the hammer attack (first -20 dB-re-peak crossing, back-tracked to the
  last -32 dB crossing within 8 ms) = hammer-string contact as heard at the mics. **This is delta_audio.**
- `t20`, `t10`: first -20 / -10 dB crossings; `peak`: envelope maximum within 250 ms (for reference only).

**Before** the fix (`sandbox/audio/onset_calibration_before_alignment.json`): rise median +0.02 ms but p95 +2.8 ms and
max **+7.9 ms** (C6 v1-24, the softest layer: the trim detector on the raw file and the detector on the rendered
voice disagree by ~8 ms for that file, presumably a slow pre-attack; not inspected further), and
+2 ms at C2 from the causal 25 Hz master high-pass. Not visible at 60 fps (16.7 ms per frame), but avoidable.

**Fix**: (1) every voice's own rise is measured in the sampler (same detector) and the voice is shifted so that rise
sits exactly on the note-on (`align_onsets=True`, clipped to +-10 ms); (2) the master HP/EQ run zero-phase.

**After** (`music/onset_calibration.json`):

| register | rise (= delta_audio) min / median / max ms | t20 median ms | t10 median ms | peak median ms |
|---|---|---|---|---|
| C2 v1..127 | -2.19 / -0.04 / +0.04 | 0.90 | 3.60 | 115.5 |
| C4 v1..127 | -0.29 / -0.04 / 0.00 | 0.48 | 0.81 | 42.6 |
| C6 v1..127 | -0.35 / 0.00 / 0.00 | 0.27 | 0.83 | 2.4 |
| all 645 notes | min -3.19, p5 -1.45, **median -0.02**, p95 0.00, max +0.06 | | | |

The small negative values in the bass are the zero-phase high-pass spreading a few ms of very low-frequency energy
ahead of the attack (it crosses the -32 dB detector early); the audible attack (t20) is still +0.9 ms after the
note-on. The render log of the real sketch (994 notes, mixed chords and pedal) gives rise median 0.000 ms,
max +0.44 ms (`sketch.render.json`, field `onset_ms` per note).

**Contract for the animation**: `t_hs = t_on + delta_audio(v)` with `delta_audio = 0` is exact to within 3.2 ms
everywhere (0.2 frame). For QC, use the per-note `onset_ms.rise` from `<wav>.render.json`, or interpolate
`registers[key].delta_audio_ms[v-1]` from the calibration file. The `peak` column is NOT the onset: the bass waveform
builds up over ~50-115 ms.

---

## 6. Tests and measurements (`sandbox/audio/run_tests.py`, `analyze_final.py`)

All on 2026-10-21, final code. Report: `sandbox/audio/tests_report.json` (previous run before the alignment change:
`tests_report_before_alignment.json`). Test inputs: `sandbox/audio/test.mid` (made by `make_test_midi.py`: C-major
scale v20->120->20 without pedal; I-vi-IV-V with legato pedal pp->ff plus arpeggios; 6 re-strikes of E5 under pedal;
staccato without pedal; undamped C7/E7/G7/C8; half pedal CC64=64; final 11-note ff chord, pedal released at 30 s) and
`sandbox/music-research/sketch.{json,mid}` (994 notes, 3:52, 486 CC64 events).

### 6.1 Level, loudness, clipping
| file | LUFS-I (ours / ffmpeg) | true peak (ours / ffmpeg) | LRA (ours / ffmpeg) | limiter max GR, time | NaN/Inf |
|---|---|---|---|---|---|
| sandbox/audio/test.wav | -16.08 / -16.0 | -1.20 / -1.2 dBTP | 14.2 / 14.2 LU | 5.8 dB, 1.8 % | none |
| sandbox/audio/test.mp3 (decoded) | - / -16.0 | -1.18 dBTP / -1.2 | - / 14.2 | | |
| sandbox/audio/sketch.wav (from JSON) | -16.01 / -16.0 | -1.20 / -1.2 | 13.7 / 13.7 | 2.4 dB, 0.6 % | |
| sandbox/audio/sketch_from_mid.wav | -16.00 / -16.0 | -1.20 / -1.2 | 13.7 / 13.8 | 2.1 dB, 0.6 % | |

The test file is deliberately extreme (pp scale to an 11-note ff chord): PLR 20 dB before mastering, so it needs the
most limiting. No sample anywhere exceeds -1.18 dBFS, MP3 included.

### 6.2 Clicks and discontinuities
Two detectors, both with injection self-tests on the same file (a step and a one-sample spike added at the quietest
10 % spot, the median spot and the loudest spot, at -60/-50/-40 dBFS):
- `detect_clicks`: second-difference spikes > 10x the local 10 ms RMS of the second difference;
- `hf_clicks`: 4th-order 7 kHz high-pass, samples > 8x the local 20 ms RMS and above -75 dB re the file peak.
Note onsets, key-ups and pedal events are excluded +-4 ms on the master (real hammer/key/pedal transients); on the dry
note stem only the onsets are excluded, so voice ends, damper starts, re-strike fades and layer crossfades are tested.

| signal | d2 hits | hf hits | injected clicks found |
|---|---|---|---|
| test.wav master | 0 | 0 | quiet passages (-79 dBFS RMS): all, down to -60 dBFS; median (-32 dBFS RMS): >= -50 dBFS (hf), -40 (both); loud (-10 dBFS RMS): none even at -40 dBFS (masked) |
| test dry note stem | 0 | 0 | same pattern |
| sketch.wav master | 0 | 0 | quiet (-40 dBFS RMS): all down to -60 dBFS; median (-22 dBFS RMS): spikes >= -60 (hf), steps >= -50 (hf) |
| re-strike test | - | 0 | - |

So there is no click above about -60 dBFS in quiet passages or about -50 dBFS in mid-level passages. The detectors
cannot see clicks 30 dB below loud material, which a listener would not hear either.

### 6.3 Behaviour (dry, isolated notes, `behaviour` in the report)
| check | result |
|---|---|
| C4 v64, level drop 0.5 s after key-up: no pedal / CC64 40 / 54 / 68 / 127 | 63.3 / 58.8 / 37.6 / 16.3 / 11.8 dB (monotonic half-pedal) |
| key-up without pedal, drop in 0.5 s: C6 (84), D#6 (87), **E6 (88)**, C7 (96) | 106 / >100 (voice ended) / **4.5 (= held 4.5)** / **14.5 (= held 14.5)** dB |
| pedal lift at 1.0 s, notes released at 0.3 s: G6 (undamped) vs G5 | 1.3 dB vs 67.5 dB drop over the next 0.5 s |
| catch pedal (key up 0.6 s, pedal down 0.75 s) | 26.9 dB lost before the dampers lift, then 11.1 dB per 0.5 s = held-key reference 11.1 dB |
| re-strike C4 under pedal at 1.0 s vs single strike | +0.03 dB (1.05-1.25 s), 0.00 dB (2.0-2.5 s): no level doubling, no click |
| release bus (C3 v80) after holding 0.15 / 1 / 4 s | -57.9 / -63.2 / -70.5 dB (string energy left: -20.2 / -31.2 / -47.5 dB) |
| sympathetic resonance, sustained C3-G3-E4 v90 (at -40 dB gain) | -17.3 dB re notes with pedal; 0 without pedal. Default -42 dB -> -23.5 dB in test.mid, -24.1 dB in the sketch |
| C4 velocity 1..127: level steps between neighbours (v >= 10) | +0.02 .. +0.91 dB, never negative; v20 -41.4, v32 -35.4, v64 -24.1, v96 -19.3, v127 -15.1 dB (analyze_final, 200 ms RMS) |
| C4 spectral centroid v20 / v64 / v100 / v127 | 482 / 727 / 962 / 1034 Hz (timbre from the layers) |
| scale in test.mid (dry, 200 ms RMS) v20 / 48 / 76 / 105 / 120 | -40.1 / -26.5 / -20.6 / -14.9 / -11.3 dB, symmetric on the way down (+-0.5 dB) |

### 6.4 Stereo (player's perspective) and mono
Isolated v70 notes, dry, L minus R level: A0 +6.0, A1 +4.2, A2 +2.5, A3 0.0, C4 -1.8, A4 -2.9, A5 -3.5, A6 -1.1,
A7 -2.9, C8 -4.9 dB: bass on the left, treble on the right, as heard from the bench (the per-note side signal of the AB
pair adds +-1-2 dB of natural variation). Sketch master: L/R correlation 0.76, side 8.7 dB below mid, mono fold-down
only 0.56 dB below the stereo average (the raw AB pair loses up to 9 dB on single notes).

Long-term octave-band levels of the sketch master (dBFS): 63 Hz -36.9, 125 -25.5, 250 -27.3, 500 -23.4, 1k -27.6,
2k -37.6, 4k -47.8, 8k -67.8, 16k -83.8. That is a soft ballad (median velocity 56) on a Yamaha C5 close pair; if the
final mix sounds dull, `pop_intimate.json` adds +1.5 dB at 10 kHz (not auditioned: no listening was possible here).

### 6.5 Determinism and MIDI vs JSON
Two renders of test.mid are bit-identical (sha1 a2cd9a15...). sketch.mid vs sketch.json: note starts differ by at most
0.26 ms (the MIDI writer's 960 tpq at 120 bpm quantises to 0.52 ms), so **use score.json** for the final render (exact
times, no quantisation). Both give the same loudness (-16.0 LUFS) and the same note count (994).

### 6.6 render_audio.py end to end
`python music/render_audio.py --score sandbox/music-research/sketch.json --out sandbox/audio/render_audio_check/sketch`
(preset ballad.json): 230.6 s wall, -16.01 LUFS, -1.20 dBTP, LRA 13.7 LU. `sketch.wav` is 24-bit PCM, 2 ch, 48 kHz;
`sketch.mp3` is MP3 48 kHz stereo 320 kb/s (ffprobe); `sketch_film.wav` is exactly 4.000 s longer, its first 4 s are
digital silence and the rest is sample-identical to `sketch.wav` (max difference 0.0). A first attempt of this run as a
background job exited with code -1 and no output (cause not found; the machine was overloaded at the time); the
foreground rerun above succeeded.

### 6.7 Speed (Ryzen 7 260, shared with other agents' jobs, so wall times vary 2-5x)
| job | wall | audio | note |
|---|---|---|---|
| first ever preparation of a sample | ~0.37 s per file | | 299 files in 110 s (previous agent), cached on disk afterwards |
| test.mid (36 s), samples prepared, light load | 15.2 s render | 36 s | 2.4x real time: voices 10.2, resonance 0.7, reverb 2.6, master 1.5 s (CLI smoke run) |
| test.mid, warm re-render in the same process | 13.7 s | 36 s | run 2 of run_tests.py |
| test.mid, warm, heavy machine load | 82.9 s | 36 s | final run_tests.py run, same code |
| sketch.json (231.6 s), first in process (fills the pitch cache) | 201 s | 232 s | 1.15x RT (run 2) |
| sketch.mid, same process | 144 s | 232 s | 1.6x RT (run 2) |
| sketch, final run under heavy load | 287 / 302 s | 232 s | 0.8x RT |
| onset calibration (645 notes, ~1.3k s of audio) | 81 s | | |
The onset alignment added in the final code costs one 14k-sample envelope per note (negligible).
Peak memory: about 6.6 GB working set for the 232 s sketch (prepared samples are kept in RAM; pitched cache cap 8 GB).

---

## 7. How to run

```
# one-off: sample set (1.35 GiB) into music/samples/ (gitignored)
curl -L -o music/samples/_downloads/SalamanderGrandPianoV3_48khz24bit.tar.bz2 \
  https://archive.org/download/SalamanderGrandPianoV3/SalamanderGrandPianoV3_48khz24bit.tar.bz2
tar -xjf music/samples/_downloads/SalamanderGrandPianoV3_48khz24bit.tar.bz2 -C music/samples/SalamanderGrandPianoV3
pip install soxr pyloudnorm mido soundfile scipy numpy        # into .venv; ffmpeg on PATH for the MP3

# final soundtrack (score from music/dsl.py to_json)
.venv/Scripts/python.exe music/render_audio.py                 # music/final/score.json -> build/audio/afterglow.*
.venv/Scripts/python.exe music/render_audio.py --score sandbox/music-research/sketch.json --out build/audio/sketch
.venv/Scripts/python.exe music/render_audio.py --preset music/presets/cinematic_hall.json --set target_lufs=-15

# direct sampler use
.venv/Scripts/python.exe music/sampler.py render in.json|in.mid out.wav --mp3 out.mp3 [--stems DIR] \
    [--config music/presets/x.json] [--set key=value ...]
.venv/Scripts/python.exe music/sampler.py calibrate              # -> music/onset_calibration.json
.venv/Scripts/python.exe music/sampler.py profile                # re-measure salamander_profile.json

# verification
.venv/Scripts/python.exe sandbox/audio/run_tests.py [test] [behaviour] [sketch]
.venv/Scripts/python.exe sandbox/audio/analyze_final.py
.venv/Scripts/python.exe sandbox/audio/master_lab.py [--rerender]
```
Outputs: `<out>.wav` 48 kHz 24-bit PCM stereo, sample 0 = music time 0 (nothing trimmed at the start; a trailing
silence trim keeps >= 6 s after the last event and fades the last 0.5 s); `<out>.mp3` LAME 320 kb/s CBR with title,
artist and the credit in the comment tag; `<out>.render.json` = stats + pedal events + per-note log (start, end,
pitch, velocity, layers and weights, gain, damper contact time, voice end, onset_ms) + credit; `<out>_film.wav`
(render_audio only) = 4.0 s of silence + the soundtrack, for muxing at film t = 0.
Python API: `S.load_events(path)`, `S.render(notes, ccs, S.config_from(preset, sets))`, `S.write_outputs(...)`.

Config keys most likely to be touched (all in `Config`, overridable by preset or `--set`): `reverb`,
`reverb_wet_db`, `reverb_rt60`, `reverb_predelay_ms`, `target_lufs`, `tp_ceiling_db`, `comp_ratio`,
`limiter_max_gr_db`, `pan_spread`, `resonance_db`, `pedal_lo/pedal_hi`, `damper_top`, `damper_t60_s`,
`release_gain_db`, `key_noise_gain_db`, `pedal_noise_gain_db`, `xfade_width`, `extra_veltrack`, `tuning`.
Changing `preroll_ms`, `onset_thresh_db`, `epd_*` or `rumble_hp_max_hz` re-prepares all samples (new cache folder).

---

## 8. Files

| path | what |
|---|---|
| music/sampler.py | the sampler + mastering + calibration (CLI: render, calibrate, profile) |
| music/render_audio.py | final soundtrack wrapper (DESIGN.md: build/audio/) |
| music/presets/ballad.json (default), cinematic_hall.json, pop_intimate.json, detmold_hall.json | Config overrides |
| music/salamander_profile.json | per-file 200 ms RMS, onset, pitch (cents) of layer 8, measured from the samples |
| music/onset_calibration.json | delta_audio tables (section 5) |
| music/ir/detmold_konzerthaus_revc4_r2_stereo.wav + README.md | optional measured IR (CC BY 4.0), 2.3 MB |
| sandbox/audio/test.wav/.mp3/.render.json, stems/ | test render (section 6) |
| sandbox/audio/sketch.wav/.mp3, sketch_from_mid.wav/.mp3 | sketch renders |
| sandbox/audio/render_audio_check/sketch{.wav,.mp3,.render.json,_film.wav} | render_audio.py output check |
| sandbox/audio/tests_report.json, master_lab.json, ir_final.json, PROGRESS.md | measurements, progress log |

---

## 9. Limits and open points
- Nothing here was auditioned by ear; every judgement above is numeric. A listening pass on the final score is still
  needed (reverb amount, brightness, resonance level).
- Salamander has no una-corda layers; CC67 only lowers the velocity used for layer choice (x0.85) and the level by
  1.5 dB. The score does not use it (research/music.md 5.9).
- Damper T60s and the half-pedal curve are engineering choices, not measurements of a C5; they are monotonic and
  in the range of the sfz's own release (1 s).
- Two stale preparation caches from the previous agent remain: `music/samples/_prepared/291d69441b` (1.1 GB) and
  `d7d06bf82b` (1.2 GB); the current one is `86b1955339`. They can be deleted to free 2.3 GB.
- The detectors in 6.2 cannot certify the absence of clicks under loud material (by design they are masking-aware).
