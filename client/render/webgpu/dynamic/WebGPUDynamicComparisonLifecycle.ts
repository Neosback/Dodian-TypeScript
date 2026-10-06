import type { Renderer } from "../../../game/render/Renderer";
import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type {
    WebGPURenderPassEncoderLike,
    WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import { registerWebGPUOpaqueActorPhase } from "../actor/WebGPUOpaqueActorPhase";
import { registerWebGPUTransparentActorPhase } from "../actor/WebGPUTransparentActorPhase";
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
    registryBacked: boolean;
    opaqueOrder: readonly string[];
    transparentOrder: readonly string[];
    installSteps: readonly string[];
}

type SceneBoundary = (
    this: WebGPUStaticSceneRenderer,
    pass: WebGPURenderPassEncoderLike,
    frame: SceneFrameDescription,
    terrainPipeline: WebGPURenderPipelineLike,
    locPipeline: WebGPURenderPipelineLike,
) => void;

type DisposeBoundary = (this: WebGPUStaticSceneRenderer) => unknown;

interface ExtractedBoundary {
    draw: SceneBoundary;
    dispose?: DisposeBoundary;
}

interface ExtractedLegacyPhases {
    playerOpaque: ExtractedBoundary;
    attachedGfxOpaque: ExtractedBoundary;
    worldGfxOpaque: ExtractedBoundary;
    projectileOpaque: ExtractedBoundary;
    npcAttachedGfxAlpha: ExtractedBoundary;
    worldGfxAlpha: ExtractedBoundary;
    playerAlpha: ExtractedBoundary;
    playerAttachedGfxAlpha: ExtractedBoundary;
    projectileAlpha: ExtractedBoundary;
}

const diagnosticsByRenderer = new WeakMap<Renderer, WebGPUDynamicComparisonDiagnostics>();
let extractedLegacyPhases: ExtractedLegacyPhases | undefined;
let legacyPhaseHandlersRegistered = false;

const unusedPipeline = undefined as unknown as WebGPURenderPipelineLike;
const noopSceneBoundary: SceneBoundary = function () {};
const noopDisposeBoundary: DisposeBoundary = function () {};

function comparisonRequested(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location?.search ?? "");
    const value = params.get("webgpuTerrain")?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "compare" || value === "split";
}

/**
 * Legacy comparison modules originally installed nested prototype wrappers. For
 * the cutover, install each wrapper once against a no-op predecessor, capture
 * only that module's delta, then restore the registry-owned prototype method.
 *
 * The captured closure still owns the exact existing runtime/capture semantics,
 * but draw ordering and disposal are now driven exclusively by the registries.
 */
function extractLegacyBoundary(
    method: "drawOpaqueScene" | "drawTransparentScene",
    install: () => void | (() => void),
    captureDispose: boolean,
): { boundary: ExtractedBoundary; restore?: () => void } {
    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const previousScene = proto[method] as SceneBoundary;
    const previousDispose = proto.dispose as DisposeBoundary;
    proto[method] = noopSceneBoundary;
    if (captureDispose) proto.dispose = noopDisposeBoundary;

    let restore: (() => void) | undefined;
    try {
        const result = install();
        if (typeof result === "function") restore = result;
        const draw = proto[method] as SceneBoundary;
        const dispose = captureDispose ? (proto.dispose as DisposeBoundary) : undefined;
        return {
            boundary: {
                draw: draw === noopSceneBoundary ? noopSceneBoundary : draw,
                dispose:
                    captureDispose && dispose !== noopDisposeBoundary ? dispose : undefined,
            },
            restore,
        };
    } finally {
        proto[method] = previousScene;
        if (captureDispose) proto.dispose = previousDispose;
    }
}

function invokeBoundary(
    boundary: ExtractedBoundary,
    renderer: WebGPUStaticSceneRenderer,
    pass: WebGPURenderPassEncoderLike,
    frame: SceneFrameDescription,
): void {
    boundary.draw.call(renderer, pass, frame, unusedPipeline, unusedPipeline);
}

