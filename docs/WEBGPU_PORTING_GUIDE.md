# WebGPU for an OSRS-style client: porting guide

Notes from moving the OpenRune map editor from WebGL2 to WebGPU (TypeScript + WGSL), written for the next job: porting a
**full client** that currently renders with WebGL2. It covers what WebGPU changes, what you must carry over from the
original software renderer so the picture stays right, how to verify that, and the mistakes that cost us time.

Reference implementation in this repo: `client/src/mapeditor/webgpu/` (`WebGPUObjectPass.ts`, `object-pass.wgsl`,
`face-priority-sort.wgsl`, `object-mesh-merge.ts`, `terrain-compact.ts`, `WebGPUViewport.ts`). The older WebGL2 path it
was ported from is `client/src/mapviewer/webgl/` (`shaders/main.vert.glsl`, `main.frag.glsl`). Design history and
measurements: `docs/WGPU_RENDERER_PLAN.md`.

---

## 1. Decide what you are porting, and in what order

A full client is more than a map. Port in this order, verifying each step against the old renderer before moving on:

1. **Static scene**: terrain, then static scenery (the biggest chunk of triangles, simplest data).
2. **Ordering and depth rules** (section 4). This is where OSRS differs most from a normal 3D game.
3. **Picking** (what is under the cursor) and tile highlights.
4. **Animated scenery** (frame swapping), then **skinned entities** (players, NPCs, projectiles, spot animations).
5. **2D layer**: interfaces, sprites, fonts, minimap, overlays (hit splats, overhead text, health bars).
6. **Everything else**: sky, weather, login screen, screenshots, capture.

Keep the old renderer working behind a switch for the whole port. It is your reference for A/B comparison, and your
fallback for browsers without WebGPU.

### WebGPU vs WebGL2 vs native wgpu

- **WebGPU in TypeScript** was the right first target for us: the data is already typed arrays in JS, there is no
  boundary-crossing cost per frame, and compute shaders (impossible in WebGL2) unlock GPU face sorting and GPU culling.
- **Rust/wgpu** only pays off if you want a native window (for example Tauri without a web view for rendering). It does not
  speed up a browser build. Keep Rust/WASM for CPU kernels (model decode, mesh packing), not for issuing draw calls.
- **Keep WebGL2 as a legacy fallback** until WebGPU support is boring for your audience. Do not let it keep GPU memory:
  we measured about 100 MB of unused WebGL2 resources sitting beside the WebGPU ones until we made the WebGL2 side a
  CPU-only shell. If you keep a fallback, decide up front whether it shares the CPU engine (best) or is a separate renderer.

---

## 2. Architecture that made the port possible

Split the client into three layers. If you only do one thing from this document, do this before touching WebGPU:

| Layer | Owns | Must not know about |
| --- | --- | --- |
| **Engine** (CPU) | Cache decoding, scene build, models, animation clocks, input, tools, picking *logic*, what is visible | Any graphics API |
| **Render data** | Packed typed arrays: vertex words, indices, per-model records, height/flag textures, uniform values | Draw calls |
| **Backend** (WebGPU / WebGL2) | Buffers, pipelines, passes, draw calls, readback | Game rules |

What went wrong when we did not have this split: the editor's engine and its WebGL2 renderer were one class
(`WebGLMapEditorRenderer`), so WebGPU had to be bolted on as a "bridge" that reads the WebGL renderer's state and replays
its overlay draw calls. It works, but retiring WebGL2 now requires splitting that class first. Do the split first.

Practical rules:

- Have the engine produce a **frame description** (`ObjectPassFrame` here: matrices, time, plane limits, which
  chunks are visible, overlay commands) and let the backend consume it. Overlays (grid, highlights, outlines) should be
  **renderer-neutral commands** (`overlay-commands.ts`), not GL calls recorded after the fact.
- Keep every number that decides how a pixel looks in one place and port it **line for line** (HSL decode, lighting,
  texture animation, fog). We kept the WGSL shader structurally identical to the GLSL it replaced so a diff reads cleanly.
- Make the backend swappable per session (`?renderer=webgl2`, a stored preference), with automatic fallback on adapter or
  device failure.

