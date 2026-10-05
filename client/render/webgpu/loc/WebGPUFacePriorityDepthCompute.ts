import {
    WEBGPU_BUFFER_USAGE,
    WEBGPU_SHADER_STAGE,
    type WebGPUBindGroupLike,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBufferLike,
    type WebGPUCommandEncoderLike,
    type WebGPUComputePipelineLike,
    type WebGPUDeviceLike,
} from "../../backend/WebGPUPlatform";
import type { WebGPUFacePriorityDrawSpanRange } from "./WebGPUFacePrioritySortResources";

export const WEBGPU_FACE_PRIORITY_DEPTH_WORKGROUP_SIZE = 64;
export const WEBGPU_FACE_PRIORITY_DEPTH_UNIFORM_BYTES = 80;

export type FacePriorityDepthTransform = ArrayLike<number>;

export interface FacePriorityDepthRangeLike {
    firstFace: number;
    faceCount: number;
}

function assertDepthTransform(transform: FacePriorityDepthTransform): void {
    if (transform.length < 16) {
        throw new Error("Face-priority depth transform requires a 4x4 matrix");
    }
}

/**
 * Decode the existing 12-byte packed scene-vertex ABI without changing the
 * WebGL2-compatible vertex format.
 */
export function decodeWebGPUFacePriorityPackedPosition(
    packedWords: ArrayLike<number>,
    vertexIndex: number,
): [number, number, number] {
    const base = (vertexIndex | 0) * 3;
    if (vertexIndex < 0 || base + 2 >= packedWords.length) {
        throw new RangeError(`Packed vertex index ${vertexIndex} is out of range`);
    }
    const v0 = packedWords[base] >>> 0;
    const v1 = packedWords[base + 1] >>> 0;
    const v2 = packedWords[base + 2] >>> 0;
    return [
        ((v0 >>> 17) & 0x7fff) - 0x4000,
        -((v1 & 0x7fff) - 0x4000),
        ((v2 >>> 17) & 0x7fff) - 0x4000,
    ];
}

/**
 * Camera-relative Z used by the face painter. The transform is multiplied with
 * w=0 deliberately: camera translation, model placement translation, and the
 * software renderer's model-radius term are constants for every face in one
 * model, so they cancel from all model-local depth ordering and thresholds.
 */
export function transformWebGPUFacePriorityDepthZ(
    position: readonly [number, number, number],
    transform: FacePriorityDepthTransform,
): number {
    assertDepthTransform(transform);
    const [x, y, z] = position;
    return Math.fround(
        Math.fround(Math.fround(transform[2]) * Math.fround(x)) +
            Math.fround(Math.fround(transform[6]) * Math.fround(y)) +
            Math.fround(Math.fround(transform[10]) * Math.fround(z)),
    );
}

/** Match Java integer division after the software renderer sums three vertex depths. */
export function truncateWebGPUFacePriorityDepth(z0: number, z1: number, z2: number): number {
    const sum = Math.fround(Math.fround(z0 + z1) + z2);
    return Math.trunc(Math.fround(sum / 3));
}

export function computeWebGPUFacePriorityDepth(
    packedWords: ArrayLike<number>,
    sourceIndices: ArrayLike<number>,
    faceIndex: number,
    transform: FacePriorityDepthTransform,
): number {
    const indexBase = (faceIndex | 0) * 3;
    if (faceIndex < 0 || indexBase + 2 >= sourceIndices.length) {
        throw new RangeError(`Face index ${faceIndex} is out of range`);
    }
    const a = decodeWebGPUFacePriorityPackedPosition(packedWords, sourceIndices[indexBase] >>> 0);
    const b = decodeWebGPUFacePriorityPackedPosition(
        packedWords,
        sourceIndices[indexBase + 1] >>> 0,
    );
    const c = decodeWebGPUFacePriorityPackedPosition(
        packedWords,
        sourceIndices[indexBase + 2] >>> 0,
    );
    return truncateWebGPUFacePriorityDepth(
        transformWebGPUFacePriorityDepthZ(a, transform),
        transformWebGPUFacePriorityDepthZ(b, transform),
        transformWebGPUFacePriorityDepthZ(c, transform),
    );
}

export function createWebGPUFacePriorityActiveFaces(
    ranges: readonly FacePriorityDepthRangeLike[],
    totalFaceCount: number,
): Uint32Array {
    const faceCount = totalFaceCount | 0;
    if (faceCount < 0) {
        throw new RangeError(`Face-priority face count must be non-negative, got ${totalFaceCount}`);
    }
    const active = new Uint8Array(faceCount);
    let activeCount = 0;
    for (const range of ranges) {
        const firstFace = range.firstFace | 0;
        const rangeFaceCount = range.faceCount | 0;
        if (
            firstFace < 0 ||
            rangeFaceCount < 0 ||
            firstFace + rangeFaceCount > faceCount
        ) {
            throw new RangeError(
                `Face-priority depth range ${firstFace}+${rangeFaceCount} exceeds ${faceCount} faces`,
            );
        }
        for (let face = firstFace; face < firstFace + rangeFaceCount; face++) {
            if (active[face] === 0) {
                active[face] = 1;
                activeCount++;
            }
        }
    }
    const faces = new Uint32Array(activeCount);
    let cursor = 0;
    for (let face = 0; face < faceCount; face++) {
        if (active[face] !== 0) {
            faces[cursor++] = face;
        }
    }
    return faces;
}

