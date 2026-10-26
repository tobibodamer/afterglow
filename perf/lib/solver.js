// The performance solver: score + rig + piano layout -> per-sample skeleton, keys, hammers, dampers, pedals, ripples.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Rig } from './rig.js';
import { GLB } from './glb.js';
import { HandModel, contactPip, THUMB_PREF, ADDUCT, THUMB_MCP_MIN, THUMB_IP_MIN } from './hand.js';
import { ArmModel } from './arm.js';
import { handFeatures, wristAngles, elbowPos, bestSwivel } from './palm.js';
import { HandPlanner, resolveFingerTiming, releaseForReach, releaseForTravel, planRestrikes, T_UP_AFTER_REL0, rel0Of, UNCOVERED_EARLY } from './plan.js';
import { spanLimits } from './fingering.js';
import { smoothPalmPath } from './trajectory.js';
import { FingerAnimator, touchT, upT } from './fingers.js';
import { KeyTracks } from './keys.js';
import { BodyMotion, bodyLocals, springFilter } from './body.js';
import { fingerHand } from './fingering.js';
import { noteTiming, MUSIC_OFFSET, RATE, ccStep, damperLiftCurve } from './timing.js';
import { KEYS, keyPointP, keyNormalP, keyTopYAtP, penetrationP, LAYOUT, LAYOUT_MODULE, contactBox } from './pianoGeo.js';
import { hammerAngle } from './keys.js';
const LAYOUT_PIV_Z = LAYOUT_MODULE.BALANCE_AXIS.z - LAYOUT_MODULE.KEY_FRONT_Z;
import { qMul, qConj, qRot, qLog, qExp, qAxisAngle, add, sub, scale, dot, len, norm, DEG, clamp, smoothstep, minjerk, solveLin, bodyNoise, lerp3 } from './math.js';
import { dipRatioFor } from './fingers.js';
import { LegModel } from './legs.js';
import { buildCollisionSets, fingerPenetration, palmPenetration, freeLift, buildCapsules, fingerCapsules, capsuleOverlap, segSegClosest } from './collide.js';
import { makeRipples } from './ripples.js';

export const OUTPUT_BONES = [
  'root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head',
  ...['R', 'L'].flatMap((s) => ['clavicle', 'shoulder01', 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist',
    'metacarpal1', 'metacarpal2', 'metacarpal3', 'metacarpal4',
    'finger1-1', 'finger1-2', 'finger1-3', 'finger2-1', 'finger2-2', 'finger2-3', 'finger3-1', 'finger3-2', 'finger3-3',
    'finger4-1', 'finger4-2', 'finger4-3', 'finger5-1', 'finger5-2', 'finger5-3',
    'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot'].map((b) => `${b}_${s}`)),
];

