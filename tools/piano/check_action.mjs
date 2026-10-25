// Geometry checks of the action in Node: hammer crown vs string at the strike angle and at check, damper felt vs
// string at rest / lifted, key dips. Prints worst cases.   node tools/piano/check_action.mjs
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
import { KEYS, KEY_DIP_RAD, keyPoint, HAMMERS, hammerCrown } from '../../scene/src/piano/layout.js';
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', placeInRig: false } } });
const A = P.parts.action; const L = P.layout;
const res = [];
// round 2 (critic r2: h.yStr no longer exists -> NaN): crown = layout.js hammerCrown (the analytic crown the action
// meshes and the perf solver share), string underside = HAMMERS[i].strikePoint[1]. tools/piano/check_strike.mjs tests
// the meshes (felt vs every unison wire); tools/piano/check_hammer_sweep.mjs the swing against resting neighbours.
for (const [label, angs] of [['strike', P.hammerStrikeAngles], ['check', P.hammerCheckAngles], ['rest', new Float32Array(88)]]) {
  let worst = { d: -1e9 }, best = { d: 1e9 }, sum = 0;
  for (let i = 0; i < 88; i++) {
    const c = { y: hammerCrown(i + 1, angs[i])[1] };
    const strBottom = HAMMERS[i].strikePoint[1];
    const gap = strBottom - c.y;   // >0: crown below the string bottom
    sum += gap;
    if (gap > worst.d) worst = { d: gap, n: i + 1 };
    if (gap < best.d) best = { d: gap, n: i + 1 };
  }
  res.push(`${label.padEnd(6)} crown-to-string gap mm: mean ${(sum / 88 * 1000).toFixed(2)}  max ${(worst.d * 1000).toFixed(2)} (n${worst.n})  min ${(best.d * 1000).toFixed(2)} (n${best.n})`);
}
console.log(res.join('\n'));
// dampers: the real felt-vs-string test is tools/piano/check_strut_damper.mjs (the old block here was a no-op)
const d0 = A.dampers;
console.log('dampers', d0.length, 'notes', d0[0].n, '..', d0[d0.length - 1].n, '- felt vs string: node tools/piano/check_strut_damper.mjs');
// key dip at the front edge
const w = KEYS[39], b = KEYS[40];
for (const k of [w, b]) {
  const front = k.black ? [k.xCenter, k.topY, k.frontZ] : [k.xCenter, k.topY, 0.022];
  const p = keyPoint(k.n, k.dipRad, front);
  console.log(`key ${k.name} (${k.color}) dip at front ${((k.topY - p[1]) * 1000).toFixed(2)} mm, angle ${(k.dipRad * 180 / Math.PI).toFixed(2)} deg`);
}
console.log('hammer strike angle range deg', (Math.min(...P.hammerStrikeAngles) * 57.3).toFixed(1), '..', (Math.max(...P.hammerStrikeAngles) * 57.3).toFixed(1));
