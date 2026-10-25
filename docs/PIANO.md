# PIANO module (`scene/src/piano/`)

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

Procedural D-class concert grand (2.74 x 1.56 m) plus the artist bench, with every part of research/piano.md, built
for extreme close-ups, and the animation API the performance solver drives. No textures are downloaded; nothing in it
needs a credit (docs/CREDITS.md). No brand names: the fallboard is blank and the plate cartouche is an empty oval.

| file | what |
|---|---|
| `index.js` | the module: `create(ctx)` (DESIGN.md / RENDERING.md interface), setters, perf-track reader, env probe, fill light |
| `layout.js` | **pure data** for the solver (no three.js; runs in Node 22): keys, balance axis, dips, contact regions, black-key boxes, pedals, bench, frames |
| `layout_d.json` | the generated D layout (case, rim, keyboard, 88 notes, strings, bridges, plate, struts, holes, bolts, ribs, braces, legs, lyre, bench, lid, desk) |
| `materials.js` | MeshPhysicalMaterial set (research/piano.md section 11) with procedural micro-detail, interior/key occlusion and the interior fill light |
| `geom/*.js` | builders: `case` (rim, arms, cheeks, key slip, fallboard, desk, lid, flap, hinges, prop), `keys`, `stringing` (string paths), `strings`, `interior` (soundboard, ribs, braces, belly rail, bridges, plate, struts, agraffes, capo, pressure bar, pins, felts), `action` (hammers, shanks, flanges, rails, dampers), `legs` (legs, ferrules, casters, lyre, pedals), `bench`, `mirror` (planar desk mirror), `util` |
| `lookdev/sunsetEnv.js` | LOOK-DEV ONLY procedural sunset environment for the old standalone harness (not used with the real world module) |

Generators: `tools/piano/gen_layout_d.py` (venv python) writes `layout_d.json` plus `sandbox/piano2/plan_d.png` and
`plan_d_overlay.png` (the plan drawn over the INRIA Steinway D photo). D specifics: INRIA RT-0425 measured speaking
lengths and strike distances (C1-B7; A0-B0, C8 extrapolated), the piano.md 3.2 D outline (rim 0.0555), a 20-note
bass bridge (1-8 single, 9-20 bichord, copper wound) crossing over the tenor (bass +9 -> +12 deg, tenor -6.5 -> 0 deg),
strike line and belly rail measured on the photo, struts routed through the hammer-section gaps, 8 flanged holes +
an oval slot traced on the photo. Keyboard, action and every height are exactly research/piano.md (sections 5, 6, 12).

## 1. Frames

- **Piano frame** (research/piano.md section 0): metres, origin on the floor (= lake bed) below the front-left case
  corner, x along the keyboard bass -> treble, z toward the tail, y up. With y up this frame is **left-handed**.
- The module's `group` is already placed in the **rig frame**: position (0.780, -0.04, 0), scale (-1, 1, 1), i.e.
  `rig = (0.780 - x, y - 0.04, z)` (DESIGN.md section 2). Rig x = 0 is the keyboard centre (E4|F4), rig -x the treble.
- `layout.js` works in the piano frame and exports `pianoToRig([x,y,z])` / `rigToPiano([x,y,z])`.
- Because the group is mirrored, every world matrix under it has a negative determinant; three.js flips the culling
  for those automatically. Anything added under `group` must be built in the piano frame.

## 2. Module interface

```js
import { create } from './piano/index.js';
const piano = await create(ctx);   // ctx from the core (RENDERING.md section 3); options in ctx.options.piano
// piano.group -> rigGroup (parent: 'rig')
piano.update(t, sub);              // per sub-frame (core contract): samples perf tracks if present, applies the pose
```

`ctx.options.piano` (all optional):

| option | default | |
|---|---|---|
| `bench` | `true` | build the bench (in the same group, so it moves with the rig) |
| `envProbe`, `envProbeSize` | `'auto'`, 512 preview / 1024 final | the lacquer's env cube at the piano (section 4) |
| `prepareWorld` | `true` | integration shim, section 4 |
| `deskMirror`, `deskMirrorScale`, `deskMirrorDist` | `'auto'`, 0.6 / 0.8, 3.5 m | planar mirror on the music desk: `'auto'` = on when the camera is in front of the desk and closer than `deskMirrorDist`; `'on'`, `'off'` |
| `lidMirror`, `lidMirrorScale`, `lidMirrorDist` | `'auto'`, 0.5 / 0.7, 8 m | planar mirror on the main lid's underside (mirrors the gold interior) |
| `lacquerLook` | `'auto'` | art-directed lacquer per shot class (section 4): `'auto'` blends the `close` and `wide` presets by the camera's distance to the piano (2.5 .. 6 m); `'wide'`, `'close'`, `'physical'`, `'wideHero'` or an object of look keys (section 4 table). The integration module re-applies it before every frame from the shot spec (`piano: {lacquerLook}`) |
| `fallboardMirror`, `armMirror` (+ `Scale`, `Dist`) | `'auto'`, 0.4 / 0.5 and 0.35 / 0.45, 2.5 m / 2 m | planar mirrors on the open fallboard face and on both case-arm inner faces above the cheeks (hands and keys mirrored in close-ups, refs 7 / 8 / 12) |
| `lacquerF0`, `reflectionFold`, `reflectionLiftDeg`, `kicker` | 0.06, 1, 0, off | initial uniform values (overridden every sub-frame by `lacquerLook` unless it is `'manual'`) |
| `fillShadow`, `fillShadowSize` | on, 2048 preview / 3072 final | depth pass for the interior fill light (section 4) |
| `kickDir`, `kickConeDeg` | glow azimuth (world.glowLight), 3 deg up; unset | coat kicker direction (world) and jitter cone (deg); when set it wins over the look key `kickCone` (default 2.5 deg in every preset) |
| `interiorFill`, `fillDir`, `fillConeDeg` | `[0.28, 0.22, 0.14]`, from the raised lid, 14 | interior fill light (section 4) |
| `pose` | none | static pose for stills (same object as `setPose`) |
| `tracks` | from `ctx.data.perfMeta/perf` | a function `tFilm -> {keys, hammers, dampers, pedals}` overriding the reader; `false` = ignore the tracks (look-dev poses). At runtime `piano.setTracksEnabled(false)` does the same (`sandbox/piano2/shots.mjs` calls it for every shot with a `piano` pose; before round 2 the posed macros showed the performance state at the frame, not the pose) |
| `placeInRig` | `true` | `false` leaves the group in the piano frame (Node tools) |
| `debugGlobal` | `false` | sets `globalThis.__agPiano` (look-dev drivers only) |

