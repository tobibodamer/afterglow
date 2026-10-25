"""Hand texture set for the pianist (the #1 close-up asset): albedo, tangent-space normal and ORM maps for the
'pianist_skin_hand' material, generated procedurally from the GLB geometry itself.

  python -I hand_textures.py <pianist_raw.glb> <out_dir> [--seed 7]

Layout (p5_export.py): one W x H texture (4608 x 2304), the right hand's UV island scaled uniformly into the left square
and the left hand's into the right square (5.68x the 2048 skin atlas = 6.6 texels/mm). Every texel is rasterised from
the mesh: bind position, normal, skin weights -> anatomical coordinates per finger joint, nail, dorsum and palm. Content:
- albedo: the CC0 Aksel skin colours (upsampled, its drawn nails inpainted) x tone variation (redder knuckles and
  fingertips, lighter palm, darker creases, faint bluish veins, mottling) + nail plates (pink bed, lunula, white free
  edge, cuticle) + sparse fine dorsal hairs;
- height (mm) -> normal: dorsal knuckle wrinkles (PIP/DIP/IP strongest, MCP faint), palmar flexion creases, palm creases,
  extensor tendons, a seeded dorsal venous network (arch + intercapitular + cephalic/basilic), nail plate step, lateral
  and proximal nail folds, longitudinal nail ridges, oriented cross-hatched skin micro-relief and pores; blended with
  the upsampled Aksel normal map (its broad creases);
- ORM: R = cavity AO from the height field, G = roughness (skin 0.42-0.52, creases rougher, nail 0.2), B = nail mask
  (the three.js skin shader raises specular there; metallicFactor stays 0 so B never reads as metal elsewhere).
Normal map convention: glTF (+X = +u, +Y = image up). Deterministic (seeded numpy Generator).
Also writes preview crops (preview_*.png) and hand_textures.json (texel density, timings, per-feature stats).
"""
import sys, os, json, math, time, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
import cv2
from scipy import ndimage
from glbio import GLB
import nailgeo

T0 = time.time()
argv = sys.argv[1:]
SRC, OUT = argv[0], argv[1]
SEED = int(argv[argv.index('--seed') + 1]) if '--seed' in argv else 7
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(SEED)
LOG = {}
def log(k, v):
    LOG[k] = v; print(f'[hand] {k}: {v}', flush=True)

g = GLB(SRC)
side = json.load(open(SRC + '.json'))
W, H = side['hand_tex']['size']
LAY = side['hand_tex']['layout']
RS = W / 4608.0          # resolution scale vs the 4608-wide design: mm-scale kernels (sigmas in px) scale with it,
                         # the finest relief (pores, hatch, 0.6 px pre-blur) stays at texel scale -> finer detail
BONE_LEN = side['bone_lengths']

# ------------------------------------------------------------------ mesh
prims = g.mesh_primitives('body')
hand_p = [p for _, p in prims if g.material_name(p) == 'pianist_skin_hand'][0]
skin_p = [p for _, p in prims if g.material_name(p) == 'pianist_skin'][0]
body_node = [ni for ni, p in prims][0]
A = hand_p['attributes']
POS = g.acc(A['POSITION']).astype(np.float64) * 1000.0         # mm, bind (seated) pose, glTF frame
NRM = g.acc(A['NORMAL']).astype(np.float64)
UV = g.acc(A['TEXCOORD_0']).astype(np.float64)
JNT = g.acc(A['JOINTS_0']).astype(np.int32)
WGT = g.acc(A['WEIGHTS_0']).astype(np.float64)
TRI = g.acc(hand_p['indices']).reshape(-1, 3).astype(np.int64)
skin = g.js['skins'][g.nodes[body_node]['skin']]
JN = [g.nodes[j]['name'] for j in skin['joints']]
log('mesh', dict(verts=len(POS), tris=len(TRI)))

def tex_image(mat_index, key):
    m = g.js['materials'][mat_index]
    t = m['pbrMetallicRoughness'].get('baseColorTexture') if key == 'base' else m.get('normalTexture')
    if not t: return None
    b, mime = g.image_bytes(g.js['textures'][t['index']]['source'])
    return np.asarray(Image.open(io.BytesIO(b)).convert('RGB')).astype(np.float32) / 255.0
AKSEL = tex_image(skin_p['material'], 'base')
AKSEL_N = tex_image(skin_p['material'], 'normal')
log('aksel', dict(base=None if AKSEL is None else AKSEL.shape, normal=None if AKSEL_N is None else AKSEL_N.shape))

# ------------------------------------------------------------------ joints (bind world, mm)
def jpos(n): return g.world(g.node_index(n))[:3, 3] * 1000.0
def jrot(n):
    R = g.world(g.node_index(n))[:3, :3]; return R / np.linalg.norm(R, axis=0)
def unit(v): n = np.linalg.norm(v, axis=-1, keepdims=True); return v / np.maximum(n, 1e-12)
def perp(v, d): return unit(v - d * np.dot(v, d))
def tip(n): return jpos(n) + jrot(n)[:, 1] * BONE_LEN[n] * 1000.0

# ------------------------------------------------------------------ rasterise the hand islands
t = time.time()
px = UV[:, 0] * W; py = UV[:, 1] * H                 # glTF v runs down the image
TID = np.full((H, W), -1, np.int32)
BAR = np.zeros((H, W, 3), np.float32)
for ti, (i0, i1, i2) in enumerate(TRI):
    x0, y0, x1, y1, x2, y2 = px[i0], py[i0], px[i1], py[i1], px[i2], py[i2]
    d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(d) < 1e-9: continue
    xa, xb = int(math.floor(min(x0, x1, x2) - 0.5)), int(math.ceil(max(x0, x1, x2) - 0.5))
    ya, yb = int(math.floor(min(y0, y1, y2) - 0.5)), int(math.ceil(max(y0, y1, y2) - 0.5))
    xa, ya = max(xa, 0), max(ya, 0); xb, yb = min(xb, W - 1), min(yb, H - 1)
    if xb < xa or yb < ya: continue
    X, Y = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
    l0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / d
    l1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / d
    l2 = 1 - l0 - l1
    ins = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
    if not ins.any(): continue
    yy, xx = np.nonzero(ins)
    TID[ya + yy, xa + xx] = ti
    BAR[ya + yy, xa + xx] = np.stack([l0[ins], l1[ins], l2[ins]], -1)
