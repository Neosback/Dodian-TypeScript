import type { Renderer } from "../../../game/render/Renderer";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import type { WebGLMapSquare } from "../../WebGLMapSquare";
import {
    createDynamicActorGeometry,
    type DynamicActorGeometry,
} from "../../dynamic/DynamicActorRenderData";
import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type { Projectile } from "../../projectiles/Projectile";
import {
    PROJECTILE_WEBGL_RECORD_WORDS,
    decodeProjectileWebGLRecord,
    type ProjectileRenderInstance,
} from "../../projectiles/ProjectileRenderData";
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
import { WEBGPU_PROJECTILE_SHADER } from "./WebGPUProjectileShader";

export type WebGPUProjectilePass = "opaque" | "alpha";

export const WEBGPU_PROJECTILE_INSTANCE_FLOATS = 12;
export const WEBGPU_PROJECTILE_INSTANCE_STRIDE_BYTES = WEBGPU_PROJECTILE_INSTANCE_FLOATS * 4;
export const WEBGPU_PROJECTILE_GEOMETRY_CACHE_LIMIT = 384;

export const WEBGPU_PROJECTILE_OPAQUE_PIPELINE_STATE = {
    depthWriteEnabled: true,
    depthCompare: "less-equal",
} as const;

export const WEBGPU_PROJECTILE_ALPHA_PIPELINE_STATE = {
    // ProjectileRenderer disables depth writes for translucent shell effects.
    depthWriteEnabled: false,
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

export interface WebGPUProjectileDrawSnapshot {
    frameToken: number;
    mapX: number;
    mapY: number;
    map: WebGLMapSquare;
    geometry: DynamicActorGeometry;
    instance: ProjectileRenderInstance;
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

interface ProjectileGroup {
    spotId: number;
    frameId: number;
    slots: number[];
}

const hostsByFrame = new WeakMap<object, WebGLOsrsRenderer>();
const runtimesByStaticRenderer = new WeakMap<WebGPUStaticSceneRenderer, WebGPUProjectileRuntime>();
let opaqueBoundaryPatched = false;
let alphaBoundaryPatched = false;
let disposeBoundaryPatched = false;

function comparisonRequested(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location?.search ?? "");
    const value = params.get("webgpuTerrain")?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "compare" || value === "split";
}

function mapKey(mapX: number, mapY: number): number {
    return (((mapX | 0) & 0xffff) << 16) | ((mapY | 0) & 0xffff);
}

function alignedBufferSize(byteLength: number): number {
    return Math.max(4, (Math.max(0, byteLength | 0) + 3) & ~3);
}

export function packWebGPUProjectileInstanceData(instance: ProjectileRenderInstance): Float32Array {
    const t = instance.transform;
    return new Float32Array([
        t.localX,
        t.localY,
        t.plane,
        t.yaw,
        t.pitch,
        t.roll,
        t.subOffsetX,
        t.subOffsetY,
        t.modelYOffset,
        instance.projectileId,
        instance.debugId,
        0,
    ]);
}

function resolveProjectileFrame(host: WebGLOsrsRenderer, projectile: Projectile): number {
    const renderer = host.projectileRenderer as any;
    if (typeof renderer?.resolveFrameIndex === "function") {
        return renderer.resolveFrameIndex(projectile.projectileId | 0, projectile) | 0;
    }
    const cache = host.gfxRenderer?.getCache?.();
    const count = Math.max(1, cache?.getFrameCount(projectile.projectileId | 0) ?? 1);
    const raw = projectile.animationFrame | 0;
    return ((raw % count) + count) % count;
}

function resolveProjectileModelYOffset(
    host: WebGLOsrsRenderer,
    projectile: Projectile,
    pos: { x: number; y: number; z: number },
): number {
    const renderer = host.projectileRenderer as any;
    if (typeof renderer?.resolveModelYOffset === "function") {
        return Number(renderer.resolveModelYOffset(projectile, pos)) || 0;
    }
    // Same initial fallback used by ProjectileRenderer before bridge-height sampling.
    return Number(pos.z) || 0;
}

export function groupWebGPUProjectilesLikeWebGL(
    host: WebGLOsrsRenderer,
    projectiles: readonly Projectile[],
): ProjectileGroup[] {
    const groups = new Map<string, ProjectileGroup>();
    for (let slot = 0; slot < projectiles.length; slot++) {
        const projectile = projectiles[slot];
        const spotId = projectile.projectileId | 0;
        const frameId = resolveProjectileFrame(host, projectile);
        const key = `${spotId}|${frameId}`;
        let group = groups.get(key);
        if (!group) {
            group = { spotId, frameId, slots: [] };
            groups.set(key, group);
        }
        group.slots.push(slot);
    }
    return Array.from(groups.values());
}

function cacheGeometry(
    geometryByKey: Map<string, DynamicActorGeometry>,
    spotId: number,
    frameId: number,
    pass: WebGPUProjectilePass,
    raw: { vertices: Uint8Array; indices: Int32Array },
): DynamicActorGeometry {
    const key = `projectile:${spotId | 0}:${frameId | 0}:${pass}`;
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
    while (geometryByKey.size > WEBGPU_PROJECTILE_GEOMETRY_CACHE_LIMIT) {
        const oldest = geometryByKey.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        geometryByKey.delete(oldest);
    }
    return geometry;
}

function collectProjectileDraws(
    host: WebGLOsrsRenderer,
    geometryByKey: Map<string, DynamicActorGeometry>,
    frame: SceneFrameDescription,
    pass: WebGPUProjectilePass,
): WebGPUProjectileDrawSnapshot[] {
    const manager = host.projectileManager;
    const gfxCache = host.gfxRenderer?.getCache?.();
    if (!manager || !gfxCache) return [];

    const out: WebGPUProjectileDrawSnapshot[] = [];
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
        const baseOffset = map.projectileDataTextureOffsets?.[0] ?? -1;
        if (baseOffset < 0) continue;

        // ProjectileManager owns map membership from the projectile's current world
        // position. Copy immediately because getProjectilesForMap reuses its array.
        const projectiles = Array.from(manager.getProjectilesForMap(map.mapX, map.mapY));
        if (projectiles.length === 0) continue;
        const groups = groupWebGPUProjectilesLikeWebGL(host, projectiles);
        const mapWorldX = map.mapX << 13;
        const mapWorldY = map.mapY << 13;

        for (const group of groups) {
            const raw = gfxCache.ensureFrameGeometry(
                group.spotId,
                group.frameId,
                pass === "alpha",
            );
            if (!raw || raw.vertices.byteLength === 0 || raw.indices.length === 0) continue;
            const geometry = cacheGeometry(
                geometryByKey,
                group.spotId,
                group.frameId,
                pass,
                raw,
            );

            for (const slot of group.slots) {
                const projectile = projectiles[slot];
                if (!projectile) continue;
                const recordIndex = (baseOffset | 0) + (slot | 0);
                const wordOffset = recordIndex * PROJECTILE_WEBGL_RECORD_WORDS;
                let decoded;
                try {
                    decoded = decodeProjectileWebGLRecord(host.actorRenderData, wordOffset);
                } catch {
                    continue;
                }

                const pos = projectile.getPosition();
                const relativeX = pos.x - mapWorldX;
                const relativeY = pos.y - mapWorldY;
                const baseRelativeX = Math.floor(relativeX);
                const baseRelativeY = Math.floor(relativeY);
                const subOffsetX = relativeX - baseRelativeX;
                const subOffsetY = relativeY - baseRelativeY;
                const instance: ProjectileRenderInstance = {
                    projectileId: projectile.projectileId | 0,
                    debugId: projectile.debugId | 0,
                    frameId: group.frameId | 0,
                    sourceMapId: map.id,
                    transform: {
                        // Placement/angles come from the authoritative compatibility
                        // record so WebGPU sees the same signed/quantized values as WebGL.
                        localX: decoded.localX,
                        localY: decoded.localY,
                        plane: decoded.plane,
                        yaw: decoded.yaw,
                        pitch: decoded.pitch,
                        roll: decoded.roll,
                        subOffsetX,
                        subOffsetY,
                        modelYOffset: resolveProjectileModelYOffset(host, projectile, pos),
                    },
                };
                out.push({
                    frameToken: frame.currentTime,
                    mapX: map.mapX | 0,
                    mapY: map.mapY | 0,
                    map,
                    geometry,
                    instance,
                });
            }
        }
    }
    return out;
}

