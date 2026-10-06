# WebGPU Dynamic Picking

Checkpoint M adds dynamic actor picking without changing the authoritative interaction path.

The current client still uses CPU scene raycasting and menu construction for live interaction. Static WebGPU picking already exists as an asynchronous comparison tool. M1 established the player/NPC identity and shader contract. M2 adds the actual on-demand player/NPC GPU pick controller as comparison-only infrastructure.

## M1 foundation

M1 implemented:

- explicit WebGPU dynamic pick identity for players and NPCs
- `rgba32uint` one-pixel payload contract matching the static pick target format
- player/NPC actor-kind encoding and decoding
- CPU resolution from a decoded pick back to renderer-neutral actor identity
- dedicated shader patch that reuses the existing audited player/NPC vertex transform path
- texture-alpha, alpha-cutoff, and full-fog rejection in the pick fragment
- regression coverage for player/NPC identity and current highlight semantics

## Why dynamic picks do not use `InteractType`

`InteractType` describes static scene interaction categories and has no player value.

Players use the client's reserved raw interaction range:

- `0x8000 + player slot`

NPC actor records carry their server id as the raw interaction id.

Dynamic picking therefore uses a separate discriminated result:

```ts
interface WebGPUDynamicPickResult {
    kind: "player" | "npc";
    interactionId: number;
    mapId: number;
}
```

This avoids assigning a fake static interaction type to players.

## GPU payload

The dynamic pick target uses `rgba32uint`, 16 bytes per pixel, with the same 256-byte readback-row alignment used by static picking.

The four words are:

1. raw actor `interactionId`
2. source `mapId`
3. dynamic actor kind code (`1 = player`, `2 = npc`)
4. hit sentinel (`1` for actor hit, `0` for cleared/no hit)

No actor ABI expansion is needed.

The existing 112-byte player/NPC instance record already stores the raw interaction id in `actorMisc.y`, while `map.mapId` is already available in the map uniform.

## Shader contract

`patchWebGPUDynamicActorShaderForPicking()` derives a pick-capable module from the existing player or NPC module.

It does not rewrite actor placement. The normal vertex function remains responsible for:

- actor rotation
- terrain height grounding
- model Y offset
- player world-entity transforms
- player equipment priority projection
- NPC plane separation
- NPC face-priority view-space bias
- fog
- texture animation coordinates

The patch only adds a flat `pickData` output and an integer `fsDynamicPick` fragment.

The pick fragment rejects:

- fully fogged surfaces
- untextured surfaces below the existing 0.01 alpha threshold
- textured surfaces below the material alpha cutoff

Normal color rendering is untouched.

# M2: on-demand actor picking controller

M2 adds `WebGPUDynamicPickingController` and exposes it through comparison mode with `requestWebGPUTerrainDynamicPick()`.

The controller is deliberately actor-only. It does not replace CPU raycasting, world menus, hover selection, click handling, or the interact-highlight overlay.

## Reusing prepared actor phases

M2 does not rebuild player/NPC pose state or introduce another animation clock.

The opaque and transparent actor registries now expose diagnostics-neutral replay helpers:

- `replayWebGPUOpaqueActorPhase()`
- `replayWebGPUTransparentActorPhase()`

The pick controller replays only the existing prepared actor phases while substituting M1 pick pipelines. Existing actor runtimes continue to provide the exact:

- vertex buffers
- index buffers
- 112-byte instance buffers
- map bind groups
- height-map bind groups
- world-entity transforms
- current pose/frame geometry

Normal dynamic-phase diagnostics are not incremented by a pick replay.

## M2 draw order

The actor-only pick pass executes:

1. opaque NPC
2. opaque player
3. transparent NPC
4. transparent player

The pick pass intentionally does not replay:

- attached GFX
- world GFX
- projectiles
- static terrain/loc/ground-item geometry

Because this is an actor-only comparison target, M2 does not yet answer static-vs-dynamic occlusion arbitration. A player or NPC hidden behind a static wall can still be returned by the M2 actor-only query. That is a known boundary, not live interaction behavior.

## Pick target and depth

M2 allocates its own full-canvas comparison resources:

- `rgba32uint` ID target
- independent `depth24plus` depth target

Each request:

- updates a dedicated scene uniform buffer
- uses the current scene viewport
- scissors rasterization to exactly one requested pixel
- renders only player/NPC phases
- copies one pixel into a 256-byte-row-aligned readback buffer
- resolves the result asynchronously with `mapAsync`

