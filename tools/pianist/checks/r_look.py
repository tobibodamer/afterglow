"""Look-dev renders of the seated pianist in a sunset backlight (Blender EEVEE, or Cycles fallback).
  blender -b p4.blend --python r_look.py -- <out_dir> <tag> [frame] [engine] [views]
Pianist frame: faces -Y, his left = +X (bass), treble = -X, keys at y < 0. Sun ~1 deg above the horizon at his left-front.
"""
import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
OUT, TAG = argv[0], argv[1]
FRAME = int(argv[2]) if len(argv) > 2 else 90
ENGINE = argv[3] if len(argv) > 3 else 'BLENDER_EEVEE'
VIEWS = argv[4].split(',') if len(argv) > 4 else None
scn = bpy.context.scene
scn.frame_set(FRAME)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.context.view_layer.update()
def hpos(n): return arm.matrix_world @ arm.pose.bones[n].head
HC = {s: (hpos(f'finger3-1.{s}') + hpos(f'wrist.{s}')) / 2 for s in ('L', 'R')}
for o in bpy.data.objects:
    if o.name in ('floor',):
        o.hide_render = True

# ---- materials: skin gets a little subsurface for backlit fingers; lacquer for the reference keyboard ----
sk = bpy.data.materials.get('pianist_skin')
if sk:
    bs = sk.node_tree.nodes['Principled BSDF']
    bs.inputs['Subsurface Weight'].default_value = 0.25
    bs.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
    bs.inputs['Subsurface Scale'].default_value = 0.006
for m in bpy.data.materials:
    if m.name in ('ref_black', 'ref_bench') and m.use_nodes:
        b = m.node_tree.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 0.08
        b.inputs['Coat Weight'].default_value = 1.0

# ---- world: vertical sunset gradient ----
w = bpy.data.worlds.new('sunset'); scn.world = w; w.use_nodes = True
nt = w.node_tree; nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB'); bg = nt.nodes.new('ShaderNodeBackground'); out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
# Generated coords for world = direction; z in [-1, 1] -> map via ramp position (z+1)/2
mapr = nt.nodes.new('ShaderNodeMapRange'); mapr.inputs['From Min'].default_value = -1; mapr.inputs['From Max'].default_value = 1
nt.links.new(sep.outputs['Z'], mapr.inputs['Value']); nt.links.new(mapr.outputs['Result'], ramp.inputs['Fac'])
cr = ramp.color_ramp; cr.elements[0].position = 0.0; cr.elements[0].color = (0.004, 0.003, 0.006, 1)
cr.elements[1].position = 1.0; cr.elements[1].color = (0.02, 0.02, 0.07, 1)
for pos, col in ((0.49, (0.02, 0.012, 0.02, 1)), (0.5, (0.9, 0.35, 0.22, 1)), (0.53, (0.55, 0.18, 0.22, 1)), (0.62, (0.16, 0.08, 0.22, 1))):
    e = cr.elements.new(pos); e.color = col
bg.inputs['Strength'].default_value = 1.0
nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
# ---- sun: azimuth 60 deg to his left-front, elevation 1 deg (a warm key from behind/side in rear shots) ----
sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 4.0; sd.color = (1.0, 0.62, 0.42); sd.angle = math.radians(0.6)
so = bpy.data.objects.new('sun', sd); scn.collection.objects.link(so)
az = math.radians(60); el = math.radians(1.5)
to_sun = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))   # faces -Y, left = +X
so.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()

scn.render.engine = ENGINE
if ENGINE == 'CYCLES':
    scn.cycles.samples = 96; scn.cycles.use_denoising = True; scn.cycles.device = 'CPU'
else:
    try:
        scn.eevee.taa_render_samples = int(os.environ.get('LOOK_SAMPLES', '48'))
        scn.eevee.use_shadows = True
        scn.eevee.use_raytracing = True
    except Exception as e:
        print('[look] eevee settings', e)
scn.render.resolution_x, scn.render.resolution_y = int(os.environ.get('LOOK_W', '1600')), int(os.environ.get('LOOK_H', '900'))
scn.view_settings.view_transform = 'AgX'
scn.view_settings.look = 'None'
scn.view_settings.exposure = 0.8
cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data)
scn.collection.objects.link(cam); scn.camera = cam
def shoot(name, loc, look, lens=50, fstop=None, focus=None):
    if VIEWS and name not in VIEWS: return
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = lens
    cam_data.dof.use_dof = fstop is not None
    if fstop:
        cam_data.dof.aperture_fstop = fstop; cam_data.dof.focus_distance = (Vector(focus or look) - Vector(loc)).length
    scn.render.filepath = os.path.join(OUT, f'{TAG}_{name}.png')
    bpy.ops.render.render(write_still=True)
# ref 9: water-level 3/4 rear, treble side (alpha ~ +51 deg), 50 mm  (treble = -X, behind = +Y)
shoot('ref9_low_rear34', (-3.4, 3.2, 0.25), (0, 0.15, 0.85), 50)
# profile silhouette from the treble side (sun behind the subject; ref 4 needs a sun cheat for the bass side)
shoot('profile_treble', (-3.6, 0.35, 0.95), (0, 0.25, 0.9), 50)
# ref 7: hand close-up behind-right (alpha ~ +65 deg), h ~1.05, 50 mm, ~1.3 m from the hand
h = HC['R']
shoot('ref7_handR', h + Vector((-1.05, 0.6, 0.3)), h + Vector((0, -0.05, 0)), 50, 5.6, h)
# ref 12: macro, alpha ~ +85 deg (treble side), 15-20 cm above the keys, 0.6 m, 90 mm f/2.8
shoot('ref12_macroR', h + Vector((-0.58, 0.08, 0.13)), h + Vector((0, -0.03, -0.01)), 90, 2.8, h)
print('[look] done')
