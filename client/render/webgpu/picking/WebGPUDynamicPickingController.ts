import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import type { WebGPUGraphicsBackend } from "../../backend/WebGPUGraphicsBackend";
import {
    WEBGPU_BUFFER_USAGE,
    WEBGPU_MAP_MODE,
    WEBGPU_SHADER_STAGE,
    WEBGPU_TEXTURE_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
    type WebGPURenderPassEncoderLike,
    type WebGPURenderPipelineLike,
    type WebGPUShaderModuleLike,
    type WebGPUTextureLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUSceneUniformBuffer } from "../WebGPUSceneUniforms";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import { replayWebGPUOpaqueActorPhase } from "../actor/WebGPUOpaqueActorPhase";
import { replayWebGPUTransparentActorPhase } from "../actor/WebGPUTransparentActorPhase";
import { WEBGPU_NPC_ALPHA_SHADER } from "../npc/WebGPUNpcAlphaShader";
import {
    WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
} from "../player/WebGPUPlayerOpaqueComparison";
import { WEBGPU_PLAYER_ALPHA_SHADER } from "../player/WebGPUPlayerAlphaShader";
import {
    WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL,
    WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW,
    WEBGPU_DYNAMIC_PICK_FORMAT,
    decodeWebGPUDynamicPickWords,
    type WebGPUDynamicPickResult,
} from "./WebGPUDynamicPicking";
import { patchWebGPUDynamicActorShaderForPicking } from "./WebGPUDynamicPickingShaderPatch";

const PLAYER_INTERACT_BASE = 0x8000;

interface DynamicPickingRendererAccess {
    device?: WebGPUDeviceLike;
    sceneBindGroupLayout?: WebGPUBindGroupLayoutLike;
    mapBindGroupLayout?: WebGPUBindGroupLayoutLike;
    textureBindGroupLayout?: WebGPUBindGroupLayoutLike;
    terrainTextures?: { bindGroup: WebGPUBindGroupLike };
}

type DynamicPickRequest = {
    frame: SceneFrameDescription;
    x: number;
    y: number;
    resolutionSnapshot: DynamicPickResolutionSnapshot;
    resolve: (result: WebGPUDynamicResolvedPickResult | undefined) => void;
    reject: (error: unknown) => void;
};

type ActorIdentity = {
    actorId: number;
    serverId: number;
};

export type DynamicPickResolutionSnapshot = {
    players: Map<string, ActorIdentity>;
    npcs: Map<number, ActorIdentity>;
};

export interface WebGPUDynamicResolvedPickResult extends WebGPUDynamicPickResult {
    actorId: number;
    serverId: number;
}

function playerResolutionKey(mapId: number, interactionId: number): string {
    return `${mapId >>> 0}:${interactionId >>> 0}`;
}

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

function captureResolutionSnapshot(host: WebGLOsrsRenderer): DynamicPickResolutionSnapshot {
    const players = new Map<string, ActorIdentity>();
    const playerRenderer = host.playerRenderer;
    const playerEcs = host.osrsClient.playerEcs;
    const visibleMaps = host.mapManager.visibleMaps;
    const visibleCount = Math.min(host.mapManager.visibleMapCount, visibleMaps.length);
    for (let i = 0; i < visibleCount; i++) {
        const map = visibleMaps[i];
        const renderPlayers = playerRenderer.getRenderPlayersForMap(map);
        for (let slot = 0; slot < renderPlayers.length; slot++) {
            const actorId = renderPlayers[slot] | 0;
            const serverId = playerEcs.getServerIdForIndex(actorId) | 0;
            const interactionId = PLAYER_INTERACT_BASE + (slot & 0x7fff);
            players.set(playerResolutionKey(map.id, interactionId), { actorId, serverId });
        }
    }

    const npcs = new Map<number, ActorIdentity>();
    const npcEcs = host.osrsClient.npcEcs;
    for (const actorIdRaw of npcEcs.getServerLinkedEcsIds()) {
        const actorId = actorIdRaw | 0;
        const serverId = npcEcs.getServerId(actorId) | 0;
        if (serverId < 0) continue;
        npcs.set(serverId >>> 0, { actorId, serverId });
    }
    return { players, npcs };
}

