# Arranger candidate: progress log

Run: `.venv\Scripts\python.exe music\candidates\arranger\score.py`
(20-60 s, longer when the machine is loaded; the fingering beam search is the slow part)

## Files
- `score.py`: the piece, written by hand per section (one function per section, explicit `line()` tokens per voice).
- `arr_tools.py`: fingering solver (beam search over held keys), `tidy_releases` (key re-strike and legato-overlap
  releases), `balance` (mix pass: melody >= 12 above simultaneous accompaniment), `my_checks` (arranger
  validators), `review_checks` (section-6 checklist items: drops, ring, pedal gaps, bass line, anticipations,
  thumb on black keys, dynamics), `intended_leadsheet`.
- Outputs: score.json, score.mid, leadsheet.txt (detected + intended chords), checks.txt, report.txt,
  roll_01_intro.png ... roll_13_coda.png, roll_full.png.

## Status
- [x] Session 1 (interrupted): arr_tools.py; intro, verse1, pre1 drafted.
- [x] Session 2: all 69 bars written and wired to outputs.
- [x] Validators: DSL check 0, sketch extra_checks 0, arranger checks 0, checklist review checks 0.
      3:46.6 to last note-off; apex F6 once at 80.0 %; RFIY windows 0; +-1 oscillations 0.
- [x] Checklist pass 1: fixed coda dynamic range, bridge bar 42 line, added missing automated checks,
      intended chords in the leadsheet.
- [x] Checklist pass 2: verse-1 LH varied (bars 7, 10), chorus-2 bar 36 vocal turn, chorus-2 anticipation in
      33-34, bar 42 RH span, ghost velocity margin.
- [x] Final: determinism check (two runs give byte-identical score.json / score.mid), all 13 section rolls
      reviewed, 1090 notes all fingered. DONE. Open item: nobody has listened to a render yet
      (checklist item 17's A/B listening comparison and item 18's sound checks need music/sampler.py).
