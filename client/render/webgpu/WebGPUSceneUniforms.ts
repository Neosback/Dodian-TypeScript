import type { SceneFrameDescription } from "../frame/SceneFrameDescription";
import {
    WEBGPU_BUFFER_USAGE,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
} from "../backend/WebGPUPlatform";

export const WEBGPU_SCENE_UNIFORM_FLOATS = 72;
export const WEBGPU_SCENE_UNIFORM_BYTES = WEBGPU_SCENE_UNIFORM_FLOATS * 4;

export const WEBGPU_SCENE_UNIFORM_OFFSETS = {
    viewProjectionMatrix: 0,
    viewMatrix: 16,
    projectionMatrix: 32,
    skyColor: 48,
    sceneHslOverride: 52,
    cameraPosition: 56,
    playerPosition: 58,
    renderDistance: 60,
    fogDepth: 61,
    currentTime: 62,
    brightness: 63,
    colorBanding: 64,
    newTextureAnimation: 65,
    roofPlaneLimit: 66,
    maxLevel: 67,
    cullBackFace: 68,
    scenePreview: 69,
} as const;

/**
 * Packs the renderer-neutral frame into a WGSL-uniform-compatible float block.
 *
 * WebGL's existing scene UBO writes fogEnd into the shader's render-distance
 * slot, so WebGPU intentionally mirrors that mapping for visual parity.
 */
export function packWebGPUSceneUniforms(
    target: Float32Array,
    frame: SceneFrameDescription,
): Float32Array {
    if (target.length < WEBGPU_SCENE_UNIFORM_FLOATS) {
        throw new Error(
            `WebGPU scene uniform buffer requires ${WEBGPU_SCENE_UNIFORM_FLOATS} floats`,
        );
    }

    target.set(frame.viewProjectionMatrix, WEBGPU_SCENE_UNIFORM_OFFSETS.viewProjectionMatrix);
    target.set(frame.viewMatrix, WEBGPU_SCENE_UNIFORM_OFFSETS.viewMatrix);
    target.set(frame.projectionMatrix, WEBGPU_SCENE_UNIFORM_OFFSETS.projectionMatrix);
    target.set(frame.skyColor, WEBGPU_SCENE_UNIFORM_OFFSETS.skyColor);
    target.set(frame.sceneHslOverride, WEBGPU_SCENE_UNIFORM_OFFSETS.sceneHslOverride);
    target.set(frame.cameraPosition, WEBGPU_SCENE_UNIFORM_OFFSETS.cameraPosition);
    target.set(frame.playerPosition, WEBGPU_SCENE_UNIFORM_OFFSETS.playerPosition);

    target[WEBGPU_SCENE_UNIFORM_OFFSETS.renderDistance] = frame.fogEnd;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.fogDepth] = frame.fogDepth;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.currentTime] = frame.timeSeconds;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.brightness] = frame.brightness;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.colorBanding] = frame.colorBanding;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.newTextureAnimation] = frame.newTextureAnimation;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.roofPlaneLimit] = frame.roofPlaneLimit;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.maxLevel] = frame.maxLevel;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.cullBackFace] = frame.cullBackFace ? 1 : 0;
    target[WEBGPU_SCENE_UNIFORM_OFFSETS.scenePreview] = frame.scenePreview ? 1 : 0;
    target[70] = 0;
    target[71] = 0;

    return target;
}

export class WebGPUSceneUniformBuffer {
    readonly data = new Float32Array(WEBGPU_SCENE_UNIFORM_FLOATS);
    readonly buffer: WebGPUBufferLike;

    constructor(private readonly device: WebGPUDeviceLike) {
        this.buffer = device.createBuffer({
            label: "scene-frame-uniforms",
            size: WEBGPU_SCENE_UNIFORM_BYTES,
            usage: WEBGPU_BUFFER_USAGE.UNIFORM | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
    }

    update(frame: SceneFrameDescription): void {
        packWebGPUSceneUniforms(this.data, frame);
        this.device.queue.writeBuffer(this.buffer, 0, this.data);
    }

    dispose(): void {
        this.buffer.destroy?.();
    }
}
