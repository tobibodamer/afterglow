"""Validators for the definitive Afterglow score (run on a performed Score). Each returns (issues, info).

Ported from the winning candidate's checks.py (playability, melody, structure, groove, texture, voice leading) and
extended for the judges' findings:
  sounding()       - one physical model of "what still sounds": key held, or released while the dampers are lifted
                     and not cleared since (fixes the old pedal-mud blind spot: keys held THROUGH a pedal change)
  pedal_mud()      - low-interval-limit mud among everything sounding, at every onset
  pedal_policy()   - full damper dips per bar, non-harmonic dips, dry lifts only where allowed, dip spacing
  clashes()        - melody m2 / m9 against still-ringing accompaniment (each must be explained in INTENDED)
  arrivals()       - the drops' real silence, the apex (once, loudest, 75-82 %), the final ring
  density()        - notes / second per section (the chorus must lift over the verse before it, etc.)
  fingering()      - same finger on consecutive keys of a line, LH tenor/counter on the thumb side, long-finger
                     crossings in fast lines (fix round 1)
  originality()    - interval n-grams against the openings of a few famous tunes
Fix round 1 (the animation's physical truth and the reviewers' findings):
  Sound            - continuous damper model (half pedal, flutters) + the old clear convention
  key_air()        - key release -> next onset that needs the finger / makes the hand jump (35-140 ms minimums)
  finger_travel()  - same-finger air per semitone, and no finger jumping >= 8 st within 250 ms
  finger_order()   - fingers follow pitch among the keys held together
  finger_pins()    - pinned fingers the solver had to drop, and broken (inconsistent) states
  pedal_clusters() - semitone pairs (v >= 60, above C4) ringing together by the pedal for a beat or more
  arrivals()       - also: each arrival downbeat beats the melody peak / LH / energy before it; the climax is a new high
"""
from __future__ import annotations

import bisect

import numpy as np

from afterglow_lib import pname, BLACK, air_need, onset_groups, GROUP_TOL, LEGATO_OVERLAP, hand_shift, src_groups

# low interval limits (semitones -> lowest allowed bottom note), research/music.md 5.11 (P5 included)
LIL = {1: 52, 2: 51, 3: 48, 4: 46, 5: 46, 6: 47, 7: 34, 8: 41, 9: 41, 10: 41, 11: 41, 13: 40, 14: 39, 15: 31, 16: 29}


def _held_at(ns, t, eps=0.03):
    return [m for m in ns if m.t_on <= t + eps and m.t_off > t + eps]


# the sampler's damper model (music/sampler.py Config): T60 of a damped string per key, the half-pedal zone
DAMP_KEYS = (21, 36, 48, 60, 72, 84, 88)
DAMP_T60 = (1.8, 1.2, 0.8, 0.55, 0.40, 0.30, 0.26)
PEDAL_LO, PEDAL_HI, DAMPER_TOP = 32.0, 76.0, 87


class Sound:
    """What is still sounding at time t. Fix round 1: the sampler's continuous damper model. A released key's string
    decays at the damper rate x (1 - lift), lift = smoothstep((CC64 - 32) / 44) (half pedal, flutters and full clears
    alike); the note counts as sounding until it has fallen `db` dB (default 20) after its key release. Keys above
    E6 have no dampers. Notes struck more than `decay_s` ago are treated as gone. end_binary() is the old model (key
    up with CC64 < 64, or the next CC64 < 40 clear) - used for the drops' silence."""

    def __init__(self, s, decay_s=4.0, clear_below=40, db=20.0, step=0.005):
        self.s = s
        pc = np.array(s.pedal_curve, dtype=float)
        self.pc = pc
        self.clears = [pc[i, 0] for i in range(1, len(pc)) if pc[i, 1] < clear_below <= pc[i - 1, 1]]
        self.ns = sorted(s.notes, key=lambda n: n.t_on)
        self.ts = [n.t_on for n in self.ns]
        self.decay = decay_s
        self.db = db
        t_end = max(n.t_off for n in s.notes) + 12.0
        self.grid = np.arange(0.0, t_end, step)
        cc = np.interp(self.grid, pc[:, 0], pc[:, 1]) if len(pc) else np.zeros_like(self.grid)
        x = np.clip((cc - PEDAL_LO) / (PEDAL_HI - PEDAL_LO), 0.0, 1.0)
        lift = x * x * (3 - 2 * x)
        self.lift = lift
        self.C = np.concatenate([[0.0], np.cumsum((1.0 - lift) * step)])[:-1]   # integral of the damping share
        self._end = {}

    def ped(self, t):
        return float(np.interp(t, self.pc[:, 0], self.pc[:, 1])) if len(self.pc) else 0.0

    def lift_at(self, t):
        return float(np.interp(t, self.grid, self.lift))

    def t60(self, p):
        return float(np.interp(p, DAMP_KEYS, DAMP_T60))

    def end(self, n):
        """Time the note stops sounding: the earlier of (a) `db` dB of decay after the key release under the
        continuous damper model (half pedal, flutters) and (b) the next full clear (CC64 < 40; a key released with
        CC64 < 40 ends at once) - the convention the mud / clash rules were written for."""
        k = id(n)
        if k in self._end:
            return self._end[k]
        if n.pitch > DAMPER_TOP:
            e = n.t_off + 3.0
        else:
            need = self.t60(n.pitch) * self.db / 60.0        # damping-time integral to fall `db` dB
            c0 = float(np.interp(n.t_off, self.grid, self.C))
            i = int(np.searchsorted(self.C, c0 + need))
            e = float(self.grid[i]) if i < len(self.grid) else n.t_off + 12.0
            if self.ped(n.t_off) < 40:
                e = n.t_off
            else:
                j = bisect.bisect_right(self.clears, n.t_off)
                if j < len(self.clears):
                    e = min(e, self.clears[j])
            e = max(e, n.t_off)
        self._end[k] = e
        return e

    def end_binary(self, n):
        """The old two-state model (silence measurements): key up with CC64 < 64 ends the note; otherwise the next
        CC64 < 40 clear does."""
        if self.ped(n.t_off) < 64 or n.pitch > 87:
            return n.t_off if n.pitch <= 87 else n.t_off + 3.0
        i = bisect.bisect_right(self.clears, n.t_off)
        return self.clears[i] if i < len(self.clears) else n.t_off + 6.0

    def at(self, t):
        i = bisect.bisect_right(self.ts, t)
        out = []
        for n in self.ns[:i]:
            if t - n.t_on > self.decay:
                continue
            if n.t_off > t or self.end(n) > t:
                out.append(n)
        return out


