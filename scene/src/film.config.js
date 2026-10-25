// Afterglow film configuration (integrator; docs/INTEGRATION.md). Read by the Node drivers (render/film.mjs) and the
// integration checks; the render page does not import it (the page gets per-shot settings from the edit itself).
//
// What is fixed here:
//   - output presets (size, quality, sub-frames N, chunking, where chunks and deliverables go);
//   - the soundtrack the deliverables are muxed with (the FROZEN, approved mix, docs/USER_FEEDBACK.md);
//   - the film length and the per-shot N / pre-blur, which come from the edit (scene/src/camera/shots.js), whose film
//     end is anchored to the score (EDIT.end = 'pedalUp+5.5s': 5.5 s after the final pedal release in score.json).
import { FPS, MUSIC_OFFSET } from './core/constants.js';

export { FPS, MUSIC_OFFSET };

export const SIZES = Object.freeze({ '640p': [640, 360], '540p': [960, 540], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160] });

/**
 * Soundtrack. build/audio/afterglow_film.wav is the approved mix with MUSIC_OFFSET (4.0 s) of silence already in front
 * (checked bit-exact against afterglow.wav, sandbox/integration/PROGRESS.md), so it is placed at film time 0
 * (encode.mjs --offset 0). The plain afterglow.wav would need --offset 4 instead. Never mux both conventions.
 */
export const AUDIO = Object.freeze({ file: 'build/audio/afterglow_film.wav', offset: 0, music: 'build/audio/afterglow.wav', musicOffset: MUSIC_OFFSET });

/**
 * Render presets. N: null = every shot's own N from the edit (32 wides ... 48 close-ups), a number forces it
 * for the whole render (wiring/sync checks use 16; never review motion or approve stills at 16). quality 'final' = full-size bakes (world reflScale 1 / cube 1024, piano probe
 * 1024); 'preview' = cheap bakes and N ignored unless given.
 */
export const PRESETS = Object.freeze({
  // perSession: chunks per browser session in film.mjs render (session start 65-180 s each; out/estimate.json)
  'final-1080p': { size: '1080p', quality: 'final', N: null, chunk: 300, perSession: 4, chunks: 'build/chunks/film_1080p', out: 'build/out/afterglow_1080p60.mp4' },
  'final-1440p': { size: '1440p', quality: 'final', N: null, chunk: 300, perSession: 4, chunks: 'build/chunks/film_1440p', out: 'build/out/afterglow_1440p60.mp4' },
  'final-2160p': { size: '2160p', quality: 'final', N: null, chunk: 300, perSession: 4, chunks: 'build/chunks/film_2160p', out: 'build/out/afterglow_2160p60.mp4' },
  // review: every shot at its OWN N (motion-review clips, approval stills): N=16 draws a fast edge as 16 banded copies
  // in the close-ups that the film renders at N 32/48 (round-4 sync critic), so N=16 presets are for wiring/sync only
  'review-1080p': { size: '1080p', quality: 'final', N: null, chunk: 300, perSession: 2, chunks: 'build/chunks/review_1080p', out: 'build/out/review_1080p.mp4' },
  'check-1080p': { size: '1080p', quality: 'final', N: 16, chunk: 300, chunks: 'build/chunks/check_1080p', out: 'build/out/check_1080p.mp4' },
  'check-1440p': { size: '1440p', quality: 'final', N: 16, chunk: 300, chunks: 'build/chunks/check_1440p', out: 'build/out/check_1440p.mp4' },
  animatic: { size: '640p', quality: 'preview', N: 1, chunk: 600, chunks: 'build/chunks/animatic_integrated', out: 'build/out/animatic_integrated.mp4' },
});

export function presetSize(p) { const s = typeof p === 'string' ? PRESETS[p] : p; return Array.isArray(s.size) ? s.size : SIZES[s.size]; }

/**
 * The film as the edit defines it: frame count and per-shot render settings. Imports the edit lazily (it loads the
 * score and the solved hand track: Node reads them from disk, the page fetches them).
 * -> { frames, end, shots: [{ id, name, ref, f0, f1, frames, N, preblur, nearestDist, cheatDeg }], subframes(N?) }
 */
export async function filmPlan() {
  const cam = await import('./camera/shots.js');
  const shots = cam.director.shots.map((s) => ({ id: s.id, name: s.spec.name, ref: s.spec.ref ?? null, f0: s.f0, f1: s.f1, frames: s.f1 - s.f0,
    N: s.settings.N, preblur: s.settings.preblur, nearestDist: s.settings.nearestDist, cheatDeg: s.settings.rigYawCheatDeg }));
  // motion N boost table (scene/src/integration/motion_n.json, docs/INTEGRATION.md 8.4): extra sub-frames on the boosted
  // frames of an own-N render, counted only for shots whose edit N still matches the table (as main.js applies it)
  let boost = null;
  try {
    const fs = await import('node:fs');
    const t = JSON.parse(fs.readFileSync(new URL('./integration/motion_n.json', import.meta.url), 'utf8'));
    const extra = Object.entries(t.frames).reduce((acc, [f, nb]) => { const s = shots.find((x) => x.id === t.shotOf[f]); return acc + (s && t.editN[s.id] === s.N && nb > s.N ? nb - s.N : 0); }, 0);
    boost = { frames: Object.keys(t.frames).length, extraSubframes: extra, perfSha: t.perfSha, targetPx: t.targetPx };
  } catch (e) { /* no table (or not in Node) */ }
  return {
    frames: cam.FILM_FRAMES, end: cam.FILM_END, fps: FPS, musicOffset: MUSIC_OFFSET, shots, boost,
    /** total sub-frames of the film (each shot at its own N plus the motion N boost, or at a forced N) */
    subframes: (N = null) => shots.reduce((acc, s) => acc + s.frames * (N ?? s.N), 0) + (N == null && boost ? boost.extraSubframes : 0),
  };
}
