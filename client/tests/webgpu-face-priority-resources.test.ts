import assert from "node:assert/strict";

import {
    WEBGPU_BUFFER_USAGE,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
} from "../render/backend/WebGPUPlatform";
import {
    WebGPUFacePrioritySortResources,
    createWebGPUFacePriorityModelSpans,
    createWebGPUFacePriorityWords,
    resolveWebGPUFacePriorityDrawSpanRange,
} from "../render/webgpu/loc/WebGPUFacePrioritySortResources";

const priorities = new Uint8Array([11, 3, 0]);
const modelSpanWords = new Uint32Array([
    0, 6,
    6, 3,
]);

assert.deepEqual(Array.from(createWebGPUFacePriorityWords(priorities)), [11, 3, 0]);
assert.throws(
    () => createWebGPUFacePriorityWords(new Int8Array([0, 12])),
    /invalid render priority/,
);

const spans = createWebGPUFacePriorityModelSpans(9, priorities, modelSpanWords);
assert.deepEqual(spans, [
    { firstIndex: 0, indexCount: 6, firstFace: 0, faceCount: 2 },
    { firstIndex: 6, indexCount: 3, firstFace: 2, faceCount: 1 },
]);

assert.deepEqual(resolveWebGPUFacePriorityDrawSpanRange({ firstIndex: 0, indexCount: 9 }, spans), {
    firstSpan: 0,
    spanCount: 2,
    firstFace: 0,
    faceCount: 3,
});
assert.deepEqual(resolveWebGPUFacePriorityDrawSpanRange({ firstIndex: 6, indexCount: 3 }, spans), {
    firstSpan: 1,
    spanCount: 1,
    firstFace: 2,
    faceCount: 1,
});
assert.deepEqual(resolveWebGPUFacePriorityDrawSpanRange({ firstIndex: 6, indexCount: 0 }, spans), {
    firstSpan: 0,
    spanCount: 0,
    firstFace: 2,
    faceCount: 0,
});
assert.throws(
    () => resolveWebGPUFacePriorityDrawSpanRange({ firstIndex: 3, indexCount: 3 }, spans),
    /starts inside or outside a model span/,
);
assert.throws(
    () => resolveWebGPUFacePriorityDrawSpanRange({ firstIndex: 0, indexCount: 3 }, spans),
    /ends inside model span/,
);
assert.throws(
    () => resolveWebGPUFacePriorityDrawSpanRange({ firstIndex: 1, indexCount: 3 }, spans),
    /triangle-aligned/,
);

const createdBuffers: Array<Record<string, unknown>> = [];
const writes: Array<{ label: string; values: number[] }> = [];
const destroyed: string[] = [];
const device = {
    queue: {
        writeBuffer(buffer: WebGPUBufferLike, _offset: number, data: ArrayBuffer | ArrayBufferView) {
            const labelled = buffer as WebGPUBufferLike & { label: string };
            const view = data as ArrayBufferView;
            let values: number[];
            if (view instanceof Uint32Array) {
                values = Array.from(view);
            } else {
                values = Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
            }
            writes.push({ label: labelled.label, values });
        },
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
} as unknown as WebGPUDeviceLike;

const sourceIndices = new Int32Array([10, 11, 12, 20, 21, 22, 30, 31, 32]);
const resources = new WebGPUFacePrioritySortResources(
    device,
    "fixture",
    sourceIndices,
    priorities,
    modelSpanWords,
);

assert.deepEqual(Array.from(resources.sourceIndices), Array.from(sourceIndices, (value) => value >>> 0));
assert.deepEqual(resources.resolveDraw({ firstIndex: 0, indexCount: 9 }), {
    firstSpan: 0,
    spanCount: 2,
    firstFace: 0,
    faceCount: 3,
});

const usages = new Map(
    createdBuffers.map((descriptor) => [String(descriptor.label), Number(descriptor.usage)]),
);
assert.ok((usages.get("fixture-face-priorities")! & WEBGPU_BUFFER_USAGE.STORAGE) !== 0);
assert.ok((usages.get("fixture-face-priority-model-spans")! & WEBGPU_BUFFER_USAGE.STORAGE) !== 0);
assert.ok((usages.get("fixture-face-priority-source-indices")! & WEBGPU_BUFFER_USAGE.STORAGE) !== 0);
assert.ok((usages.get("fixture-face-priority-sorted-indices")! & WEBGPU_BUFFER_USAGE.STORAGE) !== 0);
assert.ok((usages.get("fixture-face-priority-sorted-indices")! & WEBGPU_BUFFER_USAGE.INDEX) !== 0);

assert.deepEqual(
    writes.find((write) => write.label === "fixture-face-priority-sorted-indices")?.values,
    Array.from(sourceIndices),
    "sorted target must start as the exact plain index stream",
);
assert.deepEqual(
    writes.find((write) => write.label === "fixture-face-priorities")?.values,
    [11, 3, 0],
);

resources.dispose();
assert.equal(destroyed.length, 4);
assert.equal(resources.modelSpans.length, 0);

console.log("webgpu face-priority resource and span-resolution checks passed");