Returned object:

| member | |
|---|---|
| `group`, `parent: 'rig'`, `update(t, sub)`, `dispose()` | core contract |
| `setKeyAngles(Float32Array(88))` | rad about the balance axis, + = key front down. Full dip: white 2.14 deg (10 mm at the front), black 2.46 deg (9 mm at the sloped front edge). Neighbouring key sides show (and are shaded open) when a key goes down |
| `setHammerAngles(Float32Array(88) \| null)` | rad about each flange pin, + = toward the string. The crown rides the circle of `layout.js` `HAMMERS` (crown rise = R sin(a + a0) - cy, the convention perf/lib/keys.js uses); the pin is placed so the crown meets the string underside exactly at the layout strike point at `hammerStrikeAngles[i]` (23.5-23.7 deg) with the bored head standing perpendicular to the string; `hammerCheckAngles[i]` = crown 16 mm below the string (held key after the blow). `null` = fallback: the hammer follows the key up to the check position (no blow; the solver supplies the blow) |
| `setDamperLifts(Float32Array(88) \| null)` | metres (notes 1-67 have dampers). `null` = rule of research/piano.md 6: `max(0.006 * smooth(keyDip 0.45..0.80), 0.008 * smooth(sustain 0.30..0.85))`. Sostenuto holding needs history, so it belongs to the solver's damper track |
| `setPedals([una, sost, sus])` | rad, + = tip down; max 3.47 / 3.47 / 4.16 deg (10 / 10 / 12 mm at the tip). Pedal rods follow |
| `setUnaCorda(f \| null)` | 0..1 shift of keys + hammers + wippens by +2.5 mm in x (the dampers stay on the strings; 3.5 mm treble cheek clearance); `null` = from the left pedal |
| `setLidAngle(deg)` | lid about the spine hinge axis. Default full stick 33 deg: the prop (fixed-length stick on a pin in a brass clevis) is aimed at the cup; at any other angle it cannot hold the lid and is shown folded inward (the lid is being moved by hand) - it never pierces the lid |
| `setBenchHeight(m)` | seat top height (0.45-0.59, default 0.47 = the pianist's seat; the integration module calls `setBenchHeight(0.47)`) |
| `setPose({keys:{n:deg}, hammers:{n:fracOfStrike}, dampers:{n:m}, pedals:[deg x3], lid, unaCorda})` | static pose; notes 1..88 (A0 = 1) |
| `setInteriorFill([r,g,b])` | fill light colour x intensity (linear); `[0,0,0]` = off |
| `setLacquerLook(mode)` | `'auto'` / `'wide'` / `'close'` / `'physical'` / object (see `lacquerLook`); `lacquerLooks` returns the presets |
| `setLookOverride(obj \| null)` | look-dev drivers only: a look object that wins over `setLacquerLook` (which the integration module resets before every frame) |
| `setLacquerF0(f)`, `setMirrorF0(f)` | clear-coat reflectance at normal incidence of the lacquer / of the planar desk + lid mirrors (physical 0.06; 0.04 = n 1.5). Switches the look to `'manual'` |
| `setReflectionFold(k, axis, sweep)`, `setReflectionLift(deg)`, `setReflectionElev(targetDeg, factor)`, `setKicker([r,g,b])` | the backdrop-reflection knobs and the coat kicker (section 4); each switches the look to `'manual'` |
| `mirrors` | `{desk, lid, fallboard, armTreble, armBass}` planar mirror handles (`mesh`, `update`, `setEnv`) |
| `hammerStrikeAngles`, `hammerCheckAngles` | Float32Array(88) |
| `layout`, `materials`, `strings`, `parts`, `probe` | data and internals for tools |

Everything is a pure function of the values passed in and of `t`/`sub` (no clocks, no randomness; the fill light's and
the kicker's sub-frame jitter use the core's stratified module dims `sub.dim(0..3)`; a Halton sequence on `sub.k` is
only the Node fallback without a core).

### Perf tracks (DESIGN.md section 4)
`makeTrackReader(perfMeta, perf)` (also used automatically from `ctx.data`) reads Float32 frames at `perfMeta.rate`
(240 Hz) from music time `perfMeta.t0` (default -MUSIC_OFFSET), stride `perfMeta.stride`, with channels
`{keys: {offset, size: 88}, hammers: {...}, dampers: {...}, pedals: {offset, size: 3}}` (an array of
`{name, offset, size}` works too; names `keys|keyAngles`, `hammers|hammerAngles`, `dampers|damperLifts`,
`pedals|pedalAngles`). It interpolates linearly at each sub-frame's shutter time, so keys, hammers and dampers are
motion-blurred correctly. Missing hammer/damper channels fall back to the rules above.

## 3. `layout.js` for the performance solver (pure data, piano frame)

```js
import * as PL from './scene/src/piano/layout.js';   // works in Node 22 (JSON import attribute)
```

| export | |
|---|---|
| `KEYS[i]` (i = note - 1, MIDI = note + 20) | `{index, n, midi, name, color, black, xCenter, topY, topPolygon, contact, dipRad, frontZ, frontDip}`; white keys also `xRange`, `tailX`, `head`, `tail` (head = front 50 mm full width, tail = narrow part between the sharps, both inset by the 0.5 mm gap); black keys `blackBox` |
| `topPolygon` | white: head + tail outline of the keytop in (x, z); black: the top rectangle |
| `contact` | where a fingertip may land: white = top polygon clipped to z 0.022 .. 0.168 (front .. fallboard - 4 mm), inset 0.6 mm from the filleted edges; black = top inset 1.2 mm. White contact regions never overlap black-key boxes (checked: 0 vertices inside) |
| `BLACK_KEY_BOXES` | `{n, xz (base footprint), yMin 0.713, yMax 0.7275}` |
| `BALANCE_AXIS` | `{y: 0.686, z: 0.290}`: x-parallel axis of every key |
| `KEY_DIP_RAD` | `{white: 2.14 deg, black: 2.46 deg}` in rad |
| `keyPoint(n, angle, [x,y,z], dx)` | where a rest-pose point of key n goes at `angle` (+ una corda dx) |
| `keyTopYAt(n, z, angle)`, `angleForDrop(n, z, drop)` | key top height at plan z for an angle, and its inverse |
| `WHITE_TOP_Y 0.715`, `BLACK_TOP_Y 0.7275`, `KEY_FRONT_Z 0.022`, `KB_CENTER_X 0.780`, `CASE_WIDTH 1.560`, `CASE_LENGTH 2.735` | |
| `KEYBOARD` | `{left, right, center, whitePitch 0.0235, octave 0.1645, frontZ, visibleEndZ 0.172, keySlipTopY 0.702, cheekBlocks, ...}` |
| `PEDALS[i]` (0 una corda, 1 sostenuto, 2 sustain) | `{x, pivot [x,y,z], tip [x,y,z] (front of the rounded nose, mid-thickness), treadY (pad top at the toe, 0.093 incl. the 3 mm toe rise), tread (x,z polygon of the flat pad top inside the 2 mm edge rounds), maxRad, tipTravel (at pedalTipZ)}`; `pedalPoint(i, angle, p)` rotates a rest point; `pedalTreadYAt(z)` exact pad-top height; `pedalSection(z)` / `PEDAL_SHAPE` = the loft table geom/legs.js builds from |
| `HAMMERS[i]`, `HAMMER` | per note: `flange` pin [x,y,z], `cy` (crown above the shank axis), `shankLen`, `R`, `a0`, `strikeAng`, `checkAng`, `bore`, `strikePoint` (string underside), head `depth`/`width`/`headH`; `HAMMER` = shank 0.125, crown 0.051, blow 0.046, check 0.016, let-off 0.002 |
| `hammerRiseForAngle(n, a)`, `hammerAngleForRise(n, y)`, `hammerCrown(n, a)` | crown rise <-> hammer angle (the perf track convention), crown position [x,y,z] |
| `benchSeatAt(h)` | `{edgeY, crownY}` for a bench set with `setBenchHeight(h)` (the tufted top crowns 8 mm above the rolled edge; `BENCH.crown`, `BENCH.seatCrownY`) |
| `PEDAL_MAX_RAD` | una 3.47 deg, sost 3.47 deg, sustain 4.16 deg (12 mm at the tip) |
| `BENCH` | `{center [0.755, 0.50, -0.465] (seat top centre), seatSize [0.57, 0.37], seatTopY, heightRange, nearEdgeZ -0.28, farEdgeZ -0.65, cushionThickness}` |
| `UNA_CORDA_SHIFT_X` 0.0025, `DAMPED_NOTES` [1, 67], `RIPPLE_SOURCES` (lyre + 3 legs, floor xz) | |
| `pianoToRig`, `rigToPiano`, `RIG_Y_OFFSET` -0.04 | frames |

Checked by `node sandbox/piano2/test_layout.mjs`: white front edge drops 10.03 mm, black front-top edge 9.05 mm,
sustain 12 mm at pedalTipZ (12.6 mm at the nose), rig round trip exact. Hammer contact: `node
sandbox/piano_critic/strike.mjs` (highest felt vertex at hammerStrikeAngles against the string path, plus parity tests
against pinblock / plate web / struts / capo / damper guide rail at rest, check and strike): contact 0.0 mm from the
layout strike point, penetration <= 0.01 mm, no intersections in any pose.

## 4. Rendering

- **Lacquer** (`M.lacquer`): `#050505`, clear coat 1.0 at roughness 0.02, base specular 0 (the pigment layer under
  the coat does not reflect; a rough base lobe made the case read as purple satin), orange peel on the coat normal
  (4.8 / 10.5 mm wavelengths, slopes 0.0008 / 0.0004; stronger values made the horizon wave in grazing mirrors).
  Edges are filleted 2-6 mm everywhere. The coat's F0 is a shared uniform (three hard-codes 0.04): default 0.06
  (n ~1.65). Schlick: 0.18 at 70 deg, 0.28 at 75 deg, 0.43 at 80 deg incidence, inside the 25-30 % at 70-80 deg
  grazing measured on ref 8 (with F0 0.04 the old harness measured 0.049 / 0.18 / 0.29 / 0.44). At near-normal
  incidence a physical coat mirrors only ~5 % of what it sees, so in this light the desk and lid mirrors are subtle;
  `setLacquerF0` is the per-shot knob. Lived-in polish: the coat roughness carries a fine polishing haze, faint smudge
  patches and stronger fingerprints / palm smudges around the keyboard (only visible where the coat mirrors a highlight).
- **Art-directed lacquer (docs/USER_FEEDBACK.md item 1)**. Measured on the piano's own pixels (`shots.mjs --mask`,
  `tools/piano/piano_lum.py`, reference masks `sandbox/piano2/masks/`), the physical lacquer was 3-10x darker than the
  references in every wide: a camera-facing case side mirrors what lies behind or beside the camera, which in this world
  is the dark terrain ring (0.02-0.04 linear), while the references show a darkened copy of the backdrop (glow,
  mountain silhouettes) in it. Knobs (shared uniforms, `materials.js` `FOLD_FN_GLSL`, also used by the planar mirrors'
  env fallback): **backdrop reflections** `fold` 0..1 moves each reflection's azimuth from the physical one to the view
  azimuth (`axis` 1; 0 = the sun azimuth) plus a lateral sweep from the physical reflection (`sweep`, so curved panels
  sweep across the glow as vertical streaks); the elevation stays physical (lid tops still mirror the sky above).
  **lift** raises reflections in the terrain band (below ~3 deg) over the ridge line; **elevT/elevC** optionally
  compress near-horizontal elevations toward the ridge line. **Coat F0** is raised in wides; the planar mirrors keep
  their own physical `mirrorF0`. **Coat kicker**: a direct light from the glow azimuth 3 deg up, evaluated on the clear
  coat only (GGX at the look's kickR lobe, 0.12 in both presets since session 9), jittered over 2.5 deg per sub-frame
  (look key kickCone; 6 deg drew separate glints on curved mirrors), masked inside the case and under the keybed:
  the thin warm lines along the lid edge, rim cap, key slip and desk edges (lid top fillet 6 mm, rim cap 5 mm so the
  line survives at 13 m). Sessions 6-8 added: the fold only on near-vertical panels (|n.y| < 0.45..0.75), a crisp
  asin() fold, a **proxy elevation** for vertical panels (pY/pG/pT/pC: the reflected elevation follows the piano-frame
  height of the point), a **parallax backdrop** (parR/parW/parLeg: horizontal lookup corrected against a cylinder around
  the piano), an **env grade** (envG/envW: c *= (L/Lw)^(g-1) on vertical panels, haze sinks to black, the glow keeps
  its strength), per-orientation F0 (f0Up for up-facing lacquer, f0Leg for legs / lyre / bench legs), a broad kicker
  lobe (kickR) and an **edge boost** (kickEdge/kickEdgeR: fwidth of the coat normal widens and brightens the kicker on
  fillets and leg cylinders). Session 9: a **near reflection card** (card, cardR, cardH, cardW, cardSky, cardSkyW,
  cardRidge, cardLeg, cardWin; materials.js KICK_GLSL): seen from 8-30 m a flat case side mirrors one tiny, magnified
  patch of the probe (a soft lilac smear), so the references' crisp "ridge + glow band" in the case side never formed
  from the probe alone. The card is a cylinder of radius cardR around the piano carrying a procedural dark ridge at
  piano height cardH (camera-anchored: a vertical panel shows the ridge at that height in every framing), the warm glow
  just above it and a lilac sky tail; below the ridge nothing is added, so the blacks stay black; fillets, the rim cap,
  lid and desk edges sweep through the band as thin warm lines. Fix round 2 (sessions 10-11) added: the fold mixes
  horizontal DIRECTIONS (no angle mix: the old atan/asin mix drew a hard seam on camera-facing panels for 0 < fold < 1);
  envAll (env-grade weight on non-vertical panels: lid, rim cap, prop), envSat + envTint (the dim graded env is
  desaturated to a slightly warm neutral: PBR Neutral's toe subtracts min(rgb), so a lilac dim reflection turned
  magenta and a fully neutral one is crushed to black), kickFlat / kickCurv (kicker weight on flat panels; the close
  look keeps the kicker on fillets only, so the case arm is a clean mirror), cardFollow (share of the camera elevation
  the card cancels: the band slides on cranes), cardJag (triangle-wave ridge instead of two-sine dunes), cardSkyCol
  (sky-tail colour, warm in the wide preset), cardSpine (card weight on the flat spine: the bass side stays a black
  mirror as in ref 4). The kicker / card gain follows world.glowLight but rises only 35 % of the glow's rise above
  the tuning level (sun +0.5 deg). Session 11 also: edgeLine / edgeMask (a warm rim light on the lid's whole edge band,
  masked in lid space: 19-24 mm = 1.5-3 px in the wides, stable where the kicker on the sub-pixel fillets twinkled),
  cardVar (backdrop patches along the card azimuth: streaks on the convex bentside), fillGain / fillHigh (interior fill
  x (1 + fillHigh * smoothstep(1.4, 2.4 m camera height)): S05 end / S23 see the gold interior), and the clearcoat
  orange peel fades out once a pixel covers its period (the evenly spaced, crawling lid-edge dots in the wides were the
  4.8 mm peel aliased on the fillet). Soft near-field occluder (agBoxHit penumbra) for the keyboard zone. Node check of the auto blend: `node tools/piano/check_look.mjs`; film-frame scoring:
  `node sandbox/piano2/qc_film.mjs <job> <out>` (pianist real, piano mask with the pianist as an occluder) +
  `python tools/piano/film_wide_score.py <out> "" <variants>` (body-only vs the ref masks, cleaned r4). Presets and measured numbers: see the LOOKS comment in
  `index.js` and `sandbox/piano2/PROGRESS.md` (tools: `shots.mjs --mask`, `tools/piano/wide_stats.py`,
  `tools/piano/hi_map.py`, `tools/piano/make_variants.py`). Default `'auto'` blends close -> wide between 2.5 and 6 m
  camera distance; look-dev overrides go through `setLookOverride` (the integration module calls setLacquerLook before
  every frame). Brass and nickel stay physical (except the pedals' brassFold below).
  Cycle 2 look keys (all default off in LOOK_BASE; values per preset in index.js LOOKS): keyFold / keyEl / keyElS /
  keyF0 (keytop gloss: up-facing keytops mirror the low glow band, materials.js AG_FOLD_KEY, keytop coat F0), mirHz /
  mirHzG / mirHzP / mirHzT (art-directed horizon of the planar desk / fallboard / pin-panel / arm mirrors: the env
  fallback is re-centred on each panel's mid height, mirHzG rad per m of panel height, mirHzP physical share, plus the
  lacquer env grade), fillSat / fillCam (interior fill saturation and camera-facing direction share: plate, string and
  pin crowns send their lobe to the lens), kickLeg (kicker over the whole leg / lyre cylinder), brassFold (pedal faces
  fold toward the backdrop), keyVis (keytop coat visibility floor against the fallboard / desk / torso occluder boxes:
  the keytop lobe is art-directed, the box test used the physical reflection), mirCard (the near reflection card of the
  wide look, materials.js CARD_FN_GLSL, added to the planar mirrors' env under the mirrored hands; x card). The coat smudges no longer change the coat roughness (they switched PMREM mips into
  hard-edged blotches on close-up mirrors); they dim the coat env reflection instead. The orange peel is off on
  fillets (|fwidth(normal)| > 0.05..0.18: beaded edge lines). Planar mirrors: desk, lid underside, fallboard face,
  pin-block cover (`pinMirror`, 'auto' < 2.5 m; case.js pinblockFront now rises to the desk rail, 0.719-0.9845 m) and
  both arm faces. Close-up stats: `python tools/piano/close_stats.py <out> "" <variants>`; panel clearance:
  `node tools/piano/check_panel.mjs`.
  Session 13: the `close` preset carries the near reflection card as a physical-style horizon (cardFollow 0, cylinder
  5 m, ridge 0.95 m, glow decay 0.10 m, salmon sky tail) in the coat and the planar mirrors (mirCard 1), coat / mirror
  F0 0.35 and keyVis 0.8 (the arm mirrors take their own weight mirCardArm, default 0: the arm faces' coat lies inside
  the case volume where the coat card is masked, so a carded arm mirror showed as a seam); the legs / lyre get a second kicker lobe mirrored in the water plane (kickLeg > 0: a vertical
  cylinder seen from above reflects into the lake). Named preset `wideHero` (= wide + taller salmon sky tail above a
  lower ridge, backdrop streaks) for per-shot use, e.g. S03 (ref 2): `piano: { lacquerLook: 'wideHero' }`. The wides'
  balance shifts with every world / LUT change: re-run `film_wide_score.py` on S01a S03b S10b S17b after one.
  Interior fill for high cameras: fillCamHigh / fillSatHigh add to fillCam / fillSat x the fillHigh camera-height ramp
  (smoothstep 1.4..2.4 m above the piano floor; low cameras unchanged); wide preset fillHigh 5.4, fillCamHigh 0.3,
  fillSatHigh 0.25 (the plate, strings and pins send a warm sheen to the drone lens, ref 6).
  Cycle 2 round 2 (critic c2r2; out/c3_a .. c3_e, tools/piano/r2_stats.py, film_wide_score.py now with S05b and hue terms):
  - fill: the lacquers take the fill's coat lobe from the BASE fill direction (`agFillDirL`; fillCam swings only the metal
    crowns toward the lens) - the S14 top-down "flashlight" disc on the black lacquer is gone (1725 -> 0 px > 200).
    `fillCap` caps the fill's specular / coat luminance per pixel, `fillAmb` / `fillAmbHigh` add a broad shadowed ambient
    share (the soundboard / plate albedo read evenly). Wide preset fillHigh 2 (was 5.4), fillAmbHigh 0.3, fillCap 0.3.
  - kicker: `kickCap` = luminance cap of the coat kicker per pixel (hue kept), wide preset 0.25 + kickFlat 0 (the S23 / S05
    key-slip / fallboard / desk-rail lines and the S20z caramel lid top came from the kicker's GGX peak on flat panels).
  - card colours: `cardCol` / `cardSkyCol` may be `'sky'` = the world glow's displayed hue (three's PBR Neutral of
    `world.glowLight.radiance`, normalised, + `cardToe` / `cardSkyToe` toe pre-compensation, index.js displayHue); wide
    preset uses both. `cardSil` (0..1) replaces the procedural card ridge with the REAL skyline seen from the piano
    (index.js buildSilhouette: world.heightAt, 512 azimuths x 15 m .. 60 km, once at the first update; materials.js
    `agSil`), `cardSilK` azimuth scale, `cardSilA` offset (deg); also in the planar mirrors' card.
  - up-facing lacquer: `envUp` / `envUpSat` / `envUpG` / `envUpGain` grade the env of up-facing panels (lid top, rim cap)
    separately (sky hue kept, no warm tint): wide preset 1 / 1 / 1 with f0Up 0.24 (S17 lid top navy sheen as ref 4).
  - keys: `keyElMax` caps the keytop gloss target elevation (deg; high cameras), `keyAmb` adds a warm key ambient (x the
    glow's displayed hue, toe `keyAmbToe`) before the key AO. Look objects may start from `base: 'auto'` (production
    blend + overrides; look-dev A/B). Caps (`*Cap`) blend in log space in the auto blend.
- **Env probe**: a `CubeProbe` (512 preview / 1024 final per face, PMREM) at the piano, re-captured every output frame
  from `registerEnvCapture`, assigned as `envMap` of the piano's materials only. With the real world module it
  captures exactly what the world's env capture sees (layer 5: dome, terrain, boulders; the dome in env mode = sky cube
  above, mirror lake below; view/mirror bakes off; near 1 m), only sharper and at the piano. A full-scene cube capture
  gives wrong faces (the Reflector water and the camera-dependent dome bakes re-render per face).
