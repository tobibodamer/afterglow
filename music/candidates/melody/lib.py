"""Helpers for the "melody" candidate of Afterglow (does not touch music/dsl.py).

- C(): chord data (symbol, roman, bass, LH shell, RH pool, optional LH moving note)
- ev(): compact event language for hand-written accompaniment bars
      tokens  PITCH@step/dur[:v][+N|-N][^][%f]   or  [P P]@step/dur...
      step / dur in 16ths (step may run past 15 into the next bar), v = voice code
      b=bass s=acc(shell) g=ghost c=counter(tenor) i=inner(RH) m=mel
- lh(): pattern library P1-P7 (ported from the research sketch) + fills + omissions
- comp(): RH inner-voice / comping generator that stays >= 3 st under the melody,
      above the LH and inside one hand span, with simple voice leading
- shape_melody(): per-note melody velocity contour (pitch arc, long-note weight, pickups)
- assign_fingers(): Viterbi fingering per hand over the performed key-hold timeline
"""
from __future__ import annotations

import itertools
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "music"))
from dsl import Score, Note, pitch, pname  # noqa: E402,F401

P = pitch
VOICE = {"b": "bass", "s": "acc", "g": "ghost", "c": "counter", "i": "inner", "m": "mel"}


def C(sym, roman, bass, shell, pool, mv=None):
    return dict(sym=sym, roman=roman, bass=P(bass), shell=[P(x) for x in shell],
                pool=[P(x) for x in pool], mv=P(mv) if mv else None)


# ------------------------------------------------------------------------------------------
# compact event language
# ------------------------------------------------------------------------------------------
_TOK = re.compile(r"(\[[^\]]+\]|[A-G][#b]*-?\d)@([0-9.]+)/([0-9.]+)(:[bsgcim])?([+-]\d+)?(\^)?(?:%([1-5](?:,[1-5])*))?$")


def ev(s: Score, hand: str, bar: int, text: str, vel: dict, voice="acc", tags=None):
    out = []
    for tok in re.findall(r"\[[^\]]*\]\S*|\S+", text):
        m = _TOK.match(tok)
        if not m:
            raise ValueError(f"bad event token {tok!r} in bar {bar}")
        body, st, d, vc, off, roll, fing = m.groups()
        names = body.strip("[]").split() if body.startswith("[") else [body]
        vo = VOICE[vc[1]] if vc else voice
        v = vel[vo] + (int(off) if off else 0)
        names = sorted(names, key=P)
        fl = [int(x) for x in fing.split(",")] if fing else []
        for i, nm in enumerate(names):
            s.note(hand, bar, 1 + float(st) / 4, nm, float(d) / 4, int(max(8, min(124, v))), voice=vo,
                   roll=bool(roll), finger=fl[i] if i < len(fl) else 0, tags=list(tags or []))
            out.append(s.notes[-1])
    return out


