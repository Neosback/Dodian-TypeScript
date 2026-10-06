import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    WebGPUDynamicHeightBindGroupCache,
    WebGPUGrowableBufferCache,
} from "../render/webgpu/dynamic/WebGPUDynamicResourceHelpers";
import {
    addWebGPUDynamicPhaseSample,
    emptyWebGPUDynamicPhaseCounters,
    trackWebGPUDynamicPhaseDrawCalls,
} from "../render/webgpu/dynamic/WebGPUDynamicPhaseDiagnostics";

const lifecycleSource = readFileSync(
    new URL("../render/webgpu/dynamic/WebGPUDynamicComparisonLifecycle.ts", import.meta.url),
    "utf8",
);
const canvasSource = readFileSync(new URL("../ui/Canvas.tsx", import.meta.url), "utf8");
const opaquePhaseSource = readFileSync(
    new URL("../render/webgpu/actor/WebGPUOpaqueActorPhase.ts", import.meta.url),
    "utf8",
);
const transparentPhaseSource = readFileSync(
    new URL("../render/webgpu/actor/WebGPUTransparentActorPhase.ts", import.meta.url),
    "utf8",
);
const playerOpaqueSource = readFileSync(
    new URL("../render/webgpu/player/WebGPUPlayerOpaqueComparison.ts", import.meta.url),
    "utf8",
);
const playerAlphaSource = readFileSync(
    new URL("../render/webgpu/player/WebGPUPlayerAlphaComparison.ts", import.meta.url),
    "utf8",
);

// Canvas must delegate the complete dynamic comparison lifecycle to one installer.
assert.match(canvasSource, /installWebGPUDynamicComparisons/);
assert.doesNotMatch(canvasSource, /installWebGPUNpcOpaqueComparison/);
assert.doesNotMatch(canvasSource, /installWebGPUPlayerOpaqueComparison/);
assert.doesNotMatch(canvasSource, /installWebGPUAttachedGfxComparison/);
assert.doesNotMatch(canvasSource, /installWebGPUWorldGfxComparison/);
assert.doesNotMatch(canvasSource, /installWebGPUProjectileComparison/);

// Normal WebGL startup must not install dynamic comparison prototype boundaries.
assert.match(lifecycleSource, /if \(!comparisonRequested\(\)\)/);
assert.match(lifecycleSource, /return \(\) => \{\};/);

// Canonical opaque order: static is outside this list and always precedes dynamic phases.
const opaqueNpc = lifecycleSource.indexOf('"npc",');
const opaquePlayer = lifecycleSource.indexOf('"player",', opaqueNpc + 1);
const opaqueAttached = lifecycleSource.indexOf('"attached-gfx"');
const opaqueWorld = lifecycleSource.indexOf('"world-gfx"', opaqueAttached + 1);
const opaqueProjectile = lifecycleSource.indexOf('"projectile"', opaqueWorld + 1);
assert.ok(
    opaqueNpc >= 0 &&
        opaquePlayer > opaqueNpc &&
        opaqueAttached > opaquePlayer &&
        opaqueWorld > opaqueAttached &&
        opaqueProjectile > opaqueWorld,
);

// Canonical transparent order mirrors WebGL's actor/effect phase boundaries.
const transparentMarker = lifecycleSource.indexOf("WEBGPU_DYNAMIC_TRANSPARENT_PHASE_ORDER");
const transparentNpc = lifecycleSource.indexOf('"npc",', transparentMarker);
const transparentNpcGfx = lifecycleSource.indexOf('"npc-attached-gfx"', transparentNpc);
const transparentWorld = lifecycleSource.indexOf('"world-gfx"', transparentNpcGfx);
const transparentPlayer = lifecycleSource.indexOf('"player",', transparentWorld);
const transparentPlayerGfx = lifecycleSource.indexOf('"player-attached-gfx"', transparentPlayer);
const transparentProjectile = lifecycleSource.indexOf('"projectile"', transparentPlayerGfx);
assert.ok(
    transparentNpc >= 0 &&
        transparentNpcGfx > transparentNpc &&
        transparentWorld > transparentNpcGfx &&
        transparentPlayer > transparentWorld &&
        transparentPlayerGfx > transparentPlayer &&
        transparentProjectile > transparentPlayerGfx,
);