export async function solve(opts) {
  const log = opts.log || console.log; const T0 = Date.now();
  const score = JSON.parse(fs.readFileSync(opts.score, 'utf8'));
  const rig = Rig.load(opts.rig);
  const glb = await GLB.load(opts.glb); const mesh = glb.skinnedMesh('Pianist_body');
  // sanity: the GLB bind skeleton must be the rig.json skeleton
  { let worst = 0; for (const j of rig.joints) { const ni = glb.json.nodes.findIndex((n) => n.name === j.name); if (ni < 0) continue; const M = glb.nodeMatrix(ni); worst = Math.max(worst, Math.hypot(M[12] - j.worldPos[0], M[13] - j.worldPos[1], M[14] - j.worldPos[2])); } log(`[solve] GLB joints vs rig.json world_pos: max ${(worst * 1000).toFixed(3)} mm`); if (worst > 0.001) throw new Error('rig.json does not match the GLB skeleton'); }
  let shoes = null; try { shoes = glb.skinnedMesh('Pianist_shoes04'); } catch { shoes = null; }
  const hands = { R: new HandModel(rig, 'R', mesh), L: new HandModel(rig, 'L', mesh) };
  buildCollisionSets(hands.R); buildCollisionSets(hands.L); buildCapsules(hands.R); buildCapsules(hands.L);
  const arms = { R: new ArmModel(rig, 'R'), L: new ArmModel(rig, 'L') };
  log(`[solve] score ${opts.score}: ${score.notes.length} notes, duration ${score.duration}; rig ${rig.n} joints`);

  // ------------------------------------------------------------------ notes, touch, timing
  const notes = score.notes.map((n) => ({ ...n }));
  const byHand = { R: notes.filter((n) => n.hand === 'R'), L: notes.filter((n) => n.hand === 'L') };
  for (const h of ['R', 'L']) {
    const hs = byHand[h].slice().sort((a, b) => a.t_on - b.t_on);
    for (const n of hs) {
      const chord = hs.filter((m) => Math.abs(m.t_on - n.t_on) < 0.03);
      const before = hs.filter((m) => m.t_on < n.t_on - 0.03); const lastOff = before.length ? Math.max(...before.map((m) => m.t_off)) : -9;
      const detached = n.t_on - lastOff > 0.25;
      const touch = n.vel > 95 || (chord.length >= 3 && n.vel >= 85 && detached) ? 'struck' : 'pressed';
      n.tm = noteTiming(n, touch);
    }
    // leap arrivals: a group the hand must leap to, with too little time between the previous group's key bottom and
    // a pressed contact, is played from the air (struck: the finger arrives moving, the key travel is ~35 ms shorter)
    const groups = []; for (const n of hs) { const g = groups[groups.length - 1]; if (g && n.t_on - g.t_on <= 0.03) g.notes.push(n); else groups.push({ t_on: n.t_on, notes: [n] }); }
    for (let gi = 1; gi < groups.length; gi++) {
      const g = groups[gi], pg = groups[gi - 1];
      const xk = (n) => KEYS[clamp(n.pitch - 21, 0, 87)].xCenter;
      const xs = g.notes.map(xk), ps = pg.notes.map(xk);
      const d = Math.max(...xs, ...ps) - Math.min(...xs, ...ps) - 0.13; if (d <= 0.02) continue;
      const tNeed = 0.06 + 0.45 * d; const leave = Math.max(...pg.notes.map((n) => n.tm.tKb)) + 0.032;
      const T = Math.min(...g.notes.map((n) => n.tm.tFk));
      if (T - leave >= tNeed) continue;
      for (const n of g.notes) if (n.tm.touch !== 'struck') { n.tm = noteTiming(n, 'struck'); n.leapStruck = true; }
    }
  }
  log(`[solve] leap landings played from the air (struck touch for lack of travel time): ${notes.filter((n) => n.leapStruck).length} notes`);
  // fix round 3: the designed release (t_off - 25 ms) before any release pass; every early-release bound refers to it
  for (const n of notes) n.tRel0Orig = n.tm.tRel0;
  // ------------------------------------------------------------------ fingering
  const pedalDown = (t) => ccStep(score.pedal || [], t) >= 64 / 127;
  // the sustain pedal holds the dampers up over the whole interval [a, b] (a key let go early there is inaudible).
  // Fix round 1: judged with the SAMPLER's damper model (half-pedal zone CC 32-76, 70 ms slew; timing.js), lift >= 0.99
  // over the interval, not CC64 >= 64 at one instant (CC 64 is only ~80 % lift in the sampler)
  const LIFT_T0 = -MUSIC_OFFSET, LIFT_DT = 1 / RATE; const liftN = Math.ceil((Math.max(...notes.map((n) => n.t_off)) + 12 - LIFT_T0) / LIFT_DT);
  const liftG = damperLiftCurve(score.pedal || [], LIFT_T0, LIFT_DT, liftN);
  const pedalCovers = (a, b) => { const i0 = Math.max(0, Math.floor((a - LIFT_T0) / LIFT_DT)), i1 = Math.min(liftN - 1, Math.ceil((b - LIFT_T0) / LIFT_DT)); for (let i = i0; i <= i1; i++) if (liftG[i] < 0.99) return false; return true; };
  const fingering = {};
  for (const h of ['R', 'L']) {
    const r = fingerHand(byHand[h], h, { pedalDown, mode: opts.fingering || 'composer' });
    for (const n of byHand[h]) n.f = r.finger.get(n.id);
    fingering[h] = { changed: r.changed, composerIssues: r.composerIssues.length, finalIssues: r.finalIssues, earlyRelease: r.earlyRelease.size, relaxed: r.relaxed.size };
    for (const [id, t] of r.earlyRelease) { const n = byHand[h].find((x) => x.id === id); if (n && n.tm.tRel0 > t - 0.06) { n.tm.tRel0 = Math.max(n.tm.tKb + 0.01, t - 0.06); n.relWhy = 'fingering'; } }
    log(`[solve] fingering ${h}: composer issues ${r.composerIssues.length}, changed ${r.changed.length}, final issues ${r.finalIssues.length}, early releases ${r.earlyRelease.size}`);
  }
  const reach = [];
  for (const h of ['R', 'L']) reach.push(...releaseForReach(byHand[h], h, pedalDown, spanLimits, pedalCovers));
  log(`[solve] reach releases (held key let go early so the hand can shift): ${reach.length} (${reach.filter((r) => !r.pedal).length} without pedal)`);
  const travel = []; for (const h of ['R', 'L']) travel.push(...releaseForTravel(byHand[h], h, pedalCovers));
  log(`[solve] travel releases (key let go early so the hand can make a leap): ${travel.length} (${travel.filter((r) => !r.covered).length} capped at 15 ms before the designed release outside full damper lift, max ${travel.length ? Math.round(Math.max(...travel.map((r) => r.early)) * 1000) : 0} ms early)`);
  const restrikes = planRestrikes(notes, pedalCovers);
  log(`[solve] repeated notes: ${restrikes.length} releases moved so the key rises before the re-strike (${restrikes.filter((r) => !r.covered).length} limited to 15 ms without full damper lift)`);
  const conflicts = resolveFingerTiming(notes);
  log(`[solve] same-finger timing conflicts (key released early): ${conflicts.length}`);
  // critic round 2 (critical, S02 m 6.825: LH G1 -> F3/Bb3 287 mm in ~100 ms, 6.2 m/s): a soft leap landing kept its
  // long pp key descent (struck lead 92 ms at vel 30), so the flight got only what was left between the bass release
  // (bounded by the damper rule) and that early key contact. For a leap whose flight time is short, the landing notes
  // (and the rest of a rolled landing within 0.12 s) take a shorter key descent, down to 40 ms before the hammer, so the
  // hand gets the time; the pivot during the bass hold (plan.js planPivots) does the rest.
  { let nl = 0; let worst = 0; const leaveOf = (n) => n.tLeave ?? n.tm.tRel0 + (n.quickLift ? 0.02 : T_UP_AFTER_REL0);
    for (const h of ['R', 'L']) {
      const hs = byHand[h].slice().sort((a, b) => a.t_on - b.t_on);
      const groups = []; for (const n of hs) { const g = groups[groups.length - 1]; if (g && n.t_on - g.t_on <= 0.03) g.notes.push(n); else groups.push({ t_on: n.t_on, notes: [n] }); }
      const xk = (n) => KEYS[clamp(n.pitch - 21, 0, 87)].xCenter;
      for (let gi = 1; gi < groups.length; gi++) {
        const g = groups[gi]; const T = Math.min(...g.notes.map((n) => n.tm.tFk));
        const xs = g.notes.map(xk); const xLo = Math.min(...xs), xHi = Math.max(...xs);
        let d = 0, leave = -1e9;
        for (const n of hs) { if (n.t_on >= g.t_on - 0.03) break; const lv = leaveOf(n); if (lv < T - 0.5 || lv > T + 0.03) continue;
          const x = xk(n); const de = (x < xLo ? xLo - x : x > xHi ? x - xHi : 0) - 0.09; if (de > d) d = de; leave = Math.max(leave, lv); }
        if (d < 0.10) continue;
        const tNeed = 0.09 + 0.45 * d; const want = tNeed - (T - leave); if (want <= 0.002) continue;
        let used = 0;
        for (const m of hs) { if (m.t_on < g.t_on - 1e-6) continue; if (m.t_on > g.t_on + 0.12) break;
          const lead = m.t_on - m.tm.tFk; const nlead = Math.max(0.040, lead - want); if (nlead >= lead - 1e-4) continue;
          m.tm = { ...m.tm, tFk: m.t_on - nlead, touch: 'struck' }; if (m.tm.tKb < m.tm.tFk + 0.012) m.tm.tKb = m.tm.tFk + 0.012;
          m.leapLead = true; nl++; used = Math.max(used, lead - nlead); }
        worst = Math.max(worst, want - used);
      }
    }
    log(`[solve] leap landings with a shorter key descent (flight time): ${nl} notes; worst remaining shortfall ${Math.round(worst * 1000)} ms`); }
  if (opts.debugSameFinger) for (const c of conflicts) { const n = notes.find((x) => x.id === c.id); const nx = notes.filter((x) => x.hand === n.hand && x.f === n.f && x.tm.tFk > n.tm.tFk + 1e-6).sort((a, b) => a.tm.tFk - b.tm.tFk)[0]; log(`[dbg-sf] id ${n.id} ${n.hand}${n.f} p${n.pitch} tFk ${n.tm.tFk.toFixed(3)} rel ${n.tm.tRel0.toFixed(3)} orig ${n.tRel0Orig.toFixed(3)} early ${(c.early * 1000).toFixed(0)} ms -> next ${nx ? nx.id + ' p' + nx.pitch + ' tFk ' + nx.tm.tFk.toFixed(3) : '-'}`); }

  // ------------------------------------------------------------------ time grid
  const lastEnd = Math.max(...notes.map((n) => n.t_off)), lastPed = (score.pedal || []).length ? score.pedal[score.pedal.length - 1][0] : 0;
  const mEnd = Math.max(lastEnd, lastPed) + (opts.tail ?? 6.0);
  const t0 = -MUSIC_OFFSET, dt = 1 / RATE; const N = Math.floor((mEnd - t0) * RATE) + 1;
  const range = opts.range ? [Math.max(0, Math.floor((opts.range[0] - t0) * RATE)), Math.min(N - 1, Math.ceil((opts.range[1] - t0) * RATE))] : [0, N - 1];
  log(`[solve] grid ${N} samples (${(N / RATE).toFixed(1)} s) at ${RATE} Hz from m = ${t0}${opts.range ? `; solving range ${opts.range}` : ''}`);

  // ------------------------------------------------------------------ bind features
  const bind = {};
  for (const s of ['R', 'L']) {
    const H = hands[s]; const palm = { q: rig.bindWQ[H.iWrist], p: rig.bindWP[H.iWrist] }; const feat = handFeatures(H, palm);
    const A = arms[s]; const fdir = norm(sub(A.W0, A.E0)); const wa = wristAngles(feat, fdir);
    let bestSw = 0, bd = 1e9; for (let sw = -90; sw <= 90; sw += 0.25) { const e = elbowPos(A.S0, A.W0, A.L1, A.L2, sw * DEG, H.lat); const d = len(sub(e, A.E0)); if (d < bd) { bd = d; bestSw = sw; } }
    bind[s] = { pitch0: feat.pitch / DEG, yaw0: feat.yawIn / DEG, ext0: wa.ext / DEG, uln0: wa.uln / DEG, L1: A.L1, L2: A.L2, swivel: bestSw, S: A.S0, W: A.W0 };
  }
  const swivelFor = (s) => (p) => {
    const B = bind[s]; const lat = hands[s].lat;
    const dOut = (p[0] - B.S[0]) * lat, dOut0 = (B.W[0] - B.S[0]) * lat;
    const fwd = p[2] - B.W[2];
    return clamp(B.swivel + 0.55 * (dOut - dOut0) * 100 + 0.25 * fwd * 100, 18, 62) * DEG;
  };

  // ------------------------------------------------------------------ body (register from the notes, not the plan)
  const xOfPitch = (p) => KEYS[clamp(Math.round(p) - 21, 0, 87)].xCenter;
  const regCache = { R: [], L: [] };
  const xCentroid = (h, t) => {
    const hs = byHand[h]; let w = 0, s = 0;
    for (const n of hs) { const d = n.t_on - t; if (d < -3 || d > 3) continue; const g = Math.exp(-0.5 * (d / 1.0) ** 2); w += g; s += g * xOfPitch(n.pitch); }
    return w > 1e-3 ? s / w + (h === 'R' ? -0.02 : 0.02) : (h === 'R' ? -0.15 : 0.15);
  };
  const xMid0 = 0.5 * (bind.R.W[0] + bind.L.W[0]);
  const body = new BodyMotion(score, { t0, dt, n: N }, { xCentroid, xMid0 });
  const bodyLocalAt = (i, protract) => bodyLocals(rig, body.at(i), protract);
  const shoulderAt = (s) => (t) => {
    const i = clamp(Math.round((t - t0) / dt), 0, N - 1); const loc = bodyLocalAt(i, {});
    const fk = rig.fk(loc); return fk.p[rig.idx(`upperarm01_${s}`)];
  };
  log(`[solve] body motion ready (${((Date.now() - T0) / 1000).toFixed(1)} s)`);

  // ------------------------------------------------------------------ planners
  const planners = {};
  // planning window: with --range only the notes near it are planned (fast iteration); the full run plans everything
  const win = opts.range ? [opts.range[0] - 4, opts.range[1] + 2] : null;
  const planNotes = {}; for (const s of ['R', 'L']) planNotes[s] = win ? byHand[s].filter((n) => n.t_on >= win[0] && n.t_on <= win[1]) : byHand[s];
  // keyframe cache: keyed by the inputs and the planner source code (automatic invalidation)
  const libDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const hash = crypto.createHash('sha256');
  for (const f of [opts.score, opts.rig]) hash.update(fs.readFileSync(f));
  for (const f of ['plan.js', 'palm.js', 'hand.js', 'fingering.js', 'timing.js', 'body.js', 'pianoGeo.js', 'collide.js']) hash.update(fs.readFileSync(path.join(libDir, f)));
  // the keyframe solve uses only dipRatioFor from fingers.js (the per-sample finger paths do not affect the keyframes)
  hash.update(dipRatioFor.toString());
  hash.update(String(fs.statSync(opts.glb).size)); hash.update(opts.fingering || 'composer'); hash.update(JSON.stringify(win));
  // critic round 2: the note timing the keyframes are planned on is computed here in solver.js (leap leads, releases), so
  // it is part of the key (a solver.js timing change used to hit a stale cache)
  hash.update(JSON.stringify(notes.map((n) => [n.id, n.f, Math.round(n.tm.tFk * 1e5), Math.round(n.tm.tRel0 * 1e5), Math.round((n.tLeave ?? 0) * 1e5)])));
  const cacheKey = hash.digest('hex').slice(0, 24);
  const cacheFile = opts.kfCache ? path.join(opts.kfCache, `kf_${cacheKey}.json`) : null;
  let cached = null; if (cacheFile && fs.existsSync(cacheFile)) { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); log(`[solve] keyframes from cache ${cacheFile}`); }
  // rest pose on the thigh after the final release (fix round 1): wrist ~62 % of the way from hip to knee, above the
  // thigh top, palm down, fingers turned in a little toward the knees' midline
  const lapPose = (s) => {
    const hip = rig.bindWP[rig.idx(`upperleg01_${s}`)], knee = rig.bindWP[rig.idx(`lowerleg01_${s}`)]; const lat = hands[s].lat;
    const p = add(add(hip, scale(sub(knee, hip), 0.62)), [-lat * 0.012, 0.095, 0]);
    return { p, q: qMul(qAxisAngle([0, 1, 0], -lat * 12 * DEG), qMul(qAxisAngle([1, 0, 0], -4 * DEG), rig.bindWQ[hands[s].iWrist])) };
  };
  for (const s of ['R', 'L']) {
    const P = new HandPlanner(hands[s], s, planNotes[s], { bind: bind[s], shoulderAt: shoulderAt(s), swivelFor: swivelFor(s), pedalCovers, lap: opts.range ? null : lapPose(s) });
    const tk = Date.now();
    if (cached) {
      P.kf = cached[s].kf; P.kf1 = P.kf; P.adaptive = cached[s].adaptive || [];
      for (const n of planNotes[s]) { n.P0 = cached[s].P0[n.id]; const rel = cached[s].rel && cached[s].rel[n.id]; if (rel !== undefined) { n.tm.tRel0 = rel; n.tUp = Math.min(n.tUp, rel + 0.02); n.adaptRel = rel; } }
    } else P.solveKeyframes();
    if (P.adaptive.length) log(`[solve] ${s}: ${P.adaptive.length} held keys let go early under the pedal to relieve a strained hand`);
    if (P.rescueLog && P.rescueLog.length) { const rl = P.rescueLog; log(`[solve] ${s}: reach-limited keyframes re-solved from a fan of starts: ${rl.length} (max contact error ${(Math.max(...rl.map((x) => x.before)) * 1000).toFixed(1)} -> ${(Math.max(...rl.map((x) => x.after)) * 1000).toFixed(1)} mm; ${rl.filter((x) => x.free).length} without the neighbour terms)`); for (const x of rl) if (x.before - x.after > 0.002) log(`[solve]   ${s} kf T ${x.T.toFixed(3)} pass ${x.pass}: ${(x.before * 1000).toFixed(1)} -> ${(x.after * 1000).toFixed(1)} mm${x.free ? " (no neighbour terms)" : ""}`); }
    P.buildTrajectory({ tStart: t0, tEnd: mEnd, phrases: score.phrases });
    const bad = P.kf.filter((k) => Object.values(k.sol).some((x) => x.err > 0.0005));
    if (P.lateArrivals) log(`[solve] ${s}: ${P.lateArrivals} transfers wait for the last finger to leave its key (hand arrives up to ${Math.round(Math.max(0, P.lateMax) * 1000)} ms after the landing key starts)`);
    log(`[solve] ${s}: ${P.kf.length} keyframes in ${((Date.now() - tk) / 1000).toFixed(1)} s; keyframes with an unreachable contact (>0.5 mm): ${bad.length}`);
    planners[s] = P;
  }
  // late landings (fix round 1): where the hand had to wait for a finger to leave its key and arrives after the landing
  // key would start, the landing notes are played from the air (struck: the key travel is ~35 ms shorter)
  // fix round 1b (QC of run f1h: unbounded late arrivals, up to 89 ms, left the landing finger 19 mm above a key that was
  // already at its bottom; 7 notes off key): the hand may arrive late only by what the struck stroke buys (the struck key
  // starts moving ttPress - ttStruck <= 35 ms later), with 10 ms to spare for the finger's own descent. A later arrival is
  // clamped and the hand leaves earlier instead: the finger that has not yet left its key is held on it by the per-sample IK
  // and the contact-preserving palm nudge, and lifts with the key (free-finger clearance keeps it out of the keys).
  const transitRel = []; let transitWait = 0;
  { let nc = 0, worst = 0; for (const s of ['R', 'L']) { const kf = planners[s].kf; const byId = new Map(planNotes[s].map((n) => [n.id, n]));
      for (let k = 1; k < kf.length; k++) { const b = kf[k]; if (b.late === undefined) continue;
        let slack = Infinity; for (const c of b.contacts) if (!c.fixed) { const n = byId.get(c.id); if (!n) continue; const sl = n.tm.touch === 'pressed' ? noteTiming(n, 'struck').tFk - noteTiming(n, 'pressed').tFk : 0; slack = Math.min(slack, sl); }
        if (!Number.isFinite(slack)) slack = 0;
        const lMax = Math.max(-0.004, slack - 0.010);
        if (b.late > lMax + 1e-6) { worst = Math.max(worst, b.late - lMax); const a = kf[k - 1]; b.A = b.T + lMax; b.late = lMax;
          const need = clamp(0.05 + 0.25 * (a.moveD || 0), 0.06, 0.2); a.D = Math.max(a.A + 0.001, Math.min(a.D, b.A - need));
          // never before the keys the hand leaves have reached their bottom (QC f1i: id418 G3, a 95 ms staccato before a
          // leap, was left 30 ms before its key bottom and read 20 mm above its key): the transit gets faster instead
          // (>= 35 ms; only past that does the landing come later)
          const nextIds = new Set(b.contacts.map((c) => c.id)); let kbMax = -1e9;
          for (const c of a.contacts) if (!nextIds.has(c.id)) { const n = byId.get(c.id); if (n) kbMax = Math.max(kbMax, n.tm.tKb); }
          if (a.D < kbMax - 0.005) { a.D = kbMax - 0.005; if (b.A < a.D + 0.035) { b.A = a.D + 0.035; b.late = b.A - b.T; } }
          nc++; }
        if (b.late <= -0.004 + 1e-6) delete b.late; }
      // fix round 3 (critic f2c: 19 fully depressed keys were held down by nothing, the finger 7-16 mm above them or gone
      // 35-90 ms before the key rose): for EVERY transfer, the keys the hand leaves come up WITH the finger. Where the damper
      // rule allows it (full lift over the rest of the note, or <= 15 ms before the designed release) the key starts rising
      // 10 ms before the hand departs and the finger rides it ~20 ms; otherwise the departure waits for the key (the
      // transit gets faster, >= 60 % of its planned time and >= 35 ms)
      for (let k = 1; k < kf.length; k++) { const a = kf[k - 1], b = kf[k]; const nextIds = new Set(b.contacts.map((c) => c.id)); const tr0 = Math.max(0.035, b.A - a.D);
        for (const c of a.contacts) { if (nextIds.has(c.id)) continue; const n = byId.get(c.id); if (!n || n.tm.tRel0 <= a.D - 0.005 || n.tm.tKb > a.D + 0.2) continue;
          const want = Math.max(n.tm.tKb + 0.012, a.D - 0.010);
          if (want < n.tm.tRel0 && (want >= rel0Of(n) - UNCOVERED_EARLY || pedalCovers(want, n.t_off))) {
            n.tm.tRel0 = want; n.tUp = Math.min(n.tUp ?? want + 0.06, want + 0.022); n.quickLift = true; n.relWhy = 'transit'; transitRel.push(n.id); }
          else { const dMax = b.A - Math.max(0.035, 0.6 * tr0); const dWant = Math.min(n.tm.tRel0 + 0.008, dMax); if (dWant > a.D) { a.D = dWant; transitWait++; } } } } }
    log(`[solve] late arrivals bounded by the struck-stroke slack: ${nc} transfers clamped (hand leaves up to ${Math.round(worst * 1000)} ms earlier instead); keys released with the departing finger: ${transitRel.length}; departures that wait for an uncovered key: ${transitWait}`); }
  // critic round 2: leap pivots from the final arrival/departure times (plan.js planPivots)
  for (const s of ['R', 'L']) { planners[s].planPivots(); const pv = planners[s].kf.filter((k) => k.pivot); log(`[solve] ${s}: leaps led by a pivot about the held fingertip: ${pv.length} (turn max ${pv.length ? Math.max(...pv.map((k) => Math.abs(k.pivot.th) / DEG)).toFixed(1) : 0} deg)`); }
  { let n0 = 0; for (const s of ['R', 'L']) { const byId = new Map(planNotes[s].map((n) => [n.id, n])); for (const k of planners[s].kf) if (k.late !== undefined) for (const c of k.contacts) if (!c.fixed) { const n = byId.get(c.id); if (n && n.tm.touch === 'pressed') { const rel = n.tm.tRel0; n.tm = { ...noteTiming(n, 'struck'), tRel0: rel }; n.lateStruck = true; n0++; } } }
    log(`[solve] late landings played struck: ${n0} notes`); }
  // ------------------------------------------------------------------ keys (after planning: the planner may let a held
  // key go early under the pedal when the hand needs to stretch, planners[s].adaptiveReleases)
  const keyTracks = new KeyTracks(notes, score.pedal);
  const keyAngle = (i, t) => keyTracks.angle(i, t);
  // the key's actual stroke start (a re-strike waits for the key to rise): the finger's touch is timed from it
  { const byId = new Map(notes.map((n) => [n.id, n])); for (const S of keyTracks.strokes) for (const s of S) { const n = byId.get(s.id); if (n) n.tStart = s.tStart; } }
  const keyArrays = keyTracks.sample(t0, dt, N);
  // per-note thumb prior: the keyframe's own thumb solution (posture, pitch, roll), so the per-sample IK resolves the
  // thumb's redundancy exactly as the collision-checked keyframe did
  // (every keyframe in which the thumb holds the note contributes; between two of them the prior is blended with the
  // palm's own min-jerk transfer, so a held thumb follows the posture each collision-checked keyframe chose)
  const thumbSeq = { R: new Map(), L: new Map() };
  for (const s of ['R', 'L']) for (const k of planners[s].kf) for (const c of k.contacts) if (c.f === 1 && k.sol[1]) {
    const x = k.sol[1]; if (!thumbSeq[s].has(c.id)) thumbSeq[s].set(c.id, []);
    // cycle 2 fix round 2: the per-sample clamp floors of a held thumb follow its keyframe's own angles (a reach-limited
    // rescued chord may bend it below the global 14 / 10 deg floors: bar 22 id322, S08 id300)
    thumbSeq[s].get(c.id).push({ k, pref: { ...x.a, dpPitch: (x.dpPitch ?? 22) * DEG, sideDown: x.sideDown ?? 0.82, mcpMin: Math.min(THUMB_MCP_MIN, x.a.mcp - 2 * DEG), ipMin: Math.min(THUMB_IP_MIN, x.a.ip - 2 * DEG) } });
  }
  const thumbPrefAt = (s, id, t) => {
    const seq = thumbSeq[s].get(id); if (!seq) return null;
    let j = 0; while (j + 1 < seq.length && seq[j + 1].k.A <= t) j++;
    const a = seq[j], b = seq[j + 1]; if (!b || t <= a.k.D) return a.pref;
    const u = minjerk((t - a.k.D) / Math.max(1e-3, b.k.A - a.k.D)); const o = {};
    for (const key of Object.keys(a.pref)) o[key] = a.pref[key] + (b.pref[key] - a.pref[key]) * u;
    return o;
  };
  const thumbPref = { R: { get: (id) => thumbPrefAt('R', id, curT) }, L: { get: (id) => thumbPrefAt('L', id, curT) } };
  let curT = 0;
  // thumb pad correction (sphere centre -> actual lowest pad vertex on the contact point), from the note's own keyframe
  for (const s of ['R', 'L']) { const byId = new Map(planNotes[s].map((n) => [n.id, n])); for (const k of planners[s].kf) for (const c of k.contacts) if (c.f === 1 && !c.fixed && k.sol[1] && k.sol[1].corr) byId.get(c.id).padCorr = k.sol[1].corr; }
  if (cacheFile && !cached) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const dump = {}; for (const s of ['R', 'L']) dump[s] = { kf: planners[s].kf.map((k) => ({ ...k })), P0: Object.fromEntries(planNotes[s].map((n) => [n.id, n.P0])), rel: Object.fromEntries(planNotes[s].filter((n) => n.adaptRel !== undefined).map((n) => [n.id, n.adaptRel])), adaptive: planners[s].adaptive };
    fs.writeFileSync(cacheFile, JSON.stringify(dump)); log(`[solve] keyframes cached to ${cacheFile}`);
  }

  // ------------------------------------------------------------------ palm samples (with musical vertical offsets) + lag
  const palmS = {}, lagS = {};
  for (const s of ['R', 'L']) {
    const P = planners[s]; const ps = new Array(N), qs = new Array(N);
    const off = verticalOffsets(P, planNotes[s], t0, dt, N);
    // minimum-jerk path through the keyframe holds and transfers (trajectory.js), then the musical offsets on top
    const base = smoothPalmPath(P, planNotes[s], t0, dt, N);
    log(`[solve] ${s}: minimum-jerk palm path in ${base.iters} solves (${base.over} held samples still beyond the fingers' slack)`);
    for (let i = 0; i < N; i++) { ps[i] = add(base.p[i], [off.x[i], off.y[i], off.z[i]]); qs[i] = base.q[i]; }
    // light zero-phase smoothing of the offsets' onsets (the arm-weight dip starts with a corner)
    const sm = smoothPalm(ps, qs, P, t0, dt);
    // critic round 2: hand world-orientation rate cap (zero-phase, before the contact-preserving nudge)
    if (!opts.noOriCap) { const st = capPalmTurnRate(sm, range); log(`[solve] ${s}: palm turn-rate cap (${ORI_CAP_DEG} deg per 240 Hz sample): ${st.events} events, worst step ${st.worstBefore.toFixed(2)} -> ${st.worstAfter.toFixed(2)} deg`); }
    // fix round 3: per-note contact point moved off the neighbour keys (full skinned finger, sampled over the hold)
    if (!opts.noShift) { const st = shiftContactsOffNeighbours({ H: hands[s], notes: planNotes[s], sm, t0, dt, N, keyAngle, thumbPrefAt: (id, t) => thumbPrefAt(s, id, t) }); log(`[solve] ${s}: contact points moved off neighbour keys: ${st.moved} of ${st.tested} notes tested (neighbour depth sum ${(st.before * 1000).toFixed(1)} -> ${(st.after * 1000).toFixed(1)} mm, max ${(st.maxBefore * 1000).toFixed(2)} -> ${(st.maxAfter * 1000).toFixed(2)} mm)`); }
    // keys held through a transfer between two keyframes: nudge the palm so every finger on a key can stay on it
    const fixStats = contactPreservingPalm(hands[s], planNotes[s], sm, { t0, dt, range, keyAngle, keyArrays, thumbPrefAt: (id, t) => thumbPrefAt(s, id, t) });
    log(`[solve] ${s}: palm nudged at ${fixStats.nudged} samples to keep held fingers on their keys (max ${(fixStats.maxShift * 1000).toFixed(1)} mm, residual max ${(fixStats.maxResid * 1000).toFixed(2)} mm at ${fixStats.tResid.toFixed(2)}, max shift at ${fixStats.tMax.toFixed(2)})`);
    palmS[s] = sm;
  }
  // fix round 1 (critic: the resting RH thumb and the playing LH thumb passed through each other at m 82.7-83.1): a hand
  // with no finger on a key keeps >= 6 mm between its capsules and the other hand's, moving out and up smoothly
  { const st = separateHands({ hands, palmS, planners, notes: planNotes, t0, dt, N, range }); log(`[solve] hands kept apart: resting hand moved at ${st.moved} samples (max ${(st.max * 1000).toFixed(1)} mm); remaining overlap max ${(st.resid * 1000).toFixed(1)} mm`); }
  for (const s of ['R', 'L']) {
    const sm = palmS[s];
    // lagged copy for the free fingers (secondary motion, half-life 50 ms)
    const lx = springFilter(Float32Array.from(sm.p.map((p) => p[0])), dt, 0.05), ly = springFilter(Float32Array.from(sm.p.map((p) => p[1])), dt, 0.05), lz = springFilter(Float32Array.from(sm.p.map((p) => p[2])), dt, 0.05);
    const qref = sm.q[0]; const rv = sm.q.map((q) => qLog(qMul(q, qConj(qref))));
    const r0 = springFilter(Float32Array.from(rv.map((r) => r[0])), dt, 0.05), r1 = springFilter(Float32Array.from(rv.map((r) => r[1])), dt, 0.05), r2 = springFilter(Float32Array.from(rv.map((r) => r[2])), dt, 0.05);
    lagS[s] = { p: sm.p.map((_, i) => [lx[i], ly[i], lz[i]]), q: sm.q.map((_, i) => qMul(qExp([r0[i], r1[i], r2[i]]), qref)) };
  }

  // ------------------------------------------------------------------ elbow swivel per sample (forearm lined up with the
  // hand: palm.js bestSwivel), Gaussian-smoothed (sigma 60 ms) so the elbow never jitters
  const swivelS = {};
  for (const s of ['R', 'L']) {
    const raw = new Float64Array(N); const shoulder = shoulderAt(s); const sf = swivelFor(s); const B = bind[s];
    const i0 = Math.max(0, range[0] - 240), i1 = Math.min(N - 1, range[1] + 240);
    // the shoulder moves slowly (body motion): evaluate its FK every 8 samples and interpolate
    const shC = new Map(); const shAt = (j) => { if (!shC.has(j)) shC.set(j, shoulder(t0 + j * dt)); return shC.get(j); };
    for (let i = i0; i <= i1; i++) {
      const palm = { q: palmS[s].q[i], p: palmS[s].p[i] };
      const ja = i - (i % 8), jb = Math.min(N - 1, ja + 8); const u = (i - ja) / 8; const Sa = shAt(ja), Sb = shAt(jb);
      const S = [Sa[0] + (Sb[0] - Sa[0]) * u, Sa[1] + (Sb[1] - Sa[1]) * u, Sa[2] + (Sb[2] - Sa[2]) * u];
      raw[i] = bestSwivel(S, palm.p, B.L1, B.L2, hands[s].lat, handFeatures(hands[s], palm), sf(palm.p));
    }
    for (let i = 0; i < i0; i++) raw[i] = raw[i0]; for (let i = i1 + 1; i < N; i++) raw[i] = raw[i1];
    swivelS[s] = gaussSmooth(raw, 0.06 / dt);
  }
  log(`[solve] elbow swivel ready (${((Date.now() - T0) / 1000).toFixed(1)} s)`);

  // ------------------------------------------------------------------ legs / pedal foot
  const legs = new LegModel(rig, shoes);

  // ------------------------------------------------------------------ per-sample solve
  const animators = { R: new FingerAnimator(hands.R, planNotes.R, keyAngle), L: new FingerAnimator(hands.L, planNotes.L, keyAngle) };
  // clavicle protraction with lateral / forward reach, spring-filtered (half-life 80 ms): the shoulder girdle follows
  // the arm with a slight lag instead of snapping with every leap
  const protractS = {};
  for (const s of ['R', 'L']) {
    const raw = new Float32Array(N); const lat = hands[s].lat; const sg = s === 'R' ? 1 : -1;
    for (let i = 0; i < N; i++) { const p = palmS[s].p[i]; const dOut = (p[0] - bind[s].W[0]) * lat; raw[i] = (clamp(dOut * 100 * 0.25, -3, 4) + clamp((p[2] - bind[s].W[2]) * 100 * 0.3, -2, 3)) * sg; }
    protractS[s] = springFilter(raw, dt, 0.08);
  }
  const outIdx = OUTPUT_BONES.map((b) => rig.idx(b));
  const NB = outIdx.length;
  const boneData = new Float32Array(N * NB * 4);
  const rootPos = rig.joints[0].t;
  const rootAtI = (i) => [rootPos[0] + body.rootX[i], rootPos[1], rootPos[2]];
  const rootS = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const r = rootAtI(i); rootS[i * 3] = r[0]; rootS[i * 3 + 1] = r[1]; rootS[i * 3 + 2] = r[2]; }
  const warm = { R: {}, L: {} };
  // per-sample record of every finger's joint angles, mode and (contact) target for the joint-space smoothing pass
  const REC = {}; for (const s of ['R', 'L']) { REC[s] = {}; for (let f = 1; f <= 5; f++) REC[s][f] = { a: new Float32Array(N * 4), mode: new Uint8Array(N), key: new Int16Array(N).fill(-1), tgt: new Float32Array(N * 3), dip: new Float32Array(N), pipLo: new Float32Array(N) }; }
  const THUMB_FREE = { ...THUMB_PREF, mcp: 20 * DEG, ip: 26 * DEG, dpPitch: 18 * DEG, sideDown: 0.6 };   // fix round 2: mcp 14 -> 16; cycle 2: 20 / 26 (opposed, bent)
  const blendPref = (a, b, w) => { if (!a) return b; if (!b) return a; if (w <= 0) return a; if (w >= 1) return b; const o = {}; for (const k of Object.keys(b)) { const x = a[k] ?? b[k]; o[k] = x + (b[k] - x) * w; } return o; };
  const freeStats = { lifted: 0, pushed: 0 }; const handCaps = { R: null, L: null };
  const tLoop = Date.now();
  for (let i = range[0]; i <= range[1]; i++) {
    const t = t0 + i * dt; curT = t;
    const protract = {};
    for (const s of ['R', 'L']) protract['protract' + s] = protractS[s][i];
    const local = bodyLocalAt(i, protract);
    // fix round 1: the pelvis slides on the bench toward the register (body.rootX, <= 15 mm); the right foot stays on
    // the pedal (the leg IK starts from the slid hip)
    const rootI = rootAtI(i);
    legs.apply(local, keyArrays.travel[i], [rootI[0] - rootPos[0], 0, 0]);
    const fk = rig.fk(local, rootI); const Q = fk.q, Pp = fk.p;
    const ka = keyArrays.keys.subarray(i * 88, (i + 1) * 88);
    for (const s of ['R', 'L']) {
      const H = hands[s]; const palm = { q: palmS[s].q[i], p: palmS[s].p[i] }; const lag = { q: lagS[s].q[i], p: lagS[s].p[i] };
      arms[s].solve(local, Q, Pp, palm.p, palm.q, swivelS[s][i]);
      const lapW = planners[s].lapW(t);   // resting on the thigh after the final release: fingers relax flatter
      // relaxed pad centre carried by the hand, plus a little secondary lag (<= 4 mm) from the lagged palm copy
      // fix round 2: a resting finger is pulled sideways by its neighbours (juncturae tendinum): the free ring finger drapes
      // toward an abducted 5th in octaves instead of staying at the rest, the 5th follows the ring finger, etc.
      const W = warm[s]; const dev = (n) => (W[n] && W[n].abd !== undefined ? W[n].abd - ADDUCT[n] : 0);
      // + ordering: a resting finger never crosses its neighbours (abduction-space splay to each neighbour >= 3 deg; bind
      // splays 2-3 / 3-4 / 4-5 = 18.7 / 12.7 / 10.1 deg)
      const BS = [0, 0, 18.7 * DEG, 12.7 * DEG, 10.1 * DEG]; const abdOf = (n) => (W[n] && W[n].abd !== undefined ? W[n].abd : ADDUCT[n]);
      const abdDevOf = (f) => {
        let d = clamp(f === 2 ? 0.35 * dev(3) : f === 3 ? 0.3 * (dev(2) + dev(4)) : f === 4 ? 0.5 * dev(5) + 0.3 * dev(3) : f === 5 ? 0.45 * dev(4) : 0, -14 * DEG, 14 * DEG);
        if (f >= 2) { let a = ADDUCT[f] + d; const hi = f < 5 ? abdOf(f + 1) + BS[f] - 3 * DEG : Infinity, lo = f > 2 ? abdOf(f - 1) - BS[f - 1] + 3 * DEG : -Infinity;
          a = lo > hi ? 0.5 * (lo + hi) : clamp(a, lo, hi); d = a - ADDUCT[f]; }
        return d;
      };
      const hoverW = (f) => {
        const a = H.relaxed(f, 1 - 0.5 * lapW, t, abdDevOf(f)); const c = H.padCenter(f, H.fingerFK(f, palm, a)); const cl = H.padCenter(f, H.fingerFK(f, lag, a));
        const d = sub(cl, c); const l = len(d); return l > 0.004 ? add(c, scale(d, 0.004 / l)) : add(c, d);
      };
      const palmAt = (tt) => { const j = clamp(Math.round((tt - t0) / dt), 0, N - 1); return { q: palmS[s].q[j], p: palmS[s].p[j] }; };
      const mcpW = (f) => { const bb = H.baseOf(f, palm); return add(bb.p, qRot(bb.q, H.J[H.fj[f][0]].t)); };
      const env = { palm, palmAt, hoverW: null, contactsNow: null, mcpW };
      const contactsNow = [];
      const targets = {};
      for (let f = 1; f <= 5; f++) { env.hoverW = hoverW(f); targets[f] = animators[s].target(f, t, env); if (targets[f].mode === 'contact') contactsNow.push({ f, key: targets[f].note.key }); }
      env.contactsNow = contactsNow;
      // contact fingers first, then the free ones (each free finger keeps clear of the fingers already placed)
      const order = [1, 2, 3, 4, 5].sort((a, b) => (targets[a].mode === 'contact' ? 0 : 1) - (targets[b].mode === 'contact' ? 0 : 1) || a - b);
      // fix round 1: a free finger also keeps clear of the OTHER hand (its capsules from this sample for the LH, from the
      // previous sample for the RH): the resting RH thumb and the playing LH thumb passed through each other at m 82.8
      const placed = []; const other = handCaps[s === 'R' ? 'L' : 'R'];
      for (const f of order) {
        let tg = targets[f];
        if (tg.mode === 'free') { env.hoverW = hoverW(f); tg = animators[s].target(f, t, env); }
        let r;
        // free fingers keep a relaxed curl (no straight sticks, no claws): PIP bounded inside the IK
        // cycle 2: resting free fingers keep PIP >= 28 (g1d: a draped free index went straight, PIP at the 18 floor, into the
        // fallboard); within 0.1 s of a key (departure / approach) the old 18 deg floor applies
        const keyDist = tg.mode === 'free' ? Math.min(t - (tg.prev ? upT(tg.prev) : -1e9), (tg.next ? touchT(tg.next) : 1e9) - t) : 0;
        const pipB = tg.mode === 'free' ? [(18 + 10 * smoothstep(0.1, 0.2, keyDist)) * DEG, 85 * DEG] : contactPip(f);
        let tpref = null;
        if (f === 1) {
          if (tg.mode === 'contact') tpref = thumbPrefAt(s, tg.note.id, t) || null;
          else {
            // free thumb: posture prior blends from the last contact's, through a relaxed thumb, to the next contact's
            const u0 = tg.prev ? upT(tg.prev) : -1e9, u1 = tg.next ? touchT(tg.next) : 1e9;
            const pp = tg.prev ? thumbPrefAt(s, tg.prev.id, u0) : null, pn = tg.next ? thumbPrefAt(s, tg.next.id, u1) : null;
            tpref = blendPref(blendPref(pp, THUMB_FREE, smoothstep(u0, u0 + 0.12, t)), pn, smoothstep(u1 - 0.15, u1, t));
          }
        }
        // free fingers resting in the hover keep their abduction within +-12 deg (no sideways splay); in transfers and within
        // 0.1 s of a key they may use the full range (a cap there would make them miss their path and jump)
        const abdCap = tg.mode === 'free' && !(tg.dbg && tg.dbg.transfer) && Math.min(t - (tg.prev ? upT(tg.prev) : -1e9), (tg.next ? touchT(tg.next) : 1e9) - t) > 0.1 ? 12 * DEG : null;
        // a contact thumb that stalls > 1 mm short (a joint pinned at its floor) retries with the free thumb's active set
        const solveThumbC = (p, a0) => { const r1 = H.solveThumb(palm, p, a0, tpref); if (r1.err < 0.001) return r1; const r2 = H.solveThumb(palm, p, a0, tpref, true); return r2.err < 0.7 * r1.err ? r2 : r1; };
        const solveF = (p, a0) => (f === 1 ? (tg.mode === 'free' ? H.solveThumb(palm, p, a0, tpref, true) : solveThumbC(p, a0)) : H.solveFinger(f, palm, p, a0, tg.dipRatio, null, pipB, abdCap));
        r = solveF(tg.p, warm[s][f]);
        // cycle 2 (critic S14: a free finger hinged at the knuckle with the PIP open, 'pointing'; range r7a: the 22 mm drape
        // of a rolled LH made L4/L5 MCP 60 / PIP at its 18 deg floor): where the free target can only be reached hinged
        // (MCP > 40-55 with PIP < 34-26), it is blended back toward the relaxed, carried hover (continuous weight) and re-solved
        if (tg.mode === 'free' && f !== 1 && env.hoverW) {
          const wH = smoothstep(40 * DEG, 55 * DEG, r.a.mcp) * (1 - smoothstep(26 * DEG, 34 * DEG, r.a.pip));
          if (wH > 0.01) { tg = { ...tg, p: lerp3(tg.p, env.hoverW, wH) }; r = solveF(tg.p, r.a); freeStats.unhinged = (freeStats.unhinged || 0) + 1; }
        }
        if (tg.mode === 'contact') {
          // exact mesh contact: measure the skinned pad against the key plane and correct the target along the key normal
          // (2 iterations). Fix round 1: no on/off gates (they made 4 mm target jumps); the correction is continuous.
          for (let it = 0; it < 2; it++) {
            const e = padPlaneError(H, f, palm, r.a, tg.note, t, keyAngle) - (tg.lift || 0);
            if (Math.abs(e) < 0.00003) break;
            const n = keyNormalP(keyAngle(tg.note.key, t));
            tg = { ...tg, p: sub(tg.p, scale(n, clamp(e, -0.006, 0.006))) };
            r = solveF(tg.p, r.a);
          }
          // cycle 2 fix round 2 (bar 22 id322 G5 R5, debug r8l: reach-limited at its 17 deg PIP floor, err 1.8 mm through the
          // hold; a 2 mm palm rise at the start of the transfer grew it past the let-go rule 85 ms before tRel0 -> 18-22 mm
          // ghost key): a long finger whose contact is out of reach with the PIP at its floor may open the PIP up to 12 deg
          // below it (continuous in the error, so no pop), re-solved; kept only when it reaches closer
          if (f !== 1 && !process.env.PERF_NO_PIPRELAX && r.err > 0.0005 && r.a.pip < pipB[0] + 0.01) {
            const w = smoothstep(0.0005, 0.0025, r.err);
            if (w > 0) { const lo = Math.max(2 * DEG, pipB[0] - 12 * DEG * w); const r2 = H.solveFinger(f, palm, tg.p, r.a, tg.dipRatio, null, [lo, pipB[1]], abdCap); if (r2.err < r.err - 0.0001) { r = r2; r._pipLo = lo; freeStats.pipRelax = (freeStats.pipRelax || 0) + 1; } }
          }
          // fix round 1b (debug of L4 E3 at m 173.79): when the hand has already left for a leap and the held finger can no
          // longer reach its key near its release, the IK hooked it (MCP 88 deg) and dragged it 11 mm through the keys under
          // the hand. The finger lets go instead: from the next sample it follows its free path from here (the key rises on
          // its own track). Only from 250 ms before the key's release on, never during the attack or on a riding re-strike.
          // (the error must be growing: the hand is moving away, not a posture that misses the key by a few mm all along)
          // (3 consecutive growing samples above 3 mm, from 100 ms before the key's release on: range checks with 250 ms and a
          // single sample let thumbs go in mid-hold on a transient IK error)
          if (tg.note && tg.note._eT !== t) { const ep = tg.note._errPrev; tg.note._errPrev = r.err; tg.note._eT = t;
            const grow = r.err > 0.003 && ep !== undefined && r.err > ep + 0.0003; tg.note._grow = grow ? (tg.note._grow || 0) + 1 : 0;
            if (tg.note._grow >= 3 && !tg.riding && t > tg.note.tm.tKb + 0.03 && t > tg.note.tm.tRel0 - 0.10 && tg.note.tLetGo === undefined) { tg.note.tLetGo = t; freeStats.letGo = (freeStats.letGo || 0) + 1; } }
        } else {
          // fix round 1: free fingers clear the key bed with their whole skinned collision set (2 mm margin; not only the
          // pad sphere) and keep out of the fingers already placed (capsules): lift / push the target, re-solve
          const u0 = tg.prev ? upT(tg.prev) : -1e9, u1 = tg.next ? touchT(tg.next) : 1e9;
          const margin = 0.002 * Math.min(smoothstep(u0, u0 + 0.04, t), 1 - smoothstep(u1 - 0.05, u1 - 0.01, t));
          const ignore = tg.next && t > u1 - 0.06 ? tg.next.key : -1;
          for (let it = 0; it < 3; it++) {
            const fkF = H.fingerFK(f, palm, r.a);
            const lift = freeLift(H, f, palm, fkF, ka, margin, ignore);
            const myC = fingerCapsules(H, f, fkF); let ov = placed.length ? capsuleOverlap(myC, placed, 0.001) : { depth: 0 };
            if (other) { const o2 = capsuleOverlap(myC, other, 0.005, false); if (o2.depth > ov.depth) ov = o2; }
            if (lift < 0.0002 && ov.depth < 0.0002) break;
            let dp = [0, lift, 0]; if (lift >= 0.0002) freeStats.lifted++;
            // fix round 2: a free finger is lifted by turning it about its knuckle (MCP extension, PIP slightly opened), not by
            // pulling the target up toward the MCP (that flexed the PIP into an intrinsic-minus claw: MCP -2 / PIP 61)
            if (f !== 1 && lift >= 0.0002) { const bb = H.baseOf(f, palm); const mc = add(bb.p, qRot(bb.q, H.J[H.fj[f][0]].t)); const v0 = sub(tg.p, mc), v1 = add(v0, dp); dp = sub(add(mc, scale(v1, (len(v0) + 0.4 * lift) / Math.max(1e-6, len(v1)))), tg.p); }
            if (ov.depth >= 0.0002) { dp = add(dp, scale(norm(add(ov.dir, [0, 0.5, 0])), ov.depth + 0.0015)); freeStats.pushed++; }
            tg = { ...tg, p: add(tg.p, dp) };
            r = solveF(tg.p, r.a);
          }
        }
        placed.push(...fingerCapsules(H, f, H.fingerFK(f, palm, r.a)).map((c) => ({ ...c, h: s })));
        warm[s][f] = r.a;
        { const R0 = REC[s][f]; const o = i * 4; const A = r.a;
          if (f === 1) { R0.a[o] = A.cmc; R0.a[o + 1] = A.cmcAbd; R0.a[o + 2] = A.mcp; R0.a[o + 3] = A.ip; } else { R0.a[o] = A.mcp; R0.a[o + 1] = A.abd; R0.a[o + 2] = A.pip; R0.a[o + 3] = A.dip; }
          R0.mode[i] = tg.mode === 'contact' ? 1 : 0; R0.key[i] = tg.mode === 'contact' ? tg.note.key : -1; R0.tgt[i * 3] = tg.p[0]; R0.tgt[i * 3 + 1] = tg.p[1]; R0.tgt[i * 3 + 2] = tg.p[2]; R0.dip[i] = tg.dipRatio; R0.pipLo[i] = r._pipLo ?? pipB[0]; }
        if (opts.debug && opts.debug.hand === s && opts.debug.finger === f && t >= opts.debug.t0 && t <= opts.debug.t1) {
          const fk = H.fingerFK(f, palm, r.a); const c = H.padCenter(f, fk);
          const pb = planners[s].palmBase(t).p;
          { const ka = new Float32Array(88); for (let q = 0; q < 88; q++) ka[q] = keyAngle(q, t); const pen = fingerPenetration(H, f, palm, fk, ka, tg.mode === 'contact' ? tg.note.key : -1); const pref = f === 1 && tg.note ? thumbPref[s].get(tg.note.id) : null;
            log(`[dbg]   pen ${(pen.max * 1000).toFixed(2)} n ${pen.n}${pref ? ' pref ' + ['cmc', 'cmcAbd', 'mcp', 'ip'].map((x) => (pref[x] / DEG).toFixed(1)).join('/') : ''}`); }
          log(`[dbg] t ${t.toFixed(4)} palm ${palm.p.map((v) => (v * 1000).toFixed(1)).join(',')} base ${pb.map((v) => (v * 1000).toFixed(1)).join(',')} ${s}${f} ${tg.mode}${tg.riding ? '(ride)' : ''} note ${tg.note ? tg.note.name + '/' + tg.note.f : '-'} target ${tg.p.map((v) => (v * 1000).toFixed(1)).join(',')} pad ${c.map((v) => (v * 1000).toFixed(1)).join(',')} err ${(r.err * 1000).toFixed(2)} ` +
            Object.entries(r.a).map(([k, v]) => `${k} ${(v / DEG).toFixed(1)}`).join(' ') + (tg.dbg ? ' ' + JSON.stringify(tg.dbg) : ''));
        }
        const L3 = H.fingerLocals(f, r.a); H.fj[f].forEach((ji, k) => { local[ji] = L3[k]; });
      }
      handCaps[s] = placed;
    }
    for (let b = 0; b < NB; b++) { const q = local[outIdx[b]]; const o = (i * NB + b) * 4; boneData[o] = q[0]; boneData[o + 1] = q[1]; boneData[o + 2] = q[2]; boneData[o + 3] = q[3]; }
    if ((i - range[0]) % 4800 === 0) log(`[solve]   sample ${i}/${N} t=${t.toFixed(1)} (${((Date.now() - tLoop) / 1000).toFixed(0)} s)`);
  }
  log(`[solve] sampling done in ${((Date.now() - tLoop) / 1000).toFixed(1)} s; free fingers lifted off the key bed at ${freeStats.lifted} sample-steps, pushed off a neighbour finger at ${freeStats.pushed}; held fingers let go of a key they could no longer reach (hand leaving) ${freeStats.letGo || 0}; hinged free targets blended back to the hover ${freeStats.unhinged || 0}`);
  // ------------------------------------------------------------------ joint-space smoothing (fix round 1: no pops)
  const tSm = Date.now(); const smStats = smoothFingers({ hands, REC, palmS, range, dt, N });
  { const ta = Date.now(); const st = monotoneApproach({ hands, REC, palmS, keyArrays, range, dt }); log(`[solve] joint-space approach/departure: ${st.app} approaches + ${st.dep} departures interpolated (${st.halved} shortened, ${st.kept} kept: interpolation would cut a key) in ${((Date.now() - ta) / 1000).toFixed(1)} s`); }
  if (!process.env.PERF_NO_DESPIKE) { const td = Date.now(); const st = despikeFree({ REC, range, dt }); log(`[solve] free-finger despike (17-tap median, |dev| > 3 deg, corrections smoothed 8 ms, contact samples fixed): ${st.changed} channel-samples changed (max ${st.maxDeg.toFixed(1)} deg); 60 fps flicks > 12 deg on free samples ${st.before} -> ${st.after} in ${((Date.now() - td) / 1000).toFixed(1)} s`); }
  { const tc = Date.now(); const st = freeKeyClearance({ hands, REC, palmS, keyArrays, range, N }); log(`[solve] free-finger key clearance (skinned, keys at their track angles): ${st.fixed} finger-samples lifted (max ${st.maxDeg.toFixed(1)} deg MCP), residual > 1 mm ${st.resid} (max ${(st.maxResid * 1000).toFixed(2)} mm) in ${((Date.now() - tc) / 1000).toFixed(1)} s`); }
  if (!opts.noSep) { const tc = Date.now(); const st = freeFingerSeparation({ hands, REC, palmS, keyArrays, range, N }); log(`[solve] finger-finger separation after the angle passes: ${st.fixed} finger-samples moved (max ${st.maxDeg.toFixed(1)} deg), overlap before max ${(st.before * 1000).toFixed(2)} mm at ${st.nBefore} samples, after max ${(st.after * 1000).toFixed(2)} mm at ${st.nAfter} samples, in ${((Date.now() - tc) / 1000).toFixed(1)} s`); }
  // critic round 3: the Lipschitz rate limit swapped single-sample pops for 840 deg/s ramps bracketed by unlimited steps at the
  // contact samples (framed pops per shot up in S03/S04/S09/S11/S22, free flesh in keys 3023 -> 5838 > 1 mm): off until it
  // is an acceleration-limited re-time that includes the contact boundary (PERF_RATE=1 turns the old pass back on)
  if (process.env.PERF_RATE && !opts.noRate) { const st = freeRateLimit({ REC, range, N }); log(`[solve] final joint-rate limit on free fingers (<= ${FREE_RATE_DEG} deg per 240 Hz sample, anchored on the contact samples): ${st.changed} channel-samples changed, max change ${st.maxDeg.toFixed(1)} deg, steps > 8 deg ${st.before} -> ${st.after}`); }
  for (const s of ['R', 'L']) for (let f = 1; f <= 5; f++) {
    const H = hands[s]; const A = REC[s][f].a; const bIdx = H.fj[f].map((ji) => outIdx.indexOf(ji));
    for (let i = range[0]; i <= range[1]; i++) {
      const o = i * 4; const a = f === 1 ? { cmc: A[o], cmcAbd: A[o + 1], mcp: A[o + 2], ip: A[o + 3] } : { mcp: A[o], abd: A[o + 1], pip: A[o + 2], dip: A[o + 3] };
      const L3 = H.fingerLocals(f, a);
      for (let k = 0; k < 3; k++) { const q = L3[k]; const ob = (i * NB + bIdx[k]) * 4; boneData[ob] = q[0]; boneData[ob + 1] = q[1]; boneData[ob + 2] = q[2]; boneData[ob + 3] = q[3]; }
    }
  }
  log(`[solve] joint-space smoothing + contact re-projection in ${((Date.now() - tSm) / 1000).toFixed(1)} s (contact samples re-projected ${smStats.reproj}, residual > 0.3 mm ${smStats.bad})`);
  { const tb = Date.now(); const st = brushNeighbourKeys({ hands, REC, palmS, keyArrays, range, N, notes, t0, dt }); log(`[solve] brushed neighbour keys: ${st.keys} keys dip silently at ${st.samples} samples (max ${(st.maxMm).toFixed(2)} mm at the contact point; residual flesh in a neighbour > 1 mm at ${st.resid} samples) in ${((Date.now() - tb) / 1000).toFixed(1)} s`); }
  // samples outside the solved range: copy the nearest solved frame
  for (let i = 0; i < N; i++) { if (i >= range[0] && i <= range[1]) continue; const src = i < range[0] ? range[0] : range[1]; boneData.copyWithin(i * NB * 4, src * NB * 4, (src + 1) * NB * 4); }

  const ripples = makeRipples({ notes, score, t0, dt, N, travel: keyArrays.travel, legs, rig, body });
  return {
    meta: { t0, dt, N, rate: RATE, musicOffset: MUSIC_OFFSET, mEnd, range, fingering, conflicts: conflicts.length, reachReleases: reach, travelReleases: travel, adaptiveReleases: { R: planners.R.adaptive, L: planners.L.adaptive }, bind, score: opts.score, rig: opts.rig, glb: opts.glb },
    bones: OUTPUT_BONES, boneData, rootPos, rootS, keyArrays, ripples, notes, planners, hands, rig, mesh, keyTracks, body, legs,
  };
}

