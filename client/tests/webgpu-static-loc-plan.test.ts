import assert from "node:assert/strict";

import {
    createWebGPUStaticLocPlan,
    createWebGPUStaticLocPlanFromData,
} from "../render/webgpu/loc/WebGPUStaticLocResources";

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
    facePriorities: new Uint8Array([2, 11]),
    facePriorityModelSpans: new Uint32Array([0, 3, 3, 3]),
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

function makeVariantData(firstInstance: number, packedSeed: number): Uint16Array {
    const data = new Uint16Array(16);
    data[0] = 1 + firstInstance;
    const offset = 4 + firstInstance * 4;
    data[offset] = packedSeed | (1 << 14);
    data[offset + 1] = (packedSeed + 64) | (1 << 14);
    data[offset + 2] = 2 | (2 << 6) | (5 << 8);
    data[offset + 3] = packedSeed + 1;
    return data;
}

const alphaPlan = createWebGPUStaticLocPlanFromData(
    makeVariantData(0, 320),
    [[24, 6, 1]],
    new Uint8Array([1]),
);
assert.deepEqual(alphaPlan.draws, [
    {
        firstIndex: 6,
        indexCount: 6,
        instanceCount: 1,
        firstInstance: 0,
        plane: 1,
    },
]);
assert.equal(alphaPlan.modelInfoWords[0], 320 | (1 << 14));

const lodPlan = createWebGPUStaticLocPlanFromData(
    makeVariantData(1, 448),
    [[48, 3, 1]],
    new Uint8Array([2]),
);
assert.deepEqual(lodPlan.draws, [
    {
        firstIndex: 12,
        indexCount: 3,
        instanceCount: 1,
        firstInstance: 1,
        plane: 2,
    },
]);
assert.equal(lodPlan.modelInfoWords[4], 448 | (1 << 14));

const lodAlphaPlan = createWebGPUStaticLocPlanFromData(
    makeVariantData(0, 576),
    [[60, 9, 2]],
    new Uint8Array([3]),
);
assert.deepEqual(lodAlphaPlan.draws, [
    {
        firstIndex: 15,
        indexCount: 9,
        instanceCount: 2,
        firstInstance: 0,
        plane: 3,
    },
]);
assert.equal(lodAlphaPlan.modelInfoWords[0], 576 | (1 << 14));

const hiddenModelData = new Uint16Array(8);
hiddenModelData[0] = 1;
hiddenModelData[4] = 704 | (1 << 14);
hiddenModelData[5] = 768 | (1 << 14);
hiddenModelData[6] = 1 | (2 << 6) | (8 << 8);
hiddenModelData[7] = 123;
const hiddenPlan = createWebGPUStaticLocPlanFromData(
    hiddenModelData,
    [[0, 0, 0]],
    new Uint8Array([2]),
);
assert.deepEqual(hiddenPlan.draws, [
    {
        firstIndex: 0,
        indexCount: 0,
        instanceCount: 0,
        firstInstance: 0,
        plane: 2,
    },
]);
assert.equal(
    hiddenPlan.modelInfoWords[0],
    704 | (1 << 14),
    "hidden animation slots must retain their placement record",
);

const emptyPlan = createWebGPUStaticLocPlanFromData(
    new Uint16Array(0),
    [],
    new Uint8Array(0),
);
assert.deepEqual(emptyPlan.draws, []);
assert.equal(emptyPlan.modelInfoWords.length, 4);

assert.throws(
    () =>
        createWebGPUStaticLocPlan({
            vertices: new Uint8Array(12),
            indices: new Int32Array([0, 1, 2]),
            facePriorities: new Uint8Array([0]),
            facePriorityModelSpans: new Uint32Array([0, 3]),
            modelTextureData: new Uint16Array([1, 0, 0, 0]),
            drawRanges: [[2, 1, 1]],
            drawRangesPlanes: new Uint8Array([0]),
        }),
    /4-byte aligned/,
);

console.log("webgpu static-loc draw-plan and variant checks passed");
