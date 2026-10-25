# Cycle 2: before / after sheet. For each shot, <shot>_crit.png (critic's frame of the same film frame) | <shot><suffix>.png
#   python tools/piano/pair_sheet.py <outDir> <out.jpg> <shot1,shot2,...> [suffix] [thumbW]
import sys, os
from PIL import Image, ImageDraw

d, out, shots = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
suf = sys.argv[4] if len(sys.argv) > 4 else ''
tw = int(sys.argv[5]) if len(sys.argv) > 5 else 960
rows = []
for s in shots:
    a, b = os.path.join(d, s + '_crit.png'), os.path.join(d, s + suf + '.png')
    if not (os.path.exists(a) and os.path.exists(b)): continue
    A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    th = int(A.height * tw / A.width)
    rows.append((s, A.resize((tw, th), Image.LANCZOS), B.resize((tw, th), Image.LANCZOS)))
if rows:
    H = sum(r[1].height + 4 for r in rows)
    sheet = Image.new('RGB', (2 * tw + 4, H), (20, 20, 20)); y = 0
    dr = ImageDraw.Draw(sheet)
    for s, A, B in rows:
        sheet.paste(A, (0, y)); sheet.paste(B, (tw + 4, y))
        dr.text((8, y + 6), s + ' before (critic c2)', fill=(255, 255, 0)); dr.text((tw + 12, y + 6), s + suf + ' after', fill=(255, 255, 0))
        y += A.height + 4
    sheet.save(out, quality=88)
    print(out, sheet.size)
