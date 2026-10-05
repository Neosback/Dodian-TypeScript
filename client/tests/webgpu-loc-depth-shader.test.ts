import assert from "node:assert/strict";

import {
    OBJECT_GROUND_PULL,
    PLANE_DEPTH_BIAS,
    ROOF_DEPTH_PULL,
    WALL_BEHIND_PUSH,
    WALL_DECORATION_PULL,
} from "../render/loc/LocDepthOrdering";
import { patchWebGPUStaticSceneShaderForWorldEntities } from "../render/webgpu/WebGPUStaticSceneShaderPatch";
import { WEBGPU_TERRAIN_SHADER } from "../render/webgpu/terrain/WebGPUTerrainShader";

const patched = patchWebGPUStaticSceneShaderForWorldEntities(WEBGPU_TERRAIN_SHADER);

// The runtime shader patch must carry the same constants as the CPU reference.
for (const [name, value] of [
    ["LOC_OBJECT_GROUND_PULL", OBJECT_GROUND_PULL],
    ["LOC_WALL_DECORATION_PULL", WALL_DECORATION_PULL],
    ["LOC_WALL_BEHIND_PUSH", WALL_BEHIND_PUSH],
    ["LOC_ROOF_DEPTH_PULL", ROOF_DEPTH_PULL],
    ["LOC_PLANE_DEPTH_BIAS", PLANE_DEPTH_BIAS],
] as const) {
    assert.match(
        patched,
        new RegExp(`const ${name}: f32 = ${String(value).replaceAll(".", "\\.")};`),
        `${name} must match the CPU ordering reference`,
    );
}

assert.match(patched, /fn locCardinalEdgeMask\(/);
assert.match(patched, /fn locCameraOutsideCardinalEdge\(/);
assert.match(patched, /fn locPrimaryDiagonalDecorationFacingCamera\(/);
assert.match(patched, /fn locPlacementPartVisible\(/);
assert.match(patched, /fn locBaseCameraPullTiles\(/);
assert.match(patched, /fn locCameraPullTiles\(/);

// Placement metadata is encoded in the upper 16 bits of info.w. Zero remains
// the legacy/no-placement sentinel and therefore keeps the temporary model bias.
assert.match(patched, /let placementEncoded = info\.w >> 16u;/);
assert.match(patched, /let placementMetadata = placementEncoded - 1u;/);
assert.match(patched, /if \(placementEncoded != 0u\)/);
assert.match(patched, /Legacy packets and non-loc geometry do not carry placement metadata/);

// The old ad-hoc plane offset is replaced in both terrain and loc paths.
assert.equal(patched.includes("viewPos.z += map.plane * 0.001;"), false);
assert.equal(patched.includes("viewPos.z += f32(plane) * 0.001;"), false);
assert.equal(
    patched.split("LOC_PLANE_DEPTH_BIAS").length - 1 >= 3,
    true,
    "plane bias constant must be used by terrain and loc ordering",
);

// Types 6..8 must be camera-selected instead of drawing every stored part.
assert.match(
    patched,
    /LOC_TYPE_WALL_DECORATION_DIAGONAL_OUTSIDE/,
);
assert.match(
    patched,
    /LOC_TYPE_WALL_DECORATION_DIAGONAL_INSIDE/,
);
assert.match(
    patched,
    /LOC_TYPE_WALL_DECORATION_DIAGONAL_DOUBLE/,
);
assert.match(
    patched,
    /if \(!locPlacementPartVisible\(placementMetadata, locCenterTiles, scene\.cameraPos\)\)/,
);
assert.match(patched, /output\.position = vec4<f32>\(2\.0, 2\.0, 2\.0, 1\.0\);/);

// Wall types 1/3 stay explicitly outside the cardinal approximation until the
// delayed-wall 16/32/64/128 painter path is implemented.
assert.match(patched, /Types 1\/3 use the software client's separate diagonal/);

// Existing world-entity transform behavior remains composed with the new rules.
assert.equal(
    patched.split(
        "var viewPos = map.worldEntityTransform * (scene.viewMatrix * vec4<f32>(worldPos, 1.0));",
    ).length - 1,
    2,
);

// The temporary face-priority bias is intentionally still present. Full 0..11
// ordering is the next checkpoint rather than being silently approximated here.
assert.match(patched, /let facePriority = \(input\.packed\.z >> 6u\) & 0x7u;/);
assert.match(patched, /viewPos\.z \+= f32\(facePriority\) \* 0\.001;/);

assert.throws(
    () =>
        patchWebGPUStaticSceneShaderForWorldEntities(
            WEBGPU_TERRAIN_SHADER.replace(
                "viewPos.z += f32(plane) * 0.001;",
                "viewPos.z += f32(plane) * 0.002;",
            ),
        ),
    /loc depth-ordering contract changed/,
);

console.log("webgpu loc wall/decor depth shader contract checks passed");
