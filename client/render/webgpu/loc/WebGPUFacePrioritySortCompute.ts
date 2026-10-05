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
    WebGPUFacePriorityDepthDrawLike,
    WebGPUFacePriorityDepthJobBatch,
    WebGPUFacePriorityDepthComputeResources,
} from "./WebGPUFacePriorityDepthCompute";
import type { WebGPUFacePriorityModelSpan } from "./WebGPUFacePrioritySortResources";

export const WEBGPU_FACE_PRIORITY_SORT_WORKGROUP_SIZE = 64;
export const WEBGPU_FACE_PRIORITY_SORT_UNIFORM_BYTES = 16;

export interface WebGPUFacePrioritySortedDrawRange {
    sourceDrawIndex: number;
    firstIndex: number;
    indexCount: number;
    instanceCount: number;
    firstInstance: number;
    firstModelJob: number;
    modelJobCount: number;
}

export interface WebGPUFacePrioritySortMetadata {
    /** `[jobIndex, localFace]` pairs parallel to the depth work stream. */
    workItems: Uint32Array;
    /** `[firstWorkItem, faceCount]` pairs, one entry per submitted model span. */
    modelJobs: Uint32Array;
}

function validatePriority(priority: number, faceIndex: number): number {
    const value = priority | 0;
    if (value < 0 || value > 11) {
        throw new RangeError(`Face ${faceIndex} has invalid render priority ${priority}`);
    }
    return value;
}

function averageDepth(sum: number, count: number): number {
    return count === 0 ? 0 : Math.trunc(sum / count);
}

function rankWithinPriority(
    depths: ArrayLike<number>,
    priorities: ArrayLike<number>,
    faceIndex: number,
    priority: number,
): number {
    const depth = Math.trunc(Number(depths[faceIndex]));
    let rank = 0;
    for (let other = 0; other < depths.length; other++) {
        if (validatePriority(Number(priorities[other]), other) !== priority) {
            continue;
        }
        const otherDepth = Math.trunc(Number(depths[other]));
        if (otherDepth > depth || (otherDepth === depth && other < faceIndex)) {
            rank++;
        }
    }
    return rank;
}

function specialPrefixAbove(
    depths: ArrayLike<number>,
    priorities: ArrayLike<number>,
    count10: number,
    threshold: number,
): number {
    let above10 = 0;
    let above11 = 0;
    for (let face = 0; face < depths.length; face++) {
        const priority = validatePriority(Number(priorities[face]), face);
        if (Math.trunc(Number(depths[face])) <= threshold) {
            continue;
        }
        if (priority === 10) {
            above10++;
        } else if (priority === 11) {
            above11++;
        }
    }
    // The software painter exhausts priority 10 before it can advance into 11.
    // If a priority-10 face fails the strict threshold, the special stream stops
    // there even when deeper priority-11 faces exist later in their own bucket.
    return above10 < count10 ? above10 : count10 + above11;
}

/**
 * CPU mirror of the rank equation used by the WGSL sorter.
 *
 * This intentionally does not call the renderer-neutral CPU painter reference.
 * Tests compare this independently derived rank formulation against
 * `createFacePriorityDrawOrder` so the GPU algorithm has a deterministic oracle.
 */
