// The camera director: compiles the edit (shots.js EDIT, musically anchored) into frame-exact shots and evaluates
// the camera at any film time t (every sub-frame time, so camera motion blur and focus pulls are exact).
// Pure functions of t; plain arrays (no three.js), so Node tools evaluate exactly what the page renders.
//
// Shot spec (see shots.js and docs/SHOTLIST.md for the meaning of each field):
//   { id, name, ref, at: anchor, cheat: deg (rigYawCheatDeg, core rotation.y convention),
//     lens: { mm | [mm0, mm1], fStop | [f0, f1], N, preblur, nearest, near },
//     cam: { orbit: { pivot:[x,y,z], a:[deg0,deg1], d:[m0,m1], h:[m0,m1] } } | { path: [[x,y,z], ...] }   (rig frame)
//     look: { at: [x,y,z] | [[x,y,z],[x,y,z]], track: { hand:'L'|'R'|'both', w, offset:[x,y,z] } },
//     follow: { hand, gain:[gx,gy,gz] },                // camera position follows the hand track (slider operator)
//     move: { span:[anchor, anchor], ain, aout, v0, v1 },  // velocity profile of the move (lib.makeProfile)
//     focus: { on, pulls:[{ at: anchor, dur, on }] },    // on: 'look' | [x,y,z] | {hand} | {dist} | {point, extra}
//     noise: { rot:[yaw,pitch,roll] deg, pos: m, freq: Hz, rough: 0..1, seed },
//     roll: deg | [deg0, deg1], doc: { ... text for the shot list } }
// Rig frame: origin = keyboard centre at the key-front plane on the water, +z toward the tail, -x = treble.
// alpha (refs.md): camera direction from the pivot = (-sin a, 0, -cos a): 0 = behind the pianist, +90 = treble side.
import { MUSIC_OFFSET, FPS, BASE_RIG_YAW_DEG } from '../core/constants.js';
import { cutTime, cutFrame } from './score.js';
import {
  D2R, R2D, add, sub, mul, dot, cross, len, norm, lerp, lerp3, clamp, rotY, rotAxis,
  makeProfile, makePath, makeMonotone, smoothNoise, pullFocus, smootherstep,
} from './lib.js';

export const HEAD = [0, 1.14, -0.33];          // pianist head centre (rig, bind pose of assets rig.json)
export const UP = [0, 1, 0];
export const HAND_NEAR = 0.04;                  // focus on a hand's near surface, this far in front of its centre

const isPt = (v) => Array.isArray(v) && v.length === 3 && typeof v[0] === 'number';
const pair = (v) => (Array.isArray(v) && v.length === 2 && !isPt(v) ? v : [v, v]);

/** rig-frame camera position on an orbit around pivot at azimuth alpha (deg), horizontal distance d, height h */
export function orbitPos(pivot, alphaDeg, d, h) {
  return [pivot[0] - d * Math.sin(alphaDeg * D2R), h, pivot[2] - d * Math.cos(alphaDeg * D2R)];
}
/** alpha (deg) of a rig-frame camera position seen from point p (default: the pianist's head) */
export function alphaOf(pos, p = HEAD) { return Math.atan2(-(pos[0] - p[0]), -(pos[2] - p[2])) * R2D; }
/** unit vector toward the sun in the RIG frame for a given elevation and rig-yaw cheat */
export function sunDirRig(elevDeg, cheatDeg = 0) {
  const e = elevDeg * D2R, w = [0, Math.sin(e), -Math.cos(e)];        // world: azimuth 0 = -z
  return rotY(w, -(BASE_RIG_YAW_DEG + cheatDeg));                      // world -> rig (inverse yaw)
}