# ---------------------------------------------------------------------------------------------------------------
def playability(s):
    iss, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    byh = {h: [n for n in ns if n.hand == h] for h in "LR"}
    for hand, lim in (("R", 14), ("L", 16)):
        hs = byh[hand]
        for n in hs:
            held = _held_at(hs, n.t_on) + [n]
            ps = sorted(set(m.pitch for m in held))
            sp = ps[-1] - ps[0]
            if sp > lim:
                iss.append(f"SPAN {hand} t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: {pname(ps[0])}..{pname(ps[-1])} = {sp} st")
            elif hand == "L" and sp >= 15:
                together = [m for m in held if abs(m.t_on - n.t_on) < 0.03]
                tp = [m.pitch for m in together]
                if len(tp) > 1 and max(tp) - min(tp) >= 15 and not any(m.roll for m in together):
                    iss.append(f"SPAN-L struck 10th t={n.t_on:6.2f} bar {s._bar_of(n.beat)} (15-16 st must be rolled)")
            if len(ps) > 5:
                iss.append(f"KEYS {hand} t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: {len(ps)} keys held")
    for n in ns:
        other = byh["R" if n.hand == "L" else "L"]
        h = _held_at(other, n.t_on) + [m for m in other if abs(m.t_on - n.t_on) < 0.03]
        if not h:
            continue
        if n.hand == "L" and n.pitch >= min(m.pitch for m in h):
            iss.append(f"CROSS t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: LH {pname(n.pitch)} >= RH {pname(min(m.pitch for m in h))}")
        if n.hand == "R" and n.pitch <= max(m.pitch for m in h):
            iss.append(f"CROSS t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: RH {pname(n.pitch)} <= LH {pname(max(m.pitch for m in h))}")
    for hand in "LR":
        groups = []
        for n in byh[hand]:
            if groups and n.t_on - groups[-1][0] < 0.04:
                groups[-1][1].append(n.pitch)
            else:
                groups.append([n.t_on, [n.pitch]])
        for (t0, a), (t1, b) in zip(groups, groups[1:]):
            jump = abs((min(b) + max(b)) / 2 - (min(a) + max(a)) / 2)
            dt = t1 - t0
            if (jump > 24 and dt < 0.30) or (jump > 12 and dt < 0.14):
                iss.append(f"LEAP {hand} t={t0:6.2f}->{t1:6.2f}: {jump:.0f} st in {dt * 1000:.0f} ms")
    seen = set()
    for n in ns:
        if n.pitch >= 60:
            continue
        snd = [m for m in ns if abs(m.t_on - n.t_on) < 0.06 or (m.t_on < n.t_on < m.t_off - 0.02)]
        ps = sorted(set(m.pitch for m in snd))
        for a, b in zip(ps, ps[1:]):
            iv = b - a
            if iv in LIL and a < LIL[iv] and (a, b, s._bar_of(n.beat)) not in seen:
                seen.add((a, b, s._bar_of(n.beat)))
                iss.append(f"MUD t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: {pname(a)}-{pname(b)} ({iv} st) below {pname(LIL[iv])}")
    nof = [n for n in ns if not 1 <= n.finger <= 5]
    if nof:
        iss.append(f"FINGER missing on {len(nof)} notes")
    for hand in "LR":
        hs = byh[hand]
        for n in hs:
            for m in _held_at(hs, n.t_on):
                if m is not n and m.finger == n.finger and m.pitch != n.pitch:
                    iss.append(f"FINGER conflict {hand} t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: finger {n.finger} on "
                               f"{pname(m.pitch)} (held) and {pname(n.pitch)}")
    mel = sorted([n for n in ns if n.voice == "mel"], key=lambda n: n.t_on)
    thumb_black = 0
    for a, b, c in zip(mel, mel[1:], mel[2:]):
        if b.finger == 1 and b.pitch % 12 in BLACK and abs(b.pitch - a.pitch) <= 2 and abs(c.pitch - b.pitch) <= 2 \
                and b.t_on - a.t_on < 0.4 and c.t_on - b.t_on < 0.4 and b.pitch != a.pitch:
            thumb_black += 1
            iss.append(f"THUMB on black key in a stepwise run t={b.t_on:6.2f} bar {s._bar_of(b.beat)} {pname(b.pitch)}")
    info.append(f"fingers: {sum(1 for n in ns if 1 <= n.finger <= 5)}/{len(ns)} notes fingered; RH thumb-on-black-in-run: {thumb_black}")
    return iss, info


def fingering(s):
    """Same finger on two different consecutive keys of one line within 0.30 s (a legato step the hand cannot
    connect), and LH tenor/counter notes taken by the 5th finger while a lower LH key is down."""
    iss, info = [], []
    obeat = {(round(n.beat, 4), n.pitch + 12) for n in s.notes if "oct" in n.tags}
    octs = {id(n) for n in s.notes if n.voice == "mel" and (round(n.beat, 4), n.pitch) in obeat}
    for hand in "LR":
        line = sorted([n for n in s.notes if n.hand == hand], key=lambda n: (n.t_on, -n.pitch))
        # line = melody (RH) / single-note groups (LH)
        if hand == "R":
            seq = [n for n in line if n.voice == "mel"]
        else:
            groups = {}
            for n in line:
                groups.setdefault(round(n.t_on, 2), []).append(n)
            seq = [g[0] for k, g in sorted(groups.items()) if len(g) == 1 and g[0].voice in ("counter", "acc", "bass")]
        for a, b in zip(seq, seq[1:]):
            dt = b.t_on - a.t_on
            slide = b.pitch - a.pitch in (1, -1) and a.pitch % 12 in BLACK and b.pitch % 12 not in BLACK
            if a.finger == b.finger and a.pitch != b.pitch and dt < 0.30 and abs(a.pitch - b.pitch) <= 4 \
                    and a.t_off > b.t_on - 0.08 and not slide:
                iss.append(f"SAME-FINGER {hand} t={b.t_on:6.2f} bar {s._bar_of(b.beat)}: {pname(a.pitch)} -> "
                           f"{pname(b.pitch)} both finger {a.finger}")
            # fix round 1: a fast line never crosses two long fingers (5 -> 4 upward, 4 -> 5 downward, ...): only the
            # thumb passes under / is passed over. In octave passages the whole hand shifts with the thumb on every
            # doubled note, so 4 / 5 on the top are a hand shift there, not a crossing
            sec = s._section_at(b.beat)
            # a detached hand shift between 8ths of a swung groove line is idiomatic (the key is let go, the hand
            # moves): allowed when there is >= 25 ms of air and an 8th of time
            shift = sec is not None and sec.swing > 0.5 and dt >= 0.30 and b.t_on - a.t_off >= 0.025
            if dt < 0.50 and a.finger != 1 and b.finger != 1 and a.pitch != b.pitch and not shift \
                    and not (hand == "R" and (id(a) in octs or id(b) in octs)):
                up = (b.pitch - a.pitch) * (1 if hand == "R" else -1) > 0
                if (up and b.finger < a.finger) or (not up and b.finger > a.finger):
                    iss.append(f"FINGER-CROSS {hand} t={b.t_on:6.2f} bar {s._bar_of(b.beat)}: {pname(a.pitch)} "
                               f"({a.finger}) -> {pname(b.pitch)} ({b.finger}) within {1000 * dt:.0f} ms")
    lh = sorted([n for n in s.notes if n.hand == "L"], key=lambda n: n.t_on)
    bad = 0
    for n in lh:
        if n.voice != "counter":
            continue
        lower = [m for m in _held_at(lh, n.t_on) if m.pitch < n.pitch and m is not n]
        if lower and n.finger >= 4:
            bad += 1
            iss.append(f"TENOR-FINGER t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: counter {pname(n.pitch)} on finger "
                       f"{n.finger} above held {pname(lower[0].pitch)}")
    oct_tops = [n for n in s.notes if n.voice == "mel"]
    info.append(f"LH counter notes above a held key on fingers 4-5: {bad}")
    return iss, info


