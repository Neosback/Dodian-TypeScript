import assert from "node:assert/strict";

import { createSceneFrameDescription } from "../render/frame/SceneFrameDescription";
import {
    WEBGPU_FACE_PRIORITY_DEPTH_SHADER,
} from "../render/webgpu/loc/WebGPUFacePriorityDepthCompute";
import {
    createWebGPUFacePriorityVisibilityState,
} from "../render/webgpu/loc/WebGPUFacePriorityPassActivation";
import {
    WEBGPU_FACE_PRIORITY_SORT_SHADER,
    createWebGPUFacePriorityAnalyticOrder,
    createWebGPUFacePriorityVisibilityAwareOrder,
} from "../render/webgpu/loc/WebGPUFacePrioritySortCompute";
import {
    createVisibilityFilteredFacePriorityOrder,
    isWebGPUFacePriorityFrontFacing,
} from "../render/webgpu/loc/WebGPUFacePriorityVisibility";
import type { WebGPUTerrainMapResources } from "../render/webgpu/terrain/WebGPUTerrainMapResources";

const identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

// `frontFace: "ccw"` is evaluated in framebuffer coordinates where Y points
// down, so the retained software-painter winding expression is positive for
// this NDC-clockwise triangle.
const frontA = [-1, -1, 0] as const;
const frontB = [0, 1, 0] as const;
const frontC = [1, -1, 0] as const;
assert.equal(
    isWebGPUFacePriorityFrontFacing(frontA, frontB, frontC, identity, identity),
    true,
);
assert.equal(
    isWebGPUFacePriorityFrontFacing(frontA, frontC, frontB, identity, identity),
    false,
    "reversing projected winding must reject the back face",
);

const translatedView = new Float32Array(identity);
translatedView[12] = 7;
translatedView[13] = -4;
translatedView[14] = 3;
assert.equal(
    isWebGPUFacePriorityFrontFacing(frontA, frontB, frontC, translatedView, identity),
    true,
    "view translation must not flip projected winding",
);

const behindProjection = new Float32Array(identity);
behindProjection[15] = -1;
assert.equal(
    isWebGPUFacePriorityFrontFacing(frontA, frontB, frontC, identity, behindProjection),
    false,
    "non-positive clip w must not participate in priority visibility",
);

const depths = [100, 0, 60, 10, 30, 25];
const priorities = [1, 2, 10, 0, 11, 5];
const visibility = [0, 1, 1, 1, 0, 1];
const visiblePainterOrder = createVisibilityFilteredFacePriorityOrder(
    depths,
    priorities,
    visibility,
);
const denseGpuOrder = createWebGPUFacePriorityVisibilityAwareOrder(
    depths,
    priorities,
    visibility,
);
assert.deepEqual(
    denseGpuOrder.slice(0, visiblePainterOrder.length),
    visiblePainterOrder,
    "visible GPU prefix must match the software painter with back faces removed before thresholds",
);
assert.deepEqual(
    denseGpuOrder.slice(visiblePainterOrder.length),
    [0, 4],
    "culled faces must occupy a deterministic source-stable tail",
);
assert.deepEqual(
    createWebGPUFacePriorityVisibilityAwareOrder(
        depths,
        priorities,
        new Array(depths.length).fill(1),
    ),
    createWebGPUFacePriorityAnalyticOrder(depths, priorities),
    "culling-disabled mode must retain the existing exact sort",
);
assert.throws(
    () => createWebGPUFacePriorityVisibilityAwareOrder([1], [0], []),
    /length mismatch/,
);

const frame = createSceneFrameDescription();
frame.cullBackFace = true;
frame.projectionMatrix.set(identity);
const map = {
    plan: {
        renderPosX: 42,
        renderPosY: -7,
    },
} as unknown as WebGPUTerrainMapResources;
const visibilityState = createWebGPUFacePriorityVisibilityState(frame, map);
assert.equal(visibilityState.projectionMatrix, frame.projectionMatrix);
assert.equal(visibilityState.mapX, 42);
assert.equal(visibilityState.mapY, -7);
assert.equal(visibilityState.cullBackFace, true);

assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /faceVisibility: array<u32>/);
assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /projectedFrontFacing/);
assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /uniforms\.cullBackFace == 0u/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /faceVisibility: array<u32>/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /workVisible/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /visibleCount \+ hiddenBefore/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /degenerateIndex/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /!workVisible\(workItem\)/);

console.log("webgpu face-priority visibility and culling parity fixtures passed");
