"""Hand-written accompaniment for every bar (no pattern generator).

Event language (lib.ev): PITCH@step/dur[:v][+N|-N][^]   or   [P P P]@step/dur...
  step / dur in 16ths from the bar line (a dur may run over the bar line: ties, anticipations)
  v = voice: b bass (LH 5th finger: short key-hold, the pedal carries it), s shell/LH chord, g ghost,
             c tenor countermelody (LH thumb), i RH inner voice / comping under the melody
  ^ = rolled chord
LH[bar] is the left hand, RH[bar] the right-hand notes under the melody (the melody itself is in melodies.py).
Pitch reference: C4 = middle C.
"""

LH = {
    # ---------------- Intro (Eb, free 68 -> 60) : rolled bloom, a tenor line C4-Bb3 | C4-D4 | Bb3-Ab3 -------------
    1: "Ab1@0/2:b [Eb3 G3 C4]@2/14:s^",
    2: "Ab1@0/2:b Eb3@2/14:s G3@2/14:s C4@2/6:s Bb3@8/8:s-3",
    3: "Bb1@0/2:b F3@2/14:s Ab3@2/14:s C4@2/6:s D4@8/8:s",                 # tenor C4 -> D4 against Eb5 -> D5
    4: "G1@0/2:b [F3 Bb3]@2/6:s Bb1@8/2:b [Eb3 Ab3 C4]@10/6:s^",            # the held sus (fermata)

    # ---------------- Verse 1 (Eb, 76, ballad): bass + blooming shell, tenor answers while the melody holds ------
    5: "Eb2@0/3:b Bb2@3/5:s G3@6/4:s F3@10/2:s-4 G3@12/2:s-2 Ab3@14/2:s-6",  # 9-10 sigh, passing Ab
    6: "D2@0/3:b F3@3/5:s Bb3@6/6:s C4@12/4:s-4",
    7: "C2@0/3:b Eb3@3/5:s Bb3@6/6:s Ab3@12/2:s-8 G3@14/2:s-6",               # Bb-Ab-G falls into Ab3 of bar 8
    8: "Bb1@0/3:b Db3@3/3:s Ab3@4/4:s Eb2@8/3:b G3@11/3:s Db4@12/4:s-4",
    9: "Ab1@0/3:b Eb3@3/5:s C4@4/6:s Bb3@10/2:s-4 G3@12/4:s-4",                # Db4 (7th of Eb7) -> C4
    10: "Ab1@0/3:b Cb3@3/5:s F3@6/4:s Eb3@10/2:s-6 F3@12/2:s-6 Ab3@14/2:s-6",
    11: "G1@0/3:b [Eb3 Bb3]@3/3:s Gb1@8/3:b [Eb3 A3]@11/5:s",
    12: "F1@0/3:b [Eb3 Ab3]@3/4:s Bb1@8/3:b [Eb3 Ab3]@11/3:s C4@14/2:s-6",

    # ---------------- Pre 1 (rising bass F-G-Ab-A-Bb; 8th pulse from bar 15; the drop) -------------------------
    13: "F1@0/2:b C3@2/2:s-6 Eb3@4/4:s Ab3@6/6:s G3@12/4:s-4",
    14: "G1@0/2:b D3@2/2:s-6 F3@4/4:s Bb3@6/6:s C4@12/4:s-4",
    15: "Ab1@0/2:b [Eb3 C4]@2/2:s [Eb3 C4]@4/2:s-4 [Eb3 Bb3]@6/2:s-6 A1@8/2:b [Eb3 C4]@10/2:s "
        "[Eb3 Gb3 C4]@12/2:s-4 [Eb3 Gb3 C4]@14/2:s-2",
    16: "Bb1@0/2:b [Ab3 C4 Eb4]@2/2:s [Ab3 C4 Eb4]@4/2:s-4 [Ab3 C4 Eb4]@6/2:s-2 [Bb1 Bb2]@8/2:b+2",

    # ---------------- Chorus 1 (boom-bap stride: kick 1, snare 2, ghost "a" of 2, kick "&" of 3, snare 4) -------
    17: "Ab1@0/3:b [C3 G3]@4/2:s Ab1@7/1:g Ab1@10/2:b-4 [Eb3 G3]@12/2:s A1@14/2:g",
    18: "Bb1@0/3:b [Ab3 C4 Eb4]@4/2:s [Bb1 Bb2]@8/2:b-2 [Ab3 D4]@12/2:s Ab1@14/2:g",
    19: "G1@0/3:b [F3 Bb3]@4/2:s G2@7/1:g G1@10/2:b-4 [F3 Bb3 D4]@12/2:s B1@14/2:g",
    20: "C2@0/3:b [Eb3 Bb3]@4/2:s C3@7/1:g Bb1@8/3:b [Eb3 G3]@12/1:g [Eb3 G3]@13/1:g G1@14/2:g",
    21: "Ab1@0/3:b [C3 G3]@4/2:s Ab1@7/1:g Ab1@10/2:b-4 [Eb3 G3 C4]@12/2:s [D3 F3]@14/2:g",
    22: "Ab1@0/3:b [D3 F3 Bb3]@4/2:s Ab1@7/1:g Ab1@10/2:b-4 [D3 F3 Bb3]@12/2:s Ab1@14/2:g",
    23: "G1@0/3:b [F3 Bb3]@4/2:s B1@6/2:g C2@8/3:b [E3 Bb3]@12/2:s Gb1@14/2:g",
    24: "F1@0/3:b [Eb3 Ab3]@4/2:s F2@7/1:g Bb1@8/3:b [Eb3 Ab3 C4]@11/1:s C2@12/2:b-6 D2@14/2:b-4",  # walk-up

    # ---------------- Verse 2 (lazy walk: long root, pushed shell, root 8va, ghost, double approach) -------------
    25: "Eb2@0/4:b [Bb2 F3 G3]@6/2:s Eb3@8/2:b-8 Eb3@11/1:g G3@12/2:s-4 C2@14/1:g Db2@15/1:g",
    26: "D2@0/4:b [F3 Bb3]@6/2:s D3@8/2:b-8 D3@11/1:g [F3 Bb3]@12/2:s-4 Db2@14/2:g",
    27: "C2@0/4:b [Eb3 Bb3]@6/2:s C3@8/2:b-8 C3@11/1:g [Eb3 G3]@12/2:s-4 B1@14/2:g",
    28: "Bb1@0/3:b [Db3 Ab3]@4/2:s Bb1@7/1:g Eb2@8/3:b [G3 Db4]@12/2:s G1@14/1:g Gb1@15/1:g",  # G with the melody's G

    # ---------------- Pre 2 (groove; bar 32 pushes the chorus with an Ab octave on the "&" of 4) ----------------
    29: "F1@0/3:b [Eb3 Ab3]@4/2:s F2@7/1:g F1@10/2:b-4 [Eb3 Ab3 C4]@12/2:s Gb1@14/2:g",
    30: "G1@0/3:b [F3 Bb3]@4/2:s G2@7/1:g G1@10/2:b-4 [F3 Bb3 D4]@12/2:s A1@14/2:g",
    31: "Ab1@0/3:b [Eb3 C4]@4/2:s Ab2@6/2:g A1@8/3:b [Eb3 Gb3 C4]@12/2:s A1@14/2:g",
    32: "Bb1@0/3:b [Ab3 C4 Eb4]@4/2:s Bb2@7/1:g [Bb1 Bb2]@8/2:b [Ab3 D4]@10/2:s [Ab3 D4]@12/1:s-4 "
        "[Ab1 Ab2]@14/4:b+2",

    # ---------------- Chorus 2 (stride + tenor countermelody answering every held melody note) -------------------
    33: "[C3 G3]@4/2:s Ab1@7/1:g Ab1@10/2:b-4 [Eb3 G3 C4]@12/2:s A1@14/2:g",
    34: "Bb1@0/3:b [Ab3 C4 Eb4]@4/2:s Bb2@7/1:g Bb1@8/2:b-2 Bb3@10/1:c Ab3@11/1:c G3@12/1:c F3@13/1:c D3@14/2:c",
    35: "G1@0/3:b [F3 Bb3]@4/2:s G2@7/1:g G1@10/2:b-4 [F3 Bb3 D4]@12/2:s B1@14/2:g",
    36: "C2@0/3:b [Eb3 Bb3]@4/2:s C3@7/1:g Bb1@8/3:b Eb3@11/1:c F3@12/1:c G3@13/1:c Bb3@14/1:c",
    37: "[Ab1 Ab2]@0/4:b [Ab1 Ab2]@6/4:b+3 [Eb3 G3 C4]@12/2:s",
    38: "[Ab1 Ab2]@0/4:b [Ab1 Ab2]@6/2:b+3 D4@10/1:c C4@11/1:c Bb3@12/1:c Ab3@13/2:c",
    39: "[G1 G2]@0/4:b [F3 Bb3]@4/2:s [B1 B2]@6/2:b-6 [C2 C3]@8/4:b [E3 Bb3]@12/2:s [Gb1 Gb2]@14/2:b-6",
    40: "[F1 F2]@0/4:b [Eb3 Ab3]@4/2:s [A1 A2]@6/2:b-6 [Bb1 Bb2]@8/2:b [D3 Ab3]@10/2:s "
        "Ab3@12/1:c G3@13/1:c F3@14/1:c D3@15/1:c",

    # ---------------- Bridge (C minor, half-time: bass 1, soft low note 2, full shell 3; tenor line) ------------
    41: "C2@0/3:b G2@4/4:s-12 [Eb3 Bb3 D4]@8/6:s^ C4@14/2:s-10",
    42: "Ab1@0/3:b C3@4/4:s-12 [Eb3 G3 C4]@8/6:s Bb3@14/2:s-10",
    43: "F1@0/3:b C3@4/4:s-12 [Eb3 Ab3 C4]@8/4:s C4@12/2:s-10 Bb3@14/2:s-10",
    44: "G1@0/3:b [F3 C4]@4/4:s G1@8/3:b-4 [F3 B3]@12/4:s",
    45: "C2@0/3:b Eb3@4/12:s G3@4/12:s C4@4/4:s B3@8/8:s",                    # line cliche C - B
    46: "C2@0/3:b [Eb3 G3 Bb3]@4/4:s [Eb3 G3 A3]@8/8:s-2",                     #             Bb - A
    47: "Ab1@0/3:b [C3 G3]@4/4:s F1@8/3:b [Eb3 Ab3]@12/4:s",                    #   (A) - G - Ab
    48: "D2@0/3:b [F3 Ab3 C4]@4/4:s G1@8/3:b [F3 Ab3 D4]@11/5:s",

    # ---------------- Build (C pedal: rocking octaves + tenor chords, 3+3+2 accents, accelerando) ----------------
    49: "[C2 C3]@0/2:b+6 [Eb3 Ab3]@2/2:s [Eb3 Ab3]@4/2:s-4 [C2 C3]@6/2:b+6 [Eb3 Ab3]@8/2:s [Eb3 Ab3]@10/2:s-4 "
        "[C2 C3]@12/2:b+6 [Eb3 G3]@14/2:s",
    50: "[C2 C3]@0/2:b+6 [F3 Bb3]@2/2:s [F3 Bb3]@4/2:s-4 [C2 C3]@6/2:b+6 [F3 Bb3]@8/2:s [F3 Bb3]@10/2:s-4 "
        "[C2 C3]@12/2:b+6 [F3 Bb3]@14/2:s",
    51: "[C2 C3]@0/2:b+6 [F3 G3 Bb3]@2/2:s [F3 G3 Bb3]@4/2:s-4 [C2 C3]@6/2:b+6 [F3 G3 Bb3]@8/2:s "
        "[F3 G3 Bb3]@10/2:s-4 [C2 C3]@12/1:b+4 [C2 C3]@13/1:b-2 [C2 C3]@14/1:b+2 [C2 C3]@15/1:b+6",
    52: "[C2 C3]@0/4:b+10 [E3 Bb3]@4/2:s [C2 C3]@6/2:b+4 [C2 C3]@8/2:b+8",

    # ---------------- Climax (F): tresillo octave pushes, shells, chromatic octave approaches -------------------
    53: "[Bb1 Bb2]@0/4:b+4 [D3 A3]@4/2:s [Bb1 Bb2]@6/4:b+2 [D3 F3 A3]@12/2:s [B1 B2]@14/2:b-8",
    54: "[C2 C3]@0/4:b+4 [F3 Bb3]@4/2:s [C2 C3]@6/2:b [E3 Bb3]@8/4:s [Bb1 Bb2]@14/2:b-8",
    55: "[A1 A2]@0/4:b+4 [G3 C4]@4/2:s [A1 A2]@6/4:b+2 [G3 C4]@12/2:s [C#2 C#3]@14/2:b-8",   # no E3 under the F5s
    56: "[D2 D3]@0/4:b+4 [F3 C4]@4/2:s [D2 D3]@6/2:b [C2 C3]@8/2:b [F3 A3]@10/2:s [A1 A2]@14/2:b-4",  # A -> Bb under the C pickup
    57: "[Bb1 Bb2]@0/4:b+6 [D3 A3]@4/2:s [Bb1 Bb2]@6/4:b+4 [D3 F3 A3]@12/2:s [Bb1 F2]@14/4:b+2",   # power-5th push into the apex
    58: "[G3 C4]@4/2:s [Bb1 F2]@6/4:b+4 [E3 G3 C4]@12/2:s Bb1@14/2:b-6",   # no E under the F6 until it resolves
    59: "[A1 A2]@0/4:b+4 [E3 G3]@4/2:s [C#2 C#3]@6/2:b-6 [D2 D3]@8/4:b+4 [F#3 C4]@12/2:s [Ab1 Ab2]@14/2:b-6",
    60: "[G1 G2]@0/4:b+4 [F3 Bb3]@4/2:s [G1 G2]@6/2:b [C2 C3]@8/3:b+6 [D2 D3]@11/3:b+2 [E2 E3]@14/2:b+4",

    # ---------------- Tag, final A, coda (F) ---------------------------------------------------------------------
    61: "[F1 F2]@0/3:b+6 [C3 G3 A3]@3/13:s",
    62: "A1@0/3:b [F3 C4 E4]@3/13:s^",
    63: "Bb1@0/3:b [D3 A3]@3/13:s C4@8/8:s-4",
    64: "C2@0/3:b [Bb2 D3]@3/5:s [E3 Bb3]@8/8:s",
    65: "A1@0/3:b [E3 G3]@3/13:s C4@8/8:s-4",
    66: "D2@0/3:b [F3 A3]@3/5:s [E3 A3 C4]@8/8:s",
    67: "Bb1@0/3:b [D3 A3]@3/13:s C4@8/8:s-6",
    68: "Bb1@0/3:b [Db3 G3]@3/13:s F3@8/8:s-6",                               # Bbm6: the minor-plagal colour
    69: "F1@0/1:b [C3 G3]@1/15:s^ Bb3@1/3:s^ A3@4/12:s",                       # 4-3 in the tenor
}

