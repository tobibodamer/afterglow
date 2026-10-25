"""Afterglow - hand-written accompaniment for every bar (no pattern generator), the harmony timeline and the pedal
plan. The tune itself is in afterglow_melody.py.

Event language (afterglow_lib.ev): PITCH@step/dur[:v][+N|-N][^][%f]   or   [P P P]@step/dur...
  step / dur in 16ths from the bar line (a dur may run over the bar line: ties, anticipations)
  v = voice: b bass (LH 5th finger: short key-hold, the pedal carries it), s shell / LH chord (the "snare" in the
             grooves), g ghost (velocity 18-32), c tenor countermelody (LH thumb), i RH inner voice / comping
  ^ = rolled chord, %f = pinned finger(s), low -> high
LH[bar] is the left hand, RH[bar] the right-hand notes under the melody. C4 = middle C.

Final-pass rules (from the three judges):
  - grooves: 3-note snare shells (never a bare fifth); the "a"-of-2 ghost is a soft dyad (octave + 5th above the
    kick, fix round 1: a single octave ghost was masked by the ringing kick); the chromatic approach ghost survives
    only in the dry phrase-end fills (bars 20, 24, 28, 32, 60); elsewhere the next harmony is ANTICIPATED on the "&"
    of 4 (bass + often an RH dyad), with the pedal change moving onto it
  - in the Abmaj9 hook bars the LH avoids G (the tune's Ab5 neighbour would rub against it)
  - arrivals (fix round 1): chorus 1 and 2 land with an LH octave and an RH dyad under the hook's G5; the climax
    lands with the bass octave and the RH chord above the riser's last hit
  - climax (fix round 2): the push / land groove at the arrival (53), then every bar its own LH: a tenor answer in
    contrary motion (54), the snare pushed onto the "&" of 2 (55), the tenor fill (56), an 8th tenor climb with the
    tune (57), and under the apex a tenor D4 -> C4 handing the line to the bass: the V root C2 is pushed in on the "&"
    of 4 of 57, so F6 is a real 4-3 over C, and the bass falls C -> Bb (58:3, C7/Bb) -> A (59); E only with E6 (3.5).
    Low end: the brief's floor is F1 (no Bb0; an open 5th Bb1-F2-Bb2 is mud: P4 below Bb2), so the climax's weight is
    a bass OCTAVE on every downbeat where the choruses have single notes, over a lowered riser; the tag lands on F1-F2
  - build (fix round 2): a tenor answer (49: alpha's leap in augmentation) and a falling inner wedge against the
    rising top; the sweep bar's LH octaves sit under the climax's arrival octave
"""