// Legacy prototype boundaries are extracted against no-op predecessors and the
// registry-owned prototype methods are restored immediately afterward.
assert.match(lifecycleSource, /function extractLegacyBoundary/);
assert.match(lifecycleSource, /proto\[method\] = noopSceneBoundary/);
assert.match(lifecycleSource, /proto\[method\] = previousScene/);
assert.match(lifecycleSource, /if \(captureDispose\) proto\.dispose = previousDispose/);
assert.match(lifecycleSource, /registerExtractedLegacyPhases/);
assert.match(lifecycleSource, /registryBacked: true/);

for (const [id, order] of [
    ["player", 20],
    ["attached-gfx", 30],
    ["world-gfx", 40],
    ["projectile", 50],
] as const) {
    assert.match(
        lifecycleSource,
        new RegExp(`id: "${id}"[\\s\\S]{0,80}order: ${order}`),
    );
}
assert.match(lifecycleSource, /id: "npc-attached-gfx"[\s\S]{0,80}order: 20/);
assert.match(lifecycleSource, /id: "world-gfx"[\s\S]{0,80}order: 30/);
assert.match(lifecycleSource, /id: "player"[\s\S]{0,80}order: 40/);
assert.match(lifecycleSource, /id: "player-attached-gfx"[\s\S]{0,80}order: 50/);
assert.match(lifecycleSource, /id: "projectile"[\s\S]{0,80}order: 60/);

// Installation still establishes capture state in authoritative WebGL order and
// cleanup unwinds per-renderer capture hooks in reverse.
const installNpc = lifecycleSource.indexOf("installWebGPUNpcOpaqueComparison(renderer)");
const installPlayer = lifecycleSource.indexOf("installWebGPUPlayerOpaqueComparison(renderer)");
const installAttached = lifecycleSource.indexOf("installWebGPUAttachedGfxComparison(renderer)");
const installWorld = lifecycleSource.indexOf("installWebGPUWorldGfxComparison(renderer)");
const installProjectile = lifecycleSource.indexOf("installWebGPUProjectileComparison(renderer)");
assert.ok(
    installNpc >= 0 &&
        installPlayer > installNpc &&
        installAttached > installPlayer &&
        installWorld > installAttached &&
        installProjectile > installWorld,
);
assert.match(lifecycleSource, /for \(let i = restore\.length - 1; i >= 0; i--\)/);

