// Fingering: second-order Viterbi per hand with held-key state (research/performance.md section 7.2), ported from
// sandbox/performance/scripts/fingering_dp.py (Parncutt et al. 1997 rules 1-12 + polyphony additions), plus:
//  - composer fingers (score note.finger) as a prior: hard when note.preset (or note.finger_fixed) is set, soft otherwise;
//  - early release of a held key when the hand runs out of fingers (only cheap under the sustain pedal).
const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (p) => BLACK.has(((p % 12) + 12) % 12);
const WPOS = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
const wpos = (p) => { const o = Math.floor(p / 12), pc = p - 12 * o; return 7 * o + WPOS[pc]; };
const SPAN = {
  '1,2': [-5, -3, 1, 5, 8, 10], '1,3': [-4, -2, 3, 7, 10, 12], '1,4': [-3, -1, 5, 9, 12, 14], '1,5': [-1, 1, 7, 10, 13, 15],
  '2,3': [1, 1, 1, 2, 3, 5], '2,4': [1, 1, 3, 4, 5, 7], '2,5': [2, 2, 5, 6, 8, 10], '3,4': [1, 1, 1, 2, 2, 4], '3,5': [1, 1, 3, 4, 5, 7], '4,5': [1, 1, 1, 2, 3, 5],
};
export function spanLimits(f1, f2) {
  if (f1 === f2) return [0, 0, 0, 0, 0, 0];
  if (f1 < f2) return SPAN[`${f1},${f2}`];
  const a = SPAN[`${f2},${f1}`]; return [-a[5], -a[4], -a[3], -a[2], -a[1], -a[0]];
}
function rules123(f1, f2, s) {
  const [, mnC, mnR, mxR, mxC] = spanLimits(f1, f2); const k = (f1 === 1 || f2 === 1) ? 1 : 2;
  return 2 * Math.max(0, s - mxC) + 2 * Math.max(0, mnC - s) + k * Math.max(0, mnR - s) + k * Math.max(0, s - mxR);
}
export const W = {
  leap_base: 3.0, leap_per_st: 0.4, leap_in_legato: 12.0, long_finger_cross: 20.0, same_finger_legato: 20.0,
  same_finger_new_key: 3.0, same_finger_fast: 3.0, arm_assist_per_st: 3.0, nnnf: 0.3, thumb_black_base: 2.0,
  repeat_same_finger_fast: 2.0, repeat_change: 0.5, hand_shift_per_st: 0.35, outer_finger_prior: 1.0,
  same_finger_legato_block: 1.0, same_finger_legato_mixed: 8.0, voice_lead: 0.5,
  composer: 2.5,            // soft prior per note that deviates from the composer's finger
  early_release_pedal: 2.0, early_release_dry: 25.0,
  chord_over_span: 30.0,     // per semitone beyond MaxPrac inside one hand's sounding set (unplayable stretch)
  octave_outer_not5: 40.0,   // fix round 2 (was 14): 1-4 octaves are not exempt any more; fix round 1: octave-spanning chord without the 5th on its outer note
  repeat_chord_change: 25.0, // fix round 1: the same chord re-fingered on its immediate repetition
  same_finger_quick: 8.0,    // fix round 3b: the same finger on a different key < 0.3 s after that key's note ended (melody stab)
};
const FAST_IOI = 0.18, LEGATO_EPS = 0.03;

