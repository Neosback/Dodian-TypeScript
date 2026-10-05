# WebGPU migration checkpoints

Working branch: `feat/webgpu-renderer`

This file tracks the staged client migration defined by `docs/WEBGPU_PORTING_GUIDE.md`.

## Guardrails

- WebGPU becomes the preferred backend only after parity checks are in place.
- WebGL2 remains the fallback for unsupported adapters, device creation failure, and device loss.
- Only one graphics backend may own GPU resources for a session.
- CPU game state and scene construction must not depend on a graphics API.
- Backend-specific resources and commands must not leak into renderer-neutral frame data.
- Preserve OSRS ordering, HSL, animation timing, wall/decor rules, culling, and picking behavior.

## Checkpoints

### 1A. Graphics backend lifecycle seam

Status: implemented on this branch.

- Move PicoGL/WebGL2 context creation out of the renderer initialization body.
- Centralize WebGL2 extension probing, base state, timer creation, and draw-backend ownership.
- Keep existing renderer fields mirrored so behavior stays unchanged while the seam is introduced.
- Dispose backend-owned resources from the renderer cleanup path.

### 1B. Renderer-neutral frame description

Status: implemented on this branch.

- Add a reusable CPU-owned `SceneFrameDescription` with no graphics API types.
- Copy camera matrices, viewport geometry, timing, fog, colour, visibility, and scene settings into it each frame without per-frame allocation.
- Move the WebGL2 scene-uniform mapping into a backend-specific uploader.
- Keep existing rendering order and shader uniform layout unchanged.

### 1C. Renderer-neutral overlay command boundary

Status: implemented on this branch.

- Represent ordered overlay passes as API-neutral commands containing phase, registration order, and optional viewport clipping.
- Remove PicoGL scissor state from `OverlayManager`.
- Execute the same command stream through a WebGL2-specific executor.
- Reuse command/clip objects instead of allocating draw-command objects in the frame loop.
- Individual overlay geometry remains WebGL-backed until the dedicated 2D/UI migration checkpoint.

### 2. Backend selection and WebGPU device bootstrap

Status: bootstrap infrastructure implemented on this branch.

- Parse `?renderer=webgpu` and `?renderer=webgl2` preferences, with `webgl` accepted as a legacy alias.
- Resolve backend order with WebGPU preferred in auto mode and WebGL2 retained as fallback.
- Execute device-level fallback when WebGPU adapter/device initialization fails, while deferring WebGL2 context creation to the concrete renderer.
- Add async high-performance WebGPU adapter/device initialization.
- Keep device creation separate from canvas context acquisition so fallback can replace the canvas instead of attempting two graphics context types on one canvas.
- Configure the preferred WebGPU canvas format and explicit alpha mode.
- Report uncaptured validation errors and device-loss details through callbacks.
- Add WGSL compilation diagnostics that surface line/column errors before pipeline creation.
- Do not activate WebGPU as the live renderer until the static scene pass exists; the current client remains WebGL2-backed to avoid a blank intermediate renderer.

### 3. Static scene

Status: terrain and static-scenery foundation in progress.

#### 3A. Terrain geometry/render-pass foundation

Status: implemented on this branch.

- Reuse the worker-produced 12-byte packed terrain vertex format and uint32 index data without CPU repacking.
- Add WGSL-compatible scene-uniform packing with explicit alignment and WebGL fog-distance parity.
- Add a WebGPU terrain pipeline shell with depth24plus, back-face culling, viewport/scissor state, and per-plane roof culling.
- Add per-map terrain GPU resources and draw-range conversion directly from `SdMapData`.
- Add a first WGSL terrain shader that decodes packed position/HSL/alpha/priority, applies scene HSL override, fog, load fade, brightness, and color banding.
- Keep textured terrain on a temporary light-only color path until the shared WebGPU texture/material array is implemented in 3B.
- Do not activate the WebGPU renderer in the live client yet.

#### 3B. Terrain textures/material parity and A/B activation

Status: in progress.

##### 3B.1. Shared material table and ordinary texture sampling

Status: implemented on this branch.

