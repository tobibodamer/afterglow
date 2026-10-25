"""Stage p5: bake the seated pose (+ simulated or frozen cloth) as the BIND pose and export the raw three.js GLB.

  blender -b p4.blend --python p5_export.py -- <out.glb> [--frame 90] [--subdiv 1] [--maxinf 4] [--nohair]
          [--cloth frozen.npz] [--suit-thick 0.0022]

Steps: shape keys -> mix; every mesh's evaluated (armature [+cloth]) positions at --frame written to the base mesh
(the suit's from the frozen cloth .npz when --cloth is given); cloth/collision modifiers removed; pose applied as rest
(pose.armature_apply); MPFB helper/mask/subdiv bake on the body; subdivision applied to suit/shoes; suit solidified
(real thickness at every hem, lapel and cuff; inner shell = lining material); the hand UV islands get their own
material + UV remap (hand texture set, 6.6 texels/mm, made later by tools/pianist/py/hand_textures.py); per-vertex
skin thickness (_THICK, for the back-scatter in the three.js skin shader); non-deform groups removed; weights cleaned,
limited to 4, normalised; glTF export (y-up, skins, no animation). Writes <out.glb>.json (counts, histograms, layout).
"""
import bpy, sys, os, json, time, importlib, hashlib, math
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
def opt(k, d, f=int):
    return f(argv[argv.index(k) + 1]) if k in argv else d
FRAME = opt('--frame', 90)
SUBDIV = opt('--subdiv', 1)
BODY_SUBDIV = opt('--body-subdiv', 2)      # fix round 1: the body (hands!) at subdivision 2 (~1.2 mm on the hands), was 1
HAND_FORMS = '--no-hand-forms' not in argv
MAXINF = opt('--maxinf', 4)
NOHAIR = '--nohair' in argv
CLOTH = opt('--cloth', None, str)
SUIT_THICK = opt('--suit-thick', 0.0022, float)
SUIT_FOLDS = opt('--suit-folds', 0.0, float)      # fix round 1: compression folds in the suit GEOMETRY (mm amplitude; 0 = off)
SUIT_SUBDIV = opt('--suit-subdiv', SUBDIV)        # suit subdivision level (2 with geometric folds: ~4.5 mm edges)
# hand texture layout: one W x H texture, right hand in the left square, left hand in the right square
HAND_TEX = (6144, 3072)          # session 3: was 4608 x 2304 (6.8 texels/mm) -> ~9 texels/mm (user: >= 8)
HAND_MARGIN_PX = 43
t0 = time.time()
import addon_utils
addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
ExportService = importlib.import_module('bl_ext.user_default.mpfb.services.exportservice').ExportService
scn = bpy.context.scene
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.parent != arm]:
    bpy.data.objects.remove(o, do_unlink=True)          # reference keyboard / bench / floor
if NOHAIR:
    for o in [o for o in bpy.data.objects if 'strands' in o.name]:
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm]
body = [o for o in meshes if o.name.endswith('.body')][0]
scn.frame_set(FRAME)
bpy.context.view_layer.update()

def activate(o):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for x in bpy.context.view_layer.objects: x.select_set(False)
    bpy.context.view_layer.objects.active = o; o.select_set(True)

# 1) evaluate posed (+cloth) cage positions for every mesh, with only ARMATURE/CLOTH active
posed = {}
for o in meshes:
    saved = [(m, m.show_viewport) for m in o.modifiers]
    for m in o.modifiers:
        m.show_viewport = m.type in ('ARMATURE', 'CLOTH')
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); me = e.to_mesh()
    assert len(me.vertices) == len(o.data.vertices), o.name
    posed[o.name] = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    e.to_mesh_clear()
    for m, sv in saved: m.show_viewport = sv
