# WebGPU face-priority ordering

This note tracks the dedicated face-priority checkpoint from `WEBGPU_MIGRATION_CHECKPOINTS.md`.

## Ground truth

The software model painter walks visible faces from far to near and, when exact per-face priorities exist, feeds twelve stable buckets (`0..11`). Priorities `0..9` are emitted in numeric order with the special `10` then `11` stream interleaved at three thresholds:

- before priority `0`, while special depth is strictly greater than the average depth of priorities `1` and `2`;
- before priority `3`, while special depth is strictly greater than the average depth of priorities `3` and `4`;
- before priority `5`, while special depth is strictly greater than the average depth of priorities `6` and `8`;
- after priority `9`, emit the remaining priority `10` faces and then priority `11` faces.

Priority `10` is exhausted before priority `11`; those buckets are not merged by depth. `client/render/priority/FacePrioritySort.ts` is the renderer-neutral CPU oracle for these rules.

The software painter's face depth is the integer average of the three camera-space relative-Z values, plus the model radius. The model radius is constant for every face in that model. Camera translation, map/placement translation, center-height offsets, and the radius therefore cancel from every model-local comparison and threshold. The WebGPU depth pass keeps only the terms that can change relative face depth.

## Packed-vertex limitation

The existing 12-byte vertex ABI cannot represent exact priorities `0..11`. `VertexBuffer` compresses priority into three bits in `packed.z[8:6]`:

- `0..3` remain `0..3`
- `4..5 -> 4`
- `6..7 -> 5`
- `8..9 -> 6`
- `10..11 -> 7`

The remaining packed bits are already used by position, alpha, texture data, and UV data. Exact priority data therefore stays in a sidecar and the WebGL2-compatible packed vertex ABI is unchanged.

## Exact-priority sidecar

`ExactFacePrioritySceneBuffer` records:

- one exact `uint8` priority per emitted triangle;
- `[firstIndex, indexCount]` model spans preserving the original model-local sort boundary.

The spans cover the complete model-only index stream exactly once in emission order. Ordinary locs, animated loc frame geometry, doors, and ground items all use this contract.

## GPU sort-resource foundation

`WebGPUFacePrioritySortResources` owns data that is invariant across placements:

- exact priority words;
- validated model spans;
- the source index stream;
- a storage-plus-index sorted-index target initialized as an exact source-index copy.

It no longer owns a `depth[sourceFace]` buffer. That original design was insufficient for animated locs because one source frame can be referenced by multiple placed instances and `ContourGroundType.VERTEX` can deform those instances differently.

## Live resource integration checkpoint

Status: implemented.

- `WebGPUStaticLocResources` creates sort resources for non-empty exact-priority geometry.
- Doors and ground items inherit the same contract.
- Opaque, alpha, full-detail, and LOD draws record a validated `facePrioritySpan`.
- Animated frame changes refresh the span after their source range changes.
- Hidden zero-count animation slots retain an empty span.
- Static resources expose an explicit `plain` versus `priority` index source.
- The source defaults to `plain`.
- `drawWebGPUOrderedStaticGeometry` binds the selected source without replacing delayed-wall ordering.

## Camera-dependent face-depth checkpoint

Status: compute foundation implemented; live scheduling intentionally remains disabled until the exact sorter is added.

### Exact depth quantity

For one submitted model, the ordering quantity is the integer average of the three camera-relative vertex depths. Terms that are constant for every vertex in that model are intentionally omitted because adding the same constant cannot change:

- far-to-near ordering;
- priority-bucket average thresholds;
- the strict `>` threshold comparisons.

The compute path therefore uses the linear part of the supplied view/world-entity transform with `w = 0`.

### Instance-aware work stream

A single `depth[sourceFace]` array is not exact for animated locs. Animated groups can reuse one frame span at more than one placement, while vertex contouring is evaluated from each placement's height-map coordinates.

`WebGPUFacePriorityDepthCompute.ts` expands visible draws into a dense work stream of:

`[sourceFace, firstInstance]`

Source faces may appear more than once. Each model span also retains a CPU-side `WebGPUFacePriorityDepthModelJob` describing its contiguous range in the dense depth output. Checkpoint 3 can therefore sort each submitted model independently even when several placements share the same source geometry.

