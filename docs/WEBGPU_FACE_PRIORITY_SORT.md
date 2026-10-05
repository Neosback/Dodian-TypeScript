# WebGPU face-priority ordering

This note tracks the dedicated face-priority work from `WEBGPU_MIGRATION_CHECKPOINTS.md`.

## Ground truth

The software model painter walks camera-visible faces from far to near and, when exact per-face priorities exist, feeds twelve stable buckets (`0..11`). Priorities `0..9` are emitted in numeric order with the special `10` then `11` stream interleaved at three thresholds:

- before priority `0`, while special depth is strictly greater than the average depth of priorities `1` and `2`;
- before priority `3`, while special depth is strictly greater than the average depth of priorities `3` and `4`;
- before priority `5`, while special depth is strictly greater than the average depth of priorities `6` and `8`;
- after priority `9`, emit the remaining priority `10` faces and then priority `11` faces.

Priority `10` is exhausted before priority `11`; those buckets are not merged by depth. `client/render/priority/FacePrioritySort.ts` is the renderer-neutral CPU oracle for the bucket/threshold rules.

The software painter's face depth is the integer average of the three camera-space relative-Z values, plus the model radius. Model radius, camera translation, map/placement translation, and center-height offsets are model-wide constants and cancel from model-local ordering and threshold comparisons. Vertex contouring is not constant and must be evaluated per placed instance.

## Packed-vertex limitation

The existing 12-byte vertex ABI cannot represent exact priorities `0..11`. `VertexBuffer` compresses priority into three bits in `packed.z[8:6]`:

- `0..3` remain `0..3`
- `4..5 -> 4`
- `6..7 -> 5`
- `8..9 -> 6`
- `10..11 -> 7`

Exact priority therefore remains in a sidecar. The WebGL2-compatible vertex ABI is unchanged.

## Exact-priority sidecar

`ExactFacePrioritySceneBuffer` records:

- one exact `uint8` priority per emitted triangle;
- `[firstIndex, indexCount]` model spans preserving model-local sort boundaries.

Ordinary locs, animated loc frame geometry, doors, and ground items all use this contract.

## Invariant GPU resources

`WebGPUFacePrioritySortResources` now owns only geometry-invariant data:

- exact priority words;
- validated model spans;
- the source index stream;
- an immutable CPU copy of the packed 12-byte vertices used when pass-local compute scratch must be rebuilt.

The old geometry-global/source-sized `sortedIndexBuffer` placeholder has been removed. It could not represent two placed instances that reuse the same animated source geometry but receive different contour-dependent depths.

The resource also owns cleanup callbacks so all pass-local depth/sort scratch is destroyed when loc/door/ground-item geometry is replaced or removed.

## Camera-dependent depth compute

`WebGPUFacePriorityDepthCompute.ts` expands submitted model spans into a dense instance-aware work stream:

`[sourceFace, firstInstance]`

A source face may appear multiple times. This is required for animated loc groups and any other instanced submission whose `ContourGroundType.VERTEX` deformation differs by placement.

The shader:

- reads the existing 12-byte packed vertex stream as raw `u32` words;
- follows the exact source index stream;
- mirrors the static loc height-map interpolation for vertex contouring;
- uses each work item's actual model-info instance;
- computes the integer/truncating average camera-relative Z;
- writes dense per-submission face depths.

The transform uses the linear portion of `worldEntityTransform * viewMatrix`. Translation is intentionally ignored with `w = 0` because it is constant within one placed model. World-entity rotation/scale still affects the linear depth quantity.

## Exact 0..11 GPU sorter

`WebGPUFacePrioritySortCompute.ts` reproduces the CPU oracle's bucket/threshold behavior without assuming a model fits inside one workgroup.

Each work item analytically derives its final rank by computing:

1. counts for all twelve priority buckets;
2. depth sums and counts for the three threshold pairs;
3. its stable far-to-near rank within its own priority bucket;
4. the size of the priority-10-then-11 special prefix above each threshold;
5. its exact final painter rank.

The shader preserves:

- descending integer depth within a bucket;
- source/local-face stability at equal depth;
- average thresholds for `1+2`, `3+4`, and `6+8`;
- strict `>` comparisons;
- the complete priority-10 stream before priority 11;
- non-monotonic threshold behavior;
- model-local sorting even when one draw covers several contiguous model spans.

The result is written into a dense `STORAGE | INDEX` buffer. Duplicate source submissions receive separate output ranges.

## A/B static-scene activation

Status: activated for loc-like submitted model spans in the WebGPU comparison path.

`WebGPUFacePriorityPassActivation.ts` connects the depth and sort stages to live static model passes.

### Instanced draws

Authoritative draw metadata remains unchanged. Before compute, an instanced draw is expanded into one temporary placed-model draw per instance:

- each temporary draw has `instanceCount = 1`;
- `firstInstance` advances across the original instance range;
- the source model span remains unchanged;
- roof-hidden and zero-count draws do not enter compute.

This gives every placement its own depth and sorted-index result while preserving the authoritative animation/draw state.

The resulting one-instance draws also improve whole-model delayed-wall ordering because placement metadata, anchors, and footprints are resolved from the actual instance rather than only the first instance of a merged draw.

### Pass-local compute scratch

Depth/sort resources are cached per static pass and grow to the next power-of-two capacity when an animated frame or instanced draw needs more submitted face references/model jobs than the current scratch can hold.

