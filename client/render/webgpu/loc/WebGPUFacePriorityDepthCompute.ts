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
import type {
    WebGPUFacePriorityModelSpan,
    WebGPUFacePriorityDrawSpanRange,
} from "./WebGPUFacePrioritySortResources";

export const WEBGPU_FACE_PRIORITY_DEPTH_WORKGROUP_SIZE = 64;
export const WEBGPU_FACE_PRIORITY_DEPTH_UNIFORM_BYTES = 80;

export type FacePriorityDepthTransform = ArrayLike<number>;

export interface WebGPUFacePriorityDepthDrawLike {
    firstIndex: number;
    indexCount: number;
    instanceCount: number;
    firstInstance: number;
    facePrioritySpan?: WebGPUFacePriorityDrawSpanRange;
}

export interface WebGPUFacePriorityDepthModelJob {
    firstWorkItem: number;
    workItemCount: number;
    sourceFirstFace: number;
    sourceFaceCount: number;
    firstInstance: number;
}

export interface WebGPUFacePriorityDepthJobBatch {
    /** `[sourceFace, firstInstance]` pairs, one pair per compute invocation. */
    workItems: Uint32Array;
    /** Model-local ranges into `workItems`; retained for Checkpoint 3 sorting. */
    modelJobs: WebGPUFacePriorityDepthModelJob[];
}

function assertDepthTransform(transform: FacePriorityDepthTransform): void {
    if (transform.length < 16) {
        throw new Error("Face-priority depth transform requires a 4x4 matrix");
    }
}

