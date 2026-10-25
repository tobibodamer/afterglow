"""Anatomical hand forms shared by the GEOMETRY (p5_export.py, Blender's python: displacement of the subdivided hand
mesh) and the TEXTURES (hand_textures.py: vein tint, residual normal relief). numpy only; any right-handed frame, mm.

Fix round 1 (critic1:anatomy 'smooth rubber glove'; USER_FEEDBACK 3): the hands get real forms in the mesh, so they
shade and catch the glow rim like the refs (7, 12) instead of reading as uniform tubes:
- dorsal knuckle heads: MCP (metacarpal heads, ~1.4 mm), PIP (~0.9 mm), DIP (~0.5 mm) and the IP / MCP of the thumb,
  plus lateral condyle widening at PIP / DIP;
- waisting of the phalanx shafts between the joints (dorsal and lateral ~0.4 mm in), palmar pads slightly fuller;
- extensor tendons 2-5 (~0.65 mm cords converging toward the wrist) and the thumb's EPL;
- a seeded dorsal venous network (arch, intercapitular veins, cephalic / basilic, connectors) as broad soft cords
  (FWHM 4-7 mm, 0.35-0.75 mm high, tapered ends), the same polylines the albedo tints bluish.
Everything is a smooth function of the bind-pose position, so the geometry (vertex spacing ~1.2 mm at body subdivision 2)
resolves it; the normal map keeps only a small residual of it plus the fine relief (wrinkles, pores).
"""
import math
import numpy as np

SEED = 7

def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True); return v / np.maximum(n, 1e-12)
def perp(v, d):
    return unit(v - d * np.dot(v, d))
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def vnoise1(x, seed):
    """smooth 1-D value noise in [-1,1]"""
    x = np.asarray(x, np.float64)
    i = np.floor(x).astype(np.int64); f = x - i
    def h(k): return (((k * 374761393 + seed * 668265263) ^ ((k * 374761393 + seed * 668265263) >> 13)) * 1274126177 & 0xFFFF) / 32767.5 - 1
    u = f * f * (3 - 2 * f)
    return h(i) * (1 - u) + h(i + 1) * u
