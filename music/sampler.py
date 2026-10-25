#!/usr/bin/env python3
"""
Afterglow offline piano sampler.

Renders a MIDI file (or a list of note/pedal events) to a 48 kHz stereo WAV using the
Salamander Grand Piano V3 samples (Alexander Holm, CC BY 3.0), offline and deterministic.

Signal chain
  samples  -> prepare (once, cached on disk):
                energy-preserving mono downmix of the spaced AB pair (fixes the -9 dB mono
                cancellation of some notes) + side signal, onset trim to a fixed 2 ms pre-roll,
                zero-phase rumble high-pass, end fade
  voice    -> velocity-layer crossfade (16 layers), loudness interpolated between layer
                centres with smoothed per-key "voicing", soxr VHQ pitch shift (+-1 semitone
                plus tuning correction), damper/pedal envelope, re-strike fade, pan by key
  releases -> key-noise samples at key-up, damper/string release samples at damper contact,
                level scaled by the string energy left at that moment
  pedal    -> CC64 with half-pedal zone and slew, pedal up/down mechanical noise,
                sympathetic string resonance (string-bank IR) while dampers are lifted
  bus      -> synthetic hall IR (or a measured IR) by FFT convolution, master EQ,
                BS.1770 loudness normalisation, look-ahead true-peak limiter
Everything random is seeded. Times in seconds, sample rate 48 kHz.

CLI
  python music/sampler.py render in.mid|score.json out.wav [--mp3 out.mp3] [--stems DIR] [--config preset.json]
                                 [--set key=value ...]
  python music/sampler.py calibrate          # delta_audio(v) note-on -> audible onset -> onset_calibration.json
  python music/sampler.py profile            # re-measure the sample set -> salamander_profile.json
Output sample 0 is music time 0. <out>.render.json logs every note (layers, gain, damper time, onset_ms).
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass, field

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

try:
    import soxr
except ImportError:  # pragma: no cover
    soxr = None

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.join(HERE, 'samples', 'SalamanderGrandPianoV3', 'SalamanderGrandPianoV3_48khz24bit')
PREP_ROOT = os.path.join(HERE, 'samples', '_prepared')
PROFILE_PATH = os.path.join(HERE, 'salamander_profile.json')

CREDIT = ('Piano samples: "Salamander Grand Piano V3" by Alexander Holm, licensed CC BY 3.0 '
          '(https://creativecommons.org/licenses/by/3.0/), source https://archive.org/details/SalamanderGrandPianoV3 . '
          'Modified: re-imaged to mono-compatible stereo, onset-trimmed and aligned, re-tuned, re-voiced and rendered '
          'by the Afterglow sampler.')

NOTE_IDX = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def db2lin(d):
    return 10.0 ** (np.asarray(d, dtype=np.float64) / 20.0)


def lin2db(x):
    return 20.0 * np.log10(np.maximum(np.asarray(x, dtype=np.float64), 1e-15))


def note_midi(name: str) -> int:
    m = re.match(r'([A-G]#?)(-?\d)$', name)
    return 12 * (int(m.group(2)) + 1) + NOTE_IDX[m.group(1)]


def f_et(k):
    return 440.0 * 2.0 ** ((np.asarray(k, dtype=np.float64) - 69.0) / 12.0)


# --------------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------------
@dataclass
class Config:
    sample_root: str = DEFAULT_ROOT
    sfz: str = 'SalamanderGrandPianoV3.sfz'
    seed: int = 20261021
    # --- preparation (changing these invalidates the on-disk cache) ---
    preroll_ms: float = 2.0            # audio kept before the detected hammer onset
    align_onsets: bool = True          # place each voice's measured attack rise exactly at its note-on
    onset_thresh_db: float = -30.0     # onset = first sample within this many dB of the file peak
    epd_max_boost_db: float = 9.0      # cap of the energy-preserving downmix correction
    rumble_hp_max_hz: float = 60.0     # per-note zero-phase HPF at min(this, 0.45*f0)
    epd_xfade_ms: tuple = (10.0, 50.0) # raw mid kept through the attack, crossfade to the EPD mid over this window
    # --- tuning ---
    tuning: str = 'smoothed'           # 'natural' (as recorded) | 'smoothed' (stretch kept, per-note errors removed) | 'retuned' (Fiedler sfz)
    stretch_scale: float = 1.0         # scales the fitted stretch curve in 'smoothed' mode
    # --- velocity / dynamics ---
    xfade_width: float = 6.0           # velocity units of crossfade around each layer boundary (0 = hard switch)
    voicing: bool = True               # smooth per-key loudness across the keyboard (fixes uneven notes)
    voicing_max_db: float = 4.0
    dyn_scale: float = 1.0             # scales the natural (recorded) loudness spread between layers
    extra_veltrack: float = 0.30       # extra SFZ-style velocity tracking: gain_dB += k*40*log10(v/127)
    # melody voicing lift (score.json input; notes whose 'voice' is in melody_voices):
    # gain_dB += melody_lift_db_per_unit * max(0, v - melody_lift_knee). Loudness only: the layer (timbre) still
    # follows the velocity. The recorded layers grow only ~0.15 dB per velocity unit from v60 to v110, so a top voice
    # played 15-25 units over a dense f-ff accompaniment ends up level with it (measured with music/mix_meter.py, see
    # music/presets/final.json); the lift restores the separation that voicing gives on a real instrument. 0 = off.
    melody_voices: tuple = ('mel',)
    melody_lift_knee: float = 127.0
    melody_lift_db_per_unit: float = 0.0
    soft_pedal_vel: float = 0.85       # CC67 una corda: velocity multiplier for layer choice
    soft_pedal_db: float = -1.5
    # --- dampers / pedal ---
    damper_top: int = 87               # keys above have no dampers: E6 (88) and up ring on (research/piano.md: dampers on
                                       # notes 1-67 = A0-D#6, matching the modelled D-class action)
    damper_t60_keys: tuple = (21, 36, 48, 60, 72, 84, 88)
    damper_t60_s: tuple = (1.8, 1.2, 0.8, 0.55, 0.40, 0.30, 0.26)
    restrike_t60_s: float = 0.30       # previous voice of a re-struck key fades with this T60
    pedal_lo: float = 32.0             # CC64 at/below: dampers fully on the strings (25 % pedal travel, performance.md 5.5)
    pedal_hi: float = 76.0             # CC64 at/above: dampers fully lifted (60 % travel); half-pedal in between
    pedal_travel_s: float = 0.07       # damper rail travel time (slew limit)
    ctrl_block: int = 32               # control-rate block (samples)
    # --- releases / noises ---
    release_gain_db: float = 0.0       # damper/string release samples (harm*) on top of the sfz levels
    key_noise_gain_db: float = 0.0     # key-up mechanical noise (rel*) on top of sfz -37 dB
    pedal_noise_gain_db: float = 0.0   # on top of sfz -20/-19 dB
    # --- sympathetic resonance ---
    resonance_db: float = -42.0        # string-bank IR gain (None disables); -20 to -23 dB re strings while pedalled
    resonance_len_s: float = 5.0
    # --- stereo ---
    pan_spread: float = 0.30           # constant-power pan, A0 -> -spread ... C8 -> +spread (player's view)
    side_gain: float = 0.6             # amount of the original spaced-pair side signal (mono-safe)
    side_cap_db: float = -9.0          # side signal capped at this level relative to mid
    # --- reverb ---
    reverb: str = 'synth'              # 'synth' | 'none' | path to a stereo IR wav
    reverb_wet_db: float = -9.0        # wet energy relative to dry (unit-energy IR)
    reverb_predelay_ms: float = 24.0
    reverb_rt60: tuple = (2.6, 2.5, 2.35, 2.2, 2.1, 1.9, 1.6, 1.15, 0.7)  # 63 Hz ... 16 kHz octaves
    reverb_send_hp_hz: float = 110.0
    reverb_send_lp_hz: float = 11000.0
    reverb_cross_db: float = -6.0
    # --- master ---
    master_hp_hz: float = 25.0
    master_eq: tuple = ((300.0, -1.0, 0.9), )       # (Hz, dB, Q) peaking
    master_high_shelf: tuple = (9000.0, 0.5)         # (Hz, dB)
    # Mastering defaults chosen on the 224 s sketch (sandbox/audio/master_lab.json): pre-master PLR 20.3 dB;
    # 2:1 slow compressor above the integrated level + true-peak limiter -> -16.0 LUFS, -1.2 dBTP, LRA 13.6 LU,
    # limiter max 2.9 dB GR on 0.4 % of the time. None -> no normalisation / limiting.
    target_lufs: float = -16.0
    tp_ceiling_db: float = -1.0        # limiter ceiling is 0.2 dB below this (4x oversampled true peak)
    limiter_lookahead_ms: float = 5.0
    limiter_release_ms: float = 120.0
    comp_ratio: float = 2.0            # slow "glue"/leveller compressor (1.0 = off)
    comp_rms_ms: float = 300.0         # detector RMS window
    comp_thresh_rel_db: float = 0.0    # threshold relative to the integrated loudness (unweighted 300 ms RMS)
    comp_knee_db: float = 6.0
    comp_attack_ms: float = 60.0
    comp_release_ms: float = 600.0
    limiter_max_gr_db: float = 6.0     # if reaching target_lufs needs more limiting, the level is lowered instead
    tail_s: float = 6.0                # rendered after the last event; trailing silence trimmed at -90 dBFS
    cache_gb: float = 8.0


PREP_VERSION = 3   # bump when prepare_signal changes (invalidates samples/_prepared)
PREP_KEYS = ('preroll_ms', 'onset_thresh_db', 'epd_max_boost_db', 'rumble_hp_max_hz', 'epd_xfade_ms')


@dataclass
class Note:
    start: float
    end: float
    pitch: int
    velocity: int
    voice: str = ''        # score.json 'voice' (mel / inner / acc / bass / ...); '' for MIDI input


# --------------------------------------------------------------------------------------------
# SFZ parsing (minimal, tolerant)
# --------------------------------------------------------------------------------------------
def parse_sfz(path):
    """Return a list of region dicts (group opcodes merged). Tolerates the 'tune-27' typo in the Retuned sfz."""
    regions, group, cur = [], {}, None
    warnings = []
    with open(path, encoding='latin1') as fh:
        for raw in fh:
            line = raw.split('//', 1)[0]
            for part in re.split(r'(<\w+>)', line):
                part = part.strip()
                if not part:
                    continue
                if part == '<group>':
                    group, cur = {}, None
                    continue
                if part == '<region>':
                    cur = dict(group)
                    regions.append(cur)
                    continue
                if part.startswith('<'):
                    cur = None
                    continue
                opcodes = dict(re.findall(r'(\w+)=(\S+)', part))
                m = re.search(r'\btune(-\d+)\b', part)          # 'tune-27' -> tune=-27
                if m:
                    opcodes['tune'] = m.group(1)
                    warnings.append(f'fixed malformed opcode in {os.path.basename(path)}: {m.group(0)}')
                if cur is None:
                    group.update(opcodes)
                else:
                    cur.update(opcodes)
    for r in regions:
        r['sample'] = r['sample'].replace('\\', '/')
    return regions, warnings


# --------------------------------------------------------------------------------------------
# Measurement helpers (used by `profile`, the tests and the docs)
# --------------------------------------------------------------------------------------------
def onset_index(x, thresh_db=-30.0):
    a = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
    return int(np.argmax(a >= a.max() * 10 ** (thresh_db / 20.0)))


def attack_onset(x, sr=SR, hi_db=-20.0, lo_db=-32.0, back_ms=8.0):
    """Start of the continuous rise into the hammer attack: first crossing of hi_db (re peak), then back-tracked to
    where the envelope last rose above lo_db within back_ms. Isolated action/touch noise that falls back below
    lo_db before the attack is ignored (soft layers have it within -30 dB of their peak)."""
    a = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
    a = signal.convolve(a, np.ones(12) / 12, mode='same')          # 0.25 ms smoothing
    pk = a.max()
    i_hi = int(np.argmax(a >= pk * 10 ** (hi_db / 20)))
    w0 = max(i_hi - int(back_ms * 1e-3 * sr), 0)
    below = np.flatnonzero(a[w0:i_hi] < pk * 10 ** (lo_db / 20))
    return int(w0 + below[-1] + 1) if len(below) else w0


def onset_measures(a, i_on, sr=SR, win_s=0.25):
    """Onset descriptors of one note, in ms relative to sample index i_on (the MIDI note-on).
    a: rectified signal (1-D, e.g. max(|L|,|R|)) of that note alone. Envelope = 0.25 ms moving average.
      rise : start of the continuous rise into the hammer attack (attack_onset: -20 dB re peak, back-tracked to
             the last -32 dB crossing within 8 ms) = physical hammer-string contact as heard by the close mics
      t30/t20/t10 : first crossing of -30/-20/-10 dB re the note's peak
      peak : time of the envelope maximum (first 250 ms)"""
    i0 = max(i_on - int(0.012 * sr), 0)
    seg = np.asarray(a[i0:i_on + int(win_s * sr)], dtype=np.float64)
    if not len(seg) or seg.max() <= 0:
        return None
    env = signal.convolve(seg, np.ones(12) / 12, mode='same')
    pk = env.max()
    ms = lambda i: round(1000.0 * (i0 + i - i_on) / sr, 3)
    out = dict(rise=ms(attack_onset(seg, sr)), peak=ms(int(np.argmax(env))))
    for d in (30, 20, 10):
        out[f't{d}'] = ms(int(np.argmax(env >= pk * 10 ** (-d / 20))))
    return out


def measure_pitch_cents(mono, sr, midi):
    """Cents deviation from 12-TET (A4=440) of partials 1 and 2 (zero-padded Hann FFT + parabolic peak)."""
    seg = mono[: int(sr * (3.0 if midi < 45 else 1.5))]
    n = len(seg)
    out = {}
    if n < sr * 0.3:
        return out
    nfft = 1 << int(np.ceil(np.log2(n * 8)))
    spec = np.abs(np.fft.rfft(seg * np.hanning(n), nfft))
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    f0 = float(f_et(midi))
    for k in (1, 2):
        idx = np.where((freqs >= f0 * k * 2 ** (-60 / 1200)) & (freqs <= f0 * k * 2 ** (60 / 1200)))[0]
        if len(idx) < 3:
            continue
        i = idx[np.argmax(spec[idx])]
        a, b, c = np.log(spec[i - 1:i + 2] + 1e-20)
        p = 0.5 * (a - c) / (a - 2 * b + c)
        out[k] = float(1200 * np.log2(((i + p) * sr / nfft) / (f0 * k)))
    return out


def build_profile(root=DEFAULT_ROOT, out=PROFILE_PATH):
    """Measure every note sample: 200 ms RMS after onset (average channel power) and the pitch of layer 8."""
    wav = os.path.join(root, '48khz24bit')
    prof = {'rms200_db': {}, 'pitch_cents': {}, 'onset_ms': {}, 'source': 'Salamander Grand Piano V3 48kHz24bit'}
    for f in sorted(os.listdir(wav)):
        m = re.match(r'^([A-G]#?\d)v(\d+)\.wav$', f)
        if not m:
            continue
        x, sr = sf.read(os.path.join(wav, f), always_2d=True)
        on = onset_index(x, -40.0)
        seg = x[on:on + int(0.2 * sr)]
        prof['rms200_db'][f] = round(float(lin2db(np.sqrt(np.mean(seg ** 2)))), 3)
        prof['onset_ms'][f] = round(1000 * on / sr, 3)
        if m.group(2) == '8':
            midi = note_midi(m.group(1))
            pc = measure_pitch_cents(x[on + int(0.15 * sr):].mean(axis=1), sr, midi)
            # perceived pitch of bass notes follows the upper partials: use partial 2 up to C3
            prof['pitch_cents'][str(midi)] = round(pc.get(2 if midi <= 48 else 1, 0.0), 2)
    with open(out, 'w') as fh:
        json.dump(prof, fh, indent=1, sort_keys=True)
    return prof


def load_profile():
    if not os.path.exists(PROFILE_PATH):
        print('profile missing -> measuring the sample set (one-off, a few minutes)', file=sys.stderr)
        return build_profile()
    with open(PROFILE_PATH) as fh:
        return json.load(fh)


# --------------------------------------------------------------------------------------------
# Sample bank
# --------------------------------------------------------------------------------------------
class Bank:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.root = cfg.sample_root
        regions, self.warnings = parse_sfz(os.path.join(self.root, cfg.sfz))
        self.profile = load_profile()
        self.layers = {}      # sample note (keycenter) -> list of layer dicts sorted by velocity
        self.keymap = {}      # played key -> sample keycenter
        self.harm = {}        # key -> {'L': region, 'S': region, 'V3': region}
        self.rel = {}         # key -> region
        self.pedal_down, self.pedal_up = [], []
        for r in regions:
            name = os.path.basename(r['sample'])
            lo, hi = int(r.get('lokey', -1)), int(r.get('hikey', -1))
            kc = int(r.get('pitch_keycenter', 60))
            if name.startswith('pedalD'):
                self.pedal_down.append(r)
            elif name.startswith('pedalU'):
                self.pedal_up.append(r)
            elif r.get('trigger') == 'release' and name.startswith('rel'):
                for k in range(lo, hi + 1):
                    self.rel[k] = r
            elif r.get('trigger') == 'release' and name.startswith('harm'):
                kind = re.match(r'harm(L|S|V3)', name).group(1)
                for k in range(lo, hi + 1):
                    self.harm.setdefault(k, {})[kind] = r
            else:
                lay = dict(file=r['sample'], lovel=int(r.get('lovel', 1)), hivel=int(r.get('hivel', 127)),
                           keycenter=kc, tune=float(r.get('tune', 0.0)))
                self.layers.setdefault(kc, []).append(lay)
                for k in range(lo, hi + 1):
                    self.keymap[k] = kc
        for kc, ls in self.layers.items():
            ls.sort(key=lambda d: d['lovel'])
            for d in ls:
                d['center'] = 0.5 * (d['lovel'] + d['hivel'])
        self._voicing_tables()
        self._tuning_tables()
        prep_sig = json.dumps(dict({k: getattr(cfg, k) for k in PREP_KEYS}, v=PREP_VERSION), sort_keys=True)
        self.prep_dir = os.path.join(PREP_ROOT, hashlib.sha1(prep_sig.encode()).hexdigest()[:10])
        os.makedirs(self.prep_dir, exist_ok=True)
        self._prep_mem = {}
        self._lags = {}
        self._cache = OrderedDict()
        self._cache_bytes = 0
        self.stats = dict(prepared=0, prep_s=0.0, resampled=0, resample_s=0.0)

    # ---- loudness / voicing --------------------------------------------------------------
    def _voicing_tables(self):
        rms = self.profile['rms200_db']
        keys = sorted(self.layers)
        nl = len(self.layers[keys[0]])
        raw = np.array([[rms[os.path.basename(self.layers[k][j]['file'])] for j in range(nl)] for k in keys])
        sm = raw.copy()
        if self.cfg.voicing:
            for j in range(nl):
                col = raw[:, j]
                med = np.array([np.median(col[max(i - 1, 0):i + 2]) for i in range(len(col))])
                pad = np.concatenate(([med[0]] * 2, med, [med[-1]] * 2))
                sm[:, j] = np.convolve(pad, np.ones(5) / 5, mode='valid')
            sm = np.clip(sm, raw - self.cfg.voicing_max_db, raw + self.cfg.voicing_max_db)
            sm = np.maximum.accumulate(sm, axis=1)  # keep loudness monotonic in velocity
        self.level_raw = {k: raw[i] for i, k in enumerate(keys)}
        self.level_target = {k: sm[i] for i, k in enumerate(keys)}

    def target_level_db(self, kc, vel):
        """Loudness (dB, 200 ms RMS) a note of sample-note kc should have at velocity vel."""
        cs = np.array([d['center'] for d in self.layers[kc]])
        lv = self.level_target[kc]
        ref = np.interp(96.0, cs, lv)
        v = float(np.clip(vel, 1, 127))
        if v < cs[0]:   # below the softest layer centre: keep falling gently
            base = lv[0] + 20 * math.log10(v / cs[0]) * 0.5
        else:
            base = float(np.interp(v, cs, lv))
        base = ref + self.cfg.dyn_scale * (base - ref)
        return base + self.cfg.extra_veltrack * 40 * math.log10(v / 127.0)

    # ---- tuning ------------------------------------------------------------------------------
    def _tuning_tables(self):
        meas = {int(k): v for k, v in self.profile['pitch_cents'].items()}
        ks = np.array(sorted(meas), dtype=float)
        ms = np.array([meas[int(k)] for k in ks])
        x = (ks - 64.5) / 43.5
        coef = np.polyfit(x, ms, 3)
        self.measured_cents = meas
        self.stretch_fit = lambda k: float(np.polyval(coef, (k - 64.5) / 43.5))
        retuned = {}
        rpath = os.path.join(self.root, 'SalamanderGrandPianoV3Retuned.sfz')
        if os.path.exists(rpath):
            for r in parse_sfz(rpath)[0]:
                if 'pitch_keycenter' in r or 'lovel' in r:
                    retuned[os.path.basename(r['sample'])] = float(r.get('tune', 0.0))
        self.retuned = retuned

    def shift_cents(self, key, kc, fname):
        base = 100.0 * (key - kc)
        mode = self.cfg.tuning
        if mode == 'natural':
            return base
        if mode == 'retuned':
            return base + self.retuned.get(os.path.basename(fname), 0.0)
        # smoothed: land on the fitted stretch curve for the *played* key
        return base + self.cfg.stretch_scale * self.stretch_fit(key) - self.measured_cents.get(kc, 0.0)

    def target_cents(self, key):
        if self.cfg.tuning == 'smoothed':
            return self.cfg.stretch_scale * self.stretch_fit(key)
        return 0.0

    # ---- preparation ----------------------------------------------------------------------
    def prepared(self, rel_path, pan_key):
        """Load + prepare one sample file -> dict(ms=(n,2) float32 [mid, side], pre, rms200_db, env_db, s_norm)."""
        if rel_path in self._prep_mem:
            return self._prep_mem[rel_path]
        base = os.path.splitext(os.path.basename(rel_path))[0]
        npy = os.path.join(self.prep_dir, base + '.npy')
        meta_p = os.path.join(self.prep_dir, base + '.json')
        if os.path.exists(npy) and os.path.exists(meta_p):
            ms = np.load(npy)
            with open(meta_p) as fh:
                meta = json.load(fh)
        else:
            t0 = time.perf_counter()
            x, sr = sf.read(os.path.join(self.root, rel_path), dtype='float64', always_2d=True)
            if sr != SR:
                x = soxr.resample(x, sr, SR, quality='VHQ')
            ms, meta = prepare_signal(x, SR, pan_key, self.cfg)
            np.save(npy, ms)
            with open(meta_p, 'w') as fh:
                json.dump(meta, fh)
            self.stats['prepared'] += 1
            self.stats['prep_s'] += time.perf_counter() - t0
        d = dict(ms=ms, **meta)
        d['env_db'] = np.asarray(d['env_db'], dtype=np.float32)
        self._prep_mem[rel_path] = d
        return d

    def layer_lag(self, ja, jb, kc, key, pa, pb, maxlag=144):
        """Read offset (samples) for layer b so that it is in phase with layer a over the first 60 ms."""
        ck = (kc, key, ja, jb)
        if ck in self._lags:
            return self._lags[ck]
        n = int(0.06 * SR)
        ia, ib = int(round(pa['pre'])), int(round(pb['pre']))
        a = pa['ms'][ia:ia + n, 0].astype(np.float64)
        b = pb['ms'][:, 0].astype(np.float64)
        best, bl = -2.0, 0
        for L in range(-maxlag, maxlag + 1):
            s0 = ib + L
            if s0 < 0 or s0 + n > len(b):
                continue
            seg = b[s0:s0 + n]
            c = float(np.dot(a, seg) / (np.linalg.norm(a) * np.linalg.norm(seg) + 1e-20))
            if c > best:
                best, bl = c, L
        self._lags[ck] = bl
        self.stats['max_abs_layer_lag'] = max(self.stats.get('max_abs_layer_lag', 0), abs(bl))
        self.stats['layer_lags_at_limit'] = self.stats.get('layer_lags_at_limit', 0) + int(abs(bl) == maxlag)
        return bl

    def pitched(self, rel_path, cents, pan_key):
        key = (rel_path, round(float(cents), 3))
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit
        p = self.prepared(rel_path, pan_key)
        if abs(cents) < 1e-4:
            out = dict(ms=p['ms'], pre=float(p['pre']), env_db=p['env_db'], s_norm=p['s_norm'], ratio=1.0)
        else:
            t0 = time.perf_counter()
            r = 2.0 ** (cents / 1200.0)
            y = resample(p['ms'], SR * r, SR)
            out = dict(ms=y, pre=p['pre'] / r, env_db=p['env_db'], s_norm=p['s_norm'], ratio=r)
            self.stats['resampled'] += 1
            self.stats['resample_s'] += time.perf_counter() - t0
        self._cache[key] = out
        self._cache_bytes += out['ms'].nbytes
        while self._cache_bytes > self.cfg.cache_gb * 1e9 and len(self._cache) > 1:
            _, old = self._cache.popitem(last=False)
            self._cache_bytes -= old['ms'].nbytes
        return out


def resample(x, in_rate, out_rate):
    x = np.ascontiguousarray(x, dtype=np.float32)
    if soxr is not None:
        return soxr.resample(x, in_rate, out_rate, quality='VHQ')
    from fractions import Fraction  # fallback: polyphase FIR (Kaiser), rational approximation
    fr = Fraction(out_rate / in_rate).limit_denominator(2000)
    return signal.resample_poly(x, fr.numerator, fr.denominator, axis=0, window=('kaiser', 10.0)).astype(np.float32)


def prepare_signal(x, sr, pan_key, cfg: Config):
    """Energy-preserving downmix + side, rumble HPF, onset trim with fixed pre-roll, end fade.
    The STFT downmix smears energy up to one window (43 ms) before the attack, so the raw mid (L+R)/2 is kept
    through the attack (the hammer transient is coherent between the mics) and crossfaded to the EPD mid
    between epd_xfade_ms[0] and [1] after the onset; the onset is detected on the raw signal."""
    L, R = x[:, 0], x[:, 1]
    n = len(L)
    on_raw = attack_onset(x, sr)
    nper, nov = 2048, 1536
    _, _, Lz = signal.stft(L, sr, nperseg=nper, noverlap=nov)
    _, _, Rz = signal.stft(R, sr, nperseg=nper, noverlap=nov)
    Mz = 0.5 * (Lz + Rz)
    pt = np.maximum(uniform_filter1d(0.5 * (np.abs(Lz) ** 2 + np.abs(Rz) ** 2), 5, axis=1), 0.0)
    pm = np.maximum(uniform_filter1d(np.abs(Mz) ** 2, 5, axis=1), 0.0)
    g = np.clip(np.sqrt(pt / (pm + 1e-24)), 1.0, 10 ** (cfg.epd_max_boost_db / 20))
    _, Me = signal.istft(Mz * g, sr, nperseg=nper, noverlap=nov)
    Me = Me[:n]
    Mr = 0.5 * (L + R)
    a, b = on_raw + int(cfg.epd_xfade_ms[0] * 1e-3 * sr), on_raw + int(cfg.epd_xfade_ms[1] * 1e-3 * sr)
    w = np.clip((np.arange(n) - a) / max(b - a, 1), 0.0, 1.0)
    w = 0.5 - 0.5 * np.cos(np.pi * w)
    M = (1 - w) * Mr + w * Me
    S = 0.5 * (L - R)
    ms = np.stack([M, S], axis=1)
    # rumble high-pass (zero phase, so the onset does not move)
    fc = min(cfg.rumble_hp_max_hz, 0.45 * float(f_et(pan_key)))
    if fc > 18.0:
        sos = signal.butter(1, fc, 'highpass', fs=sr, output='sos')
        ms = signal.sosfiltfilt(sos, ms, axis=0)
    on = on_raw
    pre_n = int(round(cfg.preroll_ms * 1e-3 * sr))
    st = max(on - pre_n, 0)
    ms = ms[st:].copy()
    pre = on - st
    fi = max(min(pre, int(0.001 * sr)), 1)
    ms[:fi] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fi)))[:, None]
    fo = int(0.02 * sr)
    ms[-fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo)))[:, None]
    m = ms[:, 0]
    seg = m[pre:pre + int(0.2 * sr)]
    rms200 = float(lin2db(np.sqrt(np.mean(seg ** 2))))
    hop = int(0.01 * sr)
    nb = len(m) // hop
    env = lin2db(np.sqrt(np.mean(m[:nb * hop].reshape(nb, hop) ** 2, axis=1)))
    env_db = (env - env[: max(int(0.3 / 0.01), 1)].max()).round(2)
    one = slice(pre, pre + sr)
    s_ratio = np.sqrt(np.mean(ms[one, 1] ** 2) / (np.mean(ms[one, 0] ** 2) + 1e-20))
    s_norm = float(min(1.0, 10 ** (cfg.side_cap_db / 20) / max(s_ratio, 1e-9)))
    meta = dict(pre=int(pre), rms200_db=rms200, env_db=env_db.tolist(), s_norm=s_norm,
                onset_src=int(on), side_mid_db=float(lin2db(s_ratio)))
    return ms.astype(np.float32), meta


# --------------------------------------------------------------------------------------------
# MIDI
# --------------------------------------------------------------------------------------------
def load_midi(path):
    import mido
    mid = mido.MidiFile(path)
    t = 0.0
    active, notes, ccs = {}, [], []
    for msg in mid:   # merged tracks, delta times in seconds (tempo map applied by mido)
        t += msg.time
        if msg.type == 'note_on' and msg.velocity > 0:
            active.setdefault(msg.note, []).append((t, msg.velocity))
        elif msg.type in ('note_off', 'note_on'):
            lst = active.get(msg.note)
            if lst:
                s, v = lst.pop(0)
                notes.append(Note(s, t, msg.note, v))
        elif msg.type == 'control_change':
            ccs.append((t, msg.control, msg.value))
    for p, lst in active.items():
        for s, v in lst:
            notes.append(Note(s, t, p, v))
    return notes, ccs


def load_score(path):
    """music/dsl.py `to_json` output: notes[{pitch, t_on, t_off, vel}], pedal[[t, cc64]] (+ optional soft[[t, cc67]]).
    Times are music time in seconds and are used exactly (no MIDI tick quantisation)."""
    with open(path) as fh:
        d = json.load(fh)
    notes = [Note(float(n['t_on']), float(n['t_off']), int(n['pitch']), int(n['vel']), str(n.get('voice', '')))
             for n in d['notes']]
    ccs = [(float(t), 64, int(round(v))) for t, v in d.get('pedal', [])]
    ccs += [(float(t), 67, int(round(v))) for t, v in d.get('soft', [])]
    return notes, sorted(ccs)


def load_events(path):
    """MIDI (.mid/.midi) or score JSON (.json) -> (notes, ccs)."""
    return load_score(path) if path.lower().endswith('.json') else load_midi(path)


def sanitize_notes(notes):
    notes = sorted((Note(float(n.start), float(n.end), int(n.pitch), int(n.velocity), getattr(n, 'voice', ''))
                    for n in notes), key=lambda n: (n.start, n.pitch))
    by_key = {}
    for n in notes:
        by_key.setdefault(n.pitch, []).append(n)
    out = []
    for k, lst in by_key.items():
        for i, n in enumerate(lst):
            end = max(n.end, n.start + 0.02)
            if i + 1 < len(lst):
                end = min(end, lst[i + 1].start)
            out.append(Note(n.start, max(end, n.start + 0.005), n.pitch, max(1, min(127, n.velocity)), n.voice))
    return sorted(out, key=lambda n: (n.start, n.pitch))


# --------------------------------------------------------------------------------------------
# Pedal
# --------------------------------------------------------------------------------------------
def controller_curve(ccs, number, n_ctrl, blk, default=0.0):
    """Step function (value/127) at control rate for one CC number."""
    v = np.full(n_ctrl, default, dtype=np.float64)
    ev = sorted(((t, val) for t, c, val in ccs if c == number), key=lambda e: e[0])   # stable: keeps file order at equal t
    for t, val in ev:
        i = int(round(t * SR / blk))
        if i < n_ctrl:
            v[max(i, 0):] = val / 127.0
    return v


def damper_lift(cc64, cfg: Config, blk):
    """CC64 (0..1) -> damper lift 0 (on strings) .. 1 (fully lifted), half-pedal zone + slew limit."""
    lo, hi = cfg.pedal_lo / 127.0, cfg.pedal_hi / 127.0
    x = np.clip((cc64 - lo) / (hi - lo), 0.0, 1.0)
    target = x * x * (3 - 2 * x)
    step = blk / (cfg.pedal_travel_s * SR)
    out = np.empty_like(target)
    cur = target[0]
    # slew limiting on the (few) change points only
    change = np.flatnonzero(np.diff(target)) + 1
    seg_starts = np.concatenate(([0], change))
    seg_ends = np.concatenate((change, [len(target)]))
    for a, b in zip(seg_starts, seg_ends):
        tv = target[a]
        idx = np.arange(b - a)
        if tv >= cur:
            out[a:b] = np.minimum(cur + step * (idx + 1), tv)
        else:
            out[a:b] = np.maximum(cur - step * (idx + 1), tv)
        cur = out[b - 1]
    return out


# --------------------------------------------------------------------------------------------
# Impulse responses
# --------------------------------------------------------------------------------------------
OCT_CENTERS = np.array([63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000], dtype=float)


def _band_split(noise, sr):
    n = len(noise)
    N = np.fft.rfft(noise)
    lf = np.log2(np.maximum(np.fft.rfftfreq(n, 1 / sr), 1.0) / 1000.0)
    lc = np.log2(OCT_CENTERS / 1000.0)
    eye = np.eye(len(OCT_CENTERS))
    return [np.fft.irfft(N * np.interp(lf, lc, eye[i]), n) for i in range(len(OCT_CENTERS))]


def make_reverb_ir(cfg: Config, sr=SR):
    """True-stereo synthetic hall: sparse early reflections + octave-band exponentially decaying noise.
    Returns (n, 2, 2) array ir[:, in_ch, out_ch], each direct path normalised to unit energy."""
    rng = np.random.default_rng(cfg.seed + 101)
    rt = np.asarray(cfg.reverb_rt60, dtype=float)
    pd = cfg.reverb_predelay_ms * 1e-3
    n = int((pd + 1.1 * rt.max()) * sr)
    t = np.arange(n) / sr
    ir = np.zeros((n, 2, 2))
    for i in range(2):
        for o in range(2):
            tail = np.zeros(n)
            for b, band in enumerate(_band_split(rng.standard_normal(n), sr)):
                tail += band * np.exp(-6.9078 * t / rt[b])
            t0 = pd + 0.008
            tail *= np.where(t >= t0, 1 - np.exp(-(t - t0) / 0.015), 0.0)
            # early reflections: 16 taps in the first 75 ms after pre-delay, per path
            er = np.zeros(n)
            times = np.sort(rng.uniform(pd, pd + 0.075, 16))
            for tt in times:
                er[int(tt * sr)] += rng.choice([-1.0, 1.0]) * np.exp(-(tt - pd) / 0.045) * rng.uniform(0.5, 1.0)
            er = signal.lfilter([0.35], [1, -0.65], er)          # soften the taps (one-pole LP)
            tail /= np.sqrt(np.sum(tail ** 2))
            er /= np.sqrt(np.sum(er ** 2))
            path = 0.88 * tail + 0.47 * er                        # ~22 % of energy in the early reflections
            path /= np.sqrt(np.sum(path ** 2))
            ir[:, i, o] = path * (1.0 if i == o else 10 ** (cfg.reverb_cross_db / 20))
    ir /= np.sqrt(1 + 10 ** (cfg.reverb_cross_db / 10))
    return normalize_ir_midband(ir, sr)


def normalize_ir_midband(ir, sr=SR):
    """Scale a (n, 2, 2) IR so that, for a mono input, |H(f)|^2 summed over the input paths averages 1 over
    250 Hz - 2 kHz (where piano energy lives). reverb_wet_db is then the wet/dry energy ratio for mid-register
    material; unit *total* energy would read ~4 dB hotter on piano because the bass/mid bands decay longest."""
    f = np.fft.rfftfreq(ir.shape[0], 1 / sr)
    band = (f >= 250) & (f <= 2000)
    p = 0.0
    for o in range(2):
        H = np.fft.rfft(ir[:, 0, o] + ir[:, 1, o])
        p += 0.5 * np.mean(np.abs(H[band]) ** 2)        # average over the two outputs
    return ir / np.sqrt(p)


def resolve_path(path):
    """Absolute, as given (cwd), or relative to the repo root / music folder."""
    for p in (path, os.path.join(os.path.dirname(HERE), path), os.path.join(HERE, path)):
        if os.path.exists(p):
            return p
    raise FileNotFoundError(path)


def load_ir(path, sr=SR):
    x, fs = sf.read(resolve_path(path), dtype='float64', always_2d=True)
    if fs != sr:
        x = soxr.resample(x, fs, sr, quality='VHQ')
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    x = x[:, :2]
    # drop the direct sound: start 2 ms after the strongest arrival, keep the room only
    d = int(np.argmax(np.abs(x).max(axis=1)))
    x = x[d + int(0.002 * sr):]
    fi = int(0.003 * sr)
    x[:fi] *= np.linspace(0, 1, fi)[:, None]
    x = signal.sosfiltfilt(signal.butter(2, 60.0, 'highpass', fs=sr, output='sos'), x, axis=0)   # measured IRs: LF noise
    ir = np.zeros((len(x), 2, 2))
    for c in range(2):
        ir[:, c, c] = x[:, c]
    return normalize_ir_midband(ir, sr)


def make_resonance_ir(bank: Bank, cfg: Config, sr=SR):
    """Sympathetic string bank: damped partials of all damped strings, panned by key, unit energy per channel."""
    cache = os.path.join(bank.prep_dir, f'resonance_ir_{cfg.seed}_{cfg.tuning}_{cfg.resonance_len_s}.npy')
    if os.path.exists(cache):
        return np.load(cache)
    rng = np.random.default_rng(cfg.seed + 202)
    fs, amps, taus, phs, gl, gr = [], [], [], [], [], []
    for k in range(21, cfg.damper_top + 1):
        f0 = float(f_et(k)) * 2 ** (bank.target_cents(k) / 1200)
        B = 10 ** np.interp(k, [21, 48, 72, 108], [-3.7, -4.0, -3.6, -2.7])
        nmax = int(min(40, 9000 // f0))
        nn = np.arange(1, nmax + 1)
        fn = nn * f0 * np.sqrt(1 + B * nn ** 2)
        keep = fn < 9000
        t60 = 0.5 * np.interp(k, [21, 60, 88], [10.0, 6.0, 3.0]) / (1 + 0.05 * (nn - 1))
        p = cfg.pan_spread * np.clip((k - 64.5) / 43.5, -1, 1)
        a = (1.0 / nn)[keep]
        fs.append(fn[keep]); amps.append(a); taus.append((t60 / 6.9078)[keep]); phs.append(rng.uniform(0, 2 * np.pi, keep.sum()))
        gl.append(np.full(keep.sum(), math.cos((p + 1) * math.pi / 4) * math.sqrt(2)))
        gr.append(np.full(keep.sum(), math.sin((p + 1) * math.pi / 4) * math.sqrt(2)))
    fs, amps, taus, phs = map(np.concatenate, (fs, amps, taus, phs))
    G = np.stack([np.concatenate(gl), np.concatenate(gr)], axis=1) * amps[:, None]
    n = int(cfg.resonance_len_s * sr)
    ir = np.zeros((n, 2))
    blk = 4096
    w = 2 * np.pi * fs
    for a in range(0, n, blk):
        t = np.arange(a, min(a + blk, n))[:, None] / sr
        ir[a:a + len(t)] = (np.exp(-t / taus) * np.cos(w * t + phs)) @ G
    fo = int(0.2 * sr)
    ir[-fo:] *= np.linspace(1, 0, fo)[:, None]
    ir[: int(0.001 * sr)] *= np.linspace(0, 1, int(0.001 * sr))[:, None]
    ir /= np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))
    np.save(cache, ir.astype(np.float32))
    return ir.astype(np.float32)


# --------------------------------------------------------------------------------------------
# Filters / mastering
# --------------------------------------------------------------------------------------------
def peaking_sos(f0, gain_db, q, sr=SR):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / sr; al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]; a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return signal.tf2sos(np.array(b) / a[0], np.array(a) / a[0])


def high_shelf_sos(f0, gain_db, sr=SR, s=1.0):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / sr
    al = np.sin(w) / 2 * np.sqrt((A + 1 / A) * (1 / s - 1) + 2); c = np.cos(w)
    b = [A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al), -2 * A * ((A - 1) + (A + 1) * c),
         A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al)]
    a = [(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al]
    return signal.tf2sos(np.array(b) / a[0], np.array(a) / a[0])


def integrated_lufs(x, sr=SR):
    import pyloudnorm as pyln
    return float(pyln.Meter(sr).integrated_loudness(x))


def true_peak_db(x, sr=SR, os_factor=4):
    y = resample(x, sr, sr * os_factor)
    return float(lin2db(np.abs(y).max()))


def tp_limiter(x, cfg: Config, sr=SR):
    """Look-ahead limiter on the 4x-oversampled peak envelope. Gain never exceeds what each sample needs
    (min-filter + moving average of half the window), recovers with an exponential release."""
    os_f = 4
    ceiling = 10 ** ((cfg.tp_ceiling_db - 0.2) / 20)
    y = resample(x, sr, sr * os_f)
    n = len(x)
    a = np.abs(y).max(axis=1)
    if len(a) < n * os_f:
        a = np.pad(a, (0, n * os_f - len(a)))
    a = a[: n * os_f].reshape(n, os_f).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(a, 1e-12))
    if need.min() >= 1.0:
        return x, dict(max_gr_db=0.0, gr_time_pct=0.0)
    W = max(int(cfg.limiter_lookahead_ms * 1e-3 * sr), 2)
    gm = minimum_filter1d(need, size=2 * W + 1, mode='nearest')
    blk = 16
    nb = int(math.ceil(n / blk))
    b = np.pad(gm, (0, nb * blk - n), constant_values=1.0).reshape(nb, blk).min(axis=1)
    b = np.minimum(np.minimum(b, np.roll(b, 1)), np.roll(b, -1))
    rel = math.exp(-blk / (cfg.limiter_release_ms * 1e-3 * sr))
    out = np.empty(nb)
    g = 1.0
    for i in range(nb):           # block-rate release smoothing (only lets the gain recover slowly)
        g = min(b[i], 1.0 - (1.0 - g) * rel)
        out[i] = g
    gs = np.interp(np.arange(n), np.arange(nb) * blk + blk / 2, out)
    gs = np.minimum(gs, gm)
    gs = uniform_filter1d(gs, size=W // 2 * 2 + 1, mode='nearest')
    gs = np.minimum(gs, need)      # hard guarantee
    return x * gs[:, None], dict(max_gr_db=float(-lin2db(gs.min())), gr_time_pct=float(100 * np.mean(gs < 10 ** (-0.5 / 20))))


def glue_compressor(x, cfg: Config, ref_lufs, sr=SR):
    """Slow feed-forward RMS compressor with soft knee. Gain computed at a 64-sample block rate, linear-interpolated."""
    if cfg.comp_ratio <= 1.0:
        return x, None
    blk = 64
    n = len(x)
    nb = n // blk + 1
    p = np.pad(np.mean(x ** 2, axis=1), (0, nb * blk - n)).reshape(nb, blk).mean(axis=1)
    p = np.maximum(uniform_filter1d(p, size=max(int(cfg.comp_rms_ms * 1e-3 * sr / blk), 1)), 1e-20)   # RMS detector
    lvl = 10 * np.log10(p + 1e-20)                                      # dBFS power (not K-weighted)
    thr = ref_lufs + cfg.comp_thresh_rel_db
    over = lvl - thr
    kn = cfg.comp_knee_db
    sl = 1 - 1 / cfg.comp_ratio
    gr = np.where(over <= -kn / 2, 0.0, np.where(over >= kn / 2, sl * over, sl * (over + kn / 2) ** 2 / (2 * kn)))
    a_att = math.exp(-blk / (cfg.comp_attack_ms * 1e-3 * sr))
    a_rel = math.exp(-blk / (cfg.comp_release_ms * 1e-3 * sr))
    out = np.empty(nb)
    g = 0.0
    for i in range(nb):
        target = gr[i]
        a = a_att if target > g else a_rel
        g = a * g + (1 - a) * target
        out[i] = g
    gain = db2lin(-np.interp(np.arange(n), np.arange(nb) * blk + blk / 2, out))
    return x * gain[:, None], dict(max_gr_db=round(float(out.max()), 2), mean_gr_db=round(float(out.mean()), 2),
                                   pct_time_gr_over_1db=round(float(100 * np.mean(out > 1.0)), 2))


def k_weighted(x, sr=SR):
    import pyloudnorm as pyln
    y = np.array(x, dtype=np.float64, copy=True)
    for stage in pyln.Meter(sr)._filters.values():
        for c in range(y.shape[1]):
            y[:, c] = stage.apply_filter(y[:, c])
    return y


def short_term_loudness(x, sr=SR, win_s=3.0, hop_s=0.1):
    """BS.1770 short-term loudness (3 s window) at 10 Hz -> (times of window ends, LUFS)."""
    p = np.sum(k_weighted(x, sr) ** 2, axis=1)               # channel weights 1.0 for L/R
    c = np.concatenate(([0.0], np.cumsum(p)))
    w, h = int(win_s * sr), int(hop_s * sr)
    ends = np.arange(w, len(p) + 1, h)
    ms = (c[ends] - c[ends - w]) / w
    return ends / sr, -0.691 + 10 * np.log10(np.maximum(ms, 1e-30))


def loudness_range(x, sr=SR):
    """EBU Tech 3342 LRA (LU): 10th..95th percentile of gated short-term loudness."""
    if len(x) < 3 * sr:
        return None
    _, st = short_term_loudness(x, sr)
    st = st[st > -70.0]
    if not len(st):
        return None
    rel = 10 * np.log10(np.mean(10 ** (st / 10))) - 20.0
    st = st[st > rel]
    return round(float(np.percentile(st, 95) - np.percentile(st, 10)), 2)


def master(mix, cfg: Config, sr=SR):
    """Optional glue compressor -> gain to target_lufs -> true-peak limiter (gain-reduction budget
    limiter_max_gr_db; beyond it the level is lowered instead of squashing transients) -> one loudness correction
    pass (limiting costs ~0.1-0.3 LU). target_lufs=None skips normalisation and limiting (used by calibration)."""
    comp = None
    if cfg.comp_ratio > 1.0:
        mix, comp = glue_compressor(mix, cfg, integrated_lufs(mix), sr)
    if cfg.target_lufs is None:
        return mix, dict(compressor=comp, loudness_gain_db=0.0, limiter=None)
    ceiling = cfg.tp_ceiling_db - 0.2
    pre_lufs = integrated_lufs(mix, sr)
    tp_raw = true_peak_db(mix, sr)
    gain_db = cfg.target_lufs - pre_lufs
    need_gr = tp_raw + gain_db - ceiling
    lowered = max(0.0, need_gr - cfg.limiter_max_gr_db)
    gain_db -= lowered
    y, lim = tp_limiter(mix * db2lin(gain_db), cfg, sr)
    if lowered == 0.0:
        short = cfg.target_lufs - integrated_lufs(y, sr)
        if short > 0.02:
            gain_db += short
            y, lim = tp_limiter(mix * db2lin(gain_db), cfg, sr)
    return y, dict(pre_master_lufs=round(pre_lufs, 2), pre_master_tp_dbtp=round(tp_raw, 2),
                   plr_db=round(tp_raw - pre_lufs, 2), loudness_gain_db=round(gain_db, 2),
                   level_lowered_by_gr_budget_db=round(lowered, 2),
                   limiter={k: round(v, 2) for k, v in lim.items()}, compressor=comp)


def detect_clicks(x, sr=SR, exclude_s=(), exclude_win_s=0.004, ratio=10.0, floor=1e-4):
    """Second-difference spikes that stand far above the local (10 ms) RMS of the second difference.
    Returns times (s) not within exclude_win_s of the excluded event times (note onsets, pedal events)."""
    d2 = np.abs(x[2:] - 2 * x[1:-1] + x[:-2]).max(axis=1)
    loc = np.sqrt(np.maximum(uniform_filter1d(d2 ** 2, size=int(0.01 * sr) | 1), 0.0))
    hit = np.flatnonzero((d2 > ratio * loc) & (d2 > floor)) + 1
    if len(hit) == 0:
        return []
    ex = np.sort(np.asarray(exclude_s, dtype=float))
    times = hit / sr
    if len(ex):
        j = np.clip(np.searchsorted(ex, times), 1, len(ex) - 1) if len(ex) > 1 else np.zeros(len(times), int)
        near = np.minimum(np.abs(times - ex[j]), np.abs(times - ex[np.maximum(j - 1, 0)]))
        times = times[near > exclude_win_s]
    # merge hits closer than 2 ms
    merged = []
    for t in times:
        if not merged or t - merged[-1] > 0.002:
            merged.append(float(t))
    return merged


# --------------------------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------------------------
def velcurve(v, veltrack):
    return (max(v, 1) / 127.0) ** (2.0 * veltrack)


def render(notes, ccs, cfg: Config | None = None, bank: Bank | None = None, stems=False, log=print,
           keep_premaster=False):
    """notes: list[Note] (start/end = key down/up in seconds), ccs: list[(t, cc_number, value)] (CC64 sustain,
    CC67 soft). Output sample 0 is t = 0 (music time); nothing is trimmed at the start."""
    cfg = cfg or Config()
    bank = bank or Bank(cfg)
    T = {}
    t_all = time.perf_counter()
    rng = np.random.default_rng(cfg.seed)
    notes = sanitize_notes(notes)
    blk = cfg.ctrl_block
    last = max([n.end for n in notes] + [t for t, _, _ in ccs] + [0.0])
    n_out = int((last + cfg.tail_s + 30.0) * SR)     # generous; trimmed at the end
    n_ctrl = n_out // blk + 2
    lift = damper_lift(controller_curve(ccs, 64, n_ctrl, blk), cfg, blk)
    soft = controller_curve(ccs, 67, n_ctrl, blk)
    dry = np.zeros((n_out, 2), dtype=np.float64)
    rel_bus = np.zeros((n_out, 2), dtype=np.float64)
    r_damp_tab = 6.9078 / np.interp(np.arange(128), cfg.damper_t60_keys, cfg.damper_t60_s)
    r_restrike = 6.9078 / cfg.restrike_t60_s
    dt = blk / SR
    end_amp = []
    log_notes = []
    exclude = []
    next_same, upcoming = {}, {}
    for i in range(len(notes) - 1, -1, -1):          # start time of the next strike of the same key
        next_same[i] = upcoming.get(notes[i].pitch)
        upcoming[notes[i].pitch] = notes[i].start

    def pan_gains(k):
        p = cfg.pan_spread * float(np.clip((k - 64.5) / 43.5, -1, 1))
        return math.cos((p + 1) * math.pi / 4) * math.sqrt(2), math.sin((p + 1) * math.pi / 4) * math.sqrt(2)

    def place(bus, start, ms, gain, k, s_norm, env=None):
        gl, gr = pan_gains(k)
        n = ms.shape[0]
        if start < 0:
            ms = ms[-start:]
            env = None if env is None else env[-start:]
            n = ms.shape[0]; start = 0
        n = min(n, bus.shape[0] - start)
        m = ms[:n, 0].astype(np.float64) * gain
        s = ms[:n, 1].astype(np.float64) * (gain * cfg.side_gain * s_norm)
        if env is not None:
            m *= env[:n]; s *= env[:n]
        bus[start:start + n, 0] += gl * m + s
        bus[start:start + n, 1] += gr * m - s

    t_voices = time.perf_counter()
    for i, nt in enumerate(notes):
        k = nt.pitch
        if k not in bank.keymap:
            continue
        kc = bank.keymap[k]
        layers = bank.layers[kc]
        on_c = int(nt.start * SR / blk)
        soft_on = soft[min(on_c, n_ctrl - 1)] >= 0.5
        v = nt.velocity * (cfg.soft_pedal_vel if soft_on else 1.0)
        # --- layer choice + crossfade weights
        cs = [d['center'] for d in layers]
        ja = int(np.clip(np.searchsorted([d['hivel'] + 0.5 for d in layers], v), 0, len(layers) - 1))
        picks = [(ja, 1.0)]
        if cfg.xfade_width > 0:
            best_w = 0.0
            for jb in (ja - 1, ja + 1):          # nearest boundary wins (layers v3/v5 are only 2-3 units wide)
                if 0 <= jb < len(layers):
                    bnd = layers[min(ja, jb)]['hivel'] + 0.5
                    w = float(np.clip(0.5 - abs(v - bnd) / cfg.xfade_width, 0.0, 0.5))
                    if w > best_w:
                        best_w = w
                        picks = [(ja, 1.0 - w), (jb, w)]
        srcs = []
        for j, w in picks:
            f = layers[j]['file']
            srcs.append((bank.pitched(f, bank.shift_cents(k, kc, f), kc), w))
        # align the secondary layer on the primary by cross-correlation of the first 60 ms (onset thresholds of
        # different layers disagree by up to ~1.8 ms, which made 50/50 crossfades cancel by up to 9 dB)
        prim, wa = srcs[0]
        pre_i = int(round(prim['pre']))
        length = prim['ms'].shape[0] - pre_i
        mix = prim['ms'][: pre_i + length] * wa
        if len(srcs) == 2:
            sec, wb = srcs[1]
            lag = bank.layer_lag(picks[0][0], picks[1][0], kc, k, prim, sec)
            st_b = int(round(sec['pre'])) + lag - pre_i          # secondary index aligned with primary index 0
            seg = sec['ms'][max(st_b, 0):]
            if st_b < 0:
                seg = np.concatenate([np.zeros((-st_b, 2), np.float32), seg])
            n_common = min(len(mix), len(seg))
            mix = mix[:n_common] + seg[:n_common] * wb
        lvl = float(lin2db(np.sqrt(np.mean(mix[pre_i:pre_i + int(0.2 * SR), 0].astype(np.float64) ** 2))))
        mel_lift = (cfg.melody_lift_db_per_unit * max(0.0, v - cfg.melody_lift_knee)
                    if cfg.melody_lift_db_per_unit and nt.voice in cfg.melody_voices else 0.0)
        tgt = bank.target_level_db(kc, v) + (cfg.soft_pedal_db if soft_on else 0.0) + mel_lift
        gain = float(db2lin(tgt - lvl))
        s_norm = prim['s_norm']
        # --- envelope at control rate from the onset
        n_avail = mix.shape[0] - pre_i
        K = n_avail // blk + 1
        cidx = on_c + np.arange(K)
        cidx_c = np.minimum(cidx, n_ctrl - 1)
        t_ctrl = cidx * dt
        rate = np.zeros(K)
        off_c = int(nt.end * SR / blk)
        damped = k <= cfg.damper_top
        if damped:
            up = cidx >= off_c
            rate[up] = r_damp_tab[k] * (1.0 - lift[cidx_c[up]])
        nxt = next_same.get(i)
        if nxt is not None:
            rate[t_ctrl >= nxt] += r_restrike
        cum = np.cumsum(rate) * dt
        env_c = np.exp(-cum)
        below = np.flatnonzero(env_c < 1e-5)
        K_end = int(below[0]) + 1 if len(below) else K
        env_c = env_c[:K_end]
        n_voice = min(n_avail, K_end * blk)
        env = np.interp(np.arange(n_voice), np.arange(K_end) * blk, env_c)
        fo = min(int(0.005 * SR), n_voice)
        env[n_voice - fo:] *= np.linspace(1, 0, fo)
        env_full = np.concatenate([np.ones(pre_i), env])
        # onset alignment: measure this voice's attack rise (same definition as onset_calibration.json) and place
        # it exactly on the note-on, so delta_audio ~ 0 for every key/velocity (raw files differ by up to ~8 ms)
        ons = onset_measures(np.abs(mix[: pre_i + int(0.3 * SR), 0]), pre_i)
        align_n = int(round(np.clip(ons['rise'] if (ons and cfg.align_onsets) else 0.0, -10.0, 10.0) * 1e-3 * SR))
        start = int(round(nt.start * SR)) - pre_i - align_n
        place(dry, start, mix[: pre_i + n_voice], gain, k, s_norm, env_full)
        end_amp.append(float(np.abs(mix[pre_i + n_voice - fo: pre_i + n_voice, 0]).max() * gain * env[n_voice - fo]) if fo else 0.0)
        exclude.append(nt.start)
        # --- key-up mechanical noise (rel*), at key release
        held = nt.end - nt.start
        rr = bank.rel.get(k)
        if rr is not None:
            p = bank.pitched(rr['sample'], 0.0, k)
            g = (db2lin(float(rr.get('volume', 0)) + cfg.key_noise_gain_db) * velcurve(nt.velocity, float(rr.get('amp_veltrack', 0)) / 100)
                 * db2lin(-float(rr.get('rt_decay', 0)) * held))
            st = int(round(nt.end * SR)) - int(round(p['pre']))
            place(rel_bus, st, p['ms'], float(g), k, p['s_norm'])
            exclude.append(nt.end)
        # --- damper contact: string/damper release samples (harm*)
        t_damp = None
        if damped and k in bank.harm:
            cand = np.flatnonzero((cidx >= off_c) & (lift[cidx_c] < 0.5))
            if len(cand):
                c0 = int(cand[0])
                tc = float(t_ctrl[c0])
                if (nxt is None or tc < nxt) and c0 < len(env_c):
                    t_damp = tc
                    nat = prim['env_db']
                    nat_db = float(nat[min(int((tc - nt.start) / 0.01), len(nat) - 1)]) if len(nat) else 0.0
                    lvl_db = float(np.clip(nat_db + lin2db(env_c[c0]), -80, 0))
                    for kind in (('L' if nt.velocity >= 45 else 'S'), 'V3'):
                        hr = bank.harm[k].get(kind)
                        if hr is None:
                            continue
                        hkc = int(hr.get('pitch_keycenter', 60))
                        p = bank.pitched(hr['sample'], 100.0 * (k - hkc) + bank.target_cents(k), hkc)
                        g = (db2lin(float(hr.get('volume', 0)) + cfg.release_gain_db + lvl_db)
                             * velcurve(nt.velocity, float(hr.get('amp_veltrack', 100)) / 100))
                        st = int(round(tc * SR)) - int(round(p['pre']))
                        place(rel_bus, st, p['ms'], float(g), k, p['s_norm'])
        a_ms = align_n * 1000.0 / SR
        log_notes.append(dict(start=round(nt.start, 5), end=round(nt.end, 5), pitch=k, velocity=nt.velocity,
                              damper=None if t_damp is None else round(t_damp, 5),
                              voice_end=round(nt.start + n_voice / SR, 4), gain_db=round(float(lin2db(gain)), 2),
                              lift_db=round(mel_lift, 2),
                              onset_ms=None if ons is None else {kk: round(vv - a_ms, 3) for kk, vv in ons.items()},
                              aligned_by_ms=round(a_ms, 3), layers=[[int(j) + 1, round(float(w), 3)] for j, w in picks]))
    T['voices_s'] = time.perf_counter() - t_voices

    # --- pedal noise at the moments the damper rail passes half lift
    pedal_events = []
    up_cross = np.flatnonzero((lift[1:] >= 0.5) & (lift[:-1] < 0.5)) + 1
    dn_cross = np.flatnonzero((lift[1:] < 0.5) & (lift[:-1] >= 0.5)) + 1
    for idx, regs, kind in ((up_cross, bank.pedal_down, 'down'), (dn_cross, bank.pedal_up, 'up')):
        for c in idx:
            r = regs[int(rng.integers(len(regs)))]
            p = bank.pitched(r['sample'], 0.0, 36)
            g = db2lin(float(r.get('volume', 0)) + cfg.pedal_noise_gain_db)
            tc = c * dt
            place(rel_bus, int(round(tc * SR)) - int(round(p['pre'])), p['ms'], float(g), 64, p['s_norm'])
            pedal_events.append(dict(t=round(tc, 5), kind=kind))
            exclude.append(tc)

    strings = dry + rel_bus
    # --- sympathetic resonance while the dampers are lifted
    t_res = time.perf_counter()
    res = np.zeros_like(strings)
    res_rel_ped = None
    if cfg.resonance_db is not None and str(cfg.resonance_db) != 'off':
        ir = make_resonance_ir(bank, cfg)
        lift_s = np.interp(np.arange(n_out), np.arange(n_ctrl) * blk, lift)
        mono = strings.mean(axis=1) * lift_s
        on = lift_s > 0.02
        edges = np.flatnonzero(np.diff(on.astype(np.int8)))
        bounds = np.concatenate(([0], edges + 1, [n_out]))
        r_off = 6.9078 / 0.3
        for a, b in zip(bounds[:-1], bounds[1:]):
            if not on[a]:
                continue
            y = np.stack([signal.oaconvolve(mono[a:b], ir[:, c]) for c in range(2)], axis=1)
            tail_t = np.arange(len(y) - (b - a)) / SR
            y[b - a:] *= np.exp(-r_off * tail_t)[:, None]
            m = min(len(y), n_out - a)
            res[a:a + m] += y[:m]
        res *= db2lin(cfg.resonance_db)
        ped = lift_s > 0.5
        if ped.any():
            res_rel_ped = float(lin2db(np.sqrt(np.mean(res[ped] ** 2) / max(np.mean(strings[ped] ** 2), 1e-30))))
    T['resonance_s'] = time.perf_counter() - t_res
    bus = strings + res

    # --- reverb
    t_rev = time.perf_counter()
    wet = np.zeros_like(bus)
    ir_info = None
    if cfg.reverb and cfg.reverb != 'none':
        ir = make_reverb_ir(cfg) if cfg.reverb == 'synth' else load_ir(cfg.reverb)
        send = bus
        if cfg.reverb_send_hp_hz:
            send = signal.sosfilt(signal.butter(2, cfg.reverb_send_hp_hz, 'highpass', fs=SR, output='sos'), send, axis=0)
        if cfg.reverb_send_lp_hz:
            send = signal.sosfilt(signal.butter(1, cfg.reverb_send_lp_hz, 'lowpass', fs=SR, output='sos'), send, axis=0)
        for i_ in range(2):
            for o_ in range(2):
                if np.any(ir[:, i_, o_]):
                    y = signal.oaconvolve(send[:, i_], ir[:, i_, o_])[:n_out]
                    wet[: len(y), o_] += y
        wet *= db2lin(cfg.reverb_wet_db)
        ir_info = ir_metrics(ir)
    T['reverb_s'] = time.perf_counter() - t_rev
    mix = bus + wet

    # --- master
    t_m = time.perf_counter()
    # zero-phase (forward-backward) master filters: no group delay, so onsets stay where the voices put them
    # (a causal 25 Hz high-pass delayed the C2 attack by ~2 ms). Each stage is designed at half its dB gain / order
    # because filtfilt squares the magnitude response.
    if cfg.master_hp_hz:
        mix = signal.sosfiltfilt(signal.butter(1, cfg.master_hp_hz, 'highpass', fs=SR, output='sos'), mix, axis=0)
    for f0, gdb, q in cfg.master_eq:
        mix = signal.sosfiltfilt(peaking_sos(f0, gdb / 2.0, q), mix, axis=0)
    if cfg.master_high_shelf and cfg.master_high_shelf[1]:
        f0, gdb = cfg.master_high_shelf
        mix = signal.sosfiltfilt(high_shelf_sos(f0, gdb / 2.0), mix, axis=0)
    # trim trailing silence (-90 dBFS before normalisation, relative to the peak)
    a = np.abs(mix).max(axis=1)
    thr = a.max() * 10 ** (-90 / 20)
    last_i = int(np.flatnonzero(a > thr)[-1]) if np.any(a > thr) else len(a) - 1
    end_i = min(len(mix), max(last_i + int(0.5 * SR), int((last + cfg.tail_s) * SR)))
    mix = mix[:end_i]
    fo = int(0.5 * SR)
    mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    premaster = mix.copy() if keep_premaster else None
    mix, mst = master(mix, cfg)
    gain_db = mst['loudness_gain_db']
    lufs = integrated_lufs(mix)
    tp = true_peak_db(mix)
    T['master_s'] = time.perf_counter() - t_m
    T['total_s'] = time.perf_counter() - t_all
    dur = len(mix) / SR
    stats = dict(duration_s=round(dur, 3), notes=len(notes), pedal_events=len(pedal_events),
                 lufs_integrated=round(lufs, 2), true_peak_dbtp=round(tp, 2),
                 sample_peak_dbfs=round(float(lin2db(np.abs(mix).max())), 2),
                 loudness_range_lu=loudness_range(mix), master=mst,
                 max_level_at_voice_fade_dbfs_prenorm=round(float(lin2db(max(end_amp) if end_amp else 1e-15)), 1),
                 resonance_rel_db_pedalled=None if res_rel_ped is None else round(res_rel_ped, 1),
                 wet_rel_db=round(float(lin2db(np.sqrt(np.mean(wet ** 2)) / max(np.sqrt(np.mean(bus ** 2)), 1e-15))), 1),
                 reverb_ir=ir_info, timings_s={k: round(v, 3) for k, v in T.items()},
                 x_realtime=round(dur / T['total_s'], 2), bank=bank.stats, sfz_warnings=bank.warnings)
    out = dict(audio=mix.astype(np.float32), stats=stats, notes=log_notes, pedal=pedal_events, exclude=sorted(exclude))
    if premaster is not None:
        out['premaster'] = premaster.astype(np.float32)
    if stems:
        g = db2lin(gain_db)
        out['stems'] = {k: (v[:end_i] * g).astype(np.float32) for k, v in
                        dict(notes=dry, releases_pedal=rel_bus, resonance=res, reverb=wet).items()}
    return out


def octave_band(x, fc, sr=SR):
    lo, hi = fc / math.sqrt(2), min(fc * math.sqrt(2), 0.47 * sr)
    sos = signal.butter(3, [lo, hi], 'bandpass', fs=sr, output='sos')
    return signal.sosfilt(sos, x)


def decay_metrics(h, sr=SR):
    """Schroeder T30 (and T20) per octave band, EDT, C80 of an impulse response h (1-D). The integration is
    truncated where the 10 ms envelope meets the late noise floor (+5 dB), so measured IRs are not biased."""
    h = np.asarray(h, dtype=np.float64)
    d = int(np.argmax(np.abs(h)))
    h = h[max(d - int(0.001 * sr), 0):]
    h = h - h.mean()

    def edc_of(y):
        hop = int(0.01 * sr)
        nb = len(y) // hop
        env = 10 * np.log10(np.mean(y[:nb * hop].reshape(nb, hop) ** 2, axis=1) + 1e-30)
        floor = np.median(env[int(nb * 0.9):])
        above = np.flatnonzero(env > floor + 5)
        cut = (above[-1] + 1) * hop if len(above) else len(y)
        e = np.cumsum(y[:cut][::-1] ** 2)[::-1]
        return 10 * np.log10(e / e[0] + 1e-30)

    def t_from(edc, a, b):
        ia, ib = np.argmax(edc <= a), np.argmax(edc <= b)
        return round(60.0 / (a - b) * (ib - ia) / sr, 2) if ib > ia and edc[ib] <= b else None

    bands = {}
    for fc in OCT_CENTERS:
        edc = edc_of(octave_band(h, fc, sr))
        bands[int(fc)] = dict(T30=t_from(edc, -5, -35), T20=t_from(edc, -5, -25))
    edc = edc_of(h)
    n80 = int(0.08 * sr)
    return dict(bands=bands, EDT=t_from(edc, 0, -10), T30=t_from(edc, -5, -35),
                C80_dB=round(float(10 * np.log10(np.sum(h[:n80] ** 2) / np.sum(h[n80:] ** 2))), 1),
                length_s=round(len(h) / sr, 2))


def ir_metrics(ir, sr=SR):
    return decay_metrics(ir[:, 0, 0], sr)


def write_outputs(result, wav_path, mp3_path=None, stems_dir=None, title='Afterglow', artist='Afterglow'):
    os.makedirs(os.path.dirname(os.path.abspath(wav_path)), exist_ok=True)
    sf.write(wav_path, result['audio'], SR, subtype='PCM_24')
    side = os.path.splitext(wav_path)[0]
    with open(side + '.render.json', 'w') as fh:
        json.dump(dict(stats=result['stats'], pedal=result['pedal'], notes=result['notes'], credit=CREDIT), fh, indent=1)
    if mp3_path:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav_path, '-c:a', 'libmp3lame',
                        '-b:a', '320k', '-metadata', f'title={title}', '-metadata', f'artist={artist}',
                        '-metadata', f'comment={CREDIT[:250]}', mp3_path], check=True)
    if stems_dir and 'stems' in result:
        os.makedirs(stems_dir, exist_ok=True)
        for k, v in result['stems'].items():
            sf.write(os.path.join(stems_dir, f'{k}.wav'), v, SR, subtype='FLOAT')


ONSET_PATH = os.path.join(HERE, 'onset_calibration.json')


def calibrate_onsets(cfg: Config | None = None, keys=(36, 60, 84), sweep_vels=(30, 64, 100), out=ONSET_PATH,
                     spacing_s=2.0, log=print):
    """delta_audio(v): MIDI note-on -> audible onset of the rendered note, for every velocity 1..127 on `keys`,
    plus a whole-keyboard sweep at `sweep_vels`. Exact render chain (layer x-fade, pitch shift, master HP/EQ) with
    reverb, resonance, release/pedal noises and normalisation off (gain does not move an onset; reverb arrives
    after its pre-delay). Each note is rendered in its own 2 s slot, so no note overlaps another."""
    base = cfg or Config()
    c = dataclasses.replace(base, reverb='none', resonance_db=None, pedal_noise_gain_db=-200.0,
                            key_noise_gain_db=-200.0, release_gain_db=-200.0, target_lufs=None, tail_s=1.0)
    bank = Bank(c)

    def run(notes):
        r = render(notes, [], c, bank=bank)
        a = np.abs(r['audio'].astype(np.float64)).max(axis=1)
        meas = [onset_measures(a, int(round(n.start * SR))) for n in notes]
        return meas, r['notes']

    res = dict(definition=dict(
        note_on='MIDI note-on / score t_on (s); sample index round(t_on*48000) of the rendered WAV',
        rise_ms='start of the continuous rise into the hammer attack: hammer-string contact as heard at the mics',
        t20_ms='first crossing of -20 dB re the note peak (envelope = 0.25 ms moving average of max|L|,|R|)',
        t10_ms='first crossing of -10 dB re peak', peak_ms='envelope maximum within 250 ms',
        delta_audio_ms='recommended delta_audio(v) for research/performance.md 1/5: t_hs = t_on + delta_audio. '
                       '= rise (physical onset); attack peak follows peak_ms - rise_ms later. With align_onsets '
                       '(default) the sampler places every voice so that this is ~0.'),
        chain=dict(reverb=False, master_hp_hz=c.master_hp_hz, master_eq=c.master_eq, xfade_width=c.xfade_width,
                   tuning=c.tuning, preroll_ms=c.preroll_ms, align_onsets=c.align_onsets,
                   master_filters='zero-phase'), registers={}, sweep={})
    t_all = time.perf_counter()
    for k in keys:
        notes = [Note(0.5 + i * spacing_s, 0.5 + i * spacing_s + 0.3, k, v) for i, v in enumerate(range(1, 128))]
        meas, nlog = run(notes)
        tab = {name: [m[name] for m in meas] for name in ('rise', 't30', 't20', 't10', 'peak')}
        voice = [nl['onset_ms']['rise'] for nl in nlog]
        res['registers'][str(k)] = dict(
            name=f'{"C C# D D# E F F# G G# A A# B".split()[k % 12]}{k // 12 - 1}', velocity=list(range(1, 128)),
            delta_audio_ms=tab['rise'], t30_ms=tab['t30'], t20_ms=tab['t20'], t10_ms=tab['t10'], peak_ms=tab['peak'],
            voice_level_rise_ms_max_abs_diff=round(float(np.max(np.abs(np.array(voice) - np.array(tab['rise'])))), 3),
            summary={name: dict(min=float(np.min(v)), median=float(np.median(v)), max=float(np.max(v)))
                     for name, v in tab.items()})
        log(f'onset calibration key {k}: rise median {np.median(tab["rise"]):.2f} ms, '
            f'range {min(tab["rise"]):.2f}..{max(tab["rise"]):.2f}; t20 median {np.median(tab["t20"]):.2f}')
    for v in sweep_vels:
        notes = [Note(0.5 + i * spacing_s, 0.5 + i * spacing_s + 0.3, k, v) for i, k in enumerate(range(21, 109))]
        meas, _ = run(notes)
        res['sweep'][str(v)] = dict(keys=list(range(21, 109)), delta_audio_ms=[m['rise'] for m in meas],
                                    t20_ms=[m['t20'] for m in meas], peak_ms=[m['peak'] for m in meas])
    allr = np.concatenate([res['registers'][str(k)]['delta_audio_ms'] for k in keys] +
                          [res['sweep'][str(v)]['delta_audio_ms'] for v in sweep_vels])
    res['overall'] = dict(n=int(len(allr)), median_ms=float(np.median(allr)), mean_ms=round(float(np.mean(allr)), 3),
                          p5_ms=round(float(np.percentile(allr, 5)), 3), p95_ms=round(float(np.percentile(allr, 95)), 3),
                          min_ms=float(allr.min()), max_ms=float(allr.max()))
    res['usage'] = ('Per note, use the exact value from the render log (<wav>.render.json notes[i].onset_ms.rise, '
                    'same definition). Without it: interpolate delta_audio_ms over velocity in the nearest register, '
                    'or use overall.median_ms; the spread is far below one 60 fps frame (16.7 ms).')
    res['command'] = 'python music/sampler.py calibrate'
    res['wall_s'] = round(time.perf_counter() - t_all, 1)
    with open(out, 'w') as fh:
        json.dump(res, fh, indent=1)
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('render', help='MIDI (.mid) or score JSON (.json, music/dsl.py to_json) -> 48 kHz stereo WAV')
    r.add_argument('midi', help='input .mid or .json'); r.add_argument('wav')
    r.add_argument('--mp3'); r.add_argument('--stems'); r.add_argument('--config', help='JSON with Config overrides')
    r.add_argument('--set', nargs='*', default=[], help='key=value overrides, e.g. reverb_wet_db=-8')
    sub.add_parser('profile')
    cal = sub.add_parser('calibrate', help='measure delta_audio(v) -> music/onset_calibration.json')
    cal.add_argument('--config'); cal.add_argument('--set', nargs='*', default=[])
    cal.add_argument('--out', default=ONSET_PATH)
    a = ap.parse_args(argv)
    if a.cmd == 'profile':
        build_profile()
        print('wrote', PROFILE_PATH)
        return
    cfg = config_from(a.config, a.set)
    if a.cmd == 'calibrate':
        res = calibrate_onsets(cfg, out=a.out)
        print(json.dumps(res['overall'], indent=1))
        print('wrote', a.out)
        return
    notes, ccs = load_events(a.midi)
    res = render(notes, ccs, cfg, stems=bool(a.stems))
    write_outputs(res, a.wav, a.mp3, a.stems)
    print(json.dumps(res['stats'], indent=1))


def config_from(config_path=None, sets=()):
    """Config() + overrides from a JSON file (e.g. music/presets/*.json) + key=value strings."""
    cfg = Config()
    over = {}
    a = argparse.Namespace(config=config_path, set=list(sets))
    if a.config:
        with open(a.config) as fh:
            over.update(json.load(fh))
    for kv in a.set:
        k, v = kv.split('=', 1)
        over[k] = json.loads(v) if re.match(r'^[-\d.\[\]]', v) or v in ('true', 'false', 'null') else v
    for k, v in over.items():
        if k.startswith('_'):          # "_comment" etc. in preset files
            continue
        if not hasattr(cfg, k):
            raise SystemExit(f'unknown config key {k}')
        setattr(cfg, k, tuple(v) if isinstance(v, list) else v)
    return cfg


if __name__ == '__main__':
    main()
