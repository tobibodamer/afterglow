# Performance animation spec: pianist anatomy, technique, MIDI to motion

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Scope: everything the procedural performer needs to turn the performance MIDI into bench and body, arm, wrist, hand, finger, key, hammer, damper and pedal motion. Units are metres and seconds in the engine. Tables use mm and ms where that reads better.

Evidence tags used below:
- **[lit]** taken from a cited source.
- **[derived]** computed by me from cited data. The script is named.
- **[proto]** measured by running a prototype in `sandbox/performance/scripts/`.
- **[design]** my engineering choice. Tune it in review; it is not a measured fact.

---

## 0. Decisions for the lead (TL;DR)

1. **One source of truth.** The *performance MIDI* drives both the audio render and the animation. It has separate RH/LH tracks, real velocities, note-offs and CC64. Never edit timing after the audio is rendered.
2. **Note-on means hammer hits string.** The visual keystroke starts `tt(v)` *before* note-on. Use `HV = 2^((v-52)/25)` m/s [lit] and `tt = 89.16·HV^-0.570` ms [lit], which gives 173 ms at v=10, 79 ms at v=60 and 27 ms at v=127. Key-bottom is `kb = 12.1·HV^-0.702 - 7.4` ms relative to note-on [derived fit]. Struck touches start 35 ms later (floor 20 ms) [lit].
3. **Fingering** uses a second-order Viterbi per hand. The state is (previous chord assignment, current assignment, keys still held). Costs are Parncutt et al. (1997) rules 1-12, with their span table, plus polyphony additions. The prototype matches textbook fingerings in 11/13 test passages. The other 2 are accepted variants. It runs in about 0.8 s per 300 notes in pure Python [proto].
4. **Hand model** (male, 190 mm hand). Index PP/MP/DP links are 42.6/23.8/23.1 mm, middle 47.6/27.9/24.8 mm, ring 44.2/27.2/24.7 mm and little 35.4/19.5/23.1 mm. Thumb MC/PP/DP links are 46.1/34.2/32.0 mm [derived]. DIP = 2/3·PIP [lit]. The thumb CMC has two non-orthogonal axes 124° apart and offset 9.2 mm [lit].
5. **Relaxed piano hand on white keys** [proto IK]:
   - MCP flexion 16-27°, PIP 33-50°, DIP 22-33°.
   - Distal phalanx 69-89° below horizontal.
   - Knuckles 44-55 mm above the white key tops.
   - Wrist joint centre about 37 mm above the key tops and about 95 mm in front of the white-key front edge.
   - Knuckle line pitched up about 10° from the wrist; hand yawed inward 9-15°.
6. **Posture** [derived, `posture.py`]:
   - Bench height ≈ key-top height - 0.25 m (0.47 m for a 0.72 m key top).
   - Hip joint 0.48-0.55 m behind the key front; bench front edge about 0.31-0.38 m behind it; sit on the front half.
   - Torso leans forward about 8°.
   - Elbow about 16-18 mm above key-top level. Forearm rises about 4° to the wrist.
   - Upper arm flexed 20-26°. Elbow swivelled 15-25° outward.
7. **Animation is a pure function of time t.** Springs are integrated at a fixed internal rate (960 Hz) and sampled. This lets motion-blur sub-frames at any t give consistent poses.
8. **Automatic QC gates the render.** Thresholds (detail in section 8.9):
   - Fingertip-to-key error ≤ 0.5 mm.
   - Key-bottom vs predicted time within ±1 frame.
   - No joint-limit violation > 2°.
   - Inter-finger penetration ≤ 1 mm.
   - Finger vs black-key side penetration ≤ 0.5 mm.
   - DIP never hyperextended in contact (no "broken knuckle").
   - Rendered-audio onsets vs predicted hammer contacts: median ≤ 5 ms.

---

## 1. Data contract

**Inputs**
- `performance.mid`, which contains:
  - track `RH` and track `LH`;
  - note-on/off with velocity;
  - CC64 (0-127; continuous if the sampler supports half-pedal);
  - optional CC67/66.
- `structure.json` from the composer: phrase boundaries (start/end seconds), section labels, climax time, intended touch per phrase (`legato | detached | accent`), and optional fingering overrides `{note_id: finger}`.
- Piano model geometry, read from the model and never hard-coded:
  - key pivot (balance-rail) line;
  - per-key top-surface polygons;
  - black-key boxes;
  - pedal pivot and tip;
  - hammer and damper pivots.

**Outputs** (deterministic, so the same input gives a bit-identical result)
- Per frame (and evaluable at any t):
  - quaternions for every skeleton joint;
  - root and torso transforms;
  - key angle per key (88 floats);
  - hammer angle and damper height per key;
  - pedal angle.
- `anim_qc.csv`: per-frame metrics from section 8.9, plus a summary.

**Audio onset calibration (must do).** Render one note per velocity 1..127 (C4 and two other registers) through the exact sampler and reverb-off chain. Detect the audible onset and store `δ_audio(v)`, the sample attack offset. Hammer-contact time is then `t_hs = t_noteon + δ_audio(v)`. Everything below is relative to `t_hs`.

---

## 2. Seated posture

Pianist: ANSUR II male subset with hand length 185-195 mm (n = 1714) [derived, `ansur_stats.py` on the ANSUR II CSV].

| ANSUR II quantity (subset mean ± sd, mm) | value |
|---|---|
| stature | 1744 ± 52 |
| hand length / breadth | 190.4 ± 3.1 / 87.7 ± 3.6 |
| sitting height / eye height sitting | 916 / 802 |
| acromion height sitting (derived: standing acromial - (stature - sitting height)) | 602 |
| acromion-radiale (upper arm) / radiale-stylion (forearm) | 332 / 265 |
| elbow rest height (seat to elbow) | 247 ± 27 |
| popliteal height / knee height sitting | 425 / 548 |
| buttock-popliteal / buttock-knee | 497 / 612 |
| biacromial breadth / foot length | 414 / 268 |

**Pedagogy targets** [lit]:
- Elbows about level with the keys, "slightly below the height of the hands" (Chang).
- Czerny: elbows about 1 inch above the key surface (as summarised by pianoeducation.org).
- 90-110° at the elbow (Uniarts Helsinki practice guide; from a search summary, page not opened).
- Sit closer to the front edge of the bench.
- Distance: "the elbows just miss your body as you move them in towards each other" (Chang).

`posture.py` solves these with a 3-D 2-bone arm IK. The wrist sits where the hand IK puts it: 95 mm in front of the key front and 37 mm above the key top.

| white-key top H_k | bench top | hip joint behind key front | torso lean | elbow vs key top | forearm slope (elbow to wrist) | upper-arm flexion |
|---|---|---|---|---|---|---|
| 0.70 m | 0.455 m | 0.475-0.535 m | 8-9° | +17/+18 mm | +4.1/+4.2° | 20-22° |
| 0.72 m | 0.470 m | 0.490-0.540 m | 8° | +16/+18 mm | +3.9/+4.3° | 23-24° |
| 0.74 m | 0.485 m | 0.505-0.550 m | 8° | +16/+17 mm | +4.2/+4.4° | 25-26° |

The range in each row comes from moving the RH wrist from 0.20 to 0.35 m right of the body midline. [derived]

**Real-world check** [lit]: grand key tops measure 26¾ in (679 mm) on one grand in an MMD forum post. Typical grand benches are 18-20 in (457-508 mm). The rule bench ≈ H_k - 0.25 m lands inside that range. Read H_k from the piano model, then apply the rule.

