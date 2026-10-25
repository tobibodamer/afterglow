// Afterglow pianist: tailoring details at the sleeve end (fix round 1, USER_FEEDBACK 2: "sleeve end and clothing much
// more detailed"). Built once at load from the BIND pose (skinned positions), deterministic, no pipeline change:
//
//  * '_sleeve' attribute on the suit (vec4: s = mm up the sleeve from its hem (per 5-deg bin, so a slanted hem is
//    followed), a = mm around the sleeve from the kissing-button line, arm (1 R / 2 L / 0), valid (0 near the angular
//    wrap)). The suit shader draws, as analytic height fields in (s, a) turned into normals through surface gradients
//    (resolution independent, LOD-faded by the mm-per-pixel footprint):
//      - the hem edge roll and the turned-hem allowance ending ~40 mm up (soft step),
//      - the sleeve vent: the top layer's free edge (0.9 mm step) from the hem to above the buttons, hand pick stitches
//        4.5 mm in from it every 5 mm,
//      - one stitched buttonhole per button (two purl rows 0.42 mm pitch around a cut slit, bar tack at the tail), the
//        part beyond the button rim visible; buttonhole silk is glossier than the wool (roughness / specular / sheen).
//  * real 3-D horn buttons (lathe: dished face, raised rounded rim, 2.7 mm thick) on the proxy's flat button discs
//    (found through the suit material's extras.buttons UV discs), 4 holes and an X thread with twist (shader), clear
//    coat -> they catch the glow as small highlights like the 4 dots in refs 7 / 8. Skinned to the suit's nearest
//    vertex's joints/weights.
//  * '_cuff' attribute on the shirt cuffs (vec3: e = mm from the cuff edge, c = mm around from the cuff placket on the
//    dorsal-ulnar side, valid = outer wall): edge-stitch row at 1.6 mm and topstitch at 6.5 mm (1.5 mm stitches with
//    visible holes), the top layer's free edge at c = 0 (0.55 mm step) with its own topstitch 4 mm in, a 9 mm
//    four-hole pearl button (3-D) at e = 7 mm on the top layer.
// The shaders only read attributes + uniforms, so the same chunks work in every sub-frame of the accumulation.

const D2R = Math.PI / 180;

// ------------------------------------------------------------------------------------------------ GLSL
export const TAILOR_COMMON = /* glsl */`
// surface gradient of a scalar varying (Mikkelsen 2020, "Surface Gradient Based Bump Mapping"), positions in mm
vec3 agSurfGrad( float f, vec3 sx, vec3 sy, vec3 N ) {
  vec3 R1 = cross( sy, N ), R2 = cross( N, sx );
  float det = dot( sx, R1 );
  det = abs( det ) < 1e-12 ? ( det < 0.0 ? -1e-12 : 1e-12 ) : det;
  return ( dFdx( f ) * R1 + dFdy( f ) * R2 ) / det;
}
float agRow( float d, float hw ) { return sqrt( max( 1.0 - ( d / hw ) * ( d / hw ), 0.0 ) ); }
`;

export const SLEEVE_PARS = /* glsl */`
uniform vec4 uSlvBtn[ 8 ];      // per button: (s, a) mm of its centre, radius mm, valid; R = 0..3, L = 4..7
uniform vec4 uSlvVent;          // vent edge a (mm), vent top s (mm), turned-hem s (mm), detail gain
varying vec4 vSleeve;
float agThread = 0.0;
float agSleeveH( vec2 p, float fw, int o, out float thread ) {
  float s = p.x, a = p.y, h = 0.0; thread = 0.0;
  float f1 = 1.0 - smoothstep( 0.5, 1.2, fw );         // ~1 mm features (rows, dimples)
  float f2 = 1.0 - smoothstep( 0.12, 0.25, fw );       // sub-mm (purl stitches)
  float f3 = 1.0 - smoothstep( 1.5, 3.0, fw );         // edges
  // hem: rolled fold edge, and the turned-up hem allowance inside (one more layer up to the turned-hem line)
  h -= 0.8 * pow( max( 1.0 - s / 2.5, 0.0 ), 2.0 ) * f3;
  h += 0.35 * ( 1.0 - smoothstep( uSlvVent.z - 1.5, uSlvVent.z + 1.5, s ) ) * f3;
  // vent: the top layer's free edge (a = av) from the hem to the vent top, its thickness tapering back into the sleeve
  float av = uSlvVent.x, st = uSlvVent.y;
  float inVent = 1.0 - smoothstep( st - 2.0, st + 2.0, s );
  h += 0.9 * smoothstep( av - 0.5, av + 0.7, a ) * ( 1.0 - smoothstep( av + 6.0, av + 14.0, a ) ) * inVent * f3;
  // hand pick stitches 4.5 mm in from the vent edge, every 5 mm
  {
    float ps = ( fract( s / 5.0 ) - 0.5 ) * 5.0;
    float d = length( vec2( ps, a - av - 4.5 ) );
    float on = step( 3.0, s ) * ( 1.0 - smoothstep( st - 4.0, st - 3.0, s ) );
    h -= 0.22 * ( 1.0 - smoothstep( 0.22, 0.55, d ) ) * on * f1;
    thread = max( thread, ( 1.0 - smoothstep( 0.15, 0.3, d ) ) * on * f1 );
  }
  // buttonholes: along +a from under each button to its tail (bar tack), two purl rows around the cut slit
  for ( int k = 0; k < 4; k ++ ) {
    vec4 b = uSlvBtn[ o + k ];
    if ( b.w < 0.5 ) continue;
    // cycle 3 (critic c3: at macro scale the holes read as two loose threads hanging ~15 mm below each button with a fringed
    // tack): a short keyhole mostly under the button (3.5 mm past its rim), the two purl rows touching, a hairline slit
    float u = a - b.y, v = s - b.x, L = b.z + 3.5;
    if ( u < -2.5 || u > L + 1.0 || abs( v ) > 2.2 ) continue;
    float along = smoothstep( -2.0, -1.0, u ) * ( 1.0 - smoothstep( L - 0.25, L + 0.3, u ) );
    float av_ = abs( v );
    float row = agRow( av_ - 0.5, 0.55 );
    float purl = 1.0 - 0.3 * f2 * ( 0.5 + 0.5 * cos( 6.2831853 * u / 0.42 ) );
    float hb = 0.38 * row * purl * along * f1;
    hb -= 0.08 * ( 1.0 - smoothstep( 0.04, 0.1, av_ ) ) * along * f1;
    float bt = smoothstep( L - 1.6, L - 1.3, u ) * ( 1.0 - smoothstep( L - 0.25, L + 0.1, u ) ) * ( 1.0 - smoothstep( 1.0, 1.2, av_ ) );
    hb = max( hb, 0.3 * bt * ( 1.0 - 0.15 * f2 * ( 0.5 + 0.5 * cos( 6.2831853 * v / 0.36 ) ) ) * f1 );
    thread = max( thread, max( row * along, bt ) * f1 );
    h += hb;
  }
  return h * uSlvVent.w;
}
`;

// after <normal_fragment_maps> (view-space 'normal'); derivatives are taken outside any branch
export const SLEEVE_NORMAL = /* glsl */`
{
  vec3 pmm = -vViewPosition * 1000.0;
  vec3 sx = dFdx( pmm ), sy = dFdy( pmm );
  vec3 gS = agSurfGrad( vSleeve.x, sx, sy, normal ), gA = agSurfGrad( vSleeve.y, sx, sy, normal );
  float fw = max( fwidth( vSleeve.x ), fwidth( vSleeve.y ) ) + 1e-4;
  if ( vSleeve.w > 0.99 && vSleeve.x < 170.0 && vSleeve.z > 0.5 ) {
    int o = vSleeve.z > 1.5 ? 4 : 0;
    float e = max( 0.03, 0.4 * fw ), t0, t1;
    float h0 = agSleeveH( vSleeve.xy, fw, o, t0 );
    float hs = agSleeveH( vSleeve.xy + vec2( e, 0.0 ), fw, o, t1 );
    float ha = agSleeveH( vSleeve.xy + vec2( 0.0, e ), fw, o, t1 );
    vec2 dh = vec2( hs - h0, ha - h0 ) / e;
    normal = normalize( normal - ( dh.x * gS + dh.y * gA ) );
    agThread = t0;
  }
}
`;

export const CUFF_PARS = /* glsl */`
varying vec3 vCuff;
float agThread = 0.0, agGroove = 0.0;
float agStitch( float d, float along, float period ) {      // one machine-stitch row: 'along' / period segments with holes
  float x = fract( along / period ) - 0.5;
  float seg = 1.0 - smoothstep( 0.34, 0.46, abs( x ) );
  return agRow( d, 0.17 ) * seg;
}
float agCuffH( vec2 p, float fw, out float thread ) {
  float e = p.x, c = p.y, h = 0.0; thread = 0.0;
  float f1 = 1.0 - smoothstep( 0.35, 0.8, fw ), f3 = 1.0 - smoothstep( 1.5, 3.0, fw );
  // overlap: the top layer's free edge at c = 0 (top layer at c > 0); the under layer's end (c ~ 22) shows through softly
  h += 0.55 * smoothstep( -0.35, 0.45, c ) * ( 1.0 - 0.7 * smoothstep( 18.0, 28.0, c ) ) * f3;
  // stitch rows: edge-stitch 1.6 mm and topstitch 6.5 mm from the cuff edge; the overlap edge's own row 4 mm in
  float g = 0.0, st = 0.0;
  for ( int k = 0; k < 2; k ++ ) {
    float d = e - ( k == 0 ? 1.6 : 6.5 );
    st = max( st, agStitch( d, c, 1.5 ) );
    g = max( g, 1.0 - smoothstep( 0.12, 0.45, abs( d ) ) );
  }
  {
    float d = c - 4.0, on = step( 0.0, e );
    st = max( st, agStitch( d, e, 1.5 ) * on );
    g = max( g, ( 1.0 - smoothstep( 0.12, 0.45, abs( d ) ) ) * on );
  }
  h += ( 0.2 * st - 0.14 * g ) * f1;
  thread = st * f1;
  agGroove = max( agGroove, g * ( 1.0 - st ) * f1 );
  return h;
}
`;
export const CUFF_NORMAL = /* glsl */`
{
  vec3 pmm = -vViewPosition * 1000.0;
  vec3 sx = dFdx( pmm ), sy = dFdy( pmm );
  vec3 gE = agSurfGrad( vCuff.x, sx, sy, normal ), gC = agSurfGrad( vCuff.y, sx, sy, normal );
  float fw = max( fwidth( vCuff.x ), fwidth( vCuff.y ) ) + 1e-4;
  if ( vCuff.z > 0.99 ) {
    float e = max( 0.03, 0.4 * fw ), t0, t1;
    float h0 = agCuffH( vCuff.xy, fw, t0 );
    float he = agCuffH( vCuff.xy + vec2( e, 0.0 ), fw, t1 );
    float hc = agCuffH( vCuff.xy + vec2( 0.0, e ), fw, t1 );
    normal = normalize( normal - ( ( he - h0 ) / e * gE + ( hc - h0 ) / e * gC ) );
    agThread = t0;
  }
}
`;

