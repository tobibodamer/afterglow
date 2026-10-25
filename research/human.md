# Pianist 3-D assets: pipeline, rig contract, licences

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](../docs/README.md).

Scope: the pianist's body, hands, hair, beard and clothes as one rigged GLB for the three.js film. Everything below was
produced and measured with the scripts in `sandbox/human/scripts/` (gitignored sandbox). Numbers come from those runs
unless marked *estimate* or *not tested*. Final proof build: `sandbox/human/out/v11/` (v6-v10 kept for comparison;
v1-v5 come from the interrupted first attempt and are superseded).

## 0. Decisions for the lead (TL;DR)

1. **Pipeline (proven, fully scripted, headless):** Blender 5.2.2 LTS + MPFB 2.0.18 + MakeHuman CC0 assets.
   `scripts/run_all.ps1` runs generate (p1) -> dress + groom (p3) -> seated pose (p2) -> cloth simulation (p4) ->
   export with the seated pose as the bind pose (p5) -> GLB inspection -> rig contract (`rig.json`).
   One run takes 6.2 min on a quiet machine (v10: 369 s, cloth 232 s of it) and 13 min with the CPU saturated by other
   jobs (v11: 786 s, cloth 533 s). Deterministic except the cloth: v10 and v11 GLBs are bit-identical for body, hair,
   beard, cuffs, shoes and eyes (0.000 mm), but the simulated suit differs between two runs with identical inputs
   (mean 10.7 mm, p99 162 mm, max 210 mm) -> **bake the cloth once, review it, and freeze the GLB.**
2. **Skeleton:** the MakeHuman `default` rig, **163 joints, all deforming**, with a full hand per side:
   `wrist -> metacarpal1..4 -> fingerN-1/-2/-3` (N = 2..5: MCP, PIP, DIP) and the thumb
   `wrist -> finger1-1 (CMC) -> finger1-2 (MCP) -> finger1-3 (IP)`. Bone names use `_` (e.g. `finger2-1_R`) because
   three.js GLTFLoader strips dots from node names (`wrist.R` became `wristR` in our first test).
3. **Bind pose = the seated playing pose** (bench 0.47 m, white-key tops 0.715 m). Linear-blend skinning error grows with
   distance from the bind pose; the seated bind keeps the whole performance close to it, and the cloth folds are baked
   into the bind shape.
4. **Hair and beard are procedural** (our own code: clumped helical ribbon strands + dark scalp/beard shells). No CC-BY
   hair is needed. **Suit** = the CC0 MakeHuman `male_elegantsuit01` proxy, recoloured near-black with a procedural
   12 mm pinstripe, sleeves shortened, 4 kissing cuff buttons, cloth-simulated into the seated pose;
   **shirt cuffs** are procedural double-walled tubes that show 12.5 mm below the sleeve; **shoes** = CC0 `shoes04`
   with the white socks recoloured black.
5. **Coordinate-frame bug in DESIGN.md §2 (needs a decision):** the piano/rig frame "x to the right along the keyboard
   (bass -> treble), y up, z away from the player" is **left-handed**. three.js and glTF are right-handed; the glTF spec
   says an asset's front faces +Z with its right side at -X. A pianist sitting at negative z and facing +z therefore has
   the **treble on his left**. The GLB here is authored correctly for a human (faces +Z, right hand at -X, i.e. treble
   at -X). Cheapest fix: put the piano group under `scale.x = -1` (three.js flips face winding for negative-determinant
   world matrices automatically), or generate the piano with x running treble -> bass. Rig-yaw maths stays valid.
6. **Weakest points (honest):** hand surface detail (1.16 texels/mm on the 2048 skin atlas; the macro shots of refs 7,
   8, 12 need about 4-6), the hair look in close views (polygonal curls, some scalp gaps), the thumb (the simple
   proof pose does not reach its key), and the MakeHuman wrist pivot sitting ~2 cm proximal of the visible wrist crease,
   which makes wrist-pivot -> middle fingertip 206 mm against 186 mm in the 190 mm hand of research/performance.md.

## 1. Tools (verified on this machine)

| tool | version | check |
|---|---|---|
| Blender portable | 5.2.2 LTS (hash d13f752e3b9c, 2026-09-15), a portable install outside the repository (`AG_BLENDER` in `tools/pianist/run_all.ps1`) | `blender -b --python-expr` prints the version; cold start 4.7 s |
| MPFB | 2.0.18, build 20261010, extension `bl_ext.user_default.mpfb` (portable/extensions/user_default/mpfb) | `HumanService.deserialize_from_dict` builds the character headless in 4-9 s |
| MakeHuman asset packs | installed in `portable/extensions/.user/user_default/mpfb/data` (zips + pack pages in `sandbox/human/dl/`) | used by name in p1/p3 |
| three.js | r186 (`node_modules/three` 0.186.1), Chrome 155.0.8059.85, ANGLE D3D11, Radeon 780M | `web/run_glbtest.mjs` loads and renders the GLB |
| EEVEE (Blender) | headless GPU render works | 1600x900, 64 TAA samples: 206 s for one frame incl. shader compile (v7); 1280x720, 32 samples: 4 views in 32 s (v10) / 92 s (v11, CPU saturated) |

