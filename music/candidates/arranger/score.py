"""Afterglow, solo piano. Arranger candidate (pianist-arranger lens).

Run:  .venv/Scripts/python.exe music/candidates/arranger/score.py
Writes into this folder: score.json, score.mid, leadsheet.txt, checks.txt, report.txt, roll_*.png

Key plan: Eb major (verses, choruses) -> C minor bridge -> F major (climax, ending).
Every note below is written by hand, voice by voice; only fingering is solved
(arr_tools.assign_fingers) where a token carries no %finger.
Voices: mel (tune), mel8 (tune doubled an octave down by the RH thumb), inner (RH inner
voice / comping), bass (LH 5th finger), acc (LH shells), tenor (LH-thumb countermelody), ghost.

Motivic cells (all melodies are built from these):
  alpha "leap and turn":  rising M6 pickup (5 -> 3) into a held 3rd, then the turn 3-2-1-2
  beta  "sus sigh":       an appoggiatura landing on the "&" of 1 over a sus chord, falling a step
  gamma "flow pickup":    repeated-note 16ths rising by step, like a rap / R&B vocal pickup
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "music"))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "sandbox", "music-research"))
from dsl import Score, pname, pitch  # noqa: E402
import arr_tools as T  # noqa: E402

s = Score("Afterglow", bpm=76, seed=2026)
HARM = []          # (abs beat, symbol): every harmony change gets a legato pedal change
DRYS = []          # rhythmic pedal lifts before a dry approach note or fill

GROOVE = {"mel": 14, "mel8": 14, "inner": 9, "acc": 7, "tenor": 5, "bass": 0, "ghost": 2, "default": 0}


def R(bar, text, voice="mel", vel=60, beat=1):
    return s.line("R", bar, text, voice=voice, vel=vel, beat=beat)


def L(bar, text, voice="acc", vel=40, beat=1):
    return s.line("L", bar, text, voice=voice, vel=vel, beat=beat)


def H(bar, beat, sym):
    """Harmony change: recorded for the leadsheet/validators and given a legato pedal change."""
    HARM.append((s.pos(bar, beat), sym))
    s.pedal(bar, beat, "change")


def PC(bar, beat):
    """Extra legato re-pedal (no harmony change) on a re-struck bass, to clear melodic blur."""
    s.pedal(bar, beat, "change")


def DRY(bar, beat):
    """Rhythmic pedal lift: the dampers fall before a dry approach note, fill or drop."""
    DRYS.append(s.pos(bar, beat))
    s.pedal(bar, beat, "up")


def tag(bar, beat, names, t="dry"):
    b = s.pos(bar, beat)
    for nm in names:
        p = pitch(nm)
        for n in s.notes:
            if abs(n.beat - b) < 1e-6 and n.pitch == p:
                n.tags.append(t)


def harmony(rows):
    for bar, beat, sym in rows:
        H(bar, beat, sym)


# ================================================================================================
# TEMPO MAP AND FORM
# ================================================================================================
for bar, beat, bpm in [(1, 1, 68), (4, 3, 60), (4, 4.9, 60), (5, 1, 76), (13, 1, 76), (16, 3, 78), (17, 1, 78),
                       (40, 4.95, 78), (41, 1, 74), (48, 4, 72), (49, 1, 74), (52, 1, 80), (53, 1, 80),
                       (60, 4.75, 80), (61, 1, 77), (62, 4, 68), (63, 1, 66), (66, 4, 64), (67, 1, 64)]:
    s.tempo(bar, beat, bpm)
s.fermata(4, 3.75, 1.2)     # intro: hold the unresolved sus
s.fermata(16, 4, 0.15)      # the drop before chorus 1
s.fermata(52, 4, 0.5)       # the drop before the climax
s.fermata(62, 3, 0.6)       # tag: let the arrival decay
s.fermata(68, 4, 0.4)       # breath before the last chord
s.fermata(69, 3, 1.4)       # the last chord rings
s.final_rit(67, 69, w=0.6, q=2.5)

s.section("intro", 1, 4, swing=0.50, rubato=0.9)
s.section("verse1", 5, 12, swing=0.51, rubato=0.5)
s.section("pre1", 13, 16, swing=0.53, rubato=0.3)
s.section("chorus1", 17, 24, swing=0.56, rubato=0.05, offsets_ms=GROOVE)
s.section("verse2", 25, 28, swing=0.57, rubato=0.05, offsets_ms=GROOVE)
s.section("pre2", 29, 32, swing=0.57, rubato=0.05, offsets_ms=GROOVE)
s.section("chorus2", 33, 40, swing=0.58, rubato=0.05, offsets_ms=GROOVE)
s.section("bridge", 41, 48, swing=0.50, rubato=0.6)
s.section("build", 49, 52, swing=0.50, rubato=0.0, offsets_ms={"mel": -6, "default": 0})
s.section("climax", 53, 60, swing=0.56, rubato=0.03, offsets_ms=GROOVE)
s.section("tag", 61, 62, swing=0.50, rubato=0.4)
s.section("finalA", 63, 66, swing=0.50, rubato=0.9)
s.section("coda", 67, 69, swing=0.50, rubato=0.9)

for a, b, pk in [(1, 2, .62), (3, 4, .62), (5, 6, .62), (7, 8, .62), (9, 10, .62), (11, 12, .62), (13, 16, .7),
                 (17, 20, .62), (21, 24, .62), (25, 28, .62), (29, 32, .75), (33, 36, .62), (37, 40, .55),
                 (41, 44, .62), (45, 48, .62), (49, 52, .97), (53, 56, .62), (57, 60, .45), (61, 62, .2),
                 (63, 66, .62), (67, 69, .4)]:
    s.phrase(a, b, peak=pk)


# ================================================================================================
# 1. INTRO (bars 1-4), free. The hook's call alone, high and soft, over rolled chorus chords.
#    The sus in bar 2 is NOT resolved (the response is withheld); a tenor line C-Bb-C-Bb-A-Bb-C moves
#    underneath. Ends on Bb9sus with a fermata.
# ================================================================================================
def intro():
    harmony([(1, 1, "Abmaj9"), (2, 1, "Bb13sus4"), (3, 1, "Gm9"), (4, 1, "Cm9"), (4, 3, "Bb9sus4")])
    R(1, "r:1.5 Bb4:0.5@44 G5:2~@56 | G5:0.5 F5:0.25@48 Eb5:0.25@45 F5:1@52 Eb5:2@54 | "
         "D5:2.5@52 F5:0.5@47 G5:0.5@50 F5:0.5@44 | Eb5:1@49 D5:1@45 C5:2@51 |", vel=50)
    R(1, "r:2 C5:2 | r:4 | Bb4:2 r:2 | r:2 F4:2 |", voice="inner", vel=27)
    L(1, "Ab1:0.5 r:3.5 | Bb1:0.5 r:3.5 | G1:0.5 r:3.5 | C2:0.5 r:1.5 Bb1:0.5 r:1.5 |", voice="bass", vel=36)
    L(1, "r:0.5 [Eb3 G3]:3.5^ | r:0.5 [F3 Ab3]:3.5^ | r:0.5 [D3 F3]:3.5^ | "
         "r:0.5 [Eb3 G3]:1.5^ r:0.5 [Ab3 Eb4]:1.5^ |", voice="acc", vel=26)
    L(1, "r:0.5 C4:2.5 Bb3:1 | r:0.5 C4:3.5 | r:0.5 Bb3:2 A3:1.5 | r:0.5 Bb3:1.5 r:0.5 C4:1.5 |",
      voice="tenor", vel=30)


# ================================================================================================
# 2. VERSE 1 (bars 5-12), ballad. Low, talking melody (F4-Eb5) built on the gamma cell (repeated
#    16ths after the downbeat). LH "tenth bloom": bass, 10th/shell, and a sigh in the inner voice
#    (9-10, 9-8, chromatic Bb-A) while the tune holds. RH thumb chord on the downbeats.
# ================================================================================================
def verse1():
    harmony([(5, 1, "Ebadd9"), (6, 1, "Bb/D"), (7, 1, "Cm9"), (8, 1, "Bbm9"), (8, 3, "Eb7b9"),
             (9, 1, "Abmaj9"), (10, 1, "Abm6"), (11, 1, "Eb/G"), (11, 3, "Gbdim7"), (12, 1, "Fm11"),
             (12, 3, "Bb9sus4")])
    R(5, "r:0.5 G4:0.25@54 Bb4:0.25@56 Bb4:0.5@60 G4:0.5@56 F4:0.5@53 G4:1.5@58 | "
         "r:0.5 F4:0.25@54 G4:0.25@56 Bb4:0.75@61 C5:0.25@58 D5:0.5@63 Bb4:1.5@57 | "
         "r:0.5 G4:0.25@56 Bb4:0.25@58 Bb4:0.5@62 G4:0.5@58 Bb4:0.5@60 Eb5:1.5@67 | "
         "Db5:1@65 C5:0.5@60 Ab4:0.5@56 G4:1.5@58 r:0.5 | "
         "r:0.5 Eb5:0.25@60 Eb5:0.25@62 Eb5:0.5@64 C5:0.5@59 Bb4:0.5@57 C5:1.5@62 | "
         "r:0.5 Eb5:0.25@62 Eb5:0.25@63 Eb5:0.75@66 Cb5:1.25@69 Bb4:1@59 | "
         "G4:1.5@58 Bb4:0.5@55 A4:1@57 C5:1@61 | "
         "Eb5:0.5@63 C5:0.5@58 Ab4:1@55 Bb4:2@59 |", vel=58)
    R(5, "[Bb3 Eb4]:0.5 r:3.5 | [Bb3 D4]:0.5 r:3.5 | [Bb3 D4]:0.5 r:3.5 | F4:1 r:3 | "
         "[C4 Eb4]:0.5 r:3.5 | [Cb4 Eb4]:0.5 r:3.5 | Eb4:1 r:1 Eb4:1 r:1 | Bb4:1 r:1 F4:2 |",
      voice="inner", vel=32)
    L(5, "Eb2:0.75 r:3.25 | D2:0.75 r:3.25 | C2:0.75 r:3.25 | Bb1:0.5 r:1.5 Eb2:0.5 r:1.5 | "
         "Ab1:0.75 r:3.25 | Ab1:0.75 r:3.25 | G1:0.5 r:1.5 Gb1:0.5 r:1.5 | F1:0.5 r:1.5 Bb1:0.5 r:1.5 |",
      voice="bass", vel=44)
    L(5, "r:0.75 Bb2:0.75 G3:1 F3:0.5 G3:1 | r:0.75 F3:0.75 Bb3:1 C4:0.5 Bb3:1 | "
         "r:0.75 Eb3:0.75 Bb3:0.75 C4:0.25 D4:0.5 Eb4:0.5 D4:0.5 | r:0.5 F2:0.5 Db3:1 r:0.5 [G3 Db4]:1.5 | "
         "r:0.75 C3:0.75 G3:1 Bb3:0.5 G3:1 | r:0.75 [Cb3 F3]:1.75 Eb3:0.5 F3:0.5 Gb3:0.5 | "
         "r:0.5 Eb3:0.5 Bb3:1 r:0.5 [Eb3 A3]:1.5 | r:0.5 [Eb3 Ab3 Bb3]:1.5 r:0.5 [Eb3 Ab3 C4]:1.5 |",
      voice="acc", vel=33)


# ================================================================================================
# 3. PRE-CHORUS 1 (bars 13-16). Repeated 8ths sequenced up by step (C, D, Eb -> Gb over A dim7), the
#    bass climbs F-G-Ab-A-Bb, then beta (Eb -> D) over V and a real drop: pedal up, half a beat of
#    silence, the Bb4 pickup alone and dry.
# ================================================================================================
def pre1():
    harmony([(13, 1, "Fm9"), (14, 1, "Gm7"), (15, 1, "Abmaj9"), (15, 3, "Adim7"), (16, 1, "Bb13sus4"),
             (16, 3, "Bb7(13)")])
    R(13, "r:0.5 C5:0.5@60 C5:0.5@62 Eb5:0.5@66 C5:0.5@61 Bb4:0.5@59 C5:1@63 | "
          "r:0.5 D5:0.5@63 D5:0.5@65 F5:0.5@69 D5:0.5@64 C5:0.5@62 D5:1@66 | "
          "r:0.5 Eb5:0.5@66 Eb5:0.5@68 G5:0.5@72 Gb5:1@75 F5:0.5@70 Eb5:0.5@67 | "
          "F5:0.5@70 Eb5:1.5@77 D5:1@70 r:0.5 Bb4:0.5@62 |", vel=64)
    R(13, "[Eb4 Ab4]:0.5 r:3.5 | [F4 Bb4]:0.5 r:3.5 | [Ab4 C5]:0.5 r:1.5 [A4 C5]:1 r:1 | "
          "[Ab4 C5]:0.5 r:1.5 Ab4:1 r:1 |", voice="inner", vel=38)
    L(13, "F1:0.75 r:3.25 | G1:0.75 r:3.25 | Ab1:0.5 r:1.5 A1:0.5 r:1.5 | Bb1:0.5 r:1.5 Bb1:0.5 r:1.5 |",
      voice="bass", vel=48)
    L(13, "r:0.75 Eb3:0.75 Ab3:1 G3:0.5 Ab3:1 | r:0.75 F3:0.75 Bb3:1 A3:0.5 Bb3:1 | "
          "r:0.5 [Eb3 C4]:1.5 r:0.5 [Eb3 Gb3 C4]:1.5 | r:0.5 [Ab3 C4]:1.5 r:0.5 [Ab3 D4]:0.5 r:1 |",
      voice="acc", vel=39)
    DRY(16, 3.8)


# ================================================================================================
# 4. CHORUS 1 (bars 17-24) + VERSE 2 (bars 25-28): the groove arrives. One melody line for both
#    sections so the chorus's last Eb5 can tie over the barline into verse 2 (elided cadence).
#    Hook: alpha (Bb4 -> G5, turn G-F-Eb-F), beta (Eb5 on the "&" of 1 over Bb sus -> D5),
#    gamma (Bb4 Bb4 C5 D5 F5), then the second half climbs to C6 and turns through E-natural.
#    RH: tune + thumb "hats" on the "&" of 1 and 3. LH boom-bap stride: bass on 1 and the "&" of 3,
#    shells on 2 and 4 (snare), a ghost octave on the "a" of 2, pushes on the "&" of 4, and dry
#    walk-down / walk-up fills at the ends of the 4-bar phrases.
# ================================================================================================
def chorus1_verse2():
    harmony([(17, 1, "Abmaj9"), (18, 1, "Bb13sus4"), (18, 3, "Bb7(13)"), (18, 4.5, "Gm7"),
             (19, 4.5, "Cm9"), (20, 3, "Cm9/Bb"), (21, 1, "Abmaj9"), (22, 1, "Bb/Ab"), (22, 4.5, "Gm7"),
             (23, 3, "C7b9"), (23, 4.5, "Fm9"), (24, 3, "Bb9sus4")])
    PC(17, 3.5); PC(19, 3.5); PC(21, 3.5); PC(22, 3.5)
    DRY(20, 4.25); DRY(24, 4.25)
    R(17, "G5:1.5@80 F5:0.25@70 Eb5:0.25@67 F5:1@75 C5:0.5@70 Bb4:0.5@67 | "
          "C5:0.5@72 Eb5:1.5@83 D5:1.5@76 r:0.5 | "
          "r:0.5 Bb4:0.25@68 Bb4:0.25@71 C5:0.5@73 D5:0.5@76 F5:1.5@81 Eb5:0.5~@75 | "
          "Eb5:1 D5:1@73 C5:1.5@75 Bb4:0.5@68 | "
          "G5:1.5@83 F5:0.25@72 Eb5:0.25@70 F5:0.5@75 G5:0.5@79 Bb5:1~@85 | "
          "Bb5:0.5 C6:1.5@89 Bb5:0.5@81 G5:0.5@77 F5:1@75 | "
          "D5:0.5@72 F5:1@79 Eb5:0.5@74 E5:1@82 G5:0.5@80 F5:0.5~@76 | "
          "F5:1 Eb5:0.5@74 C5:0.5@71 Bb4:0.5@69 C5:0.5@72 Eb5:1~@77 | "
          # verse 2: the verse tune in a looser, swung "flow"; it opens with the falling sixth Eb5 -> G4
          "Eb5:0.5 G4:0.25@64 Bb4:0.25@67 Bb4:0.25@65 Bb4:0.25@68 G4:0.5@64 F4:0.5@62 G4:1.5@67 | "
          "r:0.5 F4:0.25@63 G4:0.25@65 Bb4:0.5@68 C5:0.5@70 D5:0.75@73 C5:0.25@67 Bb4:1@66 | "
          "r:0.5 G4:0.25@64 Bb4:0.25@67 Bb4:0.25@66 Bb4:0.25@69 G4:0.5@65 Bb4:0.5@68 Eb5:1.5@75 | "
          "Db5:0.75@73 C5:0.25@68 Ab4:0.5@66 F4:0.5@62 Ab4:0.5@67 G4:1@64 r:0.5 |", vel=76)
    # RH thumb "hats": short dyads under the held tune, common tones where the chord allows
    R(17, "r:0.5 [C5 Eb5]:0.25@48 r:1.75 [Ab4 C5]:0.25@45 r:1.25 | "
          "r:0.5 [F4 Ab4]:0.25@48 r:1.75 [G4 Bb4]:0.25@45 r:1.25 | "
          "r:2.5 [Bb4 D5]:0.25@46 r:1.25 | "
          "r:0.5 [G4 Bb4]:0.25@47 r:1.75 [Eb4 G4]:0.25@44 r:1.25 | "
          "r:0.5 [C5 Eb5]:0.25@49 r:1.75 [C5 Eb5]:0.25@46 r:1.25 | "
          "r:0.5 [D5 F5 Ab5]:0.25@50 r:1.75 [Bb4 D5]:0.25@46 r:1.25 | "
          "r:0.5 [Bb4 D5]:0.25@48 r:1.75 [Bb4 Db5]:0.25@47 r:1.25 | "
          "r:0.5 [Ab4 C5]:0.25@47 r:1.75 [F4 Ab4]:0.25@44 r:1.25 |", voice="inner", vel=46)
    L(17, "Ab1:0.75@60 r:1.75 Ab1:0.5@55 r:1 | "
          "Bb1:0.75@60 r:1.25 Bb1:0.5@57 r:1 G1:0.5@56 | "
          "r:2.5 G1:0.5@55 r:0.5 C2:0.5@57 | "
          "r:2 Bb1:0.5@56 r:1 A1:0.5@48 | "
          "Ab1:0.75@60 r:1.75 Ab1:0.5@55 r:1 | "
          "Ab1:0.75@59 r:1.75 Ab1:0.5@55 r:0.5 G1:0.5@56 | "
          "r:2 C2:0.5@57 r:1 F1:0.5@57 | "
          "r:2 Bb1:0.5@56 r:1 D2:0.5@48 |", voice="bass", vel=58)
    L(17, "r:1 [Eb3 G3 C4]:0.5@50 r:1.5 [Eb3 G3 Bb3]:0.5@47 r:0.5 | "
          "r:1 [Ab3 C4 Eb4]:0.5@50 r:1.5 [Ab3 D4]:0.5@47 r:0.5 | "
          "r:1 [F3 Bb3 D4]:0.5@50 r:1.5 [F3 Bb3 D4]:0.25@46 r:0.75 | "
          "r:1 [Eb3 Bb3 D4]:0.5@50 r:1.5 [Eb3 G3 D4]:0.25@46 r:0.75 | "
          "r:1 [Eb3 G3 C4]:0.5@50 r:1.5 [Eb3 Ab3 C4]:0.5@47 r:0.5 | "
          "r:1 [F3 Bb3 D4]:0.5@50 r:1.5 [F3 Ab3 D4]:0.25@46 r:0.75 | "
          "r:1 [F3 Bb3 D4]:0.5@50 r:1.5 [E3 Bb3 Db4]:0.25@47 r:0.75 | "
          "r:1 [Eb3 Ab3 C4]:0.5@50 r:1.5 [Ab3 C4 Eb4]:0.25@46 r:0.75 |", voice="acc", vel=50)
    L(17, "r:1.75 Ab2:0.25 r:2 | r:4 | r:1.75 G2:0.25 r:2 | r:4 | r:1.75 Ab2:0.25 r:2 | "
          "r:1.75 Ab2:0.25 r:2 | r:4 | r:4 |", voice="ghost", vel=26)
    tag(20, 4.5, ["A1"]); tag(24, 4.5, ["D2"])

    # ---- VERSE 2 (bars 25-28): "lazy walk" LH (long root, pushed shell on the "&" of 2, octave on 3,
    # ghost on the "a" of 3, upper shell note on 4, push on the "&" of 4); RH backbeat dyads on 2 and 4.
    harmony([(25, 1, "Ebadd9"), (25, 4.5, "Bb/D"), (27, 1, "Cm9"), (27, 4.5, "Bbm9"), (28, 3, "Eb7b9")])
    PC(25, 3); PC(26, 3); PC(27, 3)
    DRY(28, 4.25)
    R(25, "r:1 [Eb4 G4]:0.25@46 r:1.75 [Bb3 Eb4]:0.25@43 r:0.75 | "
          "r:1 [D4 F4]:0.25@46 r:1.75 [D4 F4]:0.25@43 r:0.75 | "
          "r:1 [Eb4 G4]:0.25@46 r:1.75 [G4 Bb4]:0.25@45 r:0.75 | "
          "r:1 [Db4 F4]:0.25@46 r:2.75 |", voice="inner", vel=45)
    L(25, "Eb2:1.25@56 r:0.75 Eb3:0.5@46 r:1 D2:0.5@52 | "
          "r:2 D3:0.5@46 r:1.5 | "
          "C2:1.25@56 r:0.75 C3:0.5@46 r:1 Bb1:0.5@52 | "
          "r:2 Eb2:0.5@52 r:1 Gb1:0.5@44 |", voice="bass", vel=54)
    L(25, "r:1.5 [Bb2 F3 G3]:0.5@46 r:1 G3:0.5@42 r:0.5 | "
          "r:1.5 [F3 Bb3]:0.5@46 r:1 C4:0.5@42 r:0.5 | "
          "r:1.5 [Eb3 Bb3]:0.5@46 r:1 D4:0.5@42 r:0.5 | "
          "r:1.5 [Db3 Ab3]:0.5@46 r:0.5 [G3 Db4]:0.75@44 r:0.75 |", voice="acc", vel=46)
    L(25, "r:2.75 Eb3:0.25 r:1 | r:2.75 D3:0.25 r:1 | r:2.75 C3:0.25 r:1 | r:4 |", voice="ghost", vel=26)
    tag(28, 4.5, ["Gb1"])


# ================================================================================================
# 5. PRE-CHORUS 2 (bars 29-32): pre 1's sequence in swung 16th "flow" (landings on the "a" of 3),
#    octave bass on the downbeats, stride shells with an inner move (Bb3 -> A3), RH inner thirds.
#    No drop this time: the C5-Bb4 pickup runs straight into chorus 2.
# ================================================================================================
def pre2():
    harmony([(29, 1, "Fm9"), (30, 1, "Gm7"), (31, 1, "Ab(add9)"), (31, 3, "Adim7"), (32, 1, "Bb13sus4"),
             (32, 3, "Bb7(13)")])
    PC(29, 3.5); PC(30, 3.5)
    R(29, "r:0.5 C5:0.25@70 C5:0.25@72 C5:0.5@74 Eb5:0.5@78 C5:0.5@73 Bb4:0.25@70 C5:1.25@75 | "
          "r:0.5 D5:0.25@73 D5:0.25@75 D5:0.5@77 F5:0.5@81 D5:0.5@76 C5:0.25@73 D5:1.25@78 | "
          "r:0.5 Eb5:0.25@76 Eb5:0.25@78 Eb5:0.5@80 G5:0.5@85 Gb5:1@83 F5:0.5@79 Eb5:0.5@76 | "
          "F5:0.5@80 Eb5:1.5@86 D5:1@80 C5:0.5@74 Bb4:0.5@72 |", vel=76)
    R(29, "[Eb4 Ab4]:0.5@48 r:2.25 [F4 Ab4]:0.5@46 r:0.75 | "
          "[F4 Bb4]:0.5@50 r:2.25 [F4 Bb4]:0.5@48 r:0.75 | "
          "[Ab4 C5]:0.5@52 r:1.5 [A4 C5]:1@52 r:1 | "
          "[Ab4 C5]:0.5@54 r:1.5 [F4 Ab4]:1@52 r:1 |", voice="inner", vel=50)
    L(29, "[F1 F2]:0.75@60 r:1.75 F1:0.5@55 r:1 | "
          "[G1 G2]:0.75@61 r:1.75 G1:0.5@56 r:1 | "
          "[Ab1 Ab2]:0.75@62 r:1.25 A1:0.5@58 r:1.5 | "
          "[Bb1 Bb2]:0.75@64 r:1.25 Bb1:0.5@60 r:1.5 |", voice="bass", vel=58)
    L(29, "r:1 [Eb3 Ab3 C4]:0.5@50 r:1.5 [Eb3 Ab3 C4]:0.5@47 r:0.5 | "
          "r:1 [F3 Bb3 D4]:0.5@51 r:1.5 [F3 A3 D4]:0.5@48 r:0.5 | "
          "r:1 [Eb3 Bb3 C4]:0.5@52 r:1.5 [Eb3 Gb3 C4]:0.5@50 r:0.5 | "
          "r:1 [Ab3 C4 Eb4]:0.5@54 r:1.5 [Ab3 D4]:0.5@52 r:0.5 |", voice="acc", vel=50)
    L(29, "r:1.75 F2:0.25 r:2 | r:1.75 G2:0.25 r:2 | r:4 | r:3.5 Bb2:0.25 Bb2:0.25 |", voice="ghost", vel=25)


# ================================================================================================
# 6. CHORUS 2 (bars 33-40): hook again, fuller. Comping on the "&" of 1, 2 and 3; a LH-thumb tenor
#    countermelody answers wherever the tune holds (bars 34, 36, 38, 40); the tune goes into octaves
#    for its climb (37-38) while the LH switches to tresillo octave pushes. Ends Bb9sus with a tenor
#    descent Ab-G-F-Eb that steers the deceptive cadence into C minor.
# ================================================================================================
def chorus2():
    harmony([(33, 1, "Abmaj9"), (33, 4.5, "Bb13sus4"), (34, 3, "Bb7(13)"), (35, 1, "Gm7"), (35, 4.5, "Cm9"),
             (36, 3, "Cm9/Bb"), (37, 1, "Abmaj9"), (37, 4.5, "Bb/Ab"), (38, 4.5, "Gm7"), (39, 3, "C7b9"),
             (39, 4.5, "Fm9"), (40, 3, "Bb9sus4")])
    PC(33, 3.5); PC(35, 3.5); PC(37, 2.5); PC(38, 3.5)
    R(33, "G5:1.5@88 F5:0.25@77 Eb5:0.25@75 F5:1@82 C5:0.5@77 Bb4:0.5@75 | "
          "C5:0.5@79 Eb5:1.5@90 D5:1.5@84 r:0.5 | "
          "r:0.5 Bb4:0.25@75 Bb4:0.25@78 C5:0.5@80 D5:0.5@83 F5:1@87 G5:0.5@85 Eb5:0.5~@82 | "
          "Eb5:1 D5:0.75@80 Eb5:0.25@78 C5:1.5@83 Bb4:0.5@76 | "
          "G5:1.5@91 F5:0.25@80 Eb5:0.25@78 F5:0.5@84 G5:0.5@88 Bb5:1~@92 | "
          "Bb5:0.5 C6:1.5@94 Bb5:0.5@89 G5:0.5@85 F5:1@84 | "
          "D5:0.5@80 F5:1@87 Eb5:0.5@82 E5:1@90 G5:0.5@88 F5:0.5~@84 | "
          "F5:1 Eb5:0.5@80 C5:0.5@76 Bb4:1@74 r:1 |", vel=84)
    R(37, "G4:1.5@75 r:0.5 F4:0.5@69 G4:0.5@72 Bb4:1~@77 | Bb4:0.5 C5:1.5@79 Bb4:0.5@73 r:0.5 F4:1@69 |",
      voice="mel8", vel=74)
    R(33, "r:0.5 [C5 Eb5]:0.25@52 r:0.75 [Ab4 C5]:0.25@48 r:0.75 [Ab4 C5]:0.25@50 r:1.25 | "
          "r:0.5 [F4 Ab4]:0.25@52 r:0.75 [F4 Ab4]:0.25@48 r:2.25 | "
          "r:2.5 [Bb4 D5]:0.25@52 r:1.25 | "
          "r:0.5 [G4 Bb4]:0.25@52 r:0.75 [G4 Bb4]:0.25@48 r:2.25 | "
          "[C5 Eb5]:1.5@58 r:0.5 [Ab4 C5]:0.5@56 r:0.5 Eb5:1@58 | "
          "r:0.5 [F5 Ab5]:1.5@60 [D5 F5]:0.5@56 r:0.5 [Bb4 D5]:1@55 | "
          "r:0.5 [Bb4 D5]:0.25@54 r:1.75 [Bb4 Db5]:0.25@54 r:1.25 | "
          "r:0.5 [Ab4 C5]:0.25@52 r:3.25 |", voice="inner", vel=52)
    L(33, "Ab1:0.75@64 r:1.75 Ab1:0.5@60 r:0.5 Bb1:0.5@59 | "
          "r:2 Bb1:0.5@62 r:1.5 | "
          "G1:0.75@63 r:1.75 G1:0.5@59 r:0.5 C2:0.5@61 | "
          "r:2 Bb1:0.5@60 r:1.5 | "
          "[Ab1 Ab2]:0.75@68 r:0.75 [Ab1 Ab2]:0.75@66 r:1.25 [Ab1 Ab2]:0.5@64 | "
          "r:2.5 [Ab1 Ab2]:0.5@64 r:0.5 [G1 G2]:0.5@66 | "
          "r:2 [C2 C3]:0.5@64 r:1 [F1 F2]:0.5@66 | "
          "r:2 [Bb1 Bb2]:0.5@62 r:1.5 |", voice="bass", vel=64)
    L(33, "r:1 [Eb3 G3 C4]:0.5@54 r:1.5 [Eb3 G3 Bb3]:0.5@51 r:0.5 | "
          "r:1 [Ab3 C4 Eb4]:0.5@54 r:2.5 | "
          "r:1 [F3 Bb3 D4]:0.5@54 r:1.5 [F3 Bb3 D4]:0.25@50 r:0.75 | "
          "r:1 [Eb3 Bb3 D4]:0.5@54 r:2.5 | "
          "r:3 [Eb3 G3 C4]:0.5@54 r:0.5 | "
          "r:3 [F3 Bb3 D4]:0.25@52 r:0.75 | "
          "r:1 [F3 Bb3 D4]:0.5@54 r:1.5 [E3 Bb3]:0.25@52 r:0.75 | "
          "r:1 [Eb3 Ab3 C4]:0.5@54 r:2.5 |", voice="acc", vel=54)
    # tenor countermelody (LH thumb), contrary to / filling around the held tune
    L(34, "r:2.5 Bb3:0.25@54 C4:0.25@57 D4:0.25@60 F4:0.25@62 D4:0.5@58 | "
          "r:4 | "
          "r:2.5 Eb4:0.25@60 D4:0.25@57 C4:0.5@59 Bb3:0.25@55 G3:0.25@53 | "
          "r:4 | "
          "r:1 F3:0.25@55 Ab3:0.25@58 Bb3:0.25@60 D4:0.25@63 r:2 | "
          "r:4 | "
          "r:3 Ab3:0.25@58 G3:0.25@55 F3:0.25@52 Eb3:0.25@49 |", voice="tenor", vel=58)
    L(33, "r:1.75 Ab2:0.25 r:2 | r:4 | r:1.75 G2:0.25 r:2 |", voice="ghost", vel=25)


# ================================================================================================
# 7. BRIDGE (bars 41-48), C minor, half-time, rubato. A new, slower cell (dotted quarter - eighth -
#    half): G4..Bb4 D5~ over Cm9 (the 9th held into Abmaj7#11, where it becomes the #11), sequenced
#    to Ab4..C5 Eb5 over Fm9; harmonic-minor descent Eb-D-B-Ab with the augmented second. Phrase 2
#    hides alpha (G4 -> Eb5, a rising M6) and climbs to Ab5 before falling to the leading tone.
#    LH: bass on 1, soft fifth/tenth on 2, full shell on 3 (half-time backbeat), moving note on the
#    "&" of 4; from bar 45 the harmonic rhythm doubles over the line cliche C4-B3-Bb3-A3.
# ================================================================================================
def bridge():
    harmony([(41, 1, "Cm9"), (42, 1, "Abmaj7#11"), (43, 1, "Fm9"), (44, 1, "G7sus4"), (44, 3, "G7b9"),
             (45, 1, "Cm(add9)"), (45, 3, "Cm(maj7)"), (46, 1, "Cm7"), (46, 3, "Cm6"), (47, 1, "Abmaj9"),
             (47, 3, "Fm9"), (48, 1, "Dm7b5"), (48, 3, "G7b9")])
    R(41, "G4:1.5@58 Bb4:0.5@56 D5:2~@64 | D5:1 G5:0.5@66 F5:0.5@62 Eb5:1@60 C5:1@58 | "
          "Ab4:1.5@59 C5:0.5@58 Eb5:2~@66 | Eb5:1 D5:1@62 B4:1@64 Ab4:1@60 | "
          "G4:2@58 r:0.5 G4:0.5@56 Eb5:0.5@63 D5:0.5@61 | Eb5:1.5@64 F5:0.5@63 G5:2@68 | "
          "Ab5:1.5@70 G5:0.5@66 F5:1@64 Eb5:1@62 | D5:1.5@62 F5:0.5@61 D5:1@58 B4:1@56 |", vel=62)
    R(41, "r:2 G4:2@38 | [Eb4 G4]:1@38 r:1 [Eb4 Ab4]:1.5@37 r:0.5 |r:2 [F4 Ab4]:2@38 | F4:4@37 | r:4 | "
          "G4:1.5@37 r:0.5 [C5 Eb5]:2@40 | [C5 Eb5]:2@40 [Ab4 C5]:2@38 | [F4 Ab4]:4@38 |",
      voice="inner", vel=38)
    L(41, "C2:1@48 r:3 | Ab1:1@46 r:3 | F1:1@46 r:3 | G1:0.75@48 r:1.25 G1:0.5@44 r:1.5 | "
          "C2:1@48 r:1 C2:1@44 r:1 | C2:1@46 r:1 C2:1@44 r:1 | Ab1:1@48 r:1 F1:1@46 r:1 | "
          "D2:1@48 r:1 G1:1@50 r:1 |", voice="bass", vel=46)
    L(41, "r:1 G2:1@34 [Eb3 Bb3 D4]:1.5@40 C4:0.5@36 | "
          "r:1 C3:1@34 [Eb3 G3 C4]:1.5@40 D4:0.5@36 | "
          "r:1 C3:1@34 [Eb3 Ab3 C4]:1.5@40 Bb3:0.5@36 | "
          "r:1 [F3 C4]:1@38 r:0.5 [F3 B3]:1@40 D4:0.5@36 | "
          "r:1 [Eb3 G3 C4]:1@41 r:1 [Eb3 G3 B3]:1@41 | "
          "r:1 [Eb3 G3 Bb3]:1@41 r:1 [Eb3 G3 A3]:1@41 | "
          "r:1 [Eb3 G3 C4]:1@41 r:1 [Eb3 Ab3 C4]:1@41 | "
          "r:1 [F3 Ab3 C4]:1@42 r:1 [F3 Ab3 B3]:1@42 |", voice="acc", vel=40)


# ================================================================================================
# 8. BUILD (bars 49-52), C pedal = V of F. LH straight-8th octaves accented 3+3+2; RH tresillo
#    stabs whose top line climbs Eb5 -> F5 -> G5, each bar leaping on beat 4 (G5, Bb5, C6). Bar 52:
#    C7b9 hit, a 16th sweep C4 -> G5 into a Bb5 chord on beat 3, then a real silence (pedal up).
#    The lone C5 pickup -> A5 (alpha) opens the climax.
# ================================================================================================
def build():
    harmony([(49, 1, "Abmaj7/C"), (50, 1, "Bb/C"), (51, 1, "C7sus4"), (52, 1, "C7b9")])
    PC(49, 3); PC(50, 3); PC(51, 3); PC(52, 3)
    DRY(52, 3.8)
    R(49, "Eb5:0.75@72 r:0.75 Eb5:0.75@74 r:0.75 G5:1@78 | "
          "F5:0.75@78 r:0.75 F5:0.75@80 r:0.75 Bb5:1@85 | "
          "G5:0.75@85 r:0.75 G5:0.75@87 r:0.75 C6:1@92 | "
          "r:0.25 C4:0.25@86 E4:0.25@88 G4:0.25@90 Bb4:0.25@92 Db5:0.25@94 E5:0.25@97 G5:0.25@100 "
          "Bb5:1@110 r:0.5 C5:0.5@80 |", vel=80)
    R(49, "[Ab4 C5]:0.75@56 r:0.75 [G4 C5]:0.75@58 r:0.75 [C5 Eb5]:1@62 | "
          "[Bb4 D5]:0.75@62 r:0.75 [A4 D5]:0.75@64 r:0.75 [D5 F5]:1@68 | "
          "[F4 Bb4 C5]:0.75@68 r:0.75 [F4 A4 C5]:0.75@70 r:0.75 [F5 G5]:1@74 | "
          "[Bb3 Db4 E4 G4]:0.25@88 r:1.75 [Db5 E5 G5]:1@90 r:1 |", voice="inner", vel=60)
    oct8 = lambda v: " ".join(f"[C2 C3]:0.5@{x}" for x in v)
    L(49, oct8([58, 48, 50, 58, 50, 52, 60, 52]) + " | " + oct8([64, 54, 56, 66, 56, 58, 68, 58]) + " | " +
          oct8([72, 62, 64, 74, 64, 66, 76, 66]) + " | "
          "[C2 C3]:0.5@90 [C2 C3]:0.5@74 [C2 C3]:0.5@76 [C2 C3]:0.5@78 [C2 C3]:1@96 r:1 |", voice="bass")


# ================================================================================================
# 9. CLIMAX (bars 53-60), F major, the chorus up a whole step. Tune in octaves on the main notes
#    with 1-2 inner chord tones (4-note RH chords inside an octave); LH tresillo octaves with
#    anticipations on the "&" of 4. Bar 58: the apex F6 over C9sus/Bb, sighing to E6 over C/Bb
#    (beta at the peak). Bar 60: pedal up, dry octave walk-up D-E into the F arrival.
# ================================================================================================
def climax():
    harmony([(53, 1, "Bbmaj9"), (53, 4.5, "C13sus4"), (54, 3, "C7(13)"), (54, 4.5, "Am7"), (55, 4.5, "Dm9"),
             (56, 3, "Dm9/C"), (56, 4.5, "Bbmaj9"), (58, 1, "C9sus4/Bb"), (58, 3.5, "C/Bb"), (58, 4.5, "Am7"),
             (59, 3, "D7b9"), (59, 4.5, "Gm9"), (60, 3, "C9sus4")])
    PC(53, 2.5); PC(55, 2.5); PC(57, 2.5)
    DRY(60, 3.9)
    R(53, "A5:1.5@104 G5:0.25@92 F5:0.25@90 G5:1@98 D5:0.5@94 C5:0.5@96 | "
          "D5:0.5@94 F5:1.5@104 E5:1.5@98 r:0.5 | "
          "r:0.5 C5:0.25@92 C5:0.25@94 D5:0.5@96 E5:0.5@98 G5:1.5@104 F5:0.5~@100 | "
          "F5:1 E5:1@97 D5:1.5@100 C5:0.5@95 | "
          "A5:1.5@106 G5:0.25@96 F5:0.25@94 G5:0.5@99 A5:0.5@102 C6:1~@108 | "
          "C6:0.5 D6:0.5@108 F6:1.5@115 E6:0.5@108 D6:0.5@104 C6:0.5@100 | "
          "E5:0.5@96 G5:1@102 F5:0.5@97 F#5:1@104 A5:0.5@102 G5:0.5~@100 | "
          "G5:1 F5:0.5@98 D5:0.5@96 C5:1@100 r:0.5 C5:0.5@98 |", vel=100)
    R(53, "A4:1.5@88 r:0.5 G4:1@84 r:1 | r:0.5 F4:1.5@88 E4:1.5@84 r:0.5 | r:2 G4:1.5@88 F4:0.5~@86 | "
          "F4:1 E4:1@83 D4:1.5@86 r:0.5 | A4:1.5@90 r:1.5 C5:1~@92 | C5:0.5 D5:0.5@92 F5:1.5@98 E5:0.5@92 r:1 | "
          "E4:0.5@82 G4:1@86 r:0.5 F#4:1@88 r:0.5 G4:0.5~@86 | G4:1 r:1 C4:1@86 r:1 |", voice="mel8", vel=86)
    R(53, "[D5 F5]:1.5@78 r:0.5 [Bb4 D5]:0.75@74 r:1.25 | "
          "r:0.5 [Bb4 D5]:1.5@76 [A4 C5]:1.5@74 r:0.5 | "
          "r:2 [C5 E5]:1.5@76 [A4 D5]:0.5~@74 | "
          "[A4 D5]:0.5 r:1.5 [F4 A4]:1.5@74 r:0.5 | "
          "[D5 F5]:1.5@80 r:1.5 F5:1@80 | "
          "r:1 [Bb5 C6]:1.5@86 [G5 C6]:0.5@84 r:1 | "
          "r:0.5 C5:1@76 r:0.5 [C5 Eb5]:1@78 r:0.5 [Bb4 D5]:0.5~@74 | "
          "[Bb4 D5]:1 r:1 [F4 G4]:1@76 r:1 |", voice="inner", vel=76)
    L(53, "[Bb1 Bb2]:0.75@88 r:0.75 [Bb1 Bb2]:0.75@84 r:1.25 [C2 C3]:0.5@82 | "
          "r:2 [C2 C3]:0.5@84 r:1 [A1 A2]:0.5@82 | "
          "r:1.5 [A1 A2]:0.75@84 r:1.25 [D2 D3]:0.5@82 | "
          "r:2 [C2 C3]:0.5@84 r:1 [Bb1 Bb2]:0.5@84 | "
          "r:1.5 [Bb1 Bb2]:0.75@86 r:1.75 | "
          "[Bb1 Bb2]:0.75@90 r:1.75 [Bb1 Bb2]:0.5@86 r:0.5 [A1 A2]:0.5@84 | "
          "r:2 [D2 D3]:0.5@84 r:1 [G1 G2]:0.5@84 | "
          "r:2 [C2 C3]:0.5@84 r:0.5 [D2 D3]:0.5@80 [E2 E3]:0.5@84 |", voice="bass", vel=84)
    L(53, "r:3 [D3 A3]:0.25@74 r:0.75 | "
          "r:1 [F3 Bb3 D4]:0.5@76 r:1.5 [E3 Bb3]:0.25@74 r:0.75 | "
          "r:1 [E3 G3 C4]:0.5@76 r:1.5 [E3 G3 C4]:0.25@74 r:0.75 | "
          "r:1 [F3 A3 C4]:0.5@76 r:2.5 | "
          "r:1 [D3 A3 C4]:0.5@76 r:1.5 [D3 A3]:0.25@74 r:0.75 | "
          "r:1 [D3 G3 C4]:0.5@78 r:2.5 | "
          "r:1 [E3 G3 C4]:0.5@76 r:1.5 [F#3 C4]:0.25@74 r:0.75 | "
          "r:1 [F3 Bb3 D4]:0.5@76 r:1 [F3 Bb3]:0.5@74 r:1 |", voice="acc", vel=76)
    L(56, "r:2.5 F3:0.25@70 G3:0.25@72 A3:0.25@74 C4:0.25@76 r:0.5 |", voice="tenor", vel=72)
    tag(60, 4, ["D2", "D3"]); tag(60, 4.5, ["E2", "E3"])


# ================================================================================================
# 10. TAG (bars 61-62): the first tonic arrival in F, fortissimo, alpha's turn in octaves, then it
#     decays onto Fmaj7/A with a fermata; the lone C5 pickup leads into the bare final A.
# ================================================================================================
def tag_section():
    harmony([(61, 1, "Fadd9"), (62, 1, "Fmaj7/A")])
    R(61, "A5:1.5@108 G5:0.25@94 F5:0.25@92 G5:2@98 | E5:2@78 r:1.5 C5:0.5@58 |", vel=90)
    R(61, "A4:1.5@92 r:0.5 G4:2@84 | r:4 |", voice="mel8", vel=84)
    R(61, "[C5 F5]:1.5@88 r:0.5 C5:2@78 | [A4 C5]:2@62 r:2 |", voice="inner", vel=70)
    L(61, "[F1 F2]:0.4@94 r:3.6 | A1:0.4@64 r:3.6 |", voice="bass", vel=80)
    L(61, "r:0.5 [C3 G3 A3]:3.5^@78 | r:0.5 [F3 C4]:3@54 r:0.5 |", voice="acc", vel=60)


# ================================================================================================
# 11. FINAL A (bars 63-66): the hook's first half in F, pianissimo, a single line. The sus that the
#     intro never resolved now resolves (F5 -> E5, bar 64). LH rolled bloom with a tenor sigh
#     (C4 -> B3, E4 -> D4).
# 12. CODA (bars 67-69): alpha one last time (C5 -> A5 and the turn) over Bbmaj9, then the minor
#     plagal afterglow Bbm6 (melody F5 -> Db5, tenor G3 -> F3) -> Fadd9 with C5 on top; ritardando,
#     the chord rings, the pedal is released slowly.
# ================================================================================================
def final_a_coda():
    harmony([(63, 1, "Bbmaj9"), (64, 1, "C13sus4"), (64, 3, "C7(13)"), (65, 1, "Am7"), (66, 1, "Dm9"),
             (67, 1, "Bbmaj9"), (68, 1, "Bbm6"), (69, 1, "Fadd9")])
    R(63, "A5:1.5@52 G5:0.25@45 F5:0.25@43 G5:1@48 D5:0.5@44 C5:0.5@41 | "
          "D5:0.5@45 F5:1.5@54 E5:2@49 | "
          "r:0.5 C5:0.25@42 C5:0.25@44 D5:0.5@47 E5:0.5@50 G5:1.5@54 F5:0.5~@49 | "
          "F5:1 E5:1@46 D5:2@42 | "
          "r:0.5 C5:0.5@40 A5:1.5@55 G5:0.25@47 F5:0.25@42 G5:1@46 | "
          "F5:2@50 Db5:2@45 | C5:4@44 |", vel=48)
    R(63, "r:4 | r:2 G4:2@30 | r:4 | r:2 A4:2@28 | r:1 D5:1.5@30 r:1.5 | [G4 Bb4]:4@30 | [F4 A4]:4@30 |",
      voice="inner", vel=30)
    L(63, "Bb1:0.5@32 r:3.5 | C2:0.5@32 r:1.5 C2:0.5@28 r:1.5 | A1:0.5@30 r:3.5 | D2:0.5@30 r:3.5 | "
          "Bb1:0.5@32 r:3.5 | Bb1:0.5@32 r:3.5 | F1:0.5@32 r:3.5 |", voice="bass", vel=32)
    L(63, "r:0.5 [D3 A3]:3.5@26 | r:0.5 [F3 Bb3]:1.5@26 r:0.5 [E3 Bb3]:1.5@26 | r:0.5 [E3 G3]:3.5@26 | "
          "r:0.5 [F3 A3]:3.5@26 | r:0.5 [D3 A3 C4]:3.5^@27 | r:0.5 Db3:3.5@27 | r:0.5 [C3 G3 A3]:3.5^@28 |",
      voice="acc", vel=26)
    L(63, "r:2 C4:2@28 | r:0.5 D4:1.5@28 r:2 | r:0.5 C4:1.5@28 B3:2@26 | r:0.5 E4:1.5@28 D4:2@26 | "
          "r:4 | r:0.5 G3:1.5@27 F3:2@26 |", voice="tenor", vel=27)


intro()
verse1()
pre1()
chorus1_verse2()
pre2()
chorus2()
bridge()
build()
climax()
tag_section()
final_a_coda()
s.pedal(70, 1, "up")           # replaced below by a slow release ramp


# ================================================================================================
# PERFORM, FINGER, BALANCE, CHECK, WRITE
# ================================================================================================
def slow_release(score, ramp=0.7):
    """Turn the final pedal-up into a natural 0.7 s damper release (not a cut)."""
    pc = score.pedal_curve
    t_up = pc[-2][0]
    head = [p for p in pc if p[0] < t_up - 1e-6]
    head += [(round(t_up, 4), 127), (round(t_up + 0.25 * ramp, 4), 96), (round(t_up + 0.55 * ramp, 4), 48),
             (round(t_up + ramp, 4), 0)]
    score.pedal_curve = head


def main():
    s.perform(lead_in=0.0)
    slow_release(s)
    ntidy = T.tidy_releases(s)
    T.assign_fingers(s)
    nbal = T.balance(s, gap=12)
    issues = s.check()
    harm_beats = [b for b, _ in HARM]
    mine, notes = T.my_checks(s, harm_beats, {"chorus1", "verse2", "pre2", "chorus2", "climax"})
    import sketch as SK
    extra, weak = SK.extra_checks(s)
    stats = SK.melody_stats(s)
    hits, osc = SK.rfiy_overlap(s)
    inner = T.inner_motion(s)
    rev, rnotes = T.review_checks(s, HARM, drops=[(16, 4.5), (52, 4.5)],
                                  groove_sections={"chorus1", "verse2", "pre2", "chorus2", "climax"},
                                  step_ranges=[(5, 12), (13, 16), (29, 32)])
    tl = s.timeline
    out = ["AFTERGLOW (arranger candidate): validator report", ""]
    out.append("SECTIONS (t_start - t_end, seconds)")
    for sec in tl["sections"]:
        out.append(f"  {sec['name']:8s} bars {sec['bar_start']:2d}-{sec['bar_end']:2d}  {sec['t_start']:7.2f} - "
                   f"{sec['t_end']:7.2f}  ({sec['t_end'] - sec['t_start']:5.1f}s)")
    dur = max(n.t_off for n in s.notes)
    out.append(f"last note-off {dur:.2f}s = {int(dur // 60)}:{dur % 60:04.1f}; notes={len(s.notes)}; "
               f"balance pass lowered {nbal} accompaniment notes; {ntidy} key releases tidied")
    out.append(f"\nDSL Score.check(): {len(issues)} issues")
    out += ["  " + x for x in issues]
    out.append(f"\nsketch extra_checks(): {len(extra)} issues")
    out += ["  " + x for x in extra]
    out.append(f"melody onsets < 6 vel above simultaneous accompaniment (sketch metric): {weak}")
    out.append(f"\narranger checks (arr_tools.my_checks): {len(mine)} issues")
    out += ["  " + x for x in mine]
    out.append("notes:")
    out += ["  " + x for x in notes]
    out.append(f"\nchecklist review checks (arr_tools.review_checks): {len(rev)} issues")
    out += ["  " + x for x in rev]
    out.append("notes:")
    out += ["  " + x for x in rnotes]
    out.append("\nINNER MOTION (stepwise accompaniment moves per 4 bars; need >= 2)")
    out += [f"  bars {a:2d}-{b:2d}: {c}" + ("   <-- LOW" if c < 2 else "") for a, b, c in inner]
    out.append("\nMELODY STATS per section")
    for k, v in stats.items():
        out.append(f"  {k:8s} {v}")
    out.append(f"\nRFIY 4-interval window matches: {len(hits)}; strict +-1 neighbour oscillations: {osc}")
    txt = "\n".join(out)
    print(txt)
    open(os.path.join(HERE, "checks.txt"), "w").write(txt)
    open(os.path.join(HERE, "report.txt"), "w").write(s.report())
    open(os.path.join(HERE, "leadsheet.txt"), "w").write(
        "AFTERGLOW leadsheet. Per bar: detected chord per half bar (DSL heuristic), velocity range, melody\n"
        "and bass onsets; CHORDS = the intended harmony as written (@beat = change off the downbeat).\n\n" +
        T.intended_leadsheet(s, HARM, s.leadsheet()))
    s.to_midi(os.path.join(HERE, "score.mid"))
    s.to_json(os.path.join(HERE, "score.json"))
    for i, sec in enumerate(tl["sections"], 1):
        s.pianoroll(os.path.join(HERE, f"roll_{i:02d}_{sec['name']}.png"), t0=max(0, sec["t_start"] - 0.5),
                    t1=sec["t_end"] + 0.5)
    s.pianoroll(os.path.join(HERE, "roll_full.png"))
    return s


if __name__ == "__main__":
    main()
