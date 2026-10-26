// QC of the written performance (research/performance.md 8.9): everything is measured on the float32 output tracks
// (FK of the written quaternions + linear-blend skinning of the GLB hand vertices), not on solver internals.
import fs from 'node:fs';
import path from 'node:path';
import { qMul, qConj, qRot, sub, add, dot, len, DEG, clamp, norm } from './math.js';
import { penetrationP, keyPointP, keyNormalP, KEYS, FALLBOARD_Z } from './pianoGeo.js';
import { twistAngle } from './arm.js';
import { handFeatures, wristAngles } from './palm.js';
import { LIMITS } from './hand.js';

const pct = (arr, p) => { if (!arr.length) return null; const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))]; };

export function runQC(res, { out, command, range, rateQC = 60 } = {}) {
  const { meta, bones, boneData, rootPos, rootS, keyArrays, notes, hands, rig, keyTracks } = res;
  const rootAt = (i) => (rootS ? [rootS[i * 3], rootS[i * 3 + 1], rootS[i * 3 + 2]] : rootPos);
  const N = meta.N, NB = bones.length, dt = meta.dt, t0 = meta.t0;
  const boneIdx = bones.map((b) => rig.idx(b));
  const i0 = range ? meta.range[0] : 0, i1 = range ? meta.range[1] : N - 1;
  const localAt = (i) => { const L = rig.joints.map((j) => j.q); for (let b = 0; b < NB; b++) { const o = (i * NB + b) * 4; L[boneIdx[b]] = [boneData[o], boneData[o + 1], boneData[o + 2], boneData[o + 3]]; } return L; };
  const fkAt = (i) => rig.fk(localAt(i), rootAt(i));
  const keyAnglesAt = (i) => keyArrays.keys.subarray(i * 88, (i + 1) * 88);
  const skin = (H, vr, Q, P) => H.skin(vr, Q, P);
  // ---------------------------------------------------------------- capsules per finger segment (bind mesh radii)
  const caps = {};
  for (const s of ['R', 'L']) {
    const H = hands[s]; caps[s] = [];
    for (let f = 1; f <= 5; f++) for (let k = 0; k < 3; k++) {
      const ji = H.fj[f][k]; const child = k < 2 ? H.fj[f][k + 1] : -1;
      const a = rig.bindWP[ji]; const b = child >= 0 ? rig.bindWP[child] : add(a, qRot(rig.bindWQ[ji], [0, rig.joints[ji].length * 0.85, 0]));
      const ds = H.verts.filter((v) => v.dom === ji).map((v) => segDist(v.P, a, b)).sort((x, y) => x - y);
      const r = ds.length ? ds[Math.floor(ds.length * 0.35)] - 0.0005 : 0.006;
      caps[s].push({ f, k, ji, child, len: child >= 0 ? null : rig.joints[ji].length * 0.85, r });
    }
  }
  const capSeg = (s, c, Q, P) => ({ a: P[c.ji], b: c.child >= 0 ? P[c.child] : add(P[c.ji], qRot(Q[c.ji], [0, c.len, 0])), r: c.r, f: c.f, k: c.k });
  // finger vertex sets (dominant joint per finger)
  const fingerVerts = {};
  for (const s of ['R', 'L']) { const H = hands[s]; fingerVerts[s] = {}; for (let f = 1; f <= 5; f++) { const set = new Set(H.fj[f]); fingerVerts[s][f] = H.verts.filter((v) => set.has(v.dom)).filter((_, k) => k % 2 === 0); } }

  // baseline: the same finger-finger measure in the bind pose (fingers resting side by side touch a little)
  const ffBind = {};
  { const { q: Q, p: P } = rig.fk(null, rootPos);
    for (const s of ['R', 'L']) { const H = hands[s]; const segs = caps[s].map((c) => capSeg(s, c, Q, P)); let worst = 0;
      for (let fa = 1; fa <= 5; fa++) { const vs = fingerVerts[s][fa].map((v) => skin(H, v, Q, P)); for (const sg of segs) { if (sg.f === fa) continue; if (Math.abs(sg.f - fa) === 1 && sg.k === 0 && fa !== 1 && sg.f !== 1) continue; for (const x of vs) worst = Math.max(worst, sg.r - segDist(x, sg.a, sg.b)); } }
      ffBind[s] = +(worst * 1000).toFixed(2); } }
  // ---------------------------------------------------------------- per-note contact error at key bottom (and during the hold)
  const rows = []; const contactErr = []; const holdErr = [];
  for (const n of notes) {
    if (!n.P0 || n.tm.tKb < t0 + i0 * dt || n.tm.tKb > t0 + i1 * dt) continue;
    const H = hands[n.hand];
    const ts = [n.tm.tKb, Math.min(n.tm.tRel0 - 0.005, n.tm.tKb + 0.5 * Math.max(0, n.tm.tRel0 - n.tm.tKb)), n.tm.tFk + 0.3 * (n.tm.tKb - n.tm.tFk)];
    const errs = [];
    for (const t of ts) {
      const s = (t - t0) / dt; const ia = Math.floor(s); const fr = s - ia;
      // evaluate at the nearest sample (the renderer interpolates; at 240 Hz this is < 2 ms)
      const i = fr < 0.5 ? ia : ia + 1;
      const { q: Q, p: P } = fkAt(i); const ang = keyAnglesAt(i)[n.key];
      const nrm = keyNormalP(ang); const p0 = keyPointP(n.key, ang, n.P0);
      let best = 1e9, bp = null;
      for (const v of H.pad[n.f].allDistal) { const x = skin(H, v, Q, P); const d = dot(sub(x, p0), nrm); if (d < best) { best = d; bp = x; } }
      // the lowest point must also lie on this key (inside its top outline at its angle)
      const inside = onKeyTop(n.key, ang, bp);
      errs.push({ d: best, inside, t });
    }
    const eKb = errs[0].d; contactErr.push(Math.abs(eKb)); holdErr.push(Math.abs(errs[1].d), Math.abs(errs[2].d));
    rows.push({ id: n.id, hand: n.hand, finger: n.f, pitch: n.pitch, name: KEYS[n.key].name, t_on: n.t_on, vel: n.vel, touch: n.tm.touch, contact_mm_kb: +(eKb * 1000).toFixed(3), contact_mm_mid: +(errs[1].d * 1000).toFixed(3), contact_mm_press: +(errs[2].d * 1000).toFixed(3), on_key: errs[0].inside ? 1 : 0 });
  }

  // ---------------------------------------------------------------- per-frame checks at the film rate
  const step = Math.max(1, Math.round(1 / (rateQC * dt)));
  const pen = { white: [], black: [], fallboard: [], keyslip: [] }; const worstPen = []; const penCls = {}; const freeByF = {};
  const ff = []; const worstFF = []; const handHand = [];
  const limitViol = []; const wristStats = { R: [], L: [] }; const wristOut = { R: 0, L: 0 }; let frames = 0;
  const angVel = {}; const popCount = {}; let prevLocal = null; let prevI = -1; const prevW = [], prevAcc = []; const jerk = {};
  const freeChecks = { straight: 0, claw: 0, frames: 0 }; let straightC = 0, thumbHyper = 0, mcp70 = 0;
  const tipSpeed = []; let prevTips = null;
  for (let i = i0; i <= i1; i += step) {
    frames++;
    const L = localAt(i); const { q: Q, p: P } = rig.fk(L, rootAt(i)); const ka = keyAnglesAt(i); const t = t0 + i * dt;
    const contactNow = new Map(); // `${hand}${f}` -> key in contact
    for (const n of notes) if (t >= n.tm.tFk && t <= n.tUp) contactNow.set(`${n.hand}${n.f}`, n.key);
    const tips = [];
    for (const s of ['R', 'L']) {
      const H = hands[s];
      // penetration of every hand vertex near the keyboard into keys / fallboard / key slip
      for (const v of H.verts) {
        const x = skin(H, v, Q, P);
        if (x[1] > 0.80 || x[2] < -0.03 || x[2] > FALLBOARD_Z + 0.03) continue;
        const r = penetrationP(x, ka);
        if (r.depth > 0) {
          // classify: the contacting pad on its own key (the contact itself, measured above), a contact finger cutting
          // into another key, a free finger, or the palm
          let vf = 0; for (let f = 1; f <= 5; f++) if (H.fj[f].includes(v.dom)) vf = f;
          const ck = vf ? contactNow.get(`${s}${vf}`) : undefined;
          const cls = !vf ? 'palm' : ck === undefined ? 'free' : ck === r.key ? 'own' : 'neighbor';
          const cat = r.part; const d = r.depth;
          if (cls === 'own' && d < 0.0008) continue;
          pen[cat].push(d); penCls[cls] = penCls[cls] || []; penCls[cls].push(d);
          if (cls === 'free' && d > 0.001) freeByF[`${s}${vf}`] = (freeByF[`${s}${vf}`] || 0) + 1;
          if (d > 0.0005) worstPen.push({ t: +t.toFixed(3), hand: s, part: cat, cls, key: r.key >= 0 ? KEYS[r.key].name : '', contactKey: ck !== undefined ? KEYS[ck].name : '', joint: rig.joints[v.dom].name, mm: +(d * 1000).toFixed(2) });
        }
      }
      // finger-finger: vertices of finger A against capsules of other fingers
      const segs = caps[s].map((c) => capSeg(s, c, Q, P));
      for (let fa = 1; fa <= 5; fa++) {
        const vs = fingerVerts[s][fa].map((v) => skin(H, v, Q, P));
        for (const sg of segs) {
          if (sg.f === fa) continue;
          if (Math.abs(sg.f - fa) === 1 && sg.k === 0 && fa !== 1 && sg.f !== 1) continue; // MCP webbing between neighbours is shared skin
          let worst = 0;
          for (const x of vs) { const d = sg.r - segDist(x, sg.a, sg.b); if (d > worst) worst = d; }
          if (worst > 0) { ff.push(worst); if (worst > 0.001) worstFF.push({ t: +t.toFixed(3), hand: s, finger: fa, into: `${sg.f}-${sg.k + 1}`, mm: +(worst * 1000).toFixed(2) }); }
        }
      }
      // joint limits from the written quaternions
      for (let f = 1; f <= 5; f++) {
        const ang = anatomical(H, L, f);
        const inContact = contactNow.has(`${s}${f}`);
        const lim = f === 1 ? H.thumbLimits() : null;
        if (inContact) { if (f > 1 && ang.pip < (f === 5 ? 8 : 12)) straightC++; if (f === 1 && ang.mcp < 0) thumbHyper++; if (f > 1 && ang.mcp > 70) mcp70++; }
        const chk = (name, v, [lo, hi]) => { if (v < lo - 2 || v > hi + 2) limitViol.push({ t: +t.toFixed(3), hand: s, finger: f, joint: name, deg: +v.toFixed(1), range: [lo, hi] }); };
        if (f === 1) { chk('cmc', ang.cmc, lim.cmc); chk('cmcAbd', ang.cmcAbd, lim.cmcAbd); chk('mcp', ang.mcp, lim.mcp); chk('ip', ang.ip, lim.ip); }
        else {
          chk('mcp', ang.mcp, LIMITS.mcp); chk('pip', ang.pip, LIMITS.pip); chk('dip', ang.dip, inContact ? [5, LIMITS.dip[1]] : LIMITS.dip); chk('abd', ang.abd, LIMITS.abd[f]);
          if (!inContact) { freeChecks.frames++; if (ang.pip < 10) freeChecks.straight++; if (ang.dip > 0.9 * ang.pip + 8 && ang.dip > 30) freeChecks.claw++; }
        }
        tips.push(add(P[H.fj[f][2]], qRot(Q[H.fj[f][2]], [0, rig.joints[H.fj[f][2]].length, 0])));
      }
      // wrist angles relative to the forearm
      const palm = { q: Q[H.iWrist], p: P[H.iWrist] }; const feat = handFeatures(H, palm); const fdir = norm(sub(P[H.iWrist], P[rig.idx('lowerarm01_' + s)]));
      const wa = wristAngles(feat, fdir); const ext = wa.ext / DEG, uln = wa.uln / DEG;
      wristStats[s].push([ext, uln]);
      if (ext > 60 || ext < -54 || uln > 40 || uln < -17) limitViol.push({ t: +t.toFixed(3), hand: s, joint: 'wrist', ext: +ext.toFixed(1), uln: +uln.toFixed(1) });
    }
    // hands against each other
    {
      const sr = caps.R.map((c) => capSeg('R', c, Q, P)), sl = caps.L.map((c) => capSeg('L', c, Q, P));
      let worst = -1; for (const a of sr) for (const b of sl) { const d = a.r + b.r - segSegDist(a.a, a.b, b.a, b.b); if (d > worst) worst = d; }
      if (worst > 0) handHand.push({ t: +t.toFixed(3), mm: +(worst * 1000).toFixed(2) });
    }
    // angular velocity per output bone (deg/s) and per-film-frame pops
    if (prevLocal) {
      const dts = (i - prevI) * dt;
      for (let b = 0; b < NB; b++) {
        const j = boneIdx[b]; const a = qAngle(prevLocal[j], L[j]) / DEG; const w = a / dts;
        const nm = bones[b]; if (!angVel[nm] || w > angVel[nm]) angVel[nm] = w;
        if (/finger/.test(nm) && a > 12) popCount[nm] = (popCount[nm] || 0) + 1;
        // angular jerk (deg/s^3) from the local rotation-vector velocity, by bone group
        const dq = qMul(qConj(prevLocal[j]), L[j]); const sg = dq[3] < 0 ? -1 : 1; const wv = [2 * dq[0] * sg / dts / DEG, 2 * dq[1] * sg / dts / DEG, 2 * dq[2] * sg / dts / DEG];
        const pw = prevW[b]; if (pw) { const acc = [(wv[0] - pw[0]) / dts, (wv[1] - pw[1]) / dts, (wv[2] - pw[2]) / dts]; const pa = prevAcc[b]; if (pa) { const g = /finger|metacarpal/.test(nm) ? 'fingers' : /wrist|arm|clavicle|shoulder/.test(nm) ? 'arms' : /spine|neck|head|root/.test(nm) ? 'torso_head' : 'legs'; (jerk[g] = jerk[g] || []).push(Math.hypot(acc[0] - pa[0], acc[1] - pa[1], acc[2] - pa[2]) / dts); } prevAcc[b] = acc; }
        prevW[b] = wv;
      }
      if (prevTips) for (let k = 0; k < tips.length; k++) tipSpeed.push(len(sub(tips[k], prevTips[k])) / dts);
    }
    prevLocal = L; prevI = i; prevTips = tips;
  }
  // ---------------------------------------------------------------- key timing vs predicted
  const keyTiming = [];
  for (const n of notes) {
    const s = keyTracks.strokes[n.pitch - 21].find((x) => x.id === n.id); if (!s) continue;
    // first sample where the written key reaches >= 99.5 % of the dip
    const dip = KEYS[n.pitch - 21].dipRad; let kbS = null;
    for (let i = Math.max(0, Math.floor((s.tStart - t0) / dt)); i < Math.min(N, Math.ceil((s.tKb + 0.05 - t0) / dt)); i++) if (keyArrays.keys[i * 88 + n.pitch - 21] >= 0.995 * dip) { kbS = t0 + i * dt; break; }
    if (kbS !== null) keyTiming.push((kbS - n.tm.tKb) * 60);
  }
  // ---------------------------------------------------------------- summary
  const pmm = (a, p) => { const v = pct(a, p); return v === null ? 0 : +(v * 1000).toFixed(3); };
  const amax = (a) => { let m = -Infinity; for (const x of a) if (x > m) m = x; return m; };
  const maxmm = (a) => (a.length ? +(amax(a) * 1000).toFixed(3) : 0);
  worstPen.sort((a, b) => b.mm - a.mm); worstFF.sort((a, b) => b.mm - a.mm); handHand.sort((a, b) => b.mm - a.mm);
  const wristOutside = {}; for (const s of ['R', 'L']) { const W = wristStats[s]; const B = meta.bind[s]; wristOutside[s] = { frames: W.length, extP5: +pct(W.map((w) => w[0]), 5).toFixed(1), extP95: +pct(W.map((w) => w[0]), 95).toFixed(1), ulnP5: +pct(W.map((w) => w[1]), 5).toFixed(1), ulnP95: +pct(W.map((w) => w[1]), 95).toFixed(1), bindExt: +B.ext0.toFixed(1), bindUln: +B.uln0.toFixed(1) }; }
  // keys let go earlier than the score's note-off (hand had to leave): inaudible if the pedal holds the dampers up over
  // the rest of the note, otherwise the audio (rendered from the score) sounds longer than the key is down
  // fix round 1: "covered" = the sampler's damper lift (keyArrays.lift, CC 32-76 half-pedal zone, 70 ms slew) stays
  // >= 0.99 from the early release to the note-off (was: CC64 >= 64, which is only ~80 % lift in the sampler)
  const covered = (a, b) => { const ia = Math.max(0, Math.floor((a - t0) / dt)), ib = Math.min(N - 1, Math.ceil((b - t0) / dt)); for (let i = ia; i <= ib; i++) if (keyArrays.lift[i] < 0.99) return false; return true; };
  const early = []; for (const n of notes) { const d = n.t_off - 0.025 - n.tm.tRel0; if (d > 0.010 && (!range || (n.t_on >= t0 + i0 * dt && n.t_on <= t0 + i1 * dt))) early.push({ id: n.id, hand: n.hand, name: n.name, t_off: +n.t_off.toFixed(3), early_ms: Math.round(d * 1000), pedal: d <= 0.030 || covered(n.tm.tRel0, n.t_off), why: n.relWhy || '' }); }
  const unc = early.filter((e) => !e.pedal).sort((a, b) => b.early_ms - a.early_ms);
  const unreachable = []; for (const s of ['R', 'L']) for (const k of res.planners[s].kf) for (const [f, x] of Object.entries(k.sol)) if (x.err > 0.0005) unreachable.push({ hand: s, t: +k.T.toFixed(3), finger: +f, mm: +(x.err * 1000).toFixed(2) });
  const summary = {
    command, frames_checked: frames, qc_rate_hz: Math.round(1 / (step * dt)), notes_checked: rows.length,
    contact_error_mm: { p50: pmm(contactErr, 50), p99: pmm(contactErr, 99), max: maxmm(contactErr), during_hold_p99: pmm(holdErr, 99), during_hold_max: maxmm(holdErr), notes_off_key: rows.filter((r) => !r.on_key).length },
    penetration_mm: Object.fromEntries(Object.entries(pen).map(([k, a]) => [k, { count: a.length, p99: pmm(a, 99), max: maxmm(a), over1mm: a.filter((x) => x > 0.001).length }])),
    free_over1mm_by_finger: freeByF,
    penetration_by_class_mm: Object.fromEntries(Object.entries(penCls).map(([k, a]) => [k, { count: a.length, p99: pmm(a, 99), max: maxmm(a), over1mm: a.filter((x) => x > 0.001).length }])),
    finger_finger_mm: { count: ff.length, p99: pmm(ff, 99), max: maxmm(ff), over1mm: ff.filter((x) => x > 0.001).length, bind_pose_worst: ffBind },
    hand_hand_overlap: { frames: handHand.length, worst_mm: handHand.length ? handHand[0].mm : 0 },
    joint_limit_violations: limitViol.length, joint_limit_examples: limitViol.slice(0, 12), joint_limit_by_joint: limitBreakdown(limitViol),
    free_fingers: { frames: freeChecks.frames, straight_pip_lt10: freeChecks.straight, claw_like: freeChecks.claw },
    wrist_deg: wristOutside,
    peak_angular_velocity_deg_s: Object.fromEntries(Object.entries(angVel).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v)])),
    finger_pops_gt12deg_per_frame: Object.values(popCount).reduce((s, x) => s + x, 0),
    angular_jerk_deg_s3: Object.fromEntries(Object.entries(jerk).map(([g, a]) => [g, { p50: Math.round(pct(a, 50)), p99: Math.round(pct(a, 99)), max: Math.round(amax(a)) }])),
    early_key_releases: { total: early.length, covered_or_within_30ms: early.length - unc.length, audible_mismatch: unc.length, audible_by_mechanism: unc.reduce((o, e) => { o[e.why || '?'] = (o[e.why || '?'] || 0) + 1; return o; }, {}), audible_early_ms_p50: unc.length ? pct(unc.map((e) => e.early_ms), 50) : 0, audible_early_ms_max: unc.length ? unc[0].early_ms : 0, audible_examples: unc.slice(0, 12) },
    pops_240hz: pops240(boneData, bones, NB, i0, i1),
    contact_posture: { straight_pip_frames: straightC, thumb_mcp_below0_frames: thumbHyper, mcp_over70_frames: mcp70 },
    fingertip_speed_m_s: { p99: +(pct(tipSpeed, 99) || 0).toFixed(3), max: +(tipSpeed.length ? amax(tipSpeed) : 0).toFixed(3) },
    key_bottom_vs_predicted_frames: { p50: +(pct(keyTiming.map(Math.abs), 50) || 0).toFixed(2), max: +(keyTiming.length ? amax(keyTiming.map(Math.abs)) : 0).toFixed(2) },
    unreachable_by_span: { count: unreachable.length, examples: unreachable.slice(0, 10) },
    same_finger_timing_conflicts: meta.conflicts,
    fingering: { R: { changed: meta.fingering.R.changed.length, issues: meta.fingering.R.finalIssues.length }, L: { changed: meta.fingering.L.changed.length, issues: meta.fingering.L.finalIssues.length } },
    worst_penetrations: worstPen.slice(0, 15), worst_finger_finger: worstFF.slice(0, 15), worst_hand_hand: handHand.slice(0, 5),
  };
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'qc.json'), JSON.stringify({ summary, notes: rows }, null, 1));
    const hdr = Object.keys(rows[0] || { id: 0 });
    fs.writeFileSync(path.join(out, 'qc.csv'), `# ${command}\n` + hdr.join(',') + '\n' + rows.map((r) => hdr.map((h) => r[h]).join(',')).join('\n') + '\n');
  }
  return { summary, rows };
}

