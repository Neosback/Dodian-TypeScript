import type { Overlay } from "../../ui/devoverlay/Overlay";
import type { OverlayDrawCommand } from "./OverlayDrawCommand";

export interface OverlayCommandExecutor {
    execute(command: OverlayDrawCommand, overlay: Overlay): void;
    dispose?(): void;
}
