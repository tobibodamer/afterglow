"""Afterglow - the tune, note by note (DSL line() tokens; durations in beats, 0.25 = 16th, '~' ties into the next
bar). One string per bar. Built from the winning "melody" candidate's hook, re-composed in the final pass and in fix
round 1 (arrivals, entries, bridge, tag, final A, the last cadence).

Cells (every melody in the piece is built from these three):
  alpha "leap and turn": the 5 -> 3 pickup (a rising major 6th), a held 3rd, an upper-neighbour turn 3-4-3, then a
                         3+3+2 "pocket" fall (dotted 8th, dotted 8th, 8th) - the hip-hop tresillo inside a pop hook
  beta  "sus sigh":      the sus4 struck on the "&" of 1 over V (an appoggiatura), resolving to V's 3rd on beat 3
  gamma "flow pickup":   rest on the downbeat, then repeated-note 16ths climbing by step, like a rap/R&B pickup.
                         Fix round 1: gamma belongs to the pre-choruses (13-15, 29-31) and the FIRST answer of each
                         chorus (19, 35). The verse, the second chorus answers and the climax enter their own ways
                         (a lazy 16th on the "a" of 1, ties and anticipations over the bar line, long downbeats).
Story: the intro only hints (leap, sigh) and stops on an unresolved 9th. The verse has its own HEAD (fix round 2): a
broken rising sixth up to a held Eb5 - alpha's leap filled in - and plants the hook's 3+3+2 pocket once (bar 7). The
hook always lands its leap on IV (as IV's maj7, a question). Only at the tag (bar 61) does the same leap land on I,
with the hook's own turn and pocket: the hook finally comes home, and that is its last full statement. Final A is a
memory of the VERSE head over vi with a 9-8 sigh; the coda says alpha the way the intro did (the leap alone onto a held
A5), then falls by step and closes minor-plagal with the b6 tied over the bar line into the last chord (Db5 -> C5).
Fingers: '%n' pins (RH 1 = thumb). The octave hook turns are 4-5-4 over the thumb's doubling (fix round 1).
"""

# ---------------------------------------------------------------------------------------------------------------
# Eb major
# ---------------------------------------------------------------------------------------------------------------
INTRO = [  # bars 1-4, free time: the leap and the sigh only, a P5 echo, then it stops on the 9th (unresolved)
    "r:1.5 Bb4:0.5 G5:2",                                # 1 Abmaj9   alpha's leap, nothing else (no turn yet)
    "r:0.5 Eb5:1.5 D5:2",                                # 2 Bb13sus | Bb7(13)   beta: the sigh, alone
    "r:1.5 Bb4:0.5 F5:1.5 Eb5:0.5",                      # 3 Gm9      the leap echoed smaller (a 5th)
    "D5:1.5%4 Eb5:0.5%5 C5:1%3 r:1",                     # 4 Cm9 | Bb9sus4   stops on C (the 9th); fermata on the chord
]

