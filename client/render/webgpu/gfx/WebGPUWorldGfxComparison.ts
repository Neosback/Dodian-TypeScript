import type { Renderer } from "../../../game/render/Renderer";
import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import type { WebGLMapSquare } from "../../WebGLMapSquare";
import {
    DYNAMIC_ACTOR_WEBGL_RECORD_WORDS,
    createDynamicActorGeometry,
    decodeDynamicActorWebGLRecord,
    type DynamicActorColorOverride,
    type DynamicActorGeometry,
} from "../../dynamic/DynamicActorRenderData";
import type { GfxInstance } from "../../gfx/GfxManager";
import {
    WEBGPU_BUFFER_USAGE,
    WEBGPU_SHADER_STAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
    type WebGPURenderPassEncoderLike,
    type WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import {
    WebGPUDynamicHeightBindGroupCache,
    WebGPUGrowableBufferCache,
} from "../dynamic/WebGPUDynamicResourceHelpers";
import { WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES } from "../player/WebGPUPlayerOpaqueComparison";
import {
    WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE,
    WEBGPU_ATTACHED_GFX_GEOMETRY_CACHE_LIMIT,
    WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE,
    type WebGPUAttachedGfxPass,
} from "./WebGPUAttachedGfxComparison";
import { WEBGPU_GFX_SHADER } from "./WebGPUGfxShader";

const WORLD_GFX_INSTANCE_FLOATS = WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES / 4;
const IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

export interface WebGPUWorldGfxPlacement {
    localX: number;
    localY: number;
    plane: number;
    rotation: number;
    modelYOffset: number;
    interactionId: number;
    colorOverride: DynamicActorColorOverride;
}

export interface WebGPUWorldGfxDrawSnapshot {
    frameToken: number;
    mapX: number;
    mapY: number;
    map: WebGLMapSquare;
    instanceId: number;
    spotId: number;
    spotFrame: number;
    geometry: DynamicActorGeometry;
    placement: WebGPUWorldGfxPlacement;
}

interface GeometryGpuResources {
    source: DynamicActorGeometry;
    vertexBuffer: WebGPUBufferLike;
    indexBuffer: WebGPUBufferLike;
    indexCount: number;
}

interface OrderedWorldGfxEntry {
    inst: GfxInstance;
    slot: number;
    yOffsetUnits: number;
}

const hostsByFrame = new WeakMap<object, WebGLOsrsRenderer>();
const runtimesByStaticRenderer = new WeakMap<WebGPUStaticSceneRenderer, WebGPUWorldGfxRuntime>();
let opaqueBoundaryPatched = false;
let alphaBoundaryPatched = false;
let disposeBoundaryPatched = false;

function mapKey(mapX: number, mapY: number): number {
    return (((mapX | 0) & 0xffff) << 16) | ((mapY | 0) & 0xffff);
}

function alignedBufferSize(byteLength: number): number {
    return Math.max(4, (Math.max(0, byteLength | 0) + 3) & ~3);
}

function comparisonRequested(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location?.search ?? "");
    const value = params.get("webgpuTerrain")?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "compare" || value === "split";
}

function getWorldYOffsetUnits(inst: GfxInstance): number {
    if (inst.anchor !== "offset") return 0;
    const tiles = inst.yOffsetTiles ?? inst.world?.heightOffsetTiles ?? 0;
    return Math.round(tiles * 128) | 0;
}

/** Match GfxRenderer: first-seen (spot,frame), then first-seen Y offset, then source order. */
export function orderWebGPUWorldGfxEntriesLikeWebGL(
    entries: readonly OrderedWorldGfxEntry[],
): OrderedWorldGfxEntry[] {
    const spotGroups = new Map<string, OrderedWorldGfxEntry[]>();
    for (const entry of entries) {
        if (entry.inst.startTimeMs == null || typeof entry.inst.lastSoundFrame !== "number") {
            continue;
        }
        const key = `${entry.inst.spotId | 0}|${entry.inst.lastSoundFrame | 0}`;
        let group = spotGroups.get(key);
        if (!group) {
            group = [];
            spotGroups.set(key, group);
        }
        group.push(entry);
    }

    const ordered: OrderedWorldGfxEntry[] = [];
    for (const group of spotGroups.values()) {
        const yOffsetGroups = new Map<number, OrderedWorldGfxEntry[]>();
        for (const entry of group) {
            let yGroup = yOffsetGroups.get(entry.yOffsetUnits);
            if (!yGroup) {
                yGroup = [];
                yOffsetGroups.set(entry.yOffsetUnits, yGroup);
            }
            yGroup.push(entry);
        }
        for (const yGroup of yOffsetGroups.values()) ordered.push(...yGroup);
    }
    return ordered;
}

