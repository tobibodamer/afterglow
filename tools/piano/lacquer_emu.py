# Offline emulator of the art-directed lacquer (materials.js agFold + coat F0 + env grade + kicker) for the wide
# shots, so look knobs can be tuned on the CPU while the shared GPU is busy. Inputs: the CPU G-buffer of each shot
# (tools/piano/gbuffer.mjs), the piano's env probe dump (shots.mjs dumpProbe, sRGB clamped at 1), and a real render of
# the same shot (non-lacquer pixels are taken from it, inverted through PBR Neutral + sRGB). Output: piano-pixel stats
# against the reference masks, like tools/piano/wide_stats.py, and optional preview PNGs.
#   python tools/piano/lacquer_emu.py <gbDir> <probe.png> <renderDir> <renderSuffix> '<look json>' [--png outDir] [--tag T]
# Approximations: one sample per pixel (no AA, no fillet edge boost), clamped probe (glow core > 1 clipped), no glare,
# no under-case / near-field occlusion, Schlick coat Fresnel. Calibrate against a GPU render before trusting numbers.
import sys, os, json
import numpy as np
from PIL import Image

root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REF = {'r02_hero': 'r2', 'r04_bass': 'r4', 'r09_water': 'r9', 'r10_establish': 'r10', 'r11m_rear': 'r11'}
BASE = dict(f0=0.06, f0Up=0.06, f0Leg=0.06, fold=0.0, foldLeg=0.0, axis=1.0, sweep=1.0, lift=0.0, pY=0.80, pG=0.25,
            pW=0.0, pLeg=0.0, pT=4.0, pC=0.3, kick=0.0, kickR=0.0, parR=6.0, parW=0.0, parLeg=0.0, envG=1.0, envW=1.0)
NY = (0.45, 0.75)
SUN = np.array([0.0, 0.0, -1.0])
KICK_DIR = np.array([0.0, np.sin(np.radians(4.0)), -np.cos(np.radians(4.0))]); KICK_DIR /= np.linalg.norm(KICK_DIR)
KICK_HUE = np.array([1.0, 0.475, 0.167])

def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)

def pbr_neutral(c):
    start, desat = 0.8 - 0.04, 0.15
    x = c.min(axis=-1, keepdims=True)
    off = np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    c = c - off
    peak = c.max(axis=-1, keepdims=True)
    d = 1 - start
    newPeak = 1 - d * d / (peak + d - start)
    comp = peak >= start
    c2 = c * (newPeak / np.maximum(peak, 1e-9))
    g = 1 - 1 / (desat * (peak - newPeak) + 1)
    c2 = c2 * (1 - g) + newPeak * g
    return np.where(comp, c2, c)

def pbr_neutral_inv(y):
    # numeric inverse for the toe region and the compression (per-channel approximation via a 1D LUT on grey)
    xs = np.concatenate([np.linspace(0, 0.2, 4000), np.linspace(0.2, 40, 8000)])
    ys = pbr_neutral(np.repeat(xs[:, None], 3, axis=1))[:, 0]
    return np.interp(y, ys, xs)

