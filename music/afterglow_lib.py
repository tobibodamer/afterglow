"""Helpers for the definitive "Afterglow" score (music/afterglow_score.py). Only *calls* music/dsl.py.

Ported from the winning "melody" candidate's lib.py (event language, melody shaping, Viterbi fingering) and
extended for the final pass:
  - ev(): compact event language for hand-written accompaniment bars
        tokens  PITCH@step/dur[:v][+N|-N][^][%f]   or  [P P]@step/dur...
        step / dur in 16ths (a dur may run over the bar line), v = voice code
        b=bass s=acc(shell) g=ghost c=counter(tenor) i=inner(RH) m=mel o=oct (RH octave doubling)
  - octave_double(): RH thumb doubles the tune an octave below, skipping notes shorter than an 8th
        (judges: doubled 16th neighbours smear a m2 in two octaves under the pedal)
  - shape_melody(): per-note melody velocity contour
  - straighten_kicks(): Dilla layering - LH bass/ghost 16ths stay on the straight grid under swung RH layers
  - apex_shape(): the single F6 is the loudest note of the piece; everything else stays >= 4 below it
  - assign_fingers(): Viterbi fingering per hand over the performed key-hold timeline
"""
from __future__ import annotations

import bisect
import itertools
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from dsl import Score, Note, pitch, pname  # noqa: E402,F401

import re  # noqa: E402

P = pitch
VOICE = {"b": "bass", "s": "acc", "g": "ghost", "c": "counter", "i": "inner", "m": "mel", "o": "inner"}
BLACK = {1, 3, 6, 8, 10}


def C(sym, roman, bass, shell, pool=(), mv=None):
    return dict(sym=sym, roman=roman, bass=P(bass), shell=[P(x) for x in shell],
                pool=[P(x) for x in pool], mv=P(mv) if mv else None)


# ------------------------------------------------------------------------------------------
# compact event language
# ------------------------------------------------------------------------------------------
_TOK = re.compile(r"(\[[^\]]+\]|[A-G][#b]*-?\d)@([0-9.]+)/([0-9.]+)(:[bsgcimo])?([+-]\d+)?(\^)?(?:%([1-5](?:,[1-5])*))?$")


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
                   roll=bool(roll), finger=fl[i] if i < len(fl) else 0, tags=list(tags or []) + ([f"step{st}"]))
            out.append(s.notes[-1])
    return out


def octave_double(s: Score, bars, vel_drop=16, min_dur=0.5, skip=()):
    """Double the melody an octave below (RH thumb) in the given bars; notes shorter than min_dur beats
    (16th neighbours / turns) stay single."""
    out = []
    for n in [m for m in s.notes if m.voice == "mel"]:
        if s._bar_of(n.beat) in bars and round(n.beat, 3) not in skip and n.dur >= min_dur - 1e-6:
            s.notes.append(Note(n.pitch - 12, n.beat, n.dur, max(10, n.vel - vel_drop), "R", "inner", tags=["oct"]))
            out.append(s.notes[-1])
    return out


