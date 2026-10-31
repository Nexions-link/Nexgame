# NGW-GFX-MODERN-001 — Audit and modernization baseline

Date: 2026-10-31
Scope: spherical NexGameWorld (`planet-test/`) only. This is an audit/planning branch: no production rendering, gameplay, server or deployment changes.

## Verified source architecture

- Three.js 0.160.1 (`package.json`).
- `planet-test/planet.js`: WebGL world entry point, graphics presets, optional art modules, frame profiler, shadow refresh budget, forest spatial batches, safety fallback.
- `planet-test/graphics-quality.js`: economy/balanced/high presets. DPR caps 0.9/1.3/1.65, shadows 0/1024/2048, fog distances and foliage densities.
- `planet-test/frame-performance.js`: bounded per-scene frame-gap/CPU/draw-call samples, FPS and P95; CPU timings are *not* GPU timings.
- `planet-test/render-budget.js`: throttles shadow-map refresh to 20 Hz balanced / 30 Hz high, independent of gameplay simulation.
- `planet-test/forest-spatial-batches.js`: per-cell spatial partition of eligible static instanced meshes, distance/horizon culling, optional distant geometry. Existing technique must be benchmarked before rewriting.
- `planet-test/art-safety.js`: isolates optional visual layers, supports base-art fallback and WebGL context-loss handling.
- `planet-test/graphics-quality.test.mjs`: preset and integration assertions exist.

## Design target

Modern WoW-like *art direction* using original assets, not proprietary Blizzard models or textures. Preserve spherical topology, camera behavior, mobile joystick, keyboard controls, gameplay, network interfaces, and existing house/chest cinematics.

## Risks / unresolved questions

1. DPR 1.65 + 2048 shadow map may be expensive on mobile; need GPU/frametime measurements before any increase.
2. Existing forest cell partitioning can trade fewer rendered instances for more draw calls; measure worst-case camera viewpoints, culling overhead, and material/geometry count.
3. Existing frame profiler measures browser frame intervals and JS, not GPU timing. It cannot prove GPU cost.
4. Optional visual layers may allocate large geometry or textures at startup; measure VRAM estimates and warm-up hitches.
5. Avoid changing engine/render backend until platform compatibility tests, especially mobile Safari, are complete.

## Implementation gates

### GFX-00 Baseline and reproducible performance tests
- Capture reference camera poses in starting village, grass outside roads, Whispering Forest entrance/deep forest, combat, interior.
- Record device, browser, screen resolution, DPR, graphics preset, FPS average, P95 frame interval, max draw calls, triangles, textures, GPU timing where available.
- Measure cold-start, camera rotation, movement, combat and first-time forest entry.
- Separate PC and iPhone baselines. Compare each change against identical reference views.

### GFX-01 Instrumentation
- Add safe opt-in renderer.info statistics and GPU timing only when supported.
- Keep diagnostics local and bounded. Do not collect account information or transmit telemetry.
- Ensure diagnostic tools can be disabled without impacting frame stability.

### GFX-02 Material/lighting standard
- Establish original stylized PBR material library (terrain, foliage, bark, stone, cloth).
- Shared color management and tonemapping, consistent shadow softness and exposure across zones.
- Golden screenshots from same reference camera settings.

### GFX-03 Geometry and vegetation
- Profile and tune spatial batches / LOD thresholds / material counts before adding density.
- Use instancing for repeated grass and shrubs; prefer geometry silhouette and material variety to raw polygons.
- Make grass visible outside starter roads, not only large shrubs.

### GFX-04 Atmosphere
- Consistent biome-specific fog, ambient fill, restrained atmospheric lighting, forest canopy response.
- Effects scaled by quality tier and viewport load; no unconditional full-screen costly postprocessing.

### GFX-05 Characters and animation
- Unify skeleton/clip conventions and transitions.
- Benchmark skinned mesh cost with multiple players and wolves.
- Keep multiplayer synchronization and simulation untouched.

### GFX-06 QA and rollout
- Automated static/module tests; repeatable comparison screenshots; baseline P95 no-regression.
- Enable via isolated flag first; require explicit device testing before default activation.
- Deploy only via project publication pipeline and verify public domain versions/assets before claiming release.

## Acceptance criteria

- Visual improvement is demonstrated against recorded screenshots, not just claimed.
- No sustained FPS/P95 regression against matching baseline at the same device/preset; if impossible, provide a clear quality/performance tradeoff.
- Character, camera, HUD, inventory, chest, quests and online behavior remain unchanged.
- No Blizzard game assets bundled without proper authorization.
- Production remains unchanged until tests and publication verification.
