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

export type WebGPUStaticLocPassKind = "opaque" | "alpha" | "lod" | "lodAlpha";

export interface WebGPUStaticLocPassResources {
    readonly modelInfoBuffer: WebGPUBufferLike;
    readonly bindGroup: WebGPUBindGroupLike;
    readonly draws: WebGPUStaticLocDrawPlanEntry[];
}

const EMPTY_DRAWS: WebGPUStaticLocDrawPlanEntry[] = [];

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

export function createWebGPUStaticLocPlanFromData(
    modelData: Uint16Array,
    drawRanges: readonly DrawRange[],
    drawRangesPlanes?: Uint8Array,
): WebGPUStaticLocPlan {
    const draws: WebGPUStaticLocDrawPlanEntry[] = [];
    const drawCount = drawRanges.length;
    const headerWords = drawCount * 4;

    if (modelData.length < headerWords) {
        throw new Error(
            `Loc model-info data is missing draw headers: expected at least ${headerWords} words, got ${modelData.length}`,
        );
    }

    let maxInstance = 0;
    for (let i = 0; i < drawCount; i++) {
        const range = drawRanges[i];
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
            plane: drawRangesPlanes?.[i] ?? 0,
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

export function createWebGPUStaticLocPlan(
    geometry: WebGPUStaticLocGeometryData,
): WebGPUStaticLocPlan {
    return createWebGPUStaticLocPlanFromData(
        geometry.modelTextureData,
        geometry.drawRanges,
        geometry.drawRangesPlanes,
    );
}

function createPassResources(
    device: WebGPUDeviceLike,
    bindGroupLayout: WebGPUBindGroupLayoutLike,
    heightMapView: unknown,
    mapX: number,
    mapY: number,
    kind: WebGPUStaticLocPassKind,
    modelTextureData: Uint16Array,
    drawRanges: readonly DrawRange[],
    drawRangesPlanes: Uint8Array,
): WebGPUStaticLocPassResources | undefined {
    const plan = createWebGPUStaticLocPlanFromData(
        modelTextureData,
        drawRanges,
        drawRangesPlanes,
    );
    if (plan.draws.length === 0) {
        return undefined;
    }

    const modelInfoBuffer = createUploadedBuffer(
        device,
        `loc-${mapX}-${mapY}-${kind}-model-info`,
        WEBGPU_BUFFER_USAGE.STORAGE,
        plan.modelInfoWords,
    );
    const bindGroup = device.createBindGroup({
        label: `loc-${mapX}-${mapY}-${kind}-bind-group`,
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: heightMapView },
            { binding: 1, resource: { buffer: modelInfoBuffer } },
        ],
    });

    return {
        modelInfoBuffer,
        bindGroup,
        draws: plan.draws,
    };
}

export class WebGPUStaticLocResources {
    readonly vertexBuffer: WebGPUBufferLike;
    readonly indexBuffer: WebGPUBufferLike;
    readonly heightMap: WebGPUHeightMapResources;
    readonly opaque?: WebGPUStaticLocPassResources;
    readonly alpha?: WebGPUStaticLocPassResources;
    readonly lod?: WebGPUStaticLocPassResources;
    readonly lodAlpha?: WebGPUStaticLocPassResources;

    constructor(
        device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
        mapX: number,
        mapY: number,
        geometry: LocGeometryData,
        heightMapSize: number,
        heightMapTextureData: Int16Array,
    ) {
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
        this.heightMap = new WebGPUHeightMapResources(
            device,
            heightMapSize,
            heightMapTextureData,
        );

        const heightMapView = this.heightMap.texture.createView({
            dimension: "2d-array",
            baseArrayLayer: 0,
            arrayLayerCount: WEBGPU_HEIGHT_MAP_LAYERS,
        });

        this.opaque = createPassResources(
            device,
            bindGroupLayout,
            heightMapView,
            mapX,
            mapY,
            "opaque",
            geometry.modelTextureData,
            geometry.drawRanges,
            geometry.drawRangesPlanes,
        );
        this.alpha = createPassResources(
            device,
            bindGroupLayout,
            heightMapView,
            mapX,
            mapY,
            "alpha",
            geometry.modelTextureDataAlpha,
            geometry.drawRangesAlpha,
            geometry.drawRangesAlphaPlanes,
        );
        this.lod = createPassResources(
            device,
            bindGroupLayout,
            heightMapView,
            mapX,
            mapY,
            "lod",
            geometry.modelTextureDataLod,
            geometry.drawRangesLod,
            geometry.drawRangesLodPlanes,
        );
        this.lodAlpha = createPassResources(
            device,
            bindGroupLayout,
            heightMapView,
            mapX,
            mapY,
            "lodAlpha",
            geometry.modelTextureDataLodAlpha,
            geometry.drawRangesLodAlpha,
            geometry.drawRangesLodAlphaPlanes,
        );
    }

    /** Backward-compatible ordinary opaque access used by the first loc checkpoint. */
    get draws(): WebGPUStaticLocDrawPlanEntry[] {
        return this.opaque?.draws ?? EMPTY_DRAWS;
    }

    /** Backward-compatible ordinary opaque access used by the first loc checkpoint. */
    get bindGroup(): WebGPUBindGroupLike {
        if (!this.opaque) {
            throw new Error("Opaque static-loc resources are unavailable");
        }
        return this.opaque.bindGroup;
    }

    getPass(transparent: boolean, lod: boolean): WebGPUStaticLocPassResources | undefined {
        if (lod) {
            return transparent ? this.lodAlpha : this.lod;
        }
        return transparent ? this.alpha : this.opaque;
    }

    dispose(): void {
        this.vertexBuffer.destroy?.();
        this.indexBuffer.destroy?.();
        for (const pass of [this.opaque, this.alpha, this.lod, this.lodAlpha]) {
            pass?.modelInfoBuffer.destroy?.();
            if (pass) {
                pass.draws.length = 0;
            }
        }
        this.heightMap.dispose();
    }
}