## 2. Assets and licences

Every third-party file that ends up in the GLB, with the licence as stated **inside the asset file or on its pack page**:

| used for | asset (pack) | author | licence | where it is stated |
|---|---|---|---|---|
| base mesh, targets (phenotype), `default` skeleton + weights, eyes `high-poly`, `eyebrow001`, `eyelashes01` | MakeHuman system assets (`makehuman_system_assets`) | MakeHuman team / Data Collection AB | **CC0 1.0** | MakeHuman `LICENSE.md` §C ("assets ... released under CC0 1.0 Universal"), pack page |
| jacket + trousers + shirt front + tie (`male_elegantsuit01`), its base texture `male_elegantsuit01_diffuse.png` | system assets | Data Collection AB, Joel Palmius, Jonas Hauquier | **CC0** | `.mhclo`/`.mhmat` header: "explicitly released as CC0 in september 2020" |
| shoes (`shoes04`, diffuse + normal) | system assets | same | **CC0** | same header in `shoes04.mhclo/.mhmat` |
| skin (`mindfront_aksel_skin`: diffuse, normal, spec 2048²) | `skins02` | Mindfront | **CC0** | pack page skins02 |
| hand realism targets (`mindfront_hand_fingers_correction`, `mindfront_hand_hypothenar`, `mindfront_hand_thenar_eminence`, `jujube_knobby_knuckles`) | `hands01` | Mindfront, jujube | **CC0** | pack page hands01 |
| hair, beard, scalp/beard shells, shirt cuffs, pinstripe, button layout, all scripts | ours (generated by `p3_dress_groom.py`) | project | project licence | — |

Not used, with reasons:
- `toigo_male_elegant_suit_gray_pinstripe_with_paisley_tie` (and the other toigo recolours in that folder): the pack zip is
  named `_cc0`, but the `.mhmat` header says **"This file is licensed AGPLv3"** (2016 MakeHuman boilerplate). Ambiguous,
  so v8+ builds the pinstripe procedurally on the explicitly-CC0 base texture.
- `hair02` (Elvaerwyn, 21 hairs) and `hair03` (culturalibre, grinsegold, punkduck; incl. `o4saken_curly01`,
  `punkduck_alpha7_curly`, `_curly2`) are **CC-BY**. The pack pages do not give a version; `o4saken_curly01.mhclo`
  says `# author 04saken` / `# license CC BY 4.0`. If any of them is ever used, CREDITS needs e.g.
  "o4saken_curly01 hair by 04saken (uploaded by punkduck), MakeHuman community asset repository, CC BY 4.0,
  https://creativecommons.org/licenses/by/4.0/". The interrupted run's v5 used `o4saken_curly01`; it was long
  (shoulder length, 364,197 vertices, 45 MB GLB) and is dropped.
- MPFB itself is GPL-3.0-or-later (`blender_manifest.toml`); it is a build tool, not shipped. MakeHuman `LICENSE.md` §D:
  exports and "graphical data generated via scripting or plugins" carry no MakeHuman claim.

CREDITS.md lines (suggested):
```
Pianist base body, skeleton, suit, shoes, eyes, eyebrows, eyelashes: MakeHuman / MPFB system assets (Data Collection AB,
  Joel Palmius, Jonas Hauquier), CC0 1.0. http://www.makehumancommunity.org  https://static.makehumancommunity.org/assets/assetpacks.html
Pianist skin texture "Aksel skin": Mindfront, MakeHuman community asset pack skins02, CC0 1.0.
Hand detail targets: Mindfront and jujube, MakeHuman community asset pack hands01, CC0 1.0.
Built with MPFB 2.0.18 (GPL-3.0-or-later, not redistributed) in Blender 5.2.2 (GPL, not redistributed).
Hair, beard, shirt cuffs, pinstripe and all pipeline scripts: this project.
```

## 3. The pipeline (reproducible)

`pwsh -File sandbox/human/scripts/run_all.ps1 -Out <dir>` (each stage is a headless Blender call; log in `<dir>/run_all.log`):