LH = {
    # ---------------- Intro (Eb, free 68 -> 60): rolled bloom, tenor C4-Bb3 | C4 | Bb3-A3 | Bb3-Ab3 ---------------
    1: "Ab1@0/2:b [Eb3 G3]@2/14:s^ C4@2/6:s^ Bb3@8/8:s-3",
    2: "Bb1@0/2:b [F3 Ab3 C4]@2/6:s^ Bb1@8/2:b-5 [D3 Ab3]@10/6:s-2",
    3: "G1@0/2:b F3@2/14:s^ Bb3@2/6:s^ A3@8/8:s",
    4: "C2@0/2:b [Eb3 Bb3]@2/6:s^ Bb1@8/2:b [Eb3 Ab3]@10/6:s^",

    # ---------------- Verse 1 (Eb, 76, ballad): every bar a different LH shape --------------------------------------
    5: "Eb2@0/3:b Bb2@3/5:s G3@6/4:s F3@10/2:s-4 G3@12/4:s-2",          # bloom, 10-9-10 in the tenor
    6: "D2@0/3:b F3@3/13:s Bb3@4/8:s D4@12/4:s-6",                       # held shell, tenor rises against the fall
    7: "C2@0/3:b G2@2/4:s Eb3@4/4:s Bb3@8/4:s Ab3@12/2:s-6 G3@14/2:s-6",  # Bb-Ab-G falls into bar 8's Ab3
    8: "Bb1@0/3:b Db3@3/3:s Ab3@4/4:s Eb2@8/3:b G3@11/3:s Db4@12/4:s-4",
    9: "Ab1@0/3:b [Eb3 C4]@2/6:s Bb3@8/4:s G3@12/4:s",                  # Db4 -> C4 (7th of Eb7 resolves), C-Bb-G
    10: "Ab1@0/4:b [Cb3 F3 Ab3]@4/8:s^ Eb3@12/2:s-4 F3@14/2:s-6",        # held rolled iv6 under the tear
    11: "G1@0/3:b [Eb3 Bb3]@3/5:s Gb1@8/3:b [Eb3 A3]@11/5:s",
    12: "F1@0/3:b [Eb3 Ab3]@3/5:s Bb1@8/3:b [Eb3 Ab3]@11/3:s C4@14/2:s-6",

    # ---------------- Pre 1 (rising bass F-G-Ab-A-Bb; the pulse thickens; dry stab + DROP) -------------------------
    13: "F1@0/2:b C3@2/2:s-6 Eb3@4/4:s Ab3@6/6:s G3@12/4:s-4",
    14: "G1@0/3:b [F3 Bb3]@4/2:s [F3 Bb3]@6/2:s-5 G2@8/2:b-6 [F3 Bb3]@10/2:s-3 [F3 A3]@12/4:s",
    15: "Ab1@0/2:b [Eb3 C4]@2/2:s [Eb3 C4]@4/2:s-4 [Eb3 Bb3]@6/2:s-6 A1@8/2:b [Eb3 C4]@10/2:s "
        "[Eb3 Gb3 C4]@12/2:s-4 [Eb3 Gb3 C4]@14/2:s-2",
    16: "Bb1@0/3:b [Ab3 C4 Eb4]@2/2:s [Ab3 C4 Eb4]@4/2:s-4 [Ab3 C4 Eb4]@6/2:s-2 [Bb1 Bb2]@8/1:b+4",

    # ---------------- Chorus 1 (boom-bap stride: kick 1, snare 2, ghost "a" of 2, kick "&" of 3, snare 4) -------
    17: "[Ab1 Ab2]@0/3:b+8 [Eb3 Bb3 C4]@4/2:s [Ab2 Eb3]@7/1:g Ab1@10/2:b-4 [Eb3 Bb3 C4]@12/2:s",    # arrival: 8ve
    18: "Bb1@0/3:b [Ab3 C4 Eb4]@4/2:s [Bb2 F3]@7/1:g Bb1@8/2:b-2 [F3 Ab3 D4]@12/2:s",
    19: "G1@0/3:b [F3 Bb3 D4]@4/2:s [G2 D3]@7/1:g G1@10/2:b-4 [F3 Bb3 D4]@12/2:s C2@14/4:b",      # Cm9 anticipated
    20: "[Eb3 Bb3 D4]@4/2:s [C3 G3]@7/1:g Bb1@8/3:b [Eb3 G3 C4]@12/1:s G2@13/1:g G1@14/2:g",  # dry fill
    21: "Ab1@0/3:b [Eb3 Bb3 C4]@4/2:s [Ab2 Eb3]@7/1:g Ab1@10/2:b-4 [Eb3 Bb3 C4]@12/2:s Ab2@15/1:g",
    22: "Ab1@0/3:b [F3 Bb3 D4]@4/2:s [Ab2 F3]@7/1:g Ab1@10/2:b-4 [F3 Bb3 D4]@12/2:s G1@14/4:b",   # Gm7 anticipated
    23: "[F3 Bb3 D4]@4/2:s [G2 D3]@7/1:g C2@8/3:b [E3 Bb3 Db4]@12/2:s F1@14/4:b",                # Fm9 anticipated
    24: "[Eb3 Ab3 C4]@4/2:s [F2 C3]@7/1:g Bb1@8/3:b [Eb3 Ab3 C4]@11/1:s C2@12/2:b-6 D2@14/2:b-4",  # dry walk-up

    # ---------------- Verse 2 (fix round 2: pulled back - the bass on 1 only, no ghosts, one shell pushed onto the "&"
    # of 2, a tenor sigh on beat 4, full legato pedal (the groove half pedal pauses); Bbm9 anticipated; dry fill) ----
    25: "Eb2@0/6:b [Bb2 F3 G3]@6/3:s-2 Ab3@12/1:c-8 G3@13/3:c-6",          # tenor 4-3: Ab -> G
    26: "D2@0/6:b [F3 Bb3]@6/3:s-2 C4@12/1:c-8 Bb3@13/3:c-6",              # tenor 9-8: C -> Bb
    27: "C2@0/6:b [Eb3 G3 Bb3]@6/3:s-2 Ab3@12/1:c-8 G3@13/1:c-6 Bb1@14/4:b",
    28: "[Db3 Ab3]@4/2:s Eb2@8/3:b [G3 Db4]@11/1:s Db3@12/1:b-6%1 Bb2@13/1:b-8%2 G2@14/1:b-8%3 Gb1@15/1:b-4%5",

    # ---------------- Pre 2 (groove + 16th ghost pairs; a dry 16th fill instead of a drop) ---------------------------
    29: "F1@0/3:b%5 [Eb3 Ab3 C4]@4/2:s F2@6/1:g F2@7/1:g F1@10/2:b-4 [Eb3 G3 C4]@12/2:s",
    30: "G1@0/3:b [F3 Bb3 D4]@4/2:s G2@6/1:g G2@7/1:g G1@10/2:b-4 [F3 A3 D4]@12/2:s",
    31: "Ab1@0/3:b [Eb3 Bb3 C4]@4/2:s Ab2@6/1:g Ab2@7/1:g A1@8/3:b [Eb3 Gb3 C4]@12/2:s",
    32: "Bb1@0/3:b [Ab3 C4 Eb4]@4/2:s Bb2@6/1:g Bb2@7/1:g Bb1@8/2:b [D3 Ab3]@10/2:s "
        "Bb2@12/1:b-6%1 Ab2@13/1:b-8%2 F2@14/1:b-8%3 A1@15/1:b-4%5",

    # ---------------- Chorus 2 (stride + tenor countermelody under every held note; octaves 37-38) ----------------
    33: "[Ab1 Ab2]@0/3:b+8 [Eb3 Bb3 C4]@4/2:s Ab2@6/1:g [Ab2 Eb3]@7/1:g Ab1@10/2:b-4 [Eb3 Bb3 C4]@12/2:s "
        "Bb1@14/4:b",                                                                              # Bb13sus antic.
    34: "[Ab3 C4 Eb4]@4/2:s [Bb2 F3]@7/1:g Bb1@8/2:b-2 Bb3@10/1:c C4@11/1:c D4@12/1:c F4@13/1:c Eb4@14/2:c",
    #                                                     the counter climbs against the tune's fall, Eb4 -> D4 (35)
    35: "G1@0/3:b [F3 Bb3 D4]@4/2:s G2@6/1:g [G2 D3]@7/1:g G1@10/2:b-4 [F3 Bb3 D4]@12/2:s C2@14/4:b",  # Cm9 antic.
    36: "[Eb3 G3 Bb3]@4/2:s [C3 G3]@7/1:g Bb1@8/3:b Eb3@12/1:c F3@13/1:c G3@14/2:c",
    37: "[Ab1 Ab2]@0/4:b [Ab1 Ab2]@6/4:b+3 [Eb3 Bb3 C4]@12/2:s",
    38: "[Ab1 Ab2]@0/4:b [Ab1 Ab2]@6/3:b+3 F3@9/1:c Ab3@10/1:c Bb3@11/1:c D4@12/1:c [G1 G2]@14/4:b",  # tenor answer
    39: "[F3 Bb3 D4]@4/2:s G2@6/1:g [G2 D3]@7/1:g C2@8/3:b [E3 Bb3 Db4]@12/2:s F1@14/4:b",          # Fm9 antic.
    40: "[Eb3 Ab3 C4]@4/2:s [F2 C3]@7/1:g Bb1@8/4:b [Eb3 Ab3 C4]@10/2:s-6 Ab3@12/1:c G3@13/1:c F3@14/1:c "
        "Eb3@15/2:c",

    # ---------------- Bridge (C minor, half-time: bass 1, soft low note 2, shell 3; line cliche C-B-Bb-A) ---------
    41: "C2@0/3:b G2@4/4:s-12 [Eb3 G3 Bb3]@8/6:s^ C4@14/2:s-10",
    42: "Ab1@0/3:b Eb3@4/4:s-12 [C3 G3]@8/6:s Bb3@14/2:s-8",
    43: "F1@0/3:b C3@4/4:s-12 [Eb3 Ab3]@8/4:s C4@12/2:s-8 Bb3@14/2:s-8",
    44: "G1@0/3:b [F3 C4]@4/4:s G1@8/3:b-4 [D3 F3]@11/5:s",
    45: "C2@0/3:b Eb3@4/12:s G3@4/12:s C4@4/4:s B3@8/8:s",                    # line cliche C - B
    46: "C2@0/3:b [Eb3 G3 Bb3]@4/4:s [Eb3 G3 A3]@8/8:s-2",                    #             Bb - A
    47: "Ab1@0/3:b [Eb3 F3 C4]@4/4:s Db2@8/3:b [F3 Ab3 C4]@12/4:s",           # Fm7/Ab | Dbmaj7 (the Neapolitan)
    48: "G1@0/3:b [D3 F3 C4]@4/4:s G1@8/3:b-4 [F3 Ab3 B3]@11/5:s",           # G7sus4 | G7b9: no iio, B3 -> C

    # ---------------- Build (C pedal): dotted-quarter hits -> 8ths -> 16ths hand to hand -> sweep -----------------
    49: "C2@0/4:b+6 Eb3@2/4:c C4@6/6:c Bb3@12/4:c",                         # tenor: alpha's leap in augmentation
    #                                                                     (Eb3 -> C4 up a 6th, then the step down)
    # 8ths: octaves on the 3+3+2 accents, the thumb's C3 alone in between (it stays on the thumb: no octave hops)
    50: "[C2 C3]@0/2:b+4 C3@2/2:b-8%1 C3@4/2:b-6%1 [C2 C3]@6/2:b+4 C3@8/2:b-8%1 C3@10/2:b-6%1 "
        "[C2 C3]@12/2:b+4 C3@14/2:b-4%1",
    51: "[C2 C3]@0/2:b+4 C3@2/2:b-6%1 C3@4/2:b-4%1 [C2 C3]@6/2:b+4 C3@8/2:b-4%1 C3@10/2:b-2%1 "
        "[C2 C3]@12/2:b+6 C3@14/2:b%1",
    52: "[C2 C3]@0/2:b+1 [C2 C3]@2/2:b-3 [C2 C3]@4/2:b-1 [C2 C3]@6/2:b+1 [C2 C3]@8/2:b-1",  # the climax's bass
    #                                                     octave must land above this last hit (session E: 5 lower, so
    #                                                     the step up into 53 is unmistakable, not only the silence)

    # ---------------- Climax (F): 2-bar push / land; a bar without approach; a tenor fill; the apex --------------
    53: "[Bb1 Bb2]@0/5:b+20 [D3 F3 C4]@4/2:s+6 [Bb1 Bb2]@6/4:b+2 [D3 F3 C4]@12/2:s [C2 C3]@14/6:b",  # push C
    54: "G3@4/2:c A3@6/2:c [C2 C3]@8/2:b Bb3@10/2:c C4@12/1:c D4@13/1:c E4@14/2:c",   # tenor answer, contrary
    #                                     to the tune's F5 -> E5: G-A under the sus, the bass re-struck on 3 (the 4-3's
    #                                     change), then Bb (under E5 = C7's tritone) - C - D - E into the tune's rest
    55: "[A1 A2]@0/6:b+4 [E3 G3 C4]@6/2:s+2 A1@10/2:b-4 [E3 G3 C4]@12/2:s [D2 D3]@14/6:b",      # snare pushed onto
    #                                                                          the "&" of 2; push D
    56: "[F3 A3 C4]@4/2:s [C2 C3]@8/2:b F3@10/1:c G3@11/1:c A3@12/2:c",                            # tenor fill
    57: "[Bb1 Bb2]@0/4:b+6 [D3 F3 C4]@4/2:s Bb1@6/2:b-2 D3@8/2:c%3 F3@10/2:c%2 A3@12/2:c%1 [C2 C3]@14/6:b+4",
    #                                     the tenor climbs D-F-A with the tune's 8ths; the V ROOT is pushed in (C2/C3)
    58: "[G3 D4]@2/4:s+4 C4@6/2:c Bb1@8/2:b+6 [E3 G3 C4]@10/4:s",
    #                                     under the F6 (a real 4-3 over C): the tenor D4 -> C4, then the bass takes the line
    #                                     down C -> Bb (beat 3, C7/Bb) -> A (59); E only with E6 (3.5)
    59: "[A1 A2]@0/4:b+4 [E3 G3 C4]@4/2:s [D2 D3]@8/4:b+4 [F#3 C4]@12/2:s",
    60: "[G1 G2]@0/4:b+4 [F3 Bb3 D4]@4/2:s [C2 C3]@8/3:b+6 [D2 D3]@12/2:b+2 [E2 E3]@14/2:b+4",      # dry walk-up

    # ---------------- Tag, final A, coda (F) ---------------------------------------------------------------------
    61: "[F1 F2]@0/3:b+6 [C3 G3 A3]@3/7:s E3@10/2:c F3@12/2:c G3@14/2:c",    # tenor answers the pocket's fall
    62: "A1@0/3:b [F3 C4 E4]@3/9:s^",
    63: "D2@0/3:b [F3 C4]@3/5:s D2@10/2:b-6 [F3 A3]@12/4:s",                 # Dm9 (E4 in the RH): the memory; the
    #                                    soft bass re-strike on 3 carries a re-catch that clears E4 / Bb4 under F4
    64: "G1@0/3:b [F3 Bb3]@3/5:s C2@8/3:b [F3 G3 Bb3]@11/5:s",               # Gm7 (no A3 under the Bb4) | C7sus4
    65: "Bb1@0/3:b [D3 F3]@3/13:s C4@3/5:s-2 A3@8/4:s-4 G3@12/4:s-4",         # A -> G prepares Bbm6's G
    66: "Bb1@0/3:b [Db3 G3]@3/13:s F3@8/8:s-6",                              # Bbm6: G -> F in the tenor
    67: "F1@0/1:b [C3 G3]@1/15:s^ Bb3@1/3:s^ A3@4/12:s",                     # 4-3 in the tenor (Bb3 -> A3 on 2)
}

