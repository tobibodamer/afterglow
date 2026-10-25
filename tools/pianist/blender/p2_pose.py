"""Stage 4 (v6): seated piano posture (research/performance.md §2-3) in the PIANIST FRAME.

  blender -b p3.blend --python p2_pose.py -- <out_dir> [--no-render]

Pianist frame (Blender, z up): floor (lake bed) z = 0; white-key front plane y = 0, keys at y < 0;
keyboard centre (E4|F4) x = 0; treble toward -x (= the pianist's RIGHT, MakeHuman faces -Y).
glTF/three.js export: (x, y, z)_gltf = (x, z, -y)_blender -> faces +Z, right hand at -X, floor y = 0, key front z = 0.
Numbers: bench top 0.47, white-key top 0.715 (research/piano.md §2), hip joint 0.515 behind the key front,
torso lean ~12 deg, head bowed ~30 deg, wrist centre 37 mm above the key tops, knuckle line pitched +10 deg,
right ball of foot on the damper pedal (rig x +0.078 -> Blender x -0.078; tip 0.183 behind the key front; tread 0.09).
Keyframes: frame 1 = rest (A pose), frame FR = seated (used by the cloth simulation in p4).
"""
import bpy, sys, os, math, json
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import posekit as pk
import pianist_config as cfg

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
RENDER = '--no-render' not in argv
FR = 40
os.makedirs(OUT, exist_ok=True)

arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'
    pb.matrix_basis = Matrix.Identity(4)
pk.upd()
rest = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
rest_mat = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}
def L(a, b):
    return (rest[b][0] - rest[a][0]).length

SEAT_Z = cfg.SEAT_Z
KEY_Z = cfg.KEY_TOP_Z
HIP_Y = 0.515
HIP_ABOVE_SEAT = 0.085
WHITE_W = 0.0235
CONTACT_Y = -0.038      # pad contact 38 mm behind the white-key front (perf §3.5: 32-45 mm)
PAD = 0.006             # distal bone tail sits ~6 mm above the pad contact
WRIST_Z = KEY_Z + 0.037 + (0.003 if cfg.WRIST_SHIFT > 0 else 0.0)   # pivot at the wrist crease since the p1 fix
TREBLE = -1.0           # +x rig (treble) == -x Blender
def key_x(white_index_from_f4):   # white key centre, index 0 = F4, negative toward the bass
    return TREBLE * (white_index_from_f4 + 0.5) * WHITE_W

# ---------------- pelvis ----------------
hip_mid = (pk.head(arm, 'upperleg01.L') + pk.head(arm, 'upperleg01.R')) / 2
pk.translate(arm, 'root', (0 - hip_mid.x, HIP_Y - hip_mid.y, SEAT_Z + HIP_ABOVE_SEAT - hip_mid.z))
X = Vector((1, 0, 0))
pk.rotate_about(arm, 'spine05', Matrix.Rotation(math.radians(4), 3, X))    # slight anterior pelvic tilt / lumbar

# ---------------- legs (2-bone IK to an ankle target, foot set from heel/ball contacts) ----------------
def toe_ball(s):
    hs = [rest[f'toe{k}-1.{s}'][0] for k in range(1, 6)]
    return sum(hs, Vector()) / 5
