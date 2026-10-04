# OpenRune Combat Pathing Parity Plan

This folder breaks the combat-pathing parity work into ten reviewable changes. The plans are intentionally narrow: implement them in order, one plan per branch or commit, and do not combine cleanup from later plans into an earlier change.

The target is OpenRune's observable combat-pathing behaviour, while retaining this repository's TypeScript architecture, plugin policies, WebSocket protocol, private areas, and custom map-region replacement.

## Required reading

Before changing server code, read:

- `server/AGENTS.md`
- `server/CONTRIBUTING.md`
- This file
- The plan being implemented
- Every current caller of each symbol the plan changes

The reference repository is expected at `<workspace>/OpenRune-Server`. If it is not present, stop. Do not implement parity behaviour from memory.

## Plans and required order

| Order | Plan | Depends on | Main result |
| --- | --- | --- | --- |
| 1 | [Single combat interaction lifecycle](./01-single-combat-interaction-lifecycle.md) | None | One owner and one pre/move/post sequence for combat interactions |
| 2 | [Moving-target reroute cadence](./02-moving-target-reroute-cadence.md) | 1 | Preserve turning checkpoints and reroute only on the final stretch |
| 3 | [Terminal unreachable handling](./03-terminal-unreachable-handling.md) | 1, 2 | Stop impossible interactions once, with the correct map-flag state |
| 4 | [Validated per-step movement](./04-validated-per-step-movement.md) | 2 | Diagonal-first movement with cardinal fallback at consumption time |
| 5 | [NPC pursuit parity](./05-npc-pursuit-parity.md) | 1, 4 | OpenRune-shaped NPC target pursuit instead of legacy basic pathing |
| 6 | [Under-target behaviour](./06-under-target-behaviour.md) | 1, 4, 5 | Correct NPC overlap and red-X behaviour |
| 7 | [Combat range and line of sight](./07-combat-range-and-line-of-sight.md) | 1 | Reciprocal PvP AP LOS and reverse NPC LOS |
| 8 | [Attack validation ordering](./08-attack-validation-ordering.md) | 1, 7 | Reject invalid combat before weapon-range pursuit |
| 9 | [Combat continuation and cancellation](./09-combat-continuation-and-cancellation.md) | 1, 3, 8 | Re-engage through the interaction lifecycle rather than permanent follow state |
| 10 | [Tick ordering and bot scheduling](./10-tick-ordering-and-bot-scheduling.md) | 1-9 | Remove scheduling differences that alter combat outcomes |

Do not begin plan 10 as a performance task. Correctness comes first; any performance loss must be measured after parity tests pass.

## Shared safety contract

Every implementation must obey these rules:

1. Start from a clean understanding, not necessarily a clean worktree. Run `git status --short`, identify pre-existing changes, and do not rewrite or discard them.
2. Add the smallest failing smoke test before changing behaviour. Extend an existing smoke when it already owns the domain; otherwise add one focused script.
3. Reuse `RsmodRouteFinding`, `CombatRange`, `MovementQueue`, and the existing combat methods. Do not add another pathfinder, geometric attack-tile search, action scheduler, or plugin framework.
4. Keep foundational routing and movement in core. Keep gameplay policies in plugins and `PluginManager` hooks according to `server/CONTRIBUTING.md`.
5. Do not change client packet IDs, packet layouts, player indices, map-region loading, cache revision, rendering, or destination-click coordinates for these plans.
6. Do not add coordinate-, object-, NPC-, weapon-, or bot-name-specific fixes.
7. Never leave two active owners of the same decision. When the replacement path passes its tests, remove the superseded routing/follow branch and its stale cache fields in the same change.
8. Preserve private-area identity checks, height checks, freezes, movement locks, teleports, deaths, logout, special attacks, autocast, pets, and forced movement.
9. Use server cycles for gameplay state. Do not introduce `Date.now()`, timers, sleeps, or asynchronous routing into combat decisions.
10. Do not claim OpenRune parity from visual testing alone. Each plan lists deterministic assertions that must pass.

## Reference hierarchy for this work

The requested behavioural target is OpenRune. Use its source and integration tests as the executable parity oracle. If OpenRune is ambiguous or marked with a TODO, verify against osrs-docs and the OSRS Wiki as required by `server/CONTRIBUTING.md`. Record any intentional divergence in the implementing commit; do not silently guess.

Do not copy Kotlin structure mechanically. Port the observable state transitions and invariants using existing TypeScript types.

## Baseline commands

Run these before the first implementation and after every plan:

```sh
cd server
yarn build
yarn test:route-core
yarn test:pathfinding
TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' yarn ts-node ./scripts/combat-timing-smoke.ts
yarn test:client-protocol
git diff --check
```

If a plan adds a script, add one descriptive `package.json` command only when it will remain useful after the migration. Avoid one command per tiny assertion.

## Required scenario matrix

By the end of the series, automated or repeatable integration coverage must include:

- Player versus stationary player: melee, ranged, magic.
- Player versus moving player: target walking, target running, both moving.
- Player versus NPC and NPC versus player, including a size-greater-than-one NPC.
- Same-tile overlap, cardinal adjacency, diagonal adjacency, blocked shared edge, and a route around a corner.
- Frozen attacker, frozen target, movement-locked attacker, unreachable target, target death, teleport, logout, and private-area mismatch.
- Attack during weapon cooldown and target movement out of range during cooldown.
- Bot versus real player at full tick rate and bot versus bot under the stress scheduler.

For movement assertions, compare server tiles and state per cycle. Animation interpolation and client FPS are not server pathing acceptance criteria.

## Per-plan workflow

For each plan:

1. Capture the relevant OpenRune source and test names in the implementation notes.
2. Add the focused failing test.
3. Make the minimum production change.
4. Remove the superseded branch named in the plan.
5. Run the focused test, baseline commands, and `git diff --check`.
6. Inspect `git diff --stat` and `git diff -- <touched files>` for unrelated edits.
7. Test the listed manual scenarios with stress bots disabled first, then enabled.
8. Commit only that plan. Do not commit unrelated worktree changes.

## Global stop conditions

Stop and report instead of improvising if:

- A plan requires changing the client/server combat packet contract.
- Existing plugin hooks cannot express an attack policy without feature-specific core branching.
- The implementation needs a second route queue or parallel combat target field.
- A passing test requires real-time delays or random outcomes.
- A proposed fix special-cases one map tile, actor index, weapon, or bot.
- The focused change exceeds the named production files without a traced caller explaining why.
- Current uncommitted changes overlap the same lines and their ownership is unclear.

## Completion definition

The series is complete only when the old combat-follow router and its duplicate route cache are gone, combat interactions have a single lifecycle, all listed parity tests pass, and bot scheduling no longer changes combat mechanics. Performance tuning is a separate measured task after this pack.
