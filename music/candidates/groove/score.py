"""Afterglow -- groove candidate (producer / pocket lens).  Run:
    E:\\experimentswithclaude\\random\\afterglow\\.venv\\Scripts\\python.exe score.py

Writes into this folder: score.json, score.mid, leadsheet.txt, checks.txt, report.txt, roll_*.png

Form (69 bars, Eb -> C minor bridge -> F climax) and what each section adds (+) or removes (-):
  1-4    intro     free time, rolled chorus chords, hook fragment (alpha + beta) -- the response is withheld
  5-12   verse 1   + stepwise bass line and moving tenor (ballad, rubato, melody leads)
  13-16  pre 1     + 8th-note shell pulse; dry stab + DROP (a beat of silence, pedal up)
  17-24  chorus 1  + GROOVE: kick/snare LH, ghost notes, 56 % 16th swing, RH off-beat hats, melody laid back
  25-28  verse 2   - hats; LH turns "lazy" (pushed snare on the & of 2, walking bass), melody further behind
  29-32  pre 2     + RH harmony a third/sixth under the melody + 16th ghost ticks; a LH fill instead of a drop
  33-40  chorus 2  + tenor countermelody, denser comping, octave melody 37-38; deceptive V -> vi with the
                     sus4 Eb held over as the minor third of C minor
  41-48  bridge    - groove, - swing: half-time chorale, rubato, long-note minor melody, line cliche
  49-52  build     C pedal; rhythm doubles every bar (dotted quarters -> 8ths -> 16ths hand-to-hand -> sweep),
                     accelerando 74 -> 80, crescendo; DROP (pedal up, silence + 0.5 s)
  53-60  climax    F major (+2): octave melody, LH octave pushes, apex F6 once
  61-62  tag       first fortissimo tonic; decays
  63-66  final A   - everything: the hook alone, pp
  67-69  coda      IVmaj9 -> ivm6 -> Iadd9, minor-plagal, final ritardando, ring, pedal release ramp
"""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import lib  # noqa: E402
from lib import Score, Writer, pname  # noqa: E402
import checks  # noqa: E402
import analysis  # noqa: E402

OUT = HERE

GROOVE_OFF = {"mel": 14, "inner": 14, "counter": 7, "backbeat": 9, "acc": 6, "ghost": 3, "bass": 0, "default": 0}
LAZY_OFF = {"mel": 19, "inner": 19, "counter": 9, "backbeat": 13, "acc": 8, "ghost": 4, "bass": 0, "default": 0}
TIGHT_OFF = {"mel": 9, "inner": 9, "counter": 5, "backbeat": 6, "acc": 4, "ghost": 2, "bass": 0, "default": 0}

SECTIONS = [
    ("intro", 1, 4, dict(swing=0.5, rubato=0.9)),
    ("verse1", 5, 12, dict(swing=0.5, rubato=0.5)),
    ("pre1", 13, 16, dict(swing=0.5, rubato=0.3)),
    ("chorus1", 17, 24, dict(swing=0.56, rubato=0.04, offsets_ms=GROOVE_OFF)),
    ("verse2", 25, 28, dict(swing=0.57, rubato=0.04, offsets_ms=LAZY_OFF)),
    ("pre2", 29, 32, dict(swing=0.57, rubato=0.04, offsets_ms=GROOVE_OFF)),
    ("chorus2", 33, 40, dict(swing=0.58, rubato=0.04, offsets_ms=GROOVE_OFF)),
    ("bridge", 41, 48, dict(swing=0.5, rubato=0.6)),
    ("build", 49, 52, dict(swing=0.5, rubato=0.0, humanize=0.6)),
    ("climax", 53, 60, dict(swing=0.56, rubato=0.03, offsets_ms=TIGHT_OFF)),
    ("tag", 61, 62, dict(swing=0.5, rubato=0.4)),
    ("finalA", 63, 66, dict(swing=0.5, rubato=0.9)),
    ("coda", 67, 69, dict(swing=0.5, rubato=0.9)),
]

TEMPO = [(1, 1, 68), (4, 3, 60), (5, 1, 76), (13, 1, 76), (16, 3, 78), (17, 1, 78), (40, 4.99, 78),
         (41, 1, 74), (48, 4, 72), (49, 1, 74), (52, 3, 80), (53, 1, 80), (60, 4.99, 80), (61, 1, 79),
         (62, 4, 68), (63, 1, 66), (66, 4, 64), (67, 1, 64)]
FERMATAS = [(4, 3, 1.2), (16, 4, 0.15), (52, 4, 0.5), (62, 3, 0.6), (68, 4, 0.4), (69, 4, 1.6)]
FINAL_RIT = (67, 69, 0.55, 2.5)       # Friberg & Sundberg: bars 67-69, w = 0.55, q = 2.5
PHRASES = [(1, 4, 0.55), (5, 8, 0.62), (9, 12, 0.6), (13, 16, 0.85), (17, 20, 0.6), (21, 24, 0.55),
           (25, 28, 0.6), (29, 32, 0.85), (33, 36, 0.6), (37, 40, 0.5), (41, 44, 0.6), (45, 48, 0.62),
           (53, 56, 0.6), (57, 60, 0.45), (61, 62, 0.2), (63, 66, 0.5), (67, 69, 0.3)]

MODULES = ["sec_a", "sec_b", "sec_c", "sec_d"]