| stage | script | what it does | v10 / v11 time (s) |
|---|---|---|---|
| p1 generate | `p1_build.py` | MPFB `deserialize_from_dict`: male, 35 y (age macro 0.577), weight 0.40, muscle 0.52, height 0.52 -> **stature 1.753 m**; fingers length +0.15 / diameter -0.30; hands01 CC0 targets; rig `default`; skin Aksel; suit + shoes; subdivision level 1 | 8.1 / 32.2 |
| p3 dress + groom | `p3_dress_groom.py` | near-black suit texture with 12 mm pinstripe (1.031 texel/mm on the suit UV -> 12 px period), black socks, tie darkened; sleeves shortened by axial compression to end 10 mm proximal of the wrist pivot; 4 kissing cuff buttons (re-laid from the proxy's own button geometry, step 0.92 diameter); shirt cuffs; hair 3,600 strands x 24 points + beard 5,000 x 5 points + shells; Principled materials | 48.8 / 100.7 |
| p2 pose | `p2_pose.py` | seated pose in the pianist frame (below), keyframes rest (frame 1) -> seated (frame 40) | 29.8 / 44.1 |
| p4 cloth | `p4_cloth.py` | Blender cloth on the suit (7,727 verts at proxy level) through frames 1-90; body (after its helper mask) and bench are colliders; pin group: collar/shoulder yoke/waistband/buttons 1.0, distal 9 cm of the sleeves 1.0, trouser hems 0.6, everything else 0.12 | 231.7 / 532.5 |
| p5 export | `p5_export.py` | posed + simulated cage written as the rest shape, `pose.armature_apply`, bones renamed `.`->`_`, MPFB helper/mask/subdivision bake, weights cleaned and limited to 4 + normalised, limit error measured, glTF export (y-up, skins, no animation) | 46.4 / 71.9 |
| inspect | `inspect_glb.py`, `region_stats.py` | per-mesh counts, weight sums, influence histogram, materials, textures | ~2 s |
| rig contract | `rig_contract.py` | `rig.json`: joints, parents, bind TRS, world positions, lengths, finger/thumb/wrist axes | ~1 s |
| checks | `web/run_glbtest.mjs` (three.js), `r_workbench.py`, `r_look.py` (EEVEE), `t_bend.py`, `t_head.py`, `probe_fingers.py` | renders and measurements below | |

Pianist frame of the GLB (glTF/three.js, metres): **floor (lake bed) y = 0; white-key front plane z = 0, keys toward +z;
keyboard centre (E4|F4) x = 0; the pianist faces +Z and his right hand (treble) is at -X; white-key tops y = 0.715;
bench top y = 0.47.** In the DESIGN rig frame the pianist node goes at (0, -0.04, 0) (the lake bed), after the
handedness fix of §0.5.

Seated pose numbers (p2, v10 = v11): hip joints 0.515 m behind the key front and 0.085 m above the bench; torso lean ~13 deg
(spine) + head bowed ~28 deg (neck01/02 + head), soft 4 deg tilt toward the treble; right ball of foot on the damper pedal
(x = -0.078, 0.205 m under the keys, tread 0.09 m; foot pitched 27.4 deg, heel on the floor), left foot flat 0.135 m to the
bass side; leg IK error 0.0 mm (reach 0.84-0.86 of full leg length). Hands: relaxed piano hand with ABSOLUTE
MCP/PIP/DIP targets 20-22 / 38-42 / 25-28 deg (research/performance.md §3.5); middle-finger pads on G3 (left) and E5 (right),
38 mm behind the white-key front: middle-fingertip IK residual 0.11 mm; wrist pivot 131 mm in front of the key front and
50 mm above the key tops; middle MCP 69 mm above the key tops; elbows 75-78 mm above the key tops and 0.29-0.30 m from
the midline, so the forearm falls ~6 deg toward the wrist (elbow y 0.790-0.793, wrist 0.765); bind finger angles (right
hand) MCP 20-24, PIP 37-42, DIP 25-29 deg. performance.md's 190 mm-hand model puts the wrist 95 mm in front and 37 mm
above and the elbow 16 mm above the keys (forearm rising ~4 deg); ours sits further back and higher because the
MakeHuman wrist pivot is ~2 cm proximal (§5), and the simple arm IK (fixed elbow pole) lifts the elbows. Good enough for
a bind pose; the performance solver sets the real arm. The proof pose does **not** solve the
thumb (tip 55 mm from its key target); that is the performance solver's job.

## 4. The proof GLB (v11)

`sandbox/human/out/v11/pianist_seated.glb`, 33.9 MB (33,860,216 bytes), bind = seated, 163 joints, 12 skinned meshes:

| mesh (node) | GLB vertices | triangles | material | max influences before limit |
|---|---|---|---|---|
| `Pianist_body` (skin, exposed parts) | 32,448 | 61,920 | pianist_skin | 10 |
| `Pianist_male_elegantsuit01` (jacket, trousers, shirt front, tie, buttons) | 31,683 | 60,272 | pianist_suit | 13 |
| `Pianist_shoes04` | 7,008 | 13,280 | pianist_shoes | 11 |
| `Pianist_shirt_cuff_L` / `_R` | 600 each | 1,120 each | pianist_shirt | 2 |
| `Pianist_hair_strands` | 159,908 | 152,708 | pianist_hair | 4 |
| `Pianist_beard_strands` | 46,706 | 36,706 | pianist_beard | 4 |
| `Pianist_scalp_cap` / `Pianist_beard_cap` | 608 / 587 | 368 / 368 | hair / beard | 4 |
| `Pianist_high-poly` (eyes) | 4,187 | 8,160 | MPFB eye | 3 |
| `Pianist_eyebrow001`, `Pianist_eyelashes01` | 124, 250 | 192, 368 | MPFB alpha | 4 |
| **total** | **284,709** | **336,582** | 9 materials, 8 embedded PNG textures (13.6 MB) | |

All weight sums are 1.000 after normalisation (`inspect_glb.py`: min = max = 1.0 on every mesh).

Regions of the body mesh (dominant joint, subdivision 1, `region_stats.py`): **each hand 6,836 vertices / 12,757
triangles** (its five fingers 5,877 / 10,839); head and face 16,746 / 32,728; the remaining ~2,000 GLB vertices are
neck and forearm skin. The skin under the clothes is removed by the clothes' MPFB delete groups (so it cannot poke
through), except the forearm strip under the shirt cuffs, which p3 restores.

