# WebGPU Combined Picking

Checkpoint M3 combines the existing static WebGPU picker and the M2 player/NPC picker into one comparison-only GPU depth contest.

CPU `SceneRaycaster`, menu construction, hover selection, click handling, and interaction highlights remain authoritative. M3 does not change gameplay interaction behavior.

## Scope

M3 implements:

- one shared `rgba32uint` pick target for static and dynamic interaction geometry
- one shared `depth24plus` target
- static terrain/loc/ground-item/door picking
- player/NPC opaque and alpha picking
- renderer-order arbitration between static and actor geometry
- collision-free static-versus-dynamic payload namespacing
- one-pixel scissor and asynchronous readback
- newest-request-wins request coalescing
- comparison-mode request API and cleanup

M3 deliberately excludes:

- attached GFX
- world GFX
- projectiles
- live menu/hover integration
- live highlight integration
- replacing CPU raycasting
- full WebGPU renderer cutover

## Why a shared depth pass is required

M2 rendered actors into an actor-only depth target. That was sufficient to verify player/NPC identity and silhouette parity, but it could return an actor hidden behind a wall because static geometry never participated in the same depth test.

Comparing the independent static and dynamic readbacks on the CPU would not fix that reliably. Neither result carries a directly comparable canonical depth value, and attempting to reproduce clip/depth ordering on the CPU would duplicate renderer behavior.

M3 instead renders both interaction domains into the same GPU pass and the same depth attachment. The final color payload is therefore the fragment that survives the actual WebGPU `less-equal` depth test at the requested pixel.

## Shared payload namespace

Static picking already uses:

1. interaction id
2. map id
3. `InteractType`
4. encoded tile + 1 hit sentinel

Dynamic picking already uses:

1. interaction id
2. map id
3. player/NPC kind code
4. hit sentinel

The numeric domains collide:

- `InteractType.LOC = 1`
- `InteractType.OBJ = 2`
- dynamic player kind = `1`
- dynamic NPC kind = `2`

M3 keeps the established static and standalone-dynamic contracts unchanged.

Only the M3 dynamic shader variant sets bit 31 of word 2:

```text
0x80000000 | dynamicKind
```

So:

- untagged word 2 remains the static `InteractType` namespace
- tagged word 2 is dynamic
- low 31 bits retain the existing player/NPC kind code

This avoids a new actor ABI and avoids breaking M1/M2 decoders.

## Shader behavior

`patchWebGPUDynamicActorShaderForCombinedPicking()` derives from the existing M1/M2 pick shader patch.

It preserves the same actor vertex path and alpha/fog rejection, but exposes a separate fragment entry point:

- `fsDynamicCombinedPick`

The standalone M2 entry point remains:

- `fsDynamicPick`

The normal player/NPC color fragments are untouched.

Static geometry continues to use the audited static `fsPick` fragment from `patchWebGPUStaticSceneShaderForWorldEntities()`.

## Arbitration order

The combined pass preserves the interaction-relevant renderer boundary:

1. static opaque
2. NPC opaque
3. player opaque
4. static alpha
5. NPC alpha
6. player alpha

This is implemented as:

```text
static opaque
actor opaque registry replay
static transparent
actor transparent registry replay
```

Within the actor phases, the existing registry handlers continue to provide the exact prepared geometry, instance buffers, map/height bind groups, world-entity transforms, culling choices, and current animation pose.

Static traversal preserves:

- visible-map ordering
- reverse transparent map traversal
- LOD selection
- roof-plane filtering
- static cull/no-cull selection
- ordered loc/door/ground-item drawing

## Why GFX and projectiles do not participate in M3 depth

The excluded effect phases can write depth in normal visual rendering, but they are not authoritative interaction surfaces.

Allowing them to participate only as invisible depth blockers would create a new interaction rule where a non-pickable visual effect could make an otherwise pickable actor or loc disappear from the pick result.

M3 therefore arbitrates only geometry that currently represents an interaction candidate:

- static scene interaction geometry
- players
- NPCs

Effect picking/occlusion remains a separate parity question.

## Player and NPC identity timing

`SceneFrameDescription` is mutable and reused every frame.

As established in M2, a queued pick must not freeze actor identity when the API call is first made. A request can wait behind shader initialization or an earlier GPU readback while the shared frame object advances.

M3 captures the player/NPC identity map at the GPU submission boundary, immediately before scene uniforms and command recording.

That snapshot survives the asynchronous `mapAsync` readback and resolves:

- player `(mapId, 0x8000 + slot)` to actor/server id
- NPC server interaction id to actor/server id

## Cull and alpha parity

The actor pass proxy preserves source culling behavior:

- opaque player cull/no-cull, including double-sided variants
- transparent player always no-cull
- NPC opaque/alpha cull/no-cull

All combined pipelines use:

- `depthWriteEnabled: true`
- `depthCompare: less-equal`

Static and dynamic pick fragments retain the existing texture alpha cutoff and full-fog rejection contracts.

## Readback behavior

The controller allocates full-canvas comparison attachments but scissors fragment work to one requested pixel.

The final pixel is copied to a 256-byte-row-aligned staging buffer and decoded after `mapAsync` completes.

Only one readback is active at a time. If more requests arrive:

- at most one pending request is retained
- an older queued request resolves `undefined`
- the newest request runs after the current readback completes

## Comparison API

`requestWebGPUTerrainCombinedPick(host, canvasX, canvasY)` is exposed by `WebGPUTerrainComparison` only while comparison mode is active and ready.

It lazily creates `WebGPUCombinedPickingController` and returns either:

```ts
{ source: "static", result: WebGPUStaticPickResult }
```

or:

```ts
{ source: "dynamic", result: WebGPUDynamicResolvedPickResult }
```

or `undefined` when nothing interaction-relevant survives the depth test.

The controller is disposed before the comparison renderer/backend is destroyed.

The existing M2 actor-only request remains available independently for diagnostics.

## Validation

`webgpu-combined-picking.test.ts` locks:

- the `0x80000000` dynamic namespace tag
- static LOC/OBJ values `1/2` remaining unambiguously static
- tagged player/NPC decoding
- player slot and NPC server-id resolution
- standalone M2 shader remaining untagged
- dedicated combined shader entry point
- one shared integer target and depth target
- `less-equal` depth semantics
- one-pixel scissor/readback
- exact static-opaque -> actor-opaque -> static-alpha -> actor-alpha boundary
- NPC-before-player ordering inside actor phases
- exclusion of GFX/projectile phases
- GPU-submission-boundary identity snapshot timing
- newest-request-wins behavior
- comparison-only API exposure and disposal

The test is wired into both the normal client test chain and `test:webgpu-foundation`.

## Remaining work

M3 removes the largest correctness gap in GPU interaction comparison: static geometry can now occlude players/NPCs in the same depth test.

Before any live interaction cutover, the next checkpoint should focus on parity instrumentation and decision policy rather than immediately replacing CPU raycasting. Useful next work includes:

- compare combined GPU results against CPU `SceneRaycaster` at the same cursor point
- classify mismatches by static/dynamic type, map, tile, and actor identity
- distinguish expected CPU broad-hit behavior from true GPU silhouette regressions
- verify equal-depth and world-entity edge cases in-browser
- decide whether interaction highlights should consume GPU identity or remain CPU-derived

Until those comparisons are available, CPU interaction remains authoritative.