/**
 * single-sample joint pops on the written 240 Hz quaternions (fix round 1, critic definition): a step > 3 deg (and > 8)
 * that is > 2.5x the median of the 6 neighbouring steps, per group (thumb / fingers / arm)
 */
function pops240(boneData, bones, NB, i0, i1) {
  const out = {}; const ang = (o1, o2) => { const c = Math.abs(boneData[o1] * boneData[o2] + boneData[o1 + 1] * boneData[o2 + 1] + boneData[o1 + 2] * boneData[o2 + 2] + boneData[o1 + 3] * boneData[o2 + 3]); return 2 * Math.acos(Math.min(1, c)) / DEG; };
  for (let b = 0; b < NB; b++) {
    const nm = bones[b]; if (!/finger|wrist|lowerarm|upperarm/.test(nm)) continue; const g = /finger1/.test(nm) ? 'thumb' : /finger/.test(nm) ? 'fingers' : 'arm';
    const G = out[g] || (out[g] = { over3deg: 0, over8deg: 0, maxStepDeg: 0 });
    const st = (i) => (i <= i0 || i > i1 ? 0 : ang(((i - 1) * NB + b) * 4, (i * NB + b) * 4));
    for (let i = i0 + 1; i <= i1; i++) {
      const s = st(i); if (s > G.maxStepDeg) G.maxStepDeg = +s.toFixed(2); if (s <= 3) continue;
      const nb = [st(i - 3), st(i - 2), st(i - 1), st(i + 1), st(i + 2), st(i + 3)].sort((x, y) => x - y);
      if (s > 2.5 * 0.5 * (nb[2] + nb[3])) { G.over3deg++; if (s > 8) G.over8deg++; }
    }
  }
  return out;
}

