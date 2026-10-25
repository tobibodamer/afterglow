// PLACEHOLDER pianist module: a dark capsule silhouette on a bench at negative rig z, facing +z, with two "hands"
// that move fast over the keyboard as a pure function of t. Its only jobs: give the silhouette shots a figure and give
// motion blur (shutter sampling) something fast to smear.
export async function create(ctx) {
  const { THREE } = ctx;
  const group = new THREE.Group(); group.name = 'placeholder.pianist';
  const suit = new THREE.MeshStandardMaterial({ color: 0x07070a, roughness: 0.85 });
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x9a6a55, roughness: 0.55, sheen: 0.3, sheenRoughness: 0.6 });
  const hairM = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.6 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; group.add(m); return m; };
  add(new THREE.BoxGeometry(0.62, 0.07, 0.34), new THREE.MeshPhysicalMaterial({ color: 0x030303, roughness: 0.35, clearcoat: 1 }), 0, 0.50, -0.68);
  add(new THREE.CapsuleGeometry(0.19, 0.42, 12, 32), suit, 0, 0.98, -0.62, 0.18);
  const head = add(new THREE.SphereGeometry(0.095, 48, 32), skin, 0, 1.47, -0.52);
  add(new THREE.SphereGeometry(0.103, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.62), hairM, 0, 1.475, -0.535);
  const armG = new THREE.CapsuleGeometry(0.045, 0.36, 8, 16);
  const hands = [-1, 1].map((s) => add(new THREE.SphereGeometry(0.042, 32, 16), skin, s * 0.18, 0.76, 0.06));
  const arms = [-1, 1].map((s) => add(armG, suit, s * 0.2, 0.92, -0.25, 1.2));
  return {
    group,
    update(t) {
      // left hand slow, right hand fast (~1.4 m/s peak): motion-blur stress
      hands[0].position.x = 0.20 + 0.10 * Math.sin(t * 2.1);
      hands[0].position.y = 0.745 + 0.012 * Math.max(0, Math.sin(t * 9.0));
      hands[1].position.x = -0.22 + 0.14 * Math.sin(t * 10.0 + 1.0);
      hands[1].position.y = 0.745 + 0.012 * Math.max(0, Math.sin(t * 23.0));
      arms.forEach((a, i) => { a.position.x = (hands[i].position.x + Math.sign(hands[i].position.x) * 0.22) / 2; });
      head.rotation.z = 0.05 * Math.sin(t * 0.7);
    },
  };
}
