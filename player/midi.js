// MIDI -> score.json: the input of the performance solver (perf/solve.mjs), the camera (scene/src/camera/score.js) and
// the player's synth. Plain ES module with no imports, so Node (player/play.mjs) and the browser run the same code.
//
//   const score = midiToScore(bytes, { title })  -> { title, duration, notes, pedal, bars, beats, sections, phrases, ... }
//   score.report                                 -> what the conversion changed (dropped / moved notes, ranges)
//
// What a MIDI file does not carry, and how it is made here:
//   hands     a Viterbi search over onset groups: every group is split at one pitch (below -> L, above -> R), scored on
//             each hand's span (with the keys it still holds), hand travel against the time it has, register and
//             crossings. Notes one hand cannot take (more than 5, beyond a tenth) go to the other hand or are dropped.
//   fingers   none (finger 0): the solver fingers every note itself (perf/lib/fingering.js).
//   voices    'mel' = the top note of each right-hand group, 'bass' = the bottom of each left-hand group, else 'acc'.
//   sections  bars grouped into 4-bar phrases (2 or 8 when the tempo makes 4 bars very short or long) and phrases into
//             sections, broken at long rests; named by loudness ('climax', 'chorus<k>', 'verse<k>', 'intro', 'coda')
//             because the body motion scales its gestures by section name (perf/lib/body.js).
//   pedal     CC64 of every channel as [t, value] steps.
// Times are in seconds from the downbeat of the first bar with a note (empty leading bars are dropped).

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const noteName = (p) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ------------------------------------------------------------------------------------------------ SMF parser
/** Standard MIDI File -> { format, division, tracks: [[{ tick, kind, ch, a, b, meta, data }]] } */
export function parseMidi(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  let o = 0;
  // RIFF-wrapped MIDI (.rmi)
  if (tag(0) === 'RIFF' && tag(8) === 'RMID') { o = 12; while (o + 8 <= u8.length && tag(o) !== 'data') o += 8 + dv.getUint32(o + 4, true); o += 8; }
  if (tag(o) !== 'MThd') throw new Error('not a MIDI file (no MThd header)');
  const hlen = dv.getUint32(o + 4);
  const format = dv.getUint16(o + 8), ntrks = dv.getUint16(o + 10), division = dv.getUint16(o + 12);
  o += 8 + hlen;
  const tracks = [];
  while (o + 8 <= u8.length && tracks.length < ntrks) {
    const id = tag(o), len = dv.getUint32(o + 4); o += 8;
    const end = Math.min(u8.length, o + len);
    if (id !== 'MTrk') { o = end; continue; }
    const ev = []; let tick = 0, running = 0, p = o;
    const vlq = () => { let v = 0, c; do { c = u8[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < end); return v; };
    while (p < end) {
      tick += vlq();
      let st = u8[p];
      if (st & 0x80) p++; else if (running) st = running; else throw new Error(`MIDI track ${tracks.length}: data byte without status at ${p}`);
      if (st === 0xff) {
        const type = u8[p++], l = vlq(); ev.push({ tick, kind: 'meta', meta: type, data: u8.subarray(p, p + l) }); p += l;
      } else if (st === 0xf0 || st === 0xf7) {
        const l = vlq(); p += l;
      } else {
        running = st;
        const hi = st & 0xf0, ch = st & 0x0f;
        const a = u8[p++], b = hi === 0xc0 || hi === 0xd0 ? 0 : u8[p++];
        const kind = hi === 0x90 ? (b > 0 ? 'on' : 'off') : hi === 0x80 ? 'off' : hi === 0xb0 ? 'cc' : 'other';
        if (kind !== 'other') ev.push({ tick, kind, ch, a, b });
      }
    }
    tracks.push(ev); o = end;
  }
  return { format, division, tracks };
}

// ------------------------------------------------------------------------------------------------ time
function tempoMap(midi) {
  const smpte = midi.division & 0x8000;
  if (smpte) {
    const fps = 256 - (midi.division >> 8), tpf = midi.division & 0xff;
    return { ppq: 480, toSec: (tick) => tick / (fps * tpf) };   // no beats in SMPTE files: a 120 bpm grid
  }
  const ppq = midi.division;
  const tempos = [];
  for (const tr of midi.tracks) for (const e of tr) if (e.kind === 'meta' && e.meta === 0x51 && e.data.length >= 3) tempos.push({ tick: e.tick, us: (e.data[0] << 16) | (e.data[1] << 8) | e.data[2] });
  tempos.sort((a, b) => a.tick - b.tick);
  const segs = [{ tick: 0, sec: 0, us: 500000 }];
  for (const t of tempos) {
    const s = segs[segs.length - 1];
    if (t.tick === s.tick) { s.us = t.us; continue; }
    segs.push({ tick: t.tick, sec: s.sec + ((t.tick - s.tick) / ppq) * s.us / 1e6, us: t.us });
  }
  const toSec = (tick) => {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].tick <= tick) lo = m; else hi = m - 1; }
    const s = segs[lo]; return s.sec + ((tick - s.tick) / ppq) * s.us / 1e6;
  };
  return { ppq, toSec, tempos: segs };
}

