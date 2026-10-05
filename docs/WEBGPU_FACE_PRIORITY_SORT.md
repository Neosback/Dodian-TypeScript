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

## Current packed-vertex limitation

The existing 12-byte vertex format cannot represent exact priorities `0..11`.

`VertexBuffer` currently compresses them into three bits stored in `packed.z[8:6]`:

- `0..3` remain `0..3`
- `4..5 -> 4`
- `6..7 -> 5`
- `8..9 -> 6`
- `10..11 -> 7`

The rest of `packed.z` is already occupied by position, alpha, the texture-id high bit, and packed-U bits. Expanding priority in place would corrupt the existing vertex ABI and the WebGL2 fallback.

The current WGSL depth nudge therefore remains a temporary compatibility path only. Exact priority sorting must not depend on those three compressed bits.

## Exact-priority sidecar checkpoint

The renderer now preserves exact priority data separately from the packed vertex ABI.

- `ExactFacePrioritySceneBuffer` records one exact `uint8` priority for every emitted model triangle.
- Priority is read from `model.faceRenderPriorities[face.index]` when a per-face array exists, otherwise from the model-wide `model.priority` value. This keeps the sidecar authoritative without changing the legacy packed-vertex path.
- The sidecar is aligned directly to the source index stream: triangle priority `n` describes source indices `n * 3 .. n * 3 + 2`.
- A parallel `Uint32Array` stores `[firstIndex, indexCount]` pairs for every emitted model submission. These spans preserve model-local sort boundaries even when later draw-command construction merges several baked locs into one draw range.
- Alignment is validated before WebGPU static-loc resources accept the geometry. The spans must cover the complete model-only source index stream exactly once, in emission order.
- Ordinary loc geometry, animated loc frame geometry, independent door geometry, and authoritative ground-item geometry all use the same sidecar contract.
- Worker map payloads transfer loc and door priority arrays explicitly. Ground items carry the arrays through their existing main-thread geometry snapshot.
- `WebGPUStaticLocResources` currently retains the sidecar and model spans on the CPU only.
- Terrain and NPC scene buffers remain on the existing `SceneBuffer` path and are not forced into this model-only sidecar contract.

`client/tests/exact-face-priority-sidecar.test.ts` covers triangle alignment, model-span boundaries, model-wide priority fallback, invalid priorities, incomplete spans, and empty geometry. Door and ground-item adapter tests also verify that the sidecar is forwarded without reconstruction.

## GPU sort-resource foundation checkpoint

The first isolated WebGPU sort-resource layer is now implemented without changing the live render path.

- `WebGPUFacePrioritySortResources` expands the exact `uint8` CPU priorities to one `u32` storage word per triangle for straightforward WGSL storage access. The CPU payload remains the compact byte sidecar.
- Model spans are validated once more at the GPU-resource boundary and converted into explicit `firstIndex/indexCount/firstFace/faceCount` records for CPU scheduling.
- A pure draw-range resolver maps a draw to the exact contiguous model span or spans it covers. It rejects draws that start or end inside a model span, preventing a later compute pass from accidentally sorting two models as one.
- Zero-count animation slots resolve to an empty span range and can be rebound when the authoritative animation frame changes.
- The resource layer allocates separate WebGPU storage for priorities, source indices, model-span words, and face depths.
- It also allocates a storage-plus-index sorted-index target initialized as an exact copy of the source index stream. Selecting it before a sort would therefore remain geometrically safe, although the live renderer does not select it yet.
- `WebGPUPlatform` now exposes the minimal compute-pipeline and compute-pass interfaces needed by the upcoming depth/sort dispatch layer.
- The existing `WebGPUStaticLocResources.indexBuffer` remains the only index source used by rendering in this checkpoint, so output is unchanged.

`client/tests/webgpu-face-priority-resources.test.ts` covers exact priority expansion, model-span planning, merged-draw resolution, animation-style zero ranges, partial-span rejection, storage/index usage flags, source-to-sorted initialization, and resource disposal.

## Remaining WebGPU implementation contract

The next implementation checkpoint should connect the resource foundation to active static geometry and then implement depth generation:

1. Instantiate `WebGPUFacePrioritySortResources` for ordinary loc, door, and ground-item resources only when exact-priority geometry exists.
2. Associate every opaque/alpha/full-detail/LOD draw with its resolved model-span range and refresh that range when an animated loc selects a new frame.
3. Keep an explicit `plain` versus `priority` index-source switch, defaulted to `plain`, before any compute dispatch changes rendering.
4. Compute camera-dependent face depth from the existing packed vertex positions and placed-model transform.
5. Run the priority algorithm per model and write the sorted index stream. The CPU reference remains the validation oracle for the compute implementation.
6. Retain a small per-priority/model depth bias after sorting so the depth buffer agrees with painter order on coplanar faces.

## Composition with delayed-wall ordering

Face ordering and delayed-wall ordering operate at different levels and must remain separate:

- `WebGPUStaticLocDrawOrdering` orders whole static-model submissions relative to neighboring locs/walls.
- Face-priority sorting only changes the triangle/index order inside one submitted model draw.

The face sorter therefore must not replace or bypass the type-1/type-3 delayed-wall scheduler. A model draw first receives its sorted index source, then participates in the existing model-level submission order.

## Animated geometry

Animated locs can change index offset/count each frame. Priority resources must follow the selected animation frame without introducing a second animation clock. The authoritative WebGL animation state remains the source of the active frame, just as it is for the current WebGPU animated-loc draw-range path.

The sidecar already records each emitted animation frame as its own model span. The draw-span resolver now provides the boundary check needed to map the currently selected frame to that span; wiring that refresh into `applyWebGPUAnimatedLocDrawRanges` remains the next integration step.

## Completion criteria

The overall face-priority migration is complete only when:

- exact `0..11` priorities survive scene construction without compression,
- CPU and GPU sort output agree for validation fixtures,
- priority `10/11` threshold behavior matches the CPU reference,
- opaque/alpha and full-detail/LOD loc paths select the correct sorted index source,
- delayed-wall ordering still operates on the resulting whole-model draws,
- the temporary three-bit face-priority depth nudge is no longer responsible for painter correctness,
- WebGL2 fallback data remains unchanged.

The exact-priority data path and isolated GPU sort-resource foundation are implemented. Live resource integration, depth compute, sorting, and render-path selection remain pending.
