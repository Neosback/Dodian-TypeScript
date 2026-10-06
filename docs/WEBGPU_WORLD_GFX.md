# WebGPU World GFX Checkpoint

Checkpoint G2 adds WebGPU comparison rendering for world-tile spot animations created through `GfxManager.spawnAtTile()`.

This is intentionally separate from actor-attached GFX because world effects own independent placement records through `worldGfxDataTextureOffsets`. Projectiles remain out of scope.

## Authoritative CPU state

The existing GFX system remains authoritative for:

- instance lifetime and start-cycle gating
- wall-clock frame selection
- spot definition lookup
- recolor/retexture
- scaling and orientation
- skeletal or legacy sequence animation
- opaque/alpha face extraction
- frame sounds

`GfxCache.ensureFrameGeometry()` is reused directly for packed 12-byte model vertices and `Int32Array` indices.

No WebGPU-specific spot animation clock or model loader is introduced.

## World placement record

`addWorldGfxRenderData()` writes one compatibility record per active world effect.

The record is centered on the target tile:

- `worldX = tileX * 128 + 64`
- `worldY = tileY * 128 + 64`

It then converts those coordinates to map-local fine units and resolves the bridge-aware render plane through `resolveHeightSamplePlaneForLocal()`.

The record currently carries:

- signed local X
- signed local Y
- resolved plane
- zero rotation
- zero interaction ID
- zero HSL override

`world.mapId` and `world.slot` bind the instance back to its map-local record.

The WebGPU comparison decodes this authoritative record rather than independently reproducing tile ownership or bridge-plane policy.

## Renderer-neutral world GFX snapshot

World effects are not players or NPCs, so G2 does not fabricate a `DynamicActorIdentity` merely to satisfy the shared GPU vertex layout.

`WebGPUWorldGfxPlacement` contains only the rendering state that exists for a world effect:

- local X/Y
- plane
- rotation
- model Y offset
- interaction ID
- HSL override

`packWebGPUWorldGfxInstanceData()` writes that state into the same 112-byte GPU instance layout used by the shared GFX shader, with:

- `worldViewId = -1`
- identity world transform

That keeps the GPU ABI reusable without pretending the effect is an actor.

## Vertical offset

World effects preserve the current WebGL offset policy:

`yOffsetTiles ?? world.heightOffsetTiles ?? 0`

When the anchor is `offset`, the value is converted to fine units and sign-normalized for the WebGPU shader:

`modelYOffset = -round(offsetTiles * 128)`

Ground-anchored effects use zero.

## Exact spot frame

G2 reads `GfxInstance.lastSoundFrame`, which was selected by the authoritative `GfxRenderer` earlier in the frame.

WebGPU therefore consumes the same spot frame instead of advancing its own timer.

## Shader correction discovered during G2

The G2 audit found that the first WebGPU NPC/GFX implementation still inherited the player equipment-layer depth projection path.

That did not match `npc.vert.glsl`, which applies both plane separation and packed face-priority bias directly to view-space Z before projection.

The correction is now centralized in `WebGPUNpcOpaqueShader`:

- plane separation: `viewPos.z += plane * 0.01`
- priority bias: applied directly to `viewPos.z`
- projection occurs after both adjustments
- player-only `depthLayerClip` reprojection is excluded

`WebGPUGfxShader` derives from that corrected NPC shader and removes only map-load fade, matching `GfxRenderer`'s `u_timeLoaded = -1.0` behavior.

This correction also improves the previously added opaque/alpha WebGPU NPC checkpoints and actor-attached GFX checkpoint.

## Pipeline state

World GFX use the same spot-effect pipeline state as actor-attached GFX.

Opaque:

- triangle list
- no back-face culling
- depth write enabled
- `less-equal`

Transparent:

- triangle list
- no back-face culling
- depth write enabled
- `less-equal`
- source-alpha / one-minus-source-alpha blending
- early alpha cutoff before animated-frame sampling

## Ordering

WebGL world GFX are emitted as the final GFX attachment class for a map.

The comparison boundaries are therefore:

Opaque:

1. static scene
2. NPCs
3. players
4. player/NPC attached GFX
5. world-tile GFX

Transparent:

1. static transparency
2. NPCs
3. NPC-attached GFX
4. world-tile GFX
5. players
6. player-attached GFX

Within world GFX, the comparison reproduces `GfxRenderer` grouping:

1. first-seen `(spotId, frame)` group
2. first-seen Y-offset group
3. source instance order

Opaque visible maps are traversed front-to-back. Transparent visible maps are traversed back-to-front.

The current comparison renderer still has class-level boundaries, so it does not reproduce every exact per-map interleave between all actor/GFX classes. That remains a broader phase-integration task.

## Texture residency

World GFX use the same `GfxCache` texture discovery as attached effects.

When a spot model introduces a missing texture, the existing `updateTextureArray()` path calls `syncWebGPUTerrainTextures()`, so the same texture reaches the WebGPU atlas without a separate loader.

## Explicitly deferred

G2 does not implement:

- projectiles
- projectile yaw/pitch/roll packing
- projectile trajectory transforms
- GFX picking
- effect interaction highlights
- full live WebGPU activation

## Validation

`client/tests/webgpu-world-gfx-foundation.test.ts` locks:

- the 112-byte world-GFX GPU instance ABI
- identity world transform
- no fake actor identity
- authoritative `worldGfxDataTextureOffsets` record reuse
- target-tile center placement
- bridge-aware plane source
- world offset fallback semantics
- exact `lastSoundFrame` reuse
- GFX geometry reuse
- NPC-derived GFX shader behavior
- no map-load fade
- no player `depthLayerClip` projection
- front-to-back opaque map traversal
- back-to-front alpha traversal
- GFX grouping order
- comparison installation order
- explicit exclusion of projectiles

The test is included in both the normal client test chain and `test:webgpu-foundation`.

## Next checkpoint

The next isolated migration step should be projectiles. They require a dedicated neutral transform contract because the current packed record encodes map-local position, resolved plane, yaw, reduced-precision pitch, reduced-precision roll, and projectile ID differently from player/NPC/GFX records.
