"""Shared nail geometry helpers (hand_textures.py paints the nail, nails.py builds the plate: both use these).

The dorsal (nail) direction of each distal phalanx is measured from the mesh itself, not from the hand frame and not
from the drawn nail in the CC0 albedo (that detection is not mirror-consistent: R5 and L5 differed by 60 deg):
- first harmonic of the radial profile rho(theta) around the bone axis (the pulp bulges palmar, the bone lies dorsal),
- second harmonic (the distal phalanx is wider than it is thick: its minor axis is dorso-palmar),
averaged (the minor axis' sign taken toward the first harmonic). On this mesh both are exactly mirror-symmetric L/R.
The nail is then centred on the fingertip's silhouette seen along that direction, and its width is a fixed fraction of
the silhouette width (MakeHuman fingers are slimmer than the anthropometric nail widths assume)."""
import math
import numpy as np


def unit(v):
    return v / np.linalg.norm(v)


def raycast(POS, O, Dv, tris, far=False):
    """rays O (n,3) along Dv (3,) vs triangles (m,3) -> t (inf = miss), tri (n,3), u, v. far=True: farthest hit."""
    v0, v1, v2 = POS[tris[:, 0]], POS[tris[:, 1]], POS[tris[:, 2]]
    e1, e2 = v1 - v0, v2 - v0
    p = np.cross(Dv, e2); det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12; inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    tv = O[:, None, :] - v0[None]
    u = (tv * p[None]).sum(2) * inv[None]
    q = np.cross(tv, e1[None])
    v = (q * Dv[None, None]).sum(2) * inv[None]
    t = (q * e2[None]).sum(2) * inv[None]
    hit = ok[None] & (u >= -1e-6) & (v >= -1e-6) & (u + v <= 1 + 1e-6) & (t > 0)
    if far:
        tt = np.where(hit, t, -np.inf); k = np.argmax(tt, 1); tk = tt[np.arange(len(O)), k]; tk[~np.isfinite(tk)] = np.inf
    else:
        tt = np.where(hit, t, np.inf); k = np.argmin(tt, 1); tk = tt[np.arange(len(O)), k]
    r = np.arange(len(O))
    return tk, tris[k], u[r, k], v[r, k]


def finger_tris(POS, TRI, H3, d, smax, radius=25.0):
    cen = POS[TRI].mean(1)
    return TRI[np.linalg.norm(cen - (H3 + d * smax * 0.6), axis=1) < radius]


def dorsal_direction(POS, tris, H3, d, Dref, s_lo, s_hi, n_s=6, step_deg=5):
    """geometric nail direction (unit, perpendicular to d) and diagnostics"""
    d = unit(d); Dr = unit(Dref - d * (Dref @ d)); Sr = np.cross(d, Dr)
    th = np.radians(np.arange(0, 360, step_deg))
    dirs = np.cos(th)[:, None] * Dr[None] + np.sin(th)[:, None] * Sr[None]
    a1 = np.zeros(2); a2 = np.zeros(2)
    for s in np.linspace(s_lo, s_hi, n_s):
        rho = np.array([raycast(POS, (H3 + s * d)[None], dv, tris)[0][0] for dv in dirs])     # from inside: first hit
        ok = np.isfinite(rho)
        if ok.sum() < len(th) * 0.8: continue
        r = rho[ok] - rho[ok].mean(); tt = th[ok]
        a1 += [np.sum(r * np.cos(tt)), np.sum(r * np.sin(tt))]
        a2 += [np.sum(r * np.cos(2 * tt)), np.sum(r * np.sin(2 * tt))]
    h1 = math.atan2(-a1[1], -a1[0])                       # dorsal = opposite of the pulp (max radius)
    m2 = math.atan2(a2[1], a2[0]) / 2 + math.pi / 2         # minimum of the 2nd harmonic (two antipodal solutions)
    if math.cos(m2 - h1) < 0: m2 += math.pi
    ang = math.atan2(math.sin(h1) + math.sin(m2), math.cos(h1) + math.cos(m2))
    D = unit(math.cos(ang) * Dr + math.sin(ang) * Sr)
    return D, dict(harm1_deg=round(math.degrees(h1), 1), minor_deg=round(math.degrees(m2), 1), used_deg=round(math.degrees(ang), 1))


def silhouette(POS, tris, H3, d, D, s, half=12.0, step=0.25):
    """lateral extent (l along S = d x D) of the finger seen along -D at s"""
    S = np.cross(d, D)
    lt = np.arange(-half, half + 1e-9, step)
    O = H3[None] + s * d[None] + lt[:, None] * S[None] + 25.0 * D[None]
    t = raycast(POS, O, -D, tris)[0]
    hit = lt[np.isfinite(t)]
    return (float(hit.min()), float(hit.max())) if len(hit) else (0.0, 0.0)
