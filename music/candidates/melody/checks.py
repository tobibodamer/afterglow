"""Validators for the melody candidate (run on a performed Score). Each returns (issues, info)."""
from __future__ import annotations

import numpy as np

from lib import pname, BLACK

LIL = {1: 52, 2: 51, 3: 48, 4: 46, 5: 46, 6: 47, 8: 41, 9: 41, 10: 41, 11: 41, 13: 40, 14: 39, 15: 31, 16: 29}


def _held_at(ns, t, eps=0.03):
    return [m for m in ns if m.t_on <= t + eps and m.t_off > t + eps]


def playability(s):
    iss, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    byh = {h: [n for n in ns if n.hand == h] for h in "LR"}
    # span / keys per hand (physically held keys)
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
                    iss.append(f"SPAN-L struck 10th t={n.t_on:6.2f} bar {s._bar_of(n.beat)} (15-16 st must be broken/rolled)")
            if len(ps) > 5:
                iss.append(f"KEYS {hand} t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: {len(ps)} keys held")
    # hands crossing (any LH key held at or above an RH key held at the same moment)
    for n in ns:
        other = byh["R" if n.hand == "L" else "L"]
        h = _held_at(other, n.t_on) + [m for m in other if abs(m.t_on - n.t_on) < 0.03]
        if not h:
            continue
        if n.hand == "L" and n.pitch >= min(m.pitch for m in h):
            iss.append(f"CROSS t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: LH {pname(n.pitch)} >= RH {pname(min(m.pitch for m in h))}")
        if n.hand == "R" and n.pitch <= max(m.pitch for m in h):
            iss.append(f"CROSS t={n.t_on:6.2f} bar {s._bar_of(n.beat)}: RH {pname(n.pitch)} <= LH {pname(max(m.pitch for m in h))}")
    # leaps: cluster onsets within 40 ms, compare hand centroids
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
    # mud: adjacent intervals among notes struck within 60 ms or still held
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
    # fingers
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


