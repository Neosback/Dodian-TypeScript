import assert from "node:assert/strict";

import { createWebGPUTerrainDrawPlan } from "../render/webgpu/terrain/WebGPUTerrainMapResources";

const plan = createWebGPUTerrainDrawPlan({
    mapX: 50,
    mapY: 60,
    renderPosX: 100,
    renderPosY: 101,
    vertices: new Uint8Array(36),
    indices: new Int32Array([0, 1, 2, 2, 3, 0]),
    drawRanges: [
        [0, 3, 1],
        [12, 0, 1],
        [12, 3, 1],
    ],
    drawRangesPlanes: new Uint8Array([0, 1, 2]),
    borderSize: 0,
    heightMapSize: 1,
    waterMaskTextureData: new Uint8Array(16),
});

assert.equal(plan.mapX, 50);
assert.equal(plan.mapY, 60);
assert.equal(plan.renderPosX, 100);
assert.equal(plan.renderPosY, 101);
assert.deepEqual(plan.draws, [
    { firstIndex: 0, indexCount: 3, instanceCount: 1, plane: 0 },
    { firstIndex: 3, indexCount: 3, instanceCount: 1, plane: 2 },
]);

assert.throws(
    () =>
        createWebGPUTerrainDrawPlan({
            mapX: 1,
            mapY: 2,
            vertices: new Uint8Array(12),
            indices: new Int32Array([0]),
            drawRanges: [[2, 1, 1]],
            drawRangesPlanes: new Uint8Array([0]),
            borderSize: 0,
            heightMapSize: 1,
            waterMaskTextureData: new Uint8Array(16),
        }),
    /4-byte aligned/,
);

console.log("webgpu terrain draw-plan checks passed");
