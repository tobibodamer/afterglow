"""Helpers for the arranger candidate of "Afterglow": fingering solver, balance pass and validators.

Kept out of music/dsl.py on purpose (other agents use the DSL). Everything is deterministic.
"""
from __future__ import annotations

import itertools
import math

from dsl import pname

BLACK = {1, 3, 6, 8, 10}
LIL = {1: 52, 2: 51, 3: 48, 4: 46, 5: 46, 6: 47, 7: 34, 8: 41, 9: 41, 10: 41, 11: 41, 13: 40, 14: 39, 15: 31, 16: 29}

# Parncutt et al. (1997) finger-pair distances (semitones), RH, finger i < j, d = pitch(j) - pitch(i).
# (MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac); thumb pairs widened a little for a large male hand.
PAIR = {
    (1, 2): (-5, -3, 1, 5, 9, 11), (1, 3): (-4, -2, 3, 7, 11, 13), (1, 4): (-3, -1, 5, 9, 13, 15),
    (1, 5): (-1, 1, 7, 10, 14, 16), (2, 3): (1, 1, 1, 2, 3, 6), (2, 4): (1, 1, 3, 4, 6, 8),
    (2, 5): (2, 2, 5, 6, 9, 11), (3, 4): (1, 1, 1, 2, 3, 5), (3, 5): (1, 1, 3, 4, 6, 8),
    (4, 5): (1, 1, 1, 2, 3, 6),
}


def _pair_d(hand, f1, p1, f2, p2):
    """Normalised distance for the finger pair, as Parncutt defines it (RH; LH mirrored)."""
    if f1 > f2:
        f1, p1, f2, p2 = f2, p2, f1, p1
    d = (p2 - p1) if hand == "R" else (p1 - p2)
    return (f1, f2), d


def _stretch_cost(hand, f1, p1, f2, p2, simultaneous):
    key, d = _pair_d(hand, f1, p1, f2, p2)
    mnp, mnc, mnr, mxr, mxc, mxp = PAIR[key]
    if simultaneous:
        if d < max(mnp, 1) or d > mxp:
            return None                      # impossible chord shape
    c = 0.0
    if d < mnc:
        c += 2 * (mnc - d)
    if d > mxc:
        c += 2 * (d - mxc)
    if d < mnr:
        c += (mnr - d)
    if d > mxr:
        c += (d - mxr)
    if key[0] != 1 and d < 1:               # crossing two long fingers
        c += 12
    return c


def _ordered_ok(hand, pairs):
    """pairs: list of (pitch, finger) held together -> fingers must be monotone with pitch."""
    ps = sorted(pairs)
    fs = [f for _, f in ps]
    if len(set(fs)) != len(fs):
        return False
    if hand == "R":
        return all(a < b for a, b in zip(fs, fs[1:]))
    return all(a > b for a, b in zip(fs, fs[1:]))


