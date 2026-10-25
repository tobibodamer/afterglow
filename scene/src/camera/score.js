// Musical time for the edit: loads score.json and resolves musical anchors ("chorus1@2:3", "17:1", "end+3s") to
// film time, so a re-timed final score keeps every cut on the music. Works in the browser (fetch) and in Node (fs).
//
// Score source, first that exists: globalThis.AG_SCORE (a pin, set by importing shots.js?score=<url>),
// ?score=<url> (page) / AG_SCORE (Node env), /music/final/score.json, /music/candidates/melody/score.json.
//
// ANCHOR GRAMMAR (beats are 1-based like bar.beat notation: beat 1 = the downbeat; fractional beats allowed)
//   'chorus1@2:3.5'   section chorus1, its 2nd bar, beat 3.5          'chorus1' = section start (bar 1 beat 1)
//   '17:1' or '17'    global bar 17, beat 1
//   'f12.5'           film time 12.5 s          'm10'   music time 10 s
//   'end'             end of the last bar        'lastNote' last key release     'pedalUp' final pedal release
//   'lastMel'         onset of the final melody note (the line's last arrival)
//   'filmEnd'         the film's last instant (set by the edit)
//   offsets, any number, appended: '+0.5s' seconds, '-1b' beats (at the local tempo), '+2f' frames (1/60 s)
import { MUSIC_OFFSET, FPS } from '../core/constants.js';

export const SCORE_URLS = ['/music/final/score.json', '/music/candidates/melody/score.json'];

const IS_NODE = typeof window === 'undefined';

