import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WEBGPU_NPC_ALPHA_PIPELINE_STATE } from "../render/webgpu/npc/WebGPUNpcAlphaComparison";
import { WEBGPU_NPC_ALPHA_SHADER } from "../render/webgpu/npc/WebGPUNpcAlphaShader";

assert.equal(WEBGPU_NPC_ALPHA_PIPELINE_STATE.depthWriteEnabled, true);
assert.equal(WEBGPU_NPC_ALPHA_PIPELINE_STATE.depthCompare, "less-equal");
assert.deepEqual(WEBGPU_NPC_ALPHA_PIPELINE_STATE.blend.color, {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
});
assert.deepEqual(WEBGPU_NPC_ALPHA_PIPELINE_STATE.blend.alpha, {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
});

// Alpha must share the opaque NPC vertex path, including map load fade,
// height contouring, actor/scene HSL overrides, priority depth and the
// per-instance world-entity transform.
assert.match(WEBGPU_NPC_ALPHA_SHADER, /fn vsNpcOpaque/);
assert.match(WEBGPU_NPC_ALPHA_SHADER, /fn getNpcHeightInterp/);
assert.match(WEBGPU_NPC_ALPHA_SHADER, /map\.loadTime/);
assert.match(
    WEBGPU_NPC_ALPHA_SHADER,
    /worldTransform \* \(scene\.viewMatrix \* vec4<f32>\(worldPos, 1\.0\)\)/,
);
assert.match(WEBGPU_NPC_ALPHA_SHADER, /PRIORITY_LAYER_EPSILON: f32 = 0\.015/);
assert.match(WEBGPU_NPC_ALPHA_SHADER, /fn fsNpcAlpha/);

const alphaStart = WEBGPU_NPC_ALPHA_SHADER.indexOf("fn fsNpcAlpha");
assert.ok(alphaStart >= 0);
const alphaSource = WEBGPU_NPC_ALPHA_SHADER.slice(alphaStart);
const baseSampleIndex = alphaSource.indexOf(
    "var textureColor = sampleTextureAtlas(input.textureId, input.texCoord);",
);
const discardIndex = alphaSource.indexOf("discard;");
const animatedFrameIndex = alphaSource.indexOf("material.frameCount > 1");
assert.ok(baseSampleIndex >= 0);
assert.ok(discardIndex > baseSampleIndex);
assert.ok(animatedFrameIndex > discardIndex);
assert.match(alphaSource, /\(input\.textureId == 0u && baseAlpha < 0\.01\)/);
assert.match(alphaSource, /textureColor\.a < input\.alphaCutOff/);

const comparisonSource = readFileSync(
    new URL("../render/webgpu/npc/WebGPUNpcAlphaComparison.ts", import.meta.url),
    "utf8",
);
const phaseSource = readFileSync(
    new URL("../render/webgpu/actor/WebGPUTransparentActorPhase.ts", import.meta.url),
    "utf8",
);
const canvasSource = readFileSync(new URL("../ui/Canvas.tsx", import.meta.url), "utf8");

// Preserve authoritative transparent ordering. WebGL walks visible maps in
// reverse, then appends the unbatched dynamic NPC list. WebGPU keeps a
// sequential draw list instead of rebatching alpha NPCs across that order.
assert.match(
    comparisonSource,
    /for \(let i = host\.mapManager\.visibleMapCount - 1; i >= 0; i--\)/,
);
assert.match(comparisonSource, /for \(const entry of host\.unbatchedNpcRenderEntries\)/);
assert.match(comparisonSource, /for \(const draw of state\.draws\)/);
assert.doesNotMatch(comparisonSource, /createDynamicActorBatches/);
assert.match(comparisonSource, /pass\.drawIndexed\(geometry\.indexCount, 1, 0, 0, 0\)/);

// NPC alpha uses both cull variants because transparent NPCs inherit the
// scene cullBackFace setting, unlike the deliberately double-sided player
// transparent pass.
assert.match(comparisonSource, /createPipeline\("npc-alpha-cull-pipeline", "back"\)/);
assert.match(comparisonSource, /createPipeline\("npc-alpha-no-cull-pipeline", "none"\)/);
assert.match(
    comparisonSource,
    /const pipeline = frame\.cullBackFace \? this\.cullPipeline : this\.noCullPipeline/,
);

// The current pose comes from the existing DynamicNpcAnimLoader and the exact
// authoritative actor record. WebGPU must not introduce an RGBA16UI actor
// texture dependency or a second animation clock.
assert.match(comparisonSource, /dynamicNpcAnimLoader/);
assert.match(comparisonSource, /getFrameGeometry\(/);
assert.match(comparisonSource, /getBaseGeometry\(/);
assert.match(comparisonSource, /decodeDynamicActorWebGLRecord\(/);
assert.match(comparisonSource, /sourceGeometry\.alphaVertices/);
assert.match(comparisonSource, /sourceGeometry\.alphaIndices/);
assert.match(comparisonSource, /worldEntityAnimator\?\.getTransform/);
assert.match(comparisonSource, /getWorldEntityDeckHeight/);
assert.doesNotMatch(WEBGPU_NPC_ALPHA_SHADER, /u_npcDataTexture/);

// The transparent phase always runs after static transparency. NPC alpha is
// installed before the existing player-alpha wrapper, giving static -> NPC ->
// player without pulling GFX/projectiles into this checkpoint.
assert.match(
    phaseSource,
    /originalDrawTransparentScene\.call\(this, pass, frame, terrainPipeline, locPipeline\);/,
);
const npcInstallIndex = canvasSource.indexOf("installWebGPUNpcAlphaComparison(renderer)");
const playerInstallIndex = canvasSource.indexOf("installWebGPUPlayerAlphaComparison(renderer)");
assert.ok(npcInstallIndex >= 0);
assert.ok(playerInstallIndex > npcInstallIndex);
assert.doesNotMatch(comparisonSource, /gfxRenderer\.renderMapPass/);
assert.doesNotMatch(comparisonSource, /projectileRenderer/);

console.log("WebGPU NPC alpha foundation contract checks passed");
