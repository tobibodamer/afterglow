"""Stage p3: wardrobe fixes + procedural hair and beard + export-ready materials, in the REST (A) pose.

  blender -b p1.blend --python p3_dress_groom.py -- <out_dir> [--hair N] [--beard N] [--strays N] [--seed S]

- Recoloured CC0 textures (near-black pinstripe suit, dark tie, black socks, black shoe lining) -> <out_dir>/tex/.
- Shirt cuffs: double-walled tubes (real thickness, rolled rim) that end 12.5 mm past the jacket sleeve.
- Hair: clumped helical strands grown from a scalp mask (ears found by thickness ray casts, so the hairline wraps them),
  smooth curls (points per curl turn >= ~10, low-frequency frizz), a few hundred thin stray curls at the envelope
  (they catch the rim light in silhouettes), pushed out of body+suit, ribbons (2 verts / point), rigid to the
  root's skin weights (head). Beard: short curly strands on a jaw/cheek/chin/upper-lip mask.
- Materials: plain Principled BSDF (glTF exporter maps them 1:1; the three.js module replaces them anyway).
All randomness from random.Random(seed): deterministic.
"""
import bpy, bmesh, sys, os, math, random, json, time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pianist_config as cfg

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
def opt(k, d, f=float):
    return f(argv[argv.index(k) + 1]) if k in argv else d
N_HAIR = opt('--hair', 6400, int)           # fix round 1: 2x the strands (was 3300), thinner ribbons
N_STRAY = opt('--strays', 70, int)           # was 180 (the frizz halo of the 'puff')
HAIR_W0 = opt('--hairw', 0.00115, float)     # ribbon width at the root (was 1.4 mm)
N_BEARD = opt('--beard', 6500, int)
PTS_PER_TURN = opt('--ppt', 10.0, float)     # hair points per curl turn (v11 had ~5.5 -> polygonal curls)
SEED = opt('--seed', 20261021, int)
# cycle 2 (critic c2r1, S16 'Lost profile': thin wire springs / corkscrew ringlets, polyline kinks at 4K, long front
# spirals; ref 9 = dense soft clumped curl mass). OPT-IN (defaults = the published run14 groom): strands per clump,
# curl radius / pitch scales (looser, larger curls), clump spread, no front strands below the brow line.
CLUMP_N = opt('--clump', 9, int)
RC_SCALE = opt('--rc-scale', 1.0, float)
PITCH_SCALE = opt('--pitch-scale', 1.0, float)
SPREAD_MM = opt('--spread-mm', 2.6, float)
BROW_CLIP = opt('--brow-clip', 0, int)
os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
t0 = time.time()
R = random.Random(SEED)

arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = [o for o in bpy.data.objects if o.name.endswith('.body')][0]
suit = [o for o in bpy.data.objects if 'elegantsuit' in o.name][0]
shoes = [o for o in bpy.data.objects if 'shoes' in o.name][0]
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='OBJECT')
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
deform = {b.name for b in arm.data.bones if b.use_deform}
# MPFB asset data directory (the CC0 MakeHuman packs installed into the Blender extension); AG_MPFB_DATA overrides it
DATA = os.environ.get('AG_MPFB_DATA') or r'E:\experimentswithclaude\tools\blender\blender-5.2.2-windows-x64\portable\extensions\.user\user_default\mpfb\data'

# ------------------------------------------------------------------ evaluated rest meshes
def rest_mesh(o, only_armature=True):
    saved = [(m, m.show_viewport) for m in o.modifiers]
    for m, _ in saved:
        if only_armature:
            m.show_viewport = (m.type == 'ARMATURE')
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg); me = ev.to_mesh()
    V = [o.matrix_world @ v.co for v in me.vertices]
    F = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    for m, s in saved:
        m.show_viewport = s
    return V, F

bV, bF = rest_mesh(body)
gi = {g.index: g.name for g in body.vertex_groups}
bW = []      # per body vertex: dict(deform bone -> weight)
real = []
for v in body.data.vertices:
    gs = {gi[g.group]: g.weight for g in v.groups}
    real.append(gs.get('body', 0) > 0)
    bW.append({k: w for k, w in gs.items() if k in deform and w > 1e-4})
dom = [max(w, key=w.get) if w else None for w in bW]
realF = [f for f in bF if all(real[i] for i in f)]
sV, sF = rest_mesh(suit)
# collision BVH: body (real faces) + suit
allV = bV + sV
allF = [tuple(i for i in f) for f in realF] + [tuple(i + len(bV) for i in f) for f in sF]
bvh_all = BVHTree.FromPolygons(allV, allF)
bvh_body = BVHTree.FromPolygons(bV, realF)

B = arm.data.bones
def bh(n): return arm.matrix_world @ B[n].head_local
def bt(n): return arm.matrix_world @ B[n].tail_local
EYE_Z = (bh('eye.L').z + bh('eye.R').z) / 2
EYE_Y = bh('eye.L').y
C = Vector((0.0, -0.058, EYE_Z + 0.01))       # head centre for azimuth / radial directions
LIP_TOP = bh('oris05').z + 0.004
LIP_BOT = bh('oris01').z - 0.006
print('[p3] eye z', round(EYE_Z, 4), 'lip', round(LIP_BOT, 4), round(LIP_TOP, 4))
headish = {'head', 'jaw', 'neck03'} | {b.name for b in B if b.parent and b.parent.name in ('head', 'jaw')}

def interp(x, xs, ys):
    if x <= xs[0]: return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + t * (ys[i] - ys[i - 1])
    return ys[-1]

def azim(p):  # 0 = back of head, 180 = face
    d = p - C
    return abs(math.degrees(math.atan2(d.x, d.y)))

# ---- ears: thin parts of the head. A ray from the skin inward (along -normal) hits the far side within ~10 mm only
# on the pinna (skull: > 10 cm). v11 excluded a 11.5 cm box around the ear, which left bare scalp behind/above it.
def vertex_normals(V, F, mask=None):
    N = [Vector() for _ in V]
    for f in F:
        n = (V[f[1]] - V[f[0]]).cross(V[f[2]] - V[f[0]])
        for i in f: N[i] += n
    return [n.normalized() if n.length > 1e-12 else Vector((0, 0, 1)) for n in N]
bN = vertex_normals(bV, realF)
EAR = [False] * len(bV)
for i in range(len(bV)):
    if not real[i] or dom[i] not in headish: continue
    p = bV[i]
    if abs(p.x) < 0.05 or not (EYE_Z - 0.07 < p.z < EYE_Z + 0.05): continue
    n = bN[i]
    hit = bvh_body.ray_cast(p - n * 0.0004, -n, 0.012)
    if hit[0] is not None: EAR[i] = True
_ear_pts = [bV[i] for i in range(len(bV)) if EAR[i]]
if _ear_pts:
    from mathutils.kdtree import KDTree
    _kd = KDTree(len(_ear_pts))
    for k, p in enumerate(_ear_pts): _kd.insert(p, k)
    _kd.balance()
    EAR_NEAR = [bool(real[i] and dom[i] in headish and abs(bV[i].x) > 0.045 and _kd.find(bV[i])[2] < 0.0035) for i in range(len(bV))]
else:
    EAR_NEAR = [False] * len(bV)