/**
 * Joint-space smoothing of the finger angles (fix round 1; critic: 7k single-sample joint pops at 240 Hz). Free
 * stretches are smoothed with a 16 ms Gaussian, contact stretches with 5 ms, blended over 40 ms around every touch and
 * release, so a step can no longer happen inside one sample. Contact samples are then put back exactly on their
 * (mesh-corrected) targets: the thumb by minimum-norm steps from the smoothed angles (the nearest solution of its
 * redundant chain, so a basin flip of the IK becomes a smooth transition), the long fingers keep their exact IK
 * solution (unique for a given target). Mutates REC[s][f].a.
 */
function smoothFingers({ hands, REC, palmS, range, dt }) {
  const [i0, i1] = range; const n = i1 - i0 + 1; let reproj = 0, bad = 0;
  const kern = (sig) => { const R = Math.ceil(3 * sig); const k = new Float64Array(2 * R + 1); let s = 0; for (let j = -R; j <= R; j++) { k[j + R] = Math.exp(-0.5 * (j / sig) ** 2); s += k[j + R]; } for (let j = 0; j < k.length; j++) k[j] /= s; return { k, R }; };
  const KF = kern(0.016 / dt), KC = kern(0.005 / dt);
  const conv = (x, K) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = -K.R; j <= K.R; j++) { const m = i + j < 0 ? 0 : i + j >= n ? n - 1 : i + j; s += x[m] * K.k[j + K.R]; } o[i] = s; } return o; };
  const ramp = 0.04 / dt;
  for (const s of ['R', 'L']) for (let f = 1; f <= 5; f++) {
    const H = hands[s]; const Rc = REC[s][f];
    const dist = new Float64Array(n); let last = -1e9;
    for (let k = 0; k < n; k++) { if (Rc.mode[i0 + k]) last = k; dist[k] = k - last; }
    last = 1e9; for (let k = n - 1; k >= 0; k--) { if (Rc.mode[i0 + k]) last = k; dist[k] = Math.min(dist[k], last - k); }
    const w = new Float64Array(n); for (let k = 0; k < n; k++) { const u = Math.min(1, dist[k] / ramp); w[k] = u * u * (3 - 2 * u); }
    const Y = [];
    for (let j = 0; j < 4; j++) {
      const x = new Float64Array(n); for (let k = 0; k < n; k++) x[k] = Rc.a[(i0 + k) * 4 + j];
      const sf = conv(x, KF), sc = conv(x, KC); const y = new Float64Array(n); for (let k = 0; k < n; k++) y[k] = sc[k] + (sf[k] - sc[k]) * w[k]; Y.push(y);
    }
    for (let k = 0; k < n; k++) {
      const i = i0 + k; const o = i * 4;
      if (Rc.mode[i] && f !== 1) continue;            // long finger on its key: exact IK solution kept
      let a = [Y[0][k], Y[1][k], Y[2][k], Y[3][k]];
      if (Rc.mode[i]) {
        const palm = { q: palmS[s].q[i], p: palmS[s].p[i] }; const tgt = [Rc.tgt[i * 3], Rc.tgt[i * 3 + 1], Rc.tgt[i * 3 + 2]];
        const r = H.polishThumb(palm, tgt, a, 8); reproj++; if (r.err > 0.0003) bad++;
        a = [r.a.cmc, r.a.cmcAbd, r.a.mcp, r.a.ip];
      }
      Rc.a[o] = a[0]; Rc.a[o + 1] = a[1]; Rc.a[o + 2] = a[2]; Rc.a[o + 3] = a[3];
    }
  }
  return { reproj, bad };
}

