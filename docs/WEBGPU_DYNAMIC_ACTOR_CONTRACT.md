# WebGPU dynamic actor render-data contract

This note records the renderer-neutral dynamic-actor foundation introduced on `feat/webgpu-renderer` before the player/NPC WebGPU passes are implemented.

## Goal

Players and NPCs currently share important CPU-side semantics but reach WebGL2 through backend-specific machinery such as PicoGL draw calls and the `RGBA16UI` actor-data texture. WebGPU should not duplicate the game/animation logic or treat that WebGL texture layout as its native ABI.

`client/render/dynamic/DynamicActorRenderData.ts` defines the common boundary instead.

## Neutral actor state

A `DynamicActorInstance` carries only renderer-neutral information:

- actor kind and stable client/server/world-view identity;
- interaction id and optional source-map identity;
- map-local position in client units;
- resolved render plane;
- OSRS 2048-unit rotation;
- signed model Y offset, already normalized by the producer;
- resolved animation sequence/frame plus optional overlay animation;
- resolved per-actor HSL override;
- a geometry key identifying the current posed geometry;
- optional hidden state for stable-slot cases.

The contract deliberately does not contain WebGL textures, PicoGL buffers/draw calls, WebGPU buffers/bind groups, or shader objects.

## Geometry contract

`DynamicActorGeometry` keeps the existing packed current-pose CPU geometry as two passes:

- opaque `Uint8Array` vertices + `Int32Array` indices;
- alpha `Uint8Array` vertices + `Int32Array` indices.

The packed vertex representation is already produced by the CPU model/scene builders and is not graphics-API-specific. `createDynamicActorGeometry()` also records the retained CPU byte cost so the existing bounded animation caches can continue to enforce memory limits.

`createDynamicActorBatches()` groups visible instances by first-seen geometry key. Hidden actors and geometry that is not ready yet are skipped rather than generating invalid draw work.

## WebGL2 compatibility packing

The current shaders read two `RGBA16UI` texels, or eight `uint16` words, per actor. That remains supported through `writeDynamicActorWebGLRecord()`:

1. signed local X;
2. signed local Y;
3. plane in bits 0-1 and rotation above it;
4. existing 16-bit interaction payload;
5. hue/saturation override;
6. luminance/amount override;
7. reserved zero;
8. reserved zero.

Signed local coordinates explicitly preserve the existing Uint16/two's-complement behavior. The accompanying decoder is for tests/debugging.

This compatibility record is intentionally one-way architecture: WebGL2 may pack the neutral actor state into its existing texture ABI, but WebGPU should consume the neutral fields directly and create its own storage/uniform representation.

## Validation

`client/tests/dynamic-actor-render-data.test.ts` locks:

- signed coordinate encoding/decoding;
- plane/rotation bit packing;
- interaction-id truncation behavior;
- HSL override field widths;
- reserved-word zeroing;
- range checks;
- geometry byte accounting;
- stable geometry batching;
- hidden and not-yet-ready geometry handling.

The test is included in both the normal client test chain and `test:webgpu-foundation`.

## Deferred to the next checkpoints

This checkpoint does **not** change live actor rendering. WebGL2 remains authoritative and the existing player/NPC producers still write their current actor records.

Next work should migrate one producer at a time onto this boundary:

1. adapt player current-pose geometry and per-map instance selection to produce `DynamicActorGeometry` / `DynamicActorInstance`;
2. consume that same player frame description from WebGL2 and an opt-in WebGPU player pass;
3. validate opaque player parity before adding alpha/equipment ordering and interaction picking;
4. repeat the producer/backend cutover for NPCs using `DynamicNpcAnimLoader`'s existing typed current-frame geometry;
5. only after dynamic parity, extend the same approach to projectiles/spot animations and dynamic world-entity content.
