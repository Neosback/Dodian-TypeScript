import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    PROJECTILE_WEBGL_RECORD_BYTES,
    PROJECTILE_WEBGL_RECORD_WORDS,
    decodeProjectileWebGLRecord,
    quantizeProjectilePitchForWebGL,
    quantizeProjectileRollForWebGL,
    type ProjectileRenderInstance,
} from "../render/projectiles/ProjectileRenderData";
import {
    WEBGPU_PROJECTILE_ALPHA_PIPELINE_STATE,
    WEBGPU_PROJECTILE_INSTANCE_STRIDE_BYTES,
    WEBGPU_PROJECTILE_OPAQUE_PIPELINE_STATE,
    packWebGPUProjectileInstanceData,
} from "../render/webgpu/projectile/WebGPUProjectileComparison";
import { WEBGPU_PROJECTILE_SHADER } from "../render/webgpu/projectile/WebGPUProjectileShader";

assert.equal(PROJECTILE_WEBGL_RECORD_WORDS, 8);
assert.equal(PROJECTILE_WEBGL_RECORD_BYTES, 16);
assert.equal(WEBGPU_PROJECTILE_INSTANCE_STRIDE_BYTES, 48);

// Legacy projectile packing: signed local coordinates, 2-bit plane, full yaw,
// 7-bit pitch at 16-unit precision, 3-bit roll at 256-unit precision.
const words = new Uint16Array(8);
words[0] = 0xff80; // -128
words[1] = 0x0123;
const plane = 2;
const yaw = 1537;
const pitch = 0x5b0;
const roll = 0x600;
const projectileId = 0x145;
const pitchShifted = (pitch >> 4) & 0x7f;
const pitchHi = (pitchShifted >> 4) & 0x7;
const pitchLo = pitchShifted & 0xf;
const rollShifted = (roll >> 8) & 0x7;
words[2] = (plane | (yaw << 2) | (pitchHi << 13)) & 0xffff;
words[3] = (projectileId | (pitchLo << 9) | (rollShifted << 13)) & 0xffff;
const decoded = decodeProjectileWebGLRecord(words, 0);
assert.equal(decoded.localX, -128);
assert.equal(decoded.localY, 0x123);
assert.equal(decoded.plane, plane);
assert.equal(decoded.yaw, yaw);
assert.equal(decoded.pitch, pitch);
assert.equal(decoded.roll, roll);
assert.equal(decoded.packedProjectileId, projectileId);
assert.equal(quantizeProjectilePitchForWebGL(0x5bf), 0x5b0);
assert.equal(quantizeProjectileRollForWebGL(0x6ff), 0x600);
assert.throws(() => decodeProjectileWebGLRecord(words, 1), RangeError);

const instance: ProjectileRenderInstance = {
    projectileId: 1234,
    debugId: 77,
    frameId: 4,
    sourceMapId: 0x3210,
    transform: {
        localX: 100.25,
        localY: -50.5,
        plane: 2,
        yaw: 900,
        pitch: 512,
        roll: 256,
        subOffsetX: 0.25,
        subOffsetY: 0.75,
        modelYOffset: -384,
    },
};
const packed = packWebGPUProjectileInstanceData(instance);
assert.equal(packed.byteLength, WEBGPU_PROJECTILE_INSTANCE_STRIDE_BYTES);
assert.deepEqual(Array.from(packed), [
    100.25,
    -50.5,
    2,
    900,
    512,
    256,
    0.25,
    0.75,
    -384,
    1234,
    77,
    0,
]);

assert.equal(WEBGPU_PROJECTILE_OPAQUE_PIPELINE_STATE.depthWriteEnabled, true);
assert.equal(WEBGPU_PROJECTILE_OPAQUE_PIPELINE_STATE.depthCompare, "less-equal");
assert.equal(WEBGPU_PROJECTILE_ALPHA_PIPELINE_STATE.depthWriteEnabled, false);
assert.equal(WEBGPU_PROJECTILE_ALPHA_PIPELINE_STATE.depthCompare, "less-equal");
assert.deepEqual(WEBGPU_PROJECTILE_ALPHA_PIPELINE_STATE.blend.color, {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
});

