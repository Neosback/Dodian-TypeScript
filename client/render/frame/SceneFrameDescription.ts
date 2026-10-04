export interface RenderViewportRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SceneFrameDescription {
    frameNumber: number;
    clientCycle: number;
    clientTickPhase: number;
    timeSeconds: number;
    deltaTimeMs: number;

    canvasWidth: number;
    canvasHeight: number;
    sceneWidth: number;
    sceneHeight: number;
    sceneViewport: RenderViewportRect;
    sceneFramebufferViewport: RenderViewportRect;

    viewProjectionMatrix: Float32Array;
    viewMatrix: Float32Array;
    projectionMatrix: Float32Array;
    skyColor: Float32Array;
    sceneHslOverride: Float32Array;
    cameraPosition: Float32Array;
    playerPosition: Float32Array;

    renderDistance: number;
    fogEnd: number;
    fogDepth: number;
    brightness: number;
    colorBanding: number;
    newTextureAnimation: number;

    maxLevel: number;
    roofPlaneLimit: number;
    cullBackFace: boolean;
    scenePreview: boolean;
}

export interface SceneFrameDescriptionSource {
    frameNumber: number;
    clientCycle: number;
    clientTickPhase: number;
    timeSeconds: number;
    deltaTimeMs: number;

    canvasWidth: number;
    canvasHeight: number;
    sceneWidth: number;
    sceneHeight: number;
    sceneViewport: RenderViewportRect;
    sceneFramebufferViewport: RenderViewportRect;

    viewProjectionMatrix: ArrayLike<number>;
    viewMatrix: ArrayLike<number>;
    projectionMatrix: ArrayLike<number>;
    skyColor: ArrayLike<number>;
    sceneHslOverride: ArrayLike<number>;
    cameraX: number;
    cameraZ: number;
    playerX: number;
    playerZ: number;

    renderDistance: number;
    fogEnd: number;
    fogDepth: number;
    brightness: number;
    colorBanding: number;
    newTextureAnimation: number;

    maxLevel: number;
    roofPlaneLimit?: number;
    cullBackFace: boolean;
    scenePreview: boolean;
}

function emptyViewport(): RenderViewportRect {
    return { x: 0, y: 0, width: 1, height: 1 };
}

/**
 * CPU-owned render state shared by graphics backends.
 *
 * Arrays and viewport objects are allocated once and mutated each frame so the
 * backend boundary does not add hot-loop garbage.
 */
export function createSceneFrameDescription(): SceneFrameDescription {
    return {
        frameNumber: 0,
        clientCycle: 0,
        clientTickPhase: 0,
        timeSeconds: 0,
        deltaTimeMs: 0,

        canvasWidth: 1,
        canvasHeight: 1,
        sceneWidth: 1,
        sceneHeight: 1,
        sceneViewport: emptyViewport(),
        sceneFramebufferViewport: emptyViewport(),

        viewProjectionMatrix: new Float32Array(16),
        viewMatrix: new Float32Array(16),
        projectionMatrix: new Float32Array(16),
        skyColor: new Float32Array(4),
        sceneHslOverride: new Float32Array(4),
        cameraPosition: new Float32Array(2),
        playerPosition: new Float32Array(2),

        renderDistance: 0,
        fogEnd: 0,
        fogDepth: 0,
        brightness: 1,
        colorBanding: 255,
        newTextureAnimation: 0,

        maxLevel: 0,
        roofPlaneLimit: 0,
        cullBackFace: true,
        scenePreview: false,
    };
}

function copyViewport(target: RenderViewportRect, source: RenderViewportRect): void {
    target.x = source.x;
    target.y = source.y;
    target.width = source.width;
    target.height = source.height;
}

export function updateSceneFrameDescription(
    target: SceneFrameDescription,
    source: SceneFrameDescriptionSource,
): SceneFrameDescription {
    target.frameNumber = source.frameNumber | 0;
    target.clientCycle = source.clientCycle | 0;
    target.clientTickPhase = source.clientTickPhase;
    target.timeSeconds = source.timeSeconds;
    target.deltaTimeMs = source.deltaTimeMs;

    target.canvasWidth = source.canvasWidth | 0;
    target.canvasHeight = source.canvasHeight | 0;
    target.sceneWidth = source.sceneWidth | 0;
    target.sceneHeight = source.sceneHeight | 0;
    copyViewport(target.sceneViewport, source.sceneViewport);
    copyViewport(target.sceneFramebufferViewport, source.sceneFramebufferViewport);

    target.viewProjectionMatrix.set(source.viewProjectionMatrix);
    target.viewMatrix.set(source.viewMatrix);
    target.projectionMatrix.set(source.projectionMatrix);
    target.skyColor.set(source.skyColor);
    target.sceneHslOverride.set(source.sceneHslOverride);
    target.cameraPosition[0] = source.cameraX;
    target.cameraPosition[1] = source.cameraZ;
    target.playerPosition[0] = source.playerX;
    target.playerPosition[1] = source.playerZ;

    target.renderDistance = source.renderDistance;
    target.fogEnd = source.fogEnd;
    target.fogDepth = source.fogDepth;
    target.brightness = source.brightness;
    target.colorBanding = source.colorBanding;
    target.newTextureAnimation = source.newTextureAnimation;

    target.maxLevel = source.maxLevel | 0;
    target.roofPlaneLimit =
        source.roofPlaneLimit === undefined ? target.maxLevel : source.roofPlaneLimit | 0;
    target.cullBackFace = source.cullBackFace;
    target.scenePreview = source.scenePreview;

    return target;
}
