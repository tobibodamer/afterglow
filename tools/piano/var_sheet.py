# Variant sheet: one row per shot, the base render and its variants side by side, cropped around the piano mask.
#   python tools/piano/var_sheet.py <outDir> <sheet.jpg> <shots,comma> <variant suffixes...>   ("" = base)
#   optional --ref r2,r4,...  (one ref image per shot, appended at the row end, full frame scaled to the row height)
import sys, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = r'E:\experimentswithclaude\random\afterglow'
REFIMG = {'r2': 'refs/2.webp', 'r4': 'refs/4.webp', 'r9': 'refs/9.webp', 'r10': 'refs/10.webp', 'r11': 'refs/11.webp', 'r5': 'refs/5.webp'}
a = sys.argv[1:]
refs = None
if '--ref' in a: i = a.index('--ref'); refs = a[i + 1].split(','); del a[i:i + 2]
d, out, shots, vs = a[0], a[1], a[2].split(','), a[3:]
H = 420
rows = []
for si, s in enumerate(shots):
    m = np.array(Image.open(os.path.join(d, s + '_mask.png')).convert('L')) > 100
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = int(max(x1 - x0, y1 - y0) * 0.08)
    box = (max(0, x0 - pad), max(0, y0 - pad), min(m.shape[1], x1 + pad), min(m.shape[0], y1 + pad))
    ims = []
    for v in vs:
        p = os.path.join(d, s + ('_' + v if v else '') + '.png')
        if not os.path.exists(p): continue
        im = Image.open(p).convert('RGB').crop(box); sc = H / im.height
        im = im.resize((max(1, int(im.width * sc)), H), Image.LANCZOS)
        ImageDraw.Draw(im).text((6, 6), (s + ' ' + (v or 'base')), fill=(255, 255, 0))
        ims.append(im)
    if refs and si < len(refs):
        im = Image.open(os.path.join(ROOT, REFIMG[refs[si]])).convert('RGB'); sc = H / im.height
        ims.append(im.resize((int(im.width * sc), H), Image.LANCZOS))
    W = sum(i.width for i in ims) + 8 * (len(ims) - 1)
    row = Image.new('RGB', (W, H), (40, 40, 40)); x = 0
    for i in ims: row.paste(i, (x, 0)); x += i.width + 8
    rows.append(row)
W = max(r.width for r in rows); Ht = sum(r.height + 8 for r in rows)
sheet = Image.new('RGB', (W, Ht), (40, 40, 40)); y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.height + 8
if sheet.width > 3000: sheet = sheet.resize((3000, int(sheet.height * 3000 / sheet.width)), Image.LANCZOS)
sheet.save(out, quality=88); print(out, sheet.size)
