// Afterglow film: module registry + per-frame orchestration (DESIGN.md sections 3-5). index.html exposes the
// returned API as window.AG; the Node driver (render/) calls it one frame at a time. The page never runs a loop.
//
// Per output frame f (t = f / 60 exactly, m = t - MUSIC_OFFSET):
//   shot = director.shotAt(t); settings = defaults < shot < session overrides < frame opts
//   rig yaw (120 deg + shot cheat), sun (elevation arc or shot override)
//   camera posed at the frame centre (no aperture offset, no jitter); ctx.subframe = centreSub (k = -1)
//   module.beforeFrame(f, t, info)                    every module, in slot order
//   module.update(t, centreSub)                       pose at the frame centre (for bakes / captures)
//   sky bakes (registerSkyBake)                       once per output frame, before sub-frames
//   module bakes: 'shot' (when the shot changes) and 'frame'
//   env captures (registerEnvCapture)
//   for k < N (fixed stratified table, core/rng.js: CMJ jitter, aperture and module dims, stratified shutter time,
//              the groups paired to sub-frames so that time, aperture, jitter and dims are decorrelated):
//     t_k = t + (s_k.t - 0.5) * shutter / 60          centred shutter: no lag against the audio
//     camera state at t_k (lens per sub-frame) -> ctx.subframe
//     module.update(t_k, sub)                         every module
//     camera pose + thin-lens offset/shear + pixel jitter
//     pre-subframe hooks (registerPreSubframe)        e.g. shadow-light jitter, hashed-alpha seeds
//     render -> RGBA16F scene RT -> (DOF gap-fill pre-blur) -> += 1/N into RGBA32F accumulation
//   final pass: veiling glare -> PBR Neutral -> grade -> LUT -> grain -> TPDF dither -> RGBA8
//   readback / pipelined upload (driver's choice)
import * as THREE from 'three';
import { FPS, MUSIC_OFFSET, BASE_RIG_YAW_DEG, DEFAULT_SHUTTER, frameToTime, filmToMusic, musicToFilm, timeToFrame } from './core/constants.js';
import { AccumRenderer } from './core/accum.js';
import { FinalPass, DEFAULT_GRADE, DEBUG_VIEWS } from './core/final.js';
import { FrameIO } from './core/frameio.js';
import { CameraDirector, resolveWorld, DEFAULT_CAMERA } from './core/camera.js';
import * as LENS from './core/lens.js';
import * as RNG from './core/rng.js';
import * as GLSL from './core/glsl.js';
import { createSun, dirFromAzEl, sunElevationAt } from './core/sun.js';
import { loadData, loadDataMap, urlExists } from './core/data.js';
import { CubeProbe, withAutoClear } from './core/envprobe.js';
import { createRenderer, gpuInfo, syncGPU, watchContext } from './core/gpu.js';
import { loadLut, lutTexture, parseCube, fromFloat32 } from './core/lut.js';

