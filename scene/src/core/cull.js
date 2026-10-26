// Conservative bounds for meshes that move on the GPU, so three's frustum culling can skip them in the passes that
// cannot see them (main view, lake reflection, planar mirrors, cube faces). A bound only ever contains the real
// geometry, so culling never changes a pixel.
import * as THREE from 'three';

/**
 * Skinned meshes (linear blend skinning with rigid bones): a vertex weighted to bone b stays within r_b of that bone's
 * origin, r_b = its largest bind-pose distance from it, so the skinned mesh lies inside the union of the balls
 * (bone origin, r_b x bone scale). update() fits a sphere around those balls (+ margin for shader offsets: hair lag,
 * fuzz shells, hand-hair offsets) and stores it as mesh.boundingSphere, which three's culling uses for skinned meshes.
 */
export class SkinnedBounds {
  constructor(meshes, { margin = 0.1 } = {}) {
    this.margin = margin;
    this.items = [];
    const v = new THREE.Vector3(), u = new THREE.Vector3();
    for (const mesh of meshes) {
      const g = mesh.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
      if (!P || !SI || !SW || !mesh.skeleton) continue;
      const inv = mesh.skeleton.boneInverses, r = new Float32Array(inv.length).fill(-1);
      const ix = g.index ? g.index.array : null, n = ix ? ix.length : P.count;
      for (let j = 0; j < n; j++) {
        const i = ix ? ix[j] : j;
        v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix);
        for (let k = 0; k < 4; k++) {
          if (!(SW.getComponent(i, k) > 0)) continue;
          const b = SI.getComponent(i, k);
          r[b] = Math.max(r[b], u.copy(v).applyMatrix4(inv[b]).length());
        }
      }
      const used = []; r.forEach((x, b) => { if (x >= 0) used.push(b); });
      if (!used.length) continue;
      mesh.boundingSphere = new THREE.Sphere();
      mesh.frustumCulled = true;
      this.items.push({ mesh, used, r });
    }
    this._A = new THREE.Matrix4(); this._M = new THREE.Matrix4(); this._inv = new THREE.Matrix4();
    this._box = new THREE.Box3(); this._c = new THREE.Vector3(); this._e = new THREE.Vector3();
  }

  /** call after the bones' world matrices are current (scene.onBeforeRender) */
  update() {
    const { _A: A, _M: M, _inv: inv, _box: box, _c: c, _e: e } = this;
    for (const { mesh, used, r } of this.items) {
      const bones = mesh.skeleton.bones;
      A.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
      box.makeEmpty();
      for (const b of used) {
        M.multiplyMatrices(A, bones[b].matrixWorld);
        c.setFromMatrixPosition(M);
        const rad = r[b] * M.getMaxScaleOnAxis();
        box.expandByPoint(e.copy(c).addScalar(rad)); box.expandByPoint(e.copy(c).subScalar(rad));
      }
      const s = mesh.boundingSphere;
      box.getCenter(s.center); s.radius = box.getSize(e).length() / 2 + this.margin;
      // world -> mesh space (three applies matrixWorld back, radius x its largest scale)
      s.center.applyMatrix4(inv.copy(mesh.matrixWorld).invert());
      s.radius /= mesh.matrixWorld.getMaxScaleOnAxis();
    }
  }
}

/**
 * Instanced meshes whose instances move a little around their build pose (keys, hammers, dampers): the bound of the
 * build-pose instances grown by `margin` (m), fixed; culling is switched on.
 */
export function boundInstanced(mesh, margin) {
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += margin;
  mesh.frustumCulled = true;
}

/**
 * Split a skinned mesh into parts by body region (regionOf(boneIndex) -> key, applied to each triangle's most weighted
 * bone), so a close-up or a mirror pass culls the regions it cannot see. The parts are children of the mesh with the
 * identity transform, sharing its vertex buffers, skeleton, bind matrix and layers; their material follows the mesh's
 * (look-dev swaps keep working). The mesh itself keeps its geometry for every other use but draws nothing.
 * All parts are opaque here, so the changed draw order between them cannot change a pixel. Returns the parts ([] when
 * the mesh lies in one region).
 */
export function splitSkinned(mesh, regionOf) {
  const g = mesh.geometry, idx = g.index?.array, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  if (!idx || !SI || !SW) return [];
  const lists = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    let best = -1, bw = -1;
    for (let c = 0; c < 3; c++) for (let k = 0; k < 4; k++) { const w = SW.getComponent(idx[t + c], k); if (w > bw) { bw = w; best = SI.getComponent(idx[t + c], k); } }
    const key = regionOf(best);
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(t);
  }
  if (lists.size < 2) return [];
  const parts = [];
  for (const [key, l] of lists) {
    const ix = new (idx.constructor)(l.length * 3);
    l.forEach((t, i) => { ix[3 * i] = idx[t]; ix[3 * i + 1] = idx[t + 1]; ix[3 * i + 2] = idx[t + 2]; });
    const pg = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) pg.setAttribute(k, a);
    for (const [k, a] of Object.entries(g.morphAttributes)) pg.morphAttributes[k] = a;
    pg.setIndex(new THREE.BufferAttribute(ix, 1));
    const part = new THREE.SkinnedMesh(pg);
    Object.defineProperty(part, 'material', { get: () => mesh.material, set: () => {} });
    part.name = `${mesh.name}.${key}`;
    part.bindMode = mesh.bindMode;
    part.bind(mesh.skeleton, mesh.bindMatrix);
    part.layers = mesh.layers;
    part.castShadow = mesh.castShadow; part.receiveShadow = mesh.receiveShadow; part.renderOrder = mesh.renderOrder;
    part.customDepthMaterial = mesh.customDepthMaterial; part.customDistanceMaterial = mesh.customDistanceMaterial;
    mesh.add(part);
    parts.push(part);
  }
  g.setDrawRange(0, 0);
  mesh.frustumCulled = false;
  return parts;
}
