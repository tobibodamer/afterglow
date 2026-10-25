// Camera director: turns the shot list (scene/src/camera/shots.js, once it exists), a per-render override or the
// built-in default into a camera state for any film time t. Pure functions of t.
//
// Camera state (what every source resolves to):
//   { pos:[x,y,z], target:[x,y,z], up:[0,1,0], rollDeg, focalMm | fovDeg | hfovDeg, focusDist, fStop, near, far,
//     space: 'world' | 'rig' }   // 'rig' = pos/target in the rig frame (rig yaw applied); posRig/targetRig mix freely
//   focusDist defaults to |target - pos|. fStop <= 0 disables depth of field.
//
// Sources, highest priority first:
//   1. override (AG.init({camera}) / AG.renderFrame(f, {camera}) / render CLI --camera cam.json):
//        a single state  {pos, target, focalMm, focusDist, fStop, ...}
//        or a keyframed  {keys:[{t, pos, target, ...}], easing}
//        Shot settings (N, shutter, preblur, nearestDist, grade, rigYawCheatDeg, sunElevationDeg) may sit beside it.
//   2. camera module (shots.js): export cameraAt(t) -> state and/or shotAt(t) -> shot, or export SHOTS = [...]
//        (DESIGN.md section 4: {id, t0, t1, ref, rigYawCheatDeg, camera:[{t, pos, target|targetRig, fovDeg|focalMm,
//        focusDist, fStop}], easing, N, dofPreblur, nearestDist, shutter, sunElevationDeg, grade}).
//   3. DEFAULT_CAMERA (a low wide shot over the water, backlit by the sun at -Z).
import * as THREE from 'three';

export const DEFAULT_CAMERA = Object.freeze({
  pos: [2.6, 0.55, 7.6], target: [0, 0.85, 0], focalMm: 35, fStop: 5.6, focusDist: null, near: 0.05, far: 60000,
});

const EASE = {
  linear: (u) => u,
  smooth: (u) => u * u * (3 - 2 * u),
  smoother: (u) => u * u * u * (u * (u * 6 - 15) + 10),
  easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  easeIn: (u) => u * u,
  easeOut: (u) => 1 - (1 - u) * (1 - u),
};

const SHOT_SETTING_KEYS = ['N', 'shutter', 'preblur', 'dofPreblur', 'nearestDist', 'maxPreblurPx', 'grade', 'rigYawCheatDeg',
  'sunElevationDeg', 'aaFilter', 'quality'];

const asArr = (v) => (v == null ? null : Array.isArray(v) ? v : [v.x, v.y, v.z]);
const lerp = (a, b, u) => a + (b - a) * u;
const lerpArr = (a, b, u) => (a && b ? a.map((x, i) => lerp(x, b[i], u)) : a || b);

/** interpolate a keyframe list [{t, ...state}] at time t (clamped at the ends) */
export function evalKeys(keys, t, easing = 'smooth') {
  if (!keys?.length) return null;
  if (keys.length === 1 || t <= keys[0].t) return { ...keys[0] };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { ...last };
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const ease = EASE[b.easing || easing] || EASE.smooth;
  const u = ease((t - a.t) / Math.max(1e-9, b.t - a.t));
  const out = { ...a };
  for (const k of ['pos', 'target', 'posRig', 'targetRig', 'up']) if (a[k] || b[k]) out[k] = lerpArr(asArr(a[k]), asArr(b[k]), u);
  for (const k of ['fovDeg', 'hfovDeg', 'focusDist', 'fStop', 'rollDeg', 'near', 'far']) if (a[k] != null && b[k] != null) out[k] = lerp(a[k], b[k], u);
  // zooms interpolate in log focal length (perceptually even)
  if (a.focalMm != null && b.focalMm != null) out.focalMm = Math.exp(lerp(Math.log(a.focalMm), Math.log(b.focalMm), u));
  return out;
}

function pickShotSettings(o) {
  const s = {};
  for (const k of SHOT_SETTING_KEYS) if (o && o[k] !== undefined) s[k] = o[k];
  if (s.dofPreblur !== undefined && s.preblur === undefined) s.preblur = s.dofPreblur;
  delete s.dofPreblur;
  return s;
}

