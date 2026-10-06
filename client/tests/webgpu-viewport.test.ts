import assert from "node:assert/strict";

import { clampWebGPUViewport } from "../render/webgpu/WebGPUViewport";

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

console.log("webgpu viewport clipping checks passed");
