import {
    WEBGPU_TEXTURE_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUDeviceLike,
    type WebGPUSamplerLike,
    type WebGPUTextureLike,
} from "../../backend/WebGPUPlatform";
import { WATER_TEXTURE_SIZE } from "../../render/constants";

export const WEBGPU_WATER_TEXTURE_LAYERS = 5;

export function createFallbackWaterTextureData(): Uint8Array {
    const layerBytes = WATER_TEXTURE_SIZE * WATER_TEXTURE_SIZE * 4;
    const data = new Uint8Array(layerBytes * WEBGPU_WATER_TEXTURE_LAYERS);

    // Normal maps: neutral XY, fully-positive Z.
    for (const layer of [0, 1]) {
        const base = layer * layerBytes;
        for (let i = 0; i < layerBytes; i += 4) {
            data[base + i] = 128;
            data[base + i + 1] = 128;
            data[base + i + 2] = 255;
            data[base + i + 3] = 255;
        }
    }

    // Flow map: neutral displacement.
    const flowBase = 2 * layerBytes;
    for (let i = 0; i < layerBytes; i += 4) {
        data[flowBase + i] = 128;
        data[flowBase + i + 1] = 128;
        data[flowBase + i + 2] = 0;
        data[flowBase + i + 3] = 255;
    }

    // Foam and caustics fallback to white, producing stable, visible water
    // rather than undefined/black texture data.
    data.fill(255, 3 * layerBytes);
    return data;
}

export class WebGPUWaterResources {
    readonly texture: WebGPUTextureLike;
    readonly sampler: WebGPUSamplerLike;
    readonly bindGroup: WebGPUBindGroupLike;

    constructor(
        private readonly device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
        data: Uint8Array,
    ) {
        const layerBytes = WATER_TEXTURE_SIZE * WATER_TEXTURE_SIZE * 4;
        const expectedBytes = layerBytes * WEBGPU_WATER_TEXTURE_LAYERS;
        if (data.byteLength !== expectedBytes) {
            throw new Error(
                `Water texture data must contain ${expectedBytes} bytes, got ${data.byteLength}`,
            );
        }

        this.texture = device.createTexture({
            label: "water-aux-textures",
            size: {
                width: WATER_TEXTURE_SIZE,
                height: WATER_TEXTURE_SIZE,
                depthOrArrayLayers: WEBGPU_WATER_TEXTURE_LAYERS,
            },
            dimension: "2d",
            format: "rgba8unorm",
            usage: WEBGPU_TEXTURE_USAGE.COPY_DST | WEBGPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        device.queue.writeTexture(
            { texture: this.texture },
            data,
            {
                bytesPerRow: WATER_TEXTURE_SIZE * 4,
                rowsPerImage: WATER_TEXTURE_SIZE,
            },
            {
                width: WATER_TEXTURE_SIZE,
                height: WATER_TEXTURE_SIZE,
                depthOrArrayLayers: WEBGPU_WATER_TEXTURE_LAYERS,
            },
        );

        this.sampler = device.createSampler({
            label: "water-aux-sampler",
            addressModeU: "repeat",
            addressModeV: "repeat",
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
        });

        this.bindGroup = device.createBindGroup({
            label: "water-aux-bind-group",
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: this.sampler },
                {
                    binding: 1,
                    resource: this.texture.createView({
                        dimension: "2d-array",
                        baseArrayLayer: 0,
                        arrayLayerCount: WEBGPU_WATER_TEXTURE_LAYERS,
                    }),
                },
            ],
        });
    }

    static createFallback(
        device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
    ): WebGPUWaterResources {
        return new WebGPUWaterResources(
            device,
            bindGroupLayout,
            createFallbackWaterTextureData(),
        );
    }

    dispose(): void {
        this.texture.destroy?.();
    }
}