export function createWebGPUFacePriorityAnalyticOrder(
    depths: ArrayLike<number>,
    priorities: ArrayLike<number>,
): number[] {
    if (depths.length !== priorities.length) {
        throw new Error(
            `Face priority/depth length mismatch: ${priorities.length} priorities for ${depths.length} depths`,
        );
    }

    const counts = new Array<number>(12).fill(0);
    const sums = new Array<number>(10).fill(0);
    for (let face = 0; face < depths.length; face++) {
        const priority = validatePriority(Number(priorities[face]), face);
        const depth = Math.trunc(Number(depths[face]));
        counts[priority]++;
        if (priority < 10) {
            sums[priority] += depth;
        }
    }

    const threshold12 = averageDepth(sums[1] + sums[2], counts[1] + counts[2]);
    const threshold34 = averageDepth(sums[3] + sums[4], counts[3] + counts[4]);
    const threshold68 = averageDepth(sums[6] + sums[8], counts[6] + counts[8]);

    const flush0 = specialPrefixAbove(depths, priorities, counts[10], threshold12);
    const flush3 = Math.max(
        flush0,
        specialPrefixAbove(depths, priorities, counts[10], threshold34),
    );
    const flush5 = Math.max(
        flush3,
        specialPrefixAbove(depths, priorities, counts[10], threshold68),
    );

    const regular0To2 = counts[0] + counts[1] + counts[2];
    const regular0To4 = regular0To2 + counts[3] + counts[4];
    const regular0To9 =
        regular0To4 + counts[5] + counts[6] + counts[7] + counts[8] + counts[9];

    const output = new Array<number>(depths.length).fill(-1);
    for (let face = 0; face < depths.length; face++) {
        const priority = validatePriority(Number(priorities[face]), face);
        const bucketRank = rankWithinPriority(depths, priorities, face, priority);
        let finalRank: number;

        if (priority < 10) {
            let regularBefore = 0;
            for (let p = 0; p < priority; p++) {
                regularBefore += counts[p];
            }
            const specialBefore = priority < 3 ? flush0 : priority < 5 ? flush3 : flush5;
            finalRank = specialBefore + regularBefore + bucketRank;
        } else {
            const specialOrdinal =
                priority === 10 ? bucketRank : counts[10] + bucketRank;
            if (specialOrdinal < flush0) {
                finalRank = specialOrdinal;
            } else if (specialOrdinal < flush3) {
                finalRank = regular0To2 + specialOrdinal;
            } else if (specialOrdinal < flush5) {
                finalRank = regular0To4 + specialOrdinal;
            } else {
                finalRank = regular0To9 + specialOrdinal;
            }
        }

        if (finalRank < 0 || finalRank >= output.length || output[finalRank] !== -1) {
            throw new Error(`Face-priority analytic rank collision at rank ${finalRank}`);
        }
        output[finalRank] = face;
    }
    return output;
}

export function createWebGPUFacePrioritySortMetadata(
    batch: WebGPUFacePriorityDepthJobBatch,
): WebGPUFacePrioritySortMetadata {
    if ((batch.workItems.length & 1) !== 0) {
        throw new Error("Face-priority depth work items must contain sourceFace/instance pairs");
    }
    const workItemCount = batch.workItems.length >>> 1;
    const workItems = new Uint32Array(workItemCount * 2);
    const modelJobs = new Uint32Array(batch.modelJobs.length * 2);

    let expectedFirstWorkItem = 0;
    for (let jobIndex = 0; jobIndex < batch.modelJobs.length; jobIndex++) {
        const job = batch.modelJobs[jobIndex];
        if (job.firstWorkItem !== expectedFirstWorkItem) {
            throw new Error(
                `Face-priority model job ${jobIndex} starts at ${job.firstWorkItem}, expected ${expectedFirstWorkItem}`,
            );
        }
        if (job.workItemCount !== job.sourceFaceCount || job.workItemCount <= 0) {
            throw new Error(
                `Face-priority model job ${jobIndex} has invalid work-item count ${job.workItemCount}`,
            );
        }
        if (job.firstWorkItem + job.workItemCount > workItemCount) {
            throw new Error(`Face-priority model job ${jobIndex} exceeds the depth work stream`);
        }

        modelJobs[jobIndex * 2] = job.firstWorkItem >>> 0;
        modelJobs[jobIndex * 2 + 1] = job.workItemCount >>> 0;
        for (let localFace = 0; localFace < job.workItemCount; localFace++) {
            const workItem = job.firstWorkItem + localFace;
            workItems[workItem * 2] = jobIndex >>> 0;
            workItems[workItem * 2 + 1] = localFace >>> 0;
        }
        expectedFirstWorkItem += job.workItemCount;
    }

    if (expectedFirstWorkItem !== workItemCount) {
        throw new Error(
            `Face-priority model jobs cover ${expectedFirstWorkItem} work items, expected ${workItemCount}`,
        );
    }
    return { workItems, modelJobs };
}