def assign_fingers(score, beam=48):
    """Beam-search fingering per hand over onset groups (same score beat). Respects fingers given in the
    score (%n suffixes). Uses key-hold (t_on..t_off) to know which fingers are still down."""
    for hand in ("R", "L"):
        hs = sorted([n for n in score.notes if n.hand == hand], key=lambda n: (n.beat, n.pitch))
        groups = []
        for n in hs:
            if groups and abs(groups[-1][0].beat - n.beat) < 1e-6:
                groups[-1].append(n)
            else:
                groups.append([n])
        groups.sort(key=lambda g: min(x.t_on for x in g))
        # state: (cost, fingers dict id->f, last_group list[(p,f,t_on)])
        states = [(0.0, {}, [])]
        for gi, g in enumerate(groups):
            g = sorted(g, key=lambda n: n.pitch)
            t0 = min(n.t_on for n in g)
            held_notes = [m for gg in groups[max(0, gi - 40):gi] for m in gg if m.t_off > t0 + 0.012]
            k = len(g)
            if hand == "R":
                combos = list(itertools.combinations(range(1, 6), k))
            else:
                combos = [tuple(reversed(c)) for c in itertools.combinations(range(1, 6), k)]
            new_states = []
            for cost, fmap, last in states:
                held = [(m.pitch, fmap[id(m)]) for m in held_notes if id(m) in fmap]
                for cmb in combos:
                    if any(n.finger and n.finger != f for n, f in zip(g, cmb)):
                        continue
                    newp = [(n.pitch, f) for n, f in zip(g, cmb)]
                    allp = held + newp
                    if not _ordered_ok(hand, allp):
                        continue
                    c = 0.0
                    ok = True
                    sp = sorted(allp)
                    for (pa, fa), (pb, fb) in zip(sp, sp[1:]):
                        sc = _stretch_cost(hand, fa, pa, fb, pb, True)
                        if sc is None:
                            ok = False
                            break
                        c += 0.5 * sc
                    if not ok:
                        continue
                    # transition from the previous struck group
                    if last:
                        dt = t0 - last[0][2]
                        w = 1.0 if dt < 0.3 else (0.55 if dt < 0.6 else 0.25)
                        jump = abs((min(p for p, _ in newp) + max(p for p, _ in newp)) / 2 -
                                   (min(p for p, _, _ in last) + max(p for p, _, _ in last)) / 2)
                        if jump > 9 and dt > 0.18:
                            w *= 0.25                      # hand repositions
                        tc = 0.0
                        for p2, f2 in newp:
                            best = 1e9
                            for p1, f1, _ in last:
                                if f1 == f2:
                                    cc = 0.0 if p1 == p2 else 3.0 + 0.3 * abs(p2 - p1)
                                else:
                                    cc = _stretch_cost(hand, f1, p1, f2, p2, False)
                                    if p1 == p2:
                                        cc += 1.0
                                best = min(best, cc)
                            tc += best
                        c += w * tc / len(newp)
                    for p, f in newp:
                        if f == 1 and p % 12 in BLACK:
                            c += 1.6 if k == 1 else 0.6
                        if f == 5 and p % 12 in BLACK and hand == "R" and k == 1:
                            c += 0.4
                        if f == 4:
                            c += 0.15
                    if hand == "L" and k >= 1 and g[0].voice == "bass" and cmb[0] != 5:
                        c += 1.2
                    if hand == "R" and g[-1].voice == "mel" and k >= 3 and cmb[-1] < 4:
                        c += 1.0
                    nf = dict(fmap)
                    for n, f in zip(g, cmb):
                        nf[id(n)] = f
                    new_states.append((cost + c, nf, [(p, f, t0) for p, f in newp]))
            if not new_states:          # fall back: ignore held constraints for this group
                for cost, fmap, last in states[:1]:
                    nf = dict(fmap)
                    for n, f in zip(g, combos[0]):
                        nf[id(n)] = n.finger or f
                    new_states.append((cost + 50, nf, [(n.pitch, nf[id(n)], t0) for n in g]))
            new_states.sort(key=lambda s: s[0])
            # dedupe by last assignment
            seen, states = set(), []
            for st in new_states:
                key = tuple(st[2])
                if key in seen:
                    continue
                seen.add(key)
                states.append(st)
                if len(states) >= beam:
                    break
        best = states[0][1]
        for n in hs:
            if not n.finger:
                n.finger = best[id(n)]


def tidy_releases(score, legato_ms=45.0, restrike_ms=25.0):
    """Key releases a pianist actually makes (run after perform, before fingering).
    - A key must come up before it is struck again (same pitch, either hand): release it
      restrike_ms before the new strike.
    - A tiny legato overlap (< legato_ms) inside one hand is a timing artifact of melody lead /
      jitter, not an intended held note: release just before the next strike, so the held-key
      set the fingering and the animation see is the one the score means.
    Returns the number of releases changed."""
    changed = 0
    for hand in ("R", "L"):
        hs = sorted([n for n in score.notes if n.hand == hand], key=lambda n: n.t_on)
        for i, a in enumerate(hs):
            for b in hs[i + 1:]:
                if b.t_on >= a.t_off:
                    break
                if b.t_on <= a.t_on + 0.001:
                    continue
                if b.pitch == a.pitch:
                    a.t_off = max(a.t_on + 0.03, b.t_on - restrike_ms / 1000)
                    changed += 1
                    break
                if a.t_off - b.t_on < legato_ms / 1000:
                    a.t_off = max(a.t_on + 0.03, b.t_on - 0.003)
                    changed += 1
                    break
    for p in set(n.pitch for n in score.notes):          # cross-hand re-strikes of the same key
        same = sorted([n for n in score.notes if n.pitch == p], key=lambda n: n.t_on)
        for a, b in zip(same, same[1:]):
            if b.t_on < a.t_off + 0.005:
                a.t_off = max(a.t_on + 0.03, b.t_on - restrike_ms / 1000)
                changed += 1
    return changed


