"""Stage 1 (v6): headless MPFB2 build of the pianist base character.

  blender -b --factory-startup -noaudio --python p1_build.py -- <out_dir>

Explicit phenotype + CC0 targets + CC0 clothes; no hair asset (hair and beard are generated in p3_hair.py).
Writes <out_dir>/p1.blend and p1_report.json (objects, counts, stature, hand length, UV texel density of the hand).
Deterministic: no randomness.
"""
import bpy, sys, os, json, time, math, importlib
import addon_utils
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0]
os.makedirs(OUT, exist_ok=True)
t0 = time.time()
MOD = 'bl_ext.user_default.mpfb'
addon_utils.enable(MOD, default_set=True)
HumanService = importlib.import_module(MOD + '.services.humanservice').HumanService

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# MakeHuman age macro: 0.5 -> 25 y, 1.0 -> 90 y (linear between) => 35 y = 0.5 + 10/65*0.5 = 0.577
phenotype = {
    "gender": 1.0, "age": 0.577, "muscle": 0.52, "weight": 0.40,
    "proportions": 0.70, "height": 0.52, "cupsize": 0.5, "firmness": 0.5,
    "race": {"asian": 0.05, "caucasian": 0.85, "african": 0.10},
}
targets = []
for side in ('l', 'r'):
    targets += [
        {"target": f"{side}-hand-fingers-length-incr", "value": 0.15},
        {"target": f"{side}-hand-fingers-diameter-decr", "value": 0.30},
    ]
# CC0 'Hands 01' pack (Mindfront, jujube): anatomical hand corrections
for t, v in (("mindfront_hand_fingers_correction", 1.0), ("mindfront_hand_hypothenar", 1.0),
             ("mindfront_hand_thenar_eminence", 1.0), ("jujube_knobby_knuckles", 0.6)):
    targets.append({"target": t, "value": v})

human_info = {
    "name": "Pianist",
    "phenotype": phenotype,
    "rig": "default",
    "eyes": "high-poly/high-poly.mhclo",
    "eyebrows": "eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes01/eyelashes01.mhclo",
    "teeth": "", "tongue": "", "hair": "", "proxy": "",
    "targets": targets,
    "clothes": ["male_elegantsuit01/male_elegantsuit01.mhclo", "shoes04/shoes04.mhclo"],
    "skin_mhmat": "mindfront_aksel_skin/mindfront_aksel_skin.mhmat",
    "skin_material_type": "GAMEENGINE",
    "eyes_material_type": "MAKESKIN",
    "clothes_material_type": "MAKESKIN",
    "skin_material_settings": {}, "eyes_material_settings": {}, "expressions": [],
}
settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 1
basemesh = HumanService.deserialize_from_dict(human_info, settings)
print('[p1] basemesh', basemesh.name, len(basemesh.data.vertices), 'verts', round(time.time() - t0, 1), 's')

arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = basemesh
bpy.context.view_layer.update()

# ---------------- wrist pivot fix ----------------
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pianist_config as cfg
from mathutils.kdtree import KDTree

def rest_co(o):
    saved = [(m, m.show_viewport) for m in o.modifiers]
    for m in o.modifiers:
        m.show_viewport = (m.type == 'ARMATURE')
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); me = e.to_mesh()
    V = [o.matrix_world @ v.co for v in me.vertices]
    e.to_mesh_clear()
    for m, sv in saved: m.show_viewport = sv
    return V

