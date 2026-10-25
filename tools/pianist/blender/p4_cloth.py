"""Stage 5 (v6): Blender cloth simulation of the suit (jacket + trousers + shirt front, one MakeHuman proxy mesh)
while the rig moves from the A pose (frame 1) to the seated pose (frame 40), then settles (to frame END).

  blender -b p2.blend --python p4_cloth.py -- <out_dir> [--end 70] [--quality 6] [--subdiv 0]

Armature -> Cloth -> (Subdivision) on the suit; the body is a collider (after its helper mask, before subdivision).
Pin group 'cloth_pin': 1.0 at collar/shoulder yoke/waistband, a weak 0.12 shape goal elsewhere (keeps sleeves and
trouser legs from sliding; folds still form). Writes p4.blend with the baked cache and p4_cloth.json (timings, motion stats).
"""
import bpy, sys, os, time, json, math
import numpy as np
from mathutils import Vector
import hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pianist_config as cfg
argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
def opt(k, d, f=int):
    return f(argv[argv.index(k) + 1]) if k in argv else d
END = opt('--end', 90)
QUAL = opt('--quality', 6)
SUBD = opt('--subdiv', 0)
BEND = opt('--bend', 10.0, float)            # wool + canvas interlining: stiffer than v11's 6 (skirt crumpled)
BODY_FRICTION = opt('--body-friction', 5.0, float)
BENCH_FRICTION = opt('--bench-friction', 1.5, float)   # v11 used 10: the skirt could not slide back over the seat
FROZEN = argv[argv.index('--freeze') + 1] if '--freeze' in argv else None
FR = 40
t0 = time.time()
scn = bpy.context.scene
scn.frame_start, scn.frame_end = 1, END
scn.render.fps = 24
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = [o for o in bpy.data.objects if o.name.endswith('.body')][0]
suit = [o for o in bpy.data.objects if 'elegantsuit' in o.name][0]
# hold the seated pose after FR
for fc in arm.animation_data.action.fcurves if hasattr(arm.animation_data.action, 'fcurves') else []:
    for kp in fc.keyframe_points:
        kp.interpolation = 'BEZIER'

deform = {b.name for b in arm.data.bones if b.use_deform}
# ---------- pin group from the suit's skin weights ----------
gi = {g.index: g.name for g in suit.vertex_groups}
pin = suit.vertex_groups.new(name='cloth_pin')
hard = ('neck', 'clavicle', 'shoulder01', 'spine03', 'spine02', 'spine01')
stats = {'hard': 0, 'soft': 0}
co = [suit.matrix_world @ v.co for v in suit.data.vertices]
zmax = max(c.z for c in co)
uvd = suit.data.uv_layers.active.data
button_verts = set()
for p in suit.data.polygons:      # button discs live in the top-left of the suit UV atlas (u < 0.36, v > 0.85)
    if all(uvd[li].uv.x < 0.36 and uvd[li].uv.y > 0.85 for li in p.loop_indices):
        button_verts.update(p.vertices)
B = arm.data.bones
ARMAX ={s: (B[f'wrist.{s}'].head_local.copy(), (B[f'wrist.{s}'].head_local - B[f'lowerarm01.{s}'].head_local).normalized()) for s in ('L', 'R')}
free_gi = suit.vertex_groups['skirt_free'].index if 'skirt_free' in suit.vertex_groups else -1
for v, c in zip(suit.data.vertices, co):
    gs = {gi[g.group]: g.weight for g in v.groups if gi[g.group] in deform}
    free = sum(g.weight for g in v.groups if g.group == free_gi)
    w = 0.12 * (1.0 - free)          # the back/side skirt drapes freely (p3 free_skirt)
    # tailored sleeve ends keep their shape (interfacing, buttons): the distal ~9 cm follow the skinning exactly
    # (w = 1 from 8 cm above the wrist pivot), ramping from the soft 0.12 goal over the 6 cm above that.
    # Simulating the hem at proxy resolution crumples it into shards next to the cuff (seen in v8).
    for s, (wp, ax) in ARMAX.items():
        d = (c - wp).dot(ax) + cfg.WRIST_SHIFT        # relative to the original MakeHuman pivot (zones tuned in v10)
        if -0.14 < d < 0.04 and (c - wp - ax * d).length < 0.08:
            w = max(w, 0.12 + 0.88 * min(1.0, max(0.0, (d + 0.14) / 0.06)))
    if c.z < 0.10:
        w = max(w, 0.6)
    if v.index in button_verts:     # buttons are rigid: follow the skinning
        w = 1.0
    if gs:
        upper = sum(x for k, x in gs.items() if k.startswith(hard))
        tot = sum(gs.values())
        f = upper / tot
        if f > 0.6 and c.z > 1.30:          # shoulder yoke and collar
            w = 1.0
        # trouser waistband: verts dominated by spine05/pelvis near the belt line (A pose: z 0.98-1.06)
        waist = sum(x for k, x in gs.items() if k.startswith(('spine05', 'pelvis', 'spine04'))) / tot
        if waist > 0.5 and 0.98 < c.z < 1.07 and abs(c.y) < 0.2:
            w = max(w, 0.8)
    pin.add([v.index], w, 'REPLACE')
    stats['hard' if w >= 0.8 else 'soft'] += 1

