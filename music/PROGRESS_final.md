# Afterglow, final synthesis: progress log

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Run: `.venv\Scripts\python.exe music\afterglow_score.py`
Outputs: `music/final/` (score.json, score.mid, leadsheet.txt, checks.txt, report.txt, roll_*.png).

Source files (all in `music/`, no imports from `candidates/`):
- `afterglow_score.py`: the assembler (sections, tempo map, pedal plan, perform, post-passes, outputs, checklist)
- `afterglow_melody.py`: the tune, one DSL `line()` string per bar
- `afterglow_arr.py`: both hands' accompaniment, bar by bar, plus the harmony timeline and the pedal plan
- `afterglow_lib.py`: event language, melody shaping, Viterbi fingering, post-performance passes
- `afterglow_checks.py`: validators (playability, melody, structure, pedal policy, clashes, arrivals, density...)

## Session log

### Session A (interrupted by usage limits, before this log existed)
- Wrote `afterglow_lib.py`, `afterglow_melody.py`, `afterglow_arr.py` and `afterglow_checks.py` (ported from the
  winning "melody" candidate, with most judge must-fixes and grafts already composed in: withheld intro, verse-1
  openings varied, 3-strike pre-chorus flow, elided 24->25 tie, falling-sixth verse 2, pre-2 backing vocal,
  chorus-2 vocal variants, common-tone deceptive cadence 40->41, moving bridge bar 42, doubling-density build,
  apex F6 as a real sus resolving to E6, lone C5 pickup into the tag, 3-note snare shells, new pedal policy).
- `afterglow_score.py` and this log did not exist yet.

### Session B (resume)
- [x] write `afterglow_score.py` (assembler + outputs into music/final/)
- [x] first run, fix every validator issue
- [x] view the piano rolls, revise textures / contour
- [x] section-6 checklist pass 1 + revisions
- [x] section-6 checklist pass 2 + revisions
- [x] final outputs (0 issues, deterministic: two runs give byte-identical score.json / score.mid)

#### Milestone B1 - assembler written, first run (seed 20261021)
- `afterglow_score.py` written (sections, tempo map, pedal plan from afterglow_arr.HARM, one continuous melody
  line so ties cross section boundaries, post passes, checks, section-6 block, outputs to music/final/).
- First run: 3:47.9, 1158 notes, 0 DSL issues, 39 validator issues (25 melody m2/m9 clashes not yet explained,
  3 pedal-aware mud spots (Ab2-D3 in 22/38, Bb2-E3 in 58), swing-straightened LH fills overlapping (28, 32),
  a 24-st LH jump in 182 ms (bar 20), thumb on Eb5 in bar 39, same finger A5-G5 in bar 63, coda dynamic
  range 11, chorus 2 thinner than pre 2, the final pedal ramp counted as a dip).

