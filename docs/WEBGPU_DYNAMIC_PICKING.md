# WebGPU Dynamic Picking

Checkpoint M begins dynamic picking without changing the authoritative interaction path.

The current client still uses CPU scene raycasting and menu construction for live interaction. Static WebGPU picking already exists as an asynchronous comparison tool. M1 establishes the corresponding player/NPC identity and shader contract so an on-demand actor pick pass can be added next without changing actor rendering or inventing interaction semantics.

## M1 scope

Implemented:

- explicit WebGPU dynamic pick identity for players and NPCs
- `rgba32uint` one-pixel payload contract matching the static pick target format
- player/NPC actor-kind encoding and decoding
- CPU resolution from a decoded pick back to the current renderer-neutral actor instance
- dedicated shader patch that reuses the existing audited player/NPC vertex transform path
- texture-alpha, alpha-cutoff, and full-fog rejection in the pick fragment
- regression coverage for player/NPC identity and current highlight semantics

Not implemented in M1:

- issuing the actor pick render pass
- GPU readback/controller lifecycle
- replacing `SceneRaycaster`
- changing live menu construction
- changing hover selection
- changing the interact-highlight overlay
- attached-GFX picking
- world-GFX picking
- projectile picking
- live WebGPU renderer cutover

## Why dynamic picks do not use `InteractType`

`InteractType` describes static scene interaction categories such as terrain, locs, NPCs, and ground items. It does not contain a player value.

Players instead use the client's reserved raw interaction range:

- `0x8000 + player slot`

NPC actor records carry their server id as the raw interaction id.

M1 therefore uses a separate discriminated result:

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

The existing 112-byte player/NPC instance record already stores the raw interaction id in `actorMisc.y`, while `map.mapId` is already available in the map uniform. Actor ECS/client identity remains on the CPU and can be recovered from the current renderer-neutral snapshots by matching kind, interaction id, and source map id.

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

This keeps the future pick silhouette aligned with the current player/NPC material visibility rules while leaving normal color rendering untouched.

## Highlight parity

The current interact-highlight plugin supports only:

- locs
- NPCs

Player menu entries explicitly clear the active interaction highlight rather than generating a player halo.

M1 preserves that behavior:

- NPC dynamic pick results are considered highlightable identities.
- Player dynamic pick results are pickable identities but are not highlight targets.

The existing highlight renderer remains a separate CPU-built triangle mask/post-present halo pass. M1 does not replace or modify it.

## Deliberately deferred effect picking

### Attached GFX

Attached GFX reuse a parent actor record for placement, but treating the visual effect itself as an additional interaction surface could enlarge the actor hit silhouette beyond current client behavior. It remains deferred until that parity question is audited directly.

### World GFX

World-tile GFX compatibility records contain no authoritative interaction id. They remain non-pickable.

### Projectiles

Projectile record word 3 is used for projectile id and quantized pitch/roll data, not an interaction id. Projectiles remain non-pickable.

## Authoritative interaction remains CPU-side

M1 is comparison infrastructure only.

`SceneRaycaster`, world menu construction, click handling, and the existing interaction highlight state remain authoritative. No live gameplay behavior should change from this checkpoint.

## Validation

`webgpu-dynamic-picking-foundation.test.ts` locks:

- `rgba32uint` / 16-byte pick format
- 256-byte readback row alignment
- player and NPC kind codes
- player reserved `0x8000 + slot` identity preservation
- NPC raw server-id identity preservation
- decode/no-hit behavior
- CPU actor-instance resolution
- NPC-only highlight eligibility
- player/NPC opaque and alpha shader patching
- preservation of player equipment depth behavior
- preservation of NPC plane/priority behavior
- texture alpha/cutoff rejection
- current LOC/NPC-only interaction highlight contract

The test is wired into both the normal client test chain and `test:webgpu-foundation`.

## Next step

M2 should build the on-demand actor pick controller around this contract:

1. reuse the comparison renderer's current player/NPC snapshots and geometry
2. allocate a one-pixel `rgba32uint` target and independent depth target
3. render player/NPC opaque and alpha geometry with the M1 pick shader
4. preserve cull/no-cull behavior and actor transform parity
5. perform newest-request-wins asynchronous readback like static picking
6. resolve the raw result back to the current actor snapshot
7. expose comparison diagnostics only

CPU raycasting should remain authoritative until browser comparison data confirms parity.
