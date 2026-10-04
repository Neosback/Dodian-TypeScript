import assert from "node:assert/strict";

import {
    createSceneFrameDescription,
    updateSceneFrameCamera,
    updateSceneFrameSettings,
    updateSceneFrameTiming,
    updateSceneFrameViewport,
} from "../render/frame/SceneFrameDescription";
import {
    packWebGPUSceneUniforms,
    WEBGPU_SCENE_UNIFORM_BYTES,
    WEBGPU_SCENE_UNIFORM_FLOATS,
    WEBGPU_SCENE_UNIFORM_OFFSETS,
} from "../render/webgpu/WebGPUSceneUniforms";

const frame = createSceneFrameDescription();
const viewProjection = new Float32Array(16);
const view = new Float32Array(16);
const projection = new Float32Array(16);
for (let i = 0; i < 16; i++) {
    viewProjection[i] = i + 1;
    view[i] = i + 21;
    projection[i] = i + 41;
}

updateSceneFrameTiming(frame, 10, 20, 0.25, 12.5, 16.67);
updateSceneFrameViewport(
    frame,
    1280,
    720,
    1024,
    576,
    { x: 20, y: 30, width: 900, height: 500 },
    { x: 10, y: 15, width: 450, height: 250 },
);
updateSceneFrameCamera(frame, viewProjection, view, projection, 3200, 3201, 3210, 3211);
updateSceneFrameSettings(
    frame,
    new Float32Array([0.1, 0.2, 0.3, 1]),
    new Float32Array([-1, -1, -1, 0]),
    50,
    48,
    36,
    0.8,
    255,
    1,
    3,
    2,
    true,
    false,
);

const packed = new Float32Array(WEBGPU_SCENE_UNIFORM_FLOATS);
packWebGPUSceneUniforms(packed, frame);

assert.equal(WEBGPU_SCENE_UNIFORM_BYTES, 288);
assert.deepEqual(Array.from(packed.slice(0, 16)), Array.from(viewProjection));
assert.deepEqual(Array.from(packed.slice(16, 32)), Array.from(view));
assert.deepEqual(Array.from(packed.slice(32, 48)), Array.from(projection));
assert.equal(packed[WEBGPU_SCENE_UNIFORM_OFFSETS.renderDistance], 48);
assert.equal(packed[WEBGPU_SCENE_UNIFORM_OFFSETS.fogDepth], 36);
assert.equal(packed[WEBGPU_SCENE_UNIFORM_OFFSETS.currentTime], 12.5);
assert.equal(packed[WEBGPU_SCENE_UNIFORM_OFFSETS.roofPlaneLimit], 2);
assert.equal(packed[WEBGPU_SCENE_UNIFORM_OFFSETS.maxLevel], 3);
assert.equal(packed[WEBGPU_SCENE_UNIFORM_OFFSETS.cullBackFace], 1);
assert.equal(packed[WEBGPU_SCENE_UNIFORM_OFFSETS.scenePreview], 0);

console.log("webgpu scene uniform packing checks passed");