function meterMap(midi) {
  const ts = [];
  for (const tr of midi.tracks) for (const e of tr) if (e.kind === 'meta' && e.meta === 0x58 && e.data.length >= 2) ts.push({ tick: e.tick, num: e.data[0] || 4, den: 2 ** e.data[1] });
  ts.sort((a, b) => a.tick - b.tick);
  if (!ts.length || ts[0].tick > 0) ts.unshift({ tick: 0, num: 4, den: 4 });
  return ts;
}

// ------------------------------------------------------------------------------------------------ notes
function collectNotes(midi, toSec, report) {
  const notes = [], pedal = [], open = new Map();
  const all = [];
  midi.tracks.forEach((tr, ti) => { for (const e of tr) if (e.kind === 'on' || e.kind === 'off' || (e.kind === 'cc' && e.a === 64)) all.push({ ...e, ti }); });
  // offs before ons at the same tick (a re-struck key), then track order
  all.sort((x, y) => x.tick - y.tick || (x.kind === 'off' ? 0 : 1) - (y.kind === 'off' ? 0 : 1));
  for (const e of all) {
    if (e.kind === 'cc') { pedal.push([toSec(e.tick), e.b]); continue; }
    if (e.ch === 9) { if (e.kind === 'on') report.drums++; continue; }
    const key = `${e.ti}:${e.ch}:${e.a}`;
    if (e.kind === 'on') {
      if (!open.has(key)) open.set(key, []);
      open.get(key).push({ pitch: e.a, vel: e.b, t_on: toSec(e.tick) });
    } else {
      const st = open.get(key);
      if (st && st.length) { const n = st.shift(); n.t_off = toSec(e.tick); notes.push(n); }
    }
  }
  for (const st of open.values()) for (const n of st) { n.t_off = n.t_on + 1; notes.push(n); report.unterminated++; }
  return { notes, pedal };
}

/** piano range, one key one note at a time, a minimum length */
function cleanNotes(notes, report) {
  for (const n of notes) {
    let p = n.pitch;
    while (p < 21) p += 12;
    while (p > 108) p -= 12;
    if (p !== n.pitch) { report.transposed++; n.pitch = p; }
    n.vel = clamp(n.vel, 1, 127);
  }
  notes.sort((a, b) => a.t_on - b.t_on || a.pitch - b.pitch);
  const out = [], last = new Map();
  for (const n of notes) {
    const q = last.get(n.pitch);
    if (q && n.t_on - q.t_on < 0.02) { q.vel = Math.max(q.vel, n.vel); q.t_off = Math.max(q.t_off, n.t_off); report.merged++; continue; }
    if (q && q.t_off > n.t_on - 0.01) { q.t_off = Math.max(q.t_on + 0.02, n.t_on - 0.01); report.shortened++; }
    out.push(n); last.set(n.pitch, n);
  }
  for (const n of out) n.t_off = Math.max(n.t_off, n.t_on + 0.04);
  return out;
}

