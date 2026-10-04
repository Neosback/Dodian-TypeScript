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
- Add async high-performance WebGPU adapter/device initialization.
- Keep device creation separate from canvas context acquisition so fallback can replace the canvas instead of attempting two graphics context types on one element.
- Configure the preferred WebGPU canvas format and explicit alpha mode.
- Report uncaptured validation errors and device-loss details through callbacks.
- Add WGSL compilation diagnostics that surface line/column errors before pipeline creation.
- Do not activate WebGPU as the live renderer until the static scene pass exists; the current client remains WebGL2-backed to avoid a blank intermediate renderer.

### 3. Static scene

Status: pending.

Port terrain first, then static scenery, with WebGL2 A/B comparison.

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