class Cube:
    # dumped faces +x -x +y -y +z -z, rows top-down, three.js WebGL cube cameras (side faces up +y)
    F = [np.array(v, float) for v in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]]
    U = [np.array(v, float) for v in [(0, 1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1), (0, 1, 0), (0, 1, 0)]]
    def __init__(self, path):
        im = np.array(Image.open(path).convert('RGB')).astype(np.float32) / 255.0
        n = im.shape[0]; self.n = n
        self.faces = [srgb_to_lin(im[:, i * n:(i + 1) * n]) for i in range(6)]
        self.R = [np.cross(f, u) for f, u in zip(self.F, self.U)]
    def sample(self, d):
        # render-target cube faces are stored mirrored in x (three samples them with flipEnvMap = -1); checked by
        # emulating the background of r09_water against the real render
        d = d * np.array([-1.0, 1.0, 1.0])
        d = d / np.linalg.norm(d, axis=-1, keepdims=True)
        ax = np.abs(d).argmax(axis=-1); sg = np.take_along_axis(d, ax[:, None], 1)[:, 0] > 0
        face = ax * 2 + (~sg).astype(int)
        out = np.zeros(d.shape, np.float32)
        for fi in range(6):
            m = face == fi
            if not m.any(): continue
            dd = d[m]; fz = dd @ self.F[fi]
            u = (dd @ self.R[fi] / fz + 1) * 0.5; v = (1 - dd @ self.U[fi] / fz) * 0.5
            x = np.clip(u * self.n - 0.5, 0, self.n - 1.001); y = np.clip(v * self.n - 0.5, 0, self.n - 1.001)
            x0 = x.astype(int); y0 = y.astype(int); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
            I = self.faces[fi]
            out[m] = (I[y0, x0] * (1 - fx) * (1 - fy) + I[y0, x0 + 1] * fx * (1 - fy) + I[y0 + 1, x0] * (1 - fx) * fy + I[y0 + 1, x0 + 1] * fx * fy)
        return out

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def fold(r, v, n, pw, parC, o, leg):
    vert = 1 - smooth(NY[0], NY[1], np.abs(n[:, 1]))
    K = (o['foldLeg'] if leg else o['fold']) * vert
    Px = (o['pLeg'] if leg else o['pW']) * vert
    Pw = (o['parLeg'] if leg else o['parW']) * vert
    r = r.copy()
    # backdrop azimuth fold
    h = np.stack([v[:, 0], np.zeros(len(v)), v[:, 2]], 1); lh = np.linalg.norm(h, axis=1, keepdims=True)
    h = np.where(lh > 1e-4, h / np.maximum(lh, 1e-9), SUN)
    h = SUN * (1 - o['axis']) + h * o['axis']; h /= np.linalg.norm(h, axis=1, keepdims=True)
    sd = np.stack([-h[:, 2], np.zeros(len(h)), h[:, 0]], 1)
    ry = np.clip(r[:, 1], -1, 1); hl = np.sqrt(np.maximum(0, 1 - ry * ry))
    fw = (r * h).sum(1); lat = (r * sd).sum(1)
    phr = np.arctan2(lat, fw); phb = np.arcsin(np.clip(o['sweep'] * lat / np.maximum(hl, 1e-4), -1, 1))
    ph = phr + (phb - phr) * K
    rf = np.stack([np.zeros(len(r)), ry, np.zeros(len(r))], 1) + (h * np.cos(ph)[:, None] + sd * np.sin(ph)[:, None]) * hl[:, None]
    r = np.where((K > 0)[:, None], rf, r)
    # parallax backdrop
    rh = r[:, [0, 2]]; lrh = np.linalg.norm(rh, axis=1)
    ok = (Pw > 0) & (o['parR'] > 0) & (lrh > 1e-3)
    rhn = rh / np.maximum(lrh, 1e-9)[:, None]
    dd = pw[:, [0, 2]] - parC[[0, 2]]
    b = (dd * rhn).sum(1); c = (dd * dd).sum(1) - o['parR'] ** 2; disc = b * b - c
    ok &= disc > 0
    hd = dd + (-b + np.sqrt(np.maximum(disc, 0)))[:, None] * rhn; hd /= np.maximum(np.linalg.norm(hd, axis=1), 1e-9)[:, None]
    nh = rhn + (hd - rhn) * Pw[:, None]; nh /= np.maximum(np.linalg.norm(nh, axis=1), 1e-9)[:, None]
    r = np.where(ok[:, None], np.stack([nh[:, 0] * lrh, r[:, 1], nh[:, 1] * lrh], 1), r)
    # proxy elevation (piano-frame height)
    rn = r / np.linalg.norm(r, axis=1, keepdims=True); el = np.arcsin(np.clip(rn[:, 1], -1, 1))
    yP = pw[:, 1] - parC[1] + 0.9
    pT = np.radians(o['pT'])
    el2 = np.clip(pT + o['pC'] * (el - pT) + o['pG'] * (yP - o['pY']), -1.4, 1.4)
    el = el + (el2 - el) * Px
    hz = rn[:, [0, 2]] / np.maximum(np.linalg.norm(rn[:, [0, 2]], axis=1), 1e-4)[:, None]
    r2 = np.stack([hz[:, 0] * np.cos(el), np.sin(el), hz[:, 1] * np.cos(el)], 1)
    r = np.where((Px > 0)[:, None], r2, rn)
    lift = np.tan(np.radians(o['lift']))
    r[:, 1] += (1 - Px) * lift * smooth(-0.12, 0, r[:, 1]) * (1 - smooth(0.03, 0.09, r[:, 1]))
    return r / np.linalg.norm(r, axis=1, keepdims=True), vert