// ---------------------------------------------------------------------------------------------------------------
// MODULE CONFIG. Slots load in this order. 'auto' (the default policy) uses the real module when its file exists and
// the placeholder otherwise, so real modules replace placeholders one by one just by appearing. Per render:
// AG.init({ modules: 'placeholders' }) or { world: 'placeholder' | 'real' | 'off' | '<url>', extra: ['<url>', ...] }.
// parent: where a returned `group` is attached ('world' = worldGroup, 'rig' = rigGroup with the rig yaw applied).
// Slots without a placeholder (placeholder: null) are skipped when their file is missing or under the 'placeholders'
// policy: 'camera' (scene/src/camera/index.js: the edit's sun arc pinned on the world, rig-yaw check, diagnostics; the
// camera POSE itself comes from shots.js through the CameraDirector) and 'integration' (scene/src/integration/index.js:
// rig wiring checks, per-shot module looks, the probe used by the integration checks). docs/INTEGRATION.md.
export const MODULE_SLOTS = [
  { slot: 'world', url: './world/index.js', placeholder: './core/placeholders/world.js', parent: 'world' },
  { slot: 'piano', url: './piano/index.js', placeholder: './core/placeholders/piano.js', parent: 'rig' },
  { slot: 'pianist', url: './pianist/index.js', placeholder: './core/placeholders/pianist.js', parent: 'rig' },
  { slot: 'camera', url: './camera/index.js', placeholder: null, parent: 'world' },
  { slot: 'integration', url: './integration/index.js', placeholder: null, parent: 'rig' },
];
export const CAMERA_MODULE_URL = './camera/shots.js';
// Shared data loaded once at init into ctx.data (missing optional files resolve to null; modules must cope).
export const DEFAULT_DATA = {
  score: { url: '/music/final/score.json', optional: true },
  perfMeta: { url: '/build/anim/perf.json', optional: true },
  perf: { url: '/build/anim/perf.bin', optional: true },
};
// Grade presets by name (shots refer to them with `grade: 'name'`; modules can add via ctx.registerGradePreset).
// The film look itself is the session LUT below, so it applies to every shot whatever preset or per-shot grade object
// (exposureEV fades) the edit uses; a preset only adds to it.
export const GRADE_PRESETS = { default: {} };
// The film LUT (DESIGN.md section 6, docs/INTEGRATION.md section 7): a hand-built, constrained grade (OKLab shadow
// desaturation, hue kept; highlight roll-off toward peach) fitted on the stills that realise refs and baked into a
// 33^3 .cube by sandbox/integration/lut/bake_lut.py. It is the session LUT of every session unless AG.init({ lut })
// says otherwise: lut 'identity' | null | false = no LUT (A/B checks, self test), a URL / .cube text / Float32 table =
// that LUT. debugView 'nolut' shows a frame without it.
export const FILM_LUT_URL = './core/luts/afterglow_film.cube';
// Fix round 4 (docs/INTEGRATION.md section 8): a second film LUT for the wides and the blue hour, same grade with a
// gentler shadow desaturation (the v1 LUT turned their dark hills, piano and near water neutral grey-black where the
// refs keep navy / plum shadows). Chosen per shot class below whenever the session uses the film LUT (not with
// lut 'identity' / a custom session LUT) and the shot's own grade names no LUT. Both have the v2 gamut-aware highlights;
// the wide table is v3 since 2026-10-23 (shadow desaturation s 0.6, was 0.5; docs/INTEGRATION.md section 8.5).
export const FILM_LUT_WIDE_URL = './core/luts/afterglow_film_wide.cube';
export const FILM_LUT_CLASS = Object.freeze({ wide: Object.freeze(['S01', 'S03', 'S05', 'S10', 'S17', 'S19', 'S20', 'S23', 'S25']) });
// Fix round 4 (docs/INTEGRATION.md section 8.4): motion-blur N boost. The accumulation draws a moving edge as N copies
// disp / N apart; for the few frames where a fast hand's copies would sit > 1 px apart at the shot's own N, the table
// (sandbox/integration/blurstep.mjs --boost-out, re-solved by render/snapshot.mjs) raises that frame's N. Applied only
// in final-quality renders whose session / frame does not force N, only while the table's perf sha matches the loaded
// perf.json and the shot's edit N matches the N it was solved for (integration wiring check 9 reports it).
// AG.init({ motionBoost: false }) switches it off (A/B).
export const MOTION_N_URL = './integration/motion_n.json';
// ---------------------------------------------------------------------------------------------------------------

export const DEFAULT_SETTINGS = Object.freeze({
  // preblurKernel: the DOF gap-fill of core/accum.js ('layered' | 'disk' | 'gauss'); maxPreblurPx caps its reach (2.5 sigma).
  // 'layered' is the default since fix round 4 (A/B vs N256 in docs/INTEGRATION.md section 8.3); 'disk' / 'gauss' stay for A/B.
  N: 16, previewN: 4, shutter: DEFAULT_SHUTTER, preblur: 0, nearestDist: null, maxPreblurPx: 96, preblurKernel: 'layered',
  aaFilter: 'box', aaSigma: 0.42, blades: 9, bladeRotation: 0.3, debugView: 'none', rigYawCheatDeg: 0, sunElevationDeg: null,
});
const FRAME_SETTING_KEYS = ['N', 'shutter', 'preblur', 'nearestDist', 'maxPreblurPx', 'preblurKernel', 'aaFilter', 'aaSigma', 'blades', 'bladeRotation',
  'debugView', 'rigYawCheatDeg', 'sunElevationDeg'];

const D2R = Math.PI / 180;
const now = () => performance.now(); // timing statistics only, never pixels