- **Integration shim** (`prepareWorld`): the world module prepares its bakes lazily at sub-frame k = 0, i.e. after the
  core's env-capture hooks. The piano wraps `world.prepareFrame` to record the prepared frame and calls it from its
  env-capture hook when the world has not prepared this frame yet; the world's own `update` then skips. If main.js
  later registers `world.prepareFrame` as a sky bake (RENDERING.md section 8), the shim does nothing.
- **Planar mirrors** (`geom/mirror.js`): three.js Reflectors over the flat part of the music desk's front face and of
  the main lid's underside (inset past the edge fillets). The mirror pass re-renders only layer 7 (`MIRROR_LAYER`: the
  piano group, and the pianist's meshes, which the piano tags once they exist) from the mirrored camera (it inherits the
  core's jitter and lens offset, so AA, DOF and motion blur stay right), cleared to alpha 0; the shader composites that
  over the probe cube in the reflected direction (sky, terrain, lake) and shades it as the clear coat alone (Schlick
  with the shared F0, orange-peel ripple of the lookup). So the keys, the hands and the pianist appear in the desk
  (refs 7, 8, 12; strongest at grazing views along the keyboard, as in ref 12: the pianist's own eye line reflects
  upward to the sky), and the raised lid's underside mirrors the gold interior. Only the main camera (`ctx.camera`) gets
  a pass; in other passes the face shows the env fallback. No world geometry is re-rendered and the water's reflection
  pass never nests. Cost: one piano-only render per visible mirror per sub-frame (`'auto'`: desk < 3.5 m, lid < 8 m).
  Verified with F0 forced to 1 (`sandbox/piano2/out/dbg6`): the lid mirrors plate, struts, holes and rim in place.
