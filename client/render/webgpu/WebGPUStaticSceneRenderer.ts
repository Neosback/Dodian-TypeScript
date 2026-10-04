import type { SceneFrameDescription } from "../frame/SceneFrameDescription";
import { WebGPUGraphicsBackend } from "../backend/WebGPUGraphicsBackend";
import {
    WEBGPU_SHADER_STAGE,
    WEBGPU_TEXTURE_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUDeviceLike,
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

export class WebGPUStaticSceneRenderer {
    private device?: WebGPUDeviceLike;
    private sceneUniforms?: WebGPUSceneUniformBuffer;
    private sceneBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private mapBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private textureBindGroupLayout?: WebGPUBindGroupLayoutLike;
    private sceneBindGroup?: WebGPUBindGroupLike;
    private terrainTextures?: WebGPUTerrainTextureResources;
    private terrainPipeline?: WebGPURenderPipelineLike;
    private depthTexture?: WebGPUTextureLike;
    private depthWidth = 0;
    private depthHeight = 0;
    private maps = new Map<string, WebGPUTerrainMapResources>();

    constructor(readonly backend: WebGPUGraphicsBackend) {}

    private mapKey(mapX: number, mapY: number): string {
        return `${mapX | 0}:${mapY | 0}`;
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
                    visibility: WEBGPU_SHADER_STAGE.VERTEX,
                    buffer: { type: "uniform" },
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
            ],
        });
        const terrainPipeline = device.createRenderPipeline({
            label: "terrain-foundation-pipeline",
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
                entryPoint: "fsMain",
                targets: [{ format: canvasResources.format }],
            },
            primitive: {
                topology: "triangle-list",
                frontFace: "ccw",
                cullMode: "back",
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less-equal",
            },
        });

        this.sceneBindGroupLayout = sceneBindGroupLayout;
        this.mapBindGroupLayout = mapBindGroupLayout;
        this.textureBindGroupLayout = textureBindGroupLayout;
        this.terrainTextures = WebGPUTerrainTextureResources.createFallback(
            device,
            textureBindGroupLayout,
        );
        this.sceneUniforms = sceneUniforms;
        this.sceneBindGroup = sceneBindGroup;
        this.terrainPipeline = terrainPipeline;

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

    uploadTerrain(data: WebGPUTerrainUploadData, loadTime: number): void {
        const device = this.device;
        const mapBindGroupLayout = this.mapBindGroupLayout;
        if (!device || !mapBindGroupLayout) {
            throw new Error("WebGPU static scene renderer is not initialized");
        }

        const key = this.mapKey(data.mapX, data.mapY);
        this.maps.get(key)?.dispose();
        this.maps.set(
            key,
            new WebGPUTerrainMapResources(device, mapBindGroupLayout, data, loadTime),
        );
    }

    removeTerrain(mapX: number, mapY: number): void {
        const key = this.mapKey(mapX, mapY);
        this.maps.get(key)?.dispose();
        this.maps.delete(key);
    }

    render(frame: SceneFrameDescription): void {
        const device = this.device;
        const context = this.backend.canvasContext;
        const sceneUniforms = this.sceneUniforms;
        const sceneBindGroup = this.sceneBindGroup;
        const terrainPipeline = this.terrainPipeline;
        const terrainTextures = this.terrainTextures;
        const depthTexture = this.depthTexture;
        if (
            !device ||
            !context ||
            !sceneUniforms ||
            !sceneBindGroup ||
            !terrainPipeline ||
            !terrainTextures ||
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

        pass.setPipeline(terrainPipeline);
        pass.setBindGroup(0, sceneBindGroup);
        pass.setBindGroup(2, terrainTextures.bindGroup);

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

        for (const map of this.maps.values()) {
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
        }

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    dispose(): void {
        for (const map of this.maps.values()) {
            map.dispose();
        }
        this.maps.clear();
        this.depthTexture?.destroy?.();
        this.depthTexture = undefined;
        this.sceneUniforms?.dispose();
        this.sceneUniforms = undefined;
        this.sceneBindGroup = undefined;
        this.sceneBindGroupLayout = undefined;
        this.mapBindGroupLayout = undefined;
        this.textureBindGroupLayout = undefined;
        this.terrainTextures?.dispose();
        this.terrainTextures = undefined;
        this.terrainPipeline = undefined;
        this.device = undefined;
        this.depthWidth = 0;
        this.depthHeight = 0;
    }
}