export function packWebGPUWorldGfxInstanceData(
    placement: WebGPUWorldGfxPlacement,
): Float32Array {
    const data = new Float32Array(WORLD_GFX_INSTANCE_FLOATS);
    data[0] = placement.localX;
    data[1] = placement.localY;
    data[2] = placement.plane;
    data[3] = placement.rotation;
    data[4] = placement.colorOverride.hue;
    data[5] = placement.colorOverride.saturation;
    data[6] = placement.colorOverride.luminance;
    data[7] = placement.colorOverride.amount;
    data[8] = placement.modelYOffset;
    data[9] = placement.interactionId;
    // World-tile GFX are not actors/world-view entities. Keep the shared shader
    // ABI field explicit rather than inventing a fake DynamicActorIdentity.
    data[10] = -1;
    data[11] = 0;
    for (let i = 0; i < 16; i++) data[12 + i] = IDENTITY_MATRIX[i];
    return data;
}

function cacheGeometry(
    geometryByKey: Map<string, DynamicActorGeometry>,
    spotId: number,
    spotFrame: number,
    pass: WebGPUAttachedGfxPass,
    raw: { vertices: Uint8Array; indices: Int32Array },
): DynamicActorGeometry {
    const key = `world-gfx:${spotId | 0}:${spotFrame | 0}:${pass}`;
    const existing = geometryByKey.get(key);
    if (existing) {
        geometryByKey.delete(key);
        geometryByKey.set(key, existing);
        return existing;
    }
    const geometry =
        pass === "opaque"
            ? createDynamicActorGeometry(
                  key,
                  raw.vertices,
                  raw.indices,
                  new Uint8Array(0),
                  new Int32Array(0),
              )
            : createDynamicActorGeometry(
                  key,
                  new Uint8Array(0),
                  new Int32Array(0),
                  raw.vertices,
                  raw.indices,
              );
    geometryByKey.set(key, geometry);
    while (geometryByKey.size > WEBGPU_ATTACHED_GFX_GEOMETRY_CACHE_LIMIT) {
        const oldest = geometryByKey.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        geometryByKey.delete(oldest);
    }
    return geometry;
}

function createWorldGfxDraw(
    host: WebGLOsrsRenderer,
    geometryByKey: Map<string, DynamicActorGeometry>,
    map: WebGLMapSquare,
    pass: WebGPUAttachedGfxPass,
    entry: OrderedWorldGfxEntry,
    baseOffset: number,
    frameToken: number,
): WebGPUWorldGfxDrawSnapshot | undefined {
    const inst = entry.inst;
    if (!inst.world || inst.startTimeMs == null || typeof inst.lastSoundFrame !== "number") {
        return undefined;
    }
    const spotId = inst.spotId | 0;
    const spotFrame = inst.lastSoundFrame | 0;
    const raw = host.gfxRenderer
        ?.getCache?.()
        .ensureFrameGeometry(spotId, spotFrame, pass === "alpha");
    if (!raw || raw.vertices.byteLength === 0 || raw.indices.length === 0) return undefined;

    const recordIndex = (baseOffset | 0) + (entry.slot | 0);
    const wordOffset = recordIndex * DYNAMIC_ACTOR_WEBGL_RECORD_WORDS;
    if (
        wordOffset < 0 ||
        wordOffset + DYNAMIC_ACTOR_WEBGL_RECORD_WORDS > host.actorRenderData.length
    ) {
        return undefined;
    }
    const decoded = decodeDynamicActorWebGLRecord(host.actorRenderData, wordOffset);
    const geometry = cacheGeometry(geometryByKey, spotId, spotFrame, pass, raw);
    return {
        frameToken,
        mapX: map.mapX | 0,
        mapY: map.mapY | 0,
        map,
        instanceId: inst.id | 0,
        spotId,
        spotFrame,
        geometry,
        placement: {
            localX: decoded.localX,
            localY: decoded.localY,
            plane: decoded.plane,
            rotation: decoded.rotation,
            modelYOffset: -entry.yOffsetUnits,
            interactionId: decoded.interactionId | 0,
            colorOverride: decoded.colorOverride,
        },
    };
}

