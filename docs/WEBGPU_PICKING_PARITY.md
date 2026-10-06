# WebGPU Picking Parity Recorder

Checkpoint M4 adds read-only parity instrumentation between the authoritative CPU `SceneRaycaster` stack and the M3 combined WebGPU picker.

M4 does not change gameplay interaction behavior. CPU raycasting, menu construction, hover selection, click handling, and interaction highlights remain authoritative.

## Scope

M4 implements:

- passive capture of the exact `SceneRaycaster.raycast()` result already consumed by `checkInteractions()`
- synchronous CPU identity snapshotting before asynchronous GPU readback
- one combined M3 GPU pick at the same interaction point
- a six-way parity classification
- stable player/NPC identity comparison
- a bounded 128-sample diagnostics buffer
- comparison-mode-only install/restore lifecycle
- one-in-flight sampling to avoid comparing an old CPU stack against a later queued GPU frame

M4 deliberately excludes:

- replacing CPU raycasting
- changing menu ordering or menu contents
- changing hover/highlight ownership
- clicking or interaction dispatch from GPU identity
- GFX/projectile picking
- full WebGPU renderer cutover

## Why the recorder taps the existing CPU raycast

`checkInteractions()` already computes the authoritative CPU hit stack. Running a second raycast only for parity would duplicate CPU work and could produce a subtly different scene snapshot.

The recorder therefore wraps the initialized renderer's `SceneRaycaster.raycast()` method in comparison mode. It calls the original method once, snapshots the returned identities, schedules an M3 GPU query, and returns the original hit array unchanged.

This keeps the instrumentation observational rather than authoritative.

## CPU ordering

`SceneRaycaster.raycast()` sorts hits front-to-back by `t`, so CPU index `0` is the nearest broad-hit candidate.

M4 preserves the complete CPU stack because a GPU silhouette can legitimately correspond to a deeper CPU broad hit. That case is useful parity information and should not be collapsed into a generic mismatch.

## Classification

Every completed sample is classified as exactly one of:

- `match-front`: GPU identity equals CPU hit `0`
- `match-deeper-cpu-hit`: GPU identity exists in the CPU stack after index `0`
- `both-miss`: neither side reports an interaction hit
- `cpu-hit-gpu-miss`: CPU stack is non-empty and GPU reports no winner
- `gpu-hit-cpu-miss`: CPU stack is empty and GPU reports a winner
- `gpu-hit-absent-from-cpu-stack`: both sides hit, but GPU identity is absent from the CPU stack

`match-deeper-cpu-hit` is intentionally separate from a true mismatch because CPU player/NPC broad boxes and exact GPU silhouettes do not have identical geometry.

## Identity rules

Static identity compares:

- source map id
- `InteractType`
- interaction id
- tile X/Y

Player identity compares the stable CPU/GPU ECS actor id within the same source map. The raw player interaction id is slot-derived and is not treated as the stable identity.

NPC identity compares server id within the same source map, with ECS actor id as a fallback only when a server id is unavailable.

The recorder snapshots these identities synchronously because ECS/server mappings can change before `mapAsync` readback completes.

## Async policy

M3 already coalesces requests with newest-request-wins behavior. That is useful for interactive queries, but it is undesirable for parity if a CPU stack captured now is later compared against a GPU request that waited behind an older readback.

M4 therefore permits only one parity request in flight. CPU raycasts that occur while parity readback is pending are left completely untouched but are not recorded as parity samples.

This favors trustworthy samples over maximum sample rate.

## Diagnostics

`getWebGPUPickingParityDiagnostics(renderer)` returns a snapshot containing:

- `installed`
- `totalSamples`
- per-classification counts
- up to 128 recent samples

Each recent sample records:

- frame count
- canvas X/Y
- CPU hit count
- CPU front identity
- CPU match index when present
- GPU identity when present
- classification

The recorder does not write to menu, hover, destination, highlight, or interaction state.

## Lifecycle

`Canvas` installs the parity recorder after the existing WebGPU dynamic comparison lifecycle is installed.

Cleanup runs in reverse order:

1. restore the parity raycast wrapper
2. restore dynamic comparison hooks
3. stop/clean up the renderer

The recorder is a no-op unless `webgpuTerrain` comparison mode is requested.

## Validation

`webgpu-picking-parity.test.ts` locks:

- all six parity classifications
- front versus deeper CPU hit distinction
- player ECS identity comparison
- NPC server identity comparison
- exact static map/type/id/tile comparison
- GPU static/dynamic normalization
- passive original-raycast forwarding
- one-in-flight anti-time-skew policy
- bounded diagnostics
- absence of gameplay interaction mutations
- Canvas install/restore ordering

The test is wired into both the normal client test chain and `test:webgpu-foundation`.

## Remaining work

M4 provides the evidence layer needed before any live interaction cutover. The next interaction checkpoint should consume real browser parity data before changing authority.

Useful follow-up work includes:

- summarize mismatch rates by classification and interaction domain
- inspect world-entity/equal-depth edge cases in-browser
- separate expected broad-box/silhouette differences from renderer regressions
- decide whether GPU identity should ever drive hover/highlight state
- define an explicit cutover threshold and fallback policy

Until that evidence is reviewed, CPU interaction remains authoritative.