/**
 * cycle 2 fix 4 (critic I-37: one-frame finger flicks, e.g. S06 m 54.733 R2 MCP 50 -> 1 -> 12 at 30 Hz, S16b L3 45 -> 77 ->
 * 55; the gate wants 0 flicks > 12 deg at 60 fps). Spikes up to one film frame wide are removed on the FREE samples of
 * every finger channel by a 17-tap (70 ms) running median - it keeps monotone ramps, edges and gestures wider than ~35 ms
 * (prep lifts, approaches) and removes narrower pulses - applied only where it differs by > 3 deg, with the correction
 * Gaussian-smoothed (8 ms) so it never adds a step. Contact samples are anchors (never changed; they are inside the
 * median window, so the free side of a contact boundary is pulled onto the contact values). Runs before the key
 * clearance and the finger-finger separation passes (those re-check the corrected angles). PERF_NO_DESPIKE=1 turns it off.
 */
function despikeFree({ REC, range, dt }) {
  const [i0, i1] = range; const n = i1 - i0 + 1; const HW = 8; const TH = 3 * DEG; const L = Math.max(1, Math.round(1 / 60 / dt));
  const sig = 0.008 / dt; const R = Math.ceil(3 * sig); const K = new Float64Array(2 * R + 1); { let s = 0; for (let j = -R; j <= R; j++) { K[j + R] = Math.exp(-0.5 * (j / sig) ** 2); s += K[j + R]; } for (let j = 0; j < K.length; j++) K[j] /= s; }
  let changed = 0, maxDeg = 0, before = 0, after = 0; const win = new Float64Array(2 * HW + 1);
  const flicks = (x, fx) => { let c = 0; for (let k = L; k < n - L; k++) if (!fx[k] && Math.abs(x[k] - 0.5 * (x[k - L] + x[k + L])) > 12 * DEG) c++; return c; };
  for (const s of ['R', 'L']) for (let f = 1; f <= 5; f++) {
    const Rc = REC[s][f]; let anyFree = false; for (let i = i0; i <= i1; i++) if (!Rc.mode[i]) { anyFree = true; break; } if (!anyFree) continue;
    // the last 25 ms of each contact interval (the release ride: the key rises on its own track) may be corrected too, so a
    // held finger dragged by the departing hand blends into its free path instead of snapping at the boundary (S14 L2 m 106.08)
    const fx = new Uint8Array(n); { const TAIL = Math.round(0.025 / dt); let dist = 1e9; for (let k = n - 1; k >= 0; k--) { if (!Rc.mode[i0 + k]) dist = 0; else dist++; fx[k] = Rc.mode[i0 + k] && dist > TAIL ? 1 : 0; } }
    for (let j = 0; j < 4; j++) {
      const x = new Float64Array(n); for (let k = 0; k < n; k++) x[k] = Rc.a[(i0 + k) * 4 + j];
      before += flicks(x, fx);
      const d = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        if (fx[k]) continue;
        let m = 0; for (let o = -HW; o <= HW; o++) { const kk = k + o < 0 ? 0 : k + o >= n ? n - 1 : k + o; win[m++] = x[kk]; }
        const sorted = Array.from(win).sort((a, b) => a - b); const med = sorted[HW];
        const dv = med - x[k]; if (Math.abs(dv) > TH) d[k] = dv - Math.sign(dv) * TH * 0.5;
      }
      let nz = false; for (let k = 0; k < n; k++) if (d[k]) { nz = true; break; }
      const y = x.slice();
      for (let k = 0; k < n && nz; k++) {
        if (fx[k]) continue;
        let sacc = 0; for (let o = -R; o <= R; o++) { const kk = k + o; if (kk < 0 || kk >= n) continue; sacc += d[kk] * K[o + R]; }
        if (Math.abs(sacc) > 1e-5) { y[k] = x[k] + sacc; changed++; maxDeg = Math.max(maxDeg, Math.abs(sacc) / DEG); }
      }
      // stage 2: STEPS (a median keeps them; a 25+ deg change inside one film frame is a flick for the 60 fps metric) are
      // softened where the 60 fps second difference exceeds 7 deg: a 20 ms Gaussian of the channel, blended in with a
      // smooth mask (+-50 ms), free samples only
      const G = 0.020 / dt; const RG = Math.ceil(3 * G); const KG = new Float64Array(2 * RG + 1); { let s2 = 0; for (let q = -RG; q <= RG; q++) { KG[q + RG] = Math.exp(-0.5 * (q / G) ** 2); s2 += KG[q + RG]; } for (let q = 0; q < KG.length; q++) KG[q] /= s2; }
      const mk = new Float64Array(n); let anyM = false;
      for (let k = L; k < n - L; k++) if (!fx[k] && Math.abs(y[k] - 0.5 * (y[k - L] + y[k + L])) > 7 * DEG) { anyM = true; for (let q = Math.max(0, k - 12); q <= Math.min(n - 1, k + 12); q++) mk[q] = 1; }
      if (anyM) {
        const ms = new Float64Array(n); for (let k = 0; k < n; k++) { let a2 = 0; for (let q = -R; q <= R; q++) { const kk = k + q; if (kk >= 0 && kk < n) a2 += mk[kk] * K[q + R]; } ms[k] = a2; }
        const z = y.slice();
        for (let k = 0; k < n; k++) {
          if (fx[k] || ms[k] < 1e-3) continue;
          let a2 = 0; for (let q = -RG; q <= RG; q++) { const kk = k + q < 0 ? 0 : k + q >= n ? n - 1 : k + q; a2 += y[kk] * KG[q + RG]; }
          const v = y[k] + (a2 - y[k]) * Math.min(1, ms[k]); if (Math.abs(v - y[k]) > 1e-5) { changed++; maxDeg = Math.max(maxDeg, Math.abs(v - x[k]) / DEG); } z[k] = v;
        }
        for (let k = 0; k < n; k++) y[k] = z[k];
      }
      after += flicks(y, fx);
      for (let k = 0; k < n; k++) Rc.a[(i0 + k) * 4 + j] = y[k];
    }
  }
  return { changed, maxDeg, before, after };
}

