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

Status: terrain foundation in progress.

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

After terrain parity, continue with static scenery/locs.

### 4. Ordering, depth, culling, and picking

Status: pending.

Carry over face priorities, wall/decor depth rules, back-face culling, chunk culling, and asynchronous picking.

### 5. Dynamic scene

Status: pending.

Port animated locs, players, NPCs, projectiles, spot animations, and interaction highlights.

### 6. 2D/UI

Status: pending.

Port widgets, minimap, sprites, fonts, model previews, overlays, masks, and scissor behavior.

### 7. Parity and hardening

Status: pending.

Add A/B image validation, debug switches, timing/memory instrumentation, browser coverage, and device-loss/fallback tests.

### 8. PR and merge

Status: pending.

One PR from the migration branch after the WebGPU path is complete and WebGL2 fallback remains validated.