export async function loadScore(urls = SCORE_URLS) {
  const list = [...urls];
  if (!IS_NODE) { const q = new URLSearchParams(location.search).get('score'); if (q) list.unshift(q); }
  else if (globalThis.process?.env?.AG_SCORE) list.unshift(globalThis.process.env.AG_SCORE);
  if (globalThis.AG_SCORE) list.unshift(globalThis.AG_SCORE);        // pinned by shots.js?score=<url> (see shots.js)
  const errors = [];
  for (const u of list) {
    try {
      if (IS_NODE) {
        const fs = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        const root = fileURLToPath(new URL('../../../', import.meta.url));
        const p = /^[A-Za-z]:|^\\\\/.test(u) ? u : root + u.replace(/^\//, '');
        return { score: JSON.parse(await fs.readFile(p, 'utf8')), url: u };
      }
      const r = await fetch(u, { cache: 'no-cache' });
      if (!r.ok) { errors.push(`${u}: ${r.status}`); continue; }
      return { score: await r.json(), url: u };
    } catch (e) { errors.push(`${u}: ${e.message}`); }
  }
  throw new Error(`camera: no score.json found (${errors.join('; ')})`);
}

export class MusicTimeline {
  constructor(score, url = '') {
    this.url = url;
    this.score = score;
    this.bars = new Map(score.bars.map((b) => [b.bar, b]));
    this.barList = score.bars;
    this.beats = score.beats;                        // global beat index -> music time
    this.sections = score.sections;
    this.sectionByName = new Map(score.sections.map((s) => [s.name, s]));
    this.phrases = score.phrases || [];
    this.notes = score.notes;
    const lastBar = score.bars[score.bars.length - 1];
    this.end = lastBar.t;                            // end of the final bar (bars[] carries an end marker)
    this.lastNoteOn = Math.max(...score.notes.map((n) => n.t_on));
    this.lastNote = Math.max(...score.notes.map((n) => n.t_off));
    const mel = score.notes.filter((n) => n.voice === 'mel');
    this.lastMel = mel.length ? Math.max(...mel.map((n) => n.t_on)) : this.lastNoteOn;
    const ped = score.pedal || [];
    let up = this.lastNote;
    for (let i = ped.length - 1; i >= 0; i--) { if (ped[i][1] > 0) { up = ped[Math.min(ped.length - 1, i + 1)][0]; break; } }
    this.pedalUp = Math.max(up, this.lastNote);
    this.filmEnd = null;                             // set by the edit (director)
  }

  /** music time of a fractional global beat index (linear between beat times; extrapolated at the ends) */
  beatTime(g) {
    const B = this.beats, n = B.length;
    if (g <= 0) return B[0] + g * (B[1] - B[0]);
    if (g >= n - 1) return B[n - 1] + (g - (n - 1)) * (B[n - 1] - B[n - 2]);
    const i = Math.floor(g); return B[i] + (g - i) * (B[i + 1] - B[i]);
  }
  /** fractional global beat index at music time m (inverse of beatTime) */
  beatAt(m) {
    const B = this.beats, n = B.length;
    if (m <= B[0]) return (m - B[0]) / (B[1] - B[0]);
    if (m >= B[n - 1]) return (n - 1) + (m - B[n - 1]) / (B[n - 1] - B[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (B[mid] <= m) lo = mid; else hi = mid; }
    return lo + (m - B[lo]) / (B[hi] - B[lo]);
  }
  /** music time of bar.beat (beat 1-based) */
  barBeat(bar, beat = 1) {
    const b = this.bars.get(bar);
    if (!b) throw new Error(`camera: bar ${bar} not in score (${this.url})`);
    return this.beatTime(b.beat0 + (beat - 1));
  }
  /** { bar, beat (1-based, fractional), section } at music time m (for overlays and logs) */
  position(m) {
    const g = this.beatAt(m);
    let bar = this.barList[0];
    for (const b of this.barList) { if (b.beat0 <= g + 1e-9) bar = b; else break; }
    const sec = this.sections.find((s) => m >= s.t_start && m < s.t_end) || (m < 0 ? { name: 'preroll' } : { name: 'tail' });
    return { bar: bar.bar, beat: g - bar.beat0 + 1, section: sec.name, m };
  }

  /**
   * Cut rule "never in the middle of a held melody note": if a melody note is sounding at film time t that was
   * attacked shortly before it (an anticipation pushed ahead of the beat, at most maxBeats earlier), return that
   * attack's film time, else t. A long tie over the bar line (more than maxBeats) is left alone: that cut is on the
   * bass's arrival under a held common tone, which is a motivated exception the shot list states.
   */
  melodyAttack(filmT, maxBeats = 0.75) {
    const m = filmT - MUSIC_OFFSET, g = this.beatAt(m);
    let best = null;
    for (const n of this.notes) {
      if (n.voice !== 'mel' || !(n.t_on < m - 0.03) || !(n.t_off > m + 0.15)) continue;
      if (g - this.beatAt(n.t_on) > maxBeats) continue;
      if (best == null || n.t_on > best) best = n.t_on;
    }
    return best == null ? filmT : best + MUSIC_OFFSET;
  }

  /**
   * Cut rule "cut on the push": if the beat at film time t is anticipated - notes of the given voices (default: every
   * voice except ghost notes) attacked at most maxBeats before it and still sounding 0.1 s after it - return the film
   * time of the EARLIEST such attack that does not split a sounding melody note (see below), else t. A syncopated hip-hop
   * push lands the cut with the push instead of between its attacks (critic, resume 3: S09 fell 210 ms after the
   * pushed G1 and 174 ms before the downbeat).
   */
  pushAttack(filmT, maxBeats = 0.75, voices = null, splitS = 0.15) {
    const m = filmT - MUSIC_OFFSET, g = this.beatAt(m);
    const cands = [];
    for (const n of this.notes) {
      if (voices ? !voices.includes(n.voice) : n.voice === 'ghost') continue;
      if (!(n.t_on < m - 0.03) || !(n.t_off > m + 0.1)) continue;
      if (g - this.beatAt(n.t_on) > maxBeats) continue;
      cands.push(n.t_on);
    }
    // Critic r2 (S09, S16): a push carried by the bass / inner voices cut 364 ms into a melody F5 that was still
    // sounding. A candidate that would split a melody note already sounding for more than splitS (and still sounding
    // 80 ms later: legato overlaps are not splits) is skipped; the next candidate (typically the melody's own attack)
    // or, when none is left, the beat itself is used.
    cands.sort((a, b) => a - b);
    for (const c of cands) if (!this.splitsMelody(c, splitS)) return c + MUSIC_OFFSET;
    return filmT;
  }
  /** true when a melody note attacked more than splitS before music time c is still sounding 80 ms after it */
  splitsMelody(c, splitS = 0.15) {
    return this.notes.some((n) => n.voice === 'mel' && n.t_on < c - splitS && n.t_off > c + 0.08);
  }

  /** resolve an anchor to FILM time (seconds, not frame-quantised) */
  resolve(anchor) {
    if (typeof anchor === 'number') return anchor;
    const s = String(anchor).trim();
    const m = /^(.*?)((?:[+-]\d*\.?\d+[sbf])*)$/.exec(s);
    const base = m[1], offs = m[2] ? m[2].match(/[+-]\d*\.?\d+[sbf]/g) : [];
    let film;
    let r;
    if ((r = /^f(-?\d*\.?\d+)$/.exec(base))) film = +r[1];
    else if ((r = /^m(-?\d*\.?\d+)$/.exec(base))) film = +r[1] + MUSIC_OFFSET;
    else if (base === 'end') film = this.end + MUSIC_OFFSET;
    else if (base === 'lastNote') film = this.lastNote + MUSIC_OFFSET;
    else if (base === 'pedalUp') film = this.pedalUp + MUSIC_OFFSET;
    else if (base === 'lastMel') film = this.lastMel + MUSIC_OFFSET;
    else if (base === 'filmEnd') { if (this.filmEnd == null) throw new Error('camera: filmEnd not set yet'); film = this.filmEnd; }
    else if ((r = /^(\d+)(?::(\d*\.?\d+))?$/.exec(base))) film = this.barBeat(+r[1], r[2] ? +r[2] : 1) + MUSIC_OFFSET;
    else if ((r = /^([A-Za-z][\w]*)(?:@(\d+)(?::(\d*\.?\d+))?)?$/.exec(base))) {
      const sec = this.sectionByName.get(r[1]);
      if (!sec) throw new Error(`camera: unknown section "${r[1]}" in anchor "${s}" (score sections: ${[...this.sectionByName.keys()].join(', ')})`);
      const bar = sec.bar_start + (r[2] ? +r[2] - 1 : 0);
      if (r[2] && bar > sec.bar_end) throw new Error(`camera: anchor "${s}" is past the end of section ${r[1]} (bars ${sec.bar_start}-${sec.bar_end})`);
      film = this.barBeat(bar, r[3] ? +r[3] : 1) + MUSIC_OFFSET;
    } else throw new Error(`camera: cannot parse anchor "${s}"`);
    for (const o of offs) {
      const v = parseFloat(o.slice(0, -1)), u = o.slice(-1);
      if (u === 's') film += v;
      else if (u === 'f') film += v / FPS;
      else if (u === 'b') film = this.beatTime(this.beatAt(film - MUSIC_OFFSET) + v) + MUSIC_OFFSET;
    }
    return film;
  }
}

/**
 * Cut quantisation: a cut lands on the last frame boundary at or before the musical event (0-16.7 ms early, never
 * late: picture changes are perceived ~1 frame late relative to sound, so "on or just before the beat" reads as on it).
 */
export const cutFrame = (filmT) => Math.floor(filmT * FPS + 1e-6);
export const cutTime = (filmT) => cutFrame(filmT) / FPS;
