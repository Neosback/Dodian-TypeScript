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

export class WebGPUHeightMapResources {
    readonly texture: WebGPUTextureLike;

    constructor(
        device: WebGPUDeviceLike,
        readonly size: number,
        data: Int16Array,
    ) {
        const safeSize = Math.max(1, size | 0);
        const packed = packR16TextureRowsForWebGPU(
            data,
            safeSize,
            safeSize,
            WEBGPU_HEIGHT_MAP_LAYERS,
        );

        this.texture = device.createTexture({
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
            { texture: this.texture },
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
    }

    dispose(): void {
        this.texture.destroy?.();
    }
}
