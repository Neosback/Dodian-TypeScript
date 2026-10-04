import assert from "node:assert/strict";

import { WEBGPU_TERRAIN_SHADER } from "../render/webgpu/terrain/WebGPUTerrainShader";
import {
    createWebGPUMapUniformData,
    WEBGPU_MAP_UNIFORM_FLOATS,
    WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET,
} from "../render/webgpu/terrain/WebGPUTerrainMapResources";
import { patchWebGPUStaticSceneShaderForWorldEntities } from "../render/webgpu/WebGPUStaticSceneShaderPatch";

const patched = patchWebGPUStaticSceneShaderForWorldEntities(WEBGPU_TERRAIN_SHADER);

assert.match(patched, /worldEntityTransform: mat4x4<f32>/);
assert.equal(
    patched.split(
        "var viewPos = map.worldEntityTransform * (scene.viewMatrix * vec4<f32>(worldPos, 1.0));",
    ).length - 1,
    2,
    "terrain and loc vertex paths must both apply the map transform",
);
assert.equal(
    patched.includes("var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);"),
    false,
);

const uniform = createWebGPUMapUniformData(12, 34, 2, 5.5, 6);
assert.equal(uniform.length, WEBGPU_MAP_UNIFORM_FLOATS);
assert.equal(WEBGPU_MAP_UNIFORM_FLOATS, 24);
assert.equal(WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET, 8);
assert.deepEqual(Array.from(uniform.slice(0, 5)), [12, 34, 2, 5.5, 6]);
assert.deepEqual(
    Array.from(
        uniform.slice(
            WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET,
            WEBGPU_MAP_UNIFORM_TRANSFORM_FLOAT_OFFSET + 16,
        ),
    ),
    [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ],
);

assert.throws(
    () => patchWebGPUStaticSceneShaderForWorldEntities("@vertex fn main() {}"),
    /MapUniforms contract changed/,
);

console.log("webgpu world-entity transform checks passed");