VERSE1 = [  # bars 5-12, low and conversational; phrases a a' b c. Fix round 2: one HEAD rhythm (8th rest, two 16ths,
            # a long note on beat 2, three 8ths) opens phrases a (5) and b (9): a broken rising sixth up to a held Eb5 -
            # alpha's leap filled in. a' (7) keeps the head's pickup and breaks the long note into the 3+3+2 pocket: the
            # hook's rhythm is planted once before the chorus. The goal is still the syncopated F5 (12)
    "r:0.5 G4:0.25%2 Bb4:0.25%3 Eb5:1.5%5 D5:0.5%4 Bb4:0.5%2 C5:0.5~%3",  # 5  Ebadd9   HEAD: G-Bb-Eb, the maj7 passes
    "C5:0.75 Bb4:0.25 G4:0.5 F4:2 r:0.5",                                 # 6  Bb/D     C5 (9th) tied in, sinks to F4
    "r:0.5 G4:0.25%2 Bb4:0.25%3 Eb5:0.75%5 D5:0.75%4 Bb4:0.5%2 C5:0.5%3 D5:0.5%4",  # 7  Cm9  the head's pickup + the
    #                                                                          POCKET (Eb-D-Bb, 3+3+2); D5 slides to Db
    "Db5:1%2 C5:0.5%1 Bb4:0.5%3 Ab4:0.5%2 G4:1.5%1",                      # 8  Bbm9 | Eb7  D-Db-C slide; Ab-G sigh
    #                                                                          (thumb on the white keys, 3 over it)
    "r:0.5 Ab4:0.25%2 C5:0.25%3 Eb5:1.5%5 C5:0.5%3 Bb4:0.5%2 Eb5:0.5~%5",  # 9  Abmaj9  HEAD over IV: Ab-C-Eb, then the
    #                                                                          leap back up to the Eb that turns to the tear
    "Eb5:0.5 Cb5:1.5 Bb4:0.5 Ab4:0.5 Bb4:1",                              # 10 Abm6     the tear, on the "&" of 1
    "Bb4:1 Eb5:0.5 D5:0.5 C5:1.5 A4:0.5",                                 # 11 Eb/G | Gbdim7  Eb5 falls by step; C5 over
    #                                                                          the dim7, A4 -> Ab4 into 12
    "Ab4:0.5 C5:0.5 Eb5:0.5 F5:1.5 Eb5:1",                                # 12 Fm11 | Bb9sus4  the verse's peak F5,
]                                                                         #    syncopated on the "&" of 2, unresolved

PRE1 = [  # bars 13-16: gamma sequenced up by step (C, D, Eb -> Gb): three strikes + a syncopated landing; the
          # landing F5 is held over the sus and the dry stab hangs the 7th (Ab5) in the drop (beta is saved for 18)
    "r:0.5 C5:0.25 C5:0.25 C5:0.5 Bb4:0.25 C5:0.75 Eb5:1 r:0.5",          # 13 Fm9
    "r:0.5 D5:0.25 D5:0.25 D5:0.5 C5:0.25 D5:0.75 F5:1 r:0.5",            # 14 Gm7
    "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.5 F5:0.5 Gb5:1.5 F5:0.5~",             # 15 Ab(add9) | Adim7
    "F5:2 Ab5:0.5 r:1 Bb4:0.5",                                           # 16 Bb13sus | Bb7: held F5, Ab5 on the dry
]                                                                         #    stab (the 7th hangs in the DROP)

CHORUS1 = [  # bars 17-24: call (alpha+beta) / response (gamma + 9-8 sigh) / call higher / chromatic turn home
    "G5:1.5 Ab5:0.25 G5:0.25 F5:0.75 Eb5:0.75 C5:0.5",                    # 17 Abmaj9    alpha + 3+3+2 pocket
    "Bb4:0.5 Eb5:1.5 D5:1.5 r:0.5",                                       # 18 Bb13sus | Bb7  beta (first full statement)
    "r:0.5 Bb4:0.25%1 Bb4:0.25%1 C5:0.5%2 D5:0.5%3 F5:1.25%5 Eb5:0.25%4 D5:0.5~%3",  # 19 Gm7  gamma, anticipates Cm9
    "D5:1.5 C5:1.5%2 r:0.5 Bb4:0.5",                                      # 20 Cm9 | /Bb  9-8 sigh
    "G5:1.5 Ab5:0.25 G5:0.25 F5:0.75%3 Gb5:0.25%4 G5:0.5%4 Bb5:0.5~%5",   # 21 Abmaj9    the pocket now climbs,
    #                                       through a blue-note slide Gb5 -> G5 (one finger, black to white): the one
    #                                       bluesy crush in the hook, chorus 1 only
    "Bb5:0.5 C6:1.5 Bb5:0.5 G5:0.5 F5:0.75 D5:0.25~",                     # 22 Bb/Ab     apex C6 in beta's slot; the
    #                                                                          answer is anticipated on the "a" of 4
    "D5:1.25 F5:0.25 G5:0.5 E5:0.75 F5:0.25 G5:0.5 Bb5:0.5~",             # 23 Gm7 | C7b9  tied entry, the E-natural
    "Bb5:0.5 Ab5:0.25 G5:0.25 F5:0.75 Eb5:0.75 C5:0.5 Bb4:0.25 C5:0.25 Eb5:0.5~",  # 24 Fm9 | Bb9sus: the pocket
]                                                                         #    again, then the sus Eb tied over (elision)

