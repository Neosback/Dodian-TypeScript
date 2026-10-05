import { validateExactFacePriorityAlignment } from "../../priority/ExactFacePrioritySceneBuffer";
import {
    WEBGPU_BUFFER_USAGE,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
} from "../../backend/WebGPUPlatform";

export interface WebGPUFacePriorityModelSpan {
    firstIndex: number;
    indexCount: number;
    firstFace: number;
    faceCount: number;
}

export interface WebGPUFacePriorityDrawSpanRange {
    firstSpan: number;
    spanCount: number;
    firstFace: number;
    faceCount: number;
}

export interface FacePriorityDrawRangeLike {
    firstIndex: number;
    indexCount: number;
}

function alignedBufferSize(byteLength: number): number {
    return Math.max(4, (byteLength + 3) & ~3);
}

function createUploadedBuffer(
    device: WebGPUDeviceLike,
    label: string,
    usage: number,
    data: ArrayBufferView,
): WebGPUBufferLike {
    const buffer = device.createBuffer({
        label,
        size: alignedBufferSize(data.byteLength),
        usage: usage | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    if (data.byteLength > 0) {
        device.queue.writeBuffer(buffer, 0, data);
    }
    return buffer;
}

export function createWebGPUFacePriorityWords(priorities: ArrayLike<number>): Uint32Array {
    const words = new Uint32Array(priorities.length);
    for (let i = 0; i < priorities.length; i++) {
        const priority = priorities[i] | 0;
        if (priority < 0 || priority > 11) {
            throw new RangeError(`Face ${i} has invalid render priority ${priorities[i]}`);
        }
        words[i] = priority;
    }
    return words;
}

export function createWebGPUFacePriorityModelSpans(
    indexCount: number,
    priorities: ArrayLike<number>,
    modelSpans: ArrayLike<number>,
): WebGPUFacePriorityModelSpan[] {
    validateExactFacePriorityAlignment(indexCount, priorities, modelSpans);

    const spans: WebGPUFacePriorityModelSpan[] = new Array(modelSpans.length >>> 1);
    for (let i = 0, spanIndex = 0; i < modelSpans.length; i += 2, spanIndex++) {
        const firstIndex = modelSpans[i] | 0;
        const spanIndexCount = modelSpans[i + 1] | 0;
        spans[spanIndex] = {
            firstIndex,
            indexCount: spanIndexCount,
            firstFace: firstIndex / 3,
            faceCount: spanIndexCount / 3,
        };
    }
    return spans;
}

export function resolveWebGPUFacePriorityDrawSpanRange(
    draw: FacePriorityDrawRangeLike,
    modelSpans: readonly WebGPUFacePriorityModelSpan[],
): WebGPUFacePriorityDrawSpanRange {
    const firstIndex = draw.firstIndex | 0;
    const indexCount = draw.indexCount | 0;
    if (firstIndex < 0 || indexCount < 0 || firstIndex % 3 !== 0 || indexCount % 3 !== 0) {
        throw new Error(
            `Face-priority draw range must use non-negative triangle-aligned indices: ${firstIndex}+${indexCount}`,
        );
    }
    if (indexCount === 0) {
        return {
            firstSpan: 0,
            spanCount: 0,
            firstFace: firstIndex / 3,
            faceCount: 0,
        };
    }

    let firstSpan = -1;
    for (let i = 0; i < modelSpans.length; i++) {
        if (modelSpans[i].firstIndex === firstIndex) {
            firstSpan = i;
            break;
        }
    }
    if (firstSpan < 0) {
        throw new Error(`Face-priority draw starts inside or outside a model span at index ${firstIndex}`);
    }

    const endIndex = firstIndex + indexCount;
    let spanCount = 0;
    let cursor = firstIndex;
    for (let i = firstSpan; i < modelSpans.length && cursor < endIndex; i++) {
        const span = modelSpans[i];
        if (span.firstIndex !== cursor) {
            throw new Error(
                `Face-priority draw has a model-span gap at index ${cursor}; next span starts at ${span.firstIndex}`,
            );
        }
        cursor += span.indexCount;
        spanCount++;
        if (cursor > endIndex) {
            throw new Error(`Face-priority draw ends inside model span ${i}`);
        }
    }
    if (cursor !== endIndex) {
        throw new Error(
            `Face-priority draw spans ${cursor - firstIndex} indices, expected ${indexCount}`,
        );
    }

    return {
        firstSpan,
        spanCount,
        firstFace: firstIndex / 3,
        faceCount: indexCount / 3,
    };
}

export class WebGPUFacePrioritySortResources {
    readonly modelSpans: WebGPUFacePriorityModelSpan[];
    readonly priorityWords: Uint32Array;
    readonly sourceIndices: Uint32Array;
    readonly vertices: Uint8Array;

    readonly priorityBuffer: WebGPUBufferLike;
    readonly modelSpanBuffer: WebGPUBufferLike;
    readonly sourceIndexBuffer: WebGPUBufferLike;

    private readonly disposeCallbacks = new Set<() => void>();

    constructor(
        readonly device: WebGPUDeviceLike,
        readonly labelPrefix: string,
        vertices: Uint8Array,
        indices: Int32Array,
        priorities: Uint8Array,
        modelSpans: Uint32Array,
    ) {
        this.modelSpans = createWebGPUFacePriorityModelSpans(
            indices.length,
            priorities,
            modelSpans,
        );
        this.priorityWords = createWebGPUFacePriorityWords(priorities);
        this.sourceIndices = new Uint32Array(indices.length);
        for (let i = 0; i < indices.length; i++) {
            this.sourceIndices[i] = indices[i] >>> 0;
        }
        // Retain an immutable CPU copy so pass-local depth compute resources can
        // be rebuilt when animated/instanced submissions outgrow scratch capacity.
        this.vertices = new Uint8Array(vertices);

        this.priorityBuffer = createUploadedBuffer(
            device,
            `${labelPrefix}-face-priorities`,
            WEBGPU_BUFFER_USAGE.STORAGE,
            this.priorityWords,
        );
        this.modelSpanBuffer = createUploadedBuffer(
            device,
            `${labelPrefix}-face-priority-model-spans`,
            WEBGPU_BUFFER_USAGE.STORAGE,
            modelSpans,
        );
        this.sourceIndexBuffer = createUploadedBuffer(
            device,
            `${labelPrefix}-face-priority-source-indices`,
            WEBGPU_BUFFER_USAGE.STORAGE,
            this.sourceIndices,
        );
    }

    resolveDraw(draw: FacePriorityDrawRangeLike): WebGPUFacePriorityDrawSpanRange {
        return resolveWebGPUFacePriorityDrawSpanRange(draw, this.modelSpans);
    }

    registerDisposeCallback(callback: () => void): void {
        this.disposeCallbacks.add(callback);
    }

    dispose(): void {
        for (const callback of this.disposeCallbacks) {
            callback();
        }
        this.disposeCallbacks.clear();
        this.priorityBuffer.destroy?.();
        this.modelSpanBuffer.destroy?.();
        this.sourceIndexBuffer.destroy?.();
        this.modelSpans.length = 0;
    }
}