# ------------------------------------------------------------------------------------------
# melody velocity contour
# ------------------------------------------------------------------------------------------
def shape_melody(s: Score, bar0: int, bar1: int, base: int, slope=0.7, span=9, ramp=0.0):
    """Velocity = base + pitch arc (higher = louder, clipped) + weight for long/landing notes,
    lighter quick notes and pickups; optional linear ramp (velocity units over the range).
    Repeated 16ths on one key alternate strong/weak (a vocal flow, not a typewriter)."""
    b0, b1 = s.bar_start(bar0), s.bar_start(bar1 + 1)
    ms = sorted([n for n in s.notes if n.voice == "mel" and b0 <= n.beat < b1], key=lambda n: n.beat)
    if not ms:
        return
    center = sorted(n.pitch for n in ms)[len(ms) // 2]
    rep = 0
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
        prv = ms[i - 1] if i else None
        rep = rep + 1 if (prv and prv.pitch == n.pitch and n.beat - prv.beat < 0.6) else 0
        if rep % 2 == 1:                                   # 2nd / 4th strike of a repeated note: ghosted
            v -= 7
        if ramp:
            v += ramp * (n.beat - b0) / max(b1 - b0, 1e-9)
        n.vel = int(max(10, min(124, round(v))))


# ------------------------------------------------------------------------------------------
# post-performance helpers
# ------------------------------------------------------------------------------------------
def b2s_fn(s: Score):
    total = max(n.beat + n.dur for n in s.notes) + 8
    tb, ts = s._beat_to_sec_table(total)
    import numpy as np
    return lambda b: float(np.interp(b, tb, ts))


def straighten_kicks(s: Score, sections, voices=("bass", "ghost")):
    """Dilla layering: in swung sections the DSL delays every second 16th; keep the LH kick/ghost layer on the
    straight grid (shift those onsets/offsets back by the swing delay) while melody, hats and shells stay swung."""
    b2s = b2s_fn(s)
    moved = 0
    for n in s.notes:
        if n.hand != "L" or n.voice not in voices:
            continue
        sec = s._section_at(n.beat)
        if not sec or abs(sec.swing - 0.5) < 1e-6:
            continue
        g = sec.swing_grid
        f = (n.beat / g) % 1.0
        if abs(f - 0.5) > 1e-6:
            continue
        d = b2s(s._swing(n.beat)) - b2s(n.beat)
        if d > 0.002:
            n.t_on -= d
            n.t_off -= d
            moved += 1
            # the LH key before it (written to end on the swung 16th) now overlaps it: lift it in time
            for m in s.notes:
                if m.hand == "L" and m is not n and m.pitch != n.pitch and m.t_on < n.t_on < m.t_off                         and m.t_off - n.t_on < d + 0.02:
                    m.t_off = max(m.t_on + 0.03, n.t_on - 0.008)
    return moved


def apex_shape(s: Score, lo=112, hi=115, margin=4):
    """The one apex note (highest melody pitch) is the loudest note of the piece; every other note stays at
    least `margin` below it (judges: the D6 before the apex was louder than the F6)."""
    mel = [n for n in s.notes if n.voice == "mel"]
    apex = max(mel, key=lambda n: n.pitch)
    apex.vel = int(min(hi, max(lo, apex.vel)))
    capped = 0
    for n in s.notes:
        if n is not apex and n.vel > apex.vel - margin:
            n.vel = apex.vel - margin
            capped += 1
    return apex, capped


def final_pedal_ramp(s: Score, seconds=0.7, t_up=None):
    """The last pedal-up becomes a natural 0.7 s damper release (cosine), not a cut."""
    pc = s.pedal_curve
    if t_up is None:
        t_up = max(t for t, v in pc if v == 127)
    keep = [(t, v) for t, v in pc if t < t_up - 1e-6]
    ramp = [(round(t_up + seconds * k / 8, 4), int(round(127 * (0.5 + 0.5 * math.cos(math.pi * k / 8)))))
            for k in range(9)]
    s.pedal_curve = keep + ramp


def release_for_leaps(s, hand, near=7, far=12, gap_near=0.125, gap_far=0.25, keep_voices=(), min_hold_s=0.30,
                      span_lim=14):
    """Shorten key-holds so the hand is free before it must jump: a key still held when the same hand strikes a
    note more than `near` (`far`) semitones away is released gap_near (gap_far) beats before that onset.
    A bass key is never released before the legato pedal has re-caught (min_hold_s), so it is never cut dry.
    The sound is carried by the pedal; this is the true key/finger release for the animation."""
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
    """A key must rise before it can be struck again (by either hand)."""
    byp = {}
    for n in s.notes:
        byp.setdefault(n.pitch, []).append(n)
    for lst in byp.values():
        lst.sort(key=lambda n: n.t_on)
        for x, y in zip(lst, lst[1:]):
            if x.t_off > y.t_on - gap:
                x.t_off = max(x.t_on + 0.03, y.t_on - gap)


def voicing_pass(s, margin=12, window=0.08):
    """A pianist's voicing: anything struck with a melody note is kept >= margin below it; ghosts 18-32."""
    adj = 0
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.t_on)
    others = sorted([n for n in s.notes if n.voice != "mel"], key=lambda n: n.t_on)
    ts = [n.t_on for n in others]
    for m in mel:
        i = bisect.bisect_left(ts, m.t_on - window)
        while i < len(others) and others[i].t_on <= m.t_on + window:
            n = others[i]
            if n.vel > m.vel - margin:
                n.vel = max(8, m.vel - margin)
                adj += 1
            i += 1
    for n in s.notes:
        if n.voice == "ghost":
            n.vel = int(min(32, max(18, n.vel)))
    return adj


