"""Inspect a GLB with numpy only: meshes, vertex counts, skins/joints, weight sanity, materials, textures, animations."""
import sys, json, struct
import numpy as np

path = sys.argv[1]
data = open(path, 'rb').read()
magic, ver, length = struct.unpack_from('<III', data, 0)
assert magic == 0x46546C67, 'not a GLB'
off = 12; js = None; bin_ = None
while off < length:
    clen, ctype = struct.unpack_from('<II', data, off); off += 8
    chunk = data[off:off + clen]; off += clen
    if ctype == 0x4E4F534A: js = json.loads(chunk)
    elif ctype == 0x004E4942: bin_ = chunk
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    stride = bv.get('byteStride', dt.itemsize * n)
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
    arr = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy()
    arr = arr.view(dt).reshape(a['count'], n)
    if a.get('normalized'):
        arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr

rep = {'file': path, 'bytes': length, 'meshes': [], 'skins': [], 'materials': [], 'images': [], 'animations': []}
nodes = js['nodes']
for ni, n in enumerate(nodes):
    if 'mesh' not in n: continue
    m = js['meshes'][n['mesh']]
    for p in m['primitives']:
        at = p['attributes']
        pos = acc(at['POSITION'])
        d = {'node': n.get('name'), 'verts': int(len(pos)), 'tris': int(len(acc(p['indices'])) // 3) if 'indices' in p else None,
             'attributes': sorted(at.keys()), 'material': js['materials'][p['material']]['name'] if 'material' in p else None,
             'bbox_min': pos.min(0).round(4).tolist(), 'bbox_max': pos.max(0).round(4).tolist(), 'skin': n.get('skin')}
        if 'WEIGHTS_0' in at:
            w = acc(at['WEIGHTS_0']).astype(np.float64)
            s = w.sum(1)
            d['weights'] = {'sum_min': round(float(s.min()), 4), 'sum_max': round(float(s.max()), 4),
                            'influences_hist': {int(k): int(v) for k, v in zip(*np.unique((w > 1e-4).sum(1), return_counts=True))},
                            'has_JOINTS_1': 'JOINTS_1' in at}
        rep['meshes'].append(d)
for s in js.get('skins', []):
    names = [nodes[j].get('name') for j in s['joints']]
    rep['skins'].append({'joints': len(names), 'names': names})
for m in js.get('materials', []):
    pbr = m.get('pbrMetallicRoughness', {})
    rep['materials'].append({'name': m.get('name'), 'baseColorTexture': 'baseColorTexture' in pbr,
                             'normalTexture': 'normalTexture' in m, 'mrTexture': 'metallicRoughnessTexture' in pbr,
                             'alphaMode': m.get('alphaMode', 'OPAQUE'), 'doubleSided': m.get('doubleSided', False)})
for im in js.get('images', []):
    bv = js['bufferViews'][im['bufferView']] if 'bufferView' in im else None
    rep['images'].append({'name': im.get('name'), 'mime': im.get('mimeType'), 'bytes': bv['byteLength'] if bv else None})
for a in js.get('animations', []):
    rep['animations'].append({'name': a.get('name'), 'channels': len(a['channels'])})
# hierarchy of the hand (left) for the report
def children(i): return nodes[i].get('children', [])
name2i = {n.get('name'): i for i, n in enumerate(nodes)}
def tree(i, d=0, out=None):
    out = [] if out is None else out
    out.append('  ' * d + nodes[i].get('name', '?'))
    for c in children(i): tree(c, d + 1, out)
    return out
if 'wrist.L' in name2i:
    rep['left_hand_tree'] = tree(name2i['wrist.L'])
json.dump(rep, open(sys.argv[2], 'w'), indent=1) if len(sys.argv) > 2 else None
for m in rep['meshes']:
    print(f"{m['node']:<32} verts {m['verts']:>7} tris {m['tris']:>7} mat {m['material']}  w={m.get('weights')}")
print('skins:', [(s['joints']) for s in rep['skins']], 'materials:', len(rep['materials']), 'images:', len(rep['images']),
      'anims:', rep['animations'])
if 'left_hand_tree' in rep: print('\n'.join(rep['left_hand_tree']))