def melody(s, sections):
    iss, info = [], []
    ns = sorted(s.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    acc = [n for n in ns if n.voice != "mel"]
    weak, worst = 0, 99
    for n in mel:
        others = [m.vel for m in acc if abs(m.t_on - n.t_on) < 0.05]
        if others:
            d = n.vel - max(others)
            worst = min(worst, d)
            if d < 12:
                weak += 1
                iss.append(f"PROMINENCE t={n.t_on:6.2f} bar {s._bar_of(n.beat)} mel {pname(n.pitch)} v{n.vel} vs acc v{max(others)}")
    info.append(f"melody prominence: worst margin {worst} (need >= 12), weak onsets {weak}")
    # on top: no accompaniment key held at/above a sounding melody key
    for n in mel:
        for m in acc:
            ov = min(n.t_off, m.t_off) - max(n.t_on, m.t_on)
            if ov > 0.03 and m.pitch >= n.pitch:
                iss.append(f"NOT ON TOP t={max(n.t_on, m.t_on):6.2f} bar {s._bar_of(n.beat)}: {m.voice} {pname(m.pitch)} >= mel {pname(n.pitch)}")
            elif ov > 0.03 and m.hand == "R" and 0 < n.pitch - m.pitch < 3:
                iss.append(f"RUB t={max(n.t_on, m.t_on):6.2f} bar {s._bar_of(n.beat)}: RH {m.voice} {pname(m.pitch)} < 3 st under mel {pname(n.pitch)}")
    # breathing: each bar with melody has a rest >= 0.5 beat or a note >= 1.5 beats (ties count)
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
    # machine-gun velocities
    run = 1
    for a, b in zip(mel, mel[1:]):
        run = run + 1 if a.vel == b.vel else 1
        if run > 4:
            iss.append(f"VEL-REPEAT t={b.t_on:6.2f}: >4 equal melody velocities")
    # per-section melody velocity range and register
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
    return iss, info


def structure(s, sections, changes, drops, apex_name="climax"):
    """changes: list of (abs beat, chord symbol, section name). drops: list of downbeat bars after a drop."""
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
    if len(tops) != 1 or not 0.75 <= frac <= 0.82 or sec_of(tops[0]) != apex_name:
        iss.append("APEX must occur once, in the climax, at 75-82 % of the duration")
    vmax = {x["name"]: max([n.vel for n in mel if x["b0"] <= n.beat < x["b1"]] or [0]) for x in sections}
    loud = max(vmax, key=vmax.get)
    info.append("melody max velocity per section: " + ", ".join(f"{k} {v}" for k, v in vmax.items()))
    if loud != apex_name:
        iss.append(f"LOUDEST section is {loud}, not the climax")
    # ghosts
    gh = [n for n in ns if n.voice == "ghost"]
    bad = [n for n in gh if not 18 <= n.vel <= 32]
    info.append(f"ghost notes: {len(gh)}, velocity {min([n.vel for n in gh] or [0])}-{max([n.vel for n in gh] or [0])}")
    if bad:
        iss.append(f"GHOST velocity outside 18-32 on {len(bad)} notes")
    # pedal
    pc = np.array(s.pedal_curve, dtype=float)
    ped = lambda t: float(np.interp(t, pc[:, 0], pc[:, 1])) if len(pc) else 0.0
    marks = {round(b, 4) for b, k in s.pedal_marks if k in ("change", "down")}
    tb = lambda b: float(np.interp(b, [x["beat0"] for x in s.timeline["bars"]], [x["t"] for x in s.timeline["bars"]]))
    ch_t = []
    for b, sym, sec in changes:
        if round(b, 4) not in marks:
            iss.append(f"PEDAL no change marked at bar {s._bar_of(b)} beat {b - s.bar_start(s._bar_of(b)) + 1:g} ({sym})")
        t = s._b2s(b) if hasattr(s, "_b2s") else tb(b)
        ch_t.append(t)
        win = [ped(t + k * 0.01) for k in range(0, 31)]
        if min(win) > 10:
            iss.append(f"PEDAL blur: not lifted after the change at bar {s._bar_of(b)} ({sym})")
    ch_t = sorted(ch_t)
    dry = 0
    for n in ns:
        if n.voice != "bass":
            continue
        nxt = [t for t in ch_t if t > n.t_on + 0.05]
        if nxt and n.t_off < nxt[0] - 0.08 and ped(n.t_off) < 100 and not any(n.beat >= d0 and n.beat < d1 for d0, d1 in drops):
            dry += 1
            iss.append(f"PEDAL dry bass release t={n.t_off:6.2f} bar {s._bar_of(n.beat)} {pname(n.pitch)} (pedal {ped(n.t_off):.0f})")
    info.append(f"pedal: {len(changes)} harmony changes, {len(s.pedal_marks)} marks, early-released bass not caught: {dry}")
    return iss, info


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
            info.append(f"tempo {sec['name']}: median {med:.2f} bpm, max deviation {dev * 100:.2f}% (beat-level incl. jitter-free map)")
            if dev > 0.012:
                iss.append(f"TEMPO {sec['name']}: deviation {dev * 100:.2f}% > 1%")
    # anticipations per 2 chorus bars
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
    return iss, info


def texture(s, sections, bass_sections=("verse1", "pre1", "verse2", "pre2"), changes=()):
    iss, info = [], []
    lhn = sorted([n for n in s.notes if n.hand == "L"], key=lambda n: (n.beat, n.pitch))
    last = s._last_bar()
    # verbatim 2-bar LH loops
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
    # inner-voice stepwise motion per 4 bars
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
    # bass as a line in verse / pre
    for name in bass_sections:
        sec = next((x for x in sections if x["name"] == name), None)
        if not sec:
            continue
        roots = [b for b, sym, sn in changes if sn == name]
        bass = []
        for b in roots:
            at = [n.pitch for n in lhn if abs(n.beat - b) < 1e-6]
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
    # registers
    lows_b = [n for n in lhn if n.pitch < P_F1]
    eb1 = [n for n in lows_b if n.pitch == P_F1 - 2]
    if len(lows_b) - len(eb1) > 0 or len(eb1) > 1:
        iss.append(f"BASS FLOOR below F1: {len(lows_b)} notes")
    hi = [n for n in s.notes if n.pitch > 96]
    if hi:
        iss.append(f"RH above C7: {len(hi)} notes")
    return iss, info


P_F1 = 29


def voice_leading(s, sections, octave_bars=()):
    """Outer-voice parallels (melody vs bass), plus physical key conflicts the animation cannot show:
    one key held by both hands at once, or a key struck again by the same hand while it is still down."""
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

    def mel_at(t):
        cur = None
        for m in mel:
            if m.t_on <= t + 0.04:
                cur = m
            else:
                break
        return cur
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
    # key conflicts
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


def pedal_mud(s, low=52):
    """Low-interval mud with the pedal taken into account: at every LH onset below E3, every note still sounding
    (key held, or struck since the last damper clear while the pedal is down) is collected; adjacent intervals below
    the low-interval limits are flagged (unisons / octaves / fifths are fine)."""
    iss, info = [], []
    pc = np.array(s.pedal_curve, dtype=float)
    ped = lambda t: float(np.interp(t, pc[:, 0], pc[:, 1]))
    clears = [pc[i, 0] for i in range(1, len(pc)) if pc[i, 1] < 20 <= pc[i - 1, 1]]
    import bisect
    ns = sorted(s.notes, key=lambda n: n.t_on)
    seen = set()
    for n in ns:
        if n.hand != "L" or n.pitch >= low:
            continue
        t = n.t_on + 0.13            # after a legato change at this onset has cleared (up +35..+115 ms)
        i = bisect.bisect_right(clears, t) - 1
        lc = clears[i] if i >= 0 else -1.0
        snd = [m for m in ns if m.t_on < t and (m.t_off > t or (ped(t) >= 64 and ped(m.t_off) >= 64
                                                            and m.t_on > lc - 0.02 and m.t_off > lc))]
        ps = sorted(set(m.pitch for m in snd if m.pitch < 60))
        for a, b in zip(ps, ps[1:]):
            iv = b - a
            if iv in LIL and a < LIL[iv]:
                key = (s._bar_of(n.beat), a, b)
                if key not in seen:
                    seen.add(key)
                    iss.append(f"PEDAL-MUD t={n.t_on:6.2f} bar {key[0]}: {pname(a)}-{pname(b)} ({iv} st) ring together")
    info.append(f"pedal-aware low-register clashes: {len(iss)}")
    return iss, info
