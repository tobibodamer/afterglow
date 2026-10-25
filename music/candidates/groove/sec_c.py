"""Bars 41-52: bridge (C minor, half-time, straight, rubato) and build (C pedal = V of F, rhythm doubles each bar).

Bridge = the breakdown: groove, swing and the RH comping all removed. Bass on 1, soft 5th on 2, chord on 3
(half-time backbeat), a tenor passing note on the "&" of 4.  A new, long-note melody: sequences
(Eb-D-C | D-C-Bb), (C-Ab-G | C-B-Ab: the augmented 2nd), then the hook's rising 6th in minor (G4 -> Eb5) over
the line cliche C-B-Bb-A, climbing to Ab5 and cascading down a diminished-7th (Ab F D B) into the build.

Build = a produced riser: dotted-quarter hits (3+3+2) -> LH 8ths -> RH 16th tremolo -> 16th sweep, top line
Eb-F-G-Ab rising each bar (Ab = the minor b13 of C, so the climax's A natural feels like sunrise),
accelerando 74 -> 80 and crescendo, then a dry hit, pedal up and a real silence (+0.5 s).
"""
import lib


def bridge(W):
    W.set_vel(mel=62, inner=33, acc=37, bass=46)
    s = W.s
    lib.extend(s, 40, 12, "Eb5", 12)          # the sus4 Eb of chorus 2 becomes the 3rd of Cm
    W.chg(41, 0, "Cm9")
    W.ev("L", 41, "0:C2:4 4:G2:4-12 8:Eb3+Bb3:6-2 14:D4:2-10")
    W.ev("R", 41, "0:G4:12-4")
    W.chg(42, 0, "Abmaj7#11")
    W.ev("L", 42, "0:Ab1:4 4:Eb3:4-12 8:C3+G3:6-2 14:Bb3:2-10")
    W.ev("R", 42, "0:Eb4:12-4")
    W.chg(43, 0, "Fm9")
    W.ev("L", 43, "0:F1:4 4:C3:4-12 8:Eb3+Ab3:6-2 14:G3:2-10")
    W.ev("R", 43, "0:Eb4:8-4 8:C4:8-6")
    W.chg(44, 0, "G7sus4"); W.chg(44, 8, "G7b9")
    W.ev("L", 44, "0:G1:4 4:F3+C4:4-6 8:G1:3-6 11:F3+B3:5-4")
    W.ev("R", 44, "0:D4:8-4 8:F4:8-4")
    W.chg(45, 0, "Cm(add9)"); W.chg(45, 8, "Cm(maj7)")
    W.ev("L", 45, "0:C2:2 2:Eb3+C4:6-4 8:C2:2-8 10:Eb3+B3:6-4")
    W.ev("R", 45, "0:Eb4:4-4 4:G4:12-4")
    W.chg(46, 0, "Cm7"); W.chg(46, 8, "Cm6")
    W.ev("L", 46, "0:C2:2 2:Eb3+Bb3:6-4 8:C2:2-8 10:Eb3+A3:4-4 14:G3:2-10")
    W.ev("R", 46, "0:G4:8-4 8:C5+Eb5:8-4")
    W.chg(47, 0, "Abmaj9"); W.chg(47, 8, "Fm9")
    W.ev("L", 47, "0:Ab1:4 4:C3+G3:4-4 8:F1:3-2 11:Eb3+Ab3:5-4")
    W.ev("R", 47, "0:C5+Eb5:8-2 8:Ab4+C5:8-2")
    W.chg(48, 0, "Dm7b5"); W.chg(48, 8, "G7b9")
    W.ev("L", 48, "0:D2:2 2:F3+C4:6-4 8:G1:2 10:F3+B3:6-2")
    W.ev("R", 48, "0:C5:8-2 8:F4:8-2")
    W.mel(41, "D5:2- C5:2 | "
              "D5:12> C5:2- Bb4:2- | "
              "C5:8 Ab4:4- G4:4- | "
              "C5:8> B4:4 Ab4:4- | "
              "G4:4- Eb5:12> | "
              "D5:4 Eb5:2- F5:2 G5:8> | "
              "Ab5:8> G5:4 F5:4- | "
              "Ab5:4> F5:4 D5:2 B4:6-", step=12)
    lib.ramp(s, (45, 0), (48, 0), 1.0, 1.12)


def build(W):
    W.set_vel(mel=72, inner=58, acc=58, bass=62)
    s = W.s
    W.chg(49, 0, "Abmaj7/C")
    W.ev("L", 49, "0:C2+C3:5 6:C2+C3:5 12:C2+C3:3")
    W.ev("R", 49, "0:Ab4+C5:5 6:Ab4+C5:5 12:C5+Eb5:3")
    W.chg(50, 0, "Bb/C")
    W.ev("L", 50, "0:C2+C3:2+4 2:C2+C3:2-10 4:C2+C3:2-8 6:C2+C3:2+4 8:C2+C3:2-10 10:C2+C3:2-8 "
                  "12:C2+C3:2+4 14:C2+C3:2-8")
    W.ev("R", 50, "0:Bb4+D5:5 6:Bb4+D5:5 12:D5+F5:3")
    W.chg(51, 0, "C9sus4"); W.chg(51, 12, "C7sus4(b13)")
    W.ev("L", 51, "0:C2+C3:2+4 2:C2+C3:2-8 4:C2+C3:2-6 6:C2+C3:2+4 8:C2+C3:2-6 10:C2+C3:2-4 "
                  "12:C2+C3:2+5 14:C2+C3:2-2")
    W.ev("R", 51, "1:Bb4+D5:1-16 2:C5:1-18 3:Bb4+D5:1-14 4:C5:1-16 5:Bb4+D5:1-12 6:C5:1-14 7:Bb4+D5:1-12 "
                  "8:C5:1-12 9:Bb4+D5:1-10 10:C5:1-12 11:Bb4+D5:1-8 13:C5+F5:1-8 14:Eb5:1-10 15:C5+F5:1-6")
    W.chg(52, 0, "C7b9"); W.up(52, 9)
    W.ev("L", 52, "0:C2+C3:2 2:C2+C3:2-6 4:C2+C3:2-3 6:C2+C3:2")
    for n in W.ev("L", 52, "8:C2+C3:2+10"):
        n.tags.append("dry")
    W.ev("R", 52, "8:Db5+E5+G5:2+4")
    W.mel(49, "Eb5:6 Eb5:6 G5:4> | "
              "F5:6 F5:6 Bb5:4> | "
              "G5:12> Ab5:4> | "
              "r:1 C4:1- E4:1- G4:1 Bb4:1 Db5:1 E5:1 G5:1 Bb5:2 r:4 C5:2-")
    lib.ramp(s, (49, 0), (52, 9), 0.8, 1.24)
    # the climax pickup C5 comes out of the silence softly, not at the riser's peak
    lib.find_note(s, 52, 14, "C5").vel = 70


def write(W):
    bridge(W)
    build(W)
