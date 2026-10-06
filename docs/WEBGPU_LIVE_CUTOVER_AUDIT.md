# WebGPU live cutover audit

Working branch: `feat/webgpu-renderer`

Audit baseline: `88c8c46f74667c03deb2068d3246a75a89d9b3c9`

This document is the authoritative remaining-work audit for converting the existing WebGPU comparison renderer into the production live renderer with WebGL2 fallback. It reconciles the actual branch state after the dynamic renderer, combined picking, and M4 picking-parity work. Where older migration notes still describe the dynamic scene as pending, this audit supersedes that status.

## Target production behavior

The final client should use WebGPU as the preferred live graphics backend when it can initialize successfully. WebGL2 remains a fully supported production fallback.

- `auto`: try WebGPU, then WebGL2.
- `?renderer=webgpu`: request WebGPU first, but fall back to WebGL2 if WebGPU cannot initialize safely.
- `?renderer=webgl2` and legacy `?renderer=webgl`: use WebGL2.
- A fatal WebGPU device loss or unrecoverable runtime graphics failure must tear down WebGPU state cleanly and transition to WebGL2 without leaving comparison hooks, observers, or GPU resources installed.
- Only one live graphics backend owns the production canvas and GPU resources at a time.

## Verified foundations already implemented

### Backend/device foundation

The branch already contains:

- `GraphicsBackend` with `webgpu` and `webgl2` kinds.
- backend preference parsing and ordering.
- device-level WebGPU bootstrap with WebGL2 fallback selection.
- a WebGPU backend that owns adapter/device lifetime, canvas configuration, device-loss reporting, uncaptured-error reporting, and WGSL compilation diagnostics.
- a WebGL2 backend that owns PicoGL/WebGL2 context setup and base state.

The remaining problem is not capability detection. The existing bootstrap is not yet wired into the real client renderer startup path.

### Renderer-neutral frame and overlay scheduling data

`SceneFrameDescription` already carries API-neutral camera matrices, viewport state, timing, fog, visibility, brightness, HSL override, and related scene settings.

Overlay scheduling and viewport clipping are represented by API-neutral commands. The current executor is WebGL2-specific and overlay geometry is still PicoGL-backed.

### Static WebGPU scene

The WebGPU A/B renderer already covers the major static scene path, including:

- terrain and texture/material sampling;
- water;
- ordinary locs, transparent locs, LOD locs, and animated loc draw ranges;
- doors and mutable loc/door replacement;
- ground items;
- world-entity transforms for the implemented static path;
- wall/decor depth rules and diagonal-decoration selection;
- delayed-wall ordering;
- exact OSRS face priorities `0..11`;
- static culling/visibility parity;
- static picking.

### Dynamic WebGPU scene

The dynamic comparison renderer is not pending. The branch already implements migrated WebGPU paths for:

- player opaque;
- player alpha;
- NPC opaque;
- NPC alpha;
- actor-attached GFX;
- world-tile GFX;
- projectiles.

Shared dynamic height-map and growable instance-buffer resource mechanics have also been consolidated.

### Picking parity infrastructure

Static and player/NPC dynamic picking feed the combined WebGPU picker. M4 adds passive CPU/GPU parity recording while leaving the CPU `SceneRaycaster` authoritative for gameplay interaction.

CPU interaction authority is acceptable for the first production WebGPU cutover. A WebGPU renderer does not need GPU-authoritative clicking merely to become the live graphics backend. GPU interaction authority should change only if browser parity evidence and a concrete client requirement justify it.

## Current production blockers

### 1. Live initialization is still unconditionally WebGL2

`client/render/render/init/core.ts` directly creates `WebGL2GraphicsBackend`, mirrors its PicoGL objects onto `WebGLOsrsRenderer`, then creates WebGL vertex buffers, shader programs, uniform buffers, framebuffers, textures, player resources, and other renderer state from `host.app` and `host.gl`.

This makes WebGL2 the actual renderer owner regardless of the backend-selection infrastructure elsewhere in the branch.

### 2. The render-module host contract is WebGL-specific

`client/render/render/hostInterface.ts` currently aliases the render-module host directly to `WebGLOsrsRenderer`.

The extracted `client/render/render/*` modules therefore still assume the existence of PicoGL/WebGL fields and WebGL-specific map/resource classes. A production WebGPU path needs a smaller renderer-neutral host/state contract for shared game/render orchestration and backend-specific owners for graphics resources.

Do not create a second parallel top-level renderer lifecycle abstraction. `Renderer` and `GameRenderer` already own initialization, animation scheduling, resize, start/stop, input lifetime, map-manager lifetime, and cleanup. The migration should reuse those existing lifecycle classes.