print('[p3] ear vertices', sum(EAR), 'with 3.5 mm margin', sum(EAR_NEAR))
if _ear_pts:
    _az = [abs(math.degrees(math.atan2((p - C).x, (p - C).y))) for p in _ear_pts]
    print('[p3] ear azimuth range', round(min(_az), 1), round(max(_az), 1), 'z rel eye', round(min(p.z for p in _ear_pts) - EYE_Z, 4),
          round(max(p.z for p in _ear_pts) - EYE_Z, 4))

def is_ear_i(i):
    return EAR_NEAR[i]

def scalp_ok(i):
    if not real[i] or dom[i] not in headish: return False
    p = bV[i]
    if is_ear_i(i): return False
    a = azim(p)
    # hairline height above eye level, by azimuth (0 back .. 180 front). Behind the ear the hairline runs down to
    # the mastoid (about ear-lobe level), above the ear it hugs the helix root (the ear itself is excluded above).
    h = interp(a, [0, 60, 80, 95, 108, 118, 128, 140, 160, 180], [-0.085, -0.078, -0.065, -0.05, -0.02, 0.02, 0.05, 0.064, 0.07, 0.072])
    # sideburns: a strip in front of the ear down to cheekbone level (meets the beard)
    if 104 < a < 132 and abs(p.x) > 0.055:
        h = min(h, -0.035)
    return p.z > EYE_Z + h

def beard_ok(i):
    if not real[i] or dom[i] is None: return False
    p = bV[i]
    if is_ear_i(i): return False
    if dom[i] not in headish and not dom[i].startswith('neck'): return False
    if p.y > -0.028: return False                          # not behind the jaw angle / back of neck
    ax = abs(p.x)
    top = interp(ax, [0.0, 0.012, 0.022, 0.032, 0.05, 0.062, 0.08], [EYE_Z - 0.042, EYE_Z - 0.046, EYE_Z - 0.052, EYE_Z - 0.052, EYE_Z - 0.036, EYE_Z - 0.026, EYE_Z - 0.022])
    if p.z > top: return False
    if ax < 0.027 and LIP_BOT < p.z < LIP_TOP and p.y < EYE_Y - 0.01: return False   # lips
    if p.z < EYE_Z - 0.135: return False                    # down to the upper neck
    if p.z < EYE_Z - 0.095 and p.y > -0.06: return False   # under-jaw only in front
    return True

def tri_sampler(mask):
    tris = []
    for f in realF:
        if all(mask[i] for i in f):
            for k in range(1, len(f) - 1):
                tris.append((f[0], f[k], f[k + 1]))
    A = np.array([((bV[b] - bV[a]).cross(bV[c] - bV[a])).length / 2 for a, b, c in tris])
    cum = np.cumsum(A) / A.sum()
    return tris, cum, float(A.sum())

def sample(tris, cum):
    t = tris[int(np.searchsorted(cum, R.random()))]
    u, v = R.random(), R.random()
    if u + v > 1: u, v = 1 - u, 1 - v
    a, b, c = (bV[i] for i in t)
    p = a + (b - a) * u + (c - a) * v
    n = (b - a).cross(c - a).normalized()
    if n.dot(p - C) < 0: n = -n
    w = {}
    for i, f in zip(t, (1 - u - v, u, v)):
        for k, x in bW[i].items():
            w[k] = w.get(k, 0) + x * f
    return p, n, w

def frame_of(t):
    a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
    u = t.cross(a).normalized(); v = t.cross(u).normalized()
    return u, v

def push_out(P, margin):
    out = []
    for p in P:
        loc, nrm, idx, dist = bvh_all.find_nearest(p, 0.05)
        if loc is not None:
            d = (p - loc)
            s = d.dot(nrm)
            if s < margin:
                p = loc + nrm * margin + (d - nrm * s)
        out.append(p)
    return out

def strands_to_mesh(name, strands, mat):
    """strands: list of dict(P=[Vector], W=[float widths], weights=dict, col=(r,g,b))"""
    verts, faces, uvs, cols, vw = [], [], [], [], []
    for s in strands:
        P, Wd = s['P'], s['W']
        n = len(P)
        base = len(verts)
        for j in range(n):
            t = (P[min(j + 1, n - 1)] - P[max(j - 1, 0)]).normalized()
            r = P[j] - C
            b = (r - t * r.dot(t))
            b = b.normalized() if b.length > 1e-6 else frame_of(t)[0]
            for sgn in (-0.5, 0.5):
                verts.append(P[j] + b * (sgn * Wd[j]))
                uvs.append((sgn + 0.5, j / (n - 1)))
                k = j / (n - 1)
                c = s['col']
                cols.append((c[0] * (0.55 + 0.45 * k), c[1] * (0.55 + 0.45 * k), c[2] * (0.55 + 0.45 * k), 1.0))
                vw.append(s['weights'])
        for j in range(n - 1):
            a = base + 2 * j
            faces.append((a, a + 1, a + 3, a + 2))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    # bent normals: perpendicular to the strand, pointing away from the head centre (a strand is a thin cylinder, not
    # a flat card: the ribbon's own face normal would light it like paper). Exported as NORMAL.
    bn = []
    for s in strands:
        P = s['P']; n = len(P)
        for j in range(n):
            t = (P[min(j + 1, n - 1)] - P[max(j - 1, 0)]).normalized()
            r = P[j] - C; b = r - t * r.dot(t)
            b = b.normalized() if b.length > 1e-6 else frame_of(t)[0]
            bn.append(b); bn.append(b)
    try:
        me.normals_split_custom_set_from_vertices([tuple(v) for v in bn])
    except Exception as e:
        print('[p3] custom normals failed', e)
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[me.loops[li].vertex_index]
    ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for i, c in enumerate(cols):
        ca.data[i].color = c
    me.color_attributes.active_color = ca
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.parent = arm
    groups = {}
    for i, w in enumerate(vw):
        for k, x in w.items():
            if k not in groups: groups[k] = o.vertex_groups.new(name=k)
            groups[k].add([i], x, 'REPLACE')
    mod = o.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    o.data.materials.append(mat)
    return o, len(verts), len(faces) * 2

def top4(w):
    it = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    s = sum(x for _, x in it)
    return {k: x / s for k, x in it}