RH = {
    # intro: colour notes under the hint
    2: "G4@2/14:i",
    3: "G4@2/6:i-2",
    4: "G4@0/8:i [F4 Ab4]@8/8:i^",
    # verse 1: one inner note at chord changes, struck while the melody rests or holds
    5: "Eb4@0/8:i-2",
    7: "Eb4@0/6:i G4@8/6:i",
    8: "Ab4@0/3:i",                     # under Db5 (2); gone before the thumb takes C5
    9: "Eb4@0/8:i%1",                   # under the head's Ab4-C5 pickup (thumb holds Eb4)
    10: "F4@2/10:i",
    11: "Gb4@8/6:i",
    12: "Eb4@0/4:i F4@8/8:i",
    # pre 1
    13: "Ab4@0/6:i [F4 Ab4]@10/6:i",
    14: "Bb4@0/6:i [G4 Bb4]@10/6:i",
    15: "[Ab4 C5]@0/2:i%1,2 [A4 C5]@8/6:i",   # 1-2: finger 3 takes Eb5 above it
    16: "[Ab4 C5]@0/8:i [Ab4 D5]@8/1:i+4",                                # the stab: Bb7 (D, Ab) under Ab5
    # chorus 1: off-beat 16th "hats" on the "&" of 1 and 3; dyads on the anticipations; a dyad under the arrival
    17: "[Bb4 Eb5]@0/2:i+6 [C5 Eb5]@2/1:i [Ab4 C5]@10/1:i",
    18: "[Ab4 C5]@2/1:i [G4 Bb4]@10/1:i",
    19: "[F4 Bb4]@10/1:i [G4 Bb4]@14/2:i",
    20: "[G4 Bb4]@2/1:i G4@10/1:i",          # one key under C5 (2): the line D5 3 - C5 2 stays legal
    21: "[C5 Eb5]@2/1:i [Ab4 C5]@10/1:i",
    22: "[D5 F5]@2/1:i [Ab4 D5]@10/1:i [G4 Bb4]@14/2:i",
    23: "[F4 Bb4]@2/1:i [Bb4 Db5]@10/1:i",
    24: "[C5 Eb5]@2/1:i [F4 Ab4]@10/1:i",
    # verse 2: backbeat dyads only under held notes (thinner than the chorus)
    27: "[G4 Bb4]@12/1:i",                   # the run climbs alone (thumb under on C5), one dyad under Eb5
    28: "Ab4@4/1:i",                         # one key under the tied Db5 (2)
    # pre 2: a "backing vocal" in thirds / sixths under the rap line; it joins on the held syllable (the lead
    # raps the 16th pickup alone, the harmony enters on the 3rd strike)
    29: "Ab4@4/2:i G4@6/1:i-2 Ab4@7/3:i C5@10/4:i",
    30: "Bb4@4/2:i A4@6/1:i-2 Bb4@7/3:i D5@10/6:i",
    31: "C5@4/4:i Eb5@8/6:i C5@14/2:i-2",   # under the break-out: C5, then Eb5 under A5 / Gb5
    32: "[G4 C5]@2/4:i [D5 F5]@8/4:i",
    # chorus 2: comping on the "&" of 1, the "&" of 2 and the "&" of 3; a soft ghost dyad on the swung "a" of 2
    # (35, 39); full octave chords in 37-38
    33: "[C5 Eb5]@0/2:i+6 [C5 Eb5]@6/1:i [Ab4 C5]@10/1:i",  # the push is the LH's alone (the thumb takes C5)
    34: "[Ab4 C5]@2/1:i [Ab4 C5]@6/1:i [F4 Ab4]@10/1:i",                   # the sus chord under beta
    35: "[F4 Bb4]@7/1:g [G4 Bb4]@10/1:i [G4 Bb4]@14/2:i",                  # both hands push Cm9
    36: "[G4 Bb4]@2/1:i G4@6/1:i [Eb4 G4]@12/1:i",
    37: "[C5 Eb5]@0/4:i [Ab4 C5]@8/3:i",
    38: "F5@2/6:i [Bb4 D5]@12/2:i",
    39: "Bb4@2/1:i [F4 Bb4]@7/1:g [Bb4 Db5]@10/1:i",
    40: "[C5 Eb5]@2/1:i",
    # bridge: held inner notes
    41: "G4@0/8:i",
    42: "[Eb4 G4]@4/4:i C5@8/4:i",      # the hand is free for G5 (no octave stretch from G4)
    43: "Ab4@0/6:i F4@8/8:i",           # F4, not Eb4: no 1-5 octave under the falling line
    44: "F4@0/16:i",
    45: "C5@4/4:i",                     # gone (pedal change) before the line cliche's B3 enters
    46: "Eb4@0/4:i [Bb4 Eb5]@4/4:i [A4 C5]@8/8:i",
    47: "[C5 Eb5]@0/6:i [Ab4 C5]@8/8:i",
    48: "[C5 D5]@0/6:i B4@8/8:i",
    # build: hits locked to the LH, then the hand-to-hand 16ths, then the C7(b9,b13) hit in the sweep's hand position
    # fix round 2: a WEDGE - under the rising top (Eb-F-G-Ab) the inner line falls chromatically C5 (49) - Bb4 (50)
    # - A4 (50:4, 51) - Ab4 (51:4) - G4 (52's sweep); 51's off-16ths start soft and crescendo, G5 is re-struck on 3
    49: "[Ab4 C5]@0/5:i [Ab4 C5]@6/5:i [Ab4 C5]@12/3:i",
    50: "[F4 Bb4]@0/5:i [F4 Bb4]@6/5:i [F4 A4]@12/3:i",
    51: "[A4 D5]@1/1:i-14 [A4 D5]@3/1:i-12 [A4 D5]@5/1:i-10 [A4 D5]@7/1:i-8 [A4 D5]@8/1:i-2 [Ab4 D5]@9/1:i-6 "
        "[Ab4 D5]@11/1:i-4 [Ab4 F5]@13/1:i-2 [Ab4 F5]@15/1:i",
    52: "[Bb4 Db5 E5]@8/2:i%1,2,3",
    # climax: octave melody (score) + chord tones inside the octave on strong beats; the apex a real sus
    53: "[D5 F5]@0/4:i+10 [Bb4 D5]@8/3:i",
    54: "[Bb4 D5]@2/6:i [A4 C5]@8/6:i",
    55: "[E5 G5]@0/4:i C5@8/3:i [E4 A4]@13/1:g",                           # ghost on the 'e' of 4
    56: "[F4 A4]@0/6:i [A4 C5]@8/2:i",                                   # no C5 under the tied D5, no F4 under E4
    57: "[D5 F5]@0/4:i D5@8/2:i [F5 A5]@12/2:i",                          # no Bb4 under the climbing A4/A5
    58: "C6@2/8:i Bb5@2/6:i G5@8/2:i",
    59: "[A4 Eb5]@8/3:i [C5 Eb5]@13/1:g",
    60: "[D5 F5]@4/2:i [Bb4 C5]@8/4:i",
    # tag, final A, coda
    61: "[C5 F5]@0/6:i",
    62: "[C5 F5]@4/4:i [A4 C5]@8/8:i%1,2",       # A4 C5 on 1-2 under E5 on 3
    65: "D5@0/8:i",
    66: "Bb4@0/8:i F4@8/24:i%1",                                             # F4 held into the last chord
    67: "G4@0/4:i%2 A4@4/12:i%2",                                            # 9 -> 3 inside the last chord
}

