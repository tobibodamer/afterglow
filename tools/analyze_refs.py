"""Measure the reference images: size, luminance stats, palette by vertical band."""
import sys, json, glob, os
import numpy as np
from PIL import Image

def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

out = {}
for p in sorted(glob.glob('refs/*'), key=lambda s: int(os.path.basename(s).split('.')[0])):
    im = np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
    h, w, _ = im.shape
    lum = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    bands = []
    for i in range(10):
        sl = im[int(h * i / 10):int(h * (i + 1) / 10)]
        m = sl.reshape(-1, 3).mean(0)
        bands.append('#%02x%02x%02x' % tuple(int(x) for x in m))
    pct = np.percentile(lum, [1, 5, 25, 50, 75, 95, 99]).round(1).tolist()
    # brightest 0.5% colour (highlight hue)
    flat = im.reshape(-1, 3); fl = lum.reshape(-1)
    hi = flat[fl >= np.percentile(fl, 99.5)].mean(0)
    lo = flat[fl <= np.percentile(fl, 10)].mean(0)
    out[os.path.basename(p)] = dict(size=[w, h], lum_pct=pct, bands_top_to_bottom=bands,
        highlight='#%02x%02x%02x' % tuple(int(x) for x in hi),
        shadow='#%02x%02x%02x' % tuple(int(x) for x in lo),
        mean='#%02x%02x%02x' % tuple(int(x) for x in flat.mean(0)))
json.dump(out, open('analysis/ref_stats.json', 'w'), indent=1)
for k, v in out.items():
    print(k, v['size'], 'lum', v['lum_pct'], 'hi', v['highlight'], 'sh', v['shadow'])
    print('   bands', ' '.join(v['bands_top_to_bottom']))
