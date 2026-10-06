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
import { drawWebGPUOrderedStaticGeometry } from "../loc/WebGPUStaticLocDrawOrdering";
import type { WebGPUStaticLocResources } from "../loc/WebGPUStaticLocResources";
import { replayWebGPUOpaqueActorPhase } from "../actor/WebGPUOpaqueActorPhase";
import { replayWebGPUTransparentActorPhase } from "../actor/WebGPUTransparentActorPhase";
import { WEBGPU_NPC_ALPHA_SHADER } from "../npc/WebGPUNpcAlphaShader";
import {
    WEBGPU_PLAYER_INSTANCE_STRIDE_BYTES,
} from "../player/WebGPUPlayerOpaqueComparison";
import { WEBGPU_PLAYER_ALPHA_SHADER } from "../player/WebGPUPlayerAlphaShader";
import { WebGPUSceneUniformBuffer } from "../WebGPUSceneUniforms";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import { patchWebGPUStaticSceneShaderForWorldEntities } from "../WebGPUStaticSceneShaderPatch";
import type { WebGPUTerrainMapResources } from "../terrain/WebGPUTerrainMapResources";
import { WEBGPU_TERRAIN_SHADER } from "../terrain/WebGPUTerrainShader";
import {
    WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL,
    WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW,
    decodeWebGPUDynamicPickWords,
    type WebGPUDynamicPickResult,
} from "./WebGPUDynamicPicking";
import type { WebGPUDynamicResolvedPickResult } from "./WebGPUDynamicPickingController";
import {
    WEBGPU_COMBINED_DYNAMIC_PICK_TAG,
    patchWebGPUDynamicActorShaderForCombinedPicking,
} from "./WebGPUDynamicPickingShaderPatch";
import {
    WEBGPU_STATIC_PICK_FORMAT,
    decodeWebGPUStaticPickWords,
    type WebGPUStaticPickResult,
} from "./WebGPUStaticPicking";

const PLAYER_INTERACT_BASE = 0x8000;
const DYNAMIC_KIND_MASK = 0x7fffffff;

interface PickTextureResources {
    bindGroup: WebGPUBindGroupLike;
}

interface CombinedPickingRendererAccess {
    device?: WebGPUDeviceLike;
    sceneBindGroupLayout?: WebGPUBindGroupLayoutLike;
    mapBindGroupLayout?: WebGPUBindGroupLayoutLike;
    textureBindGroupLayout?: WebGPUBindGroupLayoutLike;
    waterBindGroupLayout?: WebGPUBindGroupLayoutLike;
    locBindGroupLayout?: WebGPUBindGroupLayoutLike;
    terrainTextures?: PickTextureResources;
    waterResources?: PickTextureResources;
    mapsById: Map<number, WebGPUTerrainMapResources>;
    locsById: Map<number, WebGPUStaticLocResources>;
    groundItemsById: Map<number, WebGPUStaticLocResources>;
    doorsById: Map<number, WebGPUStaticLocResources>;
    mapOrder: number[];
    visibleMapOrder: number[];
    visibleMapLod: number[];
    visibilityFilterEnabled: boolean;
}

export type WebGPUCombinedDynamicIdentity = {
    actorId: number;
    serverId: number;
};

export type WebGPUCombinedDynamicIdentitySnapshot = {
    players: Map<string, WebGPUCombinedDynamicIdentity>;
    npcs: Map<number, WebGPUCombinedDynamicIdentity>;
};

export type WebGPUCombinedPickResult =
    | {
          source: "static";
          result: WebGPUStaticPickResult;
      }
    | {
          source: "dynamic";
          result: WebGPUDynamicResolvedPickResult;
      };

type CombinedPickRequest = {
    frame: SceneFrameDescription;
    x: number;
    y: number;
    resolve: (result: WebGPUCombinedPickResult | undefined) => void;
    reject: (error: unknown) => void;
};

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

function captureDynamicIdentitySnapshot(
    host: WebGLOsrsRenderer,
): WebGPUCombinedDynamicIdentitySnapshot {
    const players = new Map<string, WebGPUCombinedDynamicIdentity>();
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

    const npcs = new Map<number, WebGPUCombinedDynamicIdentity>();
    const npcEcs = host.osrsClient.npcEcs;
    for (const actorIdRaw of npcEcs.getServerLinkedEcsIds()) {
        const actorId = actorIdRaw | 0;
        const serverId = npcEcs.getServerId(actorId) | 0;
        if (serverId < 0) continue;
        npcs.set(serverId >>> 0, { actorId, serverId });
    }
    return { players, npcs };
}

