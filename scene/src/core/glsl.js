// Shared GLSL chunks (WebGL2 / GLSL ES 3.0 via three's ShaderMaterial). Deterministic integer hashes only.

// pcg3d (Jarzynski & Olano 2020): uvec3 -> uvec3, good avalanche, cheap.
export const GLSL_PCG = /* glsl */`
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// uniform [0,1)^3 from an integer pixel coordinate and a seed (frame, sub-frame, ...)
vec3 hash3(uvec2 px, uint seed) { return vec3(pcg3d(uvec3(px, seed))) * (1.0 / 4294967296.0); }
float hash1(uvec2 px, uint seed) { return float(pcg3d(uvec3(px, seed)).x) * (1.0 / 4294967296.0); }
`;

// Hashed alpha test (Wyman & McGuire 2017) helper: object-space stable hash, seeded per sub-frame by the caller.
// Use: if (alpha < hashedAlphaThreshold(objPos, uSubSeed)) discard;
export const GLSL_HASHED_ALPHA = /* glsl */`
float hashedAlphaThreshold(vec3 p, uint seed) {
  uvec3 q = uvec3(ivec3(floor(p * 4096.0)) + ivec3(1 << 20));
  return float(pcg3d(q ^ uvec3(seed, seed * 7919u, seed * 104729u)).x) * (1.0 / 4294967296.0);
}
`;

export const GLSL_SRGB = /* glsl */`
float srgbOETF1(float c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 srgbOETF(vec3 c) { return vec3(srgbOETF1(c.r), srgbOETF1(c.g), srgbOETF1(c.b)); }
float srgbEOTF1(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 srgbEOTF(vec3 c) { return vec3(srgbEOTF1(c.r), srgbEOTF1(c.g), srgbEOTF1(c.b)); }
`;

export const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Khronos PBR Neutral tone mapper (reference implementation, https://github.com/KhronosGroup/ToneMapping).
// Input: scene-linear Rec.709, already exposed. Output: display-linear Rec.709 in [0,1]. Hue-preserving; only
// compresses above ~0.76 and lifts nothing (the small toe offset removes a 0.04 floor in the darkest values).
export const GLSL_PBR_NEUTRAL = /* glsl */`
vec3 pbrNeutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
`;