Materials (all `MeshPhysicalMaterial`/`MeshStandardMaterial` in three.js, KHR_materials_sheen exported):
skin (Aksel diffuse + normal 2048², roughness 0.48, sheen colour (0.10, 0.075, 0.065)), suit (procedural near-black
pinstripe 2048², roughness 0.82, sheen colour (0.035, 0.035, 0.042)), shoes (diffuse with black socks + normal 1024²,
roughness 0.32), shirt cuffs (flat 0.80 albedo, roughness 0.75, sheen 0.12), hair/beard/shells (vertex colour COLOR_0, dark brown-black linear 0.04-0.07, roughness 0.42-0.50),
eyes/brows/lashes (MPFB textures, alpha BLEND). Textures are embedded PNG; for the final asset convert to KTX2/WebP and
quantise/meshopt-compress geometry (most of the size is the 160k-vertex hair).

Skin weights: up to 10 influences on the body, 13 on the suit, 11 on the shoes before limiting; limited to **4**
(three.js `skinIndex/skinWeight` are vec4; glTF `JOINTS_1` would be ignored). Error of the limit, measured in Blender in
a test pose away from the bind (right arm +15/+12 deg, wrist -15 deg, fingers 2-4 MCP/PIP +20 deg, spine/neck/head
+6/+8/+8 deg): **body mean 0.019 / p99 0.57 / max 2.47 mm; suit mean 0.145 / p99 1.71 / max 4.78 mm**; hair, beard,
shells, cuffs, eyes have <= 4 influences already (0 error), shoes did not move in the test pose. The interrupted run measured the same for the much larger A-pose -> seated move: hands mean
0.01 / p99 0.24 / max 1.43 mm, whole body mean 0.12 / p99 3.1 / max 15.1 mm.

three.js check (`web/run_glbtest.mjs`, r186, headless Chrome 155, ANGLE D3D11 on the 780M): 12 `SkinnedMesh`, one
163-bone skeleton, bone names arrive unchanged (`wrist_R`, `finger2-1_R`); CPU-skinned positions in the bind pose match
the stored positions within **0.0012 mm**; one frame with a 2048² shadow map = 681,912 triangles in 31 draw calls;
`GLTFLoader` parse 0.28-0.55 s on a quiet machine (v7, v10), 12.8 s with the CPU saturated (v11). Lift test in §5.
Renders: `out/v11/three_*.png` (wide 3/4 rear silhouette, profile, hand side views before/after the lift).
Note: three.js r186 logs "PCFSoftShadowMap has been removed. Using PCFShadowMap instead."

## 5. Rig contract for the performance solver

**Source of truth:** `sandbox/human/out/v11/rig.json` (copy to `assets/pianist/rig.json` with the GLB). It is computed
from the GLB itself, so it is exactly what three.js sees after `GLTFLoader`.

- `joints[]`: `name, parent, t (bind local translation), q (bind local quaternion x,y,z,w), world_pos, length`.
  Leaves (finger/toe tips) carry the Blender bone length; **tip = joint + local +Y x length**.
