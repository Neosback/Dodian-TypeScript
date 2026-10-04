import assert from "node:assert/strict";

import {
    createSceneFrameDescription,
    updateSceneFrameDescription,
} from "../render/frame/SceneFrameDescription";

const frame = createSceneFrameDescription();
const viewProjection = new Float32Array(16).fill(1);
const view = new Float32Array(16).fill(2);
const projection = new Float32Array(16).fill(3);

updateSceneFrameDescription(frame, {
    frameNumber: 12,
    clientCycle: 34,
    clientTickPhase: 0.5,
    timeSeconds: 6.25,
    deltaTimeMs: 16.67,
    canvasWidth: 1920,
    canvasHeight: 1080,
    sceneWidth: 1280,
    sceneHeight: 720,
    sceneViewport: { x: 10, y: 20, width: 1000, height: 600 },
    sceneFramebufferViewport: { x: 5, y: 10, width: 500, height: 300 },
    viewProjectionMatrix: viewProjection,
    viewMatrix: view,
    projectionMatrix: projection,
    skyColor: new Float32Array([0.1, 0.2, 0.3, 1]),
    sceneHslOverride: new Float32Array([-1, -1, -1, 0]),
    cameraX: 3200,
    cameraZ: 3201,
    playerX: 3210,
    playerZ: 3211,
    renderDistance: 48,
    fogEnd: 48,
    fogDepth: 36,
    brightness: 0.8,
    colorBanding: 255,
    newTextureAnimation: 1,
    maxLevel: 3,
    roofPlaneLimit: 2,
    cullBackFace: true,
    scenePreview: false,
});

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
