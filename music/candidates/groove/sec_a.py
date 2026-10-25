"""Bars 1-24: intro, verse 1, pre-chorus 1 (with the first drop), chorus 1 (the groove enters).

Event grammar (lib.Writer.ev):  STEP:PITCH(+PITCH):DUR16[+-vel][@vel][!voice][^]
voices: b bass (kick), k backbeat (LH snare shell), g ghost, c counter (tenor line), s acc, i inner (RH), m mel
Melody (lib.Writer.mel): DSL tokens with durations in 16ths.

Arrangement ("each section adds or removes one element"):
  intro    rolled chorus chords + the hook's leap and sigh only (response withheld), free time
  verse 1  + the real bass line (stepwise descent) and a moving tenor; melody low and conversational
  pre 1    + 8th-note shell pulse (the heartbeat that hints at the groove); ends on a dry stab + DROP
  chorus 1 + the groove: kick (LH 5th finger), snare (tenor shell on 2/4), ghosts, swung 16ths, RH "hats"
"""

# ------------------------------------------------------------------------------------------------
# the hook (Eb).  alpha = Bb4 -> G5 leap into a held 3rd + turn; beta = sus-appoggiatura on the "&" of 1;
# gamma = repeated-note 16th pickup rising by step; late chromatic E-natural.
# bar 1 ends in a tresillo (3+3+2 sixteenths) so the hook itself carries the hip-hop syncopation.
# ------------------------------------------------------------------------------------------------
HOOK_1 = ("G5:6 F5:1- Eb5:1- F5:3 Eb5:3 Bb4:2- | "            # alpha  (Abmaj9)
          "C5:2 Eb5:6> D5:6 r:2 | ")                          # beta   (Bb13sus -> Bb7)
HOOK_2 = ("r:2 Bb4:1- Bb4:1 C5:2 D5:2 F5:6> Eb5:2~ | "         # gamma  (Gm7)
          "Eb5:4 D5:4 C5:6 Bb4:2- | ")                        # 9-8 sigh (Cm9 | Cm9/Bb)
HOOK_3 = ("G5:6 F5:1- Eb5:1- F5:2 G5:2 Bb5:4>~ | "             # alpha climbs (Abmaj9)
          "Bb5:2 C6:6> Bb5:2 G5:2 F5:4 | ")                   # apex C6 on the "&" of 1 (Bb/Ab)
HOOK_4 = ("D5:2 F5:4 Eb5:2 E5:4> G5:2 F5:2~ | "                # the one chromatic note E (Gm7 | C7b9)
          "F5:4 Eb5:2 C5:2 Ab4:2 C5:2 Eb5:4")                 # cadence (6-4-6-1), Eb held over the barline


def intro(W):
    # 1-4  free time (68 -> 60), pedal wash, rolled bloom: bass, shell an 8th later, colour note on top.
    W.set_vel(mel=50, inner=27, acc=28, bass=36)
    W.chg(1, 0, "Abmaj9")
    W.ev("L", 1, "0:Ab1:2 2:Eb3+C4:14-2")
    W.ev("R", 1, "4:G4:4-2")
    W.chg(2, 0, "Bb13sus4"); W.chg(2, 8, "Bb7(13)")
    W.ev("L", 2, "0:Bb1:2 2:Ab3+C4:6-2 8:Bb1:2-5 10:D3+Ab3:6-4")
    W.ev("R", 2, "2:G4:14-3")
    W.chg(3, 0, "Gm9")
    W.ev("L", 3, "0:G1:2 2:F3:14-2 2:Bb3:6-2 8:A3:8-4")
    W.ev("R", 3, "2:D4+G4:4-3")
    W.chg(4, 0, "Cm9"); W.chg(4, 8, "Bb9sus4")
    W.ev("L", 4, "0:C2:2 2:Eb3+Bb3:6-2 8:Bb1:2 10:Eb3+Ab3:6-3")
    W.ev("R", 4, "0:G4:8-3 8:F4:8-4")
    # alpha leap + beta sigh, then a P5 echo of the leap and a falling line that stops on the 9th (unresolved)
    W.mel(1, "r:6 Bb4:2- G5:8 | r:2 Eb5:6> D5:8- | r:6 Bb4:2- F5:6 Eb5:2- | D5:6 Eb5:2- C5:8")


