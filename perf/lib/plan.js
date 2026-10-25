// Hand planning per hand: onset events -> contact sets -> palm keyframes (two optimisation passes with continuity and
// anticipation) -> continuous palm trajectory with holds, min-jerk transfers, leap arcs, chord drops and phrase lifts.
import { qMul, qRot, qSlerp, qConj, qLog, qAxisAngle, qAngle, add, sub, scale, dot, norm, len, DEG, clamp, minjerk, lerp3, smoothstep } from './math.js';
import { dipRatioFor } from './fingers.js';
import { solvePalm, handFeatures, padTargetForKey, surfaceUnder, PREF } from './palm.js';
import { KEYS, contactBox, clampContact } from './pianoGeo.js';

export const T_UP_AFTER_REL0 = 0.06;     // finger leaves the key 60 ms after the key starts rising (key ~9 % down)

/**
 * A key still held when the same hand must reach notes that one hand position cannot span (a bass held while the
 * hand leaps up, a melody note held across a shift) is released early enough for the hand to travel. Under the sustain
 * pedal this is inaudible (the dampers stay up); without pedal it is counted as an audio/visual mismatch.
 */
export function releaseForReach(notes, hand, pedalDown, spanLimits, pedalCovers = null) {
  const mir = hand === 'R' ? (p) => p : (p) => 124 - p;
  const ns = notes.slice().sort((a, b) => a.t_on - b.t_on);
  const groups = []; for (const n of ns) { const g = groups[groups.length - 1]; if (g && n.t_on - g.t_on <= 0.03) g.notes.push(n); else groups.push({ t_on: n.t_on, notes: [n] }); }
  const out = [];
  for (const g of groups) {
    const T = Math.min(...g.notes.map((n) => n.tm.tFk)); const Tb = Math.min(...g.notes.map((n) => n.tm.tKb));
    // keys whose finger is still on them when the new keys start moving (same criterion as HandPlanner.heldAt)
    const held = ns.filter((n) => !g.notes.includes(n) && n.t_on < g.t_on - 0.03 && n.tm.tRel0 + (n.quickLift ? 0.02 : T_UP_AFTER_REL0) > T + 0.015);
    for (const h of held) {
      let bad = false, uncomfortable = false; let maxDist = 0;
      for (const n of g.notes) {
        if (n.f === h.f) continue;                    // same finger: resolveFingerTiming handles the hand-over
        const [fa, pa] = n.f < h.f ? [n.f, mir(n.pitch)] : [h.f, mir(h.pitch)]; const [fb, pb] = n.f < h.f ? [h.f, mir(h.pitch)] : [n.f, mir(n.pitch)];
        const [mnP, mnC, , , mxC, mxP] = spanLimits(fa, fb); const s = pb - pa;
        if (s > mxP + 1 || s < mnP - 1) bad = true;
        if (s > mxC || s < mnC) uncomfortable = true;
        maxDist = Math.max(maxDist, Math.abs(n.pitch - h.pitch));
      }
      // beyond the comfortable span a pianist lets an inner/held key go under the pedal (inaudible: the dampers stay
      // up) rather than wrench the wrist; without pedal only an impossible stretch releases early
      if (!bad && uncomfortable && (pedalCovers ? pedalCovers(T - 0.12, h.t_off) : pedalDown(T - 0.02))) bad = true;
      if (!bad) continue;
      const lead = Math.min(0.30, 0.08 + 0.5 * maxDist * 0.0137);   // ~1.37 cm per semitone
      const want = T - lead - 0.06;
      let newRel = Math.max(h.tm.tKb + 0.03, Math.min(h.tm.tRel0, want));
      // fix round 1: without full damper lift over the rest of the note (sampler model) the key may not come up long
      // before the sound stops: release as late as the shift allows (50 ms before the new keys move), or from the
      // moment the pedal does cover the rest of the note
      if (pedalCovers && !pedalCovers(newRel, h.t_off)) { const c = coveredFrom(pedalCovers, newRel, h.tm.tRel0, h.t_off); newRel = c ?? Math.max(newRel, Math.min(h.tm.tRel0, T - 0.05)); }
      h.quickLift = true;   // the finger lifts off at once (20 ms after the key starts rising) instead of riding it 60 ms
      if (newRel < h.tm.tRel0 - 1e-4) { out.push({ id: h.id, t: h.t_on, early: h.tm.tRel0 - newRel, pedal: pedalDown(newRel) }); h.tm.tRel0 = newRel; h.earlyRelease = true; h.relWhy = 'reach'; }
    }
    void Tb;
  }
  return out;
}

/**
 * Leaps need travel time. A key whose finger leaves it too late for the hand to reach the next onset group (a stride
 * bass held to its notated end, then the chord an octave and a half up 100 ms later) is let go earlier, as a pianist
 * does: minimum leap time 0.06 s + 0.45 s/m of lateral travel (stride leaps of 0.25 m in ~0.17 s), the finger lifting
 * at once. The early release is bounded by the damper state: up to 250 ms under the pedal (inaudible), 120 ms in the
 * sampler's half-pedal zone (CC 32-63), 50 ms without pedal; and the key is held at least 12 ms past key bottom.
 * ccAt(t) -> pedal CC 0..127. Returns the releases (QC lists those the pedal does not cover).
 */
