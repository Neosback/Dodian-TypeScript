# WebGPU static-scene culling parity

This note records the static-scene culling audit for `feat/webgpu-renderer`. It is intentionally limited to terrain and loc-like geometry in the opt-in WebGPU A/B comparison. Dynamic players, NPCs, projectiles, spot effects, interaction picking, and the special world-entity overlap/ghost redraw remain later checkpoints.

## Authoritative map selection

The WebGPU comparison does not invent its own scene-map visibility system.

`renderWebGPUTerrainComparison()` consumes the authoritative WebGL2 renderer state and uses the same inputs as `renderGeometryPass()`:

- `mapManager.visibleMaps` and `visibleMapCount` provide the upstream scene-map order;
- `getRenderCullTile()` supplies the same frame cull tile;
- `getFrameRenderDistanceTiles()` supplies the same effective render distance;
- `isMapWithinRenderDistance()` applies the same zone-based cutoff;
- `getMapTileDistanceFromPoint()` measures distance to the actual render bounds, including world-entity overlay bases;
- `getFrameLodThresholdTiles()` supplies the same LOD threshold;
- `tileDistance > lodThresholdTiles` selects the same full-detail versus LOD payload.

The comparison then passes only that filtered ordered list plus the already-resolved LOD bit to `WebGPUStaticSceneRenderer.setVisibleSceneMaps()`.

This is preferable to duplicating chunk/zone visibility inside WebGPU. The renderer-neutral/authoritative CPU decision remains shared, and both graphics APIs consume the result.

## Zone render-distance rule

The current WebGL2 path measures map inclusion in 8x8 zones. `isMapWithinRenderDistance()` computes the distance from the frame cull tile to the map's zone bounds and compares it with:

`ceil((renderDistanceTiles + renderDistancePadTiles) / 8)`

The static WebGPU comparison calls the same host method with the same zero pad used by the normal geometry pass. Therefore there is no separate WebGPU render-distance approximation to keep synchronized.

## Map order and transparency

Opaque static geometry follows the authoritative visible-map order.

Transparent static geometry walks that same selected map list in reverse, matching the WebGL2 geometry pass. Within each selected map the WebGPU path preserves terrain-first ordering followed by loc-like static geometry, with delayed-wall ordering applied to the prepared loc/ground-item/door submissions.

## Roof-plane culling

WebGL2 filters terrain, loc, ground-item, and door draw ranges against the current roof-plane limit before submission.

The WebGPU static renderer applies the same `plane <= frame.roofPlaneLimit` contract to terrain and loc-like passes. Face-priority compute receives only expanded draws that survive the same roof-plane limit, so hidden-roof geometry does not affect depth/priority thresholds.

## Back-face culling

The frame's existing `cullBackFace` setting remains authoritative.

- WebGPU raster pipelines select their cached `cullMode: "back"` or `cullMode: "none"` variants from that flag.
- Exact face-priority compute uses the same flag when deciding whether projected back faces participate in priority buckets.
- With culling disabled, every submitted face remains eligible for the exact priority sorter.

When culling is enabled and all three vertices are in front of the camera, priority membership uses the same projected winding convention as the WebGPU pipeline's `frontFace: "ccw"` configuration.

## Camera-plane / clipping boundary

A projected winding test is only valid before clipping when all three vertices have positive clip-space `w`.

The earlier visibility implementation rejected a triangle when *any* vertex had non-positive `w`. That could incorrectly remove a primitive which crossed the camera plane even though the hardware clipper could preserve a visible portion.

The corrected static priority-visibility rule is conservative:

- all three `w <= 0`: reject the triangle as fully behind the camera;
- mixed positive/non-positive `w`: keep the triangle in the priority stream and let hardware clipping decide the visible fragment;
- all three `w > 0`: apply the projected front-face winding test normally.

The CPU oracle in `WebGPUFacePriorityVisibility.ts` and the WGSL depth/visibility compute use the same rule. `webgpu-face-priority-visibility.test.ts` locks the mixed-camera-plane and fully-behind cases.

This rule is deliberately about the camera-plane singularity, not a new CPU frustum implementation. Ordinary clip-volume rejection remains the rasterizer's job just as it is for the WebGL2 static geometry path.

## What the static audit closes

For the current A/B static scene, the following culling decisions are now shared or matched:

- upstream visible-map membership and ordering;
- zone-based render-distance rejection;
- world-entity-aware map distance bounds;
- full-detail versus LOD selection;
- roof-plane filtering;
- frame back-face-culling enable/disable state;
- back-face-aware exact face-priority membership;
- conservative camera-plane crossing behavior;
- hardware clipping for ordinary clip-volume rejection.

No additional WebGPU-only map/chunk culling layer is required at this stage.

## Remaining culling work

The next culling work belongs to dynamic and interaction rendering rather than this static map path:

1. player and NPC visibility/culling when their geometry moves to WebGPU;
2. projectile and spot-effect visibility;
3. special world-entity overlap/ghost redraw semantics;
4. asynchronous picking/highlight visibility without synchronous GPU readback;
5. representative browser/GPU A/B validation of camera-near geometry and large world-entity transforms;
6. performance profiling to determine whether optional GPU-driven coarse culling is worthwhile after parity, rather than introducing it before correctness is established.

The WebGL2 renderer remains authoritative while these later stages are incomplete.
