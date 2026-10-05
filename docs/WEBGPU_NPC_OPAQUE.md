# WebGPU opaque NPC foundation

Checkpoint E adds the first WebGPU NPC path to the opt-in `?webgpuTerrain=1` comparison renderer. WebGL2 remains authoritative and the normal live client is unchanged.

## Scope

This checkpoint covers opaque NPC rendering only.

Implemented:

- renderer-neutral current-pose NPC geometry from `DynamicNpcAnimLoader`
- base/unanimated NPC geometry when no active sequence exists
- action sequence frame selection
- movement sequence frame selection
- layered movement overlay sequence selection when the authoritative renderer allows it
- morph-resolved NPC model geometry through the existing varbit/varp-aware `DynamicNpcAnimLoader`
- authoritative WebGL actor-record conversion into `DynamicActorInstance`
- signed local X/Y placement
- resolved render plane
- 2048-unit NPC rotation
- per-actor HSL override
- existing interaction id preservation in the neutral snapshot
- world-entity NPC deck-height offset
- world-entity animation transform
- map signed-height contouring
- map load fade through fog
- shared texture/material atlas sampling
- animated texture frames
- brightness, color banding, fog, plane separation, and exact priority depth behavior
- global back-face culling parity
- unbatched NPC coverage through `unbatchedNpcRenderEntries`
- ordered opaque actor phase so WebGPU submits static scene, then NPCs, then players

Not covered yet:

- transparent/alpha NPC faces
- player/NPC interleaving beyond opaque depth-tested parity cases
- attached NPC spot animations/GFX
- NPC interaction picking
- NPC interaction highlights
- replacing CPU `SceneRaycaster` authority
- browser/GPU screenshot parity validation
- live `?renderer=webgpu` activation

## Geometry source

`DynamicNpcAnimLoader` remains the CPU authority for current-pose NPC geometry. It already resolves NPC transforms/morphs through the existing `NpcType.transform(...)` path and uses the same `NpcModelLoader` and sequence loaders as WebGL2.

WebGPU therefore does not introduce a second NPC animation clock, model loader, or morph evaluator.

For the comparison path, the current authoritative WebGL actor record is decoded once into renderer-neutral `DynamicActorInstance` fields. The WebGPU shader consumes the neutral instance buffer and does not sample the WebGL `RGBA16UI` actor texture.

This comparison bridge is temporary architecture. The eventual live WebGPU renderer should publish `DynamicActorInstance` before WebGL compatibility packing rather than requiring a WebGL actor record to exist.

## Actor order

The existing player comparison originally patched `WebGPUStaticSceneRenderer.drawOpaqueScene()` directly. Adding another direct wrapper for NPCs would make actor ordering depend on hook installation order.

Checkpoint E introduces `WebGPUOpaqueActorPhase` as a small ordered phase registry. The NPC phase is registered at order `10` and installed before the existing player wrapper. The resulting effective order is:

1. opaque static scene
2. opaque NPC comparison phase
3. opaque player comparison phase

This mirrors the relevant WebGL2 opaque actor order while keeping future actor phases deterministic.

## Transform parity

The shared WebGPU actor instance ABI stores a normalized additive model Y offset. The existing WebGL NPC shader subtracts `u_modelYOffset`, so NPC snapshot creation stores the negated resolved NPC offset. This lets the common WebGPU actor vertex path retain one transform convention for both players and NPCs.

World-entity NPCs additionally receive the same deck-height offset and `WorldEntityAnimator` matrix used by WebGL2.

## Shader parity

`WebGPUNpcOpaqueShader.ts` derives from the already-audited packed player shader because NPCs and players share the same packed vertex/material representation. It adds the NPC-specific map load-fade behavior from the WebGL NPC vertex shader.

The opaque pipeline uses:

- `triangle-list`
- `depth24plus`
- depth compare `less-equal`
- depth writes enabled
- back-face culling when `SceneFrameDescription.cullBackFace` is enabled
- no blending

## Tests

`client/tests/webgpu-npc-opaque-foundation.test.ts` locks:

- NPC WGSL entry points
- map load fade
- signed height-map path
- world-entity transform ordering
- HSL override
- exact equipment/model priority depth constants inherited by the packed actor path
- conversion from the authoritative actor record into the neutral instance contract
- absence of WebGL actor-texture sampling in WGSL
- current-frame and base geometry paths
- world-entity deck-height/transform handling
- cull/depth state
- unbatched NPC coverage
- static-before-actor phase ordering
- NPC-before-player installation ordering

The test is included in both `yarn test` and `yarn test:webgpu-foundation`.
