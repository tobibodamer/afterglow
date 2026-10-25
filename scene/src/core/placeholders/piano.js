// PLACEHOLDER piano module: a black glossy box where the D-class concert grand will stand, in the rig frame
// (DESIGN.md section 2: rig origin = keyboard centre at the key-front plane on the water surface; the pianist sits at
// negative rig z facing +z; the case extends toward +z). Lacquer-like clearcoat material so env reflections,
// planar water reflections and DOF all have a glossy black subject to test against.
export async function create(ctx) {
  const { THREE } = ctx;
  const group = new THREE.Group(); group.name = 'placeholder.piano';
  const lacquer = new THREE.MeshPhysicalMaterial({ name: 'placeholder.lacquer', color: 0x030303, roughness: 0.28, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.5, envMapIntensity: 1 });
  const W = 1.56, L = 2.74, RIM_BOTTOM = 0.712, RIM_TOP = 1.0, FLOOR = -0.04; // D-class numbers from research/piano.md
  const caseBox = new THREE.Mesh(new THREE.BoxGeometry(W, RIM_TOP - RIM_BOTTOM, L - 0.12, 8, 4, 16), lacquer);
  caseBox.position.set(0, (RIM_TOP + RIM_BOTTOM) / 2, 0.12 + (L - 0.12) / 2); caseBox.castShadow = caseBox.receiveShadow = true;
  group.add(caseBox);
  // keyboard strip (white keys) at the key-front plane, so orientation is readable in tests
  const keys = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.022, 0.15), new THREE.MeshPhysicalMaterial({ color: 0xf0ece2, roughness: 0.25, clearcoat: 0.5 }));
  keys.position.set(0, 0.715 - 0.011, 0.075); keys.castShadow = keys.receiveShadow = true; group.add(keys);
  const keybed = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.16), lacquer);
  keybed.position.set(0, 0.655, 0.08); keybed.castShadow = true; group.add(keybed);
  // three legs to the lake bed
  const legG = new THREE.CylinderGeometry(0.05, 0.035, RIM_BOTTOM - FLOOR, 32);
  for (const [x, z] of [[-0.62, 0.35], [0.62, 0.35], [0.0, 2.45]]) {
    const leg = new THREE.Mesh(legG, lacquer); leg.position.set(x, (RIM_BOTTOM + FLOOR) / 2, z); leg.castShadow = true; group.add(leg);
  }
  // open lid at full stick (~35 deg), hinged on the straight (bass) side. The pianist faces +z, so his left is rig +x
  // (three.js is right-handed: facing +z with y up, right = -x).
  const lid = new THREE.Mesh(new THREE.BoxGeometry(W, 0.024, L - 0.4), lacquer);
  const hinge = new THREE.Group(); hinge.position.set(W / 2, RIM_TOP, 0.4 + (L - 0.4) / 2);
  lid.position.set(-W / 2, 0.012, 0); hinge.add(lid); hinge.rotation.z = THREE.MathUtils.degToRad(-35);
  lid.castShadow = true; group.add(hinge);
  return { group, update() {} };
}