---

## 3. WebGPU essentials and traps

### 3.1 Startup

```ts
if (!navigator.gpu) throw new Error("no WebGPU");                 // feature-detect first, fall back
const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
const features = ["timestamp-query"].filter((f) => adapter.features.has(f)); // optional; request what exists
const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize },
});
device.lost.then((info) => { /* rebuild everything, or fall back to the other renderer */ });
```

- **Everything is async**: adapter, device, shader compilation info, pipeline creation (`createRenderPipelineAsync`),
  readback. Plan startup as a promise chain, not a constructor.
- **Handle `device.lost`.** Tab backgrounding, driver resets and GPU switching all do this. Rebuild or fall back.
- **Read shader compile errors explicitly**: `module.getCompilationInfo()`. A WGSL error does not throw where you expect.
  Log it with line numbers. We shipped for a while with the shader failing to compile in one browser and **silently**
  falling back to WebGL2 (see 3.4). Surface the active backend in the UI (we put "WebGPU / WebGL2" in the status bar).
- Configure the canvas with `navigator.gpu.getPreferredCanvasFormat()` and `alphaMode: "opaque"` for a game canvas.
- Handle `devicePixelRatio` deliberately: it is your biggest fragment cost on Retina/4K screens. Offer a pixel-ratio cap.

### 3.2 Differences from WebGL2 that bite

| WebGL2 / GLSL | WebGPU / WGSL |
| --- | --- |
| Clip-space z in `[-w, w]` | Clip-space z in `[0, w]`: fix the projection or `position.z = (z + w) * 0.5` in the vertex shader |
| Texture origin bottom-left | Top-left (flip V, framebuffer reads, readbacks) |
| `gl.readPixels` is synchronous | Readback is `copyTextureToBuffer` + `mapAsync`: async, one or more frames of latency, 256-byte row alignment |
| `GL_TRIANGLE_FAN`, `GL_QUADS`, line width, point size, `polygonOffset` per call | No fans, no line width, no point size. Triangulate on the CPU; draw thick lines as quads. Depth bias lives in the pipeline (`depthBias`) |
| State machine (`gl.enable(BLEND)`) | State is baked into **pipelines**; blend/depth/cull variants are separate pipelines. Build them up front or lazily with a cache |
| Uniforms set per draw | Uniform buffers + bind groups. Max 4 bind groups per pipeline by default. Bind per frame / per map / per draw, in that order |
| `gl_VertexID` + attributes | Prefer **vertex pulling**: read packed words from a `storage` buffer by `vertex_index` |
| Implicit sampler state in the texture | Separate `sampler` binding |
| No compute | Compute shaders, storage buffers, atomics, indirect draws (single draw only, see 3.3) |
| `#define` / `#ifdef` variants | `override` constants specialised at pipeline creation |
| Integer varyings automatic | Must be `@interpolate(flat)` |

Alignment: uniform struct layout is strict (`vec3` aligns to 16; pad explicitly). `queue.writeBuffer` needs sizes that are
multiples of 4. Copy-to-buffer needs 256-byte `bytesPerRow` and 4-byte offsets.

### 3.3 Missing or limited features

- **No multi-draw-indirect** in the web API. `drawIndexedIndirect` issues one draw per call. "GPU-driven rendering" in the
  console sense (one call draws everything surviving culling) is not available. Chunk culling on the CPU into merged index
  runs gets the same saving for typical OSRS scene sizes, with far less machinery (section 7.3).
- No geometry or tessellation shaders, no wireframe fill mode, no `gl_PointSize`.
- Default limits: ~128 MiB max storage binding, 8 storage buffers per stage, 4 bind groups. Request higher limits if the
  adapter offers them, and design buffers so they are not near the limit (split per map square).
- `timestamp-query` is optional and its resolution can be coarse or quantised for privacy. Do not rely on it alone to
  measure (see section 9.3).

### 3.4 The uniform-control-flow trap

`textureSample` must be called in **uniform control flow**. If you sample inside an `if` that depends on per-fragment data
(a texture id, an alpha test), Chrome rejects the shader. Sample first, then branch:

```wgsl
let sampled = textureSample(textures, textureSampler, uv, layer);   // always, unconditionally
let colour = select(vertexColour, vertexColour * sampled, hasTexture);
```

We hit this in four fragment functions. The failure mode was the nasty part: the shader compiled in one browser and not
another, and the code path quietly fell back to WebGL2 with no visible error. Test in more than one browser/driver, and make
compile failures loud.

### 3.5 Things that look like bugs but are not

- A 1x1 scissor rect **does not** reduce vertex-shader work. For a picking pass that reads one pixel, narrow the *geometry*
  instead (section 8.2).
- `drawIndexed` with `instanceCount = 0` is free, but you still pay CPU per call. Many tiny indirect draws can cost more than
  a few merged runs.
- `queue.writeBuffer` is not free for large data every frame; stage once, patch ranges.

---

## 4. What the OSRS software renderer does that a GPU does not (and how to match it)

The original client is a **software rasteriser with a painter's algorithm**. The look people expect depends on rules that
are properties of that renderer, not of the models. A naive GPU port (depth buffer, default culling, default sorting) looks
subtly wrong. These are the rules we had to carry over. Treat the deobfuscated client as ground truth, not another port: RuneLite's GPU plugin
is a useful reference for sorting, but it does **not** special-case walls and decorations the way the original does.

### 4.1 Units and coordinates

- A tile is 128 units; a scene level is a fixed vertical step (`Scene.UNITS_LEVEL_HEIGHT` here). Y is height and is
  negative upward in client space. Keep client units end to end and convert at the very edge (depth-bias constants in
  this repo are written in tiles as `units / 128`).
- A map square is 64x64 tiles. The editor builds scenes with a border (6 tiles) so models and blending near the edge are
  correct.
- Objects are positioned at the tile centre plus half their size (`(tile << 7) + (size << 6)`), with a height taken from
  the **average of the footprint's corner heights**. Orientation and mirroring follow the client's rotation tables
  exactly; mirrored models flip triangle winding, which matters for culling (4.4).

### 4.2 Colour: palette HSL, not RGB

- Model and terrain colours are 16-bit HSL (hue 6 bits, saturation 3, luminance 7) looked up in a brightness-adjusted
  palette. The shader decodes it per vertex and converts to RGB. **Port the decode and the brightness/gamma step exactly**
  (`hslToRgb` in `object-pass.wgsl`); do not "improve" it with a texture lookup unless you can prove identical output.
- Lighting is mostly baked into vertex colours at model build time (flat/gouraud per face colours). Do it on the CPU the
  way the client does, then treat the result as data.
- There is an optional colour-banding mode for the 64-step look. Keep it as a uniform, not as a post-process.

### 4.3 Face priority ordering (the big one)

Each model face has a **priority 0 to 11**. The client draws faces back to front **per priority bucket**, with priorities
10 and 11 slotted relative to others by depth thresholds. This is how a character's head draws over a hat, a bench's
legs under its seat, and so on. A depth buffer alone cannot reproduce it because those faces are often coplanar or
intersecting.

What worked:

1. **CPU reference implementation** with unit tests (`face-priority-sort.ts`). It is slow and obviously correct.
2. **GPU compute port** (`face-priority-sort.wgsl`): one invocation per placed model, stable far-to-near bucket walk,
   writes a per-frame index buffer. It is a serial baseline per model, which is fine because models are independent and
   run concurrently.
3. **Validation harness** (`face-priority-validation.ts`): sort every model on both and compare. Run it whenever the
   sorter or the packing changes.
4. A **depth bias per priority** (`FACE_PRIORITY_DEPTH_BIAS`, `MODEL_PRIORITY_DEPTH_BIAS`) so the depth buffer agrees
   with the sorted order for coplanar faces. Mind the units: biases must stay tiny relative to the depth buffer's precision.
5. Make the sorted index source a **switch** (`indexSource: "plain" | "priority"`) so you can A/B it and keep a cheap path
   when sorting is not needed. Create the sort resources lazily: they were ~40% of per-square memory.

### 4.4 Culling

