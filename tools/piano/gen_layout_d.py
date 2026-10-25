"""Generate the D-class (274 x 156 cm) concert-grand layout for the Afterglow piano module.

Coordinates: metres, piano frame of research/piano.md section 0: origin on the floor below the front-left
case corner, x right along the keyboard (bass -> treble), z away from the player (toward the tail), y up.

Inputs
  - case outline: research/piano.md section 3.2 (INRIA Steinway D photo soundboard edge + 0.0555 rim)
  - speaking lengths L and strike distances xH: INRIA RT-0425 (Chabassier & Durufle 2012), Steinway D,
    C1..B7 measured (inria_wrapped.json); A0..B0 and C8 extrapolated (piano.md 7.2)
  - keyboard / action / heights: research/piano.md sections 5, 6, 7.5, 12 (kept exactly)
  - strike line and belly rail: measured on the INRIA D top-view photo (damper/hammer band, see log.md)
The INRIA bridge coordinates (x0, y0) are not used for placement: in the treble they sit ~6 cm right of the
keyboard (inconsistent frame), so string directions follow the piano.md 7.4 angle scheme, re-fitted so the D
bridges land inside the D rim; the INRIA tenor bridge points are only used as a cross-check (printed).

Outputs
  scene/src/piano/layout_d.json         (consumed by scene/src/piano/layout.js and the geometry builders)
  sandbox/piano2/plan_d.png             plan-view check
  sandbox/piano2/plan_d_overlay.png     plan drawn over the INRIA D photo (keyboard-aligned)
"""
import json, math, os, sys
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_JSON = os.path.join(ROOT, 'scene', 'src', 'piano', 'layout_d.json')
OUT_DIR = os.path.join(ROOT, 'sandbox', 'piano2')

r4 = lambda v: round(float(v), 4)
r5 = lambda v: round(float(v), 5)

# ------------------------------------------------------------------------------------------------ case
CASE_W, CASE_L = 1.560, 2.740
RIM = 0.0555
OUTLINE_KEY = [(0, 0), (0, 2.533), (0.026, 2.618), (0.077, 2.673), (0.175, 2.714), (0.429, 2.735), (0.647, 2.722),
               (0.798, 2.677), (0.860, 2.632), (0.909, 2.577), (0.937, 2.515), (0.957, 2.425), (1.055, 1.582),
               (1.080, 1.439), (1.114, 1.330), (1.150, 1.258), (1.207, 1.173), (1.349, 1.042), (1.489, 0.942),
               (1.526, 0.895), (1.550, 0.839), (1.560, 0.765), (1.560, 0)]


