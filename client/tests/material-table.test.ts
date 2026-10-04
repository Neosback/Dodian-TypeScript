import assert from "node:assert/strict";

import { buildMaterialTable } from "../render/texture/MaterialTable";

const table = buildMaterialTable({
    textureIds: [10, 20],
    layerCount: 3,
    idToLayer: new Map([
        [10, 1],
        [20, 2],
    ]),
    frameCounts: new Map([
        [10, 1],
        [20, 1],
    ]),
    getMaterial(textureId) {
        return textureId === 10
            ? {
                  animU: -2,
                  animV: 3,
                  alphaCutOff: 0.5,
                  frameCount: 1,
                  animSpeed: 4,
              }
            : {
                  animU: 0,
                  animV: 0,
                  alphaCutOff: 0,
                  frameCount: 1,
                  animSpeed: 1,
              };
    },
    waterTextureIds: new Set([20]),
    getWaterMaterialParams() {
        return {
            surfaceColor: [0.2, 0.4, 0.6],
            foamColor: [0.7, 0.8, 0.9],
            depthColor: [0.1, 0.2, 0.3],
            baseOpacity: 0.5,
            fresnelAmount: 0.85,
            normalStrength: 0.1,
            specularStrength: 0.5,
            specularGloss: 250,
            duration: 2,
            hasFoam: true,
            useNormalMap2: false,
        };
    },
});

const width = 3;
const row = (y: number, layer: number) => (y * width + layer) * 4;

assert.equal(table[3], 1, "fallback layer must advertise one frame");
assert.equal(table[row(0, 1)], -2);
assert.equal(table[row(0, 1) + 1], 3);
assert.equal(table[row(0, 1) + 2] & 0xff, 128);
assert.equal(table[row(0, 1) + 3] & 0xff, 1);
assert.equal(table[row(1, 1)] & 0xff, 4);
assert.equal(table[row(1, 2) + 1] & 0xff, 1, "water material flag");
assert.equal(table[row(1, 2) + 2] & 0xff, 1, "water foam flag");
assert.equal(table[row(2, 2)] & 0xff, 51);
assert.equal(table[row(2, 2) + 1] & 0xff, 102);
assert.equal(table[row(2, 2) + 2] & 0xff, 153);

console.log("shared terrain material-table checks passed");
