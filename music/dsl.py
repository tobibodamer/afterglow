"""Small score DSL for writing solo piano music by hand, then performing it expressively.

Writing:
    s = Score("Afterglow", bpm=78)
    s.section("intro", 1, 4, swing=0.0)
    s.line("R", 1, "r:2 Eb5:1 F5:0.5 G5:0.5 | Bb5:3 Ab5:1", voice="mel", vel=62)
    s.line("L", 1, "[Eb2 Bb2]:1 G3:0.5 Bb3:0.5 Eb4:2", voice="acc", vel=48)

Token grammar for line():
    PITCH:DUR            single note, e.g. Eb5:1  C#4:0.5  G3:1/3
    [P P P]:DUR          chord (all notes same onset and duration)
    r:DUR                rest
    |                    bar line (checked: the bar must be full, then moves to the next bar)
    suffixes after DUR:  >  accent (+12 vel)    -  soft (-10 vel)    '  staccato (x0.45 dur)
                         ~  tie into the next note of the same pitch (extends duration)
                         @NN explicit velocity      ^  roll the chord upward (spread ~40 ms)
                         %3 / %1,3,5  finger(s), chords listed low -> high (1 = thumb)
Positions are (bar, beat) with bar >= 1 and beat 1-based (1 = downbeat, 2.5 = "and" of 2).

Performing (Score.perform) turns beats into seconds using a tempo map, per-phrase rubato
arches, fermatas, swing, melody lead and seeded humanisation, and builds a sustain-pedal curve.
Everything is deterministic for a given seed.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field, asdict
from fractions import Fraction

import numpy as np

NOTE_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def pitch(name: str) -> int:
    m = re.fullmatch(r"([A-Ga-g])([#b]*)(-?\d)", name.strip())
    if not m:
        raise ValueError(f"bad pitch {name!r}")
    letter, acc, octv = m.groups()
    p = NOTE_BASE[letter.upper()] + acc.count("#") - acc.count("b") + (int(octv) + 1) * 12
    if not 21 <= p <= 108:
        raise ValueError(f"pitch {name} ({p}) outside the 88-key range")
    return p


def pname(p: int) -> str:
    return f"{NAMES[p % 12]}{p // 12 - 1}"


def frac(s: str) -> float:
    return float(Fraction(s))


@dataclass
class Note:
    pitch: int
    beat: float          # absolute score position in beats from the start of bar 1
    dur: float           # beats
    vel: int
    hand: str            # "L" or "R"
    voice: str           # "mel", "inner", "bass", "acc", "chord", ...
    roll: bool = False
    tags: list = field(default_factory=list)
    finger: int = 0      # 1..5 (thumb = 1), 0 = let the fingering solver decide
    # filled by perform()
    t_on: float = 0.0
    t_off: float = 0.0
    id: int = -1


@dataclass
class Section:
    name: str
    bar_start: int
    bar_end: int         # inclusive
    swing: float = 0.5   # 0.5 = straight; 0.58 = light 16th swing
    swing_grid: float = 0.5  # beats per swung pair (0.5 = 16ths swing, 1.0 = 8ths swing)
    rubato: float = 0.0  # 0..1 amount of phrase rubato
    humanize: float = 1.0
    offsets_ms: dict | None = None   # per-voice micro-timing, e.g. {"mel": 14, "acc": 7, "bass": 0}
                                     # None -> ballad default: melody leads by 18 ms, LH sits 4 ms late


class Score:
    def __init__(self, title: str, bpm: float, beats_per_bar: int = 4, seed: int = 11):
        self.title = title
        self.base_bpm = bpm
        self.default_bar_beats = beats_per_bar
        self.bar_beats: dict[int, float] = {}
        self.notes: list[Note] = []
        self.sections: list[Section] = []
        self.tempo_pts: list[tuple[float, float]] = [(0.0, bpm)]  # (abs beat, bpm), linear between
        self.fermatas: list[tuple[float, float]] = []             # (abs beat, extra seconds)
        self.phrases: list[tuple[float, float, float]] = []       # (beat0, beat1, peak position 0..1)
        self.pedal_marks: list[tuple[float, str]] = []           # (abs beat, "change"|"down"|"up"|"half")
        self.dyn_pts: list[tuple[float, float]] = []             # (abs beat, gain multiplier) linear
        self.seed = seed

    # ---------------- positions ----------------
    def meter(self, bar: int, beats: float):
        self.bar_beats[bar] = beats

    def beats_in(self, bar: int) -> float:
        return self.bar_beats.get(bar, self.default_bar_beats)

    def bar_start(self, bar: int) -> float:
        return sum(self.beats_in(b) for b in range(1, bar))

    def pos(self, bar: int, beat: float = 1) -> float:
        return self.bar_start(bar) + (beat - 1)

    # ---------------- writing ----------------
    def section(self, name, bar_start, bar_end, **kw):
        self.sections.append(Section(name, bar_start, bar_end, **kw))

    def note(self, hand, bar, beat, p, dur, vel, voice="acc", **kw):
        ps = p if isinstance(p, (list, tuple)) else [p]
        for q in ps:
            self.notes.append(Note(pitch(q) if isinstance(q, str) else q, self.pos(bar, beat), dur, vel, hand, voice, **kw))

    def line(self, hand: str, bar: int, text: str, voice: str = "mel", vel: int = 64, beat: float = 1,
             transpose: int = 0):
        """Sequential tokens starting at (bar, beat). '|' must land exactly on a bar line."""
        cur = self.pos(bar, beat)
        cur_bar = bar
        pending_tie: dict[int, Note] = {}
        toks = re.findall(r"\[[^\]]*\][^\s|]*|\||[^\s|]+", text)
        for tok in toks:
            if tok == "|":
                end = self.bar_start(cur_bar + 1)
                if abs(cur - end) > 1e-6:
                    raise ValueError(f"{hand} line from bar {bar}: bar {cur_bar} has {cur - self.bar_start(cur_bar):.3f} "
                                     f"beats, expected {self.beats_in(cur_bar)} (token stream: {text[:60]}...)")
                cur_bar += 1
                continue
            m = re.fullmatch(r"(\[[^\]]*\]|[^:]+):([0-9./]+)([>\-'~^_]*)(?:@(\d+))?([>\-'~^_]*)(?:%([1-5](?:,[1-5])*))?", tok)
            if not m:
                raise ValueError(f"bad token {tok!r}")
            body, d, flags, v, flags2, fing = m.groups()
            flags = (flags or "") + (flags2 or "")
            dur = frac(d)
            if body == "r":
                cur += dur
                continue
            names = body.strip("[]").split() if body.startswith("[") else [body]
            nv = int(v) if v else vel
            if ">" in flags:
                nv += 12
            if "-" in flags:
                nv -= 10
            sound_dur = dur * (0.45 if "'" in flags else 1.0)
            new_ties = {}
            fl = [int(x) for x in fing.split(",")] if fing else []
            order = sorted(range(len(names)), key=lambda i: pitch(names[i]))
            fmap = {order[i]: fl[i] for i in range(min(len(fl), len(order)))}
            for ni, nm in enumerate(names):
                p = pitch(nm) + transpose
                if p in pending_tie:          # continue a tied note
                    n = pending_tie[p]
                    n.dur += sound_dur
                else:
                    n = Note(p, cur, sound_dur, int(np.clip(nv, 1, 127)), hand, voice, roll="^" in flags,
                             finger=fmap.get(ni, 0))
                    self.notes.append(n)
                if "~" in flags:
                    new_ties[p] = n
            pending_tie = new_ties
            cur += dur
        return cur

    def tempo(self, bar, beat, bpm):
        self.tempo_pts.append((self.pos(bar, beat), bpm))

    def fermata(self, bar, beat, extra_seconds):
        self.fermatas.append((self.pos(bar, beat), extra_seconds))

    def phrase(self, bar0, bar1, peak=0.62, beat0=1, beat1=None):
        """Phrase from (bar0, beat0) to the end of bar1 (or (bar1, beat1)). Drives rubato + dynamics arch."""
        b1 = self.pos(bar1, beat1) if beat1 else self.bar_start(bar1 + 1)
        self.phrases.append((self.pos(bar0, beat0), b1, peak))

    def final_rit(self, bar0, bar1, w=0.6, q=2.5, beat0=1):
        """Friberg & Sundberg (1999) final ritardando over (bar0, beat0) .. end of bar1:
        v(x) = [1 + (w^q - 1) x]^(1/q), w = final/initial tempo, q = 2..3."""
        self.rits = getattr(self, "rits", []) + [(self.pos(bar0, beat0), self.bar_start(bar1 + 1), w, q)]

    def dyn(self, bar, beat, gain):
        """Global dynamics multiplier envelope (linear between points)."""
        self.dyn_pts.append((self.pos(bar, beat), gain))

    def pedal(self, bar, beat=1, kind="change"):
        self.pedal_marks.append((self.pos(bar, beat), kind))

    def pedal_every(self, bar0, bar1, beats=(1,), kind="change"):
        for b in range(bar0, bar1 + 1):
            for bt in beats:
                self.pedal(b, bt, kind)

    # ---------------- performing ----------------
    def _section_at(self, beat: float) -> Section | None:
        for s in self.sections:
            if self.bar_start(s.bar_start) - 1e-9 <= beat < self.bar_start(s.bar_end + 1) - 1e-9:
                return s
        return None

    def _swing(self, beat: float) -> float:
        s = self._section_at(beat)
        if not s or abs(s.swing - 0.5) < 1e-6:
            return beat
        g = s.swing_grid
        k = math.floor(beat / g + 1e-9)
        f = beat / g - k                      # 0..1 inside the swung pair
        # piecewise-linear warp: [0, .5] -> [0, swing], [.5, 1] -> [swing, 1]
        w = f / 0.5 * s.swing if f < 0.5 else s.swing + (f - 0.5) / 0.5 * (1 - s.swing)
        return (k + w) * g

    def _bpm(self, beat: float) -> float:
        pts = sorted(self.tempo_pts)
        if beat <= pts[0][0]:
            bpm = pts[0][1]
        elif beat >= pts[-1][0]:
            bpm = pts[-1][1]
        else:
            for (b0, v0), (b1, v1) in zip(pts, pts[1:]):
                if b0 <= beat <= b1:
                    bpm = v0 + (v1 - v0) * (beat - b0) / max(b1 - b0, 1e-9)
                    break
        # phrase rubato: push a little through the middle, relax into the cadence
        for b0, b1, peak in self.phrases:
            if b0 <= beat < b1:
                s = self._section_at(beat)
                amt = s.rubato if s else 0.0
                x = (beat - b0) / (b1 - b0)
                push = math.sin(math.pi * min(x / max(peak, 1e-3), 1.0) * 0.5) if x < peak else 1.0
                relax = max(0.0, (x - 0.82) / 0.18) ** 2
                bpm *= 1 + amt * (0.045 * push * (1 - relax) - 0.16 * relax)
        for b0, b1, w, q in getattr(self, "rits", []):
            if b0 <= beat < b1:
                x = (beat - b0) / (b1 - b0)
                bpm *= (1 + (w ** q - 1) * x) ** (1 / q)
        return bpm

    def _beat_to_sec_table(self, total_beats: float, step=1 / 96):
        n = int(math.ceil(total_beats / step)) + 2
        beats = np.arange(n) * step
        bpm = np.array([self._bpm(b) for b in beats])
        dt = 60.0 / bpm * step
        t = np.concatenate([[0.0], np.cumsum(dt)[:-1]])
        for fb, extra in sorted(self.fermatas):          # holds stretch time after the fermata point
            t = t + np.where(beats > fb + 1e-9, extra, 0.0)
        return beats, t

    def _dyn_gain(self, beat):
        if not self.dyn_pts:
            return 1.0
        pts = sorted(self.dyn_pts)
        if beat <= pts[0][0]:
            return pts[0][1]
        if beat >= pts[-1][0]:
            return pts[-1][1]
        for (b0, g0), (b1, g1) in zip(pts, pts[1:]):
            if b0 <= beat <= b1:
                return g0 + (g1 - g0) * (beat - b0) / max(b1 - b0, 1e-9)
        return 1.0

    def perform(self, lead_in: float = 0.0):
        rng = np.random.default_rng(self.seed)
        total = max(n.beat + n.dur for n in self.notes) + 8
        tb, ts = self._beat_to_sec_table(total)
        b2s = lambda b: float(np.interp(b, tb, ts)) + lead_in

        notes = sorted(self.notes, key=lambda n: (n.beat, n.hand, -n.pitch))
        # group simultaneous onsets per hand for melody lead + rolls
        groups: dict[tuple, list[Note]] = {}
        for n in notes:
            groups.setdefault((round(n.beat, 4), n.hand), []).append(n)
        jit_cache: dict[float, float] = {}
        for (b, hand), grp in groups.items():
            sec = self._section_at(b)
            hum = sec.humanize if sec else 1.0
            if b not in jit_cache:
                jit_cache[b] = float(rng.normal(0, 0.0045)) * hum   # shared beat-level wobble
            sb = self._swing(b)
            base_t = b2s(sb) + jit_cache[b] + float(rng.normal(0, 0.0025)) * hum
            offs = sec.offsets_ms if sec else None
            if hand == "L" and offs is None:
                base_t += 0.004 * hum                                   # LH sits a hair behind
            grp.sort(key=lambda n: n.pitch)
            rolled = any(n.roll for n in grp)
            for i, n in enumerate(grp):
                t = base_t
                if rolled:
                    t += i * 0.038
                if offs is None:
                    if n.voice == "mel":
                        t -= 0.018 * hum                                # melody lead (ballad)
                else:
                    t += offs.get(n.voice, offs.get("default", 0)) / 1000.0   # groove: laid-back layers
                n.t_on = max(0.0, t)
                end_b = self._swing(n.beat + n.dur) if n.dur < 1.01 else n.beat + n.dur
                n.t_off = max(n.t_on + 0.04, b2s(end_b) - 0.012 + float(rng.normal(0, 0.004)) * hum)
                # dynamics: phrase arch + global envelope + seeded jitter
                g = self._dyn_gain(n.beat)
                for p0, p1, peak in self.phrases:
                    if p0 <= n.beat < p1:
                        x = (n.beat - p0) / (p1 - p0)
                        arch = math.sin(math.pi * min(x / peak, 1) * 0.5) if x < peak else math.cos(math.pi * 0.5 * (x - peak) / (1 - peak))
                        g *= 0.9 + 0.16 * arch
                v = n.vel * g + rng.normal(0, 2.2) * hum
                n.vel = int(np.clip(round(v), 8, 124))
        self.notes = sorted(notes, key=lambda n: (n.t_on, n.pitch))
        for i, n in enumerate(self.notes):
            n.id = i
        self.pedal_curve = self._pedal_curve(b2s)
        self.timeline = self._timeline(b2s)
        self.lead_in = lead_in
        return self

    def _pedal_curve(self, b2s):
        """List of (t, cc64 value). 'change' = legato re-pedal right after the new harmony sounds."""
        ev = []
        marks = sorted(self.pedal_marks)
        down = False
        for b, kind in marks:
            t = b2s(self._swing(b))
            if kind == "change":
                if down:
                    ev += [(t + 0.035, 127), (t + 0.075, 18), (t + 0.115, 0), (t + 0.17, 0), (t + 0.25, 127)]
                else:
                    ev += [(t + 0.02, 0), (t + 0.11, 127)]
                down = True
            elif kind == "down":
                ev += [(t, 0), (t + 0.09, 127)]
                down = True
            elif kind == "half":
                ev += [(t, 127), (t + 0.06, 60), (t + 0.14, 100)]
                down = True
            elif kind == "up":
                ev += [(t, 127 if down else 0), (t + 0.12, 0)]
                down = False
        ev.sort()
        return [(round(t, 4), int(v)) for t, v in ev]

    def _timeline(self, b2s):
        last = max(self._last_bar(), 1)
        bars = [{"bar": b, "beat0": self.bar_start(b), "t": round(b2s(self.bar_start(b)), 4), "beats": self.beats_in(b)}
                for b in range(1, last + 2)]
        secs = [{"name": s.name, "bar_start": s.bar_start, "bar_end": s.bar_end,
                 "t_start": round(b2s(self.bar_start(s.bar_start)), 4),
                 "t_end": round(b2s(self.bar_start(s.bar_end + 1)), 4)} for s in self.sections]
        phr = [{"t0": round(b2s(p0), 4), "t1": round(b2s(p1), 4), "peak": pk} for p0, p1, pk in sorted(self.phrases)]
        beats = [round(b2s(self._swing(float(k))), 4) for k in range(int(self.bar_start(last + 1)) + 1)]
        return {"bars": bars, "sections": secs, "phrases": phr, "beats": beats}

    def _last_bar(self):
        end = max(n.beat + n.dur for n in self.notes)
        b = 1
        while self.bar_start(b + 1) < end - 1e-9:
            b += 1
        return b

    # ---------------- output ----------------
    def to_json(self, path):
        data = {
            "title": self.title, "lead_in": self.lead_in,
            "duration": round(max(n.t_off for n in self.notes), 4),
            "notes": [{"id": n.id, "pitch": n.pitch, "name": pname(n.pitch), "t_on": round(n.t_on, 5),
                       "t_off": round(n.t_off, 5), "vel": n.vel, "hand": n.hand, "voice": n.voice,
                       "finger": n.finger, "bar": self._bar_of(n.beat),
                       "section": (self._section_at(n.beat).name if self._section_at(n.beat) else ""),
                       "beat": round(n.beat, 4)} for n in self.notes],
            "pedal": self.pedal_curve, **self.timeline,
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=0)
        return data

    def to_midi(self, path):
        import mido
        tpb = 960
        mid = mido.MidiFile(ticks_per_beat=tpb)
        sec2tick = lambda t: int(round(t * tpb * 2))     # fixed 120 bpm grid: 1 s = 2 beats
        for hand, name in (("R", "Right hand"), ("L", "Left hand")):
            tr = mido.MidiTrack()
            mid.tracks.append(tr)
            tr.append(mido.MetaMessage("track_name", name=name, time=0))
            if hand == "R":
                tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
            ev = []
            for n in self.notes:
                if n.hand == hand:
                    ev.append((sec2tick(n.t_on), 1, mido.Message("note_on", note=n.pitch, velocity=n.vel)))
                    ev.append((sec2tick(n.t_off), 0, mido.Message("note_off", note=n.pitch, velocity=40)))
            if hand == "R":
                for t, v in self.pedal_curve:
                    ev.append((sec2tick(t), 2, mido.Message("control_change", control=64, value=v)))
            ev.sort(key=lambda e: (e[0], e[1]))
            last = 0
            for tick, _, msg in ev:
                tr.append(msg.copy(time=tick - last))
                last = tick
        mid.save(path)

    # ---------------- checks ----------------
    def check(self):
        """Playability and writing checks. Returns a list of human-readable issues."""
        issues = []
        by = {}
        for n in self.notes:
            by.setdefault((round(n.beat, 4), n.hand), []).append(n)
        for (b, h), g in sorted(by.items()):
            ps = sorted(n.pitch for n in g)
            bar = self._bar_of(b)
            if ps[-1] - ps[0] > 14:
                issues.append(f"bar {bar} beat {b - self.bar_start(bar) + 1:.2f} {h}: span {ps[-1] - ps[0]} semitones {[pname(p) for p in ps]}")
            if len(ps) > 5:
                issues.append(f"bar {bar} {h}: {len(ps)} notes at once")
            if len(set(ps)) != len(ps):
                issues.append(f"bar {bar} {h}: duplicate pitch in chord")
        # hand overlap: same pitch struck by both hands at once
        onset = {}
        for n in self.notes:
            onset.setdefault(round(n.beat, 4), []).append(n)
        for b, g in onset.items():
            l = [n.pitch for n in g if n.hand == "L"]
            r = [n.pitch for n in g if n.hand == "R"]
            if l and r and max(l) > min(r):
                issues.append(f"bar {self._bar_of(b)}: hands cross/overlap (LH top {pname(max(l))} > RH bottom {pname(min(r))})")
            if set(l) & set(r):
                issues.append(f"bar {self._bar_of(b)}: same pitch in both hands")
        # bar fill per hand
        return issues

    def _bar_of(self, beat):
        b = 1
        while self.bar_start(b + 1) <= beat + 1e-9:
            b += 1
        return b

    def report(self):
        lines = []
        for s in self.sections:
            ns = [n for n in self.notes if self.bar_start(s.bar_start) <= n.beat < self.bar_start(s.bar_end + 1)]
            if not ns:
                continue
            mel = [n for n in ns if n.voice == "mel"]
            lines.append(
                f"{s.name:14s} bars {s.bar_start:3d}-{s.bar_end:3d}  t={min(n.t_on for n in ns):6.1f}s  notes={len(ns):4d}  "
                f"RH {pname(min(n.pitch for n in ns if n.hand == 'R')) if any(n.hand == 'R' for n in ns) else '-'}-"
                f"{pname(max(n.pitch for n in ns if n.hand == 'R')) if any(n.hand == 'R' for n in ns) else '-'}  "
                f"LH {pname(min(n.pitch for n in ns if n.hand == 'L')) if any(n.hand == 'L' for n in ns) else '-'}-"
                f"{pname(max(n.pitch for n in ns if n.hand == 'L')) if any(n.hand == 'L' for n in ns) else '-'}  "
                f"vel {min(n.vel for n in ns)}-{max(n.vel for n in ns)}  mel {len(mel)}")
        lines.append(f"total duration {max(n.t_off for n in self.notes):.1f}s, {len(self.notes)} notes")
        return "\n".join(lines)

    def leadsheet(self, path=None, split=2):
        """Readable per-bar summary: detected chord per half bar, melody, bass. For human/agent review."""
        Q = {"": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
             "sus4": [0, 5, 7], "sus2": [0, 2, 7], "add9": [0, 2, 4, 7], "m(add9)": [0, 2, 3, 7], "dim": [0, 3, 6],
             "m7b5": [0, 3, 6, 10], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9], "maj9": [0, 2, 4, 7, 11], "m9": [0, 2, 3, 7, 10],
             "9": [0, 2, 4, 7, 10], "aug": [0, 4, 8], "7sus4": [0, 5, 7, 10], "dim7": [0, 3, 6, 9]}

        def detect(ns):
            if not ns:
                return "-"
            w = np.zeros(12)
            for n in ns:
                w[n.pitch % 12] += n.dur * (1.6 if n.voice != "mel" else 0.7)
            bass = min(ns, key=lambda n: n.pitch).pitch % 12
            best, bs = "-", -1e9
            for r in range(12):
                for q, iv in Q.items():
                    pcs = {(r + i) % 12 for i in iv}
                    s = sum(w[p] for p in pcs) - 0.8 * sum(w[p] for p in range(12) if p not in pcs) - 0.15 * len(iv)
                    s += 0.6 * w.max() * (r == bass)
                    if s > bs:
                        bs, best = s, NAMES[r] + q + ("" if r == bass else "/" + NAMES[bass])
            return best

        out = []
        last = self._last_bar()
        for b in range(1, last + 1):
            b0, b1 = self.bar_start(b), self.bar_start(b + 1)
            sec = self._section_at(b0)
            ns = [n for n in self.notes if b0 <= n.beat < b1]
            halves = []
            for k in range(split):
                h0 = b0 + (b1 - b0) * k / split
                h1 = b0 + (b1 - b0) * (k + 1) / split
                halves.append(detect([n for n in self.notes if n.beat < h1 and n.beat + n.dur > h0]))
            mel = " ".join(f"{pname(n.pitch)}@{n.beat - b0 + 1:g}" for n in sorted(ns, key=lambda n: n.beat) if n.voice == "mel")
            bass = " ".join(f"{pname(n.pitch)}@{n.beat - b0 + 1:g}" for n in sorted(ns, key=lambda n: n.beat)
                            if n.hand == "L" and n.pitch == min(m.pitch for m in ns if m.hand == "L" and abs(m.beat - n.beat) < 1e-6))
            vel = f"{min(n.vel for n in ns)}-{max(n.vel for n in ns)}" if ns else "-"
            out.append(f"{b:3d} [{sec.name if sec else '?':10s}] {' | '.join(halves):24s} v{vel:7s} MEL {mel}\n"
                       f"{'':16s}BASS {bass}  (#notes {len(ns)})")
        txt = "\n".join(out)
        if path:
            open(path, "w").write(txt)
        return txt

    def pianoroll(self, path, t0=None, t1=None):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        ns = self.notes
        t0 = t0 if t0 is not None else 0
        t1 = t1 if t1 is not None else max(n.t_off for n in ns)
        fig, ax = plt.subplots(figsize=(max(12, (t1 - t0) / 2.5), 7), dpi=110)
        col = {"mel": "#e4572e", "inner": "#f3a712", "bass": "#29335c", "acc": "#669bbc", "chord": "#8e9aaf"}
        for n in ns:
            if n.t_off < t0 or n.t_on > t1:
                continue
            ax.add_patch(plt.Rectangle((n.t_on, n.pitch - 0.4), n.t_off - n.t_on, 0.8,
                                       color=col.get(n.voice, "#999"), alpha=0.35 + 0.65 * n.vel / 127, lw=0))
        for bar in self.timeline["bars"]:
            if t0 <= bar["t"] <= t1:
                ax.axvline(bar["t"], color="#ccc", lw=0.5)
                ax.text(bar["t"], 108.5, str(bar["bar"]), fontsize=6, color="#888")
        for t, v in self.pedal_curve:
            pass
        pc = np.array(self.pedal_curve) if self.pedal_curve else np.zeros((0, 2))
        if len(pc):
            ax.plot(pc[:, 0], 22 + pc[:, 1] / 127 * 4, color="#2a9d8f", lw=0.8)
        ax.set_xlim(t0, t1)
        ax.set_ylim(20, 110)
        ax.set_xlabel("seconds")
        fig.tight_layout()
        fig.savefig(path)
        plt.close(fig)