cloth_info = {'source': 'simulated (this run)' if any(m.type == 'CLOTH' for o in meshes for m in o.modifiers) else 'skinning only'}
if CLOTH:
    suit = [o for o in meshes if 'elegantsuit' in o.name][0]
    z = np.load(CLOTH)
    co = np.array([v.co[:] for v in suit.data.vertices], dtype=np.float64)
    fs = np.array([len(p.vertices) for p in suit.data.polygons], dtype=np.int32)
    pose = np.array([list(pb.head) for pb in arm.pose.bones], dtype=np.float64)
    fp = hashlib.sha1(np.round(co, 4).tobytes() + fs.tobytes() + np.round(pose, 4).tobytes()).hexdigest()
    if int(z['verts']) != len(suit.data.vertices) or str(z['fingerprint']) != fp:
        raise SystemExit(f'[export] frozen cloth {CLOTH} does not match the suit (verts {int(z["verts"])} vs {len(suit.data.vertices)}, '
                         f'fingerprint {z["fingerprint"]} vs {fp}): re-bake with run_all.ps1 -RebakeCloth')
    posed[suit.name] = z['posed'].astype(np.float64)
    cloth_info = {'source': 'frozen', 'file': os.path.basename(CLOTH), 'fingerprint': fp, 'frame': int(z['frame'])}
print('[export] cloth', cloth_info)
# 2) drop shape keys (mix kept), write the posed cage, remove cloth/collision
for o in meshes:
    activate(o)
    if o.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    o.data.vertices.foreach_set('co', posed[o.name].astype(np.float32).ravel())
    o.data.update()
    for m in list(o.modifiers):
        if m.type in ('CLOTH', 'COLLISION'):
            o.modifiers.remove(m)
# 3) pose -> rest
if arm.animation_data:
    arm.animation_data.action = None          # keep the evaluated pose as the current pose basis
activate(arm)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
# three.js GLTFLoader sanitises node names (PropertyBinding.sanitizeNodeName drops '.'), so 'wrist.R' would become
# 'wristR'. Rename bones '.' -> '_' so Blender, glTF and three.js agree; Blender renames the vertex groups with them.
for b in arm.data.bones:
    if '.' in b.name:
        b.name = b.name.replace('.', '_')
for o in meshes:
    for g in o.vertex_groups:
        if '.' in g.name and g.name.replace('.', '_') in arm.data.bones:
            g.name = g.name.replace('.', '_')
    o.name = o.name.replace('.', '_')
bpy.context.view_layer.update()
# 4) body: masks/helpers/subdiv bake (MPFB);  others: subdiv + masks applied
activate(body)
for m in body.modifiers:
    if m.type == 'SUBSURF':
        m.levels = m.render_levels = BODY_SUBDIV
ExportService.bake_modifiers_remove_helpers(body, bake_masks=True, bake_subdiv=BODY_SUBDIV > 0, remove_helpers=True)

