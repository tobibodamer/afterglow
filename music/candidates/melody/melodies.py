"""The tune, note by note (DSL line() tokens; durations in beats, 0.25 = 16th, '~' ties into the next bar).

Cells (every melody in the piece is built from these three):
  alpha "leap and turn": the 5 -> 3 pickup (a rising major 6th), a held 3rd, an upper-neighbour turn 3-4-3, then a
                         3+3+2 "pocket" fall (dotted 8th, dotted 8th, 8th) - the hip-hop tresillo inside a pop hook
  beta  "sus sigh":      the sus4 struck on the "&" of 1 over V (an appoggiatura), resolving to V's 3rd on beat 3
  gamma "flow pickup":   rest on the downbeat, then repeated-note 16ths climbing by step, like a rap/R&B pickup
Story: the hook always lands its leap on IV (as IV's maj7, a question). Only at the tag (bar 61) does the same
leap land on I (as its 3rd): the hook finally comes home.
"""

# ---------------------------------------------------------------------------------------------------------------
# Eb major
# ---------------------------------------------------------------------------------------------------------------
INTRO = [  # bars 1-4, free time: a rolled chord blooms, then the hook CALL alone; the response is withheld
    "r:2 Eb5:1.5 Bb4:0.5",                               # 1 Abmaj9   two falling notes set up the leap
    "G5:1.5 Ab5:0.25 G5:0.25 F5:1 Eb5:0.5 C5:0.5",       # 2 Abmaj9   alpha (still straight 8ths: plain, shy)
    "Bb4:0.5 Eb5:1.5 D5:2",                              # 3 Bb13sus | Bb7   beta
    "r:1 D5:0.5 F5:0.5 Eb5:2",                           # 4 Gm7 | Bb9sus4   ends on the sus (fermata)
]

VERSE1 = [  # bars 5-12, low and conversational (F4-Eb5); phrases a a' b c
    "r:0.5 G4:0.25 G4:0.25 Bb4:0.5 Bb4:0.25 C5:0.25 Bb4:1.5 r:0.5",      # 5  Ebadd9   gamma opening
    "r:0.5 F4:0.25 G4:0.25 Bb4:0.5 D5:0.5 C5:0.5 Bb4:0.5 G4:1",         # 6  Bb/D
    "r:0.5 G4:0.25 G4:0.25 Bb4:0.5 Bb4:0.25 C5:0.25 D5:1.5 Eb5:0.25 D5:0.25",  # 7 Cm9  a' reaches higher
    "Db5:1%5 C5:0.5%4 Bb4:0.5%3 Ab4:0.5%2 G4:1.5%1",                              # 8  Bbm9 | Eb7b9  chromatic slide D-Db-C
    "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.5 C5:0.5 Bb4:0.5 C5:1.5",            # 9  Abmaj9
    "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.5 Cb5:1.5 Bb4:1",                    # 10 Abm6     the borrowed-minor tear
    "Bb4:1.5 G4:0.25 Bb4:0.25 Eb5:1 C5:0.5 A4:0.5",                     # 11 Eb/G | Gbdim7
    "Ab4:0.5 Bb4:0.5 C5:1.5 Bb4:1.5",                                   # 12 Fm11 | Bb9sus  unresolved
]

PRE1 = [  # bars 13-16: gamma sequenced up by step (C, D, Eb -> Gb), beta over V, the drop, the Bb4 pickup
    "r:0.5 C5:0.25 C5:0.25 C5:0.25 C5:0.25 Bb4:0.5 C5:0.5 Eb5:1.5",     # 13 Fm9
    "r:0.5 D5:0.25 D5:0.25 D5:0.5 C5:0.25 D5:0.25 F5:2",                # 14 Gm7
    "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.25 Eb5:0.25 F5:0.5 Gb5:1.5 F5:0.5",  # 15 Ab(add9) | Adim7
    "r:0.5 Eb5:1.5 D5:1 r:0.5 Bb4:0.5",                                 # 16 Bb13sus | Bb7   (drop on beat 4)
]

