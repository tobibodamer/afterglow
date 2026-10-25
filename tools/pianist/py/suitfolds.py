"""Compression folds of the suit as GEOMETRY (fix round 1, USER_FEEDBACK 2: "real folds and creases at the elbow and the
inside of the arm"). numpy only, so Blender's bundled Python (p5_export.py) can run it.

The proxy's UVs were laid out on the standing rest mesh, so the UV->3-D Jacobian of the seated, cloth-simulated bind mesh
measures the in-plane strain: where the smaller singular value is below the island's median scale the wool is
compressed (inner elbow, inside of the arm, lap, behind the knees) and buckles into folds running PERPENDICULAR to the
compression. Same model as py/suit_textures.py (which used it for the normal map), here evaluated on a coarse UV grid
(FFT convolutions) and sampled back at the vertices -> displacement along the vertex normal:
  fold(uv) = tanh(0.9 * oriented_noise(uv)) in [-1, 1], oriented along the local fold direction (12 orientations,
             Gaussian 50 x 10 mm kernels on seeded white noise), amplitude x clip(1.4 * compression, 0, 1)
  disp = amp * fold, inward part limited to -0.35 amp (clearance to the arm / body under the cloth)
Deterministic (seeded noise, no simulation).

  disp_mm, stats = fold_displacement(P_mm, tris, uv_corner, amp_mm)
    P_mm (n, 3) vertex positions in mm, tris (m, 3) vertex indices, uv_corner (m, 3, 2) UV of each triangle corner
"""
import math
import numpy as np


def _islands(tris, uvc):
    m = len(tris)
    key = np.stack([tris.ravel(), np.round(uvc[..., 0].ravel() * 2e5), np.round(uvc[..., 1].ravel() * 2e5)], 1).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    par = np.arange(m)

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    first = {}
    tri_of = np.repeat(np.arange(m), 3)
    for c, k in enumerate(inv.tolist()):
        t = int(tri_of[c])
        if k in first:
            a, b = find(first[k]), find(t)
            if a != b:
                par[a] = b
        else:
            first[k] = t
    roots = np.array([find(i) for i in range(m)])
    _, isl = np.unique(roots, return_inverse=True)
    return isl.ravel()


def _gauss_fft(img, sigma_px):
    H, W = img.shape
    fy = np.fft.fftfreq(H)[:, None]; fx = np.fft.rfftfreq(W)[None, :]
    G = np.exp(-2 * (math.pi ** 2) * (sigma_px ** 2) * (fx ** 2 + fy ** 2))
    return np.fft.irfft2(np.fft.rfft2(img) * G, s=img.shape)


