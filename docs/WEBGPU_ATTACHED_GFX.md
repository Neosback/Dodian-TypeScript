# WebGPU Attached GFX Checkpoint

This checkpoint adds the first WebGPU comparison path for actor-attached spot animations (GFX).

The scope is intentionally limited to spot effects attached to players and NPCs. World-tile GFX and projectiles remain separate migration checkpoints.

## Authoritative CPU sources

The WebGPU path does not create a second spot-animation model loader or animation clock.

The existing WebGL path remains authoritative for:

- GFX instance lifetime and start-cycle gating through `GfxManager`
- wall-clock spot frame selection through `GfxRenderer`
- spot definition lookup
- recolor/retexture application
- width/height scale and orientation
- skeletal animation frames
- legacy frame animation
- model lighting
- opaque/alpha face separation
- spot frame sounds

`GfxCache.ensureFrameGeometry()` already produces renderer-neutral packed 12-byte vertices plus `Int32Array` indices for one spot/frame/pass. WebGPU consumes those arrays directly.

## Exact frame capture

`WebGPUAttachedGfxComparison` wraps the authoritative `GfxRenderer.renderMapPass()` only when the opt-in WebGPU comparison is enabled.

Capture occurs after the WebGL draw. `GfxRenderer` stores the frame it just selected in `GfxInstance.lastSoundFrame`, so the WebGPU comparison consumes that exact frame instead of independently advancing spot-animation time.

This avoids a 20 ms frame-boundary race between two renderer-specific clocks.

## Parent actor transform

Attached GFX do not own independent position records in WebGL. They reuse the parent player's or NPC's actor record using:

`base actor-data offset + attachment slot`

The comparison bridge decodes that already-authoritative compatibility record once into the renderer-neutral actor instance contract.

The inherited state includes:

- signed local X/Y
- resolved render plane
- actor rotation
- interaction identity
- active per-actor HSL override

The WebGPU shader never samples the WebGL RGBA16UI actor texture.

## Vertical offset convention

WebGL passes a positive `u_modelYOffset` to `npc.vert.glsl`, which subtracts it from model Y.

The shared WebGPU actor vertex path adds `modelYOffset`, so the comparison bridge normalizes the sign:

`modelYOffset = -round(yOffsetTiles * 128)`

Ground-anchored effects use zero offset.

## Shader and pipeline parity

Attached GFX reuse the already-audited player WebGPU shader path because it has the same packed model/material decode and intentionally has no map-load fade.

This matches current WebGL GFX behavior, which sets `u_timeLoaded = -1.0`.

Both opaque and transparent attached GFX are double-sided because `GfxRenderer` disables `CULL_FACE` around spot-effect draws.

Opaque state:

- triangle list
- no culling
- depth write enabled
- `less-equal` depth comparison

Alpha state:

- triangle list
- no culling
- depth write enabled
- `less-equal` depth comparison
- source-alpha / one-minus-source-alpha blending
- the same early alpha-cutoff/discard path used by player/NPC transparency

The shared shader also preserves:

- actor HSL override before scene HSL override
- terrain-height interpolation
- actor rotation
- plane separation
- packed face-priority depth bias
- texture animation
- material animation frames
- brightness/color banding
- fog

## Texture residency

GFX texture loading remains single-source.

When `GfxCache` discovers a spot-model texture that is not resident, it uses the existing WebGL `updateTextureArray()` path. That function already calls `syncWebGPUTerrainTextures()` before updating WebGL, so the same texture pixels are uploaded into the WebGPU atlas.

No second spot-texture loader is introduced.

## Draw ordering

The comparison lifecycle currently preserves the actor-class order:

Opaque:

1. static opaque scene
2. opaque NPCs
3. opaque players
4. opaque attached GFX

Transparent:

1. static transparent scene
2. transparent NPCs
3. NPC-attached transparent GFX
4. transparent players
5. player-attached transparent GFX

Within the captured GFX lists, map traversal and attachment order follow the authoritative WebGL calls.

The comparison architecture still operates at class-level boundaries, so it does not yet reproduce every per-map interleave from the WebGL renderer. That remains a broader actor-phase parity task and is not expanded in this checkpoint.

## Current WebGL world-view behavior

Current `GfxRenderer` sets `u_worldEntityTransform` to identity for attached GFX, even when the parent actor has a world-view assignment.

The WebGPU comparison intentionally preserves that current behavior by packing the parent actor transform with an identity world matrix. This is parity, not an endorsement of the behavior. If the authoritative renderer later changes attached GFX to follow world-entity transforms, both backends should move together.

## Explicitly deferred

This checkpoint does not migrate:

- world-tile GFX created by `spawnAtTile()`
- `worldGfxDataTextureOffsets`
- projectiles
- projectile pitch/roll packing
- GFX or projectile picking
- interaction highlights for effects
- full live WebGPU renderer activation

## Validation

`client/tests/webgpu-attached-gfx-foundation.test.ts` locks:

- opaque/alpha pipeline state
- double-sided rendering
- alpha blending and discard order
- no map-load fade
- exact WebGL-selected frame capture via `lastSoundFrame`
- reuse of `GfxCache.ensureFrameGeometry()`
- actor-record decoding into neutral state
- parent HSL/rotation/plane placement
- offset-anchor sign normalization
- identity world-transform parity
- existing WebGPU texture synchronization
- opaque and transparent installation order
- exclusion of world-tile GFX and projectiles

The test is wired into both the normal client test chain and `test:webgpu-foundation`.

## Next checkpoint

The next small checkpoint should migrate world-tile GFX or projectiles independently. Projectiles require their own transform contract because the current actor record packs yaw, pitch, roll, and projectile identity differently from players/NPCs/GFX.