CHORUS1 = [  # bars 17-24: call (alpha+beta) / response (gamma + 9-8 sigh) / call higher / chromatic turn home
    "G5:1.5 Ab5:0.25 G5:0.25 F5:0.75 Eb5:0.75 C5:0.5",                  # 17 Abmaj9    alpha + 3+3+2 pocket
    "Bb4:0.5 Eb5:1.5 D5:1.5 r:0.5",                                     # 18 Bb13sus | Bb7  beta
    "r:0.5 Bb4:0.25 Bb4:0.25 C5:0.5 D5:0.5 F5:1.25 Eb5:0.25 D5:0.5~",   # 19 Gm7       gamma, anticipates the 9th
    "D5:1.5 C5:1.5 r:0.5 Bb4:0.5",                                      # 20 Cm9 | /Bb  9-8 sigh on the "&" of 2
    "G5:1.5 Ab5:0.25 G5:0.25 F5:0.75 G5:0.75 Bb5:0.5~",                 # 21 Abmaj9    the pocket now climbs
    "Bb5:0.5 C6:1.5 Bb5:0.5 G5:0.5 F5:1",                               # 22 Bb/Ab     apex C6 in beta's slot
    "r:0.5 D5:0.25 D5:0.25 F5:0.5 G5:0.5 E5:0.75 F5:0.25 G5:0.5 Bb5:0.5~",  # 23 Gm7 | C7b9  the E-natural
    "Bb5:0.5 Ab5:0.5 G5:0.5 F5:0.5 Eb5:1.5 r:0.5",                      # 24 Fm9 | Bb9sus  lands on the sus
]

VERSE2 = [  # bars 25-28: the story continues over the groove, busier, climbing to F5
    "r:0.5 G4:0.25 Bb4:0.25 Bb4:0.25 Bb4:0.25 C5:0.5 Bb4:0.5 G4:0.5 Bb4:1",          # 25 Ebadd9
    "r:0.5 F4:0.25 G4:0.25 Bb4:0.5 D5:0.75 C5:0.25 Bb4:1.5",                        # 26 Bb/D
    "r:0.5 G4:0.25 G4:0.25 Bb4:0.25 C5:0.25 D5:0.5 Eb5:0.5 F5:0.5 Eb5:0.5 D5:0.5",  # 27 Cm9
    "Db5:1.5 C5:0.5 Bb4:0.5 Ab4:0.5 G4:0.5 Bb4:0.5",                                # 28 Bbm9 | Eb7b9
]

PRE2 = [  # bars 29-32: as pre 1, no drop: it runs straight into the chorus
    "r:0.5 C5:0.25 C5:0.25 C5:0.25 C5:0.25 Bb4:0.5 C5:0.5 Eb5:1.5",     # 29 Fm9
    "r:0.5 D5:0.25 D5:0.25 D5:0.5 C5:0.25 D5:0.25 F5:1.5 G5:0.5",       # 30 Gm7   (+ a G5 lift)
    "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.25 Eb5:0.25 F5:0.5 Gb5:1.5 F5:0.5",  # 31 Ab(add9) | Adim7
    "r:0.5 Eb5:1 F5:0.5 D5:1 C5:0.5 Bb4:0.5",                           # 32 Bb13sus | Bb7
]

CHORUS2 = [  # bars 33-40: the singer's second chorus (16th scoops, a little lick), octaves in 37-38, deceptive end
    "G5:1.5 Ab5:0.25 G5:0.25 F5:0.75 Eb5:0.75 C5:0.5",                              # 33
    "Bb4:0.25 C5:0.25 Eb5:1.5 D5:1.5 r:0.5",                                        # 34 scoop into beta
    "r:0.5 Bb4:0.25 Bb4:0.25 C5:0.25 D5:0.25 Eb5:0.5 F5:1.25 Eb5:0.25 D5:0.5~",     # 35 denser flow
    "D5:1.5 C5:1 Bb4:0.25 C5:0.25 r:0.5 Bb4:0.5",                                   # 36 a little turn
    "G5:1.5 Ab5:0.25 G5:0.25 F5:0.75 G5:0.75 Bb5:0.5~",                             # 37 (octaves)
    "Bb5:0.5 C6:1.5 Bb5:0.5 G5:0.5 F5:1",                                           # 38 (octaves)
    "r:0.5 D5:0.25 D5:0.25 F5:0.5 G5:0.5 E5:0.75 F5:0.25 G5:0.5 Bb5:0.5~",          # 39
    "Bb5:0.5 Ab5:0.5%4 G5:0.5%3 F5:0.5%1 Eb5:0.5%2 D5:1%1 r:0.5",                             # 40 Fm9 | Bb7: Eb-D, then vi
]