VERSE2 = [  # bars 25-28: elided - the held Eb becomes I's root and falls a 6th (alpha inverted); lazier, to F5
    "Eb5:1 G4:0.25%1 Bb4:0.25%2 Eb5:1%5 D5:0.5%4 Bb4:0.5%2 C5:0.5~%3",    # 25 Ebadd9   the tied Eb falls a 6th, then
    #                                                                          the verse HEAD's pickup climbs back to it
    "C5:0.75 Bb4:0.25 G4:0.5 F4:2.5",                                     # 26 Bb/D     the 9th tied in, a long F4
    "r:0.75 G4:0.25%1 Bb4:0.5%2 C5:0.25%1 D5:0.25%2 Eb5:0.5%3 F5:0.5%4 Eb5:0.5%3 Db5:0.5~%2",  # 27 Cm9 -> Bbm9:
    #                                       enters on the "a" of 1; the tune anticipates Db with the bass
    "Db5:1.5 C5:0.5%1 Bb4:0.5%3 Ab4:0.5%2 G4:1%1",                        # 28 Bbm9 | Eb7  (dry LH fill)
]

PRE2 = [  # bars 29-32: as pre 1 with a "backing vocal" in RH thirds (arr.py), a G5 lift, no drop (LH fill)
    "r:0.5 C5:0.25 C5:0.25 C5:0.5 Bb4:0.25 C5:0.75 Eb5:1 r:0.5",          # 29 Fm9
    "r:0.5 D5:0.25 D5:0.25 D5:0.5 C5:0.25 D5:0.75 F5:1 G5:0.5",           # 30 Gm7   (+ a G5 lift)
    "r:0.5 Eb5:0.25%2 Eb5:0.25%2 F5:0.25%3 G5:0.25%4 Ab5:0.5%5 A5:1%5 Gb5:0.5%4 F5:0.5~%3",  # 31 Ab(add9) | Adim7  fix round 2: the
    #                                       third leg breaks out upward a beat early (Eb-F-G-Ab -> A5 = the dim7's root,
    #                                       the pre's new high), then falls Gb-F onto the sus
    "F5:1.5 G5:0.5 Ab5:1.5 Bb4:0.5",                                      # 32 Bb13sus | Bb7  the 7th held into the hook
]

CHORUS2 = [  # bars 33-40: the singer's second chorus (scoop, flow, turn, a new answer), octaves 37-38, deceptive end
    "G5:1.5%4 Ab5:0.25%5 G5:0.25%4 F5:0.75%3 Eb5:0.75%2 C5:0.5%1",        # 33
    "Bb4:0.25 C5:0.25 Eb5:1.5 D5:1.5 r:0.5",                              # 34 scoop into beta
    "r:0.5 Bb4:0.25%1 Bb4:0.25%1 C5:0.25%2 D5:0.25%3 Eb5:0.5%4 F5:1.25%5 Eb5:0.25%4 D5:0.5~%3",  # 35 denser flow
    "D5:1.5 C5:1%2 Bb4:0.25%1 C5:0.25%2 r:0.5 Bb4:0.5",                   # 36 a little turn
    "G5:1.5%4 Ab5:0.25%5 G5:0.25%4 F5:0.75%5 G5:0.75%4 Bb5:0.5~%5",       # 37 (octaves) turn on 4-5-4
    "Bb5:0.5 C6:1.5 Bb5:0.5 G5:0.5 F5:1",                                 # 38 (octaves)
    "D5:1.5 F5:0.25 G5:0.25 E5:0.5 F5:0.25 E5:0.25 G5:0.5 Bb5:0.5~",      # 39 long downbeat, moves on the "&" of 2;
    #                                                                          the E-natural with a turn
    "Bb5:0.5 G5:0.25 Ab5:0.25 F5:0.5 C5:0.5 Eb5:2~",                      # 40 a new R&B answer; the sus Eb5 is held
]                                                                         #    over: it becomes C minor's 3rd