export function releaseForTravel(notes, hand, covers) {
  const ns = notes.slice().sort((a, b) => a.t_on - b.t_on);
  const groups = []; for (const n of ns) { const g = groups[groups.length - 1]; if (g && n.t_on - g.t_on <= 0.03) g.notes.push(n); else groups.push({ t_on: n.t_on, notes: [n] }); }
  const xOf = (n) => KEYS[clamp(n.pitch - 21, 0, 87)].xCenter;
  const out = [];
  for (const g of groups) {
    const T = Math.min(...g.notes.map((n) => n.tm.tFk));
    const xs = g.notes.map(xOf); const xLo = Math.min(...xs), xHi = Math.max(...xs);
    for (const h of ns) {
      if (h.t_on >= g.t_on - 0.03) break;
      if (h.t_on < g.t_on - 3 || g.notes.includes(h)) continue;
      const leave = h.tm.tRel0 + (h.quickLift ? 0.02 : T_UP_AFTER_REL0);
      if (leave < T - 0.5) continue;
      // lateral travel the hand needs so that h's finger region reaches the new group: beyond a hand width (~9 cm
      // from the group's nearest edge) the palm has to move by the excess
      const x = xOf(h); const dEdge = x < xLo ? xLo - x : x > xHi ? x - xHi : 0; const d = dEdge - 0.09;
      if (d <= 0.02) continue;
      // cycle 2 fix 5 (critic: S02 LH leap m 6.82 still 4 m/s, a multi-exposure smear; wants >= 250 ms of flight, peak < 2
      // m/s, release after the pedal has caught): a real leap (d > 8 cm beyond the hand width) asks for the min-jerk time of
      // a 2 m/s peak over the palm's path (~d + 9 cm), <= 0.32 s, WHERE THE PEDAL COVERS the early release; otherwise the
      // round-1 budget (0.06 + 0.45 d) and its caps apply
      const tFast = 0.06 + 0.45 * d; const tSlow = d > 0.08 ? Math.min(0.32, 1.875 * (d + 0.09) / 2.0) : tFast;
      let tNeed = tFast;
      if (tSlow > tFast + 0.01) { const wS = T - tSlow - 0.02, oS = rel0Of(h); const nrS = Math.max(h.tm.tKb + 0.012, wS, oS - 0.32); if (oS - 0.25 <= T && covers(nrS, h.t_off)) tNeed = Math.min(tSlow, T - 0.02 - nrS); }
      if (leave <= T - tNeed) continue;
      // fix round 1: the early release is bounded by the sampler's damper lift over the WHOLE released interval
      // [newRel, t_off] (the old check read CC64 at the original release instant only, so a release could fall into a
      // pedal change): up to 250 ms where the dampers stay fully lifted, otherwise at most 30 ms (key half up <= 30 ms
      // before the sound stops); a leap that then lacks time lands struck (solver) or a little late
      const want = T - tNeed - 0.02;                     // with quickLift the finger leaves 20 ms after tRel0
      // fix round 3 (critic f2c: the caps were applied against the CURRENT tRel0, which this loop overwrites for every
      // later onset group, so 30 ms steps stacked to 114 ms without pedal and 250 ms caps to 1.7 s under it): every bound
      // is taken from the note's ORIGINAL release (rel0Of), never from an already moved one
      const o = rel0Of(h);
      // critic round 2 (f3c: the final chord's C3 was let go 275 ms early, 'travel', with no note after it): a note held
      // across the group (its designed release more than 250 ms after the group's first key motion) cannot make room for
      // the travel to that group by releasing early; it is a reach constraint of the group, not a travel release
      if (o - 0.25 > T) continue;
      let newRel = Math.max(h.tm.tKb + 0.012, want, o - (tNeed > tFast + 1e-4 ? 0.32 : 0.25));
      let cov = true;
      if (newRel < o - UNCOVERED_EARLY && !covers(newRel, h.t_off)) { cov = false; const c = coveredFrom(covers, newRel, o - UNCOVERED_EARLY, h.t_off); newRel = c ?? Math.max(newRel, o - UNCOVERED_EARLY); }
      h.quickLift = true;
      if (newRel < h.tm.tRel0 - 1e-4) { out.push({ id: h.id, t: h.t_on, early: h.tm.tRel0 - newRel, covered: cov, d }); h.tm.tRel0 = newRel; h.earlyRelease = true; h.relWhy = 'travel'; }
    }
  }
  return out;
}

/** fix round 3: the release before any release pass (the solver stores n.tRel0Orig right after the touch timing) */
export const rel0Of = (n) => (n.tRel0Orig !== undefined ? n.tRel0Orig : n.tm.tRel0);
/** fix round 3: a key not covered by full damper lift may start rising at most this much before its designed release
 * (t_off - 25 ms), so the damper is back on the string at most one 60 fps film frame before the sound stops */
export const UNCOVERED_EARLY = 0.015;

/** earliest a in [lo, hi] from which covers(a, end) holds (covers is monotone in a), or null */
export function coveredFrom(covers, lo, hi, end) {
  if (hi < lo || !covers(hi, end)) return null;
  if (covers(lo, end)) return lo;
  let a = lo, b = hi; for (let it = 0; it < 14; it++) { const m = 0.5 * (a + b); if (covers(m, end)) b = m; else a = m; }
  return b;
}

/**
 * Repeated notes (fix round 1): a re-strike of the same key used to start 12 ms after the previous release began, so
 * the key rose only ~18 % between two audible attacks (a 2 mm twitch). Where the sampler's dampers stay lifted over the
 * moved part of the note, the previous key is let go earlier (up to 80 ms) so it is >= 50 % up when the next stroke
 * starts; otherwise it may come up at most 30 ms early and rises as far as that allows. Returns the changed notes.
 */
export function planRestrikes(notes, covers) {
  const byKey = new Map(); for (const n of notes) { if (!byKey.has(n.pitch)) byKey.set(n.pitch, []); byKey.get(n.pitch).push(n); }
  const out = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.tm.tFk - b.tm.tFk);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      if (b.tm.tFk - a.tm.tRel0 > 0.030) continue;            // already ~60 % up when the next stroke starts
      const o = rel0Of(a);   // fix round 3: bounds from the original release (no stacking with the travel/reach passes)
      let newRel = Math.max(a.tm.tKb + 0.02, o - 0.08, Math.min(a.tm.tRel0, b.tm.tFk - 0.030));
      let cov = true;
      if (newRel < o - UNCOVERED_EARLY && !covers(newRel, a.t_off)) { cov = false; const c = coveredFrom(covers, newRel, o - UNCOVERED_EARLY, a.t_off); newRel = c ?? Math.max(newRel, Math.min(a.tm.tRel0, o - UNCOVERED_EARLY)); }
      if (newRel < a.tm.tRel0 - 1e-4) { out.push({ id: a.id, early: a.tm.tRel0 - newRel, covered: cov }); a.tm.tRel0 = newRel; a.restrikeRel = true; a.relWhy = 'restrike'; }
    }
  }
  return out;
}

