"""Per-region vertex/triangle counts of the body mesh in the GLB (dominant skin joint), numpy only.
  python -I region_stats.py <pianist.glb>"""
import sys, json, struct, re
import numpy as np
path = sys.argv[1]
data = open(path, 'rb').read()
off = 12; js = None; bin_ = None
while off < len(data):
    clen, ctype = struct.unpack_from('<II', data, off); off += 8
    if ctype == 0x4E4F534A: js = json.loads(data[off:off + clen])
    elif ctype == 0x004E4942: bin_ = data[off:off + clen]
    off += clen
CT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def acc(i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    stride = bv.get('byteStride', dt.itemsize * n); start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = np.frombuffer(bin_, np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
    arr = np.lib.stride_tricks.as_strided(raw, (a['count'], dt.itemsize * n), (stride, 1)).copy().view(dt).reshape(a['count'], n)
    if a.get('normalized'): arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr
nodes = js['nodes']; skin = js['skins'][0]; jn = [nodes[j]['name'] for j in skin['joints']]
out = {}
for n in nodes:
    if 'mesh' not in n or 'body' not in n.get('name', ''): continue
    for p in js['meshes'][n['mesh']]['primitives']:
        J = acc(p['attributes']['JOINTS_0']); W = acc(p['attributes']['WEIGHTS_0']).astype(float)
        dom = J[np.arange(len(J)), W.argmax(1)]
        names = np.array(jn)[dom]
        idx = acc(p['indices']).reshape(-1, 3)
        for label, rx in (('hand_L', r'^(wrist|finger|metacarpal).*L$'), ('hand_R', r'^(wrist|finger|metacarpal).*R$'),
                          ('fingers_R', r'^finger.*R$'), ('head_face', r'^(head|jaw|eye|oris|levator|risorius|temporalis|orbicularis|oculi|special|tongue)')):
            m = np.array([bool(re.match(rx, s)) for s in names])
            tri = m[idx].all(1).sum()
            out[label] = dict(verts=int(m.sum()), tris=int(tri))
print(json.dumps(out))
