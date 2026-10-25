"""Build pairs.json from a sandbox/piano2 shots file + render dir and run tools/compare.py on the shots that have a ref.

usage: python tools/piano/cmp_shots.py sandbox/piano2/core_refs.json sandbox/piano2/out/c1 [cmp_out_dir]
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    shots_file, render_dir = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(render_dir, 'cmp')
    job = json.load(open(os.path.join(ROOT, shots_file) if not os.path.isabs(shots_file) else shots_file))
    pairs = []
    for s in job['shots']:
        ref = s.get('ref')
        png = os.path.join(render_dir, s['name'] + '.png')
        if ref and os.path.exists(os.path.join(ROOT, png) if not os.path.isabs(png) else png):
            pairs.append({'ref': ref, 'render': png.replace('\\', '/'), 'name': s['name']})
    os.makedirs(out, exist_ok=True)
    pj = os.path.join(out, 'pairs.json')
    json.dump(pairs, open(pj, 'w'), indent=1)
    py = os.path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    subprocess.run([py, os.path.join(ROOT, 'tools', 'compare.py'), pj, out], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