# dissonances written on purpose (bar -> reason); anything else analysis.py finds is reported as an issue
INTENDED = {
    3: "passing Eb5 (2/16) between F5 and D5 over Gm9, resolves on the next downbeat",
    17: "dry chromatic approach ghost A1 (pedal up) under the hook pickup Bb4",
    20: "dry chromatic approach ghost A1 (pedal up) under the pickup Bb4",
    35: "passing 16th Eb5 inside the gamma run over Gm7",
    44: "b9 of G7b9, the bridge's harmonic-minor colour (B4 -> Ab4)",
    52: "b9 of C7b9 in the build's sweep",
    59: "not consecutive: F6 -> D6 -> C6 -> A5 -> E5 between the two bass attacks",
    65: "F5 anticipates Dm9 (tied over the barline)",
}


def build(seed=23):
    s = Score("Afterglow (groove)", bpm=76, seed=seed)
    for bar, beat, bpm in TEMPO:
        s.tempo(bar, beat, bpm)
    for bar, beat, extra in FERMATAS:
        s.fermata(bar, beat, extra)
    for name, b0, b1, kw in SECTIONS:
        s.section(name, b0, b1, **kw)
    for b0, b1, pk in PHRASES:
        s.phrase(b0, b1, peak=pk)
    s.phrase(49, 52, peak=0.95, beat1=4)
    s.phrases.remove(next(p for p in s.phrases if abs(p[0] - s.pos(53)) < 1e-9))
    s.phrase(52, 56, peak=0.2, beat0=4)
    b0, b1, w, q = FINAL_RIT
    s.final_rit(b0, b1, w=w, q=q)
    W = Writer(s)
    for modname in MODULES:
        try:
            mod = importlib.import_module(modname)
        except ModuleNotFoundError:
            continue
        mod.write(W)
    return s, W


def perform(s, W):
    s.perform(lead_in=0.0)
    for modname in MODULES:
        mod = sys.modules.get(modname)
        if mod is not None and hasattr(mod, "shape"):
            mod.shape(s, W)          # post-performance velocity shaping (before the balance pass)
    lib.balance(s, margin=12, slack=2)
    lib.assign_fingers(s)
    if hasattr(sys.modules.get("sec_d"), "after_perform"):
        sys.modules["sec_d"].after_perform(s, W)
    return s


def outputs(s, W):
    s.to_json(os.path.join(OUT, "score.json"))
    s.to_midi(os.path.join(OUT, "score.mid"))
    s.leadsheet(os.path.join(OUT, "leadsheet.txt"))
    with open(os.path.join(OUT, "report.txt"), "w") as f:
        f.write(s.report() + "\n")
    secs = s.timeline["sections"]
    for i, sec in enumerate(secs, 1):
        ns = [n for n in s.notes if sec["bar_start"] <= s._bar_of(n.beat) <= sec["bar_end"]]
        if not ns:
            continue
        t0 = sec["t_start"] - 0.3
        t1 = max(sec["t_end"], max(n.t_off for n in ns)) + 0.3
        s.pianoroll(os.path.join(OUT, f"roll_{i:02d}_{sec['name']}.png"), t0=max(0, t0), t1=t1)
    s.pianoroll(os.path.join(OUT, "roll_full.png"))


def run_checks(s, W):
    lines = []
    dsl_issues = s.check()
    lines.append(f"DSL Score.check(): {len(dsl_issues)} issues")
    lines += ["  " + x for x in dsl_issues]
    sk = checks.load_sketch()
    extra, weak = sk.extra_checks(s)
    lines.append(f"\nsketch extra_checks(): {len(extra)} issues; melody onsets < 6 vel above accompaniment: {weak}")
    lines += ["  " + x for x in extra]
    hits, osc = sk.rfiy_overlap(s)
    lines.append(f"sketch rfiy_overlap(): {len(hits)} 4-interval windows matching RFIY's opening cell; "
                 f"{osc} strict +-1 neighbour oscillations")
    mine, info = checks.my_checks(s, W)
    cl, cl_info = checks.checklist_checks(s)
    mine += cl
    info += cl_info
    # musical analysis: every m2/m9 between the melody and a still-ringing accompaniment note, and every
    # outer-voice parallel, must be a written-on-purpose case listed in INTENDED
    info.append("musical analysis (melody vs ringing accompaniment m2/m9, outer-voice parallel 8ves/5ths):")
    for c in analysis.clashes(s) + analysis.parallels(s):
        why = INTENDED.get(int(c.split()[1]))
        info.append(f"  {c}   -> {why if why else 'UNEXPLAINED'}")
        if not why:
            mine.append(f"CLASH/PARALLEL unexplained: {c}")
    lines.append(f"\ngroove checks (checks.py + analysis.py): {len(mine)} issues")
    lines += ["  " + x for x in mine]
    lines.append("\nINFO")
    lines += ["  " + x for x in info]
    lines.append("\nSECTIONS")
    for sec in s.timeline["sections"]:
        lines.append(f"  {sec['name']:8s} bars {sec['bar_start']:2d}-{sec['bar_end']:2d}  "
                     f"{sec['t_start']:7.2f} - {sec['t_end']:7.2f}  ({sec['t_end'] - sec['t_start']:5.1f} s)")
    lines.append("\nMELODY STATS")
    for k, v in checks.melody_stats(s).items():
        lines.append(f"  {k:8s} {v}")
    total = len(dsl_issues) + len(extra) + len(mine)
    lines.insert(0, f"TOTAL ISSUES: {total}  (DSL {len(dsl_issues)}, sketch {len(extra)}, groove {len(mine)})\n")
    txt = "\n".join(lines)
    with open(os.path.join(OUT, "checks.txt"), "w") as f:
        f.write(txt + "\n")
    return total, txt


if __name__ == "__main__":
    s, W = build()
    perform(s, W)
    outputs(s, W)
    total, txt = run_checks(s, W)
    print(txt[:6000])
    print("...")
    print(f"TOTAL ISSUES {total}")
