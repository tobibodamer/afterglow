# Performance solver (`perf/`)

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

Turns the score into the pianist's performance: fingering, hand/arm/finger motion on the real rig, keys, hammers,
dampers, pedals, body motion and water-ripple events, written as the DESIGN.md section 4 tracks
(`build/anim/perf.json` + `perf.bin`), with a QC report measured on the written tracks and QC renders.
Research inputs: research/performance.md (technique, timing, anatomy), research/human.md (rig contract),
docs/PIANO.md (`scene/src/piano/layout.js`, pure data).

## 1. Run it

```
node perf/solve.mjs                                  # full piece -> build/anim/perf.{json,bin} + qc.{json,csv}
node perf/solve.mjs --score music/final/score.json   # explicit inputs (these are the defaults when the files exist)
        --rig assets/pianist/rig.json --glb assets/pianist/pianist.glb --out build/anim
node perf/solve.mjs --range 14,30 --out sandbox/perf/out/x   # fast iteration: plans only the notes in [m0-4, m1+2]
node perf/solve.mjs --no-qc                          # skip the QC pass
node perf/solve.mjs --qc-rate 30                     # QC at 30 Hz instead of the film rate (halves the QC time)
node perf/solve.mjs --range 17.2,17.6 --no-qc --debug R1,17.3,17.5   # per-sample trace of one finger (hand+finger)
node perf/qc/render_all.mjs [--perf build/anim] [--piano simple|real]  # all QC renders (section 7)
node perf/qc/render_qc.mjs sheet|frames|clip ...     # individual renders (see the file header)
```

Re-running on a new score is the first line: the score, rig and GLB defaults are `music/final/score.json`,
`assets/pianist/rig.json` and the GLB in `assets/pianist/` (falling back to `music/candidates/melody/score.json` and
`sandbox/human/out/v11/` while those are missing). Keyframes are cached in `build/anim/cache/kf_<hash>.json`; the hash
covers the score, the rig, the GLB size and the planner sources, so any change re-plans automatically. A full solve
takes ~20 min on this machine (keyframes ~5 min, contact-preserving palm + elbow swivel ~6 min, sampling ~8 min),
plus the QC pass at 60 Hz (~25 min; single-threaded, it re-skins every hand vertex each film frame). With a valid
keyframe cache the solve drops to ~15 min. `--range` runs take 2-5 min.

Timing reference: film t = frame / 60; music m = t - 4.0. All solver times are music time; the reader takes film time.

## 2. Output (DESIGN.md section 4)

`perf.bin`: float32 little-endian, 240 Hz in music time from m = -4.0 (film t = 0) to the last pedal/note event + 6 s.
`perf.json`: `{format 'afterglow-perf', version 1, rate 240, t0 -4, musicOffset 4, frames, stride, duration,
channels[{name, kind, offset, size, stride}], bones[], ripples[], notes[], inputs, command, sha256, ...}`.

| channel | kind | content |
|---|---|---|
| `root`, `spine05..01`, `neck01..03`, `head`, per side `clavicle`, `shoulder01`, `upperarm01/02`, `lowerarm01/02`, `wrist`, `metacarpal1..4`, `finger1-1..5-3`, `upperleg01/02`, `lowerleg01/02`, `foot` | `quat` (4) | FULL local quaternion (x,y,z,w) replacing the bone's bind local rotation (names exactly as rig.json) |
| `root.position` | `vec3` | root bone local position (GLB/pianist frame) |
| `keys` | 88 | key angle (rad) about the balance axis, + = front down; index 0 = A0 |
| `hammers` | 88 | hammer rotation about the flange pin (rad), 0 = rest, `geom/action.js` convention |
| `dampers` | 88 | damper lift (m), notes 1-67 |
| `pedals` | 3 | una corda, sostenuto, damper (rad, + = tip down) |

`ripples`: `[{t (film s), m (music s), pos [x,0,z] rig frame on the water, amp (m), src}]`.
`notes`: per note the finger used, the composer's finger, touch, finger-key time `tFk`, key-bottom `tKb`, release
`tRel0` and the contact point `P0` (pianist frame).

Reader `scene/src/perf/tracks.js` (browser + Node, no dependencies):
`loadPerf(jsonUrl, binUrl)` / `fromBuffers(json, arrayBuffer)` -> `{duration, bones, sampleBones(tFilm, out),
sampleRoot, sampleKeys, sampleHammers, sampleDampers, samplePedals, ripples}`; linear interpolation (nlerp for
quaternions), clamped at both ends. The pianist module (`scene/src/pianist/pianist.js`, via `index.js`) imports it and falls back to
the bind pose without tracks; the piano module reads the key/hammer/damper/pedal channels by name.

Frames (checked numerically, `sandbox/perf/probe_frames.mjs`): the solver works in the pianist (GLB) frame: floor
y = 0, white-key front plane z = 0, keyboard centre x = 0, treble at -x. Piano frame -> pianist frame:
`x_P = KB_CENTER_X - x_p, y_P = y_p, z_P = z_p - KEY_FRONT_Z` (`perf/lib/pianoGeo.js`). The pianist group sits in the
rig at (0, -0.04, KEY_FRONT_Z) without rotation; FK of rig.json equals rig.json world_pos to 0.008 mm, and the bind
middle-finger pads sit over their keys.

## 3. Pipeline (`perf/lib/`)

Fix round 1 (2026-10-22, critic1:anatomy + critic1:motion + the round-1 defect list) changed most stages; every change is
marked `fix round 1` in the code. Section 9 lists them with before/after numbers.

1. **Timing** (`timing.js`): HV = 2^((v-52)/25) m/s; key travel tt = 89.16 HV^-0.570 ms before note-on (struck
   touch 35 ms less, >= 20 ms); key bottom kb = 12.106 HV^-0.702 - 7.444 ms after note-on; pressed profile tau^2,
   struck 1-(1-tau)^1.6; release starts 25 ms before t_off, critically damped (half travel at t_off). Struck touch
   for v > 95 and detached loud chords, and for LEAP LANDINGS: an onset group the hand must leap to (lateral travel
   d beyond a hand width) with less than 0.06 s + 0.45 s/m x d between the previous group's key bottom and a pressed
   contact is played from the air (struck). Re-strikes start from the partly raised key (double escapement); the key
   rises ~60 % first (the stroke starts >= 30 ms after the previous release began, as long as it still takes >= 15 ms).
2. **Fingering** (`fingering.js`): second-order Viterbi per hand with the held-key state, Parncutt rules 1-12 + the
   polyphony terms of research/performance.md 7.2; LH mirrored about D4. Composer fingers are hard constraints unless
   physically infeasible (`validateFingering`: same finger on two held keys, crossed long fingers, span beyond
   MaxPrac+1) or unnatural: an octave-spanning chord without the 5th on its outer note (a bare 1-4 octave on a black
   outer key is allowed) and an identical chord re-fingered on its immediate repetition. Those groups are re-solved
   with the composer finger as a soft prior plus two new costs (`octave_outer_not5` 14, `repeat_chord_change` 25);
   `fingerHand` returns them as `naturalnessOverrides` (`sandbox/perf/test_fingerrules.mjs` prints them).
3. **Release planning** (`plan.js`): a held key whose finger is still on it when new keys start moving constrains the
   hand. Beyond the practical span it is let go early (finger lifts at once); beyond the comfortable span it is let
   go only if the sustain pedal covers the rest of the note (inaudible); the same finger needed elsewhere releases
   early (`resolveFingerTiming`). Leaps need travel time (`releaseForTravel`). Every early release is bounded by the
   SAMPLER's damper model (`pedalCovers`: lift >= 0.99 over the whole released interval [new release, t_off], CC
   half-pedal zone 32-76 with 70 ms slew): up to 250 ms where the dampers stay up, otherwise at most 30 ms (travel)
   or the latest moment the shift allows (impossible spans). `planRestrikes` lets a key go up to 80 ms earlier before a
   re-strike of the same key under full lift (<= 30 ms otherwise). Every moved release carries `relWhy` (reach,
   travel, restrike, sameFinger, fingering, adaptive) into `perf.json notes[]` and the QC.
4. **Keyframes** (`plan.js`, `palm.js`): one palm pose per onset group; a ROLLED chord (notes within 0.12 s, all
   still held, span <= 12 semitones, no finger twice) is one group. 6-DOF Levenberg-Marquardt (2 passes: continuity,
   then anticipation of the next pose). Contact fingers are solved exactly inside the objective; it scores finger
   posture (MCP/PIP/DP angle by context), PIP >= 22 deg (14 for the 5th) and MCP <= 58 deg (no stick, no high claw),
   MCP abduction within limits, the thumb (MCP 8-30 and IP 10-38 deg, pitch 12-40 deg, rolled onto its radial corner,
   pointing along the key), hand pitch/yaw/roll with a forearm-rotation band (palm roll -22..+12 deg, yaw within
   +-24 deg of the bind yaw), the wrist against the arm with the elbow swivel chosen per pose (`bestSwivel`; band ext
   -6..32, ulnar -8..26 deg), reach (elbow never locked), free-finger clearance above the keys, finger-finger capsules
   (contact fingers and the relaxed free ones), the palm/heel off the key bed (`palmPenetration`), and in the final
   passes the MESH collision of every contact finger (`collide.js`). Contact points: white keys on the head (long
   fingers z 16-64 mm, into the tail centred between the black keys only when the hand is deep), the THUMB on white
   keys 2-6 mm RADIAL of the key centre (its ulnar flesh stays over its own key while the key is down), black keys
   8-28 mm (thumb 1.5-20 mm) behind the black front. A strained keyframe (wrist, roll or yaw out of band, a contact out
   of reach) lets a held key go when the pedal covers it and is re-solved.
5. **Palm trajectory**: hold at each keyframe, min-jerk transfers that start only when the fingers that do not carry
   over have left their keys - never earlier: with no time left the hand arrives late and the landing is struck
   (anticipation: arrival 35 ms before the first finger-key contact, up to 0.5 s travel), leap arcs (apex 15 mm +
   0.12 d), rest lifts and phrase-end lift-offs, arm-weight settling after loud attacks, a slow settle and drift on
   every hold longer than 0.6 s (1.5 mm sink, < 1 mm noise), 30 ms zero-phase smoothing. `contactPreservingPalm`
   nudges the palm (<= 12 mm / 6 deg, Gauss-Newton, smoothed 10 ms) wherever a finger on its key could not reach it OR
   its flesh cuts into a neighbouring key. `separateHands` keeps a hand that has no finger on a key >= 10 mm (capsules)
   from the other hand. After the final release each hand lifts ~2 cm and is lowered onto the thigh in ~1.5 s.
