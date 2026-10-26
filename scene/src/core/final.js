// Final pass, once per output frame: HDR accumulation -> 8-bit display frame (rows flipped top-down for readPixels).
//
//   hdr (scene-linear, RGBA32F accumulation)
//     -> exposure (linear multiplier)
//     -> veiling glare: (1 - a') * hdr + a' * PSF_lobe(hdr), a' = amount * (1 - PSF core energy)  (glare.js)
//     -> Khronos PBR Neutral tone map                                          -> display-linear [0,1]
//     -> saturation (Rec.709 luma preserving, display-linear)
//     -> sRGB OETF                                                             -> display-encoded
//     -> lift / gamma / gain on the encoded signal:  c = (c*gain + lift*(1-c))^(1/gamma)
//     -> 3-D LUT (identity by default; .cube or Float32 table; encoded -> encoded), mixed by lutMix
//     -> optional luminance grain: 3x3 binomial-filtered white noise (~1.5-2 px), seeded by (pixel, frame),
//        amplitude in 8-bit code values, weighted to the midtones
//     -> TPDF dither, +-1 LSB of the output quantiser, seeded by (pixel, frame)
//     -> RGBA8
// Every random number is an integer hash of the pixel and the frame index: bit-identical in every session.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FULLSCREEN_VERT, GLSL_PCG, GLSL_PBR_NEUTRAL, GLSL_SRGB } from './glsl.js';
import { VeilingGlare } from './glare.js';
import { identityTable, lutTexture } from './lut.js';

export const DEBUG_VIEWS = { none: 0, hdr: 1, glare: 2, depth: 3, coc: 4, alpha: 5, nolut: 6 };

export const DEFAULT_GRADE = Object.freeze({
  exposure: 1.0,            // linear multiplier on the HDR image (use exposureEV for stops; both multiply)
  exposureEV: 0.0,
  saturation: 1.0,
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
  lut: null,                // null = identity / the session LUT (AG.setLUT); a URL selects a cached LUT
  lutMix: 1.0,
  glare: { amount: 0.015, r0: 0.002 },  // fraction of energy in the wide lobe; lobe core radius / image height
  grain: 0.0,               // std of the grain in 8-bit code values at mid grey (2-3 is "subtle"); 0 = off
  dither: 1.0,              // TPDF dither on (1) / off (0)
});