function resolveDynamicPick(
    pick: WebGPUDynamicPickResult,
    snapshot: WebGPUCombinedDynamicIdentitySnapshot,
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

/**
 * Decode the final pixel from the shared M3 static/dynamic target.
 *
 * Static payloads retain their original InteractType word. Dynamic payloads set
 * the high bit of word 2, then retain the M1/M2 player/NPC kind in the low bits.
 */
export function decodeWebGPUCombinedPickWords(
    words: ArrayLike<number>,
    snapshot: WebGPUCombinedDynamicIdentitySnapshot,
): WebGPUCombinedPickResult | undefined {
    if (words.length < 4) {
        throw new Error("WebGPU combined pick readback requires four uint32 words");
    }
    const hitWord = Number(words[3]) >>> 0;
    if (hitWord === 0) return undefined;

    const typeWord = Number(words[2]) >>> 0;
    if ((typeWord & WEBGPU_COMBINED_DYNAMIC_PICK_TAG) !== 0) {
        const normalized = new Uint32Array([
            Number(words[0]) >>> 0,
            Number(words[1]) >>> 0,
            (typeWord & DYNAMIC_KIND_MASK) >>> 0,
            hitWord,
        ]);
        const dynamic = decodeWebGPUDynamicPickWords(normalized);
        if (!dynamic) return undefined;
        const resolved = resolveDynamicPick(dynamic, snapshot);
        return resolved ? { source: "dynamic", result: resolved } : undefined;
    }

    const staticPick = decodeWebGPUStaticPickWords(words);
    return staticPick ? { source: "static", result: staticPick } : undefined;
}

function sourcePipelineLabel(pipeline: WebGPURenderPipelineLike): string {
    return String((pipeline as any)?.label ?? "").toLowerCase();
}

class CombinedActorPickPassProxy implements WebGPURenderPassEncoderLike {
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
        // Registry phase handlers never own the combined parent pass lifetime.
    }
}

/**
 * M3 comparison-only GPU picker.
 *
 * Static scene geometry and player/NPC geometry share one integer render target
 * and one depth target, so the GPU resolves the visible winner at the requested
 * screen pixel. Effect-only phases remain deliberately excluded.
 */
export class WebGPUCombinedPickingController {
    private initialized = false;
    private initializing?: Promise<void>;
    private sceneUniforms?: WebGPUSceneUniformBuffer;
    private sceneBindGroup?: WebGPUBindGroupLike;

