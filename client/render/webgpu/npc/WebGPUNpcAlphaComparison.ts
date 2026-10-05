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
    type WebGPUBindGroupLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
    type WebGPURenderPassEncoderLike,
    type WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import { registerWebGPUTransparentActorPhase } from "../actor/WebGPUTransparentActorPhase";
import {
    WEBGPU_HEIGHT_MAP_LAYERS,
    WebGPUHeightMapResources,
} from "../loc/WebGPUHeightMapResources";
import {
    WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
    packWebGPUPlayerInstanceData,
} from "../player/WebGPUPlayerOpaqueComparison";
import { WEBGPU_NPC_ALPHA_SHADER } from "./WebGPUNpcAlphaShader";

export const WEBGPU_NPC_ALPHA_PHASE_ORDER = 10;
export const WEBGPU_NPC_ALPHA_GEOMETRY_CACHE_LIMIT = 512;

export const WEBGPU_NPC_ALPHA_PIPELINE_STATE = {
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

const IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

export interface WebGPUNpcAlphaDrawSnapshot {
    frameToken: number;
    mapX: number;
    mapY: number;
    map: WebGLMapSquare;
    geometry: DynamicActorGeometry;
    instance: DynamicActorInstance;
}

interface NpcAlphaComparisonHostState {
    currentFrameToken: number;
    draws: WebGPUNpcAlphaDrawSnapshot[];
    geometryByKey: Map<string, DynamicActorGeometry>;
    restoreActorHook?: () => void;
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

const hostStates = new WeakMap<WebGLOsrsRenderer, NpcAlphaComparisonHostState>();
const hostsByFrame = new WeakMap<object, WebGLOsrsRenderer>();
const runtimesByStaticRenderer = new WeakMap<WebGPUStaticSceneRenderer, WebGPUNpcAlphaRuntime>();
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

function cacheAlphaGeometry(
    state: NpcAlphaComparisonHostState,
    source: DynamicNpcFrameGeometry,
): DynamicActorGeometry {
    const key = `npc-alpha:${source.key}`;
    const existing = state.geometryByKey.get(key);
    if (existing) {
        state.geometryByKey.delete(key);
        state.geometryByKey.set(key, existing);
        return existing;
    }

    const geometry = createDynamicActorGeometry(
        key,
        new Uint8Array(0),
        new Int32Array(0),
        source.alphaVertices,
        source.alphaIndices,
    );
    state.geometryByKey.set(key, geometry);
    while (state.geometryByKey.size > WEBGPU_NPC_ALPHA_GEOMETRY_CACHE_LIMIT) {
        const oldest = state.geometryByKey.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        state.geometryByKey.delete(oldest);
    }
    return geometry;
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

function createNpcAlphaDraw(
    host: WebGLOsrsRenderer,
    state: NpcAlphaComparisonHostState,
    map: WebGLMapSquare,
    ecsId: number,
    actorRecordIndex: number,
    sourceGeometry: DynamicNpcFrameGeometry,
): WebGPUNpcAlphaDrawSnapshot | undefined {
    if (!(sourceGeometry.alphaIndices.length > 0) || !(sourceGeometry.alphaVertices.byteLength > 0)) {
        return undefined;
    }

    const wordOffset = (actorRecordIndex | 0) * DYNAMIC_ACTOR_WEBGL_RECORD_WORDS;
    if (
        wordOffset < 0 ||
        wordOffset + DYNAMIC_ACTOR_WEBGL_RECORD_WORDS > host.actorRenderData.length
    ) {
        return undefined;
    }

    const decoded = decodeDynamicActorWebGLRecord(host.actorRenderData, wordOffset);
    const ecs = host.osrsClient.npcEcs;
    const worldViewId = ecs.getWorldViewId(ecsId) | 0;
    const deckHeight = worldViewId >= 0 ? host.getWorldEntityDeckHeight(0, 0) : 0;
    const geometry = cacheAlphaGeometry(state, sourceGeometry);
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
            // Shared WebGPU actor math adds modelYOffset; WebGL NPC subtracts
            // u_modelYOffset, so normalize the sign at the neutral boundary.
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

    return {
        frameToken: state.currentFrameToken,
        mapX: map.mapX | 0,
        mapY: map.mapY | 0,
        map,
        geometry,
        instance,
    };
}

function captureNpcAlphaFrame(
    host: WebGLOsrsRenderer,
    actorDataTextureIndex: number,
    state: NpcAlphaComparisonHostState,
): void {
    const frameToken = host.sceneFrameDescription.currentTime;
    state.currentFrameToken = frameToken;
    // renderOpaqueActorPass can be observed more than once by plugin hooks in a
    // frame. Rebuild the ordered alpha list on each capture so duplicate calls
    // cannot duplicate transparent NPC draws.
    state.draws.length = 0;
    if (!host.loadNpcs) return;

    const cullTile = host.getRenderCullTile();
    const renderDistanceTiles = Math.max(0, host.getFrameRenderDistanceTiles() | 0);
    const seen = new Set<string>();

    // Transparent NPC map traversal is back-to-front in WebGL.
    for (let i = host.mapManager.visibleMapCount - 1; i >= 0; i--) {
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
            const draw = createNpcAlphaDraw(
                host,
                state,
                map,
                ecsId,
                dataOffset + npcIndex,
                geometry,
            );
            if (!draw) continue;
            seen.add(key);
            state.draws.push(draw);
        }
    }

    // WebGL appends unbatched dynamic NPCs after the map traversal.
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
        const draw = createNpcAlphaDraw(
            host,
            state,
            entry.map,
            entry.ecsId | 0,
            entry.dataOffset | 0,
            geometry,
        );
        if (!draw) continue;
        seen.add(key);
        state.draws.push(draw);
    }
}

class WebGPUNpcAlphaRuntime {
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
            console.warn(`[WebGPU NPC comparison] Alpha NPC pass disabled: ${message}`);
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
            label: "npc-alpha-height-bind-group-layout",
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
            WEBGPU_NPC_ALPHA_SHADER,
            "npc-alpha-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "npc-alpha-pipeline-layout",
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
                    entryPoint: "fsNpcAlpha",
                    targets: [{ format, blend: WEBGPU_NPC_ALPHA_PIPELINE_STATE.blend }],
                },
                primitive: {
                    topology: "triangle-list",
                    frontFace: "ccw",
                    cullMode,
                },
                depthStencil: {
                    format: "depth24plus",
                    depthWriteEnabled: WEBGPU_NPC_ALPHA_PIPELINE_STATE.depthWriteEnabled,
                    depthCompare: WEBGPU_NPC_ALPHA_PIPELINE_STATE.depthCompare,
                },
            });

        this.device = device;
        this.heightLayout = heightLayout;
        this.cullPipeline = createPipeline("npc-alpha-cull-pipeline", "back");
        this.noCullPipeline = createPipeline("npc-alpha-no-cull-pipeline", "none");
        this.ready = true;
    }

    private getGeometry(draw: WebGPUNpcAlphaDrawSnapshot): GeometryGpuResources | undefined {
        const device = this.device;
        if (!device || draw.geometry.alpha.indices.length === 0) return undefined;
        const key = draw.geometry.key;
        const existing = this.geometry.get(key);
        if (existing?.source === draw.geometry) return existing;
        if (existing) {
            existing.vertexBuffer.destroy?.();
            existing.indexBuffer.destroy?.();
        }

        const vertexBuffer = device.createBuffer({
            label: `${key}-vertices`,
            size: alignedBufferSize(draw.geometry.alpha.vertices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.VERTEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        const indexBuffer = device.createBuffer({
            label: `${key}-indices`,
            size: alignedBufferSize(draw.geometry.alpha.indices.byteLength),
            usage: WEBGPU_BUFFER_USAGE.INDEX | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, draw.geometry.alpha.vertices);
        device.queue.writeBuffer(indexBuffer, 0, draw.geometry.alpha.indices);
        const resources = {
            source: draw.geometry,
            vertexBuffer,
            indexBuffer,
            indexCount: draw.geometry.alpha.indices.length | 0,
        };
        this.geometry.set(key, resources);
        return resources;
    }

    private getHeight(draw: WebGPUNpcAlphaDrawSnapshot): HeightGpuResources | undefined {
        const device = this.device;
        const heightLayout = this.heightLayout;
        if (!device || !heightLayout) return undefined;
        const mapAny = draw.map as any;
        const source = mapAny.heightMapData as Int16Array | undefined;
        const size = mapAny.heightMapSize | 0;
        if (!source || !(size > 0)) return undefined;
        const id = mapKey(draw.mapX, draw.mapY);
        const existing = this.heights.get(id);
        if (existing && existing.source === source && existing.size === size) return existing;
        if (existing) existing.heightMap.dispose();

        const heightMap = new WebGPUHeightMapResources(device, size, source);
        const bindGroup = device.createBindGroup({
            label: `npc-alpha-${draw.mapX}-${draw.mapY}-height-bind-group`,
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
            const capacityBytes = Math.max(
                required,
                resources?.capacityBytes ? resources.capacityBytes * 2 : required,
            );
            resources = {
                buffer: device.createBuffer({
                    label: `${key}-instances`,
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
        state: NpcAlphaComparisonHostState,
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

        for (const draw of state.draws) {
            if (draw.frameToken !== frame.currentTime) continue;
            const mapResources = mapsById.get(mapKey(draw.mapX, draw.mapY));
            const height = this.getHeight(draw);
            const geometry = this.getGeometry(draw);
            if (!mapResources || !height || !geometry || geometry.indexCount <= 0) continue;

            pass.setBindGroup(1, mapResources.sharedMapBindGroup);
            pass.setBindGroup(3, height.bindGroup);
            const instanceData = packWebGPUPlayerInstanceData([draw.instance], (instance) => {
                const worldViewId = instance.identity.worldViewId ?? -1;
                if (worldViewId < 0) return IDENTITY_MATRIX;
                return host.worldEntityAnimator?.getTransform(worldViewId) ?? IDENTITY_MATRIX;
            });
            const bufferKey = `${draw.mapX}:${draw.mapY}:${draw.geometry.key}:${draw.instance.identity.actorId}`;
            const instanceBuffer = this.getInstanceBuffer(bufferKey, instanceData);
            if (!instanceBuffer) continue;

            pass.setVertexBuffer(0, geometry.vertexBuffer);
            pass.setVertexBuffer(1, instanceBuffer);
            pass.setIndexBuffer(geometry.indexBuffer, "uint32");
            pass.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
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

function ensureNpcAlphaPhaseRegistered(): void {
    if (phaseRegistered) return;
    phaseRegistered = true;
    registerWebGPUTransparentActorPhase({
        id: "npc",
        order: WEBGPU_NPC_ALPHA_PHASE_ORDER,
        draw(renderer, pass, frame) {
            const host = hostsByFrame.get(frame as object);
            if (!host) return;
            const state = hostStates.get(host);
            if (!state || state.currentFrameToken !== frame.currentTime) return;
            let runtime = runtimesByStaticRenderer.get(renderer);
            if (!runtime) {
                runtime = new WebGPUNpcAlphaRuntime(renderer);
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

export function installWebGPUNpcAlphaComparison(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};
    const host = renderer as WebGLOsrsRenderer;
    const frame = (host as any).sceneFrameDescription as SceneFrameDescription | undefined;
    const hostAny = host as any;
    if (!frame || typeof hostAny.renderOpaqueActorPass !== "function") return () => {};

    ensureNpcAlphaPhaseRegistered();
    const existing = hostStates.get(host);
    if (existing) return existing.restoreActorHook ?? (() => {});

    const state: NpcAlphaComparisonHostState = {
        currentFrameToken: Number.NaN,
        draws: [],
        geometryByKey: new Map(),
    };
    hostStates.set(host, state);
    hostsByFrame.set(frame as object, host);

    // Capture after the authoritative opaque actor pass has packed the current
    // NPC state. This reuses the same animation/morph state without advancing a
    // second renderer-specific NPC animation clock.
    const previous = hostAny.renderOpaqueActorPass;
    const wrapper = function (
        this: unknown,
        actorDataTextureIndex: number,
        actorDataTexture: unknown,
        ...args: unknown[]
    ) {
        const result = previous.call(this, actorDataTextureIndex, actorDataTexture, ...args);
        try {
            captureNpcAlphaFrame(host, actorDataTextureIndex, state);
        } catch (error) {
            console.warn("[WebGPU NPC comparison] Failed to capture alpha NPC snapshot", error);
        }
        return result;
    };
    hostAny.renderOpaqueActorPass = wrapper;

    const restore = () => {
        if (hostAny.renderOpaqueActorPass === wrapper) {
            hostAny.renderOpaqueActorPass = previous;
        }
        hostsByFrame.delete(frame as object);
        state.draws.length = 0;
        state.geometryByKey.clear();
        hostStates.delete(host);
    };
    state.restoreActorHook = restore;
    return restore;
}
