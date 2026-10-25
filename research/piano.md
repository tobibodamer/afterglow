# Grand piano construction spec — 211 cm semi-concert grand (Steinway B class), D-class numbers alongside

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Goal: a procedural Three.js piano that survives extreme close-ups, interior included, and matches refs 1–12.
Units are metres and degrees.

Tags: **[S]** published source (see §14). **[M]** measured by me from an official drawing or photo with a known scale. **[E]** engineering estimate, chosen so the geometry stays consistent.

Machine-readable companion: `research/piano_b_layout.json` (case outline, plate polygons, struts, holes, bolts, bridges, and all 88 notes with key x, strike, agraffe, bridge, hitch and pin points). Plan-view check render: `research/piano_plan_check.png`. Generators: `sandbox/piano/gen_layout.py`, `gen_plate.py`, `emit_json.py`.

---

## 0. Coordinate system
- Origin `(0,0,0)` is on the **floor directly below the front-left corner of the case**. "Front" is the plane of the case-arm noses and the key slip.
- **x**: to the right along the keyboard (bass to treble). **z**: away from the player, toward the tail. **y**: up.
- Plan coordinates below are written `(x, z)`.
- Three.js maps this directly if you build in a group and rotate or flip it. Keep a right-handed frame: Three.js world `(x, y, -z)` puts the piano tail at −Z.

## 1. What the references require (seen in refs 1–12)
- Refs 1 and 6 (top-down). A gold plate fills the interior: a row of large round flanged holes along the bentside, several struts fanning from the front, copper bass strings crossing over the tenor, red felt at the tail hitch-pin zone and in front of the agraffes, black damper heads in a row near the keyboard, and a thick glossy rim cap. The lid is open with the front flap folded back onto the main lid.
- Refs 2, 3, 4, 9, 10, 11 (silhouette). The lid is at full stick (about 35°). The prop is near the front of the bentside and leans inward. The legs are square and tapered, with a two-ring collar and brass ferrule and casters. There is a lyre with 3 brass pedals and **two diagonal lyre braces** running back up to the keybed. The bench is tufted and adjustable.
- Refs 7, 8, 12 (close-ups). The case arm has an S-scroll down to the key level. The cheek blocks are black and tall. The key slip is glossy black. The fallboard has a rounded top. A **music desk** (large black mirror panel) stands above the fallboard. White keys are warm white and black keys satin. Reflections show mountains and sky, so lacquer clearcoat dominates the look and every edge needs a fillet.
- No brand logos: leave the fallboard and plate cartouche blank.

## 2. Overall dimensions

| item | B-class (build this) | D-class | tag |
|---|---|---|---|
| length (front to tail) | 2.110 | 2.740 | [S] Steinway/Steinert |
| width (max, at keyboard) | 1.480 | 1.560 | [S] |
| net weight | 345–364 kg | 480 kg | [S] |
| top of white keys above floor | 0.715 | 0.715 | [S] dimensions.com 28.125 in |
| rim top (lid closed rests here) | 1.000 | 1.000 | [M] official Steinway B side drawing: 1.003 |
| lid thickness | 0.022 | 0.024 | [E] |
| closed-lid top | 1.022 | 1.024 | [M]/[S] Yamaha C6X: 1.02 lid closed |
| rim bottom edge (behind keybed, z ≥ 0.70) | 0.712 | 0.712 | [M] drawing: 0.711–0.715 |
| rim vertical depth | 0.288 | 0.288 | derived |
| rim thickness (outer case + inner rim) | 0.060 | 0.0555 | Steinway states 2¾ in (70 mm) for B [S]. The B drawing shows about 53 mm [M] and the D photo about 55 mm [M]. Use 0.060. |
| keybed underside (front section z 0–0.70) | 0.625 | 0.625 | [M] drawing 0.63, [E] adjusted to key stack |
| keybed thickness | 0.0445 | 0.0445 | [S] 1¾ in |
| longest speaking length (A0) | 1.508 (spec 1.51) | 2.010 (spec 2.013) | [S] 59¼ in / 79¼ in |
| longest key | 0.533 | 0.622 | [S] 21 in / 24½ in |
| total string tension | 17,571 kgf | 20,418 kgf | [S] |
| lid angle full stick / short stick | 35.2° / 13.9° | ~same | [M] drawing far-edge height 1.873, my geometry gives 1.886 |
| lid far-edge height at full stick | 1.886 | — | computed |
| plan area | 2.47 m² (dimensions.com 2.45) | 3.33 m² (dimensions.com 3.38) | [M] |
| strings / tuning pins | 236 | ~240 (bass layout unverified) | §7 |

## 3. Case

### 3.1 Outer case outline, B-class (44 points, closed polyline, `(x, z)`)
This comes from the vector plan of the Model B (dimensions.com SVG, path "Plan"), scaled to 1.480 × 2.110. I cross-checked it against the real Steinway D top-view photo in INRIA RT-0425: in the keyboard frame, the shape of the bentside S-curve agrees within about 0.05 m (§13).
```
(0.000,0.000) (1.480,0.000) (1.480,0.700) (1.478,0.730) (1.472,0.760) (1.459,0.790) (1.434,0.820)
(1.390,0.850) (1.325,0.880) (1.258,0.910) (1.202,0.940) (1.162,0.970) (1.133,1.000) (1.099,1.050)
(1.076,1.100) (1.046,1.200) (1.025,1.300) (1.007,1.400) (0.989,1.500) (0.969,1.600) (0.944,1.700)
(0.917,1.780) (0.885,1.850) (0.854,1.900) (0.812,1.950) (0.750,2.001) (0.700,2.031) (0.650,2.053)
(0.600,2.070) (0.550,2.084) (0.500,2.095) (0.450,2.103) (0.400,2.108) (0.350,2.110) (0.300,2.109)
(0.250,2.105) (0.200,2.099) (0.150,2.087) (0.100,2.066) (0.076,2.050) (0.035,2.000) (0.014,1.950)
(0.004,1.900) (0.000,1.850)
```
- Straight spine (bass side) at x = 0 for z 0–1.85. The front-right side is straight to z = 0.70.
- The concave bentside elbow runs z 0.73–1.05. The gently converging straight-ish run goes to (0.885, 1.85), then the round tail.
- Use a centripetal Catmull-Rom curve through these points (0.5–1 mm deviation). Build the rim as this outline extruded y 0.712 → 1.000. Inner face = outline offset −0.060 (round joins).

### 3.2 D-class outline (from the INRIA Steinway D photo soundboard edge + 0.0555 rim)
`(0,0) (0,2.533) (0.026,2.618) (0.077,2.673) (0.175,2.714) (0.429,2.735) (0.647,2.722) (0.798,2.677) (0.860,2.632) (0.909,2.577) (0.937,2.515) (0.957,2.425) (1.055,1.582) (1.080,1.439) (1.114,1.330) (1.150,1.258) (1.207,1.173) (1.349,1.042) (1.489,0.942) (1.526,0.895) (1.550,0.839) (1.560,0.765) (1.560,0)`
Bounds come out at 1.560 × 2.735 m.

### 3.3 Rim details
- Rim cap: flat top at y = 1.000, width 0.060. Inner edge fillet r = 0.008, outer r = 0.004. Mirror-black inside and out (Steinway B studio photo shows a black inner rim).
- Bottom molding under the rim: y 0.682–0.712, inset 0.004 [M].
- Lacquer edges must never be sharp: every case edge needs a fillet of 2–4 mm, or highlights read as CG.

### 3.4 Case arms (keyboard ends) and their S-scroll
- Arms are the rim's front ends: x 0–0.060 and 1.420–1.480, z 0 → 0.70.
- Side profile, measured from the official Steinway B side drawing (`(z, y)`, front-most point is the "nose" at key level) [M]:
  `(0.156,1.000) (0.149,0.989) (0.142,0.979) (0.135,0.958) (0.135,0.947) (0.142,0.937) (0.156,0.916) (0.163,0.895) (0.163,0.854) (0.156,0.833) (0.139,0.812) (0.115,0.802) (0.059,0.791) (0.017,0.781) (0.007,0.770) (0.000,0.750) (0.000,0.698) (0.004,0.687) (0.017,0.677) (0.014,0.666) (0.021,0.635) (0.021,0.625)`
- Behind z = 0.156 the arm top is the rim top (1.000).

### 3.5 Cheek blocks (key blocks)
- x 0.060–0.128 (left) and 1.352–1.420 (right). z 0.000–0.172.
- Top at y 0.738 (10 mm above the sharps). Front-top fillet r 0.012, other edges r 0.003. Black lacquer.
- The B plan drawing shows cheek blocks of 0.080 including the stroke. I use 0.068 so the keyboard is exactly 1.222 m.

### 3.6 Key slip and keybed front
- Key slip: x 0.060–1.420, z 0.000–0.020, y 0.660–0.702. Its top sits 13 mm below the white key tops, so 13 mm of each white key front shows. Edge fillets 1.5 mm. Black lacquer.
- Keybed front face below it: y 0.625–0.6695, set back 3 mm. Shadow gap 1 mm.

