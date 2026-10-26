// Afterglow pianist module (DESIGN.md: scene/src/pianist; interface: docs/RENDERING.md section 3).
//   export async function create(ctx) -> { group, parent: 'rig', update(t, sub), beforeFrame, api... }
// Loads assets/pianist/pianist.glb (meshopt + WebP; bind pose = seated at the keys), places it in the rig frame
// (pianist frame: floor y = 0, white-key front plane z = 0, keyboard centre x = 0 -> rig (0, -0.04, KEY_FRONT_Z)),
// replaces the glTF materials with film materials:
//   skin  - MeshPhysicalMaterial + back-scatter: environment light from behind the surface, attenuated by the per-vertex
//           skin thickness (_THICK, mm-scale ray to the far side) with red-shifted mean free paths, strongest at the
//           silhouette (fingers / ears glow red-orange against the sunset); wrapped diffuse for any direct lights;
//           hands use the dedicated 9 texel/mm set (albedo / normal / ORM; ORM.b = nail mask); the nail plate meshes
//           (pianist_nail) are glossy keratin with a clearcoat; the face/neck skin's sky fill is scaled by faceFill
//           (default 0.22, was 0.45 until the 1080p ref9 wide showed a lit profile: hair/brow occlusion three cannot compute, and the BRIEF keeps the face dark)
//   hair  - per-strand bent normals (from the pipeline), anisotropic GGX along the strand (explicit strand tangents),
//           forward scattering toward the viewer when backlit (rim glow on stray curls), stratified hashed alpha across/
//           along the ribbon (per-frame hash + per-sub-frame stratum: exact coverage to 1/N after accumulation)
//   cloth - near-black wool with sheen (KHR_materials_sheen from the GLB) + procedural 2/2 twill, glossy horn buttons
//           (disc list in the suit material's extras), lining, cotton cuffs, leather shoes
//   micro - sub-texel skin relief on the hands (value noise 0.11 / 0.32 mm), LOD-faded
// and every update(t, sub) applies the performance tracks (scene/src/perf/tracks.js) at the sub-frame time, so motion
// blur sees per-sub-frame poses. Without perf data the bind (seated) pose is used. Deterministic: no Math.random/Date.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { buildTailoring, TAILOR_COMMON, SLEEVE_PARS, SLEEVE_NORMAL, CUFF_PARS, CUFF_NORMAL, BUTTON_PARS, BUTTON_NORMAL } from './tailoring.js';
import { buildHandHair } from './handhair.js';

const DEFAULT_GLB = new URL('../../../assets/pianist/pianist.glb', import.meta.url).href;
const DEFAULT_RIG = new URL('../../../assets/pianist/rig.json', import.meta.url).href;
const D2R = Math.PI / 180;
// hand look defaults (fix round 1 tuning, sandbox/pianist/fx1/tune*): env fill scale and its desaturation on the hands
// (l1 measured: base p50 15-16 / sat 0.81 -> rim 24-28 + env 1.5-2 + desat 0.5-0.65: p50 26-35, sat 0.51-0.64; refs 7/12 p50 58/33, sat 0.57)
// cycle 2 (critic c2r1: hands evenly filled, L p10/p50 0.87-0.91 vs refs 0.40-0.47; rim outlines the shadow-side contours):
// handFillDir = [shadow side, lit side] factors of the env fill by the normal's facing of the glow direction (form modelling);
// the rim silhouette lobe is gated by the glow facing and broader (rimEdge [exponent, gain])
// (c2a_1080, smoothstep ramp [0.42, 1.3] + env 3.0: S06 p50 43 -> 19.6 but p10/p50 still 0.85 -> half-Lambert [0.4, 1.6], env 3.2: NOT GPU-verified yet, c2b_1080 queued)
// handAOFloor: the hand ORM AO is floored in the module (the S06 / S24 thumb 'cut' strokes are AO-only: c2a noAO A/B)
// cycle 2 round 2 (c2r2_1080 variants, critic handmetrics): rimEdge [3,3] -> [3,2] + handEnv 3.2 -> 3.6 = S06 p50 28.8 -> 31.8,
// p95/p50 3.25 -> 2.72 (ref 12: 33.0 / 2.52); handDesat 0.35 LOWERED sat (violet sky fill) -> desat kept, warmer tint (a* 10 -> 12.5
// with [1.75, 0.8, 0.62]; refs 15-21) -> [1.85, 0.78, 0.58] (luminance 1)
// cycle 3: rimKick (face-on floor of the glow-side rim lobe; 0 = the cycle-2 look) - per shot in SHOTS[i].pianist
const HAND_LOOK = { handEnv: 3.6, handDesat: 0.6, handScatter: 0.4, rimElevDeg: 36, rimNeutral: 0.78, rimEdge: [3.0, 2.0], rimKick: 0, handFillTint: [1.85, 0.78, 0.58], handFillDir: [0.4, 1.6], handAOFloor: 0.78, handAOFloorThumb: 0.93 };
// fix round 2 (critic r2): dark skin / hair silhouettes rendered pure saturated red (S16 cheek sat 0.98, ref 9 0.65; hair
// rgb50 (5,0,1)): a partial desaturation of their sky fill + back-scatter; the ears' red back-scatter capped (bodyScatter)
// cycle 2 (lead: S02 hair reads reddish-brown, must be near-black with a warm rim only): hairFill scales the hair's sky fill
// cycle 3 round 2 (critic c3r2: the wrist strip is a darker, more saturated patch with a hard edge at the hand seam; armMatch 0.8
// made it worse): sandbox/pianist/scratch/seamtex.py measured the two albedo maps at the seam (0-2 mm, linear): hand / body =
// [0.997, 0.969, 0.973] (L 0.978), thickness equal (36.6 / 36.8 mm), vArmW = 1 -> the old armTone [0.955, 0.915, 0.875] darkened
// and saturated the strip by itself. armTone = the measured ratio (per frame), and the strip now runs the hand's own surface
// code: roughness structure, micro relief, skinTone (x vArmW; the face is unchanged)
const BODY_LOOK = { bodyDesat: 0.4, bodyScatter: 0.6, hairDesat: 0.5, hairFill: 0.5, armMatch: 1.0, armTone: [0.997, 0.969, 0.973] };
// wool (critic r2: suit p50 0.5 / p90 1.6, rgb50 (1,0,4) sat 0.97 vs ref 7 p50 1-3.3 / p90 4.4, sat 0.22-0.46): neutral
// sheen (was 0.035), albedo lift, env-fill desaturation so the violet sky does not tint the black.
// cycle 2 (I-41: x4.5 everywhere turned the sky-facing suit mid-grey, S02 back p50 26.9 vs refs 2-3): the lift is now
// GRAZING ONLY - diffuse albedo factor = mix(woolFace, woolAlbedo, (1 - N.V)^woolGrazePow) - and the last ~12 mm of the
// sleeve (turned hem) stays at woolFace (it read as a pale fuzzy band next to the cuff)
// cycle 3 (critic c3: sleeves a flat black cut-out, S04 forearm p50 / p90 0.8 / 1.3 vs ref 7 2.4 / 5.6): c3a_1080 woolFaceSide 6.5 + sheen 0.5 ->
// S04 1.3 / 2.6, 8 + 0.6 -> 1.9 / 3.1 (p10 1.0-1.1); S02 back 4.8 -> 10.9 with sheen 0.5 -> S02 keeps woolSheen 0.25 per shot (shots.js)
const WOOL_LOOK = { woolSheen: 0.5, woolAlbedo: 4.5, woolFace: 1.3, woolFaceSide: 8.0, woolGrazePow: 2.5, woolDesat: 0.6 };
// shirt cuff (critic r2: L 19-29 lavender-blue, sat 0.5-0.62 vs ref 8 L 114 sat 0.40): fill boost + desat toward white.
// cycle 2 (critic c2r1: cuff still B/R 1.29-1.35 lavender-grey; ref 8 lit cuff B/R 0.80): fully desaturated fill x a warm
// tint (luminance 1), hem shadow line from the sleeve hem plane (hemShadow = factor at the hem)
// (c2a_1080: fill 2.6 / tint [1.16, 0.97, 0.86] -> S06 cuff rgb (48, 41, 36), B/R 0.75, L p50 35 = khaki grey -> brighter, pinker)
// cycle 2 round 2 (critic c2r2: S06 cuff L p50 37 B/R 0.78 khaki; ref 8 far cuff L 106 B/R 1.38): per-angle hem contact line
// (hemLine = [value at the hem, width mm, inner-face floor]), sky-facing side cool white (shirtTintSky), brighter fill
// (c2r2_1080 fill 3.8: S06 cuff L p50 86 / S24 74, fill 7: 125 / 110 -> 4.5)
// nails: [plate r,g,b, free edge r,g,b] albedo factors on the hand paint, plate specular x (1 + nailSpec)
// cycle 3 round 2 (critic c3r2: S06 4K plates Lab 38.8 / 26.2 / 4.9, hue 11 deg / -4 deg, L* 1.7x the finger; target hue
// 20-26 deg, L* <= 1.3x, b* > 0): warmer (blue down), ~35 % darker bed, free edge near the plate tone, half the plate specular
// (c3r2b nail-only mask, nailstat.py: [0.52,0.42,0.30]/0.45 -> hue 1.7 -> 17.5 deg (S06), -1 -> 13.2 (S24), b* > 0, but L* ratio still
// 1.65 / 1.53 -> another ~25 % darker, warmer, less specular; NOT GPU-verified)
const NAIL_LOOK = { nailTone: [0.40, 0.31, 0.20, 0.40, 0.32, 0.22], nailSpec: 0.3 };
const SHIRT_LOOK = { shirtFill: 4.5, shirtDesat: 1.0, shirtTint: [1.2, 0.95, 0.92], shirtTintSky: [0.9, 1.0, 1.16], hemLine: [0.45, 2.0, 0.3], hemShadow: 0.3 };

async function pianoFrame() {
  try {
    const L = await import('../piano/layout.js');
    return { keyFrontZ: L.KEY_FRONT_Z, rigY: L.RIG_Y_OFFSET };
  } catch (e) {
    return { keyFrontZ: 0.022, rigY: -0.04 };                  // DESIGN.md section 2 values
  }
}

