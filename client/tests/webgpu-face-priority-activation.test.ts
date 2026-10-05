import assert from "node:assert/strict";

import { createSceneFrameDescription } from "../render/frame/SceneFrameDescription";
import { createWebGPUFacePriorityDepthJobs } from "../render/webgpu/loc/WebGPUFacePriorityDepthCompute";
import {
    createWebGPUFacePriorityDepthTransform,
    expandWebGPUFacePriorityDrawInstances,
} from "../render/webgpu/loc/WebGPUFacePriorityPassActivation";
import { createWebGPUFacePrioritySortedDrawRanges } from "../render/webgpu/loc/WebGPUFacePrioritySortCompute";
import type { WebGPUFacePriorityModelSpan } from "../render/webgpu/loc/WebGPUFacePrioritySortResources";
import type { WebGPUStaticLocDrawPlanEntry } from "../render/webgpu/loc/WebGPUStaticLocResources";
import type { WebGPUTerrainMapResources } from "../render/webgpu/terrain/WebGPUTerrainMapResources";

const sharedSpan = {
    firstSpan: 0,
    spanCount: 1,
    firstFace: 0,
    faceCount: 2,
};
const draws: WebGPUStaticLocDrawPlanEntry[] = [
    {
        firstIndex: 0,
        indexCount: 6,
        instanceCount: 3,
        firstInstance: 4,
        plane: 1,
        facePrioritySpan: sharedSpan,
    },
    {
        firstIndex: 6,
        indexCount: 3,
        instanceCount: 1,
        firstInstance: 9,
        plane: 3,
        facePrioritySpan: {
            firstSpan: 1,
            spanCount: 1,
            firstFace: 2,
            faceCount: 1,
        },
    },
    {
        firstIndex: 9,
        indexCount: 0,
        instanceCount: 0,
        firstInstance: 12,
        plane: 0,
        facePrioritySpan: {
            firstSpan: 0,
            spanCount: 0,
            firstFace: 3,
            faceCount: 0,
        },
    },
];

const expanded = expandWebGPUFacePriorityDrawInstances(draws, 2);
assert.deepEqual(expanded.sourceDrawIndices, [0, 0, 0]);
assert.deepEqual(
    expanded.draws.map((draw) => ({
        firstIndex: draw.firstIndex,
        indexCount: draw.indexCount,
        instanceCount: draw.instanceCount,
        firstInstance: draw.firstInstance,
        plane: draw.plane,
    })),
    [
        { firstIndex: 0, indexCount: 6, instanceCount: 1, firstInstance: 4, plane: 1 },
        { firstIndex: 0, indexCount: 6, instanceCount: 1, firstInstance: 5, plane: 1 },
        { firstIndex: 0, indexCount: 6, instanceCount: 1, firstInstance: 6, plane: 1 },
    ],
);
assert.notEqual(expanded.draws[0], draws[0], "activation must not mutate authoritative draw metadata");
assert.deepEqual(expanded.draws[0].facePrioritySpan, sharedSpan);

const modelSpans: WebGPUFacePriorityModelSpan[] = [
    { firstIndex: 0, indexCount: 6, firstFace: 0, faceCount: 2 },
    { firstIndex: 6, indexCount: 3, firstFace: 2, faceCount: 1 },
];
const batch = createWebGPUFacePriorityDepthJobs(expanded.draws, modelSpans);
assert.deepEqual(Array.from(batch.workItems), [
    0, 4,
    1, 4,
    0, 5,
    1, 5,
    0, 6,
    1, 6,
]);
assert.deepEqual(
    batch.modelJobs.map((job) => ({
        firstWorkItem: job.firstWorkItem,
        workItemCount: job.workItemCount,
        firstInstance: job.firstInstance,
    })),
    [
        { firstWorkItem: 0, workItemCount: 2, firstInstance: 4 },
        { firstWorkItem: 2, workItemCount: 2, firstInstance: 5 },
        { firstWorkItem: 4, workItemCount: 2, firstInstance: 6 },
    ],
);

const sortedRanges = createWebGPUFacePrioritySortedDrawRanges(
    expanded.draws,
    modelSpans,
    batch,
);
assert.deepEqual(
    sortedRanges.map((range) => ({
        sourceDrawIndex: range.sourceDrawIndex,
        firstIndex: range.firstIndex,
        indexCount: range.indexCount,
        firstInstance: range.firstInstance,
    })),
    [
        { sourceDrawIndex: 0, firstIndex: 0, indexCount: 6, firstInstance: 4 },
        { sourceDrawIndex: 1, firstIndex: 6, indexCount: 6, firstInstance: 5 },
        { sourceDrawIndex: 2, firstIndex: 12, indexCount: 6, firstInstance: 6 },
    ],
    "each placed instance must receive an independent dense sorted-index region",
);

const frame = createSceneFrameDescription();
frame.viewMatrix.set([
    2, 0, 0, 0,
    0, 3, 0, 0,
    0, 0, 4, 0,
    5, 6, 7, 1,
]);
const worldEntityTransform = new Float32Array([
    10, 0, 0, 0,
    0, 20, 0, 0,
    0, 0, 30, 0,
    1, 2, 3, 1,
]);
const map = {
    worldEntityTransform,
} as unknown as WebGPUTerrainMapResources;
const transform = createWebGPUFacePriorityDepthTransform(frame, map);
assert.deepEqual(Array.from(transform), [
    20, 0, 0, 0,
    0, 60, 0, 0,
    0, 0, 120, 0,
    51, 122, 213, 1,
]);

const ordinaryMap = {} as WebGPUTerrainMapResources;
assert.deepEqual(
    Array.from(createWebGPUFacePriorityDepthTransform(frame, ordinaryMap)),
    Array.from(frame.viewMatrix),
    "ordinary maps must use the view matrix unchanged",
);

console.log("webgpu exact face-priority activation mapping checks passed");