# ---------------------------------------------------------------------------------------------------------------
def melody(s, sections):
    iss, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    acc = [n for n in ns if n.voice != "mel"]
    weak, worst = 0, 99
    ts = [n.t_on for n in acc]
    for n in mel:
        i = bisect.bisect_left(ts, n.t_on - 0.05)
        others = []
        while i < len(acc) and acc[i].t_on <= n.t_on + 0.05:
            others.append(acc[i].vel)
            i += 1
        if others:
            d = n.vel - max(others)
            worst = min(worst, d)
            if d < 12:
                weak += 1
                iss.append(f"PROMINENCE t={n.t_on:6.2f} bar {s._bar_of(n.beat)} mel {pname(n.pitch)} v{n.vel} vs acc v{max(others)}")
    info.append(f"melody prominence: worst margin {worst} (need >= 12), weak onsets {weak}")
    for n in mel:
        for m in acc:
            if m.t_on > n.t_off or m.t_off < n.t_on:
                continue
            ov = min(n.t_off, m.t_off) - max(n.t_on, m.t_on)
            if ov > 0.03 and m.pitch >= n.pitch:
                iss.append(f"NOT ON TOP t={max(n.t_on, m.t_on):6.2f} bar {s._bar_of(n.beat)}: {m.voice} {pname(m.pitch)} >= mel {pname(n.pitch)}")
            elif ov > 0.03 and m.hand == "R" and 0 < n.pitch - m.pitch < 3:
                iss.append(f"RUB t={max(n.t_on, m.t_on):6.2f} bar {s._bar_of(n.beat)}: RH {m.voice} {pname(m.pitch)} < 3 st under mel {pname(n.pitch)}")
    msb = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.beat)
    bars = sorted(set(s._bar_of(n.beat) for n in msb))
    for b in bars:
        b0, b1 = s.bar_start(b), s.bar_start(b + 1)
        ov = [n for n in msb if n.beat < b1 - 1e-6 and n.beat + n.dur > b0 + 1e-6]
        ok = any(n.dur >= 1.5 - 1e-6 for n in ov)
        cur = b0
        for n in ov:
            if n.beat - cur >= 0.5 - 1e-6:
                ok = True
            cur = max(cur, n.beat + n.dur)
        if b1 - cur >= 0.5 - 1e-6:
            ok = True
        if not ok:
            iss.append(f"BREATH bar {b}: no rest >= 1/2 beat and no note >= 1.5 beats")
    run = 1
    for a, b in zip(mel, mel[1:]):
        run = run + 1 if a.vel == b.vel else 1
        if run > 4:
            iss.append(f"VEL-REPEAT t={b.t_on:6.2f}: >4 equal melody velocities")
    for sec in sections:
        m = [n for n in mel if sec["b0"] <= n.beat < sec["b1"]]
        if not m:
            continue
        vr = max(n.vel for n in m) - min(n.vel for n in m)
        if vr < 12:
            iss.append(f"DYN-RANGE {sec['name']}: melody velocity range {vr} < 12")
        lo, hi = sec.get("mel_range", (None, None))
        if lo and (min(n.pitch for n in m) < lo or max(n.pitch for n in m) > hi):
            iss.append(f"REGISTER {sec['name']}: melody {pname(min(n.pitch for n in m))}-{pname(max(n.pitch for n in m))} outside {pname(lo)}-{pname(hi)}")
    # repeated-note "typewriter": > 3 strikes of one key in a row at 16th spacing
    run = 1
    for a, b in zip(mel, mel[1:]):
        run = run + 1 if (a.pitch == b.pitch and b.beat - a.beat < 0.3) else 1
        if run > 3:
            iss.append(f"TYPEWRITER bar {s._bar_of(b.beat)}: {run} repeated 16ths on {pname(b.pitch)}")
    # octave doubling of notes shorter than an 8th (judges: m2 smear in two octaves)
    octs = [n for n in s.notes if "oct" in n.tags and n.dur < 0.5 - 1e-6]
    if octs:
        iss.append(f"OCTAVE-16THS: {len(octs)} melody 16ths doubled at the octave")
    return iss, info