# ------------------------------------------------------------------------------------------
# fingering (Viterbi over key-down states, per hand, on the performed timeline)
# ------------------------------------------------------------------------------------------
_WI = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6]
MAXC = {(1, 2): 5, (1, 3): 7, (1, 4): 9, (1, 5): 12, (2, 3): 4, (2, 4): 5, (2, 5): 8, (3, 4): 3, (3, 5): 5, (4, 5): 3}
MAXP = {(1, 2): 8, (1, 3): 10, (1, 4): 12, (1, 5): 14, (2, 3): 5, (2, 4): 7, (2, 5): 10, (3, 4): 4, (3, 5): 7, (4, 5): 5}


def _wi(p):
    o, pc = divmod(p, 12)
    return o * 7 + _WI[pc]


LEGATO_OVERLAP = 0.03
PIN_LOG = []      # (hand, t, pins, what happened) - the fingering validator reports these
BREAK_LOG = []    # (hand, t, fingers) - states with no consistent predecessor (a finger would jump on a held key)


def assign_fingers(s: Score):
    PIN_LOG.clear()
    BREAK_LOG.clear()
    for hand in ("R", "L"):
        _finger_hand(s, hand)
    s._pin_log = list(PIN_LOG)
    s._break_log = [(h, t) for h, t, fs in BREAK_LOG]