# ---------- modifier stacks ----------
def move_to(o, name, idx):
    bpy.context.view_layer.objects.active = o
    while o.modifiers.find(name) > idx:
        bpy.ops.object.modifier_move_up(modifier=name)
# suit: Armature, Cloth, (Subdivision)
for m in suit.modifiers:
    if m.type == 'SUBSURF':
        m.levels = SUBD; m.render_levels = SUBD
cl = suit.modifiers.new('Cloth', 'CLOTH')
move_to(suit, 'Cloth', [m.type for m in suit.modifiers].index('ARMATURE') + 1)
s = cl.settings
s.quality = QUAL
s.mass = 0.25
s.air_damping = 1.0
s.tension_stiffness = 20; s.compression_stiffness = 20; s.shear_stiffness = 10; s.bending_stiffness = 6.0
s.tension_damping = 5; s.compression_damping = 5; s.shear_damping = 5; s.bending_damping = 1.0
s.bending_stiffness = BEND
s.vertex_group_mass = 'cloth_pin'
s.pin_stiffness = 1.5
s.shrink_min = 0.0
c = cl.collision_settings
c.collision_quality = 4
c.distance_min = 0.003
c.use_self_collision = True
c.self_distance_min = 0.002
c.self_friction = 5
c.impulse_clamp = 0.0
cl.point_cache.frame_start = 1; cl.point_cache.frame_end = END
# body collider after the helper mask
col = body.modifiers.new('Collision', 'COLLISION')
names = [m.name for m in body.modifiers]
target = names.index('Hide helpers') + 1 if 'Hide helpers' in names else 1
move_to(body, 'Collision', target)
body.collision.thickness_outer = 0.004
body.collision.cloth_friction = BODY_FRICTION
body.collision.damping = 0.5
# (shirt cuffs are NOT colliders any more: the sleeve end is pinned to the skinning, the cuff is tapered inside it)
for o in bpy.data.objects:   # reference props: the bench is a collider too (the jacket skirt rests on it)
    if o.name == 'bench':
        o.modifiers.new('Collision', 'COLLISION'); o.collision.thickness_outer = 0.003; o.collision.cloth_friction = BENCH_FRICTION

print('[cloth] stacks', [m.type for m in suit.modifiers], [m.type for m in body.modifiers], stats)
# ---------- bake ----------
def suit_pos():
    dg = bpy.context.evaluated_depsgraph_get(); e = suit.evaluated_get(dg); me = e.to_mesh()
    a = np.array([v.co[:] for v in me.vertices]); e.to_mesh_clear(); return a
