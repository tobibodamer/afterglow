"""Nail plates as real geometry (close-ups like refs 7/8/12 show the plate edge, its gloss and the free edge).

  python -I nails.py <pianist_raw.glb> <tex_dir>      (reads <tex_dir>/nail_frames.json from hand_textures.py)

Writes <tex_dir>/nails.bin + nails.json: one skinned mesh 'Pianist_nails' (10 plates) that pack.mjs adds to the GLB
with the body's skin and material 'pianist_nail' (the hand texture set; the module makes it glossy keratin).

Each plate uses the SAME frame and outline as the nail paint in hand_textures.py (planar nail coordinates: s along the
distal phalanx from the DIP joint, l across (S = d x D), projection along -D, the detected dorsal direction):
- attached zone (proximal fold -> onychodermal band): the plate's underside is the skin surface (ray hit along -D),
  its top is lifted 0.42 mm (+0.05 dome); it dives 0.2 mm under the skin at the proximal fold (cuticle line) and at
  the lateral folds, so the skin covers the edges exactly where the texture paints the folds;
- free edge (onychodermal band -> plate end, ~1.3 mm): extrapolated along the plate's own tangent with a slight curl,
  closed with an underside and a rim (0.45 mm thick) -> the white free edge has visible thickness and a shadow gap
  over the hyponychium, never penetrating the fingertip.
Every vertex takes the skin weights, UV and _THICK of the skin point under it (barycentric), so the plate deforms with
the finger exactly like the skin it sits on. Deterministic (no randomness).
"""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from glbio import GLB
import nailgeo

T0 = time.time()
SRC, OUT = sys.argv[1], sys.argv[2]
g = GLB(SRC)
FR = json.load(open(os.path.join(OUT, 'nail_frames.json')))['nails']
prims = g.mesh_primitives('body')
hp = [p for _, p in prims if g.material_name(p) == 'pianist_skin_hand'][0]
body_node = [ni for ni, p in prims][0]
assert np.allclose(g.world(body_node), np.eye(4), atol=1e-6), 'body node is not at identity: nail frames would not match'
A = hp['attributes']
POS = g.acc(A['POSITION']).astype(np.float64) * 1000.0
UV = g.acc(A['TEXCOORD_0']).astype(np.float64)
JNT = g.acc(A['JOINTS_0']).astype(np.int32)
WGT = g.acc(A['WEIGHTS_0']).astype(np.float64)
THK = g.acc(A['_THICK']).astype(np.float64).ravel() if '_THICK' in A else np.full(len(POS), 0.016)
TRI = g.acc(hp['indices']).reshape(-1, 3).astype(np.int64)
skin = g.js['skins'][g.nodes[body_node]['skin']]
JN = [g.nodes[j]['name'] for j in skin['joints']]
jidx = {n: i for i, n in enumerate(JN)}

THICK = 0.36        # plate thickness above the bed (mm); fix round 1: 0.40 -> 0.36
TUCK = 0.20         # depth under the folds (mm)
NU, NA, NF = 17, 22, 7            # columns; rows in the attached zone / the free lip

def unit(v): return v / np.linalg.norm(v)
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def raycast(O, Dv, tris):
    return nailgeo.raycast(POS, O, Dv, tris)

def interp_skin(tri, u, v):
    """barycentric skin attributes at hits: uv (n,2), thick (n,), top-4 joints/weights"""
    b = np.stack([1 - u - v, u, v], -1)
    uv = (UV[tri] * b[..., None]).sum(1)
    th = (THK[tri] * b).sum(1)
    J = np.zeros((len(tri), 4), np.uint16); Wt = np.zeros((len(tri), 4), np.float32)
    for i in range(len(tri)):
        acc = {}
        for c in range(3):
            for k in range(4):
                w = WGT[tri[i, c], k] * b[i, c]
                if w > 0: acc[JNT[tri[i, c], k]] = acc.get(JNT[tri[i, c], k], 0.0) + w
        top = sorted(acc.items(), key=lambda x: -x[1])[:4]
        s = sum(w for _, w in top) or 1.0
        for k, (j, w) in enumerate(top): J[i, k] = j; Wt[i, k] = w / s
    return uv, th, J, Wt

