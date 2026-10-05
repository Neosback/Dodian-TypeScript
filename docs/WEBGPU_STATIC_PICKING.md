# WebGPU static picking

This checkpoint adds a staged, non-authoritative WebGPU picking path for the static scene while WebGL2 and the CPU `SceneRaycaster` remain the live interaction system.

## Scope

Covered now:

- terrain tile hits;
- ordinary static and animated locs;
- doors;
- ground items;
- opaque, alpha, full-detail, and LOD variants;
- roof-plane filtering;
- current `cullBackFace` behavior;
- exact face-priority sorting and delayed-wall ordering for loc-like geometry;
- world-entity map transforms and source map identity;
- asynchronous one-pixel GPU readback.

Not covered in this checkpoint:

- players, NPCs, projectiles, spot animations, or other dynamic entities;
- interaction highlights;
- replacing `SceneRaycaster` as the authoritative menu/hover source;
- cursor-frustum / 8x8-chunk geometry narrowing for pick-pass performance.

## Pick target contract

The companion pass renders to `rgba32uint` and writes four unsigned integers per fragment:

1. interaction id;
2. source map-square id;
3. `InteractType`;
4. `1 + packed tile`.

The packed tile uses 14 bits each for world X/Y and 2 bits for the plane. Zero in the fourth word is therefore reserved for the cleared/no-hit state.

Terrain writes interaction type `NONE` with a synthetic id and a real tile/plane. Loc-like geometry decodes the worker's existing 17-bit interaction id and 2-bit type from the legacy model-info words. The upper half of `info.w` remains available for WebGPU placement metadata.

The per-map uniform block keeps its existing 96-byte size and world-entity transform at byte 32. The previously unused word at byte 20 now carries the source cache/scene map id. This is deliberately independent from `renderPosX/renderPosY`, which can differ for instances and world entities.

## Interaction geometry

The worker already emits eight loc-like variants:

- ordinary opaque / alpha;
- ordinary LOD opaque / alpha;
- interaction opaque / alpha;
- interaction LOD opaque / alpha.

Normal rendering continues to use the ordinary four variants. WebGPU static resources now retain the four interaction variants as additional model-info bind groups and draw plans, while sharing the same vertex/index, height-map, and exact face-priority resources.

This is important for ordinary locs because display draws may be merged and intentionally carry no interaction identity. Interaction draws retain the per-object model-info records required for exact picking. Door and ground-item adapters already expose the same eight-variant contract, so they inherit the path automatically.

Animated loc synchronization updates both the visible render pass and its matching interaction pass from the authoritative WebGL animation frame. No second animation clock is introduced.

## Shader behavior

The static-scene shader patch adds a flat integer pick payload to the existing vertex output and a dedicated `fsPick` fragment entry point.

The pick fragment:

- rejects cleared/invalid payloads;
- rejects fully fogged fragments;
- performs the same base-texture alpha-cutoff test used by the alpha scene pass;
- returns the integer pick tuple without changing visible scene shading.

The picking pipelines preserve triangle-list topology, `frontFace: ccw`, the current cull/no-cull choice, `depth24plus`, depth writes, and `less-equal` depth comparison.

## Asynchronous readback

`WebGPUStaticPickingController` is intentionally on-demand. The normal A/B render loop performs no readback work.

For one request it:

1. updates a dedicated scene uniform buffer;
2. renders the current static scene into an integer id target plus a fresh depth target;
3. uses a 1x1 scissor at the requested canvas pixel to reduce fragment work;
4. copies exactly one `rgba32uint` pixel into a 256-byte-row-aligned staging buffer;
5. submits the command buffer;
6. waits for `mapAsync(READ)` without blocking the render thread;
7. copies the four words, unmaps immediately, and resolves the decoded result.

Only one readback is allowed in flight. If cursor requests arrive faster than readback completes, the controller keeps only the newest pending request and resolves the superseded pending request as no result. This prevents an unbounded GPU/readback queue.

The 1x1 scissor does **not** reduce vertex-shader work. The porting guide's cursor-frustum/chunk narrowing remains a later performance checkpoint once the renderer has suitable chunk-level draw metadata. Correctness comes first here.

## Authority and activation

This picker does not replace CPU interaction yet. The current client still uses `SceneRaycaster`, which already covers dynamic players/NPCs and current menu behavior. The WebGPU picker is a backend capability ready for validation and later full-renderer activation.

Before making it authoritative, validate at least:

- terrain edges and bridge planes;
- alpha-cutout fences/foliage;
- thin doors and wall decorations;
- multi-tile locs;
- animated loc frame changes;
- ground items;
- world-entity transforms;
- fog boundary behavior;
- culling enabled/disabled;
- full-detail/LOD transitions;
- static vs dynamic occlusion once dynamic picking is ported.
