// Perf QC page: the pianist GLB posed by perf tracks (or explicit poses) over an accurate keyboard from layout.js
// (or the real piano module), rendered from requested cameras. Driven by perf/qc/render_qc.mjs (headless Chrome).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as L from '/scene/src/piano/layout.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24222a);
const cam = new THREE.PerspectiveCamera(30, 1, 0.005, 50);
scene.add(new THREE.HemisphereLight(0xc8c4d8, 0x2a2420, 1.1));
const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(0.6, 2.4, -1.6); key.castShadow = true;
key.shadow.mapSize.set(4096, 4096); Object.assign(key.shadow.camera, { left: -0.9, right: 0.9, top: 0.9, bottom: -0.9, near: 0.5, far: 6 }); key.shadow.bias = -0.0002; key.shadow.normalBias = 0.002;
scene.add(key); scene.add(key.target);
const rim = new THREE.DirectionalLight(0xffc9a0, 1.2); rim.position.set(-1.8, 1.2, 2.2); scene.add(rim);
const fill = new THREE.DirectionalLight(0xb0c0ff, 0.5); fill.position.set(2.0, 0.9, 0.5); scene.add(fill);

const rig = new THREE.Group(); rig.name = 'rig'; scene.add(rig);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x15141a, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.04; floor.receiveShadow = true; rig.add(floor);

// ------------------------------------------------------------------ simple accurate keyboard (piano frame, mirrored)
const pianoG = new THREE.Group(); pianoG.position.set(L.KB_CENTER_X, -0.04, 0); pianoG.scale.set(-1, 1, 1); rig.add(pianoG);
const K = L.LAYOUT.keyboard;
const matW = new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.35 });
const matB = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.3 });
const matCase = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.25, metalness: 0.0 });
const keyPivots = []; const keyMats = [];
function box(x0, x1, y0, y1, z0, z1, mat) { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m; }
function buildSimpleKeyboard() {
  const py = L.BALANCE_AXIS.y, pz = L.BALANCE_AXIS.z;
  for (const k of L.KEYS) {
    const piv = new THREE.Group(); piv.position.set(0, py, pz); pianoG.add(piv);
    const inner = new THREE.Group(); inner.position.set(0, -py, -pz); piv.add(inner);
    const mat = (k.black ? matB : matW).clone(); keyMats.push(mat);
    if (k.black) {
      const b = k.blackBox; const xs = b.xz.map((p) => p[0]), zs = b.xz.map((p) => p[1]);
      inner.add(box(Math.min(...xs), Math.max(...xs), b.yMin - 0.006, b.yMax, Math.min(...zs), Math.max(...zs), mat));
    } else {
      const h = k.head, t = k.tail;
      inner.add(box(h[0][0], h[1][0], k.topY - 0.0235, k.topY, h[0][1], h[2][1], mat));
      inner.add(box(t[0][0], t[1][0], k.topY - 0.0235, k.topY, t[0][1], t[2][1] + 0.12, mat));
    }
    keyPivots.push(piv);
  }
  // key slip, cheek blocks, fallboard (open), keybed
  const kb = L.LAYOUT.keyboard;
  pianoG.add(box(kb.keySlip.x[0], kb.keySlip.x[1], kb.keySlip.y[0], kb.keySlip.y[1], kb.keySlip.z[0], kb.keySlip.z[1], matCase));
  pianoG.add(box(kb.cheekBlocks.leftX[0], kb.cheekBlocks.leftX[1], 0.66, kb.cheekBlocks.topY, 0, 0.30, matCase));
  pianoG.add(box(kb.cheekBlocks.rightX[0], kb.cheekBlocks.rightX[1], 0.66, kb.cheekBlocks.topY, 0, 0.30, matCase));
  const fb = kb.fallboardOpen; fallboardMesh = box(fb.x[0], fb.x[1], fb.y[0], fb.y[1], fb.faceZ, fb.backZ, matCase); pianoG.add(fallboardMesh);
  pianoG.add(box(0.03, 1.53, 0.60, 0.665, -0.005, 0.40, matCase));
  // pedals (lyre) as small slabs on pivots
  for (const p of L.PEDALS) {
    const piv = new THREE.Group(); piv.position.set(p.x, p.pivot[1], p.pivot[2]); pianoG.add(piv);
    const inner = new THREE.Group(); inner.position.set(-p.x, -p.pivot[1], -p.pivot[2]); piv.add(inner);
    inner.add(box(p.x - 0.02, p.x + 0.02, p.treadY - 0.012, p.treadY, p.tip[2], p.pivot[2], new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 0.8, roughness: 0.3 })));
    pedalPivots.push(piv);
  }
}
const pedalPivots = [];
let realPiano = null;
let fallboardMesh = null;

// ------------------------------------------------------------------ pianist
const pianist = new THREE.Group(); pianist.name = 'pianist'; pianist.position.set(0, -0.04, L.KEY_FRONT_Z); rig.add(pianist);
let bones = new Map(); let rootBone = null; let bindQ = new Map(); let bindRootPos = null;
const markers = new THREE.Group(); pianist.add(markers);
let tracks = null; const tmpObj = {}; const tmpRoot = [0, 0, 0]; const tmpKeys = new Float32Array(88); const tmpPed = [0, 0, 0];

