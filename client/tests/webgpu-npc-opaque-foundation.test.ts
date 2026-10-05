import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WEBGPU_NPC_OPAQUE_SHADER } from "../render/webgpu/npc/WebGPUNpcOpaqueShader";

const npcComparisonSource = readFileSync(
    new URL("../render/webgpu/npc/WebGPUNpcOpaqueComparison.ts", import.meta.url),
    "utf8",
);
const canvasSource = readFileSync(new URL("../ui/Canvas.tsx", import.meta.url), "utf8");
const phaseSource = readFileSync(
    new URL("../render/webgpu/actor/WebGPUOpaqueActorPhase.ts", import.meta.url),
    "utf8",
);

assert.match(WEBGPU_NPC_OPAQUE_SHADER, /fn vsNpcOpaque/);
assert.match(WEBGPU_NPC_OPAQUE_SHADER, /fn fsNpcOpaque/);
assert.match(WEBGPU_NPC_OPAQUE_SHADER, /map\.loadTime/);
assert.match(WEBGPU_NPC_OPAQUE_SHADER, /getNpcHeightInterp/);
assert.match(
    WEBGPU_NPC_OPAQUE_SHADER,
    /worldTransform \* \(scene\.viewMatrix \* vec4<f32>\(worldPos, 1\.0\)\)/,
);
assert.match(WEBGPU_NPC_OPAQUE_SHADER, /const PRIORITY_LAYER_EPSILON: f32 = 0\.015/);
assert.match(WEBGPU_NPC_OPAQUE_SHADER, /const TOP_PRIORITY_EXTRA_BIAS: f32 = 0\.01/);
assert.match(WEBGPU_NPC_OPAQUE_SHADER, /applyHslOverride\(rawHsl, actorHslOverride\)/);

// Comparison capture must convert the authoritative actor record to the neutral
// instance ABI instead of sampling the WebGL actor texture in WGSL.
assert.match(npcComparisonSource, /decodeDynamicActorWebGLRecord/);
assert.match(npcComparisonSource, /DynamicActorInstance/);
assert.doesNotMatch(WEBGPU_NPC_OPAQUE_SHADER, /npcDataTexture/);

// Both current sequence poses and base/unanimated NPCs are covered by the CPU
// DynamicNpcAnimLoader rather than a second GPU animation clock.
assert.match(npcComparisonSource, /loader\.getFrameGeometry/);
assert.match(npcComparisonSource, /loader\.getBaseGeometry/);
assert.match(npcComparisonSource, /sourceGeometry\.opaqueVertices/);
assert.match(npcComparisonSource, /sourceGeometry\.opaqueIndices/);

// Preserve NPC-specific transform semantics and world-entity routing.
assert.match(npcComparisonSource, /worldViewId = ecs\.getWorldViewId\(ecsId\)/);
assert.match(npcComparisonSource, /getWorldEntityDeckHeight\(0, 0\)/);
assert.match(npcComparisonSource, /modelYOffset: -host\.getNpcModelYOffset\(deckHeight\)/);
assert.match(npcComparisonSource, /worldEntityAnimator\?\.getTransform\(worldViewId\)/);

// Preserve culling/depth behavior and the authoritative unbatched NPC path.
assert.match(npcComparisonSource, /depthWriteEnabled: true/);
assert.match(npcComparisonSource, /depthCompare: "less-equal"/);
assert.match(npcComparisonSource, /frame\.cullBackFace \? this\.cullPipeline : this\.noCullPipeline/);
assert.match(npcComparisonSource, /host\.unbatchedNpcRenderEntries/);
assert.match(npcComparisonSource, /host\.resolveUnbatchedNpcGeometry/);

// The ordered phase must run handlers after opaque static rendering.
const staticDrawIndex = phaseSource.indexOf("originalDrawOpaqueScene.call");
const actorLoopIndex = phaseSource.indexOf("for (const handler of sortedHandlers())");
assert.ok(staticDrawIndex >= 0);
assert.ok(actorLoopIndex > staticDrawIndex);
assert.match(npcComparisonSource, /WEBGPU_NPC_OPAQUE_PHASE_ORDER = 10/);

// NPC installs before the existing player opaque wrapper. This makes the
// effective order static scene -> ordered NPC phase -> player wrapper.
const npcInstallIndex = canvasSource.indexOf("installWebGPUNpcOpaqueComparison(renderer)");
const playerInstallIndex = canvasSource.indexOf("installWebGPUPlayerOpaqueComparison(renderer)");
assert.ok(npcInstallIndex >= 0);
assert.ok(playerInstallIndex > npcInstallIndex);

console.log("WebGPU opaque NPC foundation contract checks passed");