The actor pick depth target is independent from both normal WebGPU rendering and static picking.

## Cull parity

The pass proxy preserves the source actor pipeline's cull choice where applicable.

- opaque player preserves cull/no-cull selection, including double-sided player geometry
- transparent player remains no-cull, matching the existing player alpha pass
- NPC opaque/alpha preserve cull/no-cull selection from the existing runtime

All pick pipelines retain `depthWriteEnabled: true` and `depthCompare: less-equal`, matching the current actor passes.

## Newest-request-wins readback

GPU readback is serialized to avoid building a cursor-pick backlog.

When a readback is already in flight:

- at most one newer request is retained
- a superseded queued request resolves `undefined`
- after the active readback completes, only the newest queued request is executed

This follows the same asynchronous comparison philosophy as static picking while keeping the dynamic controller isolated.

## Request-time identity snapshot

Player interaction identity is map-local:

- actor upload writes `0x8000 + indexInMap`
- `PlayerRenderer.getRenderPlayersForMap(map)` exposes the same ordered list used for that upload

M2 freezes the `(mapId, interactionId) -> actorId/serverId` mapping synchronously when the pick request is created, before shader initialization, queue delay, or GPU readback can yield to another frame.

That prevents a delayed readback from interpreting an old player slot using a newer frame's player order.

NPC resolution is also frozen at request time from the server-linked ECS identities, keyed by the NPC server id carried in the pick payload.

The resolved comparison result is:

```ts
interface WebGPUDynamicResolvedPickResult extends WebGPUDynamicPickResult {
    actorId: number;
    serverId: number;
}
```

## Comparison-only API

`requestWebGPUTerrainDynamicPick(host, canvasX, canvasY)` is available only while the WebGPU comparison renderer is active and ready.

It:

- lazily creates the dynamic picking controller
- returns `undefined` outside comparison mode or when no actor is hit
- logs a pick-specific failure without disabling the whole comparison renderer
- is disposed before the comparison renderer/backend is destroyed

It does not write to:

- world menu entries
- hovered actor state
- interaction-highlight state
- click/destination state
- `SceneRaycaster`

## Highlight parity

The current interact-highlight plugin supports only:

- locs
- NPCs

Player menu entries explicitly clear the active interaction highlight rather than generating a player halo.

M1/M2 preserve that behavior:

- NPC dynamic pick results are valid future highlight identities.
- Player dynamic pick results are valid pick identities but are not highlight targets.

M2 does not bridge GPU results into the highlight overlay yet.

## Deliberately excluded effect picking

### Attached GFX

Attached GFX reuse a parent actor record for placement, but treating the effect itself as an additional interaction surface could enlarge the actor hit silhouette beyond current client behavior. They remain excluded.

### World GFX

World-tile GFX compatibility records contain no authoritative interaction id. They remain non-pickable.

### Projectiles

Projectile record word 3 is used for projectile id and quantized pitch/roll state, not an interaction id. Projectiles remain non-pickable.

## Authoritative interaction remains CPU-side

M2 is still comparison infrastructure only.

`SceneRaycaster`, world menu construction, click handling, hover selection, and the existing interaction-highlight state remain authoritative. No live gameplay behavior should change from this checkpoint.

## Validation

`webgpu-dynamic-picking-foundation.test.ts` continues to lock the M1 payload/shader/highlight contract.

`webgpu-dynamic-picking-controller.test.ts` locks M2 behavior including:

- independent integer and depth targets
- one-pixel scissor/readback
- 256-byte readback-row alignment
- newest-request-wins queue semantics
- request-time player/NPC identity freezing
- player `0x8000 + slot` resolution
- NPC server-id resolution
- opaque NPC -> opaque player -> alpha NPC -> alpha player replay order
- exclusion of GFX/projectile phases
- player alpha no-cull behavior
- diagnostics-neutral phase replay APIs
- comparison-only request surface and controller disposal

Both tests are wired into the normal client test chain and `test:webgpu-foundation`.

## Next step

A later M3 should compare/arbitrate static and dynamic pick results against the same screen point and depth semantics before any live interaction cutover. Static geometry occlusion must be accounted for before GPU actor picks can be considered a candidate replacement for CPU world interaction.

Until that parity work is complete, CPU raycasting remains authoritative.
