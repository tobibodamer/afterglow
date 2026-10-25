"""Re-key the frozen cloth bake (tools/pianist/frozen/cloth_suit.npz) to a new suit VERTEX ORDER without re-simulating.

Use only when the suit cage is the same set of vertices at the same rest positions and only their order changed (fix
round 1: p3 used to create the 240 jacket-hem vertices in pointer order; it now creates them in index order). Vertices are
matched by rest position (exact up to float noise); the match must be a bijection on the changed indices, otherwise the
script refuses. The fingerprint is recomputed exactly as p4_cloth.py / p5_export.py do.

  python remap_frozen.py <old_dump.npz> <new_dump.npz> <frozen_in.npz> <frozen_out.npz>
  (dumps: blender -b p2.blend --python sandbox/pianist/scratch/dump_fp.py -- out.npz -> co, fs, pose)
"""
import sys, json, hashlib
import numpy as np
from scipy.spatial import cKDTree

old_p, new_p, fin, fout = sys.argv[1:5]
a = np.load(old_p); b = np.load(new_p); z = np.load(fin)

def fp(d):
    return hashlib.sha1(np.round(d['co'], 4).tobytes() + d['fs'].tobytes() + np.round(d['pose'], 4).tobytes()).hexdigest()

assert str(z['fingerprint']) == fp(a), 'frozen bake does not belong to the OLD dump'
assert a['co'].shape == b['co'].shape and np.array_equal(a['fs'], b['fs']), 'vertex / face counts differ: re-bake instead'
assert np.abs(a['pose'] - b['pose']).max() < 1e-9, 'bind pose differs: re-bake instead'
d = np.linalg.norm(a['co'] - b['co'], axis=1)
chg = np.nonzero(d > 1e-6)[0]
perm = np.arange(len(a['co']))
if len(chg):
    t = cKDTree(a['co'][chg]); dd, nn = t.query(b['co'][chg])
    if dd.max() > 1e-5 or len(np.unique(nn)) != len(chg):
        raise SystemExit(f'not a pure permutation (max {dd.max():.2e} m, unique {len(np.unique(nn))}/{len(chg)}): re-bake instead')
    perm[chg] = chg[nn]                        # new index i takes the bake of old index perm[i]
posed = z['posed'][perm]
rep = json.loads(str(z['report'])) if 'report' in z else {}
rep['remap'] = dict(from_fingerprint=str(z['fingerprint']), changed=int(len(chg)), max_match_m=float(dd.max()) if len(chg) else 0.0)
np.savez_compressed(fout, posed=posed.astype(np.float32), frame=z['frame'], verts=z['verts'], fingerprint=np.array(fp(b)),
                    report=np.array(json.dumps(rep)))
print('[remap] changed', len(chg), 'new fingerprint', fp(b), '->', fout)
