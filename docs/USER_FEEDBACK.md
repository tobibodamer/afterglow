# User feedback (TOP PRIORITY: builders and fixers must address it, critics must check it explicitly)

> Repository note: `build/` holds generated outputs (re-created by the build commands) and `sandbox/` was the project's local working area (check scripts, logs, review renders, critic reports). Neither is in the public repository; paths into them record where a result came from. See [docs/README.md](README.md).

## 2026-10-21, after seeing the first test stills (piano sheet, drone/ripple grid, pianist vs refs, sleeve/hand test)

Verdict: "looks good so far", but:

1. **Piano is far too dark; from far away you can't really see it.** In the wides (refs 2, 4, 9, 10, 11 framings) the piano must read as a glossy black lacquered instrument, not a black cut-out. In the refs the lacquer carries the sky:
   - sky-coloured sheen across the lid top and the case side;
   - bright thin highlights along the lid edge, the rim cap and the music-desk edge;
   - warm horizon light on the legs and the lyre;
   - visible structure (lid prop, desk, keyboard line) even at small size.

   Measure the piano's own pixels (mask) in refs vs our renders, e.g. median, p75 and p95 luminance and how many highlight pixels, and close the gap (target within about 15 %). Allowed: art-directed lacquer (clear-coat env intensity and F0 per shot class), a soft kicker/rim light from the sun side, exposure/grade, larger sky reflection on the lid. Not allowed: flattening the black into grey or losing the deep blacks.
2. **Clothing not good enough, especially the sleeve end, which lacks detail.**
   - Jacket sleeve hem: real thickness (turned hem visible), 4 kissing buttons with thread and button-hole stitching, top-stitching, a hint of lining.
   - Shirt cuff: real thickness, seam, button or cufflink, crisp white with soft shading, visible 1-1.5 cm.
   - Wool fabric: visible twill weave in close-ups (normal plus sheen), slight fibre fuzz on silhouette edges, real folds and creases at the elbow and the inside of the arm.
3. **Skin texture not good.** It must not look smooth and plasticky:
   - pores and fine lines;
   - knuckle wrinkles at MCP/PIP/DIP;
   - tone variation (redder knuckles and fingertips, bluish veins, lighter palm);
   - dorsal veins and tendons that read in backlight;
   - nails with lunula, cuticle and free edge, and a subsurface look.

   Use high-resolution hand maps (aim for 8 texels/mm or more on the hands) and roughness that varies across the skin.
4. **Overall: at least 2x more detail everywhere** (geometry, textures, micro-detail), judged on 1080p frames and 4K crops of the close-ups.
## 2026-10-21 evening: song approved

The user listened to build/audio/afterglow.mp3 (3:41) and approved it: "Der Song passt so, weitermachen." **The music is FROZEN.** Do not change music/final/score.json, the score code or the final mix preset. Everything (performance, camera, film audio) is built against this score (sha1 7CB6BB6C...).

## Standing rules

5. **Process:** before any full-length render, send the user stills (every ref framing at final quality, plus hand close-ups) and the finished song, then wait for approval. Never start the full film render without it.
