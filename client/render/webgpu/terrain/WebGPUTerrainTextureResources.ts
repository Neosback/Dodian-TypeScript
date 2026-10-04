import {
    WEBGPU_TEXTURE_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUDeviceLike,
    type WebGPUTextureLike,
} from "../../backend/WebGPUPlatform";
import { MATERIAL_TEXTURE_ROWS, TEXTURE_SIZE } from "../../render/constants";

export interface WebGPUTerrainTextureSet {
    layerCount: number;
    idToLayer: ReadonlyMap<number, number>;
    frameCounts: ReadonlyMap<number, number>;
    materialData: Int8Array;
    initialTextures?: ReadonlyMap<number, Int32Array>;
}

export interface WebGPUTextureAtlasLayout {
    columns: number;
    rows: number;
    width: number;
    height: number;
}

export function computeWebGPUTextureAtlasLayout(
    layerCount: number,
    textureSize: number = TEXTURE_SIZE,
): WebGPUTextureAtlasLayout {
    const safeLayers = Math.max(1, layerCount | 0);
    const columns = Math.max(1, Math.ceil(Math.sqrt(safeLayers)));
    const rows = Math.max(1, Math.ceil(safeLayers / columns));
    return {
        columns,
        rows,
        width: columns * textureSize,
        height: rows * textureSize,
    };
}

function alignMaterialWidth(layerCount: number): number {
    // rgba8sint = 4 bytes/texel. 64 texels => 256-byte rows, satisfying
    // conservative WebGPU texture-copy row alignment.
    return Math.max(64, Math.ceil(Math.max(1, layerCount) / 64) * 64);
}

function copyMaterialRows(
    source: Int8Array,
    sourceWidth: number,
    destinationWidth: number,
): Int8Array {
    const expected = sourceWidth * MATERIAL_TEXTURE_ROWS * 4;
    if (source.length < expected) {
        throw new Error(
            `Material table too small: expected at least ${expected} bytes, got ${source.length}`,
        );
    }

    const output = new Int8Array(destinationWidth * MATERIAL_TEXTURE_ROWS * 4);
    const sourceRowBytes = sourceWidth * 4;
    const destinationRowBytes = destinationWidth * 4;
    for (let row = 0; row < MATERIAL_TEXTURE_ROWS; row++) {
        output.set(
            source.subarray(row * sourceRowBytes, (row + 1) * sourceRowBytes),
            row * destinationRowBytes,
        );
    }
    return output;
}

export class WebGPUTerrainTextureResources {
    readonly atlasLayout: WebGPUTextureAtlasLayout;
    readonly textureAtlas: WebGPUTextureLike;
    readonly materialTexture: WebGPUTextureLike;
    readonly bindGroup: WebGPUBindGroupLike;

    private readonly loadedTextureIds = new Set<number>();

