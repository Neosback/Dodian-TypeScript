# WebGPU Dynamic Renderer Parity Audit

This checkpoint audits the dynamic WebGPU comparison renderer after players, NPCs, attached/world GFX, and projectiles were brought into the A/B path.

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

Before this checkpoint, `client/ui/Canvas.tsx` imported and installed every dynamic comparison module directly. Correct order therefore depended on the exact order of unrelated UI-level calls.

`client/render/webgpu/dynamic/WebGPUDynamicComparisonLifecycle.ts` is now the single installation/cleanup entry point.

It exports canonical manifests:

- `WEBGPU_DYNAMIC_OPAQUE_PHASE_ORDER`
- `WEBGPU_DYNAMIC_TRANSPARENT_PHASE_ORDER`

and installs every comparison/capture boundary from one location.

Cleanup runs in reverse installation order.

`Canvas.tsx` now owns one restore callback for the complete dynamic comparison lifecycle.

## Phase implementation audit

The dynamic renderer currently has two implementation styles.

| Category | Opaque | Transparent | State |
| --- | --- | --- | --- |
| NPC | ordered phase registry | ordered phase registry | registry-backed |
| Player | prototype boundary | prototype boundary | wrapper-backed |
| Attached GFX | prototype boundary | split prototype boundaries | wrapper-backed |
| World GFX | prototype boundary | prototype boundary | wrapper-backed |
| Projectile | prototype boundary | prototype boundary | wrapper-backed |

The lifecycle consolidation removes UI-level ordering drift, but it does **not** falsely claim these implementations are already one internal draw graph.

A later mechanical refactor should migrate the wrapper-backed categories onto the existing ordered phase registries once their capture/runtime boundaries can be moved without changing output.

## Diagnostics added

Both ordered actor phase registries now retain current-frame invocation diagnostics:

- frame token
- ordered handler IDs invoked for that frame

APIs:

- `getWebGPUOpaqueActorPhaseDiagnostics()`
- `getWebGPUTransparentActorPhaseDiagnostics()`

The centralized lifecycle also exposes installation diagnostics through:

- `getWebGPUDynamicComparisonDiagnostics()`

That reports the canonical opaque/transparent manifests plus the exact comparison install steps used for the renderer.

These are intentionally lightweight diagnostics. They do not add production telemetry or alter rendering decisions.

## Resource duplication audit

The player, NPC, GFX, world-GFX, and projectile comparison runtimes all contain superficially similar GPU resource code:

- packed geometry vertex/index buffers
- signed height-map resources and bind groups
- reusable instance vertex buffers
- aligned buffer sizing
- map-key helpers

The audit found that only the lowest-level mechanics are identical. The ownership/invalidation rules are not yet identical enough for one monolithic cache.

### Player/NPC

Player and NPC resources are keyed around current-pose actor geometry and map snapshots. A geometry entry can carry opaque and alpha faces for the same resolved pose. World-view actor transforms are resolved during instance packing.

### Attached/world GFX

GFX resources are keyed around `(spotId, frame, pass)` style reuse and preserve WebGL spot/frame/Y-offset ordering. Attached GFX inherit actor placement while world GFX use an independent placement snapshot.

### Projectile

Projectile geometry also comes from the spot cache, but the instance ABI is distinct and includes quantized yaw/pitch/roll, fractional sub-tile placement, and a ground-relative vertical offset. Transparent projectiles additionally disable depth writes.

## Consolidation decision

This checkpoint intentionally does **not** merge those caches behind one generic `DynamicResourceCache`.

Doing so now would hide different invalidation and ordering semantics behind a shared abstraction and make parity bugs harder to see.

The safe consolidation order is:

1. finish moving all dynamic draw phases onto one ordered registry
2. add per-category draw/skip counters at that registry boundary
3. extract shared aligned-buffer and signed-height-map resource helpers
4. keep geometry cache policy supplied by each category
5. only then evaluate whether geometry resources can share a common owner

## Regression coverage

`client/tests/webgpu-dynamic-parity-audit.test.ts` locks:

- Canvas using one dynamic lifecycle installer
- canonical opaque order
- canonical transparent order
- lifecycle install order
- reverse cleanup order
- phase registry frame diagnostics
- disposal clearing diagnostics

The test is included in both the normal client suite and `test:webgpu-foundation`.

## Remaining dynamic parity risks

1. Player/GFX/world-GFX/projectile draws still use nested prototype wrappers internally.
2. Registry diagnostics currently describe registry-backed handlers; wrapper-backed categories expose installation order but not per-draw counters yet.
3. Exact map-by-map interleaving remains coarser in parts of the comparison renderer than the live WebGL renderer.
4. Dynamic picking/highlights have not been migrated.
5. The live client still renders through WebGL2; WebGPU remains an opt-in comparison path.
6. Browser/GPU A/B validation is still required before a backend cutover.

## Recommended next checkpoint

The next checkpoint should be a mechanical **dynamic phase registry cutover**:

- move player opaque/alpha into the existing ordered registries
- move attached GFX into explicit opaque/NPC-alpha/player-alpha handlers
- move world GFX into explicit ordered handlers
- move projectiles into final opaque/transparent handlers
- add per-category attempted/drawn/skipped counters
- leave capture hooks unchanged

That checkpoint should avoid shader, geometry, animation, or pipeline-state changes. Once the phase graph is genuinely unified, low-level resource helper extraction becomes much safer.