### 3. Map acceptance and residency are WebGL-first

`client/render/render/map.ts` currently creates or refreshes `WebGLMapSquare` with PicoGL programs, textures, uniform buffers, and `host.app`. Only after the WebGL map is committed does the comparison path mirror accepted `SdMapData` into WebGPU.

This is a critical cutover dependency. WebGPU must be able to consume accepted full and partial map payloads without requiring a `WebGLMapSquare` to exist first.

The production architecture needs a renderer-neutral map residency/accepted-payload layer that preserves:

- full-map commits;
- `locOnly` and `doorOnly` replacement semantics;
- FIFO partial-update ordering;
- animation source/state needed by both backends;
- minimap registration;
- ground-item rebuild triggers;
- texture streaming/update notifications;
- world-entity placement identity and transforms;
- map removal/pruning lifecycle.

WebGL2 and WebGPU should each build their own GPU resources from that shared accepted scene state.

### 4. WebGPU execution is still comparison-owned

The current comparison path:

- creates a second canvas;
- mirrors state from the live WebGL renderer;
- wraps WebGL queue/map callbacks;
- renders at the end of the WebGL frame;
- tears itself down while leaving WebGL authoritative if WebGPU fails.

This comparison infrastructure is valuable until cutover validation is complete, but it cannot be the final production ownership model.

### 5. Several dynamic phases still use transitional wrapper extraction

The ordered opaque/transparent phase registries are already the authoritative WebGPU draw-order mechanism, but several player/GFX/projectile implementations are still obtained by temporarily installing historical prototype wrappers against no-op predecessors and capturing the resulting closures.

Before the production path is considered clean, those migrated implementations should become ordinary exported/registered phase functions with explicit lifetime rather than prototype wrapper extraction. Behavior and ordering must remain unchanged during that cleanup.

### 6. 2D/UI/overlay GPU execution is still WebGL2-specific

`OverlayManager` already has an API-neutral scheduling seam, but the existing overlay implementations are initialized with PicoGL `app` and a WebGL uniform buffer. Screen/world overlay programs are GLSL/PicoGL resources, and the only command executor is currently WebGL2-specific.

The remaining UI scope includes the GPU composition path for:

- widgets;
- sprites and masks;
- fonts/text;
- overhead and world overlays;
- minimap presentation/composition;
- clipping/scissor behavior;
- loading/login/client overlay surfaces;
- interaction highlight rendering.

`Model2DRenderer` itself is software rasterization to an HTML canvas. It does not need to be rewritten as a WebGPU 3D model renderer. The WebGPU UI path only needs to upload/composite the software-produced result where required.

### 7. Client renderer selection still exposes only WebGL

`client/game/GameRenderers.ts` defines only the `webgl` renderer type and always constructs `WebGLOsrsRenderer`.

The existing backend preference/bootstrap code therefore cannot currently select the real live renderer. This file, together with the concrete renderer construction path, is a production cutover point.

### 8. React Canvas still owns comparison behavior

`client/ui/Canvas.tsx` mounts the existing renderer canvas, installs the WebGPU dynamic comparison lifecycle and M4 parity recorder, then optionally mounts the comparison canvas.

The final host should mount one live renderer canvas. Comparison instrumentation may remain behind an explicit developer/debug mode, but generic React canvas ownership should not be responsible for installing the production WebGPU renderer.

### 9. Frame completion and cache initialization depend on WebGL

The current WebGL frame-completion path invokes the WebGPU comparison render and reads WebGL timer/app/resource state for statistics. Cache initialization also starts the comparison path only after WebGL resources exist.

WebGPU must eventually own its own frame timing, resize, cache/resource initialization, and statistics without requiring a WebGL frame to run first.

### 10. Runtime fallback is infrastructure, not yet a full renderer transition

`WebGPUGraphicsBackend` reports initialization failures and device loss, and `bootstrapGraphicsBackend` can choose WebGL2 after WebGPU initialization failure. Today that logic does not reconstruct the complete live client renderer.

Production fallback must coordinate renderer teardown/replacement, canvas ownership, input attachment, resize observers, map/scene restoration, and UI state.

## Refined cutover order

The safest implementation order is below. Each stage should remain independently reviewable and preserve a working WebGL2 renderer.

### A. Baseline validation

Before more architecture changes, run and record:

- client TypeScript typecheck;
- `test:webgpu-foundation`;
- full client test suite;
- production build.

Classify any pre-existing failures before changing ownership.

### B. Renderer-neutral shared host/scene seams

