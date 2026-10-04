import type { DrawRange } from "../../DrawRange";
import type { SdMapData } from "../../loader/SdMapData";
import {
    WEBGPU_BUFFER_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUWaterMaskResources } from "./WebGPUWaterMaskResources";

export const WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET = 8;
export const WEBGPU_MAP_UNIFORM_TRANSFORM_BYTE_OFFSET =
    WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET * 4;
export const WEBGPU_MAP_UNIFORM_FLOATS = 24;

const IDENTITY_WORLD_ENTITY_TRANSFORM = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

const TERRAIN_RESOURCES_BY_DEVICE = new WeakMap<
    object,
    Map<number, WebGPUTerrainMapResources>
>();

function terrainResourceMapId(mapX: number, mapY: number): number {
    return (((mapX | 0) & 0xffff) << 16) | ((mapY | 0) & 0xffff);
}

export interface WebGPUTerrainDrawPlanEntry {
    firstIndex: number;
    indexCount: number;
    instanceCount: number;
    plane: number;
}

export interface WebGPUTerrainDrawPlan {
    mapX: number;
    mapY: number;
    renderPosX: number;
    renderPosY: number;
    draws: WebGPUTerrainDrawPlanEntry[];
    alphaDraws: WebGPUTerrainDrawPlanEntry[];
    lodDraws: WebGPUTerrainDrawPlanEntry[];
    lodAlphaDraws: WebGPUTerrainDrawPlanEntry[];
}

export type WebGPUTerrainUploadData = Pick<
    SdMapData,
    | "mapX"
    | "mapY"
    | "renderPosX"
    | "renderPosY"
    | "vertices"
    | "indices"
    | "drawRanges"
    | "drawRangesPlanes"
    | "borderSize"
    | "heightMapSize"
    | "waterMaskTextureData"
> &
    Partial<
        Pick<
            SdMapData,
            | "drawRangesAlpha"
            | "drawRangesAlphaPlanes"
            | "drawRangesLod"
            | "drawRangesLodPlanes"
            | "drawRangesLodAlpha"
            | "drawRangesLodAlphaPlanes"
        >
    >;

