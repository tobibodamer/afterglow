"""Measure hair volume: distance of hair-strand vertices from the scalp/body surface (rest pose), and the hair envelope.
  blender -b p3.blend --python probe_hair.py"""
import bpy, json
import numpy as np
from mathutils.bvhtree import BVHTree
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
for pb in arm.pose.bones:
    pb.matrix_basis.identity()
bpy.context.view_layer.update()
body = [o for o in bpy.data.objects if o.name.endswith('.body')][0]
hair = [o for o in bpy.data.objects if 'hair_strands' in o.name][0]
for m in body.modifiers:
    m.show_viewport = m.type in ('ARMATURE', 'MASK') and m.name == 'Hide helpers' or m.type == 'ARMATURE'
dg = bpy.context.evaluated_depsgraph_get()
e = body.evaluated_get(dg); me = e.to_mesh()
V = [body.matrix_world @ v.co for v in me.vertices]; F = [tuple(p.vertices) for p in me.polygons]
e.to_mesh_clear()
bvh = BVHTree.FromPolygons(V, F)
H = [hair.matrix_world @ v.co for v in hair.data.vertices]
d = np.array([bvh.find_nearest(p, 1.0)[3] for p in H]) * 1000
z = np.array([p.z for p in H])
top = d[z > np.percentile(z, 90)]
print('[hair]', json.dumps(dict(n=len(H), dist_mm_p50=round(float(np.percentile(d, 50)), 1), p90=round(float(np.percentile(d, 90)), 1),
                              p99=round(float(np.percentile(d, 99)), 1), max=round(float(d.max()), 1),
                              top10pct_z_p90_mm=round(float(np.percentile(top, 90)), 1),
                              lowest_hair_z=round(float(z.min()), 3))))