export function resolveWebGPUDynamicPickFromSnapshot(
    pick: WebGPUDynamicPickResult,
    snapshot: DynamicPickResolutionSnapshot,
): WebGPUDynamicResolvedPickResult | undefined {
    const identity =
        pick.kind === "player"
            ? snapshot.players.get(playerResolutionKey(pick.mapId, pick.interactionId))
            : snapshot.npcs.get(pick.interactionId >>> 0);
    if (!identity) return undefined;
    return {
        ...pick,
        actorId: identity.actorId,
        serverId: identity.serverId,
    };
}

function sourcePipelineLabel(pipeline: WebGPURenderPipelineLike): string {
    return String((pipeline as any)?.label ?? "").toLowerCase();
}

class DynamicActorPickPassProxy implements WebGPURenderPassEncoderLike {
    constructor(
        private readonly pass: WebGPURenderPassEncoderLike,
        private readonly kind: "player" | "npc",
        private readonly transparent: boolean,
        private readonly cullBackFace: boolean,
        private readonly playerCullPipeline: WebGPURenderPipelineLike,
        private readonly playerNoCullPipeline: WebGPURenderPipelineLike,
        private readonly npcCullPipeline: WebGPURenderPipelineLike,
        private readonly npcNoCullPipeline: WebGPURenderPipelineLike,
    ) {}

    setPipeline(source: WebGPURenderPipelineLike): void {
        const label = sourcePipelineLabel(source);
        let noCull = label.includes("no-cull");
        if (!label) noCull = !this.cullBackFace;
        if (this.kind === "player" && this.transparent) noCull = true;
        const target =
            this.kind === "player"
                ? noCull
                    ? this.playerNoCullPipeline
                    : this.playerCullPipeline
                : noCull
                  ? this.npcNoCullPipeline
                  : this.npcCullPipeline;
        this.pass.setPipeline(target);
    }

    setBindGroup(index: number, bindGroup: WebGPUBindGroupLike): void {
        this.pass.setBindGroup(index, bindGroup);
    }

    setVertexBuffer(slot: number, buffer: WebGPUBufferLike, offset?: number, size?: number): void {
        this.pass.setVertexBuffer(slot, buffer, offset, size);
    }

    setIndexBuffer(
        buffer: WebGPUBufferLike,
        indexFormat: "uint16" | "uint32",
        offset?: number,
        size?: number,
    ): void {
        this.pass.setIndexBuffer(buffer, indexFormat, offset, size);
    }

    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number,
    ): void {
        this.pass.setViewport?.(x, y, width, height, minDepth, maxDepth);
    }

    setScissorRect(x: number, y: number, width: number, height: number): void {
        this.pass.setScissorRect?.(x, y, width, height);
    }

    drawIndexed(
        indexCount: number,
        instanceCount?: number,
        firstIndex?: number,
        baseVertex?: number,
        firstInstance?: number,
    ): void {
        this.pass.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
    }

    end(): void {
        // Actor phase handlers never own the parent pass lifetime.
    }
}

/**
 * On-demand player/NPC picker for WebGPU comparison mode.
 *
 * It replays only the registered player/NPC actor phases into an independent
 * integer/depth target. Static geometry, GFX, and projectiles are deliberately
 * excluded in M2, so this remains actor-only comparison data and does not replace
 * SceneRaycaster or the live menu/hover interaction path.
 */
export class WebGPUDynamicPickingController {
    private initialized = false;
    private initializing?: Promise<void>;
    private sceneUniforms?: WebGPUSceneUniformBuffer;
    private sceneBindGroup?: WebGPUBindGroupLike;
    private playerCullPipeline?: WebGPURenderPipelineLike;
    private playerNoCullPipeline?: WebGPURenderPipelineLike;
    private npcCullPipeline?: WebGPURenderPipelineLike;
    private npcNoCullPipeline?: WebGPURenderPipelineLike;
    private pickTexture?: WebGPUTextureLike;
    private depthTexture?: WebGPUTextureLike;
    private targetWidth = 0;
    private targetHeight = 0;
    private readbackBuffer?: WebGPUBufferLike;
    private busy = false;
    private queued?: DynamicPickRequest;
    private disposed = false;

    constructor(
        private readonly host: WebGLOsrsRenderer,
        private readonly renderer: WebGPUStaticSceneRenderer,
        private readonly backend: WebGPUGraphicsBackend = renderer.backend,
    ) {}

