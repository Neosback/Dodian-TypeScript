import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type {
    WebGPUBufferLike,
    WebGPUCommandEncoderLike,
} from "../../backend/WebGPUPlatform";
import type { WebGPUTerrainMapResources } from "../terrain/WebGPUTerrainMapResources";
import {
    WebGPUFacePriorityDepthComputeResources,
    createWebGPUFacePriorityDepthJobs,
    type WebGPUFacePriorityDepthDrawLike,
} from "./WebGPUFacePriorityDepthCompute";
import {
    WebGPUFacePrioritySortComputeResources,
    createWebGPUFacePrioritySortedDrawRanges,
    encodeWebGPUFacePriorityDepthAndSort,
    prepareWebGPUFacePriorityDepthAndSort,
} from "./WebGPUFacePrioritySortCompute";
import type { WebGPUFacePrioritySortResources } from "./WebGPUFacePrioritySortResources";
import type { WebGPUHeightMapResources } from "./WebGPUHeightMapResources";
import type {
    WebGPUStaticLocDrawPlanEntry,
    WebGPUStaticLocPassResources,
} from "./WebGPUStaticLocResources";

export interface WebGPUFacePriorityPreparedPass {
    readonly indexBuffer: WebGPUBufferLike;
    readonly draws: WebGPUStaticLocDrawPlanEntry[];
    readonly workItemCount: number;
    readonly modelJobCount: number;
}

export interface WebGPUFacePriorityExpandableDraws {
    readonly draws: WebGPUStaticLocDrawPlanEntry[];
    readonly sourceDrawIndices: number[];
}

type PassRuntime = {
    workItemCapacity: number;
    modelJobCapacity: number;
    depth: WebGPUFacePriorityDepthComputeResources;
    sort: WebGPUFacePrioritySortComputeResources;
};

const PASS_RUNTIMES = new WeakMap<
    object,
    Map<object, PassRuntime>
>();
const REGISTERED_DISPOSERS = new WeakSet<object>();

const IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

function nextCapacity(required: number): number {
    const value = Math.max(1, required | 0);
    return 2 ** Math.ceil(Math.log2(value));
}