def _finger_hand(s, hand):
    sg = 1 if hand == "R" else -1
    ns = sorted([n for n in s.notes if n.hand == hand], key=lambda n: (n.t_on, n.pitch))
    events = []
    for n in ns:
        if events and n.t_on - events[-1][0] < 0.03:
            events[-1][1].append(n)
        else:
            events.append([n.t_on, [n]])
    states_all, keys_all = [], []
    active = []
    for t, new in events:
        # a key released within 30 ms after the next onset is a legato overlap, not a held key (fix round 1: a 15 ms
        # overlap used to make the pinned fingers of the next note impossible, so every pin was dropped)
        active = [m for m in active if m.t_off > t + LEGATO_OVERLAP]
        keys = sorted(active + new, key=lambda m: sg * m.pitch)
        if len(keys) > 5:
            keys = sorted(new + active[-(5 - len(new)):] if len(new) < 5 else new[:5], key=lambda m: sg * m.pitch)
        keys_all.append(keys)
        active = active + new
    INF = 1e9
    prev = None
    trellis = []
    for ei, (t, new) in enumerate(events):
        keys = keys_all[ei]
        k = len(keys)
        newset = set(id(m) for m in new)
        cands = list(itertools.combinations(range(1, 6), k))
        pre = [(a, m.preset) for a, m in enumerate(keys) if getattr(m, "preset", 0)]
        if pre:
            ok = [fs for fs in cands if all(fs[a] == f for a, f in pre)]
            if not ok:          # keep at least the new notes' pins, and log what had to be dropped
                pre_new = [(a, f) for a, f in pre if id(keys[a]) in newset]
                ok = [fs for fs in cands if all(fs[a] == f for a, f in pre_new)]
                PIN_LOG.append((hand, t, [pname(keys[a].pitch) + f"%{f}" for a, f in pre],
                                "kept the new notes' pins" if ok else "dropped every pin"))
            cands = ok or cands
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
            # LH: a bass key under other held keys is the 5th finger; a tenor/counter key on top is the thumb side
            if hand == "L" and k >= 2:
                if keys[-1].pitch < 48 and keys[-1].voice == "bass" and fs[-1] != 5:
                    c += 1.2
                if keys[0].voice == "counter" and fs[0] > 2:
                    c += 1.5
            if hand == "L" and k == 1 and keys[0].voice == "counter" and fs[0] == 5:
                c += 0.8
            st_cost.append(c)
        anchors = [sum(sg * _wi(m.pitch) - (f - 1) for m, f in zip(keys, fs)) / k for fs in cands]
        row = []
        newkeys = [m for m in keys if id(m) in newset]
        for ci, fs in enumerate(cands):
            amap = {id(m): f for m, f in zip(keys, fs)}
            if prev is None:
                row.append((fs, st_cost[ci], -1, False))
                continue
            pkeys, pt = keys_all[ei - 1], events[ei - 1][0]
            dt = t - pt
            best, bi = INF, -1
            for pi, (pfs, pc, _, _b) in enumerate(prev):
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
                # same-finger travel speed (fix round 1): a finger that just played one key and must strike another
                # far away a moment later makes the hand jump (thumb G5 -> F4 in 160 ms)
                if dt < 0.5:
                    byf = {f: m for m, f in zip(pkeys, pfs)}
                    for m in newkeys:
                        o = byf.get(amap[id(m)])
                        if o is not None and o.pitch != m.pitch:
                            c += max(0, abs(o.pitch - m.pitch) - 2) * 0.6 * (0.25 / max(dt, 0.05))
                tot = pc + c
                if tot < best:
                    best, bi = tot, pi
            broken = bi < 0
            if broken:
                pi = min(range(len(prev)), key=lambda i: prev[i][1])
                best, bi = prev[pi][1] + 40, pi
            row.append((fs, best + st_cost[ci], bi, broken))
        trellis.append(row)
        prev = row
    if not trellis:
        return
    ci = min(range(len(trellis[-1])), key=lambda i: trellis[-1][i][1])
    total_cost = trellis[-1][ci][1]
    for ei in range(len(trellis) - 1, -1, -1):
        fs, _, bp, broken = trellis[ei][ci]
        if broken:
            BREAK_LOG.append((hand, events[ei][0], fs))
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
        c += 9.0 if (legato or dt < 0.3) else (2.5 if dt < 0.6 else 0.3)
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
        if len(g) == 2 and abs(g[0].pitch - g[1].pitch) in (7, 12):
            lo, hi = sorted(g, key=lambda n: n.pitch)
            lo.finger, hi.finger = 5, 1
        elif len(g) == 1:
            prev = groups[keys[i - 1]] if i else None
            nxt = groups[keys[i + 1]] if i + 1 < len(keys) else None
            # the upper key of a neighbouring octave is already under the thumb: stay there (fix round 1, build 50-51:
            # the thumb's C3 between C2-C3 octaves was forced onto 5, an octave hop on every 8th)
            near = [x for x, dk in ((prev, k - keys[i - 1] if i else 9), (nxt, keys[i + 1] - k if nxt else 9))
                    if x and dk < 1.01]
            if any(len(x) == 2 and max(m.pitch for m in x) == g[0].pitch
                   and abs(x[0].pitch - x[1].pitch) in (7, 12) for x in near):
                g[0].finger = 1
                continue
            step_in = prev and k - keys[i - 1] < 1.01 and abs(min(m.pitch for m in prev) - g[0].pitch) <= 2
            step_out = nxt and keys[i + 1] - k < 1.01 and len(nxt) == 1 and nxt[0].voice in ("bass", "ghost") \
                and 0 < nxt[0].pitch - g[0].pitch <= 2
            if not step_in and not step_out:
                g[0].finger = 5


