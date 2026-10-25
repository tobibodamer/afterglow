"""Quick look at the groom: workbench views of the head (rest or posed) + backlit silhouette.
  blender -b p3.blend --python t_head.py -- <out_dir> <tag>
"""
import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
OUT, TAG = argv[0], argv[1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.context.view_layer.update()
hb = arm.pose.bones['head']
c = arm.matrix_world @ ((hb.head + hb.tail) / 2) + Vector((0, 0, -0.03))
scn = bpy.context.scene
scn.render.engine = 'BLENDER_WORKBENCH'
sh = scn.display.shading
sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'
scn.display.render_aa = '16'
scn.render.resolution_x, scn.render.resolution_y = 800, 800
for m in bpy.data.materials:
    if 'hair' in m.name or 'beard' in m.name:
        m.diffuse_color = (0.12, 0.08, 0.06, 1)
    if m.name == 'pianist_suit':
        m.diffuse_color = (0.05, 0.05, 0.06, 1)
    if m.name == 'pianist_skin':
        m.diffuse_color = (0.75, 0.55, 0.45, 1)
    if m.name == 'pianist_shirt':
        m.diffuse_color = (0.9, 0.9, 0.9, 1)
cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data)
scn.collection.objects.link(cam); scn.camera = cam
def shoot(name, d, lens=85, dist=0.95, flat=False):
    cam.location = c + Vector(d).normalized() * dist
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam_data.lens = lens
    if flat:
        sh.light = 'FLAT'; sh.color_type = 'SINGLE'; sh.single_color = (0, 0, 0); sh.show_cavity = False
        sh.background_type = 'VIEWPORT'; sh.background_color = (1.0, 0.75, 0.6)
    scn.render.filepath = os.path.join(OUT, f'head_{TAG}_{name}.png')
    bpy.ops.render.render(write_still=True)
    if flat:
        sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.background_type = 'THEME'
shoot('front', (0, -1, 0.05))
shoot('side', (1, 0, 0.05))
shoot('back34', (-0.7, 0.7, 0.25))
shoot('sil_side', (-1, 0.15, 0.0), flat=True)
print('[head] done')