# ---------------------------------------------------------------------------------------------------------------
# C minor bridge (half-time, broad) and the build on a C pedal
# ---------------------------------------------------------------------------------------------------------------
BRIDGE = [  # bars 41-48: a new tune: the held common tone, #11 on beta's slot, a syncopated answer, the augmented 2nd,
            # alpha's leap in minor (m6), then a sequence of rising leaps to the bridge's peak: beta's sigh in minor
            # Ab5 -> G5 landing on the #11 of the Neapolitan Db, and alpha's 3+3+2 fall in augmentation (G-F-D)
    "Eb5:2 D5:0.5 C5:1 G4:0.5",          # 41 Cm9         (Eb5 tied from bar 40 = the deceptive cadence)
    "Bb4:0.5 D5:1.5 G5:0.5 F5:0.5 Eb5:0.5 D5:0.5",  # 42 Abmaj7#11   D5 (#11) on the "&" of 1, then a Lydian fall
    "r:0.5 F5:1.5%5 Eb5:0.5%4 C5:0.5%3 Ab4:1%2",  # 43 Fm7  a syncopated entry (a trace of the pocket survives)
    "C5:2 B4:1 Ab4:1",                   # 44 G7sus | G7b9  sus4 -> 3, then B -> Ab: the augmented 2nd
    "G4:1 Eb5:3",                        # 45 Cm | Cm(maj7)  alpha's leap, now a minor 6th (line cliche C-B below)
    "C5:1 G5:2 F5:1",                    # 46 Cm7 | Cm6      the leap again, a 5th, higher (Bb-A below)
    "r:0.5 Ab5:1.5 G5:2",                # 47 Fm9/Ab | Dbmaj7#11  beta's sigh in minor: Ab5 on the "&" of 1 sinks
    #                                       onto G5 = the #11 of the Neapolitan Db
    "G5:1.5 F5:1.5 D5:1",                # 48 G7sus4 | G7b9  alpha's 3+3+2 fall in augmentation
]

BUILD = [  # bars 49-52: the 3+3+2 pocket as a rising top line over the C pedal (Eb-F-G-Ab, every bar's "2" anticipates
           # the next bar's note); rhythm doubles each bar; the sweep stops on Ab5 (b13) so A5 at 53 is the new high
    "Eb5:1.5 Eb5:1 F5:0.25 Eb5:0.25 F5:1",                              # 49 Abmaj7/C   hits; the hook's turn (5-6-5)
    "F5:1.5 F5:1 G5:0.25 F5:0.25 G5:1",                                 # 50 Bb/C       the same a step higher, LH 8ths
    "G5:2%5 G5:1%5 Ab5:1",                                                  # 51 C9sus4 -> b13: 16ths hand-to-hand; G5
    #                                                                     re-struck on beat 3 inside the stab
    "r:0.25 C4:0.25%1 E4:0.25%2 G4:0.25%3 Bb4:0.25%1 Db5:0.25%2 E5:0.25%3 G5:0.25%4 Ab5:0.5%5 r:1 C5:0.5",
    #                                                                     52 C7(b9,b13) sweep, silence; Ab5 -> A5 = sunrise
]