// buttons: local face coordinates vBl = (x, y) mm from the centre, z = radius mm; 4 holes + X thread
export const BUTTON_PARS = /* glsl */`
varying vec3 vBl;
float agThread = 0.0, agHole = 0.0;
float agBtnH( vec2 q, float R, out float thr, out float hole ) {
  float d = 0.22 * R, hr = max( 0.075 * R, 0.5 ), h = 0.0; thr = 0.0; hole = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    vec2 c = vec2( ( i == 0 || i == 2 ) ? -d : d, i < 2 ? -d : d );
    float r = length( q - c ), hin = 1.0 - smoothstep( hr - 0.15, hr + 0.1, r );
    hole = max( hole, hin ); h -= 0.6 * hin;
  }
  for ( int j = 0; j < 2; j ++ ) {
    vec2 a0 = j == 0 ? vec2( -d, -d ) : vec2( d, -d ), ab = -2.0 * a0;
    float t = clamp( dot( q - a0, ab ) / dot( ab, ab ), 0.0, 1.0 );
    float dl = length( q - a0 - ab * t ), w = 0.3 + 0.03 * R;
    float prof = agRow( dl, w );
    float ht = ( 0.5 + 0.1 * float( j ) ) * prof * ( 0.85 + 0.15 * sin( t * 38.0 + float( j ) * 1.7 ) );
    if ( ht > h ) { h = ht; }
    thr = max( thr, prof );
  }
  return h;
}
`;
export const BUTTON_NORMAL = /* glsl */`
{
  vec3 pmm = -vViewPosition * 1000.0;
  vec3 sx = dFdx( pmm ), sy = dFdy( pmm );
  vec3 gX = agSurfGrad( vBl.x, sx, sy, normal ), gY = agSurfGrad( vBl.y, sx, sy, normal );
  float fw = max( fwidth( vBl.x ), fwidth( vBl.y ) ) + 1e-4;
  float fade = 1.0 - smoothstep( 0.4, 0.9, fw );
  if ( length( vBl.xy ) < 0.5 * vBl.z ) {
    float e = max( 0.02, 0.4 * fw ), t0, t1, h0_, h1_;
    float h0 = agBtnH( vBl.xy, vBl.z, t0, h0_ );
    float hx = agBtnH( vBl.xy + vec2( e, 0.0 ), vBl.z, t1, h1_ );
    float hy = agBtnH( vBl.xy + vec2( 0.0, e ), vBl.z, t1, h1_ );
    normal = normalize( normal - fade * ( ( hx - h0 ) / e * gX + ( hy - h0 ) / e * gY ) );
    agThread = t0 * fade; agHole = h0_ * fade;
  }
}
`;

// ------------------------------------------------------------------------------------------------ geometry helpers
function armFrame(THREE, bones, side) {
  const W = new THREE.Vector3(), E = new THREE.Vector3();
  bones.get('wrist_' + side).getWorldPosition(W);
  bones.get('lowerarm01_' + side).getWorldPosition(E);
  const A = W.clone().sub(E).normalize();             // toward the hand
  return { W, A };
}
function perp(THREE, v, A) { return v.clone().addScaledVector(A, -v.dot(A)).normalize(); }

// skinned (bind) world positions of a mesh's vertices
function worldPositions(THREE, o) {
  const P = o.geometry.attributes.position, n = P.count, out = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i);
    if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
    v.applyMatrix4(o.matrixWorld);
    out[3 * i] = v.x; out[3 * i + 1] = v.y; out[3 * i + 2] = v.z;
  }
  return out;
}
function dominantBone(o, i) {
  const SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight;
  let best = -1, bw = -1;
  for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
  return o.skeleton.bones[best] ? o.skeleton.bones[best].name : '';
}

// lathe profile (rho, h) in mm -> BufferGeometry in world space on (C, N, T1), with vBl = (x, y, R) face coordinates
function latheButton(THREE, prof, R, C, N, T1, seg = 40) {
  const pts = prof.map(([r, h]) => new THREE.Vector2(r * R, h));
  const g = new THREE.LatheGeometry(pts, seg);
  const T2 = new THREE.Vector3().crossVectors(T1, N).normalize();     // right-handed: x * y = z (no mirroring)
  const M = new THREE.Matrix4().makeBasis(T1, N, T2);          // lathe x -> T1, y (axis) -> N, z -> T2
  const P = g.attributes.position, NM = g.attributes.normal, n = P.count;
  const bl = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    bl[3 * i] = P.getX(i); bl[3 * i + 1] = P.getZ(i); bl[3 * i + 2] = R;
    v.set(P.getX(i), P.getY(i), P.getZ(i)).multiplyScalar(0.001).applyMatrix4(M).add(C);
    P.setXYZ(i, v.x, v.y, v.z);
    v.set(NM.getX(i), NM.getY(i), NM.getZ(i)).applyMatrix4(M).normalize();
    NM.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('_bl', new THREE.BufferAttribute(bl, 3));
  g.deleteAttribute('uv');
  return g;
}
// profiles run bottom-axis -> rim -> top-axis (three's lathe normal = (dy, -dx): outward for this order); the base sits
// 0.9 mm (horn) / 0.6 mm (pearl) under the cloth so the rim never floats over the sleeve's curvature
const HORN_PROFILE = [[0.0, -0.9], [0.9, -0.9], [0.97, 0.2], [1.0, 0.75], [1.0, 1.9], [0.975, 2.4], [0.92, 2.62], [0.84, 2.55],
  [0.72, 2.2], [0.55, 1.92], [0.3, 1.83], [0, 1.85]];
const PEARL_PROFILE = [[0.0, -0.6], [0.94, -0.6], [1.0, 0.5], [0.99, 1.15], [0.92, 1.4], [0.78, 1.25], [0.55, 1.12], [0, 1.15]];

function mergeGeoms(THREE, list) {
  let n = 0, ni = 0; for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
  const out = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  for (const k of names) {
    const it = list[0].attributes[k].itemSize, C = list[0].attributes[k].array.constructor, arr = new C(n * it);
    let off = 0; for (const g of list) { arr.set(g.attributes[k].array, off * it); off += g.attributes[k].count; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, it, list[0].attributes[k].normalized));
  }
  const idx = new Uint32Array(ni); let off = 0, io = 0;
  for (const g of list) { const I = g.index.array; for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + off; io += I.length; off += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// skin attributes for a merged button geometry: per button, the joints / weights of the suit vertex nearest its centre
function skinFrom(THREE, geom, parts, src) {
  const n = geom.attributes.position.count, SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
  let off = 0;
  for (const { count, vi } of parts) {
    for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) {
      SI[4 * (off + i) + k] = src.geometry.attributes.skinIndex.getComponent(vi, k);
      SW[4 * (off + i) + k] = src.geometry.attributes.skinWeight.getComponent(vi, k);
    }
    off += count;
  }
  geom.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  geom.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
}

/**
 * Build the tailoring layer. Call at load time while the skeleton is in the bind pose (before any posing).
 * Returns { suitUniforms, buttons: [SkinnedMesh], info } and sets the '_sleeve' / '_cuff' attributes.
 */
// world-space displacement -> local (geometry) displacement of a skinned mesh at rest. NOT inv(matrixWorld): with
// KHR_mesh_quantization the dequantisation of a skinned primitive sits in its inverse bind matrices (the node transform
// of a skinned mesh is ignored), so local units are scaled per primitive (fix round 2b: the cuff fit moved 0.2 mm of the
// intended 4). Skinning is linear in the position and all joints share the same rest transform, so one Jacobian from
// vertex 0 holds for the whole primitive.
const _jScale = {};
function deltaInv(THREE, o) {
  const P = o.geometry.attributes.position, b = new THREE.Vector3().fromBufferAttribute(P, 0);
  const wp = (v) => { const x = v.clone(); if (o.isSkinnedMesh) o.applyBoneTransform(0, x); return x.applyMatrix4(o.matrixWorld); };
  const w0 = wp(b), cx = wp(b.clone().add(new THREE.Vector3(1, 0, 0))).sub(w0), cy = wp(b.clone().add(new THREE.Vector3(0, 1, 0))).sub(w0), cz = wp(b.clone().add(new THREE.Vector3(0, 0, 1))).sub(w0);
  const J = new THREE.Matrix3().set(cx.x, cy.x, cz.x, cx.y, cy.y, cz.y, cx.z, cy.z, cz.z);
  _jScale[o.name || o.material?.name || '?'] = +Math.cbrt(Math.abs(J.determinant())).toFixed(4);
  return J.invert();
}
// Small closed boundary loops of an indexed mesh (holes), found on POSITION-welded vertices (glTF splits vertices at UV /
// normal seams, so index-space boundaries also run along every seam). keep(i) filters the vertices allowed on a loop.
// Returns fan triangles (original vertex ids, wound against the neighbouring faces) for loops with perimeter < maxPerimMm.
function holeFans(o, P, keepTri, keep, maxPerimMm) {
  const I = o.geometry.index.array, n = P.length / 3;
  const canon = new Int32Array(n), H = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(P[3 * i] * 1e5) + ',' + Math.round(P[3 * i + 1] * 1e5) + ',' + Math.round(P[3 * i + 2] * 1e5);
    let c = H.get(k); if (c === undefined) { c = i; H.set(k, i); } canon[i] = c;
  }
  const he = new Map();
  for (let t = 0; t < I.length; t += 3) {
    if (!keepTri(I[t], I[t + 1], I[t + 2])) continue;
    for (let e = 0; e < 3; e++) {
      const ia = I[t + e], ib = I[t + (e + 1) % 3], a = canon[ia], b = canon[ib];
      if (a !== b) he.set(a + '_' + b, ib);
    }
  }
  const next = new Map(); let bad = 0;
  for (const [k, ib] of he) {
    const u = k.indexOf('_'), a = +k.slice(0, u), b = +k.slice(u + 1);
    if (he.has(b + '_' + a) || !keep(a) || !keep(b)) continue;
    if (next.has(b)) bad++;
    next.set(b, { to: a, vid: ib });           // walk b -> a: the fan's edge (b, a) is opposite to the face's (a, b)
  }
  const seen = new Set(), tris = [], loops = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let cur = start, ok = true;
    while (!seen.has(cur)) {
      seen.add(cur); const e = next.get(cur);
      if (!e || loop.length > 600) { ok = false; break; }
      loop.push(e.vid); cur = e.to;
    }
    if (!ok || cur !== start || loop.length < 3) continue;
    let per = 0;
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k], b = loop[(k + 1) % loop.length];
      per += Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]) * 1000;
    }
    loops.push({ n: loop.length, perimMm: +per.toFixed(1), closed: per < maxPerimMm });
    if (per >= maxPerimMm) continue;
    for (let k = 1; k < loop.length - 1; k++) tris.push(loop[0], loop[k], loop[k + 1]);
  }
  return { tris, loops, nonManifold: bad };
}

