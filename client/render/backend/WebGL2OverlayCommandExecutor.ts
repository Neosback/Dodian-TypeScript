import { App as PicoApp, PicoGL } from "picogl";

import type { Overlay } from "../../ui/devoverlay/Overlay";
import type { OverlayCommandExecutor } from "../frame/OverlayCommandExecutor";
import type { OverlayDrawCommand } from "../frame/OverlayDrawCommand";

/**
 * WebGL2 implementation of overlay pass scheduling and viewport clipping.
 *
 * Overlay geometry is still WebGL-backed during this migration checkpoint.
 * The scheduling command itself is graphics-API neutral so WebGPU can later
 * provide its own executor without changing frame ordering.
 */
export class WebGL2OverlayCommandExecutor implements OverlayCommandExecutor {
    constructor(private readonly app: PicoApp) {}

    execute(command: OverlayDrawCommand, overlay: Overlay): void {
        if (!command.clipEnabled) {
            overlay.draw(command.phase);
            return;
        }

        const clip = command.clipRect;
        this.app.enable(PicoGL.SCISSOR_TEST);
        this.app.scissor(
            clip.x,
            this.app.height - clip.y - clip.height,
            clip.width,
            clip.height,
        );
        try {
            overlay.draw(command.phase);
        } finally {
            this.app.disable(PicoGL.SCISSOR_TEST);
        }
    }
}
