import assert from "node:assert/strict";

import type { DynamicActorInstance } from "../render/dynamic/DynamicActorRenderData";
import {
    WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
    getWebGPUPlayerOpaquePipelineVariant,
    packWebGPUPlayerInstanceData,
} from "../render/webgpu/player/WebGPUPlayerOpaqueComparison";
import { WEBGPU_PLAYER_OPAQUE_SHADER } from "../render/webgpu/player/WebGPUPlayerOpaqueShader";

assert.equal(WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES, 112);
assert.equal(getWebGPUPlayerOpaquePipelineVariant(false, true), "opaque-cull");
assert.equal(getWebGPUPlayerOpaquePipelineVariant(false, false), "opaque-no-cull");
assert.equal(getWebGPUPlayerOpaquePipelineVariant(true, true), "opaque-no-cull");

const playerA: DynamicActorInstance = {
    identity: {
        kind: "player",
        actorId: 7,
        serverId: 42,
        worldViewId: -1,
        interactionId: 0x8002,
        sourceMapId: 12850,
    },
    transform: {
        localX: 320,
        localY: 448,
        plane: 2,
        rotation: 1536,
        modelYOffset: -24,
    },
    animation: {
        sequenceId: 808,
        frameId: 3,
        mode: "run",
    },
    colorOverride: {
        hue: 12,
        saturation: 5,
        luminance: 71,
        amount: 180,
    },
    geometryKey: "player-a",
};

const playerB: DynamicActorInstance = {
    identity: {
        kind: "player",
        actorId: 8,
        serverId: 43,
        worldViewId: 5,
        interactionId: 0x8003,
        sourceMapId: 12850,
    },
    transform: {
        localX: -128,
        localY: 1024,
        plane: 1,
        rotation: 256,
        modelYOffset: 96,
    },
    animation: {
        sequenceId: 819,
        frameId: 6,
        overlaySequenceId: 1660,
        overlayFrameId: 2,
        mode: "action",
    },
    colorOverride: {
        hue: 0,
        saturation: 0,
        luminance: 0,
        amount: 0,
    },
    geometryKey: "player-b",
};

const worldTransform = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    4, 5, 6, 1,
]);
const packed = packWebGPUPlayerInstanceData(
    [playerA, playerB],
    (instance) => instance.identity.worldViewId === 5 ? worldTransform : undefined,
);

assert.equal(packed.length, 56);
assert.deepEqual(Array.from(packed.slice(0, 12)), [
    320,
    448,
    2,
    1536,
    12,
    5,
    71,
    180,
    -24,
    0x8002,
    -1,
    0,
]);
assert.deepEqual(Array.from(packed.slice(12, 28)), [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);
assert.deepEqual(Array.from(packed.slice(28, 40)), [
    -128,
    1024,
    1,
    256,
    0,
    0,
    0,
    0,
    96,
    0x8003,
    5,
    0,
]);
assert.deepEqual(Array.from(packed.slice(40, 56)), Array.from(worldTransform));

assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /@location\(0\) packed: vec3<u32>/);
for (let location = 1; location <= 7; location++) {
    assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, new RegExp(`@location\\(${location}\\)`));
}
assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /fn getPlayerHeightInterp/);
assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /worldTransform \* \(scene\.viewMatrix \* vec4<f32>\(worldPos, 1\.0\)\)/);
assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /viewPos\.z \+= f32\(plane\) \* 0\.01/);
assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /let priority = \(input\.packed\.z >> 6u\) & 0x7u/);
assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /fn fsPlayerOpaque/);
assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /material\.frameCount > 1/);
assert.match(WEBGPU_PLAYER_OPAQUE_SHADER, /fogFactor\(worldPos\.xz - scene\.playerPos\)/);

const actorOverrideIndex = WEBGPU_PLAYER_OPAQUE_SHADER.indexOf(
    "hsl = applyHslOverride(rawHsl, actorHslOverride);",
);
const sceneOverrideIndex = WEBGPU_PLAYER_OPAQUE_SHADER.indexOf(
    "hsl = applyHslOverride(hsl, scene.sceneHslOverride);",
);
assert.ok(actorOverrideIndex >= 0);
assert.ok(sceneOverrideIndex > actorOverrideIndex);

console.log("WebGPU opaque player foundation contract checks passed");
