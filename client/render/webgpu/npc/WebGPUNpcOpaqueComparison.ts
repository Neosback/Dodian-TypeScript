import type { Renderer } from "../../../game/render/Renderer";
import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import type { WebGLMapSquare } from "../../WebGLMapSquare";
import type { DynamicNpcFrameGeometry } from "../../npc/DynamicNpcAnimLoader";
import {
    DYNAMIC_ACTOR_WEBGL_RECORD_WORDS,
    createDynamicActorGeometry,
    decodeDynamicActorWebGLRecord,
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
import { registerWebGPUOpaqueActorPhase } from "../actor/WebGPUOpaqueActorPhase";
import {
    WebGPUDynamicHeightBindGroupCache,
    WebGPUGrowableBufferCache,
} from "../dynamic/WebGPUDynamicResourceHelpers";
import {
    WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
    packWebGPUPlayerInstanceData,
} from "../player/WebGPUPlayerOpaqueComparison";
import { WEBGPU_NPC_OPAQUE_SHADER } from "./WebGPUNpcOpaqueShader";

export const WEBGPU_NPC_OPAQUE_PHASE_ORDER = 10;
export const WEBGPU_NPC_GEOMETRY_CACHE_LIMIT = 512;

const IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

export interface WebGPUNpcOpaqueBatchSnapshot {
    geometry: DynamicActorGeometry;
    instances: DynamicActorInstance[];
}

export interface WebGPUNpcOpaqueMapSnapshot {
    frameToken: number;
    mapX: number;
    mapY: number;
    map: WebGLMapSquare;
    batches: WebGPUNpcOpaqueBatchSnapshot[];
}

interface NpcComparisonHostState {
    currentFrameToken: number;
    snapshots: Map<number, WebGPUNpcOpaqueMapSnapshot>;
    geometryByKey: Map<string, DynamicActorGeometry>;
    restoreActorHook?: () => void;
}

interface GeometryGpuResources {
    source: DynamicActorGeometry;
    vertexBuffer: WebGPUBufferLike;
    indexBuffer: WebGPUBufferLike;
    indexCount: number;
}

const hostStates = new WeakMap<WebGLOsrsRenderer, NpcComparisonHostState>();
const hostsByFrame = new WeakMap<object, WebGLOsrsRenderer>();
const runtimesByStaticRenderer = new WeakMap<WebGPUStaticSceneRenderer, WebGPUNpcOpaqueRuntime>();
let phaseRegistered = false;

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

function cacheGeometry(
    state: NpcComparisonHostState,
    source: DynamicNpcFrameGeometry,
): DynamicActorGeometry {
    const key = `npc:${source.key}`;
    const existing = state.geometryByKey.get(key);
    if (existing) {
        state.geometryByKey.delete(key);
        state.geometryByKey.set(key, existing);
        return existing;
    }

    const geometry = createDynamicActorGeometry(
        key,
        source.opaqueVertices,
        source.opaqueIndices,
        source.alphaVertices,
        source.alphaIndices,
    );
    state.geometryByKey.set(key, geometry);
    while (state.geometryByKey.size > WEBGPU_NPC_GEOMETRY_CACHE_LIMIT) {
        const oldest = state.geometryByKey.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        state.geometryByKey.delete(oldest);
    }
    return geometry;
}

function getOrCreateSnapshot(
    state: NpcComparisonHostState,
    map: WebGLMapSquare,
    frameToken: number,
): WebGPUNpcOpaqueMapSnapshot {
    const key = mapKey(map.mapX, map.mapY);
    let snapshot = state.snapshots.get(key);
    if (!snapshot) {
        snapshot = {
            frameToken,
            mapX: map.mapX | 0,
            mapY: map.mapY | 0,
            map,
            batches: [],
        };
        state.snapshots.set(key, snapshot);
    }
    return snapshot;
}

function addNpcInstance(
    host: WebGLOsrsRenderer,
    state: NpcComparisonHostState,
    map: WebGLMapSquare,
    ecsId: number,
    actorRecordIndex: number,
    sourceGeometry: DynamicNpcFrameGeometry,
): void {
    if (!(sourceGeometry.opaqueIndices.length > 0) || !(sourceGeometry.opaqueVertices.byteLength > 0)) {
        return;
    }

    const wordOffset = (actorRecordIndex | 0) * DYNAMIC_ACTOR_WEBGL_RECORD_WORDS;
    if (
        wordOffset < 0 ||
        wordOffset + DYNAMIC_ACTOR_WEBGL_RECORD_WORDS > host.actorRenderData.length
    ) {
        return;
    }

    // Comparison mode converts the authoritative WebGL compatibility record
    // back into renderer-neutral fields once. The WebGPU shader consumes the
    // neutral instance ABI, never the RGBA16UI texture packing itself.
    const decoded = decodeDynamicActorWebGLRecord(host.actorRenderData, wordOffset);
    const ecs = host.osrsClient.npcEcs;
    const worldViewId = ecs.getWorldViewId(ecsId) | 0;
    const deckHeight = worldViewId >= 0 ? host.getWorldEntityDeckHeight(0, 0) : 0;
    const geometry = cacheGeometry(state, sourceGeometry);
    const instance: DynamicActorInstance = {
        identity: {
            kind: "npc",
            actorId: ecsId | 0,
            serverId: ecs.getServerId(ecsId) | 0,
            worldViewId,
            interactionId: decoded.interactionId | 0,
            sourceMapId: map.id,
        },
        transform: {
            localX: decoded.localX,
            localY: decoded.localY,
            plane: decoded.plane,
            rotation: decoded.rotation,
            // The shared WebGPU actor vertex path adds modelYOffset while the
            // WebGL NPC shader subtracts u_modelYOffset, so normalize the sign
            // here at the renderer-neutral boundary.
            modelYOffset: -host.getNpcModelYOffset(deckHeight),
        },
        animation: {
            sequenceId: sourceGeometry.seqId | 0,
            frameId: sourceGeometry.frameId | 0,
            overlaySequenceId: sourceGeometry.overlaySeqId,
            overlayFrameId: sourceGeometry.overlayFrameId,
            mode: sourceGeometry.seqId >= 0 ? "action" : "base",
        },
        colorOverride: decoded.colorOverride,
        geometryKey: geometry.key,
    };

    const snapshot = getOrCreateSnapshot(state, map, state.currentFrameToken);
    let batch = snapshot.batches.find((candidate) => candidate.geometry.key === geometry.key);
    if (!batch) {
        batch = { geometry, instances: [] };
        snapshot.batches.push(batch);
    }
    batch.instances.push(instance);
}

function resolveCurrentNpcGeometry(
    host: WebGLOsrsRenderer,
    ecsId: number,
): DynamicNpcFrameGeometry | undefined {
    const loader = host.dynamicNpcAnimLoader;
    if (!loader) return undefined;
    const ecs = host.osrsClient.npcEcs;
    const npcTypeId = (ecs.getNpcTypeId(ecsId) ?? -1) | 0;
    if (npcTypeId < 0) return undefined;

    const actionSeqId = ecs.getSeqId(ecsId) | 0;
    const actionDelay = ecs.getSeqDelay?.(ecsId) | 0;
    const { movementSeqId, idleSeqId } = host.resolveNpcMovementSequenceIds(ecs, ecsId);
    const actionActive = actionSeqId >= 0 && actionDelay === 0;
    const renderSeqId = actionActive ? actionSeqId : movementSeqId | 0;
    const overlaySeqId =
        actionActive &&
        host.shouldLayerNpcMovementSequence(actionSeqId, movementSeqId | 0, idleSeqId | 0)
            ? movementSeqId | 0
            : -1;
    const frameId = actionActive
        ? ecs.getFrameIndex(ecsId) | 0
        : ecs.getMovementFrameIndex?.(ecsId) | 0;
    const overlayFrameId = overlaySeqId >= 0 ? ecs.getMovementFrameIndex?.(ecsId) | 0 : -1;

    if (renderSeqId >= 0) {
        return loader.getFrameGeometry(
            npcTypeId,
            renderSeqId,
            frameId,
            overlaySeqId,
            overlayFrameId,
        );
    }
    return loader.getBaseGeometry(npcTypeId);
}

function captureNpcOpaqueFrame(
    host: WebGLOsrsRenderer,
    actorDataTextureIndex: number,
    state: NpcComparisonHostState,
): void {
    const frameToken = host.sceneFrameDescription.currentTime;
    if (state.currentFrameToken !== frameToken) {
        state.currentFrameToken = frameToken;
        state.snapshots.clear();
    }
    if (!host.loadNpcs) return;

    const cullTile = host.getRenderCullTile();
    const renderDistanceTiles = Math.max(0, host.getFrameRenderDistanceTiles() | 0);
    const seen = new Set<string>();

    for (let i = 0; i < host.mapManager.visibleMapCount; i++) {
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
        const dataOffset = map.npcDataTextureOffsets[actorDataTextureIndex] ?? -1;
        if (dataOffset < 0) continue;
        const ids = (map.npcEntityIds ?? []) as number[];
        for (let npcIndex = 0; npcIndex < ids.length; npcIndex++) {
            const ecsId = ids[npcIndex] | 0;
            if (!host.shouldRenderNpcFromMap(map, ecsId)) continue;
            const key = `${map.id}:${ecsId}`;
            if (seen.has(key)) continue;
            const geometry = resolveCurrentNpcGeometry(host, ecsId);
            if (!geometry) continue;
            seen.add(key);
            addNpcInstance(host, state, map, ecsId, dataOffset + npcIndex, geometry);
        }
    }

    // Preserve the authoritative unbatched path for NPCs that are not represented
    // by the map's pre-baked NPC range table.
    for (const entry of host.unbatchedNpcRenderEntries) {
        if (
            !host.isMapWithinRenderDistance(
                entry.map,
                cullTile.x,
                cullTile.y,
                renderDistanceTiles,
                0,
            )
        ) {
            continue;
        }
        const key = `${entry.map.id}:${entry.ecsId | 0}`;
        if (seen.has(key)) continue;
        const geometry = host.resolveUnbatchedNpcGeometry(entry.ecsId);
        if (!geometry) continue;
        seen.add(key);
        addNpcInstance(host, state, entry.map, entry.ecsId | 0, entry.dataOffset | 0, geometry);
    }
}

class WebGPUNpcOpaqueRuntime {
    private device?: WebGPUDeviceLike;
    private cullPipeline?: WebGPURenderPipelineLike;
    private noCullPipeline?: WebGPURenderPipelineLike;
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
            console.warn(`[WebGPU NPC comparison] Opaque NPC pass disabled: ${message}`);
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
            label: "npc-opaque-height-bind-group-layout",
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
            WEBGPU_NPC_OPAQUE_SHADER,
            "npc-opaque-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "npc-opaque-pipeline-layout",
            bindGroupLayouts: [sceneLayout, mapLayout, textureLayout, heightLayout],
        });
        const createPipeline = (label: string, cullMode: "back" | "none") =>
            device.createRenderPipeline({
                label,
                layout: pipelineLayout,
                vertex: {
                    module,
                    entryPoint: "vsNpcOpaque",
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
                },
                fragment: {
                    module,
                    entryPoint: "fsNpcOpaque",
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
        this.heightCache = new WebGPUDynamicHeightBindGroupCache(
            device,
            heightLayout,
            "npc-opaque",
        );
        this.instanceCache = new WebGPUGrowableBufferCache(
            device,
            "npc-opaque-instance",
        );
        this.cullPipeline = createPipeline("npc-opaque-cull-pipeline", "back");
        this.noCullPipeline = createPipeline("npc-opaque-no-cull-pipeline", "none");
        this.ready = true;
    }

    private getGeometry(batch: WebGPUNpcOpaqueBatchSnapshot): GeometryGpuResources | undefined {
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
            label: `${key}-vertices`,
            size: alignedBufferSize(batch.geometry.opaque.vertices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.VERTEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        const indexBuffer = device.createBuffer({
            label: `${key}-indices`,
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

    private getHeight(snapshot: WebGPUNpcOpaqueMapSnapshot) {
        const mapAny = snapshot.map as any;
        return this.heightCache?.get(
            mapKey(snapshot.mapX, snapshot.mapY),
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
        state: NpcComparisonHostState,
    ): void {
        if (this.failed) return;
        if (!this.ready) {
            this.ensureInitialized();
            return;
        }
        const rendererAny = this.staticRenderer as any;
        const mapsById = rendererAny.mapsById as Map<number, any> | undefined;
        if (!mapsById) return;

        const pipeline = frame.cullBackFace ? this.cullPipeline : this.noCullPipeline;
        if (!pipeline) return;
        pass.setPipeline(pipeline);

        for (const snapshot of state.snapshots.values()) {
            if (snapshot.frameToken !== frame.currentTime) continue;
            const mapResources = mapsById.get(mapKey(snapshot.mapX, snapshot.mapY));
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
                pass.drawIndexed(geometry.indexCount, batch.instances.length, 0, 0, 0);
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
        this.cullPipeline = undefined;
        this.noCullPipeline = undefined;
        this.ready = false;
    }
}

function ensureNpcOpaquePhaseRegistered(): void {
    if (phaseRegistered) return;
    phaseRegistered = true;
    registerWebGPUOpaqueActorPhase({
        id: "npc",
        order: WEBGPU_NPC_OPAQUE_PHASE_ORDER,
        draw(renderer, pass, frame) {
            const host = hostsByFrame.get(frame as object);
            if (!host) return;
            const state = hostStates.get(host);
            if (!state || state.currentFrameToken !== frame.currentTime) return;
            let runtime = runtimesByStaticRenderer.get(renderer);
            if (!runtime) {
                runtime = new WebGPUNpcOpaqueRuntime(renderer);
                runtimesByStaticRenderer.set(renderer, runtime);
            }
            runtime.draw(pass, frame, host, state);
        },
        dispose(renderer) {
            const runtime = runtimesByStaticRenderer.get(renderer);
            runtime?.dispose();
            runtimesByStaticRenderer.delete(renderer);
        },
    });
}

export function installWebGPUNpcOpaqueComparison(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};
    const host = renderer as WebGLOsrsRenderer;
    const frame = (host as any).sceneFrameDescription as SceneFrameDescription | undefined;
    const hostAny = host as any;
    if (!frame || typeof hostAny.renderOpaqueActorPass !== "function") return () => {};

    ensureNpcOpaquePhaseRegistered();
    const existing = hostStates.get(host);
    if (existing) return existing.restoreActorHook ?? (() => {});

    const state: NpcComparisonHostState = {
        currentFrameToken: Number.NaN,
        snapshots: new Map(),
        geometryByKey: new Map(),
    };
    hostStates.set(host, state);
    hostsByFrame.set(frame as object, host);

    const previous = hostAny.renderOpaqueActorPass;
    const wrapper = function (
        this: unknown,
        actorDataTextureIndex: number,
        actorDataTexture: unknown,
        ...args: unknown[]
    ) {
        const result = previous.call(this, actorDataTextureIndex, actorDataTexture, ...args);
        try {
            captureNpcOpaqueFrame(host, actorDataTextureIndex, state);
        } catch (error) {
            console.warn("[WebGPU NPC comparison] Failed to capture opaque NPC snapshot", error);
        }
        return result;
    };
    hostAny.renderOpaqueActorPass = wrapper;

    const restore = () => {
        if (hostAny.renderOpaqueActorPass === wrapper) {
            hostAny.renderOpaqueActorPass = previous;
        }
        hostsByFrame.delete(frame as object);
        state.snapshots.clear();
        state.geometryByKey.clear();
        hostStates.delete(host);
    };
    state.restoreActorHook = restore;
    return restore;
}