Reuse existing `Renderer` and `GameRenderer` lifecycle. Extract only the shared state and operations currently hidden behind `WebGLOsrsRendererHost` that both graphics paths require.

Do not make backend-neutral interfaces carry PicoGL, WebGL, or WebGPU resource types.

### C. Renderer-neutral map residency and accepted scene feed

Separate accepted CPU map/scene state from `WebGLMapSquare` GPU resources. Make full and partial `SdMapData` updates observable/consumable by either backend without WebGL being constructed first.

This is the main prerequisite for a genuinely independent live WebGPU world renderer.

### D. Live-owned WebGPU 3D scene

Promote the existing WebGPU static scene renderer and migrated dynamic phases from comparison ownership into one live WebGPU 3D path on the primary canvas.

During this stage WebGL2 remains available as a separate fallback renderer. CPU `SceneRaycaster` stays authoritative for menus, hover, clicks, and interaction unless a later parity decision changes that.

### E. Dynamic implementation cleanup and remaining parity

Replace transitional prototype-wrapper extraction with explicit registered phase implementations. Audit the remaining special world-entity overlap/ghost/opacity behavior and any scene category not actually covered by the live path.

### F. WebGPU 2D/UI compositor

Implement the WebGPU overlay command executor and backend-specific UI draw resources for sprites, text, widgets, masks, minimap composition, world overlays, and clipping. Reuse software-produced UI/model canvases as upload sources where appropriate instead of rewriting software rasterizers unnecessarily.

### G. Production renderer selection

Wire `GameRenderers.ts`, renderer construction, and backend bootstrap so the client normally selects WebGPU first and WebGL2 second. Remove the requirement for a comparison canvas from normal startup.

`Canvas.tsx` should return to being a generic host for the selected renderer rather than the installer for WebGPU comparison behavior.

### H. Fallback and device-loss recovery

Exercise and validate:

- missing WebGPU API;
- adapter unavailable;
- device creation rejection;
- canvas configuration failure;
- shader/pipeline initialization failure;
- WebGPU device loss while running;
- resize during async initialization;
- teardown during initialization;
- fallback renderer reconstruction.

The recovery path must leave no stale GPU resources, callbacks, listeners, comparison hooks, or canvases behind.

### I. Visual, interaction, lifecycle, and performance hardening

Use representative browser/GPU tests for terrain, water, walls/decor, alpha ordering, roofs, players/NPCs, effects, UI, minimap, and long-running sessions. Preserve the existing parity recorders/debug tools where they help validate the live path.

Profile before consolidating or optimizing additional resources.

### J. Cleanup, one PR, and merge

After WebGPU is the validated live default:

- remove obsolete comparison-only hooks and duplicate lifecycle code;
- reconcile older migration documentation;
- retain useful explicit renderer/debug overrides;
- run full validation again;
- open one PR from `feat/webgpu-renderer` to `main`;
- review the complete diff and CI;
- merge only after the full path and WebGL2 fallback are clean.

## Guardrails for the remaining work

- Do not add another top-level renderer lifecycle interface alongside `Renderer`/`GameRenderer`.
- Do not delete or intentionally degrade WebGL2. It is the supported fallback.
- Do not make GPU picking authoritative merely to satisfy the WebGPU cutover. CPU interaction can remain authoritative while rendering is WebGPU-backed.
- Do not let WebGPU production state depend on a `WebGLMapSquare`, PicoGL program, WebGL framebuffer, or WebGL frame callback.
- Do not switch all ownership in one commit. Establish shared CPU state and live backend ownership in stages.
- Do not optimize away comparison/parity instrumentation until the production path has enough evidence to replace it safely.
- Preserve OSRS ordering, animation timing, culling, texture/material semantics, wall/decor rules, face priorities, interaction behavior, and UI placement while changing graphics ownership.

## Definition of live-renderer readiness

WebGPU is ready to become the default only when all of the following are true:

- it initializes and renders without a WebGL context being required first;
- accepted map state can populate WebGPU resources independently of `WebGLMapSquare`;
- the migrated static and dynamic scene paths execute from live production ownership;
- the visible 2D/UI path is WebGPU-capable;
- normal startup uses one production canvas;
- WebGL2 can still be selected explicitly;
- WebGPU initialization failure falls back to WebGL2;
- runtime WebGPU loss can transition to WebGL2 cleanly;
- CPU interaction remains correct, regardless of whether GPU picking is observational or authoritative;
- typecheck, tests, production build, visual parity, and lifecycle checks pass.

## Next checkpoint

Run the baseline validation suite before changing renderer ownership. Any failures found there should be classified as pre-existing branch failures or migration regressions before the host/map architecture is modified.
