# Where do the piano's pixels come from? Per-part luma statistics of a render using its parts id pass.
#   python tools/piano/parts_stats.py <outDir> [suffix,suffix...]
# Needs <shot>[_<suffix>].png and a <shot>*_parts.png (sandbox/piano2/shots.mjs, shot.parts or job.parts: lid red,
# case side green, desk blue, legs/lyre/pedals yellow, prop magenta, bench grey, other cyan). Prints, per part, its
# share of the piano pixels (bench excluded) and p50 / p90 / p99 / >40 / >80 of the Rec.709 luma (8-bit sRGB values).
import sys, os
import numpy as np
from PIL import Image

CLS = {'lid': (1, 0, 0), 'side': (0, 1, 0), 'desk': (0, 0, 1), 'legs': (1, 1, 0), 'prop': (1, 0, 1), 'bench': (.5, .5, .5), 'other': (0, 1, 1)}

def classify(img):
    a = np.array(img.convert('RGB')).astype(np.float32) / 255.0
    lum = a.max(axis=2)
    on = lum > 0.25
    n = a / np.maximum(lum[..., None], 1e-3)
    names = list(CLS)
    d = np.stack([((n - np.array(CLS[k])) ** 2).sum(axis=2) for k in names], axis=-1)
    idx = d.argmin(axis=-1)
    # grey (bench) has a lower brightness than the saturated colours at the same emissive: use the raw value too
    out = np.full(lum.shape, -1, np.int32); out[on] = idx[on]
    return out, names

def luma(p):
    a = np.array(Image.open(p).convert('RGB')).astype(np.float32)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def main():
    d = sys.argv[1]
    sufs = [''] + (sys.argv[2].split(',') if len(sys.argv) > 2 else [])
    shots = sorted({f[:-len('_parts.png')] for f in os.listdir(d) if f.endswith('_parts.png')})
    for sp in shots:
        base = sp
        for s in sufs:
            if s and base.endswith('_' + s): base = base[:-len(s) - 1]
        ids, names = classify(Image.open(os.path.join(d, sp + '_parts.png')))
        for suf in sufs:
            name = base + ('_' + suf if suf else '')
            p = os.path.join(d, name + '.png')
            if not os.path.exists(p): continue
            L = luma(p)
            piano = (ids >= 0) & (ids != names.index('bench'))
            tot = piano.sum()
            row = [f'{name:26s} n={tot:7d}']
            for k, nm in enumerate(names):
                if nm == 'bench': continue
                m = ids == k
                if m.sum() < 50: continue
                v = L[m]
                row.append(f'{nm}:{m.sum() / tot * 100:4.1f}% p50 {np.percentile(v, 50):5.1f} p90 {np.percentile(v, 90):5.1f} >40 {(v > 40).mean() * 100:4.1f}% >80 {(v > 80).mean() * 100:4.1f}%')
            print('\n   '.join(row))

main()
