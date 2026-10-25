// Session 11: Node check of the lacquer look plumbing. Creates the piano, runs update() with a camera at several
// distances in the default 'auto' mode and prints the resulting shared lacquer uniforms, so a preset key that the
// auto blend drops (wide-only keys, colour arrays) shows up as a wrong value.   node tools/piano/check_look.mjs
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', placeInRig: false, bench: false } } });
P.group.updateMatrixWorld(true);
const U = P.materials.shared.lacquer;
const W = P.lacquerLooks.wide, C = P.lacquerLooks.close;
const f = (v) => (v && v.toArray ? v.toArray().map((x) => +x.toFixed(3)).join(',') : (+v).toFixed(3));
let bad = 0;
for (const d of [1.5, 4.0, 12.0]) {
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 500);
  cam.position.set(0.8, 1.4, -d); cam.lookAt(0.8, 0.9, 1.0); cam.updateMatrixWorld(true);
  P.update(0, { camera: cam, time: 0 });
  console.log(`cam ${d} m: f0 ${f(U.agCoatF0.value)} envG ${f(U.agEnvG.value)} tint ${f(U.agEnvTint.value)} card ${f(U.agCard.value)} card2 ${f(U.agCard2.value)} card3 ${f(U.agCard3.value)} sky ${f(U.agCardSky.value)} kickEdge ${f(U.agKickEdge.value)}`);
  if (d >= 6) {
    const want = { f0: U.agCoatF0.value, tint0: U.agEnvTint.value.x, spine: U.agCard3.value.z, skyR: U.agCardSky.value.x, skyG: U.agCardSky.value.y };
    const exp = { f0: W.f0, tint0: (W.envTint || [1])[0], spine: W.cardSpine ?? 1, skyR: (W.cardSkyCol || [0.62])[0], skyG: (W.cardSkyCol || [0, 0.5])[1] };
    for (const k of Object.keys(exp)) if (Math.abs(want[k] - exp[k]) > 1e-4) { console.log(`  MISMATCH ${k}: got ${want[k]} want ${exp[k]}`); bad++; }
  }
  // the piano centre is ~2.7 m from the 1.5 m camera: blend t ~ 0.01, hence the tolerance
  if (d <= 2.5 && Math.abs(U.agKickEdge.value.z - (C.kickFlat ?? 1)) > 0.05) { console.log('  MISMATCH close kickFlat'); bad++; }
}
console.log(bad ? `check_look: ${bad} mismatch(es)` : 'check_look: ok (auto blend carries every wide / close key)');
