# WebGPU player alpha parity

Status: implemented in the opt-in `?webgpuTerrain=1` comparison path.

This checkpoint extends the WebGPU player foundation from opaque player faces to the current-pose transparent/alpha faces produced by the authoritative WebGL2 player animation path. WebGL2 remains the live renderer and interaction authority.

## Authoritative ordering

The live WebGL frame submits scene work in this order:

1. opaque static scene
2. opaque actors
3. transparent static scene
4. transparent NPCs
5. transparent players
6. player-attached alpha GFX/projectiles

The WebGPU comparison currently has no dynamic NPC/GFX/projectile pass, so its implemented order is:

1. opaque static scene
2. opaque players
3. transparent static scene
4. transparent players

The player alpha pass is appended only after the complete static transparent traversal. This preserves the relative ordering that already exists and leaves the missing NPC/GFX/projectile slots explicit for later checkpoints.

## Current-pose snapshot source

WebGPU does not run a second player animation selector.

`PlayerRenderer.renderOpaqueForMap()` already resolves, for each map and frame:

- renderable appearance
- sequence and frame
- optional layered movement/action sequence
- sequence-driven weapon/shield appearance overrides
- first-person appearance handling
- batch membership and actor slot
- packed current-pose opaque and alpha geometry

The alpha comparison captures immediately after that authoritative map pass. It reads the same `geomCache` entry used by the opaque comparison and copies only its alpha vertex/index payload into the renderer-neutral `DynamicActorGeometry` contract.

This means opaque and alpha WebGPU player passes compare the same resolved pose rather than independently advancing animation state.

## Placement and shading parity

The alpha shader extends the opaque player WGSL module and reuses its `vsPlayerOpaque` vertex entry point. Therefore both player passes share:

- map-local placement
- OSRS rotation units and renderer rotation bias
- bridge-aware signed height-map interpolation
- model Y offset
- per-plane separation
- exact player equipment priority depth convention
- world-entity deck height and animation transform
- per-actor HSL override before scene HSL override
- texture/material lookup
- texture animation
- brightness and colour banding
- fog

## Alpha fragment contract

`fsPlayerAlpha` mirrors the WebGL `player.frag.glsl` `DISCARD_ALPHA` path.

The base texture sample is evaluated first. A fragment is discarded when:

- an untextured face has composed alpha below `0.01`, or
- the base texture alpha is below the material alpha cutoff.

The discard happens before animated-frame texture sampling, matching the live GLSL ordering. Animated material frames, palette lighting, fog, and final composed alpha then use the same calculations as the opaque player shader.

## Pipeline state

Transparent player geometry matches the live player alpha pass:

- triangle list
- `frontFace = ccw`
- no back-face culling for player alpha geometry
- `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` colour blending
- the same blend factors for the alpha channel, matching `glBlendFunc`
- `depth24plus`
- `depthCompare = less-equal`
- depth writes enabled

The live `PlayerRenderer` explicitly disables culling for the alpha pass, so this checkpoint intentionally does not reuse the opaque player cull/no-cull selector.

## Resources

The alpha pass uses:

- shared WebGPU scene uniform bind group
- the matching static map bind group
- the shared texture/material atlas bind group
- a per-map signed four-plane height texture
- cached alpha vertex/index buffers keyed by current-pose geometry key
- growable per-batch instance buffers using the same 112-byte player instance ABI as the opaque pass

Alpha geometry is comparison-only and bounded by the same 384-entry CPU geometry cache limit used by the opaque player comparison.

## Validation

`client/tests/webgpu-player-alpha-foundation.test.ts` locks:

- no-cull transparent player state
- source-alpha blend factors
- `less-equal` depth testing with depth writes enabled
- reuse of the opaque player vertex path
- base-sample alpha discard before animated-frame sampling
- material alpha-cutoff behavior
- transparent player submission after static transparency
- snapshot capture from the already-resolved opaque map pass
- use of the alpha geometry payload rather than opaque indices

The test is included in both the normal client test chain and `test:webgpu-foundation`.

## Not covered yet

This checkpoint intentionally does not add:

- transparent NPCs
- player or NPC spot animations/GFX
- projectiles
- dynamic actor picking
- interaction highlights
- world-entity ghost/overlap special rendering
- browser/GPU screenshot A/B validation
- live `?renderer=webgpu` activation

Those remain separate checkpoints so player alpha parity can be reviewed independently.
