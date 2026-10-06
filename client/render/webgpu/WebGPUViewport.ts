import type { RenderViewportRect } from "../frame/SceneFrameDescription";

/**
 * WebGPU requires viewport/scissor rectangles to stay inside the render target.
 * The gameframe viewport can briefly extend outside the canvas during resize or
 * layout transitions, so clamp it before encoding render commands.
 */
export function clampWebGPUViewport(
    viewport: RenderViewportRect,
    targetWidth: number,
    targetHeight: number,
): RenderViewportRect | undefined {
    const width = Math.max(0, targetWidth | 0);
    const height = Math.max(0, targetHeight | 0);
    if (width === 0 || height === 0) {
        return undefined;
    }

    const left = Math.max(0, Math.min(width, viewport.x));
    const top = Math.max(0, Math.min(height, viewport.y));
    const right = Math.max(left, Math.min(width, viewport.x + viewport.width));
    const bottom = Math.max(top, Math.min(height, viewport.y + viewport.height));
    const clippedWidth = right - left;
    const clippedHeight = bottom - top;

    if (clippedWidth <= 0 || clippedHeight <= 0) {
        return undefined;
    }

    return {
        x: left,
        y: top,
        width: clippedWidth,
        height: clippedHeight,
    };
}

/**
 * Scissor coordinates are integer pixel bounds even though WebGPU viewports may
 * use floating-point coordinates. Round outward so the scissor never clips a
 * valid viewport pixel, then clamp once more to the render target.
 */
export function getWebGPUScissorRect(
    viewport: RenderViewportRect,
    targetWidth: number,
    targetHeight: number,
): RenderViewportRect | undefined {
    const clipped = clampWebGPUViewport(viewport, targetWidth, targetHeight);
    if (!clipped) {
        return undefined;
    }

    const width = Math.max(0, targetWidth | 0);
    const height = Math.max(0, targetHeight | 0);
    const left = Math.max(0, Math.min(width, Math.floor(clipped.x)));
    const top = Math.max(0, Math.min(height, Math.floor(clipped.y)));
    const right = Math.max(left, Math.min(width, Math.ceil(clipped.x + clipped.width)));
    const bottom = Math.max(top, Math.min(height, Math.ceil(clipped.y + clipped.height)));

    if (right <= left || bottom <= top) {
        return undefined;
    }

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
}