def fold_displacement(P, tris, uvc, amp_mm, RS=512, seed=12, fold_len=50.0, fold_hw=10.0, inward=0.35):
    P = np.asarray(P, np.float64); tris = np.asarray(tris, np.int64); uvc = np.asarray(uvc, np.float64)
    m = len(tris)
    E = np.stack([P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]]], -1)          # (m, 3, 2) mm
    e1 = uvc[:, 1] - uvc[:, 0]; e2 = uvc[:, 2] - uvc[:, 0]
    D = np.stack([e1, e2], -1)                                                                 # (m, 2, 2) uv
    det = D[:, 0, 0] * D[:, 1, 1] - D[:, 0, 1] * D[:, 1, 0]
    ok = np.abs(det) > 1e-12
    J = np.zeros((m, 3, 2)); J[ok] = E[ok] @ np.linalg.inv(D[ok])
    _, sv, Vt = np.linalg.svd(J)
    geo = np.sqrt(np.maximum(sv[:, 0] * sv[:, 1], 0))
    isl = _islands(tris, uvc)
    s0 = np.ones(m)
    for k in range(isl.max() + 1):
        mk = (isl == k) & ok
        if mk.any():
            s0[isl == k] = np.median(geo[mk])
    comp = np.clip((1 - sv[:, 1] / s0 - 0.10) / 0.35, 0, 1) * ok
    cdir = Vt[:, 1, :]
    # texel density of the grid: mm per uv unit (median of the triangle scale)
    mm_per_uv = float(np.median(geo[ok]))
    tpm = RS / mm_per_uv                                                                        # grid px per mm
    # splat (c, c cos2t, c sin2t) and the weight at each triangle's UV centroid, then normalised Gaussian blur (~9 mm)
    cen = uvc.mean(1)
    ix = np.clip((cen[:, 0] * RS).astype(int), 0, RS - 1); iy = np.clip((cen[:, 1] * RS).astype(int), 0, RS - 1)
    area = np.abs(det) * 0.5
    a2 = 2 * np.arctan2(cdir[:, 1], cdir[:, 0])
    acc = np.zeros((4, RS, RS))
    for ch, val in enumerate((comp * area, comp * np.cos(a2) * area, comp * np.sin(a2) * area, area * ok)):
        np.add.at(acc[ch], (iy, ix), val)
    sig = max(1.0, 9.0 * tpm)
    acc = np.stack([_gauss_fft(a, sig) for a in acc])
    wsum = np.maximum(acc[3], 1e-12)
    cmag = acc[0] / wsum; c2 = acc[1] / wsum; s2 = acc[2] / wsum
    fold_ang = 0.5 * np.arctan2(s2, c2) + math.pi / 2
    # oriented noise: 12 orientations of a 50 x 10 mm Gaussian (zero-mean, unit energy), FFT-convolved with white noise
    NO = 12
    white = np.random.default_rng(seed).standard_normal((RS, RS))
    Wf = np.fft.rfft2(white)
    L, Wd = fold_len * tpm, fold_hw * tpm
    yy = np.fft.fftfreq(RS)[:, None] * RS; xx = np.fft.fftfreq(RS)[None, :] * RS               # wrapped pixel offsets
    resp = []
    for k in range(NO):
        a = math.pi * k / NO
        u_ = xx * math.cos(a) + yy * math.sin(a); v_ = -xx * math.sin(a) + yy * math.cos(a)
        ker = np.exp(-(u_ / L) ** 2 - (v_ / Wd) ** 2); ker -= ker.mean(); ker /= np.sqrt((ker ** 2).sum())
        resp.append(np.fft.irfft2(Wf * np.fft.rfft2(ker), s=(RS, RS)))
    resp = np.stack(resp, -1)
    fk = (fold_ang % math.pi) / (math.pi / NO); k0 = np.floor(fk).astype(int) % NO; k1 = (k0 + 1) % NO; tt = fk - np.floor(fk)
    fold = np.take_along_axis(resp, k0[..., None], -1)[..., 0] * (1 - tt) + np.take_along_axis(resp, k1[..., None], -1)[..., 0] * tt
    fold /= fold.std() + 1e-9
    fold = np.tanh(0.9 * fold) * np.clip(cmag * 1.4, 0, 1)
    # bilinear sample at every corner, average per vertex (seam vertices get the mean of their islands)
    u = np.clip(uvc[..., 0].ravel() * RS - 0.5, 0, RS - 1.001); v = np.clip(uvc[..., 1].ravel() * RS - 0.5, 0, RS - 1.001)
    x0 = np.floor(u).astype(int); y0 = np.floor(v).astype(int); fx = u - x0; fy = v - y0
    x1 = np.minimum(x0 + 1, RS - 1); y1 = np.minimum(y0 + 1, RS - 1)
    f = (fold[y0, x0] * (1 - fx) * (1 - fy) + fold[y0, x1] * fx * (1 - fy) + fold[y1, x0] * (1 - fx) * fy + fold[y1, x1] * fx * fy)
    n = len(P)
    s = np.zeros(n); c = np.zeros(n)
    np.add.at(s, tris.ravel(), f); np.add.at(c, tris.ravel(), 1)
    fv = s / np.maximum(c, 1)
    disp = amp_mm * fv
    disp = np.maximum(disp, -inward * amp_mm)
    # tiny islands (the proxy's button discs, < 30 mm) must not be bent by the coarse, UV-blurred field: each moves
    # rigidly with the mean displacement of the cloth within 12 mm of its centre (so the 3-D buttons stay seated)
    vis = np.full(n, -1); vis[tris.ravel()] = np.repeat(isl, 3)
    tiny = []
    for k in range(isl.max() + 1):
        vk = np.nonzero(vis == k)[0]
        if len(vk) and (P[vk].max(0) - P[vk].min(0)).max() < 30.0:
            tiny.append(vk)
    if tiny:
        is_tiny = np.zeros(n, bool)
        for vk in tiny: is_tiny[vk] = True
        others = np.nonzero(~is_tiny)[0]
        for vk in tiny:
            c = P[vk].mean(0); d = np.linalg.norm(P[others] - c, axis=1); near = others[d < 12.0]
            if len(near) == 0: near = others[np.argsort(d)[:8]]
            disp[vk] = disp[near].mean()
    stats_tiny = len(tiny)
    stats = dict(amp_mm=amp_mm, grid=RS, px_per_mm=round(tpm, 3), islands=int(isl.max() + 1),
                 compressed_tri_frac=round(float((comp > 0.05).mean()), 3),
                 disp_mm_p01=round(float(np.percentile(disp, 1)), 3), disp_mm_p99=round(float(np.percentile(disp, 99)), 3),
                 moved_frac=round(float((np.abs(disp) > 0.2).mean()), 3), rigid_tiny_islands=stats_tiny)
    return disp, stats
