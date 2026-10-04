import type { RenderPhase } from "../../ui/devoverlay/Overlay";

export interface OverlayClipRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * API-neutral overlay scheduling data.
 *
 * It intentionally contains no WebGL/WebGPU objects. Backend executors map the
 * ordered command to their own clipping and draw implementation.
 */
export interface OverlayDrawCommand {
    overlayIndex: number;
    phase: RenderPhase;
    clipEnabled: boolean;
    clipRect: OverlayClipRect;
}