def seg_dist(Q, a, b):
    ab = b - a; t = np.clip(((Q - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(Q - (a + t[:, None] * ab), axis=1), t
def catmull(pts, n=24):
    pts = np.asarray(pts, float); out = []
    P_ = np.vstack([pts[0] * 2 - pts[1], pts, pts[-1] * 2 - pts[-2]])
    for i in range(1, len(P_) - 2):
        p0, p1, p2, p3 = P_[i - 1], P_[i], P_[i + 1], P_[i + 2]
        for t_ in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t_ * t_, t_ * t_ * t_
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t_ + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return np.array(out)
def polyline_dist(Q, poly):
    best = np.full(len(Q), 1e9); along = np.zeros(len(Q)); acc = 0.0
    for a, b in zip(poly[:-1], poly[1:]):
        dd, tt = seg_dist(Q, a, b)
        m = dd < best; best[m] = dd[m]; along[m] = acc + tt[m] * np.linalg.norm(b - a)
        acc += np.linalg.norm(b - a)
    return best, along / max(acc, 1e-6)

# ------------------------------------------------------------------ frames
def hand_frames(jpos, tip, side):
    """jpos(name) -> head (mm), tip(name) -> tail (mm); names like 'finger2-1_R'. Same construction as hand_textures."""
    s = side
    w = jpos(f'wrist_{s}'); m2, m3, m5 = jpos(f'finger2-1_{s}'), jpos(f'finger3-1_{s}'), jpos(f'finger5-1_{s}')
    fwd = unit(m3 - w); lat = perp(m5 - m2, fwd); n = unit(np.cross(fwd, lat))
    if np.dot(tip(f'finger3-3_{s}') - m3, n) < 0: n = -n                   # palmar
    fl = {}
    for f in range(1, 6):
        heads = [jpos(f'finger{f}-{j}_{s}') for j in (1, 2, 3)]
        tp = tip(f'finger{f}-3_{s}')
        pts = heads + [tp]
        dirs = [unit(pts[k + 1] - pts[k]) for k in range(3)]
        if f == 1:
            dors = []
            for k, d in enumerate(dirs):
                t2 = perp(m5 - pts[k], d)
                dors.append(perp(-t2 * 0.75 - n * 0.45, d))
        else:
            a = unit(np.cross(fwd, n))
            dors = [perp(np.cross(d, perp(a, d)), d) for d in dirs]
        prox = jpos(f'metacarpal{f - 1}_{s}') if f > 1 else None
        fl[f] = dict(heads=heads, tip=tp, dirs=dirs, dors=dors, prox=prox)
    return dict(w=w, fwd=fwd, lat=lat, n=n, fingers=fl)

def joints_of(hf, f):
    """[(kind, J, d_prox, d_dist, D_prox, D_dist)] for finger f (thumb: TMCP = finger1-2 head, TIP = finger1-3 head)"""
    F = hf['fingers'][f]
    if f == 1:
        return [('TMCP', F['heads'][1], F['dirs'][0], F['dirs'][1], F['dors'][0], F['dors'][1]),
                ('TIP', F['heads'][2], F['dirs'][1], F['dirs'][2], F['dors'][1], F['dors'][2])]
    dmc = unit(F['heads'][0] - F['prox'])
    return [('MCP', F['heads'][0], dmc, F['dirs'][0], F['dors'][0], F['dors'][0]),
            ('PIP', F['heads'][1], F['dirs'][0], F['dirs'][1], F['dors'][0], F['dors'][1]),
            ('DIP', F['heads'][2], F['dirs'][1], F['dirs'][2], F['dors'][1], F['dors'][2])]

# ------------------------------------------------------------------ finger forms
# (dorsal bump mm, sigma along mm, angular sigma rad, centre offset along mm (- = proximal), condyle widening mm)
KNUCKLE = {'MCP': (1.45, 5.2, 0.62, -2.6, 0.0), 'PIP': (0.95, 3.6, 0.78, -0.8, 0.38), 'DIP': (0.55, 2.7, 0.85, -0.4, 0.22),
           'TMCP': (0.85, 4.2, 0.80, -1.0, 0.25), 'TIP': (0.55, 3.0, 0.85, -0.4, 0.20)}
WAIST = {0: (0.45, 0.28), 1: (0.36, 0.22)}      # phalanx k: (dorsal/lateral inward mm, palmar pad mm); distal: none

def finger_forms(P, GW, hf, gsuffix=''):
    """P (n,3) mm; GW(name) -> (n,) weights of the group 'finger2-1' etc. Returns the normal displacement (n,) mm."""
    disp = np.zeros(len(P))
    for f in range(1, 6):
        F = hf['fingers'][f]
        member = GW(f'finger{f}-1') + GW(f'finger{f}-2') + GW(f'finger{f}-3')
        if f > 1: member = member + GW(f'metacarpal{f - 1}') * 0.9
        else: member = member + GW('metacarpal1') * 0.5
        for kind, J, dp, dd, Dp, Dd in joints_of(hf, f):
            dav = unit(dp + dd); Dav = perp(Dp + Dd, dav); Sav = np.cross(dav, Dav)
            q = P - J; sx = q @ dav
            near = (np.abs(sx) < 16) & (member > 0.15)
            if not near.any(): continue
            qn = q[near]; sxn = sx[near]
            r = qn - sxn[:, None] * dav[None]
            phi = np.arctan2(r @ Sav, r @ Dav)
            amp, ss, sp, s0, cw = KNUCKLE[kind]
            g_along = np.exp(-((sxn - s0) ** 2) / (2 * ss ** 2))
            bump = amp * g_along * np.exp(-(phi ** 2) / (2 * sp ** 2))
            cond = cw * g_along * np.sin(phi) ** 2 * (np.abs(phi) < 2.4)
            disp[near] += (bump + cond) * np.clip(member[near], 0, 1)
        # waisting of the proximal / middle phalanx shafts
        for k in (0, 1):
            h0, h1 = F['heads'][k], F['heads'][k + 1]; d = F['dirs'][k]; D = F['dors'][k]; S = np.cross(d, D)
            Lk = float(np.linalg.norm(h1 - h0))
            q = P - h0; t = (q @ d) / max(Lk, 1e-6)
            w = GW(f'finger{f}-{k + 1}')
            sel = (t > 0) & (t < 1) & (w > 0.2)
            if not sel.any(): continue
            qn = q[sel]; r = qn - (qn @ d)[:, None] * d[None]
            phi = np.arctan2(r @ S, r @ D)
            dorsal_lat = smoothstep(-0.35, 0.35, np.cos(phi) + 0.6)          # dorsal + lateral, not the palmar pad
            palmar = smoothstep(0.2, 0.8, -np.cos(phi))
            inward, pad = WAIST[k]
            prof = np.sin(np.pi * t[sel]) ** 2
            disp[sel] += (-inward * dorsal_lat + pad * palmar) * prof * np.clip(w[sel], 0, 1)
    return disp

# ------------------------------------------------------------------ dorsum: tendons + veins
def vein_network(hf, side, seed=SEED):
    """seeded dorsal venous network in hand-plane coordinates (X lat, Y fwd) mm: [(polyline, FWHM mm, height mm, taper ends)]"""
    w, lat, fwd = hf['w'], hf['lat'], hf['fwd']
    srng = np.random.default_rng(seed + (1 if side == 'R' else 2))
    K = {f: np.array([(hf['fingers'][f]['heads'][0] - w) @ lat, (hf['fingers'][f]['heads'][0] - w) @ fwd]) for f in range(2, 6)}
    T1 = np.array([(hf['fingers'][1]['heads'][1] - w) @ lat, (hf['fingers'][1]['heads'][1] - w) @ fwd])
    j = lambda sc: srng.normal(0, sc)
    ym = np.mean([K[f][1] for f in range(2, 6)])
    arch_y = 0.50 * ym + j(3)
    xr, xu = K[2][0] - 13 + j(2), K[5][0] + 10 + j(2)
    arch = catmull([[xu, arch_y - 6 + j(2)], [K[5][0] + j(2), arch_y + j(2)], [(K[4][0] + K[3][0]) / 2 + j(3), arch_y + 5 + j(3)],
                    [K[2][0] + j(2), arch_y + 2 + j(2)], [xr, arch_y - 8 + j(2)]])
    veins = [(arch, 5.6, 0.62, (0, 0))]
    for k in (2, 3, 4):
        web = (K[k] + K[k + 1]) / 2 + np.array([j(1.5), -6 + j(1.5)])
        mid = np.array([web[0] + j(3), (web[1] + arch_y) / 2 + j(3)])
        end = np.array([web[0] + j(5), arch_y + 3])
        veins.append((catmull([web, mid, end]), 4.2, 0.42, (1, 0)))
    webt = (T1 + K[2]) / 2 + np.array([j(2), -2 + j(2)])
    veins.append((catmull([webt, [(webt[0] + xr) / 2 + j(2), (webt[1] + arch_y) / 2 + j(2)], [xr, arch_y - 8]]), 4.4, 0.45, (1, 0)))
    veins.append((catmull([[xr, arch_y - 8], [xr - 3 + j(2), 0.25 * ym + j(2)], [xr - 4 + j(2), -25]]), 6.6, 0.75, (0, 0)))   # cephalic
    veins.append((catmull([[xu, arch_y - 6], [xu + 1 + j(2), 0.25 * ym + j(2)], [xu - 2 + j(2), -25]]), 6.2, 0.68, (0, 0)))   # basilic
    for _ in range(3):                                                    # small oblique connectors
        p0 = arch[srng.integers(len(arch))]; p1 = p0 + np.array([j(9), -abs(j(10)) - 8])
        veins.append((catmull([p0, (p0 + p1) / 2 + np.array([j(2), j(2)]), p1]), 3.6, 0.34, (0, 1)))
    return dict(K=K, T1=T1, ym=ym, arch_y=arch_y, veins=veins)

def dorsum_forms(P, N, hf, PALM_W, LOWER_W, side, seed=SEED):
    """height fields (mm) of the extensor tendons and the veins on the back of the hand, and the vein tint mask.
    Returns ids (indices into P of the dorsum region), tendon (len ids), vein (len ids), vmask (len ids), stats."""
    w, fwd, lat, n = hf['w'], hf['fwd'], hf['lat'], hf['n']
    dors_face = -(N @ n)
    region = ((PALM_W + LOWER_W) > 0.45) & (dors_face > 0.05)
    ids = np.nonzero(region)[0]
    Q = np.stack([(P[ids] - w) @ lat, (P[ids] - w) @ fwd], -1)
    net = vein_network(hf, side, seed)
    K, T1, ym = net['K'], net['T1'], net['ym']
    face = smoothstep(0.05, 0.45, dors_face[ids])
    wrist_fade = smoothstep(-9.0, 2.0, Q[:, 1])           # nothing under the shirt cuff (it ends ~12 mm proximal)
    xc = np.mean([K[f][0] for f in range(2, 6)])
    th = np.zeros(len(ids))
    for f in range(2, 6):
        a = K[f] + np.array([0, -5.0]); b = np.array([xc + (K[f][0] - xc) * 0.35, 2.0])
        dd, tt = seg_dist(Q, a, b)
        amp = 0.68 if f < 5 else 0.48
        th = np.maximum(th, amp * np.exp(-(dd / 2.3) ** 2) * smoothstep(0.0, 0.25, 1 - tt) * smoothstep(0.0, 0.5, tt + 0.1) * smoothstep(-6, 12, Q[:, 1]))
    a = T1; b = np.array([K[2][0] - 14.0, -4.0])
    dd, tt = seg_dist(Q, a, b)
    th = np.maximum(th, 0.78 * np.exp(-(dd / 2.1) ** 2) * smoothstep(0.0, 0.15, 1 - tt) * smoothstep(-8, 6, Q[:, 1]))
    vh = np.zeros(len(ids)); vm = np.zeros(len(ids))
    knuckle_fade = smoothstep(ym - 4, ym - 14, Q[:, 1])
    for vi, (poly, fwhm, amp, taper) in enumerate(net['veins']):
        seg = np.linalg.norm(np.diff(poly, axis=0), axis=1); arc = np.concatenate([[0], np.cumsum(seg)])
        tang = np.gradient(poly, axis=0); tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
        nrm2 = np.stack([-tang[:, 1], tang[:, 0]], -1)
        poly = poly + nrm2 * (1.6 * vnoise1(arc / 9.0 + vi * 17.3, 90 + vi))[:, None]
        dd, al = polyline_dist(Q, poly)
        wv = fwhm * (0.85 + 0.3 * (vnoise1(al * 5.0 + vi * 3.1, 120 + vi) * 0.5 + 0.5))
        x = dd / (0.5 * wv)                                  # 1 at the half-maximum radius
        prof = np.exp(-0.6931 * x * x)                       # gaussian with exactly that FWHM: broad, soft, no edge
        avar = amp * (0.75 + 0.25 * (vnoise1(al * 3.0 + vi * 5.7, 140 + vi) * 0.5 + 0.5))
        tap = (smoothstep(0.0, 0.18, al) if taper[0] else 1.0) * (smoothstep(0.0, 0.18, 1 - al) if taper[1] else 1.0)
        hv = avar * prof * knuckle_fade * tap
        vh = np.maximum(vh, hv); vm = np.maximum(vm, np.exp(-0.6931 * (dd / (0.65 * wv)) ** 2) * knuckle_fade * tap)
    return dict(ids=ids, tendon=th * face * wrist_fade, vein=vh * face * wrist_fade, vmask=vm * face, face=face,
                stats=dict(dorsum_n=int(len(ids)), vein_n=int((vh > 0.1).sum()), tendon_n=int((th > 0.1).sum()),
                           arch_y_mm=round(float(net['arch_y']), 1)))
