"""Writing helpers + fingering solver for the "groove" candidate of Afterglow.

Kept out of music/dsl.py on purpose (other agents use the DSL); everything here only *calls* the DSL.

Writing:
    W = Writer(score)
    W.mel(bar, "G5:6 F5:1 Eb5:1 F5:4 | ...")      melody tokens, durations in 16ths (DSL grammar otherwise)
    W.ev("L", bar, "0:Ab1:3 4:C3+G3:2!k 7:Ab2:1!g")  drum-machine style events: STEP:PITCH(+PITCH):DUR16
        suffixes: +N / -N velocity offset, @N absolute velocity, !v voice code, ^ roll
        voice codes: b bass, s acc (LH shell), k backbeat (LH snare shell), g ghost, c counter (tenor line),
                     i inner (RH comping / inner voice), m mel
    W.chg(bar, step, "Abmaj9")                      harmony change -> legato pedal change (recorded for checks)
"""
from __future__ import annotations

import itertools
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "music"))
from dsl import Score, Note, pitch, pname  # noqa: E402,F401

VOICE = {"b": "bass", "s": "acc", "k": "backbeat", "g": "ghost", "c": "counter", "i": "inner", "m": "mel"}
EV_RE = re.compile(r"(\d+):([A-Ga-g#b0-9+]+):(\d+)([+-]\d+)?(?:@(\d+))?(?:!([bskgcim]))?(\^)?")


class Writer:
    def __init__(self, s: Score):
        self.s = s
        self.vel = {}
        self.changes = []      # (abs beat, symbol, pedal kind)
        self.section_vel = {}

    def set_vel(self, **kw):
        self.vel.update(kw)

    # ---- melody (and any other monophonic line) in 16th-note durations ----
    def mel(self, bar, text, vel=None, step=0, transpose=0, voice="mel", hand="R"):
        t = re.sub(r":(\d+)", lambda m: f":{m.group(1)}/4", text)
        return self.s.line(hand, bar, t, voice=voice, vel=vel if vel is not None else self.vel["mel"],
                           beat=1 + step / 4, transpose=transpose)

    # ---- events on the 16th grid ----
    def ev(self, hand, bar, text, transpose=0, vel_scale=1.0):
        out = []
        for tok in text.split():
            m = EV_RE.fullmatch(tok)
            if not m:
                raise ValueError(f"bad event token {tok!r} (bar {bar})")
            step, ps, dur, dv, av, vc, roll = m.groups()
            ps_i = [pitch(x) + transpose for x in ps.split("+")]
            if vc:
                voice = VOICE[vc]
            elif hand == "L":
                voice = "bass" if min(ps_i) < 48 else "acc"
            else:
                voice = "inner"
            if av:
                v = int(av)
            else:
                v = self.vel[voice] * vel_scale + (int(dv) if dv else 0)
            v = int(max(8, min(124, round(v))))
            b = 1 + int(step) / 4
            before = len(self.s.notes)
            self.s.note(hand, bar, b, ps_i, int(dur) / 4, v, voice=voice, roll=bool(roll))
            out += self.s.notes[before:]
        return out

    def chg(self, bar, step=0, sym="", kind="change"):
        b = 1 + step / 4
        self.s.pedal(bar, b, kind)
        self.changes.append((self.s.pos(bar, b), sym, kind))

    def up(self, bar, step):
        self.s.pedal(bar, 1 + step / 4, "up")


# ----------------------------------------------------------------------------------------------
# post-performance helpers
# ----------------------------------------------------------------------------------------------
def balance(s: Score, margin=12, slack=2):
    """Voicing balance pass (what a pianist's hand weight does): any non-melody note struck within 40 ms
    of a melody onset is kept at least margin+slack velocity below that melody note."""
    import bisect
    others = sorted([n for n in s.notes if n.voice != "mel"], key=lambda n: n.t_on)
    ts = [n.t_on for n in others]
    for m in (n for n in s.notes if n.voice == "mel"):
        i = bisect.bisect_left(ts, m.t_on - 0.04)
        while i < len(others) and others[i].t_on <= m.t_on + 0.04:
            o = others[i]
            if o.vel > m.vel - margin - slack:
                o.vel = max(8, m.vel - margin - slack)
            i += 1