leg = {}
for s, sx in (('L', 1), ('R', -1)):
    A0 = rest[f'foot.{s}'][0].copy()
    B0 = toe_ball(s)
    heel0 = Vector((A0.x, A0.y + 0.055, 0.0))           # heel contact ~55 mm behind the ankle centre (faces -Y)
    ball0 = Vector((B0.x, B0.y, 0.0))
    if s == 'R':   # damper pedal: ball on the tread, heel on the floor in front of the pedal
        ball_t = Vector((TREBLE * 0.078, -0.205, 0.090))
        yaw = math.radians(-6)
        hb = (ball0 - heel0).length
        pitch = math.asin(min(0.95, ball_t.z / hb))
        heel_t = ball_t + Vector((0, (hb * math.cos(pitch)), -ball_t.z))
    else:          # left foot flat, slightly back and left of the una corda
        heel_t = Vector((0.135, -0.005, 0.0)); pitch = 0.0; yaw = math.radians(8)
        ball_t = None
    Rf = Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(-pitch, 3, 'X')   # -X rotation lifts the toes (faces -Y)
    # ankle = heel contact + rotated rest offset
    A_t = heel_t + Rf @ (A0 - heel0)
    H = pk.head(arm, f'upperleg01.{s}')
    Lt = L(f'upperleg01.{s}', f'lowerleg01.{s}'); Ls = L(f'lowerleg01.{s}', f'foot.{s}')
    K = pk.two_bone_elbow(H, A_t, Lt, Ls, pole=Vector((sx * 0.25, -1.0, 0.6)))
    pk.aim_chain(arm, f'upperleg01.{s}', f'upperleg02.{s}', K)
    pk.aim_chain(arm, f'lowerleg01.{s}', f'lowerleg02.{s}', A_t)
    # foot: world rotation = Rf @ rest rotation
    pb = arm.pose.bones[f'foot.{s}']
    hd = pb.head.copy()
    M = (Rf @ rest_mat[f'foot.{s}'].to_3x3()).to_4x4(); M.translation = hd
    pb.matrix = M; pk.upd()
    reach = (A_t - H).length / (Lt + Ls)
    leg[s] = dict(knee=[round(v, 3) for v in K], ankle=[round(v, 3) for v in pk.head(arm, f'foot.{s}')],
                  ankle_target_err_mm=round((pk.head(arm, f'foot.{s}') - A_t).length * 1000, 1),
                  pitch_deg=round(math.degrees(pitch), 1), reach=round(reach, 3))
print('[pose] legs', leg)

# ---------------- spine / head ----------------
for b, deg in (('spine04', 3), ('spine03', 3), ('spine02', 2), ('spine01', 1), ('neck01', 8), ('neck02', 8), ('head', 12)):
    pk.rotate_about(arm, b, Matrix.Rotation(math.radians(deg), 3, X))
pk.rotate_about(arm, 'head', Matrix.Rotation(math.radians(-4), 3, Vector((0, -1, 0))))   # soft tilt toward the treble hand
for s, sx in (('L', 1), ('R', -1)):   # relaxed, slightly rounded shoulders
    pk.rotate_about(arm, f'clavicle.{s}', Matrix.Rotation(math.radians(-sx * 3), 3, Vector((0, 1, 0))))
    pk.rotate_about(arm, f'clavicle.{s}', Matrix.Rotation(math.radians(4), 3, Vector((0, 0, sx))))

# ---------------- arms + hands ----------------
TARGET = {  # ABSOLUTE anatomical (MCP, PIP, DIP) of the relaxed piano hand, deg (perf.md §3.5: 16-27 / 33-50 / 22-33)
    2: (20, 40, 26), 3: (22, 42, 28), 4: (22, 42, 28), 5: (20, 38, 25),
}
def rest_angles(s):
    """anatomical flexion already present in the MakeHuman A pose (angle between consecutive bones about the hand axis)"""
    Bn = arm.data.bones
    w = Bn[f'wrist.{s}'].head_local; m2 = Bn[f'finger2-1.{s}'].head_local; m3 = Bn[f'finger3-1.{s}'].head_local; m5 = Bn[f'finger5-1.{s}'].head_local
    f = (m3 - w).normalized(); lat = m5 - m2; lat = (lat - f * lat.dot(f)).normalized(); n = f.cross(lat).normalized()
    if (Bn[f'finger3-3.{s}'].tail_local - m3).dot(n) < 0: n = -n
    a = f.cross(n)
    out = {}
    for fi in (2, 3, 4, 5):
        vec = lambda b: b.tail_local - b.head_local          # armature space (Bone.vector is parent-relative)
        vs = [vec(Bn[f'metacarpal{fi-1}.{s}'])] + [vec(Bn[f'finger{fi}-{j}.{s}']) for j in (1, 2, 3)]
        out[fi] = tuple(math.degrees(math.atan2(vs[k].cross(vs[k + 1]).dot(a), vs[k].dot(vs[k + 1]))) for k in range(3))
    return out
REST_ANG = {s: rest_angles(s) for s in ('L', 'R')}
BASE = {s: {fi: ((0, 0, 0), tuple(TARGET[fi][k] - REST_ANG[s][fi][k] for k in range(3))) for fi in TARGET} for s in ('L', 'R')}
CURL = 1.0
print('[pose] A-pose finger angles R', {k: tuple(round(x, 1) for x in v) for k, v in REST_ANG['R'].items()})
SPREAD = {2: -4, 3: 0, 4: 3, 5: 8}
ARM_BONES = lambda s: [b.name for b in arm.data.bones if b.name.endswith('.' + s) and (
    b.name.startswith(('upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal')))]

