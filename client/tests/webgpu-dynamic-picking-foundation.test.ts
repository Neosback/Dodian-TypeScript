import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { DynamicActorInstance } from "../render/dynamic/DynamicActorRenderData";
import { WEBGPU_NPC_ALPHA_SHADER } from "../render/webgpu/npc/WebGPUNpcAlphaShader";
import { WEBGPU_NPC_OPAQUE_SHADER } from "../render/webgpu/npc/WebGPUNpcOpaqueShader";
import { WEBGPU_PLAYER_ALPHA_SHADER } from "../render/webgpu/player/WebGPUPlayerAlphaShader";
import { WEBGPU_PLAYER_OPAQUE_SHADER } from "../render/webgpu/player/WebGPUPlayerOpaqueShader";
import {
    createWebGPUDynamicPickWords,
    decodeWebGPUDynamicPickKind,
    decodeWebGPUDynamicPickWords,
    encodeWebGPUDynamicPickKind,
    isWebGPUDynamicPickHighlightable,
    resolveWebGPUDynamicPickInstance,
    WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL,
    WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW,
    WEBGPU_DYNAMIC_PICK_FORMAT,
    WEBGPU_DYNAMIC_PICK_KIND_NPC,
    WEBGPU_DYNAMIC_PICK_KIND_PLAYER,
} from "../render/webgpu/picking/WebGPUDynamicPicking";
import { patchWebGPUDynamicActorShaderForPicking } from "../render/webgpu/picking/WebGPUDynamicPickingShaderPatch";

function actor(
    kind: "player" | "npc",
    actorId: number,
    serverId: number,
    interactionId: number,
    sourceMapId: number,
): DynamicActorInstance {
    return {
        identity: { kind, actorId, serverId, interactionId, sourceMapId },
        transform: { localX: 64, localY: 96, plane: 1, rotation: 512 },
        animation: { sequenceId: 1, frameId: 2 },
        colorOverride: { hue: 0, saturation: 0, luminance: 0, amount: 0 },
        geometryKey: `${kind}:${actorId}`,
    };
}

const player = actor("player", 17, 9001, 0x8000 + 23, 0x0032003c);
const npc = actor("npc", 41, 1234, 1234, 0x0032003c);

assert.equal(WEBGPU_DYNAMIC_PICK_FORMAT, "rgba32uint");
assert.equal(WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL, 16);
assert.equal(WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW, 256);
assert.equal(encodeWebGPUDynamicPickKind("player"), WEBGPU_DYNAMIC_PICK_KIND_PLAYER);
assert.equal(encodeWebGPUDynamicPickKind("npc"), WEBGPU_DYNAMIC_PICK_KIND_NPC);
assert.equal(decodeWebGPUDynamicPickKind(WEBGPU_DYNAMIC_PICK_KIND_PLAYER), "player");
assert.equal(decodeWebGPUDynamicPickKind(WEBGPU_DYNAMIC_PICK_KIND_NPC), "npc");
assert.equal(decodeWebGPUDynamicPickKind(0), undefined);
assert.equal(decodeWebGPUDynamicPickKind(99), undefined);

assert.deepEqual(Array.from(createWebGPUDynamicPickWords(player)), [
    0x8000 + 23,
    0x0032003c,
    WEBGPU_DYNAMIC_PICK_KIND_PLAYER,
    1,
]);
assert.deepEqual(Array.from(createWebGPUDynamicPickWords(npc)), [
    1234,
    0x0032003c,
    WEBGPU_DYNAMIC_PICK_KIND_NPC,
    1,
]);
assert.equal(decodeWebGPUDynamicPickWords(new Uint32Array([0, 0, 0, 0])), undefined);
assert.equal(decodeWebGPUDynamicPickWords(new Uint32Array([1, 2, 99, 1])), undefined);
assert.deepEqual(decodeWebGPUDynamicPickWords(createWebGPUDynamicPickWords(player)), {
    kind: "player",
    interactionId: 0x8000 + 23,
    mapId: 0x0032003c,
});
assert.deepEqual(decodeWebGPUDynamicPickWords(createWebGPUDynamicPickWords(npc)), {
    kind: "npc",
    interactionId: 1234,
    mapId: 0x0032003c,
});

assert.equal(resolveWebGPUDynamicPickInstance(
    decodeWebGPUDynamicPickWords(createWebGPUDynamicPickWords(player))!,
    [npc, player],
), player);
assert.equal(resolveWebGPUDynamicPickInstance(
    { kind: "npc", interactionId: 9999, mapId: npc.identity.sourceMapId },
    [npc, player],
), undefined);
assert.equal(isWebGPUDynamicPickHighlightable({ kind: "npc", interactionId: 1, mapId: 2 }), true);
assert.equal(isWebGPUDynamicPickHighlightable({ kind: "player", interactionId: 1, mapId: 2 }), false);

for (const [kind, source] of [
    ["player", WEBGPU_PLAYER_OPAQUE_SHADER],
    ["player", WEBGPU_PLAYER_ALPHA_SHADER],
    ["npc", WEBGPU_NPC_OPAQUE_SHADER],
    ["npc", WEBGPU_NPC_ALPHA_SHADER],
] as const) {
    const patched = patchWebGPUDynamicActorShaderForPicking(source, kind);
    assert.match(patched, /@location\(5\) @interpolate\(flat\) pickData: vec4<u32>/);
    assert.match(patched, /fn fsDynamicPick/);
    assert.match(patched, /u32\(max\(input\.actorMisc\.y, 0\.0\)\)/);
    assert.match(patched, /map\.mapId/);
    assert.match(patched, /input\.fogAmount >= 1\.0/);
    assert.match(patched, /textureColor\.a < input\.alphaCutOff/);
    assert.match(patched, /return input\.pickData/);

    if (kind === "player") {
        assert.match(patched, /fn vsPlayerOpaque/);
        assert.match(patched, /depthLayerClip/);
        assert.match(patched, /\n        1u,\n        1u,/);
    } else {
        assert.match(patched, /fn vsNpcOpaque/);
        assert.match(patched, /viewPos\.z \+= f32\(plane\) \* 0\.01/);
        assert.doesNotMatch(patched, /depthLayerClip/);
        assert.match(patched, /\n        2u,\n        1u,/);
    }
}

// The existing client interaction highlight intentionally supports LOC/NPC only.
// Player menu entries clear active highlight rather than creating a player halo.
const highlightConstants = readFileSync(
    new URL("../render/render/constants.ts", import.meta.url),
    "utf8",
);
const highlightActions = readFileSync(
    new URL("../render/render/interact/highlight4.ts", import.meta.url),
    "utf8",
);
assert.match(highlightConstants, /InteractHighlightTarget = LocHighlightTarget \| NpcHighlightTarget/);
assert.doesNotMatch(highlightConstants, /kind: "player"/);
assert.match(highlightActions, /entry\.targetType === MenuTargetType\.PLAYER/);
assert.match(highlightActions, /host\.clearInteractHighlightActiveTarget\(\)/);

console.log("WebGPU dynamic player/NPC picking foundation checks passed");
