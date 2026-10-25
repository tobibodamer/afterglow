# Exact-substring replacements in a file from a JSON list of [old, new] pairs (fails loudly on a missing match).
#   python tools/piano/subst.py <file> <pairs.json>
import sys, json
path, pairs = sys.argv[1], json.load(open(sys.argv[2], encoding='utf-8'))
src = open(path, encoding='utf-8').read()
bad = 0
for old, new in pairs:
    k = src.count(old)
    if k != 1:
        print('MATCH COUNT %d for: %s' % (k, old[:100].replace('\n', '\\n')))
        bad += 1
        continue
    src = src.replace(old, new)
if bad:
    sys.exit(1)
open(path, 'w', encoding='utf-8', newline='').write(src)
print('ok', len(pairs), 'replacements')
