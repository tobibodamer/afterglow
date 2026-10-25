"""Measure how much limiting skin weights to N influences (Three.js = 4) moves vertices in the seated pose.
  blender -b stage2_posed.blend --python weight_limit_error.py -- <out.json>
"""
import bpy, sys, json
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = [o for o in bpy.data.objects if o.name.endswith('.body')][0]
for m in body.modifiers:
    if m.type != 'ARMATURE': m.show_viewport = False   # compare on the cage, no subdiv/masks
def posed(o):
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); me = e.to_mesh()
    a = np.array([v.co[:] for v in me.vertices]); e.to_mesh_clear(); return a
ref = posed(body)
gi = {g.index: g.name for g in body.vertex_groups}
deform = {b.name for b in arm.data.bones if b.use_deform}
hand = np.zeros(len(body.data.vertices), bool); real = np.zeros(len(body.data.vertices), bool)
for v in body.data.vertices:
    gs = {gi[g.group]: g.weight for g in v.groups}
    real[v.index] = gs.get('body', 0) > 0
    dw = {k: w for k, w in gs.items() if k in deform}
    if dw and max(dw, key=dw.get).startswith(('finger', 'metacarpal', 'wrist')): hand[v.index] = True
res = {}
bpy.context.view_layer.objects.active = body; body.select_set(True)
for N in (6, 4, 3):
    bak = {v.index: [(g.group, g.weight) for g in v.groups] for v in body.data.vertices}
    bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=N)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
    d = np.linalg.norm(posed(body) - ref, axis=1) * 1000.0
    r = {}
    for k, msk in (('all_body', real), ('hands', real & hand)):
        dd = d[msk]; r[k] = dict(mean_mm=round(float(dd.mean()), 3), p99_mm=round(float(np.percentile(dd, 99)), 3),
                                 max_mm=round(float(dd.max()), 3), n=int(msk.sum()))
    res[f'limit{N}'] = r
    # restore
    for v in body.data.vertices:
        for g in list(v.groups): body.vertex_groups[g.group].remove([v.index])
    for i, gl in bak.items():
        for g, w in gl: body.vertex_groups[g].add([i], w, 'REPLACE')
print('[wle]', json.dumps(res))
json.dump(res, open(argv[0], 'w'), indent=1)
