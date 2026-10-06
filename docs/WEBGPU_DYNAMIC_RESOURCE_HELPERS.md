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
| NPC opaque | yes | yes |
| NPC alpha | yes | yes |
| Attached GFX | yes | yes |
| World GFX | yes | yes |
| Projectile | yes | yes |

K2 is complete. Player, NPC, attached-GFX, world-GFX, and projectile runtimes now use the shared low-level resource helpers. Their geometry caches, shader modules, pipeline states, capture hooks, instance formats/keys, and draw ordering remain category-specific and unchanged.

## Shared signed height-map textures

`WebGPUHeightMapResources` shares the underlying GPU texture by:

- GPU device identity
- source `Int16Array` identity
- height-map size

The first owner performs the `r16sint` texture allocation and upload. Additional owners for the same source acquire the same texture and increment a reference count.

`dispose()` releases one reference. The GPU texture is destroyed only after the last owner releases it.

This is active across existing dynamic comparison runtimes because they construct `WebGPUHeightMapResources` from the same map height source. Category-local bind-group caches reference the same shared texture through `WebGPUDynamicHeightBindGroupCache`.

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

## NPC adoption

`WebGPUNpcOpaqueRuntime` and `WebGPUNpcAlphaRuntime` now use the same two shared helpers for height bind groups and instance vertex buffers.

The migration removes the NPC-local `HeightGpuResources` and `InstanceGpuResources` maps while preserving:

- current-pose geometry from `DynamicNpcAnimLoader`
- action/movement/layered sequence selection
- varbit/varp morph resolution
- authoritative actor-record conversion
- unbatched NPC coverage
- world-view transforms and deck-height handling
- opaque front-to-back batching
- transparent back-to-front sequential ordering
- cull variants
- alpha blend/depth behavior
- registry order

Geometry cache ownership remains separate between opaque and alpha NPC paths.

## Attached GFX adoption

`WebGPUAttachedGfxRuntime` now uses the shared height bind-group and growable instance-buffer helpers for both its opaque and alpha submissions.

The migration removes the attached-GFX-local `HeightGpuResources` and `InstanceGpuResources` maps while preserving:

- the `(spotId, frame, pass)` geometry cache
- exact authoritative `lastSoundFrame` reuse
- first-seen `(spotId, frame)` grouping
- first-seen Y-offset grouping inside each spot/frame group
- original attachment order within each Y-offset group
- player/NPC parent actor placement and HSL inheritance
- negative offset-anchor model-Y normalization
- identity world transform behavior used by the current WebGL GFX path
- opaque and alpha pipeline state
- NPC-attached versus player-attached transparent ordering
- existing instance-buffer keys

## World GFX adoption

`WebGPUWorldGfxRuntime` now uses the shared height bind-group and growable instance-buffer helpers for both opaque and alpha world-tile effects.

The migration removes the world-GFX-local `HeightGpuResources` and `InstanceGpuResources` maps while preserving:

- the independent world placement snapshot instead of fake actor identity
- authoritative `worldGfxDataTextureOffsets` record decoding
- exact `lastSoundFrame` reuse
- the `(spotId, frame, pass)` geometry cache
- first-seen `(spotId, frame)` and Y-offset grouping
- front-to-back opaque visible-map traversal
- back-to-front alpha visible-map traversal
- bridge-aware plane and height offset placement
- identity world transform packing
- opaque and alpha pipeline state
- existing per-instance buffer keys
- world-GFX phase ordering between attached GFX and projectiles

World GFX remains a semantically separate runtime from actor-attached GFX even though both now share the same low-level allocation helpers.

## Projectile adoption

`WebGPUProjectileRuntime` now uses the shared height bind-group and growable instance-buffer helpers for opaque and alpha projectile submissions.

The migration removes the projectile-local `HeightGpuResources` and `InstanceGpuResources` maps while preserving:

- the projectile-specific 48-byte instance ABI (`12 * float32`)
- authoritative signed local position and quantized yaw/pitch/roll decoding
- fractional sub-tile X/Y placement
- renderer-owned ground-relative model Y offset resolution
- current map membership from `ProjectileManager`
- `(spotId, frame, pass)` geometry caching
- front-to-back opaque and back-to-front alpha map traversal
- cull/no-cull pipeline selection from `cullBackFace`
- opaque depth writes enabled
- projectile-alpha depth writes disabled
- projectile phase ordering after GFX
- existing instance-buffer keys based on pass/map/geometry/debug ID

The shared growable buffer helper stores the packed projectile data without changing its 48-byte layout or interpreting projectile fields.

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
- every migrated dynamic runtime imports/uses the shared helper classes
- old local height/instance resource maps are absent from every migrated runtime
- the projectile-specific 48-byte instance ABI remains intact
- projectile alpha still has depth writes disabled

Both tests are already part of `test:webgpu-foundation`, so no package-script change is required.

## Next step

Run one final post-K2 consolidation audit across all migrated dynamic runtimes. The audit should confirm no residual duplicate height/instance allocation code remains and decide the next rendering milestone without changing renderer behavior.
