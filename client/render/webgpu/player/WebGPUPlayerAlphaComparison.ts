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
import {
    WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
    packWebGPUPlayerInstanceData,
} from "./WebGPUPlayerOpaqueComparison";
import { WEBGPU_PLAYER_ALPHA_SHADER } from "./WebGPUPlayerAlphaShader";

const PLAYER_INTERACT_BASE = 0x8000;
export const WEBGPU_PLAYER_ALPHA_GEOMETRY_CACHE_LIMIT = 384;

const IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

export const WEBGPU_PLAYER_ALPHA_PIPELINE_STATE = {
    cullMode: "none",
    depthWriteEnabled: true,
    depthCompare: "less-equal",
    blend: {
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
    },
} as const;

export interface WebGPUPlayerAlphaBatchSnapshot {
    geometry: DynamicActorGeometry;
    instances: DynamicActorInstance[];
}

export interface WebGPUPlayerAlphaMapSnapshot {
    frameToken: number;
    mapX: number;
    mapY: number;
    map: WebGLMapSquare;
    batches: WebGPUPlayerAlphaBatchSnapshot[];
}

interface PlayerAlphaComparisonHostState {
    currentFrameToken: number;
    snapshots: Map<number, WebGPUPlayerAlphaMapSnapshot>;
    geometryByKey: Map<string, DynamicActorGeometry>;
    restoreCapture?: () => void;
}

interface GeometryGpuResources {
    source: DynamicActorGeometry;
    vertexBuffer: WebGPUBufferLike;
    indexBuffer: WebGPUBufferLike;
    indexCount: number;
}

const hostStates = new WeakMap<WebGLOsrsRenderer, PlayerAlphaComparisonHostState>();
const hostsByFrame = new WeakMap<object, WebGLOsrsRenderer>();
const runtimesByStaticRenderer = new WeakMap<WebGPUStaticSceneRenderer, WebGPUPlayerAlphaRuntime>();
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

