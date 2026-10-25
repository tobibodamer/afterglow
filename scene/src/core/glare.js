// Veiling glare: an energy-conserving lens point-spread function applied to the whole HDR image once per output frame.
// No threshold, no "bloom": every pixel scatters the same small fraction of its energy into a wide, heavy-tailed lobe,
// so only the brightest values (sun glow, the brightest horizon, specular glints) visibly glow (research/rendering.md
// section 6, "No cheap bloom").
//
//   out = (1 - amount) * hdr + amount * G,     G = PSF_lobe * hdr,   integral(PSF_lobe) = 1
//
// The lobe is the 2-D kernel  k(r) ~ (1 + (r/r0)^2)^-1.5  (a common camera veiling-glare shape) whose encircled
// energy is  E(R) = 1 - 1/sqrt(1 + (R/r0)^2).  It is built from a mip pyramid (CoD AW style, Jimenez 2014):
// level i blurs over ~2^i pixels; level i gets the kernel energy of the annulus [2^(i-1/2), 2^(i+1/2)] px and the
// last level also takes the whole tail. Each pyramid filter is normalised, and the up-chain is a convex
// combination  acc_i = c_i * down_i + (1 - c_i) * up(acc_{i+1}),  so the pyramid image G integrates to exactly 1.
// The kernel energy inside the first level, E(sqrt 2 px), is narrower than a pixel at this resolution, so it stays in
// the image itself instead of being spread over the wider levels:
//   out = (1 - a') * hdr + a' * G,   a' = amount * lobeFraction,   lobeFraction = 1 - E(sqrt 2 px)
// r0 and every annulus are in units of the image height, so the energy the glare puts beyond a given fraction of the
// image height is the same at every output size (the pyramid always runs down to ~2 px, about the full image height).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT } from './glsl.js';

const RT_OPTS = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };

const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uSrcTexel; varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uSrcTexel).rgb; }
void main() {
  // 13-tap, normalised (weights sum to 1), linear: no Karis average, which would not conserve energy
  vec3 a = s(vec2(-2., 2.)), b = s(vec2(0., 2.)), c = s(vec2(2., 2.));
  vec3 d = s(vec2(-2., 0.)), e = s(vec2(0., 0.)), f = s(vec2(2., 0.));
  vec3 g = s(vec2(-2., -2.)), h = s(vec2(0., -2.)), i = s(vec2(2., -2.));
  vec3 j = s(vec2(-1., 1.)), k = s(vec2(1., 1.)), l = s(vec2(-1., -1.)), m = s(vec2(1., -1.));
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(o, 1.0);
}`;

const UP_FRAG = /* glsl */`
uniform sampler2D tCur; uniform sampler2D tLow; uniform vec2 uLowTexel; uniform float uC; varying vec2 vUv;
vec3 t(vec2 o) { return texture2D(tLow, vUv + o * uLowTexel).rgb; }
void main() {
  // 3x3 tent upsample of the coarser accumulated level (weights 1 2 1 / 2 4 2 / 1 2 1, sum 16)
  vec3 up = (t(vec2(-1., -1.)) + t(vec2(1., -1.)) + t(vec2(-1., 1.)) + t(vec2(1., 1.))
          + 2.0 * (t(vec2(0., -1.)) + t(vec2(-1., 0.)) + t(vec2(1., 0.)) + t(vec2(0., 1.)))
          + 4.0 * t(vec2(0., 0.))) * (1.0 / 16.0);
  gl_FragColor = vec4(mix(up, texture2D(tCur, vUv).rgb, uC), 1.0);
}`;

export class VeilingGlare {
  constructor(renderer, width, height, { maxLevels = 16 } = {}) {
    this.renderer = renderer; this.width = width; this.height = height;
    this.down = []; this.acc = [];
    let w = width, h = height;
    for (let i = 1; i <= maxLevels; i++) {
      w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2));
      if (Math.min(w, h) < 2) break;
      this.down.push(new THREE.WebGLRenderTarget(w, h, RT_OPTS));
      this.acc.push(new THREE.WebGLRenderTarget(w, h, RT_OPTS));
    }
    this.levels = this.down.length;
    this.downQuad = new FullScreenQuad(new THREE.ShaderMaterial({ name: 'AG.glareDown', vertexShader: FULLSCREEN_VERT, fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uSrcTexel: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false }));
    this.upQuad = new FullScreenQuad(new THREE.ShaderMaterial({ name: 'AG.glareUp', vertexShader: FULLSCREEN_VERT, fragmentShader: UP_FRAG,
      uniforms: { tCur: { value: null }, tLow: { value: null }, uLowTexel: { value: new THREE.Vector2() }, uC: { value: 1 } }, depthTest: false, depthWrite: false }));
    this.setShape(0.002);
  }

  /** r0: kernel core radius as a fraction of the image height */
  setShape(r0) {
    if (r0 === this.r0) return;
    this.r0 = r0;
    const H = this.height, L = this.levels;
    const E = (Rpx) => 1 - 1 / Math.sqrt(1 + (Rpx / H / r0) ** 2);
    const w = [];
    for (let i = 1; i <= L; i++) w.push(E(2 ** (i + 0.5)) - E(2 ** (i - 0.5)));
    w[L - 1] += 1 - E(2 ** (L + 0.5));
    // the core (r < sqrt 2 px) stays in the identity term: the caller scales `amount` by lobeFraction (= sum of w)
    this.coreEnergy = E(Math.SQRT2);
    this.lobeFraction = w.reduce((a, b) => a + b, 0);
    this.weights = w.map((x) => x / this.lobeFraction);
    // convex-combination coefficients for the up-chain
    this.c = this.weights.map((wi, i) => wi / this.weights.slice(i).reduce((a, b) => a + b, 0));
  }

  /** the weight of the pyramid image in the final mix for a glare `amount` (the core stays in the image) */
  mixWeight(amount) { return amount * this.lobeFraction; }

  /** builds the lobe image from an HDR texture; returns the half-resolution lobe texture (integral 1) */
  render(src) {
    const r = this.renderer, du = this.downQuad.material.uniforms, uu = this.upQuad.material.uniforms;
    let tex = src, tw = this.width, th = this.height;
    for (let i = 0; i < this.levels; i++) {
      du.tSrc.value = tex; du.uSrcTexel.value.set(1 / tw, 1 / th);
      r.setRenderTarget(this.down[i]); this.downQuad.render(r);
      tex = this.down[i].texture; tw = this.down[i].width; th = this.down[i].height;
    }
    let low = this.down[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      uu.tCur.value = this.down[i].texture; uu.tLow.value = low.texture; uu.uLowTexel.value.set(1 / low.width, 1 / low.height);
      uu.uC.value = this.c[i];
      r.setRenderTarget(this.acc[i]); this.upQuad.render(r);
      low = this.acc[i];
    }
    return (this.levels > 1 ? this.acc[0] : this.down[0]).texture;
  }

  dispose() {
    for (const t of [...this.down, ...this.acc]) t.dispose();
    this.downQuad.material.dispose(); this.downQuad.dispose(); this.upQuad.material.dispose(); this.upQuad.dispose();
  }
}
