import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { InteractType } from "../render/InteractType";
import {
    decodeWebGPUCombinedPickWords,
    type WebGPUCombinedDynamicIdentitySnapshot,
} from "../render/webgpu/picking/WebGPUCombinedPickingController";
import {
    WEBGPU_COMBINED_DYNAMIC_PICK_TAG,
    patchWebGPUDynamicActorShaderForCombinedPicking,
    patchWebGPUDynamicActorShaderForPicking,
} from "../render/webgpu/picking/WebGPUDynamicPickingShaderPatch";
import { WEBGPU_PLAYER_ALPHA_SHADER } from "../render/webgpu/player/WebGPUPlayerAlphaShader";
import { WEBGPU_NPC_ALPHA_SHADER } from "../render/webgpu/npc/WebGPUNpcAlphaShader";
import { packWebGPUStaticPickTile } from "../render/webgpu/picking/WebGPUStaticPicking";

const controllerSource = readFileSync(
    new URL("../render/webgpu/picking/WebGPUCombinedPickingController.ts", import.meta.url),
    "utf8",
);
const comparisonSource = readFileSync(
    new URL("../render/webgpu/compare/WebGPUTerrainComparison.ts", import.meta.url),
    "utf8",
);

assert.equal(WEBGPU_COMBINED_DYNAMIC_PICK_TAG >>> 0, 0x80000000);

const snapshot: WebGPUCombinedDynamicIdentitySnapshot = {
    players: new Map([
        ["12860:32771", { actorId: 77, serverId: 901 }],
    ]),
    npcs: new Map([
        [456, { actorId: 12, serverId: 456 }],
    ]),
};

// Static LOC/OBJ values intentionally collide numerically with the M1/M2
// player/NPC kind codes. Without the M3 high-bit namespace these would be
// ambiguous, so prove that untagged 1/2 remain static.
const locTile = packWebGPUStaticPickTile(3200, 3201, 1);
assert.deepEqual(
    decodeWebGPUCombinedPickWords(
        new Uint32Array([1001, 12860, InteractType.LOC, (locTile + 1) >>> 0]),
        snapshot,
    ),
    {
        source: "static",
        result: {
            interactId: 1001,
            mapId: 12860,
            interactType: InteractType.LOC,
            tileX: 3200,
            tileY: 3201,
            plane: 1,
        },
    },
);
const objTile = packWebGPUStaticPickTile(3202, 3203, 0);
assert.equal(
    decodeWebGPUCombinedPickWords(
        new Uint32Array([2002, 12860, InteractType.OBJ, (objTile + 1) >>> 0]),
        snapshot,
    )?.source,
    "static",
);

// Tagged dynamic payloads keep the M1/M2 kind code in the low bits and resolve
// against the actor identity snapshot captured at GPU submission time.
assert.deepEqual(
    decodeWebGPUCombinedPickWords(
        new Uint32Array([0x8003, 12860, 0x80000001, 1]),
        snapshot,
    ),
    {
        source: "dynamic",
        result: {
            kind: "player",
            interactionId: 0x8003,
            mapId: 12860,
            actorId: 77,
            serverId: 901,
        },
    },
);
assert.deepEqual(
    decodeWebGPUCombinedPickWords(
        new Uint32Array([456, 12860, 0x80000002, 1]),
        snapshot,
    ),
    {
        source: "dynamic",
        result: {
            kind: "npc",
            interactionId: 456,
            mapId: 12860,
            actorId: 12,
            serverId: 456,
        },
    },
);
assert.equal(
    decodeWebGPUCombinedPickWords(
        new Uint32Array([0x8004, 12860, 0x80000001, 1]),
        snapshot,
    ),
    undefined,
);
assert.equal(
    decodeWebGPUCombinedPickWords(new Uint32Array([0, 0, 0, 0]), snapshot),
    undefined,
);

// The combined shader is additive: M1/M2 keeps its untagged entry point while
// M3 receives a separate tagged fragment entry point.
const playerStandalone = patchWebGPUDynamicActorShaderForPicking(
    WEBGPU_PLAYER_ALPHA_SHADER,
    "player",
);
const playerCombined = patchWebGPUDynamicActorShaderForCombinedPicking(
    WEBGPU_PLAYER_ALPHA_SHADER,
    "player",
);
const npcCombined = patchWebGPUDynamicActorShaderForCombinedPicking(
    WEBGPU_NPC_ALPHA_SHADER,
    "npc",
);
assert.match(playerStandalone, /fn fsDynamicPick/);
assert.doesNotMatch(playerStandalone, /0x80000000u/);
assert.match(playerCombined, /fn fsDynamicCombinedPick/);
assert.match(playerCombined, /\(0x80000000u \| 1u\)/);
assert.match(npcCombined, /fn fsDynamicCombinedPick/);
assert.match(npcCombined, /\(0x80000000u \| 2u\)/);

