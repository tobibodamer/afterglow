// Accumulation-buffer renderer (Haeberli & Akeley 1990), research/rendering.md sections 2 and 4.
//
// One output frame = N sub-frames. Each sub-frame has its own
//   (a) sub-pixel projection jitter  -> anti-aliasing (box or Gaussian pixel filter)
//   (b) shutter time                 -> true motion blur (the caller poses the scene at that time)
//   (c) thin-lens aperture sample    -> physical depth of field: the eye moves on a 9-blade aperture and the
//                                       frustum is sheared so the focal plane stays fixed
// The scene is drawn into an RGBA16F target (+ depth texture) and added, weighted 1/N, into an RGBA32F target.
//
// DOF gap-fill pre-blur (shots with preblur > 0): N aperture samples on a disk of diameter CoC lie about
// 0.886 * CoC / sqrt(N) apart, so a defocused point / thin highlight shows N discrete copies. Each sub-frame is blurred
// by a Gaussian of sigma = 0.5 * preblur * CoC / sqrt(N) (preblur 1 -> 0.56 of the sample spacing) of its own depth
// before it is accumulated, which fuses the copies. Kernels (preblurKernel):
//   'layered' (fix round 4; dense, near-field aware):
//      prep     : per pixel colour + signed sigma (+ in front of the focus plane, - behind)       -> csRT
//      base     : every pixel behind focus and the near pixels with sigma < 2 px, separable normalised
//                 scatter-as-gather with each tap's OWN sigma (normalised 1-D Gaussians, every pixel a tap: no
//                 lattice), farther taps cannot bleed over a sharper pixel                        -> baseRT
//      levels k : near-field pixels (in front of focus) are split over sigma levels 2^k px (k = 1..5, tent weights
//                 in log2 sigma), each level premultiplied (colour * w, w) at 1/2^(k-1) resolution, blurred by a
//                 plain separable Gaussian of 2 texels (= 2^k px). A near highlight that spills over far, sharp
//                 background pixels is thus blurred by ITS sigma wherever it lands (the round-3 gather used each
//                 pixel's own CoC there and left the S24 near-lens edge as discrete lines).
//      composite: near = sum of the levels (normalised where they overlap), out = near + (1 - coverage) * base,
//                 added into the accumulation. Cost: ~7 full-res passes of <= 11 taps, levels >= 2 at reduced size.
//   'disk' / 'gauss' (legacy, A/B only): one 48-tap Vogel gather sized to the shot-global reach. Undersampled for
//      thin highlights (lattice / dash texture, MODULE_ISSUES round 4, docs/INTEGRATION.md section 8).
//
// Trap: renderer.autoClear MUST be false while the additive quad draws; otherwise it clears its own target and the
// result is silently the last sample / N. renderSub() switches it off around the quad only (and restores it), so the
// rest of the scene code sees three's default autoClear = true. All clears of the accumulation are explicit.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT } from './glsl.js';
import { apertureRadius, cocInfPx } from './lens.js';

const ADD_BLEND = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation,
  depthTest: false, depthWrite: false,
};
const NO_BLEND = { blending: THREE.NoBlending, depthTest: false, depthWrite: false };
const MAX_LEVELS = 5;          // near-field sigma levels 2, 4, 8, 16, 32 px
const BASE_SIGMA_MAX = 8;      // base layer: largest own sigma (behind focus) it blurs with, px

const rtOpts = (filter) => ({ type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, samples: 0,
  minFilter: filter, magFilter: filter, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });

// near-field level weights (shared by extract): fraction of a FRONT pixel of blur s that goes to level k (sigma 2^k)
const GLSL_LEVELS = /* glsl */`
uniform float uKTop;
float levelW(float s, float k) {
  float x = log2(max(s, 1e-3));
  if (k >= uKTop && x >= k) return 1.0;          // the top level takes everything blurrier
  return max(0.0, 1.0 - abs(x - k));
}
// base-layer share of a pixel with signed sigma ss: everything behind focus; in front: 1 at s <= 1 px, 0 at s >= 2 px
float baseW(float ss) { if (ss <= 0.0 || uKTop < 0.5) return 1.0; return clamp(1.0 - log2(max(ss, 1e-3)), 0.0, 1.0); }
`;

