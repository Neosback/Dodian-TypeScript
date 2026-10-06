# WebGPU Dynamic Resource Helpers

This checkpoint begins the post-registry resource consolidation for the dynamic WebGPU comparison renderer.

The goal is to remove repeated low-level allocation mechanics without merging renderer-specific geometry ownership, animation state, ordering, or pipeline behavior.

## Scope

This checkpoint deliberately separates the resource work into two stages.

### K1: helper foundation and shared height texture backing

Implemented here:

- ref-counted sharing of signed `r16sint` height-map textures
- growable keyed instance-buffer helper
- signed height-map bind-group cache helper
- allocation/reuse/replacement/release diagnostics
- regression tests for lifetime and growth behavior

### K2: runtime adoption

Deferred to the next small checkpoint:

- replace player opaque/alpha local instance-buffer maps with `WebGPUGrowableBufferCache`
- replace NPC opaque/alpha local instance-buffer maps with the helper
- replace attached/world GFX local instance-buffer maps with the helper
- replace projectile local instance-buffer maps with the helper
- replace each runtime's local height-map/bind-group map with `WebGPUDynamicHeightBindGroupCache`

Doing this one runtime at a time keeps the migration easy to audit and avoids changing seven large renderer modules in one commit stack.

## Shared signed height-map textures

`WebGPUHeightMapResources` now shares the underlying GPU texture by:

- GPU device identity
- source `Int16Array` identity
- height-map size

The first owner performs the `r16sint` texture allocation and upload. Additional owners for the same source acquire the same texture and increment a reference count.

`dispose()` releases one reference. The GPU texture is destroyed only after the last owner releases it.

This is already active for existing dynamic comparison runtimes because they all construct `WebGPUHeightMapResources` from the same map height source. Their existing category-local bind groups remain valid while the expensive texture allocation/upload is deduplicated underneath them.

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

The underlying `WebGPUHeightMapResources` texture is already shared globally, so separate runtime bind-group caches can safely reference the same uploaded texture while retaining their own bind-group-layout identity.

Diagnostics:

- allocations
- reuses
- replacements
- releases
- live entries

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

`webgpu-height-map.test.ts` now verifies:

- two owners of the same source share one texture
- the texture is uploaded once
- releasing one owner does not destroy the texture
- releasing the last owner does destroy it
- allocation/reuse/release diagnostics

`webgpu-dynamic-parity-audit.test.ts` now verifies:

- growable buffer reuse
- growth and superseded-buffer destruction
- upload byte accounting
- final disposal
- height bind-group reuse for stable source identity
- replacement when source identity changes
- release diagnostics

Both tests were already part of `test:webgpu-foundation`, so no package-script change is required.

## Next step

K2 should adopt these helpers in the dynamic runtimes one category at a time, with a diff audit after each category. Geometry cache ownership must remain local throughout that migration.