def emulate(gbdir, shot, cube, render_lin, o, H=1080, W=1920):
    meta = json.load(open(os.path.join(gbdir, shot + '_gb.json')))
    gb = np.fromfile(os.path.join(gbdir, shot + '_gb.bin'), np.float32).reshape(H * W, 6)
    gid = np.fromfile(os.path.join(gbdir, shot + '_gb_id.bin'), np.uint8).reshape(H * W)
    part, mat = gid >> 4, gid & 15
    yaw = np.radians(meta['rigYaw'])
    cy, sy = np.cos(yaw), np.sin(yaw)
    rot = lambda a: np.stack([a[:, 0] * cy + a[:, 2] * sy, a[:, 1], -a[:, 0] * sy + a[:, 2] * cy], 1)
    out = render_lin.reshape(H * W, 3).copy()
    lac = (mat == 1) | (mat == 2)
    idx = np.where(lac)[0]
    P = rot(gb[idx, :3]); N = rot(gb[idx, 3:]); N /= np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
    cam = rot(np.array([meta['camPos']], float))[0]
    V = P - cam; V /= np.linalg.norm(V, axis=1)[:, None]          # camera -> point
    flip = (N * V).sum(1) > 0; N[flip] *= -1                        # face the camera
    parC = rot(np.array([[0.0, 0.86, 1.2]]))[0]
    leg = mat[idx] == 2
    R = V - 2 * (V * N).sum(1)[:, None] * N
    env = np.zeros((len(idx), 3), np.float32)
    F0 = np.where(leg, o['f0Leg'], o['f0'])
    F0 = F0 + (o['f0Up'] - F0) * smooth(0.55, 0.85, N[:, 1])
    for lg in (False, True):
        m = leg == lg
        if not m.any(): continue
        rr, vert = fold(R[m], V[m], N[m], P[m], parC, o, lg)
        e = cube.sample(rr)
        g = 1 + (o['envG'] - 1) * vert
        L = np.maximum(e @ np.array([0.2126, 0.7152, 0.0722]), 1e-6)
        e = e * np.power(L / o['envW'], g - 1)[:, None]
        env[m] = e
    cosv = np.clip(-(V * N).sum(1), 0, 1)
    F = F0 + (1 - F0) * (1 - cosv) ** 5
    col = env * F[:, None]
    if o['kick'] > 0:
        a = max(o['kickR'], 0.02) ** 2
        Ld = KICK_DIR; Vv = -V
        Hh = Ld[None, :] + Vv; Hh /= np.linalg.norm(Hh, axis=1)[:, None]
        nh = np.clip((N * Hh).sum(1), 0, 1); nl = np.clip(N @ Ld, 0, 1); nv = np.clip((N * Vv).sum(1), 1e-4, 1)
        D = a * a / (np.pi * (nh * nh * (a * a - 1) + 1) ** 2)
        Vis = 0.25  # (approx. 1 / (4 nl nv) x G at low roughness; kicker lines are sub-pixel anyway)
        Fk = F0 + (1 - F0) * (1 - np.clip((Vv * Hh).sum(1), 0, 1)) ** 5
        col += (D * Vis * Fk * nl)[:, None] * (KICK_HUE * o['kick'])[None, :]
    out[idx] = col
    return out.reshape(H, W, 3), (part.reshape(H, W), mat.reshape(H, W))

def stats(v):
    return dict(p50=np.percentile(v, 50), p75=np.percentile(v, 75), p90=np.percentile(v, 90), p95=np.percentile(v, 95), p99=np.percentile(v, 99), gt40=(v > 40).mean(), gt80=(v > 80).mean())

def main():
    gbdir, probe, rdir, rsuf, look = sys.argv[1:6]
    o = dict(BASE); o.update(json.loads(look))
    pngdir = sys.argv[sys.argv.index('--png') + 1] if '--png' in sys.argv else None
    tag = sys.argv[sys.argv.index('--tag') + 1] if '--tag' in sys.argv else 'emu'
    cube = Cube(probe)
    keys = ['p50', 'p75', 'p90', 'p95', 'p99', 'gt40', 'gt80']
    print('%-14s %s' % ('shot', ' '.join('%7s' % k for k in keys)))
    ratios = []
    for shot, rk in REF.items():
        rp = os.path.join(rdir, f'{shot}_{rsuf}.png' if rsuf else f'{shot}.png')
        if not os.path.exists(rp) or not os.path.exists(os.path.join(gbdir, shot + '_gb.json')): continue
        disp = np.array(Image.open(rp).convert('RGB')).astype(np.float32) / 255.0
        lin = pbr_neutral_inv(srgb_to_lin(disp))
        hdr, (part, mat) = emulate(gbdir, shot, cube, lin, o)
        d8 = lin_to_srgb(pbr_neutral(np.maximum(hdr, 0))) * 255
        Lm = 0.2126 * d8[..., 0] + 0.7152 * d8[..., 1] + 0.0722 * d8[..., 2]
        m = (part > 0) & (part != 6)
        s = stats(Lm[m])
        rs = json.load(open(os.path.join(root, 'sandbox', 'piano2', 'masks', rk + '_stats.json')))
        rsv = {k: rs.get(k, rs.get('frac_' + k, 0.0)) for k in keys}
        print('%-14s %s' % (shot, ' '.join(('%7.3f' if k.startswith('gt') else '%7.1f') % s[k] for k in keys)))
        print('%-14s %s' % ('  /ref', ' '.join('%7.2f' % (s[k] / rsv[k]) if rsv[k] else '      -' for k in keys)))
        ratios.append([s[k] / rsv[k] for k in keys if rsv[k]])
        if pngdir:
            os.makedirs(pngdir, exist_ok=True)
            Image.fromarray(np.clip(d8, 0, 255).astype(np.uint8)).save(os.path.join(pngdir, f'{shot}_{tag}.png'))
    r = np.array(ratios)
    if len(r):
        err = np.abs(np.log(r)).mean()
        print('mean |log ratio| %.3f  (%s)' % (err, ' '.join('%.2f' % x for x in np.exp(np.abs(np.log(r)).mean(0)))))

main()