VALID = TID >= 0
NV = int(VALID.sum())
log('raster', dict(valid_px=NV, seconds=round(time.time() - t, 1)))

vy, vx = np.nonzero(VALID)
tid = TID[vy, vx]; bar = BAR[vy, vx].astype(np.float64)
idx = TRI[tid]
P = (POS[idx] * bar[..., None]).sum(1)                     # mm
N = unit((NRM[idx] * bar[..., None]).sum(1))
RIGHT = vx < W // 2
# per-triangle Jacobian: pixel -> 3-D (mm per pixel), and its pseudo-inverse (3-D tangent -> pixel direction)
E = np.stack([POS[TRI[:, 1]] - POS[TRI[:, 0]], POS[TRI[:, 2]] - POS[TRI[:, 0]]], -1)          # (T,3,2)
D = np.stack([np.stack([px[TRI[:, 1]] - px[TRI[:, 0]], py[TRI[:, 1]] - py[TRI[:, 0]]], -1),
              np.stack([px[TRI[:, 2]] - px[TRI[:, 0]], py[TRI[:, 2]] - py[TRI[:, 0]]], -1)], -1)  # (T,2,2)
det = D[:, 0, 0] * D[:, 1, 1] - D[:, 0, 1] * D[:, 1, 0]
Dinv = np.zeros_like(D); ok = np.abs(det) > 1e-9
Dinv[ok] = np.linalg.inv(D[ok])
JAC = E @ Dinv                                                                                 # (T,3,2)
JTJ = np.transpose(JAC, (0, 2, 1)) @ JAC
PINV = np.zeros((len(TRI), 2, 3)); okj = np.abs(np.linalg.det(JTJ)) > 1e-12
PINV[okj] = np.linalg.inv(JTJ[okj]) @ np.transpose(JAC[okj], (0, 2, 1))
SU = np.linalg.norm(JAC[:, :, 0], axis=1)[tid]; SV = np.linalg.norm(JAC[:, :, 1], axis=1)[tid]   # mm per pixel
dens = 1.0 / np.sqrt(SU * SV)
log('texel_density_per_mm', dict(median=round(float(np.median(dens)), 2), p5=round(float(np.percentile(dens, 5)), 2),
                                  p95=round(float(np.percentile(dens, 95)), 2)))
def to_px_dir(t3):
    """3-D tangent directions (n,3) at the valid pixels -> unit pixel-space directions (n,2)."""
    v = np.einsum('nij,nj->ni', PINV[tid], t3)
    return unit(v)

# ------------------------------------------------------------------ weights -> bone groups
GROUPS = ['wrist', 'metacarpal1', 'metacarpal2', 'metacarpal3', 'metacarpal4'] + \
         [f'finger{f}-{j}' for f in range(1, 6) for j in (1, 2, 3)] + ['lowerarm']
gidx = {gname: k for k, gname in enumerate(GROUPS)}
jgroup = np.full(len(JN), -1, np.int32)
for k, n in enumerate(JN):
    base = n.rsplit('_', 1)[0]
    if base in gidx: jgroup[k] = gidx[base]
    elif base.startswith('lowerarm'): jgroup[k] = gidx['lowerarm']
VG = np.zeros((len(POS), len(GROUPS)))
for c in range(4):
    gg = jgroup[JNT[:, c]]; m = gg >= 0
    np.add.at(VG, (np.nonzero(m)[0], gg[m]), WGT[m, c])
GW = (VG[idx] * bar[..., None]).sum(1).astype(np.float32)          # (n, groups)
def gw(name): return GW[:, gidx[name]]
FINGER_W = np.stack([gw(f'finger{f}-1') + gw(f'finger{f}-2') + gw(f'finger{f}-3') for f in range(1, 6)], -1)
PALM_W = gw('wrist') + gw('metacarpal1') + gw('metacarpal2') + gw('metacarpal3') + gw('metacarpal4')

# ------------------------------------------------------------------ hand frames (shared with the geometry: handforms.py)
import handforms as HF
HANDS = {s: HF.hand_frames(jpos, tip, s) for s in ('R', 'L')}

# sanity: the mesh pixels of each side sit around that hand
for s, msk in (('R', RIGHT), ('L', ~RIGHT)):
    dmin = np.linalg.norm(P[msk].mean(0) - HANDS[s]['w'])
    assert dmin < 150, f'hand {s} pixels are {dmin:.0f} mm from the wrist: frame mismatch'

# ------------------------------------------------------------------ base colour / normal from the Aksel atlas
def atlas_uv_of_pixels(side_key, xs, ys):
    L = LAY[side_key]; k = L['px_per_atlas_uv']; ox, oy = L['offset_px']; u0, v0 = L['atlas_bbox'][0], L['atlas_bbox'][1]
    # p5: px = ox + (u - u0) k ; py_blender = oy + (v - v0) k with v up; image row = H - py_blender
    u = u0 + (xs - ox) / k
    vb = v0 + ((H - ys) - oy) / k
    return u, vb
