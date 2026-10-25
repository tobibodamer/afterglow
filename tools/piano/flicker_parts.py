# Temporal stability of the piano's highlights per PART over consecutive film frames (critic r2 qc_flicker.py, split
# by the parts id pass so the waterline ripples at the leg feet do not dominate the lid-edge number).
#   python tools/piano/flicker_parts.py <outDir> <seqPrefix> <parts.png> [--thr 40]
# Prints per part (lid, prop, side, desk, legs): highlight pixels (max over time > thr, mask eroded 1 px), mean |dL|
# between consecutive frames, mean / p90 temporal std, fraction std > 8, and the sky-patch noise for scale; also the
# number of connected > thr components in the temporal MEAN image of the lid + prop (a continuous line = few).
import sys, os, glob
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

CLS = {'lid': (1, 0, 0), 'side': (0, 1, 0), 'desk': (0, 0, 1), 'legs': (1, 1, 0), 'prop': (1, 0, 1), 'bench': (.5, .5, .5), 'other': (0, 1, 1)}
a = sys.argv[1:]; thr = 40.0
if '--thr' in a: i = a.index('--thr'); thr = float(a[i + 1]); del a[i:i + 2]
d, pref, pp = a[0], a[1], a[2]
files = sorted(glob.glob(os.path.join(d, pref + '_f*.png')))
L = np.stack([(lambda x: 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2])(np.array(Image.open(f).convert('RGB')).astype(np.float32)) for f in files])
pa = np.array(Image.open(pp).convert('RGB')).astype(np.float32) / 255.0
lum = pa.max(axis=2); on = lum > 0.25
n = pa / np.maximum(lum[..., None], 1e-3)
names = list(CLS)
idx = np.stack([((n - np.array(CLS[k])) ** 2).sum(axis=2) for k in names], axis=-1).argmin(axis=-1)
dl = np.abs(np.diff(L, axis=0)).mean(0); sd = L.std(0); mx = L.max(0); mean = L.mean(0)
sky = np.zeros(L.shape[1:], bool); sky[40:200, 40:400] = True
print('%s: %d frames; sky patch |dL| %.2f std %.2f' % (pref, len(files), dl[sky].mean(), sd[sky].mean()))
for k in ('lid', 'prop', 'side', 'desk', 'legs'):
    m = ndi.binary_erosion(on & (idx == names.index(k)), iterations=1)
    hi = m & (mx > thr)
    if hi.sum() < 5: print('  %-5s highlight px %5d' % (k, hi.sum())); continue
    print('  %-5s highlight px %5d  |dL| %5.2f  std mean %5.2f p90 %5.2f  frac(std>8) %.3f' % (k, hi.sum(), dl[hi].mean(), sd[hi].mean(), np.percentile(sd[hi], 90), (sd[hi] > 8).mean()))
lp = on & ((idx == names.index('lid')) | (idx == names.index('prop')))
lab, nc = ndi.label(lp & (mean > thr))
sizes = ndi.sum(lp & (mean > thr), lab, range(1, nc + 1)) if nc else np.array([0])
print('  lid+prop > %g in the temporal mean: %d px in %d components (largest %d)' % (thr, int((lp & (mean > thr)).sum()), nc, int(max(sizes) if nc else 0)))
