# Piano-pixel luminance statistics (docs/USER_FEEDBACK.md item 1: "measure the piano's own pixels").
#
#   python tools/piano/piano_lum.py refmask <ref.png> <out_prefix> <polys.json> <key>
#       reference: mask = dark pixels (L < thr) inside the include polygon, closed + hole-filled (so bright reflections
#       enclosed by the dark case count as piano), minus the exclude polygons (pianist, bench). Writes <out>_mask.png,
#       <out>_overlay.png and prints JSON stats.
#   python tools/piano/piano_lum.py render <beauty.png> <mask.png> [out_prefix]
#       our render: mask = the piano-only white render (> 50 %).
#   python tools/piano/piano_lum.py table <stats.json...>
# L = Rec.709 luma of the 8-bit sRGB values (0..255), as tools/compare.py.
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

def luma(a):
    a = a.astype(np.float32)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def poly_mask(shape, polys):
    from PIL import ImageDraw
    H, W = shape
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for p in polys:
        d.polygon([(x * W, y * H) for x, y in p], fill=255)
    return np.array(im) > 127

def stats(L, m, rgb=None):
    v = L[m]
    if v.size == 0:
        return {'n': 0}
    s = {
        'n': int(v.size),
        'mean': float(v.mean()),
        'p50': float(np.percentile(v, 50)), 'p75': float(np.percentile(v, 75)),
        'p90': float(np.percentile(v, 90)), 'p95': float(np.percentile(v, 95)), 'p99': float(np.percentile(v, 99)),
        'frac_gt40': float((v > 40).mean()), 'frac_gt80': float((v > 80).mean()), 'frac_gt120': float((v > 120).mean()),
    }
    if rgb is not None:
        c = rgb[m].astype(np.float32)
        s['meanRGB'] = [float(x) for x in c.mean(0)]
        hi = v >= np.percentile(v, 95)
        s['p95RGB'] = [float(x) for x in c[hi].mean(0)]
    return s

def overlay(rgb, m, out):
    o = rgb.astype(np.float32).copy()
    edge = m ^ ndimage.binary_erosion(m, iterations=2)
    o[~m] *= 0.35
    o[edge] = [0, 255, 0]
    Image.fromarray(o.clip(0, 255).astype(np.uint8)).save(out)

cmd = sys.argv[1]
if cmd == 'refmask':
    img = np.array(Image.open(sys.argv[2]).convert('RGB'))
    out = sys.argv[3]
    cfg = json.load(open(sys.argv[4]))[sys.argv[5]]
    L = luma(img)
    inc = poly_mask(L.shape, cfg['include'])
    exc = poly_mask(L.shape, cfg.get('exclude', [])) if cfg.get('exclude') else np.zeros_like(inc)
    dark = (L < cfg.get('thr', 40)) & inc
    k = cfg.get('close', 5)
    m = ndimage.binary_closing(dark, structure=np.ones((k, k)), iterations=1)
    m = ndimage.binary_fill_holes(m)
    for p in cfg.get('force', []):            # regions known to be piano (e.g. the lit interior)
        m |= poly_mask(L.shape, [p])
    m &= inc
    m &= ~exc
    lab, n = ndimage.label(m)
    if n > 1:                                  # drop specks
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        keep = np.isin(lab, 1 + np.where(sizes >= cfg.get('minArea', 200))[0])
        m = keep
    Image.fromarray((m * 255).astype(np.uint8)).save(out + '_mask.png')
    overlay(img, m, out + '_overlay.png')
    s = stats(L, m, img); s['image'] = sys.argv[2]
    json.dump(s, open(out + '_stats.json', 'w'), indent=1)
    print(json.dumps(s))
elif cmd == 'render':
    img = np.array(Image.open(sys.argv[2]).convert('RGB'))
    mm = np.array(Image.open(sys.argv[3]).convert('RGB')).astype(np.int32)
    mk = mm.min(axis=2) > 170                  # body = white (legs/lyre/pedals are red-pink, the bench blue)
    L = luma(img)
    s = stats(L, mk, img); s['image'] = sys.argv[2]
    if len(sys.argv) > 4:
        overlay(img, mk, sys.argv[4] + '_overlay.png')
        json.dump(s, open(sys.argv[4] + '_stats.json', 'w'), indent=1)
    print(json.dumps(s))
elif cmd == 'table':
    keys = ['n', 'mean', 'p50', 'p75', 'p90', 'p95', 'p99', 'frac_gt40', 'frac_gt80', 'frac_gt120']
    print('file'.ljust(40) + ''.join(k.rjust(10) for k in keys))
    for f in sys.argv[2:]:
        s = json.load(open(f))
        print(f[-40:].ljust(40) + ''.join((f'{s.get(k, 0):10.3f}' if isinstance(s.get(k), float) and s.get(k) < 1.5 else f'{s.get(k, 0):10.1f}') for k in keys))
