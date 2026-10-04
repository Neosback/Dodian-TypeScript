import type { SceneFrameDescription } from "../frame/SceneFrameDescription";
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
import type { WebGPUTerrainUploadData } from "./terrain/WebGPUTerrainMapResources";
import { WebGPUTerrainMapResources } from "./terrain/WebGPUTerrainMapResources";
import { WEBGPU_TERRAIN_SHADER } from "./terrain/WebGPUTerrainShader";
import {
    type WebGPUTerrainTextureSet,
    WebGPUTerrainTextureResources,
} from "./terrain/WebGPUTerrainTextureResources";
import { WebGPUSceneUniformBuffer } from "./WebGPUSceneUniforms";
import { WebGPUWaterResources } from "./terrain/WebGPUWaterResources";
import { WebGPUStaticLocResources } from "./loc/WebGPUStaticLocResources";

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
    private depthTexture?: WebGPUTextureLike;
    private depthWidth = 0;
    private depthHeight = 0;
    private mapsById = new Map<number, WebGPUTerrainMapResources>();
    private locsById = new Map<number, WebGPUStaticLocResources>();
    private mapOrder: number[] = [];
    private visibleMapOrder: number[] = [];
    private visibilityFilterEnabled = false;

    constructor(readonly backend: WebGPUGraphicsBackend) {}

    private mapId(mapX: number, mapY: number): number {
        return (((mapX | 0) & 0xffff) << 16) | ((mapY | 0) & 0xffff);
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
            cullMode: "back" | "none",
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
                    entryPoint: "fsMain",
                    targets: [{ format: canvasResources.format }],
                },
                primitive: {
                    topology: "triangle-list",
                    frontFace: "ccw",
                    cullMode,
                },
                depthStencil: {
                    format: "depth24plus",
                    depthWriteEnabled: true,
                    depthCompare: "less-equal",
                },
            });
        const locOpaqueCullPipeline = createLocPipeline(
            "static-loc-opaque-cull-pipeline",
            "back",
        );
        const locOpaqueNoCullPipeline = createLocPipeline(
            "static-loc-opaque-no-cull-pipeline",
            "none",
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

        this.locsById.get(id)?.dispose();
        this.locsById.delete(id);
        const locBindGroupLayout = this.locBindGroupLayout;
        const locData = (data as any).loc;
        const heightMapTextureData = (data as any).heightMapTextureData as Int16Array | undefined;
        if (
            locBindGroupLayout &&
            locData &&
            locData.vertices?.length > 0 &&
            locData.indices?.length > 0 &&
            locData.drawRanges?.length > 0 &&
            heightMapTextureData &&
            heightMapTextureData.length > 0
        ) {
            this.locsById.set(
                id,
                new WebGPUStaticLocResources(
                    device,
                    locBindGroupLayout,
                    data.mapX,
                    data.mapY,
                    locData,
                    data.heightMapSize,
                    heightMapTextureData,
                ),
            );
        }
    }

    removeTerrain(mapX: number, mapY: number): void {
        const id = this.mapId(mapX, mapY);
        this.mapsById.get(id)?.dispose();
        this.locsById.get(id)?.dispose();
        this.locsById.delete(id);
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
        this.mapOrder.length = 0;
        this.visibleMapOrder.length = 0;
    }

    setVisibleTerrainMaps(
        maps: readonly { mapX: number; mapY: number }[],
        count: number,
    ): void {
        this.visibilityFilterEnabled = true;
        const limit = Math.min(Math.max(0, count | 0), maps.length);
        this.visibleMapOrder.length = limit;
        for (let i = 0; i < limit; i++) {
            const map = maps[i];
            this.visibleMapOrder[i] = this.mapId(map.mapX, map.mapY);
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

            pass.setPipeline(terrainPipeline);
            pass.setVertexBuffer(0, map.vertexBuffer);
            pass.setIndexBuffer(map.indexBuffer, "uint32");
            for (const draw of map.draws) {
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
            if (!locs || locs.draws.length === 0) {
                continue;
            }
            pass.setPipeline(locPipeline);
            pass.setBindGroup(1, map.sharedMapBindGroup);
            pass.setBindGroup(4, locs.bindGroup);
            pass.setVertexBuffer(0, locs.vertexBuffer);
            pass.setIndexBuffer(locs.indexBuffer, "uint32");
            for (const draw of locs.draws) {
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
    }

    private drawTerrainPass(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        transparent: boolean,
    ): void {
        const order = this.visibilityFilterEnabled ? this.visibleMapOrder : this.mapOrder;
        const start = transparent ? order.length - 1 : 0;
        const end = transparent ? -1 : order.length;
        const step = transparent ? -1 : 1;

        for (let i = start; i !== end; i += step) {
            const map = this.mapsById.get(order[i]);
            if (!map) {
                continue;
            }

            pass.setVertexBuffer(0, map.vertexBuffer);
            pass.setIndexBuffer(map.indexBuffer, "uint32");
            const draws = transparent ? map.alphaDraws : map.draws;
            for (const draw of draws) {
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
        const locPipeline = frame.cullBackFace
            ? this.locOpaqueCullPipeline
            : this.locOpaqueNoCullPipeline;
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
            !locPipeline ||
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

        this.drawOpaqueScene(pass, frame, opaquePipeline, locPipeline);

        // WebGL traverses visible map squares in reverse for the alpha pass.
        pass.setPipeline(alphaPipeline);
        this.drawTerrainPass(pass, frame, true);

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
        this.device = undefined;
        this.depthWidth = 0;
        this.depthHeight = 0;
        this.visibilityFilterEnabled = false;
        this.visibleMapOrder.length = 0;
        this.mapOrder.length = 0;
        this.mapsById.clear();
        this.locsById.clear();
    }
}