RH = {
    # intro: the call alone; one inner note under the held sus
    4: "Ab4@10/6:i",
    # verse 1: one inner note at chord changes, struck while the melody rests or holds
    5: "Eb4@0/8:i",
    7: "Eb4@0/8:i G4@8/6:i",
    8: "F4@0/4:i",
    9: "G4@0/8:i",
    10: "F4@0/12:i",
    11: "Gb4@8/6:i",
    12: "Eb4@0/4:i F4@8/8:i",
    # pre 1
    13: "[F4 Ab4]@0/6:i [G4 C5]@10/6:i",
    14: "[G4 Bb4]@0/6:i [Bb4 D5]@8/8:i",
    15: "[Ab4 C5]@0/2:i [A4 C5]@8/6:i",
    16: "[Ab4 C5]@0/8:i Ab4@8/2:i",
    # chorus 1: off-beat "hats" on the "&" of 1 and the "&" of 3 (16th stabs, the pedal rings them)
    17: "[C5 Eb5]@2/1:i [Ab4 C5]@10/1:i",
    18: "[Ab4 C5]@2/1:i [F4 Ab4]@10/1:i",
    19: "[Bb4 D5]@10/1:i",
    20: "[G4 Bb4]@2/1:i [Eb4 G4]@10/1:i",
    21: "[C5 Eb5]@2/1:i [Ab4 C5]@10/1:i",
    22: "[D5 F5]@2/1:i [Bb4 D5]@10/1:i",
    23: "[F4 Bb4]@2/1:i [Bb4 Db5]@10/1:i",
    24: "[C5 Eb5]@2/1:i [Ab4 C5]@10/1:i",
    # verse 2: backbeat dyads on 2 and 4
    25: "[Eb4 G4]@4/1:i [Eb4 G4]@12/1:i",
    26: "[D4 F4]@12/1:i",
    27: "[Eb4 G4]@4/1:i [G4 Bb4]@12/1:i",
    28: "[F4 Ab4]@4/1:i",
    # pre 2
    29: "[F4 Ab4]@0/1:i [Ab4 C5]@12/1:i",
    30: "[G4 Bb4]@0/1:i [Bb4 D5]@12/1:i",
    31: "[Ab4 C5]@0/1:i [A4 C5]@10/1:i",
    32: "[Ab4 C5]@0/1:i Ab4@8/1:i",
    # chorus 2: comping on 2, 6 and 10; full octave chords in 37-38
    33: "[C5 Eb5]@2/1:i [C5 Eb5]@6/1:i [Ab4 C5]@10/1:i",
    34: "[Ab4 C5]@6/1:i [F4 Ab4]@10/1:i",
    35: "[F4 Bb4]@6/1:i [Bb4 D5]@10/1:i",
    36: "[G4 Bb4]@2/1:i [Eb4 G4]@6/1:i",
    37: "[C5 Eb5]@0/4:i [Ab4 C5]@8/3:i",
    38: "F5@2/6:i [Bb4 D5]@12/4:i",
    39: "[F4 Bb4]@2/1:i [Bb4 Db5]@10/1:i",
    40: "[C5 Eb5]@2/1:i [F4 Ab4]@10/1:i",
    # bridge: held inner notes
    41: "G4@0/8:i Eb4@8/6:i",
    42: "[Eb4 G4]@4/12:i",
    43: "Ab4@0/6:i F4@8/6:i",
    44: "F4@0/16:i D4@8/8:i",
    45: "G4@4/12:i",
    46: "[G4 Bb4]@0/8:i [C5 Eb5]@8/8:i",
    47: "[C5 Eb5]@0/8:i [Ab4 C5]@8/8:i",
    48: "C5@0/4:i Ab4@0/8:i F4@8/8:i",
    # build: tresillo stabs locked to the LH accents
    49: "[G4 C5]@0/6:i [G4 C5]@6/6:i [C5 Eb5]@12/4:i",
    50: "[Bb4 D5]@0/6:i [Bb4 D5]@6/6:i [D5 F5]@12/4:i",
    51: "[C5 D5]@0/6:i [C5 D5]@6/6:i [D5 F5]@12/4:i",
    52: "[Bb4 Db5 E5]@0/3:i [Db5 E5 G5]@8/2:i",
    # climax: octave melody (added in score.py) + 1-2 chord tones inside the octave on strong beats
    53: "[D5 F5]@0/4:i [Bb4 D5]@8/3:i",
    54: "[Bb4 D5]@2/6:i [A4 C5]@8/6:i",
    55: "[C5 E5]@8/5:i",
    56: "[A4 C5]@2/4:i [F4 A4]@8/2:i",
    57: "[D5 F5]@0/4:i [Bb4 D5]@8/2:i",
    58: "[A5 C6]@2/6:i [G5 C6]@8/2:i",
    59: "[A4 Eb5]@8/3:i",
    60: "[D5 F5]@2/2:i [Bb4 D5]@8/4:i",
    # tag, final A, coda
    61: "[A4 F5]@0/8:i C5@0/16:i",
    62: "[A4 C5]@0/8:i",
    63: "D5@0/6:i",
    64: "Bb4@2/6:i G4@8/8:i",
    65: "C5@8/5:i",
    66: "A4@0/12:i",
    67: "D5@0/8:i",
    68: "[F4 Bb4]@8/8:i",
    69: "F4@0/16:i^ G4@0/4:i^ A4@4/12:i",                                     # 9 -> 3 above it
}
