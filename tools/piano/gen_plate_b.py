"""Plate / soundboard / bridge geometry for the B-class layout + plan-view check render."""
import json, math
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly

SB = r'E:\experimentswithclaude\random\afterglow\sandbox\piano'
L = json.load(open(SB + r'\layout_b.json'))
outline = Polygon(L['outline'])
RIM = 0.060
inner = outline.buffer(-RIM, join_style=1, resolution=32)
S = L['strings']
P = lambda s, k: np.array(s[k])

# belly rail / soundboard front edge
BELLY = [(0.0, 0.575), (1.48, 0.490)]
def belly_z(x):
    return 0.575 + (0.490 - 0.575) * x / 1.48
big_back = Polygon([(-1, belly_z(-1)), (3, belly_z(3)), (3, 4), (-1, 4)])
soundboard = inner.intersection(big_back)

# front plate (pinblock cover): from z=0.255 to front-termination line + 0.012
front_pts = sorted([(s['front'][0], s['front'][1]) for s in S], key=lambda p: p[0])
# monotone envelope in x: max z (furthest back) of front points per x bin, then +0.012
xs = np.linspace(inner.bounds[0], inner.bounds[2], 60)
env = []
for x in xs:
    near = [p[1] for p in front_pts if abs(p[0] - x) < 0.05]
    zf = (max(near) if near else np.interp(x, [p[0] for p in front_pts], [p[1] for p in front_pts])) + 0.014
    env.append((x, zf))
fp = Polygon([(xs[0], 0.255), (xs[-1], 0.255)] + env[::-1])
front_plate = fp.intersection(inner)

# hitch band (tenor/treble): beyond hitch curve offset 0.03 toward bridge
def offset_pt(s, key, d):
    th = math.radians(s['theta']); dv = np.array([math.sin(th), math.cos(th)])
    return P(s, key) - d * dv
def band_edge(s):
    th = math.radians(s['theta']); dv = np.array([math.sin(th), math.cos(th)])
    return tuple(P(s, 'bridge') + 0.028 * dv)
hc = [band_edge(s) for s in S if s['n'] >= 21]
# extend: treble end to right rim, bass end to left rim
hc_poly = Polygon([(1.6, hc[-1][1]), (1.6, 3.0), (-0.5, 3.0), (-0.5, hc[0][1] + 0.10), (0.0, hc[0][1] + 0.02)] + hc)
hc_poly = hc_poly.buffer(0)
band = inner.intersection(hc_poly)
# bass window: hull of bass bridge zone (front by 0.07) up to bass hitch -0.03
bass = [s for s in S if s['n'] <= 20]
bw_pts = [tuple(offset_pt(s, 'bridge', 0.07)) for s in bass] + [tuple(offset_pt(s, 'hitch', 0.03)) for s in bass[::-1]]
bass_window = Polygon(bw_pts).buffer(0.012, join_style=1)
band = band.difference(bass_window)
# spine band along left rim
spine = Polygon([(inner.bounds[0], 0.255), (inner.bounds[0] + 0.045, 0.255), (inner.bounds[0] + 0.045, 2.2), (inner.bounds[0], 2.2)]).intersection(inner)
# struts (centre lines, widths)
struts = {
    'A_tenor_break_arm': ((0.405, 0.37), (0.205, 1.80), 0.034),
    'B_bass_break_arm': ((0.405, 0.37), (0.703, 1.43), 0.030),
    'C_strut_39_40': ((0.6615, 0.43), (0.650, 1.12), 0.026),
    'D_strut_57_58': ((0.9177, 0.47), (0.922, 0.76), 0.026),
    'E_strut_76_77': ((1.1823, 0.47), (1.184, 0.60), 0.024),
    'F_diagonal_cross_strut': ((0.43, 0.43), (1.02, 0.95), 0.024),
}
strut_polys = {k: LineString([a, b]).buffer(w / 2, cap_style=2) for k, (a, b, w) in struts.items()}
plate = unary_union([front_plate, band, spine] + list(strut_polys.values())).intersection(inner.buffer(-0.008))
print('plate area m2 %.3f  soundboard area m2 %.3f  inner area %.3f' % (plate.area, soundboard.area, inner.area))

# holes in band: candidates along band "medial" region = points far from band boundary
cand = []
minx, minz, maxx, maxz = band.bounds
for x in np.arange(minx, maxx, 0.01):
    for z in np.arange(minz, maxz, 0.01):
        p = Point(x, z)
        if band.contains(p):
            d = band.boundary.distance(p)
            if d > 0.065:
                cand.append((d, x, z))
cand.sort(reverse=True)
rear_segs = unary_union([LineString([tuple(s['bridge']), tuple(s['hitch'])]).buffer(0.008) for s in S])
holes = []
for d, x, z in cand:
    if all(math.hypot(x - hx, z - hz) > 0.17 for hx, hz in holes) and z < 1.95 and not Point(x, z).buffer(0.0525).intersects(rear_segs):
        holes.append((round(x, 3), round(z, 3)))
    if len(holes) >= 6:
        break
holes.sort(key=lambda h: h[1])
print('holes', holes)
# bolts: along band boundary inside by 0.03, every ~0.28 m + front plate
bolts = []
ring = inner.buffer(-0.035).exterior
Lr = ring.length
for t in np.arange(0, Lr, 0.26):
    p = ring.interpolate(t)
    if plate.buffer(-0.012).contains(p) and p.y > 0.30:
        bolts.append((round(p.x, 3), round(p.y, 3)))
for x, zf in ((0.405, 0.300), (0.6615, 0.300), (0.9177, 0.300), (1.1823, 0.300), (1.385, 0.290)):
    if plate.contains(Point(x, zf)):
        bolts.append((x, zf))
