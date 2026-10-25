// THE EDIT: the film's shot list as data (DESIGN.md section 4; the human-readable version is docs/SHOTLIST.md,
// generated from this file by sandbox/camera/shotlist.mjs, which adds the MEASURED framing of every shot from
// sandbox/camera/frame_check.mjs next to the intent written here). Loaded by the core's CameraDirector as the camera
// source (exports shotAt / cameraAt / SHOTS); scene/src/camera/index.js is the companion module (sun arc to the world,
// diagnostics).
//
// Every cut is anchored MUSICALLY ('section@bar:beat', resolved through score.json bars at load), so a re-timed
// final score keeps the cuts on the music. Pre-roll and tail are anchored in film time / to the final pedal release.
// Cuts are quantised to the frame at or before the beat (score.js cutTime).
//
// Conventions (details in director.js): positions in the RIG frame (origin = keyboard centre at the key fronts on the
// water; +z toward the tail; -x = treble = the pianist's right). Orbit alpha: 0 = behind the pianist, +90 = treble side.
// `cheat` = rigYawCheatDeg in the core's rotation.y convention: the pianist faces A = 60 - cheat. NOTE refs.md section 4
// quotes cheats in the azimuth convention (ref 3 "-45", ref 4 "-135"); here they are +45 and +135.
// Hand targets (look.track, follow, focus.on.hand) follow the SOLVED performance (hands.js + handtrack.json).
// doc.* is the INTENT; what each shot measurably shows is generated into docs/SHOTLIST.md.
//
// Resume 3 (critic round camera_critique0/1): close-ups restaged on the references' vantage (treble end, lens 7-12 cm
// above the key tops, horizon in the top third: S06/S24 ref 12, S04 ref 7, S09 ref 8), S25 rebuilt on ref 1, S05 ends
// high enough to show the interior (ref 11), S20 split at bar 55, chorus 2 and climax cut denser than chorus 1, a
// hands shot at least every ~20 s while he plays, ref 3 moved from bar 3 to the build's push (no rig rotation between
// two shots of the same mountains), new angles for the climax (overhead lateral track at the apex, crane release).
// Resume 6 (1080p stills of every shot, sandbox/integration/out/v3): S09 restaged outside the treble side (ref 8's
// layout: his back left, glow upper left), S20 from ~60 deg round so he sits beside the keyboard, not on it (ref 6),
// S23 rig turned so he is silhouetted against the glow's reflection (ref 5), S25 from 45 deg down so the lens sees
// under the raised lid (ref 1).
// Resume 7 (critic round 2, build/qc/camera_critique0/r2 + camera_critique1/r2): the high over-the-shoulder look down
// at the keys had become the film's default (7 uses) and the climax its darkest, stillest stretch. Now: one OTS outside
// the climax (S02) and one inside it (S22); S07 gone (S06 holds the whole first hook); new vantages - a low profile
// against the glow (S15), a high view from his right side (S20b), a medium silhouette from his left (S20c; round 9),
// a low behind-left landing for the bridge (S18), an orbit that arrives on the apex F6 with the glow in frame (S21);
// S19 ends on his silhouette against the lit interior and sky; S20 lifts off with the downbeat; S22 -> S23 one
// continuous rise; S25 rises from the blue-hour sky into ref 1. Cuts: off the bar grid where the music says so (S05 on
// the verse's peak F5, S14 on the countermelody's entry); bass/inner pushes no longer split a sounding melody note
// (score.js pushAttack). N per MODULE_ISSUES I-28 (wides 32, S10/S11 48).
// Final freeze 2026-10-24 (integrator, docs/INTEGRATION.md 10.1): N 48 -> 32 in S06 S08 S13 S15 S20b S20c S21 S22 S24
// and 64 -> 32 in S16b (deadline cap; the motion N boost table keeps fast hands <= 1 px per sub-frame); S10 / S11 / S16 keep 48.
import { loadScore, MusicTimeline } from './score.js';
import { buildHandTracks, loadHandTrack } from './hands.js';
import { createDirector } from './director.js';

const PIV = [0, 0, 1.0];            // piano centre on the water (refs.md distances are measured to it)
const HEAD = [0, 1.14, -0.33];      // pianist head (bind pose)

