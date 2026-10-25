// LOOK-DEV ONLY placeholder environment until scene/src/world provides the baked sky cube.
// A procedural equirectangular sunset (HDR, linear) fitted to the measured palette of research/refs.md section 3.3:
// sky colour by elevation in 4 azimuth columns around the sun (A = 0 at -Z, DESIGN.md section 2), circumsolar glow,
// two ridge layers (far hazed range with snow, near dark headlands), a band of altocumulus, and a darker,
// more saturated mirror of all of it below the horizon (the lake). Deterministic; no textures are loaded.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const ELEV = [0, 3, 6, 7, 9, 10.5, 12, 13.5, 15, 30, 90];
const COLS = {
  sun: ['#FEC391', '#FEC391', '#FDB18D', '#FBA88E', '#E0989A', '#C78594', '#A57392', '#8A668D', '#715D8B', '#3A3A6A', '#1A2040'],
  centre: ['#F38171', '#F38171', '#FA957B', '#F38E7D', '#C97785', '#A5688A', '#7C5884', '#645180', '#534B7C', '#2E305C', '#1A2040'],
  anti: ['#6E4A6E', '#6A4A70', '#67496F', '#634870', '#5E4C74', '#5C4E74', '#49466F', '#353A62', '#2E3660', '#232A50', '#1A2040'],
  opp: ['#4A3E66', '#463E68', '#423C66', '#3E3A64', '#3A3862', '#36365F', '#32345C', '#2E3258', '#2A3056', '#20284C', '#1A2040'],
};

