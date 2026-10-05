import { InteractType } from "../../InteractType";
import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type { WebGPUGraphicsBackend } from "../../backend/WebGPUGraphicsBackend";
import {
    WEBGPU_BUFFER_USAGE,
    WEBGPU_MAP_MODE,
    WEBGPU_TEXTURE_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
    type WebGPURenderPassEncoderLike,
    type WebGPURenderPipelineLike,
    type WebGPUTextureLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUSceneUniformBuffer } from "../WebGPUSceneUniforms";
import type { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import { patchWebGPUStaticSceneShaderForWorldEntities } from "../WebGPUStaticSceneShaderPatch";
import { WEBGPU_TERRAIN_SHADER } from "../terrain/WebGPUTerrainShader";
import type { WebGPUTerrainMapResources } from "../terrain/WebGPUTerrainMapResources";
import { drawWebGPUOrderedStaticGeometry } from "../loc/WebGPUStaticLocDrawOrdering";
import type { WebGPUStaticLocResources } from "../loc/WebGPUStaticLocResources";

export const WEBGPU_STATIC_PICK_FORMAT = "rgba32uint";
export const WEBGPU_STATIC_PICK_BYTES_PER_PIXEL = 16;
export const WEBGPU_STATIC_PICK_BYTES_PER_ROW = 256;

const TILE_COORD_MASK = 0x3fff;
const TILE_Y_SHIFT = 14;
const TILE_PLANE_SHIFT = 28;

export interface WebGPUStaticPickResult {
    interactId: number;
    mapId: number;
    interactType: InteractType;
    tileX: number;
    tileY: number;
    plane: number;
}

export function packWebGPUStaticPickTile(
    tileX: number,
    tileY: number,
    plane: number,
): number {
    const x = Math.max(0, Math.min(TILE_COORD_MASK, tileX | 0));
    const y = Math.max(0, Math.min(TILE_COORD_MASK, tileY | 0));
    const level = Math.max(0, Math.min(3, plane | 0));
    return (x | (y << TILE_Y_SHIFT) | (level << TILE_PLANE_SHIFT)) >>> 0;
}

export function unpackWebGPUStaticPickTile(packed: number): {
    tileX: number;
    tileY: number;
    plane: number;
} {
    const value = packed >>> 0;
    return {
        tileX: value & TILE_COORD_MASK,
        tileY: (value >>> TILE_Y_SHIFT) & TILE_COORD_MASK,
        plane: (value >>> TILE_PLANE_SHIFT) & 0x3,
    };
}

/** Decode the integer render-target tuple written by `fsPick`. */
export function decodeWebGPUStaticPickWords(
    words: ArrayLike<number>,
): WebGPUStaticPickResult | undefined {
    if (words.length < 4) {
        throw new Error("WebGPU static pick readback requires four uint32 words");
    }
    const encodedTile = Number(words[3]) >>> 0;
    if (encodedTile === 0) {
        return undefined;
    }
    const tile = unpackWebGPUStaticPickTile((encodedTile - 1) >>> 0);
    return {
        interactId: Number(words[0]) >>> 0,
        mapId: Number(words[1]) >>> 0,
        interactType: (Number(words[2]) >>> 0) as InteractType,
        ...tile,
    };
}

type PickTerrainTextureResources = {
    bindGroup: WebGPUBindGroupLike;
};

type StaticPickingRendererAccess = {
    device?: WebGPUDeviceLike;
    sceneBindGroupLayout?: WebGPUBindGroupLayoutLike;
    mapBindGroupLayout?: WebGPUBindGroupLayoutLike;
    textureBindGroupLayout?: WebGPUBindGroupLayoutLike;
    waterBindGroupLayout?: WebGPUBindGroupLayoutLike;
    locBindGroupLayout?: WebGPUBindGroupLayoutLike;
    terrainTextures?: PickTerrainTextureResources;
    waterResources?: PickTerrainTextureResources;
    mapsById: Map<number, WebGPUTerrainMapResources>;
    locsById: Map<number, WebGPUStaticLocResources>;
    groundItemsById: Map<number, WebGPUStaticLocResources>;
    doorsById: Map<number, WebGPUStaticLocResources>;
    mapOrder: number[];
    visibleMapOrder: number[];
    visibleMapLod: number[];
    visibilityFilterEnabled: boolean;
};

type StaticPickRequest = {
    frame: SceneFrameDescription;
    x: number;
    y: number;
    resolve: (result: WebGPUStaticPickResult | undefined) => void;
    reject: (error: unknown) => void;
};

function isPointInsideSceneViewport(
    frame: SceneFrameDescription,
    x: number,
    y: number,
): boolean {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || py < 0 || px >= frame.canvasWidth || py >= frame.canvasHeight) {
        return false;
    }
    const viewport = frame.sceneViewport;
    return (
        px >= viewport.x &&
        py >= viewport.y &&
        px < viewport.x + viewport.width &&
        py < viewport.y + viewport.height
    );
}

