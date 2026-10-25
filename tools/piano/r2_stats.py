# Cycle 2 fix round 2: the critic c2r2 measurements in one place (per image variant):
#   python tools/piano/r2_stats.py <outDir> [variant suffixes ...]      e.g.  ... out/c3_a "" WA WB
# Per shot (base masks <shot>_mask.png / <shot>_parts.png in <outDir>, copied from the critic's out1 / r1080):
#   all shots   : piano hot share (> 200) and p99 of the piano pixels
#   side / lid  : per-part p50 p75, deep share (< 4), mean RGB and B/R
#   S05c        : interior box x 940-1320 y 600-780 (p50 p99 n>200)
#   S14*        : hotspot box x 274-550 y 60-330 (n>200 n>120 max)
#   S20z        : lid part hue / sat / p50 / p90; interior box x 950-1350 y 280-520 (mean p50 <8 n>200 hue)
#   S02         : near keys box x 250-700 y 820-1000, brightest 10 %: RGB luma B/R
# Writes <outDir>/r2_stats.txt.
import sys, os, colorsys
import numpy as np
from PIL import Image

CLS = {'lid': (1, 0, 0), 'side': (0, 1, 0), 'desk': (0, 0, 1), 'legs': (1, 1, 0), 'prop': (1, 0, 1), 'bench': (.5, .5, .5), 'other': (0, 1, 1)}

def luma(a): return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def parts(p):
    a = np.array(Image.open(p).convert('RGB')).astype(np.float32) / 255.0
    lum = a.max(axis=2); on = lum > 0.25
    n = a / np.maximum(lum[..., None], 1e-3)
    names = list(CLS); d = np.stack([((n - np.array(CLS[k])) ** 2).sum(axis=2) for k in names], axis=-1); idx = d.argmin(-1)
    return {k: on & (idx == i) for i, k in enumerate(names)}

def hsv(rgb):
    h, s, v = colorsys.rgb_to_hsv(*(np.clip(rgb, 0, 255) / 255.0)); return h * 360, s

def main():
    d = sys.argv[1]; vs = sys.argv[2:] or ['']
    out = []
    bases = sorted({f[:-9] for f in os.listdir(d) if f.endswith('_mask.png')})
    for b in bases:
        m = np.array(Image.open(os.path.join(d, b + '_mask.png')).convert('RGB')).astype(np.int32)
        pm = m.min(axis=2) > 170
        pp = os.path.join(d, b + '_parts.png'); P = parts(pp) if os.path.exists(pp) else None
        names = [b + ('_' + v if v else '') for v in vs]
        for nm in names:
            f = os.path.join(d, nm + '.png')
            if not os.path.exists(f): continue
            a = np.array(Image.open(f).convert('RGB')).astype(np.float32); L = luma(a)
            s = '%-10s piano hot %.4f p99 %5.1f' % (nm, (L[pm] > 200).mean() if pm.any() else float('nan'), np.percentile(L[pm], 99) if pm.any() else float('nan'))
            if P is not None:
                for k in ('lid', 'side', 'desk'):
                    sel = P[k]
                    if sel.sum() < 50: continue
                    v = L[sel]; c = a[sel].mean(0)
                    s += ' | %s p50 %5.1f p75 %5.1f deep %.2f rgb %s B/R %.2f' % (k, np.percentile(v, 50), np.percentile(v, 75), (v < 4).mean(), [int(x) for x in c], c[2] / max(c[0], 1e-3))
            if b.startswith('S05c'):
                r = L[600:780, 940:1320]; s += ' | int p50 %.1f p99 %.1f n>200 %d' % (np.percentile(r, 50), np.percentile(r, 99), (r > 200).sum())
            if b.startswith('S14'):
                r = L[60:330, 274:550]; s += ' | hot box n>200 %d n>120 %d max %.0f' % ((r > 200).sum(), (r > 120).sum(), r.max())
            if b.startswith('S20z'):
                if P is not None and P['lid'].sum() > 50:
                    v = L[P['lid']]; h, sa = hsv(a[P['lid']].mean(0)); s += ' | lid hue %.0f sat %.2f p50 %.1f p90 %.1f' % (h, sa, np.percentile(v, 50), np.percentile(v, 90))
                r = L[280:520, 950:1350]; rr = a[280:520, 950:1350].reshape(-1, 3); h, sa = hsv(rr.mean(0))
                s += ' | int mean %.1f p50 %.1f <8 %.2f n>200 %d p99 %.0f hue %.0f sat %.2f' % (r.mean(), np.percentile(r, 50), (r < 8).mean(), (r > 200).sum(), np.percentile(r, 99), h, sa)
            if b.startswith('S02'):
                r = L[820:1000, 250:700]; t = np.percentile(r, 90); sel = r >= t; c = a[820:1000, 250:700][sel].mean(0)
                s += ' | keys top10 rgb %s luma %.1f B/R %.2f' % ([round(float(x), 1) for x in c], r[sel].mean(), c[2] / max(c[0], 1e-3))
            out.append(s)
    txt = '\n'.join(out); print(txt)
    open(os.path.join(d, 'r2_stats.txt'), 'w').write(txt + '\n')

main()