**Posture spec**
- **Pelvis.** Sit bones on the front half of the bench. The bench front edge is about 0.17 m in front of the hip joint, so the thighs are only partly supported. Pelvis upright to slightly anteriorly tilted. [design]
- **Knees.** Knees reach the key-front plane (y ≈ 0 to +0.07 m) and sit under the keybed. Knee top is about 0.55 m above the floor, which clears the keybed underside (about 0.63-0.66 m) [derived + lit].
- **Torso.** Base lean 8° forward about the hips. Expressive range 3-15° (section 6). Thoracic spine neutral, not arched. [design]
- **Shoulders.** Glenohumeral (GH) joint centres are at seat + 0.56 m (about 1.02 m above the floor) and ±0.17 m lateral. Shoulders depressed and relaxed. Scapular protraction takes 10-20% of lateral reach. [design]
- **Elbows.** Elbows about 16 mm above key top. They float 0.10-0.15 m in front of and lateral to the torso. Swivel 15-25° outward, more for far registers. [derived/design]
- **Forearm.** Nearly horizontal, rising about 4° to the wrist. Pronated so the palm is within ±15° of flat. The wrist absorbs about 40% of the forearm's yaw relative to the keys, so the hand points more square to the keys than the forearm does (limits in section 3.4). [design]
- **Feet** [design + lit]:
  - Right ball of foot on the sustain pedal 20-40 mm behind the pedal's front edge.
  - Right heel on the floor 120-160 mm in front of the pedal tip; ankle about 90-100°.
  - Pedal tip is 46-87 mm above the floor. Travel at the tip is about 0.8-1.0 in (20-25 mm) [lit, PTG technician].
  - Full travel is about 8° of foot rotation about the heel (22 mm on a 150 mm lever).
  - Left foot flat, slightly back and left, near but not on the una corda.
- **Head.** Neck flexed so the head is pitched 20-35° down. Gaze goes to the active hand. Eyes are about 0.55 m above the keys and about 0.40-0.45 m behind them, so line-of-sight depression is about 50°, with the eyes rotated about 15-25° down in the head. The bowed head also keeps the face out of the backlight. [derived/design]

---

## 3. Hand anatomy

### 3.1 Segment lengths

**Source bone lengths** [lit]: Buryanov & Kotiuk 2010, X-ray, 66 adults, Table I, mm.

| digit | soft tip | distal | middle | proximal | metacarpal |
|---|---|---|---|---|---|
| I (thumb) | 5.67 | 21.67 | — | 31.57 | 46.22 |
| II | 3.84 | 15.82 | 22.38 | 39.78 | 68.12 |
| III | 3.95 | 17.40 | 26.33 | 44.63 | 64.60 |
| IV | 3.95 | 17.30 | 25.65 | 41.37 | 58.00 |
| V | 3.73 | 15.96 | 18.11 | 32.74 | 53.69 |

Bone ratios distal:middle:proximal:metacarpal are I 1:-:1.5:2.1, II 1:1.4:2.5:4.3, III 1:1.5:2.6:3.7, IV 1:1.5:2.4:3.4, V 1:1.1:2.1:3.4. The data do not follow Fibonacci (Park et al. 2003 via Buryanov).

**Kinematic links** [derived, `hand_pose.py`]:
- Joint centres sit inside the proximal bone's head. Offsets: MCP 6 mm, PIP 4 mm, DIP 3 mm.
- link_PP = PP + 2 mm, link_MP = MP + 1 mm, link_DP = DP + soft tip + 3 mm.
- All scaled by 1.02 to a 190 mm male hand. Cross-checks:
  - the middle-finger tip-to-MCP distance implied by Greiner's male data (crotch-to-tip 83.8 mm + web height 12.8 mm = 96.6 mm) against Buryanov's 92.3 mm bone sum;
  - ANSUR II mean hand length 193.3 mm.

| link (mm) | PP | MP | DP (to pad apex) | MCP-to-tip sum | ratio to 190 mm hand length (PP/MP/DP) |
|---|---|---|---|---|---|
| index | 42.6 | 23.8 | 23.1 | 89.6 | 0.224 / 0.125 / 0.122 |
| middle | 47.6 | 27.9 | 24.8 | 100.3 | 0.251 / 0.147 / 0.131 |
| ring | 44.2 | 27.2 | 24.7 | 96.2 | 0.233 / 0.143 / 0.130 |
| little | 35.4 | 19.5 | 23.1 | 78.1 | 0.186 / 0.103 / 0.122 |
| thumb | MC 46.1 | PP 34.2 | DP 32.0 (IP centre to tip) | | 0.243 / 0.180 / 0.168 |

Scale every link linearly with the hand length.

**Do not use Greiner's 1991 "link lengths" as joint-centre lengths.** They are crease-based and give index PP 60.8 mm and thumb PP 21.1 mm, which are inconsistent with X-ray bones.

### 3.2 Joint positions in the palm (RH, palm down)

Hand frame: origin at the wrist joint centre, +y distal, +x ulnar (towards the treble for the RH), +z dorsal. Mirror x for the LH.

**MCP arc** [derived]. MCP level from the wrist crease = (Greiner male tip-to-wrist-crease - digit length) - Buryanov web-height fraction × digit length. That gives II 98.2, III 97.9, IV 91.2 and V 79.2 mm. The wrist joint centre is taken as about 12 mm distal to the crease [design].

| MCP centre (mm) | x | y | z |
|---|---|---|---|
| index | -30 | 86 | 0 |
| middle | -9 | 86 | +2 |
| ring | +11 | 79 | -1 |
| little | +29 | 67 | -6 |

- Lateral spacing (≈20 mm) is chosen to reproduce the ANSUR II hand breadth of 88 mm. [design]
- z encodes the transverse metacarpal arch. Add CMC4/CMC5 flexion DOFs of 0-10° and 0-15° to cup the palm. [design]

**Thumb base** [lit]. The trapezium (thumb CMC base) is oriented 48° flexion, 38° abduction and 80-81° pronation relative to the 3rd metacarpal / coronal plane of the hand (Cooney 1981, 10 cadavers). Place the CMC centre at about (-24, 20, -12) mm [design] and build its base frame from those three angles.

### 3.3 Finger widths, pads and nails

**Greiner 1991 male means (n = 1003), mm** [lit]. Depth is derived from circumference with an ellipse fit [derived].

| | PIP breadth | PIP depth | DIP breadth | DIP depth |
|---|---|---|---|---|
| index | 23.0 | 20.5 | 20.1 | 16.3 |
| middle | 22.5 | 21.8 | 19.8 | 16.9 |
| ring | 21.4 | 19.9 | 18.5 | 15.7 |
| little | 19.2 | 17.6 | 17.4 | 13.8 |
| thumb IP | 24.0 | 22.0 | | |

- Collision capsule radius = ½·breadth - 0.5 mm (allows skin compliance). [design]
- **Pads** [lit + design]:
  - Pulp extends 3.7-5.7 mm beyond the bone apex (Buryanov "tip").
  - Model the pad as an ellipsoid of about 9 mm radius under the distal half of the DP.
  - The contact point is the pad apex, about 4-6 mm palmar of the DP axis and about 3 mm proximal of the tip.