function collectWorldGfxDraws(
    host: WebGLOsrsRenderer,
    geometryByKey: Map<string, DynamicActorGeometry>,
    frame: SceneFrameDescription,
    pass: WebGPUAttachedGfxPass,
): WebGPUWorldGfxDrawSnapshot[] {
    const mgr = host.gfxManager;
    if (!mgr) return [];
    const out: WebGPUWorldGfxDrawSnapshot[] = [];
    const cullTile = host.getRenderCullTile();
    const renderDistanceTiles = Math.max(0, host.getFrameRenderDistanceTiles() | 0);
    const count = host.mapManager.visibleMapCount;
    const start = pass === "alpha" ? count - 1 : 0;
    const end = pass === "alpha" ? -1 : count;
    const step = pass === "alpha" ? -1 : 1;

    for (let i = start; i !== end; i += step) {
        const map = host.mapManager.visibleMaps[i];
        if (
            !host.isMapWithinRenderDistance(
                map,
                cullTile.x,
                cullTile.y,
                renderDistanceTiles,
                0,
            )
        ) {
            continue;
        }
        const baseOffset = map.worldGfxDataTextureOffsets?.[0] ?? -1;
        if (baseOffset < 0) continue;
        const entries = mgr.getWorldInstancesForMap(map).map((entry) => ({
            inst: entry.inst,
            slot: entry.slot | 0,
            yOffsetUnits: getWorldYOffsetUnits(entry.inst),
        }));
        const ordered = orderWebGPUWorldGfxEntriesLikeWebGL(entries);
        for (const entry of ordered) {
            const draw = createWorldGfxDraw(
                host,
                geometryByKey,
                map,
                pass,
                entry,
                baseOffset,
                frame.currentTime,
            );
            if (draw) out.push(draw);
        }
    }
    return out;
}

class WebGPUWorldGfxRuntime {
    private device?: WebGPUDeviceLike;
    private opaquePipeline?: WebGPURenderPipelineLike;
    private alphaPipeline?: WebGPURenderPipelineLike;
    private initPromise?: Promise<void>;
    private ready = false;
    private failed = false;
    private geometry = new Map<string, GeometryGpuResources>();
    private heightCache?: WebGPUDynamicHeightBindGroupCache;
    private instanceCache?: WebGPUGrowableBufferCache;
    readonly geometryByKey = new Map<string, DynamicActorGeometry>();

    constructor(private readonly staticRenderer: WebGPUStaticSceneRenderer) {}