def final_release(s: Score, t_release: float, ramp=0.7):
    """Replace everything after t_release in the pedal curve by a natural damper release ramp."""
    pc = [(t, v) for t, v in s.pedal_curve if t < t_release - 1e-6]
    k = 8
    for i in range(k + 1):
        x = i / k
        pc.append((round(t_release + ramp * x, 4), int(round(127 * (1 - x) ** 1.6))))
    s.pedal_curve = pc


def pedal_at(curve, t):
    if not curve:
        return 0
    if t <= curve[0][0]:
        return curve[0][1]
    for (t0, v0), (t1, v1) in zip(curve, curve[1:]):
        if t0 <= t <= t1:
            return v0 if t1 - t0 < 1e-9 else v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return curve[-1][1]


# ----------------------------------------------------------------------------------------------
# fingering: beam search over onset groups, per hand.  q = pitch (RH) or -pitch (LH), so in q-space
# fingers always increase with q (RH thumb lowest; LH thumb highest).
# ----------------------------------------------------------------------------------------------
OFF = {1: 0, 2: 2, 3: 4, 4: 5, 5: 7}
MAXS = {(1, 2): 9, (1, 3): 10, (1, 4): 12, (1, 5): 14, (2, 3): 5, (2, 4): 7, (2, 5): 10,
        (3, 4): 4, (3, 5): 7, (4, 5): 5}
BLACK = {1, 3, 6, 8, 10}


def _pair_cost(q1, f1, q2, f2, dt):
    d = q2 - q1
    leap_ok = abs(d) > 7 and dt >= 0.22
    if f1 == f2:
        if d == 0:
            return 0.0
        c = 3.0 + (4.0 if dt < 0.25 else 0.0)
        return min(c, 1.5) if leap_ok else c
    exp = OFF[f2] - OFF[f1]
    if (f2 > f1 and d > 0) or (f2 < f1 and d < 0):
        c = max(0.0, abs(d - exp) - 1) * 0.8
    elif d == 0:
        c = 2.0
    elif f2 == 1 and d > 0:                    # thumb under (RH up / LH down)
        c = 1.5 + max(0, d - 3) * 1.0 + (0 if f1 in (3, 4) else 1.5)
    elif f1 == 1 and d < 0 and f2 in (2, 3, 4):  # finger over thumb
        c = 1.5 + max(0, -d - 3) * 1.0 + (0 if f2 in (3, 4) else 1.5)
    else:
        c = 10.0 + abs(d)
    if leap_ok:
        c = min(c, 2.0 + 0.05 * abs(d))
    return c


def _anchor(items):
    return sum(q - OFF[f] for q, f in items) / len(items)