- **Nails** [lit]:
  - Male nail width: thumb 13.6 mm, index 10.6 mm, middle 11.4 mm (n=18; PMC5702813 table 1).
  - Nail length across populations 9.8-20.3 mm (nail atlas).
  - Spec: nail plate covers the distal 50-55% of the DP dorsum. Free edge 0-1 mm (pianists' nails never touch the keys). Ring 10.8 mm and little 9.0 mm wide [design].

### 3.4 Joint axes, ranges and coupling

| joint | DOF / axis | clinical active ROM [lit] | functional ROM [lit, Bain 2015] | rig hard limit [design] | piano working band [proto/design] |
|---|---|---|---|---|---|
| MCP 2-5 | flex/ext about a transverse axis through the MC head; ab/ad about a dorsal axis | flex 85-90° | 19-71° | -15…90° | 10-35° in contact, ≤55° lifted |
| MCP ab/ad | | ~±20° | | soft ±20 (II), ±15 (III, IV), ±25 (V) | \|abd\| ≤10° normally, 20-30° in spreads |
| PIP | flex | 100-115° | 23-87° | 0…105° (no hyperextension) | 30-55° white keys, 20-35° flat finger on black keys |
| DIP | flex | 80-90° | 10-64° | 0…80°; ≥5° whenever in contact | 0.5-0.85 × PIP |
| thumb CMC (TMC) | FE + AA, two axes | total arcs 53° FE, 42° AA, 17° axial rotation (Cooney active) | | FE -20…+35°, AA -15…+30° about the Cooney base | see 3.6 |
| thumb MCP | FE + small AA | flex 50-55° | | -10…55°, AA ±8° | 10-25° |
| thumb IP | FE | 85-90° | | -15…80° | 10-25° ("slightly bent" [lit, Yamaha]) |
| wrist | FE + radioulnar deviation | functional 60° ext / 54° flex / 40° ulnar / 17° radial [lit, Ryu via Mayo] | | same | ext 0-25°, flex 0-15°, ulnar 0-25°, radial 0-10° |
| forearm | pronation/supination, distributed over 3 twist bones (0.33 / 0.66 / 1.0) | | | | palm roll within ±15° of flat |

- **DIP-PIP coupling.** θ_DIP = 2/3·θ_PIP (Rijpkema & Girard 1991: `q4 = 2/3*q3`) [lit]. Implement it as a soft coupling with ratio 0.5-0.85. Lower ratios (flatter fingertip) apply in pressed cantabile on black keys. Never below 5° of DIP flexion during contact. [design]
- **MCP axial roll.** Couple 5-10° of axial roll to abduction for index and little (fingers pronate/supinate slightly as they spread). [design]
- **Thumb CMC axes** [lit]:
  - FE axis in the trapezium, AA axis in the MC1 base. The axes are fixed, not perpendicular to each other or to the bones, and do not intersect (Hollister 1992).
  - In vivo the two axes are 124° (SD 19°) apart and offset 9.2 mm (SD 2.5 mm) (Halilaj et al. 2014).
  - MCP FE and AA axes are also non-intersecting; MCP FE is distal to AA in 65% of models (Santos & Valero-Cuevas 2006).
  - Implementation: CMC_FE (axis tilted 34° off orthogonal towards the AA axis), then a 9.2 mm offset, then CMC_AA, then MC1, then MCP_AA, then MCP_FE, then PP, then IP_FE, then DP.
  - Add axial pronation coupled to the CMC angles: ≈0.25·FE + 0.15·AA, so total ≤17° [design, bounded by Cooney's 17°].

### 3.5 Relaxed "piano hand" (measured on the IK prototype)

`hand_pose.py` optimises the palm pose (wrist position, yaw, pitch, roll). Preferences:
- MCP 25° and PIP 45° preferred;
- distal phalanx 75° below horizontal;
- knuckle pitch 10°, held with a strong weight;
- the abduction limits above.

It then solves each finger exactly with the planar IK of section 8.3. **[proto] results, RH:**

| case | wrist centre (vs C4 front-left corner) | yaw / pitch / roll | MCP | PIP | DIP | DP below horizontal | MCP height |
|---|---|---|---|---|---|---|---|
| 2-5 on D4 E4 F4 G4, contact 32-45 mm behind the key front | x=103, y=-95, z=37 mm | 15° / 11° / -2° | 16-27° | 33-50° | 22-33° | 69-89° | 44-55 mm |
| as above, 3 on D#4 (black; contact 20 mm behind the black front, 12.5 mm higher) | z=42 mm | 9° / 10° / 0° | 3: 19° | 3: 31° | 3: 20° | 3: 60° (flatter) | 48-59 mm |
| spread E4 G4 A4 C5 (2-3-4-5) | x=159, z=29 mm | 22° / 10° / -18° | 8-32° | 25-54° | 17-36° | index flattens to 49° | 35-45 mm |

All fingertip errors were 0.00 mm. The index and little fingers hit their abduction limits (21°, 26°) in the spread, and the solver resolved it by yawing and rolling the palm, which is the realistic response.

These match the reference stills (refs 7, 8, 12): arched fingers, near-vertical distal phalanges, knuckles the highest point, the wrist slightly lower and hidden by the cuff.

**Non-playing ("resting") fingers.** Use a relaxed curl: MCP 15-30°, PIP 30-50°, DIP = 2/3 PIP. Hover 2-8 mm above their key, or rest on the key surface without depressing it. Never straight (PIP < 10°) unless spreading.

### 3.6 Thumb at the keys

**Contact point.** The radial-distal corner "where the nail meets the flesh", not the very tip. The thumb is slightly bent at the IP joint, never straight (Pierce, Yamaha pedagogy) [lit]. [design] Therefore:
- The contact point is the radial pad corner (DP-local offset: 4-5 mm radial, 4 mm palmar, 4 mm from the tip).
- The DP is rolled 45-70° from palm-down (side-down) and pitched 20-35° below horizontal along the key.
- The thumb plays white keys 10-30 mm behind the front edge, nearer the front than the long fingers. Black keys 10-20 mm behind the black-key front.

---

## 4. Playing mechanics

### 4.1 Contact positions [design unless noted]

- **White keys, long fingers.** 25-50 mm behind the white front edge. Keep ≥ (pad half-width + 1 mm) from black-key sides. Between two black keys (D, G, A) the back part is about 13.7 mm wide [lit: equal 13.7 mm black-key spacing, Wikipedia], so play in front of the black keys (y ≤ 50 - 9 = 41 mm). E, B, C and F have more room at the back on one side. **Compute the allowed contact region per key from the mesh** (key top polygon minus black-key boxes, dilated by the pad radius).
- **Black keys.** 10-25 mm behind the black-key front, centred laterally. Black-key passages move the whole hand 10-30 mm deeper (+y) [design; proto: the wrist moved +5 mm for a single black note, so all-black positions should move more].
- **Key lever.** Dip is 10 mm at the white key front [lit: MMD technician "10 mm on dip, 42 mm hammer blow"; aftertouch about 1 mm, PianoWorld]. The key rotates about the balance rail. The contact point's vertical travel is `dip(y) = θ(t)·(L_b - y)`, with θ_max = 10 mm / L_b (≈2.5° for L_b = 0.23 m [design default; read L_b from the model]). **The fingertip must follow the contact point's trajectory, not a fixed 10 mm.**

### 4.2 Finger shape by context [design, grounded in 3.5 and the refs]

| context | MCP | PIP | DP angle | notes |
|---|---|---|---|---|
| default white-key five-finger position | 15-30° | 35-50° | 70-90° | pad contact |
| cantabile melody (pressed touch, "singing") | 10-20° | 20-35° | 50-70° | flatter pad, larger contact area |
| black keys | 15-25° | 25-40° | 55-70° | finger extended deeper |
| fast passagework | 20-35° | 45-60° | 80-95° | more curved, closer to the keys |
| ff chords | 10-25° | 30-45° | 70-85° | firm; DIP ≥ 10° (never collapsed) |
| spread / large chords | 5-25° | 20-35° | 45-70° | index and little flatten and spread |

### 4.3 Wrist and forearm

- **Lateral motion.** The hand travels with the active notes. The palm pose is re-solved at each new contact set (8.2). [design]
- **Deviation.** Pianists show more ulnar deviation than other instrumentalists (Sugawara, *Work*) [lit]. Rule: hand yaw relative to the keys = forearm yaw × 0.6. The remaining 40% is wrist deviation, clamped to ulnar 25° / radial 10°. [design]
- **Rotation.** Thumb-side notes are helped by forearm pronation of 5-15°, little-finger notes by supination of 5-10°. Use rotation for tremolos and broken octaves (±10-20° oscillation at the note rate). Fold a target roll into the palm optimiser as roll_pref = 0.15·(lateral offset of the active fingertip from the palm centre in mm) degrees, clamped ±15°. [design]
- **Vertical.** The wrist rises 15-30 mm at phrase ends ("lift-off"), drops 10-40 mm into chords, and stays level in legato lines. [design; Zhu 2012 mocap shows wrist apex between chords]

### 4.4 Anticipation and pre-positioning

- Pianists change their trajectories **up to 500 ms before a leap or thumb-under** (Engel et al. 1997, via Goebl 2017) [lit].
- Five professional pianists judged anticipatory motion the main remaining gap of a state-of-the-art synthesiser (Tipiano 2026) [lit].
- At about 8 tones/s and faster, movement initiation overlaps the previous keystroke (Goebl & Palmer 2009) [lit].
- Non-playing fingers are pre-positioned for up to 4 upcoming chords (Zhu et al. 2012) [lit].
- Spec [design]:
  - The hand starts moving to the next hand position at `t_move = clamp(t_first_new - (0.12 + 0.0018·d_mm), t_release_of_last_held_old, t_first_new - 0.15)`, where d_mm is the palm displacement.
  - Free fingers start shaping towards their next key as soon as they release.

### 4.5 Thumb-under and finger-over (scales, arpeggios)

- **Thumb-under (RH ascending, LH descending).** The thumb begins tucking **immediately after its note** (Yamaha pedagogy; a late thumb causes a "bump") [lit]. It travels under fingers 2-3 by CMC flexion/adduction plus MCP flexion, 2-12 mm above the white key surface. It arrives above its key one stroke-duration before its contact. The palm translates continuously at the scale's mean speed and does **not** jump. [design]
- **Finger-over (RH descending, LH ascending).** The crossing finger (3 or 4) lifts 15-25 mm, arcs over the thumb and lands. The forearm supinates 5-10° during the cross. [design]
- **Arpeggios.** Pivots over a 4th-5th are not finger-legato. Parncutt's MinPrac deliberately forbids them [lit]. The arm carries the hand laterally and the wrist rides about 5-10 mm higher. [design]

### 4.6 Leaps and chords

- **Leaps.** Planar min-jerk arc. Apex height = 15 mm + 0.12·d [design]. Zhu's mocap shows the wrist reaching its maximum height midway between chords, scaled by volume and distance [lit]. The hand pre-forms the target chord shape in flight and completes it ≥ 60 ms before contact.
- **Chords** are played by whole-hand/arm drop. Wrist and forearm descend 10-40 mm from 120-200 ms before contact. Experts use proximal joints and gravity ("arm weight") for loud chords (Furuya et al., via Goebl 2017) [lit]. For f-ff add elbow/shoulder preparation: elbow rises 10-30 mm, then drops.
- **Wrist compensation** after the strike: soft notes get a small up-down; loud notes get down-up-down (Zhu 2012) [lit]. Implement as a critically damped impulse of 1-4 mm scaled by velocity. [design]

### 4.7 Release and legato

- **Release** [design]. At note-off the fingertip **rides the key up** (key return 30-60 ms, design), then lifts:
  - legato: 2-8 mm;
  - detached / phrase end: 8-15 mm;
  - staccato and with fast tempo: up to 25 mm.
- **Lift heights in data** [lit]. Goebl & Palmer measured fingertip maxima of about 20-50 mm above the keys in fast melodies (7-14 tones/s). Fingers lift higher at faster tempi (Dalla Bella & Palmer 2011). Fingertip speed at key contact was 0.2-0.8 m/s.
- **Legato overlap.** Legato is produced by key overlap; staccato by a gap of about 60% of the inter-onset interval (IOI) (Bresin & Battel 2000) [lit]. Overlaps live in the MIDI. Animate exactly what the note-offs say. If articulation needs changing, edit the MIDI *before* the audio render.

### 4.8 Touch type and velocity to motion

Touch type depends on velocity and phrase intent. [design + lit]
- **Pressed touch.** The finger rests on the key, then accelerates it.
  - Default for legato/cantabile with v ≤ 95.
  - Pressed touch cannot exceed about 4 m/s hammer velocity [lit, Goebl 2005]. Its minimum is 0.18 m/s.
- **Struck touch.** The finger arrives with speed.
  - Use for v > 95, accents, `detached` phrases and chord attacks after a lift.
  - Contact speed v_fk = 0.15 + 0.6·n m/s, with n = clamp((v-20)/100, 0, 1).
- Preparatory lift (fingertip apex above the key surface), with n as above:
  - pressed: 2 + 6·n mm;
  - struck: 8 + 27·n mm;
  - chords add wrist drop (4.6).
- Apex time `t_fk - Δ`, with Δ = clamp(0.4·IOI_prev, 50 ms, 150 ms). The apex may overlap the previous keystroke at fast tempi [lit, Goebl & Palmer].
- **Sympathetic finger motion.** Neighbours of a striking finger flex by k × (striking finger's flexion change). The ring finger is least independent and the thumb most (Häger-Ross & Schieber 2000) [lit]. Use k = 0.3 for the ring finger when 3 or 5 strike, and 0.1-0.15 otherwise [design]. Zhu's dependence index models the same effect [lit].

---

## 5. Piano action timing (sync)

### 5.1 Measured facts

- Travel time (finger-key contact to hammer-string) ranges from about 20 ms to about 200 ms, up to 230 ms on a Steinway. It is independent of pitch (Goebl et al. 2005).
- The power fit `tt = 89.16·HV^-0.570` ms (Goebl 2001) is "very similar" to their Bösendorfer pressed-touch fit.
- Struck tones need 30-40 ms less than pressed tones at equal hammer velocity.
- At typical mezzo dynamics (MIDI 40-60, HV 0.7-1.25 m/s) travel times are 80-108 ms.
- Key-bottom relative to hammer-string runs from +35 ms (very soft; up to +39 ms on the Bösendorfer) to -4 ms (very strong). The crossing is at 1.4 m/s (Bösendorfer), 2 m/s (Yamaha) and 3 m/s (Steinway), all pressed.
- Hammer free flight is about 0-20 ms. Steinway pressed: `ff = 1.63·HV^-1.403` ms.
- Hammer velocity range is 0.18-6.8 m/s; 0.2-8 m/s per Goebl 2017.
- MIDI velocity to final hammer velocity uses the Bösendorfer SE log map `MIDIvel = 52 + 25·log2(FHV)` (Goebl & Bresin 2003, fn. 11).
- Struck touch has a finger-key noise 20-30 ms before the tone (Goebl et al. 2004).
- Hammer velocity ≈ 5 × key velocity. Peak key velocity is 0.3-0.5 m/s at mf and rarely above 1 m/s at f (Askenfelt & Jansson).
- In a forte staccato C4 the damper leaves the string about 15 ms before impact, hammer-string contact lasts about 2 ms, and the damper falls about 80 ms after contact. Let-off is 1-3 mm and blow distance 45-47 mm (KTH lectures).
- Key dampers lift when the key is about halfway down (technician guidance, MMD).

### 5.2 Formulas the animator uses

All times are relative to the hammer-string contact `t_hs = t_noteon + δ_audio(v)`.

```
HV(v)       = 2^((v - 52)/25)                       # m/s (Bösendorfer SE log map)
tt_press(v) = 89.16 * HV^-0.570                      # ms, finger-key contact -> hammer-string
tt_struck   = max(20, tt_press - 35)                 # ms
kb_rel(v)   = 12.106 * HV^-0.702 - 7.444             # ms, key-bottom relative to t_hs
              # (3-anchor power fit through (0.2 m/s, +30), (2.0, 0), (6.0, -4) ms; approximate)
t_fk  = t_hs - tt            # fingertip meets key, key starts moving
t_kb  = t_hs + kb_rel        # key reaches bottom (finger stops)
key travel profile (fraction of full dip D at the contact point), tau = (t - t_fk)/(t_kb - t_fk):
  pressed: d = D * tau^2                    # gradual acceleration, peak speed 2D/T
  struck : d = D * (1 - (1 - tau)^1.6)      # sudden start, decelerating
after bottom: hold at D (+ about 1 mm aftertouch compression, invisible)
release: key starts rising at t_off - 25 ms, critically damped return, half-life 20 ms
         (key passes half travel ~ at t_off, which is when dampers re-contact acoustically)
```

### 5.3 Computed table

Computed with `timing_table.py`; the frame column is at 60 fps.

| vel | HV m/s | tt pressed ms | tt struck ms | kb_rel ms | key stroke (pressed) ms | frames |
|---|---|---|---|---|---|---|
| 20 | 0.41 | 147.8 | 112.8 | +15.1 | 163 | 9.8 |
| 40 | 0.72 | 107.8 | 72.8 | +7.8 | 116 | 6.9 |
| 60 | 1.25 | 78.6 | 43.6 | +2.9 | 82 | 4.9 |
| 80 | 2.17 | 57.3 | 22.3 | -0.4 | 57 | 3.4 |
| 100 | 3.78 | 41.8 | 20.0 | -2.7 | 39 | 2.3 |
| 127 | 8.00 | 27.3 | 20.0 | -4.6 | 23 | 1.4 |

**Sanity check** [proto]. With constant acceleration the pressed stroke gives peak key speed 0.25 m/s at v=60, a hammer-to-key velocity ratio of 5.1. That matches Askenfelt's "≈5×" and "0.3-0.5 m/s at mf". The table reproduces Goebl's "80-108 ms at MIDI 40-60".

### 5.4 Hammer and damper (interior close-ups)

[lit timings, design curves]
- **Hammer** angle = 5 × key travel ratio until escapement at `t_hs - ff(HV)`. Then free flight (gravity) to the string at `t_hs`, 2 ms contact, rebound, backcheck catch 15-25 mm below the string while the key is held, and return with the key.
- **Damper (key-driven)** lifts from key half-travel to the bottom, about 3-5 mm. It falls when the key passes half-travel on the way up.
- **With the pedal**, all dampers lift together, about 3-5 mm [design; MMD: height limit "as little as 1/8 in" if uniform].

### 5.5 Sustain pedal

- Stroke regions: rest (free play), then half-pedal, then damper-free. The boundaries are instrument-specific and found by test (Yamaha patent US8933316) [lit].
- Spec [design]: 0-25% travel is free play, 25-60% half-pedal, >60% dampers fully off. Map CC64 linearly to travel if the sampler is continuous.
- For a binary sampler with a threshold at 64:
  - Press: animate 0 to 100% travel in 70 ms, timed so travel crosses 35% exactly at the CC64-on time.
  - Release: 100% to 0 in 60 ms, crossing 35% at CC64-off.
  - The foot never leaves the pedal.
- **Legato ("syncopated") pedalling** lifts the pedal at or just after the new harmony's onset and re-depresses it after it [lit, Wikipedia]. The re-press delay is pianist-specific (Repp 1996) [lit]. It is encoded in CC64 by the composer, typically 50-150 ms [design].

### 5.6 Tolerances

- Broadcast A/V sync thresholds are detectable at +45 ms (audio early) / -125 ms (audio late) and acceptable at +90/-185 ms (ITU-R BT.1359). ATSC proposed ≤ 15 ms audio-lead and ≤ 45 ms lag [lit].
- Musical impacts in close-up deserve tighter limits. Spec: key-bottom frame within ±1 frame (±16.7 ms) of predicted, and rendered-audio onsets vs t_hs: median ≤ 5 ms, max ≤ 10 ms.
- A chord with a louder melody note has its hammers arrive at different times. This is the 20-30 ms "melody lead" velocity artefact (Goebl 2001) [lit]. **Compute every note's t_fk separately.** Fingers of a chord then start nearly together, as real pianists' do at the finger-key level.

---

## 6. Expressive body motion

### 6.1 What the literature supports [lit]

- **Breathing.**
  - 15 pianists, capnography (Sakaguchi & Aiba 2016).
  - Breath interval shortens with faster tempo; it can be *longer* than at rest in slow pieces.
  - Pianists tend to exhale just after onsets, inhale at rests and hold off inhaling during slurs.
  - Strong individual differences.
- **Head.**
  - Head quantity of motion carries expression and structure.
  - Head motion is synchronised with the periodicity of the rhythm, even in deadpan/immobile playing.
  - Larger amplitudes in ascending and crescendo passages; recurrent movements in wide arpeggios and chordal textures.
  - Weight shifts to the extreme right for passages up there (Massie-Laberge et al. 2019).
  - In a Scriabin étude head sway tracked emotional intensity rather than the 2-bar phrase (Camurri 2003, via Massie-Laberge).
- **Structure.** Expressive-intent differences show up as movement magnitude at structurally significant points (Thompson & Luck 2012).
- **Arm.** Louder playing reorganises the arm: experts use shoulder deceleration, elbow rotation and "arm weight" (Furuya & Kinoshita 2008, via Goebl 2017).
- **Gap.** I found **no published amplitude/frequency table for seated pianist sway**. All amplitudes below are [design] and must be tuned by eye against the references.

### 6.2 Procedural model [design]

Inputs derived from the MIDI plus `structure.json`:
- phrase list with arc position φ ∈ [0, 1];
- dynamic envelope `D(t)`: velocity of onsets, smoothed with a 1.5 s Gaussian and normalised 0-1 over the piece;
- climax distance;
- register centroid `X_h(t)` per hand, weighted by note density;
- beat grid.

| channel | drive | amplitude | smoothing |
|---|---|---|---|
| breath | Inhale starts 400-700 ms before each phrase onset or rest, lasting 0.8-1.5 s; exhale through the phrase. Extra breath at the weakest bar line if a phrase is > 7 s. Interval clamped 3-9 s. | sternum +4-8 mm forward/up; shoulders +2-4 mm; slight head lift 0.5° | shaped by a cosine |
| torso pitch (about the hips) | 8° base + 3°·(2D-1) + 1.5°·sin(πφ) (lean into the phrase peak, ease back at the cadence) | 3-15° total | critically damped spring, half-life 0.8 s |
| torso lateral shift | 0.20 × mean(X_RH, X_LH) relative to the body midline | ≤ ±60 mm at the shoulders | half-life 0.9 s |
| torso yaw | towards the register: 0.25 × atan(lateral centroid / 0.45 m) | ≤ ±8° | half-life 0.9 s |
| head pitch | gaze to the melody hand. Look-ahead 300 ms to the leap target, so the head precedes the hand. Nods of 1.5-4° × D at phrase starts and downbeats after rests. | 20-40° down | half-life 0.3 s |
| head beat motion | phase-locked to the accompaniment beat (Massie-Laberge) | 0.5-1.5° pitch | |
| head roll/tilt | slow, correlated with the phrase arc and intensity | ±2-5° | half-life 1.2 s |
| shoulders | relaxed. Elevate only with breath and ff-chord preparation, ≤ 10 mm over 150 ms. Scapula carries 10-20% of arm reach. | | half-life 0.25 s |
| micro-noise on every channel | sum of 3 gradient-noise octaves at 0.071, 0.173 and 0.389 Hz (incommensurate, so never periodic). Amplitudes 1 : 0.45 : 0.2. Seeded per channel. | torso 0.5°, head 0.8°, shoulders 1 mm | |

**Caps** (never overacted): torso angular speed ≤ 15°/s except into ff chords; head ≤ 30°/s. The same MIDI must always give the same motion. Nothing loops because every channel is driven by musical structure plus aperiodic noise.

---

## 7. Fingering

### 7.1 Survey

| method | idea | polyphony | notes |
|---|---|---|---|
| Parncutt, Sloboda, Clarke, Raekallio & Desain 1997 | Enumerate fingerings within MinPrac/MaxPrac spans; 12 additive ergonomic rules; span table for all finger pairs | melodic fragments only | The cost backbone used here. Pianists' fingerings were mostly among the model's least-difficult, but it also predicted unused ones. |
| Hart, Bosch & Tsai 2000 (UMAP J. 21:167) | Shortest path / DP over a trellis with an interval cost table | monophonic | Bibliographic only; not retrieved |
| Jacobs 2001 (Music Perception 18) | Refinements to Parncutt, incl. physical distances | monophonic | Not retrieved. Parncutt itself suggests mm distances (13.7 mm per semitone). |
| Al Kasimi, Nichols & Raphael 2007 | Viterbi over a trellis, one layer per note start/end; "vertical" (within chord) + "horizontal" (transition) pair costs; user-tunable cost curves; no crossings within a chord | yes | Simple and effective; no black/white modelling |
| Zhu, Ramakrishnan, Hamann & Neff 2012 | Trellis + Dijkstra on chord fingering; node cost = finger-pair distance; edge cost = finger reuse + crossover + movement; non-instructed fingers pre-positioned up to 4 chords ahead; then wrist SQP | yes | Full animation system; no collision handling between fingers or with black-key sides |
| Nakamura, Saito & Yoshii 2020 | HMMs (1st-3rd order) trained on the PIG dataset (150 pieces, multiple annotators) | yes | 3rd-order HMM general match 64.5% vs human-human 71.4%. Two pianists agree on 60-80% of notes. Substitutions are 0.34% of notes. |
| pianoplayer (Musy) | Search 5-9 notes ahead minimising finger speed; hand-size presets | yes | MIT license; hands independent; excludes some crossings |
| FürElise 2024 / Tipiano 2026 | Data-driven hand motion (10 h, 15 pianists); fingertips nearly determined by geometry and fingering, wrist free | | Validation/inspiration only. Check licences before any use. |

**Takeaway.** Even the best statistical model is about 7 points below human agreement. Our goal is a *plausible, consistent, physically comfortable* fingering. Add manual overrides for the hero close-up passages.

### 7.2 Chosen method: second-order Viterbi with held-key state (per hand)

Prototype: `sandbox/performance/scripts/fingering_dp.py`.

- **Events.** Onsets within 30 ms form one event.
- **LH.** Mirror the pitch as `p' = 124 - p`, a reflection about D4 that keeps the black/white layout, then use the RH tables.
- **Candidates.** All order-preserving assignments of the new notes to fingers, avoiding fingers still holding keys. Finger order must agree with pitch order, including held keys: no crossing inside a chord (Kasimi). At most C(5,k) per event.
- **State.** `(assignment of previous event, assignment of this event, set of (finger, key, offset) still held)`. Including held keys keeps the DP Markov and exact. Second order lets Parncutt's 3-note rules apply. Backtrack with stored back-pointers.
- **Legato.** A transition is legato if the previous note's offset ≥ next onset - 30 ms.

**Span table** (semitones, RH, finger a < b, rising interval positive). Parncutt et al. 1997 Table 1; reverse pairs: negate and swap Min/Max.

| pair | MinPrac | MinComf | MinRel | MaxRel | MaxComf | MaxPrac |
|---|---|---|---|---|---|---|
| 1-2 | -5 | -3 | 1 | 5 | 8 | 10 |
| 1-3 | -4 | -2 | 3 | 7 | 10 | 12 |
| 1-4 | -3 | -1 | 5 | 9 | 12 | 14 |
| 1-5 | -1 | 1 | 7 | 10 | 13 | 15 |
| 2-3 | 1 | 1 | 1 | 2 | 3 | 5 |
| 2-4 | 1 | 1 | 3 | 4 | 5 | 7 |
| 2-5 | 2 | 2 | 5 | 6 | 8 | 10 |
| 3-4 | 1 | 1 | 1 | 2 | 2 | 4 |
| 3-5 | 1 | 1 | 3 | 4 | 5 | 7 |
| 4-5 | 1 | 1 | 1 | 2 | 3 | 5 |

In mm, multiply by 13.7 mm per semitone (165 mm octave / 12). Parncutt suggests multiplying all values by about 0.9 for smaller hands; our 190 mm hand uses 1.0.

**Rules, points per occurrence** [lit unless marked]:
1. Stretch: 2 per semitone beyond MaxComf / below MinComf.
2. Small-span: 1 per semitone below MinRel (thumb pairs), 2 otherwise.
3. Large-span: 1 per semitone above MaxRel (thumb pairs), 2 otherwise.
4. Position-change count (triples 1→3 outside comfortable span): 2 for a full change (thumb pivot between them and beyond Prac), 1 otherwise.
5. Position-change size: semitones beyond MaxComf / MinComf for the 1→3 pair.
6. Weak finger: 1 per use of 4 or 5 (monophonic only [design]).
7. 3-4-5 consecutive in any order: 1.
8. 3 followed by 4: 1.
9. 3 on white and 4 on black, consecutive either way: 1.
10. Thumb on black: base **2** ([design]; Parncutt uses 1, and 2 reproduces F-major RH 4-on-B♭). +2 if the previous note is white, +2 if the next is white.
11. 5 on black: +2 if the previous note is white, +2 if the next is white.
12. Thumb pass: 1 if both keys are on the same level; 3 if the lower note is white (non-thumb) and the upper black (thumb).

**Polyphony and real-music additions** [design, `W` dict in the prototype]:

| term | value |
|---|---|
| same finger to a new key, legato (monophonic) | 20 (effectively forbidden; Parncutt forbids it) |
| same finger to a new key, detached | 3 (+3 if IOI < 0.25 s) + 0.1/semitone |
| repeated key, same finger | 0 if IOI ≥ 0.18 s, else 2 |
| repeated key, finger change | 0.5 (+0.5 if non-adjacent fingers) |
| thumb pair beyond Prac by ≤ 3 semitones (arm-assisted, e.g. arpeggio pivots) | rules 1-3 + 3/semitone |
| two long fingers crossing (2-5 pairs against pitch direction, ≤ 12 semitones) | 20 |
| leap (beyond the reach above) | 3 + 0.4 × hand-frame shift in semitones (+12 inside a legato line with IOI < 0.4 s and \|interval\| ≤ 12) |
| next-note-next-finger tie-breaker | 0.3 × \|diatonic steps - finger distance\| |
| chord vertical cost | rules 1-3 over adjacent sounding pairs, held keys included |
| chord outer-finger prior (span ≥ 7 semitones) | 1 per finger short of using 1 and 5 outside |
| chord/mixed transition | 0.35 per semitone of virtual-hand-position shift (mean of key - 2·(finger-1)) |
| same finger to a new key under legato in a chord context | 1 for block chords (≥ 3 notes), 8 for 1-2-note textures |
| voice-leading term | 0.5 × rules 1-3 between each new note and the nearest *released* previous note |

**Chord templates the costs reproduce** [proto]:
- RH root / 1st / 2nd inversion triads: 1-3-5, 1-2-5, 1-3-5.
- LH: 5-3-1, 5-3-1, 5-2-1.
- Octaves: 1-5. Add 1-4 on black-key octaves via a manual override if desired.

**Validation** [proto, run]. 11/13 exact matches against textbook fingerings:
- RH C, G, D (2 octaves up/down), F (4 on B♭), B; LH A, B; RH C-major arpeggio 1-2-3-1-2-3-5; LH Alberti 5-1-3-1; RH and LH triad inversions.
- The two differences are accepted alternatives: LH C-major run starting 4-3-2-1 instead of 5-4-3-2-1, and LH arpeggio 5-3-2-1 instead of 5-4-2-1.
- A held top note with a moving inner voice gives `1/5 2 3`.
- Repeated notes change fingers when fast (1-2-1-2 at 0.12 s) and keep the finger when slow.
- Speed: 384 LH notes in 0.79 s, 245 RH notes in 0.88 s (CPython, Ryzen 7 260), so the full 3-4 min piece takes a few seconds.
- **Not validated against PIG.** The dataset is research/non-profit use, and the download needs a terms acceptance the user must make.

**Overrides.** `fingering_overrides.json` pins fingers by note id. The DP then solves around the pinned notes as hard constraints. Use it for every hero close-up passage after watching it.

---

## 8. IK and animation pipeline

### 8.1 Order of operations (offline, deterministic)

1. Read MIDI, `structure.json`, `δ_audio`.
2. Per note: compute `t_fk`, `t_kb`, `t_off` and the touch type (5.2 and 4.8).
3. Fingering DP per hand (7.2).
4. Segment each hand into **hand positions**: maximal runs of contact sets that one palm pose can reach within comfortable limits. Solve a palm pose per contact set (8.2).
5. Build the palm trajectory (8.6), including anticipation (4.4), arm drops (4.6) and compensation.
6. Per frame and per sub-frame sample t: torso and head (section 6), then arm IK (8.5), then wrist, then fingers (8.3) and thumb (8.4).
7. Run collision resolution (8.7).
8. Compute QC (8.9). Fail the render if a gate fails.

### 8.2 Palm placement optimisation

**Variables:** wrist centre (3), palm yaw, pitch, roll.

**Objective** (weights from the prototype):

```
sum_f [ (MCP_f - 25°)^2 + 0.7 (PIP_f - 45°)^2 + 0.5 abd_f^2 + 0.8 (DPangle_f - 75°)^2 ]
+ 20 (pitch - 10°)^2 + 0.3 yaw^2 + 0.3 roll^2
+ 50 · (joint/abduction limit violations)^2
+ w_c ||pose - pose_prev||^2 + w_a ||pose - pose_next||^2
```

The last two terms give continuity and anticipation, with w_c and w_a ≈ 0.5 [design].

- Fingers are the contact fingers of the set plus resting fingers on their planned keys.
- The prototype used a coarse grid start plus Nelder-Mead and converged to 0.00 mm tip error in all three cases [proto].
- Production: warm-start from the previous set; use Levenberg-Marquardt with finite differences; 6-D, so it is cheap.

### 8.3 Long fingers: analytic planar IK with coupled DIP

1. Transform the target pad point (on the *moving* key surface) into the palm frame.
2. MCP abduction = atan2(lateral offset, forward offset), clamped to the abduction limits.
3. In the finger plane, the reach distance r(θ_PIP) of PP + MP + DP with θ_DIP = c·θ_PIP (c = 2/3) is monotone on [0°, 110°]. Solve θ_PIP by bisection (60 iterations, or Newton).
4. Then θ_MCP = atan2(tip_z0, tip_x0) - atan2(target_w, target_u).
5. If unreachable or out of limits, raise that finger's weight in 8.2 and re-solve the palm. Never let a fingertip float or sink.
6. Contact orientation: if the DP angle leaves 45-95°, adjust c within 0.5-0.85 before re-solving the palm.

### 8.4 Thumb solver (its own system)

- **Chain.** 5-DOF chain from 3.4: CMC FE, offset, CMC AA, MCP AA, MCP FE, IP; axial rotation coupled.
- **Solver.** Damped least squares, λ = 0.05 (rad-scale units), 10-20 iterations, warm-started.
- **Joint limits.** Clamp with a soft barrier.
- **Regulariser** towards the relaxed thumb pose: CMC at the Cooney base + (FE 10°, AA 15°), MCP 15°, IP 15°.
- **Targets.** Contact-corner position (hard). Side-down roll 45-70° and DP pitch 20-35° (soft).
- **Thumb-under.** Interpolate the target along a path that stays 2-12 mm above the white key tops and under the palm. The palm-clearance capsule test runs every sample.

### 8.5 Arm

- **Shoulder** comes from the torso. The **wrist target** comes from the palm.
- Analytic **2-bone IK** with **swivel** = 20° + 0.15° per cm of hand lateral distance from the shoulder's sagittal plane, more when the hand crosses the midline. Clamp 5-45°.
- **Forearm twist** solves the roll of the palm relative to the elbow plane and is distributed 0.33/0.66/1.0 over twist bones.
- **Wrist angles** come out of the palm and forearm orientation. Clamp to the working band of 3.4. If clamping is needed, push the residual back into palm yaw/roll by re-solving 8.2 with the wrist limit as a constraint.
- Elbow and torso are smoothed with springs. Contact fingers are never smoothed.

### 8.6 Temporal construction

- **Palm.** Minimum-jerk segments `x(τ) = x0 + (x1 - x0)(10τ³ - 15τ⁴ + 6τ⁵)` between key palm poses (Flash & Hogan 1985). Each segment starts at `t_move` (4.4) and ends 30-60 ms before the first contact of the new set. Leaps add an apex (4.6).
- **Fingers.** Per-finger state machine:

  ```
  REST -> PREP (apex at t_fk - Δ) -> APPROACH (last 8 mm strictly vertical above the contact region)
       -> PRESS (rides the key profile t_fk..t_kb) -> HOLD -> RELEASE (rides the key up from t_off - 25 ms)
       -> LIFT -> REST/PREP
  ```

  - Approach speed at contact: 0 for pressed touch, v_fk for struck (4.8).
  - Trajectories between states use min-jerk in the palm frame. In contact, the target is exact.
- **Everything else** uses critically damped springs (Holden's exact half-life form). Half-lives:
  - wrist secondary motion 70 ms;
  - free fingers 50 ms;
  - elbow 120 ms;
  - torso 0.8 s;
  - head 0.3 s.
- **Time as a function.** Integrate springs at a fixed 960 Hz from t = 0, cache the state, and linearly interpolate between 960 Hz samples. Motion-blur sub-frames then see continuous, repeatable motion. **Never step springs per rendered frame.**

### 8.7 Collisions

Capsule radii come from 3.3.

| pair | rule | fix |
|---|---|---|
| fingertip vs key top | pad apex distance = 0 ± 0.5 mm while in contact; ≥ 0 otherwise | — |
| any phalanx vs black-key boxes (sides and front face) | penetration ≤ 0.5 mm | Contact points come only from the allowed region (4.1). The approach is vertical for the last 8 mm. Re-solve abduction/palm on violation. |
| finger vs finger | distance ≥ 0 (≤ 1 mm allowed as skin contact) | Lift the non-contact finger first, then adjust free-finger abduction, then add a palm penalty |
| crossing finger over thumb | ≥ 5 mm clearance | Raise the crossing arc |
| thumb vs palm during thumb-under | ≥ 2 mm | Increase CMC palmar abduction |
| hand vs fallboard / cheek blocks | ≥ 3 mm | Palm optimiser constraint |
| sleeve/cuff vs key slip | ≥ 2 mm | Handled by cloth; flag only |

### 8.8 Left hand

Mirror all lateral axes (x → -x), MCP_X signs, roll and yaw signs. In fingering, mirror the pitch by reflection about D4 (`124 - p`). Keep the thumb CMC chirality correct: mirror the base frame, not just the angles.

### 8.9 Automatic QC (per frame and per note; written to `anim_qc.csv`)

| metric | threshold |
|---|---|
| contact error: pad apex to key-surface contact point, while in contact | ≤ 0.5 mm (99.9th pct), max 1.0 mm |
| contact inside the allowed key region | 100% |
| key-bottom frame vs t_kb; key motion start vs t_fk | ±1 frame |
| rendered-audio onset (onset detector) vs t_hs | median ≤ 5 ms, max ≤ 10 ms |
| joint-limit violation | none > 2° |
| DIP flexion during contact | ≥ 5° (no broken knuckle); PIP ≥ 15° in contact except flagged flat-finger notes |
| non-contact fingers | PIP ≥ 10°, DIP/PIP ratio 0.5-0.9 (no claws, no straight sticks) |
| inter-finger penetration | ≤ 1 mm |
| black-key side penetration | ≤ 0.5 mm |
| fingertip speed | ≤ 1.5 m/s (≤ 0.8 m/s at contact) |
| per-frame joint change for fingers outside leaps | ≤ 12°/frame at 60 fps (pop detector) |
| wrist working band (3.4) | ≤ 2% of frames outside, never outside the hard limits |
| pedal angle vs CC64 damper state | consistent at every CC64 event ±1 frame |
| determinism | two runs give a byte-identical output hash |

Also render a **debug overlay pass**, never in the final film: per-finger contact markers, key-state colours and the fingering number on each key. Review close-ups at 0.25× speed.

---

## 9. Risks and unverified items

- **Travel-time curve.** Fitted on a Bösendorfer and generalised. Actions differ by a few ms and touch matters more (Goebl 2005). Our audio is sampled, so `δ_audio(v)` calibration matters more than the action model. **Not yet measured**; the sampler choice is pending.
- **kb_rel** is a 3-point fit to numbers stated in the paper's text, not its figure data. Error is likely ±3 ms; invisible at 60 fps.
- **Key-lever length L_b, black-key dip, allowed contact regions.** Must come from the piano model. My defaults are assumptions.
- **Hand model** mixes datasets: Buryanov X-ray (mixed sex, Ukrainian adults), Greiner (US Army male surface landmarks), ANSUR II. Joint-centre offsets inside bone heads (6/4/3 mm) are my estimates. Cross-checks agree within about 5%.
- **Body-motion amplitudes and timings** (section 6) are design values. The literature gives directions and correlates, not magnitudes.
- **Fingering** is not validated against human annotation datasets (PIG requires terms acceptance by the user). Two textbook mismatches are accepted variants. Pop/hip-hop-influenced LH patterns (wide broken 10ths) will produce shifts; review them in close-ups and override.
- **Not retrieved:** Jacobs 2001 and Hart et al. 2000 (cited from bibliographies only); Repp 1996 pedal-timing numbers; Buchholz 1992 hand coefficients (paywalled).
- I did not prototype the **thumb DLS solver** or the arm swivel heuristic. Their numbers are design values.

---

## 10. Prototypes (sandbox, gitignored)

| script | what it does | result |
|---|---|---|
| `sandbox/performance/scripts/ansur_stats.py` | ANSUR II male stats, hand-length subset | table in section 2 |
| `sandbox/performance/scripts/greiner_means.py`, `greiner_means2.py` | parses Greiner 1991 OCR summary statistics | finger breadths/circumferences in 3.3 |
| `sandbox/performance/scripts/hand_pose.py` | hand links, MCP arc, palm optimisation, coupled planar finger IK | 3.1 and 3.5 (run with argument `20` for the pitch weight) |
| `sandbox/performance/scripts/posture.py` | seated posture search, 3-D 2-bone arm | table in section 2 |
| `sandbox/performance/scripts/timing_table.py` | key/hammer timing formulas | 5.3 |
| `sandbox/performance/scripts/fingering_dp.py` | second-order Viterbi fingering with the Parncutt cost table + polyphony | 7.2 validation |

Recommendation: promote `fingering_dp.py` and the IK pieces of `hand_pose.py` into the tracked source tree as the starting point of the animator. They are dependency-light: stdlib, plus numpy/scipy for the IK.

---

## 11. Sources

**Fingering**
- Parncutt, Sloboda, Clarke, Raekallio & Desain (1997), *Music Perception* 14(4): https://static.uni-graz.at/fileadmin/_Persoenliche_Webseite/parncutt_richard/Pdfs/PaSlClRaDe97_FingeringModel.pdf
- Al Kasimi, Nichols & Raphael (2007), ISMIR: https://archives.ismir.net/ismir2007/paper/000355.pdf
- Nakamura, Saito & Yoshii, *Statistical Learning and Estimation of Piano Fingering* (PIG): https://arxiv.org/abs/1904.10237
- Musy, pianoplayer (MIT): https://github.com/marcomusy/pianoplayer
- Hart, Bosch & Tsai (2000), UMAP J. 21(2):167-177, and Jacobs (2001), Music Perception 18: bibliographic only (via Zhu 2012 and Kasimi 2007 reference lists).

**Piano animation**
- Zhu, Ramakrishnan, Hamann & Neff (2012), *A system for automatic animation of piano performances*: https://www.cs.ucdavis.edu/~neff/papers/cav1477.pdf
- Wang et al., FürElise (2024): https://arxiv.org/abs/2410.05791
- Tipiano (2026): https://arxiv.org/abs/2604.09692

**Piano action timing and touch**
- Goebl, Bresin & Galembo (2005), JASA 118:1154: https://doi.org/10.1121/1.1944648 (PDF via https://web.archive.org/web/2024/http://iwk.mdw.ac.at:80/goebl/papers/Goebl-Bresin-Galembo_JASA2005_PianoAction.pdf)
- Goebl & Bresin (2003), JASA 114:2273: https://iwk.mdw.ac.at/goebl/papers/Goebl-Bresin_JASA2003_reproAccuracy.pdf (read via web.archive.org)
- Goebl (2001), melody lead, JASA 110:563: https://iwk.mdw.ac.at/goebl/papers/Goebl_JASA2001_melodyLead.pdf (via web.archive.org)
- Goebl, Bresin & Galembo (2004), ISMA: https://ofai.at/papers/oefai-tr-2004-02.pdf
- Goebl (2017), *Movement and touch in piano performance* (Springer Handbook postprint): https://iwk.mdw.ac.at/goebl/papers/Goebl2017-SpringerHandbook-PianoMovementTouch-postprint.pdf (via web.archive.org)
- Goebl & Palmer (2009), ISPS: https://iwk.mdw.ac.at/goebl/papers/GoeblPalmer2009_ISPS-Touch.pdf (via web.archive.org)
- Askenfelt & Jansson, *Five lectures on the acoustics of the piano* (KTH): https://www.speech.kth.se/music/5_lectures/askenflt/timing.html, https://www.speech.kth.se/music/5_lectures/askenflt/measure.html, https://www.speech.kth.se/music/5_lectures/askenflt/keybott.html, https://www.speech.kth.se/music/5_lectures/askenflt/motions.html
- Key dip 10 mm / blow 42 mm (MMD): https://www.mmdigest.com/Archives/Digests/200208/2002.08.22.11.html
- Aftertouch about 1 mm (PianoWorld): https://forums.pianoworld.com/ubbthreads.php/topics/3601719/zackery.html
- Damper lift at about half key travel (MMD thread): https://www.mmdigest.com/Archives/Digests/200809/2008.09.27.04.html and https://www.mmdigest.com/Archives/Digests/200809/2008.09.27.03.html
- Sustain-pedal travel and height (PTG): https://my.ptg.org/discussion/sustain-pedal-height-and-travel
- Half-pedal regions (patent): https://patents.google.com/patent/US8933316
- Sustain pedal / legato pedalling: https://en.wikipedia.org/wiki/Sustain_pedal
- Keyboard dimensions: https://en.wikipedia.org/wiki/Musical_keyboard
- Bresin & Battel (2000), articulation: https://www.speech.kth.se/music/publications/thesisrb/
- A/V sync (ITU-R BT.1359 summary): https://www.tvtechnology.com/opinions/av-synchronization-how-bad-is-bad

**Anatomy and anthropometry**
- Buryanov & Kotiuk (2010), *Proportions of hand segments*: https://www.scielo.cl/scielo.php?script=sci_arttext&pid=S0717-95022010000300015
- Greiner (1991), *Hand anthropometry of U.S. Army personnel*: https://apps.dtic.mil/sti/pdfs/ADA244533.pdf (read via web.archive.org)
- ANSUR II public data: https://www.openlab.psu.edu/ansur2/
- Rijpkema & Girard (1991), knowledge-based grasping (DIP = 2/3 PIP): https://www.ece.uvic.ca/~bctill/papers/mocap/Rijpkema_Girard_1991.pdf (via web.archive.org); https://history.siggraph.org/?p=120603
- Cooney et al. (1981), trapeziometacarpal kinesiology: https://www.ece.uvic.ca/~bctill/papers/mocap/Cooney_etal_1981.pdf (via web.archive.org)
- Hollister et al. (1992), thumb CMC axes (abstract): https://scholarhub.vn/publication/:slug/5f463ada-49b4-476e-9d22-01502e1a6c04
- Halilaj et al. (2014), envelope of CMC motion: https://pmc.ncbi.nlm.nih.gov/articles/PMC4574857
- Santos & Valero-Cuevas (2006), thumb Denavit-Hartenberg (D-H) parameters: https://valerolab.org/usc-bbdl.github.io/Papers/Santos_Valero-Cuevas_Denavit-Hartenberg_2006.pdf
- Bain et al. (2015), functional finger ROM: https://digital.library.adelaide.edu.au/items/6980b88b-ecd1-4d54-9fb9-4330b359e4ad
- Clinical ROM norms: https://www.physiotutors.com/?p=12633
- Wrist functional ROM (Ryu et al.): https://mayoclinic.elsevierpure.com/en/publications/functional-ranges-of-motion-of-the-wrist-joint/
- Pianists' ulnar deviation (Sugawara, *Work*): https://content.iospress.com/articles/work/wor00060
- Finger independence (Häger-Ross & Schieber 2000): https://www.jneurosci.org/content/20/22/8542
- Nail dimensions: https://pmc.ncbi.nlm.nih.gov/articles/PMC5702813/table/tbl_001 and https://library.scconline.org/is-cacheable/1708710373486/Typology-Atlases-Human-Fingernails.pdf

**Pedagogy and posture**
- Pierce, *Fix It: Teaching Tips for Playing Even Scales* (Yamaha, thumb contact): https://hub.yamaha.com/music-educators/instruments/piano/piano-pedagogy-even-scales/
- Chang, *Fundamentals of Piano Practice*, bench height and distance: https://fundamentals-of-piano-practice.readthedocs.io/chapter1/ch1_procedures/II.3.html
- Bench heights: https://www.piano-composer-teacher-london.co.uk/how-tall-is-a-piano-bench/
- Czerny/Deppe elbow height summary: https://pianoeducation.org/pnotmi1.html
- Uniarts Helsinki piano practice guide (elbow angle): https://sites.uniarts.fi/web/harjoittelu/piano
- Key height measurements (MMD): https://www.mmdigest.com/Archives/Digests/200203/2002.03.20.03.html

**Expressive movement**
- Sakaguchi & Aiba (2016), breathing in piano performance: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2016.00381/full
- Massie-Laberge, Cossette & Wanderley (2019), pianists' expressive kinematics: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.02725/full
- Thompson & Luck (2012), Musicae Scientiae 16(1): https://doi.org/10.1177/1029864911423457

**Motion synthesis**
- Flash & Hogan (1985), minimum jerk: https://www.jneurosci.org/content/5/7/1688
- Holden, *Spring-It-On* (critically damped springs): https://theorangeduck.com/page/spring-roll-call