# ---------------------------------------------------------------------------------------------------------------
def structure(s, sections, changes, drops, lift_at_change=()):
    """changes: list of (abs beat, chord symbol, section name)."""
    iss, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    dur = max(n.t_off for n in ns)
    info.append(f"duration to last note-off: {dur:.2f}s = {int(dur // 60)}:{dur % 60:04.1f}")
    if not 200 <= dur <= 230:
        iss.append(f"DURATION {dur:.1f}s outside 3:20-3:50")
    top = max(n.pitch for n in mel)
    tops = [n for n in mel if n.pitch == top]
    frac = tops[0].t_on / dur
    sec_of = lambda n: next((x["name"] for x in sections if x["b0"] <= n.beat < x["b1"]), "?")
    info.append(f"apex {pname(top)} x{len(tops)} at {tops[0].t_on:.1f}s = {frac * 100:.1f}% ({sec_of(tops[0])})")
    if len(tops) != 1 or not 0.75 <= frac <= 0.82 or sec_of(tops[0]) != "climax":
        iss.append("APEX must occur once, in the climax, at 75-82 % of the duration")
    loudest = max(s.notes, key=lambda n: n.vel)
    second = max((n.vel for n in s.notes if n is not tops[0]), default=0)
    info.append(f"apex velocity {tops[0].vel}; loudest other note {second}")
    if loudest is not tops[0] or tops[0].vel - second < 4:
        iss.append(f"APEX not the single loudest note (apex v{tops[0].vel}, next v{second})")
    vmax = {x["name"]: max([n.vel for n in mel if x["b0"] <= n.beat < x["b1"]] or [0]) for x in sections}
    loud = max(vmax, key=vmax.get)
    info.append("melody max velocity per section: " + ", ".join(f"{k} {v}" for k, v in vmax.items()))
    if loud != "climax":
        iss.append(f"LOUDEST section is {loud}, not the climax")
    gh = [n for n in ns if n.voice == "ghost"]
    bad = [n for n in gh if not 18 <= n.vel <= 32]
    info.append(f"ghost notes: {len(gh)}, velocity {min([n.vel for n in gh] or [0])}-{max([n.vel for n in gh] or [0])}")
    if bad:
        iss.append(f"GHOST velocity outside 18-32 on {len(bad)} notes")
    pc = np.array(s.pedal_curve, dtype=float)
    ped = lambda t: float(np.interp(t, pc[:, 0], pc[:, 1])) if len(pc) else 0.0
    marks = {round(b, 4): k for b, k in s.pedal_marks}
    ch_t = []
    for b, sym, sec in changes:
        k = marks.get(round(b, 4))
        if k not in ("change", "down", "up"):
            iss.append(f"PEDAL no change marked at bar {s._bar_of(b)} beat {b - s.bar_start(s._bar_of(b)) + 1:g} ({sym})")
        t = s._b2s(b)
        ch_t.append(t)
        win = [ped(t + k_ * 0.01) for k_ in range(0, 31)]
        if min(win) > 10:
            iss.append(f"PEDAL blur: not lifted after the change at bar {s._bar_of(b)} ({sym})")
    ch_t = sorted(ch_t)
    dry = 0
    for n in ns:
        if n.voice != "bass" or "dry" in n.tags:
            continue
        nxt = [t for t in ch_t if t > n.t_on + 0.05]
        # CC64 >= 50 carries a released bass (the choruses' groove half pedal: a bass string's damped T60 there is
        # about 3-4 s, and the bass is re-struck every 1-2 s)
        if nxt and n.t_off < nxt[0] - 0.08 and ped(n.t_off) < 50 and not any(d0 <= n.beat < d1 for d0, d1 in drops):
            dry += 1
            iss.append(f"PEDAL dry bass release t={n.t_off:6.2f} bar {s._bar_of(n.beat)} {pname(n.pitch)} (pedal {ped(n.t_off):.0f})")
    info.append(f"pedal: {len(changes)} harmony changes, {len(s.pedal_marks)} marks, early-released bass not caught: {dry}")
    return iss, info


def pedal_policy(s, changes, dry_bars, recatch):
    """Full damper dips (CC64 falling below 40) per bar. Rules from the judges: one change per harmony; a
    non-harmonic dip (re-catch or dry lift) at most once per bar; dry lifts only in dry_bars; no two dips closer
    than 0.45 s; total dips per bar <= max(2, harmony changes in the bar)."""
    iss, info = [], []
    pc = s.pedal_curve
    dips = [pc[i][0] for i in range(1, len(pc)) if pc[i][1] < 40 <= pc[i - 1][1]]
    ch_bars = {}
    for b, sym, sec in changes:
        ch_bars.setdefault(s._bar_of(b), []).append(b)
    tl = s.timeline["bars"]
    bar_t = [x["t"] for x in tl]

    def bar_at(t):
        return max(1, bisect.bisect_right(bar_t, t + 1e-6))
    per = {}
    for t in dips:
        per.setdefault(bar_at(t - 0.02), []).append(t)
    worst = []
    rc_bars = {b for b, bt in recatch}
    last_bar = s._last_bar()
    for bar, ts in sorted(per.items()):
        if bar > last_bar:            # the final damper release ramp after the last bar
            continue
        nh = len(ch_bars.get(bar, []))
        # dips within 0.2 s after a harmony change of this bar are that change
        harm_t = [s._b2s(b) for b in ch_bars.get(bar, [])]
        non = [t for t in ts if not any(-0.05 <= t - h <= 0.25 for h in harm_t)]
        if len(non) > 1:
            iss.append(f"PEDAL-FLUTTER bar {bar}: {len(non)} non-harmonic dips")
        if non and bar not in dry_bars and bar not in rc_bars:
            iss.append(f"PEDAL extra dip in bar {bar} (not a harmony change, fill, drop or re-catch)")
        if len(ts) > max(2, nh) + (1 if bar in dry_bars or bar in rc_bars else 0):
            iss.append(f"PEDAL bar {bar}: {len(ts)} dips for {nh} harmony changes")
        worst.append(len(ts))
    for a, b in zip(dips, dips[1:]):
        if b - a < 0.45:
            iss.append(f"PEDAL dips {1000 * (b - a):.0f} ms apart at t={a:.2f} (bar {bar_at(a)})")
    # dry time inside groove choruses
    for name in ("chorus1", "chorus2", "climax"):
        sec = next(x for x in s.timeline["sections"] if x["name"] == name)
        t0, t1 = sec["t_start"], sec["t_end"]
        tt = np.linspace(t0, t1, 4000)
        v = np.interp(tt, [p[0] for p in pc], [p[1] for p in pc])
        info.append(f"pedal {name}: dampers on the strings (CC<40) {100 * np.mean(v < 40):.1f}% of the time, "
                    f"half pedal (40-75) {100 * np.mean((v >= 40) & (v < 76)):.1f}%, fully lifted (>=76) "
                    f"{100 * np.mean(v >= 76):.1f}%, {sum(1 for t in dips if t0 <= t < t1) / max(1e-9, t1 - t0):.2f} "
                    f"dips/s")
    info.append(f"pedal dips per bar (bars with dips): max {max(worst)}, mean {np.mean(worst):.2f}; total dips {len(dips)}")
    return iss, info


# ---------------------------------------------------------------------------------------------------------------
def groove(s, sections, chorus_names=("chorus1", "chorus2", "climax")):
    iss, info = [], []
    beats_t = s.timeline["beats"]
    fer = sorted(b for b, _ in s.fermatas)
    for sec in sections:
        if not sec.get("groove"):
            continue
        k0, k1 = int(sec["b0"]), int(sec["b1"])
        bpms = []
        for k in range(k0, k1 - 1):
            if any(k - 1 <= f < k + 1.01 for f in fer):
                continue
            bpms.append(60.0 / (beats_t[k + 1] - beats_t[k]))
        if bpms:
            med = float(np.median(bpms))
            dev = max(abs(b - med) / med for b in bpms)
            info.append(f"tempo {sec['name']}: median {med:.2f} bpm, max deviation {dev * 100:.2f}%")
            if dev > 0.012:
                iss.append(f"TEMPO {sec['name']}: deviation {dev * 100:.2f}% > 1%")
    for sec in sections:
        if sec["name"] not in chorus_names:
            continue
        b = s._bar_of(sec["b0"])
        while s.bar_start(b) < sec["b1"] - 1e-6:
            cnt = 0
            for bb in (b, b + 1):
                e = s.bar_start(bb + 1)
                cnt += sum(1 for n in s.notes if e - 0.5 - 1e-6 <= n.beat < e - 1e-6 and n.beat + n.dur > e + 1e-3)
                cnt += sum(1 for n in s.notes if n.voice == "mel" and abs((n.beat - s.bar_start(bb)) % 1 - 0.5) < 1e-6
                           and n.dur >= 1.0)
            if cnt == 0:
                iss.append(f"ANTICIPATION none in bars {b}-{b + 1} ({sec['name']})")
            b += 2
    # micro-timing: measured offsets of the layers in the groove sections (vs the straight grid)
    for sec in sections:
        if not sec.get("groove"):
            continue
        out = {}
        for n in s.notes:
            if not (sec["b0"] <= n.beat < sec["b1"]):
                continue
            f = (n.beat * 4) % 2
            key = (n.voice, "on" if abs(f) < 1e-6 or abs(f - 2) < 1e-6 else ("off16" if abs(f - 1) < 1e-6 else "x"))
            out.setdefault(key, []).append(n.t_on - s._b2s(n.beat))
        parts = [f"{v}/{p} {1000 * np.median(x):+.0f}ms" for (v, p), x in sorted(out.items())
                 if p != "x" and len(x) >= 3]
        info.append(f"micro-timing {sec['name']}: " + ", ".join(parts))
    return iss, info


