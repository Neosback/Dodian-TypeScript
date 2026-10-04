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

Status: pending.

Extract the minimum per-frame CPU description needed by both backends: timing, viewport, camera matrices, visibility state, scene settings, and renderer-neutral overlay commands.

### 2. Backend selection and WebGPU device bootstrap

Status: pending.

Add WebGPU capability detection, explicit renderer preference, async adapter/device initialization, shader diagnostics, device-loss handling, and automatic WebGL2 fallback.

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