const FRAG = /* glsl */`
precision highp float;
precision highp int;
${GLSL_PCG}
${GLSL_PBR_NEUTRAL}
${GLSL_SRGB}
uniform sampler2D tAccum; uniform sampler2D tGlare; uniform sampler2D tDepth;
uniform highp sampler3D tLUT;
uniform vec2 uSize; uniform float uExposure; uniform float uGlare;
uniform float uSat; uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain;
uniform float uLutMix; uniform float uLutSize; uniform vec3 uLutMin; uniform vec3 uLutMax;
uniform float uGrain; uniform float uDither; uniform float uQuantize; uniform uint uFrame;
uniform int uDebug; uniform float uNear; uniform float uFar; uniform float uK; uniform float uFocus;
varying vec2 vUv;

float viewDist(ivec2 p) {
  float z = texelFetch(tDepth, p, 0).x;
  return (uNear * uFar) / ((uFar - uNear) * z - uFar) * -1.0; // perspectiveDepthToViewZ, negated
}
vec3 applyLut(vec3 c) {
  vec3 u = clamp((c - uLutMin) / (uLutMax - uLutMin), 0.0, 1.0);
  vec3 coord = u * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
  return texture(tLUT, coord).rgb;
}
// unit-variance, spatially filtered (binomial 3x3) white noise: ~1.5-2 px grain
float grainNoise(ivec2 p, uint seed) {
  float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
    s += w * (hash1(uvec2(p + ivec2(i, j) + 4096), seed) - 0.5);
  }
  return s * (1.0 / sqrt(3.0)); // var = sum(w^2)/12 = 36/12 = 3
}
void main() {
  ivec2 op = ivec2(gl_FragCoord.xy);
  ivec2 sp = ivec2(op.x, int(uSize.y) - 1 - op.y);           // flip: buffer row 0 = image top
  vec2 suv = (vec2(sp) + 0.5) / uSize;
  vec4 acc = texelFetch(tAccum, sp, 0);
  vec3 hdr = acc.rgb;
  vec3 c;
  if (uDebug == 3 || uDebug == 4) {
    float d = viewDist(sp);
    if (uDebug == 3) c = vec3(clamp(log2(d / uNear) / log2(uFar / uNear), 0.0, 1.0));
    else { float coc = uK * abs(d - uFocus) / d; c = vec3(clamp(coc / 32.0, 0.0, 1.0), clamp(coc / 4.0, 0.0, 1.0) * 0.5, d < uFocus ? 0.6 : 0.0); }
    gl_FragColor = vec4(c, 1.0); return;
  }
  if (uDebug == 5) { float a = acc.a; gl_FragColor = vec4(abs(a - 1.0) < 1e-3 ? vec3(1.0) : vec3(1.0, 0.0, a), 1.0); return; }
  if (uDebug == 2) hdr = texture2D(tGlare, suv).rgb * 10.0;
  else if (uDebug != 1 && uGlare > 0.0) hdr = mix(hdr, texture2D(tGlare, suv).rgb, uGlare);
  hdr *= uExposure;
  if (uDebug == 1) c = clamp(hdr, 0.0, 1.0);
  else c = pbrNeutral(max(hdr, 0.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSat), 0.0);
  c = srgbOETF(clamp(c, 0.0, 1.0));
  c = pow(max(c * uGain + uLift * (1.0 - c), 0.0), 1.0 / uGamma);
  if (uLutMix > 0.0 && uDebug != 6) c = mix(c, applyLut(c), uLutMix);
  if (uGrain > 0.0) {
    float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float mid = clamp(4.0 * y * (1.0 - y), 0.0, 1.0);
    c += uGrain / 255.0 * mid * grainNoise(sp, uFrame * 0x9E3779B1u + 0x51EDu);
  }
  if (uDither > 0.0) {
    vec3 r1 = hash3(uvec2(sp), uFrame * 2u + 0x2545F491u), r2 = hash3(uvec2(sp) + uvec2(7919u, 104729u), uFrame * 2u + 0x68E31DA4u);
    c += uDither * ((r1 - 0.5) + (r2 - 0.5)) / uQuantize; // triangular PDF in [-1, 1] LSB
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const PRESENT_FRAG = /* glsl */`
uniform sampler2D tOut; varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tOut, vec2(vUv.x, 1.0 - vUv.y)).rgb, 1.0); }`;

export class FinalPass {
  constructor(renderer, width, height) {
    this.renderer = renderer; this.width = width; this.height = height;
    this.outRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });   // linear for SMAA's blend
    this.outRT.texture.name = 'AG.outRT';
    this.glare = new VeilingGlare(renderer, width, height);
    this.identityLut = lutTexture(identityTable(33));
    this.sessionLut = this.identityLut;
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      name: 'AG.final', vertexShader: FULLSCREEN_VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tAccum: { value: null }, tGlare: { value: null }, tDepth: { value: null }, tLUT: { value: this.identityLut },
        uSize: { value: new THREE.Vector2(width, height) }, uExposure: { value: 1 }, uGlare: { value: 0 },
        uSat: { value: 1 }, uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
        uLutMix: { value: 0 }, uLutSize: { value: 33 }, uLutMin: { value: new THREE.Vector3(0, 0, 0) }, uLutMax: { value: new THREE.Vector3(1, 1, 1) },
        uGrain: { value: 0 }, uDither: { value: 1 }, uQuantize: { value: 255 }, uFrame: { value: 0 },
        uDebug: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uK: { value: 0 }, uFocus: { value: 1 },
      },
    }));
    this.presentQuad = new FullScreenQuad(new THREE.ShaderMaterial({ name: 'AG.present', vertexShader: FULLSCREEN_VERT, fragmentShader: PRESENT_FRAG,
      uniforms: { tOut: { value: this.outRT.texture } }, depthTest: false, depthWrite: false }));
    this.stats = {};
  }

  /**
   * grade: merged grade settings (DEFAULT_GRADE shape). lutTex: THREE.Data3DTexture or null (session LUT).
   * depth: { texture, near, far, K, focus } of the last sub-frame for the depth/coc debug views.
   */
  render({ accumTexture, frame, grade, lutTex = null, debugView = 'none', depth = null }) {
    const r = this.renderer, u = this.quad.material.uniforms, g = grade;
    const dbg = DEBUG_VIEWS[debugView] ?? 0;
    const glareAmt = g.glare?.amount ?? 0;
    let glareTex = null;
    if ((glareAmt > 0 && dbg !== 1) || dbg === 2) {
      this.glare.setShape(g.glare?.r0 ?? 0.002);
      glareTex = this.glare.render(accumTexture);
    }
    const lut = lutTex || this.sessionLut;
    // the PSF core narrower than the first pyramid level stays in the image: mix weight = amount * lobeFraction
    const glareMix = glareTex && dbg !== 2 ? this.glare.mixWeight(glareAmt) : 0;
    u.tAccum.value = accumTexture; u.tGlare.value = glareTex || accumTexture; u.uGlare.value = glareMix;
    u.uExposure.value = (g.exposure ?? 1) * Math.pow(2, g.exposureEV ?? 0);
    u.uSat.value = g.saturation ?? 1;
    u.uLift.value.fromArray(vec3(g.lift, 0)); u.uGamma.value.fromArray(vec3(g.gamma, 1)); u.uGain.value.fromArray(vec3(g.gain, 1));
    u.tLUT.value = lut; u.uLutSize.value = lut.userData.size;
    u.uLutMin.value.fromArray(lut.userData.domainMin); u.uLutMax.value.fromArray(lut.userData.domainMax);
    u.uLutMix.value = lut === this.identityLut ? 0 : (g.lutMix ?? 1);
    u.uGrain.value = g.grain ?? 0; u.uDither.value = g.dither ?? 1; u.uQuantize.value = 255; u.uFrame.value = frame >>> 0;
    u.uDebug.value = dbg;
    if (depth) { u.tDepth.value = depth.texture; u.uNear.value = depth.near; u.uFar.value = depth.far; u.uK.value = depth.K; u.uFocus.value = depth.focus; }
    else u.tDepth.value = null;
    r.setRenderTarget(this.outRT);
    this.quad.render(r);
    r.setRenderTarget(null);
    this.stats = { glareLevels: glareTex ? this.glare.levels : 0, glareWeights: glareTex ? this.glare.weights.map((w) => +w.toFixed(4)) : null,
      glareMix: +glareMix.toFixed(6), glareCore: glareTex ? +this.glare.coreEnergy.toFixed(4) : null, lut: lut.userData.title };
  }

  /** draw the last output frame to the canvas (interactive preview only); smaa: edge anti-aliasing on the way */
  present({ smaa = false } = {}) {
    let tex = this.outRT.texture;
    if (smaa) {
      if (!this.smaa) {
        this.smaa = new SMAAPass();
        this.smaa.setSize(this.width, this.height);
        this.aaRT = new THREE.WebGLRenderTarget(this.width, this.height, { depthBuffer: false });
      }
      this.smaa.render(this.renderer, this.aaRT, this.outRT);
      tex = this.aaRT.texture;
    }
    this.presentQuad.material.uniforms.tOut.value = tex;
    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.presentQuad.render(this.renderer);
  }

  dispose() {
    this.outRT.dispose(); this.glare.dispose(); this.identityLut.dispose();
    this.quad.material.dispose(); this.quad.dispose(); this.presentQuad.material.dispose(); this.presentQuad.dispose();
    if (this.smaa) { this.smaa.dispose(); this.aaRT.dispose(); }
  }
}

function vec3(v, def) {
  if (v == null) return [def, def, def];
  if (typeof v === 'number') return [v, v, v];
  return [v[0] ?? def, v[1] ?? def, v[2] ?? def];
}
