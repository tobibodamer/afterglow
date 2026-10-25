"""Bars 25-40: verse 2 (lazy), pre-chorus 2 (fuller, LH fill instead of a drop), chorus 2 (countermelody,
octave melody, deceptive cadence into the C-minor bridge)."""
import lib
from sec_a import HOOK_2, HOOK_4


def verse2(W):
    # 25-28  - hats.  The LH turns into a bass player: long root, snare pushed to the "&" of 2 (lazy),
    # walking octave, ghost, chromatic approach; RH answers with a backbeat dyad only under held notes.
    W.set_vel(mel=66, inner=40, acc=42, backbeat=46, bass=54, ghost=26)
    s = W.s
    W.chg(25, 0, "Ebadd9")
    W.ev("L", 25, "0:Eb2:4 6:Bb2+G3:2!k 8:Eb3:2-12!b 11:Eb3:1!g 12:Bb2+G3:2!k 14:Eb2:2-2!g")
    W.chg(26, 0, "Bb/D"); W.up(26, 14)
    W.ev("L", 26, "0:D2:4 6:F3+Bb3:2!k 8:D3:2-12!b 11:D3:1!g 12:F3+Ab3:2!k 14:Db2:2-4!g")
    W.ev("R", 26, "12:D4+F4:2-4")
    W.chg(27, 0, "Cm9"); W.up(27, 14)
    W.ev("L", 27, "0:C2:4 6:Eb3+Bb3:2!k 8:G2:2-12!b 11:G2:1!g 12:Eb3+G3:2!k 14:B1:2-4!g")
    W.ev("R", 27, "12:G4+Bb4:2-4")
    W.chg(28, 0, "Bbm9"); W.chg(28, 8, "Eb7b9"); W.up(28, 14)
    W.ev("L", 28, "0:Bb1:3 4:Db3+Ab3:2!k 7:F2:1!g 8:Eb2:3 12:G3+Db4:2!k 14:Gb1:1!g 15:Gb1:1+1!g")
    # the chorus' last Eb5 rings over the barline into verse 2 (I), then the verse tune, laid back and more syncopated
    lib.extend(s, 24, 12, "Eb5", 2)
    W.mel(25, "r:2 Bb4:1- G4:1- Bb4:1 C5:2> Bb4:1- G4:2 F4:6 | "
              "r:2 F4:1- G4:1 Bb4:1 Bb4:1- C5:1 D5:3> C5:2- Bb4:4 | "
              "r:2 G4:1- Bb4:1 Eb5:3> F5:1 Eb5:2- D5:6 | "
              "Db5:2> C5:1- Bb4:3 Ab4:2- G4:6 r:2")


def pre2(W):
    # 29-32  + a "backing vocal" a third/sixth under the melody (RH), + 16th ghost ticks in the LH.
    # No drop this time: the pedal lifts and the LH plays a dry 16th fill down into chorus 2.
    W.set_vel(mel=70, inner=46, acc=48, backbeat=52, bass=58, ghost=25)
    W.chg(29, 0, "Fm9"); W.up(29, 14)
    W.ev("L", 29, "0:F1:3 4:Eb3+Ab3:2!k 6:F2:1!g 7:F2:1-4!g 10:F1:2-3 12:Eb3+G3:2!k 14:F2:1!g 15:F#1:1!g")
    W.ev("R", 29, "2:Ab4:1 3:Ab4:1 4:Ab4:2 6:G4:1 7:Ab4:3 10:C5:4")
    W.chg(30, 0, "Gm7"); W.up(30, 14)
    W.ev("L", 30, "0:G1:3 4:F3+Bb3:2!k 6:G2:1!g 7:G2:1-4!g 10:G1:2-3 12:F3+A3:2!k 14:G2:1!g 15:A1:1!g")
    W.ev("R", 30, "2:Bb4:1 3:Bb4:1 4:Bb4:2 6:A4:1 7:Bb4:3 10:D5:4")
    W.chg(31, 0, "Ab(add9)"); W.chg(31, 8, "Adim7")
    W.ev("L", 31, "0:Ab1:3 4:Eb3+C4:2!k 6:Ab2:1!g 7:Ab2:1-4!g 8:A1:3+3 12:Eb3+Gb3+C4:2!k 14:A1:1-2!g 15:A1:1!g")
    W.ev("R", 31, "2:C5:1 3:C5:1 4:C5:2 6:C5:2 8:C5+Eb5:6+2 14:C5:2")
    W.chg(32, 0, "Bb13sus4"); W.chg(32, 8, "Bb7(13)"); W.up(32, 12)
    W.ev("L", 32, "0:Bb1:3 4:Ab3+C4:2!k 6:Bb2:1!g 7:Bb2:1-4!g 8:Bb1:2+2 10:D3+Ab3:2!k")
    for n in W.ev("L", 32, "12:Bb2:1-16!b 13:Ab2:1-14!b 14:F2:1-12!b 15:A1:1-10!b"):
        n.tags.append("dry")            # dry 16th fill (pedal up) instead of pre 1's drop
    W.ev("R", 32, "0:C5:2 2:G4+C5:6+3 8:F4+Ab4:4+4")
    W.mel(29, "r:2 C5:1- C5:1 C5:2 Bb4:1- C5:3 Eb5:4> r:2 | "
              "r:2 D5:1- D5:1 D5:2 C5:1- D5:3 F5:4> r:2 | "
              "r:2 Eb5:1- Eb5:1 Eb5:2 F5:2 Gb5:6> F5:2- | "
              "F5:2 Eb5:6> D5:4 r:2 Bb4:2-")
    lib.ramp(W.s, (29, 0), (33, 0), 0.92, 1.12)


