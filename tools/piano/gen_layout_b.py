"""Generate a self-consistent B-class (211 cm) grand piano layout spec.
Coordinates: metres. Origin on the floor below the front-left corner of the case.
x -> right along the keyboard (bass to treble), z -> away from the player, y -> up.
Sources: case outline from Steinway/dimensions.com Model B plan (path 88), string data
scaled from Chabassier & Durufle INRIA RT-0425 (Steinway D measurements).
"""
import json, math
import numpy as np
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union

SB = r'E:\experimentswithclaude\random\afterglow\sandbox\piano'
outer_raw = np.load(SB + r'\b_outer.npy')

# ---------------------------------------------------------------- case outline
# Build a clean outline: left side x=0, front z=0, right side from front, bentside+tail from samples.
def right_x(z):
    sel = outer_raw[np.abs(outer_raw[:, 1] - z) < 0.003]
    return sel[:, 0].max()
def tail_z(x):
    sel = outer_raw[np.abs(outer_raw[:, 0] - x) < 0.003]
    return sel[:, 1].max()
def left_x(z):
    sel = outer_raw[np.abs(outer_raw[:, 1] - z) < 0.003]
    return sel[:, 0].min()

pts = [(0.0, 0.0), (1.48, 0.0), (1.48, 0.70)]
for z in [0.73, 0.76, 0.79, 0.82, 0.85, 0.88, 0.91, 0.94, 0.97, 1.00, 1.05, 1.10, 1.20, 1.30, 1.40, 1.50,
          1.60, 1.70, 1.78, 1.85, 1.90, 1.95]:
    pts.append((round(float(right_x(z)), 4), z))
for x in [0.75, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20, 0.15, 0.10]:
    pts.append((x, round(float(tail_z(x)), 4)))
for z in [2.05, 2.00, 1.95, 1.90]:
    pts.append((round(float(left_x(z)), 4), z))
pts.append((0.0, 1.85))
outline = Polygon(pts)
assert outline.is_valid, 'outline invalid'
RIM = 0.060
inner_full = outline.buffer(-RIM, join_style=1, resolution=32)