// ------------------------------------------------------------------------------------------------ hands
const GROUP_S = 0.035;     // onsets closer than this form one group (a chord, a roll)
const MAX_SPAN = 14;       // semitones one hand can hold (a ninth/tenth: 1-5 MaxPrac 15 in perf/lib/fingering.js)

function groupOnsets(notes) {
  const groups = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && n.t_on - g.t < GROUP_S) g.notes.push(n); else groups.push({ t: n.t_on, notes: [n] });
  }
  for (const g of groups) g.notes.sort((a, b) => a.pitch - b.pitch);
  return groups;
}

// weights fitted on the four scores of music/ and piano-midi.de's Clair de lune (98-99.5 % of notes in the composer's
// hand from the MIDI files alone; 89.5 % on the Debussy, whose left-hand arpeggios climb past the right hand)
export const W = { move: 0.1, leapFree: 12, leap: 0.001, reg: 0.8, lTop: 64, rBottom: 60, stream: 6, streamS: 0.3 };
/** cost of one hand taking `pitches` at time t, given what it still holds and where it was */
function handCost(side, pitches, held, prev, dt) {
  if (!pitches.length) return 0;
  if (pitches.length > 5) return 1e4;
  const all = held.length ? pitches.concat(held) : pitches;
  const lo = Math.min(...pitches), hi = Math.max(...pitches);
  const loA = Math.min(...all), hiA = Math.max(...all);
  let c = 0;
  c += Math.max(0, hi - lo - 12) * 6 + (hi - lo > MAX_SPAN ? 300 : 0);
  // held keys: soft (the solver releases them early under the pedal when the hand has to move)
  c += Math.min(40, Math.max(0, hiA - loA - 12) * 2);
  if (all.length > 5) c += 20 * (all.length - 5);
  const centre = (lo + hi) / 2;
  if (prev != null) {
    const d = Math.abs(centre - prev);
    c += W.move * d + Math.max(0, d - W.leapFree) ** 2 * W.leap / Math.max(dt, 0.06);
  }
  // register: the left hand below the right, middle C is shared
  c += side === 'L' ? W.reg * Math.max(0, hi - W.lTop) : W.reg * Math.max(0, W.rBottom - lo);
  return c;
}

