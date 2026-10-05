# WebGPU NPC Alpha Foundation

Checkpoint F adds current-pose NPC transparency to the opt-in WebGPU comparison path. WebGL2 remains the authoritative live renderer.

## Scope

Implemented in this checkpoint:

- transparent NPC model geometry from `DynamicNpcAnimLoader`
- base, movement, action, and layered movement/action poses
- varbit/varp-resolved NPC morph geometry through the existing loader
- authoritative actor placement decoded into renderer-neutral actor instances
- signed map-local X/Y, resolved render plane, rotation, interaction identity, and HSL override
- bridge/height-map contouring through the shared WebGPU actor vertex path
- world-entity NPC deck-height offset and animated world transform
- OSRS-style map load fade and fog
- exact actor/scene HSL ordering inherited from the shared NPC vertex shader
- priority-depth behavior inherited from the opaque NPC path
- source-alpha blending
- depth writes with `less-equal`
- cull/no-cull variants selected from the scene `cullBackFace` setting
- back-to-front visible-map traversal
- sequential NPC alpha submission to preserve blend/depth order
- unbatched NPC alpha after the visible-map traversal

Not included yet:

- attached NPC GFX / spot animations
- projectiles
- dynamic actor picking or interaction highlights
- replacing CPU `SceneRaycaster` authority
- full browser/GPU visual A/B validation
- live WebGPU client activation

## Geometry and animation authority

WebGPU does not introduce an NPC animation clock or NPC model loader.

`DynamicNpcAnimLoader` remains the CPU authority for the current posed model. It provides packed opaque and alpha geometry for the resolved NPC type, sequence, frame, and optional overlay sequence/frame.

The comparison capture runs after the authoritative opaque actor pass has packed the current actor state. It rebuilds the ordered alpha draw list from the already-current ECS animation state and reads placement/HSL fields from the existing compatibility actor record. The WebGPU shader itself never samples the WebGL actor texture.

This compatibility-record decode is temporary A/B infrastructure. Before full WebGPU activation, the neutral actor producer should move earlier so both WebGL2 and WebGPU consume the neutral record directly and WebGL2 alone performs its legacy texture packing.

## Transparent ordering

The WebGL actor sequence is:

1. transparent static scene
2. transparent NPCs
3. transparent players
4. later attached effects/projectiles where applicable

Checkpoint F adds `WebGPUTransparentActorPhase` after the static transparent scene. NPC alpha registers in that phase. The existing player-alpha wrapper is installed after the NPC phase, producing:

1. WebGPU transparent terrain/scenery
2. WebGPU NPC alpha
3. WebGPU player alpha

Within the NPC alpha pass, the capture walks visible maps from back to front and NPCs in map order. It intentionally keeps one ordered draw entry per NPC rather than geometry-batching transparent NPCs, because alpha blending combined with depth writes makes actor ordering observable.

Unbatched NPCs are appended after the map traversal, matching the authoritative dynamic NPC ordering contract.

## Pipeline state

NPC alpha uses:

- triangle-list topology
- `depth24plus`
- depth writes enabled
- `less-equal` depth comparison
- color blend: `src-alpha`, `one-minus-src-alpha`, `add`
- alpha blend: `src-alpha`, `one-minus-src-alpha`, `add`
- back-face culling when the scene enables `cullBackFace`
- no culling when the scene disables it

Transparent NPCs do not use the always-double-sided rule of the player transparent pass.

## Alpha discard

`fsNpcAlpha` mirrors `main.frag.glsl` with `DISCARD_ALPHA`:

1. sample the unanimated/base texture
2. compute base alpha
3. discard untextured nearly-zero-alpha faces or texture samples below the material alpha cutoff
4. only after that, sample/interpolate animated texture frames
5. apply color banding, brightness, fog, and final alpha

Keeping the discard before animated-frame sampling matches the current WebGL material contract.

## World entities

NPC alpha carries `worldViewId` in the neutral actor identity. The shared instance ABI resolves the current `WorldEntityAnimator` transform per draw. NPC model Y offset includes the world-entity deck height using the same sign normalization as the opaque NPC comparison.

## Deliberate checkpoint boundary

NPC-attached GFX is present in the authoritative WebGL transparent NPC loop, but it is intentionally excluded here. Mixing GFX into this checkpoint would require migrating a separate spot-animation geometry/cache/instance contract and would make NPC model-alpha parity harder to isolate.

The next checkpoint should audit and migrate actor-attached GFX and projectiles as their own rendering domain.