def preset_octave_fingers(s: Score):
    """RH octave melody: thumb on the doubling, 5 on the tune; legato steps between octave tops alternate 4/5
    (pianist judge: D5 -> F5 both on 5, G5 -> F5 both on 4)."""
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.beat)
    octs = {round(n.beat, 4): n for n in s.notes if "oct" in n.tags}
    tops = []
    for m in mel:
        o = octs.get(round(m.beat, 4))
        if o is None or o.pitch != m.pitch - 12:
            tops.append(None)
            continue
        o.finger = o.finger or 1
        tops.append(m)
    # fingers pinned in the melody (%n) win (fix round 1: the 16th turns inside octave passages are pinned 4-5-4)
    fixed = {id(m): m.finger for m in tops if m is not None and m.finger}
    for a, b in zip(tops, tops[1:]):
        if a is None or b is None:
            continue
        legato = b.beat - (a.beat + a.dur) < 0.26 and 0 < abs(b.pitch - a.pitch) <= 5
        if not legato:
            continue
        fa, fb = (4, 5) if b.pitch > a.pitch else (5, 4)
        if (id(a) in fixed and fixed[id(a)] != fa) or (id(b) in fixed and fixed[id(b)] != fb):
            continue                         # the earlier pair / a pin wins; this step is a hand shift
        fixed[id(a)], fixed[id(b)] = fa, fb
    for m in tops:
        if m is not None:
            m.finger = fixed.get(id(m), 5)


def mark_presets(s: Score):
    for n in s.notes:
        n.preset = n.finger


# ------------------------------------------------------------------------------------------
# fix round 1: key-release air, pedal catch / acceleration, half-pedal helpers
# ------------------------------------------------------------------------------------------
SPAN = {"R": 14, "L": 16}
GROUP_TOL = 0.03


def onset_groups(ns, tol=GROUP_TOL):
    groups = []
    for n in sorted(ns, key=lambda n: n.t_on):
        if groups and n.t_on - groups[-1][0] < tol:
            groups[-1][1].append(n)
        else:
            groups.append([n.t_on, [n]])
    return groups


def hand_shift(n, grp, src=None):
    """How far the hand travels from key n to the keys of grp: the distance from n to the centre of the new keys
    (a hand leaving Ab3 for a Bb1-Bb2 octave moves about 16 semitones, not the 10 from Ab3 to Bb2). Fix round 2,
    session E: when n was struck inside a chord (src = n's onset group), the shift of the hand CENTRE counts too -
    the D3 of a [D3 F3 C4] shell is only 10 st from the centre of [Bb1 Bb2], but the hand moves 14 st."""
    c = sum(m.pitch for m in grp) / len(grp)
    d = abs(c - n.pitch)
    if src and len(src) > 1:
        d = max(d, abs(c - sum(m.pitch for m in src) / len(src)))
    return d


def src_groups(ns, win=0.10):
    """For hand_shift: id(note) -> the keys of that hand struck within `win` s of it (its chord, a roll included)."""
    ts = [m.t_on for m in ns]
    out = {}
    for n in ns:
        a, b = bisect.bisect_left(ts, n.t_on - win), bisect.bisect_right(ts, n.t_on + win)
        out[id(n)] = [m for m in ns[a:b] if abs(m.t_on - n.t_on) < win]
    return out


def jump_air(d):
    """(minimum, wanted) air for a hand shift of d semitones (research/music.md 5.11; fix round 2: >= 50 ms for
    shifts up to an octave, >= 100 ms for 13-24 st)."""
    return (0.05, 0.08) if d <= 12 else ((0.10, 0.14) if d <= 24 else (0.14, 0.30))


