import type { Renderer } from "../../../game/render/Renderer";
import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import type { WebGLMapSquare } from "../../WebGLMapSquare";
import {
    DYNAMIC_ACTOR_WEBGL_RECORD_WORDS,
    createDynamicActorGeometry,
    decodeDynamicActorWebGLRecord,
    type DynamicActorGeometry,
    type DynamicActorInstance,
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
import {
    WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
    packWebGPUPlayerInstanceData,
} from "../player/WebGPUPlayerOpaqueComparison";
import { WEBGPU_GFX_SHADER } from "./WebGPUGfxShader";

export type WebGPUAttachedGfxKind = "player" | "npc";
export type WebGPUAttachedGfxPass = "opaque" | "alpha";

export const WEBGPU_ATTACHED_GFX_GEOMETRY_CACHE_LIMIT = 384;

export const WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE = {
    cullMode: "none",
    depthWriteEnabled: true,
    depthCompare: "less-equal",
} as const;

export const WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE = {
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

export interface WebGPUAttachedGfxDrawSnapshot {
    frameToken: number;
    mapX: number;
    mapY: number;
    map: WebGLMapSquare;
    attachmentKind: WebGPUAttachedGfxKind;
    spotId: number;
    spotFrame: number;
    geometry: DynamicActorGeometry;
    instance: DynamicActorInstance;
}

interface AttachedGfxComparisonHostState {
    currentFrameToken: number;
    opaqueDraws: WebGPUAttachedGfxDrawSnapshot[];
    npcAlphaDraws: WebGPUAttachedGfxDrawSnapshot[];
    playerAlphaDraws: WebGPUAttachedGfxDrawSnapshot[];
    geometryByKey: Map<string, DynamicActorGeometry>;
    restoreCapture?: () => void;
}

interface GeometryGpuResources {
    source: DynamicActorGeometry;
    vertexBuffer: WebGPUBufferLike;
    indexBuffer: WebGPUBufferLike;
    indexCount: number;
}

interface OrderedAttachmentEntry {
    inst: GfxInstance;
    actorId: number;
    slot: number;
    yOffsetUnits: number;
}

const hostsByFrame = new WeakMap<object, WebGLOsrsRenderer>();
const hostStates = new WeakMap<WebGLOsrsRenderer, AttachedGfxComparisonHostState>();
const runtimesByStaticRenderer = new WeakMap<
    WebGPUStaticSceneRenderer,
    WebGPUAttachedGfxRuntime
>();

let opaqueBoundaryPatched = false;
let npcAlphaBoundaryPatched = false;
let playerAlphaBoundaryPatched = false;
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

function resetForFrame(state: AttachedGfxComparisonHostState, frameToken: number): void {
    if (state.currentFrameToken === frameToken) return;
    state.currentFrameToken = frameToken;
    state.opaqueDraws.length = 0;
    state.npcAlphaDraws.length = 0;
    state.playerAlphaDraws.length = 0;
}

function cacheGeometry(
    state: AttachedGfxComparisonHostState,
    spotId: number,
    spotFrame: number,
    pass: WebGPUAttachedGfxPass,
    raw: { vertices: Uint8Array; indices: Int32Array },
): DynamicActorGeometry {
    const key = `gfx:${spotId | 0}:${spotFrame | 0}:${pass}`;
    const existing = state.geometryByKey.get(key);
    if (existing) {
        state.geometryByKey.delete(key);
        state.geometryByKey.set(key, existing);
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
    state.geometryByKey.set(key, geometry);
    while (state.geometryByKey.size > WEBGPU_ATTACHED_GFX_GEOMETRY_CACHE_LIMIT) {
        const oldest = state.geometryByKey.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        state.geometryByKey.delete(oldest);
    }
    return geometry;
}

function getYOffsetUnits(inst: GfxInstance): number {
    return inst.anchor === "offset" ? Math.round((inst.yOffsetTiles ?? 0) * 128) | 0 : 0;
}

/**
 * Reproduce GfxRenderer's observable draw ordering after it has selected the
 * authoritative frame: first-seen (spot,frame) groups, then first-seen Y-offset
 * groups inside each spot/frame group, then original entry order.
 */
export function orderWebGPUAttachedGfxEntriesLikeWebGL(
    entries: readonly OrderedAttachmentEntry[],
): OrderedAttachmentEntry[] {
    const spotGroups = new Map<string, OrderedAttachmentEntry[]>();
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
    const ordered: OrderedAttachmentEntry[] = [];
    for (const group of spotGroups.values()) {
        const yOffsetGroups = new Map<number, OrderedAttachmentEntry[]>();
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

function createAttachedGfxDraw(
    host: WebGLOsrsRenderer,
    state: AttachedGfxComparisonHostState,
    map: WebGLMapSquare,
    pass: WebGPUAttachedGfxPass,
    attachmentKind: WebGPUAttachedGfxKind,
    entry: OrderedAttachmentEntry,
    actorRecordIndex: number,
): WebGPUAttachedGfxDrawSnapshot | undefined {
    const inst = entry.inst;
    if (inst.startTimeMs == null || typeof inst.lastSoundFrame !== "number") return undefined;
    const spotFrame = inst.lastSoundFrame | 0;
    const spotId = inst.spotId | 0;
    const raw = host.gfxRenderer
        ?.getCache?.()
        .ensureFrameGeometry(spotId, spotFrame, pass === "alpha");
    if (!raw || raw.vertices.byteLength === 0 || raw.indices.length === 0) return undefined;

    const wordOffset = (actorRecordIndex | 0) * DYNAMIC_ACTOR_WEBGL_RECORD_WORDS;
    if (
        wordOffset < 0 ||
        wordOffset + DYNAMIC_ACTOR_WEBGL_RECORD_WORDS > host.actorRenderData.length
    ) {
        return undefined;
    }
    const decoded = decodeDynamicActorWebGLRecord(host.actorRenderData, wordOffset);
    let serverId: number | undefined;
    let worldViewId = -1;
    if (attachmentKind === "player") {
        const ecs = host.osrsClient.playerEcs;
        const sid = ecs.getServerIdForIndex(entry.actorId | 0);
        serverId = typeof sid === "number" ? sid | 0 : undefined;
        worldViewId = ecs.getWorldViewId?.(entry.actorId | 0) ?? -1;
    } else {
        const ecs = host.osrsClient.npcEcs;
        serverId = ecs.getServerId(entry.actorId | 0) | 0;
        worldViewId = ecs.getWorldViewId(entry.actorId | 0) | 0;
    }

    const geometry = cacheGeometry(state, spotId, spotFrame, pass, raw);
    const instance: DynamicActorInstance = {
        identity: {
            kind: attachmentKind,
            actorId: entry.actorId | 0,
            serverId,
            worldViewId,
            interactionId: decoded.interactionId | 0,
            sourceMapId: map.id,
        },
        transform: {
            localX: decoded.localX,
            localY: decoded.localY,
            plane: decoded.plane,
            rotation: decoded.rotation,
            // WebGL subtracts positive u_modelYOffset. The shared WebGPU GFX
            // shader adds modelYOffset, so normalize the sign here.
            modelYOffset: -entry.yOffsetUnits,
        },
        animation: {
            sequenceId: -1,
            frameId: spotFrame,
            mode: "base",
        },
        colorOverride: decoded.colorOverride,
        geometryKey: geometry.key,
    };
    return {
        frameToken: state.currentFrameToken,
        mapX: map.mapX | 0,
        mapY: map.mapY | 0,
        map,
        attachmentKind,
        spotId,
        spotFrame,
        geometry,
        instance,
    };
}

function appendOrderedAttachments(
    host: WebGLOsrsRenderer,
    state: AttachedGfxComparisonHostState,
    map: WebGLMapSquare,
    pass: WebGPUAttachedGfxPass,
    kind: WebGPUAttachedGfxKind,
    baseOffset: number,
    entries: OrderedAttachmentEntry[],
): void {
    const ordered = orderWebGPUAttachedGfxEntriesLikeWebGL(entries);
    for (const entry of ordered) {
        const draw = createAttachedGfxDraw(
            host,
            state,
            map,
            pass,
            kind,
            entry,
            (baseOffset | 0) + (entry.slot | 0),
        );
        if (!draw) continue;
        if (pass === "opaque") state.opaqueDraws.push(draw);
        else if (kind === "player") state.playerAlphaDraws.push(draw);
        else state.npcAlphaDraws.push(draw);
    }
}

function captureAttachedGfxPass(
    host: WebGLOsrsRenderer,
    state: AttachedGfxComparisonHostState,
    map: WebGLMapSquare,
    pass: WebGPUAttachedGfxPass,
    offsets: { player?: number; npc?: number; world?: number },
): void {
    resetForFrame(state, host.sceneFrameDescription.currentTime);
    const mgr = host.gfxManager;
    if (!mgr) return;

    // World-tile GFX intentionally remain out of G1 and are handled by the G2
    // world-GFX comparison using their independent placement records.
    if (offsets.player !== undefined && offsets.player !== -1) {
        const playerEntries: OrderedAttachmentEntry[] = mgr
            .getAttachedPlayersForMap(map)
            .map((entry) => ({
                inst: entry.inst,
                actorId: entry.pid | 0,
                slot: entry.slot | 0,
                yOffsetUnits: getYOffsetUnits(entry.inst),
            }));
        appendOrderedAttachments(
            host,
            state,
            map,
            pass,
            "player",
            offsets.player | 0,
            playerEntries,
        );
    }
    if (offsets.npc !== undefined && offsets.npc !== -1) {
        const npcEntries: OrderedAttachmentEntry[] = mgr
            .getAttachedNpcsForMap(map)
            .map((entry) => ({
                inst: entry.inst,
                actorId: entry.ecsId | 0,
                slot: entry.slot | 0,
                yOffsetUnits: getYOffsetUnits(entry.inst),
            }));
        appendOrderedAttachments(
            host,
            state,
            map,
            pass,
            "npc",
            offsets.npc | 0,
            npcEntries,
        );
    }
}

class WebGPUAttachedGfxRuntime {
    private device?: WebGPUDeviceLike;
    private opaquePipeline?: WebGPURenderPipelineLike;
    private alphaPipeline?: WebGPURenderPipelineLike;
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
            console.warn(`[WebGPU GFX comparison] Attached GFX pass disabled: ${message}`);
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
            label: "attached-gfx-height-bind-group-layout",
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
            "attached-gfx-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "attached-gfx-pipeline-layout",
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
            label: "attached-gfx-opaque-pipeline",
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
            label: "attached-gfx-alpha-pipeline",
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
            "attached-gfx",
        );
        this.instanceCache = new WebGPUGrowableBufferCache(
            device,
            "attached-gfx-instance",
        );
        this.ready = true;
    }

    private getGeometry(
        draw: WebGPUAttachedGfxDrawSnapshot,
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

    private getHeight(draw: WebGPUAttachedGfxDrawSnapshot) {
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
        draws: readonly WebGPUAttachedGfxDrawSnapshot[],
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
        passEncoder.setPipeline(pipeline);
        for (const draw of draws) {
            if (draw.frameToken !== frame.currentTime) continue;
            const mapResources = mapsById.get(mapKey(draw.mapX, draw.mapY));
            const height = this.getHeight(draw);
            const geometry = this.getGeometry(draw, pass);
            if (!mapResources || !height || !geometry || geometry.indexCount <= 0) continue;
            passEncoder.setBindGroup(1, mapResources.sharedMapBindGroup);
            passEncoder.setBindGroup(3, height.bindGroup);
            // Match current WebGL GFX behavior: parent actor placement is reused,
            // but attached effects always receive identity world transform.
            const instanceData = packWebGPUPlayerInstanceData([draw.instance]);
            const bufferKey = `${pass}:${draw.mapX}:${draw.mapY}:${draw.geometry.key}:${draw.attachmentKind}:${draw.instance.identity.actorId}`;
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

function getRuntime(renderer: WebGPUStaticSceneRenderer): WebGPUAttachedGfxRuntime {
    let runtime = runtimesByStaticRenderer.get(renderer);
    if (!runtime) {
        runtime = new WebGPUAttachedGfxRuntime(renderer);
        runtimesByStaticRenderer.set(renderer, runtime);
    }
    return runtime;
}

function getHostState(
    frame: SceneFrameDescription,
): { host: WebGLOsrsRenderer; state: AttachedGfxComparisonHostState } | undefined {
    const host = hostsByFrame.get(frame as object);
    if (!host) return undefined;
    const state = hostStates.get(host);
    if (!state || state.currentFrameToken !== frame.currentTime) return undefined;
    return { host, state };
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

function patchOpaquePostPlayerBoundary(): void {
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
        const resolved = getHostState(frame);
        if (!resolved) return;
        getRuntime(this).draw(pass, frame, resolved.state.opaqueDraws, "opaque");
    };
}

/** Install after NPC alpha registration but before the player-alpha wrapper. */
export function installWebGPUNpcAttachedGfxAlphaBoundary(): void {
    if (npcAlphaBoundaryPatched) return;
    npcAlphaBoundaryPatched = true;
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
        const resolved = getHostState(frame);
        if (!resolved) return;
        getRuntime(this).draw(pass, frame, resolved.state.npcAlphaDraws, "alpha");
    };
}

/** Install after the player-alpha wrapper. */
export function installWebGPUPlayerAttachedGfxAlphaBoundary(): void {
    if (playerAlphaBoundaryPatched) return;
    playerAlphaBoundaryPatched = true;
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
        const resolved = getHostState(frame);
        if (!resolved) return;
        getRuntime(this).draw(pass, frame, resolved.state.playerAlphaDraws, "alpha");
    };
}

export function installWebGPUAttachedGfxComparison(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};
    const host = renderer as WebGLOsrsRenderer;
    const frame = host.sceneFrameDescription as SceneFrameDescription | undefined;
    const gfxRenderer = host.gfxRenderer as any;
    if (!frame || !gfxRenderer || typeof gfxRenderer.renderMapPass !== "function") return () => {};
    patchOpaquePostPlayerBoundary();
    const existing = hostStates.get(host);
    if (existing) return existing.restoreCapture ?? (() => {});

    const state: AttachedGfxComparisonHostState = {
        currentFrameToken: Number.NaN,
        opaqueDraws: [],
        npcAlphaDraws: [],
        playerAlphaDraws: [],
        geometryByKey: new Map(),
    };
    hostStates.set(host, state);
    hostsByFrame.set(frame as object, host);

    const previous = gfxRenderer.renderMapPass;
    const wrapper = function (
        this: unknown,
        map: WebGLMapSquare,
        actorDataTexture: unknown,
        pass: WebGPUAttachedGfxPass,
        offsets: { player?: number; npc?: number; world?: number } = {},
    ) {
        const result = previous.call(this, map, actorDataTexture, pass, offsets);
        try {
            // Capture after WebGL has rendered. lastSoundFrame is the exact
            // authoritative frame used by GfxRenderer for this pass.
            captureAttachedGfxPass(host, state, map, pass, offsets);
        } catch (error) {
            console.warn("[WebGPU GFX comparison] Failed to capture attached GFX", error);
        }
        return result;
    };
    gfxRenderer.renderMapPass = wrapper;

    const restore = () => {
        if (gfxRenderer.renderMapPass === wrapper) gfxRenderer.renderMapPass = previous;
        hostsByFrame.delete(frame as object);
        state.opaqueDraws.length = 0;
        state.npcAlphaDraws.length = 0;
        state.playerAlphaDraws.length = 0;
        state.geometryByKey.clear();
        hostStates.delete(host);
    };
    state.restoreCapture = restore;
    return restore;
}