import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type {
    WebGPURenderPassEncoderLike,
    WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import {
    addWebGPUDynamicPhaseSample,
    emptyWebGPUDynamicPhaseCounters,
    trackWebGPUDynamicPhaseDrawCalls,
    type WebGPUDynamicPhaseCounters,
} from "../dynamic/WebGPUDynamicPhaseDiagnostics";

export interface WebGPUOpaqueActorPhaseHandler {
    id: string;
    order: number;
    draw: (
        renderer: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
    ) => void;
    dispose?: (renderer: WebGPUStaticSceneRenderer) => void;
}

export interface WebGPUOpaqueActorPhaseDiagnostics {
    frameToken: number;
    invokedHandlers: readonly string[];
    frameCounters: Readonly<Record<string, WebGPUDynamicPhaseCounters>>;
    totalCounters: Readonly<Record<string, WebGPUDynamicPhaseCounters>>;
}

const handlers = new Map<string, WebGPUOpaqueActorPhaseHandler>();
const diagnostics = new WeakMap<WebGPUStaticSceneRenderer, WebGPUOpaqueActorPhaseDiagnostics>();
const totals = new WeakMap<
    WebGPUStaticSceneRenderer,
    Map<string, WebGPUDynamicPhaseCounters>
>();
let prototypePatched = false;

function sortedHandlers(): WebGPUOpaqueActorPhaseHandler[] {
    return Array.from(handlers.values()).sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
}

function cloneCounters(
    source: ReadonlyMap<string, WebGPUDynamicPhaseCounters>,
): Record<string, WebGPUDynamicPhaseCounters> {
    const result: Record<string, WebGPUDynamicPhaseCounters> = {};
    for (const [id, counters] of source) result[id] = { ...counters };
    return result;
}

function patchStaticRendererPrototype(): void {
    if (prototypePatched) return;
    prototypePatched = true;

    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const originalDrawOpaqueScene = proto.drawOpaqueScene;
    const originalDispose = proto.dispose;

    proto.drawOpaqueScene = function (
        this: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ) {
        originalDrawOpaqueScene.call(this, pass, frame, terrainPipeline, locPipeline);
        const invokedHandlers: string[] = [];
        const frameCounters = new Map<string, WebGPUDynamicPhaseCounters>();
        let rendererTotals = totals.get(this);
        if (!rendererTotals) {
            rendererTotals = new Map();
            totals.set(this, rendererTotals);
        }

        for (const handler of sortedHandlers()) {
            invokedHandlers.push(handler.id);
            const tracked = trackWebGPUDynamicPhaseDrawCalls(pass);
            handler.draw(this, tracked.pass, frame);
            const drawCalls = tracked.getDrawCalls();
            const frameCounter = emptyWebGPUDynamicPhaseCounters();
            addWebGPUDynamicPhaseSample(frameCounter, drawCalls);
            frameCounters.set(handler.id, frameCounter);

            let total = rendererTotals.get(handler.id);
            if (!total) {
                total = emptyWebGPUDynamicPhaseCounters();
                rendererTotals.set(handler.id, total);
            }
            addWebGPUDynamicPhaseSample(total, drawCalls);
        }
        diagnostics.set(this, {
            frameToken: frame.currentTime,
            invokedHandlers,
            frameCounters: cloneCounters(frameCounters),
            totalCounters: cloneCounters(rendererTotals),
        });
    };

    proto.dispose = function (this: WebGPUStaticSceneRenderer) {
        for (const handler of sortedHandlers()) {
            handler.dispose?.(this);
        }
        diagnostics.delete(this);
        totals.delete(this);
        return originalDispose.call(this);
    };
}

export function registerWebGPUOpaqueActorPhase(
    handler: WebGPUOpaqueActorPhaseHandler,
): void {
    handlers.set(handler.id, handler);
    patchStaticRendererPrototype();
}

/**
 * Replay one registered opaque actor phase into a caller-supplied pass.
 *
 * This is intentionally diagnostics-neutral: it is used by on-demand comparison
 * passes such as GPU picking and must not mutate the normal frame counters.
 */
export function replayWebGPUOpaqueActorPhase(
    id: string,
    renderer: WebGPUStaticSceneRenderer,
    pass: WebGPURenderPassEncoderLike,
    frame: SceneFrameDescription,
): boolean {
    const handler = handlers.get(id);
    if (!handler) return false;
    handler.draw(renderer, pass, frame);
    return true;
}

export function getWebGPUOpaqueActorPhaseOrderForTests(): string[] {
    return sortedHandlers().map((handler) => handler.id);
}

export function getWebGPUOpaqueActorPhaseDiagnostics(
    renderer: WebGPUStaticSceneRenderer,
): WebGPUOpaqueActorPhaseDiagnostics | undefined {
    return diagnostics.get(renderer);
}