def pair_conflict(n, m, hand, lone=False):
    """Fix round 2 (pianist): can key n (finger n.finger) stay down while key m is struck with m.finger? No when the
    fingers are on the wrong side of each other (finger order against pitch order) - except a legato thumb pass of a
    lone key within a 4th - or when the two keys lie further apart than that finger pair spans comfortably (MAXC).
    Returns a short reason or None."""
    if not n.finger or not m.finger or m.pitch == n.pitch or m.finger == n.finger:
        return None
    sg = 1 if hand == "R" else -1
    dp = sg * (m.pitch - n.pitch)
    df = m.finger - n.finger
    d = abs(m.pitch - n.pitch)
    if dp * df < 0:
        if lone and 1 in (n.finger, m.finger) and d <= 5 and n.voice == m.voice and n.voice in ("mel", "counter"):
            return None                                # thumb under / finger over inside one legato line
        return "cross"
    pr = (min(n.finger, m.finger), max(n.finger, m.finger))
    # a held MELODY key may use the hand's full stretch (MAXP: the tune's legato, e.g. the coda's Db5 tied over the
    # bar line above G4 on 2-4); any other key goes when the pair is beyond its comfortable span (MAXC)
    if d > (MAXP if n.voice == "mel" else MAXC)[pr]:
        return "stretch"
    return None


def air_need(n, grp, held, hand, src=None):
    """(minimum, wanted) seconds of air between n's key release and the onset of grp (a later onset of the same
    hand), or None when n may stay down. A finger that strikes another key needs travel time (a slide by a semitone
    off a black key excepted); a hand that cannot keep n down together with the keys of grp must jump:
    <= 12 st 50 ms (want 80), 13-24 st 100 ms (want 140), > 24 st 140 ms (want 300, research/music.md 5.11).
    Fix round 2 (pianist): the decision is finger-aware - n must also go when its finger would end up on the wrong
    side of a new key's finger or further from it than that finger pair spans comfortably (pair_conflict); the
    span-only rule let D3 (finger 4) stay down while the thumb landed a third below it on Bb2."""
    need = None
    for m in grp:
        if m.pitch == n.pitch:
            continue                                   # a repeated key: fix_key_repeats
        if n.finger and m.finger == n.finger:
            d = abs(m.pitch - n.pitch)
            if d == 1 and n.pitch % 12 in BLACK and m.pitch % 12 not in BLACK:
                continue                               # a slide off a black key onto its white neighbour
            mn = min(0.10, 0.035 + 0.005 * d)
            need = max(need or (0.0, 0.0), (mn, mn + 0.02))
    lone = len(grp) == 1 and not held
    if any(pair_conflict(n, m, hand, lone) for m in grp):
        need = max(need or (0.0, 0.0), jump_air(hand_shift(n, grp, src)))
    others = [m.pitch for m in held] + [m.pitch for m in grp]
    ps = others + [n.pitch]
    if others and (max(ps) - min(ps) > SPAN[hand] or len(set(ps)) > 5) and \
            not (max(others) - min(others) > SPAN[hand] and min(others) <= n.pitch <= max(others)):
        need = max(need or (0.0, 0.0), jump_air(hand_shift(n, grp, src)))
    return need


def pedal_points(s):
    return [(float(t), float(v)) for t, v in s.pedal_curve]


def catch_time(pc, t_on, lo=40, back=50):
    """If a damper clear (CC64 < lo) starts within 50 ms before .. 350 ms after t_on, the time the pedal is back
    (>= back) after it: a key struck there must stay down until then or its string is damped."""
    for j, (t, v) in enumerate(pc):
        if t < t_on - 0.05:
            continue
        if t > t_on + 0.35:
            return None
        if v < lo:
            for t2, v2 in pc[j:]:
                if v2 >= back:
                    return t2
            return None
    return None


