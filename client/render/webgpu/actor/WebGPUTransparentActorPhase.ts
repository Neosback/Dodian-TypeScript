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

export interface WebGPUTransparentActorPhaseHandler {
    id: string;
    order: number;
    draw: (
        renderer: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
    ) => void;
    dispose?: (renderer: WebGPUStaticSceneRenderer) => void;
}

export interface WebGPUTransparentActorPhaseDiagnostics {
    frameToken: number;
    invokedHandlers: readonly string[];
    frameCounters: Readonly<Record<string, WebGPUDynamicPhaseCounters>>;
    totalCounters: Readonly<Record<string, WebGPUDynamicPhaseCounters>>;
}

const handlers = new Map<string, WebGPUTransparentActorPhaseHandler>();
const diagnostics = new WeakMap<
    WebGPUStaticSceneRenderer,
    WebGPUTransparentActorPhaseDiagnostics
>();
const totals = new WeakMap<
    WebGPUStaticSceneRenderer,
    Map<string, WebGPUDynamicPhaseCounters>
>();
let prototypePatched = false;

function sortedHandlers(): WebGPUTransparentActorPhaseHandler[] {
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
    const originalDrawTransparentScene = proto.drawTransparentScene;
    const originalDispose = proto.dispose;

    proto.drawTransparentScene = function (
        this: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ) {
        originalDrawTransparentScene.call(this, pass, frame, terrainPipeline, locPipeline);
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

export function registerWebGPUTransparentActorPhase(
    handler: WebGPUTransparentActorPhaseHandler,
): void {
    handlers.set(handler.id, handler);
    patchStaticRendererPrototype();
}

export function getWebGPUTransparentActorPhaseOrderForTests(): string[] {
    return sortedHandlers().map((handler) => handler.id);
}

export function getWebGPUTransparentActorPhaseDiagnostics(
    renderer: WebGPUStaticSceneRenderer,
): WebGPUTransparentActorPhaseDiagnostics | undefined {
    return diagnostics.get(renderer);
}