# ------------------------------------------------------------------------------------------
# LH pattern library: (step, role, dur_steps, vel_offset) ; 16-step bar or 8-step half bar
# ------------------------------------------------------------------------------------------
PAT = {
    # P1 Tenth Bloom (ballad): bass, shell low on "a" of 1, shell high on "&" of 2, 9->10 sigh
    "P1": {16: [(0, "R", 3, 0), (3, "S0", 5, -8), (6, "S1", 4, -6), (10, "MV", 2, -12), (12, "S1", 4, -10)],
           8: [(0, "R", 2, 0), (2, "S0", 3, -8), (5, "S1", 3, -8)]},
    # P1b (ballad, second variant): bass, rolled full shell on 2, moving note on "&" of 3
    "P1b": {16: [(0, "R", 3, 0), (4, "S", 6, -8), (10, "MV", 2, -12), (12, "S1", 4, -10)],
            8: [(0, "R", 3, 0), (3, "S", 5, -8)]},
    # P2 Boom-Bap Stride: kick 1, snare 2, ghost kick "a" of 2, kick "&" of 3, snare 4, ghost approach
    "P2": {16: [(0, "R", 3, 0), (4, "S", 2, -6), (7, "G8", 1, 0), (10, "R", 2, -4), (12, "S", 2, -6), (14, "APP", 2, -10)],
           8: [(0, "R", 3, 0), (4, "S", 2, -6), (6, "APP", 2, -10)]},
    # P3 Lazy Walk: long root, pushed shell, root 8va on 3, ghost, high shell on 4, approach
    "P3": {16: [(0, "R", 5, 0), (6, "S", 2, -6), (8, "R8", 2, -10), (11, "G8", 1, 0), (12, "S1", 2, -10), (14, "APP", 2, -8)],
           8: [(0, "R", 4, 0), (4, "S", 2, -6), (6, "APP", 2, -8)]},
    # P4 Octave Push: tresillo octaves + shell + octave approach
    "P4": {16: [(0, "OCT", 6, 0), (6, "OCT", 6, 3), (12, "S0", 2, -10), (14, "APP8", 2, -4)],
           8: [(0, "OCT", 4, 0), (4, "S0", 2, -10), (6, "APP8", 2, -6)]},
    # P5 Half-time Chorale (bridge): bass 1, soft low shell 2, full shell 3 (backbeat), move on "&" of 4
    "P5": {16: [(0, "R", 3, 0), (4, "S0", 4, -12), (8, "S", 6, -4), (14, "MV", 2, -14)],
           8: [(0, "R", 3, 0), (4, "S", 4, -6)]},
    # P6 Pulse Riser (build): straight 8th octaves, 3+3+2 accents
    "P6": {16: [(k, "OCT", 2, (6 if k in (0, 6, 12) else -6)) for k in range(0, 16, 2)],
           8: [(k, "OCT", 2, (6 if k in (0, 6) else -6)) for k in range(0, 8, 2)]},
    # P7 Rolled Bloom: bass, shell an 8th later, inner move on 3
    "P7": {16: [(0, "R", 2, 0), (2, "S", 14, -8), (8, "MV", 8, -12)],
           8: [(0, "R", 2, 0), (2, "S", 6, -8)]},
}


