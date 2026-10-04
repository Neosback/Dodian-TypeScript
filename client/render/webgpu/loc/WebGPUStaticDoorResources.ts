import type { SdMapData, LocGeometryData } from "../../loader/SdMapData";
import type { WebGPUBindGroupLayoutLike, WebGPUDeviceLike } from "../../backend/WebGPUPlatform";
import { WebGPUStaticLocResources } from "./WebGPUStaticLocResources";

/**
 * Door geometry uses the same packed vertex/model-info contract as ordinary
 * static locs, but the worker keeps it in independent fields so door packets
 * can replace doors without rebuilding the rest of the map square.
 */
export function createWebGPUStaticDoorGeometryData(data: SdMapData): LocGeometryData {
    return {
        vertices: data.doorVertices,
        indices: data.doorIndices,

        modelTextureData: data.doorModelTextureData,
        modelTextureDataAlpha: data.doorModelTextureDataAlpha,
        modelTextureDataLod: data.doorModelTextureDataLod,
        modelTextureDataLodAlpha: data.doorModelTextureDataLodAlpha,
        modelTextureDataInteract: data.doorModelTextureDataInteract,
        modelTextureDataInteractAlpha: data.doorModelTextureDataInteractAlpha,
        modelTextureDataInteractLod: data.doorModelTextureDataInteractLod,
        modelTextureDataInteractLodAlpha: data.doorModelTextureDataInteractLodAlpha,

        drawRanges: data.doorDrawRanges,
        drawRangesAlpha: data.doorDrawRangesAlpha,
        drawRangesPlanes: data.doorDrawRangesPlanes,
        drawRangesAlphaPlanes: data.doorDrawRangesAlphaPlanes,
        drawRangesLod: data.doorDrawRangesLod,
        drawRangesLodAlpha: data.doorDrawRangesLodAlpha,
        drawRangesLodPlanes: data.doorDrawRangesLodPlanes,
        drawRangesLodAlphaPlanes: data.doorDrawRangesLodAlphaPlanes,
        drawRangesInteract: data.doorDrawRangesInteract,
        drawRangesInteractAlpha: data.doorDrawRangesInteractAlpha,
        drawRangesInteractPlanes: data.doorDrawRangesInteractPlanes,
        drawRangesInteractAlphaPlanes: data.doorDrawRangesInteractAlphaPlanes,
        drawRangesInteractLod: data.doorDrawRangesInteractLod,
        drawRangesInteractLodAlpha: data.doorDrawRangesInteractLodAlpha,
        drawRangesInteractLodPlanes: data.doorDrawRangesInteractLodPlanes,
        drawRangesInteractLodAlphaPlanes: data.doorDrawRangesInteractLodAlphaPlanes,
    };
}

export class WebGPUStaticDoorResources extends WebGPUStaticLocResources {
    constructor(
        device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
        data: SdMapData,
    ) {
        super(
            device,
            bindGroupLayout,
            data.mapX,
            data.mapY,
            createWebGPUStaticDoorGeometryData(data),
            data.heightMapSize,
            data.heightMapTextureData,
        );
    }
}