function combos(arr, k) {
  const out = []; const rec = (s, acc) => { if (acc.length === k) { out.push(acc.slice()); return; } for (let i = s; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); } };
  rec(0, []); return out;
}
// order-preserving assignments of new pitches to free fingers. Against HELD keys a thumb may pass under / a finger over
// the thumb by up to 4 semitones (legato thumb-under while a finger holds); such candidates carry c.cross = count.
function candidates(pitches, locked) {
  const free = [1, 2, 3, 4, 5].filter((f) => !locked.has(f)); const out = [];
  for (const c of combos(free, pitches.length)) {
    let ok = true, cross = 0;
    for (let i = 0; i < c.length && ok; i++) for (const [lf, lp] of locked) {
      if (pitches[i] === lp) { ok = false; break; }
      if ((c[i] < lf) !== (pitches[i] < lp)) {
        if ((c[i] === 1 || lf === 1) && Math.abs(pitches[i] - lp) <= 4) cross++; else { ok = false; break; }
      }
    }
    if (ok) { c.cross = cross; out.push(c); }
  }
  return out;
}
function verticalCost(fp) {
  let c = 0;
  for (let i = 0; i + 1 < fp.length; i++) {
    const [f1, p1] = fp[i], [f2, p2] = fp[i + 1]; const s = p2 - p1; c += rules123(f1, f2, s);
    const [mnP, , , , , mxP] = spanLimits(f1, f2); if (s > mxP) c += W.chord_over_span * (s - mxP); if (s < mnP) c += W.chord_over_span * (mnP - s);
  }
  if (fp.length >= 2) { // outer pair stretch beyond practical (whole hand)
    const [fa, pa] = fp[0], [fb, pb] = fp[fp.length - 1]; const [, , , , , mxP] = spanLimits(fa, fb); if (fp.length > 2 && pb - pa > mxP) c += W.chord_over_span * (pb - pa - mxP);
  }
  if (fp.length >= 3 && fp[fp.length - 1][1] - fp[0][1] >= 7) c += W.outer_finger_prior * ((fp[0][0] - 1) + (5 - fp[fp.length - 1][0]));
  // fix round 1: a chord spanning an octave or more takes the 5th finger on its outer note (RH top / LH bottom: the
  // highest mirrored pitch); 1-2-3-4 octaves leave the 5th nowhere to go (it collides with the 4th)
  if (octaveOuterNot5(fp)) c += W.octave_outer_not5;
  return c;
}
/** octave-spanning set whose outer note is not on the 5th. Fix round 2: the bare 1-4 octave on a black outer key is no
 *  longer exempt (this rig's 1-4 reach cannot make 164.5 mm without breaking the wrist, m 118.7), and a set spanning
 *  10+ semitones with the thumb on a black key also takes the 5th outside (ids 320-322, 760-762: 1-2-3 / 1-2-4 left
 *  the thumb short of its key). */