def lh(s: Score, bar: int, segs, pat: str, vel: dict, next_bass=None, fill=None, omit=(), tags=None, shell_override=None):
    """Render one bar. segs = [(step, chord)], next_bass = bass pitch of the next harmony (for approaches).
    fill: None | "walk" | "ghost" | "drop" | "push"   (replaces the last beat, steps >= 12)."""
    out = []
    for j, (st, ch) in enumerate(segs):
        seg_len = 16 if len(segs) == 1 else 8
        nb = segs[j + 1][1]["bass"] if j + 1 < len(segs) else (next_bass if next_bass is not None else ch["bass"])
        shell = shell_override.get(j, ch["shell"]) if shell_override else ch["shell"]
        for step, role, dur, dv in PAT[pat][seg_len]:
            a = st + step
            if a in omit:
                continue
            if fill and a >= 12 and j == len(segs) - 1:
                continue
            v = dv
            vo = "bass"
            if role == "R":
                ps = [ch["bass"]]
            elif role == "R8":
                ps = [ch["bass"] + 12]
            elif role == "G8":
                ps = [ch["bass"] + 12]
                vo = "ghost"
            elif role == "OCT":
                ps = [ch["bass"], ch["bass"] + 12]
            elif role == "S":
                ps, vo = list(shell), "acc"
            elif role == "S0":
                ps, vo = shell[:1], "acc"
            elif role == "S1":
                ps, vo = shell[-1:], "acc"
            elif role == "MV":
                if not ch["mv"]:
                    continue
                ps, vo = [ch["mv"]], "acc"
            elif role in ("APP", "APP8"):
                if nb == ch["bass"]:
                    ps = [ch["bass"] + 7]
                else:
                    ps = [nb - 1] if nb > ch["bass"] else [nb + 1]
                if role == "APP8":
                    ps = [ps[0], ps[0] + 12]
                else:
                    vo = "ghost"
                    v = 0
            else:
                raise ValueError(role)
            for p in ps:
                s.note("L", bar, 1 + a / 4, p, dur / 4, int(max(8, vel[vo] + v)), voice=vo, tags=list(tags or []))
                out.append(s.notes[-1])
    if fill:
        ch = segs[-1][1]
        nb = next_bass if next_bass is not None else ch["bass"]
        if fill == "walk":             # two 8ths walking into the next bass
            up = nb >= ch["bass"]
            w1, w2 = (nb - 3, nb - 1) if up else (nb + 3, nb + 1)
            if abs(nb - ch["bass"]) <= 2:
                w1 = ch["bass"] + 7 if ch["bass"] + 7 < 48 else ch["bass"] - 5
            for k, p in ((12, w1), (14, w2)):
                s.note("L", bar, 1 + k / 4, p, 0.5, int(vel["bass"] - 6 - (k - 12)), voice="bass", tags=list(tags or []))
                out.append(s.notes[-1])
        elif fill == "ghost":          # ghost pair on the high shell, then approach
            sh = ch["shell"][-1]
            for k in (12, 13):
                s.note("L", bar, 1 + k / 4, sh, 0.25, vel["ghost"], voice="ghost", tags=list(tags or []))
                out.append(s.notes[-1])
            ap = nb - 1 if nb > ch["bass"] else nb + 1
            s.note("L", bar, 1 + 14 / 4, ap, 0.5, vel["ghost"] + 2, voice="ghost", tags=list(tags or []))
            out.append(s.notes[-1])
        elif fill == "push":           # octave anticipation of the next root on the "&" of 4
            s.note("L", bar, 1 + 12 / 4, ch["shell"][:1], 0.5, vel["acc"] - 8, voice="acc", tags=list(tags or []))
            s.note("L", bar, 1 + 14 / 4, [nb, nb + 12], 0.5, vel["bass"] + 2, voice="bass", tags=list(tags or []))
            out += s.notes[-3:]
        # "drop": nothing (silence on beat 4)
    return out


# ------------------------------------------------------------------------------------------
# RH comping / inner voices
# ------------------------------------------------------------------------------------------
def _overlap(notes, b0, b1):
    return [n for n in notes if n.beat < b1 - 1e-6 and n.beat + n.dur > b0 + 1e-6]


def comp(s: Score, bar: int, steps, chord_fn, vel: int, n=1, dur=2, voice="inner", min_below=3, max_below=12,
         skip_near=True, tags=None, prev=None):
    """Add RH inner notes at the given 16th steps of `bar`, chosen from the chord pool."""
    mel = sorted([m for m in s.notes if m.voice == "mel"], key=lambda m: m.beat)
    lhn = [m for m in s.notes if m.hand == "L"]
    out = []
    for st in steps:
        b0 = s.pos(bar, 1 + st / 4)
        b1 = b0 + dur / 4
        ch = chord_fn(b0)
        if ch is None:
            continue
        if skip_near and any(abs(m.beat - b0) > 1e-6 and abs(m.beat - b0) < 0.26 for m in mel):
            continue
        ov = _overlap(mel, b0, b1)
        if ov:
            top_lo, top_hi = min(m.pitch for m in ov), max(m.pitch for m in ov)
        else:
            near = [m for m in mel if abs(m.beat - b0) < 2.0]
            if not near:
                continue
            top_lo = top_hi = min(m.pitch for m in near)
        lh_hi = max([m.pitch for m in _overlap(lhn, b0, b1)] or [0])
        cand = sorted(p for p in ch["pool"] if top_hi - max_below <= p <= top_lo - min_below and p > lh_hi
                      and top_hi - p <= 13)
        if not cand:
            continue
        if prev and prev.get("top") is not None and len(cand) > n:
            best = min(range(len(cand) - n + 1), key=lambda i: (abs(cand[i + n - 1] - prev["top"]), -i))
            pick = cand[best:best + n]
        else:
            pick = cand[-n:]
        for p in pick:
            s.note("R", bar, 1 + st / 4, p, dur / 4, vel, voice=voice, tags=list(tags or []))
            out.append(s.notes[-1])
        if prev is not None:
            prev["top"] = pick[-1]
    return out