tb = time.time()
bpy.ops.ptcache.bake_all(bake=True)
bake_s = time.time() - tb
# settle check: motion over the last 10 frames
scn.frame_set(END - 10); a = suit_pos()
scn.frame_set(END); b = suit_pos()
mv = np.linalg.norm(b - a, axis=1) * 1000
# compare against pure skinning (cloth disabled) at the seated pose
cl.show_viewport = False
scn.frame_set(END); lbs = suit_pos()
cl.show_viewport = True
scn.frame_set(END); sim = suit_pos()
dev = np.linalg.norm(sim - lbs, axis=1) * 1000
rep = dict(verts=len(suit.data.vertices), quality=QUAL, end=END, subdiv=SUBD, bake_seconds=round(bake_s, 1),
           sec_per_frame=round(bake_s / END, 2), pin=stats,
           settle_last10_mm=dict(mean=round(float(mv.mean()), 2), p99=round(float(np.percentile(mv, 99)), 2), max=round(float(mv.max()), 2)),
           sim_vs_skinning_mm=dict(mean=round(float(dev.mean()), 1), p90=round(float(np.percentile(dev, 90)), 1), max=round(float(dev.max()), 1)))
print('[cloth]', json.dumps(rep))
json.dump(rep, open(os.path.join(OUT, 'p4_cloth.json'), 'w'), indent=1)
# ---------- post: relax crumpled shards (proxy-resolution cloth crumples into 1-2 cm facets at the waist / shins) ----------
from mathutils.bvhtree import BVHTree
def relax_shards(X, iters=24, thresh_deg=55.0, rings=2):
    me = suit.data
    F = [tuple(p.vertices) for p in me.polygons]
    n = len(X)
    nb = [set() for _ in range(n)]
    for f in F:
        for a, b in zip(f, f[1:] + f[:1]):
            nb[a].add(b); nb[b].add(a)
    nb = [np.array(sorted(s), np.int64) for s in nb]
    def face_normals(Y):
        out = []
        for f in F:
            p0, p1, p2 = Y[f[0]], Y[f[1]], Y[f[2]]
            c = np.cross(p1 - p0, p2 - p0); l = np.linalg.norm(c); out.append(c / l if l > 1e-12 else c)
        return np.array(out)
    edge_faces = {}
    for fi, f in enumerate(F):
        for a, b in zip(f, f[1:] + f[:1]):
            edge_faces.setdefault((min(a, b), max(a, b)), []).append(fi)
    FN = face_normals(X)
    sharp = np.zeros(n)
    for (a, b), fs in edge_faces.items():
        if len(fs) == 2:
            ang = np.degrees(np.arccos(np.clip(FN[fs[0]] @ FN[fs[1]], -1, 1)))
            sharp[a] = max(sharp[a], ang); sharp[b] = max(sharp[b], ang)
    seed = sharp > thresh_deg
    region = seed.copy()
    for _ in range(rings):
        grow = region.copy()
        for i in np.nonzero(region)[0]: grow[nb[i]] = True
        region = grow
    # pinned sleeve ends / buttons / collar keep their exact shape
    region &= np.array([w < 0.7 for w in pin_w])
    Y = X.copy()
    # over-stretched edges (a solver blow-up leaves a vertex tens of cm away): rebuild those vertices from their sane
    # neighbours, whatever their pin weight
    R0 = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    blown = np.zeros(n, bool)
    for (a, b), _fs in edge_faces.items():
        r = np.linalg.norm(R0[a] - R0[b]) + 1e-6
        if np.linalg.norm(Y[a] - Y[b]) / r > 2.5:
            # the endpoint farther from its own neighbourhood is the culprit
            ca = Y[nb[a]].mean(0); cb = Y[nb[b]].mean(0)
            if np.linalg.norm(Y[a] - ca) >= np.linalg.norm(Y[b] - cb): blown[a] = True
            else: blown[b] = True
    n_blown = int(blown.sum())
    for _ in range(8):
        if not blown.any(): break
        fixed = []
        for i in np.nonzero(blown)[0]:
            ok_nb = [j for j in nb[i] if not blown[j]]
            if ok_nb: Y[i] = Y[ok_nb].mean(0); fixed.append(i)
        blown[fixed] = False
    ids = np.nonzero(region)[0]
    for it in range(iters):
        for lam in (0.5, -0.53):
            L = np.array([Y[nb[i]].mean(0) - Y[i] if len(nb[i]) else np.zeros(3) for i in ids])
            Y[ids] += lam * L
    # de-spike (whole suit except pinned parts): a vertex far outside its neighbours' spread snaps to their centroid
    free_v = np.array([w < 0.7 for w in pin_w]) & np.array([len(nb[i]) >= 3 for i in range(n)])
    spikes = 0
    for _ in range(4):
        cen = np.array([Y[nb[i]].mean(0) if len(nb[i]) else Y[i] for i in range(n)])
        spread = np.array([np.median(np.linalg.norm(Y[nb[i]] - cen[i], axis=1)) if len(nb[i]) else 0 for i in range(n)])
        dev = np.linalg.norm(Y - cen, axis=1)
        bad = free_v & (dev > 1.2 * spread + 0.002)
        if not bad.any(): break
        Y[bad] = cen[bad]; spikes += int(bad.sum())
        ids = np.union1d(ids, np.nonzero(bad)[0])
    # push out of the body / bench colliders (3 mm), same as the solver's clearance
    bvhs = []
    for o in [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'COLLISION' for m in o.modifiers)]:
        saved = [(m, m.show_viewport) for m in o.modifiers]
        for m in o.modifiers: m.show_viewport = m.type == 'ARMATURE'      # the full body (no clothes masks), posed
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); me2 = e.to_mesh()
        Vb = [o.matrix_world @ v.co for v in me2.vertices]
        if 'body' in o.vertex_groups:
            bgi = o.vertex_groups['body'].index
            real = [any(g_.group == bgi and g_.weight > 0 for g_ in v.groups) for v in o.data.vertices]
        else:
            real = [True] * len(Vb)
        Fb = [tuple(p.vertices) for p in me2.polygons if all(real[i] for i in p.vertices)]
        bvhs.append(BVHTree.FromPolygons(Vb, Fb))
        e.to_mesh_clear()
        for m, s_ in saved: m.show_viewport = s_
    bpy.context.view_layer.update()
    moved = 0
    for i in ids:
        p = Vector(Y[i])
        for bvh in bvhs:
            loc, nrm, _, dist = bvh.find_nearest(p, 0.03)
            if loc is None: continue
            s = (p - loc).dot(nrm)
            if s < 0.003:
                p = loc + nrm * 0.003 + ((p - loc) - nrm * s); moved += 1
        Y[i] = p[:]
    d = np.linalg.norm(Y - X, axis=1) * 1000
    return Y, dict(seed_verts=int(seed.sum()), relaxed_verts=int(len(ids)), blown=n_blown, despiked=spikes, pushed=moved, max_dihedral_before=round(float(sharp.max()), 1),
                   move_mm=dict(mean=round(float(d[ids].mean()), 2) if len(ids) else 0, max=round(float(d.max()), 1)))