def texture(s, sections, bass_sections=("verse1", "pre1", "verse2", "pre2"), changes=()):
    iss, info = [], []
    lhn = sorted([n for n in s.notes if n.hand == "L"], key=lambda n: (n.beat, n.pitch))
    last = s._last_bar()

    def sig(b):
        b0, b1 = s.bar_start(b), s.bar_start(b + 2)
        return tuple((round(n.beat - b0, 3), n.pitch, round(n.dur, 3)) for n in lhn if b0 <= n.beat < b1)
    run, maxrun = 1, 1
    for b in range(1, last - 2, 2):
        if sig(b) and sig(b) == sig(b + 2):
            run += 1
            if run > 3:
                iss.append(f"LOOP LH 2-bar segment repeats verbatim >3x ending bar {b + 3}")
        else:
            run = 1
        maxrun = max(maxrun, run)
    info.append(f"longest verbatim 2-bar LH repetition: {maxrun}x")
    rhythms = set()
    for b in range(1, last + 1):
        b0, b1 = s.bar_start(b), s.bar_start(b + 1)
        rhythms.add(tuple(sorted(set(round(n.beat - b0, 3) for n in lhn if b0 <= n.beat < b1))))
    info.append(f"distinct one-bar LH onset rhythms: {len(rhythms)} in {last} bars")
    inner = sorted([n for n in s.notes if n.voice in ("acc", "inner", "counter") and "oct" not in n.tags],
                   key=lambda n: n.beat)
    groups = {}
    for n in inner:
        groups.setdefault((n.hand, round(n.beat, 3)), []).append(n.pitch)
    keys = sorted(groups, key=lambda k: k[1])
    steps_at = []
    for hand in "LR":
        hk = [k for k in keys if k[0] == hand]
        for k1, k2 in zip(hk, hk[1:]):
            if k2[1] - k1[1] > 2.01:
                continue
            g1, g2 = groups[k1], groups[k2]
            if any(0 < abs(a - b) <= 2 for a in g2 for b in g1 if a not in g1):
                steps_at.append(k2[1])
    lows = []
    for b in range(1, last + 1, 4):
        b0, b1 = s.bar_start(b), s.bar_start(min(b + 4, last + 1))
        c = sum(1 for x in steps_at if b0 <= x < b1)
        lows.append(c)
        if c < 2:
            iss.append(f"INNER-MOTION bars {b}-{b + 3}: only {c} stepwise inner moves")
    info.append(f"stepwise inner-voice moves per 4 bars: {lows}")
    for name in bass_sections:
        sec = next((x for x in sections if x["name"] == name), None)
        if not sec:
            continue
        roots = [b for b, sym, sn in changes if sn == name]
        bass = []
        for b in roots:
            at = [n.pitch for n in lhn if abs(n.beat - b) < 1e-6 or (b - 0.5 - 1e-6 <= n.beat < b and n.voice == "bass"
                                                                     and n.beat + n.dur > b)]
            if at:
                bass.append((b, min(at)))
        nxt = next((b for b, sym, sn in changes if b >= sec["b1"] - 1e-6), None)
        if nxt is not None:
            at = [n.pitch for n in lhn if abs(n.beat - nxt) < 1e-6]
            if at:
                bass.append((nxt, min(at)))
        moves = stepish = 0
        for (b0, p0), (b1, p1) in zip(bass, bass[1:]):
            if p0 == p1:
                continue
            moves += 1
            appr = [n for n in lhn if b0 < n.beat < b1 and n.voice in ("bass", "ghost") and abs(n.pitch - p1) == 1]
            if abs(p1 - p0) <= 2 or appr:
                stepish += 1
        if moves:
            info.append(f"bass line {name}: {stepish}/{moves} moves are steps or chromatic approaches")
            if stepish / moves < 0.5:
                iss.append(f"BASS-LINE {name}: only {stepish}/{moves} stepwise")
    lows_b = [n for n in lhn if n.pitch < 29]
    eb1 = [n for n in lows_b if n.pitch == 27]
    if len(lows_b) - len(eb1) > 0 or len(eb1) > 1:
        iss.append(f"BASS FLOOR below F1: {len(lows_b)} notes")
    hi = [n for n in s.notes if n.pitch > 96]
    if hi:
        iss.append(f"RH above C7: {len(hi)} notes")
    return iss, info


def voice_leading(s, sections, octave_bars=()):
    iss, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    bass_on = {}
    for n in ns:
        if n.hand == "L" and n.voice == "bass":
            k = round(n.t_on, 2)
            if k not in bass_on or n.pitch < bass_on[k].pitch:
                bass_on[k] = n
    bl = [bass_on[k] for k in sorted(bass_on)]
    mts = [m.t_on for m in mel]

    def mel_at(t):
        i = bisect.bisect_right(mts, t + 0.04) - 1
        return mel[i] if i >= 0 else None
    par = 0
    for a, b in zip(bl, bl[1:]):
        if s._bar_of(b.beat) in octave_bars or b.t_on - a.t_on > 2.5:
            continue
        ma, mb = mel_at(a.t_on), mel_at(b.t_on)
        if not ma or not mb or ma is mb:
            continue
        ia, ib = (ma.pitch - a.pitch) % 12, (mb.pitch - b.pitch) % 12
        da, dm = b.pitch - a.pitch, mb.pitch - ma.pitch
        if ia == ib and ia in (0, 7) and da and dm and (da > 0) == (dm > 0):
            par += 1
            iss.append(f"PARALLEL {'octaves' if ia == 0 else 'fifths'} melody/bass t={b.t_on:6.2f} bar {s._bar_of(b.beat)}: "
                       f"{pname(ma.pitch)}/{pname(a.pitch)} -> {pname(mb.pitch)}/{pname(b.pitch)}")
    info.append(f"outer-voice parallel 5ths/8ves (outside the octave-doubled bars): {par}")
    byp = {}
    for n in ns:
        byp.setdefault(n.pitch, []).append(n)
    for p, lst in byp.items():
        lst.sort(key=lambda n: n.t_on)
        for x, y in zip(lst, lst[1:]):
            if y.t_on < x.t_off - 0.005:
                kind = "re-struck while held" if x.hand == y.hand else "held by both hands"
                iss.append(f"KEY {pname(p)} {kind} t={y.t_on:6.2f} bar {s._bar_of(y.beat)} ({x.hand}{x.voice}/{y.hand}{y.voice})")
    return iss, info


