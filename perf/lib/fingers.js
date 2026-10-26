// Per-finger targets over time (research/performance.md 4.7, 4.8, 8.6): CONTACT (pad on the moving key surface) ->
// RELEASE (rides the key up) -> LIFT -> HOVER (relaxed, carried by the hand, 5-15 mm above the keys) -> PREP (apex)
// -> APPROACH (last part vertical) -> CONTACT. Thumb-under stays low under the palm; finger-over arcs high.
//
// Everything between two contacts is expressed in the PALM frame: the departure point (where the finger leaves its key)
// and the arrival point (its next key at the moment of contact) are converted to palm-local coordinates with the palm
// pose at those instants, blended in the palm frame and carried by the moving hand. So a finger never trails behind a
// travelling hand or reaches for a world point the hand has left; it lands exactly because at the arrival instant the
// palm-local arrival point maps back onto the key.
import { add, sub, scale, lerp3, clamp, minjerk, smoothstep, len, qRot, qConj } from './math.js';
// fix round 1: contact starts at touchT (pressed: on the resting key 17 ms before it moves), re-strikes lift off the
// rising key, the free thumb rests over the keys, the DIP coupling and the landing clamp change continuously.
import { KEYS, keyPointP, keyNormalP, sphereClearY, FALLBOARD_Z } from './pianoGeo.js';
// cycle 2 fix round 2 (critic: free flesh in keys 1027 -> 3427 vertex-frames with the 6 mm drape): on-keys drape 9 mm above the keys
const DRAPE_ON = process.env.PERF_DRAPE6 ? 0.006 : 0.009;

/** cubic Hermite on [0,1] */
const herm = (y0, v0, y1, v1, u) => { const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * v0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * v1; };
const toL = (P, w) => qRot(qConj(P.q), sub(w, P.p));
const toW = (P, l) => add(P.p, qRot(P.q, l));

/**
 * Per-note articulation of one hand's notes (before the palm path: the hand's attack is part of it).
 * apex / apexLead: the finger's lift and its lead before the touch; vfk: the pad's speed at the touch (struck; pressed
 * notes land at rest); liftOff after the release. A struck onset group is carried into the keys by the hand: the palm
 * rises h, falls with uniform acceleration (no braking) and meets the keys at vHand, then sinks with them and recovers
 * (n.att, rendered by solver.js verticalOffsets). The hand does not drop while another finger of it holds a key (legato)
 * and little in fast passages (the fingers play those); the finger adds the rest (vfk - vHand) with its own drop.
 */
export const V_HAND_MAX = 0.35, ATT_SINK_TAU = 0.02;
export function articulate(notes) {
  const hs = notes.slice().sort((a, b) => a.t_on - b.t_on);
  for (let i = 0; i < hs.length; i++) {
    const n = hs[i]; const nv = clamp((n.vel - 20) / 100, 0, 1);
    let prevOn = null; for (let j = i - 1; j >= 0; j--) if (hs[j].t_on < n.t_on - 0.03) { prevOn = hs[j]; break; }
    const ioiPrev = prevOn ? n.t_on - prevOn.t_on : 1.0;
    n.apex = n.tm.touch === 'struck' ? 0.008 + 0.027 * nv : 0.002 + 0.006 * nv + (ioiPrev > 0.4 ? 0.004 : 0);
    n.apexLead = clamp(0.4 * ioiPrev, 0.05, 0.15);
    n.vfk = n.tm.touch === 'struck' ? 0.15 + 0.6 * nv : 0.0;
    n.ioiPrev = ioiPrev; n.vHand = 0; n.att = null;
    let nextOn = null; for (let j = i + 1; j < hs.length; j++) if (hs[j].t_on > n.t_on + 0.03) { nextOn = hs[j]; break; }
    const legatoNext = nextOn && n.t_off >= nextOn.t_on - 0.04;
    n.liftOff = legatoNext ? 0.004 : (nextOn && nextOn.t_on - n.t_off < 0.25 ? 0.008 : 0.012);
  }
  const groups = []; for (const n of hs) { const g = groups[groups.length - 1]; if (g && n.t_on - g[0].t_on <= 0.03) g.push(n); else groups.push([n]); }
  let prevT = -1e9;
  for (const g of groups) {
    const tT = Math.min(...g.map(touchT)); const st = g.filter((n) => n.tm.touch === 'struck' && n.P0);
    if (st.length) {
      const v = Math.max(...st.map((n) => n.vfk)), ioi = g[0].ioiPrev;
      const held = notes.some((m) => !g.includes(m) && m.P0 && touchT(m) < tT - 0.04 && upT(m) > tT);
      let vh = held ? 0 : Math.min(v, V_HAND_MAX) * smoothstep(0.12, 0.30, ioi);
      const Ld = clamp(0.4 * ioi, 0.04, 0.09), t0 = tT - Ld, tR = Math.max(prevT + 0.06, t0 - 0.2);
      if (t0 - tR < 0.03) vh = 0;
      if (vh > 0.01) { const att = { tT, Ld, h: vh * Ld / 2, v: vh, tR }; for (const n of g) { n.vHand = vh; n.att = att; } }
    }
    prevT = tT;
  }
}