6. **Fingers per sample** (`fingers.js`, `hand.js`): long fingers: analytic-hierarchical IK (PIP from the MCP-pad
   distance with DIP = 0.67 PIP, 0.58 on black keys; MCP flexion + abduction aim the chain), PIP >= 16 deg in contact
   (7 for the 5th), DIP >= 5 deg, MCP flexion (-12..88 deg) and abduction clamped to the anatomical limits inside the
   IK; free fingers within +-12 deg of abduction. THUMB: its own 4-DOF chain (CMC flexion + palmar abduction with
   coupled axial pronation, MCP never below 3 deg, IP), damped least squares with posture priors from its
   collision-checked keyframe (free: blended from the last contact's through a relaxed thumb to the next contact's);
   a restart only wins when clearly better (no basin flip-flop); its pad point is the tip's SUPPORT POINT toward the
   keys. Every contact is measured on the skinned mesh and the target corrected along the key normal (continuous, no
   gates). A note's contact starts at `touchT`: pressed notes sit on the resting key one film frame (17 ms) before it
   moves, struck notes land as it starts. A finger re-striking its key rides it up, lifts 2-4 mm when there is time and
   slides its contact point continuously to the next note's. Free fingers: relaxed cascade (MCP 17-29 deg index to
   little, PIP 36-44) with a slow drift, carried by the hand + <= 4 mm lag, >= 5 mm above the keys (no upper clamp:
   a lifted hand keeps its curl); the free thumb rests >= 8 mm behind the key front; departure/arrival paths in the
   PALM frame, the last 60 ms steered onto the key in world space; every free finger is lifted until its skinned
   collision set clears the key bed (and key slip) by 2 mm and pushed out of the fingers already placed (capsules, both
   hands). Then a joint-space smoothing pass (`smoothFingers`: Gaussian 16 ms on free stretches, 5 ms on contact
   stretches, blended over 40 ms; thumb contacts re-projected by minimum-norm steps) removes single-sample pops.
   Last resort (`brushNeighbourKeys`): where a contact finger's flesh still sits in a neighbouring key, that key dips
   silently by the residual (<= 3 mm at the contact, <= 30 % travel: no damper, no hammer flight).
7. **Arms** (`arm.js`): 2-bone IK from the torso's shoulder to the palm with the per-sample swivel (Gaussian 60 ms),
   hinge-aligned upper arm, pronation split 0.5/0.5 over `lowerarm01/02`, wrist takes the rest; clavicles protract
   slightly with lateral/forward reach (-5..7 deg, spring-filtered with an 80 ms half-life so the shoulder girdle
   trails the arm instead of snapping with every leap).
8. **Body** (`body.js`): every phrase gets its own gesture from its own content (lean toward its loudest/highest
   melody note, size from its dynamics) plus seeded variation (size 0.55-1.45x, some phrases lean back, timing
   +-150 ms, head gesture); nods only at some phrase starts (always after a rest) and on accented attacks, spring-
   filtered (no rate-clamp shape); accent dips of the torso (8-15 deg/s); breathing with a varying inhale lead
   (0.35-0.85 s) and irregular extra breaths, 1.15 deg extension of each upper spine joint (x1.4 before big phrases),
   shoulders 4.5 mm; lateral lean/yaw toward the register (up to 5 deg) plus a pelvis slide on the bench (<= 15 mm,
   `root.position` now varies); after the final release the body settles back and the head bows. Critically damped
   springs, rate limits as safety, 3-octave incommensurate noise as seasoning. No loop anywhere.
9. **Feet** (`legs.js`): right ball of the foot on the sustain tread, rotating about the planted heel just enough to
   follow the tread at its angle (table from the shoe mesh, rebuilt from the CURRENT layout.js on every solve), 2-bone
   leg IK from the (slid) hip; left foot at rest.
10. **Keys/action** (`keys.js`): key angle per stroke; hammer follows the key x5 to escapement, free flight to the string
   (`freeFlightMs`), 2 ms contact, rebound to the backcheck (16 mm below the string) while held, falls with the key;
   dampers: key-driven lift from 45-80 % key travel, pedal-driven from the sampler's damper model (research/audio.md:
   half-pedal zone CC 32-76, 70 ms travel), so the visible dampers match the audio; pedal angle = smooth 60-70 ms foot
   stroke centred on each CC64 change. Brushed neighbour keys (6.) add <= 30 % dips with a proportional hammer lift.
11. **Ripples** (`ripples.js`): piano legs/lyre on strong attacks and low-register energy, the right foot on quick
   pedal strokes, bench legs on strong lean changes; rate-limited per source, amplitudes 0.15-2.2 mm.

## 4. QC (`qc.js`, written to `qc.json` + `qc.csv`)

Measured on the WRITTEN float32 tracks (FK of the written quaternions + linear-blend skinning of every GLB hand
vertex), at the film rate (60 Hz), with the command line recorded in both files:

- per note: signed distance of the lowest skinned distal vertex to the key's top plane at key bottom, mid-hold and
  during the press, and whether that point lies on the key (`qc.csv`);
- penetration of every hand vertex into white keys, black keys, fallboard, key slip (by class: contact finger into a
  neighbour, its own key beyond 0.8 mm, free finger, palm);
- finger-finger: skinned vertices of each finger against capsules of the other fingers (radii from the bind mesh);
  hand-hand capsules;
- joint limits from the written quaternions (exact inverse of the rig formula for MCP/CMC flexion+abduction): MCP
  -12..88, PIP 0..104, DIP 0..78 (>= 5 in contact), abduction +-20/15/15/25, thumb CMC rest-30..rest+42, palmar
  abduction -20..35, MCP -10..55, IP -5..75, wrist ext 60 / flex 54 / ulnar 40 / radial 17;
