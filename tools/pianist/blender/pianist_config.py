"""Shared constants of the pianist pipeline (Blender stages). Blender frame: z up, the pianist faces -Y, his right hand
(treble) is at -X, the white-key front plane is y = 0 with the keys at y < 0, floor (lake bed) z = 0.
glTF / three.js export: (x, y, z)_gltf = (x, z, -y)_blender."""

# Wrist pivot fix (research/human.md 0.6 / 10.3): MakeHuman puts the wrist joint ~2 cm proximal of the visible wrist
# crease. p1 moves the joint this far distally along the forearm and shifts the forearm/hand weight blend with it.
WRIST_SHIFT = 0.015

# Piano (scene/src/piano/layout_d.json, converted to the pianist frame: y_blender = -(z_piano - KEY_FRONT_Z),
# x_blender = rig x = KB_CENTER_X - x_piano).
KEY_TOP_Z = 0.715
SEAT_Z = 0.47                 # bench top used for the pose and the cloth collider (piano module: setBenchHeight(0.47))
BENCH_SIZE = (0.57, 0.37)     # seat width (x), depth (y)
BENCH_CENTER = (0.025, 0.487) # rig x of the bench centre (piano x 0.755), distance behind the key front (near edge 0.302)
DAMPER_PEDAL_X = -0.078       # rig x of the damper (right) pedal, piano x 0.858
PEDAL_TIP_BEHIND = 0.183      # pedal tip 0.205 (piano z) - key front 0.022
PEDAL_TREAD_Z = 0.09

# Sleeve end relative to the (moved) wrist pivot along the forearm axis; the shirt cuff shows 12.5 mm beyond it.
SLEEVE_END = -0.010 - WRIST_SHIFT
CUFF_SHOW = 0.0125
