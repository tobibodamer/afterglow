// Afterglow pianist: dorsal hand hair (cycle 2, critic c2r1 / I-34: "no dorsal hair, which refs 7, 8 and 12 all show at
// 1080p"). Built once at load from the BIND pose of the hand skin primitive (material 'pianist_skin_hand'), deterministic
// (seeded hash, no wall clock), no pipeline change:
//  * roots sampled area-weighted on the dorsal faces (face normal . up in the seated bind pose, hands on the keys) of the
//    metacarpal region (dense), the proximal phalanges (sparser) and the wrist / thumb (sparse), density in strands / mm^2;
//  * each strand leaves the skin at 10-22 deg toward the distal direction of its bone (+ ulnar / random spread), bends
//    back toward the skin (hairs lie down), length 2.5-7 mm, flat ribbon in the skin's tangent plane, 0.06 -> 0.02 mm wide;
//  * skinned to the nearest triangle corner's joints / weights (same skeleton as the hand).
// Returns { mesh, info } or null. The module gives it a dark-brown material that catches the glow rim.

function rng(seed) {          // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildHandHair(THREE, { root, meshes, opts = {} }) {
  const hand = meshes.find((o) => o.isSkinnedMesh && o.material && o.material.name === 'pianist_skin_hand');
  if (!hand || !hand.geometry.index) return null;
  (root.parent || root).updateMatrixWorld(true);
  const G = hand.geometry, P = G.attributes.position, n = P.count, I = G.index.array;
  const W = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i); hand.applyBoneTransform(i, v); v.applyMatrix4(hand.matrixWorld); W[3 * i] = v.x; W[3 * i + 1] = v.y; W[3 * i + 2] = v.z; }
  const SI = G.attributes.skinIndex, SW = G.attributes.skinWeight, bones = hand.skeleton.bones;
  const domName = (i) => { let b = -1, w = -1; for (let k = 0; k < 4; k++) { const x = SW.getComponent(i, k); if (x > w) { w = x; b = SI.getComponent(i, k); } } return bones[b] ? bones[b].name : ''; };
  // distal direction per bone (world, bind): bone -> first child; region density (strands / mm^2)
  const dens = opts.handHairDensity ?? 1.0;
  const region = (name) => {
    // cycle 2 round 2 (critic c2r2: 0.85 strands/mm^2 read as black pepper; ref 8: hair on the wrist, sparse on the hand)
    // cycle 3 (critic c3: 0.06 on the proximal phalanges still read as dashes): none there; metacarpals denser but clumped
    // and graded toward the wrist (below)
    // cycle 3 r2 (critic c3r2: a few thick dark dashes): more, finer, fainter strands (width 0.09 -> 0.05 mm, alpha 0.85 -> 0.5)
    if (/^metacarpal[1-4]_/.test(name)) return 0.45;
    if (/^finger[2-5]-1_/.test(name)) return opts.handHairPhalanx ?? 0.0;
    if (/^finger1-1_/.test(name)) return 0.03;
    if (/^wrist_/.test(name)) return 0.8;
    return 0;
  };
  const dirCache = new Map(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const distal = (name) => {
    if (dirCache.has(name)) return dirCache.get(name);
    const b = bones.find((x) => x.name === name); let d = new THREE.Vector3(0, 0, 1);
    if (b) {
      let c = b.children.find((x) => x.isBone) || null;
      if (/^wrist_/.test(name)) c = b.children.find((x) => /^metacarpal2_/.test(x.name)) || b.children.find((x) => /^metacarpal/.test(x.name)) || c;
      // cycle 3 r2: the wrist's old target was the HEAD of metacarpal2 (MPFB: metacarpal2 -> finger3 = middle finger), a few mm
      // away and sideways in the carpus -> wrist head to that metacarpal's CHILD (the middle knuckle) = the hand axis
      if (/^wrist_/.test(name) && c) c = c.children.find((x) => x.isBone) || c;
      b.getWorldPosition(pa);
      // cycle 3 r2 BUG FIX (critic c3r2 hairdir: strokes median 56 deg off the arm axis, 75 % > 45 deg; CPU top view 73 deg):
      // 'd = pb.sub(pa)' cached the SHARED temp vector pb, which boneT() (cycle 3) then overwrote with a bone POSITION -> every
      // strand used one bogus direction (mostly +y, i.e. across the dorsum after the tangent projection). Own copy now.
      if (c) { c.getWorldPosition(pb); d = pb.clone().sub(pa).normalize(); }
      else if (b.parent) { b.parent.getWorldPosition(pb); d = pa.clone().sub(pb).normalize(); }
    }
    dirCache.set(name, d); return d;
  };
  const rand = rng(opts.handHairSeed ?? 20261022);
  // cycle 3 (critic c3: 'short, parallel, equal-length dark dashes evenly over the dorsum'; refs: clumped flowing tufts on the
  // proximal dorsum): a 3-D value-noise clump field (~3.5 mm cells) concentrates the roots into tufts, the density falls off
  // from the wrist toward the knuckles (metacarpals: x (1 - 0.75 t), t = 0 at the wrist joint .. 1 at the knuckle), and each
  // tuft shares one flow angle (second noise field) instead of independent per-hair spread
  const hh = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn3 = (x, y, z, sd) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const c = (i, j, k) => hh(xi + i + sd, yi + j, zi + k);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy), l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
  };
  const clumpMm = opts.handHairClumpMm ?? 3.5, clumpAmt = opts.handHairClump ?? 1.0;
  const clumpW = (p) => { const c = vn3(p.x * 1000 / clumpMm, p.y * 1000 / clumpMm, p.z * 1000 / clumpMm, 17); const w = Math.max(0, (c - 0.42) / 0.33); return 1 - clumpAmt + clumpAmt * 2.4 * w * w; };
  // cycle 3 r2: flow noise +-0.35 -> +-0.15 rad (critic: strands along the bone's distal axis, flow noise <= +-0.15)
  const flowA = (p) => (vn3(p.x * 1000 / 5, p.y * 1000 / 5, p.z * 1000 / 5, 91) - 0.5) * (opts.handHairFlow ?? 0.3);
  // cycle 3 r2 (critic c3r2: the hair stops at the hand-set seam next to the cuff - the body strip has none): roots fade out
  // toward the hand skin's open boundary (the wrist seam), 0 within 3 mm, full at 15 mm
  const bnd = [];
  {
    const ec = new Map(), ek = (x, y) => (x < y ? x * 4194304 + y : y * 4194304 + x);
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const k = ek(I[t + e], I[t + (e + 1) % 3]); ec.set(k, (ec.get(k) || 0) + 1); }
    const bv = new Set(); for (const [k, c] of ec) if (c === 1) { bv.add(Math.floor(k / 4194304)); bv.add(k % 4194304); }
    for (const i of bv) if (/^(wrist|lowerarm)/.test(domName(i))) bnd.push(new THREE.Vector3().fromArray(W, 3 * i));
  }
  const seamW = (p) => { if (!bnd.length) return 1; let d = 1e9; for (const q of bnd) d = Math.min(d, q.distanceToSquared(p)); d = Math.sqrt(d) * 1000; const x = Math.min(1, Math.max(0, (d - 3) / 12)); return x * x * (3 - 2 * x); };
  const boneT = (name, p) => {
    const b = bones.find((x) => x.name === name); if (!b) return 0;
    const c = b.children.find((x) => x.isBone); if (!c) return 0;
    b.getWorldPosition(pa); c.getWorldPosition(pb); const ab = pb.clone().sub(pa); const l2 = ab.lengthSq(); if (l2 < 1e-10) return 0;
    return Math.min(1, Math.max(0, p.clone().sub(pa).dot(ab) / l2));
  };
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  const roots = [];
  const maxN = opts.handHairMax ?? 14000;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    A.fromArray(W, 3 * a); B.fromArray(W, 3 * b); C.fromArray(W, 3 * c);
    e1.subVectors(B, A); e2.subVectors(C, A); fn.crossVectors(e1, e2);
    const area = fn.length() * 0.5 * 1e6; if (area <= 0) continue;     // mm^2
    fn.normalize();
    // outward normal: the bind-pose hands lie palm-down on the keys -> dorsal faces point up
    const nm = domName(a), rg = region(nm); if (!rg) continue;
    const dors = Math.min(1, Math.max(0, (fn.y - 0.2) / 0.45));
    const cen = A.clone().add(B).add(C).multiplyScalar(1 / 3);
    const grad = /^metacarpal/.test(nm) ? 1 - 0.75 * boneT(nm, cen) : 1;
    const lam = area * dens * rg * dors * grad * clumpW(cen) * seamW(cen); if (lam <= 0) continue;
    let k = Math.floor(lam); if (rand() < lam - k) k++;
    for (let j = 0; j < k; j++) {
      let u = rand(), w = rand(); if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const p = A.clone().multiplyScalar(1 - u - w).addScaledVector(B, u).addScaledVector(C, w);
      const corner = (1 - u - w) >= u && (1 - u - w) >= w ? a : (u >= w ? b : c);
      roots.push({ p, n: fn.clone(), d: distal(nm), corner, tri: [a, b, c], bw: [1 - u - w, u, w], side: /_R$/.test(nm) ? 1 : -1 });
    }
  }
  if (roots.length > maxN) {      // deterministic thinning
    const keep = maxN / roots.length; const r2 = rng(7); for (let i = roots.length - 1; i >= 0; i--) if (r2() > keep) roots.splice(i, 1);
  }
  const SEG = 4, VPS = (SEG + 1) * 2, ns = roots.length;
  // '_hoff' = object-space offset centre line -> ribbon edge, '_hu' = 0 root .. 1 tip: the module widens each ribbon to at
  // least ~1 px and scales its (hashed, stratified) coverage down by the same factor (critic c2r2: 0.02-0.06 mm ribbons far
  // below the pixel footprint aliased into dots that boiled frame to frame)
  const hoff = new Float32Array(ns * VPS * 3), hu = new Float32Array(ns * VPS);
  const pos = new Float32Array(ns * VPS * 3), uv = new Float32Array(ns * VPS * 2), si = new Uint16Array(ns * VPS * 4), sw = new Float32Array(ns * VPS * 4);
  const idx = new Uint32Array(ns * SEG * 6);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const tdir = new THREE.Vector3(), side = new THREE.Vector3(), q = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let vi = 0, ii = 0;
  const r3 = rng(99);
  for (const s of roots) {
    // direction: distal projected on the tangent plane, + ulnar bias (hand hair slants toward the little finger) + spread
    tdir.copy(s.d).addScaledVector(s.n, -s.d.dot(s.n));
    if (tdir.lengthSq() < 1e-8) tdir.set(1, 0, 0).addScaledVector(s.n, -s.n.x);
    tdir.normalize();
    side.crossVectors(s.n, tdir).normalize();
    // consistent distal-ulnar flow, low spread (critic c2r2: random crossings read as hatching)
    const spread = (r3() - 0.5) * (opts.handHairSpread ?? 0.12) + flowA(s.p) + (opts.handHairUlnar ?? 0.15) * s.side;   // cycle 3 r2: ulnar 0.25 -> 0.15
    tdir.multiplyScalar(Math.cos(spread)).addScaledVector(side, Math.sin(spread)).normalize();
    side.crossVectors(s.n, tdir).normalize();
    const L = (3.0 + 5.0 * Math.pow(r3(), 1.2)) / 1000, ang = (10 + 12 * r3()) * Math.PI / 180, bend = 0.6 + 0.6 * r3();
    const w0 = (opts.handHairWidthMm ?? 0.05) / 1000, curl = (0.08 + 0.14 * r3()) * s.side;      // gentle sideways curve (cycle 3 r2: 0.25-0.6 -> 0.08-0.22, width 0.09 -> 0.05 mm)
    // skin weights interpolated over the root's triangle (top 4; critic c2r2: nearest-corner roots drifted up to 2.2 mm)
    const wm = new Map();
    for (let t = 0; t < 3; t++) for (let c = 0; c < 4; c++) { const j = SI.getComponent(s.tri[t], c), x = SW.getComponent(s.tri[t], c) * s.bw[t]; if (x > 0) wm.set(j, (wm.get(j) || 0) + x); }
    const top = [...wm.entries()].sort((p1, p2) => p2[1] - p1[1] || p1[0] - p2[0]).slice(0, 4), tw = top.reduce((x, e) => x + e[1], 0) || 1;
    const base = vi;
    for (let k = 0; k <= SEG; k++) {
      const x = k / SEG;
      // height above the skin: rises at 'ang' and is pulled back down by 'bend' (lies on the skin toward the tip)
      const h = L * (Math.sin(ang) * x - 0.5 * bend * Math.sin(ang) * x * x) + 0.00003;
      q.copy(s.p).addScaledVector(tdir, L * Math.cos(ang) * x).addScaledVector(side, curl * L * 0.18 * x * x).addScaledVector(s.n, Math.max(h, 0.00002 + 0.00013 * x));
      const hw = 0.5 * w0 * (1 - 0.85 * x), cp = q.clone().applyMatrix4(rootInv);
      for (let e = 0; e < 2; e++) {
        const pp = q.clone().addScaledVector(side, e ? hw : -hw).applyMatrix4(rootInv);
        pos[3 * vi] = pp.x; pos[3 * vi + 1] = pp.y; pos[3 * vi + 2] = pp.z;
        hoff[3 * vi] = pp.x - cp.x; hoff[3 * vi + 1] = pp.y - cp.y; hoff[3 * vi + 2] = pp.z - cp.z; hu[vi] = x;
        uv[2 * vi] = e; uv[2 * vi + 1] = x;
        for (let c = 0; c < 4; c++) { si[4 * vi + c] = top[c] ? top[c][0] : 0; sw[4 * vi + c] = top[c] ? top[c][1] / tw : 0; }
        vi++;
      }
    }
    for (let k = 0; k < SEG; k++) {
      const a0 = base + 2 * k, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
      idx[ii++] = a0; idx[ii++] = b0; idx[ii++] = a1; idx[ii++] = a1; idx[ii++] = b0; idx[ii++] = b1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('_hoff', new THREE.BufferAttribute(hoff, 3));
  g.setAttribute('_hu', new THREE.BufferAttribute(hu, 1));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(g);
  mesh.name = 'Pianist_hand_hair'; mesh.userData.agKind = 'handhair';
  // own skeleton over the same bone objects (same index order as the hand's skinIndex): inverses from the bind pose (world),
  // without the dequantisation the packed hand primitive carries in its inverse bind matrices
  const skel = new THREE.Skeleton(hand.skeleton.bones);
  root.add(mesh); mesh.updateMatrixWorld(true); mesh.bind(skel, mesh.matrixWorld);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
  return { mesh, info: { strands: ns, verts: vi, tris: ii / 3 } };
}