export function createWebGPUFacePriorityActiveFacesFromDraws(
    draws: readonly { facePrioritySpan?: WebGPUFacePriorityDrawSpanRange; indexCount: number; instanceCount: number }[],
    totalFaceCount: number,
): Uint32Array {
    const ranges: FacePriorityDepthRangeLike[] = [];
    for (const draw of draws) {
        if (draw.indexCount <= 0 || draw.instanceCount <= 0) {
            continue;
        }
        const span = draw.facePrioritySpan;
        if (!span) {
            throw new Error("Visible face-priority draw is missing its resolved model span");
        }
        ranges.push(span);
    }
    return createWebGPUFacePriorityActiveFaces(ranges, totalFaceCount);
}

export const WEBGPU_FACE_PRIORITY_DEPTH_SHADER = /* wgsl */ `
struct FaceDepthUniforms {
    transform: mat4x4<f32>,
    activeFaceCount: u32,
    _padding: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> packedVertexWords: array<u32>;
@group(0) @binding(1) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(2) var<storage, read> activeFaces: array<u32>;
@group(0) @binding(3) var<storage, read_write> faceDepths: array<f32>;
@group(0) @binding(4) var<uniform> uniforms: FaceDepthUniforms;

fn decodePackedPosition(vertexIndex: u32) -> vec3<f32> {
    let base = vertexIndex * 3u;
    let v0 = packedVertexWords[base];
    let v1 = packedVertexWords[base + 1u];
    let v2 = packedVertexWords[base + 2u];
    return vec3<f32>(
        f32(i32((v0 >> 17u) & 0x7fffu) - 0x4000),
        -f32(i32(v1 & 0x7fffu) - 0x4000),
        f32(i32((v2 >> 17u) & 0x7fffu) - 0x4000),
    );
}

fn relativeDepth(position: vec3<f32>) -> f32 {
    // w=0 intentionally drops camera/model translation. Those terms, and the
    // software model-radius offset, are constant for every face in one model.
    return (uniforms.transform * vec4<f32>(position, 0.0)).z;
}

@compute @workgroup_size(${WEBGPU_FACE_PRIORITY_DEPTH_WORKGROUP_SIZE})
fn csFaceDepth(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= uniforms.activeFaceCount) {
        return;
    }
    let faceIndex = activeFaces[id.x];
    let indexBase = faceIndex * 3u;
    let a = decodePackedPosition(sourceIndices[indexBase]);
    let b = decodePackedPosition(sourceIndices[indexBase + 1u]);
    let c = decodePackedPosition(sourceIndices[indexBase + 2u]);
    faceDepths[faceIndex] = trunc((relativeDepth(a) + relativeDepth(b) + relativeDepth(c)) / 3.0);
}
`;

type SharedDepthPipeline = {
    bindGroupLayout: WebGPUBindGroupLayoutLike;
    pipeline: WebGPUComputePipelineLike;
};

const SHARED_DEPTH_PIPELINES = new WeakMap<object, SharedDepthPipeline>();

function getSharedDepthPipeline(device: WebGPUDeviceLike): SharedDepthPipeline {
    const existing = SHARED_DEPTH_PIPELINES.get(device as object);
    if (existing) {
        return existing;
    }
    if (!device.createComputePipeline) {
        throw new Error("WebGPU compute pipelines are unavailable on this device wrapper");
    }
    const bindGroupLayout = device.createBindGroupLayout({
        label: "face-priority-depth-bind-group-layout",
        entries: [
            { binding: 0, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 3, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "storage" } },
            { binding: 4, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "uniform" } },
        ],
    });
    const layout = device.createPipelineLayout({
        label: "face-priority-depth-pipeline-layout",
        bindGroupLayouts: [bindGroupLayout],
    });
    const module = device.createShaderModule({
        label: "face-priority-depth-compute",
        code: WEBGPU_FACE_PRIORITY_DEPTH_SHADER,
    });
    const pipeline = device.createComputePipeline({
        label: "face-priority-depth-pipeline",
        layout,
        compute: { module, entryPoint: "csFaceDepth" },
    });
    const shared = { bindGroupLayout, pipeline };
    SHARED_DEPTH_PIPELINES.set(device as object, shared);
    return shared;
}