- **Occlusion**: the scene is lit by IBL only, which three.js does not occlude. Interior materials use an analytic
  sky-slit visibility in the piano frame (the wedge between the treble rim top and the raised lid / spine rim top,
  cosine-weighted, extra depth term in the action cavity). Key side faces are occluded up to the neighbouring key's
  (rotated) top, so gaps are dark at rest and a pressed key exposes its neighbours' wooden sides.
  **Under the case** (`agUnderVis`, every material with the default AO): below the keybed bottom (y < 0.622) the
  reflection lobe, the clear-coat lobe and a bent-normal diffuse lobe are traced to the case-bottom plane and tested
  against the case outline (lobe width grows with roughness and distance); downward lobes first bounce off the water
  (y = 0.04), since under the piano the lake mirrors the case bottom too. Occluded lobes keep 8 % (satin black
  underside). Without it the probe (which contains no piano) made the brass pedals, ferrules and lyre mirror open sky
  through the keybed and read as cream plastic; now the pedal tops mirror the dark keybed with a crisp edge line and
  the noses and sides catch the lake and the horizon.
- **Interior fill** (artistic, documented): refs 1, 6, 11 show the plate and inner rim lit warm, but with the lid
  open toward the anti-sun side the sky leaves the interior navy. The fill is an unshadowed direct light shaded through
  three's `RE_Direct` (diffuse, specular, clear coat, sheen respond with their roughness), from the raised lid above
  the spine side, jittered over a 14 deg cone per sub-frame (a soft area light after accumulation), masked to the case
  volume above the soundboard and in the action cavity (never the underside), scaled by the slit visibility, plus a
  5 % ambient share. `setInteriorFill` per shot; `[0,0,0]` turns it off. **Shadowed** (session 5, `geom/fillshadow.js`):
  every sub-frame (pre-subframe hook) an orthographic depth pass of the interior casters (case, rim, plate, struts,
  strings, action, desk, prop; not the lid, legs or bench; layer 9) along the jittered fill direction, 2048^2 preview /
  3072^2 final, sampled with 3x3 PCF + normal offset; struts, pins, agraffes and dampers now shadow the plate,
  strings and soundboard and the penumbrae soften over the sub-frames.