# ------------------------------------------------------------------ materials
def principled(name, base=None, tex=None, normal=None, rough=0.5, spec=0.5, vcol=False, alpha_mode=None, sheen=None, normal_strength=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bs = nt.nodes['Principled BSDF']
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Specular IOR Level'].default_value = spec
    if base: bs.inputs['Base Color'].default_value = (*base, 1)
    if tex:
        ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(tex, check_existing=True)
        if vcol:
            pass
        nt.links.new(ti.outputs['Color'], bs.inputs['Base Color'])
        if alpha_mode:
            nt.links.new(ti.outputs['Alpha'], bs.inputs['Alpha'])
    if vcol:
        va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
        if base:
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(va.outputs['Color'], mix.inputs['A']); mix.inputs['B'].default_value = (*base, 1)
            nt.links.new(mix.outputs['Result'], bs.inputs['Base Color'])
        else:
            nt.links.new(va.outputs['Color'], bs.inputs['Base Color'])
    if normal:
        ni = nt.nodes.new('ShaderNodeTexImage'); ni.image = bpy.data.images.load(normal, check_existing=True)
        ni.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(ni.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    if sheen:
        # the glTF exporter writes Sheen Tint as sheenColorFactor and ignores Sheen Weight -> encode the colour in the tint
        bs.inputs['Sheen Weight'].default_value = 1.0
        bs.inputs['Sheen Tint'].default_value = (*sheen, 1.0)
        bs.inputs['Sheen Roughness'].default_value = 0.6
    if alpha_mode == 'CLIP':
        m.surface_render_method = 'DITHERED'
    m.use_backface_culling = False
    return m

def load_np(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4) * 255.0

def save_np(rgb, path):
    h, w = rgb.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    a = np.ones((h, w, 4), np.float32); a[..., :3] = np.clip(rgb, 0, 255) / 255.0
    im.pixels.foreach_set(a.ravel())
    im.filepath_raw = path; im.file_format = 'PNG'; im.save()
    bpy.data.images.remove(im)

def suit_texel_density():
    """texels per mm of the suit UV on a 2048 map (rest mesh)."""
    me = suit.data; uv = me.uv_layers.active.data
    a3 = auv = 0.0
    M = suit.matrix_world
    for p in me.polygons:
        vs = [M @ me.vertices[i].co for i in p.vertices]; q = [uv[li].uv for li in p.loop_indices]
        for k in range(1, len(vs) - 1):
            a3 += ((vs[k] - vs[0]).cross(vs[k + 1] - vs[0])).length / 2
            a, b = q[k] - q[0], q[k + 1] - q[0]; auv += abs(a.x * b.y - a.y * b.x) / 2
    return math.sqrt(auv * 2048 * 2048 / (a3 * 1e6))

SUIT_TPMM = None
def recolor_suit():
    """Near-black wool with a faint 12 mm pinstripe, built from the explicitly-CC0 base texture
    (male_elegantsuit01_diffuse.png). The 'toigo ... pinstripe' variant is NOT used: its .mhmat header says AGPLv3."""
    global SUIT_TPMM
    src = os.path.join(DATA, 'clothes', 'male_elegantsuit01', 'male_elegantsuit01_diffuse.png')
    a = load_np(src)
    rgb = a[..., :3]; mx = rgb.max(-1); mn = rgb.min(-1); sat = (mx - mn) / np.maximum(mx, 1)
    fabric = (sat < 0.12) & (mx < 110)
    tie = (sat >= 0.12) & (mx < 230)            # striped tie -> deep charcoal-navy
    out = rgb.copy()
    # base wool: keep the CC0 texture's weave/shading variation, rescale to sRGB ~30 (linear albedo ~0.013)
    v = rgb[fabric].mean(-1, keepdims=True)
    out[fabric] = (v / max(float(np.median(v)), 1.0)) * np.array([29.0, 29.0, 33.0])
    SUIT_TPMM = suit_texel_density()
    period = max(3, int(round(12.0 * SUIT_TPMM)))      # 12 mm pinstripe spacing (UV islands are upright)
    h, w = mx.shape
    stripe = (np.arange(w) % period) == 0
    m = fabric & stripe[None, :]
    out[m] = out[m] * 1.35                              # faint: +35 % on a 1-texel line
    g = rgb[tie].mean(-1, keepdims=True)
    out[tie] = g * np.array([0.18, 0.19, 0.25])
    p = os.path.join(OUT, 'tex', 'suit_nearblack_pinstripe.png')
    save_np(out, p)
    print('[p3] suit texel/mm', round(SUIT_TPMM, 3), 'pinstripe period px', period)
    return p

def recolor_shoes():
    src = os.path.join(DATA, 'clothes', 'shoes04', 'shoes04_diffuse.png')
    s = load_np(src)[..., :3].copy()
    mx = s.max(-1); sat = (mx - s.min(-1)) / np.maximum(mx, 1)
    sock = (mx > 110) & (sat < 0.25)
    s[sock] = s[sock] * 0.10
    # tan inner lining around the shoe opening: it showed as a light patch at the right ankle when the foot pitches
    # up on the pedal (v11 three.js profile). Warm, saturated, mid-bright -> near-black like the socks.
    lining = (sat > 0.22) & (mx > 40) & (s[..., 0] > s[..., 2] * 1.15)
    s[lining] = s[lining].mean(-1, keepdims=True) * np.array([0.16, 0.15, 0.15])
    p = os.path.join(OUT, 'tex', 'shoes04_black_socks.png')
    save_np(s, p)
    return p

SK = os.path.join(DATA, 'skins', 'mindfront_aksel_skin')
M_SKIN = principled('pianist_skin', tex=os.path.join(SK, 'Aksel_Skin_diffuse.png'), normal=os.path.join(SK, 'Aksel_Skin_NRM.png'), rough=0.48, spec=0.45, sheen=(0.10, 0.075, 0.065))
M_SUIT = principled('pianist_suit', tex=recolor_suit(), rough=0.82, spec=0.35, sheen=(0.035, 0.035, 0.042))
M_SHOE = principled('pianist_shoes', tex=recolor_shoes(), normal=os.path.join(DATA, 'clothes', 'shoes04', 'shoes04_normal.png'), rough=0.32, spec=0.6)
M_SHIRT = principled('pianist_shirt', base=(0.80, 0.80, 0.78), rough=0.75, spec=0.35, sheen=(0.12, 0.12, 0.12))
M_HAIR = principled('pianist_hair', base=(1.0, 1.0, 1.0), vcol=True, rough=0.42, spec=0.5)
M_BEARD = principled('pianist_beard', base=(1.0, 1.0, 1.0), vcol=True, rough=0.5, spec=0.45)
def set_mat(o, m):
    o.data.materials.clear(); o.data.materials.append(m)
set_mat(body, M_SKIN); set_mat(suit, M_SUIT); set_mat(shoes, M_SHOE)
for o in bpy.data.objects:
    if o.type == 'MESH' and o.parent == arm and o not in (body, suit, shoes):
        for ms in o.material_slots:     # eyes, brows, lashes: keep MPFB textures but make export-friendly
            m = ms.material
            if m:
                m.use_backface_culling = False

# ------------------------------------------------------------------ shirt cuffs
def build_cuff(s):
    w = bh(f'wrist.{s}')
    e = bh(f'lowerarm01.{s}')
    ax = (w - e).normalized()
    # jacket sleeve end: suit vertices dominated by forearm/wrist bones of this side, farthest along the axis
    sgi = {g.index: g.name for g in suit.vertex_groups}
    far = -1.0
    ring = []
    for v, p in zip(suit.data.vertices, sV):
        gs = {sgi[g.group]: g.weight for g in v.groups}
        gs = {k: x for k, x in gs.items() if k in deform}
        if not gs: continue
        d = max(gs, key=gs.get)
        if d.endswith('.' + s) and d.startswith(('lowerarm', 'wrist')):
            far = max(far, (p - w).dot(ax))
    sleeve_end = far                       # along axis, relative to the wrist joint
    z1 = sleeve_end + cfg.CUFF_SHOW         # cuff shows 12.5 mm
    z0 = z1 - 0.055
    u, v = frame_of(ax)
    # elliptical fit of the body cross-section in a slab around each station
    NA, NS = 40, 7
    stations = [z0 + (z1 - z0) * k / (NS - 1) for k in range(NS)]
    slab = [(p, (p - w).dot(ax)) for i, p in enumerate(bV) if real[i] and dom[i] and dom[i].endswith('.' + s)
            and dom[i].startswith(('lowerarm', 'wrist')) and abs((p - w).dot(ax) - (z0 + z1) / 2) < 0.06]
    rings = []
    for z in stations:
        pts = [p for p, d in slab if abs(d - z) < 0.008]
        c = w + ax * z
        rad = []
        for k in range(NA):
            th = 2 * math.pi * k / NA
            dvec = u * math.cos(th) + v * math.sin(th)
            best = 0.0
            for p in pts:
                q = p - c; q = q - ax * q.dot(ax)
                if q.length > 1e-6 and q.normalized().dot(dvec) > 0.97:
                    best = max(best, q.length)
            rad.append(best)
        # fill gaps with neighbours, then smooth
        for k in range(NA):
            if rad[k] == 0: rad[k] = max(rad)
        for _ in range(3):
            rad = [(rad[k - 1] + 2 * rad[k] + rad[(k + 1) % NA]) / 4 for k in range(NA)]
        rings.append((c, rad))
    # cuff = loose tube: max over stations (a cuff is a near-cylinder) + ease 5 mm, wall 1.6 mm, rolled rim
    # ease: 4 mm where the cuff shows, tapering to 1.5 mm inside the sleeve (so it never pokes through the jacket)
    rbase = [max(r[1][k] for r in rings) for k in range(NA)]
    def ease(z):
        t = min(1.0, max(0.0, (z - (sleeve_end - 0.012)) / 0.010))
        return 0.0015 + 0.0025 * t
    verts, faces = [], []
    T = 0.0016
    layers = []
    ring = lambda c, rr: [c + (u * math.cos(2 * math.pi * k / NA) + v * math.sin(2 * math.pi * k / NA)) * rr[k] for k in range(NA)]
    for zi, z in enumerate(stations):
        layers.append(ring(w + ax * z, [rbase[k] + ease(z) + T for k in range(NA)]))
    # rolled rim (half-round) then the inner wall back to the start
    zz = z1 + T * 0.5
    layers.append(ring(w + ax * zz, [rbase[k] + ease(z1) + T * 0.5 for k in range(NA)]))
    for z in reversed(stations):
        layers.append(ring(w + ax * z, [rbase[k] + ease(z) for k in range(NA)]))
    for L in layers: verts += L
    nl = len(layers)
    for li in range(nl - 1):
        for k in range(NA):
            a = li * NA + k; b = li * NA + (k + 1) % NA
            faces.append((a, b, b + NA, a + NA))
    me = bpy.data.meshes.new(f'Pianist.shirt_cuff.{s}')
    me.from_pydata([tuple(x) for x in verts], [], faces); me.update()
    for p in me.polygons: p.use_smooth = True
    # UV: u around, v along
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = ((vi % NA) / NA, (vi // NA) / (nl - 1))
    o = bpy.data.objects.new(f'Pianist.shirt_cuff.{s}', me)
    bpy.context.scene.collection.objects.link(o); o.parent = arm
    g1 = o.vertex_groups.new(name=f'lowerarm02.{s}'); g2 = o.vertex_groups.new(name=f'wrist.{s}')
    for i, p in enumerate(verts):
        d = (p - w).dot(ax)
        t = min(max((d - (z1 - 0.02)) / 0.02, 0.0), 1.0) * 0.25     # distal 2 cm ramps to 25 % wrist
        g1.add([i], 1 - t, 'REPLACE'); g2.add([i], t, 'REPLACE')
    mod = o.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    o.data.materials.append(M_SHIRT)
    # recalc normals outward
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    return o, dict(sleeve_end_from_wrist_mm=round(sleeve_end * 1000, 1), cuff_show_mm=12.5,
                   cuff_len_mm=55, ease_mm='4 visible / 1.5 inside the sleeve', wall_mm=1.6, verts=len(verts), tris=len(faces) * 2)

# ------------------------------------------------------------------ shorten the jacket sleeves so 12.5 mm of shirt cuff shows
def shorten_sleeve(s, target_end=cfg.SLEEVE_END, d0=-0.075 - cfg.WRIST_SHIFT):
    w = bh(f'wrist.{s}'); e = bh(f'lowerarm01.{s}'); ax = (w - e).normalized()
    sgi = {g.index: g.name for g in suit.vertex_groups}
    idx = []
    for v in suit.data.vertices:
        gs = {sgi[g.group]: g.weight for g in v.groups if sgi[g.group] in deform}
        if gs:
            d = max(gs, key=gs.get)
            if d.endswith('.' + s) and d.startswith(('lowerarm', 'wrist', 'finger', 'metacarpal')):
                idx.append(v.index)
    far = max((sV[i] - w).dot(ax) for i in idx)
    k = (target_end - d0) / (far - d0)
    mwi = suit.matrix_world.inverted()
    blocks = suit.data.shape_keys.key_blocks if suit.data.shape_keys else []
    moved = 0
    for i in idx:
        p = sV[i]; d = (p - w).dot(ax)
        if d <= d0: continue
        radial = p - (w + ax * d)
        q = w + ax * (d0 + (d - d0) * k) + radial
        delta = mwi.to_3x3() @ (q - p)
        suit.data.vertices[i].co += delta
        for kb in blocks:
            kb.data[i].co += delta
        moved += 1
    # un-delete the body skin from the old sleeve end back to the cuff start (covered by the cuff, avoids holes)
    restored = 0
    for m in body.modifiers:
        if m.type == 'MASK' and 'elegantsuit' in m.name and m.vertex_group in body.vertex_groups:
            g = body.vertex_groups[m.vertex_group]
            ids = [i for i in range(len(bV)) if dom[i] and dom[i].endswith('.' + s)
                   and dom[i].startswith(('lowerarm', 'wrist', 'finger', 'metacarpal')) and (bV[i] - w).dot(ax) > -0.07 - cfg.WRIST_SHIFT]
            if m.invert_vertex_group:
                g.remove(ids)
            else:
                g.add(ids, 1.0, 'REPLACE')
            restored = len(ids)
    return dict(old_end_mm=round(far * 1000, 1), new_end_mm=round(target_end * 1000, 1), compress=round(k, 3),
                moved_verts=moved, skin_restored_verts=restored)

sleeve_info = {s: shorten_sleeve(s) for s in ('L', 'R')}
print('[p3] sleeves', sleeve_info)

# ------------------------------------------------------------------ 4 kissing cuff buttons (the proxy has 3, spaced)
def rebuild_cuff_buttons(s, n_new=4, overlap=0.92):
    w = bh(f'wrist.{s}'); e = bh(f'lowerarm01.{s}'); ax = (w - e).normalized()
    M = suit.matrix_world; Mi = M.inverted()
    bm = bmesh.new(); bm.from_mesh(suit.data)
    uvl = bm.loops.layers.uv.active
    bm.verts.ensure_lookup_table()
    def wp(v): return M @ v.co
    cand = set()
    for f in bm.faces:
        uvs = [l[uvl].uv for l in f.loops]
        if all(u.x < 0.36 and u.y > 0.85 for u in uvs):
            ps = [wp(v) for v in f.verts]
            c = sum(ps, Vector()) / len(ps)
            d = (c - w).dot(ax); r = (c - w - ax * d).length
            if -0.13 - cfg.WRIST_SHIFT < d < -cfg.WRIST_SHIFT and r < 0.08:
                cand.add(f.index)
    bm.faces.ensure_lookup_table()
    # connected islands (by shared vertices) among candidate faces
    faces = [bm.faces[i] for i in cand]
    left = set(cand); islands = []
    while left:
        seed = left.pop(); stack = [seed]; isl = {seed}
        while stack:
            fi = stack.pop()
            for v in bm.faces[fi].verts:
                for g in v.link_faces:
                    if g.index in left:
                        left.remove(g.index); isl.add(g.index); stack.append(g.index)
        islands.append(isl)
    if len(islands) < 2:
        bm.free(); return dict(found=len(islands), rebuilt=False)
    info = []
    for isl in islands:
        vs = {v for fi in isl for v in bm.faces[fi].verts}
        ps = [wp(v) for v in vs]
        c = sum(ps, Vector()) / len(ps)
        diam = 2 * max((p - c).length for p in ps)
        info.append((c, diam, isl, vs))
    # keep only button-sized islands (median diameter +-30 %), then the sleeve-vent row chained from the distal one
    med = sorted(t[1] for t in info)[len(info) // 2]
    info = [t for t in info if abs(t[1] - med) < 0.3 * med]
    info.sort(key=lambda t: -(t[0] - w).dot(ax))            # distal first
    keep = [info[0]]
    for t in info[1:]:
        if (t[0] - keep[-1][0]).length < 2.5 * med:
            keep.append(t)
    info = keep
    cs = [t[0] for t in info]
    line = (cs[-1] - cs[0]).normalized() if len(cs) > 1 else -ax  # distal -> proximal along the vent
    diam = sorted(t[1] for t in info)[len(info) // 2]
    step = diam * overlap
    src_isl, src_vs, c0 = info[0][2], info[0][3], info[0][0]
    src_faces = [bm.faces[i] for i in src_isl]                      # element refs stay valid across ops
    dead_faces = [bm.faces[i] for _, _, isl, _ in info for i in isl]
    # duplicate the distal button n_new times along the line, then delete the originals
    new_geom = []
    for k in range(n_new):
        ret = bmesh.ops.duplicate(bm, geom=src_faces)
        nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
        off = Mi.to_3x3() @ (line * (step * k))
        # tiny outward stacking so overlapping buttons do not z-fight (each next one 0.25 mm higher)
        cc = c0 + line * (step * k); rad = (cc - w - ax * (cc - w).dot(ax)).normalized()
        off = off + Mi.to_3x3() @ (rad * 0.00025 * k)
        for v in nv: v.co += off
        new_geom += nv
    bmesh.ops.delete(bm, geom=dead_faces, context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(suit.data); suit.data.update(); bm.free()
    return dict(found=len(islands), rebuilt=True, button_diam_mm=round(diam * 1000, 1), step_mm=round(step * 1000, 1),
                old_spacing_mm=[round((cs[i + 1] - cs[i]).length * 1000, 1) for i in range(len(cs) - 1)], new_verts=len(new_geom))

def canonical_tail_order(n_tail):
    """bmesh.ops.duplicate creates the copies' vertices in a pointer-dependent order (fix round 1: two p3 runs gave the same
    240 button vertices in different orders, which broke the frozen-cloth fingerprint). Sort the appended button vertices
    by their rest position so the suit's vertex order is reproducible."""
    bm = bmesh.new(); bm.from_mesh(suit.data); bm.verts.ensure_lookup_table()
    n0 = len(bm.verts) - n_tail
    # (BMVertSeq.sort needs a NUMBER per vertex: rank the tail by its rounded rest position)
    tail = sorted((v for v in bm.verts if v.index >= n0), key=lambda v: (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)))
    rank = {v.index: n0 + k for k, v in enumerate(tail)}
    key = {v: (v.index if v.index < n0 else rank[v.index]) for v in bm.verts}
    bm.verts.sort(key=lambda v: key[v]); bm.verts.index_update()
    bm.to_mesh(suit.data); suit.data.update(); bm.free()
    return n0

if suit.data.shape_keys is None:
    button_info = {s: rebuild_cuff_buttons(s) for s in ('L', 'R')}
    # (canonical_tail_order is NOT applied: the button copies were found to be in a stable order; the nondeterminism was the
    # jacket hem extrusion below)
else:
    button_info = {'skipped': 'suit has shape keys'}
print('[p3] cuff buttons', button_info)
sleeve_info['buttons'] = button_info

# ------------------------------------------------------------------ jacket length + free skirt
JACKET_V = 0.53          # suit UV: the jacket islands are in the upper half of the atlas (v > 0.53), trousers below
def lengthen_jacket(L_ext=0.085, K=5):
    """The CC0 proxy jacket ends at hip-joint level (hem z ~0.875 all round in the A pose, crotch 0.78): a real suit jacket covers
    the seat. Extrude the bottom hem chains K rows down by L_ext, following the garment surface and pushed out of the
    body + trousers; UVs extrapolated across the hem (near-black pinstripe fabric continues); weights copied from the hem."""
    M = suit.matrix_world; Mi = M.inverted()
    V0, _ = rest_mesh(suit)
    bm = bmesh.new(); bm.from_mesh(suit.data)
    uvl = bm.loops.layers.uv.active
    dfl = bm.verts.layers.deform.verify()
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    jf = {f.index for f in bm.faces if all(l[uvl].uv.y > JACKET_V for l in f.loops)}
    jacket_vids = {v.index for f in bm.faces if f.index in jf for v in f.verts}
    # collision BVH: body + non-jacket suit faces (trousers, shirt)
    nonj = [tuple(v.index for v in f.verts) for f in bm.faces if f.index not in jf]
    bvh_c = BVHTree.FromPolygons(bV + V0, [tuple(i for i in f) for f in realF] + [tuple(i + len(bV) for i in f) for f in nonj])
    hem = []
    for e in bm.edges:
        if not e.is_boundary or len(e.link_faces) != 1: continue
        f = e.link_faces[0]
        if f.index not in jf: continue
        a, b = e.verts; pa, pb = V0[a.index], V0[b.index]
        mid = (pa + pb) / 2; L = (pb - pa).length
        cz = sum((V0[v.index] for v in f.verts), Vector()) / len(f.verts)
        if abs(pb.z - pa.z) < 0.6 * L and cz.z > mid.z and mid.z < 1.0:     # the proxy's hem row is a 2-4 mm strip
            hem.append(e)
    # a LIST in index order (a set of BMVerts iterates in pointer order: two p3 runs created the 240 new hem vertices in
    # different orders, which broke the frozen-cloth fingerprint; fix round 1)
    hv = sorted({v for e in hem for v in e.verts}, key=lambda v: v.index); hvs = set(hv)
    # per hem vertex: the garment's downward continuation (away from its upper neighbour), blended with gravity
    down = {}
    def up_nb(v, skip):
        best, bu = -1.0, None
        for e in v.link_edges:
            if e.is_boundary: continue
            u = e.other_vert(v)
            if u in skip: continue
            dz = V0[u.index].z - V0[v.index].z
            if dz > best: best, bu = dz, u
        return bu
    for v in hv:
        u = v
        for _ in range(3):          # three edges up: the hem strip itself is only 2-4 mm tall
            nu = up_nb(u, {v} | hvs)
            if nu is None: break
            u = nu
        d = (V0[v.index] - V0[u.index]) if u is not v else Vector((0, 0, -1))
        d = d.normalized() if d.length > 1e-6 else Vector((0, 0, -1))
        down[v] = (d * 0.6 + Vector((0, 0, -0.4))).normalized()
    step = L_ext / K
    rows = {v: [V0[v.index]] for v in hv}
    for k in range(1, K + 1):
        for v in hv:
            p = rows[v][-1] + down[v] * step
            loc, nrm, idx, dist = bvh_c.find_nearest(p, 0.08)
            margin = 0.004 + 0.0012 * k
            if loc is not None:
                dv = p - loc; s = dv.dot(nrm)
                if s < margin: p = loc + nrm * margin + (dv - nrm * s)
            rows[v].append(p)
    # smooth each new row along the hem (neighbours through hem edges)
    nb = {v: [] for v in hv}
    for e in hem:
        a, b = e.verts; nb[a].append(b); nb[b].append(a)
    for k in range(1, K + 1):
        for _ in range(2):
            new = {v: (rows[v][k] * 2 + sum((rows[u][k] for u in nb[v]), Vector())) / (2 + len(nb[v])) if nb[v] else rows[v][k] for v in hv}
            for v in hv: rows[v][k] = new[v]
    newv = {v: [v] for v in hv}
    for k in range(1, K + 1):
        for v in hv:
            nv = bm.verts.new(Mi @ rows[v][k])
            nv[dfl].clear()
            for g, w in v[dfl].items(): nv[dfl][g] = w
            newv[v].append(nv)
    bm.verts.ensure_lookup_table()
    nf = 0
    mat = hem[0].link_faces[0].material_index if hem else 0
    for e in hem:
        f = e.link_faces[0]
        lp = e.link_loops[0]; s, t = lp.vert, lp.link_loop_next.vert     # f traverses s -> t
        uvs = {l.vert: l[uvl].uv.copy() for l in f.loops}
        uvc = sum((l[uvl].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
        du = uvs[t] - uvs[s]; n_uv = Vector((-du.y, du.x))
        if n_uv.dot((uvs[s] + uvs[t]) / 2 - uvc) < 0: n_uv = -n_uv
        scale = du.length / max((V0[t.index] - V0[s.index]).length, 1e-6)      # UV units per metre
        n_uv = n_uv.normalized() * scale
        for k in range(1, K + 1):
            q = bm.faces.new((newv[t][k - 1], newv[s][k - 1], newv[s][k], newv[t][k]))
            q.material_index = mat; q.smooth = True
            for l in q.loops:
                v = l.vert
                base = s if v in newv[s] else t
                kk = newv[base].index(v)
                l[uvl].uv = uvs[base]     # constant down each column: the vertical pinstripes continue, and
                                          # extrapolating would walk into the trousers' UV region
            nf += 1
    bm.verts.index_update()
    jids = sorted(jacket_vids | {nv.index for v in hv for nv in newv[v][1:]})
    bm.to_mesh(suit.data); suit.data.update(); bm.free()
    jg = suit.vertex_groups.get('jacket') or suit.vertex_groups.new(name='jacket')
    jg.add(jids, 1.0, 'REPLACE')
    zs = [rows[v][-1].z for v in hv]
    return dict(hem_edges=len(hem), hem_verts=len(hv), rows=K, length_mm=round(L_ext * 1000), new_faces=nf,
                new_hem_z=[round(min(zs), 3), round(sum(zs) / len(zs), 3)])

def free_skirt():
    """Back/side skirt below the waist: rigid with the pelvis ('root'), not the thighs (seated thigh flexion dragged it
    into the lap/bench and rolled it up in v11), and free in the cloth solve (vertex group 'skirt_free' for p4)."""
    V0, _ = rest_mesh(suit)
    me = suit.data
    jgi = suit.vertex_groups['jacket'].index
    vj = [any(g.group == jgi for g in v.groups) for v in me.vertices]
    hip = bh('upperleg01.L'); z_w = hip.z + 0.07
    gi = {g.index: g.name for g in suit.vertex_groups}
    if 'root' not in suit.vertex_groups: suit.vertex_groups.new(name='root')
    groups = {g.name: g for g in suit.vertex_groups}
    free = suit.vertex_groups.new(name='skirt_free')
    n = 0
    for i, v in enumerate(me.vertices):
        if not vj[i]: continue
        p = V0[i]
        t = min(1.0, max(0.0, (z_w - p.z) / 0.10)) * min(1.0, max(0.0, (p.y - hip.y + 0.02) / 0.06))
        if t <= 0: continue
        ws = {gi[g.group]: g.weight for g in v.groups if gi[g.group] in deform}
        for k, w in ws.items(): groups[k].add([i], w * (1 - t), 'REPLACE')
        groups['root'].add([i], ws.get('root', 0) * (1 - t) + t, 'REPLACE')
        free.add([i], t, 'REPLACE'); n += 1
    return dict(verts=n, waist_z=round(z_w, 3))

jacket_info = lengthen_jacket()
jacket_info['skirt'] = free_skirt()
print('[p3] jacket', jacket_info)
sleeve_info['jacket'] = jacket_info
sV, sF = rest_mesh(suit)
allV = bV + sV
allF = [tuple(i for i in f) for f in realF] + [tuple(i + len(bV) for i in f) for f in sF]
bvh_all = BVHTree.FromPolygons(allV, allF)

cuff_info = {}
for s in ('L', 'R'):
    _, cuff_info[s] = build_cuff(s)
print('[p3] cuffs', cuff_info)

# ------------------------------------------------------------------ hair
scalp_mask = [scalp_ok(i) for i in range(len(bV))]
beard_mask = [beard_ok(i) for i in range(len(bV))]
s_tris, s_cum, s_area = tri_sampler(scalp_mask)
b_tris, b_cum, b_area = tri_sampler(beard_mask)
print('[p3] scalp area cm2', round(s_area * 1e4, 1), 'beard area cm2', round(b_area * 1e4, 1))

DOWN = Vector((0, 0, -1)); BACK = Vector((0, 1, 0)); FWD = Vector((0, -1, 0))
# FIX ROUND 1 groom (USER_FEEDBACK 4 / refs 9, 4, 11): shorter tousled dark curls, LONGER ON TOP AND FALLING FORWARD,
# flat and short at the sides and the back (the session-3 groom read as a tall round frizzy puff in the ref-9 wide).
# The groom is built in the upright rest pose, but the bind pose bows the head ~28 deg (p2: neck01 8, neck02 8, head 12),
# so 'gravity' for the hair is DOWN rotated 28 deg toward the face, in head space.
HEAD_BOW = math.radians(28.0)
GRAV = Vector((0, -math.sin(HEAD_BOW), -math.cos(HEAD_BOW)))
def _ss(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)
def hair_region(p):
    """weights of the groom regions at a root: (top, front, side, crown) in [0,1]; back = the rest."""
    a = azim(p); zr = p.z - EYE_Z
    top = _ss((zr - 0.045) / 0.045)            # crown plateau and above
    front = _ss((a - 115) / 35)                # forehead hairline half
    side = _ss((a - 45) / 40) * (1 - _ss((a - 125) / 25))
    return a, zr, top, front, side
def comb_dir(p, radial):
    a, zr, top, front, side = hair_region(p)
    sx = Vector((1 if p.x >= 0 else -1, 0, 0))
    d_back = (DOWN * 0.95 + radial * 0.10 + FWD * 0.05).normalized()
    d_side = (DOWN * 0.80 + BACK * 0.30 + radial * 0.10).normalized()
    # top and fringe: forward and down over the forehead, a little out to the side of the parting
    d_top = (FWD * 0.42 + GRAV * 0.60 + sx * 0.28 * min(1.0, abs(p.x) / 0.04) + radial * 0.22).normalized()
    # crown (top, back half): arcs back, then gravity takes it
    d_crown = (BACK * 0.40 + GRAV * 0.55 + radial * 0.25).normalized()
    base = d_back.lerp(d_side, side).normalized()
    fwd_w = max(top * _ss((a - 60) / 50), front * 0.9)
    crown_w = top * (1 - _ss((a - 60) / 50))
    d = base.lerp(d_crown, crown_w).normalized()
    return d.lerp(d_top, fwd_w).normalized()

def grow_clump(root, n, L, npts, lam, Rc, pitch, sag, comb=None, grav=DOWN):
    radial = (root - C).normalized()
    comb = comb or comb_dir(root, radial)
    P = [root.copy()]
    ds = L / (npts - 1)
    d0 = (n * 0.7 + radial * 0.3).normalized()
    for j in range(1, npts):
        s = j * ds
        e = math.exp(-s / lam)
        d = (d0 * e + comb * (1 - e) + grav * sag * (s / L) ** 2).normalized()
        P.append(P[-1] + d * ds)
    return P

def helix(P, Rc, pitch, phase, ramp=0.015):
    out = []; n = len(P)
    t = (P[1] - P[0]).normalized(); u, v = frame_of(t)
    s = 0.0
    for j in range(n):
        if j > 0:
            s += (P[j] - P[j - 1]).length
            tn = (P[min(j + 1, n - 1)] - P[j - 1]).normalized()
            q = t.rotation_difference(tn); u = q @ u; v = q @ v; t = tn
        r = Rc * min(1.0, s / ramp)
        th = phase + 2 * math.pi * s / pitch
        out.append(P[j] + (u * math.cos(th) + v * math.sin(th)) * r)
    return out, (u, v)

def smooth_noise3(rng, amp, lmin, lmax, k=3):
    """Low-frequency 3-D offset along the strand arc length s (sum of k sinusoids per axis): replaces the v11 per-point
    gaussian frizz, which turned into a jagged zig-zag as soon as the strands got more points."""
    terms = [[(rng.uniform(0.6, 1.0) * amp / k, 2 * math.pi / rng.uniform(lmin, lmax), rng.uniform(0, 6.283)) for _ in range(k)]
             for _ in range(3)]
    def f(s):
        return Vector(tuple(sum(a * math.sin(w * s + ph) for a, w, ph in ax) for ax in terms))
    return f

def hair_npts(L, pitch, kind):
    if kind != 'hair':
        return 5
    return int(min(72, max(14, math.ceil(L * PTS_PER_TURN / pitch) + 1)))

def make_strands(N, tris, cum, kind):
    roots = [sample(tris, cum) for _ in range(N)]
    nclump = max(1, N // (CLUMP_N if kind == 'hair' else 4))
    cl = [roots[R.randrange(N)] for _ in range(nclump)]
    # assign roots to nearest clump centre (brute force on small sets)
    cp = np.array([list(c[0]) for c in cl])
    params = []
    for c in cl:
        if kind == 'hair':
            a, zr, top, front, side = hair_region(c[0])
            fwd = max(top * _ss((a - 60) / 50), front * 0.9)
            crown = top * (1 - _ss((a - 60) / 50))
            low = 1 - _ss((zr + 0.02) / 0.05)          # nape / below the ear tops: shortest
            # lengths along the strand (the helix shortens the reach to ~60-70 %): long on top falling forward, short and
            # close at the sides and the nape (fix round 1; was: back 10-13 cm to the collar, sides 6.5-8.5 cm)
            L_back = R.uniform(0.045, 0.060) * (1 - 0.25 * low)
            L_side = R.uniform(0.038, 0.052)
            L_top = R.uniform(0.068, 0.092)
            L_crown = R.uniform(0.058, 0.076)
            L = L_back + (L_side - L_back) * side
            L = L + (L_crown - L) * crown
            L = L + (L_top - L) * fwd
            vol = max(fwd, crown)                       # volume / looser curls on top, tight and flat on the sides
            # tousled: every clump's comb direction is perturbed (top more than the sides)
            jit = Vector((R.gauss(0, 1), R.gauss(0, 1), R.gauss(0, 1))).normalized() * (0.18 + 0.22 * vol)
            params.append(dict(L=L, Rc=(R.uniform(0.004, 0.0065) + vol * R.uniform(0.004, 0.007)) * RC_SCALE,
                               pitch=(R.uniform(0.026, 0.034) + vol * R.uniform(0.020, 0.032)) * PITCH_SCALE, phase=R.uniform(0, 6.283),
                               lam=R.uniform(0.007, 0.012) + vol * R.uniform(0.008, 0.014), sag=R.uniform(0.25, 0.55) * (0.5 + vol),
                               jit=jit))
        else:
            params.append(dict(L=R.uniform(0.008, 0.016), Rc=R.uniform(0.0012, 0.0025), pitch=R.uniform(0.005, 0.009),
                               phase=R.uniform(0, 6.283), lam=0.004, sag=0.3))
    guides = []
    for c, pr in zip(cl, params):
        npts = hair_npts(pr['L'], pr['pitch'], kind)
        if kind == 'beard':
            radial = (c[0] - C).normalized()
            comb = (DOWN * 0.8 + radial * 0.5).normalized()
            if c[0].z > LIP_TOP - 0.004:      # moustache: down and outward
                comb = (DOWN * 0.8 + Vector((c[0].x, 0, 0)).normalized() * 0.3 + radial * 0.3).normalized() if abs(c[0].x) > 1e-4 else DOWN
        else:
            comb = (comb_dir(c[0], (c[0] - C).normalized()) + pr['jit']).normalized()
        P = grow_clump(c[0], c[1], pr['L'], npts, pr['lam'], pr['Rc'], pr['pitch'], pr['sag'], comb, GRAV if kind == 'hair' else DOWN)
        H, _ = helix(P, pr['Rc'], pr['pitch'], pr['phase'], ramp=0.015 if kind == 'hair' else 0.003)
        guides.append(H)
    strands = []
    base_col = (0.055, 0.038, 0.028) if kind == 'hair' else (0.05, 0.035, 0.027)
    for (p, n, w) in roots:
        k = int(np.argmin(((cp - np.array(list(p))) ** 2).sum(1)))
        G = guides[k]; g0 = G[0]
        npts = len(G)
        spread = R.uniform(0.0, SPREAD_MM / 1000 if kind == 'hair' else 0.0012)      # tighter, defined curl clumps (was 3.5 mm)
        th = R.uniform(0, 6.283)
        P = []
        L = sum((G[j] - G[j - 1]).length for j in range(1, npts))
        fr = smooth_noise3(R, 0.0006 if kind == 'hair' else 0.00025, 0.012 if kind == 'hair' else 0.004, 0.035 if kind == 'hair' else 0.01)
        s = 0.0
        tlen = R.uniform(0.85, 1.0)          # strand length variation (tips)
        for j in range(npts):
            if j > 0: s += (G[j] - G[j - 1]).length
            blend = min(1.0, s / (0.02 if kind == 'hair' else 0.004))
            t = (G[min(j + 1, npts - 1)] - G[max(j - 1, 0)]).normalized(); u, v = frame_of(t)
            off = (u * math.cos(th) + v * math.sin(th)) * spread * ((0.6 + 0.8 * s / max(L, 1e-6)) if kind != 'hair' else (0.7 + 0.35 * s / max(L, 1e-6)))
            frizz = fr(s) * (s / max(L, 1e-6))
            q = G[j] + off + frizz + (p - g0) * (1 - blend)
            P.append(q)
        # truncate to tlen of the length by resampling the last point
        cut = max(3, int(round(npts * tlen)))
        P = P[:cut]
        if BROW_CLIP and kind == 'hair':
            # no strands hanging in front of the face below the brow line (front half: azimuth > 110 deg)
            for j in range(3, len(P)):
                if P[j].z < EYE_Z + 0.012 and azim(P[j]) > 110:
                    P = P[:j]; break
        P = push_out(P, 0.0025 if kind == 'hair' else 0.0008)
        P[0] = p  # root exactly on the skin
        w0 = HAIR_W0 if kind == 'hair' else 0.0007
        W = [w0 * (1 - 0.68 * j / (len(P) - 1)) for j in range(len(P))]
        jit = R.uniform(0.8, 1.25)
        col = tuple(c * jit for c in base_col)
        strands.append(dict(P=P, W=W, weights=top4(w), col=col))
    return strands

def make_strays(N, tris, cum):
    """Individual flyaway curls at the outer envelope (top, crown, back and sides; not the hairline): longer reach along
    the scalp normal before they comb over, a looser helix and thin ribbons. In backlit silhouettes these are the bright
    rim curls (refs 9, 4)."""
    out = []
    tries = 0
    while len(out) < N and tries < N * 20:
        tries += 1
        p, n, w = sample(tris, cum)
        a = azim(p)
        if p.z < EYE_Z + 0.05 or a > 150:      # top and crown only (fix round 1: no flyaways off the short sides/nape)
            continue
        radial = (p - C).normalized()
        L = R.uniform(0.06, 0.09)
        pitch = R.uniform(0.028, 0.040); Rc = R.uniform(0.006, 0.010)
        npts = hair_npts(L, pitch, 'hair')
        lam = R.uniform(0.02, 0.035)
        comb = (comb_dir(p, radial) * 0.75 + radial * 0.35).normalized()
        P = grow_clump(p, n, L, npts, lam, Rc, pitch, R.uniform(0.2, 0.45), comb, GRAV)
        H, _ = helix(P, Rc, pitch, R.uniform(0, 6.283), ramp=0.02)
        fr = smooth_noise3(R, 0.0018, 0.015, 0.04)
        Q = []; s = 0.0
        for j in range(len(H)):
            if j > 0: s += (H[j] - H[j - 1]).length
            Q.append(H[j] + fr(s) * (s / L))
        Q = push_out(Q, 0.003); Q[0] = p
        w0 = R.uniform(0.0005, 0.0008)
        W = [w0 * (1 - 0.6 * j / (len(Q) - 1)) for j in range(len(Q))]
        jit = R.uniform(0.85, 1.2)
        out.append(dict(P=Q, W=W, weights=top4(w), col=tuple(c * jit for c in (0.055, 0.038, 0.028))))
    return out

def make_cap(name, mask, offset, mat, col):
    """Dark shell over the masked skin (hides scalp/skin between strands); weights copied from the body."""
    faces = [f for f in realF if all(mask[i] for i in f)]
    used = sorted({i for f in faces for i in f})
    remap = {i: k for k, i in enumerate(used)}
    # vertex normals of the rest body
    nrm = {i: Vector() for i in used}
    for f in faces:
        n = (bV[f[1]] - bV[f[0]]).cross(bV[f[2]] - bV[f[0]])
        for i in f: nrm[i] += n
    verts = [bV[i] + nrm[i].normalized() * offset for i in used]
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], [tuple(remap[i] for i in f) for f in faces]); me.update()
    for p in me.polygons: p.use_smooth = True
    uvl = me.uv_layers.new(name='UVMap')
    ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for k in range(len(verts)): ca.data[k].color = (*col, 1.0)
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); o.parent = arm
    groups = {}
    for i in used:
        for k, x in top4(bW[i]).items():
            if k not in groups: groups[k] = o.vertex_groups.new(name=k)
            groups[k].add([remap[i]], x, 'REPLACE')
    mod = o.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    o.data.materials.append(mat)
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    return o, len(verts), sum(len(f) - 2 for f in faces)

def erode(mask, times):
    nb = [set() for _ in bV]
    for f in realF:
        for i in f:
            nb[i].update(f)
    m = list(mask)
    for _ in range(times):
        m = [m[i] and all(m[j] for j in nb[i]) for i in range(len(m))]
    return m

# caps are eroded so that the strands (grown from the full mask) hide the staircase edge of the shell
scalp_cap = make_cap('Pianist.scalp_cap', erode(scalp_mask, 1), 0.0012, M_HAIR, (0.04, 0.028, 0.021))
beard_cap = make_cap('Pianist.beard_cap', erode(beard_mask, 1), 0.0006, M_BEARD, (0.045, 0.032, 0.025))
print('[p3] caps', scalp_cap[1:], beard_cap[1:])

hair_strands = make_strands(N_HAIR, s_tris, s_cum, 'hair')
stray_strands = make_strays(N_STRAY, s_tris, s_cum)
hair_o, hv, ht = strands_to_mesh('Pianist.hair_strands', hair_strands + stray_strands, M_HAIR)
beard_strands = make_strands(N_BEARD, b_tris, b_cum, 'beard')
beard_o, bvn, btn = strands_to_mesh('Pianist.beard_strands', beard_strands, M_BEARD)
_np = [len(s['P']) for s in hair_strands]
print('[p3] hair verts', hv, 'tris', ht, '| strays', len(stray_strands), '| points/strand mean', round(sum(_np) / len(_np), 1),
      'max', max(_np), '| beard verts', bvn, 'tris', btn)

rep = dict(seed=SEED, n_hair=N_HAIR, n_stray=len(stray_strands), pts_per_turn=PTS_PER_TURN,
           hair_pts_mean=round(sum(_np) / len(_np), 1), n_beard=N_BEARD,
           ear_verts=sum(EAR), scalp_area_cm2=round(s_area * 1e4, 1), beard_area_cm2=round(b_area * 1e4, 1),
           hair=dict(verts=hv, tris=ht), beard=dict(verts=bvn, tris=btn),
           scalp_cap=dict(verts=scalp_cap[1], tris=scalp_cap[2]), beard_cap=dict(verts=beard_cap[1], tris=beard_cap[2]),
           cuffs=cuff_info, sleeve=sleeve_info, suit_texels_per_mm_2048=round(SUIT_TPMM, 3), seconds=round(time.time() - t0, 1))
json.dump(rep, open(os.path.join(OUT, 'p3_report.json'), 'w'), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'p3.blend'))
print('[p3] done', json.dumps(rep))
