"""Encode every texture of the raw pianist GLB (+ the generated hand set) as WebP for the packed asset.

  python -I encode_textures.py <pianist_raw.glb> <tex_dir>

Writes <tex_dir>/webp/img<i>.webp for every GLB image, hand_{albedo,normal,orm}.webp, and manifest.json
{images: [{index, name, file, role, bytes}], hand: {...}}. Quality per role: colour 90, data maps (normal/ORM) 95.
Pillow's libwebp is deterministic for a given input and settings.
"""
import sys, os, json, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from glbio import GLB

src, tex = sys.argv[1], sys.argv[2]
out = os.path.join(tex, 'webp'); os.makedirs(out, exist_ok=True)
g = GLB(src)
roles = {}
for m in g.js.get('materials', []):
    pbr = m.get('pbrMetallicRoughness', {})
    for key, role in ((pbr.get('baseColorTexture'), 'color'), (m.get('normalTexture'), 'normal'),
                      (pbr.get('metallicRoughnessTexture'), 'data'), (m.get('occlusionTexture'), 'data')):
        if key: roles[g.js['textures'][key['index']]['source']] = role
man = {'images': [], 'hand': {}}
def enc(im, path, role, lossless=False):
    q = 90 if role == 'color' else 95
    if im.mode not in ('RGB', 'RGBA'): im = im.convert('RGBA' if 'A' in im.mode else 'RGB')
    if im.mode == 'RGBA' and im.getextrema()[3][0] == 255: im = im.convert('RGB')
    if lossless: im.save(path, 'WEBP', lossless=True, quality=100, method=6)
    else: im.save(path, 'WEBP', quality=q, method=6)
    return os.path.getsize(path)
for i, img in enumerate(g.js.get('images', [])):
    b, mime = g.image_bytes(i)
    im = Image.open(io.BytesIO(b))
    role = roles.get(i, 'color')
    p = os.path.join(out, f'img{i}.webp')
    n = enc(im, p, role, lossless='pinstripe' in (img.get('name') or ''))   # 1-texel pinstripes do not survive lossy
    man['images'].append(dict(index=i, name=img.get('name'), file=os.path.relpath(p, tex), role=role, size=list(im.size),
                              bytes_png=len(b), bytes=n))
    print(f'[webp] img{i} {img.get("name")} {im.size} {role}: {len(b)} -> {n} bytes')
# hand set (session 3): the normal map is LOSSLESS (lossy WebP q95 kept only 73-77 % of the high-pass energy of the
# normal x/y channels -> pores, hatch and wrinkles went soft in macros; measured on an 800^2 dorsum crop), the albedo q95
for k, role in (('albedo', 'color'), ('normal', 'normal'), ('orm', 'data')):
    p = os.path.join(tex, f'hand_{k}.png')
    if os.path.exists(p):
        im = Image.open(p)
        q = os.path.join(out, f'hand_{k}.webp')
        if k == 'normal':
            im.convert('RGB').save(q, 'WEBP', lossless=True, quality=100, method=4); n = os.path.getsize(q)
        elif k == 'albedo':
            im.convert('RGB').save(q, 'WEBP', quality=95, method=6); n = os.path.getsize(q)
        else:
            n = enc(im, q, role)
        man['hand'][k] = dict(file=os.path.relpath(q, tex), size=list(im.size), bytes=n)
        print(f'[webp] hand_{k} {im.size}: {os.path.getsize(p)} -> {n} bytes')
p = os.path.join(tex, 'suit_normal.png')
if os.path.exists(p):
    q = os.path.join(out, 'suit_normal.webp')       # lossless: 1-2 texel topstitch / seam lines do not survive lossy
    Image.open(p).convert('RGB').save(q, 'WEBP', lossless=True, quality=100, method=4); n = os.path.getsize(q)
    man['suit_normal'] = dict(file=os.path.relpath(q, tex), bytes=n); print(f'[webp] suit_normal: {os.path.getsize(p)} -> {n} bytes')
json.dump(man, open(os.path.join(tex, 'manifest.json'), 'w'), indent=1)
