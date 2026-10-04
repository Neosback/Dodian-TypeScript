import type { DrawRange } from "../../DrawRange";
import type { LocGeometryData } from "../../loader/SdMapData";
import {
    WEBGPU_BUFFER_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
} from "../../backend/WebGPUPlatform";
import {
    WEBGPU_HEIGHT_MAP_LAYERS,
    WebGPUHeightMapResources,
} from "./WebGPUHeightMapResources";

export interface WebGPUStaticLocDrawPlanEntry {
    firstIndex: number;
    indexCount: number;
    instanceCount: number;
    firstInstance: number;
    plane: number;
}

export interface WebGPUStaticLocPlan {
    draws: WebGPUStaticLocDrawPlanEntry[];
    modelInfoWords: Uint32Array;
}

export type WebGPUStaticLocGeometryData = Pick<
    LocGeometryData,
    | "vertices"
    | "indices"
    | "modelTextureData"
    | "drawRanges"
    | "drawRangesPlanes"
>;

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

export function createWebGPUStaticLocPlan(
    geometry: WebGPUStaticLocGeometryData,
): WebGPUStaticLocPlan {
    const draws: WebGPUStaticLocDrawPlanEntry[] = [];
    const drawCount = geometry.drawRanges.length;
    const modelData = geometry.modelTextureData;
    const headerWords = drawCount * 4;

    if (modelData.length < headerWords) {
        throw new Error(
            `Loc model-info data is missing draw headers: expected at least ${headerWords} words, got ${modelData.length}`,
        );
    }

    let maxInstance = 0;
    for (let i = 0; i < drawCount; i++) {
        const range: DrawRange = geometry.drawRanges[i];
        const byteOffset = range[0] | 0;
        const indexCount = range[1] | 0;
        const instanceCount = Math.max(1, range[2] | 0);
        if (indexCount <= 0) {
            continue;
        }
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Loc index byte offset must be 4-byte aligned: ${byteOffset}`);
        }

        const firstInstance = (modelData[i * 4] | 0) - drawCount;
        if (firstInstance < 0) {
            throw new Error(
                `Loc model-info draw ${i} has invalid first instance ${firstInstance}`,
            );
        }
        maxInstance = Math.max(maxInstance, firstInstance + instanceCount);

        draws.push({
            firstIndex: byteOffset >>> 2,
            indexCount,
            instanceCount,
            firstInstance,
            plane: geometry.drawRangesPlanes[i] ?? 0,
        });
    }

    const requiredWords = (drawCount + maxInstance) * 4;
    if (modelData.length < requiredWords) {
        throw new Error(
            `Loc model-info data is truncated: expected at least ${requiredWords} words, got ${modelData.length}`,
        );
    }

    const modelInfoWords = new Uint32Array(Math.max(4, maxInstance * 4));
    for (let i = 0; i < maxInstance * 4; i++) {
        modelInfoWords[i] = modelData[headerWords + i] ?? 0;
    }

    return { draws, modelInfoWords };
}

export class WebGPUStaticLocResources {
    readonly vertexBuffer: WebGPUBufferLike;
    readonly indexBuffer: WebGPUBufferLike;
    readonly modelInfoBuffer: WebGPUBufferLike;
    readonly heightMap: WebGPUHeightMapResources;
    readonly bindGroup: WebGPUBindGroupLike;
    readonly draws: WebGPUStaticLocDrawPlanEntry[];

    constructor(
        device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
        mapX: number,
        mapY: number,
        geometry: WebGPUStaticLocGeometryData,
        heightMapSize: number,
        heightMapTextureData: Int16Array,
    ) {
        const plan = createWebGPUStaticLocPlan(geometry);
        this.draws = plan.draws;

        this.vertexBuffer = createUploadedBuffer(
            device,
            `loc-${mapX}-${mapY}-vertices`,
            WEBGPU_BUFFER_USAGE.VERTEX,
            geometry.vertices,
        );
        this.indexBuffer = createUploadedBuffer(
            device,
            `loc-${mapX}-${mapY}-indices`,
            WEBGPU_BUFFER_USAGE.INDEX,
            new Uint8Array(
                geometry.indices.buffer,
                geometry.indices.byteOffset,
                geometry.indices.byteLength,
            ),
        );
        this.modelInfoBuffer = createUploadedBuffer(
            device,
            `loc-${mapX}-${mapY}-model-info`,
            WEBGPU_BUFFER_USAGE.STORAGE,
            plan.modelInfoWords,
        );
        this.heightMap = new WebGPUHeightMapResources(
            device,
            heightMapSize,
            heightMapTextureData,
        );

        this.bindGroup = device.createBindGroup({
            label: `loc-${mapX}-${mapY}-bind-group`,
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.heightMap.texture.createView({
                        dimension: "2d-array",
                        baseArrayLayer: 0,
                        arrayLayerCount: WEBGPU_HEIGHT_MAP_LAYERS,
                    }),
                },
                { binding: 1, resource: { buffer: this.modelInfoBuffer } },
            ],
        });
    }

    dispose(): void {
        this.vertexBuffer.destroy?.();
        this.indexBuffer.destroy?.();
        this.modelInfoBuffer.destroy?.();
        this.heightMap.dispose();
        this.draws.length = 0;
    }
}
