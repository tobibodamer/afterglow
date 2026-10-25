# Variant shot list for sandbox/piano2/shots.mjs: every shot of <base.json> x every variant of <vars.json>.
#   python tools/piano/make_variants.py <base.json> <vars.json> <out.json> [--preset wide]
# vars.json: { "V1": { "look": {...lacquer look keys} } | { "preEval": "js" }, ... }. A "look" is applied with
# window.__agPiano.setLookOverride({...lacquerLooks[preset], ...look}) (the integration module resets setLacquerLook
# before every frame, so look-dev must use the override). Only the first variant of each shot renders the piano mask
# (the masks do not depend on the look); tools/piano/wide_stats.py falls back to it.
import sys, json

def main():
    base = json.load(open(sys.argv[1]))
    var = json.load(open(sys.argv[2]))
    preset = sys.argv[sys.argv.index('--preset') + 1] if '--preset' in sys.argv else 'wide'
    shots = []
    for s in base['shots']:
        for i, (vn, v) in enumerate(var.items()):
            t = dict(s)
            t['name'] = s['name'] + '_' + vn
            if 'look' in v:
                t['preEval'] = ('window.__agPiano.setLookOverride({...window.__agPiano.lacquerLooks.%s, ...%s});'
                                % (preset, json.dumps(v['look'])))
            elif 'preEval' in v:
                t['preEval'] = v['preEval']
            if base.get('mask') or s.get('mask'):
                t['mask'] = i == 0
            shots.append(t)
    out = {k: v for k, v in base.items() if k != 'shots'}
    out['shots'] = shots
    json.dump(out, open(sys.argv[3], 'w'), indent=1)
    print(sys.argv[3], len(shots), 'shots')

main()
