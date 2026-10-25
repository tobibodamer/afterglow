"""AFTERGLOW - original solo piano piece (definitive score).

Run:   E:/experimentswithclaude/random/afterglow/.venv/Scripts/python.exe music/afterglow_score.py [--no-png]
Writes music/final/: score.json (performed, lead_in 0), score.mid, leadsheet.txt, checks.txt, report.txt,
                     roll_01_intro.png ... roll_13_coda.png, roll_full.png
Sources of truth: afterglow_melody.py (the tune, note by note), afterglow_arr.py (both hands' accompaniment, every
bar written out, plus the harmony timeline and the pedal plan), afterglow_lib.py (event language, shaping, fingering),
afterglow_checks.py (validators). Nothing is generated from patterns; nothing is imported from candidates/.

==================================================================================================================
FORM (67 bars, about 3:40 to the last note-off; fix round 1 cut final A from 4 bars to 2; fix round 2 re-composed
verse 1's phrase heads, verse 2's texture, pre 2's third leg, the build's inner lines, the climax's LH, final A and coda,
and made every key release finger- and hand-centre-aware for the animation)
------------------------------------------------------------------------------------------------------------------
 bars   section   key   tempo (bpm)        feel / texture                       what it adds (+) or removes (-)
  1-4   intro     Eb    68 -> 60, free     rolled blooms, the hook only hinted  leap + sigh only; stops on a 9th,
                                                                                fermata on the rolled Bb9sus4
  5-12  verse 1   Eb    76, rubato         ballad, melody leads by 18 ms         + stepwise bass, moving tenor;
                                                                                one HEAD rhythm (5, 9), the pocket
                                                                                planted once (7), peak F5 in 12
 13-16  pre 1     Eb    76 -> 78           8th shell pulse, 3-strike flow       + pulse; dry stab + DROP (~1 s)
 17-24  chorus 1  Eb    78 steady, 56 %    boom-bap stride, RH hats, mel +14 ms + GROOVE; half pedal; elides into
                                                                                verse 2
 25-28  verse 2   Eb    78, 57 %           lazy, bass on 1 only, full pedal     - hats, - ghosts, - half pedal;
                                                                                tenor sighs; falling-sixth opening
 29-32  pre 2     Eb    78, 57 %           backing vocal in RH 3rds, ghosts     + harmony line; the third leg
                                                                                breaks upward to A5; dry LH fill
 33-40  chorus 2  Eb    78, 58 %           tenor countermelody, octaves 37-38   + head in octaves (33), counter,
                                                                                odd-16th ghost dyads;
                                                                                the sus Eb is held over: deceptive
 41-48  bridge    Cm    74 -> 72, rubato   half-time chorale, straight          - groove, - swing; new tune, a
                                                                                Neapolitan Db (47)
 49-52  build     C ped 74 -> 80 accel.    rhythm doubles every bar, sweep      riser: tenor answer (49), inner
                                                                                wedge falling C-Bb-A-Ab-G against
                                                                                the rising top; dry hit + DROP
 53-60  climax    F     80, 56 %, tight    octave melody, LH push/land cycle    + octaves, tenor answers (54, 56,
                                                                                57, 58); the one apex F6 over the
                                                                                V root, bass C -> Bb -> A
 61-62  tag       F     77 -> 68           first fortissimo tonic, decaying     the hook's leap, turn and pocket
                                                                                land on I
 63-64  final A   F     66 -> 64, free     a memory: the VERSE head over vi     - everything (vi9, ii7); a 9-8
                                                                                sigh, no hook turn
 65-67  coda      F     64 -> Friberg rit  IVmaj9 -> ivm6 -> Iadd9              the intro's leap onto a held A5,
                                                                                then A-G-F-Eb-Db-C; minor-plagal
                                                                                close, the b6 tied over, 6+ s ring

KEYS: Eb major (verses/choruses) -> C minor (relative minor, entered by the deceptive V -> vi of chorus 2) ->
      a C pedal (C minor's tonic reheard as V of F) -> F major (up a whole step) for the climax and the ending.

TEMPO MAP: see TEMPO / FERMATAS below. Groove sections hold their tempo within 1 %; ballad sections breathe
      (phrase rubato: ~2-4 % push toward the phrase peak, 8-16 % relax over the last beat). Final ritardando:
      Friberg & Sundberg v(x) = [1 + (w^q - 1) x]^(1/q), w = 0.6, q = 2.5 over bars 65-66, then a slow last bar.

MOTIF PLAN (every melody is built from three cells)
  alpha "leap and turn": 5 -> 3 pickup (a rising major 6th, Bb4 -> G5), held 3rd, upper-neighbour 3-4-3,
        then a 3+3+2 "pocket" fall (dotted 8th, dotted 8th, 8th): the hip-hop tresillo inside a pop hook.
  beta  "sus sigh": the sus4 struck on the "&" of 1 over V (an appoggiatura), resolving to V's 3rd on beat 3.
  gamma "flow pickup": rest on the downbeat, repeated-note 16ths climbing by step, like a rap / R&B pickup. It belongs
        to the pre-choruses and the first answer of each chorus; everything else enters its own way (fix round 1).
  Where they appear:
   intro 1-4      alpha's leap alone (1), beta alone (2), the leap echoed as a 5th (3); stops on the 9th
   verse 1/2      the verse HEAD (8th rest, two 16ths, a long note on beat 2, three 8ths: a broken rising sixth to
                  Eb5 = alpha's leap filled in) opens 5 and 9; 7 plants the 3+3+2 pocket once; the tear Cb5 (10);
                  the peak F5 syncopated (12); verse 2 opens with alpha inverted (Eb5 -> G4) and climbs back
                  through the head's pickup (25)
   pre 1/2        gamma sequenced up by step (13-15, 29-30), the landing held over the sus; pre 2's third leg
                  (31) breaks out upward to A5
   chorus 1/2     the full hook: alpha (17/21/33/37), beta (18 = its first full statement, 34), gamma (19/35),
                  tied / long-downbeat answers (23/39), C6 apex in beta's slot
   bridge         beta's slot holds the #11 (42), the augmented 2nd B-Ab (44), alpha's leap as a minor 6th (45) and a
                  5th (46), beta's sigh in minor onto the Neapolitan's #11 (47), the pocket in augmentation (48)
   build          the 3+3+2 pocket becomes the rising top line Eb-F-G-Ab with the hook's turn (49-50); alpha's
                  leap in augmentation in the tenor (49); an inner wedge falls C5-Bb4-A4-Ab4-G4 against it; the Ab
                  (b13) -> A at 53 = sunrise
   climax         the hook in F, octaves; tenor answers (54, 56, 57, 58); bar 57 climbs in 8ths into the one F6, a
                  real 4-3 over the pushed V root (beta at the peak), the bass falling C -> Bb -> A under it
   tag            the hook's leap, turn and pocket (C5 -> A5 Bb5 A5 G5 F5 C6) finally land on I: until now the leap
                  always landed on IV (as IV's maj7). The last full hook head of the piece
   final A, coda  a memory of the VERSE head over vi with a 9-8 sigh (no turn, no leap); the coda says alpha the
                  way the intro did (the leap alone, onto a held A5), then falls A-G-F-Eb-Db by step, Db5 (b6) tied
                  over the bar line -> C5 over IV -> iv -> I
==================================================================================================================
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from afterglow_lib import (Score, Note, ROOT, P, pname, ev, octave_double, shape_melody, straighten_kicks,  # noqa: E402
                           apex_shape, final_pedal_ramp, release_for_leaps, fix_key_repeats, voicing_pass,
                           assign_fingers, preset_bass_fingers, preset_octave_fingers, mark_presets, air_pass,
                           cap_pedal, flutter)
import afterglow_melody as M  # noqa: E402
import afterglow_arr as A  # noqa: E402
import afterglow_checks as K  # noqa: E402

OUT = os.path.join(HERE, "final")
SEED = 20261021
LAST_BAR = 67

# per-voice micro-timing (ms) in the groove sections: the bass stays on the grid, the shells ("snare") and RH hats
# sit a little late, the melody is laid back (verse 2 lazier, the climax tighter); the build pushes forward
GROOVE = {"mel": 14, "inner": 10, "acc": 7, "counter": 6, "bass": 0, "ghost": 3}
LAZY = {"mel": 19, "inner": 16, "acc": 12, "counter": 9, "bass": 0, "ghost": 4}
TIGHT = {"mel": 9, "inner": 8, "acc": 5, "counter": 5, "bass": 0, "ghost": 2}
BUILD = {"mel": -6, "inner": -3, "acc": 0, "counter": 0, "bass": 0, "ghost": 0}


def V(mel, inner, acc, bass, ghost=24, counter=None):
    return dict(mel=mel, inner=inner, acc=acc, bass=bass, ghost=ghost, counter=counter or acc + 4)


# name, first bar, last bar, swing, rubato, micro-timing, groove?, velocities, melody bars, melody range, humanize
SECTIONS = [
    ("intro", 1, 4, 0.50, 0.9, None, False, V(50, 26, 27, 34), M.INTRO, ("Bb4", "G5"), 1.0),
    ("verse1", 5, 12, 0.51, 0.5, None, False, V(58, 32, 34, 42), M.VERSE1, ("F4", "F5"), 1.0),
    ("pre1", 13, 16, 0.53, 0.3, None, False, V(61, 37, 40, 47), M.PRE1, ("Bb4", "Ab5"), 1.0),
    ("chorus1", 17, 24, 0.56, 0.04, GROOVE, True, V(76, 45, 48, 57, 31), M.CHORUS1, ("Bb4", "C6"), 0.8),
    ("verse2", 25, 28, 0.57, 0.04, LAZY, True, V(62, 37, 40, 48, 28), M.VERSE2, ("F4", "F5"), 0.8),
    ("pre2", 29, 32, 0.57, 0.04, GROOVE, True, V(69, 43, 47, 55, 31), M.PRE2, ("Bb4", "A5"), 0.8),
    ("chorus2", 33, 40, 0.58, 0.04, GROOVE, True, V(84, 52, 54, 63, 32, 58), M.CHORUS2, ("Bb4", "C6"), 0.8),
    ("bridge", 41, 48, 0.50, 0.6, None, False, V(60, 34, 38, 45), M.BRIDGE, ("G4", "Ab5"), 1.0),
    ("build", 49, 52, 0.50, 0.0, BUILD, False, V(72, 52, 52, 54), M.BUILD, ("C4", "Ab5"), 0.6),
    ("climax", 53, 60, 0.56, 0.03, TIGHT, True, V(95, 68, 70, 80, 32, 72), M.CLIMAX, ("C5", "F6"), 0.8),
    ("tag", 61, 62, 0.50, 0.4, None, False, V(98, 64, 62, 74), M.TAG, ("E5", "C6"), 1.0),
    ("finalA", 63, 64, 0.50, 0.9, None, False, V(50, 24, 25, 30, 20), M.FINAL_A, ("A4", "F5"), 1.0),
    ("coda", 65, 67, 0.50, 0.9, None, False, V(53, 25, 25, 30, 20), M.CODA, ("C5", "Bb5"), 1.0),
]

# the arrival phrases (17, 33, 53) start at the TOP of their arch and decay (fix round 1: the arch used to start
# each chorus at 0.9 x, so the arrival was softer than the riser / pre-chorus before it). peak 0.0 exactly: the DSL's
# arch is sin(x / peak) below the peak, so any peak > 0 puts the downbeat itself back at the bottom (0.9 x)
PHRASES = [(1, 4, .55), (5, 8, .62), (9, 12, .62), (13, 16, .75), (17, 18, 0.0), (19, 20, .45), (21, 24, .5),
           (25, 28, .62), (29, 32, .75), (33, 34, 0.0), (35, 36, .45), (37, 40, .5), (41, 44, .6), (45, 48, .55),
           (49, 52, .95), (53, 54, 0.0), (55, 56, 0.0), (57, 60, .35), (63, 64, .4), (65, 67, .3)]
TEMPO = [(1, 1, 68), (4, 3, 60), (5, 1, 76), (13, 1, 76), (16, 3, 78), (17, 1, 78), (40, 4, 78), (41, 1, 74),
         (48, 4, 72), (49, 1, 74), (52, 1, 80), (53, 1, 80), (60, 4, 80), (61, 1, 77), (62, 4, 68), (63, 1, 66),
         (64, 4, 64), (65, 1, 64), (66, 4.99, 64), (67, 1, 38.4)]
FINAL_RIT = (65, 66, 0.6, 2.5)                     # bars, w, q
FERMATAS = [(4, 4, 1.2), (16, 4, 0.2), (52, 4, 0.5), (62, 3, 0.6), (67, 4, 1.8)]
# no gain step INTO an arrival: the pre's lift is held through the downbeat and relaxes over the arrival bar
DYN = [(1, 1, 1.0), (13, 1, 1.0), (16, 3, 1.06), (17, 1, 1.06), (18, 1, 1.0), (29, 1, 1.0), (32, 4, 1.04),
       (33, 1, 1.04), (34, 1, 1.0), (40, 3, 1.0), (40, 4.75, 0.84), (41, 1, 1.0), (45, 1, 0.98), (47, 2, 1.07),
       (48, 4, 0.98), (49, 1, 1.0), (61, 1, 1.0), (62, 4, 0.78), (63, 1, 1.0)]
MEL_RAMP = {"pre1": 8, "pre2": 6, "build": 14, "tag": -10, "finalA": -4, "coda": -16}   # build 20 -> 14 (session E)
# hand-placed accents on top of the shaped contour: (bar, beat) -> velocity change
MEL_ACCENT = {(52, 4.5): -14,                       # the climax pickup comes out of the silence, not at
              #                                      the riser's peak
              (17, 1): +4,                         # the arrivals (with their arches' tops): each downbeat beats the
              #                                      peak before it (33 and 53 need no accent: about 97 and 104)
              (15, 4.5): -4,                       # pre 1's F5 landing (held over the sus) stays under the arrival
              (51, 4): -4, (52, 3): -6,            # the riser's top Ab5s stay under the climax's A5
              (63, 2): +3, (63, 3.5): -4, (63, 4.5): -4,  # final A: the head's F5 leads, its 9-8 sigh recedes
              (5, 2): +5, (9, 2): +4,              # fix round 2: the verse HEAD's long Eb5 anchors phrases a and b
              (65, 4.5): -4,                       # the coda's fall: F5 stays under the A5 it falls from
              (10, 1.5): +2,                       # the tear: Cb5 over Abm6
              (23, 3): +4, (39, 3): +3,            # the chorus's one chromatic note, E natural
              (55, 1): +6,                         # fix round 2: the climax's long C6 sings over the push after it
              #                                      (with its phrase arch starting at the top, like the arrivals)
              (57, 1): +8,                         # the climax's second hook head never dips under chorus 2's
              (66, 3): +6}                         # the coda's Db5: the b6 leans before it sinks to C
BUILD_RAMP = {49: 0, 50: 4, 51: 7, 52: 10}         # build crescendo added to bass / acc / inner (fix round 2: lower,
#                                                   so the step up into the climax is unmistakable; session E: render v8
#                                                   still had bars 51/52 at the level of climax bar 54 -> 0/4/7/10)
OCTAVE_BARS = {37, 38} | set(range(53, 62))         # 61: the hook's turn and pocket over I, in octaves
DROPS = [(16, 3.0, 17), (52, 3.25, 53)]            # (bar, beat of the pedal lift, bar the drop leads into)
ARRIVALS = [17, 33, 53]                            # downbeats that must beat the peak before them

# dissonances written on purpose (bar -> reason). checks.clashes() lists every melody m2/m9 against a still-ringing
# accompaniment note; anything in a bar not listed here is an issue.
INTENDED = {
    19: "passing 16th Eb5 between F5 and D5 over Gm7 (against the snare shell's D4, two octaves down)",
    24: "dry chromatic walk-up D2 under the tied sus Eb5, resolving to Eb2 on the next downbeat (the elision)",
    35: "passing Eb5s inside the gamma run over Gm7 (against the snare shell's D4)",
    44: "Ab4 = b9 of G7b9, the bridge's harmonic-minor colour (B4 -> Ab4, the augmented 2nd)",
    52: "Db5 = b9 of C7b9 in the build's sweep over the C pedal",
    33: "the hook's upper-neighbour 16th Ab5 over the head's octave doubling G4 (fix round 2: chorus 2's head in "
        "octaves)",
    53: "the hook's upper-neighbour 16th Bb5 over its own octave doubling A4 (the shell leaves out A)",
    57: "the hook's upper-neighbour 16th Bb5 over its own octave doubling A4 (the shell leaves out A)",
    59: "passing 16th G5 between F#5 and A5 over D7b9's 3rd F# (the LH's F#3)",
    61: "the hook's upper-neighbour 16th Bb5 over its own octave doubling A4 (the tag: the turn lands on I)",
    46: "the line cliche's B3 (Cm(maj7)) is still under the pedal for the first ~0.1 s of the melody's C5 on Cm7's "
        "downbeat; the legato change clears it (B3 -> Bb3 is the cliche itself)",
}
# semitone pairs that ring together by the pedal on purpose (checks.pedal_clusters): both are chord tones
INTENDED_CLUSTERS = {
    7: "D5 and Eb5 = Cm9's 9th and 3rd (the melody climbs through the chord; the m9 voicing)",
    27: "D5 and Eb5 = Cm9's 9th and 3rd (verse 2's run through the chord)",
    42: "D5 and Eb5 = Abmaj7#11's #11 and 5th (the Lydian fall ends on the #11)",
}


def _speed_up(s, n_bars=72):
    """The DSL recomputes bar starts by summation on every call; every bar here is 4/4, so cache them on this
    instance (music/dsl.py itself is not modified)."""
    import bisect
    starts = [0.0]
    for b in range(1, n_bars + 2):
        starts.append(starts[-1] + s.beats_in(b))
    s.bar_start = lambda bar: starts[bar - 1] if 1 <= bar <= n_bars + 1 else sum(s.beats_in(b) for b in range(1, bar))
    s._bar_of = lambda beat: max(1, bisect.bisect_right(starts, beat + 1e-9))


def sec_of_bar(bar):
    return next(x for x in SECTIONS if x[1] <= bar <= x[2])


def build():
    s = Score("Afterglow", bpm=76, seed=SEED)
    _speed_up(s)
    for b, bt, bpm in TEMPO:
        s.tempo(b, bt, bpm)
    s.final_rit(FINAL_RIT[0], FINAL_RIT[1], w=FINAL_RIT[2], q=FINAL_RIT[3])
    for b, bt, x in FERMATAS:
        s.fermata(b, bt, x)
    for b, bt, g in DYN:
        s.dyn(b, bt, g)
    for b0, b1, pk in PHRASES:
        s.phrase(b0, b1, peak=pk)
    for name, b0, b1, sw, rub, offs, grv, vel, mel, rng, hum in SECTIONS:
        s.section(name, b0, b1, swing=sw, rubato=rub, offsets_ms=offs, humanize=hum)

    # harmony timeline -> a legato pedal change at every harmony change (a lift where the change is a dry stab)
    timeline = []
    for bar, beat, sym, roman in A.HARM:
        name = sec_of_bar(bar)[0]
        timeline.append((s.pos(bar, beat), sym, roman, name, bar, beat))
        s.pedal(bar, beat, "up" if (bar, beat) in A.LIFT_AT_CHANGE else "change")
    for bar, beat in A.PEDAL_RECATCH:
        s.pedal(bar, beat, "change")
    for bar, beat in A.PEDAL_DRY:
        s.pedal(bar, beat, "up")
    s.pedal(LAST_BAR + 1, 1, "up")
    timeline.sort(key=lambda x: x[0])
    s._timeline_chords = timeline

    # the tune: one continuous line, so ties run across section boundaries (24 -> 25, 40 -> 41)
    bars = []
    for x in SECTIONS:
        bars += x[8]
    s.line("R", 1, " | ".join(bars), voice="mel", vel=64)
    for name, b0, b1, sw, rub, offs, grv, vel, mel, rng, hum in SECTIONS:
        shape_melody(s, b0, b1, vel["mel"], ramp=MEL_RAMP.get(name, 0))
    for (bar, beat), dv in MEL_ACCENT.items():
        for n in s.notes:
            if n.voice == "mel" and abs(n.beat - s.pos(bar, beat)) < 1e-6:
                n.vel = int(max(10, min(124, n.vel + dv)))
    octave_double(s, OCTAVE_BARS, vel_drop=16, min_dur=0.5, skip=(round(s.pos(60, 4.5), 3),))   # lone C5 pickup
    # fix round 2: chorus 2 lands with a new texture - the hook's head (33:1 G5) alone in octaves (full octaves at 37)
    for n in [m for m in s.notes if m.voice == "mel" and abs(m.beat - s.pos(33, 1)) < 1e-6]:
        s.notes.append(Note(n.pitch - 12, n.beat, n.dur, max(10, n.vel - 16), "R", "inner", tags=["oct"]))
    for n in list(s.notes):
        if "oct" in n.tags and abs(n.beat - s.pos(58, 1.5)) < 1e-6:  # the apex's doubling F5 lets go at the beat-3
            n.dur = s.pos(58, 3) - n.beat           # change: the sus is cleared before E5 / E6 (F6 has no damper)
        if "oct" in n.tags and abs(n.beat - s.pos(59, 3)) < 1e-6:    # 59's F#5 is single, inside the RH chord, so
            s.notes.remove(n)                       # the run F#5-G5-A5 is fingered 3-4-5 (no 4-over-5 crossing)

    # both hands' accompaniment, written out bar by bar
    for name, b0, b1, sw, rub, offs, grv, vel, mel, rng, hum in SECTIONS:
        for bar in range(b0, b1 + 1):
            v = dict(vel)
            if name == "build":
                k = BUILD_RAMP[bar]
                v.update(bass=vel["bass"] + k, acc=vel["acc"] + k, inner=vel["inner"] + k)
            if bar in A.LH:
                ev(s, "L", bar, A.LH[bar], v)
            if bar in A.RH:
                ev(s, "R", bar, A.RH[bar], v)

    # notes after a dry lift (phrase-end fills, drops) are played dry on purpose
    for bar, beat in list(A.PEDAL_DRY) + [(b, bt) for b, bt in A.LIFT_AT_CHANGE]:
        b0, b1 = s.pos(bar, beat) - 0.3, s.bar_start(bar + 1)
        for n in s.notes:
            if b0 <= n.beat < b1 and n.hand == "L":
                n.tags.append("dry")

    release_for_leaps(s, "L")
    release_for_leaps(s, "R", near=12, far=12, gap_near=0.125, gap_far=0.125, keep_voices=("mel",))

    preset_bass_fingers(s)
    preset_octave_fingers(s)
    mark_presets(s)
    s.perform(lead_in=0.0)
    total = max(n.beat + n.dur for n in s.notes) + 8
    tb, ts = s._beat_to_sec_table(total)
    s._b2s = lambda b: float(np.interp(b, tb, ts))
    moved = straighten_kicks(s, [x[0] for x in SECTIONS])
    fix_key_repeats(s)
    assign_fingers(s)
    groove_pedal(s)
    flutters(s)
    short, accel = air_pass(s)        # true key releases: travel time for every finger / hand jump
    last = max((n for n in s.notes if n.voice == "mel"), key=lambda n: n.t_on)
    last.vel = 42                     # the home note C5: soft, but clearly the voice on top of the last chord
    apex, capped = apex_shape(s, lo=114, hi=115)      # the one F6: the loudest note of the piece
    adj = voicing_pass(s)
    final_pedal_ramp(s)
    half_pedal_final(s)
    s._post = dict(kicks_straightened=moved, apex_capped=capped, voicing_adjusted=adj, keys_released_for_air=short,
                   pedal_changes_accelerated=accel)
    return s


def groove_pedal(s):
    """Choruses: the pedal goes down only to CC64 = A.GROOVE_PEDAL (inside the sampler's 32-76 half-pedal zone), so the
    snare shells, hats and ghosts read as hits (released strings decay in about 1-2 s) while the bass still carries.
    The window ends just after the next section's first change starts, so there is no slow rise back to full."""
    for b0, b1 in A.GROOVE_PEDAL_BARS:
        cap_pedal(s, s._b2s(s.bar_start(b0)) - 0.02, s._b2s(s.bar_start(b1 + 1)) + 0.05, A.GROOVE_PEDAL)


def flutters(s, hold=0.14):
    """Half-pedal flutters on the turns of the quiet hooks (A.HALF_FLUTTER): just after the note that follows the
    upper-neighbour turn, the dampers touch the strings (CC64 `depth`) so the released neighbour stops ringing."""
    for bar, beat, depth in A.HALF_FLUTTER:
        b = s.pos(bar, beat)
        m = next(n for n in s.notes if n.voice == "mel" and abs(n.beat - b) < 1e-6)
        flutter(s, m.t_on + 0.06, depth=depth, hold=hold)


def half_pedal_final(s, depth=44, hold=0.24):
    """The last chord's 4-3 (tenor Bb3 -> A3), 9-3 (RH G4 -> A4) and b6-5 (Db5 -> C5) resolve under the pedal: a quick
    half-pedal flutter just after beat 2 lets the dampers touch the released Bb3 / G4 / Db5 strings (and only graze
    the long F1 string) while the held keys ring on. CC64 44 is inside the sampler's half-pedal zone (32-76)."""
    st = s.bar_start(LAST_BAR)
    a4 = next(n for n in s.notes if n.hand == "R" and n.pitch == P("A4") and abs(n.beat - (st + 1.0)) < 1e-6)
    t = a4.t_on + 0.10
    pc = [p for p in s.pedal_curve if not (t - 1e-6 <= p[0] <= t + hold + 0.2)]
    pc += [(round(t, 4), 127), (round(t + 0.07, 4), depth), (round(t + 0.07 + hold, 4), depth),
           (round(t + 0.17 + hold, 4), 127)]
    s.pedal_curve = sorted(pc)


def section_meta(s):
    return [dict(name=name, b0=s.bar_start(b0), b1=s.bar_start(b1 + 1), groove=grv,
                 mel_range=(P(rng[0]), P(rng[1])), swing=sw)
            for name, b0, b1, sw, rub, offs, grv, vel, mel, rng, hum in SECTIONS]


def run_checks(s):
    secs = section_meta(s)
    changes = [(b, sym, sec) for b, sym, roman, sec, bar, beat in s._timeline_chords]
    drops = [(s.pos(b, bt), s.pos(nxt, 1)) for b, bt, nxt in DROPS]
    lines = []
    tl = s.timeline
    dur = max(n.t_off for n in s.notes)
    lines.append(f"AFTERGLOW (definitive score)  seed={SEED}  notes={len(s.notes)}  last note-off {dur:.2f}s "
                 f"= {int(dur // 60)}:{dur % 60:04.1f}")
    lines.append("SECTIONS")
    for sec in tl["sections"]:
        lines.append(f"  {sec['name']:8s} bars {sec['bar_start']:2d}-{sec['bar_end']:2d}  {sec['t_start']:7.2f} - "
                     f"{sec['t_end']:7.2f} ({sec['t_end'] - sec['t_start']:5.1f}s)")
    total = 0
    dsl_issues = s.check()
    total += len(dsl_issues)
    lines.append(f"\n[DSL Score.check()] {len(dsl_issues)} issues")
    lines += ["  " + x for x in dsl_issues[:60]]
    sys.path.insert(0, os.path.join(ROOT, "sandbox", "music-research"))
    import sketch
    ex, weak6 = sketch.extra_checks(s)
    hits, osc = sketch.rfiy_overlap(s)
    lines.append(f"\n[sketch.extra_checks] {len(ex)} issues; melody onsets < 6 vel above accompaniment: {weak6}")
    lines += ["  " + x for x in ex[:60]]
    lines.append(f"[sketch.rfiy_overlap] RFIY 4-interval window matches: {len(hits)}; +-1 neighbour oscillations: {osc}")
    total += len(ex) + weak6 + len(hits) + osc
    snd = K.Sound(s)
    blocks = [("playability", K.playability(s)), ("fingering", K.fingering(s)), ("melody", K.melody(s, secs)),
              ("structure", K.structure(s, secs, changes, drops, A.LIFT_AT_CHANGE)),
              ("pedal-policy", K.pedal_policy(s, changes, A.DRY_BARS, A.PEDAL_RECATCH)),
              ("groove", K.groove(s, secs)), ("texture", K.texture(s, secs, changes=changes)),
              ("voice-leading", K.voice_leading(s, secs, OCTAVE_BARS)), ("parallels", K.parallels(s, OCTAVE_BARS)),
              ("pedal-mud", K.pedal_mud(s, snd)), ("clashes", K.clashes(s, INTENDED, snd)),
              ("arrivals", K.arrivals(s, [d[2] for d in DROPS], ARRIVALS)), ("density", K.density(s)),
              ("key-air", K.key_air(s)), ("finger-travel", K.finger_travel(s)),
              ("finger-order", K.finger_order(s)), ("finger-pins", K.finger_pins(s)),
              ("pedal-clusters", K.pedal_clusters(s, snd, INTENDED_CLUSTERS)),
              ("originality", K.originality(s))]
    for title, (iss, info) in blocks:
        total += len(iss)
        lines.append(f"\n[{title}] {len(iss)} issues")
        lines += ["  " + x for x in iss[:80]]
        lines += ["  info: " + x for x in info]
    lines.append(f"\npost passes: {s._post}")
    lines.append("\nMELODY STATS (sketch.melody_stats)")
    for k, v in sketch.melody_stats(s).items():
        lines.append(f"  {k:8s} {v}")
    lines.append("\nswing / rubato / micro-timing per section")
    for name, b0, b1, sw, rub, offs, grv, *_ in SECTIONS:
        lines.append(f"  {name:8s} swing {sw:.2f} rubato {rub:.2f} groove {grv} offsets {offs}")
    lines += checklist(s, hits, osc)
    lines.append(f"\nTOTAL ISSUES: {total}")
    return total, "\n".join(lines)


def checklist(s, hits, osc):
    """research/music.md section 6, with the measured evidence where a number exists; the written review of each
    item (both passes) is in PROGRESS_final.md."""
    ns = sorted(s.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    dur = max(n.t_off for n in ns)
    T = {x["name"]: x for x in s.timeline["sections"]}
    snd = K.Sound(s)

    def silence_before(bar):
        b0 = s.bar_start(bar)
        pick = min((n for n in mel if b0 - 0.6 <= n.beat < b0 + 0.01), key=lambda n: n.beat)
        before = [n for n in ns if n.t_on < pick.t_on - 0.05]
        last = max(max(n.t_off for n in before),
                   max(min(snd.end_binary(n), pick.t_on) for n in before if n.pitch <= 87))
        return pick.t_on - last
    vmax = {k: max([n.vel for n in mel if v["t_start"] - .05 <= n.t_on < v["t_end"] - .05] or [0]) for k, v in T.items()}
    apex = max(mel, key=lambda n: n.pitch)
    last = mel[-1]
    ped_up = max(t for t, v in s.pedal_curve if v >= 120)
    gh = [n.vel for n in ns if n.voice == "ghost"]
    out = ["\nSECTION-6 CHECKLIST (measured evidence; written review in PROGRESS_final.md)"]
    out.append("  1 hook: bars 17-18 = Bb4 -> G5 (M6) held, G-Ab-G turn, 3+3+2 fall F5-Eb5-C5 | Bb4 -> Eb5 sus on the "
               "'&' of 1 -> D5 on 3. Heard: intro 1-2 (leap, sigh only), C1 17/21, C2 33 (head in octaves) / 37 "
               "(octaves), climax 53/57, tag 60-61 (leap, turn and pocket land on I: the last full head), coda 64-65 "
               "(the leap alone, as in bar 1)")
    out.append("  2 motifs: gamma in pre 13-15/29-30 and the first chorus answers 19/35 only (31 breaks out upward); "
               "beta in 18/34/54, bridge 42 (#11 in beta's slot) and 47 (in minor), climax apex 58, final A's 9-8 sigh "
               "63; alpha's leap filled in by the verse HEAD (5, 9, 25, final A 63), as a m6 in bridge 45, a 5th in 46, "
               "a P5 in intro 3, inverted at verse 2's start (25), augmented in the build's tenor (49); the 3+3+2 "
               "pocket planted in verse 7, the build's top line 49-51 and augmented in bridge 48")
    out.append("  3/4/5 loops, inner motion, bass line: see [texture] info above")
    out.append("  6 cadences: half (16 V, dry stab + drop), elided authentic (24 -> 25, Eb5 tied over), deceptive "
               "(40 -> 41: the sus Eb5 held over becomes Cm's 3rd), C pedal = V of F (49-52), minor plagal "
               "Bbmaj9 -> Bbm6 -> Fadd9 (65-67, Db5 tied over the bar line -> C5)")
    out.append(f"  7 arrivals: silence before chorus 1 {silence_before(17):.2f}s, before the climax "
               f"{silence_before(53):.2f}s; apex {pname(apex.pitch)} once at {apex.t_on:.1f}s = "
               f"{apex.t_on / dur * 100:.1f}% v{apex.vel}; loudest section = {max(vmax, key=vmax.get)}")
    out.append("  8 melody on top: see [melody] prominence / NOT ON TOP / RUB above")
    out.append(f"  9 breathing: see [melody] BREATH (every bar has a rest >= 1/2 beat or a note >= 1.5 beats)")
    out.append(f" 10 groove: swing 0.56-0.58 (choruses, verse 2, pre 2), 0.56 climax; ghosts {min(gh)}-{max(gh)} "
               f"({len(gh)}), LH ghosts as soft dyads (octave + 5th), RH ghost dyads on the swung odd 16th in 35, 39, "
               f"55, 59; the LH kick / ghost layer straight under the swung melody and ghosts "
               f"({s._post['kicks_straightened']} LH 16ths re-gridded; the RH hats sit on straight 8th off-beats); "
               f"backbeat shells on 2 & 4 (choruses), on 3 (bridge); groove half pedal (CC64 {A.GROOVE_PEDAL}) over "
               f"bars {' and '.join(f'{a}-{b}' for a, b in A.GROOVE_PEDAL_BARS)} (verse 2 full legato pedal); "
               f"anticipations see [groove]")
    out.append(" 11 tempo: see [groove] info (groove sections within 1 %)")
    out.append(" 12 dynamics, melody max per section: " + ", ".join(f"{k} {v}" for k, v in vmax.items()))
    out.append(" 13 playability: see [playability] / [fingering] / [sketch.extra_checks]")
    out.append(" 14 pedal: see [structure] PEDAL lines and [pedal-policy] (one change per harmony, dry lifts only at "
               "fills and drops, re-catches on re-struck basses 17/21/37/53/55/63, half-pedal flutters on turns, "
               "heads and the tear 5/10/17/21/25/33/57/59/61, groove half pedal 17-24 and 29-40) and [pedal-clusters]")
    out.append(f" 13b key releases (finger-aware since fix round 2: a key whose finger would cross or overstretch "
               f"against a new key is let go first, with the jump air of the larger of the key's and the hand "
               f"centre's travel: 50 ms <= 12 st, 100 ms 13-24 st, 140 ms beyond): "
               f"{s._post['keys_released_for_air']} keys let go early for travel time, "
               f"{s._post['pedal_changes_accelerated']} pedal changes at the fast timing so the bass is still caught; "
               f"see [key-air] / [finger-travel] / [finger-order] / [finger-pins]")
    out.append(f" 15 ending: Friberg rit w={FINAL_RIT[2]} q={FINAL_RIT[3]} over 65-66; Db5 (b6) tied over the bar line "
               f"as a Bbm6/F appoggiatura, last melody {pname(last.pitch)} v{last.vel} on beat 2 over the rolled "
               f"Fadd9; the chord rings {ped_up - last.t_on:.1f}s, then a 0.7 s damper ramp; b6-5 (Db5 -> C5), 4-3 "
               f"(tenor Bb3 -> A3) and 9-3 (RH G4 -> A4) resolve together inside it")
    out.append(f" 16 duration to last note-off {dur:.1f}s = {int(dur // 60)}:{dur % 60:04.1f}")
    out.append(f" 17 originality: RFIY 4-interval matches {len(hits)}, neighbour oscillations {osc}; see [originality]; "
               f"no vi-IV-I-V, no 8th-note arpeggio loops (every LH bar hand-written). Human A/B listening: NOT done")
    out.append(" 18 sound: melody VEL-REPEAT checked in [melody]; releases / reverb / clipping belong to the render "
               "(music/render_audio.py)")
    return out


def outputs(s, txt):
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "checks.txt"), "w", encoding="utf-8").write(txt)
    open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8").write(s.report())
    ls = s.leadsheet()
    ls += "\n\nINTENDED HARMONY (bar:beat section symbol roman)\n"
    for b, sym, roman, sec, bar, beat in s._timeline_chords:
        ls += f"  {bar:3d}:{beat:<5g} {sec:8s} {sym:14s} {roman}\n"
    open(os.path.join(OUT, "leadsheet.txt"), "w", encoding="utf-8").write(ls)
    s.to_midi(os.path.join(OUT, "score.mid"))
    data = s.to_json(os.path.join(OUT, "score.json"))
    data["chords"] = [dict(bar=bar, beat=beat, sym=sym, roman=roman, section=sec, t=round(s._b2s(b), 4))
                      for b, sym, roman, sec, bar, beat in s._timeline_chords]
    data["seed"] = SEED
    with open(os.path.join(OUT, "score.json"), "w") as f:
        json.dump(data, f, indent=0)
    if "--no-png" not in sys.argv:
        for i, sec in enumerate(s.timeline["sections"]):
            ns = [n for n in s.notes if sec["bar_start"] <= s._bar_of(n.beat) <= sec["bar_end"]]
            t1 = max(sec["t_end"], max(n.t_off for n in ns)) if ns else sec["t_end"]
            s.pianoroll(os.path.join(OUT, f"roll_{i + 1:02d}_{sec['name']}.png"), t0=max(0.0, sec["t_start"] - 0.3),
                        t1=t1 + 0.3)
        s.pianoroll(os.path.join(OUT, "roll_full.png"))


def main():
    s = build()
    total, txt = run_checks(s)
    outputs(s, txt)
    print(txt)
    return s


if __name__ == "__main__":
    main()
