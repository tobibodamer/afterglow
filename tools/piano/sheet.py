"""Contact sheet of PNGs in a directory (labelled grid).
usage: python tools/piano/sheet.py <dir> <out.jpg> [cols=4] [thumbW=480] [glob=*.png]
"""
import glob
import os
import sys

from PIL import Image, ImageDraw


def main():
    d, out = sys.argv[1], sys.argv[2]
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    tw = int(sys.argv[4]) if len(sys.argv) > 4 else 480
    pat = sys.argv[5] if len(sys.argv) > 5 else '*.png'
    files = sorted(f for f in glob.glob(os.path.join(d, pat)) if not f.endswith(('_probe.png', '_eval.png')))
    if not files:
        print('no files'); return
    ims = [Image.open(f).convert('RGB') for f in files]
    th = int(tw * ims[0].height / ims[0].width)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, rows * (th + 18)), (16, 16, 20))
    dr = ImageDraw.Draw(sheet)
    for i, (f, im) in enumerate(zip(files, ims)):
        x, y = (i % cols) * tw, (i // cols) * (th + 18)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 18))
        dr.text((x + 4, y + 3), os.path.basename(f), fill=(230, 230, 230))
    sheet.save(out, quality=90)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
