import numpy as np, colorsys, os
from PIL import Image
d = r'sandbox/piano2/out/c3_c'
def st(p, box, name):
    if not os.path.exists(p): return
    a = np.array(Image.open(p).convert('RGB')).astype(np.float32); x0, y0, x1, y1 = box; r = a[y0:y1, x0:x1]
    l = 0.2126*r[..., 0]+0.7152*r[..., 1]+0.0722*r[..., 2]; t = np.percentile(l, 70); sel = l >= t
    rgb = r[sel].mean(0); h, s, v = colorsys.rgb_to_hsv(*(rgb/255)); lt = l[sel]
    print('%-12s top30%%: p50 %6.1f p99 %6.1f | rgb %-18s hue %5.1f sat %.2f B/R %.2f' % (name, np.percentile(lt, 50), np.percentile(lt, 99), str(rgb.round(0)), h*360, s, rgb[2]/max(rgb[0],1)))
B = {'S02': (250, 820, 700, 1000), 'S06m': (700, 700, 1000, 1080), 'S13': (900, 850, 1200, 1080), 'S04e': (850, 660, 1450, 820), 'S24': (760, 650, 1150, 1080)}
for s, b in B.items():
    for v in ['', '_KA', '_KB', '_KC']:
        st(os.path.join(d, s + v + '.png'), b, s + v)
