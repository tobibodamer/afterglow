"""Afterglow - solo piano. Melody-first candidate (pop hook, R&B phrasing, a little hip-hop pocket).

Run:  E:/experimentswithclaude/random/afterglow/.venv/Scripts/python.exe music/candidates/melody/score.py
Writes (next to this file): score.json, score.mid, leadsheet.txt, checks.txt, report.txt, roll_*.png
Form (69 bars): Intro 4 | Verse 8 | Pre 4 | Chorus 8 | Verse 4 | Pre 4 | Chorus 8 | Bridge 8 (C minor) |
                Build 4 (C pedal) | Climax 8 (F major) | Tag 2 | Final A 4 | Coda 3
Sources of truth: melodies.py (the tune), arr.py (both hands' accompaniment, every bar written out),
chords.py (harmony symbols -> pedal changes, leadsheet, checks).
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib import (Score, ROOT, P, pname, ev, octave_double, shape_melody, assign_fingers, mark_presets,  # noqa: E402
                 preset_bass_fingers)
from chords import EB, CM, FM  # noqa: E402
import melodies as M  # noqa: E402
import arr  # noqa: E402
import checks  # noqa: E402

OUT = HERE
SEED = 20261021

# per-voice micro-timing (ms): groove sections lay the melody back over a bass on the grid
GROOVE = {"mel": 14, "inner": 9, "acc": 7, "counter": 6, "bass": 0, "ghost": 3}
CLIMAX = {"mel": 10, "inner": 8, "acc": 6, "counter": 6, "bass": 0, "ghost": 2}
BUILD = {"mel": -8, "inner": -4, "acc": 0, "counter": 0, "bass": 0, "ghost": 0}


def H(t, seq):
    return [[(0, t[x])] if isinstance(x, str) else [(0, t[x[0]]), (8, t[x[1]])] for x in seq]


CHORUS = ["IV9", ("V13sus", "V13"), "iii7", ("vi9", "vi9/5"), "IV9", "V42", ("iii7", "V7/ii"), ("ii9", "V7sus")]
CHORUS2 = CHORUS[:7] + [("ii9", "V13")]          # ends on V7 -> deceptive to vi (bridge)


def V(mel, inner, acc, bass, ghost=24, counter=None):
    return dict(mel=mel, inner=inner, acc=acc, bass=bass, ghost=ghost, counter=counter or acc + 4)


# name, first bar, harmony, swing, rubato, offsets, groove?, velocities, melody, melody range
SECTIONS = [
    ("intro", 1, H(EB, ["IV9", "IV9", ("V13sus", "V13"), ("iii7", "V7sus")]), 0.50, 0.9, None, False,
     V(50, 26, 27, 34), M.INTRO, ("Bb4", "Ab5")),
    ("verse1", 5, H(EB, ["I9", "V6", "vi9", ("v9", "I7b9"), "IV9", "iv6", ("I6", "bIIIo7"), ("ii11", "V7sus")]),
     0.51, 0.5, None, False, V(58, 32, 34, 42), M.VERSE1, ("F4", "Eb5")),
    ("pre1", 13, H(EB, ["ii9", "iii7", ("IVadd9", "#ivo7"), ("V13sus", "V13")]), 0.53, 0.3, None, False,
     V(61, 37, 40, 47), M.PRE1, ("Bb4", "Gb5")),
    ("chorus1", 17, H(EB, CHORUS), 0.56, 0.05, GROOVE, True, V(76, 45, 48, 57, 27), M.CHORUS1, ("Bb4", "C6")),
    ("verse2", 25, H(EB, ["I9", "V6", "vi9", ("v9", "I7b9")]), 0.57, 0.05, GROOVE, True,
     V(65, 40, 44, 51, 26), M.VERSE2, ("F4", "F5")),
    ("pre2", 29, H(EB, ["ii9", "iii7", ("IVadd9", "#ivo7"), ("V13sus", "V13")]), 0.57, 0.05, GROOVE, True,
     V(67, 43, 48, 56, 28), M.PRE2, ("Bb4", "G5")),
    ("chorus2", 33, H(EB, CHORUS2), 0.58, 0.05, GROOVE, True, V(84, 52, 54, 63, 30, 58), M.CHORUS2, ("Bb4", "C6")),
    ("bridge", 41, H(CM, ["i9", "VI#11", "iv9", ("V7sus", "V7b9"), ("i(9)", "i(M7)"), ("i7", "i6"), ("VI9", "iv9b"),
                        ("iio7", "V7b9")]), 0.50, 0.6, None, False, V(59, 34, 38, 45), M.BRIDGE, ("G4", "Ab5")),
    ("build", 49, H(CM, ["bVI/C", "bVII/C", "V7sus/F", "V7b9/F"]), 0.50, 0.0, BUILD, False,
     V(72, 54, 54, 56), M.BUILD, ("C5", "Db6")),
    ("climax", 53, H(FM, CHORUS[:6] + [("iii7", "V7/ii"), ("ii9", "V7sus")]), 0.56, 0.03, CLIMAX, True,
     V(95, 70, 72, 82, 30, 74), M.CLIMAX, ("C5", "F6")),
    ("tag", 61, H(FM, ["I9", "I/3"]), 0.50, 0.4, None, False, V(96, 64, 62, 72), M.TAG, ("C5", "A5")),
    ("finalA", 63, H(FM, ["IV9", ("V13sus", "V13"), "iii7", "vi9"]), 0.50, 0.9, None, False,
     V(48, 24, 25, 30, 20), M.FINAL_A, ("C5", "Bb5")),
    ("coda", 67, H(FM, ["IV9", "iv6", "I9"]), 0.50, 0.9, None, False, V(52, 25, 25, 30, 20), M.CODA, ("C5", "Bb5")),
]
SEC = {x[0]: x for x in SECTIONS}

PHRASES = [(1, 4, .55), (5, 8, .62), (9, 12, .62), (13, 16, .75), (17, 20, .55), (21, 24, .5), (25, 28, .62),
           (29, 32, .75), (33, 36, .55), (37, 40, .5), (41, 44, .6), (45, 48, .55), (49, 52, .95), (53, 56, .55),
           (57, 60, .35), (61, 62, .1), (63, 66, .55), (67, 69, .3)]
TEMPO = [(1, 1, 68), (4, 3, 60), (5, 1, 76), (13, 1, 76), (16, 3, 78), (17, 1, 78), (40, 4, 78), (41, 1, 74),
         (48, 4, 72), (49, 1, 74), (52, 1, 80), (53, 1, 80), (60, 4, 80), (61, 1, 77), (62, 4, 68), (63, 1, 66),
         (66, 4, 64), (67, 1, 64), (68, 4.99, 64), (69, 1, 38.4)]
FERMATAS = [(4, 3.5, 1.2), (16, 4, 0.2), (52, 4, 0.5), (62, 3, 0.6)]
DYN = [(1, 1, 1.0), (13, 1, 1.0), (16, 3, 1.06), (17, 1, 1.0), (29, 1, 1.0), (32, 4, 1.04), (33, 1, 1.0),
       (41, 1, 1.0), (45, 1, 0.98), (47, 2, 1.07), (48, 4, 0.98), (49, 1, 1.0), (61, 1, 1.0), (62, 4, 0.78),
       (63, 1, 1.0)]
# the pedal follows the bass inside a harmony: (bar, 16th step, kind). "change" re-catches an approach / walk note
# so it never rings against the bar's root; "up" leaves a 16th double-approach dry (key-held ghosts).
PEDAL_FOLLOW = [(17, 14, "change"), (18, 14, "change"), (19, 14, "change"), (20, 14, "change"), (21, 14, "change"),
                (23, 6, "change"), (23, 14, "change"), (24, 12, "change"), (24, 14, "change"),
                (25, 14, "up"), (26, 14, "change"), (27, 14, "change"), (28, 14, "up"),
                (29, 14, "change"), (30, 14, "change"), (32, 14, "change"),
                (33, 14, "change"), (35, 14, "change"), (39, 6, "change"), (39, 14, "change"), (40, 6, "change"),
                (53, 14, "change"), (54, 14, "change"), (55, 14, "change"), (56, 14, "change"), (57, 14, "change"),
                (59, 6, "change"), (59, 14, "change"), (60, 11, "change"), (60, 14, "change")]
DROPS = [(16, 3.5, 17), (52, 3.5, 53)]        # pedal fully up at (bar, beat); re-pressed on the next downbeat
OCTAVE_BARS = set(range(37, 39)) | set(range(53, 61))
MEL_RAMP = {"build": 20, "coda": -14, "finalA": -6, "tag": -10}   # melody velocity drift per section
BUILD_RAMP = {49: 0, 50: 10, 51: 20, 52: 32}  # build crescendo (velocity units added to bass / acc / inner)


def _speed_up(s, n_bars=72):
    """The DSL recomputes bar starts by summation on every call (O(bars^2) per note); every bar here is 4/4,
    so cache them on this instance (no change to music/dsl.py)."""
    import bisect
    starts = [0.0]
    for b in range(1, n_bars + 2):
        starts.append(starts[-1] + s.beats_in(b))        # starts[b] = start of bar b+1
    s.bar_start = lambda bar: starts[bar - 1] if 1 <= bar <= n_bars + 1 else sum(s.beats_in(b) for b in range(1, bar))
    s._bar_of = lambda beat: max(1, bisect.bisect_right(starts, beat + 1e-9))


def build():
    s = Score("Afterglow", bpm=76, seed=SEED)
    _speed_up(s)
    for b, bt, bpm in TEMPO:
        s.tempo(b, bt, bpm)
    s.final_rit(67, 68, w=0.6, q=2.5)
    for b, bt, x in FERMATAS:
        s.fermata(b, bt, x)
    for b, bt, g in DYN:
        s.dyn(b, bt, g)
    for b0, b1, pk in PHRASES:
        s.phrase(b0, b1, peak=pk)

    # harmony timeline -> sections + legato pedal at every change (a plain press after each drop)
    timeline = []
    drop_down = {d[2] for d in DROPS}
    for name, b0, harm, sw, rub, offs, grv, vel, mel, rng in SECTIONS:
        s.section(name, b0, b0 + len(harm) - 1, swing=sw, rubato=rub, offsets_ms=offs)
        for i, segs in enumerate(harm):
            for st, ch in segs:
                timeline.append((s.pos(b0 + i, 1 + st / 4), ch, name, b0 + i, st))
                s.pedal(b0 + i, 1 + st / 4, "down" if (st == 0 and b0 + i in drop_down) else "change")
    for b, st, kind in PEDAL_FOLLOW:
        s.pedal(b, 1 + st / 4, kind)
    for b, bt, nxt in DROPS:
        s.pedal(b, bt, "up")
    s.pedal(70, 1, "up")
    timeline.sort(key=lambda x: x[0])

    # the tune
    for name, b0, harm, sw, rub, offs, grv, vel, mel, rng in SECTIONS:
        s.line("R", b0, " | ".join(mel), voice="mel", vel=vel["mel"])
        shape_melody(s, b0, b0 + len(harm) - 1, vel["mel"], ramp=MEL_RAMP.get(name, 0))
    octave_double(s, OCTAVE_BARS, vel_drop=16)

    # both hands' accompaniment, written out bar by bar
    for name, b0, harm, sw, rub, offs, grv, vel, mel, rng in SECTIONS:
        for bar in range(b0, b0 + len(harm)):
            v = dict(vel)
            if name == "build":
                k = BUILD_RAMP[bar]
                v.update(bass=vel["bass"] + k, acc=vel["acc"] + k, inner=vel["inner"] + k)
            if bar in arr.LH:
                ev(s, "L", bar, arr.LH[bar], v)
            if bar in arr.RH:
                ev(s, "R", bar, arr.RH[bar], v)

    release_for_leaps(s, "L")
    release_for_leaps(s, "R", near=12, far=12, gap_near=0.125, gap_far=0.125, keep_voices=("mel",))

    s._timeline_chords = timeline
    preset_bass_fingers(s)
    mark_presets(s)
    s.perform(lead_in=0.0)
    total = max(n.beat + n.dur for n in s.notes) + 8
    tb, ts = s._beat_to_sec_table(total)
    s._b2s = lambda b: float(np.interp(b, tb, ts))
    assign_fingers(s)
    fix_key_repeats(s)
    last = max((n for n in s.notes if n.voice == "mel"), key=lambda n: n.t_on)
    last.vel = 44                     # the home note C5: soft, but clearly the voice on top of the last chord
    adj = voicing_pass(s)
    final_pedal_ramp(s)
    return s, adj


def release_for_leaps(s, hand, near=7, far=12, gap_near=0.125, gap_far=0.25, keep_voices=(), min_hold_s=0.30,
                      span_lim=None):
    """Shorten key-holds so the hand is free before it must jump: a key still held when the same hand strikes a
    note more than `near` (`far`) semitones away is released gap_near (gap_far) beats before that onset.
    A bass key is never released before the legato pedal has re-caught (min_hold_s), so it is never cut dry.
    The sound is carried by the pedal; this is the true key/finger release for the animation."""
    import bisect
    if span_lim is None:
        span_lim = 14 if hand == "R" else 14
    ns = sorted([n for n in s.notes if n.hand == hand], key=lambda n: n.beat)
    onsets = sorted(set(round(n.beat, 4) for n in ns))
    at = {}
    for n in ns:
        at.setdefault(round(n.beat, 4), []).append(n)
    for n in ns:
        if n.voice in keep_voices:
            continue
        end = n.beat + n.dur
        i = bisect.bisect_right(onsets, round(n.beat, 4) + 1e-6)
        while i < len(onsets) and onsets[i] < end - 1e-6:
            grp = at[onsets[i]]
            jump = max(abs(m.pitch - n.pitch) for m in grp)
            held = [m for m in ns if m.beat < onsets[i] - 1e-6 < m.beat + m.dur and m is not n] + grp + [n]
            span = max(m.pitch for m in held) - min(m.pitch for m in held)
            if jump > near and (span > span_lim or n.voice == "bass" or len(set(m.pitch for m in held)) > 5):
                g = gap_far if jump > far else gap_near
                floor = 0.125
                if n.voice == "bass":
                    floor = min(n.dur, min_hold_s * s._bpm(n.beat) / 60.0)
                new = max(floor, onsets[i] - n.beat - g)
                if new < n.dur:
                    n.dur = new
                break
            i += 1


def fix_key_repeats(s, gap=0.035):
    """A key must rise before it can be struck again (by either hand). perform() shifts melody onsets (lead / lay-back)
    but computes key releases from the grid, so repeated notes can overlap by a few ms: release such keys `gap`
    seconds before the next strike of the same key."""
    byp = {}
    for n in s.notes:
        byp.setdefault(n.pitch, []).append(n)
    for lst in byp.values():
        lst.sort(key=lambda n: n.t_on)
        for x, y in zip(lst, lst[1:]):
            if x.t_off > y.t_on - gap:
                x.t_off = max(x.t_on + 0.03, y.t_on - gap)


def voicing_pass(s, margin=12):
    """A pianist's voicing: anything struck with a melody note is kept >= margin below it; ghosts 18-32."""
    adj = 0
    mel = [n for n in s.notes if n.voice == "mel"]
    for m in mel:
        for n in s.notes:
            if n.voice != "mel" and abs(n.t_on - m.t_on) < 0.08 and n.vel > m.vel - margin:   # 80 ms: rolls too
                n.vel = max(8, m.vel - margin)
                adj += 1
    for n in s.notes:
        if n.voice == "ghost":
            n.vel = int(min(32, max(18, n.vel)))
    return adj


