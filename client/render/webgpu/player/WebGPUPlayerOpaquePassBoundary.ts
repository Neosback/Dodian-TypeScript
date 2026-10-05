import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import type {
    WebGPURenderPassEncoderLike,
    WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";

let installed = false;

/**
 * The opaque player pipeline uses bind-group slot 3 for its signed height map,
 * while the static scene uses slot 3 for shared water resources. Restore the
 * static binding immediately before the transparent static pass so switching
 * back to terrain/loc pipelines cannot inherit an incompatible bind group.
 */
export function installWebGPUPlayerOpaquePassBoundaryGuard(): void {
    if (installed) return;
    installed = true;

    const proto = WebGPUStaticSceneRenderer.prototype as any;
    const originalDrawTransparentScene = proto.drawTransparentScene;
    if (typeof originalDrawTransparentScene !== "function") {
        installed = false;
        return;
    }

    proto.drawTransparentScene = function (
        this: WebGPUStaticSceneRenderer,
        pass: WebGPURenderPassEncoderLike,
        frame: SceneFrameDescription,
        terrainPipeline: WebGPURenderPipelineLike,
        locPipeline: WebGPURenderPipelineLike,
    ) {
        const waterBindGroup = (this as any).waterResources?.bindGroup;
        if (waterBindGroup) {
            pass.setBindGroup(3, waterBindGroup);
        }
        return originalDrawTransparentScene.call(
            this,
            pass,
            frame,
            terrainPipeline,
            locPipeline,
        );
    };
}