# ---------------------------------------------------------------------------------------------------------------
# harmony timeline: (bar, beat, symbol, roman). Every entry gets a legato pedal change (or the drop's lift).
# ---------------------------------------------------------------------------------------------------------------
HARM = [
    (1, 1, "Abmaj9", "IVmaj9"), (2, 1, "Bb13sus4", "V13sus4"), (2, 3, "Bb7(13)", "V7(13)"), (3, 1, "Gm9", "iii9"),
    (4, 1, "Cm9", "vi9"), (4, 3, "Bb9sus4", "V9sus4"),
    (5, 1, "Ebadd9", "I(add9)"), (6, 1, "Bb/D", "V6"), (7, 1, "Cm9", "vi9"), (8, 1, "Bbm9", "v9"),
    (8, 3, "Eb7", "I7 (V7/IV)"), (9, 1, "Abmaj9", "IVmaj9"), (10, 1, "Abm6", "iv6 (borrowed)"),
    (11, 1, "Eb/G", "I6"), (11, 3, "Gbdim7", "bIIIo7"), (12, 1, "Fm11", "ii11"), (12, 3, "Bb9sus4", "V9sus4"),
    (13, 1, "Fm9", "ii9"), (14, 1, "Gm7", "iii7"), (15, 1, "Ab(add9)", "IV(add9)"), (15, 3, "Adim7", "#ivo7"),
    (16, 1, "Bb13sus4", "V13sus4"), (16, 3, "Bb7", "V7 dry stab"),
    (17, 1, "Abmaj9", "IVmaj9"), (18, 1, "Bb13sus4", "V13sus4"), (18, 3, "Bb7(13)", "V7(13)"), (19, 1, "Gm7", "iii7"),
    (19, 4.5, "Cm9", "vi9 (anticipated)"), (20, 3, "Cm9/Bb", "vi9/5"), (21, 1, "Abmaj9", "IVmaj9"),
    (22, 1, "Bb/Ab", "V4/2"), (22, 4.5, "Gm7", "iii7 (anticipated)"), (23, 3, "C7b9", "V7b9/ii"),
    (23, 4.5, "Fm9", "ii9 (anticipated)"), (24, 3, "Bb9sus4", "V9sus4"),
    (25, 1, "Ebadd9", "I(add9) (elided)"), (26, 1, "Bb/D", "V6"), (27, 1, "Cm9", "vi9"),
    (27, 4.5, "Bbm9", "v9 (anticipated)"), (28, 3, "Eb7", "I7"),
    (29, 1, "Fm9", "ii9"), (30, 1, "Gm7", "iii7"), (31, 1, "Ab(add9)", "IV(add9)"), (31, 3, "Adim7", "#ivo7"),
    (32, 1, "Bb13sus4", "V13sus4"), (32, 3, "Bb7", "V7"),
    (33, 1, "Abmaj9", "IVmaj9"), (33, 4.5, "Bb13sus4", "V13sus4 (anticipated)"), (34, 3, "Bb7(13)", "V7(13)"),
    (35, 1, "Gm7", "iii7"), (35, 4.5, "Cm9", "vi9 (anticipated)"), (36, 3, "Cm9/Bb", "vi9/5"),
    (37, 1, "Abmaj9", "IVmaj9"), (38, 1, "Bb/Ab", "V4/2"), (38, 4.5, "Gm7", "iii7 (anticipated)"),
    (39, 3, "C7b9", "V7b9/ii"), (39, 4.5, "Fm9", "ii9 (anticipated)"), (40, 3, "Bb9sus4", "V9sus4 -> deceptive"),
    (41, 1, "Cm9", "i9 (= vi of Eb)"), (42, 1, "Abmaj7#11", "VImaj7#11"), (43, 1, "Fm7", "iv7"),
    (44, 1, "G7sus4", "V7sus4"), (44, 3, "G7b9", "V7b9"), (45, 1, "Cm", "i"),
    (45, 3, "Cm(maj7)", "i(maj7)"), (46, 1, "Cm7", "i7"), (46, 3, "Cm6", "i6"), (47, 1, "Fm7/Ab", "iv7/b3"),
    (47, 3, "Dbmaj7#11", "bIImaj7#11 (Neapolitan)"), (48, 1, "G7sus4", "V7sus4"), (48, 3, "G7b9", "V7b9"),
    (49, 1, "Abmaj7/C", "bVI/V (C pedal)"), (50, 1, "Bb/C", "bVII/V"), (51, 1, "C9sus4", "V9sus4 (of F)"),
    (51, 4, "C7sus4(b13)", "V7sus4(b13)"), (52, 1, "C7(b9,b13)", "V7(b9,b13) (of F)"),
    (53, 1, "Bbmaj9", "IVmaj9"), (53, 4.5, "C13sus4", "V13sus4 (pushed)"), (54, 3, "C7(13)", "V7(13)"),
    (55, 1, "Am7", "iii7"), (55, 4.5, "Dm9", "vi9 (pushed)"), (56, 3, "Dm9/C", "vi9/5"), (57, 1, "Bbmaj9", "IVmaj9"),
    (57, 4.5, "C9sus4", "V9sus4 (pushed)"), (58, 3, "C7/Bb", "V4/2 (bass C -> Bb; the 4-3 on 3.5)"), (59, 1, "Am7", "iii7"),
    (59, 3, "D7b9", "V7b9/ii"), (60, 1, "Gm9", "ii9"), (60, 3, "C9sus4", "V9sus4"),
    (61, 1, "Fadd9", "I(add9)"), (62, 1, "Fmaj7/A", "Imaj7/3"),
    (63, 1, "Dm9", "vi9"), (64, 1, "Gm7", "ii7"), (64, 3, "C7sus4", "V7sus4"),
    (65, 1, "Bbmaj9", "IVmaj9"), (66, 1, "Bbm6", "iv6 (minor plagal)"), (67, 1, "Fadd9", "I(add9)"),
]