class WebGPUProjectileRuntime {
    private device?: WebGPUDeviceLike;
    private heightLayout?: WebGPUBindGroupLayoutLike;
    private opaqueCullPipeline?: WebGPURenderPipelineLike;
    private opaqueNoCullPipeline?: WebGPURenderPipelineLike;
    private alphaCullPipeline?: WebGPURenderPipelineLike;
    private alphaNoCullPipeline?: WebGPURenderPipelineLike;
    private initPromise?: Promise<void>;
    private ready = false;
    private failed = false;
    private geometry = new Map<string, GeometryGpuResources>();
    private heights = new Map<number, HeightGpuResources>();
    private instances = new Map<string, InstanceGpuResources>();
    readonly geometryByKey = new Map<string, DynamicActorGeometry>();

    constructor(private readonly staticRenderer: WebGPUStaticSceneRenderer) {}

    ensureInitialized(): void {
        if (this.ready || this.failed || this.initPromise) return;
        this.initPromise = this.init().catch((error) => {
            this.failed = true;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[WebGPU projectile comparison] Projectile pass disabled: ${message}`);
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
            label: "projectile-height-bind-group-layout",
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
            WEBGPU_PROJECTILE_SHADER,
            "projectile-foundation",
        );
        const pipelineLayout = device.createPipelineLayout({
            label: "projectile-pipeline-layout",
            bindGroupLayouts: [sceneLayout, mapLayout, textureLayout, heightLayout],
        });
        const vertex = {
            module,
            entryPoint: "vsProjectile",
            buffers: [
                {
                    arrayStride: 12,
                    stepMode: "vertex",
                    attributes: [{ shaderLocation: 0, offset: 0, format: "uint32x3" }],
                },
                {
                    arrayStride: WEBGPU_PROJECTILE_INSTANCE_STRIDE_BYTES,
                    stepMode: "instance",
                    attributes: [
                        { shaderLocation: 1, offset: 0, format: "float32x4" },
                        { shaderLocation: 2, offset: 16, format: "float32x4" },
                        { shaderLocation: 3, offset: 32, format: "float32x4" },
                    ],
                },
            ],
        };
        const alphaBlend = WEBGPU_PROJECTILE_ALPHA_PIPELINE_STATE.blend;
        const createPipeline = (
            label: string,
            fragmentEntryPoint: "fsGfxOpaque" | "fsGfxAlpha",
            cullMode: "back" | "none",
            transparent: boolean,
        ): WebGPURenderPipelineLike =>
            device.createRenderPipeline({
                label,
                layout: pipelineLayout,
                vertex,
                fragment: {
                    module,
                    entryPoint: fragmentEntryPoint,
                    targets: [
                        transparent ? { format, blend: alphaBlend } : { format },
                    ],
                },
                primitive: {
                    topology: "triangle-list",
                    frontFace: "ccw",
                    cullMode,
                },
                depthStencil: {
                    format: "depth24plus",
                    depthWriteEnabled: transparent
                        ? WEBGPU_PROJECTILE_ALPHA_PIPELINE_STATE.depthWriteEnabled
                        : WEBGPU_PROJECTILE_OPAQUE_PIPELINE_STATE.depthWriteEnabled,
                    depthCompare: "less-equal",
                },
            });

        this.opaqueCullPipeline = createPipeline(
            "projectile-opaque-cull-pipeline",
            "fsGfxOpaque",
            "back",
            false,
        );
        this.opaqueNoCullPipeline = createPipeline(
            "projectile-opaque-no-cull-pipeline",
            "fsGfxOpaque",
            "none",
            false,
        );
        this.alphaCullPipeline = createPipeline(
            "projectile-alpha-cull-pipeline",
            "fsGfxAlpha",
            "back",
            true,
        );
        this.alphaNoCullPipeline = createPipeline(
            "projectile-alpha-no-cull-pipeline",
            "fsGfxAlpha",
            "none",
            true,
        );
        this.device = device;
        this.heightLayout = heightLayout;
        this.ready = true;
    }

    private getGeometry(
        draw: WebGPUProjectileDrawSnapshot,
        pass: WebGPUProjectilePass,
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

    private getHeight(draw: WebGPUProjectileDrawSnapshot): HeightGpuResources | undefined {
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
            label: `projectile-${draw.mapX}-${draw.mapY}-height-bind-group`,
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
        passEncoder: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        host: WebGLOsrsRenderer,
        pass: WebGPUProjectilePass,
    ): void {
        if (this.failed) return;
        if (!this.ready) {
            this.ensureInitialized();
            return;
        }
        const rendererAny = this.staticRenderer as any;
        const mapsById = rendererAny.mapsById as Map<number, any> | undefined;
        if (!mapsById) return;

        const pipeline =
            pass === "opaque"
                ? frame.cullBackFace
                    ? this.opaqueCullPipeline
                    : this.opaqueNoCullPipeline
                : frame.cullBackFace
                  ? this.alphaCullPipeline
                  : this.alphaNoCullPipeline;
        if (!pipeline) return;

        const draws = collectProjectileDraws(host, this.geometryByKey, frame, pass);
        passEncoder.setPipeline(pipeline);
        for (const draw of draws) {
            if (draw.frameToken !== frame.currentTime) continue;
            const mapResources = mapsById.get(mapKey(draw.mapX, draw.mapY));
            const height = this.getHeight(draw);
            const geometry = this.getGeometry(draw, pass);
            if (!mapResources || !height || !geometry || geometry.indexCount <= 0) continue;

            passEncoder.setBindGroup(1, mapResources.sharedMapBindGroup);
            passEncoder.setBindGroup(3, height.bindGroup);
            const instanceData = packWebGPUProjectileInstanceData(draw.instance);
            const bufferKey = `${pass}:${draw.mapX}:${draw.mapY}:${draw.geometry.key}:${draw.instance.debugId}`;
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
        for (const resources of this.heights.values()) resources.heightMap.dispose();
        this.heights.clear();
        for (const resources of this.instances.values()) resources.buffer.destroy?.();
        this.instances.clear();
        this.device = undefined;
        this.heightLayout = undefined;
        this.opaqueCullPipeline = undefined;
        this.opaqueNoCullPipeline = undefined;
        this.alphaCullPipeline = undefined;
        this.alphaNoCullPipeline = undefined;
        this.ready = false;
    }
}

function getRuntime(renderer: WebGPUStaticSceneRenderer): WebGPUProjectileRuntime {
    let runtime = runtimesByStaticRenderer.get(renderer);
    if (!runtime) {
        runtime = new WebGPUProjectileRuntime(renderer);
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

/** Install after player-attached alpha GFX so projectiles remain the final actor effect pass. */
export function installWebGPUProjectileAlphaBoundary(): void {
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

export function installWebGPUProjectileComparison(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};
    const host = renderer as WebGLOsrsRenderer;
    const frame = host.sceneFrameDescription as SceneFrameDescription | undefined;
    if (!frame || !host.projectileManager || !host.projectileRenderer || !host.gfxRenderer) {
        return () => {};
    }
    patchOpaqueBoundary();
    hostsByFrame.set(frame as object, host);
    return () => {
        hostsByFrame.delete(frame as object);
    };
}
