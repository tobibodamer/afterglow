"""Executable sketch of the composition brief in research/music.md.

Purpose: prove the brief's form, tempo map, voicings and LH patterns are playable and land in
3:20-3:50, using the project's music/dsl.py. This is NOT the final piece; it is a skeleton the
composer can listen to and then rewrite. Run:
    .venv/Scripts/python.exe sandbox/music-research/sketch.py
Outputs (sandbox/music-research/): sketch.mid, sketch.json, leadsheet.txt, checks.txt
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "music"))
from dsl import Score, pitch, pname  # noqa: E402

OUT = os.path.dirname(os.path.abspath(__file__))
P = pitch

# ----------------------------------------------------------------------------------------------
# 1. Chord chart: bar -> list of (step, symbol, bass, shell[LH upper], pool[RH inner], move)
#    step is a 16th index 0..15. "move" = optional inner-voice passing note for the LH.
# ----------------------------------------------------------------------------------------------
def C(sym, bass, shell, pool, mv=None):
    return dict(sym=sym, bass=P(bass), shell=[P(x) for x in shell], pool=[P(x) for x in pool],
                mv=P(mv) if mv else None)

EB = {
    "I9":     C("Ebadd9", "Eb2", ["Bb2", "G3"], ["F4", "G4", "Bb4"], mv="F3"),
    "V6":     C("Bb/D", "D2", ["F3", "Bb3"], ["C4", "D4", "F4", "Bb4"], mv="C4"),
    "vi9":    C("Cm9", "C2", ["Eb3", "Bb3"], ["D4", "G4", "Bb4"], mv="D3"),
    "v9":     C("Bbm9", "Bb1", ["Db3", "Ab3"], ["C4", "F4", "Ab4"]),
    "I7b9":   C("Eb7b9", "Eb2", ["G3", "Db4"], ["Fb4", "Bb4", "Db5"]),
    "IV9":    C("Abmaj9", "Ab1", ["C3", "G3"], ["Bb4", "C5", "Eb5"], mv="Bb3"),
    "iv6":    C("Abm6", "Ab1", ["Cb3", "F3"], ["Eb4", "F4", "Ab4"]),
    "I6":     C("Eb/G", "G1", ["Eb3", "Bb3"], ["G4", "Bb4", "Eb5"]),
    "bIIIo7": C("Gbdim7", "Gb1", ["Eb3", "A3"], ["C4", "Eb4", "A4"]),
    "ii11":   C("Fm11", "F1", ["Eb3", "Ab3"], ["Bb3", "C4", "Eb4", "G4"]),
    "V7sus":  C("Bb9sus4", "Bb1", ["Eb3", "Ab3"], ["C4", "F4", "Ab4", "C5"]),
    "V13sus": C("Bb13sus4", "Bb1", ["Ab3", "Eb4"], ["G4", "C5"]),
    "V13":    C("Bb7(13)", "Bb1", ["Ab3", "D4"], ["G4", "C5"]),
    "iii7":   C("Gm7", "G1", ["F3", "Bb3"], ["D4", "F4", "G4", "Bb4"]),
    "vi9/5":  C("Cm9/Bb", "Bb1", ["Eb3", "G3"], ["D4", "G4", "C5"]),
    "V42":    C("Bb/Ab", "Ab1", ["D3", "F3", "Bb3"], ["D5", "F5", "Bb4"]),
    "V7/ii":  C("C7b9", "C2", ["E3", "Bb3"], ["Db4", "G4", "Db5"]),
    "ii9":    C("Fm9", "F1", ["Eb3", "Ab3"], ["G4", "C5", "Eb5"]),
    "IVadd9": C("Ab(add9)", "Ab1", ["Eb3", "C4"], ["Bb4", "Eb5"]),
    "#ivo7":  C("Adim7", "A1", ["Eb3", "Gb3"], ["C4", "Eb4", "A4"]),
}
CM = {
    "i9":     C("Cm9", "C2", ["Eb3", "Bb3"], ["D4", "G4"]),
    "VI#11":  C("Abmaj7#11", "Ab1", ["C3", "G3"], ["D4", "Eb4"]),
    "iv9":    C("Fm9", "F1", ["Eb3", "Ab3"], ["G4", "C5"]),
    "V7sus":  C("G7sus4", "G1", ["F3", "C4"], ["D4"]),
    "V7b9":   C("G7b9", "G1", ["F3", "B3"], ["Ab4", "D5"]),
    "i(9)":   C("Cm(add9)", "C2", ["Eb3", "C4"], ["D4", "G4"]),
    "i(M7)":  C("Cm(maj7)", "C2", ["Eb3", "B3"], ["D4", "G4"]),
    "i7":     C("Cm7", "C2", ["Eb3", "Bb3"], ["D4", "G4"]),
    "i6":     C("Cm6", "C2", ["Eb3", "A3"], ["D4", "G4"]),
    "VI9":    C("Abmaj9", "Ab1", ["C3", "G3"], ["Bb4", "Eb5"]),
    "iiø7":   C("Dm7b5", "D2", ["F3", "C4"], ["Ab4"]),
    # build over a C pedal (V of F)
    "bVI/C":  C("Abmaj7/C", "C2", ["C3"], ["Ab3", "C4", "Eb4", "G4"]),
    "bVII/C": C("Bb/C", "C2", ["C3"], ["Bb3", "D4", "F4"]),
    "V7sus/F": C("C7sus4", "C2", ["C3"], ["Bb3", "C4", "F4", "G4"]),
    "V7b9/F": C("C7b9", "C2", ["C3"], ["Bb3", "Db4", "E4", "G4"]),
}
F_ = {
    "IV9":    C("Bbmaj9", "Bb1", ["D3", "A3"], ["C5", "D5", "F5"]),
    "V13sus": C("C13sus4", "C2", ["Bb3", "F4"], ["A4", "D5"]),
    "V13":    C("C7(13)", "C2", ["Bb3", "E4"], ["A4", "D5"]),
    "iii7":   C("Am7", "A1", ["G3", "C4"], ["E4", "G4", "C5"]),
    "vi9":    C("Dm9", "D2", ["F3", "C4"], ["E4", "A4", "C5"]),
    "vi9/5":  C("Dm9/C", "C2", ["F3", "A3"], ["E4", "A4", "D5"]),
    "V42":    C("C/Bb", "Bb1", ["E3", "G3", "C4"], ["E5", "G5"]),
    "V7/ii":  C("D7b9", "D2", ["F#3", "C4"], ["Eb5", "F#5"]),
    "ii9":    C("Gm9", "G1", ["F3", "Bb3"], ["A4", "D5"]),
    "V7sus":  C("C7sus4", "C2", ["Bb3", "F4"], ["G4", "C5"]),
    "I9":     C("Fadd9", "F1", ["C3", "G3", "A3"], ["C5", "F5", "G5"]),
    "I/3":    C("Fmaj7/A", "A1", ["F3", "C4", "E4"], ["A4", "C5"]),
    "iv6":    C("Bbm6", "Bb1", ["Db3", "G3"], ["F4", "Bb4", "Db5"], mv="F3"),
}

def bars(table, seq):
    """seq: list of bar specs; each spec is 'key' or ('key', 'key') for half-bar changes."""
    out = []
    for spec in seq:
        if isinstance(spec, tuple):
            out.append([(0, table[spec[0]]), (8, table[spec[1]])])
        else:
            out.append([(0, table[spec])])
    return out

CHORUS = ["IV9", ("V13sus", "V13"), "iii7", ("vi9", "vi9/5"), "IV9", "V42", ("iii7", "V7/ii"), ("ii9", "V7sus")]
FORM = [  # (name, first bar, chord bars, LH pattern, swing, rubato, lh_vel, mel_vel, inner_vel, inner_steps)
    ("intro",   1, bars(EB, ["IV9", ("V13sus", "V13"), "iii7", ("vi9", "V7sus")]), "P7", 0.50, 0.9, 34, 52, 30, ()),
    ("verse1",  5, bars(EB, ["I9", "V6", "vi9", ("v9", "I7b9"), "IV9", "iv6", ("I6", "bIIIo7"), ("ii11", "V7sus")]), "P1", 0.51, 0.5, 40, 60, 36, (0, 8)),
    ("pre1",   13, bars(EB, ["ii9", "iii7", ("IVadd9", "#ivo7"), ("V13sus", "V13")]), "P1", 0.53, 0.3, 46, 66, 42, (0, 8)),
    ("chorus1", 17, bars(EB, CHORUS), "P2", 0.56, 0.1, 54, 76, 46, (2, 10)),
    ("verse2", 25, bars(EB, ["I9", "V6", "vi9", ("v9", "I7b9")]), "P3", 0.57, 0.1, 50, 66, 42, (4, 12)),
    ("pre2",   29, bars(EB, ["ii9", "iii7", ("IVadd9", "#ivo7"), ("V13sus", "V13")]), "P2", 0.57, 0.1, 56, 72, 48, (0, 8)),
    ("chorus2", 33, bars(EB, CHORUS), "P2", 0.58, 0.1, 60, 84, 52, (2, 6, 10)),
    ("bridge", 41, bars(CM, ["i9", "VI#11", "iv9", ("V7sus", "V7b9"), ("i(9)", "i(M7)"), ("i7", "i6"), ("VI9", "iv9"), ("iiø7", "V7b9")]), "P5", 0.50, 0.6, 46, 62, 36, (0,)),
    ("build",  49, bars(CM, ["bVI/C", "bVII/C", "V7sus/F", "V7b9/F"]), "P6", 0.50, 0.0, 60, 80, 64, (0, 6, 12)),
    ("climax", 53, bars(F_, CHORUS), "P4", 0.56, 0.05, 82, 100, 70, (0, 8)),
    ("tag",    61, bars(F_, ["I9", "I/3"]), "P7", 0.50, 0.4, 70, 92, 60, (0,)),
    ("finalA", 63, bars(F_, ["IV9", ("V13sus", "V13"), "iii7", "vi9"]), "P7", 0.50, 0.9, 28, 46, 24, ()),
    ("coda",   67, bars(F_, ["IV9", "iv6", "I9"]), "P7", 0.50, 0.9, 26, 42, 22, (0,)),
]

# ----------------------------------------------------------------------------------------------
# 2. Melody (RH, voice "mel"); DSL tokens, durations in beats (0.25 = 16th)
# ----------------------------------------------------------------------------------------------
HOOK = ("G5:1.5 F5:0.25 Eb5:0.25 F5:1 Eb5:0.5 Bb4:0.5 | C5:0.5 Eb5:1.5 D5:1.5 r:0.5 | "
        "r:0.5 Bb4:0.25 Bb4:0.25 C5:0.5 D5:0.5 F5:1.5 Eb5:0.5~ | Eb5:1 D5:1 C5:1.5 Bb4:0.5 | "
        "G5:1.5 F5:0.25 Eb5:0.25 F5:0.5 G5:0.5 Bb5:1~ | Bb5:0.5 C6:1.5 Bb5:0.5 G5:0.5 F5:1 | "
        "D5:0.5 F5:1 Eb5:0.5 E5:1 G5:0.5 F5:0.5~ | F5:1 Eb5:0.5 C5:0.5 Bb4:0.5 C5:0.5 Eb5:1~")
HOOK_CLIMAX = HOOK.replace("Bb5:0.5 C6:1.5 Bb5:0.5 G5:0.5 F5:1", "Bb5:0.5 C6:0.5 Eb6:1.5 C6:0.5 Bb5:0.5 G5:0.5")
MEL = [
    (1, "r:0.5 Bb4:0.5 G5:1.5 F5:0.25 Eb5:0.25 F5:1 | r:0.5 Eb5:1.5 D5:2 | Bb4:1 C5:0.5 D5:0.5 F5:2 | Eb5:1 D5:1 C5:2", 0),
    (5, "r:0.5 G4:0.25 Bb4:0.25 Bb4:0.5 G4:0.5 F4:0.5 G4:1.5 | r:0.5 F4:0.25 G4:0.25 Bb4:1 C5:0.5 Bb4:1.5 | "
        "r:0.5 G4:0.25 Bb4:0.25 Bb4:0.5 G4:0.5 Bb4:0.5 D5:1.5 | Db5:1 C5:0.5 Ab4:0.5 G4:1 r:1 | "
        "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.5 C5:0.5 Bb4:0.5 C5:1.5 | r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.5 Cb5:1.5 Bb4:1 | "
        "Bb4:1 G4:0.5 Bb4:0.5 A4:1 C5:1 | Eb5:0.5 C5:0.5 Ab4:1 Bb4:2", 0),
    (13, "r:0.5 C5:0.25 C5:0.25 C5:0.5 Bb4:0.5 C5:0.5 Eb5:1.5 | r:0.5 D5:0.25 D5:0.25 D5:0.5 C5:0.5 D5:0.5 F5:1.5 | "
         "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.5 F5:0.5 Eb5:1 Gb5:1 | F5:1 Eb5:1 D5:1 r:0.5 Bb4:0.5", 0),
    (17, HOOK, 0),
    (25, "Eb5:0.5 G4:0.25 Bb4:0.25 Bb4:0.5 G4:0.5 F4:0.5 G4:1.5 | r:0.5 F4:0.25 G4:0.25 Bb4:1 C5:0.5 Bb4:1.5 | "
         "r:0.5 G4:0.25 Bb4:0.25 Bb4:0.5 G4:0.5 Bb4:0.5 D5:1.5 | Db5:1 C5:0.5 Ab4:0.5 G4:1 Bb4:0.5 C5:0.5", 0),
    (29, "r:0.5 C5:0.25 C5:0.25 C5:0.5 Bb4:0.5 C5:0.5 Eb5:1.5 | r:0.5 D5:0.25 D5:0.25 D5:0.5 C5:0.5 D5:0.5 F5:1.5 | "
         "r:0.5 Eb5:0.25 Eb5:0.25 Eb5:0.5 F5:0.5 Eb5:1 Gb5:1 | F5:1 Eb5:1 D5:1 r:0.5 Bb4:0.5", 0),
    (33, HOOK, 0),
    (41, "G4:2 Bb4:1 C5:1 | D5:3 C5:0.5 Bb4:0.5 | C5:2 Ab4:1 G4:1 | C5:1 B4:1 Ab4:1 G4:1 | "
         "Eb5:2 D5:1 C5:1 | Eb5:1.5 F5:0.5 G5:2 | Ab5:2 G5:1 F5:1 | F5:1 Eb5:1 D5:1 B4:1", 0),
    (49, "Eb5:1.5 Eb5:1.5 G5:1 | F5:1.5 F5:1.5 Bb5:1 | G5:1.5 G5:1.5 C6:1 | r:2 Bb5:1 r:0.5 C5:0.5", 0),
    (53, HOOK_CLIMAX, 2),
    (61, "A5:1.5 G5:0.25 F5:0.25 G5:2 | E5:2 r:1.5 C5:0.5", 0),
    (63, "A5:1.5 G5:0.25 F5:0.25 G5:1 F5:0.5 C5:0.5 | D5:0.5 F5:1.5 E5:2 | "
         "r:0.5 C5:0.25 C5:0.25 D5:0.5 E5:0.5 G5:1.5 F5:0.5~ | F5:1 E5:1 D5:2", 0),
    (67, "r:0.5 C5:0.5 A5:1.5 G5:0.25 F5:0.25 G5:1 | F5:2 Db5:2 | C5:4", 0),
]
OCTAVE_MEL_BARS = set(range(37, 39)) | set(range(53, 61))   # melody doubled an octave below

# ----------------------------------------------------------------------------------------------
# 3. LH patterns: (step, role, dur_steps, vel_offset). 8-step variants for half-bar chords.
# ----------------------------------------------------------------------------------------------
PAT = {
    "P1": {16: [(0, "R", 3, 0), (3, "S0", 5, -8), (6, "S1", 4, -6), (10, "MV", 2, -12), (12, "S1", 4, -10)],
           8:  [(0, "R", 2, 0), (2, "S0", 3, -8), (5, "S1", 3, -8)]},
    "P2": {16: [(0, "R", 3, 0), (4, "S", 2, -6), (7, "R8", 1, -20), (10, "R", 2, -4), (12, "S", 2, -6), (14, "APP", 2, -16)],
           8:  [(0, "R", 3, 0), (4, "S", 2, -6), (6, "APP", 2, -16)]},
    "P3": {16: [(0, "R", 5, 0), (6, "S", 2, -6), (8, "R8", 2, -10), (11, "R8", 1, -22), (12, "S1", 2, -10), (14, "APP", 2, -12)],
           8:  [(0, "R", 4, 0), (4, "S", 2, -6), (6, "APP", 2, -12)]},
    "P4": {16: [(0, "OCT", 6, 0), (6, "OCT", 6, 4), (12, "S0", 2, -10), (14, "APP8", 2, -4)],
           8:  [(0, "OCT", 4, 0), (4, "S0", 2, -10), (6, "APP8", 2, -6)]},
    "P5": {16: [(0, "R", 3, 0), (4, "S0", 4, -12), (8, "S", 6, -4), (14, "MV", 2, -14)],
           8:  [(0, "R", 3, 0), (4, "S", 4, -6)]},
    "P6": {16: [(k, "OCT", 2, (6 if k in (0, 6, 12) else -6)) for k in range(0, 16, 2)],
           8:  [(k, "OCT", 2, (6 if k in (0, 6) else -6)) for k in range(0, 8, 2)]},
    "P7": {16: [(0, "R", 2, 0), (2, "S", 14, -8), (8, "MV", 8, -12)],
           8:  [(0, "R", 2, 0), (2, "S", 6, -8)]},
}


def build():
    s = Score("Afterglow sketch", bpm=76, seed=7)
    # tempo map (bar, beat, bpm)
    for bar, beat, bpm in [(1, 1, 68), (4, 3, 60), (5, 1, 76), (13, 1, 76), (16, 3, 78), (17, 1, 78), (40, 4, 78),
                           (41, 1, 74), (48, 4, 72), (49, 1, 74), (52, 1, 80), (53, 1, 80), (60, 4, 80), (61, 1, 77),
                           (62, 4, 68), (63, 1, 66), (66, 4, 64), (67, 1, 64), (69, 1, 50)]:
        s.tempo(bar, beat, bpm)
    s.fermata(4, 3, 1.2)
    s.fermata(16, 4, 0.15)
    s.fermata(52, 4, 0.5)
    s.fermata(62, 3, 0.6)
    s.fermata(68, 4, 0.4)

    chord_at = {}   # abs beat -> chord (for inner voices)
    for name, b0, cbars, pat, swing, rub, lh_v, mel_v, in_v, in_steps in FORM:
        s.section(name, b0, b0 + len(cbars) - 1, swing=swing, rubato=rub)
        for i, segs in enumerate(cbars):
            bar = b0 + i
            for j, (st, ch) in enumerate(segs):
                chord_at[s.pos(bar, 1 + st / 4)] = ch
                s.pedal(bar, 1 + st / 4, "change")
        s.phrase(b0, b0 + len(cbars) - 1, peak=0.62)

    # flatten chord timeline to find "next bass"
    timeline = sorted(chord_at.items())
    def next_bass(beat):
        for b, ch in timeline:
            if b > beat + 1e-6:
                return ch["bass"]
        return None

    for name, b0, cbars, pat, swing, rub, lh_v, mel_v, in_v, in_steps in FORM:
        for i, segs in enumerate(cbars):
            bar = b0 + i
            for j, (st, ch) in enumerate(segs):
                seg_len = 16 if len(segs) == 1 else 8
                events = PAT[pat][seg_len]
                seg_beat = s.pos(bar, 1 + st / 4)
                nb = next_bass(seg_beat) or ch["bass"]
                for step, role, dur, dv in events:
                    v = lh_v + dv
                    at_beat = 1 + (st + step) / 4
                    d = dur / 4
                    if role == "R":
                        ps = [ch["bass"]]
                    elif role == "R8":
                        ps = [ch["bass"] + 12]
                    elif role == "OCT":
                        ps = [ch["bass"], ch["bass"] + 12]
                    elif role == "S":
                        ps = ch["shell"]
                    elif role == "S0":
                        ps = ch["shell"][:1]
                    elif role == "S1":
                        ps = ch["shell"][-1:]
                    elif role == "MV":
                        if not ch["mv"]:
                            continue
                        ps = [ch["mv"]]
                    elif role in ("APP", "APP8"):
                        if nb == ch["bass"]:
                            ps = [ch["bass"] + 7 if ch["bass"] + 7 < 48 else ch["bass"]]
                        else:
                            ps = [nb - 1] if nb > ch["bass"] else [nb + 1]
                        if role == "APP8":
                            ps = [ps[0], ps[0] + 12]
                    else:
                        raise ValueError(role)
                    s.note("L", bar, at_beat, ps, d, max(10, v), voice="bass" if role in ("R", "R8", "OCT", "APP", "APP8") else "acc")
        # build bar 52: big C7b9 hit then RH sweep handled below

    # melody
    for bar, text, tr in MEL:
        sec = next(f for f in FORM if f[1] <= bar <= f[1] + len(f[2]) - 1)
        s.line("R", bar, text, voice="mel", vel=sec[7], transpose=tr)
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.beat)
    # octave doubling
    for n in list(mel):
        bar = s._bar_of(n.beat)
        if bar in OCTAVE_MEL_BARS:
            s.notes.append(type(n)(n.pitch - 12, n.beat, n.dur, max(10, n.vel - 14), "R", "inner"))

    def mel_at(beat):
        cur = None
        for n in mel:
            if n.beat <= beat + 1e-6 and n.beat + n.dur > beat + 1e-6:
                cur = n
        if cur is None:   # next melody note
            nxt = [n for n in mel if n.beat > beat]
            cur = nxt[0] if nxt else None
        return cur

    # RH inner voices from the chord pool, below the melody, within the RH span
    for name, b0, cbars, pat, swing, rub, lh_v, mel_v, in_v, in_steps in FORM:
        for i, segs in enumerate(cbars):
            bar = b0 + i
            for st_inner in in_steps:
                beat = s.pos(bar, 1 + st_inner / 4)
                ch = None
                for b, c in timeline:
                    if b <= beat + 1e-6:
                        ch = c
                if ch is None:
                    continue
                m = mel_at(beat)
                if m is None:
                    continue
                top = m.pitch
                low_lim = top - 12 if bar not in OCTAVE_MEL_BARS else top - 11
                cand = [p for p in ch["pool"] if low_lim <= p <= top - 3 and not (bar in OCTAVE_MEL_BARS and p == top - 12)]
                cand = sorted(cand)[-2:] if name in ("chorus2", "climax", "build") else sorted(cand)[-1:]
                lh_top = max(ch["shell"] + [ch["bass"] + 12])
                cand = [p for p in cand if p > lh_top]
                if cand:
                    s.note("R", bar, 1 + st_inner / 4, cand, 0.5 if name not in ("bridge", "tag", "coda") else 1.5,
                           in_v, voice="inner")
    # build last bar: RH sweep C7b9 16ths, beats 1-3 (melody note Bb5 starts beat 1, so sweep ends below it)
    sweep = ["C4", "E4", "G4", "Bb4", "Db5", "E5", "G5"]
    for k, nm in enumerate(sweep):
        s.note("R", 52, 1.25 + k * 0.25, nm, 0.25, 70 + 4 * k, voice="inner")
    s.pedal(52, 4, "up")
    s.pedal(53, 1, "down")
    s.pedal(16, 4, "up")
    s.pedal(17, 1, "down")
    s.pedal(70, 2, "up")
    s.perform(lead_in=0.0)
    return s


LIL = {1: 52, 2: 51, 3: 48, 4: 46, 5: 46, 6: 47, 7: 34, 8: 41, 9: 41, 10: 41, 11: 41, 13: 40, 14: 39, 15: 31, 16: 29}


def extra_checks(s):
    issues = []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    # (a) mud: adjacent intervals among notes sounding together (struck within 60 ms or still held by fingers)
    for n in ns:
        if n.pitch >= 60:
            continue
        sounding = [m for m in ns if abs(m.t_on - n.t_on) < 0.06 or (m.t_on < n.t_on < m.t_off - 0.02)]
        ps = sorted(set(m.pitch for m in sounding))
        for a, b in zip(ps, ps[1:]):
            iv = b - a
            if iv in LIL and a < LIL[iv]:
                issues.append(f"MUD t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: {pname(a)}-{pname(b)} ({iv} st) below limit {pname(LIL[iv])}")
    # (b) per-hand span of keys physically held (struck within 30 ms or still held, ignoring pedal)
    for hand, lim in (("R", 14), ("L", 16)):
        hs = [n for n in ns if n.hand == hand]
        for n in hs:
            held = [m for m in hs if abs(m.t_on - n.t_on) < 0.03 or (m.t_on < n.t_on < m.t_off - 0.03)]
            ps = [m.pitch for m in held]
            if max(ps) - min(ps) > lim:
                issues.append(f"SPAN {hand} t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: {pname(min(ps))}..{pname(max(ps))} = {max(ps) - min(ps)} st")
            if len(set(ps)) > 5:
                issues.append(f"FINGERS {hand} t={n.t_on:6.2f}: {len(set(ps))} keys held")
    # (c) leap feasibility: hand centroid jump vs time between onset groups
    for hand in ("L", "R"):
        groups = {}
        for n in ns:
            if n.hand == hand:
                groups.setdefault(round(n.t_on, 2), []).append(n.pitch)
        ts = sorted(groups)
        for t0, t1 in zip(ts, ts[1:]):
            a, b = groups[t0], groups[t1]
            jump = abs((min(b) + max(b)) / 2 - (min(a) + max(a)) / 2)
            dt = t1 - t0
            if (jump > 24 and dt < 0.30) or (jump > 12 and dt < 0.14):
                issues.append(f"LEAP {hand} t={t0:6.2f}->{t1:6.2f}: {jump:.0f} st in {dt * 1000:.0f} ms")
    # (d) hands crossing at the same time
    for n in ns:
        if n.hand != "L":
            continue
        rh = [m.pitch for m in ns if m.hand == "R" and (abs(m.t_on - n.t_on) < 0.03 or m.t_on < n.t_on < m.t_off - 0.03)]
        if rh and n.pitch >= min(rh):
            issues.append(f"CROSS t={n.t_on:6.2f} LH {pname(n.pitch)} >= RH {pname(min(rh))}")
    # (e) melody prominence at shared onsets
    weak = 0
    for n in ns:
        if n.voice != "mel":
            continue
        others = [m.vel for m in ns if m is not n and m.voice != "mel" and abs(m.t_on - n.t_on) < 0.04]
        if others and n.vel - max(others) < 6:
            weak += 1
    return issues, weak


def melody_stats(s):
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.t_on)
    out = {}
    for name, b0, cbars, *_ in FORM:
        b1 = b0 + len(cbars)
        m = [n for n in mel if s.bar_start(b0) <= n.beat < s.bar_start(b1)]
        if not m:
            continue
        iv = [b.pitch - a.pitch for a, b in zip(m, m[1:])]
        out[name] = dict(range=f"{pname(min(n.pitch for n in m))}-{pname(max(n.pitch for n in m))}",
                         span_st=max(n.pitch for n in m) - min(n.pitch for n in m),
                         notes=len(m), repeated=sum(1 for x in iv if x == 0),
                         steps=sum(1 for x in iv if 1 <= abs(x) <= 2), leaps_ge4=sum(1 for x in iv if abs(x) >= 5),
                         vel=f"{min(n.vel for n in m)}-{max(n.vel for n in m)}")
    return out


def rfiy_overlap(s):
    """River Flows in You's opening cell, as commonly transcribed: A G# A G# A E A D (A major).
    Intervals -1 +1 -1 +1 -5 +5 -7. Report any 4-interval window of ours equal to a window of it."""
    ref = [-1, 1, -1, 1, -5, 5, -7]
    refw = {tuple(ref[i:i + 4]) for i in range(len(ref) - 3)}
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.t_on)
    iv = [b.pitch - a.pitch for a, b in zip(mel, mel[1:])]
    hits = [i for i in range(len(iv) - 3) if tuple(iv[i:i + 4]) in refw]
    neighbor_osc = sum(1 for i in range(len(iv) - 2) if iv[i] == -iv[i + 1] == iv[i + 2] and abs(iv[i]) == 1)
    return hits, neighbor_osc


if __name__ == "__main__":
    s = build()
    issues = s.check()
    extra, weak = extra_checks(s)
    stats = melody_stats(s)
    hits, osc = rfiy_overlap(s)
    tl = s.timeline
    lines = ["SECTIONS (t_start - t_end, seconds)"]
    for sec in tl["sections"]:
        lines.append(f"  {sec['name']:8s} bars {sec['bar_start']:2d}-{sec['bar_end']:2d}  {sec['t_start']:7.2f} - {sec['t_end']:7.2f}"
                     f"  ({sec['t_end'] - sec['t_start']:5.1f}s)")
    dur = max(n.t_off for n in s.notes)
    lines.append(f"last note-off {dur:.2f}s = {int(dur // 60)}:{dur % 60:04.1f}; notes={len(s.notes)}")
    lines.append(f"\nDSL check(): {len(issues)} issues")
    lines += ["  " + x for x in issues[:40]]
    lines.append(f"\nextra checks: {len(extra)} issues")
    lines += ["  " + x for x in extra[:80]]
    lines.append(f"melody onsets not >= 6 vel above simultaneous accompaniment: {weak}")
    lines.append("\nMELODY STATS per section")
    for k, v in stats.items():
        lines.append(f"  {k:8s} {v}")
    lines.append(f"\nRFIY 4-interval window matches: {len(hits)}; strict +-1 neighbour oscillations (3 in a row): {osc}")
    txt = "\n".join(lines)
    print(txt)
    open(os.path.join(OUT, "checks.txt"), "w").write(txt)
    s.leadsheet(os.path.join(OUT, "leadsheet.txt"))
    s.to_midi(os.path.join(OUT, "sketch.mid"))
    s.to_json(os.path.join(OUT, "sketch.json"))
