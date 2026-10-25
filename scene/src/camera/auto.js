// Auto camera: an edit for any score (the player's MIDI files), compiled by the same director as the film's edit
// (director.js), so cuts land on bar lines (moved onto anticipated pushes), focus and tracking follow the solved hands
// and the sun sinks with the music. Loaded both as the core's camera source and as the camera slot's module:
//   AG.init({ cameraModule: U, modules: { camera: U } })   U = '/scene/src/camera/auto.js?score=<url>&handtrack=<url>'
// (the same URL, so both get one instance; handtrack: the song's solved hand track, missing -> the score proxy).
//
// How the edit is made (pure function of the score; seeded by score.seed):
//   opening   the vista from f0 to the first bar line >= 5 s into the music; closing: the blue-hour rise from the last
//             bar line that leaves >= 12 s to the film end (5.5 s after the final pedal release)
//   cuts      shot length from the section's loudness rank in the piece (quietest 12 s ... loudest 5 s), cut on the bar line that
//             reaches it, moved to a phrase boundary when one is within a bar
//   shots     picked per slot from TEMPLATES below (framings of the film's verified shots, ids in `from`) on: class rhythm
//             (no two wides in a row: the rig cheat would turn the piano against the mountains), the busier hand of
//             the slot, the section's energy, a hands shot at least every ~18 s, no template again within 4 shots
import { loadScore, MusicTimeline } from './score.js';
import { buildHandTracks, loadHandTrack } from './hands.js';
import { createDirector } from './director.js';
import { cameraCompanion } from './companion.js';
import { hash01 } from './lib.js';
import { MUSIC_OFFSET } from '../core/constants.js';

const PIV = [0, 0, 1.0];            // piano centre on the water
const HEAD = [0, 1.14, -0.33];      // pianist head (bind pose)

