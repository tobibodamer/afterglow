// Offline sanity check of the piano's patched shaders (no GPU, no GLSL compiler on this machine):
//   node tools/piano/check_glsl.mjs [--dump name]
// Runs every material's onBeforeCompile on three's ShaderLib.physical sources (as WebGLPrograms would), resolves the
// #include chunks and checks the result: balanced braces / parentheses, no JS template leftovers (`${`, `{opts.`,
// `undefined`, `NaN`), every ag* identifier that is used is also declared (uniform / varying / function / local).
// A shader that fails here would not compile in the browser; one that passes still needs a render to be sure.
import * as THREE from 'three';
import { LAYOUT } from '../../scene/src/piano/layout.js';
import { createMaterials } from '../../scene/src/piano/materials.js';

const M = createMaterials(LAYOUT, {});
const dumpName = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
const resolve = (src, depth = 0) => src.replace(/^[ \t]*#include +<([\w]+)>/gm, (m, name) => {
  const c = THREE.ShaderChunk[name];
  if (c === undefined) throw new Error('unknown chunk ' + name);
  return depth > 8 ? c : resolve(c, depth + 1);
});
let bad = 0, n = 0;
// three's own chunks are not brace-balanced across #if branches: compare with the unpatched shader
const base = {};
for (const [stage, src0] of [['vert', THREE.ShaderLib.physical.vertexShader], ['frag', THREE.ShaderLib.physical.fragmentShader]]) { const s = resolve(src0); base[stage] = [(s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length, (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length]; }
for (const [name, mat] of Object.entries(M)) {
  if (!mat || !mat.isMaterial || typeof mat.onBeforeCompile !== 'function') continue;
  const sh = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
  try { mat.onBeforeCompile(sh); } catch (e) { console.log(`${name}: onBeforeCompile threw ${e.message}`); bad++; continue; }
  n++;
  for (const [stage, src0] of [['vert', sh.vertexShader], ['frag', sh.fragmentShader]]) {
    let src = resolve(src0).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // our own #ifdef AG_HAS_INTERIOR blocks only exist when the define is present (no nested #if inside them)
    if (!/#define AG_HAS_INTERIOR/.test(src)) src = src.replace(/#ifdef AG_HAS_INTERIOR[\s\S]*?#endif/g, '');
    // cycle 2 round 2: the same for the keytop gloss block in agFold (AG_FOLD_KEY, no nested #if)
    if (!/#define AG_FOLD_KEY/.test(src)) src = src.replace(/#ifdef AG_FOLD_KEY[\s\S]*?#endif/g, '');
    const errs = [];
    const count = (re) => (src.match(re) || []).length;
    if (count(/\{/g) - count(/\}/g) !== base[stage][0]) errs.push(`brace imbalance ${count(/\{/g) - count(/\}/g)} (three: ${base[stage][0]})`);
    if (count(/\(/g) - count(/\)/g) !== base[stage][1]) errs.push(`paren imbalance ${count(/\(/g) - count(/\)/g)} (three: ${base[stage][1]})`);
    for (const bad of ['${', '{opts.', 'undefined', 'NaN', '[object']) if (src.includes(bad)) errs.push(`contains "${bad}"`);
    // ag* identifiers: used vs declared
    const used = new Set(src.match(/\bag[A-Z]\w*/g) || []);
    const declared = new Set();
    for (const m of src.matchAll(/\b(?:uniform|varying|attribute|in|out)\s+[\w]+\s+([^;]+);/g)) for (const v of m[1].split(',')) { const id = v.trim().split(/[\s\[]/)[0]; if (id) declared.add(id); }
    for (const m of src.matchAll(/\b(?:float|vec[234]|ivec[234]|mat[34]|int|uint|bool|PhysicalMaterial|IncidentLight)\s+(ag\w+)/g)) declared.add(m[1]);
    for (const m of src.matchAll(/\b(?:float|vec[234]|int|uint|bool)\s+\w+\s*=[^;]*?,\s*(ag\w+)/g)) declared.add(m[1]);
    for (const m of src.matchAll(/,\s*(ag\w+)\s*(?:=|;|,)/g)) declared.add(m[1]);
    const missing = [...used].filter((u) => !declared.has(u) && !/^ag[A-Z]\w*$/.test('') );
    const undef = missing.filter((u) => !new RegExp(`\\b${u}\\s*\\(`).test(src) || !new RegExp(`\\b\\w+\\s+${u}\\s*\\(`).test(src));
    const reallyUndef = undef.filter((u) => !declared.has(u));
    if (reallyUndef.length) errs.push('ag* used but not declared: ' + reallyUndef.slice(0, 8).join(', '));
    if (errs.length) { bad++; console.log(`${name} [${stage}]: ${errs.join('; ')}`); }
    if (dumpName === name && stage === 'frag') console.log(src);
  }
}
console.log(`check_glsl: ${n} patched materials, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