async function loadTracks(ctx, opts) {
  try {
    const mod = await import(opts.tracksModule || '../perf/tracks.js');      // tracksModule: test override only
    if (opts.perfJson && opts.perfBin) return await mod.loadPerf(opts.perfJson, opts.perfBin);
    if (ctx.data && ctx.data.perfMeta && ctx.data.perf) return mod.fromBuffers(ctx.data.perfMeta, ctx.data.perf);
  } catch (e) {
    console.warn('[pianist] no performance tracks (bind pose):', e.message);
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ shader snippets
const SKIN_PARS = /* glsl */`
uniform vec3 uScatterColor;      // tint of light transmitted through thin skin
uniform vec3 uScatterMfp;        // mean free path per channel (m): red travels furthest
uniform float uScatterStrength;
uniform float uWrap;
uniform float uNailSpec;
uniform float uIndirectScale;
uniform float uDesat;
uniform vec3 uFillTint;      // fix round 2b: the desaturated fill is re-tinted warm (refs 7 / 12 hand hue), not grey
uniform vec2 uFillDir;       // cycle 2: env fill x [shadow side, lit side] by the facing of the glow direction (hands)
varying float vThick;
// cycle 2 round 2 (critic c2r2: curled fingers -> nail plates deep saturated red, rgb (78,22,17), sat 0.78): the nail mesh's
// own thickness is the 0.5 mm plate, but light reaching it from behind crosses the whole fingertip -> 6 mm floor
#ifdef AG_NAIL_PLATE
#define AG_THICK_MIN 0.006
#else
#define AG_THICK_MIN 0.0005
#endif
// fix round 2: body skin only - vArmW = skin weight of the forearm / wrist / hand bones (1 on the bare wrist strip below the
// shirt cuff, 0 on face / neck / ears): that strip is shaded like the hands (env fill, desat, scatter, glow key + rim)
// instead of with the face's dark fill (critic r2: 'black-maroon band between cuff and hand', L 5.7 vs hand 62)
#ifdef AG_BODY_SKIN
varying float vArmW;
uniform float uArmEnv;
uniform float uArmDesat;
uniform float uArmScatter;
#define AG_IND_SCALE mix( uIndirectScale, uArmEnv, vArmW )
#define AG_DESAT mix( uDesat, uArmDesat, vArmW )
#define AG_SCATTER mix( uScatterStrength, uArmScatter, vArmW )
#define AG_FDIR_W vArmW
#else
#define AG_FDIR_W 1.0
#define AG_IND_SCALE uIndirectScale
#define AG_DESAT uDesat
#define AG_SCATTER uScatterStrength
#endif
`;
const SKIN_RE_DIRECT = /* glsl */`
// wrapped Lambert for skin (light bleeds past the terminator; wider in red), otherwise three's physical direct term
void RE_Direct_Skin( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float ndl = dot( geometryNormal, directLight.direction );
  vec3 w = vec3( uWrap, uWrap * 0.55, uWrap * 0.4 );
  vec3 wrapped = clamp( ( vec3( ndl ) + w ) / ( 1.0 + w ), 0.0, 1.0 );
  float dotNL = saturate( ndl );
  vec3 irradiance = dotNL * directLight.color;
  #ifdef USE_SHEEN
    sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
  #endif
  reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ) * material.multiScatteringCompensation;
  vec3 halfDir = normalize( directLight.direction + geometryViewDir );
  vec3 F = F_Schlick( material.specularColor, material.specularF90, saturate( dot( geometryViewDir, halfDir ) ) );
  reflectedLight.directDiffuse += wrapped * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  // direct back-scatter: light arriving at the far side of a thin part
  vec3 T = exp( - max( vThick, AG_THICK_MIN ) / uScatterMfp );
  float back = saturate( dot( -geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += AG_SCATTER * T * uScatterColor * back * directLight.color * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Skin
`;
const SKIN_AFTER_AO = /* glsl */`
  // face / neck: the sky dome is mostly occluded by the hair, brow and the bowed head (three has no AO for that), and the
  // BRIEF keeps the face dark: the body-skin material scales its sky fill (hands/nails keep 1.0)
  reflectedLight.indirectDiffuse *= AG_IND_SCALE;
  reflectedLight.indirectSpecular *= mix( 1.0, AG_IND_SCALE, 0.7 );
  // hands (fix round 1): the dusk sky fill is strongly pink-violet; x the skin albedo and through PBR Neutral's toe (it
  // subtracts the min channel of dark pixels) the dorsum read maroon (sat 0.82 vs 0.57 in refs 7 / 12). uDesat pulls the
  // diffuse fill toward its own luminance (an art-directed neutral bounce from the white keys / shirt cuff)
  reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * uFillTint, AG_DESAT );
  // cycle 3 r2 (critic c3r2: a thin lavender outline along the finger silhouettes, edge band hue 15 vs 19-22 deg, L* +6): the
  // grazing sky reflection (Fresnel) on the skin is the violet dome -> pulled halfway toward the same warm neutral as the fill
  reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, vec3( dot( reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * mix( vec3( 1.0 ), uFillTint, 0.5 ), 0.6 * AG_DESAT );
  {
    // cycle 2 (critic c2r1: L p10/p50 0.87-0.91 vs refs 0.40-0.47 - the art-directed fill flattened the form): the fill is
    // split by the (normal-mapped) facing of the glow direction, so knuckles / tendons / the side away from the glow model
    // half-Lambert ramp (continuous over the whole sphere: c2a with a smoothstep ramp left the shadow side flat, p10/p50 0.85)
    float agKf = 0.5 + 0.5 * dot( geometryNormal, uRimDirView );
    reflectedLight.indirectDiffuse *= mix( 1.0, mix( uFillDir.x, uFillDir.y, agKf ), AG_FDIR_W );
  }
  {
    // environment back-scatter: the sky behind the finger / ear, through the skin (thin = more, red-shifted)
    vec3 T = exp( - max( vThick, AG_THICK_MIN ) / uScatterMfp );
    float ndv = saturate( dot( geometryNormal, geometryViewDir ) );
    float rim = pow( 1.0 - ndv, 2.0 );
    #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
      // light entering the far side (along -N), plus light from behind along the view ray, which only gets through
      // near the silhouette (face-on, the path through the part is much longer than the normal-ray thickness)
      vec3 backIrr = 0.6 * getIBLIrradiance( -geometryNormal ) + 0.4 * rim * getIBLIrradiance( -geometryViewDir );
    #else
      vec3 backIrr = vec3( 0.0 );
    #endif
    reflectedLight.indirectDiffuse += AG_SCATTER * T * uScatterColor * backIrr * RECIPROCAL_PI;
  }
`;
const HAIR_PARS = /* glsl */`
uniform float uSeed;
uniform float uStrat;
uniform float uHairAlpha;
uniform vec3 uFwdColor;
uniform float uFwdStrength;
varying vec3 vObjPos;
`;

// 'glow key': the bright sky around the (set) sun treated as a directional source for the pianist's own materials only
// (three has no light linking; a scene light would also relight the piano). Radiance = the scene environment sampled
// toward the key direction, times a solid angle -> consistent with the IBL, no extra light rig. Not used on the face /
// neck skin (the face stays dark, BRIEF). No shadowing: the module only applies it where self-occlusion is rare.
const KEY_PARS = /* glsl */`
uniform vec3 uKeyDirView;
uniform float uKeyOmega;
uniform float uKeyBlur;
`;
const KEY_LIGHT = /* glsl */`
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && defined( RE_Direct )
{
  IncidentLight keyLight;
  keyLight.direction = uKeyDirView;
  vec3 keyW = inverseTransformDirection( uKeyDirView, viewMatrix );
  keyLight.color = textureCubeUV( envMap, envMapRotation * keyW, uKeyBlur ).rgb * envMapIntensity * uKeyOmega;
  keyLight.visible = true;
  RE_Direct( keyLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
#endif
`;
// 'glow rim' (fix round 1, USER_FEEDBACK 3 / docs/WORLD.md section 6): world.glowLight (direction + irradiance of the
// horizon glow, scene-linear) as an art-directed rim / key on the pianist's hands, hair and wool only, colour =
// irradiance x gain (per material class; per-shot overrides). Its elevation is raised to at least rimElevDeg so the
// backs of the hands (facing up) catch it the way refs 7 / 12 show; with the skin's wrapped diffuse, GGX and the
// back-scatter term it traces the knuckles, tendons and veins of the normal map. No shadows (look-dev light).
const RIM_PARS = /* glsl */`
uniform vec3 uRimDirView;
uniform vec3 uRimColor;
uniform float uRimGain;
`;
const RIM_LIGHT = /* glsl */`
#if defined( RE_Direct )
if ( uRimGain > 0.0 ) {
  IncidentLight rimLight;
  rimLight.direction = uRimDirView;
  rimLight.color = uRimColor * uRimGain;
  #ifdef AG_RIM_MASK
  rimLight.color *= mix( 0.6, 1.0, agRimB );      // cycle 2: horn buttons - the glow rim on the rounded rim band (cycle 3: face 0.25 -> 0.6, critic c3 S04 row p99 9.6 vs 15-25)
  #endif
  #ifdef AG_RIM_EDGE
  // fix round 2b: silhouette lobe (critic r2: the rim lit whole facing planes; refs show a thin rim on an evenly filled hand)
  // cycle 2 (critic c2r1: every contour got an orange outline, also the shadow-side finger undersides; rim_top10 in the outer
  // band 0.42-0.51 vs refs 0.29-0.37): only edges turned toward the glow light up
  // cycle 3 (C-02 / critic c3: S06 / S24 hand darker than the glow-lit keys around it, c50 0.64-0.69 vs ref 12 3.1): uRimEdge.z =
  // 'kicker' = a face-on floor of the same glow-side lobe, so the back of the hand turned toward the glow lights up (with the
  // skin's wrapped Lambert + GGX) while the side away from the glow keeps the dark fill (per shot: rimKick)
  if ( uRimEdge.x > 0.0 ) rimLight.color *= ( uRimEdge.z + uRimEdge.y * pow( 1.0 - clamp( dot( nonPerturbedNormal, geometryViewDir ), 0.0, 1.0 ), uRimEdge.x ) )
    * smoothstep( -0.45, 0.35, dot( nonPerturbedNormal, uRimDirView ) );
  #endif
  rimLight.visible = true;
  RE_Direct( rimLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
#endif
`;
function addKey(sh, key, rimGain, edge) {
  Object.assign(sh.uniforms, { uKeyDirView: key.dirView, uKeyOmega: key.omega, uKeyBlur: key.blur,
    uRimDirView: key.rimDirView, uRimColor: key.rimColor, uRimGain: rimGain || { value: 0 } });
  if (edge) sh.uniforms.uRimEdge = edge;
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + KEY_PARS + RIM_PARS + (edge ? '#define AG_RIM_EDGE\nuniform vec3 uRimEdge;\n' : ''))
    .replace('#include <lights_fragment_maps>', KEY_LIGHT + RIM_LIGHT + '\n#include <lights_fragment_maps>');
}

// procedural micro relief below the texel scale (session 3, "2x more detail"): resolution independent, LOD-faded by the
// pattern's frequency in cycles per pixel (the sub-frame jitter of the accumulation supersamples what survives).
//   wool:  2/2 worsted twill (diagonal wales, pitch uTwillPitch mm, with the yarn crossings along each wale)
//   skin:  two octaves of value noise (0.11 / 0.32 mm) = the fine relief between the hand map's pores and hatch
// uMicroMm = mm per UV unit (u, v) of the material's normal-map UVs (from the texture size and its texel density).
const MICRO_PARS = /* glsl */`
uniform vec2 uMicroMm;
uniform float uMicroAmp;
uniform float uTwillPitch;
float agH21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float agVN( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( agH21( i ), agH21( i + vec2( 1, 0 ) ), u.x ), mix( agH21( i + vec2( 0, 1 ) ), agH21( i + vec2( 1, 1 ) ), u.x ), u.y );
}
vec2 agTwillGrad( vec2 mm, float pitch ) {
  float a = ( mm.x + mm.y ) / pitch, b = ( mm.x - mm.y ) / ( pitch * 0.5 );
  float h1 = 0.5 - 0.5 * cos( 6.2831853 * a ), h2 = 0.5 - 0.5 * cos( 6.2831853 * b );
  float d1 = 3.14159265 * sin( 6.2831853 * a ) / pitch, d2 = 3.14159265 * sin( 6.2831853 * b ) / ( pitch * 0.5 );
  float c = d1 * ( 0.7 + 0.3 * h2 );
  return vec2( c + h1 * 0.3 * d2, c - h1 * 0.3 * d2 );
}
`;
const MICRO_TWILL = /* glsl */`
#if defined( USE_NORMALMAP_TANGENTSPACE )
{
  vec2 mmUv = vNormalMapUv * uMicroMm;
  float fw = max( length( dFdx( mmUv ) ), length( dFdy( mmUv ) ) ) / ( uTwillPitch * 0.5 );
  float fade = 1.0 - smoothstep( 0.35, 0.75, fw );
  if ( fade > 0.0 ) {
    vec2 g = agTwillGrad( mmUv, uTwillPitch ) * ( uMicroAmp * fade );
    normal = normalize( normal - tbn[ 0 ] * g.x - tbn[ 1 ] * g.y );
  }
}
#endif
`;
// fix round 2 (critic r2: 'isotropic sandpaper / orange peel, cross-hatched weave on the knuckles, noisy rim terminator'):
//   (a) skin lines: two families of shallow V grooves at +-38 deg (rhomboid cross-hatch), pitch 0.42 mm, warped by ~1 mm
//       value noise and depth-modulated (the second family weaker) -> anisotropic, not a uniform grain;
//   (b) sparse pores: pits (r 0.05 mm) on a jittered 0.32 mm grid, ~45 % of the cells;
//   (c) the old isotropic value noise at 35 % (was 100 %);
//   (d) terminator softening: near N.L = 0 of the glow rim (and the key) the whole normal perturbation (map + micro) is
//       pulled toward the geometric normal, so the rim terminator stays a clean soft edge instead of pixel noise.
const MICRO_SKIN = /* glsl */`
#if defined( USE_NORMALMAP_TANGENTSPACE )
{
  vec2 mmUv = vNormalMapUv * uMicroMm;
  float fw = max( length( dFdx( mmUv ) ), length( dFdy( mmUv ) ) );
  vec2 g = vec2( 0.0 );
  for ( int o = 0; o < 2; o++ ) {
    float cell = o == 0 ? 0.11 : 0.32;
    float fade = 1.0 - smoothstep( 0.35, 0.75, fw / cell );
    if ( fade <= 0.0 ) continue;
    vec2 p = mmUv / cell + float( o ) * 17.0; float e = 0.25;
    float h0 = agVN( p );
    g += vec2( agVN( p + vec2( e, 0.0 ) ) - h0, agVN( p + vec2( 0.0, e ) ) - h0 ) / ( e * cell ) * fade * ( o == 0 ? 0.6 : 1.0 ) * 0.35;
  }
  g *= uMicroAmp;
  {
    const float P = 0.42, S = 0.1;
    float fadeL = 1.0 - smoothstep( 0.3, 0.7, fw / P );
    if ( fadeL > 0.0 ) {
      vec2 q = mmUv + ( vec2( agVN( mmUv * 0.9 ), agVN( mmUv * 0.9 + 31.0 ) ) - 0.5 ) * 0.5;
      const vec2 d1 = vec2( 0.788, 0.616 ), d2 = vec2( 0.788, -0.616 );
      float f1 = fract( dot( q, d1 ) / P ) - 0.5, f2 = fract( dot( q, d2 ) / P ) - 0.5;
      float e1 = exp( - f1 * f1 / ( 2.0 * S * S ) ), e2 = exp( - f2 * f2 / ( 2.0 * S * S ) );
      float m1 = 0.5 + agVN( mmUv * 1.3 + 5.0 ), m2 = 0.25 + 0.75 * agVN( mmUv * 1.3 + 11.0 );
      // h = -depth m e(f): dh/dmm = depth m e f / S^2 * d / P (depth 6 um, max slope ~6 deg)
      g += ( m1 * e1 * f1 * d1 + m2 * e2 * f2 * d2 ) * ( 0.006 / ( S * S * P ) ) * fadeL * uMicroAmp / 0.006;
    }
    float fadeP = 1.0 - smoothstep( 0.25, 0.6, fw / 0.1 );
    if ( fadeP > 0.0 ) {
      vec2 c = floor( mmUv / 0.32 ), fpos = fract( mmUv / 0.32 );
      if ( agH21( c + 3.0 ) < 0.45 ) {
        vec2 dv = ( fpos - ( 0.25 + 0.5 * vec2( agH21( c + 7.0 ), agH21( c + 13.0 ) ) ) ) * 0.32;     // mm from the pore centre
        float r2 = dot( dv, dv ), rr = 0.05;
        g += dv * ( exp( - r2 / ( rr * rr ) ) * 0.008 * 2.0 / ( rr * rr ) ) * fadeP * uMicroAmp / 0.006;   // pit 8 um
      }
    }
  }
  normal = normalize( normal - tbn[ 0 ] * g.x - tbn[ 1 ] * g.y );
  float term = min( abs( dot( nonPerturbedNormal, uRimDirView ) ), abs( dot( nonPerturbedNormal, uKeyDirView ) ) + 0.15 );
  normal = normalize( mix( nonPerturbedNormal, normal, mix( 0.35, 1.0, smoothstep( 0.04, 0.3, term ) ) ) );
}
#endif
`;
function addMicro(sh, U, chunk) {
  Object.assign(sh.uniforms, U);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + MICRO_PARS)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + chunk);
}
function microMm(THREE, tex, texelsPerMm) {
  const im = tex && tex.image; const w = (im && (im.width || im.videoWidth)) || 4096, h = (im && (im.height || im.videoHeight)) || 4096;
  return new THREE.Vector2(w / texelsPerMm, h / texelsPerMm);
}

function hashedAlphaChunk(glsl) {
  return glsl.GLSL_PCG + glsl.GLSL_HASHED_ALPHA;
}

// ------------------------------------------------------------------------------------------------ module
export async function create(ctx) {
  const { THREE } = ctx;
  const opts = { glb: DEFAULT_GLB, rig: DEFAULT_RIG, benchHeight: 0.47, ...((ctx.options && ctx.options.pianist) || {}) };
  const frame = await pianoFrame();
  const group = new THREE.Group(); group.name = 'pianist';
  group.position.set(0, frame.rigY, frame.keyFrontZ);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(opts.glb);
  const root = gltf.scene; root.name = 'pianist.gltf';
  group.add(root);
  let rig = null;
  try { rig = await (await fetch(opts.rig)).json(); } catch (e) { rig = null; }

  // ---- skeleton
  let skeleton = null;
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh) { meshes.push(o); o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton;
  });
  if (!skeleton) throw new Error('pianist GLB has no skeleton');
  const bones = new Map(skeleton.bones.map((b) => [b.name, b]));
  const bind = new Map(skeleton.bones.map((b) => [b.name, { q: b.quaternion.clone(), p: b.position.clone() }]));

  // ---- materials
  const seed = { value: 0 }, strat = { value: 0.5 };
  const hairLag = { value: new THREE.Vector3() };
  const key = { dirView: { value: new THREE.Vector3(0, 0, 1) }, omega: { value: opts.keyOmega ?? 0.35 }, blur: { value: opts.keyBlur ?? 0.3 },
    world: new THREE.Vector3(0, 0, -1), minElevDeg: opts.keyMinElevDeg ?? 10,
    // glow rim (world.glowLight): direction in view space per sub-frame, colour = glow irradiance (per frame)
    rimDirView: { value: new THREE.Vector3(0, 0, 1) }, rimColor: { value: new THREE.Vector3(0.173, 0.069, 0.074) },
    rimWorld: new THREE.Vector3(0, 0.34, -0.94), rimElevDeg: opts.rimElevDeg ?? HAND_LOOK.rimElevDeg, rimWarm: opts.rimWarm ?? 0.0, rimNeutral: opts.rimNeutral ?? HAND_LOOK.rimNeutral,
    rimEdge: { value: new THREE.Vector3(...(opts.rimEdge || HAND_LOOK.rimEdge).slice(0, 2), opts.rimKick ?? HAND_LOOK.rimKick) } };
  // per material class rim gains (x glow irradiance); per shot: SHOTS[i].pianist.{rimHand, rimHair, rimWool, rimShirt}
  // rimButton: the horn buttons' own glow-rim gain (session 5; default = the wool's 6, as look-dev l1-l5 approved)
  // cycle 2: rimButton 2 -> 5 on the horn buttons' rim band (x0.25 on the dished face, AG_RIM_MASK)
  // cycle 2 round 2 (critic c2r2: S04 button row p99 7.3 vs ref 7 25.5): rimButton 5 -> 9, rim band roughness 0.32 -> 0.25
