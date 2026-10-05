# WebGPU face-priority ordering

This note tracks the dedicated face-priority checkpoint from `WEBGPU_MIGRATION_CHECKPOINTS.md`.

## Ground truth

The original software model renderer first walks visible faces from far to near. When a model has per-face priorities, that depth walk feeds twelve stable buckets (`0..11`). Priorities `0..9` are then emitted in numeric order, except for the special `10` then `11` stream:

- Before priority `0`, emit special faces while their next depth is greater than the average depth of priorities `1` and `2`.
- Before priority `3`, emit special faces while their next depth is greater than the average depth of priorities `3` and `4`.
- Before priority `5`, emit special faces while their next depth is greater than the average depth of priorities `6` and `8`.
- Emit any remaining priority `10` and `11` faces after priority `9`.

The comparison is strictly `>`. Priority `10` is exhausted before the renderer switches to priority `11`; the two buckets are not merged by depth.

`client/render/priority/FacePrioritySort.ts` is the renderer-neutral CPU reference for those rules. `client/tests/face-priority-sort.test.ts` covers the three thresholds, equal-depth stability, strict threshold equality, the `10 -> 11` handoff, invalid priorities, and the no-priority far-to-near path.

## Packed-vertex limitation

The existing 12-byte vertex format cannot represent exact priorities `0..11`.

`VertexBuffer` compresses them into three bits stored in `packed.z[8:6]`:

- `0..3` remain `0..3`
- `4..5 -> 4`
- `6..7 -> 5`
- `8..9 -> 6`
- `10..11 -> 7`

The rest of `packed.z` is already occupied by position, alpha, the texture-id high bit, and packed-U bits. Expanding priority in place would corrupt the existing vertex ABI and the WebGL2 fallback.

The current WGSL depth nudge therefore remains a temporary compatibility path only. Exact priority sorting must not depend on those three compressed bits.

## Exact-priority sidecar

The renderer preserves exact priority data separately from the packed vertex ABI.

- `ExactFacePrioritySceneBuffer` records one exact `uint8` priority for every emitted model triangle.
- Priority is read from `model.faceRenderPriorities[face.index]` when a per-face array exists, otherwise from the model-wide `model.priority` value.
- The sidecar is aligned directly to the source index stream: triangle priority `n` describes source indices `n * 3 .. n * 3 + 2`.
- A parallel `Uint32Array` stores `[firstIndex, indexCount]` pairs for every emitted model submission.
- Alignment is validated before WebGPU static-loc resources accept the geometry. The spans must cover the complete model-only source index stream exactly once, in emission order.
- Ordinary loc geometry, animated loc frame geometry, independent door geometry, and authoritative ground-item geometry all use the same sidecar contract.
- Worker map payloads transfer loc and door priority arrays explicitly. Ground items carry the arrays through their existing main-thread geometry snapshot.
- Terrain and NPC scene buffers remain on the existing `SceneBuffer` path and are not forced into this model-only sidecar contract.

`client/tests/exact-face-priority-sidecar.test.ts` covers triangle alignment, model-span boundaries, model-wide priority fallback, invalid priorities, incomplete spans, and empty geometry.

## GPU sort-resource foundation

`WebGPUFacePrioritySortResources` owns the GPU-side data needed by the sorter:

- exact priorities expanded to one `u32` storage word per triangle,
- validated model-span metadata,
- the original source-index stream,
- a storage-plus-index sorted-index target,
- a face-depth storage buffer.

The sorted-index target is initialized as an exact copy of the plain source-index stream. This makes the resource safe before compute sorting is activated.

The draw-range resolver maps a draw to the exact contiguous model span or spans it covers. Draws that begin or end inside a model span are rejected so the compute path cannot accidentally sort multiple model submissions as one model.

`WebGPUPlatform` exposes the compute-pipeline and compute-pass interfaces needed by the next stage.

## Live resource integration checkpoint

Status: implemented.

The sort-resource foundation is now attached to live static WebGPU model resources without changing rendered output.

