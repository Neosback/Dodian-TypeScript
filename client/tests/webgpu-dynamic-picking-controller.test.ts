import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL,
    WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW,
    WEBGPU_DYNAMIC_PICK_FORMAT,
} from "../render/webgpu/picking/WebGPUDynamicPicking";
import {
    resolveWebGPUDynamicPickFromSnapshot,
    type DynamicPickResolutionSnapshot,
} from "../render/webgpu/picking/WebGPUDynamicPickingController";

const controllerSource = readFileSync(
    new URL("../render/webgpu/picking/WebGPUDynamicPickingController.ts", import.meta.url),
    "utf8",
);
const opaquePhaseSource = readFileSync(
    new URL("../render/webgpu/actor/WebGPUOpaqueActorPhase.ts", import.meta.url),
    "utf8",
);
const transparentPhaseSource = readFileSync(
    new URL("../render/webgpu/actor/WebGPUTransparentActorPhase.ts", import.meta.url),
    "utf8",
);
const comparisonSource = readFileSync(
    new URL("../render/webgpu/compare/WebGPUTerrainComparison.ts", import.meta.url),
    "utf8",
);

assert.equal(WEBGPU_DYNAMIC_PICK_FORMAT, "rgba32uint");
assert.equal(WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL, 16);
assert.equal(WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW, 256);

// Async readback resolves against an actor identity snapshot captured at the
// same GPU submission boundary as the actor buffers/uniforms being replayed.
const resolutionSnapshot: DynamicPickResolutionSnapshot = {
    players: new Map([["12860:32771", { actorId: 77, serverId: 901 }]]),
    npcs: new Map([[456, { actorId: 12, serverId: 456 }]]),
};
assert.deepEqual(
    resolveWebGPUDynamicPickFromSnapshot(
        { kind: "player", interactionId: 0x8003, mapId: 12860 },
        resolutionSnapshot,
    ),
    {
        kind: "player",
        interactionId: 0x8003,
        mapId: 12860,
        actorId: 77,
        serverId: 901,
    },
);
assert.deepEqual(
    resolveWebGPUDynamicPickFromSnapshot(
        { kind: "npc", interactionId: 456, mapId: 12860 },
        resolutionSnapshot,
    ),
    {
        kind: "npc",
        interactionId: 456,
        mapId: 12860,
        actorId: 12,
        serverId: 456,
    },
);
assert.equal(
    resolveWebGPUDynamicPickFromSnapshot(
        { kind: "player", interactionId: 0x8004, mapId: 12860 },
        resolutionSnapshot,
    ),
    undefined,
);

