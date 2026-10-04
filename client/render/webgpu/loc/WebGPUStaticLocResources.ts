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
    sourceIndices: number[];
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
    readonly drawsBySourceIndex: Array<WebGPUStaticLocDrawPlanEntry | undefined>;
}

export interface WebGPUAnimatedLocState {
    readonly frame: number;
    readonly anim: {
        readonly frames: readonly DrawRange[];
        readonly framesAlpha?: readonly DrawRange[];
    };
    getDrawRangeIndex(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): number;
}

const EMPTY_DRAWS: WebGPUStaticLocDrawPlanEntry[] = [];
const LOC_RESOURCES_BY_DEVICE = new WeakMap<object, Map<number, WebGPUStaticLocResources>>();

function mapId(mapX: number, mapY: number): number {
    return (((mapX | 0) & 0xffff) << 16) | ((mapY | 0) & 0xffff);
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

export function createWebGPUStaticLocPlanFromData(
    modelData: Uint16Array,
    drawRanges: readonly DrawRange[],
    drawRangesPlanes?: Uint8Array,
): WebGPUStaticLocPlan {
    const draws: WebGPUStaticLocDrawPlanEntry[] = [];
    const sourceIndices: number[] = [];
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
        const instanceCount = Math.max(0, range[2] | 0);
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Loc index byte offset must be 4-byte aligned: ${byteOffset}`);
        }

        const encodedInstance = modelData[i * 4] | 0;
        const firstInstance = encodedInstance - drawCount;
        if (firstInstance < 0) {
            if (indexCount <= 0 || instanceCount <= 0) {
                continue;
            }
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
        sourceIndices.push(i);
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

    return { draws, sourceIndices, modelInfoWords };
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
    const drawsBySourceIndex: Array<WebGPUStaticLocDrawPlanEntry | undefined> =
        new Array(drawRanges.length);
    for (let i = 0; i < plan.draws.length; i++) {
        drawsBySourceIndex[plan.sourceIndices[i]] = plan.draws[i];
    }

    return {
        modelInfoBuffer,
        bindGroup,
        draws: plan.draws,
        drawsBySourceIndex,
    };
}

export function applyWebGPUAnimatedLocDrawRanges(
    pass: WebGPUStaticLocPassResources | undefined,
    locsAnimated: readonly WebGPUAnimatedLocState[],
    transparent: boolean,
    lod: boolean,
): number {
    if (!pass || locsAnimated.length === 0) {
        return 0;
    }

    let updated = 0;
    for (const loc of locsAnimated) {
        const frames = transparent ? loc.anim.framesAlpha : loc.anim.frames;
        if (!frames) {
            continue;
        }
        const frame = frames[loc.frame | 0];
        if (!frame) {
            continue;
        }

        const sourceIndex = loc.getDrawRangeIndex(transparent, false, lod);
        if (sourceIndex < 0 || sourceIndex >= pass.drawsBySourceIndex.length) {
            continue;
        }
        const draw = pass.drawsBySourceIndex[sourceIndex];
        if (!draw) {
            continue;
        }

        const byteOffset = frame[0] | 0;
        if ((byteOffset & 3) !== 0) {
            throw new Error(
                `Animated loc index byte offset must be 4-byte aligned: ${byteOffset}`,
            );
        }
        draw.firstIndex = byteOffset >>> 2;
        draw.indexCount = Math.max(0, frame[1] | 0);
        draw.instanceCount = Math.max(0, frame[2] | 0);
        updated++;
    }
    return updated;
}

export function syncWebGPUAnimatedLocsForMap(
    device: WebGPUDeviceLike | undefined,
    mapX: number,
    mapY: number,
    locsAnimated: readonly WebGPUAnimatedLocState[],
    lod: boolean,
): number {
    if (!device || locsAnimated.length === 0) {
        return 0;
    }
    const resources = LOC_RESOURCES_BY_DEVICE.get(device as object)?.get(mapId(mapX, mapY));
    if (!resources) {
        return 0;
    }
    return (
        applyWebGPUAnimatedLocDrawRanges(resources.getPass(false, lod), locsAnimated, false, lod) +
        applyWebGPUAnimatedLocDrawRanges(resources.getPass(true, lod), locsAnimated, true, lod)
    );
}

export class WebGPUStaticLocResources {
    readonly vertexBuffer: WebGPUBufferLike;
    readonly indexBuffer: WebGPUBufferLike;
    readonly heightMap: WebGPUHeightMapResources;
    readonly opaque?: WebGPUStaticLocPassResources;
    readonly alpha?: WebGPUStaticLocPassResources;
    readonly lod?: WebGPUStaticLocPassResources;
    readonly lodAlpha?: WebGPUStaticLocPassResources;

    private readonly registryDevice?: WebGPUDeviceLike;
    private readonly registryMapId?: number;

    constructor(
        device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
        mapX: number,
        mapY: number,
        geometry: LocGeometryData,
        heightMapSize: number,
        heightMapTextureData: Int16Array,
        registerForAnimation: boolean = true,
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

        if (registerForAnimation) {
            const id = mapId(mapX, mapY);
            let registry = LOC_RESOURCES_BY_DEVICE.get(device as object);
            if (!registry) {
                registry = new Map();
                LOC_RESOURCES_BY_DEVICE.set(device as object, registry);
            }
            registry.set(id, this);
            this.registryDevice = device;
            this.registryMapId = id;
        }
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
        if (this.registryDevice && this.registryMapId !== undefined) {
            const registry = LOC_RESOURCES_BY_DEVICE.get(this.registryDevice as object);
            if (registry?.get(this.registryMapId) === this) {
                registry.delete(this.registryMapId);
            }
        }
        this.vertexBuffer.destroy?.();
        this.indexBuffer.destroy?.();
        for (const pass of [this.opaque, this.alpha, this.lod, this.lodAlpha]) {
            pass?.modelInfoBuffer.destroy?.();
            if (pass) {
                pass.draws.length = 0;
                pass.drawsBySourceIndex.length = 0;
            }
        }
        this.heightMap.dispose();
    }
}