export class AccumRenderer {
  constructor(renderer, width, height) {
    this.renderer = renderer; this.width = width; this.height = height;
    this.sceneRT = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, samples: 0,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.sceneRT.texture.name = 'AG.sceneRT';
    this.sceneRT.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    this.accumRT = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.accumRT.texture.name = 'AG.accumRT';

    this.addQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      name: 'AG.accumAdd',
      uniforms: { tSrc: { value: this.sceneRT.texture }, uWeight: { value: 1 } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform float uWeight; varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uWeight, uWeight); }`,
      ...ADD_BLEND,
    }));

    // legacy gather (preblurKernel 'disk' | 'gauss'), kept for A/B checks
    this.blurAddQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      name: 'AG.accumPreblur',
      defines: { NT: 48 },
      uniforms: {
        tSrc: { value: this.sceneRT.texture }, tDepth: { value: this.sceneRT.depthTexture }, uWeight: { value: 1 },
        uNear: { value: 0.1 }, uFar: { value: 1000 }, uK: { value: 0 }, uFocus: { value: 1 }, uScale: { value: 0 },
        uMaxR: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / width, 1 / height) }, uRot: { value: 0 }, uKernel: { value: 1 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tSrc; uniform sampler2D tDepth;
        uniform float uWeight, uNear, uFar, uK, uFocus, uScale, uMaxR, uRot, uKernel; uniform vec2 uTexel;
        varying vec2 vUv;
        float distAt(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
        float sigmaAt(float d) { return 0.5 * uK * abs(d - uFocus) / d * uScale; }
        float reachOf(float s) { return min(uKernel > 0.5 ? 2.5 * s : s, uMaxR); }
        void main() {
          float d0 = distAt(vUv); float r0 = reachOf(sigmaAt(d0));
          vec3 sum = texture2D(tSrc, vUv).rgb; float wsum = 1.0;
          if (uMaxR > 0.5) {
            for (int i = 0; i < NT; i++) {
              float fi = float(i) + 0.5;
              float rr = sqrt(fi / float(NT)) * uMaxR;
              float th = fi * 2.39996323 + uRot;
              vec2 uv = vUv + vec2(cos(th), sin(th)) * rr * uTexel;
              float dt = distAt(uv); float st = sigmaAt(dt); float rt = reachOf(st);
              float w = clamp(rt - rr + 1.0, 0.0, 1.0);
              if (uKernel > 0.5) w *= exp(-0.5 * rr * rr / max(st * st, 1e-6));
              if (dt > d0 * 1.02) w *= clamp(r0 - rr + 1.0, 0.0, 1.0);
              sum += texture2D(tSrc, uv).rgb * w; wsum += w;
            }
          }
          gl_FragColor = vec4(sum / wsum * uWeight, uWeight);
        }`,
      ...ADD_BLEND,
    }));
    this._right = new THREE.Vector3(); this._up = new THREE.Vector3();
    this.stats = {};
    this._lay = null;     // layered gap-fill resources, created on first use
  }

  clear() {
    const r = this.renderer;
    r.setRenderTarget(this.accumRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
  }

  /**
   * pre-blur parameters for the frame (lens at the frame centre); returns null when off.
   * preblurKernel 'layered' (default since fix round 4) | 'disk' | 'gauss' (legacy). maxPreblurPx caps the largest
   * gap-fill reach (2.5 sigma): 96 px by default, i.e. the near levels go up to sigma 32 px.
   */
  setupPreblur(camera, lens, N, { preblur = 0, nearestDist = null, maxPreblurPx = 96, preblurKernel = 'layered' } = {}) {
    if (!(preblur > 0) || !(lens?.fStop > 0)) { this._pre = null; return null; }
    const K = cocInfPx(lens, this.width);   // CoC diameter at infinity, px
    const sf = lens.focusDist;
    const scale = preblur / Math.sqrt(N);
    const dn = nearestDist ?? sf * 0.6;      // nearest visible depth in the shot
    const sigmaNear = 0.5 * K * scale * Math.max(0, (sf - dn) / dn);
    const sigmaInf = 0.5 * K * scale;
    if (preblurKernel === 'layered') {
      // near levels needed: content up to 1.5x blurrier than the shot's declared nearest depth; capped by maxPreblurPx
      const sMax = Math.min(sigmaNear * 1.5, maxPreblurPx / 2.5);
      const kTop = sMax < 1 ? 0 : Math.min(MAX_LEVELS, Math.max(1, Math.ceil(Math.log2(sMax))));
      const sBase = Math.min(BASE_SIGMA_MAX, Math.max(kTop > 0 ? 2 : sigmaNear, sigmaInf));
      const RB = Math.max(1, Math.min(20, Math.ceil(2.5 * sBase)));
      this._ensureLayered();
      const L = this._lay;
      for (const m of [L.prep.material, ...L.mats]) {
        const u = m.uniforms;
        if (u.uK) { u.uK.value = K; u.uFocus.value = sf; u.uScale.value = scale; u.uNear.value = camera.near; u.uFar.value = camera.far; }
        if (u.uKTop) u.uKTop.value = kTop;
        if (u.uSBMax) u.uSBMax.value = BASE_SIGMA_MAX;
      }
      L.baseH.material.uniforms.uR.value = RB; L.baseV.material.uniforms.uR.value = RB;
      this._pre = { K, kernel: 'layered', sigmaInf, sigmaNear, nearestDist: dn, kTop, baseR: RB, maxR: Math.min(maxPreblurPx, 2.5 * Math.pow(2, kTop)) };
      return this._pre;
    }
    const u = this.blurAddQuad.material.uniforms;
    u.uNear.value = camera.near; u.uFar.value = camera.far; u.uK.value = K; u.uFocus.value = sf;
    u.uScale.value = scale;
    const sigmaMax = Math.max(sigmaInf, sigmaNear);
    const gauss = preblurKernel !== 'disk';
    u.uKernel.value = gauss ? 1 : 0;
    u.uMaxR.value = Math.min(maxPreblurPx, gauss ? 2.5 * sigmaMax : sigmaMax);
    this._pre = { K, maxR: u.uMaxR.value, sigmaMax, nearestDist: dn, kernel: gauss ? 'gauss2.5' : 'disk' };
    return this._pre;
  }

  _ensureLayered() {
    if (this._lay) return;
    const W = this.width, H = this.height;
    const mk = (name, w, h, filter = THREE.NearestFilter) => { const t = new THREE.WebGLRenderTarget(w, h, rtOpts(filter)); t.texture.name = name; return t; };
    const csRT = mk('AG.dof.cs', W, H), baseA = mk('AG.dof.baseH', W, H), baseB = mk('AG.dof.base', W, H);
    const levels = [];
    for (let k = 1; k <= MAX_LEVELS; k++) {
      const r = 2 ** (k - 1), w = Math.ceil(W / r), h = Math.ceil(H / r);
      // a = extract + V output (sampled bilinearly by the composite), b = H output
      levels.push({ k, r, w, h, a: mk(`AG.dof.L${k}`, w, h, THREE.LinearFilter), b: mk(`AG.dof.L${k}h`, w, h), uvScale: new THREE.Vector2(W / (r * w), H / (r * h)) });
    }
    const common = { uK: { value: 0 }, uFocus: { value: 1 }, uScale: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 1000 } };
    const quad = (name, uniforms, frag, blend = NO_BLEND) => new FullScreenQuad(new THREE.ShaderMaterial({ name, uniforms, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, ...blend }));

    const prep = quad('AG.dofPrep', { tSrc: { value: this.sceneRT.texture }, tDepth: { value: this.sceneRT.depthTexture }, ...THREE.UniformsUtils.clone(common) }, /* glsl */`
      #include <packing>
      uniform sampler2D tSrc; uniform sampler2D tDepth; uniform float uK, uFocus, uScale, uNear, uFar;
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        vec3 c = texelFetch(tSrc, p, 0).rgb;
        float d = -perspectiveDepthToViewZ(texelFetch(tDepth, p, 0).x, uNear, uFar);
        float s = 0.5 * uK * abs(d - uFocus) / max(d, 1e-4) * uScale;
        gl_FragColor = vec4(c, d < uFocus ? s : -s);     // signed: + in front of the focus plane (near field)
      }`);

    // base layer, separable normalised scatter-as-gather (each tap scatters with its own normalised 1-D Gaussian).
    // H reads csRT and writes (colour, certainty = base share of the support in [0,1]); V reads that + csRT (sigma).
    // A near-field tap (base share 0) keeps the colour H filled in from its base neighbours, spread with sigma 1.
    const baseFrag = (vertical) => /* glsl */`
      uniform sampler2D tCS; uniform sampler2D tIn; uniform int uR; uniform float uSBMax;
      ${GLSL_LEVELS}
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy); ivec2 sz = textureSize(tCS, 0) - 1;
        float sp = texelFetch(tCS, p, 0).a;
        float rp = 2.5 * clamp(abs(sp), 0.3, uSBMax);
        vec3 acc = vec3(0.0); float wacc = 0.0, gacc = 0.0;
        for (int i = -uR; i <= uR; i++) {          // uR <= 20 (setupPreblur); GLSL ES 3.00 allows the uniform bound
          ivec2 q = clamp(p + ${vertical ? 'ivec2(0, i)' : 'ivec2(i, 0)'}, ivec2(0), sz);
          vec4 cs = texelFetch(tCS, q, 0);
          float m = baseW(cs.a);
          float st = m > 0.0 ? clamp(abs(cs.a), 0.3, uSBMax) : 1.0;
          float x = float(i);
          float g = exp(-0.5 * x * x / (st * st)) / st;
          if (cs.a < sp - 0.05) g *= clamp(rp - abs(x) + 0.5, 0.0, 1.0);   // a farther (blurrier) tap behind a sharper pixel
          ${vertical
    ? 'vec4 hv = texelFetch(tIn, q, 0); float w = g * hv.a; acc += hv.rgb * w;'
    : 'float w = g * m; acc += cs.rgb * w; gacc += g;'}
          wacc += w;
        }
        vec3 own = ${vertical ? 'texelFetch(tIn, p, 0).rgb' : 'texelFetch(tCS, p, 0).rgb'};
        gl_FragColor = wacc > 1e-5 ? vec4(acc / wacc, ${vertical ? '1.0' : 'wacc / max(gacc, 1e-5)'}) : vec4(own, 0.0);
      }`;
    const baseH = quad('AG.dofBaseH', { tCS: { value: csRT.texture }, tIn: { value: csRT.texture }, uR: { value: 3 }, uSBMax: { value: BASE_SIGMA_MAX }, uKTop: { value: 0 } }, baseFrag(false));
    const baseV = quad('AG.dofBaseV', { tCS: { value: csRT.texture }, tIn: { value: baseA.texture }, uR: { value: 3 }, uSBMax: { value: BASE_SIGMA_MAX }, uKTop: { value: 0 } }, baseFrag(true));

    // near level k: extract (r x r box of premultiplied colour * w_k and w_k) at 1/r resolution
    const extract = quad('AG.dofExtract', { tCS: { value: csRT.texture }, uRr: { value: 1 }, uLevel: { value: 1 }, uKTop: { value: 0 } }, /* glsl */`
      uniform sampler2D tCS; uniform int uRr; uniform float uLevel;
      ${GLSL_LEVELS}
      void main() {
        ivec2 o = ivec2(gl_FragCoord.xy) * uRr; ivec2 sz = textureSize(tCS, 0) - 1;
        vec4 acc = vec4(0.0);
        for (int y = 0; y < 16; y++) {
          if (y >= uRr) break;
          for (int x = 0; x < 16; x++) {
            if (x >= uRr) break;
            vec4 cs = texelFetch(tCS, min(o + ivec2(x, y), sz), 0);
            float w = cs.a > 0.0 ? levelW(cs.a, uLevel) : 0.0;
            acc += vec4(cs.rgb * w, w);
          }
        }
        gl_FragColor = acc / float(uRr * uRr);
      }`);
    // plain separable Gaussian, sigma 2 texels (radius 5), premultiplied RGBA
    const gaussFrag = (vertical) => /* glsl */`
      uniform sampler2D tIn;
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy); ivec2 sz = textureSize(tIn, 0) - 1;
        const float G0 = 0.200565, G1 = 0.176998, G2 = 0.121649, G3 = 0.065114, G4 = 0.027143, G5 = 0.008812;
        float g[6] = float[6](G0, G1, G2, G3, G4, G5);
        vec4 acc = texelFetch(tIn, p, 0) * g[0];
        for (int i = 1; i <= 5; i++) {
          ivec2 d = ${vertical ? 'ivec2(0, i)' : 'ivec2(i, 0)'};
          acc += (texelFetch(tIn, clamp(p + d, ivec2(0), sz), 0) + texelFetch(tIn, clamp(p - d, ivec2(0), sz), 0)) * g[i];
        }
        gl_FragColor = acc;
      }`;
    const gH = quad('AG.dofLevelH', { tIn: { value: null } }, gaussFrag(false));
    const gV = quad('AG.dofLevelV', { tIn: { value: null } }, gaussFrag(true));

    // composite: near levels over the base, added into the accumulation with weight 1/N
    const compU = { tBase: { value: baseB.texture }, uWeight: { value: 1 }, uKTop: { value: 0 } };
    levels.forEach((L, i) => { compU[`tL${i + 1}`] = { value: L.a.texture }; compU[`uS${i + 1}`] = { value: L.uvScale }; });
    const composite = quad('AG.dofComposite', compU, /* glsl */`
      uniform sampler2D tBase, tL1, tL2, tL3, tL4, tL5; uniform vec2 uS1, uS2, uS3, uS4, uS5; uniform float uWeight, uKTop;
      varying vec2 vUv;
      void main() {
        vec3 base = texelFetch(tBase, ivec2(gl_FragCoord.xy), 0).rgb;
        vec4 n = vec4(0.0);
        if (uKTop > 0.5) n += texture2D(tL1, vUv * uS1);
        if (uKTop > 1.5) n += texture2D(tL2, vUv * uS2);
        if (uKTop > 2.5) n += texture2D(tL3, vUv * uS3);
        if (uKTop > 3.5) n += texture2D(tL4, vUv * uS4);
        if (uKTop > 4.5) n += texture2D(tL5, vUv * uS5);
        float A = n.a;
        vec3 c = n.rgb / max(A, 1.0) + (1.0 - min(A, 1.0)) * base;
        gl_FragColor = vec4(c * uWeight, uWeight);
      }`, ADD_BLEND);
    this._lay = { csRT, baseA, baseB, levels, prep, baseH, baseV, extract, gH, gV, composite,
      mats: [baseH.material, baseV.material, extract.material, composite.material] };
  }

  _renderLayered(r, N) {
    const L = this._lay, kTop = this._pre.kTop;
    r.setRenderTarget(L.csRT); L.prep.render(r);
    r.setRenderTarget(L.baseA); L.baseH.render(r);
    r.setRenderTarget(L.baseB); L.baseV.render(r);
    for (let k = 1; k <= kTop; k++) {
      const lv = L.levels[k - 1];
      const eu = L.extract.material.uniforms; eu.uRr.value = lv.r; eu.uLevel.value = k;
      r.setRenderTarget(lv.a); L.extract.render(r);
      L.gH.material.uniforms.tIn.value = lv.a.texture; r.setRenderTarget(lv.b); L.gH.render(r);
      L.gV.material.uniforms.tIn.value = lv.b.texture; r.setRenderTarget(lv.a); L.gV.render(r);
    }
    L.composite.material.uniforms.uWeight.value = 1 / N;
    r.setRenderTarget(this.accumRT);
    L.composite.render(r);
  }

  /**
   * Apply the aperture sample and pixel jitter to a camera that the caller has already posed for this sub-frame
   * (position/orientation/fov at the sub-frame time). Modifies camera.position and the projection matrix.
   * Returns the eye offset in metres along camera right/up.
   */
  applyLensAndJitter(camera, sample, lens) {
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const P = camera.projectionMatrix.elements;
    let dx = 0, dy = 0;
    if (lens && lens.fStop > 0) {
      const R = apertureRadius(lens.focalMm, lens.fStop);
      dx = sample.lx * R; dy = sample.ly * R;
      this._right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      this._up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      camera.position.addScaledVector(this._right, dx).addScaledVector(this._up, dy);
      camera.updateMatrixWorld(true);
      // shear so that points at view depth focusDist project to the same pixel for every aperture sample
      P[8] -= P[0] * dx / lens.focusDist;
      P[9] -= P[5] * dy / lens.focusDist;
    }
    P[8] += (2 * sample.jx) / this.width;
    P[9] += (2 * sample.jy) / this.height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    return { dx, dy };
  }

  /** draw the scene into sceneRT and add it (optionally pre-blurred) into accumRT with weight 1/N */
  renderSub(scene, camera, k, N) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(scene, camera);
    // The additive quad must not clear its target (with autoClear on, render() would wipe the accumulation and the
    // result would silently be the last sub-frame / N). autoClear is switched off only here, so modules keep
    // three's default behaviour (CubeCamera, their own render targets).
    const ac = r.autoClear;
    r.autoClear = false;
    if (this._pre && this._pre.kernel === 'layered') {
      this._renderLayered(r, N);
    } else if (this._pre) {
      r.setRenderTarget(this.accumRT);
      const u = this.blurAddQuad.material.uniforms;
      u.uWeight.value = 1 / N;
      u.uRot.value = (k * 2.39996323) % 6.2831853;
      this.blurAddQuad.render(r);
    } else {
      r.setRenderTarget(this.accumRT);
      this.addQuad.material.uniforms.uWeight.value = 1 / N;
      this.addQuad.render(r);
    }
    r.autoClear = ac;
  }

  dispose() {
    this.sceneRT.depthTexture?.dispose(); this.sceneRT.dispose(); this.accumRT.dispose();
    this.addQuad.material.dispose(); this.addQuad.dispose(); this.blurAddQuad.material.dispose(); this.blurAddQuad.dispose();
    if (this._lay) {
      const L = this._lay;
      for (const t of [L.csRT, L.baseA, L.baseB, ...L.levels.flatMap((l) => [l.a, l.b])]) t.dispose();
      for (const q of [L.prep, L.baseH, L.baseV, L.extract, L.gH, L.gV, L.composite]) { q.material.dispose(); q.dispose(); }
      this._lay = null;
    }
  }
}
