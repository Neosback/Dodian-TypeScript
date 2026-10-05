# WebGPU opaque player comparison

Checkpoint C adds the first dynamic actor draw path to the opt-in WebGPU comparison. WebGL2 remains authoritative and the normal client renderer is unchanged.

## Scope

The WebGPU comparison now consumes the same resolved current-pose player state that the WebGL2 opaque player pass already produced. It does not advance a second animation clock or independently resolve player appearance, sequence layering, or movement state.

Covered in this checkpoint:

- current-pose opaque player geometry;
- player appearance and equipment sequence overrides resolved by the existing player renderer;
- movement/action frame selection and layered movement sequence geometry;
- map-local player placement in client units;
- bridge-aware render-plane resolution;
- OSRS 2048-unit player rotation, including the existing player rotation bias;
- per-actor HSL overrides followed by the scene HSL override;
- terrain-height interpolation using the retained signed height map;
- player model Y offset and world-entity deck-height offset;
- world-entity transforms for players routed through a world view;
- equipment-layer depth bias while preserving projected screen position;
- opaque back-face culling parity, with first-person arms kept double-sided;
- existing texture/material atlas sampling, UV animation, animated texture frames, brightness, color banding, and fog;
- geometry batching by the same appearance/animation batch key used by WebGL2.

## Authoritative data flow

1. WebGL2 runs `PlayerRenderer.renderOpaqueForMap` as before.
2. That pass resolves appearance, movement/action sequence, frame, overlay frame, current-pose geometry, player slots, and batching.
3. When `?webgpuTerrain=1` (or `true`, `compare`, `split`) is active, the comparison hook captures that already-resolved CPU state into the renderer-neutral dynamic actor contract.
4. The WebGPU comparison draws the captured opaque players after opaque static scene geometry and before the transparent static scene pass.
5. Both static geometry and players therefore share the same WebGPU color target and depth buffer.

This ordering is intentional. Rendering players as a separate overlay pass would hide scene-depth errors and would not be a valid parity comparison.

## Renderer-neutral boundary

The comparison snapshot uses `DynamicActorGeometry` and `DynamicActorInstance` from `client/render/dynamic/DynamicActorRenderData.ts`.

WebGPU does not consume the legacy WebGL2 `RGBA16UI` actor texture as its native actor ABI. Per-instance WebGPU vertex data is generated from the neutral fields instead.

The current opaque player instance record contains:

- local X/Y;
- resolved plane;
- rotation;
- HSL override;
- model Y offset;
- interaction/world-view metadata reserved for later interaction work;
- one world-entity transform matrix.

## Geometry ownership

Player animation geometry is still built by the existing CPU player model path. The comparison reuses the exact cached current-pose geometry rather than constructing a second WebGPU-specific player model pipeline.

The neutral geometry cache and WebGPU geometry cache are bounded. Missing/not-yet-ready pose geometry simply omits that comparison batch for the frame rather than changing WebGL2 behavior.

## Failure behavior

The player comparison is only installed for the explicit WebGPU comparison mode. The live WebGL2 client remains authoritative.

If the WebGPU player shader or pipeline cannot initialize, the opaque player comparison pass disables itself and reports the failure while WebGL2 continues rendering.

## Intentionally not covered yet

The following remain later dynamic-scene checkpoints:

- transparent/alpha player faces;
- player spot animations and other attached GFX;
- player interaction/picking authority;
- interaction highlights;
- NPCs;
- projectiles and world spot animations;
- dynamic entity ordering across all transparent actor/effect classes;
- live full-client WebGPU activation.

Until those paths are complete and validated, the comparison is not a complete WebGPU client renderer.