export class FingerAnimator {
  constructor(H, notes, keyAngleFn) {
    this.H = H; this.keyAngle = keyAngleFn;
    this.byF = {}; for (let f = 1; f <= 5; f++) this.byF[f] = notes.filter((n) => n.f === f && n.P0).sort((a, b) => a.tm.tFk - b.tm.tFk);
    this.all = notes;
  }
  /** cycle 2: smooth weight (0..1) that this hand has a finger on a key at t (merged contact intervals, 0.12 s ramps) */
  onKeysW(t) {
    if (!this._on) {
      const iv = this.all.filter((n) => n.P0).map((n) => [touchT(n), upT(n)]).sort((a, b) => a[0] - b[0]); const m = [];
      for (const x of iv) { const l = m[m.length - 1]; if (l && x[0] <= l[1] + 0.05) l[1] = Math.max(l[1], x[1]); else m.push(x.slice()); }
      this._on = m;
    }
    const m = this._on; let lo = 0, hi = m.length - 1, j = -1;
    while (lo <= hi) { const k = (lo + hi) >> 1; if (m[k][0] <= t) { j = k; lo = k + 1; } else hi = k - 1; }
    let w = 0; const R = 0.12;
    for (const k of [j, j + 1]) { const x = m[k]; if (!x) continue; if (t >= x[0] && t <= x[1]) return 1;
      if (t < x[0]) w = Math.max(w, smoothstep(x[0] - R, x[0], t)); else w = Math.max(w, 1 - smoothstep(x[1], x[1] + R, t)); }
    return w;
  }
  /** pad-centre target on note n's key at time t (rides the key) */
  contactTarget(n, t, P0 = null) {
    const a = this.keyAngle(n.key, t);
    const p = add(keyPointP(n.key, a, P0 || n.P0), scale(keyNormalP(a), this.H.pad[n.f].r));
    return n.padCorr ? sub(p, n.padCorr) : p;
  }

