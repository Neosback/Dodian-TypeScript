# WebGPU Projectile Checkpoint

This checkpoint adds the first WebGPU comparison path for projectiles.

The scope is intentionally limited to projectile model rendering. Projectile picking, interaction highlights, and full live WebGPU activation remain deferred.

## Authoritative CPU state

WebGPU does not create a second projectile simulation or animation clock.

The existing projectile stack remains authoritative for:

- launch/start/end timing
- homing source/target updates
- current world X/Y/Z
- yaw/pitch/roll generation
- spot-animation frame advancement
- map ownership from current world position
- bridge-aware terrain-relative model offset
- projectile frame sounds

`ProjectileManager` and `ProjectileRenderer` continue to run first. The WebGPU comparison consumes their resolved state.

## Renderer-neutral projectile contract

`client/render/projectiles/ProjectileRenderData.ts` defines a projectile-specific render contract rather than pretending projectiles are players or NPCs.

It exposes:

- signed map-local X/Y
- resolved render plane
- yaw
- pitch
- roll
- fractional sub-tile X/Y
- ground-relative model Y offset
- full projectile id
- debug/runtime id
- current spot-animation frame
- source map id

The current WebGL RGBA16UI record remains a compatibility bridge only.

## Legacy angle precision

The current WebGL record intentionally quantizes projectile orientation:

- yaw: 11 bits, full 0..2047 range
- pitch: 7 stored bits, restored at 16-unit precision
- roll: 3 stored bits, restored at 256-unit precision

The WebGPU comparison decodes these packed values from `actorRenderData` rather than reading the higher-precision runtime values directly. This keeps A/B orientation identical to what WebGL actually renders.

## Fractional position

WebGL stores `floor(relativeX)` and `floor(relativeY)` in the actor record and supplies the remaining fractional position separately through `u_projectileSubOffset`.

WebGPU preserves the same split:

- packed/decoded integer local X/Y
- separately captured `subOffsetX` / `subOffsetY`

The shader adds them before terrain-height interpolation.

## Vertical placement

Projectile rendering is grounded against the map height texture and then applies the CPU-provided ground-relative model offset.

The comparison calls the existing `ProjectileRenderer.resolveModelYOffset()` implementation when available rather than maintaining a second bridge-height calculation.

The WGSL follows the same sign convention as WebGL:

`localPos.y -= modelYOffset`

## Rotation order

`projectile.vert.glsl` uses row-vector transforms in this order:

1. roll around Z
2. pitch around X
3. yaw around Y

`WebGPUProjectileShader` reproduces this order explicitly with scalar rotation math.

## Shader parity

The projectile shader reuses the already-audited GFX packed model/material/fragment functions, then adds a projectile-specific vertex entry point.

It preserves:

- packed 12-byte model vertices
- scene HSL override
- material animation
- animated texture frames
- brightness/color banding
- fog
- alpha cutoff/discard behavior
- cache face-priority depth bias

It intentionally does **not** apply:

- actor HSL override
- map load fade (`ProjectileRenderer` sets `u_timeLoaded = -1`)
- world-entity transform
- NPC plane-separation bias
- player equipment-layer depth reprojection

## Culling and depth state

ProjectileRenderer does not force a separate cull mode. It inherits the renderer's restored `cullBackFace` state after GFX.

The WebGPU comparison therefore owns both cull and no-cull variants for opaque and alpha projectiles.

Opaque:

- triangle list
- optional back-face culling
- depth writes enabled
- `less-equal` depth comparison

Alpha:

- triangle list
- optional back-face culling
- source-alpha / one-minus-source-alpha blending
- `less-equal` depth comparison
- **depth writes disabled**

The disabled alpha depth write is projectile-specific. WebGL does this so nested translucent projectile shells can all blend rather than the first shell occluding the rest.

## Geometry and texture reuse

Projectile models are spot-animation models.

The WebGPU pass reuses:

- `GfxCache.ensureFrameGeometry()` for packed vertices/indices
- the same texture discovery/update path used by GFX
- the existing WebGPU texture atlas/material table

No second projectile model or texture loader is introduced.

## Draw grouping and map order

Within a map, WebGL groups projectiles by first-seen `(spotId, frame)` and then draws projectile slots in original order. WebGPU reproduces that grouping order.

Map traversal matches the live renderer:

Opaque:

- visible maps front-to-back
- projectiles after attached/world GFX for each comparison phase

Transparent:

- visible maps back-to-front
- projectiles after transparent players and player-attached GFX

The comparison boundary is still class-oriented rather than reproducing every individual WebGL call interleave, consistent with the existing actor/GFX comparison architecture.

## GPU instance ABI

The WebGPU projectile instance record is 12 floats / 48 bytes:

1. local X
2. local Y
3. plane
4. yaw
5. pitch
6. roll
7. fractional X
8. fractional Y
9. model Y offset
10. projectile id
11. debug id
12. reserved

This is a WebGPU-native representation. It is not the RGBA16UI WebGL actor texture ABI.

## Validation

`client/tests/webgpu-projectile-foundation.test.ts` locks:

- 8-word / 16-byte WebGL compatibility record
- signed local-coordinate decoding
- yaw/pitch/roll bit layout
- pitch/roll quantization
- 48-byte WebGPU instance ABI
- roll -> pitch -> yaw shader order
- fractional position path
- terrain grounding and model-offset sign
- no world transform
- no plane separation
- no player equipment depth reprojection
- cull/no-cull variants
- opaque depth writes enabled
- alpha depth writes disabled
- alpha blend state
- authoritative frame/model-offset resolver reuse
- front-to-back opaque traversal
- back-to-front alpha traversal
- projectile phase installation after GFX

The test is wired into both the normal client test chain and `test:webgpu-foundation`.

## Explicitly deferred

This checkpoint does not migrate:

- projectile picking
- projectile interaction highlights
- projectile-specific debug overlays
- full live `?renderer=webgpu` activation
- 2D/UI/minimap rendering

## Next checkpoint

With terrain, static locs/items, players, NPCs, attached GFX, world GFX, and projectiles now represented in the opt-in WebGPU comparison path, the next step should be a parity/consolidation checkpoint rather than immediately adding another rendering domain.

Recommended next work:

1. audit actor/GFX/projectile ordering against the live frame loop end-to-end
2. consolidate duplicated WebGPU dynamic geometry/height/instance resource code
3. add browser/GPU A/B validation hooks and counters
4. then decide whether dynamic picking/highlights or live WebGPU activation should be the next migration stage