// ---- cycle 2 round 2: shirt cuff fitted to the wrist (critic c2r2: the cuff stood 5.1 mm off the wrist on average, max
// 8.6 mm, concentric; its edge sat only 2-3 mm past the sleeve hem; the end-on annulus was 0.77 x the wrist section).
// Frame per arm: s = mm along the forearm axis toward the hand, angle 0 = DORSAL (dorsal = A x radial for R, radial x A for
// L, radial = toward the thumb base). Per 10-deg bin:
//  - radial: the distal 30 mm (ramped out over the next 20) move radially inward until the inner wall sits gap(angle) off
//    the widest wrist skin in the cuff's span; gap = cuffGapDorsalMm on the dorsum -> cuffGapPalmarMm underneath (the cuff
//    rests on the wrist under gravity). A radial SHIFT, so the wall keeps its thickness.
//  - axial: the edge (a plane: order-1 harmonic fit) moves to cuffShowMm past the sleeve hem ring (also an order-1 fit),
//    i.e. the cuff is tilted / shifted with the hem; the shift ramps out over the distal 45 mm.
// Returns the edge function edgeAt(angle) (mm, final positions) and the frame for the '_cuff' coordinates.
function fitCuffToWrist(THREE, { o, side, f, meshes, bones, suitW, hemIdx, opts }) {
  const NB = 36, TAU = 2 * Math.PI;
  const show = opts.cuffShowMm ?? 10, gapD = opts.cuffGapDorsalMm ?? 0.8, gapP = opts.cuffGapPalmarMm ?? 3.0;
  const maxOut = opts.cuffLengthenMaxMm ?? 6, maxIn = opts.cuffShortenMaxMm ?? 12;
  const T = new THREE.Vector3(); (bones.get('finger1-1_' + side) || bones.get('metacarpal1_' + side)).getWorldPosition(T);
  const rad = perp(THREE, T.clone().sub(f.W), f.A);
  const E1 = (side === 'R' ? new THREE.Vector3().crossVectors(f.A, rad) : new THREE.Vector3().crossVectors(rad, f.A)).normalize();
  const E2 = new THREE.Vector3().crossVectors(f.A, E1).normalize();
  const q = new THREE.Vector3();
  const loc = (P, i, out) => {
    q.set(P[3 * i] - f.W.x, P[3 * i + 1] - f.W.y, P[3 * i + 2] - f.W.z); const d = q.dot(f.A); q.addScaledVector(f.A, -d);
    out[0] = d * 1000; out[1] = q.length() * 1000; out[2] = Math.atan2(q.dot(E2), q.dot(E1)); return out;
  };
  const bin = (t) => ((Math.floor((t + Math.PI) / TAU * NB) % NB) + NB) % NB;
  const at = (arr, t) => { const u = (t + Math.PI) / TAU * NB - 0.5, b0 = Math.floor(u), fr = u - b0; return arr[((b0 % NB) + NB) % NB] * (1 - fr) + arr[(((b0 + 1) % NB) + NB) % NB] * fr; };
  const smooth = (a0, it) => { let a = Float32Array.from(a0); for (let k = 0; k < it; k++) { const b = a; a = b.map((_, j) => (b[(j + NB - 1) % NB] + 2 * b[j] + b[(j + 1) % NB]) / 4); } return a; };
  const fillE = (a) => { for (let it = 0; it < NB; it++) for (let b = 0; b < NB; b++) if (a[b] < -1e8) { const l = a[(b + NB - 1) % NB], r = a[(b + 1) % NB]; if (l > -1e8) a[b] = l; else if (r > -1e8) a[b] = r; } return a; };
  const fit1 = (a) => {     // order-1 harmonic fit (a slanted plane through the cylinder): [mean, cos, sin]
    let m = 0, c = 0, s = 0;
    for (let b = 0; b < NB; b++) { const t = -Math.PI + (b + 0.5) * TAU / NB; m += a[b]; c += a[b] * Math.cos(t); s += a[b] * Math.sin(t); }
    return [m / NB, 2 * c / NB, 2 * s / NB];
  };
  const ev1 = (p, t) => p[0] + p[1] * Math.cos(t) + p[2] * Math.sin(t);
  const gap = (t) => gapD + (gapP - gapD) * (1 - Math.cos(t)) / 2;
  const L = [0, 0, 0];
  // cuff (bind)
  const P0 = worldPositions(THREE, o), n0 = P0.length / 3;
  const s0 = new Float32Array(n0), r0 = new Float32Array(n0), t0 = new Float32Array(n0), edge0 = new Float32Array(NB).fill(-1e9);
  for (let i = 0; i < n0; i++) { loc(P0, i, L); s0[i] = L[0]; r0[i] = L[1]; t0[i] = L[2]; const b = bin(L[2]); edge0[b] = Math.max(edge0[b], L[0]); }
  fillE(edge0);
  const edgeS = smooth(edge0, 1), pOld = fit1(edge0);
  // sleeve hem ring (bind, after the sleeve stretch)
  const hem = new Float32Array(NB).fill(-1e9);
  for (const i of hemIdx || []) { loc(suitW, i, L); if (L[1] > 70) continue; const b = bin(L[2]); hem[b] = Math.max(hem[b], L[0]); }
  fillE(hem);
  const hemOk = hem.every((x) => x > -1e8);
  const pHem = hemOk ? fit1(hem) : pOld.map((x, k) => (k ? 0 : x - show));
  const pNew = [pHem[0] + show, pHem[1], pHem[2]];
  const ds = new Float32Array(NB);
  for (let b = 0; b < NB; b++) { const t = -Math.PI + (b + 0.5) * TAU / NB; ds[b] = Math.max(-maxIn, Math.min(maxOut, ev1(pNew, t) - ev1(pOld, t))); }
  // widest skin per bin and per 8-mm slice of the final cuff (e from the new edge; window +-6 mm) + the gap: the fitted cuff
  // tapers with the forearm (a cylinder fitted to the widest skin of its span stood 5 mm off at the edge, CPU check 02:50)
  const NZ = 5, ZW = 8, needZ = Array.from({ length: NZ }, () => new Float32Array(NB)), innerZ = Array.from({ length: NZ }, () => new Float32Array(NB).fill(1e9));
  for (const sk of meshes) {
    if (!sk.isSkinnedMesh || !sk.material || !/^pianist_skin(_hand)?$/.test(sk.material.name || '')) continue;
    const SPk = worldPositions(THREE, sk);
    for (let i = 0; i < SPk.length / 3; i++) {
      loc(SPk, i, L); if (L[1] > 60) continue;
      const eN = ev1(pNew, L[2]) - L[0];
      if (eN < -2 || eN > NZ * ZW + 6) continue;
      const b = bin(L[2]), g = L[1] + gap(L[2]);
      for (let z = 0; z < NZ; z++) if (eN >= z * ZW - 6 && eN <= (z + 1) * ZW + 6) needZ[z][b] = Math.max(needZ[z][b], g);
    }
  }
  // cuff inner wall per slice (positions after the axial shift: e relative to the new edge)
  const dsS = smooth(ds, 1), eNew = new Float32Array(n0);
  for (let i = 0; i < n0; i++) {      // new e = (old edge + ds) - (s + ds x wa)
    const eo = at(edgeS, t0[i]) - s0[i], wa = Math.max(0, 1 - Math.max(0, eo) / 45);
    eNew[i] = eo + at(dsS, t0[i]) * (1 - wa);
  }
  for (let i = 0; i < n0; i++) { const z = Math.floor(eNew[i] / ZW); if (z >= 0 && z < NZ) { const b = bin(t0[i]); innerZ[z][b] = Math.min(innerZ[z][b], r0[i]); } }
  let drZ = needZ.map((nz, z) => smooth(nz.map((nd, b) => (innerZ[z][b] < 1e8 && nd > 0 ? Math.max(0, innerZ[z][b] - nd) : 0)), 2));
  // across slices: no slice moves less than 70 % of its distal neighbour (no waist), light smoothing
  for (let z = 1; z < NZ; z++) drZ[z] = drZ[z].map((d, b) => Math.max(d, 0.7 * drZ[z - 1][b]));
  drZ = drZ.map((d, z) => d.map((x, b) => (drZ[Math.max(0, z - 1)][b] + 2 * x + drZ[Math.min(NZ - 1, z + 1)][b]) / 4));
  // never closer than 0.3 mm to the widest skin of the slice (the 70 % rule must not push a wider proximal slice into the arm)
  drZ = drZ.map((d, z) => d.map((x, b) => { const t = -Math.PI + (b + 0.5) * TAU / NB; return innerZ[z][b] < 1e8 && needZ[z][b] > 0 ? Math.max(0, Math.min(x, innerZ[z][b] - (needZ[z][b] - gap(t) + 0.3))) : x; }));
  const drAt = (e, t) => { const u = Math.max(0, Math.min(NZ - 1, e / ZW - 0.5)), z0 = Math.floor(u), z1 = Math.min(NZ - 1, z0 + 1), fz = u - z0; return at(drZ[z0], t) * (1 - fz) + at(drZ[z1], t) * fz; };
  const dr = drZ[0];
  const Pos = o.geometry.attributes.position, inv = deltaInv(THREE, o), dv = new THREE.Vector3(), rv = new THREE.Vector3();
  for (let i = 0; i < n0; i++) {
    const e = at(edgeS, t0[i]) - s0[i], en = Math.max(0, eNew[i]);
    const wr = en < 34 ? 1 : en > 52 ? 0 : (52 - en) / 18, wa = Math.max(0, 1 - Math.max(0, e) / 45);
    rv.set(P0[3 * i] - f.W.x, P0[3 * i + 1] - f.W.y, P0[3 * i + 2] - f.W.z); rv.addScaledVector(f.A, -rv.dot(f.A));
    if (rv.lengthSq() < 1e-12) continue;
    rv.normalize();
    dv.copy(rv).multiplyScalar(-drAt(en, t0[i]) * wr / 1000).addScaledVector(f.A, at(dsS, t0[i]) * wa / 1000).applyMatrix3(inv);
    Pos.setXYZ(i, Pos.getX(i) + dv.x, Pos.getY(i) + dv.y, Pos.getZ(i) + dv.z);
  }
  Pos.needsUpdate = true;
  // final edge per bin (for the '_cuff' e coordinate: stitch rows parallel to the real edge)
  const P1 = worldPositions(THREE, o), edge1 = new Float32Array(NB).fill(-1e9), vis = [], gapA = new Float32Array(NB).fill(1e9);
  for (let i = 0; i < n0; i++) { loc(P1, i, L); const b = bin(L[2]); edge1[b] = Math.max(edge1[b], L[0]); }
  fillE(edge1);
  const edgeF = smooth(edge1, 1);
  for (let i = 0; i < n0; i++) { loc(P1, i, L); if (at(edgeF, L[2]) - L[0] < ZW) { const b = bin(L[2]); gapA[b] = Math.min(gapA[b], L[1]); } }
  let gs = 0, gn = 0, gmx = 0;
  for (let b = 0; b < NB; b++) {
    if (hemOk) vis.push(edge1[b] - hem[b]);
    if (gapA[b] < 1e8 && needZ[0][b] > 0) { const t = -Math.PI + (b + 0.5) * TAU / NB, g = gapA[b] - (needZ[0][b] - gap(t)); gs += g; gn++; gmx = Math.max(gmx, g); }
  }
  const vs = vis.slice().sort((a, b) => a - b);
  const r1 = (x) => +x.toFixed(1);
  return {
    E1, E2, loc, edgeAt: (t) => at(edgeF, t),
    info: { mode: 'wrist', showMm: show, gapDorsal: gapD, gapPalmar: gapP, drMeanMm: r1(dr.reduce((a, b) => a + b, 0) / NB), drMaxMm: r1(Math.max(...dr)),
      dsMinMm: r1(Math.min(...dsS)), dsMaxMm: r1(Math.max(...dsS)), hemTiltMm: r1(Math.hypot(pHem[1], pHem[2])), hemResidMm: hemOk ? r1(Math.max(...hem.map((h, b) => Math.abs(h - ev1(pHem, -Math.PI + (b + 0.5) * TAU / NB))))) : null,
      visMinMm: vs.length ? r1(vs[0]) : null, visP50Mm: vs.length ? r1(vs[vs.length >> 1]) : null, visMaxMm: vs.length ? r1(vs[vs.length - 1]) : null,
      skinGapMeanMm: gn ? r1(gs / gn) : null, skinGapMaxMm: r1(gmx) },
  };
}