print('bolts', len(bolts), bolts)

# bridges: bass bridge and long bridge as polylines of unison centres
bass_bridge = [tuple(s['bridge']) for s in S if s['n'] <= 20]
long_bridge = [tuple(s['bridge']) for s in S if s['n'] >= 21]
lb = LineString(long_bridge); bb = LineString(bass_bridge)
print('long bridge length %.3f  bass bridge length %.3f' % (lb.length, bb.length))
# ribs: perpendicular to grain; grain parallel to long-bridge mean direction
v = np.array(long_bridge[-1]) - np.array(long_bridge[0]); ang = math.degrees(math.atan2(v[1], v[0]))
print('long bridge chord angle from +x (deg): %.1f' % ang)

json.dump(dict(belly=BELLY, soundboard=list(soundboard.exterior.coords), plate=[list(g.exterior.coords) for g in (plate.geoms if plate.geom_type == 'MultiPolygon' else [plate])],
               plate_interiors=[list(i.coords) for g in (plate.geoms if plate.geom_type == 'MultiPolygon' else [plate]) for i in g.interiors],
               struts={k: [list(a), list(b), w] for k, (a, b, w) in struts.items()}, holes=holes, bolts=bolts,
               bass_bridge=bass_bridge, long_bridge=long_bridge, front_plate_back_edge=env, hitch_band_edge=hc),
          open(SB + r'\plate_b.json', 'w'), indent=0)

# ------------------------------------------------------------------ render
fig, ax = plt.subplots(figsize=(8, 11.4), dpi=110)
ax.set_aspect('equal'); ax.set_facecolor('#3a3f47')
def add(poly, **kw):
    geoms = poly.geoms if hasattr(poly, 'geoms') else [poly]
    for g in geoms:
        ax.add_patch(MPoly(np.array(g.exterior.coords), closed=True, **kw))
        for hole in g.interiors:
            ax.add_patch(MPoly(np.array(hole.coords), closed=True, facecolor='#c9a066', edgecolor='none'))
add(outline, facecolor='#0b0b0d', edgecolor='#888', lw=0.6)
add(inner, facecolor='#2a2a2e', edgecolor='none')
add(soundboard, facecolor='#e8d2a8', edgecolor='none')
add(plate, facecolor='#c08a2a', edgecolor='#5a3a10', lw=0.6, alpha=0.97)
for hx_, hz_ in holes:
    ax.add_patch(plt.Circle((hx_, hz_), 0.0525, color='#a8823e')); ax.add_patch(plt.Circle((hx_, hz_), 0.0275, color='#1d1a16'))
for bx_, bz_ in bolts:
    ax.add_patch(plt.Circle((bx_, bz_), 0.009, color='#ddd'))
ax.plot(*np.array(long_bridge).T, color='#5a3b1c', lw=4.5, solid_capstyle='round')
ax.plot(*np.array(bass_bridge).T, color='#5a3b1c', lw=5.5, solid_capstyle='round')
for s in S:
    th = math.radians(s['theta']); dv = np.array([math.sin(th), math.cos(th)]); nv = np.array([dv[1], -dv[0]])
    k = s['nstr']; sp = 0.0039 if k == 3 else (0.0050 if k == 2 else 0)
    for i in range(k):
        off = (i - (k - 1) / 2) * sp * nv
        a = P(s, 'pin') + off; b = P(s, 'hitch') + off
        ax.plot([a[0], b[0]], [a[1], b[1]], color=('#c47a52' if s['wound'] else '#cfd3d8'), lw=(0.9 if s['wound'] else 0.35), zorder=5 if s['wound'] else 4)
    if s['n'] <= 67:
        dpt = P(s, 'strike') + 0.030 * dv
        ax.add_patch(plt.Rectangle((dpt[0] - 0.006, dpt[1] - 0.015), 0.012, 0.030, color='#111', zorder=6))
for k_ in L['keys']:
    if k_['color'] == 'white':
        ax.add_patch(plt.Rectangle((k_['x_center'] - 0.01125, 0.022), 0.0225, 0.150, facecolor='#ece8de', edgecolor='#999', lw=0.2, zorder=7))
for k_ in L['keys']:
    if k_['color'] == 'black':
        ax.add_patch(plt.Rectangle((k_['x_center'] - 0.00635, 0.073), 0.0127, 0.095, facecolor='#111', zorder=8))
for s in S:
    th = math.radians(s['theta']); dv = np.array([math.sin(th), math.cos(th)]); nv = np.array([dv[1], -dv[0]])
    k = s['nstr']; sp = 0.0039 if k == 3 else (0.0050 if k == 2 else 0)
    for i in range(k):
        row = i % 3 if k == 3 else (i % 2 if k == 2 else s['n'] % 2)
        pin = P(s, 'pin') - row * 0.018 * np.array([0, 1]) + (i - (k - 1) / 2) * 0.0045 * np.array([1, 0])
        ax.add_patch(plt.Circle(tuple(pin), 0.0035, color='#22262c', zorder=9))
    if s['n'] <= 52:
        ax.add_patch(plt.Circle(tuple(P(s, 'front')), 0.004, color='#e0b860', zorder=9))
ax.set_xlim(-0.05, 1.53); ax.set_ylim(-0.05, 2.16)
ax.set_title('B-class plan check (x right, z away from player)')
plt.savefig(SB + r'\plan_check.png', bbox_inches='tight', facecolor='#3a3f47')
ax.set_xlim(0.0, 0.8); ax.set_ylim(0.15, 0.75)
plt.savefig(SB + r'\plan_check_front.png', bbox_inches='tight', facecolor='#3a3f47')
print('saved')