#### Milestone B2 - validators at 0 issues
- Fixes: bar 20 dry fill G2 ghost (no 24-st jump in 180 ms) and dry lift moved to beat 4; Bb/Ab snare shells
  re-voiced [F3 Bb3 D4] (bars 22, 38: no Ab2-D3 tritone ringing); bar 58 single Bb1 under C/Bb (no Bb2-E3);
  climax Bbmaj9 shells [D3 F3 C4] (the hook's Bb5 neighbour no longer grinds on a shell A3); bar 55 inner C5
  only; final-A / coda LH without the maj7 under the neighbour (63, 67: tenor C4-A3-G3 into Bbm6's G3);
  hats re-voiced under passing Eb5s (19, 35); bar 38 RH inner released before the pedal change; bar 39 thumb
  off the black key (hat reduced to Bb4, melody fingers pinned 2-3-4-5-2-3-2-4-5); bars 63-65 melody fingers
  pinned; bar 42 inner shortened (finger conflict); dry LH fills fingered 1-2-3-5; LH keys before a
  swing-straightened kick are lifted in time (afterglow_lib.straighten_kicks).
- Texture: pre 2's backing vocal now joins on the held syllable (the lead raps its pickup alone); chorus 2 gains
  ghost pairs (33, 35, 39), both-hand pushes on the "&" of 4 (33, 35), the sus chord under beta (34), a hat in
  the bar-36 rest and a tenor answer F3-Ab3-Bb3-D4 in bar 38. Notes/s: pre 2 6.7 -> chorus 2 6.9 -> climax 7.6.
- Coda: the Db5 (b6) leans +6, the last C5 v42: melody range 42-55.
- 9 intended melody m2/m9 spots documented in INTENDED (passing 16ths, b9s of V7b9 chords, the hook's
  neighbour over its own octave doubling, the dry walk-up under the elided Eb5).

#### Milestone B3 - section-6 checklist, review pass 1 (bar-by-bar text view + rolls + a test render)
Tools: scratchpad `view.py` (every bar: chords, melody, RH, LH with step/dur/vel/finger), the rolls, and a test
render through music/render_audio.py into the scratchpad (not build/audio) with scratchpad `ear.py` (per-section and
per-bar loudness, low-end share, drop silence depth). Render v1: LUFS -16.0, true peak -1.2 dBTP, LRA 13.9 LU.

| # | item | verdict | evidence / what I changed |
|---|---|---|---|
| 1 | hook | pass | Bb4->G5 held, G-Ab-G, 3+3+2 fall F5-Eb5-C5 / Bb4->Eb5 on the "&" of 1 -> D5. Intro hints only (leap, sigh, P5 echo, stops on the 9th); C1 17/21, C2 33 (+scoop 34) / 37 octaves, climax 53/57, tag (leap lands on I), final A 63, coda 67 |
| 2 | motifs | pass | gamma in 5/7/13-15/19/23/26/27/29-31/35/39/55/59/65; beta 16/18/34/54/58/64 and the bridge's #11 slot (42); alpha as a m6 (45), P5 (3), inverted (25), the pocket as the build's top line (49-50) |
| 3 | no loops | pass | longest verbatim 2-bar LH repeat 1x; 45 distinct one-bar LH rhythms; chorus 2 differs from chorus 1 in melody (34-36, 39-40), comping, ghosts, counter, octaves |
| 4 | inner motion | pass | >= 2 stepwise inner moves in every 4 bars (lowest windows: build, tag, last bar = 2) |
| 5 | bass line | pass | verse 1 6/10, pre 1 5/5, verse 2 4/5, pre 2 5/5 steps / chromatic approaches |
| 6 | cadences | pass | half (16), elided authentic (24->25 tied Eb5), deceptive (40->41 held Eb5 = Cm's 3rd), C pedal = V/F, minor plagal close |
| 7 | arrivals | pass | 0.97 s / 1.26 s real silence (render: -47 / -49 dB in the 450 ms before each pickup); F6 once at 79.2 %, v115, loudest note; climax = loudest section on the render (-15.9 dB vs chorus 2 -17.8) |
| 8 | melody on top | pass | prominence margin >= 12 everywhere (47 accompaniment velocities lowered by the voicing pass) |
| 9 | breathing | pass | every bar has a rest >= 1/2 beat or a note >= 1.5 beats |
| 10 | groove | pass | swing 56-58 %, kick/ghost layer re-gridded straight (Dilla layering), backbeat shells +7 ms, melody +14 ms (verse 2 +19, climax +9), ghosts 23-32, >= 1 anticipation per 2 chorus bars |
| 11 | tempo | pass | groove sections within 0.6 % of their median |
| 12 | dynamics | pass | every section's melody range >= 12; arc on the render: intro -29.5, verse 1 -23.9, pre 1 -21.7, C1 -19.9, verse 2 -21.4, pre 2 -19.7, C2 -17.8, bridge -24.4, build -17.2, climax -15.9, tag -20.7, final A -29.5, coda -32.9 dB |
| 13 | playability | pass | 0 span / keys / crossing / leap / mud / finger-conflict / same-finger / thumb-on-black issues |
| 14 | pedal | pass | a change at every harmony change, re-catches only on re-struck basses (17, 21, 37), dry lifts only at the fills / drops (16, 20, 24, 28, 32, 52, 60); chorus 1 0.57 dips/s |
| 15 | ending | pass | Friberg rit, Bbmaj9 -> Bbm6 (Db5) -> Fadd9 (C5 on beat 2), 6.6 s ring, 0.7 s damper ramp |
| 16 | duration | pass | 3:48.0 to the last note-off |
| 17 | originality | automated pass | 0 RFIY windows, 0 neighbour oscillations, no 5-interval match with My Bonnie / Chopin Op. 9/2 (4-interval My Bonnie shapes are generic 5-6-5-3-2 fragments); human A/B NOT possible here |
| 18 | sound | pass (render) | no clipping (-1.2 dBTP), no >4 equal melody velocities in a row |

Weak spots found in pass 1 and revised:
- Verse 2 bar 27: the tune's D5 sat on the "&" of 4 exactly where the bass anticipates Bbm9, so D natural rang
  under the pedal into the Db5 of bar 28. The tune now anticipates the Db with the bass (F5 Eb5 Db5~), a real R&B
  push; verse 1 keeps the D-Db-C slide (no anticipation there).
- Bridge 45: RH inner C5 sounded a m9 above the line cliche's B3; it now leaves before the pedal change at beat 3.
- Bridge 47: the "Abmaj9" was a bare triad under Ab5; RH now Bb4+Eb5 (Ab add9), label corrected.
- Intro: the 1.2 s fermata moved from the melody's C5 to the rest after it (beat 4): the hold is on the rolled
  Bb9sus4 ringing, not on a held melody note (RFIY do-not-copy #5).
- Tag: the phrase arch made the downbeat A5 (the leap landing on I) softer than the G5 after it; the tag now has
  no phrase arch, only its decaying dynamics, so the arrival is the loudest note of the tag.
- Build: the bar-52 C5 pickup came out of the silence at v93; now -14 (the A5 downbeat is the arrival).
  The riser's LH/inner ramp was lowered (render: bar 51 was as loud as the climax bars).
- Bar 60: the pickup into the tag is a lone C5 (not doubled), so C5 -> A5 lands alone onto the ff Fadd9.
- Bar 40: the deceptive cadence now relaxes (dynamics 1.0 -> 0.84 over the last beat) into the bridge.
- Hand accents on the expressive notes: the tear Cb5 (10), the chorus's E natural (23, 39), the coda's Db5 (68).
- Last chord: a half-pedal flutter (CC64 44 for 0.24 s, inside the sampler's 32-76 half-pedal zone) right after
  the RH's A4 lets the released Bb3 / G4 strings be damped, so the 4-3 and 9-3 really resolve while the held keys
  ring on.
- Labels: the bar-16 dry stab is Bb7 (no 13th sounds), bar 32 Bb9.

#### Milestone B4 - section-6 checklist, review pass 2 (different angles: audio, pedal plot, fingering, animation)
Angles this time: per-bar loudness on renders v3/v4 (scratchpad ear.py), a CC64-vs-chord-change plot for chorus 1,
chorus 2 and drop + climax, the fingering distribution, determinism, and the bar-by-bar view again.

| # | item | verdict | pass-2 evidence |
|---|---|---|---|
| 1 | hook | pass | the hook's leap lands on IV (as IV's maj7) at every statement until the tag, where C5 (lone, dry) -> A5 lands on the ff Fadd9 |
| 2 | motifs | pass | unchanged |
| 3 | no loops | pass | build LH re-written (octaves only on the 3+3+2 accents) - still 1x max verbatim 2-bar repeat |
| 4 | inner motion | pass | lowest 4-bar windows have 2 stepwise inner moves (build, tag, final bar) |
| 5 | bass line | pass | unchanged |
| 6 | cadences | pass | the deceptive cadence now relaxes over beat 4 of bar 40 (dyn 1.0 -> 0.84) into the bridge |
| 7 | arrivals | pass | render v4: -46.4 dB / -47.6 dB in the 450 ms before the two pickups (about 27 / 31 dB below the music around them); F6 v114 is the single loudest note (next 110); climax is the loudest section (-15.8 dB, peak 400 ms -12.7) |
| 8 | melody on top | pass | 31 accompaniment velocities lowered by the voicing pass; margin >= 12 |
| 9 | breathing | pass | unchanged |
| 10 | groove | pass | 28 LH kick / ghost 16ths re-gridded straight under the swung layers; micro-timing measured in checks.txt |
| 11 | tempo | pass | groove sections within 0.6 % |
| 12 | dynamics | pass | render v4 arc: intro -29.3, verse 1 -23.7, pre 1 -21.5, C1 -19.6, verse 2 -21.2, pre 2 -19.5, C2 -17.6, bridge -24.2, build -18.2, climax -15.8, tag -20.6, final A -29.4, coda -32.4 dB; LRA 13.6 LU |
| 13 | playability | pass | 0 issues; every note fingered (LH 1/5 dominate: bass on 5, tenor/counter on 1-2) |
| 14 | pedal | pass | plot: one change right after each chord change, re-catches only on re-struck basses, dry only at fills / drops; bass keys held until the pedal re-catches |
| 15 | ending | pass | half-pedal flutter after the last chord's resolutions; 6.6 s ring; ramp 0.7 s |
| 16 | duration | pass | 3:48.0 |
| 17 | originality | automated pass | unchanged; human A/B listening still not possible |
| 18 | sound | pass | render: true peak -1.2 dBTP, LUFS -16.0, no clipping; tail -77 dB 1 s after the last note-off |

Weak spots found in pass 2 and revised:
- Build: on render v3 bar 51 was as loud as the climax bars and the build carried 34 % of its energy below 180 Hz
  (C2+C3 octaves on every 8th). The LH now plays octaves only on the 3+3+2 accents and the thumb's C3 alone in
  between; the riser's ramp is lower. Render v4: build -18.2 dB (28 % low end) vs climax -15.8 dB.
- Apex velocity is pinned to 114-115 (it could fall to 112 when the seeded jitter changed); everything else <= 110.

## Fix round 1 (reviewer feedback: listener, pianist, originality)

Resume note (session C, after a usage-limit kill): the first fix-round agent backed up the sources to the scratchpad
(fix1/) at 08:49 and edited `afterglow_melody.py`, `afterglow_arr.py` and `afterglow_lib.py` until 09:25, but never
touched `afterglow_score.py` / `afterglow_checks.py` or this log. Verified by diffing against the backup:

Already in the sources (verified, session C):
- [x] melody: verse 1 own entries (5 lazy 16th, 7 tied in), verse peak F5 in 12; bar 16 lands on a held F5 + Ab5 on
      the stab (beta's first full statement is 18); 21 pinned 3-4-5; 22-23 tied/anticipated entry; verse 2 26/27
      own entries; 32 holds the 7th into the hook; 37/53/57/61/65 turns pinned 4-5-4; 39 long downbeat; bridge 43
      syncopated entry, 46-48 rewritten (no MFV); build top line Eb-F-G-Ab, sweep stops on Ab5; climax 55 long C6;
      58 F6 held to 3.5; 59 tied entry; tag 61 = the hook's own turn + pocket over I; final A cut to 2 bars (63-64:
      Dm9 | Gm9 C7sus4, A4 register, no pocket, no gamma); coda 65-67 with Db5 tied over into the last chord
- [x] arr: chorus arrivals 17/33 (LH octave, RH dyad), climax 53 (b+16, s+6, RH i+10), ghost dyads, bar 34 counter
      climbs Bb3-C4-D4-F4-Eb4, bridge 47 Fm7/Ab | Dbmaj7#11, 48 G7sus4 | G7b9, build 50-51 thumb C3 pinned %1,
      climax re-catches (53, 55, 57 beat 3), coda RH F4 tied into the last chord, no Ab4 passing note, HARM labels
      (8:3/28:3 Eb7, 45 Cm, 32:3 Bb7, 52 C7(b9,b13)), HALF_FLUTTER, GROOVE_PEDAL (defined, not yet used)
- [x] lib: LEGATO_OVERLAP, PIN_LOG / BREAK_LOG, same-finger travel cost in the Viterbi, bass-thumb exemption,
      octave pins respected, air_pass / accelerate_change / cap_pedal / flutter (written, not yet called)

Session C (checkpoint: TOTAL ISSUES 0, 3:40.8, 1148 notes):
- [x] afterglow_score.py: 67-bar form (sections, phrases, tempo, rit, fermatas, dyn, accents, INTENDED, last chord)
- [x] arrivals: arrival phrases start at the TOP of their arch (peak 0.0 - a peak of 0.02 still put the downbeat at
      0.9 x), DYN held through the arrival downbeats, small accents; riser Ab5s -4/-6. Measured: 17 G5 v94 vs pre
      F5 v82; 33 G5 v97 vs F5 v90; 53 A5 v106 vs riser Ab5 v92, LH v94 vs riser v86, bar energy 11.8 vs 8.9
- [x] tag -> final A pickup C4 -30 (v44, under the A4 it leads to)
- [x] wired air_pass (+ hand_shift: jump size = distance to the centre of the new keys), groove half pedal CC64 60
      over the whole Eb groove block 17-40, flutters (10, 17, 21, 33, 59, 61, 65), re-catch 63:3 on a re-struck D2
- [x] validators: key_air, finger_travel (+ FINGER-JUMP), finger_order, finger_pins (+ broken states), FINGER-CROSS in
      fast lines, pedal_clusters (continuous damper model incl. half pedal / flutters + natural decay; intended pairs
      documented), arrivals (downbeat vs peak, LH, energy, new high); Sound.end is now half-pedal aware
- [x] fixes the new validators found: bar 7/8 fingering (thumb on white keys), bar 8 inner Ab4, 42 inner shortened
      (+C5), 43 inner F4 and pins, 19/20 + 35/36 pins with single-key hats, 33 push left to the LH, 29 F1 on 5,
      55 ghost [E4 A4], 56 RH re-voiced, 57 inner D5 only, 58 apex doubling F5 ends at the beat-3 change, 59 F#5
      single (3-4-5), 63 re-catch, 64 Gm7 [F3 Bb3] (no A3 under Bb4), 21 blue-note slide Gb5 -> G5 (one finger)
- [x] rolls + bar-by-bar review (melody view with fingers, performed-time view, rolls 04/08/09/10/11/12/13)
- [x] more fixes from that review: a widened FINGER-CROSS window (0.5 s, octave hand shifts and detached groove 8ths
      exempt) found crossings in 6-7, 27-28 and intro 4 -> pinned (thumb only on white keys; 27 hat removed, 28 hat
      single); the final pedal-up still sat at bar 70 (old form: the pedal stayed down 12 s after the last note-off)
      -> LAST_BAR + 1 (ring 6.6 s); the air pass now uses the fast change (+25 / +80 / +150 ms) whenever the slow
      catch costs the hand its wanted air (12 changes)
- [x] test renders (scratchpad render/, build/audio untouched): v5 (half pedal) vs v5_nohalf (A/B), v6 = final.
      v6: LUFS -16.0, true peak -1.2 dBTP, LRA 13.4 LU; arc intro -29.1, verse 1 -23.5, pre 1 -21.6, C1 -19.8,
      verse 2 -21.6, pre 2 -20.3, C2 -17.9, bridge -24.1, build -18.1, climax -15.7 (loudest), tag -19.1, final A
      -28.9, coda -32.7 dB; drops -49.1 / -48.1 dB before the pickups; per bar 15 -20 / 16 -22 / 17 -18,
      32 -20 / 33 -17, 51 -17 / 52 -17 / 53 -15 (each arrival is the loudest bar around it); tail -78 dB 1 s after
- [x] determinism: two runs give byte-identical score.json / score.mid

### Reviewer items (fix round 1) - status
BLOCKING
| item | status | what changed / measured |
|---|---|---|
| L arrivals undercut (17, 33, 53) | done | arrival phrases start at the top of their arch (peak 0.0), DYN held through the downbeat, riser Ab5 -4/-6, bar-52 last LH hit b+4, bar-53 LH b+20 / RH i+10. 17: G5 v94 vs pre F5 v82 (energy 5.5 vs 4.2 in bar 15); 33: G5 v97 vs v90; 53: A5 v106 vs riser top v92, LH v94 vs v86, RH inner 83-90 vs 77, energy 11.8 vs 8.9 (render: bar 53 -15 dB vs 51/52 -17 dB). Build top line stops on Ab5, so A5 at 53 is the new high (validator) |
| L final cadence (68-69, now 66-67) | done | Db5 and F4 tied over the bar line, held through the pedal change: Bbm6/F appoggiatura over F1 + roll, Db5 4 -> C5 3 on beat 2 with Bb3 -> A3 and G4 -> A4, then the half-pedal flutter |
| L octave-hook fingering | done | 37/53/57/61/65 turns pinned 4-5-4 over the thumb's doubling; 59 F#5 3 - G5 4 - A5 5 (F#5 single inside the RH chord); 21 F5 3 - Gb5 4 - G5 4 (slide) - Bb5 5. Validators: FINGER-JUMP (no finger >= 8 st within 250 ms), finger_travel, FINGER-CROSS |
| P LH key-holds, no travel time | done | air_pass + hand_shift + fast pedal catches; LH jumps > 16 st: median air 19 ms -> 213 ms, minimum 0 -> 100 ms (148 under 100 ms before; now 2 at 99.9 ms), 33 under 140 ms where the onset gap and the pedal catch leave no more (lhair.py on final_before vs final). key_air validator |
| P RH fingering impossible | done | LEGATO_OVERLAP 30 ms, same-finger travel cost, pins honoured (0 drops, 0 broken states), re-voiced hats where no legal fingering existed (20, 27, 28, 33, 36, 42, 43), bar 8 thumb on white keys. finger_order / finger_travel / finger_pins validators |
| P build 50-51 thumb | done | C3 pinned %1 + preset_bass_fingers exemption: C2 on 5, C3 on 1 throughout |
| P climax pedalling 53/55/57/59 | done | re-catches on beat 3 in 53/55/57 (bass octave still held), 59 has its harmony change on 3 plus a flutter on beat 4 (passing G5 / F#5), apex doubling F5 ends at the beat-3 change |
| P final A bar 65 sigh | done | final A rewritten (no Am7 sigh bar); its bar 63 has a re-catch on 3 over a soft re-struck D2, so E4 / Bb4 do not ring under F4 |
| P tag -> final A seam | done | pickup (now C4) -30: v44 under the A4 v51 it leads to |
| O bridge 45-48 = My Funny Valentine | done | 45-46 line cliche kept; 47 Fm7/Ab -> Dbmaj7#11 (Neapolitan, Db falls to the C pedal), 48 G7sus4 -> G7b9 (no iio); 46-48 melody = the piece's cells (leap as a 5th, beta's sigh in minor onto the #11, the pocket in augmentation) |
IMPROVEMENTS
| item | status | note |
|---|---|---|
| L bar 16 pre-empts beta | done | held F5 over the sus, Ab5 on the dry stab; beta's first full statement is 18 |
| L outro loops | done | final A 2 bars (Dm9 / Gm7, A4 register), coda 65-67: 3:40.8 |
| L gamma at the chorus response | partly | gamma now only in pre 13-15 / 29-31 and the FIRST answers 19 / 35 (8 bars instead of 17); 23, 39, 55, 59 enter their own ways. Kept 19/35 on purpose: the originality reviewer assigned the flow pickup to the pre and the chorus answers, and the motif needs one home in the chorus; the verse no longer uses it, so 19 follows three uses, not six |
| L pocket washed out | done | groove half pedal CC64 60 over 17-40 (A/B on the render: backbeat jump +6.2 dB vs +5.0 dB with full pedal, low-end share 21-23 % vs 24-28 %, same loudness); ghosts +4 (27-32) as soft dyads, not octaves over the bass |
| L tag 61 plainest bar | done | the hook's own turn + pocket over I in octaves, LH tenor answer E3-F3-G3 |
| L bridge 43-44 square | done | 43 enters on the "&" of 1 |
| L My Bonnie skeleton | done | 21: a blue-note slide Gb5 -> G5 (one finger) inside the climbing pocket |
| L bar 45 label | done | Cm (no D sounds) |
| P final A = climax repeat | done | rewritten (see above) |
| P verse 1 has no goal | done | 12 peaks on a syncopated F5 (the verse's loudest note) |
| P gamma mannerism | done | see above |
| P groove articulation | done | half pedal (above) |
| P neighbours pedalled through | done | flutters on beat 3 of 17/21/33, on 10 (the tear), 59, 61, 65; pedal_clusters validator (0 unexplained pairs ringing >= 0.75 s; longest 0.48 s; 7 / 27 / 42 documented as chord-tone voicings) |
| P apex F6 above the dampers | done | F6 held to 3.5, E6 on 3.5, the F5 doubling cleared at the beat-3 change |
| P coda Ab4 vs G3 | done | RH Bb4 -> F4 only |
| P bar 34 counter | done | Bb3-C4-D4-F4-Eb4 against the falling tune |
| P HARM labels | done | 8:3 / 28:3 Eb7, 45 Cm, 32:3 Bb7, 52 C7(b9,b13), 64 Gm7 |
| P validators | done | key_air, finger_travel, finger_order, finger_pins, pedal_clusters (+ arrivals, FINGER-CROSS) |
| O tag payoff generic | done | see tag |
| O final A replays the climax | done | see final A |
| O gamma tic | done | see gamma |
| O Op. 9/2 guard | kept | every Eb hook statement keeps the UPWARD turn over IVmaj7; intro bar 1 left as is (the reviewer called it harmless) |
| O hats on even 16ths | done | odd-16th RH ghost dyads in 35, 39, 55, 59; checklist text corrected (the hats are straight 8th off-beats) |

## Final state (after fix round 2, session E)
- `music/afterglow_score.py` -> music/final/: 67 bars, 1131 notes, 3:40.8 to the last note-off, seed 20261021,
  TOTAL ISSUES 0 (DSL check, sketch extra_checks + rfiy_overlap, and every afterglow_checks validator incl. the
  fix-round-1 / 2 ones). Deterministic.
- Test renders (v1-v9) live only in the session scratchpad; build/audio was not touched. `music/render_audio.py`
  renders music/final/score.json by default.
- Still open (needs ears): human A/B listening against RFIY / Kiss the Rain / Someone Like You / All of Me
  (checklist 17); a listening pass on the groove half pedal (CC64 60) and the flutters.

## Fix round 2 (reviewer feedback round 2: pianist, listener, originality)

Session D started: sources and music/final backed up to scratchpad fix2/ (fix2/final_before). Items below are
ticked as they land.

Checkpoint D1 (sources edited, TOTAL ISSUES 0, 3:40.8, 1131 notes; docstrings / checklist text / final rolls / render
check still to do):
- [x] BLOCKING pianist LH air: `afterglow_lib.air_need()` is finger-aware (`pair_conflict()`: a held key must go when its
      finger is on the wrong side of a new key's finger - a legato thumb pass inside one melody / counter line excepted -
      or further from it than the pair spans comfortably, MAXC); `jump_air()` 50 ms <= 12 st, 100 ms 13-24 st. key_air
      uses the same rule, so the validator now sees these. Reviewer's own group-shift script (scratchpad airchk2.py): all
      listed LH spots now have >= 75 ms (14:8, 29-39:6, 38:9, 45:0, 47:8, 53:6/14, 55:4, 56:10, 57:14, 58:8, 63:8);
      what it still lists are legato top-voice connections (turn neighbours 4 -> 5 inside octave bars), not jumps.
- [x] BLOCKING pianist RH: 15 inner dyad pinned 1-2; 57 downbeat / 61 beat 3 and 4.5 / 62 beat 3 now get >= 75 ms by the
      same rule; 62 E5 on 3 over A4 C5 on 1-2; 65 rewritten (coda). LEGATO_OVERLAP no longer hides a crossing: a key
      that crosses or overstretches is released before the onset by air_pass.
- [x] climax: tenor answers in 54 (G-A | bass | Bb-C-D-E, contrary to F5 -> E5) and 58 (D4 -> C4 under the F6, then
      the bass takes the line C -> Bb -> A); 55 re-rhythmed (snare on the "&" of 2), 57 new (8th tenor climb D-F-A with
      the tune, push of the V root C2/C3 on the "&" of 4, flutter instead of the beat-3 re-catch); apex harmony
      C9sus4 (57:4.5) -> C7/Bb (58:3) -> Am7 (59): F6 is a real 4-3 over C
- [x] climax accents: 55 arch starts at the top + C6 +6 (C6 v110 > D5 push v100, E5 v101); 57:1 +8 (A5 v96 >= chorus 2
      head G5 v94)
- [x] outro: tag 62 without pickup; final A = verse head in F over vi + 9-8 sigh (no turn, no C -> A leap); coda = the
      intro's leap onto a held A5 (no turn), then A-G-F-Eb-Db-C stepwise into the last chord
- [x] verse 1: shared HEAD rhythm in 5 and 9, the 3+3+2 pocket planted in 7, 11 new (no C-Bb-C circling), tear kept
- [x] verse 2 pulled back: bass on 1 only, no ghosts, tenor sighs, full legato pedal (groove half pedal 17-24 and 29-40),
      melody / LH velocities lower; verse 2 head echoes verse 1's
- [x] chorus 2 lands with a new texture: the hook's head G5 in octaves at 33 (full octaves stay at 37-38)
- [x] build: tenor answer in 49 (Eb3 -> C4 -> Bb3, alpha's leap in augmentation), inner wedge C5-Bb4-A4-Ab4-G4 against
      the rising top, top line with the hook's turn (49-50), 51 G5 re-struck on 3, dyads start ~v50 and crescendo,
      BUILD_RAMP 0/6/10/16 (was 0/7/13/22)
- [x] pre 2 bar 31 breaks upward (Eb-F-G-Ab -> A5, the dim7's root) instead of copying bar 15
- [x] docstrings / checklist text, final rolls, render check (backbeat, build vs climax, verse 2 vs chorus 1): done in
      session E, see below

Session E (resume after a usage-limit kill; verified: a fresh run reproduces fix2/run9.txt byte for byte, TOTAL ISSUES 0,
3:40.8, 1131 notes; render v7 in the scratchpad predates the last arr edit):
- reviewer group-shift script (airchk2.py) on the D1 score: the LH shells still got only 80 ms where the HAND CENTRE moves
  12-16 st (14:8, 29-33:6, 38:9, 39:6, 53:6, 54:10, 56:10) because `hand_shift()` measured from the released key
  alone (D3 of [D3 F3 C4] is 10 st from the centre of [Bb1 Bb2])
- [x] `hand_shift(n, grp, src)` takes the larger of the key's and its chord centre's distance to the new keys' centre
      (src = keys of that hand struck within 100 ms, so rolled chords count as one position); air_pass and key_air use
      the same rule. Independent check (scratchpad heldchk.py): LH centre shifts > 12 st with < 100 ms air: 0 (was 9:
      14:8, 29-33:6, 38:9, 39:6, 53:6, 54:10; intro 4 -> 5 too); held keys with the wrong finger order at a new onset:
      2, both legato finger-over-thumb passes inside the verse melody (6:6 2-over-1, 8:6 3-over-1, 4-8 ms). 18:8,
      20:8, 36:8 (ghost -> Bb1) and the dry fills 20:13, 24:12 now get >= 100 ms. RH shifts > 7 st under 50 ms: only
      legato top voices (50:10 F5 4 -> G5 5, 51:1 repeated G5, 61 A5 4 -> Bb5 5 turn)
- [x] climax low end: the listener's Bb0-Bb1 at 57:1 REJECTED - research/music.md 5.11 sets the bass floor at F1 (Eb1
      once), and the texture validator enforces it; an open 5th Bb1-F2-Bb2 at 53:1 was tried and is mud (P4 under Bb2).
      Instead the step up comes from a lower riser: 52's LH octaves -5, MEL_RAMP build 20 -> 14, BUILD_RAMP 0/4/7/10.
      Velocity energy 51/52 -1.8/-1.9 dB vs climax 53 +2.9, 54 -0.7, 55 +2.5 (was -1.0/-0.3); the arrival A5 v107 vs
      the riser's top 88, LH v95 vs 69
- [x] snare-shell check after the air fix (render v8 vs v6, groove_ab2.py): chorus 1 backbeat jump +6.8 dB (v6 +6.6),
      tail at 300-380 ms -5.4 dB (v6 -5.2): as clear, a little crisper, not choppy; pre 2 + chorus 2 +4.8 dB (v6 +5.2,
      more counter / octave material around the shells), tail -6.0 dB; climax +6.6 dB (v6 +6.8)
- [x] verse 2 vs chorus 1 on render v8: -22.3 vs -19.7 dB (2.6 dB; bars 25/26 -23/-24 vs chorus bars -19/-20)
- [x] checklist text: groove half-pedal ranges (17-24 and 29-40), 13b hand-centre rule; docstrings (score FORM, arr
      climax / build notes, key_air)
- [x] determinism: two runs give byte-identical score.json / score.mid
- [x] rolls viewed again (build, climax, verse 2, chorus 1, final A, coda): climax tenor lines in 54 / 56 / 57 / 58, the
      bass C -> Bb -> A under the apex, verse 2 visibly thinner than chorus 1, the coda's single leap and stepwise fall
- [x] final render check v9 (scratchpad render/afterglow_v9.*, build/audio untouched): LUFS -16.0, true peak -1.2 dBTP,
      LRA 12.7 LU; arc intro -29.0, verse 1 -23.5, pre 1 -21.3, C1 -19.7, verse 2 -22.2, pre 2 -19.9, C2 -17.9, bridge
      -24.0, build -18.4, climax -15.7 (loudest), tag -18.9, final A -27.3, coda -32.4 dB; drops -49.5 / -49.1 dB before
      the pickups. Build vs climax per bar (sounding part): 49 -20.7, 50 -18.4, 51 -17.7, 52 -17.6 | 53 -14.8, 54 -16.6,
      55 -15.4, 56 -16.1, 57 -15.3: every climax bar is now louder than every build bar (v6/v7: 51/52 = 54), the arrival
      2.8 dB over the riser's loudest bar. Backbeat v9: chorus 1 +6.8 dB, pre 2 + chorus 2 +4.8 dB, climax +6.6 dB

### Reviewer items (fix round 2) - status
BLOCKING
| item | status | evidence |
|---|---|---|
| P LH key releases, no travel time (~20 spots + 18:8, 20:8, 36:8, 20:13, 24:12) | done | finger-aware air_need (D1) + hand-centre shift (E): every LH centre shift > 12 st has >= 100 ms where the onsets leave room; key_air validator uses the same rule (0 issues); LH jumps > 16 st median air 228 ms |
| P RH crossings / shifts without air (15, 57, 61, 62, 65) | done | 15 pinned 1-2; 57:1 80 ms; 61 beat 3 / 4.5 >= 75 ms; 62 E5 on 3 over A4-C5 on 1-2; 65 recomposed (5-4-3 descending); LEGATO_OVERLAP dropped wherever a finger crosses or the hand shifts |
IMPROVEMENTS
| item | status | note |
|---|---|---|
| L climax counterpoint (54, 58), 53/55/57 same LH | done | tenor answers 54, 56, 57, 58; 55 snare on the "&" of 2; 57 tenor climb + V-root push |
| L climax opens downward (Bb0) | rejected | the brief's bass floor is F1 (Eb1 once); the open 5th alternative is mud. The weight comes from bass octaves on every climax downbeat and the lowered riser |
| L C6 at 55 / A5 at 57 too soft | done | C6 v110 > D5 push v100; 57:1 A5 v96 >= chorus 2's G5 v94 |
| L outro restarts the hook three times | done | final A = verse head in F + 9-8 sigh; coda = the intro's leap alone; the full head only at the tag |
| L verse 1 least memorable | done | shared HEAD rhythm 5 / 9, the 3+3+2 pocket planted in 7, 11 new, the tear kept |
| L middle plateau | done | verse 2 pulled back (2.6 dB under chorus 1 on v9, was 1.8), chorus 2's head in octaves at 33 |
| L build almost as loud as the climax | done | see v9 per-bar numbers above |
| P apex bass inverted the sus | done | C2/C3 pushed on 57's "&" of 4, C -> Bb (58:3) -> A (59) |
| P ending loops the hook head | done | see outro |
| P 51 top G5 decays under the dyads | done | G5 re-struck on 3, dyads from ~v50 crescendo |
| P 49-50 stock riser | done | tenor answer (49), falling inner wedge |
| P pre 2 = pre 1 | done | 31 breaks upward to A5 |
| P re-run the gate, listen to the snare shells | done (measured) | 0 issues; backbeat numbers above; a human listen is still welcome |
| O hook head five times in the last 15 bars | done | 53, 57 (climax), 61 (tag) only; 63 / 65 use other cells |
| O build has no independent line | done | tenor answer, inner wedge, the hook's turn in the top line |
| O hook pitch outline ~ My Bonnie / Amazing Grace | no change (as the reviewer advised) | identity rests on the 3+3+2 rhythm, the upward turn and IVmaj9; 53 kept plain on purpose: it is the climax's restatement in the new key, 57 is the varied one |
| O human A/B listening | open | needs ears: verse 5-7 / 25-27 vs Kiss the Rain / Someone Like You; pre 13 / 29 vs All of Me |