/** signed distance (m) of the lowest skinned pad vertex above the key's top plane at time t (>0 = above) */
/**
 * fix round 2 (critic: the 6 fastest joint motions of the film are R5 approach flicks: the pinky curled in to MCP 80,
 * was flung straight within 2 film frames and re-curled on the key; 288 approach flicks > 25 deg). The last part of every
 * long-finger approach is replaced by a MONOTONE joint-space interpolation (Fritsch-Carlson limited cubic Hermite per
 * joint) from the free pose ~120 ms before the touch to the exact contact pose at the touch: no extra curl, no fling,
 * C1 at both ends (the end slope is the key stroke's, so a struck finger still arrives moving). The first 60-80 ms after
 * a release get the same treatment from the contact pose (the departure starts from the current contact pose). A window
 * whose interpolated finger would cut into a key (skinned collision set, > 1 mm and > the original path's own depth +
 * 0.5 mm) is halved once, else the original path is kept. Mutates REC[s][f].a (long fingers only).
 */
function monotoneApproach({ hands, REC, palmS, keyArrays, range, dt }) {
  const [i0, i1] = range; const st = { app: 0, dep: 0, halved: 0, kept: 0 };
  const WA = Math.round(0.12 / dt), WD = Math.round(0.08 / dt), MIN = Math.round(0.04 / dt), IGN = Math.round(0.03 / dt);
  for (const s of ['R', 'L']) for (let f = 2; f <= 5; f++) {
    const H = hands[s]; const Rc = REC[s][f]; const A = Rc.a;
    const ang = (k) => ({ mcp: A[k * 4], abd: A[k * 4 + 1], pip: A[k * 4 + 2], dip: A[k * 4 + 3] });
    const depth = (k, a, ignore) => { const palm = { q: palmS[s].q[k], p: palmS[s].p[k] }; return freeLift(H, f, palm, H.fingerFK(f, palm, a), keyArrays.keys.subarray(k * 88, (k + 1) * 88), 0, ignore); };
    // candidate path on [ka, kb] (both ends kept), x0 = A[ka], x1 = A[kb], slopes from the neighbouring samples
    const path = (ka, kb) => {
      const W = kb - ka; const out = [];
      const coef = [];
      for (let j = 0; j < 4; j++) {
        const x0 = A[ka * 4 + j], x1 = A[kb * 4 + j]; const D = x1 - x0;
        const v0 = (A[(ka + 1) * 4 + j] - A[(ka - 1) * 4 + j]) * 0.5, v1 = (A[(kb + 1) * 4 + j] - A[(kb - 1) * 4 + j]) * 0.5;
        let al = 0, be = 0;
        if (Math.abs(D) > 0.2 * DEG) { al = clamp((v0 * W) / D, 0, 3); be = clamp((v1 * W) / D, 0, 3); const r = Math.hypot(al, be); if (r > 3) { al *= 3 / r; be *= 3 / r; } }
        coef.push([x0, D, al, be]);
      }
      for (let k = ka + 1; k < kb; k++) {
        const u = (k - ka) / W, u2 = u * u, u3 = u2 * u; const h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        out.push(coef.map(([x0, D, al, be]) => x0 + D * (h01 + al * h10 + be * h11)));
      }
      return out;
    };
    const tryWin = (ka, kb, ignoreKey, igAt) => {
      if (ka - 1 < i0 || kb + 1 > i1 || kb - ka < 3) return null;
      const P = path(ka, kb); let dNew = 0, dOld = 0;
      for (let k = ka + 1; k < kb; k++) {
        const ig = igAt(k) ? ignoreKey : -1; const a = P[k - ka - 1];
        dNew = Math.max(dNew, depth(k, { mcp: a[0], abd: a[1], pip: a[2], dip: a[3] }, ig));
        if (dNew > 0.001) dOld = Math.max(dOld, depth(k, ang(k), ig));
      }
      return dNew <= Math.max(0.001, dOld + 0.0005) ? P : null;
    };
    const apply = (ka, P) => { for (let m = 0; m < P.length; m++) { const k = ka + 1 + m; for (let j = 0; j < 4; j++) A[k * 4 + j] = P[m][j]; } };
    // free stretches [a, b] (inclusive) between contacts
    let k = i0;
    while (k <= i1) {
      if (Rc.mode[k]) { k++; continue; }
      let b = k; while (b + 1 <= i1 && !Rc.mode[b + 1]) b++;
      const prevC = k - 1 >= i0 && Rc.mode[k - 1] ? k - 1 : -1, nextC = b + 1 <= i1 && Rc.mode[b + 1] ? b + 1 : -1; const gap = b - k + 1;
      let usedA = 0;
      if (nextC >= 0 && gap * dt >= 0.09) {
        let W = Math.min(WA, gap - Math.round(0.03 / dt)); let P = null;
        while (W >= MIN && !(P = tryWin(nextC - W, nextC, Rc.key[nextC], (q) => q >= nextC - IGN))) { W = Math.floor(W / 2); if (W >= MIN) st.halved++; }
        if (P) { apply(nextC - W, P); st.app++; usedA = W; } else st.kept++;
      }
      if (prevC >= 0 && gap * dt >= 0.2) {
        let W = Math.min(WD, gap - usedA - Math.round(0.02 / dt)); let P = null;
        while (W >= MIN && !(P = tryWin(prevC, prevC + W, Rc.key[prevC], (q) => q <= prevC + IGN))) { W = Math.floor(W / 2); if (W >= MIN) st.halved++; }
        if (P) { apply(prevC, P); st.dep++; } else st.kept++;
      }
      k = b + 1;
    }
  }
  return st;
}

export function padPlaneError(H, f, palm, a, note, t, keyAngle) {
  const fk = H.fingerFK(f, palm, a); const base = H.baseOf(f, palm);
  const ang = keyAngle(note.key, t); const n = keyNormalP(ang); const p0 = keyPointP(note.key, ang, note.P0);
  let best = 1e9;
  const tr = new Map(); tr.set(H.fj[f][0], fk[0]); tr.set(H.fj[f][1], fk[1]); tr.set(H.fj[f][2], fk[2]);
  if (f === 1) tr.set(H.iWrist, palm); else tr.set(H.mc[f], base);
  for (const v of H.pad[f].cand) {
    let x = 0, y = 0, z = 0, wsum = 0;
    for (const s of v.inf) { const T = tr.get(s.j); if (!T) continue; const r = qRot(T.q, s.local); x += s.w * (r[0] + T.p[0]); y += s.w * (r[1] + T.p[1]); z += s.w * (r[2] + T.p[2]); wsum += s.w; }
    if (wsum < 0.5) continue; x /= wsum; y /= wsum; z /= wsum;
    const d = (x - p0[0]) * n[0] + (y - p0[1]) * n[1] + (z - p0[2]) * n[2];
    if (d < best) best = d;
  }
  return best;
}

/** musical vertical palm offsets in free windows: rest lifts, phrase-end lift-off, drops into chords */
function verticalOffsets(P, notes, t0, dt, N) {
  const x = new Float32Array(N), y = new Float32Array(N), z = new Float32Array(N);
  const tEndAll = t0 + (N - 1) * dt;
  // fix round 1 (critic: the wrists did not move at all through the 6.6 s final chord): while the palm holds a keyframe
  // pose for more than ~0.6 s the arm weight settles (1.5 mm) and the wrist drifts slowly (smooth noise, < 1 mm); the
  // fingers on their keys follow through the per-sample IK. The same drift continues in the rest after the final release.
  const lastUp = notes.length ? Math.max(...notes.map((n) => n.tUp)) : t0;
  for (let k = 0; k < P.kf.length; k++) {
    const K = P.kf[k]; const a = K.A, b = k + 1 < P.kf.length ? K.D : tEndAll + 1; if (b - a < 0.6) continue;
    const i0 = Math.max(0, Math.floor((a - t0) / dt)), i1 = Math.min(N - 1, Math.ceil((Math.min(b, tEndAll) - t0) / dt));
    for (let i = i0; i <= i1; i++) {
      const t = t0 + i * dt; const w = smoothstep(a + 0.15, a + 0.9, t) * (1 - smoothstep(b - 0.25, b, t)) * (1 - smoothstep(lastUp - 0.05, lastUp + 0.3, t) * (1 - smoothstep(lastUp + 1.9, lastUp + 2.6, t)));
      y[i] += w * (-0.0015 + 0.0007 * bodyNoise(t * 1.3, 91 + P.H.lat)); x[i] += w * 0.0008 * bodyNoise(t * 1.1, 93 + P.H.lat); z[i] += w * 0.0006 * bodyNoise(t * 1.2, 95 + P.H.lat);
    }
  }
  for (const [a, b] of P.freeWins) {
    const L = b - a; if (L < 0.32) continue;
    if (P.ctx.lap && b >= tEndAll - 1e-6 && a >= lastUp - 0.05) continue;   // the final rest: the lap motion owns it
    const nextNotes = notes.filter((n) => n.tm.tFk >= b - 0.06 && n.tm.tFk < b + 0.08);
    const vel = nextNotes.length ? Math.max(...nextNotes.map((n) => n.vel)) : 40; const chord = nextNotes.length;
    const nv = clamp((vel - 40) / 70, 0, 1);
    const h = Math.min(0.006 + 0.010 * clamp((L - 0.3) / 1.5, 0, 1) + 0.016 * nv * (chord >= 3 ? 1 : 0.5), 0.032) * (a <= t0 + 1e-6 || b >= t0 + (N - 1) * dt - 1e-6 ? 0.6 : 1);
    const up = Math.min(0.28, L * 0.4), down = Math.min(0.12 + 0.06 * nv, L * 0.4);
    const i0 = Math.max(0, Math.floor((a - t0) / dt)), i1 = Math.min(N - 1, Math.ceil((b - t0) / dt));
    for (let i = i0; i <= i1; i++) {
      const t = t0 + i * dt; const w = Math.min(minjerk((t - a) / up), minjerk((b - t) / down));
      y[i] = Math.max(y[i], h * w); z[i] = Math.min(z[i], -0.25 * h * w);
    }
  }
  // arm weight: after loud attacks the wrist settles 1-4 mm and recovers (damped impulse)
  for (const n of notes) if (n.vel >= 75) {
    const amp = 0.001 + 0.003 * clamp((n.vel - 75) / 40, 0, 1); const i0 = Math.max(0, Math.floor((n.t_on - t0) / dt)), i1 = Math.min(N - 1, i0 + Math.round(0.4 / dt));
    for (let i = i0; i <= i1; i++) { const s = (t0 + i * dt - n.t_on); const w = 1.678 / 0.06; y[i] -= amp * (w * s) * Math.exp(-w * s) * Math.E; }
  }
  return { x, y, z };
}

/** contact fingers' PIP range: hand.js contactPip(f) (fix round 1: 16 deg for fingers 2-4, 9 for the 5th; was 4) */
const NO_PALMNUDGE = !!process.env.PERF_NO_PALMNUDGE;   // critic round 3 A/B toggle
export const CONTACT_PIP = [16 * DEG, 100 * DEG];

/**
 * Contact-preserving palm: walk the sampled palm path; wherever a finger that is on a key (tFk..tUp) cannot reach its
 * moving contact point from the interpolated palm (> 0.15 mm), solve a small 6-DOF palm correction (Gauss-Newton,
 * regularised toward no correction) that puts every contact finger back on its key. Outside contacts the correction
 * decays (time constant 40 ms), so the palm path stays continuous. Mutates sm.p / sm.q in place.
 */
