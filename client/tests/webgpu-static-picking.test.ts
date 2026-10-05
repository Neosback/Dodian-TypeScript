import assert from "node:assert/strict";

import { InteractType } from "../render/InteractType";
import { WEBGPU_TERRAIN_SHADER } from "../render/webgpu/terrain/WebGPUTerrainShader";
import {
    createWebGPUMapUniformData,
    createWebGPUStaticSourceMapId,
    WEBGPU_MAP_UNIFORM_MAP_ID_WORD_OFFSET,
    WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET,
} from "../render/webgpu/terrain/WebGPUTerrainMapResources";
import { patchWebGPUStaticSceneShaderForWorldEntities } from "../render/webgpu/WebGPUStaticSceneShaderPatch";
import { createWebGPUStaticLocPlanFromData } from "../render/webgpu/loc/WebGPUStaticLocResources";
import {
    decodeWebGPUStaticPickWords,
    packWebGPUStaticPickTile,
    unpackWebGPUStaticPickTile,
    WEBGPU_STATIC_PICK_BYTES_PER_PIXEL,
    WEBGPU_STATIC_PICK_BYTES_PER_ROW,
    WEBGPU_STATIC_PICK_FORMAT,
} from "../render/webgpu/picking/WebGPUStaticPicking";

const packedTile = packWebGPUStaticPickTile(3200, 3199, 2);
assert.deepEqual(unpackWebGPUStaticPickTile(packedTile), {
    tileX: 3200,
    tileY: 3199,
    plane: 2,
});
assert.deepEqual(unpackWebGPUStaticPickTile(packWebGPUStaticPickTile(-5, 99999, 9)), {
    tileX: 0,
    tileY: 0x3fff,
    plane: 3,
});

assert.equal(decodeWebGPUStaticPickWords(new Uint32Array([0, 0, 0, 0])), undefined);
assert.deepEqual(
    decodeWebGPUStaticPickWords(
        new Uint32Array([
            0xffff,
            createWebGPUStaticSourceMapId(50, 60),
            InteractType.NONE,
            (packedTile + 1) >>> 0,
        ]),
    ),
    {
        interactId: 0xffff,
        mapId: createWebGPUStaticSourceMapId(50, 60),
        interactType: InteractType.NONE,
        tileX: 3200,
        tileY: 3199,
        plane: 2,
    },
);
assert.deepEqual(
    decodeWebGPUStaticPickWords(
        new Uint32Array([
            0x12345,
            createWebGPUStaticSourceMapId(50, 60),
            InteractType.LOC,
            (packWebGPUStaticPickTile(3210, 3220, 1) + 1) >>> 0,
        ]),
    ),
    {
        interactId: 0x12345,
        mapId: createWebGPUStaticSourceMapId(50, 60),
        interactType: InteractType.LOC,
        tileX: 3210,
        tileY: 3220,
        plane: 1,
    },
);
assert.equal(WEBGPU_STATIC_PICK_FORMAT, "rgba32uint");
assert.equal(WEBGPU_STATIC_PICK_BYTES_PER_PIXEL, 16);
assert.equal(WEBGPU_STATIC_PICK_BYTES_PER_ROW, 256);

// Source identity is separate from renderPos. This is required for instances
// and world-entity maps whose geometry is rendered somewhere other than mapX/Y.
const sourceMapId = createWebGPUStaticSourceMapId(42, 77);
const mapUniforms = createWebGPUMapUniformData(200, 201, 3, 1.25, 6, sourceMapId);
const mapUniformWords = new Uint32Array(mapUniforms.buffer);
assert.equal(mapUniformWords[WEBGPU_MAP_UNIFORM_MAP_ID_WORD_OFFSET], sourceMapId);
assert.equal(WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET, 8);
assert.deepEqual(Array.from(mapUniforms.slice(8, 24)), [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

// Interaction model-info keeps the worker's 17-bit id/type payload intact in
// the low model-info bits while WebGPU uses the upper info.w bits for placement.
const interactionId = 0x12345;
const modelData = new Uint16Array(8);
modelData[0] = 1;
modelData[4] = 128;
modelData[5] = 256;
modelData[6] = (((interactionId >>> 16) & 0x1) << 3) | (InteractType.LOC << 4);
modelData[7] = interactionId & 0xffff;
const interactionPlan = createWebGPUStaticLocPlanFromData(
    modelData,
    [[0, 3, 1]],
    new Uint8Array([0]),
);
assert.equal((interactionPlan.modelInfoWords[2] >>> 3) & 0x1, 1);
assert.equal((interactionPlan.modelInfoWords[2] >>> 4) & 0x3, InteractType.LOC);
assert.equal(interactionPlan.modelInfoWords[3] & 0xffff, interactionId & 0xffff);

const patched = patchWebGPUStaticSceneShaderForWorldEntities(WEBGPU_TERRAIN_SHADER);
assert.match(patched, /mapId: u32/);
assert.match(patched, /@location\(8\) @interpolate\(flat\) pickData: vec4<u32>/);
assert.match(patched, /fn staticPickPackedTile/);
assert.match(patched, /fn fsPick\(input: VertexOutput\) -> @location\(0\) vec4<u32>/);
assert.match(patched, /let interactId = \(info\.w & 0xffffu\)/);
assert.match(patched, /let interactType = \(info\.z >> 4u\) & 0x3u/);
assert.match(patched, /input\.fogAmount >= 1\.0/);
assert.match(patched, /textureColor\.a < input\.alphaCutOff/);
assert.match(patched, /staticPickData\(0xffffu, map\.mapId, 0u/);

console.log("webgpu asynchronous static-picking contract checks passed");
