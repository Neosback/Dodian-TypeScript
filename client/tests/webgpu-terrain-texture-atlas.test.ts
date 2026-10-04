import assert from "node:assert/strict";

import { computeWebGPUTextureAtlasLayout } from "../render/webgpu/terrain/WebGPUTerrainTextureResources";

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

console.log("webgpu terrain texture-atlas layout checks passed");