/** violations grouped by hand+finger+joint: frame count, worst excess beyond the limit (deg), first/last time */
function limitBreakdown(list) {
  const g = {};
  for (const e of list) {
    const k = `${e.hand}${e.finger ?? ''}.${e.joint}`; const r = g[k] || (g[k] = { frames: 0, worstExcessDeg: 0, t0: e.t, t1: e.t });
    r.frames++; r.t0 = Math.min(r.t0, e.t); r.t1 = Math.max(r.t1, e.t);
    const ex = e.range ? Math.max(e.range[0] - e.deg, e.deg - e.range[1]) : Math.max((e.ext ?? 0) - 60, -54 - (e.ext ?? 0), (e.uln ?? 0) - 40, -17 - (e.uln ?? 0));
    r.worstExcessDeg = +Math.max(r.worstExcessDeg, ex).toFixed(1);
  }
  return g;
}
export function anatomical(H, L, f) {
  const out = {};
  const names = f === 1 ? ['cmc', 'mcp', 'ip'] : ['mcp', 'pip', 'dip'];
  for (let k = 0; k < 3; k++) {
    const ji = H.fj[f][k]; const I = H.info[f][k]; const d = qMul(qConj(H.J[ji].q), L[ji]);
    let fl = twistAngle(d, I.flex_axis_local) / DEG + I.rest_flex_deg;
    let ab = k === 0 ? twistAngle(d, I.abd_axis_local) / DEG : 0;
    if (k === 0) {
      // exact inverse of the rig formula q = q_bind * R(flex) * R(abd) [* R_y(coupled thumb pronation)]: a swing-twist
      // estimate is biased when both angles are large, so refine (flex, abd) by Gauss-Newton on the written quaternion
      const target = L[ji]; let x = [fl * DEG, ab * DEG];
      const make = (v) => { const a = f === 1 ? { cmc: v[0], cmcAbd: v[1], mcp: 0, ip: 0 } : { mcp: v[0], abd: v[1], pip: 0, dip: 0 }; return H.fingerLocals(f, a)[0]; };
      const resid = (v) => { const q = qMul(qConj(make(v)), target); const s = q[3] < 0 ? -1 : 1; return [q[0] * s, q[1] * s, q[2] * s]; };
      for (let it = 0; it < 8; it++) {
        const r = resid(x); if (Math.hypot(...r) < 1e-7) break; const h = 1e-5;
        const c0 = resid([x[0] + h, x[1]]).map((v, m) => (v - r[m]) / h), c1 = resid([x[0], x[1] + h]).map((v, m) => (v - r[m]) / h);
        const a00 = dot(c0, c0), a01 = dot(c0, c1), a11 = dot(c1, c1), b0 = dot(c0, r), b1 = dot(c1, r); const det = a00 * a11 - a01 * a01; if (Math.abs(det) < 1e-14) break;
        x = [x[0] - (a11 * b0 - a01 * b1) / det, x[1] - (a00 * b1 - a01 * b0) / det];
      }
      fl = x[0] / DEG; ab = x[1] / DEG;
    }
    out[names[k]] = fl;
    if (k === 0) out[f === 1 ? 'cmcAbd' : 'abd'] = ab;
  }
  return out;
}
function onKeyTop(i, ang, p) {
  if (!p) return false; const k = KEYS[i]; const q = keyPointP(i, -ang, p);
  if (k.black) return q[0] >= k.top.x0 - 0.001 && q[0] <= k.top.x1 + 0.001 && q[2] >= k.top.z0 - 0.001 && q[2] <= k.top.z1 + 0.001;
  const inR = (r) => q[0] >= r.x0 - 0.001 && q[0] <= r.x1 + 0.001 && q[2] >= r.z0 - 0.002 && q[2] <= r.z1 + 0.001;
  return inR(k.head) || inR(k.tail);
}
function segDist(p, a, b) { const ab = sub(b, a); const t = clamp(dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab)), 0, 1); return len(sub(p, add(a, [ab[0] * t, ab[1] * t, ab[2] * t]))); }
function segSegDist(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2); const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t; const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  return len(sub(add(p1, [d1[0] * s, d1[1] * s, d1[2] * s]), add(p2, [d2[0] * t, d2[1] * t, d2[2] * t])));
}
const qAngle = (a, b) => { const c = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, c)); };