/**
 * Build the dense sorted-index ranges that Checkpoint 4 can bind for rendering.
 * Duplicate source draws intentionally receive different output ranges.
 */
export function createWebGPUFacePrioritySortedDrawRanges(
    draws: readonly WebGPUFacePriorityDepthDrawLike[],
    modelSpans: readonly WebGPUFacePriorityModelSpan[],
    batch: WebGPUFacePriorityDepthJobBatch,
): WebGPUFacePrioritySortedDrawRange[] {
    const output: WebGPUFacePrioritySortedDrawRange[] = [];
    let workItemCursor = 0;
    let modelJobCursor = 0;

    for (let sourceDrawIndex = 0; sourceDrawIndex < draws.length; sourceDrawIndex++) {
        const draw = draws[sourceDrawIndex];
        if (draw.indexCount <= 0 || draw.instanceCount <= 0) {
            continue;
        }
        if (draw.instanceCount !== 1) {
            throw new Error(
                `Face-priority sorted ranges require one placed-model instance per draw, got ${draw.instanceCount}`,
            );
        }
        const resolved = draw.facePrioritySpan;
        if (!resolved) {
            throw new Error("Visible face-priority draw is missing its resolved model span");
        }

        let faceCount = 0;
        for (let i = 0; i < resolved.spanCount; i++) {
            const span = modelSpans[resolved.firstSpan + i];
            if (!span) {
                throw new Error(
                    `Face-priority sorted range references missing model span ${resolved.firstSpan + i}`,
                );
            }
            faceCount += span.faceCount;
        }
        output.push({
            sourceDrawIndex,
            firstIndex: workItemCursor * 3,
            indexCount: faceCount * 3,
            instanceCount: draw.instanceCount,
            firstInstance: draw.firstInstance,
            firstModelJob: modelJobCursor,
            modelJobCount: resolved.spanCount,
        });
        workItemCursor += faceCount;
        modelJobCursor += resolved.spanCount;
    }

    if (workItemCursor !== (batch.workItems.length >>> 1)) {
        throw new Error(
            `Face-priority sorted ranges cover ${workItemCursor} work items, depth batch contains ${batch.workItems.length >>> 1}`,
        );
    }
    if (modelJobCursor !== batch.modelJobs.length) {
        throw new Error(
            `Face-priority sorted ranges cover ${modelJobCursor} model jobs, depth batch contains ${batch.modelJobs.length}`,
        );
    }
    return output;
}