function contactPreservingPalm(H, notes, sm, { t0, dt, range, keyAngle, thumbPrefAt, keyArrays }) {
  const ns = notes.filter((n) => n.P0).sort((a, b) => touchT(a) - touchT(b));
  const N = sm.p.length; const i0 = Math.max(0, range[0] - 240), i1 = Math.min(N - 1, range[1]);
  const decay = Math.exp(-dt / 0.04); const mu = 0.04;
  const target = (n, t) => {
    const a = keyAngle(n.key, t); const p = add(keyPointP(n.key, a, n.P0), scale(keyNormalP(a), H.pad[n.f].r));
    return n.padCorr ? sub(p, n.padCorr) : p;
  };
  let d = [0, 0, 0, 0, 0, 0]; const warm = {}; let nudged = 0, maxShift = 0, maxResid = 0, tMax = 0, tResid = 0;
  const D = new Float64Array((i1 - i0 + 1) * 6);   // the correction per sample (smoothed before it is applied)
  let next = 0; const active = [];
  for (let i = i0; i <= i1; i++) {
    const t = t0 + i * dt;
    while (next < ns.length && touchT(ns[next]) <= t) active.push(ns[next++]);
    for (let k = active.length - 1; k >= 0; k--) if (active[k].tUp < t) active.splice(k, 1);
    const byF = new Map(); for (const n of active) if (!byF.has(n.f) || byF.get(n.f).tm.tFk < n.tm.tFk) byF.set(n.f, n);
    d = d.map((x) => x * decay);
    if (byF.size) {
      const cs = [...byF.values()]; const tg = cs.map((n) => target(n, t));
      // legato hand-over: while another finger is still in its stroke, a finger riding its released key up keeps little
      // pull on the palm (it lifts off the key instead), so the palm does not rise and leave the landing finger short
      const landing = Math.max(...cs.map((n) => 1 - smoothstep(n.tm.tKb, n.tm.tKb + 0.05, t)));
      const wc = cs.map((n) => 1 - 0.85 * landing * smoothstep(n.tm.tRel0, n.tm.tRel0 + 0.03, t));
      const base = { q: sm.q[i], p: sm.p[i] };
      const poseOf = (x) => ({ p: [base.p[0] + x[0], base.p[1] + x[1], base.p[2] + x[2]], q: qMul(qExp([x[3], x[4], x[5]]), base.q) });
      // fix round 1: the contact fingers' flesh in the NEIGHBOURING keys (skinned collision set, own key beyond 0.3 mm)
      // is part of the residual, so the palm is also nudged (lifted / rolled) where a held finger - mostly the thumb's
      // ulnar side or its metacarpal - cuts into the next key
      const ka = keyArrays ? keyArrays.keys.subarray(i * 88, (i + 1) * 88) : null; let penMax = 0, palmMax = 0;
      const resid = (x) => {
        const palm = poseOf(x); const r = []; penMax = 0;
        cs.forEach((n, k) => {
          const sol = n.f === 1 ? H.solveThumb(palm, tg[k], warm[n.f], thumbPrefAt(n.id, t)) : H.solveFinger(n.f, palm, tg[k], warm[n.f], dipRatioFor(n), null, contactPip(n.f));
          warm[n.f] = sol.a; const fk = H.fingerFK(n.f, palm, sol.a); const c = H.padCenter(n.f, fk); const w = wc[k]; r.push(w * (c[0] - tg[k][0]), w * (c[1] - tg[k][1]), w * (c[2] - tg[k][2]));
          if (ka) { const pen = fingerPenetration(H, n.f, palm, fk, ka, n.key, 0.0003); r.push(Math.sqrt(pen.sum) * 0.3 * w); penMax = Math.max(penMax, w * pen.max); }
        });
        // critic round 3 (S15 octave Bb4-Bb5: the nudge traded reach for palm depth, thenar / heel 11 mm inside C5-F5): the
        // palm's own flesh in the keys (1 mm margin) is part of the residual, so the nudge never buys reach with palm depth
        if (ka && H.palmSet && !NO_PALMNUDGE) { const pp = palmPenetration(H, palm, ka, 0.001); r.push(Math.sqrt(pp.sum)); palmMax = pp.max; }
        return r;
      };
      const cErr = (r) => { const st = ka ? 4 : 3; let m = 0; for (let k = 0; k < cs.length; k++) m = Math.max(m, r[st * k] ** 2 + r[st * k + 1] ** 2 + r[st * k + 2] ** 2); return Math.sqrt(m); };
      const tot = (r) => Math.sqrt(r.reduce((s, v) => s + v * v, 0));
      let r = resid(d); let e = cErr(r);
      if ((e > 0.00015 || penMax > 0.0006 || palmMax > 0.001) && e < 0.02) {          // beyond 20 mm a nudge cannot help (QC reports the contact)
        nudged++; e = tot(r);
        for (let it = 0; it < 3 && e > 0.00005; it++) {
          const hs = [1e-4, 1e-4, 1e-4, 1e-3, 1e-3, 1e-3]; const J = [];
          for (let k = 0; k < 6; k++) { const y = d.slice(); y[k] += hs[k]; const ry = resid(y); J.push(ry.map((v, m) => (v - r[m]) / hs[k])); }
          const A = [0, 1, 2, 3, 4, 5].map((a) => [0, 1, 2, 3, 4, 5].map((b) => J[a].reduce((s, v, m) => s + v * J[b][m], 0) + (a === b ? mu : 0)));
          const g = [0, 1, 2, 3, 4, 5].map((a) => J[a].reduce((s, v, m) => s + v * r[m], 0) + mu * d[a]);
          const st = solveLin(A, g); if (!st) break;
          let dn = d.map((x, k) => x - st[k]);
          // a nudge, not a relocation: <= 12 mm and <= 6 deg (beyond that the held key is out of reach; QC reports it)
          // critic round 2 (mid-hold hops of 2-4 mm before the hand's next onset, hold_census; the 12 mm cap was reached in
          // both hands): <= 18 mm and <= 8 deg
          const tl = Math.hypot(dn[0], dn[1], dn[2]), rl = Math.hypot(dn[3], dn[4], dn[5]);
          if (tl > 0.018) dn = [dn[0] * 0.018 / tl, dn[1] * 0.018 / tl, dn[2] * 0.018 / tl, dn[3], dn[4], dn[5]];
          // critic round 3 (S06 macro: the wrist sat ~20 mm high to save a held finger): the palm rises <= 10 mm above its plan
          if (dn[1] > 0.010 && !NO_PALMNUDGE) dn[1] = 0.010;
          if (rl > 0.14) dn = [dn[0], dn[1], dn[2], dn[3] * 0.14 / rl, dn[4] * 0.14 / rl, dn[5] * 0.14 / rl];
          const rn = resid(dn);
          const en = tot(rn);
          if (en >= e) { r = resid(d); break; }
          d = dn; r = rn; e = en;
        }
        const ce = cErr(r); if (ce > maxResid) { maxResid = ce; tResid = t; }
      }
    }
    for (let k = 0; k < 6; k++) D[(i - i0) * 6 + k] = d[k];
  }
  // fix round 1: the nudge is applied after a light zero-phase smoothing (sigma 10 ms), so the wrist and forearm never
  // hitch in one sample when a correction switches on (the per-sample contact correction takes the small remainder)
  const sig = 0.010 / dt, R = Math.ceil(3 * sig); const kw = []; let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); kw.push(w); ks += w; }
  const n = i1 - i0 + 1;
  for (let i = i0; i <= i1; i++) {
    const x = [0, 0, 0, 0, 0, 0];
    for (let j = -R; j <= R; j++) { const m = Math.min(n - 1, Math.max(0, i - i0 + j)); const w = kw[j + R] / ks; for (let k = 0; k < 6; k++) x[k] += w * D[m * 6 + k]; }
    if (!x.some((v) => v !== 0)) continue;
    const q = qMul(qExp([x[3], x[4], x[5]]), sm.q[i]); sm.q[i] = q; sm.p[i] = [sm.p[i][0] + x[0], sm.p[i][1] + x[1], sm.p[i][2] + x[2]];
    const sh = Math.hypot(x[0], x[1], x[2]); if (sh > maxShift) { maxShift = sh; tMax = t0 + i * dt; }
  }
  return { nudged, maxShift, maxResid, tMax, tResid };
}

/**
 * Brushed neighbour keys (fix round 1, the critic's last resort): where the flesh of a finger that plays a key still
 * sits in a NEIGHBOURING key (mostly the thumb's side in the next white key while its own key is down), that key is
 * pushed down silently by the residual, as a real thumb does to the next key: at most 3 mm at the point of contact and
 * 30 % of the key's travel (below the 45 % damper threshold, the hammer only lifts a little, no flight), with a 25 ms
 * hold and 15 ms smoothing so it moves slowly. Mutates keyArrays.keys / keyArrays.ham.
 */
function brushNeighbourKeys({ hands, REC, palmS, keyArrays, range, N, notes, t0, dt }) {
  const PIVZ = LAYOUT_PIV_Z; const need = new Float32Array(N * 88); const used = new Set(); let samples = 0, resid = 0;
  const x = [0, 0, 0];
  // fix round 3 (critic f2c: 262 ghost-key episodes, 70 s; dips that pre-moved keys about to be struck; two unplayed keys
  // down for 7 s on the final chord): a key is never brushed within 150 ms of its own stroke or while it sounds, never
  // from the final onset group on, only where the dip actually resolves the contact (<= 20 % of the key travel), and
  // only while the contact exists (no hold; 12 ms smoothing)
  const busy = new Uint8Array(N * 88);
  for (const n of notes) { const k = n.pitch - 21; if (k < 0 || k > 87) continue; const a = Math.max(0, Math.floor((touchT(n) - 0.15 - t0) / dt)), b = Math.min(N - 1, Math.ceil(((n.tUp ?? n.tm.tRel0 + 0.06) + 0.10 - t0) / dt)); for (let i = a; i <= b; i++) busy[i * 88 + k] = 1; }
  // the final chord = the notes still sounding at the end (rolled: from its first note on)
  const maxOff = Math.max(...notes.map((n) => n.t_off)); const tFinal = Math.min(...notes.filter((n) => n.t_off >= maxOff - 0.5).map((n) => n.t_on)); const iFinal = Math.max(0, Math.floor((tFinal - 0.15 - t0) / dt));
  for (let i = range[0]; i <= range[1]; i++) {
    if (i >= iFinal) break;
    const ka = keyArrays.keys.subarray(i * 88, (i + 1) * 88); let residS = false;
    for (const s of ['R', 'L']) for (let f = 1; f <= 5; f++) {
      const Rc = REC[s][f]; if (!Rc.mode[i]) continue; const own = Rc.key[i]; const H = hands[s];
      const o = i * 4; const A = Rc.a; const a = f === 1 ? { cmc: A[o], cmcAbd: A[o + 1], mcp: A[o + 2], ip: A[o + 3] } : { mcp: A[o], abd: A[o + 1], pip: A[o + 2], dip: A[o + 3] };
      const palm = { q: palmS[s].q[i], p: palmS[s].p[i] }; const fk = H.fingerFK(f, palm, a); const T = fingerTransformsOf(H, f, palm, fk);
      for (const v of H.colSet[f]) {
        skinV(v, T, x); if (x[1] > MAX_KEY_TOP + 0.001) continue; const r = penetrationP(x, ka); if (r.depth <= 0.0003 || r.key < 0 || r.key === own || r.part === 'keyslip') continue;
        const kk = r.key; const q = keyPointP(kk, -ka[kk], x); const vd = keyTopYAtP(kk, q[2], 0) - q[1];   // vertical depth in the key's frame
        if (vd <= 0.0008) continue; const lever = Math.max(0.05, PIVZ - q[2]);   // < 0.8 mm is skin contact, left alone
        // only flesh pressing on the neighbour FROM ABOVE moves it; flesh squeezed against a key's side (a finger in the
        // slot between two black keys) cannot push that key down and is left to the keyframe collision term
        if (vd > r.depth + 0.0005) continue;
        if (vd > 0.001 + 0.003) residS = true;
        if (busy[i * 88 + kk] || vd / lever > 0.2 * KEYS[kk].dipRad) continue;   // fix round 3
        const da = Math.min(vd / lever, 0.003 / lever, 0.2 * KEYS[kk].dipRad);
        const j = i * 88 + kk; if (ka[kk] + da > need[j]) need[j] = ka[kk] + da;
      }
    }
    if (residS) resid++;
  }
  // hold 25 ms, smooth 15 ms, never below the key's own track
  const W = 0, sig = 0.012 * 240, R = Math.ceil(3 * sig); const kw = []; let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); kw.push(w); ks += w; }
  let maxMm = 0;
  for (let k = 0; k < 88; k++) {
    let anyK = false; for (let i = range[0]; i <= range[1]; i++) if (need[i * 88 + k] > 0) { anyK = true; break; } if (!anyK) continue;
    const held = new Float32Array(N); for (let i = range[0]; i <= range[1]; i++) { let m = 0; for (let j = Math.max(range[0], i - W); j <= Math.min(range[1], i + W); j++) m = Math.max(m, need[j * 88 + k]); held[i] = m; }
    for (let i = range[0]; i <= range[1]; i++) {
      let v = 0; for (let j = -R; j <= R; j++) { const m = Math.min(range[1], Math.max(range[0], i + j)); v += held[m] * kw[j + R]; } v /= ks;
      const o = i * 88 + k; const cur = keyArrays.keys[o]; if (v <= cur + 1e-6) continue;
      if (busy[o]) continue;   // fix round 3: smoothing never spreads a dip into a stroke
      const extra = Math.min(v - cur, 0.2 * KEYS[k].dipRad); keyArrays.keys[o] = cur + extra; used.add(k); samples++;
      maxMm = Math.max(maxMm, extra * (PIVZ - 0.03) * 1000);
      // the hammer rises with the key (no escapement at <= 30 % travel)
      const frac = keyArrays.keys[o] / KEYS[k].dipRad; const rise = 0.6 * LAYOUT.action.blowDistance * frac;
      keyArrays.ham[o] = Math.max(keyArrays.ham[o], hammerAngle(k, rise));
    }
  }
  return { keys: used.size, samples, maxMm, resid };
}
/**
 * Free-finger key clearance (fix round 3; critic f2c: playing fingers cut through their own rising key just after the
 * release (id321 D5 R2 12.9 mm) or sank into the still resting key before the stroke (20 notes > 2 mm), and free L3/L4
 * dipped 5.7 mm into black keys during the LH leap at m 101). Runs AFTER the joint-space smoothing and monotoneApproach,
 * on the skinned collision vertices of every free long finger, against all keys at their CURRENT track angles: the MCP
 * opens (and past its limit the PIP) just enough to keep the flesh <= 0.3 mm in any key. The per-sample correction is
 * widened +-21 ms and Gaussian-smoothed (17 ms) so it cannot pop, and ramps to zero over 17 ms at a contact boundary.
 */