### 3.7 Fallboard (logo area blank)
- **Open** (all shots): front face at z 0.172, y 0.729–0.790. It is topped by a half-round roll of r 0.016 that runs back to z 0.205.
  The board body continues back (flat) to z 0.250 at y 0.790.
  A **burgundy felt strip** 3 mm tall shows along its lower edge, resting on the key backs [S] (visible on the Steinway B overhead photo).
  Length in x is 1.300 (0.090 → 1.390): it sits on the cheek blocks.
- **Closed**: a board over the keys at z 0.010–0.172, top at y 0.752, front lip down to y 0.726, thickness 0.020.
- Animate by rotating about a hinge at (z 0.172, y 0.752) through about 100°, then sliding back 0.05.

### 3.8 Music desk (present in refs 7, 8, 12)
- Panel 0.840 wide (x 0.320–1.160), 0.270 tall, 0.018 thick. Tilted 14° back from vertical.
- Bottom edge at (z 0.255, y 1.000), top edge at (z 0.320, y 1.262).
- Ledge (music rest) along the bottom front: depth 0.040, thickness 0.012, lip 0.008.
- Side ends have a concave scroll, as in ref 7. Black lacquer both faces.
- Source: [M] from the dimensions.com B front elevation (0.86 wide, ~0.23 tall) and [E].

## 4. Lid and props

### 4.1 Lid geometry
- **Planform**: the case outline with 0.004 overhang on the bentside, tail and front, and flush on the spine. It is split into two parts:
  - **Front flap (bonnet)**: z 0.175 → 0.560, full width (0.385 deep). It is hinged to the main lid's front edge by a continuous brass piano hinge on the top surface.
  - **Main lid**: z 0.560 → tail.
  - The split position is confirmed twice [M]: the plan line at 0.561 and the side-drawing start of the raised lid at 0.562.
- **Open**: the flap is folded 180° back onto the main lid's top surface (double thickness at the front of the raised lid, refs 6 and 9). The desk is then up.
- **Main lid hinges**: 3 brass butt hinges on the spine at z = 0.80, 1.30, 1.80. Each leaf is 0.050 (z) × 0.030. Knuckle Ø0.012 on the axis **x = −0.004, y = 1.012**.
- Underside is the same mirror lacquer.

### 4.2 Prop sticks and resulting lid angles
- **Prop**: base pivot on the treble rim top at **(x 1.435, y 1.000, z 0.650)** [M] (the drawing shows the prop at z 0.60–0.70). It swings in the x–y plane (perpendicular to the hinge axis).
- Shape: tapered square-ish stick, 0.030 at the base to 0.020 at the top, with a Ø0.026 turned knob at the top. Black lacquer.

| stick | length | cup on lid underside (distance from hinge axis) | lid angle | cup position (x, y) | prop lean from vertical |
|---|---|---|---|---|---|
| full | 0.840 | 1.170 | **35.2°** | (0.952, 1.687) | 35° inward |
| short | 0.360 | 1.360 | **13.9°** | (1.316, 1.340) | 19° inward |

- Cups are brass, Ø0.030, 0.012 deep, on the lid underside along z = 0.650.
- Check against the official drawing: far-edge top height at full stick computes to 1.886. The drawing measures 1.873 (−0.7%).

## 5. Keyboard

### 5.1 Global layout
- 88 keys A0–C8. 52 white keys at a **pitch of 23.5 mm**, giving an octave of 164.5 mm [S] (Wikipedia gives 164–165).
- Keyboard spans **x 0.129 → 1.351** (width 1.222). The center line x = 0.740 is the E4|F4 boundary and the case center.
- Left edge of the C in octave k (C1 = octave 1): `x_C(k) = 0.129 + 0.047 + (k−1)·0.1645`.
  - Middle C (C4, key 40) spans x 0.6695–0.6930; center 0.6813.

### 5.2 White keys
| parameter | value | tag |
|---|---|---|
| visible top length (front to fallboard) | 0.150 | [S] LilyPond measurement 150; Vagias keytops 6 in |
| head length (front wide part) | 0.050 | [S] 50 mm standard keytop head |
| head width | 0.0225 (gap 1.0 mm) | [S]/[E] keytop 7/8 in = 22.2 |
| keytop thickness | 0.0020 | [S] 0.080 in |
| key front face height visible above key slip | 0.013 | [E] |
| total key height at front (keytop + wood) | 0.0235 | [E] |
| key front z | 0.022 (2 mm gap behind the key slip; no overhang of the slip) | [E] |
| top edge fillet / front edge fillet | 0.0005 / 0.0008 | [E] |
| full key length (wood) | bass 0.533, treble ~0.47 (strike line is slanted, §6) | [S] longest 21 in |

### 5.3 Black keys (sharps)
- Base length 0.095 [S] (LilyPond 95; suppliers quote about 3½–3⅞ in along the bottom).
- Top length 0.085. The front face slopes back 0.007 and the rear 0.003.
- Width: base 0.0127, top 0.0098. Top edge fillet 0.0012.
- **Height above white key tops 0.0125**, so the top is at y 0.7275 [S] (PTG: sharps ½ in above naturals).
- Base front edge at 0.051 behind the white key front (z 0.073). The back end is at z 0.168, tucked under the fallboard lip (z 0.172).

### 5.4 Positions within an octave (mm from the left edge of C) [S]/[M]
The black keys are not centered on the white-key boundaries. Real keyboards divide C–E (70.5 mm) into **5 equal slots of 14.1 mm** and F–B (94 mm) into **7 equal slots of 13.43 mm** (the mathpages "optimum" pattern). This matches the LilyPond hand measurement within 0.65 mm.

| sharp | center | offset from the white boundary it straddles |
|---|---|---|
| C# | 21.15 | −2.35 (toward C) |
| D# | 49.35 | +2.35 (toward E) |
| F# | 90.64 | −3.36 (toward F) |
| G# | 117.50 | 0.00 |
| A# | 144.36 | +3.36 (toward B) |

- **White tail (narrow back part) boundaries** (slot cuts):
  - C 0–14.10, D 28.20–42.30, E 56.40–70.50.
  - F 70.50–83.93, G 97.36–110.79, A 124.21–137.64, B 151.07–164.50.
