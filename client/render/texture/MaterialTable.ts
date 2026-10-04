import type { TextureMaterial } from "../../rs/texture/TextureMaterial";
import {
    MATERIAL_TEXTURE_ROWS,
    WATER_FLAG_HAS_FOAM,
    WATER_FLAG_NORMAL_MAP_2,
    materialByte,
    type WaterMaterialParams,
} from "../render/constants";

export interface MaterialTableBuildInput {
    textureIds: readonly number[];
    layerCount: number;
    idToLayer: ReadonlyMap<number, number>;
    frameCounts: ReadonlyMap<number, number>;
    getMaterial(textureId: number): TextureMaterial;
    waterTextureIds: ReadonlySet<number>;
    getWaterMaterialParams(textureId: number): WaterMaterialParams;
}

/**
 * Build the compact signed-byte material table shared by WebGL2 and WebGPU.
 *
 * Layout is identical to the existing RGBA8I texture:
 * row 0 = animU, animV, alphaCutOff, frameCount
 * row 1 = animSpeed, material flags, water flags, unused
 * row 2 = water surface RGB, base opacity
 * row 3 = water depth RGB, fresnel amount
 * row 4 = normal strength, specular strength, specular gloss, duration
 * row 5 = water foam RGB, unused
 */
export function buildMaterialTable(input: MaterialTableBuildInput): Int8Array {
    const textureCount = Math.max(1, input.layerCount | 0);
    const data = new Int8Array(textureCount * MATERIAL_TEXTURE_ROWS * 4);
    data[3] = 1;

    for (const id of input.textureIds) {
        try {
            const material = input.getMaterial(id);
            const frameCount = Math.max(
                1,
                input.frameCounts.get(id) ?? material.frameCount ?? 1,
            );
            const baseLayer = input.idToLayer.get(id) ?? 0;

            for (
                let frame = 0;
                frame < frameCount && baseLayer + frame < textureCount;
                frame++
            ) {
                const layerIndex = baseLayer + frame;
                const row0 = layerIndex * 4;
                const row1 = (textureCount + layerIndex) * 4;
                const row2 = (textureCount * 2 + layerIndex) * 4;
                const row3 = (textureCount * 3 + layerIndex) * 4;
                const row4 = (textureCount * 4 + layerIndex) * 4;
                const row5 = (textureCount * 5 + layerIndex) * 4;
                const isWater = input.waterTextureIds.has(id);

                data[row0] = material.animU;
                data[row0 + 1] = material.animV;
                data[row0 + 2] = materialByte(material.alphaCutOff * 255);
                data[row0 + 3] = materialByte(frameCount);

                data[row1] = material.animSpeed;
                data[row1 + 1] = isWater ? 1 : 0;

                if (isWater) {
                    const water = input.getWaterMaterialParams(id);
                    data[row1 + 2] =
                        (water.hasFoam ? WATER_FLAG_HAS_FOAM : 0) |
                        (water.useNormalMap2 ? WATER_FLAG_NORMAL_MAP_2 : 0);

                    data[row2] = materialByte(water.surfaceColor[0] * 255);
                    data[row2 + 1] = materialByte(water.surfaceColor[1] * 255);
                    data[row2 + 2] = materialByte(water.surfaceColor[2] * 255);
                    data[row2 + 3] = materialByte(water.baseOpacity * 255);

                    data[row3] = materialByte(water.depthColor[0] * 255);
                    data[row3 + 1] = materialByte(water.depthColor[1] * 255);
                    data[row3 + 2] = materialByte(water.depthColor[2] * 255);
                    data[row3 + 3] = materialByte(water.fresnelAmount * 255);

                    data[row4] = materialByte((water.normalStrength / 0.5) * 255);
                    data[row4 + 1] = materialByte(water.specularStrength * 255);
                    data[row4 + 2] = materialByte((water.specularGloss / 500) * 255);
                    data[row4 + 3] = materialByte((water.duration / 4) * 255);

                    data[row5] = materialByte(water.foamColor[0] * 255);
                    data[row5 + 1] = materialByte(water.foamColor[1] * 255);
                    data[row5 + 2] = materialByte(water.foamColor[2] * 255);
                }
            }
        } catch (error) {
            console.error("Failed loading texture material", id, error);
        }
    }

    return data;
}