    constructor(
        private readonly device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
        readonly textureSet: WebGPUTerrainTextureSet,
    ) {
        const layerCount = Math.max(1, textureSet.layerCount | 0);
        this.atlasLayout = computeWebGPUTextureAtlasLayout(layerCount);

        this.textureAtlas = device.createTexture({
            label: "terrain-texture-atlas",
            size: {
                width: this.atlasLayout.width,
                height: this.atlasLayout.height,
                depthOrArrayLayers: 1,
            },
            format: "rgba8unorm",
            usage: WEBGPU_TEXTURE_USAGE.COPY_DST | WEBGPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });

        // Match WebGL2's missing-texture behavior: every unstreamed texture is
        // white rather than black. The temporary CPU allocation is startup-only.
        const whiteAtlas = new Uint8Array(
            this.atlasLayout.width * this.atlasLayout.height * 4,
        );
        whiteAtlas.fill(0xff);
        device.queue.writeTexture(
            { texture: this.textureAtlas },
            whiteAtlas,
            {
                bytesPerRow: this.atlasLayout.width * 4,
                rowsPerImage: this.atlasLayout.height,
            },
            {
                width: this.atlasLayout.width,
                height: this.atlasLayout.height,
                depthOrArrayLayers: 1,
            },
        );

        const materialWidth = alignMaterialWidth(layerCount);
        const paddedMaterialData = copyMaterialRows(
            textureSet.materialData,
            layerCount,
            materialWidth,
        );
        this.materialTexture = device.createTexture({
            label: "terrain-material-table",
            size: {
                width: materialWidth,
                height: MATERIAL_TEXTURE_ROWS,
                depthOrArrayLayers: 1,
            },
            format: "rgba8sint",
            usage: WEBGPU_TEXTURE_USAGE.COPY_DST | WEBGPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        device.queue.writeTexture(
            { texture: this.materialTexture },
            new Uint8Array(
                paddedMaterialData.buffer,
                paddedMaterialData.byteOffset,
                paddedMaterialData.byteLength,
            ),
            {
                bytesPerRow: materialWidth * 4,
                rowsPerImage: MATERIAL_TEXTURE_ROWS,
            },
            {
                width: materialWidth,
                height: MATERIAL_TEXTURE_ROWS,
                depthOrArrayLayers: 1,
            },
        );

        this.bindGroup = device.createBindGroup({
            label: "terrain-texture-bind-group",
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.textureAtlas.createView(),
                },
                {
                    binding: 1,
                    resource: this.materialTexture.createView(),
                },
            ],
        });

        if (textureSet.initialTextures) {
            this.updateTextures(textureSet.initialTextures);
        }
    }

    static createFallback(
        device: WebGPUDeviceLike,
        bindGroupLayout: WebGPUBindGroupLayoutLike,
    ): WebGPUTerrainTextureResources {
        const materialData = new Int8Array(MATERIAL_TEXTURE_ROWS * 4);
        materialData[3] = 1;
        return new WebGPUTerrainTextureResources(device, bindGroupLayout, {
            layerCount: 1,
            idToLayer: new Map(),
            frameCounts: new Map(),
            materialData,
        });
    }

    isLoaded(textureId: number): boolean {
        return this.loadedTextureIds.has(textureId);
    }

    updateTextures(textures: ReadonlyMap<number, Int32Array>): number {
        let uploaded = 0;
        for (const [textureId, pixels] of textures) {
            if (this.loadedTextureIds.has(textureId)) {
                continue;
            }
            if (this.uploadTexture(textureId, pixels)) {
                uploaded++;
            }
        }
        return uploaded;
    }

    uploadTexture(textureId: number, pixels: Int32Array, frame: number = 0): boolean {
        const baseLayer = this.textureSet.idToLayer.get(textureId) ?? 0;
        if (baseLayer <= 0) {
            return false;
        }

        const frameCount = Math.max(1, this.textureSet.frameCounts.get(textureId) ?? 1);
        if (frame < 0 || frame >= frameCount) {
            return false;
        }

        const expectedPixels = TEXTURE_SIZE * TEXTURE_SIZE;
        if (pixels.length !== expectedPixels) {
            throw new Error(
                `Texture ${textureId} has ${pixels.length} pixels, expected ${expectedPixels}`,
            );
        }

        const layer = baseLayer + frame;
        const column = layer % this.atlasLayout.columns;
        const row = Math.floor(layer / this.atlasLayout.columns);
        if (row >= this.atlasLayout.rows) {
            return false;
        }

        this.device.queue.writeTexture(
            {
                texture: this.textureAtlas,
                origin: {
                    x: column * TEXTURE_SIZE,
                    y: row * TEXTURE_SIZE,
                    z: 0,
                },
            },
            new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
            {
                bytesPerRow: TEXTURE_SIZE * 4,
                rowsPerImage: TEXTURE_SIZE,
            },
            {
                width: TEXTURE_SIZE,
                height: TEXTURE_SIZE,
                depthOrArrayLayers: 1,
            },
        );

        if (frame === 0) {
            this.loadedTextureIds.add(textureId);
        }
        return true;
    }

    dispose(): void {
        this.textureAtlas.destroy?.();
        this.materialTexture.destroy?.();
        this.loadedTextureIds.clear();
    }
}
