"""Extra musical analysis (informational, run by score.py): melody-vs-accompaniment minor-2nd/9th clashes while
the accompaniment note still sounds (key or pedal), and parallel octaves/fifths between melody and bass."""
import bisect

from lib import pname, pedal_at


def _sound_end_fn(s):
    lifts = [t for (t, v), (t2, v2) in zip(s.pedal_curve, s.pedal_curve[1:]) if v >= 64 > v2]

    def end(n):
        if pedal_at(s.pedal_curve, n.t_off) < 64:
            return n.t_off
        i = bisect.bisect_left(lifts, n.t_off)
        return lifts[i] if i < len(lifts) else n.t_off + 6
    return end


def clashes(s, allowed=()):
    """Melody onsets that sound a minor 2nd / minor 9th / 2 octaves + m2 against an accompaniment note that
    is still ringing (struck before or with it, not yet damped)."""
    end = _sound_end_fn(s)
    acc = [n for n in s.notes if n.voice != "mel"]
    out = []
    for m in (n for n in s.notes if n.voice == "mel"):
        for a in acc:
            if a.t_on <= m.t_on + 0.03 and end(a) > m.t_on + 0.08:
                iv = (m.pitch - a.pitch)
                if iv > 0 and iv % 12 == 1:
                    bar = s._bar_of(m.beat)
                    if bar in allowed:
                        continue
                    out.append(f"bar {bar:2d} t={m.t_on:6.2f} mel {pname(m.pitch)} vs {a.voice} {pname(a.pitch)} "
                               f"(+{iv})")
    return out


def parallels(s):
    """Successive bass attacks vs the melody note sounding at each: P8/P5 -> P8/P5 with both voices moving."""
    mel = sorted([n for n in s.notes if n.voice == "mel"], key=lambda n: n.t_on)
    bass = sorted([n for n in s.notes if n.voice == "bass"], key=lambda n: n.t_on)
    # collapse octave-doubled bass onsets to the lowest note
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
    out = []
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
                    (b.pitch - pb.pitch) * (m.pitch - pm.pitch) > 0:
                out.append(f"bar {s._bar_of(b.beat):2d} t={b.t_on:6.2f} parallel {'8ve' if iv == 0 else '5th'}: "
                           f"{pname(pb.pitch)}/{pname(pm.pitch)} -> {pname(b.pitch)}/{pname(m.pitch)}")
        prev = (b, m, iv)
    return out