- Extract the six-row signed-byte material table builder so WebGL2 and WebGPU consume the same animation/alpha/water metadata.
- Use a 2D WebGPU texture atlas instead of a large texture array, avoiding WebGPU's conservative array-layer limits while retaining the existing packed texture-layer indices.
- Initialize missing/unstreamed atlas cells to white, matching the current WebGL2 fallback behavior.
- Upload streamed cache ARGB bytes without color repacking and keep the GLSL-equivalent BGRA swizzle in WGSL.
- Port packed UV decoding, per-texture UV scrolling, animated-frame selection, nearest texel sampling, palette lighting, brightness, and alpha composition.
- Keep the atlas path at mip level 0 while the current default nearest filtering mode is used.
- Add runtime methods to replace/update WebGPU terrain texture resources without rebuilding map geometry.

##### 3B.2. Water/material effects and opt-in A/B activation

Status: water shader/resources and opt-in A/B activation implemented.

- Upload each map square's existing four-plane RGBA water mask into a WebGPU 2D-array texture, including conservative 256-byte row padding.
- Upload the five shared normal/flow/foam/caustics assets once as a global WebGPU texture array with repeat + linear sampling.
- Provide deterministic fallback water maps so missing auxiliary assets do not produce undefined GPU reads.
- Port the current GLSL water-mask shoreline/depth reconstruction, normal blending, flow animation, Fresnel/specular, foam, depth tint, and caustics calculations to WGSL.
- Reuse the exact shared signed-byte material table for all water parameters and flags.
- Keep the existing CPU height-map data out of this pass because the current water fragment shader does not sample it.
- Add `?webgpuTerrain=1` (also `true`, `compare`, or `split`) as an explicit terrain comparison mode.
- Keep WebGL2 authoritative on the normal canvas while a separate WebGPU canvas renders the same terrain on the right half of the viewport.
- Mirror streamed texture pixels and accepted full map payloads into WebGPU without duplicating the worker/cache scene builder.
- Chain map-removal callbacks so pruned WebGL map squares remove their WebGPU terrain resources too.
- On WebGPU init, render, validation, or device-loss failure, immediately hide/dispose the comparison surface and leave WebGL2 running.
- Keep `?renderer=webgpu` reserved for the eventual full renderer instead of silently treating a terrain-only preview as a complete backend.
- Submit terrain alpha ranges after opaque terrain, preserve WebGL's reverse visible-map traversal for the alpha pass, and apply the same material alpha-cutoff discard rule.
- Preserve WebGL's current transparent-terrain depth behavior: depth test `less-equal` with depth writes still enabled.
- Cache cull/no-cull variants for both opaque and alpha terrain pipelines and select from `SceneFrameDescription.cullBackFace` without rebuilding pipelines in the frame loop.

#### 3C. Static scenery/locs

Status: opaque, alpha, LOD, mutable replacement, doors, animated loc draw-range parity, primary world-entity transforms, ground-item parity, placement-metadata plumbing, and cardinal/decoration camera-relative depth rules implemented; diagonal boundary ordering and full face priority remain pending.

