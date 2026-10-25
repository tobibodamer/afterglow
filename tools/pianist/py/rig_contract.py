"""Derive the rig contract from the exported GLB (glTF/three.js frame, y up, metres).

  python -I rig_contract.py <pianist.glb> <rig.json>

For every joint: parent, rest local TRS (as in the GLB = three.js bone.position/quaternion at bind),
rest world position, length (to its first child or, for finger tips, to the bone tail estimated by the parent length).
For the 30 finger/thumb joints: hand-frame axes and the local FLEX axis (positive rotation curls toward the palm),
local ABDUCTION axis (positive = toward the little-finger side for 2-5 / palmar abduction for the thumb), and the rest
flexion angle relative to the parent segment (anatomical angle baked into the seated bind pose).
"""
import sys, json, struct
import numpy as np

path, out = sys.argv[1], sys.argv[2]
data = open(path, 'rb').read()
off = 12; js = None
while off < len(data):
    clen, ctype = struct.unpack_from('<II', data, off); off += 8
    if ctype == 0x4E4F534A: js = json.loads(data[off:off + clen])
    off += clen
nodes = js['nodes']
skin = js['skins'][0]
joints = skin['joints']
jset = set(joints)
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        parent[c] = i

def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def local(i):
    n = nodes[i]
    M = np.eye(4)
    if 'matrix' in n:
        return np.array(n['matrix']).reshape(4, 4).T
    S = np.diag(n.get('scale', [1, 1, 1]))
    M[:3, :3] = qmat(n.get('rotation', [0, 0, 0, 1])) @ S
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M

world = {}
def W(i):
    if i in world: return world[i]
    M = local(i)
    if i in parent: M = W(parent[i]) @ M
    world[i] = M
    return M

name = {i: nodes[i].get('name') for i in range(len(nodes))}
idx = {v: k for k, v in name.items()}
SEP = '_' if 'wrist_L' in idx else '.'
rig = {"frame": "glTF / three.js: y up, metres. Bind pose = seated at the piano. Pianist faces +Z, his RIGHT hand is at -X. "
                "Floor (lake bed) y = 0, white-key front plane z = 0, keyboard centre (E4|F4) x = 0, white-key tops y = 0.715.",
       "skeleton_root": name[skin.get('skeleton', joints[0])] if 'skeleton' in skin else None,
       "joint_count": len(joints), "joints": []}
for i in joints:
    Wm = W(i)
    kids = [c for c in nodes[i].get('children', []) if c in jset]
    L = float(np.linalg.norm(W(kids[0])[:3, 3] - Wm[:3, 3])) if kids else None
    n = nodes[i]
    rig["joints"].append(dict(name=name[i], parent=name.get(parent.get(i)) if parent.get(i) in jset else None,
                              t=[round(x, 6) for x in n.get('translation', [0, 0, 0])],
                              q=[round(x, 6) for x in n.get('rotation', [0, 0, 0, 1])],
                              world_pos=[round(x, 5) for x in Wm[:3, 3]], length=round(L, 5) if L else None))

def P(n): return W(idx[n])[:3, 3]
def R(n): return W(idx[n])[:3, :3] / np.linalg.norm(W(idx[n])[:3, :3], axis=0)
def unit(v): return v / np.linalg.norm(v)

