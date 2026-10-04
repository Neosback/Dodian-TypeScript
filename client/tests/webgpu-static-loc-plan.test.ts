import assert from "node:assert/strict";

import { createWebGPUStaticLocPlan } from "../render/webgpu/loc/WebGPUStaticLocResources";

const modelTextureData = new Uint16Array(24);
// Two draw-header texels. Their R component points at the first instance texel.
modelTextureData[0] = 2;
modelTextureData[4] = 3;

// Instance 0.
modelTextureData[8] = 128 | (1 << 14);
modelTextureData[9] = 256 | (1 << 14);
modelTextureData[10] = 5 | (2 << 6) | (12 << 8);
modelTextureData[11] = 42;
// Instance 1.
modelTextureData[12] = 384 | (2 << 14);
modelTextureData[13] = 512 | (0 << 14);
modelTextureData[14] = 3 | (3 << 6) | (7 << 8);
modelTextureData[15] = 99;

const plan = createWebGPUStaticLocPlan({
    vertices: new Uint8Array(24),
    indices: new Int32Array([0, 1, 2, 3, 4, 5]),
    modelTextureData,
    drawRanges: [
        [0, 3, 1],
        [12, 3, 1],
    ],
    drawRangesPlanes: new Uint8Array([1, 2]),
});

assert.deepEqual(plan.draws, [
    {
        firstIndex: 0,
        indexCount: 3,
        instanceCount: 1,
        firstInstance: 0,
        plane: 1,
    },
    {
        firstIndex: 3,
        indexCount: 3,
        instanceCount: 1,
        firstInstance: 1,
        plane: 2,
    },
]);
assert.deepEqual(
    Array.from(plan.modelInfoWords.slice(0, 8)),
    Array.from(modelTextureData.slice(8, 16)),
);

assert.throws(
    () =>
        createWebGPUStaticLocPlan({
            vertices: new Uint8Array(12),
            indices: new Int32Array([0]),
            modelTextureData: new Uint16Array([1, 0, 0, 0]),
            drawRanges: [[2, 1, 1]],
            drawRangesPlanes: new Uint8Array([0]),
        }),
    /4-byte aligned/,
);

console.log("webgpu static-loc draw-plan checks passed");