const GLSL = /* glsl */`
precision highp float;
uniform vec3 uSun[11]; uniform vec3 uCen[11]; uniform vec3 uAnti[11]; uniform vec3 uOpp[11];
uniform float uElevKnots[11];
uniform float uSunElev;     // degrees
uniform float uIntensity;
uniform float uCloud;       // cloud coverage scale (0 = clear)
uniform float uWaterF0;     // look-dev water reflectance at normal incidence
varying vec2 vUv;
#define PI 3.14159265359
uint pcgH(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float h1(float n){ return float(pcgH(uint(int(floor(n))) + 0x9E3779B9u)) / 4294967295.0; }
float h2(vec2 p){ ivec2 i = ivec2(floor(p)); return float(pcgH(uint(i.x) * 1597334677u ^ pcgH(uint(i.y) + 0x85EBCA6Bu))) / 4294967295.0; }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
float n1(float x){ float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
// ridged 1-D noise for mountain silhouettes (A in degrees)
float ridged(float a, float sc){ float s = 0.0, amp = 1.0, f = sc;
  for (int i = 0; i < 5; i++){ float v = 1.0 - abs(2.0 * n1(a * f + float(i) * 17.3) - 1.0); s += amp * v * v; amp *= 0.5; f *= 2.1; } return s; }
vec3 column(vec3 tab[11], float e){
  vec3 c = tab[10];
  for (int i = 0; i < 10; i++){ if (e >= uElevKnots[i] && e < uElevKnots[i + 1]) { float t = (e - uElevKnots[i]) / (uElevKnots[i + 1] - uElevKnots[i]); c = mix(tab[i], tab[i + 1], t); } }
  if (e < 0.0) c = tab[0];
  return c;
}
vec3 skyClear(float A, float e){
  float a = abs(A);
  vec3 s = column(uSun, e), c = column(uCen, e), an = column(uAnti, e), o = column(uOpp, e);
  vec3 col;
  if (a < 20.0) col = mix(s, c, smoothstep(0.0, 20.0, a));
  else if (a < 40.0) col = mix(c, an, smoothstep(20.0, 40.0, a));
  else col = mix(an, o, smoothstep(40.0, 140.0, a));
  // circumsolar glow (sun just below the horizon)
  float glow = exp(-pow(a / 11.0, 2.0)) * exp(-max(e - uSunElev, 0.0) / 3.2);
  col += vec3(1.0, 0.62, 0.36) * glow * 0.55;
  return col;
}
float ridgeNear(float A){ // near headlands / hills only where refs.md section 4 puts them; low shore line elsewhere
  float shore = 0.25 + 0.25 * ridged(A, 0.3);
  float left = smoothstep(-40.0, -30.0, A) * (1.0 - smoothstep(-2.0, 2.0, A)) * (1.2 + 0.9 * ridged(A, 0.09));
  float right = smoothstep(18.0, 24.0, A) * (1.0 - smoothstep(42.0, 50.0, A)) * (1.0 + 1.0 * ridged(A, 0.12));
  float ring = (1.0 - smoothstep(45.0, 60.0, abs(A))) > 0.5 ? 0.0 : 0.9 + 0.8 * ridged(A, 0.05);
  return max(shore, max(max(left, right), ring));
}
float ridgeFar(float A){
  float r = 1.7 + 1.3 * ridged(A, 0.07);
  r += 2.4 * exp(-pow((A + 4.0) / 3.2, 2.0));      // left dark peak, sun sets behind it
  r += 3.6 * exp(-pow((A - 30.0) / 6.0, 2.0)) * (0.8 + 0.4 * ridged(A, 0.4));   // right snowy massif
  r += 1.2 * smoothstep(2.0, 6.0, A) * (1.0 - smoothstep(18.0, 24.0, A)) * ridged(A, 0.25); // central far range
  r -= 1.6 * exp(-pow((A - 12.0) / 7.0, 2.0));     // far valley (water horizon)
  return max(r, 0.6);
}
vec3 clouds(vec3 col, vec3 d, float A, float e){
  if (d.y < 0.012 || uCloud <= 0.0) return col;
  vec2 p = d.xz / d.y * 4.6;                         // cloud deck ~4 km, units ~ km
  float ang = radians(20.0); mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 q = R * p; q.y *= 2.4;                          // banding
  float w = fbm(q * 0.55 + vec2(3.1, 1.7));
  float f = fbm(q * 1.1 + 2.0 * vec2(w, -w));
  float band = 0.5 + 0.5 * sin(q.y * 0.8 + 2.0 * w);
  // soften with distance (the plane projection compresses detail toward the horizon)
  float soft = 0.06 + 0.10 * (1.0 - smoothstep(0.05, 0.4, d.y));
  float dens = smoothstep(0.58 - soft, 0.62 + soft, f * (0.75 + 0.45 * band)) * uCloud;
  dens *= smoothstep(0.035, 0.12, d.y);
  float a = abs(A);
  // refs.md 3.4: undersides / sun-facing edges lit salmon-peach (sun 1-3 deg below the horizon still lights them),
  // bodies dark plum; warmest within +-30 deg of the sun, violet-grey on the anti-sun side
  float sunAz = exp(-pow(a / 65.0, 2.0));
  vec3 bodyHi = vec3(0.127, 0.038, 0.102), bodyLo = vec3(0.292, 0.064, 0.115);       // #64375A / #93475F
  vec3 body = mix(bodyHi, bodyLo, smoothstep(30.0, 6.0, e)) * (0.55 + 0.45 * sunAz) + vec3(0.02, 0.02, 0.05) * (1.0 - sunAz);
  vec3 litHi = vec3(0.62, 0.25, 0.27), litLo = vec3(0.955, 0.39, 0.22);             // ~#CC8A8E / #FAA781
  vec3 edge = mix(litHi, litLo, smoothstep(40.0, 6.0, e)) * (0.25 + 0.95 * sunAz);
  // thin parts of a cloud are lit through, thick cores stay plum
  float core = smoothstep(0.62, 0.80, f * (0.75 + 0.45 * band));
  vec3 cc = mix(edge, body, core * (0.75 - 0.35 * sunAz));
  return mix(col, cc, dens * 0.95);
}
vec3 world(vec3 d){
  float e = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float A = degrees(atan(d.x, -d.z));
  float ae = abs(e);
  vec3 sky = skyClear(A, ae);
  sky = clouds(sky, vec3(d.x, abs(d.y), d.z), A, ae);
  // ridges (seen at |e| for the reflection too)
  float rf = ridgeFar(A), rn = ridgeNear(A);
  float rm = 0.55 * rf + 0.45 * rn + 0.35 * ridged(A + 40.0, 0.11);     // mid ridges between the two
  float sunSide = exp(-pow(abs(A) / 50.0, 2.0));
  // refs.md 3.2 / 3.5 palette: far hazed range #62496C (sun side) .. navy away from the sun, mid ridges #473B5C,
  // near headlands #0F1220; snow in sky-shade lavender-navy #3E4978 (0.6-0.75x the sky behind)
  vec3 farSun = vec3(0.122, 0.067, 0.152), farAnti = vec3(0.032, 0.040, 0.105);
  vec3 farCol = mix(farAnti, farSun, sunSide);
  farCol *= 0.85 + 0.3 * smoothstep(rf - 2.5, rf, ae);          // lighter toward the crest (haze gradient)
  float crest = smoothstep(rf - 1.8, rf - 0.3, ae) * smoothstep(2.4, 4.2, rf);
  float streak = smoothstep(0.30, 0.70, 0.6 * n1(A * 3.1 + ae * 4.0) + 0.4 * n1(A * 9.0 - ae * 11.0));
  float snow = crest * streak;
  vec3 snowCol = mix(vec3(0.048, 0.068, 0.188), vec3(0.091, 0.065, 0.178), sunSide);
  farCol = mix(farCol, snowCol, snow * 0.9);
  vec3 midCol = mix(vec3(0.020, 0.022, 0.060), vec3(0.064, 0.044, 0.107), sunSide);
  vec3 nearCol = mix(vec3(0.0045, 0.0055, 0.014), vec3(0.008, 0.007, 0.018), sunSide);
  float mist = exp(-pow((ae - 0.25) / 0.35, 2.0)) * 0.6;         // thin mist line at the far shores
  farCol = mix(farCol, skyClear(A, 1.0) * 0.35, mist * (1.0 - sunSide * 0.3));
  // anti-aliased layer edges (one texel ~ 0.09 deg at 4096 wide)
  float aaw = 0.10;
  vec3 c = sky;
  c = mix(c, farCol, 1.0 - smoothstep(rf - aaw, rf + aaw, ae));
  if (rm < rf) c = mix(c, midCol, 1.0 - smoothstep(rm - aaw, rm + aaw, ae));
  c = mix(c, nearCol, 1.0 - smoothstep(rn - aaw, rn + aaw, ae));
  if (e < 0.0) {
    float s = sin(radians(ae));
    float F = uWaterF0 + (1.0 - uWaterF0) * pow(1.0 - s, 5.0);
    F = max(F, 0.30 * (1.0 - s) + 0.06);
    vec3 deep = vec3(0.004, 0.004, 0.010);
    c = mix(deep, c * vec3(0.92, 0.80, 0.85), clamp(F, 0.0, 1.0));
  }
  return c * uIntensity;
}
void main(){
  float phi = (vUv.x - 0.5) * 2.0 * PI; float th = (vUv.y - 0.5) * PI;
  vec3 d = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
  gl_FragColor = vec4(world(d), 1.0);
}`;

export function createSunsetEnv(renderer, { width = 4096, height = 2048, sunElevDeg = -1.0, intensity = 1.0, cloud = 1.0, waterF0 = 0.02 } = {}) {
  const lin = (hex) => new THREE.Color(hex); // sRGB hex -> linear
  const arr = (k) => COLS[k].map(lin).map((c) => new THREE.Vector3(c.r, c.g, c.b));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: arr('sun') }, uCen: { value: arr('centre') }, uAnti: { value: arr('anti') }, uOpp: { value: arr('opp') },
      uElevKnots: { value: ELEV.slice() }, uSunElev: { value: sunElevDeg }, uIntensity: { value: intensity }, uCloud: { value: cloud },
      uWaterF0: { value: waterF0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: GLSL, depthTest: false, depthWrite: false,
  });
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.mapping = THREE.EquirectangularReflectionMapping;
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const quad = new FullScreenQuad(mat);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); quad.render(renderer); renderer.setRenderTarget(prev);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(rt.texture);
  pmrem.dispose(); quad.dispose(); mat.dispose();
  return { background: rt.texture, environment: env.texture, renderTarget: rt, envTarget: env,
    dispose() { rt.dispose(); env.dispose(); } };
}