# ---------------------------------------------------------------------------------------------------------------
# F major: climax chorus (+2), tag, final A, coda
# ---------------------------------------------------------------------------------------------------------------
CLIMAX = [  # bars 53-60, octave melody; 55 opens on a long C6; bar 57 climbs in 8ths; 58 = the one F6, an appoggiatura
    "A5:1.5%4 Bb5:0.25%5 A5:0.25%4 G5:0.75%5 F5:0.75%4 D5:0.5%5",       # 53 Bbmaj9   the new high after the riser
    "C5:0.25 D5:0.25 F5:1.5 E5:1.5 r:0.5",                              # 54 C13sus | C7   scoop into beta
    "C6:1.5 A5:0.5 G5:0.75 F5:0.25 E5:0.5 D5:0.5~",                     # 55 Am7   a long C6 on the downbeat, moves
    #                                                                       on the "&" of 2; D5 anticipates Dm9
    "D5:1 F5:0.5 E5:1 D5:0.5 r:0.5 C5:0.5",                             # 56 Dm9 | Dm9/C
    "A5:1.5%4 Bb5:0.25%5 A5:0.25%4 G5:0.5%5 A5:0.5%4 C6:0.5%5 D6:0.5~%4",  # 57 Bbmaj9   climbing 8ths
    "D6:0.5 F6:2%5 E6:0.5 C6:0.5 A5:0.5~",                              # 58 C9sus4/Bb -> C/Bb  APEX: beta at the peak,
    #                                                                       F6 held to 3.5 so it has decayed before E6
    "A5:1 G5:0.5 E5:0.5 F#5:0.75%3 G5:0.25%4 A5:0.5%5 C6:0.5~%5",       # 59 Am7 | D7b9  tied entry, the F# (single,
    #                                       inside the RH chord: F#5 3 - G5 4 - A5 5, no 4-over-5 crossing)
    "C6:1 A5:0.5 G5:0.5 F5:1 r:0.5 C5:0.5",                             # 60 Gm9 | C9sus4: a sus F, a breath, then
]                                                                       #    the lone C5 -> the leap lands on I

TAG = [  # bars 61-62: the first fortissimo tonic: the hook's leap lands on I WITH its own turn and pocket (octaves),
         # the pocket's "2" rings up to C6; then it lets go (62) and the memory's pickup drops two octaves
    "A5:1.5%4 Bb5:0.25%5 A5:0.25%4 G5:0.75%5 F5:0.75%4 C6:0.5~%5",      # 61 Fadd9
    "C6:1 A5:1 E5:2%3",                                                 # 62 Fmaj7/A (fermata on E5; E5 on 3 over the
    #                                                                     inner A4 C5 on 1-2). No pickup: final A enters
    #                                                                     with its own head
]

FINAL_A = [  # bars 63-64 (fix round 2): a memory of the VERSE, not the hook - verse 1's head (bar 5) in F over vi, its
             # long note sighing 9-8 (E5 -> D5, the 9-8 fall of chorus bar 20), then a falling answer. No alpha turn,
             # no C -> A leap: the hook's head is kept for the tag (61) and the coda's leap (64 -> 65)
    "r:0.5 A4:0.25%1 C5:0.25%2 F5:1.5%5 E5:1%4 D5:0.5~%3",              # 63 Dm9   HEAD over vi; the re-catch on
    #                                                                     3.5 clears F5 under the sigh E5
    "D5:1 Bb4:1 A4:1.5 C5:0.5",                                         # 64 Gm7 | C7sus4  the C5 pickup leaps into the coda
]

CODA = [  # bars 65-67 (fix round 2): the intro's version of alpha - the leap alone onto a held A5, the turn withheld (as
          # in bar 1), so the piece closes the way it opened; then one long stepwise fall A-G-F-Eb-Db-C through the
          # minor plagal close, the b6 (Db5) TIED over the bar line into the last chord: a Bbm6/F appoggiatura over the
          # F bass, resolving Db5 -> C5 on beat 2 (with Bb3 -> A3, G4 -> A4)
    "A5:3%5 G5:0.5%4 F5:0.5~%3",                                        # 65 Bbmaj9   the leap lands and stays
    "F5:1.5%3 Eb5:0.5%5 Db5:2~%4",                                      # 66 Bbm6     F-Eb-Db (the hand shifts
    #                                                                     under the held F5: Eb5 on 5, Db5 on 4 -> C5 3)
    "Db5:1 C5:3%3",                                                     # 67 Fadd9
]
