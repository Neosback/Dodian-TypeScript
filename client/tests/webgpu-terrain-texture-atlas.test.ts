import assert from "node:assert/strict";

import type {
    WebGPUBindGroupLayoutLike,
    WebGPUDeviceLike,
    WebGPUTextureLike,
} from "../render/backend/WebGPUPlatform";
import {
    computeWebGPUTextureAtlasLayout,
    WebGPUTerrainTextureResources,
} from "../render/webgpu/terrain/WebGPUTerrainTextureResources";

assert.deepEqual(computeWebGPUTextureAtlasLayout(1), {
    columns: 1,
    rows: 1,
    width: 128,
    height: 128,
});

const layout = computeWebGPUTextureAtlasLayout(1024);
assert.equal(layout.columns, 32);
assert.equal(layout.rows, 32);
assert.equal(layout.width, 4096);
assert.equal(layout.height, 4096);
assert.ok(layout.width <= 8192);
assert.ok(layout.height <= 8192);

const uneven = computeWebGPUTextureAtlasLayout(257);
assert.ok(uneven.columns * uneven.rows >= 257);
assert.equal(uneven.width % 128, 0);
assert.equal(uneven.height % 128, 0);

const writes: Array<{
    origin?: { x?: number; y?: number; z?: number };
    width: number;
    height: number;
}> = [];

function fakeTexture(): WebGPUTextureLike {
    return {
        createView() {
            return {};
        },
        destroy() {},
    };
}

const fakeDevice = {
    queue: {
        writeBuffer() {},
        writeTexture(destination: any, _data: any, _layout: any, size: any) {
            writes.push({
                origin: destination.origin,
                width: size.width,
                height: size.height,
            });
        },
        submit() {},
    },
    createTexture() {
        return fakeTexture();
    },
    createBindGroup() {
        return {};
    },
} as unknown as WebGPUDeviceLike;

const materialData = new Int8Array(65 * 6 * 4);
materialData[3] = 1;
const resources = new WebGPUTerrainTextureResources(
    fakeDevice,
    {} as WebGPUBindGroupLayoutLike,
    {
        layerCount: 65,
        idToLayer: new Map([[123, 64]]),
        frameCounts: new Map([[123, 1]]),
        materialData,
    },
);

assert.equal(writes.length, 2, "constructor uploads white atlas and material table");

const pixels = new Int32Array(128 * 128);
assert.equal(resources.uploadTexture(123, pixels), true);
assert.equal(writes.length, 3);
assert.deepEqual(writes[2], {
    origin: { x: 128, y: 896, z: 0 },
    width: 128,
    height: 128,
});
assert.equal(resources.isLoaded(123), true);

resources.dispose();

console.log("webgpu terrain texture-atlas checks passed");
