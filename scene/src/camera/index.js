// Camera module (core module interface, docs/RENDERING.md section 3). The camera itself reaches the core through
// shots.js (the core's CameraDirector imports it as the camera source and calls shotAt / cameraAt at the frame
// centre and at every sub-frame time); this module does the parts that need ctx (companion.js: the edit's sun arc
// pinned on the world, rig-yaw check, per-frame diagnostics for the animatic overlay in window.__AG_CAMERA).
// Load it as an extra module until the integrator gives it a slot:
//   AG.init({ modules: { extra: ['./camera/index.js'] } })   or  CLI  --modules '{"extra":["./camera/index.js"]}'
import * as edit from './shots.js';
import { cameraCompanion } from './companion.js';

export async function create(ctx) { return cameraCompanion(ctx, edit); }
