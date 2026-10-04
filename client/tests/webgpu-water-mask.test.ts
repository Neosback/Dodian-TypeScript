import assert from "node:assert/strict";

import {
    packRgbaTextureRowsForWebGPU,
    WEBGPU_WATER_MASK_LAYERS,
} from "../render/webgpu/terrain/WebGPUWaterMaskResources";

const width = 66;
const height = 3;
const sourceRowBytes = width * 4;
const source = new Uint8Array(
    sourceRowBytes * height * WEBGPU_WATER_MASK_LAYERS,
);
for (let i = 0; i < source.length; i++) {
    source[i] = i & 0xff;
}

const packed = packRgbaTextureRowsForWebGPU(
    source,
    width,
    height,
    WEBGPU_WATER_MASK_LAYERS,
);
assert.equal(packed.bytesPerRow, 512);
assert.equal(packed.rowsPerImage, height);
assert.equal(
    packed.data.byteLength,
    512 * height * WEBGPU_WATER_MASK_LAYERS,
);

for (let layer = 0; layer < WEBGPU_WATER_MASK_LAYERS; layer++) {
    for (let row = 0; row < height; row++) {
        const sourceOffset = (layer * height + row) * sourceRowBytes;
        const packedOffset = (layer * height + row) * packed.bytesPerRow;
        assert.deepEqual(
            packed.data.slice(packedOffset, packedOffset + sourceRowBytes),
            source.slice(sourceOffset, sourceOffset + sourceRowBytes),
        );
    }
}

console.log("webgpu water-mask row packing checks passed");