export const WEBGPU_FACE_PRIORITY_SORT_SHADER = /* wgsl */ `
struct SortUniforms {
    workItemCount: u32,
    _padding: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> depthWorkItems: array<vec2<u32>>;
@group(0) @binding(1) var<storage, read> sortWorkItems: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read> modelJobs: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read> faceDepths: array<f32>;
@group(0) @binding(4) var<storage, read> facePriorities: array<u32>;
@group(0) @binding(5) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(6) var<storage, read_write> sortedIndices: array<u32>;
@group(0) @binding(7) var<uniform> uniforms: SortUniforms;

fn workPriority(workItem: u32) -> u32 {
    return facePriorities[depthWorkItems[workItem].x];
}

fn workDepth(workItem: u32) -> i32 {
    return i32(faceDepths[workItem]);
}

fn specialPrefixAbove(firstWorkItem: u32, faceCount: u32, count10: u32, threshold: i32) -> u32 {
    var above10 = 0u;
    var above11 = 0u;
    for (var localFace = 0u; localFace < faceCount; localFace = localFace + 1u) {
        let workItem = firstWorkItem + localFace;
        if (workDepth(workItem) <= threshold) {
            continue;
        }
        let priority = workPriority(workItem);
        if (priority == 10u) {
            above10 = above10 + 1u;
        } else if (priority == 11u) {
            above11 = above11 + 1u;
        }
    }
    if (above10 < count10) {
        return above10;
    }
    return count10 + above11;
}

@compute @workgroup_size(${WEBGPU_FACE_PRIORITY_SORT_WORKGROUP_SIZE})
fn csFacePrioritySort(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= uniforms.workItemCount) {
        return;
    }

    let itemMeta = sortWorkItems[id.x];
    let jobIndex = itemMeta.x;
    let localFace = itemMeta.y;
    let job = modelJobs[jobIndex];
    let firstWorkItem = job.x;
    let faceCount = job.y;
    let sourceFace = depthWorkItems[id.x].x;
    let priority = facePriorities[sourceFace];
    let depth = workDepth(id.x);

    var counts: array<u32, 12>;
    var sums: array<i32, 10>;
    var bucketRank = 0u;

    for (var p = 0u; p < 12u; p = p + 1u) {
        counts[p] = 0u;
    }
    for (var p = 0u; p < 10u; p = p + 1u) {
        sums[p] = 0;
    }

    for (var otherLocal = 0u; otherLocal < faceCount; otherLocal = otherLocal + 1u) {
        let otherWorkItem = firstWorkItem + otherLocal;
        let otherPriority = workPriority(otherWorkItem);
        let otherDepth = workDepth(otherWorkItem);
        counts[otherPriority] = counts[otherPriority] + 1u;
        if (otherPriority < 10u) {
            sums[otherPriority] = sums[otherPriority] + otherDepth;
        }
        if (
            otherPriority == priority &&
            (otherDepth > depth || (otherDepth == depth && otherLocal < localFace))
        ) {
            bucketRank = bucketRank + 1u;
        }
    }

    var threshold12 = 0;
    let count12 = counts[1] + counts[2];
    if (count12 > 0u) {
        threshold12 = (sums[1] + sums[2]) / i32(count12);
    }
    var threshold34 = 0;
    let count34 = counts[3] + counts[4];
    if (count34 > 0u) {
        threshold34 = (sums[3] + sums[4]) / i32(count34);
    }
    var threshold68 = 0;
    let count68 = counts[6] + counts[8];
    if (count68 > 0u) {
        threshold68 = (sums[6] + sums[8]) / i32(count68);
    }

    let flush0 = specialPrefixAbove(firstWorkItem, faceCount, counts[10], threshold12);
    let flush3 = max(
        flush0,
        specialPrefixAbove(firstWorkItem, faceCount, counts[10], threshold34),
    );
    let flush5 = max(
        flush3,
        specialPrefixAbove(firstWorkItem, faceCount, counts[10], threshold68),
    );

    let regular0To2 = counts[0] + counts[1] + counts[2];
    let regular0To4 = regular0To2 + counts[3] + counts[4];
    let regular0To9 =
        regular0To4 + counts[5] + counts[6] + counts[7] + counts[8] + counts[9];

    var finalRank = 0u;
    if (priority < 10u) {
        var regularBefore = 0u;
        for (var p = 0u; p < priority; p = p + 1u) {
            regularBefore = regularBefore + counts[p];
        }
        var specialBefore = flush5;
        if (priority < 3u) {
            specialBefore = flush0;
        } else if (priority < 5u) {
            specialBefore = flush3;
        }
        finalRank = specialBefore + regularBefore + bucketRank;
    } else {
        var specialOrdinal = bucketRank;
        if (priority == 11u) {
            specialOrdinal = counts[10] + bucketRank;
        }
        if (specialOrdinal < flush0) {
            finalRank = specialOrdinal;
        } else if (specialOrdinal < flush3) {
            finalRank = regular0To2 + specialOrdinal;
        } else if (specialOrdinal < flush5) {
            finalRank = regular0To4 + specialOrdinal;
        } else {
            finalRank = regular0To9 + specialOrdinal;
        }
    }

    let sourceIndexBase = sourceFace * 3u;
    let targetIndexBase = (firstWorkItem + finalRank) * 3u;
    sortedIndices[targetIndexBase] = sourceIndices[sourceIndexBase];
    sortedIndices[targetIndexBase + 1u] = sourceIndices[sourceIndexBase + 1u];
    sortedIndices[targetIndexBase + 2u] = sourceIndices[sourceIndexBase + 2u];
}
`;