V_P, V_UV, V_J, V_W, V_T, IDX = [], [], [], [], [], []
stats = {}
for F in FR:
    s_, f = F['side'], F['finger']
    H3, d, D = np.array(F['H3']), unit(np.array(F['d3'])), np.array(F['D'])
    D = unit(D - d * (D @ d)); S = np.cross(d, D)
    hw, s_fe, s_c, pc, db = F['hw'], F['s_fe'], F['s_c'], F['prox_curve'], F['dist_bulge']
    prox = lambda l: s_c + pc * np.clip(l / hw, -1.3, 1.3) ** 2
    dist = lambda l: s_fe + db * (1 - np.clip(l / hw, -1, 1) ** 2)
    attach = lambda l: dist(l) - 0.65                                 # onychodermal band = start of the white free edge
    pend = lambda l: dist(l) + 0.65                                   # plate end (free edge beyond the skin paint)
    # candidate triangles: this finger's distal skin
    jb = [jidx[b] for b in F['bones'] if b in jidx]
    wv = np.zeros(len(POS))
    for c in range(4): wv += np.where(np.isin(JNT[:, c], jb), WGT[:, c], 0)
    cen = POS[TRI].mean(1)
    tris = TRI[(wv[TRI].max(1) > 0.2) & (np.linalg.norm(cen - (H3 + d * F['smax'] * 0.6), axis=1) < 30)]

    def skin_at(sv, lv, squeeze=False):
        O = H3[None] + sv[:, None] * d[None] + lv[:, None] * S[None] + 25.0 * D[None]
        t, tri, u, v = raycast(O, -D, tris)
        if squeeze:      # tucked edge columns wider than this finger: pull the ray inward until it meets the skin
            lv = lv.copy()
            for _ in range(30):
                m = ~np.isfinite(t)
                if not m.any(): break
                lv[m] *= 0.96
                O[m] = H3[None] + sv[m, None] * d[None] + lv[m, None] * S[None] + 25.0 * D[None]
                t[m], tri[m], u[m], v[m] = raycast(O[m], -D, tris)
        return O - t[:, None] * D[None], t, tri, u, v
    # lateral extent of the dorsal surface at the nail middle (diagnostic)
    lt = np.linspace(-10, 10, 81); sm = np.full_like(lt, 0.5 * (s_c + s_fe))
    _, tt_, _, _, _ = skin_at(sm, lt)
    hitl = lt[np.isfinite(tt_)]
    ext = (float(hitl.min()), float(hitl.max())) if len(hitl) else (0, 0)

    u_ = np.linspace(-1, 1, NU)
    wide = hw + 0.45                                                  # tucked under the lateral folds
    narrow = hw * 0.92                                                # free-edge corners (sides converge slightly)
    # ---- attached zone rows: s from (prox - 1.1) to attach(l)
    va = np.linspace(0, 1, NA)
    l_att = u_[None, :] * wide * np.ones((NA, 1))
    taper = smoothstep(0.75, 1.0, va)[:, None]                        # narrow toward the band (lateral corners free)
    l_att = u_[None, :] * (wide * (1 - taper) + narrow * taper)
    s_att = (prox(l_att) - 1.1) + va[:, None] * (attach(l_att) - (prox(l_att) - 1.1))
    P_att, t_att, tri_att, uu, vv = skin_at(s_att.ravel(), l_att.ravel(), squeeze=True)
    if not np.all(np.isfinite(t_att)):
        m = ~np.isfinite(t_att)
        print('missed (s,l):', np.round(np.stack([s_att.ravel()[m], l_att.ravel()[m]], -1), 1).tolist(), 'hw', hw, 'tris', len(tris))
        bad = int(m.sum()); raise SystemExit(f'[nails] {s_}{f}: {bad} attached rays missed the skin')
    P_att = P_att.reshape(NA, NU, 3)
    # lift: tucked at the proximal fold and the lateral folds, full thickness on the visible plate
    # the plate emerges almost flush from under the proximal fold (cuticle) and reaches full height ~3.5 mm distal;
    # laterally it rolls into the lateral folds over ~1.2 mm
    sp = s_att - prox(l_att)
    hfull = THICK * (0.3 + 0.7 * smoothstep(0.0, 3.5, sp)) + 0.05 * (1 - (l_att / wide) ** 2)
    lp = smoothstep(-0.6, 0.4, sp)
    # fix round 1: a wider roll into the lateral folds (1.55 mm; was 1.2) -> no hard side step (critic1:anatomy)
    ll = smoothstep(hw + 0.45, hw - 1.10, np.abs(l_att)) * (1 - taper) + taper
    lift = -TUCK + (hfull + TUCK) * np.minimum(lp, ll)
    top_att = P_att + lift[..., None] * D
    # ---- free zone: continue the plate along its own tangent at the band, slight curl, never into the skin
    last, prev = P_att[-1], P_att[-4]                                 # (NU,3)
    tang = last - prev
    slope = np.clip((tang @ D) / np.maximum(tang @ d, 1e-6), -0.30, 0.20)
    vf = np.linspace(0, 1, NF + 1)[1:]
    l_fr = u_[None, :] * narrow * np.ones((NF, 1))
    sa = attach(l_fr[0]); se = pend(l_fr[0])
    ds = vf[:, None] * (se - sa)[None]                               # mm beyond the band
    under_fr = last[None] + ds[..., None] * (d[None, None] + slope[None, :, None] * D[None, None]) - (0.5 * ds ** 2 / 25.0)[..., None] * D
    # skin below (for clearance + attributes): rays at the same (s, l)
    s_fr = sa[None] + ds
    Pk, tk, trk, uk, vk = skin_at(s_fr.ravel(), l_fr.ravel())
    hk = (Pk - H3[None]) @ D; hu = (under_fr.reshape(-1, 3) - H3[None]) @ D
    clear = np.where(np.isfinite(tk), np.maximum(0.0, hk + 0.06 - hu), 0.0)
    under_fr = under_fr + clear.reshape(NF, NU)[..., None] * D
    top_fr = under_fr + (THICK + 0.05 * (1 - u_ ** 2))[None, :, None] * D
    # attributes: attached + free top/underside take the skin under the band row for anything past it
    s_clamp = np.minimum(s_fr, dist(l_fr) - 0.15)
    _, tc, trc, uc, vc = skin_at(s_clamp.ravel(), l_fr.ravel(), squeeze=True)
    if not np.all(np.isfinite(tc)): raise SystemExit(f'[nails] {s_}{f}: free-edge attribute rays missed')
    # ---- assemble vertex blocks
    blocks = {}
    def add(name, P3, tri, u, v, rows, cols):
        uv, th, J, Wt = interp_skin(tri, u, v)
        blocks[name] = (sum(len(x) for x in V_P), rows, cols)
        V_P.append(P3.reshape(-1, 3)); V_UV.append(uv); V_T.append(th + THICK / 1000.0); V_J.append(J); V_W.append(Wt)
    top_all = np.concatenate([top_att, top_fr], 0)                    # (NA+NF, NU, 3)
    tri_top = np.concatenate([tri_att, trc]); u_top = np.concatenate([uu, uc]); v_top = np.concatenate([vv, vc])
    add('top', top_all, tri_top, u_top, v_top, NA + NF, NU)
    # underside of the free lip: from the plate end back to the band, then 0.3 mm into the skin
    ub = np.concatenate([under_fr[::-1], (P_att[-1] - 0.25 * D)[None]], 0)       # rows: end -> band(+tuck)
    nb_rows = ub.shape[0]
    tri_b = np.concatenate([trc.reshape(NF, NU, 3)[::-1].reshape(-1, 3), tri_att.reshape(NA, NU, 3)[-1]])
    u_b = np.concatenate([uc.reshape(NF, NU)[::-1].ravel(), uu.reshape(NA, NU)[-1]]); v_b = np.concatenate([vc.reshape(NF, NU)[::-1].ravel(), vv.reshape(NA, NU)[-1]])
    add('under', ub, tri_b, u_b, v_b, nb_rows, NU)
    # rims (own vertices -> crisp edges): distal edge and the two lateral edges of the free lip
    rim_d = np.stack([top_fr[-1], under_fr[-1]], 0)                  # (2, NU)
    add('rim_d', rim_d, np.concatenate([trc.reshape(NF, NU, 3)[-1]] * 2), np.concatenate([uc.reshape(NF, NU)[-1]] * 2),
        np.concatenate([vc.reshape(NF, NU)[-1]] * 2), 2, NU)
    # lateral rims span the attached rows where the plate edge leaves the lateral fold (taper > 0) and the free lip
    r0 = int(np.nonzero(va > 0.74)[0][0]) - 1
    for side_k, col in (('rim_l', 0), ('rim_r', NU - 1)):
        tcol = np.concatenate([top_att[r0:, col], top_fr[:, col]])    # (start of the taper) -> band -> end
        bcol = np.concatenate([P_att[r0:, col] - 0.25 * D, under_fr[:, col]])
        trr = np.concatenate([tri_att.reshape(NA, NU, 3)[r0:, col], trc.reshape(NF, NU, 3)[:, col]])
        ur = np.concatenate([uu.reshape(NA, NU)[r0:, col], uc.reshape(NF, NU)[:, col]]); vr = np.concatenate([vv.reshape(NA, NU)[r0:, col], vc.reshape(NF, NU)[:, col]])
        add(side_k, np.stack([tcol, bcol], 1), np.repeat(trr, 2, axis=0), np.repeat(ur, 2), np.repeat(vr, 2), len(tcol), 2)
    # ---- triangles, oriented by the expected outward direction of each block
    exp_dir = {'top': D, 'under': -D, 'rim_d': d, 'rim_l': -S, 'rim_r': S}
    allP = np.concatenate(V_P)
    for name, (o, R_, C_) in blocks.items():
        for r in range(R_ - 1):
            for c in range(C_ - 1):
                a, b_, c2, d2 = o + r * C_ + c, o + r * C_ + c + 1, o + (r + 1) * C_ + c + 1, o + (r + 1) * C_ + c
                for tri3 in ((a, b_, c2), (a, c2, d2)):
                    n = np.cross(allP[tri3[1]] - allP[tri3[0]], allP[tri3[2]] - allP[tri3[0]])
                    if np.linalg.norm(n) < 1e-10: continue
                    ed = exp_dir[name]
                    if name in ('rim_l', 'rim_r'):          # lateral rims: outward = away from the plate centre line
                        ctr = H3 + d * ((allP[tri3[0]] - H3) @ d)
                        ed = allP[tri3[0]] - ctr; ed = ed - D * (ed @ D)
                    IDX.append(tri3 if n @ ed >= 0 else (tri3[0], tri3[2], tri3[1]))
    # stats: visible plate height over the skin, free edge gap
    stats[f'{s_}{f}'] = dict(hw=round(hw, 2), dorsal_extent_l=[round(ext[0], 2), round(ext[1], 2)], lift_max_mm=round(float(lift.max()), 3), free_edge_len_mm=round(float((se - sa).mean()), 2),
                             free_gap_mm_at_end=round(float((hu - hk).reshape(NF, NU)[-1][np.isfinite(tk.reshape(NF, NU)[-1])].mean()) if np.isfinite(tk.reshape(NF, NU)[-1]).any() else -1, 2),
                             clearance_fixes=int((clear > 0).sum()))