// class: wide | medium | close; hand: the hand the shot needs busy (null = any); energy: preferred section energy 0..1
export const TEMPLATES = {
  hero: { from: 'S03', class: 'wide', energy: 0.4, spec: { cheat: 0, lens: { mm: 50, fStop: 4, N: 32 }, cam: { orbit: { pivot: PIV, a: [40, 49], d: [13.2, 12.8], h: [0.5, 0.5] } }, look: { at: [[-0.25, 0.83, 1.15], [-0.15, 0.82, 1.1]] }, move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 } } },
  waterGlide: { from: 'S10', class: 'wide', energy: 0.3, spec: { cheat: -6, lens: { mm: 50, fStop: 2.8, N: 48, preblur: 1, nearest: 0.5 }, cam: { orbit: { pivot: PIV, a: [51, 53], d: [9.8, 8], h: [0.12, 0.12] } }, look: { at: [[0, 0.4, 1], [0, 0.36, 1]] }, move: { ain: 0.3, aout: 0.3, v0: 0.35, v1: 0.35 }, noise: { rot: [0.3, 0.22, 0.55], pos: 0.006, freq: 0.17, rough: 0.12 }, focus: { on: HEAD } } },
  bassProfile: { from: 'S17', class: 'wide', energy: 0.5, spec: { cheat: 135, lens: { mm: 50, fStop: 4, N: 32 }, cam: { orbit: { pivot: PIV, a: [-62, -62], d: [10.2, 9.8], h: [0.49, 0.49] } }, look: { at: [[0.18, 0.8, 0.75], [0.18, 0.79, 0.75]] }, move: { ain: 0.4, aout: 0.4, v0: 0.2, v1: 0.2 }, focus: { on: HEAD } } },
  elevated: { from: 'S23', class: 'wide', energy: 0.7, spec: { cheat: 18, lens: { mm: 33, fStop: 5.6, N: 32 }, cam: { orbit: { pivot: PIV, a: [38, 40], d: [10.8, 11.4], h: [2.0, 2.6] } }, look: { at: [[0, 0.8, 1.0], [0, 0.92, 1.0]] }, move: { ain: 0.1, aout: 0.65, v0: 0.6, v1: 0 }, focus: { on: [0, 0.8, 1.0] } } },
  drone: { from: 'S20', class: 'wide', energy: 0.95, spec: { cheat: 0, lens: { mm: 35, fStop: 5.6, N: 32, preblur: 0.8 }, cam: { orbit: { pivot: [0, 0, 0.9], a: [66, 44], d: [3.6, 6], h: [1.45, 4.8] } }, look: { at: [[0, 0.95, 0.5], [0.4, 0.3, 0.75]] }, move: { ain: 0.12, aout: 0.4, v0: 0.6, v1: 0.15 }, focus: { on: [0, 0.8, 0.6] } } },
  push: { from: 'S19', class: 'wide', energy: 0.8, spec: { cheat: 53, lens: { mm: [45, 35], fStop: 4, N: 32, preblur: 1, nearest: 0.9 }, cam: { path: [[0, 0.64, -8.6], [0, 0.9, -5], [0, 1.18, -2.6], [0, 1.38, -1.62]] }, look: { at: [[0, 0.88, 1], [0, 1.1, 1]] }, move: { ain: 0.75, aout: 0.2, v0: 0.15, v1: 0 }, focus: { on: [0, 1, 0.4] } } },
  firstTouch: { from: 'S02', class: 'medium', hand: 'both', energy: 0.3, spec: { cheat: -30, lens: { mm: 40, fStop: 8, N: 32, preblur: 1, nearest: 0.7 }, cam: { path: [[0.62, 1.82, -0.78], [0.59, 1.78, -0.73]] }, look: { at: [0, 0, 0], track: { hand: 'both', w: 1, offset: [0.03, 0.02, 0.06] } }, move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 }, focus: { on: { hand: 'both' } }, pianist: { handEnv: 1.8, handDesat: 0.45, woolSheen: 0.25 } } },
  rise: { from: 'S05', class: 'medium', energy: 0.5, spec: { cheat: 0, lens: { mm: [40, 30], fStop: 5.6, N: 32 }, cam: { orbit: { pivot: PIV, a: [50, 53], d: [8.5, 6], h: [1, 2.6] } }, look: { at: [[0.2, 0.95, 0.8], [0.25, 1.45, 0.9]] }, move: { ain: 0.3, aout: 0.35, v0: 0, v1: 0 } } },
  mirror: { from: 'S09', class: 'medium', hand: 'R', energy: 0.6, spec: { cheat: 70, lens: { mm: 40, fStop: 5.6, N: 32, preblur: 1, nearest: 1.2 }, cam: { path: [[-1.62, 0.89, -1.52], [-1.56, 0.89, -1.44]] }, look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [-0.2, 0.04, 0.22] } }, move: { ain: 0.3, aout: 0.35, v0: 0.4, v1: 0.2 }, focus: { on: { hand: 'R' } }, pianist: { woolSheen: 0.16, woolAlbedo: 3.2 } } },
  profile: { from: 'S15', class: 'medium', hand: 'R', energy: 0.6, spec: { cheat: -20, lens: { mm: 50, fStop: 8, N: 32, preblur: 1.1, nearest: 1.4 }, cam: { path: [[-2.42, 0.8, -0.66], [-2.28, 0.8, -0.58]] }, look: { at: [-0.12, 0.86, -0.14], track: { hand: 'R', w: 0.55, offset: [0, 0.03, 0] } }, move: { ain: 0.25, aout: 0.3, v0: 0.5, v1: 0.4 }, focus: { on: { hand: 'R' } } } },
  lostProfile: { from: 'S16', class: 'medium', energy: 0.45, spec: { cheat: -5, lens: { mm: 135, fStop: 4, N: 48, preblur: 1 }, cam: { orbit: { pivot: [0, 0, -0.33], a: [66, 64], d: [5.6, 5.35], h: [1, 1] } }, look: { at: [[0, 1.08, -0.3], [0, 1.07, -0.3]] }, move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 }, noise: { rot: [0.05, 0.04, 0.06], freq: 0.2, rough: 0.2 }, focus: { on: HEAD } } },
  trebleHigh: { from: 'S20b', class: 'medium', hand: 'R', energy: 0.85, spec: { cheat: -40, lens: { mm: 40, fStop: 8, N: 32, preblur: 1.1, nearest: 0.5 }, cam: { orbit: { pivot: [-0.25, 0.73, 0.08], a: [80, 58], d: [1.55, 1.45], h: [1.7, 1.5] } }, look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0.04, 0, 0.06] } }, move: { ain: 0.15, aout: 0.3, v0: 0.6, v1: 0.3 }, focus: { on: { hand: 'R' } }, pianist: { handEnv: 2.8, rimKick: 0.25 } } },
  leftSilhouette: { from: 'S20c', class: 'medium', hand: 'L', energy: 0.85, spec: { cheat: 142, lens: { mm: 50, fStop: 8, N: 32, preblur: 1.1, nearest: 1 }, cam: { orbit: { pivot: [0.2, 0.8, 0], a: [-56, -84], d: [2.4, 2.35], h: [1.12, 1.05] } }, look: { at: [0, 0, 0], track: { hand: 'both', w: 1, offset: [0, 0.14, -0.1] } }, move: { ain: 0.15, aout: 0.3, v0: 0.6, v1: 0.4 }, focus: { on: { hand: 'L', fast: true, window: 0.15 } }, pianist: { handEnv: 2.8, rimKick: 0.5 } } },
  apex: { from: 'S21', class: 'medium', hand: 'R', energy: 0.9, spec: { cheat: 12, lens: { mm: 35, fStop: 8, N: 32, preblur: 1, nearest: 1.2 }, cam: { orbit: { pivot: [-0.25, 0.75, 0.1], a: [78, 40], d: [2.35, 2.1], h: [0.92, 1.22] } }, look: { at: [[-0.15, 0.82, 0.25], [-0.12, 1.35, 0.35]], track: { hand: 'R', w: 0.55 } }, move: { ain: 0.2, aout: 0.35, v0: 0.6, v1: 0 }, focus: { on: { hand: 'R' } } } },
  macroR: { from: 'S06', class: 'close', hand: 'R', energy: 0.5, spec: { cheat: -25, lens: { mm: 45, fStop: 11, N: 32, preblur: 1.1, nearest: 0.1 }, cam: { path: [[-0.79, 0.765, 0.035], [-0.725, 0.772, 0.02]] }, look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0, 0.01, 0.03] } }, move: { ain: 0.35, aout: 0.35, v0: 0.2, v1: 0.2 }, focus: { on: { hand: 'R' } }, pianist: { handEnv: 3.6, rimKick: 0.4, handDesat: 0.4, handFillTint: [2.0, 0.72, 0.5] } } },
  rhTreble: { from: 'S04', class: 'close', hand: 'R', energy: 0.4, spec: { cheat: -15, lens: { mm: 40, fStop: 5.6, N: 32, preblur: 1, nearest: 0.45 }, cam: { path: [[-1.15, 0.86, -0.45], [-1.09, 0.86, -0.39]] }, look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0.05, 0.04, 0.05] } }, follow: { hand: 'R', gain: [0.3, 0, 0] }, move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 }, focus: { on: { hand: 'R' } }, pianist: { handEnv: 7, rimKick: 0, handDesat: 0.4, handFillTint: [2.1, 0.7, 0.45], handFillDir: [0.25, 1] } } },
  lhStride: { from: 'S08', class: 'close', hand: 'L', energy: 0.6, spec: { cheat: 125, lens: { mm: 70, fStop: 16, N: 32, preblur: 1.1, nearest: 0.55 }, cam: { orbit: { pivot: { hand: 'L', at: 'mid' }, a: [-66, -60], d: [0.92, 0.86], h: [0.98, 0.96] } }, look: { at: [0, 0, 0], track: { hand: 'L', w: 1, offset: [0.04, -0.01, 0] } }, follow: { hand: 'L', gain: [0.6, 0, 0] }, move: { ain: 0.3, aout: 0.3, v0: 0.4, v1: 0.4 }, focus: { on: { hand: 'L', fast: true, window: 0.15 } } } },
  keyLevel: { from: 'S13', class: 'close', hand: 'both', energy: 0.65, spec: { cheat: 150, lens: { mm: 45, fStop: 16, N: 32, preblur: 1.1, nearest: 0.1 }, cam: { path: [[0.97, 0.88, -0.1], [0.945, 0.88, -0.1]] }, look: { at: [0, 0, 0], track: { hand: 'both', w: 1, offset: [0.05, 0.09, 0.03] } }, move: { ain: 0.3, aout: 0.3, v0: 0.4, v1: 0.4 }, focus: { on: { hand: 'R' } } } },
  topDown: { from: 'S14', class: 'close', hand: 'both', energy: 0.6, spec: { cheat: 0, lens: { mm: 35, fStop: 5.6, N: 32, preblur: 1, nearest: 0.9 }, cam: { orbit: { pivot: [0.02, 0, 0.12], a: [-9, 7], d: [0.58, 0.56], h: [2.32, 2.28] } }, look: { at: [0.02, 0.68, 0.12], track: { hand: 'both', w: 0.35, offset: [0, -0.04, 0.02] } }, move: { ain: 0.35, aout: 0.35, v0: 0.3, v1: 0.3 }, focus: { on: { hand: 'both' } }, pianist: { handEnv: 2.5, handDesat: 0.5 } } },
  walkDown: { from: 'S16b', class: 'close', hand: 'L', energy: 0.55, spec: { cheat: 120, lens: { mm: 85, fStop: 16, N: 32, preblur: 1.1, nearest: 0.6 }, cam: { path: [[1.15, 0.8, -0.62], [1.1, 0.8, -0.57]] }, look: { at: [0, 0, 0], track: { hand: 'L', w: 1, offset: [0, 0.005, 0] } }, follow: { hand: 'L', gain: [0.6, 0, 0] }, move: { ain: 0.3, aout: 0.3, v0: 0.4, v1: 0.4 }, focus: { on: { hand: 'L', fast: true } } } },
  bareHand: { from: 'S24', class: 'close', hand: 'R', energy: 0.2, spec: { cheat: -25, lens: { mm: 50, fStop: 11, N: 32, preblur: 1.1, nearest: 0.1 }, cam: { path: [[-0.64, 0.775, 0.04], [-1.12, 0.86, -0.05]] }, look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0, 0.0, 0.02] } }, move: { ain: 0.3, aout: 0.4, v0: 0.2, v1: 0.3 }, focus: { on: { hand: 'R' } }, pianist: { handEnv: 4.0, rimKick: 0.4, handDesat: 0.4, handFillTint: [2.0, 0.72, 0.5] } } },
};
const VISTA = { from: 'S01', spec: { cheat: 0, lens: { mm: 50, fStop: 5.6, N: 32 }, cam: { orbit: { pivot: PIV, a: [47, 47], d: [31, 27.5], h: [1.18, 1.18] } }, look: { at: [[0, 1.95, 1.0], [0, 1.86, 1.0]] }, move: { ain: 0.35, aout: 0, v0: 0.35, v1: 1 } } };
const BLUE_HOUR = { from: 'S25', spec: { cheat: -20, lens: { mm: 40, fStop: 5.6, N: 32 }, cam: { orbit: { pivot: [0, 0, 0.9], a: [46, 56], d: [6.6, 4.8], h: [2.3, 5.4] } }, look: { at: [[0.1, 1.55, 1.1], [0.45, 0.6, 0.6]] }, roll: [0, -14], move: { span: [null, 'pedalUp'], ain: 0.2, aout: 0.4, v0: 0.4, v1: 0 }, focus: { on: [0, 0.8, 0.7] } } };