/**
 * On-demand GPU static-scene picker.
 *
 * The main A/B renderer remains completely readback-free. A pick request
 * records a separate static scene pass into an RGBA32Uint target, copies one
 * top-left-origin canvas pixel into a 256-byte-row-aligned staging buffer, and
 * resolves only after `mapAsync` completes. At most one readback is in flight;
 * while busy, only the latest pending request is retained.
 *
 * Dynamic players/NPCs are intentionally outside this checkpoint, so the CPU
 * SceneRaycaster remains the authoritative interaction system until the full
 * WebGPU backend is activated.
 */
export class WebGPUStaticPickingController {
    private initialized = false;
    private initializing?: Promise<void>;
    private sceneUniforms?: WebGPUSceneUniformBuffer;
    private sceneBindGroup?: WebGPUBindGroupLike;
    private terrainCullPipeline?: WebGPURenderPipelineLike;
    private terrainNoCullPipeline?: WebGPURenderPipelineLike;
    private locCullPipeline?: WebGPURenderPipelineLike;
    private locNoCullPipeline?: WebGPURenderPipelineLike;
    private pickTexture?: WebGPUTextureLike;
    private depthTexture?: WebGPUTextureLike;
    private targetWidth = 0;
    private targetHeight = 0;
    private readbackBuffer?: WebGPUBufferLike;
    private busy = false;
    private queued?: StaticPickRequest;
    private disposed = false;

    constructor(
        private readonly renderer: WebGPUStaticSceneRenderer,
        private readonly backend: WebGPUGraphicsBackend = renderer.backend,
    ) {}

