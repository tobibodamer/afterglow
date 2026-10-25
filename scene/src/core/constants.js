// Film-wide constants (DESIGN.md sections 2-3). Plain ES module with no imports, so the Node driver in render/
// imports this same file: one source of truth for the frame rate and the music offset.

export const FPS = 60;                 // film time t = frame / FPS, exactly
export const MUSIC_OFFSET = 4.0;       // music time m = t - MUSIC_OFFSET (the film opens on the vista)
export const SENSOR_W_MM = 36;         // full-frame sensor width; focal lengths in mm refer to it
export const BASE_RIG_YAW_DEG = 120;   // rig.rotation.y: the pianist faces azimuth A = +60 deg (sun at his left-front)
export const DEFAULT_SHUTTER = 0.5;    // fraction of the frame interval: 180 deg = 1/120 s, centred on t

// Default sun elevation arc over film time [t (s), elevation (deg)], azimuth 0 = the sun (DESIGN.md section 2).
// The shot list or the world module may override it; per-shot sunElevationDeg overrides win.
export const DEFAULT_SUN_KEYS = [[0, 0.6], [110, -1.0], [215, -1.6], [235, -4.5]];

export const frameToTime = (frame) => frame / FPS;
export const timeToFrame = (t) => Math.round(t * FPS);
export const filmToMusic = (t) => t - MUSIC_OFFSET;
export const musicToFilm = (m) => m + MUSIC_OFFSET;
