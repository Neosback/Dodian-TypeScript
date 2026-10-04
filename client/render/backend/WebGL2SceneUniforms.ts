import type { UniformBuffer } from "picogl";

import type { SceneFrameDescription } from "../frame/SceneFrameDescription";

/**
 * WebGL2 mapping for the renderer-neutral scene frame.
 *
 * Keep this index mapping identical to the existing Scene uniform block until
 * the GLSL path is retired.
 */
export function uploadWebGL2SceneFrame(
    uniformBuffer: UniformBuffer,
    frame: SceneFrameDescription,
): void {
    uniformBuffer
        .set(0, frame.viewProjectionMatrix)
        .set(1, frame.viewMatrix)
        .set(2, frame.projectionMatrix)
        .set(3, frame.skyColor)
        .set(4, frame.sceneHslOverride)
        .set(5, frame.cameraPosition)
        .set(6, frame.playerPosition)
        .set(7, frame.fogEnd as any)
        .set(8, frame.fogDepth as any)
        .set(9, frame.timeSeconds as any)
        .set(10, frame.brightness as any)
        .set(11, frame.colorBanding as any)
        .set(12, frame.newTextureAnimation as any)
        .update();
}