- The client **back-face culls**. Early in our port WebGPU drew both sides and we got white quads on the ground and
  mirrored windows. Set `cullMode: "back"` in every scene pipeline (including picking) and confirm winding for mirrored
  models and for terrain.
- Frustum culling in the client is per tile/entity. Our version culls at **8x8-tile chunk** level on the CPU (section 7.3)
  and uses a padded box because models overhang their tile (trees, roofs).

### 4.5 Depth ordering for walls, decorations and ground pieces

The client paints tile by tile in camera-relative order, and **wall pieces and their decorations are painted before or
after the objects beside them depending on which side of the wall the camera is on**. A bank booth that slightly pokes
into a wall (up to ~8 units) shows whole when the camera is on the inner side. With a depth buffer you reproduce this
with small, rule-driven depth offsets, keyed by flags you pack per placed model:

| Piece | Rule | Constant (tiles) |
| --- | --- | --- |
| Ground-level objects and floor decorations | Pulled toward the camera so they beat coplanar terrain | `OBJECT_GROUND_PULL` 3/128 |
| Wall decoration | In front of its wall while visible, behind it while the camera is *outside* the edge it hangs on (`wallPlacement3`); the original offsets it +/-2 units | `WALL_DECORATION_PULL` 2/128 |
| Wall piece | Pushed back only while the camera is **not** outside its edge, just under the wall's thickness (~16 units) so it still hides what is really behind it | `WALL_BEHIND_PUSH` 10/128 |
| Roofs | In front of lower-plane geometry beneath | `ROOF_DEPTH_PULL` 8/128 |
| Planes | Small bias per level so level N beats level N-1 | `PLANE_DEPTH_BIAS` 2/128 |

How to follow the same approach:

- Pack **per-model flags** in the model record (we use: bit 0 roof, bit 1 wall decoration, bits 2-5 edge mask, bit 6 wall
  piece) and decide the bias in the vertex shader from the flags plus the camera position. The edge-mask bits are the
  client's orientation bits 1/2/4/8.
- Express offsets in **client units / 128**, not in depth-buffer units, so they survive a change of near/far plane or
  depth format.
- Derive the rule from the deob, check it against the client's behaviour with a data inspector (the placed model's type,
  orientation, offsets) before changing constants. We lost time tuning by eye on screenshots.
- Some oddities are **model data**, not renderer bugs (a booth model with a 13-unit gap to its neighbour). Verify before
  "fixing" the renderer.

### 4.6 Terrain

- Terrain tiles have underlay colour **blending over a radius** (`SceneBuilder.BLEND_RADIUS`), overlay shapes and rotations,
  and per-tile render flags (bridges, roof/plane visibility). Build that on the CPU and ship vertices.
- The editor's terrain buffer reserved 36 vertex slots per tile so brush strokes could overwrite a tile in place, but a
  plain tile only fills two triangles, so ~95% of slots were degenerate. Keep slots for editing if you need them, but
  **upload and draw only used triangles in their original order** so blending and depth ties come out identical
  (`terrain-compact.ts`: 18 MB to 1.5 MB, terrain GPU cost down about 5x).
- Objects contour to terrain in the vertex shader by sampling a **height-map texture** (modes: tile centre, per vertex, none,
  baked). A signed-integer 2D-array texture sampled with `textureLoad` worked well.

### 4.7 Textures and animation

- Textures are small tiles in a 2D array; generate mips on the CPU if you want identical filtering (`texture-mips.ts`).
- Water and other animated textures scroll UVs **in the shader from a time uniform**. There are two animation schemes (old
  and new); keep both behind a uniform flag.
- Per-face alpha: draw opaque first, then translucent. Alpha-cutout textures need their own fragment path. Keep separate
  opaque/alpha index ranges per chunk so you can draw each pass without re-sorting.
- **Animation timing is in client ticks (20 ms), not frames.** Advance animation from a clock, then render at whatever frame
  rate you have. We spent a while on "too fast/too slow/jerky" animations that were the render loop, not the sequences.

### 4.8 Fog, sky, plane visibility

- Fog uses distance with **rounded corners** (`FOG_CORNER_ROUNDING`) and the render distance; match it exactly or the world
  edge looks wrong.
