// Sun position (DESIGN.md section 2): azimuth A in degrees clockwise from above, A = 0 is the sun itself;
// a horizontal unit vector for azimuth A is (sin A, 0, -cos A), so the sun is toward -Z.
import * as THREE from 'three';
import { DEFAULT_SUN_KEYS } from './constants.js';

const D2R = Math.PI / 180;

/** unit vector toward azimuth A / elevation E (degrees) */
export function dirFromAzEl(azDeg, elDeg, out = new THREE.Vector3()) {
  const a = azDeg * D2R, e = elDeg * D2R;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

/** piecewise-linear sun elevation (deg) over film time from [[t, elevDeg], ...] keys (clamped at the ends) */
export function sunElevationAt(t, keys = DEFAULT_SUN_KEYS) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, e0] = keys[i], [t1, e1] = keys[i + 1];
    if (t < t1) { const u = (t - t0) / (t1 - t0); return e0 + (e1 - e0) * u; }
  }
  return keys[keys.length - 1][1];
}

/** the ctx.sun object; update() is called by main.js once per output frame */
export function createSun() {
  return {
    azimuthDeg: 0, elevationDeg: DEFAULT_SUN_KEYS[0][1], dir: new THREE.Vector3(),
    keys: DEFAULT_SUN_KEYS, // a world module may replace this arc (ctx.sun.keys = [...]); shot sunElevationDeg wins
    update(t, elevationOverrideDeg) {
      this.elevationDeg = elevationOverrideDeg ?? sunElevationAt(t, this.keys);
      dirFromAzEl(this.azimuthDeg, this.elevationDeg, this.dir);
      return this;
    },
  };
}