// Phase registries expose invocation diagnostics, per-category attempted/drawn/
// skipped counters, draw-call totals, and clear all renderer state on dispose.
for (const source of [opaquePhaseSource, transparentPhaseSource]) {
    assert.match(source, /invokedHandlers/);
    assert.match(source, /frameToken: frame\.currentTime/);
    assert.match(source, /frameCounters/);
    assert.match(source, /totalCounters/);
    assert.match(source, /trackWebGPUDynamicPhaseDrawCalls/);
    assert.match(source, /addWebGPUDynamicPhaseSample/);
    assert.match(source, /diagnostics\.set\(this/);
    assert.match(source, /diagnostics\.delete\(this\)/);
    assert.match(source, /totals\.delete\(this\)/);
}
assert.match(opaquePhaseSource, /getWebGPUOpaqueActorPhaseDiagnostics/);
assert.match(transparentPhaseSource, /getWebGPUTransparentActorPhaseDiagnostics/);

// Player opaque/alpha runtimes must use the shared height/buffer helpers rather
// than maintaining their former local duplicate maps.
for (const source of [playerOpaqueSource, playerAlphaSource]) {
    assert.match(source, /WebGPUDynamicHeightBindGroupCache/);
    assert.match(source, /WebGPUGrowableBufferCache/);
    assert.match(source, /heightCache\?\.dispose\(\)/);
    assert.match(source, /instanceCache\?\.dispose\(\)/);
    assert.doesNotMatch(source, /new Map<number, HeightGpuResources>/);
    assert.doesNotMatch(source, /new Map<string, InstanceGpuResources>/);
}

// The pass tracker counts GPU submissions while preserving ordinary methods.
let setPipelineCalls = 0;
let indexedCalls = 0;
const fakePass = {
    setPipeline() {
        setPipelineCalls++;
    },
    drawIndexed() {
        indexedCalls++;
    },
} as any;
const tracked = trackWebGPUDynamicPhaseDrawCalls(fakePass);
(tracked.pass as any).setPipeline({});
(tracked.pass as any).drawIndexed(3, 1, 0, 0, 0);
(tracked.pass as any).drawIndexed(6, 1, 0, 0, 0);
assert.equal(setPipelineCalls, 1);
assert.equal(indexedCalls, 2);
assert.equal(tracked.getDrawCalls(), 2);

const counters = emptyWebGPUDynamicPhaseCounters();
addWebGPUDynamicPhaseSample(counters, 2);
addWebGPUDynamicPhaseSample(counters, 0);
assert.deepEqual(counters, {
    attempted: 2,
    drawn: 1,
    skipped: 1,
    drawCalls: 2,
});

// Shared growable instance-buffer helper preserves the existing doubling policy
// while exposing allocation/reuse/upload diagnostics.
const createdBuffers: Array<{ size: number; destroyed: boolean }> = [];
let bufferWrites = 0;
let bindGroupAllocations = 0;
let textureAllocations = 0;
let textureDestroys = 0;
const resourceDevice = {
    queue: {
        writeBuffer() {
            bufferWrites++;
        },
        writeTexture() {},
    },
    createBuffer(descriptor: any) {
        const record = { size: descriptor.size as number, destroyed: false };
        createdBuffers.push(record);
        return {
            destroy() {
                record.destroyed = true;
            },
        };
    },
    createTexture() {
        textureAllocations++;
        return {
            createView() {
                return {};
            },
            destroy() {
                textureDestroys++;
            },
        };
    },
    createBindGroup() {
        bindGroupAllocations++;
        return {};
    },
} as any;

const buffers = new WebGPUGrowableBufferCache(resourceDevice, "dynamic-test");
assert.ok(buffers.getOrWrite("actor", new Float32Array(4)));
assert.ok(buffers.getOrWrite("actor", new Float32Array(2)));
assert.ok(buffers.getOrWrite("actor", new Float32Array(10)));
assert.equal(bufferWrites, 3);
assert.deepEqual(createdBuffers.map((entry) => entry.size), [16, 40]);
assert.equal(createdBuffers[0].destroyed, true, "growth retires the old buffer");
assert.deepEqual(buffers.getDiagnostics(), {
    allocations: 2,
    reuses: 1,
    grows: 1,
    writes: 3,
    destroys: 1,
    bytesUploaded: 64,
    liveBuffers: 1,
    liveCapacityBytes: 40,
});
buffers.dispose();
assert.equal(createdBuffers[1].destroyed, true);
assert.equal(buffers.getDiagnostics().liveBuffers, 0);
assert.equal(buffers.getDiagnostics().destroys, 2);

// Height bind-group helper reuses a stable source and replaces only when the
// source identity or size changes. Underlying textures are ref-counted globally.
const heightCache = new WebGPUDynamicHeightBindGroupCache(
    resourceDevice,
    {} as any,
    "dynamic-test",
);
const heightSourceA = new Int16Array(4 * 4 * 4);
const heightSourceB = new Int16Array(4 * 4 * 4);
const heightA1 = heightCache.get(7, heightSourceA, 4);
const heightA2 = heightCache.get(7, heightSourceA, 4);
assert.equal(heightA1, heightA2);
const heightB = heightCache.get(7, heightSourceB, 4);
assert.notEqual(heightA1, heightB);
assert.equal(bindGroupAllocations, 2);
assert.equal(textureAllocations, 2);
assert.equal(textureDestroys, 1, "replacement releases the old unshared height texture");
assert.deepEqual(heightCache.getDiagnostics(), {
    allocations: 2,
    reuses: 1,
    replacements: 1,
    releases: 1,
    liveEntries: 1,
});
heightCache.dispose();
assert.equal(textureDestroys, 2);
assert.equal(heightCache.getDiagnostics().liveEntries, 0);
assert.equal(heightCache.getDiagnostics().releases, 2);

console.log("WebGPU dynamic registry and resource helper checks passed");
