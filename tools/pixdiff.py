"""Pixel diff of two directories of rendered stills (same file names): is an optimisation lossless?

usage: python tools/pixdiff.py build/verify/base_N1 build/verify/opt_N1 [--heat out_dir]

Per image: identical pixels (%), max |diff| in 8-bit code values, mean |diff|, PSNR (dB; inf when identical), and the
share of pixels off by more than 2 code values. --heat writes x16 amplified difference images.
"""
import os
import sys

import numpy as np
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.int16)


def main():
    a_dir, b_dir = sys.argv[1], sys.argv[2]
    heat = sys.argv[sys.argv.index('--heat') + 1] if '--heat' in sys.argv else None
    if heat:
        os.makedirs(heat, exist_ok=True)
    names = sorted(f for f in os.listdir(a_dir) if f.endswith('.png') and os.path.exists(os.path.join(b_dir, f)))
    if not names:
        sys.exit(f'no common .png files in {a_dir} and {b_dir}')
    worst = float('inf')
    for n in names:
        a, b = load(os.path.join(a_dir, n)), load(os.path.join(b_dir, n))
        d = np.abs(a - b)
        px = d.max(axis=2)
        mse = float((d.astype(np.float64) ** 2).mean())
        psnr = float('inf') if mse == 0 else 10 * np.log10(255 ** 2 / mse)
        worst = min(worst, psnr)
        print(f'{n}  identical {100 * (px == 0).mean():7.3f} %  max {int(px.max()):3d}  mean {d.mean():.4f}  '
              f'>2: {100 * (px > 2).mean():.4f} %  PSNR {psnr:.2f} dB')
        if heat:
            Image.fromarray(np.clip(d * 16, 0, 255).astype(np.uint8)).save(os.path.join(heat, n))
    print(f'worst PSNR {worst:.2f} dB over {len(names)} images')


if __name__ == '__main__':
    main()