function createUploadedBuffer(
    device: WebGPUDeviceLike,
    label: string,
    usage: number,
    data: ArrayBufferView,
): WebGPUBufferLike {
    const buffer = device.createBuffer({
        label,
        size: Math.max(4, (data.byteLength + 3) & ~3),
        usage: usage | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    if (data.byteLength > 0) {
        device.queue.writeBuffer(buffer, 0, data);
    }
    return buffer;
}

function packedVertexWords(vertices: Uint8Array): Uint32Array {
    if (vertices.byteLength % 12 !== 0) {
        throw new Error(`Packed WebGPU model vertices must use the 12-byte ABI, got ${vertices.byteLength} bytes`);
    }
    const words = new Uint32Array(vertices.byteLength >>> 2);
    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    for (let i = 0; i < words.length; i++) {
        words[i] = view.getUint32(i * 4, true);
    }
    return words;
}

/**
 * Isolated depth-compute resource. It is intentionally not invoked by the live
 * renderer yet; Checkpoint 3 will schedule it immediately before exact sorting.
 */
export class WebGPUFacePriorityDepthComputeResources {
    readonly packedVertexBuffer: WebGPUBufferLike;
    readonly activeFaceBuffer: WebGPUBufferLike;
    readonly uniformBuffer: WebGPUBufferLike;
    readonly bindGroup: WebGPUBindGroupLike;

    private activeFaceCount = 0;
    private readonly shared: SharedDepthPipeline;

    constructor(
        private readonly device: WebGPUDeviceLike,
        labelPrefix: string,
        vertices: Uint8Array,
        private readonly totalFaceCount: number,
        sourceIndexBuffer: WebGPUBufferLike,
        faceDepthBuffer: WebGPUBufferLike,
    ) {
        if (totalFaceCount < 0) {
            throw new RangeError(`Face-priority face count must be non-negative, got ${totalFaceCount}`);
        }
        this.shared = getSharedDepthPipeline(device);
        this.packedVertexBuffer = createUploadedBuffer(
            device,
            `${labelPrefix}-face-priority-packed-vertices`,
            WEBGPU_BUFFER_USAGE.STORAGE,
            packedVertexWords(vertices),
        );
        this.activeFaceBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-active-faces`,
            size: Math.max(4, totalFaceCount * 4),
            usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        this.uniformBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-depth-uniforms`,
            size: WEBGPU_FACE_PRIORITY_DEPTH_UNIFORM_BYTES,
            usage: WEBGPU_BUFFER_USAGE.UNIFORM | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        this.bindGroup = device.createBindGroup({
            label: `${labelPrefix}-face-priority-depth-bind-group`,
            layout: this.shared.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.packedVertexBuffer } },
                { binding: 1, resource: { buffer: sourceIndexBuffer } },
                { binding: 2, resource: { buffer: this.activeFaceBuffer } },
                { binding: 3, resource: { buffer: faceDepthBuffer } },
                { binding: 4, resource: { buffer: this.uniformBuffer } },
            ],
        });
    }

    prepare(
        ranges: readonly FacePriorityDepthRangeLike[],
        transform: FacePriorityDepthTransform,
    ): number {
        assertDepthTransform(transform);
        const activeFaces = createWebGPUFacePriorityActiveFaces(ranges, this.totalFaceCount);
        this.activeFaceCount = activeFaces.length;
        if (activeFaces.byteLength > 0) {
            this.device.queue.writeBuffer(this.activeFaceBuffer, 0, activeFaces);
        }

        const uniformData = new ArrayBuffer(WEBGPU_FACE_PRIORITY_DEPTH_UNIFORM_BYTES);
        const floats = new Float32Array(uniformData);
        for (let i = 0; i < 16; i++) {
            floats[i] = transform[i];
        }
        new Uint32Array(uniformData)[16] = this.activeFaceCount;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        return this.activeFaceCount;
    }

    prepareDraws(
        draws: readonly { facePrioritySpan?: WebGPUFacePriorityDrawSpanRange; indexCount: number; instanceCount: number }[],
        transform: FacePriorityDepthTransform,
    ): number {
        const activeFaces = createWebGPUFacePriorityActiveFacesFromDraws(draws, this.totalFaceCount);
        return this.prepare(
            activeFaces.length === 0
                ? []
                : [{ firstFace: activeFaces[0], faceCount: activeFaces.length }],
            transform,
        );
    }

    encode(commandEncoder: WebGPUCommandEncoderLike): number {
        if (this.activeFaceCount === 0) {
            return 0;
        }
        const beginComputePass = commandEncoder.beginComputePass;
        if (!beginComputePass) {
            throw new Error("WebGPU compute passes are unavailable on this command encoder");
        }
        const pass = beginComputePass.call(commandEncoder, {
            label: "face-priority-depth-pass",
        });
        pass.setPipeline(this.shared.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.activeFaceCount / WEBGPU_FACE_PRIORITY_DEPTH_WORKGROUP_SIZE),
        );
        pass.end();
        return this.activeFaceCount;
    }

    dispose(): void {
        this.packedVertexBuffer.destroy?.();
        this.activeFaceBuffer.destroy?.();
        this.uniformBuffer.destroy?.();
        this.activeFaceCount = 0;
    }
}
