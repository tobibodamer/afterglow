# Piano-pixel statistics of wide shots against the reference masks (docs/USER_FEEDBACK.md item 1).
#   python tools/piano/wide_stats.py <outDir> [suffix,suffix...] [--json out.json]
# For every <shot>[_<suffix>].png with a <shot>[_<suffix>]_mask.png (sandbox/piano2/shots.mjs --mask) it measures the
# piano = body (white) + legs/lyre/pedals (red) of the mask render (the bench, blue, is excluded; the reference masks in
# sandbox/piano2/masks/ also contain the legs and not the bench) and prints mean / p50 / p75 / p90 / p95 / p99 and the
# highlight fractions (> 40, > 80, > 120 of 255, Rec.709 luma of the sRGB values), plus ours / ref ratios.
# Shot -> reference: r02_hero r2, r04_bass r4, r09_water r9, r10_establish r10, r11m_rear r11 (mirrored ref 11).
import sys, os, json
import numpy as np
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, '..', '..'))
REF = {'r02_hero': 'r2', 'r04_bass': 'r4', 'r09_water': 'r9', 'r10_establish': 'r10', 'r11m_rear': 'r11'}
KEYS = ['mean', 'p50', 'p75', 'p90', 'p95', 'p99', 'gt40', 'gt80', 'gt120']

def luma(a):
    a = a.astype(np.float32)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def piano_mask(path):
    m = np.array(Image.open(path).convert('RGB')).astype(np.int32)
    bench = (m[..., 2] > m[..., 0] + 60) & (m[..., 2] > 120)
    return (m.max(axis=2) > 170) & ~bench

def stats(v):
    return dict(n=int(v.size), mean=float(v.mean()), p50=float(np.percentile(v, 50)), p75=float(np.percentile(v, 75)),
                p90=float(np.percentile(v, 90)), p95=float(np.percentile(v, 95)), p99=float(np.percentile(v, 99)),
                gt40=float((v > 40).mean()), gt80=float((v > 80).mean()), gt120=float((v > 120).mean()))

def ref_stats(key):
    s = json.load(open(os.path.join(root, 'sandbox', 'piano2', 'masks', key + '_stats.json')))
    return {k: s.get(k, s.get('frac_' + k, 0.0)) for k in ['n'] + KEYS}

def fmt(name, s):
    return '%-24s %7d ' % (name, s['n']) + ' '.join(('%6.3f' if k.startswith('gt') else '%6.1f') % s[k] for k in KEYS)

def main():
    d = sys.argv[1]
    sufs = [''] + ([x for x in sys.argv[2].split(',')] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else [])
    out = {}
    lines = ['%-24s %7s ' % ('shot', 'n') + ' '.join('%6s' % k for k in KEYS)]
    for shot, rk in REF.items():
        rs = ref_stats(rk)
        rows = []
        for suf in sufs:
            name = shot + ('_' + suf if suf else '')
            img, mk = os.path.join(d, name + '.png'), os.path.join(d, name + '_mask.png')
            if not os.path.exists(mk):   # variant runs render the mask once per shot (tools/piano/make_variants.py)
                cands = sorted(f for f in os.listdir(d) if f.startswith(shot + '_') and f.endswith('_mask.png'))
                if cands: mk = os.path.join(d, cands[0])
            if not (os.path.exists(img) and os.path.exists(mk)):
                continue
            L = luma(np.array(Image.open(img).convert('RGB')))
            s = stats(L[piano_mask(mk)])
            out[name] = {'ours': s, 'ref': rs, 'ratio': {k: (s[k] / rs[k] if rs[k] else None) for k in KEYS}}
            rows.append(fmt(name, s))
            rows.append('%-24s %7s ' % ('  ours/ref', '') + ' '.join('%6.2f' % (s[k] / rs[k]) if rs[k] else '     -' for k in KEYS))
        if rows:
            lines.append(fmt('REF ' + rk, rs))
            lines += rows
    txt = '\n'.join(lines)
    print(txt)
    open(os.path.join(d, 'wide_stats.txt'), 'w').write(txt + '\n')
    json.dump(out, open(os.path.join(d, 'wide_stats.json'), 'w'), indent=1)

main()
