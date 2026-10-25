// Cube captures for sky bakes and environment probes.
//
// Trap (three r186): CubeCamera.update() only clears when renderer.autoClear is true (or with a reversed depth
// buffer); with autoClear off a plain CubeCamera keeps the previous capture's depth and colour and the second capture
// is garbage. The film keeps autoClear on outside the accumulation quad, and everything here forces it on anyway.
import * as THREE from 'three';

export function withAutoClear(renderer, fn) {
  const ac = renderer.autoClear, rt = renderer.getRenderTarget();
  renderer.autoClear = true;
  try { return fn(); } finally { renderer.autoClear = ac; renderer.setRenderTarget(rt); }
}

/**
 * A cube render target + camera that can be re-captured every frame, plus an optional PMREM for PBR lighting.
 *   const probe = new CubeProbe(renderer, { size: 512, position, near, far, pmrem: true });
 *   probe.capture(scene, { hide: [pianoGroup] });   // -> probe.texture (cube), probe.envMap (PMREM, if enabled)
 */
export class CubeProbe {
  constructor(renderer, { size = 512, type = THREE.HalfFloatType, position = null, near = 0.05, far = 60000, pmrem = false, layers = null } = {}) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rt.texture.name = 'AG.cubeProbe';
    this.camera = new THREE.CubeCamera(near, far, this.rt);
    if (position) this.camera.position.copy(position);
    if (layers) this.camera.children.forEach((c) => { c.layers.mask = layers.mask; });
    this.pmrem = pmrem ? new THREE.PMREMGenerator(renderer) : null;
    this.pmremRT = null;
  }
  get texture() { return this.rt.texture; }
  get envMap() { return this.pmremRT?.texture || null; }

  capture(scene, { hide = [], position = null } = {}) {
    if (position) this.camera.position.copy(position);
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    this.camera.updateMatrixWorld(true);
    withAutoClear(this.renderer, () => this.camera.update(this.renderer, scene));
    hide.forEach((o, i) => { o.visible = vis[i]; });
    if (this.pmrem) this.pmremRT = this.pmrem.fromCubemap(this.rt.texture, this.pmremRT);
    return this.rt.texture;
  }

  dispose() { this.rt.dispose(); this.pmremRT?.dispose(); this.pmrem?.dispose(); }
}