def catmull_rom_centripetal(P, n_per=12, alpha=0.5):
    """Centripetal Catmull-Rom through points P (open), n_per samples per segment."""
    P = [np.array(p, float) for p in P]
    ext = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        def tj(ti, a, b):
            return ti + max(np.linalg.norm(b - a), 1e-9) ** alpha
        t0 = 0.0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        for k in range(n_per):
            t = t1 + (t2 - t1) * k / n_per
            A1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            A2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            A3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2
            B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3
            out.append((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2)
    out.append(P[-1])
    return np.array(out)


# The spine (x=0) and the front-right straight side are straight lines; only the curved run in between is splined.
curve_pts = OUTLINE_KEY[1:-1]                    # (0,2.533) ... (1.560,0.765)
curve = catmull_rom_centripetal(curve_pts, n_per=10)
# straight spine from front-left to (0,2.533), curve, straight treble side down to (1.56,0)
outline = np.vstack([[[0.0, 0.0]], curve, [[CASE_W, 0.0]]])
# drop near-duplicates
keep = [0]
for i in range(1, len(outline)):
    if np.linalg.norm(outline[i] - outline[keep[-1]]) > 0.004:
        keep.append(i)
outline = outline[keep]
case_poly = Polygon(outline)
assert case_poly.is_valid
inner_poly = case_poly.buffer(-RIM, join_style=1, quad_segs=24)
inner_ring = np.array(inner_poly.exterior.coords)

# ------------------------------------------------------------------------------------------------ keyboard
WP = 0.0235
KB_W = 52 * WP                                   # 1.222
KB_LEFT = (CASE_W - KB_W) / 2                    # 0.169: keyboard centred in the case (DESIGN.md 2)
KB_RIGHT = KB_LEFT + KB_W
KB_CENTER = KB_LEFT + KB_W / 2                   # 0.780 (E4|F4 boundary)
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
WHITE_IDX = {'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6}
S1, S2 = 70.5 / 5, 94.0 / 7                      # equal slots: C-E 5 slots, F-B 7 slots (mm)
BLACK_C = {'C#': 1.5 * S1, 'D#': 3.5 * S1, 'F#': 70.5 + 1.5 * S2, 'G#': 70.5 + 3.5 * S2, 'A#': 70.5 + 5.5 * S2}
# white-key tail spans (mm from C) = the slots not covered by black keys
TAIL_MM = {'C': (0, S1), 'D': (2 * S1, 3 * S1), 'E': (4 * S1, 70.5),
           'F': (70.5, 70.5 + S2), 'G': (70.5 + 2 * S2, 70.5 + 3 * S2), 'A': (70.5 + 4 * S2, 70.5 + 5 * S2),
           'B': (70.5 + 6 * S2, 164.5)}
KEY = dict(
    frontZ=0.022, visibleLen=0.150, headLen=0.050, gap=0.0010, topY=0.715, keytopThk=0.0020, frontHeight=0.0235,
    topFillet=0.0005, frontFillet=0.0008,
    black=dict(baseLen=0.095, topLen=0.085, frontSlope=0.007, rearSlope=0.003, baseW=0.0127, topW=0.0098,
               height=0.0125, frontZ=0.073, topFillet=0.0012),
    pivot=dict(y=0.686, z=0.290), whiteDipDeg=2.14, blackDipDeg=2.46, unaCordaShiftX=0.0025,
)


def c_left(octv):
    return KB_LEFT + 2 * WP + (octv - 1) * 7 * WP


keys = []
for n in range(1, 89):
    midi = n + 20
    nm = NAMES[midi % 12]
    octv = midi // 12 - 1
    cl = c_left(octv)
    g = KEY['gap'] / 2
    zf = KEY['frontZ']; zh = zf + KEY['headLen']; zb = zf + KEY['visibleLen']
    if '#' in nm:
        xc = cl + BLACK_C[nm] / 1000.0
        bw = KEY['black']['baseW']; tw = KEY['black']['topW']
        b = KEY['black']
        base = [(xc - bw / 2, b['frontZ']), (xc + bw / 2, b['frontZ']), (xc + bw / 2, b['frontZ'] + b['baseLen']),
                (xc - bw / 2, b['frontZ'] + b['baseLen'])]
        top = [(xc - tw / 2, b['frontZ'] + b['frontSlope']), (xc + tw / 2, b['frontZ'] + b['frontSlope']),
               (xc + tw / 2, b['frontZ'] + b['baseLen'] - b['rearSlope']),
               (xc - tw / 2, b['frontZ'] + b['baseLen'] - b['rearSlope'])]
        keys.append(dict(n=n, midi=midi, name=f'{nm}{octv}', color='black', x_center=r5(xc),
                         base_xz=[[r5(a), r5(c)] for a, c in base], top_xz=[[r5(a), r5(c)] for a, c in top],
                         top_y=r5(KEY['topY'] + b['height'])))
    else:
        wi = WHITE_IDX[nm]
        x0 = cl + wi * WP; x1 = x0 + WP
        xc = (x0 + x1) / 2
        t0, t1 = TAIL_MM[nm]
        tx0 = cl + t0 / 1000.0; tx1 = cl + t1 / 1000.0
        if n == 1:          # A0: full on its left (no G# below)
            tx0 = x0
        if n == 88:         # C8: full rectangle
            tx1 = x1
        # outline (counter-clockwise in x-z, starting front-left); gaps of 0.5 mm per side
        hx0, hx1 = x0 + g, x1 - g
        ux0, ux1 = tx0 + g, tx1 - g
        poly = [(hx0, zf), (hx1, zf)]
        if ux1 < hx1 - 1e-6:
            poly += [(hx1, zh), (ux1, zh)]
        poly += [(ux1, zb), (ux0, zb)]
        if ux0 > hx0 + 1e-6:
            poly += [(ux0, zh), (hx0, zh)]
        keys.append(dict(n=n, midi=midi, name=f'{nm}{octv}', color='white', x_center=r5(xc),
                         x_range=[r5(x0), r5(x1)], tail_x=[r5(tx0), r5(tx1)],
                         top_xz=[[r5(a), r5(c)] for a, c in poly], top_y=r5(KEY['topY'])))

# ------------------------------------------------------------------------------------------------ string data
d_rows = json.load(open(os.path.join(HERE, 'inria_wrapped.json'), encoding='utf-8'))
D_L, D_xH, D_core, D_x0 = {}, {}, {}, {}
for i, r in enumerate(d_rows):                  # C1 .. B7 -> n = 4 .. 87
    n = i + 4
    D_L[n] = float(r['L']); D_xH[n] = float(r['xH']); D_core[n] = float(r['d']); D_x0[n] = (float(r['x0']), float(r['y0']))
for n, L in [(1, 2.010), (2, 2.009), (3, 2.008)]:
    D_L[n] = L; D_xH[n] = 0.243; D_core[n] = 1.48
D_L[88] = 0.049; D_xH[88] = 0.006; D_core[88] = 0.735


def n_strings(n):
    return 1 if n <= 8 else (2 if n <= 20 else 3)


def wound_od_mm(n):          # copper-wound overall diameter A0 6.0 -> E2 2.3 mm (log-linear)
    return round(6.0 * (2.3 / 6.0) ** ((n - 1) / 19.0), 2)


def plain_d_mm(n):           # music wire 1.10 mm (F2) -> 0.775 mm (C8)
    return round(1.10 * (0.775 / 1.10) ** ((n - 21) / 67.0), 3)


# hammers: 5 sections with an extra gap at each strut
SECT = [(1, 20), (21, 39), (40, 57), (58, 76), (77, 88)]
GAP = 0.018
span = KB_W - 0.008 - GAP * (len(SECT) - 1)
HPITCH = span / 88.0
hx = {}
x = KB_LEFT + 0.004 + HPITCH / 2
for si, (a, b) in enumerate(SECT):
    if si > 0:
        x += GAP
    for n in range(a, b + 1):
        hx[n] = x; x += HPITCH
STRUT_GAP_X = {}             # x of the gap centre between sections (strut positions at the front)
for si in range(1, len(SECT)):
    a = SECT[si][0]
    STRUT_GAP_X[a] = (hx[a - 1] + hx[a]) / 2

# strike line (measured on the INRIA D photo: damper band centre minus 0.030)
STRIKE = ((hx[1], 0.612), (hx[88], 0.548))


def z_strike(xx):
    (xa, za), (xb, zb) = STRIKE
    return za + (zb - za) * (xx - xa) / (xb - xa)


def theta_deg(n):
    """String angle from +z toward +x (plan). piano.md 7.4 scheme, re-fitted for the D rim."""
    if n <= 20:
        return 9.0 + 3.0 * (n - 1) / 19.0          # bass: +9 -> +12 deg (overstrung, crosses the tenor)
    if n <= 45:
        return -6.5 + 6.5 * (n - 21) / 24.0        # low tenor: -6.5 -> 0 at F4
    if n <= 64:
        return (n - 45) * 0.08                     # to +1.5 at C6
    return 1.52 - (n - 64) * 0.0633                # back to 0 at C8


Y_TENOR = 0.862
Y_BASS_AGRAFFE = 0.880
Y_BASS_BRIDGE = 0.892
Y_LONG_BRIDGE_TOP = 0.858
Y_HITCH = 0.852
Y_PLATE = 0.850

strings = []
for n in range(1, 89):
    L = D_L[n]; xH = D_xH[n]
    th = math.radians(theta_deg(n))
    d = np.array([math.sin(th), math.cos(th)])
    s = np.array([hx[n], z_strike(hx[n])])
    f = s - xH * d
    b = f + L * d
    if n <= 20:
        hitch_d = 0.10
    else:
        # rear duplex: long in the treble (photo: treble hitch rows sit on the band near the bentside)
        hitch_d = 0.105 + 0.085 * (n - 21) / 67.0
    h = b + hitch_d * d
    # keep the hitch pin >= 0.075 inside the inner rim
    for _ in range(40):
        if inner_poly.exterior.distance(Point(*h)) >= 0.075 and inner_poly.contains(Point(*h)):
            break
        hitch_d -= 0.004
        h = b + hitch_d * d
    pin_d = 0.060 if n <= 20 else (0.058 if n <= 52 else 0.080)
    p = f - pin_d * d
    wound = n <= 20
    strings.append(dict(n=n, name=keys[n - 1]['name'], L=L, xH=xH, theta=theta_deg(n), dir=d.tolist(),
                        strike=s, front=f, bridge=b, hitch=h, pin=p, nstr=n_strings(n), wound=wound,
                        d_mm=(wound_od_mm(n) if wound else plain_d_mm(n)), core_mm=D_core[n],
                        term='agraffe' if n <= 52 else 'capo'))

# INRIA cross-check (tenor/mid only, where the INRIA frame agrees with the photo)
dev = []
for st in strings:
    n = st['n']
    if 21 <= n <= 50 and n in D_x0:
        xi, yi = D_x0[n]
        bi = np.array([xi + RIM, yi + 0.680])
        dev.append(np.linalg.norm(bi - st['bridge']))
print('INRIA tenor bridge deviation: mean %.3f max %.3f m' % (np.mean(dev), np.max(dev)))

# ------------------------------------------------------------------------------------------------ clearance check
bad = []
for st in strings:
    for key in ('bridge', 'hitch'):
        P_ = Point(*st[key])
        dist = inner_poly.exterior.distance(P_)
        if not inner_poly.contains(P_):
            bad.append((st['n'], key, 'OUTSIDE', round(dist, 3)))
        elif dist < 0.035:
            bad.append((st['n'], key, 'close', round(dist, 3)))
print('clearance issues:', bad[:12], len(bad))
print('min hitch->inner rim %.3f' % min(inner_poly.exterior.distance(Point(*st['hitch'])) for st in strings))

# ------------------------------------------------------------------------------------------------ belly rail / soundboard
BELLY = ((0.0, 0.702), (CASE_W, 0.566))          # measured on the photo (dark action band back edge)


def belly_z(xx):
    (xa, za), (xb, zb) = BELLY
    return za + (zb - za) * (xx - xa) / (xb - xa)


big_back = Polygon([(-1, belly_z(-1)), (3, belly_z(3)), (3, 4), (-1, 4)])
soundboard = inner_poly.intersection(big_back)
print('soundboard area %.3f' % soundboard.area)

# ------------------------------------------------------------------------------------------------ plate
FALLBOARD_BACK_Z = 0.250
PLATE_FRONT_Z = 0.256
front_pts = sorted([(st['front'][0], st['front'][1]) for st in strings], key=lambda q: q[0])
xs = np.linspace(inner_poly.bounds[0], inner_poly.bounds[2], 145)
env = []
for xx in xs:
    near = [q[1] for q in front_pts if abs(q[0] - xx) < 0.05]
    zf = (max(near) if near else np.interp(xx, [q[0] for q in front_pts], [q[1] for q in front_pts])) + 0.016
    env.append((xx, zf))
# smooth the envelope a little
ez = np.array([e[1] for e in env])
ez = np.convolve(np.pad(ez, 6, mode='edge'), np.ones(13) / 13, mode='valid')
# Hammer clearance (session 5, critic fix): in the capo section the strike point is only 6-27 mm behind the bearing
# line, so "front termination + 16 mm" put the panel over the hammer felts at the blow (notes 60-88). The panel edge
# now stays STRIKE_CLEAR in front of every hammer's felt (depth D at the blow, head vertical) within reach in x;
# the capo bar overhangs the gap from above (its V edge stays on the bearing line).
STRIKE_CLEAR = 0.004
def hammer_depth(n):
    return 0.032 + (0.013 - 0.032) * (n - 1) / 87.0
lim_pts = [(hx[st['n']], st['strike'][1] - hammer_depth(st['n']) / 2 - STRIKE_CLEAR) for st in strings]
for i, xx in enumerate(xs):
    lim = [z for (x_, z) in lim_pts if abs(x_ - xx) < 0.024]
    if lim:
        ez[i] = min(ez[i], min(lim))
env = [(e[0], float(z)) for e, z in zip(env, ez)]
fp = Polygon([(xs[0] - 0.1, PLATE_FRONT_Z), (xs[-1] + 0.1, PLATE_FRONT_Z), (xs[-1] + 0.1, env[-1][1])] + env[::-1] + [(xs[0] - 0.1, env[0][1])])
front_plate = fp.intersection(inner_poly)

def band_edge(st):
    d = np.array(st['dir'])
    return tuple(st['bridge'] + 0.030 * d)

hc = [band_edge(st) for st in strings if st['n'] >= 21]
hc_poly = Polygon([(2.0, hc[-1][1]), (2.0, 4.0), (-0.5, 4.0), (-0.5, hc[0][1] + 0.10), (0.0, hc[0][1] + 0.02)] + hc).buffer(0)
band = inner_poly.intersection(hc_poly)
bass = [st for st in strings if st['n'] <= 20]

def off(st, key, dd):
    return tuple(st[key] - dd * np.array(st['dir']))

bw_pts = [off(st, 'bridge', 0.075) for st in bass] + [off(st, 'hitch', 0.030) for st in bass[::-1]]
bass_window = Polygon(bw_pts).buffer(0.014, join_style=1)
band = band.difference(bass_window)
spine = Polygon([(RIM - 0.01, PLATE_FRONT_Z), (RIM + 0.048, PLATE_FRONT_Z), (RIM + 0.048, 3.0), (RIM - 0.01, 3.0)]).intersection(inner_poly)

# struts (centre lines, top widths). D-class adaptation of piano.md 8 table + INRIA photo.
xA = STRUT_GAP_X[21]
xC = STRUT_GAP_X[40]
xD = STRUT_GAP_X[58]
xE = STRUT_GAP_X[77]
zfront = lambda xx: float(np.interp(xx, [e[0] for e in env], [e[1] for e in env])) - 0.03
stA = strings[20]; stB = strings[19]
def gap_line(n_lo, z_end):
    """Centre line of the gap between notes n_lo and n_lo+1, from the front panel back to z_end."""
    a_, b_ = strings[n_lo - 1], strings[n_lo]
    d_ = (np.array(a_['dir']) + np.array(b_['dir'])); d_ /= np.linalg.norm(d_)
    p0 = (np.array(a_['strike']) + np.array(b_['strike'])) / 2
    z0 = zfront(p0[0])
    pa = p0 + d_ * (z0 - p0[1]) / d_[1]
    pb = p0 + d_ * (z_end - p0[1]) / d_[1]
    return (float(pa[0]), float(pa[1])), (float(pb[0]), float(pb[1]))


STEM_W = 0.015            # struts are narrow where they cross the action gap (between hammer sections, INRIA D photo)


def gap_poly(n_lo, z_end, w_full):
    """Strut along the gap between notes n_lo | n_lo+1: narrow through the action gap, full width behind the belly rail."""
    a_, b_ = gap_line(n_lo, z_end)
    d_ = np.array(b_) - np.array(a_); d_ /= np.linalg.norm(d_)
    zb = belly_z(a_[0]) + 0.015
    t = (zb - a_[1]) / d_[1]
    mid = (a_[0] + d_[0] * t, a_[1] + d_[1] * t)
    mid2 = (mid[0] + d_[0] * 0.05, mid[1] + d_[1] * 0.05)
    return dict(pts=[a_, mid, mid2, b_], w=[STEM_W, STEM_W, w_full, w_full])


# Strut A runs under the bass strings and hugs the left side of tenor string 21 (which converges toward the break
# behind the hammers): centred in the hammer gap at the strike line, then parallel to string 21 at a clearance.
s21 = strings[20]
d21 = np.array(s21['dir'])
def x21_left(zz):
    t_ = (zz - s21['strike'][1]) / d21[1]
    return s21['strike'][0] + d21[0] * t_ - 0.0039 - 0.0006       # left unison string surface
z_strk = s21['strike'][1]
z_hub = belly_z(xA) + 0.016
A_pts, A_w = [(xA + 0.0006, zfront(xA)), (xA + 0.0006, z_strk + 0.020)], [STEM_W - 0.003, STEM_W - 0.003]   # straight past hammer 20's felt at the blow
for zz in [z_hub] + [z_hub + 0.05 * k for k in range(1, 9)] + [z_hub + 0.9, z_hub + 1.45, z_hub + 1.72]:
    hw_ = 0.0065 + (0.016 - 0.0065) * min(1.0, max(0.0, (zz - z_hub) / 0.40))
    A_pts.append((x21_left(zz) - 0.0025 - hw_, zz)); A_w.append(2 * hw_)
HUB = A_pts[2]
STRUTS = {
    'A_tenor_break_arm': dict(pts=A_pts, w=A_w),
    'B_bass_break_arm': dict(pts=[HUB, (xA + math.sin(math.radians(12.6)) * 1.30, z_hub + math.cos(math.radians(12.6)) * 1.30)], w=[0.028, 0.030]),
    'C_strut_39_40': gap_poly(39, 1.40, 0.028),
    'D_strut_57_58': gap_poly(57, 1.00, 0.027),
    'E_strut_76_77': gap_poly(76, 0.80, 0.025),
    'F_diagonal_cross_strut': dict(pts=[(xA + 0.012, z_hub + 0.006), (xD + 0.005, 0.99)], w=[0.022, 0.024]),
}
# vertical profile per strut: 'web' = sits on the plate web / soundboard gap (bottom 0.846, top 0.892),
# 'raised' = bridges over the tenor strings (bottom 0.871), 'lowered' z-ranges where the bass strings pass over (top 0.872)
STRUT_KIND = {'A_tenor_break_arm': 'web', 'B_bass_break_arm': 'raised', 'C_strut_39_40': 'web', 'D_strut_57_58': 'web',
              'E_strut_76_77': 'web', 'F_diagonal_cross_strut': 'raised'}
# The 3-D builder shapes each strut from these: top <= 0.8768 where bass strings pass over it (they run at 0.880-0.893),
# bottom >= 0.8655 where tenor strings pass under it (0.862); 'raised' struts are 0.8655-0.898 elsewhere.


def cross_ranges(s, which):
    """Arc-length ranges along strut s where strings of the given group (bass/tenor) cross its footprint."""
    line = LineString(s['pts'])
    poly_ = strut_polys_tmp[id(s)]
    rng = []
    for st in strings:
        if (which == 'bass') != (st['n'] <= 20):
            continue
        seg = LineString([tuple(st['front']), tuple(st['hitch'])]).buffer(0.0045 if st['n'] <= 20 else 0.0045)
        ix = poly_.intersection(seg)
        if ix.is_empty or ix.area < 1e-7:
            continue
        cs = [line.project(Point(c)) for g in (ix.geoms if hasattr(ix, 'geoms') else [ix]) for c in g.exterior.coords]
        rng.append([min(cs) - 0.006, max(cs) + 0.006])
    rng.sort()
    merged = []
    for a_, b_ in rng:
        if merged and a_ <= merged[-1][1] + 0.01:
            merged[-1][1] = max(merged[-1][1], b_)
        else:
            merged.append([a_, b_])
    return [[round(a_, 4), round(b_, 4)] for a_, b_ in merged]


def strut_poly(s):
    parts = []
    for i in range(len(s['pts']) - 1):
        a_, b_ = s['pts'][i], s['pts'][i + 1]
        w_ = max(s['w'][i], s['w'][i + 1])
        parts.append(LineString([a_, b_]).buffer(w_ / 2, cap_style=2 if i in (0, len(s['pts']) - 2) else 1))
    return unary_union(parts)


strut_polys = {k: strut_poly(s) for k, s in STRUTS.items()}
strut_polys_tmp = {id(s): strut_polys[k] for k, s in STRUTS.items()}
for k, s in STRUTS.items():
    s['bassOver'] = cross_ranges(s, 'bass')
    s['tenorUnder'] = cross_ranges(s, 'tenor')
    print('strut %-24s len %.3f bassOver %s tenorUnder %s' % (k, LineString(s['pts']).length, s['bassOver'], s['tenorUnder']))
# action clearance: hammer heads and damper footprints must not lie under any strut
act = []
for st in strings:
    t_ = (st['n'] - 1) / 87.0
    D_ = 0.032 + (0.013 - 0.032) * t_
    act.append(Point(hx[st['n']], st['strike'][1]).buffer(1).intersection(
        Polygon([(hx[st['n']] - 0.0058, st['strike'][1] - D_ / 2), (hx[st['n']] + 0.0058, st['strike'][1] - D_ / 2),
                 (hx[st['n']] + 0.0058, st['strike'][1] + D_ / 2), (hx[st['n']] - 0.0058, st['strike'][1] + D_ / 2)])))
    if st['n'] <= 67:
        dc = st['strike'] + 0.030 * np.array(st['dir']); dd_ = 0.045 + (0.030 - 0.045) * (st['n'] - 1) / 66
        act.append(Polygon([(dc[0] - 0.0058, dc[1] - dd_ / 2), (dc[0] + 0.0058, dc[1] - dd_ / 2), (dc[0] + 0.0058, dc[1] + dd_ / 2), (dc[0] - 0.0058, dc[1] + dd_ / 2)]))
act_u = unary_union(act)
for k_, poly_ in strut_polys.items():
    ov = poly_.intersection(act_u).area
    print('strut %-24s action overlap %.1f mm2' % (k_, ov * 1e6))
plate = unary_union([front_plate, band, spine] + list(strut_polys.values())).intersection(inner_poly.buffer(-0.008, join_style=1))
plate = plate.buffer(0.004, join_style=1).buffer(-0.004, join_style=1)   # round the concave joins a little
print('plate area %.3f' % plate.area)
# strings crossing struts (plan) outside the front panel: tenor strings must not; bass strings pass OVER strut A
strut_cross = {}
for k_, poly_ in strut_polys.items():
    hits = []
    for st in strings:
        seg = LineString([tuple(st['front']), tuple(st['hitch'])])
        ix = seg.intersection(poly_.difference(front_plate.buffer(0.01)))
        if not ix.is_empty and ix.length > 0.002:
            zs_ = [c[1] for c in (ix.coords if ix.geom_type == 'LineString' else [c for g in ix.geoms for c in g.coords])]
            hits.append((st['n'], round(min(zs_), 3), round(max(zs_), 3)))
    strut_cross[k_] = hits
    print('strut', k_, 'crossed by', len(hits), 'notes', [h[0] for h in hits][:30])
web = unary_union([front_plate, band, spine]).intersection(inner_poly.buffer(-0.008, join_style=1))

# round flanged holes along the bentside band, where no string passes and the band is wide enough
cand = []
minx, minz, maxx, maxz = band.bounds
for xx in np.arange(minx, maxx, 0.01):
    for zz in np.arange(minz, maxz, 0.01):
        p_ = Point(xx, zz)
        if band.contains(p_):
            dd = band.boundary.distance(p_)
            if dd > 0.068:
                cand.append((dd, xx, zz))
cand.sort(reverse=True)
rear_segs = unary_union([LineString([tuple(st['bridge']), tuple(st['hitch'])]).buffer(0.010) for st in strings])
strut_union = unary_union(list(strut_polys.values())).buffer(0.01)
HOLES_MANUAL = [(0.726, 2.452), (0.792, 2.212), (0.812, 1.985), (0.838, 1.715), (0.796, 1.505), (0.860, 1.320),
                (0.952, 1.120), (1.078, 0.962)]
SLOT = dict(center=(0.262, 2.452), size=(0.078, 0.150), angleDeg=4.0)     # oval hole near the tail-left (bass hitch)
holes = []
for xx, zz in HOLES_MANUAL:
    cp = Point(xx, zz).buffer(0.0525)
    if cp.intersects(rear_segs):
        print('WARN hole over strings', xx, zz)
    if not plate.buffer(-0.004).contains(cp):
        print('WARN hole flange leaves the plate', xx, zz)
    holes.append((xx, zz))
for dd, xx, zz in ([] if HOLES_MANUAL else cand):
    if all(math.hypot(xx - a, zz - b) > 0.20 for a, b in holes) and not Point(xx, zz).buffer(0.055).intersects(rear_segs) \
            and not Point(xx, zz).buffer(0.055).intersects(strut_union):
        holes.append((round(xx, 3), round(zz, 3)))
    if len(holes) >= 8:
        break
holes.sort(key=lambda q: q[1])
print('holes', holes)
HOLE_D, FLANGE_OD = 0.055, 0.105
from shapely import affinity
slot_poly = affinity.rotate(affinity.scale(Point(0, 0).buffer(0.5, quad_segs=24), SLOT['size'][0], SLOT['size'][1]), SLOT['angleDeg'])
slot_poly = affinity.translate(slot_poly, *SLOT['center'])
cuts = unary_union([Point(*h).buffer(HOLE_D / 2, quad_segs=24) for h in holes] + [slot_poly])
plate_cut = plate.difference(cuts)


def round_all(g, r=0.005):
    """Round every corner (closing then opening) so the 4 mm top fillets of the 3-D slab fit everywhere."""
    return (g.buffer(r, join_style=1, quad_segs=6).buffer(-r, join_style=1, quad_segs=6)
             .buffer(-r, join_style=1, quad_segs=6).buffer(r, join_style=1, quad_segs=6).simplify(0.0003))


web_cut = round_all(web.difference(cuts))
front_plate_r = round_all(front_plate)
# assertion: no hammer felt footprint at the blow (x +- W/2, z +- D/2, 3 mm margin in front) under the plate web
bad_strike = []
for st in strings:
    n_ = st['n']; W_ = 0.0115 + (0.0100 - 0.0115) * (n_ - 1) / 87.0; D_ = hammer_depth(n_); zs_ = st['strike'][1]
    fpp = Polygon([(hx[n_] - W_ / 2, zs_ - D_ / 2 - 0.003), (hx[n_] + W_ / 2, zs_ - D_ / 2 - 0.003), (hx[n_] + W_ / 2, zs_ + D_ / 2), (hx[n_] - W_ / 2, zs_ + D_ / 2)])
    a_ = fpp.intersection(web_cut).area
    if a_ > 1e-8:
        bad_strike.append((n_, round(a_ * 1e6, 2)))
print('hammer footprints under the plate web (note, mm2):', bad_strike)
assert not bad_strike, 'plate web covers hammer strike footprints'

# bolts: around the band boundary + strut roots
bolts = []
ring = inner_poly.buffer(-0.034, join_style=1).exterior
for t in np.arange(0.1, ring.length, 0.27):
    p_ = ring.interpolate(t)
    if plate.buffer(-0.012).contains(p_) and p_.y > 0.30 and not p_.buffer(0.02).intersects(rear_segs):
        if all(math.hypot(p_.x - h[0], p_.y - h[1]) > 0.075 for h in holes):
            bolts.append((round(p_.x, 3), round(p_.y, 3)))
for xx in (xA, xC, xD, xE):
    bolts.append((round(xx, 3), round(PLATE_FRONT_Z + 0.040, 3)))
bolts.append((round(RIM + 0.035, 3), round(PLATE_FRONT_Z + 0.06, 3)))
bolts.append((round(CASE_W - RIM - 0.035, 3), round(PLATE_FRONT_Z + 0.04, 3)))
print('bolts', len(bolts))

long_bridge = [tuple(st['bridge']) for st in strings if st['n'] >= 21]
bass_bridge = [tuple(st['bridge']) for st in strings if st['n'] <= 20]
print('long bridge %.3f m, bass bridge %.3f m' % (LineString(long_bridge).length, LineString(bass_bridge).length))
v = np.array(long_bridge[-1]) - np.array(long_bridge[0])
grain = math.degrees(math.atan2(v[1], v[0]))
print('long-bridge chord angle from +x: %.1f deg' % grain)

# capo bar (notes 53..88) and pressure bar
capo_pts = [tuple(st['front']) for st in strings if st['n'] >= 53]
press_pts = [tuple(st['front'] - 0.030 * np.array(st['dir'])) for st in strings if st['n'] >= 53]

# ribs (under the soundboard, perpendicular to the grain), INRIA: 9-35 mm tall
rib_dir = np.array([math.cos(math.radians(grain + 90)), math.sin(math.radians(grain + 90))])
gr_dir = np.array([math.cos(math.radians(grain)), math.sin(math.radians(grain))])
c0 = np.array(soundboard.centroid.coords[0])
ribs = []
for k in range(-8, 9):
    o = c0 + gr_dir * (k * 0.115)
    ln = LineString([tuple(o - rib_dir * 3), tuple(o + rib_dir * 3)]).intersection(soundboard.buffer(-0.012))
    if ln.is_empty:
        continue
    segs = [ln] if ln.geom_type == 'LineString' else list(ln.geoms)
    for sg in segs:
        if sg.length > 0.15:
            ribs.append([[r4(a), r4(b)] for a, b in sg.coords])
print('ribs', len(ribs))

# underside beams (4 spruce braces from a hub), inside the rim bottom
hub = (0.72, 1.40)
brace_ends = [(RIM + 0.02, 2.20), (0.38, 2.68 - 0.02), (1.00, 2.05), (1.42, 1.00)]
braces = []
for e in brace_ends:
    ln = LineString([hub, e]).intersection(inner_poly.buffer(0.01))
    braces.append([[r4(a), r4(b)] for a, b in ln.coords])

# ------------------------------------------------------------------------------------------------ other assemblies
LEGS = dict(front=[[0.160, 0.370], [CASE_W - 0.160, 0.370]], rear=[0.470, 2.615], lengthNoCaster=0.565)
LYRE = dict(x=KB_CENTER, z=0.405, height=0.584, pedalX=[KB_CENTER - 0.078, KB_CENTER, KB_CENTER + 0.078],
            pedalTipZ=0.205, pedalPivotZ=0.370, pedalTreadY=0.090, rodPushBehindPivot=0.070,
            pedalTravelTip=dict(sustain=0.012, unaCorda=0.010, sostenuto=0.010))
BENCH = dict(seat=[0.570, 0.370], heightRange=[0.45, 0.59], defaultHeight=0.47, centerX=KB_CENTER - 0.025,
             nearEdgeZ=-0.280, cushionThk=0.075)
LID = dict(thickness=0.024, overhang=0.004, frontFlapZ=[0.175, 0.560], hingeAxis=dict(x=-0.004, y=1.012),
           hingesZ=[0.95, 1.65, 2.35])
# prop: base on the treble rim top; cup on the lid underside. Full stick solves the lid angle from the stick length.
PROP_BASE = (CASE_W - RIM / 2 - 0.002, 1.000, 0.700)
CUP_R = 1.250                                    # cup distance from the hinge axis along the lid underside
def lid_cup(angle_deg):
    a = math.radians(angle_deg)
    hxx, hy = LID['hingeAxis']['x'], LID['hingeAxis']['y']
    # underside of the lid: the lid rests with its underside on the rim top (y=1.0); the hinge axis is 0.012 above
    # so the underside line passes 0.012 below the axis.
    ux, uy = math.cos(a), math.sin(a)
    nx, ny = -math.sin(a), math.cos(a)            # lid normal (up)
    return (hxx + ux * CUP_R - nx * 0.012, hy + uy * CUP_R - ny * 0.012)
FULL_STICK_DEG = 33.0
cup = lid_cup(FULL_STICK_DEG)
PROP_LEN = math.hypot(cup[0] - PROP_BASE[0], cup[1] - PROP_BASE[1])
print('prop length %.3f, cup (%.3f, %.3f), lean %.1f deg' % (PROP_LEN, cup[0], cup[1],
      math.degrees(math.atan2(PROP_BASE[0] - cup[0], cup[1] - PROP_BASE[1]))))
# far-edge height at full stick
far = max(math.hypot(px - LID['hingeAxis']['x'], 0) for px, pz in outline)
print('lid far-edge top at full stick %.3f' % (LID['hingeAxis']['y'] + far * math.sin(math.radians(FULL_STICK_DEG)) + 0.012))

# ------------------------------------------------------------------------------------------------ emit JSON
def polyjson(g):
    gs = g.geoms if hasattr(g, 'geoms') else [g]
    out = []
    for gg in gs:
        if gg.geom_type != 'Polygon' or gg.area < 1e-5:
            continue
        out.append(dict(outer=[[r4(a), r4(b)] for a, b in np.array(gg.exterior.coords)[:-1]],
                        holes=[[[r4(a), r4(b)] for a, b in np.array(h.coords)[:-1]] for h in gg.interiors]))
    return out

notes = []
for k, st in zip(keys, strings):
    n = st['n']
    d = np.array(st['dir'])
    notes.append(dict(
        n=n, note=st['name'], midi=k['midi'], key_color=k['color'], key_x=k['x_center'],
        strings=st['nstr'], wound=st['wound'], wire_d_mm=st['d_mm'], core_d_mm=st['core_mm'],
        speaking_length=r4(st['L']), strike_from_front=r4(st['xH']), angle_deg=r4(st['theta']), dir_xz=[r5(d[0]), r5(d[1])],
        hammer_x=r5(hx[n]), strike_xz=[r4(v) for v in st['strike']], front_xz=[r4(v) for v in st['front']],
        bridge_xz=[r4(v) for v in st['bridge']], hitch_xz=[r4(v) for v in st['hitch']], pin_xz=[r4(v) for v in st['pin']],
        front_termination=st['term'], damper=n <= 67, front_red_braid=n <= 76, rear_red_felt=n <= 45,
        bass_bridge=n <= 20,
    ))

layout = dict(
    _about=('Afterglow D-class concert grand layout (2.74 x 1.56 m). Metres. Piano frame: origin on the floor below '
            'the front-left case corner; x right (bass->treble), z away from the player (toward the tail), y up. '
            'Generated by tools/piano/gen_layout_d.py; derivations in research/piano.md and docs/PIANO.md.'),
    pianoClass='D', caseWidth=CASE_W, caseLength=r4(case_poly.bounds[3]), rimThickness=RIM,
    heights=dict(floor=0, casterAxle=0.030, pedalTread=0.090, keybedBottom=0.625, keybedTop=0.6695, keySlipTop=0.702,
                 balanceAxis=0.686, whiteTop=0.715, blackTop=0.7275, fallboardRollTop=0.790, rimBottom=0.712,
                 soundboardEdge=0.815, soundboardCenter=0.823, plate=Y_PLATE, longBridgeTop=Y_LONG_BRIDGE_TOP,
                 tenorStrings=Y_TENOR, bassAgraffe=Y_BASS_AGRAFFE, bassBridgeTop=Y_BASS_BRIDGE, hitch=Y_HITCH,
                 strutTop=0.892, capoTop=0.900, damperTop=0.897, tuningPinTop=0.882, rimTop=1.000, lidClosedTop=1.024),
    caseOutline=[[r4(a), r4(b)] for a, b in outline],
    caseOutlineKeyPoints=[[a, b] for a, b in OUTLINE_KEY],
    innerRim=[[r4(a), r4(b)] for a, b in inner_ring[:-1]],
    keyboard=dict(left=r5(KB_LEFT), right=r5(KB_RIGHT), center=r5(KB_CENTER), whitePitch=WP, octave=7 * WP,
                  cheekBlocks=dict(leftX=[RIM, r5(KB_LEFT - 0.001)], rightX=[r5(KB_RIGHT + 0.0035), r5(CASE_W - RIM)],   # >= 3 mm: the una corda shifts the keys 2.5 mm toward the treble
                                   z=[0.0, 0.172], topY=0.738),
                  keySlip=dict(x=[RIM, r5(CASE_W - RIM)], y=[0.660, 0.702], z=[0.0, 0.020]),
                  fallboardOpen=dict(faceZ=0.172, y=[0.729, 0.790], rollRadius=0.016, backZ=FALLBOARD_BACK_Z,
                                     x=[r5(KB_LEFT - 0.060), r5(KB_RIGHT + 0.060)]),
                  **KEY),
    keys=keys,
    action=dict(strikeLine=[[r5(STRIKE[0][0]), STRIKE[0][1]], [r5(STRIKE[1][0]), STRIKE[1][1]]],
                hammerPitch=r5(HPITCH), sections=SECT, blowDistance=0.046, flangeAhead=0.125, flangeY=0.765,
                strikeRotDeg=20.0, checkBelowString=0.016, dampedNotes=[1, 67], damperLiftKey=0.006, damperLiftPedal=0.008,
                damperBehindStrike=0.030),
    notes=notes,
    bellyRail=[list(BELLY[0]), list(BELLY[1])],
    soundboard=polyjson(soundboard),
    soundboardGrainDegFromX=r4(grain),
    ribs=ribs,
    braces=braces, braceHub=list(hub),
    longBridge=[[r4(a), r4(b)] for a, b in long_bridge],
    bassBridge=[[r4(a), r4(b)] for a, b in bass_bridge],
    plate=dict(polygons=polyjson(plate_cut), web=polyjson(web_cut), frontPlate=polyjson(front_plate_r),
               struts={k: dict(pts=[[r4(p[0]), r4(p[1])] for p in s['pts']], widths=[r4(w_) for w_ in s['w']], kind=STRUT_KIND[k],
                               bassOver=s['bassOver'], tenorUnder=s['tenorUnder'],
                               top=(0.898 if k.startswith('F') else 0.892), bottom=(0.871 if STRUT_KIND[k] == 'raised' else 0.846),
                               crossedBy=[h[0] for h in strut_cross[k]],
                               lowered=([min(h[1] for h in strut_cross[k]) - 0.02, max(h[2] for h in strut_cross[k]) + 0.02]
                                        if k.startswith('A') and strut_cross[k] else None))
                       for k, s in STRUTS.items()},
               hub=[r4(HUB[0]), r4(HUB[1])],
               holes=[list(h) for h in holes], slot=dict(center=list(SLOT['center']), size=list(SLOT['size']), angleDeg=SLOT['angleDeg']), holeD=HOLE_D, flangeOD=FLANGE_OD, flangeH=0.008, bolts=[list(b) for b in bolts],
               frontEdgeZ=PLATE_FRONT_Z, frontBackEdge=[[r4(a), r4(b)] for a, b in env],
               capo=[[r4(a), r4(b)] for a, b in capo_pts], pressureBar=[[r4(a), r4(b)] for a, b in press_pts],
               cartouche=dict(center=[1.300, 0.792], size=[0.200, 0.110], angleDeg=-28.0)),
    legs=LEGS, lyre=LYRE, bench=BENCH, lid=dict(**LID, fullStickDeg=FULL_STICK_DEG, cupR=CUP_R),
    prop=dict(base=[r4(v) for v in PROP_BASE], length=r4(PROP_LEN), baseW=0.030, topW=0.020, knobD=0.026),
    musicDesk=dict(x=[r5(KB_CENTER - 0.43), r5(KB_CENTER + 0.43)], height=0.270, thickness=0.018, tiltDeg=14,
                   bottomZY=[0.262, 1.000], ledge=dict(depth=0.040, thickness=0.012, lip=0.008)),
)
os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
with open(OUT_JSON, 'w') as fh:
    json.dump(layout, fh, separators=(',', ':'))
print('wrote', OUT_JSON, os.path.getsize(OUT_JSON) // 1024, 'KB')
print('total strings', sum(st['nstr'] for st in strings), 'tuning pins', sum(st['nstr'] for st in strings))

# ------------------------------------------------------------------------------------------------ plan check renders
if '--noplot' in sys.argv:
    sys.exit(0)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly


def draw(ax, alpha=1.0, lw_scale=1.0):
    def add(g, **kw):
        gs = g.geoms if hasattr(g, 'geoms') else [g]
        for gg in gs:
            if gg.geom_type != 'Polygon':
                continue
            ax.add_patch(MPoly(np.array(gg.exterior.coords), closed=True, **kw))
            for hole in gg.interiors:
                ax.add_patch(MPoly(np.array(hole.coords), closed=True, facecolor=kw.get('hole_fc', '#30343a') if False else (0.15, 0.17, 0.2, 0.55 * alpha), edgecolor=kw.get('edgecolor', 'none'), lw=kw.get('lw', 0.5)))
    add(case_poly, facecolor='none', edgecolor='#00ffff', lw=1.0 * lw_scale)
    add(inner_poly, facecolor='none', edgecolor='#00ffff', lw=0.6 * lw_scale, ls='--')
    add(plate_cut, facecolor=(0.85, 0.6, 0.2, 0.35 * alpha), edgecolor='#ff8800', lw=0.8 * lw_scale)
    for h in holes:
        ax.add_patch(plt.Circle(h, FLANGE_OD / 2, fill=False, ec='#ff00ff', lw=0.8 * lw_scale))
        ax.add_patch(plt.Circle(h, HOLE_D / 2, fill=False, ec='#ff00ff', lw=0.6 * lw_scale))
    for b_ in bolts:
        ax.add_patch(plt.Circle(b_, 0.01, color='#ffffff'))
    ax.plot(*np.array(long_bridge).T, color='#00ff00', lw=2 * lw_scale)
    ax.plot(*np.array(bass_bridge).T, color='#00ff00', lw=2.5 * lw_scale)
    ax.plot(*np.array([BELLY[0], BELLY[1]]).T, color='#ffff00', lw=0.8 * lw_scale)
    for st in strings:
        col = '#ff6040' if st['wound'] else '#e0e0ff'
        ax.plot([st['pin'][0], st['hitch'][0]], [st['pin'][1], st['hitch'][1]], color=col, lw=(0.6 if st['wound'] else 0.25) * lw_scale)
        if st['n'] <= 67:
            dp = st['strike'] + 0.030 * np.array(st['dir'])
            ax.add_patch(plt.Rectangle((dp[0] - 0.0058, dp[1] - 0.015), 0.0116, 0.030, color='#202020', alpha=0.8))
        ax.add_patch(plt.Circle(tuple(st['strike']), 0.003, color='#ff0000'))
    for k in keys:
        poly = np.array(k['top_xz'])
        ax.add_patch(MPoly(poly, closed=True, facecolor=('#f4f0e6' if k['color'] == 'white' else '#111'),
                           edgecolor='#888', lw=0.2, alpha=alpha))
    for e in LEGS['front'] + [LEGS['rear']]:
        ax.add_patch(plt.Rectangle((e[0] - 0.044, e[1] - 0.044), 0.088, 0.088, fill=False, ec='#00ffff', lw=0.8))


fig, ax = plt.subplots(figsize=(8, 13), dpi=110)
ax.set_aspect('equal'); ax.set_facecolor('#30343a')
draw(ax)
ax.set_xlim(-0.05, 1.62); ax.set_ylim(-0.05, 2.80)
ax.set_title('D-class plan check (x right, z toward tail)')
plt.savefig(os.path.join(OUT_DIR, 'plan_d.png'), bbox_inches='tight', facecolor='#30343a')
plt.close(fig)

# overlay on the INRIA photo (keyboard-aligned: x_i = x_p - 0.071, y_i = z_p - 0.660)
# im1.png (the INRIA RT-0425 top-view photo) is a local, unpublished input (licence unknown, gitignored): without it
# the layout and plan_d.png above are complete and only this check plot is skipped.
if not os.path.exists(os.path.join(HERE, 'im1.png')):
    print('plots saved (overlay skipped: tools/piano/im1.png not present)')
    sys.exit(0)
from PIL import Image
im = np.asarray(Image.open(os.path.join(HERE, 'im1.png')).convert('RGB'))
H_, W_ = im.shape[:2]
m = json.load(open(os.path.join(HERE, 'im1_map.json')))
bb = m['bbox']; O = m['O']; SXp = m['SX']; SYp = m['SY']
# image extent in piano coordinates
def px2p(px, py):
    X = bb[0] + px * (bb[2] - bb[0]) / W_; Y = bb[1] + py * (bb[3] - bb[1]) / H_
    xi = (X - O[0]) / SXp; yi = (O[1] - Y) / SYp
    return xi + 0.071, yi + 0.660
x_l, z_t = px2p(0, 0); x_r, z_b = px2p(W_, H_)
fig, ax = plt.subplots(figsize=(8, 13), dpi=130)
ax.imshow(im, extent=[x_l, x_r, z_b, z_t])
draw(ax, alpha=0.25, lw_scale=0.7)
ax.set_xlim(-0.1, 1.66); ax.set_ylim(-0.05, 2.82)
ax.set_title('D plan over INRIA Steinway D photo (keyboard-aligned)')
plt.savefig(os.path.join(OUT_DIR, 'plan_d_overlay.png'), bbox_inches='tight')
print('plots saved')