def finger_hand(notes, hand, beam=48):
    sign = 1 if hand == "R" else -1
    groups = {}
    for n in notes:
        groups.setdefault(round(n.beat, 4), []).append(n)
    glist = [sorted(groups[k], key=lambda n: sign * n.pitch) for k in sorted(groups)]
    # state: (cost, held tuple ((q, f, t_off),...), prev tuple ((q, f),...), prev_t, path)
    states = [(0.0, (), (), -10.0, [])]
    for g in glist:
        t = min(n.t_on for n in g)
        qs = [sign * n.pitch for n in g]
        k = len(g)
        cands = list(itertools.combinations(range(1, 6), min(k, 5)))
        new_states = {}
        for cost, held, prev, pt, path in states:
            hl = [h for h in held if h[2] > t + 0.02]
            hf = {h[1] for h in hl}
            for fs in cands:
                c = 0.0
                items = list(zip(qs, fs))
                for q, f in items:
                    if f in hf:
                        c += 1000
                    for qh, fh, _ in hl:
                        if q == qh or (q - qh) * (f - fh) <= 0:
                            c += 400
                allit = sorted(items + [(h[0], h[1]) for h in hl if h[1] not in fs], key=lambda x: x[1])
                for (qa, fa), (qb, fb) in itertools.combinations(allit, 2):
                    dd = qb - qa
                    mx = MAXS[(fa, fb)]
                    if dd > mx:
                        c += (dd - mx) * 6 + (300 if dd > mx + 2 else 0)
                for (q, f), n in zip(items, g):
                    if f == 1 and n.pitch % 12 in BLACK:
                        c += 3.0 if k == 1 else 0.8        # thumb on black: bad in runs, normal in chords
                    if hand == "R" and f == 5 and n.pitch % 12 in BLACK and k == 1:
                        c += 0.5
                    if hand == "L" and k == 1 and n.voice == "bass" and n.pitch < 48 and f != 5:
                        c += 1.6                           # LH bass ("kick") is the 5th finger
                if k > 1 and qs[-1] - qs[0] >= 11 and (fs[0] != 1 or fs[-1] != 5):
                    c += 2.5
                if k > 1:
                    top_f = fs[-1]
                    if hand == "R" and top_f < 4:
                        c += 1.5
                    if hand == "L" and top_f < 5 and g[-1].voice == "bass":
                        c += 1.0
                dt = t - pt
                if prev:
                    if len(prev) == 1 and k == 1:
                        c += _pair_cost(prev[0][0], prev[0][1], qs[0], fs[0], dt)
                    tf = 1.0 if dt < 0.2 else (0.6 if dt < 0.4 else 0.25)
                    c += 0.3 * abs(_anchor(items) - _anchor(prev)) * tf
                nheld = tuple(sorted([h for h in hl if h[1] not in fs] +
                                     [(q, f, n.t_off) for (q, f), n in zip(items, g)]))
                key = (tuple(sorted((h[0], h[1]) for h in nheld)), tuple(items))
                tot = cost + c
                if key not in new_states or new_states[key][0] > tot:
                    new_states[key] = (tot, nheld, tuple(items), t, path + [fs])
        states = sorted(new_states.values(), key=lambda x: x[0])[:beam]
    best = states[0]
    for g, fs in zip(glist, best[4]):
        for n, f in zip(g, fs):
            n.finger = f
    return best[0]


def assign_fingers(s: Score):
    tot = {}
    for hand in ("R", "L"):
        ns = [n for n in s.notes if n.hand == hand]
        tot[hand] = finger_hand(ns, hand)
    return tot


# ----------------------------------------------------------------------------------------------
# extra writing helpers (session 2)
# ----------------------------------------------------------------------------------------------
def find_note(s: Score, bar, step, name, hand="R", voice=None):
    p = pitch(name)
    b = s.pos(bar, 1 + step / 4)
    for n in s.notes:
        if n.pitch == p and abs(n.beat - b) < 1e-6 and n.hand == hand and (voice is None or n.voice == voice):
            return n
    raise KeyError(f"no note {name} at bar {bar} step {step}")


def extend(s: Score, bar, step, name, extra16, hand="R", voice=None):
    """Tie a note across a line() boundary: lengthen the note at (bar, step) by extra16 sixteenths."""
    n = find_note(s, bar, step, name, hand, voice)
    n.dur += extra16 / 4
    return n


def double_octave(s: Score, bar0, bar1, min16=2, dv=-16, below=12, skip=()):
    """RH octave doubling of the melody (voice 'inner', an octave below) for notes >= min16 sixteenths."""
    out = []
    b0, b1 = s.bar_start(bar0), s.bar_start(bar1 + 1)
    mel = [n for n in s.notes if n.voice == "mel" and b0 <= n.beat < b1]
    for n in mel:
        if n.dur * 4 + 1e-6 < min16:
            continue
        if any(abs(n.beat - s.pos(b, 1 + st / 4)) < 1e-6 for b, st in skip):
            continue
        m = Note(n.pitch - below, n.beat, n.dur, max(10, n.vel + dv), "R", "inner")
        s.notes.append(m)
        out.append(m)
    return out


def ramp(s: Score, a, b, g0, g1, voices=None, hands=None):
    """Velocity ramp (pre-performance): a, b = (bar, step16). Multiplies note velocities linearly g0 -> g1."""
    pa, pb = s.pos(a[0], 1 + a[1] / 4), s.pos(b[0], 1 + b[1] / 4)
    for n in s.notes:
        if pa - 1e-9 <= n.beat < pb and (voices is None or n.voice in voices) and (hands is None or n.hand in hands):
            x = (n.beat - pa) / max(pb - pa, 1e-9)
            n.vel = int(max(8, min(124, round(n.vel * (g0 + (g1 - g0) * x)))))