The job builder rejects multi-instance draw calls for this path. Current loc-like scene construction uses one placed-model instance per draw or one synthetic instance for geometry whose placement is already baked into the vertices. If that invariant changes later, the scheduler must expand those instances explicitly instead of sharing one sort result.

### Packed geometry and contouring

The WGSL compute shader reads the existing packed vertex stream as raw `array<u32>` words. This is deliberate: a storage `vec3<u32>` would have 16-byte alignment and would not match the 12-byte vertex ABI.

The shader decodes position exactly like the static-scene vertex shader. Placement/map/camera translations and center-tile height are omitted as model-wide constants. `ContourGroundType.VERTEX` is different: its interpolated height can vary per vertex and can change relative face depth. The compute shader therefore mirrors the live `getLocHeightInterp` path using:

- the pass's height-map texture;
- the pass's model-info buffer;
- each work item's `firstInstance`;
- the map border size.

This is why depth scratch is pass-specific rather than geometry-global.

### Compute resources

`WebGPUFacePriorityDepthComputeResources` owns:

- a storage copy of the existing packed 12-byte vertex words;
- an instance-aware work-item buffer;
- dense face-depth scratch sized by submitted face references;
- a uniform block for the depth transform, work-item count, and border size;
- a compute bind group using the existing source-index buffer, height map, and model-info buffer.

The WGSL workgroup size is 64. The output is dense by work-item index, not source-face index.

The compute resource is not yet created or dispatched by `WebGPUStaticSceneRenderer`. This is intentional. The next checkpoint needs to consume the dense per-model job ranges and write matching per-submission sorted index regions before switching any draw to the `priority` index source.

### Validation coverage

`client/tests/webgpu-face-priority-depth.test.ts` covers:

- 12-byte packed-position decoding;
- integer/truncating face-depth averaging;
- linear camera transform behavior;
- translation invariance from `w = 0`;
- duplicate source faces at different `firstInstance` values;
- hidden zero-count draws;
- model-job boundaries retained for the sorter;
- rejection of unsupported multi-instance draw calls;
- shader contracts for raw packed words, vertex contouring, dense work items, and truncating depth writes;
- compute resource creation, job/uniform uploads, dispatch sizing, capacity checks, and disposal through a mock WebGPU device.

The existing WebGPU foundation suite has not been claimed as remotely executed unless GitHub reports a check for the branch head.

## Composition with delayed-wall ordering

Delayed-wall ordering and face-priority ordering remain separate:

- `WebGPUStaticLocDrawOrdering` schedules whole loc-like draws relative to neighboring walls/locs.
- face-priority sorting reorders triangle indices inside each submitted model.

The exact sorter must preserve that separation.

## Next implementation checkpoint: exact 0..11 GPU sort

The next checkpoint will consume the instance-aware depth work stream and implement the exact CPU-oracle behavior:

1. create per-model sort jobs from `WebGPUFacePriorityDepthModelJob` ranges;
2. build the twelve stable priority buckets;
3. preserve far-to-near stability within each bucket;
4. reproduce the three average-depth thresholds;
5. preserve strict `>` comparisons;
6. exhaust priority `10` before priority `11`;
7. write each model's reordered source indices into a draw-addressable sorted-index region;
8. support duplicate animated source spans by giving separate placed submissions separate output regions;
9. compare GPU/CPU index order against `createFacePriorityDrawOrder` fixtures;
10. keep the renderer on `plain` until those comparisons agree.

Only after that checkpoint should the A/B static renderer activate `priority` index selection.

## Completion criteria

The overall face-priority migration is complete only when:

- exact `0..11` priorities survive scene construction without compression;
- loc/door/ground-item draws have exact model-span mappings;
- animated ranges refresh those mappings correctly;
- instance-specific vertex contouring can produce independent depth jobs for shared source geometry;
- CPU and GPU depth/sort behavior agree on validation fixtures;
- priority `10/11` threshold behavior matches the CPU reference;
- opaque/alpha and full-detail/LOD paths select their correct sorted index regions;
- delayed-wall ordering still operates on whole-model submissions;
- the temporary three-bit face-priority depth nudge is no longer responsible for painter correctness;
- WebGL2 fallback data remains unchanged.