# ---------------------------------------------------------------------------------------------------------------
# C minor bridge (half-time, broad) and the build on a C pedal
# ---------------------------------------------------------------------------------------------------------------
BRIDGE = [  # bars 41-48: long notes, a new tune; #11 colour, the augmented 2nd, alpha in minor (m6), a climb
    "Eb5:2 C5:1.5 G4:0.5",               # 41 Cm9         D5 -> Eb5 completes the deceptive cadence
    "Bb4:0.5 C5:0.5 D5:3",               # 42 Abmaj7#11   the held #11
    "Eb5:1.5 C5:0.5 Ab4:1.5 G4:0.5",     # 43 Fm9
    "C5:2 B4:1 Ab4:1",                   # 44 G7sus | G7b9  B -> Ab: the augmented 2nd
    "G4:1 Eb5:3",                        # 45 Cm(add9) | Cm(maj7)  alpha's leap, now a minor 6th
    "D5:0.5 Eb5:0.5 F5:1 G5:2",          # 46 Cm7 | Cm6   the climb starts
    "Ab5:2 G5:1 F5:0.5 Eb5:0.5",         # 47 Abmaj9 | Fm9  (G5 = 9th on beat 3, no 8ves with the bass)
    "F5:1 D5:1 B4:2",                    # 48 Dm7b5 | G7b9  the leading tone
]

BUILD = [  # bars 49-52: the 3+3+2 pocket as a rising top line over the C pedal; C7b9 flourish; the silent beat
    "Eb5:1.5 Eb5:1.5 G5:1",                                             # 49 Abmaj7/C
    "F5:1.5 F5:1.5 Bb5:1",                                              # 50 Bb/C
    "G5:1.5 G5:1.5 Bb5:1",                                              # 51 C7sus4
    "C6:0.75 G5:0.25 E5:0.25 G5:0.25 Bb5:0.25 Db6:0.25 Bb5:1 r:0.5 C5:0.5",  # 52 C7b9 -> silence -> pickup
]

# ---------------------------------------------------------------------------------------------------------------
# F major: climax chorus (+2), tag, final A, coda
# ---------------------------------------------------------------------------------------------------------------
CLIMAX = [  # bars 53-60, octave melody; bar 57 climbs in 8ths; bar 58 = the one F6, an appoggiatura to E6
    "A5:1.5 Bb5:0.25 A5:0.25 G5:0.75 F5:0.75 D5:0.5",                   # 53 Bbmaj9
    "C5:0.25 D5:0.25 F5:1.5 E5:1.5 r:0.5",                              # 54 C13sus | C7
    "r:0.5 C5:0.25 C5:0.25 D5:0.25 E5:0.25 F5:0.5 G5:1.25 F5:0.25 E5:0.5~",  # 55 Am7
    "E5:1.5 D5:1 C5:0.25 D5:0.25 r:0.5 C5:0.5",                         # 56 Dm9 | Dm9/C
    "A5:1.5 Bb5:0.25 A5:0.25 G5:0.5 A5:0.5 C6:0.5 D6:0.5~",             # 57 Bbmaj9   climbing 8ths
    "D6:0.5 F6:1.5 E6:0.5 D6:0.5 C6:0.5 A5:0.5",                        # 58 C/Bb     APEX
    "r:0.5 E5:0.25 E5:0.25 G5:0.5 A5:0.5 F#5:0.75 G5:0.25 A5:0.5 C6:0.5~",  # 59 Am7 | D7b9  the F#
    "C6:0.5 Bb5:0.5 A5:0.5 G5:0.5 F5:1 r:0.5 C5:0.5",                   # 60 Gm9 | C9sus -> the leap lands on I
]

TAG = [  # bars 61-62: the first fortissimo tonic: the hook's leap finally lands on I; the line sinks 3-2-1-7
    "A5:2 G5:1 F5:1",                    # 61 Fadd9
    "E5:2 r:1.5 C5:0.5",                 # 62 Fmaj7/A (fermata)
]

FINAL_A = [  # bars 63-66: hook bars 1-4 in F, pp, bare, the plain (intro) rhythm again
    "A5:1.5 Bb5:0.25 A5:0.25 G5:1 F5:0.5 D5:0.5",                       # 63 Bbmaj9
    "C5:0.5 F5:1.5 E5:2",                                               # 64 C13sus | C7
    "r:0.5 C5:0.25 C5:0.25 D5:0.5 E5:0.5 G5:1.25 F5:0.25 E5:0.5~",      # 65 Am7
    "E5:1.5 D5:1.5 r:0.5 C5:0.5",                                       # 66 Dm9
]

CODA = [  # bars 67-69: alpha one last time, F5 -> Db5 over Bbm6 (the b6), home on C5
    "A5:1.5 Bb5:0.25 A5:0.25 G5:1.5 F5:0.5~",                           # 67 Bbmaj9
    "F5:1 G5:0.5 F5:0.5 Db5:2",                                         # 68 Bbm6
    "C5:4",                                                             # 69 Fadd9
]
