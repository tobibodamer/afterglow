# Side-by-side crops (reference | ours | ours variants...) around the piano of the wide shots.
#   python tools/piano/wide_sheet.py <outDir> <out.jpg> [suffix,suffix...] [rowHeight]
# Crop boxes = the piano mask's bounding box + 12 % margin (ours: <shot>_mask.png, ref: sandbox/piano2/masks/<key>_mask.png).
import sys, os
import numpy as np
from PIL import Image, ImageDraw

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, '..', '..'))
REF = {'r02_hero': ('r2', 'refs/2.webp'), 'r04_bass': ('r4', 'refs/4.webp'), 'r09_water': ('r9', 'refs/9.webp'),
       'r10_establish': ('r10', 'refs/10.webp'), 'r11m_rear': ('r11', 'refs/11.webp')}

def bbox(maskimg, margin=0.12):
    m = np.array(maskimg.convert('RGB')).max(axis=2) > 120
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = x1 - x0, y1 - y0
    mx, my = int(w * margin), int(h * margin)
    W, H = maskimg.size
    return (max(0, x0 - mx), max(0, y0 - my), min(W, x1 + mx), min(H, y1 + my))

def main():
    d, out = sys.argv[1], sys.argv[2]
    sufs = [''] + (sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] else [])
    RH = int(sys.argv[4]) if len(sys.argv) > 4 else 360
    rows = []
    for shot, (rk, rpath) in REF.items():
        tiles = []
        rimg = Image.open(os.path.join(root, rpath)).convert('RGB')
        rmask = Image.open(os.path.join(root, 'sandbox', 'piano2', 'masks', rk + '_mask.png'))
        if rk == 'r11':
            rimg = rimg.transpose(Image.FLIP_LEFT_RIGHT); rmask = rmask.transpose(Image.FLIP_LEFT_RIGHT)
        tiles.append(('ref ' + rk, rimg.crop(bbox(rmask))))
        for suf in sufs:
            name = shot + ('_' + suf if suf else '')
            p, pm = os.path.join(d, name + '.png'), os.path.join(d, name + '_mask.png')
            if not os.path.exists(pm):   # variant runs: one mask per shot (tools/piano/make_variants.py)
                cands = sorted(f for f in os.listdir(d) if f.startswith(shot + '_') and f.endswith('_mask.png'))
                if cands: pm = os.path.join(d, cands[0])
            if os.path.exists(p) and os.path.exists(pm):
                tiles.append((name, Image.open(p).convert('RGB').crop(bbox(Image.open(pm)))))
        if len(tiles) < 2:
            continue
        row = []
        for lab, t in tiles:
            t = t.resize((max(1, int(t.size[0] * RH / t.size[1])), RH), Image.LANCZOS)
            ImageDraw.Draw(t).text((6, 4), lab, fill=(255, 255, 0))
            row.append(t)
        rows.append(row)
    W = max(sum(t.size[0] for t in r) for r in rows)
    sheet = Image.new('RGB', (W, RH * len(rows)))
    for i, r in enumerate(rows):
        x = 0
        for t in r:
            sheet.paste(t, (x, i * RH)); x += t.size[0]
    sheet.save(out, quality=92)
    print(out, sheet.size)

main()
