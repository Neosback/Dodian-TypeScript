import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

// Installation order must match the manifest and cleanup must run in reverse.
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

// Phase registries expose current-frame invocation diagnostics and clear them on dispose.
for (const source of [opaquePhaseSource, transparentPhaseSource]) {
    assert.match(source, /invokedHandlers/);
    assert.match(source, /frameToken: frame\.currentTime/);
    assert.match(source, /diagnostics\.set\(this/);
    assert.match(source, /diagnostics\.delete\(this\)/);
}
assert.match(opaquePhaseSource, /getWebGPUOpaqueActorPhaseDiagnostics/);
assert.match(transparentPhaseSource, /getWebGPUTransparentActorPhaseDiagnostics/);

console.log("WebGPU dynamic parity lifecycle checks passed");