- Plane visibility (hide roofs, view plane max, hide below view plane, bridge linking) are uniforms evaluated per vertex.

---

## 5. Data layout

Layout we settled on, and why:

- **Vertex pulling.** Static geometry is one big `storage` buffer of packed words per map square; the vertex shader reads
  words by `vertex_index` and an **index buffer** decides what is drawn. No vertex attributes. This is what makes GPU
  sorting possible (the sorter only rewrites indices) and keeps pipelines identical for all models.
- **Per-model slot record** (two RGBA16UI texels / 4 words): tile position, base height, plane, model priority, contour mode,
  interaction type and id, flags. Every vertex carries a slot index.
- **Height map and tile render flags** as texture arrays, one layer per level.
- **One merged static mesh per map square**, bucketed into 64 chunks (8x8 tiles). Per chunk we record the opaque and
  translucent index ranges (`chunkRanges`), so a visibility mask turns into a few contiguous `drawIndexed` calls.
- **Animated scenery** (frame swapping): all frames live in the same vertex buffer; a small **dynamic index range** is
  rewritten when a frame changes. They are drawn without chunk culling today.
- **Textures**: one 2D-array texture for all material textures plus a small material data texture (`textureMaterials`).
- Memory habits that paid off: lazy creation of sort resources, dropping the CPU copy of the mesh after upload (rebuild on
  demand), compact terrain, not creating GPU resources for the fallback renderer. A status-bar memory estimate from
  `pass.memoryBytes()` caught regressions early.

Bind group scheme: group 0 per frame (scene uniforms, textures, sampler, material data), group 1 per map square (map
uniforms, slot data, height/flags textures), group 2 for compute-only sort resources.

Mega-buffers (one buffer for the whole world) would reduce bind-group changes but not the cost of the pixels, and they
make streaming harder. Per-map-square buffers were the right grain for a streamed world.

---

## 6. 2D layer, text and the interface

A full client's interface is sprite and glyph blits with exact pixel positions, clip rectangles and per-pixel alpha. Notes:

- Render the world to its own target (or a viewport region) and the UI in a second pass. Use `setScissorRect` for widget clips.
- Batch quads with one dynamic vertex/instance buffer and a texture atlas (sprites + fonts). Sort by the client's draw
  order, not by texture.
- Sample with **nearest** and snap to integer pixels at integer scales. The UI must not look blurry when `devicePixelRatio`
  is not 1; scale the UI by an integer factor or render it at CSS resolution and upscale with nearest.
- The minimap is a separate raster of tile colours (we render it in workers); do not draw it from the 3D pass.
- Overlays on the world (hit splats, overhead text, health bars) are 2D elements positioned from a **projected 3D point**;
  project on the CPU with the same matrices the GPU uses.

---

## 7. Performance practice

### 7.1 Measure what is actually slow

Before any optimisation: separate **CPU frame time** from **GPU time**, and **vertex** cost from **fragment** cost. We
found the 4-region scene was ~0.5-1.3 ms of GPU and ~0.5-1.8 ms of CPU per frame, about 85% of the GPU time was vertex work
(it barely moved when the canvas was shrunk 4x), and the problems the user *felt* were somewhere else entirely (a CPU
software-rasterised preview panel, a 20 fps idle throttle). Measure the real frame, including the UI.

### 7.2 What to do, in rough order of value

1. **Cull before you draw.** Chunk-level frustum culling produced contiguous index runs; scene cost dropped 2x to 5x in
   views where a lot was off screen.
2. **Draw less terrain.** Compact terrain (4.6).
3. **Do not allocate per frame** in the hot loop (matrices, arrays, closures, string keys). Reuse scratch objects; cache
   draw commands; avoid `Map` lookups with composite string keys per object per frame.
4. **Cache pipelines and bind groups**; never create them in the frame loop. Build with `createRenderPipelineAsync` at load.
5. **Avoid per-frame readbacks.** One async readback with one frame of latency is fine; do not stall on it.
6. **Cap resolution cost** (pixel ratio) on high-DPI displays; make it a setting.
7. **Pace the loop honestly.** A throttle "while idle" is a trap in a game with animated scenery: our client dropped to 20 fps
   after 3 seconds without input, which made water and animated objects look choppy "while doing nothing". Throttle only when
   nothing in view is animating.

