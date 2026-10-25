"""Workbench clay renders of the seated pianist (any stage blend at the seated frame).
  blender -b <blend> --python r_workbench.py -- <out_dir> <tag> [frame] [views]
"""
import bpy, sys, os, json
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
OUT, TAG = argv[0], argv[1]
FRAME = int(argv[2]) if len(argv) > 2 else None
VIEWS = argv[3].split(',') if len(argv) > 3 else None
scn = bpy.context.scene
if FRAME is not None: scn.frame_set(FRAME)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.context.view_layer.update()
def hpos(n): return arm.matrix_world @ arm.pose.bones[n if n in arm.pose.bones else n.replace('.', '_')].head
HC = {s: (hpos(f'finger3-1.{s}') + hpos(f'wrist.{s}')) / 2 for s in ('L', 'R')}
scn.render.engine = 'BLENDER_WORKBENCH'
sh = scn.display.shading
sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'
sh.show_shadows = True; sh.show_specular_highlight = True
scn.display.render_aa = '16'
scn.render.resolution_x, scn.render.resolution_y = 1280, 960
cols = {'pianist_lining': (0.2, 0.2, 0.22), 'pianist_skin_hand': (0.78, 0.6, 0.5), 'pianist_hair': (0.10, 0.07, 0.05), 'pianist_beard': (0.10, 0.07, 0.05), 'pianist_suit': (0.06, 0.06, 0.07),
        'pianist_skin': (0.78, 0.6, 0.5), 'pianist_shirt': (0.92, 0.92, 0.9), 'pianist_shoes': (0.03, 0.03, 0.03)}
for m in bpy.data.materials:
    if m.name in cols: m.diffuse_color = (*cols[m.name], 1)
cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data)
scn.collection.objects.link(cam); scn.camera = cam
def shoot(name, loc, look, lens=50):
    if VIEWS and name not in VIEWS: return
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = lens
    scn.render.filepath = os.path.join(OUT, f'{TAG}_{name}.png')
    bpy.ops.render.render(write_still=True)
# pianist frame: keys at y<0, pianist at y>0 facing -y, treble (his right) at -x
shoot('side_treble', (-2.4, 0.25, 0.95), (0, 0.25, 0.8), 45)
shoot('side_bass', (2.4, 0.25, 0.95), (0, 0.25, 0.8), 45)
shoot('back34', (-1.4, 2.0, 1.45), (0, 0.2, 0.85), 45)
shoot('front_high', (0.0, -1.6, 1.85), (0, 0.25, 0.9), 40)
shoot('hands_top', (0.0, -0.25, 1.35), (0.0, 0.05, 0.74), 40)
for s, sx in (('L', 1), ('R', -1)):
    h = HC[s]
    shoot(f'hand{s}_rear34', h + Vector((-sx * 0.12, 0.30, 0.16)), h, 50)
    shoot(f'hand{s}_side', h + Vector((sx * 0.34, 0.04, 0.05)), h, 50)
    shoot(f'hand{s}_front', h + Vector((sx * 0.06, -0.33, 0.10)), h, 50)
print('[wb] done')