function freeKeyClearance({ hands, REC, palmS, keyArrays, range, N }) {
  const x = [0, 0, 0]; let fixed = 0, resid = 0, maxResid = 0, maxDeg = 0;
  const STEPS = [2, 4, 7, 11, 16, 22, 30].map((d) => d * DEG);
  const MCP_MIN = -12 * DEG;
  const lifted = (a, d) => { const m = Math.max(MCP_MIN, a.mcp - d); const rem = d - (a.mcp - m); return { mcp: m, abd: a.abd, pip: Math.max(0, a.pip - 0.8 * rem), dip: Math.max(0, a.dip - 0.5 * rem) }; };
  for (const s of ['R', 'L']) for (let f = 2; f <= 5; f++) {
    const H = hands[s]; const Rc = REC[s][f]; const A = Rc.a; const del = new Float32Array(N);
    const depthAt = (i, a) => { const palm = { q: palmS[s].q[i], p: palmS[s].p[i] }; const fk = H.fingerFK(f, palm, a); if (aboveAllKeys(H, f, fk)) return 0; const T = fingerTransformsOf(H, f, palm, fk); const ka = keyArrays.keys.subarray(i * 88, (i + 1) * 88); let d = 0;
      for (const v of fullFingerSet(H, f)) { skinV(v, T, x); if (x[1] > MAX_KEY_TOP + 0.001) continue; const r = penetrationP(x, ka); if (r.depth > d && r.part !== 'fallboard') d = r.depth; } return d; };
    for (let i = range[0]; i <= range[1]; i++) {
      if (Rc.mode[i]) continue; const o = i * 4; const a = { mcp: A[o], abd: A[o + 1], pip: A[o + 2], dip: A[o + 3] };
      if (depthAt(i, a) <= 0.0003) continue;
      let dd = STEPS[STEPS.length - 1]; for (const d of STEPS) if (depthAt(i, lifted(a, d)) <= 0.0003) { dd = d; break; }
      del[i] = dd;
    }
    // widen +-5 samples, smooth sigma 4 samples, ramp at contact boundaries (distance in samples to the nearest contact)
    const wide = new Float32Array(N); for (let i = range[0]; i <= range[1]; i++) { let m = 0; for (let j = Math.max(range[0], i - 5); j <= Math.min(range[1], i + 5); j++) m = Math.max(m, del[j]); wide[i] = m; }
    const sig = 4, R = 12; const kw = []; let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); kw.push(w); ks += w; }
    const distC = new Float32Array(N).fill(1e9); let last = -1e9; for (let i = range[0]; i <= range[1]; i++) { if (Rc.mode[i]) last = i; distC[i] = i - last; } last = 1e9; for (let i = range[1]; i >= range[0]; i--) { if (Rc.mode[i]) last = i; distC[i] = Math.min(distC[i], last - i); }
    for (let i = range[0]; i <= range[1]; i++) {
      if (Rc.mode[i]) continue; let v = 0; for (let j = -R; j <= R; j++) { const m = Math.min(range[1], Math.max(range[0], i + j)); v += wide[m] * kw[j + R]; } v /= ks;
      v = Math.max(v, del[i] * 0.999) * Math.min(1, distC[i] / 4); if (v < 0.05 * DEG) continue;
      const o = i * 4; const a = lifted({ mcp: A[o], abd: A[o + 1], pip: A[o + 2], dip: A[o + 3] }, v);
      A[o] = a.mcp; A[o + 2] = a.pip; A[o + 3] = a.dip; fixed++; maxDeg = Math.max(maxDeg, v / DEG);
      const d = depthAt(i, a); if (d > 0.001) { resid++; maxResid = Math.max(maxResid, d); }
    }
  }
  return { fixed, resid, maxResid, maxDeg };
}
/**
 * Final joint-rate limit on the FREE finger samples (critic round 2: framed pops 87 in hand shots, 240 whole piece; most
 * of them at the contact -> free hand-over: 'depart' 86, 'contact' 134 at the last contact sample, 'approach' 20). It
 * runs after every angle pass. Per finger and channel, each maximal free stretch is made r-Lipschitz (r = FREE_RATE_DEG
 * per 240 Hz sample = 840 deg/s, 14 deg per 60 fps frame) while the contact samples on both sides stay exactly as they
 * are (anchors): MCP / PIP / DIP take the LOWER Lipschitz envelope (never less lifted than the clearance passes made
 * them, so no new key contact), abduction and the thumb's channels the mid-point of the lower and upper envelopes
 * (unchanged where the motion is already slow); both are then clamped into the anchors' cones, so the hand-over from the
 * key is at most r per sample too. Mutates REC[s][f].a.
 */
const FREE_RATE_DEG = 3.5;
function freeRateLimit({ REC, range, N }) {
  const r = FREE_RATE_DEG * DEG; let changed = 0, maxDeg = 0, before = 0, after = 0; const big = 8 * DEG;
  const lo = new Float64Array(N), hi = new Float64Array(N);
  for (const s of ['R', 'L']) for (let f = 1; f <= 5; f++) {
    const Rc = REC[s][f]; const A = Rc.a; const M = Rc.mode;
    for (let c = 0; c < 4; c++) {
      const lift = f > 1 && c !== 1;                                   // long finger mcp / pip / dip
      for (let i = range[0] + 1; i <= range[1]; i++) if (Math.abs(A[i * 4 + c] - A[(i - 1) * 4 + c]) > big) before++;
      let i = range[0];
      while (i <= range[1]) {
        if (M[i]) { i++; continue; }
        let j = i; while (j + 1 <= range[1] && !M[j + 1]) j++;
        const a0 = i - 1 >= range[0] ? i - 1 : -1, a1 = j + 1 <= range[1] ? j + 1 : -1;   // contact anchors (or none)
        const x = (k) => A[k * 4 + c];
        // lower / upper envelopes over [a0 .. a1] (anchors included), forward + backward passes
        const s0 = a0 >= 0 ? a0 : i, s1 = a1 >= 0 ? a1 : j;
        for (let k = s0; k <= s1; k++) { lo[k] = k === s0 ? x(k) : Math.min(x(k), lo[k - 1] + r); hi[k] = k === s0 ? x(k) : Math.max(x(k), hi[k - 1] - r); }
        for (let k = s1 - 1; k >= s0; k--) { lo[k] = Math.min(lo[k], lo[k + 1] + r); hi[k] = Math.max(hi[k], hi[k + 1] - r); }
        for (let k = i; k <= j; k++) {
          let y = lift ? lo[k] : 0.5 * (lo[k] + hi[k]);
          if (a0 >= 0) y = Math.min(Math.max(y, x(a0) - r * (k - a0)), x(a0) + r * (k - a0));
          if (a1 >= 0) y = Math.min(Math.max(y, x(a1) - r * (a1 - k)), x(a1) + r * (a1 - k));
          const d = Math.abs(y - x(k)); if (d > 1e-5) { changed++; if (d > maxDeg * DEG) maxDeg = d / DEG; }
          lo[k] = y;                                                     // keep y; written after the stretch
        }
        for (let k = i; k <= j; k++) A[k * 4 + c] = lo[k];
        i = j + 1;
      }
      for (let k = range[0] + 1; k <= range[1]; k++) if (Math.abs(A[k * 4 + c] - A[(k - 1) * 4 + c]) > big) after++;
    }
  }
  return { changed, maxDeg, before, after };
}
/**
 * Finger-finger separation (fix round 3b; critic f2c: R4 up to 5.2 mm inside R3 where 3 lands while 4 leaves, m 74.73,
 * and 4.1 mm on the final chord at m 214.13). The per-sample push acted before the joint-space smoothing,
 * monotoneApproach and freeKeyClearance, which re-introduced the overlaps. This pass runs after all of them on the
 * capsules of the RECORDED angles: where two long fingers of one hand overlap (1 mm padding), the FREE finger yields
 * (abduction away, then the MCP opened as well); with both free, the one whose next touch is later (the departing one,
 * not the landing one). A candidate must not overlap any other finger and must not put the finger's flesh deeper into a
 * key. The correction is widened +-21 ms, smoothed (17 ms) and ramped over 17 ms at contact boundaries (no pops).
 */
function freeFingerSeparation({ hands, REC, palmS, keyArrays, range, N }) {
  let fixed = 0, maxDeg = 0, before = 0, nBefore = 0, after = 0, nAfter = 0;
  const PAD = 0.001, TOL = 0.0003; const x = [0, 0, 0];
  const ABD = [1.5, 3, 5, 8, 12].map((d) => d * DEG), MCPL = [0, 4, 8, 12].map((d) => d * DEG); const MCP_MIN = -12 * DEG;
  for (const s of ['R', 'L']) {
    const H = hands[s];
    const angOf = (f, i) => { const A = REC[s][f].a, o = i * 4; return { mcp: A[o], abd: A[o + 1], pip: A[o + 2], dip: A[o + 3] }; };
    const nextC = {}; for (let f = 2; f <= 5; f++) { const m = REC[s][f].mode; const nc = new Float64Array(N).fill(1e9); let nx = 1e9; for (let i = range[1]; i >= range[0]; i--) { if (m[i]) nx = i; nc[i] = nx; } nextC[f] = nc; }
    const dA = {}, dM = {}; for (let f = 2; f <= 5; f++) { dA[f] = new Float32Array(N); dM[f] = new Float32Array(N); }
    const flagged = [];
    const keyDepth = (f, i, palm, a) => { const fk = H.fingerFK(f, palm, a); if (aboveAllKeys(H, f, fk)) return 0; const T = fingerTransformsOf(H, f, palm, fk); const ka = keyArrays.keys.subarray(i * 88, (i + 1) * 88); let d = 0;
      for (const v of fullFingerSet(H, f)) { skinV(v, T, x); if (x[1] > MAX_KEY_TOP + 0.001) continue; const r = penetrationP(x, ka); if (r.depth > d && r.part !== 'fallboard') d = r.depth; } return d; };
    for (let i = range[0]; i <= range[1]; i++) {
      const palm = { q: palmS[s].q[i], p: palmS[s].p[i] };
      const caps = {}; for (let f = 2; f <= 5; f++) caps[f] = fingerCapsules(H, f, H.fingerFK(f, palm, angOf(f, i)));
      for (const [f, g] of [[2, 3], [3, 4], [4, 5]]) {
        const ov = capsuleOverlap(caps[f], caps[g], PAD); if (ov.depth <= TOL) continue;
        before = Math.max(before, ov.depth); nBefore++; flagged.push(i);
        const mf = REC[s][f].mode[i], mg = REC[s][g].mode[i]; if (mf && mg) continue;
        const mv = mf ? g : mg ? f : (nextC[f][i] > nextC[g][i] ? f : g);
        const a0 = angOf(mv, i); const others = []; for (let h = 2; h <= 5; h++) if (h !== mv) others.push(...caps[h]);
        const d0 = keyDepth(mv, i, palm, a0); let found = null;
        for (const ml of MCPL) { for (const da of ABD) { for (const sg of [1, -1]) {
          const a = { ...a0, abd: a0.abd + sg * da, mcp: Math.max(MCP_MIN, a0.mcp - ml) };
          const o2 = capsuleOverlap(fingerCapsules(H, mv, H.fingerFK(mv, palm, a)), others, PAD); if (o2.depth > TOL) continue;
          if (keyDepth(mv, i, palm, a) > Math.max(0.0003, d0 + 0.0001)) continue;
          found = { da: sg * da, ml }; break; } if (found) break; } if (found) break; }
        if (!found) continue;
        if (Math.abs(found.da) > Math.abs(dA[mv][i])) dA[mv][i] = found.da; if (found.ml > dM[mv][i]) dM[mv][i] = found.ml;
      }
    }
    for (let f = 2; f <= 5; f++) {
      const Rc = REC[s][f]; const A = Rc.a; let any = false; for (let i = range[0]; i <= range[1] && !any; i++) if (dA[f][i] || dM[f][i]) any = true; if (!any) continue;
      const wideA = new Float32Array(N), wideM = new Float32Array(N);
      for (let i = range[0]; i <= range[1]; i++) { let ma = 0, mm = 0; for (let j = Math.max(range[0], i - 5); j <= Math.min(range[1], i + 5); j++) { if (Math.abs(dA[f][j]) > Math.abs(ma)) ma = dA[f][j]; mm = Math.max(mm, dM[f][j]); } wideA[i] = ma; wideM[i] = mm; }
      const sig = 4, R = 12; const kw = []; let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); kw.push(w); ks += w; }
      const distC = new Float32Array(N).fill(1e9); let last = -1e9; for (let i = range[0]; i <= range[1]; i++) { if (Rc.mode[i]) last = i; distC[i] = i - last; } last = 1e9; for (let i = range[1]; i >= range[0]; i--) { if (Rc.mode[i]) last = i; distC[i] = Math.min(distC[i], last - i); }
      for (let i = range[0]; i <= range[1]; i++) {
        if (Rc.mode[i]) continue; let va = 0, vm = 0; for (let j = -R; j <= R; j++) { const m = Math.min(range[1], Math.max(range[0], i + j)); va += wideA[m] * kw[j + R]; vm += wideM[m] * kw[j + R]; } va /= ks; vm /= ks;
        if (Math.abs(dA[f][i]) > Math.abs(va)) va = dA[f][i] * 0.999; vm = Math.max(vm, dM[f][i] * 0.999);
        const ramp = Math.min(1, distC[i] / 4); va *= ramp; vm *= ramp; if (Math.abs(va) < 0.05 * DEG && vm < 0.05 * DEG) continue;
        const o = i * 4; A[o + 1] += va; A[o] = Math.max(MCP_MIN, A[o] - vm); fixed++; maxDeg = Math.max(maxDeg, Math.abs(va) / DEG, vm / DEG);
      }
    }
    for (const i of new Set(flagged)) { const palm = { q: palmS[s].q[i], p: palmS[s].p[i] }; const caps = {}; for (let f = 2; f <= 5; f++) caps[f] = fingerCapsules(H, f, H.fingerFK(f, palm, angOf(f, i)));
      for (const [f, g] of [[2, 3], [3, 4], [4, 5]]) { const ov = capsuleOverlap(caps[f], caps[g], PAD); if (ov.depth > TOL) { nAfter++; after = Math.max(after, ov.depth); } } }
  }
  return { fixed, maxDeg, before, nBefore, after, nAfter };
}
/**
 * Contact points off the neighbour keys (fix round 3; critic f2c: the flesh of playing fingers sat > 1 mm inside the
 * NEIGHBOURING keys in 27 % (white) / 17 % (black) of the poses, R2/R3 squeezed into the black key beside them, L1 into the
 * next white key). For every note the full skinned collision set of the finger is solved onto its key at three moments of
 * the hold (key bottom, middle, just before the release) with the planned palm, and the contact point is moved sideways
 * (+-5.5 mm) and, for long fingers on white keys, toward the key front (-4 / -8 mm), inside the key's contact box, to the
 * position with the least neighbour-key depth (IK error and the shift itself are penalised). One point per note: no sliding
 * within a hold. Mutates n.P0 (the contact-preserving palm, the finger animator and QC all read it).
 */
function shiftContactsOffNeighbours({ H, notes, sm, t0, dt, N, keyAngle, thumbPrefAt }) {
  let moved = 0, tested = 0, before = 0, after = 0, maxBefore = 0, maxAfter = 0;
  const kaAt = (t) => { const ka = new Float32Array(88); for (let q = 0; q < 88; q++) ka[q] = keyAngle(q, t); return ka; };
  const DX = [0, -0.001, 0.001, -0.002, 0.002, -0.003, 0.003, -0.004, 0.004, -0.0055, 0.0055];
  for (const n of notes) {
    if (!n.P0 || !n.f) continue; const f = n.f; const k = KEYS[n.key];
    const ta = n.tm.tKb + 0.008, tc = n.tm.tRel0 - 0.015; if (tc <= ta) continue;
    const tr = (n.tUp ?? n.tm.tRel0 + 0.06) > n.tm.tRel0 + 0.045 ? [n.tm.tRel0 + 0.035] : [];   // riding the rising key
    const ts = [ta, 0.5 * (ta + tc), tc, ...tr].map((t) => { const i = clamp(Math.round((t - t0) / dt), 0, N - 1); return { t, palm: { q: sm.q[i], p: sm.p[i] }, ka: kaAt(t) }; });
    const box = contactBox(n.key, f === 1, H.lat);
    // fix round 3b (critic f2c: R2/R3 squeezed into the black key beside a white key played in the slot, e.g. R3 into Eb5
    // for 2.3 s at m 194.2): a long finger may also move 12 / 16 mm toward the key front, i.e. out of the slot onto the
    // white key's head, where no black key is beside it (the full-set depth search decides; the shift itself is penalised)
    const DZ = f !== 1 && !k.black ? (process.env.PERF_DZ_OLD ? [0, -0.004, -0.008] : [0, -0.004, -0.008, -0.012, -0.016]) : [0];   // PERF_DZ_OLD: A/B diagnostic
    const evalP0 = (P0) => { let dMax = 0, eMax = 0;
      for (const S of ts) { const a = S.ka[n.key]; let p = add(keyPointP(n.key, a, P0), scale(keyNormalP(a), H.pad[f].r)); if (n.padCorr) p = sub(p, n.padCorr);
        const r = f === 1 ? H.solveThumb(S.palm, p, null, thumbPrefAt(n.id, S.t)) : H.solveFinger(f, S.palm, p, null, dipRatioFor(n), null, contactPip(f), null);
        dMax = Math.max(dMax, neighbourDepthFull(H, f, S.palm, r.a, S.ka, n.key)); eMax = Math.max(eMax, r.err); }
      return { dMax, eMax }; };
    const base = evalP0(n.P0); tested++; before += base.dMax; maxBefore = Math.max(maxBefore, base.dMax);
    if (base.dMax <= 0.0006) { after += base.dMax; maxAfter = Math.max(maxAfter, base.dMax); continue; }
    const costOf = (e, dx, dz) => e.dMax + 0.5 * Math.max(0, e.eMax - base.eMax - 0.0003) + 0.05 * Math.hypot(dx, dz);
    let best = { P0: n.P0, e: base, c: costOf(base, 0, 0) };
    for (const dz of DZ) for (const dx of DX) {
      if (!dx && !dz) continue; const P0 = [n.P0[0] + dx, n.P0[1], n.P0[2] + dz];
      if (P0[0] < Math.min(box.x0, n.P0[0]) - 0.0015 || P0[0] > Math.max(box.x1, n.P0[0]) + 0.0015 || P0[2] < Math.min(box.z0, n.P0[2]) || P0[2] > Math.max(box.z1, n.P0[2])) continue;
      const e = evalP0(P0); const c = costOf(e, dx, dz); if (c < best.c - 1e-6) best = { P0, e, c };
    }
    if (best.P0 !== n.P0 && base.dMax - best.e.dMax > 0.0003) { n.P0 = best.P0; moved++; }
    else best = { e: base };
    after += best.e.dMax; maxAfter = Math.max(maxAfter, best.e.dMax);
  }
  return { moved, tested, before, after, maxBefore, maxAfter };
}
/** fix round 3: depth of a finger's flesh in any key other than its own, on ALL vertices the finger's joints dominate
 * (the critic's / anal.mjs' set; influences outside the finger chain are dropped and the weights renormalised), not the
 * sparse colSet that missed most of the side flesh */
