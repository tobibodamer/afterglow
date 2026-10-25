"""Side-by-side comparison of rendered frames against the reference images, with proxy metrics.

usage: python tools/compare.py pairs.json out_dir
pairs.json: [{"ref": "refs/3.webp", "render": "build/stills/shot03.png", "name": "behind-centre"}, ...]

Metrics (all proxies, none of them is "the truth"):
  band_dE    mean CIEDE76 distance between the average colours of 12 horizontal bands (palette + layout)
  hist_sim   1 - Bhattacharyya distance of joint a*b* histograms (overall colour distribution)
  tone_err   mean |difference| of luminance percentiles (1..99) in L* units (contrast / black level)
  ssim_lo    SSIM of 96-px-tall blurred grey thumbnails (large-scale structure / composition)
  score      0..100 blend of the above. Useful for tracking progress across passes, not an absolute grade.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def load(p, size=None):
    im = Image.open(p).convert("RGB")
    if size:
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im)


def lab(im):
    return cv2.cvtColor(im, cv2.COLOR_RGB2LAB).astype(np.float32) * [100 / 255, 1, 1] - [0, 128, 128]


def ssim(a, b):
    a = a.astype(np.float64); b = b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mu_a = cv2.GaussianBlur(a, (7, 7), 1.5); mu_b = cv2.GaussianBlur(b, (7, 7), 1.5)
    sa = cv2.GaussianBlur(a * a, (7, 7), 1.5) - mu_a ** 2
    sb = cv2.GaussianBlur(b * b, (7, 7), 1.5) - mu_b ** 2
    sab = cv2.GaussianBlur(a * b, (7, 7), 1.5) - mu_a * mu_b
    m = ((2 * mu_a * mu_b + c1) * (2 * sab + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (sa + sb + c2))
    return float(m.mean())


def metrics(ref, ren):
    L1, L2 = lab(ref), lab(ren)
    h = ref.shape[0]
    bands = []
    for i in range(12):
        s = slice(int(h * i / 12), int(h * (i + 1) / 12))
        bands.append(float(np.linalg.norm(L1[s].reshape(-1, 3).mean(0) - L2[s].reshape(-1, 3).mean(0))))
    band_dE = float(np.mean(bands))
    rng = [[-60, 60], [-60, 60]]
    h1, _, _ = np.histogram2d(L1[..., 1].ravel(), L1[..., 2].ravel(), bins=32, range=rng)
    h2, _, _ = np.histogram2d(L2[..., 1].ravel(), L2[..., 2].ravel(), bins=32, range=rng)
    h1 /= h1.sum(); h2 /= h2.sum()
    hist_sim = float(np.sum(np.sqrt(h1 * h2)))
    q = np.arange(1, 100)
    tone_err = float(np.mean(np.abs(np.percentile(L1[..., 0], q) - np.percentile(L2[..., 0], q))))
    th = 96
    tw = int(ref.shape[1] * th / ref.shape[0])
    g1 = cv2.GaussianBlur(cv2.resize(cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY), (tw, th), interpolation=cv2.INTER_AREA), (3, 3), 0)
    g2 = cv2.GaussianBlur(cv2.resize(cv2.cvtColor(ren, cv2.COLOR_RGB2GRAY), (tw, th), interpolation=cv2.INTER_AREA), (3, 3), 0)
    ss = ssim(g1, g2)
    score = 100 * (0.30 * np.exp(-band_dE / 12) + 0.25 * hist_sim + 0.20 * np.exp(-tone_err / 10) + 0.25 * max(ss, 0))
    return dict(band_dE=round(band_dE, 2), band_dE_each=[round(x, 1) for x in bands], hist_sim=round(hist_sim, 3),
                tone_err=round(tone_err, 2), ssim_lo=round(ss, 3), score=round(float(score), 1))


def sheet(ref, ren, name, m, path):
    h, w = ref.shape[:2]
    canvas = Image.new("RGB", (w * 2 + 30, h + 70), (18, 18, 22))
    canvas.paste(Image.fromarray(ref), (10, 60))
    canvas.paste(Image.fromarray(ren), (w + 20, 60))
    d = ImageDraw.Draw(canvas)
    try:
        f = ImageFont.truetype("arial.ttf", 22)
    except OSError:
        f = ImageFont.load_default()
    d.text((10, 12), f"REFERENCE  |  {name}", fill=(230, 230, 230), font=f)
    d.text((w + 20, 12), f"RENDER  score {m['score']}  bandE {m['band_dE']}  hist {m['hist_sim']}  tone {m['tone_err']}  ssim {m['ssim_lo']}",
           fill=(230, 230, 230), font=f)
    canvas.save(path, quality=92)


def main():
    pairs = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    res = []
    for p in pairs:
        ref = load(p["ref"])
        ren = load(p["render"], (ref.shape[1], ref.shape[0]))
        m = metrics(ref, ren)
        m["name"] = p.get("name", os.path.basename(p["render"]))
        sheet(ref, ren, m["name"], m, os.path.join(out, f"cmp_{m['name']}.jpg"))
        res.append(m)
        print(f"{m['name']:24s} score {m['score']:5.1f}  bandE {m['band_dE']:5.1f}  hist {m['hist_sim']:.3f}  tone {m['tone_err']:5.1f}  ssim {m['ssim_lo']:.3f}")
    if res:
        print(f"{'MEAN':24s} score {np.mean([r['score'] for r in res]):5.1f}")
    json.dump(res, open(os.path.join(out, "metrics.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
