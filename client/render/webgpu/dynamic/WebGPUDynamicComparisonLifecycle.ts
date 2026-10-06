import type { Renderer } from "../../../game/render/Renderer";
import {
    installWebGPUAttachedGfxComparison,
    installWebGPUNpcAttachedGfxAlphaBoundary,
    installWebGPUPlayerAttachedGfxAlphaBoundary,
} from "../gfx/WebGPUAttachedGfxComparison";
import {
    installWebGPUWorldGfxAlphaBoundary,
    installWebGPUWorldGfxComparison,
} from "../gfx/WebGPUWorldGfxComparison";
import { installWebGPUNpcAlphaComparison } from "../npc/WebGPUNpcAlphaComparison";
import { installWebGPUNpcOpaqueComparison } from "../npc/WebGPUNpcOpaqueComparison";
import { installWebGPUPlayerAlphaComparison } from "../player/WebGPUPlayerAlphaComparison";
import { installWebGPUPlayerOpaqueCaptureBoundary } from "../player/WebGPUPlayerOpaqueCaptureBoundary";
import { installWebGPUPlayerOpaqueComparison } from "../player/WebGPUPlayerOpaqueComparison";
import { installWebGPUPlayerOpaquePassBoundaryGuard } from "../player/WebGPUPlayerOpaquePassBoundary";
import {
    installWebGPUProjectileAlphaBoundary,
    installWebGPUProjectileComparison,
} from "../projectile/WebGPUProjectileComparison";

export const WEBGPU_DYNAMIC_OPAQUE_PHASE_ORDER = [
    "npc",
    "player",
    "attached-gfx",
    "world-gfx",
    "projectile",
] as const;

export const WEBGPU_DYNAMIC_TRANSPARENT_PHASE_ORDER = [
    "npc",
    "npc-attached-gfx",
    "world-gfx",
    "player",
    "player-attached-gfx",
    "projectile",
] as const;

export type WebGPUDynamicComparisonPhase =
    | (typeof WEBGPU_DYNAMIC_OPAQUE_PHASE_ORDER)[number]
    | (typeof WEBGPU_DYNAMIC_TRANSPARENT_PHASE_ORDER)[number];

export interface WebGPUDynamicComparisonDiagnostics {
    installed: boolean;
    opaqueOrder: readonly string[];
    transparentOrder: readonly string[];
    installSteps: readonly string[];
}

const diagnosticsByRenderer = new WeakMap<Renderer, WebGPUDynamicComparisonDiagnostics>();

/**
 * Install all dynamic WebGPU A/B comparison hooks from one authoritative place.
 *
 * The individual comparison modules still own their capture/runtime semantics,
 * but Canvas no longer encodes ordering through a scattered sequence of imports
 * and prototype-boundary calls. Keep this list synchronized with the WebGL frame
 * order whenever a new dynamic category is migrated.
 */
export function installWebGPUDynamicComparisons(renderer: Renderer): () => void {
    const restore: Array<() => void> = [];
    const installSteps: string[] = [];

    installWebGPUPlayerOpaquePassBoundaryGuard();
    installSteps.push("player-pass-boundary-guard");

    // Opaque: static -> NPC -> player -> attached GFX -> world GFX -> projectile.
    restore.push(installWebGPUNpcOpaqueComparison(renderer));
    installSteps.push("npc-opaque");
    restore.push(installWebGPUPlayerOpaqueComparison(renderer));
    installSteps.push("player-opaque");
    restore.push(installWebGPUAttachedGfxComparison(renderer));
    installSteps.push("attached-gfx-opaque");
    restore.push(installWebGPUWorldGfxComparison(renderer));
    installSteps.push("world-gfx-opaque");
    restore.push(installWebGPUProjectileComparison(renderer));
    installSteps.push("projectile-opaque");

    // Capture must remain after the authoritative WebGL player opaque map pass.
    restore.push(installWebGPUPlayerOpaqueCaptureBoundary(renderer));
    installSteps.push("player-capture-boundary");

    // Transparent: static -> NPC -> NPC GFX -> world GFX -> player -> player GFX -> projectile.
    restore.push(installWebGPUNpcAlphaComparison(renderer));
    installSteps.push("npc-alpha");
    installWebGPUNpcAttachedGfxAlphaBoundary();
    installSteps.push("npc-attached-gfx-alpha");
    installWebGPUWorldGfxAlphaBoundary();
    installSteps.push("world-gfx-alpha");
    restore.push(installWebGPUPlayerAlphaComparison(renderer));
    installSteps.push("player-alpha");
    installWebGPUPlayerAttachedGfxAlphaBoundary();
    installSteps.push("player-attached-gfx-alpha");
    installWebGPUProjectileAlphaBoundary();
    installSteps.push("projectile-alpha");

    diagnosticsByRenderer.set(renderer, {
        installed: true,
        opaqueOrder: WEBGPU_DYNAMIC_OPAQUE_PHASE_ORDER,
        transparentOrder: WEBGPU_DYNAMIC_TRANSPARENT_PHASE_ORDER,
        installSteps,
    });

    return () => {
        for (let i = restore.length - 1; i >= 0; i--) restore[i]?.();
        diagnosticsByRenderer.delete(renderer);
    };
}

export function getWebGPUDynamicComparisonDiagnostics(
    renderer: Renderer,
): WebGPUDynamicComparisonDiagnostics | undefined {
    return diagnosticsByRenderer.get(renderer);
}
