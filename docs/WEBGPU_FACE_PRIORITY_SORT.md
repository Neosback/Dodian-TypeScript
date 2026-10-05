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
- `WebGPUStaticLocResources` currently retains the sidecar and model spans on the CPU only. It does not upload, reorder, or select a different index buffer yet.
- Terrain and NPC scene buffers remain on the existing `SceneBuffer` path and are not forced into this model-only sidecar contract.

`client/tests/exact-face-priority-sidecar.test.ts` covers triangle alignment, model-span boundaries, model-wide priority fallback, invalid priorities, incomplete spans, and empty geometry. Door and ground-item adapter tests also verify that the sidecar is forwarded without reconstruction.

## Remaining WebGPU implementation contract

The next implementation checkpoint should preserve the existing vertex buffer and consume the sidecar as separate priority-sort resources:

1. Upload exact priorities and the model-span metadata for WebGPU priority-sort resources without changing WebGL2 buffers.
2. Associate each active draw/frame with the model span or spans it references so sorting remains model-local for merged, instanced, and animated geometry.
3. Compute camera-dependent face depth from the existing packed vertex positions and placed-model transform.
4. Run the priority algorithm per model and write a sorted index stream. The CPU reference remains the validation oracle for the compute implementation.
5. Keep an explicit `plain` versus `priority` index-source switch for A/B validation and to avoid sort-resource memory for geometry that does not need it.
6. Retain a small per-priority/model depth bias after sorting so the depth buffer agrees with painter order on coplanar faces.

## Composition with delayed-wall ordering

Face ordering and delayed-wall ordering operate at different levels and must remain separate:

- `WebGPUStaticLocDrawOrdering` orders whole static-model submissions relative to neighboring locs/walls.
- Face-priority sorting only changes the triangle/index order inside one submitted model draw.

The face sorter therefore must not replace or bypass the type-1/type-3 delayed-wall scheduler. A model draw first receives its sorted index source, then participates in the existing model-level submission order.

## Animated geometry

Animated locs can change index offset/count each frame. Priority resources must follow the selected animation frame without introducing a second animation clock. The authoritative WebGL animation state remains the source of the active frame, just as it is for the current WebGPU animated-loc draw-range path.

The sidecar already records each emitted animation frame as its own model span. The remaining GPU checkpoint must resolve the currently selected frame range to that span before dispatching or selecting sorted indices.

## Completion criteria

The overall face-priority migration is complete only when:

- exact `0..11` priorities survive scene construction without compression,
- CPU and GPU sort output agree for validation fixtures,
- priority `10/11` threshold behavior matches the CPU reference,
- opaque/alpha and full-detail/LOD loc paths select the correct sorted index source,
- delayed-wall ordering still operates on the resulting whole-model draws,
- the temporary three-bit face-priority depth nudge is no longer responsible for painter correctness,
- WebGL2 fallback data remains unchanged.

The first item is implemented by the sidecar checkpoint. GPU sorting and render-path selection remain pending.