    request(
        frame: SceneFrameDescription,
        canvasX: number,
        canvasY: number,
    ): Promise<WebGPUDynamicResolvedPickResult | undefined> {
        if (this.disposed || !isPointInsideSceneViewport(frame, canvasX, canvasY)) {
            return Promise.resolve(undefined);
        }
        const resolutionSnapshot = captureResolutionSnapshot(this.host);
        return new Promise((resolve, reject) => {
            const request: DynamicPickRequest = {
                frame,
                x: canvasX | 0,
                y: canvasY | 0,
                resolutionSnapshot,
                resolve,
                reject,
            };
            if (this.busy) {
                this.queued?.resolve(undefined);
                this.queued = request;
                return;
            }
            void this.execute(request);
        });
    }

    private get access(): DynamicPickingRendererAccess {
        return this.renderer as unknown as DynamicPickingRendererAccess;
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
        if (!device || !sceneLayout || !mapLayout || !textureLayout) {
            throw new Error("WebGPU comparison renderer must be initialized before dynamic picking");
        }

        const heightLayout = device.createBindGroupLayout({
            label: "dynamic-pick-height-bind-group-layout",
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
        const playerModule = await this.backend.compileShaderModule(
            patchWebGPUDynamicActorShaderForPicking(WEBGPU_PLAYER_ALPHA_SHADER, "player"),
            "dynamic-player-pick",
        );
        const npcModule = await this.backend.compileShaderModule(
            patchWebGPUDynamicActorShaderForPicking(WEBGPU_NPC_ALPHA_SHADER, "npc"),
            "dynamic-npc-pick",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "dynamic-pick-pipeline-layout",
            bindGroupLayouts: [sceneLayout, mapLayout, textureLayout, heightLayout],
        });
        const vertexBuffers = [
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
        ];
        const createPipeline = (
            label: string,
            module: WebGPUShaderModuleLike,
            vertexEntryPoint: "vsPlayerOpaque" | "vsNpcOpaque",
            cullMode: "back" | "none",
        ): WebGPURenderPipelineLike =>
            device.createRenderPipeline({
                label,
                layout: pipelineLayout,
                vertex: {
                    module,
                    entryPoint: vertexEntryPoint,
                    buffers: vertexBuffers,
                },
                fragment: {
                    module,
                    entryPoint: "fsDynamicPick",
                    targets: [{ format: WEBGPU_DYNAMIC_PICK_FORMAT }],
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

        this.playerCullPipeline = createPipeline(
            "dynamic-pick-player-cull",
            playerModule,
            "vsPlayerOpaque",
            "back",
        );
        this.playerNoCullPipeline = createPipeline(
            "dynamic-pick-player-no-cull",
            playerModule,
            "vsPlayerOpaque",
            "none",
        );
        this.npcCullPipeline = createPipeline(
            "dynamic-pick-npc-cull",
            npcModule,
            "vsNpcOpaque",
            "back",
        );
        this.npcNoCullPipeline = createPipeline(
            "dynamic-pick-npc-no-cull",
            npcModule,
            "vsNpcOpaque",
            "none",
        );

        const sceneUniforms = new WebGPUSceneUniformBuffer(device);
        this.sceneUniforms = sceneUniforms;
        this.sceneBindGroup = device.createBindGroup({
            label: "dynamic-pick-scene-bind-group",
            layout: sceneLayout,
            entries: [{ binding: 0, resource: { buffer: sceneUniforms.buffer } }],
        });
        this.readbackBuffer = device.createBuffer({
            label: "dynamic-pick-readback",
            size: WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW,
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
            label: "dynamic-pick-id-target",
            size: { width: nextWidth, height: nextHeight, depthOrArrayLayers: 1 },
            format: WEBGPU_DYNAMIC_PICK_FORMAT,
            usage: WEBGPU_TEXTURE_USAGE.RENDER_ATTACHMENT | WEBGPU_TEXTURE_USAGE.COPY_SRC,
        });
        this.depthTexture = device.createTexture({
            label: "dynamic-pick-depth-target",
            size: { width: nextWidth, height: nextHeight, depthOrArrayLayers: 1 },
            format: "depth24plus",
            usage: WEBGPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        });
        this.targetWidth = nextWidth;
        this.targetHeight = nextHeight;
    }

    private replayActorPhases(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
    ): void {
        const playerCull = this.playerCullPipeline;
        const playerNoCull = this.playerNoCullPipeline;
        const npcCull = this.npcCullPipeline;
        const npcNoCull = this.npcNoCullPipeline;
        if (!playerCull || !playerNoCull || !npcCull || !npcNoCull) return;

        replayWebGPUOpaqueActorPhase(
            "npc",
            this.renderer,
            new DynamicActorPickPassProxy(
                pass,
                "npc",
                false,
                frame.cullBackFace,
                playerCull,
                playerNoCull,
                npcCull,
                npcNoCull,
            ),
            frame,
        );
        replayWebGPUOpaqueActorPhase(
            "player",
            this.renderer,
            new DynamicActorPickPassProxy(
                pass,
                "player",
                false,
                frame.cullBackFace,
                playerCull,
                playerNoCull,
                npcCull,
                npcNoCull,
            ),
            frame,
        );
        replayWebGPUTransparentActorPhase(
            "npc",
            this.renderer,
            new DynamicActorPickPassProxy(
                pass,
                "npc",
                true,
                frame.cullBackFace,
                playerCull,
                playerNoCull,
                npcCull,
                npcNoCull,
            ),
            frame,
        );
        replayWebGPUTransparentActorPhase(
            "player",
            this.renderer,
            new DynamicActorPickPassProxy(
                pass,
                "player",
                true,
                frame.cullBackFace,
                playerCull,
                playerNoCull,
                npcCull,
                npcNoCull,
            ),
            frame,
        );
    }

    private async renderAndRead(
        request: DynamicPickRequest,
    ): Promise<WebGPUDynamicResolvedPickResult | undefined> {
        await this.ensureInitialized();
        if (this.disposed || !isPointInsideSceneViewport(request.frame, request.x, request.y)) {
            return undefined;
        }

        const access = this.access;
        const device = access.device ?? this.backend.device;
        const sceneUniforms = this.sceneUniforms;
        const sceneBindGroup = this.sceneBindGroup;
        const textureBindGroup = access.terrainTextures?.bindGroup;
        const readback = this.readbackBuffer;
        if (!device || !sceneUniforms || !sceneBindGroup || !textureBindGroup || !readback) {
            return undefined;
        }
        if (!readback.mapAsync || !readback.getMappedRange || !readback.unmap) {
            throw new Error("WebGPU dynamic pick readback is unavailable on this device wrapper");
        }

        this.ensureTargets(device, request.frame.canvasWidth, request.frame.canvasHeight);
        const pickTexture = this.pickTexture;
        const depthTexture = this.depthTexture;
        if (!pickTexture || !depthTexture) return undefined;

        sceneUniforms.update(request.frame);
        const encoder = device.createCommandEncoder({ label: "dynamic-pick-encoder" });
        const copyTextureToBuffer = encoder.copyTextureToBuffer;
        if (!copyTextureToBuffer) {
            throw new Error("WebGPU dynamic pick texture readback is unavailable");
        }
        const pass = encoder.beginRenderPass({
            label: "dynamic-pick-pass",
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
        pass.setBindGroup(2, textureBindGroup);
        const viewport = request.frame.sceneViewport;
        pass.setViewport?.(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
        pass.setScissorRect?.(request.x, request.y, 1, 1);
        this.replayActorPhases(pass, request.frame);
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
                bytesPerRow: WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW,
                rowsPerImage: 1,
            },
            { width: 1, height: 1, depthOrArrayLayers: 1 },
        );
        device.queue.submit([encoder.finish()]);

        await readback.mapAsync(WEBGPU_MAP_MODE.READ, 0, WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL);
        try {
            const mapped = readback.getMappedRange(0, WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL);
            const words = new Uint32Array(mapped.slice(0, WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL));
            const pick = decodeWebGPUDynamicPickWords(words);
            return pick
                ? resolveWebGPUDynamicPickFromSnapshot(pick, request.resolutionSnapshot)
                : undefined;
        } finally {
            readback.unmap();
        }
    }

    private async execute(request: DynamicPickRequest): Promise<void> {
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
            if (next) void this.execute(next);
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
        this.playerCullPipeline = undefined;
        this.playerNoCullPipeline = undefined;
        this.npcCullPipeline = undefined;
        this.npcNoCullPipeline = undefined;
        this.initialized = false;
    }
}