def chorus2(W):
    # 33-40  + tenor countermelody (LH thumb) answering the melody's long notes in contrary motion,
    # + denser comping, octave melody + LH octave pushes in 37-38 (anticipated bass, pedal changes on the push).
    # Bar 40: the groove drops out on beat 3, the sus4 Eb is held over and becomes the minor 3rd of Cm (V -> vi).
    W.set_vel(mel=84, inner=50, acc=52, backbeat=56, bass=64, ghost=27, counter=52)
    s = W.s
    W.chg(33, 0, "Abmaj9"); W.up(33, 14)
    W.ev("L", 33, "0:Ab1:3 4:Eb3+G3+C4:2!k 6:Ab2:1-3!g 7:Ab2:1!g 10:Ab1:2-3 12:Eb3+G3:2!k 14:Bb2:1!g 15:A1:1!g")
    W.ev("R", 33, "2:C5+Eb5:1 6:Ab4+C5:1-6 10:C5+Eb5:1-3 12:G4+C5:1-6")
    W.chg(34, 0, "Bb13sus4"); W.chg(34, 8, "Bb7(13)")
    W.ev("L", 34, "0:Bb1:3 4:Ab3+C4:2!k 8:Bb1:2-2 10:F3:2!c 12:G3:1-2!c 13:Ab3:1!c 14:C4:2+3!c")
    W.ev("R", 34, "2:G4+Bb4:1 6:G4+Bb4:1-4")
    W.chg(35, 0, "Gm7"); W.up(35, 14)
    W.ev("L", 35, "0:G1:3 4:F3+Bb3:2!k 6:G2:1-3!g 7:G2:1!g 10:G1:2-3 12:F3+A3:2!k 14:B1:2!g")
    W.ev("R", 35, "2:D4+F4:1 8:Bb4+D5:2-2 11:Bb4+D5:1-6 13:A4+D5:1-6")
    W.chg(36, 0, "Cm9"); W.chg(36, 8, "Cm9/Bb")
    W.ev("L", 36, "0:C2:3 4:Eb3+Bb3:2!k 8:Bb1:2-2 10:G3:1!c 11:Bb3:1-2!c 12:C4:2!c 14:D4:2+3!c")
    W.ev("R", 36, "2:G4+Bb4:1 6:G4+Bb4:1-4")
    # 37-38: octave melody; the LH pushes the bass a 16th-pair early ("&" of 4) and the pedal changes on the push
    W.chg(37, 0, "Abmaj9")
    W.ev("L", 37, "0:Ab1+Ab2:5 6:Ab1+Ab2:4+3 12:Eb3+G3:2-8 14:Ab2:2-8!g")
    W.ev("R", 37, "0:C5+Eb5:5-6 12:Eb5:4-6")
    W.chg(38, 0, "Bb/Ab"); W.chg(38, 14, "Gm7 (push)")
    W.ev("L", 38, "0:Ab1+Ab2:5 6:Ab1+Ab2:4+3 12:F3+Bb3:2-8 14:G1+G2:5+4")
    W.ev("R", 38, "2:F5:6-6 12:Bb4:4-6")
    W.chg(39, 8, "C7b9"); W.up(39, 14)
    W.ev("L", 39, "4:F3+Bb3:2!k 6:G2:1-3!g 7:G2:1!g 8:C2:3 11:G2:1!g 12:E3+Bb3:2!k 14:Gb1:2!g")
    W.ev("R", 39, "2:G4+Bb4:1 6:G4+Bb4:1-4 10:Bb4+Db5:1 13:Bb4+Db5:1-6")
    W.chg(40, 0, "Fm9"); W.chg(40, 8, "Bb9sus4")
    W.ev("L", 40, "0:F1:3 4:Eb3+Ab3:2!k 7:F2:1!g 8:Bb1:2-4 10:Eb3+Ab3:6-10")
    W.ev("R", 40, "2:Ab4+C5:1 8:F4:8-8")
    W.mel(33, "G5:6 F5:1- Eb5:1- F5:2 G5:1- F5:1- Eb5:2 Bb4:2- | "
              "C5:2 Eb5:6> D5:6 r:2 | "
              "r:2 Bb4:1- Bb4:1 C5:1 D5:1 Eb5:1- D5:1 F5:6> Eb5:2~ | "
              "Eb5:4 D5:4 C5:6 Bb4:2- | "
              "G5:6 F5:1- Eb5:1- F5:2 G5:2 Bb5:4>~ | "
              "Bb5:2 C6:6> Bb5:2 G5:2 F5:4 | " + HOOK_4)
    lib.double_octave(s, 37, 38, min16=2, dv=-16)
    lib.ramp(s, (40, 8), (41, 0), 1.0, 0.84)


def write(W):
    verse2(W)
    pre2(W)
    chorus2(W)
