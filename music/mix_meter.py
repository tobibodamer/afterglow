#!/usr/bin/env python3
"""Afterglow mix meter: measurements that stand in for listening to the rendered soundtrack.

  python music/mix_meter.py master build/audio/afterglow.wav [--score music/final/score.json] [--json out.json]
  python music/mix_meter.py stems  --preset music/presets/final.json --out sandbox/mix/stems_final [--json out.json]
  python music/mix_meter.py compare a.wav b.wav ... [--sections chorus1,chorus2,climax] [--json out.json]

master   loudness (BS.1770 integrated, 4x true peak, EBU 3342 LRA, ffmpeg ebur128 cross-check), loudness per bar and
         per section against the intended arc (research/music.md 5.8), spectral balance per section, low-band
         articulation in pedalled bars, click scan, tail at the end, stereo / mono, film WAV check.
stems    renders four note partitions through the sampler's LINEAR chain (no compressor / normalisation / limiter):
         {melody, accompaniment} x {even, odd pedal segments}. Their sums give
         - melody vs accompaniment level at every melody onset (A-weighted, also K-weighted / 250 Hz-5 kHz),
         - pedal carry-over: low-band (40-300 Hz) energy of the notes struck BEFORE a damper return still sounding
           100-350 ms after it, relative to the notes struck for the new harmony (dampers, reverb and resonance
           included), at every harmony change,
         - the dry (close-mic) note spectrum, the reference for "how much does the room / master darken it".
compare  spectral metrics of several masters side by side on chosen sections (preset A/B).
All numbers are deterministic. Nothing here changes the score or the render.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import math
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import uniform_filter1d

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import sampler as S  # noqa: E402

SR = S.SR
SCORE = os.path.join(HERE, 'final', 'score.json')

# research/music.md 5.8: intended melody velocity per section (midpoint of the table's range)
INTENDED_MEL_VEL = dict(intro=48, verse1=57, pre1=64, chorus1=74, verse2=65, pre2=71, chorus2=83, bridge=60,
                        build=82, climax=98, tag=83, finalA=46, coda=42)
# C4 200 ms RMS (dB) vs velocity, research/audio.md 6.3 (sampler voicing curve), for the per-bar level prediction
VEL_DB = ([1, 20, 32, 64, 96, 127], [-58.0, -41.4, -35.4, -24.1, -19.3, -15.1])


# ----------------------------------------------------------------------------------------------- helpers
def _rel(p):
    try:
        return os.path.relpath(p, ROOT)
    except ValueError:
        return os.path.abspath(p)


def db10(x):
    return 10.0 * np.log10(np.maximum(np.asarray(x, dtype=np.float64), 1e-30))


def load_wav(path):
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    if sr != SR:
        raise SystemExit(f'{path}: {sr} Hz, expected {SR}')
    return x


def load_score(path=SCORE):
    with open(path) as fh:
        return json.load(fh)


def a_weight_sos(sr=SR):
    """IEC 61672 A-weighting (bilinear transform of the analogue prototype)."""
    f1, f2, f3, f4, a1000 = 20.598997, 107.65265, 737.86223, 12194.217, 1.9997
    num = [(2 * np.pi * f4) ** 2 * 10 ** (a1000 / 20), 0, 0, 0, 0]
    den = np.polymul([1, 4 * np.pi * f4, (2 * np.pi * f4) ** 2], [1, 4 * np.pi * f1, (2 * np.pi * f1) ** 2])
    den = np.polymul(np.polymul(den, [1, 2 * np.pi * f3]), [1, 2 * np.pi * f2])
    b, a = signal.bilinear(num, den, sr)
    return signal.tf2sos(b, a)


def b_weight_sos(sr=SR):
    """B-weighting (IEC 651, the 70-phon equal-loudness approximation; normal music listening level), bilinear,
    normalised to 0 dB at 1 kHz."""
    f1, f4, f5 = 20.598997, 12194.217, 158.48932
    num = [(2 * np.pi * f4) ** 2, 0, 0, 0]
    den = np.polymul([1, 4 * np.pi * f4, (2 * np.pi * f4) ** 2], [1, 4 * np.pi * f1, (2 * np.pi * f1) ** 2])
    den = np.polymul(den, [1, 2 * np.pi * f5])
    b, a = signal.bilinear(num, den, sr)
    w, h = signal.freqz(b, a, worN=[1000.0], fs=sr)
    return signal.tf2sos(b / abs(h[0]), a)


def k_power(x):
    """BS.1770 K-weighted power per sample, summed over the two channels (G = 1 for L and R)."""
    return np.sum(S.k_weighted(x) ** 2, axis=1)


def weighted_power(x, kind):
    if kind == 'K':
        return k_power(x)
    if kind == 'A':
        return np.sum(signal.sosfilt(a_weight_sos(), x, axis=0) ** 2, axis=1)
    if kind == 'B':
        return np.sum(signal.sosfilt(b_weight_sos(), x, axis=0) ** 2, axis=1)
    if kind == 'mel_band':     # 250 Hz - 5 kHz: where the melody's fundamentals and main partials live
        sos = signal.butter(4, [250, 5000], 'bandpass', fs=SR, output='sos')
        return np.sum(signal.sosfilt(sos, x, axis=0) ** 2, axis=1)
    if kind == 'low':          # 40-300 Hz: the register where pedal smear turns into mud
        sos = signal.butter(4, [40, 300], 'bandpass', fs=SR, output='sos')
        return np.sum(signal.sosfilt(sos, x, axis=0) ** 2, axis=1)
    if kind == 'flat':
        return np.sum(x ** 2, axis=1)
    raise ValueError(kind)


class Cum:
    """Constant-time mean power over any [t0, t1) from a per-sample power array."""

    def __init__(self, p):
        self.c = np.concatenate(([0.0], np.cumsum(p, dtype=np.float64)))
        self.n = len(p)

    def mean(self, t0, t1):
        a = int(np.clip(round(t0 * SR), 0, self.n)); b = int(np.clip(round(t1 * SR), 0, self.n))
        return (self.c[b] - self.c[a]) / (b - a) if b > a else 0.0


def gated_lufs(cum: Cum, t0, t1):
    """BS.1770-4 gated loudness of [t0, t1): 400 ms blocks, 75 % overlap, -70 LUFS absolute and -10 LU relative
    gates. Falls back to the plain mean for spans shorter than one block."""
    if t1 - t0 < 0.4:
        return float(-0.691 + db10(cum.mean(t0, t1)))
    starts = np.arange(t0, t1 - 0.4 + 1e-9, 0.1)
    z = np.array([cum.mean(s, s + 0.4) for s in starts])
    lk = -0.691 + db10(z)
    z = z[lk > -70]
    if not len(z):
        return -70.0
    rel = -0.691 + db10(np.mean(z)) - 10
    z2 = z[-0.691 + db10(z) > rel]
    return float(-0.691 + db10(np.mean(z2)))


def spearman(a, b):
    ra = np.argsort(np.argsort(a)); rb = np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def ffmpeg_ebur128(path):
    try:
        ff = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null',
                             '-'], capture_output=True, text=True).stderr
    except FileNotFoundError:
        return None
    s = ff[ff.rfind('Summary:'):]
    vals = {}
    for line in s.splitlines():
        line = line.strip()
        for key in ('I:', 'LRA:', 'Peak:'):
            if line.startswith(key):
                vals[key.rstrip(':')] = float(line.split()[1])
    return vals


def bar_spans(score):
    bars = score['bars']
    end = max(n['t_off'] for n in score['notes'])
    out = []
    for i, b in enumerate(bars):
        t1 = bars[i + 1]['t'] if i + 1 < len(bars) else max(end, b['t'] + 0.5)
        if b['t'] >= end:
            continue
        sec = next((s['name'] for s in score['sections'] if s['bar_start'] <= b['bar'] <= s['bar_end']), '-')
        out.append(dict(bar=b['bar'], t0=b['t'], t1=t1, section=sec))
    return out


# ----------------------------------------------------------------------------------------------- spectrum
THIRD_OCT = 1000.0 * 2.0 ** (np.arange(-15, 13) / 3.0)      # 31.5 Hz .. 16 kHz


def band_energy(f, P, lo, hi):
    m = (f >= lo) & (f < hi)
    return float(np.sum(P[m]))


def spectrum_metrics(x_seg):
    """Long-term spectrum of a stereo segment (mean of the L and R power spectra), Welch 16384 (2.9 Hz bins).
    Ratios are energy ratios."""
    n = len(x_seg)
    nper = 16384 if n >= 16384 else 2 ** int(np.log2(max(n, 256)))
    f, P = signal.welch(x_seg, SR, window='hann', nperseg=nper, noverlap=nper // 2, scaling='density', axis=0)
    P = P.mean(axis=1) * (f[1] - f[0])          # mean of the L and R power spectra (what each ear gets)
    tot = band_energy(f, P, 20, 20000)
    bands = [band_energy(f, P, fc * 2 ** (-1 / 6), fc * 2 ** (1 / 6)) for fc in THIRD_OCT]
    lv = db10(np.array(bands) / tot)
    sel = (THIRD_OCT >= 500) & (THIRD_OCT <= 8000)
    slope = float(np.polyfit(np.log2(THIRD_OCT[sel]), lv[sel], 1)[0])
    e = lambda lo, hi: band_energy(f, P, lo, hi)
    ref = e(250, 1000)
    m = (f >= 50) & (f <= 16000)
    centroid = float(np.sum(f[m] * P[m]) / np.sum(P[m]))
    return dict(
        low_share_pct=round(100 * e(20, 250) / tot, 1),            # everything under 250 Hz
        sub_share_pct=round(100 * e(20, 80) / tot, 2),
        mud_db=round(float(db10(e(150, 400) / e(1000, 4000))), 1),  # 150-400 Hz vs 1-4 kHz: higher = muddier
        lowmid_vs_mid_db=round(float(db10(e(150, 400) / e(400, 1000))), 1),
        presence_db=round(float(db10(e(2000, 5000) / ref)), 1),    # 2-5 kHz vs 250 Hz-1 kHz
        air_db=round(float(db10(e(8000, 16000) / ref)), 1),        # 8-16 kHz vs 250 Hz-1 kHz
        slope_500_8k_db_oct=round(slope, 2),
        centroid_hz=round(centroid, 0),
        third_oct_db={f'{fc:.0f}': round(float(v), 1) for fc, v in zip(THIRD_OCT, lv)})


# ----------------------------------------------------------------------------------------------- groove
def groove_punch(x, score, sections=('chorus1', 'pre2', 'chorus2', 'climax')):
    """Backbeat articulation: at every LH shell (>= 2 'acc' notes struck together on beat 2 or 4 of a bar), A-weighted
    level over the first 50 ms vs the 60 ms just before (jump) and at 300-380 ms after (tail, re the onset window).
    Reverb, resonance and pedal fill the gaps in: a smaller jump and a higher tail = a softer pocket."""
    p = Cum(weighted_power(x, 'A'))
    b0 = {b['bar']: b['beat0'] for b in score['bars']}
    groups = {}
    for n in score['notes']:
        if n['voice'] != 'acc' or n['section'] not in sections:
            continue
        pos = round(n['beat'] - b0[n['bar']], 3)
        if pos in (1.0, 3.0):
            groups.setdefault((n['bar'], pos), []).append(n['t_on'])
    out = {}
    for sec in sections:
        jump, tail = [], []
        for (bar, pos), ts in groups.items():
            if len(ts) < 2 or not any(n['bar'] == bar and n['section'] == sec for n in score['notes']):
                continue
            t = min(ts)
            on = p.mean(t, t + 0.05)
            jump.append(float(db10(on / max(p.mean(t - 0.08, t - 0.02), 1e-30))))
            tail.append(float(db10(p.mean(t + 0.30, t + 0.38) / max(on, 1e-30))))
        if jump:
            out[sec] = dict(n=len(jump), jump_db=round(float(np.median(jump)), 1), tail_db=round(float(np.median(tail)), 1))
    return out


# ----------------------------------------------------------------------------------------------- master analysis
def hf_clicks(x, exclude_s=(), exclude_win_s=0.004, ratio=8.0, floor_db=-75.0):
    """Broadband clicks (same detector as sandbox/audio/run_tests.py): 7 kHz 4th-order high-pass, samples above
    ratio x the local 20 ms RMS and floor_db re the file peak, events excluded +-exclude_win_s."""
    sos = signal.butter(4, 7000, 'highpass', fs=SR, output='sos')
    y = np.abs(signal.sosfilt(sos, x, axis=0)).max(axis=1)
    loc = np.sqrt(np.maximum(uniform_filter1d(y ** 2, size=int(0.02 * SR) | 1), 0.0))
    fl = np.abs(x).max() * 10 ** (floor_db / 20)
    t = np.flatnonzero((y > ratio * loc) & (y > fl)) / SR
    ex = np.sort(np.asarray(exclude_s, dtype=float))
    if len(ex) and len(t):
        j = np.clip(np.searchsorted(ex, t), 0, len(ex) - 1)
        near = np.minimum(np.abs(t - ex[j]), np.abs(t - ex[np.maximum(j - 1, 0)]))
        t = t[near > exclude_win_s]
    merged = []
    for tt in t:
        if not merged or tt - merged[-1] > 0.002:
            merged.append(round(float(tt), 4))
    return merged


def click_scan(x, exclude):
    d2 = S.detect_clicks(x, exclude_s=exclude)
    hf = hf_clicks(x, exclude_s=exclude)
    # injection self-test at a quiet and a median spot (the detectors must see what we claim they would see)
    rms = uniform_filter1d(np.mean(x ** 2, axis=1), size=int(0.05 * SR))
    ex = np.asarray(sorted(exclude))
    cand = [i for i in range(SR, len(x) - SR, SR // 20) if not len(ex) or np.min(np.abs(ex - i / SR)) > 0.05]
    lv = np.array([rms[i] for i in cand])
    sanity = {}
    for where, i in (('quiet', cand[int(np.argsort(lv)[len(lv) // 10])]), ('median', cand[int(np.argsort(lv)[len(lv) // 2])])):
        for amp_db in (-60, -50):
            for kind in ('step', 'spike'):
                y = x[i - SR // 2:i + SR // 2].copy()
                if kind == 'step':
                    y[SR // 2:, :] += 10 ** (amp_db / 20)
                else:
                    y[SR // 2, 0] += 10 ** (amp_db / 20)
                found = any(abs(t - 0.5) < 0.004 for t in S.detect_clicks(y, exclude_s=[]) + hf_clicks(y, exclude_s=[]))
                sanity[f'{where} ({10 * math.log10(rms[i] + 1e-30):.0f} dBFS rms) {kind} {amp_db} dBFS'] = found
    return dict(d2_hits=len(d2), d2_first=d2[:8], hf_hits=len(hf), hf_first=hf[:8], injection_found=sanity,
                excluded_events=len(exclude))


def analyze_master(wav, score, render_log=None, film_wav=None, mp3=None, sections_spec=None, ffmpeg=True, x=None,
                   quick=False):
    """wav: path (or None with x = the stereo array). quick: loudness, arc and spectrum only."""
    if x is None:
        x = load_wav(wav)
    x = np.asarray(x, dtype=np.float64)
    dur = len(x) / SR
    res = dict(file=_rel(wav) if wav else None, duration_s=round(dur, 3))
    ffmpeg = ffmpeg and bool(wav) and not quick
    # --- loudness
    lufs = S.integrated_lufs(x); tp = S.true_peak_db(x); lra = S.loudness_range(x)
    res['loudness'] = dict(lufs_i=round(lufs, 2), true_peak_dbtp=round(tp, 2), lra_lu=lra,
                           sample_peak_dbfs=round(float(20 * np.log10(np.abs(x).max())), 2),
                           plr_db=round(tp - lufs, 2), dc_offset=[round(float(v), 7) for v in x.mean(axis=0)],
                           nan_or_inf=bool(~np.isfinite(x).all()))
    if ffmpeg:
        res['loudness']['ffmpeg_wav'] = ffmpeg_ebur128(wav)
        if mp3 and os.path.exists(mp3):
            res['loudness']['ffmpeg_mp3'] = ffmpeg_ebur128(mp3)
    # --- loudness per section and per bar vs the intended arc
    kc = Cum(k_power(x))
    secs = {}
    for s in score['sections']:
        secs[s['name']] = dict(lufs=round(gated_lufs(kc, s['t_start'], s['t_end']), 2), bars=f"{s['bar_start']}-{s['bar_end']}",
                               intended_mel_vel=INTENDED_MEL_VEL.get(s['name']))
    res['sections'] = secs
    L = {k: v['lufs'] for k, v in secs.items()}
    bars = bar_spans(score)
    by_bar = {}
    for b in bars:
        ns = [n for n in score['notes'] if b['t0'] <= n['t_on'] < b['t1']]
        mel = [n['vel'] for n in ns if n['voice'] == 'mel']
        pred = sum(10 ** (np.interp(n['vel'], *VEL_DB) / 10) * min(n['t_off'] - n['t_on'] + 0.3, 1.0) for n in ns)
        pred_db = float(db10(pred / (b['t1'] - b['t0']))) if ns else None
        ok_t1 = min(b['t1'], max([n['t_off'] for n in ns] + [b['t0'] + 0.4]) + 0.3)   # its sounding part
        by_bar[b['bar']] = dict(section=b['section'], lufs=round(gated_lufs(kc, b['t0'], b['t1']), 2),
                                lufs_sounding=round(gated_lufs(kc, b['t0'], ok_t1), 2),
                                mel_vel_max=max(mel) if mel else None, vel_pred_db=None if pred_db is None else round(pred_db, 2))
    res['bars'] = by_bar
    bl = [v['lufs'] for v in by_bar.values() if v['vel_pred_db'] is not None]
    bp = [v['vel_pred_db'] for v in by_bar.values() if v['vel_pred_db'] is not None]
    climax_bars = [v['lufs'] for v in by_bar.values() if v['section'] == 'climax']
    other_max = max(v['lufs'] for v in by_bar.values() if v['section'] != 'climax')
    build = [by_bar[b]['lufs_sounding'] for b in sorted(by_bar) if by_bar[b]['section'] == 'build']
    checks = [
        ('intro softer than verse 1', L['intro'] < L['verse1'], L['verse1'] - L['intro']),
        ('verse 1 < pre 1 < chorus 1 (lift)', L['verse1'] < L['pre1'] < L['chorus1'], L['chorus1'] - L['verse1']),
        ('chorus 1 lift >= 2 LU over verse 1', L['chorus1'] - L['verse1'] >= 2.0, L['chorus1'] - L['verse1']),
        ('verse 2 pulled back under chorus 1 (>= 1.5 LU)', L['chorus1'] - L['verse2'] >= 1.5, L['chorus1'] - L['verse2']),
        ('chorus 2 >= chorus 1', L['chorus2'] >= L['chorus1'], L['chorus2'] - L['chorus1']),
        ('bridge dips >= 3 LU under chorus 2', L['chorus2'] - L['bridge'] >= 3.0, L['chorus2'] - L['bridge']),
        ('build rises bar by bar (sounding part, 0.5 LU tolerance)', all(b2 >= b1 - 0.5 for b1, b2 in zip(build, build[1:])),
         build[-1] - build[0] if build else 0.0),
        ('climax is the loudest section', L['climax'] == max(L.values()), L['climax'] - max(v for k, v in L.items() if k != 'climax')),
        ('climax >= 1.5 LU over chorus 2', L['climax'] - L['chorus2'] >= 1.5, L['climax'] - L['chorus2']),
        ('loudest bar is in the climax', max(climax_bars) > other_max, max(climax_bars) - other_max),
        ('tag steps down from the climax', L['tag'] < L['climax'], L['climax'] - L['tag']),
        ('final A quieter than the tag', L['finalA'] < L['tag'], L['tag'] - L['finalA']),
        ('quiet ending: coda <= intro + 1 LU', L['coda'] <= L['intro'] + 1.0, L['intro'] - L['coda']),
    ]
    order = [k for k in INTENDED_MEL_VEL if k in L]
    res['arc'] = dict(
        checks=[dict(check=c, ok=bool(ok), margin_lu=round(float(m), 2)) for c, ok, m in checks],
        all_ok=bool(all(ok for _, ok, _ in checks)),
        spearman_sections_vs_intended=round(spearman([L[k] for k in order], [INTENDED_MEL_VEL[k] for k in order]), 3),
        pearson_bars_vs_velocity_prediction=round(float(np.corrcoef(bl, bp)[0, 1]), 3),
        section_range_lu=round(max(L.values()) - min(L.values()), 2))
    # --- spectrum per section
    res['spectrum'] = {}
    for s in score['sections']:
        a, b = int(s['t_start'] * SR), int(s['t_end'] * SR)
        res['spectrum'][s['name']] = spectrum_metrics(x[a:b])
    res['spectrum']['whole'] = spectrum_metrics(x)
    res['groove'] = groove_punch(x, score)
    if quick:
        return res
    # --- low-band articulation in pedalled bars: floor (p10) vs peaks (p95) of the 50 ms 40-300 Hz level
    lowp = weighted_power(x, 'low')
    env = db10(uniform_filter1d(lowp, size=int(0.05 * SR)))
    midp = weighted_power(x, 'mel_band')
    envm = db10(uniform_filter1d(midp, size=int(0.05 * SR)))
    lift = pedal_lift(score)
    art = {}
    for b in bars:
        a, c = int(b['t0'] * SR), int(b['t1'] * SR)
        li = lift[int(b['t0'] * SR / 32):int(b['t1'] * SR / 32)]
        e = env[a:c]; em = envm[a:c]
        art[b['bar']] = dict(section=b['section'], pedal_frac=round(float(np.mean(li > 0.5)), 2),
                             low_contrast_db=round(float(np.percentile(e, 95) - np.percentile(e, 10)), 1),
                             mid_contrast_db=round(float(np.percentile(em, 95) - np.percentile(em, 10)), 1),
                             low_floor_re_mid_peak_db=round(float(np.percentile(e, 10) - np.percentile(em, 95)), 1))
    ped = [v for v in art.values() if v['pedal_frac'] >= 0.6]
    res['low_articulation'] = dict(
        definition='per bar: 50 ms 40-300 Hz level, p95 minus p10 (low_contrast); <6 dB = smeared bass',
        pedalled_bars=len(ped),
        pedalled_low_contrast_median_db=round(float(np.median([v['low_contrast_db'] for v in ped])), 1) if ped else None,
        pedalled_low_contrast_min=sorted(((v['low_contrast_db'], k) for k, v in art.items() if v['pedal_frac'] >= 0.6))[:5],
        bars=art)
    # --- HF floor (hiss / noise lifted by the air shelf): 50 ms 8-16 kHz level, quietest 5 % per section (dBFS)
    sos_hf = signal.butter(4, [8000, 16000], 'bandpass', fs=SR, output='sos')
    hfp = np.sum(signal.sosfilt(sos_hf, x, axis=0) ** 2, axis=1) / 2
    hfe = db10(uniform_filter1d(hfp, size=int(0.05 * SR)))
    bbe = db10(uniform_filter1d(np.mean(x ** 2, axis=1), size=int(0.05 * SR)))
    res['hf_floor'] = {}
    for s in score['sections']:
        a, b = int(s['t_start'] * SR), int(s['t_end'] * SR)
        e = hfe[a:b]
        res['hf_floor'][s['name']] = dict(hf_p5_dbfs=round(float(np.percentile(e, 5)), 1),
                                          broadband_p5_dbfs=round(float(np.percentile(bbe[a:b], 5)), 1))
    # --- clicks
    exclude = []
    if render_log and os.path.exists(render_log):
        rl = json.load(open(render_log))
        for n in rl['notes']:
            exclude += [n['start'], n['end']]
            if n.get('damper'):
                exclude.append(n['damper'])
        exclude += [p['t'] for p in rl['pedal']]
    else:
        for n in score['notes']:
            exclude += [n['t_on'], n['t_off']]
    res['clicks'] = click_scan(x, sorted(exclude))
    # --- start and end
    env50 = db10(uniform_filter1d(np.mean(x ** 2, axis=1), size=int(0.05 * SR)))
    last_off = max(n['t_off'] for n in score['notes'])
    last_ped = max(t for t, _ in score['pedal'])
    t_fade = dur - 0.5
    i = lambda t: int(np.clip(t * SR, 0, len(x) - 1))
    tail_seg = env50[i(last_ped):i(t_fade)]
    t_60 = None
    ref = env50[i(last_ped)]
    below = np.flatnonzero(tail_seg < ref - 60)
    if len(below):
        t_60 = round(float(below[0] / SR), 2)
    # biggest 10 ms drop in the tail while it is still above -90 dBFS (a cut-off shows up as a cliff); where the
    # signal becomes digital silence and how loud it was just before
    e10 = env50[i(last_ped):i(t_fade):int(0.01 * SR)]
    st = np.diff(e10)
    audible = e10[:-1] > -90 if len(e10) > 1 else np.zeros(0, bool)
    cliff = float(np.min(st[audible])) if np.any(audible) else 0.0
    nz = np.flatnonzero(np.abs(x).max(axis=1) > 0)
    last_nz = int(nz[-1]) if len(nz) else 0
    above90 = np.flatnonzero(env50 > -90)
    above100 = np.flatnonzero(env50 > -100)
    res['tail'] = dict(last_note_off_s=round(last_off, 3), last_pedal_event_s=round(last_ped, 3),
                       level_at_last_pedal_up_dbfs=round(float(ref), 1),
                       level_at_fade_start_dbfs=round(float(env50[i(t_fade)]), 1),
                       fade_start_re_last_pedal_up_db=round(float(env50[i(t_fade)] - ref), 1),
                       seconds_to_minus60_db_after_pedal_up=t_60,
                       steepest_10ms_step_above_minus90_db=round(cliff, 2),
                       last_above_minus90_dbfs_s=round(float(above90[-1] / SR), 3) if len(above90) else None,
                       last_above_minus100_dbfs_s=round(float(above100[-1] / SR), 3) if len(above100) else None,
                       last_nonzero_sample_s=round(last_nz / SR, 3),
                       level_100ms_before_last_nonzero_dbfs=round(float(env50[max(last_nz - int(0.1 * SR), 0)]), 1),
                       end_of_file_s=round(dur, 3), first_sample_abs=float(np.abs(x[0]).max()),
                       first_10ms_peak_dbfs=round(float(20 * np.log10(np.abs(x[:480]).max() + 1e-12)), 1))
    # --- stereo
    L_, R_ = x[:, 0], x[:, 1]
    mono = (L_ + R_) / 2
    res['stereo'] = dict(lr_correlation=round(float(np.corrcoef(L_, R_)[0, 1]), 3),
                         side_re_mid_db=round(float(db10(np.mean(((L_ - R_) / 2) ** 2)) - db10(np.mean(mono ** 2))), 1),
                         mono_foldown_re_stereo_db=round(float(db10(np.mean(mono ** 2)) - db10(np.mean((L_ ** 2 + R_ ** 2) / 2))), 2),
                         left_minus_right_db=round(float(db10(np.mean(L_ ** 2)) - db10(np.mean(R_ ** 2))), 2))
    # --- film WAV
    if film_wav and os.path.exists(film_wav):
        y = load_wav(film_wav)
        off = len(y) - len(x)
        res['film_wav'] = dict(file=_rel(film_wav), offset_s=round(off / SR, 6),
                               lead_is_digital_silence=bool(np.all(y[:off] == 0)),
                               body_max_abs_diff=float(np.abs(y[off:] - x).max()) if off >= 0 else None)
    return res


# ----------------------------------------------------------------------------------------------- partition renders
def pedal_lift(score, cfg=None):
    cfg = cfg or S.Config()
    ccs = [(float(t), 64, int(round(v))) for t, v in score['pedal']]
    last = max([n['t_off'] for n in score['notes']] + [t for t, _, _ in ccs])
    n_ctrl = int((last + 40) * SR) // cfg.ctrl_block + 2
    return S.damper_lift(S.controller_curve(ccs, 64, n_ctrl, cfg.ctrl_block), cfg, cfg.ctrl_block)


def damper_returns(score, cfg=None):
    """Times where the damper rail falls through half lift (dampers touch the strings), as in sampler.render."""
    cfg = cfg or S.Config()
    lift = pedal_lift(score, cfg)
    idx = np.flatnonzero((lift[1:] < 0.5) & (lift[:-1] >= 0.5)) + 1
    return idx * cfg.ctrl_block / SR


def partition_notes(score, cfg=None, pre_s=0.15):
    """Each note -> (is_melody, pedal segment parity). A note struck less than pre_s before a damper return belongs
    to the NEW segment (legato pedalling: new chord, then pedal up)."""
    t_ret = damper_returns(score, cfg)
    out = []
    for n in score['notes']:
        seg = int(np.searchsorted(t_ret, n['t_on'] + pre_s, side='right'))
        out.append((n['voice'] == 'mel', seg % 2, seg))
    return out, t_ret


def render_partitions(score_path, cfg, out_dir, log=print, split='full'):
    """Render {mel, acc} x {even, odd} (split='full') or {mel, acc} (split='melacc') through the linear chain
    (no compressor / loudness / limiter)."""
    score = load_score(score_path)
    notes_all, ccs = S.load_score(score_path)
    lin = dataclasses.replace(cfg, target_lufs=None, comp_ratio=1.0)
    part, _ = partition_notes(score, cfg)
    bank = S.Bank(lin)
    os.makedirs(out_dir, exist_ok=True)
    out = {}
    for mel in (True, False):
        for par in ((0, 1) if split == 'full' else (None,)):
            name = f"{'mel' if mel else 'acc'}_{('even' if par == 0 else 'odd') if par is not None else 'all'}"
            sel = [nt for nt, (m, p, _) in zip(notes_all, part) if m == mel and (par is None or p == par)]
            log(f'partition {name}: {len(sel)} notes')
            r = S.render(sel, ccs, lin, bank=bank, stems=True, log=log)
            out[name] = dict(audio=r['audio'], dry=r['stems']['notes'], wet=r['stems']['reverb'])
            sf.write(os.path.join(out_dir, f'{name}.wav'), r['audio'], SR, subtype='FLOAT')
            sf.write(os.path.join(out_dir, f'{name}_dry.wav'), r['stems']['notes'], SR, subtype='FLOAT')
    return out


def load_partitions(out_dir):
    out = {}
    pars = ('even', 'odd') if os.path.exists(os.path.join(out_dir, 'mel_even.wav')) else ('all',)
    for mel in ('mel', 'acc'):
        for par in pars:
            name = f'{mel}_{par}'
            out[name] = dict(audio=load_wav(os.path.join(out_dir, f'{name}.wav')),
                             dry=load_wav(os.path.join(out_dir, f'{name}_dry.wav')))
    return out


def _pad_sum(*arrs):
    n = max(len(a) for a in arrs)
    y = np.zeros((n, 2))
    for a in arrs:
        y[:len(a)] += a
    return y


def melody_balance(score, mel, acc, win_s=0.25, min_s=0.08):
    """Level of the melody stem over the accompaniment stem in the first win_s of every melody note."""
    notes = [n for n in score['notes'] if n['voice'] == 'mel']
    res = {}
    for kind in ('B', 'A', 'K', 'mel_band'):
        cm, ca = Cum(weighted_power(mel, kind)), Cum(weighted_power(acc, kind))
        d = []
        for n in notes:
            t0 = n['t_on']; t1 = t0 + float(np.clip(n['t_off'] - n['t_on'], min_s, win_s))
            d.append(float(db10(cm.mean(t0, t1) / max(ca.mean(t0, t1), 1e-30))))
        d = np.array(d)
        r = dict(median_db=round(float(np.median(d)), 2), p10_db=round(float(np.percentile(d, 10)), 2),
                 p90_db=round(float(np.percentile(d, 90)), 2),
                 pct_below_3=round(float(100 * np.mean(d < 3)), 1), pct_3_to_8=round(float(100 * np.mean((d >= 3) & (d <= 8))), 1),
                 pct_above_8=round(float(100 * np.mean(d > 8)), 1), pct_below_0=round(float(100 * np.mean(d < 0)), 1))
        per = {}
        for s in score['sections']:
            m = np.array([n['section'] == s['name'] for n in notes])
            if m.any():
                per[s['name']] = dict(median=round(float(np.median(d[m])), 1), p10=round(float(np.percentile(d[m], 10)), 1), n=int(m.sum()))
        r['per_section'] = per
        if kind == 'B':
            worst = np.argsort(d)[:10]
            r['lowest'] = [dict(bar=notes[i]['bar'], note=notes[i]['name'], vel=notes[i]['vel'], db=round(float(d[i]), 1)) for i in worst]
        res[kind] = r
    res['definition'] = (f'per melody note: energy of the melody stem / accompaniment stem over its first {win_s * 1000:.0f} ms '
                         f'(at least {min_s * 1000:.0f} ms), linear chain incl. reverb; B = B-weighted (primary: the 70-phon curve of normal listening), A = A-weighted (40 phon), K = BS.1770 '
                         'K-weighting, mel_band = 250 Hz-5 kHz band')
    return res


def pedal_carryover(score, even, odd, cfg=None, w0=0.10, w1=0.35, pre_s=0.15):
    """At each damper return between pedal segments k-1 and k, low-band (40-300 Hz) energy of segment k-1's notes
    (still ringing) relative to segment k's notes over [t + w0, t + w1]. Only damper returns within 0.4 s of a chord
    change count as harmony changes; keys of the old segment still held there are listed (intended holds)."""
    part, t_ret = partition_notes(score, cfg, pre_s)
    stems = (even, odd)
    pw = [Cum(weighted_power(s, 'low')) for s in stems]
    pm = [Cum(weighted_power(s, 'mel_band')) for s in stems]
    chord_t = np.array([c['t'] for c in score['chords']])
    notes = score['notes']
    rows = []
    for k, t in enumerate(t_ret, start=1):
        old, new = (k - 1) % 2, k % 2
        a, b = t + w0, t + w1
        eo, en = pw[old].mean(a, b), pw[new].mean(a, b)
        if en <= 0 and eo <= 0:
            continue
        harm = bool(len(chord_t) and np.min(np.abs(chord_t - t)) < 0.4)
        held = [n['name'] for n, (m, p, seg) in zip(notes, part) if seg == k - 1 and n['t_off'] > a and n['pitch'] <= 55]
        bar = max((bb['bar'] for bb in score['bars'] if bb['t'] <= t), default=1)
        rows.append(dict(t=round(float(t), 3), bar=bar, harmony_change=harm,
                         low_old_re_new_db=round(float(db10(eo / max(en, 1e-30))), 1),
                         mid_old_re_new_db=round(float(db10(pm[old].mean(a, b) / max(pm[new].mean(a, b), 1e-30))), 1),
                         held_low_keys=held))
    hc = [r for r in rows if r['harmony_change'] and not r['held_low_keys']]
    v = np.array([r['low_old_re_new_db'] for r in hc])
    worst = sorted(hc, key=lambda r: -r['low_old_re_new_db'])[:10]
    per = {}
    for s in score['sections']:
        vv = [r['low_old_re_new_db'] for r in hc if s['t_start'] <= r['t'] < s['t_end']]
        if vv:
            per[s['name']] = dict(median=round(float(np.median(vv)), 1), max=round(float(np.max(vv)), 1), n=len(vv))
    return dict(definition=('low-band (40-300 Hz) energy of the notes struck before a damper return, still sounding '
                            f'{w0 * 1000:.0f}-{w1 * 1000:.0f} ms after it, re the notes struck for the new segment; '
                            'harmony changes only, old low keys (<= G3) still held excluded; < -10 dB = clean'),
                window_s=[w0, w1], damper_returns=len(t_ret), harmony_changes_measured=len(hc),
                harmony_changes_with_held_low_keys=len([r for r in rows if r['harmony_change'] and r['held_low_keys']]),
                median_db=round(float(np.median(v)), 1) if len(v) else None,
                p90_db=round(float(np.percentile(v, 90)), 1) if len(v) else None,
                pct_over_minus10=round(float(100 * np.mean(v > -10)), 1) if len(v) else None,
                pct_over_minus6=round(float(100 * np.mean(v > -6)), 1) if len(v) else None,
                per_section=per, worst=worst, rows=rows)


def analyze_partitions(score, parts, cfg=None, extra_eq=None):
    """extra_eq: optional list of [Hz, dB, Q] peaking filters / ['shelf', Hz, dB] applied (zero-phase) to every stem
    first, to see what a master EQ change does to the balance without re-rendering (EQ is linear)."""
    if extra_eq:
        def eq(x):
            for e in extra_eq:
                if e[0] == 'shelf':
                    x = signal.sosfiltfilt(S.high_shelf_sos(e[1], e[2] / 2.0), x, axis=0)
                else:
                    x = signal.sosfiltfilt(S.peaking_sos(e[0], e[1] / 2.0, e[2]), x, axis=0)
            return x
        parts = {k: dict(audio=eq(v['audio']), dry=v['dry']) for k, v in parts.items()}
    if 'mel_even' in parts:
        mel = _pad_sum(parts['mel_even']['audio'], parts['mel_odd']['audio'])
        acc = _pad_sum(parts['acc_even']['audio'], parts['acc_odd']['audio'])
        even = _pad_sum(parts['mel_even']['audio'], parts['acc_even']['audio'])
        odd = _pad_sum(parts['mel_odd']['audio'], parts['acc_odd']['audio'])
    else:
        mel, acc = parts['mel_all']['audio'], parts['acc_all']['audio']
        even = odd = None
    dry = _pad_sum(*(p['dry'] for p in parts.values()))
    full = _pad_sum(mel, acc)
    res = dict(melody_balance=melody_balance(score, mel, acc))
    if even is not None:
        res['pedal_carryover'] = pedal_carryover(score, even, odd, cfg)
    # dry (close-mic, before room and master) vs linear full chain, per section: what the room / EQ add
    sp = {}
    for s in score['sections']:
        a, b = int(s['t_start'] * SR), int(s['t_end'] * SR)
        sd, sf_ = spectrum_metrics(dry[a:b]), spectrum_metrics(full[a:b])
        sp[s['name']] = dict(dry={k: v for k, v in sd.items() if k != 'third_oct_db'},
                             chain={k: v for k, v in sf_.items() if k != 'third_oct_db'})
    res['dry_vs_chain_spectrum'] = sp
    return res


# ----------------------------------------------------------------------------------------------- compare
def compare(wavs, score, sections):
    rows = {}
    for w in wavs:
        x = load_wav(w)
        r = dict(lufs_i=round(S.integrated_lufs(x), 2), lra=S.loudness_range(x))
        for s in score['sections']:
            if s['name'] in sections:
                a, b = int(s['t_start'] * SR), int(s['t_end'] * SR)
                r[s['name']] = {k: v for k, v in spectrum_metrics(x[a:b]).items()}
        rows[os.path.basename(w)] = r
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('master'); m.add_argument('wav'); m.add_argument('--score', default=SCORE)
    m.add_argument('--json'); m.add_argument('--no-ffmpeg', action='store_true')
    s = sub.add_parser('stems'); s.add_argument('--preset', required=True); s.add_argument('--set', nargs='*', default=[])
    s.add_argument('--score', default=SCORE); s.add_argument('--out', required=True); s.add_argument('--json')
    s.add_argument('--reuse', action='store_true', help='analyse the stems already in --out')
    s.add_argument('--split', default='full', choices=('full', 'melacc'))
    s.add_argument('--extra-eq', help='JSON list of [Hz, dB, Q] / ["shelf", Hz, dB] applied to the stems before analysis')
    c = sub.add_parser('compare'); c.add_argument('wavs', nargs='+'); c.add_argument('--score', default=SCORE)
    c.add_argument('--sections', default='chorus1,chorus2,climax'); c.add_argument('--json')
    a = ap.parse_args(argv)
    score = load_score(a.score)
    if a.cmd == 'master':
        stem = os.path.splitext(a.wav)[0]
        res = analyze_master(a.wav, score, render_log=stem + '.render.json', film_wav=stem + '_film.wav',
                             mp3=stem + '.mp3', ffmpeg=not a.no_ffmpeg)
    elif a.cmd == 'stems':
        cfg = S.config_from(a.preset, a.set)
        parts = load_partitions(a.out) if a.reuse else render_partitions(a.score, cfg, a.out, split=a.split)
        res = analyze_partitions(score, parts, cfg, extra_eq=json.loads(a.extra_eq) if a.extra_eq else None)
        res['preset'] = a.preset; res['set'] = a.set
    else:
        res = compare(a.wavs, score, set(a.sections.split(',')))
    txt = json.dumps(res, indent=1, default=float)
    if a.json:
        os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
        with open(a.json, 'w') as fh:
            fh.write(txt)
    print(txt if len(txt) < 20000 else txt[:20000] + '\n...')


if __name__ == '__main__':
    main()
