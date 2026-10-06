import {
    WEBGPU_TEXTURE_USAGE,
    type WebGPUDeviceLike,
    type WebGPUTextureLike,
} from "../../backend/WebGPUPlatform";

export const WEBGPU_HEIGHT_MAP_LAYERS = 4;

export interface PackedR16TextureRows {
    data: Uint8Array;
    bytesPerRow: number;
    rowsPerImage: number;
}

export interface WebGPUHeightMapSharingDiagnostics {
    allocations: number;
    reuses: number;
    releases: number;
    destroys: number;
}

interface SharedHeightMapBacking {
    texture: WebGPUTextureLike;
    refs: number;
}

const sharedHeightMaps = new WeakMap<
    WebGPUDeviceLike,
    WeakMap<Int16Array, Map<number, SharedHeightMapBacking>>
>();
const sharingDiagnostics = new WeakMap<
    WebGPUDeviceLike,
    WebGPUHeightMapSharingDiagnostics
>();

function diagnosticsFor(device: WebGPUDeviceLike): WebGPUHeightMapSharingDiagnostics {
    let diagnostics = sharingDiagnostics.get(device);
    if (!diagnostics) {
        diagnostics = { allocations: 0, reuses: 0, releases: 0, destroys: 0 };
        sharingDiagnostics.set(device, diagnostics);
    }
    return diagnostics;
}

function sourceCacheFor(
    device: WebGPUDeviceLike,
): WeakMap<Int16Array, Map<number, SharedHeightMapBacking>> {
    let cache = sharedHeightMaps.get(device);
    if (!cache) {
        cache = new WeakMap();
        sharedHeightMaps.set(device, cache);
    }
    return cache;
}

export function getWebGPUHeightMapSharingDiagnostics(
    device: WebGPUDeviceLike,
): WebGPUHeightMapSharingDiagnostics {
    const diagnostics = diagnosticsFor(device);
    return { ...diagnostics };
}

export function packR16TextureRowsForWebGPU(
    source: Int16Array,
    width: number,
    height: number,
    layers: number,
): PackedR16TextureRows {
    const safeWidth = Math.max(1, width | 0);
    const safeHeight = Math.max(1, height | 0);
    const safeLayers = Math.max(1, layers | 0);
    const sourceBytesPerRow = safeWidth * 2;
    const expectedElements = safeWidth * safeHeight * safeLayers;
    if (source.length !== expectedElements) {
        throw new Error(
            `R16 texture data must contain ${expectedElements} elements, got ${source.length}`,
        );
    }

    const bytesPerRow = Math.ceil(sourceBytesPerRow / 256) * 256;
    const sourceBytes = new Uint8Array(
        source.buffer,
        source.byteOffset,
        source.byteLength,
    );
    if (bytesPerRow === sourceBytesPerRow) {
        return {
            data: sourceBytes,
            bytesPerRow,
            rowsPerImage: safeHeight,
        };
    }

    const output = new Uint8Array(bytesPerRow * safeHeight * safeLayers);
    for (let layer = 0; layer < safeLayers; layer++) {
        for (let row = 0; row < safeHeight; row++) {
            const sourceOffset =
                (layer * safeHeight + row) * sourceBytesPerRow;
            const destinationOffset =
                (layer * safeHeight + row) * bytesPerRow;
            output.set(
                sourceBytes.subarray(sourceOffset, sourceOffset + sourceBytesPerRow),
                destinationOffset,
            );
        }
    }

    return {
        data: output,
        bytesPerRow,
        rowsPerImage: safeHeight,
    };
}

function acquireHeightMap(
    device: WebGPUDeviceLike,
    size: number,
    data: Int16Array,
): SharedHeightMapBacking {
    const safeSize = Math.max(1, size | 0);
    const sourceCache = sourceCacheFor(device);
    let sizes = sourceCache.get(data);
    if (!sizes) {
        sizes = new Map();
        sourceCache.set(data, sizes);
    }

    const existing = sizes.get(safeSize);
    if (existing) {
        existing.refs++;
        diagnosticsFor(device).reuses++;
        return existing;
    }

    const packed = packR16TextureRowsForWebGPU(
        data,
        safeSize,
        safeSize,
        WEBGPU_HEIGHT_MAP_LAYERS,
    );
    const texture = device.createTexture({
        label: "scene-height-map",
        size: {
            width: safeSize,
            height: safeSize,
            depthOrArrayLayers: WEBGPU_HEIGHT_MAP_LAYERS,
        },
        dimension: "2d",
        format: "r16sint",
        usage: WEBGPU_TEXTURE_USAGE.COPY_DST | WEBGPU_TEXTURE_USAGE.TEXTURE_BINDING,
    });

    device.queue.writeTexture(
        { texture },
        packed.data,
        {
            bytesPerRow: packed.bytesPerRow,
            rowsPerImage: packed.rowsPerImage,
        },
        {
            width: safeSize,
            height: safeSize,
            depthOrArrayLayers: WEBGPU_HEIGHT_MAP_LAYERS,
        },
    );

    const backing = { texture, refs: 1 };
    sizes.set(safeSize, backing);
    diagnosticsFor(device).allocations++;
    return backing;
}

function releaseHeightMap(
    device: WebGPUDeviceLike,
    size: number,
    data: Int16Array,
    backing: SharedHeightMapBacking,
): void {
    const diagnostics = diagnosticsFor(device);
    diagnostics.releases++;
    backing.refs = Math.max(0, backing.refs - 1);
    if (backing.refs !== 0) return;

    backing.texture.destroy?.();
    diagnostics.destroys++;

    const sourceCache = sharedHeightMaps.get(device);
    const sizes = sourceCache?.get(data);
    if (!sizes) return;
    if (sizes.get(size) === backing) sizes.delete(size);
    if (sizes.size === 0) sourceCache?.delete(data);
}

export class WebGPUHeightMapResources {
    readonly texture: WebGPUTextureLike;
    private readonly backing: SharedHeightMapBacking;
    private disposed = false;

    constructor(
        private readonly device: WebGPUDeviceLike,
        readonly size: number,
        private readonly data: Int16Array,
    ) {
        const safeSize = Math.max(1, size | 0);
        this.size = safeSize;
        this.backing = acquireHeightMap(device, safeSize, data);
        this.texture = this.backing.texture;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        releaseHeightMap(this.device, this.size, this.data, this.backing);
    }
}