def verse1(W):
    # 5-12  ballad.  Bass walks down Eb D C Bb (Eb) Ab Ab G Gb F Bb; the tenor answers the melody's long notes
    # (9->10 sigh, C4-Bb3-G3 / Cb4-Ab3-F3 parallel in bars 9-10 = the borrowed-minor tear in the inner voice).
    W.set_vel(mel=58, inner=34, acc=34, bass=43)
    W.chg(5, 0, "Ebadd9")
    W.ev("L", 5, "0:Eb2:3 3:Bb2:3-2 6:G3:4 10:F3:2-6 12:G3:4-4")
    W.chg(6, 0, "Bb/D")
    W.ev("L", 6, "0:D2:3 4:F3+Bb3:4-2 8:C4:2-6 10:Bb3:2-6 12:F3:4-4")
    W.chg(7, 0, "Cm9")
    W.ev("L", 7, "0:C2:3 3:G2:3-2 6:Eb3+Bb3:4 10:D4:2-6 12:Bb3:4-4")
    W.chg(8, 0, "Bbm9"); W.chg(8, 8, "Eb7b9")
    W.ev("L", 8, "0:Bb1:3 3:Db3+Ab3:5-2 8:Eb2:3 11:G3+Db4:5-3")
    W.ev("R", 8, "8:Fb4:6-2")
    W.chg(9, 0, "Abmaj9")
    W.ev("L", 9, "0:Ab1:3 3:Eb3:3-2 6:C4:4 10:Bb3:2-6 12:G3:4-4")
    W.chg(10, 0, "Abm6")
    W.ev("L", 10, "0:Ab1:3 3:Eb3:3-2 6:Cb4:4 10:Ab3:2-6 12:F3:4-4")
    W.chg(11, 0, "Eb/G"); W.chg(11, 8, "Gbdim7")
    W.ev("L", 11, "0:G1:3 3:Eb3+Bb3:5-2 8:Gb1:3 11:Eb3+A3:5-2")
    W.ev("R", 11, "8:Eb4:4-2")
    W.chg(12, 0, "Fm11"); W.chg(12, 8, "Bb9sus4")
    W.ev("L", 12, "0:F1:3 3:C3+Ab3:5-2 8:Bb1:3 11:Eb3+Ab3:5-3")
    W.ev("R", 12, "8:Eb4+F4:6-2")
    # a  : pentatonic flow ending on the 9th  /  a' : same rhythm, answers up to D5
    # b  : leap G4-Bb4-Eb5 (the hook's rising 6th in miniature) then the bluesy Db5 over Bbm9
    # c  : bars 9-10 the same figure twice, the second time with Cb (the borrowed iv) / A natural leading tone
    W.mel(5, "r:2 Bb4:1- G4:1- Bb4:2 C5:2 Bb4:2 G4:2- F4:4 | "
             "r:2 F4:1- G4:1 Bb4:2 Bb4:1- C5:1 D5:3> C5:1- Bb4:4 | "
             "r:2 G4:1- Bb4:1 Eb5:4> D5:2 C5:2- D5:4 | "
             "Db5:3> C5:1- Bb4:2 Ab4:2- G4:6 r:2 | "
             "r:2 Bb4:1- C5:1 Eb5:3> C5:1- Bb4:2 Ab4:2- C5:4 | "
             "r:2 Bb4:1- Cb5:1 Eb5:3> Db5:1- Cb5:6 Bb4:2- | "
             "Bb4:2 G4:1- Bb4:1 Eb5:3> D5:1- C5:6 A4:2- | "
             "Bb4:2 C5:1- Bb4:1- Ab4:4 Bb4:6- r:2")


def pre1(W):
    # 13-16  gamma sequenced up a step per bar over the chromatic bass rise F G Ab A Bb; 8th shell pulse;
    # bar 16: sus sigh, dry stab on 3, then a real DROP (pedal up, one beat of silence) before the pickup.
    W.set_vel(mel=62, inner=40, acc=40, bass=48)
    W.chg(13, 0, "Fm9")
    W.ev("L", 13, "0:F1:3 4:Eb3+Ab3:2 6:Eb3+Ab3:2-6 8:F2:2-2 10:Eb3+Ab3:2-3 12:Eb3+G3:4")
    W.ev("R", 13, "10:Ab4+C5:4")
    W.chg(14, 0, "Gm7")
    W.ev("L", 14, "0:G1:3 4:F3+Bb3:2+1 6:F3+Bb3:2-5 8:G2:2-1 10:F3+Bb3:2-2 12:F3+A3:4+1", vel_scale=1.05)
    W.ev("R", 14, "10:Bb4+D5:4+2")
    W.chg(15, 0, "Ab(add9)"); W.chg(15, 8, "Adim7")
    W.ev("L", 15, "0:Ab1:3 4:Eb3+C4:2+3 6:Eb3+Bb3:2-2 8:A1:3+4 12:Eb3+Gb3+C4:4+4", vel_scale=1.08)
    W.ev("R", 15, "8:C5+Eb5:6+5")
    W.chg(16, 0, "Bb13sus4"); W.chg(16, 8, "Bb7(13) stab", kind="up")
    W.ev("L", 16, "0:Bb1:3+8 4:Ab3+C4:2+6 6:Ab3+C4:2+2", vel_scale=1.1)
    for n in W.ev("L", 16, "8:Bb1+Bb2:2+12"):
        n.tags.append("dry")
    W.ev("R", 16, "2:G4+C5:6+6 8:F4+Ab4:2+10")
    W.mel(13, "r:2 C5:1- C5:1 C5:2 Bb4:1- C5:3 Eb5:4> r:2 | "
              "r:2 D5:1- D5:1 D5:2 C5:1- D5:3 F5:4> r:2 | "
              "r:2 Eb5:1- Eb5:1 Eb5:2 F5:2 Gb5:6> F5:2- | "
              "F5:2 Eb5:6> D5:2 r:4 Bb4:2-")