# ---------------------------------------------------------------------------------------------------------------
def pedal_mud(s, snd=None):
    """Low-interval mud with the pedal taken into account, at 0.13 s after every onset below C4 (after a legato
    change at that onset has cleared). Everything still sounding (key or pedal) is collected."""
    iss, info = [], []
    snd = snd or Sound(s)
    seen = set()
    for n in snd.ns:
        if n.pitch >= 60:
            continue
        t = n.t_on + 0.13
        ps = sorted(set(m.pitch for m in snd.at(t) if m.pitch < 60))
        for a, b in zip(ps, ps[1:]):
            iv = b - a
            if iv in LIL and a < LIL[iv]:
                key = (s._bar_of(n.beat), a, b)
                if key not in seen:
                    seen.add(key)
                    iss.append(f"PEDAL-MUD t={n.t_on:6.2f} bar {key[0]}: {pname(a)}-{pname(b)} ({iv} st) ring together")
    info.append(f"pedal-aware low-register clashes: {len(iss)}")
    return iss, info


def clashes(s, intended, snd=None, min_ring=0.10):
    """Melody onsets sounding a m2 / m9 / m2 + 2 octaves against an accompaniment note that is still ringing (struck
    at or before the melody note and not yet damped for at least `min_ring` s more). Each must be listed in
    `intended` (bar -> reason); unexplained ones are issues."""
    iss, info = [], []
    snd = snd or Sound(s)
    acc = [n for n in snd.ns if n.voice != "mel"]
    ats = [n.t_on for n in acc]
    found = []
    for m in (n for n in snd.ns if n.voice == "mel"):
        i = bisect.bisect_right(ats, m.t_on + 0.03)
        for a in acc[:i]:
            if m.t_on - a.t_on > 4.0:
                continue
            if snd.end(a) <= m.t_on + min_ring and a.t_off <= m.t_on + min_ring:
                continue
            iv = m.pitch - a.pitch
            if iv > 0 and iv % 12 == 1:
                bar = s._bar_of(m.beat)
                found.append((bar, m, a, iv))
    for bar, m, a, iv in found:
        why = intended.get(bar)
        txt = f"bar {bar:2d} t={m.t_on:6.2f} mel {pname(m.pitch)} vs {a.voice} {pname(a.pitch)} (+{iv})"
        if why:
            info.append(f"clash (intended: {why}): {txt}")
        else:
            iss.append(f"CLASH unexplained: {txt}")
    info.append(f"melody m2/m9 against ringing accompaniment: {len(found)} ({len(iss)} unexplained)")
    return iss, info


def parallels(s, octave_bars=()):
    """Successive bass attacks vs the melody note sounding at each: P8/P5 -> P8/P5 with both voices moving."""
    iss, info = [], []
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.t_on)
    bass = sorted([n for n in s.notes if n.voice == "bass"], key=lambda n: n.t_on)
    b2 = []
    for n in bass:
        if b2 and abs(n.t_on - b2[-1].t_on) < 0.03:
            if n.pitch < b2[-1].pitch:
                b2[-1] = n
            continue
        b2.append(n)

    def mel_at(t):
        cur = [m for m in mel if m.t_on - 0.04 <= t < m.t_off]
        return max(cur, key=lambda m: m.pitch) if cur else None
    prev = None
    for b in b2:
        m = mel_at(b.t_on)
        if m is None:
            prev = None
            continue
        iv = (m.pitch - b.pitch) % 12
        if prev:
            pb, pm, piv = prev
            if iv == piv and iv in (0, 7) and b.pitch != pb.pitch and m.pitch != pm.pitch and \
                    (b.pitch - pb.pitch) * (m.pitch - pm.pitch) > 0 and s._bar_of(b.beat) not in octave_bars:
                iss.append(f"PARALLEL {'8ve' if iv == 0 else '5th'} bar {s._bar_of(b.beat)} t={b.t_on:6.2f}: "
                           f"{pname(pb.pitch)}/{pname(pm.pitch)} -> {pname(b.pitch)}/{pname(m.pitch)}")
        prev = (b, m, iv)
    info.append(f"melody/bass parallel 8ves/5ths on consecutive bass attacks: {len(iss)}")
    return iss, info


# ---------------------------------------------------------------------------------------------------------------
def bar_energy(s, bar):
    b0, b1 = s.bar_start(bar), s.bar_start(bar + 1)
    return sum((n.vel / 127.0) ** 2 for n in s.notes if b0 - 1e-6 <= n.beat < b1 - 1e-6)


