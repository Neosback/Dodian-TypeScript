# WebGPU Dynamic Resource Helpers

This checkpoint begins the post-registry resource consolidation for the dynamic WebGPU comparison renderer.

The goal is to remove repeated low-level allocation mechanics without merging renderer-specific geometry ownership, animation state, ordering, or pipeline behavior.

## Scope

This resource consolidation is intentionally staged so each renderer can be diff-audited independently.

### K1: helper foundation and shared height texture backing

Implemented:

- ref-counted sharing of signed `r16sint` height-map textures
- growable keyed instance-buffer helper
- signed height-map bind-group cache helper
- allocation/reuse/replacement/release diagnostics
- regression tests for lifetime and growth behavior

### K2: runtime adoption

Current adoption matrix:

| Runtime | Shared height bind-group cache | Shared growable instance buffer |
| --- | --- | --- |
| Player opaque | yes | yes |
| Player alpha | yes | yes |
| NPC opaque | pending | pending |
| NPC alpha | pending | pending |
| Attached GFX | pending | pending |
| World GFX | pending | pending |
| Projectile | pending | pending |

The player opaque/alpha migration is complete. Their geometry caches, shader modules, pipeline states, capture hooks, instance keys, and draw ordering remain unchanged.

The remaining K2 work should continue one category at a time, with a diff audit after each pair/path.

## Shared signed height-map textures

`WebGPUHeightMapResources` shares the underlying GPU texture by:

- GPU device identity
- source `Int16Array` identity
- height-map size

The first owner performs the `r16sint` texture allocation and upload. Additional owners for the same source acquire the same texture and increment a reference count.

`dispose()` releases one reference. The GPU texture is destroyed only after the last owner releases it.

This is active across existing dynamic comparison runtimes because they construct `WebGPUHeightMapResources` from the same map height source. As category-local bind-group caches are replaced during K2, they continue to reference the same shared texture through `WebGPUDynamicHeightBindGroupCache`.

Diagnostics are exposed through:

- `getWebGPUHeightMapSharingDiagnostics(device)`

Counters:

- `allocations`
- `reuses`
- `releases`
- `destroys`

## Growable instance-buffer helper

`WebGPUGrowableBufferCache` centralizes the repeated dynamic instance-buffer policy:

1. key buffers by renderer-defined identity
2. align capacity to four bytes
3. reuse a buffer when capacity is sufficient
4. when growth is required, allocate `max(required, previousCapacity * 2)`
5. destroy the superseded buffer
6. upload the current instance data through `queue.writeBuffer`
7. destroy all live buffers on cache disposal

The helper intentionally does not define instance keys or packed data formats. Player/NPC/GFX/projectile code keeps those policies.

Diagnostics:

- allocations
- reuses
- grows
- writes
- destroys
- bytes uploaded
- live buffer count
- live capacity

## Height bind-group helper

`WebGPUDynamicHeightBindGroupCache` centralizes the second repeated pattern:

- one entry per runtime-defined map key
- reuse when source identity and size are unchanged
- replace and release when source or size changes
- create the standard four-layer signed height-map texture view
- create the runtime-layout-compatible bind group
- dispose all entries during runtime teardown

The underlying `WebGPUHeightMapResources` texture is shared globally, so separate runtime bind-group caches can safely reference the same uploaded texture while retaining their own bind-group-layout identity.

Diagnostics:

- allocations
- reuses
- replacements
- releases
- live entries

## Player adoption

`WebGPUPlayerOpaqueRuntime` and `WebGPUPlayerAlphaRuntime` now use:

- `WebGPUDynamicHeightBindGroupCache` for per-map signed height bind groups
- `WebGPUGrowableBufferCache` for keyed instance vertex buffers

The migration removes each player's duplicate `HeightGpuResources` and `InstanceGpuResources` maps and delegates their previous allocation/reuse/disposal mechanics to the shared helpers.

The following remain local and unchanged:

- opaque and alpha player geometry caches
- appearance/animation pose resolution
- world-view transform packing
- first-person double-sided selection
- alpha blend/depth behavior
- capture timing
- registry order

## What remains category-specific

This checkpoint does not merge:

- player geometry caches
- NPC pose geometry caches
- GFX `(spotId, frame, pass)` geometry caches
- projectile geometry or 48-byte instance ABI
- shader modules
- pipeline variants
- alpha ordering
- world-view transforms
- capture hooks
- dynamic picking

Those differences are semantic rather than allocation boilerplate and should remain explicit.

## Validation

`webgpu-height-map.test.ts` verifies:

- two owners of the same source share one texture
- the texture is uploaded once
- releasing one owner does not destroy the texture
- releasing the last owner does destroy it
- allocation/reuse/release diagnostics

`webgpu-dynamic-parity-audit.test.ts` verifies:

- growable buffer reuse
- growth and superseded-buffer destruction
- upload byte accounting
- final disposal
- height bind-group reuse for stable source identity
- replacement when source identity changes
- release diagnostics
- player opaque and alpha both import/use the shared helper classes
- the old player-local height/instance resource maps are absent

Both tests are already part of `test:webgpu-foundation`, so no package-script change is required.

## Next step

Continue K2 with NPC opaque and alpha, preserving their current-pose geometry ownership and all shader/pipeline behavior. After the NPC pair is audited, migrate attached GFX, world GFX, and projectiles in separate small steps.