function appendDrawPlan(
    output: WebGPUTerrainDrawPlanEntry[],
    ranges: readonly DrawRange[],
    planes: Uint8Array | undefined,
): void {
    for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        const byteOffset = range[0] | 0;
        const indexCount = range[1] | 0;
        const instanceCount = Math.max(1, range[2] | 0);
        if (indexCount <= 0) {
            continue;
        }
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Terrain index byte offset must be 4-byte aligned: ${byteOffset}`);
        }

        output.push({
            firstIndex: byteOffset >>> 2,
            indexCount,
            instanceCount,
            plane: planes?.[i] ?? 0,
        });
    }
}

export function createWebGPUTerrainDrawPlan(
    data: WebGPUTerrainUploadData,
): WebGPUTerrainDrawPlan {
    const draws: WebGPUTerrainDrawPlanEntry[] = [];
    const alphaDraws: WebGPUTerrainDrawPlanEntry[] = [];
    const lodDraws: WebGPUTerrainDrawPlanEntry[] = [];
    const lodAlphaDraws: WebGPUTerrainDrawPlanEntry[] = [];

    appendDrawPlan(draws, data.drawRanges, data.drawRangesPlanes);
    appendDrawPlan(
        alphaDraws,
        data.drawRangesAlpha ?? [],
        data.drawRangesAlphaPlanes,
    );
    appendDrawPlan(
        lodDraws,
        data.drawRangesLod ?? [],
        data.drawRangesLodPlanes,
    );
    appendDrawPlan(
        lodAlphaDraws,
        data.drawRangesLodAlpha ?? [],
        data.drawRangesLodAlphaPlanes,
    );

    return {
        mapX: data.mapX | 0,
        mapY: data.mapY | 0,
        renderPosX: data.renderPosX ?? data.mapX,
        renderPosY: data.renderPosY ?? data.mapY,
        draws,
        alphaDraws,
        lodDraws,
        lodAlphaDraws,
    };
}

export function createWebGPUMapUniformData(
    mapX: number,
    mapY: number,
    plane: number,
    loadTime: number,
    borderSize: number,
): Float32Array {
    const data = new Float32Array(WEBGPU_MAP_UNIFORM_FLOATS);
    data[0] = mapX;
    data[1] = mapY;
    data[2] = plane;
    data[3] = loadTime;
    data[4] = borderSize;
    data.set(IDENTITY_WORLD_ENTITY_TRANSFORM, WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET);
    return data;
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

export interface WebGPUTerrainDrawResources extends WebGPUTerrainDrawPlanEntry {
    mapUniformBuffer: WebGPUBufferLike;
    mapBindGroup: WebGPUBindGroupLike;
}

export function syncWebGPUWorldEntityTransformForMap(
    device: WebGPUDeviceLike | undefined,
    mapX: number,
    mapY: number,
    transform: Float32Array,
): boolean {
    if (!device || transform.length < 16) {
        return false;
    }
    const resources = TERRAIN_RESOURCES_BY_DEVICE
        .get(device as object)
        ?.get(terrainResourceMapId(mapX, mapY));
    return resources?.updateWorldEntityTransform(transform) ?? false;
}

export class WebGPUTerrainMapResources {
    readonly plan: WebGPUTerrainDrawPlan;
    readonly vertexBuffer: WebGPUBufferLike;
    readonly indexBuffer: WebGPUBufferLike;
    readonly waterMask: WebGPUWaterMaskResources;
    readonly sharedMapUniformBuffer: WebGPUBufferLike;
    readonly sharedMapBindGroup: WebGPUBindGroupLike;
    readonly draws: WebGPUTerrainDrawResources[];
    readonly alphaDraws: WebGPUTerrainDrawResources[];
    readonly lodDraws: WebGPUTerrainDrawResources[];
    readonly lodAlphaDraws: WebGPUTerrainDrawResources[];

    private readonly worldEntityTransform = new Float32Array(
        IDENTITY_WORLD_ENTITY_TRANSFORM,
    );
    private readonly registryMapId: number;

    constructor(
        private readonly device: WebGPUDeviceLike,
        mapBindGroupLayout: WebGPUBindGroupLayoutLike,
        data: WebGPUTerrainUploadData,
        loadTime: number,
    ) {
        this.plan = createWebGPUTerrainDrawPlan(data);
        this.registryMapId = terrainResourceMapId(this.plan.mapX, this.plan.mapY);

        this.vertexBuffer = createUploadedBuffer(
            device,
            `terrain-${this.plan.mapX}-${this.plan.mapY}-vertices`,
            WEBGPU_BUFFER_USAGE.VERTEX,
            data.vertices,
        );
        this.indexBuffer = createUploadedBuffer(
            device,
            `terrain-${this.plan.mapX}-${this.plan.mapY}-indices`,
            WEBGPU_BUFFER_USAGE.INDEX,
            new Uint8Array(data.indices.buffer, data.indices.byteOffset, data.indices.byteLength),
        );
        this.waterMask = new WebGPUWaterMaskResources(
            device,
            data.heightMapSize,
            data.waterMaskTextureData,
        );
        const waterMaskView = this.waterMask.texture.createView({
            dimension: "2d-array",
            baseArrayLayer: 0,
            arrayLayerCount: 4,
        });
        const sharedMapUniformData = createWebGPUMapUniformData(
            this.plan.renderPosX,
            this.plan.renderPosY,
            0,
            loadTime,
            data.borderSize,
        );
        this.sharedMapUniformBuffer = createUploadedBuffer(
            device,
            `terrain-${this.plan.mapX}-${this.plan.mapY}-shared-map-uniforms`,
            WEBGPU_BUFFER_USAGE.UNIFORM,
            sharedMapUniformData,
        );
        this.sharedMapBindGroup = device.createBindGroup({
            label: `terrain-${this.plan.mapX}-${this.plan.mapY}-shared-map-bind-group`,
            layout: mapBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.sharedMapUniformBuffer } },
                { binding: 1, resource: waterMaskView },
            ],
        });

        const createDrawResources = (
            draws: readonly WebGPUTerrainDrawPlanEntry[],
            passLabel: string,
        ): WebGPUTerrainDrawResources[] =>
            draws.map((draw, index) => {
                const uniformData = createWebGPUMapUniformData(
                    this.plan.renderPosX,
                    this.plan.renderPosY,
                    draw.plane,
                    loadTime,
                    data.borderSize,
                );
                const mapUniformBuffer = createUploadedBuffer(
                    device,
                    `terrain-${this.plan.mapX}-${this.plan.mapY}-${passLabel}-draw-${index}-uniforms`,
                    WEBGPU_BUFFER_USAGE.UNIFORM,
                    uniformData,
                );
                const mapBindGroup = device.createBindGroup({
                    label: `terrain-${this.plan.mapX}-${this.plan.mapY}-${passLabel}-draw-${index}-bind-group`,
                    layout: mapBindGroupLayout,
                    entries: [
                        { binding: 0, resource: { buffer: mapUniformBuffer } },
                        { binding: 1, resource: waterMaskView },
                    ],
                });

                return {
                    ...draw,
                    mapUniformBuffer,
                    mapBindGroup,
                };
            });

        this.draws = createDrawResources(this.plan.draws, "opaque");
        this.alphaDraws = createDrawResources(this.plan.alphaDraws, "alpha");
        this.lodDraws = createDrawResources(this.plan.lodDraws, "lod-opaque");
        this.lodAlphaDraws = createDrawResources(
            this.plan.lodAlphaDraws,
            "lod-alpha",
        );

        let registry = TERRAIN_RESOURCES_BY_DEVICE.get(device as object);
        if (!registry) {
            registry = new Map();
            TERRAIN_RESOURCES_BY_DEVICE.set(device as object, registry);
        }
        registry.set(this.registryMapId, this);
    }

    updateWorldEntityTransform(transform: Float32Array): boolean {
        let changed = false;
        for (let i = 0; i < 16; i++) {
            const value = transform[i];
            if (this.worldEntityTransform[i] !== value) {
                changed = true;
            }
            this.worldEntityTransform[i] = value;
        }
        if (!changed) {
            return false;
        }

        const writeTransform = (buffer: WebGPUBufferLike) => {
            this.device.queue.writeBuffer(
                buffer,
                WEBGPU_MAP_UNIFORM_TRANSFORM_BYTE_OFFSET,
                this.worldEntityTransform,
            );
        };
        writeTransform(this.sharedMapUniformBuffer);
        for (const draws of [
            this.draws,
            this.alphaDraws,
            this.lodDraws,
            this.lodAlphaDraws,
        ]) {
            for (const draw of draws) {
                writeTransform(draw.mapUniformBuffer);
            }
        }
        return true;
    }

    dispose(): void {
        const registry = TERRAIN_RESOURCES_BY_DEVICE.get(this.device as object);
        if (registry?.get(this.registryMapId) === this) {
            registry.delete(this.registryMapId);
        }

        this.vertexBuffer.destroy?.();
        this.indexBuffer.destroy?.();
        this.waterMask.dispose();
        this.sharedMapUniformBuffer.destroy?.();
        for (const draws of [
            this.draws,
            this.alphaDraws,
            this.lodDraws,
            this.lodAlphaDraws,
        ]) {
            for (const draw of draws) {
                draw.mapUniformBuffer.destroy?.();
            }
            draws.length = 0;
        }
    }
}