const octaveOuterNot5 = (fp) => {
  if (fp.length < 2) return false; const span = fp[fp.length - 1][1] - fp[0][1]; if (fp[fp.length - 1][0] === 5) return false;
  if (span >= 12) return true;
  return span >= 10 && fp.some(([f, p]) => f === 1 && isBlackMir(p));
};
let isBlackMir = isBlack;   // set per hand (LH pitches are mirrored)
/** fingerings of two onset groups with the same pitches (fp sorted by pitch) differ */
const sameChordDiffFingers = (a, b) => a.length >= 2 && a.length === b.length && a.every(([, p], k) => p === b[k][1]) && a.some(([f], k) => f !== b[k][0]);
const handPos = (fp) => fp.reduce((s, [f, p]) => s + p - 2 * (f - 1), 0) / fp.length;
function localCost(fp, mono) {
  let c = 0;
  if (mono) { const [f, p] = fp[0]; if (f >= 4) c += 1; if (f === 1 && isBlack(p)) c += W.thumb_black_base; }
  else for (const [f, p] of fp) if (f === 1 && isBlack(p)) c += 1;
  return c;
}
function transCost(prev, cur, ioi, legato, prevLeg, prevHeld) {
  const mono = prev.length === 1 && cur.length === 1; let c = 0;
  if (mono) {
    const [f1, p1] = prev[0], [f2, p2] = cur[0]; const s = p2 - p1;
    if (p1 === p2) { if (f1 === f2) c += ioi < FAST_IOI ? W.repeat_same_finger_fast : 0; else c += W.repeat_change + (Math.abs(f1 - f2) === 1 ? 0 : 0.5); return c; }
    if (f1 === f2) {
      if (legato) return c + W.same_finger_legato + 0.1 * Math.abs(s);
      return c + W.same_finger_new_key + (ioi < 0.25 ? W.same_finger_fast : 0) + 0.1 * Math.abs(s);
    }
    const [mnP, , , , , mxP] = spanLimits(f1, f2); const thumb = f1 === 1 || f2 === 1; const natural = (f2 - f1) * s > 0;
    if (mnP <= s && s <= mxP) { c += (legato ? 1 : 0.5) * rules123(f1, f2, s); if (natural) c += W.nnnf * Math.abs(Math.abs(wpos(p2) - wpos(p1)) - Math.abs(f2 - f1)); }
    else if (thumb && ((mnP - 3 <= s && s < mnP) || (mxP < s && s <= mxP + 3))) { const exc = s < mnP ? mnP - s : s - mxP; c += rules123(f1, f2, s) + W.arm_assist_per_st * exc; }
    else if (!thumb && !natural && Math.abs(s) <= 12) c += W.long_finger_cross;
    else { const shift = Math.abs((p2 - 2 * (f2 - 1)) - (p1 - 2 * (f1 - 1))); c += W.leap_base + W.leap_per_st * shift; if (legato && Math.abs(s) <= 12 && ioi < 0.4) c += W.leap_in_legato; }
    if (f1 === 3 && f2 === 4) c += 1;
    if ((f1 === 3 && f2 === 4) || (f1 === 4 && f2 === 3)) { const p3 = f1 === 3 ? p1 : p2, p4 = f1 === 4 ? p1 : p2; if (!isBlack(p3) && isBlack(p4)) c += 1; }
    if (f2 === 1 && isBlack(p2) && !isBlack(p1)) c += 2;
    if (f1 === 1 && isBlack(p1) && !isBlack(p2)) c += 2;
    if (f2 === 5 && isBlack(p2) && !isBlack(p1)) c += 2;
    if (f1 === 5 && isBlack(p1) && !isBlack(p2)) c += 2;
    const passing = (f1 === 1 && f2 > 1 && s < 0) || (f1 > 1 && f2 === 1 && s > 0);
    if (passing) {
      if (isBlack(p1) === isBlack(p2)) c += 1;
      else { const lo = p1 < p2 ? [f1, p1] : [f2, p2], hi = p1 < p2 ? [f2, p2] : [f1, p1]; if (!isBlack(lo[1]) && lo[0] !== 1 && isBlack(hi[1]) && hi[0] === 1) c += 3; }
    }
    return c;
  }
  c += W.hand_shift_per_st * Math.abs(handPos(cur) - handPos(prev));
  if (sameChordDiffFingers(prev, cur)) c += W.repeat_chord_change;   // a repeated chord keeps its fingering
  const pm = new Map(prev.map(([f, p]) => [f, p])); const block = Math.max(prev.length, cur.length) >= 3;
  for (const [f, p] of cur) if (pm.has(f) && pm.get(f) !== p && (!prevLeg || prevLeg.has(f))) c += block ? W.same_finger_legato_block : W.same_finger_legato_mixed;
  const released = prev.filter(([f]) => !prevHeld.has(f));
  for (const [fb, pb] of cur) {
    if (!released.length) break;
    let best = released[0]; for (const r of released) if (Math.abs(r[1] - pb) < Math.abs(best[1] - pb)) best = r;
    const [fa, pa] = best;
    if (pa !== pb && fa !== fb) { const [mnP, , , , , mxP] = spanLimits(fa, fb); if (mnP <= pb - pa && pb - pa <= mxP) c += W.voice_lead * rules123(fa, fb, pb - pa); }
  }
  return c;
}
function tripleCost(a, b, c_) {
  const [f1, p1] = a, [f2, p2] = b, [f3, p3] = c_; let cost = 0; const s13 = p3 - p1;
  const [mnP, mnC, , , mxC, mxP] = spanLimits(f1, f3);
  if (s13 > mxC || s13 < mnC) {
    const full = f2 === 1 && Math.min(p1, p3) < p2 && p2 < Math.max(p1, p3) && (s13 > mxP || s13 < mnP);
    cost += full ? 2 : 1; cost += s13 < mnC ? mnC - s13 : s13 - mxC;
  }
  const st = new Set([f1, f2, f3]); if (st.size === 3 && st.has(3) && st.has(4) && st.has(5)) cost += 1;
  return cost;
}

/**
 * Physical feasibility of a fingering (one hand): keys down at the same time must use different fingers, in pitch order
 * (no crossing inside a held set, except a thumb under/over a neighbour), within the practical span.
 * fingerOf(note) -> 1..5. Returns [{ids:[a,b], kind, t}].
 */
export function validateFingering(notes, hand, fingerOf, { overlapEps = 0.02 } = {}) {
  const mir = hand === 'R' ? (p) => p : (p) => 124 - p;
  const ns = notes.slice().sort((a, b) => a.t_on - b.t_on);
  const issues = [];
  for (let i = 0; i < ns.length; i++) {
    const a = ns[i];
    for (let j = i + 1; j < ns.length && ns[j].t_on < a.t_off - overlapEps; j++) {
      const b = ns[j]; const fa = fingerOf(a), fb = fingerOf(b);
      if (!(fa >= 1 && fa <= 5 && fb >= 1 && fb <= 5)) continue;
      if (a.pitch === b.pitch) continue;
      if (fa === fb) { issues.push({ ids: [a.id, b.id], kind: 'same-finger-held', t: b.t_on }); continue; }
      const pa = mir(a.pitch), pb = mir(b.pitch); const s = pb - pa;
      const crossed = (fb - fa) * s < 0;
      if (crossed && fa !== 1 && fb !== 1) issues.push({ ids: [a.id, b.id], kind: 'order', t: b.t_on });
      const [mnP, , , , , mxP] = spanLimits(fa, fb);
      if (s > mxP + 1 || s < mnP - 1) issues.push({ ids: [a.id, b.id], kind: 'span', t: b.t_on, s, fa, fb });
    }
  }
  return issues;
}

