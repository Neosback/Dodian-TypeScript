import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE,
    WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE,
    orderWebGPUAttachedGfxEntriesLikeWebGL,
} from "../render/webgpu/gfx/WebGPUAttachedGfxComparison";
import { WEBGPU_PLAYER_ALPHA_SHADER } from "../render/webgpu/player/WebGPUPlayerAlphaShader";

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

// Attached GFX intentionally use the no-load-fade player vertex path while
// retaining actor HSL, terrain contouring, material animation, fog and exact
// priority depth. WebGL sets u_timeLoaded=-1 for the same reason.
assert.match(WEBGPU_PLAYER_ALPHA_SHADER, /fn vsPlayerOpaque/);
assert.match(WEBGPU_PLAYER_ALPHA_SHADER, /fn getPlayerHeightInterp/);
assert.match(WEBGPU_PLAYER_ALPHA_SHADER, /fn fsPlayerAlpha/);
assert.doesNotMatch(WEBGPU_PLAYER_ALPHA_SHADER, /map\.loadTime/);
assert.match(WEBGPU_PLAYER_ALPHA_SHADER, /const PRIORITY_LAYER_EPSILON: f32 = 0\.015/);

const alphaStart = WEBGPU_PLAYER_ALPHA_SHADER.indexOf("fn fsPlayerAlpha");
assert.ok(alphaStart >= 0);
const alphaSource = WEBGPU_PLAYER_ALPHA_SHADER.slice(alphaStart);
assert.ok(alphaSource.indexOf("discard;") >= 0);
assert.ok(alphaSource.indexOf("material.frameCount > 1") > alphaSource.indexOf("discard;"));

// WebGL groups GFX by first-seen (spot,frame), then by first-seen Y offset,
// then preserves original instance order within each Y-offset group.
const makeInst = (id: number, spotId: number, frame: number) =>
    ({
        id,
        spotId,
        anchor: "ground",
        loop: false,
        startCycle: 0,
        startTimeMs: 1,
        lastSoundFrame: frame,
    }) as any;
const ordered = orderWebGPUAttachedGfxEntriesLikeWebGL([
    { inst: makeInst(1, 10, 2), actorId: 1, slot: 0, yOffsetUnits: 0 },
    { inst: makeInst(2, 20, 1), actorId: 2, slot: 1, yOffsetUnits: 0 },
    { inst: makeInst(3, 10, 2), actorId: 3, slot: 2, yOffsetUnits: 128 },
    { inst: makeInst(4, 10, 2), actorId: 4, slot: 3, yOffsetUnits: 0 },
]);
assert.deepEqual(
    ordered.map((entry) => entry.actorId),
    [1, 4, 3, 2],
);

const comparisonSource = readFileSync(
    new URL("../render/webgpu/gfx/WebGPUAttachedGfxComparison.ts", import.meta.url),
    "utf8",
);

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
assert.match(comparisonSource, /ensureFrameGeometry\(/);
assert.match(comparisonSource, /orderWebGPUAttachedGfxEntriesLikeWebGL\(entries\)/);

// Parent actor placement is decoded once from the authoritative compatibility
// record and then consumed through the neutral WebGPU instance ABI.
assert.match(comparisonSource, /decodeDynamicActorWebGLRecord/);
assert.match(comparisonSource, /localX: decoded\.localX/);
assert.match(comparisonSource, /localY: decoded\.localY/);
assert.match(comparisonSource, /plane: decoded\.plane/);
assert.match(comparisonSource, /rotation: decoded\.rotation/);
assert.match(comparisonSource, /colorOverride: decoded\.colorOverride/);
assert.match(comparisonSource, /modelYOffset: -entry\.yOffsetUnits/);

// Current WebGL attached-GFX behavior does not apply the parent's world-entity
// transform. Keep that parity explicitly until the authoritative renderer changes.
assert.match(comparisonSource, /packWebGPUPlayerInstanceData\(\[draw\.instance\]\)/);
assert.doesNotMatch(comparisonSource, /worldEntityAnimator\?\.getTransform/);

// G1 is player/NPC-attached effects only. World-tile GFX and projectiles are
// deliberately separate checkpoints.
assert.doesNotMatch(comparisonSource, /getWorldInstancesForMap/);
assert.doesNotMatch(comparisonSource, /projectileRenderer/);
assert.match(comparisonSource, /World-tile GFX intentionally remain out of G1/);

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
