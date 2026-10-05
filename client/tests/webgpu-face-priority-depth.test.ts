import assert from "node:assert/strict";

import type {
    WebGPUBufferLike,
    WebGPUCommandEncoderLike,
    WebGPUDeviceLike,
} from "../render/backend/WebGPUPlatform";
import {
    WEBGPU_FACE_PRIORITY_DEPTH_SHADER,
    WebGPUFacePriorityDepthComputeResources,
    computeWebGPUFacePriorityDepth,
    createWebGPUFacePriorityDepthJobs,
    decodeWebGPUFacePriorityPackedPosition,
    transformWebGPUFacePriorityDepthZ,
    truncateWebGPUFacePriorityDepth,
} from "../render/webgpu/loc/WebGPUFacePriorityDepthCompute";
import type { WebGPUFacePriorityModelSpan } from "../render/webgpu/loc/WebGPUFacePrioritySortResources";

function packedVertex(x: number, y: number, z: number): number[] {
    const xPos = (x + 0x4000) & 0x7fff;
    const yPos = (-y + 0x4000) & 0x7fff;
    const zPos = (z + 0x4000) & 0x7fff;
    return [(xPos << 17) >>> 0, yPos >>> 0, (zPos << 17) >>> 0];
}

const packedWords = Uint32Array.from([
    ...packedVertex(12, 0, 30),
    ...packedVertex(30, 0, 60),
    ...packedVertex(48, 0, 90),
]);
const sourceIndices = new Uint32Array([0, 1, 2]);
const identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

assert.deepEqual(decodeWebGPUFacePriorityPackedPosition(packedWords, 1), [30, 0, 60]);
assert.equal(computeWebGPUFacePriorityDepth(packedWords, sourceIndices, 0, identity), 60);
assert.equal(truncateWebGPUFacePriorityDepth(-1, -1, 0), 0, "Java integer division truncates toward zero");

const zFromX = new Float32Array(identity);
zFromX[2] = 1;
zFromX[10] = 0;
assert.equal(computeWebGPUFacePriorityDepth(packedWords, sourceIndices, 0, zFromX), 30);

const translated = new Float32Array(zFromX);
translated[12] = 500;
translated[13] = -250;
translated[14] = 9000;
assert.equal(
    transformWebGPUFacePriorityDepthZ([48, 0, 90], translated),
    transformWebGPUFacePriorityDepthZ([48, 0, 90], zFromX),
    "translation must not affect model-local face ordering",
);

const modelSpans: WebGPUFacePriorityModelSpan[] = [
    { firstIndex: 0, indexCount: 6, firstFace: 0, faceCount: 2 },
    { firstIndex: 6, indexCount: 3, firstFace: 2, faceCount: 1 },
    { firstIndex: 9, indexCount: 6, firstFace: 3, faceCount: 2 },
];
const batch = createWebGPUFacePriorityDepthJobs(
    [
        {
            firstIndex: 0,
            indexCount: 6,
            instanceCount: 1,
            firstInstance: 7,
            facePrioritySpan: { firstSpan: 0, spanCount: 1, firstFace: 0, faceCount: 2 },
        },
        {
            firstIndex: 0,
            indexCount: 6,
            instanceCount: 1,
            firstInstance: 9,
            facePrioritySpan: { firstSpan: 0, spanCount: 1, firstFace: 0, faceCount: 2 },
        },
        {
            firstIndex: 9,
            indexCount: 6,
            instanceCount: 1,
            firstInstance: 11,
            facePrioritySpan: { firstSpan: 2, spanCount: 1, firstFace: 3, faceCount: 2 },
        },
        {
            firstIndex: 6,
            indexCount: 0,
            instanceCount: 0,
            firstInstance: 13,
            facePrioritySpan: { firstSpan: 0, spanCount: 0, firstFace: 2, faceCount: 0 },
        },
    ],
    modelSpans,
);
assert.deepEqual(Array.from(batch.workItems), [
    0, 7,
    1, 7,
    0, 9,
    1, 9,
    3, 11,
    4, 11,
]);
assert.deepEqual(batch.modelJobs, [
    { firstWorkItem: 0, workItemCount: 2, sourceFirstFace: 0, sourceFaceCount: 2, firstInstance: 7 },
    { firstWorkItem: 2, workItemCount: 2, sourceFirstFace: 0, sourceFaceCount: 2, firstInstance: 9 },
    { firstWorkItem: 4, workItemCount: 2, sourceFirstFace: 3, sourceFaceCount: 2, firstInstance: 11 },
]);
assert.throws(
    () =>
        createWebGPUFacePriorityDepthJobs(
            [{
                firstIndex: 0,
                indexCount: 6,
                instanceCount: 2,
                firstInstance: 0,
                facePrioritySpan: { firstSpan: 0, spanCount: 1, firstFace: 0, faceCount: 2 },
            }],
            modelSpans,
        ),
    /one placed-model instance per draw/,
);
assert.throws(
    () =>
        createWebGPUFacePriorityDepthJobs(
            [{ firstIndex: 0, indexCount: 6, instanceCount: 1, firstInstance: 0 }],
            modelSpans,
        ),
    /missing its resolved model span/,
);

assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /packedVertexWords: array<u32>/);
assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /workItems: array<vec2<u32>>/);
assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /contourGround == 1u/);
assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /getLocHeightInterp/);
assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /vec4<f32>\(position, 0\.0\)/);
assert.match(WEBGPU_FACE_PRIORITY_DEPTH_SHADER, /faceDepths\[id\.x\] = trunc/);

const createdBuffers: Array<Record<string, unknown>> = [];
const writes: Array<{ label: string; bytes: Uint8Array }> = [];
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
            writes.push({ label: labelled.label, bytes: new Uint8Array(view) });
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

const vertexBytes = new Uint8Array(packedWords.byteLength);
new Uint32Array(vertexBytes.buffer).set(packedWords);
const resources = new WebGPUFacePriorityDepthComputeResources(
    device,
    "fixture",
    vertexBytes,
    70,
    { label: "indices" } as WebGPUBufferLike,
    {},
    { label: "model-info" } as WebGPUBufferLike,
);
assert.equal(shaderSource, WEBGPU_FACE_PRIORITY_DEPTH_SHADER);
assert.equal(resources.prepare(batch, identity, 8), 6);

const jobWrite = writes.find((write) => write.label === "fixture-face-priority-depth-jobs");
assert.ok(jobWrite);
assert.deepEqual(
    Array.from(new Uint32Array(jobWrite!.bytes.buffer, jobWrite!.bytes.byteOffset, jobWrite!.bytes.byteLength / 4)),
    Array.from(batch.workItems),
);
const uniformWrite = writes.find((write) => write.label === "fixture-face-priority-depth-uniforms");
assert.ok(uniformWrite);
const uniformWords = new Uint32Array(
    uniformWrite!.bytes.buffer,
    uniformWrite!.bytes.byteOffset,
    uniformWrite!.bytes.byteLength / 4,
);
assert.equal(uniformWords[16], 6);
assert.equal(new Int32Array(uniformWords.buffer, uniformWords.byteOffset, uniformWords.length)[17], 8);

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

const largeWorkItems = new Uint32Array(72 * 2);
assert.throws(
    () => resources.prepare({ workItems: largeWorkItems, modelJobs: [] }, identity, 8),
    /capacity is 70/,
);

resources.dispose();
assert.equal(destroyed.length, 4);
assert.ok(createdBuffers.some((descriptor) => descriptor.label === "fixture-face-priority-depths"));

console.log("webgpu face-priority depth math, job expansion, and compute plumbing checks passed");
