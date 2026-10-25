import sys, os, numpy as np
from PIL import Image
d = sys.argv[1]; old = sys.argv[2]; out = sys.argv[3]; names = sys.argv[4:]
rows = []
for nm in names:
    base = nm.split('_')[0]
    m = np.array(Image.open(os.path.join(d, base + '_mask.png')).convert('L')) > 100
    ys, xs = np.where(m)
    if len(xs) == 0: continue
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = x1 - x0, y1 - y0; pad = int(max(w, h) * 0.12)
    box = (max(0, x0 - pad), max(0, y0 - pad), min(1920, x1 + pad), min(1080, y1 + pad))
    ims = []
    for p in ([os.path.join(old, base + '.png')] if os.path.exists(os.path.join(old, base + '.png')) else []) + [os.path.join(d, nm + '.png')]:
        im = Image.open(p).convert('RGB').crop(box)
        s = 520 / im.height; ims.append(im.resize((int(im.width * s), 520), Image.LANCZOS))
    W = sum(i.width for i in ims) + 10 * (len(ims) - 1)
    row = Image.new('RGB', (W, 520), (40, 40, 40)); x = 0
    for i in ims: row.paste(i, (x, 0)); x += i.width + 10
    rows.append(row)
W = max(r.width for r in rows); H = sum(r.height + 10 for r in rows)
sheet = Image.new('RGB', (W, H), (40, 40, 40)); y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.height + 10
sheet.save(out, quality=88); print(out, sheet.size)