def pose_arm(s, sx, W, c):
    for nm in ARM_BONES(s):
        arm.pose.bones[nm].matrix_basis = Matrix.Identity(4)
    pk.upd()
    S = pk.head(arm, f'upperarm01.{s}')
    a = L(f'upperarm01.{s}', f'lowerarm01.{s}'); b = L(f'lowerarm01.{s}', f'wrist.{s}')
    E = pk.two_bone_elbow(S, W, a, b, pole=Vector((sx * 0.9, 0.45, -1.0)))
    pk.aim_chain(arm, f'upperarm01.{s}', f'upperarm02.{s}', E)
    pk.aim_chain(arm, f'lowerarm01.{s}', f'lowerarm02.{s}', W)
    fa = (W - E); fa.z = 0; fa.normalize()
    fwd = (fa * 0.4 + Vector((0, -1, 0)) * 0.6); fwd.z = 0; fwd.normalize()
    fwd = (fwd + Vector((0, 0, math.tan(math.radians(10))))).normalized()      # knuckle line pitched up 10 deg
    n_t = Matrix.Rotation(sx * math.radians(-4), 3, fwd) @ Vector((0, 0, -1))
    pk.orient_hand(arm, s, fwd, n_t)
    f, lat, n = pk.hand_frame(arm, s)
    for fi, (b0, g) in BASE[s].items():
        names = [f'finger{fi}-{j}.{s}' for j in (1, 2, 3)]
        pb = pk.P(arm, names[0]); dvec = (pb.tail - pb.head).normalized()
        sgn = 1 if n.cross(dvec).dot(lat) > 0 else -1
        pk.rotate_about(arm, names[0], Matrix.Rotation(math.radians(SPREAD[fi]) * sgn, 3, n))
        for nm, a0, gg in zip(names, b0, g):
            pk.flex(arm, nm, math.radians(a0 + gg * c), n, axis=f.cross(n))
    # thumb MCP/IP flex across the palm (toward the little-finger MCP)
    for nm, a in ((f'finger1-2.{s}', 10), (f'finger1-3.{s}', 15)):
        pb = pk.P(arm, nm); d = (pb.tail - pb.head).normalized()
        t = pk.head(arm, f'finger5-1.{s}') - pb.head; t = (t - d * t.dot(d)).normalized()
        pk.flex(arm, nm, math.radians(a), n, axis=d.cross(t))
    return E

def solve_hand(s, sx, g):
    # fixed relaxed curl and hand orientation; solve the wrist position so the middle-finger tip lands on its goal
    W = Vector((g.x - sx * 0.01, g.y + 0.10, WRIST_Z))
    c = CURL
    for it in range(12):
        pose_arm(s, sx, W, c); e = pk.tail(arm, f'finger3-3.{s}') - g
        W = W - e
        if e.length < 0.0002:
            break
    E = pose_arm(s, sx, W, c)
    # thumb: aim CMC so the tip lands ~2.5 white keys toward the middle of the hand, 15 mm behind the front
    idx = pk.tail(arm, f'finger2-3.{s}')
    want = Vector((idx.x - sx * 2.2 * WHITE_W, -0.016, KEY_Z + PAD))   # thumb sits toward the body midline
    cmc = pk.head(arm, f'finger1-1.{s}')
    for _ in range(4):
        l = (pk.tail(arm, f'finger1-3.{s}') - cmc).length
        pk.aim_chain(arm, f'finger1-1.{s}', f'finger1-3.{s}', cmc + (want - cmc).normalized() * l)
    th = pk.tail(arm, f'finger1-3.{s}')
    mcp = pk.head(arm, f'finger3-1.{s}')
    return dict(iters=it + 1, curl=round(c, 3), wrist=[round(v, 4) for v in W], elbow=[round(v, 4) for v in E],
                elbow_above_keys_mm=round((E.z - KEY_Z) * 1000, 1), wrist_front_of_keys_mm=round(W.y * 1000, 1),
                mid_mcp_above_keys_mm=round((mcp.z - KEY_Z) * 1000, 1),
                mid_residual_mm=round(e.length * 1000, 2), thumb_tip=[round(v, 4) for v in th],
                thumb_gap_mm=round((th - want).length * 1000, 1))

