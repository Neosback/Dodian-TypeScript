import type { SceneFrameDescription } from "../frame/SceneFrameDescription";
import type { LocGeometryData, SdMapData } from "../loader/SdMapData";
import { WebGPUGraphicsBackend } from "../backend/WebGPUGraphicsBackend";
import {
    WEBGPU_SHADER_STAGE,
    WEBGPU_TEXTURE_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUDeviceLike,
    type WebGPURenderPassEncoderLike,
    type WebGPURenderPipelineLike,
    type WebGPUTextureLike,
} from "../backend/WebGPUPlatform";
import { getGroundItemGeometrySnapshot } from "../ground/GroundItemGeometrySnapshot";
import type { GroundItemGeometryBuildData } from "../ground/GroundItemMeshBuilder";
import type { WebGPUTerrainUploadData } from "./terrain/WebGPUTerrainMapResources";
import { WebGPUTerrainMapResources } from "./terrain/WebGPUTerrainMapResources";
import { WEBGPU_TERRAIN_SHADER } from "./terrain/WebGPUTerrainShader";
import {
    type WebGPUTerrainTextureSet,
    WebGPUTerrainTextureResources,
} from "./terrain/WebGPUTerrainTextureResources";
import { WebGPUSceneUniformBuffer } from "./WebGPUSceneUniforms";
import { WebGPUWaterResources } from "./terrain/WebGPUWaterResources";
import { WebGPUStaticDoorResources } from "./loc/WebGPUStaticDoorResources";
import { drawWebGPUOrderedStaticGeometry } from "./loc/WebGPUStaticLocDrawOrdering";
import { WebGPUStaticGroundItemResources } from "./ground/WebGPUStaticGroundItemResources";
import {
    type WebGPUStaticLocPassResources,
    WebGPUStaticLocResources,
} from "./loc/WebGPUStaticLocResources";

export type WebGPUTerrainPipelineVariant =
    | "opaque-cull"
    | "opaque-no-cull"
    | "alpha-cull"
    | "alpha-no-cull";

export function getWebGPUTerrainPipelineVariant(
    transparent: boolean,
    cullBackFace: boolean,
): WebGPUTerrainPipelineVariant {
    if (transparent) {
        return cullBackFace ? "alpha-cull" : "alpha-no-cull";
    }
    return cullBackFace ? "opaque-cull" : "opaque-no-cull";
}

interface GroundItemSnapshotMap {
    mapX: number;
    mapY: number;
    heightMapSize?: number;
    heightMapData?: Int16Array;
}

export class WebGPUStaticSceneRenderer {
    private device?: WebGPUDeviceLike;
    private sceneUniforms?: WebGPUSceneUniformBuffer;
    private sceneBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private mapBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private textureBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private waterBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private locBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private sceneBindGroup?: WebGPUBindGroupLike;
    private terrainTextures?: WebGPUTerrainTextureResources;
    private waterResources?: WebGPUWaterResources;
    private terrainOpaqueCullPipeline?: WebGPURenderPipelineLike;
    private terrainOpaqueNoCullPipeline?: WebGPURenderPipelineLike;
    private terrainAlphaCullPipeline?: WebGPURenderPipelineLike;
    private terrainAlphaNoCullPipeline?: WebGPURenderPipelineLike;
    private locOpaqueCullPipeline?: WebGPURenderPipelineLike;
    private locOpaqueNoCullPipeline?: WebGPURenderPipelineLike;
    private locAlphaCullPipeline?: WebGPURenderPipelineLike;
    private locAlphaNoCullPipeline?: WebGPURenderPipelineLike;
    private depthTexture?: WebGPUTextureLike;
    private depthWidth = 0;
    private depthHeight = 0;
    private mapsById = new Map<number, WebGPUTerrainMapResources>();
    private locsById = new Map<number, WebGPUStaticLocResources>();
    private groundItemsById = new Map<number, WebGPUStaticGroundItemResources>();
    private groundItemRevisionById = new Map<number, number>();
    private doorsById = new Map<number, WebGPUStaticDoorResources>();
    private mapOrder: number[] = [];
    private visibleMapOrder: number[] = [];
    private visibleMapLod: number[] = [];
    private visibilityFilterEnabled = false;