function fullFingerSet(H, f) {
  H.colFull = H.colFull || {}; if (H.colFull[f]) return H.colFull[f];
  const allowed = new Set([H.iWrist, ...H.fj[f]]); if (f > 1) allowed.add(H.mc[f]); const dom = new Set(H.fj[f]);
  const out = [];
  for (const v of H.verts) { if (!dom.has(v.dom)) continue; const inf = v.inf.filter((x) => allowed.has(x.j)); const w = inf.reduce((a, x) => a + x.w, 0); if (w < 0.5) continue; out.push({ inf: inf.map((x) => ({ ...x, w: x.w / w })) }); }
  H.colFull[f] = out; return out;
}
function neighbourDepthFull(H, f, palm, a, ka, own) {
  const T = fingerTransformsOf(H, f, palm, H.fingerFK(f, palm, a)); const x = [0, 0, 0]; let d = 0;
  for (const v of fullFingerSet(H, f)) { skinV(v, T, x); if (x[1] > MAX_KEY_TOP + 0.001) continue; const r = penetrationP(x, ka); if (r.key >= 0 && r.key !== own && r.depth > d) d = r.depth; }
  return d;
}
/** fix round 3b (speed): the finger's capsule chain lies wholly above every key top (lowest joint / tip point - 20 mm of
 * flesh): no vertex can be in a key, skip the full-set skinning (the full-piece clearance pass took ~20 min) */
const MAX_KEY_TOP = Math.max(...KEYS.map((k) => k.topY));
function segRmax(H, f) {   // per phalanx: largest distance of its dominated bind vertices from the bind bone segment (+3 mm)
  H.segR = H.segR || {}; if (H.segR[f]) return H.segR[f]; const rig = H.rig; const out = [];
  for (let k = 0; k < 3; k++) { const ji = H.fj[f][k]; const a = rig.bindWP[ji]; const b = k < 2 ? rig.bindWP[H.fj[f][k + 1]] : add(a, qRot(rig.bindWQ[ji], [0, H.caps[f][2].tipLen, 0])); const ab = sub(b, a); let m = 0;
    for (const v of H.verts) if (v.dom === ji) { const t = clamp(dot(sub(v.P, a), ab) / Math.max(1e-12, dot(ab, ab)), 0, 1); m = Math.max(m, len(sub(v.P, add(a, scale(ab, t))))); }
    out.push(m + 0.003); }
  H.segR[f] = out; return out; }
function aboveAllKeys(H, f, fk) { const R = segRmax(H, f); const tip = add(fk[2].p, qRot(fk[2].q, [0, H.caps[f][2].tipLen, 0])); const P = [fk[0].p, fk[1].p, fk[2].p, tip];
  for (let k = 0; k < 3; k++) if (Math.min(P[k][1], P[k + 1][1]) - R[k] <= MAX_KEY_TOP) return false; return true; }
function fingerTransformsOf(H, f, palm, fk) { const T = new Map(); T.set(H.iWrist, palm); if (f > 1) T.set(H.mc[f], H.baseOf(f, palm)); H.fj[f].forEach((j, k) => T.set(j, fk[k])); return T; }
function skinV(v, T, out) { let x = 0, y = 0, z = 0; for (const s of v.inf) { const tr = T.get(s.j); const r = qRot(tr.q, s.local); x += s.w * (r[0] + tr.p[0]); y += s.w * (r[1] + tr.p[1]); z += s.w * (r[2] + tr.p[2]); } out[0] = x; out[1] = y; out[2] = z; return out; }

/**
 * Hand-hand separation (fix round 1). For every sample the two hands are modelled as capsules (fingers in their relaxed
 * shape, or on the keys for contacts, plus the palm); where they come closer than 6 mm the hand that has no finger on a
 * key at that time is moved outward (away from the other hand) and a little up. The required shift is widened over
 * +-0.15 s and smoothed (sigma 70 ms), and is held to zero where that hand touches a key. Mutates palmS.
 */
function separateHands({ hands, palmS, planners, notes, t0, dt, N, range }) {
  const i0 = Math.max(0, range[0] - 120), i1 = Math.min(N - 1, range[1] + 120);
  const busy = {}; for (const s of ['R', 'L']) { const b = new Uint8Array(N); for (const n of notes[s]) { const a = Math.max(i0, Math.floor((touchT(n) - 0.03 - t0) / dt)), e = Math.min(i1, Math.ceil((n.tUp + 0.03 - t0) / dt)); for (let i = a; i <= e; i++) b[i] = 1; } busy[s] = b; }
  const capsOf = (s, i) => {
    const H = hands[s]; const palm = { q: palmS[s].q[i], p: palmS[s].p[i] }; const out = [];
    // fix round 1b: a finger on a key is modelled by a capsule from its base joint to its contact point (the relaxed shape
    // missed the playing thumbs, which reach forward and down: QC f1h 11.8 mm at m 170.87 was invisible here)
    const t = t0 + i * dt; const act = {}; for (const n of notes[s]) if (n.P0 && touchT(n) - 0.02 <= t && t <= n.tUp) act[n.f] = n;
    for (let f = 1; f <= 5; f++) {
      const fk = H.fingerFK(f, palm, H.relaxed(f)); const n = act[f];
      if (n) out.push({ a: fk[0].p, b: add(keyPointP(n.key, 0, n.P0), [0, 0.007, 0]), r: f === 1 ? 0.010 : 0.008 });
      else out.push(...fingerCapsules(H, f, fk));
    }
    const m2 = H.baseOf(2, palm), m5 = H.baseOf(5, palm);
    out.push({ a: palm.p, b: add(m2.p, qRot(m2.q, H.J[H.fj[2][0]].t)), r: 0.014 }, { a: palm.p, b: add(m5.p, qRot(m5.q, H.J[H.fj[5][0]].t)), r: 0.014 });
    return out;
  };
  const gap = 0.010; const need = { R: new Float64Array(N), L: new Float64Array(N) }; let any = false;
  const needB = { R: new Float64Array(N), L: new Float64Array(N) }; let anyB = false;
  for (let i = i0; i <= i1; i += 2) {
    if (Math.abs(palmS.R.p[i][0] - palmS.L.p[i][0]) > 0.30) continue;
    const A = capsOf('R', i), B = capsOf('L', i); let ov = 0;
    for (const a of A) for (const b of B) { const d = a.r + b.r + gap - segSegClosest(a.a, a.b, b.a, b.b).d; if (d > ov) ov = d; }
    if (ov <= 0) continue; any = true;
    const fr = !busy.R[i], fl = !busy.L[i];
    // fix round 1b (QC f1h: 11.8 mm at m 170.87, RH thumb holding E4 while the LH thumb plays D4 next to it): when both
    // hands have fingers on keys, each palm moves sideways (away from the other) by half the overlap, <= 6 mm; the
    // per-sample finger IK keeps the fingertips on their keys (no lift: that would pull the fingers off)
    if (!fr && !fl) { const v = Math.min(0.5 * ov, 0.006); for (const s of ['R', 'L']) { needB[s][i] = Math.max(needB[s][i], v); needB[s][i + 1] = Math.max(needB[s][i + 1], v); } anyB = true; continue; }
    const share = fr && fl ? 0.5 : 1; if (fr) need.R[i] = need.R[i + 1] = ov * share; if (fl) need.L[i] = need.L[i + 1] = ov * share;
  }
  let moved = 0, max = 0;
  if (any) for (const s of ['R', 'L']) {
    const H = hands[s]; const W = Math.round(0.15 / dt); const wide = new Float64Array(N);
    for (let i = i0; i <= i1; i++) { if (!need[s][i]) continue; for (let j = Math.max(i0, i - W); j <= Math.min(i1, i + W); j++) wide[j] = Math.max(wide[j], need[s][i]); }
    const sig = 0.07 / dt, R = Math.ceil(3 * sig); const k = []; let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); k.push(w); ks += w; }
    // zero where the hand is on a key, with 60 ms ramps
    const free = new Float64Array(N); { const rr = Math.round(0.06 / dt); let last = -1e9; for (let i = i0; i <= i1; i++) { if (busy[s][i]) last = i; free[i] = Math.min(1, (i - last) / rr); } last = 1e9; for (let i = i1; i >= i0; i--) { if (busy[s][i]) last = i; free[i] = Math.min(free[i], Math.min(1, (last - i) / rr)); } }
    for (let i = i0; i <= i1; i++) {
      let v = 0; for (let j = -R; j <= R; j++) { const m = Math.min(i1, Math.max(i0, i + j)); v += wide[m] * k[j + R]; } v = v / ks * free[i] * free[i] * (3 - 2 * free[i]);
      if (v < 1e-5) continue; moved++; max = Math.max(max, v);
      palmS[s].p[i] = add(palmS[s].p[i], [H.lat * v * 1.2, v * 0.6, 0]);
    }
  }
  if (anyB) for (const s of ['R', 'L']) {
    const H = hands[s]; const W = Math.round(0.08 / dt); const wide = new Float64Array(N);
    for (let i = i0; i <= i1; i++) { if (!needB[s][i]) continue; for (let j = Math.max(i0, i - W); j <= Math.min(i1, i + W); j++) wide[j] = Math.max(wide[j], needB[s][i]); }
    const sig = 0.05 / dt, R = Math.ceil(3 * sig); const k = []; let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); k.push(w); ks += w; }
    for (let i = i0; i <= i1; i++) {
      let v = 0; for (let j = -R; j <= R; j++) { const m = Math.min(i1, Math.max(i0, i + j)); v += wide[m] * k[j + R]; } v /= ks;
      if (v < 1e-5) continue; moved++; max = Math.max(max, v);
      palmS[s].p[i] = add(palmS[s].p[i], [H.lat * v, 0, 0]);
    }
  }
  let resid = 0;
  if (any) for (let i = i0; i <= i1; i += 4) { if (Math.abs(palmS.R.p[i][0] - palmS.L.p[i][0]) > 0.30) continue; const A = capsOf('R', i), B = capsOf('L', i); for (const a of A) for (const b of B) resid = Math.max(resid, a.r + b.r - segSegClosest(a.a, a.b, b.a, b.b).d); }
  return { moved, max, resid };
}

/** zero-phase Gaussian smoothing of a series (sigma in samples), clamped ends */
function gaussSmooth(a, sig) {
  const N = a.length, R = Math.ceil(3 * sig); const k = new Float64Array(2 * R + 1); let ks = 0;
  for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); k[j + R] = w; ks += w; }
  const o = new Float64Array(N);
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -R; j <= R; j++) { const m = i + j < 0 ? 0 : i + j >= N ? N - 1 : i + j; s += a[m] * k[j + R]; } o[i] = s / ks; }
  return o;
}

/** zero-phase smoothing of the palm path, sigma 12 ms (keeps keyframe timing, removes stop-and-go in dense runs).
 * Fix round 1: was 30 ms, which started the palm moving 60-90 ms before a departing finger had left its key. */
function smoothPalm(ps, qs, P, t0, dt) {
  const N = ps.length; const sig = 0.012 / dt, R = Math.ceil(3 * sig); const k = new Float64Array(2 * R + 1); let ks = 0; for (let j = -R; j <= R; j++) { const w = Math.exp(-0.5 * (j / sig) ** 2); k[j + R] = w; ks += w; }
  for (let j = 0; j < k.length; j++) k[j] /= ks;
  const qref = qs[0]; const ch = [new Float64Array(N), new Float64Array(N), new Float64Array(N), new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  for (let i = 0; i < N; i++) { const r = qLog(qMul(qs[i], qConj(qref))); ch[0][i] = ps[i][0]; ch[1][i] = ps[i][1]; ch[2][i] = ps[i][2]; ch[3][i] = r[0]; ch[4][i] = r[1]; ch[5][i] = r[2]; }
  const sm = ch.map((c) => { const o = new Float64Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let j = -R; j <= R; j++) { const m = i + j < 0 ? 0 : i + j >= N ? N - 1 : i + j; s += c[m] * k[j + R]; } o[i] = s; } return o; });
  const p = new Array(N), q = new Array(N);
  for (let i = 0; i < N; i++) { p[i] = [sm[0][i], sm[1][i], sm[2][i]]; q[i] = qMul(qExp([sm[3][i], sm[4][i], sm[5][i]]), qref); }
  return { p, q };
}
/**
 * Hand world-orientation rate cap (critic round 2: wrist / hand orientation snaps, > 12 deg per 60 fps frame R 6 / L 9
 * frames, e.g. the LH pronated -> knuckles-up in 2 frames at m 175.97). Where the palm path turns faster than
 * ORI_CAP_DEG per 240 Hz sample, its rotation (not its position) is smoothed zero-phase around that event with the
 * smallest sigma (8..48 ms) that brings the event under the cap, blended in and out over one sigma: the turn starts a
 * little earlier and ends a little later, with no lag. The contact-preserving palm nudge runs after this. Mutates sm.q.
 */
const ORI_CAP_DEG = 2.0;   // 480 deg/s = 8 deg per 60 fps frame
function capPalmTurnRate(sm, range) {
  const q = sm.q; const N = q.length; const cap = ORI_CAP_DEG * DEG; let events = 0, worstBefore = 0, worstAfter = 0;
  const step = (i) => qAngleS(q[i - 1], q[i]);
  const i0r = Math.max(1, range[0] - 240), i1r = Math.min(N - 1, range[1] + 240);
  let i = i0r;
  while (i <= i1r) {
    if (step(i) <= cap) { i++; continue; }
    let j = i; while (j + 1 <= i1r && step(j + 1) > cap * 0.7) j++;
    let pk = 0; for (let k = i; k <= j; k++) pk = Math.max(pk, step(k)); worstBefore = Math.max(worstBefore, pk);
    events++;
    let best = null;
    for (const sMs of [8, 14, 20, 28, 36, 48]) {
      const sig = sMs / 1000 * RATE, R = Math.ceil(3 * sig); const a = Math.max(1, i - 2 * R), b = Math.min(N - 2, j + 2 * R);
      const qref = q[Math.round(0.5 * (i + j))];
      const rv = []; for (let k = a - R; k <= b + R; k++) { const m = clamp(k, 0, N - 1); rv.push(qLog(qMul(q[m], qConj(qref)))); }
      const out = [];
      for (let k = a; k <= b; k++) {
        let s0 = 0, s1 = 0, s2 = 0, ws = 0; for (let d = -R; d <= R; d++) { const w = Math.exp(-0.5 * (d / sig) ** 2); const r = rv[k + d - (a - R)]; s0 += w * r[0]; s1 += w * r[1]; s2 += w * r[2]; ws += w; }
        const qs = qMul(qExp([s0 / ws, s1 / ws, s2 / ws]), qref);
        // blend: full inside [i - R, j + R], fading to the original over R samples outside it
        const dOut = k < i - R ? (i - R - k) / R : k > j + R ? (k - j - R) / R : 0; const w = 1 - smoothstep(0, 1, dOut);
        out.push(qSlerpS(q[k], qs, w));
      }
      let pk2 = 0; for (let k = 1; k < out.length; k++) pk2 = Math.max(pk2, qAngleS(out[k - 1], out[k])); pk2 = Math.max(pk2, qAngleS(q[a - 1], out[0]), qAngleS(out[out.length - 1], q[b + 1]));
      best = { a, out, pk2 }; if (pk2 <= cap) break;
    }
    for (let k = 0; k < best.out.length; k++) q[best.a + k] = best.out[k];
    worstAfter = Math.max(worstAfter, best.pk2);
    i = best.a + best.out.length;
  }
  return { events, worstBefore: worstBefore / DEG, worstAfter: worstAfter / DEG };
}
function qAngleS(a, b) { const c = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, c)); }
function qSlerpS(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b;
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b; if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) { const r = [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]; const l = Math.hypot(...r); return r.map((x) => x / l); }
  const th = Math.acos(d), s = Math.sin(th); const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [wa * a[0] + wb * bb[0], wa * a[1] + wb * bb[1], wa * a[2] + wb * bb[2], wa * a[3] + wb * bb[3]];
}
