// Camera module (core module interface, docs/RENDERING.md section 3). The camera itself reaches the core through
// shots.js (the core's CameraDirector imports it as the camera source and calls shotAt / cameraAt at the frame
// centre and at every sub-frame time); this module does the parts that need ctx:
//   - the film's sun arc: ctx.sun.keys = the edit's musically anchored curve (the core's ctx.sun and the placeholder
//     world follow it), and the real world module, which keeps its own arc, is pinned to it every frame
//     (world.setSunElevation) so sky, water and the piano light agree;
//   - checks that the rig yaw the core applied equals 120 deg + the shot's cheat (positions are rig-relative);
//   - per-frame diagnostics (shot, bar.beat, lens, alpha) for the animatic overlay: window.__AG_CAMERA.
// Load it as an extra module until the integrator gives it a slot:
//   AG.init({ modules: { extra: ['./camera/index.js'] } })   or  CLI  --modules '{"extra":["./camera/index.js"]}'
import { director, timeline, SHOTS, SUN_KEYS, FILM_END, SCORE_URL } from './shots.js';

export async function create(ctx) {
  const D2R = Math.PI / 180;
  ctx.sun.keys = SUN_KEYS;                       // dense [t, deg] samples of the edit's C1 sun curve
  const diag = { scoreUrl: SCORE_URL, filmEnd: FILM_END, shots: SHOTS.length, last: null, yawErrors: 0 };
  if (typeof window !== 'undefined') window.__AG_CAMERA = { director, timeline, diag };

  return {
    parent: 'world',
    beforeFrame(frame, t, info) {
      // the core already set ctx.sun from the shot's sunElevationDeg (= the arc at t); keep the world on it
      const world = ctx.modules.world;
      if (world && typeof world.setSunElevation === 'function') world.setSunElevation(ctx.sun.elevationDeg);
      const want = (120 + (info.settings.rigYawCheatDeg || 0)) * D2R;
      if (Math.abs(ctx.rigGroup.rotation.y - want) > 1e-6) {
        // should never happen (main.js applies the shot's rigYawCheatDeg); fix and count it, the camera is rig-relative
        diag.yawErrors++;
        ctx.rigGroup.rotation.y = want; ctx.rigGroup.updateMatrixWorld(true);
      }
      const e = director.evaluate(t);
      const pos = timeline.position(t - ctx.MUSIC_OFFSET);
      diag.last = {
        frame, t, shot: info.shot.id, bar: pos.bar, beat: +pos.beat.toFixed(2), section: pos.section,
        focalMm: +e.focalMm.toFixed(2), fStop: +e.fStop.toFixed(2), focusDist: +e.focusDist.toFixed(3),
        alpha: +e._diag.alpha.toFixed(1), sun: +ctx.sun.elevationDeg.toFixed(3), N: info.settings.N,
      };
    },
    update() {},
    info: () => diag,
  };
}
