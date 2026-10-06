# WebGPU Dynamic Phase Registry Cutover

Checkpoint J moves dynamic WebGPU comparison execution onto the ordered opaque and transparent phase registries.

## Goal

The comparison renderer had reached visual coverage for NPCs, players, attached GFX, world GFX, and projectiles, but the runtime ownership model was mixed:

- NPC opaque and alpha were native registry handlers.
- Player, GFX, world-GFX, and projectile passes still wrapped `WebGPUStaticSceneRenderer.drawOpaqueScene` / `drawTransparentScene` directly.
- Ordering was therefore correct partly because `Canvas` installed wrappers in a specific nesting order.

Checkpoint J removes that runtime dependency on nested dynamic prototype wrappers.

## Canonical phase graph

Opaque dynamic order after the static scene:

1. `npc`
2. `player`
3. `attached-gfx`
4. `world-gfx`
5. `projectile`

Transparent dynamic order after static transparency:

1. `npc`
2. `npc-attached-gfx`
3. `world-gfx`
4. `player`
5. `player-attached-gfx`
6. `projectile`

The numeric registry orders are spaced by ten so another parity phase can be inserted later without renumbering every existing handler.

## Transitional boundary extraction

The large player/GFX/projectile comparison modules already contain audited runtime logic, capture state, GPU resource lifetime, and pipeline behavior. Rewriting those modules solely to remove their historical prototype wrappers would introduce unnecessary renderer risk.

Instead, the lifecycle performs a one-time extraction:

1. The native NPC handler establishes the ordered registry as prototype owner.
2. A legacy category installer is temporarily given a no-op predecessor for its scene boundary and, where applicable, its dispose boundary.
3. The installer creates its existing wrapper closure exactly as before.
4. That closure is captured as the category's phase implementation.
5. The prototype method is immediately restored to the registry-owned method.
6. The captured closure is registered under an explicit phase ID/order.

The wrapper therefore becomes an implementation detail behind the phase registry. It is not left installed on `WebGPUStaticSceneRenderer.prototype`.

This preserves the previously audited category behavior while making the registries the sole dynamic execution-order owners.

## Capture hooks are intentionally unchanged

This checkpoint does not move the authoritative WebGL capture boundaries.

Those hooks still observe the exact state chosen by WebGL for:

- player current-pose batches,
- NPC morph/animation state,
- GFX selected frames,
- world-GFX placement,
- projectile position/frame/quantized orientation.

Only WebGPU draw-phase ownership changes.

## Disposal

Legacy category dispose wrappers are extracted against a no-op predecessor at the same time as their draw wrapper.

The extracted cleanup is then attached to the matching registry handler. This prevents nested prototype disposal chains while retaining the existing per-category GPU resource destruction.

Transparent-only GFX boundaries do not own independent resources and therefore do not register duplicate disposal callbacks.

## Diagnostics

The opaque and transparent registries now expose per-category counters.

For each handler:

- `attempted`: number of frames in which the phase handler was invoked.
- `drawn`: attempted frames that emitted at least one `draw()` or `drawIndexed()` call.
- `skipped`: attempted frames that emitted no GPU draw call.
- `drawCalls`: total GPU draw submissions emitted by the phase.

Diagnostics contain both the current-frame sample and cumulative totals for the renderer lifetime.

These counters intentionally measure phase submission behavior, not entity count. A batched player draw containing several instances is one draw call.

The pass encoder is observed through a comparison-only proxy that rebinds all methods to the native encoder target. This keeps WebGPU method brand checks intact while counting `draw` and `drawIndexed` submissions.

## Normal WebGL behavior

The entire dynamic comparison lifecycle remains gated by the existing `webgpuTerrain` comparison query.

Without the opt-in, no dynamic phase extraction, registry installation, or counter proxy is installed by this lifecycle.

## Not changed in Checkpoint J

- shaders,
- blend/depth/cull policy,
- actor/GFX/projectile geometry,
- animation clocks,
- material or texture behavior,
- capture semantics,
- dynamic picking/highlights,
- full live WebGPU activation,
- shared height/instance-buffer extraction.

## Next architectural step

With dynamic draw ordering centralized, low-level resource sharing can now be evaluated without also changing phase ownership.

The safest next consolidation target is the identical height-map bind-group cache and growable instance-buffer allocation pattern. Geometry caches should remain specialized until their different invalidation and ownership rules are explicitly reconciled.
