// Which piano mesh does a camera ray hit first? (Node, piano frame, no renderer)
//   node tools/piano/raycast.mjs '{"posRig":[x,y,z],"targetRig":[x,y,z],"mm":50,"hide":["name",...],"pose":{...},"grid":[7,5],"aspect":1.7778}'
// Prints a grid of first-hit mesh names (+ hit point in the piano frame) over the image.
import * as THREE from 'three';
import { create } from '../../scene/src/piano/index.js';

import fs from 'node:fs';
const arg = process.argv[2];
const a = JSON.parse(fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg);   // inline JSON or a .json file
const P = await create({ options: { piano: { envProbe: false, deskMirror: 'off', lidMirror: 'off', placeInRig: false, bench: true } } });
if (a.pose) P.setPose(a.pose);
P.update(0, null);
const hide = new Set(a.hide || []);
const targets = [];
P.group.updateMatrixWorld(true);
P.group.traverse((o) => { if (o.isMesh && !hide.has(o.name)) targets.push(o); });
const toP = (r) => new THREE.Vector3(0.78 - r[0], r[1] + 0.04, r[2]);
const pos = toP(a.posRig), tgt = toP(a.targetRig);
const aspect = a.aspect || 16 / 9, mm = a.mm || 50;
const vfov = 2 * Math.atan(12 / mm);
const cam = new THREE.PerspectiveCamera((vfov * 180) / Math.PI, aspect, 0.001, 50);
cam.position.copy(pos); cam.lookAt(tgt);
// the piano frame is left-handed: mirror the camera's image x so "left" matches the rig render
cam.updateMatrixWorld(true);
const rc = new THREE.Raycaster();
const [gx, gy] = a.grid || [7, 5];
for (let j = 0; j < gy; j++) {
  const row = [];
  for (let i = 0; i < gx; i++) {
    const ndc = new THREE.Vector2(-(-1 + (2 * (i + 0.5)) / gx), 1 - (2 * (j + 0.5)) / gy);
    rc.setFromCamera(ndc, cam);
    const h = rc.intersectObjects(targets, false)[0];
    row.push(h ? `${h.object.name}@${h.point.toArray().map((v) => v.toFixed(3)).join(',')}` : '-');
  }
  console.log(row.join(' | '));
}