export const EDIT = {
  end: 'pedalUp+5.5s',               // film ends 5.5 s after the final pedal release (reverb tail + fade)
  // cut on the push: when the beat is anticipated (any voice but ghost notes attacked up to 3/4 of a beat early and
  // still sounding across it), the cut moves to the FIRST attack of that push. Longer ties stay on the beat (S17).
  cutOnAnticipation: { maxBeats: 0.75 },
  fades: { in: { dur: 1.6, ev: 9 }, out: { dur: 4.5, ev: 9 } },
  // Sun elevation arc (deg) anchored to the music (DESIGN.md section 2, amended 2026-10-22 by the integrator, I-23):
  // the sun is just below the horizon from the first frame (the plates and the world tuning sit at -1 deg; the old
  // +0.6 deg start washed the opening wides out pink), sinks slowly through the song, and reaches blue hour (ref 1)
  // as the last chord rings out. Monotone cubic, so time only ever moves forward.
  sun: [
    ['f0', -0.8], ['verse1', -0.9], ['chorus1', -1.0], ['chorus2', -1.05], ['bridge', -1.1], ['climax', -1.2],
    ['tag', -1.4], ['finalA', -1.65], ['coda', -2.3], ['pedalUp', -3.9], ['filmEnd', -4.5],
  ],
  shots: [
    // ------------------------------------------------------------------------------------------- PRE-ROLL + INTRO
    {
      id: 'S01', name: 'Vista', ref: 10, at: 'f0', cheat: 0,
      // (resume 7: N 16 -> 32, MODULE_ISSUES I-28: N16 undersamples the water in the wides)
      lens: { mm: 50, fStop: 5.6, N: 32 },
      cam: { orbit: { pivot: PIV, a: [47, 47], d: [31, 27.5], h: [1.18, 1.18] } },
      look: { at: [[0, 1.95, 1.0], [0, 1.86, 1.0]] },
      move: { ain: 0.35, aout: 0, v0: 0.35, v1: 1 },
      doc: {
        framing: 'Extreme wide (ref 10): piano and pianist small just right of centre, horizon in the upper half, mist on the far water, glow in the far valley to the left.',
        move: 'Dolly in 3.5 m along the lens axis, already drifting as the picture fades up; still moving at the cut.',
        focus: 'Deep: on the piano (~29 m), f/5.6.',
        why: 'The world before the first note: 4 s of silence on the vista, then the hook call sounds over a figure too small to read. The slow push says "we are going in".',
        refStatus: 'Matched in layout: horizon 0.56 (ref 0.561), head at (0.45-0.46, 0.56) (ref (0.47, 0.55)), piano about 10 % of the frame width, glow to the left. Difference: our glow sits on the horizon behind the left peaks (x 0.18), ref 10 has a sky glow higher up at (0.14-0.18, 0.38).',
      },
    },
    {
      // (resume 3: was S02 "Notch", ref 3 from directly behind with the rig cheated 45 deg between two unrotated
      //  shots of the same mountains - the piano visibly turned in place at both cuts. Ref 3 now opens S19.)
      // (resume 7: the one high over-the-shoulder set-up kept outside the climax, critic r2)
      id: 'S02', name: 'First touch', ref: null, at: 'intro@3:1', cheat: -30, hands: 'both',
      lens: { mm: 40, fStop: 8, N: 32, preblur: 1.0, nearest: 0.7 },
      cam: { path: [[0.62, 1.82, -0.78], [0.59, 1.78, -0.73]] },
      look: { at: [0, 0, 0], track: { hand: 'both', w: 1, offset: [0.03, 0.02, 0.06] } },
      move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 },
      focus: { on: { hand: 'both' } },
      // pianist look (pianist track, cycle 3; fields read by scene/src/pianist beforeFrame): overhead hands over-lit (c3: p50 68 / 80) -> ~41 / 51; back wool sheen kept at 0.25 (back p50 <= 8)
      pianist: { handEnv: 1.8, handDesat: 0.45, woolSheen: 0.25 },
      doc: {
        framing: 'High over his LEFT shoulder: the dark curls soft at the right edge, both hands on the keys below, the gold interior above them. No horizon, so the cut from the vista is a cut-in, not a turn of the piano.',
        move: 'Slow 10 cm push.',
        focus: 'On both hands (middle of their depth), f/8.',
        why: 'Bars 3-4 answer the hook call (iii9 -> F7, then the suspended close with the fermata): the first time we see who is playing, we see the hands that play it.',
      },
    },
    // ------------------------------------------------------------------------------------------- VERSE 1 (ballad, long takes)
    {
      id: 'S03', name: 'Hero', ref: 2, at: 'verse1@1:1', cheat: 0,
      lens: { mm: 50, fStop: 4, N: 32 },
      cam: { orbit: { pivot: PIV, a: [40, 49], d: [13.2, 12.8], h: [0.5, 0.5] } },
      look: { at: [[-0.25, 0.83, 1.15], [-0.15, 0.82, 1.1]] },
      move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 },
      doc: {
        framing: 'Hero wide (ref 2), low (0.5 m), 3/4 rear treble side: piano left of centre, head on the sky, glow to the left, snowy massif right.',
        move: 'Lateral truck on a 13 m radius, 9 deg arc: the piano stays put while the mountains slide behind it.',
        focus: 'On the pianist (~12.6 m), f/4.',
        why: 'The verse is conversational and low: the hero composition holds for a whole 4-bar phrase so the melody can be heard, not watched.',
        refStatus: 'Matched in layout: low hero wide, piano left of centre, head on the sky, horizon 0.56.',
      },
    },
    {
      // (resume 7: renamed - the music desk is only partly in frame (its top edge sits 20 deg above the lens, outside
      //  any framing that keeps ref 7's hand and horizon; measured in docs/SHOTLIST.md); it ends on the verse's peak)
      id: 'S04', name: 'Right hand, treble side', ref: 7, at: 'verse1@5:1', cheat: -15, hands: 'R',
      lens: { mm: 40, fStop: 5.6, N: 32, preblur: 1.0, nearest: 0.45 },
      cam: { path: [[-1.15, 0.86, -0.45], [-1.09, 0.86, -0.39]] },
      look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0.05, 0.04, 0.05] } },
      follow: { hand: 'R', gain: [0.3, 0, 0] },
      move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 },
      focus: { on: { hand: 'R' } },
      // pianist look (pianist track, cycle 3 r2; fields read by scene/src/pianist beforeFrame): ref 7 hand p10/p50/p90 23 / 58 / 85; handEnv 7 flattened the relief (p10 37, p90 109) -> no kicker, flatter fill split (c3r2b variant f: p10 / p50 / p90 26.2 / 39.9 / 83.1)
      pianist: { handEnv: 7.0, rimKick: 0, handDesat: 0.4, handFillTint: [2.1, 0.7, 0.45], handFillDir: [0.25, 1.0] },
      doc: {
        framing: 'Ref 7: from beside and just behind his right hip, lens 18 cm above the key tops: his dark side on the left, the right hand at centre, the keyboard running to the treble end on the right, the lid and the open interior upper right, lake and sky in the top third with the glow upper left.',
        move: 'Slow 8 cm push toward the treble corner, the slider following the hand\'s register at 30 %.',
        focus: 'Follow focus on the right hand (middle of its depth), f/5.6.',
        why: 'Verse 1 phrase 2 is the melody\'s first real line: the first time we see the hand close, we stay long enough to read the fingering - until the line peaks.',
        refStatus: 'Partial. Matched: his dark side on the left, the right hand at centre, horizon in the top third (ref 0.315), the glow in frame upper left, lens 18 cm above the key tops. Not matched: ref 7\'s music desk mirror (x 0.57-0.9): only its lower corners are in frame (the desk top is ~20 deg above the lens axis; to frame it the hand would drop to the bottom edge and the horizon out of frame), so the lid and interior fill its place upper right.',
      },
    },
    // ------------------------------------------------------------------------------------------- PRE 1 (rising sequence, drop)
    {
      // (resume 3: the crane ended at 1.42 m, 2.6 deg above the rim: lid and case stayed a black silhouette. It now
      //  starts at standing height - no longer a water-level shot like S10 - and rises to 2.1 m.)
      // (resume 4: at 2.1 m / 7.2 m the interior was still a thin dark sliver over the rim; now 2.6 m / 6.0 m, 15 deg
      //  above the rim, widening 40 -> 30 mm so the horizon stays in the upper third. Lab out/lab/r4_d, r4_e.)
      // (resume 7: the cut moves off the bar line onto the verse's peak - the F5 of bar 12 beat 2.5 - and the wide
      //  holds still until the pre-chorus starts the crane; critic r2: the edit followed bar lines, not phrases)
      id: 'S05', name: 'Rise', ref: 11, at: 'verse1@8:2.5', snap: false, cheat: 0,
      lens: { mm: [40, 30], fStop: 5.6, N: 32 },
      cam: { orbit: { pivot: PIV, a: [50, 53], d: [8.5, 6.0], h: [1.0, 2.6] } },
      look: { at: [[0.2, 0.95, 0.8], [0.25, 1.45, 0.9]] },
      move: { span: ['pre1@1:1', 'pre1@4:4'], ain: 0.3, aout: 0.35, v0: 0, v1: 0 },
      doc: {
        framing: 'Ref 11 (mirrored): 3/4 rear treble side, pianist on the bench left, piano right of centre; the crane rises until the lid underside and the gold interior show above the rim, horizon high in frame.',
        move: 'Holds for the verse\'s last two beats, then cranes up 1.6 m with a 2.5 m push, a 3 deg arc and a 40 -> 30 mm widen from the pre-chorus downbeat; settles to rest exactly on the half-beat drop (bar 16 beat 4) and holds through the silence.',
        focus: 'On the piano (~6-8 m), f/5.6.',
        why: 'The cut lands ON the verse\'s highest note (F5, bar 12 beat 2.5) - the line opens out into the wide as it peaks. The pre-chorus climbs by step with repeated notes: the camera climbs with it, and the lit interior opens on the dominant. The crane stopping on the silent half-beat is the held breath before the hook.',
        refStatus: 'Layout matched (mirrored) mid-shot: pianist left on the bench, piano right of centre, horizon 0.37 (ref 0.405). Reveal: at the end the lens is 1.6 m above the rim at 6 m (15 deg), and the 960x540 lab render out/lab/r4_e S05_z30b shows the lid underside, the rim and the interior. Gave up: ref 11 sees the interior from standing height with the horizon at 0.405, which a real lid hinged on the spine does not allow; our end frame has the horizon at 0.22.',
      },
    },
    // ------------------------------------------------------------------------------------------- CHORUS 1 (groove: coverage, hands)
    {
      // (resume 7: holds the whole first hook statement, bars 17-20 (critic r2: let the music set the cut points);
      //  the over-the-shoulder S07 that followed it is gone - it was one of seven high OTS set-ups)
      id: 'S06', name: 'Macro hook', ref: 12, at: 'chorus1@1:1', cheat: -25, hands: 'R',
      lens: { mm: 45, fStop: 11, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.1, nearest: 0.1 },
      cam: { path: [[-0.79, 0.765, 0.035], [-0.725, 0.772, 0.02]] },
      look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0, 0.01, 0.03] } },
      move: { ain: 0.35, aout: 0.35, v0: 0.2, v1: 0.2 },
      focus: { on: { hand: 'R' } },
      // pianist look (pianist track, cycle 3 r2; fields read by scene/src/pianist beforeFrame): ref 12 = dark warm backlit hand, p50 33 / p90 55; handEnv 6 + kicker 2.5 glowed (p50 54, p90 158) -> default fill, thin warm kicker
      pianist: { handEnv: 3.6, rimKick: 0.4, handDesat: 0.4, handFillTint: [2.0, 0.72, 0.5] },
      doc: {
        framing: 'Ref 12: lens 9 cm above the top octave at the treble end, looking down the keyboard: near keys melting at the bottom, the right hand centre-left with the cuff, the fallboard as a long mirror on the right carrying the sky, the music desk above the frame, mountains and sky in the top third (glow behind the bass end: rig cheated -25 deg).',
        move: 'A 6.5 cm creep in along the keyboard over the whole 4-bar hook statement.',
        focus: 'On the right hand (middle of its depth), f/11 so the whole hand, thumb to little finger, is inside the depth of field; the near keys a soft blur.',
        why: 'After the drop the hook enters on the downbeat: we land IN the hook, on the hand that plays it, and stay for the whole first statement (bars 17-20) - the tune is the event, the camera does not interrupt it.',
        refStatus: 'Matched: hand at (0.44, 0.51-0.56), horizon 0.31-0.37, glow in frame, keyboard running away from the bottom, a black mirror on the right. Difference: that mirror is the fallboard; the music desk is above the frame.',
      },
    },
    {
      id: 'S08', name: 'Left-hand stride', ref: null, at: 'chorus1@5:1', cheat: 125, hands: 'L',
      lens: { mm: 70, fStop: 16, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.1, nearest: 0.55 },
      cam: { orbit: { pivot: { hand: 'L', at: 'mid' }, a: [-66, -60], d: [0.92, 0.86], h: [0.98, 0.96] } },
      look: { at: [0, 0, 0], track: { hand: 'L', w: 1, offset: [0.04, -0.01, 0.0] } },
      follow: { hand: 'L', gain: [0.6, 0, 0] },
      move: { ain: 0.3, aout: 0.3, v0: 0.4, v1: 0.4 },
      // (resume 7, critic r2: sharp only 85 % of frames - the focus puller (hand box smoothed 0.25 s) lagged the stride's
      //  30 cm jumps between the bass octave and the tenor shells. Now a quick puller: the box smoothed 0.08 s with a
      //  0.04 s lead, widened over 0.15 s (handtrack boxFast). A 0.6 s union was tried and was worse: 4.6 s readable.)
      focus: { on: { hand: 'L', fast: true, window: 0.15 } },
      doc: {
        framing: 'Bass side, behind-left: the left hand large, jumping between the bass octave and the tenor shells, the cuff, the right hand small beyond; glow behind (rig cheated 125 deg so the bass side is backlit).',
        move: '6 deg drift, 6 cm push, 60 % follow of the hand\'s register.',
        focus: 'Quick follow focus on the left hand (it leads the jumps by 40 ms), f/16.',
        why: 'The hook\'s second statement (bars 21-22): the beat is the left hand. Showing the stride\'s kick-snare pattern makes the hip-hop feel visible.',
      },
    },
    {
      // (resume 3/4/6: see git history of this comment - cheats 100, 55, -9; the case side stayed a dark panel)
      // (resume 7, critic r2: S09 was a second take of S04 (23 cm apart, same lens) and its right third was black.
      //  Restaged on ref 8's geometry: 2 m from the hand, 1.6 m outboard of the treble side and behind his shoulder,
      //  50 mm, so the treble case side runs along the right third seen 70-75 deg off its surface normal (Fresnel
      //  17-39 %, refs.md 2); the rig cheat puts the glow in that grazing reflection. Lab out/lab/r7_a..e: cheats 50/70/80/90,
      //  28/35/50 mm and three positions; cheat 70 at 40 mm gives the brightest mirror (region mean 28 vs 6 at cheat 50).)
      id: 'S09', name: 'Case-side mirror', ref: 8, at: 'chorus1@7:1', cheat: 70, hands: 'R',
      lens: { mm: 40, fStop: 5.6, N: 32, preblur: 1.0, nearest: 1.2 },
      cam: { path: [[-1.62, 0.89, -1.52], [-1.56, 0.89, -1.44]] },
      look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [-0.20, 0.04, 0.22] } },
      move: { ain: 0.3, aout: 0.35, v0: 0.4, v1: 0.2 },
      focus: { on: { hand: 'R' } },
      // pianist look (pianist track, cycle 3 r2; fields read by scene/src/pianist beforeFrame): grazing sleeve too glossy (box p90 17 vs ref 8 5.4; c3r2a sheen 0.22: 13.3) -> less sheen and grazing albedo
      pianist: { woolSheen: 0.16, woolAlbedo: 3.2 },
      doc: {
        framing: 'Ref 8: from 0.8 m outboard of the treble case side and 1.5 m behind the key fronts, lens 21 cm above the key tops, 2.1 m from the hand, 40 mm: his back and head on the left, the right hand at x ~0.35, the treble cheek, then the treble case side as a grazing mirror full of the sunset (x ~0.62-0.82), the lake and the far mountains beyond it, lid and prop top right.',
        move: '10 cm push.',
        focus: 'Follow focus on the right hand, f/5.6 (case side and lake soft).',
        why: 'Bars 23-24 carry the chorus\'s one chromatic surprise and the turnaround; the cut lands with the melody\'s D5 that anticipates bar 23.',
        refStatus: 'Partial. Matched: his back on the left, the hand at (0.35, 0.55), a lacquer mirror of the sunset on the right seen 65-75 deg off its normal (rig cheated 70 deg, lab out/lab/r7_c, r7_e). Not matched: ref 8\'s mirror fills x 0.62-1.0 and carries 25-30 % of the sky radiance (its region mean luma 45, ours 28 at 960x540: the case-side lacquer, MODULE_ISSUES I-08 / I-14); the direct glow upper left (a vertical mirror cannot show the sun it also shows directly - with the glow in the mirror the direct sun is ~70 deg right of the lens axis).',
      },
    },
    // ------------------------------------------------------------------------------------------- VERSE 2 (half verse, long take)
    {
      id: 'S10', name: 'Water glide', ref: 9, at: 'verse2@1:1', cheat: -6,
      // (resume 7: N 32 -> 48, I-28: defocused foreground glints trail in steps at N 32)
      lens: { mm: 50, fStop: 2.8, N: 48, preblur: 1.0, nearest: 0.5 },
      cam: { orbit: { pivot: PIV, a: [51, 53], d: [9.8, 8.0], h: [0.12, 0.12] } },
      look: { at: [[0, 0.40, 1.0], [0, 0.36, 1.0]] },
      move: { ain: 0.3, aout: 0.3, v0: 0.35, v1: 0.35 },
      noise: { rot: [0.3, 0.22, 0.55], pos: 0.006, freq: 0.17, rough: 0.12 },
      focus: { on: HEAD },
      doc: {
        framing: 'Ref 9: lens 12 cm above the water, 3/4 rear: piano large and long against the sky, the pianist in profile from behind, foreground water melting into bokeh.',
        move: 'Glides in 1.8 m over the water like a boat, with a slow floating bob.',
        focus: 'On the pianist\'s head (~7.5 m), f/2.8.',
        why: 'Verse 2 ("lazy walk") is the half verse: one unbroken, floating take keeps the groove relaxed after the chorus\'s cutting.',
        refStatus: 'Matched in layout: lens 12 cm above the water, piano large against the sky, horizon 0.56.',
      },
    },
    // ------------------------------------------------------------------------------------------- PRE 2 (one rising move)
    // (S12, an inside-the-case strings insert, was cut after the first animatic. IDs stay stable: there is no S12.)
    {
      // (resume 7, critic r2: the opening was a black trouser leg over 40 % of the frame with the shoe and the pedal cut
      //  by the bottom edge; the lens now starts further back and lower, pulled toward the tail so the shin leaves the
      //  left edge, tilted down onto the shoe; and it stays behind |alpha| 100 from his back)
      id: 'S11', name: 'Foot to hands', ref: null, at: 'pre2@1:1', cheat: -5, hands: 'R',
      lens: { mm: 65, fStop: 8, N: 48, preblur: 1.1, nearest: 0.5 },
      cam: { path: [[-1.45, 0.10, -0.36], [-1.34, 0.47, -0.42], [-1.02, 0.95, -0.46]] },
      look: { at: [[0.0, 0.20, 0.48], [-0.14, 0.76, 0.10]], track: { hand: 'R', w: [0, 1] } },
      move: { span: ['pre2@1:3', 'pre2@3:3'], ain: 0.4, aout: 0.35, v0: 0, v1: 0 },
      focus: { on: 'look', pulls: [{ at: 'pre2@3:2', dur: 0.8, on: { hand: 'R' } }] },
      doc: {
        framing: 'Opens 10 cm above the water on the treble side, looking up under the keybed: the right shoe on the brass sustain pedal and the micro-rings at the lyre in the lower third, the shin a dark edge at the left, the lyre rods and the piano legs against the mountains and the sunset sky. Ends 20 cm above the keys beside and behind him: the right hand on the treble, the keyboard running away, the lake beyond.',
        move: 'Holds two beats on the pedal, then cranes up 0.8 m (tilting from the foot to the hand) and lands on the hand on bar 31 beat 3, holding through the dominant (bar 32).',
        focus: 'Shoe and pedal, then racks to the right hand as the crane lands (65 mm f/8).',
        why: 'Pre 2 repeats pre 1\'s climb, fuller, and changes pedal on every chord: we start on the foot that pedals, rise with the sequence, and arrive on the hands for the dominant.',
      },
    },
    // ------------------------------------------------------------------------------------------- CHORUS 2 (denser than chorus 1)
    {
      // (resume 3: was a treble-end keyboard-level shot, now the same idea from the BASS end, so it does not repeat S06)
      // (resume 7, critic r2: the two hands stacked into one shape (hand-vs-surround contrast dL 3-6): the lens is 7 cm
      //  higher and 10 cm toward the player, so the far hand clears the near one (screen overlap of the two hands' boxes,
      //  frame_check handOverlap: median 0.81 -> 0.11); the shot now ends where the tenor
      //  countermelody enters (bar 34 beat 3.5), so it stays on the melody hand)
      id: 'S13', name: 'Keyboard level, bass end', ref: null, at: 'chorus2@1:1', cheat: 150, hands: 'R',
      lens: { mm: 45, fStop: 16, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.1, nearest: 0.1 },
      cam: { path: [[0.97, 0.88, -0.10], [0.945, 0.88, -0.10]] },
      look: { at: [0, 0, 0], track: { hand: 'both', w: 1, offset: [0.05, 0.09, 0.03] } },
      move: { ain: 0.3, aout: 0.3, v0: 0.4, v1: 0.4 },
      focus: { on: { hand: 'R' } },
      doc: {
        framing: 'Lens 20 cm above the bass keys at the bass end, looking up the keyboard toward the treble: the left hand near and low at the bottom edge, the right hand beyond and above it on the hook, the fallboard mirror on the left, the glow over the treble end (rig cheated 150 deg).',
        move: '2.5 cm creep in.',
        focus: 'On the right hand (the hook), f/16.',
        why: 'Chorus 2 opens with the hook a second time: from the other end of the keyboard. The shot ends where the tenor countermelody enters in the left hand (bar 34 beat 3.5), and the cut shows it.',
      },
    },
    {
      // (resume 7: cut in on the countermelody's first note, off the bar line - critic r2)
      id: 'S14', name: 'Top-down', ref: null, at: 'chorus2@2:3.5', snap: false, cheat: 0, hands: 'both',
      lens: { mm: 35, fStop: 5.6, N: 32, preblur: 1.0, nearest: 0.9 },
      cam: { orbit: { pivot: [0.02, 0, 0.12], a: [-9, 7], d: [0.58, 0.56], h: [2.32, 2.28] } },
      look: { at: [0.02, 0.68, 0.12], track: { hand: 'both', w: 0.35, offset: [0, -0.04, 0.02] } },
      move: { ain: 0.35, aout: 0.35, v0: 0.3, v1: 0.3 },
      focus: { on: { hand: 'both' } },
      // pianist look (pianist track, cycle 3; fields read by scene/src/pianist beforeFrame): overhead 'pale doll hands' (lead review 3; c3: p50 58 / 52) -> ~43 / 39
      pianist: { handEnv: 2.5, handDesat: 0.5 },
      doc: {
        framing: 'Almost straight down from above the pianist\'s head: the crown of curls at the bottom of frame, the whole keyboard across the frame, both hands, the interior and lid edge at the top. (The film\'s one overhead.)',
        move: 'Slow 16 deg rotation of the frame (orbit about the vertical through the keyboard centre).',
        focus: 'On the hands (~1.6 m), f/5.6.',
        why: 'The cut lands on the tenor countermelody\'s first note (Bb3, bar 34 beat 3.5): from above, the countermelody in the left hand and the hook in the right read like a score through bars 35-36. (A deliberate cut under a held melody note: the D5 of bar 34 beat 3 sounds on for 0.8 s and the countermelody answers it - the cut shows the answer.)',
      },
    },
    {
      // (resume 3: was a near copy of S04; resume 7: the 85 mm right-hip view was the third use of one set-up (S04, S09);
      //  now a NEW vantage: a low profile from his right side, level with the hands, the glow behind him)
      id: 'S15', name: 'Profile against the glow', ref: null, at: 'chorus2@5:1', cheat: -20, hands: 'R',
      lens: { mm: 50, fStop: 8, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.1, nearest: 1.4 },
      cam: { path: [[-2.42, 0.80, -0.66], [-2.28, 0.80, -0.58]] },
      look: { at: [-0.12, 0.86, -0.14], track: { hand: 'R', w: 0.55, offset: [0, 0.03, 0] } },
      move: { ain: 0.25, aout: 0.3, v0: 0.5, v1: 0.4 },
      focus: { on: { hand: 'R' } },
      doc: {
        framing: 'Low profile from his right side, the lens level with the hands about 2.3 m away: his silhouette (head, shoulder, arm) on the left half against the glow, the right hand in profile over the keys at centre, the keyboard and the bass end of the case running away to the lake (rig cheated -20 deg: the glow sits behind his head).',
        move: '16 cm push.',
        focus: 'On the right hand, f/8.',
        why: 'Bars 37-38: the melody doubles in octaves and gets louder; we see the whole player for the first time at hand height - the arm that drives the octaves, against the light.',
      },
    },
    {
      id: 'S16', name: 'Lost profile', ref: null, at: 'chorus2@7:1', cheat: -5,
      // (resume 7: N 32 -> 48: the budget check flags the defocused foreground water (CoC ~32 px), I-28)
      lens: { mm: 135, fStop: 4, N: 48, preblur: 1.0 },
      cam: { orbit: { pivot: [0, 0, -0.33], a: [66, 64], d: [5.6, 5.35], h: [1.0, 1.0] } },
      look: { at: [[0, 1.08, -0.30], [0, 1.07, -0.30]] },
      move: { ain: 0.3, aout: 0.3, v0: 0.3, v1: 0.3 },
      noise: { rot: [0.05, 0.04, 0.06], freq: 0.2, rough: 0.2 },
      focus: { on: HEAD },
      doc: {
        framing: 'Head and shoulders from behind-right, 135 mm, a lost profile: the cheek line turned away, the glow directly behind the head (rig cheated -5 deg), rim light on the curls, mountains soft below. Backlit: the cheek, ear and beard are a dark silhouette edge (they read only in a brightened frame); the face is never lit.',
        move: 'Imperceptible push with a long-lens float.',
        focus: 'On the head, f/4.',
        why: 'Bar 39 (the chromatic turn of the hook\'s last line): one bar of the face we never see. The cut is on the bar line, not on the bass push before it, which would split the sounding F5.',
      },
    },
    {
      // (round 8: N 48 -> 64: on perf 911e the walk-down's fastest leaps step 2.76 px between sub-frames at N 48 on
      //  4 frames (budget.mjs, every frame); N 64 brings them to <= 2.1 px, +3.3k sub-frames)
      id: 'S16b', name: 'Walk-down', ref: null, at: 'chorus2@8:1', cheat: 120, hands: 'L',
      lens: { mm: 85, fStop: 16, N: 32 /* final freeze 2026-10-24: was 64 */, preblur: 1.1, nearest: 0.6 },
      cam: { path: [[1.15, 0.80, -0.62], [1.10, 0.80, -0.57]] },
      look: { at: [0, 0, 0], track: { hand: 'L', w: 1, offset: [0, 0.005, 0] } },
      follow: { hand: 'L', gain: [0.6, 0, 0] },
      move: { ain: 0.3, aout: 0.3, v0: 0.4, v1: 0.4 },
      focus: { on: { hand: 'L', fast: true } },
      doc: {
        framing: '85 mm from behind his left side, level with the left hand: the cuff and the bass keys, backlit (rig cheated 120 deg).',
        move: '7 cm push, following the register.',
        focus: 'Quick follow focus on the left hand\'s walk (it leads the jumps by 40 ms), f/16.',
        why: 'Bar 40 hands the chorus to the bridge with a left-hand walk-down (Eb3-F2-Bb1, then Ab3-G3-F3-Eb3): the bass line that turns the key to C minor.',
      },
    },
    // ------------------------------------------------------------------------------------------- BRIDGE (contrast, long takes)
    {
      id: 'S17', name: 'Bass profile', ref: 4, at: 'bridge@1:1', cheat: 135,
      lens: { mm: 50, fStop: 4, N: 32 },
      cam: { orbit: { pivot: PIV, a: [-62, -62], d: [10.2, 9.8], h: [0.49, 0.49] } },
      look: { at: [[0.18, 0.80, 0.75], [0.18, 0.79, 0.75]] },
      move: { ain: 0.4, aout: 0.4, v0: 0.2, v1: 0.2 },
      focus: { on: HEAD },
      doc: {
        framing: 'Ref 4: bass-side profile silhouette (rig cheated 135 deg): lid and tail to the left, keyboard and pianist on the right, glow behind him.',
        move: 'Locked off in feel: a 0.4 m creep over 13 s.',
        focus: 'On the pianist (~10 m), f/4.',
        why: 'The bridge turns to C minor, half time, rubato: the edit slows down with it. (The one cut across a held melody note, on purpose: chorus 2\'s last Eb5 is tied over the bar line and becomes the third of C minor when the bass lands on bar 41.)',
        refStatus: 'Matched in layout: bass-side silhouette, glow behind him on the right, horizon 0.58.',
      },
    },
    {
      // (resume 3: the tilt now continues to the hands, so the bridge has hands in it)
      // (resume 7, critic r2: it ended high over his right shoulder, one of seven such set-ups. It now stays on the bass
      //  side, like S17 (rig cheat 110 vs 135: the world barely turns at the cut), rises from the reflection and lands
      //  LOW behind his left shoulder at hand height with the glow in frame)
      id: 'S18', name: 'Reflection to hands', ref: null, at: 'bridge@5:1', cheat: 110, hands: 'any',
      lens: { mm: 40, fStop: 5.6, N: 32, preblur: 1.0, nearest: 0.7 },
      cam: { path: [[2.3, 1.15, -2.2], [1.65, 0.95, -1.55], [1.22, 0.98, -1.02]] },
      look: { at: [[0.3, -0.9, 0.2], [0.05, 0.78, 0.25]], track: { hand: 'both', w: [0, 0.8], offset: [0, 0.05, 0.1] } },
      move: { span: ['bridge@5:3', 'bridge@7:1'], ain: 0.45, aout: 0.45, v0: 0, v1: 0 },
      focus: { on: [0.3, -0.9, 0.2], pulls: [{ at: 'bridge@6:1', dur: 1.6, on: { hand: 'both' } }] },
      doc: {
        framing: 'Opens on the water on the bass side: the pianist and piano upside down in the mirror against the glow\'s reflection, ring trains breaking them; tilts up and pushes in to land low behind his left shoulder, level with the hands: both hands on the keys, the open lid and the glow beyond.',
        move: 'Tilt up and push in 1.6 m from bar 45 beat 3, landing on bar 47 (the climb\'s peak, Ab5); then holds on the hands.',
        focus: 'On the reflection, then racks to the hands.',
        why: 'The bridge\'s second phrase climbs to Ab5: the camera rises from the reflection to the hands on the same climb and arrives as the melody peaks.',
      },
    },
    // ------------------------------------------------------------------------------------------- BUILD (the bold move)
    {
      // (resume 7, critic r2: the push ended high over his right shoulder on his black back (mean luma 74 -> 9 over the
      //  crescendo) and his glow-lit face showed in the music desk for 0.7 s. It now ends centred behind his head at
      //  head height: his silhouette against the lit interior, the raised lid and the sky - and his own head covers
      //  his mirror image in the desk)
      id: 'S19', name: 'The push', ref: 3, at: 'build@1:1', cheat: 53,
      lens: { mm: [45, 35], fStop: 4, N: 32, preblur: 1, nearest: 0.9 },
      cam: { path: [[0.0, 0.64, -8.6], [0.0, 0.9, -5.0], [0.0, 1.18, -2.6], [0.0, 1.38, -1.62]] },
      look: { at: [[0, 0.88, 1.0], [0, 1.1, 1.0]] },
      move: { span: [null, 'build@4:4'], ain: 0.75, aout: 0.2, v0: 0.15, v1: 0 },
      focus: { on: [0, 1.0, 0.4] },
      doc: {
        framing: 'Opens on ref 3: centred from directly behind at key-front height, piano and pianist bilaterally symmetric, the glow beside the lid (rig cheated 53 deg). Ends centred behind his head, 1.3 m back and 24 cm above it: his silhouette in the lower centre, the music desk, the lit interior and the raised lid, the glow just above the desk\'s top edge and the sky over the lid (from head height the desk hid the glow).',
        move: 'One accelerating push of 7 m with a 0.74 m rise (speed builds with the accelerando), easing to rest exactly on the silent fermata (bar 52 beat 4) and holding the silence; 45 -> 35 mm.',
        focus: 'On the music desk / his head (f/4): the push ends on him, not on his hands.',
        why: 'The build is a C pedal, crescendo and accelerando into a one-beat silence: the camera is the crescendo. It stops when the music stops, face to face with the light he plays into.',
        refStatus: 'Opening frame matched: centred from behind, symmetric, horizon 0.56. Not matched: the sun is 1.1 deg below the horizon at this point of the evening, so it is a glow at (0.35, 0.60) beside the lid, not a disc in a ridge notch.',
      },
    },
    // ------------------------------------------------------------------------------------------- CLIMAX (re-blocked, resume 7)
    // Critic r2: the musical peak was the darkest, stillest stretch (mean luma 18.9; four look-alike top-down shots of
    // dark keys, the cuts into S20c/S21/S22 the least visible of the film, speeds 0.05-0.15 m/s, the apex F6 in a
    // near-black overhead). Now: a rising crane on the downbeat, a high treble-side orbit over the hands, a left-side
    // medium silhouette against the glow, an orbit that arrives on the apex with the glow in frame, and ONE high
    // over-the-shoulder insert (round 9: S20b / S20c no longer repeat the S04 and S16b set-ups).
    {
      id: 'S20', name: 'Drone rise', ref: 6, at: 'climax@1:1', cheat: 0,
      lens: { mm: 35, fStop: 5.6, N: 32, preblur: 0.8 },
      cam: { orbit: { pivot: [0, 0, 0.9], a: [66, 44], d: [3.6, 6.0], h: [1.45, 4.8] } },
      look: { at: [[0.0, 0.95, 0.5], [0.4, 0.3, 0.75]] },
      move: { ain: 0.12, aout: 0.4, v0: 0.6, v1: 0.15 },
      focus: { on: [0, 0.8, 0.6] },
      doc: {
        framing: 'Opens beside him on the treble side at 1.5 m, piano and pianist against the lake and sky; cranes up and swings behind to ref 6: high on the treble side, ~54 deg round from his back and ~36 deg down, the whole instrument with its lit interior on a steep diagonal, the pianist at the keyboard\'s near end, rings to the frame edges.',
        move: 'A rising crane of 3.4 m with a 22 deg orbit and a 2.4 m pull-back, already moving on the downbeat after the fermata (peak ~1 m/s), decelerating over bar 54.',
        focus: 'Deep (f/5.6), on the piano.',
        why: 'The climax lands a whole step up after the silence: release means space. The camera lifts off with the downbeat and the rings - every note\'s energy - fill the lake.',
        refStatus: 'Ref 6 is the end frame: ~54 deg round from his back, 36 deg down, head at (0.43, 0.46) (ref (0.465, 0.40)), the piano and its lit interior right of centre, rings to the edges (lab out/lab/r7_a S20_z). Differences: our lake carries sparser, dimmer cloud reflections than ref 6 (world sky, I-19) and he reads darker against the water (rim light asked, MODULE_ISSUES C-03).',
      },
    },
    {
      // (round 9, look at anim8: the key-level slider at the treble end sat 18 cm from S04's set-up with the same 40 mm
      //  and the same picture (his dark side left, the hand centre, lid upper right): a second take of S04. Now the one
      //  treble-side HIGH view of the film: 1.5-1.7 m up, ~1.5 m out, looking down ~27 deg across both hands. Lab
      //  out/lab/r9_a, r9_b (variants bA-bD; cheat 0/-20/-40/-60/-75): -40 puts pink cloud light on the water behind him.)
      id: 'S20b', name: 'Treble side, high', ref: null, at: 'climax@3:1', cheat: -40, hands: 'R',
      lens: { mm: 40, fStop: 8, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.1, nearest: 0.5 },
      cam: { orbit: { pivot: [-0.25, 0.73, 0.08], a: [80, 58], d: [1.55, 1.45], h: [1.7, 1.5] } },
      look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0.04, 0.0, 0.06] } },
      move: { ain: 0.15, aout: 0.3, v0: 0.6, v1: 0.3 },
      focus: { on: { hand: 'R' } },
      // pianist look (pianist track, cycle 3 r2; fields read by scene/src/pianist beforeFrame): high view: less flat fill; kicker 1 made the hand the brightest object (p90 122; c3r2a kick 0.4: 94) -> 0.25
      pianist: { handEnv: 2.8, rimKick: 0.25 },
      doc: {
        framing: 'High on his right side, ~1.5 m out and 0.8-1 m above the keys, looking down ~27 deg: his dark side and the curls on the left against the lit water, both hands on the keyboard, which runs up the frame as a diagonal to the bass end, the music desk at the top and the open case on the right. The hands are seen from the side and above, so the finger curvature and the keys going down read.',
        move: 'A 22 deg orbit round the right hand on a 1.5 m radius, descending 0.2 m, moving at the cut.',
        focus: 'On the right hand, f/8.',
        why: 'Bar 55, the second climax phrase, starts at the top (C6, the loudest downbeat so far) and runs down: we cut in from the drone\'s height to the hands, still above them, and come down with the line.',
      },
    },
    {
      // (round 9, look at anim8: the key-height view from his left side started 15 cm from S16b\'s set-up and ended 12 cm
      //  from S08\'s: the left-hip position carried four shots (S08, S13, S16b, S20c). Now a MEDIUM from 2.4 m on his
      //  left, level with the hands: his left profile as a silhouette against the glow and its reflection, the whole
      //  instrument front on the left. Lab out/lab/r9_a, r9_b: cheats 135 / 142 / 150.)
      id: 'S20c', name: 'Left silhouette', ref: null, at: 'climax@4:1', cheat: 142, hands: 'L',
      lens: { mm: 50, fStop: 8, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.1, nearest: 1.0 },
      cam: { orbit: { pivot: [0.2, 0.8, 0.0], a: [-56, -84], d: [2.4, 2.35], h: [1.12, 1.05] } },
      look: { at: [0, 0, 0], track: { hand: 'both', w: 1, offset: [0.0, 0.14, -0.1] } },
      move: { ain: 0.15, aout: 0.3, v0: 0.6, v1: 0.4 },
      focus: { on: { hand: 'L', fast: true, window: 0.15 } },
      // pianist look (pianist track, cycle 3 r2; fields read by scene/src/pianist beforeFrame): silhouette: less flat fill, glow-side modelling (kicker 1 -> 0.5: p90 97)
      pianist: { handEnv: 2.8, rimKick: 0.5 },
      doc: {
        framing: 'Medium from 2.4 m on his left, the lens level with the hands: his left profile, shoulders and arms a silhouette against the glow and its reflection on the lake (rig cheated 142 deg), the keyboard and the music desk on the left with the lid raised above them, the left hand near on the octave pushes; the orbit ends with the glow behind the hands.',
        move: 'A 28 deg orbit from behind his left shoulder to his side on a 2.4 m radius (~1.2 m of travel, peak ~0.5 m/s).',
        focus: 'Quick follow focus on the left hand, f/8.',
        why: 'Cut ON the push: bar 56 is anticipated by the bass and melody on the "and" of 4 of bar 55 - the cut lands with that syncopation and opens the frame onto the light: the whole player at the top of the climax, before the apex climb.',
      },
    },
    {
      // (N 32 -> 48: MODULE_ISSUES I-44, fast-hand edges stepped > 2 px apart at N 32)
      id: 'S21', name: 'Apex', ref: null, at: 'climax@5:1', cheat: 12, hands: 'R',
      lens: { mm: 35, fStop: 8, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.0, nearest: 1.2 },
      cam: { orbit: { pivot: [-0.25, 0.75, 0.1], a: [78, 40], d: [2.35, 2.1], h: [0.92, 1.22] } },
      // (round 8: the end aim is 0.4 m higher - anim7 showed the F6 frame with the horizon at the top edge (0.19) and only a
      //  sliver of sky (mean luma 25); now the horizon sits at 0.33 with the glow beside his head and the hands lower)
      look: { at: [[-0.15, 0.82, 0.25], [-0.12, 1.35, 0.35]], track: { hand: 'R', w: 0.55 } },
      move: { span: [null, 'climax@6:1.5'], ain: 0.2, aout: 0.35, v0: 0.6, v1: 0 },
      focus: { on: { hand: 'R' } },
      doc: {
        framing: 'Medium, from his right side at hand height, orbiting behind him: the pianist dark against the lake, the right hand climbing the treble; the orbit arrives behind his right shoulder and tilts up so the sky fills the top third and his head is silhouetted on the horizon beside the glow, the right hand on the treble below.',
        move: 'A 38 deg orbit on a 2.2 m radius rising 0.3 m (peak ~0.6 m/s), arriving and settling exactly on the apex F6 (bar 58 beat 1.5), then holding through the descent.',
        focus: 'On the right hand, f/8.',
        why: 'Bars 57-58 carry the piece\'s single apex: the camera travels with the climbing line and opens onto the light at the top note, then holds still while it rings.',
      },
    },
    {
      // (resume 3: was a near copy of S08; now the climax's release - close on the octaves, then a crane out)
      // (resume 7: the climax's ONE high over-the-shoulder insert; the crane now decelerates into the cut and S23
      //  continues the same rise and pull-back, critic r2: opposing motion across the tag downbeat)
      id: 'S22', name: 'Release', ref: null, at: 'climax@7:1', cheat: -30, hands: 'L',
      lens: { mm: [40, 30], fStop: 5.6, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.0, nearest: 0.45 },
      cam: { path: [[0.52, 1.45, -0.66], [1.1, 2.1, -1.5], [1.9, 2.8, -2.6]] },
      look: { at: [[0.25, 0.72, 0.1], [0.0, 0.6, 0.9]], track: { hand: 'L', w: [1, 0], offset: [0, 0.01, 0.04] } },
      move: { span: ['climax@8:1', null], ain: 0.45, aout: 0.35, v0: 0, v1: 0.35 },
      focus: { on: { hand: 'L' }, pulls: [{ at: 'climax@8:2', dur: 1.4, on: [0, 0.8, 0.6] }] },
      // pianist look (pianist track, cycle 3 r2; fields read by scene/src/pianist beforeFrame): overhead like S02 / S14 (critic: no override -> palest hands, p50 74; c3r2a handEnv 2.0: 51) -> less fill
      pianist: { handEnv: 1.6, handDesat: 0.45 },
      doc: {
        framing: 'Opens close over his left shoulder on the left-hand octave pushes (bar 59), then cranes up and back until piano and pianist sit in the ring field.',
        move: 'Holds bar 59, then a 2.7 m crane out over bar 60 that slows toward the cut; the tag shot continues the same rise and pull-back.',
        focus: 'On the left hand, then racks to the piano as the crane rises.',
        why: 'Bars 59-60 are the turnaround driven by the left-hand octaves: we stay on them, then let go as the line resolves into the tag.',
      },
    },
    // ------------------------------------------------------------------------------------------- TAG
    {
      // (resume 6: rig cheat 0 -> 18 so the glow and its reflection column sit just left of the piano and the pianist is
      //  silhouetted against the bright reflected band, as in ref 5; S22 ends with no horizon, so the turn is hidden)
      // (resume 7: rises and pulls back, continuing S22's crane, and settles as the chord decays (was descending and
      //  moving in: a bump against S22's motion on the first fortissimo tonic, critic r2); N 16 -> 32, I-28)
      id: 'S23', name: 'Elevated vista', ref: 5, at: 'tag@1:1', cheat: 18,
      lens: { mm: 33, fStop: 5.6, N: 32 },
      cam: { orbit: { pivot: PIV, a: [38, 40], d: [10.8, 11.4], h: [2.0, 2.6] } },
      look: { at: [[0, 0.80, 1.0], [0, 0.92, 1.0]] },
      move: { ain: 0.1, aout: 0.65, v0: 0.6, v1: 0 },
      focus: { on: [0, 0.8, 1.0] },
      doc: {
        framing: 'Ref 5: elevated wide, piano and pianist small near the centre, the glow just left of the lid and its reflection running down the water behind him, horizon high, the ring field filling the foreground.',
        move: 'Continues the release: rises 0.6 m and pulls back 0.6 m, decelerating to rest as the chord decays.',
        focus: 'Deep, f/5.6.',
        why: 'The tag is the first fortissimo tonic of the piece, then it decays: we keep pulling back to see the rings it made travel across the whole lake.',
        refStatus: 'Matched in layout (numbers in the measured line); the water nearest the camera is darker than ref 5\'s, whose whole lake carries bright cloud reflections (world sky).',
      },
    },
    // ------------------------------------------------------------------------------------------- FINAL A (bare, pp)
    {
      // (resume 7, critic r2: the hand sat on the fallboard's bright mirror band (dL 1.2): the lens now rises 9 cm as it
      //  backs out, so the hand is seen against the dark keys and key fronts, and the sky in the top third darkens)
      id: 'S24', name: 'Bare hand', ref: 12, at: 'finalA@1:1', cheat: -25, hands: 'R',
      lens: { mm: 50, fStop: 11, N: 32 /* final freeze 2026-10-24: was 48 */, preblur: 1.1, nearest: 0.1 },
      cam: { path: [[-0.64, 0.775, 0.04], [-1.12, 0.86, -0.05]] },
      look: { at: [0, 0, 0], track: { hand: 'R', w: 1, offset: [0, 0.0, 0.02] } },
      move: { ain: 0.3, aout: 0.4, v0: 0.2, v1: 0.3 },
      focus: { on: { hand: 'R' } },
      // pianist look (pianist track, cycle 3 r2; fields read by scene/src/pianist beforeFrame): ref 12 p50 33 / p90 55; handEnv 6 + kicker 2.5 glowed (p50 45, p90 137) -> near-default fill, thin warm kicker
      pianist: { handEnv: 4.0, rimKick: 0.4, handDesat: 0.4, handFillTint: [2.0, 0.72, 0.5] },
      doc: {
        framing: 'The bookend of S06 (ref 12), staged as a move: starts over the top octave close on the right hand alone, and slowly backs out and up past the treble cheek until the hand is small against the dark keys, the fallboard mirror and the darkening sky.',
        move: 'Dolly back 0.5 m along the keyboard line, rising 9 cm.',
        focus: 'Follow focus on the right hand (middle of its depth), f/11.',
        why: 'The final A is the hook alone, single line, pp: one long take of one hand playing the tune\'s last turn, as bare as the music. The camera backing away starts the goodbye.',
        refStatus: 'Ref 12 family by design (the bookend of S06): starts on the same vantage and backs away.',
      },
    },
    // ------------------------------------------------------------------------------------------- CODA + TAIL (blue hour)
    {
      // (resume 4/6: see the comments of earlier versions; resume 7, critic r2: the 19.8 s shot was a still (0.06 m/s),
      //  the blue hour arrived by cut, the pianist unreadable. It now OPENS low with the darkening sky in the top of frame
      //  and rises 3 m while orbiting 10 deg and rolling into ref 1's diagonal: the blue hour is seen arriving, and the
      //  move ends on ref 1 as the last note rings; N 16 -> 32, I-28)
      id: 'S25', name: 'Blue hour', ref: 1, at: 'coda@2:1', cheat: -20,
      lens: { mm: 40, fStop: 5.6, N: 32 },
      cam: { orbit: { pivot: [0, 0, 0.9], a: [46, 56], d: [6.6, 4.8], h: [2.3, 5.4] } },
      // (round 8: end aim moved 0.5 m so his head lands at (0.41, 0.58) like ref 1's (0.42, 0.62) instead of (0.34, 0.56);
      //  the whole case still fits: lid tip (0.67, 0.24), tail (0.75, 0.15); sandbox/camera/q.mjs)
      look: { at: [[0.1, 1.55, 1.1], [0.45, 0.6, 0.6]] },
      roll: [0, -14],
      move: { span: [null, 'm222.5'], ain: 0.2, aout: 0.4, v0: 0.4, v1: 0 },
      focus: { on: [0, 0.8, 0.7] },
      doc: {
        framing: 'Opens behind him on the treble side at 2.3 m with the darkening blue-hour sky and the mountains in the top of frame; rises into ref 1: from high on the treble side, ~45 deg down, the piano on a diagonal running up to the right, the keyboard across its near end with him at its bass end and both hands on the keys, the open gold interior under the raised lid, rings on dark navy water.',
        move: 'Rises 3.1 m, closes in 1.8 m and orbits 10 deg while the frame rolls 14 deg into the diagonal (about 0.3 m/s), settling as the last melody note resolves; held through the ring-out and the fade.',
        focus: 'Deep, f/5.6.',
        why: 'The cut lands on the F5 pickup that leans into the coda\'s minor plagal turn (Bbm6): the bittersweet chord is where the evening lets go, so the camera lets go of the hands and rises. We see the sky go to blue hour before the frame leaves it, and the line\'s last resolution and the ring happen in the overhead while the sun sinks to -4.5 deg.',
        refStatus: 'Partial. Matched: the piano on a diagonal running up to the right, the gold interior open, him and his hands at the keyboard\'s near end, rings on navy water (numbers in the measured line). Not matched: ref 1 looks steeper (55-65 deg down) and still sees the interior, which needs a lid opened far wider than our 33 deg full stick: from 55-62 deg down our lid top covers most of the case (lab out/lab/r6_c S25_a..c); so we look from 45 deg and further round to the treble side; his head ends at (0.41, 0.58) (ref (0.42, 0.62)) but beside the bass end of the keys instead of below them. The keys lack ref 1\'s light (white keys L* ~90 in ref 1, ~10-30 here: lighting, not framing).',
      },
    },
  ],
};