- **Near-field occlusion around the keyboard** (`agNearVis`): the probe contains neither the piano nor the pianist, so
  sharp fronts, keytops, key slip and cheeks mirrored open sky behind the player. Reflection rays from the keyboard
  zone are tested against the fallboard + music desk block and (when the pianist module is present) a box around his
  torso; occluded lobes keep 3 %.
- **Procedural detail** is in object-local space (it sticks to the lid when the lid moves): orange peel, cast-iron
  plate undulation + metallic flake + mottled tone/roughness, felt fibres + sheen, leather grain, spruce boards with
  growth rings along the grain (-48.5 deg), maple/graphite bridge grain, key wood grain, brass pedal scuffs, a helical
  groove normal map on the copper winding.

## 5. Parts inventory (research/piano.md -> where)

Case: rim (one sweep, 6 mm inner / 3 mm outer fillets) with a laminated mahogany inner-rim band under the black cap +
bottom molding; case arms with the measured S-scroll; cheek
blocks (12 mm front-top fillet); key slip; keybed; open fallboard with the 16 mm roll and the burgundy felt strip on the
key backs; pinblock front panel; desk rail; music desk (14 deg, concave scroll ears, ledge + lip, C-scroll brackets);
lid (main + front flap folded back on a brass piano hinge); 3 brass 5-knuckle butt hinges on the spine with leaves,
pin caps and screws; prop at full stick (tapered rounded-square stick, turned knob, brass foot and base, brass cup on
the lid underside). Keyboard: 88 keys from 10 shape classes (instanced): 2 mm warm-white keytops with real head/tail
cuts, white front pieces, light-wood bodies and levers, lofted tapered sharps with sloped fronts and filleted tops.
Action: hammers (felt, underfelt stripe, mahogany molding, hornbeam shank, flange + centre pin), flange rail, rest rail
+ felt, wippens, dampers 1-67 (black satin heads, V-wedge felts on wound strings, grooved flat felts on trichords,
brass wires), damper guide rail. Strings: ~240 (bass singles/bichords copper-wound with 25 mm bare core and helical
normal map, plain trichords), each pin coil -> agraffe/capo -> 2 bridge pins with side bearing -> hitch pin; plain wire
loops around one hitch pin per 2 strings. Plate: web (front panel, hitch band, spine strip) with cast bump, 6 drafted
struts (raised over the tenor, lowered under the bass), 8 flanged holes + oval slot, bolts (washer + hex nut), cast perimeter bead, ~70 slotted plate screws along the web edge,
agraffe ledge + brass agraffes (1-52), capo d'astro bar (53-88) with end posts, nickel pressure bar + screws, duplex
ridge (46-88), blank cartouche, ~240 tuning pins (bushing, blued shaft, 3-turn helical coil of 8-sided wire with the becket in the pin eye and the top turn aimed at the string exit, tapered nickel head), hitch pins
raked 15 deg, red felts (front cloth + woven braid, rear understring felt). The soundboard shows through the plate
windows between the struts. Pinblock under the front panel (41 mm, back edge 20 mm in front of the panel edge, rounded
underside: the hammer shanks pass under it, the heads rise behind it). Soundboard (boards + rings), 13 ribs,
4 underside braces, belly rail under the soundboard's front edge (behind the hammers and the damper guide rail), long
bridge (notched graphite cap) and bass bridge, ~480 bridge pins. Legs (filleted
tapered square, two-ring collar, flared capital, ogee top plates, rear spacer block), brass ferrules, brass twin
casters; lyre (top block, waisted posts, pedal box, 2 brace rods with brass caps, 3 brass pedal rods), 3 brass pedals
(pad + neck, rounded upturned nose, scuffed) through brass escutcheon frames on the pedal box. Bench: button-tufted leather cushion (3 rows, diamond pleats, rolled edge, welt),
lacquer apron, 4 tapered legs with brass caps, side knobs with nickel rings.