/** the edit (EDIT shape of shots.js) for a score timeline */
export function autoEdit(tl, { seed = tl.score.seed ?? 1 } = {}) {
  const bars = tl.barList, notes = tl.notes, nb = bars.length - 1;
  const secOf = (bar) => tl.sections.find((s) => bar >= s.bar_start && bar <= s.bar_end) || tl.sections[tl.sections.length - 1];
  // section energy (mean velocity x sqrt(onset rate)) as a rank 0..1 within this piece: absolute loudness says little
  const secE = new Map(tl.sections.map((s) => {
    const ns = notes.filter((q) => q.t_on >= s.t_start && q.t_on < s.t_end);
    return [s, ns.length ? (ns.reduce((a, q) => a + q.vel, 0) / ns.length) * Math.sqrt(ns.length / Math.max(1, s.t_end - s.t_start)) : 0];
  }));
  const eSorted = [...secE.values()].sort((a, b) => a - b);
  const energyOf = (bar) => (eSorted.length > 1 ? eSorted.indexOf(secE.get(secOf(bar))) / (eSorted.length - 1) : 0.5);
  const phraseStarts = new Set((tl.phrases || []).map((p) => bars.findIndex((b) => Math.abs(b.t - p.t0) < 1e-3) + 1).filter((b) => b > 0));
  const sectionStarts = new Set(tl.sections.map((s) => s.bar_start));
  const climax = tl.sections.find((s) => s.name === 'climax');

  // closing: the last bar line that leaves the blue-hour rise >= 12 s before the film end
  const endM = tl.pedalUp + 5.5;
  let lastBar = nb;
  while (lastBar > 2 && endM - bars[lastBar - 1].t < 12) lastBar--;
  // opening: the vista holds to the first bar line >= 5 s into the music
  let bar = 1;
  while (bar < lastBar && bars[bar - 1].t < 5) bar++;

  const shots = [{ id: 'A01', name: 'Vista', from: VISTA.from, at: 'f0', ...VISTA.spec }];
  const used = [];
  let lastClose = 0, prevClass = 'wide', n = 1;
  while (bar < lastBar) {
    const t0 = bars[bar - 1].t, e = energyOf(bar);
    const target = 12 - 7 * e;
    let b1 = bar + 1;
    while (b1 < lastBar && bars[b1 - 1].t - t0 < target) b1++;
    // calm slots end on a phrase boundary within a bar; loud ones cut inside phrases too
    if (target >= 8) for (const d of [-1, 1]) if (phraseStarts.has(b1 + d) && b1 + d > bar && b1 + d <= lastBar && !phraseStarts.has(b1)) { b1 += d; break; }
    if (lastBar - b1 > 0 && bars[lastBar - 1].t - bars[b1 - 1].t < 3) b1 = lastBar;          // no sliver before the closer
    const t1 = bars[b1 - 1].t;
    // hand activity in the slot
    const ns = notes.filter((q) => q.t_on >= t0 && q.t_on < t1);
    const act = { R: ns.filter((q) => q.hand === 'R').length, L: ns.filter((q) => q.hand === 'L').length };
    const lRange = ns.filter((q) => q.hand === 'L').reduce((r, q) => [Math.min(r[0], q.pitch), Math.max(r[1], q.pitch)], [999, -1]);
    const lMoves = lRange[1] - lRange[0] >= 12;
    const secStart = sectionStarts.has(bar);
    const beforeClimax = climax && b1 === climax.bar_start;
    let best = null;
    for (const [key, T] of Object.entries(TEMPLATES)) {
      let s = 2 * hash01(seed, n, key.length * 131 + key.charCodeAt(0));
      s -= 2.5 * Math.abs(T.energy - e);
      if (T.class === 'wide' && prevClass === 'wide') s -= 8;
      if (T.class === prevClass) s -= 1.5;
      if (secStart && T.class !== 'close') s += 1.5;
      if (!secStart && T.class === 'close') s += 0.8;
      if (t0 - lastClose > 18 && T.class === 'close') s += 2.5;
      if (key === 'drone') s += climax && bar === climax.bar_start ? 4 : -2;
      if (key === 'push') s += beforeClimax && t1 - t0 > 7 ? 4 : -3;
      if (key === 'bareHand' && e > 0.4) s -= 3;
      if (T.hand === 'R' && act.R < 3) s -= 6;
      if (T.hand === 'L' && (act.L < 3 || act.L < 0.5 * act.R)) s -= 6;
      if (T.hand === 'L' && lMoves) s += 1;
      if (T.hand === 'both' && (act.L < 2 || act.R < 2)) s -= 4;
      if (!act.L && !act.R && T.class === 'close') s -= 10;
      const k = used.lastIndexOf(key);
      if (k >= 0 && used.length - k <= 4) s -= 10;
      s -= 1.2 * used.filter((u) => u === key).length;
      if (n === 1 && T.class === 'medium') s += 2;              // after the vista: establish him before the hands
      if (!best || s > best.s) best = { s, key };
    }
    const T = TEMPLATES[best.key];
    n++;
    shots.push({ id: `A${String(n).padStart(2, '0')}`, name: best.key, from: T.from, at: `${bar}:1`, ...structuredClone(T.spec) });
    used.push(best.key); prevClass = T.class;
    if (T.class === 'close') lastClose = t1;
    bar = b1;
  }
  n++;
  shots.push({ id: `A${String(n).padStart(2, '0')}`, name: 'Blue hour', from: BLUE_HOUR.from, at: `${lastBar}:1`, ...structuredClone(BLUE_HOUR.spec) });

  // sun: the film's arc, spread over this piece's length (strictly increasing anchors)
  const dur = tl.end;
  const sun = [['f0', -0.8], [`m${(0.25 * dur).toFixed(3)}`, -0.95], [`m${(0.5 * dur).toFixed(3)}`, -1.1], [`m${(0.75 * dur).toFixed(3)}`, -1.4],
    [`m${(0.92 * dur).toFixed(3)}`, -2.0], ['pedalUp', -3.9], ['filmEnd', -4.5]];
  const sunOk = []; let last = -1;
  for (const k of sun) { const t = k[0] === 'filmEnd' ? endM + MUSIC_OFFSET : tl.resolve(k[0]); if (t > last + 0.1) { sunOk.push(k); last = t; } }
  return {
    end: 'pedalUp+5.5s',
    cutOnAnticipation: { maxBeats: 0.75 },
    fades: { in: { dur: 1.6, ev: 9 }, out: { dur: 4.5, ev: 9 } },
    sun: sunOk,
    shots,
  };
}

