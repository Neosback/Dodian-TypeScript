# WebGPU baseline validation

Working branch: `feat/webgpu-renderer`

Validation date: 2026-10-06

Feature validation commit: `37851faad53a0b1df59ce0934eb22338b1bf9d64`

Main comparison commit: `264dcb29a0d635a0bab518837017b7363ad69edc`

This checkpoint validates the current migration branch before renderer ownership changes. A temporary GitHub Actions workflow ran the feature branch and, in parallel, checked out `main` with the same Node/Yarn environment so failures could be separated into inherited project debt and migration-branch regressions. The temporary workflow was removed after the comparison.

## Result summary

| Gate | Feature branch | Main | Classification |
| --- | --- | --- | --- |
| Dependency install | Pass with peer warnings | Pass with same peer warnings | Inherited, non-blocking |
| Client TypeScript typecheck | Fail | Fail | Mixed: inherited errors plus WebGPU-specific branch errors |
| `test:webgpu-foundation` | Fail | Not present on main | Migration branch failure |
| Full client test suite | Fail | Fail at the same test | Inherited failure |
| Production client build under CI | Fail | Fail | Primarily inherited lint/BOM debt, plus one branch-only lint warning |

The branch is therefore **not clean enough to begin renderer-ownership changes yet**. The WebGPU-specific failures should be repaired first. The inherited `main` failures should be tracked as baseline debt and should not be falsely attributed to the WebGPU migration.

## Inherited failures confirmed on main

### TypeScript

`main` and the feature branch both fail on the same existing errors in:

- `game/plugins/editmode/EditorUi.ts`: `GameRenderer` does not declare `itemIconRenderer`.
- `game/plugins/editmode/LocPlacementPreviewOverlay.ts`: optional shader/source strings are passed where non-optional values are required.
- `network/serverConnection/connection/WebRtcGameSocket.ts`: several possibly-undefined accesses.
- `render/player/PlayerRenderer.ts`: PicoGL `VertexBuffer` typing does not expose `byteLength`.

These failures existed on `main` before the WebGPU branch and are not migration regressions.

### Full client test suite

Both `main` and the feature branch stop at the same assertion in:

`client/tests/npc-instance-flush-controller.test.ts`

`serverSpawnRendersBeforeMapBatchRefresh` expects `2` and receives `0`.

This is an inherited baseline failure. It currently prevents the package-level chained `client test` command from reaching later tests, so individual WebGPU tests remain important until that unrelated test is repaired.

### Production build

Both `main` and the feature branch fail the React production build because GitHub Actions sets `CI=true`, promoting existing ESLint warnings to errors.

Shared failures include:

- Unicode BOM warnings in generated/common packet files.
- existing unused variables/imports across combat, edit mode, widget input, health-bar overlay, and related code.
- the existing mixed-operator warning in `FirstPersonPlugin`.
- existing `react/no-is-mounted` warnings in `CustomInterfaceRuntime`.

The dependency install also reports the same peer-dependency warnings on both refs, including the TypeScript 6 / `react-scripts` peer mismatch. Installation still succeeds.

## Migration-branch failures

These do **not** occur on `main` and must be cleared before checkpoint B.

### 1. WebGPU TypeScript errors

The feature branch adds WebGPU-specific typecheck failures in four groups.

#### Scene frame timing name mismatch

Multiple dynamic modules read `frame.currentTime`, while `SceneFrameDescription` exposes `timeSeconds`.

Affected areas include:

- opaque/transparent actor phases;
- player opaque/alpha comparison;
- NPC opaque/alpha comparison;
- attached GFX;
- world GFX;
- projectiles.

This is a real renderer-neutral contract mismatch, not an inherited project error. The fix should choose one canonical frame-time field and update the WebGPU dynamic consumers consistently rather than adding duplicate timing state casually.

#### Static loc geometry contract drift

`WebGPUStaticSceneRenderer` constructs geometry expected to satisfy `LocGeometryData`, but the object is missing the newer `facePriorities` and `facePriorityModelSpans` fields.

The static WebGPU resource path must preserve the exact `LocGeometryData` contract introduced by the face-priority work.

#### Picking strict-null errors

WebGPU picking code has possibly-undefined values in:

- `WebGPUCombinedPickingController`;
- `WebGPUDynamicPicking`;
- `WebGPUDynamicPickingController`;
- `WebGPUPickingParity`.

These should be resolved with explicit identity/readback validity handling, not broad non-null assertions unless the invariant is proven locally.

### 2. WebGPU foundation assertion failure

`client/tests/webgpu-face-priority-depth.test.ts` fails a strict deep comparison because the produced vector contains `-0` where the expected value is `0`:

`actual: [30, -0, 60]`

`expected: [30, 0, 60]`

JavaScript strict deep equality distinguishes signed zero. The underlying depth/bias helper should normalize an arithmetic negative zero when zero is the intended renderer-neutral result, rather than weakening the test globally.

All foundation tests before this assertion completed successfully in the validation run.

### 3. Branch-only production-build warning

The feature branch adds one build warning not present in the `main` build log:

`ui/model/Model2DRenderer.ts`: local `var18` is assigned but unused.

The production build already fails on inherited `main` warnings, but this branch-specific warning should still be removed so the migration does not add lint debt.

## Validation interpretation

The current branch has two different categories of red gates:

1. **Inherited repository debt** that reproduces identically on `main`.
2. **WebGPU migration regressions** that are unique to this branch.

For this migration, the immediate requirement is to make the branch add no new typecheck, foundation-test, or build-lint failures relative to `main` before renderer ownership is changed.

The full package test/build commands cannot become globally green without also fixing unrelated `main` debt. That broader cleanup should not be silently mixed into the WebGPU architecture work unless it becomes necessary to validate the migration.

## Next checkpoint

Before beginning renderer-neutral host/map ownership work:

1. fix the WebGPU `SceneFrameDescription` timing mismatch;
2. restore the full `LocGeometryData` contract in the WebGPU static scene path;
3. fix WebGPU picking strict-null errors;
4. normalize the signed-zero face-priority depth result;
5. remove the branch-only `Model2DRenderer` lint warning;
6. rerun typecheck and `test:webgpu-foundation` to confirm that only the known `main` baseline errors remain;
7. rerun the relevant targeted tests around the touched code.

Only after those branch-specific failures are clean should checkpoint B begin.