type SharedSortPipeline = {
    bindGroupLayout: WebGPUBindGroupLayoutLike;
    pipeline: WebGPUComputePipelineLike;
};

const SHARED_SORT_PIPELINES = new WeakMap<object, SharedSortPipeline>();

function getSharedSortPipeline(device: WebGPUDeviceLike): SharedSortPipeline {
    const existing = SHARED_SORT_PIPELINES.get(device as object);
    if (existing) {
        return existing;
    }
    if (!device.createComputePipeline) {
        throw new Error("WebGPU compute pipelines are unavailable on this device wrapper");
    }
    const bindGroupLayout = device.createBindGroupLayout({
        label: "face-priority-sort-bind-group-layout",
        entries: [
            { binding: 0, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 3, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 4, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 5, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 6, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "storage" } },
            { binding: 7, visibility: WEBGPU_SHADER_STAGE.COMPUTE, buffer: { type: "uniform" } },
        ],
    });
    const layout = device.createPipelineLayout({
        label: "face-priority-sort-pipeline-layout",
        bindGroupLayouts: [bindGroupLayout],
    });
    const module = device.createShaderModule({
        label: "face-priority-sort-compute",
        code: WEBGPU_FACE_PRIORITY_SORT_SHADER,
    });
    const pipeline = device.createComputePipeline({
        label: "face-priority-sort-pipeline",
        layout,
        compute: { module, entryPoint: "csFacePrioritySort" },
    });
    const shared = { bindGroupLayout, pipeline };
    SHARED_SORT_PIPELINES.set(device as object, shared);
    return shared;
}

export class WebGPUFacePrioritySortComputeResources {
    readonly sortWorkItemBuffer: WebGPUBufferLike;
    readonly modelJobBuffer: WebGPUBufferLike;
    readonly sortedIndexBuffer: WebGPUBufferLike;
    readonly uniformBuffer: WebGPUBufferLike;
    readonly bindGroup: WebGPUBindGroupLike;

    private workItemCount = 0;
    private readonly shared: SharedSortPipeline;