    private terrainCullPipeline?: WebGPURenderPipelineLike;
    private terrainNoCullPipeline?: WebGPURenderPipelineLike;
    private locCullPipeline?: WebGPURenderPipelineLike;
    private locNoCullPipeline?: WebGPURenderPipelineLike;

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
    private queued?: CombinedPickRequest;
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
    ): Promise<WebGPUCombinedPickResult | undefined> {
        if (this.disposed || !isPointInsideSceneViewport(frame, canvasX, canvasY)) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve, reject) => {
            const request: CombinedPickRequest = {
                frame,
                x: canvasX | 0,
                y: canvasY | 0,
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

    private get access(): CombinedPickingRendererAccess {
        return this.renderer as unknown as CombinedPickingRendererAccess;
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
            throw new Error("WebGPU comparison renderer must be initialized before combined picking");
        }

        const sceneUniforms = new WebGPUSceneUniformBuffer(device);
        this.sceneUniforms = sceneUniforms;
        this.sceneBindGroup = device.createBindGroup({
            label: "combined-pick-scene-bind-group",
            layout: sceneLayout,
            entries: [{ binding: 0, resource: { buffer: sceneUniforms.buffer } }],
        });

        const staticModule = await this.backend.compileShaderModule(
            patchWebGPUStaticSceneShaderForWorldEntities(WEBGPU_TERRAIN_SHADER),
            "combined-static-pick",
        );
        const playerModule = await this.backend.compileShaderModule(
            patchWebGPUDynamicActorShaderForCombinedPicking(WEBGPU_PLAYER_ALPHA_SHADER, "player"),
            "combined-player-pick",
        );
        const npcModule = await this.backend.compileShaderModule(
            patchWebGPUDynamicActorShaderForCombinedPicking(WEBGPU_NPC_ALPHA_SHADER, "npc"),
            "combined-npc-pick",
        );

        this.createStaticPipelines(
            device,
            staticModule,
            sceneLayout,
            mapLayout,
            textureLayout,
            waterLayout,
            locLayout,
        );
        this.createDynamicPipelines(
            device,
            playerModule,
            npcModule,
            sceneLayout,
            mapLayout,
            textureLayout,
        );

        this.readbackBuffer = device.createBuffer({
            label: "combined-pick-readback",
            size: WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW,
            usage: WEBGPU_BUFFER_USAGE.COPY_DST | WEBGPU_BUFFER_USAGE.MAP_READ,
        });
    }

    private createStaticPipelines(
        device: WebGPUDeviceLike,
        module: WebGPUShaderModuleLike,
        sceneLayout: WebGPUBindGroupLayoutLike,
        mapLayout: WebGPUBindGroupLayoutLike,
        textureLayout: WebGPUBindGroupLayoutLike,
        waterLayout: WebGPUBindGroupLayoutLike,
        locLayout: WebGPUBindGroupLayoutLike,
    ): void {
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
            "combined-pick-terrain-cull",
            "vsMain",
            "back",
            [sceneLayout, mapLayout, textureLayout, waterLayout],
        );
        this.terrainNoCullPipeline = createPipeline(
            "combined-pick-terrain-no-cull",
            "vsMain",
            "none",
            [sceneLayout, mapLayout, textureLayout, waterLayout],
        );
        this.locCullPipeline = createPipeline(
            "combined-pick-loc-cull",
            "vsLocMain",
            "back",
            [sceneLayout, mapLayout, textureLayout, waterLayout, locLayout],
        );
        this.locNoCullPipeline = createPipeline(
            "combined-pick-loc-no-cull",
            "vsLocMain",
            "none",
            [sceneLayout, mapLayout, textureLayout, waterLayout, locLayout],
        );
    }

    private createDynamicPipelines(
        device: WebGPUDeviceLike,
        playerModule: WebGPUShaderModuleLike,
        npcModule: WebGPUShaderModuleLike,
        sceneLayout: WebGPUBindGroupLayoutLike,
        mapLayout: WebGPUBindGroupLayoutLike,
        textureLayout: WebGPUBindGroupLayoutLike,
    ): void {
        const heightLayout = device.createBindGroupLayout({
            label: "combined-pick-height-bind-group-layout",
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
        const pipelineLayout = device.createPipelineLayout({
            label: "combined-dynamic-pick-pipeline-layout",
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
                    entryPoint: "fsDynamicCombinedPick",
                    targets: [{ format: WEBGPU_STATIC_PICK_FORMAT }],
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
            "combined-pick-player-cull",
            playerModule,
            "vsPlayerOpaque",
            "back",
        );
        this.playerNoCullPipeline = createPipeline(
            "combined-pick-player-no-cull",
            playerModule,
            "vsPlayerOpaque",
            "none",
        );
        this.npcCullPipeline = createPipeline(
            "combined-pick-npc-cull",
            npcModule,
            "vsNpcOpaque",
            "back",
        );
        this.npcNoCullPipeline = createPipeline(
            "combined-pick-npc-no-cull",
            npcModule,
            "vsNpcOpaque",
            "none",
        );
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
            label: "combined-pick-id-target",
            size: { width: nextWidth, height: nextHeight, depthOrArrayLayers: 1 },
            format: WEBGPU_STATIC_PICK_FORMAT,
            usage: WEBGPU_TEXTURE_USAGE.RENDER_ATTACHMENT | WEBGPU_TEXTURE_USAGE.COPY_SRC,
        });
        this.depthTexture = device.createTexture({
            label: "combined-pick-depth-target",
            size: { width: nextWidth, height: nextHeight, depthOrArrayLayers: 1 },
            format: "depth24plus",
            usage: WEBGPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        });
        this.targetWidth = nextWidth;
        this.targetHeight = nextHeight;
    }

    private mapUsesLod(access: CombinedPickingRendererAccess, index: number): boolean {
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
        access: CombinedPickingRendererAccess,
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

    private drawStaticPhase(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        transparent: boolean,
    ): void {
        const access = this.access;
        const sceneBindGroup = this.sceneBindGroup;
        const terrainTextures = access.terrainTextures;
        const waterResources = access.waterResources;
        const terrainPipeline = frame.cullBackFace
            ? this.terrainCullPipeline
            : this.terrainNoCullPipeline;
        const locPipeline = frame.cullBackFace
            ? this.locCullPipeline
            : this.locNoCullPipeline;
        if (!sceneBindGroup || !terrainTextures || !waterResources || !terrainPipeline || !locPipeline) {
            return;
        }

        pass.setBindGroup(0, sceneBindGroup);
        pass.setBindGroup(2, terrainTextures.bindGroup);
        pass.setBindGroup(3, waterResources.bindGroup);
        const order = access.visibilityFilterEnabled ? access.visibleMapOrder : access.mapOrder;
        if (!transparent) {
            for (let i = 0; i < order.length; i++) {
                const id = order[i];
                const map = access.mapsById.get(id);
                if (!map) continue;
                const lod = this.mapUsesLod(access, i);
                this.drawTerrain(pass, frame, map, lod, false, terrainPipeline);
                this.drawLocLike(pass, frame, map, id, lod, false, locPipeline, access);
            }
            return;
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

    private replayActorPhase(
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        transparent: boolean,
    ): void {
        const access = this.access;
        const sceneBindGroup = this.sceneBindGroup;
        const terrainTextures = access.terrainTextures;
        const playerCull = this.playerCullPipeline;
        const playerNoCull = this.playerNoCullPipeline;
        const npcCull = this.npcCullPipeline;
        const npcNoCull = this.npcNoCullPipeline;
        if (
            !sceneBindGroup ||
            !terrainTextures ||
            !playerCull ||
            !playerNoCull ||
            !npcCull ||
            !npcNoCull
        ) {
            return;
        }
        pass.setBindGroup(0, sceneBindGroup);
        pass.setBindGroup(2, terrainTextures.bindGroup);

        const npcProxy = new CombinedActorPickPassProxy(
            pass,
            "npc",
            transparent,
            frame.cullBackFace,
            playerCull,
            playerNoCull,
            npcCull,
            npcNoCull,
        );
        const playerProxy = new CombinedActorPickPassProxy(
            pass,
            "player",
            transparent,
            frame.cullBackFace,
            playerCull,
            playerNoCull,
            npcCull,
            npcNoCull,
        );
        if (transparent) {
            replayWebGPUTransparentActorPhase("npc", this.renderer, npcProxy, frame);
            replayWebGPUTransparentActorPhase("player", this.renderer, playerProxy, frame);
        } else {
            replayWebGPUOpaqueActorPhase("npc", this.renderer, npcProxy, frame);
            replayWebGPUOpaqueActorPhase("player", this.renderer, playerProxy, frame);
        }
    }

    private async renderAndRead(
        request: CombinedPickRequest,
    ): Promise<WebGPUCombinedPickResult | undefined> {
        await this.ensureInitialized();
        if (this.disposed || !isPointInsideSceneViewport(request.frame, request.x, request.y)) {
            return undefined;
        }

        const access = this.access;
        const device = access.device ?? this.backend.device;
        const sceneUniforms = this.sceneUniforms;
        const readback = this.readbackBuffer;
        if (!device || !sceneUniforms || !readback) return undefined;
        if (!readback.mapAsync || !readback.getMappedRange || !readback.unmap) {
            throw new Error("WebGPU combined pick readback is unavailable on this device wrapper");
        }

        this.ensureTargets(device, request.frame.canvasWidth, request.frame.canvasHeight);
        const pickTexture = this.pickTexture;
        const depthTexture = this.depthTexture;
        if (!pickTexture || !depthTexture) return undefined;

        // SceneFrameDescription is mutated in place each frame. Freeze actor
        // identity immediately before recording/submission so asynchronous
        // readback resolves against the same player-slot/NPC state we replay.
        const identitySnapshot = captureDynamicIdentitySnapshot(this.host);
        sceneUniforms.update(request.frame);

        const encoder = device.createCommandEncoder({ label: "combined-pick-encoder" });
        const copyTextureToBuffer = encoder.copyTextureToBuffer;
        if (!copyTextureToBuffer) {
            throw new Error("WebGPU combined pick texture readback is unavailable");
        }
        const pass = encoder.beginRenderPass({
            label: "combined-pick-pass",
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
        const viewport = request.frame.sceneViewport;
        pass.setViewport?.(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
        pass.setScissorRect?.(request.x, request.y, 1, 1);

        // Preserve interaction-relevant renderer ordering while deliberately
        // omitting non-pickable GFX/projectile phases from the depth contest.
        this.drawStaticPhase(pass, request.frame, false);
        this.replayActorPhase(pass, request.frame, false);
        this.drawStaticPhase(pass, request.frame, true);
        this.replayActorPhase(pass, request.frame, true);
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
            return decodeWebGPUCombinedPickWords(words, identitySnapshot);
        } finally {
            readback.unmap();
        }
    }

    private async execute(request: CombinedPickRequest): Promise<void> {
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
        this.terrainCullPipeline = undefined;
        this.terrainNoCullPipeline = undefined;
        this.locCullPipeline = undefined;
        this.locNoCullPipeline = undefined;
        this.playerCullPipeline = undefined;
        this.playerNoCullPipeline = undefined;
        this.npcCullPipeline = undefined;
        this.npcNoCullPipeline = undefined;
        this.initialized = false;
    }
}
