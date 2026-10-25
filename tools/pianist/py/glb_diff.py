"""Per-mesh vertex position difference between two GLBs with identical topology (numpy only).
  python -I glb_diff.py a.glb b.glb"""
import sys, json, struct
import numpy as np
def load(path):
    data = open(path, 'rb').read(); off = 12; js = bin_ = None
    while off < len(data):
        clen, ctype = struct.unpack_from('<II', data, off); off += 8
        if ctype == 0x4E4F534A: js = json.loads(data[off:off + clen])
        elif ctype == 0x004E4942: bin_ = data[off:off + clen]
        off += clen
    out = {}
    for n in js['nodes']:
        if 'mesh' not in n: continue
        p = js['meshes'][n['mesh']]['primitives'][0]; a = js['accessors'][p['attributes']['POSITION']]
        bv = js['bufferViews'][a['bufferView']]
        arr = np.frombuffer(bin_, np.float32, count=a['count'] * 3, offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, 3)
        out[n['name']] = arr
    return out
A, B = load(sys.argv[1]), load(sys.argv[2])
for k in sorted(A):
    if k in B and A[k].shape == B[k].shape:
        d = np.linalg.norm(A[k] - B[k], axis=1) * 1000
        print(f'{k:<32} n {len(d):>7}  mean {d.mean():8.3f} mm  p99 {np.percentile(d, 99):8.3f}  max {d.max():8.3f}')
    else:
        print(f'{k:<32} topology differs ({A[k].shape} vs {B[k].shape if k in B else None})')