def arrivals(s, drops, arrival_bars=(), min_silence=0.75, min_ring=6.0):
    """drops: list of (bar after the drop). Silence = gap between the last sound (dampers down or key up) and the
    pickup / first note into that bar; the ring = time from the last melody onset to the final pedal release.
    arrival_bars (fix round 1): each arrival downbeat must beat what came before it - the melody's downbeat note is
    louder than every melody note of the two bars before, the downbeat's loudest LH key is at least as loud as the
    preceding bar's, and the arrival bar carries more energy (sum of (v/127)^2) than the bar before it. The last
    arrival (the climax) must also be a new melodic high."""
    iss, info = [], []
    snd = Sound(s)
    ns = snd.ns
    mel = [n for n in ns if n.voice == "mel"]
    for bar in drops:
        b0 = s.bar_start(bar)
        pick = min((n for n in mel if b0 - 0.6 <= n.beat < b0 + 0.01), key=lambda n: n.beat)
        before = [n for n in ns if n.t_on < pick.t_on - 0.05]
        last = max(min(snd.end_binary(n), n.t_off + 10) if n.pitch <= 87 else n.t_off for n in before)
        last = max(max(n.t_off for n in before), min(last, pick.t_on))
        gap = pick.t_on - last
        info.append(f"drop before bar {bar}: {gap:.2f}s of silence before the {pname(pick.pitch)} pickup")
        if gap < min_silence:
            iss.append(f"DROP before bar {bar}: only {gap:.2f}s of silence")
    for k, bar in enumerate(arrival_bars):
        b0 = s.bar_start(bar)
        down = [n for n in mel if abs(n.beat - b0) < 1e-6]
        if not down:
            iss.append(f"ARRIVAL bar {bar}: no melody note on the downbeat")
            continue
        d = max(down, key=lambda n: n.pitch)
        prev = [n for n in mel if s.bar_start(bar - 2) - 1e-6 <= n.beat < b0 - 1e-6]
        pk = max(prev, key=lambda n: n.vel)
        lh_d = max([n.vel for n in ns if n.hand == "L" and abs(n.beat - b0) < 1e-6] or [0])
        lh_p = max([n.vel for n in ns if n.hand == "L" and s.bar_start(bar - 1) - 1e-6 <= n.beat < b0 - 1e-6] or [0])
        e = [round(bar_energy(s, b), 2) for b in (bar - 2, bar - 1, bar, bar + 1)]
        info.append(f"arrival bar {bar}: melody {pname(d.pitch)} v{d.vel} vs peak of the 2 bars before "
                    f"{pname(pk.pitch)} v{pk.vel}; LH downbeat v{lh_d} vs bar {bar - 1} max v{lh_p}; "
                    f"bar energy {bar - 2}..{bar + 1} = {e}")
        if d.vel <= pk.vel:
            iss.append(f"ARRIVAL bar {bar}: downbeat {pname(d.pitch)} v{d.vel} not louder than {pname(pk.pitch)} "
                       f"v{pk.vel} before it")
        if lh_d < lh_p:
            iss.append(f"ARRIVAL bar {bar}: LH downbeat v{lh_d} softer than bar {bar - 1}'s v{lh_p}")
        if e[2] <= max(e[0], e[1]):
            iss.append(f"ARRIVAL bar {bar}: energy {e[2]} not above bars {bar - 2}-{bar - 1} ({e[0]}, {e[1]})")
        if k == len(arrival_bars) - 1 and d.pitch <= max(n.pitch for n in prev):
            iss.append(f"ARRIVAL bar {bar}: {pname(d.pitch)} is not a new high after the build "
                       f"({pname(max(n.pitch for n in prev))})")
    lastm = mel[-1]
    pc = s.pedal_curve
    t_rel = max(t for t, v in pc if v >= 120)
    ring = t_rel - lastm.t_on
    info.append(f"final ring: last melody onset {lastm.t_on:.2f}s, pedal release starts {t_rel:.2f}s -> {ring:.1f}s ring; "
                f"release ramp {pc[-1][0] - t_rel:.2f}s")
    if ring < min_ring:
        iss.append(f"RING only {ring:.1f}s (< {min_ring}s)")
    return iss, info


def density(s, order=(("verse2", "chorus1"), ("chorus1", "chorus2"), ("pre2", "chorus2"), ("chorus2", "climax"),
                      ("verse1", "chorus1"))):
    iss, info = [], []
    tl = {x["name"]: x for x in s.timeline["sections"]}
    nps = {}
    for name, x in tl.items():
        c = sum(1 for n in s.notes if x["bar_start"] <= s._bar_of(n.beat) <= x["bar_end"])
        nps[name] = c / max(1e-9, x["t_end"] - x["t_start"])
    info.append("notes/s: " + ", ".join(f"{k} {v:.1f}" for k, v in nps.items()))
    for lo, hi in order:
        if nps[lo] >= nps[hi]:
            iss.append(f"DENSITY {hi} ({nps[hi]:.1f}/s) does not lift over {lo} ({nps[lo]:.1f}/s)")
    # the build's rhythm doubles bar by bar
    bars = [sum(1 for n in s.notes if s._bar_of(n.beat) == b and n.hand == "L") for b in (49, 50, 51)]
    rh = [sum(1 for n in s.notes if s._bar_of(n.beat) == b and n.hand == "R") for b in (49, 50, 51, 52)]
    info.append(f"build onsets per bar: LH {bars}, RH {rh}")
    return iss, info


# ---------------------------------------------------------------------------------------------------------------
# fix round 1: the animation's physical validators (key release -> next onset, fingers) and pedal clusters
# ---------------------------------------------------------------------------------------------------------------
def key_air(s):
    """Air time per hand: from a key's release to the next onset that needs that finger (another key) or makes the
    hand jump (the key cannot stay down with the new keys inside the hand span). Thresholds (research/music.md 5.11,
    pianist review): same finger 35 ms + 5 ms / semitone (max 100); hand jump <= 12 st 50 ms, 13-24 st 100 ms,
    > 24 st 140 ms (300 ms wanted), the jump measured as the larger of the key's and its chord centre's distance to
    the centre of the new keys (session E). An issue when the air is under the minimum although the onset-to-onset
    time leaves room for it (>= minimum + 60 ms of key-down)."""
    iss, info = [], []
    tight = 0
    for hand in "LR":
        ns = sorted([n for n in s.notes if n.hand == hand], key=lambda n: n.t_on)
        groups = onset_groups(ns)
        gts = [g[0] for g in groups]
        src_of = src_groups(ns)
        for n in ns:
            i = bisect.bisect_right(gts, n.t_on + GROUP_TOL - 1e-9)
            while i < len(groups) and groups[i][0] < n.t_off + 0.31:
                gt, grp = groups[i]
                held = [m for m in ns if m is not n and m not in grp and m.t_on < gt - GROUP_TOL
                        and m.t_off > gt + GROUP_TOL]
                need = air_need(n, grp, held, hand, src_of.get(id(n)))
                if need:
                    mn, want = need
                    air = gt - n.t_off
                    d = round(hand_shift(n, grp, src_of.get(id(n))))
                    if air < mn - 0.002 and gt - n.t_on >= mn + 0.06:
                        iss.append(f"AIR {hand} bar {s._bar_of(n.beat)} t={n.t_off:6.2f}: {pname(n.pitch)} "
                                   f"(finger {n.finger}) released {1000 * air:.0f} ms before "
                                   f"{'/'.join(pname(m.pitch) for m in grp)} ({d} st; needs {1000 * mn:.0f} ms)")
                    elif air < want - 0.002:
                        tight += 1
                    break
                i += 1
    info.append(f"key releases with the minimum air but under the wanted air (e.g. 140-300 ms for > 24 st): {tight}")
    return iss, info


def finger_travel(s, fast=0.25, far=8):
    """Same-finger travel: a finger that leaves one key and strikes another must get there - air >= 35 ms + 5 ms per
    semitone (100 ms beyond an octave, 140 ms beyond two), and a finger never jumps `far`+ semitones between onsets
    less than `fast` s apart (the hand would bounce: another finger should take one of the two keys)."""
    iss, info = [], []
    worst = []
    for hand in "LR":
        byf = {}
        for n in sorted([n for n in s.notes if n.hand == hand], key=lambda n: n.t_on):
            byf.setdefault(n.finger, []).append(n)
        for f, lst in byf.items():
            for a, b in zip(lst, lst[1:]):
                d = abs(b.pitch - a.pitch)
                if d == 0:
                    continue
                if d == 1 and a.pitch % 12 in BLACK and b.pitch % 12 not in BLACK and b.t_on - a.t_on > 0.12:
                    continue                                   # a slide off a black key
                req = min(0.10, 0.035 + 0.005 * d) if d <= 12 else (0.10 if d <= 24 else 0.14)
                air = b.t_on - a.t_off
                dt = b.t_on - a.t_on
                worst.append(air - req)
                if air < req - 0.002:
                    iss.append(f"FINGER-TRAVEL {hand}{f} bar {s._bar_of(b.beat)} t={b.t_on:6.2f}: {pname(a.pitch)} -> "
                               f"{pname(b.pitch)} ({d} st) with {1000 * air:.0f} ms of air (needs {1000 * req:.0f})")
                elif d >= far and dt < fast:
                    iss.append(f"FINGER-JUMP {hand}{f} bar {s._bar_of(b.beat)} t={b.t_on:6.2f}: {pname(a.pitch)} -> "
                               f"{pname(b.pitch)} ({d} st) {1000 * dt:.0f} ms after the first onset")
    info.append(f"same-finger moves: {len(worst)}, tightest margin {1000 * min(worst):.0f} ms")
    return iss, info


