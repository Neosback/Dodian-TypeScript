import {
    WEBGPU_TEXTURE_USAGE,
    type WebGPUDeviceLike,
    type WebGPUTextureLike,
} from "../../backend/WebGPUPlatform";

export const WEBGPU_WATER_MASK_LAYERS = 4;

export interface PackedTextureRows {
    data: Uint8Array;
    bytesPerRow: number;
    rowsPerImage: number;
}

export function packRgbaTextureRowsForWebGPU(
    source: Uint8Array,
    width: number,
    height: number,
    layers: number,
): PackedTextureRows {
    const safeWidth = Math.max(1, width | 0);
    const safeHeight = Math.max(1, height | 0);
    const safeLayers = Math.max(1, layers | 0);
    const sourceBytesPerRow = safeWidth * 4;
    const expectedBytes = sourceBytesPerRow * safeHeight * safeLayers;
    if (source.byteLength !== expectedBytes) {
        throw new Error(
            `RGBA texture data must contain ${expectedBytes} bytes, got ${source.byteLength}`,
        );
    }

    const bytesPerRow = Math.ceil(sourceBytesPerRow / 256) * 256;
    if (bytesPerRow === sourceBytesPerRow) {
        return {
            data: source,
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
                source.subarray(sourceOffset, sourceOffset + sourceBytesPerRow),
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

export class WebGPUWaterMaskResources {
    readonly texture: WebGPUTextureLike;

    constructor(
        device: WebGPUDeviceLike,
        readonly size: number,
        data: Uint8Array,
    ) {
        const safeSize = Math.max(1, size | 0);
        const packed = packRgbaTextureRowsForWebGPU(
            data,
            safeSize,
            safeSize,
            WEBGPU_WATER_MASK_LAYERS,
        );

        this.texture = device.createTexture({
            label: "terrain-water-mask",
            size: {
                width: safeSize,
                height: safeSize,
                depthOrArrayLayers: WEBGPU_WATER_MASK_LAYERS,
            },
            dimension: "2d",
            format: "rgba8unorm",
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
                depthOrArrayLayers: WEBGPU_WATER_MASK_LAYERS,
            },
        );
    }

    dispose(): void {
        this.texture.destroy?.();
    }
}
