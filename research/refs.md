# Reference analysis, look bible, world layout and shot list

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Scope: all 12 images in `refs/` were viewed in full and as zoomed crops. Every number below comes from a script in
`sandbox/refs/` (gitignored), unless it is labelled *visual estimate*.

| Script | What it measures |
|---|---|
| `sample.py` | Grade stats |
| `skygrid.py` | Clear-sky colour, 5 columns × 0.03-height rows |
| `regions.py`, `snow.py`, `clouds.py` | Material colours |
| `rings.py`, `rings2.py` | Ripple periods (FFT) |
| `sunfind.py` | Glow centre |
| `camsolve.py`, `camsweep.py` | Least-squares camera solve against a real concert-grand model |
| `zoomgrid.py`, `probe.py` | Pixel-grid crops and colour probes |

Outputs: `grade.json`, `sky.json`, `regions.json`, `look_swatch.png`, `crops/`.

How the numbers are expressed:
- **Luma (L)** is Rec.709 luma on 8-bit sRGB values (0 to 255).
- **Coordinates** are normalised: (x, y) with (0,0) at the top-left.
- **Camera azimuth α:** 0° = directly behind the pianist looking at the keyboard; +90° = the treble side (the open-lid side); −90° = the bass side (spine).
- **Sun direction in the piano frame (φ):** 0 = the direction the pianist faces; negative = toward his left (bass side).

## 0. TL;DR (decisions to adopt)

1. **The references are AI images.** They are not one physically consistent camera world, and that changes how to use them.
   - **Shared plate.** Refs 3, 9 and 10 use the same sky and mountain plate. The mean abs diff in the sky is 6–9 code values, against 31–66 for the other refs. Ref 2 is a close variant (diff 21). The piano is composited into that plate at different headings, so "rotate the piano rig per shot, keep the world fixed" is exactly how the set was made. Use it as our sun cheat.
   - **Ref 11 is mirror-impossible.** The interior is visible under the lid from the spine side. Shoot its mirror instead: camera behind-right, α ≈ +54°, h ≈ 1.4 m.
   - **The AI piano is squat.** Case width ÷ rim-top height is about 2.2. A real concert grand is about 1.65 (157 cm wide, rim about 0.99 m). Do not distort the model. The low camera heights below hide most of the difference.
2. **Sun.** The sun is behind the subject in every reference. In 9 of the 12, the sun sits about **60° to the pianist's left-front (φ ≈ −60° ± 10°)**: refs 1, 2, 5, 6, 9, 10, 11-mirrored, and 7/8/12 within 20°. The camera's "hero" azimuth is **α ≈ +45° (3/4 rear, treble side)** looking into the glow.
   - Exceptions: ref 3 needs the rig yawed −45°, and ref 4 needs it yawed −135°.
3. **Light state.** The sun is just set: elevation about −1° (−0.5° to −2°), hidden behind a left-hand peak.
   - No direct sun reaches the ground.
   - Cloud undersides are lit salmon. The snow is in shade: lavender-navy, and **darker than the sky behind it**.
   - The whole frame is a backlit silhouette with crushed blacks.
   - Ref 1 is the same scene about 10–20 minutes later (blue hour). Use it as the film's coda so that time visibly moves.
4. **Water depth at the piano: 0.03–0.05 m.** The rim-top ÷ key-height ratio in refs 2, 3, 4 and 9 (1.28–1.42) implies 0–0.06 m. Brass caster cups and shoe welts sit at the waterline, and the shoes look like they rest on a mirror.
5. **Grade target (wide shots).**
   - Black is 0: p1 is 0–1.
   - Highlights roll off to peach **#FEC08A–#FEC493 (L ≈ 205–215)**. 0% of pixels reach L ≥ 250.
   - Median L is 63–75. HSV saturation mean is 0.43–0.49.
   - Hue follows luminance: navy shadows → violet → mauve → coral → peach (table in §3.7).
   - No visible grain (residual 0.24–0.42 code values), no measurable lens vignette, and no halation.

## 1. Caveats on measurement

- **Lens is unknown; azimuth and height are solid.**
  - With 5–7 point correspondences per image, focal length and distance trade off: solve RMS is flat from 24 mm to 135 mm.
  - Camera **azimuth and height are stable to ±3° and ±0.02 m across that sweep**.
  - Lenses below come from secondary cues (ripple-ellipse aspect, bench-versus-legs parallax, background blur, mountain angular size) and are softer: ±1 stop of focal length.
- **Solve residuals** (RMS, px at 1672 wide): ref 10 = 6, ref 2 = 9, ref 5 = 17, ref 3 = 21, ref 4 = 35, ref 9 = 48, ref 11 (mirrored) = 76. The high values in refs 9 and 11 come from AI geometry, mainly over-tall lids.
- **Ref 1 is 540×449** and has a 4-px white border on the top and left, a screenshot artifact. Crop it before any numeric comparison.
- **Ref 12 is 831×474.** All other refs are 1672×941.
- **WebP smoothing.** The `.webp` refs are heavily smoothed, so grain and micro-texture numbers are lower bounds.

## 2. Per-image analysis

Distances are horizontal, from the camera to the piano centre (about 1 m behind the key fronts), as solved with the lens stated. "Glow" is the centroid of the brightest 1% of sky pixels.

### Ref 1: overhead 3/4 rear, blue hour (the odd one)
- **Shot:** high-angle "god's-eye" medium-wide.
- **Camera:**
  - **Position:** α ≈ +40°. We see the pianist's back and the outer face of the bentside; the lid hinge runs along the upper-left spine.
  - **Angle:** depression 55–65° (ripple rings nearly circular, aspect about 0.8–0.9).
  - **Distance and height:** slant distance about 4.5 m, height about 4 m. The keyboard (1.22 m) spans 193 px, so the frame is about 3.4 m wide at the piano.
  - **Lens:** about 50 mm full-frame equivalent.
  - **Roll:** the piano's long axis runs at about 45° toward the upper right.
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano bbox | x 0.29–0.77, y 0.06–0.73 |
  | Keyboard | (0.33, 0.42) bass end → (0.62, 0.67) treble end |
  | Head | (0.42, 0.62) |
  | Bench | x 0.29–0.52, y 0.67–0.92 |
  | Horizon / sun | not in frame |