// One integer target plus one shared depth target performs the arbitration.
assert.match(controllerSource, /label: "combined-pick-id-target"/);
assert.match(controllerSource, /label: "combined-pick-depth-target"/);
assert.match(controllerSource, /format: "depth24plus"/);
assert.match(controllerSource, /depthWriteEnabled: true/);
assert.match(controllerSource, /depthCompare: "less-equal"/);
assert.match(controllerSource, /setScissorRect\?\.\(request\.x, request\.y, 1, 1\)/);
assert.match(controllerSource, /copyTextureToBuffer/);
assert.match(controllerSource, /mapAsync\(WEBGPU_MAP_MODE\.READ/);

// Interaction-relevant ordering mirrors the renderer boundary: static opaque,
// actor opaque, static alpha, actor alpha. Effect-only phases stay excluded.
const renderStart = controllerSource.indexOf("private async renderAndRead");
const staticOpaque = controllerSource.indexOf(
    "this.drawStaticPhase(pass, request.frame, false)",
    renderStart,
);
const actorOpaque = controllerSource.indexOf(
    "this.replayActorPhase(pass, request.frame, false)",
    renderStart,
);
const staticAlpha = controllerSource.indexOf(
    "this.drawStaticPhase(pass, request.frame, true)",
    renderStart,
);
const actorAlpha = controllerSource.indexOf(
    "this.replayActorPhase(pass, request.frame, true)",
    renderStart,
);
assert.ok(
    renderStart >= 0 &&
        staticOpaque > renderStart &&
        actorOpaque > staticOpaque &&
        staticAlpha > actorOpaque &&
        actorAlpha > staticAlpha,
);
const replayBody = controllerSource.slice(
    controllerSource.indexOf("private replayActorPhase"),
    renderStart,
);
assert.doesNotMatch(replayBody, /attached-gfx|world-gfx|projectile/);
assert.match(replayBody, /replayWebGPUOpaqueActorPhase\("npc"/);
assert.match(replayBody, /replayWebGPUOpaqueActorPhase\("player"/);
assert.match(replayBody, /replayWebGPUTransparentActorPhase\("npc"/);
assert.match(replayBody, /replayWebGPUTransparentActorPhase\("player"/);

// The mutable SceneFrameDescription rule from M2 remains intact: freeze actor
// identity after initialization/target readiness, immediately before uniforms
// and command recording, then carry it across mapAsync.
const ensureInit = controllerSource.indexOf("await this.ensureInitialized()", renderStart);
const identityCapture = controllerSource.indexOf(
    "const identitySnapshot = captureDynamicIdentitySnapshot(this.host)",
    renderStart,
);
const sceneUpdate = controllerSource.indexOf("sceneUniforms.update(request.frame)", renderStart);
const mapAsync = controllerSource.indexOf("await readback.mapAsync", renderStart);
assert.ok(
    ensureInit > renderStart &&
        identityCapture > ensureInit &&
        sceneUpdate > identityCapture &&
        mapAsync > sceneUpdate,
);

// Newest-request-wins remains the async cursor policy.
assert.match(controllerSource, /if \(this\.busy\)/);
assert.match(controllerSource, /this\.queued\?\.resolve\(undefined\)/);
assert.match(controllerSource, /this\.queued = request/);

// M3 is exposed only through comparison mode and is cleaned up with that state.
assert.match(comparisonSource, /export function requestWebGPUTerrainCombinedPick/);
assert.match(comparisonSource, /new WebGPUCombinedPickingController/);
assert.match(comparisonSource, /state\.combinedPicking\?\.dispose\(\)/);
const surfaceStart = comparisonSource.indexOf("export function requestWebGPUTerrainCombinedPick");
const surfaceEnd = comparisonSource.indexOf("export function syncWebGPUTerrainTextures", surfaceStart);
const surface = comparisonSource.slice(surfaceStart, surfaceEnd);
assert.doesNotMatch(surface, /menuOpen|menuEntries|interactHighlight|checkInteractions/);

console.log("WebGPU combined static/dynamic picking checks passed");