- **Local axes:** every joint's local **+Y points along the bone toward its child** (measured: 0.00 deg deviation for the
  20 finger/thumb joints that have a child; distal joints use the same convention for their tip). Rolls are MakeHuman's
  and are not anatomical: the flexion axes lie in the local XZ plane but deviate
  from local X by 3-8 deg (middle), 2-15 (ring), 23-29 (index), 12-43 (little, worst at the DIP) and 26-41 (thumb).
  **Do not assume local X; use the per-joint vectors.** Example (right hand, v11):
  `finger2-1_R` flex (0.922, 0, -0.388) abd (0.388, 0, 0.922) rest 19.9 deg; `finger3-2_R` flex (0.997, 0, -0.075)
  rest 41.9 deg; `finger5-3_R` flex (0.730, 0, 0.684) rest 25.3 deg; thumb `finger1-1_R` flex (0.897, 0, 0.443)
  abd (0.687, 0, -0.727).
- `hands.{L,R}.fingers.<joint>`: `flex_axis_local` (positive rotation = flexion, curls toward the palm),
  `abd_axis_local` (fingers 2-5: positive = toward the little finger; thumb: palmar abduction out of the palm plane),
  `rest_flex_deg` (anatomical flexion already present in the bind pose), `joint` (CMC/MCP/IP or MCP/PIP/DIP).
  `hands.{L,R}.wrist`: `flex_axis_local` (positive = palmar flexion), `ulnar_dev_axis_local` (positive = ulnar deviation);
  pronation/supination is a rotation of `lowerarm01_*` and the twist bone `lowerarm02_*` about their local +Y
  (share it 0.5/0.5, or 0.33/0.66 as in performance.md §3.4).
