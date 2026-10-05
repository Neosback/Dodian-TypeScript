import type { GroundItemGeometryBuildData } from "../../ground/GroundItemMeshBuilder";
import type { LocGeometryData } from "../../loader/SdMapData";
import type { WebGPUBindGroupLayoutLike, WebGPUDeviceLike } from "../../backend/WebGPUPlatform";
import { WebGPUStaticLocResources } from "../loc/WebGPUStaticLocResources";

/**
 * Ground items use the same packed scene-model contract as static locs. Keep the
 * adapter explicit so the authoritative WebGL/CPU ground-item builder remains
 * the only place that decides stack contents, bridge-aware height planes, and
 * item-model geometry.
 */
export function createWebGPUStaticGroundItemGeometryData(
    data: GroundItemGeometryBuildData,
): LocGeometryData {
    return {
        vertices: data.vertices,
        indices: data.indices,
        facePriorities: data.facePriorities,
        facePriorityModelSpans: data.facePriorityModelSpans,

        modelTextureData: data.modelTextureData,
        modelTextureDataAlpha: data.modelTextureDataAlpha,
        modelTextureDataLod: data.modelTextureDataLod,
        modelTextureDataLodAlpha: data.modelTextureDataLodAlpha,
        modelTextureDataInteract: data.modelTextureDataInteract,
        modelTextureDataInteractAlpha: data.modelTextureDataInteractAlpha,
        modelTextureDataInteractLod: data.modelTextureDataInteractLod,
        modelTextureDataInteractLodAlpha: data.modelTextureDataInteractLodAlpha,

        drawRanges: data.drawRanges,
        drawRangesAlpha: data.drawRangesAlpha,
        drawRangesPlanes: data.planes.main,
        drawRangesAlphaPlanes: data.planes.alpha,
        drawRangesLod: data.drawRangesLod,
        drawRangesLodAlpha: data.drawRangesLodAlpha,
        drawRangesLodPlanes: data.planes.lod,
        drawRangesLodAlphaPlanes: data.planes.lodAlpha,
        drawRangesInteract: data.drawRangesInteract,
        drawRangesInteractAlpha: data.drawRangesInteractAlpha,
        drawRangesInteractPlanes: data.planes.interact,
        drawRangesInteractAlphaPlanes: data.planes.interactAlpha,
        drawRangesInteractLod: data.drawRangesInteractLod,
        drawRangesInteractLodAlpha: data.drawRangesInteractLodAlpha,
        drawRangesInteractLodPlanes: data.planes.interactLod,
        drawRangesInteractLodAlphaPlanes: data.planes.interactLodAlpha,
    };
}

export class WebGPUStaticGroundItemResources extends WebGPUStaticLocResources {
    constructor(
        device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
        mapX: number,
        mapY: number,
        heightMapSize: number,
        heightMapTextureData: Int16Array,
        data: GroundItemGeometryBuildData,
    ) {
        super(
            device,
            bindGroupLayout,
            mapX,
            mapY,
            createWebGPUStaticGroundItemGeometryData(data),
            heightMapSize,
            heightMapTextureData,
            false,
        );
    }
}