- Reuse the worker's existing 12-byte packed loc vertex/index payload without repacking geometry.
- Decode the existing `modelTextureData` draw headers and instance records into a WebGPU storage buffer rather than creating a second placement format.
- Preserve renderer-neutral loc model type, source rotation, and primary/secondary scene-part identity from `getSceneLocs`, including two-part walls and double wall decorations.
- Append a versioned placement-metadata trailer after the legacy model-info header/instance records so WebGL2 continues consuming the same texels and worker payload type while WebGPU can opt into the additional ordering metadata.
- Split merged static-model draw runs only when placement identity changes, preserving scene order while preventing incompatible wall/decor placements from collapsing behind one synthetic model-info record.
- Parse the optional trailer in the WebGPU loc plan with backward compatibility for older packets, and fold its encoded value into the unused upper 16 bits of `info.w` while retaining the legacy interaction ID in the lower 16 bits.
- Define renderer-neutral CPU reference rules for the documented `3/128` ground pull, `2/128` wall-decoration pull, `10/128` wall-behind push, `8/128` roof pull, and `2/128` per-plane bias.
- Match the original cardinal boundary orientation table `{1,2,4,8}`, including the second part of type-2 corner walls, without incorrectly mapping type-1/type-3 diagonal boundary masks into cardinal edges.
- Reproduce the software client's `orientation == 256` camera comparison for decoration types 6, 7, and 8 so only the painter-selected diagonal decoration part remains visible.
- Inject the same CPU-tested placement rules into the A/B WGSL shader through the existing static-scene shader-source transform, decoding placement metadata from the upper half of `info.w` without changing the legacy WebGL model-info ABI.
- Replace the provisional terrain/loc plane `0.001` offset in the transformed WebGPU shader with the documented `2/128` per-plane separation so terrain and placed geometry use the same plane convention.
- Apply cardinal wall push-back only while the camera is not outside that wall edge, flip cardinal wall decorations between front/back pulls based on camera side, and apply ground/roof pulls from the same placement classification used by the CPU reference.
- Preserve the old model-priority nudge only for legacy/non-placement records; placement-aware locs use the explicit wall/decor/roof/ground rules instead.
- Keep the temporary packed 3-bit per-face depth bias for now. Full OSRS face-priority 0..11 sorting and priority 10/11 threshold behavior remain the next dedicated ordering checkpoint.
- Leave type-1/type-3 diagonal boundary pieces on zero special pull for now rather than inventing a cardinal approximation; their original 16/32/64/128 delayed-wall ordering remains explicit follow-up work.
- Upload the existing four-plane signed height map as `r16sint`, with WebGPU row padding, and port the same two-diagonal contour interpolation used by GLSL.
- Render ordinary opaque `loc` geometry after each map square's opaque terrain, matching the current WebGL map-local ordering.
- Preserve render plane, roof-cull plane, model priority, per-face priority, texture animation, fog, map load fade, brightness, and height contouring.
- Reuse the terrain map/water bind group and the shared texture/material/water resources so loc fragment shading stays on the same material path.
- Build separate model-info storage/bind-group resources for opaque, alpha, LOD, and LOD-alpha loc batches, matching the existing WebGL model-info textures.
- Mirror WebGL's map-level visibility policy in the A/B path: identical cull tile, render-distance skip, tile-distance LOD threshold, and visible-map ordering.
- Select the same full-detail vs LOD terrain and loc batches for each map square instead of making independent backend-side distance decisions.
- Render transparent locs immediately after transparent terrain for the same map while traversing visible maps in reverse order.
- Use the shared `fsMainAlpha` cutoff path plus `SRC_ALPHA / ONE_MINUS_SRC_ALPHA`, `less-equal` depth testing, and depth writes enabled for transparent loc parity.
- Cache cull/no-cull variants for opaque and alpha loc pipelines rather than rebuilding pipeline state in the frame loop.
- Keep door vertex/index/model-info resources independent from ordinary loc resources so a `doorOnly` payload can replace doors without touching terrain or locs.
- Map the worker's eight door model-info/range variants into the same static-loc GPU format; the current comparison uses the ordinary opaque/alpha and LOD variants while preserving the interaction variants for later picking/highlight work.
- Render doors after ordinary locs for each map in both opaque and transparent passes, preserving their relative WebGL scene order.
- Mirror valid `locOnly` and `doorOnly` updates only after WebGL commits the corresponding `MapManager.addMap`, rather than when a worker payload merely enters the queue.
- Preserve FIFO ordering for multiple partial updates targeting the same map and discard queued partials when a full payload supersedes them.
- Restore all queue/map observers during comparison disposal, device-loss fallback, or validation failure so the opt-in A/B path cannot leave hooks installed.
- Mirror animated ordinary locs from each authoritative `WebGLMapSquare.locsAnimated` object after WebGL advances its sequence state, avoiding a second animation clock or random-start calculation in WebGPU.
- Apply animated frames by mutating only WebGPU CPU draw metadata (index offset, index count, and instance count) for the selected full-detail/LOD opaque and alpha passes; static vertex/index/model-info GPU buffers are not rewritten per frame.
- Preserve model placement, roof-plane metadata, and initially hidden animation slots while draw counts change; zero-count slots retain their model records so later frames can reactivate them.
- `locOnly` replacement naturally swaps both the ordinary WebGPU loc resource and the WebGL animation source used by the comparison on the next frame.
- Allow world-entity overlay map payloads (`mapX/mapY >= 200`) into the WebGPU comparison instead of excluding them, preserving the worker's `renderPosX/renderPosY` placement override.
- Expand the per-map uniform block from 32 to 96 bytes with an identity `mat4` at byte offset 32; ordinary maps therefore retain identical rendering while overlay maps can update only their transform bytes.
- Apply the world-entity matrix after `scene.viewMatrix` and before projection for both terrain and loc/door vertex paths, exactly matching WebGL's `u_worldEntityTransform * (u_viewMatrix * worldPos)` ordering.
- Keep `worldPos`, fog distance, water UVs, and water lighting on the untransformed world/view inputs, matching the existing GLSL behavior.
- Reuse the authoritative `WorldEntityAnimator` matrix each frame and copy it into the existing map uniform buffers only when it changes; terrain, loc, and door geometry are not rebuilt for bobbing/motion.
- Keep the WebGPU backend's shader-source transform generic and opt-in; the A/B comparison applies the static-scene patch only to the `terrain-foundation` WGSL module.
- Primary transformed world-entity terrain/loc/door rendering is covered here. The special overlap/ghost redraw/opacity path and dynamic world-entity NPC content remain later parity work.
- Reuse the authoritative `buildGroundItemGeometry` CPU output instead of performing a second WebGPU-specific item-stack selection, item-model load, bridge-plane resolution, or mesh build.
- Publish versioned ground-item geometry snapshots against the actual `WebGLMapSquare` object and lazily mirror a changed or cleared snapshot when that same map becomes visible in the A/B comparison.
- Map ground-item vertices, uint32 indices, model-info tables, opaque/alpha ranges, LOD ranges, and roof-plane metadata into the existing static-loc GPU resource contract; interaction variants remain available for the later picking/highlight stage.
- Reuse each map square's retained signed `heightMapData` and `heightMapSize` so ground-item `CENTER_TILE` contouring samples the same bridge-aware height data as the WebGL path.
- Preserve WebGL's map-local order in both passes: terrain -> ordinary locs -> ground items -> doors. Transparent maps still traverse in reverse visible-map order.
- Ground items use the same roof-plane filter, full-detail/LOD selection, material/texture path, alpha cutoff, depth behavior, and per-map world-entity transform as other static model geometry.
- Ground-item texture loads already flow through `updateTextureArray`, which mirrors the streamed pixel payload into the WebGPU comparison before the WebGL array upload path.
- Preserve WebGL's missing-model retry behavior because the WebGPU snapshot is produced by the same CPU rebuild attempt; an empty/failed build clears the comparison geometry until the authoritative builder produces a later revision.
- Loc, door, and ground-item resources currently own separate copies of the small per-map signed height texture to keep their replacement lifetimes independent; consolidate this to shared map-level ownership during performance hardening if profiling justifies it.
- Remaining static-scene ordering work is the type-1/type-3 diagonal boundary delayed-wall path plus full face-priority ordering. Special world-entity overlap/ghost rendering remains later ordering/parity work.

### 4. Ordering, depth, culling, and picking

Status: in progress.

Cardinal wall/decor camera-relative depth rules and diagonal decoration selection are now implemented in the WebGPU comparison. Remaining work includes type-1/type-3 diagonal boundary delayed-wall ordering, full 0..11 face priorities, chunk/entity culling parity, and asynchronous picking.

### 5. Dynamic scene

Status: pending.

Animated ordinary loc draw-range parity is already handled in 3C. Remaining dynamic-scene work includes players, NPCs, projectiles, spot animations, skinned/other dynamic scenery, world-entity dynamic content, and interaction highlights.

### 6. 2D/UI

Status: pending.

Port widgets, minimap, sprites, fonts, model previews, overlays, masks, and scissor behavior.

### 7. Parity and hardening

Status: pending.

Add A/B image validation, debug switches, timing/memory instrumentation, browser coverage, and device-loss/fallback tests.

### 8. PR and merge

Status: pending.

One PR from the migration branch after the WebGPU path is complete and WebGL2 fallback remains validated.