import assert from "node:assert/strict";

import {
    clampWebGPUViewport,
    getWebGPUScissorRect,
} from "../render/webgpu/WebGPUViewport";

assert.deepEqual(
    clampWebGPUViewport({ x: 10, y: 20, width: 300, height: 200 }, 800, 600),
    { x: 10, y: 20, width: 300, height: 200 },
    "in-bounds viewport is preserved",
);

assert.deepEqual(
    clampWebGPUViewport({ x: -20, y: -10, width: 300, height: 200 }, 800, 600),
    { x: 0, y: 0, width: 280, height: 190 },
    "negative origin is clipped to the render target",
);

assert.deepEqual(
    clampWebGPUViewport({ x: 700, y: 500, width: 300, height: 200 }, 800, 600),
    { x: 700, y: 500, width: 100, height: 100 },
    "right and bottom edges are clipped to the render target",
);

assert.equal(
    clampWebGPUViewport({ x: 900, y: 10, width: 100, height: 100 }, 800, 600),
    undefined,
    "fully offscreen viewport is rejected",
);

assert.equal(
    clampWebGPUViewport({ x: 0, y: 0, width: 0, height: 100 }, 800, 600),
    undefined,
    "empty viewport is rejected",
);

assert.equal(
    clampWebGPUViewport({ x: 0, y: 0, width: 100, height: 100 }, 0, 600),
    undefined,
    "empty render target is rejected",
);

assert.deepEqual(
    getWebGPUScissorRect({ x: 10.25, y: 20.75, width: 100.5, height: 50.5 }, 800, 600),
    { x: 10, y: 20, width: 101, height: 52 },
    "fractional viewport bounds are rounded outward for integer scissor coordinates",
);

assert.deepEqual(
    getWebGPUScissorRect({ x: -0.5, y: 599.25, width: 2, height: 4 }, 800, 600),
    { x: 0, y: 599, width: 2, height: 1 },
    "rounded scissor bounds remain clipped to the render target",
);

assert.equal(
    getWebGPUScissorRect({ x: 900, y: 10, width: 100, height: 100 }, 800, 600),
    undefined,
    "fully offscreen viewport does not produce a scissor rectangle",
);

console.log("webgpu viewport and scissor clipping checks passed");