assert.match(WEBGPU_PROJECTILE_SHADER, /fn vsProjectile/);
assert.match(WEBGPU_PROJECTILE_SHADER, /fn fsGfxOpaque/);
assert.match(WEBGPU_PROJECTILE_SHADER, /fn fsGfxAlpha/);
const projectileVertex = WEBGPU_PROJECTILE_SHADER.slice(
    WEBGPU_PROJECTILE_SHADER.indexOf("fn vsProjectile"),
);
const rollIndex = projectileVertex.indexOf("let rollAngle");
const pitchIndex = projectileVertex.indexOf("let pitchAngle");
const yawIndex = projectileVertex.indexOf("let yawAngle");
assert.ok(rollIndex >= 0 && pitchIndex > rollIndex && yawIndex > pitchIndex);
assert.match(projectileVertex, /projectileTransform\.xy \+ input\.projectileRotation\.zw/);
assert.match(projectileVertex, /localPos\.y -= getGfxHeightInterp\(tilePos, plane\)/);
assert.match(projectileVertex, /localPos\.y -= input\.projectileMisc\.x/);
assert.match(projectileVertex, /scene\.viewMatrix \* vec4<f32>\(worldPos, 1\.0\)/);
assert.doesNotMatch(projectileVertex, /worldTransform/);
assert.doesNotMatch(projectileVertex, /viewPos\.z \+= f32\(plane\) \* 0\.01/);
assert.doesNotMatch(projectileVertex, /depthLayerClip/);

const comparisonSource = readFileSync(
    new URL("../render/webgpu/projectile/WebGPUProjectileComparison.ts", import.meta.url),
    "utf8",
);
assert.match(comparisonSource, /decodeProjectileWebGLRecord\(host\.actorRenderData/);
assert.match(comparisonSource, /Array\.from\(manager\.getProjectilesForMap/);
assert.match(comparisonSource, /resolveFrameIndex/);
assert.match(comparisonSource, /resolveModelYOffset/);
assert.match(comparisonSource, /const start = pass === "alpha" \? count - 1 : 0/);
assert.match(comparisonSource, /const step = pass === "alpha" \? -1 : 1/);
assert.match(comparisonSource, /frame\.cullBackFace/);
assert.match(comparisonSource, /projectile-alpha-cull-pipeline/);
assert.match(comparisonSource, /projectile-alpha-no-cull-pipeline/);

const rendererSource = readFileSync(
    new URL("../render/projectiles/ProjectileRenderer.ts", import.meta.url),
    "utf8",
);
assert.match(rendererSource, /if \(transparent\) app\.depthMask\(false\)/);
assert.match(rendererSource, /if \(transparent\) app\.depthMask\(true\)/);
assert.match(rendererSource, /u_projectileSubOffset/);
assert.match(rendererSource, /resolveModelYOffset/);

const canvasSource = readFileSync(new URL("../ui/Canvas.tsx", import.meta.url), "utf8");
const attachedOpaque = canvasSource.indexOf("installWebGPUAttachedGfxComparison(renderer)");
const worldOpaque = canvasSource.indexOf("installWebGPUWorldGfxComparison(renderer)");
const projectileOpaque = canvasSource.indexOf("installWebGPUProjectileComparison(renderer)");
assert.ok(attachedOpaque >= 0 && worldOpaque > attachedOpaque && projectileOpaque > worldOpaque);
const playerAlpha = canvasSource.indexOf("installWebGPUPlayerAlphaComparison(renderer)");
const playerGfxAlpha = canvasSource.indexOf("installWebGPUPlayerAttachedGfxAlphaBoundary()");
const projectileAlpha = canvasSource.indexOf("installWebGPUProjectileAlphaBoundary()");
assert.ok(playerAlpha >= 0 && playerGfxAlpha > playerAlpha && projectileAlpha > playerGfxAlpha);

console.log("WebGPU projectile foundation contract checks passed");
