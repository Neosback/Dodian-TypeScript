import type { Renderer } from "../../../game/render/Renderer";
import { resolveHeightSamplePlaneForLocal } from "../../../game/scene/PlaneResolver";
import { clamp } from "../../../common/utils/MathUtil";
import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import type { WebGLMapSquare } from "../../WebGLMapSquare";
import {
    createDynamicActorGeometry,
    type DynamicActorGeometry,
    type DynamicActorInstance,
} from "../../dynamic/DynamicActorRenderData";
import {
    WEBGPU_BUFFER_USAGE,
    WEBGPU_SHADER_STAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
    type WebGPURenderPassEncoderLike,
    type WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import {
    WEBGPU_HEIGHT_MAP_LAYERS,
    WebGPUHeightMapResources,
} from "../loc/WebGPUHeightMapResources";
import { WEBGPU_PLAYER_OPAQUE_SHADER } from "./WebGPUPlayerOpaqueShader";

const PLAYER_INTERACT_BASE = 0x8000;
const PLAYER_INSTANCE_FLOATS = 28;
export const WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES = PLAYER_INSTANCE_FLOATS * 4;
export const WEBGPU_PLAYER_GEOMETRY_CACHE_LIMIT = 384;

const IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

export type WebGPUPlayerOpaquePipelineVariant = "opaque-cull" | "opaque-no-cull";

export function getWebGPUPlayerOpaquePipelineVariant(
    doubleSided: boolean,
    cullBackFace: boolean,
): WebGPUPlayerOpaquePipelineVariant {
    return !doubleSided && cullBackFace ? "opaque-cull" : "opaque-no-cull";
}

export interface WebGPUPlayerOpaqueBatchSnapshot {
    geometry: DynamicActorGeometry;
    instances: DynamicActorInstance[];
    doubleSided: boolean;
}

export interface WebGPUPlayerOpaqueMapSnapshot {
    frameToken: number;
    mapX: number;
    mapY: number;
    map: WebGLMapSquare;
    batches: WebGPUPlayerOpaqueBatchSnapshot[];
}

interface PlayerComparisonHostState {
    currentFrameToken: number;
    snapshots: Map<number, WebGPUPlayerOpaqueMapSnapshot>;
    geometryByKey: Map<string, DynamicActorGeometry>;
    restorePlayerHook?: () => void;
}

interface GeometryGpuResources {
    source: DynamicActorGeometry;
    vertexBuffer: WebGPUBufferLike;
    indexBuffer: WebGPUBufferLike;
    indexCount: number;
}

interface HeightGpuResources {
    source: Int16Array;
    size: number;
    heightMap: WebGPUHeightMapResources;
    bindGroup: WebGPUBindGroupLike;
}

interface InstanceGpuResources {
    buffer: WebGPUBufferLike;
    capacityBytes: number;
}

const hostStates = new WeakMap<WebGLOsrsRenderer, PlayerComparisonHostState>();
const hostsByFrame = new WeakMap<object, WebGLOsrsRenderer>();
const runtimesByStaticRenderer = new WeakMap<WebGPUStaticSceneRenderer, WebGPUPlayerOpaqueRuntime>();
let prototypePatched = false;

function mapId(mapX: number, mapY: number): number {
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

function cacheGeometry(
    state: PlayerComparisonHostState,
    key: string,
    raw: { verts: Uint8Array; inds: Int32Array; vertsA: Uint8Array; indsA: Int32Array },
): DynamicActorGeometry {
    const existing = state.geometryByKey.get(key);
    if (existing) {
        state.geometryByKey.delete(key);
        state.geometryByKey.set(key, existing);
        return existing;
    }

    const geometry = createDynamicActorGeometry(
        key,
        new Uint8Array(raw.verts),
        new Int32Array(raw.inds),
        new Uint8Array(raw.vertsA),
        new Int32Array(raw.indsA),
    );
    state.geometryByKey.set(key, geometry);
    while (state.geometryByKey.size > WEBGPU_PLAYER_GEOMETRY_CACHE_LIMIT) {
        const oldest = state.geometryByKey.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        state.geometryByKey.delete(oldest);
    }
    return geometry;
}

function resolvePlayerColorOverride(host: WebGLOsrsRenderer, pid: number) {
    const override = host.osrsClient.playerEcs.getColorOverride(pid);
    const clientCycle = (host.osrsClient as any).clientCycle | 0;
    if (
        override.amount !== 0 &&
        clientCycle >= override.startCycle &&
        clientCycle < override.endCycle
    ) {
        return {
            hue: override.hue & 0x7f,
            saturation: override.sat & 0x7f,
            luminance: override.lum & 0x7f,
            amount: override.amount & 0xff,
        };
    }
    return { hue: 0, saturation: 0, luminance: 0, amount: 0 };
}

function capturePlayerOpaqueMap(
    host: WebGLOsrsRenderer,
    map: WebGLMapSquare,
    state: PlayerComparisonHostState,
): void {
    const frameToken = host.sceneFrameDescription.currentTime;
    if (state.currentFrameToken !== frameToken) {
        state.currentFrameToken = frameToken;
        state.snapshots.clear();
    }

    const playerRenderer = host.playerRenderer as any;
    const groups = playerRenderer.batchGroups as Map<string, any> | undefined;
    if (!groups) return;

    const playerEcs = host.osrsClient.playerEcs;
    const mapBaseTileX = map.getRenderBaseTileX();
    const mapBaseTileY = map.getRenderBaseTileY();
    const mapTileSpan = map.getLocalTileSpan();
    const playerDeckHeight = host.getWorldEntityDeckHeight(0, 0);
    const batches: WebGPUPlayerOpaqueBatchSnapshot[] = [];

    for (const [batchKey, group] of groups) {
        if (!group?.instances?.length) continue;
        const baseRec = playerRenderer.ensureBaseForAppearance?.(group.appearance);
        if (!baseRec) continue;

        const source = group.instances[0];
        let rawGeometry = playerRenderer.geomCache?.get?.(batchKey);
        if (!rawGeometry) {
            playerRenderer.dynamicUpdateBuffersFor?.(
                baseRec.baseModel,
                baseRec.baseCenterX,
                baseRec.baseCenterZ,
                group.seqId | 0,
                group.frameIdx | 0,
                batchKey,
                source.pid | 0,
                source.mode,
                group.overlaySeqId,
                group.overlayFrameIdx,
                "cacheOnly",
            );
            rawGeometry = playerRenderer.geomCache?.get?.(batchKey);
        }
        if (!rawGeometry || !(rawGeometry.inds?.length > 0)) continue;

        const geometry = cacheGeometry(state, batchKey, rawGeometry);
        const instances: DynamicActorInstance[] = [];

        for (const sourceInstance of group.instances) {
            const pid = sourceInstance.pid | 0;
            const slot = sourceInstance.slot | 0;
            const px = playerEcs.getX(pid) | 0;
            const py = playerEcs.getY(pid) | 0;
            const tileX = (px / 128) | 0;
            const tileY = (py / 128) | 0;
            const localTileX = clamp(tileX - mapBaseTileX, 0, Math.max(0, mapTileSpan - 1));
            const localTileY = clamp(tileY - mapBaseTileY, 0, Math.max(0, mapTileSpan - 1));
            const renderPlane = resolveHeightSamplePlaneForLocal(
                map,
                playerEcs.getLevel(pid) | 0,
                localTileX,
                localTileY,
            );
            const localX = (px - mapBaseTileX * 128) | 0;
            const localY = (py - mapBaseTileY * 128) | 0;
            const rotation =
                (playerEcs.getRotation(pid) + ((host as any).playerRotationBiasUnits ?? 0)) & 2047;
            const worldViewId = playerEcs.getWorldViewId?.(pid) ?? -1;
            const serverId = playerEcs.getServerIdForIndex(pid);

            instances.push({
                identity: {
                    kind: "player",
                    actorId: pid,
                    serverId,
                    worldViewId,
                    interactionId: PLAYER_INTERACT_BASE + (slot & 0x7fff),
                    sourceMapId: map.id,
                },
                transform: {
                    localX,
                    localY,
                    plane: renderPlane,
                    rotation,
                    modelYOffset:
                        host.playerYOffset + (worldViewId >= 0 ? playerDeckHeight : 0),
                },
                animation: {
                    sequenceId: group.seqId | 0,
                    frameId: group.frameIdx | 0,
                    overlaySequenceId:
                        typeof group.overlaySeqId === "number" ? group.overlaySeqId | 0 : undefined,
                    overlayFrameId:
                        typeof group.overlayFrameIdx === "number" ? group.overlayFrameIdx | 0 : undefined,
                    mode: sourceInstance.mode,
                },
                colorOverride: resolvePlayerColorOverride(host, pid),
                geometryKey: batchKey,
            });
        }

        if (instances.length > 0) {
            batches.push({
                geometry,
                instances,
                doubleSided: !!group.appearance?.firstPersonArmsOnly,
            });
        }
    }

    state.snapshots.set(mapId(map.mapX, map.mapY), {
        frameToken,
        mapX: map.mapX | 0,
        mapY: map.mapY | 0,
        map,
        batches,
    });
}

export function packWebGPUPlayerInstanceData(
    instances: readonly DynamicActorInstance[],
    resolveWorldTransform?: (instance: DynamicActorInstance) => ArrayLike<number> | undefined,
): Float32Array {
    const data = new Float32Array(instances.length * PLAYER_INSTANCE_FLOATS);
    for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const offset = i * PLAYER_INSTANCE_FLOATS;
        data[offset + 0] = instance.transform.localX;
        data[offset + 1] = instance.transform.localY;
        data[offset + 2] = instance.transform.plane;
        data[offset + 3] = instance.transform.rotation;
        data[offset + 4] = instance.colorOverride.hue;
        data[offset + 5] = instance.colorOverride.saturation;
        data[offset + 6] = instance.colorOverride.luminance;
        data[offset + 7] = instance.colorOverride.amount;
        data[offset + 8] = instance.transform.modelYOffset ?? 0;
        data[offset + 9] = instance.identity.interactionId;
        data[offset + 10] = instance.identity.worldViewId ?? -1;
        data[offset + 11] = 0;

        const transform = resolveWorldTransform?.(instance) ?? IDENTITY_MATRIX;
        for (let j = 0; j < 16; j++) {
            data[offset + 12 + j] = Number(transform[j] ?? IDENTITY_MATRIX[j]);
        }
    }
    return data;
}

class WebGPUPlayerOpaqueRuntime {
    private device?: WebGPUDeviceLike;
    private heightLayout?: WebGPUBindGroupLayoutLike;
    private cullPipeline?: WebGPURenderPipelineLike;
    private noCullPipeline?: WebGPURenderPipelineLike;
    private initPromise?: Promise<void>;
    private ready = false;
    private failed = false;
    private geometry = new Map<string, GeometryGpuResources>();
    private heights = new Map<number, HeightGpuResources>();
    private instances = new Map<string, InstanceGpuResources>();

    constructor(private readonly staticRenderer: WebGPUStaticSceneRenderer) {}

    ensureInitialized(): void {
        if (this.ready || this.failed || this.initPromise) return;
        this.initPromise = this.init().catch((error) => {
            this.failed = true;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[WebGPU player comparison] Opaque player pass disabled: ${message}`);
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
            label: "player-opaque-height-bind-group-layout",
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
            WEBGPU_PLAYER_OPAQUE_SHADER,
            "player-opaque-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "player-opaque-pipeline-layout",
            bindGroupLayouts: [sceneLayout, mapLayout, textureLayout, heightLayout],
        });
        const createPipeline = (label: string, cullMode: "back" | "none") =>
            device.createRenderPipeline({
                label,
                layout: pipelineLayout,
                vertex: {
                    module,
                    entryPoint: "vsPlayerOpaque",
                    buffers: [
                        {
                            arrayStride: 12,
                            stepMode: "vertex",
                            attributes: [
                                { shaderLocation: 0, offset: 0, format: "uint32x3" },
                            ],
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
                },
                fragment: {
                    module,
                    entryPoint: "fsPlayerOpaque",
                    targets: [{ format }],
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

        this.device = device;
        this.heightLayout = heightLayout;
        this.cullPipeline = createPipeline("player-opaque-cull-pipeline", "back");
        this.noCullPipeline = createPipeline("player-opaque-no-cull-pipeline", "none");
        this.ready = true;
    }

    private getGeometry(batch: WebGPUPlayerOpaqueBatchSnapshot): GeometryGpuResources | undefined {
        const device = this.device;
        if (!device || batch.geometry.opaque.indices.length === 0) return undefined;
        const key = batch.geometry.key;
        const existing = this.geometry.get(key);
        if (existing?.source === batch.geometry) return existing;
        if (existing) {
            existing.vertexBuffer.destroy?.();
            existing.indexBuffer.destroy?.();
        }

        const vertexBuffer = device.createBuffer({
            label: `player-${key}-vertices`,
            size: alignedBufferSize(batch.geometry.opaque.vertices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.VERTEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        const indexBuffer = device.createBuffer({
            label: `player-${key}-indices`,
            size: alignedBufferSize(batch.geometry.opaque.indices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.INDEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, batch.geometry.opaque.vertices);
        device.queue.writeBuffer(indexBuffer, 0, batch.geometry.opaque.indices);
        const resources = {
            source: batch.geometry,
            vertexBuffer,
            indexBuffer,
            indexCount: batch.geometry.opaque.indices.length | 0,
        };
        this.geometry.set(key, resources);
        return resources;
    }

    private getHeight(snapshot: WebGPUPlayerOpaqueMapSnapshot): HeightGpuResources | undefined {
        const device = this.device;
        const heightLayout = this.heightLayout;
        if (!device || !heightLayout) return undefined;
        const mapAny = snapshot.map as any;
        const source = mapAny.heightMapData as Int16Array | undefined;
        const size = mapAny.heightMapSize | 0;
        if (!source || !(size > 0)) return undefined;
        const id = mapId(snapshot.mapX, snapshot.mapY);
        const existing = this.heights.get(id);
        if (existing && existing.source === source && existing.size === size) return existing;
        if (existing) existing.heightMap.dispose();

        const heightMap = new WebGPUHeightMapResources(device, size, source);
        const bindGroup = device.createBindGroup({
            label: `player-${snapshot.mapX}-${snapshot.mapY}-height-bind-group`,
            layout: heightLayout,
            entries: [
                {
                    binding: 0,
                    resource: heightMap.texture.createView({
                        dimension: "2d-array",
                        baseArrayLayer: 0,
                        arrayLayerCount: WEBGPU_HEIGHT_MAP_LAYERS,
                    }),
                },
            ],
        });
        const resources = { source, size, heightMap, bindGroup };
        this.heights.set(id, resources);
        return resources;
    }

    private getInstanceBuffer(key: string, data: Float32Array): WebGPUBufferLike | undefined {
        const device = this.device;
        if (!device || data.byteLength === 0) return undefined;
        let resources = this.instances.get(key);
        const required = alignedBufferSize(data.byteLength);
        if (!resources || resources.capacityBytes < required) {
            resources?.buffer.destroy?.();
            const capacityBytes = Math.max(required, resources?.capacityBytes ? resources.capacityBytes * 2 : required);
            resources = {
                buffer: device.createBuffer({
                    label: `player-${key}-instances`,
                    size: capacityBytes,
                    usage: WEBGPU_BUFFER_USAGE.VERTEX | WEBGPU_BUFFER_USAGE.COPY_DST,
                }),
                capacityBytes,
            };
            this.instances.set(key, resources);
        }
        device.queue.writeBuffer(resources.buffer, 0, data);
        return resources.buffer;
    }

    draw(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        host: WebGLOsrsRenderer,
        state: PlayerComparisonHostState,
    ): void {
        if (this.failed) return;
        if (!this.ready) {
            this.ensureInitialized();
            return;
        }
        const rendererAny = this.staticRenderer as any;
        const mapsById = rendererAny.mapsById as Map<number, any> | undefined;
        if (!mapsById) return;

        for (const snapshot of state.snapshots.values()) {
            if (snapshot.frameToken !== frame.currentTime) continue;
            const mapResources = mapsById.get(mapId(snapshot.mapX, snapshot.mapY));
            const height = this.getHeight(snapshot);
            if (!mapResources || !height) continue;

            pass.setBindGroup(1, mapResources.sharedMapBindGroup);
            pass.setBindGroup(3, height.bindGroup);

            for (const batch of snapshot.batches) {
                if (batch.instances.length === 0) continue;
                const geometry = this.getGeometry(batch);
                if (!geometry || geometry.indexCount <= 0) continue;
                const instanceData = packWebGPUPlayerInstanceData(batch.instances, (instance) => {
                    const worldViewId = instance.identity.worldViewId ?? -1;
                    if (worldViewId < 0) return IDENTITY_MATRIX;
                    return host.worldEntityAnimator?.getTransform(worldViewId) ?? IDENTITY_MATRIX;
                });
                const bufferKey = `${snapshot.mapX}:${snapshot.mapY}:${batch.geometry.key}:${batch.doubleSided ? 1 : 0}`;
                const instanceBuffer = this.getInstanceBuffer(bufferKey, instanceData);
                if (!instanceBuffer) continue;

                const variant = getWebGPUPlayerOpaquePipelineVariant(
                    batch.doubleSided,
                    frame.cullBackFace,
                );
                const pipeline = variant === "opaque-cull" ? this.cullPipeline : this.noCullPipeline;
                if (!pipeline) continue;

                pass.setPipeline(pipeline);
                pass.setVertexBuffer(0, geometry.vertexBuffer);
                pass.setVertexBuffer(1, instanceBuffer);
                pass.setIndexBuffer(geometry.indexBuffer, "uint32");
                pass.drawIndexed(
                    geometry.indexCount,
                    batch.instances.length,
                    0,
                    0,
                    0,
                );
            }
        }
    }

    dispose(): void {
        for (const resources of this.geometry.values()) {
            resources.vertexBuffer.destroy?.();
            resources.indexBuffer.destroy?.();
        }
        this.geometry.clear();
        for (const resources of this.heights.values()) resources.heightMap.dispose();
        this.heights.clear();
        for (const resources of this.instances.values()) resources.buffer.destroy?.();
        this.instances.clear();
        this.device = undefined;
        this.heightLayout = undefined;
        this.cullPipeline = undefined;
        this.noCullPipeline = undefined;
        this.ready = false;
    }
}

function patchStaticRendererPrototype(): void {
    if (prototypePatched) return;
    prototypePatched = true;
    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const originalDrawOpaqueScene = proto.drawOpaqueScene;
    const originalDispose = proto.dispose;

    proto.drawOpaqueScene = function (
        this: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ) {
        originalDrawOpaqueScene.call(this, pass, frame, terrainPipeline, locPipeline);
        const host = hostsByFrame.get(frame as object);
        if (!host) return;
        const state = hostStates.get(host);
        if (!state || state.currentFrameToken !== frame.currentTime) return;
        let runtime = runtimesByStaticRenderer.get(this);
        if (!runtime) {
            runtime = new WebGPUPlayerOpaqueRuntime(this);
            runtimesByStaticRenderer.set(this, runtime);
        }
        runtime.draw(pass, frame, host, state);
    };

    proto.dispose = function (this: WebGPUStaticSceneRenderer) {
        const runtime = runtimesByStaticRenderer.get(this);
        runtime?.dispose();
        runtimesByStaticRenderer.delete(this);
        return originalDispose.call(this);
    };
}

export function installWebGPUPlayerOpaqueComparison(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};
    const host = renderer as WebGLOsrsRenderer;
    const playerRenderer = (host as any).playerRenderer as any;
    const frame = (host as any).sceneFrameDescription as SceneFrameDescription | undefined;
    if (!playerRenderer?.renderOpaqueForMap || !frame) return () => {};

    patchStaticRendererPrototype();
    const existing = hostStates.get(host);
    if (existing) return existing.restorePlayerHook ?? (() => {});

    const state: PlayerComparisonHostState = {
        currentFrameToken: Number.NaN,
        snapshots: new Map(),
        geometryByKey: new Map(),
    };
    hostStates.set(host, state);
    hostsByFrame.set(frame as object, host);

    const previous = playerRenderer.renderOpaqueForMap;
    const wrapper = function (this: unknown, map: WebGLMapSquare, ...args: unknown[]) {
        const result = previous.call(this, map, ...args);
        try {
            capturePlayerOpaqueMap(host, map, state);
        } catch (error) {
            console.warn("[WebGPU player comparison] Failed to capture player snapshot", error);
        }
        return result;
    };
    playerRenderer.renderOpaqueForMap = wrapper;

    const restore = () => {
        if (playerRenderer.renderOpaqueForMap === wrapper) {
            playerRenderer.renderOpaqueForMap = previous;
        }
        hostsByFrame.delete(frame as object);
        state.snapshots.clear();
        state.geometryByKey.clear();
        hostStates.delete(host);
    };
    state.restorePlayerHook = restore;
    return restore;
}