Budget (`node tools/piano/count_tris.mjs`): **1.65 M triangles, 146 draw calls** (session 13; cycle 1: 1.27 M / 143; biggest: pin coils 374 k, hammer felts 123 k, sharps
78 k, bridge pins 57 k, bench cushion 56 k), plus the two planar mirror quads. Build time 1-2.5 s in
Node, ~0.4-3 s in the page.

## 6. Previews and validation

- `powershell -File sandbox/piano2/run_shots.ps1 <shots.json> <outDir> [--size 1920x1080] [--N 16] [--only a,b]`
  renders through the production core (`render/lib/session.mjs`, real world + piano, pianist off) many shots per
  session; `sandbox/piano2/s3_final.json` (current final set: 8 reference framings + 10 extreme macros incl. pedals,
  tuning pins, dampers, hammers through the strike gap, keys, caster at the waterline, hinge, lid underside, an action
  cutaway; 1080p N=16, output `sandbox/piano2/out/s3_f1`), `core_refs.json`, `core_macros.json` (older sets). Compare: `.venv/Scripts/python.exe tools/piano/cmp_shots.py <shots.json> <outDir>`.
- Determinism (`node render/determinism.mjs --frames 6600,6601 --size 960x540 --N 4 --quality preview --modules
  pianist=off --camera sandbox/piano2/cam_det.json --out sandbox/piano2/out/det_core`, real world + piano, desk and lid
  mirrors active): three sessions (in order, reversed after a different warm-up, single frame) bit-identical, frames
  differ: `{identicalAcrossSessions: true, framesDiffer: true, ok: true}`. Re-checked after the session-3 changes with
  `--modules world=placeholder,pianist=off` (`out/det_s3b`): ok. Do not edit scene files while it runs; each session
  reloads the modules, so concurrent edits (by any agent) make the sessions differ.
  **Correction (fix round 2):** those runs covered the session-3 code only. The integrator's later `det2`
  (`sandbox/integration/out/det2`) passed only with `--preroll 3` on the frozen snapshot `build/snap/integ2`; without the
  pre-roll (`det_nopre`) the full scene is NOT identical across sessions (MODULE_ISSUES I-11, history dependence, open).
  The piano's own state is a pure function of the frame (look by camera pose, tracks by sub.time, mirrors per render),
  but nothing in this section proves bit-identical sessions for the current code until I-11 is bisected and
  `render/determinism.mjs` passes without `--preroll` on the live tree.
