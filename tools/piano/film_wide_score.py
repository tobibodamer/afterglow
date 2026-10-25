# Fix round 2: score wide-look variants on FILM frames (sandbox/piano2/qc_film.mjs output: pianist real, piano mask with
# the pianist as a black occluder, parts id pass) against the reference masks, BODY ONLY (white mask pixels: no legs,
# lyre, pedals, bench), r4 against the critic's cleaned mask (sky triangle removed), r5 against the critic's mask.
#   python tools/piano/film_wide_score.py <outDir> [variant suffixes ...]     e.g.  ... out/s11_a "" A1 A2
# Prints per shot and variant: p50 p75 p90 p95 gt40 deep(L<4) as ours/ref ratios, the mid-band RGB (p25..p75) and the
# per-part lid / desk deep share and lid p50 (parts pass of the base shot). Writes <outDir>/film_wide_score.txt.
import sys, os
import numpy as np
from PIL import Image

ROOT = r'E:\experimentswithclaude\random\afterglow'
SHOTS = {'S01a': 'r10', 'S03b': 'r2', 'S05b': 'r11', 'S10b': 'r9', 'S17b': 'r4', 'S23b': 'r5', 'S05c': 'r11'}   # cycle 2 round 2: + S05b (critic c2r2)
REFIMG = {'r2': 'refs/2.webp', 'r4': 'refs/4.webp', 'r9': 'refs/9.webp', 'r10': 'refs/10.webp', 'r11': 'refs/11.webp', 'r5': 'refs/5.webp'}
REFMASK = {'r4': os.path.join(ROOT, 'build', 'qc', 'piano_r2_c0', 'r4_clean_mask.png'), 'r5': os.path.join(ROOT, 'build', 'qc', 'piano_r2_c0', 'r5_mask.png')}
CLS = {'lid': (1, 0, 0), 'side': (0, 1, 0), 'desk': (0, 0, 1), 'legs': (1, 1, 0), 'prop': (1, 0, 1), 'bench': (.5, .5, .5), 'other': (0, 1, 1)}

def luma(a):
    a = a.astype(np.float32)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def ref_mask(k):
    p = REFMASK.get(k) or os.path.join(ROOT, 'sandbox', 'piano2', 'masks', k + '_mask.png')
    return np.array(Image.open(p).convert('L')) > 127

def body_mask(p):
    m = np.array(Image.open(p).convert('RGB')).astype(np.int32)
    bench = (m[..., 2] > m[..., 0] + 60) & (m[..., 2] > 120)
    return (m.min(axis=2) > 170) & ~bench

def parts(p):
    a = np.array(Image.open(p).convert('RGB')).astype(np.float32) / 255.0
    lum = a.max(axis=2); on = lum > 0.25
    n = a / np.maximum(lum[..., None], 1e-3)
    names = list(CLS)
    d = np.stack([((n - np.array(CLS[k])) ** 2).sum(axis=2) for k in names], axis=-1)
    idx = d.argmin(axis=-1)
    return {k: on & (idx == i) for i, k in enumerate(names)}

def st(img, m):
    L = luma(img)[m]; rgb = img[m].astype(np.float32)
    o = {'p%d' % q: float(np.percentile(L, q)) for q in (25, 50, 75, 90, 95)}
    o['gt40'] = float((L > 40).mean()); o['deep'] = float((L < 4).mean())
    mid = (L >= o['p25']) & (L <= o['p75'])
    o['mid'] = [round(float(x), 1) for x in rgb[mid].mean(0)]
    # cycle 2 round 2 (critic c2r2 qc2_hue.py): highlight colour families of pixels above luma 25 (gold B/R < .45, salmon
    # .45-.85), their mean B/R, and the share above luma 200 (hot)
    hi = L > 25; br = rgb[:, 2] / np.maximum(rgb[:, 0], 1)
    o['gold'] = float(((br < 0.45) & hi).sum() / max(1, hi.sum())); o['salm'] = float(((br >= 0.45) & (br < 0.85) & hi).sum() / max(1, hi.sum()))
    o['hbr'] = float(br[hi].mean()) if hi.sum() else float('nan'); o['hot'] = float((L > 200).mean())
    return o

def main():
    d = sys.argv[1]; vs = sys.argv[2:] or ['']
    refs = {}
    lines = ['%-10s %-4s | %5s %5s %5s %5s %5s %5s | %-18s | %s' % ('shot', 'ref', 'p50', 'p75', 'p90', 'p95', 'gt40', 'deep', 'mid RGB (ref)', 'lid p50 / lid deep / desk deep')]
    for s, rk in SHOTS.items():
        if not os.path.exists(os.path.join(d, s + '_mask.png')): continue
        if rk not in refs: refs[rk] = st(np.array(Image.open(os.path.join(ROOT, REFIMG[rk])).convert('RGB')), ref_mask(rk))
        R = refs[rk]
        bm = body_mask(os.path.join(d, s + '_mask.png'))
        pp = os.path.join(d, s + '_parts.png'); P = parts(pp) if os.path.exists(pp) else None
        for v in vs:
            nm = s + ('_' + v if v else '')
            f = os.path.join(d, nm + '.png')
            if not os.path.exists(f): continue
            img = np.array(Image.open(f).convert('RGB'))
            o = st(img, bm)
            r = lambda k: o[k] / R[k] if R[k] > 1e-6 else float('nan')
            extra = ''
            if P is not None:
                L = luma(img)
                lid = P['lid'] & ~(L < -1); desk = P['desk']
                if lid.sum() > 50: extra += '%5.1f / %.2f' % (np.percentile(L[lid], 50), (L[lid] < 4).mean())
                if desk.sum() > 50: extra += ' / %.2f' % (L[desk] < 4).mean()
            lines.append('%-10s %-4s | %5.2f %5.2f %5.2f %5.2f %5.2f %5.2f | gold %.2f (%.2f) salm %.2f (%.2f) hB/R %.2f (%.2f) hot %.4f (%.4f) | %-18s | %s' % (nm, rk, r('p50'), r('p75'), r('p90'), r('p95'), r('gt40'), r('deep'), o['gold'], R['gold'], o['salm'], R['salm'], o['hbr'], R['hbr'], o['hot'], R['hot'], '%s (%s)' % (o['mid'], R['mid']), extra))
    txt = '\n'.join(lines); print(txt)
    open(os.path.join(d, 'film_wide_score.txt'), 'w').write(txt + '\n')

main()
