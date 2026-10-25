import sys, os, numpy as np
from PIL import Image, ImageDraw
d = sys.argv[1]; out = sys.argv[2]; shots = sys.argv[3].split(','); vs = sys.argv[4].split(',')
rows = []
for s in shots:
    m = np.array(Image.open(os.path.join(d, s + '_mask.png')).convert('L')) > 170
    ys, xs = np.nonzero(m); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = 20; box = (max(0, x0 - pad), max(0, y0 - pad), min(1920, x1 + pad), min(1080, y1 + pad))
    tiles = []
    for v in vs:
        f = os.path.join(d, s + ('_' + v if v != '-' else '') + '.png')
        if not os.path.exists(f): continue
        im = Image.open(f).convert('RGB').crop(box); sc = 620 / im.width; im = im.resize((620, max(1, int(im.height * sc))))
        ImageDraw.Draw(im).text((4, 4), s + ' ' + v, fill=(255, 255, 0)); tiles.append(im)
    if tiles:
        h = max(t.height for t in tiles); row = Image.new('RGB', (620 * len(tiles), h)); [row.paste(t, (620 * i, 0)) for i, t in enumerate(tiles)]; rows.append(row)
W = max(r.width for r in rows); H = sum(r.height for r in rows); sh = Image.new('RGB', (W, H)); y = 0
for r in rows: sh.paste(r, (0, y)); y += r.height
sh.save(out, quality=90); print(out, sh.size)