def balance(score, gap=12, ghost_floor=18):
    """Final mix pass: every melody onset must be >= gap velocity above any accompaniment struck with it.
    Lowers the accompaniment (never the melody). Returns the number of notes changed."""
    ns = sorted(score.notes, key=lambda n: n.t_on)
    mel = [n for n in ns if n.voice == "mel"]
    changed = 0
    j0 = 0
    for m in mel:
        for o in ns:
            if o is m or o.voice == "mel":
                continue
            if abs(o.t_on - m.t_on) < 0.05 and o.vel > m.vel - gap:
                o.vel = max(8, m.vel - gap)
                changed += 1
    return changed


def pedal_at(curve, t):
    v = 0
    for tt, vv in curve:
        if tt <= t:
            v = vv
        else:
            break
    return v


def my_checks(score, harmony_beats, groove_sections, apex_window=(0.75, 0.82)):
    """Arranger validators on the performed score. Returns (issues, notes) lists of strings."""
    issues, notes = [], []
    ns = sorted(score.notes, key=lambda n: n.t_on)
    dur = max(n.t_off for n in ns)
    # 1 fingers present
    nf = [n for n in ns if not 1 <= n.finger <= 5]
    if nf:
        issues.append(f"FINGER missing on {len(nf)} notes")
    # 2 finger conflicts / ordering among held keys, 3 key collisions, 4/5 span & keys, 6 crossing
    for hand, lim in (("R", 14), ("L", 16)):
        hs = [n for n in ns if n.hand == hand]
        for n in hs:
            held = [m for m in hs if m.t_on <= n.t_on + 0.002 and m.t_off > n.t_on + 0.005]
            held = [m for m in held if not (m is not n and m.beat > n.beat + 1e-6)]
            if not _ordered_ok(hand, [(m.pitch, m.finger) for m in held]):
                issues.append(f"FINGER-ORDER {hand} bar {score._bar_of(n.beat)} t={n.t_on:.2f}: "
                              f"{[(pname(m.pitch), m.finger) for m in sorted(held, key=lambda m: m.pitch)]}")
            ps = [m.pitch for m in held]
            if max(ps) - min(ps) > lim:
                issues.append(f"SPAN {hand} bar {score._bar_of(n.beat)}: {pname(min(ps))}-{pname(max(ps))} = {max(ps) - min(ps)}")
            if len(held) > 5:
                issues.append(f"KEYS {hand} bar {score._bar_of(n.beat)}: {len(held)} keys held")
        # simultaneous LH strikes > 14 only if rolled
        by = {}
        for n in hs:
            by.setdefault(round(n.beat, 5), []).append(n)
        for b, g in by.items():
            ps = [m.pitch for m in g]
            if hand == "L" and max(ps) - min(ps) > 14 and not any(m.roll for m in g):
                issues.append(f"LH-BLOCK bar {score._bar_of(b)}: struck span {max(ps) - min(ps)} not rolled")
    for p in set(n.pitch for n in ns):
        same = sorted([n for n in ns if n.pitch == p], key=lambda n: n.t_on)
        for a, b in zip(same, same[1:]):
            if b.t_on < a.t_off - 0.002:
                issues.append(f"KEY-COLLISION {pname(p)} bar {score._bar_of(b.beat)} ({a.hand}{a.voice} still down when {b.hand}{b.voice} strikes)")
    for n in ns:
        lh = [m.pitch for m in ns if m.hand == "L" and m.t_on <= n.t_on + 0.002 and m.t_off > n.t_on + 0.005]
        rh = [m.pitch for m in ns if m.hand == "R" and m.t_on <= n.t_on + 0.002 and m.t_off > n.t_on + 0.005]
        if lh and rh and max(lh) >= min(rh):
            issues.append(f"CROSS bar {score._bar_of(n.beat)} t={n.t_on:.2f}: LH {pname(max(lh))} >= RH {pname(min(rh))}")
    # 7 leaps (per hand, onset groups by score beat)
    for hand in ("L", "R"):
        groups = {}
        for n in ns:
            if n.hand == hand:
                groups.setdefault(round(n.beat, 5), []).append(n)
        ks = sorted(groups, key=lambda b: min(x.t_on for x in groups[b]))
        for a, b in zip(ks, ks[1:]):
            ga, gb = groups[a], groups[b]
            ca = (min(x.pitch for x in ga) + max(x.pitch for x in ga)) / 2
            cb = (min(x.pitch for x in gb) + max(x.pitch for x in gb)) / 2
            dt = min(x.t_on for x in gb) - min(x.t_on for x in ga)
            j = abs(cb - ca)
            if (j > 24 and dt < 0.30) or (j > 12 and dt < 0.14):
                issues.append(f"LEAP {hand} bar {score._bar_of(b)}: {j:.0f} st in {dt * 1000:.0f} ms")
    # 8 melody prominence, 9 melody on top
    for m in (n for n in ns if n.voice == "mel"):
        others = [o for o in ns if o is not m and o.voice != "mel" and abs(o.t_on - m.t_on) < 0.05]
        if others and m.vel - max(o.vel for o in others) < 12:
            issues.append(f"PROMINENCE bar {score._bar_of(m.beat)} {pname(m.pitch)} vel {m.vel} vs {max(o.vel for o in others)}")
    mel = [n for n in ns if n.voice == "mel"]
    for o in ns:
        if o.voice == "mel":
            continue
        cur = [m for m in mel if m.t_on - 0.05 <= o.t_on < m.t_off - 0.01]
        if cur and o.pitch >= max(m.pitch for m in cur):
            issues.append(f"ON-TOP bar {score._bar_of(o.beat)}: {o.voice} {pname(o.pitch)} >= melody {pname(max(m.pitch for m in cur))}")
    # 10 ghosts
    for g in (n for n in ns if n.voice == "ghost"):
        if not 18 <= g.vel <= 32:
            issues.append(f"GHOST vel {g.vel} bar {score._bar_of(g.beat)}")
    # 11 machine gun
    run = 1
    for a, b in zip(mel, mel[1:]):
        run = run + 1 if a.vel == b.vel else 1
        if run > 4:
            issues.append(f"MACHINE-GUN melody vel {b.vel} x{run} bar {score._bar_of(b.beat)}")
    # 12 duration
    if not 200 <= dur <= 230:
        issues.append(f"DURATION {dur:.1f}s outside 3:20-3:50")
    notes.append(f"duration to last note-off {dur:.2f}s = {int(dur // 60)}:{dur % 60:04.1f}")
    # 13 pedal at every harmony change
    marks = {round(b, 4) for b, k in score.pedal_marks if k in ("change", "down")}
    for hb in harmony_beats:
        if round(hb, 4) not in marks:
            issues.append(f"PEDAL missing at harmony change bar {score._bar_of(hb)} beat {hb - score.bar_start(score._bar_of(hb)) + 1:g}")
    # 14 bass carried by pedal after early key release
    pc = score.pedal_curve
    for n in ns:
        if n.voice == "bass" and n.dur < 1.0 and "dry" not in n.tags:
            if pedal_at(pc, n.t_off + 0.01) < 64:
                issues.append(f"BASS-DROPS bar {score._bar_of(n.beat)} {pname(n.pitch)}: key up at {n.t_off:.2f}s with pedal up")
    # 15 pedal mud (advisory): low notes still ringing under the pedal
    lifts = [t for (t, v), (t2, v2) in zip(pc, pc[1:]) if v >= 64 and v2 < 40] + [t for t, v in pc if v == 0]
    lifts = sorted(set(lifts))

    def ring_end(n):
        if pedal_at(pc, n.t_off + 0.005) < 64:
            return n.t_off
        nxt = [t for t in lifts if t > n.t_off]
        return min(nxt[0] if nxt else 1e9, n.t_on + 3.0)
    ends = {id(n): ring_end(n) for n in ns}
    pm = 0
    for n in ns:
        if n.pitch >= 60:
            continue
        snd = sorted(set(m.pitch for m in ns if m.t_on <= n.t_on + 0.06 and ends[id(m)] > n.t_on + 0.06))
        for a, b in zip(snd, snd[1:]):
            iv = b - a
            if iv in LIL and a < LIL[iv]:
                pm += 1
                notes.append(f"pedal-mud bar {score._bar_of(n.beat)}: {pname(a)}-{pname(b)} ({iv} st) rings together")
                break
    if pm:
        issues.append(f"PEDAL-MUD {pm} low onsets with a muddy interval ringing under the pedal (see notes)")
    # 16 apex
    top = max(m.pitch for m in mel)
    tops = [m for m in mel if m.pitch == top]
    frac = tops[0].t_on / dur
    notes.append(f"apex {pname(top)} x{len(tops)} at {tops[0].t_on:.1f}s = {frac * 100:.1f}% of the piece")
    if len(tops) != 1 or not apex_window[0] <= frac <= apex_window[1]:
        issues.append(f"APEX {pname(top)} occurs {len(tops)}x, first at {frac * 100:.1f}%")
    # 17 breathing (score time; ties are already merged by the DSL)
    for bar in range(1, score._last_bar() + 1):
        b0, b1 = score.bar_start(bar), score.bar_start(bar + 1)
        bm = [m for m in mel if m.beat < b1 - 1e-6 and m.beat + m.dur > b0 + 1e-6]
        if not bm:
            continue
        longest = max(min(m.beat + m.dur, b1 + 2) - max(m.beat, b0 - 2) for m in bm if m.beat >= b0 - 1e-6) if any(m.beat >= b0 - 1e-6 for m in bm) else 4
        cover = sorted((max(m.beat, b0), min(m.beat + m.dur, b1)) for m in bm)
        gap, cur = 0.0, b0
        for x0, x1 in cover:
            gap = max(gap, x0 - cur)
            cur = max(cur, x1)
        gap = max(gap, b1 - cur)
        held_long = any(m.dur >= 1.5 - 1e-6 for m in bm)
        if gap < 0.49 and not held_long:
            issues.append(f"BREATH bar {bar}: no rest >= 1/8 and no note >= 1.5 beats")
    # 18 LH verbatim loops (2-bar segments)
    segs = []
    last = score._last_bar()
    for bar in range(1, last, 2):
        b0, b1 = score.bar_start(bar), score.bar_start(bar + 2)
        segs.append(tuple(sorted((round(n.beat - b0, 3), n.pitch) for n in score.notes if n.hand == "L" and b0 <= n.beat < b1)))
    run = 1
    for a, b in zip(segs, segs[1:]):
        run = run + 1 if a == b and a else 1
        if run > 3:
            issues.append(f"LOOP: LH 2-bar segment repeated {run}x")
    # 19 tempo steadiness in groove sections, 20 swing
    tl = score.timeline
    for sec in score.sections:
        if sec.name not in groove_sections:
            continue
        b0, b1 = int(score.bar_start(sec.bar_start)), int(score.bar_start(sec.bar_end + 1))
        ts = tl["beats"][b0:b1 + 1]
        # beat times include swing only at integer beats (no warp), so this is the pure tempo
        bpms = [60 / (b - a) for a, b in zip(ts, ts[1:])]
        med = sorted(bpms)[len(bpms) // 2]
        dev = max(abs(x - med) / med for x in bpms)
        notes.append(f"tempo {sec.name}: median {med:.1f} bpm, max dev {dev * 100:.2f}%")
        if dev > 0.012:
            issues.append(f"TEMPO {sec.name}: deviates {dev * 100:.1f}% from {med:.1f} bpm")
        if not 0.555 <= sec.swing <= 0.585:
            issues.append(f"SWING {sec.name} = {sec.swing}")
    return issues, notes


def inner_motion(score, span=4, exclude=("mel",)):
    """Count stepwise moves (1-2 st, onsets < 2.5 beats apart) inside each accompaniment voice per 4 bars."""
    out = []
    last = score._last_bar()
    for b in range(1, last + 1, span):
        b0, b1 = score.bar_start(b), score.bar_start(min(b + span, last + 1))
        cnt = 0
        for (hand, voice) in {(n.hand, n.voice) for n in score.notes if n.voice not in exclude}:
            vs = sorted([n for n in score.notes if n.hand == hand and n.voice == voice and b0 <= n.beat < b1],
                        key=lambda n: (n.beat, n.pitch))
            # top line of the voice per onset
            tops = {}
            for n in vs:
                tops.setdefault(round(n.beat, 4), []).append(n.pitch)
            seq = sorted(tops.items())
            for (ta, pa), (tb, pb) in zip(seq, seq[1:]):
                if tb - ta <= 2.5 and (1 <= abs(max(pb) - max(pa)) <= 2 or 1 <= abs(min(pb) - min(pa)) <= 2):
                    cnt += 1
        out.append((b, min(b + span - 1, last), cnt))
    return out


# ---------------------------------------------------------------------------------------------
# Review checks for the research/music.md section-6 checklist items that the validators above
# do not cover. Each returns (issues, notes).
# ---------------------------------------------------------------------------------------------
def review_checks(score, harm, drops, groove_sections, step_ranges):
    """harm: [(abs beat, symbol)], drops: [(bar, beat) of the lone pickup after a silent drop],
    step_ranges: [(bar0, bar1)] where the bass must move as a line (>= 50 % steps)."""
    issues, notes = [], []
    ns = sorted(score.notes, key=lambda n: n.t_on)
    pc = score.pedal_curve
    tl = score.timeline
    hb = sorted(harm)

    # item 7: arrivals after a real silence (all keys up, dampers down)
    for bar, beat in drops:
        b = score.pos(bar, beat)
        pick = [n for n in ns if abs(n.beat - b) < 1e-6]
        if not pick:
            issues.append(f"DROP no pickup note at bar {bar} beat {beat}")
            continue
        tp = min(n.t_on for n in pick)
        before = [n for n in ns if n.t_on < tp - 1e-3]
        last_key = max(n.t_off for n in before)
        zero = [t for t, v in pc if t < tp and v == 0]
        damp = max(zero) if zero else 0.0
        silence = tp - max(last_key, min(damp, tp))
        held = [n for n in before if n.t_off > tp - 0.05]
        notes.append(f"drop before bar {bar + 1}: silence {silence * 1000:.0f} ms (keys up {last_key:.2f}s, "
                     f"dampers down {damp:.2f}s, lone pickup {tp:.2f}s)")
        if silence < 0.25 or held:
            issues.append(f"DROP bar {bar}: only {silence * 1000:.0f} ms of silence before the pickup")
    # item 15: the last chord rings >= 6 s before the pedal release starts
    last_on = max(n.t_on for n in ns)
    last_chord = [n for n in ns if n.t_on > last_on - 1.5]
    t0 = min(n.t_on for n in last_chord)
    rel = [t for (t, v), (t2, v2) in zip(pc, pc[1:]) if v == 127 and v2 < 127 and t > t0]
    t_rel = rel[-1] if rel else max(n.t_off for n in ns)
    notes.append(f"last chord: struck {t0:.2f}s, keys up {max(n.t_off for n in last_chord):.2f}s, pedal release "
                 f"{t_rel:.2f}s -> {pc[-1][0]:.2f}s: ring {t_rel - t0:.1f}s + {pc[-1][0] - t_rel:.2f}s ramp")
    if t_rel - t0 < 6.0:
        issues.append(f"RING last chord rings only {t_rel - t0:.1f}s")
    # item 14: list every stretch with the pedal below 40 for > 0.25 s (must be a drop, a dry fill or the start)
    gaps, start = [], None
    for t, v in pc:
        if v < 40 and start is None:
            start = t
        elif v >= 40 and start is not None:
            if t - start > 0.25:
                gaps.append((start, t))
            start = None
    for a, b in gaps:
        bar = next((x["bar"] for x in reversed(tl["bars"]) if x["t"] <= a + 1e-6), 1)
        notes.append(f"pedal up {a:7.2f}-{b:7.2f}s ({(b - a) * 1000:4.0f} ms) bar {bar}")
    # item 5: the bass is a line (lowest LH note at each harmony change)
    for b0, b1 in step_ranges:
        seq = []
        for beat, sym in hb:
            if score.bar_start(b0) - 1e-6 <= beat < score.bar_start(b1 + 1) - 1e-6:
                low = [n for n in ns if n.hand == "L" and abs(n.beat - beat) < 1e-6]
                if low:
                    seq.append(min(n.pitch for n in low))
        mv = [(b - a) for a, b in zip(seq, seq[1:]) if b != a]
        steps = sum(1 for d in mv if min(abs(d) % 12, 12 - abs(d) % 12) <= 2)
        frac = steps / max(1, len(mv))
        notes.append(f"bass line bars {b0}-{b1}: {' '.join(pname(p) for p in seq)}  steps {steps}/{len(mv)} = {frac * 100:.0f}%")
        if frac < 0.5:
            issues.append(f"BASS-LINE bars {b0}-{b1}: only {frac * 100:.0f}% steps")
    # item 10: anticipations (harmony pushed to the "&" of a beat, or a melody note on the "&" of 4 held over)
    for sec in score.sections:
        if sec.name not in groove_sections:
            continue
        bars = range(sec.bar_start, sec.bar_end + 1)
        cnt = {}
        for beat, sym in hb:
            bar = score._bar_of(beat)
            if bar in bars and abs((beat - score.bar_start(bar)) % 1 - 0.5) < 1e-6:
                cnt[bar] = cnt.get(bar, 0) + 1
        for n in ns:
            bar = score._bar_of(n.beat)
            if n.voice == "mel" and bar in bars and abs(n.beat - score.bar_start(bar) - 3.5) < 1e-6 and n.dur > 0.6:
                cnt[bar] = cnt.get(bar, 0) + 1
        pairs = [(b, b + 1) for b in range(sec.bar_start, sec.bar_end, 2)]
        bad = [p for p in pairs if cnt.get(p[0], 0) + cnt.get(p[1], 0) == 0]
        notes.append(f"anticipations {sec.name}: {sum(cnt.values())} in {len(bars)} bars; 2-bar spans without one: {bad}")
        if sec.name.startswith("chorus") or sec.name == "climax":
            for p in bad:
                issues.append(f"ANTICIPATION none in chorus bars {p[0]}-{p[1]}")
    # fingering rule: RH thumb off black keys in step-wise melodic runs
    mel = [n for n in ns if n.voice == "mel"]
    tb = []
    for a, b, c in zip(mel, mel[1:], mel[2:]):
        if b.finger == 1 and b.pitch % 12 in BLACK and abs(b.pitch - a.pitch) <= 2 and abs(c.pitch - b.pitch) <= 2 \
                and b.dur <= 0.5:
            tb.append(f"bar {score._bar_of(b.beat)} {pname(b.pitch)}")
    notes.append(f"RH thumb on a black key inside a step-wise run: {len(tb)} {tb[:8]}")
    if tb:
        issues.append(f"THUMB-BLACK {len(tb)} melody notes")
    # item 12: dynamics per section (melody vs accompaniment)
    for sec in score.sections:
        b0, b1 = score.bar_start(sec.bar_start), score.bar_start(sec.bar_end + 1)
        m = [n.vel for n in ns if n.voice == "mel" and b0 <= n.beat < b1]
        a = [n.vel for n in ns if n.voice not in ("mel", "mel8") and b0 <= n.beat < b1]
        if m:
            notes.append(f"dynamics {sec.name:8s}: melody {min(m)}-{max(m)} (mean {sum(m) / len(m):5.1f}), "
                         f"accompaniment mean {sum(a) / max(1, len(a)):5.1f}")
            if max(m) - min(m) < 12:
                issues.append(f"DYN-RANGE {sec.name}: melody velocity range {max(m) - min(m)} < 12")
    return issues, notes


def intended_leadsheet(score, harm, detected_txt):
    """Add the intended chord symbols (with beats) under each bar of the DSL leadsheet."""
    by_bar = {}
    for beat, sym in sorted(harm):
        bar = score._bar_of(beat)
        off = beat - score.bar_start(bar) + 1
        by_bar.setdefault(bar, []).append(sym + ("" if abs(off - 1) < 1e-6 else f"@{off:g}"))
    out = []
    for line in detected_txt.splitlines():
        out.append(line)
        head = line[:4].strip()
        if head.isdigit():
            out.append(f"{'':16s}CHORDS {'  '.join(by_bar.get(int(head), ['(held over)']))}")
    return "\n".join(out)
