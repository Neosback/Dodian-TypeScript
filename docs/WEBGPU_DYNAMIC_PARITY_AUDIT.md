# WebGPU Dynamic Renderer Parity Audit

This document tracks the dynamic WebGPU comparison renderer after players, NPCs, attached/world GFX, and projectiles were brought into the A/B path.

The goal is to reduce order/lifecycle fragility without changing rendering output or moving the live client away from WebGL2.

## Authoritative WebGL dynamic order

The current WebGL renderer provides the reference behavior.

### Opaque

1. static terrain/scenery
2. NPCs
3. players
4. attached player/NPC GFX
5. world-tile GFX
6. projectiles

Opaque maps traverse front-to-back.

### Transparent

1. static terrain/scenery
2. NPCs
3. NPC-attached GFX
4. world-tile GFX
5. players
6. player-attached GFX
7. projectiles

Transparent actor/effect map traversal is back-to-front where the WebGL renderer uses a dedicated transparent map loop.

## Lifecycle consolidation

`client/render/webgpu/dynamic/WebGPUDynamicComparisonLifecycle.ts` is the single installation/cleanup entry point.

It exports canonical manifests:

- `WEBGPU_DYNAMIC_OPAQUE_PHASE_ORDER`
- `WEBGPU_DYNAMIC_TRANSPARENT_PHASE_ORDER`

and installs every comparison/capture boundary from one location.

Cleanup runs in reverse installation order.

`Canvas.tsx` owns one restore callback for the complete dynamic comparison lifecycle.

The lifecycle is gated by the existing `webgpuTerrain` comparison query, so normal WebGL startup does not install the dynamic comparison phase graph.

## Phase implementation audit

Checkpoint J completes the dynamic phase registry cutover.

| Category | Opaque | Transparent | Runtime phase owner |
| --- | --- | --- | --- |
| NPC | ordered phase registry | ordered phase registry | registry |
| Player | ordered phase registry | ordered phase registry | registry |
| Attached GFX | ordered phase registry | ordered NPC/player attachment phases | registry |
| World GFX | ordered phase registry | ordered phase registry | registry |
| Projectile | ordered phase registry | ordered phase registry | registry |

The large player/GFX/projectile modules still contain their previously audited wrapper closures internally. They are no longer left installed on `WebGPUStaticSceneRenderer.prototype`.

During the first comparison installation, each historical wrapper is installed once against a no-op predecessor, captured as the category implementation, and the prototype is immediately restored to the registry-owned method. The captured closure is then registered under an explicit phase ID/order.

This transitional extraction preserves the exact existing runtime behavior while making the registries the sole owners of dynamic execution order and disposal.

Capture hooks remain unchanged and continue to observe authoritative WebGL state.

## Diagnostics

Both ordered actor phase registries expose:

- frame token
- ordered handler IDs invoked for the frame
- per-category current-frame counters
- per-category cumulative counters for the renderer lifetime

Counter semantics:

- `attempted`: frames in which the category phase was invoked
- `drawn`: attempted frames that emitted at least one GPU draw
- `skipped`: attempted frames that emitted no GPU draw
- `drawCalls`: total `draw()` / `drawIndexed()` submissions

These are phase-submission counters, not entity counters. A batched player draw containing multiple actor instances counts as one GPU draw call.

APIs:

- `getWebGPUOpaqueActorPhaseDiagnostics()`
- `getWebGPUTransparentActorPhaseDiagnostics()`
- `getWebGPUDynamicComparisonDiagnostics()`

The pass encoder is observed through a comparison-only proxy that binds property access and method calls back to the native encoder target so WebGPU brand checks remain valid.

## Resource duplication audit

The player, NPC, GFX, world-GFX, and projectile comparison runtimes all contain superficially similar GPU resource code:

- packed geometry vertex/index buffers
- signed height-map resources and bind groups
- reusable instance vertex buffers
- aligned buffer sizing
- map-key helpers

Only the lowest-level mechanics are identical. The ownership/invalidation rules are not identical enough for one monolithic cache.

### Player/NPC

Player and NPC resources are keyed around current-pose actor geometry and map snapshots. A geometry entry can carry opaque and alpha faces for the same resolved pose. World-view actor transforms are resolved during instance packing.

### Attached/world GFX

GFX resources are keyed around `(spotId, frame, pass)` style reuse and preserve WebGL spot/frame/Y-offset ordering. Attached GFX inherit actor placement while world GFX use an independent placement snapshot.

### Projectile

Projectile geometry also comes from the spot cache, but the instance ABI is distinct and includes quantized yaw/pitch/roll, fractional sub-tile placement, and a ground-relative vertical offset. Transparent projectiles additionally disable depth writes.

## Consolidation decision

The phase graph is now unified, so low-level resource extraction is safer.

The recommended consolidation order is now:

1. extract shared aligned-buffer allocation helpers
2. extract the identical signed-height-map resource/bind-group cache mechanics
3. keep geometry cache policy supplied by each category
4. preserve the projectile-specific instance ABI
5. evaluate geometry resource sharing only after browser/GPU parity validation

A generic `DynamicResourceCache` is still not recommended because it would obscure category-specific invalidation and ordering semantics.

## Regression coverage

`client/tests/webgpu-dynamic-parity-audit.test.ts` locks:

- Canvas using one dynamic lifecycle installer
- comparison opt-in gating
- canonical opaque order
- canonical transparent order
- no-op extraction of legacy boundaries
- restoration of registry-owned prototype methods
- explicit numeric registry order for every migrated dynamic category
- reverse cleanup order
- per-category phase diagnostics
- attempted/drawn/skipped/draw-call counter behavior
- disposal clearing diagnostics and cumulative totals

The test remains included in both the normal client suite and `test:webgpu-foundation`.

## Remaining dynamic parity risks

1. Historical wrapper closures are retained as transitional category implementations behind the registries. They should eventually become ordinary exported phase functions once the comparison path is stable enough for that source cleanup.
2. Exact map-by-map interleaving remains coarser in parts of the comparison renderer than the live WebGL renderer.
3. Dynamic picking/highlights have not been migrated.
4. The live client still renders through WebGL2; WebGPU remains an opt-in comparison path.
5. Browser/GPU A/B validation is still required before a backend cutover.
6. Dynamic runtimes still duplicate signed-height-map and growable instance-buffer mechanics.

## Recommended next checkpoint

The next checkpoint should be a behavior-preserving **dynamic resource helper extraction**:

- centralize aligned growable instance-buffer allocation
- centralize signed height-map texture/bind-group caching
- retain category-owned geometry caches and keys
- retain all existing phase/capture order
- add allocation/reuse diagnostics where useful

Dynamic picking/highlights or live WebGPU activation should remain separate from that resource-only refactor.