### 7.3 Culling design that worked

CPU frustum test per chunk (padded box), a visibility byte per chunk, `visibleChunkRuns(ranges, mask, translucent)` merging
adjacent visible chunks into runs. 0.2 ms CPU for ~130 chunk tests. It was exact: we verified no culled chunk
contributed a pixel by rendering with and without the mask and diffing.

GPU culling, Hi-Z occlusion and indirect draws were not worth it at this scale (24-41 draws, <1 ms GPU), and OSRS scenes
have little occlusion that a coarse Hi-Z would catch (low walls and roofs). Revisit only if you load very large view
distances and profiling shows vertex or draw-call cost.

### 7.4 Depth precision

Standard depth with `depth32float` gave z-fighting between coplanar quads (water tiles flickered as the camera moved).
Reverse-Z with a float depth buffer gives much better precision, but it changes every pipeline's compare function, the clear
value, the picking pass and all your tuned biases. Decide this **at the start** of a new port; it is far cheaper than
retrofitting.

---

## 8. Picking and tools

### 8.1 Colour-ID picking

Draw the scene again into an ID target where each fragment writes `[loc id, map id, interaction type, 1 + packed tile]` as
floats (`RGBA32F`), read back **one pixel**, asynchronously. A separate pass writes tile ids for ground picking. Both are
async; keep the "latest result" and a busy flag so you never queue picks faster than they return.

### 8.2 Make the picking pass cheap

The vertex shader runs for every drawn vertex no matter how small the scissor. So narrow the **geometry**: build a frustum
cropped to a few pixels around the cursor, test chunks against it, and draw only the chunks the cursor ray crosses. We
verified identical results to a full-view pick over 280 pixels (80 hits) at about half the latency. Also skip the pick when
the cursor and camera have not changed (key on the inputs).

### 8.3 Hover/outline work belongs off the hot path

Anything that runs per newly hovered object must be cheap or deferred: build outline meshes once per loc type (cache), and
debounce expensive UI previews until the hover settles. A CPU-rasterised preview that cost ~4 ms per object (more on Retina)
was a bigger frame-time problem than the whole 3D pass.

---

## 9. Verifying parity with the original

### 9.1 What "matching" means

A GPU rasteriser will not match the software client pixel for pixel (different fill rules, interpolation and rounding).
Define acceptance as: **same ordering, same colours at the vertex level, same silhouettes, same culling, same animation
timing**. Pixel diffs against the old renderer should be near black with only edge noise.

### 9.2 Tools to build early

- **A/B harness**: render the same frame with the old and new backend, read both back, diff, and print mismatching pixel
  counts and locations. Keep it callable from the dev console (`__webgpuHarness()` here).
- **CPU reference implementations** with unit tests for anything the GPU reimplements (face sort, chunk ranges, compact
  terrain, pick frustum).
- **Data inspectors** over screenshots: dump a placed model's type, orientation, offsets, flags and resolved morph. Many
  "rendering bugs" are data or rule issues (wrong morph, wrong orientation bit), and you cannot see that in a screenshot.
- **Debug switches**: force sort on/off, force plain index source, disable culling, disable biases. Each is a quick bisect.

### 9.3 Timing method that is trustworthy

Timestamp queries can be quantised. A robust GPU measurement: submit N identical frames, `await
queue.onSubmittedWorkDone()`, divide wall time by N, take the median of several bursts, and interleave variants so drift does
not bias them. Add a CPU timer around your own frame function separately. Test with a hidden or throttled tab in mind: the
browser throttles `requestAnimationFrame` there, so drive frames manually when measuring.

---

## 10. Browser and desktop deployment

- Support differs by browser and OS and changes quickly: **check current compatibility tables** before promising support.
  Always feature-detect and fall back.
- In a desktop shell (Tauri/WebView) the WebView's engine decides whether WebGPU exists. Show the active backend in the UI;
  "it is slow on desktop" was a question we could not answer until the user could read it from the status bar.
