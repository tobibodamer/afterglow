"""Suit normal map: garment seams and fabric unevenness for the near-black wool (the CC0 proxy has no normal map).

  python -I suit_textures.py <pianist_raw.glb> <out_dir> [--size 4096]

The proxy's UV islands are its pattern pieces, so island borders are the garment's seams and hems. Per texel: distance to
the nearest island border (in mm, from the suit's measured texel density) -> height profile: a narrow seam groove on the
line, the pressed seam-allowance ridge a few mm in, a faint topstitch line at ~6 mm; plus low-amplitude cloth
unevenness. Written as a glTF-convention tangent-space normal map (suit_normal.png) for 'pianist_suit'.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
from PIL import Image
from glbio import GLB

argv = sys.argv[1:]
src, out = argv[0], argv[1]
S = int(argv[argv.index('--size') + 1]) if '--size' in argv else 4096
os.makedirs(out, exist_ok=True)
g = GLB(src)
prims = [p for _, p in g.mesh_primitives('elegantsuit') if g.material_name(p) == 'pianist_suit']
assert prims, 'suit primitive not found'
P = []; UV = []; TRI = []; off = 0
for p in prims:
    pos = g.acc(p['attributes']['POSITION']).astype(np.float64) * 1000; uv = g.acc(p['attributes']['TEXCOORD_0']).astype(np.float64)
    t = g.acc(p['indices']).reshape(-1, 3).astype(np.int64)
    P.append(pos); UV.append(uv); TRI.append(t + off); off += len(pos)
P = np.concatenate(P); UV = np.concatenate(UV); TRI = np.concatenate(TRI)
# texel density (texels per mm at S) from area ratios
a3 = np.linalg.norm(np.cross(P[TRI[:, 1]] - P[TRI[:, 0]], P[TRI[:, 2]] - P[TRI[:, 0]]), axis=1) / 2
e1 = UV[TRI[:, 1]] - UV[TRI[:, 0]]; e2 = UV[TRI[:, 2]] - UV[TRI[:, 0]]
auv = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) / 2
ok = (a3 > 1e-6) & (auv > 1e-12)
tpm = float(np.sqrt(np.median(auv[ok] * S * S / a3[ok])))          # texels per mm
mm = 1.0 / tpm
# islands: union-find over triangles sharing a vertex with the same UV
key = {}
parent = np.arange(len(TRI))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
for ti, t in enumerate(TRI):
    for v in t:
        k = (round(P[v, 0], 2), round(P[v, 1], 2), round(P[v, 2], 2), round(UV[v, 0], 5), round(UV[v, 1], 5))
        if k in key:
            a, b = find(key[k]), find(ti)
            if a != b: parent[a] = b
        else:
            key[k] = ti
roots = np.array([find(i) for i in range(len(TRI))])
_, isl = np.unique(roots, return_inverse=True)
idimg = np.zeros((S, S), np.int32)                  # 0 = background, island k -> k + 1
for ti, t in enumerate(TRI):
    pts = np.round(UV[t] * S * 16).astype(np.int32)
    cv2.fillConvexPoly(idimg, pts, int(isl[ti] + 1), lineType=cv2.LINE_8, shift=4)
# border pixels: island id differs from a 4-neighbour
b = np.zeros((S, S), bool)
b[:-1] |= idimg[:-1] != idimg[1:]; b[1:] |= idimg[1:] != idimg[:-1]
b[:, :-1] |= idimg[:, :-1] != idimg[:, 1:]; b[:, 1:] |= idimg[:, 1:] != idimg[:, :-1]
inside = idimg > 0
d = cv2.distanceTransform((~b).astype(np.uint8), cv2.DIST_L2, 5) * mm      # mm to the nearest seam/hem line
rng = np.random.default_rng(11)
H = (-0.30 * np.exp(-(d / 0.55) ** 2) + 0.20 * np.exp(-((d - 3.0) / 1.5) ** 2) + 0.035 * np.exp(-((d - 6.0) / 0.3) ** 2))
noise = cv2.GaussianBlur(rng.standard_normal((S, S)).astype(np.float32), (0, 0), 3.0 * tpm)
noise /= noise.std() + 1e-6

# ---- compression folds. The proxy's UVs were laid out on the standing rest mesh, so the UV->3-D Jacobian of the
# seated, simulated bind mesh measures the cloth's in-plane strain: where the minimum singular value is below the
# island's median scale the fabric is compressed (inner elbows, lap, behind the knees, the seated jacket skirt) and real
# wool buckles there into folds running PERPENDICULAR to the compression. The frozen cloth is proxy-resolution (1-2 cm
# triangles), so those folds are added here as normal-map relief: oriented noise elongated along the fold direction,
# amplitude from the compression. Deterministic (seeded).
Ej = np.stack([P[TRI[:, 1]] - P[TRI[:, 0]], P[TRI[:, 2]] - P[TRI[:, 0]]], -1)              # mm
Dj = np.stack([e1, e2], -1)                                                                   # uv
okj = np.abs(Dj[:, 0, 0] * Dj[:, 1, 1] - Dj[:, 0, 1] * Dj[:, 1, 0]) > 1e-12
Jm = np.zeros((len(TRI), 3, 2)); Jm[okj] = Ej[okj] @ np.linalg.inv(Dj[okj])
_, sv, Vt = np.linalg.svd(Jm)                                                                 # Vt rows: uv directions
geo = np.sqrt(sv[:, 0] * sv[:, 1])
s0 = np.ones(len(TRI))
for k in range(isl.max() + 1):
    m = (isl == k) & okj
    if m.any(): s0[isl == k] = np.median(geo[m])
comp = np.clip((1 - sv[:, 1] / s0 - 0.10) / 0.35, 0, 1) * okj      # ignore < 10 % (the unwrap's own distortion)                                # 0..1
cdir = Vt[:, 1, :]                                                                            # compression direction (uv)
RS = 2048; ks = RS / S
cimg = np.zeros((RS, RS, 3), np.float32)                                                      # (c, c cos2t, c sin2t)
for ti, t in enumerate(TRI):
    if comp[ti] <= 0: continue
    a2 = 2 * math.atan2(cdir[ti, 1], cdir[ti, 0])
    pts = np.round(UV[t] * RS * 16).astype(np.int32)
    cv2.fillConvexPoly(cimg, pts, (float(comp[ti]), float(comp[ti] * math.cos(a2)), float(comp[ti] * math.sin(a2))), lineType=cv2.LINE_8, shift=4)
tpm2 = tpm * ks
cimg = cv2.GaussianBlur(cimg, (0, 0), 9.0 * tpm2)                                             # smooth fields (~9 mm)
cmag = cimg[..., 0]
fold_ang = 0.5 * np.arctan2(cimg[..., 2], cimg[..., 1]) + math.pi / 2                         # folds run across the compression
FOLD_LEN, FOLD_HW = 50.0, 10.0          # mm: few broad soft folds (wool), not creases
NO = 12; white = np.random.default_rng(12).standard_normal((RS, RS)).astype(np.float32)
resp = []
for k in range(NO):
    a = math.pi * k / NO
    L, Wd = FOLD_LEN * tpm2, FOLD_HW * tpm2                                                    # fold length / half-width (px)
    kh = int(3 * L) | 1; c0 = kh // 2
    yy, xx = np.mgrid[-c0:c0 + 1, -c0:c0 + 1].astype(np.float32)
    u_ = xx * math.cos(a) + yy * math.sin(a); v_ = -xx * math.sin(a) + yy * math.cos(a)
    ker = np.exp(-(u_ / L) ** 2 - (v_ / Wd) ** 2); ker -= ker.mean(); ker /= np.sqrt((ker ** 2).sum())
    resp.append(cv2.filter2D(white, -1, ker))
resp = np.stack(resp, -1)
fk = (fold_ang % math.pi) / (math.pi / NO); k0 = np.floor(fk).astype(int) % NO; k1 = (k0 + 1) % NO; tt = (fk - np.floor(fk)).astype(np.float32)
fold = np.take_along_axis(resp, k0[..., None], -1)[..., 0] * (1 - tt) + np.take_along_axis(resp, k1[..., None], -1)[..., 0] * tt
fold /= fold.std() + 1e-6
fold = np.tanh(0.9 * fold)                                                                    # rounded crests
FOLD_MM = float(argv[argv.index('--fold-mm') + 1]) if '--fold-mm' in argv else 4.0   # fix round 1: 1.0 when p5 --suit-folds puts them in the geometry
fold_h = cv2.resize(FOLD_MM * fold * np.clip(cmag * 1.4, 0, 1), (S, S), interpolation=cv2.INTER_CUBIC)
fold_stats = dict(compressed_tri_frac=round(float((comp > 0.05).mean()), 3), comp_p95=round(float(np.percentile(comp, 95)), 3),
                  fold_mm=FOLD_MM, fold_length_mm=FOLD_LEN, fold_halfwidth_mm=FOLD_HW)
H = (H + 0.045 * noise + fold_h) * inside

# ---- buttons (session 3): the proxy's button discs are small UV islands (the 4 kissing sleeve buttons per sleeve are copies
# of one disc and share its UV). Each unique disc gets a horn-button relief instead of the seam/fold profile: dished face,
# raised rim, rounded edge, 4 sunk holes and a cross-stitched (X) thread with twist ridges. Heights are written in true mm
# (scaled by the disc's own texel density, ~8x the suit median). The disc list goes to suit_textures.json -> pack.mjs puts
# it in the suit material's extras -> the module shades the discs as glossy horn.
DISC_RELIEF = '--disc-relief' in argv      # default off since fix round 1 (scene/src/pianist/tailoring.js builds 3-D buttons)
isl_ext = np.zeros((isl.max() + 1, 3)); isl_lo = np.full((isl.max() + 1, 3), 1e9); isl_hi = np.full((isl.max() + 1, 3), -1e9)
uv_lo = np.full((isl.max() + 1, 2), 9.0); uv_hi = np.full((isl.max() + 1, 2), -9.0)
for k in range(3):
    np.minimum.at(isl_lo[:, k], np.repeat(isl, 3), P[TRI.ravel(), k]); np.maximum.at(isl_hi[:, k], np.repeat(isl, 3), P[TRI.ravel(), k])
for k in range(2):
    np.minimum.at(uv_lo[:, k], np.repeat(isl, 3), UV[TRI.ravel(), k]); np.maximum.at(uv_hi[:, k], np.repeat(isl, 3), UV[TRI.ravel(), k])
isl_ext = isl_hi - isl_lo
discs = {}
for k in range(isl.max() + 1):
    ext = isl_ext[k]; du, dv = uv_hi[k] - uv_lo[k]
    if ext.max() < 24.0 and ext.max() > 8.0 and 0.01 < du < 0.15 and 0.01 < dv < 0.15 and 0.6 < du / dv < 1.6:
        key_ = (round(uv_lo[k, 0], 3), round(uv_lo[k, 1], 3), round(uv_hi[k, 0], 3), round(uv_hi[k, 1], 3))
        discs.setdefault(key_, dict(isl=[], diam_mm=float(ext.max())))['isl'].append(k)
buttons = []
yy_, xx_ = np.mgrid[0:S, 0:S].astype(np.float32)
for key_, dsc in discs.items():
    u0_, v0_, u1_, v1_ = key_
    cx, cy = (u0_ + u1_) / 2 * S, (v0_ + v1_) / 2 * S; rx, ry = (u1_ - u0_) / 2 * S, (v1_ - v0_) / 2 * S
    x0_, x1_ = int(cx - rx) - 2, int(cx + rx) + 3; y0_, y1_ = int(cy - ry) - 2, int(cy + ry) + 3
    X = (xx_[y0_:y1_, x0_:x1_] - cx) / rx; Y = (yy_[y0_:y1_, x0_:x1_] - cy) / ry; r = np.sqrt(X * X + Y * Y)
    msk = np.isin(idimg[y0_:y1_, x0_:x1_], [k + 1 for k in dsc['isl']])
    hb = -0.25 * np.clip(1 - (r / 0.78) ** 2, 0, 1) + 0.30 * np.exp(-((r - 0.86) / 0.07) ** 2)
    hb -= 0.6 * np.clip((r - 0.93) / 0.07, 0, 1) ** 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            dh = np.sqrt((X - 0.2 * sx) ** 2 + (Y - 0.2 * sy) ** 2)
            hb -= 0.8 * np.clip(1 - (dh - 0.07) / 0.025, 0, 1)
    for j, (ax, ay) in enumerate(((1, 1), (1, -1))):                      # X stitch: two thread bundles hole to hole
        n_ = math.sqrt(ax * ax + ay * ay); tx, ty = ax / n_, ay / n_
        t_ = X * tx + Y * ty; dl = np.abs(-X * ty + Y * tx)
        along = np.clip(1 - (np.abs(t_) - 0.25) / 0.03, 0, 1)
        prof = np.sqrt(np.clip(1 - (dl / 0.042) ** 2, 0, 1)) * along * (0.88 + 0.12 * np.sin(t_ * 70.0))
        hb = np.maximum(hb, (0.40 - 0.06 * j) * prof - 0.05 * (1 - prof))
    tpm_b = rx / (dsc['diam_mm'] / 2)                                      # texels per mm on the disc
    if DISC_RELIEF:
        H[y0_:y1_, x0_:x1_] = np.where(msk, hb * (tpm_b / tpm), H[y0_:y1_, x0_:x1_])   # true mm slopes on the denser disc
    else:   # fix round 1: the module puts real 3-D horn buttons on the discs; the cloth under them stays plain fabric
        H[y0_:y1_, x0_:x1_] = np.where(msk, 0.045 * noise[y0_:y1_, x0_:x1_], H[y0_:y1_, x0_:x1_])
    buttons.append(dict(c=[round((u0_ + u1_) / 2, 5), round((v0_ + v1_) / 2, 5)], r=[round((u1_ - u0_) / 2, 5), round((v1_ - v0_) / 2, 5)],
                        copies=len(dsc['isl']), diam_mm=round(dsc['diam_mm'], 1), texels_per_mm=round(tpm_b, 1)))
print('[suit] buttons', buttons)
Hs = cv2.GaussianBlur(H.astype(np.float32), (0, 0), 0.7)
gx = cv2.Sobel(Hs, cv2.CV_32F, 1, 0, ksize=3) / 8.0 / mm
gy = cv2.Sobel(Hs, cv2.CV_32F, 0, 1, ksize=3) / 8.0 / mm
n = np.stack([-gx, gy, np.ones_like(gx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray((np.clip(n * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, 'suit_normal.png'))
Image.fromarray((np.clip(n * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(os.path.join(out, 'preview_suit_normal.png'))
rep = dict(size=S, texels_per_mm=round(tpm, 3), islands=int(isl.max() + 1), seam_px=int(b.sum()), triangles=int(len(TRI)), folds=fold_stats,
           buttons=buttons)
Image.fromarray((np.clip(cmag, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024)).save(os.path.join(out, 'preview_suit_compression.png'))
json.dump(rep, open(os.path.join(out, 'suit_textures.json'), 'w'), indent=1)
print('[suit]', rep)
