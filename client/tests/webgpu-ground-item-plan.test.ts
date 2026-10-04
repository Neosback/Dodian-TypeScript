import assert from "node:assert/strict";

import type { GroundItemGeometryBuildData } from "../render/ground/GroundItemMeshBuilder";
import {
    getGroundItemGeometrySnapshot,
    recordGroundItemGeometrySnapshot,
} from "../render/ground/GroundItemGeometrySnapshot";
import { createWebGPUStaticGroundItemGeometryData } from "../render/webgpu/ground/WebGPUStaticGroundItemResources";
import { createWebGPUStaticLocPlanFromData } from "../render/webgpu/loc/WebGPUStaticLocResources";

function modelData(seed: number): Uint16Array {
    const data = new Uint16Array(8);
    data[0] = 1;
    data[4] = seed;
    data[5] = seed + 1;
    data[6] = seed + 2;
    data[7] = seed + 3;
    return data;
}

const data: GroundItemGeometryBuildData = {
    vertices: new Uint8Array(24),
    indices: new Int32Array([0, 1, 2, 0, 2, 3]),
    drawRanges: [[0, 3, 1]],
    drawRangesAlpha: [[12, 3, 1]],
    drawRangesLod: [[0, 3, 1]],
    drawRangesLodAlpha: [[12, 3, 1]],
    drawRangesInteract: [[0, 3, 1]],
    drawRangesInteractAlpha: [[12, 3, 1]],
    drawRangesInteractLod: [[0, 3, 1]],
    drawRangesInteractLodAlpha: [[12, 3, 1]],
    planes: {
        main: new Uint8Array([1]),
        alpha: new Uint8Array([2]),
        lod: new Uint8Array([0]),
        lodAlpha: new Uint8Array([3]),
        interact: new Uint8Array([1]),
        interactAlpha: new Uint8Array([2]),
        interactLod: new Uint8Array([0]),
        interactLodAlpha: new Uint8Array([3]),
    },
    modelTextureData: modelData(10),
    modelTextureDataAlpha: modelData(20),
    modelTextureDataLod: modelData(30),
    modelTextureDataLodAlpha: modelData(40),
    modelTextureDataInteract: modelData(50),
    modelTextureDataInteractAlpha: modelData(60),
    modelTextureDataInteractLod: modelData(70),
    modelTextureDataInteractLodAlpha: modelData(80),
    usedTextureIds: new Set([7, 11]),
};

const geometry = createWebGPUStaticGroundItemGeometryData(data);
assert.equal(geometry.vertices, data.vertices);
assert.equal(geometry.indices, data.indices);
assert.equal(geometry.modelTextureData, data.modelTextureData);
assert.equal(geometry.modelTextureDataAlpha, data.modelTextureDataAlpha);
assert.equal(geometry.modelTextureDataLod, data.modelTextureDataLod);
assert.equal(geometry.modelTextureDataLodAlpha, data.modelTextureDataLodAlpha);
assert.equal(geometry.drawRangesPlanes, data.planes.main);
assert.equal(geometry.drawRangesAlphaPlanes, data.planes.alpha);
assert.equal(geometry.drawRangesLodPlanes, data.planes.lod);
assert.equal(geometry.drawRangesLodAlphaPlanes, data.planes.lodAlpha);

assert.deepEqual(
    createWebGPUStaticLocPlanFromData(
        geometry.modelTextureData,
        geometry.drawRanges,
        geometry.drawRangesPlanes,
    ).draws,
    [{ firstIndex: 0, indexCount: 3, instanceCount: 1, firstInstance: 0, plane: 1 }],
);
assert.deepEqual(
    createWebGPUStaticLocPlanFromData(
        geometry.modelTextureDataAlpha,
        geometry.drawRangesAlpha,
        geometry.drawRangesAlphaPlanes,
    ).draws,
    [{ firstIndex: 3, indexCount: 3, instanceCount: 1, firstInstance: 0, plane: 2 }],
);

const map = {};
const first = recordGroundItemGeometrySnapshot(map, data);
assert.equal(getGroundItemGeometrySnapshot(map), first);
assert.equal(first.data, data);

const cleared = recordGroundItemGeometrySnapshot(map, undefined);
assert.ok(cleared.revision > first.revision);
assert.equal(cleared.data, undefined);
assert.equal(getGroundItemGeometrySnapshot(map), cleared);

console.log("webgpu ground-item mapping checks passed");
