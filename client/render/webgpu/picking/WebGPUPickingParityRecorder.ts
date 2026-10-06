import type { Renderer } from "../../../game/render/Renderer";
import type { SceneRaycastHit } from "../../../game/scene/SceneRaycaster";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import {
    isWebGPUTerrainComparisonRequested,
    requestWebGPUTerrainCombinedPick,
} from "../compare/WebGPUTerrainComparison";
import {
    classifyWebGPUPickingParity,
    snapshotWebGPUCpuPickStack,
    snapshotWebGPUPick,
    type WebGPUPickingParityClassification,
    type WebGPUPickingParityIdentity,
} from "./WebGPUPickingParity";

const MAX_RECENT_PARITY_SAMPLES = 128;

export interface WebGPUPickingParitySample {
    frameCount: number;
    canvasX: number;
    canvasY: number;
    classification: WebGPUPickingParityClassification;
    cpuHitCount: number;
    cpuFront?: WebGPUPickingParityIdentity;
    cpuMatchIndex: number;
    gpu?: WebGPUPickingParityIdentity;
}

export interface WebGPUPickingParityDiagnostics {
    installed: boolean;
    totalSamples: number;
    counts: Record<WebGPUPickingParityClassification, number>;
    recent: readonly WebGPUPickingParitySample[];
}

interface MutableParityDiagnostics {
    installed: boolean;
    totalSamples: number;
    counts: Record<WebGPUPickingParityClassification, number>;
    recent: WebGPUPickingParitySample[];
}

const diagnosticsByRenderer = new WeakMap<Renderer, MutableParityDiagnostics>();

function createCounts(): Record<WebGPUPickingParityClassification, number> {
    return {
        "match-front": 0,
        "match-deeper-cpu-hit": 0,
        "both-miss": 0,
        "cpu-hit-gpu-miss": 0,
        "gpu-hit-cpu-miss": 0,
        "gpu-hit-absent-from-cpu-stack": 0,
    };
}

function comparisonRequested(): boolean {
    if (typeof window === "undefined") return false;
    return isWebGPUTerrainComparisonRequested(window.location?.search ?? "");
}

function resolveInteractionPoint(host: WebGLOsrsRenderer): { x: number; y: number } | undefined {
    const input = host.osrsClient.inputManager;
    const pickX = input.pickX | 0;
    const pickY = input.pickY | 0;
    if (pickX !== -1 && pickY !== -1) {
        return { x: pickX, y: pickY };
    }
    const x = input.getInteractionMouseX() | 0;
    const y = input.getInteractionMouseY() | 0;
    if (x === -1 || y === -1) return undefined;
    return { x, y };
}

function appendSample(
    diagnostics: MutableParityDiagnostics,
    sample: WebGPUPickingParitySample,
): void {
    diagnostics.totalSamples++;
    diagnostics.counts[sample.classification]++;
    diagnostics.recent.push(sample);
    if (diagnostics.recent.length > MAX_RECENT_PARITY_SAMPLES) {
        diagnostics.recent.splice(0, diagnostics.recent.length - MAX_RECENT_PARITY_SAMPLES);
    }
}

function asWebGLHost(renderer: Renderer): WebGLOsrsRenderer | undefined {
    const candidate = renderer as WebGLOsrsRenderer;
    if (!candidate?.sceneRaycaster || !candidate?.osrsClient?.inputManager) return undefined;
    return candidate;
}

/**
 * Comparison-mode-only read-only picking parity recorder.
 *
 * The recorder taps the exact SceneRaycaster result already consumed by
 * checkInteractions(), snapshots its identities synchronously, then asks M3 for
 * a combined GPU pick at the same input point. It never replaces or mutates the
 * CPU raycast/menu/highlight path.
 *
 * Only one parity request is allowed in flight. Additional CPU raycasts are
 * intentionally dropped while GPU readback is pending so an old CPU stack is
 * never compared with a later queued GPU frame.
 */
export function installWebGPUPickingParityRecorder(renderer: Renderer): () => void {
    diagnosticsByRenderer.delete(renderer);
    if (!comparisonRequested()) return () => {};

    const host = asWebGLHost(renderer);
    if (!host) return () => {};

    const raycaster = host.sceneRaycaster as any;
    const hostMethods = host as any;
    const previousRaycast = raycaster.raycast as (
        ...args: any[]
    ) => SceneRaycastHit[];
    const previousCheckInteractions = hostMethods.checkInteractions as (
        ...args: any[]
    ) => void;
    if (
        typeof previousRaycast !== "function" ||
        typeof previousCheckInteractions !== "function"
    ) {
        return () => {};
    }

    const diagnostics: MutableParityDiagnostics = {
        installed: true,
        totalSamples: 0,
        counts: createCounts(),
        recent: [],
    };
    diagnosticsByRenderer.set(renderer, diagnostics);

    let active = true;
    let parityBusy = false;
    let insideCheckInteractions = false;

    const checkInteractionsWrapper = function (this: unknown, ...args: any[]): void {
        insideCheckInteractions = true;
        try {
            previousCheckInteractions.apply(this, args);
        } finally {
            insideCheckInteractions = false;
        }
    };

    const raycastWrapper = function (this: unknown, ...args: any[]): SceneRaycastHit[] {
        const hits = previousRaycast.apply(this, args);
        if (!active || parityBusy || !insideCheckInteractions) return hits;

        const point = resolveInteractionPoint(host);
        if (!point || !host.osrsClient.camera.containsScreenPoint(point.x, point.y)) {
            return hits;
        }

        // Freeze CPU identity now. SceneRaycaster hits contain ECS/server lookup
        // hints that can change before asynchronous GPU readback completes.
        const cpuStack = snapshotWebGPUCpuPickStack(host, hits);
        const frameCount = host.stats.frameCount | 0;
        parityBusy = true;

        void requestWebGPUTerrainCombinedPick(host, point.x, point.y)
            .then((gpuResult) => {
                if (!active) return;
                const parity = classifyWebGPUPickingParity(
                    cpuStack,
                    snapshotWebGPUPick(gpuResult),
                );
                appendSample(diagnostics, {
                    frameCount,
                    canvasX: point.x,
                    canvasY: point.y,
                    classification: parity.classification,
                    cpuHitCount: cpuStack.length,
                    cpuFront: parity.cpuFront,
                    cpuMatchIndex: parity.cpuMatchIndex,
                    gpu: parity.gpu,
                });
            })
            .finally(() => {
                parityBusy = false;
            });

        return hits;
    };

    hostMethods.checkInteractions = checkInteractionsWrapper;
    raycaster.raycast = raycastWrapper;

    return () => {
        active = false;
        if (raycaster.raycast === raycastWrapper) {
            raycaster.raycast = previousRaycast;
        }
        if (hostMethods.checkInteractions === checkInteractionsWrapper) {
            hostMethods.checkInteractions = previousCheckInteractions;
        }
        diagnostics.installed = false;
        diagnosticsByRenderer.delete(renderer);
    };
}

export function getWebGPUPickingParityDiagnostics(
    renderer: Renderer,
): WebGPUPickingParityDiagnostics | undefined {
    const diagnostics = diagnosticsByRenderer.get(renderer);
    if (!diagnostics) return undefined;
    return {
        installed: diagnostics.installed,
        totalSamples: diagnostics.totalSamples,
        counts: { ...diagnostics.counts },
        recent: diagnostics.recent.slice(),
    };
}
