"""Finger-joint placement test: bend the right hand's joints and render close-ups with the joint centres marked.
  blender -b p1.blend --python t_bend.py -- <out_dir> <tag>
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import posekit as pk

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, TAG = argv[0], argv[1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = [o for o in bpy.data.objects if o.name.endswith('.body')][0]
for o in bpy.data.objects:
    if o.type == 'MESH' and o != body and 'elegantsuit' not in o.name:
        o.hide_render = True
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'
s = 'R'
f, lat, n = pk.hand_frame(arm, s)
# bend: MCP 40, PIP 75, DIP 50 ; thumb MCP 30, IP 45
for fi in (2, 3, 4, 5):
    for j, a in zip((1, 2, 3), (40, 75, 50)):
        pk.flex(arm, f'finger{fi}-{j}.{s}', math.radians(a), n, axis=f.cross(n))
pk.flex(arm, f'finger1-2.{s}', math.radians(30), n)
pk.flex(arm, f'finger1-3.{s}', math.radians(45), n)
pk.upd()
bpy.ops.object.mode_set(mode='OBJECT')
# joint markers
mat = bpy.data.materials.new('mark'); mat.diffuse_color = (1, 0.1, 0.05, 1)
names = [f'finger{i}-{j}.{s}' for i in range(1, 6) for j in (1, 2, 3)] + [f'wrist.{s}']
for nm in names:
    pb = arm.pose.bones[nm]
    for p in (pb.head, pb.tail) if nm.endswith('3.' + s) else (pb.head,):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0022, location=arm.matrix_world @ p, segments=12, ring_count=8)
        o = bpy.context.object; o.data.materials.append(mat); o.show_in_front = True
scn = bpy.context.scene
scn.render.engine = 'BLENDER_WORKBENCH'
sh = scn.display.shading
sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'
sh.show_xray = False
scn.display.render_aa = '16'
scn.render.resolution_x, scn.render.resolution_y = 1000, 750
cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data)
scn.collection.objects.link(cam); scn.camera = cam
w = arm.matrix_world @ arm.pose.bones[f'wrist.{s}'].head
m = arm.matrix_world @ arm.pose.bones[f'finger3-1.{s}'].head
c = (w + m) / 2 + f * 0.02
def shoot(name, d, up=Vector((0, 0, 1)), lens=60, dist=0.42):
    cam.location = c + d.normalized() * dist
    q = (c - cam.location).to_track_quat('-Z', 'Y')
    cam.rotation_euler = q.to_euler(); cam_data.lens = lens
    scn.render.filepath = os.path.join(OUT, f'bend_{TAG}_{name}.png')
    bpy.ops.render.render(write_still=True)
shoot('radial', -lat * 1.0 + n * 0.15)      # from the thumb side
shoot('ulnar', lat * 1.0 - n * 0.1)         # from the little-finger side
shoot('dorsal', -n * 1.0 + f * 0.2 - lat * 0.3)
print('[bend] done')