  /**
   * target for finger f at time t.
   * env: { palm (current {q,p}), palmAt(t) -> palm pose at another time, hoverW: relaxed pad centre (world, carried by
   *        the hand + small secondary lag), contactsNow: [{f, key}] fingers in contact (for crossing arcs) }
   * returns { p, mode: 'contact'|'free', note, dipRatio }
   */
  target(f, t, env) {
    const list = this.byF[f]; const r = this.H.pad[f].r;
    // a note's contact starts at tTouch: pressed notes land on the resting key a film frame before it moves (fix round 1:
    // "pressed from the key surface"), struck notes land as the key starts moving
    let lo = 0, hi = list.length - 1, ip = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (touchT(list[m]) <= t) { ip = m; lo = m + 1; } else hi = m - 1; }
    const prev = ip >= 0 ? list[ip] : null, next = list[ip + 1] || null;
    if (prev && t <= upT(prev)) {
      // repeated note on the same key by the same finger: the finger rides the key up, lifts 2-4 mm off it when there is
      // time, and comes back down onto the surface just before the key starts its next stroke
      let lift = 0, P0 = null;
      if (next && next.pitch === prev.pitch) {
        const a = prev.tm.tRel0 + 0.008, b = (next.tStart ?? next.tm.tFk) - 0.006; const L = b - a;
        if (L > 0.02 && t > a && t < b) { const u = (t - a) / L; lift = 0.0035 * clamp((L - 0.02) / 0.05, 0, 1) * Math.sin(Math.PI * u) ** 2; }
        P0 = ridingP0(prev, next, t);
      }
      const p = this.contactTarget(prev, t, P0);
      return { p: lift ? add(p, [0, lift, 0]) : p, mode: 'contact', note: prev, dipRatio: dipRatioFor(prev), lift };
    }
    const palm = env.palm;
    let Hw = env.hoverW;
    // resting fingers hover >= 5 mm above the keys under them, relaxed and carried by the hand (fix round 1: no upper
    // clamp any more: it made a lifted hand reach its fingers down to the keys, MCP 52-63 deg on every finger)
    if (f !== 1) {
      // fix round 2: the hover lift turns the finger about its knuckle (MCP extension, PIP opening a little) when the
      // knuckle position is known; a straight vertical lift pulled the pad toward the MCP and curled the PIP into a claw
      for (let it = 0; it < 3; it++) {
        const cy = sphereClearY(Hw[0], Hw[2], r); const dy = cy + 0.005 - Hw[1]; if (!(cy > 0) || dy <= 0.0002) break;
        if (env.mcpW) { const mc = env.mcpW(f); const v0 = sub(Hw, mc), v1 = add(v0, [0, dy, 0]); Hw = add(mc, scale(v1, (len(v0) + 0.4 * dy) / Math.max(1e-6, len(v1)))); }
        else { Hw = [Hw[0], Hw[1] + dy, Hw[2]]; break; }
      }
      // critic round 2 (S14 top-down: free fingers 16-49 mm above the key tops, claws): a resting long finger whose next
      // stroke is coming drapes down toward its keys, to ~10 mm above them, by at most 12 mm, by OPENING about its knuckle
      // (the pad moves away from the knuckle as it goes down: PIP/DIP open, no MCP hinge); full strength within 0.3 s of
      // the stroke, 60 % beyond 0.6 s
      // cycle 2 fix 3 (critic: starfish / spider hands from above, resting fingers 18-38 mm above the keys, the ring finger
      // lifted alone 15-20 mm above its neighbours during a 2.2 s dyad): while the hand has a finger on a key, EVERY resting
      // long finger drapes to ~6 mm above the keys under it (by <= 22 mm, opening about the knuckle); the common target height
      // keeps neighbours within a few mm of each other (juncturae). Hands in the air keep the round-2 rule (next stroke only).
      const wOn = this.onKeysW(t);   // smooth 0..1 (ramps 0.12 s around the hand's contact intervals: no target step)
      if (next || wOn > 0) {
        const tn = next ? touchT(next) - t : 1e9; const cy = sphereClearY(Hw[0], Hw[2], r);
        if (cy > 0 && tn > 0) {
          const exOn = Hw[1] - (cy + DRAPE_ON), exNx = Hw[1] - (cy + 0.010);
          const dyOn = wOn * Math.min(Math.max(0, exOn), 0.022), dyNx = next ? Math.min(Math.max(0, exNx), 0.012) * (1 - 0.4 * smoothstep(0.3, 0.6, tn)) : 0;
          if (dyOn > 0 || dyNx > 0) {
            const dy = Math.max(dyOn, dyNx);
            if (env.mcpW) { const mc = env.mcpW(f); const v0 = sub(Hw, mc), v1 = add(v0, [0, -dy, 0]); Hw = add(mc, scale(v1, (len(v0) + (dyOn > dyNx ? 0 : 0.5) * dy) / Math.max(1e-6, len(v1)))); }   // cycle 2: the on-keys drape is a pure arc about the knuckle (keeps the curl; run g1d with 0.25 straightened the free LH index in the m 165.3 octave into the fallboard, 34 mm)
            else Hw = [Hw[0], Hw[1] - dy, Hw[2]];
          }
        }
      }

      // cycle 2 (g1d/r7i: LH octave A#1-A#2 at m 165.3, both on black keys with the bent thumb: the wrist sits at the key front
      // and the carried relaxed index hovered at z 159 mm, inside the fallboard): a resting finger's pad stays >= 22 mm in front
      // of the fallboard face (the IK curls it instead)
      if (Hw[2] > FALLBOARD_Z - 0.022) Hw = [Hw[0], Hw[1], FALLBOARD_Z - 0.022];
    }
    else {
      // fix round 1: the free thumb rests over the keys beside the index (never hanging off the key front into the key
      // slip): its lowest point >= 8 mm behind the key front, 5-16 mm above the key tops
      const z = Math.max(Hw[2], 0.008); const cy = sphereClearY(Hw[0], z, 0.006) - 0.006;
      Hw = [Hw[0], cy > 0 ? Math.max(Hw[1], cy + 0.005) : Hw[1], z];
    }
    const u0 = prev ? upT(prev) : -1e9, u1 = next ? touchT(next) : 1e9; const gap = u1 - u0;
    // DIP/PIP coupling blends from the last contact's to the relaxed one and on to the next contact's (no snap on release)
    // critic round 2 (hovering fingers curled into hooks): the relaxed hover couples DIP at 0.55 of PIP (was 0.67)
    const HOV = 0.55;
    const c0 = prev ? dipRatioFor(prev) : HOV, c1 = next ? dipRatioFor(next) : HOV;
    let dipRatio = c0 + (HOV - c0) * smoothstep(u0, u0 + 0.08, t); dipRatio += (c1 - dipRatio) * smoothstep(u1 - 0.1, u1, t);
    // same key repeated with a short gap: stay on the key surface
    if (prev && next && prev.pitch === next.pitch && gap < 0.12) return { p: this.contactTarget(next, t, ridingP0(prev, next, t)), mode: 'contact', note: next, dipRatio: dipRatioFor(next), riding: true };
    // departure / arrival points in the palm frame of their instants
    const Ld = prev ? toL(env.palmAt(u0), this.contactTarget(prev, u0)) : null;
    const La = next ? toL(env.palmAt(u1), this.contactTarget(next, u1)) : null;
    // the last 60 ms of an approach are steered onto the key in WORLD space (the palm can still be settling, so the
    // palm-frame landing point alone could miss or sink into the key before contact)
    // fix round 2 (critic: R5 approach flicks in the climax, 3742 deg/s): the steer is a SMALL correction (horizontal part
    // <= 4 mm): when the palm was still travelling, the full world-space offset dragged the finger back toward the key's
    // world position (curl in), then let go of it as the palm caught up (fling). The landing itself is exact without it:
    // at u1 the palm is at palmAt(u1), where La maps back onto the key.
    // (the hand's drop onto the keys carries the finger down, not a landing error: it is not steered away; its sink after
    // an earlier touch of the group is, so a later finger still lands on its key)
    const attY = env.attAt ? Math.max(0, env.attAt(t)) : 0;
    let landOff = next ? scale(add(sub(this.contactTarget(next, u1), toW(palm, La)), [0, attY, 0]), smoothstep(u1 - 0.06, u1 - 0.004, t)) : [0, 0, 0];
    { const h = Math.hypot(landOff[0], landOff[2]); if (h > 0.004) landOff = [landOff[0] * 0.004 / h, landOff[1], landOff[2] * 0.004 / h]; }
    let p;
    if (prev && next && gap < 0.45) {
      // continuous transfer key -> key inside the hand frame: min-jerk finishing early (the last part is vertical),
      // vertical Hermite bump (apex) in world y
      const hEnd = u1 - Math.min(0.04, gap * 0.25);
      const s = minjerk((t - u0) / Math.max(1e-3, hEnd - u0));
      const base = toW(palm, lerp3(Ld, La, s));
      let apex = Math.max(next.apex, prev.liftOff * 0.7);
      // fix round 2 (debug of the R5 climax flick, A5 -> Bb5 at m 178.35, gap 57 ms): the struck apex (up to 30 mm at
      // forte) was applied in full however short the transfer, so the pinky had to rise 29 mm and come down again within
      // ~50 ms: MCP flung to its -12 deg limit with abd at -25 and 9 mm IK error, then re-curled on the key. The finger's
      // own lift now scales with the time it has (<= 4 mm + 100 mm/s x gap) and is smaller for the short 4th/5th fingers;
      // in fast octave passages the lift comes from the hand (palm arc), not from the finger.
      apex = Math.min(apex, 0.004 + 0.10 * gap) * (f === 5 ? 0.6 : f === 4 ? 0.8 : 1);
      apex += this.crosses(prev, next, env.contactsNow) ? (f === 1 ? 0 : 0.016) : 0;
      if (f === 1) apex = Math.min(apex, 0.008);
      const tA = u1 - Math.min(next.apexLead, gap * 0.6);
      // struck: the finger falls onto the key adding the speed the hand does not bring, with uniform acceleration when its
      // apex (which also clears the keys it passes over) is no higher than that drop needs
      const vF = next.tm.touch === 'struck' ? Math.max(0, next.vfk - next.vHand) : 0;
      let y;
      if (t < tA) { const u = (t - u0) / Math.max(1e-3, tA - u0); y = herm(0, 0, apex, 0, clamp(u, 0, 1)); }
      else { const u = clamp((t - tA) / Math.max(1e-3, u1 - tA), 0, 1); const dur = u1 - tA; y = vF > 0 && apex <= vF * dur / 2 ? apex * (1 - u * u) : herm(apex, 0, 0, -vF * dur, u); }
      p = add([base[0], base[1] + y, base[2]], landOff);
    } else {
      // lift off the previous key into the hover, hover, then approach the next key from above
      let tDep = prev ? Math.min(0.20, gap * 0.35) : 0;
      // fix round 1b (QC r176: L3/L4 11 mm into B2/A2 at m 173.83): in a leap the hand starts moving while the finger is
      // still on its key, so the departure posture is stretched toward the old key; carried rigidly in the palm frame for
      // 200 ms it was swept through the keys under the landing hand. When the palm travels > 15 mm in the 80 ms after the
      // release, the finger curls into its hover within 70 ms
      if (prev && tDep > 0.07) { const pa = env.palmAt(u0).p, pb = env.palmAt(u0 + 0.08).p; if (len(sub(pb, pa)) > 0.015) tDep = 0.07; }
      let base = Hw;
      if (prev) {
        const w = 1 - minjerk((t - u0) / tDep);
        if (w > 0) { const lifted = add(toW(palm, Ld), [0, prev.liftOff * minjerk((t - u0) / Math.max(1e-3, 0.5 * tDep)), 0]); base = lerp3(Hw, lifted, w); }
      }
      if (next) {
        const Pn = toW(palm, La);
        const tApp = clamp(0.12 + 0.6 * len(sub(Pn, Hw)), 0.15, Math.min(0.35, gap * 0.55));
        if (t > u1 - tApp) {
          const u = (t - (u1 - tApp)) / tApp;
          const hEnd = 0.82; const s = minjerk(u / hEnd);
          const vF = next.tm.touch === 'struck' ? Math.max(0, next.vfk - next.vHand) : 0;
          let lift = Math.max(next.apex * (f === 5 ? 0.6 : f === 4 ? 0.8 : 1), 0.004);   // fix round 2: shorter lift for 4 / 5
          if (vF > 0) lift = Math.min(lift, Math.max(0.004, vF * tApp * (1 - hEnd) / 2));
          const above = add(Pn, [0, lift, 0]);
          const xz = lerp3(base, above, s);
          let y;
          if (u < hEnd) y = xz[1];
          else { const v = (u - hEnd) / (1 - hEnd); y = vF > 0 ? Pn[1] + lift * (1 - v * v) : herm(above[1], 0, Pn[1], -vF * tApp * (1 - hEnd), v); }
          p = add([xz[0], y, xz[2]], landOff);
        } else p = base;
      } else p = base;
    }
    // never sink into the key bed while free (except the last part of the approach onto its own key); the margin
    // ramps in after a release and out before a landing so the clamp never jumps
    // (the thumb's pad is a point at its lowest corner: it is checked as a 9 mm sphere sitting on that point, wide enough
    // for the flesh beside its tip, which otherwise grazes the neighbouring key while the hand is still settling)
    const clr = 0.006 * Math.min(prev ? smoothstep(u0, u0 + 0.06, t) : 1, next ? smoothstep(u1, u1 - 0.05, t) : 1) - 0.0012;
    const rc = Math.max(r, f === 1 ? 0.009 : 0.006), up = rc - r;
    const sY = sphereClearY(p[0], p[2], rc * 0.92);
    const need = sY + rc * 0.08 + clr - up;
    if (p[1] < need) {
      // the clamp fades out continuously over the last 35 ms of the landing on the finger's own key (no jump)
      let w = 1;
      // (fix round 2: the distance gate is measured in the palm frame of the landing, so a palm still travelling no longer
      // flips it within a few ms; it was the 'fling' half of the R5 approach flick)
      if (next) { const Lp = toW(palm, La); const dxz = Math.hypot(p[0] - landOff[0] - Lp[0], p[2] - landOff[2] - Lp[2]); w = 1 - smoothstep(u1 - 0.035, u1 - 0.004, t) * (1 - smoothstep(0.004, 0.009, dxz)); }
      p = [p[0], p[1] + (need - p[1]) * w, p[2]];
    }
    return { p, mode: 'free', note: next || prev, prev, next, dipRatio, dbg: { u0, u1, gap, transfer: !!(prev && next && gap < 0.45) } };
  }
  crosses(prev, next, contactsNow) {
    if (!contactsNow) return false;
    const x0 = KEYS[prev.key].xCenter, x1 = KEYS[next.key].xCenter;
    for (const c of contactsNow) { if (c.f === prev.f) continue; const x = KEYS[c.key].xCenter; if ((x - x0) * (x - x1) < 0) return true; }
    return false;
  }
}
export function dipRatioFor(n) { return n.black ? 0.58 : 0.67; }
/** a finger re-striking its key slides its contact point from the old note's to the new one's while it rides the key
 * (fix round 1: the point used to jump up to 28 mm along the key in one sample, a 40-57 deg joint pop) */
export function ridingP0(prev, next, t) {
  if (!prev.P0 || !next.P0) return null; const a = prev.tm.tRel0 - 0.02, b = touchT(next);
  const u = b > a ? smoothstep(a, b, t) : 1; return lerp3(prev.P0, next.P0, u);
}
/** when the finger's contact with note n starts: pressed notes land one film frame (17 ms) before the key moves */
/** the time the finger leaves its key: tUp, or earlier when the solver found it dragged out of reach (n.tLetGo, fix round 1b) */
export function upT(n) { return n.tLetGo !== undefined && n.tLetGo < n.tUp ? n.tLetGo : n.tUp; }
export function touchT(n) { const ks = n.tStart ?? n.tm.tFk; return n.tm.touch === 'pressed' ? Math.min(n.tm.tFk, ks) - 0.017 : ks; }
