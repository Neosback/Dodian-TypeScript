import assert from "node:assert/strict";

import {
    getWebGPUHeightMapSharingDiagnostics,
    packR16TextureRowsForWebGPU,
    WEBGPU_HEIGHT_MAP_LAYERS,
    WebGPUHeightMapResources,
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

let textureAllocations = 0;
let textureUploads = 0;
let textureDestroys = 0;
const sharedTexture = {
    createView: () => ({}),
    destroy: () => {
        textureDestroys++;
    },
};
const fakeDevice = {
    queue: {
        writeTexture: () => {
            textureUploads++;
        },
    },
    createTexture: () => {
        textureAllocations++;
        return sharedTexture;
    },
} as any;

const sharedSource = new Int16Array(4 * 4 * WEBGPU_HEIGHT_MAP_LAYERS);
const first = new WebGPUHeightMapResources(fakeDevice, 4, sharedSource);
const second = new WebGPUHeightMapResources(fakeDevice, 4, sharedSource);
assert.equal(first.texture, second.texture, "same source identity shares one GPU texture");
assert.equal(textureAllocations, 1);
assert.equal(textureUploads, 1);
assert.deepEqual(getWebGPUHeightMapSharingDiagnostics(fakeDevice), {
    allocations: 1,
    reuses: 1,
    releases: 0,
    destroys: 0,
});

first.dispose();
assert.equal(textureDestroys, 0, "shared texture stays alive while another owner remains");
second.dispose();
assert.equal(textureDestroys, 1, "last owner releases the shared texture");
assert.deepEqual(getWebGPUHeightMapSharingDiagnostics(fakeDevice), {
    allocations: 1,
    reuses: 1,
    releases: 2,
    destroys: 1,
});

console.log("webgpu height-map row packing and sharing checks passed");