- free fingers: straight (PIP < 10) and claw-like (DIP > 0.9 PIP + 8) counts; wrist angle percentiles;
- peak angular velocity per bone, angular jerk p50/p99 by group, finger pops (> 12 deg per film frame), fingertip speed;
- key-bottom frame vs predicted (+-1 frame target);
- keyframes with an unreachable contact; every early key release with its mechanism (`relWhy`), split into covered (the
  sampler's damper lift stays >= 0.99 from the release to the note-off, or <= 30 ms early) and audible;
- (fix round 1) `pops_240hz`: single-sample joint steps on the written 240 Hz quaternions > 3 deg (and > 8) that are
  > 2.5x the median of the 6 neighbouring steps, by thumb / fingers / arm; `contact_posture`: contact frames with a
  straight finger (PIP < 12, < 8 for the 5th), a hyperextended thumb MCP (< 0) and MCP > 70.

## 5. Current numbers

See section 8 (filled in from the last full run's `build/anim/qc.json`).

## 6. Tools and diagnostics

`sandbox/perf/`: `qcsum.mjs <dir>` (QC summary), `kf_stats.mjs [cache]` (keyframe posture percentiles and the strained
keyframes), `kf_pen.mjs` (keyframe penetration), `kf_probe.mjs R 21.81` (named objective residuals of one keyframe),
`kf_view.mjs R 11.89,3.5 thumbR,top,front` (renders keyframe poses with penetrating vertices marked),
`pen_stats.mjs <dir> m0 m1` (penetration by finger/joint/class), `body_stats.mjs <dir>` (torso/head/arm ranges and
speeds, breathing rate), `probe_thumb2.mjs` (thumb workspace), `probe_span.mjs` (hand span capability),
`check_frames_layout.mjs [perfDir]` (INDEPENDENT frame check: written tracks -> rig FK -> GLB skinning -> rig frame
via the pianist offset (0, -0.04, KEY_FRONT_Z) -> `layout.rigToPiano` -> key rest frame via `layout.keyPoint(-angle)`;
reports the fingertip height above the key top and whether it lies in the key's `contact` polygon, without using
`perf/lib/pianoGeo.js`).

Added in fix round 1 (all read only the written `perf.json`/`perf.bin`, so they compare any two runs):
`anal.mjs <dir> [m0,m1] [poseHz] [--json f]` (critic-style metrics: 240 Hz pops, contact posture, neighbour-key
penetration per hand-pose by finger, free fingers, key slip, palm, finger-finger and hand-hand capsules, palm roll /
forearm twist, early releases against the sampler damper lift by mechanism, re-strike key rise, pad height at key start,
soft pressed landing speed, finger off its key before the release), `body_corr.mjs <dir>` (phrase-to-phrase correlation
of the high-passed torso / head pitch, lateral chest travel vs the hands, pitch rates, breathing travel),
`probe_pedal.mjs <dir>` (shoe sole vs sustain tread gap, pressed and at rest), `test_fingerrules.mjs` (fingering
naturalness overrides).

## 7. QC renders (`perf/qc/`)

`qc.html` + `qc.js`: the pianist GLB posed by the tracks over an accurate keyboard built from layout.js (keys rotate
about the balance axis, black-key boxes, key slip, cheek blocks, open fallboard, pedals) or the real piano module
(`--piano real`, `scene/src/piano/index.js` loads standalone), headless Chrome (ANGLE D3D11).
`render_qc.mjs sheet` = 24 note-on moments (both hands starting notes) from 3 angles: ref-7 over-shoulder (R and L),
ref-12 low side (R and L), top-down; `frames --m a,b,c --views ...`; `clip --m0 --dur 2 --view ...` = 60 fps PNG frames,
MP4 (x264 CRF 16) and a 10-per-second frame strip. Views: `ref7R/L`, `ref12R/L`, `thumbR/L` (thumb side, low),
`frontR/L`, `topBoth`, `wideR/L`. `render_all.mjs` picks the clip windows from the score (densest 2 s, biggest register
jump, first loud chord passage, around the loudest note) and renders everything into `<perf>/qc/`.

## 8. Results of the last full run

(Latest: fix round 2, run f2c, shipped 2026-10-22 09:35: see the subsection "Fix round 2" below; the tables right below are the 2026-10-21 runs.)

Score `music/final/score.json` as of 2026-10-21 17:24 (1131 notes, 220.75 s; the composer is still revising it: re-run
`node perf/solve.mjs`). All numbers are measured on the written float32 tracks at 60 Hz over every film frame (13,888),
penetration counts are skinned-vertex x frame samples. Three full runs of this session; run C is in build/anim (solved into sandbox/perf/out/full4 and copied with its qc.json/qc.csv/qc renders, sha256 b24f8e5b...; perf.json records that command):

| metric (target) | run A, 17:39 | run B: + leap fixes | run C (shipped): + MCP clamp, clavicle filter, breath |
|---|---|---|---|
| contact error at key bottom p50 / p99 / max, mm (p99 < 1) | 0.047 / 0.331 / 6.94 | 0.047 / 0.336 / 1.04 | 0.050 / 0.309 / 3.06 |
| contact during hold p99 / max, mm | 0.40 / 13.5 | 0.31 / 4.70 | 0.31 / 6.53 |
| notes whose pad is off its key | 1 | 0 | 0 |
| independent layout.js check p50 / p99 mm, lowest pad vertex on own key | 0.050 / 0.380, 1123/1131 | 0.047 / 0.329, 1131/1131 | 0.050 / 0.315, 1130/1131 |
| penetration > 1 mm, white / black keys (0) | 91,607 / 103,133 | 52,839 / 74,892 | 53,615 / 78,936 |
| ... by class: free finger / contact finger into a neighbour | 72,165 / 123,925 | 21,620 / 109,011 | 20,248 / 111,827 (own key 1,899, palm 13) |
| max penetration white / black / key slip / fallboard, mm | 11.2 / 6.3 / 9.6 / 1.7 | 11.2 / 6.3 / 14.0 / 0.3 | 11.2 / 6.4 / 14.8 / 0 |
| finger-finger > 1 mm, max mm | 605, 9.1 | 511, 8.7 | 694, 9.1 |
| hand-hand overlap frames, worst mm | 41, 12.0 | 35, 10.8 | 36, 12.3 |
| joint-limit violations, all / finger (0) | 764 / 490 | 673 / 415 | 382 / 0 (all wrist: R 335 frames, worst 8.5 deg past the band; L 47, 2.7 deg) |
| keyframes with an unreachable contact | 96 | 86 | 108 |
| early key releases not covered by the full pedal (count, p50 ms) | 63, 177 | 122, 84 | 122, 84 |
| key bottom vs predicted, film frames p50 / max (+-1) | 0.12 / 0.36 | 0.12 / 0.36 | 0.11 / 0.36 |
| finger pops > 12 deg per film frame | 6,155 | 6,298 | 6,337 |
| left clavicle angular speed p99, deg/s | 62 | 62 | 28 |

Run B: leap landings without travel time are struck (45 notes) and `releaseForTravel` lets the previous key go in
time (205 releases); this removed the late arrivals behind most contact-error outliers and free fingers dipping into
keys during leaps. Run C: MCP flexion clamped inside the finger IK (broken knuckles of 120-140 deg / -69 deg in
cramped poses are gone), clavicle protraction spring-filtered, breathing slightly larger. Its costs: fingers that
used to reach by breaking the knuckle now miss slightly (contact max 3.1 mm, 108 strained keyframes, own-key
penetration up to 4.1 mm) and finger-finger contacts rose; those are the next targets.

Body (run C, `body_stats.mjs`): torso pitch -3.9..+2.5 deg (sd 1.5), roll -2.2..0.1, yaw -2.9..0.1; head pitch / roll
/ yaw within about +-4.5 deg, head speed p99 12 deg/s; chest forward travel 26 mm, head 59 mm; ~12 breaths/min;
wrists ext 11..38 deg, ulnar -2..33 deg (p5..p95).

### Fix round 1 (2026-10-22, runs f1h..f1k in `sandbox/perf/out/`)

Section 3 describes the round-1 pipeline. Two late corrections (agent 6, after QC of run f1h):
- **Late arrivals are bounded.** The planner lets the palm wait for the last finger that leaves a key, which made the
  hand arrive up to 89 ms after the landing key had started (f1h: pad 19 mm above a key at its bottom, 7 notes off
  key). `solver.js` now bounds the lateness to what a struck stroke buys (`ttPress - ttStruck` <= 35 ms, minus 10 ms
  for the finger's own descent); past that the hand leaves earlier, but never before the keys it leaves reach bottom
  (- 5 ms; the transit gets faster, >= 35 ms).
- **A dragged finger lets go.** When the hand has left and a held finger's contact error grows past 3 mm for 3
  samples within 100 ms of its key's release, the finger leaves the key (`n.tLetGo`, `fingers.upT`) and follows its free
  path; in a leap (palm > 15 mm in 80 ms) a departing finger curls into its hover within 70 ms (it was carried rigidly
  in the palm frame for 200 ms). Before: the IK hooked the held finger (MCP 88 deg) and dragged it 11 mm through the
  keys under the hand (L4 at m 173.8), then snapped it straight.
- `separateHands` models a playing finger as a capsule from its base joint to its contact point (the relaxed shape
  missed the playing thumbs) and also moves two busy hands apart sideways (<= 6 mm each).
- The keyframe cache hash covers only `dipRatioFor` from `fingers.js` (the per-sample paths do not affect keyframes).

Shipped 2026-10-22 04:22: run f1k in build/anim (sha256 71e9df37...; solved against the pianist GLB/rig re-exported
03:49 and the current layout.js; previous run C kept in `sandbox/perf/out/shipped_runC/`). QC at 15 Hz (3,472 frames;
penetration counts normalised per frame), `anal.mjs` at 15 Hz (run C at 5 Hz; percentages comparable):

| metric (target) | run C (was shipped) | f1h (agent 5, not shipped) | f1k (shipped) |
|---|---|---|---|
| contact at key bottom p50 / p99 / max, mm | 0.050 / 0.309 / 3.06 | 0.067 / 1.99 / 19.4 | 0.067 / 0.73 / 5.76 |
| contact during hold p99 / max, mm; notes off key | 0.31 / 6.5; 0 | 5.2 / 32.3; 7 | 0.87 / 10.3; 2 (ids 320, 761: composer 1-2-3 / 1-2-4 over 11 semitones, thumb on a black key) |
| pad > 1 / > 2 mm above its key when the key starts moving | - | 101 / 62 (max 32.8) | 38 / 11 (max 4.2) |
| final chord id1126 kb / press, mm | 3.06 / 2.56 | 0.05 / 0.05 | 0.05 / 0.05 |
| finger / thumb / arm pops @240 Hz > 3 deg (> 8) | 18,057 (7,348) / 3,054 / 59 | 2,080 (542) / 341 / 0 | 1,732 (455) / 319 / 0 |
| hand-poses with flesh in a NEIGHBOUR key > 1 / > 2 mm (< 1 %) | 29.2 % / 14.3 % | 24.5 % / 6.6 % | 26.3 % / 8.8 % |
| QC neighbour class > 1 mm, vertex-hits per frame, max mm | 8.1, 10.8 | 19.9, 10.3 | 23.9, 9.0 |
| QC free finger > 1 mm per frame, max mm; key slip max | 1.46, 14.8; 14.8 | 1.00, 7.5; 11.6 | 0.91, 6.8; 7.6 |
| finger-finger > 1 mm per frame, max mm | 0.050, 9.1 | 0.008, 6.1 | 0.009, 6.1 |
| hand-hand overlap frames, worst mm | 36 (60 Hz), 12.3 | 3, 11.8 | 1, 9.6 (m 170.80: RH thumb on E4 beside the LH thumb on D4) |
| joint-limit violations | 382 | 84 | 40 |
| audible early key releases (lift < 0.99 and > 30 ms), p50 / max ms | 122, 84 / 292 | 107, 30 / 118 | 107, 30 / 118 |
| re-strikes: key rise between strokes p50, pairs < 50 % (of 134) | 0.19, 70 | 0.93, 0 | 0.93, 0 |
| thumb MCP in contact p50 R / L, deg; contact MCP > 70 poses | 2.6 / 1.2; 129 (5 Hz) | 8.2 / 6.4; 23 | 8.2 / 6.3; 22 |
| shoe sole vs sustain tread, pressed / rest, mm | -6.6 / -7.7 | - | 0.00 / 0.85-1.09 |
| body: torso phrase-to-phrase correlation median (pairs > 0.8); chest lateral range | 0.65 (43); 9 mm | - | 0.51 (29); 40 mm |

Independent layout.js check of build/anim (`check_frames_layout.mjs`): p50 0.065 / p90 0.18 / p99 0.97 mm, 1127/1131
lowest pad vertices on their own key (320 off; 418, 608, 649 3-4.5 mm). QC renders: `sandbox/perf/out/renders/`
`after_R.png` / `after_L.png` (f1k) against `before2_R.png` / `before2_L.png` (run C) at the same moments.

### Fix round 2 (2026-10-22, runs f2a..f2c in `sandbox/perf/out/`)

Critic round 2 (anatomy + motion) asked first for compact hands (no starfish fan / claws from above), no broken wrist
in the S15 octaves, a flexed thumb and a curved 5th. Changes (all marked `fix round 2` in the code):
- **Fingering** (`fingering.js`): the bare 1-4 octave on a black outer key is no longer allowed (this rig's 1-4 reach
  cannot make 164.5 mm without a 63/65 deg wrist); chords spanning >= 10 semitones with the thumb on a black key take
  the 5th on the outer note; octave weight 14 -> 40. Result: m 118.749 Bb4-Bb5 1-5, 69.952 Ab4-D5-G5 1-2-5, 147.424
  Ab4-C5-G5 1-2-5, 191.412 1-5.
- **Compact hand** (`hand.js`, `palm.js`, `solver.js`): `ADDUCT`, the rest abduction of free / relaxed fingers relative
  to bind (index +16, middle +3, ring -7, little -16 deg toward the middle; index-to-little tip spread of the rest pose 118 -> about 85-90 mm); the free
  abduction cap is centred on it; the keyframe objective pulls contact fingers about half way toward it. Juncturae
  coupling per sample: a resting finger follows its neighbours' abduction deviation (ring 0.5 x little + 0.3 x middle,
  little 0.45 x ring, ...), and an ordering constraint keeps every resting finger >= 3 deg from crossing a neighbour.
- **Thumb** (`hand.js`, `palm.js`): MCP never below 9 deg in the IK (was 3), prior MCP 18 / IP 22 / DP pitch 25 deg,
  keyframe band MCP 12-32 / IP 14-38; free thumb MCP 16.
- **5th finger**: contact PIP floor 17 deg (was 7), keyframe PIP band 26 deg (weight x2), MCP <= 58 band weight x2;
  `plan.js` rolls the palm 4 deg further toward the 5th when 1 and 5 are both down (octaves).
- **Wrist**: keyframe wall at ext 42 / ulnar 33 deg (3 per deg past it).
- **Free-finger lift about the knuckle** (`solver.js`, `fingers.js`): lifting a free finger off the key bed (or into its
  hover) turns it about its MCP (extension, PIP opening a little) instead of pulling the target up toward the knuckle,
  which flexed the PIP into an intrinsic-minus claw.
- **Approach / departure in joint space** (`solver.js monotoneApproach`): the last 120 ms of every long-finger approach
  and the first 80 ms after each release are a monotone (Fritsch-Carlson limited) cubic Hermite per joint between the
  free pose and the exact contact pose, C1 at both ends (a struck finger still arrives with the key stroke's speed).
  A window whose interpolated finger would cut a key (skinned collision set, > 1 mm and > the original path's own depth
  + 0.5 mm) is halved once, else the original path is kept (f2b: 623 approaches + 491 departures replaced, 207 kept).
- **Landing steer** (`fingers.js`): the world-space correction of the last 60 ms is limited to 4 mm horizontally and the
  clamp's distance gate is measured in the palm frame (with a travelling palm the full offset dragged the finger back
  toward the key, then let go of it: curl-in then fling).
- **Struck apex** (`fingers.js`): the finger's own lift before a struck note is <= 4 mm + 100 mm/s x gap and x0.6 for
  the 5th / x0.8 for the 4th (debug of R5 A5 -> Bb5 at m 178.35: a 29 mm apex inside a 57 ms transfer flung the MCP to
  its -12 deg limit with abd at -25 and 9 mm IK error, then re-curled on the key).
- `render_qc.mjs` views `topR` / `topL` (close top-down view of one hand).

Shipped 2026-10-22 09:35: run f2c in build/anim (sha256 5d8ca794...; f1k kept in `sandbox/perf/out/f1k/`). f2a = the
fingering / compact-hand / thumb / 5th / wrist changes; f2b = f2a + joint-space approach + landing steer clamp (same
keyframes); f2c = f2b + struck-apex cap. QC (`qc_table.mjs`; f1k at 15 Hz, f2a / f2c at 30 Hz, counts per frame):

| metric | f1k (was shipped) | f2a | f2c (shipped) |
|---|---|---|---|
| contact at key bottom p50 / p99 / max, mm | 0.067 / 0.73 / 5.76 | 0.066 / 0.97 / 4.13 | 0.066 / 0.97 / 4.13 |
| contact during hold p99 / max, mm; QC notes off key | 0.87 / 10.35; 2 | 0.79 / 12.86; 5 | 0.79 / 12.86; 5 |
| neighbour-key flesh > 1 mm per frame, max mm | 23.9, 8.97 | 23.3, 6.34 | 23.4, 6.34 |
| free finger > 1 mm per frame, max mm | 0.91, 6.79 | 2.39, 9.13 | 2.23, 9.13 |
| own key > 1 mm per frame; palm per frame, max mm | 0.32; 0.06, 7.62 | 0.016; 0.012, 6.85 | 0.029; 0.012, 6.85 |
| finger-finger > 1 mm per frame, max mm; hand-hand frames, worst | 0.009, 6.11; 1, 9.59 | 0.015, 8.01; 1, 6.41 | 0.017, 7.95; 1, 6.41 |
| joint-limit violations (worst wrist excess) | 40 (15.3 / 15.7 deg) | 3 (0.5 deg) | 3 (0.5 deg) |
| pops @240 Hz fingers > 3 (> 8) / thumb > 3 | 1,732 (455) / 319 | 1,284 (276) / 224 | 1,202 (226) / 208 |
| contact frames with a straight PIP | 337 | 0 | 0 |

Critic-style FK counts over the whole piece at 30 Hz (6,637 frames; `sandbox/perf/r2_fk.mjs`, a copy of the critic's
fk_counts with PERF_DIR; `crit/fk_fan.mjs`, `crit/flick.mjs`, `crit/handspeed.mjs`):

| metric (critic round 2) | f1k | f2a | f2c |
|---|---|---|---|
| ring-little splay > 40 deg, frames R / L | 643 / 301 | 67 / 13 | 65 / 10 |
| index-to-little tip spread p50 R / L, mm (all; <= 7-semitone passages) | 113 / 117; 113 / 113 | 98 / 99 | 98 / 99; 96 / 98 |
| 5th held as a straight stick (MCP > 35, PIP < 20, DIP < 15) R / L | 889 / 610 | 342 / 314 | 342 / 314 |
| thumb MCP < 5 on its key R / L; thumb straight (MCP < 8, IP < 12) R / L | 1,133 / 972; 323 / 460 | 0 / 0; 0 / 0 | 0 / 0; 0 / 0 |
| thumb MCP on key p50 R / L, deg; DP pitch p50 R / L | 8.2 / 6.3; 16.9 / 16.3 | 10.7 / 9.0; 17.6 / 16.4 | same as f2a |
| 4-5 crossed (< -12 deg) R / L; 3-4 crossed R | 192 / 181; 142 | 131 / 19; 58 | 105 / 13; 53 |
| intrinsic-minus claw R5 / R2 / R4 / L5 | 159 / 130 / 52 / 22 | 113 / 69 / 3 / 27 | 48 / 53 / 0 / 9 |
| hinged at the knuckle only R5 / R2 / R3 | 37 / 24 / 23 | 10 / 10 / 25 | 10 / 10 / 25 |
| approach flicks > 25 deg (> 15), all notes; R5 | 286 (504); 75 | 288 (517); 78 | 146 (261); 46 |
| R5 approach flicks > 25 deg in the climax (m 175.5-183.5) | - | 14 | 11 |
| LH knuckle frames > 3 m/s (leap teleports, not addressed) | 197 (critic) | - | 221 |

Renders (QC page, simple keyboard): `build/anim/qc/round2/f2c_top_side.png` (topR / topL / ref7R / thumbR at m 107.98
S14, 118.72 S15, 180.62 S21, 185.0 S22) against `build/anim/qc/round2/f1k_top.png` (same moments, f1k). From above the
fingers of the S14 / S15 hands are now close and nearly parallel and the S15 octave is played 1-5 with a level wrist
(f1k: wrist broken ~60 deg, thumb pointing out); the climax hands (S21) are less fanned but still open, since they
hold octave-wide chords.

### Fix round 3 (2026-10-22, workflow wf_84f1a152 round 1; runs f3a / f3b in `sandbox/perf/out/`)

The f2c critics (anatomy, motion + an extra sync / collision sweep) asked for: release caps that do not stack, no
key held down by nothing, no ghost keys, the shoe on the pedal, playing fingers out of the neighbouring keys and free
fingers out of all keys. Changes (all marked `fix round 3` in the code):
- **Release bounds from the original release** (`plan.js rel0Of`, `UNCOVERED_EARLY`; `solver.js` stores
  `n.tRel0Orig` right after the touch timing). `releaseForTravel` and `planRestrikes` bounded every move against the
  CURRENT `tRel0`, which the loop overwrites for each later onset group, so the 30 ms steps stacked (id7 Bb1: 114 ms
  early without pedal) and the 250 ms pedal cap reached 1.7 s (id1 Eb3). Now: covered by full damper lift <= 250 ms
  before the designed release (t_off - 25 ms), not covered <= 15 ms (the damper is back on the string at most one 60 fps
  frame before the note-off; was 30 ms).
- **Keys leave with the finger** (`solver.js`, after the late-arrival clamp, for EVERY transfer): a key the hand leaves
  that is still down when the palm departs starts rising 10 ms before the departure and the finger rides it ~20 ms
  (`relWhy 'transit'`), where the damper rule allows it; otherwise the departure waits for the key (transit >= 60 % of
  its planned time and >= 35 ms). f2c had 19 fully depressed keys with the finger 7-16 mm above them or gone.
- **Brushed neighbour keys** (`brushNeighbourKeys`): a key is never dipped within 150 ms of its own stroke or while it
  sounds, never from the final onset group on (two unplayed keys stayed 19-24 % down for 7 s on the final chord), only
  where the dip resolves the contact (<= 20 % of the travel, was 30 %), and only while the contact exists (no 25 ms
  hold; 12 ms smoothing).
- **Contact points off the neighbour keys** (`shiftContactsOffNeighbours`): per note, the finger is solved onto its key
  at key bottom, mid-hold, just before the release and while riding the rising key, with the planned palm, and the
  contact point moves sideways (+-5.5 mm) and, for long fingers on white keys, toward the key front (-4 / -8 mm) inside
  the contact box to the position with the least neighbour depth. The depth is measured on ALL vertices the finger's
  joints dominate (`fullFingerSet`; the critic's set), not the sparse `colSet` that missed the side flesh. One point per
  note (no sliding inside a hold).
- **Free-finger key clearance** (`freeKeyClearance`, after the joint-space smoothing and `monotoneApproach`): every free
  long finger, full vertex set, against all keys at their CURRENT track angles (own rising key after the release, the
  resting key before the stroke, neighbours during transfers): the MCP opens (past its limit the PIP) just enough to keep
  the flesh <= 0.3 mm in any key; widened +-21 ms, smoothed 17 ms, ramped out over 17 ms at contact boundaries.
- **Pedal foot** (`legs.js gapExact / solvePhi`): phi(angle) is solved against the exact layout.js pedal (curved pad
  `pedalTreadYAt`, rotated about the real pivot, tread polygon + rounded nose) with every right-shoe vertex over the
  pedal, instead of a flat `treadY` plane over a 48 mm strip. With the heel planted and a rigid shoe the sole meets the
  pedal at its NOSE (front edge) in every pose (0.1 mm), the tread behind it sits under a 2.5-6.7 mm wedge
  (`sandbox/perf/probe_pedal3.mjs` = the critic's measurement).
- `solve.mjs --debug-sf` lists every same-finger release with its next same-finger stroke.
- (3b, agent 10) `shiftContactsOffNeighbours` may also move a long finger 12 / 16 mm toward the key front (out of the
  slot between two black keys onto the white key's head). Range A/B (`PERF_DZ_OLD=1` env toggle = the old -4/-8 mm
  set): solver neighbour depth sum 11.2 -> 9.4 mm (m 193.5-197), 21.5 -> 19.3 mm (m 73-76).
- (3b) `freeFingerSeparation` (after `freeKeyClearance`): capsules of the RECORDED angles (after every angle pass, which
  undid the per-sample push), two overlapping long fingers of one hand: the free one yields (abduction away, then the
  MCP opens), with both free the one whose next touch is later (the departing finger, not the landing one); no candidate
  may put the flesh deeper into a key; widened +-21 ms, smoothed 17 ms, ramped at contact boundaries. It cannot act
  where both fingers are on keys (m 74.73: R4 on Ab5 while R3 lands on G5), which needs contact-point placement.
- (3b) `fingering.js`: `same_finger_quick` (8): the same finger on a different key < 0.3 s after its previous note ended;
  the single melody note after an octave-outer-not-5 chord is re-solved too. Effect: LH Ab3-C4-Eb4 at m 49.76-50.51 is
  4-2-1 three times (the composer's first fingering; was 4-2-? / 5-3-1 / 5-3-1). Bar 22 F5 stays on 5: with F5 held over
  G4-Bb4 (1-2) the 2-4 stretch Bb4-F5 costs more than the repeated 5 (open).
- (3b) Speed, output-identical (sha of the range run r3g unchanged): the full-vertex-set passes skip vertices above every
  key top + 1 mm (was 0.76 / 0.78 m, 33 mm above the black tops) and whole fingers whose phalanx segments (minus their
  largest bind vertex radius + 3 mm) lie above all keys. The full-set `freeKeyClearance` is still the slowest pass
  (~18 min alone on a quiet machine; 30-45 min with the GPU/CPU shared by other agents).
- Runs of this round: f3a (agent 9, 15:37: release bounds, transit releases, conservative brush dips, freeKeyClearance on
  colSet, pedal phi vs the exact tread; shoe/ghost/damper/contact numbers in `sandbox/perf/PROGRESS.md`), f3c (+ contact
  shift, full-set clearance, final-chord brush rule; QC 15 Hz in-process), f3d (+ the 3b changes above, no QC). See
  PROGRESS.md for which one is shipped.

**Shipped: f3c** (2026-10-22 21:47, sha256 911e8991; f2c kept in `sandbox/perf/out/f2c`). Measured with the critics'
own tools (copies in `sandbox/perf/crit3/`, `probe_pedal3.mjs`, `check_frames_layout.mjs`, `anal.mjs`), f2c -> f3c:

| check | f2c | f3c |
|---|---|---|
| ghost-key episodes (key > 3 % down, no note near): count / total / > 20 % deep | 262 / 70.5 s / 76 | 149 / 22.6 s / 0 (none on the final chord) |
| damper on the string while the note sounds (sampler lift < 0.5): notes / > 30 ms | 21 / 5 | 18 / 2 (id424 62 ms, id1050 33 ms) |
| repeated notes: key depth at its highest between strokes, p50 | 0.07 | 0.03 |
| shoe over the sustain tread polygon: pressed / half / rest (mm) | 3.92 / 9.0-9.6 / 6.0 | 2.45 / 5.0-6.6 / 4.84 (sole on the nose, 0.1 mm) |
| contact at key bottom + 10 ms: p99 / max (mm), on own key | 1.24 / 6.93, 1122/1131 | 0.63 / 2.65, 1127/1131 |
| m 100-200 @10 Hz: neighbour key > 1 mm / > 2 mm (% of hand-poses) | 36.3 / 12.1 | 30.6 / 7.4 |
| free finger into a key, max (mm) | 6.34 | 4.84 |
| finger-finger max (mm) / poses > 2 mm; hand-hand max | 7.59 / 8; 6.41 | 5.39 / 9; 0 |
| finger off its down key > 1 mm before the release | 11 | 5 |
| pad > 1 mm above its key when the key starts | 16 | 22 (worse) |
| finger pops > 3 deg @240 Hz (> 8 deg) | 702 (130) | 738 (136) |

### Critic round 2 fixes (2026-10-23, agent 11; range run r4a, full run f4a in `sandbox/perf/out/`)
Changes (all marked 'critic round 2' in `perf/lib`):
- **Leaps led during the bass hold** (`plan.js planPivots`, critical S02 item): a transfer > 120 mm away from ONE held
  finger with nothing carried over starts while that finger is still on its key. The hand turns about the vertical
  axis through the held contact point (the finger's own pose and contact are unchanged) by up to 13 deg, so the wrist
  and forearm swing toward the target; the flight continues from the turned pose. One min-jerk progress over
  [pivot start, arrival] drives both phases, with the pivot's share of the path equal to its share of the progress, so
  the speed is continuous. The solver re-plans the pivots after its own arrival/departure clamps.
- **Shorter key descent for leap landings** (`solver.js`): when the flight time after the release (bounded by the
  damper rule) is shorter than 0.09 s + 0.45 s/m of lateral travel, the landing notes (and the rest of a rolled
  landing within 0.12 s) start their key stroke later, down to 40 ms before the hammer (pp leads were 90+ ms).
- The keyframe cache key now includes the note timing computed in `solver.js` (a timing change hit a stale cache).
- `releaseForTravel` no longer travel-releases a note held across the group it would travel to (final chord C3 L5
  came up 275 ms early, 'travel', with no note after it).
- Departure budget (`buildTrajectory`): the <= 8 mm of hand motion allowed before the last finger is up counts the
  hand's turn too (fingertip lever 95 mm), so a hand that rolls toward a thumb-under waits for the held finger.
- Resting long fingers with a next stroke drape toward ~10 mm above their keys (by <= 12 mm, opening about the
  knuckle; 60 % strength beyond 0.6 s), hover DIP/PIP coupling 0.55 (was 0.67) (`fingers.js`).
- Fingering: two thumb crossings within two steps and 0.5 s on a single-note line are re-solved (S16b walk-down
  Ab3 2, G3 1, F3 2, Eb3 1 -> Eb3 3; the composer prior keeps the rest).
- **Final joint-rate limit on free fingers** (`solver.js freeRateLimit`, after every angle pass): each free stretch of
  every finger channel is made <= 3.5 deg per 240 Hz sample (840 deg/s), anchored on the contact samples on both sides
  (contacts stay exact): MCP/PIP/DIP take the lower Lipschitz envelope (never less lifted than the clearance passes left
  them), abduction and thumb channels the mid-envelope, both clamped into the anchors' cones (the key hand-over is
  rate-limited too). `--noRate` switches it off.
- **Palm turn-rate cap** (`solver.js capPalmTurnRate`, before the contact-preserving nudge): where the palm path turns
  faster than 2 deg per sample (480 deg/s, 8 deg per film frame) its rotation is smoothed zero-phase around the event
  (sigma 8-48 ms, the smallest that meets the cap), position untouched. `--noOriCap` switches it off.
- The leap pivot lasts until the held finger is up (`pivot.tE = n.tUp`), so the flight never drags it.
- Substitution on one key (same key, other finger): the outgoing finger leaves >= 35 ms before the incoming one touches
  (`resolveFingerTiming`; S11 Bb2 L3 -> L1 pinch).
- Contact-preserving palm nudge cap 12 mm / 6 deg -> 18 mm / 8 deg (mid-hold hops where the cap was reached).
- Body: breathing runs on its own irregular clock (2.6-8.5 s, faster when loud; drawn into a phrase onset only 35 % of
  the time when one is within 0.9 s, otherwise just before a bar line), no longer one inhale per 4-bar phrase.
  `sandbox/perf/body_ac.mjs` applies the critic's motion_stats metric (10 s moving-average detrend, autocorrelation
  peaks) to body.js directly: breath 0.572 @ 6.13 s / 0.462 @ 12.37 s -> 0.38 @ 6.25 s / 0.19 @ 12.4 s; the torso pitch
  angle alone 0.14, head pitch 0.21, head yaw 0.23 (the remaining 6 s peak is the breathing's own mean period).
- Ship table tools: `sandbox/perf/ship_check_r5.ps1 -Run <dir>` (leaps per hand > 3/4/5 m/s, pops_all, contactsnaps,
  handspeed, arrival, wristsnaps, anal m 100-200, check_frames_layout vs f3c); `sandbox/perf/crit/wristsnaps2.mjs`,
  `hold_census2.mjs`, `tips2.mjs` (critic tools with PERF_DIR / arguments); CPU stills without the GPU:
  `sandbox/perf/crit/cpu_export.mjs <name> <m0> <dur> <perfDir>` + `cpu_splat.py <name> top|over|side [cx]` +
  `cpu_pair.py` (side-by-side sheet), output in `sandbox/perf/out/cpu`.

Measured on the S02 range run r4a (m 4-14) vs f3c, critic tools:

| check (S02, LH) | f3c | r4a |
|---|---|---|
| leaps.mjs m 6.825 G1 -> F3/Bb3: duration / peak knuckle speed | 100 ms / 6.2 m/s | 150 ms / 3.95 m/s |
| leaps m 5.108 / 10.425 / 12.321 peak speed | 4.12 / 4.03 / 4.05 m/s | 2.80 / 2.68 / 2.79 m/s |
| wristsnaps (intro section): hand world orientation frames > 8 deg/frame, L | 2 events | 0 |
| anal m 4.5-14 @30 Hz: finger pops > 8 deg @240 Hz / max step | 4 / 16.6 deg | 2 / 10.8 deg |
| anal: neighbour key > 1 mm (hand-poses), pad > 1 mm above key at key start, off key before release | 57, 1, 0 | 2, 0, 0 |

More range checks (critic tools, same windows of f3c):

| check | f3c | round-2 code |
|---|---|---|
| S11 m 92.5-101.8 (r4b): hold_census notes off their fully down key R / L | 2 (id486 19.2 mm, 84 ms) / 1 | 1 (1.3 mm, 36 ms) / 0 |
| S11 (r4b): finger pops > 8 deg @240 Hz, max step; thumb pops > 8 | 17, 25.1 deg; 4 | 5, 13.7 deg; 0 |
| S11 (r4b): free-finger channel steps > 8 deg per sample (solver log) | 22 | 5 |
| m 166.5-177.5 (r4d): hand world orientation events > 8 deg/frame R / L | 4 / 4 (peak 16 deg/frame) | 0 / 0 |
| m 166.5-177.5 (r4d): contactsnaps count / max | 30 / 29.6 deg (id897) | 30 / 24.8 deg |
| m 166.5-177.5 (r4d): hold_census id897 D5 R5 | 24 mm departure (critic) | 1.2 mm for 12 ms |

Full runs: f4a = code of 02:50 (pivot, leap leads, final chord, departure budget, hover drape, fingering rule);
f4c = all of the above (running at the end of the round). Ship table f3c -> f4a (`ship_check_r5.ps1`, whole piece):

| check | f3c | f4a |
|---|---|---|
| LH transfers > 3 / 4 / 5 m/s (leaps.mjs); worst | 112 / 25 / 3; 6.2 m/s (m 6.825) | 52 / 5 / 0; 4.54 (m 118.79), m 6.825 3.97 |
| LH knuckle frames > 3 m/s; LH angular max (handspeed) | 237; 962 deg/s | 97; 805 deg/s |
| film frames with a finger pop > 8 deg (pops_all) | 141 | 119 |
| LH landings with < 10 ms anticipation / still moving > 0.3 m/s (arrival) | 57 / 66 | 35 / 38 |
| hand orientation frames > 8 deg/frame R / L (wristsnaps; f4a has no turn cap) | 59 / 60 | 52 / 53 |
| contactsnaps: held finger turning > 12 deg/frame while the hand moves | 230 | 247 (worse; pivot ended before the finger was up, fixed for f4c) |
| final chord C3 release | 275 ms early ('travel') | with the chord |
| contact at key bottom (check_frames_layout) p99 / max, own key | 0.63 / 2.65, 1127 | 1.18 / 9.12, 1123 (REGRESSION) |

**f4a is not shipped**: the bar-22 chord Ab4-D5-G5 (1-2-5, thumb on the black key, S08 framed thumb shot at m 70.0)
lost its reach: the thumb is 9.3 mm above its down key for the whole hold and R5 up to 15.6 mm (hold_census2
69.5-70.5; f3c 1.1 / 0.6 mm). Range runs of the current code put the thumb ~3-4 mm off (MCP at its 9 deg floor, IP
3-8 deg), and the old travel-release rule gives the identical result, so the keyframe of this reach-limited chord
moved with the neighbouring keyframes (prev/next pose terms), not with a specific rule. f4c must pass this check
before it ships.

### Critic round 3 fixes (2026-10-23, agent 12; range runs r6a/r6b/r6c, full run f5a in `sandbox/perf/out/`)

Root cause of the f4c regressions (bar 22 thumb off G#4 and R5 off G5 in S08, S15 octave wrist broken into the keys,
S06 id225 thumb off its key and the wrist 20 mm high): all three are **reach-limited keyframes** (a contact more than
0.5 mm off its key even in the best solve). They are reach-limited in every run (f3d errors 5.7/1.9, 8.5/7.9,
1.7/1.5 mm), and the 6-DOF palm solve lands in whatever local minimum the warm start and the neighbour continuity terms
lead to. A change anywhere upstream (f3d -> f4a/f4c: new note timing in the cache key, pivots, departure budget) moved
the warm start, and the keyframes fell into much worse minima (13/7, 14/13, 7.6/4.9 mm), which the per-sample nudge
could not recover (`sandbox/perf/r6/kfdiff.mjs R t0 t1 <kf caches...>` prints the keyframes of several caches). So
no single round-2 rule is the cause, and the bisect the critics proposed would only have found which change moved the
warm start.

Code (marked 'critic round 3'):
- `plan.js` **keyframe reach rescue**: a keyframe with a contact error > 0.5 mm is re-solved from a fan of 11 starts
  around its own pose: lowered 6-10 mm, rolled +-10 / +-20 deg about the forward axis, pushed in / out 12 mm, pitched
  +-8 deg. Each start runs twice, once without the neighbour terms (with the roll preference +8 deg toward the thumb when
  the thumb is on a black key) and once with them. The smallest maximum contact error wins; the cost only breaks ties.
  It runs in both passes. `PERF_NO_RESCUE=1` turns it off.
- `solver.js contactPreservingPalm`: the palm's own flesh in the keys (1 mm margin, `collide.palmPenetration` at the
  keys' track angles) is part of the nudge residual and also triggers a nudge, so the nudge never trades reach for palm
  depth. The nudge raises the palm at most 10 mm above its plan. `PERF_NO_PALMNUDGE=1` turns both off.
- `solver.js freeRateLimit` is **off** by default. It replaced single-sample pops with 840 deg/s ramps and still had
  unlimited steps at the contact samples (critic: framed pops per shot went up in S03/S04/S09/S11/S22, and free flesh
  in the keys rose from 3023 to 5838 frames over 1 mm). `PERF_RATE=1` turns it back on. It should come back only as an
  acceleration-limited re-time that includes the contact boundary.
- New ship gate `sandbox/perf/ship_check_r6.ps1 -Run <run>`: critic hold_census2 (6 ms, 0.5 mm) for bar 22, S06, S15,
  S14 and S18, plus check_frames_layout and the qc.json summary, all against f3c.

Range results (hold_census2 6 ms / 0.5 mm; anal.mjs 30 Hz), f3c / f4c / new:

| check | f3c | f4c | new |
|---|---|---|---|
| bar 22 (r6a): id320 R1 G#4 | 1.1 mm, 132 ms | off key (50 mm cap), 132 ms | clean |
| bar 22: id322 R5 G5 | 0.6 mm, 18 ms | 16.2 mm, 246 ms | 0.9 mm, 30 ms |
| bar 22: id326 R5 F5 | 3.0 mm, 90 ms | 0.7 mm, 66 ms | clean |
| S06 (r6c): id223 R3 F5 / id225 R1 G#4 | 3.7 mm 108 ms / 0.6 mm 12 ms | 0.6 mm 60 ms / 4.1 mm 96 ms | 0.6 mm 42 ms / 0.6 mm 6 ms |
| S06 keyframe 54.487 palm height, errors | 755 mm (f3d), 1.7/1.5 mm | 775 mm, 7.6/4.9 mm | 740 mm, 0.8/0.6 mm |
| S15 (r6b) id627 R5 Bb5 | 0.7 mm, 120 ms | 2.7 mm, 252 ms | clean |
| S15 m 118.5-119.2: palm max, free max, neighbour > 1 mm | 0, 4.66 mm, 20.5 % | 10.97, 10.12 mm, 43.2 % | 0, 1.64 mm, 20.5 % |

Full run **f5a** (sha256 16fa23c5, solve 2054 s, QC 15 Hz) **was shipped to build/anim** on 2026-10-23 09:47 (f3c stays
in `sandbox/perf/out/f3c`). Solver log f4c -> f5a: keyframes with an unreachable contact R 64 -> 19, L 37 -> 4; overlap left after
finger-finger separation 12.4 -> 5.6 mm. Gate files: `sandbox/perf/out/ship6_f5a.log`, `ship6_f3c_base.log`, `ship_f5a.log`.

| check | f3c (was shipped) | f4c | f5a (shipped) |
|---|---|---|---|
| hold_census2 bar 22 (69.5-70.5 R): notes > 0.5 mm, worst | 3, 3.0 mm | 3, off key / 16.2 mm | **0** |
| hold_census2 S06 (53.5-62 R) | 6, 3.7 mm | - | 2, 0.8 mm |
| hold_census2 S15 (118.4-119.4 R) | 2, 0.7 mm | 2, 2.7 mm | **0** |
| hold_census2 S14 (106.8-114.1 L) | 4, 11.2 mm (id547) | - | 2, 1.1 mm |
| hold_census2 S18 id761 R1 G#4 | 2.9 mm, 1416 ms | 1.37 mm | 1.2 mm, 1410 ms |
| check_frames_layout p99 / max; own key | 0.63 / 2.65; 1127/1131 | 1.07 / -; 1120 | 0.289 / 2.115; 1128 |
| qc contact max / p99; hold max; off key | 2.72 / 0.74; 2.60; 1 | 5.60 / 1.03; 3.34; 5 | 1.21 / 0.43; 1.18; 1 |
| qc palm > 1 mm, max | 136, 6.60 mm | 482, 10.97 | 15, 1.88 |
| qc free > 1 mm, max | 1868, 5.56 | 5838, 7.77 | 1027, 6.47 |
| qc own key > 1 mm, p99 | 517, 1.77 | 599, 4.85 | 182, 3.37 (fewer, deeper tail) |
| qc neighbour > 1 mm, max | 57362, 6.68 | 33586, 11.2 | 35196, 6.31 |
| qc finger-finger > 1 mm, max; hand-hand worst (1 frame) | 56, 6.98; 4.45 | 75, 7.16; 6.0 | 85, 6.83; 7.18 (worse) |
| qc pops240 fingers / thumb > 8 deg; finger_pops_gt12 per frame | 242 / 21; 4782 | 50 / 26; 6341 | 189 / 15; 6304 (worse) |
| qc contact mcp > 70 frames; wrist ext p95 R / L | 10; 43.0 / 37.6 | 22; 42.8 / 37.3 | 37; 44.1 / 38.3 (worse) |
| LH leaps > 3 / 4 / 5 m/s (leaps.mjs) | 112 / 25 / 3 | - | 60 / 6 / 0 |
| framed film frames with a finger pop > 8 deg (pops_all) | 141 | - | 104 |
| wristsnaps frames > 8 deg/frame R / L | 59 / 60 | - | 0 / 7 |
| handspeed frames > 600 deg/s R / L | 24 / 16 | - | 0 / 3 |
| contactsnaps hold + hand moving; < 60 ms before up | 230; 148 | - | 212; 125 |

Shipped because every contact check is better: bar 22, S06 and S15 holds, contact max, off key, frame layout, palm, and
neighbour depth. Worse than f3c: finger-finger count, hand-hand worst (one frame), contact MCP > 70 frames, the
whole-piece finger_pops_gt12 count, the own-key depth tail, and wrist ext p95 (+1 deg). These are open items below.
scene/src/camera/handtrack.json and scene/src/integration/motion_n.json are keyed to f3c (911e8991). Their owners
must regenerate both in one step.

### Cycle 2 fix round 1 (2026-10-23, agent 13; range runs r7a..r7f, full run g1c in `sandbox/perf/out/`)
Changes (all marked 'cycle 2' in `perf/lib`):
- **S11 wrist snap (critical, LH m 100.97-101.1)**: root cause found with `sandbox/perf/r7/armdbg.mjs` and the critic's
  `fkb.mjs`: the LH keyframe at T 100.968 kept L4 on D3 (id500) as a FIXED contact although that key's release had
  already begun (tRel0 100.954), while the thumb took Bb2 (id502) BELOW it. The keyframe solved to yaw 110 deg (cost
  6002); the palm slerped into it, the wrist travelled 160 mm forward/out in 100 ms with the elbow straight (6 deg) and
  the hand 102 deg off the forearm. `plan.js`: a strained keyframe now lets go of a held key whose release has begun
  (tRel0 <= T + 10 ms), whatever the pedal (the key rises on its own track, the sound is unchanged), and is re-solved.
  Range r7a (S11): LH wrist ext max 100 -> 25 deg, |deviation| max 127 -> 33; hold census L 3 notes (id500 50 mm) -> 0.
- **Thumb opposition (major)**: `hand.js` THUMB_MCP_MIN 9 -> 14 deg, new hard THUMB_IP_MIN 10 deg (IK clamp),
  THUMB_PREF cmcAbd 10 -> 14 / MCP 20 / IP 24, relaxed thumb opposed and bent (cmc 6, abd 12, MCP 20, IP 28);
  `palm.js` keyframe band MCP 18-32 (/0.6), IP 16-38 (/0.8); `solver.js` THUMB_FREE MCP 20 / IP 26. Probe
  (`sandbox/perf/r7/probe_thumb_null.mjs`): on this rig MCP and IP trade against each other at a fixed pad position
  (MCP + IP ~ 36-40 deg), so the band asks for the balanced MCP ~18 / IP ~18-22 instead of MCP at the floor.
- **Compact resting hands (major)**: `hand.js` ADDUCT x1.3 (20 / 4 / -9 / -21 deg; bind-palm tip spread 90 -> ~80 mm);
  `fingers.js` `onKeysW(t)` (smooth 0..1 weight of 'this hand has a finger on a key', 0.12 s ramps) and a drape of
  EVERY resting long finger to ~6 mm above its keys while the hand is on the keys (<= 22 mm, about the knuckle, opening
  factor 0.25); `solver.js`: a free target that can only be reached hinged (MCP > 40-55 with PIP < 34-26, the S14
  'pointing' finger) is blended back toward the relaxed carried hover (continuous weight) and re-solved.
- **Flicks (I-37)**: `solver.js` `despikeFree()` after `monotoneApproach`, before the key clearance: 17-tap running
  median on the FREE samples of every finger channel (removes pulses up to one film frame, keeps ramps/gestures),
  applied where it differs by > 3 deg, corrections smoothed 8 ms; then steps whose 60 fps second difference exceeds
  7 deg are softened with a 20 ms Gaussian under a smooth +-50 ms mask. Contact samples are anchors. PERF_NO_DESPIKE=1.
- **Rescue tie-break**: a rescue start that breaks the wrist wall (ext > 42, ulnar > 33 or < -16) or a contact MCP > 70
  counts 0.8 mm worse.
- **Leaps**: `releaseForTravel` asks for the 2 m/s min-jerk time (<= 0.32 s) where the pedal covers the early release.
  It does NOT change the S02 LH leap (m 6.82): there the pedal is UP from 6.68 to 6.82 while G1 (id17, t_off 6.869)
  sounds and F3/Bb3 land at tFk 6.969, so the bass key cannot rise before ~6.83 without the key rising while its note
  sounds; the flight is bounded at ~130 ms by the frozen score (peak 3.7 m/s in r7d). Open: a larger pivot during the
  hold or accepting it.
- Tried and reverted: flatter playing shape (white 23/42/70, black 19/32/58) + hand pitch -4 deg for a lower knuckle
  line (ranges r7d/r7e/r7f): knuckles stayed 61-69 mm above the keys and the R thumb MCP fell back to its floor.
- After run g1d: resting free fingers keep PIP >= 28 deg (18 within 0.1-0.2 s of a key, smooth), the on-keys drape is a
  pure arc about the knuckle, and every resting finger's hover pad stays >= 22 mm in front of the fallboard face (g1d:
  LH octave A#1-A#2 at m 165.3 with both thumb and 5th on black keys put the wrist at the key front and the relaxed
  index 34 mm into the fallboard; range r7k: 0 frames, max tip z 136 mm). Full run g1f = all of the above.

Numbers, f5a (shipped) -> g1d (full run, all changes except the last bullet). FK: the critic's `fkb.mjs` at 30 Hz +
`sandbox/perf/r7/handstats.mjs` (`sandbox/perf/r7/after_g1d.log`); QC: in-process 15 Hz.

| metric | f5a | g1d |
|---|---|---|
| wrist episodes (ext > 60, radial < -45, rig flex < -40, twist > 10; critic `episodes.mjs`) | 1 (S11 m 101.0) | **0** |
| LH wrist ext / |deviation| max (deg) | 100 / 127 | 45 / 38 |
| thumb on a key with MCP at the 9 deg floor, R / L frames | 1181 / 1588 | **0 / 0** (MCP p50 15.9 / 15.2) |
| thumb IP < 8 deg on a key, R / L | 115 / 86 | **0 / 0** |
| hinged free fingers (MCP > 50, PIP < 30), R / L | 139 / 303 | 2 / 4 |
| free-hand fingertip spread 2-5 p50, R / L (mm) | 97 / 98 | 92 / 93 |
| I-37 flicks60 (readable hands) > 8 / 12 / 15 deg | 136 / 40 / 16 | 70 / 9 / 2 |
| S20c RH m 176.1 wrist ext (deg) | 50 | 26 |
| contact p99 / max (mm), off key | 0.43 / 1.21, 1 | 0.49 / 1.30, 0 |
| hold p99 / max (mm) | 0.31 / 1.18 | 0.30 / 1.01 |
| check_frames_layout p99 / max (mm), own key | 0.29 / 2.12, 1128 | 0.44 / 1.49, 1129 |
| hand-hand worst (mm); finger-finger > 1 mm (max) | 7.18; 85 (6.83) | 4.99; 213 (5.44) |
| contact MCP > 70 frames; joint-limit violations | 37; 10 | 10; 1 |
| free fingers > 1 mm into keys / fallboard (vertex-frames) | 1027 / 0 | 3544 / **42986** (fixed in g1f, see above) |
| bar-22 hold census (S08, 69.5-70.5 R) | 0 notes | **id322 R5 13.1 mm for 84 ms** (open) |

Production stills (render/still.mjs, 1080p N16, perf override g1d) vs f5a: `sandbox/perf/out/renders/c2_pairs/`
(lighting differs: other modules changed between the two sets). S11 f6300: the LH is no longer folded at the wrist;
S06 f3876: the RH thumb no longer hangs below the palm; S02 f1140: LH more compact, the RH thumb still sticks out;
S14 f6660: the LH index still points sideways at the RH; S08 f4440: the RH pointer thumb is unchanged.
g1d was not shipped (fallboard, bar 22); g1f (fallboard fix) was still solving at the end of the round. Still not met: knuckle height (p50 61-63 mm above the keys, target ~50), the
spread target 75-85 mm, I-37 (0 flicks > 12 deg), the S02 LH leap (bounded by the score), neighbour-key flesh.

### Cycle 2 fix round 2 (2026-10-23, agent 14; range runs r8a..r8m, full runs g2a / g2b in `sandbox/perf/out/`)
Critic round 2 said the pointer thumb (user's #1 priority) was visually unchanged: the joint floors made the MCP/IP
numbers look bent, but the CMC was laid back (-26..-32 deg) and the tip sat 40-73 mm outside the index-MCP line with a
near-horizontal MCP-to-tip line; the hands were tented (knuckles ~60 mm above the white tops, wrist ~22 mm below the
knuckle line). Changes (all marked 'cycle 2 fix round 2'):
- `palm.js` posture-space thumb terms in the keyframe objective (`THUMB_POSTURE`; `PERF_OLD_THUMB=1` restores g1f):
  contact-thumb tip <= `ctx.thOut` mm outside the index-MCP line (/2.5 mm), MCP-to-tip line >= 25 deg down (/2 deg),
  CMC >= `ctx.cmcFloor` (/3 deg). `plan.js`: thOut 32 mm (+5.5 mm per semitone of the held span beyond 8, +6 for a thumb
  on a black key), cmcFloor -8 deg = the rig rest (-3 deg per semitone beyond 8, -2 on black). The reach rescue's free
  starts drop these terms and use a loose thumb prior (`THUMB_LOOSE`, MCP/IP floors 4 / 2 deg, thumb bands x0.25), so a
  chord the floors make unreachable is solved as before instead of breaking the wrist (range r8a: keyframe T 66.771 R3
  held F5 + thumb on black Ab4 yawed 50 deg, wrist ext 47 / uln 42 -> 0 joint-limit frames in r8e..r8m).
- `palm.js` palm height (`PALM_HEIGHT`; `PERF_OLD_PALMH=1` off): knuckles (mean MCP) 44-52 mm above the white tops (/3 mm),
  wrist joint -12..+6 mm of the knuckle line (/3 mm), bind-pitch prior /5 -> /14, flatter contact PREF (white 24/42/dpa 60,
  black 20/34/52, fast 26/48/68, chordFF 18/38/62), free-hover check of the keyframe with relaxed(0.6) (the full relaxed
  curl, tip ~62 mm below the knuckle, held the knuckle line up).
- `hand.js` solveThumb: soft CMC floor min(-8, keyframe cmc - 4) and MCP-to-tip line >= 22 deg (weights 0.02);
  `thumbClamp(mcpMin, ipMin)` per-note floors (`solver.js` thumbSeq: the keyframe's own angles - 2 deg); `polishThumb`
  never raises MCP/IP above its input (no floor pop).
- `solver.js` contact PIP floor opens up to 12 deg when a long finger is reach-limited at the floor (continuous in the
  error; `PERF_NO_PIPRELAX=1` off). `fingers.js` on-keys drape 6 -> 9 mm (`DRAPE_ON`, `PERF_DRAPE6=1` old).
  `solve.mjs` writes `inputs.scoreSha1` to perf.json.

Range checks (critic `fkc.mjs` 30 Hz + `sandbox/perf/r8/rsum.mjs`; g1f -> new code):

| range | measure | g1f | new |
|---|---|---|---|
| S14 105.5-108.5 (r8b/r8i) | R on-key thumb thUnder p50 / CMC p50 | -48.6 mm / -25.5 | -19.7..-24.3 / -5..-12 |
| | pointer frames (CMC < -12 and tip > 45 mm out) R / L | 15 / 5 | 0 / 0 |
| | knuckles above the white tops p50 R / L (mm) | 57.7 / 66.9 | 53-55 / 55 |
| S08 66-72 (r8a/r8m) | R on-key thUnder p50, pointer R / L | -53 mm, 38 / 28 | -35..-54, 17-26 / 0-2 |
| | knuckles p50 R / L; wrist minus knuckle line p50 R | 60 / 63; -20 | 54 / 53; -15 |
| S22 182.5-186 octaves (r8c/r8k) | R on-key CMC p50, MCP-tip line p50 | -31, 17 | -22, 22 |
| S02 11-16 (r8d, first weights) | knuckles R, wrist-knuckle R, line pitch R | 60, -25, 14 | 51.5, -11, 20 |

Full run g2a (sha256 20e7d068; posture + palm-height code, WITHOUT the loose rescue / per-note floors / PIP relax / IK
weight fix) vs f5a and g1f (`sandbox/perf/r8/gate_g2a.log`; FK = critic `fkc.mjs` 30 Hz on the readable hand-shot sides):

| measure | f5a | g1f | g2a |
|---|---|---|---|
| on-key thumb tip outside the index-MCP line p50 R / L (mm) | 36.7 / 45.0 | 37.7 / 45.6 | **30.9 / 35.8** |
| share of on-key thumb frames > 35 mm out R / L | 53 / 82 % | 55 / 72 % | **37 / 57 %** |
| thumb MCP-to-tip line p50 on a key R / L (deg) | 16.9 / 17.6 | 15.5 / 17.6 | **21.0 / 22.1** |
| pointer census (CMC < -12 and tip > 45 mm out) R / L | 329 / 267 | 318 / 318 | **227 / 189** |
| knuckles above the white tops p50 R / L (mm) | 58.9 / 60.0 | 59.2 / 60.3 | **52.8 / 54.3** |
| wrist minus knuckle line p50 R / L (mm) | -24.1 / -24.8 | -21.8 / -24.5 | **-11.4 / -10.3** |
| contact MCP p50 R (deg) | 37.5 | 37.6 | 24.0 |
| anat framed: pointerThumb / thumbOut / wristExt / knuckleHigh | 596 / 557 / 32 / 131 | 636 / 515 / 65 / 115 | 416 / 229 / 0 / 55 |
| anat framed: freeClaw / freeLifted / freeStraight | 35 / 47 / 1213 | 38 / 67 / 19 | 132 / 227 / 82 |
| I-37 flicks60 > 8 / 12 / 15 deg | 136 / 40 / 16 | 71 / 9 / 2 | 73 / 21 / 6 |
| QC contact max / p99 (mm); notes > 1.5 mm | 1.21 / 0.43; 0 | 1.30 / 0.49; - | **2.54** / 0.58; **5 (all thumbs)** |
| QC hold max (mm) | 1.18 | 0.85 | **10.94** (id914 L1 D4 m 170.71) |
| QC own-key / free / neighbour flesh > 1 mm (vertex-frames) | 182 / 1027 / 35196 | 373 / 3427 / 29486 | **1321** / 2090 / 20299 |
| QC finger-finger > 1 mm; hand-hand worst (mm); joint limits | 85; 7.18; 10 | 212; 4.99; 1 | 281; 9.76; 3 |
| hold census bar 22 / S06 / S14 L (worst mm) | 0 / 0.8 / 1.1 | 13.1 / 1.0 / 1.0 | 18.7 / 7.3 / 11.1 |

g2a was NOT shipped: the per-sample thumb IK posture residuals (weight 0.02 per rad, ~3.5 mm per 10 deg) traded thumb
contact before the min-norm polish (5 thumb notes > 1.5 mm, mostly thumbs on black keys; fixed in the code afterwards:
0.006 and a 10-step polish, range-tested only). **Shipped instead: g1f** (critic recommendation; S11 LH wrist fold fixed,
contact / hold / off-key / fallboard / joint limits no worse than f5a; known: bar-22 id322 13.1 mm / 84 ms, free flesh
1027 -> 3427). build/anim = g1f sha256 150017f6; f5a kept in `sandbox/perf/out/f5a`. Stills of g2a (1080p N16 final,
`sandbox/perf/out/renders/c2r2_g2a/`): S02 f1140 flatter, lower hands and the LH no longer clawed
(`pair_s02_f1140_hands.png`), f990 the LH thumb tucked beside the index; S22 f11298 (octave passage) the free RH thumb is
still a straight horizontal stick (`../c2r2_range/pair_s22_f11298_hands.png`).

Bar 22 (id322 G5 R5) is NOT fixed by the thumb floors (r8m 19.2 mm / 90 ms; g1f 13.1, f5a clean): debug r8l
(`sandbox/perf/out/r8l.log`, `--debug R5,70.08,70.24`) shows R5 reach-limited at its 17 deg PIP floor (err 1.8 mm, MCP 53)
and the palm rising 2-4 mm at 70.11-70.16 at the start of its transfer to F5, so the per-sample let-go fires 87 ms before
tRel0. Needs the planner to hold a reach-limited carried contact's palm until tRel0 (see open items).

Full run **g2b** (sha256 0e3ad8e7; the round's full code incl. the loose rescue, per-note floors, PIP relax and the IK
weight fix; solved 18:43-19:20, QC 19:29) was gated by the final integration pass (`sandbox/perf/r8/gate_g2b.log`,
2026-10-23 19:35) and is **NOT shipped**; build/anim stays **g1f** (150017f6). Passed: QC contact p99 0.489 mm (g1f 0.486),
notes off key 0, hold max 1.72 mm (< 2), fallboard 0, hand-hand 0. Failed: joint limits 19 frames (R wrist 18 frames up to
+1.9 deg at m 100.2-101.3, R4 abduction +3.3 deg at m 103.2; g1f 1 frame +0.2), contact max 4.13 mm (g1f 1.30), own-key
flesh > 1 mm 958 (373), I-37 flicks60 > 12 deg 24 (g1f 9). Anatomy census (all framed, of 4442; g1f -> g2b): better
thumbOut 515 -> 265, pointerThumb 636 -> 344, wristExt 65 -> 14, knuckleHigh 115 -> 68; worse thumbStraight 0 -> 142,
contactStraight 0 -> 38, freeClaw 38 -> 134, freeLifted 67 -> 252, freeStraight 19 -> 92. The thumb / palm-height gain is
real (on-key thumb > 35 mm out R 54.8 -> 41.3 %, knuckles p50 59.2 -> 53.3 mm) but it brings new straight thumbs and
straight contact fingers, so it is not better on the census.

### Open items (next rounds)
- (after cycle 2 fix round 2) Bar 22 id322 (above); octave passages keep the thumb ~50-60 mm out (the span allowance:
  natural for octaves, still counted by the critic's pointer census, S22/S21/S20c); starfish spread and ring-little
  scissor (free 4 should follow a deeply flexed contact 5: MCP coupling, not only abduction); release ride (pad on the
  rising key until tUp); contact-sample jerk limiter (I-37); S14 LH crossing by radial deviation (keep |radial| <= 15 deg
  in the keyframe, curl and adduct the crossing index); S02 leap pivot; free-finger flesh vs the drape (re-check at
  30-60 Hz); soft-note stroke starts; pedal-foot gap.
- (after critic round 2) Not yet done from the critic round-2 list: final per-joint rate/jerk limiter after the angle
  passes (framed pops S21/S11/S15/S13/S06, R5 octave-top approach flicks); hand world-orientation slerp cap (8 deg/frame)
  before the IK; mid-hold hops / departures before tRel0 for CARRIED contacts (hold_census: S06 id223/id259, S11 id486,
  S14 id547, S18 id761); substitution on one key (S11 Bb2 L3 -> L1 'OK-sign' pinch: lift the outgoing finger ~40 ms
  earlier); thumb MCP at its 9 deg floor in 43-63 % of contact frames (CMC opposition, more proximal contact, IP 15-25
  preference); held long-finger MCP p50 38-43 deg and knuckles 60 mm above the key tops (lower the palm 5-8 mm, contact
  MCP 20-30); free-hand starfish spread (fingertip spread p50 99 mm, target 75-85) and the final LH chord's free 3/4
  fan; body motion (phrase template, 6.2 s autocorrelation; lateral follow of the hands); free-finger micro-motion
  (44 % frozen); landings at speed (arrival.mjs: knuckle < 0.3 m/s at contact for 95 %); escape-depth neighbour metric
  (anal.mjs uses vertical depth); bar 22 F5 by 5 after the chord top; same-finger repeats id424 / id1050; shoe wedge.
- (after fix round 3) Departure before the release: 5 notes in m 100-200 still lose their finger while the key is down
  (id897 D5 R5 24 mm, id647 G2 L3, id547 Bb3 L1, id631 G5 R5, id617 Bb4 R1). Debug of id897 (`sandbox/perf/out/r3dbg.log`):
  the palm starts its transfer to the next keyframe during the hold; R5's IK error rises 1.7 -> 4.6 mm at m 168.16-168.19
  while its abduction swings +20 -> -22 deg in 90 ms. Needs the planner to hold the palm until the key's release (or to
  release the key with the finger where the pedal covers it), not the per-sample nudge (<= 12 mm).
- (after fix round 3) Neighbour-key flesh still 30.6 % of hand-poses > 1 mm (target p99 < 1 mm): worst R1 on G#4 into B4
  6.7 mm (m 161.3), R4 on G5 into F#5 6.3 mm (m 115.6), L4 on D3 into C#3 5.8 mm (m 101). Needs roll / yaw of the finger in
  the per-sample correction and a thumb-base lift in black-key octaves, not only one contact point per note.
- (after fix round 3) Both-contact finger overlaps (m 74.73 R4 on Ab5 while R3 lands on G5, 6-8 mm capsule overlap) need
  contact-point placement with a finger-finger term in `shiftContactsOffNeighbours`.
- (after fix round 3) Shoe: the rigid shoe rotates about the planted heel and meets the pedal at its nose; the tread
  polygon behind it sits under a 2.4-6.6 mm wedge. Options: forefoot flex (`USE_TOE_FLEX`, needs a toe1-1_R output
  channel and a slower ramp), or a heel position that makes the sole parallel to the pressed tread.
- (after fix round 3) Pad > 1 mm above its key when the key starts: 22 struck notes in m 100-200 (id957 D4 R1 5.6 mm,
  id1092 F3 L2 4.7, id1061 G3 L2 4.7): struck landings arrive late; fingers.js struck landing timing.
- (after fix round 2) LH bass-to-chord leaps still read as teleports (critic round 2: LH knuckle frames > 3 m/s 197;
  f2b 221; worst wrist lateral speed ~4.1-4.4 m/s at m 0.19, 6.84, 35.74, 118.86, 212.94). Cause: the departure waits
  for the bass key's bottom (solver.js late-arrival clamp, `a.D >= kbMax - 5 ms`) and the landing is bounded by the
  struck slack, so a 270 mm leap gets ~110 ms. Needs the arm transport to start while the bass finger still holds
  (palm yaw / wrist deviation about the held contact point for 80-120 ms, the delta faded out over the transfer), a
  minimum transfer time T(d) = 0.12 s + 0.35 s/m x d where the score allows, and the orientation change spread over the
  whole transfer.
- (after fix round 2) Remaining R5 climax flicks: e.g. D6 -> F6 by the 5th with a 30 ms gap (m 180.6, out/r2dbg2.log):
  the palm already sits at the F6 position during the D6 hold (MCP 41 -> 65, abd 9 -> -21) and the pinky swings abd
  -25 -> +19 in 30 ms. Needs a planner fix (palm transfer timed into the gap, or a different finger for one of two
  consecutive 5ths); `monotoneApproach` only acts on gaps >= 90 ms.
- (after fix round 2) Free fingers into keys rose with the adducted rest (QC 30 Hz: 0.91 -> 2.4 vertex-hits > 1 mm per
  frame, max 6.8 -> 9.1 mm incl. the post-release lap sweep at m 222.0): LH L3/L4/L5 into black keys at m 100.9-101.6
  and 124.8 (~6 mm). Check the knuckle-rotation lift in `solver.js` (residual when MCP / abduction hit their limits) and
  the joint-space smoothing after it.
- (after fix round 2) Fingertip spread still above the critic's target (index-to-little p50 R 98 / L 99 mm, target
  75-85 mm with no wide chord pending); thumb DP pitch on the key p50 R 17.6 / L 16.4 deg (target 22-30); thumbs that
  cannot reach with MCP >= 9 deg (ids 211, 914, 1079, 320 contact 1.7-4.1 mm).
- (after fix round 2, not started) keys held by nothing during transfers (ghost.mjs: 44 notes, e.g. id223 F5 R3 lifted
  6.2 mm at m 54.33 for ~110 ms; QC has no dense mid-hold check), folded wrist / orientation snaps (m 67.6-68.3,
  73.6-74.25, 100.1-101.4; orientation-rate limit ~400 deg/s), let-go pops within 60 ms of tUp, body phrase template
  (6.2 s autocorrelation), pedal foot sole 4-9 mm above the tread (legs.js measures against a flat plane), half-pedal
  damper lift, brushNeighbourKeys durations (fade after ~0.3 s), nails in the QC set, QC at 60 Hz, chorus-1 fingering
  details (F#5 4 -> G5 4; LH Eb3-Bb3-C4 5-2-1 vs 4-2-1), RH thumb vs LH thumb / index at m 170.80.
- (after fix round 1) Neighbour-key flesh is the main open item: 26 % of hand-poses > 1 mm (target < 1 %), now led by
  the index/middle fingers (R2, R3, L2) beside black keys and the thumbs (L1, R1). Needs the skinned neighbour test
  inside the per-sample contact correction for the long fingers too (roll / lateral shift of the contact point / yaw),
  and a fix of the thumb's radial contact offset where the other hand's thumb plays the next key (m 170.80).
- Fingering: chords spanning 10-11 semitones with the thumb on a black key and 3 or 4 on top (ids 320-322 Ab4-D5-G5
  1-2-3 at m 69.95; ids 760-762 Ab4-C5-G5 1-2-4 at m 147.44) must use the 5th: both are the only notes off their keys.
- Staccato chords before leaps (ids 281, 418/419: 95 ms notes, key released 30 ms after its bottom by reach/travel
  release) are left ~15 ms after key bottom; the QC mid-hold probe reads 6-10 mm there.
- R5 contact PIP sits at its 7 deg floor in 265 poses (raise the f5 floor to ~12 deg).
- Penetration target not met. Remaining classes: (1) contact fingers whose flesh enters the NEIGHBOURING key: white-key
  contacts in the 12.4-13.1 mm tail between black keys (the mesh fingertip is wider than the tail) and the thumb's side
  into the next key, typically 2-6 mm; (2) free fingers during transfers into black keys (up to ~6 mm) and a few
  thumb moments under the key slip; (3) finger-finger contacts thumb vs index (L1/R1 into 2-2) and R3 vs R2 in the
  climax passage (m ~113), up to ~9 mm. Fix direction: contact boxes for white keys between black keys narrowed to the
  tail centre with an abduction/roll term, neighbour-key collision in the per-sample contact correction (now only in
  the keyframe objective), a free-finger clearance pass on the skinned DP vertices (not just the pad sphere).
- Finger pops (> 12 deg per film frame, ~6k frames) and peak finger angular velocities of 3-5k deg/s at the fastest
  transfers: add a per-joint rate limiter / jerk-limited filter after the IK, with contact re-projection.
- Lateral sway toward the register is small (chest ~1 cm): consider a stronger register term for passages with both
  hands at one end.
- Early key releases outside the full pedal (the key and damper come up while the sampler note still sounds): the
  cleanest fix is on the audio side, rendering note-offs from `perf.json notes[].tRel0` (+25 ms to the
  key-release-to-damper point) so key, damper and sound are identical by construction.
- QC renders here use the simple layout.js keyboard; `--piano real` was not re-run this session.
- Integration: layout.js `bench.defaultHeight` is 0.50 m but the GLB is seated on a 0.47 m bench. This is already
  wired: `scene/src/pianist/pianist.js` calls `piano.setBenchHeight(0.47)` and `scene/src/piano/index.js` lowers the
  bench group by the difference. Verify in an integrated render that the seat top meets the pianist.