function disposeBoundary(
    boundary: ExtractedBoundary,
    renderer: WebGPUStaticSceneRenderer,
): void {
    boundary.dispose?.call(renderer);
}

function registerExtractedLegacyPhases(phases: ExtractedLegacyPhases): void {
    if (legacyPhaseHandlersRegistered) return;
    legacyPhaseHandlersRegistered = true;

    registerWebGPUOpaqueActorPhase({
        id: "player",
        order: 20,
        draw: (renderer, pass, frame) => invokeBoundary(phases.playerOpaque, renderer, pass, frame),
        dispose: (renderer) => disposeBoundary(phases.playerOpaque, renderer),
    });
    registerWebGPUOpaqueActorPhase({
        id: "attached-gfx",
        order: 30,
        draw: (renderer, pass, frame) =>
            invokeBoundary(phases.attachedGfxOpaque, renderer, pass, frame),
        dispose: (renderer) => disposeBoundary(phases.attachedGfxOpaque, renderer),
    });
    registerWebGPUOpaqueActorPhase({
        id: "world-gfx",
        order: 40,
        draw: (renderer, pass, frame) => invokeBoundary(phases.worldGfxOpaque, renderer, pass, frame),
        dispose: (renderer) => disposeBoundary(phases.worldGfxOpaque, renderer),
    });
    registerWebGPUOpaqueActorPhase({
        id: "projectile",
        order: 50,
        draw: (renderer, pass, frame) => invokeBoundary(phases.projectileOpaque, renderer, pass, frame),
        dispose: (renderer) => disposeBoundary(phases.projectileOpaque, renderer),
    });

    registerWebGPUTransparentActorPhase({
        id: "npc-attached-gfx",
        order: 20,
        draw: (renderer, pass, frame) =>
            invokeBoundary(phases.npcAttachedGfxAlpha, renderer, pass, frame),
    });
    registerWebGPUTransparentActorPhase({
        id: "world-gfx",
        order: 30,
        draw: (renderer, pass, frame) => invokeBoundary(phases.worldGfxAlpha, renderer, pass, frame),
    });
    registerWebGPUTransparentActorPhase({
        id: "player",
        order: 40,
        draw: (renderer, pass, frame) => invokeBoundary(phases.playerAlpha, renderer, pass, frame),
        dispose: (renderer) => disposeBoundary(phases.playerAlpha, renderer),
    });
    registerWebGPUTransparentActorPhase({
        id: "player-attached-gfx",
        order: 50,
        draw: (renderer, pass, frame) =>
            invokeBoundary(phases.playerAttachedGfxAlpha, renderer, pass, frame),
    });
    registerWebGPUTransparentActorPhase({
        id: "projectile",
        order: 60,
        draw: (renderer, pass, frame) => invokeBoundary(phases.projectileAlpha, renderer, pass, frame),
    });
}