export class CameraDirector {
  /** cameraModule: the imported shots.js namespace (or null) */
  constructor(cameraModule = null) {
    this.mod = cameraModule;
    this.shots = cameraModule?.SHOTS || cameraModule?.shots || cameraModule?.default?.SHOTS || null;
    if (this.shots) this.shots = [...this.shots].sort((a, b) => a.t0 - b.t0);
    this.override = null;
    this.source = cameraModule ? 'shots' : 'default';
  }

  setOverride(o) { this.override = o && Object.keys(o).length ? o : null; }

  /** the shot active at t: { id, t0, t1, settings, ...raw } (a synthetic one for the default/override) */
  shotAt(t, override = this.override) {
    if (override) return { id: override.id || 'override', t0: override.t0 ?? 0, t1: override.t1 ?? Infinity, settings: pickShotSettings(override), raw: override };
    let shot = null;
    if (typeof this.mod?.shotAt === 'function') shot = this.mod.shotAt(t);
    else if (this.shots) {
      for (const s of this.shots) if (t >= s.t0 && t < s.t1) { shot = s; break; }
      if (!shot) shot = t < this.shots[0].t0 ? this.shots[0] : this.shots[this.shots.length - 1];
    }
    if (!shot) return { id: 'default', t0: 0, t1: Infinity, settings: {}, raw: null };
    return { id: shot.id ?? `shot@${shot.t0}`, t0: shot.t0 ?? 0, t1: shot.t1 ?? Infinity, settings: pickShotSettings(shot), raw: shot };
  }

  /** camera state at time t for the given shot */
  stateAt(t, shot, override = this.override) {
    let s = null;
    if (override) s = override.keys ? evalKeys(override.keys, t, override.easing) : override;
    else if (typeof this.mod?.cameraAt === 'function') s = this.mod.cameraAt(t, shot?.raw);
    else if (shot?.raw) {
      const keys = shot.raw.camera || shot.raw.keys;
      s = Array.isArray(keys) ? evalKeys(keys, t, shot.raw.easing) : keys;
    }
    return normalizeState(s || DEFAULT_CAMERA);
  }
}

export function normalizeState(s) {
  const out = {
    pos: asArr(s.pos), target: asArr(s.target), posRig: asArr(s.posRig), targetRig: asArr(s.targetRig),
    up: asArr(s.up) || [0, 1, 0], rollDeg: s.rollDeg ?? 0, space: s.space || 'world',
    focalMm: s.focalMm, fovDeg: s.fovDeg, hfovDeg: s.hfovDeg,
    focusDist: s.focusDist ?? null, fStop: s.fStop ?? DEFAULT_CAMERA.fStop,
    near: s.near ?? DEFAULT_CAMERA.near, far: s.far ?? DEFAULT_CAMERA.far, blades: s.blades, bladeRotation: s.bladeRotation,
  };
  if (!out.pos && !out.posRig) out.pos = [...DEFAULT_CAMERA.pos];
  if (!out.target && !out.targetRig) out.target = [...DEFAULT_CAMERA.target];
  if (out.focalMm == null && out.fovDeg == null && out.hfovDeg == null) out.focalMm = DEFAULT_CAMERA.focalMm;
  return out;
}

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3();

/** resolve a state to world-space position/target using the rig's world matrix */
export function resolveWorld(state, rigMatrixWorld) {
  const rigSpace = state.space === 'rig';
  const pos = state.posRig ? _p.fromArray(state.posRig).applyMatrix4(rigMatrixWorld) : _p.fromArray(state.pos);
  if (!state.posRig && rigSpace) pos.applyMatrix4(rigMatrixWorld);
  const target = state.targetRig ? _t.fromArray(state.targetRig).applyMatrix4(rigMatrixWorld) : _t.fromArray(state.target);
  if (!state.targetRig && rigSpace) target.applyMatrix4(rigMatrixWorld);
  return { pos: pos.clone(), target: target.clone(), up: _u.fromArray(state.up).clone() };
}
