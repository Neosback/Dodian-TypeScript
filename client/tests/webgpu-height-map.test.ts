import assert from "node:assert/strict";

import {
    packR16TextureRowsForWebGPU,
    WEBGPU_HEIGHT_MAP_LAYERS,
} from "../render/webgpu/loc/WebGPUHeightMapResources";

const size = 76;
const source = new Int16Array(size * size * WEBGPU_HEIGHT_MAP_LAYERS);
for (let i = 0; i < source.length; i++) {
    source[i] = (i % 2000) - 1000;
}

const packed = packR16TextureRowsForWebGPU(
    source,
    size,
    size,
    WEBGPU_HEIGHT_MAP_LAYERS,
);
assert.equal(packed.bytesPerRow, 256);
assert.equal(packed.rowsPerImage, size);
assert.equal(
    packed.data.byteLength,
    256 * size * WEBGPU_HEIGHT_MAP_LAYERS,
);

const sourceBytes = new Uint8Array(source.buffer);
const sourceRowBytes = size * 2;
for (let layer = 0; layer < WEBGPU_HEIGHT_MAP_LAYERS; layer++) {
    for (let row = 0; row < size; row++) {
        const sourceOffset = (layer * size + row) * sourceRowBytes;
        const destinationOffset = (layer * size + row) * packed.bytesPerRow;
        assert.deepEqual(
            packed.data.slice(destinationOffset, destinationOffset + sourceRowBytes),
            sourceBytes.slice(sourceOffset, sourceOffset + sourceRowBytes),
        );
    }
}

console.log("webgpu height-map row packing checks passed");
