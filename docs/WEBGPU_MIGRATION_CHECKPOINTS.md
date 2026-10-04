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
- Keep device creation separate from canvas context acquisition so fallback can replace the canvas instead of attempting two graphics context types on one element.
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

Status: opaque, alpha, LOD, mutable replacement, doors, animated loc draw-range parity, and primary world-entity transforms implemented; ground items and specialized ordering remain pending.

- Reuse the worker's existing 12-byte packed loc vertex/index payload without repacking geometry.
- Decode the existing `modelTextureData` draw headers and instance records into a WebGPU storage buffer rather than creating a second placement format.
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
- Render doors after ordinary locs for each map in both opaque and transparent passes, preserving their relative WebGL scene order (ground items remain a later port).
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
- Loc and door resources currently own separate copies of the small per-map signed height texture to keep their replacement lifetimes independent; consolidate this to shared map-level ownership during performance hardening if profiling justifies it.
- Remaining static-scene work includes ground-item parity and the dedicated wall/decor depth/order rules.

### 4. Ordering, depth, culling, and picking

Status: pending.

Carry over face priorities, wall/decor depth rules, back-face culling, chunk culling, and asynchronous picking.

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
