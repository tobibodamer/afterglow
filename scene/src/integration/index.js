// Integration glue (slot 'integration', loaded LAST by scene/src/main.js MODULE_SLOTS). Owner: the integrator.
// docs/INTEGRATION.md describes how the film is assembled; this module only connects modules that already exist and
// never edits their files. What it does:
//   create()      - asserts / completes the rig wiring once every module exists:
//                     piano group in the rig at (KB_CENTER_X, RIG_Y_OFFSET, 0) mirrored in x (docs/PIANO.md section 1)
//                     pianist group in the rig at (0, RIG_Y_OFFSET, KEY_FRONT_Z) unrotated (assets/pianist/README.md)
//                     bench at the pianist's seat height (0.47 m; piano.setBenchHeight, idempotent)
//                     water rings from the solver's ripple events (perf.json 'ripples', rig frame; the world re-projects
//                     them through ctx.rigGroup every frame, so the per-shot rig-yaw cheat moves them with the piano)
//                     world lighting hooks (world.glowLight, world.envMap) present for the piano kicker / pianist rim
//                   and records the result in info().wiring (AG.info().integration).
//   beforeFrame() - per-shot module looks from the edit: a shot spec in scene/src/camera/shots.js (or auto.js) may carry
//                     piano: { lacquerLook: 'auto'|'wide'|'close'|'physical'|{...} }
//                   (default: the session option moduleOptions.piano.lacquerLook, else 'auto'). Stateless: set every frame.
//   probe()       - read-only inspection for the integration checks (sandbox/integration/sync.mjs): the key / hammer /
//                   damper / pedal values the piano actually applied, the pianist's skinned fingertips in the piano
//                   frame, the right foot, and the ripple packets the water shader received, at any film time.
// Everything that reaches a pixel stays a pure function of t (probe() is never called by the render drivers).
import * as THREE from 'three';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