function deepMerge(a, b) {
  if (!b) return a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) out[k] = deepMerge(a[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}
const pick = (o, keys) => { const r = {}; if (o) for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
const resolveUrl = (u) => (/^(\.\.?\/)/.test(u) ? new URL(u, import.meta.url).href : new URL(u, location.origin).href);

function normalizeBakes(b) {
  if (!b) return [];
  if (Array.isArray(b)) return b.map((x, i) => ({ name: x.name || `bake${i}`, when: x.when || 'init', run: x.run || x.fn }));
  return Object.entries(b).filter(([, fn]) => typeof fn === 'function').map(([when, run]) => ({ name: when, when, run }));
}

export function createFilm() {
  const S = { initDone: false, modules: [], hooks: { sky: [], env: [], pre: [] }, bakes: [], lastShotKey: null, last: null, lutCache: new Map() };

  async function resolveModules(policy = 'auto') {
    const list = [];
    for (const def of MODULE_SLOTS) {
      let choice = policy === 'placeholders' ? 'placeholder' : (policy && typeof policy === 'object' ? (policy[def.slot] ?? policy.default ?? 'auto') : 'auto');
      if (choice === 'off') continue;
      if (choice === 'placeholder' && !def.placeholder) continue;          // optional slot without a placeholder
      let url, kind;
      if (choice === 'auto') {
        const real = resolveUrl(def.url);
        if (await urlExists(real)) { url = real; kind = 'real'; }
        else if (def.placeholder) { url = resolveUrl(def.placeholder); kind = 'placeholder'; }
        else continue;
      }
      else if (choice === 'real') { url = resolveUrl(def.url); kind = 'real'; }
      else if (choice === 'placeholder') { url = resolveUrl(def.placeholder); kind = 'placeholder'; }
      else { url = resolveUrl(choice); kind = 'custom'; }
      list.push({ slot: def.slot, url, kind, parent: def.parent });
    }
    // extras that a slot already loads (e.g. './camera/index.js' from older drivers) are not created twice
    for (const [i, u] of (policy?.extra || []).entries()) { const url = resolveUrl(u); if (!list.some((m) => m.url === url)) list.push({ slot: `extra${i}`, url, kind: 'extra', parent: 'world' }); }
    return list;
  }

  function sessionSettings(opts) {
    // only what the caller set explicitly overrides shot settings
    return pick(opts, FRAME_SETTING_KEYS);
  }

  function frameSettings(shot, opts, frame = null) {
    const quality = S.quality;
    const base = { ...DEFAULT_SETTINGS };
    const shotS = { ...shot.settings };
    if (quality === 'preview') { base.N = DEFAULT_SETTINGS.previewN; delete shotS.N; }
    const st = { ...base, ...pick(shotS, FRAME_SETTING_KEYS), ...S.sessionOverrides, ...pick(opts, FRAME_SETTING_KEYS) };
    st.N = Math.max(1, Math.round(st.N));
    // motion-blur N boost (MOTION_N_URL): own-N final renders only
    const mn = S.motionN;
    if (mn && mn.perfOk && quality === 'final' && frame != null && S.sessionOverrides.N === undefined && opts.N === undefined) {
      const nb = mn.frames[frame];
      if (nb > st.N && mn.shotOf[frame] === shot.id && mn.editN[shot.id] === st.N) { st.nBase = st.N; st.N = nb; }
    }
    // grade: defaults < named preset (shot or session) < session object < frame object
    const presetName = (typeof opts.grade === 'string' && opts.grade) || (typeof S.sessionGrade === 'string' && S.sessionGrade) || (typeof shotS.grade === 'string' && shotS.grade) || 'default';
    if (!GRADE_PRESETS[presetName]) throw new Error(`unknown grade preset "${presetName}"`);
    let grade = deepMerge(DEFAULT_GRADE, GRADE_PRESETS[presetName]);
    if (shotS.grade && typeof shotS.grade === 'object') grade = deepMerge(grade, shotS.grade);
    if (S.sessionGrade && typeof S.sessionGrade === 'object') grade = deepMerge(grade, S.sessionGrade);
    if (opts.grade && typeof opts.grade === 'object') grade = deepMerge(grade, opts.grade);
    st.grade = grade; st.gradePreset = presetName;
    return st;
  }

  async function lutFor(grade) {
    if (!grade.lut) return null;
    const key = typeof grade.lut === 'string' ? grade.lut : null;
    if (key && S.lutCache.has(key)) return S.lutCache.get(key);
    const tex = lutTexture(key ? await loadLut(key) : (grade.lut.size ? grade.lut : fromFloat32(grade.lut)));
    if (key) S.lutCache.set(key, tex);
    return tex;
  }

  // frame output after the final pass (renderFrame and regrade): read back and optionally upload to the driver
  async function output(frame, opts, T, resetLap, lap) {
    const transfer = opts.transfer || 'none';
    if (transfer === 'none') return;
    T.uploadWait = await S.io.drain(); resetLap();
    const buf = S.io.read();
    lap('read');
    if (transfer.startsWith('post')) {
      await S.io.upload(buf, { frame, tag: opts.tag || '', parts: transfer === 'post' ? 1 : 4, pipelined: transfer === 'post4async' });
      lap('upload');
    }
  }

  function applyCameraState(state, aspect) {
    const cam = S.camera;
    const w = resolveWorld(state, S.rigGroup.matrixWorld);
    cam.position.copy(w.pos); cam.up.copy(w.up); cam.lookAt(w.target);
    if (state.rollDeg) cam.rotateZ(state.rollDeg * D2R);
    cam.near = state.near; cam.far = state.far;
    const lens = LENS.makeLens({ ...state, focusDist: state.focusDist ?? w.pos.distanceTo(w.target) }, aspect);
    if (state.blades != null) lens.blades = state.blades;
    LENS.applyLensToCamera(cam, lens);
    cam.updateMatrixWorld(true);
    return lens;
  }

  function makeSub(k, N, time, s, lens, frame) {
    const R = lens ? LENS.apertureRadius(lens.focalMm, lens.fStop) : 0;
    return {
      k, N, frame, time, centre: k < 0, frameT: frame / FPS, camera: S.camera,
      shutterPos: s ? s.t : 0.5,
      jitter: { x: s ? s.jx : 0, y: s ? s.jy : 0 },
      lens: { x: s ? s.lx : 0, y: s ? s.ly : 0, dx: s ? s.lx * R : 0, dy: s ? s.ly * R : 0, radius: R,
        focalMm: lens?.focalMm, fStop: lens?.fStop, focusDist: lens?.focusDist },
      seed: k < 0 ? RNG.hashInts(frame, 0xFFFF) : RNG.hashInts(frame, k),   // e.g. hashed-alpha seed (uint32)
      dim: (i) => (k < 0 ? 0.5 : RNG.subframeDim(k, i, N)),               // extra stratified [0,1) dims, 2-D pairs (0,1) (2,3) ...
    };
  }

  const AG = {
    ready: false,
    FPS, MUSIC_OFFSET,

    /**
     * opts: { width, height, quality: 'preview'|'final', modules: 'auto'|'placeholders'|{...}, camera: override|null,
     *         cameraModule: 'auto'|'off'|url, data: {key: url|{url,type,optional}}, lut: url, grade: preset|object,
     *         N, shutter, preblur, nearestDist, ... (session overrides of shot settings), shadows, warmup }
     */
    async init(opts = {}) {
      if (S.initDone) throw new Error('AG.init called twice (open a fresh page per session)');
      const t0 = now();
      const width = opts.width || 1920, height = opts.height || 1080;
      S.width = width; S.height = height; S.aspect = width / height;
      S.quality = opts.quality || 'final';
      S.sessionOverrides = sessionSettings(opts);
      S.sessionGrade = opts.grade || null;

      const renderer = createRenderer({ width, height, shadows: opts.shadows !== false });
      S.renderer = renderer;
      S.ctxWatch = watchContext(renderer, () => S.curFrame ?? null);   // a context loss fails every later frame
      S.gpu = gpuInfo(renderer);
      if (!S.gpu.colorBufferFloat || !S.gpu.floatBlend) throw new Error(`GPU lacks float render targets / float blending: ${JSON.stringify(S.gpu)}`);

      const scene = new THREE.Scene(); scene.name = 'AG.scene';
      const worldGroup = new THREE.Group(); worldGroup.name = 'worldGroup';
      const rigGroup = new THREE.Group(); rigGroup.name = 'rigGroup';
      rigGroup.rotation.y = BASE_RIG_YAW_DEG * D2R;
      scene.add(worldGroup, rigGroup); scene.updateMatrixWorld(true);
      const camera = new THREE.PerspectiveCamera(40, width / height, DEFAULT_CAMERA.near, DEFAULT_CAMERA.far);
      camera.filmGauge = 36; camera.name = 'AG.camera';
      scene.add(camera);
      Object.assign(S, { scene, worldGroup, rigGroup, camera });

      S.accum = new AccumRenderer(renderer, width, height);
      S.final = new FinalPass(renderer, width, height);
      S.io = new FrameIO(renderer, S.final.outRT, { check: S.ctxWatch.check });
      // session LUT: the film LUT by default (FILM_LUT_URL), none for lut 'identity' | null | false
      const lutSrc = opts.lut === undefined || opts.lut === 'film' ? resolveUrl(FILM_LUT_URL) : opts.lut;
      if (lutSrc && lutSrc !== 'identity') {
        const lut = typeof lutSrc === 'string' ? (lutSrc.includes('LUT_3D_SIZE') ? parseCube(lutSrc) : await loadLut(lutSrc)) : fromFloat32(lutSrc);
        S.final.sessionLut = lutTexture(lut);
        S.lutInfo = { title: lut.title, size: lut.size, src: typeof lutSrc === 'string' && !lutSrc.includes('LUT_3D_SIZE') ? lutSrc : '(inline)' };
      } else S.lutInfo = { title: 'identity', size: 0, src: null };
      // per-shot-class film LUTs (only on top of the film LUT itself)
      S.classLuts = null;
      if (opts.lut === undefined || opts.lut === 'film') {
        const wide = await loadLut(resolveUrl(FILM_LUT_WIDE_URL)).catch((e) => { console.warn('[AG] wide film LUT not loaded:', e.message); return null; });
        if (wide) {
          S.classLuts = { wide: { tex: lutTexture(wide), shots: new Set(FILM_LUT_CLASS.wide) } };
          S.lutInfo.classes = { wide: { title: wide.title, size: wide.size, src: FILM_LUT_WIDE_URL, shots: [...FILM_LUT_CLASS.wide] } };
        }
      }

      // camera source
      let camMod = null;
      const cmPolicy = opts.cameraModule ?? 'auto';
      if (cmPolicy !== 'off') {
        const url = resolveUrl(cmPolicy === 'auto' ? CAMERA_MODULE_URL : cmPolicy);
        if (cmPolicy !== 'auto' || await urlExists(url)) { camMod = await import(url); S.cameraModuleUrl = url; }
      }
      S.director = new CameraDirector(camMod);
      S.director.setOverride(opts.camera || null);

      const tData = now();
      const data = await loadDataMap({ ...DEFAULT_DATA, ...(opts.data || {}) });
      // motion-blur N boost table (optional; MOTION_N_URL); handed to the integration module's wiring check as data.motionN
      S.motionN = null;
      if (opts.motionBoost !== false) {
        const mn = await fetch(resolveUrl(MOTION_N_URL)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (mn && mn.format === 'afterglow-motion-n' && mn.frames && mn.editN && mn.shotOf) {
          S.motionN = { ...mn, perfOk: !!(data.perfMeta && mn.perfSha === data.perfMeta.sha256) };
          data.motionN = S.motionN;
        }
      }
      S.timings = { data: now() - tData };

      const sun = createSun();
      const settings = { width, height, aspect: width / height, quality: S.quality, ...DEFAULT_SETTINGS };
      const ctx = {
        THREE, renderer, scene, worldGroup, rigGroup, camera, sun, settings, data,
        width, height, quality: S.quality,          // aliases of settings.width/height/quality (constant per session)
        options: opts.moduleOptions || {},          // per-module options, e.g. { world: {...} } (AG.init({ moduleOptions }))
        modules: {}, frame: 0, t: 0, m: -MUSIC_OFFSET, shot: null, subframe: null,
        FPS, MUSIC_OFFSET, time: { frameToTime, timeToFrame, filmToMusic, musicToFilm },
        loadData,
        registerSkyBake: (fn) => { S.hooks.sky.push(fn); },
        registerEnvCapture: (fn) => { S.hooks.env.push(fn); },
        registerPreSubframe: (fn) => { S.hooks.pre.push(fn); },
        registerGradePreset: (name, params) => { GRADE_PRESETS[name] = params; },
        core: { CubeProbe, withAutoClear, lens: LENS, rng: RNG, glsl: GLSL, sun: { dirFromAzEl, sunElevationAt }, accum: S.accum, final: S.final },
      };
      S.ctx = ctx;
      window.__AG_CTX = ctx; // debugging only

      const tMods = now();
      const resolved = await resolveModules(opts.modules ?? 'auto');
      for (const m of resolved) {
        let ns;
        try { ns = await import(m.url); } catch (e) { throw new Error(`module ${m.slot} (${m.url}) failed to load: ${e.message}`); }
        if (typeof ns.create !== 'function') throw new Error(`module ${m.slot} (${m.url}) does not export async create(ctx)`);
        const tc = now();
        let inst;
        try { inst = (await ns.create(ctx)) || {}; } catch (e) { throw new Error(`module ${m.slot} (${m.url}) create() failed: ${e.stack || e.message}`); }
        if (inst.group) {
          const parent = (inst.parent || m.parent) === 'world' ? worldGroup : rigGroup;
          parent.add(inst.group);
        }
        ctx.modules[m.slot] = inst;
        for (const b of normalizeBakes(inst.bakes)) S.bakes.push({ ...b, slot: m.slot });
        S.modules.push({ ...m, inst, createMs: now() - tc });
      }
      S.timings.modules = now() - tMods;
      scene.updateMatrixWorld(true);

      const tInit = now();
      // 'init' bakes get the same info shape as the per-frame hooks; there is no frame yet, so frame/t/m/shot are null
      const initInfo = { frame: null, t: null, m: null, shot: null, shotChanged: false, settings, sun, ctx, when: 'init' };
      for (const b of S.bakes.filter((x) => x.when === 'init')) await b.run(initInfo);
      S.timings.initBakes = now() - tInit;

      const tc = now();
      renderer.compile(scene, camera);
      if (opts.warmup !== false) await AG.renderFrame(opts.warmupFrame ?? 0, { N: 1, transfer: 'none' });
      S.timings.compile = now() - tc;
      S.timings.init = now() - t0;
      S.initDone = true;
      return AG.info();
    },

    /**
     * Render output frame `frame`. opts: { N, shutter, preblur, nearestDist, grade, debugView, camera,
     *   transfer: 'none' | 'read' | 'post4' | 'post4async' | 'post', tag, sync }
     * The graded RGBA8 frame stays in the output target; AG.readPixels() returns it (top-down rows).
     */
    async renderFrame(frame, opts = {}) {
      if (!S.renderer) throw new Error('AG.init first');
      if (!Number.isInteger(frame) || frame < 0) throw new Error(`bad frame ${frame}`);
      S.curFrame = frame;
      S.ctxWatch.check(`start of frame ${frame}`);
      const { renderer: r, scene, camera, accum, ctx } = S;
      const T = {}; const tStart = now(); let tp = tStart; const lap = (k) => { const n = now(); T[k] = (T[k] || 0) + (n - tp); tp = n; };
      const t = frameToTime(frame), m = filmToMusic(t);
      const override = opts.camera !== undefined ? opts.camera : S.director.override;
      const shot = S.director.shotAt(t, override);
      const st = frameSettings(shot, opts, frame);
      Object.assign(ctx.settings, st);
      ctx.frame = frame; ctx.t = t; ctx.m = m; ctx.shot = shot;

      S.rigGroup.rotation.y = (BASE_RIG_YAW_DEG + (st.rigYawCheatDeg || 0)) * D2R;
      S.rigGroup.updateMatrixWorld(true);
      ctx.sun.update(t, st.sunElevationDeg ?? undefined);
      const shotKey = shot.id + '|' + (override ? JSON.stringify(override) : '');
      const shotChanged = shotKey !== S.lastShotKey; S.lastShotKey = shotKey;
      const info = { frame, t, m, shot, shotChanged, settings: st, sun: ctx.sun, ctx };

      // 1. camera at the frame centre (no aperture offset, no jitter), per-frame prep, pose at the frame centre
      const centreLens = applyCameraState(S.director.stateAt(t, shot, override), S.aspect);
      ctx.subframe = makeSub(-1, st.N, t, null, centreLens, frame);
      for (const mod of S.modules) mod.inst.beforeFrame?.(frame, t, info);
      for (const mod of S.modules) mod.inst.update?.(t, ctx.subframe);
      scene.updateMatrixWorld(true);
      lap('prep');
      // 2. sky bakes, module bakes, environment captures
      for (const fn of S.hooks.sky) await fn(info);
      lap('skyBake');
      for (const b of S.bakes) if ((b.when === 'shot' && shotChanged) || b.when === 'frame') await b.run(info);
      lap('bakes');
      for (const fn of S.hooks.env) await fn(info);
      lap('envCapture');

      // 3. sub-frames
      accum.clear();
      const N = st.N;
      const samples = RNG.subframeSamples(N, { blades: centreLens.blades ?? st.blades, bladeRotation: st.bladeRotation, aaFilter: st.aaFilter, aaSigma: st.aaSigma });
      const pre = accum.setupPreblur(camera, centreLens, N, { preblur: st.preblur, nearestDist: st.nearestDist, maxPreblurPx: st.maxPreblurPx, preblurKernel: st.preblurKernel });
      let lens = centreLens;
      for (const s of samples) {
        const tk = t + (s.t - 0.5) * st.shutter / FPS;
        // camera state is a pure function of t: pose it first (no aperture offset yet) so modules can read it
        lens = applyCameraState(S.director.stateAt(tk, shot, override), S.aspect);
        const sub = makeSub(s.k, N, tk, s, lens, frame);
        ctx.subframe = sub;
        for (const mod of S.modules) mod.inst.update?.(tk, sub);
        accum.applyLensAndJitter(camera, s, lens);   // thin-lens eye offset + focal-plane shear + pixel jitter
        for (const fn of S.hooks.pre) fn(sub);
        accum.renderSub(scene, camera, s.k, N);      // render() updates world matrices itself
      }
      if (opts.sync !== false) {
        // GPU sync for the timing split, and an integrity check: the accumulated weights sum to 1 in every pixel
        // (a lost context or a cleared accumulation target shows up here as NaN / 0 / a partial sum)
        const alpha = syncGPU(r, accum.accumRT);
        S.ctxWatch.check(`frame ${frame} after ${N} sub-frames`);
        if (!(Math.abs(alpha - 1) < 1e-3)) throw new Error(`frame ${frame}: accumulation weight at pixel (0,0) is ${alpha}, expected 1 (readback failed or the accumulation target was reset)`);
      }
      lap('subframes');

      // 4. final pass
      // LUT: the shot's own grade.lut, else its class LUT (wides), else the session LUT
      let lutTex = await lutFor(st.grade);
      if (!lutTex && S.classLuts) for (const c of Object.values(S.classLuts)) if (c.shots.has(shot.id)) { lutTex = c.tex; break; }
      const depth ={ texture: accum.sceneRT.depthTexture, near: camera.near, far: camera.far, K: LENS.cocInfPx(lens, S.width), focus: lens.focusDist };
      S.final.render({ accumTexture: accum.accumRT.texture, frame, grade: st.grade, lutTex, debugView: st.debugView, depth });
      S.lastFinal = { frame, grade: st.grade, lutTex, depth };
      lap('final');

      // 5. output
      await output(frame, opts, T, () => { tp = now(); }, lap);
      S.ctxWatch.check(`end of frame ${frame}`);
      T.total = now() - tStart;
      for (const k of Object.keys(T)) T[k] = +T[k].toFixed(2);
      S.last = { frame, t, m, shot: shot.id, N, nBoost: st.nBase ? { from: st.nBase, to: N } : null, shutter: st.shutter, preblur: pre, timings: T, perSubMs: T.subframes / N,
        lens: { focalMm: +lens.focalMm.toFixed(3), fStop: lens.fStop, focusDist: +lens.focusDist.toFixed(4) },
        camera: { pos: camera.position.toArray().map((v) => +v.toFixed(4)), source: override ? 'override' : S.director.source },
        sun: { azimuthDeg: ctx.sun.azimuthDeg, elevationDeg: +ctx.sun.elevationDeg.toFixed(4) }, gradePreset: st.gradePreset, final: S.final.stats };
      return S.last;
    },

    /**
     * Checks only: re-run ONLY the final pass on the last frame's accumulation with another look, e.g.
     * { debugView: 'nolut' } (the ungraded frame for LUT fitting) or { lut: 'identity' | 'film' | url | .cube text },
     * { grade: {...} }; transfer / tag as renderFrame. The accumulation is untouched, so a check renders a frame once
     * and reads it out graded several ways. Never used by the film drivers.
     */
    async regrade(opts = {}) {
      if (!S.lastFinal || !S.last) throw new Error('regrade: no frame rendered yet');
      const L = S.lastFinal, T = {};
      let lutTex = L.lutTex;
      if (opts.lut !== undefined) {
        const src = opts.lut === 'film' ? resolveUrl(FILM_LUT_URL) : opts.lut;
        if (!src || src === 'identity') lutTex = S.final.identityLut;
        else {
          const key = typeof src === 'string' && !src.includes('LUT_3D_SIZE') ? src : null;
          if (key && S.lutCache.has(key)) lutTex = S.lutCache.get(key);
          else { lutTex = lutTexture(typeof src === 'string' ? (key ? await loadLut(src) : parseCube(src)) : fromFloat32(src)); if (key) S.lutCache.set(key, lutTex); }
        }
      }
      const grade = opts.grade ? deepMerge(L.grade, opts.grade) : L.grade;
      S.final.render({ accumTexture: S.accum.accumRT.texture, frame: L.frame, grade, lutTex, debugView: opts.debugView || 'none', depth: L.depth });
      await output(L.frame, opts, T, () => {}, () => {});
      return { frame: L.frame, debugView: opts.debugView || 'none', lut: lutTex?.userData?.title ?? null, final: S.final.stats };
    },

    /** last output frame as top-down RGBA8 rows (reads the output target if the frame was not read yet) */
    readPixels() {
      if (!S.io) throw new Error('AG.init first');
      return S.io.read();
    },

    /** wait for the in-flight upload; throws if the context was lost at any point in this session */
    async flush() { if (S.io) await S.io.drain(); S.ctxWatch?.check('flush'); return true; },

    /** dispose every module (reverse creation order: dispose?() of the module interface), then the core targets */
    dispose() {
      const errors = [];
      for (const m of [...S.modules].reverse()) { try { m.inst.dispose?.(); } catch (e) { errors.push(`${m.slot}: ${e.message}`); } }
      for (const o of [S.final, S.accum]) { try { o?.dispose(); } catch (e) { errors.push(e.message); } }
      try { S.renderer?.dispose(); } catch (e) { errors.push(`renderer: ${e.message}`); }
      S.modules = []; S.renderer = null;
      return { disposed: true, errors };
    },

    info() {
      return {
        width: S.width, height: S.height, quality: S.quality, fps: FPS, musicOffset: MUSIC_OFFSET, three: THREE.REVISION, gpu: S.gpu,
        modules: S.modules.map(({ slot, url, kind, createMs }) => ({ slot, kind, url: url.replace(location.origin, ''), createMs: +createMs.toFixed(1) })),
        cameraModule: S.cameraModuleUrl ? S.cameraModuleUrl.replace(location.origin, '') : null, cameraSource: S.director?.override ? 'override' : S.director?.source,
        hooks: { skyBakes: S.hooks.sky.length, envCaptures: S.hooks.env.length, preSubframe: S.hooks.pre.length, bakes: S.bakes.map((b) => `${b.slot}:${b.name}@${b.when}`) },
        data: Object.fromEntries(Object.entries(S.ctx?.data || {}).map(([k, v]) => [k, v == null ? null : v instanceof ArrayBuffer ? `${v.byteLength} bytes` : typeof v])),
        initTimings: S.timings, uploads: S.io?.uploads, uploadRetries: S.io?.retries,
        lut: S.lutInfo ? { ...S.lutInfo, src: S.lutInfo.src ? S.lutInfo.src.replace(location.origin, '') : null } : null,
        motionN: S.motionN ? { frames: Object.keys(S.motionN.frames).length, targetPx: S.motionN.targetPx, extraSubframes: S.motionN.extraSubframes,
          perfOk: S.motionN.perfOk, perfSha: S.motionN.perfSha && S.motionN.perfSha.slice(0, 8) } : null,
        contextLost: S.ctxWatch ? { lost: S.ctxWatch.lost, restored: S.ctxWatch.restored, firstFrame: S.ctxWatch.firstFrame } : null,
        last: S.last, shot: S.last?.shot, t: S.last?.t, m: S.last?.m, timings: S.last?.timings,
        integration: S.ctx?.modules?.integration?.info?.() ?? null,
      };
    },

    /** integration checks only (scene/src/integration/index.js probe); never called by the render drivers */
    probe(o) { const p = S.ctx?.modules?.integration?.probe; if (!p) throw new Error('integration module not loaded'); return p(o); },

    /** render + read back; { dataURL: true } also returns a PNG data URL (interactive use; the driver uses ffmpeg) */
    async renderStill(frame, opts = {}) {
      const res = await AG.renderFrame(frame, { ...opts, transfer: opts.transfer || 'read' });
      if (opts.dataURL) {
        const buf = S.io.last, c = document.createElement('canvas'); c.width = S.width; c.height = S.height;
        const g = c.getContext('2d'); g.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), S.width, S.height), 0, 0);
        res.dataURL = c.toDataURL('image/png');
      }
      return res;
    },

    /** draw the last output frame to the page canvas (interactive preview) */
    present() { S.final.present(); },
    setCamera(override) { S.director.setOverride(override || null); },
    /** session LUT: null | 'identity' = none; 'film' = the film LUT; a URL (.cube or raw Float32); .cube text; or a Float32Array S^3*3|4 table */
    async setLUT(src) {
      let lut = null;
      if (src === 'film') src = resolveUrl(FILM_LUT_URL);
      if (typeof src === 'string' && src !== 'identity') lut = src.includes('LUT_3D_SIZE') ? parseCube(src) : await loadLut(src);
      else if (src && typeof src !== 'string') lut = fromFloat32(src);
      const old = S.final.sessionLut;
      S.final.sessionLut = lut ? lutTexture(lut) : S.final.identityLut;
      if (old && old !== S.final.identityLut && old !== S.final.sessionLut) old.dispose();
      // class LUTs (wides) only ride on the film LUT itself
      if (S.classLutsFilm === undefined) S.classLutsFilm = S.classLuts;
      S.classLuts = src === resolveUrl(FILM_LUT_URL) ? S.classLutsFilm : null;
      S.lutInfo = lut ? { title: lut.title, size: lut.size, src: typeof src === 'string' && !src.includes('LUT_3D_SIZE') ? src : '(inline)' } : { title: 'identity', size: 0, src: null };
      return lut ? { size: lut.size, title: lut.title } : null;
    },
    setGrade(grade) { S.sessionGrade = grade; },
    get ctx() { return S.ctx; },
  };
  return AG;
}