// Phase registries expose diagnostics-neutral replay for comparison-only passes.
assert.match(opaquePhaseSource, /export function replayWebGPUOpaqueActorPhase/);
assert.match(opaquePhaseSource, /const handler = handlers\.get\(id\)/);
assert.match(opaquePhaseSource, /handler\.draw\(renderer, pass, frame\)/);
assert.doesNotMatch(
    opaquePhaseSource.slice(opaquePhaseSource.indexOf("export function replayWebGPUOpaqueActorPhase")),
    /addWebGPUDynamicPhaseSample\(/,
);
assert.match(transparentPhaseSource, /export function replayWebGPUTransparentActorPhase/);
assert.match(transparentPhaseSource, /const handler = handlers\.get\(id\)/);
assert.match(transparentPhaseSource, /handler\.draw\(renderer, pass, frame\)/);
assert.doesNotMatch(
    transparentPhaseSource.slice(
        transparentPhaseSource.indexOf("export function replayWebGPUTransparentActorPhase"),
    ),
    /addWebGPUDynamicPhaseSample\(/,
);

// M2 owns an independent integer target and depth target, then narrows fragment
// work to exactly the requested canvas pixel before asynchronous readback.
assert.match(controllerSource, /label: "dynamic-pick-id-target"/);
assert.match(controllerSource, /format: WEBGPU_DYNAMIC_PICK_FORMAT/);
assert.match(controllerSource, /label: "dynamic-pick-depth-target"/);
assert.match(controllerSource, /format: "depth24plus"/);
assert.match(controllerSource, /depthWriteEnabled: true/);
assert.match(controllerSource, /depthCompare: "less-equal"/);
assert.match(controllerSource, /setScissorRect\?\.\(request\.x, request\.y, 1, 1\)/);
assert.match(controllerSource, /copyTextureToBuffer/);
assert.match(controllerSource, /bytesPerRow: WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW/);
assert.match(controllerSource, /mapAsync\(WEBGPU_MAP_MODE\.READ/);

// Newest-request-wins prevents an asynchronous cursor readback backlog.
assert.match(controllerSource, /if \(this\.busy\)/);
assert.match(controllerSource, /this\.queued\?\.resolve\(undefined\)/);
assert.match(controllerSource, /this\.queued = request/);

// SceneFrameDescription is mutable, so freeze identity after async pipeline
// initialization but immediately before scene uniforms and actor replay are submitted.
const renderStart = controllerSource.indexOf("private async renderAndRead");
const ensureInitialized = controllerSource.indexOf("await this.ensureInitialized()", renderStart);
const snapshotCapture = controllerSource.indexOf(
    "const resolutionSnapshot = captureResolutionSnapshot(this.host)",
    renderStart,
);
const sceneUpdate = controllerSource.indexOf("sceneUniforms.update(request.frame)", renderStart);
const mapAsync = controllerSource.indexOf("await readback.mapAsync", renderStart);
assert.ok(
    renderStart >= 0 &&
        ensureInitialized > renderStart &&
        snapshotCapture > ensureInitialized &&
        sceneUpdate > snapshotCapture &&
        mapAsync > sceneUpdate,
);
assert.match(controllerSource, /getRenderPlayersForMap\(map\)/);
assert.match(controllerSource, /PLAYER_INTERACT_BASE \+ \(slot & 0x7fff\)/);
assert.match(controllerSource, /getServerLinkedEcsIds\(\)/);
assert.match(controllerSource, /resolveWebGPUDynamicPickFromSnapshot\(pick, resolutionSnapshot\)/);

// The actor-only pick pass replays the existing prepared GPU phases in the
// intended order and excludes effect/projectile phases.
const replayStart = controllerSource.indexOf("private replayActorPhases");
const opaqueNpc = controllerSource.indexOf(
    'replayWebGPUOpaqueActorPhase(\n            "npc"',
    replayStart,
);
const opaquePlayer = controllerSource.indexOf(
    'replayWebGPUOpaqueActorPhase(\n            "player"',
    replayStart,
);
const alphaNpc = controllerSource.indexOf(
    'replayWebGPUTransparentActorPhase(\n            "npc"',
    replayStart,
);
const alphaPlayer = controllerSource.indexOf(
    'replayWebGPUTransparentActorPhase(\n            "player"',
    replayStart,
);
assert.ok(
    replayStart >= 0 &&
        opaqueNpc > replayStart &&
        opaquePlayer > opaqueNpc &&
        alphaNpc > opaquePlayer &&
        alphaPlayer > alphaNpc,
);
const replayBody = controllerSource.slice(
    replayStart,
    controllerSource.indexOf("private async renderAndRead", replayStart),
);
assert.doesNotMatch(replayBody, /"attached-gfx"/);
assert.doesNotMatch(replayBody, /"world-gfx"/);
assert.doesNotMatch(replayBody, /"projectile"/);

// Transparent players remain no-cull exactly like the existing player alpha pass.
assert.match(controllerSource, /this\.kind === "player" && this\.transparent/);
assert.match(controllerSource, /noCull = true/);
assert.match(controllerSource, /label\.includes\("no-cull"\)/);

// Public comparison surface stays opt-in and does not replace interaction/menu state.
assert.match(comparisonSource, /export function requestWebGPUTerrainDynamicPick/);
assert.match(comparisonSource, /new WebGPUDynamicPickingController/);
assert.match(comparisonSource, /state\.dynamicPicking\?\.dispose\(\)/);
const requestSurfaceStart = comparisonSource.indexOf(
    "export function requestWebGPUTerrainDynamicPick",
);
const requestSurfaceEnd = comparisonSource.indexOf(
    "export function syncWebGPUTerrainTextures",
    requestSurfaceStart,
);
const requestSurface = comparisonSource.slice(requestSurfaceStart, requestSurfaceEnd);
assert.doesNotMatch(requestSurface, /interactHighlight/);
assert.doesNotMatch(requestSurface, /menuOpen|menuEntries|checkInteractions/);

console.log("WebGPU dynamic actor picking controller checks passed");