- Geometry checks (Node): `node tools/piano/check_caps.mjs` (every `roundedSlab` cap's triangulated area against its
  inset outline, plus the plate web / pinblock / soundboard caps against their plan polygons; must print 0 warnings and
  0 triangles outside), `node tools/piano/raycast.mjs '<json>'|file.json` (first-hit mesh name and point per image cell
  for a shot camera: `posRig`, `targetRig`, `mm`, `hide`, `pose`, `grid`), `node tools/piano/count_tris.mjs --top N`.
  `roundedSlab` removes the swallowtail loops an inset ring forms at tight corners before triangulating (`cleanInsetRing`);
  a self-intersecting ring once made earcut cover the whole interior with one plate triangle.
- Action / strike checks (Node, fix round 1): `node tools/piano/check_strike.mjs` (hammer contact vs the layout strike
  point: mean dz 0.0 mm, max penetration 0.01 mm, no felt vertex inside pinblock / plate web / capo / struts at rest,
  check and strike; the "> 3.5 mm sideways" list is the flat crown's edge vertex, +-4 mm = half the head width, not a
  miss), `check_intersect.mjs`, `check_strut_damper.mjs`, `check_action.mjs` (fixed in round 2: uses the layout strike
  point; strike / check / rest crown-to-string gap 0 / 16 / 46 mm), `node tools/piano/check_hammer_sweep.mjs` (round 2:
  each bass / tenor hammer swung in 8 steps past its resting neighbours; bass heads 10.0 mm wide and every head yawed at
  0.6 x the string angle so the swept volumes clear, notes 1-30 ok), `node tools/piano/check_look.mjs` (lacquer look
  plumbing: the auto blend carries every preset key), `node sandbox/piano2/test_layout.mjs`
  (bench seatTopY 0.47), `node tools/piano/check_glsl.mjs` (offline sanity check of every patched shader: run it after
  any materials.js edit, before a render).
