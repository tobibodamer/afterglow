# Afterglow, melody-first candidate: progress log

Run: `.venv\Scripts\python.exe music\candidates\melody\score.py`

## State at takeover (session 2)
- Inherited from the interrupted composer: lib.py (event language `ev`, LH pattern library, comp(), Viterbi
  fingering, release_before_leaps), chords.py (Eb / Cm / F tables), melodies.py (all 69 bars of melody),
  checks.py (playability / melody / structure / groove / texture validators), score.py (pattern-driven build).
- Bug fixed: `ev()` split chord tokens like `[Eb3 G3 C4]@2/14` on spaces; now tokenised with a regex.
- First full run after the fix: 3:46.1, 25 validator issues (22 "dry bass release": bass keys released before the
  legato pedal re-catches; 2 inner-motion gaps), textures thin (LH stabs far below, RH empty middle in the climax).

## Plan (session 2)
1. Keep the inherited melodies where they are good; rewrite the hook rhythm with a 3+3+2 pocket, add R&B
   variants in chorus 2, check every bar against the chords.
2. Replace the pattern-generated accompaniment with hand-written LH and RH-inner parts for all 69 bars
   (arr_*.py): voice-led shells, tenor countermelody (chorus 2), line cliche (bridge), octave pushes (climax).
3. Bass keys held until the pedal re-catches (min hold ~0.3 s); leap-aware releases for the rest.
4. Validators to 0, then the section-6 checklist twice.

## Milestones
- [x] takeover, bug fix, first run
- [x] melodies.py rewritten/revised (hook with 3+3+2 pocket, chorus-2 variants, climax 8th climb to F6,
      bridge bar 41 "Eb5 C5 G4" to avoid an Eb-D-Eb-D wobble after the deceptive cadence, bar 47 G5 on beat 3)
- [x] arr.py: all 69 bars of LH + RH-inner written by hand (no pattern generator)
- [x] score.py rewritten as an assembler; release_for_leaps (bass held until the pedal re-catches),
      fix_key_repeats (key rises before re-strike), checks.voice_leading (parallels, key conflicts)
- [x] validators: 0 issues (3:46.1, apex F6 at 79.9 %)
- [x] ear-proxy pass (scratchpad ear.py: melody vs everything ringing under the pedal): fixed the climax B1-B2
      approach grinding under the C pickup (now A1-A2), Am7 shells without E3 under the F5s (bar 55)
- [x] dynamics: pre-choruses/bridge pulled back so every chorus is a lift; apex F6 = 115
- [x] fingering solver improved (lib.py): melody line followed through comp chords, legato same-finger = 6,
      2-3 fourth comfortable, bass reached by a leap = 5 (octaves 5+1); chorus "hats" are 16th stabs;
      bars 8 / 40 runs pinned to standard Eb fingerings (no thumb on black)
- [x] score.py caches bar starts (DSL is O(bars^2) per call): full build + checks now ~4 s
- [x] checklist pass 1 (all 18 items pass on paper); revisions from it: bar 9 LH resolves Db4 -> C4 (7th of Eb7),
      NEW pedal-aware mud validator (checks.pedal_mud) found approach notes / walk-ups ringing against the bar's
      bass under the pedal -> PEDAL_FOLLOW list in score.py (extra legato change on each approach / walk note,
      dry lift for the 16th double approaches in bars 25, 28), ghost kicks under a 3rd moved to the low root,
      climax shells re-voiced (bar 54 [F3 Bb3]; bars 57-58 power-5th Bb1-F2 push). Back to 0 issues.
- [x] checklist pass 2 (ear proxy v2 in the scratchpad also checks chords struck UNDER a held melody note):
      bar 26 [F3 A3] -> [F3 Bb3] (m9 under Bb4); bar 28 Eb7 shell moved onto the melody's G (no resolution under
      the suspension); bar 43 tenor C4-Bb3 instead of G3 under Ab4; bar 58 no E under the F6 appoggiatura until it
      resolves; bar 20 approach G1 (not A1 under the Bb4 pickup); voicing rule widened to 80 ms so rolled chords
      obey it; final C5 v44 over a ~28 chord; coda melody 44-56. Kept on purpose: G3 two octaves under Ab5 in
      bar 47 (the line cliche's destination), the hook's Ab5 neighbour over the maj7 G3, Db6 (b9) over the C pedal.
- [x] score.py appends a measured SECTION-6 CHECKLIST block to checks.txt
- [x] final outputs written: 0 issues, 3:46.1, apex F6 at 79.9 %, 1178 notes, all fingered

## Section-6 review summary (pass 2)
1 hook pass | 2 motifs pass | 3 no loops pass (every LH bar hand-written; max verbatim 2-bar LH repeat 1x) |
4 inner motion pass (min 2 per 4 bars) | 5 bass line pass | 6 cadences pass | 7 arrivals pass (silences 0.59 s /
0.88 s; climax loudest, 113) | 8 on top pass | 9 breathing pass | 10 groove pass | 11 tempo pass (< 0.7 %) |
12 dynamics pass | 13 playability pass (+ key conflicts, pedal-aware mud) | 14 pedal pass (97 changes + 33
follow/drop marks) | 15 ending pass (6.2 s ring + 0.7 s ramp) | 16 duration pass | 17 originality: automated
pass, human A/B listening NOT done | 18 velocities pass (release samples / reverb are the renderer's job).

## If continuing
- Render audio (music/sampler.py) and LISTEN: hook singability, level of the RH "hats", the pedal-follow dips in
  the choruses (could feel choppy; alternative = half-pedal if the sampler supports continuous damping).
- Human A/B against RFIY, Kiss the Rain, Someone Like You, All of Me (checklist 17).
- Machine note: this box was heavily loaded by parallel agents; Git Bash calls stalled, PowerShell was reliable.
