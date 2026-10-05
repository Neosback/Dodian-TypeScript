# WebGPU face-priority ordering

This note tracks the dedicated face-priority work from `WEBGPU_MIGRATION_CHECKPOINTS.md`.

## Ground truth

The retained software/RuneLite model painter forms its painter stream only from faces that survive two source-side rules:

1. sentinel faces with `faceColors3 == -2` do not participate;
2. submitted faces must satisfy the projected winding test
   `(aX-bX)*(cY-bY) - (cX-bX)*(aY-bY) > 0`.

`SceneBuffer` already removes the `-2` sentinel faces while building the static geometry, so they never enter the exact-priority sidecar.

For the remaining camera-visible faces, the painter walks far to near and feeds twelve stable priority buckets (`0..11`). Priorities `0..9` are emitted in numeric order with the special `10` then `11` stream interleaved at three thresholds:

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

`WebGPUFacePrioritySortResources` owns geometry-invariant data:

- exact priority words;
- validated model spans;
- the source index stream;
- an immutable CPU copy of the packed 12-byte vertices used when pass-local compute scratch must be rebuilt.

The old geometry-global/source-sized `sortedIndexBuffer` placeholder was removed because it could not represent two placed instances that reuse the same animated source geometry but receive different contour-dependent depths.

The resource also owns cleanup callbacks so all pass-local depth/sort scratch is destroyed when loc/door/ground-item geometry is replaced or removed.

## Camera-dependent depth and visibility compute

`WebGPUFacePriorityDepthCompute.ts` expands submitted model spans into a dense instance-aware work stream:

`[sourceFace, firstInstance]`

A source face may appear multiple times. This is required for animated loc groups and any other instanced submission whose `ContourGroundType.VERTEX` deformation differs by placement.

The depth side of the shader:

- reads the existing 12-byte packed vertex stream as raw `u32` words;
- follows the exact source index stream;
- mirrors the static loc height-map interpolation for vertex contouring;
- uses each work item's actual model-info instance;
- computes the integer/truncating average camera-relative Z;
- writes dense per-submission face depths.

The depth transform uses the linear portion of `worldEntityTransform * viewMatrix`. Translation is intentionally ignored with `w = 0` because it is constant within one placed model. World-entity rotation/scale still affects the linear depth quantity.

The same compute pass now also writes one `u32` visibility word per work item. Visibility uses the fully placed and contoured world position rather than the translation-free depth position because perspective winding depends on actual placement. It uses:

- the current map render position (`renderPosX/renderPosY`);
- the same `worldEntityTransform * viewMatrix` order as the patched static-scene shader;
- the current frame projection matrix;
- the existing `SceneFrameDescription.cullBackFace` switch.

When culling is disabled every submitted face is marked visible. When culling is enabled, the compute shader evaluates the same positive projected-winding convention used by the retained painter and by the WebGPU pipelines' `frontFace: "ccw"` / `cullMode: "back"` configuration. Faces whose clip-space `w` is non-positive are excluded from priority membership.

`WebGPUFacePriorityVisibility.ts` provides the CPU projected-winding oracle used by focused fixtures.

## Exact 0..11 GPU sorter

`WebGPUFacePrioritySortCompute.ts` reproduces the CPU oracle's bucket/threshold behavior without assuming a model fits inside one workgroup.

Each visible work item analytically derives its final rank by computing:

1. counts for all twelve priority buckets from visible faces only;
2. depth sums and counts for the three threshold pairs from visible faces only;
3. its stable far-to-near rank within its own visible priority bucket;
4. the size of the visible priority-10-then-11 special prefix above each threshold;
5. its exact final painter rank.

The shader preserves:

- descending integer depth within a bucket;
- source/local-face stability at equal depth;
- average thresholds for `1+2`, `3+4`, and `6+8`;
- strict `>` comparisons;
- the complete priority-10 stream before priority 11;
- non-monotonic threshold behavior;
- model-local sorting even when one draw covers several contiguous model spans.

Back faces no longer contribute to bucket counts, threshold averages, bucket ranks, or special-stream prefix counts. Their output slots are moved to a deterministic source-stable tail and encoded as degenerate triangles by repeating one source vertex index three times. This keeps every prepared draw's index count fixed while guaranteeing the rejected tail cannot rasterize, avoiding GPU readback or a new indirect-draw dependency.

The result is written into a dense `STORAGE | INDEX` buffer. Duplicate source submissions receive separate output ranges.

## A/B static-scene activation

Status: activated for loc-like submitted model spans in the WebGPU comparison path, including visibility-aware priority membership.

`WebGPUFacePriorityPassActivation.ts` connects depth, visibility, and exact sorting to live static model passes.

### Instanced draws

Authoritative draw metadata remains unchanged. Before compute, an instanced draw is expanded into one temporary placed-model draw per instance:

- each temporary draw has `instanceCount = 1`;
- `firstInstance` advances across the original instance range;
- the source model span remains unchanged;
- roof-hidden and zero-count draws do not enter compute.

This gives every placement its own contour-dependent depth, projected visibility, and sorted-index result while preserving authoritative animation/draw state.

The resulting one-instance draws also improve whole-model delayed-wall ordering because placement metadata, anchors, and footprints are resolved from the actual instance rather than only the first instance of a merged draw.

