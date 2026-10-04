import assert from "node:assert/strict";

import {
    createFallbackWaterTextureData,
    WEBGPU_WATER_TEXTURE_LAYERS,
} from "../render/webgpu/terrain/WebGPUWaterResources";
import { WATER_TEXTURE_SIZE } from "../render/render/constants";

const data = createFallbackWaterTextureData();
const layerBytes = WATER_TEXTURE_SIZE * WATER_TEXTURE_SIZE * 4;
assert.equal(data.byteLength, layerBytes * WEBGPU_WATER_TEXTURE_LAYERS);

assert.deepEqual(Array.from(data.slice(0, 4)), [128, 128, 255, 255]);
assert.deepEqual(Array.from(data.slice(layerBytes, layerBytes + 4)), [128, 128, 255, 255]);
assert.deepEqual(
    Array.from(data.slice(layerBytes * 2, layerBytes * 2 + 4)),
    [128, 128, 0, 255],
);
assert.deepEqual(
    Array.from(data.slice(layerBytes * 3, layerBytes * 3 + 4)),
    [255, 255, 255, 255],
);

console.log("webgpu water fallback texture checks passed");
