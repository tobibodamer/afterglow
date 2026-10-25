# Where do the bright piano pixels live? Side-by-side of a reference and our render, piano pixels > T (sRGB luma of
# 255) painted cyan, the rest of the piano dimmed grey-blue, outside the mask darkened. For USER_FEEDBACK item 1.
#   python tools/piano/hi_map.py <outDir> <suffix|-> <out.jpg> [T=40]
import sys, os
import numpy as np
from PIL import Image

root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REF = {'r02_hero': '2', 'r04_bass': '4', 'r09_water': '9', 'r10_establish': '10', 'r11m_rear': '11'}

def luma(a):
    a = a.astype(np.float32); return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def paint(img, m, T):
    a = np.array(img.convert('RGB')).astype(np.float32); L = luma(a)
    out = a * 0.35
    hi = m & (L > T)
    out[m & ~hi] = a[m & ~hi] * 0.5 + np.array([20, 30, 60]) * 0.5
    out[hi] = np.array([0, 255, 255]) * 0.6 + a[hi] * 0.4
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

def main():
    d, suf, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    T = float(sys.argv[4]) if len(sys.argv) > 4 else 40
    rows = []
    for shot, rk in REF.items():
        name = shot + ('' if suf == '-' else '_' + suf)
        ip = os.path.join(d, name + '.png')
        mk = [f for f in sorted(os.listdir(d)) if f.startswith(shot + '_') and f.endswith('_mask.png')]
        if not os.path.exists(ip) or not mk: continue
        m = np.array(Image.open(os.path.join(d, mk[0])).convert('RGB')).astype(np.int32)
        bench = (m[..., 2] > m[..., 0] + 60) & (m[..., 2] > 120)
        ours = paint(Image.open(ip), (m.max(axis=2) > 170) & ~bench, T)
        refp = [os.path.join(root, 'refs', rk + e) for e in ('.webp', '.png')]
        refp = [p for p in refp if os.path.exists(p)][0]
        rimg = Image.open(refp).convert('RGB')
        rm = np.array(Image.open(os.path.join(root, 'sandbox', 'piano2', 'masks', 'r' + rk + '_mask.png')).convert('L').resize(rimg.size)) > 127
        refi = paint(rimg, rm, T)
        h = 400
        a = refi.resize((int(refi.width * h / refi.height), h)); b = ours.resize((int(ours.width * h / ours.height), h))
        row = Image.new('RGB', (a.width + b.width, h)); row.paste(a, (0, 0)); row.paste(b, (a.width, 0)); rows.append(row)
    W = max(r.width for r in rows)
    sheet = Image.new('RGB', (W, sum(r.height for r in rows)))
    y = 0
    for r in rows: sheet.paste(r, (0, y)); y += r.height
    sheet.save(outp, quality=88)

main()