export function splitHands(notes, report = {}) {
  const groups = groupOnsets(notes);
  // state per candidate split k (k lowest notes to L): accumulated cost, back-pointer and the hand state of its best path
  let layer = [{ cost: 0, back: -1, pos: { L: null, R: null }, tLast: { L: -1e9, R: -1e9 }, held: [] }];
  const backs = [];
  for (const g of groups) {
    const P = g.notes.map((n) => n.pitch), n = P.length, next = [];
    for (let k = 0; k <= n; k++) {
      const L = P.slice(0, k), R = P.slice(k);
      let best = null;
      layer.forEach((s, si) => {
        const held = s.held.filter((h) => h.off > g.t + 0.05);
        const hL = held.filter((h) => h.side === 'L').map((h) => h.p), hR = held.filter((h) => h.side === 'R').map((h) => h.p);
        let c = s.cost + handCost('L', L, hL, s.pos.L, g.t - s.tLast.L) + handCost('R', R, hR, s.pos.R, g.t - s.tLast.R);
        // crossing: the hands overlap only briefly (a held key of the other hand inside this hand's range)
        const lHi = Math.max(-1, ...L, ...hL), rLo = Math.min(999, ...R, ...hR);
        if (lHi >= rLo) c += 25 + 4 * (lHi - rLo);
        // a run of single notes (arpeggio, scale) stays in one hand: handing it over mid-figure costs
        if (n === 1 && s.solo && g.t - s.solo.t < W.streamS && s.solo.side !== (k ? 'L' : 'R')) c += W.stream;
        if (!best || c < best.cost) best = { cost: c, si, held };
      });
      const s = layer[best.si];
      const pos = { ...s.pos }, tLast = { ...s.tLast };
      if (L.length) { pos.L = (L[0] + L[L.length - 1]) / 2; tLast.L = g.t; }
      if (R.length) { pos.R = (R[0] + R[R.length - 1]) / 2; tLast.R = g.t; }
      const held = best.held.concat(g.notes.map((q, i) => ({ p: q.pitch, off: q.t_off, side: i < k ? 'L' : 'R' })));
      next.push({ cost: best.cost, back: best.si, pos, tLast, held, solo: n === 1 ? { side: k ? 'L' : 'R', t: g.t } : null });
    }
    backs.push(next.map((s) => s.back));
    layer = next;
  }
  let k = layer.reduce((b, s, i) => (s.cost < layer[b].cost ? i : b), 0);
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    g.notes.forEach((q, i) => { q.hand = i < k ? 'L' : 'R'; });
    k = backs[gi][k];
  }
  // what the two hands still cannot take (more than 5 keys or a stretch past MAX_SPAN in one hand): the group is split
  // again at the pitch that keeps the most notes, each hand keeping its playable core, the fullest window of MAX_SPAN
  // (the highest one for R, the lowest for L, thinned to 5 keeping its outer notes); the rest is dropped
  const keep = new Set(notes);
  const fits = (arr) => arr.length <= 5 && (!arr.length || arr[arr.length - 1].pitch - arr[0].pitch <= MAX_SPAN);
  const core = (arr, side) => {
    let best = null;
    for (let i = 0; i < arr.length; i++) {
      let j = i; while (j + 1 < arr.length && arr[j + 1].pitch - arr[i].pitch <= MAX_SPAN) j++;
      const w = arr.slice(i, j + 1), score = Math.min(5, w.length) * 1000 + (side === 'R' ? arr[j].pitch : -arr[i].pitch);
      if (!best || score > best.score) best = { score, w };
    }
    const w = best.w;
    if (w.length <= 5) return w;
    const inner = w.slice(1, -1), pick = [];
    for (let k = 0; k < 3; k++) pick.push(inner[Math.round((k + 1) * (inner.length + 1) / 4) - 1]);
    return [w[0], ...new Set(pick), w[w.length - 1]];
  };
  for (const g of groups) {
    const P = g.notes;
    if (fits(P.filter((q) => q.hand === 'L')) && fits(P.filter((q) => q.hand === 'R'))) continue;
    let best = null;
    for (let k = 0; k <= P.length; k++) {
      const cl = k ? core(P.slice(0, k), 'L') : [], cr = k < P.length ? core(P.slice(k), 'R') : [];
      if (!best || cl.length + cr.length > best.n) best = { n: cl.length + cr.length, cl, cr, k };
    }
    const kl = new Set(best.cl), kr = new Set(best.cr);
    P.forEach((q, i) => {
      const hand = kl.has(q) ? 'L' : kr.has(q) ? 'R' : null;
      if (!hand) { keep.delete(q); report.dropped = (report.dropped || 0) + 1; return; }
      if (hand !== q.hand) { q.hand = hand; report.moved = (report.moved || 0) + 1; }
    });
  }
  return { notes: notes.filter((q) => keep.has(q)), groups };
}

function assignVoices(notes) {
  for (const g of groupOnsets(notes)) {
    const R = g.notes.filter((q) => q.hand === 'R'), L = g.notes.filter((q) => q.hand === 'L');
    R.forEach((q, i) => { q.voice = i === R.length - 1 ? 'mel' : 'acc'; });
    L.forEach((q, i) => { q.voice = i === 0 ? 'bass' : 'acc'; });
  }
}

// ------------------------------------------------------------------------------------------------ structure
function buildGrid(midi, tm, endTick) {
  const meters = meterMap(midi), ppq = tm.ppq;
  const bars = [], beats = [];
  let tick = 0, mi = 0, g = 0;
  while (true) {
    while (mi + 1 < meters.length && meters[mi + 1].tick <= tick) mi++;
    const { num, den } = meters[mi];
    const beatTicks = ppq * 4 / den;
    bars.push({ bar: bars.length + 1, beat0: g, t: tm.toSec(tick), beats: num, tick });
    for (let b = 0; b < num; b++) beats.push(tm.toSec(tick + b * beatTicks));
    g += num; tick += num * beatTicks;
    if (tick > endTick) break;
  }
  bars.push({ bar: bars.length + 1, beat0: g, t: tm.toSec(tick), beats: bars[bars.length - 1].beats, tick });
  beats.push(tm.toSec(tick));
  return { bars, beats };
}