def shift_wrist_weights(o, s, w_old, ax, shift):
    """Shift the forearm->hand weight blend distally by `shift` along ax: the 'hand fraction' f(v) of every vertex near the
    wrist becomes the old fraction sampled `shift` proximally (same angular position). Returns (changed, max |df|)."""
    V = rest_co(o)
    gi = {g.index: g.name for g in o.vertex_groups}
    handg = lambda k: k == f'wrist.{s}' or (k.endswith('.' + s) and k.startswith(('finger', 'metacarpal')))
    forg = lambda k: k.endswith('.' + s) and k.startswith('lowerarm')
    u = ax.orthogonal().normalized(); v2 = ax.cross(u)
    rec = []
    for i, vt in enumerate(o.data.vertices):
        gs = {gi[g.group]: g.weight for g in vt.groups}
        h = sum(x for k, x in gs.items() if handg(k)); f_ = sum(x for k, x in gs.items() if forg(k))
        if h + f_ < 1e-6: continue
        q = V[i] - w_old; d = q.dot(ax); rv = q - ax * d
        if not (-0.06 < d < 0.09 and rv.length < 0.07): continue
        th = math.atan2(rv.dot(v2), rv.dot(u))
        rec.append((i, d, th, h / (h + f_), gs))
    kd = KDTree(len(rec))
    R0 = 0.022
    for k, (i, d, th, f, gs) in enumerate(rec):
        kd.insert((d, math.cos(th) * R0, math.sin(th) * R0), k)
    kd.balance()
    newf = []
    for (i, d, th, f, gs) in rec:
        if d - shift < -0.055:
            newf.append(0.0 if f < 0.05 else f); continue
        hits = kd.find_n((d - shift, math.cos(th) * R0, math.sin(th) * R0), 6)
        ws = [1.0 / (dist + 1e-4) for _, _, dist in hits]
        newf.append(sum(rec[idx][3] * wgt for (_, idx, _), wgt in zip(hits, ws)) / sum(ws))
    changed, dmax = 0, 0.0
    groups = {g.name: g for g in o.vertex_groups}
    if f'wrist.{s}' not in groups: o.vertex_groups.new(name=f'wrist.{s}'); groups = {g.name: g for g in o.vertex_groups}
    if f'lowerarm02.{s}' not in groups: o.vertex_groups.new(name=f'lowerarm02.{s}'); groups = {g.name: g for g in o.vertex_groups}
    for (i, d, th, f, gs), fn in zip(rec, newf):
        fn = min(1.0, max(0.0, fn))
        if abs(fn - f) < 1e-3: continue
        tot = sum(x for k, x in gs.items() if handg(k) or forg(k))
        hk = {k: x for k, x in gs.items() if handg(k)}; fk = {k: x for k, x in gs.items() if forg(k)}
        hs, fs = sum(hk.values()), sum(fk.values())
        new = {}
        if hs > 1e-6:
            for k, x in hk.items(): new[k] = x / hs * fn * tot
        else:
            new[f'wrist.{s}'] = fn * tot
        if fs > 1e-6:
            for k, x in fk.items(): new[k] = x / fs * (1 - fn) * tot
        else:
            new[f'lowerarm02.{s}'] = (1 - fn) * tot
        for k, x in new.items():
            groups[k].add([i], x, 'REPLACE')
        changed += 1; dmax = max(dmax, abs(fn - f))
    return changed, round(dmax, 3)

wrist_fix = {}
if cfg.WRIST_SHIFT > 0:
    clothes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm and o != body]
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    olds = {}
    for s in ('L', 'R'):
        w = eb[f'wrist.{s}']; la = eb[f'lowerarm02.{s}']
        ax = (la.tail - la.head).normalized()
        old = w.head.copy(); olds[s] = (old.copy(), ax.copy())
        tail_old = w.tail.copy()
        w.head = old + ax * cfg.WRIST_SHIFT
        la.tail = w.head.copy()
        wrist_fix[s] = dict(connected=bool(w.use_connect), wrist_len_old_mm=round((tail_old - old).length * 1000, 1),
                            wrist_len_new_mm=round((w.tail - w.head).length * 1000, 1), shift_mm=cfg.WRIST_SHIFT * 1000)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    for s, (old, ax) in olds.items():
        wrist_fix[s]['weights_body'] = shift_wrist_weights(body, s, arm.matrix_world @ old, ax, cfg.WRIST_SHIFT)
        for o in clothes:
            if any(g.name in (f'wrist.{s}', f'lowerarm02.{s}') for g in o.vertex_groups):
                wrist_fix[s]['weights_' + o.name] = shift_wrist_weights(o, s, arm.matrix_world @ old, ax, cfg.WRIST_SHIFT)
    print('[p1] wrist fix', wrist_fix)

