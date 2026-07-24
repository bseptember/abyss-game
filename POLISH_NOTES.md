# ABYSS — Polish Notes

Running log of premium-feel polish passes. North star: *would a stranger feel this is a paid game after 30 seconds?*

---

## Pass 1 — Feel, juice, drama, curve (current)

Shipped, ranked by impact against the premium bar:

1. **Camera weight / banking** *(Feel #1)*
   - Camera now banks into steering and drifts slightly toward the ship (`camLeanX/Y`, `camRoll`), with parallax via `lookAt` at the tunnel axis and roll via a tilted `up` vector.
   - Purely cosmetic — collision is still angle-vs-gap on player position, so fairness is unchanged.
   - Disabled under `REDUCE_MOTION`.

2. **Death "shatter" sequence** *(Feel #1)*
   - **Fixed a jarring cut:** death used to hard-cut instantly to the calm ambient orbit (reset to `z≈0`) at the most dramatic moment. Now `deathAnim()` holds on the point of impact, punches the camera, and shatters the ship (swell + spin + fade) with a vignette blackout, then hands off to the ambient orbit *behind* the blurred game-over panel.
   - Matches the "SHATTERED" screen thematically.
   - Reduced-motion: fade only, no shake/scale.

3. **New-record celebration + best-on-start** *(Retention #7)*
   - Live **"NEW BEST"** callout + score turns gold the moment you pass your record mid-run (`score-best`).
   - Game-over shows a gold **NEW RECORD** banner + gold final score + triumphant arpeggio sting (`playNewBest`) + celebratory haptic.
   - Start screen shows **BEST n** as a return goal.

4. **Layered audio bed** *(Audio #4)*
   - Added an LFO-gated sub-bass **momentum pulse** (rate 1.6→5.5 Hz, depth swells with speed) and a faint high **shimmer** that fades in late — the mix physically tightens as you accelerate. Previously just two static drone sines.

5. **Near-miss reward** *(Tension #1/#7)*
   - Tight squeezes (closeness > 0.74) now fire a filtered **whoosh** (`playNearMiss`), a distinct haptic, and a "tunnel-vision" vignette + chroma pulse (`nearMissPulse`). Skill feels rewarded.

6. **Difficulty curve** *(Difficulty #3)*
   - `GATE_GAP_SHRINK` 0.005 → **0.010** and `SPEED_ACCEL` 0.45 → **0.7**. The old curve needed ~400 gates to reach the tightest gap and ~4 min to approach top speed, so runs never built real tension. Now roughly 2× faster ramp — still gentle in absolute terms; first gates remain wide. **These two constants are the main tension dials — tune here first.**

7. **Milestone depth callouts** *(Retention #7)*
   - Brief centered "500m / 1000m / …" pop (`DEPTH_MILESTONES`) with haptic; auto-hides, cleared on death/start.

### Verification
- `npm run build` passes; `tsc --noEmit` clean apart from pre-existing `three` type-declaration noise (project builds via `vite build`, no bundled `@types/three`).
- Loads with **zero console errors**; start → HUD, best-on-start, mute, pause, leaderboard paths verified in a headless browser.
- Full gameplay *feel* (banking, shatter, near-miss, curve) was **not** visually play-tested — the preview pane could not composite frames in this environment. Logic is build-verified and reviewed; the feel constants above are safe to nudge.

---

## Pass 2 — fairness, speed rush, calmer feedback

1. **Flowing gap path** *(Difficulty/Fairness #3)*
   - Gap angles were fully independent `random()*TAU`, so consecutive gaps could sit on opposite walls — an unreachable full-diameter crossing (~0.23s at top speed) = cheap death. Now `nextGapAngle()` steps the gap by a bounded random delta from the previous one, and the max step **tightens with speed** so the line stays reachable. Deaths now come from precision, not teleports. Pairs with pass-1's tighter gaps (tense *and* fair).

2. **Speed-reactive FOV** *(Feel #1)*
   - Camera FOV widens 75°→88° with speed for a visceral acceleration rush. Reset to 75° on start and in the ambient orbit. Disabled under `REDUCE_MOTION`.

3. **Calmer pass feedback** *(Audio/feel #4, safety)*
   - The per-gate pass flash was a full-screen green center strobe at ~4 Hz at top speed (annoying + mild photosensitivity risk). Replaced with a subtle transparent-center **edge glow**; the gate scale-flash + score pulse + SFX still carry the "pass" beat.

### Verification
- `npm run build` + `tsc --noEmit` clean (apart from pre-existing `three` type noise); loads error-free.
- Same caveat as pass 1: feel/fairness validated by logic + build, not a real-device play-test (preview couldn't composite here).

---

## What still blocks "premium paid" quality
- **No real device play-test.** The feel/tuning changes (camera lean amounts, difficulty ramp, audio mix levels) should be validated on a real phone + desktop and nudged to taste.
- **Single game mode / no meta-progression.** Great arcade loop, but nothing to chase beyond high score (fits browser-game scope, but a daily-seed or streak could add returns).
- **Visual identity is strong but uniform.** Every run looks the same palette sweep; depth-based "biomes" (fog color / geometry shifts at milestones) would add awe and a sense of journey.
- **No ship personality.** The player is a plain icosahedron; a subtle procedural form/trail identity would raise perceived production value.

## Next best 5 improvements
1. **Play-test the curve on real devices** and fine-tune `GATE_GAP_SHRINK`, `SPEED_ACCEL`, camera-lean gains, and audio bus levels.
2. **Depth biomes** — shift fog tint / ring density / bloom at depth milestones so the descent visibly evolves (awe + progression, no assets).
3. **Ship + trail identity** — give the player a more distinctive procedural silhouette and a ribbon-style trail instead of point spray.
4. **Combo / flow meter** — reward consecutive near-misses or clean streaks with a building multiplier and rising audio layer (tension + mastery).
5. **Game-over share/replay hook** — one-tap "share your depth" text + a crisper stat readout (best depth, gates, near-misses) to drive the "one more run" and word-of-mouth loop.
