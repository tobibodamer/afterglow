// Build a shot file with per-shot variants (look-dev A/B in one session).
//   node tools/piano/variants.mjs <base.json> <out.json> '<variants json>' [names,comma]
// variants: { "<suffix>": { "preEval": "...", "piano": {...}, ... }, ... } merged into each selected shot.
import fs from 'node:fs';
const [base, out, vjson, names] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(base, 'utf8'));
const V = JSON.parse(vjson.endsWith('.json') ? fs.readFileSync(vjson, 'utf8') : vjson);
const sel = names ? names.split(',') : null;
const shots = [];
for (const s of job.shots) {
  if (sel && !sel.includes(s.name)) continue;
  for (const [suf, v] of Object.entries(V)) {
    const pre = [s.preEval, v.preEval].filter(Boolean).join('\n');
    shots.push({ ...s, ...v, name: suf ? `${s.name}_${suf}` : s.name, ...(pre ? { preEval: pre } : {}) });
  }
}
fs.writeFileSync(out, JSON.stringify({ ...job, shots }, null, 1));
console.log(`${shots.length} shots -> ${out}`);