# ---------------- measurements on the evaluated (targets applied) body ----------------
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
me = ev.to_mesh()
# note: evaluated mesh includes subdiv + masks; use the cage with shape keys for measurement instead
ev.to_mesh_clear()
for m in body.modifiers:
    m.show_viewport = (m.type == 'ARMATURE')
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
me = ev.to_mesh()
co = [body.matrix_world @ v.co for v in me.vertices]
gi = {g.index: g.name for g in body.vertex_groups}
deform = {b.name for b in arm.data.bones if b.use_deform}
real = []
dom = []
for v in body.data.vertices:
    gs = {gi[g.group]: g.weight for g in v.groups}
    real.append(gs.get('body', 0) > 0)
    dw = {k: w for k, w in gs.items() if k in deform and w > 1e-4}
    dom.append(max(dw, key=dw.get) if dw else None)
zs = [c.z for c, r in zip(co, real) if r]
rep = {"stature_m": round(max(zs) - min(zs), 4)}
B = arm.data.bones
M = arm.matrix_world
hand = {}
for s in ('L', 'R'):
    w = M @ B[f'wrist.{s}'].head_local
    tip3 = M @ B[f'finger3-3.{s}'].tail_local
    axis = (tip3 - w).normalized()
    ids = [i for i, d in enumerate(dom) if real[i] and d and d.endswith('.' + s) and d.startswith('finger3')]
    far = max((co[i] - w).dot(axis) for i in ids)
    # hand length (anthropometric) = wrist crease -> middle fingertip; the crease is ~12 mm distal to the joint centre
    hand[s] = {"wrist_joint_to_mid_tip_mm": round(far * 1000, 1), "hand_length_mm_est": round(far * 1000 - 12, 1)}
    segs = {}
    for f in range(1, 6):
        segs[f'finger{f}'] = [round(B[f'finger{f}-{j}.{s}'].length * 1000, 1) for j in (1, 2, 3)]
    for k in range(1, 5):
        segs[f'metacarpal{k}'] = round(B[f'metacarpal{k}.{s}'].length * 1000, 1)
    hand[s]["bone_lengths_mm"] = segs
rep["hands"] = hand
ev.to_mesh_clear()
for m in body.modifiers:
    m.show_viewport = True

# texel density of the hand on the body UV (2048^2 skin atlas)
uvl = body.data.uv_layers.active
area3, areauv = 0.0, 0.0
bm = bmesh.new(); bm.from_mesh(body.data)
uv = bm.loops.layers.uv.active
bm.faces.ensure_lookup_table()
umin, vmin, umax, vmax = 9, 9, -9, -9
for f in bm.faces:
    vs = [v.index for v in f.verts]
    if not all(real[i] for i in vs):
        continue
    d = [dom[i] for i in vs]
    if not all(x and x.endswith('.R') and x.startswith(('finger', 'metacarpal')) for x in d):
        continue
    p = [co[i] for i in vs]
    q = [l[uv].uv for l in f.loops]
    for k in range(1, len(p) - 1):
        area3 += ((p[k] - p[0]).cross(p[k + 1] - p[0])).length / 2
        a, b = q[k] - q[0], q[k + 1] - q[0]
        areauv += abs(a.x * b.y - a.y * b.x) / 2
    for t in q:
        umin, vmin, umax, vmax = min(umin, t.x), min(vmin, t.y), max(umax, t.x), max(vmax, t.y)
bm.free()
TEX = 2048
rep["right_hand_fingers_palm"] = {
    "surface_cm2": round(area3 * 1e4, 1),
    "uv_fraction": round(areauv, 5),
    "uv_bbox": [round(x, 4) for x in (umin, vmin, umax, vmax)],
    "texels_per_mm_at_2048": round(math.sqrt(areauv * TEX * TEX / (area3 * 1e6)), 3),
}

report = {"objects": [], "measure": rep, "wrist_fix": wrist_fix, "phenotype": phenotype, "targets": targets,
          "assets": {"clothes": human_info["clothes"], "skin": human_info["skin_mhmat"], "rig": "default"}}
for o in bpy.data.objects:
    d = {"name": o.name, "type": o.type}
    if o.type == 'MESH':
        d.update(verts=len(o.data.vertices), faces=len(o.data.polygons), modifiers=[m.type for m in o.modifiers],
                 materials=[m.name for m in o.data.materials if m])
    if o.type == 'ARMATURE':
        d.update(bones=len(o.data.bones))
    report["objects"].append(d)
json.dump(report, open(os.path.join(OUT, 'p1_report.json'), 'w'), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'p1.blend'))
print('[p1] measure', json.dumps(rep))
print('[p1] done in', round(time.time() - t0, 1), 's')