- Headless/CI testing: a real adapter is needed for meaningful tests. Software adapters (SwiftShader) work for correctness
  but not for performance numbers.
- Plan for adapter variety: integrated vs discrete GPUs, memory limits, and unified memory (GPU memory *is* system RAM). A
  performance governor that downgrades or pauses on very slow frames is reasonable, but make it explain itself and make it
  cheap to resume.

---

## 11. Suggested project plan for the full client

1. Extract engine/render-data/backend layers from the current WebGL2 client. Make the frame description explicit.
2. Stand up a WebGPU device, a frame loop, and a debug HUD (backend, CPU ms, GPU ms, draws, triangles, memory).
3. Port terrain, then static scenery with vertex pulling and merged per-map meshes. Compare with the old renderer.
4. Add face-priority ordering (CPU reference, GPU sort, validation) and the depth-order rules (flags + biases).
5. Add culling and chunk runs; confirm exactness by diffing masked vs unmasked.
6. Add picking (ID pass, narrowed geometry), highlights, overlays as renderer-neutral commands.
7. Add animation (scenery frame swap), then skinned entities. For skinning, plan a compute pass that applies the
   sequence's transform groups per model per frame, writing into a vertex buffer; keep frame timing on the client tick.
8. Port the 2D layer: atlas, batching, clips, text.
9. Memory pass: lazy resources, compact data, dropping CPU copies, budgets and a status readout.
10. Retire the old renderer behind a flag; keep it as a fallback for at least one release; then delete it.

---

## 12. Pitfalls we actually hit (checklist)

- [ ] Shader compile error in one browser silently fell back to the old renderer: **always log compile info and show the backend.**
- [ ] `textureSample` inside non-uniform control flow: sample first, branch after.
- [ ] No culling meant two-sided drawing: white ground quads, mirrored windows. Cull back faces everywhere, including picking.
- [ ] Depth ordering rules for walls/decorations/ground pieces are properties of the *original renderer*; encode them as flags + small biases in client units.
- [ ] Painter-order issues look like z-fighting; z-fighting looks like painter-order issues. Decide which with a data dump, not by tuning.
- [ ] A 1x1 scissor does not make the vertex stage cheaper: crop the geometry.
- [ ] Idle throttling made an animated scene look choppy; throttle only when nothing animates.
- [ ] An unused fallback renderer kept ~100 MB of GPU memory alive. If it is a fallback, keep it CPU-only until needed.
- [ ] Editing shader/TS files hot-reloads and resets scene state in dev: build scripts that reopen the test view.
- [ ] Verify against the **deob/original client**, not another reimplementation; some details (wall decorations) are handled differently in common GPU plugins.
- [ ] Large debug dumps from the browser console can swamp the tool/terminal: print summaries.
- [ ] Do not ship per-frame allocations in the hot loop; check heap growth over a few hundred idle frames.

---

## 13. Useful files in this repo

| Topic | File |
| --- | --- |
| Object pass, pipelines, bind groups, render, pick | `client/src/mapeditor/webgpu/WebGPUObjectPass.ts` |
| Vertex/fragment shaders, depth rules, HSL | `client/src/mapeditor/webgpu/object-pass.wgsl` |
| GPU face-priority sort + CPU reference + validation | `face-priority-sort.wgsl`, `face-priority-sort.ts`, `face-priority-validation.ts` |
| Merged static mesh and chunk ranges | `client/src/mapeditor/webgpu/object-mesh-merge.ts` |
| Compact terrain | `client/src/mapeditor/webgpu/terrain-compact.ts` |
| Overlay commands (renderer-neutral) | `client/src/mapeditor/webgpu/overlay-commands.ts` |
| Viewport owning the canvas, sync, picking | `client/src/mapeditor/webgpu/WebGPUViewport.ts` |
| Renderer choice and fallback | `client/src/mapeditor/webgpu/renderer-choice.ts` |
| Original GLSL (reference) | `client/src/mapviewer/webgl/shaders/main.vert.glsl`, `main.frag.glsl` |
| Wall/decoration flag encoding | `client/src/rs/scene/WallDecorationOffset.ts` |
| Plan, measurements, history | `docs/WGPU_RENDERER_PLAN.md` |