def sample_atlas(img, u, vb):
    h, w = img.shape[:2]
    mx = (u * w - 0.5).astype(np.float32); my = ((1 - vb) * h - 0.5).astype(np.float32)
    n = len(mx); cols = 4096; rows = (n + cols - 1) // cols          # cv2.remap needs maps < 32767 px per side
    MX = np.zeros(rows * cols, np.float32); MY = np.zeros(rows * cols, np.float32); MX[:n] = mx; MY[:n] = my
    out = cv2.remap(img, MX.reshape(rows, cols), MY.reshape(rows, cols), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    return out.reshape(-1, img.shape[2])[:n]
BASE = np.zeros((NV, 3), np.float32); BASEN = np.zeros((NV, 3), np.float32)
for s, msk in (('R', RIGHT), ('L', ~RIGHT)):
    u, vb = atlas_uv_of_pixels(s, vx[msk] + 0.5, vy[msk] + 0.5)
    BASE[msk] = sample_atlas(AKSEL, u, vb)
    if AKSEL_N is not None: BASEN[msk] = sample_atlas(AKSEL_N, u, vb)
BASE = np.clip(BASE, 0, 1)

# ------------------------------------------------------------------ helpers
def img(vals, fill=0.0, dtype=np.float32):
    """scatter per-valid-pixel values into a full image"""
    if vals.ndim == 1:
        out = np.full((H, W), fill, dtype); out[vy, vx] = vals
    else:
        out = np.full((H, W, vals.shape[1]), fill, dtype); out[vy, vx] = vals
    return out
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def vnoise1(x, seed):
    """smooth 1-D value noise in [-1,1]"""
    i = np.floor(x).astype(np.int64); f = x - i
    def h(k): return (((k * 374761393 + seed * 668265263) ^ ((k * 374761393 + seed * 668265263) >> 13)) * 1274126177 & 0xFFFF) / 32767.5 - 1
    u = f * f * (3 - 2 * f)
    return h(i) * (1 - u) + h(i + 1) * u
def seg_dist(Q, a, b):
    ab = b - a; t = np.clip(((Q - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(Q - (a + t[:, None] * ab), axis=1), t

HGT = np.zeros(NV, np.float32)                 # height (mm): creases, wrinkles, folds, micro relief (-> AO cavities)
FORM = np.zeros(NV, np.float32)                # height (mm): raised forms (veins, tendons): normals only, never AO
AMUL = np.ones((NV, 3), np.float32)            # albedo multiplier
ROUGH = np.full(NV, 0.46, np.float32)
NAILM = np.zeros(NV, np.float32)               # nail plate mask
NAILCOL = np.zeros((NV, 3), np.float32); NAILA = np.zeros(NV, np.float32)
MICROW = np.ones(NV, np.float32)               # micro-relief weight
DORSAL_FING = np.zeros(NV, np.float32)         # dorsal side of the fingers (hair, micro)
stats = {}

# ------------------------------------------------------------------ joints: knuckle wrinkles, palmar creases, redness
_C2 = os.environ.get('AG_C2_TEX', '1') != '0'
_C2D, _C2T, _C2R, _C2A = (1.6, 1.3, 1.6, 0.14) if _C2 else (1.0, 1.0, 1.0, 0.09)
# cycle 3 round 2 (critic c3r2, USER_FEEDBACK 3: 'smooth silicone' - no knuckle wrinkle rings at 1080, no pores / fine lines;
# local dark structure S04 1.4 % vs ref 7 9.8 %): deeper knuckle clusters (x1.6 -> x2.2, thumb x1.3 -> x1.7) and a stronger
# crease albedo (14 -> 24 %), plus pore and skin-line tone in the albedo (below). AG_C3_TEX=0 = the cycle-2 maps.
_C3 = _C2 and os.environ.get('AG_C3_TEX', '1') != '0'
if _C3: _C2D, _C2T, _C2A = 2.2, 1.7, 0.24
JOINT_SPEC = {   # (dorsal lines n, spacing, depth, half-length, centre offset, curvature, redness) per joint kind
    # fix round 1: clusters of more, shallower, softer lines that FAN apart laterally and break up along their length
    # (critic: single 'knife-cut' grooves at the index MCP)
    # cycle 2 (critic c2r1: PIP/DIP/MCP wrinkles do not read at 1080p, fingers like a rubber glove; no redder knuckles):
    # cluster depth x1.6 (thumb x1.3), crease albedo darkening 9 -> 14 %, knuckle redness x1.6 (env AG_C2_TEX=0 restores)
    'MCP': (6, 1.35, 0.034 * _C2D, 7.5, -3.5, -0.010, 0.95 * _C2R),
    'PIP': (7, 1.0, 0.085 * _C2D, 7.0, 0.4, 0.022, 1.25 * _C2R),
    'DIP': (5, 0.85, 0.062 * _C2D, 5.5, 0.3, 0.028, 0.9 * _C2R),
    'TMCP': (5, 1.3, 0.045 * _C2T, 7.0, -1.0, 0.010, 0.85 * _C2R),
    'TIP': (6, 1.1, 0.085 * _C2T, 7.0, 0.3, 0.022, 1.1 * _C2R),
}
PALMAR_SPEC = {'MCP': ([15.5], 0.24, 8.5), 'PIP': ([-1.2, 0.9], 0.26, 8.0), 'DIP': ([0.0], 0.20, 7.0),
               'TMCP': ([-1.0, 1.0], 0.22, 8.0), 'TIP': ([0.0], 0.30, 8.0)}
for s, msk in (('R', RIGHT), ('L', ~RIGHT)):
    hf = HANDS[s]
    for f in range(1, 6):
        F = hf['fingers'][f]
        if f == 1:
            joints = [('TMCP', F['heads'][1], F['dirs'][0], F['dirs'][1], F['dors'][0], F['dors'][1]),
                      ('TIP', F['heads'][2], F['dirs'][1], F['dirs'][2], F['dors'][1], F['dors'][2])]
        else:
            dmc = unit(F['heads'][0] - F['prox'])
            joints = [('MCP', F['heads'][0], dmc, F['dirs'][0], F['dors'][0], F['dors'][0]),
                      ('PIP', F['heads'][1], F['dirs'][0], F['dirs'][1], F['dors'][0], F['dors'][1]),
                      ('DIP', F['heads'][2], F['dirs'][1], F['dirs'][2], F['dors'][1], F['dors'][2])]
        member = FINGER_W[:, f - 1] + (gw(f'metacarpal{f - 1}') * 0.9 if f > 1 else gw('metacarpal1') * 0.0)
        for kind, J, dp, dd, Dp, Dd in joints:
            dav = unit(dp + dd); Dav = perp(Dp + Dd, dav); Sav = np.cross(dav, Dav)
            q = P - J
            near = msk & (np.linalg.norm(q, axis=1) < 24) & (member > (0.25 if kind in ('MCP', 'TMCP') else 0.4))
            if not near.any(): continue
            qn = q[near]
            sx = qn @ dav; r = qn - sx[:, None] * dav[None]
            rho = np.linalg.norm(r, axis=1) + 1e-6
            cphi = (r @ Dav) / rho; phi = np.arctan2(r @ Sav, r @ Dav)
            l = phi * rho
            nL, sp, dep, hl, s0, cur, red = JOINT_SPEC[kind]
            dors = smoothstep(-0.1, 0.35, cphi)
            hsum = np.zeros(len(sx)); gsum = np.zeros(len(sx))
            cmax = (nL - 1) / 2
            for k in range(nL):
                c = k - cmax
                # fan: the spacing opens toward the sides of the knuckle; each line wanders and breaks into segments
                fanw = 1 + 0.45 * np.clip(np.abs(l) / hl, 0, 1.2)
                sk = s0 + c * sp * fanw + cur * l * l + 0.30 * vnoise1(l * 0.42 + 13.1 * k + f * 3.7, 11 + k)
                Lk = hl * (1 - 0.18 * abs(c) / max(cmax, 1)) * (1 + 0.18 * vnoise1(np.full(1, k * 5.3 + f + (0 if s == 'R' else 17)), 3)[0])
                l_off = 1.6 * vnoise1(np.full(1, k * 2.9 + f * 1.3 + (0 if s == 'R' else 7)), 5)[0]
                brk = np.clip(0.55 + 0.75 * vnoise1(l * 0.55 + k * 7.7 + f, 31 + k), 0, 1)          # broken lines
                ak = dep * (1 - 0.35 * abs(c) / max(cmax, 1)) * (0.7 + 0.3 * (vnoise1(l * 0.5 + k * 9.2, 21 + f) * 0.5 + 0.5)) * brk
                fade = 1 - smoothstep(Lk * 0.55, Lk, np.abs(l - l_off))
                wid = 0.40 + 0.08 * vnoise1(l * 0.3 + k, 61 + f)
                gr = np.exp(-((sx - sk) / wid) ** 2) * fade * dors
                hsum -= ak * gr; gsum = np.maximum(gsum, gr * (ak / dep))
            # knuckle skin is looser and slightly raised between the grooves
            pad = np.exp(-((sx - s0) ** 2 / (2 * (sp * nL / 2.2) ** 2) + l ** 2 / (2 * (hl * 0.6) ** 2))) * dors
            hsum += 0.035 * pad
            ids = np.nonzero(near)[0]
            HGT[ids] += hsum
            AMUL[ids] *= (1 - _C2A * gsum)[:, None] * np.array([1.0, 0.975, 0.97])[None] ** gsum[:, None]
            redb = np.exp(-((sx - s0) ** 2 / (2 * 5.0 ** 2) + l ** 2 / (2 * 6.5 ** 2))) * smoothstep(-0.2, 0.4, cphi) * red
            AMUL[ids] *= np.stack([1 - 0.025 * redb, 1 - 0.095 * redb, 1 - 0.11 * redb], -1)
            ROUGH[ids] += 0.06 * gsum
            MICROW[ids] += 0.6 * pad
            # palmar flexion creases
            pos_list, pdep, phl = PALMAR_SPEC[kind]
            # fix round 1 (l1 renders): the creases wrapped round to the lateral midline, where the rim light catches them
            # as thin dark 'cuts' across the thumb / finger sides -> they now fade out before the side and are wider/softer
            palm_side = smoothstep(0.35, 0.85, -cphi)
            pg = np.zeros(len(sx))
            for sc in pos_list:
                sk = sc + 0.012 * l * l * np.sign(sc + 1e-3) + 0.25 * vnoise1(l * 0.3 + sc * 7, 41 + f)
                fade = 1 - smoothstep(phl * 0.55, phl * 0.95, np.abs(l))
                gr = np.exp(-((sx - sk) / 0.6) ** 2) * fade * palm_side
                pg = np.maximum(pg, gr)
            HGT[ids] -= pdep * pg
            AMUL[ids] *= np.stack([1 - 0.06 * pg, 1 - 0.12 * pg, 1 - 0.12 * pg], -1)
            ROUGH[ids] += 0.05 * pg
            stats[f'{s}{f}{kind}'] = int(near.sum())

# ------------------------------------------------------------------ nails (+ detection of the drawn Aksel nails)
NAIL_W = {1: 13.6, 2: 10.6, 3: 11.4, 4: 10.8, 5: 9.0}     # performance.md 3.3
NAIL_L = {1: 12.0, 2: 10.4, 3: 11.2, 4: 10.8, 5: 8.8}
LUNULA = {1: 3.8, 2: 2.8, 3: 2.2, 4: 1.6, 5: 0.9}     # fix round 1: visible past the fold on the thumb and index
NAIL_BULGE = 0.75        # free edge convexity (mm at the centre)
NAIL_FRAC = 0.68          # nail width / fingertip width seen from the nail side (adult male ~0.65-0.7)
inpaint_mask = np.zeros(NV, bool)
nail_stats = {}
NAIL_FRAMES = []
lum = BASE @ np.array([0.3, 0.55, 0.15], np.float32)
sat = (BASE.max(1) - BASE.min(1)) / np.maximum(BASE.max(1), 1e-3)
for s, msk in (('R', RIGHT), ('L', ~RIGHT)):
    hf = HANDS[s]
    for f in range(1, 6):
        F = hf['fingers'][f]
        H3 = F['heads'][2]; d3 = F['dirs'][2]; D3 = F['dors'][2]
        q = P - H3; sx = q @ d3
        member = FINGER_W[:, f - 1]
        sel = msk & (member > 0.5) & (sx > -3) & (np.linalg.norm(q - sx[:, None] * d3, axis=1) < 16)
        ids = np.nonzero(sel)[0]
        smax = float(np.percentile(sx[ids], 99.7))
        # drawn nail in the Aksel albedo: bright, desaturated texels near the tip
        tipzone = ids[sx[ids] > smax - 16]
        med_l, med_s = np.median(lum[tipzone]), np.median(sat[tipzone])
        white = tipzone[(lum[tipzone] > med_l * 1.10) & (sat[tipzone] < med_s * 0.80)]
        D_used = D3; detected = False
        if len(white) > 40:
            c = P[white].mean(0) - H3; c = c - (c @ d3) * d3
            if np.linalg.norm(c) > 2:
                Dd = unit(c); ang = math.degrees(math.acos(np.clip(Dd @ D3, -1, 1)))
                if f == 1 or ang < 50:
                    D_used = Dd; detected = True
                nail_stats[f'{s}{f}_detect_deg'] = round(ang, 1)
        inpaint_mask[white] = True          # the drawn nail is painted out; its position is NOT used (not L/R consistent)
        # geometric nail frame (py/nailgeo.py): dorsal direction from the fingertip's own shape, centred on its silhouette
        s_fe = smax - 1.7; s_c = s_fe - NAIL_L[f]
        vmem = VG[:, gidx[f'finger{f}-3']] + VG[:, gidx[f'finger{f}-2']]
        ftris = nailgeo.finger_tris(POS, TRI[vmem[TRI].min(1) > 0.3], H3, d3, smax)
        D_used, dstat = nailgeo.dorsal_direction(POS, ftris, H3, d3, D3, s_c, s_fe - 1.5)
        S3 = np.cross(d3, D_used)
        lmin, lmax = nailgeo.silhouette(POS, ftris, H3, d3, D_used, 0.5 * (s_c + s_fe))
        l0 = 0.5 * (lmin + lmax); width = lmax - lmin
        H3 = H3 + l0 * S3                    # nail centre line = silhouette centre seen along D
        hw = min(NAIL_W[f] / 2, NAIL_FRAC * width / 2)
        nail_stats[f'{s}{f}_geo'] = dict(**dstat, width_mm=round(width, 2), centre_shift_mm=round(l0, 2), hw=round(hw, 2))
        q = P - H3
        r = q[ids] - sx[ids, None] * d3[None]
        rho = np.linalg.norm(r, axis=1) + 1e-6
        # PLANAR nail coordinates (l straight across, projection along -D): py/nails.py builds the plate with the same
        # projection, so the painted outline and the plate's tucked edges coincide
        l = r @ S3; cphi = (r @ D_used) / rho
        s_ = sx[ids]
        prox = s_c + 1.7 * np.clip(l / hw, -1.3, 1.3) ** 2
        dist = s_fe + NAIL_BULGE * (1 - np.clip(l / hw, -1, 1) ** 2)
        e = 0.22
        inside = smoothstep(-e, e, s_ - prox) * smoothstep(-e, e, dist - s_) * smoothstep(-e, e, hw - np.abs(l)) * (cphi > 0)
        sid = 0 if s == 'R' else 31
        lun = inside * smoothstep(-0.25, 0.25, 1 - ((s_ - prox) / max(LUNULA[f], 0.3) + (l / (0.78 * hw)) ** 2))
        # free edge: a thin, slightly uneven translucent rim (not an opaque white 'French tip' band)
        fe_line = dist - 0.55 - 0.18 * (vnoise1(l * 1.4 + f * 5.1 + sid, 83) * 0.5 + 0.5)
        free = inside * smoothstep(-0.18, 0.18, s_ - fe_line)
        cut = np.exp(-((s_ - prox) / 0.28) ** 2) * smoothstep(-0.4, 0.2, hw - np.abs(l)) * (cphi > 0)
        latg = np.exp(-((np.abs(l) - hw - 0.30) / 0.30) ** 2) * smoothstep(prox.min() - 1, prox.min() + 0.5, s_) * (s_ < dist + 0.3) * (cphi > -0.3)
        # rolled lateral nail fold: the skin rises over the plate edge instead of a hard step down
        latroll = np.exp(-((np.abs(l) - hw - 0.85) / 0.55) ** 2) * smoothstep(prox.min() - 1, prox.min() + 0.5, s_) * (s_ < dist - 0.5) * (cphi > -0.3)
        fold = np.exp(-((s_ - (prox - 0.9)) / 0.65) ** 2) * smoothstep(-1.5, 0.0, hw - np.abs(l)) * (cphi > 0)
        # irregular low-contrast longitudinal ridges (were a regular 0.55 mm sine 'barcode')
        ridges = (0.0065 * vnoise1(l / 0.42 + f * 11 + sid, 77) + 0.0045 * vnoise1(l / 0.19 + f * 5 + sid, 78)) * inside * (0.6 + 0.4 * smoothstep(prox + 1, prox + 4, s_))
        HGT[ids] += 0.03 * inside - 0.09 * latg + 0.07 * latroll - 0.10 * cut + 0.07 * fold + ridges     # the plate itself is geometry (nails.py)
        NAILM[ids] = np.maximum(NAILM[ids], inside)
        # plate colour (the plate mesh samples this paint): the bed seen through keratin, paler proximally and pinker
        # distally, with faint irregular longitudinal streaks; a visible lunula on the thumb / index; a thin pale cuticle
        # band on the plate's base; a faint onychodermal band; a thin uneven translucent free edge.
        t_bed = np.clip((s_ - prox) / np.maximum(dist - prox, 1e-3), 0, 1)
        bed_p = np.array([0.80, 0.65, 0.61]); bed_d = np.array([0.81, 0.57, 0.55])
        band_c = np.array([0.84, 0.67, 0.63]); lunc = np.array([0.91, 0.83, 0.80]); fec = np.array([0.86, 0.80, 0.73])
        cutc = np.array([0.88, 0.76, 0.72])
        streak = 1 + 0.022 * vnoise1(l * 1.7 + f * 7.1 + sid, 55) + 0.014 * vnoise1(l * 4.3 + f * 3.3 + sid, 56) \
                   + 0.012 * vnoise1(s_ * 0.6 + l * 0.9 + f, 57)
        band = smoothstep(dist - 2.0, dist - 0.8, s_) * (1 - free)
        col = (bed_p[None] * (1 - t_bed[:, None]) + bed_d[None] * t_bed[:, None]) * streak[:, None]
        col = col * (1 - 0.70 * lun[:, None]) + lunc[None] * 0.70 * lun[:, None]
        cutb = np.exp(-((s_ - prox - 0.30) / 0.28) ** 2) * inside
        col = col * (1 - 0.45 * cutb[:, None]) + cutc[None] * 0.45 * cutb[:, None]
        col = col * (1 - 0.22 * band[:, None]) + band_c[None] * 0.22 * band[:, None]
        col = col * (1 - free[:, None]) + fec[None] * free[:, None]
        NAILCOL[ids] = col
        NAILA[ids] = np.maximum(NAILA[ids], inside)
        ring = np.clip(np.exp(-((s_ - prox + 0.6) / 1.2) ** 2) * (np.abs(l) < hw + 1) + latg, 0, 1) * (1 - inside)
        AMUL[ids] *= np.stack([1 - 0.02 * ring, 1 - 0.10 * ring, 1 - 0.10 * ring], -1)
        AMUL[ids] *= (1 - 0.25 * cut * (1 - inside))[:, None]
        ROUGH[ids] = ROUGH[ids] * (1 - inside) + (0.20 + 0.10 * free) * inside + 0.08 * cut
        MICROW[ids] *= (1 - 0.9 * inside)
        # fingertip redness (last 9 mm), strongest on the pad
        tipr = smoothstep(smax - 10, smax - 2, s_) * (1 - inside) * (0.6 + 0.4 * smoothstep(0.2, -0.6, cphi))
        AMUL[ids] *= np.stack([1 - 0.01 * tipr, 1 - 0.11 * tipr, 1 - 0.12 * tipr], -1)
        ROUGH[ids] -= 0.05 * tipr * smoothstep(0.0, -0.5, cphi)
        nail_stats[f'{s}{f}'] = dict(detected=detected, px=int((inside > 0.5).sum()), fingertip_extent_mm=round(smax, 1))
        # the SAME frame and outline drive the nail plate geometry (py/nails.py), so paint and plate coincide
        NAIL_FRAMES.append(dict(side=s, finger=f, H3=H3.tolist(), d3=d3.tolist(), D=D_used.tolist(), S=S3.tolist(),
                                smax=smax, hw=hw, s_fe=s_fe, s_c=s_c, prox_curve=1.7, dist_bulge=NAIL_BULGE, lunula=LUNULA[f],
                                bones=[f'finger{f}-3_{s}', f'finger{f}-2_{s}']))
log('nails', nail_stats)
json.dump(dict(units='mm, glTF frame of the body mesh (bind = seated)', nails=NAIL_FRAMES),
          open(os.path.join(OUT, 'nail_frames.json'), 'w'), indent=1)
if '--nail-frames-only' in argv:
    print('[hand] nail frames written; exit (--nail-frames-only)'); sys.exit(0)

# ------------------------------------------------------------------ dorsum: tendons + veins; palm: creases
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
vein_stats = {}
GEO_FORMS = bool(side.get('hand_forms'))          # p5 displaced the mesh with the same forms (handforms.py)
FORM_RESIDUAL = 0.22 if GEO_FORMS else 1.0        # then the normal map keeps only a crisp residual of the cords
for s, msk in (('R', RIGHT), ('L', ~RIGHT)):
    hf = HANDS[s]; w, fwd, lat, n = hf['w'], hf['fwd'], hf['lat'], hf['n']
    sel_ids = np.nonzero(msk)[0]
    dr = HF.dorsum_forms(P[sel_ids], N[sel_ids], hf, PALM_W[sel_ids], gw('lowerarm')[sel_ids], s, seed=SEED)
    ids = sel_ids[dr['ids']]
    K = HF.vein_network(hf, s, SEED)['K']
    FORM[ids] += FORM_RESIDUAL * (dr['tendon'] + dr['vein'])
    # veins: bluish-grey tint of the blood seen through the skin, broad and soft like the cords (fix round 1)
    vm = dr['vmask']
    AMUL[ids] *= np.stack([1 - 0.075 * vm, 1 - 0.035 * vm, 1 + 0.045 * vm], -1)
    # tendons: skin stretched over them is a touch paler
    tm = np.clip(dr['tendon'] / 0.6, 0, 1)
    AMUL[ids] *= (1 + 0.025 * tm)[:, None]
    vein_stats[s] = dict(**dr['stats'], geometric=GEO_FORMS, residual=FORM_RESIDUAL)
    xc = np.mean([K[f][0] for f in range(2, 6)]); ym = np.mean([K[f][1] for f in range(2, 6)])
    # palm: lighter / pinker; main creases
    palm = msk & (PALM_W > 0.45) & ((N @ n) > 0.25)
    pid = np.nonzero(palm)[0]
    AMUL[pid] *= np.array([1.04, 0.985, 0.975])
    Qp = np.stack([(P[pid] - w) @ lat, (P[pid] - w) @ fwd], -1)
    creases = [catmull([[K[5][0] + 8, K[5][1] - 16], [K[4][0], K[4][1] - 15], [K[3][0] - 2, K[3][1] - 11], [(K[2][0] + K[3][0]) / 2, K[2][1] - 7]]),
               catmull([[K[2][0] - 10, K[2][1] - 24], [K[3][0], K[3][1] - 30], [K[5][0] + 2, K[5][1] - 36]]),
               catmull([[K[2][0] - 10, K[2][1] - 23], [K[2][0] - 15, ym * 0.45], [xc - 4, 6]])]
    pg = np.zeros(len(pid))
    for poly in creases:
        # fix round 1 (thumb-side close-ups showed them as thin dark 'ink' lines): wider, shallower, softer folds
        dd, _ = polyline_dist(Qp, poly); pg = np.maximum(pg, np.exp(-(dd / 1.15) ** 2))
    HGT[pid] -= 0.20 * pg
    AMUL[pid] *= np.stack([1 - 0.03 * pg, 1 - 0.06 * pg, 1 - 0.06 * pg], -1)     # creases read by shading, not ink
    MICROW[pid] *= 1.35
log('veins', vein_stats)

# ------------------------------------------------------------------ dorsal side of the fingers (for hairs / micro)
for s, msk in (('R', RIGHT), ('L', ~RIGHT)):
    hf = HANDS[s]
    for f in range(1, 6):
        F = hf['fingers'][f]
        for k in range(3):
            m = msk & (gw(f'finger{f}-{k + 1}') > 0.5)
            if not m.any(): continue
            r = P[m] - F['heads'][k]; r = r - (r @ F['dirs'][k])[:, None] * F['dirs'][k][None]
            DORSAL_FING[m] = np.maximum(DORSAL_FING[m], smoothstep(0.0, 0.5, (unit(r) @ F['dors'][k])) * (1.0 if k == 0 else 0.25))

# ------------------------------------------------------------------ micro relief (pixel space, oriented by the finger axes)
t = time.time()
axis3 = np.zeros((NV, 3))
best = np.zeros(NV)
for s, msk in (('R', RIGHT), ('L', ~RIGHT)):
    hf = HANDS[s]
    axis3[msk] = hf['fwd']
    for f in range(1, 6):
        for k in range(3):
            wv = gw(f'finger{f}-{k + 1}') * msk
            m = wv > best
            axis3[m] = hf['fingers'][f]['dirs'][k]; best[m] = wv[m]
ang = np.arctan2(*to_px_dir(axis3)[:, ::-1].T)          # pixel-space angle of the local finger/hand axis
white = rng.standard_normal((H, W)).astype(np.float32)
NO = 12
resp = []
for k in range(NO):
    a = math.pi * k / NO
    ks = 17; c = ks // 2
    yy, xx = np.mgrid[-c:c + 1, -c:c + 1].astype(np.float32)
    u = xx * math.cos(a) + yy * math.sin(a); v = -xx * math.sin(a) + yy * math.cos(a)
    ker = np.exp(-(u / 4.5) ** 2 - (v / 0.75) ** 2); ker -= ker.mean(); ker /= np.abs(ker).sum()
    resp.append(cv2.filter2D(white, -1, ker)[vy, vx])
resp = np.stack(resp, -1)
def oriented(theta):
    fk = (theta % math.pi) / (math.pi / NO); k0 = np.floor(fk).astype(int) % NO; k1 = (k0 + 1) % NO; tt = fk - np.floor(fk)
    return resp[np.arange(NV), k0] * (1 - tt) + resp[np.arange(NV), k1] * tt
hatch = oriented(ang + math.radians(38)) + oriented(ang - math.radians(38))
hatch = hatch / (np.std(hatch) + 1e-6)
pores_img = (rng.random((H, W)) > 1.0 - 0.018 / RS ** 1.5).astype(np.float32)   # a bit denser, finer pores at higher res
pores = cv2.GaussianBlur(pores_img, (0, 0), 0.7)[vy, vx]; pores /= max(pores.max(), 1e-6)
mid = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 5.0 * RS)[vy, vx]; mid /= np.std(mid) + 1e-6
low = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 28.0 * RS)[vy, vx]; low /= np.std(low) + 1e-6
HGT += MICROW * (0.013 * hatch - 0.034 * pores + 0.006 * mid) + 0.022 * low     # fix round 1: less hatch / mid (orange-peel / sandpaper grain in 4K rim light)
if _C3:
    # cycle 3 r2: the albedo carried no pore / line tone at all (the de-blotch closing removes < 1.6 mm features): pores darker
    # and a little redder (~10 % at the centre), the rhomboid skin-line grooves (hatch < 0) a few % darker, a 1-2 mm tone grain
    _pt = np.clip(pores, 0, 1) * MICROW.clip(0, 1.6)
    _ln = np.clip(-hatch, 0, 2.5) / 2.5 * MICROW.clip(0, 1.6)
    AMUL *= np.stack([1 - 0.08 * _pt - 0.035 * _ln, 1 - 0.11 * _pt - 0.05 * _ln, 1 - 0.10 * _pt - 0.05 * _ln], -1).astype(np.float32)
    # (test10 = 0.035: 2-4 mm dark blotches read as dirt in the S24 x3 crop, sandbox/pianist/stills/c3r2b_1080/an_tex_ab_x3.png)
    AMUL *= (1 + float(os.environ.get('AG_C3_MID', '0.015')) * np.clip(mid, -2.5, 2.5))[:, None].astype(np.float32)
    log('c3_tone', dict(pore_mean=round(float(_pt.mean()), 4), line_mean=round(float(_ln.mean()), 4)))
log('micro_seconds', round(time.time() - t, 1))

# ------------------------------------------------------------------ fine dorsal hairs (sparse, faint)
t = time.time()
hair_layer = np.zeros((H, W), np.float32)
NN = np.where(RIGHT[:, None], HANDS['R']['n'][None], HANDS['L']['n'][None])
cand = np.nonzero(((PALM_W > 0.5) & (-(N * NN).sum(-1) > 0.35)) | (DORSAL_FING > 0.6))[0]
nh = min(700, len(cand) // 2500)
pick = rng.choice(cand, size=nh, replace=False)
for i in pick:
    s = 'R' if RIGHT[i] else 'L'; hf = HANDS[s]
    d3 = axis3[i] * 0.85 + hf['lat'] * 0.35 * (1 if s == 'R' else 1)     # distal and toward the ulnar side
    v = PINV[tid[i]] @ d3; v = v / (np.linalg.norm(v) + 1e-9)
    Lmm = rng.uniform(2.5, 5.0); Lpx = Lmm / ((SU[i] + SV[i]) / 2)
    x0, y0 = vx[i] + 0.5, vy[i] + 0.5
    bend = rng.uniform(-0.25, 0.25)
    pts = []
    for tq in np.linspace(0, 1, 6):
        ang_ = bend * tq
        rv = np.array([v[0] * math.cos(ang_) - v[1] * math.sin(ang_), v[0] * math.sin(ang_) + v[1] * math.cos(ang_)])
        pts.append((x0 + rv[0] * Lpx * tq, y0 + rv[1] * Lpx * tq))
    pts = np.array(pts) * 16
    cv2.polylines(hair_layer, [pts.astype(np.int32)], False, float(rng.uniform(0.25, 0.6)), thickness=1, lineType=cv2.LINE_AA, shift=4)
hair_layer = np.minimum(hair_layer, 1.0)[vy, vx] * VALID[vy, vx]
AMUL *= (1 - 0.06 * hair_layer)[:, None]          # faint: single-texel strokes read as cuts when magnified
ROUGH += 0.02 * hair_layer
log('hairs', dict(count=int(nh), seconds=round(time.time() - t, 1)))

# ------------------------------------------------------------------ tone: mottling
mot = np.stack([cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 40.0 * RS)[vy, vx] for _ in range(2)], -1)
mot /= mot.std(0) + 1e-6
AMUL *= np.stack([1 + 0.012 * mot[:, 0], 1 - 0.022 * mot[:, 0] + 0.01 * mot[:, 1], 1 - 0.022 * mot[:, 0] + 0.008 * mot[:, 1]], -1)

# ------------------------------------------------------------------ inpaint the drawn Aksel nails, compose albedo
base8 = (img(BASE) * 255).clip(0, 255).astype(np.uint8)
im_mask = img(inpaint_mask.astype(np.float32)) > 0
_dk = int(round(9 * RS)) | 1
im_mask = cv2.dilate(im_mask.astype(np.uint8), np.ones((_dk, _dk), np.uint8))
# restrict inpainting sources to the island: fill the gutter first with nearest valid colours
dist_idx = ndimage.distance_transform_edt(~VALID, return_distances=False, return_indices=True)
base8 = base8[dist_idx[0], dist_idx[1]]
base8 = cv2.inpaint(base8, im_mask, int(round(6 * RS)), cv2.INPAINT_TELEA)
# de-blotch: the 5.7x upsampled CC0 albedo carries 5-20 mm grey-green blotches on the dorsum (read as dirt/bruises in
# macro shots): keep its tone (luminance contrast reduced to 60 % in log) but take the chroma from a blurred copy
bf = base8.astype(np.float32) / 255.0
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)
smb = cv2.GaussianBlur(bf, (0, 0), 45.0 * RS)
ratio = (bf @ LW + 2e-3) / (smb @ LW + 2e-3)
# fix round 1 (thumb-side close-ups): the CC0 atlas has thin dark crease lines drawn in (palm, thumb web, finger sides),
# upsampled to sharp reddish 'ink' lines; a grey closing (~1.6 mm) removes dark features narrower than that (the
# procedural creases replace them) and keeps the broader tone variation
_ck = int(round(1.6 * float(np.median(dens)))) | 1
ratio = cv2.morphologyEx(ratio.astype(np.float32), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (_ck, _ck)))
ratio = cv2.GaussianBlur(ratio, (0, 0), 0.25 * _ck)
# fix round 1 (4K macro: grey 'dirt' patches on the dorsum): the 3-15 mm luminance blotches of the atlas are flattened
# harder (^0.3) than the fine tone detail below ~3 mm (^0.6)
_rl = cv2.GaussianBlur(ratio, (0, 0), 3.0 * float(np.median(dens)))
ratio = (_rl ** 0.5) * (ratio / np.maximum(_rl, 1e-3))
BASE2 = np.clip(smb * (ratio ** 0.6)[..., None], 0, 1)[vy, vx]
ALB = np.clip(BASE2 * AMUL, 0, 1)
ALB = ALB * (1 - NAILA[:, None]) + NAILCOL * NAILA[:, None]