// ------------------------------------------------------------------------------------------------ build
// Score pinning (renders must not pick up a score the composer rewrites mid-render): import this module as
// shots.js?score=<url> (AG.init({ cameraModule })) or set AG_SCORE (Node env); the pin is published on globalThis so
// every other importer of shots.js in the page (camera/index.js) resolves the same score.
// Same for the hand track (shots.js?handtrack=<url>|none, AG_HANDTRACK): the camera follows the SOLVED hands of the
// performance that is rendered (hands.js; regenerate with sandbox/camera/handtrack.mjs after a new perf solve).
const QS = (() => { try { return new URL(import.meta.url).searchParams; } catch { return new URLSearchParams(); } })();
const PIN = QS.get('score');
if (PIN) globalThis.AG_SCORE = PIN;
if (QS.get('handtrack')) globalThis.AG_HANDTRACK = QS.get('handtrack');
const { score, url } = await loadScore();
export const SCORE_URL = url;
export const timeline = new MusicTimeline(score, url);
const HT = await loadHandTrack();
export const hands = buildHandTracks(score, {}, HT.track);
export const HANDTRACK_URL = HT.url;
// No silent change of source (critic camera_critique1 r2): when the default or a pinned hand track cannot be used (404,
// fetch error, bar-timing mismatch) the camera would frame and focus several cm away from what the checks measured, so
// loading FAILS. The score proxy runs only when asked for: handtrack 'none', or the fallback opt-in
// (shots.js?handtrackFallback=proxy, globalThis.AG_HANDTRACK_FALLBACK = 'proxy', or env AG_HANDTRACK_FALLBACK=proxy).
const FALLBACK_OK = QS.get('handtrackFallback') === 'proxy' || globalThis.AG_HANDTRACK_FALLBACK === 'proxy'
  || (typeof window === 'undefined' && globalThis.process?.env?.AG_HANDTRACK_FALLBACK === 'proxy');
if (hands.source !== 'perf' && HT.url !== 'none' && !FALLBACK_OK) {
  throw new Error(`camera: hand track ${HT.url} cannot be used (${hands.why || 'not loaded'}); regenerate it with ` +
    'node sandbox/camera/handtrack.mjs --perf build/anim, or opt into the score proxy with handtrackFallback=proxy');
}
export const director = createDirector(EDIT, timeline, hands);
export const SHOTS = director.SHOTS;
export const FILM_END = director.filmEnd;
export const FILM_FRAMES = director.FILM_FRAMES;
export const shotAt = (t) => director.shotAt(t);
export const cameraAt = (t, raw) => director.cameraAt(t, raw);
export const SUN_KEYS = director.sunDenseKeys;