export async function create(ctx) {
  const { modules: M } = ctx;
  const world = M.world || null, piano = M.piano || null, pianist = M.pianist || null;
  let L = null;
  try { L = await import('../piano/layout.js'); } catch (e) { /* placeholder piano: no layout */ }
  // the edit the core renders (ctx.cameraSource: shots.js for the film, auto.js in the player), else the film's
  let cam = ctx.cameraSource && ctx.cameraSource.director ? ctx.cameraSource : null;
  if (!cam) try { cam = await import('../camera/shots.js'); } catch (e) { /* no edit */ }
  const opts = (ctx.options && ctx.options.integration) || {};
  const pianoOpts = (ctx.options && ctx.options.piano) || {};
  const pianistOpts = (ctx.options && ctx.options.pianist) || {};

  // ------------------------------------------------------------------------------------------- wiring (once)
  const wiring = { ok: true, checks: [], fixes: [], glue: [] };
  const check = (name, ok, detail) => { wiring.checks.push({ name, ok: !!ok, detail }); if (!ok) wiring.ok = false; };
  const RIG_Y = L ? L.RIG_Y_OFFSET : -0.04, KFZ = L ? L.KEY_FRONT_Z : 0.022, KBX = L ? L.KB_CENTER_X : 0.78;

  if (piano && piano.group && L) {
    const g = piano.group, p = g.position, s = g.scale;
    check('piano group in rig at (KB_CENTER_X, RIG_Y_OFFSET, 0), scale (-1,1,1)', g.parent === ctx.rigGroup && near(p.x, KBX) && near(p.y, RIG_Y) && near(p.z, 0) && s.x === -1 && s.y === 1 && s.z === 1,
      { parent: g.parent && g.parent.name, pos: p.toArray(), scale: s.toArray() });
  }
  if (pianist && pianist.group) {
    const g = pianist.group, p = g.position;
    const ok = g.parent === ctx.rigGroup && near(p.x, 0) && near(p.y, RIG_Y) && near(p.z, KFZ) && near(g.rotation.x, 0) && near(g.rotation.y, 0) && near(g.rotation.z, 0);
    check('pianist group in rig at (0, RIG_Y_OFFSET, KEY_FRONT_Z), unrotated', ok, { parent: g.parent && g.parent.name, pos: p.toArray(), rot: [g.rotation.x, g.rotation.y, g.rotation.z] });
    if (!ok && opts.fixPlacement !== false) {
      if (g.parent !== ctx.rigGroup) ctx.rigGroup.add(g);
      g.position.set(0, RIG_Y, KFZ); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
      wiring.fixes.push('pianist group re-placed in the rig');
    }
  }
  const benchHeight = pianistOpts.benchHeight ?? 0.47;
  if (piano && typeof piano.setBenchHeight === 'function') { piano.setBenchHeight(benchHeight); check('bench height = pianist seat', true, { benchHeight }); }

  const perfMeta = ctx.data && ctx.data.perfMeta;
  const perfRipples = (perfMeta && Array.isArray(perfMeta.ripples)) ? perfMeta.ripples : [];
  if (world && typeof world.info === 'function') {
    let src = world.info().ripples?.source;
    if (perfRipples.length && src !== 'perf' && typeof world.setPerfRipples === 'function' && opts.perfRipples !== false) {
      world.setPerfRipples(perfRipples); src = world.info().ripples?.source; wiring.fixes.push('world.setPerfRipples(perf.json ripples)');
    }
    check('water rings driven by the solver ripples (rig frame)', !perfRipples.length || src === 'perf', { source: src, perfEvents: perfRipples.length, worldEvents: world.info().ripples?.events });
    check('world lighting hooks (glowLight, envMap getter)', !!world.glowLight && 'envMap' in world, { glowLight: !!world.glowLight });
  }
  check('perf tracks loaded (perf.json + perf.bin)', !!(perfMeta && ctx.data.perf), { frames: perfMeta && perfMeta.frames, stride: perfMeta && perfMeta.stride, sha256: perfMeta && perfMeta.sha256 });
  if (pianist && typeof pianist.info === 'function') { const pi = pianist.info(); check('pianist bones driven by perf tracks', !!pi.tracks && pi.boneTracks > 60, { boneTracks: pi.boneTracks }); }
  // The camera's hand-following shots aim at a hand track solved from ONE performance solve (camera/handtrack.json,
  // sandbox/camera/handtrack.mjs). If build/anim holds a newer solve, the camera frames where the hands used to be
  // (MODULE_ISSUES I-27: run C track with f1k tracks = 42-57 px view shift in S06/S08/S11/S15/S16b/S24). Flag it.
  if (cam && cam.hands && perfMeta) {
    const htSha = cam.hands.perfSha || null, src = cam.hands.source;
    check('camera hand track solved from the rendered performance (handtrack perf sha = perf.json sha256)', src === 'perf' && htSha === perfMeta.sha256,
      { handtrack: cam.HANDTRACK_URL, source: src, handtrackPerf: htSha && htSha.slice(0, 8), perf: perfMeta.sha256 && perfMeta.sha256.slice(0, 8) });
  }
  // Motion-blur N boost table (scene/src/integration/motion_n.json, main.js MOTION_N_URL): solved from one perf and the
  // edit's per-shot N. A stale table is ignored by the page (no boost) -> flag it so the snapshot is re-solved.
  const mn = ctx.data && ctx.data.motionN;
  if (mn && perfMeta && cam && cam.director) {
    const editN = {}; for (const s of cam.director.shots) editN[s.id] = s.settings ? s.settings.N : undefined;
    const stale = Object.entries(mn.editN || {}).filter(([id, n]) => editN[id] !== undefined && editN[id] !== n).map(([id, n]) => `${id} ${n}->${editN[id]}`);
    check('motion-blur N boost solved from the rendered performance and edit (table perf sha = perf.json sha256, edit N unchanged)', mn.perfOk && !stale.length,
      { frames: Object.keys(mn.frames || {}).length, targetPx: mn.targetPx, extraSubframes: mn.extraSubframes, tablePerf: mn.perfSha && mn.perfSha.slice(0, 8), perf: perfMeta.sha256 && perfMeta.sha256.slice(0, 8), staleShots: stale });
  }
  if (cam && cam.FILM_FRAMES) wiring.film = { frames: cam.FILM_FRAMES, filmEnd: cam.FILM_END, shots: cam.SHOTS.length, score: cam.SCORE_URL };
  for (const c of wiring.checks) if (!c.ok) console.warn('[AG] integration check FAILED:', c.name, JSON.stringify(c.detail));

  // ------------------------------------------------------------------------------------------- per-shot looks
  const specOf = (shot) => {
    const raw = shot && shot.raw;
    if (!raw || raw._i == null || !cam || !cam.director) return null;
    const s = cam.director.shots[raw._i];
    return s ? s.spec : null;
  };
  const defaultLook = pianoOpts.lacquerLook ?? 'auto';
  // pianist looks per shot: the pianist module reads info.shot.raw.pianist in ITS beforeFrame (slot order runs it
  // before this module), but the edit's shotAt() does not copy spec.pianist into the shot. Forward it by wrapping the
  // pianist's beforeFrame (the shot object is a fresh one per frame, so this never leaks into the next frame).
  if (pianist && typeof pianist.beforeFrame === 'function' && cam && cam.director) {
    const inner = pianist.beforeFrame.bind(pianist);
    pianist.beforeFrame = (frame, t, info) => {
      const sp = specOf(info && info.shot);
      if (sp && sp.pianist && info.shot.raw && !info.shot.raw.pianist) info = { ...info, shot: { ...info.shot, raw: { ...info.shot.raw, pianist: sp.pianist } } };
      return inner(frame, t, info);
    };
    wiring.glue.push('per-shot pianist looks forwarded from the edit (spec.pianist -> shot.raw.pianist)');
  }

  // ------------------------------------------------------------------------------------------- probe (checks only)
  // The GLB's 'Pianist_body' has several primitives (head/neck skin, HANDS, sock), which GLTFLoader loads as separate
  // SkinnedMeshes; the fingertip probe uses the hand-skin and nail meshes (material names from the GLB, kept with a
  // '.film' suffix by the pianist module), or every skinned mesh when none is recognised.
  const skinned = [];
  if (pianist && pianist.group) pianist.group.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  const matName = (o) => (Array.isArray(o.material) ? o.material.map((m) => m.name).join('|') : (o.material && o.material.name) || '');
  const handMeshes = skinned.filter((o) => /skin_hand|nail/i.test(matName(o)));
  const tipMeshes = handMeshes.length ? handMeshes : skinned;
  const body = tipMeshes[0] || null; const distal = new Map();
  /** [{mesh, idx: vertex indices weighted > 0.6 to boneName}] over the tip meshes */
  function distalVerts(boneName) {
    if (distal.has(boneName)) return distal.get(boneName);
    const out = [];
    for (const mesh of tipMeshes) {
      const bi = mesh.skeleton.bones.findIndex((b) => b.name === boneName);
      if (bi < 0) continue;
      const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, idx = [];
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === bi && sw.getComponent(i, c) > 0.6) { idx.push(i); break; }
      if (idx.length) out.push({ mesh, idx });
    }
    distal.set(boneName, out);
    return out;
  }
  const pianoBody = piano && piano.group ? piano.group.children.find((o) => o.name === 'pianoBody') || piano.group : null;
  const v = new THREE.Vector3();
  const centreSub = (t) => ({ k: -1, N: 1, frame: Math.round(t * ctx.FPS), time: t, frameT: t, centre: true, camera: ctx.camera, shutterPos: 0.5,
    jitter: { x: 0, y: 0 }, lens: { x: 0, y: 0, dx: 0, dy: 0, radius: 0 }, seed: 0, dim: () => 0.5 });

  /**
   * probe({ t, fingers: [{hand:'R'|'L', finger:1..5}], foot: true, ripples: true })
   * Poses piano + pianist at film time t (frame-centre sub) and returns what the scene shows. Only for checks: the
   * next renderFrame re-poses everything from t (all modules are pure functions of t).
   */
  function probe({ t, fingers = [], foot = true, ripples = false } = {}) {
    if (piano) piano.update(t, centreSub(t));
    if (pianist) pianist.update(t, centreSub(t));
    ctx.scene.updateMatrixWorld(true);
    const out = { t };
    if (piano && piano.parts) {
      out.keys = Array.from(piano.parts.keys.angles);
      out.hammers = Array.from(piano.parts.action.hammerAng);
      out.dampers = Array.from(piano.parts.action.damperLift);
      out.pedals = Array.from(piano.parts.legs.pedalAng);
      out.hammerStrike = Array.from(piano.hammerStrikeAngles);
    }
    out.fingers = fingers.map(({ hand, finger }) => {
      const bone = `finger${finger}-3_${hand}`;
      if (!body || !pianoBody) return { hand, finger, bone, verts: 0, lowest: null, why: !body ? 'no skinned pianist mesh' : 'no piano body' };
      let low = null, n = 0;
      for (const { mesh, idx } of distalVerts(bone)) {
        for (const i of idx) {
          mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); pianoBody.worldToLocal(v);   // skinned (bone matrixWorld)
          if (!low || v.y < low[1]) low = [v.x, v.y, v.z];
        }
        n += idx.length;
      }
      return { hand, finger, bone, verts: n, lowest: low };
    });
    out.tipMeshes = tipMeshes.map((o) => `${o.name}:${matName(o)}`);
    if (foot && pianist && pianist.bones && pianoBody) {
      const fb = pianist.bones.get('foot_R'), tb = pianist.bones.get('toe1-1_R') || pianist.bones.get('toes_R');
      if (fb) { fb.getWorldPosition(v); pianoBody.worldToLocal(v); out.footR = v.toArray(); }
      if (tb) { tb.getWorldPosition(v); pianoBody.worldToLocal(v); out.toeR = v.toArray(); }
    }
    if (ripples && world && world.water && world.water.material && world.water.material.uniforms) {
      const U = world.water.material.uniforms;
      const n = U.uNumEv ? U.uNumEv.value : 0;
      out.ripplePackets = U.uEvA ? U.uEvA.value.slice(0, n).map((e) => [e.x, e.y, e.z, e.w]) : [];
      out.rigMatrix = ctx.rigGroup.matrixWorld.toArray();
    }
    return out;
  }

  return {
    parent: 'rig',
    beforeFrame(frame, t, info) {
      if (!piano || typeof piano.setLacquerLook !== 'function') return;
      const sp = specOf(info.shot);
      const look = (sp && sp.piano && sp.piano.lacquerLook) ?? defaultLook;
      piano.setLacquerLook(look);
    },
    update() {},
    probe,
    info: () => ({ wiring }),
    get wiring() { return wiring; },
  };
}

export default create;