# ------------------------------------------------------------------ height -> normal (+ Aksel broad normals), AO
# fix round 2b (critic r2: the thin dark 'cut' lines on the thumb in S06 / S24 are isolated crease grooves, AO < 230;
# plus six isolated AO ticks 152-168 on the proximal phalanges): the thumb's non-palmar crease relief is softened (x0.4)
# and the AO gets a floor outside the palmar surface (thumb 0.92, dorsum / finger sides 0.84, palm unchanged 0.55)
_thumb = np.clip(FINGER_W[:, 0] * 1.5, 0, 1)
_palmar = smoothstep(0.15, 0.5, -(N * NN).sum(-1)) * (1 - _thumb)
HGT = HGT * (1 - 0.6 * _thumb * (1 - _palmar))
_aofloor = np.maximum(0.84 * (1 - _palmar) + 0.55 * _palmar, 0.92 * _thumb)
Himg = img(HGT + FORM)
Himg = Himg[dist_idx[0], dist_idx[1]]
Hs = cv2.GaussianBlur(Himg, (0, 0), 0.6)
Hc = cv2.GaussianBlur(img(HGT)[dist_idx[0], dist_idx[1]], (0, 0), 0.6)      # creases only (AO)
gx = cv2.Sobel(Hs, cv2.CV_32F, 1, 0, ksize=3) / 8.0
gy = cv2.Sobel(Hs, cv2.CV_32F, 0, 1, ksize=3) / 8.0
su = img(SU.astype(np.float32), 1.0)[dist_idx[0], dist_idx[1]]; sv = img(SV.astype(np.float32), 1.0)[dist_idx[0], dist_idx[1]]
nx = -gx / su; ny = gy / sv                          # +Y = image up = -row direction
nz = np.ones_like(nx)
nrm = np.stack([nx, ny, nz], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
if AKSEL_N is not None:
    an = img(BASEN * 2 - 1)[dist_idx[0], dist_idx[1]]
    nailw = cv2.GaussianBlur(img(NAILM), (0, 0), 6.0 * RS)[dist_idx[0], dist_idx[1]]
    k = (0.55 * (1 - 0.85 * np.clip(nailw * 2, 0, 1)))[..., None]
    nrm = np.concatenate([nrm[..., :2] + k * an[..., :2], nrm[..., 2:]], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
cav = Hc - cv2.GaussianBlur(Hc, (0, 0), 7.0 * RS)          # raised forms (veins/tendons) never darken their own flanks
AO = np.clip(1 + 2.2 * np.minimum(cav, 0.0), 0.55, 1.0)
AO = np.maximum(AO, cv2.GaussianBlur(img(_aofloor, 0.84)[dist_idx[0], dist_idx[1]], (0, 0), 2.0))
log('ao_floor', dict(thumb_px=int((img(_thumb) > 0.5).sum()), palmar_px=int((img(_palmar) > 0.5).sum()), ao_lt_230=float((AO < 230 / 255).mean())))

# ------------------------------------------------------------------ write
def fill(a):
    return a[dist_idx[0], dist_idx[1]]
alb_img = fill(img(ALB))
alb8 = (np.clip(alb_img, 0, 1) * 255 + 0.5).astype(np.uint8)
nrm8 = (np.clip(nrm * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)
rough_img = fill(img(np.clip(ROUGH, 0.15, 0.75)))
orm = np.stack([AO, rough_img, fill(img(NAILM))], -1)
orm8 = (np.clip(orm, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(alb8).save(os.path.join(OUT, 'hand_albedo.png'), optimize=False)
Image.fromarray(nrm8).save(os.path.join(OUT, 'hand_normal.png'), optimize=False)
Image.fromarray(orm8).save(os.path.join(OUT, 'hand_orm.png'), optimize=False)
# previews: right-hand overview + full-res crops around the index PIP/DIP dorsum and nail
Image.fromarray(alb8).resize((W // 4, H // 4), Image.LANCZOS).save(os.path.join(OUT, 'preview_albedo_quarter.png'))
Image.fromarray(nrm8).resize((W // 4, H // 4), Image.LANCZOS).save(os.path.join(OUT, 'preview_normal_quarter.png'))
def crop_at(p3, size=420, tag='x'):
    i = int(np.argmin(np.linalg.norm(P - p3, axis=1) + (~RIGHT) * 1e6))
    cx, cy = vx[i], vy[i]; x0, y0 = max(cx - size // 2, 0), max(cy - size // 2, 0)
    a = alb8[y0:y0 + size, x0:x0 + size]; b = nrm8[y0:y0 + size, x0:x0 + size]; c = orm8[y0:y0 + size, x0:x0 + size]
    Image.fromarray(np.concatenate([a, b, c], 1)).save(os.path.join(OUT, f'preview_crop_{tag}.png'))
F2 = HANDS['R']['fingers'][2]; F3 = HANDS['R']['fingers'][3]
crop_at(F2['heads'][1] - F2['dors'][1] * 8, tag='index_pip')
crop_at(F3['tip'] - F3['dirs'][2] * 8 - F3['dors'][2] * 6, tag='middle_nail')
crop_at((HANDS['R']['w'] + F3['heads'][0]) / 2 - HANDS['R']['n'] * 15, size=900, tag='dorsum')
LOG['seconds'] = round(time.time() - T0, 1)
LOG['size'] = [W, H]
json.dump(LOG, open(os.path.join(OUT, 'hand_textures.json'), 'w'), indent=1)
print('[hand] done in', LOG['seconds'], 's')