Opaque, alpha, full-detail, and LOD passes therefore have independent scratch/output buffers while sharing immutable geometry data.

Geometry replacement/disposal tears down those cached runtimes through the invariant sort resource cleanup hook.

### Compute -> render ordering

`drawWebGPUOrderedStaticGeometry` prepares locs, ground items, and doors for the current map/pass, records depth then sort into a compute command buffer, and submits that command buffer before the A/B renderer later submits its render command buffer.

WebGPU queue ordering therefore guarantees:

`depth compute -> exact sort compute -> index-buffer draw`

The render scheduler binds each prepared pass's dense sorted buffer and uses remapped `firstIndex/indexCount` ranges while leaving delayed-wall whole-model ordering intact.

### Temporary packed face bias removed

The A/B static-scene WGSL patch no longer applies the compressed 3-bit per-face Z nudge. Exact priority is represented by triangle/index order instead.

The independent placement rules remain:

- per-plane separation;
- cardinal wall/decor camera-relative offsets;
- roof/ground pulls;
- diagonal decoration selection;
- delayed-wall whole-model ordering;
- legacy model-priority bias for records without placement metadata.

WebGL2 shader/data behavior is unchanged.

## Visibility/culling boundary

One remaining semantic boundary is intentionally not hidden by this checkpoint.

The original software painter forms its priority buckets from faces that survive its camera-visibility/front-face walk. The current WebGPU compute batch is formed from submitted model spans, while rasterizer face culling remains a separate renderer policy controlled by the existing `cullBackFace` path.

Allowing culled/back faces into a threshold average can theoretically change priority-10/11 splice positions even though those triangles are later rejected by rasterization. For that reason, this document does **not** claim software-painter face-priority parity is fully closed yet.

Visibility-aware priority inputs belong with the remaining culling-parity work because the visibility predicate must use the same final projection/front-face convention as the renderer. That checkpoint must decide and test the behavior for both culling-enabled and culling-disabled modes rather than introducing a second approximate predicate here.

Until then:

- the exact 0..11 bucket/threshold algorithm is active for submitted model spans;
- instance-specific depth/contouring is active;
- the packed 3-bit approximation is removed from the A/B loc shader;
- final software-visible-face parity remains pending with culling.

## Validation coverage

The foundation suite now contains dedicated coverage for:

- `face-priority-sort.test.ts`: renderer-neutral CPU painter oracle;
- `exact-face-priority-sidecar.test.ts`: exact priority/span construction;
- `webgpu-face-priority-resources.test.ts`: invariant GPU resources and disposal hooks;
- `webgpu-face-priority-depth.test.ts`: packed decoding, contour-aware depth jobs, compute plumbing;
- `webgpu-face-priority-sort-compute.test.ts`: analytic GPU-rank formulation versus the CPU oracle, including deterministic randomized fixtures;
- `webgpu-face-priority-activation.test.ts`: instanced-draw expansion, per-placement dense output ranges, roof filtering, and world-entity/view transform composition;
- `webgpu-animated-loc-draws.test.ts`: animated span refresh and hidden-frame behavior;
- `webgpu-loc-depth-shader.test.ts`: removal of the compressed face-priority Z nudge while preserving the independent placement-ordering shader rules.

No test or typecheck result should be claimed as executed remotely unless GitHub reports a check for the current branch head.

## Composition with delayed-wall ordering

The two ordering layers remain separate:

- face-priority sorting reorders triangles inside one placed model;
- `WebGPUStaticLocDrawOrdering` orders whole placed models against diagonal walls and neighboring locs.

The prepared exact-sort draw is therefore still one unit in the delayed-wall scheduler. Face sorting does not bypass or replace type-1/type-3 delayed-wall dependencies.

## Remaining work

The next ordering/culling stage should:

1. define the authoritative camera-visible/front-face predicate for priority-bucket membership;
2. make that predicate match the final WebGPU projection/culling convention;
3. cover culling-enabled and culling-disabled behavior explicitly;
4. compare visibility-filtered GPU order against a software-painter fixture;
5. validate representative opaque/alpha, LOD, animated, door, ground-item, contour, and world-entity scenes in the A/B renderer;
6. then continue chunk/entity culling parity and asynchronous picking.

Broader migration work still includes dynamic players/NPCs/projectiles/spot effects, world-entity special overlap behavior, full 2D/UI, device-loss/performance hardening, full renderer activation, and final WebGL2 fallback validation.

## Completion criteria

Face-priority ordering is fully complete only when:

- exact `0..11` priorities survive scene construction without compression;
- model spans remain exact through animation updates;
- repeated placed instances can receive independent contour-dependent depths and sorted output;
- CPU and GPU bucket/threshold behavior agree;
- priority `10/11` strict-threshold behavior agrees;
- the A/B renderer consumes dense sorted index ranges for locs, doors, and ground items;
- opaque/alpha and full-detail/LOD passes use the correct pass-local sorted outputs;
- delayed-wall ordering still operates on whole placed models;
- camera-visible/front-face membership matches the software painter when culling parity is enabled;
- the packed 3-bit priority nudge is no longer responsible for painter correctness;
- WebGL2 fallback data and behavior remain unchanged.

The data path, instance-aware depth pass, exact 0..11 rank algorithm, dense per-submission output, A/B static activation, instanced placement expansion, dynamic scratch growth, cleanup, and packed-bias removal are implemented. Visibility-aware bucket membership remains for the culling-parity checkpoint.
