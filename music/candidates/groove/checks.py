"""Validators for the groove candidate: the sketch's extra checks plus my own (research/music.md 5.11 + section 6)."""
from __future__ import annotations

import importlib.util
import os
import statistics

import numpy as np
from collections import Counter

from lib import ROOT, pname, pedal_at, BLACK

LIL = {1: 52, 2: 51, 3: 48, 4: 46, 5: 46, 6: 47, 7: 34, 8: 41, 9: 41, 10: 41, 11: 41, 13: 40, 14: 39, 15: 31, 16: 29}
GROOVE = {"chorus1", "verse2", "pre2", "chorus2", "climax"}
ACC_VOICES = {"inner", "acc", "backbeat", "counter", "shell"}


def load_sketch():
    p = os.path.join(ROOT, "sandbox", "music-research", "sketch.py")
    spec = importlib.util.spec_from_file_location("afterglow_sketch", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _clusters(ns, tol=0.035):
    """Onset clusters of one hand: notes whose onsets chain within tol seconds (rolls, offsets)."""
    out, cur = [], []
    for n in sorted(ns, key=lambda n: n.t_on):
        if cur and n.t_on - cur[-1].t_on > tol:
            out.append(cur)
            cur = []
        cur.append(n)
    if cur:
        out.append(cur)
    return out


def my_checks(s, W):
    issues, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    sec_of = lambda n: (s._section_at(n.beat).name if s._section_at(n.beat) else "?")

    # 1. melody prominence >= 12 over everything struck within 40 ms
    bad = []
    for m in mel:
        o = [x for x in ns if x is not m and x.voice != "mel" and abs(x.t_on - m.t_on) < 0.04]
        if o and m.vel - max(x.vel for x in o) < 12:
            bad.append(f"PROMINENCE t={m.t_on:6.2f} bar {s._bar_of(m.beat)} mel {pname(m.pitch)} v{m.vel} vs v{max(x.vel for x in o)}")
    issues += bad

    # 2. melody always on top: nothing sounds (key held or struck) above the current melody note
    for n in ns:
        if n.voice == "mel":
            continue
        cur = [m for m in mel if m.t_on - 0.03 <= n.t_on < m.t_off - 0.01]
        if cur:
            top = max(m.pitch for m in cur)
            if n.pitch >= top:
                issues.append(f"NOT-ON-TOP t={n.t_on:6.2f} bar {s._bar_of(n.beat)} {n.voice} {pname(n.pitch)} >= mel {pname(top)}")
        else:   # melody resting: must stay below the previous and next melody notes
            prv = [m for m in mel if m.t_off <= n.t_on + 0.01 and n.t_on - m.t_off < 1.5]
            nxt = [m for m in mel if m.t_on > n.t_on and m.t_on - n.t_on < 1.0]
            ref = [x.pitch for x in (prv[-1:] + nxt[:1])]
            if ref and n.pitch >= min(ref) and n.hand == "R":
                issues.append(f"NOT-ON-TOP(rest) t={n.t_on:6.2f} bar {s._bar_of(n.beat)} {pname(n.pitch)} vs {[pname(r) for r in ref]}")

    # 3. held span + keys per hand, clustered onsets (RH <= 14, LH <= 16 and 15-16 only broken)
    for hand, lim in (("R", 14), ("L", 16)):
        hs = [n for n in ns if n.hand == hand]
        for n in hs:
            held = [m for m in hs if abs(m.t_on - n.t_on) < 0.03 or (m.t_on < n.t_on < m.t_off - 0.03)]
            ps = [m.pitch for m in held]
            if max(ps) - min(ps) > lim:
                issues.append(f"SPAN {hand} t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: {pname(min(ps))}..{pname(max(ps))}")
            if len(set(ps)) > 5:
                issues.append(f"KEYS {hand} t={n.t_on:6.2f}: {len(set(ps))} keys held")
        if hand == "L":
            for g in _clusters(hs, 0.005):
                ps = [m.pitch for m in g]
                if max(ps) - min(ps) > 14:
                    issues.append(f"LH-BLOCK>14 t={g[0].t_on:6.2f} bar {s._bar_of(g[0].beat)} (15-16 must be broken)")

    # 4. leaps: clustered onset groups, centroid jump vs time
    for hand in ("L", "R"):
        cl = _clusters([n for n in ns if n.hand == hand])
        for a, b in zip(cl, cl[1:]):
            ca = (min(x.pitch for x in a) + max(x.pitch for x in a)) / 2
            cb = (min(x.pitch for x in b) + max(x.pitch for x in b)) / 2
            dt = b[0].t_on - a[0].t_on
            j = abs(cb - ca)
            if (j > 24 and dt < 0.30) or (j > 12 and dt < 0.14):
                issues.append(f"LEAP {hand} t={a[0].t_on:6.2f} bar {s._bar_of(a[0].beat)}: {j:.0f} st in {dt * 1000:.0f} ms")

    # 5. fingers: every note fingered; one finger never on two held keys
    nf = [n for n in ns if not 1 <= n.finger <= 5]
    if nf:
        issues.append(f"FINGER missing on {len(nf)} notes")
    for hand in ("L", "R"):
        hs = [n for n in ns if n.hand == hand]
        for i, n in enumerate(hs):
            for m in hs[i + 1:]:
                if m.t_on > n.t_off - 0.02:
                    break
            for m in hs:
                if m is not n and m.finger == n.finger and m.t_on <= n.t_on < m.t_off - 0.02 and m.t_on < n.t_on - 0.001:
                    issues.append(f"FINGER-CONFLICT {hand} t={n.t_on:6.2f} bar {s._bar_of(n.beat)} f{n.finger} {pname(m.pitch)}+{pname(n.pitch)}")
    rmel = sorted([n for n in mel], key=lambda n: n.t_on)
    tb = 0
    for a, b, c in zip(rmel, rmel[1:], rmel[2:]):
        if b.finger == 1 and b.pitch % 12 in BLACK and abs(b.pitch - a.pitch) <= 2 and abs(c.pitch - b.pitch) <= 2:
            tb += 1
            issues.append(f"THUMB-BLACK in run t={b.t_on:6.2f} bar {s._bar_of(b.beat)} {pname(b.pitch)}")
    info.append(f"RH melody thumb-on-black in stepwise runs: {tb}")

    # 6. pedal marked at every harmony change
    pm = {round(b, 4) for b, _ in s.pedal_marks}
    for b, sym, kind in W.changes:
        if round(b, 4) not in pm:
            issues.append(f"PEDAL missing at harmony change bar {s._bar_of(b)} ({sym})")
    info.append(f"harmony changes with a pedal mark: {len(W.changes)}")

    # 7. bass keys released early must be carried by the pedal (except deliberate dry stabs)
    dry = []
    for n in ns:
        if n.voice == "bass" and "dry" not in n.tags and pedal_at(s.pedal_curve, n.t_off) < 64:
            dry.append(n)
    for n in dry:
        issues.append(f"DRY-BASS t={n.t_off:6.2f} bar {s._bar_of(n.beat)} {pname(n.pitch)} key up while pedal is up")

    # 8. ghost-note velocities 18-32 ; 9. machine-gun velocities on the melody
    gv = [n.vel for n in ns if n.voice == "ghost"]
    if gv:
        info.append(f"ghost notes: {len(gv)}  vel {min(gv)}-{max(gv)}  mean {statistics.mean(gv):.1f}")
        for n in ns:
            if n.voice == "ghost" and not 18 <= n.vel <= 32:
                issues.append(f"GHOST-VEL t={n.t_on:6.2f} bar {s._bar_of(n.beat)} v{n.vel}")
    run = 1
    for a, b in zip(rmel, rmel[1:]):
        run = run + 1 if a.vel == b.vel else 1
        if run > 4:
            issues.append(f"MACHINE-GUN velocity run t={b.t_on:6.2f}")

    # 10. swing only in groove sections, 54-58 %; 11. tempo steady (+-1 %) in groove sections
    for sec in s.sections:
        if sec.name in GROOVE:
            if not 0.54 <= sec.swing <= 0.58:
                issues.append(f"SWING {sec.name} {sec.swing}")
        elif abs(sec.swing - 0.5) > 1e-6:
            issues.append(f"SWING outside groove: {sec.name} {sec.swing}")
    beats = s.timeline["beats"]
    for sec in s.sections:
        if sec.name not in GROOVE:
            continue
        b0, b1 = int(s.bar_start(sec.bar_start)), int(s.bar_start(sec.bar_end + 1))
        bpm = [60 / (s._bpm(b + 0.5)) for b in range(b0, b1)]
        med = statistics.median(bpm)
        dev = max(abs(x / med - 1) for x in bpm)
        info.append(f"tempo {sec.name}: {60 / med:.1f} bpm, max deviation {dev * 100:.2f} %")
        if dev > 0.01:
            issues.append(f"TEMPO {sec.name} drifts {dev * 100:.1f} %")

    # 12. breathing: every melody bar has a rest >= an 8th or a note >= 1.5 beats
    bars = sorted({s._bar_of(m.beat) for m in mel})
    for bar in bars:
        b0, b1 = s.bar_start(bar), s.bar_start(bar + 1)
        ms = [m for m in sorted(mel, key=lambda m: m.beat) if m.beat < b1 and m.beat + m.dur > b0]
        longn = any(m.dur >= 1.5 - 1e-6 for m in ms)
        gaps = []
        cur = b0
        for m in ms:
            gaps.append(max(0, m.beat - cur))
            cur = max(cur, m.beat + m.dur)
        gaps.append(max(0, b1 - cur))
        if not longn and max(gaps) < 0.5 - 1e-6:
            issues.append(f"BREATH bar {bar}: no rest >= 8th and no note >= 1.5 beats")

    # 13. duration window ; apex
    dur = max(n.t_off for n in ns)
    info.append(f"last note-off {dur:.2f} s = {int(dur // 60)}:{dur % 60:04.1f}")
    if not 200 <= dur <= 230:
        issues.append(f"DURATION {dur:.1f}s outside 3:20-3:50")
    top = max(m.pitch for m in mel)
    tops = [m for m in mel if m.pitch == top]
    info.append(f"apex {pname(top)} x{len(tops)} at {tops[0].t_on:.1f}s = {100 * tops[0].t_on / dur:.1f} % "
                f"(vel {tops[0].vel}, loudest melody vel {max(m.vel for m in mel)})")
    if len(tops) != 1:
        issues.append(f"APEX {pname(top)} occurs {len(tops)} times")
    elif not 0.75 <= tops[0].t_on / dur <= 0.82:
        issues.append("APEX outside 75-82 %")

    # 14. melody velocity range per section >= 12 ; dynamic arc table
    for sec in s.sections:
        mv = [m.vel for m in mel if sec.bar_start <= s._bar_of(m.beat) <= sec.bar_end]
        av = [n.vel for n in ns if n.voice != "mel" and sec.bar_start <= s._bar_of(n.beat) <= sec.bar_end]
        if mv:
            info.append(f"  {sec.name:8s} mel vel {min(mv):3d}-{max(mv):3d} (mean {statistics.mean(mv):5.1f})  "
                        f"acc mean {statistics.mean(av) if av else 0:5.1f}")
            if max(mv) - min(mv) < 12:
                issues.append(f"DYN-RANGE {sec.name} melody range {max(mv) - min(mv)} < 12")

    # 15. inner motion: >= 2 stepwise inner-voice moves in every 4-bar window
    inner = [n for n in ns if n.voice in ACC_VOICES]
    moves = []
    for hand in ("L", "R"):
        hs = [n for n in inner if n.hand == hand]
        for n in hs:
            for m in hs:
                if m is n or not (n.t_on - 1.25 < m.t_off <= n.t_on + 0.03) or m.t_on >= n.t_on - 0.03:
                    continue
                if 1 <= abs(n.pitch - m.pitch) <= 2 and not any(abs(x.t_on - n.t_on) < 0.03 and x.pitch == m.pitch for x in hs):
                    moves.append(s._bar_of(n.beat))
                    break
    cnt = Counter(moves)
    last = s._last_bar()
    weak = [b for b in range(1, last - 2) if sum(cnt[x] for x in range(b, b + 4)) < 2]
    info.append(f"stepwise inner-voice moves: {len(moves)}; 4-bar windows with < 2: {weak}")
    for b in weak:
        issues.append(f"INNER-MOTION bars {b}-{b + 3} < 2 stepwise inner moves")

    # 16. LH loop: no 2-bar LH segment repeated verbatim more than 3 times in a row
    def lh_sig(bar):
        b0, b1 = s.bar_start(bar), s.bar_start(bar + 1)
        return tuple(sorted((round(n.beat - b0, 3), n.pitch, round(n.dur, 3)) for n in ns if n.hand == "L" and b0 <= n.beat < b1))
    sigs = [lh_sig(b) for b in range(1, last + 1)]
    for i in range(len(sigs) - 7):
        seg = sigs[i:i + 2]
        if seg[0] and all(sigs[i + 2 * k:i + 2 * k + 2] == seg for k in range(4)):
            issues.append(f"LH-LOOP bars {i + 1}-{i + 8} repeat a 2-bar segment 4x")
    run, maxrun = 1, 1
    for a, b in zip(sigs, sigs[1:]):
        ra = tuple(x[0] for x in a)
        rb = tuple(x[0] for x in b)
        run = run + 1 if ra == rb and ra else 1
        maxrun = max(maxrun, run)
    info.append(f"longest run of bars with identical LH rhythm: {maxrun}")
    if maxrun > 3:
        issues.append(f"LH-RHYTHM identical for {maxrun} bars in a row")

    # 17. mud incl. pedal sustain (sound, not keys): low adjacent intervals overlapping > 150 ms
    lifts = [t for (t, v), (t2, v2) in zip(s.pedal_curve, s.pedal_curve[1:]) if v >= 64 > v2]
    import bisect

    def sound_end(n):
        if pedal_at(s.pedal_curve, n.t_off) < 64:
            return n.t_off
        i = bisect.bisect_left(lifts, n.t_off)
        return lifts[i] + 0.08 if i < len(lifts) else n.t_off + 4
    low = [n for n in ns if n.pitch < 60]
    ends = {id(n): sound_end(n) for n in low}
    mud = set()
    for n in low:
        snd = [m for m in low if m.t_on <= n.t_on + 0.01 and ends[id(m)] > n.t_on + 0.15]
        ps = sorted(set(m.pitch for m in snd))
        for a, b in zip(ps, ps[1:]):
            if (b - a) in LIL and a < LIL[b - a]:
                mud.add((s._bar_of(n.beat), pname(a), pname(b)))
    for bar, a, b in sorted(mud):
        info.append(f"  sound-mud (pedal) bar {bar}: {a}-{b}")
    info.append(f"sound-level mud spots incl. pedal ring (informational): {len(mud)}")
    return issues, info


def melody_stats(s):
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.t_on)
    out = {}
    for sec in s.sections:
        m = [n for n in mel if sec.bar_start <= s._bar_of(n.beat) <= sec.bar_end]
        if not m:
            continue
        iv = [b.pitch - a.pitch for a, b in zip(m, m[1:])]
        dur = sum(n.t_off - n.t_on for n in m)
        t0, t1 = min(n.t_on for n in m), max(n.t_off for n in m)
        out[sec.name] = dict(range=f"{pname(min(n.pitch for n in m))}-{pname(max(n.pitch for n in m))}",
                             notes=len(m), steps=sum(1 for x in iv if 1 <= abs(x) <= 2),
                             repeated=sum(1 for x in iv if x == 0), leaps=sum(1 for x in iv if abs(x) >= 5),
                             nps=round(len([n for n in s.notes if sec.bar_start <= s._bar_of(n.beat) <= sec.bar_end]) / max(t1 - t0, 1e-6), 1))
    return out