pin_w = [0.0] * len(suit.data.vertices)
_pg = suit.vertex_groups['cloth_pin'].index
for v in suit.data.vertices:
    for g_ in v.groups:
        if g_.group == _pg: pin_w[v.index] = g_.weight
sim, relax = relax_shards(sim)
rep['relax'] = relax
print('[cloth] relax', relax)
json.dump(rep, open(os.path.join(OUT, 'p4_cloth.json'), 'w'), indent=1)
# ---------- freeze: the simulated cage at END (Blender cloth is not reproducible run to run, research/human.md 0.1) ----------
def fingerprint(o):
    co = np.array([v.co[:] for v in o.data.vertices], dtype=np.float64)
    fs = np.array([len(p.vertices) for p in o.data.polygons], dtype=np.int32)
    pose = np.array([list(pb.head) for pb in arm.pose.bones], dtype=np.float64)   # the bake belongs to this pose too
    return hashlib.sha1(np.round(co, 4).tobytes() + fs.tobytes() + np.round(pose, 4).tobytes()).hexdigest()
scn.frame_set(END)
if FROZEN:
    os.makedirs(os.path.dirname(FROZEN), exist_ok=True)
    np.savez_compressed(FROZEN, posed=sim.astype(np.float32), frame=np.int32(END), verts=np.int32(len(suit.data.vertices)),
                        fingerprint=np.array(fingerprint(suit)), report=np.array(json.dumps(rep)))
    print('[cloth] frozen ->', FROZEN, 'fingerprint', fingerprint(suit))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'p4.blend'))
print('[cloth] done', round(time.time() - t0, 1), 's')
