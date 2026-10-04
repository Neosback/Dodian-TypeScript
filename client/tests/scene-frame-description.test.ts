import assert from "node:assert/strict";

import {
    createSceneFrameDescription,
    updateSceneFrameCamera,
    updateSceneFrameSettings,
    updateSceneFrameTiming,
    updateSceneFrameViewport,
} from "../render/frame/SceneFrameDescription";

const frame = createSceneFrameDescription();
const viewProjection = new Float32Array(16).fill(1);
const view = new Float32Array(16).fill(2);
const projection = new Float32Array(16).fill(3);

updateSceneFrameTiming(frame, 12, 34, 0.5, 6.25, 16.67);
updateSceneFrameViewport(
    frame,
    1920,
    1080,
    1280,
    720,
    { x: 10, y: 20, width: 1000, height: 600 },
    { x: 5, y: 10, width: 500, height: 300 },
);
updateSceneFrameCamera(frame, viewProjection, view, projection, 3200, 3201, 3210, 3211);
updateSceneFrameSettings(
    frame,
    new Float32Array([0.1, 0.2, 0.3, 1]),
    new Float32Array([-1, -1, -1, 0]),
    48,
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

assert.equal(frame.frameNumber, 12);
assert.equal(frame.clientCycle, 34);
assert.equal(frame.sceneViewport.width, 1000);
assert.equal(frame.sceneFramebufferViewport.height, 300);
assert.deepEqual(Array.from(frame.viewProjectionMatrix), Array(16).fill(1));
assert.deepEqual(Array.from(frame.viewMatrix), Array(16).fill(2));
assert.deepEqual(Array.from(frame.projectionMatrix), Array(16).fill(3));
assert.deepEqual(Array.from(frame.cameraPosition), [3200, 3201]);
assert.deepEqual(Array.from(frame.playerPosition), [3210, 3211]);
assert.equal(frame.fogEnd, 48);
assert.equal(frame.fogDepth, 36);
assert.equal(frame.roofPlaneLimit, 2);
assert.equal(frame.newTextureAnimation, 1);

viewProjection.fill(9);
assert.equal(frame.viewProjectionMatrix[0], 1, "frame owns its matrix copy");

console.log("scene frame description checks passed");
