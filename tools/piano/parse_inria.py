import re, json, sys
src = r'E:\experimentswithclaude\random\afterglow\sandbox\piano\dl_inria\rt0425.txt'
lines = [l.strip() for l in open(src, encoding='utf-8').read().splitlines()]
# Appendix A spans from 'Wrapped strings values' (2nd occurrence) to 'Unwrapped strings values' (2nd occurrence)
idxA = [i for i, l in enumerate(lines) if l == 'Wrapped strings values'][-1]
idxB = [i for i, l in enumerate(lines) if l == 'Unwrapped strings values'][-1]
seg = lines[idxA:idxB]
fields = ['f0', 'L', 'd', 'ρ', 'T0', 'Ru', 'Rv', 'Rφ', 'ηu', 'ηv', 'ηφ', 'p', 'xH', 'MH', 'KH', 'RH', 'x0', 'y0']
rows = []
i = 0
while i < len(seg):
    if seg[i] == 'Note':
        names = []
        j = i + 1
        while seg[j] != 'f0':
            names.append(seg[j]); j += 1
        n = len(names)
        block = {k: None for k in fields}
        cur = j
        for f in fields:
            # find field label
            while cur < len(seg) and seg[cur] != f:
                cur += 1
            vals = seg[cur + 2: cur + 2 + n]
            block[f] = vals
            cur = cur + 2 + n
        for k in range(n):
            rows.append({'note': names[k], **{f: block[f][k] for f in ['f0', 'L', 'd', 'T0', 'xH', 'MH', 'x0', 'y0']}})
        i = cur
    else:
        i += 1
print(len(rows))
for r in rows:
    print(r['note'], r['f0'], r['L'], r['d'], r['T0'], r['xH'], r['MH'], r['x0'], r['y0'])
json.dump(rows, open(r'E:\experimentswithclaude\random\afterglow\sandbox\piano\inria_wrapped.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
