"""Bars 53-69: climax (F major), tag, final A, coda.

Climax: the hook up a whole step in RH octaves with an inner chord tone on long notes; LH octave pushes:
the next bar's root octave is anticipated on the "a" of 4 and tied over (the pedal changes on the push),
an octave on the "a" of 2, a tenor shell on 4.  Apex F6 once (bar 58) over C7sus4/Bb, so it is a chord tone
(the brief's C/Bb would put F against E).  Bar 60 ends with a dry octave walk-up C-D-E into the tag's tonic.
Tag: the first fortissimo tonic of the piece, alpha echoed in octaves, decaying through a fermata.
Final A: the hook alone, pp.  Coda: IVmaj9 -> ivm6 -> Iadd9 with the melody 3-2-1-2 | 1-b6 | 5,
final ritardando (Friberg & Sundberg), rolled last chord, ring, pedal release ramp.
"""
import lib


def climax(W):
    W.set_vel(mel=95, inner=70, acc=68, backbeat=70, bass=84, ghost=30, counter=62)
    s = W.s
    W.chg(53, 0, "Bbmaj9"); W.chg(53, 14, "C13sus4 (push)")
    W.ev("L", 53, "0:Bb1+Bb2:5+8 6:Bb1+Bb2:4+3 12:F3+A3:2-10!k 14:C2+C3:6+2")
    W.ev("R", 53, "0:D5+F5:6-6 8:C5:3-8")
    # 2-bar cycle: bars 53/55/57/59 push the next bass on the "a" of 4 (pedal changes on the push),
    # bars 54/56/58 hand the downbeat back (the bass lands on 1) so the pulse never gets lost.
    W.chg(54, 8, "C7(13)")
    W.ev("L", 54, "4:Bb3:2-10!k 8:C2+C3:2 10:G3:1!c 11:Bb3:1!c 12:C4:2+2!c")
    W.ev("R", 54, "2:Bb4+D5:6-6 8:Bb4:6-8")
    W.chg(55, 0, "Am7"); W.chg(55, 14, "Dm9 (push)")
    W.ev("L", 55, "0:A1+A2:4+6 4:G3+C4:2-8!k 6:A1+A2:4+2 12:E3+G3:2-8!k 14:D2+D3:6+2")
    W.ev("R", 55, "8:C5+E5:6-6")
    W.chg(56, 8, "Dm9/C")
    W.ev("L", 56, "4:F3+C4:2-8!k 8:C2+C3:4 12:F3+A3:2-8!k")
    W.ev("R", 56, "4:A4+C5:4-6 8:F4+A4:6-8")
    W.chg(57, 0, "Bbmaj9"); W.chg(57, 14, "C7sus4/Bb (push)")
    W.ev("L", 57, "0:Bb1+Bb2:4+6 4:D3+A3:2-8!k 6:Bb1+Bb2:4+3 12:F3+A3:2-8!k 14:Bb1+Bb2:6+3")
    W.ev("R", 57, "0:D5+F5:6-6 12:F5+G5:4-6")
    W.ev("L", 58, "4:F3+C4:2-8!k 6:Bb1+Bb2:4+4 12:F3+G3:2-8!k")
    W.ev("R", 58, "4:G5+C6:6-4")
    W.chg(59, 0, "Am7"); W.chg(59, 8, "D7b9"); W.chg(59, 14, "Gm9 (push)")
    W.ev("L", 59, "0:A1+A2:4+6 4:G3+C4:2-8!k 8:D2+D3:4 12:F#3+C4:2-8!k 14:G1+G2:6+2")
    W.ev("R", 59, "2:A4+C5:4-6 8:C5+Eb5:4-4")
    W.chg(60, 8, "C9sus4"); W.up(60, 13)
    W.ev("L", 60, "4:F3+Bb3:2-8!k 8:C2+C3:3 11:F3+Bb3:2-10!k")
    for n in W.ev("L", 60, "13:C2+C3:1-6!b 14:D2+D3:1-2!b 15:E2+E3:1+3!b"):
        n.tags.append("dry")
    W.ev("R", 60, "4:Bb4:2-8 8:G4+Bb4:2-10")
    W.mel(53, "A5:6> G5:1- F5:1- G5:3 F5:3 C5:2- | "                   # alpha, in octaves
              "D5:2 F5:6> E5:6 r:2 | "                                 # beta
              "r:2 C5:1- C5:1 D5:1 E5:1 F5:1- E5:1 G5:6> F5:2~ | "     # gamma, 16th flow
              "F5:4 E5:4 D5:6 C5:2- | "
              "A5:6 G5:1- F5:1- G5:2 A5:2 C6:4>~ | "
              "C6:2 D6:2 F6:6> D6:2 C6:2 A5:2- | "                     # apex F6, once
              "E5:2 G5:4 F5:2 F#5:4> A5:2 G5:2~ | "                    # the chromatic F#
              "G5:4 F5:2 D5:2 C5:2 D5:2 F5:2 G5:2>")
    lib.double_octave(s, 53, 60, min16=2, dv=-18, skip=((59, 0),))
    lib.find_note(s, 58, 4, "F6").vel += 2
    lib.ramp(s, (59, 8), (61, 0), 1.0, 1.06)