### Pass-local compute scratch

Depth/sort resources are cached per static pass and grow to the next power-of-two capacity when an animated frame or instanced draw needs more submitted face references/model jobs than the current scratch can hold.

Opaque, alpha, full-detail, and LOD passes therefore have independent scratch/output buffers while sharing immutable geometry data.

Geometry replacement/disposal tears down those cached runtimes through the invariant sort resource cleanup hook. The depth runtime now owns a fifth scratch resource for the per-work-item visibility mask.

### Compute -> render ordering

`drawWebGPUOrderedStaticGeometry` prepares locs, ground items, and doors for the current map/pass, records depth/visibility then sort into a compute command buffer, and submits that command buffer before the A/B renderer later submits its render command buffer.

WebGPU queue ordering therefore guarantees:

`depth + visibility compute -> exact visible-face sort -> index-buffer draw`

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

## Visibility/culling parity status

The known face-priority threshold-pollution bug is now closed for the submitted static loc-like passes: a hardware-back-facing triangle no longer changes threshold averages or priority-10/11 splice positions before being rejected by rasterization.

This is deliberately narrower than claiming all scene culling is complete. Remaining culling work includes:

- chunk/map/entity visibility parity beyond the already mirrored map-level visibility order;
- broader model/near-plane rejection behavior around the camera clipping domain;
- dynamic entity culling once players, NPCs, projectiles, and spot effects move to WebGPU;
- special world-entity overlap/ghost paths;
- asynchronous picking/highlight visibility.

Those belong to the broader culling/picking migration stage, not to the face-priority bucket algorithm.

## Validation coverage

The foundation suite contains dedicated coverage for:

- `face-priority-sort.test.ts`: renderer-neutral CPU painter oracle;
- `exact-face-priority-sidecar.test.ts`: exact priority/span construction;
- `webgpu-face-priority-resources.test.ts`: invariant GPU resources and disposal hooks;
- `webgpu-face-priority-depth.test.ts`: packed decoding, contour-aware depth jobs, visibility uniforms/buffer ownership, and compute plumbing;
- `webgpu-face-priority-sort-compute.test.ts`: analytic GPU-rank formulation versus the CPU oracle, including deterministic randomized fixtures;
- `webgpu-face-priority-visibility.test.ts`: projected front/back winding, culling-disabled behavior, visible-only threshold ordering, deterministic hidden-face tail layout, and activation-state plumbing;
- `webgpu-face-priority-activation.test.ts`: instanced-draw expansion, per-placement dense output ranges, roof filtering, and world-entity/view transform composition;
- `webgpu-animated-loc-draws.test.ts`: animated span refresh and hidden-frame behavior;
- `webgpu-loc-depth-shader.test.ts`: removal of the compressed face-priority Z nudge while preserving the independent placement-ordering shader rules.

`client/package.json` includes the new visibility fixture in `test:webgpu-foundation`.

No test or typecheck result should be claimed as executed remotely unless GitHub reports a check for the current branch head.

## Composition with delayed-wall ordering

The two ordering layers remain separate:

- face-priority sorting reorders triangles inside one placed model;
- `WebGPUStaticLocDrawOrdering` orders whole placed models against diagonal walls and neighboring locs.

The prepared exact-sort draw is therefore still one unit in the delayed-wall scheduler. Face sorting does not bypass or replace type-1/type-3 delayed-wall dependencies.

## Remaining work

The next ordering/culling stage should:

1. audit chunk/map/entity culling against the WebGL2 authoritative path;
2. define remaining model/near-plane rejection behavior explicitly;
3. validate representative opaque/alpha, LOD, animated, door, ground-item, contour, and world-entity scenes in the A/B renderer;
4. add asynchronous picking without stalling the frame;
5. then continue dynamic players/NPCs/projectiles/spot effects and special world-entity overlap behavior.

Broader migration work still includes full 2D/UI, device-loss/performance hardening, full renderer activation, and final WebGL2 fallback validation.

## Completion criteria

The dedicated static face-priority path now satisfies:

- exact `0..11` priorities survive scene construction without compression;
- sentinel `faceColors3 == -2` triangles do not enter the sidecar;
- model spans remain exact through animation updates;
- repeated placed instances can receive independent contour-dependent depths and visibility results;
- CPU and GPU bucket/threshold behavior agree by construction/reference fixtures;
- priority `10/11` strict-threshold behavior is preserved;
- the A/B renderer consumes dense sorted index ranges for locs, doors, and ground items;
- opaque/alpha and full-detail/LOD passes use independent pass-local sorted outputs;
- delayed-wall ordering still operates on whole placed models;
- culling-enabled priority membership removes projected back faces before threshold calculation;
- culling-disabled mode keeps every submitted face eligible;
- hidden faces occupy deterministic degenerate tail slots without changing draw counts;
- the packed 3-bit priority nudge is no longer responsible for painter correctness;
- WebGL2 fallback data and behavior remain unchanged.

The data path, instance-aware depth pass, projected visibility pass, exact 0..11 rank algorithm, dense per-submission output, A/B static activation, instanced placement expansion, dynamic scratch growth, cleanup, and packed-bias removal are implemented. Broader scene culling and picking remain in the next migration stage.