/**
 * Per finger: when does the finger leave each key (tLeave), and must the key be released early because the same
 * finger is needed elsewhere? The key return itself is passive, so the finger may leave as soon as the key starts
 * rising (tRel0); only if the next stroke of the same finger starts within 30 ms of that is the key released early
 * (counted as a timing conflict for QC). Repeated strokes of one key by one finger keep the finger on the key.
 */
export function resolveFingerTiming(notes) {
  const byF = new Map(); let conflicts = [];
  for (const n of notes) { const k = `${n.hand}${n.f}`; if (!byF.has(k)) byF.set(k, []); byF.get(k).push(n); }
  for (const list of byF.values()) {
    list.sort((a, b) => a.tm.tFk - b.tm.tFk);
    for (let i = 0; i < list.length; i++) {
      const n = list[i], nx = list[i + 1];
      n.tLeave = n.tm.tRel0 + (n.quickLift ? 0.02 : T_UP_AFTER_REL0); n.sameKeyNext = false;
      if (!nx) continue;
      if (nx.pitch === n.pitch) { n.sameKeyNext = nx.tm.tFk - n.tm.tRel0 < 0.25; if (n.tLeave > nx.tm.tFk) n.tLeave = nx.tm.tFk; continue; }
      const latest = nx.tm.tFk - 0.035;                 // travel + approach needs >= 35 ms off the key
      if (n.tLeave > latest) n.tLeave = Math.max(n.tm.tFk + 0.02, Math.max(latest, n.tm.tRel0));
      if (n.tm.tRel0 > latest) {
        const newRel = Math.max(n.tm.tKb + 0.01, latest);
        conflicts.push({ id: n.id, hand: n.hand, f: n.f, t: n.t_on, early: n.tm.tRel0 - newRel });
        n.tm.tRel0 = newRel; n.tLeave = newRel + 0.005; n.relWhy = 'sameFinger';
      }
    }
  }
  // critic round 2 (S11 m 100.03, Bb2 L3 -> L1: the thumb pushed into the middle fingertip, an 'OK-sign' pinch): a
  // substitution on one key (same key, another finger) - the outgoing finger leaves as the key starts rising, >= 35 ms
  // before the incoming one touches (the key's re-strike starts >= 12 ms after the release), instead of riding the key up
  const byKey = new Map(); for (const n of notes) { const k = `${n.hand}${n.pitch}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(n); }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.tm.tFk - b.tm.tFk);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1]; if (a.f === b.f) continue;
      const bTouch = Math.max(b.tm.tFk, a.tm.tRel0 + 0.012);
      if (a.tLeave > bTouch - 0.035) { a.tLeave = Math.max(a.tm.tRel0 + 0.004, Math.min(a.tLeave, bTouch - 0.035)); a.quickLift = true; a.substOut = true; }
    }
  }
  return conflicts;
}

/** natural playing shape of a finger (the thumb from sandbox/perf/probe_thumb2.mjs: pitched ~20 deg, rolled ~60 deg,
 * pointing along the keys) */
export function naturalAngles(H, f) {
  // fix round 1: the thumb's MCP is flexed (never hyperextended) and the IP bent ~25 deg: a rounded thumb-index arch
  if (f === 1) return { cmc: 8 * DEG, cmcAbd: 10 * DEG, mcp: 15 * DEG, ip: 26 * DEG };
  return { mcp: 25 * DEG, abd: 0, pip: 45 * DEG, dip: 30 * DEG };
}
/** natural landing point (rest-pose P frame) of finger f for the given palm, clamped into the key's contact box */
export function naturalContact(H, palm, f, keyIndex) {
  const k = KEYS[keyIndex]; const box = contactBox(keyIndex, f === 1, H.lat);
  const a = naturalAngles(H, f);
  const c = H.padCenter(f, H.fingerFK(f, palm, a));
  const [x, z] = clampContact(keyIndex, f === 1, c[0], c[2], H.lat);
  void box;
  return [x, k.topY, z];
}

export class HandPlanner {
  constructor(H, side, notes, ctx) {
    this.H = H; this.side = side; this.ctx = ctx;   // ctx: {bind features, shoulder(t) fn, swivel fn, log}
    this.notes = notes.slice().sort((a, b) => a.t_on - b.t_on || a.pitch - b.pitch);
    for (const n of this.notes) { n.key = n.pitch - 21; n.black = KEYS[n.key].black; n.tUp = n.tLeave ?? n.tm.tRel0 + T_UP_AFTER_REL0; }
    // events (onset groups within 30 ms)
    const ev = [];
    // fix round 1: a ROLLED chord (notes within 0.12 s, every earlier note still held when the next one lands, one hand
    // position: span <= 12 semitones, no finger twice) is one hand position, so it gets one keyframe and every note's
    // contact point is chosen for the whole chord (the final LH chord C3-G3-Bb3 used to fix C3 and G3 at the front of
    // their keys before the thumb had to reach the black Bb3: all three missed by 2-6 mm and the index hooked)
    const rolled = (e, n) => n.t_on - e.t_on <= 0.12 && e.notes.every((m) => (m.tUp ?? m.tm.tRel0) > n.tm.tFk + 0.02 && m.f !== n.f) && Math.max(n.pitch, ...e.notes.map((m) => m.pitch)) - Math.min(n.pitch, ...e.notes.map((m) => m.pitch)) <= 12;
    for (const n of this.notes) { const e = ev[ev.length - 1]; if (e && (n.t_on - e.t_on <= 0.03 || rolled(e, n))) e.notes.push(n); else ev.push({ t_on: n.t_on, notes: [n] }); }
    for (const e of ev) { e.T = Math.min(...e.notes.map((n) => n.tm.tFk)); e.vel = Math.max(...e.notes.map((n) => n.vel)); }
    this.events = ev;
  }

  /** contacts held at time T (finger still on its key), excluding `except` notes */
  heldAt(T, except) {
    // a key is a constraint of the new hand position if its finger is still on it when the new keys start moving
    // (legato overlap: the old finger stays down while the new one strikes)
    const fs = new Set(except.map((n) => n.f));
    return this.notes.filter((n) => !except.includes(n) && !fs.has(n.f) && n.tm.tFk < T - 1e-4 && (n.tUp ?? n.tm.tRel0) > T + 0.015);
  }

  solveKeyframes() {
    const H = this.H, B = this.ctx.bind; const ev = this.events;
    const bindPalm = { q: H.rig.bindWQ[H.iWrist], p: H.rig.bindWP[H.iWrist] };
    const results = []; this.adaptive = [];
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < ev.length; k++) {
        const e = ev[k];
        const held = this.heldAt(e.T, e.notes);
        const contacts = [];
        const prevR = pass === 0 ? results[k - 1] : this.kf[k - 1];
        const nextR = pass === 1 ? (this.kf1[k + 1] || null) : null;
        // initial pose: previous keyframe moved by the change of the contact centroid
        let init = prevR ? prevR.pose : bindPalm;
        const fingersUsed = new Set();
        for (const n of held) { if (fingersUsed.has(n.f)) continue; fingersUsed.add(n.f); contacts.push({ f: n.f, note: n, fixed: true, black: n.black, key: n.key }); }
        for (const n of e.notes) { if (fingersUsed.has(n.f)) continue; fingersUsed.add(n.f); contacts.push({ f: n.f, note: n, fixed: false, black: n.black, key: n.key }); }
        // centroid shift init
        if (k === 0 || !prevR) {
          let ds = [0, 0, 0]; for (const c of contacts) { const kp = KEYS[c.key]; const bpc = H.padCenter(c.f, H.fingerFK(c.f, bindPalm, c.f === 1 ? H.bindAngles[1] : H.bindAngles[c.f])); ds = add(ds, sub([kp.xCenter, kp.topY + 0.008, c.black ? 0.07 : 0.03], bpc)); }
          ds = scale(ds, 1 / contacts.length); init = { q: bindPalm.q, p: add(bindPalm.p, [ds[0], 0, ds[2] * 0.5]) };
        } else {
          const prevC = prevR.contactCentroid; let cc = [0, 0, 0]; for (const c of contacts) { const kp = KEYS[c.key]; cc = add(cc, [kp.xCenter, 0, 0]); } cc = scale(cc, 1 / contacts.length);
          init = { q: init.q, p: add(init.p, [cc[0] - prevC[0], 0, 0]) };
        }
        // keys of this contact set are down at the keyframe (it is solved at key bottom); all others at rest
        const keyAngles = new Float32Array(88); for (const c of contacts) keyAngles[c.key] = KEYS[c.key].dipRad;
        const dtPrev = prevR ? Math.max(0.02, e.T - prevR.T) : 10;
        const dtNext = nextR ? Math.max(0.02, nextR.T - e.T) : 10;
        const vel = e.vel; const nchord = e.notes.length;
        const ctxP = {
          shoulder: this.ctx.shoulderAt(e.T), L1: B.L1, L2: B.L2, swivel: this.ctx.swivelFor(init.p) ,
          pitch0: B.pitch0 + (nchord >= 3 && vel > 80 ? -2 : 0), yaw0: B.yaw0, ext0: B.ext0, uln0: B.uln0,   // (cycle 2: a -4 deg pitch0 was tried in range r7d/r7e/r7f: knuckle height unchanged, thumb MCP back at its floor -> reverted)
          rollPref: this.rollPref(contacts, init), hoverMin: 4,
          // cycle 2 fix round 2: contact-thumb tip within 32 mm of the index-MCP line (palm.js), wider only for real spans
          // (range r8a: a fixed -8 deg CMC floor with R3 held on F5 and the thumb on black Ab4 (span 9) yawed the keyframe 50 deg into a
          // broken wrist, ext 47 / uln 42: the floor opens 4 deg per semitone beyond 8 and 4 more for a thumb on a black key)
          ...(() => { const ps = contacts.map((c) => c.note.pitch); const sp = ps.length > 1 ? Math.max(...ps) - Math.min(...ps) : 0; const tb = contacts.some((c) => c.f === 1 && c.black) ? 1 : 0;
            return { thOut: (sp >= 9 ? 32 + 5.5 * (sp - 8) : 32) + 6 * tb, cmcFloor: (sp >= 9 ? -8 - 3 * (sp - 8) : -8) - 2 * tb }; })(),   // (r8e: -4/st and -4 on black let the S08 thumb out again: -3 / -2)
          prev: prevR ? prevR.pose : null, sPrev: 3 + 45 * dtPrev,
          next: nextR ? nextR.pose : null, sNext: 6 + 60 * dtNext,
          iters: 30, keyAngles, collide: false,
        };
        // the natural landing point of new notes depends on the palm: iterate (solve, re-land, solve)
        let land = (pose) => {
          for (const c of contacts) {
            const n = c.note;
            if (c.fixed) { c.P0 = n.P0; }
            else c.P0 = naturalContact(H, pose, c.f, c.key);
            const kk = KEYS[c.key];
            c.target = padTargetForKey(c.key, kk.dipRad, c.P0, H.pad[c.f].r);
            c.pref = this.prefFor(n, e); c.dipRatio = dipRatioFor(n);
          }
        };
        const free = [1, 2, 3, 4, 5].filter((f) => !contacts.some((c) => c.f === f));
        let r = null;
        if (pass === 0) {
          // multi-start: previous pose shifted, bind hand aligned to the targets (least-squares translation), +-yaw
          land(bindPalm);
          // bind hand translated so each contact finger, in its natural playing shape, lands on its target
          let ds = [0, 0, 0]; for (const c of contacts) { const bpc = H.padCenter(c.f, H.fingerFK(c.f, bindPalm, naturalAngles(H, c.f))); ds = add(ds, sub(c.target, bpc)); }
          ds = scale(ds, 1 / contacts.length);
          const aligned = { q: bindPalm.q, p: add(bindPalm.p, [ds[0], ds[1] + 0.004, ds[2]]) };
          const tryInit = (ini) => { land(ini); const ri = solvePalm(H, contacts, free, { ...ctxP, iters: 12 }, ini); if (!r || ri.cost < r.cost) r = ri; };
          tryInit(init); tryInit(aligned);
          if (r.cost > 60) for (const yaw of [-14, 14]) tryInit({ q: qMul(qAxisAngle([0, 1, 0], yaw * DEG), aligned.q), p: aligned.p });
          land(r.pose); r = solvePalm(H, contacts, free, { ...ctxP, iters: 25 }, r.pose);
          land(r.pose); r = solvePalm(H, contacts, free, { ...ctxP, iters: 12, collide: true }, r.pose);
        } else {
          const ini = this.kf1[k].pose; land(ini); r = solvePalm(H, contacts, free, { ...ctxP, iters: 18, collide: true }, ini);
          land(r.pose); r = solvePalm(H, contacts, free, { ...ctxP, iters: 8, collide: true }, r.pose);
        }
        // critic round 3 (critical: bar 22 Ab4-D5-G5 1-2-5, S15 octave Bb4-Bb5 1-5 with R2 held, S06 id225): a reach-limited
        // keyframe (a contact > 0.5 mm off its key) landed in whatever local minimum its neighbours' warm start led to, so
        // a small change elsewhere (f3d -> f4c) moved it from 5.7 / 1.9 mm to 13 / 7 mm error and the per-sample passes could
        // no longer recover the contact (thumb off its black key, R5 off G5, wrist broken into the keys). Such a keyframe
        // is re-solved from a fan of starts (lowered palm, rolled toward the thumb / the 5th, pushed in / out, pitched),
        // with and without the neighbour continuity terms, and the start with the smallest contact error wins (the
        // continuity terms only break ties: a keyframe that cannot reach its keys must not be pulled by its neighbours).
        if (!process.env.PERF_NO_RESCUE) {
          const maxErrOf = (o) => Math.max(0, ...Object.values(o.sol).map((s) => Math.max(s.err || 0, s.miss || 0)));
          let e0 = maxErrOf(r.o);
          if (e0 > 0.0005) {
            const thumbBlack = contacts.some((c) => c.f === 1 && c.black);
            // cycle 2 fix round 2: the rescue's 'free' starts also drop the thumb posture terms (a chord the CMC floor makes reach-limited
            // is solved as before instead of breaking the wrist: r8a keyframe T 66.771 ext 47 / uln 42 / yaw 50)
            const ctxFree = { ...ctxP, prev: null, next: null, rollPref: thumbBlack ? clamp(ctxP.rollPref + 8, -14, 10) : ctxP.rollPref, cmcFloor: -40, thOut: 300, thumbLoose: !process.env.PERF_NO_LOOSE };
            const fwd = [0, 0, 1];
            const starts = [];
            const baseP = [r.pose];   // (the previous keyframe as a second base doubles the time; r6a/r6c used both, r6d onward only this one)
            for (const b of baseP) for (const [dy, dz, roll, pitch] of [[-0.008, 0, 0, 0], [-0.008, 0, 10, 0], [-0.008, 0, -10, 0], [0, 0.012, 0, 0], [-0.006, 0.010, 10, 0], [-0.006, 0.010, -10, 0], [0, -0.012, 0, 0], [-0.010, 0, 0, -8], [0.006, 0, 0, 8], [0, 0, 20, 0], [0, 0, -20, 0]]) {
              const q = qMul(qAxisAngle(fwd, roll * DEG * (H.lat || 1)), qMul(qAxisAngle([1, 0, 0], pitch * DEG), b.q));
              starts.push({ q, p: add(b.p, [0, dy, dz]) });
            }
            // the contact points (P0, target) each solution was computed with travel with it
            const snap = () => contacts.map((c) => [c.P0, c.target]); const restore = (sn) => contacts.forEach((c, i) => { c.P0 = sn[i][0]; c.target = sn[i][1]; });
            const wallOf = (o) => o.wrist.ext / DEG > 42 || o.wrist.uln / DEG > 33 || o.wrist.uln / DEG < -16 || Object.entries(o.sol).some(([f, s2]) => +f !== 1 && s2.a && s2.a.mcp > 70 * DEG);
            let best = { r, e: e0 + (wallOf(r.o) ? 0.0008 : 0), ctx: ctxP, sn: snap() }; const orig = best;
            for (const cx of [ctxFree, ctxP]) for (const ini of starts) {
              land(ini); let ri = solvePalm(H, contacts, free, { ...cx, iters: 10 }, ini);
              land(ri.pose); ri = solvePalm(H, contacts, free, { ...cx, iters: 10, collide: true }, ri.pose);
              // cycle 2: the tie-break respects the wrist and MCP walls (f5a: contact MCP > 70 frames 10 -> 37, S15 octave
              // keyframe wrist ext 44.7 > 42): a start that breaks a wall counts 0.8 mm worse
              const ei = maxErrOf(ri.o) + (wallOf(ri.o) ? 0.0008 : 0);
              if (ei < best.e - 0.0003 || (ei < best.e + 0.0001 && ri.cost < best.r.cost && cx === best.ctx)) best = { r: ri, e: ei, ctx: cx, sn: snap() };
            }
            if (best !== orig) {
              land(best.r.pose); const rr = solvePalm(H, contacts, free, { ...best.ctx, iters: 14, collide: true }, best.r.pose);
              if (maxErrOf(rr.o) <= best.e + 0.0001) best = { r: rr, e: maxErrOf(rr.o), ctx: best.ctx, sn: snap() };
              restore(best.sn); r = best.r; this.rescued = (this.rescued || 0) + 1; this.rescueLog = this.rescueLog || [];
              this.rescueLog.push({ T: e.T, pass, before: e0, after: best.e, free: best.ctx === ctxFree });
            } else restore(orig.sn);
          }
        }
        // a strained hand (wrist beyond its working band, or a contact out of reach) lets go of a held key when the
        // sustain pedal covers the rest of that note (inaudible: the dampers stay up), then this keyframe is re-solved
        if (pass === 0 && this.ctx.pedalCovers) {
          const wu = r.o.wrist.uln / DEG, we = r.o.wrist.ext / DEG;
          const ro = r.o.feat.rollSup / DEG, yo = r.o.feat.yawIn / DEG - B.yaw0;
          const strained = wu > 32 || wu < -10 || we > 36 || we < -8 || ro < -24 || ro > 16 || Math.abs(yo) > 22 || Object.values(r.o.sol).some((s) => Math.max(s.err || 0, s.miss || 0) > 0.001);
          const heldC = contacts.filter((c) => c.fixed); let redo = false;
          if (strained && heldC.length) {
            const np = e.notes.map((n) => n.pitch); const dist = (c) => Math.min(...np.map((p) => Math.abs(p - c.note.pitch)));
            heldC.sort((a, b) => dist(b) - dist(a));
            // cycle 2 fix 2 (critical, S11 m 101.0: LH 4 riding D3 up while the thumb takes Bb2 BELOW it: keyframe yaw 110 deg,
            // cost 6000, the wrist snapped to 100 deg extension / 127 deg radial in 100 ms): a held key whose release has
            // already begun (tRel0 <= T + 10 ms) is no constraint - its key rises on its own track, the finger just leaves it
            // (no change to the sound), so the strained keyframe is re-solved without it, whatever the pedal
            const rising = heldC.find((c) => c.note.tm.tRel0 <= e.T + 0.01 && (c.note.tUp ?? 1e9) > e.T + 0.015);
            if (rising) { const h = rising.note; h.tUp = Math.max(h.tm.tRel0 + 0.004, e.T + 0.005); h.relWhy = (h.relWhy ? h.relWhy + '+' : '') + 'strainLetGo'; this.adaptive.push({ id: h.id, t: e.T, uln: +wu.toFixed(1), yaw: +yo.toFixed(1), rising: true }); redo = true; }
            for (const c of (redo ? [] : heldC)) {
              const h = c.note; const newRel = Math.max(h.tm.tKb + 0.03, e.T - 0.12);
              if (newRel < h.tm.tRel0 - 1e-4 && this.ctx.pedalCovers(newRel, h.t_off)) {
                h.tm.tRel0 = newRel; h.tUp = Math.min(h.tUp, newRel + 0.02); h.adaptRel = newRel; h.relWhy = 'adaptive'; this.adaptive.push({ id: h.id, t: e.T, uln: +wu.toFixed(1) });
                redo = true; break;
              }
            }
          }
          if (redo) { k--; continue; }
        }
        for (const c of contacts) if (!c.fixed) { c.note.P0pass = c.note.P0pass || []; c.note.P0pass[pass] = c.P0; if (pass === 1 || !c.note.P0) c.note.P0 = c.P0; }
        let cc = [0, 0, 0]; for (const c of contacts) cc = add(cc, [KEYS[c.key].xCenter, 0, 0]); cc = scale(cc, 1 / contacts.length);
        const sol = {}; for (const [f, s] of Object.entries(r.o.sol)) sol[f] = { a: s.a, err: Math.max(s.err, s.miss || 0), dpa: s.dpa, pen: s.pen, dpPitch: s.dpPitch, sideDown: s.sideDown, yaw: s.yaw, corr: s.corr };
        results[k] = { T: e.T, pose: r.pose, cost: r.cost, sol, contacts: contacts.map((c) => ({ f: c.f, id: c.note.id, fixed: c.fixed })), contactCentroid: cc, feat: { pitch: r.o.feat.pitch, yawIn: r.o.feat.yawIn, roll: r.o.feat.rollSup }, wrist: r.o.wrist, swivel: r.o.swivel };
      }
      if (pass === 0) { this.kf1 = results.slice(); this.kf = this.kf1; }
      else this.kf = results.slice();
      // pass 1 starts fresh except the contact points are re-chosen
      if (pass === 0) for (const n of this.notes) n.P0 = undefined;
    }
    // after pass 2, notes keep the P0 of their own (new) keyframe
    return this.kf;
  }

  prefFor(n, e) {
    if (n.black) return PREF.black;
    const ioi = this.ioiAround(e);
    if (ioi < 0.16) return PREF.fast;
    if (e.notes.length >= 3 && e.vel > 85) return PREF.chordFF;
    return PREF.white;
  }
  ioiAround(e) { const i = this.events.indexOf(e); const a = i > 0 ? e.t_on - this.events[i - 1].t_on : 9; const b = i + 1 < this.events.length ? this.events[i + 1].t_on - e.t_on : 9; return Math.min(a, b); }
  rollPref(contacts, pose) {
    // forearm rotation helps thumb-side notes (pronation) and little-finger notes (supination): performance.md 4.3
    // rollSup (palm.js) = asin of the index->little knuckle line's rise: + = little-finger side UP (thumb side down =
    // pronation helping the thumb), - = little side down (supination helping 4-5). A relaxed hand rests with the little
    // side slightly lower (-4 deg).
    const fs = contacts.map((c) => c.f); if (!fs.length) return -4;
    const m = fs.reduce((s, f) => s + f, 0) / fs.length;
    // fix round 2: a stretched 5th (octave-wide hand: thumb and 5th both down) rolls the hand a little more toward the 5th,
    // so the 5th plays curved on its tip-side corner instead of as a straight stick from the knuckle
    const wide = fs.includes(1) && fs.includes(5) ? -4 : 0;
    return clamp(-4 + (3 - m) * 3 + wide, -14, 6);
  }

  /** build the continuous palm trajectory sampler from the keyframes */
  buildTrajectory({ tStart, tEnd, phrases }) {
    const kf = this.kf; const ev = this.events; const segs = [];
    // arrival / departure times
    for (let k = 0; k < kf.length; k++) { kf[k].A = kf[k].T - 0.035; kf[k].D = kf[k].T; delete kf[k].late; }
    for (let k = 0; k + 1 < kf.length; k++) {
      const a = kf[k], b = kf[k + 1];
      const d = len(sub(b.pose.p, a.pose.p));
      const dur = clamp(0.12 + 1.8 * d, 0.12, 0.5);
      // notes of k not continuing into k+1 must be released (finger off the key) before a big move
      const nextIds = new Set(b.contacts.map((c) => c.id));
      let lastUp = -1e9; for (const c of a.contacts) if (!nextIds.has(c.id)) { const n = this.notes.find((x) => x.id === c.id); lastUp = Math.max(lastUp, n.tUp); }
      // the hand leaves keyframe a's position only once the fingers that do not carry over have left their keys
      let D = Math.max(a.T + 0.01, b.A - dur);
      D = Math.max(D, lastUp - 0.02);
      if (D > b.A - 0.07) { b.A = Math.min(b.T - 0.004, D + 0.07); D = Math.min(D, b.A - 0.05); }
      a.D = Math.max(a.A + 0.001, Math.min(D, b.A - 0.03));
      // fix round 1 (critic: L4 dragged 100 mm through the keys in the m 173.8 leap): the palm never leaves while a finger
      // that does not carry over is still on its key; when there is no time left, the hand arrives late instead (the
      // landing is struck, from the air) - a finger is never pulled off or through the keys by its own hand
      // the palm may start before the last finger is up only as far as it has moved <= 8 mm by then (a finger leaving a
      // key from a moving hand; the per-sample IK and the contact-preserving nudge keep it on the key that long)
      // critic round 2 (S11 m 100.94: the palm rolled 51 deg toward the thumb-under while L4 still held D3, hooking it):
      // the <= 8 mm budget counts the fingertip motion of the hand's TURN too (~95 mm lever from the wrist), not only
      // the wrist's translation
      const dEff = d + 0.095 * qAngle(a.pose.q, b.pose.q);
      let lead = 0; { const dur0 = Math.max(0.03, b.A - a.D); for (let x = 0.07; x > 0; x -= 0.0025) if (dEff * minjerk(x / dur0) <= 0.008) { lead = x; break; } }
      if (lastUp > -1e8 && a.D < lastUp - lead) {
        const need = clamp(0.05 + 0.25 * d, 0.06, 0.2);
        a.D = Math.max(a.A + 0.001, lastUp - lead);
        if (b.A < a.D + need) { b.A = a.D + need; if (kf[k + 2]) b.A = Math.min(b.A, kf[k + 2].A - 0.01); }
        if (b.A > b.T - 0.004) { this.lateArrivals = (this.lateArrivals || 0) + 1; this.lateMax = Math.max(this.lateMax || 0, b.A - b.T); b.late = b.A - b.T; }
      }
      a.moveD = d;
    }
    this.planPivots();
    this.traj = { kf, tStart, tEnd };
    // free windows (no finger in contact) for musical vertical motion
    const busy = this.notes.map((n) => [n.tm.tFk - 0.05, n.tUp]).sort((x, y) => x[0] - y[0]);
    const merged = []; for (const iv of busy) { const m = merged[merged.length - 1]; if (m && iv[0] <= m[1]) m[1] = Math.max(m[1], iv[1]); else merged.push(iv.slice()); }
    const free = []; let t0 = tStart; for (const m of merged) { if (m[0] > t0) free.push([t0, m[0]]); t0 = Math.max(t0, m[1]); } if (tEnd > t0) free.push([t0, tEnd]);
    this.freeWins = free;
    this.phrases = phrases || [];
  }

  /** critic round 2: leap pivots (see below); called again by the solver after it moved arrival/departure times */
  planPivots() {
    const kf = this.kf;
    for (let k = 0; k + 1 < kf.length; k++) {
      const a = kf[k], b = kf[k + 1]; const d = a.moveD || 0; const nextIds = new Set(b.contacts.map((c) => c.id));
      // critic round 2 (critical, S02 m 6.825: LH G1 -> F3/Bb3, 287 mm in 100 ms, 6.2 m/s; the hand sat still on G1, then
      // crossed in 4 frames): a LEAP away from a single held finger is led during the hold. While the finger is still on
      // its key the hand turns about that fingertip (vertical axis through the contact point, so the finger's own pose and
      // its contact are unchanged) and the wrist and forearm swing toward the target; the transfer then continues from the
      // turned pose with the same speed. One min-jerk progress over [pivot start, arrival] drives both phases, so the
      // speed is continuous and the peak speed drops by the share of the path covered in the pivot.
      delete a.pivot;
      const leaving = a.contacts.filter((c) => !nextIds.has(c.id));
      const dx = b.pose.p[0] - a.pose.p[0];
      if (d > 0.12 && Math.abs(dx) > 0.10 && leaving.length === 1 && a.contacts.length === 1) {
        const n = this.notes.find((x) => x.id === leaving[0].id);
        const c = n && n.P0;
        if (c) {
          const r = [a.pose.p[0] - c[0], 0, a.pose.p[2] - c[2]]; const rl = Math.hypot(r[0], r[2]);
          // y x r = [r.z, 0, -r.x]: the wrist moves along +-[r.z, 0, -r.x]; the sign that moves it toward the target
          const sgn = Math.sign(dx * r[2]) || 1;
          const thMax = 13 * DEG;                                         // hand-forearm yaw the wrist absorbs
          const Dp = thMax * rl;                                          // wrist path in the pivot
          const sH = clamp(Dp / d, 0, 0.3);                              // share of the path (equal speed in both phases)
          // u at which minjerk reaches sH (bisection), then the lead L from the flight time after the pivot
          let lo = 0, hi = 0.5; for (let it = 0; it < 30; it++) { const m = 0.5 * (lo + hi); if (minjerk(m) < sH) lo = m; else hi = m; }
          // the turn lasts until the held finger is up (tE), so the flight never drags it (contactsnaps r4c: L1 A2 34 deg in
          // one frame 14 ms before its up when the turn ended at a.D, up to 70 ms before the finger left)
          const tE = clamp(n.tUp ?? a.D, a.D, b.A - 0.03);
          const uH = 0.5 * (lo + hi); const fl = Math.max(0.03, b.A - tE);
          let L = uH * fl / Math.max(1e-3, 1 - uH);
          // the pivot starts after the key reached its bottom and the hand settled on a (>= 40 ms after its arrival)
          const tP0 = Math.max(a.A + 0.04, n.tm.tKb + 0.01);
          if (tE - L < tP0) L = tE - tP0;
          if (L > 0.02) {
            const tP = tE - L; const uh = L / (b.A - tP); const sh = minjerk(uh);
            const th = sgn * thMax * (sh / sH);                            // shorter pivot -> proportionally smaller turn
            a.pivot = { tP, tE, c: [c[0], 0, c[2]], th, sh };
          }
        }
      }
    }
  }

  /** 0..1: how far the hand has gone to its rest on the thigh after the final release */
  lapW(t) { if (!this.ctx.lap || !this.kf.length) return 0; const lastUp = this.lastUp ?? (this.lastUp = Math.max(...this.notes.map((n) => n.tUp))); return smoothstep(lastUp + 0.6, lastUp + 1.9, t); }
  /** palm pose at time t (before musical offsets) */
  palmBase(t) {
    const kf = this.kf;
    if (t <= kf[0].A) {
      // before the first note: hands poised above the first position, settling down over ~1.2 s
      const k0 = kf[0]; const lift = 0.03 * smoothstep(k0.A - 0.2, k0.A - 1.6, t);
      return { p: add(k0.pose.p, [0, lift, -0.6 * lift]), q: k0.pose.q };
    }
    // binary search the segment
    let lo = 0, hi = kf.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (kf[m].A <= t) lo = m; else hi = m - 1; }
    const a = kf[lo], b = kf[lo + 1];
    if (!b) {
      // after the last keyframe: fix round 1 (critic: the hands hovered frozen in mid-air for the last 4 s) - after the
      // final release the hand lifts ~2 cm, then is lowered in an arc onto the thigh over ~1.5 s and rests there
      const lastUp = this.lastUp ?? (this.lastUp = Math.max(...this.notes.map((n) => n.tUp)));
      const lift = 0.02 * minjerk((t - lastUp) / 0.45);
      let p = add(a.pose.p, [0, lift, -0.3 * lift]); let q = a.pose.q;
      const lap = this.ctx.lap;
      if (lap) {
        const u = clamp((t - lastUp - 0.35) / 1.55, 0, 1); const s = minjerk(u);
        p = lerp3(p, lap.p, s); p = add(p, [0, 0.03 * 16 * u * u * (1 - u) * (1 - u), 0]); q = qSlerp(a.pose.q, lap.q, s);
      }
      return { p, q };
    }
    const pv = a.pivot;
    if (pv && t > pv.tP) {
      // critic round 2: leap led during the hold (buildTrajectory): turn about the held fingertip, then fly on from there
      const s = minjerk((t - pv.tP) / Math.max(1e-3, b.A - pv.tP));
      const turn = (w) => { const qy = qAxisAngle([0, 1, 0], pv.th * w); const r = sub(a.pose.p, pv.c); return { p: add(pv.c, qRot(qy, r)), q: qMul(qy, a.pose.q) }; };
      if (t <= pv.tE) return turn(clamp(s / pv.sh, 0, 1));
      const a1 = turn(1); const w = clamp((s - pv.sh) / Math.max(1e-3, 1 - pv.sh), 0, 1);
      const u = clamp((t - pv.tE) / Math.max(1e-3, b.A - pv.tE), 0, 1);
      let p = lerp3(a1.p, b.pose.p, w);
      const d = a.moveD || 0; const apex = 0.015 + 0.12 * d; const bump = 16 * u * u * (1 - u) * (1 - u);
      p = add(p, [0, apex * bump, -0.35 * apex * bump]);
      return { p, q: qSlerp(a1.q, b.pose.q, w) };
    }
    if (t <= a.D) return { p: a.pose.p, q: a.pose.q };
    const u = clamp((t - a.D) / Math.max(1e-3, b.A - a.D), 0, 1); const s = minjerk(u);
    let p = lerp3(a.pose.p, b.pose.p, s);
    const d = a.moveD || 0;
    // arc: leaps lift 15 mm + 0.12 d; small shifts lift a few mm
    const apex = d > 0.045 ? 0.015 + 0.12 * d : 0.08 * d;
    const bump = 16 * u * u * (1 - u) * (1 - u);
    p = add(p, [0, apex * bump, -0.35 * apex * bump]);
    return { p, q: qSlerp(a.pose.q, b.pose.q, s) };
  }
}
