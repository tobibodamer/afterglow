# Cycle 2: interior / pedal / leg stats on film frames (owner copy of the critic's c2_interior.py, c2_ped_stats.py and
# c2_legs.py, build/qc/piano_r1_extra0). Parts passes (<shot>_parts.png) come from the critic's run (same frames).
#   python tools/piano/misc_stats.py <outDir> [variant suffixes ...]
import sys, os, colorsys
import numpy as np
from PIL import Image

R = r'E:\experimentswithclaude\random\afterglow'
CLS = {'lid': (1, 0, 0), 'side': (0, 1, 0), 'desk': (0, 0, 1), 'legs': (1, 1, 0), 'prop': (1, 0, 1), 'bench': (.5, .5, .5), 'other': (0, 1, 1)}

def luma(a): return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def cls_mask(p, k):
    m = np.array(Image.open(p).convert('RGB')).astype(np.float32) / 255
    lum = m.max(2); n = m / np.maximum(lum[..., None], 1e-3)
    return (lum > 0.25) & (((n - np.array(CLS[k])) ** 2).sum(-1) < 0.15)

def interior(a, sel, name):
    L = luma(a)[sel]; rgb = a[sel]
    if sel.sum() < 50: return name + ' (too few px)'
    top = L >= np.percentile(L, 75); t = rgb[top].mean(0); h, s, v = colorsys.rgb_to_hsv(*(t / 255))
    g = np.hypot(*np.gradient(luma(a)))[sel]
    return '%-26s n %6d mean %5.1f p50 %5.1f p90 %5.1f p99 %5.1f | top25 hue %3.0f sat %.2f | grad mean %.2f p99 %.1f' % (name, sel.sum(), L.mean(), *np.percentile(L, [50, 90, 99]), h * 360, s, g.mean(), np.percentile(g, 99))

def main():
    d = sys.argv[1]; vs = sys.argv[2:] or ['']
    out = []
    for s, box in [('S20z', (950, 280, 1350, 520)), ('S20', (980, 190, 1500, 300))]:
        pp = os.path.join(d, s + '_parts.png')
        if not os.path.exists(pp): continue
        other = cls_mask(pp, 'other'); sel = np.zeros(other.shape, bool); x0, y0, x1, y1 = box; sel[y0:y1, x0:x1] = True
        for v in vs + ['crit']:
            f = os.path.join(d, s + ('_' + v if v else '') + '.png')
            if os.path.exists(f): out.append(interior(np.array(Image.open(f).convert('RGB')).astype(np.float32), sel & other, s + ('_' + v if v else '') + ' interior'))
    for s, box, nm in [('S11', (510, 852, 650, 887), 'pedal slab'), ('S11', (655, 825, 1005, 960), 'pedal box face')]:
        for v in vs:
            f = os.path.join(d, s + ('_' + v if v else '') + '.png')
            if not os.path.exists(f): continue
            a = np.array(Image.open(f).convert('RGB')).astype(np.float32); x0, y0, x1, y1 = box; L = luma(a[y0:y1, x0:x1])
            out.append('%-26s mean %5.1f p50 %5.1f p90 %5.1f p99 %5.1f max %5.0f n>120 %d' % (s + ('_' + v if v else '') + ' ' + nm, L.mean(), *np.percentile(L, [50, 90, 99]), L.max(), (L > 120).sum()))
    for s in ['S09', 'S04', 'S20', 'S20b', 'S17b']:
        pp = os.path.join(d, s + '_parts.png')
        if not os.path.exists(pp): continue
        legs = cls_mask(pp, 'legs')
        for v in vs + ['crit']:
            f = os.path.join(d, s + ('_' + v if v else '') + '.png')
            if not os.path.exists(f) or legs.sum() < 100: continue
            L = luma(np.array(Image.open(f).convert('RGB')).astype(np.float32))[legs]
            out.append('%-26s legs px %6d mean %5.1f p50 %5.1f p90 %5.1f p99 %5.1f >40 %.3f' % (s + ('_' + v if v else ''), legs.sum(), L.mean(), *np.percentile(L, [50, 90, 99]), (L > 40).mean()))
    txt = '\n'.join(out); print(txt)
    open(os.path.join(d, 'misc_stats.txt'), 'w').write(txt + '\n')

main()