    constructor(
        private readonly device: WebGPUDeviceLike,
        labelPrefix: string,
        private readonly maxWorkItems: number,
        private readonly maxModelJobs: number,
        depthWorkItemBuffer: WebGPUBufferLike,
        faceDepthBuffer: WebGPUBufferLike,
        priorityBuffer: WebGPUBufferLike,
        sourceIndexBuffer: WebGPUBufferLike,
    ) {
        if (maxWorkItems < 0 || maxModelJobs < 0) {
            throw new RangeError("Face-priority sort capacities must be non-negative");
        }
        this.shared = getSharedSortPipeline(device);
        this.sortWorkItemBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-sort-work-items`,
            size: Math.max(8, maxWorkItems * 8),
            usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        this.modelJobBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-sort-model-jobs`,
            size: Math.max(8, maxModelJobs * 8),
            usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        this.sortedIndexBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-exact-sorted-indices`,
            size: Math.max(4, maxWorkItems * 3 * 4),
            usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.INDEX,
        });
        this.uniformBuffer = device.createBuffer({
            label: `${labelPrefix}-face-priority-sort-uniforms`,
            size: WEBGPU_FACE_PRIORITY_SORT_UNIFORM_BYTES,
            usage: WEBGPU_BUFFER_USAGE.UNIFORM | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        this.bindGroup = device.createBindGroup({
            label: `${labelPrefix}-face-priority-sort-bind-group`,
            layout: this.shared.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: depthWorkItemBuffer } },
                { binding: 1, resource: { buffer: this.sortWorkItemBuffer } },
                { binding: 2, resource: { buffer: this.modelJobBuffer } },
                { binding: 3, resource: { buffer: faceDepthBuffer } },
                { binding: 4, resource: { buffer: priorityBuffer } },
                { binding: 5, resource: { buffer: sourceIndexBuffer } },
                { binding: 6, resource: { buffer: this.sortedIndexBuffer } },
                { binding: 7, resource: { buffer: this.uniformBuffer } },
            ],
        });
    }

    prepare(batch: WebGPUFacePriorityDepthJobBatch): number {
        const workItemCount = batch.workItems.length >>> 1;
        if (workItemCount > this.maxWorkItems) {
            throw new Error(
                `Face-priority sort batch has ${workItemCount} work items, capacity is ${this.maxWorkItems}`,
            );
        }
        if (batch.modelJobs.length > this.maxModelJobs) {
            throw new Error(
                `Face-priority sort batch has ${batch.modelJobs.length} model jobs, capacity is ${this.maxModelJobs}`,
            );
        }
        const metadata = createWebGPUFacePrioritySortMetadata(batch);
        this.workItemCount = workItemCount;
        if (metadata.workItems.byteLength > 0) {
            this.device.queue.writeBuffer(this.sortWorkItemBuffer, 0, metadata.workItems);
        }
        if (metadata.modelJobs.byteLength > 0) {
            this.device.queue.writeBuffer(this.modelJobBuffer, 0, metadata.modelJobs);
        }
        const uniformData = new Uint32Array(4);
        uniformData[0] = workItemCount;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        return workItemCount;
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
            label: "face-priority-sort-pass",
        });
        pass.setPipeline(this.shared.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.workItemCount / WEBGPU_FACE_PRIORITY_SORT_WORKGROUP_SIZE),
        );
        pass.end();
        return this.workItemCount;
    }

    dispose(): void {
        this.sortWorkItemBuffer.destroy?.();
        this.modelJobBuffer.destroy?.();
        this.sortedIndexBuffer.destroy?.();
        this.uniformBuffer.destroy?.();
        this.workItemCount = 0;
    }
}

/**
 * Prepare both stages against one immutable job batch. The sort stage consumes
 * the exact same work-item order that the depth stage writes.
 */
export function prepareWebGPUFacePriorityDepthAndSort(
    depth: WebGPUFacePriorityDepthComputeResources,
    sort: WebGPUFacePrioritySortComputeResources,
    batch: WebGPUFacePriorityDepthJobBatch,
    transform: ArrayLike<number>,
    borderSize: number,
): number {
    const depthCount = depth.prepare(batch, transform, borderSize);
    const sortCount = sort.prepare(batch);
    if (depthCount !== sortCount) {
        throw new Error(
            `Face-priority compute stage mismatch: depth=${depthCount}, sort=${sortCount}`,
        );
    }
    return depthCount;
}

/** Encode depth first and sort second in the same command encoder. */
export function encodeWebGPUFacePriorityDepthAndSort(
    commandEncoder: WebGPUCommandEncoderLike,
    depth: Pick<WebGPUFacePriorityDepthComputeResources, "encode">,
    sort: Pick<WebGPUFacePrioritySortComputeResources, "encode">,
): number {
    const depthCount = depth.encode(commandEncoder);
    const sortCount = sort.encode(commandEncoder);
    if (depthCount !== sortCount) {
        throw new Error(
            `Face-priority compute dispatch mismatch: depth=${depthCount}, sort=${sortCount}`,
        );
    }
    return sortCount;
}
