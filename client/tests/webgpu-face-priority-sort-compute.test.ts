import assert from "node:assert/strict";

import type {
    WebGPUBufferLike,
    WebGPUCommandEncoderLike,
    WebGPUDeviceLike,
} from "../render/backend/WebGPUPlatform";
import { createFacePriorityDrawOrder } from "../render/priority/FacePrioritySort";
import type { WebGPUFacePriorityDepthJobBatch } from "../render/webgpu/loc/WebGPUFacePriorityDepthCompute";
import {
    WEBGPU_FACE_PRIORITY_SORT_SHADER,
    WebGPUFacePrioritySortComputeResources,
    createWebGPUFacePriorityAnalyticOrder,
    createWebGPUFacePrioritySortMetadata,
    createWebGPUFacePrioritySortedDrawRanges,
    encodeWebGPUFacePriorityDepthAndSort,
} from "../render/webgpu/loc/WebGPUFacePrioritySortCompute";
import type { WebGPUFacePriorityModelSpan } from "../render/webgpu/loc/WebGPUFacePrioritySortResources";

function assertMatchesOracle(depths: number[], priorities: number[]): void {
    assert.deepEqual(
        createWebGPUFacePriorityAnalyticOrder(depths, priorities),
        createFacePriorityDrawOrder(depths, priorities),
    );
}

// Ordinary bucket ordering and all three special-stream threshold stages.
assertMatchesOracle(
    [40, 60, 30, 50, 20, 40, 70, 45, 35, 25, 10, 15, 5],
    [1, 2, 3, 4, 6, 8, 10, 10, 10, 10, 0, 5, 9],
);

// Strict threshold equality must not flush the special face early.
assertMatchesOracle([50, 50, 50, 1], [1, 2, 10, 0]);

// Priority 11 cannot jump ahead of a still-pending priority-10 face even when
// the p11 face is much deeper.
assertMatchesOracle(
    [10, 100, 20, 20, 20, 20, 20, 20, 1],
    [10, 11, 1, 2, 3, 4, 6, 8, 0],
);

// Equal-depth stability, negative depths, and uniform model-wide priorities.
assertMatchesOracle([9, 9, 9, -2, -2], [3, 3, 3, 3, 3]);
assertMatchesOracle([-7, -1, -7, 4], [11, 10, 0, 8]);

// Deterministic stress comparison against the independent CPU oracle.
let seed = 0x13579bdf;
const nextRandom = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
};
for (let fixture = 0; fixture < 128; fixture++) {
    const faceCount = 1 + (nextRandom() % 48);
    const depths = new Array<number>(faceCount);
    const priorities = new Array<number>(faceCount);
    for (let face = 0; face < faceCount; face++) {
        depths[face] = (nextRandom() % 257) - 128;
        priorities[face] = nextRandom() % 12;
    }
    assertMatchesOracle(depths, priorities);
}

assert.throws(
    () => createWebGPUFacePriorityAnalyticOrder([1], [12]),
    /invalid render priority/,
);
assert.throws(
    () => createWebGPUFacePriorityAnalyticOrder([1, 2], [0]),
    /length mismatch/,
);

const batch: WebGPUFacePriorityDepthJobBatch = {
    workItems: new Uint32Array([
        0, 7,
        1, 7,
        0, 9,
        1, 9,
        3, 11,
        4, 11,
    ]),
    modelJobs: [
        {
            firstWorkItem: 0,
            workItemCount: 2,
            sourceFirstFace: 0,
            sourceFaceCount: 2,
            firstInstance: 7,
        },
        {
            firstWorkItem: 2,
            workItemCount: 2,
            sourceFirstFace: 0,
            sourceFaceCount: 2,
            firstInstance: 9,
        },
        {
            firstWorkItem: 4,
            workItemCount: 2,
            sourceFirstFace: 3,
            sourceFaceCount: 2,
            firstInstance: 11,
        },
    ],
};

const metadata = createWebGPUFacePrioritySortMetadata(batch);
assert.deepEqual(Array.from(metadata.workItems), [
    0, 0,
    0, 1,
    1, 0,
    1, 1,
    2, 0,
    2, 1,
]);
assert.deepEqual(Array.from(metadata.modelJobs), [0, 2, 2, 2, 4, 2]);

assert.throws(
    () =>
        createWebGPUFacePrioritySortMetadata({
            workItems: new Uint32Array([0, 0, 1, 0]),
            modelJobs: [
                {
                    firstWorkItem: 1,
                    workItemCount: 1,
                    sourceFirstFace: 0,
                    sourceFaceCount: 1,
                    firstInstance: 0,
                },
            ],
        }),
    /starts at 1, expected 0/,
);