    constructor(readonly backend: WebGPUGraphicsBackend) {}

    private mapId(mapX: number, mapY: number): number {
        return (((mapX | 0) & 0xffff) << 16) | ((mapY | 0) & 0xffff);
    }

    private hasGeometryDraws(geometry: LocGeometryData): boolean {
        return (
            geometry.vertices.length > 0 &&
            geometry.indices.length > 0 &&
            [
                geometry.drawRanges,
                geometry.drawRangesAlpha,
                geometry.drawRangesLod,
                geometry.drawRangesLodAlpha,
            ].some((ranges) => ranges.length > 0)
        );
    }

    async init(canvas: HTMLCanvasElement): Promise<void> {
        if (!this.backend.initialized) {
            await this.backend.init();
        }
        const canvasResources = this.backend.configureCanvas(canvas, "opaque");
        const device = this.backend.device;
        if (!device) {
            throw new Error("WebGPU device unavailable after backend initialization");
        }
        this.device = device;

        const sceneBindGroupLayout = device.createBindGroupLayout({
            label: "scene-frame-bind-group-layout",
            entries: [
                {
                    binding: 0,
                    visibility: WEBGPU_SHADER_STAGE.VERTEX | WEBGPU_SHADER_STAGE.FRAGMENT,
                    buffer: { type: "uniform" },
                },
            ],
        });
        const mapBindGroupLayout = device.createBindGroupLayout({
            label: "terrain-map-bind-group-layout",
            entries: [
                {
                    binding: 0,
                    visibility: WEBGPU_SHADER_STAGE.VERTEX | WEBGPU_SHADER_STAGE.FRAGMENT,
                    buffer: { type: "uniform" },
                },
                {
                    binding: 1,
                    visibility: WEBGPU_SHADER_STAGE.FRAGMENT,
                    texture: {
                        sampleType: "float",
                        viewDimension: "2d-array",
                        multisampled: false,
                    },
                },
            ],
        });
        const textureBindGroupLayout = device.createBindGroupLayout({
            label: "terrain-texture-bind-group-layout",
            entries: [
                {
                    binding: 0,
                    visibility: WEBGPU_SHADER_STAGE.VERTEX | WEBGPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "float", viewDimension: "2d" },
                },
                {
                    binding: 1,
                    visibility: WEBGPU_SHADER_STAGE.VERTEX | WEBGPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "sint", viewDimension: "2d" },
                },
            ],
        });
        const waterBindGroupLayout = device.createBindGroupLayout({
            label: "water-aux-bind-group-layout",
            entries: [
                {
                    binding: 0,
                    visibility: WEBGPU_SHADER_STAGE.FRAGMENT,
                    sampler: { type: "filtering" },
                },
                {
                    binding: 1,
                    visibility: WEBGPU_SHADER_STAGE.FRAGMENT,
                    texture: {
                        sampleType: "float",
                        viewDimension: "2d-array",
                        multisampled: false,
                    },
                },
            ],
        });
        const locBindGroupLayout = device.createBindGroupLayout({
            label: "static-loc-bind-group-layout",
            entries: [
                {
                    binding: 0,
                    visibility: WEBGPU_SHADER_STAGE.VERTEX,
                    texture: {
                        sampleType: "sint",
                        viewDimension: "2d-array",
                        multisampled: false,
                    },
                },
                {
                    binding: 1,
                    visibility: WEBGPU_SHADER_STAGE.VERTEX,
                    buffer: { type: "read-only-storage" },
                },
            ],
        });

        const sceneUniforms = new WebGPUSceneUniformBuffer(device);
        const sceneBindGroup = device.createBindGroup({
            label: "scene-frame-bind-group",
            layout: sceneBindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: sceneUniforms.buffer } }],
        });

        const module = await this.backend.compileShaderModule(
            WEBGPU_TERRAIN_SHADER,
            "terrain-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "terrain-pipeline-layout",
            bindGroupLayouts: [
                sceneBindGroupLayout,
                mapBindGroupLayout,
                textureBindGroupLayout,
                waterBindGroupLayout,
            ],
        });
        const alphaBlend = {
            color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
            },
            alpha: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
            },
        };
        const createTerrainPipeline = (
            label: string,
            fragmentEntryPoint: "fsMain" | "fsMainAlpha",
            cullMode: "back" | "none",
            transparent: boolean,
        ): WebGPURenderPipelineLike =>
            device.createRenderPipeline({
                label,
                layout: pipelineLayout,
                vertex: {
                    module,
                    entryPoint: "vsMain",
                    buffers: [
                        {
                            arrayStride: 12,
                            stepMode: "vertex",
                            attributes: [
                                {
                                    shaderLocation: 0,
                                    offset: 0,
                                    format: "uint32x3",
                                },
                            ],
                        },
                    ],
                },
                fragment: {
                    module,
                    entryPoint: fragmentEntryPoint,
                    targets: [
                        transparent
                            ? { format: canvasResources.format, blend: alphaBlend }
                            : { format: canvasResources.format },
                    ],
                },
                primitive: {
                    topology: "triangle-list",
                    frontFace: "ccw",
                    cullMode,
                },
                depthStencil: {
                    format: "depth24plus",
                    // WebGL keeps depthMask(true) through its transparent scene pass.
                    depthWriteEnabled: true,
                    depthCompare: "less-equal",
                },
            });

        const terrainOpaqueCullPipeline = createTerrainPipeline(
            "terrain-opaque-cull-pipeline",
            "fsMain",
            "back",
            false,
        );
        const terrainOpaqueNoCullPipeline = createTerrainPipeline(
            "terrain-opaque-no-cull-pipeline",
            "fsMain",
            "none",
            false,
        );
        const terrainAlphaCullPipeline = createTerrainPipeline(
            "terrain-alpha-cull-pipeline",
            "fsMainAlpha",
            "back",
            true,
        );
        const terrainAlphaNoCullPipeline = createTerrainPipeline(
            "terrain-alpha-no-cull-pipeline",
            "fsMainAlpha",
            "none",
            true,
        );

        const locPipelineLayout = device.createPipelineLayout({
            label: "static-loc-pipeline-layout",
            bindGroupLayouts: [
                sceneBindGroupLayout,
                mapBindGroupLayout,
                textureBindGroupLayout,
                waterBindGroupLayout,
                locBindGroupLayout,
            ],
        });
        const createLocPipeline = (
            label: string,
            fragmentEntryPoint: "fsMain" | "fsMainAlpha",
            cullMode: "back" | "none",
            transparent: boolean,
        ): WebGPURenderPipelineLike =>
            device.createRenderPipeline({
                label,
                layout: locPipelineLayout,
                vertex: {
                    module,
                    entryPoint: "vsLocMain",
                    buffers: [
                        {
                            arrayStride: 12,
                            stepMode: "vertex",
                            attributes: [
                                {
                                    shaderLocation: 0,
                                    offset: 0,
                                    format: "uint32x3",
                                },
                            ],
                        },
                    ],
                },
                fragment: {
                    module,
                    entryPoint: fragmentEntryPoint,
                    targets: [
                        transparent
                            ? { format: canvasResources.format, blend: alphaBlend }
                            : { format: canvasResources.format },
                    ],
                },
                primitive: {
                    topology: "triangle-list",
                    frontFace: "ccw",
                    cullMode,
                },
                depthStencil: {
                    format: "depth24plus",
                    // Match WebGL: transparent geometry still writes depth.
                    depthWriteEnabled: true,
                    depthCompare: "less-equal",
                },
            });
        const locOpaqueCullPipeline = createLocPipeline(
            "static-loc-opaque-cull-pipeline",
            "fsMain",
            "back",
            false,
        );
        const locOpaqueNoCullPipeline = createLocPipeline(
            "static-loc-opaque-no-cull-pipeline",
            "fsMain",
            "none",
            false,
        );
        const locAlphaCullPipeline = createLocPipeline(
            "static-loc-alpha-cull-pipeline",
            "fsMainAlpha",
            "back",
            true,
        );
        const locAlphaNoCullPipeline = createLocPipeline(
            "static-loc-alpha-no-cull-pipeline",
            "fsMainAlpha",
            "none",
            true,
        );

        this.sceneBindGroupLayout = sceneBindGroupLayout;
        this.mapBindGroupLayout = mapBindGroupLayout;
        this.textureBindGroupLayout = textureBindGroupLayout;
        this.waterBindGroupLayout = waterBindGroupLayout;
        this.locBindGroupLayout = locBindGroupLayout;
        this.terrainTextures = WebGPUTerrainTextureResources.createFallback(
            device,
            textureBindGroupLayout,
        );
        this.waterResources = WebGPUWaterResources.createFallback(
            device,
            waterBindGroupLayout,
        );
        this.sceneUniforms = sceneUniforms;
        this.sceneBindGroup = sceneBindGroup;
        this.terrainOpaqueCullPipeline = terrainOpaqueCullPipeline;
        this.terrainOpaqueNoCullPipeline = terrainOpaqueNoCullPipeline;
        this.terrainAlphaCullPipeline = terrainAlphaCullPipeline;
        this.terrainAlphaNoCullPipeline = terrainAlphaNoCullPipeline;
        this.locOpaqueCullPipeline = locOpaqueCullPipeline;
        this.locOpaqueNoCullPipeline = locOpaqueNoCullPipeline;
        this.locAlphaCullPipeline = locAlphaCullPipeline;
        this.locAlphaNoCullPipeline = locAlphaNoCullPipeline;

        this.resize(canvas.width, canvas.height);
    }

    resize(width: number, height: number): void {
        const device = this.device;
        if (!device) return;

        const nextWidth = Math.max(1, width | 0);
        const nextHeight = Math.max(1, height | 0);
        if (
            this.depthTexture &&
            this.depthWidth === nextWidth &&
            this.depthHeight === nextHeight
        ) {
            return;
        }

        this.depthTexture?.destroy?.();
        this.depthTexture = device.createTexture({
            label: "terrain-depth",
            size: {
                width: nextWidth,
                height: nextHeight,
                depthOrArrayLayers: 1,
            },
            format: "depth24plus",
            usage: WEBGPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        });
        this.depthWidth = nextWidth;
        this.depthHeight = nextHeight;
    }

    configureTerrainTextures(textureSet: WebGPUTerrainTextureSet): void {
        const device = this.device;
        const textureBindGroupLayout = this.textureBindGroupLayout;
        if (!device || !textureBindGroupLayout) {
            throw new Error("WebGPU static scene renderer is not initialized");
        }

        this.terrainTextures?.dispose();
        this.terrainTextures = new WebGPUTerrainTextureResources(
            device,
            textureBindGroupLayout,
            textureSet,
        );
    }

    updateTerrainTextures(textures: ReadonlyMap<number, Int32Array>): number {
        return this.terrainTextures?.updateTextures(textures) ?? 0;
    }

    configureWaterTextures(data: Uint8Array): void {
        const device = this.device;
        const waterBindGroupLayout = this.waterBindGroupLayout;
        if (!device || !waterBindGroupLayout) {
            throw new Error("WebGPU static scene renderer is not initialized");
        }

        this.waterResources?.dispose();
        this.waterResources = new WebGPUWaterResources(
            device,
            waterBindGroupLayout,
            data,
        );
    }

    replaceLocGeometry(data: SdMapData): boolean {
        const id = this.mapId(data.mapX, data.mapY);
        if (!this.mapsById.has(id)) {
            return false;
        }
        const device = this.device;
        const locBindGroupLayout = this.locBindGroupLayout;
        if (!device || !locBindGroupLayout) {
            throw new Error("WebGPU static scene renderer is not initialized");
        }

        this.locsById.get(id)?.dispose();
        this.locsById.delete(id);
        if (!this.hasGeometryDraws(data.loc)) {
            return true;
        }

        this.locsById.set(
            id,
            new WebGPUStaticLocResources(
                device,
                locBindGroupLayout,
                data.mapX,
                data.mapY,
                data.loc,
                data.heightMapSize,
                data.heightMapTextureData,
            ),
        );
        return true;
    }

    replaceGroundItemGeometry(
        mapX: number,
        mapY: number,
        heightMapSize: number,
        heightMapTextureData: Int16Array,
        data: GroundItemGeometryBuildData | undefined,
    ): boolean {
        const id = this.mapId(mapX, mapY);
        if (!this.mapsById.has(id)) {
            return false;
        }
        const device = this.device;
        const locBindGroupLayout = this.locBindGroupLayout;
        if (!device || !locBindGroupLayout) {
            throw new Error("WebGPU static scene renderer is not initialized");
        }

        this.groundItemsById.get(id)?.dispose();
        this.groundItemsById.delete(id);
        if (!data || data.vertices.length === 0 || data.indices.length === 0) {
            return true;
        }

        this.groundItemsById.set(
            id,
            new WebGPUStaticGroundItemResources(
                device,
                locBindGroupLayout,
                mapX,
                mapY,
                heightMapSize,
                heightMapTextureData,
                data,
            ),
        );
        return true;
    }

    replaceDoorGeometry(data: SdMapData): boolean {
        const id = this.mapId(data.mapX, data.mapY);
        if (!this.mapsById.has(id)) {
            return false;
        }
        const device = this.device;
        const locBindGroupLayout = this.locBindGroupLayout;
        if (!device || !locBindGroupLayout) {
            throw new Error("WebGPU static scene renderer is not initialized");
        }

        this.doorsById.get(id)?.dispose();
        this.doorsById.delete(id);
        const doorGeometry = {
            vertices: data.doorVertices,
            indices: data.doorIndices,
            modelTextureData: data.doorModelTextureData,
            modelTextureDataAlpha: data.doorModelTextureDataAlpha,
            modelTextureDataLod: data.doorModelTextureDataLod,
            modelTextureDataLodAlpha: data.doorModelTextureDataLodAlpha,
            modelTextureDataInteract: data.doorModelTextureDataInteract,
            modelTextureDataInteractAlpha: data.doorModelTextureDataInteractAlpha,
            modelTextureDataInteractLod: data.doorModelTextureDataInteractLod,
            modelTextureDataInteractLodAlpha: data.doorModelTextureDataInteractLodAlpha,
            drawRanges: data.doorDrawRanges,
            drawRangesAlpha: data.doorDrawRangesAlpha,
            drawRangesPlanes: data.doorDrawRangesPlanes,
            drawRangesAlphaPlanes: data.doorDrawRangesAlphaPlanes,
            drawRangesLod: data.doorDrawRangesLod,
            drawRangesLodAlpha: data.doorDrawRangesLodAlpha,
            drawRangesLodPlanes: data.doorDrawRangesLodPlanes,
            drawRangesLodAlphaPlanes: data.doorDrawRangesLodAlphaPlanes,
            drawRangesInteract: data.doorDrawRangesInteract,
            drawRangesInteractAlpha: data.doorDrawRangesInteractAlpha,
            drawRangesInteractPlanes: data.doorDrawRangesInteractPlanes,
            drawRangesInteractAlphaPlanes: data.doorDrawRangesInteractAlphaPlanes,
            drawRangesInteractLod: data.doorDrawRangesInteractLod,
            drawRangesInteractLodAlpha: data.doorDrawRangesInteractLodAlpha,
            drawRangesInteractLodPlanes: data.doorDrawRangesInteractLodPlanes,
            drawRangesInteractLodAlphaPlanes: data.doorDrawRangesInteractLodAlphaPlanes,
        } satisfies LocGeometryData;
        if (!this.hasGeometryDraws(doorGeometry)) {
            return true;
        }

        this.doorsById.set(
            id,
            new WebGPUStaticDoorResources(device, locBindGroupLayout, data),
        );
        return true;
    }

    uploadTerrain(data: WebGPUTerrainUploadData, loadTime: number): void {
        const device = this.device;
        const mapBindGroupLayout = this.mapBindGroupLayout;
        if (!device || !mapBindGroupLayout) {
            throw new Error("WebGPU static scene renderer is not initialized");
        }

        const id = this.mapId(data.mapX, data.mapY);
        const existing = this.mapsById.get(id);
        existing?.dispose();
        if (!existing) {
            this.mapOrder.push(id);
        }
        const mapResources = new WebGPUTerrainMapResources(
            device,
            mapBindGroupLayout,
            data,
            loadTime,
        );
        this.mapsById.set(id, mapResources);

        const sceneData = data as WebGPUTerrainUploadData & Partial<SdMapData>;
        if (sceneData.loc && sceneData.heightMapTextureData) {
            this.replaceLocGeometry(sceneData as SdMapData);
        }
        if (sceneData.doorVertices && sceneData.heightMapTextureData) {
            this.replaceDoorGeometry(sceneData as SdMapData);
        }
    }

    removeTerrain(mapX: number, mapY: number): void {
        const id = this.mapId(mapX, mapY);
        this.mapsById.get(id)?.dispose();
        this.locsById.get(id)?.dispose();
        this.groundItemsById.get(id)?.dispose();
        this.doorsById.get(id)?.dispose();
        this.locsById.delete(id);
        this.groundItemsById.delete(id);
        this.groundItemRevisionById.delete(id);
        this.doorsById.delete(id);
        if (this.mapsById.delete(id)) {
            const index = this.mapOrder.indexOf(id);
            if (index >= 0) {
                this.mapOrder.splice(index, 1);
            }
        }
    }

    clearTerrain(): void {
        for (const map of this.mapsById.values()) {
            map.dispose();
        }
        this.mapsById.clear();
        for (const locs of this.locsById.values()) {
            locs.dispose();
        }
        this.locsById.clear();
        for (const groundItems of this.groundItemsById.values()) {
            groundItems.dispose();
        }
        this.groundItemsById.clear();
        this.groundItemRevisionById.clear();
        for (const doors of this.doorsById.values()) {
            doors.dispose();
        }
        this.doorsById.clear();
        this.mapOrder.length = 0;
        this.visibleMapOrder.length = 0;
        this.visibleMapLod.length = 0;
    }

    setVisibleTerrainMaps(
        maps: readonly { mapX: number; mapY: number }[],
        count: number,
    ): void {
        this.setVisibleSceneMaps(maps, [], count);
    }

    setVisibleSceneMaps(
        maps: readonly GroundItemSnapshotMap[],
        lodFlags: readonly number[],
        count: number,
    ): void {
        this.visibilityFilterEnabled = true;
        const limit = Math.min(Math.max(0, count | 0), maps.length);
        this.visibleMapOrder.length = limit;
        this.visibleMapLod.length = limit;
        for (let i = 0; i < limit; i++) {
            const map = maps[i];
            const id = this.mapId(map.mapX, map.mapY);
            this.visibleMapOrder[i] = id;
            this.visibleMapLod[i] = lodFlags[i] ? 1 : 0;

            const snapshot = getGroundItemGeometrySnapshot(map as object);
            if (
                snapshot &&
                this.groundItemRevisionById.get(id) !== snapshot.revision &&
                typeof map.heightMapSize === "number" &&
                map.heightMapData
            ) {
                if (
                    this.replaceGroundItemGeometry(
                        map.mapX,
                        map.mapY,
                        map.heightMapSize,
                        map.heightMapData,
                        snapshot.data,
                    )
                ) {
                    this.groundItemRevisionById.set(id, snapshot.revision);
                }
            }
        }
    }

    private mapUsesLod(orderIndex: number): boolean {
        return this.visibilityFilterEnabled && this.visibleMapLod[orderIndex] === 1;
    }

    private drawStaticGeometry(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        map: WebGPUTerrainMapResources,
        resources: WebGPUStaticLocResources | undefined,
        staticPass: WebGPUStaticLocPassResources | undefined,
        pipeline: WebGPURenderPipelineLike,
    ): void {
        if (!resources || !staticPass || staticPass.draws.length === 0) {
            return;
        }
        pass.setPipeline(pipeline);
        pass.setBindGroup(1, map.sharedMapBindGroup);
        pass.setBindGroup(4, staticPass.bindGroup);
        pass.setVertexBuffer(0, resources.vertexBuffer);
        pass.setIndexBuffer(resources.indexBuffer, "uint32");
        for (const draw of staticPass.draws) {
            if (draw.plane > frame.roofPlaneLimit) {
                continue;
            }
            pass.drawIndexed(
                draw.indexCount,
                draw.instanceCount,
                draw.firstIndex,
                0,
                draw.firstInstance,
            );
        }
    }

    private drawOpaqueScene(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ): void {
        const order = this.visibilityFilterEnabled ? this.visibleMapOrder : this.mapOrder;
        for (let i = 0; i < order.length; i++) {
            const id = order[i];
            const map = this.mapsById.get(id);
            if (!map) {
                continue;
            }
            const lod = this.mapUsesLod(i);

            pass.setPipeline(terrainPipeline);
            pass.setVertexBuffer(0, map.vertexBuffer);
            pass.setIndexBuffer(map.indexBuffer, "uint32");
            const terrainDraws = lod ? map.lodDraws : map.draws;
            for (const draw of terrainDraws) {
                if (draw.plane > frame.roofPlaneLimit) {
                    continue;
                }
                pass.setBindGroup(1, draw.mapBindGroup);
                pass.drawIndexed(
                    draw.indexCount,
                    draw.instanceCount,
                    draw.firstIndex,
                    0,
                    0,
                );
            }

            const locs = this.locsById.get(id);
            const groundItems = this.groundItemsById.get(id);
            const doors = this.doorsById.get(id);
            drawWebGPUOrderedStaticGeometry(pass, frame, map, locPipeline, [
                { resources: locs, staticPass: locs?.getPass(false, lod) },
                { resources: groundItems, staticPass: groundItems?.getPass(false, lod) },
                { resources: doors, staticPass: doors?.getPass(false, lod) },
            ]);
        }
    }

    private drawTransparentScene(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ): void {
        const order = this.visibilityFilterEnabled ? this.visibleMapOrder : this.mapOrder;
        for (let i = order.length - 1; i >= 0; i--) {
            const id = order[i];
            const map = this.mapsById.get(id);
            if (!map) {
                continue;
            }
            const lod = this.mapUsesLod(i);

            pass.setPipeline(terrainPipeline);
            pass.setVertexBuffer(0, map.vertexBuffer);
            pass.setIndexBuffer(map.indexBuffer, "uint32");
            const terrainDraws = lod ? map.lodAlphaDraws : map.alphaDraws;
            for (const draw of terrainDraws) {
                if (draw.plane > frame.roofPlaneLimit) {
                    continue;
                }
                pass.setBindGroup(1, draw.mapBindGroup);
                pass.drawIndexed(
                    draw.indexCount,
                    draw.instanceCount,
                    draw.firstIndex,
                    0,
                    0,
                );
            }

            const locs = this.locsById.get(id);
            const groundItems = this.groundItemsById.get(id);
            const doors = this.doorsById.get(id);
            drawWebGPUOrderedStaticGeometry(pass, frame, map, locPipeline, [
                { resources: locs, staticPass: locs?.getPass(true, lod) },
                { resources: groundItems, staticPass: groundItems?.getPass(true, lod) },
                { resources: doors, staticPass: doors?.getPass(true, lod) },
            ]);
        }
    }

    render(frame: SceneFrameDescription): void {
        const device = this.device;
        const context = this.backend.canvasContext;
        const sceneUniforms = this.sceneUniforms;
        const sceneBindGroup = this.sceneBindGroup;
        const opaquePipeline =
            getWebGPUTerrainPipelineVariant(false, frame.cullBackFace) === "opaque-cull"
                ? this.terrainOpaqueCullPipeline
                : this.terrainOpaqueNoCullPipeline;
        const alphaPipeline =
            getWebGPUTerrainPipelineVariant(true, frame.cullBackFace) === "alpha-cull"
                ? this.terrainAlphaCullPipeline
                : this.terrainAlphaNoCullPipeline;
        const locOpaquePipeline = frame.cullBackFace
            ? this.locOpaqueCullPipeline
            : this.locOpaqueNoCullPipeline;
        const locAlphaPipeline = frame.cullBackFace
            ? this.locAlphaCullPipeline
            : this.locAlphaNoCullPipeline;
        const terrainTextures = this.terrainTextures;
        const waterResources = this.waterResources;
        const depthTexture = this.depthTexture;
        if (
            !device ||
            !context ||
            !sceneUniforms ||
            !sceneBindGroup ||
            !opaquePipeline ||
            !alphaPipeline ||
            !locOpaquePipeline ||
            !locAlphaPipeline ||
            !terrainTextures ||
            !waterResources ||
            !depthTexture
        ) {
            return;
        }

        this.resize(frame.canvasWidth, frame.canvasHeight);
        const activeDepthTexture = this.depthTexture;
        if (!activeDepthTexture) return;

        sceneUniforms.update(frame);

        const colorView = context.getCurrentTexture().createView();
        const depthView = activeDepthTexture.createView();
        const encoder = device.createCommandEncoder({ label: "terrain-frame-encoder" });
        const pass = encoder.beginRenderPass({
            label: "terrain-foundation-pass",
            colorAttachments: [
                {
                    view: colorView,
                    clearValue: {
                        r: frame.skyColor[0],
                        g: frame.skyColor[1],
                        b: frame.skyColor[2],
                        a: frame.skyColor[3],
                    },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: depthView,
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        pass.setBindGroup(0, sceneBindGroup);
        pass.setBindGroup(2, terrainTextures.bindGroup);
        pass.setBindGroup(3, waterResources.bindGroup);

        const viewport = frame.sceneViewport;
        if (viewport.width > 0 && viewport.height > 0) {
            pass.setViewport?.(
                viewport.x,
                viewport.y,
                viewport.width,
                viewport.height,
                0,
                1,
            );
            pass.setScissorRect?.(
                Math.max(0, viewport.x | 0),
                Math.max(0, viewport.y | 0),
                Math.max(1, viewport.width | 0),
                Math.max(1, viewport.height | 0),
            );
        }

        this.drawOpaqueScene(pass, frame, opaquePipeline, locOpaquePipeline);
        this.drawTransparentScene(pass, frame, alphaPipeline, locAlphaPipeline);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    dispose(): void {
        this.clearTerrain();
        this.depthTexture?.destroy?.();
        this.depthTexture = undefined;
        this.sceneUniforms?.dispose();
        this.sceneUniforms = undefined;
        this.sceneBindGroup = undefined;
        this.sceneBindGroupLayout = undefined;
        this.mapBindGroupLayout = undefined;
        this.textureBindGroupLayout = undefined;
        this.waterBindGroupLayout = undefined;
        this.locBindGroupLayout = undefined;
        this.terrainTextures?.dispose();
        this.terrainTextures = undefined;
        this.waterResources?.dispose();
        this.waterResources = undefined;
        this.terrainOpaqueCullPipeline = undefined;
        this.terrainOpaqueNoCullPipeline = undefined;
        this.terrainAlphaCullPipeline = undefined;
        this.terrainAlphaNoCullPipeline = undefined;
        this.locOpaqueCullPipeline = undefined;
        this.locOpaqueNoCullPipeline = undefined;
        this.locAlphaCullPipeline = undefined;
        this.locAlphaNoCullPipeline = undefined;
        this.device = undefined;
        this.depthWidth = 0;
        this.depthHeight = 0;
        this.visibilityFilterEnabled = false;
        this.visibleMapOrder.length = 0;
        this.visibleMapLod.length = 0;
        this.mapOrder.length = 0;
        this.mapsById.clear();
        this.locsById.clear();
        this.groundItemsById.clear();
        this.groundItemRevisionById.clear();
        this.doorsById.clear();
    }
}