- Wide-shot lacquer stats (USER_FEEDBACK item 1): shots with `"mask": true` also write `<shot>_mask.png` (piano id
  pass); `tools/piano/wide_stats.py <outDir> [suffixes]` = piano-pixel mean / p50 / p75 / p90 / p95 / p99 / > 40 / > 80
  / > 120 against the reference masks in `sandbox/piano2/masks/` (r2, r4, r9, r10, r11); `tools/piano/hi_map.py
  <outDir> <suffix> <out.jpg>` paints the piano pixels > 40 cyan in the ref and in ours (where the highlight tail
  lives); `tools/piano/make_variants.py <base.json> <vars.json> <out.json>` = shots x look variants (applied through
  `setLookOverride`); `tools/piano/gbuffer.mjs` + `tools/piano/lacquer_emu.py` = CPU G-buffer and lacquer emulator for
  tuning while the GPU is busy (no PMREM blur, single sample: calibrate against a GPU render).
- Log with every measurement and decision: `sandbox/piano2/log.md`; state: `sandbox/piano2/PROGRESS.md`.

## 7. Notes for the integrator

- Put `piano.group` in the rig (the core does: `parent: 'rig'`); do not re-mirror it.
- Ripple sources: `RIPPLE_SOURCES` (piano frame; convert with `pianoToRig`, then the rig transform).
- The pianist module should be hidden from the piano's probe automatically (the piano hides `ctx.modules.pianist.group`
  during its capture); the desk mirror shows him.
- Some reference framings are not physically reproducible with a real mirror (ref 8's frontal case side mirroring the
  sunset that is also in the background): the case side mirrors the glow only near grazing incidence; frame those
  shots along the case side (`r08_graze` in `core_refs.json`) or cheat the rig yaw.
