# Cycle 2: close-up mirror / keytop stats on film frames (sandbox/piano2/qc_film.mjs output), after the critic's
# c2_mirror_stats.py / c2_key_stats.py (build/qc/piano_r1_extra0). Per shot and variant suffix:
#   desk / side part pixels (parts pass <shot>_parts.png): mean p50 p90 p99 >40 share, gradient mean
#   keytops: brightest 30 % of the critic's key box: p50 p99 and hue
#   python tools/piano/close_stats.py <outDir> [variant suffixes ...]   e.g. ... out/c2_a "" C1 C2
import sys, os, colorsys
import numpy as np
from PIL import Image

ROOT = r'E:\experimentswithclaude\random\afterglow'
CLS = {'lid': (1, 0, 0), 'side': (0, 1, 0), 'desk': (0, 0, 1), 'legs': (1, 1, 0), 'prop': (1, 0, 1), 'bench': (.5, .5, .5), 'other': (0, 1, 1)}
KEYBOX = {'S06': (700, 700, 1000, 1080), 'S24': (760, 650, 1150, 1080), 'S24s': (760, 650, 1150, 1080), 'S04': (850, 660, 1450, 820),
          'S13': (900, 850, 1200, 1080), 'S08': (300, 900, 1100, 1080)}
# critic's hand boxes on panels that are partly 'other' in the parts pass (fallboard face, panel above it)
BOXES = {'S06': [((1250, 450, 1900, 700), 'fallboard face'), ((1100, 60, 1920, 400), 'panel above fb')],
         'S24s': [((1250, 0, 1920, 230), 'desk/upper right'), ((1200, 260, 1920, 420), 'fallboard roll+face')]}

def luma(a): return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def parts(p):
    a = np.array(Image.open(p).convert('RGB')).astype(np.float32) / 255.0
    lum = a.max(axis=2); on = lum > 0.25
    n = a / np.maximum(lum[..., None], 1e-3)
    names = list(CLS); dd = np.stack([((n - np.array(CLS[k])) ** 2).sum(axis=2) for k in names], axis=-1); idx = dd.argmin(-1)
    return {k: on & (idx == i) for i, k in enumerate(names)}

def row(name, L, G, sel):
    if sel.sum() < 200: return None
    l = L[sel]
    return '%-24s n %7d mean %5.1f p50 %5.1f p90 %5.1f p99 %5.1f >40 %5.3f | grad %5.2f' % (name, sel.sum(), l.mean(), *np.percentile(l, [50, 90, 99]), (l > 40).mean(), G[sel].mean())

def keys(a, box, name):
    x0, y0, x1, y1 = box; r = a[y0:y1, x0:x1]; l = luma(r)
    t = np.percentile(l, 70); sel = l >= t; rgb = r[sel].mean(0); h, s, v = colorsys.rgb_to_hsv(*(rgb / 255)); lt = l[sel]
    return '%-24s top30%% p50 %6.1f p99 %6.1f hue %5.1f sat %.2f' % (name, np.percentile(lt, 50), np.percentile(lt, 99), h * 360, s)

def main():
    d = sys.argv[1]; vs = sys.argv[2:] or ['']
    out = []
    for s in ['S04', 'S06', 'S09', 'S13', 'S20b', 'S24s', 'S24']:
        pp = os.path.join(d, s + '_parts.png')
        P = parts(pp) if os.path.exists(pp) else None
        for v in vs + ['crit']:
            nm = s + ('_' + v if v else '')
            f = os.path.join(d, nm + '.png')
            if not os.path.exists(f): continue
            a = np.array(Image.open(f).convert('RGB')).astype(np.float32); L = luma(a); G = np.hypot(*np.gradient(L))
            if P is not None:
                for k in ['desk', 'side']:
                    r = row(nm + ' ' + k, L, G, P[k])
                    if r: out.append(r)
            for box, bn in BOXES.get(s, []):
                sel = np.zeros(L.shape, bool); x0, y0, x1, y1 = box; sel[y0:y1, x0:x1] = True
                r = row(nm + ' ' + bn, L, G, sel)
                if r: out.append(r)
            if s in KEYBOX: out.append(keys(a, KEYBOX[s], nm + ' keys'))
        out.append('')
    txt = '\n'.join(out); print(txt)
    open(os.path.join(d, 'close_stats.txt'), 'w').write(txt + '\n')

main()