def octave_double(s: Score, bars, vel_drop=16, skip=()):
    """Double the melody an octave below (RH thumb) in the given bars."""
    out = []
    for n in [m for m in s.notes if m.voice == "mel"]:
        if s._bar_of(n.beat) in bars and round(n.beat, 3) not in skip:
            s.notes.append(Note(n.pitch - 12, n.beat, n.dur, max(10, n.vel - vel_drop), "R", "inner", tags=["oct"]))
            out.append(s.notes[-1])
    return out


# ------------------------------------------------------------------------------------------
# melody velocity contour
# ------------------------------------------------------------------------------------------
def shape_melody(s: Score, bar0: int, bar1: int, base: int, slope=0.7, span=9, ramp=0.0):
    """Velocity = base + pitch arc (higher = louder, clipped) + weight for long/landing notes,
    lighter quick notes and pickups; optional linear ramp (velocity units over the range)."""
    b0, b1 = s.bar_start(bar0), s.bar_start(bar1 + 1)
    ms = sorted([n for n in s.notes if n.voice == "mel" and b0 <= n.beat < b1], key=lambda n: n.beat)
    if not ms:
        return
    center = sorted(n.pitch for n in ms)[len(ms) // 2]
    for i, n in enumerate(ms):
        v = base + max(-span, min(span, (n.pitch - center) * slope))
        if n.dur >= 1.0:
            v += 3
        if n.dur <= 0.26:
            v -= 4
        frac_ = (n.beat % 1.0)
        if abs(frac_ - 0.5) < 1e-6 and n.dur >= 0.75:     # syncopated landing on an "&"
            v += 3
        nxt = ms[i + 1] if i + 1 < len(ms) else None
        if nxt and n.dur <= 0.5 and nxt.pitch - n.pitch >= 7:  # pickup into a leap: lighter
            v -= 5
        if ramp:
            v += ramp * (n.beat - b0) / max(b1 - b0, 1e-9)
        n.vel = int(max(10, min(124, round(v))))


# ------------------------------------------------------------------------------------------
# fingering (Viterbi over key-down states, per hand, on the performed timeline)
# ------------------------------------------------------------------------------------------
BLACK = {1, 3, 6, 8, 10}
_WI = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6]
MAXC = {(1, 2): 5, (1, 3): 7, (1, 4): 9, (1, 5): 12, (2, 3): 4, (2, 4): 5, (2, 5): 8, (3, 4): 3, (3, 5): 5, (4, 5): 3}
MAXP = {(1, 2): 8, (1, 3): 10, (1, 4): 12, (1, 5): 14, (2, 3): 5, (2, 4): 7, (2, 5): 10, (3, 4): 4, (3, 5): 7, (4, 5): 5}


def _wi(p):
    o, pc = divmod(p, 12)
    return o * 7 + _WI[pc]


def assign_fingers(s: Score):
    for hand in ("R", "L"):
        _finger_hand(s, hand)