// ------------------------------------------------------------------------------------------------ build
const QS = (() => { try { return new URL(import.meta.url).searchParams; } catch { return new URLSearchParams(); } })();
const { score, url } = await loadScore(QS.get('score') ? [QS.get('score')] : undefined);
export const SCORE_URL = url;
export const timeline = new MusicTimeline(score, url);
const HT = QS.get('handtrack') ? await (async () => { globalThis.AG_HANDTRACK = QS.get('handtrack'); try { return await loadHandTrack(); } finally { delete globalThis.AG_HANDTRACK; } })() : { track: null, url: 'none' };
export const hands = buildHandTracks(score, {}, HT.track);
if (hands.source !== 'perf') console.warn(`[camera] auto: hand track ${HT.url} not used (${hands.why}); following the score proxy`);
export const HANDTRACK_URL = HT.url;
export const EDIT = autoEdit(timeline);
export const director = createDirector(EDIT, timeline, hands);
export const FILM_END = director.filmEnd;
export const FILM_FRAMES = director.FILM_FRAMES;
export const shotAt = (t) => director.shotAt(t);
export const cameraAt = (t, raw) => director.cameraAt(t, raw);
export const SUN_KEYS = director.sunDenseKeys;
export const SHOTS = director.SHOTS;

export async function create(ctx) { return cameraCompanion(ctx, { director, timeline, SHOTS, SUN_KEYS, FILM_END, SCORE_URL }); }