function buildStructure(notes, bars) {
  const nb = bars.length - 1;
  const dur = (i, j) => bars[Math.min(nb, j)].t - bars[i].t;
  const per = dur(0, Math.min(nb, 4)) / Math.min(nb, 4) * 4;
  const pBars = per < 5 ? 8 : per > 20 ? 2 : 4;
  // a long rest (nothing sounding for 2 s) starts a new phrase at the next bar
  const rests = new Set();
  const sorted = [...notes].sort((a, b) => a.t_on - b.t_on);
  let off = -1e9;
  for (const n of sorted) {
    if (n.t_on - off > 2) { const b = bars.findIndex((x) => x.t > n.t_on - 0.05); if (b > 0) rests.add(b - 1); }
    off = Math.max(off, n.t_off);
  }
  const phrases = [];
  let i = 0;
  while (i < nb) {
    let j = Math.min(nb, i + pBars);
    for (let k = i + 1; k < j; k++) if (rests.has(k)) { j = k; break; }
    if (nb - j > 0 && nb - j < pBars / 2) j = nb;               // a short remainder joins the last phrase
    phrases.push({ b0: i, b1: j });
    i = j;
  }
  const energy = (t0, t1) => {
    const ns = notes.filter((n) => n.t_on >= t0 && n.t_on < t1);
    if (!ns.length) return 0;
    const v = ns.reduce((a, n) => a + n.vel, 0) / ns.length;
    return v * Math.sqrt(ns.length / Math.max(1, t1 - t0));
  };
  for (const p of phrases) { p.t0 = bars[p.b0].t; p.t1 = bars[p.b1].t; p.e = energy(p.t0, p.t1); }
  const eMax = Math.max(1e-6, ...phrases.map((p) => p.e));
  for (const p of phrases) p.peak = +clamp(0.25 + 0.55 * p.e / eMax, 0, 0.8).toFixed(2);
  // sections: pairs of phrases (a single long phrase stands alone)
  const secs = [];
  for (let k = 0; k < phrases.length; k++) {
    const a = phrases[k], b = phrases[k + 1];
    if (b && a.b1 - a.b0 < 8 && b.b1 - b.b0 < 8 && !rests.has(b.b0)) { secs.push({ b0: a.b0, b1: b.b1, e: (a.e + b.e) / 2 }); k++; }
    else secs.push({ b0: a.b0, b1: a.b1, e: a.e });
  }
  const ranks = [...secs].sort((x, y) => y.e - x.e);
  const median = ranks[Math.floor(ranks.length / 2)]?.e ?? 0;
  let nc = 0, nv = 0;
  secs.forEach((s, k) => {
    if (s === ranks[0] && secs.length > 2) s.name = 'climax';
    else if (k === 0 && s.e < median && secs.length > 2) s.name = 'intro';
    else if (k === secs.length - 1 && s.e < median && secs.length > 2) s.name = 'coda';
    else if (s.e >= median) s.name = `chorus${++nc}`;
    else s.name = `verse${++nv}`;
  });
  const sections = secs.map((s) => ({ name: s.name, bar_start: s.b0 + 1, bar_end: s.b1, t_start: bars[s.b0].t, t_end: bars[s.b1].t, energy: +(s.e / eMax).toFixed(3) }));
  return { sections, phrases: phrases.map((p) => ({ t0: p.t0, t1: p.t1, peak: p.peak })) };
}

