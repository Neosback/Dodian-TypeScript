import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WEBGPU_GFX_SHADER } from "../render/webgpu/gfx/WebGPUGfxShader";
import {
    orderWebGPUWorldGfxEntriesLikeWebGL,
    packWebGPUWorldGfxInstanceData,
} from "../render/webgpu/gfx/WebGPUWorldGfxComparison";

const packed = packWebGPUWorldGfxInstanceData({
    localX: -64,
    localY: 8256,
    plane: 2,
    rotation: 0,
    modelYOffset: -128,
    interactionId: 0,
    colorOverride: { hue: 0, saturation: 0, luminance: 0, amount: 0 },
});
assert.equal(packed.length, 28);
assert.deepEqual(Array.from(packed.slice(0, 12)), [
    -64,
    8256,
    2,
    0,
    0,
    0,
    0,
    0,
    -128,
    0,
    -1,
    0,
]);
assert.deepEqual(Array.from(packed.slice(12, 28)), [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

const makeWorldInst = (
    id: number,
    spotId: number,
    frame: number,
    yOffsetTiles: number | undefined = undefined,
) => ({
    id,
    spotId,
    anchor: yOffsetTiles === undefined ? ("ground" as const) : ("offset" as const),
    yOffsetTiles,
    loop: true,
    startCycle: 0,
    startTimeMs: 1,
    lastSoundFrame: frame,
    world: { tileX: 3200, tileY: 3200, level: 0, mapId: 1, slot: id - 1 },
});

const ordered = orderWebGPUWorldGfxEntriesLikeWebGL([
    { inst: makeWorldInst(1, 10, 2), slot: 0, yOffsetUnits: 0 },
    { inst: makeWorldInst(2, 11, 1), slot: 1, yOffsetUnits: 0 },
    { inst: makeWorldInst(3, 10, 2, 1), slot: 2, yOffsetUnits: 128 },
    { inst: makeWorldInst(4, 10, 2), slot: 3, yOffsetUnits: 0 },
]);
assert.deepEqual(
    ordered.map((entry) => entry.inst.id),
    [1, 4, 3, 2],
);

// World GFX use the dedicated NPC-derived spot shader. It must preserve NPC
// pre-projection plane/priority semantics while intentionally omitting load fade.
assert.match(WEBGPU_GFX_SHADER, /fn vsGfx/);
assert.match(WEBGPU_GFX_SHADER, /fn fsGfxOpaque/);
assert.match(WEBGPU_GFX_SHADER, /fn fsGfxAlpha/);
assert.match(WEBGPU_GFX_SHADER, /viewPos\.z \+= f32\(plane\) \* 0\.01/);
assert.match(WEBGPU_GFX_SHADER, /viewPos\.z \+= layer \* PRIORITY_LAYER_EPSILON/);
assert.doesNotMatch(WEBGPU_GFX_SHADER, /depthLayerClip/);
assert.doesNotMatch(WEBGPU_GFX_SHADER, /map\.loadTime/);

const worldSource = readFileSync(
    new URL("../render/webgpu/gfx/WebGPUWorldGfxComparison.ts", import.meta.url),
    "utf8",
);
const drawSource = readFileSync(
    new URL("../render/render/draw.ts", import.meta.url),
    "utf8",
);
const gfxRendererSource = readFileSync(
    new URL("../render/gfx/GfxRenderer.ts", import.meta.url),
    "utf8",
);
const canvasSource = readFileSync(new URL("../ui/Canvas.tsx", import.meta.url), "utf8");

// The authoritative WebGL record is populated at the world tile center and with
// bridge-aware render-plane resolution. WebGPU decodes that record rather than
// recomputing a second placement policy.
assert.match(drawSource, /const worldX = \(world\.tileX \| 0\) \* 128 \+ 64/);
assert.match(drawSource, /const worldY = \(world\.tileY \| 0\) \* 128 \+ 64/);
assert.match(drawSource, /resolveHeightSamplePlaneForLocal/);
assert.match(drawSource, /map\.worldGfxDataTextureOffsets\[sampleIdx\] = baseOffset/);
assert.match(worldSource, /worldGfxDataTextureOffsets\?\.\[0\]/);
assert.match(worldSource, /getWorldInstancesForMap\(map\)/);
assert.match(worldSource, /decodeDynamicActorWebGLRecord/);
assert.match(worldSource, /localX: decoded\.localX/);
assert.match(worldSource, /localY: decoded\.localY/);
assert.match(worldSource, /plane: decoded\.plane/);
assert.match(worldSource, /modelYOffset: -entry\.yOffsetUnits/);

// G2 deliberately does not invent a DynamicActorIdentity for a world effect.
assert.doesNotMatch(worldSource, /kind: "player"/);
assert.doesNotMatch(worldSource, /kind: "npc"/);
assert.match(worldSource, /World-tile GFX are not actors\/world-view entities/);

// The exact frame still comes from the authoritative GfxRenderer selection.
assert.match(worldSource, /typeof inst\.lastSoundFrame !== "number"/);
assert.match(worldSource, /const spotFrame = inst\.lastSoundFrame \| 0/);
assert.match(worldSource, /ensureFrameGeometry/);

// WebGL world GFX are the final GFX attachment class in renderMapPass, and use
// yOffsetTiles with world.heightOffsetTiles as the fallback.
assert.match(gfxRendererSource, /getWorldInstancesForMap\(map\)/);
assert.match(gfxRendererSource, /inst\.yOffsetTiles \?\? inst\.world\?\.heightOffsetTiles \?\? 0/);
assert.match(worldSource, /inst\.yOffsetTiles \?\? inst\.world\?\.heightOffsetTiles \?\? 0/);

// Opaque maps traverse front-to-back; alpha maps traverse back-to-front.
assert.match(worldSource, /const start = pass === "alpha" \? count - 1 : 0/);
assert.match(worldSource, /const end = pass === "alpha" \? -1 : count/);
assert.match(worldSource, /const step = pass === "alpha" \? -1 : 1/);

// World GFX reuse the G1 no-cull/depth/blend state and corrected GFX shader.
assert.match(worldSource, /WEBGPU_ATTACHED_GFX_OPAQUE_PIPELINE_STATE/);
assert.match(worldSource, /WEBGPU_ATTACHED_GFX_ALPHA_PIPELINE_STATE/);
assert.match(worldSource, /WEBGPU_GFX_SHADER/);
assert.match(worldSource, /entryPoint: "vsGfx"/);
assert.match(worldSource, /entryPoint: "fsGfxOpaque"/);
assert.match(worldSource, /entryPoint: "fsGfxAlpha"/);

// Projectiles remain outside G2.
assert.doesNotMatch(worldSource, /projectileRenderer/);
assert.doesNotMatch(worldSource, /ProjectileManager/);

// Lock comparison boundary ordering.
const attachedOpaque = canvasSource.indexOf("installWebGPUAttachedGfxComparison(renderer)");
const worldOpaque = canvasSource.indexOf("installWebGPUWorldGfxComparison(renderer)");
assert.ok(attachedOpaque >= 0 && worldOpaque > attachedOpaque);

const npcGfxAlpha = canvasSource.indexOf("installWebGPUNpcAttachedGfxAlphaBoundary()");
const worldGfxAlpha = canvasSource.indexOf("installWebGPUWorldGfxAlphaBoundary()");
const playerAlpha = canvasSource.indexOf("installWebGPUPlayerAlphaComparison(renderer)");
assert.ok(npcGfxAlpha >= 0 && worldGfxAlpha > npcGfxAlpha && playerAlpha > worldGfxAlpha);

console.log("WebGPU world GFX foundation contract checks passed");