# ---------------------------------------------------------------- keyboard
WP = 0.0235            # white key pitch
KB_LEFT = 0.129        # x of A0 left edge
KB_W = 52 * WP
names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
white_idx_in_oct = {'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6}
# black key centres within octave (mm from C left edge): CDE group 5 slots of 70.5/5, FGAB 7 slots of 94/7
s1 = 70.5 / 5; s2 = 94.0 / 7
black_c = {'C#': 1.5 * s1, 'D#': 3.5 * s1, 'F#': 70.5 + 1.5 * s2, 'G#': 70.5 + 3.5 * s2, 'A#': 70.5 + 5.5 * s2}
keys = []
for n in range(1, 89):
    midi = n + 20
    nm = names[midi % 12]; octv = midi // 12 - 1
    # C-octave left edge in metres: C1 left edge = KB_LEFT + 2 whites (A0,B0)
    c_left = KB_LEFT + 2 * WP + (octv - 1) * 7 * WP
    if '#' in nm:
        xc = c_left + black_c[nm] / 1000.0; col = 'black'
    else:
        xc = c_left + (white_idx_in_oct[nm] + 0.5) * WP; col = 'white'
    keys.append(dict(n=n, midi=midi, name=f'{nm}{octv}', color=col, x_center=round(xc, 5)))

# ---------------------------------------------------------------- string data (Steinway D, INRIA RT-0425)
d_rows = json.load(open(SB + r'\inria_wrapped.json', encoding='utf-8'))
D_L = {}; D_xH = {}; D_d = {}
for i, r in enumerate(d_rows):          # C1 .. B7 -> n = 4 .. 87
    n = i + 4
    D_L[n] = float(r['L']); D_xH[n] = float(r['xH']); D_d[n] = float(r['d'])
# extrapolate A0..B0 and C8 (forum list: 2.010, 2.009, 2.008 ; C8 0.049)
for n, L in [(1, 2.010), (2, 2.009), (3, 2.008)]:
    D_L[n] = L; D_xH[n] = 0.243; D_d[n] = 1.48
D_L[88] = 0.049; D_xH[88] = 0.006; D_d[88] = 0.735

def ratio_B(n):
    if n <= 20:
        return 0.75
    return 1.0 - 0.25 * math.exp(-(n - 21) / 12.7)

def n_strings(n):
    return 1 if n <= 8 else (2 if n <= 20 else 3)

def wound(n):
    return n <= 20

def wound_od_mm(n):
    # overall diameter of copper-wound strings, A0 6.0 mm -> E2 2.3 mm (log-linear)
    return round(6.0 * (2.3 / 6.0) ** ((n - 1) / 19.0), 2)

def plain_d_mm(n):
    # music wire: ~1.10 mm at F2 (n=21) to 0.775 mm at C8 (size 13)
    return round(1.10 * (0.775 / 1.10) ** ((n - 21) / 67.0), 3)

# ---------------------------------------------------------------- strike line / hammer x
SECT = [(1, 20), (21, 39), (40, 57), (58, 76), (77, 88)]
GAP = 0.018   # extra clearance at each strut (x)
# evenly distribute hammers inside sections over [KB_LEFT+0.004, KB_LEFT+KB_W-0.004] with gaps
span = KB_W - 0.008 - GAP * (len(SECT) - 1)
pitch = span / 88.0
hx = {}
x = KB_LEFT + 0.004 + pitch / 2
for si, (a, b) in enumerate(SECT):
    if si > 0:
        x += GAP
    for n in range(a, b + 1):
        hx[n] = x; x += pitch
Z_STRIKE_BASS, Z_STRIKE_TREB = 0.537, 0.472
def z_strike(xx):
    t = (xx - KB_LEFT) / KB_W
    return Z_STRIKE_BASS + (Z_STRIKE_TREB - Z_STRIKE_BASS) * t

def theta_deg(n):
    if n <= 20:
        return 11.0 + 0.25 * (n - 1)
    if n <= 45:
        return -7.0 + 7.0 * (n - 21) / 24.0
    if n <= 64:
        return (n - 45) * 0.08
    return 1.52 - (n - 64) * 0.0633

Y_STR_TENOR = 0.860
strings = []
for n in range(1, 89):
    L = D_L[n] * ratio_B(n)
    xH = D_xH[n] * ratio_B(n)
    th = math.radians(theta_deg(n))
    dvec = np.array([math.sin(th), math.cos(th)])
    s = np.array([hx[n], z_strike(hx[n])])
    f = s - xH * dvec
    bpt = f + L * dvec
    hitch_d = min(0.13, max(0.045, 0.12 * L + 0.035)) if n > 20 else 0.10
    h = bpt + hitch_d * dvec
    # tuning pin distance in front of agraffe/capo
    pin_d = 0.058 if n <= 20 else (0.055 if n <= 52 else 0.075)
    p = f - pin_d * dvec
    strings.append(dict(n=n, name=keys[n - 1]['name'], L=round(L, 4), xH=round(xH, 4), theta=round(theta_deg(n), 2),
                        strike=[round(v, 4) for v in s], front=[round(v, 4) for v in f], bridge=[round(v, 4) for v in bpt],
                        hitch=[round(v, 4) for v in h], pin=[round(v, 4) for v in p], nstr=n_strings(n), wound=wound(n),
                        d_mm=(wound_od_mm(n) if wound(n) else plain_d_mm(n)), D_L=D_L[n]))

# ---------------------------------------------------------------- checks
bad = []
for s_ in strings:
    for key in ('bridge', 'hitch'):
        P = Point(*s_[key])
        dist = inner_full.exterior.distance(P)
        if not inner_full.contains(P):
            bad.append((s_['n'], key, 'OUTSIDE', round(dist, 3)))
        elif dist < 0.03:
            bad.append((s_['n'], key, 'close', round(dist, 3)))
print('clearance issues:', bad[:20], len(bad))
mind = min(inner_full.exterior.distance(Point(*s_['hitch'])) for s_ in strings)
print('min hitch->inner rim distance', round(mind, 3))
for nn in (1, 8, 12, 20, 21, 28, 33, 40, 45, 52, 57, 58, 64, 69, 76, 77, 82, 88):
    s_ = strings[nn - 1]
    print(nn, s_['name'], 'L', s_['L'], 'D', s_['D_L'], 'th', s_['theta'], 'strike', s_['strike'], 'front', s_['front'],
          'bridge', s_['bridge'], 'hitch', s_['hitch'], 'pin', s_['pin'], 'd', s_['d_mm'],
          'rimclr %.3f' % inner_full.exterior.distance(Point(*s_['hitch'])))
print('total strings', sum(s_['nstr'] for s_ in strings))
print('outline area m2', round(outline.area, 3), 'bounds', outline.bounds, 'npts', len(pts))
json.dump(dict(outline=pts, keys=keys, strings=strings, hammer_x={k: round(v, 5) for k, v in hx.items()},
               inner=[(round(a, 4), round(b, 4)) for a, b in inner_full.exterior.coords]),
          open(SB + r'\layout_b.json', 'w'), indent=0)
