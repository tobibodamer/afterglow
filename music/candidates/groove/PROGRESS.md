# Groove candidate: progress log

Lens: producer / groove (pocket + energy arc). Files in this folder:
- lib.py      Writer (16th-grid melody + event tokens, pedal-change bookkeeping), balance(), final_release(), fingering beam search (kept from the previous composer)
- checks.py   my validators (prominence, on-top, held span, leaps, fingers, pedal-at-change, dry bass, ghosts, swing, tempo, breathing, duration, apex, dynamics, inner motion, LH loop, sound-mud)
- sec_a.py    intro, verse 1, pre 1, chorus 1 (bars 1-24)
- sec_b.py    verse 2, pre 2, chorus 2 (bars 25-40)
- sec_c.py    bridge, build (bars 41-52)
- sec_d.py    climax, tag, final A, coda (bars 53-69)
- score.py    builds everything, performs, balances, fingers, writes outputs + checks

## Status
- [x] inherited lib.py / checks.py reviewed, kept
- [x] sec_a rewritten (session 2)
- [x] sec_b (verse 2 lazy walk, pre 2 harmony + dry fill, chorus 2 counter/octaves/deceptive)
- [x] sec_c (bridge half-time chorale, build riser)
- [x] sec_d (climax octave pushes + anticipations, tag, final A, coda + Friberg rit)
- [x] score.py runs end to end: first full draft 3:45.3, apex F6 80.3 %, 0 validator issues
- [x] revision 1: intro/bridge bass keys released before shells; dry fills tagged; ghosts 18-32; breathing fixes
      (chorus 2 bar 33 ornament, bridge bar 48, build bar 51 sustained top over 16th tremolo); pedal lifts under
      chromatic approach ghosts; mud-free voicings (0 sound-level mud spots); RH octaves fingered 1-5;
      tag melody rewritten (3-2-1-5) so alpha is not stated three times in a row; F6 = single loudest (115);
      final chord ring extended (+1.6 s fermata). State: 0 issues, 3:46.9, apex 79.8 %.
- [x] rolls viewed: verse1, chorus1, chorus2, bridge, build, climax (textures OK, contour arcs to F6)
- [x] checklist review pass 1 (all 18 items; 17 = automated part only, 18 = velocity part only). Fixes from it:
      climax LH pushed EVERY bar (downbeats lost) -> 2-bar push/land cycle; chorus 1 bars 21-22 had no
      anticipation -> bass push G1 in bar 22; chorus 2 was barely denser than chorus 1 and thinner than pre 2
      -> ghost 16th pairs + comping on 2/6/10 (5.65 -> 6.4 notes/s); new validators: drops (0.91 s / 1.25 s),
      anticipations per 2 chorus bars, final ring (7.0 s); apex F6 pinned to 110-115 and the loudest note.
- [x] analysis.py (new): melody vs ringing-accompaniment m2/m9 clashes + outer-voice parallels; score.py fails on
      any case not explained in INTENDED. Fixed: comp D5 under passing Eb5 (bars 23/39), Cm(add9) 9th a m9 under
      the m3 (bar 45 -> Eb4), E4/E5 under the climax's passing F5 (bar 59), E5 under F5 in the tag (bar 61),
      hook cadence Bb4 doubling the Bb bass (outer 8ves into Eb) -> Ab4.
- [x] checklist review pass 2 (all 18 items again, rolls intro/pre2/coda viewed). Fixes from it: LH bass
      fingering (5th finger on black-key bass; 132/162 low bass notes = 5, the rest are octave tops = 1 or
      approach pairs), thumb-on-black cost lowered for chords, comments updated. Determinism verified (two runs ->
      identical score.json / score.mid).
- FINAL STATE: 0 issues (DSL 0, sketch 0, groove+analysis 0); 3:46.9 to last note-off; F6 once at 79.8 %
      (vel 115, loudest); silences 0.91 s (before chorus 1) and 1.25 s (before climax); final ring 7.0 s.
- Open (not checkable here): human A/B listening vs RFIY / Kiss the Rain / Someone Like You / All of Me;
      render-side item 18 (release samples, reverb, clipping).
- NOTE: the Bash tool hangs on heredocs in this environment; use Edit + PowerShell.

## Notes / decisions
- Groove sections: RH melody AND RH inner share one laid-back offset (+14 ms) so a hand stays one unit; LH bass on grid, LH snare shells +8 ms, ghosts +3 ms.
- Arrangement: each section adds/removes one element (see score.py header).