SOLVE = {}
# LH middle finger on G3 (white index -6 from F4), RH middle finger on D5 (index +5; with E5 the ring fingertip sat in
# the black F#5: check with tools/pianist/check_frames.mjs)
for s, sx, wi in (('L', 1, -6), ('R', -1, 5)):
    g = Vector((key_x(wi), CONTACT_Y, KEY_Z + PAD))
    SOLVE[s] = solve_hand(s, sx, g)
    SOLVE[s]['mid_goal'] = [round(v, 4) for v in g]
    print(f'[pose] {s}: {SOLVE[s]}')
pk.upd()
tips = {}
for s in ('L', 'R'):
    for fi in range(1, 6):
        t = pk.tail(arm, f'finger{fi}-3.{s}')
        tips[f'{s}{fi}'] = dict(xyz=[round(v, 4) for v in t], above_key_top_mm=round((t.z - KEY_Z) * 1000, 1),
                                behind_key_front_mm=round(-t.y * 1000, 1))
HC = {s: (pk.head(arm, f'finger3-1.{s}') + pk.head(arm, f'wrist.{s}')) / 2 for s in ('L', 'R')}
seated = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}

# ---------------- keyframes: 1 = rest, FR = seated ----------------
arm.animation_data_create()
act = bpy.data.actions.new('rest_to_seated'); arm.animation_data.action = act
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
    pb.keyframe_insert('rotation_quaternion', frame=1); pb.keyframe_insert('location', frame=1)
for pb in arm.pose.bones:
    pb.matrix_basis = seated[pb.name]
    pb.keyframe_insert('rotation_quaternion', frame=FR); pb.keyframe_insert('location', frame=FR)
scn = bpy.context.scene
scn.frame_start, scn.frame_end = 1, FR + 20
scn.frame_set(FR)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------- reference keyboard + bench (renders only; deleted at export) ----------------
col = bpy.data.collections.new('reference'); scn.collection.children.link(col)
import bmesh
def box(name, c, size, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); col.objects.link(o)
    o.location = c; o.scale = size; o.data.materials.append(mat)
    return o
def mat(name, rgb, rough=0.4):
    m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = rough
    return m
mw, mb, mbench = mat('ref_white', (0.8, 0.8, 0.77), 0.3), mat('ref_black', (0.01, 0.01, 0.01), 0.15), mat('ref_bench', (0.012, 0.01, 0.01), 0.35)
names = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
for i in range(52):                       # A0 .. C8; F4 is white index 26 + 3 -> boundary E4|F4 at x 0
    wi = i - 26 - 4 + 1                   # A0 = -29 ... F4 = 0
    x = key_x(wi)
    box(f'wk{i}', (x, -0.075, KEY_Z - 0.011), (WHITE_W - 0.001, 0.15, 0.022), mw)
    nm = names[(i + 5) % 7]
    if nm in ('C', 'D', 'F', 'G', 'A') and i < 51:
        box(f'bk{i}', (x + TREBLE * WHITE_W / 2, -0.051 - 0.0475, KEY_Z + 0.006), (0.0115, 0.095, 0.0125 + 0.022 - 0.01), mb)
box('keybed', (0, -0.25, 0.625 + 0.045), (1.56, 0.50, 0.09), mb)
box('keyslip', (0, 0.01, KEY_Z - 0.03), (1.42, 0.02, 0.04), mb)
box('bench', (cfg.BENCH_CENTER[0], cfg.BENCH_CENTER[1], SEAT_Z - 0.04), (cfg.BENCH_SIZE[0], cfg.BENCH_SIZE[1], 0.08), mbench)   # = the piano module's bench at height SEAT_Z
box('pedal_R', (TREBLE * 0.078, -0.25, 0.085), (0.03, 0.10, 0.012), mat('ref_brass', (0.6, 0.45, 0.2), 0.3))
box('floor', (0, 0, -0.005), (6, 6, 0.01), mat('ref_floor', (0.2, 0.2, 0.2)))

json.dump(dict(legs=leg, hands=SOLVE, tips=tips, frame_seated=FR,
               constants=dict(SEAT_Z=SEAT_Z, KEY_Z=KEY_Z, HIP_Y=HIP_Y, WRIST_Z=WRIST_Z, CONTACT_Y=CONTACT_Y)),
          open(os.path.join(OUT, 'p2_pose.json'), 'w'), indent=1)
json.dump({k: [round(v, 4) for v in (HC[k])] for k in HC}, open(os.path.join(OUT, 'p2_handcentres.json'), 'w'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'p2.blend'))
print('[pose] tips', tips)
print('[pose] done')