    ensureInitialized(): void {
        if (this.ready || this.failed || this.initPromise) return;
        this.initPromise = this.init().catch((error) => {
            this.failed = true;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[WebGPU GFX comparison] World GFX pass disabled: ${message}`);
        });
    }

    private async init(): Promise<void> {
        const rendererAny = this.staticRenderer as any;
        const device = rendererAny.device as WebGPUDeviceLike | undefined;
        const sceneLayout = rendererAny.sceneBindGroupLayout as WebGPUBindGroupLayoutLike | undefined;
        const mapLayout = rendererAny.mapBindGroupLayout as WebGPUBindGroupLayoutLike | undefined;
        const textureLayout = rendererAny.textureBindGroupLayout as WebGPUBindGroupLayoutLike | undefined;
        const format = this.staticRenderer.backend.format;
        if (!device || !sceneLayout || !mapLayout || !textureLayout || !format) {
            throw new Error("Static WebGPU renderer layouts are unavailable");
        }
        const heightLayout = device.createBindGroupLayout({
            label: "world-gfx-height-bind-group-layout",
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
            ],
        });
        const module = await this.staticRenderer.backend.compileShaderModule(
            WEBGPU_GFX_SHADER,
            "world-gfx-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "world-gfx-pipeline-layout",
            bindGroupLayouts: [sceneLayout, mapLayout, textureLayout, heightLayout],
        });
        const vertex = {
            module,
            entryPoint: "vsGfx",
            buffers: [
                {
                    arrayStride: 12,
                    stepMode: "vertex",
                    attributes: [{ shaderLocation: 0, offset: 0, format: "uint32x3" }],
                },
                {
                    arrayStride: WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
                    stepMode: "instance",
                    attributes: [
                        { shaderLocation: 1, offset: 0, format: "float32x4" },
                        { shaderLocation: 2, offset: 16, format: "float32x4" },
                        { shaderLocation: 3, offset: 32, format: "float32x4" },
                        { shaderLocation: 4, offset: 48, format: "float32x4" },
                        { shaderLocation: 5, offset: 64, format: "float32x4" },
                        { shaderLocation: 6, offset: 80, format: "float32x4" },
                        { shaderLocation: 7, offset: 96, format: "float32x4" },
                    ],
                },
            ],
        };
        this.opaquePipeline = device.createRenderPipeline({
            label: "world-gfx-opaque-pipeline",
            layout: pipelineLayout,
            vertex,
            fragment: { module, entryPoint: "fsGfxOpaque", targets: [{ format }] },
            primitive: {
                topology: "triangle-list",
                frontFace: "ccw",
                cullMode: WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE.cullMode,
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE.depthWriteEnabled,
                depthCompare: WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE.depthCompare,
            },
        });
        this.alphaPipeline = device.createRenderPipeline({
            label: "world-gfx-alpha-pipeline",
            layout: pipelineLayout,
            vertex,
            fragment: {
                module,
                entryPoint: "fsGfxAlpha",
                targets: [{ format, blend: WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.blend }],
            },
            primitive: {
                topology: "triangle-list",
                frontFace: "ccw",
                cullMode: WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.cullMode,
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.depthWriteEnabled,
                depthCompare: WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.depthCompare,
            },
        });
        this.device = device;
        this.heightCache = new WebGPUDynamicHeightBindGroupCache(
            device,
            heightLayout,
            "world-gfx",
        );
        this.instanceCache = new WebGPUGrowableBufferCache(
            device,
            "world-gfx-instance",
        );
        this.ready = true;
    }

    private getGeometry(
        draw: WebGPUWorldGfxDrawSnapshot,
        pass: WebGPUAttachedGfxPass,
    ): GeometryGpuResources | undefined {
        const device = this.device;
        if (!device) return undefined;
        const sourcePass = pass === "opaque" ? draw.geometry.opaque : draw.geometry.alpha;
        if (sourcePass.indices.length === 0 || sourcePass.vertices.byteLength === 0) return undefined;
        const existing = this.geometry.get(draw.geometry.key);
        if (existing?.source === draw.geometry) return existing;
        if (existing) {
            existing.vertexBuffer.destroy?.();
            existing.indexBuffer.destroy?.();
        }
        const vertexBuffer = device.createBuffer({
            label: `${draw.geometry.key}-vertices`,
            size: alignedBufferSize(sourcePass.vertices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.VERTEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        const indexBuffer = device.createBuffer({
            label: `${draw.geometry.key}-indices`,
            size: alignedBufferSize(sourcePass.indices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.INDEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, sourcePass.vertices);
        device.queue.writeBuffer(indexBuffer, 0, sourcePass.indices);
        const resources = {
            source: draw.geometry,
            vertexBuffer,
            indexBuffer,
            indexCount: sourcePass.indices.length | 0,
        };
        this.geometry.set(draw.geometry.key, resources);
        return resources;
    }

    private getHeight(draw: WebGPUWorldGfxDrawSnapshot) {
        const mapAny = draw.map as any;
        return this.heightCache?.get(
            mapKey(draw.mapX, draw.mapY),
            mapAny.heightMapData as Int16Array | undefined,
            mapAny.heightMapSize | 0,
        );
    }

    private getInstanceBuffer(key: string, data: Float32Array): WebGPUBufferLike | undefined {
        return this.instanceCache?.getOrWrite(key, data);
    }

    draw(
        passEncoder: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        host: WebGLOsrsRenderer,
        pass: WebGPUAttachedGfxPass,
    ): void {
        if (this.failed) return;
        if (!this.ready) {
            this.ensureInitialized();
            return;
        }
        const rendererAny = this.staticRenderer as any;
        const mapsById = rendererAny.mapsById as Map<number, any> | undefined;
        const pipeline = pass === "opaque" ? this.opaquePipeline : this.alphaPipeline;
        if (!mapsById || !pipeline) return;
        const draws = collectWorldGfxDraws(host, this.geometryByKey, frame, pass);
        passEncoder.setPipeline(pipeline);
        for (const draw of draws) {
            if (draw.frameToken !== frame.currentTime) continue;
            const mapResources = mapsById.get(mapKey(draw.mapX, draw.mapY));
            const height = this.getHeight(draw);
            const geometry = this.getGeometry(draw, pass);
            if (!mapResources || !height || !geometry || geometry.indexCount <= 0) continue;
            passEncoder.setBindGroup(1, mapResources.sharedMapBindGroup);
            passEncoder.setBindGroup(3, height.bindGroup);
            const instanceData = packWebGPUWorldGfxInstanceData(draw.placement);
            const bufferKey = `${pass}:${draw.mapX}:${draw.mapY}:${draw.geometry.key}:world:${draw.instanceId}`;
            const instanceBuffer = this.getInstanceBuffer(bufferKey, instanceData);
            if (!instanceBuffer) continue;
            passEncoder.setVertexBuffer(0, geometry.vertexBuffer);
            passEncoder.setVertexBuffer(1, instanceBuffer);
            passEncoder.setIndexBuffer(geometry.indexBuffer, "uint32");
            passEncoder.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
        }
    }

    dispose(): void {
        for (const resources of this.geometry.values()) {
            resources.vertexBuffer.destroy?.();
            resources.indexBuffer.destroy?.();
        }
        this.geometry.clear();
        this.geometryByKey.clear();
        this.heightCache?.dispose();
        this.heightCache = undefined;
        this.instanceCache?.dispose();
        this.instanceCache = undefined;
        this.device = undefined;
        this.opaquePipeline = undefined;
        this.alphaPipeline = undefined;
        this.ready = false;
    }
}

function getRuntime(renderer: WebGPUStaticSceneRenderer): WebGPUWorldGfxRuntime {
    let runtime = runtimesByStaticRenderer.get(renderer);
    if (!runtime) {
        runtime = new WebGPUWorldGfxRuntime(renderer);
        runtimesByStaticRenderer.set(renderer, runtime);
    }
    return runtime;
}

function patchDisposeBoundary(): void {
    if (disposeBoundaryPatched) return;
    disposeBoundaryPatched = true;
    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const previousDispose = proto.dispose;
    proto.dispose = function (this: WebGPUStaticSceneRenderer) {
        const runtime = runtimesByStaticRenderer.get(this);
        runtime?.dispose();
        runtimesByStaticRenderer.delete(this);
        return previousDispose.call(this);
    };
}

function patchOpaqueBoundary(): void {
    if (opaqueBoundaryPatched) return;
    opaqueBoundaryPatched = true;
    patchDisposeBoundary();
    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const previous = proto.drawOpaqueScene;
    proto.drawOpaqueScene = function (
        this: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ) {
        previous.call(this, pass, frame, terrainPipeline, locPipeline);
        const host = hostsByFrame.get(frame as object);
        if (!host) return;
        getRuntime(this).draw(pass, frame, host, "opaque");
    };
}

/** Install after NPC-attached GFX alpha and before player alpha. */
export function installWebGPUWorldGfxAlphaBoundary(): void {
    if (alphaBoundaryPatched) return;
    alphaBoundaryPatched = true;
    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const previous = proto.drawTransparentScene;
    proto.drawTransparentScene = function (
        this: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ) {
        previous.call(this, pass, frame, terrainPipeline, locPipeline);
        const host = hostsByFrame.get(frame as object);
        if (!host) return;
        getRuntime(this).draw(pass, frame, host, "alpha");
    };
}

export function installWebGPUWorldGfxComparison(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};
    const host = renderer as WebGLOsrsRenderer;
    const frame = host.sceneFrameDescription as SceneFrameDescription | undefined;
    if (!frame || !host.gfxManager || !host.gfxRenderer) return () => {};
    patchOpaqueBoundary();
    hostsByFrame.set(frame as object, host);
    return () => {
        hostsByFrame.delete(frame as object);
    };
}
