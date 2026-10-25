// Minimal example module (docs/RENDERING.md section 3). Try it:
//   node render/still.mjs --placeholders --modules '{"default":"placeholder","extra":["./core/examples/example-module.js"]}' --frames 0 --out build/stills/example
export async function create(ctx) {
  const { THREE } = ctx;
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.3, clearcoat: 1 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 64, 32), mat);
  ball.castShadow = true;
  const group = new THREE.Group(); group.name = 'example'; group.add(ball);
  const light = new THREE.PointLight(0xffc090, 0.6, 6, 2); group.add(light);
  let bakeRuns = 0;

  // per sub-frame, after the camera is posed: jitter the light across a 10 cm disk (soft shadows / highlights)
  ctx.registerPreSubframe((sub) => {
    const r = 0.05 * Math.sqrt(sub.dim(0)), a = 2 * Math.PI * sub.dim(1);
    light.position.set(0.9 + r * Math.cos(a), 1.6, 1.4 + r * Math.sin(a));
  });

  return {
    group, parent: 'rig',                                        // rig frame (yaw applied)
    beforeFrame(frame, t, info) { /* per output frame state; info.shotChanged etc. */ },
    update(t) { ball.position.set(0.9, 1.25 + 0.05 * Math.sin(2 * Math.PI * 0.5 * t), 1.2); },   // pure function of t
    bakes: [{ name: 'once', when: 'init', run: () => { bakeRuns++; } }],
    get bakeRuns() { return bakeRuns; },
    dispose() { ball.geometry.dispose(); mat.dispose(); },
  };
}
