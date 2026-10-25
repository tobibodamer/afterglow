"""Angles between consecutive finger bones (rest and current pose), and distal-bone tail vs fingertip mesh.
  blender -b <blend> --python probe_fingers.py -- [frame]"""
import bpy, sys, math, json
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if argv: bpy.context.scene.frame_set(int(argv[0]))
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.context.view_layer.update()
def ang(a, b, n):
    s = a.cross(b).dot(n); c = a.dot(b)
    return round(math.degrees(math.atan2(s, c)), 1)
out = {}
for mode in ('rest', 'pose'):
    for s in ('R',):
        if mode == 'rest':
            H = lambda nm: arm.data.bones[nm].head_local; T = lambda nm: arm.data.bones[nm].tail_local
        else:
            H = lambda nm: arm.pose.bones[nm].head; T = lambda nm: arm.pose.bones[nm].tail
        w = H(f'wrist.{s}'); m3 = H(f'finger3-1.{s}'); m2 = H(f'finger2-1.{s}'); m5 = H(f'finger5-1.{s}')
        fwd = (m3 - w).normalized(); lat = (m5 - m2); lat = (lat - fwd * lat.dot(fwd)).normalized()
        n = fwd.cross(lat).normalized()
        if (T(f'finger3-3.{s}') - m3).dot(n) < 0: n = -n
        a = fwd.cross(n)
        for f in range(2, 6):
            mc = f'metacarpal{f-1}.{s}'
            v = [T(mc) - H(mc)] + [T(f'finger{f}-{j}.{s}') - H(f'finger{f}-{j}.{s}') for j in (1, 2, 3)]
            out[f'{mode} f{f}'] = dict(MCP=ang(v[0], v[1], a), PIP=ang(v[1], v[2], a), DIP=ang(v[2], v[3], a),
                                      gap_mc_tail_to_pp_head_mm=round((T(mc) - H(f'finger{f}-1.{s}')).length * 1000, 2))
for k, v in out.items(): print('[fing]', k, v)
