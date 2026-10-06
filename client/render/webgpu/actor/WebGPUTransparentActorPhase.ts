import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type {
    WebGPURenderPassEncoderLike,
    WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";

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
}

const handlers = new Map<string, WebGPUTransparentActorPhaseHandler>();
const diagnostics = new WeakMap<
    WebGPUStaticSceneRenderer,
    WebGPUTransparentActorPhaseDiagnostics
>();
let prototypePatched = false;

function sortedHandlers(): WebGPUTransparentActorPhaseHandler[] {
    return Array.from(handlers.values()).sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
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
        for (const handler of sortedHandlers()) {
            invokedHandlers.push(handler.id);
            handler.draw(this, pass, frame);
        }
        diagnostics.set(this, {
            frameToken: frame.currentTime,
            invokedHandlers,
        });
    };

    proto.dispose = function (this: WebGPUStaticSceneRenderer) {
        for (const handler of sortedHandlers()) {
            handler.dispose?.(this);
        }
        diagnostics.delete(this);
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