def chorus1(W):
    # 17-24  boom-bap stride: kick = bass (1, "a" of 2 ghost, "&" of 3), snare = tenor shell on 2 and 4,
    # chromatic approach ghosts on the last 16ths; RH thumb plays off-beat "hats" (steps 2 and 10).
    # Pedal: legato change per chord, plus a dry lift on the "&" of 4 wherever a chromatic approach ghost plays
    # (rhythmic pedalling: the approach sounds dry instead of smearing against the old bass); bar 22 pushes the
    # next bass (G1) on the "&" of 4 instead, with the pedal changing on the push.
    W.set_vel(mel=76, inner=45, acc=46, backbeat=50, bass=58, ghost=27, counter=46)
    W.chg(17, 0, "Abmaj9"); W.up(17, 14)
    W.ev("L", 17, "0:Ab1:3 4:Eb3+G3+C4:2!k 7:Ab2:1!g 10:Ab1:2-4 12:Eb3+G3:2!k 14:A1:2!g")
    W.ev("R", 17, "2:C5+Eb5:1 10:Ab4+C5:1-3")
    W.chg(18, 0, "Bb13sus4"); W.chg(18, 8, "Bb7(13)"); W.up(18, 14)
    W.ev("L", 18, "0:Bb1:3 4:Ab3+C4:2!k 8:Bb1:3-3 12:D3+Ab3:2!k 14:Bb2:1!g 15:Ab1:1!g")
    W.ev("R", 18, "2:G4+Bb4:1 10:G4+Bb4:1-3")
    W.chg(19, 0, "Gm7"); W.up(19, 14)
    W.ev("L", 19, "0:G1:3 4:F3+Bb3:2!k 7:G2:1!g 10:G1:2-4 12:F3+A3:2!k 14:B1:2!g")
    W.ev("R", 19, "2:D4+F4:1 10:Bb4+D5:1-3")
    W.chg(20, 0, "Cm9"); W.chg(20, 8, "Cm9/Bb"); W.up(20, 14)
    W.ev("L", 20, "0:C2:3 4:Eb3+Bb3:2!k 7:C3:1!g 8:Bb1:3-3 12:Eb3+G3:2!k 14:A1:1!g 15:A1:1-3!g")
    W.ev("R", 20, "2:G4+Bb4:1 10:Eb4+G4:1-3")
    W.chg(21, 0, "Abmaj9")
    W.ev("L", 21, "0:Ab1:3+2 4:Eb3+G3:2!k 7:Ab2:1!g 10:Ab1:2-3 12:Eb3+G3+C4:2!k")
    W.ev("R", 21, "2:C5+Eb5:1 10:C5+Eb5:1-2")
    W.chg(22, 0, "Bb/Ab"); W.chg(22, 14, "Gm7 (push)")
    W.ev("L", 22, "0:Ab1:3+2 4:D3+F3+Bb3:2!k 10:Ab1:2-3 12:D3+F3+Bb3:2!k 14:G1:6+4!b")
    W.ev("R", 22, "2:D5+F5:1+2 10:Bb4+D5:1")
    W.chg(23, 8, "C7b9"); W.up(23, 14)
    W.ev("L", 23, "4:F3+Bb3:2!k 8:C2:3 11:G2:1!g 12:E3+Bb3:2!k 14:Gb1:2!g")
    W.ev("R", 23, "2:G4+Bb4:1 10:Bb4+Db5:1")
    W.chg(24, 0, "Fm9"); W.chg(24, 8, "Bb9sus4"); W.up(24, 13)
    W.ev("L", 24, "0:F1:3 4:Eb3+Ab3:2!k 7:F2:1!g 8:Bb1:3-2 12:Eb3+Ab3:1!k 13:Bb1:1+4!g 14:C2:1+5!g 15:D2:1+6!g")
    W.ev("R", 24, "2:Ab4+C5:1 10:F4+Ab4:1-2")
    W.mel(17, HOOK_1 + HOOK_2 + HOOK_3 + HOOK_4)


def write(W):
    intro(W)
    verse1(W)
    pre1(W)
    chorus1(W)
