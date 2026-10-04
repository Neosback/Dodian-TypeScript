import type { DrawRange } from "../../DrawRange";
import type { LocGeometryData, SdMapData } from "../../loader/SdMapData";
import { createWebGPUStaticDoorGeometryData } from "./WebGPUStaticDoorResources";

type ModelField =
    | "modelTextureData"
    | "modelTextureDataAlpha"
    | "modelTextureDataLod"
    | "modelTextureDataLodAlpha"
    | "modelTextureDataInteract"
    | "modelTextureDataInteractAlpha"
    | "modelTextureDataInteractLod"
    | "modelTextureDataInteractLodAlpha";

type RangeField =
    | "drawRanges"
    | "drawRangesAlpha"
    | "drawRangesLod"
    | "drawRangesLodAlpha"
    | "drawRangesInteract"
    | "drawRangesInteractAlpha"
    | "drawRangesInteractLod"
    | "drawRangesInteractLodAlpha";

type PlaneField =
    | "drawRangesPlanes"
    | "drawRangesAlphaPlanes"
    | "drawRangesLodPlanes"
    | "drawRangesLodAlphaPlanes"
    | "drawRangesInteractPlanes"
    | "drawRangesInteractAlphaPlanes"
    | "drawRangesInteractLodPlanes"
    | "drawRangesInteractLodAlphaPlanes";

interface PassFields {
    model: ModelField;
    ranges: RangeField;
    planes: PlaneField;
}

const PASS_FIELDS: readonly PassFields[] = [
    { model: "modelTextureData", ranges: "drawRanges", planes: "drawRangesPlanes" },
    {
        model: "modelTextureDataAlpha",
        ranges: "drawRangesAlpha",
        planes: "drawRangesAlphaPlanes",
    },
    { model: "modelTextureDataLod", ranges: "drawRangesLod", planes: "drawRangesLodPlanes" },
    {
        model: "modelTextureDataLodAlpha",
        ranges: "drawRangesLodAlpha",
        planes: "drawRangesLodAlphaPlanes",
    },
    {
        model: "modelTextureDataInteract",
        ranges: "drawRangesInteract",
        planes: "drawRangesInteractPlanes",
    },
    {
        model: "modelTextureDataInteractAlpha",
        ranges: "drawRangesInteractAlpha",
        planes: "drawRangesInteractAlphaPlanes",
    },
    {
        model: "modelTextureDataInteractLod",
        ranges: "drawRangesInteractLod",
        planes: "drawRangesInteractLodPlanes",
    },
    {
        model: "modelTextureDataInteractLodAlpha",
        ranges: "drawRangesInteractLodAlpha",
        planes: "drawRangesInteractLodAlphaPlanes",
    },
];

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    if (a.length === 0) return b.slice();
    if (b.length === 0) return a.slice();
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
}

function concatIndices(a: Int32Array, b: Int32Array, vertexOffset: number): Int32Array {
    if (b.length === 0) return a.slice();
    const result = new Int32Array(a.length + b.length);
    result.set(a, 0);
    for (let i = 0; i < b.length; i++) {
        result[a.length + i] = (b[i] | 0) + vertexOffset;
    }
    return result;
}

function appendRanges(
    a: readonly DrawRange[],
    b: readonly DrawRange[],
    secondIndexByteOffset: number,
): DrawRange[] {
    const result: DrawRange[] = new Array(a.length + b.length);
    for (let i = 0; i < a.length; i++) {
        const range = a[i];
        result[i] = [range[0], range[1], range[2]];
    }
    for (let i = 0; i < b.length; i++) {
        const range = b[i];
        result[a.length + i] = [
            (range[0] | 0) + secondIndexByteOffset,
            range[1],
            range[2],
        ];
    }
    return result;
}

function appendPlanes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
}

