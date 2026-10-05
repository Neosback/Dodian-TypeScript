# WebGPU face-priority ordering

This note tracks the dedicated face-priority checkpoint from `WEBGPU_MIGRATION_CHECKPOINTS.md`.

## Ground truth

The software model painter walks visible faces from far to near and, when exact per-face priorities exist, feeds twelve stable buckets (`0..11`). Priorities `0..9` are emitted in numeric order with the special `10` then `11` stream interleaved at three thresholds:

- before priority `0`, while special depth is strictly greater than the average depth of priorities `1` and `2`;
- before priority `3`, while special depth is strictly greater than the average depth of priorities `3` and `4`;
- before priority `5`, while special depth is strictly greater than the average depth of priorities `6` and `8`;
- after priority `9`, emit the remaining priority `10` faces and then priority `11` faces.

Priority `10` is exhausted before priority `11`; those buckets are not merged by depth. `client/render/priority/FacePrioritySort.ts` remains the renderer-neutral CPU oracle.

The software painter's face depth is the integer average of the three camera-space relative-Z values, plus the model radius. Radius, camera translation, ordinary placement translation, map translation, and center-height offsets are model-wide constants, so they cancel from model-local ordering and from all three threshold comparisons. Vertex contouring is not constant and must remain instance-aware.

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

## Source-side GPU resources

`WebGPUFacePrioritySortResources` owns geometry-invariant source data:

- exact priority words;
- validated model spans;
- the source index stream;
- the original inactive source-sized sorted-index placeholder from the resource-integration checkpoint.

That source-sized placeholder is **not** the exact Checkpoint-3 output for repeated animated placements. Exact sorting now produces a dense per-submission index stream in `WebGPUFacePrioritySortComputeResources`. The old placeholder remains inactive while the renderer stays on `plain`; the activation checkpoint will replace the current resource-level index switch with pass/submission-aware exact output ranges.

## Live resource integration checkpoint

Status: implemented.

- `WebGPUStaticLocResources` creates source priority/span resources for non-empty exact-priority geometry.
- Doors and ground items inherit the same contract.
- Opaque, alpha, full-detail, and LOD draws record a validated `facePrioritySpan`.
- Animated frame changes refresh the span after their source range changes.
- Hidden zero-count animation slots retain an empty span.
- The live renderer still selects `plain` indices.
- Delayed-wall scheduling remains separate from face sorting.

## Camera-dependent face-depth checkpoint

Status: implemented as reusable compute resources; live renderer invocation remains disabled until activation.

### Instance-aware work stream

A single `depth[sourceFace]` array is not exact for animated locs. Animated groups can reuse one frame span at more than one placement, while `ContourGroundType.VERTEX` can deform those placements differently.

`WebGPUFacePriorityDepthCompute.ts` expands selected draws into a dense work stream of:

`[sourceFace, firstInstance]`

Source faces may appear more than once. Each submitted model span also retains a `WebGPUFacePriorityDepthModelJob` describing its contiguous work-item range.

### Depth compute

The WGSL depth pass:

- reads the existing packed 12-byte vertex stream as raw `u32` words;
- follows the existing source index stream;
- applies the linear view/world-entity transform with `w = 0` so model-wide translations cancel;
- mirrors the live signed-height-map interpolation for `ContourGroundType.VERTEX`;
- uses each work item's `firstInstance` to select the correct placement record;
- writes one integer-valued `f32` depth per dense work item.

The output is dense by submission, not by unique source face.

## Exact 0..11 GPU sort checkpoint

Status: compute implementation and CPU-oracle validation foundation implemented. Rendering remains on `plain`.

### Dense per-submission sorted stream

A source-sized sorted buffer has the same reuse problem as a source-sized depth buffer: two placed animated instances can need different face orders for the same source frame.

`WebGPUFacePrioritySortComputeResources` therefore owns a separate exact output stream sized by submitted face references. Duplicate source spans receive independent output regions.

`createWebGPUFacePrioritySortedDrawRanges` records the future draw-addressable ranges for that dense stream while preserving:

- source draw identity;
- `firstInstance`;
- instance count;
- model-job boundaries;
- original draw/model ordering.

A draw containing multiple model spans remains contiguous in the output, but each span is sorted independently before being concatenated in its original model order.

### GPU rank formulation

The sorter does not materialize twelve variable-length bucket arrays in GPU memory. Instead, every submitted face computes its final destination rank independently.

For each model job, the shader computes:

1. counts for priorities `0..11`;
2. integer depth sums for priorities `0..9`;
3. the three software-client average thresholds;
4. the stable far-to-near rank inside the face's own priority bucket, using source-local order for equal depths;
5. the prefix length of the special `10 -> 11` stream above each strict threshold;
6. the exact final rank after the three special-stream splice points.

The special prefix calculation deliberately preserves the original non-merged rule. Priority `11` can advance past a threshold only after every priority-10 face before the 10->11 handoff has advanced past that same point.

Each invocation then copies the face's three source indices into:

`(modelJob.firstWorkItem + finalRank) * 3`

Because model jobs occupy independent dense ranges, parallel invocations do not cross model boundaries.

### Stage scheduling

`prepareWebGPUFacePriorityDepthAndSort` prepares both stages against the same immutable instance-aware job batch.

`encodeWebGPUFacePriorityDepthAndSort` records:

1. the depth compute pass;
2. the exact sort compute pass;

in that order on one WebGPU command encoder. This establishes the required GPU execution dependency without activating the sorted output for rendering yet.

The static renderer does **not** call this sequence yet. Checkpoint 4 will instantiate pass-specific compute resources for visible loc/door/ground-item streams, handle capacity/rebuild policy for animated reuse, encode depth -> sort before the render pass, and bind the corresponding dense ranges.

### Validation coverage

`client/tests/webgpu-face-priority-depth.test.ts` covers the depth math, instance-aware work expansion, contour-aware shader contract, compute plumbing, capacity handling, and disposal.

`client/tests/webgpu-face-priority-sort-compute.test.ts` adds:

- direct comparisons between the independent GPU rank formulation and `createFacePriorityDrawOrder`;
- all three threshold stages;
- strict threshold equality;
- priority `10 -> 11` handoff behavior;
- equal-depth stability;
- negative integer depths;
- deterministic randomized mixes of all twelve priorities;
- dense metadata generation for per-model jobs;
- duplicate source spans receiving distinct sorted output ranges;
- WGSL contract checks for exact priority reads, stable tie-breaking, strict threshold behavior, and dense output addressing;
- compute buffer creation, metadata/uniform uploads, dispatch sizing, capacity checks, stage order, mismatch detection, and disposal through a mock WebGPU device.

The CPU test validates the exact rank equation that the WGSL implements. It is not a browser WebGPU readback test. A real GPU readback/parity fixture remains appropriate during later hardening once the live pass is instantiated and browser coverage is available.

The WebGPU foundation script includes both the depth and exact-sort tests. No remote test result should be claimed unless GitHub reports a check for the branch head.

## Composition with delayed-wall ordering

Delayed-wall ordering and face-priority ordering remain separate:

- `WebGPUStaticLocDrawOrdering` schedules whole loc-like draws relative to neighboring walls/locs.
- face-priority sorting changes triangle order inside each submitted model span.

The activation checkpoint must feed the sorted per-submission ranges through the existing delayed-wall scheduler rather than replacing it.

## Next checkpoint: static-scene activation

The next checkpoint is intentionally limited to integrating the proven compute foundation into the A/B static path while keeping WebGL2 fallback untouched.

1. Instantiate depth/sort compute resources for active opaque, alpha, full-detail, and LOD loc-like passes.
2. Build the current instance-aware batch after animated draw ranges have been refreshed.
3. Size or rebuild scratch/output capacity safely when animated source reuse changes the number of submitted face references.
4. Encode depth -> sort before the matching render submissions.
5. Replace the old source-sized `priority` placeholder with pass-specific dense sorted-index buffers/ranges.
6. Feed those ranges through the existing delayed-wall ordering scheduler.
7. Validate ordinary locs, doors, ground items, opaque/alpha, LOD, animated frames, shared animation sources, vertex contouring, and world-entity transforms.
8. Remove the temporary packed 3-bit face-priority depth nudge only after exact sorted rendering is demonstrated.
9. Keep WebGL2 data and fallback behavior unchanged.

## Completion criteria

The overall face-priority migration is complete only when:

- exact `0..11` priorities survive scene construction without compression;
- loc/door/ground-item draws have exact model-span mappings;
- animated ranges refresh those mappings correctly;
- shared animated source geometry can produce independent instance-specific depth and sorted output;
- the GPU rank formulation agrees with the CPU painter oracle;
- priority `10/11` threshold behavior matches the CPU reference;
- opaque/alpha and full-detail/LOD paths bind their correct dense sorted index regions;
- delayed-wall ordering still operates on whole-model submissions;
- the temporary three-bit face-priority depth nudge is no longer responsible for painter correctness;
- WebGL2 fallback data remains unchanged.