def _finger_hand(s, hand):
    sg = 1 if hand == "R" else -1
    ns = sorted([n for n in s.notes if n.hand == hand], key=lambda n: (n.t_on, n.pitch))
    events = []
    for n in ns:
        if events and n.t_on - events[-1][0] < 0.03:
            events[-1][1].append(n)
        else:
            events.append([n.t_on, [n]])
    # keys down at each event
    states_all, keys_all = [], []
    active = []
    for t, new in events:
        active = [m for m in active if m.t_off > t + 0.012]
        keys = sorted(active + new, key=lambda m: sg * m.pitch)
        if len(keys) > 5:              # impossible -> keep the newest 5 (validator will flag)
            keys = sorted(new + active[-(5 - len(new)):] if len(new) < 5 else new[:5], key=lambda m: sg * m.pitch)
        keys_all.append(keys)
        active = active + new
    INF = 1e9
    prev = None    # list of (assign tuple, cost, backptr)
    trellis = []
    for ei, (t, new) in enumerate(events):
        keys = keys_all[ei]
        k = len(keys)
        newset = set(id(m) for m in new)
        cands = list(itertools.combinations(range(1, 6), k))
        pre = [(a, m.preset) for a, m in enumerate(keys) if getattr(m, "preset", 0)]
        if pre:
            cands = [fs for fs in cands if all(fs[a] == f for a, f in pre)] or cands
        st_cost = []
        for fs in cands:
            c = 0.0
            for a in range(k - 1):
                d = abs(keys[a + 1].pitch - keys[a].pitch)
                pr = (fs[a], fs[a + 1])
                c += max(0, d - MAXC[pr]) * 1.5 + max(0, d - MAXP[pr]) * 25 + max(0, (pr[1] - pr[0]) - d) * 0.6
            for a, m in enumerate(keys):
                if id(m) in newset and m.pitch % 12 in BLACK:
                    if fs[a] == 1:
                        c += 2.5 if (k == 1 and m.t_off - m.t_on < 0.4) else 0.9
                    elif fs[a] == 5:
                        c += 0.3
            if k >= 2 and hand == "R" and keys[-1].voice == "mel" and fs[-1] < 4:
                c += 0.8
            st_cost.append(c)
        anchors = [sum(sg * _wi(m.pitch) - (f - 1) for m, f in zip(keys, fs)) / k for fs in cands]
        row = []
        for ci, fs in enumerate(cands):
            amap = {id(m): f for m, f in zip(keys, fs)}
            if prev is None:
                row.append((fs, st_cost[ci], -1))
                continue
            pkeys, pt = keys_all[ei - 1], events[ei - 1][0]
            dt = t - pt
            best, bi = INF, -1
            for pi, (pfs, pc, _) in enumerate(prev):
                if pc >= INF:
                    continue
                pmap = {id(m): f for m, f in zip(pkeys, pfs)}
                ok = all(pmap[i] == f for i, f in amap.items() if i in pmap)
                if not ok:
                    continue
                pa = sum(sg * _wi(m.pitch) - (f - 1) for m, f in zip(pkeys, pfs)) / len(pkeys)
                c = abs(anchors[ci] - pa) * (1.0 / (1 + 4 * max(0.0, dt - 0.12)))
                x, y = _line_note(events[ei - 1][1], hand, pkeys), _line_note(new, hand)
                if x is not None and y is not None and id(x) in pmap and id(y) in amap:
                    c += _step_cost(x, y, pmap[id(x)], amap[id(y)], sg, dt)
                tot = pc + c
                if tot < best:
                    best, bi = tot, pi
            if bi < 0:   # no consistent predecessor: allow a silent finger substitution (expensive)
                pi = min(range(len(prev)), key=lambda i: prev[i][1])
                best, bi = prev[pi][1] + 40, pi
            row.append((fs, best + st_cost[ci], bi))
        trellis.append(row)
        prev = row
    if not trellis:
        return
    ci = min(range(len(trellis[-1])), key=lambda i: trellis[-1][i][1])
    total_cost = trellis[-1][ci][1]
    for ei in range(len(trellis) - 1, -1, -1):
        fs, _, bp = trellis[ei][ci]
        newset = set(id(m) for m in events[ei][1])
        for m, f in zip(keys_all[ei], fs):
            if id(m) in newset:
                m.finger = f
        ci = bp if bp >= 0 else 0
    for m in ns:
        if not m.finger:
            m.finger = 1 if hand == "R" else 5
    return total_cost