const RIM_DEFAULTS = { rimHand: 26, rimHair: 4, rimWool: 6, rimShirt: 2.5, rimButton: 9 };
  const glowKey = key;
  // warm re-tint of the desaturated skin fill (normalised to luminance 1; per frame: handFillTint)
  const fillTint = { value: new THREE.Vector3(1, 1, 1) };
  const setTint = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; fillTint.value.set(c[0] / l, c[1] / l, c[2] / l); };
  const fillDir = { value: new THREE.Vector2(...(opts.handFillDir || HAND_LOOK.handFillDir)) };
  // cycle 2 plate tone [0.74, 0.66, 0.64] / free edge [0.60, 0.50, 0.45] -> cycle 3 NAIL_LOOK (per frame: nailTone, nailSpec)
  const nailTone = { value: [new THREE.Vector3(), new THREE.Vector3()] };
  const skinTone = { value: opts.skinTone ?? 1 };
  const hemDark = { value: new THREE.Vector2(...(opts.hemDark || [4, 22])) };
  const slabDark = { value: opts.slabDark ?? 0.1 }, slabMm = { value: new THREE.Vector2(...(opts.slabMm || [3, 8])) };      // cycle 3 r2: inner sleeve-tube face near the hem (tailoring '_slvIn')
  const setNailTone = (t) => { nailTone.value[0].set(...t.slice(0, 3)); nailTone.value[1].set(...t.slice(3, 6)); };
  setNailTone(Array.isArray(opts.nailTone) ? opts.nailTone : NAIL_LOOK.nailTone);
  const aoFloor = { value: opts.handAOFloor ?? HAND_LOOK.handAOFloor }, aoFloorThumb = { value: opts.handAOFloorThumb ?? HAND_LOOK.handAOFloorThumb };
  // cycle 2: cuff + pearl button look (shared uniforms) and the per-cuff sleeve-hem plane (world: normal toward the hand, w)
  const shirtU = { uShirtFill: { value: opts.shirtFill ?? SHIRT_LOOK.shirtFill }, uShirtDesat: { value: opts.shirtDesat ?? SHIRT_LOOK.shirtDesat },
    uShirtTint: { value: new THREE.Vector3(...(opts.shirtTint || SHIRT_LOOK.shirtTint)) }, uHemShadow: { value: opts.hemShadow ?? SHIRT_LOOK.hemShadow },
    uShirtTintSky: { value: new THREE.Vector3(...(opts.shirtTintSky || SHIRT_LOOK.shirtTintSky)) }, uHemLine: { value: new THREE.Vector3(...(opts.hemLine || SHIRT_LOOK.hemLine)) }, uCuffXOn: { value: 0 } };
  const hemPlane = { R: { value: new THREE.Vector4(0, 0, 0, 0) }, L: { value: new THREE.Vector4(0, 0, 0, 0) } };
  setTint(opts.handFillTint || HAND_LOOK.handFillTint);
  const rimGain = Object.fromEntries(Object.entries(RIM_DEFAULTS).map(([k, v]) => [k, { value: opts[k] ?? v }]));
  const glsl = ctx.core && ctx.core.glsl;
  const texOf = (m, k) => (m && m[k]) || null;
  const made = new Map();
  // kind: 'body' | 'hand' (9 texel/mm set, ORM.b = nail paint mask) | 'nail' (the nail plate meshes: same maps,
  // keratin: smoother, more specular, no vellus sheen; the plate is thin, so the bed glows through in backlight)
  function skinMaterial(src, kind) {
    const isHand = kind !== 'body', isNail = kind === 'nail';
    const m = new THREE.MeshPhysicalMaterial({
      name: src.name + '.film', map: src.map, normalMap: src.normalMap, normalScale: src.normalScale.clone(),
      roughness: isNail ? 0.62 : isHand ? 0.85 : 0.42, roughnessMap: isHand ? src.roughnessMap : null,
      aoMap: isHand ? src.aoMap : null, aoMapIntensity: isNail ? 0.5 : 0.85, metalness: 0,
      specularIntensity: 1.0, ior: isNail ? 1.55 : 1.4,
      sheen: isNail ? 0.0 : 0.35, sheenColor: new THREE.Color(0.30, 0.22, 0.20), sheenRoughness: 0.55,   // vellus hair / dry skin at grazing angles
      // fix round 2 (critic r2: plates read as lavender acrylic, 34 % brighter than the finger, the coat mirrors the violet
      // sky): thinner, rougher coat (0.35 / 0.32 -> 0.15 / 0.42) and less plate specular (uNailSpec 1.6 -> 1.0)
      clearcoat: isNail ? 0.15 : 0.0, clearcoatRoughness: 0.42,
    });
    const U = {
      uScatterColor: { value: new THREE.Color(1.0, 0.55, 0.42) },
      uScatterMfp: { value: new THREE.Vector3(0.0055, 0.0026, 0.0018) },
      uScatterStrength: { value: opts.scatterStrength ?? 1.2 },
      uWrap: { value: isNail ? 0.15 : 0.35 },
      uNailSpec: { value: isNail ? (opts.nailSpec ?? NAIL_LOOK.nailSpec) : isHand ? 2.2 : 0.0 },
      uIndirectScale: { value: isHand ? 1.0 : (opts.faceFill ?? 0.22) },
      uDesat: { value: 0.0 }, uFillTint: fillTint, uFillDir: fillDir,
    };
    if (isNail) { m.defines = { ...(m.defines || {}), AG_NAIL_PLATE: '' }; U.uNailTone = nailTone; }
    if (!isHand) {          // fix round 2: the bare forearm / wrist strip of the body skin gets the hand look (vArmW)
      m.defines = { ...(m.defines || {}), AG_BODY_SKIN: '' };
      Object.assign(U, { uArmEnv: { value: HAND_LOOK.handEnv }, uArmDesat: { value: HAND_LOOK.handDesat }, uArmScatter: { value: 1.2 * HAND_LOOK.handScatter },
        uArmMatch: { value: opts.armMatch ?? BODY_LOOK.armMatch }, uArmTone: { value: new THREE.Vector3(...(opts.armTone || BODY_LOOK.armTone)) },
        uArmRough: { value: opts.armRough ?? -1 } });       // armRough < 0 = the hand set's roughness structure (cycle 3 r2)
      m.userData.bodySkin = true;
    }
    // sub-texel skin relief on the hands (texel density of the hand set: assets/pianist/README.md); cycle 3 r2: also on the body
    // skin's wrist strip (x vArmW): body map 2048 px over 2677 mm per UV unit at the forearm (sandbox/pianist/scratch/uvdens.mjs)
    const MU = { uMicroMm: { value: microMm(THREE, src.normalMap, isHand ? (opts.handTexelsPerMm ?? 9.0) : (opts.bodyTexelsPerMm ?? 0.765)) },
      uMicroAmp: { value: 0.006 * (opts.skinMicro ?? 1) }, uTwillPitch: { value: 1 } };    // fix round 1: 0.008 -> 0.006 (orange-peel)
    U.uMicroMm = MU.uMicroMm; U.uMicroAmp = MU.uMicroAmp;
    m.userData.uniforms = U;
    if (isHand) { m.userData.envBoost = true; m.userData.baseEnv = 1.0; }      // per-shot handEnv (env fill on the hands)
    // cycle 2 look-dev (thumb 'cut' strokes hunt): per-frame channel switches handNormalScale / handAO / skinMicroAmp (x base)
    m.userData.baseNormalScale = m.normalScale.clone(); m.userData.baseAO = m.aoMapIntensity; m.userData.baseMicro = MU.uMicroAmp.value;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float _thick;\nvarying float vThick;' + (isHand ? '\nattribute float _thumb;\nvarying float vThumbW;' : '\nattribute float _arm;\nvarying float vArmW;'))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvThick = _thick;' + (isHand ? '\nvThumbW = _thumb;' : '\nvArmW = _arm;'));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + SKIN_PARS)
        .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + SKIN_RE_DIRECT)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + SKIN_AFTER_AO);
      // cycle 2 (critic c2r1 / I-36: thin dark 'cut' strokes on the thumb / thenar in S06 / S24; the c2a A/B showed they are
      // in the ORM AO only - deep palmar crease cavities clamped at 0.55): the hand AO is floored at handAOFloor (0.78; the
      // dorsal knuckle-wrinkle AO is ~0.81+ and keeps its full strength)
      if (isHand) {
        U.uAOFloor = aoFloor;
        sh.uniforms.uAOFloor = aoFloor; sh.uniforms.uAOFloorThumb = aoFloorThumb;
        // cycle 2 round 2 (critic c2r2: only 0.013 % of the AO texels are below 0.78, the thumb strokes stayed): the thumb
        // (skin weight of finger1-*, '_thumb') is floored at handAOFloorThumb (0.93)
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uAOFloor;\nuniform float uAOFloorThumb;\nvarying float vThumbW;')
          .replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'max( texture2D( aoMap, vAoMapUv ).r, mix( uAOFloor, uAOFloorThumb, clamp( vThumbW, 0.0, 1.0 ) ) )'));
      }
      if (isHand) addKey(sh, key, rimGain.rimHand, isNail ? null : key.rimEdge);
      else {
        // glow key + rim on the bare wrist strip only (x vArmW): the face / neck / ears keep no key (BRIEF: face dark)
        addKey(sh, key, rimGain.rimHand, key.rimEdge);
        sh.fragmentShader = sh.fragmentShader.replace('* envMapIntensity * uKeyOmega;', '* envMapIntensity * uKeyOmega * vArmW;')
          .replace('rimLight.color = uRimColor * uRimGain;', 'rimLight.color = uRimColor * uRimGain * vArmW;');
      }
      if (kind === 'body') {
        // cycle 3 r2: the wrist strip gets the hands' micro relief / terminator softening and skinTone, weighted by vArmW (face,
        // neck and ears unchanged: their weight is 0); MICRO_PARS also serves the strip's roughness structure below
        addMicro(sh, MU, MICRO_SKIN.replace('normal = normalize( normal - tbn[ 0 ] * g.x - tbn[ 1 ] * g.y );', 'g *= vArmW;\n  normal = normalize( normal - tbn[ 0 ] * g.x - tbn[ 1 ] * g.y );')
          .replace('mix( 0.35, 1.0, smoothstep( 0.04, 0.3, term ) )', 'mix( 1.0, mix( 0.35, 1.0, smoothstep( 0.04, 0.3, term ) ), vArmW )'));
        MU.uSkinTone = skinTone; sh.uniforms.uSkinTone = skinTone;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSkinTone;').replace('#include <map_fragment>', `#include <map_fragment>
  #ifdef USE_MAP
  if ( uSkinTone > 0.0 && vArmW > 0.0 ) {
    vec2 mmA = vMapUv * uMicroMm;
    float fwA = max( length( dFdx( mmA ) ), length( dFdy( mmA ) ) ) + 1e-5;
    float t1 = ( agVN( mmA / 0.35 ) - 0.5 ) * ( 1.0 - smoothstep( 0.3, 0.7, fwA / 0.35 ) );
    float t2 = ( agVN( mmA / 1.2 + 5.0 ) - 0.5 ) * ( 1.0 - smoothstep( 0.3, 0.7, fwA / 1.2 ) );
    float t3 = agVN( mmA / 3.5 + 9.0 ) - 0.5;
    diffuseColor.rgb *= 1.0 + uSkinTone * vArmW * ( 0.14 * t1 + 0.14 * t2 );
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.05, 0.97, 0.96 ), clamp( uSkinTone * vArmW * t3 * 2.0, -1.0, 1.0 ) );
  }
  #endif`);
      }
      if (kind === 'hand' && (opts.skinMicro ?? 1) > 0) {
        addMicro(sh, MU, MICRO_SKIN);
        // cycle 3 (critic c3: the hand albedo has only 8 % of its energy below 4 texels, +-6 % tone overall -> 'smooth clay' at
        // 4K): procedural tone below / at the texel scale - pore and skin-line tone 0.35 mm, 1.2 mm mottle (+-3-4 %), a warm /
        // neutral 3.5 mm mottle; LOD-faded like the relief (per frame: skinTone, 0 = off)
        MU.uSkinTone = skinTone; sh.uniforms.uSkinTone = skinTone;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSkinTone;').replace('#include <map_fragment>', `#include <map_fragment>
  #ifdef USE_MAP
  if ( uSkinTone > 0.0 ) {
    vec2 mmA = vMapUv * uMicroMm;
    float fwA = max( length( dFdx( mmA ) ), length( dFdy( mmA ) ) ) + 1e-5;
    float t1 = ( agVN( mmA / 0.35 ) - 0.5 ) * ( 1.0 - smoothstep( 0.3, 0.7, fwA / 0.35 ) );
    float t2 = ( agVN( mmA / 1.2 + 5.0 ) - 0.5 ) * ( 1.0 - smoothstep( 0.3, 0.7, fwA / 1.2 ) );
    float t3 = agVN( mmA / 3.5 + 9.0 ) - 0.5;
    diffuseColor.rgb *= 1.0 + uSkinTone * ( 0.14 * t1 + 0.14 * t2 );
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.05, 0.97, 0.96 ), clamp( uSkinTone * t3 * 2.0, -1.0, 1.0 ) );
  }
  #endif`);
      }
      // cycle 2 (critic c2r1: a lighter, cooler rectangular patch on the bare wrist beside the cuff, 4K S06 rgb (181,116,106)
      // vs the hand next to it (173,106,93)): the body albedo on the arm strip is pulled to the hand texture's tone
      // cycle 3 (critic c3: the strip is still a lighter rectangle, S06 row 530 steps 38-44 -> 48 at the seam; it has no hand AO,
      // no hand hair and a smoother, glossier surface): uArmMatch scales the strip's albedo (per frame: armMatch)
      // cycle 3 r2: armTone = measured hand / body albedo ratio at the seam (BODY_LOOK; per frame armTone, armMatch)
      if (!isHand) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uArmMatch;\nuniform vec3 uArmTone;\nuniform float uArmRough;').replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb *= mix( vec3( 1.0 ), uArmMatch * uArmTone, vArmW );`)
        // cycle 3: the hand set's roughness is ~0.5 (module structure 0.3-0.62); the strip's constant 0.42 made its sky-facing top
        // a glossier, lighter rectangle beside the cuff (seam normals are continuous: sandbox/pianist/scratch/seamcheck.mjs)
        // cycle 3 r2: the hands' own formula at the wrist (AO ~0.99 and thickness ~37 mm there: 0.5 + 0.12 (mottle - 0.5)), in mm
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
 #ifdef USE_NORMALMAP_TANGENTSPACE
 {
   vec2 rqA = vNormalMapUv * uMicroMm;
   float mottA = agVN( rqA / 4.0 ) * 0.65 + agVN( rqA / 1.6 + 7.0 ) * 0.35;
   roughnessFactor = mix( roughnessFactor, uArmRough < 0.0 ? clamp( 0.5 + 0.3 * ( mottA - 0.5 ), 0.3, 0.62 ) : uArmRough, vArmW );
 }
 #else
 roughnessFactor = mix( roughnessFactor, uArmRough < 0.0 ? 0.5 : uArmRough, vArmW );
 #endif`);
      // cycle 2 (critic c2r1: nails = pale lavender press-on plates with an opaque white 'French tip'): the plate is ~30 %
      // darker and pinker (the bed shows through), the bright free-edge paint is pulled to a warm translucent ivory
      // cycle 3 (critic c3: S20b thumb plate Lab 23.9 / 24.0 / 5.7 = 2.6x the finger skin's L*, hue 13 deg magenta; refs 1.5x,
      // 20-26 deg): uNailTone = [plate (bed) tone, free-edge tone] per frame (nailTone), default darker and warmer
      if (isNail) {
        U.uNailTone = nailTone;
        sh.uniforms.uNailTone = nailTone;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uNailTone[ 2 ];').replace('#include <map_fragment>', `#include <map_fragment>
  {
    float agL = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    diffuseColor.rgb *= mix( uNailTone[ 0 ], uNailTone[ 1 ], smoothstep( 0.35, 0.65, agL ) );
  }`);
      }
      if (isHand) {
        // ORM.b = nail plate mask: keratin is glossier and more specular than skin
        // nail plate mesh: the whole plate is keratin (its tucked edges hide under the folds); roughness from the map is
        // clamped to the nail range so a texel of skin paint at the plate rim never turns matte
        sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n#ifdef AG_NAIL_PLATE\n float nailMask = 1.0; roughnessFactor = clamp( roughnessFactor + 0.08, 0.28, 0.40 );\n#elif defined( USE_ROUGHNESSMAP )\n float nailMask = texture2D( roughnessMap, vRoughnessMapUv ).b;\n' +
          // fix round 2 (critic r2: ORM.g = 118/255 on 62 % of the texels -> a constant ~0.39): roughness structure in the
          // module until the maps carry it - creases (AO) rougher, fingers / tips (thin, vThick) oilier, a 2-6 mm mottle
          ((opts.skinRoughVar ?? 1) > 0 && kind === 'hand' && (opts.skinMicro ?? 1) > 0 ? ` {
   float aoR = 1.0;
   #ifdef USE_AOMAP
   aoR = texture2D( aoMap, vAoMapUv ).r;
   #endif
   vec2 rq = vRoughnessMapUv * vec2( 6144.0, 3072.0 ) / 9.0;      // mm (hand set: 9 texel/mm)
   float mott = agVN( rq / 4.0 ) * 0.65 + agVN( rq / 1.6 + 7.0 ) * 0.35;
   float fingers = smoothstep( 0.022, 0.012, vThick );
   roughnessFactor = clamp( 0.5 + 0.3 * ( mott - 0.5 ) + 0.16 * ( 1.0 - aoR ) - 0.13 * fingers, 0.3, 0.62 ) * mix( 1.0, 0.85, nailMask );
 }\n` : '') +
          '#else\n float nailMask = 0.0;\n#endif')
          .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.specularColor *= ( 1.0 + uNailSpec * nailMask );');
      }
    };
    m.customProgramCacheKey = () => 'afterglow-skin-' + kind;
    return m;
  }
  function hairMaterial(src) {
    const isBeard = /beard/.test(src.name);
    const m = new THREE.MeshPhysicalMaterial({
      name: src.name + '.film', vertexColors: true, color: new THREE.Color(0.75, 0.78, 0.82), roughness: 0.36, metalness: 0,
      // anisotropy direction = the 'tangent' attribute = the strand direction (strandTangents below; rotation 0): the highlight
      // stretches across the strand. Without that attribute three derives the frame from screen-space UV derivatives, which
      // degenerate on pixel-thin ribbons and produced bright specular fireflies in backlit hair.
      anisotropy: opts.hairAniso ?? 0.85, anisotropyRotation: 0,
      specularIntensity: opts.hairSpec ?? 0.6, side: THREE.DoubleSide,
      sheen: opts.hairSheen ?? 0.3, sheenColor: new THREE.Color(0.12, 0.08, 0.06), sheenRoughness: 0.35,
    });
    const U = { uSeed: seed, uStrat: strat, uHairAlpha: { value: opts.hairAlpha ?? (isBeard ? 0.95 : 1.0) }, uFwdColor: { value: new THREE.Color(...(opts.hairFwdColor || [0.85, 0.6, 0.44])) },
      uFwdStrength: { value: opts.hairForward ?? 1.0 }, uHairLag: hairLag, uLagScale: { value: isBeard ? 0.25 : 1.0 },
      uHairDesat: { value: opts.hairDesat ?? BODY_LOOK.hairDesat }, uHairFill: { value: opts.hairFill ?? BODY_LOOK.hairFill },
      uNapeFade: { value: isBeard ? 0 : (opts.napeFade ?? 0) } };
    m.userData.uniforms = U;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      addKey(sh, key, rimGain.rimHair);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float _outer;\nvarying vec3 vObjPos;\nvarying float vOuter;\nuniform vec3 uHairLag;\nuniform float uLagScale;\nattribute float _nape;\nvarying float vNape;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvOuter = _outer;\nvNape = _nape;')
        // secondary motion (fix round 1, critic1:motion): the spring lag of the hair mass behind the head (object space,
        // per sub-frame, a pure function of t), weighted toward the strand tips and the outer curls
        .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += uHairLag * ( uLagScale * uv.y * uv.y * ( 0.3 + 0.7 * _outer ) );');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + HAIR_PARS + 'varying float vOuter;\nuniform float uHairDesat;\nuniform float uHairFill;\nvarying float vNape;\nuniform float uNapeFade;\n' + (glsl ? hashedAlphaChunk(glsl) : ''))
        .replace('#include <alphatest_fragment>', `
          {
            // strand coverage: soft across the ribbon (uv.x), tapering to the tip (uv.y). STRATIFIED hashed alpha: a per-frame
            // hash per object-space cell (0.24 mm; decorrelates overlapping strand layers, a per-pixel hash would make them
            // occlude like one layer) plus (k + 0.5) / N per sub-frame, so each cell passes in round(a N) of the N sub-frames
            // fix round 2b (critic r2: S16 hair zone opacity 0.84 vs ref 9 0.94, wiry 1-px curls): fuller ribbons, less tip taper
            float across = 1.0 - smoothstep( 0.33, 0.5, abs( vUv.x - 0.5 ) );
            float along = 1.0 - smoothstep( 0.78, 1.0, vUv.y );
            float a = uHairAlpha * across * mix( 0.5, 1.0, along ) * ( 1.0 - uNapeFade * vNape );    // cycle 3 r2: strands lying on the nape skin
            ${glsl ? 'if ( a < fract( hashedAlphaThreshold( vObjPos, uint( uSeed ) ) + uStrat ) ) discard;' : 'if ( a < 0.5 ) discard;'}
          }`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          {
            // inside the hair mass little sky reaches a strand (no hair self-shadowing in three): darken by depth
            float occ = mix( 0.22, 1.0, vOuter );
            // cycle 2 (lead: S02 over-the-shoulder hair read reddish-brown): the sky fill on the hair x hairFill (near-black
            // brown); the glow rim (direct) and the forward-scattered fringe below keep their strength
            reflectedLight.indirectDiffuse *= occ * uHairFill; reflectedLight.indirectSpecular *= mix( 0.3, 1.0, vOuter );
            reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.8 );
            reflectedLight.directDiffuse *= occ; reflectedLight.directSpecular *= mix( 0.3, 1.0, vOuter );
            // forward scattering through backlit outer strands (Marschner TT, collapsed): the bright sky behind the hair,
            // strongest looking toward the glow, only on the fringe of the mass (rim curls)
            #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
              vec3 behind = getIBLIrradiance( -geometryViewDir );
              float toward = pow( saturate( dot( -geometryViewDir, uKeyDirView ) ), 3.0 );
              float ndv = abs( dot( geometryNormal, geometryViewDir ) );
              float fringe = vOuter * vOuter;
              // TT through the fibre is tinted by the melanin (diffuseColor), the grazing R lobe is not: half and half keeps the
              // rim warm-golden instead of reading as red hair
              vec3 fwdTint = 0.5 * diffuseColor.rgb * 6.0 + 0.5 * vec3( 0.12 );
              reflectedLight.indirectDiffuse += uFwdStrength * uFwdColor * fwdTint * behind * fringe * mix( 0.15, 1.0, toward ) * mix( 0.4, 1.0, 1.0 - ndv ) * RECIPROCAL_PI;
            #endif
            // fix round 2: brown-black, not red-black (sky fill + forward scatter partly desaturated)
            reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uHairDesat );
          }`);
    };
    m.customProgramCacheKey = () => 'afterglow-hair';
    m.defines = { ...(m.defines || {}), USE_UV: '' };
    return m;
  }
  // per-vertex 'outerness' of hair / beard (0 = at the scalp inside the mass, 1 = outer fringe): radial distance from the
  // scalp-cap centre (hair) or position along the strand (beard). Computed once at load from the bind positions.
  function hairOuterness(o, capCentre, r0, r1) {
    const P = o.geometry.attributes.position, UVa = o.geometry.attributes.uv, n = P.count;
    const out = new Float32Array(n); const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const along = UVa ? UVa.getY(i) : 1;
      if (capCentre) { v.fromBufferAttribute(P, i); const r = v.distanceTo(capCentre); out[i] = Math.min(1, Math.max(0, (r - r0) / (r1 - r0))) * 0.8 + 0.2 * along; }
      else out[i] = 0.25 + 0.75 * along;
    }
    o.geometry.setAttribute('_outer', new THREE.BufferAttribute(out, 1));
  }
  // per-vertex strand direction (the direction in which uv.y = root -> tip grows, accumulated over the vertex's triangles),
  // as a glTF-style tangent (w = 1) for the anisotropic highlight
  function strandTangents(o) {
    const G = o.geometry, P = G.attributes.position, UVa = G.attributes.uv; if (!UVa) return;
    const n = P.count, T = new Float32Array(n * 4), idx = G.index ? G.index.array : null;
    const tri = idx ? idx.length / 3 : n / 3; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx[3 * t] : 3 * t, i1 = idx ? idx[3 * t + 1] : 3 * t + 1, i2 = idx ? idx[3 * t + 2] : 3 * t + 2;
      a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1).sub(a); c.fromBufferAttribute(P, i2).sub(a);
      const du1 = UVa.getX(i1) - UVa.getX(i0), dv1 = UVa.getY(i1) - UVa.getY(i0), du2 = UVa.getX(i2) - UVa.getX(i0), dv2 = UVa.getY(i2) - UVa.getY(i0);
      const det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
      // d(position)/d(v) = (du1 * e2 - du2 * e1) / det
      const r = 1 / det, gx = (du1 * c.x - du2 * b.x) * r, gy = (du1 * c.y - du2 * b.y) * r, gz = (du1 * c.z - du2 * b.z) * r;
      for (const i of [i0, i1, i2]) { T[4 * i] += gx; T[4 * i + 1] += gy; T[4 * i + 2] += gz; }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(T[4 * i], T[4 * i + 1], T[4 * i + 2]);
      if (l > 1e-12) { T[4 * i] /= l; T[4 * i + 1] /= l; T[4 * i + 2] /= l; } else { T[4 * i] = 1; }
      T[4 * i + 3] = 1;
    }
    G.setAttribute('tangent', new THREE.BufferAttribute(T, 4));
  }
  function suitMaterial(src, lining) {
    const m = new THREE.MeshPhysicalMaterial({
      name: src.name + '.film', map: lining ? null : src.map, normalMap: lining ? null : src.normalMap,
      // lining: dark bordeaux viscose satin (glossier than the wool), so the 1-2 mm of it inside the sleeve hem and the
      // jacket vents reads as lining (USER_FEEDBACK 2: "a hint of lining") instead of more black wool
      normalScale: (!lining && src.normalScale) ? src.normalScale.clone().multiplyScalar(opts.suitNormalScale ?? 1) : new THREE.Vector2(1, 1),
      color: lining ? new THREE.Color(...(opts.liningColor || [0.055, 0.012, 0.02])) : new THREE.Color(1, 1, 1).multiplyScalar(opts.woolAlbedo ?? WOOL_LOOK.woolAlbedo),
      // cycle 2 round 2 (critic c2r2: a glossy lilac-grey 'crumpled foil' lump inside the sleeve opening above the cuff, L p50
      // 24 vs the wool 0.4): the lining sits in the shadow of the sleeve tube -> matte (0.32 -> 0.6) and a weak specular (0.7 -> 0.25)
      roughness: lining ? (opts.liningRough ?? 0.6) : 0.92, metalness: 0, specularIntensity: lining ? (opts.liningSpec ?? 0.08) : 0.18,   // cycle 3: 0.25 -> 0.08 (critic c3: grey-blue sky-lit 'slab' / lump at the sleeve end, B/R 1.31)
      // fix round 2: neutral wool sheen 0.035 -> woolSheen (critic r2: the suit was crushed to a featureless violet black)
      sheen: 1.0, sheenColor: lining ? new THREE.Color(0.025, 0.008, 0.012) : new THREE.Color(1, 1, 1.03).multiplyScalar(opts.woolSheen ?? WOOL_LOOK.woolSheen), sheenRoughness: lining ? 0.4 : 0.75,
      side: THREE.FrontSide,
    });
    if (lining) m.userData.lining = true;
    if (!lining) {
      // worsted 2/2 twill below the 2.1 texel/mm suit normal map (pitch 0.85 mm, 0.06 mm deep; LOD-faded)
      const MU = { uMicroMm: { value: microMm(THREE, src.normalMap, opts.suitTexelsPerMm ?? 2.1) },
        uMicroAmp: { value: 0.06 * (opts.twill ?? 1) }, uTwillPitch: { value: opts.twillPitch ?? 0.85 } };
      // button discs (pack.mjs -> material extras): the fuzz shells skip them (uBtn); with the 3-D buttons of tailoring.js
      // the disc itself stays wool (uBtnHorn off), else it is shaded as glossy dark horn (old assets)
      const btn = ((src.userData && src.userData.buttons) || []).slice(0, 4);
      MU.uBtn = { value: [0, 1, 2, 3].map((i) => (btn[i] ? new THREE.Vector4(btn[i].c[0], btn[i].c[1], btn[i].r[0], btn[i].r[1]) : new THREE.Vector4(-9, -9, 1e-3, 1e-3))) };
      MU.uBtnHorn = { value: tailor && tailor.info.buttons ? [0, 1, 2, 3].map(() => new THREE.Vector4(-9, -9, 1e-3, 1e-3)) : MU.uBtn.value };
      MU.uBtnColor = { value: new THREE.Color(...(opts.buttonColor || [0.03, 0.022, 0.018])) };
      if (tailor) { MU.uSlvBtn = { value: tailor.uBtn }; MU.uSlvVent = { value: tailor.vent }; }
      MU.uWoolDesat = { value: opts.woolDesat ?? WOOL_LOOK.woolDesat };
      MU.uWoolFace = { value: (opts.woolFace ?? WOOL_LOOK.woolFace) / (opts.woolAlbedo ?? WOOL_LOOK.woolAlbedo) };
      MU.uWoolPow = { value: opts.woolGrazePow ?? WOOL_LOOK.woolGrazePow };
      MU.uWoolFaceSide = { value: (opts.woolFaceSide ?? WOOL_LOOK.woolFaceSide) / (opts.woolAlbedo ?? WOOL_LOOK.woolAlbedo) };
      m.userData.uniforms = MU; m.userData.wool = true;     // woolAlbedo / woolSheen / woolFace also per frame (beforeFrame)
      m.onBeforeCompile = (sh) => {
        addKey(sh, key, rimGain.rimWool);
        Object.assign(sh.uniforms, { uBtn: MU.uBtnHorn, uBtnColor: MU.uBtnColor, uWoolDesat: MU.uWoolDesat, uWoolFace: MU.uWoolFace, uWoolPow: MU.uWoolPow, uWoolFaceSide: MU.uWoolFaceSide });
        // fix round 2: the violet sky fill / sheen on black wool reads neutral dark grey (refs 7 / 8 / 12: sat 0.2-0.46)
        // cycle 2 (I-41): the albedo lift only at grazing view (silhouette / rim side of the sleeves), face-on wool stays black;
        // the turned hem (last 6-14 mm of the sleeve) stays at the face-on albedo (pale fuzzy band next to the cuff)
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uWoolDesat;\nuniform float uWoolFace;\nuniform float uWoolPow;\nuniform float uWoolFaceSide;')
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    const vec3 W709 = vec3( 0.2126, 0.7152, 0.0722 );
    reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, W709 ) ), uWoolDesat );
    reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, vec3( dot( reflectedLight.indirectSpecular, W709 ) ), 0.5 * uWoolDesat );
    #ifdef USE_SHEEN
    sheenSpecularIndirect = mix( sheenSpecularIndirect, vec3( dot( sheenSpecularIndirect, W709 ) ), uWoolDesat );
    #endif
    float agG = pow( 1.0 - saturate( dot( nonPerturbedNormal, geometryViewDir ) ), uWoolPow );
    // cycle 2 round 2 (critic c2r2: S04 sleeve p50 0.3-0.7 vs ref 7 2.4, crushed black; S02 back must stay <= 8): the face-on
    // factor depends on the world facing - sky-facing wool (back, shoulders, sleeve tops) keeps woolFace, side / down-facing
    // wool (sleeve sides, torso front, folds turned away from the sky) gets woolFaceSide
    float agUp = smoothstep( 0.25, 0.7, inverseTransformDirection( nonPerturbedNormal, viewMatrix ).y );
    float agA = mix( mix( uWoolFaceSide, uWoolFace, agUp ), 1.0, agG );
    ${tailor ? 'if ( vSleeve.z > 0.5 ) agA = mix( uWoolFace, agA, min( smoothstep( 6.0, 14.0, vSleeve.x ), agHemK ) );' : ''}
    agA = mix( agA, 1.0, agShirt );      // cycle 3 r2: white shirt-front texels keep their own albedo
    reflectedLight.indirectDiffuse *= agA; reflectedLight.directDiffuse *= agA;
    ${tailor ? `// cycle 3 r2: inner face of the sleeve tube near the hem ('slab'): in the tube's shadow, like the lining (slabDark)
    if ( vSleeve.z > 0.5 ) {
      float agIn = smoothstep( 0.12, 0.5, vSlvIn ) * ( 1.0 - smoothstep( 30.0, 45.0, vSleeve.x ) );
      // + the sleeve's end face / hem roll (c3r2a: the slab box stayed at p50 13.0 - it is the 4-5 mm hem end seen face-on, sky lit)
      agIn = max( agIn, 1.0 - smoothstep( uSlabMm.x, uSlabMm.y, vSleeve.x ) );
      float agK = mix( 1.0, uSlabDark, agIn );
      reflectedLight.indirectDiffuse *= agK; reflectedLight.directDiffuse *= agK; reflectedLight.indirectSpecular *= agK; reflectedLight.directSpecular *= agK;
      #ifdef USE_SHEEN
      sheenSpecularIndirect *= agK; sheenSpecularDirect *= agK;
      #endif
    }` : ''}
  }`);
        if (tailor) {
          // sleeve-end tailoring (tailoring.js): vent edge, pick stitches, buttonholes, turned hem; silk thread is glossier
          Object.assign(sh.uniforms, { uSlvBtn: MU.uSlvBtn, uSlvVent: MU.uSlvVent });
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec4 _sleeve;\nvarying vec4 vSleeve;\nattribute float _slvIn;\nvarying float vSlvIn;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSleeve = _sleeve;\nvSlvIn = _slvIn;');
          sh.uniforms.uSlabDark = slabDark; sh.uniforms.uSlabMm = slabMm;
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSlvIn;\nuniform float uSlabDark;\nuniform vec2 uSlabMm;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\n' + TAILOR_COMMON + SLEEVE_PARS)
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SLEEVE_NORMAL)
            .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.roughness = mix( material.roughness, 0.42, agThread );\n material.specularColor = mix( material.specularColor, vec3( 0.05 ), agThread );\n#ifdef USE_SHEEN\n material.sheenColor *= 1.0 - 0.7 * agThread;\n#endif'
              // cycle 3 (critic c3: a faceted grey 'crumpled foil' lump at the top of the sleeve hem beside the cuff, S06 box p50 25
              // vs wool 0.7, and a grey-blue slab between sleeve and cuff; the c3a hideMesh A/B showed both are the suit OUTER shell,
              // not lining / fuzz / caps): the crumpled hem edge is seen at grazing angles, where the wool gets its grazing albedo,
              // sheen and glow rim -> in the last ~20 mm of the sleeve those three fade out (uHemDark = sleeve s mm [start, end])
              + '\n agHemK = vSleeve.z > 0.5 ? smoothstep( uHemDark.x, uHemDark.y, vSleeve.x ) : 1.0;\n#ifdef USE_SHEEN\n material.sheenColor *= mix( 0.12, 1.0, agHemK );\n#endif')
            .replace('#include <common>', '#include <common>\nfloat agHemK = 1.0;\nuniform vec2 uHemDark;')
            .replace('rimLight.color = uRimColor * uRimGain;', 'rimLight.color = uRimColor * uRimGain * mix( 0.15, 1.0, agHemK );');
          sh.uniforms.uHemDark = hemDark;
        }
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec4 uBtn[ 4 ];\nuniform vec3 uBtnColor;\nfloat agShirt = 0.0;\nuniform float uTieOn;\nuniform vec3 uTieColor;')
          .replace('#include <map_fragment>', `#include <map_fragment>
  float agBtn = 0.0;
  #ifdef USE_MAP
  for ( int i = 0; i < 4; i ++ ) { float r = length( ( vMapUv - uBtn[ i ].xy ) / uBtn[ i ].zw ); agBtn = max( agBtn, 1.0 - smoothstep( 0.97, 1.02, r ) ); }
  diffuseColor.rgb = mix( diffuseColor.rgb, uBtnColor, agBtn );
  // cycle 3 r2 (critic c3r2: a bold zebra-stripe tie is the highest-contrast element of the S02 / S04 / S09 fallboard
  // reflection; the shirt front reads as grainy sandpaper): the atlas tie (texel polygon, suit_nearblack_pinstripe 2048^2)
  // is a solid dark navy; the white shirt-front texels keep their own albedo (no x woolAlbedo lift, no twill, less sheen)
  {
    const vec2 TP[ 9 ] = vec2[ 9 ]( vec2( 780.0, 165.0 ), vec2( 842.0, 170.0 ), vec2( 842.0, 215.0 ), vec2( 830.0, 245.0 ), vec2( 800.0, 315.0 ),
      vec2( 742.0, 380.0 ), vec2( 730.0, 375.0 ), vec2( 755.0, 265.0 ), vec2( 777.0, 205.0 ) );
    vec2 tq = vMapUv * 2048.0; bool inTie = false;
    if ( uTieOn > 0.5 && tq.x > 725.0 && tq.x < 846.0 && tq.y > 160.0 && tq.y < 385.0 ) {
      for ( int i = 0; i < 9; i ++ ) { int j = i == 0 ? 8 : i - 1;
        if ( ( ( TP[ i ].y > tq.y ) != ( TP[ j ].y > tq.y ) ) && ( tq.x < ( TP[ j ].x - TP[ i ].x ) * ( tq.y - TP[ i ].y ) / ( TP[ j ].y - TP[ i ].y ) + TP[ i ].x ) ) inTie = ! inTie;
      }
    }
    agShirt = uTieOn > 0.5 ? smoothstep( 0.2, 0.4, dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * ( 1.0 - agBtn ) : 0.0;
    if ( inTie ) { diffuseColor.rgb = uTieColor * diffuse; agShirt = 0.0; }
    diffuseColor.rgb = mix( diffuseColor.rgb, sampledDiffuseColor.rgb * 0.85, agShirt );
  }
  #endif`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix( roughnessFactor, 0.28, agBtn );')
          .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.specularColor = mix( material.specularColor, vec3( 0.045 ), agBtn );\n#ifdef USE_SHEEN\n material.sheenColor *= ( 1.0 - agBtn ) * ( 1.0 - 0.8 * agShirt );\n#endif');
        sh.uniforms.uTieOn = { value: (opts.tieSolid ?? 1) > 0 ? 1 : 0 }; sh.uniforms.uTieColor = { value: new THREE.Vector3(...(opts.tieColor || [0.011, 0.012, 0.026])) };
        if ((opts.twill ?? 1) > 0) addMicro(sh, MU, MICRO_TWILL.replace('* ( uMicroAmp * fade )', '* ( uMicroAmp * fade * ( 1.0 - agBtn ) * ( 1.0 - agShirt ) )'));
      };
      m.customProgramCacheKey = () => 'afterglow-wool' + ((opts.twill ?? 1) > 0 ? '-twill' : '') + (tailor ? '-tailor' : '');
    }
    return m;
  }
  function replace(o) {
    const src = o.material; if (!src) return;
    if (/cap/.test(o.name)) {     // dark shells under the strands: opaque (their UVs are empty, the strand alpha would drop them)
      // the shell is the deep interior of the hair mass (where it shows between curls little sky reaches it): very dark,
      // matte, its light scaled by the same occlusion the innermost strands get, so gaps read as shadowed hair, not a dome
      if (!made.has('cap')) {
        const cm = new THREE.MeshPhysicalMaterial({ name: 'cap.film', vertexColors: true, color: new THREE.Color(0.55, 0.5, 0.48), roughness: 0.9, specularIntensity: 0.2 });
        cm.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= 0.18; reflectedLight.directDiffuse *= 0.18; reflectedLight.indirectSpecular *= 0.1; reflectedLight.directSpecular *= 0.1;'); };
        cm.customProgramCacheKey = () => 'afterglow-hair-cap';
        made.set('cap', cm);
      }
      o.material = made.get('cap'); return;
    }
    const isCuff = /shirt_cuff/.test(o.name || '');
    const cuffSide = isCuff ? (/_?L$/.test(o.name) ? 'L' : 'R') : null;      // cycle 2: one material per cuff (own hem plane)
    const key = src.name + '|' + (o.geometry.attributes.color ? 'c' : '') + (isCuff ? '|cuff' + cuffSide : '');
    if (made.has(key)) { o.material = made.get(key); return; }
    let m = null; const n = src.name || '';
    if (n === 'pianist_skin') m = skinMaterial(src, 'body');
    else if (opts.debugHandMask && /pianist_(skin_hand|nail)/.test(n)) m = new THREE.MeshBasicMaterial({ name: 'handmask', color: 0x00ff00 });   // measurement mask only
    else if (n === 'pianist_skin_hand') m = skinMaterial(src, 'hand');
    else if (n === 'pianist_nail') m = skinMaterial(src, 'nail');
    else if (/pianist_(hair|beard)/.test(n)) m = hairMaterial(src);
    else if (n === 'pianist_suit') m = opts.debugSuitNormals ? new THREE.MeshNormalMaterial({ normalMap: src.normalMap, normalScale: src.normalScale?.clone() }) : suitMaterial(src, false);
    else if (n === 'pianist_lining') m = suitMaterial(src, true);
    else if (n === 'pianist_sock') m = new THREE.MeshPhysicalMaterial({ name: 'sock.film', color: new THREE.Color(0.012, 0.012, 0.014), roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0.03, 0.03, 0.035), sheenRoughness: 0.7 });
    else if (n === 'pianist_shirt') {
      m = new THREE.MeshPhysicalMaterial({ name: 'shirt.film', color: isCuff ? new THREE.Color(0.84, 0.84, 0.82) : new THREE.Color(0.78, 0.78, 0.76), roughness: 0.78, sheen: 0.6, sheenColor: new THREE.Color(0.5, 0.5, 0.5), sheenRoughness: 0.6 });
      // fix round 2 (critic r2: the cuff read as a dull lavender-blue tube, L 19-29 sat 0.5-0.62; ref 8 L 114 sat 0.40):
      // cuffs get a fill boost + desaturation of the violet sky fill (crisp white), and a contact shadow on the inner wall
      // where the cuff meets the wrist. The shirt body keeps its look.
      const SU = isCuff ? { ...shirtU, uHem: hemPlane[cuffSide], uHemShadow: shirtU.uHemShadow } : null;
      if (SU) m.userData.uniforms = SU;
      m.onBeforeCompile = (sh) => {
        addKey(sh, glowKey, rimGain.rimShirt);     // ('key' is shadowed in replace())
        if (SU) {
          Object.assign(sh.uniforms, SU);
          // cycle 2: world position after skinning for the sleeve-hem shadow line (hem plane per sub-frame, world space)
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec3 _cuffX;\nvarying vec3 vCuffX;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCuffX = _cuffX;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uShirtFill;\nuniform float uShirtDesat;\nuniform vec3 uShirtTint;\nuniform vec3 uShirtTintSky;\nuniform float uHemShadow;\nuniform vec3 uHemLine;\nuniform float uCuffXOn;\nvarying vec3 vCuffX;')
            .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    const vec3 W709 = vec3( 0.2126, 0.7152, 0.0722 );
    // cycle 2 round 2: d = mm past the LOCAL sleeve hem (per angle, per sub-frame, pianist.js updateCuffHemD). Under the
    // sleeve the cuff is dark (the jacket hides the sky), a thin contact line right below the hem (uHemLine.x at the hem,
    // back to 1 over uHemLine.y mm), the cuff's inner face (between cuff and wrist) darkens with depth from the edge to
    // uHemLine.z; the rolled rim (e < 0.8 mm) stays lit (the thin end-on ring)
    float agD = vCuffX.x, agOut = vCuffX.y, agE = vCuffX.z;
    float contact = agD < 0.0 ? mix( 0.08, uHemLine.x, smoothstep( -5.0, 0.0, agD ) ) : mix( uHemLine.x, 1.0, smoothstep( 0.0, uHemLine.y, agD ) );
    contact *= mix( 1.0, mix( 1.0, uHemLine.z, smoothstep( 0.8, 3.5, agE ) ), 1.0 - agOut );
    if ( uCuffXOn < 0.5 ) contact = 1.0;
    // sky-facing side cool white (ref 8 B/R 1.38), the rest the warm bounce tint
    vec3 agWN = inverseTransformDirection( normal, viewMatrix );
    vec3 agTint = mix( uShirtTint, uShirtTintSky, smoothstep( -0.15, 0.75, agWN.y ) );
    reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, W709 ) ) * agTint, uShirtDesat ) * uShirtFill * contact;
    reflectedLight.directDiffuse *= contact;
    reflectedLight.indirectSpecular *= contact; reflectedLight.directSpecular *= contact;
    #ifdef USE_SHEEN
    sheenSpecularIndirect = mix( sheenSpecularIndirect, vec3( dot( sheenSpecularIndirect, W709 ) ), uShirtDesat ) * contact;
    #endif
    if ( uHemShadow < 0.0 ) {     // look-dev: hem-plane debug (red = behind the hem plane, green 1-mm bands past it)
      reflectedLight.directDiffuse = vec3( 0.0 ); reflectedLight.indirectSpecular = vec3( 0.0 ); reflectedLight.directSpecular = vec3( 0.0 );
      reflectedLight.indirectDiffuse = agD < 0.0 ? vec3( 0.5, 0.0, 0.0 ) : vec3( 0.0, 0.15 + 0.35 * step( 0.5, fract( agD ) ), 0.0 ) * ( agD < 10.0 ? 1.0 : 0.2 );
      #ifdef USE_SHEEN
      sheenSpecularIndirect = vec3( 0.0 );
      #endif
    }
  }`);
        }
        if (tailor) {
          // cuff (tailoring.js): edge-stitch + topstitch rows, the overlap's free edge with its own row; cotton thread a bit glossier
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec3 _cuff;\nvarying vec3 vCuff;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCuff = _cuff;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\n' + TAILOR_COMMON + CUFF_PARS)
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + CUFF_NORMAL)
            // cycle 2 (critic c2r1: the stitch rows were invisible at 1080p): the stitch groove 12 % -> 35 % darker, the thread a
            // touch brighter than the cloth (catches the light as a dashed row)
            .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.roughness = mix( material.roughness, 0.55, agThread );\n material.diffuseColor *= ( 1.0 - 0.35 * agGroove ) * ( 1.0 + 0.08 * agThread );');
        }
      };
      m.customProgramCacheKey = () => 'afterglow-shirt' + (tailor ? '-tailor' : '') + (isCuff ? '-cuff' : '');
    }
    else if (n === 'pianist_shoes') m = new THREE.MeshPhysicalMaterial({ name: 'shoes.film', map: src.map, normalMap: src.normalMap, normalScale: src.normalScale?.clone(), roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.25 });
    else if (src.transparent || src.alphaTest > 0 || /eyebrow|eyelash/i.test(n)) {
      // brows / lashes: hashed alpha too (no sorting, deterministic accumulation)
      m = src.clone(); m.transparent = false; m.depthWrite = true; m.alphaTest = 0;
      const eyeDark = /eyebrow|eyelash/i.test(n) ? (opts.browDark ?? 0.4) : (opts.eyeDark ?? 0.15);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uSeed = seed; sh.uniforms.uStrat = strat;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSeed;\nuniform float uStrat;\nvarying vec3 vObjPos;\n' + (glsl ? hashedAlphaChunk(glsl) : ''))
          .replace('#include <alphatest_fragment>', glsl ? 'if ( diffuseColor.a < fract( hashedAlphaThreshold( vObjPos, uint( uSeed ) ) + uStrat ) ) discard;' : 'if ( diffuseColor.a < 0.5 ) discard;')
          // cycle 2 (critic c2r1: S16 'glowing eye' - a lit orange crescent in the otherwise dark backlit profile): eyes, brows
          // and lashes get the face's darkening (the face skin's sky fill is x faceFill 0.22; DESIGN 8: the face is never lit)
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= ${eyeDark.toFixed(3)}; reflectedLight.directDiffuse *= ${eyeDark.toFixed(3)};
  reflectedLight.indirectSpecular *= ${(eyeDark * 1.5).toFixed(3)}; reflectedLight.directSpecular *= ${(eyeDark * 1.5).toFixed(3)};`);
      };
      m.customProgramCacheKey = () => 'afterglow-hashed-' + n;
    }
    if (m) { made.set(key, m); o.material = m; }
  }
  for (const o of meshes) {          // the skin shader reads _THICK (p5); never let a missing attribute read as 0 mm
    if (/pianist_(skin|nail)/.test(o.material?.name || '') && !o.geometry.attributes._thick) {
      o.geometry.setAttribute('_thick', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count).fill(0.02), 1));
    }
    // cycle 2 round 2: '_thumb' on the hand skin = summed skin weight of the thumb bones (finger1-*), for the thumb AO floor
    if ((o.material?.name || '') === 'pianist_skin_hand' && !o.geometry.attributes._thumb) {
      const n = o.geometry.attributes.position.count, th = new Float32Array(n);
      const SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight, bl = o.skeleton ? o.skeleton.bones : [];
      const isT = bl.map((b) => /^finger1-/.test(b.name) ? 1 : 0);
      if (SI && SW) for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 4; k++) s += (isT[SI.getComponent(i, k)] || 0) * SW.getComponent(i, k); th[i] = Math.min(1, s); }
      o.geometry.setAttribute('_thumb', new THREE.BufferAttribute(th, 1));
    }
    // fix round 2: '_arm' on the body skin = summed skin weight of the forearm / wrist / hand bones (smooth by construction)
    if ((o.material?.name || '') === 'pianist_skin') {
      const n = o.geometry.attributes.position.count, arm = new Float32Array(n);
      const SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight, bl = o.skeleton ? o.skeleton.bones : [];
      const isArm = bl.map((b) => /^(lowerarm0[12]|wrist|finger|metacarpal)/.test(b.name) ? 1 : 0);
      if (SI && SW) for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 4; k++) s += (isArm[SI.getComponent(i, k)] || 0) * SW.getComponent(i, k); arm[i] = Math.min(1, s); }
      o.geometry.setAttribute('_arm', new THREE.BufferAttribute(arm, 1));
    }
  }
  {   // hair outerness (needs the scalp cap's bind positions)
    const cap = meshes.find((o) => /scalp_cap/.test(o.name));
    let centre = null, r0 = 0.1, r1 = 0.16;
    if (cap) {
      const P = cap.geometry.attributes.position; centre = new THREE.Vector3(); const v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) centre.add(v.fromBufferAttribute(P, i)); centre.multiplyScalar(1 / P.count);
      const rs = []; for (let i = 0; i < P.count; i++) rs.push(v.fromBufferAttribute(P, i).distanceTo(centre)); rs.sort((a, b) => a - b);
      r0 = rs[Math.floor(rs.length * 0.6)] + 0.012; r1 = r0 + 0.055;
    }
    for (const o of meshes) {
      const n = o.material?.name || '';
      if (/pianist_hair/.test(n) && !/cap/.test(o.name)) { hairOuterness(o, centre, r0, r1); strandTangents(o); }
      else if (/pianist_beard/.test(n) && !/cap/.test(o.name)) { hairOuterness(o, null, 0, 1); strandTangents(o); }
      else if (/pianist_(hair|beard)/.test(n)) o.geometry.setAttribute('_outer', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count), 1));
    }
    // cycle 3 r2 (critic c3r2: S02 nape - thick dark squiggly strokes on the nape skin under the hairline read like marker
    // scribbles): '_nape' = hair-strand vertices lying ON the skin (< 1.5-4 mm from a body-skin vertex) and away from the scalp
    // cap (> 4-8 mm); the hair shader fades them (napeFade). Bind pose, world space, spatial hashes.
    const body = meshes.find((o) => (o.material?.name || '') === 'pianist_skin');
    // (c3r2b S02: the nape squiggles stayed - those curls hang > 4 mm off the skin -> opt-in only, napeFade default 0)
    if (cap && body && (opts.napeFade ?? 0) > 0) {
      const wpos = (o) => { const P = o.geometry.attributes.position, out = new Float32Array(P.count * 3), v = new THREE.Vector3(); for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); if (o.isSkinnedMesh) o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld); out[3 * i] = v.x; out[3 * i + 1] = v.y; out[3 * i + 2] = v.z; } return out; };
      const grid = (A, cs, keep) => { const g = new Map(); for (let i = 0; i < A.length / 3; i++) { if (keep && !keep(i)) continue; const k = Math.floor(A[3 * i] / cs) + ',' + Math.floor(A[3 * i + 1] / cs) + ',' + Math.floor(A[3 * i + 2] / cs); let l = g.get(k); if (!l) g.set(k, l = []); l.push(i); } return g; };
      const near = (g, A, cs, x, y, z, rmax) => { let bd = rmax * rmax; const cx = Math.floor(x / cs), cy = Math.floor(y / cs), cz = Math.floor(z / cs); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const l = g.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)); if (!l) continue; for (const j of l) { const d = (A[3 * j] - x) ** 2 + (A[3 * j + 1] - y) ** 2 + (A[3 * j + 2] - z) ** 2; if (d < bd) bd = d; } } return Math.sqrt(bd); };
      const CW = wpos(cap), BW = wpos(body); const cc = [0, 0, 0]; for (let i = 0; i < CW.length / 3; i++) for (let k = 0; k < 3; k++) cc[k] += CW[3 * i + k] / (CW.length / 3);
      const gC = grid(CW, 0.008), gB = grid(BW, 0.004, (i) => (BW[3 * i] - cc[0]) ** 2 + (BW[3 * i + 1] - cc[1]) ** 2 + (BW[3 * i + 2] - cc[2]) ** 2 < 0.2 * 0.2);
      const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      let nN = 0, nAll = 0;
      for (const o of meshes) {
        const n = o.material?.name || '';
        if (!/pianist_hair/.test(n) || /cap/.test(o.name)) continue;
        const HW = wpos(o), nv = HW.length / 3, na = new Float32Array(nv);
        for (let i = 0; i < nv; i++) {
          const x = HW[3 * i], y = HW[3 * i + 1], z = HW[3 * i + 2];
          const dS = near(gB, BW, 0.004, x, y, z, 0.004); if (dS >= 0.004) continue;
          const dC = near(gC, CW, 0.008, x, y, z, 0.008);
          na[i] = ss(0.004, 0.008, dC) * (1 - ss(0.0015, 0.004, dS)); if (na[i] > 0.5) nN++;
        }
        nAll += nv; o.geometry.setAttribute('_nape', new THREE.BufferAttribute(na, 1));
      }
      console.log('[AG] pianist nape fade ' + JSON.stringify({ hairVerts: nAll, onSkin: nN }));
    }
  }
  // ---- tailoring (fix round 1): sleeve/cuff coordinates + 3-D horn and pearl buttons, from the bind pose (before posing)
  let tailor = null;
  if ((opts.tailoring ?? 1) > 0) {          // verified in look-dev sessions sandbox/pianist/fx1/l1-l5
    try {
      tailor = buildTailoring(THREE, { root, meshes, bones, opts });
      if (tailor.info.skipped) tailor = null;
      else {
        shirtU.uCuffXOn.value = tailor.cuffMeshes && Object.keys(tailor.cuffMeshes).length ? 1 : 0;
        const { arms, ...counts } = tailor.info;      // counts first: the full line is truncated in render logs
        console.log('[AG] pianist tailoring counts ' + JSON.stringify(counts));
        console.log('[AG] pianist tailoring ' + JSON.stringify(tailor.info));
      }
    } catch (e) { console.warn('[pianist] tailoring skipped:', e.message); tailor = null; }
  }
  // ---- cycle 2: dorsal hand hair (handhair.js), from the bind pose like the tailoring
  let handHair = null;
  if ((opts.handHair ?? 1) > 0) {
    try {
      handHair = buildHandHair(THREE, { root, meshes, opts });
      if (handHair) console.log('[AG] pianist hand hair ' + JSON.stringify(handHair.info));
    } catch (e) { console.warn('[pianist] hand hair skipped:', e.message); handHair = null; }
  }
  meshes.forEach(replace);
  function buttonMaterial(kind) {
    const pearl = kind === 'pearl';
    const m = new THREE.MeshPhysicalMaterial({
      name: kind + '_button.film', color: pearl ? new THREE.Color(...(opts.pearlColor || [0.84, 0.835, 0.82])) : new THREE.Color(...(opts.buttonColor || [0.03, 0.022, 0.017])),
      // fix round 2 (critic r2, S09 f4680 button mask: L p50 9 / p90 35 / max 153 with the horn material, 0.7 / 3.8 with it
      // black; ref 8 buttons p50 2 / p90 7): satin horn - coat 1.0/0.09 -> 0.3/0.3, roughness 0.34 -> 0.5, spec 0.7 -> 0.5,
      // rimButton 6 -> 2 (RIM_DEFAULTS). Create-time options: buttonRough / buttonSpec / buttonCoat / buttonCoatRough.
      roughness: pearl ? 0.3 : (opts.buttonRough ?? 0.5), metalness: 0, specularIntensity: pearl ? 0.8 : (opts.buttonSpec ?? 0.5),
      clearcoat: pearl ? 0.5 : (opts.buttonCoat ?? 0.3), clearcoatRoughness: pearl ? 0.15 : (opts.buttonCoatRough ?? 0.3),
      // cycle 2 (critic c2r1: the cuff button read as a navy/slate disc): thin-film 0.45 -> 0.08 (it tinted the sky blue-violet),
      // the cuff's warm-white fill (shirtU) below
      iridescence: pearl ? (opts.pearlIrid ?? 0.08) : 0.0, iridescenceIOR: 1.55, iridescenceThicknessRange: [250, 420],
      sheen: pearl ? 0.25 : 0.0, sheenColor: new THREE.Color(0.6, 0.6, 0.62), sheenRoughness: 0.4,
    });
    // horn thread: near-black brown (critic r2: the X thread read saturated red under the rim)
    const U = { uThreadColor: { value: pearl ? new THREE.Color(0.82, 0.82, 0.8) : new THREE.Color(0.016, 0.013, 0.011) } };
    if (pearl) Object.assign(U, shirtU);
    else m.defines = { ...(m.defines || {}), AG_RIM_MASK: '' };
    m.onBeforeCompile = (sh) => {
      addKey(sh, key, pearl ? rimGain.rimShirt : rimGain.rimButton);
      Object.assign(sh.uniforms, U);
      if (pearl) sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uShirtFill;\nuniform float uShirtDesat;\nuniform vec3 uShirtTint;')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * uShirtTint, uShirtDesat ) * uShirtFill;');
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 _bl;\nvarying vec3 vBl;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBl = _bl;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uThreadColor;\n' + TAILOR_COMMON + MICRO_PARS + BUTTON_PARS)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUTTON_NORMAL)
        // horn: faint streaky mottling; holes dark; thread matte (no coat)
        .replace('#include <lights_physical_fragment>', `
          {
            float mott = agVN( vBl.xy * vec2( 0.35, 1.4 ) + vBl.z * 3.1 );
            diffuseColor.rgb *= ${pearl ? '0.94 + 0.12 * mott' : '0.7 + 0.6 * mott'};
            diffuseColor.rgb = mix( diffuseColor.rgb, uThreadColor, agThread );
            // cycle 3 (critic c3: the pearl button read as a cream disc with four black dots): pearl holes are soft shadows
            diffuseColor.rgb *= 1.0 - ${pearl ? '0.4' : '0.85'} * agHole;
          }
          // cycle 2 (critic c2r1: the over-darkened horn buttons vanish at film exposure; refs 7 / 8: 4 grey-ringed dots):
          // the rounded rim band is glossier and gets the full glow rim (AG_RIM_MASK), the dished face stays satin
          float agRimB = ${pearl ? '0.0' : 'smoothstep( 0.72, 0.92, length( vBl.xy ) / max( vBl.z, 1e-3 ) )'};
          #include <lights_physical_fragment>
          material.roughness = mix( material.roughness, ${(opts.buttonRimRough ?? 0.25).toFixed(3)}, agRimB );
          material.roughness = mix( material.roughness, 0.75, agThread );
          material.specularColor *= 1.0 - 0.7 * agThread;
          #ifdef USE_CLEARCOAT
          material.clearcoat *= ( 1.0 - agThread ) * ( 1.0 - agHole );
          #endif`);
    };
    m.customProgramCacheKey = () => 'afterglow-button-' + kind;
    return m;
  }
  if (tailor) {
    for (const o of tailor.meshes) {
      const kind = o.userData.agKind;
      // sleeve hole caps (tailoring.js): flat-shaded near-black matte wool, no key / rim
      if (kind === 'cap' && !made.has('btn-cap')) made.set('btn-cap', new THREE.MeshStandardMaterial({ name: 'sleevecap.film', color: new THREE.Color(0.012, 0.011, 0.012), roughness: 0.95, metalness: 0, flatShading: true, side: THREE.DoubleSide }));
      if (!made.has('btn-' + kind)) made.set('btn-' + kind, buttonMaterial(kind));
      o.material = made.get('btn-' + kind);
      meshes.push(o);
    }
  }
  if (handHair) {
    // dark-brown fine hair; catches the glow rim like the scalp hair (refs 7 / 12: lit strands on the backlit dorsum)
    // cycle 3 r2 (critic c3r2: the tufts read as black pen scratches / dirt at 1080: near-black, unfilled, alpha 0.85): warmer,
    // lighter dark brown [0.035, 0.024, 0.018] -> [0.075, 0.048, 0.032], the skin's env fill (handEnv, desat + warm tint) so
    // the fibre sits in the skin's light instead of reading as ink, alpha 0.85 -> 0.5, >= 1 px ribbons (coverage-weighted),
    // coverage faded by N.V on the silhouette band (no comb fringe on the backlit dorsum edge)
    const hm = new THREE.MeshPhysicalMaterial({ name: 'handhair.film', color: new THREE.Color(...(opts.handHairColor || [0.075, 0.048, 0.032])),
      roughness: 0.42, metalness: 0, specularIntensity: 0.5, side: THREE.DoubleSide,
      sheen: 0.5, sheenColor: new THREE.Color(0.22, 0.14, 0.1), sheenRoughness: 0.4 });
    // cycle 2 round 2: footprint-aware ribbons (>= handHairMinPx px wide, coverage x true width / drawn width) with the
    // hair's stratified hashed alpha (exact per frame, frame-invariant seed); lighter, translucent tips
    const HHU = { uViewH: { value: ctx.height || (ctx.settings && ctx.settings.height) || 1080 }, uHHMinPx: { value: opts.handHairMinPx ?? 1.0 },
      uHHAlpha: { value: opts.handHairAlpha ?? 0.5 }, uHHEnv: { value: HAND_LOOK.handEnv }, uHHDesat: { value: HAND_LOOK.handDesat }, uFillTint: fillTint };
    hm.userData.hhU = HHU;
    hm.onBeforeCompile = (sh) => {
      addKey(sh, key, rimGain.rimHair);
      Object.assign(sh.uniforms, HHU, { uSeed: seed, uStrat: strat });
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHHEnv;\nuniform float uHHDesat;\nuniform vec3 uFillTint;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= uHHEnv;
  reflectedLight.indirectSpecular *= mix( 1.0, uHHEnv, 0.5 );
  reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * uFillTint, uHHDesat );`);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 _hoff;\nattribute float _hu;\nuniform float uViewH;\nuniform float uHHMinPx;\nvarying float vHHCov;\nvarying float vHHU;\nvarying vec3 vObjPos;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec3 agC = transformed - _hoff;
    float agZ = max( - ( modelViewMatrix * vec4( agC, 1.0 ) ).z, 1e-4 );
    float agPix = 2.0 * agZ / ( projectionMatrix[ 1 ][ 1 ] * uViewH );
    float agHw = length( ( modelViewMatrix * vec4( _hoff, 0.0 ) ).xyz );
    float agK = max( 1.0, 0.5 * uHHMinPx * agPix / max( agHw, 1e-8 ) );
    transformed = agC + _hoff * agK; vHHCov = 1.0 / agK; vHHU = _hu; vObjPos = position;
  }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSeed;\nuniform float uStrat;\nuniform float uHHAlpha;\nvarying float vHHCov;\nvarying float vHHU;\nvarying vec3 vObjPos;\n' + (glsl ? hashedAlphaChunk(glsl) : ''))
        .replace('#include <alphatest_fragment>', glsl ? 'if ( uHHAlpha * vHHCov * ( 1.0 - 0.45 * vHHU ) * smoothstep( 0.12, 0.45, abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ) ) < fract( hashedAlphaThreshold( vObjPos, uint( uSeed ) ) + uStrat ) ) discard;' : '')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix( 1.0, 1.8, vHHU );');
    };
    hm.customProgramCacheKey = () => 'afterglow-handhair-fp';
    handHair.mesh.material = hm; made.set('handhair', hm); meshes.push(handHair.mesh);
  }

  // ---- wool fibre fuzz (fix round 1, USER_FEEDBACK 2: "slight fibre fuzz on silhouette edges"): shell fur on the suit's
  // outer surface. Each shell is the skinned suit pushed out along its skinned normal by h (0.15-1.3 mm); a fibre is a
  // cell of a 0.16 mm grid in the suit's mm-space UV (2.1 texels/mm map -> uMicroMm) that exists with probability
  // 0.55 x fuzz and has an exponential free length (mean 0.45 mm); shell k draws the fibres longer than its height,
  // so stacked shells read as fibres standing out of the cloth. Face-on they hide in the same dark wool; at grazing
  // angles the line of sight crosses many cells and they make a soft halo that catches the backlight (forward scatter)
  // and the glow rim. Buttons are skipped. Deterministic (hash of the cell), no alpha blending.
  const shells = [];
  // cycle 3 (critic c3: no fibre fuzz on the backlit silhouette - S15 / S09 / S20c shoulders are a clean CG edge): two longer,
  // sparser shells (1.8 / 2.4 mm: only the exponential tail of the fibre lengths reaches them); fibreMean / fuzzForward per frame
  const SHELL_H = opts.fuzzShells || [0.15, 0.35, 0.6, 0.9, 1.3, 1.8, 2.4];
  for (const o of meshes.slice()) {
    const sm = o.material;
    if (!o.isSkinnedMesh || !sm || sm.name !== 'pianist_suit.film' || (opts.fuzz ?? 1) <= 0) continue;
    const SU = { uFuzz: { value: opts.fuzz ?? 1 }, uFibreMean: { value: opts.fibreMean ?? 0.45 },
      uMicroMm: { value: microMm(THREE, sm.normalMap, opts.suitTexelsPerMm ?? 2.1) },
      // cycle 2 (critic c2r1: 'ghost disc' ring of missing fuzz where no button sits - the shells skipped the OLD proxy-disc
      // UV ellipses, the 3-D buttons were re-spaced): with tailoring the 3-D buttons (2.7 mm) cover the fibres -> no skip
      uBtn: sm.userData.uniforms ? sm.userData.uniforms.uBtnHorn : { value: [0, 1, 2, 3].map(() => new THREE.Vector4(-9, -9, 1e-3, 1e-3)) },
      uFwdFuzz: { value: opts.fuzzForward ?? 0.12 }, uMicroAmp: { value: 0 }, uTwillPitch: { value: 1 } };
    SHELL_H.forEach((hmm, k) => {
      const mat = new THREE.MeshPhysicalMaterial({ name: 'pianist_fuzz.film', map: sm.map, color: 0xffffff, roughness: 0.95, metalness: 0,
        specularIntensity: 0.12, sheen: 1.0, sheenColor: new THREE.Color(0.05, 0.05, 0.055), sheenRoughness: 0.8, side: THREE.FrontSide });
      const U = { ...SU, uShellH: { value: hmm } };
      mat.userData.uniforms = U;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        addKey(sh, key, rimGain.rimWool);
        // cycle 2 (critic c2r1: a ~1 cm pale speckled 'terry' band with a fluffy knob between the black sleeve and the cuff):
        // no fibres on the turned hem - the shells fade out over the last 16 mm of the sleeve ('_sleeve' s, tailoring.js)
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uShellH;\nattribute vec4 _sleeve;\nvarying float vHemS;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHemS = _sleeve.z > 0.5 ? _sleeve.x : 1e3;')
          .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n transformed += normalize( objectNormal ) * ( uShellH * 0.001 );');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + MICRO_PARS + 'uniform float uShellH;\nuniform float uFuzz;\nuniform float uFibreMean;\nuniform vec4 uBtn[ 4 ];\nuniform float uFwdFuzz;\nvarying float vHemS;')
          .replace('#include <alphatest_fragment>', `
  #ifdef USE_MAP
  {
    float btn = 0.0;
    for ( int i = 0; i < 4; i ++ ) btn = max( btn, 1.0 - step( 1.08, length( ( vMapUv - uBtn[ i ].xy ) / uBtn[ i ].zw ) ) );
    vec2 q = vMapUv * uMicroMm / 0.16;
    vec2 c = floor( q ), f = fract( q ) - 0.5;
    float r1 = agH21( c ), r2 = agH21( c + 37.0 ), r3 = agH21( c + 91.0 ), r4 = agH21( c + 13.0 );
    float len = -log( max( r1, 1e-4 ) ) * uFibreMean;
    // the fibre leans a little with height (random direction): stacked shells draw a slanted strand, not a dot column
    vec2 off = ( vec2( r2, r3 ) - 0.5 ) * 0.45 + ( vec2( r3, r2 ) - 0.5 ) * 0.5 * ( uShellH / 0.16 ) * 0.35;
    if ( btn > 0.5 || r4 > 0.55 * uFuzz * smoothstep( 5.0, 16.0, vHemS ) || len < uShellH || length( f - off ) > 0.21 ) discard;
  }
  #endif`)
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
  {
    // backlit fibres: forward scatter of the sky behind them, strongest edge-on (silhouette)
    float ndv = abs( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectDiffuse += uFwdFuzz * vec3( 1.0, 0.8, 0.7 ) * getIBLIrradiance( -geometryViewDir ) * pow( 1.0 - ndv, 2.0 ) * RECIPROCAL_PI;
  }
  #endif`);
      };
      mat.customProgramCacheKey = () => 'afterglow-fuzz';
      const s = new THREE.SkinnedMesh(o.geometry, mat);
      s.name = o.name + '_fuzz' + k; s.bindMode = o.bindMode;
      s.position.copy(o.position); s.quaternion.copy(o.quaternion); s.scale.copy(o.scale);
      s.bind(o.skeleton, o.bindMatrix);
      s.frustumCulled = false; s.castShadow = false; s.receiveShadow = true;
      o.parent.add(s); shells.push(s); made.set('fuzz' + k, mat);
    });
  }

  if (glsl) ctx.registerPreSubframe((sub) => {          // hash seed + per-sub-frame stratum
    // fix round 2 (critic r2: the per-frame re-seed made the curly fringe boil frame to frame with pose and camera frozen,
    // hair temporal std p90 4.7 levels vs sky 0.4): a frame-INVARIANT seed; coverage stays exact per frame through the
    // (k + 0.5) / N stratum. opts.hairSeedPerFrame restores the old behaviour.
    seed.value = opts.hairSeedPerFrame ? ((Math.imul(sub.frame + 1, 2654435761) >>> 0) % 65521) : 7919;
    strat.value = sub.k < 0 ? 0.5 : (sub.k + 0.5) / sub.N;
  });
  // glow key direction: toward the sun azimuth, at least minElevDeg above the horizon (the glow sits on the ridge line)
  const updateKey = () => {
    const s = ctx.sun && ctx.sun.dir; if (!s) return;
    const h = Math.hypot(s.x, s.z) || 1; const el = Math.max(Math.asin(Math.max(-1, Math.min(1, s.y))), key.minElevDeg * D2R);
    key.world.set(s.x / h * Math.cos(el), Math.sin(el), s.z / h * Math.cos(el));
  };
  // glow rim: world.glowLight (docs/WORLD.md section 6) when the real world is loaded, else the sun azimuth at 5 deg with
  // the sun -1 deg irradiance; elevation raised to rimElevDeg, colour per frame
  const GLOW_FALLBACK = new THREE.Vector3(0.173, 0.069, 0.074), GLOW_RAD_FALLBACK = new THREE.Vector3(2.21, 1.05, 0.37);
  const updateRim = () => {
    const gl = ctx.modules && ctx.modules.world && ctx.modules.world.glowLight;
    let dx, dy, dz;
    const irr = (gl && gl.irradiance) || GLOW_FALLBACK, rad = (gl && gl.radiance) || GLOW_RAD_FALLBACK;
    if (gl && gl.direction) { dx = gl.direction.x; dy = gl.direction.y; dz = gl.direction.z; }
    else { const s = ctx.sun && ctx.sun.dir; dx = s ? s.x : 0; dy = 0.087; dz = s ? s.z : -1; }
    // colour: the glow irradiance (sky-integrated, pinkish), its hue pulled toward the glow's peak radiance (orange) by
    // rimWarm and toward white by rimNeutral, at the irradiance's luminance. Measured (sandbox/pianist/fx1, handstats.py):
    // the raw glow hue (G/R 0.40) x skin albedo, through PBR Neutral's toe (it subtracts the min channel), gave maroon hands
    // (display G/R 0.18-0.23, saturation 0.85) where refs 7 / 12 show pinkish-salmon skin (G/R 0.48, B ~ G, sat 0.57): that
    // needs a near-white, slightly pink light (linear G/R ~0.73, B/R ~0.75 on the hand albedo (0.62, 0.35, 0.24)).
    const lum = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    const k = lum(irr) / Math.max(lum(rad), 1e-6), wv = key.rimWarm, li = lum(irr), nn = key.rimNeutral;
    const hx = irr.x * (1 - wv) + rad.x * k * wv, hy = irr.y * (1 - wv) + rad.y * k * wv, hz = irr.z * (1 - wv) + rad.z * k * wv;
    key.rimColor.value.set(hx * (1 - nn) + li * nn, hy * (1 - nn) + li * nn, hz * (1 - nn) + li * nn);
    const lc = lum(key.rimColor.value); if (lc > 0) key.rimColor.value.multiplyScalar(li / lc);
    const h = Math.hypot(dx, dz) || 1;
    const el = Math.max(Math.atan2(dy, h), key.rimElevDeg * D2R);
    key.rimWorld.set(dx / h * Math.cos(el), Math.sin(el), dz / h * Math.cos(el));
  };
  ctx.registerPreSubframe((sub) => {
    updateKey(); updateRim();
    const cam = sub.camera || ctx.camera; cam.updateMatrixWorld();
    key.dirView.value.copy(key.world).transformDirection(cam.matrixWorldInverse);
    key.rimDirView.value.copy(key.rimWorld).transformDirection(cam.matrixWorldInverse);
  });

  // the piano module's bench is sat on at the pose's height (pianist_config.SEAT_Z)
  try { ctx.modules?.piano?.setBenchHeight?.(opts.benchHeight); } catch (e) { /* optional */ }

  // ---- performance tracks
  const tracks = await loadTracks(ctx, opts);
  const boneList = tracks ? tracks.bones.filter((n) => bones.has(n)).map((n) => [n, bones.get(n)]) : [];
  const qOut = {}; const rootOut = [0, 0, 0];
  const rootBone = bones.get('root');
  // optional debug pose on top of bind: [{ bone, axis: 'flex'|'abd'|[x,y,z] (local), deg }] (deformation tests)
  const debugPose = (opts.debugPose || []).map((d) => {
    let ax = d.axis;
    if (typeof ax === 'string' && rig && rig.hands) {
      const side = d.bone.endsWith('_R') ? 'R' : 'L';
      const fing = rig.hands[side].fingers[d.bone];
      ax = fing ? (ax === 'flex' ? fing.flex_axis_local : fing.abd_axis_local) : (ax === 'flex' ? rig.hands[side].wrist.flex_axis_local : rig.hands[side].wrist.ulnar_dev_axis_local);
    }
    let deg = d.deg;
    if (d.abs && rig && rig.hands && d.axis === 'flex') {          // absolute anatomical flexion: subtract the bind angle
      const fing = rig.hands[d.bone.endsWith('_R') ? 'R' : 'L'].fingers[d.bone]; if (fing) deg -= fing.rest_flex_deg;
    }
    return { bone: bones.get(d.bone), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax).normalize(), deg * D2R) };
  }).filter((d) => d.bone);

  function pose(t) {
    if (tracks) {
      tracks.sampleBones(t, qOut);
      for (const [n, b] of boneList) { const q = qOut[n]; if (q) b.quaternion.set(q[0], q[1], q[2], q[3]); }
      if (rootBone && tracks.sampleRoot) {        // apply only if the reader actually wrote a root position
        rootOut[0] = rootOut[1] = rootOut[2] = NaN; tracks.sampleRoot(t, rootOut);
        if (Number.isFinite(rootOut[0]) && Number.isFinite(rootOut[1]) && Number.isFinite(rootOut[2])) rootBone.position.set(rootOut[0], rootOut[1], rootOut[2]);
      }
    }
    if (debugPose.length) {
      for (const d of debugPose) { const b0 = bind.get(d.bone.name); d.bone.quaternion.copy(b0.q).multiply(d.q); }
    }
  }
  // ---- hair secondary motion (fix round 1, critic1:motion 'curls rigid with the head'): a damped spring (f 2.4 Hz,
  // zeta 0.3) driven by the acceleration of the hair-mass centre (head-local (0, 0.08, 0)), from FK of the root..head
  // chain of the performance tracks, integrated ONCE over the whole film at 240 Hz at load -> lag(t) is a pure function
  // of t (any frame order, any sub-frame). Max 8 mm. Applied in the hair vertex shader in object space.
  let lagTab = null, lagInfo = null; const LAG_HZ = 240;
  const headBone = bones.get('head');
  const hairObj = meshes.find((o) => /hair_strands/.test(o.name));
  if (tracks && headBone && hairObj && (opts.hairLag ?? 1) > 0 && tracks.duration > 1) {
    const t0 = performance.now();
    const chain = []; for (let b = headBone; b && b.isBone; b = b.parent) chain.unshift(b);
    const qs = {}, rp = [0, 0, 0], M = new THREE.Matrix4(), L = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    const qq = new THREE.Quaternion(), pp = new THREE.Vector3(), pt = new THREE.Vector3();
    const n = Math.floor(tracks.duration * LAG_HZ) + 1, P = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = i / LAG_HZ; tracks.sampleBones(t, qs);
      rp[0] = rp[1] = rp[2] = NaN; if (tracks.sampleRoot) tracks.sampleRoot(t, rp);
      M.identity();
      for (const b of chain) {
        const bb = bind.get(b.name), q = qs[b.name];
        if (b === rootBone && Number.isFinite(rp[0])) pp.set(rp[0], rp[1], rp[2]); else pp.copy(bb.p);
        if (q) qq.set(q[0], q[1], q[2], q[3]); else qq.copy(bb.q);
        M.multiply(L.compose(pp, qq, one));
      }
      pt.set(0, 0.08, 0).applyMatrix4(M); P[3 * i] = pt.x; P[3 * i + 1] = pt.y; P[3 * i + 2] = pt.z;
    }
    const w0 = 2 * Math.PI * (opts.hairLagHz ?? 2.4), z = opts.hairLagZeta ?? 0.3, dt = 1 / LAG_HZ, MAXL = 0.008;
    lagTab = new Float32Array(n * 3); const x = [0, 0, 0], v = [0, 0, 0];
    for (let i = 1; i < n - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const a = (P[3 * (i + 1) + k] - 2 * P[3 * i + k] + P[3 * (i - 1) + k]) / (dt * dt);
        v[k] += dt * (-a - 2 * z * w0 * v[k] - w0 * w0 * x[k]); x[k] += dt * v[k];
        x[k] = Math.max(-MAXL, Math.min(MAXL, x[k]));
      }
      lagTab[3 * i] = x[0]; lagTab[3 * i + 1] = x[1]; lagTab[3 * i + 2] = x[2];
    }
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.hypot(lagTab[3 * i], lagTab[3 * i + 1], lagTab[3 * i + 2]));
    lagInfo = { samples: n, maxMm: +(mx * 1000).toFixed(2), ms: Math.round(performance.now() - t0) };
    console.log('[AG] pianist hair lag ' + JSON.stringify(lagInfo));
  }
  const lagW = new THREE.Vector3(), rotA = new THREE.Matrix4(), rotH = new THREE.Matrix4();
  function updateHairLag(t) {
    if (!lagTab) return;
    const n = lagTab.length / 3, x = Math.max(0, Math.min(n - 1.001, t * LAG_HZ)), i = Math.floor(x), f = x - i, g = opts.hairLag ?? 1;
    lagW.set(lagTab[3 * i] * (1 - f) + lagTab[3 * i + 3] * f, lagTab[3 * i + 1] * (1 - f) + lagTab[3 * i + 4] * f, lagTab[3 * i + 2] * (1 - f) + lagTab[3 * i + 5] * f).multiplyScalar(g);
    // chain space = the root bone's parent (armature node) -> world -> hair object space (rotation only)
    const arm = rootBone && rootBone.parent;
    if (arm) { arm.updateWorldMatrix(true, false); rotA.extractRotation(arm.matrixWorld); lagW.applyMatrix4(rotA); }
    hairObj.updateWorldMatrix(true, false); rotH.extractRotation(hairObj.matrixWorld).invert(); lagW.applyMatrix4(rotH);
    hairLag.value.copy(lagW);
  }
  // ---- cycle 2: sleeve-hem plane per arm (world), per sub-frame from the skinned hem ring (tailoring.js hemRing: the most
  // distal suit vertex per 5-deg bin, in angle order): Newell normal oriented toward the hand, through the ring centroid.
  // The cuff shader darkens the first ~3.5 mm of cuff below that plane (soft shadow line of the turned hem).
  const hemTmp = new THREE.Vector3(), hemC = new THREE.Vector3(), hemN = new THREE.Vector3(), hemA = new THREE.Vector3(), hemB = new THREE.Vector3();
  const hemPts = [];
  // cycle 2 round 2 (critic c2r2: the hem ring is non-planar by 4-9 mm, so the plane put a third of the visible cuff 'behind
  // the hem' at half brightness): per-ANGLE hem distance. Skinned hem ring -> per 10-deg bin around the skinned forearm axis
  // the most distal s; every skinned cuff vertex gets d = s - hem(angle) (mm, + toward the hand) in '_cuffX'.x, per sub-frame.
  const HB = 36, hemBin = new Float32Array(HB), hemBin2 = new Float32Array(HB);
  const cuffV = new THREE.Vector3(), axA = new THREE.Vector3(), axE1 = new THREE.Vector3(), axE2 = new THREE.Vector3(), axW = new THREE.Vector3(), axL = new THREE.Vector3();
  const hbin = (x, y) => ((Math.floor((Math.atan2(y, x) + Math.PI) / (2 * Math.PI) * HB) % HB) + HB) % HB;
  function updateCuffHemD(side, ringPts, nRing) {
    const cm = tailor.cuffMeshes && tailor.cuffMeshes[side], attr = cm && cm.geometry.attributes._cuffX;
    const wr = bones.get('wrist_' + side), la = bones.get('lowerarm01_' + side);
    if (!attr || !wr || !la) return;
    wr.getWorldPosition(axW); la.getWorldPosition(axL); axA.copy(axW).sub(axL).normalize();
    axE1.set(0, 1, 0); if (Math.abs(axE1.dot(axA)) > 0.9) axE1.set(1, 0, 0);
    axE1.addScaledVector(axA, -axE1.dot(axA)).normalize(); axE2.crossVectors(axA, axE1);
    hemBin.fill(-1e9);
    for (let k = 0; k < nRing; k++) {
      hemTmp.copy(ringPts[k]).sub(axW); const s = hemTmp.dot(axA); hemTmp.addScaledVector(axA, -s);
      const b = hbin(hemTmp.dot(axE1), hemTmp.dot(axE2)); if (s > hemBin[b]) hemBin[b] = s;
    }
    for (let it = 0; it < HB; it++) {
      let empty = false;
      for (let b = 0; b < HB; b++) if (hemBin[b] < -1e8) { empty = true; const l = hemBin[(b + HB - 1) % HB], r = hemBin[(b + 1) % HB]; if (l > -1e8) hemBin[b] = l; else if (r > -1e8) hemBin[b] = r; }
      if (!empty) break;
    }
    for (let b = 0; b < HB; b++) hemBin2[b] = (hemBin[(b + HB - 1) % HB] + 2 * hemBin[b] + hemBin[(b + 1) % HB]) / 4;
    if (cm.skeleton) cm.skeleton.update();
    const pos = cm.geometry.attributes.position, X = attr.array;
    for (let i = 0; i < pos.count; i++) {
      cuffV.fromBufferAttribute(pos, i); cm.applyBoneTransform(i, cuffV); cuffV.applyMatrix4(cm.matrixWorld);
      cuffV.sub(axW); const s = cuffV.dot(axA); cuffV.addScaledVector(axA, -s);
      const u = (Math.atan2(cuffV.dot(axE2), cuffV.dot(axE1)) + Math.PI) / (2 * Math.PI) * HB - 0.5, b0 = Math.floor(u), fr = u - b0;
      const h = hemBin2[((b0 % HB) + HB) % HB] * (1 - fr) + hemBin2[(((b0 + 1) % HB) + HB) % HB] * fr;
      X[3 * i] = (s - h) * 1000;
    }
    attr.needsUpdate = true;
  }
  function updateHemPlanes() {
    if (!tailor || !tailor.hemRing || !tailor.suit || (opts.hemShadowOn ?? 1) <= 0) return;
    const suit = tailor.suit, pos = suit.geometry.attributes.position;
    group.updateWorldMatrix(true, true);
    // the renderer refreshes boneMatrices only when it draws: without this the hem used the PREVIOUS sub-frame's skinning
    // (history dependence, c2r2 determinism note)
    if (suit.skeleton) suit.skeleton.update();
    for (const side of ['R', 'L']) {
      const ring = tailor.hemRing[side] || [], wr = bones.get('wrist_' + side);
      if (ring.length < 8 || !wr) { hemPlane[side].value.set(0, 0, 0, 0); continue; }
      while (hemPts.length < ring.length) hemPts.push(new THREE.Vector3());
      hemC.set(0, 0, 0);
      for (let k = 0; k < ring.length; k++) {
        const v = hemPts[k].fromBufferAttribute(pos, ring[k]);
        suit.applyBoneTransform(ring[k], v); v.applyMatrix4(suit.matrixWorld); hemC.add(v);
      }
      updateCuffHemD(side, hemPts, ring.length);
      hemC.multiplyScalar(1 / ring.length); hemN.set(0, 0, 0);
      for (let k = 0; k < ring.length; k++) {
        const a = hemPts[k], b = hemPts[(k + 1) % ring.length];
        hemN.x += (a.y - b.y) * (a.z + b.z); hemN.y += (a.z - b.z) * (a.x + b.x); hemN.z += (a.x - b.x) * (a.y + b.y);
      }
      if (hemN.lengthSq() < 1e-14) { hemPlane[side].value.set(0, 0, 0, 0); continue; }
      hemN.normalize();
      // toward the hand: the wrist joint -> its first child (metacarpal / hand)
      wr.getWorldPosition(hemA); (wr.children[0] || wr).getWorldPosition(hemB);
      hemTmp.copy(hemB).sub(hemA); if (hemTmp.lengthSq() < 1e-12) hemTmp.copy(hemA).sub(hemC);
      if (hemN.dot(hemTmp) < 0) hemN.negate();
      hemPlane[side].value.set(hemN.x, hemN.y, hemN.z, -hemN.dot(hemC));
    }
  }
  pose(0);
  // culling (core/cull.js): the large skinned meshes split by body region, every skinned mesh bounded per sub-frame
  if (ctx.core?.SkinnedBounds && ctx.registerBeforeCull) {
    const REGION_ROOTS = ['wrist_L', 'wrist_R', 'lowerarm01_L', 'lowerarm01_R', 'upperarm01_L', 'upperarm01_R', 'upperleg01_L', 'upperleg01_R', 'neck01'];
    const regionOf = (b) => { for (let o = skeleton.bones[b]; o && o.isBone; o = o.parent) if (REGION_ROOTS.includes(o.name)) return o.name; return 'torso'; };
    const regionCache = new Map(), region = (b) => { if (!regionCache.has(b)) regionCache.set(b, regionOf(b)); return regionCache.get(b); };
    const big = []; group.traverse((o) => { if (o.isSkinnedMesh && o.skeleton === skeleton && o.geometry.index && o.geometry.index.count / 3 > 20000) big.push(o); });
    for (const o of big) ctx.core.splitSkinned(o, region);
    const skinned = []; group.traverse((o) => { if (o.isSkinnedMesh && o.frustumCulled !== false) skinned.push(o); });
    group.updateMatrixWorld(true);
    const sb = new ctx.core.SkinnedBounds(skinned, { margin: 0.1 });
    ctx.registerBeforeCull(() => sb.update());
  }
  let maskOn = false, hidState = false;
  const maskMat = new THREE.MeshBasicMaterial({ name: 'handmask', color: 0x00ff00 });

  return {
    group, parent: 'rig',
    // per-shot look overrides from the shot list: SHOTS[i].pianist = { keyOmega, keyMinElevDeg, scatterStrength, hairForward, faceFill }
    beforeFrame(frame, t, info) {
      // look-dev only: globalThis.__agPianistOverride (set by a tuning driver between frames) wins over the shot list
      const p = { ...((info && info.shot && info.shot.raw && info.shot.raw.pianist) || {}), ...(globalThis.__agPianistOverride || {}) };
      key.omega.value = p.keyOmega ?? opts.keyOmega ?? 0.35;
      key.minElevDeg = p.keyMinElevDeg ?? opts.keyMinElevDeg ?? 10;
      key.rimElevDeg = p.rimElevDeg ?? opts.rimElevDeg ?? HAND_LOOK.rimElevDeg;
      key.rimWarm = p.rimWarm ?? opts.rimWarm ?? 0.0;
      key.rimNeutral = p.rimNeutral ?? opts.rimNeutral ?? HAND_LOOK.rimNeutral;
      for (const k of Object.keys(RIM_DEFAULTS)) rimGain[k].value = p[k] ?? opts[k] ?? RIM_DEFAULTS[k];
      { const e = p.rimEdge || opts.rimEdge || HAND_LOOK.rimEdge; key.rimEdge.value.set(e[0], e[1], p.rimKick ?? opts.rimKick ?? HAND_LOOK.rimKick); }
      setTint(p.handFillTint || opts.handFillTint || HAND_LOOK.handFillTint);
      fillDir.value.set(...(p.handFillDir || opts.handFillDir || HAND_LOOK.handFillDir));
      setNailTone(Array.isArray(p.nailTone) ? p.nailTone : Array.isArray(opts.nailTone) ? opts.nailTone : NAIL_LOOK.nailTone);
      aoFloor.value = p.handAOFloor ?? opts.handAOFloor ?? HAND_LOOK.handAOFloor; aoFloorThumb.value = p.handAOFloorThumb ?? opts.handAOFloorThumb ?? HAND_LOOK.handAOFloorThumb;
      // look-dev measurement: per-frame hand mask (hands + nails pure green), same camera / pose as the beauty frame
      // (fix round 2: shirtMask = the same for the shirt + cuffs, for the 'shirt pixels outside the cuff' hole check)
      const wantMask = p.handMask ? 'hand' : p.nailMask ? 'nail' : p.shirtMask ? 'shirt' : false;      // cycle 3 r2: nailMask (nails only)
      if (wantMask !== maskOn) {
        for (const o of meshes) if (o.userData.agFilmMat) { o.material = o.userData.agFilmMat; delete o.userData.agFilmMat; }
        maskOn = wantMask;
        const re = maskOn === 'hand' ? /pianist_(skin_hand|nail)\.film/ : maskOn === 'nail' ? /^pianist_nail\.film$/ : /^shirt\.film$/;
        if (maskOn) for (const o of meshes) if (re.test(o.material?.name || '')) { o.userData.agFilmMat = o.material; o.material = maskMat; }
        if (handHair) handHair.mesh.visible = !maskOn;
      }
      // cycle 3 look-dev (sleeve-end lump hunt): hideMesh = regex on 'meshName|materialName' hides matching meshes (debug only;
      // inactive and state-free unless set)
      const hideRe = p.hideMesh ? new RegExp(p.hideMesh) : null;
      if (hideRe || hidState) {
        group.traverse((o) => {
          if (!o.isMesh || (handHair && o === handHair.mesh)) return;
          if (o.userData.agVis === undefined) o.userData.agVis = o.visible;
          o.visible = hideRe && hideRe.test(`${o.name}|${(o.material && o.material.name) || ''}`) ? false : o.userData.agVis;
        });
        hidState = !!hideRe;
      }
      if (handHair && !maskOn) handHair.mesh.visible = (p.handHair ?? opts.handHair ?? 1) > 0;
      {   // cycle 3 r2: the hand hair follows the hand's fill (per shot handEnv / handDesat; handHairFill / handHairAlpha look-dev)
        const HU = handHair && made.get('handhair') && made.get('handhair').userData.hhU;
        if (HU) {
          HU.uHHEnv.value = (p.handEnv ?? opts.handEnv ?? HAND_LOOK.handEnv) * (p.handHairFill ?? opts.handHairFill ?? 1);
          HU.uHHDesat.value = p.handDesat ?? opts.handDesat ?? HAND_LOOK.handDesat;
          HU.uHHAlpha.value = p.handHairAlpha ?? opts.handHairAlpha ?? 0.5;
        }
      }
      for (const s of shells) { const SU = s.material.userData.uniforms; SU.uFuzz.value = p.fuzz ?? opts.fuzz ?? 1; SU.uFibreMean.value = p.fibreMean ?? opts.fibreMean ?? 0.45; SU.uFwdFuzz.value = p.fuzzForward ?? opts.fuzzForward ?? 0.12; }
      for (const m of made.values()) {
        const U = m.userData.uniforms; if (!U) continue;
        // hands: own scatter scale (the red translucent edge glow dominated the rim-lit fingers) and env fill scale (handEnv;
        // material.envMapIntensity is replaced by scene.environmentIntensity in three r186, so it goes through uIndirectScale)
        const isH = !!m.userData.envBoost;
        if (U.uScatterStrength) U.uScatterStrength.value = (p.scatterStrength ?? opts.scatterStrength ?? 1.2) * (isH ? (p.handScatter ?? opts.handScatter ?? HAND_LOOK.handScatter) : 1);
        if (isH && U.uIndirectScale) U.uIndirectScale.value = p.handEnv ?? opts.handEnv ?? HAND_LOOK.handEnv;
        if (isH && m.userData.baseNormalScale) {
          m.normalScale.copy(m.userData.baseNormalScale).multiplyScalar(p.handNormalScale ?? 1);
          m.aoMapIntensity = m.userData.baseAO * (p.handAO ?? 1);
          if (U.uMicroAmp) U.uMicroAmp.value = m.userData.baseMicro * (p.skinMicroAmp ?? 1);
        }
        if (U.uMicroAmp && m.userData.envBoost) skinTone.value = p.skinTone ?? opts.skinTone ?? 1;
        if (U.uNailTone) U.uNailSpec.value = p.nailSpec ?? opts.nailSpec ?? NAIL_LOOK.nailSpec;
        if (U.uDesat) U.uDesat.value = isH ? (p.handDesat ?? opts.handDesat ?? HAND_LOOK.handDesat) : (p.bodyDesat ?? opts.bodyDesat ?? BODY_LOOK.bodyDesat);
        if (U.uFwdStrength) U.uFwdStrength.value = p.hairForward ?? opts.hairForward ?? 1.0;
        if (U.uIndirectScale && m.name.startsWith('pianist_skin.')) U.uIndirectScale.value = p.faceFill ?? opts.faceFill ?? 0.22;
        if (m.userData.bodySkin) {
          // fix round 2: the bare wrist strip follows the hand look; the ear / face back-scatter is capped (bodyScatter)
          U.uArmEnv.value = p.handEnv ?? opts.handEnv ?? HAND_LOOK.handEnv;
          U.uArmDesat.value = p.handDesat ?? opts.handDesat ?? HAND_LOOK.handDesat;
          if (U.uArmMatch) U.uArmMatch.value = p.armMatch ?? opts.armMatch ?? BODY_LOOK.armMatch;
          if (U.uArmTone) U.uArmTone.value.set(...(p.armTone || opts.armTone || BODY_LOOK.armTone));
          if (U.uArmRough) U.uArmRough.value = p.armRough ?? opts.armRough ?? -1;
          U.uArmScatter.value = (p.scatterStrength ?? opts.scatterStrength ?? 1.2) * (p.handScatter ?? opts.handScatter ?? HAND_LOOK.handScatter);
          U.uScatterStrength.value = (p.scatterStrength ?? opts.scatterStrength ?? 1.2) * (p.bodyScatter ?? opts.bodyScatter ?? BODY_LOOK.bodyScatter);
        }
        if (U.uHairDesat) U.uHairDesat.value = p.hairDesat ?? opts.hairDesat ?? BODY_LOOK.hairDesat;
        if (U.uWoolDesat) U.uWoolDesat.value = p.woolDesat ?? opts.woolDesat ?? WOOL_LOOK.woolDesat;
        if (m.userData.wool) { hemDark.value.set(...(p.hemDark || opts.hemDark || [4, 22])); slabDark.value = p.slabDark ?? opts.slabDark ?? 0.1; slabMm.value.set(...(p.slabMm || opts.slabMm || [3, 8])); }
        if (m.userData.lining) m.specularIntensity = p.liningSpec ?? opts.liningSpec ?? 0.08;
        if (m.userData.wool) {
          const wa = p.woolAlbedo ?? opts.woolAlbedo ?? WOOL_LOOK.woolAlbedo;
          m.color.setScalar(wa); m.sheenColor.setRGB(1, 1, 1.03).multiplyScalar(p.woolSheen ?? opts.woolSheen ?? WOOL_LOOK.woolSheen);
          if (U.uWoolFace) { U.uWoolFace.value = Math.min(1, (p.woolFace ?? opts.woolFace ?? WOOL_LOOK.woolFace) / wa); U.uWoolPow.value = p.woolGrazePow ?? opts.woolGrazePow ?? WOOL_LOOK.woolGrazePow; if (U.uWoolFaceSide) U.uWoolFaceSide.value = Math.min(3, (p.woolFaceSide ?? opts.woolFaceSide ?? WOOL_LOOK.woolFaceSide) / wa); }   // cycle 3: may exceed the grazing albedo (critic c3: woolFaceSide 6-7)
        }
        if (U.uHairFill) U.uHairFill.value = p.hairFill ?? opts.hairFill ?? BODY_LOOK.hairFill;
        if (U.uShirtFill) {
          U.uShirtFill.value = p.shirtFill ?? opts.shirtFill ?? SHIRT_LOOK.shirtFill; U.uShirtDesat.value = p.shirtDesat ?? opts.shirtDesat ?? SHIRT_LOOK.shirtDesat;
          U.uShirtTint.value.set(...(p.shirtTint || opts.shirtTint || SHIRT_LOOK.shirtTint)); U.uHemShadow.value = p.hemShadow ?? opts.hemShadow ?? SHIRT_LOOK.hemShadow;
          if (U.uShirtTintSky) { U.uShirtTintSky.value.set(...(p.shirtTintSky || opts.shirtTintSky || SHIRT_LOOK.shirtTintSky)); U.uHemLine.value.set(...(p.hemLine || opts.hemLine || SHIRT_LOOK.hemLine)); }
        }
      }
    },
    update(t) { pose(t); updateHairLag(t); updateHemPlanes(); },
    get bones() { return bones; },
    get rig() { return rig; },
    get tracks() { return tracks; },
    materials: made,
    info() {
      let verts = 0, tris = 0;
      for (const o of meshes) { verts += o.geometry.attributes.position.count; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
      return { meshes: meshes.length, bones: skeleton.bones.length, verts, tris, tracks: !!tracks, boneTracks: boneList.length, tailoring: tailor ? tailor.info : null, hairLag: lagInfo };
    },
    dispose() { for (const o of meshes) o.geometry.dispose(); for (const m of made.values()) m.dispose(); },
  };
}

export default create;