export function createDirector(EDIT, timeline, hands) {
  const tl = timeline;
  const filmEnd = cutTime(tl.resolve(EDIT.end));
  tl.filmEnd = filmEnd;
  const FILM_FRAMES = cutFrame(filmEnd);
  const m = (t) => t - MUSIC_OFFSET;

  // ---------------------------------------------------------------------------------------------- sun arc
  const sunKeys = EDIT.sun.map(([a, el]) => [tl.resolve(a), el]);
  for (let i = 1; i < sunKeys.length; i++) if (!(sunKeys[i][0] > sunKeys[i - 1][0])) throw new Error(`camera: sun keys not increasing at ${EDIT.sun[i][0]}`);
  const sunAt = makeMonotone(sunKeys);
  /** dense [t, deg] keys for ctx.sun.keys (core interpolates linearly; 0.5 s spacing of a C1 curve is exact to <0.001 deg) */
  const sunDenseKeys = [];
  for (let t = 0; t <= filmEnd + 0.5; t += 0.5) sunDenseKeys.push([+t.toFixed(3), +sunAt(t).toFixed(5)]);

  // ---------------------------------------------------------------------------------------------- fades
  const fadeAt = (t) => {
    const F = EDIT.fades || {};
    let ev = 0;
    if (F.in && t < F.in.dur) ev += -F.in.ev * (1 - smootherstep(t / F.in.dur));
    if (F.out) { const s0 = filmEnd - F.out.dur; if (t > s0) ev += -F.out.ev * smootherstep((t - s0) / F.out.dur); }
    return ev;
  };

  // ---------------------------------------------------------------------------------------------- compile shots
  const specs = EDIT.shots;
  // EDIT.cutOnAnticipation { maxBeats, voices }: a cut whose beat is anticipated (a note of any listed voice - melody,
  // bass, chord - attacked up to maxBeats early and still sounding across the beat) moves to the FIRST attack of that
  // push (score.js pushAttack); shots opt out with snap: false; film/music-time anchors never move.
  // (EDIT.cutOnMelodyAttack, the older melody-only rule, is still honoured.)
  const snapRule = EDIT.cutOnAnticipation || EDIT.cutOnMelodyAttack;
  const cutAt = (sp) => {
    const raw = tl.resolve(sp.at);
    if (!snapRule || sp.snap === false || /^(f|m)-?\d|^(pedalUp|filmEnd|lastNote|lastMel)/.test(String(sp.at))) return { t: raw, raw };
    if (EDIT.cutOnAnticipation) return { t: tl.pushAttack(raw, snapRule.maxBeats ?? 0.75, snapRule.voices), raw };
    return { t: tl.melodyAttack(raw, snapRule.maxBeats ?? 0.75), raw };
  };
  const shots = specs.map((sp, i) => { const c = cutAt(sp); return { i, spec: sp, id: sp.id, t0: cutTime(c.t), anchorT: c.raw, snappedS: +(c.t - c.raw).toFixed(4) }; });
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    s.t1 = i + 1 < shots.length ? shots[i + 1].t0 : filmEnd;
    if (!(s.t1 > s.t0)) throw new Error(`camera: shot ${s.id} has no duration (${s.t0} .. ${s.t1})`);
    s.f0 = Math.round(s.t0 * FPS); s.f1 = Math.round(s.t1 * FPS);
    const sp = s.spec;
    const span = sp.move?.span || [];
    s.ma = span[0] != null ? tl.resolve(span[0]) : s.t0;
    s.mb = span[1] != null ? tl.resolve(span[1]) : s.t1;
    s.prof = makeProfile(sp.move || {});
    if (sp.cam.path) s.path = makePath(sp.cam.path);
    if (sp.cam.orbit) {
      const pv = sp.cam.orbit.pivot;
      // pivot { hand, at: 'start'|'mid', offset }: the hand's (smoothed) position at the shot start / middle
      s.pivot = isPt(pv) ? pv : add(hands.at(pv.hand, m(pv.at === 'mid' ? (s.t0 + s.t1) / 2 : s.t0)), pv.offset || [0, 0, 0]);
    }
    s.pulls = (sp.focus?.pulls || []).map((p) => ({ ...p, t: tl.resolve(p.at) })).sort((a, b) => a.t - b.t);
    s.handRef = {};
    if (sp.follow) s.handRef[sp.follow.hand] = hands.at(sp.follow.hand, m(s.t0));
    s.settings = {
      N: sp.lens.N ?? 16, preblur: sp.lens.preblur ?? 0, nearestDist: sp.lens.nearest ?? null,
      rigYawCheatDeg: sp.cheat ?? 0, shutter: sp.shutter ?? 0.5,
    };
    s.pos0 = m(s.t0);
  }
  if (shots[0].t0 !== 0) throw new Error('camera: the first shot must start at film time 0');

  const findShot = (t) => {
    let lo = 0, hi = shots.length - 1;
    if (t < shots[0].t0) return shots[0];
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (shots[mid].t0 <= t) lo = mid; else hi = mid - 1; }
    return shots[lo];
  };

  // ---------------------------------------------------------------------------------------------- evaluation
  function focusPoint(spec, s, t, pos, target, dir) {
    const mm = m(t);
    if (spec == null || spec === 'look') return { depth: dot(sub(target, pos), dir) };
    if (isPt(spec)) return { depth: dot(sub(spec, pos), dir) };
    if (spec.dist != null) return { depth: spec.dist };
    // a hand: the depth range of its fingertips + knuckles along the lens axis (hands.box, from the solved performance
    // when available) -> focus at the range's harmonic middle 2ab/(a+b), where the near and far edges blur equally
    // (critic, resume 3: near-surface focus left the thumb/index side 6-12 px soft in the side-on close-ups).
    // spec.at: 'mid' (default) | 'near' | 'far' | 0..1 (diopter blend near -> far); spec.offset shifts the box (m)
    if (spec.hand) {
      // spec.window (s): the union of the box over [m - w/2, m + w/2] (9 samples), for hands that jump faster than a
      // focus puller follows (left-hand stride: bass octave <-> tenor shells, ~30 cm; critic r2: S08 sharp 85 %)
      // spec.fast: the quick focus-puller box (0.08 s smoothing, 0.04 s lead) instead of the 0.25 s one
      let b = hands.box(spec.hand, mm, !!spec.fast);
      if (spec.window) {
        for (let k = 0; k <= 8; k++) {
          const q = hands.box(spec.hand, mm + spec.window * (k / 8 - 0.5), !!spec.fast);
          b = { lo: b.lo.map((v, i) => Math.min(v, q.lo[i])), hi: b.hi.map((v, i) => Math.max(v, q.hi[i])) };
        }
      }
      const o = spec.offset || [0, 0, 0];
      const c = [0, 1, 2].map((k) => 0.5 * (b.lo[k] + b.hi[k]) + o[k]), hw = [0, 1, 2].map((k) => 0.5 * (b.hi[k] - b.lo[k]));
      const dc = dot(sub(c, pos), dir), ext = Math.abs(dir[0]) * hw[0] + Math.abs(dir[1]) * hw[1] + Math.abs(dir[2]) * hw[2];
      const a = Math.max(0.05, dc - ext), bb = Math.max(a + 1e-4, dc + ext);
      const w = spec.at === 'near' ? 0 : spec.at === 'far' ? 1 : typeof spec.at === 'number' ? spec.at : 0.5;
      return { depth: 1 / ((1 - w) / a + w / bb), range: [a, bb] };
    }
    if (spec.point) return { depth: dot(sub(spec.point, pos), dir) + (spec.extra || 0) };
    throw new Error(`camera: bad focus spec in ${s.id}`);
  }

  /** full camera evaluation; returns the core state plus diagnostics */
  function evaluate(s, t) {
    const sp = s.spec, mm = m(t);
    const u = (t - s.ma) / Math.max(1e-6, s.mb - s.ma);
    const p = s.prof.s(u);
    // position (rig frame)
    let pos;
    if (sp.cam.orbit) {
      const o = sp.cam.orbit, a = pair(o.a), d = pair(o.d), h = pair(o.h);
      pos = orbitPos(s.pivot, lerp(a[0], a[1], p), lerp(d[0], d[1], p), lerp(h[0], h[1], p));
    } else pos = s.path.at(p);
    if (sp.follow) {
      const hp = hands.at(sp.follow.hand, mm), h0 = s.handRef[sp.follow.hand], g = sp.follow.gain;
      pos = add(pos, [(hp[0] - h0[0]) * g[0], (hp[1] - h0[1]) * g[1], (hp[2] - h0[2]) * g[2]]);
    }
    // look target
    const L = sp.look || {};
    let target = isPt(L.at) ? L.at.slice() : lerp3(L.at[0], L.at[1], p);
    if (L.track) {
      const hp = add(hands.at(L.track.hand, mm), L.track.offset || [0, 0, 0]);
      const w = Array.isArray(L.track.w) ? lerp(L.track.w[0], L.track.w[1], p) : (L.track.w ?? 1);   // [w0, w1]: hand-over along the move
      target = lerp3(target, hp, w);
    }
    // operator noise (floating / handheld): small rotations about the camera, sub-mm-to-cm translation
    let roll = Array.isArray(sp.roll) ? lerp(sp.roll[0], sp.roll[1], p) : (sp.roll || 0);
    let dist = len(sub(target, pos));
    let dir = norm(sub(target, pos));
    if (sp.noise) {
      const N = sp.noise, seed = N.seed ?? (s.i * 7919 + 13), f = N.freq ?? 0.25, r = N.rough ?? 0.3, rot = N.rot || [0, 0, 0];
      const right = norm(cross(dir, UP));
      dir = rotY(dir, rot[0] * smoothNoise(seed, 0, t, f, r));
      dir = norm(rotAxis(dir, right, rot[1] * smoothNoise(seed, 1, t, f, r)));
      roll += rot[2] * smoothNoise(seed, 2, t, f * 0.8, r);
      if (N.pos) pos = add(pos, [N.pos * smoothNoise(seed, 3, t, f, r), N.pos * 0.6 * smoothNoise(seed, 4, t, f, r), N.pos * smoothNoise(seed, 5, t, f, r)]);
      target = add(pos, mul(dir, dist));
    }
    // lens
    const mmPair = pair(sp.lens.mm), fsPair = pair(sp.lens.fStop ?? 4);
    const focalMm = Math.exp(lerp(Math.log(mmPair[0]), Math.log(mmPair[1]), p));
    const fStop = lerp(fsPair[0], fsPair[1], p);
    // focus: base, then pulls in order (each blends from the focus before it, in diopters)
    let fd = focusPoint(sp.focus?.on, s, t, pos, target, dir).depth;
    let focusOn = sp.focus?.on ?? 'look';
    for (const pl of s.pulls) {
      if (t <= pl.t - 1e-9) break;
      const nd = focusPoint(pl.on, s, t, pos, target, dir).depth;
      const k = (t - pl.t) / Math.max(1e-6, pl.dur ?? 0.8);
      fd = k >= 1 ? nd : pullFocus(Math.max(0.05, fd), Math.max(0.05, nd), k);
      focusOn = pl.on;
    }
    return {
      posRig: pos, targetRig: target, rollDeg: roll, focalMm, fStop, focusDist: Math.max(0.05, fd),
      near: sp.lens.near ?? 0.05, far: 60000, space: 'rig',
      _diag: { u, p, v: s.prof.v(u) / Math.max(1e-6, s.mb - s.ma), alpha: alphaOf(pos), focusOn },
    };
  }

  // ---------------------------------------------------------------------------------------------- core API
  /** shotAt(t) for the core's CameraDirector: shot settings for the frame (sun and fades are per-frame values) */
  function shotAt(t) {
    const s = findShot(t);
    const ev = fadeAt(t);
    const out = {
      _i: s.i, id: s.id, t0: s.t0, t1: s.t1, ref: s.spec.ref ?? null, name: s.spec.name,
      ...s.settings, sunElevationDeg: +sunAt(t).toFixed(5),
    };
    const g = s.spec.grade && typeof s.spec.grade === 'object' ? { ...s.spec.grade } : null;
    if (ev !== 0 || g) out.grade = { ...(g || {}), exposureEV: (g?.exposureEV || 0) + ev };
    else if (typeof s.spec.grade === 'string') out.grade = s.spec.grade;
    return out;
  }
  /** cameraAt(t, shotRaw): the camera state at any (sub-frame) time, for the shot active at the frame centre */
  function cameraAt(t, raw) {
    const s = raw && raw._i != null ? shots[raw._i] : findShot(t);
    const st = evaluate(s, t);
    delete st._diag;
    return st;
  }

  /** DESIGN.md section 4 view of the edit (camera keys sampled at 4 Hz; the live path is cameraAt) */
  const SHOTS = shots.map((s) => {
    const keys = [];
    const n = Math.max(2, Math.ceil((s.t1 - s.t0) * 4) + 1);
    for (let k = 0; k < n; k++) {
      const t = s.t0 + (s.t1 - s.t0) * k / (n - 1);
      const e = evaluate(s, t);
      keys.push({ t: +t.toFixed(4), posRig: e.posRig.map((v) => +v.toFixed(4)), targetRig: e.targetRig.map((v) => +v.toFixed(4)), focalMm: +e.focalMm.toFixed(3), focusDist: +e.focusDist.toFixed(4), fStop: +e.fStop.toFixed(3), rollDeg: +e.rollDeg.toFixed(3) });
    }
    return {
      _i: s.i, id: s.id, name: s.spec.name, t0: s.t0, t1: s.t1, ref: s.spec.ref ?? null, rigYawCheatDeg: s.settings.rigYawCheatDeg,
      camera: keys, easing: 'linear', N: s.settings.N, dofPreblur: s.settings.preblur, nearestDist: s.settings.nearestDist,
      shutter: s.settings.shutter,
    };
  });

  return {
    timeline: tl, hands, shots, SHOTS, filmEnd, FILM_FRAMES,
    shotAt, cameraAt, evaluate: (t, s = findShot(t)) => evaluate(s, t), findShot,
    sunAt, sunKeys, sunDenseKeys, fadeAt,
  };
}