- `WebGPUStaticLocResources` creates `WebGPUFacePrioritySortResources` whenever non-empty exact-priority geometry is uploaded.
- Because doors and ground items inherit the same static-loc resource contract, ordinary locs, doors, and ground items all receive the same priority buffers automatically.
- Every opaque, alpha, full-detail, and LOD draw records its validated `facePrioritySpan` at resource creation.
- Animated loc frame changes refresh the draw's `facePrioritySpan` after the authoritative WebGL animation state changes its index offset/count.
- Hidden zero-count animation slots retain a valid empty span description and can be reactivated by a later frame.
- Static resources now expose an explicit `plain` versus `priority` index-source switch.
- The switch defaults to `plain`, so this checkpoint does not change rendered geometry.
- `drawWebGPUOrderedStaticGeometry` binds the selected index source while leaving delayed-wall submission ordering unchanged.
- The `priority` source resolves to `sortedIndexBuffer`; until compute sorting writes new data, that buffer is still the exact source-index copy.
- Disposal releases the additional priority buffers together with the ordinary static geometry.

`client/tests/webgpu-animated-loc-draws.test.ts` now covers the plain/priority buffer switch, initial draw-span attachment, animated span refresh, hidden zero-count refresh, and preservation of placement/roof metadata.

## Composition with delayed-wall ordering

Face ordering and delayed-wall ordering operate at different levels and remain separate:

- `WebGPUStaticLocDrawOrdering` orders whole static-model submissions relative to neighboring locs/walls.
- Face-priority sorting changes triangle/index order inside one submitted model draw.

A model draw therefore receives its selected index source and still participates in the existing delayed-wall scheduler. The face sorter must not replace or bypass type-1/type-3 delayed-wall ordering.

## Next implementation checkpoint: camera-dependent face depth

The next checkpoint is intentionally limited to depth generation. It should not activate sorted rendering yet.

1. Define the exact renderer-neutral face-depth quantity required by the software painter reference.
2. Compute that depth from packed vertex positions plus the same placed-model/world transform already used by static loc rendering.
3. Add a WGSL compute pipeline that writes one depth value per face into `faceDepthBuffer`.
4. Dispatch only the model spans required by visible draws instead of treating a merged map buffer as one model.
5. Validate GPU-generated depth data against CPU fixtures covering camera translation, model placement, planes, world-entity transforms, and animated frame ranges.
6. Keep the live index source on `plain` for the entire checkpoint.

After depth generation is proven, the following checkpoint will implement the exact 0..11 bucket/threshold sort and write `sortedIndexBuffer`.

## Remaining sorter work

After the depth checkpoint:

1. Implement the 12 stable priority buckets per model.
2. Reproduce the three average-depth thresholds exactly.
3. Preserve the strict `>` comparison.
4. Exhaust priority `10` before priority `11` rather than merging them by depth.
5. Write each model's reordered triangles into its original portion of `sortedIndexBuffer`.
6. Compare GPU output against `createFacePriorityDrawOrder` fixtures.
7. Activate `priority` index selection in the A/B WebGPU renderer only after CPU/GPU agreement is demonstrated.
8. Retain a minimal coplanar depth bias only where required after the painter order itself is correct.

## Completion criteria

The overall face-priority migration is complete only when:

- exact `0..11` priorities survive scene construction without compression,
- live loc/door/ground-item draws have exact model-span mappings,
- animated draws refresh those mappings correctly,
- CPU and GPU depth/sort output agree for validation fixtures,
- priority `10/11` threshold behavior matches the CPU reference,
- opaque/alpha and full-detail/LOD loc paths select the correct sorted index source,
- delayed-wall ordering still operates on the resulting whole-model draws,
- the temporary three-bit face-priority depth nudge is no longer responsible for painter correctness,
- WebGL2 fallback data remains unchanged.

The exact-priority data path, GPU sort-resource foundation, live static-resource integration, draw-span mapping, animated refresh, and inactive index-source switch are implemented. Camera-dependent depth compute, exact GPU sorting, and render-path activation remain pending.