- Shrink every key 0.5 mm per side for the gap. The black key sits centered in its slot with 12.7 mm base width.
- **A0** is a full key on its left side (no G# below it). Its tail spans 117.5–137.64 in its octave.
- **C8** is a full rectangle 23.5 mm wide (minus gap), with no cut.

### 5.5 Key pivot and dip (animation)
- One balance axis for all keys, parallel to x at **(y 0.686, z 0.290)**. The key ratio is about 1:1.9 [S] (MMD measurement on a Steinway). The white front lever arm is 0.268.
- **White dip 10 mm** at the front [S], which is **2.14°** rotation.
- **Black dip ≈ 9 mm** at the sharp's front-top edge, which is **2.46°**. The same 2.14° would give only 7.8 mm.
- **Una corda**: the whole key set plus action shifts **+0.0025 in x**. The cheek blocks and key slip stay put.
- Key speed [S] (KTH): peak 0.3–0.5 m/s at mf, ≤1 m/s at forte. Hammer speed is about 5× key speed (max ~5 m/s).
- Key-bottom vs hammer–string contact [S] (KTH): at mf they coincide. At p the key bottoms up to about 20 ms **after** the sound. At f it bottoms **before** the hammer hits.
- Damper leaves the string about 15 ms before the hammer hits [S].
- Rule for sync: audio onset = hammer–string contact. Start the key descent 10–40 ms before the onset (ff → pp).

### 5.6 Visible felts around the keys
- **Fallboard/name-rail felt**: a thin burgundy line behind the keys (§3.7) [S], photo.
- **Front-rail punchings** under each key front (burgundy, Ø0.012 × 0.003). Visible only when a key is pressed and viewed from very low.
- **Key sides**: the 2 mm keytop sits on natural light wood (basswood/spruce, sRGB #D8C7A4). Pressing a key exposes the neighbour's wooden side. This is a cheap, very real close-up detail.

## 6. Action (visible parts)
- **Strike line**: straight in plan from (x 0.140, z 0.537) to (x 1.341, z 0.472). It is slanted, as on the real D: the bass keys are longer [M].
- **Hammer x**: evenly pitched 12.98 mm inside 5 sections, with an extra 18 mm gap at each strut: sections 1–20 | 21–39 | 40–57 | 58–76 | 77–88. Values are in the JSON (`hammer_x`). They follow the key centers within ≤ 14 mm, which is the normal "cranked" offset.
- **Hammer head**:
  - Felt profile depth (z) 0.032 (low bass) → 0.013 (top treble) [S] (Howard 1¼ in → ½ in).
  - Lateral width (x) 0.0115 bass → 0.0100 treble [S] (13/32 in).
  - Overall head height (molding tail to crown) 0.082 bass / 0.076 treble [S].
  - Crown to shank center 0.051 [S] ("2 in" striking length).
  - Mass 11 g → 5.8 g [S] (INRIA, KTH).
- **Hammer shank**: Ø0.0075, hornbeam. Flange pivot 0.125 in front of the head (toward the player) at y ≈ 0.765.
- **At rest**: crown is **0.046 below the string** (blow distance 45–47 mm) [S]. That puts it at y 0.816 in the tenor/treble and 0.834 in the bass.
- **Strike rotation** ≈ 20° about the flange. Let-off 1–3 mm before the string [S]. After the blow it checks about 0.016 below the string while the key is held [S].
- **Dampers**: notes **1–67** (A0–D#6). Notes 68–88 (E6–C8) are undamped [S] (forum: the top 21 Steinway notes are undamped).
  - Head center 0.030 behind the strike point, on top of the strings.
  - Head size: x = hammer pitch − 1.5 mm (≈0.0115), z 0.045 (bass) → 0.030 (treble), height 0.025. Black satin lacquer [M] (D photo).
  - Felt below: 0.010–0.012 thick, cream. Use V-wedge felt on wound strings, flat with two V-grooves on trichords.
  - Damper wire Ø0.0035 brass going down in front of the belly rail.
  - **Lift**: 0.006 with the key (starting at half dip). **All lift 0.008** with the sustain pedal. Sostenuto holds the lifted ones.

## 7. Strings and scale

### 7.1 Counts (B)
- Notes 1–20 (A0–E2) are on the **bass bridge**: **1–8 single** wound, **9–20 bichord** wound.
- Notes 21–88 (F2–C8) are on the **long bridge**: plain-wire **trichords**.
- Totals: **236 strings, 236 tuning pins, 472 bridge pins**. Hitch pins: about 134 (plain wire loops 2 strings per pin, wound strings 1 per pin).
- Sources:
  - [S] PTG: on the B, notes 1–20 are on the bass bridge and note 21 is the lowest plain-wire trichord.
  - [S] Pianoteq forum: lowest 8 single on the medium grand.
  - The generic split (Hyperphysics 10/18/60) is a fallback.
- D: bass bridge also carries 20 notes [S]. One source claims 7 wound trichords in the D bass (unverified), so use the B layout for both.

### 7.2 Speaking lengths
- The D lengths are measured data from the INRIA report (Steinway D, C1–B7; A0–B0 and C8 extrapolated). The B lengths are the D lengths × r(n):
  - r = 0.75 for n ≤ 20.
  - r = 1 − 0.25·e^(−(n−21)/12.7) for n ≥ 21.
- Check: the B A0 comes out at 1.508 vs Steinway's 1.51 m spec. The B F2 at 1.378 m with plain wire matches the PTG report of low-tension low-tenor trichords (~119 lb).
- Note the **break jump**: E2 1.034 → F2 1.378 m (D: 1.378 → 1.837 m). This is real: the first tenor strings are longer than the last bass strings [M] (INRIA table).

### 7.3 Wire
- Plain wire Ø 1.10 mm (F2) → 0.775 mm (C8, size 13) [S].
- Copper-wound overall Ø 6.0 mm (A0) → 2.3 mm (E2) [S] (bass up to 0.240 in). Leave 0.025 of bare steel core at both ends [S] (PTG).
- Winding: pure copper. Use a normal map with helical grooves at a pitch equal to the wrap-wire Ø (0.3–1.0 mm).
- Unison lateral spacing: trichord ±0.0039, wound bichord ±0.0025.

### 7.4 Plan geometry per note
Each string runs pin → front termination (agraffe/capo) → strike → bridge → hitch along one straight direction. The angle is measured from +z toward +x:
- Bass: +11.0° → +15.8°.
- Low tenor: −7.0° → 0° at F4.
- Treble: up to +1.5° at C6, then back to 0°.

The bass strings therefore **cross over** the tenor (an X in plan), as in the D photo and ref 6.

### 7.5 Heights (y)
| element | y |
|---|---|
| tenor/treble strings at agraffe/strike | 0.862 |
| at long-bridge top | 0.858 |
| hitch loop | 0.852 |
| bass strings at agraffe | 0.880 |
| at bass-bridge top (0.025 above tenor at the crossing) | 0.892 |

### 7.6 Per-note table (B-class)
Columns:
- **key** W/B; **key x** = key center.
- **str** = strings per note; **wire** = plain Ø or Cu overall Ø (mm).
- **front** = agraffe (1–52) or capo bar (53–88) termination.
- **pin** = tuning-pin row A. Trichord pins use rows A, B, C at z −0.000/−0.018/−0.036 with x offsets −4.5/0/+4.5 mm. Bichords and singles alternate rows A/B.
- All points are `(x, z)`.

| n | note | key | key x | str | wire mm | L m | strike x,z | front x,z | bridge x,z | hitch x,z | pin(row A) x,z | angle deg | term | damper |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A0 | W | 0.1407 | 1 | Cu 6.0 | 1.508 | 0.140, 0.536 | 0.105, 0.357 | 0.392, 1.837 | 0.411, 1.935 | 0.094, 0.301 | +11.0 | agraffe | Y |
| 2 | A#0 | B | 0.1559 | 1 | Cu 5.7 | 1.507 | 0.152, 0.536 | 0.117, 0.357 | 0.411, 1.835 | 0.430, 1.933 | 0.106, 0.300 | +11.2 | agraffe | Y |
| 3 | B0 | W | 0.1643 | 1 | Cu 5.4 | 1.506 | 0.165, 0.535 | 0.129, 0.356 | 0.429, 1.832 | 0.449, 1.930 | 0.117, 0.300 | +11.5 | agraffe | Y |
| 4 | C1 | W | 0.1878 | 1 | Cu 5.2 | 1.505 | 0.178, 0.534 | 0.142, 0.357 | 0.448, 1.831 | 0.469, 1.929 | 0.130, 0.301 | +11.8 | agraffe | Y |
| 5 | C#1 | B | 0.1971 | 1 | Cu 4.9 | 1.498 | 0.191, 0.534 | 0.154, 0.358 | 0.465, 1.823 | 0.486, 1.920 | 0.142, 0.301 | +12.0 | agraffe | Y |
| 6 | D1 | W | 0.2112 | 1 | Cu 4.7 | 1.486 | 0.204, 0.533 | 0.167, 0.359 | 0.482, 1.810 | 0.503, 1.908 | 0.154, 0.302 | +12.2 | agraffe | Y |
| 7 | D#1 | B | 0.2253 | 1 | Cu 4.4 | 1.474 | 0.217, 0.532 | 0.179, 0.359 | 0.498, 1.798 | 0.520, 1.896 | 0.167, 0.303 | +12.5 | agraffe | Y |
| 8 | E1 | W | 0.2347 | 1 | Cu 4.2 | 1.454 | 0.230, 0.532 | 0.192, 0.361 | 0.512, 1.779 | 0.535, 1.876 | 0.179, 0.305 | +12.8 | agraffe | Y |
| 9 | F1 | W | 0.2582 | 2 | Cu 4.0 | 1.433 | 0.243, 0.531 | 0.205, 0.364 | 0.527, 1.760 | 0.550, 1.857 | 0.192, 0.307 | +13.0 | agraffe | Y |
| 10 | F#1 | B | 0.2666 | 2 | Cu 3.8 | 1.409 | 0.256, 0.530 | 0.218, 0.366 | 0.541, 1.738 | 0.564, 1.835 | 0.204, 0.309 | +13.2 | agraffe | Y |
| 11 | G1 | W | 0.2818 | 2 | Cu 3.6 | 1.381 | 0.269, 0.529 | 0.231, 0.368 | 0.553, 1.712 | 0.576, 1.809 | 0.217, 0.312 | +13.5 | agraffe | Y |
| 12 | G#1 | B | 0.2935 | 2 | Cu 3.4 | 1.354 | 0.282, 0.529 | 0.244, 0.371 | 0.565, 1.686 | 0.589, 1.783 | 0.230, 0.314 | +13.8 | agraffe | Y |
| 13 | A1 | W | 0.3053 | 2 | Cu 3.3 | 1.321 | 0.295, 0.528 | 0.257, 0.375 | 0.577, 1.657 | 0.601, 1.754 | 0.243, 0.318 | +14.0 | agraffe | Y |
| 14 | A#1 | B | 0.3204 | 2 | Cu 3.1 | 1.282 | 0.308, 0.527 | 0.270, 0.378 | 0.586, 1.621 | 0.611, 1.718 | 0.256, 0.322 | +14.2 | agraffe | Y |
| 15 | B1 | W | 0.3287 | 2 | Cu 3.0 | 1.241 | 0.321, 0.527 | 0.284, 0.382 | 0.595, 1.584 | 0.620, 1.681 | 0.269, 0.326 | +14.5 | agraffe | Y |
| 16 | C2 | W | 0.3523 | 2 | Cu 2.8 | 1.202 | 0.334, 0.526 | 0.297, 0.387 | 0.603, 1.549 | 0.629, 1.645 | 0.283, 0.331 | +14.8 | agraffe | Y |
| 17 | C#2 | B | 0.3617 | 2 | Cu 2.7 | 1.161 | 0.347, 0.525 | 0.311, 0.391 | 0.612, 1.512 | 0.637, 1.609 | 0.296, 0.335 | +15.0 | agraffe | Y |
| 18 | D2 | W | 0.3757 | 2 | Cu 2.5 | 1.121 | 0.360, 0.525 | 0.325, 0.395 | 0.620, 1.477 | 0.646, 1.573 | 0.309, 0.339 | +15.2 | agraffe | Y |
| 19 | D#2 | B | 0.3898 | 2 | Cu 2.4 | 1.081 | 0.373, 0.524 | 0.338, 0.399 | 0.627, 1.441 | 0.654, 1.538 | 0.323, 0.343 | +15.5 | agraffe | Y |
| 20 | E2 | W | 0.3992 | 2 | Cu 2.3 | 1.034 | 0.386, 0.523 | 0.352, 0.404 | 0.633, 1.399 | 0.660, 1.495 | 0.337, 0.348 | +15.8 | agraffe | Y |
| 21 | F2 | W | 0.4228 | 3 | 1.100 | 1.378 | 0.417, 0.522 | 0.437, 0.358 | 0.269, 1.725 | 0.253, 1.854 | 0.444, 0.303 | -7.0 | agraffe | Y |
| 22 | F#2 | B | 0.4311 | 3 | 1.094 | 1.351 | 0.430, 0.521 | 0.449, 0.360 | 0.291, 1.702 | 0.276, 1.831 | 0.455, 0.305 | -6.7 | agraffe | Y |
| 23 | G2 | W | 0.4462 | 3 | 1.089 | 1.306 | 0.443, 0.520 | 0.461, 0.365 | 0.315, 1.662 | 0.300, 1.791 | 0.467, 0.310 | -6.4 | agraffe | Y |
| 24 | G#2 | B | 0.4580 | 3 | 1.083 | 1.277 | 0.456, 0.520 | 0.472, 0.367 | 0.336, 1.637 | 0.322, 1.766 | 0.478, 0.312 | -6.1 | agraffe | Y |
| 25 | A2 | W | 0.4698 | 3 | 1.077 | 1.212 | 0.469, 0.519 | 0.484, 0.374 | 0.361, 1.579 | 0.347, 1.709 | 0.489, 0.319 | -5.8 | agraffe | Y |
| 26 | A#2 | B | 0.4849 | 3 | 1.072 | 1.166 | 0.482, 0.518 | 0.495, 0.379 | 0.383, 1.540 | 0.370, 1.670 | 0.501, 0.325 | -5.5 | agraffe | Y |
| 27 | B2 | W | 0.4933 | 3 | 1.066 | 1.122 | 0.495, 0.517 | 0.507, 0.383 | 0.405, 1.500 | 0.393, 1.630 | 0.512, 0.328 | -5.2 | agraffe | Y |
| 28 | C3 | W | 0.5168 | 3 | 1.060 | 1.078 | 0.508, 0.517 | 0.519, 0.388 | 0.426, 1.462 | 0.415, 1.591 | 0.524, 0.333 | -5.0 | agraffe | Y |
| 29 | C#3 | B | 0.5262 | 3 | 1.055 | 1.033 | 0.521, 0.516 | 0.531, 0.393 | 0.447, 1.423 | 0.436, 1.552 | 0.535, 0.338 | -4.7 | agraffe | Y |
| 30 | D3 | W | 0.5403 | 3 | 1.049 | 0.990 | 0.534, 0.515 | 0.543, 0.397 | 0.467, 1.384 | 0.458, 1.513 | 0.547, 0.342 | -4.4 | agraffe | Y |
| 31 | D#3 | B | 0.5544 | 3 | 1.044 | 0.948 | 0.547, 0.515 | 0.555, 0.402 | 0.487, 1.347 | 0.478, 1.477 | 0.559, 0.347 | -4.1 | agraffe | Y |
| 32 | E3 | W | 0.5637 | 3 | 1.039 | 0.906 | 0.560, 0.514 | 0.567, 0.405 | 0.507, 1.310 | 0.498, 1.439 | 0.571, 0.350 | -3.8 | agraffe | Y |
| 33 | F3 | W | 0.5873 | 3 | 1.033 | 0.867 | 0.573, 0.513 | 0.579, 0.410 | 0.526, 1.275 | 0.518, 1.405 | 0.583, 0.355 | -3.5 | agraffe | Y |
| 34 | F#3 | B | 0.5956 | 3 | 1.028 | 0.827 | 0.586, 0.513 | 0.591, 0.414 | 0.545, 1.240 | 0.538, 1.369 | 0.594, 0.359 | -3.2 | agraffe | Y |
| 35 | G3 | W | 0.6108 | 3 | 1.022 | 0.789 | 0.599, 0.512 | 0.604, 0.418 | 0.563, 1.206 | 0.557, 1.336 | 0.606, 0.363 | -2.9 | agraffe | Y |
| 36 | G#3 | B | 0.6225 | 3 | 1.017 | 0.753 | 0.612, 0.511 | 0.616, 0.421 | 0.581, 1.173 | 0.576, 1.299 | 0.618, 0.366 | -2.6 | agraffe | Y |
| 37 | A3 | W | 0.6342 | 3 | 1.012 | 0.718 | 0.625, 0.511 | 0.628, 0.424 | 0.599, 1.142 | 0.594, 1.263 | 0.630, 0.369 | -2.3 | agraffe | Y |
| 38 | A#3 | B | 0.6494 | 3 | 1.006 | 0.684 | 0.638, 0.510 | 0.641, 0.428 | 0.616, 1.111 | 0.612, 1.228 | 0.642, 0.373 | -2.0 | agraffe | Y |
| 39 | B3 | W | 0.6577 | 3 | 1.001 | 0.652 | 0.651, 0.509 | 0.653, 0.431 | 0.633, 1.083 | 0.630, 1.196 | 0.655, 0.376 | -1.8 | agraffe | Y |
| 40 | C4 | W | 0.6813 | 3 | 0.996 | 0.620 | 0.682, 0.508 | 0.683, 0.433 | 0.668, 1.053 | 0.665, 1.162 | 0.685, 0.378 | -1.5 | agraffe | Y |
| 41 | C#4 | B | 0.6906 | 3 | 0.991 | 0.590 | 0.695, 0.507 | 0.696, 0.436 | 0.684, 1.026 | 0.682, 1.131 | 0.697, 0.381 | -1.2 | agraffe | Y |
| 42 | D4 | W | 0.7047 | 3 | 0.986 | 0.562 | 0.708, 0.506 | 0.709, 0.439 | 0.700, 1.000 | 0.698, 1.103 | 0.709, 0.384 | -0.9 | agraffe | Y |
| 43 | D#4 | B | 0.7188 | 3 | 0.981 | 0.534 | 0.721, 0.505 | 0.721, 0.442 | 0.716, 0.976 | 0.715, 1.075 | 0.722, 0.387 | -0.6 | agraffe | Y |
| 44 | E4 | W | 0.7282 | 3 | 0.975 | 0.507 | 0.734, 0.505 | 0.734, 0.444 | 0.731, 0.951 | 0.731, 1.047 | 0.734, 0.389 | -0.3 | agraffe | Y |
| 45 | F4 | W | 0.7518 | 3 | 0.970 | 0.482 | 0.747, 0.504 | 0.747, 0.446 | 0.747, 0.928 | 0.747, 1.021 | 0.747, 0.391 | +0.0 | agraffe | Y |
| 46 | F#4 | B | 0.7601 | 3 | 0.965 | 0.458 | 0.759, 0.503 | 0.759, 0.449 | 0.760, 0.907 | 0.760, 0.997 | 0.759, 0.394 | +0.1 | agraffe | Y |
| 47 | G4 | W | 0.7752 | 3 | 0.960 | 0.435 | 0.772, 0.503 | 0.772, 0.451 | 0.773, 0.886 | 0.774, 0.973 | 0.772, 0.396 | +0.2 | agraffe | Y |
| 48 | G#4 | B | 0.7870 | 3 | 0.955 | 0.413 | 0.785, 0.502 | 0.785, 0.453 | 0.787, 0.866 | 0.787, 0.951 | 0.785, 0.398 | +0.2 | agraffe | Y |
| 49 | A4 | W | 0.7987 | 3 | 0.950 | 0.393 | 0.798, 0.501 | 0.798, 0.455 | 0.800, 0.848 | 0.801, 0.930 | 0.798, 0.400 | +0.3 | agraffe | Y |
| 50 | A#4 | B | 0.8139 | 3 | 0.945 | 0.373 | 0.811, 0.501 | 0.811, 0.456 | 0.814, 0.829 | 0.814, 0.909 | 0.811, 0.401 | +0.4 | agraffe | Y |
| 51 | B4 | W | 0.8223 | 3 | 0.940 | 0.354 | 0.824, 0.500 | 0.824, 0.457 | 0.827, 0.811 | 0.828, 0.889 | 0.824, 0.402 | +0.5 | agraffe | Y |
| 52 | C5 | W | 0.8458 | 3 | 0.935 | 0.337 | 0.837, 0.499 | 0.837, 0.459 | 0.840, 0.796 | 0.841, 0.871 | 0.836, 0.404 | +0.6 | agraffe | Y |
| 53 | C#5 | B | 0.8551 | 3 | 0.931 | 0.319 | 0.850, 0.499 | 0.850, 0.460 | 0.853, 0.780 | 0.854, 0.853 | 0.849, 0.385 | +0.6 | capo | Y |
| 54 | D5 | W | 0.8692 | 3 | 0.926 | 0.302 | 0.863, 0.498 | 0.863, 0.462 | 0.867, 0.764 | 0.868, 0.835 | 0.862, 0.387 | +0.7 | capo | Y |
| 55 | D#5 | B | 0.8833 | 3 | 0.921 | 0.287 | 0.876, 0.497 | 0.876, 0.463 | 0.880, 0.750 | 0.881, 0.819 | 0.875, 0.388 | +0.8 | capo | Y |
| 56 | E5 | W | 0.8928 | 3 | 0.916 | 0.273 | 0.889, 0.497 | 0.889, 0.464 | 0.893, 0.737 | 0.894, 0.804 | 0.888, 0.389 | +0.9 | capo | Y |
| 57 | F5 | W | 0.9163 | 3 | 0.911 | 0.258 | 0.902, 0.496 | 0.902, 0.465 | 0.906, 0.723 | 0.907, 0.789 | 0.900, 0.390 | +1.0 | capo | Y |
| 58 | F#5 | B | 0.9246 | 3 | 0.907 | 0.246 | 0.933, 0.494 | 0.933, 0.465 | 0.937, 0.710 | 0.938, 0.775 | 0.931, 0.390 | +1.0 | capo | Y |
| 59 | G5 | W | 0.9397 | 3 | 0.902 | 0.233 | 0.946, 0.493 | 0.946, 0.466 | 0.950, 0.699 | 0.951, 0.762 | 0.944, 0.391 | +1.1 | capo | Y |
| 60 | G#5 | B | 0.9515 | 3 | 0.897 | 0.220 | 0.959, 0.493 | 0.959, 0.466 | 0.963, 0.686 | 0.965, 0.748 | 0.957, 0.391 | +1.2 | capo | Y |
| 61 | A5 | W | 0.9633 | 3 | 0.892 | 0.209 | 0.972, 0.492 | 0.972, 0.467 | 0.976, 0.676 | 0.978, 0.736 | 0.970, 0.392 | +1.3 | capo | Y |
| 62 | A#5 | B | 0.9784 | 3 | 0.888 | 0.198 | 0.985, 0.491 | 0.985, 0.468 | 0.989, 0.666 | 0.991, 0.724 | 0.983, 0.393 | +1.4 | capo | Y |
| 63 | B5 | W | 0.9868 | 3 | 0.883 | 0.188 | 0.998, 0.491 | 0.998, 0.468 | 1.002, 0.656 | 1.004, 0.714 | 0.996, 0.393 | +1.4 | capo | Y |
| 64 | C6 | W | 1.0103 | 3 | 0.879 | 0.178 | 1.011, 0.490 | 1.010, 0.468 | 1.015, 0.647 | 1.017, 0.703 | 1.008, 0.393 | +1.5 | capo | Y |
| 65 | C#6 | B | 1.0196 | 3 | 0.874 | 0.170 | 1.024, 0.489 | 1.024, 0.470 | 1.028, 0.639 | 1.029, 0.695 | 1.022, 0.395 | +1.5 | capo | Y |
| 66 | D6 | W | 1.0337 | 3 | 0.869 | 0.161 | 1.037, 0.489 | 1.037, 0.470 | 1.040, 0.631 | 1.042, 0.685 | 1.035, 0.395 | +1.4 | capo | Y |
| 67 | D#6 | B | 1.0478 | 3 | 0.865 | 0.152 | 1.050, 0.488 | 1.050, 0.470 | 1.053, 0.622 | 1.054, 0.675 | 1.048, 0.395 | +1.3 | capo | Y |
| 68 | E6 | W | 1.0573 | 3 | 0.860 | 0.144 | 1.063, 0.487 | 1.063, 0.470 | 1.066, 0.615 | 1.067, 0.667 | 1.061, 0.395 | +1.3 | capo | - |
| 69 | F6 | W | 1.0808 | 3 | 0.856 | 0.137 | 1.076, 0.487 | 1.076, 0.470 | 1.079, 0.607 | 1.080, 0.658 | 1.074, 0.395 | +1.2 | capo | - |
| 70 | F#6 | B | 1.0891 | 3 | 0.851 | 0.129 | 1.089, 0.486 | 1.089, 0.470 | 1.091, 0.599 | 1.092, 0.650 | 1.087, 0.395 | +1.1 | capo | - |
| 71 | G6 | W | 1.1042 | 3 | 0.847 | 0.123 | 1.102, 0.485 | 1.102, 0.470 | 1.104, 0.594 | 1.105, 0.643 | 1.100, 0.395 | +1.1 | capo | - |
| 72 | G#6 | B | 1.1160 | 3 | 0.843 | 0.117 | 1.115, 0.485 | 1.115, 0.471 | 1.117, 0.587 | 1.118, 0.636 | 1.113, 0.396 | +1.0 | capo | - |
| 73 | A6 | W | 1.1278 | 3 | 0.838 | 0.111 | 1.128, 0.484 | 1.128, 0.471 | 1.129, 0.581 | 1.130, 0.630 | 1.126, 0.396 | +0.9 | capo | - |
| 74 | A#6 | B | 1.1429 | 3 | 0.834 | 0.105 | 1.141, 0.483 | 1.141, 0.470 | 1.142, 0.575 | 1.143, 0.622 | 1.139, 0.395 | +0.9 | capo | - |
| 75 | B6 | W | 1.1513 | 3 | 0.829 | 0.100 | 1.154, 0.482 | 1.154, 0.470 | 1.155, 0.570 | 1.156, 0.617 | 1.153, 0.396 | +0.8 | capo | - |
| 76 | C7 | W | 1.1747 | 3 | 0.825 | 0.095 | 1.167, 0.482 | 1.167, 0.471 | 1.168, 0.566 | 1.169, 0.612 | 1.166, 0.396 | +0.8 | capo | - |
| 77 | C#7 | B | 1.1842 | 3 | 0.821 | 0.090 | 1.198, 0.480 | 1.198, 0.469 | 1.199, 0.559 | 1.199, 0.605 | 1.197, 0.394 | +0.7 | capo | - |
| 78 | D7 | W | 1.1983 | 3 | 0.817 | 0.085 | 1.211, 0.479 | 1.211, 0.469 | 1.212, 0.554 | 1.212, 0.599 | 1.210, 0.395 | +0.6 | capo | - |
| 79 | D#7 | B | 1.2124 | 3 | 0.812 | 0.081 | 1.224, 0.479 | 1.224, 0.469 | 1.224, 0.550 | 1.225, 0.595 | 1.223, 0.394 | +0.6 | capo | - |
| 80 | E7 | W | 1.2217 | 3 | 0.808 | 0.076 | 1.237, 0.478 | 1.237, 0.469 | 1.237, 0.545 | 1.238, 0.590 | 1.236, 0.394 | +0.5 | capo | - |
| 81 | F7 | W | 1.2452 | 3 | 0.804 | 0.072 | 1.250, 0.477 | 1.250, 0.468 | 1.250, 0.540 | 1.250, 0.585 | 1.249, 0.393 | +0.4 | capo | - |
| 82 | F#7 | B | 1.2536 | 3 | 0.800 | 0.069 | 1.263, 0.477 | 1.263, 0.469 | 1.263, 0.538 | 1.263, 0.583 | 1.262, 0.394 | +0.4 | capo | - |
| 83 | G7 | W | 1.2688 | 3 | 0.796 | 0.065 | 1.276, 0.476 | 1.276, 0.468 | 1.276, 0.533 | 1.276, 0.578 | 1.275, 0.393 | +0.3 | capo | - |
| 84 | G#7 | B | 1.2805 | 3 | 0.791 | 0.062 | 1.289, 0.475 | 1.289, 0.468 | 1.289, 0.530 | 1.289, 0.575 | 1.288, 0.393 | +0.2 | capo | - |
| 85 | A7 | W | 1.2922 | 3 | 0.787 | 0.058 | 1.302, 0.475 | 1.302, 0.468 | 1.302, 0.525 | 1.302, 0.571 | 1.301, 0.393 | +0.2 | capo | - |
| 86 | A#7 | B | 1.3074 | 3 | 0.783 | 0.055 | 1.315, 0.474 | 1.315, 0.467 | 1.315, 0.522 | 1.315, 0.567 | 1.314, 0.392 | +0.1 | capo | - |
| 87 | B7 | W | 1.3157 | 3 | 0.779 | 0.052 | 1.327, 0.473 | 1.327, 0.467 | 1.328, 0.519 | 1.328, 0.564 | 1.327, 0.392 | +0.1 | capo | - |
| 88 | C8 | W | 1.3393 | 3 | 0.775 | 0.049 | 1.341, 0.473 | 1.341, 0.467 | 1.341, 0.515 | 1.341, 0.560 | 1.341, 0.392 | +0.0 | capo | - |

Clearance check (run): every bridge and hitch point is inside the inner rim. Minimum hitch-to-rim clearance is 0.079 (C8).

## 8. Cast-iron plate (gold), plan in `(x, z)`
The plate is a union of five parts, clipped to the inner rim offset by −0.008. Exact polygons are in the JSON. Plate area 1.05 m², soundboard area 1.45 m².
1. **Front panel / pinblock cover**: from z 0.255 (front edge, just behind the open fallboard) back to the front-termination line + 0.014. That back edge runs (0.06,0.371) (0.198,0.385) (0.337,0.418) (0.475,0.402) (0.613,0.445) (0.752,0.469) (0.890,0.479) (1.028,0.484) (1.166,0.485) (1.305,0.483) (1.42,0.481).
2. **Hitch band**: the region between the long bridge + 0.028 (along the string) and the rim, over the full tenor/treble, bentside and tail. This is where the treble rear-duplex segments and all hitch pins sit.
3. **Bass window** cut out of the band around the bass bridge: the hull of bridge −0.07 … hitch −0.03, grown by 0.012.
4. **Spine strip**: 0.045 wide along the left inner rim.
5. **Struts** (center lines, top width). Height 0.045, top at y 0.892. Sides draft 8°, top edge fillet 0.004.

| strut | from → to | width | note |
|---|---|---|---|
| A tenor-side break arm | (0.405,0.370) → (0.205,1.800) | 0.034 | Parallel to F2. The bass strings pass over it: lower its top to y 0.872 for z 1.0–1.6. |
| B bass-side break arm | (0.405,0.370) → (0.703,1.430) | 0.030 | Parallel to E2. Forms the "V" with A, as in the D photo. |
| C 39 \| 40 | (0.661,0.430) → (0.650,1.120) | 0.026 | Crosses over the long bridge. |
| D 57 \| 58 | (0.918,0.470) → (0.922,0.760) | 0.026 | |
| E 76 \| 77 | (1.182,0.470) → (1.184,0.600) | 0.024 | |
| F diagonal cross strut | (0.430,0.430) → (1.020,0.950) | 0.024 | Raised 0.012 above the tenor strings. This is the diagonal seen in refs 1 and 6. |

- **Plate surfaces**:
  - Front panel and band surface: y 0.850.
  - Raised agraffe ledge in the bass: y 0.868.
  - Plate web thickness 0.012, with 0.040-deep perimeter flanges under it. The underside is never seen.
- **Round flanged holes (6)**: centers (1.140,0.754) (0.950,0.914) (0.860,1.064) (0.790,1.224) (0.800,1.404) (0.200,1.894). Through-hole Ø0.055. A raised torus-like flange of OD 0.105 stands 0.008 high (Steinway B plate photo). They are placed automatically where the band is ≥ 0.13 wide and no string passes over.
- **Bolts (15)**: nickel hex nut 0.013 across flats × 0.009 tall on a Ø0.020 washer. Positions: (0.095,0.355) (0.104,1.914) (0.320,2.014) (0.576,1.978) (0.784,1.832) (0.874,1.589) (0.922,1.334) (0.983,1.081) (1.132,0.874) (1.362,0.754), and front strut roots (0.405,0.300) (0.661,0.300) (0.918,0.300) (1.182,0.300) (1.385,0.290).
- **Agraffes (notes 1–52)**:
  - Brass, hex body 0.010 across flats, 0.006 tall above the plate, domed top, with 1, 2 or 3 holes.
  - String hole center 0.010 above the plate.
  - Seated at the `front` point of each note.
- **Capo d'astro bar (notes 53–88)**: an integral plate ridge over the strings along the `front` points (z 0.460–0.471). It is 0.025 wide in z. Its V bearing edge sits at the string top (y 0.863) and its top is at y 0.900. Notes 53–88 is an estimate [E]; sources only say "upper treble".
- **Pressure bar**: nickel bar 0.012 (z) × 0.018 (y), 0.030 in front of the capo bar, spanning notes 53–88. Screws every 3 unisons.
- **Tuning pins**:
  - Ø0.007 [S] (size 2/0). Exposed 0.032 above the plate: coil of about 3 string turns centered 0.012 above the plate, head 0.010 tall slightly tapered square.
  - A light wooden bushing ring OD 0.012 sits around each pin at the plate.
  - Rows A/B/C at the `pin` z, then −0.018 and −0.036, with x offsets −4.5/0/+4.5 mm (trichords).
  - Rows run parallel to the agraffe line. The minimum distance to the plate front edge is 0.012 (checked in the render).
- **Hitch pins**: Ø0.006 steel, 0.025 tall, raked 15° away from the bridge. They sit at the `hitch` point of each note on the band (y 0.850). Plain wire loops around one pin per 2 strings.
- **Duplex areas** (Steinway: "front and rear duplex" [S]):
  - Front duplex = the segment between the capo bar and the pressure bar (treble).
  - Rear duplex = from the bridge to a raised **duplex bearing ridge** on the band, 0.6 of the way to the hitch pins. Ridge height 0.004, nickel or silver colour, notes 46–88.
  - Leave the treble rear segments **unmuted and bare**.
- **Red felts** (bright-to-deep red):
  - Front stringing braid woven over and under the strings midway between pins and agraffe/capo, notes 1–76. Strip 0.012 wide, 0.004 thick, wavy.
  - Rear understring felt / braid along the hitch pins, notes 1–45 (zig-zag following the pins, as in the D photo).
  - Both are visible in refs 1 and 6.
- **No logo**: optional plain raised oval cartouche 0.20 × 0.11 at about (1.25, 0.70), left blank.

## 9. Soundboard, bridges, belly rail, underside
- **Belly rail / soundboard front edge**: a line from (0.0, 0.575) to (1.48, 0.490), clipped to the inner rim. The treble hammers strike just in front of it.
- **Soundboard**:
  - Region: inner rim ∩ behind the belly line. 1.45 m² in plan.
  - Sitka/European spruce, **9 mm thick at center, tapering to 6 mm at the rim** [S].
  - Crown: +0.008 at the center. The top surface is at y 0.815 at the rim and 0.823 at the center.
  - **Grain (boards)** runs parallel to the long-bridge chord, **−48.5° from +x** (back-left → front-right). Boards are 0.10–0.14 wide with ±5% tone variation; ring spacing 1.5–2 mm.
- **Ribs**: under the board, **perpendicular to the grain (+41.5° from +x)**. 13 ribs at 0.11 spacing, 0.022 wide, 0.025 tall at center tapering to 0.009 at the ends (INRIA: 9–35 mm). Sugar pine. Visible only from below.
- **Long bridge**:
  - Smooth spline through the `bridge` points of notes 21–88: (0.269,1.725) (0.405,1.500) (0.526,1.275) (0.633,1.083) (0.747,0.928) (0.827,0.811) (0.906,0.723) (1.002,0.656) (1.079,0.607) (1.155,0.570) (1.250,0.540) (1.328,0.519) (1.341,0.515). Length 1.68.
  - Cap width 0.030 (tenor) → 0.024 (treble). Top at y 0.858, so it stands about 0.035–0.043 above the board.
  - Maple, with graphite-darkened top.
  - Sawtooth notching on both edges, one notch per string where it leaves its pin.
  - 2 bridge pins per string: Ø0.0028, 0.010 tall, front and back pins 0.007 apart along the string and ±0.0015 sideways (side bearing zig-zag).
- **Bass bridge**:
  - (0.392,1.837) (0.465,1.823) (0.527,1.760) (0.577,1.657) (0.612,1.512) (0.633,1.399). Length 0.54.
  - Width 0.036. Top at y 0.892, so it stands about 0.07 above the board (INRIA 29–69 mm).
  - It sits in the plate's bass window.
- **Underside** (low water-level shots, refs 2 and 9):
  - Rim bottom at y 0.712, plus 4 spruce braces/beams 0.090 wide × 0.090 tall.
  - The beams run from a hub at about (0.62, 1.05) to the rim at (0.06, 1.70), (0.35, 2.05), (0.95, 1.55) and (1.30, 0.86) [E]. Steinway B has "four solid spruce braces" [S].
  - Keybed underside y 0.625 for z 0–0.70.

## 10. Legs, lyre, pedals, casters, bench

### 10.1 Legs (3)
- **Positions**:
  - Front legs centered at **(x 0.147, z 0.350)** and **(x 1.333, z 0.350)**.
  - Rear leg at **(x 0.488, z 1.997)**.
  - [M] from the official B side drawing and the dimensions.com front elevation.
- **Profile** (square section, corners filleted r 0.006):

| part | y range | section | finish |
|---|---|---|---|
| top plate (front legs) | 0.600–0.625 | 0.457 long in z × 0.105 (18 in "top piece" [S]), ogee-scrolled ends | |
| capital / flare | 0.527–0.600 | 0.130 → 0.088 | |
| shaft | 0.170–0.527 | 0.088 → 0.078 square (tapering down) | |
| two-ring collar | 0.105–0.170 | 0.092, cove between the rings | |
| foot | 0.060–0.105 | 0.072 square | brass ferrule over 0.060–0.090 |

- Leg length without caster is 0.565 [S] (22¼ in for grands over 6 ft).
- **Rear leg**: identical. A spacer block 0.105 × 0.30 (y 0.625–0.712) sits under the rim bottom so all legs are equal length.
- **Casters**: brass twin wheels Ø0.060, each 0.016 wide with 0.004 between, axle at y 0.030. Brass horn/fork from 0.030 to 0.060. Swivel offset 0.020 (wheel trails behind the leg center).

### 10.2 Lyre
- Centered at **x 0.740** (case and keyboard center) [M], **z 0.405**.
- **Top block**: under the keybed, y 0.595–0.625, 0.305 (x) × 0.060 (z) [S] (12 × 2⅜ in).
- **Posts**: 2 posts at x 0.740 ± 0.085, section 0.030 (x) × 0.040 (z), y 0.105–0.595.
- **Pedal box**: y 0.040–0.105, 0.216 (x) × 0.080 (z) [S] (8½ × 3⅛ in). Front face at z 0.365.
- **Total lyre height**: 0.584 [S] (23 in).
- **Pedal rods**: 3 brass rods Ø0.008 [S] (5/16 in), about 0.545 long [S] (21½ in), between the posts at x 0.740 + (−0.078, 0, +0.078), z 0.43.
- **Lyre braces**: 2 rods Ø0.018 (black), from (x 0.740 ± 0.080, z 0.37, y 0.10) up and back to (x 0.740 ± 0.110, z 0.646, y 0.625). That is 21.8° from vertical, about 0.56 long [M] (traced on the official drawing).

### 10.3 Pedals (polished solid brass [S])
- Three pedals at **x 0.662 (una corda, left), 0.740 (sostenuto), 0.818 (damper/sustain, right)**. Spacing 0.078 [M].
  - Middle C (center x 0.681) lies between the una corda and the sostenuto. The damper pedal is under G4/A4.
- **Shape**: overall length 0.19 [S] (7–8⅝ in). Tip at **z 0.205** [M]. Pivot pin at z 0.370 inside the box. Rod pushes at 0.070 behind the pivot [S] (2¾ in).
- **Foot pad**: 0.110 long, 0.040 wide at the tip tapering to 0.030, 0.012 thick. Top surface at y 0.090 at rest, slightly upturned at the tip.
- **Travel at the tip**: sustain 0.012 (4.2°), una corda 0.010, sostenuto 0.010 [E].
- **Mapping to the action**:
  - Sustain: damper lift 0.008, beginning after about 30% of travel.
  - Una corda: keys + action +0.0025 x.

### 10.4 Bench (adjustable concert/artist bench, button-tufted leather)
- **Seat top**: 0.570 (x) × 0.370 (z) [S]. Steinway Largo is 58 × 42 cm; a Steinway concert bench listing gives 21½ × 16½ in.
- **Seat height**: 0.45–0.59 adjustable [S]; use 0.50 by default.
- **Cushion**: 0.075 thick, black leather.
  - Button tufting: 3 rows × 7 buttons. Buttons Ø0.016, pulled in 0.012. Diamond pleats between buttons.
  - Rolled front edge r 0.025. Double-stitched welt.
- **Frame**:
  - Black lacquer apron 0.085 tall.
  - 4 square tapered legs, 0.045 → 0.034, with brass-capped feet.
  - Scissor height mechanism hidden behind the apron.
  - **Side knobs** Ø0.055 × 0.030 deep, black lacquer, at the apron center of each short end (ref 7 shows one).
- **Placement**: centered at x 0.715. Near (front) edge at z −0.280, i.e. 0.30 from the white key fronts; far edge at −0.650.

## 11. Materials (Three.js `MeshPhysicalMaterial`, linear workflow; sRGB given as hex)

| part | colour | metalness | roughness | extras |
|---|---|---|---|---|
| ebony lacquer (case, lid, desk, key slip, legs) | #050505 (photo median 5,5,5) | 0 | 0.35 (base) | clearcoat 1.0, clearcoatRoughness 0.025 (≤0.04), ior 1.5. Very low "orange-peel" clearcoatNormalMap (wavelength 3–8 mm, slope ≤0.002). Faint swirl scratches only in macro shots. Fillets on every edge. |
| plate (bronze/gold lacquer over iron) | #E0B276 (photo medians #E8B373 / #BD8A40 under warm light) | 0.85 | 0.38 | clearcoat 0.3 @ roughness 0.25. Cast-surface bump 1–2 mm noise, amplitude 0.0002. Flange crests a little brighter. |
| soundboard (spruce, varnished) | #CFA867 with grain (photo #C28A37 under warm light) | 0 | 0.35 | clearcoat 0.4 @ 0.2. Grain along −48.5°. |
| bridge cap (maple) / top | #D9B98A / graphite #3A3A3A | 0 | 0.4 / 0.55 | |
| plain strings (steel) | lin (0.80, 0.80, 0.82) | 1 | 0.18 | anisotropy 0.6 along the wire |
| wound strings (copper) | lin (0.80, 0.47, 0.33) (aged copper) | 1 | 0.30 | helical-groove normal map; bare steel ends 0.025 |
| tuning pins | shaft lin (0.10, 0.11, 0.14) blued; head nickel (0.75, 0.74, 0.70) | 1 | 0.35 / 0.15 | |
| agraffes, pedals, casters, ferrules, hinges | brass lin (0.89, 0.72, 0.38) | 1 | 0.12 (pedals 0.08–0.25 scuff map) | |
| bolts, pressure bar, hitch and bridge pins | nickel/steel (0.75, 0.75, 0.73) | 1 | 0.15–0.30 | |
| hammer top felt | #EDE8DA | 0 | 1.0 | sheen 1, sheenColor #E6E1D2, sheenRoughness 0.6; underfelt stripe #C9C6BE; molding mahogany #8A5A3A |
| damper felt / damper heads | #E9E4D6 / black satin | 0 | 1.0 / 0.4 | heads clearcoat 0.3 |
| red felts (braids, nameboard strip, punchings) | #9A1626 | 0 | 1.0 | sheen 1, sheenColor #C0303A |
| white keytops (acrylic, slightly warm) | #EEEAE0 | 0 | 0.22 | clearcoat 0.5 @ 0.12. Optional thin subsurface. Key sides below the 2 mm top: #D8C7A4 wood. |
| black keys (ebony/phenolic, satin) | #0E0E10 | 0 | 0.30 | clearcoat 0.2 @ 0.25; faint wood-grain bump if ebony |
| bench leather | #121112 | 0 | 0.55 | sheen 0.3, 0.5 mm grain normal |

## 12. Assembly heights cheat-sheet (y)
| element | y |
|---|---|
| floor | 0 |
| caster axle | 0.030 |
| pedal tread | 0.090 |
| keybed underside | 0.625 |
| keybed top | 0.6695 |
| key slip top | 0.702 |
| balance axis | 0.686 |
| white key top | 0.715 |
| sharp top | 0.7275 |
| fallboard roll top | 0.790 |
| rim bottom | 0.712 |
| soundboard (rim / center) | 0.815 / 0.823 |
| hammer crown at rest (tenor / bass) | 0.816 / 0.834 |
| plate surface | 0.850 |
| long-bridge top | 0.858 |
| tenor/treble strings | 0.862 |
| bass strings | 0.880–0.892 |
| strut tops | 0.892 |
| capo bar top | 0.900 |
| damper head tops | 0.897 (lifted 0.905) |
| tuning-pin tops | 0.882 |
| rim top | 1.000 |
| closed lid top | 1.022 |
| desk top | 1.262 |
| lid far edge at full stick | 1.886 |

## 13. Main dimensions (JSON)
```json
{
  "units": "m", "origin": "floor below front-left case corner; x right, z toward tail, y up",
  "case": {"length": 2.110, "width": 1.480, "rimThickness": 0.060, "rimTopY": 1.000, "rimBottomY": 0.712,
           "keybedBottomY": 0.625, "keybedThickness": 0.0445, "keybedDepthZ": 0.700,
           "outlineXZ": [[0,0],[1.48,0],[1.48,0.70],[1.478,0.73],[1.472,0.76],[1.459,0.79],[1.434,0.82],[1.39,0.85],[1.325,0.88],[1.258,0.91],[1.202,0.94],[1.162,0.97],[1.133,1.0],[1.099,1.05],[1.076,1.10],[1.046,1.20],[1.025,1.30],[1.007,1.40],[0.989,1.50],[0.969,1.60],[0.944,1.70],[0.917,1.78],[0.885,1.85],[0.854,1.90],[0.812,1.95],[0.75,2.001],[0.70,2.031],[0.65,2.053],[0.60,2.07],[0.55,2.084],[0.50,2.095],[0.45,2.103],[0.40,2.108],[0.35,2.11],[0.30,2.109],[0.25,2.105],[0.20,2.099],[0.15,2.087],[0.10,2.066],[0.076,2.05],[0.035,2.0],[0.014,1.95],[0.004,1.90],[0,1.85]]},
  "lid": {"thickness": 0.022, "frontFlapZ": [0.175, 0.560], "hingeAxis": {"x": -0.004, "y": 1.012}, "hingesZ": [0.80, 1.30, 1.80],
          "prop": {"baseXYZ": [1.435, 1.000, 0.650], "full": {"length": 0.840, "cupR": 1.170, "angleDeg": 35.2},
                   "short": {"length": 0.360, "cupR": 1.360, "angleDeg": 13.9}}},
  "keyboard": {"keys": 88, "leftX": 0.129, "rightX": 1.351, "whitePitch": 0.0235, "octave": 0.1645,
               "white": {"length": 0.150, "headLength": 0.050, "headWidth": 0.0225, "topThickness": 0.002, "frontZ": 0.022, "topY": 0.715},
               "black": {"baseLength": 0.095, "topLength": 0.085, "baseWidth": 0.0127, "topWidth": 0.0098, "heightAboveWhite": 0.0125, "frontZ": 0.073},
               "blackCentersMmFromC": {"C#": 21.15, "D#": 49.35, "F#": 90.64, "G#": 117.50, "A#": 144.36},
               "pivot": {"y": 0.686, "z": 0.290}, "whiteDipDeg": 2.14, "blackDipDeg": 2.46, "unaCordaShiftX": 0.0025,
               "keySlip": {"y": [0.660, 0.702], "z": [0.000, 0.020]},
               "cheekBlocks": {"leftX": [0.060, 0.128], "rightX": [1.352, 1.420], "z": [0.0, 0.172], "topY": 0.738},
               "fallboardOpen": {"faceZ": 0.172, "y": [0.729, 0.790], "rollRadius": 0.016}},
  "action": {"strikeLineXZ": [[0.140, 0.537], [1.341, 0.472]], "blowDistance": 0.046, "dampedNotes": [1, 67],
             "damperLiftKey": 0.006, "damperLiftPedal": 0.008, "hammerMassG": [11.0, 5.8]},
  "strings": {"total": 236, "single": [1, 8], "bichordWound": [9, 20], "trichordPlain": [21, 88],
              "agraffes": [1, 52], "capo": [53, 88], "a0Length": 1.508, "c8Length": 0.049, "tenorY": 0.862, "bassY": [0.880, 0.892]},
  "soundboard": {"thicknessCenter": 0.009, "thicknessEdge": 0.006, "crown": 0.008, "topYEdge": 0.815, "grainDegFromX": -48.5,
                 "ribs": 13, "bellyLineXZ": [[0.0, 0.575], [1.48, 0.490]]},
  "legs": {"frontXZ": [[0.147, 0.350], [1.333, 0.350]], "rearXZ": [0.488, 1.997], "lengthNoCaster": 0.565, "casterWheelD": 0.060},
  "lyre": {"x": 0.740, "z": 0.405, "height": 0.584, "pedalX": [0.662, 0.740, 0.818], "pedalTipZ": 0.205, "pedalTreadY": 0.090,
           "pedalTravelTip": {"sustain": 0.012, "unaCorda": 0.010, "sostenuto": 0.010}},
  "musicDesk": {"width": 0.840, "height": 0.270, "tiltDeg": 14, "bottomZY": [0.255, 1.000]},
  "bench": {"seat": [0.570, 0.370], "heightRange": [0.45, 0.59], "defaultHeight": 0.50, "centerX": 0.715, "nearEdgeZ": -0.280},
  "dClass": {"length": 2.740, "width": 1.560, "a0Length": 2.010, "longestKey": 0.622, "massKg": 480}
}
```

## 14. Sources
- Steinway Model B spec page: length, width, rim 2¾ in / 16 maple layers, soundboard 9 → 6 mm, longest string 59¼ in, longest key 21 in, keybed 1¾ in, tension, 4 spruce braces, front and rear duplex. https://prod.steinway.com/pianos/steinway/grand/model-b ; https://msteinert.com/steinway-model-b
- **Official Steinway Model B side drawing** with 211 cm scale bar (measured pixel-wise): https://www.steinway.com/.imaging/mte/steinway-us-theme/XL-Square/dam/pianos/Steinway_Grands/model-b/ModelB_dimensions.jpg/jcr:content/ModelB_dimensions.jpg
- Steinway B overhead photo (keyboard area, fallboard felt, desk, plate holes): https://www.steinway.com/.imaging/mte/steinway-us-theme/Large-Rectangle/dam/pianos/Steinway_Grands/model-b/b_overhead.jpg/jcr:content/b_overhead.jpg ; plate close-up …/b_plate_square.jpg
- dimensions.com Model B / Model D: plan + elevations (vector SVG; plan outline source), top-of-key 28.125 in, D height. https://www.dimensions.com/element/steinway-grand-piano-model-b ; https://www.dimensions.com/element/steinway-grand-piano-model-d
- Steinway D: 274 × 156 cm, 480 kg, longest string 79¼ in, longest key 24½ in, 20-note bass. https://en.wikipedia.org/wiki/Steinway_D-274 ; https://msteinert.com/steinway-model-d ; https://www.steinway-gallery.com.sg/?p=685
- **Chabassier & Durufle, "Physical parameters for piano modeling", INRIA RT-0425 (2012)**: per-note speaking lengths, wire Ø, strike distances, hammer masses, bridge contact points, soundboard and rib thickness, rib layout, and the top-view Steinway D photo with metre axes. https://inria.hal.science/hal-00688679v2
- Yamaha C6X (W 154 × H 102 lid closed × D 212 cm, 405 kg): https://europe.yamaha.com/musical-instruments/pianos/products/grand-pianos/cx-series/ ; https://www.forsyths.co.uk/pianos/grand-pianos/yamaha-grand-pianos/214993-yamaha-c6x-grand-piano-in-black-polyester.html
- Keyboard: octave 164–165 mm, black 13.7 mm average. https://en.wikipedia.org/wiki/Musical_keyboard ; equal-slot optimum pattern https://www.mathpages.com/home/kmath043.htm ; hand-measured 23.5/150/15/95 mm and offsets https://wiki.lilypond.community/wiki/LSR_1042 ; https://tildes.net/~design/1p24/piano_key_dimensions_are_a_math_puzzle
- Keytops (50 mm head, 0.080 in; 6 in long, ½ in tails): https://www.howardpianoindustries.com/german-piano-keytops-with-fronts-white-50mm-head-size-premium-replacement-set ; https://www.howardpianoindustries.com/simulated-ivory-piano-keytops
- Regulation (dip 10 mm, blow 42–47 mm, let-off 1/16 in, drop 1/8 in, check 5/8 in, sharps ½ in above whites): https://my.ptg.org/discussion/1933-schiller-grand-regulation-specs ; https://www.mmdigest.com/archives/Digests/200208/2002.08.23.06.html ; https://www.howardpianoindustries.com/regulating-the-hammer-blow-distance-in-a-grand-piano/ ; https://www.speech.kth.se/music/5_lectures/askenflt/timing.html
- Key ratio about 1:1.9 (Steinway measurement): https://mmdigest.com/Archives/Digests/200203/2002.03.22.10.html
- Touch timing and velocities (KTH, Askenfelt): https://www.speech.kth.se/music/5_lectures/askenflt/motions.html ; https://www.speech.kth.se/music/5_lectures/askenflt/keybott.html
- Hammers (Abel sizes, felt widths by register): https://howardpianoindustries.com/replacement-grand-piano-hammers-individual ; masses https://www.speech.kth.se/music/5_lectures/conklin/thehammers.html
- Steinway B stringing (bass bridge notes 1–20, plain-wire trichords from 21, 25 mm bare core): https://my.ptg.org/discussion/steinway-b-stringing ; lowest 8 single on the medium grand https://forum.modartt.com/viewtopic.php?id=5324 ; generic 10/18/60 split and 1/7 strike https://hyperphysics.gsu.edu/hbase/Music/pianof.html ; wire Ø range https://en.wikipedia.org/wiki/Piano_acoustics
- Undamped top notes (Steinway: 21 notes from E6, forum claim): https://forums.musicplayer.com/topic/83961-how-many-high-notes-are-not-dampered-on-your-piano ; https://markgoodwinpianos.co.uk/yamaha/top-register-no-dampers
- Legs, lyre, pedal rods: https://www.stevespianoservice.com/Online-Piano-Parts-Catalog/grand-piano-legs-and-pedal-lyre.htm ; pedals https://www.howardpianoindustries.com/grand-piano-pedals
- Benches: https://www.maene.be/en_BE/steinway-largo-pianobench ; https://www.1stdibs.com/furniture/seating/benches/steinway-concert-grand-adjustable-piano-bench/id-f_66641

## 15. What I actually ran and what remains uncertain
- **Ran**:
  - Extracted the INRIA report text and figure vectors with PyMuPDF. Parsed 84 per-note rows (C1–B7) and converted the figure's green soundboard outline to metres (axis ticks 201.2–202.7 pt/m).
  - Parsed the dimensions.com B and D SVGs (svgpathtools) and pixel-measured the official Steinway B side drawing (2.8815 px/cm from its 211 cm bar).
  - Sampled photo colours.
  - Generated the B layout and plate with shapely, checking that bridge and hitch points stay inside the rim.
  - Rendered the plan check image (`research/piano_plan_check.png`) and compared it by eye with the D photo and refs 1 and 6.
  - Solved the prop geometry: far-edge height 1.886 vs 1.873 on the drawing.
- **Cross-checks**:
  - The B outline agrees with the real D photo's bentside S-curve to within ~0.05 m in the keyboard frame.
  - The dimensions.com **D** plan is unreliable: its keyboard is drawn 1.36 m wide. I used the INRIA photo for the D.
- **Estimates to revisit if a close-up looks wrong**:
  - Exact Steinway strut topology (struts C–F) and hole count.
  - Capo starting note (53).
  - B bass single/bichord split (8/12, forum).
  - Damper count (67, forum).
  - Black-key dip angle.
  - Music desk size.
  - Lyre and pedal x (dimensions.com shows the lyre centered).
  - Key-stack height: the drawing implies a keybed about 5 mm higher than the key physics allows; I kept the published 0.715 key top.
