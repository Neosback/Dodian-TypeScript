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

export function updateSceneFrameTiming(
    target: SceneFrameDescription,
    frameNumber: number,
    clientCycle: number,
    clientTickPhase: number,
    timeSeconds: number,
    deltaTimeMs: number,
): void {
    target.frameNumber = frameNumber | 0;
    target.clientCycle = clientCycle | 0;
    target.clientTickPhase = clientTickPhase;
    target.timeSeconds = timeSeconds;
    target.deltaTimeMs = deltaTimeMs;
}

export function updateSceneFrameViewport(
    target: SceneFrameDescription,
    canvasWidth: number,
    canvasHeight: number,
    sceneWidth: number,
    sceneHeight: number,
    sceneViewport: RenderViewportRect,
    sceneFramebufferViewport: RenderViewportRect,
): void {
    target.canvasWidth = canvasWidth | 0;
    target.canvasHeight = canvasHeight | 0;
    target.sceneWidth = sceneWidth | 0;
    target.sceneHeight = sceneHeight | 0;
    copyViewport(target.sceneViewport, sceneViewport);
    copyViewport(target.sceneFramebufferViewport, sceneFramebufferViewport);
}

export function updateSceneFrameCamera(
    target: SceneFrameDescription,
    viewProjectionMatrix: ArrayLike<number>,
    viewMatrix: ArrayLike<number>,
    projectionMatrix: ArrayLike<number>,
    cameraX: number,
    cameraZ: number,
    playerX: number,
    playerZ: number,
): void {
    target.viewProjectionMatrix.set(viewProjectionMatrix);
    target.viewMatrix.set(viewMatrix);
    target.projectionMatrix.set(projectionMatrix);
    target.cameraPosition[0] = cameraX;
    target.cameraPosition[1] = cameraZ;
    target.playerPosition[0] = playerX;
    target.playerPosition[1] = playerZ;
}

export function updateSceneFrameSettings(
    target: SceneFrameDescription,
    skyColor: ArrayLike<number>,
    sceneHslOverride: ArrayLike<number>,
    renderDistance: number,
    fogEnd: number,
    fogDepth: number,
    brightness: number,
    colorBanding: number,
    newTextureAnimation: number,
    maxLevel: number,
    roofPlaneLimit: number | undefined,
    cullBackFace: boolean,
    scenePreview: boolean,
): void {
    target.skyColor.set(skyColor);
    target.sceneHslOverride.set(sceneHslOverride);
    target.renderDistance = renderDistance;
    target.fogEnd = fogEnd;
    target.fogDepth = fogDepth;
    target.brightness = brightness;
    target.colorBanding = colorBanding;
    target.newTextureAnimation = newTextureAnimation;
    target.maxLevel = maxLevel | 0;
    target.roofPlaneLimit = roofPlaneLimit === undefined ? target.maxLevel : roofPlaneLimit | 0;
    target.cullBackFace = cullBackFace;
    target.scenePreview = scenePreview;
}
