// (copied from sandbox/piano_critic, critic round 1; kept here as a regression check for the piano module)
// Critic: where does each hammer actually meet its string at the API's strike angle?
// For every note: transform all hammer-felt vertices at hammerStrikeAngles, take the highest vertex (the contact point),
// and compare it with the layout strike point, the string path (x at that z, y bottom), the front termination
// (agraffe / capo) and the plate front-panel back edge. Also tests felt vertices against the pinblock / plate / capo
// boxes by raycast parity.   node tools/piano/check_strike.mjs
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', placeInRig: false, bench: false } } });
const L = P.layout; const A = P.parts.action; const SS = P.strings;
P.group.updateMatrixWorld(true);
const felt = P.group.getObjectByName('hammerFelt');
const pos = felt.geometry.attributes.position;
const m = new THREE.Matrix4(), v = new THREE.Vector3();
const fbe = L.plate.frontBackEdge; // (x, z) polyline: back edge of the plate front panel
const interp = (pl, x) => { for (let i = 0; i < pl.length - 1; i++) { const a = pl[i], b = pl[i + 1]; if (x >= a[0] && x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return x < pl[0][0] ? pl[0][1] : pl[pl.length - 1][1]; };
function contact(angles, label) {
  A.setHammerAngles(angles);
  felt.updateMatrixWorld(true);
  const rows = [];
  for (let i = 0; i < 88; i++) {
    felt.getMatrixAt(i, m); m.premultiply(felt.matrixWorld);
    let top = null;
    for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(m); if (!top || v.y > top.y) top = v.clone(); }
    const q = L.notes[i]; const s = SS.strings.find((t) => t.n === q.n);
    // string path through strike_xz with dir_xz
    const dz = top.z - q.strike_xz[1];
    const sx = q.strike_xz[0] + q.dir_xz[0] / q.dir_xz[1] * dz;
    const along = dz / q.dir_xz[1];  // distance along the string from the strike point (- = toward the front)
    const frac = (q.strike_from_front + along) / q.speaking_length;
    const yStr = s.yFront + (s.yBridge - s.yFront) * frac;
    const rStr = q.wire_d_mm / 2000;
    rows.push({ n: q.n, name: q.note, topZ: top.z, dzStrike: dz, dxString: top.x - sx, pen: top.y - (yStr - rStr), alongFromFront: q.strike_from_front + along, frontZ: q.front_xz[1], plateBackZ: interp(fbe, top.x), term: q.front_termination, nStr: q.strings, wound: q.wound });
  }
  return rows;
}
const strike = contact(P.hammerStrikeAngles, 'strike');
const f = (x, d = 1) => (x * 1000).toFixed(d).padStart(7);
console.log(' n  note  contact-dz(mm vs layout strike)  dx to string path(mm)  penetration(mm)  contact dist from front termination(mm)  plate-panel back edge - contact z (mm)');
for (const r of strike) if ([1, 8, 9, 20, 21, 30, 40, 41, 42, 52, 53, 60, 67, 70, 76, 77, 80, 84, 85, 86, 87, 88].includes(r.n))
  console.log(String(r.n).padStart(2), r.name.padEnd(4), f(r.dzStrike), '   ', f(r.dxString), '   ', f(r.pen, 2), '   ', f(r.alongFromFront), '   ', f(r.plateBackZ - r.topZ), r.term);
const behindFront = strike.filter((r) => r.alongFromFront < 0);
console.log('notes whose hammer contact lies IN FRONT of the agraffe/capo (outside the speaking length):', behindFront.map((r) => r.n).join(','));
const underPlate = strike.filter((r) => r.plateBackZ - r.topZ > 0);
console.log('notes whose hammer contact lies under the plate front panel (z < panel back edge):', underPlate.map((r) => r.n).join(','));
const off = strike.filter((r) => Math.abs(r.dxString) > 3.5e-3);
console.log('notes whose contact is > 3.5 mm sideways off the string path:', off.map((r) => `${r.n}:${(r.dxString * 1000).toFixed(1)}`).join(' '));
console.log('mean contact dz (mm):', f(strike.reduce((a, r) => a + r.dzStrike, 0) / 88), ' max penetration (mm):', f(Math.max(...strike.map((r) => r.pen)), 2));
// parity test: felt vertices inside pinblock / plateWeb / capoBar / pressureBar / struts / agraffeLedge / bellyRail at strike, check and rest
const targets = ['pinblock', 'plateWeb', 'capoBar', 'pressureBar', 'struts', 'agraffeLedge', 'bellyRail', 'damperGuideRail', 'pinblockFront'].map((nm) => P.group.getObjectByName(nm)).filter(Boolean);
for (const t of targets) { t.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); }
const rc = new THREE.Raycaster(); rc.firstHitOnly = false;
const dirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.3, 0.9, 0.2).normalize()];
function insideCount(o, p) {
  // odd crossings along two directions = inside (robust-ish for closed meshes)
  let ins = 0;
  for (const d of dirs) { rc.set(p, d); const h = rc.intersectObject(o, false); if (h.length % 2 === 1) ins++; }
  return ins === 2;
}
for (const [label, angs] of [['rest', new Float32Array(88)], ['check', P.hammerCheckAngles], ['strike', P.hammerStrikeAngles]]) {
  A.setHammerAngles(angs);
  const hits = {};
  for (const mesh of ['hammerFelt', 'hammerMolding', 'hammerShank']) {
    const im = P.group.getObjectByName(mesh); const pp = im.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pp.count / 120));
    for (let i = 0; i < 88; i++) {
      im.getMatrixAt(i, m); m.premultiply(im.matrixWorld);
      for (let k = 0; k < pp.count; k += step) {
        v.fromBufferAttribute(pp, k).applyMatrix4(m);
        for (const t of targets) {
          t.geometry.computeBoundingBox(); const bb = t.geometry.boundingBox.clone().applyMatrix4(t.matrixWorld);
          if (!bb.containsPoint(v)) continue;
          if (insideCount(t, v.clone())) { const key = `${mesh}->${t.name}`; (hits[key] ||= new Set()).add(i + 1); }
        }
      }
    }
  }
  console.log(`[${label}] intersections (sampled vertices inside):`, Object.entries(hits).map(([k, s]) => `${k}: notes ${[...s].join(',')}`).join(' | ') || 'none');
}