def accelerate_change(s, t_on):
    """Re-time the legato change that clears near t_on to +25 / +80 / +150 ms (research/music.md 5.9, the timing
    for fast changes) so an early-released bass key is still caught. Returns the new catch time or None."""
    pc = s.pedal_curve
    for j0 in range(len(pc) - 4):
        t0 = pc[j0][0]
        if t0 < t_on - 0.05 or t0 > t_on + 0.30:
            continue
        tc = t0 - 0.035
        offs = [round(pc[j0 + k][0] - tc, 3) for k in range(5)]
        if abs(offs[1] - 0.075) < 0.004 and abs(offs[4] - 0.25) < 0.004 and pc[j0 + 1][1] < 40:
            hi, back = pc[j0][1], pc[j0 + 4][1]
            pc[j0:j0 + 5] = [(round(tc + 0.025, 4), hi), (round(tc + 0.055, 4), 18), (round(tc + 0.08, 4), 0),
                             (round(tc + 0.11, 4), 0), (round(tc + 0.15, 4), back)]
            return tc + 0.15
    return None


def air_pass(s):
    """True key releases for the animation (fix round 1): every key is let go early enough for its finger / hand to
    travel to the next key it must strike (see air_need). The sound is carried by the pedal; a key struck on a
    pedal change is never released before the pedal has caught it - where that would leave too little air, the
    change itself is re-timed to catch at +150 ms. Returns (shortened, accelerated changes)."""
    short, acc = 0, 0
    for hand in "LR":
        ns = sorted([n for n in s.notes if n.hand == hand], key=lambda n: n.t_on)
        groups = onset_groups(ns)
        gts = [g[0] for g in groups]
        src_of = src_groups(ns)
        for n in ns:
            i = bisect.bisect_right(gts, n.t_on + GROUP_TOL - 1e-9)
            target = None
            while i < len(groups) and groups[i][0] < n.t_off + 0.31:
                gt, grp = groups[i]
                held = [m for m in ns if m is not n and m not in grp and m.t_on < gt - GROUP_TOL
                        and m.t_off > gt + GROUP_TOL]
                need = air_need(n, grp, held, hand, src_of.get(id(n)))
                if need:
                    target = (gt, need)
                    break
                i += 1
            if not target:
                continue
            gt, (mn, want) = target
            if "dry" in n.tags:
                want = mn
            if n.t_off <= gt - want + 1e-4:
                continue
            floor = n.t_on + max(0.05, min(0.12, 0.4 * (n.t_off - n.t_on)))
            c = catch_time(pedal_points(s), n.t_on)
            if c is not None and n.t_off >= c and "dry" not in n.tags:
                if c + 0.015 > gt - want:          # the slow catch costs air the hand wants: use the fast change
                    c2 = accelerate_change(s, n.t_on)
                    if c2 is not None:
                        acc += 1
                        c = c2
                floor = max(floor, c + 0.015)
            new = max(floor, gt - want)
            if new < n.t_off - 1e-4:
                n.t_off = new
                short += 1
    return short, acc


def cap_pedal(s, t0, t1, level):
    """Groove half-pedal: inside [t0, t1) the pedal goes down only to `level` (the sampler's half-pedal zone)."""
    s.pedal_curve = [(t, min(v, level)) if t0 <= t < t1 else (t, v) for t, v in s.pedal_curve]


def flutter(s, t, depth=46, hold=0.10):
    """A half-pedal flutter at t: the dampers touch the strings lightly (CC64 `depth`, inside 32-76) for `hold`
    seconds - released treble strings are damped, the bass rings on."""
    import numpy as np
    pc = s.pedal_curve
    cur = float(np.interp(t, [p[0] for p in pc], [p[1] for p in pc]))
    keep = [p for p in pc if not (t - 1e-6 <= p[0] <= t + hold + 0.12)]
    s.pedal_curve = sorted(keep + [(round(t, 4), int(cur)), (round(t + 0.04, 4), depth),
                                   (round(t + 0.04 + hold, 4), depth), (round(t + 0.10 + hold, 4), int(cur))])