# 4a) hands: anatomical forms in the geometry (fix round 1; tools/pianist/py/handforms.py, shared with the textures):
# dorsal knuckle heads, condyles, waisted phalanx shafts, palmar pads, extensor tendons and the dorsal veins, displaced
# along the vertex normal of the (now subdivision-2, ~1.2 mm) mesh in the bind pose. Weights are untouched.
forms_info = {}
if HAND_FORMS:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'py'))
    import handforms as HF
    bmw = body.matrix_world.inverted() @ arm.matrix_world
    def _jpos(n): return np.array(bmw @ arm.data.bones[n].head_local) * 1000.0
    def _tip(n): return np.array(bmw @ arm.data.bones[n].tail_local) * 1000.0
    me = body.data
    nV = len(me.vertices)
    co = np.zeros(nV * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3) * 1000.0
    me.update()
    nr = np.zeros(nV * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    gname = {g.index: g.name for g in body.vertex_groups}
    want = {}
    for s in ('R', 'L'):
        for gn in ['wrist', 'metacarpal1', 'metacarpal2', 'metacarpal3', 'metacarpal4', 'lowerarm01', 'lowerarm02'] + \
                  [f'finger{f}-{j}' for f in range(1, 6) for j in (1, 2, 3)]:
            want[f'{gn}_{s}'] = np.zeros(nV)
    for v in me.vertices:
        for g in v.groups:
            nm = gname.get(g.group)
            if nm in want: want[nm][v.index] = g.weight
    total = np.zeros(nV)
    for s in ('R', 'L'):
        hf = HF.hand_frames(_jpos, _tip, s)
        GW = lambda name, s=s: want.get(f'{name}_{s}', np.zeros(nV))
        sideW = sum(want[k] for k in want if k.endswith('_' + s) and not k.startswith('lowerarm'))
        sel = np.nonzero(sideW > 0.05)[0]
        P = co[sel]; Nn = nr[sel]
        GWs = lambda name, s=s: GW(name)[sel]
        d_f = HF.finger_forms(P, GWs, hf)
        PALM_W = sum(GWs(k) for k in ('wrist', 'metacarpal1', 'metacarpal2', 'metacarpal3', 'metacarpal4'))
        LOWER_W = GWs('lowerarm01') + GWs('lowerarm02')
        dr = HF.dorsum_forms(P, Nn, hf, PALM_W, LOWER_W + 0 * PALM_W, s)
        d = d_f.copy()
        d[dr['ids']] += np.maximum(dr['tendon'], 0) + dr['vein']
        d *= np.clip(sideW[sel] * 1.5, 0, 1)
        total[sel] += d
        forms_info[s] = dict(verts=int(len(sel)), disp_mm_p99=round(float(np.percentile(np.abs(d), 99)), 3),
                             disp_mm_max=round(float(np.abs(d).max()), 3), **dr['stats'])
    co_new = (co + nr * total[:, None]) / 1000.0
    me.vertices.foreach_set('co', co_new.astype(np.float32).ravel()); me.update()
    print('[export] hand forms', forms_info)
for o in meshes:
    if o == body: continue
    activate(o)
    for m in list(o.modifiers):
        if m.type == 'SUBSURF':
            if SUBDIV > 0 and not any(k in o.name for k in ('strands', 'eyelash', 'eyebrow', 'cap')):
                m.levels = SUIT_SUBDIV if 'elegantsuit' in o.name else SUBDIV
                bpy.ops.object.modifier_apply(modifier=m.name)
            else:
                o.modifiers.remove(m)
        elif m.type == 'MASK':
            bpy.ops.object.modifier_apply(modifier=m.name)

suit = [o for o in meshes if 'elegantsuit' in o.name][0]
# 4a') compression folds as geometry (tools/pianist/py/suitfolds.py; the same strain model the suit normal map used):
# displacement along the vertex normal of the subdivided bind mesh, inward part limited (clearance to the arm/body)
folds_info = {}
if SUIT_FOLDS > 0:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'py'))
    import suitfolds as SFD
    me = suit.data; me.update()
    nV = len(me.vertices)
    co = np.zeros(nV * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.zeros(nV * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    uvl = me.uv_layers.active.data
    tri_v, tri_uv = [], []
    for p in me.polygons:
        li = list(p.loop_indices)
        for k in range(1, len(li) - 1):
            ls = (li[0], li[k], li[k + 1])
            tri_v.append([me.loops[l].vertex_index for l in ls]); tri_uv.append([uvl[l].uv[:] for l in ls])
    Mw = np.array(suit.matrix_world)
    sc = float(np.cbrt(abs(np.linalg.det(Mw[:3, :3]))))                       # object -> metres (uniform scale)
    disp, folds_info = SFD.fold_displacement(co * sc * 1000.0, np.array(tri_v), np.array(tri_uv), SUIT_FOLDS)
    co = co + nr * (disp[:, None] / 1000.0 / sc)
    me.vertices.foreach_set('co', co.astype(np.float32).ravel()); me.update()
    folds_info['suit_subdiv'] = SUIT_SUBDIV; folds_info['verts'] = nV
    print('[export] suit folds', folds_info)

# 4b) suit: real thickness. Solidify outward (the simulated surface becomes the lining side, so the clearance to the
# body and the shirt cuffs inside the sleeves is unchanged); rims close every hem, lapel, vent and cuff edge.
lining = bpy.data.materials.new('pianist_lining'); lining.use_nodes = True
_b = lining.node_tree.nodes['Principled BSDF']
_b.inputs['Base Color'].default_value = (0.018, 0.016, 0.02, 1); _b.inputs['Roughness'].default_value = 0.42
suit_mat = suit.data.materials[0]
suit.data.materials.clear(); suit.data.materials.append(lining); suit.data.materials.append(suit_mat)
# The ORIGINAL faces stay the visible outer surface (checked in three.js 2026-10-21: with original = lining the whole
# jacket rendered with the lining material and only the rims got the suit's pinstripe/seam/fold maps). So: original
# faces = suit (1), the generated shell = lining (1 - 1 = 0), the rims (hem/lapel/cuff edges) = suit (1 + 0).
for p in suit.data.polygons: p.material_index = 1
activate(suit)
nv0 = len(suit.data.vertices)
sm = suit.modifiers.new('Solidify', 'SOLIDIFY')
sm.thickness = SUIT_THICK; sm.offset = 1.0; sm.use_rim = True; sm.use_even_offset = False; sm.use_quality_normals = True
sm.thickness_clamp = 1.0      # never offset more than the adjacent edge length (even offset blew up folded corners)
sm.material_offset = -1; sm.material_offset_rim = 0
bpy.ops.object.modifier_apply(modifier=sm.name)
solid_info = dict(thickness_mm=SUIT_THICK * 1000, verts_before=nv0, verts_after=len(suit.data.vertices))
# check: the suit-material faces must be the OUTER shell (their normals point away from the body, and they lie farther
# from it than the lining faces)
_dg = bpy.context.evaluated_depsgraph_get(); _bb = BVHTree.FromObject(body, _dg)
_side = {0: [], 1: []}
for _pi in range(0, len(suit.data.polygons), 7):
    p = suit.data.polygons[_pi]
    c = p.center; hit = _bb.find_nearest(c)
    if hit[0] is None: continue
    _side.setdefault(p.material_index, []).append(((c - hit[0]).normalized().dot(p.normal), (c - hit[0]).length))
solid_info['outer_check'] = {('suit' if k == 1 else 'lining'): dict(mean_normal_dot_away=round(float(np.mean([a for a, _ in v])), 3),
                                                                     mean_dist_mm=round(float(np.mean([b for _, b in v])) * 1000, 2), n=len(v))
                             for k, v in _side.items() if v}
if solid_info['outer_check'].get('suit', {}).get('mean_normal_dot_away', 1) < solid_info['outer_check'].get('lining', {}).get('mean_normal_dot_away', 0):
    raise SystemExit(f"[export] suit material is not on the outer shell: {solid_info['outer_check']}")
print('[export] suit solidify', solid_info)

# 4c) hands: own material + UV remap of the two hand UV islands into one HAND_TEX texture (R left square, L right).
body = [o for o in meshes if o.name.endswith('body')][0]
import bmesh
bm = bmesh.new(); bm.from_mesh(body.data)
uvl = bm.loops.layers.uv.active
bm.faces.ensure_lookup_table()
gi = {g.index: g.name for g in body.vertex_groups}
dom = []
for v in body.data.vertices:
    gs = {gi[g.group]: g.weight for g in v.groups if gi[g.group] in {b.name for b in arm.data.bones}}
    dom.append(max(gs, key=gs.get) if gs else '')
parent = list(range(len(bm.faces)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
first = {}
for f in bm.faces:
    for l in f.loops:
        k = (l.vert.index, round(l[uvl].uv.x, 5), round(l[uvl].uv.y, 5))
        if k in first:
            a, b2 = find(first[k]), find(f.index)
            if a != b2: parent[a] = b2
        else:
            first[k] = f.index
from collections import defaultdict
isl = defaultdict(list)
for f in bm.faces: isl[find(f.index)].append(f.index)
hand_isl = {}
for r, fs in isl.items():
    cnt = defaultdict(int)
    for fi in fs:
        for v in bm.faces[fi].verts:
            d = dom[v.index]
            if d.startswith('finger'): cnt[d[-1]] += 1
    if len(fs) > 2000 and cnt:
        side = max(cnt, key=cnt.get)
        if cnt[side] > 0.5 * sum(len(bm.faces[fi].verts) for fi in fs):
            hand_isl[side] = fs
assert set(hand_isl) == {'L', 'R'}, f'hand UV islands not found: {list(hand_isl)}'
hand_mat_src = body.data.materials[0]
hand = bpy.data.materials.new('pianist_skin_hand'); hand.use_nodes = True
_hb = hand.node_tree.nodes['Principled BSDF']
_ph = bpy.data.images.new('hand_placeholder', 4, 4); _ph.pixels.foreach_set(np.tile([0.55, 0.38, 0.30, 1.0], 16).astype(np.float32))
_ti = hand.node_tree.nodes.new('ShaderNodeTexImage'); _ti.image = _ph
hand.node_tree.links.new(_ti.outputs['Color'], _hb.inputs['Base Color'])
_hb.inputs['Roughness'].default_value = 0.45
body.data.materials.append(hand)
HMAT = len(body.data.materials) - 1
W, H = HAND_TEX; half = W // 2
layout = {}
for side, ox in (('R', 0), ('L', half)):
    fs = hand_isl[side]
    us = [l[uvl].uv.x for fi in fs for l in bm.faces[fi].loops]; vs = [l[uvl].uv.y for fi in fs for l in bm.faces[fi].loops]
    u0, v0, u1, v1 = min(us), min(vs), max(us), max(vs)
    k = (half - 2 * HAND_MARGIN_PX) / max(u1 - u0, v1 - v0)      # pixels per original UV unit
    padx = (half - (u1 - u0) * k) / 2; pady = (H - (v1 - v0) * k) / 2
    for fi in fs:
        f = bm.faces[fi]; f.material_index = HMAT
        for l in f.loops:
            uv = l[uvl].uv
            px = ox + padx + (uv.x - u0) * k; py = pady + (uv.y - v0) * k
            l[uvl].uv = (px / W, py / H)
    layout[side] = dict(atlas_bbox=[round(u0, 5), round(v0, 5), round(u1, 5), round(v1, 5)], px_per_atlas_uv=round(k, 2),
                        scale_vs_atlas2048=round(k / 2048, 3), faces=len(fs), offset_px=[round(ox + padx, 1), round(pady, 1)])
# exposed ankle skin between trouser hem and shoe (the foot pitches up on the pedal; the left foot is flat) -> socks
sock = bpy.data.materials.new('pianist_sock'); sock.use_nodes = True
_sb = sock.node_tree.nodes['Principled BSDF']
_sb.inputs['Base Color'].default_value = (0.012, 0.012, 0.014, 1); _sb.inputs['Roughness'].default_value = 0.85
body.data.materials.append(sock); SMAT = len(body.data.materials) - 1
n_sock = 0
for f in bm.faces:
    if f.material_index == HMAT: continue
    ds = [dom[v.index] for v in f.verts]
    if all(d.startswith(('lowerleg', 'foot', 'toe')) for d in ds):
        f.material_index = SMAT; n_sock += 1
bm.to_mesh(body.data); body.data.update(); bm.free()
print('[export] hand UV layout', layout, '| sock faces', n_sock)

# 4d) per-vertex skin thickness along -normal (ray to the far side, capped at 6 cm): fingers ~12-18 mm, ears ~3-8 mm.
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(body, dg)
body.data.calc_loop_triangles() if hasattr(body.data, 'calc_loop_triangles') else None
thick = np.zeros(len(body.data.vertices), np.float32)
for v in body.data.vertices:
    n = v.normal
    hit = bvh.ray_cast(v.co - n * 1e-4, -n, 0.06)
    thick[v.index] = hit[3] if hit[0] is not None else 0.06
if '_THICK' in body.data.attributes: body.data.attributes.remove(body.data.attributes['_THICK'])
ta = body.data.attributes.new('_THICK', 'FLOAT', 'POINT'); ta.data.foreach_set('value', thick)
thick_info = dict(p5_mm=round(float(np.percentile(thick, 5)) * 1000, 1), median_mm=round(float(np.median(thick)) * 1000, 1),
                  fingers_median_mm=round(float(np.median(thick[[i for i, d in enumerate(dom) if d.startswith('finger')]])) * 1000, 1))
print('[export] thickness', thick_info)
# 5) weights
deform = {b.name for b in arm.data.bones if b.use_deform}
stats = {}
# measure what the 4-influence limit costs in a typical performance pose AWAY from the bind pose
from mathutils import Quaternion
TEST_POSE = {'upperarm01_R': ('X', 15), 'lowerarm01_R': ('X', 12), 'wrist_R': ('X', -15), 'upperarm01_L': ('Z', 10),
             'spine02': ('X', 6), 'neck02': ('X', 8), 'head': ('X', 8),
             **{f'finger{f}-{j}_R': ('X', 20) for f in (2, 3, 4) for j in (1, 2)}}
def set_test_pose(on):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        if on and pb.name in TEST_POSE:
            ax, deg = TEST_POSE[pb.name]
            pb.rotation_quaternion = Quaternion({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[ax], np.radians(deg))
        else:
            pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
def posed_now(o):
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); me = e.to_mesh()
    a = np.array([v.co[:] for v in me.vertices]); e.to_mesh_clear(); return a
for o in meshes:
    for g in list(o.vertex_groups):
        if g.name not in deform:
            o.vertex_groups.remove(g)
set_test_pose(True)
full = {o.name: posed_now(o) for o in meshes if o.vertex_groups}
set_test_pose(False)
for o in meshes:
    activate(o)
    hist = {}
    for v in o.data.vertices:
        k = sum(1 for g in v.groups if g.weight > 1e-5)
        hist[k] = hist.get(k, 0) + 1
    if o.vertex_groups:
        bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=1e-4)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=MAXINF)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    stats[o.name] = dict(verts=len(o.data.vertices), tris=sum(len(p.vertices) - 2 for p in o.data.polygons),
                         influences_before_limit=dict(sorted(hist.items())),
                         materials=[m.name for m in o.data.materials if m])
set_test_pose(True)
for o in meshes:
    if o.name in full:
        d = np.linalg.norm(posed_now(o) - full[o.name], axis=1) * 1000
        stats[o.name]['limit4_error_mm_in_test_pose'] = dict(mean=round(float(d.mean()), 3), p99=round(float(np.percentile(d, 99)), 3),
                                                            max=round(float(d.max()), 2))
set_test_pose(False)
# 6) export
for x in bpy.context.view_layer.objects: x.select_set(False)
arm.select_set(True)
for o in meshes: o.select_set(True)
kw = dict(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True,
          export_influence_nb=MAXINF, export_all_influences=False, export_animations=False,
          export_yup=True, export_apply=False, export_morph=False, export_image_format='AUTO',
          export_texcoords=True, export_normals=True, export_materials='EXPORT', export_attributes=True)
try:
    bpy.ops.export_scene.gltf(export_vertex_color='MATERIAL', **kw)
except TypeError:
    bpy.ops.export_scene.gltf(**kw)
bpy.ops.wm.save_as_mainfile(filepath=OUT[:-4] + '_bind.blend')
json.dump(dict(rest='seated', frame=FRAME, subdiv=SUBDIV, body_subdiv=BODY_SUBDIV, hand_forms=forms_info, maxinf=MAXINF, bones=len(arm.data.bones), meshes=stats,
               cloth=cloth_info, suit_solidify=solid_info, suit_folds=folds_info, hand_tex=dict(size=list(HAND_TEX), margin_px=HAND_MARGIN_PX, layout=layout),
               skin_thickness=thick_info,
               bone_lengths={b.name: round(b.length, 5) for b in arm.data.bones},
               deform_bones=sum(1 for b in arm.data.bones if b.use_deform),
               bytes=os.path.getsize(OUT), seconds=round(time.time() - t0, 1)), open(OUT + '.json', 'w'), indent=1)
print('[export] wrote', OUT, os.path.getsize(OUT), 'bytes in', round(time.time() - t0, 1), 's')