function requiredInstanceCount(modelData: Uint16Array, ranges: readonly DrawRange[]): number {
    const drawCount = ranges.length;
    if (drawCount === 0) return 0;
    if (modelData.length < drawCount * 4) {
        throw new Error(
            `Static-scene model data is missing draw headers: expected ${drawCount * 4} words, got ${modelData.length}`,
        );
    }

    let maxInstance = 0;
    for (let i = 0; i < drawCount; i++) {
        const instanceCount = Math.max(1, ranges[i][2] | 0);
        const firstInstance = (modelData[i * 4] | 0) - drawCount;
        if (firstInstance < 0) {
            throw new Error(`Static-scene draw ${i} has invalid first instance ${firstInstance}`);
        }
        maxInstance = Math.max(maxInstance, firstInstance + instanceCount);
    }

    const requiredWords = (drawCount + maxInstance) * 4;
    if (modelData.length < requiredWords) {
        throw new Error(
            `Static-scene model data is truncated: expected ${requiredWords} words, got ${modelData.length}`,
        );
    }
    return maxInstance;
}

function combineModelData(
    aData: Uint16Array,
    aRanges: readonly DrawRange[],
    bData: Uint16Array,
    bRanges: readonly DrawRange[],
): Uint16Array {
    const aDrawCount = aRanges.length;
    const bDrawCount = bRanges.length;
    const drawCount = aDrawCount + bDrawCount;
    if (drawCount === 0) return new Uint16Array(0);

    const aInstanceCount = requiredInstanceCount(aData, aRanges);
    const bInstanceCount = requiredInstanceCount(bData, bRanges);
    const result = new Uint16Array((drawCount + aInstanceCount + bInstanceCount) * 4);

    const copyHeaders = (
        source: Uint16Array,
        sourceDrawCount: number,
        sourceInstanceBase: number,
        destinationDrawBase: number,
    ) => {
        for (let i = 0; i < sourceDrawCount; i++) {
            const sourceHeader = i * 4;
            const destinationHeader = (destinationDrawBase + i) * 4;
            result[destinationHeader] =
                drawCount + sourceInstanceBase + ((source[sourceHeader] | 0) - sourceDrawCount);
            result[destinationHeader + 1] = source[sourceHeader + 1] ?? 0;
            result[destinationHeader + 2] = source[sourceHeader + 2] ?? 0;
            result[destinationHeader + 3] = source[sourceHeader + 3] ?? 0;
        }
    };

    copyHeaders(aData, aDrawCount, 0, 0);
    copyHeaders(bData, bDrawCount, aInstanceCount, aDrawCount);

    if (aInstanceCount > 0) {
        result.set(
            aData.subarray(aDrawCount * 4, (aDrawCount + aInstanceCount) * 4),
            drawCount * 4,
        );
    }
    if (bInstanceCount > 0) {
        result.set(
            bData.subarray(bDrawCount * 4, (bDrawCount + bInstanceCount) * 4),
            (drawCount + aInstanceCount) * 4,
        );
    }

    return result;
}

export function combineStaticSceneGeometry(
    loc: LocGeometryData,
    door: LocGeometryData,
): LocGeometryData {
    const result = {
        vertices: concatBytes(loc.vertices, door.vertices),
        indices: concatIndices(loc.indices, door.indices, loc.vertices.byteLength / 12),
    } as LocGeometryData;

    const secondIndexByteOffset = loc.indices.byteLength;
    for (const fields of PASS_FIELDS) {
        result[fields.ranges] = appendRanges(
            loc[fields.ranges],
            door[fields.ranges],
            secondIndexByteOffset,
        );
        result[fields.planes] = appendPlanes(loc[fields.planes], door[fields.planes]);
        result[fields.model] = combineModelData(
            loc[fields.model],
            loc[fields.ranges],
            door[fields.model],
            door[fields.ranges],
        );
    }

    return result;
}

export function createWebGPUStaticSceneGeometry(data: SdMapData): LocGeometryData {
    return combineStaticSceneGeometry(data.loc, createWebGPUStaticDoorGeometryData(data));
}
