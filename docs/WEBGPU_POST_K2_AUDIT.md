# WebGPU Post-K2 Consolidation Audit

Checkpoint L audits the dynamic WebGPU comparison renderer after the K1/K2 resource-helper rollout.

## Result

The low-level dynamic resource consolidation is complete for all migrated dynamic categories:

- player opaque
- player alpha
- NPC opaque
- NPC alpha
- actor-attached GFX
- world-tile GFX
- projectiles

Every runtime now delegates signed height-map bind-group lifetime to `WebGPUDynamicHeightBindGroupCache` and keyed instance-buffer growth/reuse to `WebGPUGrowableBufferCache`.

No migrated runtime retains its former local `HeightGpuResources` or `InstanceGpuResources` map, and no migrated runtime directly imports `WebGPUHeightMapResources` or `WEBGPU_HEIGHT_MAP_LAYERS`.

## Height-map lifetime

The height path has two ownership layers:

1. `WebGPUDynamicHeightBindGroupCache` owns one bind-group entry per runtime-defined map key.
2. `WebGPUHeightMapResources` shares the underlying `r16sint` texture globally by GPU device, source `Int16Array` identity, and height-map size.

Replacing a runtime bind-group entry releases one height-map owner. Destroying a runtime releases every remaining owner. The GPU texture is destroyed only when the final owner releases it.

`WebGPUHeightMapResources.dispose()` is idempotent, so an owner cannot release the same shared backing twice.

## Instance-buffer lifetime

All seven dynamic runtimes use `WebGPUGrowableBufferCache`.

The helper preserves the previous policy:

- four-byte aligned capacity
- reuse while capacity is sufficient
- grow to `max(required, previousCapacity * 2)`
- destroy the superseded buffer on growth
- upload through `queue.writeBuffer`
- destroy all remaining buffers on runtime disposal

Renderer-defined instance keys and data layouts remain local. In particular, projectiles keep their separate 12-float / 48-byte ABI.

## Geometry remains category-specific

The audit confirms geometry should not be folded into the generic resource helper.

The following remain intentionally separate:

- player pose/appearance geometry
- NPC current-pose geometry and morph/animation state
- GFX `(spotId, frame, pass)` geometry
- projectile spot-frame geometry

Those caches have different invalidation and ordering semantics even though their GPU allocation mechanics look superficially similar.

## Browser A/B diagnostics

Checkpoint L adds `getWebGPUDynamicResourceDiagnostics(device)`.

It returns a device-level snapshot containing:

- live instance-buffer caches aggregated by runtime label
- allocation/reuse/grow/write/destroy counts
- uploaded bytes
- live buffer count and capacity
- live height bind-group caches aggregated by runtime label
- height bind-group allocation/reuse/replacement/release counts
- cumulative shared height-texture allocation/reuse/release/destroy counts

Disposed caches unregister from the live snapshot, while shared height-texture counters remain cumulative for the device lifetime.

This complements the existing opaque/transparent phase diagnostics, which already report attempted/drawn/skipped phase invocations and draw-call totals.

## Regression coverage

`webgpu-dynamic-parity-audit.test.ts` now checks:

- all seven dynamic runtimes use both shared helper classes
- no migrated runtime retains the old local height/instance maps
- no migrated runtime directly owns `WebGPUHeightMapResources`
- projectile 48-byte instance ABI remains unchanged
- projectile alpha depth writes remain disabled
- grow/reuse/destroy behavior
- live device-level resource diagnostics
- disposed caches disappear from the live diagnostic snapshot
- cumulative shared-height-texture counters remain correct after disposal

The test is already part of the existing WebGPU foundation test command, so no package-script change is required.

## Remaining renderer gaps

This audit does not identify another low-level resource-consolidation task that should block feature work.

The important remaining architectural gaps are now functional rather than allocation-related:

1. dynamic picking and interaction/highlight parity for players, NPCs, GFX, and projectiles
2. controlled transition from comparison rendering to a real live WebGPU scene path
3. 2D/UI/minimap/overlay migration required before WebGPU can fully replace the current WebGL client renderer

## Recommended next checkpoint

The next checkpoint should be **dynamic picking/highlight parity**, not further cache abstraction.

Static WebGPU picking already exists, while dynamic categories still rely on the authoritative CPU/WebGL interaction path. Extending the picking sidecar to the dynamic draw snapshots gives a contained, testable parity milestone before beginning the live WebGPU cutover.
