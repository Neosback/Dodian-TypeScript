import assert from "node:assert/strict";

import type { SdMapData } from "../render/loader/SdMapData";
import { createWebGPUStaticDoorGeometryData } from "../render/webgpu/loc/WebGPUStaticDoorResources";
import { createWebGPUStaticLocPlanFromData } from "../render/webgpu/loc/WebGPUStaticLocResources";

function modelData(x: number): Uint16Array {
    const data = new Uint16Array(8);
    data[0] = 1;
    data[4] = x;
    data[5] = x + 1;
    data[6] = x + 2;
    data[7] = x + 3;
    return data;
}

const opaque = modelData(10);
const alpha = modelData(20);
const lod = modelData(30);
const lodAlpha = modelData(40);
const interact = modelData(50);
const interactAlpha = modelData(60);
const interactLod = modelData(70);
const interactLodAlpha = modelData(80);

const mapData = {
    doorVertices: new Uint8Array(24),
    doorIndices: new Int32Array([0, 1, 2, 0, 2, 3]),
    doorModelTextureData: opaque,
    doorModelTextureDataAlpha: alpha,
    doorModelTextureDataLod: lod,
    doorModelTextureDataLodAlpha: lodAlpha,
    doorModelTextureDataInteract: interact,
    doorModelTextureDataInteractAlpha: interactAlpha,
    doorModelTextureDataInteractLod: interactLod,
    doorModelTextureDataInteractLodAlpha: interactLodAlpha,
    doorDrawRanges: [[0, 3, 1]],
    doorDrawRangesAlpha: [[12, 3, 1]],
    doorDrawRangesPlanes: new Uint8Array([1]),
    doorDrawRangesAlphaPlanes: new Uint8Array([2]),
    doorDrawRangesLod: [[0, 3, 1]],
    doorDrawRangesLodAlpha: [[12, 3, 1]],
    doorDrawRangesLodPlanes: new Uint8Array([0]),
    doorDrawRangesLodAlphaPlanes: new Uint8Array([3]),
    doorDrawRangesInteract: [[0, 3, 1]],
    doorDrawRangesInteractAlpha: [[12, 3, 1]],
    doorDrawRangesInteractPlanes: new Uint8Array([1]),
    doorDrawRangesInteractAlphaPlanes: new Uint8Array([2]),
    doorDrawRangesInteractLod: [[0, 3, 1]],
    doorDrawRangesInteractLodAlpha: [[12, 3, 1]],
    doorDrawRangesInteractLodPlanes: new Uint8Array([0]),
    doorDrawRangesInteractLodAlphaPlanes: new Uint8Array([3]),
} as unknown as SdMapData;

const geometry = createWebGPUStaticDoorGeometryData(mapData);
assert.equal(geometry.vertices, mapData.doorVertices);
assert.equal(geometry.indices, mapData.doorIndices);
assert.equal(geometry.modelTextureData, opaque);
assert.equal(geometry.modelTextureDataAlpha, alpha);
assert.equal(geometry.modelTextureDataLod, lod);
assert.equal(geometry.modelTextureDataLodAlpha, lodAlpha);
assert.equal(geometry.drawRanges, mapData.doorDrawRanges);
assert.equal(geometry.drawRangesAlpha, mapData.doorDrawRangesAlpha);
assert.equal(geometry.drawRangesLod, mapData.doorDrawRangesLod);
assert.equal(geometry.drawRangesLodAlpha, mapData.doorDrawRangesLodAlpha);

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
assert.deepEqual(
    createWebGPUStaticLocPlanFromData(
        geometry.modelTextureDataLodAlpha,
        geometry.drawRangesLodAlpha,
        geometry.drawRangesLodAlphaPlanes,
    ).draws,
    [{ firstIndex: 3, indexCount: 3, instanceCount: 1, firstInstance: 0, plane: 3 }],
);

console.log("webgpu static-door mapping checks passed");
