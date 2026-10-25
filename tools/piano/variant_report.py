# Piano-mask stats + crop sheet for a variant render set.
#   python tools/piano/variant_report.py <outDir> <variants comma> [shots comma]
# writes <outDir>/report.txt and <outDir>/sheet_<variant...>.png; refs from sandbox/piano2/masks/*_stats.json
import sys, os, json, subprocess
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, '..', '..'))
d = sys.argv[1]; vs = sys.argv[2].split(',')
shots = (sys.argv[3].split(',') if len(sys.argv) > 3 else ['r02_hero', 'r09_water', 'r11m_rear', 'r04_bass'])
refmap = {'r02_hero': 'r2', 'r09_water': 'r9', 'r11m_rear': 'r11', 'r04_bass': 'r4'}
crops = {'r02_hero': (330, 130, 630, 380), 'r09_water': (420, 40, 800, 330), 'r11m_rear': (280, 180, 680, 420), 'r04_bass': (180, 100, 560, 400),
         'r07_desk': (0, 0, 960, 540), 'r06_drone': (150, 40, 700, 500)}
sys.path.insert(0, here)
import importlib.util
spec = importlib.util.spec_from_file_location('pl', os.path.join(here, 'piano_lum.py'))
import numpy as np
def luma(a):
    a = a.astype(np.float32); return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
def stats(img, mask):
    L = luma(np.array(Image.open(img).convert('RGB'))); mm = np.array(Image.open(mask).convert('RGB')).astype(np.int32).min(axis=2) > 170
    v = L[mm]
    return dict(n=int(v.size), mean=float(v.mean()), p50=float(np.percentile(v, 50)), p75=float(np.percentile(v, 75)), p90=float(np.percentile(v, 90)),
                p95=float(np.percentile(v, 95)), p99=float(np.percentile(v, 99)), gt40=float((v > 40).mean()), gt80=float((v > 80).mean()))
lines = ['%-22s %8s %6s %6s %6s %6s %6s %6s %6s' % ('shot/variant', 'n', 'mean', 'p50', 'p75', 'p90', 'p95', 'p99', '>40')]
for s in shots:
    if s in refmap:
        r = json.load(open(os.path.join(root, 'sandbox', 'piano2', 'masks', refmap[s] + '_stats.json')))
        lines.append('%-22s %8d %6.1f %6.1f %6.1f %6.1f %6.1f %6.1f %6.3f' % ('REF ' + refmap[s], r['n'], r['mean'], r['p50'], r['p75'], r['p90'], r['p95'], r['p99'], r['frac_gt40']))
    for v in vs:
        img = os.path.join(d, f'{s}_{v}.png'); mk = os.path.join(d, f'{s}_{v}_mask.png')
        if not os.path.exists(mk):
            continue
        q = stats(img, mk)
        lines.append('%-22s %8d %6.1f %6.1f %6.1f %6.1f %6.1f %6.1f %6.3f' % (f'{s}_{v}', q['n'], q['mean'], q['p50'], q['p75'], q['p90'], q['p95'], q['p99'], q['gt40']))
open(os.path.join(d, 'report.txt'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
rows = []
for s in shots:
    b = crops.get(s, (0, 0, 960, 540))
    rows.append([Image.open(os.path.join(d, f'{s}_{v}.png')).crop(b) for v in vs if os.path.exists(os.path.join(d, f'{s}_{v}.png'))])
rows = [r for r in rows if r]
if not rows: sys.exit(0)
H = sum(r[0].size[1] for r in rows if r); W = max(sum(t.size[0] for t in r) for r in rows if r)
out = Image.new('RGB', (W, H)); y = 0
for r in rows:
    x = 0
    for t in r:
        out.paste(t, (x, y)); x += t.size[0]
    y += r[0].size[1]
out.save(os.path.join(d, 'sheet_' + '_'.join(vs) + '.png'))