/**
 * notes: [{id, pitch, t_on, t_off, finger?, preset?}] of ONE hand. pedalDown(t) -> bool.
 * Returns { finger: Map(id -> f), earlyRelease: Map(id -> t), cost, agreement: {same, total} }.
 */
export function solveFingering(notes, hand, { pedalDown = () => false, composerWeight = W.composer, hardComposer = false, freed = null } = {}) {
  const mir = hand === 'R' ? (p) => p : (p) => 124 - p;
  const ns = notes.slice().sort((a, b) => a.t_on - b.t_on || a.pitch - b.pitch);
  const events = [];
  for (const n of ns) { const g = events[events.length - 1]; if (g && n.t_on - g.t <= 0.03) g.notes.push(n); else events.push({ t: n.t_on, notes: [n] }); }
  for (const e of events) e.notes.sort((a, b) => mir(a.pitch) - mir(b.pitch));
  const fpOf = (ev, asg) => asg.map((f, i) => [f, mir(ev.notes[i].pitch)]).sort((a, b) => a[1] - b[1]);
  const relaxed = new Set();
  const prior = (ev, asg) => {
    let c = 0;
    for (let i = 0; i < asg.length; i++) {
      const n = ev.notes[i]; const cf = n.finger;
      if (cf >= 1 && cf <= 5 && cf !== asg[i]) {
        if ((freed && freed.has(n.id)) || relaxed.has(n.id)) { c += composerWeight; continue; }
        if (n.preset || hardComposer) return Infinity; c += composerWeight;
      }
    }
    return c;
  };
  // state key: prevAsg|curAsg|sounding
  const keyOf = (pa, ca, snd) => `${pa ? pa.join('') : '-'}|${ca.join('')}|${snd.map((s) => `${s.f}:${s.p}:${s.id}`).join(',')}`;
  let layer = new Map();
  const back = [];
  const ev0 = events[0];
  for (const a of candidates(ev0.notes.map((n) => mir(n.pitch)), new Map())) {
    const fp = fpOf(ev0, a); const c = verticalCost(fp) + localCost(fp, fp.length === 1) + prior(ev0, a);
    if (!isFinite(c)) continue;
    const snd = a.map((f, i) => ({ f, p: mir(ev0.notes[i].pitch), off: ev0.notes[i].t_off, id: ev0.notes[i].id })).sort((x, y) => x.f - y.f);
    layer.set(keyOf(null, a, snd), { cost: c, pa: null, ca: a, snd, bp: null, rel: null });
  }
  back.push(layer);
  for (let i = 1; i < events.length; i++) {
    const ev = events[i], pev = events[i - 1]; const ioi = ev.t - pev.t;
    const legato = pev.notes.some((n) => n.t_off >= ev.t - LEGATO_EPS);
    const pc = ev.notes.map((n) => mir(n.pitch));
    let nl = expand(ev, pev, i, ioi, legato, pc);
    if (!nl.size) { for (const n of ev.notes) relaxed.add(n.id); nl = expand(ev, pev, i, ioi, legato, pc); }
    if (!nl.size) throw new Error(`fingering: no state at event ${i} t=${ev.t} hand ${hand}`);
    // beam prune (keeps it fast on dense chord passages)
    if (nl.size > 4000) { const arr = [...nl].sort((a, b) => a[1].cost - b[1].cost).slice(0, 4000); layer = new Map(arr); } else layer = nl;
    back.push(layer);
  }
  function expand(ev, pev, i, ioi, legato, pc) {
    const nl = new Map();
    for (const [sk, st] of layer) {
      const carriedAll = st.snd.filter((x) => x.off > ev.t + LEGATO_EPS);
      // options: keep all carried; if that leaves no candidates, release the earliest-ending carried keys
      const opts = [{ carried: carriedAll, rel: [] }];
      let cands = candidates(pc, new Map(carriedAll.map((x) => [x.f, x.p])));
      const tryList = [];
      if (!cands.length && carriedAll.length) {
        const byEnd = carriedAll.slice().sort((a, b) => a.off - b.off);
        for (let k = 1; k <= byEnd.length; k++) tryList.push(byEnd.slice(0, k));
        // also any single held key (a released inner voice may matter more than the earliest)
        for (const x of carriedAll) tryList.push([x]);
      }
      const optList = cands.length ? [{ carried: carriedAll, rel: [], cands }] : [];
      for (const relSet of tryList) {
        const keep = carriedAll.filter((x) => !relSet.includes(x));
        const cc = candidates(pc, new Map(keep.map((x) => [x.f, x.p])));
        if (cc.length) optList.push({ carried: keep, rel: relSet, cands: cc });
        if (optList.length >= 3) break;
      }
      for (const opt of optList) {
        const locked = new Map(opt.carried.map((x) => [x.f, x.p]));
        let relCost = 0; for (const r of opt.rel) relCost += pedalDown(ev.t) ? W.early_release_pedal : W.early_release_dry;
        const fpPrev = fpOf(pev, st.ca);
        const prevLeg = new Set(st.ca.filter((f, j) => pev.notes[j].t_off >= ev.t - LEGATO_EPS));
        for (const b of opt.cands) {
          const pr = prior(ev, b); if (!isFinite(pr)) continue;
          const fpCur = fpOf(ev, b);
          const full = fpCur.concat([...locked].map(([f, p]) => [f, p])).sort((x, y) => x[1] - y[1]);
          let c = st.cost + verticalCost(full) + localCost(fpCur, fpCur.length === 1) + pr + relCost + 2.5 * (b.cross || 0);
          c += transCost(fpPrev, fpCur, ioi, legato, prevLeg, new Set(locked.keys()));
          // fix round 3b (critic f2c bar 22: G5 taken by 5 under the 10-semitone rule, then the melody F5 again with 5, a 105 ms
          // break): the same finger on a different key within 0.3 s of the end of the previous note it played
          for (let j = 0; j < b.length; j++) { const pj = st.ca.indexOf(b[j]); if (pj < 0) continue; const pn = pev.notes[pj]; if (mir(pn.pitch) !== pc[j] && ev.t - pn.t_off < 0.3) c += W.same_finger_quick; }
          if (st.pa && fpPrev.length === 1 && fpCur.length === 1) { const fpPP = fpOf(events[i - 2], st.pa); if (fpPP.length === 1) c += tripleCost(fpPP[0], fpPrev[0], fpCur[0]); }
          const snd = opt.carried.concat(b.map((f, j) => ({ f, p: pc[j], off: ev.notes[j].t_off, id: ev.notes[j].id }))).sort((x, y) => x.f - y.f);
          const k = keyOf(st.ca, b, snd);
          const ex = nl.get(k);
          if (!ex || c < ex.cost) nl.set(k, { cost: c, pa: st.ca, ca: b, snd, bp: sk, rel: opt.rel.length ? opt.rel.map((r) => ({ id: r.id, t: ev.t })) : null });
        }
      }
    }
    return nl;
  }
  let bestK = null, best = Infinity; for (const [k, st] of layer) if (st.cost < best) { best = st.cost; bestK = k; }
  const finger = new Map(); const earlyRelease = new Map();
  for (let i = events.length - 1; i >= 0; i--) {
    const st = back[i].get(bestK);
    st.ca.forEach((f, j) => finger.set(events[i].notes[j].id, f));
    if (st.rel) for (const r of st.rel) earlyRelease.set(r.id, r.t);
    bestK = st.bp;
  }
  let same = 0, total = 0; for (const n of ns) if (n.finger >= 1 && n.finger <= 5) { total++; if (finger.get(n.id) === n.finger) same++; }
  return { finger, earlyRelease, cost: best, agreement: { same, total }, events: events.length, relaxed };
}