P = np.concatenate(V_P) / 1000.0
IDX = np.array(IDX, np.uint32)
# smooth normals per block (blocks never share vertices -> crisp rims)
Nrm = np.zeros_like(P)
fn = np.cross(P[IDX[:, 1]] - P[IDX[:, 0]], P[IDX[:, 2]] - P[IDX[:, 0]])
for k in range(3): np.add.at(Nrm, IDX[:, k], fn)
Nrm /= np.maximum(np.linalg.norm(Nrm, axis=1, keepdims=True), 1e-12)
UVa = np.concatenate(V_UV).astype(np.float32); Ja = np.concatenate(V_J); Wa = np.concatenate(V_W); Ta = np.concatenate(V_T).astype(np.float32)

buf = bytearray(); layout = {}
def put(name, arr, comps, ctype):
    global buf
    while len(buf) % 4: buf += b'\0'
    layout[name] = dict(offset=len(buf), count=int(arr.shape[0]), comps=comps, type=ctype)
    buf += np.ascontiguousarray(arr).tobytes()
put('POSITION', P.astype(np.float32), 3, 'f32')
put('NORMAL', Nrm.astype(np.float32), 3, 'f32')
put('TEXCOORD_0', UVa, 2, 'f32')
put('JOINTS_0', Ja.astype(np.uint16), 4, 'u16')
put('WEIGHTS_0', Wa.astype(np.float32), 4, 'f32')
put('_THICK', Ta.reshape(-1, 1), 1, 'f32')
put('indices', IDX.ravel(), 1, 'u32')
open(os.path.join(OUT, 'nails.bin'), 'wb').write(bytes(buf))
info = dict(mesh='Pianist_nails', material='pianist_nail', verts=int(len(P)), tris=int(len(IDX)), layout=layout,
            thickness_mm=THICK, tuck_mm=TUCK, per_nail=stats, seconds=round(time.time() - T0, 1))
json.dump(info, open(os.path.join(OUT, 'nails.json'), 'w'), indent=1)
print('[nails]', len(P), 'verts', len(IDX), 'tris', json.dumps(stats), 'in', info['seconds'], 's')
