import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE,
    WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE,
    orderWebGPUAttachedGfxEntriesLikeWebGL,
} from "../render/webgpu/gfx/WebGPUAttachedGfxComparison";
import { WEBGPU_GFX_SHADER } from "../render/webgpu/gfx/WebGPUGfxShader";

assert.equal(WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE.cullMode, "none");
assert.equal(WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE.depthWriteEnabled, true);
assert.equal(WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE.depthCompare, "less-equal");

assert.equal(WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.cullMode, "none");
assert.equal(WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.depthWriteEnabled, true);
assert.equal(WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.depthCompare, "less-equal");
assert.deepEqual(WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.blend.color, {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
});
assert.deepEqual(WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE.blend.alpha, {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
});

// WebGL GFX uses npc.vert.glsl, not player.vert.glsl. The dedicated GFX shader
// therefore keeps NPC plane/priority projection semantics while removing only
// NPC map-load fade (WebGL sets u_timeLoaded=-1 for GFX).
assert.match(WEBGPU_GFX_SHADER, /fn vsGfx/);
assert.match(WEBGPU_GFX_SHADER, /fn fsGfxOpaque/);
assert.match(WEBGPU_GFX_SHADER, /fn fsGfxAlpha/);
assert.match(WEBGPU_GFX_SHADER, /getGfxHeightInterp/);
assert.match(WEBGPU_GFX_SHADER, /viewPos\.z \+= f32\(plane\) \* 0\.01/);
assert.match(WEBGPU_GFX_SHADER, /viewPos\.z \+= layer \* PRIORITY_LAYER_EPSILON/);
assert.doesNotMatch(WEBGPU_GFX_SHADER, /depthLayerClip/);
assert.doesNotMatch(WEBGPU_GFX_SHADER, /map\.loadTime/);

const alphaStart = WEBGPU_GFX_SHADER.indexOf("fn fsGfxAlpha");
assert.ok(alphaStart >= 0);
const alphaSource = WEBGPU_GFX_SHADER.slice(alphaStart);
assert.ok(alphaSource.indexOf("discard;") >= 0);
assert.ok(alphaSource.indexOf("material.frameCount > 1") > alphaSource.indexOf("discard;"));

const comparisonSource = readFileSync(
    new URL("../render/webgpu/gfx/WebGPUAttachedGfxComparison.ts", import.meta.url),
    "utf8",
);
assert.match(comparisonSource, /WEBGPU_GFX_SHADER/);
assert.match(comparisonSource, /entryPoint: "vsGfx"/);
assert.match(comparisonSource, /entryPoint: "fsGfxOpaque"/);
assert.match(comparisonSource, /entryPoint: "fsGfxAlpha"/);

// Capture occurs after the authoritative WebGL GFX draw. lastSoundFrame is the
// exact frame selected by GfxRenderer, so WebGPU does not run a second clock.
const previousDrawIndex = comparisonSource.indexOf(
    "const result = previous.call(this, map, actorDataTexture, pass, offsets);",
);
const captureIndex = comparisonSource.indexOf(
    "captureAttachedGfxPass(host, state, map, pass, offsets);",
);
assert.ok(previousDrawIndex >= 0);
assert.ok(captureIndex > previousDrawIndex);
assert.match(comparisonSource, /typeof inst\.lastSoundFrame !== "number"/);
assert.match(comparisonSource, /const spotFrame = inst\.lastSoundFrame \| 0/);
assert.match(comparisonSource, /ensureFrameGeometry/);

// Parent actor placement is decoded once from the authoritative compatibility
// record and then consumed through the neutral WebGPU instance ABI.
assert.match(comparisonSource, /decodeDynamicActorWebGLRecord/);
assert.match(comparisonSource, /localX: decoded\.localX/);
assert.match(comparisonSource, /localY: decoded\.localY/);
assert.match(comparisonSource, /plane: decoded\.plane/);
assert.match(comparisonSource, /rotation: decoded\.rotation/);
assert.match(comparisonSource, /colorOverride: decoded\.colorOverride/);
assert.match(comparisonSource, /modelYOffset: -entry\.yOffsetUnits/);
assert.match(comparisonSource, /packWebGPUPlayerInstanceData\(\[draw\.instance\]\)/);
assert.doesNotMatch(comparisonSource, /worldEntityAnimator\?\.getTransform/);

// G1 stays player/NPC-attached only. World-tile GFX are implemented separately
// in G2, and projectiles remain a separate checkpoint.
assert.doesNotMatch(comparisonSource, /getWorldInstancesForMap/);
assert.doesNotMatch(comparisonSource, /projectileRenderer/);
assert.match(comparisonSource, /World-tile GFX intentionally remain out of G1/);

// Match WebGL grouping: first-seen spot/frame, then first-seen Y offset, then
// source order within that Y-offset group.
const makeInst = (id: number, spotId: number, frame: number) => ({
    id,
    spotId,
    anchor: "ground" as const,
    loop: true,
    startCycle: 0,
    startTimeMs: 1,
    lastSoundFrame: frame,
});
const ordered = orderWebGPUAttachedGfxEntriesLikeWebGL([
    { inst: makeInst(1, 10, 2), actorId: 1, slot: 0, yOffsetUnits: 0 },
    { inst: makeInst(2, 11, 1), actorId: 2, slot: 1, yOffsetUnits: 0 },
    { inst: makeInst(3, 10, 2), actorId: 3, slot: 2, yOffsetUnits: 128 },
    { inst: makeInst(4, 10, 2), actorId: 4, slot: 3, yOffsetUnits: 0 },
]);
assert.deepEqual(
    ordered.map((entry) => entry.inst.id),
    [1, 4, 3, 2],
);

// Texture discovery remains single-source: GfxCache feeds newly encountered
// model textures into updateTextureArray, whose existing hook synchronizes the
// same pixels into the WebGPU terrain/model atlas.
const gfxCacheSource = readFileSync(
    new URL("../render/gfx/GfxCache.ts", import.meta.url),
    "utf8",
);
assert.match(gfxCacheSource, /updateTextureArray\?\.\(toUpload\)/);
const textureArraySource = readFileSync(
    new URL("../render/render/textures/array.ts", import.meta.url),
    "utf8",
);
assert.match(textureArraySource, /syncWebGPUTerrainTextures\(host, textures\)/);

// Lock installation order at the comparison boundary.
const canvasSource = readFileSync(new URL("../ui/Canvas.tsx", import.meta.url), "utf8");
const npcOpaque = canvasSource.indexOf("installWebGPUNpcOpaqueComparison(renderer)");
const playerOpaque = canvasSource.indexOf("installWebGPUPlayerOpaqueComparison(renderer)");
const attachedGfx = canvasSource.indexOf("installWebGPUAttachedGfxComparison(renderer)");
const npcAlpha = canvasSource.indexOf("installWebGPUNpcAlphaComparison(renderer)");
const npcGfxAlpha = canvasSource.indexOf("installWebGPUNpcAttachedGfxAlphaBoundary()");
const playerAlpha = canvasSource.indexOf("installWebGPUPlayerAlphaComparison(renderer)");
const playerGfxAlpha = canvasSource.indexOf("installWebGPUPlayerAttachedGfxAlphaBoundary()");
assert.ok(npcOpaque >= 0 && playerOpaque > npcOpaque && attachedGfx > playerOpaque);
assert.ok(npcAlpha > attachedGfx);
assert.ok(npcGfxAlpha > npcAlpha && playerAlpha > npcGfxAlpha && playerGfxAlpha > playerAlpha);

console.log("WebGPU attached GFX foundation contract checks passed");