/** Decode the existing 12-byte packed vertex ABI without changing WebGL2 data. */
export function decodeWebGPUFacePriorityPackedPosition(
    packedWords: ArrayLike<number>,
    vertexIndex: number,
): [number, number, number] {
    const index = vertexIndex | 0;
    const base = index * 3;
    if (index < 0 || base + 2 >= packedWords.length) {
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
 * Camera-relative linear Z. w=0 deliberately removes translation because map,
 * instance, camera, center-height, and software model-radius offsets are all
 * constants within one submitted model and therefore cancel from every
 * model-local priority comparison.
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

/** Match Java integer division after summing the three camera-space vertex depths. */
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

/**
 * Expand visible draw/model spans into an instance-aware depth work stream.
 *
 * Source faces are intentionally allowed to appear more than once. Animated
 * locs can reuse one frame span at multiple placements, and VERTEX contouring
 * can deform those instances differently. A dense work stream preserves those
 * independent depth results instead of incorrectly sharing `depth[sourceFace]`.
 */
export function createWebGPUFacePriorityDepthJobs(
    draws: readonly WebGPUFacePriorityDepthDrawLike[],
    modelSpans: readonly WebGPUFacePriorityModelSpan[],
): WebGPUFacePriorityDepthJobBatch {
    const words: number[] = [];
    const modelJobs: WebGPUFacePriorityDepthModelJob[] = [];

    for (const draw of draws) {
        if (draw.indexCount <= 0 || draw.instanceCount <= 0) {
            continue;
        }
        if (draw.instanceCount !== 1) {
            throw new Error(
                `Face-priority depth requires one placed-model instance per draw, got ${draw.instanceCount}`,
            );
        }
        const resolved = draw.facePrioritySpan;
        if (!resolved) {
            throw new Error("Visible face-priority draw is missing its resolved model span");
        }
        for (let i = 0; i < resolved.spanCount; i++) {
            const spanIndex = resolved.firstSpan + i;
            const span = modelSpans[spanIndex];
            if (!span) {
                throw new Error(`Face-priority depth references missing model span ${spanIndex}`);
            }
            const firstWorkItem = words.length >>> 1;
            for (let face = 0; face < span.faceCount; face++) {
                words.push(span.firstFace + face, draw.firstInstance >>> 0);
            }
            modelJobs.push({
                firstWorkItem,
                workItemCount: span.faceCount,
                sourceFirstFace: span.firstFace,
                sourceFaceCount: span.faceCount,
                firstInstance: draw.firstInstance >>> 0,
            });
        }
    }

    return {
        workItems: Uint32Array.from(words),
        modelJobs,
    };
}

export const WEBGPU_FACE_PRIORITY_DEPTH_SHADER = /* wgsl */ `
struct LocModelInfoBuffer {
    data: array<vec4<u32>>,
};

struct FaceDepthUniforms {
    transform: mat4x4<f32>,
    workItemCount: u32,
    borderSize: i32,
    _padding: vec2<u32>,
};

@group(0) @binding(0) var<storage, read> packedVertexWords: array<u32>;
@group(0) @binding(1) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(2) var<storage, read> workItems: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read_write> faceDepths: array<f32>;
@group(0) @binding(4) var locHeightMap: texture_2d_array<i32>;
@group(0) @binding(5) var<storage, read> locModelInfos: LocModelInfoBuffer;
@group(0) @binding(6) var<uniform> uniforms: FaceDepthUniforms;

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

fn getLocTileHeight(x: i32, z: i32, plane: u32) -> i32 {
    return textureLoad(
        locHeightMap,
        vec2<i32>(uniforms.borderSize + x, uniforms.borderSize + z),
        i32(plane),
        0,
    ).r * 8;
}

fn getLocHeightInterp(pos: vec2<f32>, plane: u32) -> f32 {
    let ipos = vec2<i32>(pos);
    let tileX = ipos.x >> 7u;
    let tileZ = ipos.y >> 7u;
    let offsetX = ipos.x & 127;
    let offsetZ = ipos.y & 127;
    let hSW = getLocTileHeight(tileX, tileZ, plane);
    let hSE = getLocTileHeight(tileX + 1, tileZ, plane);
    let hNW = getLocTileHeight(tileX, tileZ + 1, plane);
    let hNE = getLocTileHeight(tileX + 1, tileZ + 1, plane);

    var h0: i32;
    if (offsetX + offsetZ <= 128) {
        h0 = (hSW * 128 + (hSE - hSW) * offsetX + (hNW - hSW) * offsetZ) >> 7u;
    } else {
        let rx = 128 - offsetX;
        let rz = 128 - offsetZ;
        h0 = (hNE * 128 + (hNW - hNE) * rx + (hSE - hNE) * rz) >> 7u;
    }

    var h1: i32;
    if (offsetX <= offsetZ) {
        h1 = (hSW * 128 + (hNW - hSW) * offsetZ + (hNE - hNW) * offsetX) >> 7u;
    } else {
        h1 = (hSW * 128 + (hSE - hSW) * offsetX + (hNE - hSE) * offsetZ) >> 7u;
    }
    return f32(max(h0, h1));
}

fn depthPosition(vertexIndex: u32, instanceIndex: u32) -> vec3<f32> {
    var position = decodePackedPosition(vertexIndex);
    let info = locModelInfos.data[instanceIndex];
    let contourGround = (info.y >> 14u) & 0x3u;

    // CENTER_TILE contour, model height, placement, map position, camera
    // translation, and model radius are constant for the whole model and cancel
    // from its face ordering. VERTEX contour is the one placement term that can
    // change relative face depths and must be applied here.
    if (contourGround == 1u) {
        let tilePos = vec2<f32>(
            f32(info.x & 0x3fffu),
            f32(info.y & 0x3fffu),
        );
        let plane = (info.x >> 14u) & 0x3u;
        position.y -= getLocHeightInterp(position.xz + tilePos, plane);
    }
    return position;
}

fn relativeDepth(position: vec3<f32>) -> f32 {
    return (uniforms.transform * vec4<f32>(position, 0.0)).z;
}

@compute @workgroup_size(${WEBGPU_FACE_PRIORITY_DEPTH_WORKGROUP_SIZE})
fn csFaceDepth(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= uniforms.workItemCount) {
        return;
    }
    let job = workItems[id.x];
    let sourceFace = job.x;
    let instanceIndex = job.y;
    let indexBase = sourceFace * 3u;
    let a = depthPosition(sourceIndices[indexBase], instanceIndex);
    let b = depthPosition(sourceIndices[indexBase + 1u], instanceIndex);
    let c = depthPosition(sourceIndices[indexBase + 2u], instanceIndex);
    faceDepths[id.x] = trunc((relativeDepth(a) + relativeDepth(b) + relativeDepth(c)) / 3.0);
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
            {
                binding: 4,
                visibility: WEBGPU_SHADER_STAGE.COMPUTE,
                texture: { sampleType: "sint", viewDimension: "2d-array", multisampled: false },
            },
            { binding: 5, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 6, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "uniform" } },
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

function createPackedVertexWords(vertices: Uint8Array): Uint32Array {
    if (vertices.byteLength % 12 !== 0) {
        throw new Error(
            `Packed WebGPU model vertices must use the 12-byte ABI, got ${vertices.byteLength} bytes`,
        );
    }
    const words = new Uint32Array(vertices.byteLength >>> 2);
    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    for (let i = 0; i < words.length; i++) {
        words[i] = view.getUint32(i * 4, true);
    }
    return words;
}

/**
 * Per-pass depth-compute resources. `maxWorkItems` is the maximum number of
 * face references submitted by that pass, not the number of unique source
 * faces, because animated instances are intentionally allowed to duplicate a
 * source span with different contouring.
 *
 * This class remains disconnected from the render loop in Checkpoint 2. The
 * next checkpoint will schedule depth -> exact sort before any priority index
 * source is activated.
 */
export class WebGPUFacePriorityDepthComputeResources {
    readonly packedVertexBuffer: WebGPUBufferLike;
    readonly workItemBuffer: WebGPUBufferLike;
    readonly faceDepthBuffer: WebGPUBufferLike;
    readonly uniformBuffer: WebGPUBufferLike;
    readonly bindGroup: WebGPUBindGroupLike;

    private workItemCount = 0;
    private readonly shared: SharedDepthPipeline;

    constructor(
        private readonly device: WebGPUDeviceLike,
        labelPrefix: string,
        vertices: Uint8Array,
        private readonly maxWorkItems: number,
        sourceIndexBuffer: WebGPUBufferLike,
        heightMapView: unknown,
        modelInfoBuffer: WebGPUBufferLike,
    ) {
        if (maxWorkItems < 0) {
            throw new RangeError(`Face-priority work-item capacity must be non-negative`);
        }
        this.shared = getSharedDepthPipeline(device);
        this.packedVertexBuffer = createUploadedBuffer(
            device,
            `${labelPrefix}-face-priority-packed-vertices`,
            WEBGPU_BUFFER_USAGE.STORAGE,
            createPackedVertexWords(vertices),
        );
        this.workItemBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-depth-jobs`,
            size: Math.max(8, maxWorkItems * 8),
            usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        this.faceDepthBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-depths`,
            size: Math.max(4, maxWorkItems * 4),
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
                { binding: 2, resource: { buffer: this.workItemBuffer } },
                { binding: 3, resource: { buffer: this.faceDepthBuffer } },
                { binding: 4, resource: heightMapView },
                { binding: 5, resource: { buffer: modelInfoBuffer } },
                { binding: 6, resource: { buffer: this.uniformBuffer } },
            ],
        });
    }

    prepare(
        batch: WebGPUFacePriorityDepthJobBatch,
        transform: FacePriorityDepthTransform,
        borderSize: number,
    ): number {
        assertDepthTransform(transform);
        const count = batch.workItems.length >>> 1;
        if (count > this.maxWorkItems) {
            throw new Error(
                `Face-priority depth batch has ${count} work items, capacity is ${this.maxWorkItems}`,
            );
        }
        this.workItemCount = count;
        if (batch.workItems.byteLength > 0) {
            this.device.queue.writeBuffer(this.workItemBuffer, 0, batch.workItems);
        }

        const uniformData = new ArrayBuffer(WEBGPU_FACE_PRIORITY_DEPTH_UNIFORM_BYTES);
        const floats = new Float32Array(uniformData);
        for (let i = 0; i < 16; i++) {
            floats[i] = transform[i];
        }
        const words = new Uint32Array(uniformData);
        words[16] = count;
        new Int32Array(uniformData)[17] = borderSize | 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        return count;
    }

    encode(commandEncoder: WebGPUCommandEncoderLike): number {
        if (this.workItemCount === 0) {
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
            Math.ceil(this.workItemCount / WEBGPU_FACE_PRIORITY_DEPTH_WORKGROUP_SIZE),
        );
        pass.end();
        return this.workItemCount;
    }

    dispose(): void {
        this.packedVertexBuffer.destroy?.();
        this.workItemBuffer.destroy?.();
        this.faceDepthBuffer.destroy?.();
        this.uniformBuffer.destroy?.();
        this.workItemCount = 0;
    }
}