hands = {}
for s in ('L', 'R'):
    w = P(f'wrist{SEP}{s}'); m2 = P(f'finger2-1{SEP}{s}'); m3 = P(f'finger3-1{SEP}{s}'); m5 = P(f'finger5-1{SEP}{s}')
    fwd = unit(m3 - w)
    lat = m5 - m2; lat = unit(lat - fwd * lat.dot(fwd))           # index -> little finger
    n = unit(np.cross(fwd, lat))
    th = P(f'finger1-3{SEP}{s}')
    # palm normal points to the palmar side: fingertips curl toward it
    tip3 = P(f'finger3-3{SEP}{s}')
    if (tip3 - m3).dot(n) < 0: n = -n
    hands[s] = dict(forward=fwd.round(5).tolist(), index_to_little=lat.round(5).tolist(), palm_normal=n.round(5).tolist())
    fing = {}
    for f in range(1, 6):
        chain = [f'finger{f}-{j}{SEP}{s}' for j in (1, 2, 3)]
        par0 = nodes[parent[idx[chain[0]]]]['name']
        for k, b in enumerate(chain):
            p = P(b)
            nxt = P(chain[k + 1]) if k < 2 else None
            if nxt is None:      # distal: direction from the bone's own local +Y (Blender bone axis survives export)
                d = unit(R(b)[:, 1])
            else:
                d = unit(nxt - p)
            # flexion axis, independent of the current curl: a x d must point to the palmar side.
            # fingers 2-5: a = hand lateral axis (fwd x n) made perpendicular to d -> positive rotation curls the finger.
            # thumb: tip moves across the palm toward the little-finger MCP; abduction = out of the palm plane (palmar).
            def perp(v): v = v - d * v.dot(d); return unit(v)
            if f == 1:
                t = perp(m5 - p)
                ax_flex = unit(np.cross(d, t))
                ax_abd = unit(np.cross(d, perp(n)))
            else:
                ax_flex = perp(np.cross(fwd, n))     # (fwd x n) x fwd = n: positive rotation moves a straight finger palmward
                ax_abd = unit(np.cross(d, perp(lat)))     # positive = toward the little finger
            Rb = R(b)
            loc_flex = Rb.T @ ax_flex; loc_abd = Rb.T @ ax_abd
            # rest flexion relative to the parent segment, in the flexion plane
            parent_name = par0 if k == 0 else chain[k - 1]
            pd = unit(p - P(parent_name)) if k > 0 or f == 1 else unit(p - P(parent_name))
            rest_flex = float(np.degrees(np.arctan2(np.cross(pd, d).dot(ax_flex), pd.dot(d))))
            fing[b] = dict(flex_axis_local=loc_flex.round(4).tolist(), abd_axis_local=loc_abd.round(4).tolist(),
                           bone_y_vs_dir_deg=round(float(np.degrees(np.arccos(np.clip(unit(Rb[:, 1]).dot(d), -1, 1)))), 2),
                           rest_flex_deg=round(rest_flex, 1), joint=['CMC', 'MCP', 'IP'][k] if f == 1 else ['MCP', 'PIP', 'DIP'][k])
    hands[s]['fingers'] = fing
    Rw = R(f'wrist{SEP}{s}')
    a_flex = unit(np.cross(fwd, n))     # positive = palmar flexion (hand rotates toward the palm side)
    hands[s]['wrist'] = dict(flex_axis_local=(Rw.T @ a_flex).round(4).tolist(),
                             ulnar_dev_axis_local=(Rw.T @ unit(np.cross(fwd, lat))).round(4).tolist(),   # (fwd x lat) x fwd = lat
                             note='pronation/supination: rotate lowerarm01 and lowerarm02 (twist) about their local +Y')
    hands[s]['wrist_to_mid_mcp_mm'] = round(float(np.linalg.norm(m3 - w)) * 1000, 1)
rig['hands'] = hands
# leaf joints (finger/toe tips) have no child: take the Blender bone length from the exporter sidecar; tip = head + local +Y * length
import os
side = sys.argv[3] if len(sys.argv) > 3 else path + '.json'
if os.path.exists(side):
    bl = json.load(open(side)).get('bone_lengths', {})
    for j in rig['joints']:
        if j['length'] is None and j['name'] in bl:
            j['length'] = bl[j['name']]; j['length_source'] = 'blender bone (tail = head + local +Y * length)'
json.dump(rig, open(out, 'w'), indent=1)
print('joints', len(joints))
for s in ('R',):
    for b, v in hands[s]['fingers'].items():
        print(b, v)