- **DOF:** everything is in focus. The image is soft overall at low resolution.
- **Lighting:**
  - Very dark overall.
  - Warm light on the interior: the gold plate is #2F1712, with highlights up to #553222.
  - Orange specular glints on the water (#704545–#866775) cluster at the top-left and bottom-left, so the sun is to the left of frame.
  - The lid top shows orange flecks. The hands catch warm light.
- **Water:**
  - It reflects the high sky as deep navy-teal: median #0D1723, core range #08111A–#141B26 (hue 210–217°).
  - 15–25 concentric rings fill the frame, period 16–20 px ≈ **0.10–0.13 m**.
  - Diagonal wind streaks with glints run through the upper left.
- **Piano:**
  - Lid on its stick, top face visible. The prop stick crosses the interior diagonally.
  - Interior visible on the treble side: gold plate with large round/oval cut-outs toward the tail, struts, strings, damper row, red-brown soundboard.
  - Music desk up. Fallboard carries an illegible gold logo.
- **Pianist:** crown of dark curly hair with warm brown highlights (#361B16). LH in the lower-middle register, RH in the upper-middle. Black suit.
- **Grade:** border excluded.
  - L: median 18, p95 41, p99 86. The other refs have medians of 45–75.
  - 61% of pixels fall in L 15–40, average #0F1723.
  - Black is 0.
  - This is a blue-hour grade: use it for the final shot.

### Ref 2: hero wide, low, 3/4 rear treble side
- **Camera:**
  - **Position:** α **+45°**, h **0.50 m**, about 13 m away at 50 mm (22 m at 85 mm), pitch about +1.4°.
  - **Lens:** the plate lens is assumed to be 50 mm (see §4).
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano | x 0.37–0.58, y 0.32 (lid tip) – 0.65 (feet) |
  | Head top | (0.365, 0.393) |
  | Bench | x 0.295–0.36 |
  | **Horizon** | **y 0.561** |
  | Glow | (0.146, 0.36–0.39) |
  | Snowy massif summit | (0.91, 0.31) |

- **DOF** *(visual estimate)*:
  - Subjects sharp: silhouette 10–90% edge is 2–4 px.
  - Mountains slightly soft.
  - Bottom 20% of the water soft (blur about 3–6 px).
- **Light:**
  - The sun is hidden behind the left peak, about 14° left of the frame centre.
  - The case side mirrors the dark mountain silhouettes against the orange sky: base #160E11, peaks #6C2E21.
  - A thin peach line runs along the lid's top edge.
  - The music desk mirrors the gold logo and the hands.
- **Sky (top → horizon):**

  | Side | Top | → | → | → | → | Horizon |
  |---|---|---|---|---|---|---|
  | Sun side (x 0–0.2) | #7F5F93 | #AF7092 | #D78192 | #FDA486 | #FDAD83 | |
  | Centre | #52467B | #654B7F | #7B5183 | #9C5E88 | #BC6C87 | #E87975 |
  | Anti-sun (x 0.8–1) | #2C335F | #383962 | #4B426A | #58446B | | |

- **Clouds:** altocumulus floccus/perlucidus patches in 3 diagonal bands; about 29% of the sky is ≥10 L darker than clear sky.
  - Lit lower edges: #E78282 → #FAA781.
  - Bodies: #64375A (upper sky), #93475F (lower sky).
- **Mountains:** four layers.
  - Near dark headland on the left, ending at x 0.18.
  - Hazy mid ridges #473B5C.
  - Hazed snowy far peaks in the centre.
  - Snowy massif on the right: snow p98 #3E4978, rock #151E3E.
- **Shore:** a rocky boulder spit on the right (x 0.77–1, y 0.55–0.60). Lit faces #333552, shadows #0E1425. A thin mist line sits at the far waterline.
- **Water:**
  - Fine concentric rings centred on the pedal lyre, visible left of the piano at y 0.62–0.70.
  - The sun-side glow path breaks into horizontal streaks: median #D16A56, p90 #FDAB73, peak #FFC486. The anti-sun side is #3B314D.
  - The piano's reflection breaks into horizontal zig-zag slices from about 0.5 m below the legs. Lateral jitter is ±0.3–0.6 of a leg width.
  - Brass ferrules show at the waterline.
- **Piano:** lid fully open toward camera with the prop visible. Music desk up. Pedal lyre with two diagonal brace rods.
- **Pianist:** seen from rear-right in profile. Head bowed about 30°. Curly hair down to the collar, beard. Shoes at the waterline.
- **Grade:** L p1 0.7, p50 71.6, p99 191.5, max 228. Saturation 0.45. Brightest 0.5% averages #FEC486.

### Ref 3: centred from directly behind, low (sun visible in a notch)
- **Camera:**
  - **Position:** α **+2°**, h **0.64 m** (the horizon sits just under the key fronts), about 10 m away at 50 mm, pitch +1.4°.
  - **Lens:** bench-leg versus piano-leg parallax gives about 42 mm at 9.6 m. Use **40–50 mm**.
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano | x 0.362–0.622 (case 435 px wide), y 0.30 (lid tip) – 0.70 |
  | Key fronts | y 0.556 |
  | Head top | (0.49, 0.363) |
  | Horizon | 0.561 |
  | **Sun notch** | **(0.401, 0.419)**: #FDD09A, core #FFF0D6 |
  | Wider glow | x 0.18–0.24 |

  The piano and pianist are bilaterally symmetric about x 0.49.
- **Lid:** it reads as a straight line from the hinge (0.385, 0.491) to the tip (0.597, 0.302), about **27° from horizontal**. The prop runs (0.55, 0.36) → (0.59, 0.49).
- **DOF:** subjects sharp (head-on-sky edge 3–4 px), mountains near-sharp, near water soft.
- **Sky:**
  - Centre, top → ridge: #534B7C → #645180 → #7C5884 → #A5688A → #C97785 → #F38E7D → #FA957B → #F38171 (the band at the ridge).
  - Sun side: #715D8B → #A57392 → #C78594 → #FBA88E → #FDB18D.
  - Anti-sun side: #2E3660 → #3F4069 → #524A71 → #645278.
- **Clouds:** like ref 2, about 27% coverage.
  - Lower lit edges #D78685–#FAA58D.
  - Upper bodies #5D3D5A, lower bodies #8A4F64.
- **Mountains and haze:**
  - Atmosphere near the sun glows warm: mid ridge #473B5C, far peaks #62496C.
  - The right massif stays navy: rock #162244, snow #374373.
- **Water:**
  - Very flat concentric ellipses reach x ≈ 0 at y 0.70. Ring centre is at the lyre and the field radius is about 4 m.
  - Ring period near the piano is about 16 px, which is **about 6–8 cm** at 10 m.
  - The far water just below the horizon is #45354E, with glow streaks from #BE5C5E to #F3856F.
  - Near water: bottom-left (sun side) #6E4E65, bottom-right #332F4B.
- **Pianist:**
  - Seen from behind with shoulders level and relaxed (shoulder width 150 px against a 435 px case).
  - Curly hair with volume of about 8–10 cm, and a faint pinstripe on the jacket back.
  - Both elbows slightly out, hands about 0.35 m apart, near the middle of the keyboard.
- **Grade:** L p1 1.0, p50 75.5, p99 192.2. Saturation 0.43. Brightest 0.5% #FEC493.

### Ref 4: bass-side profile silhouette (needs a 135° sun cheat)
- **Camera:**
  - **Position:** α **−62°** (spine side, slightly in front of the pianist's shoulder line), h **0.49 m**, about 10 m away at 50 mm.
  - **Lens:** 35–50 mm. The tail-leg versus front-leg parallax argues for wide, but the solve RMS is 35 px, so it is unreliable.
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano | lid tail-tip x 0.215 → keyboard 0.556; y 0.234 (lid raised edge) – 0.71 |
  | Head top | (0.604, 0.351); face in profile at x 0.54–0.57 |
  | Bench | x 0.555–0.645 |
  | Horizon | 0.563 |
  | **Glow** | **(0.81–0.84, 0.36–0.37)** on the right |

- **What the lid shows:** we see its top surface. It is dark with a purple sheen and a 1-px peach edge line (+15 L above the sky). A vertical warm streak runs down the curved tail of the rim.
- **Sky:** sun side (right): #764F83 → #865484 → #CB6F86 → #FC9C7D → #FDAF87. Left side: #363C67 → #3D3E69 → #45436C.
- **Clouds:** denser at the top-right, about 33% coverage. Lit edges #D46C77–#FD8C75.
- **Mountains:** left massif snow p98 #353F6D. Left shore is low rounded boulder hills: #0C101B base, faces #161E35, warm tops.
- **Water:** sun side (right) glow #6D3845 → #F9A078. Anti-sun (left) #131C35. Rings around the legs; long horizontal streaks.
- **Pianist:**
  - Left profile. Face dark except a faint sky rim.
  - Head bowed about 35°, torso forward about 15°.
  - Right foot forward at the lyre (sustain); left foot back.
  - Black oxfords at the waterline.
- **Grade:** L p1 0, p50 63.7, p99 190.7. Saturation 0.46. Brightest #FEC38A.

### Ref 5: elevated wide, ring field, lake vista
- **Camera:**
  - **Position:** α **+40°**, h **2.7 m**, pitch about −7.6° at 35 mm.
  - **Lens and distance:** the ring-ellipse aspect (0.22–0.27, so depression 13–16°) combined with the horizon at y 0.27 gives **about 33 mm**, about 11 m away.
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano | x 0.47–0.635, y 0.435–0.70 |
  | Head | (0.478, 0.494) |
  | Bench | x 0.42–0.475 |
  | Horizon | **0.27** |
  | Glow | (0.285, 0.13–0.15), in the far valley |
  | Ring field | x 0.05–0.95, y 0.55–0.95; ring centre ≈ (0.49, 0.69) |

- **Sky:** sun side, top → horizon: #C77792 → #FCB58B → #FDBB8D. Anti-sun: #494880. Clouds are about 50% of the visible band.
- **Water:**
  - Far field is a near-perfect mirror of the clouds; the glow reflection is #E9745E, p90 #FD9F6C.
  - Mid water #915A6C. Near water is dark navy, #1A203A.
  - **12–15 rings, period 16–22 px**, so **about 11–16 cm**. Rings are about 1.3× longer at the outer edge. Field radius is about 2.8 m.
  - Tight micro-rings surround each leg and the bench legs.
- **Piano:**
  - Lid open toward camera; its underside is dark with a violet sheen.
  - Interior soundboard gold, p99 #713C29.
  - Music desk mirrors the orange sky (#DB7461–#ED8976).
  - Keys visible from the treble end.
- **Shore:** left headland of pale grey granite boulders, about 150–300 m away. Lake narrows to a far valley with layered ridges in haze.
- **Grade:** L p50 53.8, p99 189.2. Saturation 0.49. Brightest #FEC08E.

### Ref 6: high 3/4 rear (drone), interior, rings
- **Camera:**
  - **Position:** α **≈ +45°**. The pianist's back faces down-left in frame and the bentside outer face is visible.
  - **Angle:** depression about 40°. Leg-ring ellipse aspect is about 0.65.
  - **Distance and lens:** the keyboard spans 279 px (229 px/m), so the frame is about 7.3 m wide at the piano. That gives **35 mm at about 7 m slant (h ≈ 4.5 m)**, or 50 mm at 10 m.
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano | x 0.44–0.72, y 0.14–0.65 |
  | Head | (0.465, 0.40) |
  | Bench | x 0.39–0.48, y 0.54–0.68 |
  | Ring centre | ≈ (0.52, 0.52) |
  | Reflected glow patches | top-left x 0.15–0.45, y 0–0.15 (sun about 15–20° left of the view) |

- **Water:**
  - Ripple period 15–27 px ≈ **6.5–12 cm**, growing outward. The ring field extends ≥2.5–3.5 m.
  - **Micro-rings at the tail leg and a bench leg:** about 5–8 rings, period about 3–4 cm, radius ≤0.4 m.
  - High-angle water is #1D2037. Reflected cloud patches #B96175 → #FEB97F, chopped into 5–10 cm cells.
  - **Under the piano the reflection is blocked, and dark pebbles on the lake bed show through the clear shallow water.**
- **Piano:**
  - Lid top mirrors the sunset clouds (#60324D, p90 #F07663, p99 #FD9E6B).
  - Interior: gold plate struts, overstrung bass strings, red felt strip, plate holes (#140A0E → #885545). The soundboard near the tail reads as glossy and mirrors the sky; that is an AI artifact.
  - Black-and-white keys are crisp from above.
- **Pianist:** white shirt cuffs show at both wrists. Left hand upper (bass), right hand lower. Black tufted bench.
- **Grade:** L p50 45.0, p99 188.8. Saturation 0.51. Brightest #FECB86.

### Ref 7: close-up, right hand on keys (treble side)
- **Camera:**
  - **Position:** α ≈ +60–75° (behind-right), h ≈ 1.0–1.1 m, about 1.3–1.6 m from the hand.
  - **Lens:** **50 mm**. The horizon is at y 0.315, so pitch is about −4°.
  - **Background blur:** about 5–8 px at 1672, i.e. **0.3–0.5% of frame width**. That corresponds to roughly f/5.6–8 at this distance.
- **Framing:**

  | Element | Position |
  |---|---|
  | Torso | x 0–0.45 |
  | **Hand** | **(0.45–0.58, 0.41–0.52)** |
  | Key fronts | sloping (0.47, 0.52) → (0.65, 0.62); treble end near camera |
  | Cheek block | (0.66–0.72, 0.55–0.65) |
  | Music desk | x 0.57–0.9; mirrors the hands, mountains and sky |
  | Bench knob | (0.08, 0.93) |
  | Glow | (0.40–0.44, 0.13–0.15) |

- **Light:** warm side-light on the back of the hand from the glow: skin median #633234, p90 #823E39, p99 #B25B4A. White key tops reflect the sky (#CB8C86 → #F8CAB8).
- **Wardrobe:** jacket sleeve with **4 kissing cuff buttons**, a flap pocket with welt, one front button at the waist, a faint pinstripe, folds at the elbow. Suit is #020204 (p99 #060508).
- **Hand:**
  - Back of the hand shows veins, tendons and light hair.
  - MCP knuckles arched, fingers curved, fingertips on black and white keys. Thumb tucked under on the far side.

### Ref 8: close-up, hand plus rim mirror
- **Camera:** α ≈ +60–70°, h ≈ 1.0 m, about 1.2 m from the cheek block. **50 mm**. Horizon y ≈ 0.335. Background blur about **0.5–0.9% of width**.
- **Framing:**

  | Element | Position |
  |---|---|
  | Torso | x 0–0.35 |
  | Hand | (0.33–0.42, 0.50–0.58) |
  | Treble cheek | x 0.50–0.62 |
  | Case side mirror | x 0.62–1.0, y 0.27–0.85 |
  | Lid | top-right, with the prop |
  | Glow | (0.30, 0.15–0.17) |

- **Lacquer:**
  - The rim is a near-perfect mirror of the whole vista: sky median #9A404F (p90 #EA6052), water #3E1928, and faint sun rays.
  - Measured reflection is about 25–30% of the direct sky radiance (after inverse sRGB). That matches Fresnel for n ≈ 1.5 at 70–80° grazing (17–39%), so a physically based clearcoat is enough.
- **Hand:** skin #71404A, p90 #A25857. A white shirt cuff shows about 1 cm below the jacket sleeve.

### Ref 9: water-level 3/4 rear, foreground bokeh
- **Camera:**
  - **Position:** α **+51°**, h **0.06–0.22 m**. The horizon (y 0.564) sits only 14 px above the leg bottoms. Lens just above the water, about 8.4 m away at 50 mm.
  - **Lens:** 50 mm, focused on the pianist.
  - **Foreground:** the water at the bottom of frame is about 0.3–0.5 m from the lens and blurred about **20–40 px (1.2–2.4% of width)**. A bokeh ball of the sun reflection sits at (0.245, 0.915), #EC7360 → #FDC592.
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano | x 0.35–0.80, y 0.065 (lid tip) – 0.58 |
  | Head top | (0.33, 0.253) |
  | Bench | x 0.18–0.29 |
  | Glow | (0.15–0.18, 0.37–0.39) |

  The piano is long (concert-grand proportions) and the rim mirrors mountains and the sunset.
- **Sky:** cooler than ref 3, same plate. Centre #554F85 → #B97794. Sun side → #FCB697. Anti-sun #2F3967.
- **Pianist:** the clearest profile in the set. Beard, curls, head bowed about 35°, and a faint pink sky-rim on the face (no frontal light).
- **Grade:** L p50 67.4, p99 195.6. Saturation 0.44. Brightest #FEC598, slightly less orange.

### Ref 10: extreme wide establishing
- **Camera:** α **+47°**, h **1.18 m** (the horizon at y 0.561 sits above the rim), **about 29 m at 50 mm / 49 m at 85 mm**. Solve RMS 6 px.
- **Framing:**

  | Element | Position |
  |---|---|
  | Piano | x 0.47–0.565, y 0.513–0.667 (about 9.5% of frame width) |
  | Head | (0.47, 0.547) |
  | Glow | (0.14–0.18, 0.37–0.39) |
  | **Mist band** | **y 0.52–0.56**, #363457, low over the far water |

- **Sky (row medians, top → ridge):** #48467D → #4D497F → #554C7E → #695381 → #78567D → #B26D84 → #F38B76.
- **Mountains:** five layers with strong aerial perspective. Central far snowy peaks (#554874) and the right massif. The near headlands are almost black.
- **Grade:** blacks are lifted most here: p1 4.4, p5 18.5. Median 74.3. Brightest #FEB57F.

### Ref 11: 3/4 rear at standing height, interior lit (MIRRORED)
- **The problem:** as drawn, the camera is behind-left yet sees the gold interior and the lid underside. That is impossible with a real lid hinged on the spine.
- **Mirrored solve:** α **+54°**, h **1.40 m** (horizon y 0.405, above the rim), about 10 m at 50 mm, pitch −2°.
- **Framing (as drawn):**

  | Element | Position |
  |---|---|
  | Piano | x 0.178–0.52, y 0.305 (lid tip at x 0.44) – 0.81 |
  | Head top | (0.47, 0.41) |
  | Bench | x 0.50–0.59, y 0.68–0.82 |
  | Glow | (0.58–0.64, 0.26–0.28); mirrored → x 0.36–0.42 |
  | Right rocky shore | x 0.9–1.0, y 0.42–0.46 |

- **Interior lit warm:** wood rim inside #350B06 → #813E26 → #C37B5D, brass lid hinges, golden spruce/plate.
- **Lid underside:** #1B1A2C, p99 #EC9179.
- **Water:** glow path on the right #D46D63 → #FEB474. Near-left water #2C2F4A. Concentric rings around legs, bench and shoes. Brass caster cups visible at the waterline.
- **Grade:** L p50 62.7, p99 179.0 (the lowest highlight ceiling). Saturation 0.45. Brightest #FEB375.

### Ref 12: macro close-up of the hand (831×474)
- **Camera:**
  - **Position:** α ≈ +80–95°, h ≈ 0.85–0.9 m (15–20 cm above the key tops), 0.5–0.7 m from the hand.
  - **Lens:** **85–100 mm macro around f/2.8**.
  - **Blur:** foreground keys about 1.5–2% of width; background about 2% or more.
- **Framing:**

  | Element | Position |
  |---|---|
  | Hand | (0.36–0.55, 0.47–0.63) |
  | Hand's reflection in the music desk | (0.70–0.90, 0.50–0.65) |
  | Foreground keys | x 0.40–0.75, y 0.62–1.0 |
  | Glow | (0.45, 0.075) |

- **Sky:** almost pure glow, #F08A82 → #FA9181 → #FCB588 → #FDC18D.
- **Hand:** rim highlights #96463E → #EE7D61. Shadows drop to black.
- **Grade:** p25 1.1, median 9.8. Very dark, low-key.

## 3. LOOK BIBLE

### 3.1 Invariants (true in all wide refs)
- **Backlit by an after-sunset glow,** with no direct sun on any surface. A solar disc appears only as a glow in a ridge notch (ref 3).
- **Silhouettes crush to true black** (p1 ≈ 0).
- **Strong lateral sky gradient across the frame.**
  - Sun-side corners are 1.1–1.36× the luminance of the row centre; anti-sun corners are 0.47–0.65×.
  - This lateral gradient acts as the "vignette". **No optical vignette is measurable,** so keep any added vignette ≤10%.
- **Highlights are peach, never white.** The brightest 0.5% averages #FEB375–#FECB86. L 99.9th percentile is 194–217, and no frame has pixels at L ≥ 250.
- **No bloom or halation:**
  - Silhouette edges against bright sky go from 10% to 90% within 2–5 px at 1672 px.
  - A 1-px brighter lacquer edge line is the only "glow".
  - Brightness around the horizon is atmospheric, not lens-borne.
- **Water is a dark mirror.**
  - The reflection is darker and more saturated than the sky: the coral glow becomes #D16A56 in the water.
  - Concentric rings around the piano; horizontal swell slices in low shots; micro-rings at the legs.
- **The piano is a black mirror.** The lid edge carries a thin warm line, and the case sides mirror sky and mountains.
- **The pianist's face is never lit:** back, profile or top view only.

### 3.2 Palette (hex; sampled medians and percentiles)

| Element | Hex | Note |
|---|---|---|
| Sky top, anti-sun side (~15° elevation) | **#2E3660** | ref 3 x 0.8–1 |
| Sky top, centre (~15°) | **#534B7C** | |
| Sky top, sun side (~15°) | **#715D8B** | |
| Zenith | **#1A2040** | *Inferred* from water reflections of the high sky in refs 1 and 6 (#0D1723 / #1D2037) |
| Sky mid (~10°): anti / centre / sun | **#645278 / #A5688A / #C08193** | |
| Sky low (~6–8°), centre | **#C97785 → #F38E7D → #FA957B** | |
| Coral band right above the ridges | **#F38171** | |
| Horizon glow (sun azimuth) | **#FDB18D**, core **#FEC391** | Brightest 0.5% is #FEC493 |
| Sun notch / disc (optional) | **#FDD09A**, core **#FFF0D6** | ref 3 only |
| Cloud lit undersides, lower sky | **#D78685 → #FAA58D** | p50 → p90 |
| Cloud lit edges, upper sky | **#8E678B → #BD8097** | |
| Cloud shadowed bodies, upper | **#493452 – #5D3D5A** | Darkest #303154 |
| Cloud shadowed bodies, near horizon | **#664462 – #8A4F64** | |
| Mountains far, hazed (sun side) | **#62496C**; far snowy peaks **#554874** | |
| Mountains mid ridge | **#473B5C** | |
| Mountains near (headlands, hills) | **#0F1220 / #0E1528** | |
| Rock lit faces / shadows | **#333457 – #55476B / #0C101B** | |
| Snow lit (in shade, twilight) | **#3E4978 / #374373**; mid **#2C3A69** | L 65–75, i.e. **0.6–0.75× the sky behind it** |
| Massif rock between snow | **#162244** | |
| Water far (just below horizon) | **#45354E** | |
| Water near: anti-sun / sun side / high angle | **#332F4B / #6E4E65 / #1D2037** | |
| Water reflection highlights | **#D16A56 → #FDAB73 → #FFC486** | median → p90 → peak |
| Lacquer body | **#0D0709** | |
| Lacquer mirror of the sky / of the water | **#9A404F** (p90 #EA6052) / **#3E1928** | |
| Lid edge line | **#FB8F6C → #FEDCAB** | |
| Skin: shadow / mid / rim / peak | **#3D1D20 / #6A3A3D / #B25B4A / #EE7D61** | |
| Suit | **#020204 – #060508** | p99 #09080C |
| Hair | **#030203**; overhead warm highlight **#361B16** | |
| Piano interior: shade / lit gold | **#2F1712 / #813E26 → #C37B5D** | |

### 3.3 Sky versus elevation and azimuth (canonical plate, ref 3, horizon at 528 px, f ≈ 1965–2322 px)

| Elevation | Sun azimuth −15…−25° | +5…+10° | +20…+30° (anti side) |
|---|---|---|---|
| 15° | #715D8B | #534B7C | #2E3660 |
| 13.5° | #8A668D | #645180 | #353A62 |
| 12° | #A57392 | #7C5884 | #49466F |
| 10.5° | #C78594 | #A5688A | #5C4E74 |
| 9° | (clouds) | #C97785 | #645278 |
| 7° | #FBA88E | #F38E7D | #534168 |
| 6° | #FDB18D | #FA957B | #67496F |
| 0–3° | #FEC391 (glow core) | #F38171 | ridge |

### 3.4 Clouds
- **Type:** altocumulus floccus/perlucidus. Small tufts in loose bands that slope gently, with denser rows toward the horizon.
  - The WMO middle level is 2–7 km. Floccus bases run from about 2 km to 6 km.
- **Coverage of the visible sky band:** 26–33% of pixels are ≥10 L darker than local clear sky (refs 2, 3, 4, 9, 10, 11). Ref 5 is 50%.
- **Lighting:** undersides and sun-facing edges are lit salmon-peach (sun about 1–3° below the horizon still lights them from below). Bodies are dark plum.
- **Azimuth:** clouds are warmest within ±30° of the sun and turn violet-grey on the anti-sun side.

### 3.5 Mountains and atmosphere
- **Layers:** 4–5 ridge layers. Near headlands (dark, about 1–2 km), mid ridges (5–10 km, hazy violet), far snowy range (30–40 km, heavily hazed), and a big snowy massif to the side (about 20 km).
- **Haze in-scatter depends on azimuth:**
  - Sun side: warm mauve, #473B5C → #62496C.
  - Anti-sun side: navy, rock #162244.
- **Snow is never lit pink.** There is no alpenglow; the snow sits in sky-shade.
- **Low mist band** over the far water (ref 10, #363457, about 50–150 m thick) and a thin mist line at far shorelines.
- **Shores:** rounded granite boulders 0.5–3 m across, at the waterline of the near headlands. Lit faces are cool lavender-grey; some warm heather on the slopes in ref 4.

### 3.6 Water
- **Three layers:**
  1. **Mirror base,** perfectly flat far away (ref 5 mirrors the clouds legibly).
  2. **Long gentle swell,** crest lines parallel to the image horizontal in low shots.
     - Wavelength about 0.5–2 m in the mid-field. Ref 2 bands are about 12 px apart at 13 m distance and h 0.5, so about 1.7 m.
     - Amplitude a few mm.
     - It breaks reflections into horizontal slices with lateral jitter ±0.3–0.6 of a leg width (slopes about 0.02–0.05).
  3. **Concentric ring system centred at the lyre/pedals:**
     - **Wavelength 6–15 cm,** growing outward by 1.3–2× (the gravity regime; the gravity–capillary minimum is at about 1.7 cm).
     - 12–30 visible rings, field radius 3–5 m.
     - Slope ≤0.1, so amplitude about 0.5–2 mm.
     - **Plus micro-rings at each piano leg, bench leg and shoe:** λ about 3–4 cm, 5–10 rings, radius ≤0.4 m.
- **Transparency:** where the reflection is dark (under the piano), clear shallow water shows dark rounded pebbles (ref 6).
- **Near versus far colour:** see §3.2. On the sun side the near water is mauve-coral, on the anti-sun side indigo; from high angles it is dark navy.

### 3.7 Grade targets (use as automated look-checks on rendered frames)

**Luminance percentiles, wide shots (refs 2, 3, 4, 9, 10, 11):**

| p1 | p5 | p10 | p25 | p50 | p75 | p90 | p95 | p99 | p99.9 |
|---|---|---|---|---|---|---|---|---|---|
| 0–1 (ref 10: 4) | 2–18 | 7–27 | 29–49 | **63–75** | 97–110 | 130–152 | 153–175 | **179–196** | **194–208** |

**Hue follows luminance (mean colour per L band, nearly identical across wides):**

| L band | Colour | Hue |
|---|---|---|
| 2–15 | #08070C | 236–290° (neutral-violet black) |
| 15–40 | #191B31 | ~233° |
| 40–70 | #3C3353 | ~258° |
| 70–110 | #764D6B | ~315° |
| 110–150 | #C46D76 | ~353° |
| 150–190 | #F59678 | ~13° |
| 190+ | #FEBC86 | ~26° |

Suggested tolerance: ±8° of hue per band and ±5 L per percentile.

**Other targets:**
- **Saturation (HSV S):** mean 0.43–0.49, p90 0.59–0.67 (wides). Close-ups 0.39–0.47.
- **Grain:** high-pass residual in flat sky is 0.24–0.42 code values, so it is not visible. Add only anti-banding dither (≤1 code value).
- **Vignette:** none measurable beyond the sky's lateral gradient; ≤10% if any. **Halation/bloom:** none (§3.1).

### 3.8 Piano (from refs)
- **Model:** concert grand, about 2.7 m long, with gloss-black polyester-style lacquer. Steinway D is 274 × 156–157 cm.
- **Lid:** on its stick at about **27–30° from horizontal** (measured in ref 3; refs 2, 5 and 9 read steeper, but the AI lids are over-tall).
- **Music desk:** up and empty, with no sheet music.
- **Fallboard:** carries a gold logo. **Use a fictional brand.**
- **Pedal lyre:** two diagonal brace rods.
- **Legs:** turned and tapered, with brass caster cups/ferrules at the waterline.
- **Interior:** gold plate with round/oval tail cut-outs and struts; copper-wound overstrung bass; red felt; damper row; red-brown spruce soundboard with ribs; brass lid hinges on the spine; mahogany-brown inner rim.
- **Bench:** black adjustable artist bench with button-tufted leather top, side adjustment knobs with a metal ring, and turned legs. Reads about 0.6–0.7 m wide.

### 3.9 Pianist (from refs)
- **Build and hair:** slim male, about 30–40.
  - Dark brown-black **curly hair,** collar length, about 8–10 cm volume.
  - Short full beard.
- **Suit:** near-black wool with a faint pinstripe, single-breasted, one button fastened, notch lapels, flap pockets, 4 kissing cuff buttons, visible elbow folds.
- **Shirt and shoes:** white shirt cuffs show 1–1.5 cm below the sleeve. Black trousers with a slight break; black oxfords.
- **Pose:**
  - Torso forward 10–20°, head bowed 30–40° toward the hands, shoulders relaxed and slightly rounded.
  - Elbows slightly forward and out (about 10–15 cm from the torso), forearms near-horizontal, wrists level with the back of the hand.
  - Right foot forward on the sustain pedal, left foot flat and slightly back.
- **Hands (refs 7, 8, 12):**
  - Arched MCP knuckles, curved fingers, fingertips on the keys, thumb on its side edge.
  - Veins, tendons and light hair visible.
  - Warm rim from the glow side only.

### 3.10 What differs across the set
- **Ref 1 is a blue-hour grade.**
  - Median L 18 (wides: 45–75).
  - Shadows are teal-navy (hue 210–217°, against about 233–258° elsewhere).
  - Only orange glints and the warm interior remain.
  - It reads about 10–20 minutes later. Use it as the coda.
- **Refs 7, 8 and 12 are low-key close-ups** (median L 4.5–9.8) with a hotter, pinker sky behind (#F08A82–#FDC18D), because only the near-horizon glow is in frame.
- **Ref 10 has the most lifted blacks** (p5 18.5) because of distance haze.
- **Ref 11 has the lowest highlight ceiling** (p99 179) and is the warmest; it is the mirrored image.
- **Ref 9 is a touch cooler.**

## 4. One consistent world layout

**Frame conventions.**
- World +Z is up.
- **World azimuth A, in degrees clockwise seen from above, measured from the sun (A = 0).** In three.js, a horizontal direction is (x, z) = (sin A, −cos A).
- The origin is at the water surface below the key-front centre.

**Sun.**
- A = 0, **elevation −1.0°** for the core look. It sets behind the left dark peak (A ≈ −4°, ridge at 4.4°).
- It is never a visible disc, except an optional +0.3° glint through a ridge notch for the ref 3 shot.
- **Time arc:** start the film at about +1° (warmer, ref 3 notch) and end at about −5° (ref 1 blue hour).

**Sky.**
- Circumsolar glow centred at A = 0:
  - Horizon core #FEC391 within ±8°.
  - Coral to ±20°.
  - Rose/violet to ±35°.
- The anti-sun hemisphere is cool (#2E3660 at 15°).
- Altocumulus layer at about 4–5 km, about 30% coverage, in bands along A ≈ +20°.

**Lake.**
- Long axis along **A ≈ +15°** toward a far valley; far end 12–15 km away.
- About 2–3 km wide at the piano, narrowing.
- Water depth **0.04 m at the piano.** The bed is dark pebbles and slopes to about 0.3 m at 20 m (deep water is not visible).

**Terrain**, derived from the shared plate (view A ≈ +13°, 50 mm, f = 2322 px at 1672 px):

| Feature | Azimuth A | Elevation | Distance | Height above lake |
|---|---|---|---|---|
| Left near headland (rocky, boulders) | −30° … 0° | ≤2.1° | ~1.5 km | ~55 m |
| Left dark peak (sun sets behind it) | −4° | 4.4° | ~12 km | ~930 m |
| Far valley / water horizon | 0° … +22° | 0 | lake to 12 km | — |
| Central far snowy range (hazed) | +2° … +20° | 3.0–3.7° | 30–40 km | 1.6–2.6 km |
| Right near hills and boulder shore | +20° … +45° | 1.5–2.3° | 0.4–0.6 km (shore), ~2 km (hills) | 50–80 m |
| Right snowy massif (summit) | +30° (range +22 … +45) | 5.9° | ~20 km | ~2.1 km |
| Ring elsewhere (A 45° … 315°) | — | — | 6–15 km | 0.8–2 km, partial snow; shores 0.3–1 km |

**Piano.**
- **The pianist faces A = +60°,** so the sun is at his left-front, φ = −60°.
- The treble side (+X) faces A = +150°. The hero camera stands at A ≈ +195°, i.e. α = +45°.
- **Ring source:** at the lyre, piano frame (0, +0.35). Micro-sources at every leg, bench leg and shoe.

**Per-shot rig yaw** (rotate piano + pianist + ripple emitters about the vertical axis; never the world):

| Shot | Change to the base heading |
|---|---|
| Refs 1, 2, 5, 6, 9, 10, 11 (mirrored) | 0 to ±5° |
| Refs 7, 8, 12 | 0 to +20°, or use α ≈ 55–60° and no cheat |
| Ref 3 | Pianist faces A = +15° (**−45°**) |
| Ref 4 | Pianist faces A = −75° (**−135°**) |

Because the mountains ring the whole lake and the water is featureless, these cheats are invisible across cuts. They are also exactly how the shared AI plate (refs 3, 9, 10) was built.

## 5. Shot list proposal

About 3:30. Lenses are full-frame equivalent. "f/" refers to the blur targets above. Durations are approximate. The music cues are generic (intro, A, A′, B, build, climax, coda) for the composer to remap.

### 5.1 The 12 references as shots

| # | Ref | Shot | Camera, lens | Move | Duration, music |
|---|---|---|---|---|---|
| 1 | 10 | Extreme wide establishing; mist band | α +47°, h 1.2 m, 29 m, 50 mm (or 85 mm at 49 m), f/5.6 | Slow push-in, 3–4% scale over the shot; or still with drifting clouds | 10–12 s, intro |
| 2 | 5 | Elevated vista, ring field | α +40°, h 3.5 → 2.7 m, ~11 m, 32–35 mm, f/5.6 | Crane down + 8° orbit to the right | 8–10 s, theme statement A |
| 3 | 2 | Hero 3/4 rear wide | α +45°, h 0.5 m, 13 m, 50 mm, f/4 | Lateral truck of 1–1.5 m | 7–8 s, A |
| 4 | 9 | Water-level glide | α +51°, h 0.12 m, 8.4 → 6 m, 50 mm, f/2.8, focus on the pianist | Dolly in over the water | 7–9 s, A′ start |
| 5 | 7 | Right-hand CU, music-desk mirror | α +65°, h 1.05 m, 1.4 m, 50 mm, f/5.6 | Slow slide parallel to the keyboard (≤20 cm) | 5–6 s, melody close |
| 6 | 12 | Macro, hand on keys | α +85°, h 0.88 m, 0.6 m, 100 mm macro, f/2.8 | Track with the hand across registers | 4–5 s |
| 7 | 8 | Hand + rim mirror of the vista | α +65°, h 1.0 m, 1.2 m, 50 mm, f/4 | Push 10% / rack focus from the mirror to the hand | 5–6 s, B (contrast) entry |
| 8 | 11m | 3/4 rear at standing height, warm interior | α +54°, h 1.4 m, 10 m, 50 mm, f/4 | 10° arc | 7–8 s, B |
| 9 | 4 | Bass-side profile silhouette | α −62°, h 0.5 m, 10 m, 50 mm, f/4, **rig −135°** | Static; breathing and phrase-lean read | 6–8 s, B / build |
| 10 | 3 | Centred from behind, sun notch | α +2°, h 0.64 m, 9.5 → 7 m, 42–50 mm, f/4, **rig −45°** | Slow dolly in | 8–10 s, build to climax |
| 11 | 6 | Drone 3/4 overhead, interior + rings | α +45°, depression 40°, h 4.5 → 3.5 m, ~7 m, 35 mm, f/5.6 | Descend + 15° orbit | 8–10 s, climax |
| 12 | 1 | Top-down, blue hour | α +40°, depression 60°, h 4 → 9 m, 50 mm | Slow rise / pull-up while the grade cools | 12–15 s, coda / final chord |

### 5.2 Additional shots in the same language

| # | Shot | Camera, lens | Content | Duration, cue |
|---|---|---|---|---|
| A | **Pedal-foot macro** | h 0.15 m, from the treble-front side, 85 mm, f/2.8 | Black oxford on the brass sustain pedal at the waterline; the pedal goes down in sync; micro-rings leave the shoe and lyre | 4–6 s; cut on pedal changes |
| B | **Hammers and dampers** | Inside the case above the strings at the damper line, looking toward the keyboard; 35 mm, f/4 | Dampers lift with the pedal; hammers strike; warm gold plate; lid underside mirrors violet sky | 5–7 s, build |
| C | **Strings and plate dolly to the tail** | 50 mm | Slow dolly along the strings; rack focus from felt/hammers to the plate's oval holes; cloud reflections slide over the lid underside | 6–8 s, B |
| D | **Leg-ripple macro** | h 0.08 m, 100 mm macro | Brass caster cup; a ring train launched on each bass downbeat; the leg reflection breaks into slices | 4–5 s, transitions |
| E | **Lid reflection insert (ref 6 look)** | Grazing 15° to the lid top, 50 mm | Clouds drift in the lacquer; tilt up reveals the pianist from behind | 5–6 s |
| F | **Head-and-shoulders profile silhouette** | 135 mm at 5–6 m, h 1.2 m, the glow directly behind the head (cheat the rig) | Face pure black with a rim on the curls; breathing and a soft head tilt on phrase ends | 5–8 s, B lyrical line |
| G | **Left-hand bass CU** | Bass side α −75°, 85 mm, h 1.0 m (rig cheat so the glow stays behind) | LH in the low register; wrist and arm travel | 4–6 s, build |
| H | **Over-the-shoulder** | Behind-right shoulder, 35 mm, 1.1 m, h 1.4 m, f/4 | Both hands + the whole keyboard + the lake beyond; shows register jumps clearly | 6–10 s, climax |
| I | **Reflection-only** | Camera pointed at the near water | Inverted pianist and piano in the water; ring trains roll through and distort them; usable as a scene transition | 4–6 s, between A′ and B |
| J | **Keyboard-level tracker** | 5 cm above the key tops at the treble end, looking along the keys, 85 mm, f/2.8 | Keys depress exactly under the fingers; hands enter and leave frame across registers | 5–6 s |

**Coverage rule.** At least one hands-legible shot (5–7, A, H, J) in every 15–20 s of music, so keys, pedal and audio sync stays visible throughout. Time-of-day keeps progressing monotonically across the cut order. The face rule holds in every shot: no camera ever sits in front of the pianist (|α| < 100° for all shots).

## 6. Risks and open points
- **Lens choice for the shared plate.** It is not determinable from the refs; 50 mm is a decision, not a measurement. If the lead prefers longer lenses (85 mm), scale every distance in the tables by 1.7. The world angles stay the same.
- **Real versus AI proportions.** A real 274 cm grand will look taller than the squat AI pianos. Keep cameras at the measured heights (0.1–0.65 m for low wides) so the case sits against or just above the horizon, as it does in the refs.
- **Ref 11 cannot be matched one-to-one.** Use the mirrored version.
- **Dark snow.** Snow that is too bright (white) is the most likely look error. It must stay about 0.6–0.75× the sky luminance behind it, and cool in hue.
- **Highlight ceiling.** Highlights must roll off to peach at about L 205–215. A filmic curve that lets sun-glow pixels reach white will break the match.

## Sources
- Steinway Model D dimensions (274 cm long, 156–157 cm wide):
  - https://www.steinway-gallery.com.sg/shop/steinway-grand-d-274
  - https://www.dimensions.com/element/steinway-grand-piano-model-d
- Fresnel reflectance (4% at normal incidence for n ≈ 1.5; the angular values above were computed from the same equations):
  - https://en.wikipedia.org/wiki/Fresnel_equations
  - https://www.graphics.cornell.edu/~westin/misc/fresnel.html
- Gravity–capillary crossover (about 1.7 cm, minimum phase speed about 0.23 m/s):
  - https://arxiv.org/pdf/cond-mat/9909148
  - https://farside.ph.utexas.edu/teaching/315/Waveshtml/node87.html
- Altocumulus floccus and middle-level cloud altitudes:
  - https://cloudatlas.wmo.int/en/altocumulus-floccus.html
  - https://en.wikipedia.org/wiki/Altocumulus_floccus
- Lid stick angles: no published standard was found (https://forum.modartt.com/viewtopic.php?id=5983). The 27–30° figure above is measured from ref 3.
