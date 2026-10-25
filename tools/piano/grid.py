# Draw a labelled normalized-coordinate grid over an image crop (for tracing mask polygons by eye).
#   python tools/piano/grid.py <img> <out.png> x0 y0 x1 y1 [step=0.02] [polys.json key]
# Coordinates are normalized to the full image (0..1). Optional: overlay polygons from polys.json[key].
import sys, json
from PIL import Image, ImageDraw

img = Image.open(sys.argv[1]).convert('RGB')
out = sys.argv[2]
x0, y0, x1, y1 = map(float, sys.argv[3:7])
step = float(sys.argv[7]) if len(sys.argv) > 7 else 0.02
W, H = img.size
crop = img.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
scale = max(1.0, 1400.0 / crop.size[0])
crop = crop.resize((int(crop.size[0] * scale), int(crop.size[1] * scale)), Image.LANCZOS)
d = ImageDraw.Draw(crop)
cw, ch = crop.size
def px(x, y):
    return ((x - x0) / (x1 - x0) * cw, (y - y0) / (y1 - y0) * ch)
import math
gx = math.ceil(x0 / step) * step
while gx <= x1:
    X, _ = px(gx, 0)
    major = abs(round(gx / (step * 5)) * step * 5 - gx) < 1e-6
    d.line([(X, 0), (X, ch)], fill=(0, 255, 0) if major else (0, 120, 0), width=1)
    d.text((X + 2, 2), f'{gx:.2f}', fill=(255, 255, 0))
    gx += step
gy = math.ceil(y0 / step) * step
while gy <= y1:
    _, Y = px(0, gy)
    major = abs(round(gy / (step * 5)) * step * 5 - gy) < 1e-6
    d.line([(0, Y), (cw, Y)], fill=(0, 255, 0) if major else (0, 120, 0), width=1)
    d.text((2, Y + 2), f'{gy:.2f}', fill=(255, 255, 0))
    gy += step
if len(sys.argv) > 9:
    polys = json.load(open(sys.argv[8]))[sys.argv[9]]
    for p in polys:
        pts = [px(a, b) for a, b in p]
        d.line(pts + [pts[0]], fill=(255, 0, 255), width=2)
crop.save(out)