def _line_note(evnotes, hand, held=None):
    """The note that carries the line in an onset group: the melody (top) in the RH - for the previous group also a
    melody key still held under a newer comping chord - else a lone note."""
    if hand == "R":
        mel = [m for m in (held or evnotes) if m.voice == "mel"]
        if mel:
            return max(mel, key=lambda m: m.pitch)
    return evnotes[0] if len(evnotes) == 1 else None


def _step_cost(x, y, fx, fy, sg, dt):
    """Cost of playing y with finger fy right after x with finger fx (same hand). sg mirrors the LH."""
    d = sg * (y.pitch - x.pitch)
    legato = x.t_off >= y.t_on - 0.06
    far = dt > 0.35 and not legato
    c = 0.0
    if d > 0 and fy < fx:
        c += (0.8 + (0.7 if fx == 4 else 0)) if (fy == 1 and fx in (2, 3, 4) and d <= 5) else (1.5 if far else 7)
    elif d < 0 and fy > fx:
        c += (0.8 + (0.7 if fy == 4 else 0)) if (fx == 1 and fy in (2, 3, 4) and -d <= 5) else (1.5 if far else 7)
    elif d != 0 and fy == fx:
        c += 6.0 if (legato or dt < 0.3) else (1.0 if dt < 0.6 else 0.3)
    elif d == 0 and fy != fx:
        c += 0.15 if dt > 0.25 else 0.6
    if d > 0 and fy > fx:
        c += max(0, d - MAXC[(fx, fy)]) * 1.0 + max(0, (fy - fx) - d) * 0.4
    elif d < 0 and fy < fx:
        c += max(0, -d - MAXC[(fy, fx)]) * 1.0 + max(0, (fx - fy) + d) * 0.4
    return c


def preset_bass_fingers(s: Score):
    """LH bass reached by a leap is taken with the 5th finger (octaves 5 + 1), the way pianists play it."""
    L = sorted([n for n in s.notes if n.hand == "L"], key=lambda n: n.beat)
    groups = {}
    for n in L:
        groups.setdefault(round(n.beat, 4), []).append(n)
    keys = sorted(groups)
    for i, k in enumerate(keys):
        g = groups[k]
        if not all(n.voice == "bass" for n in g) or any(n.finger for n in g):
            continue
        if len(g) == 2 and abs(g[0].pitch - g[1].pitch) == 12:
            lo, hi = sorted(g, key=lambda n: n.pitch)
            lo.finger, hi.finger = 5, 1
        elif len(g) == 1:
            prev = groups[keys[i - 1]] if i else None
            nxt = groups[keys[i + 1]] if i + 1 < len(keys) else None
            step_in = prev and k - keys[i - 1] < 1.01 and abs(min(m.pitch for m in prev) - g[0].pitch) <= 2
            step_out = nxt and keys[i + 1] - k < 1.01 and len(nxt) == 1 and nxt[0].voice in ("bass", "ghost")                 and 0 < nxt[0].pitch - g[0].pitch <= 2
            if not step_in and not step_out:
                g[0].finger = 5


def mark_presets(s: Score):
    for n in s.notes:
        n.preset = n.finger


def release_before_leaps(s: Score, hand: str, near=7, far=12, gap_near=0.125, gap_far=0.25, keep_voices=()):
    """Shorten key-holds so the hand is free before it must jump: a key still held when the same hand strikes a
    note more than `near` (or `far`) semitones away is released gap_near (gap_far) beats earlier.
    The sound is carried by the pedal; this is the true key/finger release for the animation."""
    import bisect
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
        while i < len(onsets) and onsets[i] <= end + 1e-6:
            grp = at[onsets[i]]
            jump = max(abs(m.pitch - n.pitch) for m in grp)
            if jump > near:
                g = gap_far if jump > far else gap_near
                new = max(0.125, onsets[i] - n.beat - g)
                if new < n.dur:
                    n.dur = new
                break
            i += 1