function installFirstRendererAndExtractPhases(
    renderer: Renderer,
    restore: Array<() => void>,
    installSteps: string[],
): ExtractedLegacyPhases {
    // NPCs already use the registries natively and establish each registry's
    // prototype owner before legacy boundaries are extracted.
    restore.push(installWebGPUNpcOpaqueComparison(renderer));
    installSteps.push("npc-opaque");

    const playerOpaque = extractLegacyBoundary(
        "drawOpaqueScene",
        () => installWebGPUPlayerOpaqueComparison(renderer),
        true,
    );
    if (playerOpaque.restore) restore.push(playerOpaque.restore);
    installSteps.push("player-opaque");

    const attachedGfxOpaque = extractLegacyBoundary(
        "drawOpaqueScene",
        () => installWebGPUAttachedGfxComparison(renderer),
        true,
    );
    if (attachedGfxOpaque.restore) restore.push(attachedGfxOpaque.restore);
    installSteps.push("attached-gfx-opaque");

    const worldGfxOpaque = extractLegacyBoundary(
        "drawOpaqueScene",
        () => installWebGPUWorldGfxComparison(renderer),
        true,
    );
    if (worldGfxOpaque.restore) restore.push(worldGfxOpaque.restore);
    installSteps.push("world-gfx-opaque");

    const projectileOpaque = extractLegacyBoundary(
        "drawOpaqueScene",
        () => installWebGPUProjectileComparison(renderer),
        true,
    );
    if (projectileOpaque.restore) restore.push(projectileOpaque.restore);
    installSteps.push("projectile-opaque");

    restore.push(installWebGPUPlayerOpaqueCaptureBoundary(renderer));
    installSteps.push("player-capture-boundary");

    restore.push(installWebGPUNpcAlphaComparison(renderer));
    installSteps.push("npc-alpha");

    const npcAttachedGfxAlpha = extractLegacyBoundary(
        "drawTransparentScene",
        () => installWebGPUNpcAttachedGfxAlphaBoundary(),
        false,
    );
    installSteps.push("npc-attached-gfx-alpha");

    const worldGfxAlpha = extractLegacyBoundary(
        "drawTransparentScene",
        () => installWebGPUWorldGfxAlphaBoundary(),
        false,
    );
    installSteps.push("world-gfx-alpha");

    const playerAlpha = extractLegacyBoundary(
        "drawTransparentScene",
        () => installWebGPUPlayerAlphaComparison(renderer),
        true,
    );
    if (playerAlpha.restore) restore.push(playerAlpha.restore);
    installSteps.push("player-alpha");

    const playerAttachedGfxAlpha = extractLegacyBoundary(
        "drawTransparentScene",
        () => installWebGPUPlayerAttachedGfxAlphaBoundary(),
        false,
    );
    installSteps.push("player-attached-gfx-alpha");

    const projectileAlpha = extractLegacyBoundary(
        "drawTransparentScene",
        () => installWebGPUProjectileAlphaBoundary(),
        false,
    );
    installSteps.push("projectile-alpha");

    return {
        playerOpaque: playerOpaque.boundary,
        attachedGfxOpaque: attachedGfxOpaque.boundary,
        worldGfxOpaque: worldGfxOpaque.boundary,
        projectileOpaque: projectileOpaque.boundary,
        npcAttachedGfxAlpha: npcAttachedGfxAlpha.boundary,
        worldGfxAlpha: worldGfxAlpha.boundary,
        playerAlpha: playerAlpha.boundary,
        playerAttachedGfxAlpha: playerAttachedGfxAlpha.boundary,
        projectileAlpha: projectileAlpha.boundary,
    };
}

function installAdditionalRendererState(
    renderer: Renderer,
    restore: Array<() => void>,
    installSteps: string[],
): void {
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
    restore.push(installWebGPUPlayerOpaqueCaptureBoundary(renderer));
    installSteps.push("player-capture-boundary");
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
}

/**
 * Install all dynamic WebGPU A/B comparison hooks from one authoritative place.
 * Capture hooks remain in their original modules, while all GPU phase execution
 * is now owned by the opaque/transparent registries.
 */
export function installWebGPUDynamicComparisons(renderer: Renderer): () => void {
    if (!comparisonRequested()) {
        diagnosticsByRenderer.delete(renderer);
        return () => {};
    }

    const restore: Array<() => void> = [];
    const installSteps: string[] = [];

    installWebGPUPlayerOpaquePassBoundaryGuard();
    installSteps.push("player-pass-boundary-guard");

    if (!extractedLegacyPhases) {
        extractedLegacyPhases = installFirstRendererAndExtractPhases(
            renderer,
            restore,
            installSteps,
        );
        registerExtractedLegacyPhases(extractedLegacyPhases);
    } else {
        installAdditionalRendererState(renderer, restore, installSteps);
    }

    diagnosticsByRenderer.set(renderer, {
        installed: true,
        registryBacked: true,
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
