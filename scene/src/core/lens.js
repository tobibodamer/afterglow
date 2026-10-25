// Lens model: focal length in mm on a 36 mm wide sensor <-> field of view, thin-lens aperture, circle of confusion.
//
// The renderer is a pinhole camera whose eye is moved across the aperture per sub-frame, with the frustum sheared
// so the focal plane (view depth = focusDist) stays fixed (accum.js). For a point at view depth d this produces a
// circle of confusion of diameter
//     CoC_px(d) = K * |d - s| / d,   K = (f / N) * f_px / s,   f_px = f * W_px / sensorW
// i.e. a real thin lens with focus-breathing compensated (the field of view is the infinity-focus one). The ratio
// CoC / image size equals a real lens's, which is what matters on screen.
import { SENSOR_W_MM } from './constants.js';

const DEG = 180 / Math.PI;

/** horizontal field of view (deg) of a focal length (mm) on a sensor of width sensorW (mm) */
export const hfovFromFocal = (focalMm, sensorW = SENSOR_W_MM) => 2 * Math.atan(sensorW / (2 * focalMm)) * DEG;
/** vertical field of view (deg) for an image of the given aspect (w/h >= 1: the sensor width is the long side) */
export function vfovFromFocal(focalMm, aspect, sensorW = SENSOR_W_MM) {
  const sensorH = aspect >= 1 ? sensorW / aspect : sensorW;
  return 2 * Math.atan(sensorH / (2 * focalMm)) * DEG;
}
export function focalFromVfov(vfovDeg, aspect, sensorW = SENSOR_W_MM) {
  const sensorH = aspect >= 1 ? sensorW / aspect : sensorW;
  return sensorH / (2 * Math.tan((vfovDeg / DEG) / 2));
}
export const focalFromHfov = (hfovDeg, sensorW = SENSOR_W_MM) => sensorW / (2 * Math.tan((hfovDeg / DEG) / 2));

/** aperture radius in metres: entrance pupil diameter = f / N */
export const apertureRadius = (focalMm, fStop) => (fStop > 0 ? (focalMm / 1000) / fStop / 2 : 0);

/** CoC diameter at infinity in pixels (K above) */
export function cocInfPx({ focalMm, fStop, focusDist }, widthPx, sensorW = SENSOR_W_MM) {
  if (!(fStop > 0)) return 0;
  const f = focalMm / 1000;
  const fpx = focalMm * widthPx / sensorW;
  return (f / fStop) * fpx / focusDist;
}
/** CoC diameter in pixels of a point at view depth d */
export const cocPx = (lens, d, widthPx, sensorW = SENSOR_W_MM) => cocInfPx(lens, widthPx, sensorW) * Math.abs(d - lens.focusDist) / d;

/** depth-of-field limits (m) for an acceptable CoC (px) */
export function dofLimits(lens, widthPx, acceptPx = 1, sensorW = SENSOR_W_MM) {
  const K = cocInfPx(lens, widthPx, sensorW), s = lens.focusDist;
  if (K <= acceptPx) return { near: s * K / (K + acceptPx), far: Infinity };
  return { near: s * K / (K + acceptPx), far: s * K / (K - acceptPx) };
}

/**
 * Normalised lens description. Inputs may give focalMm or fovDeg (vertical, three.js convention) or hfovDeg.
 * fStop <= 0 or null disables depth of field (pinhole).
 */
export function makeLens(o = {}, aspect = 16 / 9) {
  let focalMm = o.focalMm;
  if (focalMm == null && o.fovDeg != null) focalMm = focalFromVfov(o.fovDeg, aspect);
  if (focalMm == null && o.hfovDeg != null) focalMm = focalFromHfov(o.hfovDeg);
  if (focalMm == null) focalMm = 50;
  return {
    focalMm,
    fStop: o.fStop ?? 4,
    focusDist: o.focusDist ?? 10,
    blades: o.blades ?? 9,
    bladeRotation: o.bladeRotation ?? 0.3,
  };
}

/** configure a THREE.PerspectiveCamera for the lens (36 mm film gauge on the long side) */
export function applyLensToCamera(camera, lens) {
  camera.filmGauge = SENSOR_W_MM;
  camera.setFocalLength(lens.focalMm); // three: uses filmGauge on the larger image dimension -> 36 mm wide at 16:9
  camera.focus = lens.focusDist;
}
