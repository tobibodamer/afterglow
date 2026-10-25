# Music: research findings and composition brief ("Afterglow")

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Status: research done, brief ready to execute. A runnable skeleton of this exact brief (form, tempo map,
every voicing, the LH patterns, a sketch of all melodies) is in `sandbox/music-research/sketch.py`. It uses
the project DSL `music/dsl.py`. Its measured results are in section 8. The skeleton proves the plan is
playable and the right length. It is not the finished piece: the composer rewrites the melodies, inner lines and
voicing details by ear, and keeps the architecture.

Fact labels: **[src]** means looked up, with the URL in section 9. **[calc]** means I computed it. **[craft]**
means it is my own compositional judgement, given as a recommendation rather than a sourced fact.

---

## 0. Decisions (TL;DR)

| Item | Decision |
|---|---|
| Keys | **Eb major** (verses and choruses) -> **C minor** bridge (relative minor) -> **F major** climax and ending. The climax lifts a whole step, and the C-minor bridge prepares it because its tonic C becomes V of F. |
| Tempo | **76 BPM** verses, **78 BPM** choruses, **74** bridge, **80** climax. Intro, final A and coda are free (60-68). Groove sections keep a steady tempo (+/-1 %). |
| Feel | Straight 16ths in the ballad sections. **16th swing of 56-58 %** in the groove sections, never above 60 %. The half-time bridge is straight. |
| Form | 69 bars: Intro 4, Verse 8, Pre 4, Chorus 8, half Verse 4, Pre 4, Chorus 8, Bridge 8, Build 4, Climax chorus 8, Tag 2, Final A 4, Coda 3. The sketch measures **3:44.3** to the last note-off [calc]. |
| Hook | A chorus hook that starts with a **rising major-6th pickup (5 -> 3)** into a held 3rd, then a 16th-note turn (3-2-1-2). Bar 2 is a **syncopated sus4 appoggiatura** (Eb over Bb sus, resolving to D on beat 3). The second half climbs to C6, then makes a chromatic E-natural turn home. |
| Harmony | Verse: descending stepwise bass (I - V6 - vi - v-I7 - IV - iv - I6 - bIII°7 - ii - V). Pre-chorus: chromatic rising bass F-G-Ab-A-Bb. Chorus: **Royal Road IVmaj9 - V13sus - iii7 - vi9** (not RFIY's vi-IV-I-V). Ending: **IVmaj9 - ivm6 - Iadd9** (minor-plagal "afterglow" cadence). |
| Hip-hop elements | LH "boom-bap stride": the bass plays the kick (1, "a" of 2, "&" of 3) and tenor shells play the snare on 2 and 4. Also ghost notes, chromatic approach notes, anticipations on the "&" of 4, a half-time bridge with the backbeat on 3, and two one-beat "drops" (full silence, pedal up) before chorus 1 and the climax. |
| Score code | Keep and extend `music/dsl.py`. Add fingers per note, key-hold separate from sounding length, per-voice microtiming and swing, chord symbols, a pattern library and more validators (section 7). |

---

## 1. What makes "River Flows in You" work (and what we must not copy)

Facts:
- It is in **A major**. Hooktheory lists A major at **139 BPM** [src]. That figure is consistent with an
  eighth-note count of a quarter-note pulse around 65-70 [calc/inference]. Musicnotes' signature-artist
  edition says "freely, q = 65", 4/4 [src]. It was released in 2001 on *First Love*, track 4, 3:10 [src].
- The core loop is **vi-IV-I-V (F#m-D-A-E)**, played mostly as LH arpeggios [src, Pianote]. The arpeggio
  shapes are F#m root-5-root (F#-C#-F#), D as **D-A-E** (an added 9th instead of the octave), A as A-E-C#
  and E as E-B-G#. In other words, the figures target the 3rd and 9th rather than the octave [src].
- Melodic devices [src, Pianote]:
  - the melody opens on a **minor-2nd** tension;
  - the melody is "played very freely at the start";
  - a **held D (fermata)** follows the first theme and creates space;
  - 16th-note runs decorate the line, but it keeps returning to the core cell **A-A-A-G#**;
  - at intense moments the bass arpeggio starts lower;
  - "less is always more".
- Form [src, Pianote]: an intro that holds the melody back, the first theme, a more intense development
  (runs and rhythmic drive), then the return of the theme.
- Yiruma generally [src]:
  - "Pattern and repetition feature prominently", which makes the pieces feel like pop songs or film themes;
  - critics describe a light touch, lullaby-like upper-octave RH melodies, and a texture that thickens when the LH enters;
  - *Kiss the Rain* is published in Ab major, andante at about q = 72.

Why it pulls [craft]:
- There is one tiny cell, repeated with ornamental variation.
- The harmony is a familiar four-chord loop, coloured with open spacings (the 9th in the IV arpeggio).
- The melody sits in the singing octave (about C5-A5).
- The rhythm is elastic.
- The dynamic range is narrow, with one swell.
- Silence is used as punctuation.

**Borrow these mechanics:**
- an intro that withholds the theme;
- one core cell that keeps returning;
- open LH spacings (10ths, added 9ths);
- free time at the edges;
- "less is more" texture in the A sections.

**Do NOT copy any of these signatures:**
1. The key of A major or F# minor. We use Eb, which is a tritone away.
2. vi-IV-I-V at one chord per bar under continuous straight-8th LH arpeggios.
3. A melody that opens with upper-neighbour oscillation (x, x-1, x, x-1, x), or the "A-G#-A-G#-A-E-A-D" contour.
4. The D-A-E (1-5-9) arpeggio under IV as a recurring LH figure.
5. A fermata on a held note straight after the first 4-bar theme statement.
6. "Freely, q = 65" with 16th-note ornamental runs as the main surface.

The sketch's melody has **0** windows of 4 consecutive intervals that match RFIY's opening cell (-1 +1 -1 +1 -5 +5 -7),
and **0** strict +/-1 oscillations [calc]. That cell is the only part I can encode with confidence. The final check
still needs a listening comparison (checklist item 17).

## 2. Pop piano-ballad craft (applied)

- **Verse -> pre-chorus -> chorus lift** [src, Violet Recording / Wisseloord]:
  - Keep the verse low and conversational.
  - The pre-chorus (4-8 bars) climbs, uses shorter, more repetitive note values, and ends on an unstable V.
  - The chorus takes the highest register and the most memorable rhythmic hook.
  - Hooks land early in the chorus.
  - The chorus top note sits above the verse.
  - Octave stacking makes a hook feel bigger.
- **Chorus starts on IV, not I** [craft]. The tonic is delayed until the end of the chorus, which pulls you into
  the next section. The **Royal Road IVM7-V7-iii7-vi** is pop's best-documented "wistful" loop:
  - about 40 % of Japan's top-20 best-selling singles contain it;
  - the year's top Japanese single used it 23 % of the time in 1989-2019;
  - V7/IV (third-inversion) is the lush-arrangement variant;
  - it continues naturally into ii7-V7-I [src, Wikipedia].
  - It is the K-ballad and anime sound, which fits a Yiruma-adjacent piece. It is also structurally different from RFIY's vi-IV-I-V.
- **Modulation up a step** ("truck-driver's gear change") [src]:
  - It comes near the end and never comes back down.
  - About 25 % of US No. 1s from the 1960s-90s changed key; almost none did in 2010-2020 (Dalla Riva via NPR/Tedium).
  - For an instrumental showcase it is still the strongest single climax lift.
  - We **prepare** it (C-minor bridge -> C pedal = V of F) so it does not sound like a cheap shift [craft].
- **Climax devices** [craft]:
  - melody in octaves;
  - LH octaves with anticipations;
  - register expansion at both ends (melody apex F6, bass F1-Bb1 octaves);
  - denser rhythm (notes per second up from 4.9 in chorus 1 to 7.3 in the climax in the sketch [calc]);
  - one new apex note that the chorus never reached.
- **Chill correlates** to place on purpose [src]:
  - crescendos (Bannister 2020 survey);
  - a loudness increase in the 920-4400 Hz band (Nagel et al. 2008);
  - new or abrupt harmony, abrupt modulation, texture changes, added very high or very low register (Huron, secondary summary).
- **Endings that land** [craft]:
  - no fade;
  - a final ritardando shaped like a stopping runner (section 5.10);
  - the minor-plagal IV -> iv -> I with the melody b6 -> 5 (Db -> C in F);
  - the last chord left ringing 6-8 s before the pedal is released.

## 3. Hip-hop / lo-fi / neo-soul language for SOLO piano

- **Swing definition** (Roger Linn) [src]:
  - The second 16th of each 8th is delayed.
  - 50 % = straight and 66 % = triplet.
  - Useful values lie between 50 and about 70 %.
  - **54 % "loosens" a straight beat without sounding like swing.**
  - At 90 BPM, 62 % feels looser than 66 %.
  - Logic's presets are 50/54/58/62/66/71 % [src].
  - Quintuplet swing is 60 % and septuplet 57.1 % [src, The Pudding].
- **What those percentages mean in milliseconds at 78 BPM** (an 8th = 384.6 ms) [calc]:

  | Swing | Delay of the 2nd 16th |
  |---|---|
  | 54 % | 15 ms |
  | 56 % | 23 ms |
  | 58 % | 31 ms |
  | 60 % | 38 ms |
  | 62 % | 46 ms |
  | 66.7 % | 64 ms |

- **Dilla feel** [src]:
  - Straight, swung and shifted layers run at the same time, for example a straight kick and snare under swung hats, or a slightly early snare.
  - Dilla's famous snare shift was 5/192 of a measure, which is **80 ms at 78 BPM** [calc].
  - For one acoustic pianist that is far too much. Use the *principle* instead: the LH bass stays on the grid while the
    swung 16ths and the RH melody sit slightly late (section 5.10).
- **Boom-bap kick and snare placement** [src]:
  - Snare on 2 and 4.
  - Kick on 1, plus "the & of 2" or a 16th before 3, plus optional "& of 3" or ghost kicks.
  - Tempo is typically 85-95 BPM. Lo-fi hip-hop is 70-90 BPM, about 80 being typical.
  - Our 76-80 BPM sits where the lo-fi and ballad ranges overlap.
- **Neo-soul and R&B voicing** [src]:
  - extended chords (m9, m11, 13);
  - added 2nds and 4ths on minor 7ths;
  - **keep a common tone on top** while the harmony moves underneath;
  - rootless LH shells (A form = 3rd at the bottom, B form = 7th at the bottom) with the top voice between middle C and C5;
  - one-hand voicings live in about C3-C5;
  - bass from the LH 5th finger, colour from rootless voicings.
- **Translating hip-hop to two hands** [craft]:
  - LH 5th finger = kick, a tenor 3+7 dyad = snare, the RH thumb = hats and comping on off-beats.
  - Ghost notes at velocity 18-32.
  - Chromatic approach a half step below or above the next root on the last 16th or 8th of the bar.
  - Anticipate the next chord on the "&" of 4 (both hands, unless the melody is holding).
  - The **drop**: a beat of complete silence before a hook entrance.

## 4. Making the melody unforgettable

- **Jakubowski et al. 2016** (about 3,000 respondents, 100 earworms versus 100 matched non-earworms) [src]:
  - earworms are faster;
  - they have **common global contours, typically a rising first phrase and a falling second phrase**;
  - they contain an **unusual interval structure** (unexpected leaps, or more repeated notes than usual) inside an otherwise generic, easy line.
- **Sloboda** [src]: 18 of 20 passages that reliably caused tears or chills contained an **appoggiatura**. A chain
  of appoggiaturas builds a stronger tension-release cycle.
- Rules for the theme [craft]:
  - **Hook cell (2 bars), repeated at least 4 times in the piece**, each time with a variation (register, octave, harmony, ending).
  - Range of about a 9th to 10th in each chorus. Only the climax opens to an 11th or 12th.
  - Mostly steps (60-70 % of intervals) plus one signature leap (the rising **M6**).
  - Some repeated notes for a vocal-flow, hip-hop rhythm.
  - Exactly one chromatic "unusual" note per 8 bars (E-natural over C7 in bar 7 of the chorus).
  - Syncopated landings on the "&" of 1.
  - Call (2 bars) -> response (2 bars) -> call varied higher (2 bars) -> resolution (2 bars).
  - Leave space: a rest or a note of at least 1.5 beats in every bar, so the line can "breathe" like a singer.

---

## 5. COMPOSITION BRIEF

### 5.1 Key plan
- **Eb major** for verses and choruses [craft]:
  - warm middle register;
  - maj9/m9 hand shapes lie naturally on the black keys;
  - pop, R&B and gospel pianists live in flat keys;
  - a tritone from RFIY's A, so pitch-level resemblance is impossible;
  - for the animators, standard scale fingering applies (RH 3-1-2-3-4-1-2-3, LH 3-2-1-4-3-2-1-3 [src]) and the thumb stays off black keys in melody runs.
- **C minor** bridge: the relative minor, entered by a **deceptive cadence** (V -> vi) at the end of chorus 2.
- **F major** from the climax to the end. The build sits on a **C pedal** (C minor's tonic, reheard as V of F).
  The final chorus is up a whole step. Bridge-to-climax distance: 5 semitones of key movement in 16 bars, all prepared.

### 5.2 Tempo, feel and rubato per section

| Section | BPM | 16th swing | DSL `rubato` | Notes |
|---|---|---|---|---|
| Intro | 68 -> 60, free | 50 % | 0.9 | +1.2 s fermata on bar 4 beat 3 |
| Verse 1 | 76 | 51 % | 0.5 | ballad. Phrase arch about +2 % push, -8 % relax at phrase end |
| Pre 1 | 76 -> 78 | 53 % | 0.3 | tiny push. Drop: +0.15 s fermata on bar 16 beat 4 |
| Chorus 1 | 78 | **56 %** | 0.1 | groove enters. Tempo steady |
| Verse 2 | 78 | 57 % | 0.1 | |
| Pre 2 | 78 | 57 % | 0.1 | |
| Chorus 2 | 78 | **58 %** | 0.1 | |
| Bridge | 74 -> 72 | 50 % (half-time) | 0.6 | rubato returns: the contrast is in time as well as key |
| Build | 74 -> 80 | 50 % (driving straight 8ths) | 0 | accelerando plus crescendo. +0.5 s silent fermata bar 52 beat 4 |
| Climax | 80 | 56 % | 0.05 | dense textures: keep swing below chorus 2 so it stays tight |
| Tag | 77 -> 68 | 50 % | 0.4 | +0.6 s fermata bar 62 beat 3 |
| Final A | 66 -> 64 | 50 % | 0.9 | |
| Coda | 64 -> rit | 50 % | 0.9 | Friberg-Sundberg final ritardando (5.10) |

### 5.3 Form, bars, timings

Timings are measured from the sketch's tempo map [calc]. The sketch's last note-off is at **224.3 s = 3:44.3**.
With the reverb and damper tail, the audio is about 3:47-3:48. If the composer adds bars, trim the tag to 1 bar or the intro to 3 bars to stay under 3:50.

| # | Section | Bars | Starts at | Length | Content |
|---|---|---|---|---|---|
| 1 | Intro | 1-4 | 0:00.0 | 15.1 s | hook call alone over rolled chorus chords (IV V iii vi). The response is withheld; ends on a held sus with a fermata |
| 2 | Verse 1 (A) | 5-12 | 0:15.1 | 25.0 s | low, conversational melody F4-Eb5. Descending bass |
| 3 | Pre 1 | 13-16 | 0:40.1 | 12.5 s | repeated-note sequence rising by step. Chromatic bass rise. Ends on V, then a 1/2-beat drop |
| 4 | Chorus 1 (hook) | 17-24 | 0:52.6 | 24.6 s | hook, single-line melody plus off-beat RH comping. Boom-bap stride LH |
| 5 | Verse 2 (A', half) | 25-28 | 1:17.2 | 12.3 s | verse melody varied. "Lazy walk" LH. RH backbeat dyads |
| 6 | Pre 2 | 29-32 | 1:29.5 | 12.3 s | as pre 1, fuller. Ends on V without a drop |
| 7 | Chorus 2 | 33-40 | 1:41.7 | 24.6 s | hook with a tenor countermelody. Octave melody in bars 37-38. Ends V -> **vi (deceptive)** |
| 8 | Bridge (B) | 41-48 | 2:06.3 | 26.0 s | C minor, half-time, straight. New lyrical melody G4-Ab5. Line cliché C-B-Bb-A |
| 9 | Build | 49-52 | 2:32.3 | 12.9 s | C pedal, LH octave pulse, tresillo RH stabs, top line Eb5-F5-G5 -> Bb5. Silent beat |
| 10 | Climax chorus | 53-60 | 2:45.1 | 24.0 s | F major (+2). Octave melody, LH octave pushes, **apex F6 at 3:00.8 (80.6 % of the piece)** |
| 11 | Tag | 61-62 | 3:09.1 | 7.2 s | the first fortissimo tonic arrival of the piece, decaying |
| 12 | Final A | 63-66 | 3:16.4 | 14.5 s | first half of the hook, bare, pp, single line |
| 13 | Coda | 67-69 | 3:30.9 | 13.4 s | IVmaj9 -> ivm6 -> Iadd9. Melody Db5 -> C5. Rit, then let it ring |

### 5.4 Harmony and voicings

The chord tables are in the sketch file. Notation: middle C = C4.
- *Bass* is the LH 5th finger: struck, released, and sustained by the pedal.
- *Shell* is the LH upper notes, struck after the bass.
- *Pool* is the notes the RH may add under the melody (at least 3 semitones below it, at most an octave below).

**Verse (Eb), one chord per bar; "|" means a change at beat 3**

| Bar | Roman | Chord | Bass | Shell | RH pool | Passing LH note (move) |
|---|---|---|---|---|---|---|
| 5 | I | Ebadd9 | Eb2 | Bb2 G3 | F4 G4 Bb4 | F3 (9 -> 10) |
| 6 | V6 | Bb/D | D2 | F3 Bb3 | C4 D4 F4 Bb4 | C4 |
| 7 | vi | Cm9 | C2 | Eb3 Bb3 | D4 G4 Bb4 | D3 |
| 8 | v \| I7 | Bbm9 \| Eb7b9 | Bb1 \| Eb2 | Db3 Ab3 \| G3 Db4 | C4 F4 Ab4 \| Fb4 Bb4 Db5 | |
| 9 | IV | Abmaj9 | Ab1 | C3 G3 | Bb4 C5 Eb5 | Bb3 |
| 10 | iv (borrowed) | Abm6 | Ab1 | Cb3 F3 | Eb4 F4 Ab4 | |
| 11 | I6 \| bIII°7 (passing) | Eb/G \| Gbdim7 | G1 \| Gb1 | Eb3 Bb3 \| Eb3 A3 | G4 Bb4 Eb5 \| C4 Eb4 A4 | |
| 12 | ii \| V | Fm11 \| Bb9sus4 | F1 \| Bb1 | Eb3 Ab3 | Bb3 C4 Eb4 G4 \| C4 F4 Ab4 C5 | |

The bass line is a line, stepping down Eb2-D2-C2-Bb1 (Eb2)-Ab1-Ab1-G1-Gb1-F1-Bb1. Bar 10's iv minor is the verse's emotional colour.

**Pre-chorus (Eb):**

| Bar | Roman | Chords | Bass | Shells |
|---|---|---|---|---|
| 13 | ii9 | Fm9 | F1 | Eb3 Ab3 |
| 14 | iii7 | Gm7 | G1 | F3 Bb3 |
| 15 | IV(add9) \| #iv°7 | Ab(add9) \| Adim7 | Ab1 \| A1 | Eb3 C4 \| Eb3 Gb3 |
| 16 | V13sus4 \| V7(13) | Bb13sus4 \| Bb7(13) | Bb1 | Ab3 Eb4 \| Ab3 D4 |

The bass climbs F-G-Ab-A-Bb into the chorus, where it falls back to Ab: V -> IV, the J/K-pop lift. Pre 1 ends with a
half-beat drop.

**Chorus (Eb); the climax is the same table up a whole step**

| Bar | Roman | Chord(s) | Bass | Shell | RH pool |
|---|---|---|---|---|---|
| 1 | IVmaj9 | Abmaj9 | Ab1 | C3 G3 | Bb4 C5 Eb5 |
| 2 | V13sus4 \| V7(13) | Bb13sus4 \| Bb7(13) | Bb1 | Ab3 Eb4 \| Ab3 D4 | G4 C5 |
| 3 | iii7 | Gm7 | G1 | F3 Bb3 | D4 F4 G4 Bb4 |
| 4 | vi9 \| vi9/5 | Cm9 \| Cm9/Bb | C2 \| Bb1 | Eb3 Bb3 \| Eb3 G3 | D4 G4 C5 |
| 5 | IVmaj9 | Abmaj9 | Ab1 | C3 G3 | Bb4 C5 Eb5 |
| 6 | V4/2 | Bb/Ab | Ab1 | D3 F3 Bb3 | Bb4 D5 F5 |
| 7 | iii7 \| V7b9/ii | Gm7 \| C7b9 | G1 \| C2 | F3 Bb3 \| E3 Bb3 | G4 Db5 |
| 8 | ii9 \| V9sus4 | Fm9 \| Bb9sus4 | F1 \| Bb1 | Eb3 Ab3 \| Eb3 Ab3 | G4 C5 Eb5 |

How the cadence at bar 8 resolves in each chorus:
- Chorus 1 resolves to **I** at the downbeat of verse 2 (elision).
- Chorus 2 goes to **vi = Cm9**, the bridge downbeat (deceptive).
- In the climax, bar 8 resolves to **Fadd9** at the tag.

Climax voicings (F) use octave bass (Bb1+Bb2, C2+C3, A1+A2, D2+D3, G1+G2). The climax adds D7b9 (V/ii) at bar 59:
bass D2, shell F#3 C4, RH pool Eb5 F#5.

**Bridge (C minor), half-time**

| Bar | Roman | Chord(s) | Bass | Shell(s) |
|---|---|---|---|---|
| 41 | i9 | Cm9 | C2 | Eb3 Bb3 |
| 42 | VImaj7#11 | Abmaj7#11 | Ab1 | C3 G3 (RH D4 = #11) |
| 43 | iv9 | Fm9 | F1 | Eb3 Ab3 |
| 44 | V7sus4 \| V7b9 | G7sus4 \| G7b9 | G1 | F3 C4 \| F3 B3 |
| 45-46 | line cliché | Cm(add9) -> Cm(maj7) -> Cm7 -> Cm6 | C2 | top shell voice **C4 -> B3 -> Bb3 -> A3** |
| 47 | VImaj9 \| iv9 | Abmaj9 \| Fm9 | Ab1 \| F1 | |
| 48 | iiø7 \| V7b9 | Dm7b5 \| G7b9 | D2 \| G1 | F3 C4 \| F3 B3 |

**Build (C pedal = V of F):** LH octave C2+C3 throughout. RH chords:

| Bar | Chord | RH |
|---|---|---|
| 49 | Abmaj7/C | Ab3 C4 Eb4 G4 |
| 50 | Bb/C | Bb3 D4 F4 |
| 51 | C7sus4 | Bb3 C4 F4 G4 |
| 52 | C7b9 | Bb3 Db4 E4 G4 + RH 16th sweep C4-E4-G4-Bb4-Db5-E5-G5 into Bb5 on beat 3 |

Bar 52 then goes silent: pedal up, +0.5 s.

**Tag and coda (F):**

| Bar | Chord | Bass | Shell | Notes |
|---|---|---|---|---|
| 61 | Fadd9 | F1 | C3 G3 A3 | |
| 62 | Fmaj7/A | A1 | F3 C4 E4 | |
| 67 | Bbmaj9 | | | |
| 68 | Bbm6 | Bb1 | Db3 G3 (+F3 move) | |
| 69 | Fadd9 | F1 | C3 G3 A3 | rolled. RH F4 A4 under a C5 melody. Ring 6-8 s |

### 5.5 Main theme and the other melodies

Grid: 16th steps 0-15 per bar (0 = beat 1, 4 = beat 2, 8 = beat 3, 12 = beat 4). Durations are in 16ths.
Theme in Eb. The climax is the same up +2 with a new apex.

**Motivic cells** (everything is built from these):
- **alpha "leap and turn"**: pickup 5 -> held 3 (a rising M6, Bb4 -> G5), then a 16th turn 3-2-1-2.
- **beta "sus sigh"**: 6 -> 1 landing on the "&" of 1 (a syncopation) over V sus, then resolving to 7 (the 3rd of V) on beat 3. An appoggiatura.
- **gamma "flow pickup"**: repeated-note 16ths rising by step (5-5-6-7), like a rap or R&B vocal pickup.

**Chorus hook** (sketch). Pickup: bar 16 step 14 = Bb4, 2 sixteenths.

| Bar | Chord | Notes as pitch@step(duration) | Role |
|---|---|---|---|
| 1 | Abmaj9 | G5@0(6) F5@6(1) Eb5@7(1) F5@8(4) Eb5@12(2) Bb4@14(2) | alpha. G = maj7 of Ab: colour on the downbeat |
| 2 | Bb13sus \| Bb7 | C5@0(2) **Eb5@2(6)** D5@8(6) rest@14 | beta: the appoggiatura is the chill point |
| 3 | Gm7 | Bb4@2(1) Bb4@3(1) C5@4(2) D5@6(2) F5@8(6) Eb5@14(2, tied) | gamma = response |
| 4 | Cm9 \| /Bb | (tie) D5@4(4) C5@8(6) Bb4@14(2) | the 9 -> 8 sigh, then a pickup |
| 5 | Abmaj9 | G5@0(6) F5@6(1) Eb5@7(1) F5@8(2) G5@10(2) Bb5@12(4, tied) | alpha, varied: climbs instead of settling |
| 6 | Bb/Ab | (tie) **C6@2(6)** Bb5@8(2) G5@10(2) F5@12(4) | apex of the chorus, syncopated |
| 7 | Gm7 \| C7b9 | D5@0(2) F5@2(4) Eb5@6(2) **E-natural 5@8(4)** G5@12(2) F5@14(2, tied) | the one chromatic note |
| 8 | Fm9 \| Bb9sus | (tie) Eb5@4(2) C5@6(2) Bb4@8(2) C5@10(2) Eb5@12(4, tied over the barline) | Eb holds while the bass resolves |

- Contour: two arches, G5 falling to C5, then G5 climbing to C6 and falling to Eb5. The second phrase rises
  higher, which is Jakubowski's rise-then-fall applied at phrase level.
- Measured [calc]: range Bb4-C6 = 14 semitones; 25 of 38 intervals are steps; one M6 leap per phrase.
- Climax variant of bar 6 (in F): C6@0(2) D6@2(2) **F6@4(6)** D6@10(2) C6@12(2) A5@14(2). F6 is the only apex in the piece.
- The composer may change pitches. Keep these four things:
  1. the M6 pickup into a held 3rd;
  2. the sus-appoggiatura landing on the "&" of 1;
  3. the repeated-note pickup;
  4. the late chromatic turn.

**Verse melody** (2-bar phrases a, a', b, c):
- Each phrase starts on step 2 (after the downbeat) and uses gamma.
- The range is F4-Eb5, so the chorus feels like a lift.
- Bar 8 has a bluesy Db5 over Bbm9.
- Bar 10 holds **Cb5** (B4) over Abm6, the borrowed-minor tear.
- The phrase ends on Bb4 over V sus, unresolved.

**Pre-chorus melody**:
- gamma sequenced up by step: C5, then D5, then Eb5 to Gb5 (over A°7).
- Then beta (Eb5 -> D5) over V.
- Then the drop, and the Bb4 pickup.

**Bridge melody** (new, contrasting):
- Long notes: half notes and dotted halves.
- Lower centre G4-D5 in bars 41-44.
- The #11 colour (D5 over Ab).
- An **augmented 2nd B4 -> Ab4** over G7b9: harmonic minor, the bridge's "unusual interval".
- It climbs Eb5-F5-G5-Ab5 in bars 45-47 and falls to B4, the leading tone into the build.

**Build top line**: Eb5 (b49) -> F5 (b50) -> G5 (b51) -> C6 -> Bb5 (b52 beat 3). Then silence, and the C5 pickup ->
A5 opens the climax: the 7th resolves to the 3rd across the silence.

**Final A**: chorus bars 1-4 in F, pp, single line. **Coda**: alpha one last time (C5 -> A5, turn), then **F5 -> Db5**
over Bbm6, then **C5** over Fadd9.

### 5.6 LH accompaniment patterns

Rows are 16th steps. Labels:
- R = root in the bass (5th finger, key held 2-3 steps, then the pedal sustains it);
- R8 = root an octave up;
- S = shell (both upper notes), S0/S1 = lower or upper shell note;
- MV = moving inner note;
- APP = chromatic approach to the next bass (a half step below if the bass rises, above if it falls);
- lower case = ghost (velocity -16 to -22).

```
step          1 e & a 2 e & a 3 e & a 4 e & a
P1 Tenth Bloom (verse 1, pre 1): R on 1, S0 anticipates on "a of 1", S1 on "& of 2", inner 9->10 sigh
              R . . S0. . S1. . . MV. S1. . .
P2 Boom-Bap Stride (chorus 1, pre 2, chorus 2 bars 33-36): kick-snare-kick-snare
              R . . . S . . r . . R . S . a .        (r = ghost R8 on the "a" of 2, a = ghost APP)
P3 Lazy Walk (verse 2): long root, pushed shell, walking 8ths, ghost, double approach
              R . . . . . S . R8. . r S1. A .
P4 Octave Push (chorus 2 bars 37-40, climax): tresillo octaves plus an anticipation of the next root octave
              O . . . . . O . . . . . s . A .        (O = R+R8 octave, A = APP octave tied over the barline)
P5 Half-time Chorale (bridge): bass on 1, soft S0 on 2, full shell on 3 = half-time backbeat, line cliché on "& of 4"
              R . . . s . . . S . . . . . MV.
P6 Pulse Riser (build): straight 8th octaves C2+C3, accents on 1, "& of 2", 4 (3+3+2); velocity ramps 55 -> 100
              O . o . o . O . o . o . O . o .
P7 Rolled Bloom (intro, tag, final A, coda): bass, then shell an 8th later (not a fast roll), inner move on beat 3
              R . S . . . . . MV. . . . . . .
```

Half-bar (two chords per bar) variants:

| Pattern | Half-bar steps |
|---|---|
| P1 | R@0, S0@2, S1@5 |
| P2 | R@0, S@4, APP@6 |
| P3 | R@0, S@4, APP@6 |
| P4 | O@0, s@4, A@6 |
| P5 | R@0, S@4 |
| P7 | R@0, S@2 |

These patterns are exactly what `PAT` in `sketch.py` renders.

Variation rules:
- Never more than 3 consecutive bars of an identical LH rhythm.
- Every 4th bar of a groove section replaces its last beat with a fill: a walk-up, a ghost-note pair, or a rest (the drop).

### 5.7 RH texture, inner lines, countermelody

| Section | RH texture |
|---|---|
| Verse 1 | melody, plus one inner note at chord changes (steps 0 and 8), struck while the melody rests |
| Chorus 1 | off-beat comping dyads on steps 2 and 10 ("hats") |
| Verse 2 | backbeat dyads on 4 and 12 |
| Chorus 2 | comping on 2, 6 and 10. Melody in octaves in bars 37-38 |
| Climax | octave melody plus 1-2 inner chord tones on strong beats (4-note RH chords, span at most an octave) |
| Bridge | melody, plus held inner notes |
| Final A and coda | melody alone, with an inner tone at harmony changes |

Inner-line rules:
- In every 4-bar span there are at least 2 stepwise inner-voice motions: a suspension (4-3, 9-8, 7-6), a line cliché (1-7-b7-6) or a chromatic passing tone.
- Use a common tone on top of the RH comping when chords change (the neo-soul rule).

Countermelody (chorus 2 and climax):
- Whenever the melody holds at least 1.5 beats (chorus bars 2, 4, 6, 8), the **tenor** (LH thumb, about G3-Eb4) answers with a 3-6-note fill.
- The fill moves in contrary motion and in a different rhythm from the melody, and lands on a chord tone before the melody moves again.
- Example (bar 34, melody holding D5 on beat 3): LH tenor Bb3-C4-D4-F4 on steps 9-12-13-14, landing on Eb4 at the next bar.

Outer-voice rules:
- No parallel octaves or fifths between melody and bass, except deliberate octave doublings in the climax.
- Melody velocity at least 12 above any inner note struck at the same time.

### 5.8 Dynamic arc (MIDI velocity, before the DSL's phrase-arch scaling)

| Section | Melody | RH inner | LH shell | Bass | Ghost |
|---|---|---|---|---|---|
| Intro | 40-56 | 24-30 | 22-30 | 30-38 | |
| Verse 1 | 50-64 | 30-38 | 30-38 | 38-46 | |
| Pre 1 | 56-72 (crescendo) | 36-44 | 36-44 | 44-52 | |
| Chorus 1 | 66-82 | 42-50 | 44-52 | 52-62 | 22-32 |
| Verse 2 | 58-72 | 38-46 | 40-48 | 46-56 | 22-30 |
| Pre 2 | 62-80 | 42-52 | 46-54 | 54-62 | 24-32 |
| Chorus 2 | 74-92 | 48-58 | 50-58 | 58-70 | 26-34 |
| Bridge | 52-68 | 32-40 | 34-44 | 42-50 | |
| Build | 64 -> 100 ramp | 56 -> 90 | 56 -> 96 | | |
| Climax | 86-110 (F6 apex 108-115, once) | 66-80 | 70-82 | 80-96 | |
| Tag | 96 -> 70 | | | | |
| Final A | 38-54 | 20-28 | 20-28 | 26-32 | |
| Coda | 34-50 | | | | final chord 36-44, melody 46 |

Measured sketch averages, melody / accompaniment [calc]:

| Section | Melody | Accompaniment |
|---|---|---|
| Intro | 52 | 28 |
| Verse 1 | 60 | 35 |
| Chorus 1 | 76 | 46 |
| Chorus 2 | 83 | 54 |
| Bridge | 62 | 42 |
| Climax | 99 | 79 |
| Final A | 47 | 23 |
| Coda | 42 | 21 |

Salamander V3 has **16 velocity layers** (Yamaha C5, 48 kHz/24-bit, sampled every minor third, CC-BY 3.0, Alexander Holm) [src].
Differences under about 8 velocity steps may stay inside one layer [inference], so shape phrases with ranges of at least 10.

### 5.9 Pedal

- **Legato (syncopated) pedal at every harmony change** [src, Yamaha]: lift "a split second after" the new notes.
  Lifting too early gives a hiccup; lifting too late gives mud.
  - The DSL's default `change` is: up starts at +35 ms, fully up at +115 ms, down at +250 ms. Keep it for changes at half-bar or slower.
  - For changes 8th notes apart use +25 / +80 / +150 ms.
- **Key-hold is not sound length.** The LH bass key is released after 2-3 sixteenths and the pedal carries it.
  This is how real pianists leap from bass to shell, and the animators need the true key release.
- **Groove sections**: keep legato changes on each chord. For an occasional dry "snare", lift the pedal fully
  for that beat. This is rhythmic pedalling, which releases at bar ends and is legitimate [src].
- **Drops** (bar 16 beat 4, bar 52 beat 4): the pedal is fully up at least 120 ms before the silent beat, so the dampers
  stop the strings. Re-press it 60-90 ms after the next downbeat's bass.
- **Ending**: hold the last chord about 6-8 s, then release the pedal as a 0.5-0.8 s ramp. That is a natural damper release, not a cut.
- No una corda. Salamander has no una-corda samples, so the left foot rests (tell the animators).

### 5.10 Expressive timing (numbers to implement)

**Ballad sections** (intro, verse 1, bridge, final A, coda):
- The melody *leads* the accompaniment by 15-25 ms. At hammer level the measured melody lead is about 30 ms, mostly a
  velocity artifact (Goebl 2001) [src]. MIDI note-on equals the hammer strike in a sampler, so we add it explicitly.
  The DSL already uses -18 ms.

**Groove sections** (chorus, verse 2, pre 2, climax):
- LH bass on the grid (+/-3 ms).
- Backbeat shells +5 to +10 ms late.
- RH melody **+10 to +20 ms late** (laid back).
- Swung 16ths per the table in section 3. Bass and kick 16ths may stay straight: the Dilla straight-versus-swung layering, at a small scale [craft].
- Tempo steady.

**Phrase rubato**: push about 2-4 % toward the phrase peak (about 60 % through the phrase) and relax 8-16 % over the last beat.
Phrase-final notes are 15-30 % longer.

**Final ritardando** (Friberg & Sundberg 1999) [src]:

```
v(x) = [1 + (w^q - 1) * x]^(1/q)
```

- x runs 0 -> 1 over the last 2 bars;
- **q = 2-3** (the best-rated values; q = 3 models runners' constant braking power);
- w = 0.55-0.65 = final tempo / initial tempo.

The sketch uses linear tempo points instead (64 -> 50), so this formula still has to be implemented.

**Humanisation**: seeded. Onset jitter SD 2-5 ms, velocity SD 2. No unseeded randomness (project rule).

### 5.11 Idiomatic constraints (enforced by the sketch's checker)

- **Hand span of physically held keys** (pedal-sustained notes excluded):
  - RH at most 14 semitones (M9);
  - LH at most 16 (M10), with 15-16 only as broken or rolled shapes;
  - at most 5 keys per hand, normally at most 4.
  - Why: the male pianist mean thumb-to-5th span is 22.6 cm (8.9"). 21.6 cm (8.5") is about the 10th threshold, and roughly 76 % of men reach it [src].
- **Mud (low interval limits, middle C = C4)**: below each limit, use only octaves, fifths or a single note [src, a conventional chart; sources differ slightly].

  | Interval (semitones) | Lowest bottom note |
  |---|---|
  | m2 (1) | E3 |
  | M2 (2) | Eb3 |
  | m3 (3) | C3 |
  | M3, P4 (4, 5) | Bb2 |
  | tritone (6) | B2 |
  | P5 (7) | Bb1 |
  | m6-M7 (8-11) | F2 |
  | m9 (13) | E2 |
  | M9 (14) | Eb2 |
  | m10 (15) | G1 |
  | M10 (16) | F1 |

- **Registers**:
  - melody F4-C6 in Eb sections, with a single climax apex F6;
  - RH bells at most C7, rarely;
  - bass floor F1 (single notes or octaves; Eb1 at most once);
  - LH shells Bb2-Eb4;
  - LH top always below RH bottom (no crossing).
- **Leaps** (per hand, onset to onset): more than 24 semitones needs at least 300 ms; more than 12 semitones needs at least 140 ms.
  This gives the animators a natural arc. At 78 BPM a 16th is 192 ms.
- **Fingering**:
  - The RH thumb stays off black keys in melodic runs. Use the scale fingerings in section 5.1.
  - Inner RH notes are at least 3 semitones below the melody (no accidental m2 rub under the tune).
  - Repeated 16th notes on one key are fine at 78 BPM (192 ms apart).
- **The top of the keyboard**: the highest ~1.5 octaves of a grand have no dampers [general piano knowledge, not looked up].
  Bells above about F6 ring through pedal lifts. Use that on purpose in the coda only.

### 5.12 Originality guardrails

- The section 1 "do not copy" list.
- No more than 4 consecutive melody intervals identical to any known hit's opening cell.
- No reuse of a famous song's progression together with its accompaniment rhythm. Avoid in particular:
  - vi-IV-I-V with 8th-note arpeggios (RFIY);
  - the Someone-Like-You-style broken-chord 16ths in A major;
  - Pachelbel's I-V-vi-iii-IV-I-IV-V as a full 8-bar loop.
- Royal Road and descending-bass verses are generic idioms and are allowed.

---

## 6. "Does it sound composed?" Reviewer checklist

Each item is pass or fail. **Bold** items are blocking.

1. **Hook**: the chorus's first 2 bars can be sung back after one listen. The hook appears at least 4 times (intro fragment, C1, C2, climax, final A), varied each time.
2. **Motivic economy**: the reviewer can point to at least 3 places where verse, pre, bridge or coda melodies reuse cells alpha, beta or gamma (transposed, augmented or fragmented).
3. **No looping**: no 2-bar LH segment repeats verbatim more than 3 times in a row, and no 8-bar section is reused without changing at least 2 of register, LH pattern, inner line, rhythm and dynamics.
4. **Inner motion**: at least 2 stepwise inner-voice moves in every 4 bars (suspensions, line cliché, chromatic passing tones).
5. **The bass is a line**: in the verse and pre-chorus at least 50 % of bass moves are steps or chromatic approaches.
6. Harmonic rhythm varies: 1 chord per bar in the chorus, 2 at cadences, faster in the pre-chorus. Cadences are real: a half cadence (end of pre), an elided authentic cadence (C1 -> V2), a deceptive cadence (C2 -> bridge), a prepared modulation, and a minor-plagal close.
7. **Arrivals**: chorus 1 and the climax enter after a real silence (pedal up). The climax is the loudest and highest moment. The apex F6 occurs once, at 75-82 % of the duration (sketch: 80.6 %).
8. **Melody on top**: melody velocity is at least 12 above the simultaneous accompaniment. The melody is never masked. In the bridge, where it sits in the middle register, it is still the loudest voice.
9. **Breathing**: every bar of the melody has a rest or a note of at least 1.5 beats. Phrases are 2 or 4 bars with audible ends.
10. **Groove is credible but not cartoonish**: swing only on 16ths in the groove sections (56-58 %). A backbeat is audible (2 and 4 in choruses, 3 in the bridge). At least 1 anticipation per 2 chorus bars. Ghost notes are audible but soft (velocity 18-32).
11. **Rubato only where planned**: tempo steady (+/-1 %) in groove sections, elastic in ballad sections. No accidental drift (check the tempo curve).
12. **Dynamics arc** follows section 5.8. No section has a melody velocity range under 12.
13. **Playability**: the validator reports 0 span, mud, crossing and leap issues. Every note has a finger.
14. **Pedal**: no blur across harmony changes, and no dry gaps inside legato phrases. You can see this by plotting the CC64 curve against chord changes.
15. **Ending lands**: rit, then the minor-plagal cadence, then a stable last melody note (C5), a ring of at least 6 s, and a pedal release ramp. No fade-out and no abrupt cut.
16. **Duration**: 3:20-3:50 to the last note-off.
17. **Originality**: the automated n-gram check passes, and a human A/B listening comparison against RFIY, *Kiss the Rain*, "Someone Like You" and "All of Me" finds no shared melody or signature accompaniment.
18. **Sound**: no machine-gun repeated velocities (consecutive equal velocities on more than 4 notes of a line), natural releases (release samples on), tasteful reverb (no smeared transients), and no clipping.

---

## 7. How to represent the score in code

Keep the existing `music/dsl.py`, which has these working parts:
- a token grammar;
- swing on 16th pairs, following Linn's definition;
- phrase rubato and dynamic arches;
- fermatas;
- a legato pedal curve;
- melody lead;
- JSON and MIDI export;
- a leadsheet and piano-roll.

Add the following:

1. **`finger` on every note.** Token suffix `%3`, chords `[C4 E4 G4]%1,3,5`. Pattern templates carry default fingers: P2 bass = 5 and shell = 2+1, P4 octave = 5+1. The melody is fingered by hand.
   - Fallback auto-fingering: `pianoplayer` (MIT, PyPI) on the per-hand MIDI, then manual overrides [src].
   - Its polyphony handling is reported weak [src], so never trust it for chords.
2. **Key-hold separate from sound**:
   - `dur` = key held (MIDI note-off, and finger lift for the animation);
   - optional `sus=` = how long the sound should last;
   - the checker verifies the pedal is down from key release to onset + sus.
   - The current `check()` only compares simultaneous onsets. It must use held keys (the sketch's `extra_checks` shows how).
3. **Per-voice microtiming and swing per section**, replacing the single global melody lead, for example
   `Section(..., offsets_ms={"mel": +14, "acc": +7, "bass": 0, "ghost": 0}, swing_voices={"mel", "acc"})`,
   so that a groove section can lay the melody back while a ballad section leads it.
4. **Chord symbols as data**: `s.chord(bar, beat, "Abmaj9", roman="IV9", bass="Ab1", shell=[...], pool=[...])`.
   Patterns and inner voices read them, the leadsheet prints the intended symbols (not only detected ones), and the checker flags melody non-chord tones on strong beats unless they are tagged `app` (appoggiatura), `sus` or `pass`.
5. **A pattern library**: `s.lh(bar, "P2", variant={"ghost": True, "approach": "chromatic"})`, generating notes, fingers and voices from the chord data (port `PAT` from the sketch), plus the no-verbatim-loop check.
6. **Pedal as explicit, exportable events**: `legato` / `rhythmic` / `drop` / `release_ramp`.
   - Export the CC64 curve plus foot events (down/up start and end) for the foot animation.
   - The DSL's `pedal_curve` already gives (t, value). Add depth for half-pedal if the renderer supports continuous damping.
7. **Validators to run on every build**: span of held keys per hand, LIL mud, leap feasibility, crossing, melody prominence, finger conflicts (one finger on two held keys), RH thumb on a black key in a step-wise run, duration window, and the originality n-gram check. The sketch implements the first five.
8. **One performance file as the single source of truth for audio and picture**: `performance.json` with, per note, `id, pitch, t_on, t_off (key), vel, hand, finger, voice, section, bar, beat`, plus the pedal curve and bar, beat and section times. This already exists minus `finger` and `section`.
   - Keep the MIDI on a fixed 120 BPM grid with real seconds for rendering, as now.
   - Optionally export a notation MIDI or MusicXML with the real tempo map for the repo's score deliverable.

---

## 8. What I actually ran

`sandbox/music-research/sketch.py` builds the full 69-bar skeleton of this brief through `music/dsl.py`:
every voicing in 5.4, patterns P1-P7, the melodies in 5.5, the tempo map and fermatas in 5.2, pedal changes on every chord, and drops.
It also runs extra validators. Outputs, all in `sandbox/music-research/`: `checks.txt`, `leadsheet.txt`, `sketch.mid`, `sketch.json`.

Results:
- **Duration** 224.26 s = **3:44.3** to the last note-off. 994 notes. Section timings are as in table 5.3.
- **`Score.check()`: 0 issues.**
- Extra checks:
  - 0 mud issues (after moving the Eb7b9 shell up to G3-Db4; the first draft had a muddy Eb2-Db3 7th);
  - 0 held-span issues and 0 crossing issues (after making the bass key-hold short and pedal-sustained, and keeping the climax LH shell to one note under the octave-doubled melody; the first draft had 57 span flags and 3 crossings);
  - 1 leap flag, a checker false positive: the onsets of an RH octave split 18 ms apart by melody lead were grouped separately;
  - 1 melody onset less than 6 velocity above its accompaniment.
- **Melody** [calc]:

  | Section | Range |
  |---|---|
  | Verse | F4-Eb5 (10 st) |
  | Pre | Bb4-Gb5 |
  | Chorus | Bb4-C6 (14 st) |
  | Bridge | G4-Ab5 |
  | Climax | C5-F6 (17 st) |

  - Apex F6 at 180.8 s = 80.6 % of the duration.
  - Notes per second: 2.2 (intro), 3.9 (verse), 4.9 (chorus 1), 6.5 (chorus 2), 7.3 (climax), 1.5 (coda).
- **RFIY overlap**: 0 four-interval windows matching its opening cell. 0 neighbour-oscillation runs.
- **Not done**:
  - no audio render, and **nobody has listened to the sketch**;
  - no countermelody written;
  - no fingering assigned;
  - the Friberg ritardando is not implemented (linear tempo points stand in).

  The composer's pass has to add these and judge the melody by ear.

---

## 9. Sources

RFIY / Yiruma:
- https://www.pianote.com/blog/why-river-flows-in-you-is-so-popular/ (key, progression, LH figures, melodic devices, form)
- https://www.hooktheory.com/theorytab/artist/yiruma (A major, 139 BPM)
- https://www.musicnotes.com/sheetmusic/tutorialsbyhugo/river-flows-in-you/MN0266681 ("freely, q = 65", 4/4)
- https://en.wikipedia.org/wiki/River_Flows_in_You (First Love, 2001, track 4, 3:10)
- https://www.musicnotes.com/sheetmusic/yiruma/kiss-the-rain-piano-accompaniment/MN0116696 (Ab major, andante about 72)
- https://onlinepianist.com/piano-songs/yiruma ("pattern and repetition feature prominently")
- https://classicalexburns.com/2020/06/06/yiruma-kiss-the-rain-sweet-lullaby/ (light touch, upper-octave lullaby melody; via search summary)

Pop craft:
- https://violetrecording.com/how-to-write-a-pre-chorus/
- https://violetrecording.com/verse-chorus-verse-structure/
- https://wisseloord.org/?p=48256
- https://en.wikipedia.org/wiki/Royal_road_progression
- https://www.npr.org/transcripts/1139232684 and https://tedium.co/2022/11/09/the-death-of-the-key-change (key-change statistics)
- https://scout.wisc.edu/node/4142 (truck driver's gear change)

Hip-hop / groove / voicing:
- https://attackmagazine.com/?p=10694 (Roger Linn on swing)
- https://attackmagazine.com/technique/passing-notes/daw-drum-machine-swing/2 (Logic swing presets)
- https://pudding.cool/2023/06/groove/ (quintuplet and septuplet swing %, Dilla layering)
- https://www.lrb.co.uk/the-paper/v44/n20/francis-gooding/basement-beats (5/192-measure snare shift)
- https://ethanhein.substack.com/p/dilla-time
- https://violetrecording.com/how-to-make-a-boom-bap-beat/, https://www.audeobox.com/learn/fl-studio/how-to-make-boom-bap-beats-in-fl-studio/, https://blog.native-instruments.com/what-is-boom-bap/
- https://violetrecording.com/what-is-lofi-music/ (lo-fi 70-90 BPM)
- https://pianowithjonny.com/piano-lessons/4-steps-to-play-neo-soul-chords-on-piano/, https://pianowithjonny.com/piano-lessons/rootless-voicings/, https://www.earlmacdonald.com/jazz-piano-lessons/rootless-left-hand-piano-voicings/, https://www.pianogroove.com/jazz-piano-lessons/rootless-voicings-stride-drill/

Memorability / emotion:
- https://gold.ac.uk/news/scientists-find-key-to-writing-catchy-pop-hits and https://www.apa.org/news/press/releases/2016/11/earworms (Jakubowski 2016)
- https://garydavidstratton.com/2012/02/17/anatomy-of-a-tear-jerker-why-does-adeles-someone-like-you-make-everyone-cry-by-michaeleen-doucleff/ (Sloboda appoggiatura, via the WSJ article)
- https://durham-repository.worktribe.com/output/1347620/a-survey-into-the-experience-of-musically-induced-chills-emotions-situations-and-music (Bannister)
- https://jyx.jyu.fi/handle/123456789/19439 (Nagel et al., loudness 920-4400 Hz)
- https://brainscape.com/flashcards/david-huron-chill-evoking-mechanisms-in-16265370/packs/22116185 (secondary summary of Huron)

Performance / piano:
- https://iwk.mdw.ac.at/goebl/papers/Goebl_JASA2001_melodyLead.pdf (melody lead about 30 ms, a velocity artifact)
- https://continuum-hypothesis.com/music/Does_music_performance_allude_to_locomotion_A_mode.pdf (Friberg & Sundberg 1999 final ritardando)
- https://hub.yamaha.com/music-educators/instruments/piano/piano-pedagogy-pedaling, https://openbooks.library.baylor.edu/pianobasics/?p=434, https://www.researchcatalogue.net/view/3173139/3496795 (pedalling)
- https://paskpiano.org/pianists-hand-spans-australian-study/, https://paskpiano.org/pianists-hand-spans-vary-greatly/ (hand spans)
- https://www.sweetwater.com/insync/low-interval-limit/, https://www.robin-hoffmann.com/dfsb/low-interval-limits (low interval limits)
- https://hoffmanacademy.com/blog/e-flat-major-scale-on-piano (Eb fingering)
- https://github.com/sfzinstruments/SalamanderGrandPiano (16 velocity layers, CC-BY 3.0)
- https://pypi.org/project/pianoplayer/ (MIT auto-fingering) and https://musescore.org/en/node/370242 (its limits)