def tag(W):
    W.set_vel(mel=104, inner=72, acc=64, bass=84)
    s = W.s
    W.chg(61, 0, "Fadd9")
    W.ev("L", 61, "0:F1+F2:4 4:C3+G3+A3:12-6")
    W.ev("R", 61, "0:C5+F5:8-4 8:A4+C5:4-8 12:F4+A4:4-10")
    W.chg(62, 0, "Fmaj7/A"); W.up(62, 13)
    W.ev("L", 62, "0:A1+A2:4-6 4:F3+C4:10-10")
    W.ev("R", 62, "0:A4+C5:8-10")
    W.mel(61, "A5:8> G5:2 F5:2- C5:4 | E5:8- r:6 C5:2-")
    lib.double_octave(s, 61, 62, min16=8, dv=-18)
    lib.ramp(s, (61, 0), (62, 12), 1.0, 0.62)
    lib.find_note(s, 62, 14, "C5").vel = 50


def finalA(W):
    W.set_vel(mel=48, inner=25, acc=26, bass=31)
    W.chg(63, 0, "Bbmaj9")
    W.ev("L", 63, "0:Bb1:2 2:F3+C4:14-2 8:A3:8-4")
    W.ev("R", 63, "0:D5:5-3")
    W.chg(64, 0, "C13sus4"); W.chg(64, 8, "C7(13)")
    W.ev("L", 64, "0:C2:2 2:Bb3+D4:6-2 8:C2:2-4 10:G3+Bb3:6-4")
    W.ev("R", 64, "2:A4:6-3 8:Bb4:8-4")
    W.chg(65, 0, "Am7")
    W.ev("L", 65, "0:A1:2 2:E3+G3+C4:14-2")
    W.ev("R", 65, "8:C5:6-3")
    W.chg(66, 0, "Dm9")
    W.ev("L", 66, "0:D2:2 2:F3+C4:14-2 8:E4:8-5")
    W.ev("R", 66, "4:A4:4-3")
    W.mel(63, "A5:6 G5:1- F5:1- G5:3 F5:3 C5:2- | "
              "D5:2 F5:6> E5:8- | "
              "r:2 C5:1- C5:1 D5:2 E5:2 G5:6> F5:2~ | "
              "F5:4 E5:4 D5:6- C5:2-")


def coda(W):
    W.set_vel(mel=46, inner=25, acc=25, bass=30)
    W.chg(67, 0, "Bbmaj9")
    W.ev("L", 67, "0:Bb1:2 2:F3+A3:14-2 8:C4:8-4")
    W.ev("R", 67, "0:D5:6-3")
    W.chg(68, 0, "Bbm6")
    W.ev("L", 68, "0:Bb1:2 2:F3+Db4:14-2 8:G3:8-4")
    W.ev("R", 68, "0:Bb4:6-3 6:Ab4:2-6 8:F4:8-4")
    W.chg(69, 0, "Fadd9")
    W.ev("L", 69, "0:F1:2+4 2:C3+G3+A3:14-1")
    W.ev("R", 69, "4:F4+A4:12-3^")
    W.mel(67, "A5:6 G5:1- F5:1- G5:8- | F5:6 Db5:10> | r:4 C5:12")


def write(W):
    climax(W)
    tag(W)
    finalA(W)
    coda(W)


def shape(s, W):
    """The apex F6 is the single loudest note of the piece, inside the brief's 108-115."""
    mel = [n for n in s.notes if n.voice == "mel"]
    apex = max(mel, key=lambda n: n.pitch)
    apex.vel = int(min(115, max(110, apex.vel)))
    for n in s.notes:
        if n is not apex and n.vel > apex.vel - 4:
            n.vel = apex.vel - 4


def after_perform(s, W):
    """Final chord: keys held to the end of the (ritardando) bar; the pedal lets go in a natural 0.7 s ramp."""
    t_end = max(n.t_off for n in s.notes)
    lib.final_release(s, t_end + 0.35, ramp=0.7)