function multiplyMat4(
    out: Float32Array,
    a: ArrayLike<number>,
    b: ArrayLike<number>,
): Float32Array {
    for (let column = 0; column < 4; column++) {
        const b0 = b[column * 4];
        const b1 = b[column * 4 + 1];
        const b2 = b[column * 4 + 2];
        const b3 = b[column * 4 + 3];
        out[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        out[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        out[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
}

function getWorldEntityTransform(map: WebGPUTerrainMapResources): ArrayLike<number> {
    // WebGPUTerrainMapResources retains the authoritative CPU matrix so it can
    // update only the transform bytes of its map uniforms. TypeScript's
    // `private` field is intentionally read through this narrow structural view
    // so face-depth compute uses the exact same view -> world-entity transform
    // order as the live static-scene vertex shader without duplicating state.
    return (
        map as unknown as { worldEntityTransform?: Float32Array }
    ).worldEntityTransform ?? IDENTITY_MATRIX;
}

export function createWebGPUFacePriorityDepthTransform(
    frame: SceneFrameDescription,
    map: WebGPUTerrainMapResources,
    target: Float32Array = new Float32Array(16),
): Float32Array {
    return multiplyMat4(target, getWorldEntityTransform(map), frame.viewMatrix);
}

/**
 * Split instanced loc-like draws into one placed-model submission per instance.
 *
 * Exact face order can differ between two instances that share source geometry
 * because VERTEX contouring is evaluated at each placement. Expanding here also
 * gives delayed-wall ordering the correct placement metadata for every instance.
 */
export function expandWebGPUFacePriorityDrawInstances(
    draws: readonly WebGPUStaticLocDrawPlanEntry[],
    roofPlaneLimit: number,
): WebGPUFacePriorityExpandableDraws {
    const expanded: WebGPUStaticLocDrawPlanEntry[] = [];
    const sourceDrawIndices: number[] = [];

    for (let sourceDrawIndex = 0; sourceDrawIndex < draws.length; sourceDrawIndex++) {
        const draw = draws[sourceDrawIndex];
        if (
            draw.indexCount <= 0 ||
            draw.instanceCount <= 0 ||
            draw.plane > roofPlaneLimit
        ) {
            continue;
        }
        for (let instance = 0; instance < draw.instanceCount; instance++) {
            expanded.push({
                ...draw,
                instanceCount: 1,
                firstInstance: draw.firstInstance + instance,
            });
            sourceDrawIndices.push(sourceDrawIndex);
        }
    }

    return { draws: expanded, sourceDrawIndices };
}

function getRuntimeMap(
    sortResources: WebGPUFacePrioritySortResources,
): Map<object, PassRuntime> {
    let runtimes = PASS_RUNTIMES.get(sortResources as object);
    if (!runtimes) {
        runtimes = new Map<object, PassRuntime>();
        PASS_RUNTIMES.set(sortResources as object, runtimes);
    }
    if (!REGISTERED_DISPOSERS.has(sortResources as object)) {
        REGISTERED_DISPOSERS.add(sortResources as object);
        sortResources.registerDisposeCallback(() => {
            const active = PASS_RUNTIMES.get(sortResources as object);
            if (active) {
                for (const runtime of active.values()) {
                    runtime.depth.dispose();
                    runtime.sort.dispose();
                }
                active.clear();
            }
            PASS_RUNTIMES.delete(sortResources as object);
        });
    }
    return runtimes;
}

function ensurePassRuntime(
    sortResources: WebGPUFacePrioritySortResources,
    pass: WebGPUStaticLocPassResources,
    heightMap: WebGPUHeightMapResources,
    requiredWorkItems: number,
    requiredModelJobs: number,
): PassRuntime {
    const runtimes = getRuntimeMap(sortResources);
    const key = pass.modelInfoBuffer as object;
    const existing = runtimes.get(key);
    if (
        existing &&
        existing.workItemCapacity >= requiredWorkItems &&
        existing.modelJobCapacity >= requiredModelJobs
    ) {
        return existing;
    }

    existing?.depth.dispose();
    existing?.sort.dispose();

    const workItemCapacity = nextCapacity(requiredWorkItems);
    const modelJobCapacity = nextCapacity(requiredModelJobs);
    const heightMapView = heightMap.texture.createView({
        dimension: "2d-array",
        baseArrayLayer: 0,
        arrayLayerCount: 4,
    });
    const label = `${sortResources.labelPrefix}-pass-${runtimes.size}`;
    const depth = new WebGPUFacePriorityDepthComputeResources(
        sortResources.device,
        label,
        sortResources.vertices,
        workItemCapacity,
        sortResources.sourceIndexBuffer,
        heightMapView,
        pass.modelInfoBuffer,
    );
    const sort = new WebGPUFacePrioritySortComputeResources(
        sortResources.device,
        label,
        workItemCapacity,
        modelJobCapacity,
        depth.workItemBuffer,
        depth.faceDepthBuffer,
        sortResources.priorityBuffer,
        sortResources.sourceIndexBuffer,
    );
    const runtime: PassRuntime = {
        workItemCapacity,
        modelJobCapacity,
        depth,
        sort,
    };
    runtimes.set(key, runtime);
    return runtime;
}

/**
 * Prepare and encode exact depth + priority sorting for one static model pass.
 * The caller owns command submission so locs, ground items and doors for one
 * map/pass can share a single compute submission before the render command
 * buffer is eventually submitted.
 */
export function prepareWebGPUFacePriorityPass(
    commandEncoder: WebGPUCommandEncoderLike,
    frame: SceneFrameDescription,
    map: WebGPUTerrainMapResources,
    sortResources: WebGPUFacePrioritySortResources,
    heightMap: WebGPUHeightMapResources,
    pass: WebGPUStaticLocPassResources,
): WebGPUFacePriorityPreparedPass | undefined {
    const expanded = expandWebGPUFacePriorityDrawInstances(
        pass.draws,
        frame.roofPlaneLimit,
    );
    if (expanded.draws.length === 0) {
        return undefined;
    }

    const batch = createWebGPUFacePriorityDepthJobs(
        expanded.draws as readonly WebGPUFacePriorityDepthDrawLike[],
        sortResources.modelSpans,
    );
    const workItemCount = batch.workItems.length >>> 1;
    if (workItemCount === 0 || batch.modelJobs.length === 0) {
        return undefined;
    }

    const sortedRanges = createWebGPUFacePrioritySortedDrawRanges(
        expanded.draws,
        sortResources.modelSpans,
        batch,
    );
    const runtime = ensurePassRuntime(
        sortResources,
        pass,
        heightMap,
        workItemCount,
        batch.modelJobs.length,
    );
    const transform = createWebGPUFacePriorityDepthTransform(frame, map);
    prepareWebGPUFacePriorityDepthAndSort(
        runtime.depth,
        runtime.sort,
        batch,
        transform,
        map.plan.borderSize,
    );
    encodeWebGPUFacePriorityDepthAndSort(
        commandEncoder,
        runtime.depth,
        runtime.sort,
    );

    const draws = sortedRanges.map((range) => {
        const source = expanded.draws[range.sourceDrawIndex];
        if (!source) {
            throw new Error(
                `Face-priority sorted draw references missing expanded draw ${range.sourceDrawIndex}`,
            );
        }
        return {
            ...source,
            firstIndex: range.firstIndex,
            indexCount: range.indexCount,
            instanceCount: 1,
            firstInstance: range.firstInstance,
        } satisfies WebGPUStaticLocDrawPlanEntry;
    });

    return {
        indexBuffer: runtime.sort.sortedIndexBuffer,
        draws,
        workItemCount,
        modelJobCount: batch.modelJobs.length,
    };
}