function cacheAlphaGeometry(
    state: PlayerAlphaComparisonHostState,
    key: string,
    raw: { vertsA: Uint8Array; indsA: Int32Array },
): DynamicActorGeometry {
    const cacheKey = `player-alpha:${key}`;
    const existing = state.geometryByKey.get(cacheKey);
    if (existing) {
        state.geometryByKey.delete(cacheKey);
        state.geometryByKey.set(cacheKey, existing);
        return existing;
    }

    const geometry = createDynamicActorGeometry(
        cacheKey,
        new Uint8Array(0),
        new Int32Array(0),
        new Uint8Array(raw.vertsA),
        new Int32Array(raw.indsA),
    );
    state.geometryByKey.set(cacheKey, geometry);
    while (state.geometryByKey.size > WEBGPU_PLAYER_ALPHA_GEOMETRY_CACHE_LIMIT) {
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

function capturePlayerAlphaMap(
    host: WebGLOsrsRenderer,
    map: WebGLMapSquare,
    state: PlayerAlphaComparisonHostState,
): void {
    const frameToken = host.sceneFrameDescription.currentTime;
    if (state.currentFrameToken !== frameToken) {
        state.currentFrameToken = frameToken;
        state.snapshots.clear();
    }

    const playerRenderer = host.playerRenderer as any;
    const groups = playerRenderer.batchGroups as Map<string, any> | undefined;
    const batches: WebGPUPlayerAlphaBatchSnapshot[] = [];
    if (!groups || groups.size === 0) {
        state.snapshots.set(mapId(map.mapX, map.mapY), {
            frameToken,
            mapX: map.mapX | 0,
            mapY: map.mapY | 0,
            map,
            batches,
        });
        return;
    }

    const playerEcs = host.osrsClient.playerEcs;
    const mapBaseTileX = map.getRenderBaseTileX();
    const mapBaseTileY = map.getRenderBaseTileY();
    const mapTileSpan = map.getLocalTileSpan();
    const playerDeckHeight = host.getWorldEntityDeckHeight(0, 0);

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
        if (
            !rawGeometry ||
            !(rawGeometry.vertsA?.byteLength > 0) ||
            !(rawGeometry.indsA?.length > 0)
        ) {
            continue;
        }

        const geometry = cacheAlphaGeometry(state, batchKey, rawGeometry);
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
                geometryKey: geometry.key,
            });
        }

        if (instances.length > 0) {
            batches.push({ geometry, instances });
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

class WebGPUPlayerAlphaRuntime {
    private device?: WebGPUDeviceLike;
    private pipeline?: WebGPURenderPipelineLike;
    private initPromise?: Promise<void>;
    private ready = false;
    private failed = false;
    private geometry = new Map<string, GeometryGpuResources>();
    private heightCache?: WebGPUDynamicHeightBindGroupCache;
    private instanceCache?: WebGPUGrowableBufferCache;

    constructor(private readonly staticRenderer: WebGPUStaticSceneRenderer) {}

    ensureInitialized(): void {
        if (this.ready || this.failed || this.initPromise) return;
        this.initPromise = this.init().catch((error) => {
            this.failed = true;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[WebGPU player comparison] Alpha player pass disabled: ${message}`);
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
            label: "player-alpha-height-bind-group-layout",
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
            WEBGPU_PLAYER_ALPHA_SHADER,
            "player-alpha-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "player-alpha-pipeline-layout",
            bindGroupLayouts: [sceneLayout, mapLayout, textureLayout, heightLayout],
        });
        const pipeline = device.createRenderPipeline({
            label: "player-alpha-pipeline",
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
                entryPoint: "fsPlayerAlpha",
                targets: [
                    {
                        format,
                        blend: WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.blend,
                    },
                ],
            },
            primitive: {
                topology: "triangle-list",
                frontFace: "ccw",
                cullMode: WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.cullMode,
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.depthWriteEnabled,
                depthCompare: WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.depthCompare,
            },
        });

        this.device = device;
        this.heightCache = new WebGPUDynamicHeightBindGroupCache(
            device,
            heightLayout,
            "player-alpha",
        );
        this.instanceCache = new WebGPUGrowableBufferCache(
            device,
            "player-alpha-instance",
        );
        this.pipeline = pipeline;
        this.ready = true;
    }

    private getGeometry(batch: WebGPUPlayerAlphaBatchSnapshot): GeometryGpuResources | undefined {
        const device = this.device;
        if (!device || batch.geometry.alpha.indices.length === 0) return undefined;
        const key = batch.geometry.key;
        const existing = this.geometry.get(key);
        if (existing?.source === batch.geometry) return existing;
        if (existing) {
            existing.vertexBuffer.destroy?.();
            existing.indexBuffer.destroy?.();
        }

        const vertexBuffer = device.createBuffer({
            label: `${key}-vertices`,
            size: alignedBufferSize(batch.geometry.alpha.vertices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.VERTEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        const indexBuffer = device.createBuffer({
            label: `${key}-indices`,
            size: alignedBufferSize(batch.geometry.alpha.indices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.INDEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, batch.geometry.alpha.vertices);
        device.queue.writeBuffer(indexBuffer, 0, batch.geometry.alpha.indices);
        const resources = {
            source: batch.geometry,
            vertexBuffer,
            indexBuffer,
            indexCount: batch.geometry.alpha.indices.length | 0,
        };
        this.geometry.set(key, resources);
        return resources;
    }

    private getHeight(snapshot: WebGPUPlayerAlphaMapSnapshot) {
        const mapAny = snapshot.map as any;
        return this.heightCache?.get(
            mapId(snapshot.mapX, snapshot.mapY),
            mapAny.heightMapData as Int16Array | undefined,
            mapAny.heightMapSize | 0,
        );
    }

    private getInstanceBuffer(key: string, data: Float32Array): WebGPUBufferLike | undefined {
        return this.instanceCache?.getOrWrite(key, data);
    }

    draw(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        host: WebGLOsrsRenderer,
        state: PlayerAlphaComparisonHostState,
    ): void {
        if (this.failed) return;
        if (!this.ready) {
            this.ensureInitialized();
            return;
        }
        const rendererAny = this.staticRenderer as any;
        const mapsById = rendererAny.mapsById as Map<number, any> | undefined;
        const pipeline = this.pipeline;
        if (!mapsById || !pipeline) return;

        pass.setPipeline(pipeline);
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
                const bufferKey = `${snapshot.mapX}:${snapshot.mapY}:${batch.geometry.key}`;
                const instanceBuffer = this.getInstanceBuffer(bufferKey, instanceData);
                if (!instanceBuffer) continue;

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
        this.heightCache?.dispose();
        this.heightCache = undefined;
        this.instanceCache?.dispose();
        this.instanceCache = undefined;
        this.device = undefined;
        this.pipeline = undefined;
        this.ready = false;
    }
}

function patchStaticRendererPrototype(): void {
    if (prototypePatched) return;
    prototypePatched = true;
    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const originalDrawTransparentScene = proto.drawTransparentScene;
    const originalDispose = proto.dispose;

    proto.drawTransparentScene = function (
        this: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ) {
        // WebGL order is transparent static scene first, then transparent NPCs,
        // then transparent players. NPCs are a later checkpoint, so append the
        // player alpha pass after the complete static transparent traversal.
        originalDrawTransparentScene.call(this, pass, frame, terrainPipeline, locPipeline);
        const host = hostsByFrame.get(frame as object);
        if (!host) return;
        const state = hostStates.get(host);
        if (!state || state.currentFrameToken !== frame.currentTime) return;
        let runtime = runtimesByStaticRenderer.get(this);
        if (!runtime) {
            runtime = new WebGPUPlayerAlphaRuntime(this);
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

export function installWebGPUPlayerAlphaComparison(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};
    const host = renderer as WebGLOsrsRenderer;
    const playerRenderer = (host as any).playerRenderer as any;
    const frame = (host as any).sceneFrameDescription as SceneFrameDescription | undefined;
    if (!playerRenderer?.renderOpaqueForMap || !frame) return () => {};

    patchStaticRendererPrototype();
    const existing = hostStates.get(host);
    if (existing) return existing.restoreCapture ?? (() => {});

    const state: PlayerAlphaComparisonHostState = {
        currentFrameToken: Number.NaN,
        snapshots: new Map(),
        geometryByKey: new Map(),
    };
    hostStates.set(host, state);
    hostsByFrame.set(frame as object, host);

    // Capture immediately after the authoritative opaque map pass has resolved
    // appearance/sequence/frame geometry. The geometry cache entry contains both
    // opaque and alpha faces for that exact pose, so alpha does not run a second
    // animation-selection clock.
    const previous = playerRenderer.renderOpaqueForMap;
    const wrapper = function (this: unknown, map: WebGLMapSquare, ...args: unknown[]) {
        const result = previous.call(this, map, ...args);
        try {
            capturePlayerAlphaMap(host, map, state);
        } catch (error) {
            console.warn("[WebGPU player comparison] Failed to capture alpha player snapshot", error);
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
    state.restoreCapture = restore;
    return restore;
}