- **How to apply an anatomical angle in three.js** (verified in the browser test):
  `bone.quaternion = q_bind * axisAngle(flex_axis_local, theta_flex - rest_flex_deg) * axisAngle(abd_axis_local, theta_abd)`
  (post-multiplication = rotation about an axis expressed in the bone's own bind frame). Test: index MCP -30 deg about
  `flex_axis_local` lifted the index DIP joint 28.3 mm, direction (0.006, 0.954, 0.298) (up and toward the keys),
  moving 1,319 skin vertices by more than 1 mm (max 40.9 mm) (v11; v7 gave 26.8 mm before the pose fixes).
- **Chains the solver drives:** `root` (translation + rotation; the pelvis), `spine05..spine01`, `neck01..03`, `head`,
  `clavicle_*`, `shoulder01_*`, `upperarm01_*` (+ twist `upperarm02_*`), `lowerarm01_*` (+ twist `lowerarm02_*`),
  `wrist_*`, `metacarpal1..4_*` (small CMC cupping for 4-5 only), `fingerN-1..3_*`, thumb `finger1-1..3_*`,
  `pelvis_*`, `upperleg01/02_*`, `lowerleg01/02_*`, `foot_*`, `toe*`. The 59 face/eye/tongue joints stay at bind.
- **Why `default` and not MPFB's `game_engine` rig:** `rig.game_engine.json` has 52 bones with 3 joints per finger and
  thumb (`index_01_r` ...), but no metacarpals and no forearm/upper-arm twist bones; `default` has both (palm cupping for
  fingers 4-5, pronation spread over two forearm bones, which should limit candy-wrapping near the cuff; not compared
  side by side). 163 bones were not a problem in the three.js test (one skeleton, bone matrices in a float texture);
  the 59 face joints can be dropped from the animation tracks.
- **Hierarchy (bind lengths, mm).** `metacarpalK` carries finger K+1:
```
root  (71.8 mm)                      lengths = distance to the first child joint; leaves = Blender bone length
  pelvis_L ... (mirror of the _R leg chain below)
  pelvis_R  (112.4 mm)
    upperleg01_R  (92.1)
      upperleg02_R  (336.2)              thigh (upperleg02 = second thigh segment)
        lowerleg01_R  (219.7)
          lowerleg02_R  (227.9)
            foot_R  (151.2)
              toe1-1_R (28.4) > toe1-2_R (32.6)
              toe2-1_R (22.9) > toe2-2_R (15.2) > toe2-3_R (18.7)      toes 3-5 alike
  spine05  (92.4)
    spine04  (66.5)
      spine03  (62.2)
        spine02  (139.4)
          breast_L, breast_R  (216.1)
          spine01  (154.0)
            clavicle_L ... (mirror of the _R arm chain below)
            clavicle_R  (95.0)
              shoulder01_R  (94.2)
                upperarm01_R  (69.4)
                  upperarm02_R  (182.4)       upper-arm twist
                    lowerarm01_R  (131.2)
                      lowerarm02_R  (129.0)   forearm twist
                        wrist_R  (48.9 to the thumb CMC; 111.5 to the middle MCP)
                          finger1-1_R  (33.6)   thumb metacarpal, pivot = CMC
                            finger1-2_R  (42.1)   thumb proximal phalanx, pivot = MCP
                              finger1-3_R  (32.4)   thumb distal phalanx, pivot = IP
                          metacarpal1_R  (81.2)
                            finger2-1_R (30.5) > finger2-2_R (27.6) > finger2-3_R (30.4)    index MCP > PIP > DIP
                          metacarpal2_R  (76.3)
                            finger3-1_R (38.5) > finger3-2_R (31.7) > finger3-3_R (31.2)    middle
                          metacarpal3_R  (64.3)
                            finger4-1_R (34.7) > finger4-2_R (27.0) > finger4-3_R (30.1)    ring
                          metacarpal4_R  (58.1)
                            finger5-1_R (24.7) > finger5-2_R (18.1) > finger5-3_R (22.6)    little
            neck01  (20.2)
              neck02  (45.2)
                neck03  (35.4)
                  head
                    [59 face/eye/tongue joints: jaw, special01/03/04/05_*/06_*, oris01-07(_*), levator02-06_*,
                     risorius02-03_*, temporalis01-02_*, orbicularis03-04_*, oculi01-02_*, eye_*, tongue00-07(_*)]
```
- **Hand geometry that differs from research/performance.md (the solver must read it from rig.json, not hard-code):**
  wrist pivot -> middle MCP **111.5 mm** (performance model 86 mm); MCP -> fingertip ~101 mm (model 100.3 mm);
  wrist pivot -> middle fingertip 206 mm (model ~186 mm). The MakeHuman `wrist` pivot sits about 2 cm proximal of the
  visible wrist crease (bend test, `out/v6/bend_b_*.png`). MakeHuman's finger bone lengths do not follow X-ray
  proportions (index PP/MP/DP 30.5/27.6/30.4 mm vs 42.6/23.8/23.1), but the joint *positions* along the finger agree
  within ~5 mm, and the bend test shows the mesh creases at the pivots (no broken knuckles at MCP 40 / PIP 75 / DIP 50).
- The MakeHuman A pose already flexes MCP 13-22, PIP 6-12, DIP 1-7 deg (right hand). p2 compensates; `rest_flex_deg`
  in rig.json gives the bind values.

## 6. Hands (the #1 priority)

- Mesh: MakeHuman base hand at subdivision 1, 6,836 vertices / 12,757 triangles per hand (dominant hand joints), smooth topology with
  modelled knuckles (`jujube_knobby_knuckles` 0.6), thenar/hypothenar and finger corrections (Mindfront, CC0). Nails exist
  only in the texture (no nail-plate geometry); creases and fine wrinkles only in the 2048² normal map.
- Texture density: the right hand (palm + fingers, 381 cm²) covers 1.2 % of the 2048² skin atlas = **1.16 texels/mm**
  (`p1_report.json`). Ref 12 framed at 4K puts a 190 mm hand over ~730 px = 3.8 px/mm (1.9 px/mm at 1080p), so the
  hands need **>= 4-6 texels/mm**. The hand UV island's bbox is u 0.361-0.554, v 0.012-0.197 (0.19 x 0.19 of the atlas):
  remapping that bbox to its own 2048² texture through `KHR_texture_transform` (scale ~5.2) gives **~6 texels/mm**
  without touching the UVs. Content to author (none of it exists as CC0 at that resolution): upsampled Aksel albedo +
  procedurally baked dorsal veins, extensor tendons, knuckle wrinkles, nail plates (glossier roughness), fine pores, and
  vellus hair as sheen or a few hundred tiny strand cards on the dorsum. The base Aksel crop already shows knuckle
  wrinkles, nails and faint veins at low resolution (`out/v6/hand_uv_crops.png`).
- Joint placement and deformation: see §5. The 4-influence limit costs the hands almost nothing (§4).
- Alternative hand meshes: the WebXR generic hand models (MIT) were **not downloaded or tested** in this session (the
  `dl/webxr` folder from the first attempt is empty). They are designed for XR hand tracking (25 joints per hand) and are
  low-detail by design; they would also have to be grafted onto the MakeHuman wrist seam. Not recommended over the
  MakeHuman hand plus a hand-dedicated texture set.

## 7. Hair and beard (procedural, ours)

`p3_dress_groom.py`, seed 20261021:
- Scalp mask from the rest mesh (head-dominant vertices above an azimuth-dependent hairline: forehead +72 mm above eye
  level, temples +56-66 mm, sides behind the ear down to -45..-75 mm, nape -85 mm, sideburn strip to -35 mm, ears
  excluded) = 564.9 cm²; beard mask (jaw, cheeks below the cheekbone line, chin, upper lip, under-jaw to the upper
  neck, lips excluded) = 285.1 cm².
- 3,600 roots, area-weighted, in 400 clumps (ringlets). Each clump: a centreline that leaves along the scalp normal and
  relaxes (lambda 2-4.5 cm) into a combing direction (back/up on top, down/out on the sides, down at the back) with
  gravity sag, then a helix (radius 6-10 mm, pitch 18-28 mm) in parallel-transport frames; strands follow their clump
  with 0-3.5 mm spread, frizz and 85-100 % length. Lengths: back 10-13 cm (reaches the collar), sides 6.5-8.5 cm,
  top/front 7-9.5 cm. Measured volume (`probe_hair.py`, distance of every hair vertex from the skin, rest pose):
  median 32 mm, p90 60 mm, p99 79 mm, max 102 mm (top of the head p90 51 mm); lowest hair point 1.459 m in the standing
  rest pose = collar height. That matches the refs' "collar length, 8-10 cm volume" at the outer envelope.
- Collision: every point pushed out of the rest body + suit by 2.5 mm (BVH nearest).
- Geometry: ribbons, 2 vertices per point, width 1.5 -> 0.5 mm, oriented to contain the radial direction from the head
  centre (face-on at the silhouette, which is what backlit shots see). Beard: 5,000 strands x 5 points, 8-16 mm long,
  1.2-2.5 mm curls, 0.7 mm wide. Dark shells 1.2 mm (scalp) and 0.6 mm (beard) off the skin hide skin between strands
  (eroded by one vertex ring so the strands cover the stair-step edge of the face-level mask).
- Skinning: each strand copies its root's skin weights (top 4) -> scalp hair rigid to `head`, nape strands blend `neck*`.
- Counts: hair 159,908 verts / 152,708 tris; beard 46,706 / 36,706; shells 232 / 368 (scalp) and 242 / 368 (beard) in Blender.
- For the renderer: double-sided, `COLOR_0` vertex colour; per research/rendering.md use hashed alpha + accumulation; a
  strand alpha texture along `uv.y` (root->tip) is the next refinement.

## 8. Clothes

- Suit proxy `male_elegantsuit01` (single mesh: jacket, trousers, shirt front and tie). Single-breasted, notch lapels,
  two front buttons (proxy); pocket flaps exist only as texture shading, not as geometry (seen in the texture, not
  verified in close renders); 3 sleeve buttons in the proxy -> re-laid as **4 kissing buttons**
  (left 18.6 mm discs at 17.1 mm steps, right 19.6 mm at 18.0 mm; sizes measured from the proxy's button islands). Fabric albedo ~sRGB 29-33 (linear ~0.013),
  faint 12 mm pinstripe (+35 % on a 1-texel line). Real thickness: the proxy is a single surface; thickness comes from
  the shirt cuffs (double wall 1.6 mm + rolled rim) and, for close-ups, should come from a 2-3 mm solidify on the jacket
  edges (lapels, hems) - not done yet.
- Sleeves shortened so the jacket ends 10 mm proximal of the wrist pivot (proxy: 15.7-18.6 mm distal of it); shirt cuffs
  show **12.5 mm** (refs: 10-15 mm).
- Cloth simulation (p4): 7,727 proxy vertices, frames 1-90 (rest -> seated by frame 40, then settling), quality 6,
  self-collision on, body + bench colliders. Bake 223 s (v10) / 521 s (v11, CPU saturated) = 2.5-5.8 s per frame
  (0.8-3.1 s per frame in v6-v8 with other pin/collider sets). Not fully settled: over the last 10 frames vertices still
  move mean 2.8-3.0 / p99 27-28 / max 68-69 mm. Simulated vs skinning-only: mean 14-19 mm, p90 41-55 mm,
  max 180-252 mm. **Not reproducible run to run** (see §0.1). The simulation adds real folds at the elbows, back, lap
  and knees and drapes the jacket skirt over the bench (`out/v11/wb_*.png` vs the skinned-only `out/v6/wb1_sheet.png`).
  In v8 the simulated sleeve hems crumpled into shards next to the cuffs at the proxy's 1-2 cm resolution; v10+
  therefore pins the distal 9 cm of each sleeve to the skinning (clean sleeve ends in v10/v11).
- Trousers: black from the same texture; slight break comes from the proxy; shoes04 is a black lace-up (derby-like,
  reads as an oxford at film distances).

## 9. Renders and honest assessment

All viewed at full size. Files in `sandbox/human/out/v11/` unless noted (`look_sheet.png`, `three_wb_sheet.png`,
`head_sheet.png` are contact sheets of them):

| file | what | assessment |
|---|---|---|
| `look_ref7_handR.png` (EEVEE, 50 mm, behind-right like ref 7) | sleeve, cuff, both hands on a proxy keyboard | The closest match to a reference: near-black jacket with a faintly visible pinstripe, **4 kissing buttons** (dark on dark, as in ref 7; clearly visible in v10's lighter-sheen render `out/v10/look_ref7_handR.png`), white cuff edge, arched hands, elbow folds, clean lap. v10's run of the same file had crumpled cloth shards at the lap (cloth non-determinism, §8). Keys are a proxy. |
| `look_ref12_macroR.png` (EEVEE, 90 mm f/2.8, ~0.6 m) | right hand macro | Hand shape, arch, curved fingers and pads on the keys are convincing; knuckle wrinkles from the Aksel texture are visible. Weak: dorsum is smooth and featureless (no veins/tendons/hair that refs 7, 8, 12 show), the back of the hand looks long, nails do not read. This is the asset's biggest gap (see §6, §10). |
| `look_ref9_low_rear34.png`, `look_profile_treble.png` (EEVEE) | whole figure, sunset gradient world, sun 1.5 deg up at A = +60 deg | Proportions, posture (lean, bowed head, forearms level, right foot on the pedal) and the curly silhouette read correctly. The look-dev world is far brighter than the film's grade, so these are not silhouettes. |
| `wb_*.png` (workbench clay, 13 views) | geometry only | Sleeve ends clean after pinning (`out/v8/wb_sheet.png` shows the shredded v8 hems); folds at elbows, back, knees; the jacket skirt is partly crumpled where it meets the bench; buttons are 8-sided discs (fine beyond ~0.3 m); workbench's specular makes the wool look like leather (material preview only). |
| `head_rest_*.png` (workbench) | groom at rest, incl. a flat black silhouette | Silhouette reads as dark curly collar-length hair plus a short full beard. Weak: polygonal curl kinks up close, scalp visible between strands above/behind the ears in the clay render, beard sparse on the cheeks. |
| `three_*.png` (three.js r186) | same GLB in the browser | Loads, skins and renders; wide 3/4 rear into the glow is a clean silhouette. In v10 the suit and skin read tan under direct sun because the exporter wrote `sheenColorFactor` (1,1,1) (Blender's Sheen Weight is not exported; `out/v10/three_sheet.png`); v11 encodes the sheen colour in Sheen Tint and the suit reads near-black. A small light patch shows at the right ankle between trouser hem and shoe in the profile (sock recolour or a trouser-hem gap; not investigated). |
| `out/v6/bend_b_*.png` | fingers at MCP 40 / PIP 75 / DIP 50 deg with joint markers | Clean fist: rounded knuckles, creases at the pivots, no broken DIPs; the wrist marker sits ~2 cm proximal of the wrist crease. |
| `refs_vs_ours.png` | refs 7, 12, 9 next to our ref-7, macro and three.js wide renders | Composition, sleeve/cuff/hand relationship and the curly bowed-head silhouette are in family. The refs' hands are more strongly lit at the rim and show veins and tendons; ours are smoother. The world, piano and grade are placeholders here, so no look metric was computed. |

## 10. What to do next (in order)

1. Lead: fix the DESIGN.md frame handedness (§0.5) before the piano and the solver lock in.
2. Hand texture set (§6): hand-only 2048² albedo/normal/roughness via `KHR_texture_transform`, procedural veins,
   tendons, nails; then re-render refs 7/8/12 framings.
3. Wrist pivot: move the `wrist` bone heads ~15-20 mm distal in edit mode (before posing; the weights there need a
   re-check), then re-measure pivot->tip (206 mm now). Only if the hand still reads large next to the refs, apply a small
   MakeHuman hand-scale-decrease target (not tested here).
4. Hair: more points per curl turn (24 -> 36) or tube strands in close-ups; strand alpha texture; check the scalp edge
   behind the ears in profile shots.
5. Cloth: re-simulate at subdivision 1 (estimate 4x the cost) for finer folds; solidify jacket edges; settle 30 more frames.
6. The solver owns the thumb (the proof pose leaves the thumb tip ~55 mm from its target) and every key contact.

## 11. Sources

- MakeHuman licence (assets CC0, output not claimed): https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md (copy in `sandbox/human/dl/mh_LICENSE.md`)
- MakeHuman asset packs: https://static.makehumancommunity.org/assets/assetpacks.html ; pack pages `https://static.makehumancommunity.org/assets/assetpacks/<pack>.html` (hands01, skins02, hair02, hair03, makehuman_system_assets); zips `https://files.makehumancommunity.org/asset_packs/<pack>/<pack>_cc0.zip`
- MPFB: http://static.makehumancommunity.org/mpfb.html , https://github.com/makehumancommunity/mpfb2 (GPL-3.0-or-later)
- CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ ; CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
- glTF 2.0 coordinate system ("+Y up, +Z forward, -X right"): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units
- three.js `PropertyBinding.sanitizeNodeName` (strips `.` and other reserved characters from node names): https://threejs.org/docs/#api/en/animation/PropertyBinding
- KHR_texture_transform: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform/README.md
- Blender cloth settings: https://docs.blender.org/manual/en/latest/physics/cloth/settings/index.html