def finger_order(s):
    """Among the keys a hand holds at each onset, finger numbers must follow pitch (RH 1 -> 5 upward, LH 5 -> 1
    upward); a key released within LEGATO_OVERLAP after the onset is a legato overlap, not a held key."""
    iss, info = [], []
    n_states = 0
    for hand in "LR":
        ns = sorted([n for n in s.notes if n.hand == hand], key=lambda n: n.t_on)
        sg = 1 if hand == "R" else -1
        for gt, grp in onset_groups(ns):
            held = [m for m in ns if m.t_on < gt - 1e-9 and m.t_off > gt + LEGATO_OVERLAP and m not in grp] + grp
            keys = sorted(held, key=lambda m: m.pitch)
            n_states += 1
            for a, b in zip(keys, keys[1:]):
                if a.pitch == b.pitch:
                    continue
                if sg * (b.finger - a.finger) <= 0:
                    iss.append(f"FINGER-ORDER {hand} bar {s._bar_of(grp[0].beat)} t={gt:6.2f}: {pname(a.pitch)} on "
                               f"{a.finger}, {pname(b.pitch)} on {b.finger} (held together)")
                    break
    info.append(f"hand states checked: {n_states}")
    return iss, info


def finger_pins(s):
    """Pinned fingers (%n) the solver had to drop, and states where a finger would have to jump on a held key."""
    iss, info = [], []
    for hand, t, pins, what in getattr(s, "_pin_log", []):
        bar = s.timeline["bars"][max(0, bisect.bisect_right([b["t"] for b in s.timeline["bars"]], t) - 1)]["bar"]
        iss.append(f"PIN {hand} bar {bar} t={t:6.2f}: pins {' '.join(pins)} impossible - {what}")
    for hand, t in getattr(s, "_break_log", []):
        bar = s.timeline["bars"][max(0, bisect.bisect_right([b["t"] for b in s.timeline["bars"]], t) - 1)]["bar"]
        iss.append(f"FINGER-BREAK {hand} bar {bar} t={t:6.2f}: no fingering continues the held keys")
    info.append(f"pin drops {len(getattr(s, '_pin_log', []))}, broken states {len(getattr(s, '_break_log', []))}")
    return iss, info


# natural (undamped) decay, T60 in seconds per key: a rough piano decay curve (treble dies fast). Used only to stop
# counting a pedal-sustained note once it has fallen 20 dB on its own.
NAT_KEYS = (21, 48, 60, 72, 84, 96, 108)
NAT_T60 = (20.0, 12.0, 9.0, 6.0, 3.6, 2.0, 1.0)


def pedal_clusters(s, snd=None, intended=None, min_vel=60, min_pitch=60, min_ring=0.75):
    """Semitone pairs above middle C, both struck at mp/mf or louder (v >= 60), that ring together by the pedal (not
    because both keys are held) for `min_ring` s or more (about a beat): neighbour notes or runs smeared into a
    cluster under the pedal. Sounding = within 20 dB: the continuous damper model (half pedal, flutters, clears) and
    the natural decay. Pairs in `intended` bars (both chord tones, a voicing) are reported as info."""
    iss, info = [], []
    intended = intended or {}
    snd = snd or Sound(s)
    ns = [n for n in snd.ns if n.pitch >= min_pitch and n.vel >= min_vel]

    def end(n):
        return min(snd.end(n), n.t_on + float(np.interp(n.pitch, NAT_KEYS, NAT_T60)) / 3.0)
    worst = 0.0
    for i, a in enumerate(ns):
        ea = end(a)
        for b in ns[i + 1:]:
            if b.t_on > ea:
                break
            if abs(a.pitch - b.pitch) != 1:
                continue
            eb = end(b)
            joint = min(ea, eb) - b.t_on
            keys = max(0.0, min(a.t_off, b.t_off) - b.t_on)
            ped = joint - keys
            if ped < min_ring:
                worst = max(worst, ped)
                continue
            bar = s._bar_of(b.beat)
            txt = (f"bar {bar} t={b.t_on:6.2f}: {pname(a.pitch)} v{a.vel} + {pname(b.pitch)} v{b.vel} ring together "
                   f"{ped:.2f}s by the pedal")
            if bar in intended:
                info.append(f"cluster (intended: {intended[bar]}): {txt}")
            else:
                worst = max(worst, ped)
                iss.append("CLUSTER " + txt)
    info.append(f"longest unexplained pedal-sustained semitone pair (v>=60, above C4): {worst:.2f}s "
                f"(an issue from {min_ring}s)")
    return iss, info


# well-known openings (interval sequences in semitones); a 5-interval window match is an issue, 4 is reported
REF_TUNES = {
    "River Flows in You (opening cell)": [-1, 1, -1, 1, -5, 5, -7],
    "My Bonnie Lies Over the Ocean": [9, -2, -2, 2, -2, -3, -2],
    "Chopin Nocturne Op. 9 No. 2 (opening)": [9, -2, 2, -2, -2, 9, -4],
}


def originality(s):
    iss, info = [], []
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.t_on)
    iv = [b.pitch - a.pitch for a, b in zip(mel, mel[1:])]
    for name, ref in REF_TUNES.items():
        for k, label in ((5, "issue"), (4, "info")):
            refw = {tuple(ref[i:i + k]) for i in range(len(ref) - k + 1)}
            hits = [i for i in range(len(iv) - k + 1) if tuple(iv[i:i + k]) in refw]
            if not hits:
                continue
            where = ", ".join(f"bar {s._bar_of(mel[i].beat)}" for i in hits[:6])
            if label == "issue" or name.startswith("River"):
                iss.append(f"ORIGINALITY {k}-interval match with {name}: {len(hits)} ({where})")
            else:
                info.append(f"{k}-interval match with {name}: {len(hits)} ({where})")
            break
    info.append(f"originality n-gram scan over {len(iv)} melody intervals against {len(REF_TUNES)} reference openings")
    return iss, info