# harmony changes taken with a full pedal LIFT instead of a legato change (the dry stab before the first drop)
LIFT_AT_CHANGE = {(16, 3)}
# extra legato re-pedals inside one harmony (clears the tune's turns); never next to another dip. Chorus: on the
# re-struck kick (17, 21, 37); climax (fix round 1): on beat 3, after the turn, while the re-struck bass octave is
# still held, so the hook's neighbour and the run do not ring under the next chord
PEDAL_RECATCH = [(17, 3.5), (21, 3.5), (37, 2.5), (53, 3), (55, 3.5), (63, 3.5)]   # 55: on the re-struck A1
# rhythmic (dry) lifts: only at the drops and the 4-bar phrase-end fills
PEDAL_DRY = [(20, 4.0), (24, 4.0), (28, 4.0), (32, 4.0), (52, 3.25), (60, 3.9)]
DRY_BARS = {16, 20, 24, 28, 32, 52, 60}
# half-pedal flutters (CC64 dips into the sampler's half-pedal zone, not a damper clear): (bar, beat, depth). They
# damp the treble strings of released neighbour notes while the bass rings on (final A / coda turns)
HALF_FLUTTER = [(5, 4, 44), (25, 4, 44),   # the verse head's Eb5 -> D5 (maj7) cleared on Bb4 (fix round 2)
                (10, 3, 40),            # the tear Cb5 stops ringing under its resolution Bb4
                (17, 3, 44), (21, 3, 44), (33, 3, 44),   # the hook's G-Ab-G turn is cleared as the pocket falls
                (57, 3, 44),            # climax: the turn's Bb5 cleared on G5 (the bass Bb1 rings on)
                (59, 4, 40),            # the passing G5 / F#5 (D7b9) cleared as A5 arrives (climax, octaves)
                (61, 3, 40)]            # the tag's turn: Bb5 / A5 cleared on the pocket's G5, the low F rings on
# groove half-pedal: in the choruses the pedal is held at CC64 = GROOVE_PEDAL (inside the sampler's 32-76 zone)
# instead of fully down, so the snare shells and hats read as hits while the bass still sustains
GROOVE_PEDAL_BARS = [(17, 24), (29, 40)]   # chorus 1 | pre 2 + chorus 2 (fix round 2: verse 2 takes the full legato
#                                            pedal - pulled back, a breath between the two choruses)
GROOVE_PEDAL = 60