window.QC = {
  async init({ glb, piano = 'simple' }) {
    if (piano === 'real') {
      try { const mod = await import('/scene/src/piano/index.js'); realPiano = await mod.create({ options: { piano: { envProbe: false } } }); rig.add(realPiano.group); rig.remove(pianoG); realPiano.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }
      catch (e) { console.log('real piano failed: ' + e.message); realPiano = null; buildSimpleKeyboard(); }
    } else buildSimpleKeyboard();
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(glb);
    pianist.add(gltf.scene);
    gltf.scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = !/hair|beard|scalp|eyebrow|eyelash/i.test(o.name); o.receiveShadow = true; o.frustumCulled = false; }
      if (o.isBone) { bones.set(o.name, o); bindQ.set(o.name, o.quaternion.clone()); if (o.name === 'root') { rootBone = o; bindRootPos = o.position.clone(); } }
    });
    return { bones: bones.size, piano: realPiano ? 'real' : 'simple' };
  },
  async loadTracks(jsonUrl, binUrl) { const m = await import('/scene/src/perf/tracks.js'); tracks = await m.loadPerf(jsonUrl, binUrl); return { duration: tracks.duration, bones: tracks.bones.length }; },
  resetPose() { for (const [n, b] of bones) b.quaternion.copy(bindQ.get(n)); if (rootBone) rootBone.position.copy(bindRootPos); for (const p of keyPivots) p.rotation.x = 0; },
  setPose({ bones: bq = {}, root = null, keys = null, pedals = null }) {
    for (const [n, q] of Object.entries(bq)) { const b = bones.get(n); if (b) b.quaternion.set(q[0], q[1], q[2], q[3]); }
    if (root && rootBone) rootBone.position.set(root[0], root[1], root[2]);
    if (keys) this.setKeys(keys);
    if (pedals) this.setPedals(pedals);
  },
  setKeys(a) { if (realPiano) { realPiano.setKeyAngles(a); realPiano.update(0, {}); } else for (let i = 0; i < 88; i++) { keyPivots[i].rotation.x = -a[i]; keyMats[i].emissive.setHex(a[i] > 0.002 ? (L.KEYS[i].black ? 0x302010 : 0x2a1a08) : 0x000000); } },
  setPedals(p) { if (realPiano) { realPiano.setPedals(p); realPiano.update(0, {}); } else for (let i = 0; i < 3; i++) if (pedalPivots[i]) pedalPivots[i].rotation.x = -p[i]; },
  poseAt(t) {
    if (!tracks) return false;
    tracks.sampleBones(t, tmpObj); for (const [n, q] of Object.entries(tmpObj)) { const b = bones.get(n); if (b) b.quaternion.set(q[0], q[1], q[2], q[3]); }
    tracks.sampleRoot(t, tmpRoot); if (rootBone) rootBone.position.set(tmpRoot[0], tmpRoot[1], tmpRoot[2]);
    tracks.sampleKeys(t, tmpKeys); this.setKeys(tmpKeys);
    tracks.samplePedals(t, tmpPed); this.setPedals(tmpPed);
    return true;
  },
  /** debug cutaway: hide the fallboard (front views of the fingers) and optionally one hand's arm meshes */
  setCutaway(on) { if (fallboardMesh) fallboardMesh.visible = !on; },
  /** debug: collapse one arm (upper arm bone scaled to ~0) so a camera can sit where it would be */
  hideArm(side, on = true) { const b = bones.get('upperarm01_' + side); if (b) b.scale.setScalar(on ? 0.001 : 1); },
  setMarkers(list) { // [{p:[x,y,z] pianist frame, r, color}]
    markers.clear(); for (const m of list || []) { const s = new THREE.Mesh(new THREE.SphereGeometry(m.r || 0.002, 12, 8), new THREE.MeshBasicMaterial({ color: m.color || 0xff2020, depthTest: m.depthTest ?? true })); s.position.set(...m.p); markers.add(s); }
  },
  /** world position of a bone (pianist frame) */
  bonePos(name) { scene.updateMatrixWorld(true); const v = new THREE.Vector3(); bones.get(name).getWorldPosition(v); pianist.worldToLocal(v); return v.toArray(); },
  render({ pos, target, fov = 30, w = 640, h = 480 }) {
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.fov = fov; cam.updateProjectionMatrix();
    // camera given in the pianist frame
    const P = new THREE.Vector3(...pos); pianist.localToWorld(P); const T = new THREE.Vector3(...target); pianist.localToWorld(T);
    cam.position.copy(P); cam.lookAt(T);
    key.target.position.copy(T); key.position.copy(T).add(new THREE.Vector3(0.5, 2.0, -1.4));
    scene.updateMatrixWorld(true);
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL('image/png');
  },
  // contact sheet composition in a 2-D canvas
  sheetBegin(cols, rows, tw, th, title) { const c = document.createElement('canvas'); c.width = cols * tw; c.height = rows * th + 28; this._sheet = { c, g: c.getContext('2d'), cols, tw, th }; const g = this._sheet.g; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#ddd'; g.font = '16px monospace'; g.fillText(title || '', 8, 20); },
  sheetTile(i, label, view) {
    const s = this._sheet; this.render({ ...view, w: s.tw, h: s.th });
    const x = (i % s.cols) * s.tw, y = 28 + Math.floor(i / s.cols) * s.th;
    s.g.drawImage(renderer.domElement, x, y, s.tw, s.th);
    s.g.fillStyle = 'rgba(0,0,0,0.55)'; s.g.fillRect(x, y, s.tw, 18); s.g.fillStyle = '#fff'; s.g.font = '12px monospace'; s.g.fillText(label, x + 4, y + 13);
    s.g.strokeStyle = '#444'; s.g.strokeRect(x + 0.5, y + 0.5, s.tw - 1, s.th - 1);
  },
  sheetData() { return this._sheet.c.toDataURL('image/png'); },
};
window.ready = true;