/**
 * Fingering policy used by the solver: composer fingers are hard constraints unless physically infeasible
 * (validateFingering) or contradicted by a held-key state, where the note is re-solved with the composer finger as a
 * soft prior. Notes without a composer finger (0) are solved freely. mode 'solver' = composer fingers only a soft prior.
 */
export function fingerHand(notes, hand, { pedalDown, mode = 'composer' } = {}) {
  const issues0 = validateFingering(notes, hand, (n) => n.finger);
  const freed = new Set(); for (const is of issues0) for (const id of is.ids) freed.add(id);
  // fix round 1: composer fingers are soft priors where they break a naturalness rule (critic): an octave-spanning
  // chord without the 5th on its outer note (1-2-3-4 octaves), and an identical chord re-fingered on its immediate
  // repetition (LH Ab3-C4-Eb4 4-2-1 / 5-3-2 / 4-3-2 within a second). Those groups are re-solved; the audio is unaffected.
  const mir = hand === 'R' ? (p) => p : (p) => 124 - p;
  isBlackMir = (mp) => isBlack(hand === 'R' ? mp : 124 - mp);
  const groups = []; for (const n of notes.slice().sort((a, b) => a.t_on - b.t_on)) { const g = groups[groups.length - 1]; if (g && n.t_on - g.t <= 0.03) g.notes.push(n); else groups.push({ t: n.t_on, notes: [n] }); }
  const fpOfG = (g) => g.notes.map((n) => [n.finger, mir(n.pitch)]).sort((a, b) => a[1] - b[1]);
  const natural = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]; if (g.notes.some((n) => !(n.finger >= 1 && n.finger <= 5))) continue;
    const fp = fpOfG(g);
    if (octaveOuterNot5(fp)) { natural.push({ t: g.t, kind: 'octave-outer-not-5', fingers: fp.map((x) => x[0]).join('') }); for (const n of g.notes) freed.add(n.id);
      // fix round 3b: the melody note right after such a chord is re-solved too (5 on the chord top, then 4: 5-4 legato)
      const ng = groups[gi + 1]; if (ng && ng.t - g.t < 0.6 && ng.notes.length === 1) freed.add(ng.notes[0].id); }
    const pg = groups[gi - 1];
    if (pg && g.t - pg.t < 1.2 && !pg.notes.some((n) => !(n.finger >= 1 && n.finger <= 5)) && sameChordDiffFingers(fpOfG(pg), fp)) { natural.push({ t: g.t, kind: 'repeated-chord-refingered', fingers: fpOfG(pg).map((x) => x[0]).join('') + '->' + fp.map((x) => x[0]).join('') }); for (const n of [...pg.notes, ...g.notes]) freed.add(n.id); }
  }
  // critic round 2 (S16b walk-down, LH m 125.66-126.28 Ab3 2, G3 1, F3 2, Eb3 1: thumb under the index, then the
  // index over the thumb, every 0.2 s): two thumb crossings in a row on a single-note line (each step < 0.3 s) are not
  // played by pianists; such runs are re-solved (composer finger as a soft prior)
  {
    const sg = groups.map((g) => (g.notes.length === 1 && g.notes[0].finger >= 1 && g.notes[0].finger <= 5 ? g.notes[0] : null));
    const crossAt = (i) => { const a = sg[i - 1], b = sg[i]; if (!a || !b || b.t_on - a.t_on >= 0.3 || a.pitch === b.pitch) return false; const s = mir(b.pitch) - mir(a.pitch); return (b.finger - a.finger) * s < 0 && (a.finger === 1 || b.finger === 1); };
    // (2-1 is the thumb passing under, 1-2 the hand following over it: two thumb crossings within two steps and 0.5 s)
    for (let i = 2; i < sg.length; i++) if (crossAt(i)) for (const j of [i - 1, i - 2]) if (j >= 1 && crossAt(j) && sg[i].t_on - sg[j].t_on < 0.5) {
      natural.push({ t: sg[i].t_on, kind: 'alternating-thumb-crossings', fingers: sg.slice(j - 1, i + 1).map((n) => n.finger).join('') });
      for (let k = j - 1; k <= Math.min(sg.length - 1, i + 1); k++) if (sg[k]) freed.add(sg[k].id);
      break;
    }
  }
  // free the whole onset group of a freed note (chords are re-voiced together)
  const byT = notes.slice().sort((a, b) => a.t_on - b.t_on);
  for (const n of byT) if (freed.has(n.id)) for (const m of byT) if (Math.abs(m.t_on - n.t_on) <= 0.03) freed.add(m.id);
  const r = solveFingering(notes, hand, { pedalDown, hardComposer: mode === 'composer', composerWeight: mode === 'composer' ? 6 : W.composer, freed });
  const issues1 = validateFingering(notes, hand, (n) => r.finger.get(n.id));
  const changed = notes.filter((n) => n.finger >= 1 && n.finger <= 5 && r.finger.get(n.id) !== n.finger).map((n) => ({ id: n.id, t: n.t_on, name: n.name, from: n.finger, to: r.finger.get(n.id) }));
  return { ...r, composerIssues: issues0, naturalnessOverrides: natural, finalIssues: issues1, changed, freedCount: freed.size };
}