def checklist_checks(s, drops=((16, 4), (52, 4)), choruses=("chorus1", "chorus2", "climax")):
    """Section-6 items that need their own measurement: real silences (7), anticipations (10), final ring (15)."""
    issues, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    lifts = [t for (t, v), (t2, v2) in zip(s.pedal_curve, s.pedal_curve[1:]) if v >= 64 > v2]
    import bisect

    def sound_end(n):
        if pedal_at(s.pedal_curve, n.t_off) < 64:
            return n.t_off
        i = bisect.bisect_left(lifts, n.t_off)
        return lifts[i] + 0.08 if i < len(lifts) else n.t_off + 6

    # 7. drops: a gap with no key down and the pedal up, >= 0.5 s, ending at the entrance pickup
    for bar, beat in drops:
        b = s.pos(bar, beat)
        t_b = float(np.interp(b, [x["beat0"] for x in s.timeline["bars"]], [x["t"] for x in s.timeline["bars"]]))
        before = [n for n in ns if n.t_on < t_b + 0.6]
        after = [n for n in ns if n.t_on >= t_b - 0.3]
        if not before or not after:
            continue
        last_end = max(sound_end(n) for n in ns if n.t_on <= t_b)
        nxt = min(n.t_on for n in ns if n.t_on > t_b)
        gap = nxt - last_end
        info.append(f"drop at bar {bar} beat {beat}: silence {gap:.2f} s (sound ends {last_end:.2f}, next onset {nxt:.2f})")
        if gap < 0.5:
            issues.append(f"DROP bar {bar}: only {gap:.2f} s of silence")
    # 10. anticipations: per 2-bar pair of a chorus, >= 1 note struck on the last 8th of a bar and still held
    #     (key or tie) across the barline, or a bass/LH push on step 14+ that carries the next harmony
    for sec in s.sections:
        if sec.name not in choruses:
            continue
        for b0 in range(sec.bar_start, sec.bar_end + 1, 2):
            cnt = 0
            for bar in (b0, b0 + 1):
                bl = s.bar_start(bar + 1)
                for n in ns:
                    if bl - 0.5 - 1e-6 <= n.beat < bl - 1e-6 and n.beat + n.dur > bl + 1e-6:
                        cnt += 1
                    elif bl - 0.5 - 1e-6 <= n.beat < bl - 1e-6 and n.voice == "mel" and bar < sec.bar_end:
                        cnt += 1          # pickup into the next bar's phrase
            if cnt == 0:
                issues.append(f"ANTICIPATION none in {sec.name} bars {b0}-{b0 + 1}")
        info.append(f"anticipations checked in {sec.name}")
    # 15. final ring: last melody onset -> pedal fully up
    mel = [n for n in ns if n.voice == "mel"]
    t_last = max(n.t_on for n in mel)
    t_up = max(t for t, v in s.pedal_curve if v > 0) if s.pedal_curve else 0
    ring = max(t_up, max(n.t_off for n in ns)) - t_last
    info.append(f"final ring: last melody onset {t_last:.2f} s, pedal fully released {t_up:.2f} s -> {ring:.1f} s")
    if ring < 6:
        issues.append(f"RING only {ring:.1f} s")
    return issues, info
