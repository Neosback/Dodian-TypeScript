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

const handlers = new Map<string, WebGPUTransparentActorPhaseHandler>();
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
        for (const handler of sortedHandlers()) {
            handler.draw(this, pass, frame);
        }
    };

    proto.dispose = function (this: WebGPUStaticSceneRenderer) {
        for (const handler of sortedHandlers()) {
            handler.dispose?.(this);
        }
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