export function buildTailoring(THREE, { root, meshes, bones, opts = {} }) {
  (root.parent || root).updateMatrixWorld(true);
  const info = { arms: {}, buttons: 0, cuffs: 0 };
  const suit = meshes.find((o) => o.isSkinnedMesh && o.material && o.material.name === 'pianist_suit');
  const uBtn = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0));
  const vent = new THREE.Vector4(-12, 110, 40, opts.tailorDetail ?? 1);
  const newMeshes = [];
  if (!suit || !bones.get('wrist_R') || !bones.get('wrist_L')) return { uBtn, vent, meshes: newMeshes, info: { skipped: true } };
  let SP = worldPositions(THREE, suit); const nS = SP.length / 3;
  const UV = suit.geometry.attributes.uv;
  const frames = { R: armFrame(THREE, bones, 'R'), L: armFrame(THREE, bones, 'L') };
  const armOf = new Int8Array(nS);
  for (let i = 0; i < nS; i++) {
    const b = dominantBone(suit, i);
    const m = /^(lowerarm0[12]|wrist)_([RL])$/.exec(b);
    if (m) armOf[i] = m[2] === 'R' ? 1 : 2;
  }
  const lin = meshes.find((o) => o.isSkinnedMesh && o.material && o.material.name === 'pianist_lining');
  // ---- fix round 2: sleeve length. Critic r2 measured 21-24 mm of shirt cuff in S06 / S24 (reaching pose: the jacket
  // sleeve rides up); USER_FEEDBACK 2 wants 10-15 mm. The forearm part of the jacket (outer shell + lining) is stretched
  // toward the hand along the forearm axis: d = sleeveExtendMm x a linear ramp over the last sleeveRampMm before the hem
  // (in the bind pose, before anything else here reads the positions; buttons, hem coordinates and fuzz follow).
  const extL = opts.sleeveExtendMm ?? 3, extS = opts.sleeveRampMm ?? 140;
  info.sleeveExtendMm = extL;
  if (extL > 0) {
    const hemS = { 1: -1e9, 2: -1e9 };
    for (let i = 0; i < nS; i++) {
      if (!armOf[i]) continue; const f = frames[armOf[i] === 1 ? 'R' : 'L'];
      const s = ((SP[3 * i] - f.W.x) * f.A.x + (SP[3 * i + 1] - f.W.y) * f.A.y + (SP[3 * i + 2] - f.W.z) * f.A.z) * 1000;
      hemS[armOf[i]] = Math.max(hemS[armOf[i]], s);
    }
    const stretch = (o, Pw, armOfV) => {
      const Pos = o.geometry.attributes.position, inv = deltaInv(THREE, o), dv = new THREE.Vector3();
      let moved = 0;
      for (let i = 0; i < Pos.count; i++) {
        const a = armOfV(i); if (!a) continue; const f = frames[a === 1 ? 'R' : 'L'];
        const s = ((Pw[3 * i] - f.W.x) * f.A.x + (Pw[3 * i + 1] - f.W.y) * f.A.y + (Pw[3 * i + 2] - f.W.z) * f.A.z) * 1000;
        const d = extL * Math.min(1, Math.max(0, (s - (hemS[a] - extS)) / extS));
        if (d <= 0) continue;
        dv.copy(f.A).multiplyScalar(d / 1000).applyMatrix3(inv);
        Pos.setXYZ(i, Pos.getX(i) + dv.x, Pos.getY(i) + dv.y, Pos.getZ(i) + dv.z); moved++;
      }
      Pos.needsUpdate = true; return moved;
    };
    info.sleeveExtendVerts = stretch(suit, SP, (i) => armOf[i]);
    if (lin) {
      const LPw = worldPositions(THREE, lin);
      info.sleeveExtendLiningVerts = stretch(lin, LPw, (i) => { const m = /^(lowerarm0[12]|wrist)_([RL])$/.exec(dominantBone(lin, i)); return m ? (m[2] === 'R' ? 1 : 2) : 0; });
    }
    info.hemSBeforeMm = { R: +hemS[1].toFixed(1), L: +hemS[2].toFixed(1) };
    SP = worldPositions(THREE, suit);
  }
  // ---- cycle 3 r2 (critic c3r2 / USER_FEEDBACK 2: a faceted flap stands up at the top of the S06 / S24 sleeve opening, lump
  // box p50 22-25 vs < 3): the frozen cloth left crumpled hem / vent-corner vertices up to 10-14 mm OUTSIDE the sleeve
  // surface (sandbox/pianist/scratch/lumpdiag.mjs, bind pose: R 129 / L 541 vertices > 6 mm above the local median radius of
  // their 10-deg x 4-mm bin in the last 40 mm). In the last hemRelaxMm (28) of the sleeve, radial excess over the local
  // (3-bin) median radius above 2 mm is compressed to 20 % (continuous map), the button discs untouched.
  if ((opts.hemRelax ?? 1) > 0) {
    const zone = opts.hemRelaxMm ?? 28, knee = opts.hemRelaxKnee ?? 2.0, keep = opts.hemRelaxKeep ?? 0.2;
    const discsR = (suit.material.userData && suit.material.userData.buttons) || [];
    const inBtn = (i) => { const u = UV.getX(i), v = UV.getY(i); for (const d of discsR) { const x = (u - d.c[0]) / d.r[0], y = (v - d.c[1]) / d.r[1]; if (x * x + y * y < 1.6) return true; } return false; };
    const Pos = suit.geometry.attributes.position, inv = deltaInv(THREE, suit), dv = new THREE.Vector3();
    const relaxInfo = {}, movedV = new Set(), I = suit.geometry.index.array;
    // the sleeve under / around the button row keeps its shape (the 3-D buttons sit on it): world centroids of the UV discs
    const btnC = [1, 2].flatMap((arm) => discsR.map((d) => { const c = [0, 0, 0]; let k = 0; for (let i = 0; i < nS; i++) { if (armOf[i] !== arm) continue; const x = (UV.getX(i) - d.c[0]) / d.r[0], y = (UV.getY(i) - d.c[1]) / d.r[1]; if (x * x + y * y < 1) { c[0] += SP[3 * i]; c[1] += SP[3 * i + 1]; c[2] += SP[3 * i + 2]; k++; } } return k ? c.map((v) => v / k) : null; })).filter(Boolean);      // per arm: the sleeves share the UV discs
    const nearBtn = (i) => { for (const c of btnC) if ((SP[3 * i] - c[0]) ** 2 + (SP[3 * i + 1] - c[1]) ** 2 + (SP[3 * i + 2] - c[2]) ** 2 < (opts.hemRelaxBtnMm ?? 16) ** 2 * 1e-6) return true; return false; };
    for (const a of [1, 2]) {
      const f = frames[a === 1 ? 'R' : 'L'];
      const U0 = new THREE.Vector3(0, 1, 0).addScaledVector(f.A, -f.A.y).normalize(), V0 = new THREE.Vector3().crossVectors(f.A, U0);
      let hem = -1e9; const rows = [];
      for (let i = 0; i < nS; i++) if (armOf[i] === a) hem = Math.max(hem, ((SP[3 * i] - f.W.x) * f.A.x + (SP[3 * i + 1] - f.W.y) * f.A.y + (SP[3 * i + 2] - f.W.z) * f.A.z) * 1000);
      for (let i = 0; i < nS; i++) {
        if (armOf[i] !== a) continue;
        const dx = SP[3 * i] - f.W.x, dy = SP[3 * i + 1] - f.W.y, dz = SP[3 * i + 2] - f.W.z;
        const sA = (dx * f.A.x + dy * f.A.y + dz * f.A.z) * 1000, s = hem - sA;
        if (s > zone + 8) continue;
        const rx = dx - f.A.x * sA / 1000, ry = dy - f.A.y * sA / 1000, rz = dz - f.A.z * sA / 1000;
        const r = Math.hypot(rx, ry, rz) * 1000; if (r < 1) continue;
        const th = Math.atan2(rx * V0.x + ry * V0.y + rz * V0.z, rx * U0.x + ry * U0.y + rz * U0.z);
        rows.push({ i, s, r, rx: rx / r * 1000, ry: ry / r * 1000, rz: rz / r * 1000, tb: Math.floor((th + Math.PI) / (Math.PI / 18)) % 36, sb: Math.floor(s / 4) });
      }
      const B = new Map(); for (const x of rows) { const k = x.tb * 100 + x.sb; if (!B.has(k)) B.set(k, []); B.get(k).push(x.r); }
      const med = new Map(); for (const [k, l] of B) { l.sort((p, q) => p - q); med.set(k, l[Math.floor(l.length / 2)]); }
      let moved = 0, maxEx = 0;
      for (const x of rows) {
        if (x.s > zone || inBtn(x.i) || nearBtn(x.i)) continue;
        const l = []; for (let d = -1; d <= 1; d++) { const m = med.get(((x.tb + d + 36) % 36) * 100 + x.sb); if (m !== undefined) l.push(m); }
        l.sort((p, q) => p - q); const loc = l[Math.floor(l.length / 2)];
        const ex = x.r - loc; if (ex <= knee) continue;
        const w = 1 - Math.min(1, Math.max(0, (x.s - (zone - 6)) / 6));       // fade over the last 6 mm of the zone
        const dr = -(ex - knee) * (1 - keep) * w;                                // mm, radial
        dv.set(x.rx, x.ry, x.rz).multiplyScalar(dr / 1000).applyMatrix3(inv);
        Pos.setXYZ(x.i, Pos.getX(x.i) + dv.x, Pos.getY(x.i) + dv.y, Pos.getZ(x.i) + dv.z);
        movedV.add(x.i); moved++; maxEx = Math.max(maxEx, ex);
      }
      relaxInfo[a === 1 ? 'R' : 'L'] = { moved, maxExMm: +maxEx.toFixed(1) };
    }
    Pos.needsUpdate = true; info.hemRelax = relaxInfo;
    // the moved vertices' normals from their (object-space) faces, so the flattened flap no longer shades as a lump
    if (movedV.size && suit.geometry.attributes.normal) {
      const Nrm = suit.geometry.attributes.normal, acc = new Map(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), fnv = new THREE.Vector3();
      for (let t = 0; t < I.length; t += 3) {
        const a0 = I[t], b0 = I[t + 1], c0 = I[t + 2];
        if (!movedV.has(a0) && !movedV.has(b0) && !movedV.has(c0)) continue;
        pa.fromBufferAttribute(Pos, a0); pb.fromBufferAttribute(Pos, b0); pc.fromBufferAttribute(Pos, c0);
        fnv.subVectors(pc, pb).cross(pb.clone().sub(pa).negate());
        for (const k of [a0, b0, c0]) if (movedV.has(k)) { if (!acc.has(k)) acc.set(k, new THREE.Vector3()); acc.get(k).add(fnv); }
      }
      let flipped = 0;
      for (const [k, nv] of acc) {
        if (nv.lengthSq() < 1e-20) continue; nv.normalize();
        const old = new THREE.Vector3().fromBufferAttribute(Nrm, k); if (old.dot(nv) < 0) { nv.negate(); flipped++; }   // keep the original side
        Nrm.setXYZ(k, nv.x, nv.y, nv.z);
      }
      Nrm.needsUpdate = true; info.hemRelax.normals = { set: acc.size, flipped };
    }
    SP = worldPositions(THREE, suit);
  }
  // ---- button discs: suit vertices inside an extras.buttons UV disc, split into connected components
  const discs = (suit.material.userData && suit.material.userData.buttons) || [];
  const inDisc = new Int16Array(nS).fill(-1);
  for (let i = 0; i < nS; i++) {
    const u = UV.getX(i), v = UV.getY(i);
    for (let k = 0; k < discs.length; k++) {
      const d = discs[k]; const x = (u - d.c[0]) / d.r[0], y = (v - d.c[1]) / d.r[1];   // glTF UV convention (as the shader's vMapUv)
      // 1.25: the extras' radii come from a 0.001-rounded UV bbox (~1.5 % of r), boundary vertices sit at r ~ 1.0-1.03
      if (x * x + y * y < 1.25) { inDisc[i] = k; break; }
    }
  }
  const par = new Int32Array(nS).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const I = suit.geometry.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (inDisc[a] >= 0 && inDisc[b] >= 0 && inDisc[c] >= 0) { const ra = find(a); par[find(b)] = ra; par[find(c)] = ra; }
  }
  const comps = new Map();
  for (let i = 0; i < nS; i++) if (inDisc[i] >= 0) { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); }
  // a real button disc is its own topological island (p3 duplicates the disc faces); a patch of some other UV island that
  // merely overlaps the disc in the atlas is attached to non-disc vertices -> rejected
  const attached = new Set();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const k = (inDisc[a] >= 0) + (inDisc[b] >= 0) + (inDisc[c] >= 0);
    if (k > 0 && k < 3) for (const v of [a, b, c]) if (inDisc[v] >= 0) attached.add(find(v));
  }
  for (const r of attached) comps.delete(r);
  // ---- fix round 2b: close the sleeve's button-sized holes. p3 rebuilt the 4 kissing discs from the distal one and deleted
  // the proxy's 3 original disc islands; the sleeve under those originals is OPEN (old spacing 18-23 mm), so the shirt /
  // lining showed through past the proximal button (fx2a: S04 f2466 80 px, S04 f2400 crescent; critic r2 225 px) even with
  // the discs welded. The holes are small closed boundary loops of the position-welded forearm sleeve (disc islands and
  // their solidify rims excluded); they are fanned shut (no new vertices) in a separate cap mesh built at the end of the
  // suit section. With the sleeve closed the proxy discs are collapsed (only the 3-D buttons show).
  let holeTris = [], collapseDiscs = opts.collapseDiscs === true;
  if (opts.closeSleeveHoles !== false) {
    const parI = new Int32Array(nS).map((_, i) => i);
    const fI = (a) => { while (parI[a] !== a) { parI[a] = parI[parI[a]]; a = parI[a]; } return a; };
    for (let t = 0; t < I.length; t += 3) { const ra = fI(I[t]); parI[fI(I[t + 1])] = ra; parI[fI(I[t + 2])] = ra; }
    const isz = new Map(); for (let i = 0; i < nS; i++) { const r = fI(i); isz.set(r, (isz.get(r) || 0) + 1); }
    const discV = new Uint8Array(nS); for (const ids of comps.values()) for (const i of ids) discV[i] = 1;
    const big = (i) => (isz.get(fI(i)) || 0) >= (opts.holeIslandMin ?? 1200);
    const hf = holeFans(suit, SP, (a, b, c) => !discV[a] && !discV[b] && !discV[c] && big(a),
      (i) => armOf[i] !== 0 && !discV[i] && big(i), opts.holeMaxPerimMm ?? 110);
    holeTris = hf.tris;
    collapseDiscs = opts.collapseDiscs ?? (hf.loops.filter((l) => l.closed).length >= 2);
    info.sleeveHoles = { closedPerimMm: hf.loops.filter((l) => l.closed).map((l) => l.perimMm), openLoops: hf.loops.filter((l) => !l.closed).map((l) => l.perimMm).slice(0, 8), fanTris: holeTris.length / 3, nonManifold: hf.nonManifold };
  }
  // ---- fix round 2: weld + flatten the proxy button discs (critic r2: with the forearm supinated, the separately skinned
  // disc islands drift off the button-sized hole in the sleeve under them -> shirt / lining showed through (S04 f2466,
  // S09 f4796); the discs stand 0.25-1 mm proud with a lining-coloured rim -> 'ghost rings with red rims' around the 3-D
  // buttons). Each disc vertex takes the skin weights of the nearest sleeve vertex (so it moves exactly with the cloth
  // around the hole), and the disc is lowered along its normal onto the sleeve (its boundary's median gap to the sleeve),
  // keeping 0.06 mm per stacking order so overlapping discs do not z-fight. The disc shells in the lining primitive get
  // the same weights and offset. opts.weldDiscs === false keeps the proxy as it was.
  if (opts.weldDiscs !== false && !collapseDiscs) {
    const SI = suit.geometry.attributes.skinIndex, SW = suit.geometry.attributes.skinWeight, Pos = suit.geometry.attributes.position;
    const inv = deltaInv(THREE, suit);
    // spatial hash of the non-disc forearm sleeve vertices (5 mm cells)
    const H = new Map(), cs = 0.005, keyOf = (x, y, z) => Math.floor(x / cs) + ',' + Math.floor(y / cs) + ',' + Math.floor(z / cs);
    for (let i = 0; i < nS; i++) if (armOf[i] && inDisc[i] < 0) { const k = keyOf(SP[3 * i], SP[3 * i + 1], SP[3 * i + 2]); if (!H.has(k)) H.set(k, []); H.get(k).push(i); }
    const nearest = (x, y, z) => {
      let best = -1, bd = 1e9; const cx = Math.floor(x / cs), cy = Math.floor(y / cs), cz = Math.floor(z / cs);
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
        const L = H.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)); if (!L) continue;
        for (const j of L) { const d = (SP[3 * j] - x) ** 2 + (SP[3 * j + 1] - y) ** 2 + (SP[3 * j + 2] - z) ** 2; if (d < bd) { bd = d; best = j; } }
      }
      return [best, Math.sqrt(bd)];
    };
    // boundary vertices of each disc component (edges used once)
    const edgeCount = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (inDisc[a] < 0 || inDisc[b] < 0 || inDisc[c] < 0) continue;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u + '_' + v : v + '_' + u; edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
    }
    const isBnd = new Uint8Array(nS);
    for (const [k, c] of edgeCount) if (c === 1) { const [u, v] = k.split('_').map(Number); isBnd[u] = 1; isBnd[v] = 1; }
    const discMove = new Map();        // disc vertex -> world delta (m)
    const comp = [...comps.entries()].filter(([, ids]) => ids.length >= 6);
    // stacking order along each arm: by distance of the disc from the hem side (the proxy stacks distal over proximal)
    const lifts = []; let welded = 0;
    for (const [, ids] of comp) {
      const N = new THREE.Vector3(); const C = new THREE.Vector3();
      for (const i of ids) { C.x += SP[3 * i]; C.y += SP[3 * i + 1]; C.z += SP[3 * i + 2]; }
      C.multiplyScalar(1 / ids.length);
      const nm = new THREE.Matrix3().getNormalMatrix(suit.matrixWorld), vn = new THREE.Vector3();
      for (const i of ids) N.add(vn.fromBufferAttribute(suit.geometry.attributes.normal, i).applyMatrix3(nm));
      N.normalize();
      const gaps = [];
      for (const i of ids) {
        const [j, d] = nearest(SP[3 * i], SP[3 * i + 1], SP[3 * i + 2]);
        if (j < 0) continue;
        for (let k = 0; k < 4; k++) { SI.setComponent(i, k, SI.getComponent(j, k)); SW.setComponent(i, k, SW.getComponent(j, k)); }
        welded++;
        if (isBnd[i]) gaps.push(((SP[3 * i] - SP[3 * j]) * N.x + (SP[3 * i + 1] - SP[3 * j + 1]) * N.y + (SP[3 * i + 2] - SP[3 * j + 2]) * N.z) * 1000);
      }
      gaps.sort((a, b) => a - b);
      const lift = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
      lifts.push({ C, N, ids, lift });
    }
    // stacking: discs that overlap keep their order, 0.06 mm apart
    lifts.sort((a, b) => a.lift - b.lift);
    lifts.forEach((L, k) => {
      const down = Math.min(1.2, Math.max(0, L.lift - 0.05 - 0.06 * (k % 4)));
      L.down = down;
      if (down <= 0.02) return;
      const dW = L.N.clone().multiplyScalar(-down / 1000), dl = dW.clone().applyMatrix3(inv);
      for (const i of L.ids) {
        Pos.setXYZ(i, Pos.getX(i) + dl.x, Pos.getY(i) + dl.y, Pos.getZ(i) + dl.z);
        SP[3 * i] += dW.x; SP[3 * i + 1] += dW.y; SP[3 * i + 2] += dW.z;
        discMove.set(i, dW);
      }
    });
    Pos.needsUpdate = true; SI.needsUpdate = true; SW.needsUpdate = true;
    info.discWeld = { welded, lifts: lifts.map((L) => +L.lift.toFixed(2)), down: lifts.map((L) => +(L.down || 0).toFixed(2)) };
    // the discs' solidify shells in the lining primitive: same weights (mapped through the bone objects) and offset
    if (lin) {
      const LPw = worldPositions(THREE, lin), LPos = lin.geometry.attributes.position, LSI = lin.geometry.attributes.skinIndex, LSW = lin.geometry.attributes.skinWeight;
      const linv = deltaInv(THREE, lin);
      const HD = new Map();
      for (const L of lifts) for (const i of L.ids) { const k = keyOf(SP[3 * i], SP[3 * i + 1], SP[3 * i + 2]); if (!HD.has(k)) HD.set(k, []); HD.get(k).push(i); }
      const bmap = lin.skeleton.bones.map((b) => b);
      let nl = 0;
      for (let i = 0; i < LPos.count; i++) {
        const x = LPw[3 * i], y = LPw[3 * i + 1], z = LPw[3 * i + 2];
        let best = -1, bd = 1e9; const cx = Math.floor(x / cs), cy = Math.floor(y / cs), cz = Math.floor(z / cs);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const Lc = HD.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)); if (!Lc) continue;
          for (const j of Lc) { const dd = (SP[3 * j] - x) ** 2 + (SP[3 * j + 1] - y) ** 2 + (SP[3 * j + 2] - z) ** 2; if (dd < bd) { bd = dd; best = j; } }
        }
        if (best < 0 || Math.sqrt(bd) > 0.0025) continue;           // within 2.5 mm of a disc vertex: the disc's shell
        for (let k = 0; k < 4; k++) {
          const bone = suit.skeleton.bones[SI.getComponent(best, k)];
          LSI.setComponent(i, k, Math.max(0, bmap.indexOf(bone))); LSW.setComponent(i, k, SW.getComponent(best, k));
        }
        const dW = discMove.get(best);
        if (dW) { const dl = dW.clone().applyMatrix3(linv); LPos.setXYZ(i, LPos.getX(i) + dl.x, LPos.getY(i) + dl.y, LPos.getZ(i) + dl.z); }
        nl++;
      }
      LPos.needsUpdate = true; LSI.needsUpdate = true; LSW.needsUpdate = true;
      info.discWeld.liningVerts = nl;
    }
  }
  // face normals (area-weighted) per component
  const faceN = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (inDisc[a] < 0 || inDisc[b] < 0 || inDisc[c] < 0) continue;
    const r = find(a);
    const ax = SP[3 * b] - SP[3 * a], ay = SP[3 * b + 1] - SP[3 * a + 1], az = SP[3 * b + 2] - SP[3 * a + 2];
    const bx = SP[3 * c] - SP[3 * a], by = SP[3 * c + 1] - SP[3 * a + 1], bz = SP[3 * c + 2] - SP[3 * a + 2];
    const nn = faceN.get(r) || new THREE.Vector3();
    nn.x += ay * bz - az * by; nn.y += az * bx - ax * bz; nn.z += ax * by - ay * bx; faceN.set(r, nn);
  }
  const btns = [];
  for (const [r, ids] of comps) {
    if (ids.length < 6) continue;
    const C = new THREE.Vector3();
    for (const i of ids) C.x += SP[3 * i], C.y += SP[3 * i + 1], C.z += SP[3 * i + 2];
    C.multiplyScalar(1 / ids.length);
    let rad = 0, vi = ids[0], dmin = 1e9; const arm = armOf[ids[0]];
    for (const i of ids) {
      const d = Math.hypot(SP[3 * i] - C.x, SP[3 * i + 1] - C.y, SP[3 * i + 2] - C.z);
      rad = Math.max(rad, d); if (d < dmin) { dmin = d; vi = i; }
    }
    const N = (faceN.get(r) || new THREE.Vector3(0, 1, 0)).clone().normalize();
    // outward: along the suit's own (outward, p5 outer_check) vertex normals of the disc
    const side = arm === 1 ? 'R' : arm === 2 ? 'L' : null;
    const vn = new THREE.Vector3(), nsum = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(suit.matrixWorld);
    for (const i of ids) nsum.add(vn.fromBufferAttribute(suit.geometry.attributes.normal, i).applyMatrix3(nm));
    if (N.dot(nsum) < 0) N.negate();
    btns.push({ C, C0: C.clone(), N, rad: rad * 1000, vi, arm, side, n: ids.length, root: r });
  }
  // ---- per arm: frame, hem, sleeve coordinates
  const sleeve = new Float32Array(nS * 4);
  const NB = 72;
  const hemRing = { R: [], L: [] };
  for (const side of ['R', 'L']) {
    const f = frames[side], armId = side === 'R' ? 1 : 2;
    const mine = btns.filter((b) => b.arm === armId).sort((a, b) => b.C.clone().sub(f.W).dot(f.A) - a.C.clone().sub(f.W).dot(f.A));
    // reference direction: the button line (else dorsal-ulnar)
    let B1;
    if (mine.length) { const m = new THREE.Vector3(); for (const b of mine) m.add(b.C); m.multiplyScalar(1 / mine.length); B1 = perp(THREE, m.sub(f.W), f.A); }
    else B1 = perp(THREE, new THREE.Vector3(side === 'R' ? -1 : 1, 1, 0), f.A);
    let B2 = new THREE.Vector3().crossVectors(f.A, B1).normalize(); if (side === 'L') B2.negate();     // mirrored arms
    const q = new THREE.Vector3();
    const sRaw = new Float32Array(nS), th = new Float32Array(nS), rr = new Float32Array(nS);
    const hem = new Float32Array(NB).fill(-1e9), hemIdx = new Int32Array(NB).fill(-1);
    for (let i = 0; i < nS; i++) {
      if (armOf[i] !== armId) continue;
      q.set(SP[3 * i] - f.W.x, SP[3 * i + 1] - f.W.y, SP[3 * i + 2] - f.W.z);
      const d = q.dot(f.A); q.addScaledVector(f.A, -d);
      sRaw[i] = d * 1000; rr[i] = q.length() * 1000; th[i] = Math.atan2(q.dot(B2), q.dot(B1));
      if (inDisc[i] >= 0) continue;
      const k = Math.min(NB - 1, Math.floor((th[i] + Math.PI) / (2 * Math.PI) * NB));
      if (sRaw[i] > hem[k]) { hem[k] = sRaw[i]; hemIdx[k] = i; }
    }
    // cycle 2: the hem ring (most distal suit vertex per 5-deg bin, in angle order) -> per sub-frame hem plane in the module
    // (soft shadow line of the sleeve hem on the shirt cuff)
    hemRing[side] = Array.from(hemIdx).filter((i) => i >= 0);
    // fill empty bins, smooth (circular)
    for (let it = 0; it < NB; it++) for (let k = 0; k < NB; k++) if (hem[k] < -1e8) { const a = hem[(k + NB - 1) % NB], b = hem[(k + 1) % NB]; if (a > -1e8 || b > -1e8) hem[k] = Math.max(a, b); }
    const hs = new Float32Array(NB);
    for (let k = 0; k < NB; k++) { let s = 0; for (let j = -2; j <= 2; j++) s += hem[(k + j + NB) % NB]; hs[k] = s / 5; }
    let rsum = 0, rn = 0;
    for (let i = 0; i < nS; i++) {
      if (armOf[i] !== armId) continue;
      const x = (th[i] + Math.PI) / (2 * Math.PI) * NB - 0.5, k0 = Math.floor(x), t = x - k0;
      const h = hs[(k0 + NB) % NB] * (1 - t) + hs[(k0 + 1) % NB] * t;
      const s = h - sRaw[i];
      if (s < 30) { rsum += rr[i]; rn++; }
      sleeve[4 * i] = s; sleeve[4 * i + 2] = armId;
      sleeve[4 * i + 3] = Math.abs(th[i]) < 150 * D2R ? 1 : 0;
    }
    const Rm = rn ? rsum / rn : 40;
    for (let i = 0; i < nS; i++) if (armOf[i] === armId) sleeve[4 * i + 1] = th[i] * Rm;
    // button (s, a) for the shader
    const o = side === 'R' ? 0 : 4;
    const ba = [];
    // real kissing sleeve buttons are ~15-16 mm (24L) and touch: the proxy discs are 18-20 mm, so the 3-D buttons are
    // 15.8 mm and re-spaced along the disc line from the distal disc (the plain-wool discs stay hidden underneath)
    const RB = opts.sleeveButtonR ?? 7.9;
    if (mine.length >= 2) {
      const n4 = Math.min(4, mine.length), C0 = mine[0].C.clone(), dl = mine[n4 - 1].C.clone().sub(C0).normalize();
      for (let k = 0; k < n4; k++) { mine[k].C = C0.clone().addScaledVector(dl, k * (2 * RB - 0.25) / 1000); mine[k].R = RB; }
    }
    mine.slice(0, 4).forEach((b, k) => {
      q.copy(b.C).sub(f.W); const d = q.dot(f.A) * 1000; q.addScaledVector(f.A, -d / 1000);
      const t = Math.atan2(q.dot(B2), q.dot(B1));
      const x = (t + Math.PI) / (2 * Math.PI) * NB - 0.5, k0 = Math.floor(x), tt = x - k0;
      const h = hs[(k0 + NB) % NB] * (1 - tt) + hs[(k0 + 1) % NB] * tt;
      b.s = h - d; b.a = t * Rm; ba.push(b);
    });
    // 3-D button radius: the disc radius, at most half the spacing to the next button (+0.35 mm: kissing)
    for (const b of ba) {
      if (b.R) continue;
      let nn = 1e9; for (const c of ba) if (c !== b) nn = Math.min(nn, b.C.distanceTo(c.C) * 1000);
      b.R = Math.min(b.rad * 0.98, nn < 1e8 ? nn / 2 + 0.35 : b.rad);
    }
    ba.forEach((b, k) => uBtn[o + k].set(b.s, b.a, b.R, 1));
    const sTop = ba.length ? Math.max(...ba.map((b) => b.s + b.R)) + 22 : 110;
    const Rb = ba.length ? ba[0].R : 8;
    vent.x = -(Rb + 4.5); vent.y = sTop;
    info.arms[side] = { hemRadiusMm: +Rm.toFixed(1), buttons: ba.map((b) => ({ s: +b.s.toFixed(1), a: +b.a.toFixed(1), R: +b.R.toFixed(2), discR: +b.rad.toFixed(2),
      pos: b.C.toArray().map((x) => +x.toFixed(4)), n: b.N.toArray().map((x) => +x.toFixed(3)) })),
      ventTopMm: +sTop.toFixed(1), sleeveVerts: armOf.reduce((s, x) => s + (x === armId ? 1 : 0), 0) };
    f.B1 = B1; f.B2 = B2; f.hs = hs; f.Rm = Rm;
  }
  suit.geometry.setAttribute('_sleeve', new THREE.BufferAttribute(sleeve, 4));
  {
    // cycle 3 r2 (critic c3r2: the grey 'slab' between sleeve hem and cuff, S06 box p50 13 vs sleeve 1.1): '_slvIn' = how far
    // a sleeve vertex's normal points INTO the sleeve tube (-N . radial, bind pose, last 45 mm): the inner hem face. Three has
    // no occlusion for the inside of the tube, so the shader darkens those faces like the lining in shadow (slabDark)
    const slvIn = new Float32Array(nS), Nrm = suit.geometry.attributes.normal, nmW = new THREE.Matrix3().getNormalMatrix(suit.matrixWorld), nv = new THREE.Vector3(), rv = new THREE.Vector3();
    let nIn = 0;
    for (let i = 0; i < nS; i++) {
      const a = armOf[i]; if (!a || !Nrm || sleeve[4 * i] > 45) continue; const f = frames[a === 1 ? 'R' : 'L'];
      rv.set(SP[3 * i] - f.W.x, SP[3 * i + 1] - f.W.y, SP[3 * i + 2] - f.W.z); rv.addScaledVector(f.A, -rv.dot(f.A)); if (rv.lengthSq() < 1e-10) continue; rv.normalize();
      nv.fromBufferAttribute(Nrm, i).applyMatrix3(nmW).normalize();
      slvIn[i] = Math.max(0, Math.min(1, -nv.dot(rv))); if (slvIn[i] > 0.3) nIn++;
    }
    suit.geometry.setAttribute('_slvIn', new THREE.BufferAttribute(slvIn, 1));
    info.sleeveInnerVerts = nIn;
  }

  // ---- 3-D buttons: horn on every disc component (sleeves and jacket front)
  const skel = new THREE.Skeleton(suit.skeleton.bones);          // inverses from the bind pose (world), no quantisation
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRoot = (v) => v.clone().applyMatrix4(rootInv);
  const hornParts = [], hornGeoms = [];
  for (const b of btns) {
    const f = b.side ? frames[b.side] : null;
    const T1 = perp(THREE, f ? f.A : new THREE.Vector3(0, 1, 0), b.N);
    const R = b.R || b.rad * 0.98;
    // lift: 0.25 mm per stacking step is already in the proxy; seat the button on its disc
    const g = latheButton(THREE, HORN_PROFILE, R, new THREE.Vector3(), b.N, T1);
    hornGeoms.push({ g, C: b.C }); hornParts.push({ count: g.attributes.position.count, vi: b.vi });
  }
  if (hornGeoms.length && opts.buttons3d !== false) {
    for (const { g, C } of hornGeoms) {                // world -> root space
      const P = g.attributes.position, v = new THREE.Vector3(), Nn = g.attributes.normal;
      const rot = new THREE.Matrix3().setFromMatrix4(rootInv);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).add(C).applyMatrix4(rootInv); P.setXYZ(i, v.x, v.y, v.z);
        v.fromBufferAttribute(Nn, i).applyMatrix3(rot).normalize(); Nn.setXYZ(i, v.x, v.y, v.z);
      }
    }
    const geom = mergeGeoms(THREE, hornGeoms.map((x) => x.g));
    skinFrom(THREE, geom, hornParts, suit);
    // the proxy's flat discs (18-20 mm, stacked 0.25-1 mm over the sleeve) USED to be collapsed to one point each so only
    // the 3-D buttons show. fx1b/fx1c (session 5) proved the sleeve is NOT complete under them: the collapsed discs left
    // button-sized holes, the glossy bordeaux lining showed through as golden ovals in S09 (unchanged by any button
    // material change) and, with the lining discs collapsed as well, the white shirt showed as a pale crescent in S04.
    // Default now: the discs stay (plain wool, the sleeve's own cover there) under the smaller 3-D buttons; opt-in
    // collapseDiscs restores the old behaviour.
    if (collapseDiscs) {
    const SPos = suit.geometry.attributes.position;
    // whole topological island of each disc (all triangles, no UV test): the solidify rim band around a disc carries
    // UVs outside the extras ellipse and was left standing as a crescent past the kissing buttons (fx1b sleeveR_real)
    const par2 = new Int32Array(nS).map((_, i) => i);
    const find2 = (a) => { while (par2[a] !== a) { par2[a] = par2[par2[a]]; a = par2[a]; } return a; };
    for (let t = 0; t < I.length; t += 3) { const ra = find2(I[t]); par2[find2(I[t + 1])] = ra; par2[find2(I[t + 2])] = ra; }
    const islandSize = new Map();
    for (let i = 0; i < nS; i++) { const r = find2(i); islandSize.set(r, (islandSize.get(r) || 0) + 1); }
    let extra = 0;
    for (const b of btns) {
      const ids = comps.get(b.root) || [];
      const x = SPos.getX(b.vi), y = SPos.getY(b.vi), z = SPos.getZ(b.vi);
      for (const i of ids) SPos.setXYZ(i, x, y, z);
      const isl = find2(b.vi), sz = islandSize.get(isl) || 0;
      if (sz > ids.length && sz <= 4 * ids.length + 64) {          // the disc's own island (never the sleeve itself)
        for (let i = 0; i < nS; i++) if (find2(i) === isl && inDisc[i] < 0) { SPos.setXYZ(i, x, y, z); extra++; }
      }
    }
    info.discIslandExtraVerts = extra;
    SPos.needsUpdate = true;
    info.discsCollapsed = btns.length;
    // the solidify shell of each disc lives in the lining primitive (same UVs): collapse those vertices too, else the old
    // disc outlines peek out between the re-spaced kissing buttons
    const lin = meshes.find((o) => o.isSkinnedMesh && o.material && o.material.name === 'pianist_lining');
    if (lin && lin.geometry.attributes.uv) {
      const LP = worldPositions(THREE, lin), LUV = lin.geometry.attributes.uv, LPos = lin.geometry.attributes.position;
      let nl = 0;
      for (const b of btns) {
        const d = discs[inDisc[b.vi]]; if (!d) continue;
        let first = -1;
        for (let i = 0; i < LUV.count; i++) {
          const x = (LUV.getX(i) - d.c[0]) / d.r[0], y = (LUV.getY(i) - d.c[1]) / d.r[1];
          if (x * x + y * y > 1.25) continue;
          const dist = Math.hypot(LP[3 * i] - b.C0.x, LP[3 * i + 1] - b.C0.y, LP[3 * i + 2] - b.C0.z) * 1000;
          if (dist > b.rad + 4) continue;
          if (first < 0) first = i;
          LPos.setXYZ(i, LPos.getX(first), LPos.getY(first), LPos.getZ(first)); nl++;
        }
      }
      LPos.needsUpdate = true; info.liningDiscVertsCollapsed = nl;
    }
    } else info.discsCollapsed = 0;
    const mesh = new THREE.SkinnedMesh(geom);
    mesh.name = 'Pianist_buttons'; mesh.userData.agKind = 'horn';
    root.add(mesh); mesh.updateMatrixWorld(true); mesh.bind(skel, mesh.matrixWorld);
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    newMeshes.push(mesh); info.buttons = btns.length;
  }

  if (holeTris.length) {
    // the sleeve holes found above, fanned shut as their OWN mesh (fx2b: appended to the suit index, the caps took the hole
    // rim's sideways vertex normals + whatever the atlas holds inside the hole's UV loop and read as pale sky-lit discs):
    // same skinned attributes as the suit (moves exactly with the cloth), own index, flat-shaded near-black matte material
    // (pianist.js, agKind 'cap')
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) if (suit.geometry.attributes[k]) g.setAttribute(k, suit.geometry.attributes[k]);
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(holeTris), 1));
    const cap = new THREE.SkinnedMesh(g);
    cap.name = 'Pianist_sleeve_caps'; cap.userData.agKind = 'cap';
    (suit.parent || root).add(cap);
    cap.position.copy(suit.position); cap.quaternion.copy(suit.quaternion); cap.scale.copy(suit.scale);
    cap.updateMatrixWorld(true); cap.bindMode = suit.bindMode; cap.bind(suit.skeleton, suit.bindMatrix);
    cap.frustumCulled = false; cap.castShadow = false; cap.receiveShadow = true;
    newMeshes.push(cap);
  }

  // ---- shirt cuffs
  const pearlGeoms = [], pearlParts = [];
  let cuffSrc = null, _suitW = null;
  const suitWorld = () => (_suitW || (_suitW = worldPositions(THREE, suit)));
  const cuffMeshes = {};
  for (const o of meshes) {
    const m = /shirt_cuff_?([RL])$/.exec(o.name || ''); if (!m || !o.isSkinnedMesh) continue;
    const side = m[1], f = frames[side]; cuffSrc = o;
    // ---- fix round 2b: tighter + shorter cuff (critic r2: radius 31.7 mm stands off the wrist 'like a can'; 21-24 mm of
    // cuff showing in S06 / S24, USER_FEEDBACK 2 wants 10-15). The distal 30 mm of the cuff (ramped out over the next 20)
    // are pulled radially toward cuffRadiusMm, per 10-deg bin never closer than cuffClearMm to the wrist skin (or 0.6 mm
    // outside any shirt-body vertex in that span), and the distal edge moves cuffShortenMm toward the elbow.
    const cRmm = opts.cuffRadiusMm ?? 28.5, cShort = opts.cuffShortenMm ?? 1, cClr = opts.cuffClearMm ?? 3;
    const fitW = (opts.cuffFit ?? 'wrist') === 'wrist' ? fitCuffToWrist(THREE, { o, side, f, meshes, bones, suitW: suitWorld(), hemIdx: hemRing[side], opts }) : null;
    if (fitW) info['cuffFit' + side] = fitW.info;
    else if (cRmm > 0 || cShort > 0) {
      const P0 = worldPositions(THREE, o), n0 = P0.length / 3, q = new THREE.Vector3();
      const E1 = perp(THREE, new THREE.Vector3(side === 'R' ? -1 : 1, 0.5, 0), f.A), E2 = new THREE.Vector3().crossVectors(f.A, E1).normalize();
      const s0 = new Float32Array(n0), t0 = new Float32Array(n0), r0 = new Float32Array(n0); let sHi = -1e9, sLo = 1e9;
      for (let i = 0; i < n0; i++) {
        q.set(P0[3 * i] - f.W.x, P0[3 * i + 1] - f.W.y, P0[3 * i + 2] - f.W.z); const d = q.dot(f.A); q.addScaledVector(f.A, -d);
        s0[i] = d * 1000; r0[i] = q.length() * 1000; t0[i] = Math.atan2(q.dot(E2), q.dot(E1));
        sHi = Math.max(sHi, s0[i]); sLo = Math.min(sLo, s0[i]);
      }
      const NB = 36, bin = (t) => ((Math.floor((t + Math.PI) / (2 * Math.PI) * NB) % NB) + NB) % NB;
      const need = new Float32Array(NB), inner = new Float32Array(NB).fill(1e9);
      const scan = (P, clr) => {
        for (let i = 0; i < P.length / 3; i++) {
          q.set(P[3 * i] - f.W.x, P[3 * i + 1] - f.W.y, P[3 * i + 2] - f.W.z); const d = q.dot(f.A) * 1000;
          if (d < sHi - 50 || d > sHi + 6) continue;
          q.addScaledVector(f.A, -d / 1000); const r = q.length() * 1000; if (r > 60) continue;
          const b = bin(Math.atan2(q.dot(E2), q.dot(E1))); need[b] = Math.max(need[b], r + clr);
        }
      };
      for (const sk of meshes) {
        if (!sk.isSkinnedMesh || !sk.material) continue;
        const mn = sk.material.name || '';
        if (mn === 'pianist_skin' || mn === 'pianist_skin_hand') scan(worldPositions(THREE, sk), cClr);
        else if (mn === 'pianist_shirt' && !/shirt_cuff/.test(sk.name || '')) scan(worldPositions(THREE, sk), 0.6);
      }
      const rs = Array.from(r0).sort((a, b) => a - b), med = rs[rs.length >> 1];
      let ro = 0, no = 0; for (const r of rs) if (r > med) { ro += r; no++; }
      const Rout = no ? ro / no : 31.7, k0 = Math.min(1, cRmm / Rout);
      for (let i = 0; i < n0; i++) if (sHi - s0[i] < 30) { const b = bin(t0[i]); inner[b] = Math.min(inner[b], r0[i]); }
      const fac = new Float32Array(NB);
      for (let b = 0; b < NB; b++) fac[b] = inner[b] < 1e8 ? Math.min(1, Math.max(k0, need[b] / inner[b])) : 1;
      const facS = fac.map((_, b) => (fac[(b + NB - 1) % NB] + 2 * fac[b] + fac[(b + 1) % NB]) / 4);
      const Pos = o.geometry.attributes.position, inv = deltaInv(THREE, o), dv = new THREE.Vector3();
      for (let i = 0; i < n0; i++) {
        const e = sHi - s0[i], w = e < 30 ? 1 : e > 50 ? 0 : (50 - e) / 20;
        const u = (t0[i] + Math.PI) / (2 * Math.PI) * NB - 0.5, b0 = Math.floor(u), fr = u - b0;
        const fb = facS[((b0 % NB) + NB) % NB] * (1 - fr) + facS[(((b0 + 1) % NB) + NB) % NB] * fr;
        const dr = r0[i] * (1 - fb) * w, ds = cShort * Math.max(0, 1 - e / 45);
        q.set(P0[3 * i] - f.W.x, P0[3 * i + 1] - f.W.y, P0[3 * i + 2] - f.W.z); q.addScaledVector(f.A, -q.dot(f.A));
        if (q.lengthSq() < 1e-12) continue;
        q.normalize();
        dv.copy(q).multiplyScalar(-dr / 1000).addScaledVector(f.A, -ds / 1000).applyMatrix3(inv);
        Pos.setXYZ(i, Pos.getX(i) + dv.x, Pos.getY(i) + dv.y, Pos.getZ(i) + dv.z);
      }
      Pos.needsUpdate = true;
      info['cuffFit' + side] = { RoutMm: +Rout.toFixed(1), k0: +k0.toFixed(3), facMin: +Math.min(...facS).toFixed(3), facMax: +Math.max(...facS).toFixed(3),
        facMean: +(facS.reduce((a, b) => a + b, 0) / NB).toFixed(3), spanMm: +(sHi - sLo).toFixed(1), shortenMm: cShort };
    }
    const CP = worldPositions(THREE, o), n = CP.length / 3, NRM = o.geometry.attributes.normal;
    // placket direction: ulnar, a little dorsal (pianist faces +z, right hand at -x; the camera side in the close-ups). Not
    // on the dorsum: wrist extension pushes the hand's dorsal skin into the cuff there, which hides the cuff's distal half
    const D1 = perp(THREE, new THREE.Vector3(side === 'R' ? -1 : 1, 0.5, 0), f.A);
    let D2 = new THREE.Vector3().crossVectors(f.A, D1).normalize(); if (side === 'L') D2.negate();
    const q = new THREE.Vector3(), nv = new THREE.Vector3(), nmat = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    let sMax = -1e9; const sR = new Float32Array(n), th = new Float32Array(n), rr = new Float32Array(n), outer = new Uint8Array(n);
    const eV = new Float32Array(n);      // mm from the cuff's distal edge (per angle with the wrist fit, else from the max s)
    for (let i = 0; i < n; i++) {
      q.set(CP[3 * i] - f.W.x, CP[3 * i + 1] - f.W.y, CP[3 * i + 2] - f.W.z);
      const d = q.dot(f.A); q.addScaledVector(f.A, -d);
      sR[i] = d * 1000; rr[i] = q.length() * 1000; th[i] = Math.atan2(q.dot(D2), q.dot(D1));
      sMax = Math.max(sMax, sR[i]);
      if (fitW) eV[i] = Math.max(0, fitW.edgeAt(Math.atan2(q.dot(fitW.E2), q.dot(fitW.E1))) - sR[i]);
      nv.fromBufferAttribute(NRM, i).applyMatrix3(nmat).normalize();
      outer[i] = nv.dot(q.normalize()) > 0.3 ? 1 : 0;
    }
    if (!fitW) for (let i = 0; i < n; i++) eV[i] = sMax - sR[i];
    // cycle 2 (lead review 2 / critic c2r1: 'thick, rounded band like a bandage'): p3 builds the cuff as a 1.6 mm double wall
    // with a 0.8 mm rolled rim, but the smooth vertex normals of the last wall ring average the wall with the rim (~45 deg),
    // so the whole last wall segment (several mm) shaded as a rounded tube end. Wall vertices (e > 0.4 mm from the edge) get
    // the pure cylinder normal (outer: radial out, inner: radial in); only the 0.8 mm rim stays rounded -> a crisp edge.
    if (opts.cuffCrispEdge ?? 1) {
      const JT = deltaInv(THREE, o).invert().transpose(), rv = new THREE.Vector3(), ov = new THREE.Vector3();
      const newN = new Float32Array(n * 3).fill(NaN);
      let dsum = 0, dn = 0;
      for (let i = 0; i < n; i++) {
        if (eV[i] <= 0.4) continue;
        rv.set(CP[3 * i] - f.W.x, CP[3 * i + 1] - f.W.y, CP[3 * i + 2] - f.W.z); rv.addScaledVector(f.A, -rv.dot(f.A));
        if (rv.lengthSq() < 1e-12) continue;
        rv.normalize(); if (!outer[i]) rv.negate();
        rv.applyMatrix3(JT).normalize();
        newN[3 * i] = rv.x; newN[3 * i + 1] = rv.y; newN[3 * i + 2] = rv.z;
        // self-check on the mid wall (> 6 mm from the edge, where the old smooth normal already is radial)
        if (eV[i] > 6) { ov.fromBufferAttribute(NRM, i).normalize(); dsum += ov.dot(rv); dn++; }
      }
      const agree = dn ? dsum / dn : 0;
      // applied only if the object-space mapping reproduces the old mid-wall normals (no GPU check was possible when this
      // was written: a wrong mapping would turn the cuff black, so it guards itself)
      let fixed = 0;
      if (agree > 0.9) {
        for (let i = 0; i < n; i++) if (!Number.isNaN(newN[3 * i])) { NRM.setXYZ(i, newN[3 * i], newN[3 * i + 1], newN[3 * i + 2]); fixed++; }
        NRM.needsUpdate = true;
      }
      info['cuffNormals' + side] = { fixed, midWallAgree: +agree.toFixed(3), n: dn };
    }
    let rs = 0, rn = 0; for (let i = 0; i < n; i++) if (outer[i]) { rs += rr[i]; rn++; }
    const Rm = rn ? rs / rn : 38;
    const cuff = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cuff[3 * i] = eV[i]; cuff[3 * i + 1] = th[i] * Rm;
      cuff[3 * i + 2] = outer[i] && Math.abs(th[i]) < 150 * D2R ? 1 : 0;
    }
    o.geometry.setAttribute('_cuff', new THREE.BufferAttribute(cuff, 3));
    // cycle 2 round 2: '_cuffX' = (mm past the LOCAL sleeve hem per angle - rewritten per sub-frame by pianist.js from the
    // skinned hem ring -, outer wall flag, e) -> contact line under the hem, dark inside the sleeve, dark inner face
    const cx = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cx[3 * i] = 50; cx[3 * i + 1] = outer[i]; cx[3 * i + 2] = eV[i]; }
    const cxA = new THREE.BufferAttribute(cx, 3); cxA.setUsage(THREE.DynamicDrawUsage);
    o.geometry.setAttribute('_cuffX', cxA);
    cuffMeshes[side] = o;
    // pearl button on the top layer: e = 7 mm, c = +11 mm; surface point from the outer-wall vertices (inverse distance)
    const eB = opts.cuffButtonE ?? 8.3, cB = opts.cuffButtonC ?? 8.0, Rp = opts.cuffButtonR ?? 3.9;
    let wsum = 0; const Pp = new THREE.Vector3(), Np = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (!outer[i]) continue;
      const de = cuff[3 * i] - eB, dc = cuff[3 * i + 1] - cB, d2 = de * de + dc * dc;
      if (d2 > 400) continue;
      const w = 1 / (d2 + 1);
      Pp.x += w * CP[3 * i]; Pp.y += w * CP[3 * i + 1]; Pp.z += w * CP[3 * i + 2]; wsum += w;
    }
    if (wsum > 0 && opts.cuffButton !== false) {
      Pp.multiplyScalar(1 / wsum);
      // re-project on the cylinder at the wanted angle / height (the IDW mean sits inside the faceted wall)
      const t = cB / Rm; const dir = D1.clone().multiplyScalar(Math.cos(t)).addScaledVector(D2, Math.sin(t)).normalize();
      q.copy(Pp).sub(f.W); const d = q.dot(f.A); q.addScaledVector(f.A, -d);
      const rOut = q.length() + 0.0006;     // + the 0.55 mm overlap layer
      const sE = fitW ? fitW.edgeAt(Math.atan2(dir.dot(fitW.E2), dir.dot(fitW.E1))) : sMax;
      const C = f.W.clone().addScaledVector(f.A, (sE - eB) / 1000).addScaledVector(dir, rOut - 0.0002);
      Np.copy(dir);
      const g = latheButton(THREE, PEARL_PROFILE, Rp, new THREE.Vector3(), Np, perp(THREE, f.A, Np), 32);
      const P = g.attributes.position, v = new THREE.Vector3(), Nn = g.attributes.normal, rot = new THREE.Matrix3().setFromMatrix4(rootInv);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).add(C).applyMatrix4(rootInv); P.setXYZ(i, v.x, v.y, v.z);
        v.fromBufferAttribute(Nn, i).applyMatrix3(rot).normalize(); Nn.setXYZ(i, v.x, v.y, v.z);
      }
      // skin: the cuff vertex nearest the button
      let vi = 0, dm = 1e9;
      for (let i = 0; i < n; i++) { const dd = Math.hypot(CP[3 * i] - C.x, CP[3 * i + 1] - C.y, CP[3 * i + 2] - C.z); if (dd < dm) { dm = dd; vi = i; } }
      pearlGeoms.push({ g, src: o, vi });
    }
    info.cuffs++;
    info['cuff' + side] = { radiusMm: +Rm.toFixed(1), edgeMm: +sMax.toFixed(1) };
  }
  if (pearlGeoms.length) {
    const geom = mergeGeoms(THREE, pearlGeoms.map((x) => x.g));
    const n = geom.attributes.position.count, SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    let off = 0;
    for (const { g, src, vi } of pearlGeoms) {
      // the cuff's own skeleton may index bones differently: map through bone objects to the suit skeleton order
      const bl = skel.bones;
      for (let i = 0; i < g.attributes.position.count; i++) for (let k = 0; k < 4; k++) {
        const bi = src.geometry.attributes.skinIndex.getComponent(vi, k);
        SI[4 * (off + i) + k] = Math.max(0, bl.indexOf(src.skeleton.bones[bi]));
        SW[4 * (off + i) + k] = src.geometry.attributes.skinWeight.getComponent(vi, k);
      }
      off += g.attributes.position.count;
    }
    geom.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    geom.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    const mesh = new THREE.SkinnedMesh(geom);
    mesh.name = 'Pianist_cuff_buttons'; mesh.userData.agKind = 'pearl';
    root.add(mesh); mesh.updateMatrixWorld(true); mesh.bind(skel, mesh.matrixWorld);
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    newMeshes.push(mesh);
  }
  void cuffSrc;
  info.localScale = { ..._jScale };
  info.hemRingVerts = { R: hemRing.R.length, L: hemRing.L.length };
  return { uBtn, vent, meshes: newMeshes, info, hemRing, suit, cuffMeshes };
}