def final_pedal_ramp(s, seconds=0.7):
    pc = s.pedal_curve
    t_up = max(t for t, v in pc if v == 127)
    keep = [(t, v) for t, v in pc if t < t_up - 1e-6]
    ramp = [(round(t_up + seconds * k / 8, 4), int(round(127 * (0.5 + 0.5 * math.cos(math.pi * k / 8))))) for k in range(9)]
    s.pedal_curve = keep + ramp


def section_meta(s):
    out = []
    for name, b0, harm, sw, rub, offs, grv, vel, mel, rng in SECTIONS:
        out.append(dict(name=name, b0=s.bar_start(b0), b1=s.bar_start(b0 + len(harm)), groove=grv,
                        mel_range=(P(rng[0]), P(rng[1])), swing=sw))
    return out


def checklist(s, hits, osc):
    """research/music.md section 6, with measured evidence where a number exists (the rest is the composer's
    written review, kept in PROGRESS.md)."""
    ns = sorted(s.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    dur = max(n.t_off for n in ns)
    T = {x["name"]: x for x in s.timeline["sections"]}

    def silence_before(bar):                      # gap between the last sound and the pickup into `bar`
        b0 = s.bar_start(bar)
        pick = min((n for n in mel if b0 - 0.6 <= n.beat < b0), key=lambda n: n.beat)
        sound = max(n.t_off for n in ns if n.t_on < pick.t_on - 0.05)
        return pick.t_on - sound
    vmax = {k: max([n.vel for n in mel if v["t_start"] - .05 <= n.t_on < v["t_end"] - .05] or [0]) for k, v in T.items()}
    apex = max(mel, key=lambda n: n.pitch)
    last = mel[-1]
    ped_up = max(t for t, v in s.pedal_curve if v == 127)
    gh = [n.vel for n in ns if n.voice == "ghost"]
    out = ["\nSECTION-6 CHECKLIST (measured evidence; written review in PROGRESS.md)"]
    out.append("  1 hook: chorus bars 17-18 (Bb4 leap to G5, turn, 3+3+2 fall | Eb5 sus on the '&' of 1 -> D5); heard in "
               "intro 2-3, C1 17/21, C2 33/37 (octaves), climax 53/57 (new apex), final A 63, coda 67 - varied each time")
    out.append("  2 motifs: gamma in verse 5/7/9/10 + pre 13-15 + chorus 19/23; beta in pre 16 and bridge 44; alpha's leap as "
               "a minor 6th in bridge 45; 3+3+2 pocket as the build's top line 49-51; C2 counter (34) = the hook's turn")
    out.append("  3/4/5 loops, inner motion, bass line: see [texture] info above")
    out.append("  6 cadences: half (16: V), elided authentic (24 -> 25), deceptive (40 -> 41 vi), C pedal = V of F (49-52), "
               "minor plagal Bbmaj9 -> Bbm6 -> Fadd9 (67-69)")
    out.append(f"  7 arrivals: silence before chorus 1 {silence_before(17):.2f}s, before climax {silence_before(53):.2f}s; "
               f"apex {pname(apex.pitch)} once at {apex.t_on:.1f}s = {apex.t_on / dur * 100:.1f}%; "
               f"loudest section = {max(vmax, key=vmax.get)} ({max(vmax.values())})")
    out.append("  8 melody on top: see [melody] prominence + NOT ON TOP checks above")
    out.append(f" 10 groove: swing 0.56-0.58 (choruses / verse 2 / pre 2), 0.56 climax; ghosts {min(gh)}-{max(gh)}; "
               f"backbeat shells on 2 & 4 (choruses), on 3 (bridge)")
    out.append(" 11 tempo: see [groove] info (groove sections within 1 %)")
    out.append(" 12 dynamics, melody max per section: " + ", ".join(f"{k} {v}" for k, v in vmax.items()))
    out.append(f" 15 ending: Friberg rit w=0.6 q=2.5 over 67-68; last melody {pname(last.pitch)} v{last.vel}; "
               f"last chord rings {ped_up - last.t_on:.1f}s, then a 0.7s damper ramp; 4-3 (tenor) and 9-3 (RH) "
               f"resolve inside it")
    out.append(f" 16 duration to last note-off {dur:.1f}s = {int(dur // 60)}:{dur % 60:04.1f}")
    out.append(f" 17 originality: RFIY 4-interval matches {len(hits)}, neighbour oscillations {osc}; no vi-IV-I-V, no "
               f"8th-note arpeggio loops (every LH bar hand-written). Human A/B listening: NOT done (no audio here)")
    return out


def main():
    s, adj = build()
    secs = section_meta(s)
    changes = [(b, ch["sym"], sec) for b, ch, sec, bar, st in s._timeline_chords]
    drops = [(s.pos(b, bt), s.pos(nxt, 1)) for b, bt, nxt in DROPS]
    lines = []
    tl = s.timeline
    dur = max(n.t_off for n in s.notes)
    lines.append(f"AFTERGLOW (melody candidate)  seed={SEED}  notes={len(s.notes)}  last note-off {dur:.2f}s "
                 f"= {int(dur // 60)}:{dur % 60:04.1f}")
    lines.append("SECTIONS")
    for sec in tl["sections"]:
        lines.append(f"  {sec['name']:8s} bars {sec['bar_start']:2d}-{sec['bar_end']:2d}  {sec['t_start']:7.2f} - "
                     f"{sec['t_end']:7.2f} ({sec['t_end'] - sec['t_start']:5.1f}s)")
    total_issues = 0
    dsl_issues = s.check()
    total_issues += len(dsl_issues)
    lines.append(f"\n[DSL Score.check()] {len(dsl_issues)} issues")
    lines += ["  " + x for x in dsl_issues[:60]]
    # the research sketch's validators
    sys.path.insert(0, os.path.join(ROOT, "sandbox", "music-research"))
    import sketch
    ex, weak6 = sketch.extra_checks(s)
    hits, osc = sketch.rfiy_overlap(s)
    lines.append(f"\n[sketch.extra_checks] {len(ex)} issues; melody onsets < 6 vel above accompaniment: {weak6}")
    lines += ["  " + x for x in ex[:60]]
    lines.append(f"[sketch.rfiy_overlap] RFIY 4-interval window matches: {len(hits)}; +-1 neighbour oscillations: {osc}")
    total_issues += len(ex) + weak6 + len(hits) + osc
    for title, (iss, info) in [("playability", checks.playability(s)), ("melody", checks.melody(s, secs)),
                               ("structure", checks.structure(s, secs, changes, drops)),
                               ("groove", checks.groove(s, secs)),
                               ("texture", checks.texture(s, secs, changes=changes)),
                               ("voice-leading", checks.voice_leading(s, secs, OCTAVE_BARS)),
                               ("pedal-mud", checks.pedal_mud(s))]:
        total_issues += len(iss)
        lines.append(f"\n[{title}] {len(iss)} issues")
        lines += ["  " + x for x in iss[:80]]
        lines += ["  info: " + x for x in info]
    lines.append(f"\nvoicing pass: {adj} accompaniment velocities lowered to keep the melody >= 12 above")
    lines.append("\nMELODY STATS (sketch.melody_stats)")
    for k, v in sketch.melody_stats(s).items():
        lines.append(f"  {k:8s} {v}")
    lines.append("\nswing / rubato / offsets per section")
    for name, b0, harm, sw, rub, offs, grv, *_ in SECTIONS:
        lines.append(f"  {name:8s} swing {sw:.2f} rubato {rub:.2f} groove {grv} offsets {offs}")
    lines += checklist(s, hits, osc)
    lines.append(f"\nTOTAL ISSUES: {total_issues}")
    txt = "\n".join(lines)
    print(txt)
    open(os.path.join(OUT, "checks.txt"), "w", encoding="utf-8").write(txt)
    open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8").write(s.report())
    ls = s.leadsheet()
    ls += "\n\nINTENDED HARMONY (bar:beat symbol roman)\n"
    for b, ch, sec, bar, st in s._timeline_chords:
        ls += f"  {bar:3d}:{1 + st / 4:<4g} {sec:8s} {ch['sym']:12s} {ch['roman']}\n"
    open(os.path.join(OUT, "leadsheet.txt"), "w", encoding="utf-8").write(ls)
    s.to_midi(os.path.join(OUT, "score.mid"))
    data = s.to_json(os.path.join(OUT, "score.json"))
    data["chords"] = [dict(bar=bar, beat=1 + st / 4, sym=ch["sym"], roman=ch["roman"], section=sec,
                           t=round(s._b2s(b), 4)) for b, ch, sec, bar, st in s._timeline_chords]
    data["seed"] = SEED
    with open(os.path.join(OUT, "score.json"), "w") as f:
        json.dump(data, f, indent=0)
    if "--no-png" not in sys.argv:
        for i, sec in enumerate(tl["sections"]):
            s.pianoroll(os.path.join(OUT, f"roll_{i + 1:02d}_{sec['name']}.png"), t0=sec["t_start"] - 0.3,
                        t1=sec["t_end"] + 0.3)
        s.pianoroll(os.path.join(OUT, "roll_full.png"))
    return s


if __name__ == "__main__":
    main()
