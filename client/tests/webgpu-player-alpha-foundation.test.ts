import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    WEBGPU_PLAYER_ALPHA_PIPELINE_STATE,
} from "../render/webgpu/player/WebGPUPlayerAlphaComparison";
import { WEBGPU_PLAYER_ALPHA_SHADER } from "../render/webgpu/player/WebGPUPlayerAlphaShader";

assert.equal(WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.cullMode, "none");
assert.equal(WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.depthWriteEnabled, true);
assert.equal(WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.depthCompare, "less-equal");
assert.deepEqual(WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.blend.color, {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
});
assert.deepEqual(WEBGPU_PLAYER_ALPHA_PIPELINE_STATE.blend.alpha, {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
});

// Alpha shares the exact opaque player vertex path. Placement, bridge-aware
// height sampling, world-entity transforms, HSL overrides, fog and priority
// depth therefore cannot silently diverge between the two player passes.
assert.match(WEBGPU_PLAYER_ALPHA_SHADER, /fn vsPlayerOpaque/);
assert.match(WEBGPU_PLAYER_ALPHA_SHADER, /fn getPlayerHeightInterp/);
assert.match(
    WEBGPU_PLAYER_ALPHA_SHADER,
    /worldTransform \* \(scene\.viewMatrix \* vec4<f32>\(worldPos, 1\.0\)\)/,
);
assert.match(WEBGPU_PLAYER_ALPHA_SHADER, /fn fsPlayerAlpha/);

const alphaStart = WEBGPU_PLAYER_ALPHA_SHADER.indexOf("fn fsPlayerAlpha");
assert.ok(alphaStart >= 0);
const alphaSource = WEBGPU_PLAYER_ALPHA_SHADER.slice(alphaStart);
const baseSampleIndex = alphaSource.indexOf(
    "var textureColor = sampleTextureAtlas(input.textureId, input.texCoord);",
);
const discardIndex = alphaSource.indexOf("discard;");
const animatedFrameIndex = alphaSource.indexOf("material.frameCount > 1");
assert.ok(baseSampleIndex >= 0);
assert.ok(discardIndex > baseSampleIndex);
assert.ok(animatedFrameIndex > discardIndex);
assert.match(
    alphaSource,
    /\(input\.textureId == 0u && baseAlpha < 0\.01\)/,
);
assert.match(alphaSource, /textureColor\.a < input\.alphaCutOff/);

// Lock the pass ordering and snapshot source at the integration boundary.
// The alpha pass must append after the complete static transparent traversal,
// and it must consume the pose already resolved by renderOpaqueForMap rather
// than running a second animation-selection path.
const comparisonSource = readFileSync(
    new URL("../render/webgpu/player/WebGPUPlayerAlphaComparison.ts", import.meta.url),
    "utf8",
);
const staticTransparentIndex = comparisonSource.indexOf(
    "originalDrawTransparentScene.call(this, pass, frame, terrainPipeline, locPipeline);",
);
const alphaDrawIndex = comparisonSource.indexOf("runtime.draw(pass, frame, host, state);");
assert.ok(staticTransparentIndex >= 0);
assert.ok(alphaDrawIndex > staticTransparentIndex);
assert.match(comparisonSource, /const previous = playerRenderer\.renderOpaqueForMap/);
assert.match(comparisonSource, /capturePlayerAlphaMap\(host, map, state\)/);
assert.doesNotMatch(comparisonSource, /renderTransparentPlayerPass = wrapper/);
assert.match(comparisonSource, /batch\.geometry\.alpha\.vertices/);
assert.match(comparisonSource, /batch\.geometry\.alpha\.indices/);

console.log("WebGPU player alpha foundation contract checks passed");