const modelSpans: WebGPUFacePriorityModelSpan[] = [
    { firstIndex: 0, indexCount: 6, firstFace: 0, faceCount: 2 },
    { firstIndex: 6, indexCount: 3, firstFace: 2, faceCount: 1 },
    { firstIndex: 9, indexCount: 6, firstFace: 3, faceCount: 2 },
];
const drawRanges = createWebGPUFacePrioritySortedDrawRanges(
    [
        {
            firstIndex: 0,
            indexCount: 6,
            instanceCount: 1,
            firstInstance: 7,
            facePrioritySpan: {
                firstSpan: 0,
                spanCount: 1,
                firstFace: 0,
                faceCount: 2,
            },
        },
        {
            firstIndex: 0,
            indexCount: 6,
            instanceCount: 1,
            firstInstance: 9,
            facePrioritySpan: {
                firstSpan: 0,
                spanCount: 1,
                firstFace: 0,
                faceCount: 2,
            },
        },
        {
            firstIndex: 9,
            indexCount: 6,
            instanceCount: 1,
            firstInstance: 11,
            facePrioritySpan: {
                firstSpan: 2,
                spanCount: 1,
                firstFace: 3,
                faceCount: 2,
            },
        },
    ],
    modelSpans,
    batch,
);
assert.deepEqual(drawRanges, [
    {
        sourceDrawIndex: 0,
        firstIndex: 0,
        indexCount: 6,
        instanceCount: 1,
        firstInstance: 7,
        firstModelJob: 0,
        modelJobCount: 1,
    },
    {
        sourceDrawIndex: 1,
        firstIndex: 6,
        indexCount: 6,
        instanceCount: 1,
        firstInstance: 9,
        firstModelJob: 1,
        modelJobCount: 1,
    },
    {
        sourceDrawIndex: 2,
        firstIndex: 12,
        indexCount: 6,
        instanceCount: 1,
        firstInstance: 11,
        firstModelJob: 2,
        modelJobCount: 1,
    },
]);
assert.notEqual(
    drawRanges[0].firstIndex,
    drawRanges[1].firstIndex,
    "duplicate source spans must receive independent exact-sort output ranges",
);

// Shader contract: exact priorities, strict thresholds, 10-before-11 stream,
// stable equal-depth tie breaking, and dense output based on firstWorkItem.
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /facePriorities: array<u32>/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /otherDepth > depth/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /otherDepth == depth && otherLocal < localFace/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /workDepth\(workItem\) <= threshold/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /above10 < count10/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /priority == 11u/);
assert.match(WEBGPU_FACE_PRIORITY_SORT_SHADER, /firstWorkItem \+ finalRank/);

const createdBuffers: Array<Record<string, unknown>> = [];
const writes: Array<{ label: string; values: number[] }> = [];
const destroyed: string[] = [];
let shaderSource = "";
let dispatchCount = 0;
let dispatchX = 0;

const device = {
    lost: Promise.resolve({}),
    queue: {
        writeBuffer(buffer: WebGPUBufferLike, _offset: number, data: ArrayBuffer | ArrayBufferView) {
            const labelled = buffer as WebGPUBufferLike & { label: string };
            const view = data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            const words = new Uint32Array(view.byteLength >>> 2);
            for (let i = 0; i < words.length; i++) {
                words[i] =
                    view[i * 4] |
                    (view[i * 4 + 1] << 8) |
                    (view[i * 4 + 2] << 16) |
                    (view[i * 4 + 3] << 24);
            }
            writes.push({ label: labelled.label, values: Array.from(words) });
        },
        writeTexture() {},
        submit() {},
    },
    createBuffer(descriptor: Record<string, unknown>) {
        createdBuffers.push(descriptor);
        const label = String(descriptor.label ?? "");
        return {
            label,
            destroy() {
                destroyed.push(label);
            },
        } as WebGPUBufferLike;
    },
    createBindGroupLayout() { return {}; },
    createPipelineLayout() { return {}; },
    createShaderModule(descriptor: { code: string }) {
        shaderSource = descriptor.code;
        return {};
    },
    createComputePipeline() { return {}; },
    createBindGroup() { return {}; },
} as unknown as WebGPUDeviceLike;

const resources = new WebGPUFacePrioritySortComputeResources(
    device,
    "fixture",
    70,
    12,
    { label: "depth-jobs" } as WebGPUBufferLike,
    { label: "depths" } as WebGPUBufferLike,
    { label: "priorities" } as WebGPUBufferLike,
    { label: "source-indices" } as WebGPUBufferLike,
);
assert.equal(shaderSource, WEBGPU_FACE_PRIORITY_SORT_SHADER);
assert.equal(resources.prepare(batch), 6);
assert.deepEqual(
    writes.find((write) => write.label === "fixture-face-priority-sort-work-items")?.values,
    Array.from(metadata.workItems),
);
assert.deepEqual(
    writes.find((write) => write.label === "fixture-face-priority-sort-model-jobs")?.values,
    Array.from(metadata.modelJobs),
);
assert.deepEqual(
    writes.find((write) => write.label === "fixture-face-priority-sort-uniforms")?.values,
    [6, 0, 0, 0],
);
assert.ok(
    createdBuffers.some(
        (descriptor) => descriptor.label === "fixture-face-priority-exact-sorted-indices",
    ),
);

const commandEncoder = {
    beginComputePass() {
        return {
            setPipeline() {},
            setBindGroup() {},
            dispatchWorkgroups(x: number) {
                dispatchCount++;
                dispatchX = x;
            },
            end() {},
        };
    },
    finish() { return {}; },
} as unknown as WebGPUCommandEncoderLike;
assert.equal(resources.encode(commandEncoder), 6);
assert.equal(dispatchCount, 1);
assert.equal(dispatchX, 1);

assert.throws(
    () =>
        resources.prepare({
            workItems: new Uint32Array(72 * 2),
            modelJobs: [],
        }),
    /capacity is 70/,
);

const stageOrder: string[] = [];
assert.equal(
    encodeWebGPUFacePriorityDepthAndSort(
        commandEncoder,
        {
            encode() {
                stageOrder.push("depth");
                return 6;
            },
        },
        {
            encode() {
                stageOrder.push("sort");
                return 6;
            },
        },
    ),
    6,
);
assert.deepEqual(stageOrder, ["depth", "sort"]);
assert.throws(
    () =>
        encodeWebGPUFacePriorityDepthAndSort(
            commandEncoder,
            { encode: () => 5 },
            { encode: () => 6 },
        ),
    /dispatch mismatch/,
);

resources.dispose();
assert.equal(destroyed.length, 4);

console.log("webgpu exact face-priority sort rank, output-range, and compute checks passed");