// ------------------------------------------------------------------------------------------------ convert
export function midiToScore(input, { title = 'MIDI', seed = 1 } = {}) {
  const midi = parseMidi(input);
  const tm = tempoMap(midi);
  const report = { drums: 0, unterminated: 0, transposed: 0, merged: 0, shortened: 0, moved: 0, dropped: 0 };
  const raw = collectNotes(midi, tm.toSec, report);
  if (!raw.notes.length) throw new Error('the MIDI file has no (non-drum) notes');
  let notes = cleanNotes(raw.notes, report);
  const secToTick = (s) => { let lo = 0, hi = 1e9; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (tm.toSec(m) < s) lo = m; else hi = m; } return hi; };
  const endTick = secToTick(Math.max(...notes.map((n) => n.t_off)));
  const grid = buildGrid(midi, tm, endTick);

  // drop the empty bars before the first note; everything moves to the first kept downbeat
  const first = Math.min(...notes.map((n) => n.t_on));
  let b0 = 0; while (b0 + 1 < grid.bars.length && grid.bars[b0 + 1].t <= first + 1e-6) b0++;
  const shift = grid.bars[b0].t, g0 = grid.bars[b0].beat0;
  const bars = grid.bars.slice(b0).map((b, i) => ({ bar: i + 1, beat0: b.beat0 - g0, t: +(b.t - shift).toFixed(5), beats: b.beats }));
  const beats = grid.beats.slice(g0).map((t) => +(t - shift).toFixed(5));
  for (const n of notes) { n.t_on -= shift; n.t_off -= shift; }

  const split = splitHands(notes, report);
  notes = split.notes;
  assignVoices(notes);

  // pedal: steps from t 0 (the state before the first kept bar carries over), repeated values dropped
  const ped = raw.pedal.map(([t, v]) => [t - shift, v]).sort((a, b) => a[0] - b[0]);
  const pedal = [];
  let before = 0;
  for (const [t, v] of ped) {
    if (t <= 0) { before = v; continue; }
    if (!pedal.length) pedal.push([0, before]);
    if (pedal[pedal.length - 1][1] !== v) pedal.push([+t.toFixed(5), v]);
  }
  if (!pedal.length && before) pedal.push([0, before]);
  if (pedal.length && pedal[pedal.length - 1][1] > 0) pedal.push([+(Math.max(...notes.map((n) => n.t_off)) + 0.2).toFixed(5), 0]);

  const { sections, phrases } = buildStructure(notes, bars);
  const barOf = (t) => { let k = 0; while (k + 1 < bars.length - 1 && bars[k + 1].t <= t + 1e-6) k++; return k; };
  const beatOf = (t) => { let lo = 0, hi = beats.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; } return lo + clamp((t - beats[lo]) / Math.max(1e-6, beats[hi] - beats[lo]), 0, 1); };
  notes.sort((a, b) => a.t_on - b.t_on || a.pitch - b.pitch);
  const out = notes.map((n, id) => {
    const bi = barOf(n.t_on), sec = sections.find((s) => bi + 1 >= s.bar_start && bi + 1 <= s.bar_end);
    return { id, pitch: n.pitch, name: noteName(n.pitch), t_on: +n.t_on.toFixed(5), t_off: +n.t_off.toFixed(5), vel: n.vel, hand: n.hand, voice: n.voice, finger: 0,
      bar: bi + 1, section: sec ? sec.name : sections[sections.length - 1].name, beat: +beatOf(n.t_on).toFixed(3) };
  });
  const lastOff = Math.max(...out.map((n) => n.t_off));
  report.notes = out.length;
  report.hands = { L: out.filter((n) => n.hand === 'L').length, R: out.filter((n) => n.hand === 'R').length };
  report.bars = bars.length - 1;
  report.tempoChanges = tm.tempos ? tm.tempos.length - 1 : 0;
  return {
    title, lead_in: 0, duration: +Math.max(lastOff, bars[bars.length - 1].t).toFixed(4),
    notes: out, pedal, bars, sections, phrases, beats, chords: [], seed,
    source: { format: 'midi', smf: midi.format, tracks: midi.tracks.length, division: midi.division, shift: +shift.toFixed(5) },
    report,
  };
}
