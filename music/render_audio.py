#!/usr/bin/env python3
"""Final soundtrack render: score JSON (or MIDI) -> build/audio/ WAV + MP3 + render log (+ film-aligned WAV).

  python music/render_audio.py                                   # music/final/score.json, preset 'final' (the soundtrack mix)
  python music/render_audio.py --score sandbox/music-research/sketch.json --out build/audio/sketch
  python music/render_audio.py --preset music/presets/cinematic_hall.json --set reverb_wet_db=-8

Writes <out>.wav (48 kHz, 24-bit PCM, sample 0 = music time 0), <out>.mp3 (LAME 320 kb/s), <out>.render.json
(stats + per-note log incl. onset_ms), and <out>_film.wav = the same audio delayed by MUSIC_OFFSET (DESIGN.md 3),
which is what render/encode.mjs muxes under the picture (film t = 0 at its first sample).
The whole signal chain lives in music/sampler.py; this file only picks inputs, the preset and output names.
"""
import argparse
import dataclasses
import json
import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import sampler as S  # noqa: E402

MUSIC_OFFSET = 4.0   # s, DESIGN.md section 3


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--score', default=os.path.join(HERE, 'final', 'score.json'))
    ap.add_argument('--preset', default=os.path.join(HERE, 'presets', 'final.json'),
                    help='Config overrides JSON (music/presets/*.json); "none" = sampler defaults')
    ap.add_argument('--set', nargs='*', default=[], help='extra key=value overrides')
    ap.add_argument('--out', default=os.path.join(ROOT, 'build', 'audio', 'afterglow'), help='output path stem')
    ap.add_argument('--stems', action='store_true')
    ap.add_argument('--film-offset', type=float, default=MUSIC_OFFSET)
    ap.add_argument('--title', default='Afterglow')
    a = ap.parse_args(argv)
    cfg = S.config_from(None if a.preset == 'none' else a.preset, a.set)
    notes, ccs = S.load_events(a.score)
    res = S.render(notes, ccs, cfg, stems=a.stems)
    res['stats']['score'] = os.path.relpath(a.score, ROOT) if os.path.splitdrive(a.score)[0] == os.path.splitdrive(ROOT)[0] else a.score
    res['stats']['preset'] = os.path.basename(a.preset) if a.preset != 'none' else None
    res['stats']['set'] = list(a.set)
    res['stats']['config'] = {k: v for k, v in dataclasses.asdict(cfg).items() if k != 'sample_root'}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    S.write_outputs(res, a.out + '.wav', a.out + '.mp3', (a.out + '_stems') if a.stems else None, title=a.title)
    if a.film_offset:
        pad = np.zeros((int(round(a.film_offset * S.SR)), 2), np.float32)
        sf.write(a.out + '_film.wav', np.concatenate([pad, res['audio']]), S.SR, subtype='PCM_24')
    st = res['stats']
    print(json.dumps({k: st[k] for k in ('duration_s', 'notes', 'lufs_integrated', 'true_peak_dbtp',
                                         'loudness_range_lu', 'x_realtime')}, indent=1))
    print('wrote', a.out + '.wav', a.out + '.mp3', a.out + '.render.json', (a.out + '_film.wav') if a.film_offset else '')


if __name__ == '__main__':
    main()