    request(
        frame: SceneFrameDescription,
        canvasX: number,
        canvasY: number,
    ): Promise<WebGPUStaticPickResult | undefined> {
        if (this.disposed || !isPointInsideSceneViewport(frame, canvasX, canvasY)) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve, reject) => {
            const request: StaticPickRequest = {
                frame,
                x: canvasX | 0,
                y: canvasY | 0,
                resolve,
                reject,
            };
            if (this.busy) {
                // Never build a readback backlog. The newest cursor request wins.
                this.queued?.resolve(undefined);
                this.queued = request;
                return;
            }
            void this.execute(request);
        });
    }

    private get access(): StaticPickingRendererAccess {
        return this.renderer as unknown as StaticPickingRendererAccess;
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        if (this.initializing) return this.initializing;
        this.initializing = this.initialize();
        try {
            await this.initializing;
            this.initialized = true;
        } finally {
            this.initializing = undefined;
        }
    }

    private async initialize(): Promise<void> {
        const access = this.access;
        const device = access.device ?? this.backend.device;
        const sceneLayout = access.sceneBindGroupLayout;
        const mapLayout = access.mapBindGroupLayout;
        const textureLayout = access.textureBindGroupLayout;
        const waterLayout = access.waterBindGroupLayout;
        const locLayout = access.locBindGroupLayout;
        if (!device || !sceneLayout || !mapLayout || !textureLayout || !waterLayout || !locLayout) {
            throw new Error("WebGPU static renderer must be initialized before static picking");
        }

        const sceneUniforms = new WebGPUSceneUniformBuffer(device);
        const sceneBindGroup = device.createBindGroup({
            label: "static-pick-scene-bind-group",
            layout: sceneLayout,
            entries: [{ binding: 0, resource: { buffer: sceneUniforms.buffer } }],
        });
        const module = await this.backend.compileShaderModule(
            patchWebGPUStaticSceneShaderForWorldEntities(WEBGPU_TERRAIN_SHADER),
            "terrain-static-pick",
        );
        const vertexBuffer = {
            arrayStride: 12,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "uint32x3" }],
        };
        const depthStencil = {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less-equal",
        };
        const createPipeline = (
            label: string,
            vertexEntryPoint: "vsMain" | "vsLocMain",
            cullMode: "back" | "none",
            bindGroupLayouts: WebGPUBindGroupLayoutLike[],
        ): WebGPURenderPipelineLike =>
            device.createRenderPipeline({
                label,
                layout: device.createPipelineLayout({
                    label: `${label}-layout`,
                    bindGroupLayouts,
                }),
                vertex: {
                    module,
                    entryPoint: vertexEntryPoint,
                    buffers: [vertexBuffer],
                },
                fragment: {
                    module,
                    entryPoint: "fsPick",
                    targets: [{ format: WEBGPU_STATIC_PICK_FORMAT }],
                },
                primitive: {
                    topology: "triangle-list",
                    frontFace: "ccw",
                    cullMode,
                },
                depthStencil,
            });

        this.terrainCullPipeline = createPipeline(
            "static-pick-terrain-cull",
            "vsMain",
            "back",
            [sceneLayout, mapLayout, textureLayout, waterLayout],
        );
        this.terrainNoCullPipeline = createPipeline(
            "static-pick-terrain-no-cull",
            "vsMain",
            "none",
            [sceneLayout, mapLayout, textureLayout, waterLayout],
        );
        this.locCullPipeline = createPipeline(
            "static-pick-loc-cull",
            "vsLocMain",
            "back",
            [sceneLayout, mapLayout, textureLayout, waterLayout, locLayout],
        );
        this.locNoCullPipeline = createPipeline(
            "static-pick-loc-no-cull",
            "vsLocMain",
            "none",
            [sceneLayout, mapLayout, textureLayout, waterLayout, locLayout],
        );
        this.sceneUniforms = sceneUniforms;
        this.sceneBindGroup = sceneBindGroup;
        this.readbackBuffer = device.createBuffer({
            label: "static-pick-readback",
            size: WEBGPU_STATIC_PICK_BYTES_PER_ROW,
            usage: WEBGPU_BUFFER_USAGE.COPY_DST | WEBGPU_BUFFER_USAGE.MAP_READ,
        });
    }

    private ensureTargets(device: WebGPUDeviceLike, width: number, height: number): void {
        const nextWidth = Math.max(1, width | 0);
        const nextHeight = Math.max(1, height | 0);
        if (
            this.pickTexture &&
            this.depthTexture &&
            this.targetWidth === nextWidth &&
            this.targetHeight === nextHeight
        ) {
            return;
        }
        this.pickTexture?.destroy?.();
        this.depthTexture?.destroy?.();
        this.pickTexture = device.createTexture({
            label: "static-pick-id-target",
            size: { width: nextWidth, height: nextHeight, depthOrArrayLayers: 1 },
            format: WEBGPU_STATIC_PICK_FORMAT,
            usage: WEBGPU_TEXTURE_USAGE.RENDER_ATTACHMENT | WEBGPU_TEXTURE_USAGE.COPY_SRC,
        });
        this.depthTexture = device.createTexture({
            label: "static-pick-depth-target",
            size: { width: nextWidth, height: nextHeight, depthOrArrayLayers: 1 },
            format: "depth24plus",
            usage: WEBGPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        });
        this.targetWidth = nextWidth;
        this.targetHeight = nextHeight;
    }

    private mapUsesLod(access: StaticPickingRendererAccess, index: number): boolean {
        return access.visibilityFilterEnabled && access.visibleMapLod[index] === 1;
    }

    private drawTerrain(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        map: WebGPUTerrainMapResources,
        lod: boolean,
        transparent: boolean,
        pipeline: WebGPURenderPipelineLike,
    ): void {
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, map.vertexBuffer);
        pass.setIndexBuffer(map.indexBuffer, "uint32");
        const draws = transparent
            ? lod
                ? map.lodAlphaDraws
                : map.alphaDraws
            : lod
              ? map.lodDraws
              : map.draws;
        for (const draw of draws) {
            if (draw.plane > frame.roofPlaneLimit) continue;
            pass.setBindGroup(1, draw.mapBindGroup);
            pass.drawIndexed(draw.indexCount, draw.instanceCount, draw.firstIndex, 0, 0);
        }
    }

    private drawLocLike(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        map: WebGPUTerrainMapResources,
        id: number,
        lod: boolean,
        transparent: boolean,
        pipeline: WebGPURenderPipelineLike,
        access: StaticPickingRendererAccess,
    ): void {
        const locs = access.locsById.get(id);
        const groundItems = access.groundItemsById.get(id);
        const doors = access.doorsById.get(id);
        drawWebGPUOrderedStaticGeometry(pass, frame, map, pipeline, [
            { resources: locs, staticPass: locs?.getInteractPass(transparent, lod) },
            {
                resources: groundItems,
                staticPass: groundItems?.getInteractPass(transparent, lod),
            },
            { resources: doors, staticPass: doors?.getInteractPass(transparent, lod) },
        ]);
    }

    private drawStaticScene(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        access: StaticPickingRendererAccess,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ): void {
        const order = access.visibilityFilterEnabled ? access.visibleMapOrder : access.mapOrder;
        for (let i = 0; i < order.length; i++) {
            const id = order[i];
            const map = access.mapsById.get(id);
            if (!map) continue;
            const lod = this.mapUsesLod(access, i);
            this.drawTerrain(pass, frame, map, lod, false, terrainPipeline);
            this.drawLocLike(pass, frame, map, id, lod, false, locPipeline, access);
        }
        for (let i = order.length - 1; i >= 0; i--) {
            const id = order[i];
            const map = access.mapsById.get(id);
            if (!map) continue;
            const lod = this.mapUsesLod(access, i);
            this.drawTerrain(pass, frame, map, lod, true, terrainPipeline);
            this.drawLocLike(pass, frame, map, id, lod, true, locPipeline, access);
        }
    }

    private async renderAndRead(
        request: StaticPickRequest,
    ): Promise<WebGPUStaticPickResult | undefined> {
        await this.ensureInitialized();
        if (this.disposed || !isPointInsideSceneViewport(request.frame, request.x, request.y)) {
            return undefined;
        }

        const access = this.access;
        const device = access.device ?? this.backend.device;
        const sceneUniforms = this.sceneUniforms;
        const sceneBindGroup = this.sceneBindGroup;
        const terrainTextures = access.terrainTextures;
        const waterResources = access.waterResources;
        const terrainPipeline = request.frame.cullBackFace
            ? this.terrainCullPipeline
            : this.terrainNoCullPipeline;
        const locPipeline = request.frame.cullBackFace
            ? this.locCullPipeline
            : this.locNoCullPipeline;
        const readback = this.readbackBuffer;
        if (
            !device ||
            !sceneUniforms ||
            !sceneBindGroup ||
            !terrainTextures ||
            !waterResources ||
            !terrainPipeline ||
            !locPipeline ||
            !readback
        ) {
            return undefined;
        }

        if (!readback.mapAsync || !readback.getMappedRange || !readback.unmap) {
            throw new Error("WebGPU buffer mapping is unavailable on this device wrapper");
        }
        this.ensureTargets(device, request.frame.canvasWidth, request.frame.canvasHeight);
        const pickTexture = this.pickTexture;
        const depthTexture = this.depthTexture;
        if (!pickTexture || !depthTexture) return undefined;

        sceneUniforms.update(request.frame);
        const encoder = device.createCommandEncoder({ label: "static-pick-encoder" });
        const copyTextureToBuffer = encoder.copyTextureToBuffer;
        if (!copyTextureToBuffer) {
            throw new Error("WebGPU texture readback is unavailable on this command encoder");
        }
        const pass = encoder.beginRenderPass({
            label: "static-pick-pass",
            colorAttachments: [
                {
                    view: pickTexture.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });
        pass.setBindGroup(0, sceneBindGroup);
        pass.setBindGroup(2, terrainTextures.bindGroup);
        pass.setBindGroup(3, waterResources.bindGroup);
        const viewport = request.frame.sceneViewport;
        pass.setViewport?.(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
        // The one-pixel scissor reduces fragment work. Vertex work is still full-scene;
        // cursor-frustum/chunk narrowing remains a later performance checkpoint.
        pass.setScissorRect?.(request.x, request.y, 1, 1);
        this.drawStaticScene(pass, request.frame, access, terrainPipeline, locPipeline);
        pass.end();

        copyTextureToBuffer.call(
            encoder,
            {
                texture: pickTexture,
                origin: { x: request.x, y: request.y, z: 0 },
            },
            {
                buffer: readback,
                offset: 0,
                bytesPerRow: WEBGPU_STATIC_PICK_BYTES_PER_ROW,
                rowsPerImage: 1,
            },
            { width: 1, height: 1, depthOrArrayLayers: 1 },
        );
        device.queue.submit([encoder.finish()]);

        await readback.mapAsync(WEBGPU_MAP_MODE.READ, 0, WEBGPU_STATIC_PICK_BYTES_PER_PIXEL);
        try {
            const mapped = readback.getMappedRange(0, WEBGPU_STATIC_PICK_BYTES_PER_PIXEL);
            const words = new Uint32Array(mapped.slice(0, WEBGPU_STATIC_PICK_BYTES_PER_PIXEL));
            return decodeWebGPUStaticPickWords(words);
        } finally {
            readback.unmap();
        }
    }

    private async execute(request: StaticPickRequest): Promise<void> {
        this.busy = true;
        try {
            request.resolve(await this.renderAndRead(request));
        } catch (error) {
            request.reject(error);
        } finally {
            this.busy = false;
            if (this.disposed) {
                this.queued?.resolve(undefined);
                this.queued = undefined;
                return;
            }
            const next = this.queued;
            this.queued = undefined;
            if (next) {
                void this.execute(next);
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.queued?.resolve(undefined);
        this.queued = undefined;
        this.sceneUniforms?.dispose();
        this.sceneUniforms = undefined;
        this.sceneBindGroup = undefined;
        this.pickTexture?.destroy?.();
        this.pickTexture = undefined;
        this.depthTexture?.destroy?.();
        this.depthTexture = undefined;
        this.readbackBuffer?.destroy?.();
        this.readbackBuffer = undefined;
        this.terrainCullPipeline = undefined;
        this.terrainNoCullPipeline = undefined;
        this.locCullPipeline = undefined;
        this.locNoCullPipeline = undefined;
        this.initialized = false;
    }
}
